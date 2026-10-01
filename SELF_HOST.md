# Self-hosting forq

forq is one Cloudflare Worker plus Durable Objects, Containers and an Artifacts
namespace, all on your own Cloudflare account. Self-hosted, you are the
instance owner: your projects' agents run on your Claude subscription (or a key),
Worker projects deploy to your account, and nobody else's limits apply.

> Status (2026-10-02): the repository is private. This guide is written for
> when it opens, and for anyone given access before then.

## What you need

| | |
|---|---|
| Cloudflare | Workers **Paid** plan (Containers, Artifacts and Durable Objects with SQLite need it) |
| Artifacts | open beta, enabled on the account |
| A domain on Cloudflare | for the UI host and the run host (two hostnames, e.g. `forq.example.com`, `forq-run.example.com`) |
| Claude | a Claude subscription token (`claude setup-token`) for your own projects, or an Anthropic API key |
| Local tools | Node 20+, `wrangler` 4.145+ (logged in), `jq`; optionally the `cf` CLI for the Issues wiring |

## The box image (the one real requirement)

Agents run in a container image that must provide this contract (see
`src/box.ts`):

- `/opt/boot.sh`: reads `/tmp/boot.env` (`SBX_NAME`, `CC_ENV`, `CC_KEY_TAIL`,
  `BILLING`), starts a tmux session named `claude` running Claude Code in the
  directory named by `/workspace/.sbx-cwd`, and prints `MA_READY` / `TW_READY`
  when its services listen.
- A terminal web UI on port **7901** (forq proxies the Terminal tab to it).
- A tmux web API on port **7681** with `/api/conversation`,
  `/api/conversation/send` and `/api/sessions/claude/cc-status` (the Chat tab,
  the progress lines and message delivery use these).
- `git`, `python3`, `curl`, `node`/`npm`, and headless `chromium` (the reviewer
  agent screenshots previews with it).

The hosted forq uses a private image built from two private projects
(mobile-agent and tmux-web). A public Dockerfile that meets the contract with
public tools is on the to-do list; until then, point `containers[].images` in
`wrangler.jsonc` at an image of your own that follows it.

## Configure

1. **`wrangler.jsonc` vars**: `ACCOUNT_ID`, `UI_HOST`, `RUN_HOST`, `API_BASE`
   (this Worker's `https://<name>.<subdomain>.workers.dev`), `OWNER_HANDLE`
   (your handle), `HANDLES` (`{"you@example.com":"you"}`), the two `routes`
   (custom domains for `UI_HOST` and `RUN_HOST`), and the container image(s).
2. **Cloudflare Access**: create a self-hosted Access application for
   `<UI_HOST>/login` only, with an allow policy (everyone, or just you). Put its
   team domain and AUD in `ACCESS_TEAM_DOMAIN` / `ACCESS_AUD`. Everything else
   on the UI host stays public to read.
3. **Secrets** (`wrangler secret put …`):

   | Secret | What |
   |---|---|
   | `ADMIN_SECRET` | random; signs sessions and agent tokens, and unlocks the admin API on workers.dev |
   | `KEY_ENC_SECRET` | random; encrypts users' Anthropic API keys |
   | `CLAUDE_CODE_OAUTH_TOKEN` | your `claude setup-token` value (the owner's agents) |
   | `CF_DEPLOY_TOKEN` | API token with **Workers Scripts Write** only (forq's builder deploys Worker projects) |
   | `OBS_READ_TOKEN` | API token with **Workers Observability Read** only (Issues → agent) |
   | `ISSUES_WEBHOOK_SECRET` | random; Cloudflare Notifications sends it as `cf-webhook-auth` |

4. **mobile-agent overlay** (only if your image uses mobile-agent):
   `./scripts/pack-mobile-agent.sh` (see `CLAUDE.md`). Otherwise remove the
   overlay step in `src/box.ts`.

## Deploy

```bash
npm install
npx wrangler deploy
```

Then open `https://<UI_HOST>/login`, sign in (your handle comes from
`HANDLES`), and import a project from GitHub.

Optional, for "a production error starts a fix": for each Worker project you
deploy, run `scripts/issues-automation.sh forq-app-<owner>-<name>` once (needs
the `cf` CLI logged in).

## What it costs

Measured on the hosted instance (`MEASUREMENTS.md`): a round of three reviewed
changes used 23 Artifacts operations, 1.4 container box-hours (≤ $0.05) and,
at Sonnet API prices, about $4.30 of model tokens (about $1.40 per reviewed
change). Containers bill their full memory while awake; boxes stop after 5
idle minutes.
