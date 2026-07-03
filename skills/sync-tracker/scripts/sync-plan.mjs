// Zero-dependency reconciliation planner for pushing the backlog to a tracker.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function engLabel(engId) {
  return `eng-id:${engId}`;
}

// Map an epic-status intent to Jira's universal status-category key. Status
// NAMES localize/rename per template (we hit this with issue-type names), but
// the three categories are constant across every Jira project.
export const STATUS_CATEGORY_BY_INTENT = {
  done: 'done',
  'in-progress': 'indeterminate',
  todo: 'new',
};

// Read a transition's TARGET status-category key, tolerating both the nested
// Atlassian-official shape (t.to.statusCategory.key) and a flattened one.
function transitionTargetCategory(t) {
  return t?.to?.statusCategory?.key || t?.statusCategory?.key || null;
}

// Given the getTransitions list and a desired status-category key
// (new | indeterminate | done), return the id of the first transition whose
// target status falls in that category, or null. Category-based so it survives
// renamed/localized statuses — the whole point of item P.
export function resolveTransitionByCategory(transitions, categoryKey) {
  if (!Array.isArray(transitions) || !categoryKey) return null;
  const match = transitions.find(t => transitionTargetCategory(t) === categoryKey);
  return match ? match.id : null;
}

// Convenience: resolve the transition id straight from an epic-status intent
// (done | in-progress | todo). Returns null for an unknown status.
export function resolveTransitionForStatus(transitions, status) {
  const categoryKey = STATUS_CATEGORY_BY_INTENT[status];
  if (!categoryKey) return null;
  return resolveTransitionByCategory(transitions, categoryKey);
}

// --- Conservative-update marker (item G) -----------------------------------
// Re-sync must UPDATE toolkit-owned fields without clobbering human edits. We
// stamp each issue with a hash of the description eng last wrote (a label). On
// re-sync, if the issue's current description still hashes to that marker, eng
// owns it and may overwrite; if it differs, a human edited it → skip (warn).
export const ENG_HASH_PREFIX = 'eng-hash:';

// FNV-1a 32-bit → base36. Zero-dep, deterministic, short enough for a label.
export function engHash(text) {
  let h = 0x811c9dc5;
  const s = String(text ?? '');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

export function engHashLabel(text) {
  return `${ENG_HASH_PREFIX}${engHash(text)}`;
}

// Pull the stored eng-hash out of an issue's label list (or null).
export function readEngHash(labels) {
  for (const l of labels || []) {
    if (typeof l === 'string' && l.startsWith(ENG_HASH_PREFIX)) return l.slice(ENG_HASH_PREFIX.length);
  }
  return null;
}

// Decide whether an update may overwrite the Jira description.
// - force → always overwrite (the `--force-descriptions` escape hatch).
// - empty current → overwrite (nothing to protect).
// - no marker on non-empty text → skip (can't prove eng owns it; protect it).
// - marker matches current → eng owns it, overwrite.
// - marker differs → a human edited since last sync, skip.
export function decideDescriptionUpdate({ current, lastHash, force = false } = {}) {
  if (force) return { action: 'overwrite', reason: 'forced' };
  const cur = String(current ?? '').trim();
  if (cur === '') return { action: 'overwrite', reason: 'empty' };
  if (!lastHash) return { action: 'skip', reason: 'no-marker' };
  if (engHash(cur) === lastHash) return { action: 'overwrite', reason: 'unchanged-since-sync' };
  return { action: 'skip', reason: 'human-edited' };
}

// Flatten backlog into a parent-first list of nodes.
export function flattenBacklog(backlog) {
  const nodes = [];
  for (const epic of backlog?.epics || []) {
    nodes.push({ kind: 'epic', engId: epic.id, parentEngId: null, trackerKey: epic.trackerKey || null, title: epic.title, type: epic.type, phase: epic.phase });
    for (const story of epic.stories || []) {
      nodes.push({ kind: 'story', engId: story.id, parentEngId: epic.id, trackerKey: story.trackerKey || null, title: story.title });
      for (const task of story.tasks || []) {
        nodes.push({ kind: 'task', engId: task.id, parentEngId: story.id, trackerKey: task.trackerKey || null, title: task.title || task.category, category: task.category });
        for (const sub of task.subtasks || []) {
          nodes.push({ kind: 'subtask', engId: sub.id, parentEngId: task.id, trackerKey: sub.trackerKey || null, title: sub.title });
        }
      }
    }
  }
  return nodes;
}

// existingIndex: { engId: trackerKey } discovered via searchByExternalRef.
export function buildSyncPlan(backlog, existingIndex = {}) {
  const operations = [];
  const summary = { creates: 0, updates: 0, byKind: {} };
  for (const node of flattenBacklog(backlog)) {
    const trackerKey = node.trackerKey || existingIndex[node.engId] || null;
    const op = trackerKey ? 'update' : 'create';
    operations.push({ op, kind: node.kind, engId: node.engId, parentEngId: node.parentEngId, trackerKey, title: node.title });
    summary[op === 'create' ? 'creates' : 'updates']++;
    summary.byKind[node.kind] = (summary.byKind[node.kind] || 0) + 1;
  }
  return { operations, summary };
}

// resultMap: { engId: trackerKey } from create/update calls. Mutates + returns the backlog.
export function applyResults(backlog, resultMap) {
  for (const epic of backlog?.epics || []) {
    if (resultMap[epic.id]) epic.trackerKey = resultMap[epic.id];
    for (const story of epic.stories || []) {
      if (resultMap[story.id]) story.trackerKey = resultMap[story.id];
      for (const task of story.tasks || []) {
        if (resultMap[task.id]) task.trackerKey = resultMap[task.id];
        for (const sub of task.subtasks || []) {
          if (resultMap[sub.id]) sub.trackerKey = resultMap[sub.id];
        }
      }
    }
  }
  return backlog;
}

export function validateReadyForSync(config) {
  const errors = [];
  if (!config || config.provider !== 'jira') {
    errors.push('sync-tracker is Jira-only in this version (config.provider must be "jira"; other providers are not sync-ready)');
    return errors;
  }
  if (config.providerStatus !== 'ready') errors.push(`config.providerStatus must be "ready" (currently "${config.providerStatus}") — run /eng:setup-toolkit`);
  if (!config.mcp || !config.mcp.available) errors.push('Jira mcp.available must be true — connect the MCP and restart, then re-run setup');
  if (!config.project || !config.project.key) errors.push('config.project.key must be set — verify the project in setup');
  return errors;
}

function isMain() {
  return process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
}

if (isMain()) {
  const [, , cmd, file] = process.argv;
  try {
    if (cmd === 'plan') {
      const model = JSON.parse(readFileSync(file, 'utf8'));
      console.log(JSON.stringify(buildSyncPlan(model.backlog || { epics: [] }), null, 2));
    } else {
      console.error('usage: sync-plan.mjs plan <model.json>');
      process.exit(2);
    }
  } catch (err) {
    console.error('ERROR: ' + err.message);
    process.exit(1);
  }
}
