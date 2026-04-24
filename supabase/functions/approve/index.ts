import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  createBufferPost,
  deleteBufferPost,
  isBufferConfigured,
  upsertScheduledBufferPost,
} from "../_shared/buffer.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function scheduleNext(supabase: any, draftId: number, appendToQueue = false) {
  if (!isBufferConfigured()) throw new Error("Buffer publishing is not configured");
  return await scheduleDraft(supabase, draftId, null, true);
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
  if (!isBufferConfigured()) throw new Error("Buffer publishing is not configured");

  const { data: row, error: rowError } = await supabase
    .from("linkedin_drafts")
    .select("draft, image_url, first_comment, buffer_post_id")
    .eq("id", draftId)
    .single();
  if (rowError || !row) throw new Error(`Draft not found: ${rowError?.message}`);

  let bufferPost: Awaited<ReturnType<typeof upsertScheduledBufferPost>> | null = null;
  bufferPost = await upsertScheduledBufferPost(row.buffer_post_id, {
    post: row.draft,
    imageUrl: row.image_url || "",
    firstComment: row.first_comment || "",
    scheduledAt: scheduledFor || null,
    useQueue,
  });

  const resolvedScheduledFor = bufferPost?.dueAt || scheduledFor || null;
  if (!resolvedScheduledFor) {
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
      if (!isBufferConfigured()) throw new Error("Buffer publishing is not configured");

      const { data: row, error } = await supabase
        .from("linkedin_drafts")
        .select("draft, image_url, first_comment, buffer_post_id")
        .eq("id", draft_id)
        .single();
      if (error || !row) throw new Error(`Draft not found: ${error?.message}`);

      if (row.buffer_post_id && isBufferConfigured()) {
        await cancelBufferForDraft(supabase, draft_id);
      }

      const bufferPost = await createBufferPost({
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

      const { error: updateErr } = await supabase.from("linkedin_drafts").update({
        status: "Published",
        linkedin_post_id: bufferPost.id,
        scheduled_date: new Date().toISOString(),
        scheduled_for: null,
        publishing_provider: "buffer",
        buffer_post_id: bufferPost.id,
        buffer_status: bufferPost.status,
        buffer_error: bufferPost.error || null,
        platform_post_id: bufferPost.id,
        submitted_at: new Date().toISOString(),
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
