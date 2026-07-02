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

// --- Semantic domain dedup (item L) ----------------------------------------
// The id-merge only dedups EXACT ids. Analyze also produces string-similar ids
// (`cash-desk`/`cashdesk`/`finance-cashdesk`) and meaning-similar ones
// (`bookings`/`calendar-ui`). This deterministic pre-pass catches the
// string-similar cluster; meaning-similar needs the LLM (final-reviewer).

const normId = (id) => String(id).toLowerCase().replace(/[^a-z0-9]+/g, '');
const tokenizeId = (id) => String(id)
  .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
  .toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

// Conservative: merge only high-confidence string dups. Meaning-similar pairs
// (no shared normalized string, no significant shared token) are left alone.
function isStringSimilar(a, b) {
  if (normId(a) === normId(b)) return true;
  const ta = new Set(tokenizeId(a)), tb = new Set(tokenizeId(b));
  const [small, big] = ta.size <= tb.size ? [ta, tb] : [tb, ta];
  if (small.size === 0) return false;
  let significant = false;
  for (const t of small) {
    if (!big.has(t)) return false;      // require full token-subset
    if (t.length >= 4) significant = true;
  }
  return significant;                    // guard trivial tokens (api ⊂ api-gateway)
}

// Cluster string-similar domain ids (union-find, transitive) → merge suggestions.
// Canonical = shortest id (stable tiebreak). Only groups of ≥2 are returned.
export function suggestDomainMerges(domains) {
  const list = (domains || []).filter(d => d && d.id);
  const parent = new Map(list.map(d => [d.id, d.id]));
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const union = (a, b) => parent.set(find(a), find(b));
  for (let i = 0; i < list.length; i++)
    for (let j = i + 1; j < list.length; j++)
      if (isStringSimilar(list[i].id, list[j].id)) union(list[i].id, list[j].id);
  const groups = new Map();
  for (const d of list) {
    const root = find(d.id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(d.id);
  }
  const suggestions = [];
  for (const ids of groups.values()) {
    if (ids.length < 2) continue;
    const canonical = [...ids].sort((a, b) => a.length - b.length || a.localeCompare(b))[0];
    suggestions.push({ canonical, duplicates: ids.filter(x => x !== canonical).sort() });
  }
  return suggestions.sort((a, b) => a.canonical.localeCompare(b.canonical));
}

// Apply confirmed merges (from suggestDomainMerges + the final-reviewer's
// meaning-similar additions) to a knowledgeModel. Deterministic: folds each
// duplicate domain into its canonical (union dependsOn/sources, canonical keeps
// its own name/status), remaps every dependsOn reference dup→canonical, and
// drops self-deps created by the remap. mergeFindings can't do this (additive
// by id), so this is the step that actually collapses the count.
export function applyDomainMerges(km, merges) {
  if (!km || !Array.isArray(km.domains)) return km;
  const remap = new Map();
  for (const m of merges || []) {
    if (!m || !m.canonical) continue;
    for (const dup of m.duplicates || []) if (dup && dup !== m.canonical) remap.set(dup, m.canonical);
  }
  if (remap.size === 0) return km;
  const resolve = (id) => remap.get(id) || id;

  const byId = new Map();
  for (const d of km.domains) {
    const cid = resolve(d.id);
    const isCanonical = d.id === cid;
    if (!byId.has(cid)) {
      byId.set(cid, { ...d, id: cid, dependsOn: uniq(d.dependsOn), sources: uniq(d.sources) });
    } else {
      const kept = byId.get(cid);
      kept.dependsOn = uniq([...(kept.dependsOn || []), ...(d.dependsOn || [])]);
      kept.sources = uniq([...(kept.sources || []), ...(d.sources || [])]);
      if (isCanonical) { kept.name = d.name; if (d.status) kept.status = d.status; }
    }
  }
  const domains = [...byId.values()]
    .map(d => ({ ...d, dependsOn: uniq((d.dependsOn || []).map(resolve).filter(x => x !== d.id)) }))
    .sort((a, b) => a.id.localeCompare(b.id));
  return { ...km, domains };
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
    } else if (cmd === 'dedup') {
      // dedup <km.json> → string-similar domain merge suggestions (pre-pass for L).
      const km = JSON.parse(readFileSync(file, 'utf8'));
      console.log(JSON.stringify(suggestDomainMerges(km.domains || km), null, 2));
    } else if (cmd === 'apply-merges') {
      // apply-merges <km.json> <merges.json> → km with duplicate domains collapsed.
      // merges.json: [{ canonical, duplicates: [] }] confirmed by the final-reviewer.
      const km = JSON.parse(readFileSync(file, 'utf8'));
      const merges = JSON.parse(readFileSync(process.argv[4], 'utf8'));
      console.log(JSON.stringify(applyDomainMerges(km, merges), null, 2));
    } else {
      console.error('usage: knowledge-model.mjs <merge <findings.json>|validate <km.json>|gaps <km.json> <plans.json>|dedup <km.json>|apply-merges <km.json> <merges.json>>');
      process.exit(2);
    }
  } catch (err) {
    console.error('ERROR: ' + err.message);
    process.exit(1);
  }
}
