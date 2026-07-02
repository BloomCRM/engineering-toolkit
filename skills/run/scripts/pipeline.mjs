// Zero-dependency pipeline state machine for the /eng:run orchestrator.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function configReady(config) {
  return !!config && config.provider === 'jira' && config.providerStatus === 'ready'
    && !!(config.mcp && config.mcp.available) && !!(config.project && config.project.key);
}

export function hasKnowledgeModel(model) {
  return Array.isArray(model?.knowledgeModel?.domains) && model.knowledgeModel.domains.length > 0;
}

export function hasBacklog(model) {
  return Array.isArray(model?.backlog?.epics) && model.backlog.epics.length > 0;
}

export function hasSyncedAny(model) {
  for (const epic of model?.backlog?.epics || []) {
    if (epic.trackerKey) return true;
    for (const story of epic.stories || []) {
      if (story.trackerKey) return true;
      for (const task of story.tasks || []) {
        if (task.trackerKey) return true;
        for (const sub of task.subtasks || []) if (sub.trackerKey) return true;
      }
    }
  }
  return false;
}

export function pipelineState(config, model) {
  const state = {
    hasConfig: !!config,
    configReady: configReady(config),
    hasKnowledgeModel: hasKnowledgeModel(model),
    hasBacklog: hasBacklog(model),
    hasSyncedAny: hasSyncedAny(model),
    nextStep: null,
    reason: ''
  };
  if (!state.hasConfig) {
    state.nextStep = 'setup';
    state.reason = 'No .eng/config.json — run setup-toolkit first.';
  } else if (!state.hasKnowledgeModel) {
    state.nextStep = 'analyze';
    state.reason = 'No Knowledge Model yet — analyze the project.';
  } else if (!state.hasBacklog) {
    state.nextStep = 'build';
    state.reason = 'Knowledge Model exists but no backlog — build it.';
  } else if (!state.hasSyncedAny) {
    state.nextStep = 'sync';
    state.reason = 'Backlog exists but nothing is synced — dry-run then sync (with approval).';
  } else {
    state.nextStep = 'review-drift';
    state.reason = 'Everything is synced — run detect-changes to see if anything is stale.';
  }
  return state;
}

// In the review-drift state, decide what a re-run should do based on freshness.
// hasRepoDiff: git diff since source.commit found changes. refreshWouldChange:
// the deterministic normalize would add/stamp something (e.g. a new done-map).
export function recommendRerunMode({ hasRepoDiff, refreshWouldChange } = {}) {
  if (hasRepoDiff) return 'reanalyze';       // repo moved → re-analyze the delta (agents)
  if (refreshWouldChange) return 'refresh';  // repo same, deterministic layer stale → refresh only
  return 'in-sync';                          // nothing to do
}

function isMain() {
  return process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
}

if (isMain()) {
  const [, , cmd, configFile, modelFile] = process.argv;
  try {
    if (cmd === 'state') {
      const config = configFile && existsSync(configFile) ? JSON.parse(readFileSync(configFile, 'utf8')) : null;
      const model = modelFile && existsSync(modelFile) ? JSON.parse(readFileSync(modelFile, 'utf8')) : null;
      console.log(JSON.stringify(pipelineState(config, model), null, 2));
    } else {
      console.error('usage: pipeline.mjs state <config.json> <model.json>');
      process.exit(2);
    }
  } catch (err) {
    console.error('ERROR: ' + err.message);
    process.exit(1);
  }
}
