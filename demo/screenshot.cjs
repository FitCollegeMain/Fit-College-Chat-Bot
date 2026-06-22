// Renders demo/index.html, drives a short canned conversation, and captures
// screenshots proving the widget works. Run:
//   NODE_PATH=/opt/node22/lib/node_modules node demo/screenshot.cjs
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1100, height: 820 } });

  const url = 'file://' + path.join(__dirname, 'index.html');
  await page.goto(url, { waitUntil: 'domcontentloaded' }).catch(() => {});

  // Panel auto-opens (~700ms) and shows the greeting.
  await page.waitForSelector('#fitc-panel.open', { timeout: 5000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(__dirname, 'shot-1-greeting.png') });
  console.log('captured shot-1-greeting.png');

  // Turn 1 — substantive canned answer, no booking card yet.
  await page.fill('#fitc-input', 'How long does the Certificate III in Fitness take?');
  await page.click('#fitc-send');
  await page.waitForSelector('.fitc-row.bot .fitc-bubble', { timeout: 5000 });
  await page.waitForTimeout(1100);
  await page.screenshot({ path: path.join(__dirname, 'shot-2-conversation.png') });
  console.log('captured shot-2-conversation.png');

  // Turn 2 — a second user turn triggers the booking card in demo mode.
  await page.fill('#fitc-input', "I'm new to the industry and want to study around work.");
  await page.click('#fitc-send');
  await page.waitForSelector('.fitc-book', { timeout: 5000 });
  await page.waitForTimeout(1000);
  // Scroll the booking card's heading into view (instead of the calendar iframe).
  await page.evaluate(() => {
    const card = document.querySelector('.fitc-book');
    if (card) card.scrollIntoView({ block: 'start' });
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(__dirname, 'shot-3-booking.png') });
  console.log('captured shot-3-booking.png');

  await browser.close();
})().catch(e => { console.error('screenshot failed:', e); process.exit(1); });
