// Dựng HTML video cho 5 chủ đề rồi quay lần lượt thành MP4 + ghi caption/hashtag.
// Dùng: node quay-tat-ca-video.cjs [chi-so-chu-de...]   (bỏ trống = cả 5)
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { topics } = require('./noi-dung.cjs');
const { video, DURATION } = require('./mau/video.cjs');
const { captionFor } = require('./caption.cjs');

const KIT = path.resolve(__dirname, '..');
const pick = process.argv.slice(2).map(Number);
const list = topics.map((t, i) => ({ t, i })).filter(({ i }) => !pick.length || pick.includes(i + 1));

for (const { t, i } of list) {
  const n = String(i + 1).padStart(2, '0');
  const htmlFile = path.join(__dirname, '_html', 'video', `${n}-${t.id}.html`);
  fs.mkdirSync(path.dirname(htmlFile), { recursive: true });
  fs.writeFileSync(htmlFile, video(t));
  const outDir = path.join(KIT, 'video');
  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, `${n}-${t.id}-9x16.mp4`);
  execFileSync('node', [path.join(__dirname, 'quay-video.cjs'), htmlFile, out, String(DURATION), '30'], { stdio: 'inherit' });
  fs.writeFileSync(path.join(outDir, `${n}-${t.id}-caption.txt`), captionFor(t));
}
console.log('XONG tất cả video');
