// Regenerates docs/images/*.png from a running SillyTavern (http://localhost:8200) with the extension installed.
// Usage: npm i --no-save puppeteer-core && node scripts/screenshots.mjs docs/images
// Uses a fresh browser profile and photographs only the extension panel and the phrase tester.
// The lorebook shown is the test lorebook LL-test (never a personal one).
import puppeteer from 'puppeteer-core';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const BOOK = 'LL-test';
const PHRASES = {
    en: 'Я зашла в таверну, заказала эля у трактирщика и заметила у стены дракона.',
    ru: 'Я зашла в таверну, заказала эля у трактирщика и заметила у стены дракона.',
};

const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    headless: true,
    userDataDir: mkdtempSync(join(tmpdir(), 'lbl-shots-')),
    defaultViewport: { width: 1280, height: 2600, deviceScaleFactor: 1.5 },
    args: ['--no-first-run', '--disable-extensions'],
});
for (const lang of ['en', 'ru']) {
    const page = await browser.newPage();
    await page.evaluateOnNewDocument(l => localStorage.setItem('language', l === 'ru' ? 'ru-ru' : 'en'), lang);
    await page.goto('http://localhost:8200/', { waitUntil: 'networkidle2', timeout: 90000 });
    await page.waitForSelector('.lbl-panel', { timeout: 60000 });
    await sleep(2000);
    // Open the Extensions drawer and our panel.
    await page.evaluate(() => document.querySelector('#extensions-settings-button .drawer-toggle')?.click());
    await sleep(1200);
    await page.evaluate(book => {
        const panel = document.querySelector('.lbl-panel');
        panel.querySelector(':scope > .inline-drawer > .inline-drawer-toggle').click();
        const select = document.getElementById('lbl_book');
        select.value = book;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        document.querySelector('#lbl_tabs button[data-view="books"]').click();
    }, BOOK);
    await sleep(1500);

    const clip = () => page.evaluate(() => {
        const r = document.querySelector('.lbl-app').getBoundingClientRect();
        return { x: r.left, y: r.top + scrollY, width: r.width, height: r.height };
    });

    // 1. Lorebooks view.
    await page.evaluate(() => document.querySelector('.lbl-app').scrollIntoView());
    await page.screenshot({ path: join(OUT, `panel-main-${lang}.png`), captureBeyondViewport: true, clip: await clip() });

    // 2. More view: backups and fired-entries settings.
    await page.evaluate(() => {
        document.querySelector('#lbl_tabs button[data-view="more"]').click();
        for (const details of document.querySelectorAll('#lbl_view_more details')) details.open = true;
    });
    await sleep(600);
    await page.screenshot({ path: join(OUT, `panel-more-${lang}.png`), captureBeyondViewport: true, clip: await clip() });

    // 3. Phrase tester with a sample message.
    await page.evaluate(() => document.getElementById('lbl_view_test').click());
    await page.waitForSelector('dialog[open] .lbl-phrase textarea');
    await page.type('dialog[open] .lbl-phrase textarea', PHRASES[lang]);
    await page.evaluate(() => [...document.querySelectorAll('dialog[open] .lbl-phrase button')].at(-1).click());
    await sleep(1500);
    const dialog = await page.$('dialog[open] .popup-body');
    await dialog.screenshot({ path: join(OUT, `phrase-test-${lang}.png`) });
    await page.close();
}
await browser.close();
console.log('ok');
