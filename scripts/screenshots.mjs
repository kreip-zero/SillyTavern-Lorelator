// Regenerates docs/images/*.png from a running SillyTavern (http://localhost:8200) with the extension installed.
// Usage: npm i --no-save puppeteer-core && node scripts/screenshots.mjs docs/images
// Uses a fresh browser profile and photographs only the extension panel and the phrase tester.
// Screenshots of the extension's own UI only (panel and phrase tester), in a clean browser profile.
import puppeteer from 'puppeteer-core';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
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
    // Open the Extensions drawer and our panel with its sub-sections.
    await page.evaluate(() => {
        document.querySelector('#extensions-settings-button .drawer-toggle')?.click();
    });
    await sleep(1200);
    await page.evaluate(() => {
        const panel = document.querySelector('.lbl-panel');
        panel.scrollIntoView();
        panel.querySelector(':scope > .inline-drawer > .inline-drawer-toggle').click();
    });
    await sleep(1200);
    await page.evaluate(() => {
        for (const t of document.querySelectorAll('.lbl-panel .inline-drawer .inline-drawer .inline-drawer-toggle')) t.click();
        document.querySelector('.lbl-panel').scrollIntoView();
    });
    await sleep(1200);
    // The panel is tall: two pictures, the main controls and the extra sections.
    const clips = await page.evaluate(() => {
        const rect = el => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top + scrollY, width: r.width, height: r.height }; };
        const panel = rect(document.querySelector('.lbl-panel'));
        const more = rect(document.querySelector('.lbl-panel .inline-drawer .inline-drawer .inline-drawer-toggle'));
        const buttons = rect(document.getElementById('lbl_remove'));
        return { panel, split: more.y, mainBottom: buttons.y + buttons.height + 8 };
    });
    const { panel, split, mainBottom } = clips;
    await page.screenshot({ path: join(OUT, `panel-main-${lang}.png`), captureBeyondViewport: true, clip: { x: panel.x, y: panel.y, width: panel.width, height: mainBottom - panel.y } });
    await page.screenshot({ path: join(OUT, `panel-more-${lang}.png`), captureBeyondViewport: true, clip: { x: panel.x, y: split, width: panel.width, height: panel.y + panel.height - split } });

    // Phrase tester with a sample message.
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
