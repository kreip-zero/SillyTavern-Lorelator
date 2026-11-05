import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeBook, describeCard, formatLines, formatTokens } from '../src/ui/summary.js';

test('describeBook counts a book of 132 entries with 14 new and 3 skipped', () => {
    const book = { entries: Object.fromEntries(Array.from({ length: 132 }, (_, i) => [i, { uid: i }])) };
    const plan = { todo: new Array(14).fill({}), skipped: 3, newCount: 14, changedCount: 0, nativeCount: 0, estimate: { inputTokens: 8000, outputTokens: 5600 } };
    assert.deepEqual(describeBook(book, plan), { total: 132, todo: 14, newCount: 14, changed: 0, native: 0, skipped: 3, localized: 115, tokens: 8000 });
});

test('describeBook never reports a negative localized count and tolerates an empty book', () => {
    assert.equal(describeBook({ entries: {} }, { todo: [], skipped: 0, newCount: 0, changedCount: 0, nativeCount: 0, estimate: { inputTokens: 0 } }).localized, 0);
    assert.equal(describeBook(null, { todo: [{}], skipped: 2, newCount: 1, changedCount: 0, nativeCount: 0, estimate: { inputTokens: 5 } }).localized, 0);
});

test('describeCard counts first message, alternates and characters', () => {
    assert.deepEqual(describeCard({ first_mes: 'Hi', data: { alternate_greetings: ['a', 'b'] } }), { hasFirst: true, alternates: 2, chars: 4 });
    assert.deepEqual(describeCard({}), { hasFirst: false, alternates: 0, chars: 0 });
});

test('formatLines counts non-empty lines', () => {
    assert.equal(formatLines('a\n\n b \n'), 2);
    assert.equal(formatLines(''), 0);
});

test('formatTokens groups thousands', () => {
    assert.equal(formatTokens(8000), '8,000');
    assert.equal(formatTokens(950), '950');
});
