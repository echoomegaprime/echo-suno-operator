import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";

// A real occupied loopback socket must fail startup, not route verification to
// the unrelated owner. Keep the fixture alive throughout the failed launch.
const occupied = createServer((_request, response) => {
  response.end("unrelated-fixture");
});
occupied.listen(0, "127.0.0.1");
await once(occupied, "listening");
const port = occupied.address().port;
const env = { ...process.env, PORT: String(port), SUNO_DEBUG: "1" };
delete env.HOST; // Exercise the service's default, not a test-only override.
const child = spawn(process.execPath, ["src/server.js"], {
  cwd: new URL(".", import.meta.url), windowsHide: true,
  stdio: ["ignore", "pipe", "pipe"], env,
});
let stdout = "";
let stderr = "";
child.stdout.on("data", (chunk) => { stdout += chunk; });
child.stderr.on("data", (chunk) => { stderr += chunk; });
const deadline = setTimeout(() => child.kill(), 5000);
try {
  const [code, signal] = await once(child, "close");
  assert.equal(signal, null, "startup must fail itself, not reach the test timeout");
  assert.equal(code, 1);
  const events = stdout.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  assert.equal(events.some((event) => event.event === "suno_operator_listening"), false);
  assert.equal(events.find((event) => event.event === "suno_operator_listen_start").host, "127.0.0.1");
  const failure = JSON.parse(stderr.trim());
  assert.equal(failure.event, "suno_operator_listen_failed");
  assert.equal(failure.code, "EADDRINUSE");
  assert.equal(failure.pid, child.pid);
  assert.equal(await (await fetch(`http://127.0.0.1:${port}`)).text(), "unrelated-fixture");
  console.log("server startup isolation: 8 passed, 0 failed");
} finally {
  clearTimeout(deadline);
  if (child.exitCode === null && child.signalCode === null) {
    const closed = once(child, "close"); child.kill(); await closed;
  }
  await new Promise((resolve) => occupied.close(resolve));
}
