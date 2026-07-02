// Zero-dependency: map stub-marker file hits onto "fake-done" Knowledge Model domains.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { pathsMatch } from '../../detect-changes/scripts/change-plan.mjs';

// Signals that a file may be a stub/mock/placeholder (grepped by the SKILL, tests excluded).
export const MARKERS = [
  'TODO', 'FIXME', 'HACK',
  'NotImplementedException', 'NotImplemented', 'throw new NotSupported',
  'Mock', 'Noop', 'Stub', 'Dummy',
  'placeholder', 'hardcoded', 'mock data', 'sample data'
];

// domains marked done-ish whose sources overlap the stub-hit files.
export function flagSuspects(model, hitPaths) {
  const hits = (hitPaths || []).map(x => (typeof x === 'string' ? x : x.path)).filter(Boolean);
  const out = [];
  for (const d of model?.knowledgeModel?.domains || []) {
    if (d.status !== 'implemented' && d.status !== 'partial') continue; // planned = already not-done
    const matched = (d.sources || []).filter(s => hits.some(h => pathsMatch(s, h)));
    if (matched.length) out.push({ id: d.id, status: d.status, matchedSources: matched });
  }
  return out;
}

export function buildRealityReport(model, hitPaths) {
  const suspects = flagSuspects(model, hitPaths);
  const recommendation = suspects.length
    ? `Verify these ${suspects.length} "done" domain(s) against the code; downgrade status (implemented->partial/planned) if the feature is a mock/stub, before the done-map syncs them as Done.`
    : 'No fake-done suspects — done statuses look clean against stub markers.';
  return { checkedDomains: (model?.knowledgeModel?.domains || []).length, suspects, recommendation };
}

function isMain() {
  return process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
}

if (isMain()) {
  const [, , modelFile, hitsFile] = process.argv;
  try {
    const model = JSON.parse(readFileSync(modelFile, 'utf8'));
    const hits = readFileSync(hitsFile, 'utf8').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    console.log(JSON.stringify(buildRealityReport(model, hits), null, 2));
  } catch (err) {
    console.error('ERROR: ' + err.message);
    process.exit(1);
  }
}
