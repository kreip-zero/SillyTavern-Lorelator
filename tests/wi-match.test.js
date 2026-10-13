import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchKey, matchEntry, readableKey } from '../src/wi-match.js';
import { toRegExp as parseRegex } from './helpers.js';

const loose = { caseSensitive: false, wholeWords: false };
const ourDragon = String.raw`/(?<![\p{L}\p{N}])дракон\p{L}*/iu`;

test('regex key matches word forms and reports the matched fragment', () => {
    const r = matchKey(ourDragon, 'Вчера мы видели драконами небо', loose, parseRegex);
    assert.equal(r.matched, true);
    assert.match(r.fragment, /драконами/);
});

test('plain keys follow case sensitivity', () => {
    assert.equal(matchKey('Dragon', 'a dragon here', loose, parseRegex).matched, true);
    assert.equal(matchKey('Dragon', 'a dragon here', { caseSensitive: true, wholeWords: false }, parseRegex).matched, false);
});

test('whole words: single word needs boundaries, phrase uses includes', () => {
    const whole = { caseSensitive: false, wholeWords: true };
    assert.equal(matchKey('cat', 'catalog', whole, parseRegex).matched, false);
    assert.equal(matchKey('cat', 'catalog', loose, parseRegex).matched, true);
    assert.equal(matchKey('dark brotherhood', 'the Dark Brotherhoods', whole, parseRegex).matched, true);
    assert.equal(matchKey('cat', 'a cat.', whole, parseRegex).matched, true);
});

test('invalid regex keys are plain text, not a crash', () => {
    assert.equal(matchKey('/(/i', 'see /(/i here', loose, parseRegex).matched, true);
    assert.equal(matchKey('/(/i', 'nothing', loose, parseRegex).matched, false);
});

test('fragment of a long text stays short', () => {
    const text = `${'слово '.repeat(500)}дракон${' слово'.repeat(500)}`;
    const { fragment } = matchKey(ourDragon, text, loose, parseRegex);
    assert.ok(fragment.length <= 60, fragment);
    assert.match(fragment, /дракон/);
});

test('entry entry-level options override globals', () => {
    const e = { key: ['Dragon'], caseSensitive: true, content: '' };
    assert.equal(matchEntry(e, 'a dragon', loose, parseRegex).matched, false);
});

test('no primary keys never matches', () => {
    assert.equal(matchEntry({ key: [], content: '' }, 'anything', loose, parseRegex).matched, false);
});

test('secondary logic: AND_ANY, NOT_ALL, NOT_ANY, AND_ALL', () => {
    const e = logic => ({ key: ['sword'], keysecondary: ['silver', 'gold'], selective: true, selectiveLogic: logic, content: '' });
    const text = 'a silver sword';
    assert.equal(matchEntry(e(0), text, loose, parseRegex).matched, true);
    assert.equal(matchEntry(e(1), text, loose, parseRegex).matched, true);
    assert.equal(matchEntry(e(2), text, loose, parseRegex).matched, false);
    assert.equal(matchEntry(e(3), text, loose, parseRegex).matched, false);
    assert.equal(matchEntry(e(3), 'silver and gold sword', loose, parseRegex).matched, true);
    assert.equal(matchEntry(e(0), 'a plain sword', loose, parseRegex).matched, false);
    const r = matchEntry(e(0), text, loose, parseRegex);
    assert.equal(r.primary.key, 'sword');
    assert.equal(r.secondary.key, 'silver');
});

test('secondary keys are ignored when the entry is not selective', () => {
    const e = { key: ['sword'], keysecondary: ['silver'], selective: false, selectiveLogic: 0, content: '' };
    assert.equal(matchEntry(e, 'a sword', loose, parseRegex).matched, true);
});

test('readable keys', () => {
    assert.equal(readableKey(ourDragon, parseRegex), 'дракон…');
    const fleeting = String.raw`/(?<![\p{L}\p{N}])(?:рынок\p{L}*|рынк(?:а|у|е)(?![\p{L}\p{N}]))/iu`;
    assert.equal(readableKey(fleeting, parseRegex), 'рынок…');
    assert.equal(readableKey(String.raw`/(?<![\p{L}\p{N}])т[её]мн\p{L}*\s+братств\p{L}*/iu`, parseRegex), 'темн… братств…');
    assert.equal(readableKey('Dark Brotherhood', parseRegex), 'Dark Brotherhood');
    assert.equal(readableKey(String.raw`/\bsword(s)?\b/i`, parseRegex), String.raw`\bsword(s)?\b`);
});

test('Cyrillic whole-word quirk is mirrored: SillyTavern uses \W without the u flag', () => {
    // Cyrillic letters count as non-word characters there, so "кот" matches inside "котлета".
    assert.equal(matchKey('кот', 'котлета', { caseSensitive: false, wholeWords: true }, parseRegex).matched, true);
});

test('readable key shows "…" where an optional ending was dropped', () => {
    const short = String.raw`/(?<![\p{L}\p{N}])з[её]л(?:а|я|у|ье)?(?![\p{L}\p{N}])/iu`;
    assert.equal(readableKey(short, parseRegex), 'зел…');
});
