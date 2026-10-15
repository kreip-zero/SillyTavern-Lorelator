// Measures how well our keys catch every form of a word, and how often they catch other words.
// Data: UniMorph tables in .eval-data/unimorph/<iso3> (development only).
// Usage: node scripts/eval-morphology.mjs <lang|all> [--sample 1500] [--forms|--forms3|--ceiling] [--verbs] [--source unimorph|pymorphy] [--show 20]
//   --forms  simulate "the AI also gives the genitive singular and nominative plural": the entry
//            gets keys for those forms too (an entry matches when any of its keys matches).
import { readFileSync, existsSync } from 'node:fs';
import { phraseToKey } from '../src/morphology.js';
import { LANGUAGES } from '../src/languages.js';
import { toRegExp } from '../tests/helpers.js';

const ISO3 = { ru: 'rus', uk: 'ukr', de: 'deu', fr: 'fra', es: 'spa', pt: 'por', it: 'ita', pl: 'pol', cs: 'ces', sk: 'slk', hu: 'hun' };
const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i === -1 ? fallback : Number(args[i + 1]); };
const SAMPLE = opt('--sample', 1500);
const SHOW = opt('--show', 20);
const WITH_FORMS = args.includes('--forms') || args.includes('--forms3') || args.includes('--ceiling');
// --forms3: also the genitive plural; --ceiling: every form as a key (upper bound, not shippable).
const FORMS3 = args.includes('--forms3');
const CEILING = args.includes('--ceiling');
// --source pymorphy: OpenCorpora-based dictionaries exported by scripts/export-pymorphy.py (ru, uk).
// --verbs: measure verbs instead of nouns and adjectives (keywords like "трахать", "кончить").
const VERBS = args.includes('--verbs');
const SOURCE = args.includes('--source') ? args[args.indexOf('--source') + 1] : 'unimorph';

function hash(text) {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return h >>> 0;
}

function load(lang) {
    const path = `.eval-data/${SOURCE}/${ISO3[lang]}`;
    if (!existsSync(path)) return null;
    const lemmas = new Map();
    // Every word form of every part of speech (verbs, prepositions too): the pool of possible false hits.
    const anyForms = [];
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
        const [lemma, form, feats] = line.split('\t');
        if (!lemma || !form || !feats || /\s/.test(form)) continue;
        anyForms.push({ lemma, form });
        // Comparative and superlative forms (naj-…-ejší) are separate words for lorebook keys.
        if (!(VERBS ? /^V;/ : /^(N|ADJ);/).test(feats) || /CMPR|SPRL/.test(feats) || /[\s\d]/.test(lemma)) continue;
        // Skip noisy rows whose form does not even start with the lemma's first letter (seen in the ukr table).
        if (form[0].toLowerCase() !== lemma[0].toLowerCase()) continue;
        if (!lemmas.has(lemma)) lemmas.set(lemma, []);
        lemmas.get(lemma).push({ form, feats });
    }
    return { lemmas, anyForms };
}

function commonPrefix(words) {
    let prefix = words[0] ?? '';
    for (const w of words) while (!w.startsWith(prefix)) prefix = prefix.slice(0, -1);
    return prefix;
}

function keysFor(lang, lemma, forms) {
    const lower = lemma.toLowerCase();
    const aiStem = LANGUAGES[lang].stem === 'ai' ? commonPrefix([lower, ...forms.map(f => f.form.toLowerCase())]) : undefined;
    const keys = [phraseToKey({ text: lemma, stem: aiStem }, lang)];
    if (WITH_FORMS) {
        const pick = feats => forms.find(f => f.feats.split(';').includes(feats[0]) && f.feats.split(';').includes(feats[1]))?.form;
        const caseForm = lang === 'hu' ? ['ACC', 'SG'] : ['GEN', 'SG'];
        const wanted = CEILING ? forms.map(f => f.form) : [pick(caseForm), pick(['NOM', 'PL']), ...(FORMS3 ? [pick(['GEN', 'PL'])] : [])];
        for (const extra of wanted) {
            // Built exactly like the extension builds form keys: the form alone, no stem.
            if (extra && extra.toLowerCase() !== lower) keys.push(phraseToKey({ text: extra }, lang));
        }
    }
    return keys.filter(Boolean).map(toRegExp).filter(Boolean);
}

function evaluate(lang) {
    const data = load(lang);
    if (!data) return { lang, error: 'no data' };
    const { lemmas, anyForms } = data;
    const all = [...lemmas.keys()].sort((a, b) => hash(a) - hash(b));
    const sample = all.slice(0, SAMPLE);
    // Hard negatives: forms of other lemmas that start with the same 3 letters (пол → поле, кот → котлета).
    const byPrefix = new Map();
    for (const { lemma: l, form } of anyForms) {
        const p = form.toLowerCase().slice(0, 3);
        if (!byPrefix.has(p)) byPrefix.set(p, []);
        byPrefix.get(p).push({ lemma: l, form });
    }
    let forms = 0, caught = 0, negTests = 0, falseHits = 0, prefixTests = 0, prefixHits = 0;
    const missed = [];
    const false_ = [];
    for (const lemma of sample) {
        const entryForms = lemmas.get(lemma);
        const keys = keysFor(lang, lemma, entryForms);
        if (!keys.length) continue;
        const own = new Set(entryForms.map(f => f.form.toLowerCase()));
        for (const { form, feats } of entryForms) {
            forms++;
            if (keys.some(k => k.test(`и ${form} и`))) caught++;
            else if (missed.length < 400) missed.push(`${lemma} → ${form} (${feats})`);
        }
        const candidates = (byPrefix.get(lemma.toLowerCase().slice(0, 3)) ?? []).filter(c => c.lemma !== lemma);
        for (let i = 0; i < Math.min(40, candidates.length); i++) {
            const other = candidates[(hash(lemma) + i * 7919) % candidates.length].form;
            const low = other.toLowerCase();
            if (own.has(low)) continue;
            // Words that start with the whole keyword (кот → котлета) are counted on their own: often related words.
            if (low.startsWith(lemma.toLowerCase())) {
                prefixTests++;
                if (keys.some(k => k.test(`и ${other} и`))) prefixHits++;
                continue;
            }
            negTests++;
            if (keys.some(k => k.test(`и ${other} и`))) { falseHits++; if (false_.length < 400) false_.push(`${lemma} ~ ${other}`); }
        }
    }
    return {
        lang,
        lemmas: sample.length,
        recall: forms ? caught / forms : 0,
        falseRate: negTests ? falseHits / negTests : 0,
        prefixRate: prefixTests ? prefixHits / prefixTests : 0,
        missed: missed.filter((_, i) => i % Math.max(1, Math.floor(missed.length / SHOW)) === 0).slice(0, SHOW),
        falseExamples: false_.slice(0, SHOW),
    };
}

const target = args[0] ?? 'all';
const langs = target === 'all' ? Object.keys(ISO3) : [target];
for (const lang of langs) {
    const r = evaluate(lang);
    if (r.error) { console.log(`${lang}: ${r.error}`); continue; }
    console.log(`${lang}: lemmas ${r.lemmas}, recall ${(r.recall * 100).toFixed(1)}%, false ${(r.falseRate * 100).toFixed(2)}%, longer words starting with the keyword ${(r.prefixRate * 100).toFixed(1)}%${CEILING ? ' (ceiling: every form)' : FORMS3 ? ' (3 AI forms)' : WITH_FORMS ? ' (2 AI forms)' : ''}`);
    if (langs.length === 1) {
        console.log('  missed:', r.missed.join(' | '));
        console.log('  false:', r.falseExamples.join(' | '));
    }
}
