export interface BufferPostInput {
  post: string;
  imageUrl?: string | null;
  firstComment?: string | null;
  scheduledAt?: string | null;
  now?: boolean;
}

export interface BufferPostResult {
  id: string;
  status: string;
  dueAt: string | null;
  sentAt: string | null;
  error: string | null;
}

const BUFFER_ENDPOINT = "https://api.buffer.com";

export function cleanPostText(value: string) {
  return (value || "")
    .replace(/\[IMAGE:.*?\]\s*/gis, "")
    .replace(/^Source:\s*https?:\/\/\S+\s*$/gim, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function isBufferConfigured() {
  return Boolean(Deno.env.get("BUFFER_API_KEY") && Deno.env.get("BUFFER_CHANNEL_ID"));
}

function bufferHeaders() {
  const key = Deno.env.get("BUFFER_API_KEY");
  if (!key) throw new Error("BUFFER_API_KEY is not configured");
  return {
    "Authorization": `Bearer ${key}`,
    "Content-Type": "application/json",
  };
}

async function bufferGraphql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(BUFFER_ENDPOINT, {
    method: "POST",
    headers: bufferHeaders(),
    body: JSON.stringify({ query, variables }),
  });
  const data = await res.json();
  if (!res.ok || data.errors?.length) {
    const message = data.errors?.map((err: any) => err.message).join("; ") || `${res.status} ${res.statusText}`;
    throw new Error(message);
  }
  return data.data as T;
}

function normalizePost(post: any): BufferPostResult {
  return {
    id: String(post.id || ""),
    status: String(post.status || ""),
    dueAt: post.dueAt || null,
    sentAt: post.sentAt || null,
    error: post.error?.message || null,
  };
}

function skippedFirstCommentMessage() {
  return "First comment skipped: Buffer requires a paid plan for LinkedIn first comments.";
}

function appendFirstCommentWarning(result: BufferPostResult) {
  return {
    ...result,
    error: [result.error, skippedFirstCommentMessage()].filter(Boolean).join(" | ") || null,
  };
}

function isFirstCommentPlanError(err: unknown) {
  return /first comment requires a paid plan/i.test((err as Error).message || "");
}

function createInput(input: BufferPostInput, includeFirstComment = true) {
  const body: Record<string, unknown> = {
    text: cleanPostText(input.post),
    channelId: Deno.env.get("BUFFER_CHANNEL_ID"),
    schedulingType: "automatic",
    mode: input.now ? "shareNow" : "customScheduled",
    source: "mastodon-outreach",
    aiAssisted: true,
  };

  if (!input.now) body.dueAt = input.scheduledAt;
  if (input.imageUrl) {
    body.assets = { images: [{ url: input.imageUrl }] };
  }
  if (includeFirstComment && input.firstComment?.trim()) {
    body.metadata = { linkedin: { firstComment: input.firstComment.trim() } };
  }
  return body;
}

export async function createBufferPost(input: BufferPostInput): Promise<BufferPostResult> {
  const run = async (includeFirstComment = true) => {
    const data = await bufferGraphql<{ createPost: any }>(`
    mutation CreatePost($input: CreatePostInput!) {
      createPost(input: $input) {
        ... on PostActionSuccess {
          post {
            id
            status
            dueAt
            sentAt
            error { message }
          }
        }
        ... on MutationError { message }
      }
    }
  `, { input: createInput(input, includeFirstComment) });

    if (data.createPost?.message) throw new Error(data.createPost.message);
    const post = data.createPost?.post;
    if (!post?.id) throw new Error("Buffer did not return a post id");
    return normalizePost(post);
  };

  try {
    return await run();
  } catch (err) {
    if (input.firstComment?.trim() && isFirstCommentPlanError(err)) {
      const result = await run(false);
      return appendFirstCommentWarning(result);
    }
    throw err;
  }
}

export async function upsertScheduledBufferPost(
  postId: string | null | undefined,
  input: BufferPostInput,
): Promise<BufferPostResult> {
  if (postId) {
    try {
      await deleteBufferPost(postId);
    } catch (err) {
      console.error(`Buffer delete before replacement failed: ${(err as Error).message}`);
    }
  }
  return await createBufferPost(input);
}

export async function getBufferPost(postId: string): Promise<BufferPostResult> {
  const data = await bufferGraphql<{ post: any }>(`
    query GetPost($input: PostInput!) {
      post(input: $input) {
        id
        status
        dueAt
        sentAt
        error { message }
      }
    }
  `, { input: { id: postId } });

  if (!data.post?.id) throw new Error("Buffer post not found");
  return normalizePost(data.post);
}

export async function deleteBufferPost(postId?: string | null) {
  if (!postId) return;
  const data = await bufferGraphql<{ deletePost: any }>(`
    mutation DeletePost($input: DeletePostInput!) {
      deletePost(input: $input) {
        ... on DeletePostSuccess { id }
        ... on MutationError { message }
      }
    }
  `, { input: { id: postId } });

  if (data.deletePost?.message) throw new Error(data.deletePost.message);
}
