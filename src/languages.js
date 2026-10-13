/**
 * Supported target languages.
 * forms: the model also gives 1-2 inflected forms per keyword (recall gain measured with
 *       scripts/eval-morphology.mjs --forms, see docs/morphology-eval.md).
 * stem: 'snowball' — stemmed locally with lib/snowball.js;
 *       'ai'       — the model returns stems (no stemmer in the bundle);
 *       'prefix'   — no stemmer and no stems: the word itself is the stem (word + any ending), for languages
 *                    whose nouns hardly inflect and add endings only (Indonesian: pedang → pedangnya, pedang-pedang);
 *       'none'     — no inflection, keys are plain substrings.
 *
 * Bundle check (snowball-stemmers 0.6.0): has russian, german, french, spanish,
 * portuguese, italian, czech, hungarian; lacks polish, ukrainian, slovak.
 */
export const LANGUAGES = {
    ru: { name: 'Russian', stem: 'snowball', snowballName: 'russian', forms: true },
    uk: { name: 'Ukrainian', stem: 'ai', forms: true },
    de: { name: 'German', stem: 'snowball', snowballName: 'german', forms: true },
    fr: { name: 'French', stem: 'snowball', snowballName: 'french' },
    es: { name: 'Spanish', stem: 'snowball', snowballName: 'spanish' },
    pt: { name: 'Portuguese', stem: 'snowball', snowballName: 'portuguese' },
    it: { name: 'Italian', stem: 'snowball', snowballName: 'italian' },
    pl: { name: 'Polish', stem: 'ai', forms: true },
    cs: { name: 'Czech', stem: 'snowball', snowballName: 'czech', forms: true },
    sk: { name: 'Slovak', stem: 'ai' },
    hu: { name: 'Hungarian', stem: 'snowball', snowballName: 'hungarian', forms: true },
    id: { name: 'Indonesian', stem: 'prefix', forms: true },
    ja: { name: 'Japanese', stem: 'none' },
    zh: { name: 'Chinese', stem: 'none' },
};

const REGEX_KEY = /^\/[\w\W]+\/[gimsuy]*$/;
const CYRILLIC = /\p{Script=Cyrillic}/u;
const KANA = /[\p{Script=Hiragana}\p{Script=Katakana}]/u;
const HAN = /\p{Script=Han}/u;
const LATIN = /\p{Script=Latin}/u;

/**
 * Whether a plain keyword is clearly written in `lang`. Only scripts can be told apart reliably,
 * so Latin-script languages always answer false (English and German look alike).
 * @param {string} key
 * @param {string} lang
 */
export function isNativeKey(key, lang) {
    if (REGEX_KEY.test(key) || LATIN.test(key)) return false;
    switch (lang) {
        case 'ru': return CYRILLIC.test(key) && !/[іїєґ]/i.test(key);
        case 'uk': return CYRILLIC.test(key) && !/[ыэъё]/i.test(key);
        case 'ja': return KANA.test(key) || HAN.test(key);
        case 'zh': return HAN.test(key) && !KANA.test(key);
        default: return false;
    }
}

/** @param {string} key */
export function isRegexKey(key) {
    return REGEX_KEY.test(key);
}
