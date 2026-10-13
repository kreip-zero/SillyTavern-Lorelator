// Keyword quality check with a real model, run by hand in the browser console of SillyTavern
// (F12 → Console, on the SillyTavern page, with the extension installed). It costs a few cents.
// Change MODEL / SOURCE to a provider whose key is saved in SillyTavern (e.g. 'openrouter', 'nanogpt').
// Prints the keywords per entry with and without the titles of the other entries.
(async () => {
    const SOURCE = 'nanogpt';
    const MODEL = 'google/gemini-3.8-flash';
    const LANG = 'ru';
    const L = await import('/scripts/extensions/third-party/SillyTavern-Lorelator/src/localizer.js?v=' + Date.now());
    const entries = [
        { uid: 14, key: ['guts', 'entrails'], comment: 'Guts', content: 'Intestines and organs spilling from a fatal belly wound.' },
        { uid: 19, key: ['orgy'], comment: 'Orgy', content: 'A debaucherous gathering where nobles indulge in group sex, fueled by wine and drugs.' },
        { uid: 23, key: ['cannibal', 'cannibalism'], comment: 'Cannibalism', content: 'Eating human flesh, from starvation or dark ritual.' },
        { uid: 25, key: ['whore', 'slut'], comment: 'Insults', content: 'Crude insults thrown at women of the docks.' },
        { uid: 26, key: ['sex', 'fuck', 'cock', 'pussy'], comment: 'Sex', content: 'Sexual intercourse in the Red Quarter; the locals talk about it crudely and openly.' },
        { uid: 27, key: ['slave', 'collar'], comment: 'Slavery', content: 'Slaves wear iron collars and are sold at the market; owners may beat or use them as they wish.' },
    ];
    const others = ['Wounds', 'Butcher Shop', 'Slave Market', 'Blood Magic', 'Red Quarter', 'The Drunken Pony tavern', 'City Guard'];
    const service = SillyTavern.getContext().ChatCompletionService;
    for (const [label, titles] of [['without other titles', []], ['with other titles', others]]) {
        const prompt = L.buildPrompt(entries, LANG, titles);
        const reply = await service.processRequest({ stream: false, messages: [{ role: 'user', content: prompt }], max_tokens: 6000, model: MODEL, chat_completion_source: SOURCE }, {}, true);
        const parsed = L.parseResponse(reply?.content ?? reply, entries.map(e => e.uid));
        console.log(`--- ${MODEL}, ${label}`);
        for (const [uid, keywords] of parsed.ok) console.log(uid, keywords.map(k => k.text ?? k).join(', '));
        if (parsed.failed.length) console.log('no answer for', parsed.failed, reply);
    }
})();
