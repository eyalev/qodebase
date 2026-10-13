# Codex (ChatGPT plan) in qodebase: step 1, what OpenAI allows (qb9, 2026-10-13)

Question from the manager (Eyal approved the idea): can people connect their OpenAI Codex / ChatGPT-plan subscription
to qodebase the way they connect their Claude plan, so that the agent box runs the real `codex` binary on their own
login for their own builds? Everything below is from OpenAI's own pages, read 2026-10-13.

## (a) OpenAI's terms for using a ChatGPT plan inside a third-party hosted product

**There is now an official, sanctioned way, and it is gated for hosted products.** At DevDay (2026-09-29) OpenAI
extended "Sign in with ChatGPT" so Go/Plus/Pro users can spend their plan in *participating* apps:

- Help center, "Using your ChatGPT plan in other apps and sites" (updated ~2026-10-07):
  "If you have a Go, Plus, or Pro plan, you can also choose to use your ChatGPT plan for AI requests in participating
  commercial apps and sites that support this feature." ... "You don't need to create or share an OpenAI API key."
  "Supported open-source tools remain available to all ChatGPT users."
  https://help.openai.com/en/articles/20001542-using-your-chatgpt-plan-in-other-apps-and-sites
- Plan usage for open-source apps (no date on page): "These docs explain ChatGPT plan usage for open-source and
  locally hosted apps." ... "If you're interested in offering it in a paid or remotely hosted app, complete the
  interest form." https://developers.openai.com/siwc/token-sharing-open-source
- Websites (no date on page): "Sign in with ChatGPT is currently available to selected commercial partners through a
  limited trial." ... "To join the waitlist, contact your OpenAI representative."
  https://developers.openai.com/siwc/website
- Self-hosted VMs (open-source path): "Use this guide when you run an open-source app on a remote virtual machine
  (VM)." The user completes OAuth locally and moves the credential file to the VM; "Host-specific usage attribution and
  revocation of ChatGPT plan access for transferred sessions are not yet available."
  https://developers.openai.com/siwc/token-sharing-open-source/self-hosted-vms

**The general Terms forbid the Claude-style shortcut** (the user hands us their Codex login and our hosted box runs
`codex` on it): Terms of Use, updated January 16, 2026, https://openai.com/policies/terms-of-use/ :
"You may not share your account credentials or make your account available to anyone else and are responsible for all
activities that occur under your account." The Codex auth docs say of `~/.codex/auth.json`: "Treat
`~/.codex/auth.json` like a password: it contains access tokens." "Don't commit it, paste it into tickets, or share it
in chat." https://learn.chatgpt.com/docs/auth (no date on page).

**Reading:** qodebase.app is a remotely hosted service. OpenAI's path for that is the interest form / partner trial
(an OAuth client of our own, plan usage granted by the user in ChatGPT, per-app weekly cap the user sets). Taking a
user's Codex login (device code or auth.json) into boxes we run would be the user making their account available to
us, which the Terms forbid, and which OpenAI has built a separate, approved channel to replace. So: **not allowed on
the hosted qodebase.app without OpenAI's approval.** The Claude-plan flow does not carry over.

Allowed today without approval:
1. **Bring your own OpenAI API key** for Codex in the boxes: usage-billed, the documented default for automation
   ("API keys are the right default for automation", non-interactive docs).
2. **Self-hosted qodebase copies** (/own: the person's own Cloudflare account, their own boxes): the user signing in to
   Codex on infrastructure they run is the documented remote/CI case (device code or moving their own auth.json to
   their own headless host; the CI guide for keeping a refreshed auth.json between runs). Nobody else holds the
   credential. Still the person's own judgement; OpenAI's docs describe it, they do not bless a hosting product.
3. **Apply** through the interest form for plan usage in a remotely hosted app (Eyal's decision: it is an application
   to OpenAI in his name).

## (b) The official Codex CLI, headless

- Sign-in: ChatGPT (subscription) or API key (usage). "Codex cloud requires signing in with ChatGPT." Headless: "Device
  code authentication (beta)": enable device-code login in ChatGPT security settings, run `codex login --device-auth`,
  open the link, enter the one-time code. Fallback: log in where a browser exists and copy `auth.json` to the host.
- Storage: `cli_auth_credentials_store` = `file` (`auth.json` under `CODEX_HOME`, default `~/.codex`), `keyring`,
  `auto`, `ephemeral` (memory only, this process).
- Refresh: "For sign in with ChatGPT sessions, Codex refreshes tokens automatically during use before they expire." No
  lifetimes published. A long-running process can keep a stale credential after an entitlement change (issue #47456:
  restart fixes it).
- Non-interactive: `codex exec "<task>"`; progress on stderr, final message on stdout; `--json` gives JSONL events
  (`thread.started`, `turn.started`, `turn.completed`, `turn.failed`, `item.*`, `error`). Default sandbox is read-only;
  "Prefer the explicit `--sandbox workspace-write` flag"; `--full-auto` is deprecated; `danger-full-access` /
  `--dangerously-bypass-approvals-and-sandbox` "only in a controlled environment (for example, an isolated CI runner or
  container)". In exec mode approvals cannot prompt (no TTY). Instructions file: `AGENTS.md`.
  https://learn.chatgpt.com/docs/non-interactive-mode
- Models with ChatGPT sign-in (models page, read 2026-10-13): Plus/Pro/Business: `gpt-6.1-sol`, `gpt-6-sol`,
  `gpt-6-luna` (`gpt-6-astra` listed as recommended, plan access not stated); Free/Go: `gpt-6-luna` in the desktop app;
  `gpt-5.5` retires from Codex on 2026-10-14. Set with `model = "…"` in config.toml or `-m`.
  https://learn.chatgpt.com/docs/models

## (c) Social proof

openai/codex: 129k stars, 20k forks, created 2025-04-13, pushed today; latest release rust-v0.162.1 (2026-10-09); npm
`@openai/codex` 0.162.1. Official vendor repo: passes. Only this CLI would be used (qodebase's container-agents
template already pins `@openai/codex`).

## Recommendation

Do not build "connect your Codex plan" for hosted qodebase.app now. Options for Eyal: (1) Codex in boxes with the
user's own OpenAI API key (allowed, quick, same box plumbing as the Claude plan: encrypted key, boot.env on tmpfs, real
binary, AGENTS.md); (2) Codex-plan sign-in only on self-hosted copies; (3) submit the interest form for plan usage in a
remotely hosted app, then build on the official OAuth flow (Sign in with ChatGPT + plan-usage scope + per-app cap)
when approved.
