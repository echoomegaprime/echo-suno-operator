import { sessionJwt } from "./clerk.js";

// studio-api.prod.suno.com — billing / session / feed (poll). Verified live 2026-08-22.
const STUDIO = () => (process.env.SUNO_STUDIO_API || "https://studio-api.suno.ai").replace(/\/$/, "");
// studio-api-prod.suno.com — the CURRENT song-generation host (note the hyphen, NOT a dot).
// The web client posts to /api/generate/v2-web/ here; the old studio-api.prod .../v2/ path is
// deprecated and defaults callers to chirp-v4. Verified via CDP capture of a real v5.5 generation.
const GEN_API = () => (process.env.SUNO_GENERATE_API || "https://studio-api-prod.suno.com").replace(/\/$/, "");
// ShadowGlass Chrome CDP endpoint — used ONLY to mint a fresh Cloudflare Turnstile token from the
// live signed-in suno.com tab (the token gate is risk-scored and can re-activate server-side).
const CDP_URL = () => (process.env.SUNO_CDP_URL || "http://127.0.0.1:9222").replace(/\/$/, "");
// v5.5 == chirp-fenix (major_model_version "v5.5"). Overridable per-call via input.mv.
const DEFAULT_MV = process.env.SUNO_DEFAULT_MV || "chirp-fenix";

// A stable per-process device fingerprint id, used only if we cannot read the browser's real one.
let _fallbackDeviceId = process.env.SUNO_DEVICE_ID || null;
function fallbackDeviceId() {
  if (!_fallbackDeviceId) _fallbackDeviceId = crypto.randomUUID();
  return _fallbackDeviceId;
}

// browser-token header: the web client sends {"token": base64(JSON({"timestamp": <ms>}))}.
function browserToken() {
  const inner = Buffer.from(JSON.stringify({ timestamp: Date.now() })).toString("base64");
  return JSON.stringify({ token: inner });
}

// Decode a JWT payload (no verification) to read non-secret claims (plan/user_tier).
function jwtClaims(jwt) {
  try {
    const p = jwt.split(".")[1];
    return JSON.parse(Buffer.from(p.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
  } catch {
    return {};
  }
}

/**
 * Mint a FRESH Cloudflare Turnstile token from the live signed-in suno.com tab over CDP, and
 * read the browser's real suno_device_id. Best-effort: returns {token:null} on any failure so
 * generation still proceeds when the server is not enforcing the gate (its current state) or
 * when ShadowGlass is unreachable. Never touches or exposes the session cookie.
 */
async function mintTurnstile(timeoutMs = 9000) {
  const out = { token: null, deviceId: null, via: null };
  let ws;
  try {
    const targets = await (await fetch(`${CDP_URL()}/json`, { signal: AbortSignal.timeout(4000) })).json();
    const tab = targets.find((t) => t.type === "page" && /suno\.com/.test(t.url || ""));
    if (!tab || !tab.webSocketDebuggerUrl) {
      out.via = "no-suno-tab";
      return out;
    }
    ws = new WebSocket(tab.webSocketDebuggerUrl);
    await new Promise((res, rej) => {
      ws.onopen = res;
      ws.onerror = () => rej(new Error("cdp-open-failed"));
      setTimeout(() => rej(new Error("cdp-open-timeout")), 4000);
    });
    const expr = `(async () => {
      try {
        const ck = document.cookie.match(/suno_device_id=([^;]+)/);
        const deviceId = ck ? decodeURIComponent(ck[1]) : null;
        if (!window.turnstile || !window.turnstile.execute) return { token: null, deviceId, err: 'no-turnstile' };
        const el = [...document.querySelectorAll('[id^="cf-chl-widget-"]')].find(e => /_response$/.test(e.id));
        const wid = el ? el.id.replace(/^cf-chl-widget-/, '').replace(/_response$/, '') : undefined;
        let prev = ''; try { prev = window.turnstile.getResponse(wid) || ''; } catch (e) {}
        try { window.turnstile.execute(wid, {}); } catch (e) {}
        const start = Date.now(); let tok = prev;
        while (Date.now() - start < 7000) {
          await new Promise(r => setTimeout(r, 300));
          try { tok = window.turnstile.getResponse(wid) || tok; } catch (e) {}
          if (tok && tok !== prev) break;
        }
        return { token: (tok && tok !== prev) ? tok : (tok || null), deviceId };
      } catch (e) { return { token: null, deviceId: null, err: String(e) }; }
    })()`;
    const result = await new Promise((res, rej) => {
      const id = 1;
      const timer = setTimeout(() => rej(new Error("cdp-eval-timeout")), timeoutMs);
      ws.onmessage = (m) => {
        try {
          const msg = JSON.parse(m.data);
          if (msg.id === id) {
            clearTimeout(timer);
            res(msg.result?.result?.value ?? null);
          }
        } catch { /* ignore non-JSON frames */ }
      };
      ws.send(JSON.stringify({
        id,
        method: "Runtime.evaluate",
        params: { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true },
      }));
    });
    if (result && result.token) {
      out.token = result.token;
      out.via = "turnstile.execute";
    } else {
      out.via = result?.err || "no-token";
    }
    if (result && result.deviceId) out.deviceId = result.deviceId;
  } catch (e) {
    out.via = "cdp-error:" + (e?.message || String(e));
  } finally {
    try { ws?.close(); } catch { /* noop */ }
  }
  return out;
}

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
  const { jwt } = await sessionJwt(cookie);
  const claims = jwtClaims(jwt);
  const userTier = (claims.plan ? String(claims.plan).split(":")[0] : null) || null;

  // Custom (own-lyrics) vs simple (description) create — mirrors the web client's two modes.
  const custom = Boolean(input.custom || input.lyrics);
  const description = input.gpt_description_prompt || input.description || (custom ? "" : input.prompt || "");
  const lyrics = custom ? (input.lyrics || input.prompt || "") : "";

  // Best-effort: mint a fresh Turnstile token + read the browser's device-id from ShadowGlass.
  const minted = await mintTurnstile();
  const deviceId = minted.deviceId || fallbackDeviceId();

  const payload = {
    generation_type: "TEXT",
    mv: input.mv || DEFAULT_MV,
    prompt: lyrics,                         // lyrics for custom mode; "" for simple/description mode
    gpt_description_prompt: description,     // the "Song Description" box
    tags: custom ? (input.tags || "") : undefined,
    title: input.title || "",
    make_instrumental: Boolean(input.instrumental),
    user_uploaded_images_b64: null,
    metadata: {
      web_client_pathname: "/create",
      is_max_mode: false,
      is_mumble: false,
      create_mode: custom ? "custom" : "simple",
      ...(userTier ? { user_tier: userTier } : {}),
      create_session_token: crypto.randomUUID(),
      disable_volume_normalization: false,
      lyrics_model: "default",
    },
    override_fields: [],
    cover_clip_id: null,
    cover_start_s: null,
    cover_end_s: null,
    persona_id: null,
    artist_clip_id: null,
    artist_start_s: null,
    artist_end_s: null,
    continue_clip_id: null,
    continued_aligned_prompt: null,
    continue_at: null,
    transaction_uuid: crypto.randomUUID(),
    token_provider: 2,
    ...(minted.token ? { token: minted.token } : {}),
  };
  // Drop undefined keys so the JSON matches the web client's body shape.
  for (const k of Object.keys(payload)) if (payload[k] === undefined) delete payload[k];

  const res = await fetch(`${GEN_API()}/api/generate/v2-web/`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${jwt}`,
      "Content-Type": "application/json",
      "accept-language": "en",
      "device-id": deviceId,
      "browser-token": browserToken(),
      Origin: "https://suno.com",
      Referer: "https://suno.com/",
    },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text.slice(0, 400) }; }
  if (!res.ok) {
    const err = new Error(`Suno ${res.status} /api/generate/v2-web/`);
    err.status = res.status;
    err.body = body;
    err.token_via = minted.via; // surfaces WHY a token was/wasn't attached, without leaking it
    throw err;
  }

  const clips = Array.isArray(body) ? body : body?.clips ?? body?.data ?? [];
  const ids = (clips.length ? clips : [body])
    .map((c) => c?.id || c?.clip_id)
    .filter(Boolean);
  return { ids, raw: body, model: input.mv || DEFAULT_MV, token_via: minted.via };
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
