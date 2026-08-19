import { sessionJwt } from "./clerk.js";

const STUDIO = () => (process.env.SUNO_STUDIO_API || "https://studio-api.suno.ai").replace(/\/$/, "");

async function studio(cookie, path, init = {}) {
  const { jwt } = await sessionJwt(cookie);
  const res = await fetch(`${STUDIO()}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${jwt}`,
      "Content-Type": "application/json",
      Origin: "https://suno.com",
      Referer: "https://suno.com/",
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text.slice(0, 400) };
  }
  if (!res.ok) {
    const err = new Error(`Suno ${res.status} ${path}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

export async function whoAmI(cookie) {
  const auth = await sessionJwt(cookie);
  let credits = null;
  let handle = auth.name;
  try {
    const billing = await studio(cookie, "/api/billing/info/");
    credits =
      billing?.total_credits_left ??
      billing?.credits ??
      billing?.monthly_limit ??
      null;
  } catch {
    try {
      const me = await studio(cookie, "/api/session/");
      handle = me?.user?.display_name || me?.display_name || handle;
      credits = me?.user?.credits ?? me?.credits ?? credits;
    } catch {
      /* cookie worked for Clerk; studio extras optional */
    }
  }
  return {
    authenticated: true,
    session_id: auth.sessionId,
    name: handle,
    credits,
    provider: "suno.com session",
  };
}

export async function generate(cookie, input) {
  const payload = {
    prompt: input.prompt,
    tags: input.tags || "",
    title: input.title || "Untitled",
    make_instrumental: Boolean(input.instrumental),
    wait_audio: false,
    mv: input.mv || "chirp-v4",
  };
  const body = await studio(cookie, "/api/generate/v2/", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  const clips = Array.isArray(body) ? body : body?.clips ?? body?.data ?? [];
  const ids = (clips.length ? clips : [body])
    .map((c) => c?.id || c?.clip_id)
    .filter(Boolean);
  return { ids, raw: body };
}

export async function poll(cookie, ids) {
  const q = ids.filter(Boolean).join(",");
  if (!q) return [];
  const body = await studio(cookie, `/api/feed/?ids=${encodeURIComponent(q)}`);
  const list = Array.isArray(body) ? body : body?.clips ?? body?.data ?? [];
  return list.map((c) => ({
    id: c.id,
    title: c.title,
    status: c.status,
    audio_url: c.audio_url || c.audio_url_wav || null,
    image_url: c.image_url || null,
    metadata: c.metadata || null,
  }));
}
