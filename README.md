# Echo Suno Operator

Private, account-scoped Echo operator for the Commander's own Suno web session. Songs are created in that account's Suno library. This repository is not the public Suno Platform API plugin and must be hosted as a private repository.

The operator never returns the provider cookie. It stores the session encrypted at rest, mints short-lived Clerk JWTs only inside the service, resolves the account's current plan/model contract at request time, performs CAPTCHA preflight, and refuses to submit when provider human verification is required.

## Production request path

```text
Codex / ChatGPT / Claude / Grok
  -> https://mcp.echo-op.com/oauth-mcp-suno-session-v1
  -> Echo OAuth MCP connector (user token + scope validation)
  -> shared-credential loopback proxy
  -> Echo Suno operator
  -> studio-api-prod.suno.com
```

The public edge must never route directly to the privileged MCP handler. The direct operator hostname exposes only a token-gated studio shell and protected health surfaces.

## Security boundaries

- OAuth scopes: `echo.suno.read` for status/jobs and `echo.suno.generate` for generation.
- Backend MCP: requires a runtime-only `SUNO_PROXY_TOKEN` header shared with the OAuth connector.
- Private REST state: requires `SUNO_UI_TOKEN` when configured.
- Generation: requires `confirmation: "EXECUTE"`.
- CAPTCHA: detected and reported as `CAPTCHA_REQUIRED`; never bypassed.
- Cookies/tokens: never returned to MCP clients and prohibited from logs, source, PRs, or evidence.

## Local development

Copy `.env.example` to `.env`, provide a strong vault key, and use a development-only proxy credential. Do not use production cookies in an untrusted worktree.

```text
node src/server.js
npm test
```

The default development port is `8788`; the HAMMER deployment sets `PORT=8789`. The Windows production task runs `run_suno.ps1`, which resolves its own directory, redirects logs, waits on the child, and starts Node with a hidden window.

## MCP tools

| Tool | Purpose | Required scope |
| --- | --- | --- |
| `suno_status` | Sanitized provider/account health | `echo.suno.read` |
| `suno_generate` | Confirmed song generation | `echo.suno.generate` |
| `suno_job` | Poll returned clip/job IDs | `echo.suno.read` |

Additional local studio tools remain backend-only and are not part of the minimal public OAuth surface.

## Verification

Run `npm test`. A production acceptance pass additionally requires:

- exact local, remote-branch, and deployed SHA agreement;
- secret scanning on the branch diff;
- OAuth rejection of unauthenticated public MCP traffic;
- authenticated internal status with `cookie_exposed: false`;
- session-0 processes with `MainWindowHandle == 0`;
- hosted CI, CodeQL, Certification Forge, and Release Sentinel evidence;
- Commander signature on the exact-SHA certificate.

See `docs/PRODUCTION_RUNBOOK.md` for deployment and rollback, `docs/ARCHITECTURE.md` for trust boundaries, and `docs/INCIDENT-2026-09-01.md` for the repaired failure chain.
