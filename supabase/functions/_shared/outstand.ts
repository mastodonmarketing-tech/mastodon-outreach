export interface OutstandCreateInput {
  post: string;
  imageUrl?: string | null;
  firstComment?: string | null;
  scheduledAt?: string | null;
}

export interface OutstandCreateResult {
  id: string;
  status: string;
  platformPostId: string | null;
  publishedAt: string | null;
  raw: any;
}

const OUTSTAND_BASE_URL = "https://api.outstand.so";

export function isOutstandConfigured() {
  return Boolean(Deno.env.get("OUTSTAND_API_KEY"));
}

export function cleanPostText(value: string) {
  return (value || "").replace(/\[IMAGE:.*?\]\s*/gis, "").trim();
}

function outstandHeaders() {
  const key = Deno.env.get("OUTSTAND_API_KEY");
  if (!key) throw new Error("OUTSTAND_API_KEY is not configured");
  return {
    "Authorization": `Bearer ${key}`,
    "Content-Type": "application/json",
  };
}

function outstandAccounts() {
  const raw = Deno.env.get("OUTSTAND_ACCOUNTS") || Deno.env.get("OUTSTAND_LINKEDIN_ACCOUNT") || "linkedin";
  return raw.split(",").map(item => item.trim()).filter(Boolean);
}

function accountField() {
  return Deno.env.get("OUTSTAND_ACCOUNT_FIELD") || "accounts";
}

async function parseOutstandResponse(res: Response) {
  const text = await res.text();
  let body: any = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { error: text };
  }

  if (!res.ok || body.success === false) {
    const detail = body.error || body.message || body.details || text || `${res.status} ${res.statusText}`;
    throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail).slice(0, 500));
  }

  return body;
}

function normalizeOutstandPost(body: any): OutstandCreateResult {
  const post = body.post || body.data || body;
  const socialAccounts = post.socialAccounts || post.social_accounts || [];
  const publishedAccount = socialAccounts.find((account: any) => account.platformPostId || account.platform_post_id);
  const failedAccount = socialAccounts.find((account: any) => account.status === "failed" || account.error);
  const allPublished = socialAccounts.length > 0 && socialAccounts.every((account: any) => account.status === "published" || account.publishedAt);

  return {
    id: String(post.id || body.id || ""),
    status: failedAccount ? "failed" : (post.publishedAt || allPublished ? "published" : "scheduled"),
    platformPostId: publishedAccount?.platformPostId || publishedAccount?.platform_post_id || null,
    publishedAt: post.publishedAt || publishedAccount?.publishedAt || null,
    raw: post,
  };
}

export async function createOutstandPost(input: OutstandCreateInput): Promise<OutstandCreateResult> {
  const rootContainer: any = { content: cleanPostText(input.post) };
  if (input.imageUrl) rootContainer.media = [{ url: input.imageUrl }];

  const containers = [rootContainer];
  const comment = (input.firstComment || "").trim();
  if (comment) containers.push({ content: comment });

  const body: any = {
    containers,
    [accountField()]: outstandAccounts(),
  };
  if (input.scheduledAt) body.scheduledAt = input.scheduledAt;

  const res = await fetch(`${OUTSTAND_BASE_URL}/v1/posts/`, {
    method: "POST",
    headers: outstandHeaders(),
    body: JSON.stringify(body),
  });
  const data = await parseOutstandResponse(res);
  const result = normalizeOutstandPost(data);
  if (!result.id) throw new Error("Outstand did not return a post id");
  return result;
}

export async function getOutstandPost(postId: string): Promise<OutstandCreateResult> {
  const res = await fetch(`${OUTSTAND_BASE_URL}/v1/posts/${postId}`, {
    headers: outstandHeaders(),
  });
  const data = await parseOutstandResponse(res);
  return normalizeOutstandPost(data);
}

export async function cancelOutstandPost(postId?: string | null) {
  if (!postId) return;
  const res = await fetch(`${OUTSTAND_BASE_URL}/v1/posts/${postId}`, {
    method: "DELETE",
    headers: outstandHeaders(),
  });
  await parseOutstandResponse(res);
}
