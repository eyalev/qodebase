# qodebase

(Formerly forq. The code still uses that name internally: the Worker, the
`forq` CLI inside agent boxes, cookies and headers.)

A Git platform for the age of agents, built entirely on Cloudflare and made to
be used from a phone.

Every project runs: its page opens on the live app, with the code one tap away.
Every fork comes with its own agents: you tell a project's **router agent** what
you want, it splits the request into tasks and starts one agent per task. Each
agent works in its own container on its own fork, a **reviewer agent** checks
each push (including phone-size screenshots of the result), and you merge from
your phone.

Try it: https://qodebase.app (public to read; signing in needs your own
Anthropic API key).

From a terminal or an agent: `curl -fsSL https://qodebase.app/cli/install.sh | sh`,
then `qb login` (approve the code on your phone) and `qb help`. Agents can read
https://qodebase.app/llms.txt. Point `qb` at your own copy with `--host` or `QB_HOST`.

## How it works

| Piece | Built on |
|---|---|
| The site, the API, the run host | one Cloudflare Worker |
| A project: its repo, agents, reviews, code search | one Durable Object per project (SQLite) |
| Repositories | [Cloudflare Artifacts](https://developers.cloudflare.com/artifacts/): one repo per project, one fork per agent, a write token scoped to that fork |
| An agent | a container (Cloudflare Containers, `durable_object` scheduling, snapshots) running Claude Code in tmux, with a terminal and a chat view you can open from the phone |
| Router and reviewer | agents too, each in its own box, talking to qodebase through a small `forq` CLI (`spawn`, `send`, `list`, `merge`, `status`, `verdict`) |
| Live apps | static projects are served straight from Artifacts, at every commit and every fork; Worker projects are deployed by qodebase's builder, with a preview per agent fork |
| Production errors | Workers Issues send a project's errors to its router agent, which opens an agent to fix them |

Agents never share a working tree, so they never collide. An agent pushes to its
fork, the reviewer approves or asks for changes, and merging is one tap; the
router agent resolves conflicts.

More detail: [`CLAUDE.md`](CLAUDE.md) (architecture and the gotchas found
building it), [`DESIGN.md`](DESIGN.md) (the interface),
[`MEASUREMENTS.md`](MEASUREMENTS.md) (what a round of agent work costs).

## Run your own

qodebase runs on your own Cloudflare account with your own Claude subscription or
API key. See [`SELF_HOST.md`](SELF_HOST.md). The agent image is in
[`box/`](box/).

## Status

A working prototype, built in October 2026 for Cloudflare's "next Git platform"
challenge. One person uses it daily; expect rough edges.

## Licence

Apache-2.0, see [`LICENSE`](LICENSE). The demo apps in `seeds/` are MIT.
