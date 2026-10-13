import { newStemmer } from '../lib/snowball.js';
import { LANGUAGES } from './languages.js';

const cache = new Map();

/**
 * @param {string} lang
 * @returns {((word: string) => string) | null} null when the language is not stemmed locally
 */
export function getStemmer(lang) {
    const language = LANGUAGES[lang];
    if (language?.stem !== 'snowball') return null;
    if (!cache.has(lang)) {
        const stemmer = newStemmer(language.snowballName);
        cache.set(lang, word => stemmer.stem(word));
    }
    return cache.get(lang);
}
