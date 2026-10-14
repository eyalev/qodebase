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

## Decision (2026-10-02)

- qodebase runs in its **own Cloudflare account** (Workers Paid), separate from the owner's personal projects, with its
  own Access team, API tokens, image registry and Artifacts namespace. If Trust & Safety ever acts on strangers' code,
  it acts on this account only.
- **Platform** on `projectsbase.dev` (and `qodebase.app` in front of it); **user apps** on a separate domain,
  `ttyview.dev` (static apps on `<name>--<owner>.ttyview.dev`, Worker apps and their agent previews on the same
  pattern), so a bad page on one user's app cannot put the platform's domain on Safe Browsing lists.
- Moving accounts was a redeploy: account-specific values were already out of the code (`ACCOUNT_ID`, `API_BASE`,
  `UI_HOST`, `RUN_HOST`, the secrets, the Access app, the Issues webhook).

The full plan, with the owner's other domains and accounts, is kept locally (`docs/hosting-plan.local.md`, not in git).
