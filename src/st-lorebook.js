// SillyTavern lorebook adapter. Everything comes from SillyTavern.getContext()
// (public/scripts/st-context.js): loadWorldInfo, saveWorldInfo, getWorldInfoNames,
// updateWorldInfoList, reloadWorldInfoEditor, getRequestHeaders.
//
// loadWorldInfo returns the cached object the WI editor mutates in place, so we edit
// that same object: the editor's pending debounced save then writes our keys too
// instead of overwriting them.
//
// Backups are hidden by default: JSON files in the user's files folder (POST /api/files/upload,
// names limited to [A-Za-z0-9_.-]), indexed in extension settings since SillyTavern has no file
// listing. With "visible" they are saved as lorebooks named "<book>.backup-<stamp>", as before.
import { LocalizerError } from './errors.js';
import { entryHash } from './hash.js';

const ctx = () => SillyTavern.getContext();
const NS = 'lorebookLocalizer';

export const BACKUP_MARK = '.backup-';

/** @returns {string[]} */
export function listLorebooks() {
    return ctx().getWorldInfoNames();
}

function stamp(date) {
    const p = n => String(n).padStart(2, '0');
    return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
}

/** Lorebook-style backup name, suffixed when that name is already taken. */
export function backupName(name, existing, date = new Date()) {
    const base = `${name}${BACKUP_MARK}${stamp(date)}`;
    const taken = new Set(existing);
    let candidate = base;
    for (let i = 2; taken.has(candidate); i++) candidate = `${base}-${i}`;
    return candidate;
}

/** File name for a hidden backup; the lorebook name itself lives in the index. */
export function backupFileName(name, date = new Date()) {
    const id = entryHash({ key: [], content: name });
    return `lorebook-localizer-${id}-${stamp(date)}${String(date.getMilliseconds()).padStart(3, '0')}.json`;
}

function backupIndex() {
    const settings = ctx().extensionSettings;
    settings[NS] ??= {};
    settings[NS].backups ??= [];
    return settings[NS].backups;
}

function utf8ToBase64(text) {
    const bytes = new TextEncoder().encode(text);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(binary);
}

async function post(url, body) {
    const response = await fetch(url, { method: 'POST', headers: ctx().getRequestHeaders(), body: JSON.stringify(body) });
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    return response;
}

async function loadBook(name) {
    const book = await ctx().loadWorldInfo(name);
    if (!book?.entries) throw new LocalizerError('LOREBOOK_NOT_FOUND', [name]);
    return book;
}

/**
 * Save a copy of `name` now.
 * @param {string} name
 * @param {{ visible?: boolean }} [options] visible: as a lorebook in SillyTavern's lists
 * @returns {Promise<string>} backup id
 */
export async function makeBackup(name, { visible = false } = {}) {
    const book = await loadBook(name);
    if (visible) {
        const target = backupName(name, listLorebooks());
        await ctx().saveWorldInfo(target, structuredClone(book), true);
        await ctx().updateWorldInfoList();
        return `book:${target}`;
    }
    const at = new Date();
    const response = await post('/api/files/upload', { name: backupFileName(name, at), data: utf8ToBase64(JSON.stringify(book)) });
    const { path } = await response.json();
    backupIndex().push({ book: name, path, at: at.toISOString() });
    ctx().saveSettingsDebounced();
    return `file:${path}`;
}

/**
 * Backups of `name`, newest first.
 * @returns {{ id: string, kind: 'file' | 'lorebook', at: string, label: string }[]}
 */
export function listBackups(name) {
    const fromFiles = backupIndex().filter(b => b.book === name)
        .map(b => ({ id: `file:${b.path}`, kind: 'file', at: b.at, label: new Date(b.at).toLocaleString() }));
    const fromBooks = listLorebooks().filter(n => n.startsWith(name + BACKUP_MARK)).map(n => {
        const m = n.slice(name.length + BACKUP_MARK.length).match(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})?/);
        const at = m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0)).toISOString() : '';
        return { id: `book:${n}`, kind: 'lorebook', at, label: n };
    });
    return [...fromFiles, ...fromBooks].sort((a, b) => b.at.localeCompare(a.at));
}

async function readBackup(id) {
    if (id.startsWith('book:')) return loadBook(id.slice(5));
    // SillyTavern returns "/user/files/<name>"; older entries may lack the leading slash.
    const path = id.slice(5).replace(/^\/*/, '/');
    const response = await fetch(path, { cache: 'no-store' });
    if (!response.ok) throw new LocalizerError('BACKUP_NOT_FOUND');
    return response.json();
}

/** Overwrite `name` with backup `id`, backing up the current state first (same storage as that backup). */
export async function restoreBackup(name, id) {
    const backup = await readBackup(id);
    if (!backup?.entries) throw new LocalizerError('BACKUP_CORRUPTED');
    await makeBackup(name, { visible: id.startsWith('book:') });
    await ctx().saveWorldInfo(name, structuredClone(backup), true);
    ctx().reloadWorldInfoEditor(name);
}

/** Delete backup `id` (a hidden file or a visible backup lorebook). */
export async function deleteBackup(id) {
    if (id.startsWith('book:')) {
        const name = id.slice(5);
        if (!name.includes(BACKUP_MARK)) throw new LocalizerError('NOT_A_BACKUP');
        await post('/api/worldinfo/delete', { name });
        await ctx().updateWorldInfoList();
        return;
    }
    const path = id.slice(5);
    await post('/api/files/delete', { path }).catch(error => {
        if (!String(error.message).includes('404')) throw error;
    });
    const index = backupIndex();
    const at = index.findIndex(b => b.path === path);
    if (at !== -1) index.splice(at, 1);
    ctx().saveSettingsDebounced();
}

/**
 * @param {{ visible?: boolean }} [options] where automatic backups go
 */
export function createIo({ visible = false } = {}) {
    return {
        load: loadBook,
        async save(name, book) {
            await ctx().saveWorldInfo(name, book, true);
            ctx().reloadWorldInfoEditor(name);
        },
        backup: name => makeBackup(name, { visible }),
    };
}
