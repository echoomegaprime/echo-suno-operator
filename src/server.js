import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { saveCookie, readCookie, clearCookie, publicHint } from "./vault.js";
import { generate, poll, whoAmI, voices, voiceGuide, library } from "./suno.js";
import { handleMcp, RESOURCE, resourceMeta } from "./mcp.js";
import { proxyAuthorized } from "./proxy-auth.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT || 8788);

// Optional write-gate for the public studio UI: when SUNO_UI_TOKEN is set, credit-spending /
// session endpoints require a matching `x-suno-token` header so a random visitor to the public
// URL cannot spend the owner's Suno credits or read private account/library state.
const UI_TOKEN = process.env.SUNO_UI_TOKEN || "";
function gated(req, res) {
  if (UI_TOKEN && req.headers["x-suno-token"] !== UI_TOKEN) {
    json(res, 401, { ok: false, error: "UNAUTHORIZED", hint: "enter your studio token to generate" });
    return true;
  }
  return false;
}

function json(res, code, body) {
  const data = JSON.stringify(body);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(data);
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  return JSON.parse(raw);
}

async function handle(req, res) {
  const url = new URL(req.url || "/", `http://127.0.0.1:${PORT}`);
  const host = `${req.headers["x-forwarded-proto"] || "http"}://${req.headers.host || `127.0.0.1:${PORT}`}`;

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "content-type, authorization, mcp-session-id",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    });
    res.end();
    return;
  }

  if (req.method === "GET" && url.pathname === "/") {
    const html = await readFile(join(root, "public/index.html"), "utf8");
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
    return;
  }

  // Standalone preview of the embedded Apps-SDK component (same file the MCP
  // serves as the ui:// resource). Lets us verify the panel renders + drives the
  // Suno tools via the /v1 HTTP fallback before testing inside ChatGPT/Grok/Claude.
  if (req.method === "GET" && (url.pathname === "/panel" || url.pathname === "/panel.html")) {
    const html = await readFile(join(root, "public/panel.html"), "utf8");
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    res.end(html);
    return;
  }

  if (
    req.method === "GET" &&
    (url.pathname === `/.well-known/oauth-protected-resource${RESOURCE.path}` ||
      url.pathname === `${RESOURCE.path}/.well-known/oauth-protected-resource`)
  ) {
    json(res, 200, resourceMeta(host));
    return;
  }

  if (
    (req.method === "POST" || req.method === "GET") &&
    (url.pathname === RESOURCE.path || url.pathname === "/mcp")
  ) {
    // The public OAuth connector is the sole HTTP caller. It adds this
    // credential only after validating the user's OAuth token and scopes.
    if (!proxyAuthorized(req)) {
      json(res, 401, { ok: false, error: "UNAUTHORIZED", cookie_exposed: false });
      return;
    }
    if (req.method === "GET") {
      json(res, 200, {
        ok: true,
        resource: RESOURCE.canonical,
        path: RESOURCE.path,
        tools: ["suno_panel", "suno_status", "suno_voices", "suno_library", "suno_generate", "suno_train_voice_guide", "suno_job"],
        ui_resource: "ui://widget/suno-studio.html",
      });
      return;
    }
    const body = await readBody(req);
    const rpc = await handleMcp(body);
    if (rpc === null) {
      res.writeHead(202);
      res.end();
      return;
    }
    json(res, 200, rpc);
    return;
  }

  if (req.method === "GET" && url.pathname === "/v1/status") {
    if (gated(req, res)) return;
    const cookie = await readCookie();
    if (!cookie) {
      json(res, 200, {
        authenticated: false,
        hint: publicHint(),
        error: "No session in vault",
      });
      return;
    }
    try {
      const me = await whoAmI(cookie);
      json(res, 200, { ...me, hint: publicHint(), cookie_exposed: false });
    } catch (err) {
      json(res, 200, {
        authenticated: false,
        hint: publicHint(),
        error: err.message,
        cookie_exposed: false,
      });
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/v1/voices") {
    if (gated(req, res)) return;
    const cookie = await readCookie();
    if (!cookie) {
      json(res, 401, { ok: false, error: "NO_SESSION", cookie_exposed: false });
      return;
    }
    try {
      const result = await voices(cookie);
      json(res, 200, { ok: true, ...result, cookie_exposed: false });
    } catch (err) {
      json(res, err.status || 500, {
        ok: false,
        error: err.message,
        detail: err.body ?? null,
        cookie_exposed: false,
      });
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/v1/voice-guide") {
    json(res, 200, { ok: true, guide: voiceGuide() });
    return;
  }

  if (req.method === "POST" && url.pathname === "/v1/session") {
    if (gated(req, res)) return;
    const body = await readBody(req);
    if (!body.cookie) {
      json(res, 400, { ok: false, error: "cookie required" });
      return;
    }
    await saveCookie(body.cookie);
    const cookie = await readCookie();
    try {
      const me = await whoAmI(cookie);
      json(res, 200, { ok: true, ...me, hint: publicHint(), cookie_exposed: false });
    } catch (err) {
      json(res, 200, {
        ok: false,
        stored: true,
        error: err.message,
        hint: publicHint(),
        cookie_exposed: false,
      });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/v1/session/clear") {
    if (gated(req, res)) return;
    await clearCookie();
    json(res, 200, { ok: true });
    return;
  }

  if (req.method === "POST" && url.pathname === "/v1/generate") {
    if (gated(req, res)) return;
    const body = await readBody(req);
    if (body.confirmation !== "EXECUTE") {
      json(res, 403, { ok: false, error: "CONFIRMATION_REQUIRED" });
      return;
    }
    const cookie = await readCookie();
    if (!cookie) {
      json(res, 401, { ok: false, error: "NO_SESSION" });
      return;
    }
    if (!body.prompt && !body.title) {
      json(res, 400, { ok: false, error: "prompt required" });
      return;
    }
    const result = await generate(cookie, body);
    json(res, 200, { ok: true, ...result });
    return;
  }

  if (req.method === "GET" && url.pathname === "/v1/job") {
    if (gated(req, res)) return;
    const cookie = await readCookie();
    if (!cookie) {
      json(res, 401, { ok: false, error: "NO_SESSION" });
      return;
    }
    const ids = (url.searchParams.get("ids") || "").split(",").map((s) => s.trim()).filter(Boolean);
    const clips = await poll(cookie, ids);
    json(res, 200, { clips });
    return;
  }

  if (req.method === "GET" && url.pathname === "/v1/library") {
    if (gated(req, res)) return;
    const cookie = await readCookie();
    if (!cookie) {
      json(res, 401, { ok: false, error: "NO_SESSION" });
      return;
    }
    const page = Number(url.searchParams.get("page") || 0);
    const clips = await library(cookie, page);
    json(res, 200, { ok: true, clips });
    return;
  }

  json(res, 404, { error: "not found" });
}

createServer((req, res) => {
  handle(req, res).catch((err) => {
    json(res, err.status || 500, {
      ok: false,
      error: err.message,
      detail: err.body ?? null,
      cookie_exposed: false,
    });
  });
}).listen(PORT, "0.0.0.0", () => {
  console.log(`echo-suno-operator http://0.0.0.0:${PORT}`);
});
