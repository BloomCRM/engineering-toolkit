import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import {
  initConfig, validateConfig, deriveStatus, readConfig, writeConfig, CONFIG_VERSION,
  STATUS_CATEGORIES, checkWorkflowHealth,
  KNOWN_AGENTS, PANELS, resolveAnalysisPanel
} from '../skills/setup-toolkit/scripts/config.mjs';

// Atlassian-official status shape: { name, statusCategory: { key } }.
const st = (name, key) => ({ name, statusCategory: { key } });
function healthyStatuses() {
  return [st('To Do', 'new'), st('In Progress', 'indeterminate'), st('In Review', 'indeterminate'), st('Done', 'done')];
}
function findingCodes(fs) { return fs.map(f => f.code); }

test('initConfig(jira): incomplete and valid', () => {
  const c = initConfig('jira');
  assert.equal(c.provider, 'jira');
  assert.equal(c.providerStatus, 'incomplete');
  assert.deepEqual(validateConfig(c), []);
});

test('initConfig(linear): stub and valid', () => {
  const c = initConfig('linear');
  assert.equal(c.providerStatus, 'stub');
  assert.deepEqual(validateConfig(c), []);
});

test('deriveStatus: jira + mcp + project key => ready', () => {
  const c = initConfig('jira');
  c.mcp.available = true; c.project.key = 'BLOOM';
  assert.equal(deriveStatus(c), 'ready');
});

test('deriveStatus: jira without mcp => incomplete', () => {
  assert.equal(deriveStatus(initConfig('jira')), 'incomplete');
});

test('deriveStatus: non-sync-ready provider => stub', () => {
  assert.equal(deriveStatus(initConfig('azure-devops')), 'stub');
});

test('validateConfig: unknown provider is an error', () => {
  const c = initConfig('jira'); c.provider = 'trello';
  assert.ok(validateConfig(c).some(e => e.includes('invalid provider')));
});

test('validateConfig: invalid phaseField is an error', () => {
  const c = initConfig('jira'); c.mappings.phaseField = 'epicLink';
  assert.ok(validateConfig(c).some(e => e.includes('phaseField')));
});

test('validateConfig: non-jira with non-stub status is an error', () => {
  const c = initConfig('github-projects'); c.providerStatus = 'ready';
  assert.ok(validateConfig(c).some(e => e.includes('must be "stub"')));
});

test('validateConfig: ready status requires mcp.available and project.key', () => {
  const c = initConfig('jira'); c.providerStatus = 'ready';
  const errs = validateConfig(c);
  assert.ok(errs.some(e => e.includes('mcp.available')));
  assert.ok(errs.some(e => e.includes('project.key')));
});

test('STATUS_CATEGORIES: the three universal Jira category keys', () => {
  assert.deepEqual(STATUS_CATEGORIES, ['new', 'indeterminate', 'done']);
});

test('checkWorkflowHealth: a well-formed workflow yields no warnings', () => {
  assert.deepEqual(checkWorkflowHealth(healthyStatuses()), []);
});

test('checkWorkflowHealth: empty/no input yields no warnings (nothing to assess)', () => {
  assert.deepEqual(checkWorkflowHealth([]), []);
  assert.deepEqual(checkWorkflowHealth(null), []);
  assert.deepEqual(checkWorkflowHealth(undefined), []);
});

test('checkWorkflowHealth: a not-started name in the wrong category is flagged', () => {
  const fs = checkWorkflowHealth([st('Backlog', 'indeterminate'), st('In Progress', 'indeterminate'), st('Done', 'done')]);
  const mis = fs.find(f => f.code === 'miscategorized-status');
  assert.ok(mis, 'expected a miscategorized-status warning');
  assert.equal(mis.status, 'Backlog');
  assert.equal(mis.expected, 'new');
  assert.equal(mis.category, 'indeterminate');
});

test('checkWorkflowHealth: the BLM case — Backlog/Idea/To Do miscategorized into In Progress', () => {
  const fs = checkWorkflowHealth([
    st('Backlog', 'indeterminate'), st('Idea', 'indeterminate'), st('To Do', 'indeterminate'),
    st('In Progress', 'indeterminate'), st('Done', 'done'),
  ]);
  const codes = findingCodes(fs);
  // three miscategorized (Backlog, Idea, To Do), redundant not-started, and empty "new" category.
  assert.equal(fs.filter(f => f.code === 'miscategorized-status').length, 3);
  assert.ok(codes.includes('redundant-not-started'));
  assert.ok(fs.some(f => f.code === 'empty-category' && f.category === 'new'));
});

test('checkWorkflowHealth: more than one not-started status is flagged', () => {
  const fs = checkWorkflowHealth([st('Backlog', 'new'), st('To Do', 'new'), st('In Progress', 'indeterminate'), st('Done', 'done')]);
  const red = fs.find(f => f.code === 'redundant-not-started');
  assert.ok(red);
  assert.ok(red.statuses.includes('Backlog') && red.statuses.includes('To Do'));
});

test('checkWorkflowHealth: a target category with no status is flagged', () => {
  const fs = checkWorkflowHealth([st('To Do', 'new'), st('In Progress', 'indeterminate')]);
  assert.ok(fs.some(f => f.code === 'empty-category' && f.category === 'done'));
});

test('checkWorkflowHealth: tolerates the flattened { category } shape', () => {
  const fs = checkWorkflowHealth([{ name: 'Backlog', category: 'indeterminate' }, { name: 'In Progress', category: 'indeterminate' }, { name: 'Done', category: 'done' }]);
  assert.ok(fs.some(f => f.code === 'miscategorized-status' && f.status === 'Backlog'));
});

test('checkWorkflowHealth: an unrecognized status name is not miscategorized-flagged', () => {
  const fs = checkWorkflowHealth([st('To Do', 'new'), st('Selected for Development', 'indeterminate'), st('Done', 'done')]);
  assert.ok(!fs.some(f => f.code === 'miscategorized-status'));
});

// --- configurable analysis panel (item I) ---
test('initConfig: includes a default standard analysis panel and stays valid', () => {
  const c = initConfig('jira');
  assert.equal(c.analysis.panel, 'standard');
  assert.deepEqual(validateConfig(c), []);
});

test('resolveAnalysisPanel: default (no analysis) is the standard 7-agent panel', () => {
  assert.deepEqual(resolveAnalysisPanel({}), PANELS.standard);
  assert.equal(PANELS.standard.length, 7);
});

test('resolveAnalysisPanel: core is the cheap lens, deep is every lens', () => {
  assert.deepEqual(resolveAnalysisPanel({ analysis: { panel: 'core' } }), PANELS.core);
  assert.deepEqual(resolveAnalysisPanel({ analysis: { panel: 'deep' } }), KNOWN_AGENTS);
  // deep is the only tier carrying ux-reviewer + security-engineer
  assert.ok(resolveAnalysisPanel({ analysis: { panel: 'deep' } }).includes('ux-reviewer'));
  assert.ok(resolveAnalysisPanel({ analysis: { panel: 'deep' } }).includes('security-engineer'));
  assert.ok(!resolveAnalysisPanel({ analysis: { panel: 'standard' } }).includes('security-engineer'));
});

test('resolveAnalysisPanel: an explicit array is filtered to known agents and deduped', () => {
  const p = resolveAnalysisPanel({ analysis: { panel: ['ux-reviewer', 'ux-reviewer', 'bogus', 'qa-lead'] } });
  assert.deepEqual(p, ['ux-reviewer', 'qa-lead']);
});

test('resolveAnalysisPanel: an unknown tier falls back to standard', () => {
  assert.deepEqual(resolveAnalysisPanel({ analysis: { panel: 'nonsense' } }), PANELS.standard);
});

test('KNOWN_AGENTS: the nine reviewer lanes (final-reviewer runs separately)', () => {
  assert.equal(KNOWN_AGENTS.length, 9);
  assert.ok(KNOWN_AGENTS.includes('ux-reviewer') && KNOWN_AGENTS.includes('security-engineer'));
  assert.ok(!KNOWN_AGENTS.includes('final-reviewer'));
});

test('validateConfig: a bad panel tier is an error', () => {
  const c = initConfig('jira'); c.analysis.panel = 'turbo';
  assert.ok(validateConfig(c).some(e => e.includes('panel')));
});

test('validateConfig: an array panel with an unknown agent is an error', () => {
  const c = initConfig('jira'); c.analysis.panel = ['qa-lead', 'nope'];
  assert.ok(validateConfig(c).some(e => e.includes('panel')));
});

test('writeConfig/readConfig round-trips and guards overwrite', () => {
  const dir = mkdtempSync(join(tmpdir(), 'eng-cfg-'));
  const path = join(dir, '.eng', 'config.json');
  try {
    writeConfig(path, initConfig('jira'));
    assert.ok(existsSync(path));
    assert.equal(readConfig(path).configVersion, CONFIG_VERSION);
    assert.throws(() => writeConfig(path, initConfig('jira'), { force: false }), /exists/);
    writeConfig(path, initConfig('jira'), { force: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
