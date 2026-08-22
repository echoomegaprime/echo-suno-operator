// Dry proof: stub global fetch, call generate() with a voice + audio_influence, and assert the
// outgoing v2-web body carries persona_id and metadata.control_sliders.audio_weight. No real
// Suno traffic, no credits spent. Also checks the no-voice body stays clean, and name-resolution.
import { generate, voices } from "./src/suno.js";

const realFetch = global.fetch;
let capturedGenBody = null;

function jwtStub() {
  // header.payload.sig with a plan claim so userTier resolves
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
    return new Response(JSON.stringify({ jwt: jwtStub() }), { status: 200 });
  }
  // CDP tab discovery (mintTurnstile) -> no suno tab
  if (url.includes(":9222/json")) {
    return new Response(JSON.stringify([]), { status: 200 });
  }
  // persona list -> empty (owner has no voices)
  if (url.includes("/api/persona/get-personas/")) {
    return new Response(JSON.stringify({ personas: [], current_page: 1, total_results: 0, voice_persona_count: 0, max_voice_personas: 1000 }), { status: 200 });
  }
  // the generate call -> capture body, return a fake clip
  if (url.includes("/api/generate/v2-web/")) {
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
ok(capturedGenBody.persona_id === uuid, "persona_id == the voice id");
ok(capturedGenBody.metadata?.control_sliders?.audio_weight === 90, "control_sliders.audio_weight == 90");
ok(capturedGenBody.metadata.control_sliders.weirdness_constraint === 50 && capturedGenBody.metadata.control_sliders.style_weight === 50, "other sliders default to 50");
ok(r1.voice?.id === uuid && r1.audio_influence === 90, "result surfaces voice + audio_influence");

// 2) voice with NO audio_influence -> defaults to 75 (recommended high)
capturedGenBody = null;
await generate(COOKIE, { voice: uuid, custom: true, lyrics: "x", title: "T" });
console.log("[2] voice set, no audio_influence");
ok(capturedGenBody.persona_id === uuid, "persona_id set");
ok(capturedGenBody.metadata?.control_sliders?.audio_weight === 75, "audio_weight defaults to 75");

// 3) NO voice -> clean body (persona_id null, no control_sliders)
capturedGenBody = null;
await generate(COOKIE, { custom: true, lyrics: "y", title: "T" });
console.log("[3] no voice");
ok(capturedGenBody.persona_id === null, "persona_id is null");
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
ok(capturedGenBody.metadata?.control_sliders?.audio_weight === 40, "audio_weight == 40, persona_id null");
ok(capturedGenBody.persona_id === null, "persona_id null");

global.fetch = realFetch;
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
