import { test } from 'node:test';
import assert from 'node:assert/strict';
import { translateGreetings } from '../src/greetings-run.js';

const card = { first_mes: 'Hi {{user}}', data: { first_mes: 'Hi {{user}}', alternate_greetings: ['Second', 'Third'] } };
const tag = (id, text) => `<greeting id="${id}">${text}</greeting>`;
const sleep = async () => {};

function fakeLlm(replies) {
    const prompts = [];
    return {
        prompts,
        modelId: 'fake',
        async send(prompt, signal, maxTokens) {
            prompts.push({ prompt, maxTokens });
            const reply = replies.shift();
            if (reply instanceof Error) throw reply;
            return reply;
        },
    };
}

test('translates all greetings in one request', async () => {
    const llm = fakeLlm([[tag('first', 'Привет {{user}}'), tag('alt:0', 'Второе'), tag('alt:1', 'Третье')].join('\n')]);
    const result = await translateGreetings({ card, lang: 'ru', llm, sleep });
    assert.equal(llm.prompts.length, 1);
    assert.deepEqual(result.proposals.map(p => [p.id, p.translation, p.problems]), [
        ['first', 'Привет {{user}}', []],
        ['alt:0', 'Второе', []],
        ['alt:1', 'Третье', []],
    ]);
    assert.deepEqual(result.failed, []);
    assert.ok(llm.prompts[0].maxTokens >= 1024 && llm.prompts[0].maxTokens <= 8192);
});

test('retries a missing greeting alone, once, and reports it failed when still missing', async () => {
    const llm = fakeLlm([tag('first', 'Привет {{user}}') + tag('alt:1', 'Третье'), 'no tags here']);
    const result = await translateGreetings({ card, lang: 'ru', llm, sleep });
    assert.equal(llm.prompts.length, 2);
    assert.match(llm.prompts[1].prompt, /id="alt:0"/);
    assert.doesNotMatch(llm.prompts[1].prompt, /id="first"/);
    assert.deepEqual(result.failed, ['alt:0']);
    assert.equal(result.proposals.length, 2);
});

test('flags a translation that lost a macro', async () => {
    const llm = fakeLlm([[tag('first', 'Привет'), tag('alt:0', 'Второе'), tag('alt:1', 'Третье')].join('')]);
    const { proposals } = await translateGreetings({ card, lang: 'ru', llm, sleep });
    assert.deepEqual(proposals[0].problems, ['macro']);
});

test('rules go into the prompt', async () => {
    const llm = fakeLlm([[tag('first', 'x {{user}}'), tag('alt:0', 'y'), tag('alt:1', 'z')].join('')]);
    await translateGreetings({ card, lang: 'ru', rules: 'Narration in italics.', llm, sleep });
    assert.match(llm.prompts[0].prompt, /Narration in italics\./);
});

test('returns cancelled on abort', async () => {
    const llm = fakeLlm([new DOMException('Aborted', 'AbortError')]);
    const result = await translateGreetings({ card, lang: 'ru', llm, sleep });
    assert.equal(result.cancelled, true);
    assert.deepEqual(result.proposals, []);
});

test('an empty card makes no request', async () => {
    const llm = fakeLlm([]);
    const result = await translateGreetings({ card: { first_mes: '' }, lang: 'ru', llm, sleep });
    assert.equal(llm.prompts.length, 0);
    assert.deepEqual(result, { proposals: [], failed: [], cancelled: false });
});

test('provider errors propagate', async () => {
    const error = Object.assign(new Error('boom'), { retryable: false });
    const llm = fakeLlm([error]);
    await assert.rejects(() => translateGreetings({ card, lang: 'ru', llm, sleep }), /boom/);
});

test('writeForPlayer false reaches the prompt', async () => {
    const llm = fakeLlm([[tag('first', 'x {{user}}'), tag('alt:0', 'y'), tag('alt:1', 'z')].join('')]);
    await translateGreetings({ card, lang: 'ru', writeForPlayer: false, llm, sleep });
    assert.match(llm.prompts[0].prompt, /never speaks, acts, thinks or feels for \{\{user\}\}/);
});

test('ids limit what is translated', async () => {
    const llm = fakeLlm([tag('alt:0', 'Второе')]);
    const result = await translateGreetings({ card, lang: 'ru', ids: new Set(['alt:0']), llm, sleep });
    assert.equal(llm.prompts.length, 1);
    assert.doesNotMatch(llm.prompts[0].prompt, /id="first"/);
    assert.deepEqual(result.proposals.map(p => p.id), ['alt:0']);
});

test('an empty selection makes no request', async () => {
    const llm = fakeLlm([]);
    const result = await translateGreetings({ card, lang: 'ru', ids: new Set(), llm, sleep });
    assert.equal(llm.prompts.length, 0);
    assert.deepEqual(result.proposals, []);
});

test('long greetings go in separate requests and progress is reported after each', async () => {
    const long = 'x'.repeat(5000);
    const big = { first_mes: long, data: { first_mes: long, alternate_greetings: [long, long] } };
    const llm = fakeLlm([tag('first', long), tag('alt:0', long), tag('alt:1', long)]);
    const seen = [];
    const result = await translateGreetings({ card: big, lang: 'ru', llm, sleep, onProgress: p => seen.push([p.processed, p.total]) });
    assert.equal(llm.prompts.length, 3);
    assert.deepEqual(seen, [[1, 3], [2, 3], [3, 3]]);
    assert.equal(result.proposals.length, 3);
});
