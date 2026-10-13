import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPrompt, parseResponse } from '../src/localizer.js';

test('prompt truncates content and names language', () => {
    const p = buildPrompt([{ uid: 1, key: ['dragon'], comment: 'Dragon', content: 'x'.repeat(5000) }], 'ru');
    assert.ok(p.includes('Russian'));
    assert.ok(p.includes('x'.repeat(1500)));
    assert.ok(!p.includes('x'.repeat(1501)));
});

test('prompt requires stem for ai-stem languages only', () => {
    assert.ok(buildPrompt([{ uid: 1, key: ['a'], content: '' }], 'uk').includes('"stem"'));
    assert.ok(!buildPrompt([{ uid: 1, key: ['a'], content: '' }], 'ru').includes('"stem"'));
});

test('parses fenced json, ignores unknown uid, fails missing', () => {
    const r = parseResponse('Sure!\n```json\n{"entries":[{"uid":1,"phrases":[{"text":"дракон"},{"text":""}]},{"uid":99,"phrases":[{"text":"x"}]}]}\n```', [1, 2]);
    assert.deepEqual(r.ok.get(1), [{ text: 'дракон' }]);
    assert.ok(!r.ok.has(99));
    assert.deepEqual(r.failed, [2]);
});

test('parses bare json with surrounding prose and string uids', () => {
    const r = parseResponse('Here: {"entries":[{"uid":"3","phrases":[{"text":"a","stem":"a"}]}]} done', [3]);
    assert.deepEqual(r.ok.get(3), [{ text: 'a', stem: 'a' }]);
    assert.deepEqual(r.failed, []);
});

test('garbage fails whole batch', () => {
    assert.deepEqual(parseResponse('I cannot help with that', [1, 2]).failed, [1, 2]);
    assert.deepEqual(parseResponse('', [1]).failed, [1]);
});

test('truncated reply keeps the complete entries', () => {
    const text = '{"entries":[{"uid":1,"phrases":[{"text":"дракон"},{"text":"змей"}]},{"uid":2,"phrases":[{"text":"тёмное братство"}]},{"uid":3,"phrases":[{"text":"та';
    const r = parseResponse(text, [1, 2, 3]);
    assert.deepEqual(r.ok.get(1), [{ text: 'дракон' }, { text: 'змей' }]);
    assert.deepEqual(r.ok.get(2), [{ text: 'тёмное братство' }]);
    assert.deepEqual(r.failed, [3]);
});

test('prompt carries a worked example in the target language', () => {
    assert.ok(buildPrompt([{ uid: 1, key: ['a'], content: '' }], 'ru').includes('трактирщица'));
    assert.ok(buildPrompt([{ uid: 1, key: ['a'], content: '' }], 'de').includes('Wirtin'));
    assert.ok(buildPrompt([{ uid: 1, key: ['a'], content: '' }], 'ja').includes('女将'));
});

test('prompt puts entries before the rules and explains word order', () => {
    const p = buildPrompt([{ uid: 1, key: ['a'], content: 'x' }], 'ru');
    assert.ok(p.indexOf('<entries>') < p.indexOf('<rules>'));
    assert.match(p, /single words/i);
});

test('every language has an example', () => {
    for (const lang of ['ru', 'uk', 'de', 'fr', 'es', 'pt', 'it', 'pl', 'cs', 'sk', 'hu', 'ja', 'zh']) {
        assert.doesNotThrow(() => buildPrompt([{ uid: 1, key: ['a'], content: '' }], lang), lang);
    }
});

test('keywords as plain strings are accepted', () => {
    const r = parseResponse('{"entries":[{"uid":1,"keywords":["дракон","змей"]}]}', [1]);
    assert.deepEqual(r.ok.get(1), [{ text: 'дракон' }, { text: 'змей' }]);
});

test('reasoning block with braces is ignored', () => {
    const text = '<think>The format is {"entries": [...]} so for uid 1 I {think}...</think>\n{"entries":[{"uid":1,"keywords":["дракон"]}]}';
    assert.deepEqual(parseResponse(text, [1]).ok.get(1), [{ text: 'дракон' }]);
});

test('secondary keys are sent and asked for', () => {
    const p = buildPrompt([{ uid: 1, key: ['dragon'], keysecondary: ['red'], selective: true, content: '' }], 'ru');
    assert.match(p, /"secondary":\["red"\]/);
    assert.match(p, /secondary_keywords/);
});

test('entries already in the language may come back empty', () => {
    assert.match(buildPrompt([{ uid: 1, key: ['a'], content: '' }], 'de'), /already in German/);
    const r = parseResponse('{"entries":[{"uid":1,"keywords":[]}]}', [1]);
    assert.deepEqual(r.ok.get(1), []);
    assert.deepEqual(r.failed, []);
});

test('secondary keywords are parsed separately', () => {
    const r = parseResponse('{"entries":[{"uid":1,"keywords":["дракон"],"secondary_keywords":["красный"]}]}', [1]);
    assert.deepEqual(r.secondary.get(1), [{ text: 'красный' }]);
});
