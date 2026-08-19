import { readCookie, publicHint } from "./vault.js";
import { generate, poll, whoAmI } from "./suno.js";

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
    name: "suno_generate",
    description:
      "Generate a song on the owner's Suno account. Requires confirmation=EXECUTE.",
    inputSchema: {
      type: "object",
      properties: {
        confirmation: { type: "string", description: "Must be EXECUTE" },
        title: { type: "string" },
        prompt: { type: "string", description: "Lyrics or description" },
        tags: { type: "string", description: "Style tags" },
        instrumental: { type: "boolean" },
      },
      required: ["confirmation", "prompt"],
      additionalProperties: false,
    },
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
