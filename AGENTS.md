# Echo Suno Operator doorway

## Purpose and scope

This repository contains the private Echo operator for the Commander's own Suno web account. It is distinct from the public Suno Platform API integration. The HTTP backend holds an encrypted Clerk session and may spend account credits; treat it as a privileged service.

## Authority and safety

- Never print, return, commit, log, or copy cookies, Clerk JWTs, proxy credentials, UI credentials, or vault keys.
- Never bypass, outsource, or automate Suno CAPTCHA or anti-abuse controls.
- Generation requires the exact `confirmation: "EXECUTE"` contract.
- Do not expose the backend MCP endpoint directly. Public MCP traffic must traverse the scoped OAuth connector and the backend shared-credential gate.
- Fail closed when billing metadata, CAPTCHA preflight, provider authentication, or the model contract cannot be resolved.

## Architecture

`MCP client -> Cloudflare route -> Echo OAuth MCP connector :8796 -> shared-credential loopback -> Echo Suno operator :8789 -> Suno Studio API`

The backend credential is runtime-only. The OAuth connector owns user authentication and scopes. The Suno operator owns provider-session encryption and provider calls.

## Headless Windows policy

QUENCH and HAMMER production launches must create no visible console, browser, credential, or installer window. Use the checked-in hidden PowerShell launcher or an equivalent session-0 service. Every restart must verify `SessionId == 0` and `MainWindowHandle == 0`. Browser diagnostics must use a disposable headless profile and must remove it after the check.

## Build and test

Required before commit or deployment:

```text
node --check src/server.js
node --check src/mcp.js
npm test
gitleaks git --staged --redact
```

The regression suite covers the live web contract, CAPTCHA fail-closed behavior, MCP error preservation, backend proxy authorization, private REST gating, and hidden Windows launch semantics.

## Worktree, commit, and PR rules

- Work in an isolated worktree on an `agent/*` branch.
- Preserve unrelated changes; never force-push or auto-merge.
- Use a draft PR with exact validation and security evidence.
- The tested SHA, reviewed SHA, certified SHA, and deployed SHA must match before merge or release.

## Deployment and verification

1. Confirm the target repository, clean worktree, current SHA, process owner, scheduled task, listener, and route before mutation.
2. Back up only the specific changed configuration or preserve a known rollback SHA.
3. Fast-forward to the exact review SHA.
4. Restart only `Echo-Suno-Operator`.
5. Verify port, process identity, session 0, zero window handle, unauthenticated 401, authenticated internal proxy 200, and sanitized `suno_status`.
6. A harmless generation must either return clip/job IDs or a structured `CAPTCHA_REQUIRED` receipt with `submitted: false`. Never claim generation when IDs are absent.

## Rollback

- Code: return the deployment worktree to the recorded pre-change SHA.
- Environment: remove only the added `SUNO_PROXY_TOKEN` entry when rolling back the OAuth boundary; preserve all unrelated variables.
- Route: restore the exact hashed Cloudflare tunnel configuration backup.
- Service: restart only the owning task and re-run the same readback checks.

## Evidence and certification

Capture exact SHAs, test counts, secret-scan results, route readback, process/session/window evidence, provider result classification, rollback hashes, and hosted-check status. A local pass is not production certification. Certification Forge and Commander signature are separate gates.

## Known failure modes

- `422 /api/generate/v2-web/`: stale Suno web request/model/billing contract.
- `Deriving bits failed`: connector/operator-layer error collapse, not proof of provider rejection.
- `CAPTCHA_REQUIRED`: legitimate provider human-action gate; no request was submitted.
- `401` at the canonical MCP resource after the OAuth repair: connector reauthorization is required.
- Visible PowerShell or browser windows: production failure; stop and correct the launcher before continuing.
