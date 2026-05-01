import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { decode as base64Decode } from "https://deno.land/std@0.168.0/encoding/base64.ts";

const OPENAI_KEY = Deno.env.get("OPEN_AI_AI_KEY") || "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Only process ONE draft per call to avoid timeout
    const { data: drafts, error } = await supabase
      .from("linkedin_drafts")
      .select("id, draft")
      .eq("status", "Pending Review")
      .order("created_at", { ascending: true })
      .limit(1);

    if (error) throw new Error(`Query failed: ${error.message}`);
    if (!drafts || drafts.length === 0) {
      return new Response(JSON.stringify({ ok: true, done: true, message: "No more pending drafts" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const draft = drafts[0];
    const cleanLines = draft.draft
      .replace(/\[IMAGE:[\s\S]*?\]/gi, "")
      .replace(/Source:\s*https?:\/\/\S+/gi, "")
      .split("\n")
      .map((line: string) => line.trim())
      .filter((line: string) => line && !line.startsWith("#"));
    const firstLine = (cleanLines[0] || "Business growth starts here").trim();
    const hookSentence = firstLine.split(/[.!?]/)[0].trim();
    const words = hookSentence.split(" ");
    let line1 = words.slice(0, Math.min(4, Math.ceil(words.length / 2))).join(" ").toUpperCase();
    let line2 = words.slice(Math.min(4, Math.ceil(words.length / 2))).join(" ").toUpperCase();
    if (!line2) { line2 = line1; line1 = "THE REAL"; }

    const visualElements = [
      "a dark terminal window with colored command-line text and a blinking cursor",
      "a glowing dashboard with bar charts and upward-trending line graphs",
      "a stylized smartphone screen showing a chat conversation with purple message bubbles",
      "a digital calendar grid with highlighted dates and notification badges",
      "a sleek laptop half-open with purple light emanating from the screen",
      "a circular progress meter at 97% with purple neon glow",
      "a speed gauge needle pointing to maximum with motion blur",
      "a minimalist funnel diagram with glowing layers narrowing downward",
      "a stylized clock face with fast-moving hands and motion trails",
      "a floating credit card with holographic shine and contactless waves",
      "a megaphone emitting colorful sound waves and notification icons",
      "a magnifying glass over a glowing data grid with highlighted rows",
      "a stack of coins growing into a bar chart with an upward arrow",
      "a target bullseye with an arrow dead center and impact glow",
      "a paper airplane trailing a dotted purple flight path",
      "a chain link breaking apart with energy sparks at the break point",
      "a toggle switch flipping from OFF to ON with purple electricity arcing",
      "a rising bar chart with the last bar breaking through a ceiling line",
      "a cursor arrow clicking a glowing purple CTA button",
      "a gear mechanism with interconnected cogs turning in sync",
    ];
    const visual = visualElements[Math.floor(Math.random() * visualElements.length)];

    const imgPrompt = `Design a bold LinkedIn social media graphic (square format).

LAYOUT:
- Dark background: black to deep purple (#553d67) gradient with subtle geometric grid pattern
- Top: small monospace accent text in purple, like a status line (e.g. "// RESULTS LOADING..." or ">> STATUS: LIVE")
- Center: Big bold white headline text in heavy sans-serif font, all caps, taking up most of the image:
  Line 1: "${line1}"
  Line 2: "${line2}" (this line in purple #553d67 or lilac with a purple underline glow)
- Bottom section: ${visual}
- Purple neon glow and lighting accents throughout

STYLE: Bold, modern, high-contrast. Like a premium LinkedIn influencer carousel cover. Dark moody aesthetic with purple neon accents. The text should be the dominant element. No photos of people. No brains, no neural networks. No stock photo look.`;

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
        response_format: "b64_json",
      }),
    });

    const imgData = await imgRes.json();
    if (!imgRes.ok || !imgData.data?.[0]?.b64_json) {
      throw new Error(`OpenAI error ${imgRes.status}: ${JSON.stringify(imgData).substring(0, 200)}`);
    }

    const fileName = `post-${draft.id}-${Date.now()}.png`;
    const bytes = base64Decode(imgData.data[0].b64_json);

    const { error: uploadErr } = await supabase.storage
      .from("post-images")
      .upload(fileName, bytes, { contentType: "image/png", upsert: true });

    if (uploadErr) throw new Error(`Upload error: ${uploadErr.message}`);

    const { data: urlData } = supabase.storage
      .from("post-images")
      .getPublicUrl(fileName);

    await supabase
      .from("linkedin_drafts")
      .update({ image_url: urlData.publicUrl })
      .eq("id", draft.id);

    // Check how many remain
    const { count } = await supabase
      .from("linkedin_drafts")
      .select("id", { count: "exact", head: true })
      .eq("status", "Pending Review");

    const remaining = (count || 0) - 1;

    return new Response(JSON.stringify({
      ok: true,
      updated_id: draft.id,
      remaining,
      done: remaining <= 0,
      message: remaining > 0 ? `Done. ${remaining} more pending. Run again.` : "All pending drafts updated!",
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
