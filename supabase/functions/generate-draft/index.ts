import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { decode as base64Decode } from "https://deno.land/std@0.168.0/encoding/base64.ts";

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
- SOCIAL PROOF: Reference real results with specific numbers. Only mention client names like RJT Construction or 911 Restoration of Tampa occasionally, maybe 1 in every 5 posts. Most posts should use anonymous examples like 'one roofing company' or 'a GC we work with'.
- RECIPROCITY: Give value first.
- CTA: Clear call to action tied to Mastodon Marketing services.

CONTENT RULES:
- Max 2 hashtags at the end.
- AVOID bullet points and lists. Write in flowing sentences, one per line. If you must use a list, use simple numbered steps (1. 2. 3.) with no bold text inside them.
- NEVER use bold (**text**) or italic (*text*) formatting inside the post.
- NEVER use markdown formatting of any kind. Plain text only.
- Include source URL at end if referencing an article.
- Include [IMAGE: description] at the end.

LENGTH: Every post MUST be at least 150 words and ideally 200-250 words. A short post is a bad post. Include enough detail, examples, and actionable steps to fill a full LinkedIn post. Do not stop early.

OUTPUT: Return post text only. No preamble. No markdown. Plain text only.`;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface RSSItem { title: string; url: string; }

async function fetchRSS(url: string): Promise<RSSItem[]> {
  try {
    const res = await fetch(url);
    const xml = await res.text();
    const items: RSSItem[] = [];
    const matches = xml.matchAll(/<item>[\s\S]*?<title>([\s\S]*?)<\/title>[\s\S]*?<link>([\s\S]*?)<\/link>[\s\S]*?<\/item>/g);
    for (const m of matches) {
      items.push({
        title: m[1].replace(/<!\[CDATA\[|\]\]>/g, "").trim(),
        url: m[2].replace(/<!\[CDATA\[|\]\]>/g, "").trim()
      });
      if (items.length >= 5) break;
    }
    return items;
  } catch {
    return [];
  }
}

const MODELS = ["gemini-2.5-flash", "gemini-flash-latest", "gemini-2.5-flash-lite"];

async function callGemini(model: string, prompt: string, systemPrompt?: string, jsonMode = false) {
  const models = MODELS;
  const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

  for (const m of models) {
    const body: any = {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: jsonMode ? 0.3 : 0.8,
        maxOutputTokens: jsonMode ? 2000 : 4096,
      },
    };
    if (jsonMode && m.includes("2.5-flash") && !m.includes("lite")) body.generationConfig.responseMimeType = "application/json";
    if (systemPrompt) body.system_instruction = { parts: [{ text: systemPrompt }] };

    // Try each model twice
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) await wait(5000);
      try {
        const res = await fetch(`${GEMINI_URL}/${m}:generateContent?key=${GEMINI_KEY}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (res.ok) {
          const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) return text;
        }
        if (res.status !== 503 && res.status !== 429 && res.status !== 404) {
          throw new Error(`Gemini ${res.status}: ${JSON.stringify(data).substring(0, 200)}`);
        }
      } catch (e) {
        if ((e as Error).message.startsWith("Gemini")) throw e;
      }
    }
  }
  throw new Error("All Gemini models unavailable. Wait a minute and try again.");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    // 1. Fetch RSS
    const allRSS: RSSItem[] = [];
    for (const url of RSS_FEEDS) {
      const items = await fetchRSS(url);
      allRSS.push(...items);
    }
    if (allRSS.length === 0) throw new Error("No RSS items found");

    // Get existing topics to avoid duplicates
    const supabaseForQuery = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    const { data: existing } = await supabaseForQuery
      .from("linkedin_drafts")
      .select("topic")
      .order("created_at", { ascending: false })
      .limit(20);
    const usedTopics = (existing || []).map((r: any) => r.topic?.toLowerCase()).filter(Boolean);

    // Filter out headlines similar to existing topics
    const freshRSS = allRSS.filter(item =>
      !usedTopics.some(t => item.title.toLowerCase().includes(t.substring(0, 20)) || t.includes(item.title.toLowerCase().substring(0, 20)))
    );
    const rssToUse = freshRSS.length > 0 ? freshRSS : allRSS;

    // Build numbered list of headlines only (no URLs - they break JSON)
    const headlineList = rssToUse.map((item, i) => `${i + 1}. ${item.title}`).join("\n");

    // 2. Intelligence - pick topic by number
    const intelligencePrompt = `Pick the best headline number for a contractor marketing LinkedIn post. Pick something DIFFERENT each time.
Return ONLY this JSON, keep ALL values under 10 words: {"pick":1,"topic":"short","bucket":"GROWTH","urgency":5,"angle":"short"}

${headlineList}`;

    const intelligenceRaw = await callGemini("gemini-2.5-flash", intelligencePrompt, undefined, true);
    const safeParseJson = (s: string) => {
      let c = s.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      try { return JSON.parse(c); } catch {}
      const match = c.match(/\{[\s\S]*\}/);
      if (match) c = match[0];
      try { return JSON.parse(c); } catch {}
      c = c.replace(/[\r\n]+/g, ' ').replace(/\t/g, ' ');
      try { return JSON.parse(c); } catch (e) {
        throw new Error(`JSON parse failed: ${(e as Error).message}\nRaw: ${s.substring(0, 200)}`);
      }
    };
    const intelligence = safeParseJson(intelligenceRaw);
    const pickIndex = (intelligence.pick || 1) - 1;
    const pickedRSS = rssToUse[Math.min(pickIndex, rssToUse.length - 1)];
    const item = { ...intelligence, source: pickedRSS.url, topic: pickedRSS.title };

    // 3. Learn from past rewrites
    const { data: pastRewrites } = await supabaseForQuery
      .from("linkedin_drafts")
      .select("notes")
      .not("notes", "is", null)
      .neq("notes", "")
      .order("created_at", { ascending: false })
      .limit(15);

    let learnedStyle = "";
    if (pastRewrites && pastRewrites.length > 0) {
      const uniqueNotes = [...new Set(pastRewrites.map((r: any) => r.notes.trim()))];
      learnedStyle = `\n\nSTYLE LESSONS FROM PAST FEEDBACK (follow these closely):\n${uniqueNotes.map((n, i) => `${i+1}. ${n}`).join("\n")}`;
    }

    // 4. Generate draft
    const draftPrompt = `CONTENT BUCKET: ${item.bucket}
TOPIC: ${item.topic}
SOURCE URL: ${item.source}
ANGLE: ${item.angle}

Write a LinkedIn post for Mastodon Marketing following all voice, format, and psychology rules. Include the source URL at the end.`;

    const draft = await callGemini("gemini-2.5-flash", draftPrompt, SYSTEM_PROMPT + learnedStyle);

    // 4. QC score
    const qcPrompt = `Rate this post 1-10. Return ONLY: {"weighted_average":7,"verdict":"PASS","feedback":"max 15 words"}

${draft}`;

    const qcRaw = await callGemini("gemini-2.5-flash", qcPrompt, undefined, true);
    const qc = safeParseJson(qcRaw);

    // 5. Generate image from [IMAGE: ...] description
    let imageUrl = "";
    const imageMatch = draft.match(/\[IMAGE:\s*(.+?)\]/i);
    if (imageMatch) {
      try {
        const imagePrompt = imageMatch[1].trim();
        const imgRes = await fetch(`${GEMINI_URL}/imagen-4.0-generate-001:predict?key=${GEMINI_KEY}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            instances: [{ prompt: `Professional LinkedIn post image: ${imagePrompt}. Clean, modern, business-appropriate, high quality photography style.` }],
            parameters: { sampleCount: 1, aspectRatio: "16:9" }
          }),
        });
        const imgData = await imgRes.json();
        if (imgRes.ok && imgData.predictions?.[0]?.bytesBase64Encoded) {
          const imageBytes = imgData.predictions[0].bytesBase64Encoded;
          const fileName = `post-${Date.now()}.png`;

          const supabaseStorage = createClient(
            Deno.env.get("SUPABASE_URL")!,
            Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
          );

          // Decode base64 to Uint8Array using Deno standard library
          const bytes = base64Decode(imageBytes);

          const { error: uploadErr } = await supabaseStorage.storage
            .from("post-images")
            .upload(fileName, bytes, { contentType: "image/png", upsert: true });

          if (!uploadErr) {
            const { data: urlData } = supabaseStorage.storage
              .from("post-images")
              .getPublicUrl(fileName);
            imageUrl = urlData.publicUrl;
          }
        }
      } catch (imgErr) {
        console.error("Image generation failed:", (imgErr as Error).message);
        // Continue without image - not a blocker
      }
    } else {
      console.log("No [IMAGE: ...] found in draft");
    }
    }

    // 6. Insert into Supabase
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
      image_url: imageUrl || null,
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
