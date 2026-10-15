// Keeps the last World Info activation and explains each entry: the chat word and key that fired it,
// or why it fired without a key. Fed by SillyTavern events (wired in ui/activation-view.js):
// GENERATION_STARTED → onGenerationStarted, WORLD_INFO_ACTIVATED → onActivated,
// MESSAGE_RECEIVED → onMessageReceived, CHAT_CHANGED → onChatChanged.
import { matchEntry, matchKey, readableKey } from './wi-match.js';

const NS = 'lorebookLocalizer';

// Generation types whose reply message gets the activation (MESSAGE_RECEIVED type; undefined in old versions).
const REPLY_TYPES = new Set([undefined, 'normal', 'swipe', 'regenerate', 'continue']);

/** Recent chat messages an entry is scanned against, newest first, with their chat index. */
function recentMessages(chat, entry, globals, skipLast) {
    const depth = entry.scanDepth ?? globals.depth;
    const out = [];
    // A swipe scans the chat without the reply being swiped (SillyTavern pops it from coreChat).
    for (let i = chat.length - 1 - (skipLast ? 1 : 0); i >= 0 && out.length < depth; i--) {
        const m = chat[i];
        if (!m || m.is_system) continue;
        out.push({ index: i, text: globals.includeNames && m.name ? `${m.name}: ${m.mes ?? ''}` : String(m.mes ?? '') });
    }
    return out;
}

/** Language whose block (from this extension) lists `key`, or false for the author's own key. */
export function ownerLanguage(entry, key) {
    const blocks = entry.extensions?.[NS] ?? {};
    for (const [lang, block] of Object.entries(blocks)) {
        if (block?.keys?.includes(key) || block?.secondary?.includes(key)) return lang;
    }
    return false;
}

/**
 * Why one activated entry fired.
 * @returns {{ kind: string, key?: string, readable?: string, own?: false | string, fragment?: string, messageIndex?: number, secondary?: { readable: string, fragment: string } }}
 */
function explain(entry, others, chat, globals, parseRegex, substitute, skipLast) {
    if (entry.constant) return { kind: 'constant' };
    const messages = recentMessages(chat, entry, globals, skipLast);
    const scan = messages.map(m => m.text).join('\n');
    const result = matchEntry(entry, scan, globals, parseRegex, substitute);
    if (result.matched) {
        const opts = { caseSensitive: entry.caseSensitive ?? globals.caseSensitive, wholeWords: entry.matchWholeWords ?? globals.wholeWords };
        // Cut the fragment from the one message that matched, so it never spans two messages.
        let where = null;
        let fragment = result.primary.fragment;
        for (const m of messages) {
            const hit = matchKey(substitute(result.primary.key).trim(), m.text, opts, parseRegex);
            if (hit.matched) { where = m; fragment = hit.fragment; break; }
        }
        const reason = {
            kind: 'key',
            key: result.primary.key,
            readable: readableKey(result.primary.key, parseRegex),
            own: ownerLanguage(entry, result.primary.key),
            fragment,
            messageIndex: where?.index ?? -1,
        };
        if (result.secondary) reason.secondary = { readable: readableKey(result.secondary.key, parseRegex), fragment: result.secondary.fragment };
        return reason;
    }
    if (entry.vectorized) return { kind: 'vector' };
    const recursion = others.some(other => other !== entry && other.content && matchEntry(entry, other.content, globals, parseRegex, substitute).matched);
    return { kind: recursion ? 'recursion' : 'unknown' };
}

/**
 * Small form saved in the chat file: no raw keys, no message index (it goes stale when messages are
 * deleted), constant entries as bare {world, uid, title} (no reason to keep).
 */
export function compact(items) {
    const activations = [];
    const constants = [];
    for (const { world, uid, title, reason } of items) {
        if (reason.kind === 'constant') { constants.push({ w: world, u: uid, t: title }); continue; }
        const item = { w: world, u: uid, t: title, k: reason.kind };
        if (reason.kind === 'key') {
            item.r = reason.readable;
            item.f = reason.fragment;
            if (reason.own) item.o = reason.own;
            if (reason.secondary) { item.s = reason.secondary.readable; item.sf = reason.secondary.fragment; }
        }
        activations.push(item);
    }
    return { activations, constants };
}

/** Back from the stored form to items the viewer can render. */
export function expand(stored) {
    const items = (stored?.activations ?? []).map(a => ({
        world: a.w ?? a.world ?? '',
        uid: a.u ?? a.uid,
        title: a.t ?? a.title ?? `#${a.u}`,
        reason: a.reason ?? (a.k === 'key'
            ? { kind: 'key', readable: a.r, fragment: a.f, own: a.o ?? false, messageIndex: -1, ...(a.s ? { secondary: { readable: a.s, fragment: a.sf ?? '' } } : {}) }
            : { kind: a.k }),
    }));
    const constants = stored?.constants;
    if (Array.isArray(constants)) {
        for (const c of constants) items.push({ world: c.w ?? '', uid: c.u, title: c.t ?? `#${c.u}`, reason: { kind: 'constant' } });
    } else {
        // Older replies saved only how many there were: the lorebook and titles are gone.
        for (let i = 0; i < (constants ?? 0); i++) items.push({ world: '', uid: -1, title: '', reason: { kind: 'constant' } });
    }
    return items;
}

/**
 * @param {{
 *   getChat: () => object[],
 *   getGlobals: () => { depth: number, caseSensitive: boolean, wholeWords: boolean, includeNames: boolean },
 *   parseRegex: (s: string) => RegExp | null,
 *   getViewerSettings: () => { underReplies: boolean },
 *   saveChat: () => void,
 *   substitute?: (s: string) => string,
 * }} deps
 */
export function createActivationLog({ getChat, getGlobals, parseRegex, getViewerSettings, saveChat, substitute = s => s }) {
    const listeners = new Set();
    const notify = () => { for (const fn of listeners) fn(log.last); };
    let generationType = 'normal';
    /** A background (quiet) generation of another extension is running: its activation is ignored. */
    let quiet = false;
    /** Activation of the running generation, waiting for its message. */
    let pending = null;

    const log = {
        /** @type {{ at: number, items: { world: string, uid: number, title: string, reason: object }[] } | null} */
        last: null,

        subscribe(fn) {
            listeners.add(fn);
            return () => listeners.delete(fn);
        },

        onGenerationStarted(type) {
            if (type === 'quiet') { quiet = true; return; }
            quiet = false;
            generationType = type ?? 'normal';
            pending = null;
            // If no entry fires, SillyTavern sends no event: do not keep showing the previous reply's count.
            log.last = null;
            notify();
        },

        async onActivated(entries) {
            if (quiet) { quiet = false; return; }
            const chat = getChat() ?? [];
            const globals = getGlobals();
            const skipLast = generationType === 'swipe';
            const items = (entries ?? []).map(entry => ({
                world: entry.world ?? '',
                uid: entry.uid,
                title: entry.comment || `#${entry.uid}`,
                reason: explain(entry, entries, chat, globals, parseRegex, substitute, skipLast),
            }));
            log.last = { at: Date.now(), items };
            // Impersonation fills the input box and creates no message.
            pending = generationType === 'impersonate' ? null : log.last;
            notify();
        },

        onMessageReceived(mesId, type) {
            const activation = pending;
            pending = null;
            if (!activation || !REPLY_TYPES.has(type) || !getViewerSettings().underReplies) return;
            const chat = getChat() ?? [];
            if (mesId !== chat.length - 1) return;
            const message = chat[mesId];
            if (!message || message.is_user) return;
            const stored = compact(activation.items);
            message.extra ??= {};
            message.extra[NS] = stored;
            // SillyTavern restores extra from swipe_info when swiping: keep the copy there too.
            const swipe = message.swipe_info?.[message.swipe_id];
            if (swipe) { swipe.extra ??= {}; swipe.extra[NS] = stored; }
            saveChat();
        },

        onChatChanged() {
            log.last = null;
            pending = null;
            quiet = false;
            notify();
        },
    };
    return log;
}
