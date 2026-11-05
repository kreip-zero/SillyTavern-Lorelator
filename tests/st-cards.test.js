import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { greetingsBackupAt, hasGreetingsBackup, listCharacters, readCard, restoreGreetings, saveGreetingsBackup, syncChatGreeting, syncOpenChat, hasChatGreetingBackup, restoreChatGreeting, writeGreetings } from '../src/st-cards.js';

let settings, calls, cards, refreshed;
beforeEach(() => {
    settings = {};
    calls = [];
    refreshed = 0;
    cards = new Map([['Ann.png', { first_mes: 'Hi', data: { first_mes: 'Hi', alternate_greetings: ['A', 'B'] } }]]);
    globalThis.SillyTavern = {
        getContext: () => ({
            extensionSettings: settings,
            saveSettingsDebounced: () => {},
            getRequestHeaders: () => ({}),
            characters: [{ avatar: 'Ann.png', name: 'Ann' }, { avatar: 'Bob.png', name: 'Bob' }],
            getCharacters: async () => { refreshed++; },
        }),
    };
    globalThis.fetch = async (url, opts = {}) => {
        const body = opts.body ? JSON.parse(opts.body) : null;
        calls.push({ url, body });
        if (url === '/api/characters/get') {
            return cards.has(body.avatar_url) ? new Response(JSON.stringify(cards.get(body.avatar_url))) : new Response('no', { status: 404 });
        }
        if (url === '/api/characters/merge-attributes') {
            const { avatar, ...patch } = body;
            const card = cards.get(avatar);
            Object.assign(card, { ...patch, data: { ...card.data, ...patch.data } });
            return new Response('OK');
        }
        return new Response('not found', { status: 404 });
    };
});

test('listCharacters maps context characters', () => {
    assert.deepEqual(listCharacters(), [{ avatar: 'Ann.png', name: 'Ann' }, { avatar: 'Bob.png', name: 'Bob' }]);
});

test('readCard posts avatar_url and returns the card', async () => {
    const card = await readCard('Ann.png');
    assert.equal(card.first_mes, 'Hi');
    assert.deepEqual(calls[0], { url: '/api/characters/get', body: { avatar_url: 'Ann.png' } });
});

test('readCard throws CARD_NOT_FOUND for an unknown card', async () => {
    await assert.rejects(() => readCard('Nope.png'), error => error.code === 'CARD_NOT_FOUND');
});

test('writeGreetings posts merge-attributes with avatar and patch, then refreshes', async () => {
    await writeGreetings('Ann.png', { first_mes: 'Привет', data: { first_mes: 'Привет', alternate_greetings: ['А', 'Б'] } });
    assert.equal(calls[0].url, '/api/characters/merge-attributes');
    assert.equal(calls[0].body.avatar, 'Ann.png');
    assert.equal(cards.get('Ann.png').first_mes, 'Привет');
    assert.equal(refreshed, 1);
});

test('saveGreetingsBackup keeps the first original when called twice', async () => {
    await saveGreetingsBackup('Ann.png', cards.get('Ann.png'));
    await saveGreetingsBackup('Ann.png', { first_mes: 'Привет', data: { alternate_greetings: ['А'] } });
    assert.equal(hasGreetingsBackup('Ann.png'), true);
    assert.equal(settings.lorebookLocalizer.greetingBackups['Ann.png'].first_mes, 'Hi');
});

test('restoreGreetings writes the saved original and clears the backup', async () => {
    await saveGreetingsBackup('Ann.png', cards.get('Ann.png'));
    await writeGreetings('Ann.png', { first_mes: 'Привет', data: { first_mes: 'Привет', alternate_greetings: ['А', 'Б'] } });
    assert.equal(await restoreGreetings('Ann.png'), true);
    assert.equal(cards.get('Ann.png').first_mes, 'Hi');
    assert.deepEqual(cards.get('Ann.png').data.alternate_greetings, ['A', 'B']);
    assert.equal(hasGreetingsBackup('Ann.png'), false);
});

test('restoreGreetings returns false without a backup', async () => {
    assert.equal(await restoreGreetings('Ann.png'), false);
});

test('greetingsBackupAt returns the save time, or null without a backup', async () => {
    assert.equal(greetingsBackupAt('Ann.png'), null);
    await saveGreetingsBackup('Ann.png', cards.get('Ann.png'));
    assert.match(greetingsBackupAt('Ann.png'), /^\d{4}-\d{2}-\d{2}T/);
});

const greetingsOf = (first, alts) => ({ first_mes: first, alternate_greetings: alts });

test('syncChatGreeting replaces the untouched first message and its swipes', () => {
    const chat = [{ is_user: false, mes: 'Hi', swipe_id: 0, swipes: ['Hi', 'A', 'B'] }];
    const changed = syncChatGreeting(chat, greetingsOf('Hi', ['A', 'B']), greetingsOf('Привет', ['А', 'Б']), x => x);
    assert.equal(changed, true);
    assert.equal(chat[0].mes, 'Привет');
    assert.deepEqual(chat[0].swipes, ['Привет', 'А', 'Б']);
});

test('syncChatGreeting follows the chosen swipe', () => {
    const chat = [{ is_user: false, mes: 'A', swipe_id: 1, swipes: ['Hi', 'A'] }];
    syncChatGreeting(chat, greetingsOf('Hi', ['A']), greetingsOf('Привет', ['А']), x => x);
    assert.equal(chat[0].mes, 'А');
});

test('syncChatGreeting compares after macro substitution', () => {
    const chat = [{ is_user: false, mes: 'Hi Max', swipes: ['Hi Max'], swipe_id: 0 }];
    const subst = x => x.replaceAll('{{user}}', 'Max');
    syncChatGreeting(chat, greetingsOf('Hi {{user}}', []), greetingsOf('Привет, {{user}}', []), subst);
    assert.equal(chat[0].mes, 'Привет, Max');
});

test('syncChatGreeting leaves an edited first message alone', () => {
    const chat = [{ is_user: false, mes: 'Hi (edited)' }];
    assert.equal(syncChatGreeting(chat, greetingsOf('Hi', []), greetingsOf('Привет', []), x => x), false);
    assert.equal(chat[0].mes, 'Hi (edited)');
});

test('syncChatGreeting ignores an empty chat or a user first message', () => {
    assert.equal(syncChatGreeting([], greetingsOf('Hi', []), greetingsOf('Привет', []), x => x), false);
    const chat = [{ is_user: true, mes: 'Hi' }];
    assert.equal(syncChatGreeting(chat, greetingsOf('Hi', []), greetingsOf('Привет', []), x => x), false);
});

function openChat(chat, chatId = 'chat-1') {
    const saved = { count: 0, reloaded: 0 };
    const base = globalThis.SillyTavern.getContext();
    globalThis.SillyTavern.getContext = () => ({
        ...base, chat, characterId: 0, groupId: null, substituteParams: x => x, getCurrentChatId: () => chatId,
        saveChat: async () => { saved.count++; }, reloadCurrentChat: async () => { saved.reloaded++; },
    });
    return saved;
}

test('syncOpenChat saves a backup of the first message before changing it, and restoreChatGreeting puts it back', async () => {
    const chat = [{ is_user: false, mes: 'Hi', swipe_id: 0, swipes: ['Hi', 'A'] }];
    const saved = openChat(chat);
    assert.equal(await syncOpenChat('Ann.png', greetingsOf('Hi', ['A']), greetingsOf('Привет', ['А'])), true);
    assert.equal(chat[0].mes, 'Привет');
    assert.equal(saved.count, 1);
    assert.equal(hasChatGreetingBackup('Ann.png'), true);
    assert.equal(await restoreChatGreeting('Ann.png'), true);
    assert.equal(chat[0].mes, 'Hi');
    assert.deepEqual(chat[0].swipes, ['Hi', 'A']);
    assert.equal(hasChatGreetingBackup('Ann.png'), false);
});

test('a second sync keeps the first chat backup', async () => {
    const chat = [{ is_user: false, mes: 'Hi', swipes: ['Hi'], swipe_id: 0 }];
    openChat(chat);
    await syncOpenChat('Ann.png', greetingsOf('Hi', []), greetingsOf('Привет', []));
    await syncOpenChat('Ann.png', greetingsOf('Привет', []), greetingsOf('Здравствуй', []));
    await restoreChatGreeting('Ann.png');
    assert.equal(chat[0].mes, 'Hi');
});

test('no chat backup when nothing changed, and restore returns false without one', async () => {
    const chat = [{ is_user: false, mes: 'edited' }];
    openChat(chat);
    assert.equal(await syncOpenChat('Ann.png', greetingsOf('Hi', []), greetingsOf('Привет', [])), false);
    assert.equal(hasChatGreetingBackup('Ann.png'), false);
    assert.equal(await restoreChatGreeting('Ann.png'), false);
});
