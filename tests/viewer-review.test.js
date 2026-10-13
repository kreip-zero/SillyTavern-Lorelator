// Regression tests for the review of the activation viewer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createActivationLog } from '../src/activation-log.js';
import { matchEntry } from '../src/wi-match.js';
import { testPhrase } from '../src/phrase-test.js';
import { clampFloat } from '../src/ui/float-position.js';
import { toRegExp as parseRegex } from './helpers.js';

const globals = { depth: 2, caseSensitive: false, wholeWords: false, includeNames: true };

function setup(chat, underReplies = true) {
    const state = { chat, saves: 0 };
    const log = createActivationLog({
        getChat: () => state.chat,
        getGlobals: () => globals,
        parseRegex,
        getViewerSettings: () => ({ underReplies }),
        saveChat: () => { state.saves++; },
        substitute: s => s.replace('{{char}}', 'Лина'),
    });
    return { log, state };
}
const dragon = { uid: 0, world: 'W', comment: 'Dragon', key: ['дракон'], content: '' };

test('a quiet generation does not replace the reply activation or the badge', async () => {
    const { log, state } = setup([{ name: 'U', is_user: true, mes: 'дракон' }]);
    log.onGenerationStarted('normal');
    await log.onActivated([dragon]);
    log.onGenerationStarted('quiet');
    await log.onActivated([{ uid: 5, world: 'W', comment: 'Other', key: ['x'], content: '' }]);
    assert.deepEqual(log.last.items.map(i => i.title), ['Dragon']);
    state.chat.push({ name: 'Bot', mes: 'reply', extra: {} });
    log.onMessageReceived(1, 'normal');
    assert.equal(state.chat[1].extra.lorebookLocalizer.activations.length, 1);
});

test('impersonation and command messages never get an activation', async () => {
    const { log, state } = setup([{ name: 'U', is_user: true, mes: 'дракон' }]);
    log.onGenerationStarted('impersonate');
    await log.onActivated([dragon]);
    state.chat.push({ name: 'Bot', mes: 'sent with /sendas', extra: {} });
    log.onMessageReceived(1, 'command');
    assert.equal(state.chat[1].extra.lorebookLocalizer, undefined);
});

test('only the newest message can receive the activation', async () => {
    const { log, state } = setup([{ name: 'U', is_user: true, mes: 'дракон' }, { name: 'Bot', mes: 'old', extra: {} }, { name: 'U', is_user: true, mes: 'x' }]);
    log.onGenerationStarted('normal');
    await log.onActivated([dragon]);
    log.onMessageReceived(1, 'normal');
    assert.equal(state.chat[1].extra.lorebookLocalizer, undefined);
});

test('a swipe scans without the reply being swiped and stores into the swipe too', async () => {
    const chat = [
        { name: 'U', is_user: true, mes: 'привет' },
        { name: 'Bot', mes: 'Огромный дракон летит', extra: {}, swipe_id: 1, swipe_info: [{ extra: {} }, { extra: {} }] },
    ];
    const { log, state } = setup(chat);
    log.onGenerationStarted('swipe');
    await log.onActivated([dragon]);
    assert.equal(log.last.items[0].reason.kind, 'unknown');
    log.onMessageReceived(1, 'swipe');
    assert.ok(state.chat[1].swipe_info[1].extra.lorebookLocalizer);
});

test('macros in keys are substituted before matching', () => {
    const e = { key: ['{{char}}'], content: '' };
    assert.equal(matchEntry(e, 'Лина улыбается', globals, parseRegex, s => s.replace('{{char}}', 'Лина')).matched, true);
    const r = testPhrase([{ name: 'W', data: { entries: { 0: { uid: 0, comment: 'C', key: ['{{char}}'], content: '' } } } }], 'Лина тут', { ...globals, substitute: s => s.replace('{{char}}', 'Лина') }, parseRegex);
    assert.equal(r.length, 1);
});

test('stored activations are compact: no raw keys, constants keep only lorebook and title', async () => {
    const { log, state } = setup([{ name: 'U', is_user: true, mes: 'дракон' }]);
    log.onGenerationStarted('normal');
    await log.onActivated([dragon, { uid: 1, world: 'W', comment: 'Rules', constant: true, key: [], content: '' }]);
    state.chat.push({ name: 'Bot', mes: 'r', extra: {} });
    log.onMessageReceived(1, 'normal');
    const stored = state.chat[1].extra.lorebookLocalizer;
    assert.equal(stored.activations.length, 1);
    assert.deepEqual(stored.constants, [{ w: 'W', u: 1, t: 'Rules' }]);
    assert.ok(stored.activations.every(a => !('key' in a) && !String(a.r).includes('(?<!')));
    assert.ok(JSON.stringify(stored).length < 300);
});

test('scan depth 0 stays 0 (nothing scanned)', async () => {
    const state = { chat: [{ name: 'U', is_user: true, mes: 'дракон' }] };
    const log = createActivationLog({ getChat: () => state.chat, getGlobals: () => ({ ...globals, depth: 0 }), parseRegex, getViewerSettings: () => ({ underReplies: false }), saveChat: () => {} });
    await log.onActivated([dragon]);
    assert.notEqual(log.last.items[0].reason.kind, 'key');
});

test('floating icon never goes under the top bar, even on a very short screen', () => {
    assert.deepEqual(clampFloat(0, 0, 44, { width: 375, top: 35, bottom: 60 }), { x: 0, y: 35 });
});

test('constants saved with their lorebook come back under it; older counted ones still load', async () => {
    const { expand } = await import('../src/activation-log.js');
    const fresh = expand({ activations: [], constants: [{ w: 'W', u: 1, t: 'Rules' }] });
    assert.deepEqual(fresh.map(i => [i.world, i.title, i.reason.kind]), [['W', 'Rules', 'constant']]);
    const old = expand({ activations: [], constants: 2 });
    assert.equal(old.length, 2);
    assert.equal(old[0].world, '');
});
