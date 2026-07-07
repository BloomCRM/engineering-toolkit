// Zero-dependency planning-model + backlog normalization for project-model.json.
import { readFileSync, writeFileSync } from 'node:fs';
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

// --- Timeline (item F) ------------------------------------------------------
// Done work → REAL git dates (history, not fiction). The SKILL runs
// `git log --format=%cI -- <sources>`; this parses that output into a
// start/end range. Timezone-aware (compares by epoch, keeps the original ISO
// string). Empty/invalid → nulls.
export function parseGitDates(logOutput) {
  const lines = String(logOutput || '').split('\n').map(s => s.trim()).filter(Boolean);
  let start = null, end = null, startT = Infinity, endT = -Infinity;
  for (const line of lines) {
    const t = Date.parse(line);
    if (Number.isNaN(t)) continue;
    if (t < startT) { startT = t; start = line; }
    if (t > endT) { endT = t; end = line; }
  }
  return { start, end };
}

// Stamp real git dates onto the done-map epics. `datesById` maps a domain id to
// { start, end } (from `git log --format=%cI` over its sources, via parseGitDates).
// Deterministic and id-preserving — safe to run in refresh-model. Only touches
// `epic-done-<domainId>` epics; null dates and unknown epics are left alone.
export function applyDoneEpicDates(model, datesById) {
  const epics = model?.backlog?.epics || [];
  const map = datesById || {};
  for (const epic of epics) {
    if (typeof epic.id !== 'string' || !epic.id.startsWith('epic-done-')) continue;
    const d = map[epic.id.slice('epic-done-'.length)];
    if (!d) continue;
    if (d.start) epic.startDate = d.start;
    if (d.end) epic.dueDate = d.end;
  }
  return model;
}

// Future work → SEQUENCING ONLY (no fabricated calendar deadlines). Order
// not-done epics by phase, then by dependsOn (a dep emits before its dependent),
// and stamp a 1..n `sequence`. Deterministic Kahn's algorithm; deps outside the
// future set are ignored; a cycle still terminates (falls back to phase order).
export function sequenceFutureEpics(epics) {
  const future = (epics || []).filter(e => e && e.status !== 'done');
  const futureIds = new Set(future.map(e => e.id));
  const phaseIdx = (e) => { const i = PHASES.indexOf(e.phase); return i === -1 ? PHASES.length : i; };
  const inputIdx = new Map(future.map((e, i) => [e.id, i]));
  const pending = new Map(future.map(e => [e.id, new Set((e.dependsOn || []).filter(d => futureIds.has(d) && d !== e.id))]));
  const byPhaseThenInput = (a, b) => phaseIdx(a) - phaseIdx(b) || inputIdx.get(a.id) - inputIdx.get(b.id);
  const emitted = [], done = new Set();
  while (emitted.length < future.length) {
    const ready = future.filter(e => !done.has(e.id) && [...pending.get(e.id)].every(d => done.has(d)));
    const pool = ready.length ? ready : future.filter(e => !done.has(e.id)); // cycle → make progress
    const pick = pool.sort(byPhaseThenInput)[0];
    emitted.push(pick); done.add(pick.id);
  }
  return emitted.map((e, i) => ({ ...e, sequence: i + 1 }));
}

// --- Subtask granularity (item H) -------------------------------------------
// ~70% of the first BLM run were sub-tasks — likely over-decomposed. Count the
// hierarchy and flag over-decomposition so a reviewer can push back. Judgment
// aid, not a hard gate: a sub-task must be independently meaningful.
export function countBacklog(backlog) {
  let epics = 0, stories = 0, tasks = 0, subtasks = 0;
  for (const e of backlog?.epics || []) {
    epics++;
    for (const s of e.stories || []) {
      stories++;
      for (const t of s.tasks || []) { tasks++; subtasks += (t.subtasks || []).length; }
    }
  }
  return { epics, stories, tasks, subtasks, total: epics + stories + tasks + subtasks };
}

export function checkGranularity(backlog, opts = {}) {
  const { maxSubtaskShare = 0.6, maxSubtasksPerStory = 6 } = opts;
  const counts = countBacklog(backlog);
  const findings = [];
  const share = counts.total ? counts.subtasks / counts.total : 0;
  if (counts.total > 0 && share > maxSubtaskShare) {
    findings.push({ level: 'warn', code: 'high-subtask-share', share: Number(share.toFixed(2)),
      message: `Sub-tasks are ${Math.round(share * 100)}% of all issues (> ${Math.round(maxSubtaskShare * 100)}%) — likely over-decomposed. A sub-task must be independently meaningful and assignable.` });
  }
  const singletons = [];
  for (const e of backlog?.epics || []) for (const s of e.stories || []) for (const t of s.tasks || []) {
    if ((t.subtasks || []).length === 1) singletons.push(t.id);
  }
  if (singletons.length) {
    findings.push({ level: 'warn', code: 'singleton-subtask', tasks: singletons,
      message: `${singletons.length} task(s) have exactly one sub-task — the split adds nothing; fold the sub-task into the task.` });
  }
  const dense = [];
  for (const e of backlog?.epics || []) for (const s of e.stories || []) {
    const n = (s.tasks || []).reduce((a, t) => a + (t.subtasks || []).length, 0);
    if (n > maxSubtasksPerStory) dense.push({ story: s.id, subtasks: n });
  }
  if (dense.length) {
    findings.push({ level: 'warn', code: 'dense-story', stories: dense,
      message: `${dense.length} story(ies) exceed ${maxSubtasksPerStory} sub-tasks — consider consolidating.` });
  }
  return { counts, findings };
}

// --- Additive-draft (enabler for M and I) -----------------------------------
// A full `build` re-drafts every epic → regenerates ids → duplicates on re-sync.
// The additive path drafts ONLY new work and appends it, so existing
// agent-drafted issues (and their ids/trackerKeys) are never touched.

// Which of the given domain ids have NO epic yet (so they need drafting)?
// A domain is "covered" if an `epic-<id>`, an `epic-done-<id>`, or any epic with
// `domainRef === id` already exists. Returns the undrafted ones (deduped) with
// the epic id they should get.
export function planNewEpics(model, domainIds) {
  const epics = model?.backlog?.epics || [];
  const ids = new Set(epics.map(e => e && e.id).filter(Boolean));
  const refs = new Set(epics.map(e => e && e.domainRef).filter(Boolean));
  const covered = (d) => ids.has(`epic-${d}`) || ids.has(`epic-done-${d}`) || refs.has(d);
  const out = [], seen = new Set();
  for (const d of domainIds || []) {
    if (!d || seen.has(d) || covered(d)) continue;
    seen.add(d);
    out.push({ domainId: d, epicId: `epic-${d}` });
  }
  return out;
}

// Append freshly-drafted epics to the backlog, guarding against id collisions
// (a colliding id would clobber an existing issue — skip it instead). Stamps
// `domainRef` if the drafted epic carries one. Returns { model, appended, skipped }.
export function appendDraftedEpics(model, epics) {
  const m = model || {};
  m.backlog = m.backlog && Array.isArray(m.backlog.epics) ? m.backlog : { epics: [] };
  const existing = new Set(m.backlog.epics.map(e => e && e.id).filter(Boolean));
  const appended = [], skipped = [];
  for (const epic of epics || []) {
    if (!epic || typeof epic.id !== 'string' || !epic.id) { skipped.push(epic && epic.id); continue; }
    if (existing.has(epic.id)) { skipped.push(epic.id); continue; }
    existing.add(epic.id);
    m.backlog.epics.push({ type: 'feature', status: 'todo', stories: [], ...epic });
    appended.push(epic.id);
  }
  return { model: m, appended, skipped };
}

// Append freshly-drafted stories to an EXISTING epic (e.g. `epic-tech-debt` for
// security/ux findings), guarding story-id collisions. Unknown epic → all skipped.
export function appendStoriesToEpic(model, epicId, stories) {
  const epics = model?.backlog?.epics || [];
  const epic = epics.find(e => e && e.id === epicId);
  const appended = [], skipped = [];
  if (!epic) return { model, appended, skipped: (stories || []).map(s => s && s.id) };
  if (!Array.isArray(epic.stories)) epic.stories = [];
  const existing = new Set(epic.stories.map(s => s && s.id).filter(Boolean));
  for (const story of stories || []) {
    if (!story || typeof story.id !== 'string' || !story.id || existing.has(story.id)) { skipped.push(story && story.id); continue; }
    existing.add(story.id);
    epic.stories.push(story);
    appended.push(story.id);
  }
  return { model, appended, skipped };
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
  // Future work: deterministic sequence (phase + deps), no fabricated dates.
  const seqById = new Map(sequenceFutureEpics(m.backlog.epics).map(e => [e.id, e.sequence]));
  for (const epic of m.backlog.epics) {
    if (epic.status !== 'done' && seqById.has(epic.id)) epic.sequence = seqById.get(epic.id);
  }
  m.planningModel = { phases: PHASES, items: buildPlanningItems(m.knowledgeModel || {}, decisions) };
  return m;
}

// Would a deterministic refresh change anything? (new done/dedicated epics, or missing priority/status)
export function normalizeWouldChange(model) {
  const epics = (model && model.backlog && model.backlog.epics) || [];
  const n = normalizeModel(JSON.parse(JSON.stringify(model || {})));
  if (n.backlog.epics.length !== epics.length) return true;
  return epics.some(e => !e.priority || !e.status);
}

function isMain() {
  return process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
}

if (isMain()) {
  const [, , cmd, file] = process.argv;
  try {
    if (cmd === 'normalize') {
      const model = JSON.parse(readFileSync(file, 'utf8'));
      const before = (model.backlog && model.backlog.epics || []).length;
      const n = normalizeModel(model);
      const errors = validateModel(n);
      if (errors.length) { console.error('INVALID after normalize:\n' + errors.map(e => ' - ' + e).join('\n')); process.exit(1); }
      if (process.argv.includes('--write')) {
        writeFileSync(file, JSON.stringify(n, null, 2) + '\n', 'utf8');
        const done = n.backlog.epics.filter(e => e.status === 'done').length;
        console.log(`normalized ${file}: epics ${before} -> ${n.backlog.epics.length} (${done} Done, ids/trackerKeys preserved)`);
      } else {
        console.log(JSON.stringify(n, null, 2));
      }
    } else if (cmd === 'would-change') {
      const model = JSON.parse(readFileSync(file, 'utf8'));
      console.log(normalizeWouldChange(model) ? 'yes' : 'no');
    } else if (cmd === 'git-dates') {
      // git-dates <logfile> → { start, end } from `git log --format=%cI -- <sources>`.
      console.log(JSON.stringify(parseGitDates(readFileSync(file, 'utf8'))));
    } else if (cmd === 'apply-dates') {
      // apply-dates <model.json> <dates.json> → stamp done-epic start/due, write in place.
      // dates.json: { "<domainId>": { "start": "<iso>", "end": "<iso>" }, ... }
      const model = JSON.parse(readFileSync(file, 'utf8'));
      const dates = JSON.parse(readFileSync(process.argv[4], 'utf8'));
      const out = applyDoneEpicDates(model, dates);
      const errors = validateModel(out);
      if (errors.length) { console.error('INVALID after apply-dates:\n' + errors.map(e => ' - ' + e).join('\n')); process.exit(1); }
      writeFileSync(file, JSON.stringify(out, null, 2) + '\n', 'utf8');
      const n = (out.backlog?.epics || []).filter(e => e.startDate || e.dueDate).length;
      console.log(`applied git dates to ${n} done epic(s) in ${file}`);
    } else if (cmd === 'granularity') {
      // granularity <model.json> → counts + over-decomposition warnings.
      const model = JSON.parse(readFileSync(file, 'utf8'));
      console.log(JSON.stringify(checkGranularity(model.backlog || model), null, 2));
    } else if (cmd === 'plan-new') {
      // plan-new <model.json> <domainId,domainId,...> → domains needing a new epic.
      const model = JSON.parse(readFileSync(file, 'utf8'));
      const domainIds = (process.argv[4] || '').split(',').map(s => s.trim()).filter(Boolean);
      console.log(JSON.stringify(planNewEpics(model, domainIds), null, 2));
    } else if (cmd === 'append-epics') {
      // append-epics <model.json> <epics.json> → append drafted epics in place (collision-guarded).
      const model = JSON.parse(readFileSync(file, 'utf8'));
      const epics = JSON.parse(readFileSync(process.argv[4], 'utf8'));
      const { model: out, appended, skipped } = appendDraftedEpics(model, epics);
      // Intermediate step — drafted content is pre-normalize (no DoD yet); the
      // gate is the SKILL's later `normalize` + `store validate`, not here.
      writeFileSync(file, JSON.stringify(out, null, 2) + '\n', 'utf8');
      console.log(`appended ${appended.length} epic(s)${skipped.length ? `, skipped ${skipped.length} (id collision): ${skipped.join(', ')}` : ''} — run normalize next`);
    } else if (cmd === 'append-stories') {
      // append-stories <model.json> <epicId> <stories.json> → append stories to an existing epic.
      const model = JSON.parse(readFileSync(file, 'utf8'));
      const epicId = process.argv[4];
      const stories = JSON.parse(readFileSync(process.argv[5], 'utf8'));
      const { model: out, appended, skipped } = appendStoriesToEpic(model, epicId, stories);
      // Intermediate step — normalize + store validate is the gate (see SKILL).
      writeFileSync(file, JSON.stringify(out, null, 2) + '\n', 'utf8');
      console.log(`appended ${appended.length} story(ies) to ${epicId}${skipped.length ? `, skipped ${skipped.filter(Boolean).length}` : ''} — run normalize next`);
    } else {
      console.error('usage: planning-model.mjs <normalize [--write] | would-change | git-dates | apply-dates <model> <dates> | granularity | plan-new <model> <ids> | append-epics <model> <epics>> <file>');
      process.exit(2);
    }
  } catch (err) {
    console.error('ERROR: ' + err.message);
    process.exit(1);
  }
}
