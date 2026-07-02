import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PHASES, ensureDedicatedEpics, applyDefaultDoD, buildPlanningItems, normalizeModel,
  TECH_DEBT_EPIC_ID, BUG_EPIC_ID, derivePriority, deriveEpicStatus, buildDoneEpics
} from '../skills/build-project-model/scripts/planning-model.mjs';
import { validateModel, DEFAULT_DOD } from '../skills/knowledge-store/scripts/store.mjs';

function featureEpic() {
  return {
    id: 'epic-calendar', trackerKey: null, phase: 'MVP', type: 'feature', title: 'Calendar',
    stories: [{
      id: 'story-day', trackerKey: null, title: 'Day view',
      acceptanceCriteria: [{ given: 'g', when: 'w', then: 't' }],
      definitionOfDone: [],
      tasks: [{ id: 'task-be', trackerKey: null, category: 'backend', subtasks: [] }]
    }]
  };
}

test('ensureDedicatedEpics: adds tech-debt and bug epics when missing', () => {
  const epics = ensureDedicatedEpics([featureEpic()]);
  assert.ok(epics.some(e => e.id === TECH_DEBT_EPIC_ID && e.type === 'techdebt'));
  assert.ok(epics.some(e => e.id === BUG_EPIC_ID && e.type === 'bug'));
  assert.equal(epics.length, 3);
});

test('ensureDedicatedEpics: does not duplicate existing dedicated epics', () => {
  const td = { id: 'x', phase: 'MVP', type: 'techdebt', title: 'Debt', stories: [] };
  const bug = { id: 'y', phase: 'MVP', type: 'bug', title: 'Bugs', stories: [] };
  const epics = ensureDedicatedEpics([td, bug]);
  assert.equal(epics.filter(e => e.type === 'techdebt').length, 1);
  assert.equal(epics.filter(e => e.type === 'bug').length, 1);
});

test('applyDefaultDoD: fills empty Definition of Done', () => {
  const epics = applyDefaultDoD([featureEpic()]);
  assert.deepEqual(epics[0].stories[0].definitionOfDone, DEFAULT_DOD);
});

test('applyDefaultDoD: leaves a non-empty Definition of Done untouched', () => {
  const e = featureEpic(); e.stories[0].definitionOfDone = ['code'];
  applyDefaultDoD([e]);
  assert.deepEqual(e.stories[0].definitionOfDone, ['code']);
});

test('buildPlanningItems: one item per domain honoring decisions', () => {
  const km = { domains: [{ id: 'calendar', name: 'Calendar', status: 'partial' }], techDebt: [] };
  const items = buildPlanningItems(km, { calendar: { phase: 'Scaling', priority: 'high' } });
  assert.equal(items.length, 1);
  assert.equal(items[0].ref, 'calendar');
  assert.equal(items[0].phase, 'Scaling');
  assert.equal(items[0].priority, 'high');
  assert.equal(items[0].roadmapStatus, 'partial');
});

test('buildPlanningItems: defaults unknown phase to MVP and adds tech-debt items', () => {
  const km = { domains: [{ id: 'd', name: 'D', status: 'planned' }], techDebt: [{ id: 'td1', severity: 'high' }] };
  const items = buildPlanningItems(km, { d: { phase: 'Nonsense' } });
  assert.equal(items.find(i => i.ref === 'd').phase, 'MVP');
  assert.ok(items.some(i => i.ref === 'td1' && i.type === 'techdebt'));
});

test('derivePriority: maps phase to Jira priority', () => {
  assert.equal(derivePriority('MVP'), 'High');
  assert.equal(derivePriority('Production Ready'), 'Medium');
  assert.equal(derivePriority('Public Release'), 'Low');
  assert.equal(derivePriority('Enterprise'), 'Lowest');
  assert.equal(derivePriority('Nonsense'), 'Medium');
});

test('normalizeModel: stamps priority on epics (from phase) and stories (inherit epic)', () => {
  const model = {
    schemaVersion: '1.0',
    knowledgeModel: { domains: [], architecture: [], techDebt: [], infrastructure: [], security: [], risks: [] },
    planningModel: { phases: [], items: [] },
    backlog: { epics: [{
      id: 'epic-cal', trackerKey: null, phase: 'MVP', type: 'feature', title: 'Calendar',
      stories: [{ id: 's1', trackerKey: null, title: 'Day', acceptanceCriteria: [{ given: 'g', when: 'w', then: 't' }], definitionOfDone: ['code'], tasks: [] }]
    }] }
  };
  const n = normalizeModel(model);
  const epic = n.backlog.epics.find(e => e.id === 'epic-cal');
  assert.equal(epic.priority, 'High');
  assert.equal(epic.stories[0].priority, 'High');
});

test('normalizeModel: produces a model that passes store validation', () => {
  const model = {
    schemaVersion: '1.0',
    knowledgeModel: { domains: [{ id: 'calendar', name: 'Calendar', status: 'partial' }], architecture: [], techDebt: [], infrastructure: [], security: [], risks: [] },
    planningModel: { phases: [], items: [] },
    backlog: { epics: [featureEpic()] }
  };
  const n = normalizeModel(model);
  assert.deepEqual(validateModel(n), []);
  assert.deepEqual(n.planningModel.phases, PHASES);
  assert.ok(n.backlog.epics.some(e => e.type === 'techdebt'));
  assert.ok(n.backlog.epics.some(e => e.type === 'bug'));
  assert.deepEqual(n.backlog.epics.find(e => e.id === 'epic-calendar').stories[0].definitionOfDone, DEFAULT_DOD);
});

// --- v2.1 A: done epic-status map ---
test('deriveEpicStatus: maps domain status to epic status', () => {
  assert.equal(deriveEpicStatus('implemented'), 'done');
  assert.equal(deriveEpicStatus('partial'), 'in-progress');
  assert.equal(deriveEpicStatus('planned'), 'todo');
  assert.equal(deriveEpicStatus('unknown'), 'todo');
});

test('buildDoneEpics: one Done epic per implemented domain, no stories', () => {
  const km = { domains: [
    { id: 'bookings', name: 'Bookings', status: 'implemented' },
    { id: 'cashdesk', name: 'Cash desk', status: 'planned' },
    { id: 'access', name: 'Access', status: 'partial' }
  ] };
  const epics = buildDoneEpics(km);
  assert.deepEqual(epics.map(e => e.id), ['epic-done-bookings']);
  assert.equal(epics[0].status, 'done');
  assert.deepEqual(epics[0].stories, []);
  assert.equal(epics[0].type, 'feature');
});

test('normalizeModel: prepends done-epics and stamps status; still validates', () => {
  const model = {
    schemaVersion: '1.0',
    knowledgeModel: { domains: [{ id: 'bookings', name: 'Bookings', status: 'implemented' }], architecture: [], techDebt: [], infrastructure: [], security: [], risks: [] },
    planningModel: { phases: [], items: [] },
    backlog: { epics: [{ id: 'epic-cal', trackerKey: null, phase: 'MVP', type: 'feature', title: 'Calendar', stories: [{ id: 's1', trackerKey: null, title: 'Day', acceptanceCriteria: [{ given: 'g', when: 'w', then: 't' }], definitionOfDone: ['code'], tasks: [] }] }] }
  };
  const n = normalizeModel(model);
  assert.ok(n.backlog.epics.some(e => e.id === 'epic-done-bookings' && e.status === 'done'));
  assert.equal(n.backlog.epics.find(e => e.id === 'epic-cal').status, 'todo');
  assert.deepEqual(validateModel(n), []);
});

// --- smart run: normalizeWouldChange ---
import { normalizeWouldChange } from '../skills/build-project-model/scripts/planning-model.mjs';

test('normalizeWouldChange: model with implemented domain but no done-epic => true', () => {
  const m = {
    schemaVersion: '1.0',
    knowledgeModel: { domains: [{ id: 'bookings', name: 'Bookings', status: 'implemented' }], architecture: [], techDebt: [], infrastructure: [], security: [], risks: [] },
    planningModel: { phases: [], items: [] },
    backlog: { epics: [{ id: 'e1', trackerKey: 'BLM-1', phase: 'MVP', type: 'feature', title: 'X', priority: 'High', status: 'todo', stories: [] }] }
  };
  assert.equal(normalizeWouldChange(m), true);
});

test('normalizeWouldChange: already-normalized model => false', () => {
  const base = {
    schemaVersion: '1.0',
    knowledgeModel: { domains: [], architecture: [], techDebt: [], infrastructure: [], security: [], risks: [] },
    planningModel: { phases: [], items: [] },
    backlog: { epics: [] }
  };
  const n = normalizeModel(JSON.parse(JSON.stringify(base)));
  assert.equal(normalizeWouldChange(n), false);
});
