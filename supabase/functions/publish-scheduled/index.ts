import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  cleanPostText,
  createOutstandPost,
  getOutstandPost,
  isOutstandConfigured,
} from "../_shared/outstand.ts";

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
      .select("id, draft, image_url, first_comment, outstand_post_id")
      .eq("status", "Scheduled")
      .not("scheduled_for", "is", null)
      .lte("scheduled_for", now);

    if (error) throw new Error(`Query failed: ${error.message}`);
    if (!due || due.length === 0) {
      return new Response(JSON.stringify({ ok: true, published: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let published = 0;

    for (const post of due) {
      try {
        let update: Record<string, any> | null = null;

        if (isOutstandConfigured()) {
          if (post.outstand_post_id) {
            const outstand = await getOutstandPost(post.outstand_post_id);
            if (outstand.status === "published") {
              update = {
                status: "Published",
                linkedin_post_id: outstand.platformPostId || outstand.id,
                scheduled_date: outstand.publishedAt || new Date().toISOString(),
                outstand_status: outstand.status,
                outstand_error: null,
                platform_post_id: outstand.platformPostId || null,
              };
            } else if (outstand.status === "failed") {
              await supabase.from("linkedin_drafts").update({
                status: "Pending Review",
                outstand_status: "failed",
                outstand_error: "Outstand reported a publishing failure",
              }).eq("id", post.id);
              continue;
            } else {
              continue;
            }
          } else {
            const outstand = await createOutstandPost({
              post: post.draft,
              imageUrl: post.image_url || "",
              firstComment: post.first_comment || "",
            });
            update = {
              status: "Published",
              linkedin_post_id: outstand.platformPostId || outstand.id,
              scheduled_date: outstand.publishedAt || new Date().toISOString(),
              publishing_provider: "outstand",
              outstand_post_id: outstand.id,
              outstand_status: outstand.status,
              outstand_error: null,
              platform_post_id: outstand.platformPostId || null,
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
