// Quay một trang HTML có CSS animation thành video MP4, từng khung hình một (không phụ thuộc tốc độ máy).
// Dùng: node quay-video.cjs <trang.html> <ra.mp4> <so-giay> [fps=30] [rong=1080] [cao=1920]
// Trang phải dùng CSS animation (animation-delay để xếp cảnh); script dừng mọi animation rồi tua tới từng mốc thời gian.
const path = require('path');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright');

async function main() {
  const [html, out, secondsArg, fpsArg, wArg, hArg] = process.argv.slice(2);
  if (!html || !out || !secondsArg) throw new Error('Dùng: node quay-video.cjs <trang.html> <ra.mp4> <so-giay> [fps] [rong] [cao]');
  const seconds = Number(secondsArg);
  const fps = Number(fpsArg || 30);
  const width = Number(wArg || 1080);
  const height = Number(hArg || 1920);
  const total = Math.round(seconds * fps);

  const ff = spawn('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart', '-r', String(fps), out,
  ], { stdio: ['pipe', 'inherit', 'inherit'] });
  const ffDone = new Promise((resolve, reject) => {
    ff.on('close', (code) => (code === 0 ? resolve() : reject(new Error('ffmpeg thoát mã ' + code))));
  });

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(path.resolve(html)).href, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => { document.getAnimations().forEach((a) => a.pause()); });
    for (let i = 0; i < total; i++) {
      const t = (i * 1000) / fps;
      await page.evaluate((ms) => { document.getAnimations().forEach((a) => { a.currentTime = ms; }); }, t);
      const buf = await page.screenshot({ type: 'jpeg', quality: 95 });
      if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
      if (i % (fps * 5) === 0) process.stdout.write(`  ${path.basename(out)} ${Math.round((i / total) * 100)}%\n`);
    }
  } finally {
    ff.stdin.end();
    await browser.close();
  }
  await ffDone;
  console.log(`ok   ${out} (${seconds}s, ${fps}fps)`);
}

main().catch((err) => { console.error(err); process.exit(1); });
