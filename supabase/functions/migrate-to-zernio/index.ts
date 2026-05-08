import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  createZernioPost,
  isZernioConfigured,
} from "../_shared/zernio.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BUFFER_ENDPOINT = "https://api.buffer.com";

async function deleteBufferPost(postId: string) {
  const key = Deno.env.get("BUFFER_API_KEY");
  if (!key) return;
  try {
    await fetch(BUFFER_ENDPOINT, {
      method: "POST",
      headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        query: `mutation DeletePost($input: DeletePostInput!) { deletePost(input: $input) { ... on DeletePostSuccess { id } ... on MutationError { message } } }`,
        variables: { input: { id: postId } },
      }),
    });
  } catch (err) {
    console.error(`Buffer delete failed for ${postId}: ${(err as Error).message}`);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    if (!isZernioConfigured()) throw new Error("Zernio is not configured");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Find all Buffer-managed posts that are Scheduled or Pending Review
    const { data: bufferPosts, error } = await supabase
      .from("linkedin_drafts")
      .select("id, draft, image_url, first_comment, scheduled_for, buffer_post_id, buffer_status, status")
      .eq("publishing_provider", "buffer")
      .in("status", ["Scheduled", "Pending Review"]);

    if (error) throw new Error(`Query failed: ${error.message}`);
    if (!bufferPosts || bufferPosts.length === 0) {
      return new Response(JSON.stringify({ ok: true, migrated: 0, message: "No Buffer posts to migrate" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let migrated = 0;
    const results: any[] = [];

    for (const post of bufferPosts) {
      try {
        // Cancel in Buffer if it has a buffer post ID
        if (post.buffer_post_id) {
          await deleteBufferPost(post.buffer_post_id);
        }

        // If it was scheduled, reschedule via Zernio
        if (post.status === "Scheduled" && post.scheduled_for) {
          const zernioPost = await createZernioPost({
            post: post.draft,
            imageUrl: post.image_url || "",
            firstComment: post.first_comment || "",
            scheduledAt: post.scheduled_for,
          });

          await supabase.from("linkedin_drafts").update({
            publishing_provider: "zernio",
            buffer_post_id: zernioPost.id,
            buffer_status: zernioPost.status,
            buffer_error: zernioPost.error || null,
            platform_post_id: zernioPost.id,
            submitted_at: new Date().toISOString(),
          }).eq("id", post.id);

          results.push({ id: post.id, action: "rescheduled_in_zernio", zernio_id: zernioPost.id });
        } else {
          // Just update the provider to zernio, clear buffer fields
          await supabase.from("linkedin_drafts").update({
            publishing_provider: "zernio",
            buffer_post_id: null,
            buffer_status: null,
            buffer_error: null,
            platform_post_id: null,
          }).eq("id", post.id);

          results.push({ id: post.id, action: "cleared_buffer_provider" });
        }

        migrated++;
      } catch (err) {
        results.push({ id: post.id, action: "error", error: (err as Error).message });
      }
    }

    return new Response(JSON.stringify({
      ok: true,
      migrated,
      total: bufferPosts.length,
      results,
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
