import type { AgentBox } from './box';
import type { Project } from './project';

export interface Env {
  AgentBox: DurableObjectNamespace<AgentBox>;
  Project: DurableObjectNamespace<Project>;
  ARTIFACTS: Artifacts;
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
  MAX_AGENTS_PER_PROJECT: string;
  MAX_AWAKE_BOXES: string;
  CLAUDE_CODE_OAUTH_TOKEN: string;
  ADMIN_SECRET: string;
}
