import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { decode as base64Decode } from "https://deno.land/std@0.168.0/encoding/base64.ts";

const GEMINI_KEY = Deno.env.get("GEMINI_API_KEY") || "";
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const OPENAI_KEY = Deno.env.get("OPEN_AI_AI_KEY") || "";
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

const RSS_FEEDS = [
  // AI implementation for all businesses
  { pillar: "AI", url: "https://news.google.com/rss/search?q=AI+implementation+business+automation+operations&hl=en-US" },
  { pillar: "AI", url: "https://news.google.com/rss/search?q=artificial+intelligence+business+operations+ROI&hl=en-US" },
  { pillar: "AI", url: "https://news.google.com/rss/search?q=AI+workflow+automation+small+business&hl=en-US" },
  { pillar: "AI", url: "https://news.google.com/rss/search?q=AI+tools+sales+customer+service+business&hl=en-US" },
  { pillar: "AI", url: "https://news.google.com/rss/search?q=AI+implementation+marketing+teams+business&hl=en-US" },
  // Digital marketing
  { pillar: "MARKETING", url: "https://news.google.com/rss/search?q=digital+marketing+trends+business+growth&hl=en-US" },
  { pillar: "MARKETING", url: "https://news.google.com/rss/search?q=Google+Ads+SEO+algorithm+update+business&hl=en-US" },
  // Website design + CRO
  { pillar: "CRO", url: "https://news.google.com/rss/search?q=website+conversion+rate+optimization+design&hl=en-US" },
  { pillar: "CRO", url: "https://news.google.com/rss/search?q=landing+page+optimization+lead+generation&hl=en-US" },
  // Contractor/local service work stays in the mix, but no longer dominates it
  { pillar: "CONTRACTOR", url: "https://news.google.com/rss/search?q=contractor+marketing+construction+industry&hl=en-US" },
];

const SYSTEM_PROMPT = `You are Alex's LinkedIn content strategist for Mastodon Marketing.

Mastodon Marketing has deep experience with construction, real estate, and local service businesses, but Alex's LinkedIn should not only speak to those audiences. Write for business owners, operators, marketing leaders, sales teams, and service teams across industries when the topic is broadly useful.

IDENTITY: You write as Alex, VP of Marketing & Sales at Mastodon Marketing. First person.

TOPIC MIX:
1. AI IMPLEMENTATION: This is the priority pillar. Write about how any business can use AI to save time, improve operations, speed up sales/admin work, improve customer service, build internal workflows, and make better decisions. Practical implementation beats AI news or hype.
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
- SOCIAL PROOF: Reference real results with specific numbers when useful. Rotate examples across businesses: agencies, clinics, retailers, B2B teams, franchises, software companies, home service companies, and contractors. Only mention client names like RJT Construction or 911 Restoration of Tampa occasionally, maybe 1 in every 5 posts.
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

interface RSSFeed { pillar: string; url: string; }
interface RSSItem { title: string; url: string; pillar: string; }

async function fetchRSS(feed: RSSFeed): Promise<RSSItem[]> {
  try {
    const res = await fetch(feed.url);
    const xml = await res.text();
    const items: RSSItem[] = [];
    const matches = xml.matchAll(/<item>[\s\S]*?<title>([\s\S]*?)<\/title>[\s\S]*?<link>([\s\S]*?)<\/link>[\s\S]*?<\/item>/g);
    for (const m of matches) {
      items.push({
        title: m[1].replace(/<!\[CDATA\[|\]\]>/g, "").trim(),
        url: m[2].replace(/<!\[CDATA\[|\]\]>/g, "").trim(),
        pillar: feed.pillar
      });
      if (items.length >= 5) break;
    }
    return items;
  } catch {
    return [];
  }
}

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
  if (!/Source:\s*https?:\/\/\S+/i.test(text)) issues.push("missing Source line");
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

function ensureMetadata(text: string, source: string, imageDescription: string) {
  let clean = text
    .replace(/Source:\s*https?:\/\/\S+/gi, "")
    .replace(/\[IMAGE:[\s\S]*?\]/gi, "")
    .trim();
  clean = clean.replace(/\n{3,}/g, "\n\n");
  return `${clean}\n\nSource: ${source}\n[IMAGE: ${imageDescription}]`;
}

function normalizePillar(value = "") {
  const v = value.toLowerCase();
  if (v.includes("ai") || v.includes("automation") || v.includes("artificial intelligence")) return "AI";
  if (v.includes("cro") || v.includes("website") || v.includes("landing") || v.includes("conversion")) return "CRO";
  if (v.includes("marketing") || v.includes("seo") || v.includes("google ads")) return "MARKETING";
  if (v.includes("contractor") || v.includes("construction")) return "CONTRACTOR";
  return "MARKETING";
}

function chooseTargetPillar(recent: any[]) {
  const recentPillars = recent.map((r: any) => normalizePillar(`${r.bucket || ""} ${r.topic || ""}`));
  const lastSix = recentPillars.slice(0, 6);
  const aiCount = lastSix.filter(p => p === "AI").length;
  if (lastSix.length < 6 || aiCount < 4) return "AI";
  if (lastSix[0] === "AI" && lastSix[1] === "AI") {
    const croCount = lastSix.filter(p => p === "CRO").length;
    const marketingCount = lastSix.filter(p => p === "MARKETING").length;
    return croCount <= marketingCount ? "CRO" : "MARKETING";
  }
  return "AI";
}

const MODELS = ["gemini-2.5-flash", "gemini-flash-latest", "gemini-2.5-flash-lite"];

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

function createImageDescription(post: string, topic: string, pillar: string) {
  const cleanLines = post
    .replace(/\[IMAGE:[\s\S]*?\]/gi, "")
    .replace(/Source:\s*https?:\/\/\S+/gi, "")
    .split("\n")
    .map(line => line.trim())
    .filter(line => line && !line.startsWith("#"));
  const hook = (cleanLines[0] || topic).split(/[.!?]/)[0].trim().split(" ").slice(0, 8).join(" ");
  const allVisuals = [
    "a sleek smartphone floating at an angle with glowing app notifications bursting out of the screen",
    "a massive glowing power button hovering above a reflective surface with purple energy radiating from it",
    "a 3D chess piece (king) made of glass standing on a digital grid board with strategic path lines",
    "a rocket ship mid-launch with a purple exhaust trail curving upward against a starfield",
    "a giant glowing lightbulb with miniature city buildings and factories visible inside it",
    "a pair of hands cupping a floating holographic globe with data streams orbiting around it",
    "a row of dominoes mid-fall with the last one transforming into a golden trophy",
    "a massive lock being unlocked by a glowing key, with light pouring through the keyhole",
    "a compass with a glowing needle pointing toward a dollar sign on a dark terrain map",
    "a laptop with a giant magnet pulling in glowing lead icons and contact cards",
    "a stopwatch frozen mid-tick with lightning bolts radiating outward showing speed",
    "a stack of glowing building blocks assembling themselves into a skyscraper shape",
    "a telescope pointed at a sky full of floating opportunity icons like charts, targets, and money",
    "a conveyor belt transforming raw materials into polished gold bars in a modern factory",
    "a dashboard steering wheel with a holographic heads-up display showing business metrics",
    "a giant switch being flipped from OFF to ON with sparks and energy bursting outward",
    "a parachute carrying a gift box descending through clouds toward a crowd of tiny people below",
    "a bridge being built in real-time with glowing sections connecting two cliff edges",
    "a vault door swinging open to reveal shelves of glowing strategy playbooks inside",
    "a conductor's baton directing an orchestra of floating business tool icons in harmony",
  ];
  const visual = allVisuals[Math.floor(Math.random() * allVisuals.length)];
  return JSON.stringify({ hook, visual });
}

function createFirstComment(post: string, topic: string, pillar: string) {
  return "Interested in working with me? Take a short survey to see if we're a good fit. https://connect.mastodonmarketing.com/";
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    // 1. Fetch RSS
    const allRSS: RSSItem[] = [];
    for (const feed of RSS_FEEDS) {
      const items = await fetchRSS(feed);
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
      .select("topic,bucket,draft")
      .order("created_at", { ascending: false })
      .limit(20);
    const usedTopics = (existing || []).map((r: any) => r.topic?.toLowerCase()).filter(Boolean);
    const targetPillar = chooseTargetPillar(existing || []);

    // Filter out headlines similar to existing topics
    const freshRSS = allRSS.filter(item =>
      !usedTopics.some(t => item.title.toLowerCase().includes(t.substring(0, 20)) || t.includes(item.title.toLowerCase().substring(0, 20)))
    );
    const candidateRSS = freshRSS.length > 0 ? freshRSS : allRSS;
    const pillarRSS = candidateRSS.filter(item => item.pillar === targetPillar);
    const rssToUse = pillarRSS.length > 0 ? pillarRSS : candidateRSS;

    // Build numbered list of headlines only (no URLs - they break JSON)
    const headlineList = rssToUse.map((item, i) => `${i + 1}. [${item.pillar}] ${item.title}`).join("\n");

    // 2. Intelligence - pick topic by number
    const intelligencePrompt = `Pick the best headline number for a Mastodon Marketing LinkedIn post.
Target pillar: ${targetPillar}
Prioritize practical AI implementation for all businesses when the target pillar is AI.
Do not default to contractors or local service businesses unless the headline is specifically about them.
Pick something DIFFERENT from recent drafts.

Return ONLY this JSON, keep values concise: {"pick":1,"bucket":"${targetPillar}","urgency":5,"angle":"short practical angle"}

${headlineList}`;

    const intelligenceRaw = await callGemini("gemini-2.5-flash", intelligencePrompt, undefined, true);
    const intelligence = safeParseJson(intelligenceRaw);
    const pickIndex = (intelligence.pick || 1) - 1;
    const pickedRSS = rssToUse[Math.min(pickIndex, rssToUse.length - 1)];
    const item = {
      ...intelligence,
      source: pickedRSS.url,
      topic: pickedRSS.title,
      bucket: normalizePillar(intelligence.bucket || pickedRSS.pillar || targetPillar),
    };

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
    let draftPrompt = `CONTENT PILLAR: ${item.bucket}
TOPIC: ${item.topic}
SOURCE URL: ${item.source}
ANGLE: ${item.angle}

Write a complete LinkedIn post for Mastodon Marketing following all voice, format, and psychology rules.
If CONTENT PILLAR is AI, make the advice useful for all businesses, not just contractors or local service businesses.
Do not use the repetitive ending 'Identify one repetitive task that takes up too much time each week.' Choose a more specific ending tied to this topic instead.
Use this final order:
Source: ${item.source}
[IMAGE: detailed image description]`;

    let draft = "";
    let issues: string[] = [];
    let imageDescription = "";
    for (let attempt = 0; attempt < 4; attempt++) {
      const draftBody = await callGemini("gemini-2.5-flash", draftPrompt, SYSTEM_PROMPT + learnedStyle);
      imageDescription = createImageDescription(draftBody, item.topic, item.bucket);
      draft = ensureMetadata(draftBody, item.source, imageDescription);
      issues = draftIssues(draft);
      if (!issues.length) break;
      draftPrompt = `The previous draft failed these checks: ${issues.join(", ")}.

Rewrite it as a complete LinkedIn post.
Keep the same topic, source, and angle.
Target 240-300 words before the metadata.
Use 7-9 short paragraphs.
Each paragraph must add a new useful idea, example, or implementation step.
Do not stop mid-thought.
Do not use the repetitive ending 'Identify one repetitive task that takes up too much time each week.' Use a fresh topic-specific CTA or takeaway.
Use this final order:
Source: ${item.source}
[IMAGE: detailed image description]

Previous draft:
${draft}`;
    }
    if (issues.length) throw new Error(`Generated draft failed quality checks: ${issues.join(", ")}`);

    // 4. QC score
    const qcPrompt = `Rate this post 1-10. Return ONLY: {"weighted_average":7,"verdict":"PASS","feedback":"max 15 words"}

${draft}`;

    const qcRaw = await callGemini("gemini-2.5-flash", qcPrompt, undefined, true);
    const qc = safeParseJson(qcRaw);
    const firstComment = createFirstComment(draft, item.topic, item.bucket);

    // 5. Generate image using OpenAI gpt-image-1
    let imageUrl = "";
    try {
      let imgHook = "";
      let imgVisual = "";
      try {
        const parsed = JSON.parse(imageDescription);
        imgHook = parsed.hook || "";
        imgVisual = parsed.visual || "";
      } catch { imgHook = imageDescription; }

      const imgPrompt = `Create a bold, modern social media graphic for LinkedIn. Style reference: dark gradient background transitioning from black to deep purple (#553d67).

LAYOUT:
- Large, bold white headline text at the top taking up 40% of the image. The text reads: "${imgHook}"
- Below the text, include ${imgVisual} as a glossy, floating 3D rendered object with subtle purple (#553d67) glow and lighting effects
- Clean composition with plenty of negative space
- No watermarks, no social media UI elements, no likes/comments icons

BANNED: Do NOT include any brains, neural networks, circuit boards, head silhouettes, or head-shaped objects.

TEXT RULES: The ONLY text in the entire image is the headline above. No subtitles, no taglines, no CTAs, no URLs, no dates, no captions, no body text, no labels. Just the one short headline and the 3D visual. Nothing else.

BRAND COLORS: Deep purple (#553d67), black (#000000), white (#ffffff). Purple is the accent color for glows, gradients, and highlights.

TYPOGRAPHY: Bold, modern sans-serif font. White text on dark background. Keep it to one or two lines max.

STYLE: Premium, polished social media graphic. 3D rendered elements with soft lighting. Dark, moody atmosphere with purple accent lighting. Minimal and clean.`;

      const imgRes = await fetch("https://api.openai.com/v1/images/generations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${OPENAI_KEY}`,
        },
        body: JSON.stringify({
          model: "gpt-image-1",
          prompt: imgPrompt,
          n: 1,
          size: "1024x1024",
          quality: "medium",
        }),
      });
      const imgData = await imgRes.json();
      if (imgRes.ok && imgData.data?.[0]?.b64_json) {
        const fileName = `post-${Date.now()}.png`;
        const supabaseStorage = createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
        );
        const bytes = base64Decode(imgData.data[0].b64_json);
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
      first_comment: firstComment,
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
