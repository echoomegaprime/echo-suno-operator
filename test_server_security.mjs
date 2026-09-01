import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";

const port = 18789;
const proxyToken = "s".repeat(48);
const uiToken = "u".repeat(48);
const child = spawn(process.execPath, ["src/server.js"], {
  cwd: new URL(".", import.meta.url),
  windowsHide: true,
  stdio: ["ignore", "pipe", "pipe"],
  env: {
    ...process.env,
    PORT: String(port),
    SUNO_PROXY_TOKEN: proxyToken,
    SUNO_UI_TOKEN: uiToken,
  },
});

async function waitReady() {
  let combined = "";
  const deadline = Date.now() + 5000;
  while (!combined.includes("echo-suno-operator") && Date.now() < deadline) {
    const next = await Promise.race([
      once(child.stdout, "data").then(([chunk]) => chunk.toString("utf8")),
      once(child.stderr, "data").then(([chunk]) => chunk.toString("utf8")),
      new Promise((resolve) => setTimeout(() => resolve(""), 100)),
    ]);
    combined += next;
  }
  assert.match(combined, /echo-suno-operator/);
}

try {
  await waitReady();
  const endpoint = `http://127.0.0.1:${port}/oauth-mcp-suno-session-v1`;
  const unauthenticated = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
  });
  assert.equal(unauthenticated.status, 401);

  const authenticated = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-echo-suno-proxy": proxyToken,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "initialize" }),
  });
  assert.equal(authenticated.status, 200);
  assert.equal((await authenticated.json()).result.serverInfo.name, "oauth-mcp-suno-session-v1");

  const privateStatus = await fetch(`http://127.0.0.1:${port}/v1/status`);
  assert.equal(privateStatus.status, 401);
  const authorizedStatus = await fetch(`http://127.0.0.1:${port}/v1/status`, {
    headers: { "x-suno-token": uiToken },
  });
  // A deployed worktree may contain an encrypted session whose separate vault
  // key is intentionally absent from this test process.  Passing the gate is
  // the security contract under test; provider/vault behavior is tested elsewhere.
  assert.notEqual(authorizedStatus.status, 401);

  console.log("server security contract: ok");
} finally {
  child.kill();
  await Promise.race([once(child, "exit"), new Promise((resolve) => setTimeout(resolve, 2000))]);
}
