/**
 * Keep the floating icon on screen and out of SillyTavern's bars (they sit above it and would hide it).
 * @param {number} x
 * @param {number} y
 * @param {number} size icon size in px
 * @param {{ width: number, top: number, bottom: number }} bounds screen width, top-bar bottom, input-bar top
 * @returns {{ x: number, y: number }}
 */
export function clampFloat(x, y, size, { width, top, bottom }) {
    return {
        x: Math.round(Math.min(Math.max(0, x), width - size)),
        // The top bar wins when the screen is too short (mobile keyboard open).
        y: Math.round(Math.max(top, Math.min(y, bottom - size))),
    };
}
