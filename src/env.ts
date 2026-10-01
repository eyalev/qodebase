import type { AgentBox } from './box';
import type { Project } from './project';
import type { Registry } from './registry';

export interface Env {
  AgentBox: DurableObjectNamespace<AgentBox>;
  Project: DurableObjectNamespace<Project>;
  Registry: DurableObjectNamespace<Registry>;
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
