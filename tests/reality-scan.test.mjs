import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MARKERS, flagSuspects, buildRealityReport } from '../skills/reality-check/scripts/reality-scan.mjs';

function model() {
  return { knowledgeModel: { domains: [
    { id: 'dashboard', name: 'Dashboard', status: 'implemented', sources: ['src/Dashboard.razor'] },
    { id: 'bookings', name: 'Bookings', status: 'implemented', sources: ['src/Bookings.cs'] },
    { id: 'cashdesk', name: 'Cash desk', status: 'planned', sources: ['src/CashDesk.cs'] }
  ] } };
}

test('MARKERS is a non-empty list of stub signals', () => {
  assert.ok(Array.isArray(MARKERS) && MARKERS.length >= 4);
});

test('flagSuspects: implemented domain whose source has a stub marker is suspect', () => {
  const s = flagSuspects(model(), ['src/Dashboard.razor']);
  assert.deepEqual(s.map(x => x.id), ['dashboard']);
});

test('flagSuspects: planned domains are not flagged (already not-done)', () => {
  const s = flagSuspects(model(), ['src/CashDesk.cs']);
  assert.equal(s.length, 0);
});

test('buildRealityReport: counts suspects and recommends re-verify/downgrade', () => {
  const r = buildRealityReport(model(), ['src/Dashboard.razor']);
  assert.equal(r.suspects.length, 1);
  assert.match(r.recommendation, /verify|downgrade/i);
});

test('buildRealityReport: no hits => clean', () => {
  const r = buildRealityReport(model(), []);
  assert.equal(r.suspects.length, 0);
  assert.match(r.recommendation, /no .*suspect|clean/i);
});
