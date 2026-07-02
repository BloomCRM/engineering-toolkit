import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { validateModel } from '../skills/knowledge-store/scripts/store.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const valid = () => JSON.parse(readFileSync(join(here, 'fixtures/valid-model.json'), 'utf8'));

test('validateModel: valid model has no errors', () => {
  const errors = validateModel(valid());
  assert.deepEqual(errors, []);
});

test('validateModel: missing schemaVersion is an error', () => {
  const m = valid(); delete m.schemaVersion;
  assert.ok(validateModel(m).some(e => e.includes('schemaVersion')));
});

test('validateModel: story without acceptance criteria is an error', () => {
  const m = valid(); m.backlog.epics[0].stories[0].acceptanceCriteria = [];
  assert.ok(validateModel(m).some(e => e.includes('acceptanceCriteria')));
});

test('validateModel: task without definitionOfDone on its story is an error', () => {
  const m = valid(); m.backlog.epics[0].stories[0].definitionOfDone = [];
  assert.ok(validateModel(m).some(e => e.includes('definitionOfDone')));
});

test('validateModel: invalid task category is an error', () => {
  const m = valid(); m.backlog.epics[0].stories[0].tasks[0].category = 'nonsense';
  assert.ok(validateModel(m).some(e => e.includes('category')));
});

test('validateModel: duplicate ids are an error', () => {
  const m = valid();
  const s = m.backlog.epics[0].stories[0];
  s.tasks.push({ id: s.tasks[0].id, category: 'frontend', subtasks: [] });
  assert.ok(validateModel(m).some(e => e.toLowerCase().includes('duplicate')));
});

// --- 5b: init / read / write ---
import { tmpdir } from 'node:os';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { initModel, writeStore, readStore } from '../skills/knowledge-store/scripts/store.mjs';

test('initModel: produces a model that validates', () => {
  assert.deepEqual(validateModel(initModel()), []);
});

test('writeStore/readStore round-trips and refuses overwrite without force', () => {
  const dir = mkdtempSync(join(tmpdir(), 'eng-'));
  const path = join(dir, '.eng', 'project-model.json');
  try {
    writeStore(path, initModel());
    assert.ok(existsSync(path));
    const back = readStore(path);
    assert.equal(back.schemaVersion, '1.0');
    assert.throws(() => writeStore(path, initModel(), { force: false }), /exists/);
    writeStore(path, initModel(), { force: true }); // force overwrites, no throw
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- 5c: inspect / migrate ---
import { inspectModel, migrateModel, SCHEMA_VERSION } from '../skills/knowledge-store/scripts/store.mjs';

test('inspectModel: counts epics/stories/tasks and unsynced', () => {
  const s = inspectModel(valid());
  assert.equal(s.epics, 1);
  assert.equal(s.stories, 1);
  assert.equal(s.tasks, 1);
  assert.equal(s.unsynced, 3); // epic + story + task all have trackerKey null
  assert.equal(s.byPhase.MVP, 1);
});

test('migrateModel: stamps current schema version and reports changed=false when current', () => {
  const m = valid();
  const r = migrateModel(m);
  assert.equal(r.model.schemaVersion, SCHEMA_VERSION);
  assert.equal(r.changed, false);
});

test('migrateModel: upgrades an older version and reports changed=true', () => {
  const m = valid(); m.schemaVersion = '0.9';
  const r = migrateModel(m);
  assert.equal(r.model.schemaVersion, SCHEMA_VERSION);
  assert.equal(r.changed, true);
});

// --- v2.1 D: taxonomy + needs-decision ---
import { TASK_CATEGORIES } from '../skills/knowledge-store/scripts/store.mjs';

test('TASK_CATEGORIES includes admin and design', () => {
  assert.ok(TASK_CATEGORIES.includes('admin'));
  assert.ok(TASK_CATEGORIES.includes('design'));
});

test('validateModel: needsDecision must be boolean when present', () => {
  const m = valid();
  m.backlog.epics[0].stories[0].needsDecision = 'yes';
  assert.ok(validateModel(m).some(e => e.includes('needsDecision')));
});
