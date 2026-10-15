import { LANGUAGES } from './languages.js';
import { getStemmer } from './stemmers.js';

const MIN_STEM = 4;
// Forms per keyword taken from the model (the prompt asks for one or two).
const MAX_FORMS = 2;
const NOT_WORD_BEFORE = '(?<![\\p{L}\\p{N}])';
const NOT_WORD_AFTER = '(?![\\p{L}\\p{N}])';

/** Too-common words that would fire an entry on almost every message. */
export const STOPWORDS = {
    ru: ['я', 'ты', 'он', 'она', 'оно', 'мы', 'вы', 'они', 'это', 'тот', 'этот', 'дом', 'время', 'человек', 'люди', 'день', 'ночь', 'место', 'дело', 'жизнь', 'мир', 'рука', 'глаз', 'слово', 'раз', 'год', 'вещь', 'путь',
        // Pronouns and adverbs that are never the subject of an entry (models still offered «мой» for «you are mine»).
        'мой', 'моя', 'моё', 'мои', 'твой', 'твоя', 'твоё', 'твои', 'свой', 'своя', 'своё', 'свои', 'его', 'её', 'их', 'внутри', 'внутрь', 'сверху', 'снизу', 'вход', 'войти', 'здесь', 'там', 'тут'],
    uk: ['я', 'ти', 'він', 'вона', 'воно', 'ми', 'ви', 'вони', 'це', 'той', 'цей', 'дім', 'час', 'людина', 'люди', 'день', 'ніч', 'місце', 'справа', 'життя', 'світ', 'рука', 'око', 'слово', 'раз', 'рік'],
    de: ['ich', 'du', 'er', 'sie', 'es', 'wir', 'ihr', 'das', 'der', 'die', 'haus', 'zeit', 'mensch', 'leute', 'tag', 'nacht', 'ort', 'sache', 'leben', 'welt', 'hand', 'auge', 'wort', 'mal', 'jahr', 'ding', 'weg'],
    fr: ['je', 'tu', 'il', 'elle', 'nous', 'vous', 'ils', 'elles', 'ce', 'cela', 'maison', 'temps', 'homme', 'gens', 'jour', 'nuit', 'lieu', 'chose', 'vie', 'monde', 'main', 'oeil', 'mot', 'fois', 'an', 'année', 'chemin'],
    es: ['yo', 'tú', 'él', 'ella', 'nosotros', 'vosotros', 'ellos', 'esto', 'eso', 'casa', 'tiempo', 'hombre', 'gente', 'día', 'noche', 'lugar', 'cosa', 'vida', 'mundo', 'mano', 'ojo', 'palabra', 'vez', 'año', 'camino'],
    pt: ['eu', 'tu', 'ele', 'ela', 'nós', 'vós', 'eles', 'isto', 'isso', 'casa', 'tempo', 'homem', 'gente', 'dia', 'noite', 'lugar', 'coisa', 'vida', 'mundo', 'mão', 'olho', 'palavra', 'vez', 'ano', 'caminho'],
    it: ['io', 'tu', 'lui', 'lei', 'noi', 'voi', 'loro', 'questo', 'quello', 'casa', 'tempo', 'uomo', 'gente', 'giorno', 'notte', 'luogo', 'cosa', 'vita', 'mondo', 'mano', 'occhio', 'parola', 'volta', 'anno', 'strada'],
    pl: ['ja', 'ty', 'on', 'ona', 'ono', 'my', 'wy', 'oni', 'to', 'ten', 'dom', 'czas', 'człowiek', 'ludzie', 'dzień', 'noc', 'miejsce', 'sprawa', 'życie', 'świat', 'ręka', 'oko', 'słowo', 'raz', 'rok', 'rzecz', 'droga'],
    cs: ['já', 'ty', 'on', 'ona', 'ono', 'my', 'vy', 'oni', 'to', 'ten', 'dům', 'čas', 'člověk', 'lidé', 'den', 'noc', 'místo', 'věc', 'život', 'svět', 'ruka', 'oko', 'slovo', 'rok', 'cesta'],
    sk: ['ja', 'ty', 'on', 'ona', 'ono', 'my', 'vy', 'oni', 'to', 'ten', 'dom', 'čas', 'človek', 'ľudia', 'deň', 'noc', 'miesto', 'vec', 'život', 'svet', 'ruka', 'oko', 'slovo', 'rok', 'cesta'],
    id: ['saya', 'aku', 'kamu', 'dia', 'kami', 'kita', 'mereka', 'ini', 'itu', 'rumah', 'waktu', 'orang', 'hari', 'malam', 'tempat', 'hal', 'hidup', 'dunia', 'tangan', 'mata', 'kata', 'kali', 'tahun', 'jalan'],
    hu: ['én', 'te', 'ő', 'mi', 'ti', 'ők', 'ez', 'az', 'ház', 'idő', 'ember', 'emberek', 'nap', 'éjszaka', 'hely', 'dolog', 'élet', 'világ', 'kéz', 'szem', 'szó', 'év', 'út'],
    ja: ['私', '彼', '彼女', 'これ', 'それ', '家', '時間', '人', '日', '夜', '場所', '世界', '手', '目'],
    zh: ['我', '你', '他', '她', '我们', '这', '那', '家', '时间', '人', '天', '夜', '地方', '世界', '手', '眼'],
};
const STOPSETS = Object.fromEntries(Object.entries(STOPWORDS).map(([k, v]) => [k, new Set(v.map(normalize))]));

function normalize(text) {
    return text.toLowerCase().replace(/ё/g, 'е');
}

function escape(text) {
    // '-' is left alone: in 'u' mode an escaped hyphen outside a class is a syntax error.
    return text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

function fuzzYo(escaped) {
    return escaped.replace(/[её]/g, '[её]');
}

// Russian noun case endings, used where "stem + any letters" would be too loose.
const RU_ENDINGS = '(?:а|я|у|ю|ом|ем|ём|е|и|ы|ов|ев|ей|ам|ям|ами|ями|ах|ях|ой|ою|ь|ье|ья|ью|ьи|ьем|ьём|ьев|ьёв|ьям|ьями|ьях|ий|ия|ию|ием|ии|иям|иями|иях)';
// Ukrainian noun case endings for short stems (хат → хати, хатою, хатами, хаті).
const UK_ENDINGS = '(?:а|я|у|ю|і|ї|е|є|о|и|ом|ем|єм|ою|ею|єю|ів|їв|ей|ам|ям|ами|ями|ах|ях|ові|еві|єві|ь|ья|ью|ьї)';
// Ukrainian is measured better with the generic "up to 2 letters": a 3-letter AI stem usually ends before a
// changed consonant (вовк → вов because of вовче), so a fixed ending list misses вовка, зірки.
const SHORT_ENDINGS = { ru: RU_ENDINGS };
// Languages whose 4-5 letter stems take at most 5 more letters (see wordPattern).
const CAPPED_ENDINGS = new Set(['ru', 'uk', 'pl', 'cs', 'de']);

// Fleeting vowel: рынок → рынка (only -ок), отец → отца, ветер → ветра, день → дня (е/ё + к ц н р л).
const RU_FLEETING = /^(.+[^аеёиоуыэюяй])(?:(о)(к)|([её])([кцнрл]))$/;

const LATIN = new Set(['de', 'fr', 'es', 'pt', 'it', 'pl', 'cs', 'sk', 'hu', 'id']);
const FOLD_GROUPS = ['aáàâãäåą', 'eéèêëěę', 'iíìîï', 'oóòôõöő', 'uúùûüűů', 'cçćč', 'nñńň', 'sśš', 'zźżž', 'rř', 'yý', 'lł', 'dď', 'tť'];
const FOLD = new Map(FOLD_GROUPS.flatMap(group => [...group].map(ch => [ch, `[${group}]`])));

function stripAccents(text) {
    return text.normalize('NFD').replace(/\p{M}/gu, '');
}

/** Accent-insensitive letters for Latin-script languages (dragón ≈ dragon, Wölfe ≈ wolf). */
function fold(escaped, lang) {
    return LATIN.has(lang) ? [...escaped].map(ch => FOLD.get(ch) ?? ch).join('') : escaped;
}

function letters(text, lang) {
    return fold(fuzzYo(escape(text)), lang);
}

/**
 * One word → pattern.
 * stem < 3 letters: the exact word; 3 letters: stem + a short ending; longer: stem + any letters.
 */
function wordPattern(word, stem, lang) {
    if (!stem) stem = word;
    if (!word.startsWith(stem)) {
        // Stemmers may drop accents (dragón → dragon): take the word's own prefix instead.
        stem = [...stem].length <= [...word].length && stripAccents(word).startsWith(stripAccents(stem))
            ? [...word].slice(0, [...stem].length).join('')
            : word;
    }
    // A long word cut to a very short stem by the stemmer (cañería → cañ) keeps all but its last two letters.
    // Only for local stemmers: a short AI stem is deliberate (kupiec → kup for kupca). 7+ letters get an open
    // prefix; 6-letter words a closed ending of 1–3 letters, so "parada" never turns into "para…".
    const wordLength = [...word].length;
    // A 4-letter stem left of a 6+ letter word is short too: подоить → подо… caught подойти, трение → трен… caught тренировки.
    const stemLength = [...stem].length;
    const stemmerCutShort = LANGUAGES[lang]?.stem === 'snowball'
        && (stemLength < MIN_STEM || (stemLength === MIN_STEM && wordLength - stemLength >= 2));
    if (stemmerCutShort && wordLength >= 7) stem = [...word].slice(0, wordLength - 2).join('');
    else if (stemmerCutShort && wordLength === 6) {
        const head = [...word].slice(0, 4).join('');
        // A stemmer stem of 4 letters keeps up to 4 (знан + иями); a shorter one up to 3, so comida never catches comisión.
        const ending = stemLength === MIN_STEM ? '\\p{L}{1,4}' : '\\p{L}{1,3}';
        return `(?:${letters(word, lang)}|${letters(head, lang)}${ending})${NOT_WORD_AFTER}`;
    }
    // Portuguese -ão alternates in plurals (dragão → dragões, pães): drop the final nasal vowel.
    if (lang === 'pt' && /[ãõ]$/.test(stem) && [...stem].length > MIN_STEM) stem = stem.slice(0, -1);
    const length = [...stem].length;
    if (length < 3) {
        return `${letters(word, lang)}${NOT_WORD_AFTER}`;
    }
    if (length < MIN_STEM) {
        const ending = SHORT_ENDINGS[lang] ? `${SHORT_ENDINGS[lang]}?` : '\\p{L}{0,2}';
        // The source word itself is listed too: its own ending (змей → зме + й) may not be in RU_ENDINGS.
        const own = word === stem ? '' : `${letters(word, lang)}|`;
        return `(?:${own}${letters(stem, lang)}${ending})${NOT_WORD_AFTER}`;
    }
    const fleeting = lang === 'ru' && stem.match(RU_FLEETING);
    if (fleeting) {
        const [, head] = fleeting;
        const tail = fleeting[3] ?? fleeting[5];
        const open = length <= 5 ? `\\p{L}{0,5}${NOT_WORD_AFTER}` : '\\p{L}*';
        return `(?:${letters(stem, lang)}${open}|${letters(head + tail, lang)}${RU_ENDINGS}${NOT_WORD_AFTER})`;
    }
    // A 4-5 letter stem may add at most 5 letters: член… no longer catches членораздельно. Measured without any
    // recall loss for these languages; Spanish, Slovak and Hungarian lost recall, so they keep the open prefix.
    if (length <= 5 && CAPPED_ENDINGS.has(lang)) return `${letters(stem, lang)}\\p{L}{0,5}${NOT_WORD_AFTER}`;
    return `${letters(stem, lang)}\\p{L}*`;
}

function wholeWordPattern(word, lang) {
    return `${letters(word, lang)}${NOT_WORD_AFTER}`;
}

/**
 * @param {{ text: string, stem?: string }} phrase
 * @param {string} lang
 * @returns {string | null} SillyTavern regex key "/pattern/iu", or null for empty/too-common phrases
 */
export function phraseToKey(phrase, lang) {
    const language = LANGUAGES[lang];
    const text = normalize(String(phrase?.text ?? '').trim());
    if (!language || !text) return null;
    if (STOPSETS[lang]?.has(text)) return null;

    let pattern;
    if (language.stem === 'none') {
        pattern = fuzzYo(escape(text));
    } else {
        const words = text.split(/\s+/);
        let parts;
        if (language.stem === 'snowball') {
            const stem = getStemmer(lang);
            parts = words.map(w => wordPattern(w, stem(w), lang));
        } else if (language.stem === 'prefix') {
            parts = words.map(w => wordPattern(w, w, lang));
        } else {
            const stems = normalize(String(phrase.stem ?? '').trim()).split(/\s+/).filter(Boolean);
            parts = stems.length === words.length
                ? words.map((w, i) => wordPattern(w, stems[i], lang))
                : words.map(w => wholeWordPattern(w, lang));
        }
        pattern = NOT_WORD_BEFORE + parts.join('\\s+');
    }

    try {
        new RegExp(pattern, 'iu');
    } catch {
        return null;
    }
    return `/${pattern}/iu`;
}

function toRegExpSafe(key) {
    const m = key?.match(/^\/([\w\W]+)\/([a-z]*)$/);
    try {
        return m ? new RegExp(m[1], m[2]) : null;
    } catch {
        return null;
    }
}

/**
 * @param {{ text: string, stem?: string, forms?: string[] }[]} phrases
 * @param {string} lang
 * @param {string[]} originalKeys
 * @returns {{ phrase: string, key: string }[]}
 */
export function buildKeys(phrases, lang, originalKeys) {
    const original = new Set((originalKeys ?? []).map(k => normalize(String(k).trim())));
    const seen = new Set();
    const result = [];
    const add = (text, key) => {
        if (!key || seen.has(key)) return;
        seen.add(key);
        result.push({ phrase: text, key });
    };
    for (const phrase of phrases ?? []) {
        const text = String(phrase?.text ?? '').trim();
        // Models sometimes leave an English word ("docks") or mix alphabets in one word ("дocks"):
        // in a language not written in Latin letters such a keyword is noise (the English keys stay anyway).
        if (!LATIN.has(lang) && /\p{Script=Latin}/u.test(text)) continue;
        const mainKey = phraseToKey(phrase, lang);
        // A stopword (or empty text) brings no forms either: "человек" + "человека" would fire everywhere.
        if (!mainKey) continue;
        // A keyword equal to an author key adds no key of its own — unless it has forms: the author's plain key
        // does not catch them (Elara → Elary), and the forms are only skipped when this key covers them.
        const forms = (phrase?.forms ?? []).slice(0, MAX_FORMS);
        if (!original.has(normalize(text)) || forms.length) add(text, mainKey);
        // Extra forms from the model catch fleeting vowels and consonant changes (зірка → зірок, řeka → řece).
        // A form whose key the main keyword already covers adds nothing and is skipped.
        const main = toRegExpSafe(mainKey);
        for (const form of forms) {
            const f = String(form).trim();
            if (!f || main?.test(f) || original.has(normalize(f))) continue;
            add(f, phraseToKey({ text: f }, lang));
        }
    }
    return result;
}
