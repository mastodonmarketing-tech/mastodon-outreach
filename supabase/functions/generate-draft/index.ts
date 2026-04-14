import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const GEMINI_KEY = Deno.env.get("GEMINI_API_KEY") || "";
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models";

const RSS_FEEDS = [
  "https://news.google.com/rss/search?q=contractor+marketing+digital&hl=en-US",
  "https://news.google.com/rss/search?q=local+SEO+Google+algorithm+update&hl=en-US",
  "https://news.google.com/rss/search?q=restoration+construction+industry+news&hl=en-US",
  "https://news.google.com/rss/search?q=Google+Ads+local+business+marketing&hl=en-US",
];

const SYSTEM_PROMPT = `You are Alex's LinkedIn content strategist for Mastodon Marketing, a Houston-based digital marketing agency specializing in construction, real estate, and local service businesses.

IDENTITY: You write as Alex, VP of Marketing & Sales at Mastodon Marketing. First person.

WRITING STYLE:
- 9th-grade reading level. Short sentences. Simple words.
- Every sentence gets its own line with a blank line between sentences.
- Practical and actionable. Give the reader something they can DO today.
- No em dashes. No corporate speak. No passive voice.
- Conversational and direct.
- CRITICAL: Never use double quotation marks. Use single quotes only if necessary.

MARKETING PSYCHOLOGY:
- HOOK: Pattern interrupt, curiosity gap, or surprising stat in first 2 lines.
- RETENTION: Open loops, storytelling, concrete numbers.
- SOCIAL PROOF: Real results, real client names (RJT Construction, 911 Restoration of Tampa, etc.).
- RECIPROCITY: Give value first.
- CTA: Clear call to action tied to Mastodon Marketing services.

CONTENT RULES:
- Max 2 hashtags at the end.
- Max 5 bullet points.
- Include source URL at end if referencing an article.
- Include [IMAGE: description] at the end.

OUTPUT: Return post text only. No preamble.`;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function fetchRSS(url: string): Promise<string[]> {
  try {
    const res = await fetch(url);
    const xml = await res.text();
    const items: string[] = [];
    const titleMatches = xml.matchAll(/<item>[\s\S]*?<title>([\s\S]*?)<\/title>[\s\S]*?<link>([\s\S]*?)<\/link>[\s\S]*?<\/item>/g);
    for (const m of titleMatches) {
      items.push(`HEADLINE: ${m[1].replace(/<!\[CDATA\[|\]\]>/g, "")} | URL: ${m[2].replace(/<!\[CDATA\[|\]\]>/g, "")}`);
      if (items.length >= 5) break;
    }
    return items;
  } catch {
    return [];
  }
}

const FALLBACK_MODELS = ["gemini-2.5-flash", "gemini-2.0-flash-lite", "gemini-2.0-flash"];

async function callGemini(model: string, prompt: string, systemPrompt?: string, jsonMode = false) {
  const models = model === "gemini-2.5-flash" ? FALLBACK_MODELS : [model];

  for (const m of models) {
    const body: any = {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: jsonMode ? 0.3 : 0.8,
        maxOutputTokens: jsonMode ? 1000 : 1200,
      },
    };
    // Only use JSON mode on models that support it well
    if (jsonMode && m.includes("2.5")) body.generationConfig.responseMimeType = "application/json";
    if (systemPrompt) body.system_instruction = { parts: [{ text: systemPrompt }] };

    const res = await fetch(`${GEMINI_URL}/${m}:generateContent?key=${GEMINI_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (res.ok) return data.candidates[0].content.parts[0].text;
    if (res.status !== 503 && res.status !== 429) throw new Error(`Gemini ${res.status}: ${JSON.stringify(data)}`);
  }
  throw new Error("All Gemini models unavailable. Try again in a minute.");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    // 1. Fetch RSS
    const allItems: string[] = [];
    for (const url of RSS_FEEDS) {
      const items = await fetchRSS(url);
      allItems.push(...items);
    }
    if (allItems.length === 0) throw new Error("No RSS items found");
    const rssText = allItems.join("\n");

    // 2. Intelligence - pick topic
    const intelligencePrompt = `You are a content intelligence system for Mastodon Marketing, a digital marketing agency specializing in construction, real estate, and local service businesses.

Score each item and select the SINGLE BEST to post about. Do not use double quotation marks in any text values.

OUTPUT FORMAT: Valid JSON only.
{"selected_item":{"topic":"","source":"","bucket":"","urgency":0,"angle":"","hook_ideas":["","",""]}}

NEWS ITEMS:
${rssText}`;

    const intelligenceRaw = await callGemini("gemini-2.5-flash", intelligencePrompt, undefined, true);
    const safeParseJson = (s: string) => {
      // Strip markdown fences
      let c = s.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      try { return JSON.parse(c); } catch {}
      // Extract JSON object
      const match = c.match(/\{[\s\S]*\}/);
      if (match) c = match[0];
      try { return JSON.parse(c); } catch {}
      // Last resort: fix common issues
      c = c.replace(/[\r\n]+/g, ' ').replace(/\t/g, ' ');
      try { return JSON.parse(c); } catch (e) {
        throw new Error(`JSON parse failed: ${(e as Error).message}\nRaw: ${s.substring(0, 200)}`);
      }
    };
    const intelligence = safeParseJson(intelligenceRaw);
    const item = intelligence.selected_item;

    // 3. Generate draft
    const draftPrompt = `CONTENT BUCKET: ${item.bucket}
TOPIC: ${item.topic}
SOURCE URL: ${item.source}
ANGLE: ${item.angle}

Write a LinkedIn post for Mastodon Marketing following all voice, format, and psychology rules. Include the source URL at the end.`;

    const draft = await callGemini("gemini-2.5-flash", draftPrompt, SYSTEM_PROMPT);

    // 4. QC score
    const qcPrompt = `Score this LinkedIn draft on 7 dimensions (1-10):
1. HOOK_QUALITY (20%) 2. ACTIONABLE_VALUE (25%) 3. READABILITY (15%)
4. PSYCHOLOGY_EFFECTIVENESS (15%) 5. CTA_STRENGTH (10%) 6. ICP_PRECISION (10%) 7. SOURCE_AND_IMAGE (5%)

Do not use double quotation marks in feedback text.
Return JSON: {"weighted_average":0,"verdict":"PASS","feedback":"..."}

POST TO SCORE:
${draft}`;

    const qcRaw = await callGemini("gemini-2.5-flash", qcPrompt, undefined, true);
    const qc = safeParseJson(qcRaw);

    // 5. Insert into Supabase
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: row, error } = await supabase.from("linkedin_drafts").insert({
      topic: item.topic,
      source_url: item.source,
      bucket: item.bucket,
      urgency: item.urgency,
      draft: draft,
      qc_score: qc.weighted_average,
      qc_verdict: qc.verdict,
      qc_feedback: qc.feedback,
      status: "Pending Review",
    }).select("id").single();

    if (error) throw new Error(`Supabase insert: ${error.message}`);

    return new Response(JSON.stringify({ ok: true, draft_id: row.id, qc_score: qc.weighted_average }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
