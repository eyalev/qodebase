# Self-hosting qodebase

qodebase (formerly forq) is one Cloudflare Worker plus Durable Objects, Containers and an Artifacts
namespace, all on your own Cloudflare account. Self-hosted, you are the
instance owner: your projects' agents run on your Claude subscription (or a key),
Worker projects deploy to your account, and nobody else's limits apply.

## What you need

| | |
|---|---|
| Cloudflare | Workers **Paid** plan (Containers, Artifacts and Durable Objects with SQLite need it) |
| Artifacts | open beta, enabled on the account |
| A domain on Cloudflare | for the UI host and the run host (two hostnames, e.g. `code.example.com`, `run.example.com`) |
| Claude | a Claude subscription token (`claude setup-token`) for your own projects, or an Anthropic API key |
| Local tools | Node 20+, `wrangler` 4.145+ (logged in), `jq`; optionally the `cf` CLI for the Issues wiring |

## The box image

Agents run in a container image built from [`box/Dockerfile`](box/Dockerfile):
Debian, Claude Code, tmux, git, Node, Python, headless Chromium (the reviewer
agent screenshots previews with it), [mobile-agent](https://github.com/eyalev/mobile-agent)
for the Terminal tab and `box/box-api.mjs` for the Chat tab. Point both
`containers[].images` entries in `wrangler.jsonc` at the Dockerfile
(`"image": "./box/Dockerfile"`) and `wrangler deploy` builds and pushes it
(about 1.5 GB; the first push takes a while).

If you bring your own image, it must keep this contract (see `src/box.ts`):

- `/opt/boot.sh`: reads `/tmp/boot.env` (`SBX_NAME`, `CC_ENV`, `CC_KEY_TAIL`,
  `BILLING`) and `UI_HOST` from its environment, starts a tmux session named
  `claude` running Claude Code in the directory named by `/workspace/.sbx-cwd`,
  and prints `MA_READY` / `TW_READY` when its two servers answer.
- A terminal web UI on port **7901** (qodebase proxies the Terminal tab to it;
  `/api/p/terminal/states` says whether the agent is busy).
- An API on port **7681** with `GET /api/conversation?session=&tail=`,
  `POST /api/conversation/send` and `GET /api/sessions/<s>/cc-status`
  (`box/box-api.mjs` is the reference).
- `git`, `python3`, `curl`, `node`/`npm`, and headless `chromium`.

## Configure

1. **`wrangler.jsonc` vars**: `ACCOUNT_ID`, `UI_HOST`, `RUN_HOST`, `API_BASE`
   (this Worker's `https://<name>.<subdomain>.workers.dev`), `OWNER_HANDLE`
   (your handle), `HANDLES` (`{"you@example.com":"you"}`), the two `routes`
   (custom domains for `UI_HOST` and `RUN_HOST`), and the container image(s).
   Delete `UI_VARIANT_HOSTS` (design previews of the hosted instance).
   `APPS_DOMAIN` (optional): a zone on your account where Worker projects get
   `<name>--<owner>.<APPS_DOMAIN>` and previews `<alias>.<that host>`; then
   `CF_DEPLOY_TOKEN` also needs Zone > Workers Routes > Write on that zone.
   Without it, apps stay on workers.dev. The caps
   `MAX_AGENTS_PER_PROJECT`, `MAX_AWAKE_BOXES` and `OTHERS_MAX_AWAKE` bound
   what containers can cost you.
2. **Cloudflare Access**: create a self-hosted Access application for
   `<UI_HOST>/login` only, with an allow policy (everyone, or just you) and the
   One-time PIN login method (sign-in by emailed code). People not in `HANDLES`
   choose a handle on first sign-in and bring their own Anthropic API key. Put its
   team domain and AUD in `ACCESS_TEAM_DOMAIN` / `ACCESS_AUD`. Everything else
   on the UI host stays public to read.
3. **Secrets** (`wrangler secret put …`):

   | Secret | What |
   |---|---|
   | `ADMIN_SECRET` | random; signs sessions and agent tokens, and unlocks the admin API on workers.dev |
   | `KEY_ENC_SECRET` | random; encrypts users' Anthropic API keys |
   | `CLAUDE_CODE_OAUTH_TOKEN` | your `claude setup-token` value (the owner's agents) |
   | `CF_DEPLOY_TOKEN` | API token with **Workers Scripts Write** only (qodebase's builder deploys Worker projects) |
   | `OBS_READ_TOKEN` | API token with **Workers Observability Read** only (Issues → agent) |
   | `ISSUES_WEBHOOK_SECRET` | random; Cloudflare Notifications sends it as `cf-webhook-auth` |

4. **mobile-agent overlay** (optional): the repo ships `box/mobile-agent.tgz`,
   which boxes unpack over the image's mobile-agent at boot, so a newer
   mobile-agent reaches running agents without an image rebuild. To refresh it:
   `MA_SRC=<mobile-agent checkout> ./scripts/pack-mobile-agent.sh`, then deploy.

## Deploy

```bash
npm install
npx wrangler deploy
```

Then open `https://<UI_HOST>/login`, sign in (your handle comes from
`HANDLES`), and import a project from GitHub.

Optional, for "a production error starts a fix": put the `ISSUES_WEBHOOK_SECRET`
value in `~/.config/forq/issues-webhook-secret`, then for each Worker project
you deploy run `FORQ_API=<API_BASE> scripts/issues-automation.sh forq-app-<owner>-<name>`
once (needs the `cf` CLI logged in).

## What it costs

Measured on the hosted instance (`MEASUREMENTS.md`): a round of three reviewed
changes used 23 Artifacts operations, 1.4 container box-hours (≤ $0.05) and,
at Sonnet API prices, about $4.30 of model tokens (about $1.40 per reviewed
change). Containers bill their full memory while awake; boxes stop after 5
idle minutes.

## The CLI against your copy

`qb` works with any instance: `qb login --host https://code.example.com` (or
`QB_HOST`). Your instance serves its own copy at `/cli/qb.mjs` and `/cli/install.sh`.
