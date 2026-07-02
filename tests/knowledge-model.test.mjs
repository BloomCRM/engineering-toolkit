import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyKnowledgeModel, mergeFindings, validateKnowledgeModel, findCoverageGaps, gapsToRisks, suggestDomainMerges, applyDomainMerges } from '../skills/analyze-project/scripts/knowledge-model.mjs';

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

// --- semantic domain dedup (item L) ---
const domainsFrom = (...ids) => ids.map(id => ({ id, name: id, status: 'implemented', dependsOn: [], sources: [`${id}.md`] }));

test('suggestDomainMerges: separator variance (cash-desk / cashdesk) is one group', () => {
  const s = suggestDomainMerges(domainsFrom('cash-desk', 'cashdesk'));
  assert.equal(s.length, 1);
  assert.equal(s[0].canonical, 'cashdesk'); // shortest id
  assert.deepEqual(s[0].duplicates, ['cash-desk']);
});

test('suggestDomainMerges: compound token-subset (cashdesk / finance-cashdesk)', () => {
  const s = suggestDomainMerges(domainsFrom('cashdesk', 'finance-cashdesk'));
  assert.equal(s.length, 1);
  assert.equal(s[0].canonical, 'cashdesk');
  assert.deepEqual(s[0].duplicates, ['finance-cashdesk']);
});

test('suggestDomainMerges: transitive cluster of three string-similar ids', () => {
  const s = suggestDomainMerges(domainsFrom('cash-desk', 'cashdesk', 'finance-cashdesk'));
  assert.equal(s.length, 1);
  const all = [s[0].canonical, ...s[0].duplicates].sort();
  assert.deepEqual(all, ['cash-desk', 'cashdesk', 'finance-cashdesk']);
});

test('suggestDomainMerges: fiscalization / cash-desk-fiscalization merge', () => {
  const s = suggestDomainMerges(domainsFrom('fiscalization', 'cash-desk-fiscalization'));
  assert.equal(s.length, 1);
  assert.equal(s[0].canonical, 'fiscalization');
});

test('suggestDomainMerges: camelCase normalizes to the separator form', () => {
  const s = suggestDomainMerges(domainsFrom('cashDesk', 'cash-desk'));
  assert.equal(s.length, 1);
});

test('suggestDomainMerges: meaning-similar (not string-similar) is NOT merged — LLM job', () => {
  assert.deepEqual(suggestDomainMerges(domainsFrom('bookings', 'calendar-ui')), []);
  assert.deepEqual(suggestDomainMerges(domainsFrom('roles-permissions', 'capability-based-authz')), []);
});

test('suggestDomainMerges: guards against the masters / master-schedule false positive', () => {
  assert.deepEqual(suggestDomainMerges(domainsFrom('masters', 'master-schedule')), []);
});

test('suggestDomainMerges: short shared token alone (api / api-gateway) does not merge', () => {
  assert.deepEqual(suggestDomainMerges(domainsFrom('api', 'api-gateway')), []);
});

test('suggestDomainMerges: no duplicates / empty input => []', () => {
  assert.deepEqual(suggestDomainMerges(domainsFrom('bookings', 'masters', 'calendar')), []);
  assert.deepEqual(suggestDomainMerges([]), []);
  assert.deepEqual(suggestDomainMerges(null), []);
});

test('applyDomainMerges: folds duplicate into canonical, unions sources', () => {
  const km = emptyKnowledgeModel();
  km.domains = domainsFrom('cashdesk', 'cash-desk');
  const out = applyDomainMerges(km, [{ canonical: 'cashdesk', duplicates: ['cash-desk'] }]);
  assert.equal(out.domains.length, 1);
  assert.equal(out.domains[0].id, 'cashdesk');
  assert.deepEqual([...out.domains[0].sources].sort(), ['cash-desk.md', 'cashdesk.md']);
});

test('applyDomainMerges: remaps dependsOn references from duplicate to canonical', () => {
  const km = emptyKnowledgeModel();
  km.domains = [
    { id: 'cashdesk', name: 'Cash desk', status: 'implemented', dependsOn: [], sources: [] },
    { id: 'finance-cashdesk', name: 'dup', status: 'partial', dependsOn: [], sources: [] },
    { id: 'reports', name: 'Reports', status: 'planned', dependsOn: ['finance-cashdesk'], sources: [] },
  ];
  const out = applyDomainMerges(km, [{ canonical: 'cashdesk', duplicates: ['finance-cashdesk'] }]);
  assert.equal(out.domains.length, 2);
  const reports = out.domains.find(d => d.id === 'reports');
  assert.deepEqual(reports.dependsOn, ['cashdesk']);
});

test('applyDomainMerges: drops a self-dependency created by the remap', () => {
  const km = emptyKnowledgeModel();
  km.domains = [
    { id: 'cashdesk', name: 'Cash desk', status: 'implemented', dependsOn: ['finance-cashdesk'], sources: [] },
    { id: 'finance-cashdesk', name: 'dup', status: 'partial', dependsOn: [], sources: [] },
  ];
  const out = applyDomainMerges(km, [{ canonical: 'cashdesk', duplicates: ['finance-cashdesk'] }]);
  assert.equal(out.domains.length, 1);
  assert.deepEqual(out.domains[0].dependsOn, []);
});

test('applyDomainMerges: canonical name/status wins regardless of order', () => {
  const km = emptyKnowledgeModel();
  km.domains = [
    { id: 'finance-cashdesk', name: 'Wrong name', status: 'planned', dependsOn: [], sources: [] },
    { id: 'cashdesk', name: 'Cash Desk', status: 'implemented', dependsOn: [], sources: [] },
  ];
  const out = applyDomainMerges(km, [{ canonical: 'cashdesk', duplicates: ['finance-cashdesk'] }]);
  assert.equal(out.domains[0].name, 'Cash Desk');
  assert.equal(out.domains[0].status, 'implemented');
});

test('applyDomainMerges: no merges leaves the model unchanged and valid', () => {
  const km = emptyKnowledgeModel();
  km.domains = domainsFrom('bookings', 'masters');
  const out = applyDomainMerges(km, []);
  assert.equal(out.domains.length, 2);
  assert.deepEqual(validateKnowledgeModel(out), []);
});
