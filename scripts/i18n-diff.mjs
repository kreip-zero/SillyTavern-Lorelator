// Prints UI strings missing from a locale file and locale keys no longer used.
// Usage: node scripts/i18n-diff.mjs [i18n/ru-ru.json]
import { readFileSync } from 'node:fs';

const localePath = process.argv[2] ?? 'i18n/ru-ru.json';
const locale = JSON.parse(readFileSync(localePath, 'utf8'));
const keys = new Set();
for (const m of readFileSync('src/ui/panel.html', 'utf8').matchAll(/data-i18n="([^"]+)"/g)) keys.add(m[1].replace(/&quot;/g, '"'));
for (const m of ['src/ui/panel.js', 'src/ui/activation-view.js'].map(f => readFileSync(f, 'utf8')).join('\n').matchAll(/\bt`((?:[^`\\]|\\.)*)`/g)) {
    let i = 0;
    keys.add(m[1].replace(/\$\{[^}]*\}/g, () => `\${${i++}}`));
}
console.log('Missing:');
for (const k of keys) if (!Object.hasOwn(locale, k)) console.log(`  ${JSON.stringify(k)}`);
console.log('Stale:');
for (const k of Object.keys(locale)) if (!keys.has(k)) console.log(`  ${JSON.stringify(k)}`);
