import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withRetry } from '../src/retry.js';

test('retries then succeeds with exponential delays', async () => {
    const delays = [];
    let n = 0;
    const r = await withRetry(async () => {
        if (++n < 3) throw new Error('x');
        return 'ok';
    }, { sleep: async ms => delays.push(ms) });
    assert.equal(r, 'ok');
    assert.deepEqual(delays, [1000, 2000]);
});

test('gives up after 3 attempts', async () => {
    let n = 0;
    await assert.rejects(withRetry(async () => { n++; throw new Error('boom'); }, { sleep: async () => {} }), /boom/);
    assert.equal(n, 3);
});

test('abort stops immediately', async () => {
    const c = new AbortController();
    c.abort();
    let n = 0;
    await assert.rejects(withRetry(async () => { n++; }, { signal: c.signal }), { name: 'AbortError' });
    assert.equal(n, 0);
});

test('abort error from fn is not retried', async () => {
    let n = 0;
    await assert.rejects(withRetry(async () => {
        n++;
        throw new DOMException('Aborted', 'AbortError');
    }, { sleep: async () => {} }), { name: 'AbortError' });
    assert.equal(n, 1);
});
