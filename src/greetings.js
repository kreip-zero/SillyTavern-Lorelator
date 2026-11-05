// Greetings translation, pure part: which greetings a card has, the prompt, reading the reply,
// checking that nothing technical got lost, and the card patch to save.
import { LANGUAGES } from './languages.js';

const OPEN = '<greeting id="';
const CLOSE = '</greeting>';

/**
 * @param {{ first_mes?: string, data?: { first_mes?: string, alternate_greetings?: string[] } }} card
 * @returns {{ id: string, text: string }[]} ids: 'first', 'alt:<index>'
 */
export function collectGreetings(card) {
    const items = [];
    const first = card?.first_mes || card?.data?.first_mes;
    if (typeof first === 'string' && first.trim()) items.push({ id: 'first', text: first });
    const alternates = card?.data?.alternate_greetings;
    if (Array.isArray(alternates)) {
        alternates.forEach((text, i) => {
            if (typeof text === 'string' && text.trim()) items.push({ id: `alt:${i}`, text });
        });
    }
    return items;
}

/**
 * @param {{ id: string, text: string }[]} items
 * @param {string} lang key of LANGUAGES
 * @param {{ rules?: string, writeForPlayer?: boolean }} [options] rules: formatting rules (without them the markup
 *   of the source is kept); writeForPlayer false: the translation must not speak or act for {{user}}
 */
export function buildGreetingPrompt(items, lang, { rules = '', writeForPlayer = true } = {}) {
    const name = LANGUAGES[lang]?.name ?? lang;
    const custom = rules.trim();
    const formatRule = custom
        ? '4. Rewrite every greeting so that it follows <format_rules>. The content, the order of events and the meaning stay the same; only the markup changes. Macros and HTML stay as they are.'
        : '4. Keep every markup symbol of the source in the same place: asterisks, underscores, quotes, line breaks, HTML tags, code blocks and comments.';
    return [
        '<task>',
        `Translate the roleplay greetings below into ${name}. Each one is the opening message of a character in a story.`,
        '</task>',
        '',
        '<greetings>',
        ...items.map(g => `${OPEN}${g.id}">${g.text}${CLOSE}`),
        '</greetings>',
        '',
        '<rules>',
        '1. Translate everything; do not add, drop, shorten or reorder anything.',
        '2. Keep names as they are in the source (or their usual transliteration), and keep {{char}}, {{user}} and every other {{macro}} exactly as written.',
        '3. Keep the register of the source: rude, violent or sexual wording stays as rude, violent or sexual; never soften it.',
        formatRule,
        ...(writeForPlayer ? [] : ['5. Exception to rule 1: the translation never speaks, acts, thinks or feels for {{user}}. Remove or rephrase such parts so that the greeting ends on the other character.']),
        '</rules>',
        '',
        ...(custom ? ['<format_rules>', custom, '</format_rules>', ''] : []),
        '<format>',
        `Answer with the translated greetings only, each in the same tag with the same id: ${OPEN}ID">...${CLOSE}. No commentary.`,
        '</format>',
    ].join('\n');
}

/**
 * @param {string} reply
 * @param {string[]} ids
 * @returns {{ ok: Map<string, string>, failed: string[] }}
 */
export function parseGreetings(reply, ids) {
    const text = String(reply ?? '');
    const ok = new Map();
    const failed = [];
    for (const id of ids) {
        const open = text.indexOf(`${OPEN}${id}">`);
        let result = null;
        if (open !== -1) {
            const start = open + `${OPEN}${id}">`.length;
            const next = text.indexOf(OPEN, start);
            const segment = next === -1 ? text.slice(start) : text.slice(start, next);
            const end = segment.lastIndexOf(CLOSE);
            if (end !== -1) result = segment.slice(0, end);
        }
        if (result === null || !result.trim()) failed.push(id);
        else ok.set(id, result);
    }
    return { ok, failed };
}

const same = (a, b) => a.length === b.length && [...a].sort().every((x, i) => x === [...b].sort()[i]);
const macros = s => s.match(/\{\{[^{}]*\}\}/g) ?? [];
const tags = s => (s.match(/<(?!!--)[a-zA-Z][^>]*>/g) ?? []).map(t => t.match(/^<([a-zA-Z0-9-]+)/)[1].toLowerCase());
const count = (s, needle) => s.split(needle).length - 1;

/**
 * @returns {string[]} 'macro', 'html', 'fence', 'comment' for what the translation lost or invented
 */
export function checkPreserved(source, translated) {
    const problems = [];
    if (!same(macros(source), macros(translated))) problems.push('macro');
    if (!same(tags(source), tags(translated))) problems.push('html');
    if (count(source, '```') !== count(translated, '```')) problems.push('fence');
    if (count(source, '<!--') !== count(translated, '<!--')) problems.push('comment');
    return problems;
}

/**
 * @param {{ first_mes?: string, data?: { alternate_greetings?: string[] } }} card
 * @param {Map<string, string>} accepted id → translation
 * @returns {{ first_mes?: string, data: { first_mes?: string, alternate_greetings: string[] } }}
 */
export function applyGreetings(card, accepted) {
    const alternates = [...(card?.data?.alternate_greetings ?? [])].map((text, i) => accepted.get(`alt:${i}`) ?? text);
    const patch = { data: { alternate_greetings: alternates } };
    if (accepted.has('first')) {
        patch.first_mes = accepted.get('first');
        patch.data.first_mes = accepted.get('first');
    }
    return patch;
}
