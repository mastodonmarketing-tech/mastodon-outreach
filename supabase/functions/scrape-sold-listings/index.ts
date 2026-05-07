// scrape-sold-listings
//
// Pulls sold listings for each enabled metro over the last N days (default 30),
// upserts realtors + listings, then recomputes realtor_metro_stats so the
// dashboard / outreach picker can sort by closings/mo without re-aggregating.
//
// POST body (all optional):
//   {
//     "metros": ["nyc", "austin"],   // limit to specific metros
//     "since_days": 30,              // window size
//     "skip_stats": false            // if true, only ingest listings
//   }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createSource, Metro, SoldListing } from "../_shared/realtor-source.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type ScrapeRequest = {
  metros?: string[];
  since_days?: number;
  skip_stats?: boolean;
};

type RealtorRow = { id: string };

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function normalizeAgentKey(name: string, brokerage: string | null): string {
  return `${name.trim().toLowerCase()}::${(brokerage ?? "").trim().toLowerCase()}`;
}

async function loadMetros(supabase: SupabaseClient, slugs?: string[]): Promise<Metro[]> {
  let query = supabase.from("realtor_metros").select("*").eq("enabled", true);
  if (slugs && slugs.length > 0) query = query.in("slug", slugs);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as Metro[];
}

async function upsertRealtor(
  supabase: SupabaseClient,
  listing: SoldListing,
  metroSlug: string,
): Promise<string> {
  // Look up by license first (most reliable), then by name+brokerage.
  if (listing.agent_license_number) {
    const { data: existing } = await supabase
      .from("realtors")
      .select("id")
      .ilike("license_number", listing.agent_license_number)
      .maybeSingle();
    if (existing) {
      await supabase
        .from("realtors")
        .update({ last_seen_at: new Date().toISOString() })
        .eq("id", existing.id);
      return (existing as RealtorRow).id;
    }
  }
  const { data: byName } = await supabase
    .from("realtors")
    .select("id")
    .ilike("full_name", listing.agent_full_name)
    .ilike("brokerage", listing.agent_brokerage ?? "")
    .maybeSingle();
  if (byName) {
    await supabase
      .from("realtors")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("id", byName.id);
    return (byName as RealtorRow).id;
  }
  const { data: inserted, error } = await supabase
    .from("realtors")
    .insert({
      full_name: listing.agent_full_name,
      brokerage: listing.agent_brokerage,
      license_number: listing.agent_license_number,
      email: listing.agent_email,
      phone: listing.agent_phone,
      primary_metro: metroSlug,
      enrichment_status: "pending",
    })
    .select("id")
    .single();
  if (error) throw error;
  return (inserted as RealtorRow).id;
}

async function recomputeMetroStats(
  supabase: SupabaseClient,
  metroSlug: string,
  windowDays: number,
): Promise<number> {
  const since = isoDate(new Date(Date.now() - windowDays * 86_400_000));
  const { data, error } = await supabase
    .from("realtor_listings")
    .select("realtor_id, sold_price")
    .eq("metro", metroSlug)
    .gte("sold_date", since);
  if (error) throw error;
  const byAgent = new Map<string, { count: number; volume: number; prices: number[] }>();
  for (const row of (data ?? []) as Array<{ realtor_id: string; sold_price: number | null }>) {
    const agg = byAgent.get(row.realtor_id) ?? { count: 0, volume: 0, prices: [] };
    agg.count += 1;
    if (typeof row.sold_price === "number") {
      agg.volume += row.sold_price;
      agg.prices.push(row.sold_price);
    }
    byAgent.set(row.realtor_id, agg);
  }
  if (byAgent.size === 0) return 0;
  const rows = Array.from(byAgent.entries()).map(([realtor_id, agg]) => {
    let median: number | null = null;
    if (agg.prices.length > 0) {
      const sorted = agg.prices.slice().sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      median = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
    }
    return {
      realtor_id,
      metro: metroSlug,
      window_days: windowDays,
      closings_count: agg.count,
      total_sold_volume: agg.volume,
      median_sold_price: median,
      computed_at: new Date().toISOString(),
    };
  });
  // Wipe the window for this metro and reinsert — simpler than diffing.
  await supabase
    .from("realtor_metro_stats")
    .delete()
    .eq("metro", metroSlug)
    .eq("window_days", windowDays);
  const { error: insErr } = await supabase.from("realtor_metro_stats").insert(rows);
  if (insErr) throw insErr;
  return rows.length;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body: ScrapeRequest = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const sinceDays = body.since_days ?? 30;
    const skipStats = body.skip_stats === true;

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseKey) {
      throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
    }
    const supabase = createClient(supabaseUrl, supabaseKey);

    const metros = await loadMetros(supabase, body.metros);
    if (metros.length === 0) {
      return new Response(
        JSON.stringify({ ok: false, error: "No enabled metros matched" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const source = createSource();
    const since = isoDate(new Date(Date.now() - sinceDays * 86_400_000));
    const until = isoDate(new Date());

    const summary: Array<Record<string, unknown>> = [];
    for (const metro of metros) {
      const listings = await source.fetch(metro, since, until);
      const agentCache = new Map<string, string>();

      let inserted = 0;
      let skipped = 0;
      for (const listing of listings) {
        const key = normalizeAgentKey(listing.agent_full_name, listing.agent_brokerage);
        let realtorId = agentCache.get(key);
        if (!realtorId) {
          realtorId = await upsertRealtor(supabase, listing, metro.slug);
          agentCache.set(key, realtorId);
        }
        const { error: insErr } = await supabase
          .from("realtor_listings")
          .insert({
            realtor_id: realtorId,
            metro: metro.slug,
            source: listing.source,
            source_listing_id: listing.source_listing_id,
            address_line: listing.address_line,
            city: listing.city,
            state: listing.state,
            zip: listing.zip,
            sold_price: listing.sold_price,
            sold_date: listing.sold_date,
            listing_url: listing.listing_url,
            raw: listing.raw,
          });
        if (insErr) {
          // Unique violation on (source, source_listing_id) => already ingested.
          if ((insErr as { code?: string }).code === "23505") {
            skipped += 1;
          } else {
            throw insErr;
          }
        } else {
          inserted += 1;
        }
      }

      let statsRows = 0;
      if (!skipStats) {
        statsRows = await recomputeMetroStats(supabase, metro.slug, sinceDays);
      }

      summary.push({
        metro: metro.slug,
        listings_fetched: listings.length,
        listings_inserted: inserted,
        listings_skipped_duplicate: skipped,
        unique_agents: agentCache.size,
        stats_rows: statsRows,
      });
    }

    return new Response(
      JSON.stringify({
        ok: true,
        source: source.name,
        since,
        until,
        window_days: sinceDays,
        metros: summary,
      }),
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
