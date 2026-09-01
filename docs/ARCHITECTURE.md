# Architecture and trust boundaries

## Components

1. Remote MCP client: holds an Echo OAuth token after user consent.
2. Cloudflare named tunnel: routes only the canonical Suno resource to the OAuth connector; the global MCP catch-all remains unchanged and last.
3. Echo OAuth MCP connector: validates token audience/scopes, exposes only three Suno tools, bounds payloads/timeouts, redacts secret-key fields, and adds the backend shared credential.
4. Echo Suno operator: encrypts the provider session, resolves current Suno plan/model data, performs CAPTCHA preflight, and invokes the Studio API.
5. Suno: authoritative provider for authentication, credits, CAPTCHA, generation, and clip status.

## Data rules

Cookies and Clerk JWTs stay inside the operator. The OAuth connector receives only sanitized MCP results. Job and clip IDs may cross the boundary because they are required to poll an authorized generation. Audio URLs may be returned after completion. Account display names and credit counts are private status data and must not appear in public evidence.

## Failure semantics

- Transport/auth failures are MCP errors.
- Provider validation failures are structured results.
- `CAPTCHA_REQUIRED` is structured, recoverable, `submitted: false`, and has no IDs.
- A generation is successful only when IDs are returned and the subsequent job poll reaches a completed provider state.
