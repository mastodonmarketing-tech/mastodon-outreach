import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const GEMINI_KEY = Deno.env.get("GEMINI_API_KEY") || "";
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models";

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
- SOCIAL PROOF: Real results, real client names.
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
    const prompt = `ORIGINAL DRAFT:
${row.draft}

REWRITE INSTRUCTIONS FROM ALEX:
${notes}

Revise the post according to these instructions. Keep the same topic and source. Follow all voice, format, and psychology rules.`;

    const models = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash-latest"];
    let geminiData: any;

    for (const model of models) {
      const body = {
        system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 1200,
        },
      };

      const geminiRes = await fetch(`${GEMINI_URL}/${model}:generateContent?key=${GEMINI_KEY}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      geminiData = await geminiRes.json();
      if (geminiRes.ok) break;
      if (geminiRes.status !== 503 && geminiRes.status !== 429) throw new Error(`Gemini error: ${JSON.stringify(geminiData)}`);
      if (model === models[models.length - 1]) throw new Error("All Gemini models unavailable. Try again in a minute.");
    }
    const newDraft = geminiData.candidates[0].content.parts[0].text;

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
