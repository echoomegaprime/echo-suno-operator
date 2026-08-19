# Echo Suno Operator — **private**

This is **not** the public API plugin.

| Repo | What it is | Visibility |
| --- | --- | --- |
| [echo-music-studio](https://github.com/echoomegaprime/echo-music-studio) | Official **Platform API** plugin. Grok / GPT / Claude / Qwen compose. Bearer key in vault. | **Public** |
| **echo-suno-operator** (this) | Operates Echo against **your** suno.com account using a Clerk session cookie. Songs land in **your** library. | **Private** |

Suno Platform Google login is a different product. This operator uses the same session your browser already has on [suno.com/create](https://suno.com/create).

Unofficial. Your account only. Cookie never goes to Grok, GPT, Claude, or Qwen — only into this server’s encrypted vault.

## Path

```
You → Grok / GPT / Claude / Qwen
        → Echo operator (this box)
        → encrypted Clerk session
        → studio-api.suno.ai as YOUR Suno user
```

## Run

```bash
cp .env.example .env
# set VAULT_MASTER_KEY to a long random string
node src/server.js     # 0.0.0.0:8788
```

Open the local page, paste the Cookie header, save. Status should show your Suno identity and credits.

## Capture the cookie (your login only)

1. Sign in at [suno.com/create](https://suno.com/create) with the **same SSO you originally used** (Google, Apple, Discord, Facebook, or Microsoft).
2. DevTools → Network → refresh.
3. Filter `__clerk_api_version`.
4. Open that request → Request Headers → copy the entire **Cookie** value.
5. Paste it here. Do not paste your password. Do not paste someone else’s cookie.

Cookies expire. When generate starts 401-ing, paste a fresh one.

## Endpoints

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/` | Paste UI |
| GET | `/v1/status` | Identity + credits (no cookie returned) |
| POST | `/v1/session` | `{ cookie }` → encrypt + probe |
| POST | `/v1/session/clear` | Wipe vault |
| POST | `/v1/generate` | `{ confirmation: "EXECUTE", title, prompt, tags, instrumental }` |
| GET | `/v1/job?ids=` | Poll clip ids |

## Do not

- Commit `.data/` or `.env`
- Put this cookie in the public API repo
- Share the operator URL
- Use anyone’s session but yours
