// Zero-dependency merge/validation for the knowledgeModel section of project-model.json.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const SECTIONS = ['domains', 'architecture', 'techDebt', 'infrastructure', 'security', 'risks'];
export const RISK_KINDS = ['contradiction', 'unknown', 'hotspot'];

export function emptyKnowledgeModel() {
  return { domains: [], architecture: [], techDebt: [], infrastructure: [], security: [], risks: [] };
}

const uniq = (arr) => [...new Set((arr || []).filter(Boolean))];

export function mergeFindings(agentFindings) {
  const km = emptyKnowledgeModel();
  for (const section of SECTIONS) {
    const byId = new Map();
    for (const finding of agentFindings || []) {
      if (!finding || !Array.isArray(finding[section])) continue;
      for (const entry of finding[section]) {
        if (!entry || typeof entry.id !== 'string' || !entry.id) continue;
        if (!byId.has(entry.id)) {
          byId.set(entry.id, { ...entry, dependsOn: uniq(entry.dependsOn), sources: uniq(entry.sources) });
        } else {
          const kept = byId.get(entry.id);
          kept.dependsOn = uniq([...(kept.dependsOn || []), ...(entry.dependsOn || [])]);
          kept.sources = uniq([...(kept.sources || []), ...(entry.sources || [])]);
        }
      }
    }
    km[section] = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
  }
  return km;
}

export function validateKnowledgeModel(km) {
  const errors = [];
  if (!km || typeof km !== 'object') return ['knowledgeModel is not an object'];
  for (const section of SECTIONS) {
    if (!Array.isArray(km[section])) { errors.push(`${section} must be an array`); continue; }
    for (const entry of km[section]) {
      if (!entry || typeof entry.id !== 'string' || !entry.id) errors.push(`${section}: entry missing id`);
    }
  }
  for (const d of km.domains || []) if (d && !d.name) errors.push(`domain ${d.id}: missing name`);
  for (const r of km.risks || []) if (r && !RISK_KINDS.includes(r.kind)) errors.push(`risk ${r.id}: invalid kind "${r.kind}"`);
  return errors;
}

function isMain() {
  return process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
}

if (isMain()) {
  const [, , cmd, file] = process.argv;
  try {
    if (cmd === 'merge') {
      const findings = JSON.parse(readFileSync(file, 'utf8')); // array of agent findings
      console.log(JSON.stringify(mergeFindings(findings), null, 2));
    } else if (cmd === 'validate') {
      const km = JSON.parse(readFileSync(file, 'utf8'));
      const errors = validateKnowledgeModel(km);
      if (errors.length) { console.error('INVALID:\n' + errors.map(e => ' - ' + e).join('\n')); process.exit(1); }
      console.log('VALID');
    } else {
      console.error('usage: knowledge-model.mjs <merge <findings.json>|validate <km.json>>');
      process.exit(2);
    }
  } catch (err) {
    console.error('ERROR: ' + err.message);
    process.exit(1);
  }
}
