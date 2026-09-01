import assert from "node:assert/strict";
import {
  EXPECTED_SERVICE,
  verifyPublicOAuthBoundary,
} from "./scripts/verify_public_oauth_boundary.mjs";

const metadata = {
  service: EXPECTED_SERVICE,
  tools: ["suno_status", "suno_generate", "suno_job"],
};

function response(body, init) {
  return new Response(body == null ? null : JSON.stringify(body), init);
}

const calls = [];
const goodFetch = async (_url, options) => {
  calls.push(options);
  if (options.method === "GET") {
    return response(metadata, {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  return response({ error: "unauthorized" }, {
    status: 401,
    headers: { "www-authenticate": "Bearer resource_metadata=example" },
  });
};

const result = await verifyPublicOAuthBoundary(undefined, goodFetch);
assert.equal(result.ok, true);
assert.equal(result.cookie_exposed, false);
assert.equal(calls.length, 2);
assert.equal(JSON.parse(calls[1].body).method, "initialize");

await assert.rejects(
  verifyPublicOAuthBoundary(undefined, async (_url, options) => {
    if (options.method === "GET") {
      return response({ service: "echo-unified-rw-sdk-mcp", tools: ["search"] }, { status: 200 });
    }
    throw new Error("POST must not run after wrong route ownership");
  }),
  /wrong service owns public path/,
);

await assert.rejects(
  verifyPublicOAuthBoundary(undefined, async (_url, options) => {
    if (options.method === "GET") return response(metadata, { status: 200 });
    return response({ ok: true }, { status: 200 });
  }),
  /must fail closed/,
);

console.log("public OAuth boundary verifier: ok");
