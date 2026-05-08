export interface ZernioPostInput {
  post: string;
  imageUrl?: string | null;
  firstComment?: string | null;
  scheduledAt?: string | null;
  useQueue?: boolean;
  now?: boolean;
}

export interface ZernioPostResult {
  id: string;
  status: string;
  dueAt: string | null;
  sentAt: string | null;
  error: string | null;
  platformPostUrl: string | null;
}

const ZERNIO_BASE = "https://zernio.com/api/v1";

export function cleanPostText(value: string) {
  return (value || "")
    .replace(/\[IMAGE:.*?\]\s*/gis, "")
    .replace(/^Source:\s*https?:\/\/\S+\s*$/gim, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function isZernioConfigured() {
  return Boolean(Deno.env.get("ZERNIO_API_KEY") && Deno.env.get("ZERNIO_LINKEDIN_ACCOUNT_ID"));
}

function zernioHeaders() {
  const key = Deno.env.get("ZERNIO_API_KEY");
  if (!key) throw new Error("ZERNIO_API_KEY is not configured");
  return {
    "Authorization": `Bearer ${key}`,
    "Content-Type": "application/json",
  };
}

async function zernioFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${ZERNIO_BASE}${path}`, {
    ...options,
    headers: { ...zernioHeaders(), ...(options.headers || {}) },
  });
  const data = await res.json();
  if (!res.ok) {
    const message = data.message || data.error || `${res.status} ${res.statusText}`;
    throw new Error(message);
  }
  return data as T;
}

function normalizePost(post: any): ZernioPostResult {
  const lnPlatform = post.platforms?.find((p: any) => p.platform === "linkedin");
  return {
    id: String(post._id || post.id || ""),
    status: lnPlatform?.status || post.status || "",
    dueAt: lnPlatform?.scheduledFor || post.scheduledFor || null,
    sentAt: lnPlatform?.publishedAt || null,
    error: lnPlatform?.errorMessage || null,
    platformPostUrl: lnPlatform?.platformPostUrl || null,
  };
}

export async function createZernioPost(input: ZernioPostInput): Promise<ZernioPostResult> {
  const accountId = Deno.env.get("ZERNIO_LINKEDIN_ACCOUNT_ID");
  if (!accountId) throw new Error("ZERNIO_LINKEDIN_ACCOUNT_ID is not configured");

  const body: Record<string, unknown> = {
    content: cleanPostText(input.post),
    platforms: [{ platform: "linkedin", accountId }],
    timezone: "America/New_York",
  };

  if (input.now) {
    body.publishNow = true;
  } else if (input.scheduledAt) {
    body.scheduledFor = input.scheduledAt;
  } else if (input.useQueue) {
    const profileId = Deno.env.get("ZERNIO_QUEUE_PROFILE_ID");
    if (profileId) {
      body.queuedFromProfile = profileId;
    } else {
      body.scheduledFor = input.scheduledAt;
    }
  }

  if (input.imageUrl) {
    body.mediaItems = [{ type: "image", url: input.imageUrl }];
  }

  const data = await zernioFetch<{ post: any }>("/posts", {
    method: "POST",
    body: JSON.stringify(body),
  });

  if (!data.post?._id) throw new Error("Zernio did not return a post id");
  return normalizePost(data.post);
}

export async function getZernioPost(postId: string): Promise<ZernioPostResult> {
  const data = await zernioFetch<any>(`/posts/${postId}`);
  const post = data.post || data;
  if (!post._id && !post.id) throw new Error("Zernio post not found");
  return normalizePost(post);
}

export async function deleteZernioPost(postId?: string | null) {
  if (!postId) return;
  await zernioFetch(`/posts/${postId}`, { method: "DELETE" });
}

export async function upsertScheduledZernioPost(
  postId: string | null | undefined,
  input: ZernioPostInput,
): Promise<ZernioPostResult> {
  if (postId) {
    try {
      await deleteZernioPost(postId);
    } catch (err) {
      console.error(`Zernio delete before replacement failed: ${(err as Error).message}`);
    }
  }
  return await createZernioPost(input);
}
