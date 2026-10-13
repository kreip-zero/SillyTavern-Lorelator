import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

/** Keys SillyTavern will look up: data-i18n attributes and t`` templates (${expr} → ${n}). */
function usedKeys() {
    const keys = new Set();
    for (const m of read('src/ui/panel.html').matchAll(/data-i18n="([^"]+)"/g)) keys.add(m[1].replace(/&quot;/g, '"'));
    for (const m of (read('src/ui/panel.js') + read('src/ui/activation-view.js')).matchAll(/\bt`((?:[^`\\]|\\.)*)`/g)) {
        let i = 0;
        keys.add(m[1].replace(/\$\{[^}]*\}/g, () => `\${${i++}}`));
    }
    // Error messages from src/errors.js USER_MESSAGES (only the values after ':')
    const errorsContent = read('src/errors.js');
    const userMessagesMatch = errorsContent.match(/const USER_MESSAGES = \{([\s\S]*?)\n\};/);
    if (userMessagesMatch) {
        // Match lines like: 'KEY': 'Value with ${placeholder}',
        // Handle escaped quotes: 'model\'s' should capture "model's"
        for (const m of userMessagesMatch[1].matchAll(/:\s*'((?:[^'\\]|\\.)*)'/gm)) {
            // Unescape the captured string
            const unescaped = m[1].replace(/\\'/g, "'").replace(/\\\\/g, "\\");
            keys.add(unescaped);
        }
    }
    return keys;
}

test('every UI string has a Russian translation', () => {
    const ru = JSON.parse(read('i18n/ru-ru.json'));
    const missing = [...usedKeys()].filter(k => !Object.hasOwn(ru, k));
    assert.deepEqual(missing, []);
});

test('translations keep the same placeholders', () => {
    const ru = JSON.parse(read('i18n/ru-ru.json'));
    for (const [key, value] of Object.entries(ru)) {
        const ph = s => (s.match(/\$\{\d+\}/g) ?? []).sort().join();
        assert.equal(ph(value), ph(key), key);
    }
});

test('manifest registers the Russian locale', () => {
    assert.equal(JSON.parse(read('manifest.json')).i18n?.['ru-ru'], 'i18n/ru-ru.json');
});

test('data-i18n keys contain no ";" (SillyTavern splits keys on it)', () => {
    const bad = [...read('src/ui/panel.html').matchAll(/data-i18n="([^"]+)"/g)].map(m => m[1]).filter(k => k.includes(';'));
    assert.deepEqual(bad, []);
});

test('no stale translations', () => {
    const ru = JSON.parse(read('i18n/ru-ru.json'));
    const used = usedKeys();
    assert.deepEqual(Object.keys(ru).filter(k => !used.has(k)), []);
});
