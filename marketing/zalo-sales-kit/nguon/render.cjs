// Chụp các trang HTML đã dựng thành PNG/PDF bằng Chromium (Playwright).
// Dùng: node render.cjs <jobs.json>
// jobs.json: [{ "html": "đường/dẫn.html", "out": "anh.png", "width": 1080, "height": 1350 }
//            | { "html": "...", "out": "file.pdf", "pdf": { "format": "A4" } }]
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright');

async function main() {
  const jobsFile = process.argv[2];
  if (!jobsFile) throw new Error('Thiếu đường dẫn jobs.json');
  const jobs = JSON.parse(fs.readFileSync(jobsFile, 'utf8'));
  const browser = await chromium.launch();
  try {
    for (const job of jobs) {
      const page = await browser.newPage({
        viewport: { width: job.width || 1080, height: job.height || 1080 },
        deviceScaleFactor: job.scale || 1,
      });
      await page.goto(pathToFileURL(path.resolve(job.html)).href, { waitUntil: 'load' });
      await page.evaluate(() => document.fonts.ready);
      // Báo lỗi nếu chữ tràn khỏi khung (phần tử có data-fit).
      const overflow = await page.evaluate(() => {
        const bad = [];
        document.querySelectorAll('[data-fit]').forEach((el) => {
          if (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1) {
            bad.push(`${el.getAttribute('data-fit')} (${el.scrollWidth}x${el.scrollHeight} > ${el.clientWidth}x${el.clientHeight})`);
          }
        });
        return bad;
      });
      fs.mkdirSync(path.dirname(path.resolve(job.out)), { recursive: true });
      if (job.pdf) {
        await page.emulateMedia({ media: 'print' });
        await page.pdf({ path: job.out, printBackground: true, preferCSSPageSize: true, ...job.pdf });
      } else {
        await page.screenshot({ path: job.out, type: job.out.endsWith('.jpg') ? 'jpeg' : 'png', quality: job.out.endsWith('.jpg') ? 92 : undefined, fullPage: false });
      }
      await page.close();
      console.log(`${overflow.length ? 'TRAN' : 'ok  '} ${job.out}${overflow.length ? '  <- ' + overflow.join('; ') : ''}`);
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
