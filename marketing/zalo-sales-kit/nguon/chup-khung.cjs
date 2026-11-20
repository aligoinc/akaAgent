// Chụp vài khung hình tĩnh từ trang video (để soát bố cục trước khi quay cả video).
// Dùng: node chup-khung.cjs <trang.html> <thu-muc-ra> <giay1,giay2,...> [rong=1080] [cao=1920]
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright');

(async () => {
  const [html, outDir, timesArg, wArg, hArg] = process.argv.slice(2);
  const times = timesArg.split(',').map(Number);
  const width = Number(wArg || 1080), height = Number(hArg || 1920);
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width, height } });
  await page.goto(pathToFileURL(path.resolve(html)).href, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => document.getAnimations().forEach((a) => a.pause()));
  for (const s of times) {
    await page.evaluate((ms) => document.getAnimations().forEach((a) => { a.currentTime = ms; }), s * 1000);
    const out = path.join(outDir, `khung-${String(s).replace('.', '_')}s.png`);
    await page.screenshot({ path: out });
    console.log(out);
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
