// Ghép brochure A4: bìa, trang giới thiệu, 4 trang chiến dịch, trang an toàn & bắt đầu, bìa sau.
const { page, lockup, ribbon, rich, esc } = require('./chung.cjs');
const a4 = require('./a4.cjs');

const { PW, PH } = a4;

const extraCss = `
.intro .pillars4{display:grid;grid-template-columns:1fr 1fr;gap:12px;}
.intro .p4{display:grid;grid-template-columns:44px 1fr;gap:14px;padding:16px;border-radius:16px;background:#fff;box-shadow:inset 0 0 0 1px var(--line);}
.intro .p4 .ic{width:44px;height:44px;border-radius:14px;display:grid;place-items:center;color:#fff;font-weight:800;font-size:16px;background:linear-gradient(140deg,#FF7A3D,var(--flame) 55%,#D61F3C);}
.intro .p4:nth-child(2) .ic,.intro .p4:nth-child(3) .ic{background:linear-gradient(140deg,#4C8DFF,var(--volt) 55%,#1238B8);}
.intro .p4 b{display:block;font-size:14.5px;line-height:1.25;font-weight:800;}
.intro .p4 span{display:block;margin-top:5px;font-size:12px;line-height:1.5;color:var(--muted-on-light);font-weight:500;}
.grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;}
.safe-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;}
.safe{display:grid;grid-template-columns:28px 1fr;gap:12px;padding:14px 16px;border-radius:14px;background:#fff;box-shadow:inset 0 0 0 1px var(--line);}
.safe .ck{width:28px;height:28px;border-radius:50%;background:var(--volt) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23FFFFFF' stroke-width='3.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M5 12.5l4.2 4.2L19 7'/%3E%3C/svg%3E") center/62% no-repeat;}
.safe b{display:block;font-size:13.5px;line-height:1.3;font-weight:800;}
.safe span{display:block;margin-top:4px;font-size:12px;line-height:1.5;color:var(--muted-on-light);font-weight:500;}
.start{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;}
.start .s{padding:16px;border-radius:16px;background:var(--ink);color:var(--text-on-dark);}
.start .s i{display:block;font-style:normal;font-size:12px;font-weight:800;letter-spacing:.14em;color:#FF8A5C;}
.start .s b{display:block;margin-top:8px;font-size:15px;line-height:1.3;font-weight:800;}
.start .s span{display:block;margin-top:6px;font-size:12px;line-height:1.5;color:var(--muted-on-dark);font-weight:500;}
.faq{display:grid;grid-template-columns:1fr 1fr;gap:10px 22px;}
.faq b{display:block;font-size:13px;line-height:1.35;font-weight:800;}
.faq span{display:block;margin-top:4px;font-size:12px;line-height:1.5;color:var(--muted-on-light);font-weight:500;}
.back .copy{top:250px;display:flex;flex-direction:column;align-items:center;text-align:center;gap:18px;}
.back h2{font-size:44px;line-height:1.08;font-weight:800;max-width:560px;}
.back p{font-size:16px;line-height:1.6;color:var(--muted-on-dark);max-width:520px;font-weight:500;}
.back .cta-pill{font-size:20px;padding:18px 32px;}
.back .steps3{top:640px;display:grid;grid-template-columns:repeat(3,1fr);gap:12px;}
.back .st{padding:16px;border-radius:16px;background:rgba(255,255,255,.06);box-shadow:inset 0 0 0 1px rgba(255,255,255,.12);}
.back .st i{display:block;font-style:normal;font-size:28px;font-weight:800;color:#FF8A5C;line-height:1;}
.back .st b{display:block;margin-top:10px;font-size:14px;line-height:1.3;font-weight:800;}
.back .st span{display:block;margin-top:6px;font-size:12px;line-height:1.5;color:var(--muted-on-dark);font-weight:500;}
.back .contact{bottom:84px;display:flex;justify-content:center;gap:28px;font-size:13px;color:var(--muted-on-dark);font-weight:600;}
.back .contact b{color:var(--text-on-dark);}
`;

function introPage(c, t, pageNo) {
  const camp = c.topics.slice(1);
  return `<section class="page content light intro">
  <div class="band">
    ${ribbon({ width: PW, height: 250, id: 'bi', w: 60, opacity: 0.85, red: [880, 70, 810, 88, 752, 128, 765, 180], blue: [765, 180, 776, 222, 815, 240, 880, 270] })}
    <div class="in" data-fit="a4-intro-band">
      <div class="row">${lockup({ size: 16 })}<span class="chip on-dark" style="font-size:10px"><span class="dot"></span>${esc(t.tag)}</span></div>
      <h2>${rich(t.a4?.title || t.title)}</h2>
      <p>${rich(t.sub)}</p>
    </div>
  </div>
  <div class="pad" style="top:278px;height:780px;display:flex;flex-direction:column;gap:22px" data-fit="a4-intro-body">
    <div>
      <div class="sec-title">4 kiểu chiến dịch Zalo trong một app</div>
      <div class="pillars4">${camp.map((x, i) => `<div class="p4"><span class="ic">${i + 1}</span><div><b>${rich(x.short)}</b><span>${rich(x.cardDesc || x.sub)}</span></div></div>`).join('')}</div>
    </div>
    <div>
      <div class="sec-title">Vì sao chọn akaAgent Zalo</div>
      <div class="grid3">${t.benefits.map((b) => `<div class="card"><b>${rich(b.title)}</b><span>${rich(b.desc)}</span></div>`).join('')}</div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;align-items:start">
      <div><div class="sec-title">Phù hợp cho</div><div class="fit">${t.fit.map((f) => `<span>${esc(f)}</span>`).join('')}</div></div>
      <div class="tip"><b>Mẹo</b><span>${rich(t.tip)}</span></div>
    </div>
  </div>
  <div class="folio"><span>akaAgent Zalo · Giới thiệu</span><span>${esc(c.trial.headline)} · ${pageNo}</span></div>
</section>`;
}

function safetyPage(c, pageNo) {
  const s = c.safety;
  return `<section class="page content light">
  <div class="band">
    ${ribbon({ width: PW, height: 250, id: 'bs', w: 60, opacity: 0.85, red: [880, 70, 810, 88, 752, 128, 765, 180], blue: [765, 180, 776, 222, 815, 240, 880, 270] })}
    <div class="in" data-fit="a4-safety-band">
      <div class="row">${lockup({ size: 16 })}<span class="chip on-dark" style="font-size:10px"><span class="dot"></span>${esc(s.tag)}</span></div>
      <h2>${rich(s.title)}</h2>
      <p>${rich(s.sub)}</p>
    </div>
  </div>
  <div class="pad" style="top:278px;height:780px;display:flex;flex-direction:column;gap:22px" data-fit="a4-safety-body">
    <div><div class="sec-title">Cơ chế an toàn có sẵn</div>
      <div class="safe-grid">${s.items.map((x) => `<div class="safe"><span class="ck"></span><div><b>${rich(x.title)}</b><span>${rich(x.desc)}</span></div></div>`).join('')}</div></div>
    <div><div class="sec-title">Chạy ở đâu cũng được</div>
      <div class="grid3">${s.platforms.map((x) => `<div class="card"><b>${rich(x.title)}</b><span>${rich(x.desc)}</span></div>`).join('')}</div></div>
    <div><div class="sec-title">Câu hỏi thường gặp</div>
      <div class="faq">${c.faq.slice(0, 4).map((x) => `<div><b>${rich(x.q)}</b><span>${rich(x.a)}</span></div>`).join('')}</div></div>
  </div>
  <div class="folio"><span>akaAgent Zalo · An toàn & bắt đầu</span><span>${esc(c.trial.headline)} · ${pageNo}</span></div>
</section>`;
}

function backPage(c) {
  return `<section class="page dark back">
  <div class="bg"></div>
  ${ribbon({ width: PW, height: PH, id: 'bk', w: 110, opacity: 0.8, red: [-90, 760, 120, 790, 230, 880, 190, 1010], blue: [190, 1010, 165, 1090, 60, 1120, -90, 1180] })}
  <div class="pad top" style="top:56px;display:flex;justify-content:center">${lockup({ size: 24 })}</div>
  <div class="pad copy" data-fit="a4-back">
    <span class="eyebrow">${esc(c.back.eyebrow)}</span>
    <h2>${rich(c.back.title)}</h2>
    <p>${rich(c.back.sub)}</p>
    <span class="cta-pill">${esc(c.trial.headline)}</span>
  </div>
  <div class="pad steps3">${c.back.steps.map((x, i) => `<div class="st"><i>${i + 1}</i><b>${rich(x.title)}</b><span>${rich(x.desc)}</span></div>`).join('')}</div>
  <div class="pad contact">${c.back.contact.map((x) => `<span>${esc(x.label)} <b>${esc(x.value)}</b></span>`).join('')}</div>
</section>`;
}

function pagesFor(c, indices, withCovers) {
  const out = [];
  let no = 1;
  if (withCovers) { out.push(a4.cover(c)); no++; }
  indices.forEach((i) => {
    const t = c.topics[i];
    out.push(i === 0 ? introPage(c, t, no) : a4.topicPage(t, no, c));
    no++;
  });
  if (withCovers) { out.push(safetyPage(c, no)); out.push(backPage(c)); }
  return out.join('\n');
}

function wrap(title, inner) {
  return page({ title, width: PW, height: PH, css: a4.css + extraCss + `html,body{height:auto;}`, body: inner });
}

module.exports = {
  full: (c) => wrap('akaAgent Zalo – Brochure', pagesFor(c, c.topics.map((_, i) => i), true)),
  single: (c, i) => wrap(`akaAgent Zalo – ${c.topics[i].tag}`, pagesFor(c, [i], false)),
};
