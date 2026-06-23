// Renders demo/index.html (which auto-plays a KB-grounded conversation) and
// captures screenshots proving the widget works. Run:
//   NODE_PATH=/opt/node22/lib/node_modules node demo/screenshot.cjs
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1100, height: 820 } });

  const url = 'file://' + path.join(__dirname, 'index.html');
  await page.goto(url, { waitUntil: 'domcontentloaded' }).catch(() => {});

  // Panel auto-opens (~700ms) and shows the greeting before the script starts.
  await page.waitForSelector('#fitc-panel.open', { timeout: 5000 });
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(__dirname, 'shot-1-greeting.png') });
  console.log('captured shot-1-greeting.png');

  // Let the first couple of scripted turns play, then capture the conversation.
  await page.waitForTimeout(5200);
  await page.evaluate(() => {
    const m = document.querySelector('#fitc-msgs');
    if (m) m.scrollTop = 0;
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(__dirname, 'shot-2-conversation.png') });
  console.log('captured shot-2-conversation.png');

  // Wait for the final reply + booking card, scroll its heading into view.
  await page.waitForSelector('.fitc-book', { timeout: 8000 });
  await page.waitForTimeout(900);
  await page.evaluate(() => {
    const card = document.querySelector('.fitc-book');
    if (card) card.scrollIntoView({ block: 'start' });
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(__dirname, 'shot-3-booking.png') });
  console.log('captured shot-3-booking.png');

  await browser.close();
})().catch(e => { console.error('screenshot failed:', e); process.exit(1); });
