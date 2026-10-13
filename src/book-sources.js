// Lorebooks SillyTavern scans in the current chat, gathered the way world-info.js does it:
// chat lore, each character's own book plus its "additional lorebooks" (charLore, keyed by the
// avatar file name without extension), the persona lorebook and the global selection.

/**
 * @param {{ chatLore?: string, characters?: { avatar?: string, data?: object }[], charLore?: { name: string, extraBooks?: string[] }[],
 *   personaLore?: string, globalLore?: string[] }} sources
 * @returns {string[]}
 */
export function activeBooks({ chatLore, characters = [], charLore = [], personaLore, globalLore = [] }) {
    const names = new Set();
    if (chatLore) names.add(chatLore);
    for (const character of characters) {
        const own = character?.data?.extensions?.world;
        if (own) names.add(own);
        const file = String(character?.avatar ?? '').replace(/\.[^.]+$/, '');
        for (const extra of charLore.find(c => c.name === file)?.extraBooks ?? []) names.add(extra);
    }
    if (personaLore) names.add(personaLore);
    for (const name of globalLore) names.add(name);
    return [...names];
}
