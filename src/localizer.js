import { LANGUAGES } from './languages.js';
import { EXAMPLE_ENTRIES, EXAMPLE_KEYWORDS } from './prompt-examples.js';

export const CONTENT_LIMIT = 1500;

/** Expected reply size per entry; stems roughly double the keywords. */
export function outputTokensPerEntry(lang) {
    const language = LANGUAGES[lang];
    return (language?.stem === 'ai' ? 400 : 250) + (language?.forms ? 150 : 0);
}

function entryLine(e) {
    const line = {
        uid: e.uid,
        title: e.comment ?? e.title ?? '',
        keys: e.key ?? e.keys ?? [],
    };
    const secondary = e.keysecondary ?? [];
    if (secondary.length) line.secondary = secondary;
    line.content = String(e.content ?? '').slice(0, CONTENT_LIMIT);
    return JSON.stringify(line);
}

function keywordJson(item, withStem, withForms) {
    if (!withStem && !withForms) return item.t;
    const out = { text: item.t };
    if (withStem) out.stem = item.s ?? item.t;
    if (withForms) out.forms = item.f ?? [];
    return out;
}

// Enough to show what else the lorebook covers without making every request much longer.
const MAX_OTHER_TITLES = 150;

/**
 * Prompt asking the model which words a speaker of `lang` would use for each entry.
 * Layout follows guidance shared by the major model families: the task and its reason first,
 * the data in tags, concrete rules after the data, then a worked example and the exact format.
 * @param {{ uid: number, key: string[], comment?: string, content: string }[]} entries
 * @param {string} lang
 * @param {string[]} [otherTitles] titles of the lorebook's other entries, so keywords do not point at them
 * @returns {string}
 */
export function buildPrompt(entries, lang, otherTitles = []) {
    const language = LANGUAGES[lang];
    const name = language.name;
    const withStem = language.stem === 'ai';
    const withForms = Boolean(language.forms);
    const examples = EXAMPLE_KEYWORDS[lang];

    const rules = [
        '1. Give 4-10 keywords per entry, most useful first.',
        '2. Prefer single words. Matching ignores word endings, but a multi-word phrase only matches when its words appear in exactly that order, so whenever you give a phrase, also give its main word on its own (for example "innkeeper" as well as "innkeeper of the tavern").',
        '3. Cover: the name (established translation and transliteration, if they differ); what a player would call it in plain words; synonyms, colloquial words and slang; things and situations that directly point to it (for example "full moon" for a moon curse). Keep the register of the entry: for violent, sexual or crude topics give the words players really write, explicit and vulgar ones included, never a softer or clinical substitute — these keywords only match text in a fiction game, a missing word leaves the entry silent.',
        '4. Go by what the entry is about, not by a literal translation of its keys.',
        '5. Use the dictionary form of each word. Leave out words so common that they appear in most messages (pronouns, "house", "time", "people", "go"), and words that would fit many other entries of a lorebook just as well ("blood", "wound", "meat", "market", "sell", "party").',
    ];
    rules.push(
        `6. If an entry's keys are already in ${name}, return an empty "keywords" list for it.`,
        '7. If an entry has "secondary" keys (extra words that must also appear for the entry to trigger), also give "secondary_keywords": the same kind of words for those secondary keys.',
    );
    if (withStem) {
        rules.push(`8. For every keyword also give "stem": the same words in the same order, each cut to the part that stays unchanged in all ${name} grammatical forms.`);
    }
    if (withForms) {
        const which = lang === 'hu' ? 'the accusative singular and the plural' : 'the genitive singular and the plural';
        rules.push(language.stem === 'prefix'
            ? `${withStem ? 9 : 8}. For every keyword also give "forms": one or two common derived forms that start differently from the keyword and would be missed by matching its beginning (for example "obat" → "pengobatan", "mengobati"; "sihir" → "penyihir"); an empty list when there are none.`
            : `${withStem ? 9 : 8}. For every keyword also give "forms": one or two other grammatical forms a player is likely to write, preferring ${which}; an empty list when the word does not change.`);
    }
    const others = otherTitles.slice(0, MAX_OTHER_TITLES);
    if (others.length) {
        rules.push(`${rules.length + 1}. The lorebook also has the entries in <other_entries>. Leave out a keyword that is really about one of them (for "Guts", not "wound" when there is a "Wounds" entry): it would trigger the wrong entry.`);
    }

    const exampleAnswer = JSON.stringify({
        entries: EXAMPLE_ENTRIES.map((e, i) => ({ uid: e.uid, keywords: examples[i].map(k => keywordJson(k, withStem, withForms)) })),
    });
    const fields = ['"text":"..."', ...(withStem ? ['"stem":"..."'] : []), ...(withForms ? ['"forms":["..."]'] : [])];
    const format = fields.length > 1
        ? `{"entries":[{"uid":<uid>,"keywords":[{${fields.join(',')}}]}]}`
        : '{"entries":[{"uid":<uid>,"keywords":["..."]}]}';

    return [
        '<task>',
        `A roleplayer writes in ${name}. Each lorebook entry below is inserted into the story only when one of its keywords appears in the player's message, but its keywords are in another language, so the entries never trigger. For every entry, list the ${name} keywords a player would actually type when talking about that subject.`,
        '</task>',
        '',
        '<entries>',
        ...entries.map(entryLine),
        '</entries>',
        '',
        ...(others.length ? ['<other_entries>', others.join('; '), '</other_entries>', ''] : []),
        '<rules>',
        'Based on the entries above:',
        ...rules,
        '</rules>',
        '',
        '<example>',
        ...EXAMPLE_ENTRIES.map(entryLine),
        `Answer: ${exampleAnswer}`,
        '</example>',
        '',
        '<format>',
        `Reply with JSON only, no commentary: ${format}`,
        'Add "secondary_keywords" (same shape as "keywords") only for entries that have "secondary" keys.',
        'Include every uid from <entries> exactly once. Do not include the example uids.',
        '</format>',
    ].join('\n');
}

function extractJson(text) {
    const candidates = [];
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) candidates.push(fenced[1]);
    candidates.push(text);
    const first = text.indexOf('{');
    const last = text.lastIndexOf('}');
    if (first !== -1 && last > first) candidates.push(text.slice(first, last + 1));
    for (const candidate of candidates) {
        try {
            return JSON.parse(candidate.trim());
        } catch {
            // try the next candidate
        }
    }
    return null;
}

/** End index (exclusive) of the JSON object starting at `start`, or -1 if it never closes. */
function objectEnd(text, start) {
    let depth = 0;
    let inString = false;
    for (let i = start; i < text.length; i++) {
        const ch = text[i];
        if (inString) {
            if (ch === '\\') i++;
            else if (ch === '"') inString = false;
        } else if (ch === '"') inString = true;
        else if (ch === '{') depth++;
        else if (ch === '}' && --depth === 0) return i + 1;
    }
    return -1;
}

/** Salvage every complete entry object ({… "uid" …}) from a reply cut off mid-JSON. */
function salvageEntries(text) {
    const entries = [];
    for (let i = text.indexOf('{', 1); i !== -1; i = text.indexOf('{', i + 1)) {
        const end = objectEnd(text, i);
        if (end === -1) continue;
        try {
            const item = JSON.parse(text.slice(i, end));
            if (item && typeof item === 'object' && 'uid' in item) entries.push(item);
        } catch {
            // not a complete entry object
        }
    }
    return entries;
}

function toPhrases(list) {
    return (Array.isArray(list) ? list : [])
        .map(p => (typeof p === 'string' ? { text: p } : p))
        .filter(p => typeof p?.text === 'string' && p.text.trim())
        .map(p => {
            const phrase = { text: p.text };
            if (typeof p.stem === 'string' && p.stem.trim()) phrase.stem = p.stem;
            const rawForms = typeof p.forms === 'string' ? [p.forms] : Array.isArray(p.forms) ? p.forms : [];
            const forms = rawForms.map(f => (typeof f === 'string' ? f : f?.text)).filter(f => typeof f === 'string' && f.trim());
            if (forms.length) phrase.forms = forms;
            return phrase;
        });
}

/**
 * @param {string} text raw model reply
 * @param {number[]} batchUids uids that were sent
 * @returns {{ ok: Map<number, { text: string, stem?: string }[]>, secondary: Map<number, { text: string, stem?: string }[]>, failed: number[] }}
 *   An explicitly empty list is kept: the model says the entry is already in the target language.
 */
export function parseResponse(text, batchUids) {
    const ok = new Map();
    const secondary = new Map();
    // Reasoning models may prepend <think>…</think> containing stray braces.
    const raw = String(text ?? '').replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '');
    const data = extractJson(raw);
    const items = Array.isArray(data?.entries) ? data.entries : salvageEntries(raw);
    const wanted = new Set(batchUids);
    for (const item of items) {
        const uid = Number(item?.uid);
        if (!wanted.has(uid)) continue;
        const list = item.keywords ?? item.phrases;
        if (!Array.isArray(list)) continue;
        const phrases = toPhrases(list);
        // Only a truly empty list means "already in the language"; items of an unknown shape are a failure.
        if (list.length && !phrases.length) continue;
        ok.set(uid, phrases);
        const secondaryList = toPhrases(item.secondary_keywords);
        if (secondaryList.length) secondary.set(uid, secondaryList);
    }
    return { ok, secondary, failed: batchUids.filter(uid => !ok.has(uid)) };
}
