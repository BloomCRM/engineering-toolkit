// Zero-dependency: map a git diff onto stale Knowledge Model entries.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const SECTIONS = ['domains', 'architecture', 'techDebt', 'infrastructure', 'security', 'risks'];

const norm = (p) => String(p || '').replace(/#.*$/, '').replace(/\\/g, '/').trim();

export function parseDiff(text) {
  const out = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cols = line.split('\t');
    const status = cols[0].trim()[0]; // A/M/D/R/C
    const path = cols[cols.length - 1].trim(); // current path (last column handles renames)
    if (path) out.push({ status, path });
  }
  return out;
}

export function pathsMatch(source, changed) {
  const s = norm(source), c = norm(changed);
  if (!s || !c) return false;
  return s === c || s.endsWith('/' + c) || c.endsWith('/' + s) || s.endsWith(c) || c.endsWith(s);
}

// changedPaths: array of strings or {path} objects.
export function matchSources(changedPaths, model) {
  const changed = (changedPaths || []).map(x => (typeof x === 'string' ? x : x.path)).filter(Boolean);
  const km = model?.knowledgeModel || {};
  const stale = {};
  for (const section of SECTIONS) {
    stale[section] = [];
    for (const entry of km[section] || []) {
      const srcs = entry.sources || [];
      if (srcs.some(s => changed.some(c => pathsMatch(s, c)))) stale[section].push(entry.id);
    }
  }
  return stale;
}

export function buildChangeReport(model, changedPaths) {
  const changed = (changedPaths || []).map(x => (typeof x === 'string' ? x : x.path)).filter(Boolean);
  const staleBySection = matchSources(changed, model);
  const staleCount = Object.values(staleBySection).reduce((n, a) => n + a.length, 0);
  let recommendation;
  if (staleCount) {
    recommendation = `Re-run /eng:analyze-project (focus on the ${staleCount} stale entr${staleCount === 1 ? 'y' : 'ies'}), then /eng:build-project-model.`;
  } else if (changed.length) {
    recommendation = 'Changed files do not map to any known model sources — a full /eng:analyze-project may be warranted.';
  } else {
    recommendation = 'No changes since the model baseline.';
  }
  return { baselineCommit: model?.source?.commit || null, changedFiles: changed, staleBySection, staleCount, recommendation };
}

function isMain() {
  return process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
}

if (isMain()) {
  const [, , cmd, modelFile, diffFile] = process.argv;
  try {
    if (cmd === 'report') {
      const model = JSON.parse(readFileSync(modelFile, 'utf8'));
      const rows = parseDiff(readFileSync(diffFile, 'utf8'));
      console.log(JSON.stringify(buildChangeReport(model, rows), null, 2));
    } else {
      console.error('usage: change-plan.mjs report <model.json> <diff.txt>');
      process.exit(2);
    }
  } catch (err) {
    console.error('ERROR: ' + err.message);
    process.exit(1);
  }
}
