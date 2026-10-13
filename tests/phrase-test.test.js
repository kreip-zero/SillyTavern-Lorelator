import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testPhrase } from '../src/phrase-test.js';
import { applyKeys } from '../src/entry-keys.js';
import { toRegExp as parseRegex } from './helpers.js';

const globals = { caseSensitive: false, wholeWords: false };

function book() {
    const entries = {
        0: { uid: 0, comment: 'Dragon', key: ['dragon'], content: 'x' },
        1: { uid: 1, comment: 'Off', key: ['дракон'], disable: true, content: 'x' },
        2: { uid: 2, comment: 'Rules', key: [], constant: true, content: 'x' },
        3: { uid: 3, comment: 'Sword', key: ['меч'], keysecondary: ['серебр'], selective: true, selectiveLogic: 2, content: 'x' },
    };
    applyKeys(entries[0], 'ru', [String.raw`/(?<![\p{L}\p{N}])дракон\p{L}*/iu`], 'model');
    return entries;
}

test('finds entries by our keys, skips disabled ones, lists constants separately', () => {
    const r = testPhrase([{ name: 'LL', data: { entries: book() } }], 'Я видел драконами небо', globals, parseRegex);
    const byTitle = Object.fromEntries(r.map(i => [i.title, i]));
    assert.equal(byTitle.Dragon.reason.kind, 'key');
    assert.equal(byTitle.Dragon.reason.own, 'ru');
    assert.match(byTitle.Dragon.reason.fragment, /драконами/);
    assert.equal(byTitle.Off, undefined);
    assert.equal(byTitle.Rules.reason.kind, 'constant');
});

test('secondary NOT_ANY logic is respected', () => {
    const books = [{ name: 'LL', data: { entries: book() } }];
    assert.ok(testPhrase(books, 'обычный меч', globals, parseRegex).some(i => i.title === 'Sword'));
    assert.ok(!testPhrase(books, 'серебряный меч', globals, parseRegex).some(i => i.title === 'Sword'));
});

test('results from several lorebooks carry their names', () => {
    const r = testPhrase([{ name: 'A', data: { entries: book() } }, { name: 'B', data: { entries: book() } }], 'дракон', globals, parseRegex);
    assert.deepEqual(r.filter(i => i.title === 'Dragon').map(i => i.world), ['A', 'B']);
});
