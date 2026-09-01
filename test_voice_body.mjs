// Dry proof: stub global fetch, call generate() with a voice + audio_influence, and assert the
// outgoing v2-web body matches the REAL browser voice-generation body captured over CDP 2026-08-22.
// The voice-application field is top-level `task: "vox"` (persona_id alone is accepted but ignored).
// No real Suno traffic, no credits spent. Also checks the no-voice body stays clean, and name-res.
import { generate, voices, whoAmI } from "./src/suno.js";
import { readFile } from "node:fs/promises";

const realFetch = global.fetch;
let capturedGenBody = null;
let billingModels = [
  { external_key: "chirp-fenix", can_use: true, is_default_model: false },
  { external_key: "chirp-auk-turbo", can_use: true, is_default_model: true },
];
let billingShouldFail = false;
let captchaRequired = false;
let allowCdpDiscovery = false;
let generationCalls = 0;
let billingUrl = null;
let tokenCalls = 0;
let tokenUrl = null;

function jwtStub() {
  // Structurally valid header.payload.sig; billing, not the JWT, now supplies user_tier.
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "none" })}.${b64({ plan: "premier:monthly" })}.sig`;
}

global.fetch = async (input, init = {}) => {
  const url = String((input && input.url) || input);
  // Clerk client -> one session
  if (url.includes("/v1/client?")) {
    return new Response(JSON.stringify({ response: { sessions: [{ id: "session_test", user: { first_name: "Bob" } }], last_active_session_id: "session_test" } }), { status: 200 });
  }
  // Clerk token -> a jwt
  if (url.includes("/tokens")) {
    tokenCalls++;
    tokenUrl = url;
    return new Response(JSON.stringify({ jwt: jwtStub() }), { status: 200 });
  }
  // Current billing contract -> account plan id + dynamic usable/default models.
  if (url.includes("/api/billing/info/")) {
    billingUrl = url;
    if (billingShouldFail) return new Response(JSON.stringify({ error: "temporary" }), { status: 503 });
    return new Response(JSON.stringify({ plan: { id: "premier" }, models: billingModels }), { status: 200 });
  }
  // Current captcha preflight -> no token/browser access required.
  if (url.includes("/api/c/check")) {
    return new Response(JSON.stringify({ required: captchaRequired, captcha_version: 2 }), { status: 200 });
  }
  // CDP tab discovery (mintTurnstile) -> no suno tab. This must remain unused when not required.
  if (url.includes(":9222/json")) {
    if (!allowCdpDiscovery) throw new Error("CDP must not be contacted when captcha is not required");
    return new Response(JSON.stringify([]), { status: 200 });
  }
  // persona list -> empty (owner has no voices)
  if (url.includes("/api/persona/get-personas/")) {
    return new Response(JSON.stringify({ personas: [], current_page: 1, total_results: 0, voice_persona_count: 0, max_voice_personas: 1000 }), { status: 200 });
  }
  // the generate call -> capture body, return a fake clip
  if (url.includes("/api/generate/v2-web/")) {
    generationCalls++;
    capturedGenBody = JSON.parse(init.body);
    return new Response(JSON.stringify({ clips: [{ id: "clip_fake_123" }] }), { status: 200 });
  }
  throw new Error("unexpected fetch: " + url);
};

const COOKIE = "session=stub; __client=stub; more=stubstubstubstubstubstubstub";
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  PASS", m); } else { fail++; console.log("  FAIL", m); } };

// 1) voice by UUID + explicit audio_influence
capturedGenBody = null;
const uuid = "0f2b1c9a-1234-4abc-9def-0123456789ab";
const r1 = await generate(COOKIE, { voice: uuid, audio_influence: 90, custom: true, lyrics: "la la la", tags: "pop", title: "T" });
console.log("[1] voice=UUID, audio_influence=90");
ok(capturedGenBody.task === "vox", "task == 'vox' (THE voice-application field)");
ok(capturedGenBody.persona_id === uuid, "persona_id == the voice id");
ok(JSON.stringify(capturedGenBody.override_fields) === JSON.stringify(["prompt", "tags"]), "override_fields == ['prompt','tags'] on the voice path");
ok(capturedGenBody.artist_clip_id === null, "artist_clip_id stays null (not the mechanism)");
ok(capturedGenBody.token === null && capturedGenBody.token_provider === null, "token + token_provider are explicit null when no minted token");
ok(capturedGenBody.metadata?.control_sliders?.audio_weight === 0.9, "control_sliders.audio_weight == 0.9 (90/100 float)");
ok(capturedGenBody.metadata.control_sliders.weirdness_constraint === 0.5 && capturedGenBody.metadata.control_sliders.style_weight === 0.5, "other sliders default to 0.5 float");
ok(r1.voice?.id === uuid && r1.audio_influence === 90, "result surfaces voice + audio_influence");
ok(capturedGenBody.mv === "chirp-auk-turbo", "uses the account's current usable default model");
ok(capturedGenBody.metadata.user_tier === "premier", "uses billing plan.id for user_tier");
ok(capturedGenBody.metadata.create_surface === "create", "sets current create_surface metadata");
ok(billingUrl?.startsWith("https://studio-api-prod.suno.com/"), "billing uses the current web API host");
ok(capturedGenBody.project_id === undefined, "default-project generation omits optional project_id like the web builder");
ok(tokenCalls === 2, "voice resolution + generation mint once each; billing adds no duplicate mint");
ok(tokenUrl?.includes("__clerk_api_version=2025-11-10") && tokenUrl?.includes("_clerk_js_version=5.117.0"), "token POST carries current Clerk version parameters");

// 2) voice with NO audio_influence -> defaults to 75 (recommended high)
capturedGenBody = null;
await generate(COOKIE, { voice: uuid, custom: true, lyrics: "x", title: "T" });
console.log("[2] voice set, no audio_influence");
ok(capturedGenBody.task === "vox", "task == 'vox'");
ok(capturedGenBody.persona_id === uuid, "persona_id set");
ok(capturedGenBody.metadata?.control_sliders?.audio_weight === 0.75, "audio_weight defaults to 0.75 float");

// 3) NO voice -> clean body (no task, persona_id null, no control_sliders, empty override_fields)
capturedGenBody = null;
await generate(COOKIE, { custom: true, lyrics: "y", title: "T" });
console.log("[3] no voice");
ok(capturedGenBody.task === undefined, "no 'task' field on the no-voice path");
ok(capturedGenBody.persona_id === null, "persona_id is null");
ok(JSON.stringify(capturedGenBody.override_fields) === JSON.stringify([]), "override_fields == [] with no voice");
ok(capturedGenBody.metadata?.control_sliders === undefined, "no control_sliders when no voice/influence");

// 4) voice by NAME when owner has none -> helpful 404
console.log("[4] voice by name, 0 trained");
try {
  await generate(COOKIE, { voice: "Bobby Voice", custom: true, lyrics: "z", title: "T" });
  ok(false, "should have thrown");
} catch (e) {
  ok(e.status === 404 && /no trained voices/i.test(e.message), "throws 404 with 'no trained voices' guidance");
}

// 5) audio_influence without a voice still plumbs the slider
capturedGenBody = null;
await generate(COOKIE, { audio_influence: 40, custom: true, lyrics: "w", title: "T" });
console.log("[5] audio_influence only");
ok(capturedGenBody.metadata?.control_sliders?.audio_weight === 0.4, "audio_weight == 0.4 float, persona_id null");
ok(capturedGenBody.persona_id === null, "persona_id null");
ok(capturedGenBody.task === undefined, "no 'task' field without a voice");

// 6) Ambiguous prompt + tags stays simple; section-marked prompt + tags is own-lyrics mode.
capturedGenBody = null;
await generate(COOKIE, { prompt: "original lyric line", tags: "hard rap", title: "Connector shape" });
console.log("[6] connector prompt + tags");
ok(capturedGenBody.prompt === "", "ambiguous single-line prompt is not treated as lyrics");
ok(capturedGenBody.gpt_description_prompt === "original lyric line", "ambiguous prompt remains a description");
ok(capturedGenBody.metadata.create_mode === "simple", "ambiguous create_mode == simple");

capturedGenBody = null;
await generate(COOKIE, { prompt: "[Verse 1]\noriginal lyric line\n\n[Hook]\nno cape", tags: "hard rap", title: "Connector lyrics" });
console.log("[6b] connector section-marked lyrics + tags");
ok(capturedGenBody.prompt.startsWith("[Verse 1]"), "section-marked prompt is preserved as custom lyrics");
ok(capturedGenBody.tags === "hard rap", "tags are preserved in inferred custom mode");
ok(capturedGenBody.gpt_description_prompt === undefined, "custom description field is omitted");
ok(capturedGenBody.metadata.create_mode === "custom", "section-marked create_mode == custom");

capturedGenBody = null;
await generate(COOKIE, { custom: false, prompt: "[Verse]\nnot literal lyrics", tags: "hard rap", title: "Explicit simple" });
ok(capturedGenBody.gpt_description_prompt.startsWith("[Verse]"), "explicit custom:false overrides lyric-shape inference");
ok(capturedGenBody.metadata.create_mode === "simple", "explicit custom:false create_mode == simple");

// 7) A tagged instrumental request stays in simple-description mode.
capturedGenBody = null;
await generate(COOKIE, { prompt: "short neutral cue", tags: "ambient", instrumental: true, title: "Diagnostic" });
console.log("[7] tagged instrumental connector shape");
ok(capturedGenBody.prompt === "", "instrumental prompt is not misclassified as lyrics");
ok(capturedGenBody.gpt_description_prompt === "short neutral cue", "description is preserved");
ok(capturedGenBody.tags === undefined, "custom tags field is omitted in simple mode");
ok(capturedGenBody.metadata.create_mode === "simple", "create_mode == simple");

// 8) Explicit unavailable model fails locally, before any generation can spend credits.
console.log("[8] unavailable explicit model");
try {
  await generate(COOKIE, { mv: "chirp-retired", prompt: "x", instrumental: true });
  ok(false, "should have rejected unavailable model");
} catch (e) {
  ok(e.status === 422 && e.body?.error_code === "MODEL_NOT_AVAILABLE", "rejects unavailable explicit model");
}

// 9) Billing/model capability failure is classified and cannot submit generation.
console.log("[9] billing failure fail-closed");
billingShouldFail = true;
const callsBeforeBillingFailure = generationCalls;
try {
  await generate(COOKIE, { prompt: "x", instrumental: true });
  ok(false, "should have failed closed on billing lookup");
} catch (e) {
  ok(e.status === 503 && e.body?.error_code === "BILLING_CAPABILITY_UNAVAILABLE", "classifies billing lookup failure");
  ok(generationCalls === callsBeforeBillingFailure, "billing failure submits no generation");
}
billingShouldFail = false;

// 10) Captcha-required without a minted token is classified and cannot submit generation.
console.log("[10] captcha required fail-closed");
captchaRequired = true;
allowCdpDiscovery = true;
const callsBeforeCaptchaFailure = generationCalls;
try {
  await generate(COOKIE, { prompt: "x", instrumental: true });
  ok(false, "should have failed closed without captcha token");
} catch (e) {
  ok(e.status === 409 && e.body?.error_code === "CAPTCHA_REQUIRED", "classifies missing required captcha token");
  ok(generationCalls === callsBeforeCaptchaFailure, "captcha failure submits no generation");
}
captchaRequired = false;
allowCdpDiscovery = false;

// 11) Windows launcher must be portable and force the Node child to remain hidden. Deployment
// separately verifies the parent is an S4U, noninteractive, hidden-window scheduled task action.
console.log("[11] headless Windows launcher");
const launcher = await readFile(new URL("./run_suno.ps1", import.meta.url), "utf8");
ok(/\$PSScriptRoot/i.test(launcher), "uses its deployed directory, not a user-specific path");
ok(/Start-Process[\s\S]*-WindowStyle Hidden/i.test(launcher), "starts the service process hidden");
ok(!/C:\\Users\\/i.test(launcher), "contains no hard-coded user profile path");

// 12) Status also reuses its minted JWT for billing rather than hitting Clerk twice.
console.log("[12] status Clerk mint count");
const callsBeforeStatus = tokenCalls;
const status = await whoAmI(COOKIE);
ok(status.authenticated === true, "status authenticates through the stubbed session");
ok(tokenCalls === callsBeforeStatus + 1, "status mints exactly one Clerk token");

global.fetch = realFetch;
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
