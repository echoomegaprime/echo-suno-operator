# Private operator connector

Grok / GPT / Claude / Qwen call **this** host. The Suno cookie stays on this host.

```
POST /v1/generate
{ "confirmation": "EXECUTE", "title": "...", "prompt": "...", "tags": "...", "instrumental": false }
```

Do not install this repo on a public ChatGPT action. Keep the URL private. Use Echo OAuth in front if you expose it beyond localhost.
