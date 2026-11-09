// Trang "Sales Kit" cho nhân viên (đăng Artifact): xem trước, tải ảnh/PDF/video, sao chép tin nhắn mẫu.
// File ảnh/PDF/video được đăng kèm trang theo đường dẫn tương đối: thumb/, anh/, pdf/, video/.
const fs = require('fs');
const path = require('path');
const { esc } = require('./chung.cjs');

const KIT = path.resolve(__dirname, '..', '..');

function hub(C, S, opts) {
  const { landingUrl, deckUrl } = opts;
  const topics = C.topics.map((t, i) => {
    const n = String(i + 1).padStart(2, '0');
    const base = `${n}-${t.id}`;
    const sc = S.scripts.find((x) => x.id === t.id);
    const caption = fs.readFileSync(path.join(KIT, 'video', `${base}-caption.txt`), 'utf8');
    return { t, n, base, sc, caption };
  });

  const imgCard = (base, kind, label, use, name) => {
    const size = { vuong: '1080x1080', doc: '1080x1350', story: '1080x1920', ngang: '1200x628' }[kind];
    const file = `${base}-${kind}-${size}.png`;
    return `<figure class="thumb ${kind}">
      <img src="thumb/${file.replace('.png', '.jpg')}" alt="${esc(label)}" loading="lazy">
      <figcaption><b>${esc(label)}</b><span>${esc(use)}</span>
      <button type="button" class="btn dl" data-file="anh/${file}" data-name="${esc(name || `akaAgent-Zalo-${file}`)}">Tải ảnh</button></figcaption>
    </figure>`;
  };

  const copyBlock = (id, text) => `<pre class="copytext" id="${id}">${esc(text)}</pre>`;
  const msgsHtml = (key, messages) => messages.map((m, k) => `
        <article class="msg">
          <header><span class="step">${k + 1}</span><b>${esc(m.label)}</b><button type="button" class="btn ghost copy" data-target="m-${key}-${k}">Sao chép</button></header>
          ${copyBlock(`m-${key}-${k}`, m.text)}
        </article>`).join('');
  const qasHtml = (key, faq) => faq.map((f, k) => `
        <details class="qa"><summary>${esc(f.q)}</summary>
          ${copyBlock(`q-${key}-${k}`, f.a)}
          <button type="button" class="btn ghost copy" data-target="q-${key}-${k}">Sao chép câu trả lời</button>
        </details>`).join('');

  const panels = topics.map(({ t, n, base, sc, caption }, i) => `
<section class="panel" id="p-${t.id}" data-tab="${t.id}" role="tabpanel" aria-labelledby="tab-${t.id}"${i === 0 ? '' : ' hidden'}>
  <div class="panel-head">
    <span class="kicker">Chủ đề ${i + 1}/5</span>
    <h2>${esc(sc.title)}</h2>
    <p class="when"><b>Khi nào dùng:</b> ${esc(sc.when)}</p>
  </div>
  <div class="grid">
    <div class="col">
      <h3>Ảnh gửi khách</h3>
      <div class="thumbs">
        ${imgCard(base, 'vuong', 'Ảnh vuông 1:1', 'Gửi kèm tin mở đầu, đăng bài')}
        ${imgCard(base, 'doc', 'Ảnh dọc 4:5', 'Giải thích cách hoạt động')}
        ${imgCard(base, 'story', 'Ảnh story 9:16', 'Story Zalo, Facebook, TikTok')}
        ${imgCard(base, 'ngang', 'Banner ngang 1200×628', 'Bài đăng có link, website, quảng cáo Facebook')}
      </div>
      <h3>PDF & video</h3>
      <div class="files">
        <div class="file">
          <div><b>Tờ giới thiệu 1 trang (PDF A4)</b><span>Gửi file khi khách muốn đọc kỹ, in được</span></div>
          <button type="button" class="btn dl" data-file="pdf/to-gioi-thieu-${base}.pdf" data-name="akaAgent-Zalo-to-gioi-thieu-${base}.pdf">Tải PDF</button>
        </div>
        <div class="file video">
          <video controls preload="none" playsinline poster="thumb/${base}-story-1080x1920.jpg" src="video/${base}-9x16.mp4"></video>
          <div class="vmeta"><b>Video dọc 27 giây</b><span>TikTok, Reels, story; gửi khách thích xem video. Thêm nhạc thịnh hành khi đăng.</span>
            <div class="row"><button type="button" class="btn dl" data-file="video/${base}-9x16.mp4" data-name="akaAgent-Zalo-video-${base}.mp4">Tải video</button>
            <button type="button" class="btn ghost copy" data-target="cap-${t.id}">Sao chép caption</button></div>
          </div>
        </div>
        <details class="caption"><summary>Xem caption & hashtag</summary>${copyBlock(`cap-${t.id}`, caption.trim())}</details>
      </div>
    </div>
    <div class="col">
      <h3>Tin nhắn mẫu theo thứ tự</h3>
      <div class="msgs">${msgsHtml(t.id, sc.messages)}
      </div>
      <h3>Khách hỏi gì, trả lời gì</h3>
      <div class="qas">${qasHtml(t.id, sc.faq)}
      </div>
      ${sc.note ? `<p class="note"><b>Lưu ý nội bộ:</b> ${esc(sc.note)}</p>` : ''}
      <p class="attach"><b>Gửi kèm gợi ý:</b> ${esc(sc.attach.join(' · '))}</p>
    </div>
  </div>
</section>`).join('');

  const P = C.pricing;
  const ps = S.pricing;
  const gb = `06-${P.id}`;
  const gName = (kind) => `akaAgent-Zalo-Web-bang-gia-${kind}.png`;
  const pricingPdf = 'bang-gia-akaAgent-Zalo-Web-A4.pdf';
  const pricing = `
<section class="panel" id="p-bang-gia" data-tab="bang-gia" role="tabpanel" aria-labelledby="tab-bang-gia" hidden>
  <div class="panel-head">
    <span class="kicker">Bảng giá · ${esc(P.product)}</span>
    <h2>${esc(ps.title)}</h2>
    <p class="when"><b>Khi nào dùng:</b> ${esc(ps.when)}</p>
  </div>
  <div class="grid">
    <div class="col">
      <h3>Ảnh bảng giá</h3>
      <div class="thumbs">
        ${imgCard(gb, 'vuong', 'Ảnh vuông 1:1', 'Gửi cùng tin báo giá', gName('vuong'))}
        ${imgCard(gb, 'doc', 'Ảnh dọc 4:5', 'Đủ 4 gói và tính năng đi kèm', gName('doc'))}
        ${imgCard(gb, 'story', 'Ảnh story 9:16', 'Story Zalo, Facebook', gName('story'))}
        ${imgCard(gb, 'ngang', 'Banner ngang 1200×628', 'Website, bài đăng có link', gName('ngang'))}
      </div>
      <h3>PDF</h3>
      <div class="files">
        <div class="file">
          <div><b>Bảng giá A4 (PDF 1 trang)</b><span>Khách cần file để in, gửi kế toán; có thêm 3 bước đăng ký</span></div>
          <button type="button" class="btn dl" data-file="pdf/${pricingPdf}" data-name="${pricingPdf}">Tải PDF</button>
        </div>
      </div>
    </div>
    <div class="col">
      <h3>Tin nhắn mẫu theo thứ tự</h3>
      <div class="msgs">${msgsHtml('bang-gia', ps.messages)}
      </div>
      <h3>Khách hỏi gì, trả lời gì</h3>
      <div class="qas">${qasHtml('bang-gia', ps.faq)}
      </div>
      <p class="note"><b>Lưu ý nội bộ:</b> ${esc(ps.note)}</p>
      <p class="attach"><b>Gửi kèm gợi ý:</b> ${esc(ps.attach.join(' · '))}</p>
    </div>
  </div>
</section>`;

  const common = `
<section class="panel" id="p-hoi-chung" data-tab="hoi-chung" role="tabpanel" aria-labelledby="tab-hoi-chung" hidden>
  <div class="panel-head"><span class="kicker">Dùng cho mọi chủ đề</span><h2>Câu hỏi chung & cách nói</h2>
  <p class="when">Trả lời ngắn, nêu một lợi ích, kết bằng một lời mời hành động có mục đích. Không dùng từ gợi rủi ro, không "nhưng", không đáp cụt "không".</p></div>
  <div class="grid">
    <div class="col"><h3>Câu hỏi chung</h3><div class="qas">${S.common.map((f, k) => `
      <details class="qa"${k === 0 ? ' open' : ''}><summary>${esc(f.q)}</summary>${copyBlock(`c-${k}`, f.a)}
      <button type="button" class="btn ghost copy" data-target="c-${k}">Sao chép câu trả lời</button></details>`).join('')}</div></div>
    <div class="col"><h3>5 nguyên tắc khi nhắn khách</h3>
      <ol class="rules">
        <li><b>Nói ngắn.</b> Một tin một ý, 1–3 dòng là đẹp nhất.</li>
        <li><b>Kết bằng lời mời có mục đích.</b> "Mình gửi em SĐT <i>để</i> em mở tài khoản test ngay hôm nay nha."</li>
        <li><b>Nói ở kỳ vọng cao nhất.</b> Nêu điểm mạnh nhất trước: tự động, chạy đều mỗi ngày, có người cài cùng.</li>
        <li><b>Không mang rủi ro cho khách.</b> Thay "khoá nick" bằng "để tài khoản luôn an toàn & bền".</li>
        <li><b>Luôn nói CÓ.</b> Thứ chưa có thì chuyển sang cách mình làm được, không đáp cụt "không".</li>
      </ol>
      <h3>Gửi gì ở giai đoạn nào</h3>
      <ol class="rules">
        <li><b>Khách mới hỏi:</b> tin mở đầu + ảnh vuông của đúng chủ đề.</li>
        <li><b>Khách hỏi cách làm:</b> tin giải thích + ảnh dọc 4:5 hoặc tờ PDF.</li>
        <li><b>Khách còn phân vân:</b> video 27 giây hoặc link trang giới thiệu.</li>
        <li><b>Chốt:</b> tin mời dùng thử, xin SĐT chưa đăng ký akaBiz.</li>
        <li><b>Khách hỏi giá:</b> ảnh bảng giá + tin báo giá ở tab Bảng giá.</li>
      </ol>
    </div>
  </div>
</section>`;

  const all = `
<section class="panel" id="p-tron-bo" data-tab="tron-bo" role="tabpanel" aria-labelledby="tab-tron-bo" hidden>
  <div class="panel-head"><span class="kicker">Trọn bộ</span><h2>Brochure, tờ giới thiệu, bảng giá, video, trang web</h2>
  <p class="when">Brochure 8 trang giới thiệu đủ cả 4 kiểu chiến dịch, hợp gửi khách doanh nghiệp hoặc in ra khi gặp trực tiếp.</p></div>
  <div class="grid">
    <div class="col">
      <figure class="thumb brochure"><img src="thumb/brochure-bia.jpg" alt="Bìa brochure akaAgent Zalo" loading="lazy">
        <figcaption><b>Brochure A4 · 8 trang</b><span>Bìa, giới thiệu, 4 chiến dịch, an toàn & hỏi đáp, bìa sau</span>
        <button type="button" class="btn dl" data-file="pdf/akaAgent-Zalo-brochure-A4.pdf" data-name="akaAgent-Zalo-brochure-A4.pdf">Tải brochure PDF</button></figcaption></figure>
    </div>
    <div class="col">
      <h3>Tờ giới thiệu 1 trang</h3>
      <div class="files">${topics.map(({ t, base }) => `<div class="file"><div><b>${esc(t.short)}</b><span>PDF A4</span></div><button type="button" class="btn dl" data-file="pdf/to-gioi-thieu-${base}.pdf" data-name="akaAgent-Zalo-to-gioi-thieu-${base}.pdf">Tải PDF</button></div>`).join('')}</div>
      <h3>Bảng giá ${esc(P.product)}</h3>
      <div class="files"><div class="file"><div><b>Bảng giá A4</b><span>PDF 1 trang · gửi riêng khi khách hỏi giá</span></div><button type="button" class="btn dl" data-file="pdf/${pricingPdf}" data-name="${pricingPdf}">Tải PDF</button></div></div>
      <h3>Video dọc</h3>
      <div class="files">${topics.map(({ t, base }) => `<div class="file"><div><b>${esc(t.short)}</b><span>MP4 · 1080×1920 · 27 giây</span></div><button type="button" class="btn dl" data-file="video/${base}-9x16.mp4" data-name="akaAgent-Zalo-video-${base}.mp4">Tải video</button></div>`).join('')}</div>
      <h3>Slide thuyết trình</h3>
      <div class="files"><div class="file"><div><b>Slide 16:9 · 13 trang, có ghi chú thuyết trình</b><span>Trình chiếu khi demo online, tải PPTX hoặc PDF từ trang slide.</span></div>${deckUrl ? `<a class="btn" href="${esc(deckUrl)}" target="_blank" rel="noopener">Mở slide</a>` : ''}</div></div>
      <h3>Trang giới thiệu (gửi link)</h3>
      <div class="files"><div class="file"><div><b>Trang web akaAgent Zalo</b><span>Mở cho khách xem trên điện thoại. Chủ tài khoản cần bật chia sẻ trong menu Share trước khi gửi.</span></div>${landingUrl ? `<a class="btn" href="${esc(landingUrl)}" target="_blank" rel="noopener">Mở trang</a>` : ''}</div></div>
    </div>
  </div>
</section>`;

  const tabs = [
    ...topics.map(({ t }, i) => ({ id: t.id, label: `${i + 1}. ${t.short}` })),
    { id: 'bang-gia', label: 'Bảng giá' },
    { id: 'hoi-chung', label: 'Câu hỏi chung' },
    { id: 'tron-bo', label: 'Trọn bộ file' },
  ];

  return `<title>Sales Kit akaAgent Zalo</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;500;600;700;800&display=swap">
<style>
:root{
  /* Bố cục: dải đầu trang tối theo logo, thanh chủ đề dính trên cùng, mỗi chủ đề hai cột (file | tin nhắn) */
  --bg:#F2F4FA; --surface:#FFFFFF; --surface-2:#EAEFF8; --line:#D9E1EF; --text:#0B1222; --muted:#4E5A76;
  --accent:#E8411A; --accent-ink:#FFFFFF; --blue:#1F55E0; --blue-soft:#E3EAFF; --note:#FFF1EA; --note-text:#5B1F0E;
  --head-bg:#070A14; --head-text:#EEF2FF; --head-muted:#A6B1CF; --code:#F7F9FD;
  --font:"Be Vietnam Pro","Segoe UI",system-ui,-apple-system,Arial,sans-serif;
}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){
  --bg:#0A0E1A; --surface:#121931; --surface-2:#18213D; --line:#26314F; --text:#E8EDFB; --muted:#A3AECB;
  --accent:#FF5A2E; --accent-ink:#FFFFFF; --blue:#7FA3FF; --blue-soft:#1B2852; --note:#2A1810; --note-text:#FFD9C7;
  --head-bg:#05070F; --head-text:#EEF2FF; --head-muted:#A6B1CF; --code:#0E1428; color-scheme:dark}}
:root[data-theme="dark"]{
  --bg:#0A0E1A; --surface:#121931; --surface-2:#18213D; --line:#26314F; --text:#E8EDFB; --muted:#A3AECB;
  --accent:#FF5A2E; --accent-ink:#FFFFFF; --blue:#7FA3FF; --blue-soft:#1B2852; --note:#2A1810; --note-text:#FFD9C7;
  --head-bg:#05070F; --head-text:#EEF2FF; --head-muted:#A6B1CF; --code:#0E1428; color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font-family:var(--font);font-size:15px;line-height:1.55;-webkit-font-smoothing:antialiased}
h1,h2,h3{margin:0;letter-spacing:-.015em;text-wrap:balance;line-height:1.2}
p{margin:0}
.wrap{max-width:1180px;margin:0 auto;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px))}
.top{background:radial-gradient(520px 320px at 100% 0%,rgba(255,74,31,.26),transparent 70%),radial-gradient(560px 360px at 0% 100%,rgba(37,99,255,.3),transparent 70%),var(--head-bg);color:var(--head-text)}
.top .wrap{padding-block:26px 30px;display:flex;flex-direction:column;gap:14px}
.brand{display:flex;align-items:center;gap:10px;font-weight:800}
.brand .mark{width:34px;height:34px;border-radius:9px;display:block}
.brand span{font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--head-muted);font-weight:700}
.top h1{font-size:clamp(24px,3.4vw,34px);font-weight:800}
.top p{color:var(--head-muted);max-width:760px}
.flow{display:flex;flex-wrap:wrap;gap:8px;margin-top:4px}
.flow span{padding:6px 12px;border-radius:999px;background:rgba(255,255,255,.07);box-shadow:inset 0 0 0 1px rgba(255,255,255,.14);font-size:13px;font-weight:600}
.flow span b{color:#FF8A5C;margin-right:6px}
.tabs-bar{position:sticky;top:env(safe-area-inset-top,0px);z-index:5;background:var(--surface);border-bottom:1px solid var(--line)}
body::before{content:"";position:fixed;inset:0 0 auto;height:env(safe-area-inset-top,0px);z-index:10;background:var(--surface)}
.tabs{display:flex;gap:6px;overflow-x:auto;padding-block:10px;scrollbar-width:none}
.tabs::-webkit-scrollbar{display:none}
.tab{flex:0 0 auto;border:0;cursor:pointer;font:inherit;font-weight:700;font-size:14px;padding:9px 14px;border-radius:999px;background:var(--surface-2);color:var(--muted)}
.tab[aria-selected="true"]{background:var(--blue);color:#fff}
.tab:focus-visible,.btn:focus-visible,summary:focus-visible{outline:3px solid var(--blue);outline-offset:2px}
main.wrap{padding-block:26px 60px}
.panel-head{display:flex;flex-direction:column;gap:8px;margin-bottom:20px}
.kicker{font-size:12px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--accent)}
.panel-head h2{font-size:clamp(22px,2.8vw,28px);font-weight:800}
.when{color:var(--muted);max-width:820px}
.when b{color:var(--text)}
.grid{display:grid;grid-template-columns:1.05fr 1fr;gap:28px;align-items:start}
.col{display:flex;flex-direction:column;gap:14px;min-width:0}
.col h3{font-size:13px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);margin-top:6px}
.thumbs{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;align-items:stretch}
.thumb{margin:0;background:var(--surface);border-radius:14px;box-shadow:inset 0 0 0 1px var(--line);overflow:hidden;display:flex;flex-direction:column;min-width:0}
.thumb img{display:block;width:100%;height:auto;background:#0b1020}
.thumb figcaption{display:flex;flex-direction:column;gap:4px;padding:10px 10px 12px;flex:1}
.thumb figcaption b{font-size:13.5px}
.thumb figcaption span{font-size:12.5px;color:var(--muted);line-height:1.4;flex:1}
.thumb .btn{margin-top:6px}
.thumb.brochure{max-width:360px}
.thumb.ngang{grid-column:1 / -1;flex-direction:row}
.thumb.ngang img{width:58%;flex:0 0 auto}
@media (max-width:520px){.thumb.ngang{flex-direction:column}.thumb.ngang img{width:100%}}
.files{display:flex;flex-direction:column;gap:10px}
.file{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 14px;border-radius:14px;background:var(--surface);box-shadow:inset 0 0 0 1px var(--line)}
.file > div{display:flex;flex-direction:column;min-width:0}
.file b{font-size:14.5px}
.file span{font-size:13px;color:var(--muted)}
.file.video{align-items:flex-start;justify-content:flex-start}
.file.video video{width:132px;aspect-ratio:9/16;border-radius:10px;background:#000;flex:0 0 auto}
.vmeta{display:flex;flex-direction:column;gap:4px;min-width:0}
.vmeta .row{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:40px;padding:8px 14px;border:0;border-radius:10px;font:inherit;font-weight:800;font-size:13.5px;cursor:pointer;background:var(--accent);color:var(--accent-ink);text-decoration:none;white-space:nowrap}
.btn.ghost{background:var(--blue-soft);color:var(--blue)}
.btn[disabled]{opacity:.6;cursor:progress}
.msgs{display:flex;flex-direction:column;gap:10px}
.msg{background:var(--surface);border-radius:14px;box-shadow:inset 0 0 0 1px var(--line);overflow:hidden}
.msg header{display:flex;align-items:center;gap:10px;padding:10px 12px;border-bottom:1px solid var(--line)}
.msg header b{flex:1;font-size:14.5px}
.step{width:26px;height:26px;border-radius:8px;display:grid;place-items:center;background:var(--accent);color:#fff;font-size:13px;font-weight:800}
.copytext{margin:0;padding:12px 14px;white-space:pre-wrap;word-break:break-word;font-family:var(--font);font-size:14.5px;line-height:1.6;background:var(--code);color:var(--text);user-select:text}
.qas{display:flex;flex-direction:column;gap:8px}
.qa{background:var(--surface);border-radius:14px;box-shadow:inset 0 0 0 1px var(--line);padding:2px 14px 2px}
.qa summary{cursor:pointer;font-weight:800;font-size:14.5px;padding:12px 0;list-style:none;display:flex;justify-content:space-between;gap:10px}
.qa summary::-webkit-details-marker{display:none}
.qa summary::after{content:"+";color:var(--blue);font-size:20px;line-height:1;flex:0 0 auto}
.qa[open] summary::after{content:"–"}
.qa .copytext{border-radius:10px;margin-bottom:10px}
.qa .btn{margin-bottom:12px}
.caption summary{cursor:pointer;font-weight:700;font-size:14px;color:var(--blue);padding:4px 0}
.caption .copytext{border-radius:12px;margin-top:8px;box-shadow:inset 0 0 0 1px var(--line)}
.note{padding:12px 14px;border-radius:12px;background:var(--note);color:var(--note-text);font-size:14px}
.attach{font-size:13.5px;color:var(--muted)}
.attach b{color:var(--text)}
.rules{margin:0;padding-left:20px;display:flex;flex-direction:column;gap:8px}
.rules li{line-height:1.55}
.toast{position:fixed;left:50%;bottom:calc(20px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);background:#0B1222;color:#fff;padding:10px 16px;border-radius:999px;font-weight:700;font-size:14px;box-shadow:0 10px 30px rgba(0,0,0,.25);z-index:20;max-width:calc(100% - 32px)}
@media (max-width:900px){.grid{grid-template-columns:1fr}}
@media (max-width:520px){.thumbs{grid-template-columns:1fr 1fr}.thumb.story{grid-column:span 2;max-width:60%}.file{flex-wrap:wrap}.file.video video{width:110px}}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
</style>

<header class="top"><div class="wrap">
  <div class="brand"><img class="mark" src="thumb/akabiz-logo.png" alt="" width="34" height="34"><div>akaAgent Zalo<br><span>Sales Kit nội bộ</span></div></div>
  <h1>Bộ tài liệu gửi khách akaAgent Zalo</h1>
  <p>Chọn chủ đề khách đang quan tâm, tải ảnh hoặc PDF, sao chép tin nhắn mẫu và gửi qua Zalo. Trên điện thoại, nút Tải mở bảng chia sẻ để gửi thẳng vào Zalo.</p>
  <div class="flow"><span><b>1</b>Tin mở đầu + ảnh vuông</span><span><b>2</b>Khách hỏi: ảnh dọc hoặc PDF</span><span><b>3</b>Phân vân: video hoặc trang giới thiệu</span><span><b>4</b>Chốt: mời dùng thử 3 ngày</span><span><b>5</b>Hỏi giá: ảnh bảng giá + tin báo giá</span></div>
</div></header>
<div class="tabs-bar"><div class="wrap"><div class="tabs" role="tablist" aria-label="Chủ đề">
  ${tabs.map((x, i) => `<button type="button" class="tab" role="tab" id="tab-${x.id}" aria-controls="p-${x.id}" aria-selected="${i === 0}" data-go="${x.id}">${esc(x.label)}</button>`).join('')}
</div></div></div>
<main class="wrap">
${panels}
${pricing}
${common}
${all}
</main>
<div class="toast" role="status" aria-live="polite" hidden></div>
<script>
(function(){
  var ids = ${JSON.stringify(tabs.map((x) => x.id))};
  var toastEl = document.querySelector('.toast'); var tt;
  function toast(msg){ toastEl.textContent = msg; toastEl.hidden = false; clearTimeout(tt); tt = setTimeout(function(){ toastEl.hidden = true; }, 2600); }
  function show(id){
    if (ids.indexOf(id) < 0) id = ids[0];
    document.querySelectorAll('.panel').forEach(function(p){ p.hidden = p.getAttribute('data-tab') !== id; });
    document.querySelectorAll('.tab').forEach(function(t){ t.setAttribute('aria-selected', String(t.getAttribute('data-go') === id)); });
    var active = document.getElementById('tab-' + id); if (active && active.scrollIntoView) active.scrollIntoView({block:'nearest', inline:'nearest'});
    try { localStorage.setItem('saleskit-tab', id); } catch (e) {}
  }
  document.querySelectorAll('.tab').forEach(function(t){
    t.addEventListener('click', function(){ var id = t.getAttribute('data-go'); if (location.hash !== '#' + id) location.hash = id; else show(id); window.scrollTo({top:0}); });
  });
  window.addEventListener('hashchange', function(){ show(location.hash.slice(1)); });
  var start = location.hash.slice(1);
  if (!start) { try { start = localStorage.getItem('saleskit-tab') || ''; } catch (e) {} }
  show(start);

  // Sao chép tin nhắn
  function selectText(el){ var r = document.createRange(); r.selectNodeContents(el); var s = window.getSelection(); s.removeAllRanges(); s.addRange(r); }
  document.addEventListener('click', function(ev){
    var b = ev.target.closest && ev.target.closest('.copy'); if (!b) return;
    var el = document.getElementById(b.getAttribute('data-target')); if (!el) return;
    var text = el.textContent;
    var done = function(){ toast('Đã sao chép, dán vào Zalo để gửi'); };
    var fallback = function(){ var d = el.closest('details'); if (d) d.open = true; selectText(el); toast('Đã bôi đen nội dung, bấm giữ để sao chép'); };
    try { if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text).then(done, fallback); } else { fallback(); } } catch (e) { fallback(); }
  });

  // Tải file (ảnh, PDF, video) qua quyền tải xuống của trang
  var downloads = null;
  function noDownloads(){
    document.querySelectorAll('.dl').forEach(function(b){
      var a = document.createElement('a'); a.className = b.className.replace('dl', 'open'); a.href = b.getAttribute('data-file');
      a.target = '_blank'; a.rel = 'noopener'; a.textContent = 'Mở file'; b.replaceWith(a);
    });
  }
  if (window.claude && window.claude.use) {
    window.claude.use('downloads').then(function(ns){ downloads = ns; if (!ns) noDownloads(); }, noDownloads);
  } else { noDownloads(); }
  document.addEventListener('click', function(ev){
    var b = ev.target.closest && ev.target.closest('.dl'); if (!b || !downloads) return;
    var file = b.getAttribute('data-file'), name = b.getAttribute('data-name'); var label = b.textContent;
    b.disabled = true; b.textContent = 'Đang chuẩn bị...';
    fetch(file).then(function(r){ if (!r.ok) throw new Error('HTTP ' + r.status); return r.blob(); })
      .then(function(blob){ return downloads.save({ filename: name, data: blob }); })
      .then(function(res){ toast(res && res.status === 'delivered' ? 'Đã gửi file' : 'Đã lưu ' + name); })
      .catch(function(e){
        var code = e && e.code;
        if (code === 'declined') toast('Đã huỷ tải');
        else if (code === 'rate_limited') toast('Đang có một lượt tải chờ xác nhận, thử lại sau giây lát');
        else toast('Chưa tải được file, thử lại hoặc dùng nút Mở file');
      })
      .then(function(){ b.disabled = false; b.textContent = label; });
  });
})();
</script>`;
}

module.exports = { hub };
