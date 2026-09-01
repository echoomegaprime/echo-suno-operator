import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readCookie, publicHint } from "./vault.js";
import { generate, poll, whoAmI, voices, voiceGuide, library } from "./suno.js";

export const RESOURCE = {
  id: "oauth-mcp-suno-session-v1",
  path: "/oauth-mcp-suno-session-v1",
  name: "Echo Suno Operator MCP v1",
  canonical: "https://mcp.echo-op.com/oauth-mcp-suno-session-v1",
};

// ---- OpenAI Apps SDK / MCP Apps UI component ---------------------------------
// The embedded in-chat panel. ChatGPT mounts it in an iframe when a tool whose
// descriptor carries _meta["openai/outputTemplate"] (== _meta.ui.resourceUri)
// pointing at this URI is called. The resource is served with the MCP Apps mime
// type `text/html;profile=mcp-app` — the field that makes ChatGPT render a
// COMPONENT instead of plain structured content (docs: Apps SDK build/mcp-server
// + deploy/troubleshooting "Structured content only, no component").
const UI_TEMPLATE_URI = "ui://widget/suno-studio.html";
const RESOURCE_MIME_TYPE = "text/html;profile=mcp-app";
const WIDGET_DOMAIN = "https://suno-op.echo-op.com";
const STUDIO_URL = "https://suno-op.echo-op.com";

// CSP for the sandboxed iframe. The panel loads cover art + audio from Suno's
// CDNs and (standalone-fallback only) talks to the operator origin; the fonts
// are optional (system stack fallback). Both the standard camelCase (`ui.csp`)
// and the compat snake_case (`openai/widgetCSP`) shapes are declared.
const CONNECT_DOMAINS = [
  "https://suno-op.echo-op.com",
  "https://audiopipe.suno.ai",
  "https://cdn1.suno.ai",
  "https://cdn2.suno.ai",
  "https://*.suno.ai",
];
const RESOURCE_DOMAINS = [
  "https://cdn1.suno.ai",
  "https://cdn2.suno.ai",
  "https://cdn.suno.ai",
  "https://audiopipe.suno.ai",
  "https://*.suno.ai",
  "https://*.cdn.suno.ai",
  "https://fonts.googleapis.com",
  "https://fonts.gstatic.com",
];

const _root = join(dirname(fileURLToPath(import.meta.url)), "..");
const PANEL_PATH = join(_root, "public", "panel.html");
let _panelCache = null;
function panelHtml() {
  // Re-read on each request so an edit lands without a restart; cache as fallback.
  try {
    _panelCache = readFileSync(PANEL_PATH, "utf8");
  } catch {
    /* keep last good copy */
  }
  return _panelCache || "<!doctype html><div style=\"font-family:system-ui;padding:16px;color:#eee;background:#0b0b12\">Suno panel unavailable — panel.html missing.</div>";
}

function resourceMetaBlock() {
  return {
    ui: {
      prefersBorder: true,
      domain: WIDGET_DOMAIN,
      csp: { connectDomains: CONNECT_DOMAINS, resourceDomains: RESOURCE_DOMAINS },
    },
    "openai/widgetDescription":
      "Echo Suno Studio — see your Suno account and credits, write a prompt with style tags, pick a trained Voice with an Audio-Influence slider, generate songs, watch job progress, and play your cover-art library inline.",
    "openai/widgetPrefersBorder": true,
    "openai/widgetDomain": WIDGET_DOMAIN,
    "openai/widgetCSP": { connect_domains: CONNECT_DOMAINS, resource_domains: RESOURCE_DOMAINS },
  };
}

// The set of tools that render the panel. Calling any of these mounts the widget.
const TEMPLATE_TOOLS = new Set([
  "suno_panel",
  "suno_status",
  "suno_voices",
  "suno_library",
  "suno_generate",
  "suno_job",
]);

// Shared _meta binding for a panel-rendering tool descriptor.
function tmplMeta(invoking, invoked) {
  return {
    ui: { resourceUri: UI_TEMPLATE_URI, visibility: ["model", "app"] },
    "openai/outputTemplate": UI_TEMPLATE_URI,
    "openai/widgetAccessible": true, // allow widget-initiated tools/call for this tool
    "openai/toolInvocation/invoking": invoking,
    "openai/toolInvocation/invoked": invoked,
  };
}

const looseObject = { type: "object", additionalProperties: true };

const TOOLS = [
  {
    name: "suno_panel",
    title: "Open Suno Studio",
    description:
      "Open the Echo Suno Studio panel — an embedded in-chat UI showing the owner's Suno account + credit balance, a prompt/style/voice creator, and their song library with a player. Use this when the user wants to make music, see their Suno account, or browse/play their tracks.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    outputSchema: looseObject,
    annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
    _meta: tmplMeta("Opening Suno Studio…", "Suno Studio ready."),
  },
  {
    name: "suno_status",
    title: "Suno account status",
    description:
      "Session health + credit balance for the owner's suno.com account, rendered in the Suno Studio panel. Never returns the cookie.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    outputSchema: looseObject,
    annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
    _meta: tmplMeta("Checking Suno account…", "Suno account loaded."),
  },
  {
    name: "suno_voices",
    title: "List trained voices",
    description:
      "List the owner's trained v5.5 Voices (vocal personas) so a song can be sung through one, shown in the Suno Studio voice picker. Returns [{id,name,image_url,...}] plus voice_persona_count. Empty list (ok) means no voices trained yet — see suno_train_voice_guide. Never returns the cookie.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    outputSchema: looseObject,
    annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
    _meta: tmplMeta("Loading voices…", "Voices loaded."),
  },
  {
    name: "suno_library",
    title: "Suno library",
    description:
      "The owner's recent Suno songs (newest first) with cover art, status, and playable audio URLs — rendered in the Suno Studio panel. Never returns the cookie.",
    inputSchema: {
      type: "object",
      properties: { page: { type: "number", description: "Feed page, default 0" } },
      additionalProperties: false,
    },
    outputSchema: looseObject,
    annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
    _meta: tmplMeta("Loading library…", "Library loaded."),
  },
  {
    name: "suno_generate",
    title: "Generate a song",
    description:
      "Generate a song on the owner's Suno account and render it in the Suno Studio panel with job progress. Requires confirmation=EXECUTE. Optionally sing through a trained Voice via `voice` (id or name) + `audio_influence` (0-100; defaults to 75 when a voice is set).",
    inputSchema: {
      type: "object",
      properties: {
        confirmation: { type: "string", description: "Must be EXECUTE" },
        title: { type: "string" },
        prompt: { type: "string", description: "Lyrics or description" },
        lyrics: { type: "string", description: "Explicit lyrics (custom mode)" },
        custom: { type: "boolean", description: "Custom (own-lyrics) mode" },
        tags: { type: "string", description: "Style tags" },
        instrumental: { type: "boolean" },
        voice: {
          type: "string",
          description: "Trained Voice id or name to sing through (v5.5 only). See suno_voices.",
        },
        audio_influence: {
          type: "number",
          description: "Audio Influence 0-100 (how strongly the voice comes through). Default 75 when a voice is set.",
        },
      },
      required: ["confirmation", "prompt"],
      additionalProperties: false,
    },
    outputSchema: looseObject,
    annotations: { readOnlyHint: false, openWorldHint: true, destructiveHint: false },
    _meta: tmplMeta("Generating song…", "Song submitted."),
  },
  {
    name: "suno_job",
    title: "Poll a generation",
    description: "Poll clip ids from a generate call; feeds live status + audio into the Suno Studio panel.",
    inputSchema: {
      type: "object",
      properties: { ids: { type: "array", items: { type: "string" } } },
      required: ["ids"],
      additionalProperties: false,
    },
    outputSchema: looseObject,
    annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
    _meta: tmplMeta("Checking render…", "Render updated."),
  },
  {
    name: "suno_train_voice_guide",
    title: "How to train a voice",
    description:
      "Step-by-step guide to train a Suno v5.5 Voice. Voice CAPTURE/verification is the one step that cannot be automated (live anti-spoof phrase) — only the account owner can do it, in-account. Listing and generating-with a trained voice ARE automated.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    outputSchema: looseObject,
    annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
  },
];

function ok(id, result) {
  return { jsonrpc: "2.0", id, result };
}
function fail(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

async function accountSnapshot() {
  const cookie = await readCookie();
  if (!cookie) return { authenticated: false, hint: publicHint() };
  try {
    const me = await whoAmI(cookie);
    return {
      authenticated: true,
      name: me.name,
      credits: me.credits,
      provider: me.provider,
      session_id: me.session_id,
    };
  } catch (e) {
    return { authenticated: false, error: e.message, hint: publicHint() };
  }
}

async function callTool(name, args = {}) {
  if (name === "suno_panel") {
    // Fan out; every branch is partial-failure tolerant so the panel still mounts.
    const cookie = await readCookie();
    let account = { authenticated: false, hint: publicHint() };
    let voiceList = [];
    let lib = [];
    if (cookie) {
      account = await accountSnapshot();
      try {
        const v = await voices(cookie);
        voiceList = v.voices || [];
      } catch {
        voiceList = [];
      }
      try {
        lib = await library(cookie, 0);
      } catch {
        lib = [];
      }
    }
    return { type: "sunoPanel", account, voices: voiceList, library: lib, hint: publicHint(), cookie_exposed: false };
  }

  if (name === "suno_status") {
    return { type: "sunoPanel", account: await accountSnapshot(), hint: publicHint(), cookie_exposed: false };
  }

  if (name === "suno_voices") {
    const cookie = await readCookie();
    if (!cookie) return { type: "sunoVoices", voices: [], error: "NO_SESSION", cookie_exposed: false };
    try {
      const res = await voices(cookie);
      return {
        type: "sunoVoices",
        voices: res.voices,
        voice_persona_count: res.voice_persona_count,
        max_voice_personas: res.max_voice_personas,
        cookie_exposed: false,
      };
    } catch (e) {
      return { type: "sunoVoices", voices: [], error: e.message, cookie_exposed: false };
    }
  }

  if (name === "suno_library") {
    const cookie = await readCookie();
    if (!cookie) return { type: "sunoLibrary", library: [], error: "NO_SESSION" };
    const clips = await library(cookie, Number(args.page) || 0);
    return { type: "sunoLibrary", library: clips };
  }

  if (name === "suno_train_voice_guide") {
    return { type: "sunoGuide", guide: voiceGuide() };
  }

  if (name === "suno_generate") {
    if (args.confirmation !== "EXECUTE") {
      return { type: "sunoGenerate", ok: false, error: "CONFIRMATION_REQUIRED" };
    }
    const cookie = await readCookie();
    if (!cookie) return { type: "sunoGenerate", ok: false, error: "NO_SESSION" };
    const r = await generate(cookie, args);
    return {
      type: "sunoGenerate",
      ok: true,
      ids: r.ids,
      model: r.model,
      voice: r.voice,
      audio_influence: r.audio_influence,
      token_via: r.token_via,
    };
  }

  if (name === "suno_job") {
    const cookie = await readCookie();
    if (!cookie) return { type: "sunoJob", clips: [], error: "NO_SESSION" };
    const ids = Array.isArray(args.ids) ? args.ids : [];
    return { type: "sunoJob", clips: await poll(cookie, ids) };
  }

  throw new Error(`Unknown tool ${name}`);
}

// Rich, readable fallback CARD for clients that DON'T render the UI component
// (Grok / Claude if they don't implement MCP Apps). The widget uses
// structuredContent; this markdown + resource links give every other client a
// visual, actionable result: account/credits, cover art + audio links, and a
// deep link to the live studio. Docs (build/state-management) require returning
// sufficient structured content alongside the UI resource regardless.
function acctLine(a) {
  if (!a || !a.authenticated) return "Suno account not linked yet.";
  const c = a.credits != null ? `**${a.credits}** credits` : "credits unknown";
  return `**${a.name || "Suno account"}** — ${c}`;
}
function trackLines(list, max = 8) {
  const rows = (list || []).slice(0, max).map((t) => {
    const st = t.status && t.status !== "complete" ? ` _(${t.status})_` : "";
    const audio = t.audio_url ? ` · [▶ play](${t.audio_url})` : "";
    const art = t.image_url ? ` · [cover](${t.image_url})` : "";
    return `- **${t.title || "Untitled"}**${st}${audio}${art}`;
  });
  return rows.join("\n");
}
function narrate(name, r) {
  const link = `\n\n[Open Echo Suno Studio →](${STUDIO_URL})`;
  let md;
  try {
    if (name === "suno_panel" || name === "suno_status") {
      const a = r.account || {};
      md = `### 🎵 Echo Suno Studio\n${acctLine(a)}`;
      if (name === "suno_panel") {
        md += `\n\n**Voices:** ${(r.voices || []).length} trained`;
        const lib = r.library || [];
        md += `\n\n**Recent tracks (${lib.length}):**\n${trackLines(lib) || "_none yet_"}`;
      }
      md += link;
    } else if (name === "suno_voices") {
      const v = r.voices || [];
      md = `### 🎙 Trained Voices (${v.length})\n` + (v.length ? v.map((x) => `- **${x.name || x.id}**`).join("\n") : "_No trained voices yet — Suno → Create → Add Voice._") + link;
    } else if (name === "suno_library") {
      const lib = r.library || [];
      md = `### 🎵 Suno Library (${lib.length})\n${trackLines(lib) || "_empty_"}` + link;
    } else if (name === "suno_generate") {
      md = r.ok
        ? `### 🎶 Generating ${(r.ids || []).length} take(s)\n${(r.voice && r.voice.name) ? `Voice: **${r.voice.name}**\n` : ""}Model: ${r.model || "v5.5"} · rendering now (~30–60s).\nClip ids: \`${(r.ids || []).join("`, `")}\`${link}`
        : `### ⚠️ Generate failed\n${r.error}${link}`;
    } else if (name === "suno_job") {
      md = `### 🎵 Render status\n${trackLines(r.clips) || "_no clips_"}` + link;
    } else if (name === "suno_train_voice_guide") {
      md = "Returned the Suno v5.5 voice-training guide.";
    } else {
      md = "```json\n" + JSON.stringify(r, null, 2) + "\n```";
    }
  } catch {
    md = "```json\n" + JSON.stringify(r) + "\n```";
  }

  const blocks = [{ type: "text", text: md }];
  // A clickable resource card to the live studio for hosts that render resource_link.
  blocks.push({
    type: "resource_link",
    uri: STUDIO_URL,
    name: "Echo Suno Studio",
    description: "Open the full Suno studio in your browser",
    mimeType: "text/html",
  });
  // Per-track audio links (clients that render resource_link get playable cards).
  const clips = (name === "suno_library" ? r.library : name === "suno_job" ? r.clips : name === "suno_panel" ? r.library : null) || [];
  for (const t of clips.slice(0, 4)) {
    if (t.audio_url) {
      blocks.push({ type: "resource_link", uri: t.audio_url, name: t.title || "Suno track", description: "Play audio", mimeType: "audio/mpeg" });
    }
  }
  return blocks;
}

// Provider and user-action failures are valid tool outcomes, not malformed MCP
// calls. Returning MCP `isError` here causes connector hosts to collapse the
// provider's useful error code into their own generic INVALID_ARGUMENT.
export function recoverableToolErrorPayload(name, err) {
  const errorCode = err?.body?.error_code;
  if (name !== "suno_generate" || typeof errorCode !== "string" || !errorCode) {
    return null;
  }
  const result = {
    type: "sunoGenerate",
    ok: false,
    error: errorCode,
    submitted: false,
    user_action_required: errorCode === "CAPTCHA_REQUIRED",
    studio_url: STUDIO_URL,
  };
  return {
    content: narrate(name, result),
    structuredContent: result,
    _meta: {
      "openai/outputTemplate": UI_TEMPLATE_URI,
      ui: { resourceUri: UI_TEMPLATE_URI },
    },
  };
}

export async function handleMcp(body) {
  const id = body?.id ?? null;
  const method = body?.method;

  if (method === "initialize") {
    const clientProto = body?.params?.protocolVersion;
    return ok(id, {
      // Echo the client's protocol revision so outputSchema/structuredContent
      // semantics negotiate correctly (fall back to a recent known-good rev).
      protocolVersion: clientProto || "2025-06-18",
      serverInfo: { name: RESOURCE.id, version: "0.2.0" },
      capabilities: { tools: {}, resources: {} },
      instructions:
        "Echo Suno Studio. Call suno_panel to open the embedded studio (account, credits, creator, library). suno_generate needs confirmation:\"EXECUTE\" and spends credits. suno_voices lists trained v5.5 Voices; sing through one via suno_generate {voice, audio_influence}.",
    });
  }
  if (method === "notifications/initialized") return null;
  if (method === "ping") return ok(id, {});

  if (method === "tools/list") return ok(id, { tools: TOOLS });

  if (method === "resources/list") {
    return ok(id, {
      resources: [
        {
          uri: UI_TEMPLATE_URI,
          name: "Echo Suno Studio",
          description: "Embedded in-chat Suno studio: account + credits, creator, voice picker, job progress, and a playable cover-art library.",
          mimeType: RESOURCE_MIME_TYPE,
          _meta: resourceMetaBlock(),
        },
      ],
    });
  }
  // Some hosts probe for UI templates via a dedicated method — answer it too.
  if (method === "resources/templates/list") {
    return ok(id, { resourceTemplates: [] });
  }

  if (method === "resources/read") {
    const uri = body?.params?.uri;
    if (uri === UI_TEMPLATE_URI) {
      return ok(id, {
        contents: [
          {
            uri: UI_TEMPLATE_URI,
            mimeType: RESOURCE_MIME_TYPE,
            text: panelHtml(),
            _meta: resourceMetaBlock(),
          },
        ],
      });
    }
    return fail(id, -32602, `Resource not found: ${uri}`);
  }

  if (method === "tools/call") {
    const name = body?.params?.name;
    const args = body?.params?.arguments ?? {};
    try {
      const result = await callTool(name, args);
      // Deep link to the live studio travels in structuredContent so the widget
      // and every client can offer it.
      if (result && typeof result === "object") result.studio_url = STUDIO_URL;
      const payload = {
        content: narrate(name, result),
        structuredContent: result,
      };
      // Belt-and-braces: also carry the output-template on the RESULT _meta so a
      // host that reads the binding from the tool RESULT (not just the descriptor)
      // still mounts the panel.
      if (TEMPLATE_TOOLS.has(name)) {
        payload._meta = { "openai/outputTemplate": UI_TEMPLATE_URI, ui: { resourceUri: UI_TEMPLATE_URI } };
      }
      return ok(id, payload);
    } catch (err) {
      const recoverable = recoverableToolErrorPayload(name, err);
      if (recoverable) return ok(id, recoverable);
      return ok(id, {
        isError: true,
        content: [{ type: "text", text: err.message }],
      });
    }
  }

  return fail(id, -32601, `Method not found: ${method}`);
}

export function resourceMeta(host) {
  const base = host.replace(/\/$/, "");
  return {
    resource: `${base}${RESOURCE.path}`,
    authorization_servers: [base],
    scopes_supported: ["echo.suno.read", "echo.suno.generate"],
    bearer_methods_supported: ["header"],
  };
}
