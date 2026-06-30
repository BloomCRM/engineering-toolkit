import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { listSkills, formatSkills, shortDesc, parseFrontmatter } from '../skills/skills/scripts/list-skills.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const sample = join(here, 'fixtures', 'skills-sample');
const liveSkills = join(here, '..', 'skills');

test('parseFrontmatter: inline description', () => {
  assert.equal(parseFrontmatter('---\nname: a\ndescription: Hello there.\n---\nbody').description, 'Hello there.');
});

test('parseFrontmatter: tolerates CRLF with inline description on the last line', () => {
  const t = '---\r\nname: a\r\ndescription: Inline desc.\r\n---\r\nbody\r\n';
  assert.equal(parseFrontmatter(t).description, 'Inline desc.');
});

test('listSkills: parses inline and block-scalar descriptions, sorted by name', () => {
  const s = listSkills(sample);
  assert.deepEqual(s.map(x => x.name), ['alpha', 'beta']);
  assert.equal(s[0].description, 'Alpha does the first thing.');
  assert.match(s[1].description, /^Beta does the second thing/);
  assert.ok(!s[1].description.includes('Trigger on beta'), 'must stop at next key');
});

test('listSkills: reads real plugin skills (knowledge-store present with description)', () => {
  const ks = listSkills(liveSkills).find(x => x.name === 'knowledge-store');
  assert.ok(ks, 'knowledge-store present');
  assert.ok(ks.description.length > 0);
});

test('shortDesc: truncates long text with ellipsis under the cap', () => {
  const out = shortDesc('x'.repeat(200));
  assert.ok(out.endsWith('…'));
  assert.ok(out.length <= 100);
});

test('formatSkills: renders /eng:<name> — description', () => {
  assert.equal(formatSkills([{ name: 'foo', description: 'Does foo.' }]), '• /eng:foo — Does foo.');
});

test('formatSkills: empty list message', () => {
  assert.equal(formatSkills([]), 'No skills found.');
});
