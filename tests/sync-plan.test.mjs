import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  flattenBacklog, engLabel, buildSyncPlan, applyResults, validateReadyForSync
} from '../skills/sync-tracker/scripts/sync-plan.mjs';

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
