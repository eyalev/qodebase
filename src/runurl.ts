// A repo's page on the run host: its own host (`<name>--<owner>.<run domain>`, or
// `ag-<id>--<name>--<owner>` for an agent fork), or the old path form when the name
// is too long for one DNS label (that form 301s to the host when it can).
// Its own module so sheet.ts and v2.ts can both use it without importing each other.

import { runHost } from './env';

export const runUrl = (runBase: string, repo: string, at = '') => {
  const h = runHost(repo, runBase.replace(/^https?:\/\//, ''));
  return h ? `https://${h}/${at}` : `${runBase}/${repo}/${at}`;
};
