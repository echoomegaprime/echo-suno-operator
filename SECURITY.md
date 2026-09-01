# Security policy

## Sensitive assets

Suno cookies, Clerk tokens, vault keys, OAuth bearer tokens, Cloudflare credentials, `SUNO_PROXY_TOKEN`, and `SUNO_UI_TOKEN` are secrets. They must remain in approved runtime stores and must never enter Git history, issue/PR text, test fixtures, screenshots, chat output, or certification artifacts.

## Supported surface

Only the canonical OAuth MCP resource is supported for remote clients. The operator backend is a private origin and requires its shared proxy credential. Private REST account/library endpoints require the studio token when configured.

## Reporting

Do not open a public issue containing exploit details or account data. Use the organization's private security reporting channel and include only redacted timestamps, request classifications, affected SHA, and reproducible non-secret steps.

## Response requirements

For suspected exposure: fail closed, preserve logs without secrets, revoke the affected runtime credential, invalidate the provider session when necessary, restore the OAuth boundary, test unauthenticated 401 from the public edge, and record exact-SHA remediation evidence. Never delete the only audit or rollback record.
