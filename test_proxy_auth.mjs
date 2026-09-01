import assert from "node:assert/strict";
import { proxyAuthorized, PROXY_HEADER } from "./src/proxy-auth.js";

const token = "p".repeat(48);
const request = (value) => ({ headers: value === undefined ? {} : { [PROXY_HEADER]: value } });

assert.equal(proxyAuthorized(request(token), { SUNO_PROXY_TOKEN: token }), true);
assert.equal(proxyAuthorized(request("wrong"), { SUNO_PROXY_TOKEN: token }), false);
assert.equal(proxyAuthorized(request(token), { SUNO_PROXY_TOKEN: "short" }), false);
assert.equal(proxyAuthorized(request(undefined), { SUNO_PROXY_TOKEN: token }), false);
assert.equal(proxyAuthorized(request(token), { ECHO_SUNO_PROXY_TOKEN: token }), true);

console.log("proxy auth contract: ok");
