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

    const { data: drafts, error } = await supabase
      .from("linkedin_drafts")
      .select("id, draft")
      .eq("status", "Pending Review");

    if (error) throw new Error(`Query failed: ${error.message}`);
    if (!drafts || drafts.length === 0) {
      return new Response(JSON.stringify({ ok: true, updated: 0, message: "No pending drafts" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let updated = 0;
    const errors: string[] = [];

    for (const draft of drafts) {
      try {
        const imageMatch = draft.draft.match(/\[IMAGE:\s*(.+?)\]/i);
        const imagePrompt = imageMatch
          ? imageMatch[1].trim()
          : "Professional business concept, modern and clean";

        const imgRes = await fetch("https://api.openai.com/v1/images/generations", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${OPENAI_KEY}`,
          },
          body: JSON.stringify({
            model: "gpt-image-1",
            prompt: `Professional LinkedIn post image: ${imagePrompt}. Clean, modern, visually compelling. No text, words, letters, or numbers on the image. Business-appropriate, high quality.`,
            n: 1,
            size: "1536x1024",
            quality: "high",
          }),
        });

        const imgData = await imgRes.json();
        if (!imgRes.ok || !imgData.data?.[0]?.b64_json) {
          errors.push(`Draft ${draft.id}: OpenAI error ${imgRes.status}`);
          continue;
        }

        const fileName = `post-${draft.id}-${Date.now()}.png`;
        const bytes = base64Decode(imgData.data[0].b64_json);

        const { error: uploadErr } = await supabase.storage
          .from("post-images")
          .upload(fileName, bytes, { contentType: "image/png", upsert: true });

        if (uploadErr) {
          errors.push(`Draft ${draft.id}: Upload error: ${uploadErr.message}`);
          continue;
        }

        const { data: urlData } = supabase.storage
          .from("post-images")
          .getPublicUrl(fileName);

        await supabase
          .from("linkedin_drafts")
          .update({ image_url: urlData.publicUrl })
          .eq("id", draft.id);

        updated++;
      } catch (e) {
        errors.push(`Draft ${draft.id}: ${(e as Error).message}`);
      }
    }

    return new Response(JSON.stringify({ ok: true, updated, total: drafts.length, errors }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
