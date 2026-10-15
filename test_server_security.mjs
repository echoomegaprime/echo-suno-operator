import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";

const proxyToken = "s".repeat(48);
const uiToken = "u".repeat(48);
const child = spawn(process.execPath, ["src/server.js"], {
  cwd: new URL(".", import.meta.url),
  windowsHide: true,
  stdio: ["ignore", "pipe", "pipe"],
  env: {
    ...process.env,
    PORT: "0",
    HOST: "127.0.0.1",
    SUNO_PROXY_TOKEN: proxyToken,
    SUNO_UI_TOKEN: uiToken,
  },
});

function waitReady() {
  return new Promise((resolve, reject) => {
    const lines = createInterface({ input: child.stdout });
    const timer = setTimeout(() => finish(new Error("owned test server readiness timed out")), 5000);
    const onExit = (code) => finish(new Error(`owned test server exited before readiness: ${code}`));
    const onError = () => finish(new Error("owned test server could not start"));
    function finish(error, value) {
      clearTimeout(timer);
      lines.close();
      child.removeListener("exit", onExit);
      child.removeListener("error", onError);
      if (error) reject(error); else resolve(value);
    }
    child.once("exit", onExit);
    child.once("error", onError);
    lines.on("line", (line) => {
      let value;
      try { value = JSON.parse(line); } catch { return; }
      if (value.event !== "suno_operator_listening") return;
      if (value.pid !== child.pid || value.host !== "127.0.0.1" || !Number.isInteger(value.port) || value.port <= 0 || value.port > 65535) {
        finish(new Error("owned test server readiness identity mismatch"));
        return;
      }
      finish(null, value);
    });
  });
}

try {
  const { port } = await waitReady();
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
  if (child.exitCode === null && child.signalCode === null) {
    const exited = once(child, "exit");
    child.kill();
    await exited;
  }
}
