import assert from "node:assert/strict";
import { recoverableToolErrorPayload } from "./src/mcp.js";

let passed = 0;
function ok(condition, message) {
  assert.ok(condition, message);
  passed += 1;
}

const captcha = new Error("Suno requires a generation captcha token");
captcha.status = 409;
captcha.body = { error_code: "CAPTCHA_REQUIRED" };
const payload = recoverableToolErrorPayload("suno_generate", captcha);

ok(payload !== null, "maps a provider generation code to a tool result");
ok(!Object.hasOwn(payload, "isError"), "does not emit MCP isError for a valid tool outcome");
ok(payload.structuredContent.ok === false, "marks the generation outcome unsuccessful");
ok(payload.structuredContent.error === "CAPTCHA_REQUIRED", "preserves the provider error code");
ok(payload.structuredContent.submitted === false, "proves no generation was submitted");
ok(payload.structuredContent.user_action_required === true, "marks CAPTCHA as an owner action");
ok(
  payload.content.some(
    (block) => block.type === "text" && block.text.includes("CAPTCHA_REQUIRED")
  ),
  "renders the recoverable code for non-structured clients"
);

const unexpected = recoverableToolErrorPayload("suno_status", captcha);
ok(unexpected === null, "does not reclassify unrelated tool exceptions");

console.log(`mcp error contract: ${passed} passed, 0 failed`);
