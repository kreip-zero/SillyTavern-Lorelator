import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activeBooks } from '../src/book-sources.js';

test('collects chat, character (with extra books), persona and global lorebooks once each', () => {
    const names = activeBooks({
        chatLore: 'Chat',
        characters: [{ avatar: 'lina.png', data: { extensions: { world: 'Lina' } } }],
        charLore: [{ name: 'lina', extraBooks: ['Extra', 'Global'] }],
        personaLore: 'Persona',
        globalLore: ['Global'],
    });
    assert.deepEqual(names.sort(), ['Chat', 'Extra', 'Global', 'Lina', 'Persona']);
});

test('group chats include every member', () => {
    const names = activeBooks({
        characters: [
            { avatar: 'a.png', data: { extensions: { world: 'A' } } },
            { avatar: 'b.png', data: { extensions: { world: 'B' } } },
        ],
    });
    assert.deepEqual(names.sort(), ['A', 'B']);
});
