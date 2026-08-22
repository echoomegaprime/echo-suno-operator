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

/**
 * List the owner's trained Voices (v5.5). Voices are surfaced by Suno's persona API:
 * GET studio-api-prod.suno.com/api/persona/get-personas/?page=N (verified live via CDP capture
 * of the Create > Voice panel, 2026-08-22). Each persona row carries id/name/image + ownership
 * flags; `voice_persona_count` in the envelope counts the voice-type personas specifically.
 * Returns an empty list (ok, not an error) when the owner has trained no voices yet.
 * Never exposes the cookie.
 */
export async function voices(cookie) {
  const { jwt } = await sessionJwt(cookie);
  const deviceId = fallbackDeviceId();
  const all = [];
  let page = 1;
  let envelope = {};
  // Paginate defensively; cap at 50 pages so a malformed count can never loop forever.
  for (; page <= 50; page++) {
    const res = await fetch(`${GEN_API()}/api/persona/get-personas/?page=${page}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${jwt}`,
        "accept-language": "en",
        "device-id": deviceId,
        "browser-token": browserToken(),
        Origin: "https://suno.com",
        Referer: "https://suno.com/",
      },
    });
    const text = await res.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text.slice(0, 400) }; }
    if (!res.ok) {
      const err = new Error(`Suno ${res.status} /api/persona/get-personas/`);
      err.status = res.status;
      err.body = body;
      throw err;
    }
    envelope = body || {};
    const rows = Array.isArray(body) ? body : body?.personas ?? body?.data ?? [];
    for (const p of rows) all.push(p);
    const total = Number(body?.total_results ?? rows.length);
    if (!rows.length || all.length >= total) break;
  }
  const list = all.map((p) => ({
    id: p?.id || p?.persona_id || null,
    name: p?.name || p?.display_name || p?.persona_name || null,
    image_url: p?.image_url || p?.image_s3_id || p?.avatar || null,
    is_owned: p?.is_owned ?? null,
    is_public: p?.is_public ?? null,
    // Best-effort voice flag: the voices feature is persona-backed; keep any hint the API exposes.
    is_voice: p?.is_voice ?? p?.is_vox_persona ?? p?.has_vox ?? null,
  })).filter((v) => v.id);
  return {
    voices: list,
    total_results: Number(envelope?.total_results ?? list.length),
    voice_persona_count: envelope?.voice_persona_count ?? null,
    max_voice_personas: envelope?.max_voice_personas ?? null,
  };
}

/**
 * Resolve an input.voice (a persona/voice UUID, or a case-insensitive voice NAME) to a persona id.
 * Only hits the network when a voice was requested. Returns { id, name } or throws a clear error.
 */
async function resolveVoiceId(cookie, voice) {
  const wanted = String(voice).trim();
  if (!wanted) return null;
  let listing;
  try {
    listing = await voices(cookie);
  } catch (e) {
    // If listing fails but the input already looks like an id, fall through and use it raw.
    if (/^[0-9a-f-]{16,}$/i.test(wanted)) return { id: wanted, name: null };
    throw e;
  }
  const byId = listing.voices.find((v) => v.id === wanted);
  if (byId) return { id: byId.id, name: byId.name };
  const byName = listing.voices.find(
    (v) => v.name && v.name.toLowerCase() === wanted.toLowerCase()
  );
  if (byName) return { id: byName.id, name: byName.name };
  // Not in the list. If it's UUID-shaped, trust it (list may be paginated/eventually-consistent).
  if (/^[0-9a-f-]{16,}$/i.test(wanted)) return { id: wanted, name: null };
  const names = listing.voices.map((v) => v.name).filter(Boolean);
  const err = new Error(
    `Voice not found: "${wanted}". ${names.length ? "Trained voices: " + names.join(", ") : "You have no trained voices yet — train one in-account first (see suno_train_voice_guide)."}`
  );
  err.status = 404;
  throw err;
}

export async function generate(cookie, input) {
  const { jwt } = await sessionJwt(cookie);
  const claims = jwtClaims(jwt);
  const userTier = (claims.plan ? String(claims.plan).split(":")[0] : null) || null;

  // v5.5 Voice: resolve the requested voice (id or name) to a persona id, and set Audio Influence.
  // Verified body shape (CDP bundle capture 2026-08-22): a selected voice sets top-level
  // `persona_id`; "Audio Influence" is `metadata.control_sliders.audio_weight` (0-100, client
  // default 25). The Suno help doc recommends pushing Audio Influence HIGH when singing through a
  // voice, so when a voice is set and no explicit value is given we default it to 75.
  let resolvedVoice = null;
  if (input.voice) resolvedVoice = await resolveVoiceId(cookie, input.voice);
  let audioWeight = null;
  if (input.audio_influence !== undefined && input.audio_influence !== null && input.audio_influence !== "") {
    audioWeight = Math.max(0, Math.min(100, Math.round(Number(input.audio_influence))));
  } else if (resolvedVoice) {
    audioWeight = 75; // recommended-high default when singing through a voice
  }

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
      // Audio Influence lives here: control_sliders.audio_weight. The v2-web API requires the
      // sliders as 0.0-1.0 FLOATS (the UI 0-100 / audioWeight is divided by 100); sending integers
      // 400s with "slider value must be between 0.0 and 1.0". Only sent when a voice is selected or
      // the caller set audio_influence — mirrors the web client's assembled object.
      ...(audioWeight !== null
        ? { control_sliders: { weirdness_constraint: 0.5, style_weight: 0.5, audio_weight: audioWeight / 100 } }
        : {}),
    },
    override_fields: [],
    cover_clip_id: null,
    cover_start_s: null,
    cover_end_s: null,
    persona_id: resolvedVoice ? resolvedVoice.id : null,
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
  return {
    ids,
    raw: body,
    model: input.mv || DEFAULT_MV,
    token_via: minted.via,
    voice: resolvedVoice ? { id: resolvedVoice.id, name: resolvedVoice.name } : null,
    audio_influence: audioWeight,
  };
}

/**
 * Static training guide for creating a Suno v5.5 Voice. This is the ONE step that cannot be
 * automated: Suno shows a random phrase and matches your live speech to the uploaded recording
 * (anti-spoofing), so only the account owner, live and in-account, can complete it. Source:
 * help.suno.com/en/articles/11362369 + /11362433 (Knowledge Forge suno-voices-v5-5-feature-flow).
 */
export function voiceGuide() {
  return {
    feature: "Suno v5.5 Voices",
    what: "Sing Suno songs in your OWN voice (a vocal persona, not a frame-perfect clone). Replaces 'Personas' in the Create menu; Style Personas still live inside Voices. v5.5 (chirp-fenix) only.",
    requirements: [
      "Pro or Premier subscription",
      "18+",
      "Geo-limited (rolling out to more regions)",
      "You must be the account owner — a voice can only be trained by its owner, live and in-account",
    ],
    can_automate: {
      list_voices: "YES — suno_voices / GET /v1/voices",
      generate_with_voice: "YES — suno_generate with voice + audio_influence, or POST /v1/generate",
      train_voice: "NO — the live random-phrase verification (step 5) is an anti-spoof check that requires the human, live, in the account. This guide walks you through it.",
    },
    steps: [
      "1. Go to Create and click 'Add Voice' (or 'Try Now' / the 'Voice' control in the Create panel).",
      "2. Choose an audio source (3 options): use a voice from a song in your library · record in real time · upload a file.",
      "3. Provide 15 seconds to 4 minutes of audio (pick your best ~2-minute segment). Acapella is best; background music is auto stem-split.",
      "4. Preview, then click 'Use Voice'.",
      "5. LIVE VERIFICATION (cannot be automated): Suno shows a random phrase — read it aloud in a quiet room. It matches your speech to the uploaded recording AND confirms you spoke the shown words.",
      "6. Optionally set skill level, an image, and a voice name; check the rights-confirmation box, then Save.",
    ],
    then_use: "Once trained, list it with suno_voices and sing through it: suno_generate { voice: '<id or name>', audio_influence: 75, prompt: '<lyrics>', tags: '<style>', title: '<title>' }. Push Audio Influence high (0-100, default when a voice is set = 75) so your voice comes through strongly.",
    limits: [
      "Private: only you can generate with your voice. Voices cannot be shared directly.",
      "Published songs can be remixed/covered by others only if you allow it in publish settings.",
      "v5.5 (chirp-fenix) only.",
    ],
    note: "Suno Voices SING. ElevenLabs professional voice clones only SPEAK — an ElevenLabs render of a song comes out spoken-word. To get your voice SINGING over a Suno beat, train a Voice here (the one live step) then generate through it.",
  };
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
