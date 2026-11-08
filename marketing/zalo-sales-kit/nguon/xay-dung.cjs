// Dựng toàn bộ Sales Kit từ noi-dung.cjs.
// Dùng: node xay-dung.cjs [anh|a4|video|tat-ca]   (mặc định: anh + a4)
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = __dirname;                     // .../zalo-sales-kit/nguon
const KIT = path.resolve(ROOT, '..');        // .../zalo-sales-kit
const HTML = path.join(ROOT, '_html');       // HTML trung gian (không commit)
const C = require('./noi-dung.cjs');
const { topics } = C;

const vuong = require('./mau/vuong.cjs');
const doc45 = require('./mau/doc45.cjs');
const story = require('./mau/story.cjs');
const ngang = require('./mau/ngang.cjs');
const a4 = require('./mau/a4.cjs');

const what = process.argv[2] || 'anh+a4';
const want = (k) => what === 'tat-ca' || what.split('+').includes(k);

function write(rel, html) {
  const file = path.join(HTML, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, html);
  return file;
}

function render(jobs) {
  const jobsFile = path.join(HTML, `jobs-${Date.now()}.json`);
  fs.writeFileSync(jobsFile, JSON.stringify(jobs, null, 2));
  execFileSync('node', [path.join(ROOT, 'render.cjs'), jobsFile], { stdio: 'inherit' });
}

const jobs = [];

if (want('anh')) {
  topics.forEach((t, i) => {
    const n = String(i + 1).padStart(2, '0');
    const base = `${n}-${t.id}`;
    jobs.push({ html: write(`anh/${base}-vuong.html`, vuong(t)), out: path.join(KIT, 'anh', `${base}`, `${base}-vuong-1080x1080.png`), width: 1080, height: 1080 });
    jobs.push({ html: write(`anh/${base}-doc.html`, doc45(t)), out: path.join(KIT, 'anh', `${base}`, `${base}-doc-1080x1350.png`), width: 1080, height: 1350 });
    jobs.push({ html: write(`anh/${base}-story.html`, story(t)), out: path.join(KIT, 'anh', `${base}`, `${base}-story-1080x1920.png`), width: 1080, height: 1920 });
    jobs.push({ html: write(`anh/${base}-ngang.html`, ngang(t)), out: path.join(KIT, 'anh', `${base}`, `${base}-ngang-1200x628.png`), width: 1200, height: 628 });
  });
}

if (want('a4')) {
  // Trang bìa + 5 trang chủ đề + trang an toàn/bắt đầu + bìa sau: dựng trong mau/brochure.cjs
  const brochure = require('./mau/brochure.cjs');
  const full = brochure.full(C);
  jobs.push({ html: write('a4/brochure.html', full), out: path.join(KIT, 'pdf', 'akaAgent-Zalo-brochure-A4.pdf'), width: a4.PW, height: a4.PH, pdf: { format: 'A4' } });
  // Tờ giới thiệu một trang cho từng chủ đề
  topics.forEach((t, i) => {
    const n = String(i + 1).padStart(2, '0');
    jobs.push({ html: write(`a4/to-${n}-${t.id}.html`, brochure.single(C, i)), out: path.join(KIT, 'pdf', `to-gioi-thieu-${n}-${t.id}.pdf`), width: a4.PW, height: a4.PH, pdf: { format: 'A4' } });
  });
}


// Landing page: bản tự host (landing/index.html) + bản đăng Artifact (_html/landing-artifact.html)
if (want('landing')) {
  const { landing } = require('./mau/landing.cjs');
  const outDir = path.join(KIT, 'landing');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'index.html'), landing(C, { standalone: true }));
  fs.writeFileSync(path.join(HTML, 'landing-artifact.html'), landing(C, { standalone: false }));
  console.log('ok   ' + path.join(outDir, 'index.html'));
}

if (jobs.length) render(jobs);
