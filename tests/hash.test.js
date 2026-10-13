import { test } from 'node:test';
import assert from 'node:assert/strict';
import { entryHash } from '../src/hash.js';

test('hash ignores own keys and changes with content', () => {
    const e = { key: ['dragon'], comment: 'Dragon', content: 'A big lizard' };
    const h = entryHash(e);
    assert.equal(entryHash({ ...e, key: ['dragon', '/x/iu'] }, ['/x/iu']), h);
    assert.notEqual(entryHash({ ...e, content: 'A small lizard' }), h);
});

test('hash of entries without secondary keys is unchanged across versions', () => {
    assert.equal(entryHash({ key: ['dragon'], comment: 'Dragon', content: 'Huge winged reptiles.' }), '39b4afc0');
});

test('secondary keys count, own secondary keys do not', () => {
    const e = { key: ['dragon'], keysecondary: ['red'], content: 'x' };
    const h = entryHash(e);
    assert.notEqual(h, entryHash({ ...e, keysecondary: [] }));
    assert.equal(entryHash({ ...e, keysecondary: ['red', '/к/iu'] }, ['/к/iu']), h);
});
