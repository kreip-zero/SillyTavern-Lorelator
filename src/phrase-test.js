// "Test a phrase": which entries would fire on a piece of text, by keys alone, without generating.
// Probability, timed effects, groups, budget, recursion and vector search are not simulated.
import { ownerLanguage } from './activation-log.js';
import { matchEntry, readableKey } from './wi-match.js';

/**
 * @param {{ name: string, data: { entries: Record<string, object> } }[]} books
 * @param {string} text
 * @param {{ caseSensitive: boolean, wholeWords: boolean, substitute?: (s: string) => string }} globals
 * @param {(s: string) => RegExp | null} parseRegex
 * @returns {{ world: string, uid: number, title: string, reason: object }[]}
 */
export function testPhrase(books, text, globals, parseRegex) {
    const results = [];
    for (const { name, data } of books) {
        for (const entry of Object.values(data?.entries ?? {})) {
            if (entry.disable) continue;
            const title = entry.comment || `#${entry.uid}`;
            if (entry.constant) {
                results.push({ world: name, uid: entry.uid, title, reason: { kind: 'constant' } });
                continue;
            }
            const result = matchEntry(entry, text, globals, parseRegex, globals.substitute);
            if (!result.matched) continue;
            const reason = {
                kind: 'key',
                key: result.primary.key,
                readable: readableKey(result.primary.key, parseRegex),
                own: ownerLanguage(entry, result.primary.key),
                fragment: result.primary.fragment,
            };
            if (result.secondary) reason.secondary = { readable: readableKey(result.secondary.key, parseRegex), fragment: result.secondary.fragment };
            results.push({ world: name, uid: entry.uid, title, reason });
        }
    }
    return results;
}
