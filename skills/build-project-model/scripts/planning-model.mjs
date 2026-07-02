// Zero-dependency planning-model + backlog normalization for project-model.json.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DEFAULT_DOD, validateModel } from '../../knowledge-store/scripts/store.mjs';

export const PHASES = ['MVP', 'Production Ready', 'Public Release', 'Scaling', 'Enterprise', 'AI'];
export const TECH_DEBT_EPIC_ID = 'epic-tech-debt';
export const BUG_EPIC_ID = 'epic-bugs';

// Deterministic Jira priority from phase (never LLM-guessed).
export const PHASE_PRIORITY = {
  'MVP': 'High',
  'Production Ready': 'Medium',
  'Public Release': 'Low',
  'Scaling': 'Low',
  'Enterprise': 'Lowest',
  'AI': 'Lowest'
};
export function derivePriority(phase) {
  return PHASE_PRIORITY[phase] || 'Medium';
}

// Epic status from a domain's knowledge-model status.
export const EPIC_STATUSES = ['done', 'in-progress', 'todo'];
export function deriveEpicStatus(domainStatus) {
  if (domainStatus === 'implemented') return 'done';
  if (domainStatus === 'partial') return 'in-progress';
  return 'todo';
}

// Lightweight Done epics (no stories) for every already-implemented domain — the "what's built" map.
export function buildDoneEpics(knowledgeModel) {
  const epics = [];
  for (const d of knowledgeModel?.domains || []) {
    if (d.status !== 'implemented') continue;
    epics.push({
      id: `epic-done-${d.id}`, trackerKey: null, phase: 'MVP', type: 'feature',
      title: d.name || d.id, status: 'done', stories: []
    });
  }
  return epics;
}

export function ensureDedicatedEpics(epics) {
  const out = Array.isArray(epics) ? [...epics] : [];
  if (!out.some(e => e && e.type === 'techdebt')) {
    out.push({ id: TECH_DEBT_EPIC_ID, trackerKey: null, phase: 'MVP', type: 'techdebt', title: 'Technical Debt', stories: [] });
  }
  if (!out.some(e => e && e.type === 'bug')) {
    out.push({ id: BUG_EPIC_ID, trackerKey: null, phase: 'MVP', type: 'bug', title: 'Bug Fixes', stories: [] });
  }
  return out;
}

export function applyDefaultDoD(epics) {
  for (const epic of epics || []) {
    for (const story of epic.stories || []) {
      if (!Array.isArray(story.definitionOfDone) || story.definitionOfDone.length === 0) {
        story.definitionOfDone = [...DEFAULT_DOD];
      }
    }
  }
  return epics;
}

export function buildPlanningItems(knowledgeModel, decisions = {}) {
  const items = [];
  for (const d of knowledgeModel?.domains || []) {
    const dec = decisions[d.id] || {};
    items.push({
      ref: d.id,
      phase: PHASES.includes(dec.phase) ? dec.phase : 'MVP',
      type: 'feature',
      roadmapStatus: d.status || 'unknown',
      priority: dec.priority || 'medium'
    });
  }
  for (const td of knowledgeModel?.techDebt || []) {
    items.push({ ref: td.id, phase: 'MVP', type: 'techdebt', roadmapStatus: 'planned', priority: td.severity || 'medium' });
  }
  return items;
}

export function normalizeModel(model, { decisions = {} } = {}) {
  const m = { ...model };
  m.backlog = m.backlog && Array.isArray(m.backlog.epics) ? m.backlog : { epics: [] };
  m.backlog.epics = applyDefaultDoD(ensureDedicatedEpics(m.backlog.epics));
  const doneEpics = buildDoneEpics(m.knowledgeModel || {});
  const doneIds = new Set(doneEpics.map(e => e.id));
  m.backlog.epics = [...doneEpics, ...m.backlog.epics.filter(e => !doneIds.has(e.id))];
  for (const epic of m.backlog.epics) {
    if (!epic.status) epic.status = 'todo';
    epic.priority = derivePriority(epic.phase);
    for (const story of epic.stories || []) story.priority = epic.priority;
  }
  m.planningModel = { phases: PHASES, items: buildPlanningItems(m.knowledgeModel || {}, decisions) };
  return m;
}

function isMain() {
  return process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
}

if (isMain()) {
  const [, , cmd, file] = process.argv;
  try {
    if (cmd === 'normalize') {
      const model = JSON.parse(readFileSync(file, 'utf8'));
      const n = normalizeModel(model);
      const errors = validateModel(n);
      if (errors.length) { console.error('INVALID after normalize:\n' + errors.map(e => ' - ' + e).join('\n')); process.exit(1); }
      console.log(JSON.stringify(n, null, 2));
    } else {
      console.error('usage: planning-model.mjs normalize <model.json>');
      process.exit(2);
    }
  } catch (err) {
    console.error('ERROR: ' + err.message);
    process.exit(1);
  }
}
