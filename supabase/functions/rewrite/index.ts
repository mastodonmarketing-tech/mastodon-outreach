import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const GEMINI_KEY = Deno.env.get("GEMINI_API_KEY") || "";
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const MIN_POST_WORDS = 180;
const MAX_POST_WORDS = 340;

const SYSTEM_PROMPT = `You are Alex's LinkedIn content strategist for Mastodon Marketing.

Mastodon Marketing has deep experience with construction, real estate, and local service businesses, but Alex's LinkedIn should not only speak to those audiences. Write for business owners, operators, marketing leaders, sales teams, and service teams across industries when the topic is broadly useful.

IDENTITY: You write as Alex, VP of Marketing & Sales at Mastodon Marketing. First person.

TOPIC MIX: Posts cover three pillars:
1. AI IMPLEMENTATION: The priority pillar. How any business can use AI to save time, improve operations, speed up sales/admin work, improve customer service, build internal workflows, and make better decisions. Practical implementation beats AI news or hype.
2. DIGITAL MARKETING: SEO, Google Ads, social media, content strategy, and demand generation for growing businesses. Do not default to local contractors unless the source is contractor-specific.
3. WEBSITE DESIGN + CRO: Conversion rate optimization, landing pages, lead generation, and UX for any business that needs better conversion.

WRITING STYLE:
- 9th-grade reading level. Short sentences. Simple words.
- Group 2-3 related sentences into short paragraphs. Put a blank line between each paragraph.
- Target 220-280 words. Never save a post under 180 words.
- Practical and actionable. Give the reader something they can DO today.
- No em dashes. No corporate speak. No passive voice.
- Conversational and direct.
- CRITICAL: Never use double quotation marks. Use single quotes only if necessary.

MARKETING PSYCHOLOGY:
- HOOK: Pattern interrupt, curiosity gap, or surprising stat in first 2 lines.
- RETENTION: Open loops, storytelling, concrete numbers.
- SOCIAL PROOF: Reference real results with specific numbers when useful. Rotate examples across businesses: agencies, clinics, retailers, B2B teams, franchises, software companies, home service companies, and contractors. Only mention client names occasionally, maybe 1 in 5 posts.
- RECIPROCITY: Give value first.
- CTA: Clear call to action tied to Mastodon Marketing services.

CONTENT RULES:
- Max 2 hashtags at the end.
- AVOID bullet points and lists. Write in flowing sentences, one per line. If you must use a list, use simple numbered steps (1. 2. 3.) with no bold text inside them.
- NEVER use bold (**text**) or italic (*text*) formatting inside the post.
- NEVER use markdown formatting of any kind. Plain text only.
- End with this exact metadata order:
Source: source URL
[IMAGE: detailed image description]

LENGTH: Every post MUST be complete, specific, and at least 180 words before the Source and [IMAGE] lines. A short post is a bad post. Include a concrete example, a practical implementation step, and a clear takeaway. Do not stop mid-thought.

OUTPUT: Return post text only. No preamble. No markdown. Plain text only.`;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function countWords(text: string) {
  return text
    .replace(/\[IMAGE:[\s\S]*?\]/gi, "")
    .replace(/https?:\/\/\S+/g, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function lastContentLine(text: string) {
  const lines = text
    .replace(/\[IMAGE:[\s\S]*?\]/gi, "")
    .split("\n")
    .map(line => line.trim())
    .filter(line =>
      line &&
      !line.toLowerCase().startsWith("source:") &&
      !/^https?:\/\//.test(line) &&
      !line.startsWith("#")
    );
  return lines[lines.length - 1] || "";
}

function draftIssues(text: string) {
  const issues: string[] = [];
  const words = countWords(text);
  if (words < MIN_POST_WORDS) issues.push(`too short at ${words} words`);
  if (words > MAX_POST_WORDS) issues.push(`too long at ${words} words`);
  if (!/\[IMAGE:\s*.+?\]/i.test(text)) issues.push("missing [IMAGE] description");
  const lastLine = lastContentLine(text);
  if (lastLine && !/[.!?]$/.test(lastLine)) issues.push("appears cut off before the metadata");
  return issues;
}

function ensureMetadata(text: string) {
  const sourceMatch = text.match(/Source:\s*(https?:\/\/\S+)/i);
  const sourceLine = sourceMatch ? `\n\nSource: ${sourceMatch[1]}` : "";
  let clean = text
    .replace(/Source:\s*https?:\/\/\S+/gi, "")
    .replace(/\[IMAGE:[\s\S]*?\]/gi, "")
    .trim();
  clean = clean.replace(/\n{3,}/g, "\n\n");
  return `${clean}${sourceLine}\n[IMAGE: A clean modern business workspace showing practical AI, marketing, or website implementation work in progress]`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { draft_id, notes } = await req.json();
    if (!draft_id) throw new Error("draft_id required");
    if (!notes) throw new Error("notes required for rewrite");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Get original draft
    const { data: row, error } = await supabase
      .from("linkedin_drafts")
      .select("draft")
      .eq("id", draft_id)
      .single();

    if (error || !row) throw new Error(`Draft not found: ${error?.message}`);

    // Call Gemini for rewrite
    let prompt = `ORIGINAL DRAFT:
${row.draft}

REWRITE INSTRUCTIONS FROM ALEX:
${notes}

Revise the post according to these instructions. Keep the same topic and source. Follow all voice, format, and psychology rules.
If the topic is about AI implementation, make the advice useful for all businesses, not just contractors or local service businesses.`;

    const body = {
      system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 4096,
      },
    };

    const models = ["gemini-2.5-flash", "gemini-flash-latest", "gemini-2.5-flash-lite"];
    let newDraft = "";
    const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

    let issues: string[] = [];
    for (let qualityAttempt = 0; qualityAttempt < 3; qualityAttempt++) {
      body.contents = [{ role: "user", parts: [{ text: prompt }] }];
      newDraft = "";

      outer: for (const model of models) {
        for (let attempt = 0; attempt < 2; attempt++) {
          if (attempt > 0) await wait(5000);
          try {
            const geminiRes = await fetch(`${GEMINI_URL}/${model}:generateContent?key=${GEMINI_KEY}`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            });
            const geminiData = await geminiRes.json();
            if (geminiRes.ok) {
              newDraft = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || "";
              if (newDraft) break outer;
            }
            if (geminiRes.status !== 503 && geminiRes.status !== 429 && geminiRes.status !== 404) {
              throw new Error(`Gemini error: ${JSON.stringify(geminiData).substring(0, 200)}`);
            }
          } catch (e) {
            if ((e as Error).message.startsWith("Gemini error")) throw e;
          }
        }
      }

      if (!newDraft) throw new Error("All Gemini models unavailable. Wait a minute and try again.");
      newDraft = ensureMetadata(newDraft);
      issues = draftIssues(newDraft);
      if (!issues.length) break;

      prompt = `The previous rewrite failed these checks: ${issues.join(", ")}.

Rewrite it as a complete LinkedIn post.
Keep Alex's requested changes, the same topic, and the same source.
Target 240-300 words before metadata.
Use 7-9 short paragraphs.
Each paragraph must add a new useful idea, example, or implementation step.
Do not stop mid-thought.

Previous rewrite:
${newDraft}`;
    }
    if (issues.length) throw new Error(`Rewrite failed quality checks: ${issues.join(", ")}`);

    // Update draft in Supabase
    const { error: updateErr } = await supabase
      .from("linkedin_drafts")
      .update({ draft: newDraft, status: "Pending Review", notes: notes })
      .eq("id", draft_id);

    if (updateErr) throw new Error(`Update failed: ${updateErr.message}`);

    return new Response(JSON.stringify({ ok: true, draft: newDraft }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
