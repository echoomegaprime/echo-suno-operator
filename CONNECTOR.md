# MCP connector — Grok, GPT, Claude

Private operator. Cookie stays on this host.

## Resource

| | |
| --- | --- |
| Resource id | `oauth-mcp-suno-session-v1` |
| Path | `/oauth-mcp-suno-session-v1` |
| Canonical (when on Echo edge) | `https://mcp.echo-op.com/oauth-mcp-suno-session-v1` |
| Local | `http://127.0.0.1:8788/oauth-mcp-suno-session-v1` |

Public **API** plugin (no cookies) is a different resource: `https://mcp.echo-op.com/oauth-mcp-suno-v1` from [echo-music-studio](https://github.com/echoomegaprime/echo-music-studio).

## Tools

- `suno_status` — session live? credits? cookie never returned
- `suno_generate` — `{ confirmation: "EXECUTE", title, prompt, tags, instrumental }`
- `suno_job` — `{ ids: ["..."] }`

## Grok

Settings → Connectors → add remote MCP:

```
https://mcp.echo-op.com/oauth-mcp-suno-session-v1
```

Until that host is wired on Echo Nexus, use the operator URL you deploy (HTTPS, not localhost). Same path.

## ChatGPT / GPT

Settings → Connectors / Apps → add MCP server URL:

```
https://YOUR-HOST/oauth-mcp-suno-session-v1
```

Custom GPT Actions can also hit REST:

- `GET /v1/status`
- `POST /v1/generate`
- `GET /v1/job?ids=`

## Claude

**Claude Desktop** (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "echo-suno-operator": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/echo-suno-operator/src/mcp-stdio.js"],
      "cwd": "/ABSOLUTE/PATH/echo-suno-operator"
    }
  }
}
```

**Claude remote / Cowork** — same HTTPS URL as Grok.

## GitHub (code, not runtime)

| Client | App to install on `echo-suno-operator` |
| --- | --- |
| Grok | [Grok (by xAI)](https://github.com/apps/grok-by-xai) |
| GPT / Codex | [ChatGPT Codex Connector](https://github.com/apps/chatgpt-codex-connector/installations/new) |
| Claude | Claude GitHub connector on this **private** repo |
