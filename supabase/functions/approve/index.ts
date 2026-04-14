import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Posting times in CT (UTC-5): varied across weekdays for better reach
// Mon 9AM, Tue 8AM, Wed 9AM, Thu 8AM, Fri 9AM = UTC 14:00/13:00
const SLOT_HOURS_UTC: Record<number, number> = {
  1: 14, // Mon 9AM CT
  2: 13, // Tue 8AM CT
  3: 14, // Wed 9AM CT
  4: 13, // Thu 8AM CT
  5: 14, // Fri 9AM CT
};

function getNextSlot(existingDates: string[]): Date {
  const taken = new Set(existingDates.map(d => new Date(d).toISOString().split("T")[0]));
  const now = new Date();
  const candidate = new Date(now);

  // Start from tomorrow
  candidate.setUTCDate(candidate.getUTCDate() + 1);
  candidate.setUTCMinutes(0, 0, 0);

  // Find next weekday not already taken
  for (let i = 0; i < 30; i++) {
    const day = candidate.getUTCDay(); // 0=Sun, 6=Sat
    const dateStr = candidate.toISOString().split("T")[0];

    if (day >= 1 && day <= 5 && !taken.has(dateStr)) {
      candidate.setUTCHours(SLOT_HOURS_UTC[day] || 14);
      return candidate;
    }
    candidate.setUTCDate(candidate.getUTCDate() + 1);
  }

  // Fallback: 7 days from now
  const fb = new Date(now);
  fb.setUTCDate(fb.getUTCDate() + 7);
  fb.setUTCHours(14, 0, 0, 0);
  return fb;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { draft_id, publish_now, scheduled_for } = await req.json();
    if (!draft_id) throw new Error("draft_id required");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // If publish_now, publish immediately (bypass scheduling)
    if (publish_now) {
      const { data: row, error } = await supabase
        .from("linkedin_drafts")
        .select("draft, image_url")
        .eq("id", draft_id)
        .single();
      if (error || !row) throw new Error(`Draft not found: ${error?.message}`);

      const cleanDraft = row.draft.replace(/\[IMAGE:.*?\]\s*/gi, "").trim();
      const webhookRes = await fetch("https://hook.us2.make.com/zrpbixh6ougugpuusmo4f1y8i45qdyx2", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draft: cleanDraft, image_url: row.image_url || "" }),
      });
      if (!webhookRes.ok) throw new Error(`LinkedIn publish failed: ${webhookRes.status}`);

      await supabase.from("linkedin_drafts").update({
        status: "Published",
        linkedin_post_id: "via-webhook",
        scheduled_date: new Date().toISOString(),
        scheduled_for: null,
      }).eq("id", draft_id);

      return new Response(JSON.stringify({ ok: true, published: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // If custom scheduled_for provided, use it
    if (scheduled_for) {
      await supabase.from("linkedin_drafts").update({
        status: "Scheduled",
        scheduled_for: scheduled_for,
      }).eq("id", draft_id);

      return new Response(JSON.stringify({ ok: true, scheduled_for }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Auto-schedule: find next open weekday slot
    const { data: scheduled } = await supabase
      .from("linkedin_drafts")
      .select("scheduled_for")
      .eq("status", "Scheduled")
      .not("scheduled_for", "is", null);

    const existingDates = (scheduled || []).map((r: any) => r.scheduled_for).filter(Boolean);
    const nextSlot = getNextSlot(existingDates);

    await supabase.from("linkedin_drafts").update({
      status: "Scheduled",
      scheduled_for: nextSlot.toISOString(),
    }).eq("id", draft_id);

    return new Response(JSON.stringify({ ok: true, scheduled_for: nextSlot.toISOString() }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
