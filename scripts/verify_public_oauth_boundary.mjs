import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

export const DEFAULT_RESOURCE =
  "https://mcp.echo-op.com/oauth-mcp-suno-session-v1";
export const EXPECTED_SERVICE = "echo-oauth-mcp-suno-session-v1";
export const EXPECTED_TOOLS = ["suno_generate", "suno_job", "suno_status"];

function requestOptions(method, body) {
  return {
    method,
    redirect: "manual",
    signal: AbortSignal.timeout(10_000),
    headers: {
      accept: "application/json",
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  };
}

export async function verifyPublicOAuthBoundary(
  resource = DEFAULT_RESOURCE,
  fetchImpl = fetch,
) {
  const target = new URL(resource);
  assert.equal(target.protocol, "https:", "public MCP resource must use HTTPS");
  assert.equal(
    target.pathname,
    "/oauth-mcp-suno-session-v1",
    "refusing to probe an unexpected public resource path",
  );

  const discovery = await fetchImpl(
    target,
    requestOptions("GET"),
  );
  assert.equal(discovery.status, 200, "public discovery must return HTTP 200");
  assert.equal(
    discovery.headers.get("set-cookie"),
    null,
    "public discovery must not set a session cookie",
  );
  const metadata = await discovery.json();
  assert.equal(metadata?.service, EXPECTED_SERVICE, "wrong service owns public path");
  assert.deepEqual(
    [...(metadata?.tools ?? [])].sort(),
    EXPECTED_TOOLS,
    "public path must expose exactly the scoped Suno tool surface",
  );

  const unauthenticated = await fetchImpl(
    target,
    requestOptions("POST", {
      jsonrpc: "2.0",
      id: "public-boundary-probe",
      method: "initialize",
      params: {},
    }),
  );
  assert.equal(
    unauthenticated.status,
    401,
    "unauthenticated public MCP initialize must fail closed",
  );
  assert.ok(
    unauthenticated.headers.get("www-authenticate"),
    "OAuth challenge header is required",
  );
  assert.equal(
    unauthenticated.headers.get("set-cookie"),
    null,
    "unauthenticated rejection must not set a session cookie",
  );

  return {
    ok: true,
    resource: target.href,
    discovery_status: discovery.status,
    service: metadata.service,
    tools: [...metadata.tools].sort(),
    unauthenticated_status: unauthenticated.status,
    oauth_challenge: true,
    cookie_exposed: false,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const result = await verifyPublicOAuthBoundary(process.argv[2] ?? DEFAULT_RESOURCE);
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(
      JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.message : "public boundary verification failed",
      }),
    );
    process.exitCode = 1;
  }
}
