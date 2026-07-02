import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasCyrillic, collectTranslatable, applyTranslations } from '../skills/translate/scripts/translate.mjs';

function model() {
  return {
    backlog: {
      epics: [{
        id: 'epic-eng', trackerKey: 'BLM-1', title: 'Bookings', description: 'English desc', status: 'done', stories: [{
          id: 'story-ru', trackerKey: 'BLM-2', title: 'Список записів',
          acceptanceCriteria: [{ given: 'g', when: 'w', then: 't' }],
          tasks: [{ id: 'task-en', trackerKey: 'BLM-3', title: 'Add index', category: 'database', subtasks: [] }]
        }]
      }]
    }
  };
}

test('hasCyrillic: detects Cyrillic, ignores Latin', () => {
  assert.equal(hasCyrillic('Список'), true);
  assert.equal(hasCyrillic('Bookings list'), false);
  assert.equal(hasCyrillic(''), false);
});

test('collectTranslatable: flags only nodes with Cyrillic text', () => {
  const ids = collectTranslatable(model()).map(x => x.id);
  assert.deepEqual(ids, ['story-ru']); // epic + task are English
});

test('collectTranslatable: Cyrillic in AC flags the story', () => {
  const m = model();
  m.backlog.epics[0].stories[0].title = 'List'; // English title
  m.backlog.epics[0].stories[0].acceptanceCriteria = [{ given: 'Дано користувач', when: 'w', then: 't' }];
  assert.deepEqual(collectTranslatable(m).map(x => x.id), ['story-ru']);
});

test('applyTranslations: writes by id, preserves other fields, skips unlisted', () => {
  const m = model();
  applyTranslations(m, {
    'story-ru': { title: 'Bookings list', acceptanceCriteria: [{ given: 'a user', when: 'w2', then: 't2' }] }
  });
  const story = m.backlog.epics[0].stories[0];
  assert.equal(story.title, 'Bookings list');
  assert.equal(story.acceptanceCriteria[0].given, 'a user');
  assert.equal(story.trackerKey, 'BLM-2'); // preserved
  assert.equal(m.backlog.epics[0].title, 'Bookings'); // unlisted node untouched
});
