import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const MAKE_WEBHOOK = "https://hook.us2.make.com/zrpbixh6ougugpuusmo4f1y8i45qdyx2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { draft_id } = await req.json();
    if (!draft_id) throw new Error("draft_id required");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Get the draft
    const { data: row, error } = await supabase
      .from("linkedin_drafts")
      .select("draft")
      .eq("id", draft_id)
      .single();

    if (error || !row) throw new Error(`Draft not found: ${error?.message}`);

    // Strip [IMAGE: ...] line from draft before posting
    const cleanDraft = row.draft.replace(/\[IMAGE:.*?\]\s*/gi, "").trim();

    // Send to Make.com webhook for LinkedIn publishing
    const webhookRes = await fetch(MAKE_WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draft: cleanDraft }),
    });

    if (!webhookRes.ok) throw new Error(`Make.com webhook failed: ${webhookRes.status}`);

    // Update status in Supabase
    const { error: updateErr } = await supabase
      .from("linkedin_drafts")
      .update({
        status: "Published",
        linkedin_post_id: "via-webhook",
        scheduled_date: new Date().toISOString(),
      })
      .eq("id", draft_id);

    if (updateErr) throw new Error(`Status update failed: ${updateErr.message}`);

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
