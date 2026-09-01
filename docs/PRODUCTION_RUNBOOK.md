# Production runbook

## Pre-change

Record the canonical repository and remote, clean worktree, base SHA, review-branch SHA, scheduled task/service owner, listeners, process session/window state, Cloudflare ingress shape, and rollback hashes. Do not display environment values.

## Deploy operator

Fast-forward the clean HAMMER checkout to the exact review SHA. Run all tests with the deployed Node runtime. Restart only `Echo-Suno-Operator`; if the task stops its wrapper but leaves the child, terminate only the measured port-8789 owner after validating its command line, then start the task. Verify a new PID, session 0, zero main-window handle, backend unauthenticated 401, and shared-proxy 200.

## Deploy OAuth adapter

Preserve the exact deployed pack because HAMMER may contain additive, unmerged modules. Back up the live pack by hash, apply only the Suno module and minimal pack registration, compile with the deployed Python runtime, and restart only `EchoOAuthMCP`. Verify a new service/child PID, session 0, zero window handle, public unauthenticated 401, internal sanitized status, exact route ordering, and unchanged global catch-all.

## Provider acceptance

Call status without emitting private fields. Submit a harmless minimal prompt with exact confirmation. If IDs return, poll until complete and record only IDs, terminal status, and audio URL. If `CAPTCHA_REQUIRED` returns, verify `submitted: false` and stop; the account owner must complete provider verification. Never synthesize IDs or report a track as generated without them.

## Rollback

Restore the hashed Cloudflare configuration, restore the OAuth pack backup and prior module state, remove only the added shared-credential entries, return the operator to the pre-change SHA, restart only the two owning services, and repeat public 401 plus internal status readback.
