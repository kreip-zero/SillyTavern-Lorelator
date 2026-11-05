// Small pure helpers for the numbers the panel shows (no DOM, no SillyTavern).
import { collectGreetings } from '../greetings.js';

/**
 * @param {{ entries?: object } | null} book
 * @param {{ todo: object[], skipped: number, newCount: number, changedCount: number, nativeCount: number, estimate: { inputTokens: number } }} plan
 *   result of planLocalization()
 * @returns {{ total: number, todo: number, newCount: number, changed: number, native: number, skipped: number, localized: number, tokens: number }}
 */
export function describeBook(book, plan) {
    const total = Object.keys(book?.entries ?? {}).length;
    const todo = plan.todo.length;
    return {
        total,
        todo,
        newCount: plan.newCount,
        changed: plan.changedCount,
        native: plan.nativeCount,
        skipped: plan.skipped,
        localized: Math.max(0, total - todo - plan.skipped),
        tokens: plan.estimate.inputTokens,
    };
}

/** @returns {{ hasFirst: boolean, alternates: number, chars: number }} */
export function describeCard(card) {
    const items = collectGreetings(card);
    return {
        hasFirst: items.some(g => g.id === 'first'),
        alternates: items.filter(g => g.id !== 'first').length,
        chars: items.reduce((sum, g) => sum + g.text.length, 0),
    };
}

/** Number of non-empty lines. */
export function formatLines(text) {
    return String(text ?? '').split('\n').filter(line => line.trim()).length;
}

/** @returns {string} the number with thousands separators; the sentence around it is built in the UI */
export function formatTokens(n) {
    return Math.round(n).toLocaleString('en-US');
}
