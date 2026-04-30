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
    const allVisuals = [
      "three translucent glass spheres of different sizes floating above a reflective dark surface, each sphere refracting purple and gold light",
      "a large amethyst crystal cluster growing out of a dark obsidian base, with inner purple glow illuminating the facets",
      "flowing silk ribbons in deep purple and white, twisting through the air in an elegant spiral formation",
      "a single perfect water droplet frozen in mid-air above a still pool, creating concentric ripple rings below",
      "a geometric origami crane made of reflective metallic purple paper, floating weightlessly",
      "stacked smooth river stones balanced in a zen tower formation, each stone glowing with a faint purple aura at the edges",
      "a nautilus shell cross-section revealing its golden spiral chambers, lit with warm purple ambient light",
      "abstract flowing aurora borealis waves in purple, teal, and gold sweeping across a dark sky",
      "a single white feather drifting downward with tiny purple sparks trailing behind it",
      "interlocking hexagonal tiles in varying shades of purple and charcoal, some tiles raised and glowing at the seams",
      "a glass hourglass with glowing purple sand mid-flow, suspended at an angle in empty space",
      "a cluster of floating soap bubbles with iridescent purple and gold reflections on their surfaces",
      "a blooming flower made entirely of frosted glass petals, with a warm purple light emanating from the center",
      "a smooth marble sculpture of an abstract wave form, polished to a mirror finish with purple accent lighting",
      "crystalline ice formations growing in geometric patterns on a dark surface, lit from within by purple light",
      "a Japanese bonsai tree with glowing purple leaves, sitting on a floating stone platform",
      "nested rings of polished metal orbiting each other at different angles like a gyroscope, with purple energy at the center",
      "a paper lantern with intricate cutout patterns casting purple light patterns on surrounding darkness",
      "volcanic glass obsidian shards arranged in a crown-like formation, edges glowing with molten purple light",
      "a geometric terrarium globe containing a tiny purple-lit landscape with miniature mountains and trees",
    ];
    const visual = allVisuals[Math.floor(Math.random() * allVisuals.length)];

    const imgPrompt = `Photo-realistic 3D render: ${visual}

Style: glossy surfaces, dramatic purple (#553d67) accent lighting, dark gradient background fading from black to deep purple. Floating in empty space. Clean, minimal, premium aesthetic.

STRICT RULES: No text, no words, no letters, no numbers, no labels, no typography. No technology, no screens, no computers, no brains, no circuits, no robots, no AI symbols. Only render the exact object described above, nothing else.`;

    const imgRes = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENAI_KEY}`,
      },
      body: JSON.stringify({
        model: "dall-e-3",
        prompt: imgPrompt,
        n: 1,
        size: "1024x1024",
        quality: "standard",
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
