// Mirrors SillyTavern's parseRegexFromString (public/scripts/world-info.js).
export function toRegExp(input) {
    if (typeof input !== 'string') return null;
    const match = input.match(/^\/([\w\W]+?)\/([gimsuy]*)$/);
    if (!match) return null;
    let [, pattern, flags] = match;
    if (pattern.match(/(^|[^\\])\//)) return null;
    pattern = pattern.replace('\\/', '/');
    try {
        return new RegExp(pattern, flags);
    } catch {
        return null;
    }
}

export function bookWith(n) {
    const entries = {};
    for (let i = 0; i < n; i++) entries[i] = { uid: i, key: [`thing${i}`], comment: `Thing ${i}`, content: `About thing ${i}` };
    return { entries };
}

export function entries(n) {
    return Object.values(bookWith(n).entries);
}

export function fakeIo(book) {
    const io = {
        current: structuredClone(book),
        backups: 0,
        saves: 0,
        // Like SillyTavern's loadWorldInfo: hands out the live cached object.
        async load() { return io.current; },
        async save(_name, data) { io.saves++; io.current = data; },
        async backup() { io.backups++; return 'backup'; },
        mutate(fn) { fn(io.current); },
    };
    return io;
}

export function fakeLlm(respond) {
    const llm = {
        calls: 0,
        modelId: 'fake',
        maxTokens: [],
        prompts: [],
        async send(prompt, _signal, maxTokens) {
            llm.calls++;
            llm.prompts.push(prompt);
            llm.maxTokens.push(maxTokens);
            const uids = [...prompt.matchAll(/"uid":(\d+)/g)].map(m => Number(m[1]));
            return respond(uids, prompt);
        },
    };
    return llm;
}

export function okResponse(uids, text) {
    return JSON.stringify({ entries: uids.map(uid => ({ uid, phrases: [{ text: `${text}${uid}` }] })) });
}
