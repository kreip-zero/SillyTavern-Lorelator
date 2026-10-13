import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { backupName, backupFileName, createIo, listBackups, restoreBackup, deleteBackup } from '../src/st-lorebook.js';

/** In-memory SillyTavern: lorebooks, extension settings and the user files API. */
let books, files, settings;
beforeEach(() => {
    books = new Map([['Лор', { entries: { 0: { uid: 0, key: ['a'], content: 'my latest edit' } } }]]);
    files = new Map();
    settings = {};
    globalThis.SillyTavern = {
        getContext: () => ({
            extensionSettings: settings,
            saveSettingsDebounced: () => {},
            getRequestHeaders: () => ({}),
            getWorldInfoNames: () => [...books.keys()],
            loadWorldInfo: async n => books.get(n),
            saveWorldInfo: async (n, d) => { books.set(n, d); },
            updateWorldInfoList: async () => {},
            reloadWorldInfoEditor: () => {},
        }),
    };
    globalThis.fetch = async (url, opts = {}) => {
        const body = opts.body ? JSON.parse(opts.body) : null;
        if (url === '/api/files/upload') {
            // Real SillyTavern answers with a root-relative path: "/user/files/<name>".
            const path = `/user/files/${body.name}`;
            files.set(path, Buffer.from(body.data, 'base64').toString('utf8'));
            return new Response(JSON.stringify({ path }));
        }
        if (url === '/api/files/delete') { files.delete(body.path); return new Response('OK'); }
        if (url === '/api/worldinfo/delete') { books.delete(body.name); return new Response('OK'); }
        if (String(url).startsWith('//')) throw new TypeError('Failed to fetch');
        if (files.has(String(url))) return new Response(files.get(String(url)));
        return new Response('not found', { status: 404 });
    };
});

test('backup name never collides with an existing lorebook', () => {
    const date = new Date(2026, 9, 12, 14, 40, 5);
    const first = backupName('Lore', [], date);
    assert.equal(first, 'Lore.backup-20261012-144005');
    const second = backupName('Lore', ['Lore', first], date);
    assert.notEqual(second, first);
});

test('backup file names are ASCII-only, as SillyTavern requires', () => {
    assert.match(backupFileName('Академия «Прекантацио»', new Date(2026, 9, 12, 14, 40, 5)), /^lorebook-localizer-[a-z0-9]+-20261012-144005\d{3}\.json$/);
});

test('hidden backup goes to a file, not to the lorebook list', async () => {
    await createIo().backup('Лор');
    assert.deepEqual([...books.keys()], ['Лор']);
    assert.equal(files.size, 1);
    const list = listBackups('Лор');
    assert.equal(list.length, 1);
    assert.equal(list[0].kind, 'file');
});

test('visible backup is a lorebook, as before', async () => {
    await createIo({ visible: true }).backup('Лор');
    assert.equal(books.size, 2);
    assert.equal(listBackups('Лор')[0].kind, 'lorebook');
});

test('restore from a file backs up the current state first', async () => {
    await createIo().backup('Лор');
    const [backup] = listBackups('Лор');
    books.get('Лор').entries[0].content = 'my latest edit 2';
    await restoreBackup('Лор', backup.id);
    assert.equal(books.get('Лор').entries[0].content, 'my latest edit');
    assert.equal(listBackups('Лор').length, 2);
    assert.ok([...files.values()].some(text => text.includes('my latest edit 2')));
});

test('delete removes a file backup and a lorebook backup', async () => {
    await createIo().backup('Лор');
    await createIo({ visible: true }).backup('Лор');
    for (const b of listBackups('Лор')) await deleteBackup(b.id);
    assert.equal(listBackups('Лор').length, 0);
    assert.equal(files.size, 0);
    assert.deepEqual([...books.keys()], ['Лор']);
});

test('deleting an unknown file backup leaves the others alone', async () => {
    await createIo().backup('Лор');
    await deleteBackup('file:/user/files/missing.json');
    assert.equal(listBackups('Лор').length, 1);
});
