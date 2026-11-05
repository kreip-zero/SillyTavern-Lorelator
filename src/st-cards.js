// SillyTavern character card adapter for greetings: read a card, write the greeting fields back,
// and keep the first original so it can be restored. Uses SillyTavern.getContext() and the
// /api/characters endpoints (get, merge-attributes).
import { LocalizerError } from './errors.js';

const ctx = () => SillyTavern.getContext();
const NS = 'lorebookLocalizer';

/** @returns {{ avatar: string, name: string }[]} */
export function listCharacters() {
    return (ctx().characters ?? []).map(c => ({ avatar: c.avatar, name: c.name }));
}

async function post(url, body) {
    const response = await fetch(url, { method: 'POST', headers: ctx().getRequestHeaders(), body: JSON.stringify(body) });
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    return response;
}

/** @returns {Promise<object>} the card as SillyTavern stores it */
export async function readCard(avatar) {
    try {
        return await (await post('/api/characters/get', { avatar_url: avatar })).json();
    } catch (error) {
        throw new LocalizerError('CARD_NOT_FOUND', [avatar], error);
    }
}

/** @param {object} patch { first_mes?, data: { first_mes?, alternate_greetings } } */
export async function writeGreetings(avatar, patch) {
    await post('/api/characters/merge-attributes', { avatar, ...patch });
    await ctx().getCharacters?.();
}

function backups() {
    const settings = ctx().extensionSettings;
    settings[NS] ??= {};
    settings[NS].greetingBackups ??= {};
    return settings[NS].greetingBackups;
}

export function hasGreetingsBackup(avatar) {
    return Boolean(backups()[avatar]);
}

/** @returns {string | null} ISO time of the saved original greetings */
export function greetingsBackupAt(avatar) {
    return backups()[avatar]?.at ?? null;
}

/** Keeps only the first original: a second run must not overwrite it with an earlier translation. */
export async function saveGreetingsBackup(avatar, card) {
    const all = backups();
    if (all[avatar]) return;
    all[avatar] = {
        first_mes: card.first_mes ?? card.data?.first_mes ?? '',
        alternate_greetings: [...(card.data?.alternate_greetings ?? [])],
        at: new Date().toISOString(),
    };
    ctx().saveSettingsDebounced();
}

/** @returns {Promise<boolean>} false when there is no backup */
export async function restoreGreetings(avatar) {
    const saved = backups()[avatar];
    if (!saved) return false;
    await writeGreetings(avatar, { first_mes: saved.first_mes, data: { first_mes: saved.first_mes, alternate_greetings: saved.alternate_greetings } });
    delete backups()[avatar];
    ctx().saveSettingsDebounced();
    return true;
}

/**
 * A chat keeps its own copy of the greeting (message 0 and its swipes), so editing the card never
 * changes a chat that already exists. This swaps the old greeting texts for the new ones in that
 * chat, but only where the text still equals the old greeting: a message the user edited stays.
 * @param {object[]} chat
 * @param {{ first_mes: string, alternate_greetings: string[] }} before
 * @param {{ first_mes: string, alternate_greetings: string[] }} after
 * @param {(text: string) => string} subst macro substitution SillyTavern applied when it made the chat
 * @returns {boolean} whether anything changed
 */
export function syncChatGreeting(chat, before, after, subst) {
    const first = chat?.[0];
    if (!first || first.is_user) return false;
    const list = g => [g.first_mes ?? '', ...(g.alternate_greetings ?? [])];
    const oldTexts = list(before).map(subst);
    const newTexts = list(after).map(subst);
    const swap = text => {
        const i = oldTexts.indexOf(text);
        return i >= 0 && newTexts[i] !== undefined && newTexts[i] !== '' ? newTexts[i] : text;
    };
    let changed = false;
    if (Array.isArray(first.swipes)) {
        first.swipes = first.swipes.map(text => {
            const next = swap(text);
            if (next !== text) changed = true;
            return next;
        });
        const shown = first.swipes[first.swipe_id ?? 0];
        if (changed && shown !== undefined && oldTexts.includes(first.mes)) first.mes = shown;
    }
    if (!changed) {
        const next = swap(first.mes);
        if (next !== first.mes) {
            first.mes = next;
            changed = true;
        }
    }
    return changed;
}

function chatBackups() {
    const settings = ctx().extensionSettings;
    settings[NS] ??= {};
    settings[NS].chatGreetingBackups ??= {};
    return settings[NS].chatGreetingBackups;
}

/** The open chat, when it belongs to this character (not a group chat). */
function openChatOf(avatar) {
    const c = ctx();
    if (c.groupId || c.characters?.[c.characterId]?.avatar !== avatar || !Array.isArray(c.chat)) return null;
    return { c, key: `${avatar}|${c.getCurrentChatId?.() ?? ''}` };
}

/** @returns {boolean} whether the open chat of this character has a saved original first message */
export function hasChatGreetingBackup(avatar) {
    const open = openChatOf(avatar);
    return Boolean(open && chatBackups()[open.key]);
}

/**
 * Applies syncChatGreeting to the open chat when it belongs to this character. Before the first change the
 * chat's own first message (text and swipes) is saved, so a bad translation can be undone.
 * @returns {Promise<boolean>}
 */
export async function syncOpenChat(avatar, before, after) {
    const open = openChatOf(avatar);
    if (!open) return false;
    const { c, key } = open;
    const subst = text => c.substituteParams?.(text) ?? text;
    if (!syncChatGreeting(structuredClone(c.chat.slice(0, 1)), before, after, subst)) return false;
    const backups = chatBackups();
    if (!backups[key]) {
        const { mes, swipes, swipe_id } = c.chat[0];
        backups[key] = structuredClone({ mes, swipes, swipe_id, at: new Date().toISOString() });
        c.saveSettingsDebounced?.();
    }
    syncChatGreeting(c.chat, before, after, subst);
    await c.saveChat?.();
    await c.reloadCurrentChat?.();
    return true;
}

/** Puts the saved original first message back into the open chat. @returns {Promise<boolean>} false without a backup */
export async function restoreChatGreeting(avatar) {
    const open = openChatOf(avatar);
    const saved = open && chatBackups()[open.key];
    if (!saved || !open.c.chat[0]) return false;
    const first = open.c.chat[0];
    first.mes = saved.mes;
    if (saved.swipes) first.swipes = saved.swipes; else delete first.swipes;
    if (saved.swipe_id !== undefined) first.swipe_id = saved.swipe_id;
    delete chatBackups()[open.key];
    open.c.saveSettingsDebounced?.();
    await open.c.saveChat?.();
    await open.c.reloadCurrentChat?.();
    return true;
}
