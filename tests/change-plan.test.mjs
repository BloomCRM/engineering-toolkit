import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDiff, pathsMatch, matchSources, buildChangeReport } from '../skills/detect-changes/scripts/change-plan.mjs';

function model() {
  return {
    source: { commit: 'base123' },
    knowledgeModel: {
      domains: [
        { id: 'calendar', name: 'Calendar', sources: ['docs/architecture/ER.md', 'src/Calendar.cs#L10'] },
        { id: 'bookings', name: 'Bookings', sources: ['docs/bookings.md'] }
      ],
      architecture: [], techDebt: [{ id: 'td1', title: 'x', sources: ['docs/code-reviews/a.md'] }],
      infrastructure: [], security: [], risks: []
    }
  };
}

test('parseDiff: parses name-status lines incl. rename', () => {
  const rows = parseDiff('M\tdocs/x.md\nA\tsrc/b.cs\nD\tdocs/c.md\nR100\tdocs/old.md\tdocs/new.md');
  assert.equal(rows.length, 4);
  assert.deepEqual(rows[0], { status: 'M', path: 'docs/x.md' });
  assert.equal(rows[3].status, 'R');
  assert.equal(rows[3].path, 'docs/new.md'); // current path = last column
});

test('parseDiff: ignores blank lines', () => {
  assert.equal(parseDiff('\n\nM\ta.md\n\n').length, 1);
});

test('pathsMatch: equality and path-suffix, ignoring #Lnn and backslashes', () => {
  assert.ok(pathsMatch('src/Calendar.cs#L10', 'src/Calendar.cs'));
  assert.ok(pathsMatch('docs\\x.md', 'docs/x.md'));
  assert.ok(!pathsMatch('docs/x.md', 'docs/y.md'));
});

test('matchSources: flags the domain whose source changed', () => {
  const stale = matchSources(['src/Calendar.cs'], model());
  assert.deepEqual(stale.domains, ['calendar']);
  assert.deepEqual(stale.techDebt, []);
});

test('matchSources: flags tech-debt entry by its source', () => {
  const stale = matchSources(['docs/code-reviews/a.md'], model());
  assert.deepEqual(stale.techDebt, ['td1']);
});

test('buildChangeReport: counts stale entries and recommends re-analysis', () => {
  const r = buildChangeReport(model(), ['docs/bookings.md', 'README.md']);
  assert.equal(r.baselineCommit, 'base123');
  assert.deepEqual(r.staleBySection.domains, ['bookings']);
  assert.equal(r.staleCount, 1);
  assert.match(r.recommendation, /analyze-project/);
});

test('buildChangeReport: no changes => zero stale, baseline message', () => {
  const r = buildChangeReport(model(), []);
  assert.equal(r.staleCount, 0);
  assert.match(r.recommendation, /No changes/i);
});

test('buildChangeReport: changed files with no source match => full re-analysis hint', () => {
  const r = buildChangeReport(model(), ['unrelated/file.txt']);
  assert.equal(r.staleCount, 0);
  assert.match(r.recommendation, /full .*analyze-project|do not map/i);
});
