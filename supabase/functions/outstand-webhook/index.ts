import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-outstand-signature",
};

function toHex(buffer: ArrayBuffer) {
  return Array.from(new Uint8Array(buffer))
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function verifySignature(rawBody: string, signature: string | null) {
  const secret = Deno.env.get("OUTSTAND_WEBHOOK_SECRET");
  if (!secret) return true;
  if (!signature) return false;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, encoder.encode(rawBody));
  return signature === `sha256=${toHex(digest)}`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const rawBody = await req.text();
    const signature = req.headers.get("x-outstand-signature");
    if (!(await verifySignature(rawBody, signature))) {
      return new Response(JSON.stringify({ ok: false, error: "Invalid signature" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const event = JSON.parse(rawBody);
    const postId = event?.data?.postId || event?.data?.post?.id;
    if (!postId) {
      return new Response(JSON.stringify({ ok: true, ignored: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const accounts = event?.data?.socialAccounts || [];
    const publishedAccount = accounts.find((account: any) => account.platformPostId || account.platform_post_id);
    const failedAccount = accounts.find((account: any) => account.error);
    const platformPostId = publishedAccount?.platformPostId || publishedAccount?.platform_post_id || null;

    if (event.event === "post.published") {
      const { error } = await supabase
        .from("linkedin_drafts")
        .update({
          status: "Published",
          linkedin_post_id: platformPostId || postId,
          scheduled_date: event.timestamp || new Date().toISOString(),
          publishing_provider: "outstand",
          outstand_status: failedAccount ? "published_with_errors" : "published",
          outstand_error: failedAccount?.error || null,
          platform_post_id: platformPostId,
        })
        .eq("outstand_post_id", postId);
      if (error) throw new Error(error.message);
    } else if (event.event === "post.error") {
      const errorMessage = failedAccount?.error || "Outstand reported a publishing failure";
      const { error } = await supabase
        .from("linkedin_drafts")
        .update({
          status: "Pending Review",
          publishing_provider: "outstand",
          outstand_status: "failed",
          outstand_error: errorMessage,
        })
        .eq("outstand_post_id", postId);
      if (error) throw new Error(error.message);
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
