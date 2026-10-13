// World Info matching that mirrors SillyTavern (public/scripts/world-info.js, release 1.19):
// WorldInfoBuffer.matchKeys for single keys and the selectiveLogic block of checkWorldInfo
// for secondary keys. Used to explain why an entry fired and to test phrases offline.

const FRAGMENT_CONTEXT = 25;
const FRAGMENT_MAX = 60;

function escapeRegex(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Short piece of `text` around [start, end), cut at spaces, at most FRAGMENT_MAX chars. */
function fragmentAround(text, start, end) {
    if (end - start >= FRAGMENT_MAX) return `${text.slice(start, start + FRAGMENT_MAX - 1)}…`;
    let from = Math.max(0, start - FRAGMENT_CONTEXT);
    let to = Math.min(text.length, end + FRAGMENT_CONTEXT);
    if (from > 0) { const space = text.indexOf(' ', from); if (space !== -1 && space < start) from = space + 1; }
    if (to < text.length) { const space = text.lastIndexOf(' ', to); if (space >= end) to = space; }
    while (to - from > FRAGMENT_MAX - 2) {
        if (start - from > to - end) from++; else to--;
    }
    return `${from > 0 ? '…' : ''}${text.slice(from, to).replace(/\s+/g, ' ')}${to < text.length ? '…' : ''}`;
}

/**
 * Does one key match the text, the way SillyTavern checks it?
 * @param {string} key
 * @param {string} text
 * @param {{ caseSensitive: boolean, wholeWords: boolean }} opts
 * @param {(s: string) => RegExp | null} parseRegex SillyTavern's parseRegexFromString
 * @returns {{ matched: boolean, fragment: string }}
 */
export function matchKey(key, text, opts, parseRegex) {
    const regex = parseRegex(key);
    if (regex) {
        const once = new RegExp(regex.source, regex.flags.replace('g', '').replace('y', ''));
        const m = once.exec(text);
        return m ? { matched: true, fragment: fragmentAround(text, m.index, m.index + m[0].length) } : { matched: false, fragment: '' };
    }
    const haystack = opts.caseSensitive ? text : text.toLowerCase();
    const needle = opts.caseSensitive ? key.trim() : key.trim().toLowerCase();
    if (!needle) return { matched: false, fragment: '' };
    let index = -1;
    if (opts.wholeWords && needle.split(/\s+/).length === 1) {
        // Same pattern and flags as SillyTavern: \W without the u flag treats non-ASCII letters as boundaries.
        const m = new RegExp(`(?:^|\\W)(${escapeRegex(needle)})(?:$|\\W)`).exec(haystack);
        if (m) index = m.index + m[0].indexOf(m[1]);
    } else {
        index = haystack.indexOf(needle);
    }
    return index === -1 ? { matched: false, fragment: '' } : { matched: true, fragment: fragmentAround(text, index, index + needle.length) };
}

function firstMatch(keys, text, opts, parseRegex, substitute) {
    for (const key of keys ?? []) {
        // SillyTavern runs every key through substituteParams ({{char}}, {{user}}…) and trims it.
        const r = matchKey(substitute(key).trim(), text, opts, parseRegex);
        if (r.matched) return { key, fragment: r.fragment };
    }
    return null;
}

/**
 * Would SillyTavern activate this entry on `text` by its keys?
 * @param {object} entry World Info entry
 * @param {string} text scan text
 * @param {{ caseSensitive: boolean, wholeWords: boolean }} globals SillyTavern's global WI settings
 * @param {(s: string) => RegExp | null} parseRegex
 * @param {(s: string) => string} [substitute] SillyTavern's substituteParams (macros)
 * @returns {{ matched: boolean, primary?: { key: string, fragment: string }, secondary?: { key: string, fragment: string } | null, logic: number }}
 */
export function matchEntry(entry, text, globals, parseRegex, substitute = s => s) {
    const opts = {
        caseSensitive: entry.caseSensitive ?? globals.caseSensitive,
        wholeWords: entry.matchWholeWords ?? globals.wholeWords,
    };
    const logic = entry.selectiveLogic ?? 0;
    const primary = firstMatch(entry.key, text, opts, parseRegex, substitute);
    if (!primary) return { matched: false, logic };
    if (!(entry.selective && entry.keysecondary?.length)) return { matched: true, primary, secondary: null, logic };

    const results = entry.keysecondary.map(key => ({ key, ...matchKey(substitute(key).trim(), text, opts, parseRegex) }));
    const hits = results.filter(r => r.matched);
    const hit = hits[0] ? { key: hits[0].key, fragment: hits[0].fragment } : null;
    switch (logic) {
        case 0: return { matched: hits.length > 0, primary, secondary: hit, logic }; // AND_ANY
        case 1: return { matched: hits.length < results.length, primary, secondary: null, logic }; // NOT_ALL
        case 2: return { matched: hits.length === 0, primary, secondary: null, logic }; // NOT_ANY
        case 3: return { matched: hits.length === results.length, primary, secondary: hit, logic }; // AND_ALL
        default: return { matched: false, primary, secondary: null, logic };
    }
}

/** Index of the ')' closing the group that opens at `open`. */
function closingParen(source, open) {
    let depth = 0;
    for (let i = open; i < source.length; i++) {
        if (source[i] === '\\') { i++; continue; }
        if (source[i] === '[') { while (i < source.length && source[i] !== ']') i += source[i] === '\\' ? 2 : 1; continue; }
        if (source[i] === '(') depth++;
        else if (source[i] === ')' && --depth === 0) return i;
    }
    return -1;
}

/** First top-level alternative of a group body "a|b|c". */
function firstAlternative(body) {
    let depth = 0;
    for (let i = 0; i < body.length; i++) {
        if (body[i] === '\\') { i++; continue; }
        if (body[i] === '(') depth++;
        else if (body[i] === ')') depth--;
        else if (body[i] === '|' && depth === 0) return body.slice(0, i);
    }
    return body;
}

/**
 * A key as a person would read it. Keys made by this extension are shown as their word with "…"
 * for the flexible ending; other regex keys are shown as their pattern; plain keys as they are.
 * @param {string} key
 * @param {(s: string) => RegExp | null} parseRegex
 */
export function readableKey(key, parseRegex) {
    const regex = parseRegex(key);
    if (!regex) return key;
    let source = regex.source;
    if (!source.startsWith('(?<![\\p{L}\\p{N}])')) return source;
    source = source.replaceAll('(?<![\\p{L}\\p{N}])', '').replaceAll('(?![\\p{L}\\p{N}])', '');
    for (let open = source.indexOf('(?:'); open !== -1; open = source.indexOf('(?:')) {
        const close = closingParen(source, open);
        if (close === -1) break;
        const optional = source[close + 1] === '?';
        // An optional ending group means the word can go on: show it as "…".
        const replacement = optional ? '…' : firstAlternative(source.slice(open + 3, close));
        source = source.slice(0, open) + replacement + source.slice(close + (optional ? 2 : 1));
    }
    return source
        .replace(/\\p\{L\}(\*|\{\d*,?\d*\})/g, '…')
        .replace(/\\s\+/g, ' ')
        .replace(/\[([^\]])[^\]]*\]/g, '$1')
        .replace(/\\(.)/g, '$1')
        .replace(/[её]/g, 'е')
        .replace(/…+/g, '…');
}
