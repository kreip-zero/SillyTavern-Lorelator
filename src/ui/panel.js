import { LANGUAGES } from '../languages.js';
import { removeKeys } from '../entry-keys.js';
import { PROVIDERS } from '../providers.js';
import { applyMorphology, planLocalization, planMorphology, runLocalization } from '../runner.js';
import { BACKUP_MARK, createIo, deleteBackup, listBackups, listLorebooks, makeBackup, restoreBackup } from '../st-lorebook.js';
import { createLlm, listModels, listProfiles } from '../st-llm.js';
import { LocalizerError, errorText } from '../errors.js';

const NS = 'lorebookLocalizer';
const DEFAULTS = {
    lang: 'ru',
    book: '',
    batchSize: 15,
    review: true,
    connMode: 'current',
    profileId: '',
    profileModel: '',
    providerId: 'openrouter',
    customUrl: '',
    apiKey: '',
    customModel: '',
    backupVisible: false,
};

const ctx = () => SillyTavern.getContext();
const $id = id => document.getElementById(id);
// SillyTavern's i18n: the English text is the key; ${n} placeholders are filled in after lookup.
const t = (strings, ...values) => ctx().t(strings, ...values);
const translate = text => ctx().translate?.(text) ?? text;

let controller = null;
/** Entries that failed in the last run, tied to the lorebook and language they came from. */
let lastFailed = { book: '', lang: '', entries: [] };

function settings() {
    const all = ctx().extensionSettings;
    const stored = all[NS] ?? {};
    // Older versions stored profileId '' to mean "current connection".
    if (stored.connMode === undefined && stored.profileId) stored.connMode = 'profile';
    all[NS] = { ...DEFAULTS, ...stored };
    return all[NS];
}

function saveSettings(patch) {
    Object.assign(settings(), patch);
    ctx().saveSettingsDebounced();
}

function fillSelect(select, options, value) {
    select.replaceChildren(...options.map(([v, label]) => {
        const option = document.createElement('option');
        option.value = v;
        option.textContent = label;
        return option;
    }));
    if (options.some(([v]) => v === value)) select.value = value;
}

function fillDatalist(list, models) {
    list.replaceChildren(...models.map(id => Object.assign(document.createElement('option'), { value: id })));
}

function refreshLists() {
    const s = settings();
    const books = listLorebooks().filter(n => !n.includes(BACKUP_MARK));
    fillSelect($id('lbl_book'), books.map(n => [n, n]), s.book);
    // An empty list usually means "not loaded yet": keep the saved choice instead of wiping it.
    if (books.length && $id('lbl_book').value !== s.book) saveSettings({ book: $id('lbl_book').value });
    const profiles = listProfiles();
    fillSelect($id('lbl_profile'), profiles.map(p => [p.id, p.name]), s.profileId);
    if (profiles.length && $id('lbl_profile').value !== s.profileId) saveSettings({ profileId: $id('lbl_profile').value });
}

function showConnection() {
    const s = settings();
    $id('lbl_conn_profile').hidden = s.connMode !== 'profile';
    $id('lbl_conn_custom').hidden = s.connMode !== 'custom';
    $id('lbl_url_field').hidden = s.providerId !== 'custom';
}

/** The connection described by the current settings. */
function connection() {
    const s = settings();
    if (s.connMode === 'profile') return { mode: 'profile', profileId: s.profileId, model: s.profileModel.trim() };
    if (s.connMode === 'custom') return { mode: 'custom', providerId: s.providerId, url: s.customUrl, key: s.apiKey, model: s.customModel.trim() };
    return { mode: 'current' };
}

async function loadModels(listId) {
    const models = await listModels(connection());
    fillDatalist($id(listId), models);
    if (models.length) toastr.success(t`Loaded ${models.length} models. Start typing in the Model field to pick one.`);
    else toastr.info(t`This connection cannot list models. Type the model name.`);
}

function refreshBackups() {
    const s = settings();
    const backups = s.book ? listBackups(s.book) : [];
    const list = $id('lbl_backup_list');
    fillSelect(list, backups.map(b => [b.id, b.kind === 'file' ? b.label : `${b.label} (${t`lorebook`})`]), list.value);
    if (!backups.length) fillSelect(list, [['', t`No backups yet`]], '');
    for (const id of ['lbl_backup_restore', 'lbl_backup_delete']) $id(id).disabled = !backups.length || Boolean(controller);
}

function io() {
    return createIo({ visible: settings().backupVisible });
}

async function showHelp() {
    const { callGenericPopup, POPUP_TYPE } = ctx();
    const items = [
        [t`Localize`, t`Asks the AI for keywords in your language and adds them to the entries. Entries already done are skipped. Entries you edited since the last run are done again. Entries whose keywords are already in your language get word forms locally, without the AI. Always-on entries and disabled entries are not touched.`],
        [t`Word forms for existing keys`, t`Free, no AI. Turns keys that are already in your language into keys that also match other word forms (for example dragon → dragons). Useful if you started translating a lorebook by hand.`],
        [t`Remove localization`, t`Deletes the keywords this extension added for the selected language. Your own keywords and other languages stay.`],
        [t`Backups`, t`A copy of the lorebook is saved before every change. Restore puts a copy back (the current state is saved first). Copies are hidden files unless you choose to save them as lorebooks.`],
    ];
    const root = document.createElement('div');
    root.className = 'lbl-help-text';
    for (const [title, text] of items) {
        const h = document.createElement('h4');
        h.textContent = title;
        const p = document.createElement('p');
        p.textContent = text;
        root.append(h, p);
    }
    await callGenericPopup(root, POPUP_TYPE.TEXT, '', { allowVerticalScrolling: true });
}

function setBusy(busy) {
    for (const id of ['lbl_run', 'lbl_inflect', 'lbl_remove', 'lbl_book', 'lbl_lang', 'lbl_conn_mode', 'lbl_profile', 'lbl_provider', 'lbl_backup_make']) {
        $id(id).disabled = busy;
    }
    $id('lbl_cancel').hidden = !busy;
    if (busy) $id('lbl_retry').hidden = true;
    refreshBackups();
}

function showStatus(text, processed = 0, total = 1) {
    $id('lbl_status').hidden = false;
    $id('lbl_status_text').textContent = text;
    $id('lbl_progress').max = Math.max(total, 1);
    $id('lbl_progress').value = processed;
}

function textBlock(...lines) {
    const root = document.createElement('div');
    for (const line of lines) {
        const p = document.createElement('p');
        p.textContent = line;
        root.append(p);
    }
    return root;
}

async function confirm(content, okButton) {
    const { callGenericPopup, POPUP_TYPE, POPUP_RESULT } = ctx();
    const options = okButton ? { okButton, cancelButton: t`Cancel` } : {};
    return (await callGenericPopup(content, POPUP_TYPE.CONFIRM, '', options)) === POPUP_RESULT.AFFIRMATIVE;
}

/** Review popup: one checkbox per proposed keyword. Resolves to accepted keys per uid, or null. */
async function reviewProposals(proposals) {
    const { callGenericPopup, POPUP_TYPE, POPUP_RESULT } = ctx();
    const root = document.createElement('div');
    root.className = 'lbl-review';
    const boxes = [];
    for (const p of proposals) {
        const block = document.createElement('div');
        block.className = 'lbl-review-entry';
        const title = document.createElement('h4');
        title.textContent = p.comment || `#${p.uid}`;
        block.append(title);
        p.phrases.forEach((phrase, i) => {
            const label = document.createElement('label');
            label.className = 'lbl-review-phrase';
            const box = document.createElement('input');
            box.type = 'checkbox';
            box.checked = true;
            const text = document.createElement('span');
            text.textContent = phrase;
            label.append(box, text);
            block.append(label);
            boxes.push({ box, uid: p.uid, key: p.keys[i] });
        });
        root.append(block);
    }
    const result = await callGenericPopup(root, POPUP_TYPE.CONFIRM, '', {
        okButton: t`Save these keywords`,
        cancelButton: t`Stop`,
        wide: true,
        allowVerticalScrolling: true,
    });
    if (result !== POPUP_RESULT.AFFIRMATIVE) return null;
    const accepted = new Map(proposals.map(p => [p.uid, []]));
    for (const { box, uid, key } of boxes) if (box.checked) accepted.get(uid).push(key);
    return accepted;
}

async function localize(todoOverride) {
    const s = settings();
    if (!s.book) return toastr.warning(t`Choose a lorebook`);
    const llm = createLlm(connection());
    let todo = todoOverride;
    if (!todo) {
        const plan = planLocalization(await io().load(s.book), s.lang, { onlyChanged: false, batchSize: s.batchSize });
        todo = plan.todo;
        if (!todo.length) return toastr.info(t`Nothing to do: every entry is already localized and unchanged.`);
        const { inputTokens, outputTokens } = plan.estimate;
        const ok = await confirm(textBlock(
            t`New entries: ${plan.newCount}. Edited since the last run: ${plan.changedCount}.`,
            ...(plan.nativeCount ? [t`Already in your language, done without the AI: ${plan.nativeCount}.`] : []),
            t`About ${inputTokens.toLocaleString()} input and ${outputTokens.toLocaleString()} output tokens.`,
            t`A backup copy of the lorebook is saved before any change.`,
        ), t`Localize`);
        if (!ok) return;
    }

    controller = new AbortController();
    setBusy(true);
    showStatus(t`Processed ${0} of ${todo.length}`, 0, todo.length);
    // Kept in the console so a stuck or failed run can be traced afterwards.
    console.info('[Lorelator] run started', { book: s.book, lang: s.lang, entries: todo.length, connection: s.connMode });
    try {
        const result = await runLocalization({
            name: s.book,
            lang: s.lang,
            todo,
            batchSize: s.batchSize,
            io: io(),
            llm,
            review: s.review ? reviewProposals : undefined,
            signal: controller.signal,
            onProgress: ({ processed, total, failed }) => showStatus(t`Processed ${processed} of ${total}, errors: ${failed}`, processed, total),
        });
        lastFailed = { book: s.book, lang: s.lang, entries: todo.filter(e => result.failed.includes(e.uid)) };
        const summary = result.cancelled
            ? t`Stopped. Localized entries: ${result.done.length}, errors: ${result.failed.length}`
            : t`Done. Localized entries: ${result.done.length}, errors: ${result.failed.length}`;
        showStatus(result.lastError ? `${summary}
${t`Last error: ${errorText(result.lastError, translate)}`}` : summary, todo.length, todo.length);
        $id('lbl_retry').hidden = lastFailed.entries.length === 0;
        await ctx().updateWorldInfoList();
    } catch (error) {
        console.error('[Lorelator]', error);
        showStatus(t`Error: ${errorText(error, translate)}`);
    } finally {
        console.info('[Lorelator] run finished', { book: s.book });
        controller = null;
        setBusy(false);
    }
}

async function removeLocalization() {
    const s = settings();
    if (!s.book) return toastr.warning(t`Choose a lorebook`);
    const language = LANGUAGES[s.lang]?.name ?? s.lang;
    if (!(await confirm(textBlock(t`Remove the ${language} keywords that Lorelator added to "${s.book}"? Your own keywords and other languages stay.`), t`Remove`))) return;
    const store = io();
    await store.backup(s.book);
    const book = await store.load(s.book);
    for (const entry of Object.values(book.entries)) removeKeys(entry, s.lang);
    await store.save(s.book, book);
    refreshBackups();
    toastr.success(t`Added keywords removed`);
}

async function inflectExisting() {
    const s = settings();
    if (!s.book) return toastr.warning(t`Choose a lorebook`);
    const store = io();
    const proposals = planMorphology(await store.load(s.book), s.lang);
    if (!proposals.length) return toastr.info(t`No keys to add word forms to.`);
    // Always reviewed: for Latin-script languages English keys are offered too.
    const accepted = await reviewProposals(proposals);
    if (!accepted) return;
    await store.backup(s.book);
    const book = await store.load(s.book);
    const changed = applyMorphology(book, s.lang, accepted);
    await store.save(s.book, book);
    refreshBackups();
    toastr.success(t`Word forms added to ${changed.length} entries`);
}

function selectedBackup() {
    const id = $id('lbl_backup_list').value;
    if (!id) throw new LocalizerError('NO_BACKUPS');
    return id;
}

async function backupNow() {
    const s = settings();
    if (!s.book) return toastr.warning(t`Choose a lorebook`);
    await makeBackup(s.book, { visible: s.backupVisible });
    refreshBackups();
    toastr.success(t`Backup saved`);
}

async function restoreSelected() {
    const s = settings();
    const id = selectedBackup();
    if (!(await confirm(textBlock(t`Replace "${s.book}" with the selected copy? The current state is saved as a new copy first.`), t`Restore`))) return;
    await restoreBackup(s.book, id);
    refreshBackups();
    toastr.success(t`Lorebook restored`);
}

async function deleteSelected() {
    const id = selectedBackup();
    if (!(await confirm(textBlock(t`Delete the selected copy? This cannot be undone.`), t`Delete`))) return;
    await deleteBackup(id);
    refreshBackups();
}

function forgetFailed() {
    lastFailed = { book: '', lang: '', entries: [] };
    $id('lbl_retry').hidden = true;
}

function retryFailed() {
    const s = settings();
    if (lastFailed.book !== s.book || lastFailed.lang !== s.lang || !lastFailed.entries.length) {
        forgetFailed();
        return;
    }
    return localize(lastFailed.entries);
}

/** Runs a short action with the panel locked, so Localize cannot start halfway through it. */
function busy(fn) {
    return async () => {
        if (controller) return;
        controller = new AbortController();
        setBusy(true);
        $id('lbl_cancel').hidden = true; // nothing to cancel in a short action
        try {
            await fn();
        } finally {
            controller = null;
            setBusy(false);
        }
    };
}

function guard(fn) {
    return async () => {
        try {
            await fn();
        } catch (error) {
            console.error('[Lorelator]', error);
            toastr.error(errorText(error, translate), 'Lorelator');
        }
    };
}

function bindText(id, key) {
    $id(id).value = settings()[key];
    $id(id).addEventListener('change', e => saveSettings({ [key]: e.target.value.trim() }));
}

export async function initPanel() {
    const html = await (await fetch(new URL('./panel.html', import.meta.url))).text();
    $('#extensions_settings2').append(html);

    const s = settings();
    fillSelect($id('lbl_lang'), Object.entries(LANGUAGES).map(([code, l]) => [code, `${l.name} (${code})`]), s.lang);
    fillSelect($id('lbl_provider'), PROVIDERS.map(p => [p.id, p.id === 'custom' ? t`Other (OpenAI-compatible)` : p.name]), s.providerId);
    $id('lbl_conn_mode').value = s.connMode;
    $id('lbl_review').checked = s.review;
    $id('lbl_batch').value = String(s.batchSize);
    bindText('lbl_profile_model', 'profileModel');
    bindText('lbl_url', 'customUrl');
    bindText('lbl_key', 'apiKey');
    bindText('lbl_custom_model', 'customModel');
    refreshLists();
    showConnection();

    $id('lbl_book').addEventListener('change', e => { saveSettings({ book: e.target.value }); forgetFailed(); refreshBackups(); });
    $id('lbl_lang').addEventListener('change', e => { saveSettings({ lang: e.target.value }); forgetFailed(); });
    $id('lbl_conn_mode').addEventListener('change', e => { saveSettings({ connMode: e.target.value }); showConnection(); });
    $id('lbl_profile').addEventListener('change', e => {
        saveSettings({ profileId: e.target.value, profileModel: '' });
        $id('lbl_profile_model').value = '';
        fillDatalist($id('lbl_profile_models'), []);
    });
    $id('lbl_provider').addEventListener('change', e => {
        saveSettings({ providerId: e.target.value, customModel: '' });
        $id('lbl_custom_model').value = '';
        fillDatalist($id('lbl_custom_models'), []);
        showConnection();
    });
    $id('lbl_review').addEventListener('change', e => saveSettings({ review: e.target.checked }));
    $id('lbl_batch').addEventListener('change', e => {
        const n = Math.min(30, Math.max(5, Math.round(Number(e.target.value)) || DEFAULTS.batchSize));
        e.target.value = String(n);
        saveSettings({ batchSize: n });
    });
    // Lorebooks and profiles can be added while ST is open; refresh when the drawer is opened.
    // (Not on select focus: rebuilding options closes the native picker on phones.)
    document.querySelector('.lbl-panel .inline-drawer-toggle').addEventListener('click', () => {
        if (!controller) { refreshLists(); refreshBackups(); }
    });

    $id('lbl_profile_load').addEventListener('click', guard(() => loadModels('lbl_profile_models')));
    $id('lbl_custom_load').addEventListener('click', guard(() => loadModels('lbl_custom_models')));
    $id('lbl_run').addEventListener('click', guard(() => localize()));
    $id('lbl_retry').addEventListener('click', guard(retryFailed));
    $id('lbl_remove').addEventListener('click', guard(busy(removeLocalization)));
    $id('lbl_inflect').addEventListener('click', guard(busy(inflectExisting)));
    $id('lbl_help').addEventListener('click', guard(showHelp));
    $id('lbl_backup_make').addEventListener('click', guard(busy(backupNow)));
    $id('lbl_backup_restore').addEventListener('click', guard(busy(restoreSelected)));
    $id('lbl_backup_delete').addEventListener('click', guard(busy(deleteSelected)));
    $id('lbl_backup_visible').checked = settings().backupVisible;
    $id('lbl_backup_visible').addEventListener('change', e => saveSettings({ backupVisible: e.target.checked }));
    $id('lbl_cancel').addEventListener('click', () => {
        if (!controller) return;
        controller.abort();
        $id('lbl_status_text').textContent = t`Stopping… (waiting for the current request to finish)`;
    });
    setBusy(false);
}
