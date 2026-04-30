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
    const hook = cleanLines[0] || "Business growth insight";
    const lower = draft.draft.toLowerCase();
    const aiVisuals = [
      "a glowing robotic hand reaching toward a floating holographic interface",
      "a sleek command terminal with flowing data streams and connected nodes",
      "interlocking gears and cogs with glowing energy pulses running through them",
      "a futuristic control panel with floating cards, toggles, and workflow arrows",
      "a crystal-clear glass cube containing swirling light particles and data pathways",
      "a holographic assistant avatar emerging from a smartphone screen",
      "a network of glowing orbs connected by light beams forming a constellation",
      "a speedometer dial maxed out with lightning bolts and efficiency arrows",
    ];
    const marketingVisuals = [
      "a 3D rocket launching from a laptop screen trailing purple light",
      "a glowing magnifying glass hovering over a search bar with rising graph lines",
      "a megaphone emitting colorful sound waves that transform into dollar signs",
      "a funnel with glowing leads flowing in and customers emerging at the bottom",
      "a target with an arrow dead center surrounded by floating analytics cards",
      "a globe with connection lines and social media notification bubbles",
    ];
    const croVisuals = [
      "a laptop screen showing a sleek landing page with a giant glowing CTA button",
      "a split-screen A/B test with one side glowing brighter than the other",
      "a conversion funnel made of glass with glowing leads dropping through stages",
      "a cursor clicking a button that explodes into upward-trending graph lines",
      "a website wireframe floating in space with heat map color overlays",
      "a smartphone and laptop side by side with synchronized dashboard metrics",
    ];
    let options = aiVisuals;
    if (/\bseo\b|google ads|marketing|social media/i.test(lower)) options = marketingVisuals;
    else if (/\bcro\b|conversion|landing page|website design/i.test(lower)) options = croVisuals;
    const visual = options[Math.floor(Math.random() * options.length)];

    const imgPrompt = `Create a bold, modern social media graphic for LinkedIn. Style reference: dark gradient background transitioning from black to deep purple (#553d67).

LAYOUT:
- Large, bold white headline text at the top taking up 40% of the image. The text reads: "${hook}"
- Below the text, include a relevant ${visual} as a glossy, floating 3D rendered object with subtle purple (#553d67) glow and lighting effects
- Clean composition with plenty of negative space
- No watermarks, no social media UI elements, no likes/comments icons

BRAND COLORS: Deep purple (#553d67), black (#000000), white (#ffffff). Purple is the accent color for glows, gradients, and highlights.

TYPOGRAPHY: Bold, modern sans-serif font. White text on dark background. Make the headline text the dominant visual element.

STYLE: Premium, polished social media graphic. Similar to high-engagement LinkedIn/Instagram carousel cover slides. 3D rendered elements with soft lighting. Dark, moody atmosphere with purple accent lighting.`;

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
