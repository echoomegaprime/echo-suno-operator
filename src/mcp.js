import { readCookie, publicHint } from "./vault.js";
import { generate, poll, whoAmI, voices, voiceGuide } from "./suno.js";

export const RESOURCE = {
  id: "oauth-mcp-suno-session-v1",
  path: "/oauth-mcp-suno-session-v1",
  name: "Echo Suno Operator MCP v1",
  canonical: "https://mcp.echo-op.com/oauth-mcp-suno-session-v1",
};

const TOOLS = [
  {
    name: "suno_status",
    description:
      "Session health for the owner's suno.com account. Never returns the cookie.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "suno_voices",
    description:
      "List the owner's trained v5.5 Voices (vocal personas) so you can sing a song through one. Returns [{id,name,...}] plus voice_persona_count. Empty list (ok) means no voices trained yet — see suno_train_voice_guide. Never returns the cookie.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "suno_generate",
    description:
      "Generate a song on the owner's Suno account. Requires confirmation=EXECUTE. Optionally sing through a trained Voice via `voice` (id or name) + `audio_influence` (0-100; defaults to 75 when a voice is set).",
    inputSchema: {
      type: "object",
      properties: {
        confirmation: { type: "string", description: "Must be EXECUTE" },
        title: { type: "string" },
        prompt: { type: "string", description: "Lyrics or description" },
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
  },
  {
    name: "suno_train_voice_guide",
    description:
      "Step-by-step guide to train a Suno v5.5 Voice. Voice CAPTURE/verification is the one step that cannot be automated (live anti-spoof phrase) — only the account owner can do it, in-account. Listing and generating-with a trained voice ARE automated.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "suno_job",
    description: "Poll clip ids from a generate call.",
    inputSchema: {
      type: "object",
      properties: {
        ids: { type: "array", items: { type: "string" } },
      },
      required: ["ids"],
      additionalProperties: false,
    },
  },
];

function ok(id, result) {
  return { jsonrpc: "2.0", id, result };
}
function fail(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

async function callTool(name, args = {}) {
  if (name === "suno_status") {
    const cookie = await readCookie();
    if (!cookie) {
      return { authenticated: false, hint: publicHint(), cookie_exposed: false };
    }
    const me = await whoAmI(cookie);
    return { ...me, hint: publicHint(), cookie_exposed: false };
  }
  if (name === "suno_voices") {
    const cookie = await readCookie();
    if (!cookie) return { ok: false, error: "NO_SESSION", cookie_exposed: false };
    const res = await voices(cookie);
    return { ok: true, ...res, cookie_exposed: false };
  }
  if (name === "suno_train_voice_guide") {
    return { ok: true, guide: voiceGuide() };
  }
  if (name === "suno_generate") {
    if (args.confirmation !== "EXECUTE") {
      return { ok: false, error: "CONFIRMATION_REQUIRED" };
    }
    const cookie = await readCookie();
    if (!cookie) return { ok: false, error: "NO_SESSION" };
    return generate(cookie, args);
  }
  if (name === "suno_job") {
    const cookie = await readCookie();
    if (!cookie) return { ok: false, error: "NO_SESSION" };
    const ids = Array.isArray(args.ids) ? args.ids : [];
    return { clips: await poll(cookie, ids) };
  }
  throw new Error(`Unknown tool ${name}`);
}

export async function handleMcp(body) {
  const id = body?.id ?? null;
  const method = body?.method;
  if (method === "initialize") {
    return ok(id, {
      protocolVersion: "2025-03-26",
      serverInfo: { name: RESOURCE.id, version: "0.1.0" },
      capabilities: { tools: {} },
    });
  }
  if (method === "notifications/initialized") return null;
  if (method === "ping") return ok(id, {});
  if (method === "tools/list") return ok(id, { tools: TOOLS });
  if (method === "tools/call") {
    const name = body?.params?.name;
    const args = body?.params?.arguments ?? {};
    try {
      const result = await callTool(name, args);
      return ok(id, {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      });
    } catch (err) {
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
