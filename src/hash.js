/**
 * Fingerprint of what the model saw for an entry: author keys, secondary keys, title, content.
 * Our own keys are excluded so adding them does not mark the entry as changed.
 * @param {{ key: string[], keysecondary?: string[], comment?: string, content: string }} entry
 * @param {string[]} [ownKeys]
 * @returns {string} FNV-1a 32-bit, hex
 */
export function entryHash(entry, ownKeys = []) {
    const own = new Set(ownKeys);
    const keys = (entry.key ?? []).filter(k => !own.has(k));
    const secondary = (entry.keysecondary ?? []).filter(k => !own.has(k));
    // Secondary keys join the hash only when present, so hashes stored by older versions stay valid.
    const parts = secondary.length ? [keys, secondary, entry.comment ?? '', entry.content ?? ''] : [keys, entry.comment ?? '', entry.content ?? ''];
    const text = JSON.stringify(parts);
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}
