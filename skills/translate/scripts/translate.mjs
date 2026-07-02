// Zero-dependency: find/apply English translations in the model, preserving ids & structure.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function hasCyrillic(text) {
  return /[Ѐ-ӿ]/.test(String(text || ''));
}

// Worklist: nodes whose title/description/AC still contain Cyrillic (i.e. not yet English).
export function collectTranslatable(model) {
  const out = [];
  for (const epic of model?.backlog?.epics || []) {
    if (hasCyrillic(epic.title) || hasCyrillic(epic.description)) out.push({ id: epic.id, kind: 'epic' });
    for (const story of epic.stories || []) {
      const acCyr = (story.acceptanceCriteria || []).some(ac => hasCyrillic(ac.given) || hasCyrillic(ac.when) || hasCyrillic(ac.then));
      if (hasCyrillic(story.title) || hasCyrillic(story.description) || acCyr) out.push({ id: story.id, kind: 'story' });
      for (const task of story.tasks || []) {
        if (hasCyrillic(task.title) || hasCyrillic(task.description)) out.push({ id: task.id, kind: 'task' });
        for (const sub of task.subtasks || []) {
          if (hasCyrillic(sub.title)) out.push({ id: sub.id, kind: 'subtask' });
        }
      }
    }
  }
  return out;
}

// translations: { id: { title?, description?, acceptanceCriteria? } }. Writes by id; preserves everything else.
export function applyTranslations(model, translations) {
  const t = translations || {};
  const apply = (node) => {
    const tr = t[node.id];
    if (!tr) return;
    if (tr.title != null) node.title = tr.title;
    if (tr.description != null) node.description = tr.description;
    if (Array.isArray(tr.acceptanceCriteria)) node.acceptanceCriteria = tr.acceptanceCriteria;
  };
  for (const epic of model?.backlog?.epics || []) {
    apply(epic);
    for (const story of epic.stories || []) {
      apply(story);
      for (const task of story.tasks || []) {
        apply(task);
        for (const sub of task.subtasks || []) apply(sub);
      }
    }
  }
  return model;
}

function isMain() {
  return process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
}

if (isMain()) {
  const [, , cmd, modelFile, mapFile] = process.argv;
  try {
    if (cmd === 'collect') {
      const model = JSON.parse(readFileSync(modelFile, 'utf8'));
      console.log(JSON.stringify(collectTranslatable(model), null, 2));
    } else if (cmd === 'apply') {
      const model = JSON.parse(readFileSync(modelFile, 'utf8'));
      const map = JSON.parse(readFileSync(mapFile, 'utf8'));
      const out = applyTranslations(model, map);
      if (process.argv.includes('--write')) {
        writeFileSync(modelFile, JSON.stringify(out, null, 2) + '\n', 'utf8');
        console.log(`applied ${Object.keys(map).length} translations to ${modelFile}`);
      } else {
        console.log(JSON.stringify(out, null, 2));
      }
    } else {
      console.error('usage: translate.mjs <collect <model.json> | apply <model.json> <map.json> [--write]>');
      process.exit(2);
    }
  } catch (err) {
    console.error('ERROR: ' + err.message);
    process.exit(1);
  }
}
