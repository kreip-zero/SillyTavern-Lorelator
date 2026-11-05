// Preview popup for translated greetings: original and translation side by side, one tick box each.
// Greetings that lost a macro, an HTML tag or a code block start unticked.
const ctx = () => SillyTavern.getContext();
const t = (strings, ...values) => ctx().t(strings, ...values);

/** Plain-language line for the problem codes of checkPreserved(). */
export function problemText(problems) {
    const texts = {
        macro: t`Lost or changed a macro such as {{user}}`,
        html: t`Lost or changed an HTML tag`,
        fence: t`Lost a code block`,
        comment: t`Lost an HTML comment`,
    };
    return problems.map(p => texts[p] ?? p).join('; ');
}

function label(id) {
    return id === 'first' ? t`First message` : t`Alternate greeting ${Number(id.slice(4)) + 1}`;
}

function column(title, text) {
    const box = document.createElement('div');
    box.className = 'lbl-gr-col';
    const h = document.createElement('small');
    h.textContent = title;
    const pre = document.createElement('div');
    pre.className = 'lbl-gr-text';
    pre.textContent = text;
    box.append(h, pre);
    return box;
}

/**
 * @param {{ id: string, source: string, translation: string, problems: string[] }[]} proposals
 * @returns {Promise<Map<string, string> | null>} accepted id → translation, or null when cancelled
 */
export async function reviewGreetings(proposals) {
    const { callGenericPopup, POPUP_TYPE, POPUP_RESULT } = ctx();
    const root = document.createElement('div');
    root.className = 'lbl-review';
    const boxes = [];
    for (const p of proposals) {
        const block = document.createElement('div');
        block.className = 'lbl-review-entry';
        const head = document.createElement('label');
        head.className = 'lbl-review-phrase';
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.checked = p.problems.length === 0;
        const title = document.createElement('b');
        title.textContent = label(p.id);
        head.append(box, title);
        block.append(head);
        if (p.problems.length) {
            const warning = document.createElement('div');
            warning.className = 'lbl-warning';
            warning.textContent = problemText(p.problems);
            block.append(warning);
        }
        const pair = document.createElement('div');
        pair.className = 'lbl-gr-pair';
        pair.append(column(t`Original`, p.source), column(t`Translation`, p.translation));
        block.append(pair);
        root.append(block);
        boxes.push({ box, p });
    }
    const result = await callGenericPopup(root, POPUP_TYPE.CONFIRM, '', {
        okButton: t`Save these greetings`,
        cancelButton: t`Stop`,
        wide: true,
        large: true,
        allowVerticalScrolling: true,
    });
    if (result !== POPUP_RESULT.AFFIRMATIVE) return null;
    return new Map(boxes.filter(({ box }) => box.checked).map(({ p }) => [p.id, p.translation]));
}
