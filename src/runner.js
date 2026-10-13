import { applyKeys, authorKeys, authorSecondaryKeys, getOwnKeys, isNativeEntry, needsLocalization } from './entry-keys.js';
import { LANGUAGES, isNativeKey, isRegexKey } from './languages.js';
import { buildPrompt, outputTokensPerEntry, parseResponse } from './localizer.js';
import { buildKeys } from './morphology.js';
import { withRetry } from './retry.js';

// Several providers (DeepSeek and others) reject larger max_tokens.
const MAX_TOKENS_CAP = 8192;
// Small batches still need room: reasoning models think before answering.
const MAX_TOKENS_FLOOR = 2048;
// Entries the model skipped are re-sent in halves at most this many times.
const MAX_SPLIT_DEPTH = 2;
// Languages whose keys can be told from English by script (see isNativeKey).
const SCRIPT_DETECTABLE = new Set(['ru', 'uk', 'ja', 'zh']);

function chunk(items, size) {
    const out = [];
    for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
    return out;
}

function findEntry(book, uid) {
    return Object.values(book?.entries ?? {}).find(e => e.uid === uid);
}

/** The entry as the model sees it: author keys only. Its hash is stored, so later edits show up as changed. */
/** uid → a short title (the entry's comment, or its first key) for every enabled entry. */
function entryTitles(book) {
    const titles = new Map();
    for (const entry of Object.values(book?.entries ?? {})) {
        if (entry.disable) continue;
        const title = String(entry.comment || authorKeys(entry)[0] || '').trim().slice(0, 60);
        if (title) titles.set(entry.uid, title);
    }
    return titles;
}

function snapshot(entry) {
    const seen = { uid: entry.uid, key: authorKeys(entry), comment: entry.comment ?? '', content: entry.content ?? '' };
    const secondary = authorSecondaryKeys(entry);
    if (secondary.length) seen.keysecondary = secondary;
    return seen;
}

/** Inflection keys for the author's keys that are already written in `lang` (no AI needed). */
function nativeKeyPairs(entry, lang, { allPlain = false } = {}) {
    // Without a local stemmer a key would only become an exact-word regex: worse than the plain key.
    if (LANGUAGES[lang]?.stem !== 'snowball') return [];
    const sources = authorKeys(entry).filter(k => !isRegexKey(k) && (allPlain || isNativeKey(k, lang)));
    return buildKeys(sources.map(text => ({ text })), lang, []);
}

function mergePairs(...lists) {
    const seen = new Set();
    return lists.flat().filter(p => !seen.has(p.key) && seen.add(p.key));
}

/**
 * Pick entries that need localization and estimate token usage.
 * @param {{ entries: Record<string, object> }} book
 * @param {string} lang
 * @param {{ onlyChanged: boolean, batchSize?: number }} options
 * @returns {{ todo: object[], skipped: number, newCount: number, changedCount: number, nativeCount: number, estimate: { inputTokens: number, outputTokens: number } }}
 *   nativeCount: entries already in `lang`; they get inflection keys locally and cost no tokens.
 */
export function planLocalization(book, lang, { onlyChanged, batchSize = 15 }) {
    const todo = [];
    let skipped = 0;
    let newCount = 0;
    let changedCount = 0;
    let nativeCount = 0;
    for (const entry of Object.values(book?.entries ?? {})) {
        const state = needsLocalization(entry, lang);
        if (state === 'skip') skipped++;
        else if (state === 'native') { todo.push(entry); nativeCount++; }
        else if (state === 'changed') { todo.push(entry); changedCount++; }
        else if (state === 'new' && !onlyChanged) { todo.push(entry); newCount++; }
    }
    const forAi = todo.filter(e => !isNativeEntry(e, lang));
    const inputTokens = chunk(forAi.map(snapshot), batchSize)
        .reduce((sum, batch) => sum + Math.ceil(buildPrompt(batch, lang).length / 4), 0);
    return { todo, skipped, newCount, changedCount, nativeCount, estimate: { inputTokens, outputTokens: forAi.length * outputTokensPerEntry(lang) } };
}

/**
 * Localize `todo` entries, saving after every batch. Entries already in `lang` are handled locally first.
 * @returns {Promise<{ done: number[], failed: number[], cancelled: boolean, lastError: unknown }>}
 */
export async function runLocalization({ name, lang, todo, batchSize = 15, io, llm, review, signal, onProgress, sleep }) {
    const done = [];
    const failed = [];
    let cancelled = false;
    let lastError = null;
    let backedUp = false;
    let processed = 0;
    const progress = () => onProgress?.({ processed, total: todo.length, failed: failed.length });

    /** Review (optional) and write one batch. Returns false when the user stopped. */
    async function commit(proposals, seen, secondary, model, ai, kept = new Map()) {
        let accepted = new Map(proposals.map(p => [p.uid, p.keys]));
        if (review && proposals.some(p => p.keys.length)) {
            const reviewed = await review(proposals.filter(p => p.keys.length));
            if (reviewed === null) return false;
            for (const [uid, keys] of reviewed) accepted.set(uid, keys);
        }
        if (!accepted.size) return true;
        if (!backedUp) { await io.backup(name); backedUp = true; }
        const fresh = await io.load(name);
        for (const [uid, keys] of accepted) {
            const entry = findEntry(fresh, uid);
            if (!entry) continue;
            const old = kept.get(uid);
            applyKeys(entry, lang, old ? [...new Set([...old.keys, ...keys])] : keys, old?.model ?? model, seen.get(uid), {
                secondary: old?.secondary ?? secondary.get(uid) ?? [],
                ai: old ? true : ai,
            });
            done.push(uid);
        }
        await io.save(name, fresh);
        return true;
    }

    const native = todo.filter(e => isNativeEntry(e, lang));
    const forAi = todo.filter(e => !isNativeEntry(e, lang));

    for (const batch of chunk(native, batchSize)) {
        if (signal?.aborted) { cancelled = true; break; }
        const proposals = batch.map(e => {
            const pairs = nativeKeyPairs(e, lang);
            return { uid: e.uid, comment: e.comment ?? '', phrases: pairs.map(p => p.phrase), keys: pairs.map(p => p.key) };
        });
        const seen = new Map(batch.map(e => [e.uid, snapshot(e)]));
        // Keys an earlier AI run added (and the user paid for) stay.
        const kept = new Map(batch.map(e => [e.uid, e.extensions?.lorebookLocalizer?.[lang]]).filter(([, b]) => b && b.ai !== false));
        if (!(await commit(proposals, seen, new Map(), 'local', false, kept))) { cancelled = true; break; }
        processed += batch.length;
        progress();
    }

    // Keep the expected reply well under the output cap (forms and AI stems make replies longer).
    // Titles of the whole lorebook: the model avoids keywords that belong to another entry.
    const titles = forAi.length && !cancelled ? entryTitles(await io.load(name)) : new Map();
    const fitting = Math.max(1, Math.floor((MAX_TOKENS_CAP * 0.75) / outputTokensPerEntry(lang)));
    const queue = cancelled ? [] : chunk(forAi, Math.min(batchSize, fitting)).map(entries => ({ entries, depth: 0 }));
    while (queue.length) {
        const { entries: batch, depth } = queue.shift();
        if (signal?.aborted) { cancelled = true; break; }
        const uids = batch.map(e => e.uid);
        const seen = new Map(batch.map(e => [e.uid, snapshot(e)]));
        const prompt = buildPrompt([...seen.values()], lang, [...titles].filter(([uid]) => !seen.has(uid)).map(([, title]) => title));
        const maxTokens = Math.min(MAX_TOKENS_CAP, Math.max(MAX_TOKENS_FLOOR, batch.length * outputTokensPerEntry(lang) * 2));

        let reply;
        try {
            reply = await withRetry(() => llm.send(prompt, signal, maxTokens), { signal, sleep });
        } catch (error) {
            if (error?.name === 'AbortError') { cancelled = true; break; }
            console.warn('[Lorelator] batch failed', uids, error);
            lastError = error;
            failed.push(...uids);
            processed += batch.length;
            if (error?.fatal) {
                for (const rest of queue.splice(0)) failed.push(...rest.entries.map(e => e.uid));
                processed = todo.length;
                progress();
                break;
            }
            progress();
            continue;
        }

        // A request that cannot be aborted (current connection) may finish after Cancel.
        if (signal?.aborted) { cancelled = true; break; }

        const parsed = parseResponse(reply, uids);
        // Models sometimes drop entries or cut the reply short: re-send the missing ones in halves.
        let retried = 0;
        if (parsed.failed.length && batch.length > 1 && depth < MAX_SPLIT_DEPTH) {
            const missing = batch.filter(e => parsed.failed.includes(e.uid));
            const half = Math.ceil(missing.length / 2);
            queue.unshift(...chunk(missing, half).map(entries => ({ entries, depth: depth + 1 })));
            retried = missing.length;
        } else {
            failed.push(...parsed.failed);
        }

        const proposals = [];
        const secondary = new Map();
        for (const entry of batch) {
            const phrases = parsed.ok.get(entry.uid);
            if (!phrases) continue;
            // An empty answer means "already in this language": saved with no keys, so it is not asked again.
            const pairs = mergePairs(nativeKeyPairs(entry, lang), buildKeys(phrases, lang, authorKeys(entry)));
            proposals.push({ uid: entry.uid, comment: entry.comment ?? '', phrases: pairs.map(p => p.phrase), keys: pairs.map(p => p.key) });
            const secondaryPhrases = parsed.secondary.get(entry.uid);
            if (secondaryPhrases) secondary.set(entry.uid, buildKeys(secondaryPhrases, lang, authorSecondaryKeys(entry)).map(p => p.key));
        }

        if (!(await commit(proposals, seen, secondary, llm.modelId, true))) { cancelled = true; break; }
        processed += batch.length - retried;
        progress();
    }

    return { done, failed, cancelled, lastError };
}

/**
 * Proposals for the free, AI-less pass: inflection keys for the author's plain keys. For Latin-script
 * languages the script cannot tell English from the target language, so every plain key is offered
 * (the review popup lets the user untick the wrong ones).
 * @returns {{ uid: number, comment: string, phrases: string[], keys: string[] }[]}
 */
export function planMorphology(book, lang) {
    const proposals = [];
    for (const entry of Object.values(book?.entries ?? {})) {
        if (needsLocalization(entry, lang) === 'skip') continue;
        const own = new Set(getOwnKeys(entry, lang));
        const pairs = nativeKeyPairs(entry, lang, { allPlain: !SCRIPT_DETECTABLE.has(lang) }).filter(p => !own.has(p.key));
        if (pairs.length) proposals.push({ uid: entry.uid, comment: entry.comment ?? '', phrases: pairs.map(p => p.phrase), keys: pairs.map(p => p.key) });
    }
    return proposals;
}

/**
 * Add accepted inflection keys, keeping keys an earlier AI run added.
 * @param {{ entries: Record<string, object> }} book mutated in place
 * @param {string} lang
 * @param {Map<number, string[]>} accepted
 * @returns {number[]} uids changed
 */
export function applyMorphology(book, lang, accepted) {
    const changed = [];
    for (const [uid, keys] of accepted) {
        const entry = findEntry(book, uid);
        if (!entry || !keys.length) continue;
        const block = entry.extensions?.lorebookLocalizer?.[lang];
        applyKeys(entry, lang, [...new Set([...(block?.keys ?? []), ...keys])], block?.model ?? 'local', undefined, {
            secondary: block?.secondary ?? [],
            // Blocks from versions before the ai flag were always made by the AI.
            ai: block ? block.ai !== false : false,
        });
        // Adding keys does not change what the entry says: keep its old fingerprint (ok stays ok, changed stays changed).
        if (block) entry.extensions.lorebookLocalizer[lang].hash = block.hash;
        changed.push(uid);
    }
    return changed;
}
