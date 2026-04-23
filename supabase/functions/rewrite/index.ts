import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildSocialGraphicPng } from "../_shared/social-graphic.ts";
import {
  cancelOutstandPost,
  createOutstandPost,
  isOutstandConfigured,
} from "../_shared/outstand.ts";

const GEMINI_KEY = Deno.env.get("GEMINI_API_KEY") || "";
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const MIN_POST_WORDS = 180;
const MAX_POST_WORDS = 340;
const BANNED_PHRASES = [
  "identify one repetitive task that takes up too much time each week",
  "one repetitive task that takes up too much time each week",
  "where do people spend too much time on routine work",
];
const BANNED_PATTERNS = [
  { label: "generic one-workflow time-drain CTA", pattern: /\bone workflow\b[\s\S]{0,120}\btime drain\b/i },
  { label: "generic one-task time-drain CTA", pattern: /\bone task\b[\s\S]{0,120}\btime drain\b/i },
  { label: "generic too-much-time-each-week CTA", pattern: /\btoo much time\b[\s\S]{0,80}\beach week\b/i },
];

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
- CTA VARIETY: Do not end posts with the same homework-style prompt. Never write 'Identify one repetitive task that takes up too much time each week' or any close variation like 'one workflow that feels like a time drain.' Rotate endings across audit offers, strategic questions, observation-based takeaways, diagnostic prompts, and soft invitations to talk through an implementation plan.

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
  const lower = text.toLowerCase();
  if (words < MIN_POST_WORDS) issues.push(`too short at ${words} words`);
  if (words > MAX_POST_WORDS) issues.push(`too long at ${words} words`);
  if (!/\[IMAGE:\s*.+?\]/i.test(text)) issues.push("missing [IMAGE] description");
  for (const phrase of BANNED_PHRASES) {
    if (lower.includes(phrase)) issues.push(`uses repetitive banned phrase: ${phrase}`);
  }
  for (const item of BANNED_PATTERNS) {
    if (item.pattern.test(text)) issues.push(`uses repetitive banned pattern: ${item.label}`);
  }
  const lastLine = lastContentLine(text);
  if (lastLine && !/[.!?]$/.test(lastLine)) issues.push("appears cut off before the metadata");
  return issues;
}

function safeParseJson(s: string) {
  let c = s.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  try { return JSON.parse(c); } catch {}
  const match = c.match(/\{[\s\S]*\}/);
  if (match) c = match[0];
  try { return JSON.parse(c); } catch {}
  c = c.replace(/[\r\n]+/g, ' ').replace(/\t/g, ' ');
  try { return JSON.parse(c); } catch (e) {
    throw new Error(`JSON parse failed: ${(e as Error).message}\nRaw: ${s.substring(0, 200)}`);
  }
}

function ensureMetadata(text: string, imageDescription: string, fallbackSource = "") {
  const sourceMatch = text.match(/Source:\s*(https?:\/\/\S+)/i);
  const source = sourceMatch?.[1] || fallbackSource;
  const sourceLine = source ? `\n\nSource: ${source}` : "";
  let clean = text
    .replace(/Source:\s*https?:\/\/\S+/gi, "")
    .replace(/\[IMAGE:[\s\S]*?\]/gi, "")
    .trim();
  clean = clean.replace(/\n{3,}/g, "\n\n");
  return `${clean}${sourceLine}\n[IMAGE: ${imageDescription}]`;
}

function createImageDescription(post: string, topic: string, pillar: string) {
  const cleanLines = post
    .replace(/\[IMAGE:[\s\S]*?\]/gi, "")
    .replace(/Source:\s*https?:\/\/\S+/gi, "")
    .split("\n")
    .map(line => line.trim())
    .filter(line => line && !line.startsWith("#"));
  const hook = cleanLines[0] || topic;
  const detail = cleanLines.find(line => /\d|AI|sales|lead|customer|website|content|workflow|automation|traffic|conversion/i.test(line)) || cleanLines[1] || topic;
  const pillarContext: Record<string, string> = {
    AI: "AI workflow automation, business operations, sales or customer-service handoffs, human review checkpoints, dashboard cards, connected nodes, and process arrows",
    MARKETING: "search visibility, content strategy, customer research, analytics, demand generation, funnel shapes, channel icons, and campaign cards",
    CRO: "website conversion paths, landing-page decisions, user behavior, lead capture, wireframe blocks, click paths, and conversion funnels",
    CONTRACTOR: "business growth systems for construction or home-service teams, using clean process diagrams and CRM-style cards without jobsite cliches",
  };
  return `A designed LinkedIn social media graphic visualizing this post's core idea: ${hook} ${detail} Use a clean 16:9 social-post graphic style with bold composition, simple symbolic shapes, icon-like elements, layered cards, arrows, and visual hierarchy around ${pillarContext[pillar] || "business strategy, practical workflows, and decision-making"}. Make it feel like a polished brand graphic, not an editorial photo or stock image. Text-free design only: no readable words, letters, numbers, labels, logos, screenshots, or charts with labels. Do not render the topic words into the image. Use abstract lines and blocks anywhere text would normally appear.`;
}

function hashText(value: string) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createFirstComment(post: string, topic: string, pillar: string) {
  const clean = post
    .replace(/\[IMAGE:[\s\S]*?\]/gi, "")
    .replace(/Source:\s*https?:\/\/\S+/gi, "")
    .replace(/#[A-Za-z0-9_]+/g, "")
    .trim();
  const pillarKey = pillar.toLowerCase();
  const lower = `${topic} ${clean}`.toLowerCase();
  const options = pillarKey.includes("ai") ? [
    "The strongest AI pilots usually start with the outcome, the data source, and the human review step.",
    "AI gets a lot more practical when it is attached to a real handoff your team already owns.",
    "The tool matters less than the workflow you design around it.",
  ] : pillarKey.includes("cro") || /landing|website|conversion|lead|page/.test(lower) ? [
    "Small conversion wins usually come from removing one point of friction, not redesigning the whole site.",
    "The useful question is not 'does the page look good?' It is 'does the next step feel obvious?'",
    "A better landing page usually makes the decision easier before it asks for the form fill.",
  ] : pillarKey.includes("marketing") || /marketing|seo|google|content|ad|campaign|search|social/.test(lower) ? [
    "The best marketing systems make the next decision clearer, not just the report prettier.",
    "Visibility is only useful when it turns into a cleaner path from attention to action.",
    "Good campaigns get easier to scale when the message, audience, and follow-up all match.",
  ] : [
    "The strongest AI pilots usually start with the outcome, the data source, and the human review step.",
    "AI gets a lot more practical when it is attached to a real handoff your team already owns.",
    "The tool matters less than the workflow you design around it.",
  ];
  return options[hashText(`${topic}\n${clean}`) % options.length];
}

async function generatePostImage(supabase: any, draft: string, topic: string, pillar: string) {
  try {
    const fileName = `post-${Date.now()}.png`;
    const bytes = buildSocialGraphicPng(draft, topic, pillar);
    const { error: uploadErr } = await supabase.storage
      .from("post-images")
      .upload(fileName, bytes, { contentType: "image/png", upsert: true });
    if (uploadErr) return "";

    const { data: urlData } = supabase.storage.from("post-images").getPublicUrl(fileName);
    return urlData.publicUrl || "";
  } catch (imgErr) {
    console.error("Social graphic generation failed:", (imgErr as Error).message);
    return "";
  }
}

async function resyncScheduledOutstand(
  draftId: number,
  row: any,
  draft: string,
  imageUrl: string,
  firstComment: string,
) {
  const isScheduled = String(row.status || "").toLowerCase().includes("scheduled") && row.scheduled_for;
  if (!isScheduled || !isOutstandConfigured()) return {};

  if (row.outstand_post_id) {
    try {
      await cancelOutstandPost(row.outstand_post_id);
    } catch (err) {
      console.error(`Outstand cancel failed for ${draftId}: ${(err as Error).message}`);
    }
  }

  const outstand = await createOutstandPost({
    post: draft,
    imageUrl,
    firstComment,
    scheduledAt: row.scheduled_for,
  });

  return {
    publishing_provider: "outstand",
    outstand_post_id: outstand.id,
    outstand_status: outstand.status,
    outstand_error: null,
    platform_post_id: outstand.platformPostId || null,
    submitted_at: new Date().toISOString(),
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { draft_id, notes, action, draft, first_comment } = await req.json();
    if (!draft_id) throw new Error("draft_id required");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Get original draft
    const { data: row, error } = await supabase
      .from("linkedin_drafts")
      .select("draft, topic, bucket, image_url, status, source_url, first_comment, scheduled_for, outstand_post_id")
      .eq("id", draft_id)
      .single();

    if (error || !row) throw new Error(`Draft not found: ${error?.message}`);

    if (action === "edit") {
      if (!draft) throw new Error("draft required for edit");
      const imageDescription = createImageDescription(draft, row.topic || "", row.bucket || "");
      const editedDraft = ensureMetadata(draft, imageDescription, row.source_url || "");
      const issues = draftIssues(editedDraft);
      if (issues.length) throw new Error(`Edited draft failed quality checks: ${issues.join(", ")}`);
      const nextFirstComment = typeof first_comment === "string" && first_comment.trim()
        ? first_comment.trim()
        : row.first_comment || createFirstComment(editedDraft, row.topic || "", row.bucket || "");
      const outstandFields = await resyncScheduledOutstand(
        draft_id,
        row,
        editedDraft,
        row.image_url || "",
        nextFirstComment,
      );

      const { error: updateErr } = await supabase
        .from("linkedin_drafts")
        .update({ draft: editedDraft, first_comment: nextFirstComment, ...outstandFields })
        .eq("id", draft_id);
      if (updateErr) throw new Error(`Update failed: ${updateErr.message}`);

      return new Response(JSON.stringify({ ok: true, draft: editedDraft }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "regenerate_image") {
      const imageUrl = await generatePostImage(supabase, row.draft, row.topic || "", row.bucket || "");
      if (!imageUrl) throw new Error("Image generation failed");
      const outstandFields = await resyncScheduledOutstand(
        draft_id,
        row,
        row.draft,
        imageUrl,
        row.first_comment || "",
      );

      const { error: updateErr } = await supabase
        .from("linkedin_drafts")
        .update({ image_url: imageUrl, ...outstandFields })
        .eq("id", draft_id);
      if (updateErr) throw new Error(`Update failed: ${updateErr.message}`);

      return new Response(JSON.stringify({ ok: true, image_url: imageUrl }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!notes) throw new Error("notes required for rewrite");

    // Call Gemini for rewrite
    let prompt = `ORIGINAL DRAFT:
${row.draft}

REWRITE INSTRUCTIONS FROM ALEX:
${notes}

Revise the post according to these instructions. Keep the same topic and source. Follow all voice, format, and psychology rules.
If the topic is about AI implementation, make the advice useful for all businesses, not just contractors or local service businesses.
Do not use the repetitive ending 'Identify one repetitive task that takes up too much time each week.' Choose a more specific ending tied to this topic instead.`;

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
      const imageDescription = createImageDescription(newDraft, row.topic || "", row.bucket || "");
      newDraft = ensureMetadata(newDraft, imageDescription, row.source_url || "");
      issues = draftIssues(newDraft);
      if (!issues.length) break;

      prompt = `The previous rewrite failed these checks: ${issues.join(", ")}.

Rewrite it as a complete LinkedIn post.
Keep Alex's requested changes, the same topic, and the same source.
Target 240-300 words before metadata.
Use 7-9 short paragraphs.
Each paragraph must add a new useful idea, example, or implementation step.
Do not stop mid-thought.
Do not use the repetitive ending 'Identify one repetitive task that takes up too much time each week.' Use a fresh topic-specific CTA or takeaway.

Previous rewrite:
${newDraft}`;
    }
    if (issues.length) throw new Error(`Rewrite failed quality checks: ${issues.join(", ")}`);

    const imageUrl = await generatePostImage(supabase, newDraft, row.topic || "", row.bucket || "");
    const nextFirstComment = createFirstComment(newDraft, row.topic || "", row.bucket || "");
    const outstandFields = await resyncScheduledOutstand(
      draft_id,
      row,
      newDraft,
      imageUrl || row.image_url || "",
      nextFirstComment,
    );

    // Update draft in Supabase
    const { error: updateErr } = await supabase
      .from("linkedin_drafts")
      .update({ draft: newDraft, status: row.status || "Pending Review", notes: notes, image_url: imageUrl || row.image_url || null, first_comment: nextFirstComment, ...outstandFields })
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
