import { entryHash } from './hash.js';
import { isNativeKey, isRegexKey } from './languages.js';

const NS = 'lorebookLocalizer';

function blocks(entry) {
    return entry.extensions?.[NS] ?? {};
}

function langsOf(entry, lang) {
    const all = blocks(entry);
    return lang ? [lang] : Object.keys(all);
}

/**
 * Primary keys this extension added to the entry.
 * @param {object} entry
 * @param {string} [lang] only this language; all languages when omitted
 * @returns {string[]}
 */
export function getOwnKeys(entry, lang) {
    const all = blocks(entry);
    return langsOf(entry, lang).flatMap(l => all[l]?.keys ?? []);
}

/** Secondary keys this extension added (same rules as getOwnKeys). */
export function getOwnSecondaryKeys(entry, lang) {
    const all = blocks(entry);
    return langsOf(entry, lang).flatMap(l => all[l]?.secondary ?? []);
}

/** The entry's own primary keys, without ours. */
export function authorKeys(entry) {
    const own = new Set(getOwnKeys(entry));
    return (entry.key ?? []).filter(k => !own.has(k));
}

/** The entry's own secondary keys, without ours. */
export function authorSecondaryKeys(entry) {
    const own = new Set(getOwnSecondaryKeys(entry));
    return (entry.keysecondary ?? []).filter(k => !own.has(k));
}

/** Every plain author key is already written in `lang` (by script), so no AI is needed. */
export function isNativeEntry(entry, lang) {
    const plain = authorKeys(entry).filter(k => !isRegexKey(k));
    if (!plain.length || !plain.every(k => isNativeKey(k, lang))) return false;
    // Russian and Ukrainian share most letters, Japanese and Chinese share kanji: require a telltale sign.
    if (lang === 'uk') return plain.some(k => /[іїєґ]/i.test(k));
    if (lang === 'ja') return plain.some(k => /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(k));
    return true;
}

/**
 * Remove our keys (of one language, or all) from the entry and drop their metadata.
 * @returns {object} the same entry
 */
export function removeKeys(entry, lang) {
    // A key two languages both produced stays while the other language still lists it.
    const others = lang ? Object.keys(blocks(entry)).filter(l => l !== lang) : [];
    const stillUsed = new Set(others.flatMap(l => getOwnKeys(entry, l)));
    const stillUsedSecondary = new Set(others.flatMap(l => getOwnSecondaryKeys(entry, l)));
    const own = new Set(getOwnKeys(entry, lang).filter(k => !stillUsed.has(k)));
    const ownSecondary = new Set(getOwnSecondaryKeys(entry, lang).filter(k => !stillUsedSecondary.has(k)));
    entry.key = (entry.key ?? []).filter(k => !own.has(k));
    if (Array.isArray(entry.keysecondary)) entry.keysecondary = entry.keysecondary.filter(k => !ownSecondary.has(k));
    const all = entry.extensions?.[NS];
    if (all) {
        if (lang) delete all[lang];
        if (!lang || Object.keys(all).length === 0) delete entry.extensions[NS];
    }
    return entry;
}

function addMissing(list, keys) {
    const existing = new Set(list);
    return keys.filter(k => !existing.has(k));
}

/**
 * Replace our keys for `lang` and record the entry fingerprint.
 * @param {object} entry
 * @param {string} lang
 * @param {string[]} keys primary keys to add
 * @param {string} model
 * @param {{ key: string[], keysecondary?: string[], comment?: string, content: string }} [seen] the entry as the
 *   model saw it (author keys only); later edits then still show up as 'changed'. Defaults to the entry itself.
 * @param {{ secondary?: string[], ai?: boolean }} [options] secondary keys to add; ai: false for keys made
 *   locally without a model (they do not mark a non-native entry as localized)
 * @returns {object} the same entry
 */
export function applyKeys(entry, lang, keys, model, seen, { secondary = [], ai = true } = {}) {
    removeKeys(entry, lang);
    entry.key ??= [];
    // Keys another language already added are listed in this block too (shared), but never doubled.
    const shared = new Set([...getOwnKeys(entry), ...getOwnSecondaryKeys(entry)]);
    const author = new Set([...authorKeys(entry), ...authorSecondaryKeys(entry)]);
    const added = [...new Set(keys)].filter(k => !author.has(k) || shared.has(k));
    entry.key = [...entry.key, ...addMissing(entry.key, added)];
    const addedSecondary = [...new Set(secondary)].filter(k => !author.has(k) || shared.has(k));
    if (addedSecondary.length) entry.keysecondary = [...(entry.keysecondary ?? []), ...addMissing(entry.keysecondary ?? [], addedSecondary)];
    entry.extensions ??= {};
    entry.extensions[NS] ??= {};
    const block = { keys: added, hash: '', model, ai, at: new Date().toISOString() };
    if (addedSecondary.length) block.secondary = addedSecondary;
    entry.extensions[NS][lang] = block;
    block.hash = seen ? entryHash(seen) : entryHash(entry, [...getOwnKeys(entry), ...getOwnSecondaryKeys(entry)]);
    return entry;
}

/**
 * @returns {'skip' | 'native' | 'new' | 'changed' | 'ok'} 'native': keys are already in `lang`,
 *   so the entry only needs local inflection keys, no AI
 */
export function needsLocalization(entry, lang) {
    if (entry.constant || entry.disable || !(entry.key ?? []).length) return 'skip';
    const native = isNativeEntry(entry, lang);
    const block = blocks(entry)[lang];
    let state;
    if (!block) state = 'new';
    else if (block.ai === false && !native) state = 'new';
    else state = block.hash === entryHash(entry, [...getOwnKeys(entry), ...getOwnSecondaryKeys(entry)]) ? 'ok' : 'changed';
    return state !== 'ok' && native ? 'native' : state;
}
