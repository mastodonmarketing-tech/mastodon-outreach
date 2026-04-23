import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  cleanPostText,
  createBufferPost,
  getBufferPost,
  isBufferConfigured,
} from "../_shared/buffer.ts";

const MAKE_WEBHOOK = "https://hook.us2.make.com/zrpbixh6ougugpuusmo4f1y8i45qdyx2";

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

    // Find posts scheduled for now or earlier
    const now = new Date().toISOString();
    const { data: due, error } = await supabase
      .from("linkedin_drafts")
      .select("id, draft, image_url, first_comment, scheduled_for, publishing_provider, buffer_post_id")
      .eq("status", "Scheduled")
      .not("scheduled_for", "is", null)
      .lte("scheduled_for", now);

    if (error) throw new Error(`Query failed: ${error.message}`);
    const { data: inFlight } = await supabase
      .from("linkedin_drafts")
      .select("id, buffer_post_id")
      .eq("status", "Published")
      .eq("publishing_provider", "buffer")
      .in("buffer_status", ["sending", "scheduled"]);

    if (isBufferConfigured() && inFlight?.length) {
      for (const post of inFlight) {
        if (!post.buffer_post_id) continue;
        try {
          const bufferPost = await getBufferPost(post.buffer_post_id);
          if (bufferPost.status === "sent") {
            await supabase.from("linkedin_drafts").update({
              buffer_status: bufferPost.status,
              buffer_error: null,
              scheduled_date: bufferPost.sentAt || new Date().toISOString(),
            }).eq("id", post.id);
          } else if (bufferPost.status === "error") {
            await supabase.from("linkedin_drafts").update({
              status: "Pending Review",
              scheduled_for: null,
              buffer_status: "error",
              buffer_error: bufferPost.error || "Buffer reported a publishing error",
            }).eq("id", post.id);
          }
        } catch (err) {
          console.error(`Buffer reconcile failed for ${post.id}: ${(err as Error).message}`);
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

        if (isBufferConfigured()) {
          if (post.buffer_post_id) {
            const bufferPost = await getBufferPost(post.buffer_post_id);
            if (bufferPost.status === "sent") {
              update = {
                status: "Published",
                linkedin_post_id: bufferPost.id,
                scheduled_date: bufferPost.sentAt || new Date().toISOString(),
                buffer_status: bufferPost.status,
                buffer_error: null,
                platform_post_id: bufferPost.id,
              };
            } else if (bufferPost.status === "error") {
              await supabase.from("linkedin_drafts").update({
                status: "Pending Review",
                scheduled_for: null,
                buffer_status: "error",
                buffer_error: bufferPost.error || "Buffer reported a publishing error",
              }).eq("id", post.id);
              continue;
            } else {
              continue;
            }
          } else {
            const bufferPost = await createBufferPost({
              post: post.draft,
              imageUrl: post.image_url || "",
              firstComment: post.first_comment || "",
              now: true,
            });
            if (bufferPost.status === "error") {
              await supabase.from("linkedin_drafts").update({
                status: "Pending Review",
                scheduled_for: null,
                publishing_provider: "buffer",
                buffer_post_id: bufferPost.id,
                buffer_status: bufferPost.status,
                buffer_error: bufferPost.error || "Buffer reported a publishing error",
                platform_post_id: bufferPost.id,
                submitted_at: new Date().toISOString(),
              }).eq("id", post.id);
              continue;
            }
            update = {
              status: "Published",
              linkedin_post_id: bufferPost.id,
              scheduled_date: bufferPost.sentAt || new Date().toISOString(),
              publishing_provider: "buffer",
              buffer_post_id: bufferPost.id,
              buffer_status: bufferPost.status,
              buffer_error: bufferPost.error || null,
              platform_post_id: bufferPost.id,
              submitted_at: new Date().toISOString(),
            };
          }
        } else {
          const webhookRes = await fetch(MAKE_WEBHOOK, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ draft: cleanPostText(post.draft), image_url: post.image_url || "", first_comment: post.first_comment || "" }),
          });

          if (!webhookRes.ok) {
            console.error(`Webhook failed for ${post.id}: ${webhookRes.status}`);
            continue;
          }

          update = {
            status: "Published",
            linkedin_post_id: "via-webhook",
            scheduled_date: new Date().toISOString(),
            publishing_provider: "make",
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
