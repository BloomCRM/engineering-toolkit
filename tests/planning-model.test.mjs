import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PHASES, ensureDedicatedEpics, applyDefaultDoD, buildPlanningItems, normalizeModel,
  TECH_DEBT_EPIC_ID, BUG_EPIC_ID, derivePriority, deriveEpicStatus, buildDoneEpics,
  parseGitDates, sequenceFutureEpics, countBacklog, checkGranularity
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

// --- timeline (item F) ---
test('parseGitDates: min start / max end from ISO commit-date lines', () => {
  const out = ['2026-06-30T12:00:00+03:00', '2026-06-01T09:00:00+03:00', '2026-06-15T18:00:00+03:00'].join('\n');
  const { start, end } = parseGitDates(out);
  assert.equal(start, '2026-06-01T09:00:00+03:00');
  assert.equal(end, '2026-06-30T12:00:00+03:00');
});

test('parseGitDates: single commit → start equals end', () => {
  const { start, end } = parseGitDates('2026-06-10T10:00:00Z');
  assert.equal(start, '2026-06-10T10:00:00Z');
  assert.equal(end, '2026-06-10T10:00:00Z');
});

test('parseGitDates: compares chronologically across timezone offsets', () => {
  // 2026-06-10T01:00:00+03:00 == 2026-06-09T22:00:00Z is EARLIER than 2026-06-10T00:00:00Z
  const { start, end } = parseGitDates('2026-06-10T00:00:00Z\n2026-06-10T01:00:00+03:00');
  assert.equal(start, '2026-06-10T01:00:00+03:00');
  assert.equal(end, '2026-06-10T00:00:00Z');
});

test('parseGitDates: empty / whitespace / all-invalid → nulls', () => {
  assert.deepEqual(parseGitDates(''), { start: null, end: null });
  assert.deepEqual(parseGitDates('  \n \n'), { start: null, end: null });
  assert.deepEqual(parseGitDates(null), { start: null, end: null });
});

test('parseGitDates: ignores blank and unparseable lines', () => {
  const { start, end } = parseGitDates('\nnot-a-date\n2026-06-05T00:00:00Z\n\n2026-06-20T00:00:00Z\n');
  assert.equal(start, '2026-06-05T00:00:00Z');
  assert.equal(end, '2026-06-20T00:00:00Z');
});

const fe = (id, phase, extra = {}) => ({ id, phase, type: 'feature', title: id, status: 'todo', stories: [], ...extra });

test('sequenceFutureEpics: excludes done epics, orders by phase, stamps sequence 1..n', () => {
  const seq = sequenceFutureEpics([
    fe('a', 'Scaling'), fe('done', 'MVP', { status: 'done' }), fe('b', 'MVP'), fe('c', 'Enterprise'),
  ]);
  assert.deepEqual(seq.map(e => e.id), ['b', 'a', 'c']); // MVP < Scaling < Enterprise
  assert.deepEqual(seq.map(e => e.sequence), [1, 2, 3]);
});

test('sequenceFutureEpics: stable within a phase (input order preserved)', () => {
  const seq = sequenceFutureEpics([fe('x', 'MVP'), fe('y', 'MVP'), fe('z', 'MVP')]);
  assert.deepEqual(seq.map(e => e.id), ['x', 'y', 'z']);
});

test('sequenceFutureEpics: a dependency is emitted before its dependent', () => {
  const seq = sequenceFutureEpics([fe('a', 'MVP', { dependsOn: ['b'] }), fe('b', 'MVP')]);
  assert.deepEqual(seq.map(e => e.id), ['b', 'a']);
});

test('sequenceFutureEpics: deps outside the future set are ignored (no hang)', () => {
  const seq = sequenceFutureEpics([fe('a', 'MVP', { dependsOn: ['done-x', 'missing'] })]);
  assert.deepEqual(seq.map(e => e.id), ['a']);
});

test('sequenceFutureEpics: a dependency cycle still terminates', () => {
  const seq = sequenceFutureEpics([fe('a', 'MVP', { dependsOn: ['b'] }), fe('b', 'MVP', { dependsOn: ['a'] })]);
  assert.equal(seq.length, 2);
  assert.deepEqual(seq.map(e => e.sequence), [1, 2]);
});

test('normalizeModel: stamps sequence on future epics, not on done epics', () => {
  const model = {
    schemaVersion: '1.0',
    knowledgeModel: { domains: [{ id: 'bookings', name: 'Bookings', status: 'implemented' }], architecture: [], techDebt: [], infrastructure: [], security: [], risks: [] },
    planningModel: { phases: [], items: [] },
    backlog: { epics: [{ id: 'epic-cal', trackerKey: null, phase: 'MVP', type: 'feature', title: 'Calendar', stories: [{ id: 's1', trackerKey: null, title: 'Day', acceptanceCriteria: [{ given: 'g', when: 'w', then: 't' }], definitionOfDone: ['code'], tasks: [] }] }] }
  };
  const n = normalizeModel(model);
  assert.equal(n.backlog.epics.find(e => e.id === 'epic-cal').sequence, 1);
  assert.equal(n.backlog.epics.find(e => e.id === 'epic-done-bookings').sequence, undefined);
  assert.deepEqual(validateModel(n), []);
});

// --- subtask granularity (item H) ---
function granularityBacklog(subs) {
  // one epic → one story → one task → `subs` subtasks
  return { epics: [{ id: 'e', stories: [{ id: 's', tasks: [{ id: 't', subtasks: subs.map((id) => ({ id })) }] }] }] };
}

test('countBacklog: counts each level and total', () => {
  const c = countBacklog(granularityBacklog(['a', 'b']));
  assert.deepEqual(c, { epics: 1, stories: 1, tasks: 1, subtasks: 2, total: 5 });
});

test('countBacklog: empty backlog is all zeros', () => {
  assert.deepEqual(countBacklog({ epics: [] }), { epics: 0, stories: 0, tasks: 0, subtasks: 0, total: 0 });
  assert.deepEqual(countBacklog(null), { epics: 0, stories: 0, tasks: 0, subtasks: 0, total: 0 });
});

test('checkGranularity: a balanced backlog raises no warnings', () => {
  const backlog = { epics: [{ id: 'e', stories: [
    { id: 's1', tasks: [{ id: 't1', subtasks: [{ id: 'a' }, { id: 'b' }] }, { id: 't2', subtasks: [] }] },
    { id: 's2', tasks: [{ id: 't3', subtasks: [{ id: 'c' }, { id: 'd' }] }] },
  ] }] };
  assert.deepEqual(checkGranularity(backlog).findings, []);
});

test('checkGranularity: over-decomposition (subtask share too high) warns', () => {
  const r = checkGranularity(granularityBacklog(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']));
  assert.ok(r.findings.some(f => f.code === 'high-subtask-share'));
});

test('checkGranularity: a task with exactly one sub-task is flagged (pointless split)', () => {
  const r = checkGranularity(granularityBacklog(['only']));
  const s = r.findings.find(f => f.code === 'singleton-subtask');
  assert.ok(s);
  assert.deepEqual(s.tasks, ['t']);
});

test('checkGranularity: a story exceeding the per-story cap is flagged', () => {
  const r = checkGranularity(granularityBacklog(['a', 'b', 'c', 'd', 'e', 'f', 'g']), { maxSubtaskShare: 1 });
  assert.ok(r.findings.some(f => f.code === 'dense-story'));
});

test('checkGranularity: thresholds are configurable', () => {
  const backlog = granularityBacklog(['a', 'b']);
  assert.ok(checkGranularity(backlog, { maxSubtaskShare: 0.1 }).findings.some(f => f.code === 'high-subtask-share'));
  assert.ok(!checkGranularity(backlog, { maxSubtaskShare: 0.9 }).findings.some(f => f.code === 'high-subtask-share'));
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
