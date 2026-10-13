import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createActivationLog } from '../src/activation-log.js';
import { applyKeys } from '../src/entry-keys.js';
import { toRegExp as parseRegex } from './helpers.js';

const ourDragon = String.raw`/(?<![\p{L}\p{N}])дракон\p{L}*/iu`;

function setup({ underReplies = false, chat } = {}) {
    const state = {
        chat: chat ?? [
            { name: 'User', is_user: true, mes: 'Я видел драконами небо и выпил эля' },
        ],
        saves: 0,
    };
    const log = createActivationLog({
        getChat: () => state.chat,
        getGlobals: () => ({ depth: 2, caseSensitive: false, wholeWords: false, includeNames: true }),
        parseRegex,
        getViewerSettings: () => ({ underReplies }),
        saveChat: () => { state.saves++; },
    });
    return { log, state };
}

function dragon(world = 'LL-test', uid = 0) {
    const e = { uid, world, comment: 'Dragon', key: ['dragon'], content: 'Huge reptiles.' };
    applyKeys(e, 'ru', [ourDragon], 'model');
    return e;
}

test('key reason names the word, the readable key and its language', async () => {
    const { log } = setup();
    log.onGenerationStarted('normal');
    await log.onActivated([dragon()]);
    const [item] = log.last.items;
    assert.equal(item.reason.kind, 'key');
    assert.equal(item.reason.readable, 'дракон…');
    assert.equal(item.reason.own, 'ru');
    assert.match(item.reason.fragment, /драконами/);
    assert.equal(item.reason.messageIndex, 0);
});

test('author key is marked as not ours', async () => {
    const { log } = setup({ chat: [{ name: 'User', is_user: true, mes: 'a dragon!' }] });
    await log.onActivated([{ uid: 1, world: 'B', comment: 'D', key: ['dragon'], content: '' }]);
    assert.equal(log.last.items[0].reason.own, false);
});

test('constant, vector, recursion and unknown reasons', async () => {
    const { log } = setup({ chat: [{ name: 'User', is_user: true, mes: 'nothing relevant' }] });
    await log.onActivated([
        { uid: 1, world: 'B', comment: 'Rules', key: [], constant: true, content: 'Elara runs the inn.' },
        { uid: 2, world: 'B', comment: 'Vec', key: ['zzz'], vectorized: true, content: '' },
        { uid: 3, world: 'B', comment: 'Elara', key: ['Elara'], content: '' },
        { uid: 4, world: 'B', comment: 'Odd', key: ['qqq'], content: '' },
    ]);
    assert.deepEqual(log.last.items.map(i => i.reason.kind), ['constant', 'vector', 'recursion', 'unknown']);
});

test('same uid in two lorebooks stays separate', async () => {
    const { log } = setup();
    await log.onActivated([dragon('A', 0), dragon('B', 0)]);
    assert.deepEqual(log.last.items.map(i => i.world), ['A', 'B']);
});

test('quiet generations are not attached to a message', async () => {
    const { log, state } = setup({ underReplies: true });
    log.onGenerationStarted('quiet');
    await log.onActivated([dragon()]);
    state.chat.push({ name: 'Bot', mes: 'reply', extra: {} });
    log.onMessageReceived(1);
    assert.equal(state.chat[1].extra.lorebookLocalizer, undefined);
    assert.equal(log.last, null); // a background run never becomes "the last reply"
});

test('reply gets the activation; a swipe replaces it', async () => {
    const { log, state } = setup({ underReplies: true });
    log.onGenerationStarted('normal');
    await log.onActivated([dragon()]);
    state.chat.push({ name: 'Bot', mes: 'reply', extra: {} });
    log.onMessageReceived(1);
    assert.equal(state.chat[1].extra.lorebookLocalizer.activations.length, 1);
    log.onGenerationStarted('swipe');
    await log.onActivated([dragon(), dragon('B', 5)]);
    log.onMessageReceived(1);
    assert.equal(state.chat[1].extra.lorebookLocalizer.activations.length, 2);
    assert.equal(state.saves, 2);
});

test('nothing is written to the chat when the line under replies is off', async () => {
    const { log, state } = setup({ underReplies: false });
    log.onGenerationStarted('normal');
    await log.onActivated([dragon()]);
    state.chat.push({ name: 'Bot', mes: 'reply', extra: {} });
    log.onMessageReceived(1);
    assert.equal(state.chat[1].extra.lorebookLocalizer, undefined);
    assert.equal(state.saves, 0);
});

test('a reply with no activation does not inherit the previous one', async () => {
    const { log, state } = setup({ underReplies: true });
    log.onGenerationStarted('normal');
    await log.onActivated([dragon()]);
    state.chat.push({ name: 'Bot', mes: 'one', extra: {} });
    log.onMessageReceived(1);
    log.onGenerationStarted('normal');
    state.chat.push({ name: 'Bot', mes: 'two', extra: {} });
    log.onMessageReceived(2);
    assert.equal(state.chat[2].extra.lorebookLocalizer, undefined);
});

test('chat change clears the last activation and subscribers hear about it', async () => {
    const { log } = setup();
    const seen = [];
    log.subscribe(a => seen.push(a ? a.items.length : null));
    await log.onActivated([dragon()]);
    log.onChatChanged();
    assert.equal(log.last, null);
    assert.deepEqual(seen, [1, null]);
});

test('fragment comes from the message that matched, not from its neighbours', async () => {
    const { log } = setup({ chat: [
        { name: 'Bot', mes: 'Добро пожаловать в таверну, путник.' },
        { name: 'User', is_user: true, mes: 'У меня похмелье' },
    ] });
    await log.onActivated([{ uid: 9, world: 'B', comment: 'Hangover', key: ['похмел'], content: '' }]);
    const { reason } = log.last.items[0];
    assert.equal(reason.messageIndex, 1);
    assert.doesNotMatch(reason.fragment, /Добро|путник/);
});
