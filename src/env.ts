import type { AgentBox } from './box';
import type { Project } from './project';
import type { Registry } from './registry';
import type { BuildBox } from './build';

export interface Env {
  AgentBox: DurableObjectNamespace<AgentBox>;
  Project: DurableObjectNamespace<Project>;
  Registry: DurableObjectNamespace<Registry>;
  BuildBox: DurableObjectNamespace<BuildBox>;
  ACCOUNT_ID: string;
  CF_DEPLOY_TOKEN: string;      // Workers Scripts write only; BuildBox passes it to one wrangler command at a time
  API_BASE: string;             // this Worker on workers.dev (DOs call back into it)
  ISSUES_WEBHOOK_SECRET: string; // Cloudflare Notifications sends it as cf-webhook-auth
  ARTIFACTS: Artifacts;
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
  HANDLES: string;            // JSON {email: handle}
  UI_HOST: string;            // forq.kapps.dev
  RUN_HOST: string;           // forq-run.kapps.dev
  MAX_AGENTS_PER_PROJECT: string;
  MAX_AWAKE_BOXES: string;
  CLAUDE_CODE_OAUTH_TOKEN: string;
  ADMIN_SECRET: string;
}

/** `owner/name` ↔ Artifacts repo name `owner.name`. */
export const slugOf = (owner: string, name: string) => `${owner}.${name}`;
export const NAME_RE = /^[a-z0-9][a-z0-9-]{0,38}$/;
/** Agent ids are `<slug>--<short>`; the router is `<slug>--router`. */
export const AGENT_RE = /^([a-z0-9-]+\.[a-z0-9-]+)--([a-z0-9]+)$/;
export const projectOf = (agentId: string) => agentId.split('--')[0];

/** The Worker a project's live app deploys as (workers.dev, ≤ 63 chars with a preview alias). */
export const appWorkerName = (slug: string) => `forq-app-${slug.replace(/\./g, '-')}`.slice(0, 50).replace(/-+$/, '');
/** Preview names must start with a letter. */
export const previewAlias = (agentId: string) => `ag-${agentId.split('--')[1]}`;
