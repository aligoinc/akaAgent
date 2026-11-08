// Brochure A4 nhiều trang (in được, gửi file PDF qua Zalo/Email).
// Mỗi trang 210×297mm; xuất bằng Chromium với preferCSSPageSize.
const { lockup, ribbon, phone, rich, esc } = require('./chung.cjs');

const PW = 794, PH = 1123; // A4 ở 96 dpi

const css = `
@page{size:A4;margin:0;}
html,body{width:${PW}px;}
body{background:#fff;}
.page{position:relative;width:${PW}px;height:${PH}px;overflow:hidden;page-break-after:always;break-after:page;}
.page:last-child{page-break-after:auto;break-after:auto;}
.pad{position:absolute;left:56px;right:56px;}
.folio{position:absolute;left:56px;right:56px;bottom:30px;display:flex;justify-content:space-between;align-items:center;font-size:10.5px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;}
.light .folio{color:#7A86A3;}
.dark .folio{color:#7F8AAA;}
.eyebrow{font-size:12px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;}
.light .eyebrow{color:var(--volt-deep);}
.dark .eyebrow{color:#FF8A5C;}

/* Bìa */
.cover .bg{position:absolute;inset:0;background:
  radial-gradient(520px 460px at 100% 0%, rgba(255,74,31,.28), transparent 70%),
  radial-gradient(620px 520px at 0% 100%, rgba(37,99,255,.34), transparent 70%), var(--ink);}
.cover .top{top:56px;display:flex;justify-content:space-between;align-items:center;}
.cover .copy{top:330px;display:flex;flex-direction:column;gap:18px;width:560px;}
.cover h1{font-size:50px;line-height:1.06;font-weight:800;}
.cover p.sub{font-size:16.5px;line-height:1.55;color:var(--muted-on-dark);font-weight:500;max-width:520px;}
.cover .pillars{top:700px;display:grid;grid-template-columns:repeat(4,1fr);gap:10px;}
.cover .pillar{padding:14px 14px 16px;border-radius:14px;background:rgba(255,255,255,.06);box-shadow:inset 0 0 0 1px rgba(255,255,255,.12);}
.cover .pillar b{display:block;font-size:13.5px;line-height:1.3;font-weight:800;color:var(--text-on-dark);}
.cover .pillar span{display:block;margin-top:6px;font-size:11.5px;line-height:1.45;color:var(--muted-on-dark);font-weight:500;}
.cover .pillar i{display:block;width:22px;height:4px;border-radius:4px;margin-bottom:10px;background:var(--flame);}
.cover .pillar:nth-child(even) i{background:var(--sky);}
.cover .bottom{bottom:72px;display:flex;justify-content:space-between;align-items:center;}
.cover .bottom .cta-pill{font-size:16px;}
.cover .bottom span.note{font-size:12.5px;line-height:1.5;color:var(--muted-on-dark);text-align:right;font-weight:500;}
.cover .bottom span.note b{color:var(--text-on-dark);}

/* Trang nội dung sáng */
.content{background:var(--paper);color:var(--text-on-light);}
.band{position:absolute;left:0;right:0;top:0;height:250px;background:
  radial-gradient(420px 300px at 100% 0%, rgba(255,74,31,.26), transparent 70%),
  radial-gradient(460px 320px at 0% 100%, rgba(37,99,255,.30), transparent 70%), var(--ink);color:var(--text-on-dark);overflow:hidden;}
.band .in{position:absolute;left:56px;right:56px;top:40px;bottom:30px;display:flex;flex-direction:column;gap:12px;}
.band .row{display:flex;justify-content:space-between;align-items:center;}
.band h2{font-size:32px;line-height:1.12;font-weight:800;max-width:600px;}
.band p{font-size:14px;line-height:1.55;color:var(--muted-on-dark);max-width:560px;font-weight:500;}
.cols{top:280px;display:grid;grid-template-columns:1fr 228px;gap:30px;}
.steps{display:flex;flex-direction:column;gap:14px;}
.step{display:grid;grid-template-columns:38px 1fr;gap:14px;}
.step .n{width:38px;height:38px;border-radius:12px;display:grid;place-items:center;font-size:17px;font-weight:800;color:#fff;background:linear-gradient(140deg,#FF7A3D,var(--flame) 55%,#D61F3C);}
.step:nth-child(even) .n{background:linear-gradient(140deg,#4C8DFF,var(--volt) 55%,#1238B8);}
.step h3{font-size:15.5px;line-height:1.25;font-weight:800;margin-top:2px;}
.step p{font-size:12.5px;line-height:1.5;color:var(--muted-on-light);margin-top:4px;font-weight:500;text-wrap:pretty;}
.ph-wrap{display:flex;justify-content:center;}
.grid-b{display:grid;grid-template-columns:1fr 1fr;gap:10px;}
.card{padding:14px 16px;border-radius:14px;background:#fff;box-shadow:inset 0 0 0 1px var(--line);}
.card b{display:block;font-size:13.5px;line-height:1.3;font-weight:800;}
.card span{display:block;margin-top:5px;font-size:11.8px;line-height:1.48;color:var(--muted-on-light);font-weight:500;}
.fit{display:flex;flex-wrap:wrap;gap:6px;}
.fit span{padding:6px 10px;border-radius:999px;background:#E7EDFF;color:var(--volt-deep);font-size:11.5px;font-weight:700;}
.tip{display:grid;grid-template-columns:auto 1fr;gap:12px;align-items:start;padding:14px 16px;border-radius:14px;background:#FFF1EB;color:#5B1F0E;}
.tip b{font-size:11px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:#C2310F;padding-top:2px;}
.tip span{font-size:12.5px;line-height:1.5;font-weight:500;}
.sec-title{font-size:12px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--volt-deep);margin-bottom:10px;}

/* Bìa sau */
.back .bg{position:absolute;inset:0;background:
  radial-gradient(560px 480px at 0% 0%, rgba(37,99,255,.30), transparent 70%),
  radial-gradient(560px 480px at 100% 100%, rgba(255,74,31,.30), transparent 70%), var(--ink);}
`;

function cover(c) {
  return `<section class="page dark cover">
  <div class="bg"></div>
  ${ribbon({ width: PW, height: PH, id: 'cv', w: 120, opacity: 0.95,
    red: [880, 80, 700, 110, 560, 220, 600, 380],
    blue: [600, 380, 640, 540, 760, 590, 900, 700] })}
  <div class="pad top">${lockup({ size: 22 })}<span class="chip on-dark" style="font-size:11px">${esc(c.cover.chip)}</span></div>
  <div class="pad copy" data-fit="a4-cover">
    <span class="eyebrow">${esc(c.cover.eyebrow)}</span>
    <h1>${rich(c.cover.title)}</h1>
    <p class="sub">${rich(c.cover.sub)}</p>
  </div>
  <div class="pad pillars">${c.cover.pillars.map((p) => `<div class="pillar"><i></i><b>${rich(p.title)}</b><span>${rich(p.desc)}</span></div>`).join('')}</div>
  <div class="pad bottom"><span class="cta-pill">${esc(c.trial.headline)}</span><span class="note">${esc(c.trial.note)}<br><b>${esc(c.trial.action)}</b></span></div>
</section>`;
}

function topicPage(t, pageNo, c) {
  return `<section class="page content light">
  <div class="band">
    ${ribbon({ width: PW, height: 250, id: 'b' + pageNo, w: 60, opacity: 0.85,
      red: [880, 70, 810, 88, 752, 128, 765, 180],
      blue: [765, 180, 776, 222, 815, 240, 880, 270] })}
    <div class="in" data-fit="a4-band-${t.id}">
      <div class="row">${lockup({ size: 16 })}<span class="chip on-dark" style="font-size:10px"><span class="dot"></span>${esc(t.tag)}</span></div>
      <h2>${rich(t.a4?.title || t.title)}</h2>
      <p>${rich(t.a4?.sub || t.sub)}</p>
    </div>
  </div>
  <div class="pad cols" style="height:430px" data-fit="a4-cols-${t.id}">
    <div style="display:flex;flex-direction:column;gap:14px;min-width:0">
      <div class="sec-title" style="margin-bottom:0">${esc(t.stepsLabel || 'Cách hoạt động')}</div>
      <div class="steps">${t.steps.map((s, i) => `<div class="step"><span class="n">${i + 1}</span><div><h3>${rich(s.title)}</h3><p>${rich(s.desc)}</p></div></div>`).join('')}</div>
    </div>
    <div class="ph-wrap">${phone({ width: 222, height: 420, chat: t.chat, fontSize: 13 })}</div>
  </div>
  <div class="pad" style="top:728px;height:352px;display:flex;flex-direction:column;gap:12px" data-fit="a4-bottom-${t.id}">
    <div class="sec-title" style="margin-bottom:0">Bạn nhận được</div>
    <div class="grid-b">${t.benefits.slice(0, 4).map((b) => `<div class="card"><b>${rich(b.title)}</b><span>${rich(b.desc)}</span></div>`).join('')}</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;align-items:start">
      <div><div class="sec-title">Phù hợp cho</div><div class="fit">${(t.fit || []).map((f) => `<span>${esc(f)}</span>`).join('')}</div></div>
      <div class="tip"><b>Mẹo</b><span>${rich(t.tip)}</span></div>
    </div>
  </div>
  <div class="folio"><span>akaAgent Zalo · ${esc(t.tag)}</span><span>${esc(c.trial.headline)} · ${pageNo}</span></div>
</section>`;
}

module.exports = { css, cover, topicPage, PW, PH };
