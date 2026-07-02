import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyKnowledgeModel, mergeFindings, validateKnowledgeModel, findCoverageGaps, gapsToRisks } from '../skills/analyze-project/scripts/knowledge-model.mjs';

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

// --- completeness-critic (item M) ---
function kmWithDomains(...ids) {
  const km = emptyKnowledgeModel();
  for (const id of ids) km.domains.push({ id, name: id, status: 'implemented', dependsOn: [], sources: [] });
  return km;
}

test('findCoverageGaps: a plan mapped to an existing domain is covered', () => {
  const km = kmWithDomains('bookings');
  const gaps = findCoverageGaps(km, [{ name: 'Day view', coveredBy: 'bookings', sources: ['docs/x.md'] }]);
  assert.deepEqual(gaps, []);
});

test('findCoverageGaps: a plan with no coverage is a gap (no-domain)', () => {
  const km = kmWithDomains('bookings');
  const gaps = findCoverageGaps(km, [{ name: 'Multi-service booking', coveredBy: null, sources: ['docs/next-session.md'] }]);
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].name, 'Multi-service booking');
  assert.equal(gaps[0].reason, 'no-domain');
  assert.deepEqual(gaps[0].sources, ['docs/next-session.md']);
});

test('findCoverageGaps: coverage pointing at a non-existent domain is a gap (broken-coverage)', () => {
  const km = kmWithDomains('bookings');
  const gaps = findCoverageGaps(km, [{ name: 'Loyalty', coveredBy: 'loyalty-program', sources: [] }]);
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].reason, 'broken-coverage');
  assert.equal(gaps[0].coveredBy, 'loyalty-program');
});

test('findCoverageGaps: the real Bloom miss — multi-service not covered by Bookings', () => {
  const km = kmWithDomains('bookings', 'calendar', 'masters');
  const plans = [
    { name: 'Multi-service booking', coveredBy: null, sources: ['docs/architecture/x.md'] },
    { name: 'Online booking', coveredBy: 'bookings', sources: ['docs/next-session.md'] },
  ];
  const gaps = findCoverageGaps(km, plans);
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].name, 'Multi-service booking');
});

test('findCoverageGaps: empty/nullish input yields no gaps', () => {
  assert.deepEqual(findCoverageGaps(kmWithDomains('x'), []), []);
  assert.deepEqual(findCoverageGaps(kmWithDomains('x'), null), []);
  assert.deepEqual(findCoverageGaps(null, [{ name: 'X', coveredBy: null }]), [{ name: 'X', reason: 'no-domain', sources: [] }]);
});

test('gapsToRisks: gaps become unknown-kind risks with stable ids and preserved sources', () => {
  const risks = gapsToRisks([{ name: 'Multi-service booking', reason: 'no-domain', sources: ['docs/a.md'] }]);
  assert.equal(risks.length, 1);
  assert.equal(risks[0].kind, 'unknown');
  assert.equal(risks[0].id, 'gap-multi-service-booking');
  assert.deepEqual(risks[0].sources, ['docs/a.md']);
  assert.match(risks[0].title, /Multi-service booking/);
});

test('gapsToRisks: broken-coverage risk names the missing domain', () => {
  const risks = gapsToRisks([{ name: 'Loyalty', reason: 'broken-coverage', coveredBy: 'loyalty-program', sources: [] }]);
  assert.match(risks[0].title, /loyalty-program/);
});

test('gapsToRisks output merges cleanly and passes validation', () => {
  const risks = gapsToRisks(findCoverageGaps(kmWithDomains('bookings'), [{ name: 'Multi-service booking', coveredBy: null, sources: ['d.md'] }]));
  const km = mergeFindings([kmWithDomains('bookings'), { risks }]);
  assert.deepEqual(validateKnowledgeModel(km), []);
  assert.ok(km.risks.some(r => r.id === 'gap-multi-service-booking'));
});
