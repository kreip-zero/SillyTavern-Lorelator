// Compares two key sets of one lorebook on a real chat: which entries fire, scan window by scan window.
// Usage: node scripts/compare-on-chat.mjs <lorebook.json> <chat.jsonl> <new-keys.json> [depth]
// new-keys.json: { "<uid>": { "k": [keys...], "s": [secondary keys...] | null } } (the localized keys of a fresh run).
// Only keys and secondary logic are simulated (no recursion, probability or timed effects).
import { readFileSync } from 'node:fs';
import { matchEntry } from '../src/wi-match.js';

const [bookPath, chatPath, newPath, depthArg] = process.argv.slice(2);
const depth = Number(depthArg ?? 2);
const book = JSON.parse(readFileSync(bookPath, 'utf8'));
const fresh = JSON.parse(readFileSync(newPath, 'utf8'));
const messages = readFileSync(chatPath, 'utf8').trim().split('\n').slice(1).map(l => JSON.parse(l)).map(m => m.mes ?? '');
const parseRegex = s => { const m = String(s).match(/^\/([\s\S]+)\/([a-z]*)$/); try { return m ? new RegExp(m[1], m[2]) : null; } catch { return null; } };
const isRx = k => /^\/[\s\S]+\/[a-z]*$/.test(k);
const globals = { caseSensitive: false, wholeWords: true };

const entries = Object.values(book.entries).filter(e => !e.disable && !e.constant);
const variants = {
    'English keys only': e => ({ ...e, key: e.key.filter(k => !isRx(k)), keysecondary: (e.keysecondary ?? []).filter(k => !isRx(k)) }),
    'old localization': e => e,
    'new localization': e => {
        const own = e.key.filter(k => !isRx(k));
        const ownSec = (e.keysecondary ?? []).filter(k => !isRx(k));
        const n = fresh[e.uid];
        return n ? { ...e, key: [...own, ...n.k], keysecondary: [...ownSec, ...(n.s ?? [])] } : { ...e, key: own, keysecondary: ownSec };
    },
};

for (const [name, make] of Object.entries(variants)) {
    let total = 0;
    const perWindow = [];
    const counts = new Map();
    for (let i = 1; i < messages.length; i++) {
        const text = messages.slice(Math.max(0, i - depth + 1), i + 1).join('\n');
        const fired = entries.map(make).filter(e => matchEntry(e, text, globals, parseRegex).matched);
        total += fired.length;
        perWindow.push(fired.length);
        for (const e of fired) counts.set(e.comment, (counts.get(e.comment) ?? 0) + 1);
    }
    const top = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([c, n]) => `${c} ×${n}`).join(', ');
    console.log(`${name}: ${total} activations over ${perWindow.length} windows (avg ${(total / perWindow.length).toFixed(1)}, max ${Math.max(...perWindow)})\n  most frequent: ${top}\n`);
}
