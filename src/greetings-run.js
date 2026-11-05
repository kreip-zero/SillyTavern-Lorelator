// Runs one greetings translation: the greetings go in small batches (so progress is real and one long
// answer cannot cut the rest off), then one retry for each greeting the model left out.
// Errors from the connection layer propagate; Cancel returns cancelled.
import { buildGreetingPrompt, checkPreserved, collectGreetings, parseGreetings } from './greetings.js';
import { withRetry } from './retry.js';

const MAX_TOKENS_CAP = 8192;
const MAX_TOKENS_FLOOR = 1024;
// A batch holds a few greetings (names stay consistent between them) but never more than this much text.
const BATCH_ITEMS = 4;
const BATCH_CHARS = 6000;

function batches(items) {
    const out = [];
    let current = [];
    let chars = 0;
    for (const item of items) {
        if (current.length && (current.length >= BATCH_ITEMS || chars + item.text.length > BATCH_CHARS)) {
            out.push(current);
            current = [];
            chars = 0;
        }
        current.push(item);
        chars += item.text.length;
    }
    if (current.length) out.push(current);
    return out;
}

/**
 * @param {{ card: object, lang: string, rules?: string, ids?: Set<string>, llm: { send: Function }, signal?: AbortSignal,
 *   sleep?: Function, onProgress?: (p: { processed: number, total: number }) => void }} options
 *   ids: translate only these greetings ('first', 'alt:<index>'); all when omitted
 * @returns {Promise<{ proposals: { id: string, source: string, translation: string, problems: string[] }[], failed: string[], cancelled: boolean }>}
 */
export async function translateGreetings({ card, lang, rules = '', writeForPlayer = true, ids, llm, signal, sleep, onProgress }) {
    const items = collectGreetings(card).filter(g => !ids || ids.has(g.id));
    if (!items.length) return { proposals: [], failed: [], cancelled: false };

    // Translated text takes more tokens than its characters / 4, so leave room.
    const ask = async batch => {
        const chars = batch.reduce((sum, g) => sum + g.text.length, 0);
        const maxTokens = Math.min(MAX_TOKENS_CAP, Math.max(MAX_TOKENS_FLOOR, Math.ceil(chars / 2)));
        const prompt = buildGreetingPrompt(batch, lang, { rules, writeForPlayer });
        const reply = await withRetry(() => llm.send(prompt, signal, maxTokens), { signal, sleep });
        return parseGreetings(reply, batch.map(g => g.id));
    };

    const translations = new Map();
    let processed = 0;
    try {
        for (const batch of batches(items)) {
            const first = await ask(batch);
            for (const [id, text] of first.ok) translations.set(id, text);
            for (const item of batch.filter(g => first.failed.includes(g.id))) {
                const again = await ask([item]);
                if (again.ok.has(item.id)) translations.set(item.id, again.ok.get(item.id));
            }
            processed += batch.length;
            onProgress?.({ processed, total: items.length });
        }
    } catch (error) {
        if (error?.name === 'AbortError') return { proposals: [], failed: [], cancelled: true };
        throw error;
    }

    const proposals = items.filter(g => translations.has(g.id)).map(g => ({
        id: g.id,
        source: g.text,
        translation: translations.get(g.id),
        problems: checkPreserved(g.text, translations.get(g.id)),
    }));
    return { proposals, failed: items.filter(g => !translations.has(g.id)).map(g => g.id), cancelled: false };
}
