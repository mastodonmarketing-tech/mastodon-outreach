// enrich-realtors
//
// Picks realtors that meet the top-producer threshold and have no contact info
// yet, runs them through the Serper + Gemini enrichment pipeline, and writes
// email / phone / social URLs back onto the realtor row.
//
// POST body (all optional):
//   {
//     "metro": "austin",          // limit to one metro
//     "min_closings": 10,         // top-producer threshold (default 10)
//     "window_days": 30,          // window the threshold applies to
//     "limit": 25,                // max realtors to enrich in this run
//     "force": false              // re-enrich even if already enriched
//   }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { enrichRealtor } from "../_shared/realtor-enrich.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type EnrichRequest = {
  metro?: string;
  min_closings?: number;
  window_days?: number;
  limit?: number;
  force?: boolean;
};

type Candidate = {
  id: string;
  full_name: string;
  brokerage: string | null;
  primary_metro: string | null;
  enrichment_status: string;
  closings_count: number;
};

async function pickCandidates(
  supabase: SupabaseClient,
  req: EnrichRequest,
): Promise<Candidate[]> {
  const minClosings = req.min_closings ?? 10;
  const windowDays = req.window_days ?? 30;
  const limit = req.limit ?? 25;

  let statsQuery = supabase
    .from("realtor_metro_stats")
    .select("realtor_id, closings_count, metro")
    .eq("window_days", windowDays)
    .gte("closings_count", minClosings)
    .order("closings_count", { ascending: false })
    .limit(limit * 4); // overfetch since we filter by enrichment_status next
  if (req.metro) statsQuery = statsQuery.eq("metro", req.metro);

  const { data: stats, error: statsErr } = await statsQuery;
  if (statsErr) throw statsErr;
  const statsRows = (stats ?? []) as Array<{
    realtor_id: string;
    closings_count: number;
    metro: string;
  }>;
  if (statsRows.length === 0) return [];

  const ids = statsRows.map((r) => r.realtor_id);
  let realtorsQuery = supabase
    .from("realtors")
    .select("id, full_name, brokerage, primary_metro, enrichment_status")
    .in("id", ids);
  if (!req.force) realtorsQuery = realtorsQuery.eq("enrichment_status", "pending");

  const { data: realtors, error: realtorsErr } = await realtorsQuery;
  if (realtorsErr) throw realtorsErr;
  const byId = new Map<string, Candidate>();
  for (const r of (realtors ?? []) as Array<{
    id: string;
    full_name: string;
    brokerage: string | null;
    primary_metro: string | null;
    enrichment_status: string;
  }>) {
    const stat = statsRows.find((s) => s.realtor_id === r.id);
    if (!stat) continue;
    byId.set(r.id, {
      ...r,
      closings_count: stat.closings_count,
    });
  }
  return Array.from(byId.values())
    .sort((a, b) => b.closings_count - a.closings_count)
    .slice(0, limit);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body: EnrichRequest = req.method === "POST" ? await req.json().catch(() => ({})) : {};

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseKey) {
      throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
    }
    const supabase = createClient(supabaseUrl, supabaseKey);

    const candidates = await pickCandidates(supabase, body);
    if (candidates.length === 0) {
      return new Response(
        JSON.stringify({ ok: true, enriched: 0, message: "No candidates met the threshold." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const metroLookup = new Map<string, { display_name: string; state: string }>();
    const metroSlugs = Array.from(new Set(candidates.map((c) => c.primary_metro).filter(Boolean) as string[]));
    if (metroSlugs.length > 0) {
      const { data: metros } = await supabase
        .from("realtor_metros")
        .select("slug, display_name, state")
        .in("slug", metroSlugs);
      for (const m of (metros ?? []) as Array<{ slug: string; display_name: string; state: string }>) {
        metroLookup.set(m.slug, { display_name: m.display_name, state: m.state });
      }
    }

    let enriched = 0;
    let failed = 0;
    const results: Array<Record<string, unknown>> = [];
    for (const c of candidates) {
      const metro = c.primary_metro ? metroLookup.get(c.primary_metro) : null;
      try {
        const er = await enrichRealtor({
          name: c.full_name,
          brokerage: c.brokerage,
          city: metro?.display_name ?? null,
          state: metro?.state ?? null,
        });
        const update: Record<string, unknown> = {
          email: er.email,
          phone: er.phone,
          linkedin_url: er.linkedin_url,
          instagram_url: er.instagram_url,
          facebook_url: er.facebook_url,
          twitter_url: er.twitter_url,
          website_url: er.website_url,
          brokerage_profile_url: er.brokerage_profile_url,
          zillow_profile_url: er.zillow_profile_url,
          realtor_dot_com_profile_url: er.realtor_dot_com_profile_url,
          enrichment_status: "enriched",
          enrichment_error: null,
          enriched_at: new Date().toISOString(),
        };
        const { error: upErr } = await supabase.from("realtors").update(update).eq("id", c.id);
        if (upErr) throw upErr;
        enriched += 1;
        results.push({
          id: c.id,
          name: c.full_name,
          closings: c.closings_count,
          status: "enriched",
        });
      } catch (e) {
        failed += 1;
        const message = e instanceof Error ? e.message : String(e);
        await supabase
          .from("realtors")
          .update({
            enrichment_status: "failed",
            enrichment_error: message.slice(0, 500),
            enriched_at: new Date().toISOString(),
          })
          .eq("id", c.id);
        results.push({
          id: c.id,
          name: c.full_name,
          closings: c.closings_count,
          status: "failed",
          error: message.slice(0, 200),
        });
      }
    }

    return new Response(
      JSON.stringify({ ok: true, enriched, failed, results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return new Response(
      JSON.stringify({ ok: false, error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
