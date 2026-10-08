// The variants lab page, qodebase.app/lab (qb7, docs/lab/PLAN.md). One mount point; the client
// (lab.js) reads public/lab/{runs.jsonl, stages.jsonl, scenarios.json} and imports qb4's
// public/lab/predict.js. The owner also gets "Run for real" (estimate + runner command, v0).
import { shell } from '../ui';
import { LAB_CSS, LAB_JS } from './assets.gen';

export function labPage(o: { own: boolean }) {
  return shell('Variants lab · qodebase', `<style>${LAB_CSS}</style><div id="lab"${o.own ? ' data-own' : ''}></div><script>${LAB_JS}</script>`);
}
