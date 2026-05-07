// Contact/social enrichment for a realtor.
//
// Strategy: Serper.dev to query Google for the agent + brokerage + city, then
// pass the top organic results (titles + snippets + links) to Gemini and ask
// it to extract the canonical email / phone / LinkedIn / Instagram / Facebook /
// website URLs. Gemini is told to return null when it isn't confident.

const GEMINI_KEY = Deno.env.get("GEMINI_API_KEY") || "";
const GEMINI_MODEL = Deno.env.get("GEMINI_MODEL") || "gemini-2.0-flash";
const SERPER_KEY = Deno.env.get("SERPER_API_KEY") || "";

export type EnrichmentResult = {
  email: string | null;
  phone: string | null;
  linkedin_url: string | null;
  instagram_url: string | null;
  facebook_url: string | null;
  twitter_url: string | null;
  website_url: string | null;
  brokerage_profile_url: string | null;
  zillow_profile_url: string | null;
  realtor_dot_com_profile_url: string | null;
  notes: string | null;
};

type SerperOrganic = {
  title?: string;
  link?: string;
  snippet?: string;
};

async function googleSearch(query: string): Promise<SerperOrganic[]> {
  if (!SERPER_KEY) {
    throw new Error("SERPER_API_KEY is not set");
  }
  const resp = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: {
      "X-API-KEY": SERPER_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ q: query, num: 10 }),
  });
  if (!resp.ok) {
    throw new Error(`Serper ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
  }
  const json = await resp.json() as { organic?: SerperOrganic[] };
  return json.organic ?? [];
}

const EXTRACTION_SYSTEM = `You extract realtor contact info from web search results.

Given the agent name, brokerage, city, and a list of search results (title +
snippet + link), output canonical contact details and social profiles for THIS
specific agent only.

Rules:
- Only return a value when the search result clearly belongs to this agent.
  When in doubt, return null.
- Do not invent emails or phone numbers. If you don't see a real one in the
  snippets/links, return null.
- For URLs, prefer the agent's own profile page (LinkedIn /in/<slug>, Instagram
  /<handle>, Facebook /<handle>, brokerage agent profile, Zillow
  /profile/<slug>, Realtor.com /realestateagents/<slug>).
- Return strict JSON matching the requested schema. No prose, no markdown.`;

const EXTRACTION_SCHEMA = {
  type: "object",
  properties: {
    email: { type: ["string", "null"] },
    phone: { type: ["string", "null"] },
    linkedin_url: { type: ["string", "null"] },
    instagram_url: { type: ["string", "null"] },
    facebook_url: { type: ["string", "null"] },
    twitter_url: { type: ["string", "null"] },
    website_url: { type: ["string", "null"] },
    brokerage_profile_url: { type: ["string", "null"] },
    zillow_profile_url: { type: ["string", "null"] },
    realtor_dot_com_profile_url: { type: ["string", "null"] },
    notes: { type: ["string", "null"] },
  },
  required: [
    "email", "phone", "linkedin_url", "instagram_url", "facebook_url",
    "twitter_url", "website_url", "brokerage_profile_url",
    "zillow_profile_url", "realtor_dot_com_profile_url", "notes",
  ],
};

async function extractWithGemini(
  agent: { name: string; brokerage: string | null; city: string | null },
  results: SerperOrganic[],
): Promise<EnrichmentResult> {
  if (!GEMINI_KEY) throw new Error("GEMINI_API_KEY is not set");
  const userPrompt = [
    `Agent name: ${agent.name}`,
    `Brokerage: ${agent.brokerage ?? "(unknown)"}`,
    `City: ${agent.city ?? "(unknown)"}`,
    "",
    "Search results:",
    ...results.slice(0, 10).map((r, i) =>
      `[${i + 1}] ${r.title ?? ""}\n    ${r.link ?? ""}\n    ${r.snippet ?? ""}`,
    ),
  ].join("\n");

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: EXTRACTION_SYSTEM }] },
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      generationConfig: {
        temperature: 0,
        responseMimeType: "application/json",
        responseSchema: EXTRACTION_SCHEMA,
      },
    }),
  });
  if (!resp.ok) {
    throw new Error(`Gemini ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
  }
  const json = await resp.json() as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini returned no text");
  const parsed = JSON.parse(text) as EnrichmentResult;
  return parsed;
}

export async function enrichRealtor(agent: {
  name: string;
  brokerage: string | null;
  city: string | null;
  state: string | null;
}): Promise<EnrichmentResult> {
  const queryParts = [
    `"${agent.name}"`,
    "realtor",
    agent.brokerage ? `"${agent.brokerage}"` : "",
    agent.city ?? "",
    agent.state ?? "",
    "(linkedin.com OR instagram.com OR facebook.com OR zillow.com OR realtor.com)",
  ].filter(Boolean);
  const results = await googleSearch(queryParts.join(" "));
  return await extractWithGemini(
    { name: agent.name, brokerage: agent.brokerage, city: agent.city },
    results,
  );
}
