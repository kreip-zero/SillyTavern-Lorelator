import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LANGUAGES } from '../src/languages.js';
import { getStemmer } from '../src/stemmers.js';

test('ru stemmer reduces inflections to one stem', () => {
    const s = getStemmer('ru');
    assert.equal(s('драконами'), s('дракон'));
    assert.equal(s('братства'), s('братство'));
});

test('every language has a stem mode', () => {
    for (const code of ['ru', 'uk', 'de', 'fr', 'es', 'pt', 'it', 'pl', 'cs', 'sk', 'hu', 'id', 'ja', 'zh']) {
        assert.ok(['snowball', 'ai', 'prefix', 'none'].includes(LANGUAGES[code]?.stem), code);
    }
});

test('non-snowball languages have no stemmer', () => {
    assert.equal(getStemmer('ja'), null);
    assert.equal(getStemmer('uk'), null);
    assert.equal(getStemmer('pl'), null);
});
