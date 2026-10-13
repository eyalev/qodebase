// Scale runs, qodebase.app/runs (qb7): one mount point; the client (runs.js) polls qb6's GET /api/runs proxy (the fleet
// key stays on the server) and draws the run cards and each run's timeline. Owner controls only when `own`.
import { shell } from '../ui';
import { RUNS_CSS, RUNS_JS } from './assets.gen';

export function runsPage(o: { own: boolean }) {
  return shell('Scale runs · qodebase', `<style>${RUNS_CSS}</style><div id="runs" data-api="/api/runs"${o.own ? ' data-own' : ''}></div><script>${RUNS_JS}</script>`);
}
