import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  cleanPostText,
  createBufferPost,
  deleteBufferPost,
  isBufferConfigured,
  upsertScheduledBufferPost,
} from "../_shared/buffer.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Fallback queue timing when Buffer is unavailable.
const SLOT_HOURS_UTC: Record<number, number> = {
  1: 14,
  2: 13,
  3: 14,
  4: 13,
  5: 14,
};

function getNextSlot(existingDates: string[]): Date {
  const taken = new Set(existingDates.map(d => new Date(d).toISOString().split("T")[0]));
  const now = new Date();
  const candidate = new Date(now);
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

  const fallback = new Date(now);
  fallback.setUTCDate(fallback.getUTCDate() + 7);
  fallback.setUTCHours(14, 0, 0, 0);
  return fallback;
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

  const fallback = new Date(latest);
  fallback.setUTCDate(fallback.getUTCDate() + 7);
  fallback.setUTCHours(14, 0, 0, 0);
  return fallback;
}

async function scheduleNext(supabase: any, draftId: number, appendToQueue = false) {
  if (isBufferConfigured()) {
    return await scheduleDraft(supabase, draftId, null, true);
  }

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

async function cancelBufferForDraft(supabase: any, draftId: number) {
  if (!isBufferConfigured()) return;

  const { data } = await supabase
    .from("linkedin_drafts")
    .select("buffer_post_id")
    .eq("id", draftId)
    .single();

  if (data?.buffer_post_id) {
    try {
      await deleteBufferPost(data.buffer_post_id);
    } catch (err) {
      console.error(`Buffer delete failed for ${draftId}: ${(err as Error).message}`);
    }
  }
}

async function scheduleDraft(supabase: any, draftId: number, scheduledFor?: string | null, useQueue = false) {
  const { data: row, error: rowError } = await supabase
    .from("linkedin_drafts")
    .select("draft, image_url, first_comment, buffer_post_id")
    .eq("id", draftId)
    .single();
  if (rowError || !row) throw new Error(`Draft not found: ${rowError?.message}`);

  let bufferPost: Awaited<ReturnType<typeof upsertScheduledBufferPost>> | null = null;
  if (isBufferConfigured()) {
    bufferPost = await upsertScheduledBufferPost(row.buffer_post_id, {
      post: row.draft,
      imageUrl: row.image_url || "",
      firstComment: row.first_comment || "",
      scheduledAt: scheduledFor || null,
      useQueue,
    });
  }

  const resolvedScheduledFor = bufferPost?.dueAt || scheduledFor || null;
  if (isBufferConfigured() && !resolvedScheduledFor) {
    throw new Error("Buffer did not return a scheduled time");
  }

  const { error: updateError } = await supabase.from("linkedin_drafts").update({
    status: "Scheduled",
    scheduled_for: resolvedScheduledFor,
    publishing_provider: bufferPost ? "buffer" : "local",
    buffer_post_id: bufferPost?.id || null,
    buffer_status: bufferPost?.status || null,
    buffer_error: bufferPost?.error || null,
    platform_post_id: bufferPost?.id || null,
    submitted_at: bufferPost ? new Date().toISOString() : null,
  }).eq("id", draftId);
  if (updateError) throw new Error(`Schedule failed: ${updateError.message}`);

  return resolvedScheduledFor;
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
      await cancelBufferForDraft(supabase, draft_id);
      const { error } = await supabase.from("linkedin_drafts").update({
        status: "Rejected",
        scheduled_for: null,
        buffer_post_id: null,
        buffer_status: null,
        buffer_error: null,
        platform_post_id: null,
      }).eq("id", draft_id);
      if (error) throw new Error(`Reject failed: ${error.message}`);

      return new Response(JSON.stringify({ ok: true, status: "Rejected" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "delete") {
      await cancelBufferForDraft(supabase, draft_id);
      const { error } = await supabase.from("linkedin_drafts").delete().eq("id", draft_id);
      if (error) throw new Error(`Delete failed: ${error.message}`);

      return new Response(JSON.stringify({ ok: true, deleted: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "unschedule") {
      await cancelBufferForDraft(supabase, draft_id);
      const { error } = await supabase.from("linkedin_drafts").update({
        status: "Pending Review",
        scheduled_for: null,
        buffer_post_id: null,
        buffer_status: null,
        buffer_error: null,
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
        .select("draft, image_url, first_comment, buffer_post_id")
        .eq("id", draft_id)
        .single();
      if (error || !row) throw new Error(`Draft not found: ${error?.message}`);

      if (row.buffer_post_id && isBufferConfigured()) {
        await cancelBufferForDraft(supabase, draft_id);
      }

      let bufferPost: Awaited<ReturnType<typeof createBufferPost>> | null = null;
      if (isBufferConfigured()) {
        bufferPost = await createBufferPost({
          post: row.draft,
          imageUrl: row.image_url || "",
          firstComment: row.first_comment || "",
          now: true,
        });
        if (bufferPost.status === "error") {
          const bufferError = bufferPost.error || "Buffer reported a publishing error";
          await supabase.from("linkedin_drafts").update({
            status: "Pending Review",
            scheduled_for: null,
            publishing_provider: "buffer",
            buffer_post_id: bufferPost.id,
            buffer_status: bufferPost.status,
            buffer_error: bufferError,
            platform_post_id: bufferPost.id,
            submitted_at: new Date().toISOString(),
          }).eq("id", draft_id);
          throw new Error(bufferError);
        }
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
        linkedin_post_id: bufferPost?.id || "via-webhook",
        scheduled_date: new Date().toISOString(),
        scheduled_for: null,
        publishing_provider: bufferPost ? "buffer" : "make",
        buffer_post_id: bufferPost?.id || null,
        buffer_status: bufferPost?.status || null,
        buffer_error: bufferPost?.error || null,
        platform_post_id: bufferPost?.id || null,
        submitted_at: bufferPost ? new Date().toISOString() : null,
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

    // Auto-schedule: let Buffer assign the next queue slot when available
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
