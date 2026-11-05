// Searchable picker on top of a hidden <select>: the select stays the source of truth (so the rest of the
// panel keeps working unchanged), the picker shows the current choice as a button and opens a list with a
// search field underneath it. The list opens inline (not as a floating layer) so it fits phones.

/** Lowercase, no accents, ё = е. */
export function normalize(text) {
    return String(text ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ё/g, 'е');
}

/**
 * @param {{ value: string, label: string }[]} items
 * @param {string} query words in any order; every word must occur in the label
 */
export function filterItems(items, query) {
    const words = normalize(query).split(/\s+/).filter(Boolean);
    if (!words.length) return items;
    return items.filter(item => {
        const label = normalize(item.label);
        return words.every(word => label.includes(word));
    });
}

const MAX_SHOWN = 300;

/**
 * @param {{
 *   button: HTMLButtonElement, select: HTMLSelectElement, panel: HTMLElement,
 *   texts: { search: string, none: string, count: (shown: number, total: number) => string },
 *   thumb?: (value: string) => string,
 * }} options
 */
export function initPicker({ button, select, panel, texts, thumb }) {
    const search = Object.assign(document.createElement('input'), { type: 'search', className: 'lbl-search', placeholder: texts.search });
    search.setAttribute('autocomplete', 'off');
    search.setAttribute('autocapitalize', 'off');
    search.setAttribute('spellcheck', 'false');
    search.setAttribute('enterkeyhint', 'search');
    search.setAttribute('aria-label', texts.search);
    const count = Object.assign(document.createElement('div'), { className: 'lbl-picker-count' });
    const list = Object.assign(document.createElement('div'), { className: 'lbl-picker-list' });
    list.setAttribute('role', 'listbox');
    panel.replaceChildren(search, count, list);

    let shown = [];
    let active = -1;

    const options = () => [...select.options].map(o => ({ value: o.value, label: o.textContent }));

    function renderButton() {
        const current = select.selectedOptions[0];
        button.textContent = current?.textContent ?? '';
        button.disabled = select.disabled || !select.options.length;
        if (button.disabled && !panel.hidden) close();
    }

    function setActive(index, scroll = true) {
        active = Math.max(-1, Math.min(index, shown.length - 1));
        [...list.children].forEach((row, i) => {
            const on = i === active;
            row.classList.toggle('active', on);
            if (on && scroll) row.scrollIntoView({ block: 'nearest' });
        });
    }

    function renderList() {
        const all = options();
        const found = filterItems(all, search.value);
        shown = found.slice(0, MAX_SHOWN);
        count.textContent = texts.count(found.length, all.length);
        if (!found.length) {
            list.replaceChildren(Object.assign(document.createElement('div'), { className: 'lbl-picker-empty', textContent: texts.none }));
            active = -1;
            return;
        }
        list.replaceChildren(...shown.map(item => {
            const row = document.createElement('div');
            row.className = 'lbl-picker-row';
            row.setAttribute('role', 'option');
            row.dataset.value = item.value;
            const chosen = item.value === select.value;
            row.setAttribute('aria-selected', String(chosen));
            if (chosen) row.classList.add('chosen');
            if (thumb) {
                const img = Object.assign(document.createElement('span'), { className: 'lbl-picker-thumb' });
                img.style.backgroundImage = `url("${thumb(item.value)}")`;
                row.append(img);
            }
            row.append(Object.assign(document.createElement('span'), { className: 'lbl-picker-label', textContent: item.label }));
            return row;
        }));
        setActive(shown.findIndex(item => item.value === select.value), false);
    }

    function choose(value) {
        close();
        if (select.value === value) return;
        select.value = value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        renderButton();
    }

    function open() {
        if (button.disabled) return;
        panel.hidden = false;
        button.setAttribute('aria-expanded', 'true');
        search.value = '';
        renderList();
        panel.scrollIntoView({ block: 'nearest' });
        search.focus({ preventScroll: true });
        list.querySelector('.chosen')?.scrollIntoView({ block: 'nearest' });
    }

    function close() {
        panel.hidden = true;
        button.setAttribute('aria-expanded', 'false');
    }

    button.setAttribute('aria-haspopup', 'listbox');
    button.setAttribute('aria-expanded', 'false');
    button.addEventListener('click', () => (panel.hidden ? open() : close()));
    search.addEventListener('input', renderList);
    search.addEventListener('keydown', event => {
        if (event.key === 'ArrowDown') { event.preventDefault(); setActive(active + 1); }
        else if (event.key === 'ArrowUp') { event.preventDefault(); setActive(active - 1); }
        else if (event.key === 'Enter') {
            event.preventDefault();
            const item = shown[active] ?? (shown.length === 1 ? shown[0] : null);
            if (item) choose(item.value);
        } else if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            close();
            button.focus();
        }
    });
    list.addEventListener('click', event => {
        const row = event.target.closest('.lbl-picker-row');
        if (row) choose(row.dataset.value);
    });
    document.addEventListener('pointerdown', event => {
        if (panel.hidden || panel.contains(event.target) || button.contains(event.target)) return;
        close();
    });

    // The panel rebuilds the select's options and toggles it while busy: follow both.
    new MutationObserver(() => {
        renderButton();
        if (!panel.hidden) renderList();
    }).observe(select, { childList: true, attributes: true, attributeFilter: ['disabled'] });
    select.addEventListener('change', renderButton);
    renderButton();
}
