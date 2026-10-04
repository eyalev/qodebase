# Deploying agents into a user's own Cloudflare, without GitHub

Research, 2026-10-04. Sources: Cloudflare docs and changelog, Birthday Week 2026
posts, and a hands-on trial of Personal Agent, OpenClaw (Moltworker), Hermes and
herdr the same day (see `claude1/TASKS.md`).

## Why not the Deploy to Cloudflare button

The button only takes public github.com / gitlab.com repos and always creates a
copy in the user's GitHub or GitLab account, then builds from there with Workers
Builds (docs: workers/platform/deploy-buttons, "Limitations"). In the trial it
also failed outright on an expired GitHub App grant. A user who wants nothing to
do with GitHub cannot use it.

## The pieces that make it possible now

| piece | since | what it gives forq |
|---|---|---|
| **Self-managed OAuth clients** | 2026-06-03 | "Sign in with Cloudflare" for any app. Authorization Code (+PKCE). Scopes = API token permissions. Private by default; **public needs a verified client domain** (projectsbase.dev). Consent screen lets the user pick which account. Users can revoke any time. |
| **Workers Builds ← Artifacts** | 2026-10-01 | A Worker can build and deploy from an Artifacts repo: push to `main` deploys, other branches make Previews. Production branch must be `main`. Needs Artifacts Read+Edit and the Workers Paid plan (Artifacts is Paid-only). |
| **Temporary accounts API** | 2026-07-14 | A platform can deploy a live Worker before the user has an account; the user claims it within 60 min. Supports Workers, assets, KV, D1, DO, Hyperdrive, Queues. **Not** R2, Workers AI or Containers. |
| **Web Search API** (AI Gateway) | Birthday Week | Search as a binding or REST, at partner list price from AI Gateway credits. Replaces Tavily/Firecrawl keys in agent templates. |
| **Auto Router** (`cloudflare/auto`) | Birthday Week | AI Gateway picks the cheapest capable model per request; free in beta. A sane default model for templates. |
| **Kitesurf** | Birthday Week | Workers-native browser, now WebMCP + `env.BROWSER.quickAction()`; free in beta. Agents browse without a token. |
| **Protected Quick Tunnels** | Birthday Week | `cloudflared --allowed-mail` puts email-PIN auth on a tunnel with no account. Lets a laptop agent be reached privately. |
| **`cf` CLI, `cloudflare.config.ts`** | Birthday Week | Typed config and 3,000+ API operations; `cf cli search`. |

OAuth scopes checked against `GET /oauth/scopes` (392 scopes). Everything a
deploy needs is grantable: `workers-scripts.write`, `workers-r2.write`,
`ai.read`/`ai.write`, `aig.write`, `browser-rendering.write`,
`containers.write`, `access-app.write`, `access-policy.write`,
`artifacts.write`, `workers-ci.write`, `account-settings.read`.
**Missing:** any scope to create API tokens, and any billing scope. So forq
cannot mint the "paste a CF_API_TOKEN" secret that Personal Agent asks for, and
cannot read the user's plan.

## The flow (phone, about five taps)

1. **Pick an agent** on `/personal-agents` (Personal Agent, OpenClaw, Hermes…).
   Each card is a forq project whose code lives in forq's Artifacts, imported once
   from upstream. The user never sees GitHub.
2. **Sign in with Cloudflare** (OAuth consent: "forq wants to deploy Workers,
   create a storage bucket and lock it to you" + the account picker). No
   account? Sign up on the same screen.
3. **One question per real choice:** a name, and "Which brain?" with *Free
   (Cloudflare)* preselected, or *Claude* with a key field. No token fields, no
   placeholder secrets.
4. **forq deploys it** into the user's account with their OAuth token: upload
   the Worker, create the R2 bucket and Durable Objects, set secrets, and turn on
   Access for *all traffic, your email only*. A progress line per step, like the
   router agent panel.
5. **Done screen:** "Your assistant is at `<name>.<sub>.workers.dev`. Only you
   can open it." Open / Add to home screen / Connect Telegram.

Updates: when the template's `main` moves, the card says "Update available";
one tap redeploys. Changes: "Ask an agent to change it" forks the template in
forq, and its preview deploys into the user's account the same way.

### Two ways to do step 4

- **A. forq deploys directly (recommended for v1).** forq's BuildBox runs
  `wrangler deploy` with the user's OAuth access token and account id (wrangler
  is itself an OAuth client, so a bearer token should work; **verify**), or calls
  the Workers Scripts upload API. Works on the **Free plan** for Worker-only
  agents. The user's account holds only the running agent; the code stays in
  forq. Nothing to connect.
- **B. Artifacts + Workers Builds in the user's account.** forq creates an
  Artifacts repo in the user's account, pushes the template and connects Workers
  Builds. The user then owns code, history and CI too, inside Cloudflare.
  Needs Workers Paid, and connecting Builds to Artifacts is documented only as a
  dashboard flow (the Builds API is GitHub-first and needs a *user-scoped*
  token). Good for "make it fully mine" later.

### Containers (OpenClaw, Hermes, herdr)

They need Workers Paid and an image in the user's account registry. Path A needs
docker in BuildBox (it has none) or an image copy between accounts (unverified);
path B lets Workers Builds build the image. Until one is proven, container
agents run as **forq boxes** (what the trial did for Hermes and herdr) and only
Worker agents deploy into the user's account.

## Agent templates should be binding-only

The trial's worst steps were secrets a phone user cannot produce. forq's copies
of the templates should:
- use the `AI` binding (or AI Gateway with `cloudflare/auto`), never a
  `CF_API_TOKEN`;
- use Web Search API instead of Tavily/Firecrawl keys;
- use the Browser Run / Kitesurf binding instead of a REST token;
- default `SANDBOX_SLEEP_AFTER` to 10m and refuse to start without Access;
- route every model call through an AI Gateway with a rate limit (house rule).

## Instant try (before sign-in)

Temporary accounts let a visitor tap "Try it" and get a live agent for 60 min,
then "Keep it" = sign in and claim. Only possible for agents with no R2 / Workers
AI / containers, so Personal Agent needs a KV/D1 variant first. Worth it for the
contest demo: a stranger has a running agent in seconds.

## Other Birthday Week items that matter for forq itself

- **Workers Builds ← Artifacts:** forq's own deploys could move from the laptop
  to push-to-main on forq's Artifacts repo (blocked today only by deploys
  killing boxes, see CLAUDE.md "Baseline").
- **Containers rebuilt** (648 ms median start, snapshots): trial measured a
  3.4 s wake from snapshot with herdr kept.
- **Issues → agent** and **Kitesurf WebMCP**: the reviewer can drive a preview
  through WebMCP tools instead of clicks.
- **Auto Router** as the default model for BYO-key users who do not care.
- **Cloudflare OS managed**: nearest neighbour, still not phone-first or forkable.

## Open questions (check before building)

1. Does wrangler accept a third-party OAuth access token as
   `CLOUDFLARE_API_TOKEN`? Do public OAuth clients get refresh tokens?
2. Can a public OAuth client be granted `containers.write` and push images?
3. Is there an API to connect Workers Builds to an Artifacts repo?
4. Access on `*.workers.dev` through the API (the trial used the dashboard's
   Worker → Access tab for the personal account and `access/apps` for forq's).
