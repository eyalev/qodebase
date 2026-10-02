# Hosting other people's projects: plan (2026-10-02)

Eyal's question: if forq becomes a product, a non-technical user builds an app
and wants it deployed without understanding anything, and pays for the usage.
That usage lands on a Cloudflare account. It should not be the account that holds
all of Eyal's personal projects.

## The three ways forq can run

| | who runs forq | where users' apps deploy | who pays Cloudflare | who pays Claude |
|---|---|---|---|---|
| **A. Hosted product** | Eyal | Eyal's forq account | Eyal, recharged to users | the user's key, or Eyal's resold |
| **B. Self-hosted** | anyone (SELF_HOST.md) | their own account | them | them |
| **C. Hosted, bring your own Cloudflare** | Eyal | the user's account (their API token) | the user, directly | the user's key |

- **A** is the one for non-technical users; it makes Eyal a hosting provider.
- **B** is the open-source answer.
- **C** suits developers and leaves Eyal with no hosting liability.

All three can coexist.

Even in A, a user's own Anthropic key covers only Claude. These costs fall on
whichever account the app and the agents run in:
- Workers requests and CPU;
- the agents' containers (measured ≤ $0.05 per agent round);
- Artifacts operations;
- later, D1, KV and R2.

## Where things stand

- forq runs in Eyal's personal account (`<personal account>`), next to every other project.
- Only Eyal can deploy Worker apps.
- Other users' agents already run containers on this account, on their own
  Anthropic keys, capped at 2 awake boxes each. So the exposure exists, but it is small.
- **Through the contest (Oct 14): keep it this way.** Nothing below is needed to
  demo forq.

## Status (2026-10-02, evening)

Eyal chose to do Phases 1 and 2 before the contest:
- **Account `forq`** (`887d7234…`) exists, Workers Paid, its
  own Access team (`forqdev`), tokens, image registry and Artifacts namespace.
- **Platform on `projectsbase.dev`**, the apex. Its old subdomains redirect:
  `whenfit.` and `pdf.` to their kapps.dev homes, `www.` to the apex.
- **Run host on `ttyview.dev`** (`/<owner>.<name>/`) for static apps; **Worker
  apps on `<name>--<owner>.ttyview.dev`**, their agent previews on
  `ag-<id>.<name>--<owner>.ttyview.dev` (custom domain with previews enabled).
  Phase 2 is done; static apps could move to per-project hosts too, which
  would also give each its own origin (storage isolation).
- **Fresh start**: showcase re-imported, seeds and Eyal's projects copied with
  their history; the old instance is frozen behind 301s from kapps.dev.

## Phase 1: a separate Cloudflare account for forq

One Cloudflare login can own several accounts. Create one named "forq" from the
dashboard (or `POST /accounts` with a user token), with:

- **Its own billing:** card, Workers Paid ($5/month), and Workers for Platforms
  when Phase 3 comes. Its own `cloudcost` line, since this is a second account.
- **Its own API tokens:** the builder's deploy token, Issues, observability.
  None of them can touch the personal account.
- **Its own Access team** for `/login`, its own Artifacts namespace, its own
  container image digest.

**Why:** strangers' code will include some abuse (phishing pages, spam
senders). If Cloudflare's Trust & Safety acts on an account, it must be the
forq account, not the one running podqast, ppll, korrents and the rest.

**Moving forq** is a redeploy, because the self-host work already took the
account-specific values out of the code:
1. new `ACCOUNT_ID`, `API_BASE`, `UI_HOST` and `RUN_HOST`;
2. recreate the six secrets, the Access app, and the Issues webhook and policy;
3. re-import the showcase projects into the new Artifacts namespace;
4. leave `forq.kapps.dev` redirecting to the new address.

## Phase 2: domains

**Two domains, both in the forq account:**
- one for the forq platform itself;
- a separate one for the apps users deploy.

GitHub uses `github.io` for user pages for the same reason: a phishing page on
one user's app can get the whole domain onto Safe Browsing lists. That must not
hit forq's own domain, and must never hit `kapps.dev`.

**What Eyal already owns in Cloudflare (checked 2026-10-02):**

| domain | today | usable for forq? |
|---|---|---|
| `ttyview.com` | nothing answers | **yes**, unused (ttyview project is quiet), but the name is unrelated |
| `ttyview.dev` | nothing answers | **yes**, same |
| `paster.app` | only redirects to `paster.kapps.dev` (paster.app retired 2026-09-25) | **yes** once the redirect is no longer needed; unrelated name |
| `projectsbase.dev` | legacy mirror of `kapps.dev`: home, `pdf.`, `whenfit.`, `www.` | **yes, after clean-up**: move those four custom domains off; check whenfit's Google OAuth redirect URIs don't depend on it. The name fits a platform for projects |
| `mobile-cc.dev` | serves the mobile-cc Pages project | no, in use |
| `korents.com` | redirect to korrents.com (typo catcher) | no, keep |
| `lingush.com` | redirect to podqast.app/portuguese | no, in use |
| all others | serve live projects | no |

**Not owned, probably free** (RDAP shows no registration):
- `forq.run` ("every project runs", the platform);
- `forqapps.com` (user apps);
- `forq.sh`, whose registry has no RDAP, so this is unverified.

`forq.dev`, `forq.app` and `getforq.com` are taken.

**Recommendation:**
- **Platform:** `projectsbase.dev`, after the clean-up (no new spend). Buy
  `forq.run` only if the name `forq` stays.
- **User apps:** a neutral domain that never hosts anything of Eyal's. `ttyview.dev`
  costs nothing now; `forqapps.com` is about $10 a year if the name matters.
- Apps live at `<project>-<owner>.<apps domain>`. Previews live at
  `<agent>--<project>-<owner>.<apps domain>`.

**Moving a domain:** a Cloudflare Registrar domain can move between accounts
when both accounts confirm. The domain must be registered more than 10 days,
DNSSEC off, and the zone added to the target account first. Settings don't
carry over, and the domain is transfer-locked for 30 days afterwards.

## Phase 3: Workers for Platforms for users' apps

Today forq deploys each app as an ordinary Worker (`forq-app-…`) next to its own
code. Workers for Platforms is Cloudflare's product for running customers' code,
and its "AI vibe-coding platform" reference architecture describes forq's case.

- **One dispatch namespace for user apps.** The builder uploads each app and each
  preview as a *user Worker* in it. One dispatch Worker on the apps domain routes
  `<host>` to its user Worker. The number of scripts is unlimited.
- **Isolation by default:**
  - a user Worker sees only the bindings forq attaches to it;
  - the cache is per script;
  - the `cf` object is hidden.
  - Keep the namespace untrusted.
- **Per-app storage:** forq creates a D1 database, a KV namespace and an R2
  bucket per project, on demand from the app's `wrangler` config, and attaches
  them. This unlocks most of the awesome-cloudflare-selfhosted list (D1 is in
  about three quarters of it).
  - **Previews** get an empty copy with the migrations applied, never the live data.
- **Custom limits per request:** CPU ms and subrequests, set by the dispatch
  Worker per plan, so a runaway app throws instead of billing.
- **Still refused:**
  - Email sending;
  - Browser Rendering;
  - Containers inside user apps;
  - outbound TCP.
  These are added one at a time, only behind a paid plan.
- **Price:** Workers for Platforms is a paid add-on on top of Workers Paid.
  Confirm the current price before committing.

## Phase 4: metering and caps

- **Per-user ledger** (D1 in forq), one row per day per project:
  - container seconds, per box;
  - Worker requests and CPU ms, from the GraphQL Analytics API grouped by
    script tag or dispatch namespace;
  - D1 rows read and written, R2 and KV operations;
  - Artifacts operations.
  The provider's own figures, never estimates presented as costs.
- **Hard caps per plan:**
  - container hours per day;
  - requests and CPU per day;
  - number of projects;
  - awake boxes.
  Past a cap, the app answers 503 with a clear page, and agents stop starting.
- **Account-wide breakers,** like remote-manage's AI breaker: alert at a daily
  amount, freeze new deploys and container starts at a higher one.

## Phase 5: money and terms

- **Prepaid credit**, not monthly invoicing: a user tops up, usage draws it down,
  and at zero their apps keep serving for a short grace period and their agents
  stop. That avoids chasing unpaid bills. Payments through Stripe.
- **Terms of service and an acceptable-use policy**, with an abuse report
  address on every app page (a footer the dispatch Worker injects) and a
  takedown switch per app.
- **Probably a company,** for invoicing and liability, before charging anyone.

## Phase 6: bring your own Cloudflare (model C)

Optional, after Phase 3. A user pastes a scoped Cloudflare API token, stored
encrypted like the Anthropic key. Their apps then deploy as ordinary Workers in
their own account. forq runs only the builder and the agents, and still meters
the agents' containers.

## Decisions for Eyal

1. Is forq a product to charge for (model A), or open source plus self-host
   (model B), with A later?
2. Which domain for the platform, and which for user apps (Phase 2).
3. When to start Phase 1: after the contest is the default.
