import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterItems, normalize } from '../src/ui/picker.js';

const items = [
    { value: 'a', label: 'Academy Precantatio - Lorebook' },
    { value: 'b', label: 'Ёлка и Жёлудь' },
    { value: 'c', label: 'Café Müller' },
    { value: 'd', label: 'Мир Тортус' },
    { value: 'e', label: 'SCP_Mega_Lorebook_Series_1' },
];

test('normalize lowercases and drops accents, ё and й marks', () => {
    assert.equal(normalize('Café MÜLLER'), 'cafe muller');
    assert.equal(normalize('Ёлка'), 'елка');
});

test('empty or blank query returns everything', () => {
    assert.deepEqual(filterItems(items, '').map(i => i.value), ['a', 'b', 'c', 'd', 'e']);
    assert.deepEqual(filterItems(items, '   ').length, 5);
});

test('every word must match, in any order, case-insensitively', () => {
    assert.deepEqual(filterItems(items, 'lorebook academy').map(i => i.value), ['a']);
    assert.deepEqual(filterItems(items, 'LOREBOOK').map(i => i.value), ['a', 'e']);
});

test('ё and е, accents and plain letters find each other', () => {
    assert.deepEqual(filterItems(items, 'елка').map(i => i.value), ['b']);
    assert.deepEqual(filterItems(items, 'жёлудь').map(i => i.value), ['b']);
    assert.deepEqual(filterItems(items, 'cafe muller').map(i => i.value), ['c']);
    assert.deepEqual(filterItems(items, 'café').map(i => i.value), ['c']);
});

test('underscores and punctuation do not block a match', () => {
    assert.deepEqual(filterItems(items, 'scp mega series').map(i => i.value), ['e']);
});

test('no match gives an empty list', () => {
    assert.deepEqual(filterItems(items, 'zzz'), []);
});
