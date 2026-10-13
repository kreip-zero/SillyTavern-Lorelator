import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyKeys, removeKeys, needsLocalization, getOwnKeys } from '../src/entry-keys.js';

test('apply twice does not duplicate and keeps author keys', () => {
    const e = { key: ['dragon'], content: 'x' };
    applyKeys(e, 'ru', ['/a/iu', '/b/iu'], 'm');
    applyKeys(e, 'ru', ['/a/iu', '/c/iu'], 'm');
    assert.deepEqual(e.key, ['dragon', '/a/iu', '/c/iu']);
});

test('remove restores original', () => {
    const e = { key: ['dragon'], content: 'x' };
    applyKeys(e, 'ru', ['/a/iu'], 'm');
    applyKeys(e, 'de', ['/d/iu'], 'm');
    assert.deepEqual(getOwnKeys(e).sort(), ['/a/iu', '/d/iu']);
    removeKeys(e, 'de');
    assert.deepEqual(e.key, ['dragon', '/a/iu']);
    removeKeys(e);
    assert.deepEqual(e.key, ['dragon']);
    assert.equal(e.extensions?.lorebookLocalizer, undefined);
});

test('needsLocalization states', () => {
    const e = { key: ['dragon'], content: 'x' };
    assert.equal(needsLocalization({ key: [], content: 'x' }, 'ru'), 'skip');
    assert.equal(needsLocalization({ key: ['a'], constant: true, content: 'x' }, 'ru'), 'skip');
    assert.equal(needsLocalization(e, 'ru'), 'new');
    applyKeys(e, 'ru', ['/a/iu'], 'm');
    assert.equal(needsLocalization(e, 'ru'), 'ok');
    assert.equal(needsLocalization(e, 'de'), 'new');
    e.content = 'y';
    assert.equal(needsLocalization(e, 'ru'), 'changed');
});

test('user-deleted own key is not re-added by needsLocalization', () => {
    const e = { key: ['dragon'], content: 'x' };
    applyKeys(e, 'ru', ['/a/iu'], 'm');
    e.key = ['dragon'];
    assert.equal(needsLocalization(e, 'ru'), 'ok');
});

test('adding another language does not mark the first as changed', () => {
    const e = { key: ['dragon'], content: 'x' };
    applyKeys(e, 'ru', ['/a/iu'], 'm');
    applyKeys(e, 'de', ['/d/iu'], 'm');
    assert.equal(needsLocalization(e, 'ru'), 'ok');
});

test('disabled entries are skipped', () => {
    assert.equal(needsLocalization({ key: ['a'], content: 'x', disable: true }, 'ru'), 'skip');
});

test('entries whose keys are already in the target script are native', () => {
    assert.equal(needsLocalization({ key: ['дракон', 'змей'], content: 'x' }, 'ru'), 'native');
    assert.equal(needsLocalization({ key: ['дракон', 'dragon'], content: 'x' }, 'ru'), 'new');
    assert.equal(needsLocalization({ key: ['дракон'], content: 'x' }, 'de'), 'new');
    assert.equal(needsLocalization({ key: ['龍'], content: 'x' }, 'zh'), 'native');
    assert.equal(needsLocalization({ key: ['ドラゴン'], content: 'x' }, 'zh'), 'new');
});

test('keys made locally (no AI) do not count as localized for a non-native entry', () => {
    const e = { key: ['dragon'], content: 'x' };
    applyKeys(e, 'de', ['/dragon\p{L}*/iu'], 'local', undefined, { ai: false });
    assert.equal(needsLocalization(e, 'de'), 'new');
    const n = { key: ['дракон'], content: 'x' };
    applyKeys(n, 'ru', ['/дракон\p{L}*/iu'], 'local', undefined, { ai: false });
    assert.equal(needsLocalization(n, 'ru'), 'ok');
});

test('secondary keys are added and removed with the language', () => {
    const e = { key: ['dragon'], keysecondary: ['red'], content: 'x' };
    applyKeys(e, 'ru', ['/a/iu'], 'm', undefined, { secondary: ['/красн\p{L}*/iu'] });
    assert.deepEqual(e.keysecondary, ['red', '/красн\p{L}*/iu']);
    assert.equal(needsLocalization(e, 'ru'), 'ok');
    removeKeys(e, 'ru');
    assert.deepEqual(e.keysecondary, ['red']);
    assert.deepEqual(e.key, ['dragon']);
});
