import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPrompt, parseResponse, outputTokensPerEntry } from '../src/localizer.js';
import { buildKeys } from '../src/morphology.js';
import { LANGUAGES } from '../src/languages.js';
import { toRegExp } from './helpers.js';

test('languages where extra forms help ask for them; others do not', () => {
    for (const lang of ['ru', 'uk', 'pl', 'cs', 'hu', 'de', 'id']) {
        assert.ok(LANGUAGES[lang].forms, lang);
        assert.match(buildPrompt([{ uid: 1, key: ['a'], content: '' }], lang), /"forms"/, lang);
    }
    for (const lang of ['es', 'fr', 'it', 'pt', 'sk', 'ja', 'zh']) {
        assert.ok(!LANGUAGES[lang].forms, lang);
        assert.doesNotMatch(buildPrompt([{ uid: 1, key: ['a'], content: '' }], lang), /"forms"/, lang);
    }
});

test('forms cost a little more output', () => {
    assert.ok(outputTokensPerEntry('ru') > outputTokensPerEntry('es'));
});

test('forms are parsed with their keyword', () => {
    const r = parseResponse('{"entries":[{"uid":1,"keywords":[{"text":"зірка","stem":"зірк","forms":["зірки","зірок"]}]}]}', [1]);
    assert.deepEqual(r.ok.get(1), [{ text: 'зірка', stem: 'зірк', forms: ['зірки', 'зірок'] }]);
});

test('keys built from forms catch fleeting vowels and alternations', () => {
    const pairs = buildKeys([{ text: 'зірка', stem: 'зірк', forms: ['зірок'] }], 'uk', []);
    const regs = pairs.map(p => toRegExp(p.key));
    assert.ok(regs.some(r => r.test('багато зірок')));
    assert.ok(regs.some(r => r.test('до зірки')));
    const cs = buildKeys([{ text: 'řeka', forms: ['řece', 'řeky'] }], 'cs', []).map(p => toRegExp(p.key));
    assert.ok(cs.some(r => r.test('na řece')));
});

test('form keys never duplicate the main keyword key', () => {
    const pairs = buildKeys([{ text: 'дракон', forms: ['дракона', 'драконы'] }], 'ru', []);
    assert.equal(new Set(pairs.map(p => p.key)).size, pairs.length);
    assert.equal(pairs.length, 1);
});
