import { timingSafeEqual } from "node:crypto";

export const PROXY_HEADER = "x-echo-suno-proxy";

function equalSecret(actual, expected) {
  const left = Buffer.from(String(actual || ""), "utf8");
  const right = Buffer.from(String(expected || ""), "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

export function proxyAuthorized(req, env = process.env) {
  const expected = String(env.SUNO_PROXY_TOKEN || env.ECHO_SUNO_PROXY_TOKEN || "");
  if (expected.length < 32) return false;
  return equalSecret(req?.headers?.[PROXY_HEADER], expected);
}
