// Zero-dependency knowledge-store operations over project-model.json.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SCHEMA_VERSION = '1.0';
export const TASK_CATEGORIES = ['backend', 'frontend', 'database', 'validation', 'tests', 'documentation', 'logging', 'monitoring', 'migration'];
export const DEFAULT_DOD = ['code', 'unit', 'integration', 'docs', 'review', 'ci'];

export function storePath() {
  return process.env.ET_STORE_PATH || join(process.cwd(), '.eng', 'project-model.json');
}

// Returns an array of human-readable error strings. Empty array = valid.
export function validateModel(m) {
  const errors = [];
  if (!m || typeof m !== 'object') return ['model is not an object'];
  if (typeof m.schemaVersion !== 'string') errors.push('missing or non-string schemaVersion');
  if (!m.knowledgeModel || !Array.isArray(m.knowledgeModel.domains)) errors.push('knowledgeModel.domains must be an array');
  if (!m.backlog || !Array.isArray(m.backlog.epics)) {
    errors.push('backlog.epics must be an array');
    return errors;
  }

  const ids = new Set();
  const seeId = (id, where) => {
    if (typeof id !== 'string' || !id) { errors.push(`${where}: missing id`); return; }
    if (ids.has(id)) errors.push(`duplicate id: ${id}`);
    ids.add(id);
  };

  for (const epic of m.backlog.epics) {
    seeId(epic.id, 'epic');
    if (!epic.phase) errors.push(`epic ${epic.id}: missing phase`);
    if (!['feature', 'bug', 'techdebt'].includes(epic.type)) errors.push(`epic ${epic.id}: invalid type`);
    if (!epic.title) errors.push(`epic ${epic.id}: missing title`);
    if (!Array.isArray(epic.stories)) { errors.push(`epic ${epic.id}: stories must be an array`); continue; }

    for (const story of epic.stories) {
      seeId(story.id, 'story');
      if (!story.title) errors.push(`story ${story.id}: missing title`);
      if (!Array.isArray(story.acceptanceCriteria) || story.acceptanceCriteria.length === 0) {
        errors.push(`story ${story.id}: acceptanceCriteria must be a non-empty array`);
      } else {
        for (const ac of story.acceptanceCriteria) {
          if (!ac || !ac.given || !ac.when || !ac.then) errors.push(`story ${story.id}: acceptanceCriteria entry needs given/when/then`);
        }
      }
      if (!Array.isArray(story.definitionOfDone) || story.definitionOfDone.length === 0) {
        errors.push(`story ${story.id}: definitionOfDone must be a non-empty array`);
      }
      if (!Array.isArray(story.tasks)) { errors.push(`story ${story.id}: tasks must be an array`); continue; }

      for (const task of story.tasks) {
        seeId(task.id, 'task');
        if (!TASK_CATEGORIES.includes(task.category)) errors.push(`task ${task.id}: invalid category "${task.category}"`);
        if (task.subtasks && !Array.isArray(task.subtasks)) errors.push(`task ${task.id}: subtasks must be an array`);
        for (const sub of task.subtasks || []) seeId(sub.id, 'subtask');
      }
    }
  }
  return errors;
}

export function initModel() {
  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: null,
    source: { repo: null, commit: null, branch: null },
    knowledgeModel: { domains: [], architecture: [], techDebt: [], infrastructure: [], security: [], risks: [] },
    planningModel: { phases: ['MVP', 'Production Ready', 'Public Release', 'Scaling', 'Enterprise', 'AI'], items: [] },
    backlog: { epics: [] }
  };
}

export function readStore(path = storePath()) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function writeStore(path = storePath(), model = initModel(), { force = false } = {}) {
  if (existsSync(path) && !force) throw new Error(`store already exists at ${path} (use force to overwrite)`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(model, null, 2) + '\n', 'utf8');
  return path;
}

export function inspectModel(m) {
  const stats = { epics: 0, stories: 0, tasks: 0, subtasks: 0, unsynced: 0, byPhase: {}, byType: {} };
  for (const epic of m.backlog?.epics || []) {
    stats.epics++;
    stats.byPhase[epic.phase] = (stats.byPhase[epic.phase] || 0) + 1;
    stats.byType[epic.type] = (stats.byType[epic.type] || 0) + 1;
    if (!epic.trackerKey) stats.unsynced++;
    for (const story of epic.stories || []) {
      stats.stories++;
      if (!story.trackerKey) stats.unsynced++;
      for (const task of story.tasks || []) {
        stats.tasks++;
        if (!task.trackerKey) stats.unsynced++;
        stats.subtasks += (task.subtasks || []).length;
      }
    }
  }
  return stats;
}

export function migrateModel(m) {
  const changed = m.schemaVersion !== SCHEMA_VERSION;
  return { model: { ...m, schemaVersion: SCHEMA_VERSION }, changed };
}

function isMain() {
  return process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
}

if (isMain()) {
  const [, , cmd] = process.argv;
  const force = process.argv.includes('--force');
  const path = storePath();
  try {
    if (cmd === 'init') {
      writeStore(path, initModel(), { force });
      console.log(`initialized store at ${path}`);
    } else if (cmd === 'validate') {
      const errors = validateModel(readStore(path));
      if (errors.length) { console.error('INVALID:\n' + errors.map(e => ' - ' + e).join('\n')); process.exit(1); }
      console.log('VALID');
    } else if (cmd === 'inspect') {
      console.log(JSON.stringify(inspectModel(readStore(path)), null, 2));
    } else if (cmd === 'migrate') {
      const { model, changed } = migrateModel(readStore(path));
      if (changed) { writeStore(path, model, { force: true }); console.log(`migrated to ${SCHEMA_VERSION}`); }
      else console.log(`already at ${SCHEMA_VERSION}`);
    } else {
      console.error('usage: store.mjs <init|validate|inspect|migrate> [--force]');
      process.exit(2);
    }
  } catch (err) {
    console.error('ERROR: ' + err.message);
    process.exit(1);
  }
}
