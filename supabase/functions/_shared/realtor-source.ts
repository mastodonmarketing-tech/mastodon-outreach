// Sold-listings data source adapter.
//
// Defines a normalized SoldListing shape and a fetcher interface so the
// scrape-sold-listings function stays source-agnostic. The default
// implementation calls RealEstateAPI.com (PropertySearch with sold filter),
// which returns listing-agent metadata and supports geo + date filters.
//
// To swap in a different provider (ATTOM, Bridge RESO Web API, MLS Grid):
// implement SoldListingSource.fetch and register it in createSource() below.

export type Metro = {
  slug: string;
  display_name: string;
  state: string;
  search_terms: string[];
  bbox_north: number | null;
  bbox_south: number | null;
  bbox_east: number | null;
  bbox_west: number | null;
};

export type SoldListing = {
  source: string;
  source_listing_id: string | null;
  agent_full_name: string;
  agent_brokerage: string | null;
  agent_license_number: string | null;
  agent_email: string | null;
  agent_phone: string | null;
  address_line: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  sold_price: number | null;
  sold_date: string; // YYYY-MM-DD
  listing_url: string | null;
  raw: Record<string, unknown>;
};

export interface SoldListingSource {
  readonly name: string;
  fetch(metro: Metro, sinceDate: string, untilDate: string): Promise<SoldListing[]>;
}

// --- RealEstateAPI.com adapter --------------------------------------------
// Docs: https://developer.realestateapi.com/reference/property-search-api
// Auth: x-api-key header. Endpoint accepts a JSON body with city/state filters
// and a sale-date range. Returns up to ~250 results per page.

class RealEstateApiSource implements SoldListingSource {
  readonly name = "realestateapi";

  constructor(private readonly apiKey: string) {}

  async fetch(metro: Metro, sinceDate: string, untilDate: string): Promise<SoldListing[]> {
    const out: SoldListing[] = [];
    for (const term of metro.search_terms) {
      const [city, stateRaw] = term.split(",").map((s) => s.trim());
      const state = stateRaw || metro.state;
      let page = 1;
      while (true) {
        const body = {
          size: 250,
          resultIndex: (page - 1) * 250,
          city,
          state,
          last_sale_date_min: sinceDate,
          last_sale_date_max: untilDate,
          mls_active: false,
          mls_sold: true,
        };
        const resp = await fetch("https://api.realestateapi.com/v2/PropertySearch", {
          method: "POST",
          headers: {
            "x-api-key": this.apiKey,
            "Content-Type": "application/json",
            "Accept": "application/json",
          },
          body: JSON.stringify(body),
        });
        if (!resp.ok) {
          const text = await resp.text();
          throw new Error(`RealEstateAPI ${resp.status}: ${text.slice(0, 500)}`);
        }
        const json = await resp.json() as {
          data?: Array<Record<string, unknown>>;
          recordCount?: number;
          resultCount?: number;
        };
        const rows = json.data ?? [];
        for (const r of rows) {
          const normalized = normalizeRealEstateApi(r);
          if (normalized) out.push(normalized);
        }
        if (rows.length < 250) break;
        page += 1;
        if (page > 20) break; // hard cap so a runaway query doesn't blow the budget
      }
    }
    return out;
  }
}

function normalizeRealEstateApi(r: Record<string, unknown>): SoldListing | null {
  const get = (path: string): unknown => {
    return path.split(".").reduce<unknown>((acc, key) => {
      if (acc && typeof acc === "object") return (acc as Record<string, unknown>)[key];
      return undefined;
    }, r);
  };
  const agentName =
    (get("mlsListingAgentName") as string | undefined) ||
    (get("listingAgent.name") as string | undefined) ||
    (get("listAgentName") as string | undefined);
  if (!agentName) return null;
  const soldDateRaw =
    (get("lastSaleDate") as string | undefined) ||
    (get("mlsSoldDate") as string | undefined);
  if (!soldDateRaw) return null;
  const soldDate = String(soldDateRaw).slice(0, 10);
  const priceRaw =
    (get("lastSalePrice") as number | undefined) ??
    (get("mlsSoldPrice") as number | undefined);
  return {
    source: "realestateapi",
    source_listing_id:
      (get("id") as string | undefined) ||
      (get("mlsId") as string | undefined) ||
      null,
    agent_full_name: String(agentName).trim(),
    agent_brokerage:
      (get("mlsListingOfficeName") as string | undefined) ||
      (get("listingOffice.name") as string | undefined) ||
      null,
    agent_license_number:
      (get("mlsListingAgentLicense") as string | undefined) || null,
    agent_email:
      (get("mlsListingAgentEmail") as string | undefined) || null,
    agent_phone:
      (get("mlsListingAgentPhone") as string | undefined) || null,
    address_line: (get("address.address") as string | undefined) || null,
    city: (get("address.city") as string | undefined) || null,
    state: (get("address.state") as string | undefined) || null,
    zip: (get("address.zip") as string | undefined) || null,
    sold_price: typeof priceRaw === "number" ? priceRaw : null,
    sold_date: soldDate,
    listing_url: (get("mlsListingUrl") as string | undefined) || null,
    raw: r,
  };
}

// --- Mock adapter for local dev / testing without an API key --------------

class MockSource implements SoldListingSource {
  readonly name = "mock";

  fetch(metro: Metro, sinceDate: string, untilDate: string): Promise<SoldListing[]> {
    const samples: SoldListing[] = [];
    const seedAgents = [
      { name: "Jane Top Producer", brokerage: "Compass" },
      { name: "John Average Agent", brokerage: "Keller Williams" },
    ];
    for (let i = 0; i < 12; i += 1) {
      const agent = seedAgents[i % seedAgents.length];
      samples.push({
        source: "mock",
        source_listing_id: `${metro.slug}-${sinceDate}-${i}`,
        agent_full_name: agent.name,
        agent_brokerage: agent.brokerage,
        agent_license_number: null,
        agent_email: null,
        agent_phone: null,
        address_line: `${1000 + i} Main St`,
        city: metro.display_name,
        state: metro.state,
        zip: null,
        sold_price: 500000 + i * 25000,
        sold_date: sinceDate,
        listing_url: null,
        raw: { metro: metro.slug, sinceDate, untilDate, i },
      });
    }
    return Promise.resolve(samples);
  }
}

export function createSource(): SoldListingSource {
  const provider = (Deno.env.get("REALTOR_SOURCE") || "realestateapi").toLowerCase();
  if (provider === "mock") return new MockSource();
  if (provider === "realestateapi") {
    const key = Deno.env.get("REALESTATEAPI_KEY");
    if (!key) {
      throw new Error("REALESTATEAPI_KEY is not set. Set REALTOR_SOURCE=mock for local dev.");
    }
    return new RealEstateApiSource(key);
  }
  throw new Error(`Unknown REALTOR_SOURCE: ${provider}`);
}
