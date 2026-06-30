import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyKnowledgeModel, mergeFindings, validateKnowledgeModel } from '../skills/analyze-project/scripts/knowledge-model.mjs';

const SECTIONS = ['domains', 'architecture', 'techDebt', 'infrastructure', 'security', 'risks'];

test('emptyKnowledgeModel: all six sections present and empty', () => {
  const km = emptyKnowledgeModel();
  for (const s of SECTIONS) assert.deepEqual(km[s], [], `${s} empty`);
});

test('mergeFindings: concatenates distinct entries across agents', () => {
  const a = { domains: [{ id: 'calendar', name: 'Calendar', dependsOn: [], sources: ['a.md'] }] };
  const b = { domains: [{ id: 'bookings', name: 'Bookings', dependsOn: [], sources: ['b.md'] }] };
  const km = mergeFindings([a, b]);
  assert.deepEqual(km.domains.map(d => d.id), ['bookings', 'calendar']); // sorted by id
});

test('mergeFindings: dedups by id and unions dependsOn + sources', () => {
  const a = { domains: [{ id: 'calendar', name: 'Calendar', dependsOn: ['bookings'], sources: ['a.md'] }] };
  const b = { domains: [{ id: 'calendar', name: 'Calendar', dependsOn: ['masters'], sources: ['b.md'] }] };
  const km = mergeFindings([a, b]);
  assert.equal(km.domains.length, 1);
  assert.deepEqual([...km.domains[0].dependsOn].sort(), ['bookings', 'masters']);
  assert.deepEqual([...km.domains[0].sources].sort(), ['a.md', 'b.md']);
});

test('mergeFindings: tolerates missing sections and nullish agents', () => {
  const km = mergeFindings([null, { risks: [{ id: 'r1', title: 'x', kind: 'unknown', sources: [] }] }, undefined]);
  assert.equal(km.risks.length, 1);
  assert.deepEqual(km.domains, []);
});

test('validateKnowledgeModel: clean model has no errors', () => {
  assert.deepEqual(validateKnowledgeModel(emptyKnowledgeModel()), []);
});

test('validateKnowledgeModel: domain without id is an error', () => {
  const km = emptyKnowledgeModel();
  km.domains.push({ name: 'X' });
  assert.ok(validateKnowledgeModel(km).some(e => e.includes('domain')));
});

test('validateKnowledgeModel: risk with invalid kind is an error', () => {
  const km = emptyKnowledgeModel();
  km.risks.push({ id: 'r', title: 't', kind: 'nonsense', sources: [] });
  assert.ok(validateKnowledgeModel(km).some(e => e.includes('kind')));
});
