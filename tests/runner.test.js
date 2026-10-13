import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planLocalization, runLocalization, planMorphology, applyMorphology } from '../src/runner.js';
import { applyKeys, needsLocalization } from '../src/entry-keys.js';
import { outputTokensPerEntry } from '../src/localizer.js';
import { bookWith, entries, fakeIo, fakeLlm, okResponse } from './helpers.js';

const noSleep = async () => {};

test('localizes all entries in batches and backs up once', async () => {
    const io = fakeIo(bookWith(20));
    const llm = fakeLlm(uids => okResponse(uids, 'дракон'));
    const { todo } = planLocalization(await io.load('b'), 'ru', { onlyChanged: false });
    const r = await runLocalization({ name: 'b', lang: 'ru', todo, batchSize: 15, io, llm, sleep: noSleep });
    assert.equal(r.done.length, 20);
    assert.equal(io.backups, 1);
    assert.equal(llm.calls, 2);
    assert.equal(r.cancelled, false);
    assert.ok(io.current.entries[7].key.some(k => k.startsWith('/')));
});

test('estimate is positive and proportional to work', () => {
    const small = planLocalization(bookWith(2), 'ru', { onlyChanged: false }).estimate;
    const big = planLocalization(bookWith(40), 'ru', { onlyChanged: false }).estimate;
    assert.ok(small.inputTokens > 0 && big.inputTokens > small.inputTokens);
    assert.equal(big.outputTokens, 40 * outputTokensPerEntry('ru'));
    assert.equal(planLocalization(bookWith(40), 'uk', { onlyChanged: false }).estimate.outputTokens, 40 * outputTokensPerEntry('uk'));
});

test('failed batch does not stop the rest', async () => {
    let call = 0;
    const llm = fakeLlm(uids => {
        if (call++ < 3) throw new Error('500');
        return okResponse(uids, 'дракон');
    });
    const r = await runLocalization({ name: 'b', lang: 'ru', todo: entries(20), batchSize: 15, io: fakeIo(bookWith(20)), llm, sleep: noSleep });
    assert.equal(r.failed.length, 15);
    assert.equal(r.done.length, 5);
});

test('user edits between load and save are preserved', async () => {
    const io = fakeIo(bookWith(2));
    const llm = fakeLlm(uids => {
        io.mutate(b => { b.entries[0].content = 'edited by user'; });
        return okResponse(uids, 'дракон');
    });
    await runLocalization({ name: 'b', lang: 'ru', todo: entries(2), io, llm, sleep: noSleep });
    assert.equal(io.current.entries[0].content, 'edited by user');
    assert.ok(io.current.entries[0].key.some(k => k.startsWith('/')));
});

test('entry deleted meanwhile is skipped', async () => {
    const io = fakeIo(bookWith(2));
    const llm = fakeLlm(uids => {
        io.mutate(b => { delete b.entries[1]; });
        return okResponse(uids, 'дракон');
    });
    const r = await runLocalization({ name: 'b', lang: 'ru', todo: entries(2), io, llm, sleep: noSleep });
    assert.deepEqual(r.done, [0]);
    assert.equal(io.current.entries[1], undefined);
});

test('onlyChanged picks only changed entries; constants skipped', () => {
    const book = bookWith(4);
    for (const e of Object.values(book.entries)) applyKeys(e, 'ru', ['/x/iu'], 'm');
    book.entries[1].content = 'changed';
    book.entries[4] = { uid: 4, key: ['new'], content: 'new' };
    book.entries[5] = { uid: 5, key: ['c'], content: 'c', constant: true };
    const changed = planLocalization(book, 'ru', { onlyChanged: true });
    assert.deepEqual(changed.todo.map(e => e.uid), [1]);
    const all = planLocalization(book, 'ru', { onlyChanged: false });
    assert.deepEqual(all.todo.map(e => e.uid).sort(), [1, 4]);
    assert.equal(all.skipped, 1);
});

test('review returning null cancels after saving earlier batches', async () => {
    const io = fakeIo(bookWith(20));
    let calls = 0;
    const review = async proposals => {
        if (calls++ > 0) return null;
        assert.ok(proposals[0].phrases.length === proposals[0].keys.length);
        return new Map(proposals.map(p => [p.uid, p.keys]));
    };
    const r = await runLocalization({ name: 'b', lang: 'ru', todo: entries(20), batchSize: 15, io, llm: fakeLlm(uids => okResponse(uids, 'дракон')), review, sleep: noSleep });
    assert.equal(r.done.length, 15);
    assert.equal(r.cancelled, true);
});

test('abort during request cancels without failing entries', async () => {
    const controller = new AbortController();
    const llm = fakeLlm(() => {
        controller.abort();
        throw new DOMException('Aborted', 'AbortError');
    });
    const r = await runLocalization({ name: 'b', lang: 'ru', todo: entries(5), io: fakeIo(bookWith(5)), llm, signal: controller.signal, sleep: noSleep });
    assert.equal(r.cancelled, true);
    assert.deepEqual(r.failed, []);
});

test('entry edited while the model was working stays marked as changed', async () => {
    const io = fakeIo(bookWith(2));
    const llm = fakeLlm(uids => {
        io.mutate(b => { b.entries[0].content = 'edited by user'; });
        return okResponse(uids, 'дракон');
    });
    await runLocalization({ name: 'b', lang: 'ru', todo: structuredClone(entries(2)), io, llm, sleep: noSleep });
    assert.equal(needsLocalization(io.current.entries[0], 'ru'), 'changed');
    assert.equal(needsLocalization(io.current.entries[1], 'ru'), 'ok');
});

test('cancel pressed while a request is running saves nothing from that reply', async () => {
    const controller = new AbortController();
    const io = fakeIo(bookWith(3));
    const llm = fakeLlm(uids => {
        controller.abort();
        return okResponse(uids, 'дракон');
    });
    const r = await runLocalization({ name: 'b', lang: 'ru', todo: entries(3), io, llm, signal: controller.signal, sleep: noSleep });
    assert.equal(r.cancelled, true);
    assert.deepEqual(r.done, []);
    assert.equal(io.saves, 0);
});

test('max tokens scale with batch size and stem mode', async () => {
    const llm = fakeLlm(uids => okResponse(uids, 'дракон'));
    await runLocalization({ name: 'b', lang: 'ru', todo: entries(20), batchSize: 15, io: fakeIo(bookWith(20)), llm, sleep: noSleep });
    assert.ok(llm.maxTokens[0] >= 15 * 250, String(llm.maxTokens[0]));
    assert.ok(llm.maxTokens[1] < llm.maxTokens[0]);
    const uk = fakeLlm(uids => okResponse(uids, 'дракон'));
    await runLocalization({ name: 'b', lang: 'uk', todo: entries(15), batchSize: 15, io: fakeIo(bookWith(15)), llm: uk, sleep: noSleep });
    assert.ok(uk.maxTokens[0] >= 15 * 400);
});

test('entries the model skipped are retried in smaller batches', async () => {
    const llm = fakeLlm(uids => okResponse(uids.filter(u => u < 900).slice(0, 3), 'дракон'));
    const r = await runLocalization({ name: 'b', lang: 'ru', todo: entries(8), batchSize: 8, io: fakeIo(bookWith(8)), llm, sleep: noSleep });
    assert.equal(r.done.length, 8);
    assert.deepEqual(r.failed, []);
});

test('an entry that keeps failing is reported once', async () => {
    const llm = fakeLlm(uids => okResponse(uids.filter(u => u !== 2 && u < 900), 'дракон'));
    const r = await runLocalization({ name: 'b', lang: 'ru', todo: entries(6), batchSize: 6, io: fakeIo(bookWith(6)), llm, sleep: noSleep });
    assert.deepEqual(r.failed, [2]);
    assert.equal(r.done.length, 5);
});

test('max tokens never exceed 8192', async () => {
    const llm = fakeLlm(uids => okResponse(uids, 'дракон'));
    await runLocalization({ name: 'b', lang: 'uk', todo: entries(30), batchSize: 30, io: fakeIo(bookWith(30)), llm, sleep: noSleep });
    assert.ok(llm.maxTokens.every(n => n <= 8192));
});

test('plan reports new and changed counts', () => {
    const book = bookWith(3);
    applyKeys(book.entries[0], 'ru', ['/x/iu'], 'm');
    applyKeys(book.entries[1], 'ru', ['/x/iu'], 'm');
    book.entries[1].content = 'edited';
    const plan = planLocalization(book, 'ru', { onlyChanged: false });
    assert.equal(plan.newCount, 1);
    assert.equal(plan.changedCount, 1);
});

test('the last request error is reported', async () => {
    const llm = fakeLlm(() => { throw new Error('Quota exceeded'); });
    const r = await runLocalization({ name: 'b', lang: 'ru', todo: entries(2), io: fakeIo(bookWith(2)), llm, sleep: noSleep });
    assert.equal(r.lastError.message, 'Quota exceeded');
});

test('entries already in the language get inflection keys without any AI call', async () => {
    const book = { entries: { 0: { uid: 0, key: ['дракон'], content: 'x' }, 1: { uid: 1, key: ['wolf'], content: 'y' } } };
    const io = fakeIo(book);
    const plan = planLocalization(book, 'ru', { onlyChanged: false });
    assert.equal(plan.nativeCount, 1);
    const llm = fakeLlm(uids => okResponse(uids.filter(u => u < 900), 'волк'));
    const r = await runLocalization({ name: 'b', lang: 'ru', todo: plan.todo, io, llm, sleep: noSleep });
    assert.equal(llm.calls, 1);
    // Only listed among the other entries (so the model avoids its words), never sent for keywords.
    assert.ok(!llm.prompts[0].split('</entries>')[0].includes('дракон'));
    assert.match(llm.prompts[0], /<other_entries>\nдракон\n<\/other_entries>/);
    assert.deepEqual(r.done.sort(), [0, 1]);
    assert.ok(io.current.entries[0].key.some(k => k.includes(String.raw`дракон\p{L}*`)));
});

test('half-translated entry keeps both its own word forms and the AI keywords', async () => {
    const io = fakeIo({ entries: { 0: { uid: 0, key: ['дракон', 'dragon'], content: 'x' } } });
    const llm = fakeLlm(uids => okResponse(uids.filter(u => u < 900), 'волк'));
    await runLocalization({ name: 'b', lang: 'ru', todo: Object.values(structuredClone(io.current.entries)), io, llm, sleep: noSleep });
    const keys = io.current.entries[0].key.join(' ');
    assert.ok(keys.includes(String.raw`дракон\p{L}*`));
    assert.match(keys, /волк/);
});

test('empty keyword list counts as done, not failed', async () => {
    const io = fakeIo(bookWith(1));
    const llm = fakeLlm(() => '{"entries":[{"uid":0,"keywords":[]}]}');
    const r = await runLocalization({ name: 'b', lang: 'de', todo: entries(1), io, llm, sleep: noSleep });
    assert.deepEqual(r.done, [0]);
    assert.deepEqual(r.failed, []);
    assert.equal(planLocalization(io.current, 'de', { onlyChanged: false }).todo.length, 0);
});

test('secondary keywords land in keysecondary', async () => {
    const io = fakeIo({ entries: { 0: { uid: 0, key: ['dragon'], keysecondary: ['red'], selective: true, content: 'x' } } });
    const llm = fakeLlm(() => '{"entries":[{"uid":0,"keywords":["дракон"],"secondary_keywords":["красный"]}]}');
    await runLocalization({ name: 'b', lang: 'ru', todo: Object.values(structuredClone(io.current.entries)), io, llm, sleep: noSleep });
    assert.ok(io.current.entries[0].keysecondary.some(k => k.includes('красн')));
});

test('inflection-only pass keeps AI keys and works on Latin languages', () => {
    const book = { entries: { 0: { uid: 0, key: ['Drache'], content: 'x' }, 1: { uid: 1, key: ['wolf'], content: 'y' } } };
    applyKeys(book.entries[1], 'de', [String.raw`/w[oö]lf\p{L}*/iu`], 'model');
    const proposals = planMorphology(book, 'de');
    assert.deepEqual(proposals.map(p => p.uid).sort(), [0, 1]);
    applyMorphology(book, 'de', new Map(proposals.map(p => [p.uid, p.keys])));
    assert.ok(book.entries[0].key.some(k => k.startsWith('/')));
    assert.ok(book.entries[1].key.includes(String.raw`/w[oö]lf\p{L}*/iu`));
    assert.equal(needsLocalization(book.entries[0], 'de'), 'new');
    assert.equal(needsLocalization(book.entries[1], 'de'), 'ok');
});

test('word-forms pass offers only keys in the target script when the script tells them apart', () => {
    const book = { entries: { 0: { uid: 0, key: ['Victoria', 'виктория'], content: 'x' } } };
    const [proposal] = planMorphology(book, 'ru');
    assert.deepEqual(proposal.phrases, ['виктория']);
});

test('other entries are listed as titles; the batch itself and disabled entries are not', async () => {
    const book = { entries: {
        0: { uid: 0, key: ['guts'], comment: 'Guts', content: 'x' },
        1: { uid: 1, key: ['wound'], comment: 'Wounds', content: 'y', extensions: {} },
        2: { uid: 2, key: ['old'], comment: 'Old', content: 'z', disable: true },
    } };
    const llm = fakeLlm(uids => okResponse(uids.filter(u => u < 900), 'кишки'));
    await runLocalization({ name: 'b', lang: 'ru', todo: [book.entries[0]], io: fakeIo(book), llm, sleep: noSleep });
    const others = llm.prompts[0].match(/<other_entries>\n(.*)\n<\/other_entries>/)[1];
    assert.equal(others, 'Wounds');
});
