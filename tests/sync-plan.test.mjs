import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  flattenBacklog, engLabel, buildSyncPlan, applyResults, validateReadyForSync,
  STATUS_CATEGORY_BY_INTENT, resolveTransitionByCategory, resolveTransitionForStatus,
  engHash, engHashLabel, readEngHash, decideDescriptionUpdate, ENG_HASH_PREFIX
} from '../skills/sync-tracker/scripts/sync-plan.mjs';

// Shape returned by Atlassian official getTransitionsForJiraIssue.
function transitions() {
  return [
    { id: '11', name: 'To Do', to: { name: 'To Do', statusCategory: { key: 'new', name: 'To Do' } } },
    { id: '21', name: 'Start', to: { name: 'In Progress', statusCategory: { key: 'indeterminate', name: 'In Progress' } } },
    { id: '51', name: 'Ship it', to: { name: 'Done', statusCategory: { key: 'done', name: 'Done' } } },
  ];
}

function backlog() {
  return {
    epics: [{
      id: 'epic-calendar', trackerKey: null, phase: 'MVP', type: 'feature', title: 'Calendar',
      stories: [{
        id: 'story-day', trackerKey: null, title: 'Day view',
        acceptanceCriteria: [{ given: 'g', when: 'w', then: 't' }],
        definitionOfDone: ['code'],
        tasks: [{ id: 'task-be', trackerKey: null, category: 'backend', subtasks: [{ id: 'sub-1', title: 'wire endpoint' }] }]
      }]
    }]
  };
}

test('engLabel: stable eng-id label', () => {
  assert.equal(engLabel('epic-calendar'), 'eng-id:epic-calendar');
});

test('flattenBacklog: parent-first order epic->story->task->subtask', () => {
  const nodes = flattenBacklog(backlog());
  assert.deepEqual(nodes.map(n => n.kind), ['epic', 'story', 'task', 'subtask']);
  assert.equal(nodes[1].parentEngId, 'epic-calendar');
  assert.equal(nodes[2].parentEngId, 'story-day');
  assert.equal(nodes[3].parentEngId, 'task-be');
});

test('buildSyncPlan: fresh backlog is all creates, parent-first', () => {
  const plan = buildSyncPlan(backlog());
  assert.ok(plan.operations.every(o => o.op === 'create'));
  assert.equal(plan.operations[0].kind, 'epic');
  assert.equal(plan.summary.creates, 4);
  assert.equal(plan.summary.updates, 0);
});

test('buildSyncPlan: trackerKey in model => update', () => {
  const b = backlog(); b.epics[0].trackerKey = 'BLOOM-1';
  const plan = buildSyncPlan(b);
  const epicOp = plan.operations.find(o => o.engId === 'epic-calendar');
  assert.equal(epicOp.op, 'update');
  assert.equal(epicOp.trackerKey, 'BLOOM-1');
});

test('buildSyncPlan: engId in existingIndex => update with that key', () => {
  const plan = buildSyncPlan(backlog(), { 'story-day': 'BLOOM-9' });
  const storyOp = plan.operations.find(o => o.engId === 'story-day');
  assert.equal(storyOp.op, 'update');
  assert.equal(storyOp.trackerKey, 'BLOOM-9');
});

test('applyResults: writes trackerKey back into nested model', () => {
  const b = backlog();
  applyResults(b, { 'epic-calendar': 'BLOOM-1', 'task-be': 'BLOOM-3', 'sub-1': 'BLOOM-4' });
  assert.equal(b.epics[0].trackerKey, 'BLOOM-1');
  assert.equal(b.epics[0].stories[0].tasks[0].trackerKey, 'BLOOM-3');
  assert.equal(b.epics[0].stories[0].tasks[0].subtasks[0].trackerKey, 'BLOOM-4');
});

test('validateReadyForSync: jira + ready + mcp + key => no errors', () => {
  const cfg = { provider: 'jira', providerStatus: 'ready', mcp: { available: true }, project: { key: 'BLOOM' } };
  assert.deepEqual(validateReadyForSync(cfg), []);
});

test('validateReadyForSync: incomplete config is blocked', () => {
  const cfg = { provider: 'jira', providerStatus: 'incomplete', mcp: { available: false }, project: { key: null } };
  const errs = validateReadyForSync(cfg);
  assert.ok(errs.length >= 1);
  assert.ok(errs.some(e => /ready|mcp|project/i.test(e)));
});

test('validateReadyForSync: non-jira provider is blocked', () => {
  const cfg = { provider: 'linear', providerStatus: 'stub', mcp: { available: false }, project: { key: null } };
  assert.ok(validateReadyForSync(cfg).some(e => /jira|sync-ready/i.test(e)));
});

test('STATUS_CATEGORY_BY_INTENT: maps epic status to universal category keys', () => {
  assert.equal(STATUS_CATEGORY_BY_INTENT['done'], 'done');
  assert.equal(STATUS_CATEGORY_BY_INTENT['in-progress'], 'indeterminate');
  assert.equal(STATUS_CATEGORY_BY_INTENT['todo'], 'new');
});

test('resolveTransitionByCategory: picks transition by target category, not name', () => {
  assert.equal(resolveTransitionByCategory(transitions(), 'done'), '51');
  assert.equal(resolveTransitionByCategory(transitions(), 'indeterminate'), '21');
  assert.equal(resolveTransitionByCategory(transitions(), 'new'), '11');
});

test('resolveTransitionByCategory: works when status names are renamed/localized', () => {
  // Names are Ukrainian, categories are the universal keys — must still resolve.
  const localized = [
    { id: '7', name: 'Готово', to: { name: 'Готово', statusCategory: { key: 'done' } } },
  ];
  assert.equal(resolveTransitionByCategory(localized, 'done'), '7');
});

test('resolveTransitionByCategory: tolerates flattened statusCategory shape', () => {
  const flat = [{ id: '9', name: 'Done', statusCategory: { key: 'done' } }];
  assert.equal(resolveTransitionByCategory(flat, 'done'), '9');
});

test('resolveTransitionByCategory: returns null when no transition matches', () => {
  const onlyTodo = [{ id: '11', to: { statusCategory: { key: 'new' } } }];
  assert.equal(resolveTransitionByCategory(onlyTodo, 'done'), null);
});

test('resolveTransitionByCategory: null on bad input', () => {
  assert.equal(resolveTransitionByCategory(null, 'done'), null);
  assert.equal(resolveTransitionByCategory(transitions(), null), null);
  assert.equal(resolveTransitionByCategory(transitions(), undefined), null);
});

test('resolveTransitionByCategory: first match wins on duplicate categories', () => {
  const dup = [
    { id: '50', to: { statusCategory: { key: 'done' } } },
    { id: '51', to: { statusCategory: { key: 'done' } } },
  ];
  assert.equal(resolveTransitionByCategory(dup, 'done'), '50');
});

test('resolveTransitionForStatus: resolves straight from epic status intent', () => {
  assert.equal(resolveTransitionForStatus(transitions(), 'done'), '51');
  assert.equal(resolveTransitionForStatus(transitions(), 'in-progress'), '21');
});

test('resolveTransitionForStatus: unknown status yields null; todo maps to the new category', () => {
  assert.equal(resolveTransitionForStatus(transitions(), 'todo'), '11');
  assert.equal(resolveTransitionForStatus(transitions(), 'bogus'), null);
});

// --- conservative-update marker (item G) ---
test('engHash: deterministic and change-sensitive', () => {
  assert.equal(engHash('hello world'), engHash('hello world'));
  assert.notEqual(engHash('hello world'), engHash('hello world!'));
  assert.equal(typeof engHash('x'), 'string');
});

test('engHashLabel: prefixed label carrying the content hash', () => {
  assert.equal(engHashLabel('abc'), `${ENG_HASH_PREFIX}${engHash('abc')}`);
});

test('readEngHash: extracts the stored hash from a label list, else null', () => {
  assert.equal(readEngHash(['eng-sync', engHashLabel('desc'), 'phase:MVP']), engHash('desc'));
  assert.equal(readEngHash(['eng-sync', 'phase:MVP']), null);
  assert.equal(readEngHash(null), null);
});

test('decideDescriptionUpdate: empty current description is always overwritten', () => {
  assert.equal(decideDescriptionUpdate({ current: '', lastHash: null }).action, 'overwrite');
  assert.equal(decideDescriptionUpdate({ current: '   ', lastHash: 'abc' }).action, 'overwrite');
});

test('decideDescriptionUpdate: force overwrites regardless', () => {
  const d = decideDescriptionUpdate({ current: 'human wrote this', lastHash: null, force: true });
  assert.equal(d.action, 'overwrite');
  assert.equal(d.reason, 'forced');
});

test('decideDescriptionUpdate: no marker on a non-empty description => skip (protect)', () => {
  const d = decideDescriptionUpdate({ current: 'legacy or human text', lastHash: null });
  assert.equal(d.action, 'skip');
  assert.equal(d.reason, 'no-marker');
});

test('decideDescriptionUpdate: description unchanged since last eng-sync => overwrite', () => {
  const text = 'what eng wrote last time';
  const d = decideDescriptionUpdate({ current: text, lastHash: engHash(text) });
  assert.equal(d.action, 'overwrite');
  assert.equal(d.reason, 'unchanged-since-sync');
});

test('decideDescriptionUpdate: human edited since last sync => skip', () => {
  const d = decideDescriptionUpdate({ current: 'human changed it', lastHash: engHash('what eng wrote') });
  assert.equal(d.action, 'skip');
  assert.equal(d.reason, 'human-edited');
});
