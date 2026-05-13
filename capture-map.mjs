/**
 * capture-map.mjs
 * Usage: node capture-map.mjs "Address" "output/path.png"
 */

import puppeteer from 'puppeteer-core';
import { resolve } from 'path';
import { existsSync, renameSync, readdirSync, mkdirSync, statSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const address = process.argv[2];
const outputPath = process.argv[3];

if (!address || !outputPath) {
  console.error('Usage: node capture-map.mjs "Address" "output/path.png"');
  process.exit(1);
}

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const APP_URL = 'https://retailer-map.vercel.app';
const DOWNLOAD_DIR = resolve(tmpdir(), `retailer-map-${Date.now()}`);
mkdirSync(DOWNLOAD_DIR, { recursive: true });

console.log(`Address: ${address}`);
console.log(`Output:  ${outputPath}`);

const browser = await puppeteer.launch({
  executablePath: CHROME_PATH,
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1400,900'],
  defaultViewport: { width: 1400, height: 900 },
});

const page = await browser.newPage();

// Intercept downloads
const client = await page.createCDPSession();
await client.send('Page.setDownloadBehavior', {
  behavior: 'allow',
  downloadPath: DOWNLOAD_DIR,
});

await page.goto(APP_URL, { waitUntil: 'networkidle2', timeout: 30000 });
console.log('Page loaded');

// Enter address in the input field
await page.waitForSelector('input[placeholder*="e.g."]', { timeout: 10000 });
await page.triple_click?.('input[placeholder*="e.g."]') ?? await page.click('input[placeholder*="e.g."]');
await page.keyboard.down('Control');
await page.keyboard.press('a');
await page.keyboard.up('Control');
await page.keyboard.type(address);
console.log('Address entered');

// Find and click the Generate Map button by text
const genBtn = await page.evaluateHandle(() => {
  const btns = [...document.querySelectorAll('button')];
  return btns.find(b => b.textContent.trim() === 'Generate Map');
});
const genBtnEl = genBtn.asElement();
if (!genBtnEl) {
  console.error('Generate Map button not found');
  await browser.close();
  process.exit(1);
}
await genBtnEl.click();
console.log('Generate clicked — waiting for retailers...');

// Wait up to 90s for "Generating…" to go away
await page.waitForFunction(() => {
  const btns = [...document.querySelectorAll('button')];
  const btn = btns.find(b => b.textContent.includes('Generate'));
  return btn && !btn.textContent.includes('Generating');
}, { timeout: 90000, polling: 1500 });

// Extra wait for tiles and logos to render
console.log('Retailers loaded — waiting for tiles...');
await new Promise(r => setTimeout(r, 6000));

// Find and click Export Image button
const exportBtn = await page.evaluateHandle(() => {
  const btns = [...document.querySelectorAll('button')];
  return btns.find(b => {
    const t = b.textContent.toLowerCase();
    return (t.includes('export') && t.includes('image')) || t.includes('export png');
  });
});
const exportEl = exportBtn.asElement();
if (!exportEl) {
  console.log('Export Image button not found — buttons available:');
  const btext = await page.evaluate(() =>
    [...document.querySelectorAll('button')].map(b => b.textContent.trim()).join(' | ')
  );
  console.log(btext);
  await browser.close();
  process.exit(1);
}

const beforeFiles = readdirSync(DOWNLOAD_DIR);
await exportEl.click();
console.log('Export clicked — waiting for download...');

// Poll for new PNG file
let downloaded = null;
const deadline = Date.now() + 60000;
while (Date.now() < deadline) {
  const after = readdirSync(DOWNLOAD_DIR);
  const newFiles = after.filter(f => !beforeFiles.includes(f) && (f.endsWith('.png') || f.endsWith('.jpg')));
  if (newFiles.length) { downloaded = join(DOWNLOAD_DIR, newFiles[0]); break; }
  await new Promise(r => setTimeout(r, 500));
}

await browser.close();

if (!downloaded || !existsSync(downloaded)) {
  console.error('Download did not appear in time');
  process.exit(1);
}

// Move to final destination
const outAbs = resolve(outputPath.replace(/^\/c\//, 'C:/').replace(/\//g, '\\'));
renameSync(downloaded, outAbs);

// Validate: blank/all-white PNGs compress to <30KB; real map screenshots are 400KB+.
// Bail out now so the caller (Stella) doesn't send a blank image to Claude.
const { size } = statSync(outAbs);
console.log(`File size: ${(size / 1024).toFixed(1)} KB`);
if (size < 51200) {
  console.error(`ERROR: Image too small (${(size / 1024).toFixed(1)} KB) — likely blank or white. Map may not have rendered.`);
  unlinkSync(outAbs); // remove bad file so Stella doesn't pick it up
  process.exit(1);
}

console.log(`Saved: ${outAbs}`);
