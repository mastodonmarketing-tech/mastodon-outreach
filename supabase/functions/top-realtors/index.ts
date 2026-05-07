// top-realtors
//
// Read-only API that returns the current top producers with their contact info.
//
// GET / POST query params (all optional):
//   metro=austin                 // filter to a single metro
//   min_closings=10              // threshold (default 10)
//   window_days=30               // window (default 30)
//   limit=100                    // max rows (default 100)
//   only_enriched=true           // hide rows that don't have any contact info yet
//   format=json|csv              // default json

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const params: Record<string, string> = {};
    url.searchParams.forEach((v, k) => { params[k] = v; });
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      Object.assign(params, body);
    }

    const metro = params.metro;
    const minClosings = Number(params.min_closings ?? 10);
    const windowDays = Number(params.window_days ?? 30);
    const limit = Math.min(Number(params.limit ?? 100), 1000);
    const onlyEnriched = params.only_enriched === "true" || params.only_enriched === true as unknown;
    const format = (params.format ?? "json").toLowerCase();

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseKey) {
      throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
    }
    const supabase = createClient(supabaseUrl, supabaseKey);

    let q = supabase
      .from("realtor_metro_stats")
      .select(`
        metro,
        closings_count,
        total_sold_volume,
        median_sold_price,
        realtor:realtors!inner (
          id, full_name, brokerage, license_number, primary_metro,
          email, phone, linkedin_url, instagram_url, facebook_url,
          twitter_url, website_url, brokerage_profile_url,
          zillow_profile_url, realtor_dot_com_profile_url,
          enrichment_status, enriched_at, last_seen_at
        )
      `)
      .eq("window_days", windowDays)
      .gte("closings_count", minClosings)
      .order("closings_count", { ascending: false })
      .limit(limit);
    if (metro) q = q.eq("metro", metro);

    const { data, error } = await q;
    if (error) throw error;

    type Row = {
      metro: string;
      closings_count: number;
      total_sold_volume: number;
      median_sold_price: number | null;
      realtor: Record<string, unknown> & { enrichment_status?: string };
    };
    let rows = (data ?? []) as unknown as Row[];
    if (onlyEnriched) {
      rows = rows.filter((r) => r.realtor.enrichment_status === "enriched");
    }
    const flat = rows.map((r) => ({
      metro: r.metro,
      closings_count: r.closings_count,
      total_sold_volume: r.total_sold_volume,
      median_sold_price: r.median_sold_price,
      ...r.realtor,
    }));

    if (format === "csv") {
      if (flat.length === 0) {
        return new Response("", { headers: { ...corsHeaders, "Content-Type": "text/csv" } });
      }
      const headers = Object.keys(flat[0]);
      const lines = [headers.join(",")];
      for (const row of flat) {
        lines.push(headers.map((h) => csvEscape((row as Record<string, unknown>)[h])).join(","));
      }
      return new Response(lines.join("\n"), {
        headers: {
          ...corsHeaders,
          "Content-Type": "text/csv",
          "Content-Disposition": `attachment; filename="top-realtors-${metro ?? "all"}-${windowDays}d.csv"`,
        },
      });
    }

    return new Response(
      JSON.stringify({ ok: true, count: flat.length, rows: flat }),
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
