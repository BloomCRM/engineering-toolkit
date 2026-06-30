// Zero-dependency tracker config for the eng toolkit (.eng/config.json).
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CONFIG_VERSION = '1.0';
export const PROVIDERS = ['jira', 'azure-devops', 'github-projects', 'linear'];
export const SYNC_READY = ['jira'];
export const PHASE_FIELDS = ['label', 'fixVersion'];
export const STATUSES = ['stub', 'incomplete', 'ready'];

export function configPath() {
  return process.env.ET_CONFIG_PATH || join(process.cwd(), '.eng', 'config.json');
}

export function deriveStatus(c) {
  if (!SYNC_READY.includes(c.provider)) return 'stub';
  if (c.mcp && c.mcp.available && c.project && c.project.key) return 'ready';
  return 'incomplete';
}

export function initConfig(provider) {
  const c = {
    configVersion: CONFIG_VERSION,
    provider,
    providerStatus: 'incomplete',
    mcp: { available: false, detectedTools: [], checkedAt: null },
    project: { key: null, issueTypes: [], statuses: [], components: [], fields: {} },
    mappings: { phaseField: 'label' }
  };
  c.providerStatus = deriveStatus(c);
  return c;
}

export function validateConfig(c) {
  const errors = [];
  if (!c || typeof c !== 'object') return ['config is not an object'];
  if (typeof c.configVersion !== 'string') errors.push('missing configVersion');
  if (!PROVIDERS.includes(c.provider)) errors.push(`invalid provider: ${c.provider}`);
  if (!c.mappings || !PHASE_FIELDS.includes(c.mappings.phaseField)) {
    errors.push('mappings.phaseField must be one of: ' + PHASE_FIELDS.join(', '));
  }
  if (!STATUSES.includes(c.providerStatus)) errors.push(`invalid providerStatus: ${c.providerStatus}`);
  if (!c.mcp || typeof c.mcp !== 'object' || !Array.isArray(c.mcp.detectedTools)) {
    errors.push('mcp.detectedTools must be an array');
  }
  if (!SYNC_READY.includes(c.provider) && c.providerStatus !== 'stub') {
    errors.push(`provider ${c.provider} is not sync-ready in this version; providerStatus must be "stub"`);
  }
  if (c.providerStatus === 'ready') {
    if (!c.mcp || !c.mcp.available) errors.push('providerStatus "ready" requires mcp.available = true');
    if (!c.project || !c.project.key) errors.push('providerStatus "ready" requires project.key');
  }
  return errors;
}

export function readConfig(path = configPath()) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function writeConfig(path = configPath(), config, { force = false } = {}) {
  if (existsSync(path) && !force) throw new Error(`config already exists at ${path} (use force to overwrite)`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(config, null, 2) + '\n', 'utf8');
  return path;
}

function isMain() {
  return process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
}

if (isMain()) {
  const [, , cmd, arg] = process.argv;
  const force = process.argv.includes('--force');
  const path = configPath();
  try {
    if (cmd === 'init') {
      if (!PROVIDERS.includes(arg)) {
        console.error('usage: config.mjs init <' + PROVIDERS.join('|') + '> [--force]');
        process.exit(2);
      }
      writeConfig(path, initConfig(arg), { force });
      console.log(`initialized ${arg} config at ${path}`);
    } else if (cmd === 'validate') {
      const errors = validateConfig(readConfig(path));
      if (errors.length) { console.error('INVALID:\n' + errors.map(e => ' - ' + e).join('\n')); process.exit(1); }
      console.log('VALID');
    } else if (cmd === 'show') {
      console.log(JSON.stringify(readConfig(path), null, 2));
    } else {
      console.error('usage: config.mjs <init <provider>|validate|show> [--force]');
      process.exit(2);
    }
  } catch (err) {
    console.error('ERROR: ' + err.message);
    process.exit(1);
  }
}
