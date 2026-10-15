// Fired-entries viewer: a book icon (in the input bar or floating and draggable) with the number of
// entries that fired on the last reply, an optional line under each AI reply, and the phrase tester.
import { getWorldInfoSettings, parseRegexFromString, selected_world_info, world_info } from '/scripts/world-info.js';
import { createActivationLog, expand } from '../activation-log.js';
import { testPhrase } from '../phrase-test.js';
import { activeBooks } from '../book-sources.js';
import { clampFloat } from './float-position.js';

const NS = 'lorebookLocalizer';
const NARROW = 768;
const DEFAULTS = { icon: 'inbar', underReplies: false, floatPos: { narrow: null, wide: null } };

const ctx = () => SillyTavern.getContext();
const t = (strings, ...values) => ctx().t(strings, ...values);
const $id = id => document.getElementById(id);

let log;
let inbar;
let floating;

function viewerSettings() {
    const all = ctx().extensionSettings;
    all[NS] ??= {};
    all[NS].viewer = { ...DEFAULTS, ...(all[NS].viewer ?? {}) };
    all[NS].viewer.floatPos ??= { narrow: null, wide: null };
    return all[NS].viewer;
}

function saveViewer(patch) {
    Object.assign(viewerSettings(), patch);
    ctx().saveSettingsDebounced();
}

function globals() {
    const s = getWorldInfoSettings();
    return {
        depth: Number.isFinite(Number(s.world_info_depth)) ? Number(s.world_info_depth) : 2,
        caseSensitive: Boolean(s.world_info_case_sensitive),
        wholeWords: Boolean(s.world_info_match_whole_words),
        includeNames: s.world_info_include_names !== false,
        substitute: text => ctx().substituteParams?.(text) ?? text,
    };
}

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function reasonLines(reason) {
    switch (reason.kind) {
        case 'key': {
            const lines = [];
            lines.push(reason.messageIndex >= 0 ? t`by “${reason.fragment}” in message #${reason.messageIndex}` : t`by “${reason.fragment}”`);
            lines.push(`${t`key:`} ${reason.readable} — ${reason.own ? t`added by the localizer (${reason.own})` : t`your key`}`);
            if (reason.secondary) {
                const where = reason.secondary.fragment ? ` (“${reason.secondary.fragment}”)` : '';
                lines.push(`${t`and secondary key:`} ${reason.secondary.readable}${where}`);
            }
            return lines;
        }
        case 'constant': return [t`always on (constant entry)`];
        case 'vector': return [t`vector search`];
        case 'recursion': return [t`triggered by another entry (recursion)`];
        default: return [t`reason not detected: forced by another extension, a timed effect or similar`];
    }
}

/** List of explained entries grouped by lorebook. */
function renderItems(items) {
    const root = el('div', 'lbl-act-list');
    if (!items?.length) {
        root.append(el('p', 'lbl-act-empty', t`No entries fired.`));
        return root;
    }
    const byWorld = new Map();
    for (const item of items) {
        if (!byWorld.has(item.world)) byWorld.set(item.world, []);
        byWorld.get(item.world).push(item);
    }
    for (const [world, group] of byWorld) {
        const details = el('details', 'lbl-act-world');
        details.open = true;
        details.append(el('summary', '', `${world || t`(lorebook not saved)`} · ${group.length}`));
        for (const item of group) {
            const row = el('div', 'lbl-act-item');
            row.append(el('div', 'lbl-act-title', item.title || t`Always-on entry`));
            for (const line of reasonLines(item.reason)) row.append(el('div', 'lbl-act-reason', line));
            details.append(row);
        }
        root.append(details);
    }
    return root;
}

async function openList() {
    const root = el('div', 'lbl-act-popup');
    root.append(el('h3', '', t`Entries that fired on the last reply`));
    root.append(renderItems(log.last?.items));
    const test = el('button', 'menu_button', t`Test a phrase`);
    test.addEventListener('click', () => openPhraseTester());
    root.append(test);
    await ctx().callGenericPopup(root, ctx().POPUP_TYPE.TEXT, '', { allowVerticalScrolling: true, wide: true });
}

/** Lorebooks active in the current chat (group members included). */
function activeBookNames() {
    const c = ctx();
    const group = c.groupId ? c.groups?.find(g => g.id === c.groupId) : null;
    const characters = group
        ? (group.members ?? []).map(avatar => c.characters?.find(ch => ch.avatar === avatar)).filter(Boolean)
        : [c.characters?.[c.characterId]].filter(Boolean);
    return activeBooks({
        chatLore: c.chatMetadata?.world_info,
        characters,
        charLore: world_info?.charLore ?? [],
        personaLore: c.powerUserSettings?.persona_description_lorebook,
        globalLore: selected_world_info ?? [],
    });
}

async function loadBooks(names) {
    const books = [];
    for (const name of names) {
        const data = await ctx().loadWorldInfo(name);
        if (data?.entries) books.push({ name, data });
    }
    return books;
}

async function openPhraseTester() {
    const panelBook = ctx().extensionSettings[NS]?.book ?? '';
    const root = el('div', 'lbl-phrase');
    root.append(el('h3', '', t`Test a phrase`));
    const input = el('textarea', 'text_pole');
    input.rows = 3;
    input.placeholder = t`Type a message as you would in the chat`;
    const scope = el('select', 'text_pole');
    scope.append(new Option(t`Lorebook selected in Lorelator: ${panelBook || '—'}`, 'panel'));
    scope.append(new Option(t`All lorebooks active in this chat`, 'chat'));
    const check = el('button', 'menu_button', t`Check the phrase`);
    const results = el('div', 'lbl-phrase-results');
    const note = el('small', 'lbl-phrase-note', t`Only keys are checked. Probability, timed effects, groups, token budget, recursion and vector search are not simulated.`);
    root.append(input, scope, check, results, note);

    check.addEventListener('click', async () => {
        const names = scope.value === 'chat' ? activeBookNames() : [panelBook].filter(Boolean);
        if (!names.length) {
            results.replaceChildren(el('p', 'lbl-act-empty', t`No lorebook to check.`));
            return;
        }
        const items = testPhrase(await loadBooks(names), input.value, globals(), parseRegexFromString);
        results.replaceChildren(renderItems(items));
    });
    await ctx().callGenericPopup(root, ctx().POPUP_TYPE.TEXT, '', { allowVerticalScrolling: true, wide: true });
}

function updateBadges() {
    const count = log.last?.items.length ?? 0;
    for (const icon of [inbar, floating]) {
        if (!icon) continue;
        icon.dataset.count = String(count);
        icon.title = t`Lorebook entries fired: ${count}`;
    }
}

function clampToViewport(x, y, node) {
    const size = node.offsetWidth || 44;
    const top = document.getElementById('top-bar')?.getBoundingClientRect().bottom ?? 0;
    const bottom = document.getElementById('send_form')?.getBoundingClientRect().top ?? window.innerHeight;
    return clampFloat(x, y, size, { width: window.innerWidth, top, bottom: Math.min(bottom, window.innerHeight) });
}

function placeFloating() {
    if (!floating) return;
    const key = window.innerWidth < NARROW ? 'narrow' : 'wide';
    const saved = viewerSettings().floatPos[key];
    const { x, y } = clampToViewport(saved?.x ?? 8, saved?.y ?? window.innerHeight - 140, floating);
    floating.style.left = `${x}px`;
    floating.style.top = `${y}px`;
}

function makeFloating() {
    const node = el('div', 'lbl-wi-float fa-solid fa-book-atlas');
    node.setAttribute('role', 'button');
    node.tabIndex = 0;
    let start = null;
    node.addEventListener('pointerdown', e => {
        node.setPointerCapture(e.pointerId);
        start = { x: e.clientX, y: e.clientY, left: node.offsetLeft, top: node.offsetTop, moved: false };
    });
    node.addEventListener('pointermove', e => {
        if (!start) return;
        const dx = e.clientX - start.x;
        const dy = e.clientY - start.y;
        if (Math.abs(dx) + Math.abs(dy) > 6) start.moved = true;
        if (!start.moved) return;
        const { x, y } = clampToViewport(start.left + dx, start.top + dy, node);
        node.style.left = `${x}px`;
        node.style.top = `${y}px`;
    });
    const cancel = () => { start = null; };
    node.addEventListener('pointercancel', cancel);
    node.addEventListener('lostpointercapture', () => { if (start && !start.moved) cancel(); });
    node.addEventListener('pointerup', () => {
        if (!start) return;
        const moved = start.moved;
        start = null;
        if (!moved) { openList(); return; }
        const key = window.innerWidth < NARROW ? 'narrow' : 'wide';
        const floatPos = { ...viewerSettings().floatPos, [key]: { x: node.offsetLeft, y: node.offsetTop } };
        saveViewer({ floatPos });
    });
    node.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openList(); } });
    return node;
}

function applyIconMode() {
    const mode = viewerSettings().icon;
    inbar?.remove();
    floating?.remove();
    inbar = null;
    floating = null;
    if (mode === 'inbar') {
        inbar = el('div', 'lbl-wi-inbar fa-solid fa-book-atlas interactable');
        inbar.setAttribute('role', 'button');
        inbar.tabIndex = 0;
        inbar.addEventListener('click', () => openList());
        const anchor = $id('extensionsMenuButton');
        if (anchor) anchor.after(inbar);
        else $id('leftSendForm')?.append(inbar);
    } else if (mode === 'floating') {
        floating = makeFloating();
        document.body.append(floating);
        placeFloating();
    }
    updateBadges();
}

function renderMessageLine(mesId) {
    const mes = document.querySelector(`#chat .mes[mesid="${mesId}"]`);
    if (!mes) return;
    mes.querySelector('.lbl-mes-activations')?.remove();
    const stored = ctx().chat?.[mesId]?.extra?.[NS];
    if (!viewerSettings().underReplies || !stored?.activations) return;
    const activations = expand(stored);
    const box = el('div', 'lbl-mes-activations');
    const toggle = el('button', 'lbl-mes-toggle', `📖 ${t`Lorebook entries: ${activations.length}`}`);
    toggle.type = 'button';
    let list = null;
    toggle.addEventListener('click', () => {
        if (list) { list.remove(); list = null; return; }
        list = renderItems(activations);
        box.append(list);
    });
    box.append(toggle);
    (mes.querySelector('.mes_text') ?? mes).after(box);
}

function renderAllLines() {
    document.querySelectorAll('#chat .lbl-mes-activations').forEach(n => n.remove());
    if (!viewerSettings().underReplies) return;
    document.querySelectorAll('#chat .mes[mesid]').forEach(mes => renderMessageLine(Number(mes.getAttribute('mesid'))));
}

function bindSettings() {
    const s = viewerSettings();
    const icon = $id('lbl_view_icon');
    const under = $id('lbl_view_under');
    if (!icon || !under) return;
    icon.value = s.icon;
    under.checked = s.underReplies;
    icon.addEventListener('change', () => { saveViewer({ icon: icon.value }); applyIconMode(); });
    under.addEventListener('change', () => { saveViewer({ underReplies: under.checked }); renderAllLines(); });
    $id('lbl_view_test')?.addEventListener('click', () => openPhraseTester());
    $id('lbl_view_reset')?.addEventListener('click', () => {
        saveViewer({ floatPos: { narrow: null, wide: null } });
        placeFloating();
    });
}

export function initActivationView() {
    const c = ctx();
    log = createActivationLog({
        getChat: () => ctx().chat,
        getGlobals: globals,
        parseRegex: parseRegexFromString,
        getViewerSettings: viewerSettings,
        saveChat: () => ctx().saveChat?.(),
        substitute: text => ctx().substituteParams?.(text) ?? text,
    });
    log.subscribe(updateBadges);

    const { eventSource, eventTypes } = c;
    eventSource.on(eventTypes.GENERATION_STARTED, (type, _options, dryRun) => { if (!dryRun) log.onGenerationStarted(type); });
    eventSource.on(eventTypes.WORLD_INFO_ACTIVATED, entries => log.onActivated(entries));
    eventSource.on(eventTypes.MESSAGE_RECEIVED, (mesId, type) => log.onMessageReceived(Number(mesId), type));
    for (const name of ['MESSAGE_SWIPED', 'MESSAGE_EDITED', 'MESSAGE_UPDATED']) {
        if (eventTypes[name]) eventSource.on(eventTypes[name], mesId => renderMessageLine(Number(mesId)));
    }
    eventSource.on(eventTypes.CHARACTER_MESSAGE_RENDERED, mesId => renderMessageLine(Number(mesId)));
    eventSource.on(eventTypes.CHAT_CHANGED, () => { log.onChatChanged(); setTimeout(renderAllLines, 0); });
    if (eventTypes.MORE_MESSAGES_LOADED) eventSource.on(eventTypes.MORE_MESSAGES_LOADED, () => renderAllLines());
    window.addEventListener('resize', placeFloating);

    bindSettings();
    applyIconMode();
    renderAllLines();
}
