import { test } from 'node:test';
import assert from 'node:assert/strict';
import { replyText } from '../src/st-llm.js';

test('reply text comes from content or a plain string', () => {
    assert.equal(replyText({ content: '{"a":1}', reasoning: 'thinking' }), '{"a":1}');
    assert.equal(replyText('plain'), 'plain');
});

test('empty content after reasoning explains the token budget', () => {
    assert.throws(() => replyText({ content: '', reasoning: 'long thoughts' }), /reasoning/i);
});

test('empty reply without reasoning is an error too', () => {
    assert.throws(() => replyText({ content: '' }), /empty/i);
});

test('our own request loses the reasoning setting; other requests are untouched', async () => {
    const { stripReasoning } = await import('../src/st-llm.js');
    const ours = { messages: [{ role: 'user', content: 'PROMPT' }], reasoning_effort: 'medium' };
    stripReasoning(ours, 'PROMPT');
    assert.equal('reasoning_effort' in ours, false);
    const chat = { messages: [{ role: 'user', content: 'hi' }], reasoning_effort: 'medium' };
    stripReasoning(chat, 'PROMPT');
    assert.equal(chat.reasoning_effort, 'medium');
});

test('Cancel stops waiting for a request that cannot be aborted', async () => {
    const { untilAborted } = await import('../src/st-llm.js');
    const controller = new AbortController();
    const never = new Promise(() => {});
    const waiting = untilAborted(never, controller.signal);
    controller.abort();
    await assert.rejects(waiting, { name: 'AbortError' });
    assert.equal(await untilAborted(Promise.resolve('ok'), new AbortController().signal), 'ok');
    await assert.rejects(untilAborted(Promise.resolve('late'), controller.signal), { name: 'AbortError' });
});

test('a request that never answers fails after the timeout instead of keeping the panel busy', async () => {
    const { createLlm } = await import('../src/st-llm.js');
    globalThis.SillyTavern = { getContext: () => ({ eventSource: { on() {}, removeListener() {} }, eventTypes: {}, generateRaw: () => new Promise(() => {}) }) };
    try {
        const llm = createLlm({ mode: 'current' }, { timeoutMs: 30 });
        await assert.rejects(llm.send('x'), e => e.code === 'NETWORK_TIMEOUT' && e.retryable === false);
        const controller = new AbortController();
        const waiting = createLlm({ mode: 'current' }, { timeoutMs: 10_000 }).send('x', controller.signal);
        controller.abort();
        await assert.rejects(waiting, { name: 'AbortError' });
    } finally {
        delete globalThis.SillyTavern;
    }
});
