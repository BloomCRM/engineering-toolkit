import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pipelineState, configReady, hasSyncedAny } from '../skills/run/scripts/pipeline.mjs';

const readyConfig = { provider: 'jira', providerStatus: 'ready', mcp: { available: true }, project: { key: 'BLOOM' } };
const incompleteConfig = { provider: 'jira', providerStatus: 'incomplete', mcp: { available: false }, project: { key: null } };
const emptyKM = { knowledgeModel: { domains: [] }, backlog: { epics: [] } };
const withKM = { knowledgeModel: { domains: [{ id: 'calendar', name: 'Calendar' }] }, backlog: { epics: [] } };
function withBacklog(trackerKey = null) {
  return {
    knowledgeModel: { domains: [{ id: 'calendar', name: 'Calendar' }] },
    backlog: { epics: [{ id: 'epic-cal', type: 'feature', title: 'Calendar', trackerKey, stories: [{ id: 's1', trackerKey: null, tasks: [] }] }] }
  };
}

test('configReady: ready jira config is ready', () => {
  assert.equal(configReady(readyConfig), true);
  assert.equal(configReady(incompleteConfig), false);
  assert.equal(configReady(null), false);
});

test('nextStep: no config => setup', () => {
  assert.equal(pipelineState(null, emptyKM).nextStep, 'setup');
});

test('nextStep: config but empty Knowledge Model => analyze', () => {
  assert.equal(pipelineState(incompleteConfig, emptyKM).nextStep, 'analyze');
});

test('nextStep: Knowledge Model but no backlog => build', () => {
  assert.equal(pipelineState(incompleteConfig, withKM).nextStep, 'build');
});

test('nextStep: backlog but nothing synced => sync', () => {
  const s = pipelineState(readyConfig, withBacklog(null));
  assert.equal(s.nextStep, 'sync');
  assert.equal(s.hasSyncedAny, false);
});

test('nextStep: something synced => review-drift', () => {
  assert.equal(pipelineState(readyConfig, withBacklog('BLOOM-1')).nextStep, 'review-drift');
});

test('hasSyncedAny: detects a nested trackerKey on a story', () => {
  const model = { backlog: { epics: [{ id: 'e', trackerKey: null, stories: [{ id: 's', trackerKey: 'BLOOM-9', tasks: [] }] }] } };
  assert.equal(hasSyncedAny(model), true);
});

test('pipelineState: flags mirror the model', () => {
  const s = pipelineState(readyConfig, withBacklog(null));
  assert.deepEqual(
    { c: s.hasConfig, r: s.configReady, km: s.hasKnowledgeModel, b: s.hasBacklog },
    { c: true, r: true, km: true, b: true }
  );
});
