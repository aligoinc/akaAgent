// Landing page giới thiệu akaAgent Zalo cho khách (gửi link).
// standalone=true: tài liệu HTML đầy đủ để tự host (akabiz.net...). false: bản đăng Artifact (không có <html>/<head>/<body>).
const fs = require('fs');
const path = require('path');
const { esc, rich } = require('./chung.cjs');

const logo = 'data:image/png;base64,' + fs.readFileSync(path.join(__dirname, '..', 'assets', 'akabiz-logo-192.png')).toString('base64');

const css = `
:root{
  /* Layout: hero tối như logo AKABIZ, phần nội dung sáng, mỗi chiến dịch một khối hai cột */
  --ink:#070A14; --ink-2:#0E1428; --ink-line:rgba(255,255,255,.12);
  --paper:#F4F6FB; --card:#FFFFFF; --line:#DCE3F0;
  --text:#0B1222; --muted:#4A5672; --on-dark:#EEF2FF; --muted-dark:#A6B1CF;
  --flame:#FF4A1F; --flame-2:#E5203F; --volt:#2563FF; --volt-deep:#1238B8; --sky:#2BC8F2; --tip:#FFF1EB; --tip-text:#5B1F0E; --chip:#E7EDFF;
  --font:"Be Vietnam Pro","Segoe UI",system-ui,-apple-system,Arial,sans-serif;
  color-scheme:light;
}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
@media (prefers-reduced-motion:reduce){html{scroll-behavior:auto}*{animation:none!important;transition:none!important}}
body{margin:0;background:var(--paper);color:var(--text);font-family:var(--font);font-size:16px;line-height:1.6;-webkit-font-smoothing:antialiased}
h1,h2,h3{margin:0;letter-spacing:-.02em;text-wrap:balance;line-height:1.15}
p{margin:0}
a{color:inherit}
.wrap{max-width:1120px;margin:0 auto;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px))}
.lockup{display:inline-flex;align-items:center;gap:10px;font-weight:800;text-decoration:none}
.lockup img{width:40px;height:40px;border-radius:10px}
.lockup b{display:block;font-size:19px;line-height:1.1}
.lockup b span{color:var(--flame)}
.lockup small{display:block;font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;opacity:.7;font-weight:700}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:48px;padding:12px 22px;border-radius:999px;font-weight:800;font-size:16px;text-decoration:none;border:0;cursor:pointer;transition:transform .15s ease, box-shadow .15s ease}
.btn:focus-visible,a:focus-visible,summary:focus-visible{outline:3px solid var(--sky);outline-offset:3px}
.btn-primary{color:#fff;background:linear-gradient(100deg,#FF6A2B,var(--flame) 45%,var(--flame-2));box-shadow:0 10px 26px rgba(255,74,31,.32)}
.btn-primary:hover{transform:translateY(-1px);box-shadow:0 14px 30px rgba(255,74,31,.4)}
.btn-ghost{color:var(--on-dark);background:rgba(255,255,255,.06);box-shadow:inset 0 0 0 1.5px var(--ink-line)}
.btn-ghost:hover{background:rgba(255,255,255,.1)}
.grad{background:linear-gradient(92deg,#FF7A3D,var(--flame) 40%,#FF2E6A);-webkit-background-clip:text;background-clip:text;color:transparent}
.chip{display:inline-flex;align-items:center;gap:8px;padding:6px 12px;border-radius:999px;font-size:12px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;background:var(--chip);color:var(--volt-deep)}
.chip i{width:7px;height:7px;border-radius:50%;background:var(--flame)}
.eyebrow{font-size:13px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--volt-deep)}

/* Hero */
.hero{position:relative;overflow:hidden;background:
  radial-gradient(640px 520px at 100% 0%,rgba(255,74,31,.26),transparent 70%),
  radial-gradient(760px 560px at 0% 100%,rgba(37,99,255,.32),transparent 70%),var(--ink);color:var(--on-dark)}
.hero .bar{display:flex;align-items:center;justify-content:space-between;gap:12px;padding-block:20px}
.hero .bar a.small{font-size:14px;font-weight:700;text-decoration:none;color:var(--muted-dark)}
.hero-grid{display:grid;grid-template-columns:1.1fr .9fr;gap:40px;align-items:center;padding-block:36px 72px}
.hero-copy{display:flex;flex-direction:column;gap:20px;min-width:0}
.hero .eyebrow{color:#FF8A5C}
.hero h1{font-size:clamp(34px,5.4vw,58px);font-weight:800;line-height:1.06}
.hero p.sub{font-size:clamp(16px,1.8vw,19px);color:var(--muted-dark);max-width:560px}
.hero .actions{display:flex;flex-wrap:wrap;gap:12px}
.hero .note{font-size:14px;color:var(--muted-dark)}
.hero-visual{display:flex;justify-content:center;position:relative;min-width:0}
.ribbon{position:absolute;right:-120px;top:-40px;width:520px;height:620px;pointer-events:none;opacity:.9}

/* Điện thoại minh hoạ */
.phone{width:min(320px,100%);border-radius:36px;padding:12px;background:linear-gradient(160deg,#263257,#0B1124 60%);box-shadow:0 30px 60px rgba(0,0,0,.45),inset 0 0 0 2px rgba(255,255,255,.08);position:relative;z-index:1}
.phone .screen{border-radius:26px;overflow:hidden;background:#EEF2F8;color:#0B1222}
.phone .top{display:flex;align-items:center;gap:10px;padding:16px 14px 12px;background:#fff;border-bottom:1px solid #E3E8F2}
.phone .av{width:36px;height:36px;border-radius:50%;display:grid;place-items:center;color:#fff;font-weight:800;font-size:13px;flex:0 0 auto}
.phone .top b{display:block;font-size:14px;line-height:1.2}
.phone .top small{display:block;font-size:11.5px;color:#6B7790}
.phone .msgs{display:flex;flex-direction:column;gap:8px;padding:14px 12px 18px;min-height:300px}
.bubble{max-width:86%;padding:9px 12px;border-radius:14px;font-size:13.5px;line-height:1.45;background:#fff}
.bubble.me{align-self:flex-end;background:#D9E6FF;border-bottom-right-radius:5px}
.bubble.them{align-self:flex-start;border-bottom-left-radius:5px}
.bubble .img{display:block;height:70px;border-radius:9px;margin-bottom:7px;background:linear-gradient(135deg,#FF8A4C,#FF4A1F 45%,#2563FF)}
.sys{align-self:center;font-size:11px;color:#5A6680;background:rgba(255,255,255,.8);padding:4px 10px;border-radius:999px}

/* Khối chung */
section{padding-block:72px}
.sec-head{display:flex;flex-direction:column;gap:12px;max-width:720px;margin-bottom:32px}
.sec-head h2{font-size:clamp(26px,3.6vw,38px);font-weight:800}
.sec-head p{color:var(--muted);font-size:17px}

/* Trước / sau */
.compare{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.compare .col{border-radius:20px;padding:24px;display:flex;flex-direction:column;gap:14px;min-width:0}
.compare .before{background:#fff;box-shadow:inset 0 0 0 1px var(--line)}
.compare .after{background:var(--ink);color:var(--on-dark)}
.compare h3{font-size:19px;font-weight:800}
.compare ul{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:10px}
.compare li{display:flex;gap:10px;align-items:flex-start;line-height:1.5}
.compare .before li::before{content:"";flex:0 0 auto;width:18px;height:18px;margin-top:3px;border-radius:50%;box-shadow:inset 0 0 0 2px #B8C2D6}
.compare .after li::before{content:"";flex:0 0 auto;width:18px;height:18px;margin-top:3px;border-radius:50%;background:var(--sky) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23070A14' stroke-width='3.4' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M5 12.5l4.2 4.2L19 7'/%3E%3C/svg%3E") center/70% no-repeat}

/* 4 chiến dịch */
.cards4{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}
.card4{display:flex;flex-direction:column;gap:10px;padding:22px;border-radius:20px;background:#fff;box-shadow:inset 0 0 0 1px var(--line);text-decoration:none;color:var(--text);min-width:0;transition:box-shadow .15s ease, transform .15s ease}
.card4:hover{transform:translateY(-2px);box-shadow:inset 0 0 0 1.5px var(--volt),0 10px 24px rgba(18,56,184,.08)}
.card4 .n{width:44px;height:44px;border-radius:14px;display:grid;place-items:center;font-weight:800;color:#fff;background:linear-gradient(140deg,#FF7A3D,var(--flame) 55%,#D61F3C)}
.card4:nth-child(even) .n{background:linear-gradient(140deg,#4C8DFF,var(--volt) 55%,var(--volt-deep))}
.card4 h3{font-size:18px;font-weight:800}
.card4 p{font-size:14.5px;color:var(--muted);line-height:1.55}
.card4 span.more{margin-top:auto;font-size:14px;font-weight:800;color:var(--volt-deep)}

/* Khối chi tiết chiến dịch */
.feature{border-top:1px solid var(--line)}
.feature-grid{display:grid;grid-template-columns:1fr 340px;gap:48px;align-items:start}
.feature.flip .feature-grid{grid-template-columns:340px 1fr}
.feature.flip .feature-visual{order:-1}
.feature-copy{display:flex;flex-direction:column;gap:22px;min-width:0}
.feature-copy .chip{align-self:flex-start}
.feature-copy h2{font-size:clamp(26px,3.4vw,36px);font-weight:800}
.feature-copy > p{color:var(--muted);font-size:17px}
.steps{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:14px;counter-reset:s}
.steps li{display:grid;grid-template-columns:40px 1fr;gap:14px;counter-increment:s}
.steps li::before{content:counter(s);width:40px;height:40px;border-radius:13px;display:grid;place-items:center;font-weight:800;color:#fff;background:linear-gradient(140deg,#FF7A3D,var(--flame) 55%,#D61F3C)}
.steps li:nth-child(even)::before{background:linear-gradient(140deg,#4C8DFF,var(--volt) 55%,var(--volt-deep))}
.steps b{display:block;font-size:17px;line-height:1.3}
.steps span{display:block;color:var(--muted);font-size:15px;margin-top:3px}
.benefits{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.benefit{padding:16px 18px;border-radius:16px;background:#fff;box-shadow:inset 0 0 0 1px var(--line);min-width:0}
.benefit b{display:block;font-size:15.5px;line-height:1.3}
.benefit span{display:block;color:var(--muted);font-size:14px;margin-top:4px;line-height:1.5}
.fitrow{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.fitrow .lbl{font-size:13px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin-right:4px}
.fitrow .f{padding:6px 12px;border-radius:999px;background:var(--chip);color:var(--volt-deep);font-size:13.5px;font-weight:700}
.tip{display:flex;gap:12px;padding:16px 18px;border-radius:16px;background:var(--tip);color:var(--tip-text);font-size:15px;line-height:1.55}
.tip b{flex:0 0 auto;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#C2310F;padding-top:2px}
.feature-visual{position:sticky;top:24px;display:flex;justify-content:center;min-width:0}
.feature-visual .phone{width:100%;max-width:330px}

/* An toàn */
.dark-sec{background:var(--ink);color:var(--on-dark)}
.dark-sec .sec-head p{color:var(--muted-dark)}
.dark-sec .eyebrow{color:#FF8A5C}
.safe{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
.safe div{padding:20px;border-radius:18px;background:rgba(255,255,255,.05);box-shadow:inset 0 0 0 1px var(--ink-line);min-width:0}
.safe b{display:block;font-size:16.5px;line-height:1.3}
.safe span{display:block;margin-top:6px;color:var(--muted-dark);font-size:14.5px;line-height:1.55}
.platforms{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-top:14px}
.platforms div{padding:20px;border-radius:18px;background:linear-gradient(160deg,rgba(37,99,255,.18),rgba(37,99,255,.04));box-shadow:inset 0 0 0 1px rgba(91,141,255,.35);min-width:0}
.platforms b{display:block;font-size:16.5px}
.platforms span{display:block;margin-top:6px;color:var(--muted-dark);font-size:14.5px}

/* Tiện ích */
.tools{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
.tool{padding:20px;border-radius:18px;background:#fff;box-shadow:inset 0 0 0 1px var(--line);min-width:0}
.tool b{display:block;font-size:16.5px;line-height:1.3}
.tool span{display:block;margin-top:6px;color:var(--muted);font-size:14.5px;line-height:1.55}

/* Hỏi đáp */
.faq{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.faq details{background:#fff;border-radius:16px;box-shadow:inset 0 0 0 1px var(--line);padding:4px 18px;min-width:0}
.faq summary{cursor:pointer;font-weight:800;font-size:16px;padding:14px 0;list-style:none;display:flex;justify-content:space-between;gap:12px}
.faq summary::-webkit-details-marker{display:none}
.faq summary::after{content:"+";font-size:22px;line-height:1;color:var(--volt-deep);flex:0 0 auto}
.faq details[open] summary::after{content:"–"}
.faq details p{padding:0 0 16px;color:var(--muted);font-size:15px}

/* Kêu gọi dùng thử */
.cta{position:relative;overflow:hidden;background:
  radial-gradient(560px 420px at 0% 0%,rgba(37,99,255,.3),transparent 70%),
  radial-gradient(560px 420px at 100% 100%,rgba(255,74,31,.3),transparent 70%),var(--ink);color:var(--on-dark);text-align:center}
.cta h2{font-size:clamp(28px,4.4vw,46px);font-weight:800;max-width:760px;margin:0 auto}
.cta p.lead{color:var(--muted-dark);font-size:18px;max-width:620px;margin:14px auto 0}
.cta .steps3{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin:36px auto 0;max-width:900px;text-align:left}
.cta .steps3 div{padding:20px;border-radius:18px;background:rgba(255,255,255,.06);box-shadow:inset 0 0 0 1px var(--ink-line);min-width:0}
.cta .steps3 i{display:block;font-style:normal;font-size:30px;font-weight:800;color:#FF8A5C;line-height:1}
.cta .steps3 b{display:block;margin-top:10px;font-size:16.5px}
.cta .steps3 span{display:block;margin-top:6px;color:var(--muted-dark);font-size:14.5px}
.cta .final{margin-top:34px;display:flex;flex-direction:column;align-items:center;gap:12px}
.cta .final span{color:var(--muted-dark);font-size:15px}
.cta .callout{display:inline-block;padding:14px 24px;border-radius:16px;background:rgba(255,255,255,.07);box-shadow:inset 0 0 0 1.5px rgba(255,138,92,.65);font-weight:800;font-size:17px;color:var(--on-dark)}
footer{background:var(--ink);color:var(--muted-dark);border-top:1px solid var(--ink-line);font-size:14px}
footer .wrap{display:flex;flex-wrap:wrap;justify-content:space-between;gap:10px;padding-block:22px}
footer b{color:var(--on-dark)}

@media (max-width:920px){
  .hero-grid{grid-template-columns:1fr;padding-block:20px 56px}
  .hero-visual{order:2}
  .ribbon{display:none}
  .cards4{grid-template-columns:1fr 1fr}
  .feature-grid,.feature.flip .feature-grid{grid-template-columns:1fr}
  .feature.flip .feature-visual{order:0}
  .feature-visual{position:static}
  .safe,.platforms,.tools{grid-template-columns:1fr 1fr}
}
@media (max-width:600px){
  section{padding-block:52px}
  .compare,.cards4,.benefits,.safe,.platforms,.tools,.faq,.cta .steps3{grid-template-columns:1fr}
  .hero .bar a.small{display:none}
}
`;

function phoneHtml(chat) {
  const initials = (chat.name || '?').split(' ').map((w) => w[0]).slice(-2).join('').toUpperCase();
  const items = chat.items.map((m) => m.t === 'sys'
    ? `<span class="sys">${rich(m.text)}</span>`
    : `<div class="bubble ${m.t}">${m.img ? '<span class="img" aria-hidden="true"></span>' : ''}${rich(m.text)}</div>`).join('');
  return `<div class="phone" role="img" aria-label="Minh hoạ cuộc trò chuyện Zalo với ${esc(chat.name)}"><div class="screen">
  <div class="top"><span class="av" style="background:${chat.avatarColor}">${esc(chat.avatar || initials)}</span><span><b>${esc(chat.name)}</b><small>${esc(chat.sub || '')}</small></span></div>
  <div class="msgs">${items}</div></div></div>`;
}

const ANCHORS = { 'danh-sach-sdt': 'danh-sach-so', 'thanh-vien-nhom': 'thanh-vien-nhom', 'ban-be': 'ban-be', 'nhom-zalo': 'nhom-zalo' };

function body(C) {
  const [intro, ...camps] = C.topics;
  const lock = `<a class="lockup" href="#top" aria-label="akaAgent Zalo"><img src="${logo}" alt="" width="40" height="40"><span><b>akaAgent <span>Zalo</span></b><small>by akaBiz</small></span></a>`;
  return `
<header class="hero" id="top">
  <svg class="ribbon" viewBox="0 0 520 620" aria-hidden="true">
    <defs><linearGradient id="lr" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FF8A4C"/><stop offset=".5" stop-color="#FF4A1F"/><stop offset="1" stop-color="#9E1206"/></linearGradient>
    <linearGradient id="lb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2BC8F2"/><stop offset=".5" stop-color="#2563FF"/><stop offset="1" stop-color="#0E2A8F"/></linearGradient></defs>
    <path d="M560 40 C380 60 250 170 300 320" stroke="url(#lr)" stroke-width="110" fill="none"/>
    <path d="M300 320 C340 460 460 500 580 600" stroke="url(#lb)" stroke-width="110" fill="none"/>
  </svg>
  <div class="wrap bar">${lock}<a class="small" href="#dung-thu">Dùng thử miễn phí</a></div>
  <div class="wrap hero-grid">
    <div class="hero-copy">
      <span class="eyebrow">${esc(C.cover.eyebrow)}</span>
      <h1>Tìm khách, kết bạn, nhắn tin Zalo <span class="grad">tự động mỗi ngày</span></h1>
      <p class="sub">${rich(C.cover.sub)}</p>
      <div class="actions"><a class="btn btn-primary" href="#dung-thu">Dùng thử miễn phí 3 ngày</a><a class="btn btn-ghost" href="#chien-dich">Xem 4 kiểu chiến dịch</a></div>
      <span class="note">Full tính năng · Tư vấn viên cài đặt cùng bạn</span>
    </div>
    <div class="hero-visual">${phoneHtml(intro.chat)}</div>
  </div>
</header>

<main>
<section>
  <div class="wrap">
    <div class="sec-head"><span class="eyebrow">Vì sao cần tự động hoá</span><h2>Bớt việc tay, thêm thời gian chốt đơn</h2></div>
    <div class="compare">
      <div class="col before"><h3>Làm tay mỗi ngày</h3><ul>
        <li>Lưu từng số vào danh bạ rồi mới nhắn được</li>
        <li>Copy-paste một nội dung vào từng nhóm, từng người</li>
        <li>Quên chăm lại khách cũ, quên chúc sinh nhật</li>
        <li>Không biết ai đã nhận tin, ai chưa</li>
      </ul></div>
      <div class="col after"><h3>Với akaAgent Zalo</h3><ul>
        <li>Nhập danh sách số, app tự tìm Zalo và gửi tin</li>
        <li>Soạn một lần, app gửi đều theo lịch bạn đặt</li>
        <li>Tự chăm bạn bè, tự chúc mừng sinh nhật</li>
        <li>Kết quả từng khách hiện rõ, xuất được Excel</li>
      </ul></div>
    </div>
  </div>
</section>

<section id="chien-dich" style="padding-top:0">
  <div class="wrap">
    <div class="sec-head"><span class="eyebrow">4 kiểu chiến dịch</span><h2>Một app cho mọi cách tìm khách trên Zalo</h2><p>${rich(intro.sub)}</p></div>
    <div class="cards4">${camps.map((t, i) => `<a class="card4" href="#${ANCHORS[t.id]}"><span class="n">${i + 1}</span><h3>${rich(t.short)}</h3><p>${rich(t.cardDesc)}</p><span class="more">Xem cách hoạt động</span></a>`).join('')}</div>
  </div>
</section>

${camps.map((t, i) => `<section class="feature${i % 2 ? ' flip' : ''}" id="${ANCHORS[t.id]}">
  <div class="wrap feature-grid">
    <div class="feature-copy">
      <span class="chip"><i></i>${esc(t.tag)}</span>
      <h2>${rich(t.title).replace(/<span class="grad-text">/g, '<span class="grad">')}</h2>
      <p>${rich(t.sub)}</p>
      <ol class="steps">${t.steps.map((s) => `<li><div><b>${rich(s.title)}</b><span>${rich(s.desc)}</span></div></li>`).join('')}</ol>
      <div class="benefits">${t.benefits.slice(0, 4).map((b) => `<div class="benefit"><b>${rich(b.title)}</b><span>${rich(b.desc)}</span></div>`).join('')}</div>
      <div class="fitrow"><span class="lbl">Phù hợp cho</span>${t.fit.map((f) => `<span class="f">${esc(f)}</span>`).join('')}</div>
      <div class="tip"><b>Mẹo</b><span>${rich(t.tip)}</span></div>
    </div>
    <div class="feature-visual">${phoneHtml(t.chat)}</div>
  </div>
</section>`).join('\n')}

<section class="dark-sec" id="an-toan">
  <div class="wrap">
    <div class="sec-head"><span class="eyebrow">${esc(C.safety.tag)}</span><h2>${rich(C.safety.title).replace(/<span class="grad-text">/g, '<span class="grad">')}</h2><p>${rich(C.safety.sub)}</p></div>
    <div class="safe">${C.safety.items.map((x) => `<div><b>${rich(x.title)}</b><span>${rich(x.desc)}</span></div>`).join('')}</div>
    <div class="platforms">${C.safety.platforms.map((x) => `<div><b>${rich(x.title)}</b><span>${rich(x.desc)}</span></div>`).join('')}</div>
  </div>
</section>

<section id="tien-ich">
  <div class="wrap">
    <div class="sec-head"><span class="eyebrow">Đi kèm sẵn trong app</span><h2>Tiện ích giúp chiến dịch chạy nhẹ tay hơn</h2></div>
    <div class="tools">
      <div class="tool"><b>Trợ lý AI</b><span>Viết và viết lại nội dung, tạo nhiều mẫu câu; đặt lịch bằng câu nói thường; chẩn đoán vì sao chiến dịch chưa chạy.</span></div>
      <div class="tool"><b>Mẫu nội dung & thư viện media</b><span>Lưu mẫu tin dùng lại, quản lý ảnh, video, tài liệu ngay trong app.</span></div>
      <div class="tool"><b>Nhóm data & Google Sheet</b><span>Gom data khách theo nhóm, tự đồng bộ dòng mới từ Google Sheet theo giờ.</span></div>
      <div class="tool"><b>Kiểm tra SĐT có Zalo</b><span>Lọc cả danh sách: số nào có Zalo, tên Zalo là gì, trước khi chạy chiến dịch.</span></div>
      <div class="tool"><b>Báo cáo & Excel</b><span>Kết quả từng khách, báo cáo theo tài khoản và hành động, email báo cáo hằng ngày.</span></div>
      <div class="tool"><b>Làm việc theo nhóm</b><span>Nhiều nhân viên trong một tổ chức, chia sẻ nhóm data cho đồng nghiệp cùng dùng.</span></div>
    </div>
  </div>
</section>

<section id="hoi-dap" style="padding-top:0">
  <div class="wrap">
    <div class="sec-head"><span class="eyebrow">Hỏi đáp</span><h2>Câu hỏi khách thường gặp</h2></div>
    <div class="faq">${C.faq.map((f) => `<details><summary>${esc(f.q)}</summary><p>${rich(f.a)}</p></details>`).join('')}</div>
  </div>
</section>

<section class="cta" id="dung-thu">
  <div class="wrap">
    <span class="eyebrow" style="color:#FF8A5C">${esc(C.back.eyebrow)}</span>
    <h2 style="margin-top:12px">${rich(C.back.title).replace(/<span class="grad-text">/g, '<span class="grad">')}</h2>
    <p class="lead">${rich(C.back.sub)}</p>
    <div class="steps3">${C.back.steps.map((x, i) => `<div><i>${i + 1}</i><b>${rich(x.title)}</b><span>${rich(x.desc)}</span></div>`).join('')}</div>
    <div class="final"><p class="callout">Nhắn tư vấn viên akaBiz để nhận tài khoản dùng thử</p><span>Trả lời ngay trong cuộc trò chuyện với tư vấn viên đã gửi bạn trang này.</span></div>
  </div>
</section>
</main>
<footer><div class="wrap"><span><b>akaAgent Zalo</b> · Giải pháp tự động hoá từ akaBiz</span><span>Website: <b>akabiz.net</b> · YouTube: <b>@akabizai</b></span></div></footer>`;
}

function landing(C, { standalone }) {
  const title = 'akaAgent Zalo';
  const desc = 'Tìm khách, kết bạn, nhắn tin Zalo tự động mỗi ngày. Dùng thử miễn phí 3 ngày.';
  const fonts = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;500;600;700;800&display=swap">';
  if (standalone) {
    return `<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${title} · Nhắn tin & kết bạn Zalo tự động</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:title" content="akaAgent Zalo · Nhắn tin & kết bạn Zalo tự động"><meta property="og:description" content="${esc(desc)}">
<link rel="icon" href="${logo}">
${fonts}
<style>${css}</style></head>
<body>${body(C)}</body></html>`;
  }
  return `<title>${title}</title>
<meta name="claude:viewport-fit-sides" content="cover">
${fonts}
<style>${css}</style>
${body(C)}`;
}

module.exports = { landing };
