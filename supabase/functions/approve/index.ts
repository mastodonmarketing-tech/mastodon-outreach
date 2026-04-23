import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  cancelOutstandPost,
  cleanPostText,
  createOutstandPost,
  isOutstandConfigured,
} from "../_shared/outstand.ts";

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

function getNextQueueSlot(existingDates: string[]): Date {
  if (!existingDates.length) return getNextSlot([]);
  const taken = new Set(existingDates.map(d => new Date(d).toISOString().split("T")[0]));
  const latest = existingDates
    .map(d => new Date(d))
    .sort((a, b) => b.getTime() - a.getTime())[0];
  const candidate = new Date(latest);
  candidate.setUTCDate(candidate.getUTCDate() + 1);
  candidate.setUTCMinutes(0, 0, 0);

  for (let i = 0; i < 30; i++) {
    const day = candidate.getUTCDay();
    const dateStr = candidate.toISOString().split("T")[0];
    if (day >= 1 && day <= 5 && !taken.has(dateStr)) {
      candidate.setUTCHours(SLOT_HOURS_UTC[day] || 14);
      return candidate;
    }
    candidate.setUTCDate(candidate.getUTCDate() + 1);
  }

  const fb = new Date(latest);
  fb.setUTCDate(fb.getUTCDate() + 7);
  fb.setUTCHours(14, 0, 0, 0);
  return fb;
}

async function cancelOutstandForDraft(supabase: any, draftId: number) {
  if (!isOutstandConfigured()) return;

  const { data } = await supabase
    .from("linkedin_drafts")
    .select("outstand_post_id")
    .eq("id", draftId)
    .single();

  if (data?.outstand_post_id) {
    try {
      await cancelOutstandPost(data.outstand_post_id);
    } catch (err) {
      console.error(`Outstand cancel failed for ${draftId}: ${(err as Error).message}`);
    }
  }
}

async function scheduleDraft(supabase: any, draftId: number, scheduledFor: string) {
  const { data: row, error } = await supabase
    .from("linkedin_drafts")
    .select("draft, image_url, first_comment, outstand_post_id")
    .eq("id", draftId)
    .single();
  if (error || !row) throw new Error(`Draft not found: ${error?.message}`);

  if (row.outstand_post_id && isOutstandConfigured()) {
    try {
      await cancelOutstandPost(row.outstand_post_id);
    } catch (err) {
      console.error(`Outstand cancel failed for ${draftId}: ${(err as Error).message}`);
    }
  }

  let outstand: Awaited<ReturnType<typeof createOutstandPost>> | null = null;
  if (isOutstandConfigured()) {
    outstand = await createOutstandPost({
      post: row.draft,
      imageUrl: row.image_url || "",
      firstComment: row.first_comment || "",
      scheduledAt: scheduledFor,
    });
  }

  const update: Record<string, any> = {
    status: "Scheduled",
    scheduled_for: scheduledFor,
    publishing_provider: outstand ? "outstand" : "local",
    outstand_post_id: outstand?.id || null,
    outstand_status: outstand?.status || null,
    outstand_error: null,
    platform_post_id: outstand?.platformPostId || null,
    submitted_at: outstand ? new Date().toISOString() : null,
  };

  const { error: updateErr } = await supabase.from("linkedin_drafts").update(update).eq("id", draftId);
  if (updateErr) throw new Error(`Schedule failed: ${updateErr.message}`);

  return scheduledFor;
}

async function scheduleNext(supabase: any, draftId: number, appendToQueue = false) {
  const { data: scheduled } = await supabase
    .from("linkedin_drafts")
    .select("id, scheduled_for")
    .eq("status", "Scheduled")
    .not("scheduled_for", "is", null);

  const existingDates = (scheduled || [])
    .filter((r: any) => Number(r.id) !== Number(draftId))
    .map((r: any) => r.scheduled_for)
    .filter(Boolean);
  const nextSlot = appendToQueue ? getNextQueueSlot(existingDates) : getNextSlot(existingDates);
  return await scheduleDraft(supabase, draftId, nextSlot.toISOString());
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { draft_id, publish_now, scheduled_for, action } = await req.json();
    if (!draft_id) throw new Error("draft_id required");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    if (action === "reject") {
      await cancelOutstandForDraft(supabase, draft_id);
      const { error } = await supabase.from("linkedin_drafts").update({
        status: "Rejected",
        scheduled_for: null,
        outstand_status: null,
        outstand_error: null,
      }).eq("id", draft_id);
      if (error) throw new Error(`Reject failed: ${error.message}`);

      return new Response(JSON.stringify({ ok: true, status: "Rejected" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "delete") {
      await cancelOutstandForDraft(supabase, draft_id);
      const { error } = await supabase.from("linkedin_drafts").delete().eq("id", draft_id);
      if (error) throw new Error(`Delete failed: ${error.message}`);

      return new Response(JSON.stringify({ ok: true, deleted: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "unschedule") {
      await cancelOutstandForDraft(supabase, draft_id);
      const { error } = await supabase.from("linkedin_drafts").update({
        status: "Pending Review",
        scheduled_for: null,
        outstand_post_id: null,
        outstand_status: null,
        outstand_error: null,
        platform_post_id: null,
      }).eq("id", draft_id);
      if (error) throw new Error(`Unschedule failed: ${error.message}`);

      return new Response(JSON.stringify({ ok: true, status: "Pending Review" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "next_slot") {
      const next = await scheduleNext(supabase, draft_id, true);

      return new Response(JSON.stringify({ ok: true, scheduled_for: next }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // If publish_now, publish immediately (bypass scheduling)
    if (publish_now) {
      const { data: row, error } = await supabase
        .from("linkedin_drafts")
        .select("draft, image_url, first_comment, outstand_post_id")
        .eq("id", draft_id)
        .single();
      if (error || !row) throw new Error(`Draft not found: ${error?.message}`);

      if (row.outstand_post_id && isOutstandConfigured()) {
        await cancelOutstandForDraft(supabase, draft_id);
      }

      let outstand: Awaited<ReturnType<typeof createOutstandPost>> | null = null;
      if (isOutstandConfigured()) {
        outstand = await createOutstandPost({
          post: row.draft,
          imageUrl: row.image_url || "",
          firstComment: row.first_comment || "",
        });
      } else {
        const webhookRes = await fetch("https://hook.us2.make.com/zrpbixh6ougugpuusmo4f1y8i45qdyx2", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ draft: cleanPostText(row.draft), image_url: row.image_url || "", first_comment: row.first_comment || "" }),
        });
        if (!webhookRes.ok) throw new Error(`LinkedIn publish failed: ${webhookRes.status}`);
      }

      const { error: updateErr } = await supabase.from("linkedin_drafts").update({
        status: "Published",
        linkedin_post_id: outstand?.platformPostId || outstand?.id || "via-webhook",
        scheduled_date: new Date().toISOString(),
        scheduled_for: null,
        publishing_provider: outstand ? "outstand" : "make",
        outstand_post_id: outstand?.id || null,
        outstand_status: outstand?.status || null,
        outstand_error: null,
        platform_post_id: outstand?.platformPostId || null,
        submitted_at: outstand ? new Date().toISOString() : null,
      }).eq("id", draft_id);
      if (updateErr) throw new Error(`Update failed: ${updateErr.message}`);

      return new Response(JSON.stringify({ ok: true, published: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // If custom scheduled_for provided, use it
    if (scheduled_for) {
      const scheduled = await scheduleDraft(supabase, draft_id, scheduled_for);

      return new Response(JSON.stringify({ ok: true, scheduled_for: scheduled }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Auto-schedule: find next open weekday slot
    const next = await scheduleNext(supabase, draft_id);

    return new Response(JSON.stringify({ ok: true, scheduled_for: next }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
