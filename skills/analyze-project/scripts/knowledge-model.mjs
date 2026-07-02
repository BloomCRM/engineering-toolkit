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

// --- Completeness critic (item M) ------------------------------------------
// The semantic judgment — "does an existing domain cover this documented plan?"
// — is made by the completeness-critic pass (LLM), which tags each plan with the
// domain id it maps to (`coveredBy`) or null. This helper does the DETERMINISTIC
// part: surface plans with no coverage, and catch coverage that points at a
// domain that does not exist (a hallucinated match). Returns gap objects.
export function findCoverageGaps(km, plans) {
  const domainIds = new Set((km?.domains || []).map(d => d && d.id).filter(Boolean));
  const gaps = [];
  for (const plan of plans || []) {
    if (!plan || !plan.name) continue;
    const coveredBy = plan.coveredBy || null;
    if (!coveredBy) {
      gaps.push({ name: plan.name, reason: 'no-domain', sources: uniq(plan.sources) });
    } else if (!domainIds.has(coveredBy)) {
      gaps.push({ name: plan.name, reason: 'broken-coverage', coveredBy, sources: uniq(plan.sources) });
    }
  }
  return gaps;
}

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

// Turn coverage gaps into knowledgeModel `risks` (kind "unknown") so a documented
// but un-modelled plan surfaces in the backlog instead of silently vanishing.
export function gapsToRisks(gaps) {
  return (gaps || []).filter(g => g && g.name).map((g, i) => ({
    id: `gap-${slug(g.name) || `plan-${i + 1}`}`,
    title: g.reason === 'broken-coverage'
      ? `Documented plan "${g.name}" is mapped to a missing domain "${g.coveredBy}" — no real coverage.`
      : `Documented plan "${g.name}" has no domain or backlog entry — coverage gap.`,
    kind: 'unknown',
    sources: uniq(g.sources),
  }));
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
    } else if (cmd === 'gaps') {
      // gaps <km.json> <plans.json> → knowledgeModel risks for un-modelled plans.
      // plans.json: [{ name, coveredBy: <domainId|null>, sources: [] }] from the critic.
      const km = JSON.parse(readFileSync(file, 'utf8'));
      const plans = JSON.parse(readFileSync(process.argv[4], 'utf8'));
      console.log(JSON.stringify({ risks: gapsToRisks(findCoverageGaps(km, plans)) }, null, 2));
    } else {
      console.error('usage: knowledge-model.mjs <merge <findings.json>|validate <km.json>|gaps <km.json> <plans.json>>');
      process.exit(2);
    }
  } catch (err) {
    console.error('ERROR: ' + err.message);
    process.exit(1);
  }
}
