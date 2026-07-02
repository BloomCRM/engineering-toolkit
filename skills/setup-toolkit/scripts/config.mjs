// Zero-dependency tracker config for the eng toolkit (.eng/config.json).
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CONFIG_VERSION = '1.0';
export const PROVIDERS = ['jira', 'azure-devops', 'github-projects', 'linear'];
export const SYNC_READY = ['jira'];
export const PHASE_FIELDS = ['label', 'fixVersion'];
export const STATUSES = ['stub', 'incomplete', 'ready'];

export function configPath() {
  return process.env.ET_CONFIG_PATH || join(process.cwd(), '.eng', 'config.json');
}

// --- Workflow health (verify-only; item Q) ---------------------------------
// Jira's three universal status categories. Names localize/vary; these keys do
// not (same reason sync-tracker transitions by category — item P).
export const STATUS_CATEGORIES = ['new', 'indeterminate', 'done'];

// Status NAME patterns → the category the status SHOULD live in.
const NAME_CATEGORY_HINTS = [
  { category: 'new', re: /\b(backlog|to[\s-]?do|todo|open|new|icebox|idea|draft)\b/i },
  { category: 'indeterminate', re: /\b(in[\s-]?progress|in[\s-]?dev(elopment)?|doing|in[\s-]?review|review|testing|qa|blocked)\b/i },
  { category: 'done', re: /\b(done|closed|resolved|complete[d]?|shipped|cancell?ed)\b/i },
];

function statusCategoryKey(s) {
  return s?.statusCategory?.key || s?.category || null;
}
function statusName(s) {
  return s?.name || s?.statusCategory?.name || '';
}
function expectedCategory(name) {
  for (const h of NAME_CATEGORY_HINTS) if (h.re.test(name)) return h.category;
  return null; // no strong hint → don't second-guess
}

// Verify-only scan of a project's statuses. Returns WARN findings; never mutates
// and never reconfigures Jira. Empty/absent input → [] (nothing to assess).
export function checkWorkflowHealth(statuses) {
  const list = Array.isArray(statuses) ? statuses : [];
  if (list.length === 0) return [];
  const findings = [];

  // (a) miscategorized: name hints one category, actual category is another.
  for (const s of list) {
    const name = statusName(s);
    const actual = statusCategoryKey(s);
    const expected = expectedCategory(name);
    if (expected && actual && expected !== actual) {
      findings.push({
        level: 'warn', code: 'miscategorized-status', status: name,
        category: actual, expected,
        message: `Status "${name}" is in category "${actual}" but its name suggests "${expected}" — category-based reports/boards will misreport it.`,
      });
    }
  }

  // (b) more than one not-started status (by name) → collapse to one To Do.
  const notStarted = list.filter(s => expectedCategory(statusName(s)) === 'new').map(statusName);
  if (notStarted.length > 1) {
    findings.push({
      level: 'warn', code: 'redundant-not-started', statuses: notStarted,
      message: `${notStarted.length} not-started statuses (${notStarted.join(', ')}) — collapse to a single To Do to avoid ambiguity.`,
    });
  }

  // (c) a universal category with no status → transitions by category may have no target.
  for (const cat of STATUS_CATEGORIES) {
    if (!list.some(s => statusCategoryKey(s) === cat)) {
      findings.push({
        level: 'warn', code: 'empty-category', category: cat,
        message: `No status maps to the "${cat}" category — transitions by category (done/in-progress/todo) may have no target.`,
      });
    }
  }

  return findings;
}

export function deriveStatus(c) {
  if (!SYNC_READY.includes(c.provider)) return 'stub';
  if (c.mcp && c.mcp.available && c.project && c.project.key) return 'ready';
  return 'incomplete';
}

export function initConfig(provider) {
  const c = {
    configVersion: CONFIG_VERSION,
    provider,
    providerStatus: 'incomplete',
    mcp: { available: false, detectedTools: [], checkedAt: null },
    project: { key: null, issueTypes: [], statuses: [], components: [], fields: {} },
    mappings: { phaseField: 'label' }
  };
  c.providerStatus = deriveStatus(c);
  return c;
}

export function validateConfig(c) {
  const errors = [];
  if (!c || typeof c !== 'object') return ['config is not an object'];
  if (typeof c.configVersion !== 'string') errors.push('missing configVersion');
  if (!PROVIDERS.includes(c.provider)) errors.push(`invalid provider: ${c.provider}`);
  if (!c.mappings || !PHASE_FIELDS.includes(c.mappings.phaseField)) {
    errors.push('mappings.phaseField must be one of: ' + PHASE_FIELDS.join(', '));
  }
  if (!STATUSES.includes(c.providerStatus)) errors.push(`invalid providerStatus: ${c.providerStatus}`);
  if (!c.mcp || typeof c.mcp !== 'object' || !Array.isArray(c.mcp.detectedTools)) {
    errors.push('mcp.detectedTools must be an array');
  }
  if (!SYNC_READY.includes(c.provider) && c.providerStatus !== 'stub') {
    errors.push(`provider ${c.provider} is not sync-ready in this version; providerStatus must be "stub"`);
  }
  if (c.providerStatus === 'ready') {
    if (!c.mcp || !c.mcp.available) errors.push('providerStatus "ready" requires mcp.available = true');
    if (!c.project || !c.project.key) errors.push('providerStatus "ready" requires project.key');
  }
  return errors;
}

export function readConfig(path = configPath()) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function writeConfig(path = configPath(), config, { force = false } = {}) {
  if (existsSync(path) && !force) throw new Error(`config already exists at ${path} (use force to overwrite)`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(config, null, 2) + '\n', 'utf8');
  return path;
}

function isMain() {
  return process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
}

if (isMain()) {
  const [, , cmd, arg] = process.argv;
  const force = process.argv.includes('--force');
  const path = configPath();
  try {
    if (cmd === 'init') {
      if (!PROVIDERS.includes(arg)) {
        console.error('usage: config.mjs init <' + PROVIDERS.join('|') + '> [--force]');
        process.exit(2);
      }
      writeConfig(path, initConfig(arg), { force });
      console.log(`initialized ${arg} config at ${path}`);
    } else if (cmd === 'validate') {
      const errors = validateConfig(readConfig(path));
      if (errors.length) { console.error('INVALID:\n' + errors.map(e => ' - ' + e).join('\n')); process.exit(1); }
      console.log('VALID');
    } else if (cmd === 'show') {
      console.log(JSON.stringify(readConfig(path), null, 2));
    } else if (cmd === 'health') {
      // arg = path to a JSON file holding the statuses array read from the MCP
      // (each { name, statusCategory: { key } } or { name, category }).
      if (!arg) { console.error('usage: config.mjs health <statuses.json>'); process.exit(2); }
      const statuses = JSON.parse(readFileSync(arg, 'utf8'));
      const findings = checkWorkflowHealth(statuses);
      if (findings.length === 0) { console.log('OK: no workflow-health warnings'); }
      else { console.log(findings.map(f => `WARN [${f.code}] ${f.message}`).join('\n')); }
    } else {
      console.error('usage: config.mjs <init <provider>|validate|show|health <statuses.json>> [--force]');
      process.exit(2);
    }
  } catch (err) {
    console.error('ERROR: ' + err.message);
    process.exit(1);
  }
}
