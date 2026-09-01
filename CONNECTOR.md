# Echo Suno MCP connector

## Canonical resource

`https://mcp.echo-op.com/oauth-mcp-suno-session-v1`

The resource is protected by the Echo OAuth MCP connector. Clients must authorize the read and/or generation scopes they use. An existing connector created before the OAuth boundary was installed must be reauthorized once; a 401 is the expected fail-closed response until that consent completes.

## Public tool contract

- `suno_status({})`
- `suno_generate({ confirmation: "EXECUTE", title?, prompt, tags?, instrumental?, voice?, audio_influence? })`
- `suno_job({ ids: ["..."] })`

`audio_influence` uses the Suno connector scale `0..100`. Generation returns clip/job IDs only after provider submission. `CAPTCHA_REQUIRED` with `submitted: false` is a recoverable result and must not be converted into a generic connector error.

## Trust boundary

The OAuth edge forwards only these three allowlisted tools to `127.0.0.1:8789`, with bounded request/response sizes and timeout, using a server-side shared credential. It rejects arbitrary URLs, headers, tools, and secret-bearing response fields. The direct backend MCP path returns 401 without the shared credential.

## Local MCP development

`node src/mcp-stdio.js` bypasses the HTTP proxy because stdio remains on the local host. Never expose stdio over a public transport or package production session material with a desktop configuration.
