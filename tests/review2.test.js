// Regression tests for the second whole-branch review.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { phraseToKey } from '../src/morphology.js';
import { parseResponse, buildPrompt } from '../src/localizer.js';
import { applyKeys, removeKeys, needsLocalization, getOwnKeys } from '../src/entry-keys.js';
import { planLocalization, runLocalization, planMorphology, applyMorphology } from '../src/runner.js';
import { withRetry } from '../src/retry.js';
import { backupFileName } from '../src/st-lorebook.js';
import { fakeIo, fakeLlm, okResponse, bookWith, entries } from './helpers.js';
import { toRegExp } from './helpers.js';

const noSleep = async () => {};

test('AI-stem Latin languages fold accents too (Polish typed without diacritics)', () => {
    assert.ok(toRegExp(phraseToKey({ text: 'wiedźma', stem: 'wiedźm' }, 'pl')).test('dwie wiedzmy'));
});

test('word-forms pass keeps blocks from older versions (no ai flag) localized', () => {
    const book = { entries: { 0: { uid: 0, key: ['Drache'], content: 'x' } } };
    applyKeys(book.entries[0], 'de', ['/x/iu'], 'model');
    delete book.entries[0].extensions.lorebookLocalizer.de.ai;
    applyMorphology(book, 'de', new Map([[0, ['/drach\\p{L}*/iu']]]));
    assert.equal(needsLocalization(book.entries[0], 'de'), 'ok');
});

test('keywords of the wrong shape count as failed, not as "already in the language"', () => {
    const r = parseResponse('{"entries":[{"uid":1,"keywords":[{"word":"дракон"}]},{"uid":2,"keywords":[]}]}', [1, 2]);
    assert.deepEqual(r.failed, [1]);
    assert.deepEqual(r.ok.get(2), []);
});

test('example entries cannot collide with real uids', () => {
    const p = buildPrompt([{ uid: 901, key: ['dragon'], content: 'x' }], 'ru');
    assert.equal((p.match(/"uid":901\b/g) ?? []).length, 1);
    assert.deepEqual(parseResponse('{"entries":[{"uid":901,"keywords":["дракон"]}]}', [901]).failed, []);
});

test('errors marked not retryable are not retried', async () => {
    let n = 0;
    const error = Object.assign(new Error('reasoning ate the budget'), { retryable: false });
    await assert.rejects(withRetry(async () => { n++; throw error; }, { sleep: noSleep }));
    assert.equal(n, 1);
});

test('a fatal error stops the whole run instead of failing every batch the same way', async () => {
    const llm = fakeLlm(() => { throw Object.assign(new Error('reasoning ate the budget'), { retryable: false, fatal: true }); });
    const r = await runLocalization({ name: 'b', lang: 'ru', todo: entries(30), batchSize: 10, io: fakeIo(bookWith(30)), llm, sleep: noSleep });
    assert.equal(llm.calls, 1);
    assert.equal(r.lastError.message, 'reasoning ate the budget');
    assert.equal(r.failed.length, 30);
});

test('even a single entry gets a usable token budget', async () => {
    const llm = fakeLlm(uids => okResponse(uids, 'дракон'));
    await runLocalization({ name: 'b', lang: 'ru', todo: entries(1), io: fakeIo(bookWith(1)), llm, sleep: noSleep });
    assert.ok(llm.maxTokens[0] >= 2048);
});

test('removing one language keeps keys another language also uses', () => {
    const e = { key: ['dragon'], content: 'x' };
    applyKeys(e, 'ru', ['/дракон/iu'], 'm');
    applyKeys(e, 'uk', ['/дракон/iu', '/змій/iu'], 'm');
    removeKeys(e, 'ru');
    assert.ok(e.key.includes('/дракон/iu'));
    assert.deepEqual(getOwnKeys(e, 'uk').sort(), ['/дракон/iu', '/змій/iu']);
    removeKeys(e, 'uk');
    assert.deepEqual(e.key, ['dragon']);
});

test('script detection needs real evidence for Ukrainian and Japanese', () => {
    assert.equal(needsLocalization({ key: ['дракон', 'меч'], content: 'x' }, 'uk'), 'new');
    assert.equal(needsLocalization({ key: ['дракон', 'їжак'], content: 'x' }, 'uk'), 'native');
    assert.equal(needsLocalization({ key: ['龙', '药水'], content: 'x' }, 'ja'), 'new');
    assert.equal(needsLocalization({ key: ['ドラゴン', '竜'], content: 'x' }, 'ja'), 'native');
});

test('no local word forms for languages without a local stemmer', () => {
    assert.deepEqual(planMorphology({ entries: { 0: { uid: 0, key: ['їжак'], content: 'x' } } }, 'uk'), []);
    assert.deepEqual(planMorphology({ entries: { 0: { uid: 0, key: ['ドラゴン'], content: 'x' } } }, 'ja'), []);
});

test('salvage keeps complete entries even when secondary_keywords follow', () => {
    const text = '{"entries":[{"uid":1,"keywords":["дракон"],"secondary_keywords":["красный"]},{"uid":2,"keywords":["тав';
    const r = parseResponse(text, [1, 2]);
    assert.deepEqual(r.ok.get(1), [{ text: 'дракон' }]);
    assert.deepEqual(r.secondary.get(1), [{ text: 'красный' }]);
    assert.deepEqual(r.failed, [2]);
});

test('an AI-localized entry that becomes native keeps its AI keys', async () => {
    const io = fakeIo({ entries: { 0: { uid: 0, key: ['dragon'], content: 'x' } } });
    applyKeys(io.current.entries[0], 'ru', ['/зм[её]й/iu'], 'model');
    io.current.entries[0].key = io.current.entries[0].key.filter(k => k !== 'dragon').concat('дракон');
    const plan = planLocalization(io.current, 'ru', { onlyChanged: false });
    await runLocalization({ name: 'b', lang: 'ru', todo: plan.todo, io, llm: fakeLlm(() => { throw new Error('no AI expected'); }), sleep: noSleep });
    assert.ok(io.current.entries[0].key.includes('/зм[её]й/iu'));
});

test('backup file names differ within the same second', () => {
    const a = backupFileName('Lore', new Date(2026, 9, 12, 14, 40, 5, 10));
    const b = backupFileName('Lore', new Date(2026, 9, 12, 14, 40, 5, 20));
    assert.notEqual(a, b);
});
