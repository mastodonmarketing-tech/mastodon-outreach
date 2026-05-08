import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  createZernioPost,
  getZernioPost,
  isZernioConfigured,
} from "../_shared/zernio.ts";

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
    if (!isZernioConfigured()) throw new Error("Zernio publishing is not configured");

    const now = new Date().toISOString();
    const { data: due, error } = await supabase
      .from("linkedin_drafts")
      .select("id, draft, image_url, first_comment, scheduled_for, publishing_provider, buffer_post_id")
      .eq("status", "Scheduled")
      .not("scheduled_for", "is", null)
      .lte("scheduled_for", now);

    if (error) throw new Error(`Query failed: ${error.message}`);

    // Reconcile in-flight posts (pending/publishing in Zernio)
    const { data: inFlight } = await supabase
      .from("linkedin_drafts")
      .select("id, buffer_post_id")
      .eq("status", "Published")
      .eq("publishing_provider", "zernio")
      .in("buffer_status", ["pending", "publishing", "scheduled"]);

    if (inFlight?.length) {
      for (const post of inFlight) {
        if (!post.buffer_post_id) continue;
        try {
          const zernioPost = await getZernioPost(post.buffer_post_id);
          if (zernioPost.status === "published") {
            await supabase.from("linkedin_drafts").update({
              buffer_status: "published",
              buffer_error: null,
              scheduled_date: zernioPost.sentAt || new Date().toISOString(),
              linkedin_post_id: zernioPost.platformPostUrl || zernioPost.id,
            }).eq("id", post.id);
          } else if (zernioPost.status === "failed") {
            await supabase.from("linkedin_drafts").update({
              status: "Pending Review",
              scheduled_for: null,
              buffer_status: "failed",
              buffer_error: zernioPost.error || "Zernio reported a publishing error",
            }).eq("id", post.id);
          }
        } catch (err) {
          console.error(`Zernio reconcile failed for ${post.id}: ${(err as Error).message}`);
        }
      }
    }

    if (!due || due.length === 0) {
      return new Response(JSON.stringify({ ok: true, published: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let published = 0;

    for (const post of due) {
      try {
        let update: Record<string, any> | null = null;

        if (post.buffer_post_id) {
          const zernioPost = await getZernioPost(post.buffer_post_id);
          if (zernioPost.status === "published") {
            update = {
              status: "Published",
              linkedin_post_id: zernioPost.platformPostUrl || zernioPost.id,
              scheduled_date: zernioPost.sentAt || new Date().toISOString(),
              buffer_status: "published",
              buffer_error: null,
              platform_post_id: zernioPost.id,
            };
          } else if (zernioPost.status === "failed") {
            await supabase.from("linkedin_drafts").update({
              status: "Pending Review",
              scheduled_for: null,
              buffer_status: "failed",
              buffer_error: zernioPost.error || "Zernio reported a publishing error",
            }).eq("id", post.id);
            continue;
          } else {
            continue;
          }
        } else {
          const zernioPost = await createZernioPost({
            post: post.draft,
            imageUrl: post.image_url || "",
            firstComment: post.first_comment || "",
            now: true,
          });
          if (zernioPost.status === "failed") {
            await supabase.from("linkedin_drafts").update({
              status: "Pending Review",
              scheduled_for: null,
              publishing_provider: "zernio",
              buffer_post_id: zernioPost.id,
              buffer_status: "failed",
              buffer_error: zernioPost.error || "Zernio reported a publishing error",
              platform_post_id: zernioPost.id,
              submitted_at: new Date().toISOString(),
            }).eq("id", post.id);
            continue;
          }
          update = {
            status: "Published",
            linkedin_post_id: zernioPost.platformPostUrl || zernioPost.id,
            scheduled_date: zernioPost.sentAt || new Date().toISOString(),
            publishing_provider: "zernio",
            buffer_post_id: zernioPost.id,
            buffer_status: zernioPost.status,
            buffer_error: zernioPost.error || null,
            platform_post_id: zernioPost.id,
            submitted_at: new Date().toISOString(),
          };
        }

        await supabase.from("linkedin_drafts").update(update).eq("id", post.id);
        published++;
      } catch (e) {
        console.error(`Failed to publish ${post.id}: ${(e as Error).message}`);
      }
    }

    return new Response(JSON.stringify({ ok: true, published, total_due: due.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
