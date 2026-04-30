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
    const rawHook = (cleanLines[0] || "Business growth insight").split(/[.!?]/)[0].trim().split(" ").slice(0, 8).join(" ");
    const hook = rawHook.replace(/\b(AI|A\.I\.|artificial intelligence|machine learning|neural|deep learning)\b/gi, "automation").replace(/\s{2,}/g, " ").trim();
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

    const imgPrompt = `Generate a 3D rendered object on a dark background: ${visual}

The object should be glossy and floating with subtle purple (#553d67) glow and lighting effects. Dark gradient background from black to deep purple (#553d67).

This is a visual-only image. Do NOT include any text, words, letters, numbers, labels, headlines, or typography of any kind. No brains, no neural networks, no circuit boards, no head shapes. Just the 3D object on the dark background with purple lighting. Clean, minimal, premium look.`;

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
