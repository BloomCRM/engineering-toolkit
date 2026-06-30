import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import {
  initConfig, validateConfig, deriveStatus, readConfig, writeConfig, CONFIG_VERSION
} from '../skills/setup-toolkit/scripts/config.mjs';

test('initConfig(jira): incomplete and valid', () => {
  const c = initConfig('jira');
  assert.equal(c.provider, 'jira');
  assert.equal(c.providerStatus, 'incomplete');
  assert.deepEqual(validateConfig(c), []);
});

test('initConfig(linear): stub and valid', () => {
  const c = initConfig('linear');
  assert.equal(c.providerStatus, 'stub');
  assert.deepEqual(validateConfig(c), []);
});

test('deriveStatus: jira + mcp + project key => ready', () => {
  const c = initConfig('jira');
  c.mcp.available = true; c.project.key = 'BLOOM';
  assert.equal(deriveStatus(c), 'ready');
});

test('deriveStatus: jira without mcp => incomplete', () => {
  assert.equal(deriveStatus(initConfig('jira')), 'incomplete');
});

test('deriveStatus: non-sync-ready provider => stub', () => {
  assert.equal(deriveStatus(initConfig('azure-devops')), 'stub');
});

test('validateConfig: unknown provider is an error', () => {
  const c = initConfig('jira'); c.provider = 'trello';
  assert.ok(validateConfig(c).some(e => e.includes('invalid provider')));
});

test('validateConfig: invalid phaseField is an error', () => {
  const c = initConfig('jira'); c.mappings.phaseField = 'epicLink';
  assert.ok(validateConfig(c).some(e => e.includes('phaseField')));
});

test('validateConfig: non-jira with non-stub status is an error', () => {
  const c = initConfig('github-projects'); c.providerStatus = 'ready';
  assert.ok(validateConfig(c).some(e => e.includes('must be "stub"')));
});

test('validateConfig: ready status requires mcp.available and project.key', () => {
  const c = initConfig('jira'); c.providerStatus = 'ready';
  const errs = validateConfig(c);
  assert.ok(errs.some(e => e.includes('mcp.available')));
  assert.ok(errs.some(e => e.includes('project.key')));
});

test('writeConfig/readConfig round-trips and guards overwrite', () => {
  const dir = mkdtempSync(join(tmpdir(), 'eng-cfg-'));
  const path = join(dir, '.eng', 'config.json');
  try {
    writeConfig(path, initConfig('jira'));
    assert.ok(existsSync(path));
    assert.equal(readConfig(path).configVersion, CONFIG_VERSION);
    assert.throws(() => writeConfig(path, initConfig('jira'), { force: false }), /exists/);
    writeConfig(path, initConfig('jira'), { force: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
