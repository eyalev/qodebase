import type { AgentBox } from './box';
import type { Project } from './project';
import type { Registry } from './registry';
import type { BuildBox } from './build';
import type { Installs } from './install';

export interface Env {
  AgentBox: DurableObjectNamespace<AgentBox>;
  Project: DurableObjectNamespace<Project>;
  Registry: DurableObjectNamespace<Registry>;
  BuildBox: DurableObjectNamespace<BuildBox>;
  Installs: DurableObjectNamespace<Installs>;
  TalkLog: DurableObjectNamespace<import('./talk').TalkLog>;
  TalkVoice?: DurableObjectNamespace<import('./talkvoice').TalkVoice>;   // the conversation agent (src/talkvoice.ts)
  Ledger: DurableObjectNamespace<import('./costs').Ledger>;   // per-person cost ledger (src/costs.ts)
  AI?: Ai;                    // Workers AI (Talk: src/talk.ts)
  TALK_GATEWAY?: string;
  TALK?: Fetcher;
  CLIPS?: R2Bucket;            // Talk: the owner's own dictation recordings, kept 7 days when they turn it on (talk Worker only)             // the Talk Worker (qodebase-talk) over a service binding; unset = Talk runs in-process      // AI Gateway id for Talk's model calls (rate limited); unset on self-hosted copies
  CF_OAUTH_CLIENT_ID: string;      // forq's "Sign in with Cloudflare" OAuth client (src/install.ts)
  CF_OAUTH_CLIENT_SECRET: string;
  ACCOUNT_ID: string;
  CF_DEPLOY_TOKEN: string;      // Workers Scripts write only; BuildBox passes it to one wrangler command at a time
  API_BASE: string;             // this Worker on workers.dev (DOs call back into it)
  ISSUES_WEBHOOK_SECRET: string; // Cloudflare Notifications sends it as cf-webhook-auth
  OBS_READ_TOKEN: string;
  KEY_ENC_SECRET: string;
  CF_VERSION_METADATA?: { id: string; tag?: string; timestamp?: string };        // encrypts users' Anthropic API keys (AES-GCM)
  OWNER_HANDLE: string;          // runs on the Claude subscription; everyone else brings an API key
  OTHERS_MAX_AWAKE: string;      // awake boxes per non-owner user (their containers bill this account)        // Workers Observability read: an issue's occurrences for the router agent
  ARTIFACTS: Artifacts;
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
  HANDLES: string;            // JSON {email: handle}
  UI_HOST: string;            // forq.kapps.dev
  UI_VARIANT_HOSTS?: string;  // design-variant preview hosts (comma-separated), see variants/
  SELF_HOST?: string;         // '1' = a copy installed into someone's own Cloudflare (src/install.ts template qodebase)
  BOX_IMAGE?: string;         // 'managed' = boxes start from cloudflare/debian-trixie and set themselves up (no registry image)
  FRONT_HOSTS?: string;       // hosts served through a front Worker in another account (qodebase.app until its zone moves here)
  FRONT_SECRET?: string;      // that front Worker's shared secret (x-qb-front)
  RUN_HOST: string;           // ttyview.dev (static apps, /<owner>.<name>/)
  APPS_DOMAIN?: string;       // ttyview.dev: Worker apps at <name>--<owner>.<APPS_DOMAIN>
  APPS_ZONE_ID?: string;      // that zone (exclusion routes, see build.ts excludeFromRunRoute)
  MAX_AGENTS_PER_PROJECT: string;
  MAX_AWAKE_BOXES: string;     // change agents awake per project
  MAX_TOTAL_AWAKE?: string;    // every box on the account, every role, owner included (safety net)
  CLAUDE_CODE_OAUTH_TOKEN: string;
  ADMIN_SECRET: string;
}

/** `owner/name` ↔ Artifacts repo name `owner.name`. */
export const slugOf = (owner: string, name: string) => `${owner}.${name}`;
// No '--': app hosts are <name>--<owner>[.…] and agent ids <slug>--<short>.
export const NAME_RE = /^(?!.*--)[a-z0-9][a-z0-9-]{0,38}$/;
/** Agent ids are `<slug>--<short>`; the router is `<slug>--router`. */
export const AGENT_RE = /^([a-z0-9-]+\.[a-z0-9-]+)--([a-z0-9]+)$/;
export const projectOf = (agentId: string) => agentId.split('--')[0];

/** The Worker a project's live app deploys as (workers.dev, ≤ 63 chars with a preview alias). */
export const appWorkerName = (slug: string) => `forq-app-${slug.replace(/\./g, '-')}`.slice(0, 50).replace(/-+$/, '');
/** A Worker app's own hostname, `<name>--<owner>.<domain>` (handles cannot hold
 *  `--`, so the owner is what follows the last one). One DNS label: at most 63
 *  characters, the name is shortened to fit. No domain → workers.dev only. */
export const appHost = (slug: string, domain?: string) => {
  if (!domain) return undefined;
  const [owner, name] = slug.split('.');
  return `${name.slice(0, 63 - 2 - owner.length).replace(/-+$/, '')}--${owner}.${domain}`;
};
/** A static project's or fork's own host on the run domain (one label, so the
 *  zone's universal certificate covers it): `owner.name` → `name--owner`,
 *  fork `owner.name--short` → `ag-short--name--owner`. Undefined past 63
 *  characters (served by path on the run host instead). */
export function runHost(repo: string, domain: string) {
  // A self-hosted copy's run host is a workers.dev name, which has no deeper
  // subdomains: its apps use the path form (<run host>/<owner>.<name>/).
  if (domain.endsWith('.workers.dev')) return undefined;
  const m = repo.match(/^([a-z0-9-]+)\.([a-z0-9-]+?)(?:--([a-z0-9]+))?$/);
  if (!m) return undefined;
  const [, owner, name, short] = m;
  const label = short ? `ag-${short}--${name}--${owner}` : `${name}--${owner}`;
  return label.length <= 63 ? `${label}.${domain}` : undefined;
}
/** The reverse of runHost's label; null when the label is not one. */
export function repoOfHostLabel(label: string) {
  const p = label.split('--');
  if (p.length === 2 && p.every(Boolean)) return `${p[1]}.${p[0]}`;
  if (p.length === 3 && /^ag-[a-z0-9]+$/.test(p[0]) && p[1] && p[2]) return `${p[2]}.${p[1]}--${p[0].slice(3)}`;
  return null;
}
/** Preview names must start with a letter. */
export const previewAlias = (agentId: string) => `ag-${agentId.split('--')[1]}`;

/** Hosts that serve the site itself: UI_HOST plus the front-Worker hosts. */
export const uiHosts = (env: { UI_HOST: string; FRONT_HOSTS?: string }) => [env.UI_HOST, ...(env.FRONT_HOSTS || '').split(',').map((h) => h.trim()).filter(Boolean)];
export const isUiHost = (env: { UI_HOST: string; FRONT_HOSTS?: string }, host: string) => uiHosts(env).includes(host);
/** Front-Worker hosts: no Access in front of /login, so sign-in hands over from UI_HOST. */
export const frontHosts = (env: { FRONT_HOSTS?: string }) => (env.FRONT_HOSTS || '').split(',').map((h) => h.trim()).filter(Boolean);
