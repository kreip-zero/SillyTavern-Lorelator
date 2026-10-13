// Regression tests for the review of the word-form work (part 2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { phraseToKey, buildKeys } from '../src/morphology.js';
import { parseResponse, buildPrompt } from '../src/localizer.js';
import { runLocalization } from '../src/runner.js';
import { toRegExp, fakeIo, fakeLlm, okResponse, bookWith, entries } from './helpers.js';

const re = (text, lang, stem) => toRegExp(phraseToKey({ text, stem }, lang));
const anyKey = (pairs, text) => pairs.map(p => toRegExp(p.key)).some(r => r.test(text));

test('6-letter words never become an open 4-letter prefix (parada must not catch "para")', () => {
    assert.ok(!re('parada', 'es').test('voy para casa'));
    assert.ok(re('parada', 'es').test('las paradas'));
    assert.ok(!re('comida', 'es').test('la comisión'));
    assert.ok(re('cañería', 'es').test('las cañerías'));
});

test('AI stems are never overridden by the long-word rule', () => {
    assert.ok(re('kupiec', 'pl', 'kup').test('u kupca'));
});

test('Ukrainian short stems keep matching forms after a stem change', () => {
    assert.ok(re('вовк', 'uk', 'вов').test('у вовка'));
    assert.ok(re('зірка', 'uk', 'зір').test('дві зірки'));
});

test('forms of a stopword are not added; each form passes the stopword check', () => {
    assert.deepEqual(buildKeys([{ text: 'человек', forms: ['человека'] }], 'ru', []), []);
    assert.ok(!anyKey(buildKeys([{ text: 'Drache', forms: ['Tag'] }], 'de', []), 'jeden Tag'));
});

test('a name equal to the author key still gets its forms', () => {
    const pairs = buildKeys([{ text: 'Elara', forms: ['Elary'] }], 'cs', ['Elara']);
    assert.ok(anyKey(pairs, 'od Elary'));
});

test('at most two forms per keyword are used', () => {
    const pairs = buildKeys([{ text: 'дом', forms: ['лесах', 'полях', 'горах', 'реках'] }].map(p => ({ ...p, text: 'замок' })), 'ru', []);
    assert.ok(pairs.length <= 3);
});

test('forms given as a string or as objects are accepted', () => {
    const r = parseResponse('{"entries":[{"uid":1,"keywords":[{"text":"зірка","forms":"зірки"},{"text":"ріка","forms":[{"text":"ріці"}]}]}]}', [1]);
    assert.deepEqual(r.ok.get(1)[0].forms, ['зірки']);
    assert.deepEqual(r.ok.get(1)[1].forms, ['ріці']);
});

test('Hungarian prompt asks for the accusative, not the genitive', () => {
    const p = buildPrompt([{ uid: 1, key: ['a'], content: '' }], 'hu');
    assert.match(p, /accusative/);
});

test('batches shrink so the expected reply fits under the output cap', async () => {
    const llm = fakeLlm(uids => okResponse(uids.filter(u => typeof u === 'number'), 'зірка'));
    await runLocalization({ name: 'b', lang: 'uk', todo: entries(30), batchSize: 30, io: fakeIo(bookWith(30)), llm, sleep: async () => {} });
    assert.ok(llm.calls >= 3, String(llm.calls));
    assert.ok(llm.maxTokens.every(n => n <= 8192));
});
