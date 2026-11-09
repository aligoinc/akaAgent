// Bảng giá theo sản phẩm (akaAgent Zalo Web, Zalo Desktop, Facebook Desktop, SMS Mobile):
// ảnh vuông 1:1, dọc 4:5, story 9:16, banner ngang 1200×628, tờ A4 và PDF tổng hợp nhiều trang.
// Giá tháng và số tiền tiết kiệm tính từ pricing[].plans trong noi-dung.cjs, không gõ tay.
// 4 gói xếp lưới 2×2; 3 gói xếp thành hàng (ảnh vuông, story, A4) hoặc 3 cột (banner).
const { page, lockup, ribbon, rich, esc } = require('./chung.cjs');
const a4 = require('./a4.cjs');

const vnd = (n) => n.toLocaleString('vi-VN');

// Thêm chữ hiển thị cho từng gói: giá, giá mỗi tháng, số tiền tiết kiệm so với gói ngắn nhất.
function plansOf(P) {
  const base = P.plans.find((p) => p.vnd && p.months);
  const basePerMonth = base.vnd / base.months;
  return P.plans.map((p) => {
    const out = { ...p };
    if (p.vnd) {
      out.num = vnd(p.vnd);
      out.priceText = `${vnd(p.vnd)}đ`;
    }
    if (p.vnd && p.months) {
      const perMonth = p.vnd / p.months;
      const rounded = Math.round(perMonth / 1000) * 1000;
      const save = Math.round(basePerMonth * p.months - p.vnd);
      out.perMonthText = `${rounded === perMonth ? '' : '~'}${vnd(rounded)}đ/tháng`;
      out.saveAmount = save > 0 ? `${vnd(save)}đ` : '';
      out.saveText = save > 0 ? `Tiết kiệm ${vnd(save)}đ` : '';
    }
    return out;
  });
}

const footnote = (P) => [P.saveNote, P.extraNote].filter(Boolean).join(' ');
const fileStem = (P) => P.product.replace(/\s+/g, '-');

const priceHtml = (p) => (p.discount
  ? `<span class="price"><small>Giảm</small><b>${esc(p.discount)}</b></span>`
  : `<span class="price"><b>${p.num}</b><i>đ</i></span>`);

function pillHtml(p, short) {
  if (p.ask) return `<span class="ask">${esc(short ? p.askShort || p.ask : p.ask)}</span>`;
  if (p.saveText) return `<span class="pill save">${esc(p.saveText)}</span>`;
  if (p.note) return `<span class="pill">${esc(p.note)}</span>`;
  return '';
}

const cls = (p, extra) => ['plan', extra, p.badge && 'hot', p.premium && 'prem'].filter(Boolean).join(' ');

// Thẻ dọc (lưới 2×2, banner)
function card(p, { short = false } = {}) {
  return `<div class="${cls(p)}">
  ${p.badge ? `<span class="badge">${esc(p.badge)}</span>` : ''}
  <span class="pname">${esc(p.name)}</span>
  ${priceHtml(p)}
  <span class="pm">${rich(p.perMonthText || p.line || '')}</span>
  ${pillHtml(p, short)}
</div>`;
}

// Hàng ngang (ảnh dọc 4:5; ảnh vuông, story, A4 khi chỉ có 3 gói)
function row(p, { short = false } = {}) {
  const meta = p.discount ? pillHtml(p, short) : `<span class="pm">${rich(p.perMonthText || p.line || '')}</span>${pillHtml(p, short)}`;
  return `<div class="${cls(p, 'row')}">
  <div class="l">
    <span class="pname">${esc(p.name)}${p.badge ? `<span class="badge">${esc(p.badge)}</span>` : ''}</span>
    <span class="meta">${meta}</span>
  </div>
  ${priceHtml(p)}
</div>`;
}

// Lưới 2×2 khi có 4 gói, hàng ngang khi ít hơn.
function plansBlock(P, fit, opts = {}) {
  const plans = plansOf(P);
  if (plans.length === 4) return `<div class="plans grid4" data-fit="${fit}">${plans.map((p) => card(p, opts)).join('')}</div>`;
  return `<div class="plans rows" data-fit="${fit}">${plans.map((p) => row(p, opts)).join('')}</div>`;
}

// Kiểu thẻ gói trên nền tối, kích thước chỉnh bằng biến CSS ở từng định dạng.
const darkPlanCss = `
.plans.grid4{display:grid;grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;}
.plans.rows{display:flex;flex-direction:column;}
.plans.rows .plan{flex:1;}
.plan{position:relative;display:flex;flex-direction:column;justify-content:center;align-items:flex-start;gap:var(--gap);min-width:0;
  padding:var(--pad);border-radius:var(--r);
  background:linear-gradient(160deg,rgba(255,255,255,.085),rgba(255,255,255,.035));box-shadow:inset 0 0 0 1.5px rgba(255,255,255,.14);}
.plan .pname{display:flex;align-items:center;gap:.55em;font-size:var(--fn);font-weight:700;line-height:1.2;color:var(--text-on-dark);}
.plan .price{display:flex;align-items:baseline;font-size:var(--fp);font-weight:800;line-height:1;letter-spacing:-.035em;color:#fff;white-space:nowrap;}
.plan .price i{font-style:normal;font-size:.56em;margin-left:.04em;}
.plan .price small{font-size:.4em;font-weight:700;letter-spacing:0;margin-right:.32em;}
.plan .pm{font-size:var(--fm);font-weight:500;line-height:1.3;color:var(--muted-on-dark);}
.plan .pill,.plan .ask{display:inline-flex;align-items:center;padding:.44em .9em;border-radius:999px;font-size:var(--fs);font-weight:700;line-height:1.1;white-space:nowrap;
  background:rgba(255,255,255,.1);color:var(--text-on-dark);}
.plan .pill.save{background:rgba(43,200,242,.17);color:#A8ECFC;}
.plan .badge{padding:.45em .85em;border-radius:999px;font-size:var(--fs);font-weight:800;letter-spacing:.07em;text-transform:uppercase;line-height:1;white-space:nowrap;
  color:#fff;background:linear-gradient(100deg,#FF6A2B,var(--flame) 45%,#E5203F);box-shadow:0 8px 20px rgba(255,74,31,.35);}
.plan:not(.row) .badge{position:absolute;top:var(--pad);right:var(--pad);}
.plan.hot{background:linear-gradient(160deg,rgba(255,106,43,.30),rgba(229,32,63,.13) 75%);box-shadow:inset 0 0 0 2.5px #FF7A3D,0 20px 44px rgba(255,74,31,.22);}
.plan.prem{background:linear-gradient(150deg,#3A74FF 0%,#1E4BE0 52%,#122C8C 100%);box-shadow:inset 0 0 0 1.5px rgba(170,205,255,.42),0 20px 44px rgba(37,99,255,.28);}
.plan.prem .pm{color:#D6E4FF;}
.plan.prem .pill,.plan.prem .pill.save{background:rgba(255,255,255,.17);color:#fff;}
.plan.prem .ask{background:#fff;color:#1238B8;font-weight:800;}
.plan.row{display:grid;grid-template-columns:1fr auto;align-items:center;gap:24px;}
.plan.row .l{display:flex;flex-direction:column;gap:var(--gap);min-width:0;}
.plan.row .meta{display:flex;align-items:center;flex-wrap:wrap;gap:.6em 14px;}
.kick{font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#FF8A5C;line-height:1.2;}
`;

const glow = (w, h) => `radial-gradient(${Math.round(w * 0.55)}px ${Math.round(h * 0.42)}px at 100% 0%, rgba(255,74,31,.24), transparent 70%),
  radial-gradient(${Math.round(w * 0.62)}px ${Math.round(h * 0.5)}px at 0% 100%, rgba(37,99,255,.30), transparent 70%), var(--ink)`;

const ticks = (items, cls2 = '') => `<ul class="ticks ${cls2}">${items.map((x) => `<li><span>${rich(x)}</span></li>`).join('')}</ul>`;

const topRow = (P, size, chip) => `${lockup({ size, product: P.brand })}<span class="chip on-dark" style="font-size:${chip}px"><span class="dot"></span>${esc(P.platform)}</span>`;

// ------------------------------------------------------------------ Ảnh vuông 1080×1080
function vuong(P) {
  const W = 1080, H = 1080;
  const css = darkPlanCss + `
.canvas{width:${W}px;height:${H}px;}
.bg{position:absolute;inset:0;background:${glow(W, H)};}
.top{position:absolute;left:64px;right:64px;top:50px;display:flex;align-items:center;justify-content:space-between;}
.head{position:absolute;left:64px;right:64px;top:126px;height:150px;display:flex;flex-direction:column;justify-content:center;gap:8px;}
.head .kick{font-size:20px;}
.head h1{font-size:58px;line-height:1.05;font-weight:800;white-space:nowrap;}
.head p{margin-top:2px;font-size:25px;line-height:1.4;color:var(--muted-on-dark);font-weight:500;}
.plans{position:absolute;left:64px;right:64px;top:292px;height:480px;gap:16px;
  --r:28px;--pad:26px;--gap:9px;--fn:24px;--fp:60px;--fm:21px;--fs:18px;}
.plans.rows{--pad:22px 30px;}
.fn{position:absolute;left:64px;right:64px;top:786px;font-size:17px;line-height:1.3;color:var(--muted-on-dark);font-weight:500;}
.ticks.inc{position:absolute;left:64px;right:64px;top:828px;display:grid;grid-template-columns:1fr 1fr;gap:12px 24px;font-size:23px;font-weight:600;}
.foot{position:absolute;left:64px;right:64px;bottom:42px;height:100px;display:flex;align-items:center;justify-content:space-between;gap:24px;
  padding-top:18px;border-top:1.5px solid rgba(255,255,255,.12);}
.foot .t{display:flex;flex-direction:column;gap:6px;min-width:0;}
.foot .t b{font-size:28px;font-weight:800;line-height:1.15;}
.foot .t > span{font-size:19px;line-height:1.35;color:var(--muted-on-dark);font-weight:500;}
.foot .cta-pill{font-size:26px;flex:0 0 auto;}
`;
  const body = `<div class="canvas dark">
  <div class="bg"></div>
  <div class="top">${topRow(P, 28, 18)}</div>
  <div class="head" data-fit="gia-vuong-head"><span class="kick">${esc(P.kicker)}</span><h1>${rich(P.title)}</h1><p>${rich(P.sub)}</p></div>
  ${plansBlock(P, 'gia-vuong-plans')}
  <p class="fn">${esc(footnote(P))}</p>
  ${ticks(P.includesShort, 'inc')}
  <div class="foot" data-fit="gia-vuong-foot">
    <div class="t"><b>${rich(P.more)}</b><span>${esc(P.contact)}</span></div>
    <span class="cta-pill">${esc(P.cta)}</span>
  </div>
</div>`;
  return page({ title: `${P.product} – vuông`, width: W, height: H, css, body });
}

// ------------------------------------------------------------------ Ảnh dọc 4:5 1080×1350 (thân sáng, gói xếp hàng)
function doc(P) {
  const W = 1080, H = 1350;
  const css = `
.canvas{width:${W}px;height:${H}px;}
.head{position:absolute;left:0;top:0;width:${W}px;height:430px;background:${glow(W, 900)};color:var(--text-on-dark);overflow:hidden;}
.head .in{position:absolute;left:72px;right:72px;top:56px;bottom:24px;display:flex;flex-direction:column;}
.head .row{display:flex;align-items:center;justify-content:space-between;}
.head .kick{margin-top:30px;font-size:20px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#FF8A5C;}
.head h1{margin-top:8px;font-size:60px;line-height:1.05;font-weight:800;}
.head p{margin-top:14px;font-size:25px;line-height:1.4;color:var(--muted-on-dark);font-weight:500;}
.head .trial{margin-top:20px;align-self:flex-start;display:inline-flex;align-items:center;gap:12px;padding:12px 20px;border-radius:999px;
  background:rgba(255,255,255,.08);box-shadow:inset 0 0 0 1.5px rgba(255,255,255,.16);font-size:20px;font-weight:600;}
.head .trial i{width:12px;height:12px;border-radius:50%;background:var(--sky);}
.body{position:absolute;left:72px;right:72px;top:462px;bottom:174px;display:flex;flex-direction:column;}
.rows{display:flex;flex-direction:column;gap:14px;}
.plan{display:grid;grid-template-columns:1fr auto;align-items:center;gap:20px;min-height:106px;padding:16px 30px;border-radius:24px;
  background:#fff;box-shadow:inset 0 0 0 1.5px var(--line);color:var(--text-on-light);}
.rows.n3 .plan{min-height:136px;}
.plan .l{display:flex;flex-direction:column;gap:8px;min-width:0;}
.plan .pname{display:flex;align-items:center;gap:14px;font-size:30px;font-weight:800;line-height:1.15;}
.plan .meta{display:flex;align-items:center;flex-wrap:wrap;gap:8px 14px;}
.plan .pm{font-size:21px;font-weight:600;color:var(--muted-on-light);}
.plan .pill,.plan .ask{display:inline-flex;align-items:center;padding:7px 14px;border-radius:999px;font-size:17px;font-weight:700;line-height:1.1;white-space:nowrap;background:#EDF1FA;color:var(--muted-on-light);}
.plan .pill.save{background:#DDF6FD;color:#05607A;}
.plan .price{display:flex;align-items:baseline;font-size:54px;font-weight:800;line-height:1;letter-spacing:-.035em;white-space:nowrap;}
.plan .price i{font-style:normal;font-size:.56em;margin-left:.04em;}
.plan .price small{font-size:.42em;font-weight:700;letter-spacing:0;margin-right:.3em;}
.plan .badge{padding:7px 13px;border-radius:999px;font-size:15px;font-weight:800;letter-spacing:.07em;text-transform:uppercase;line-height:1;color:#fff;
  background:linear-gradient(100deg,#FF6A2B,var(--flame) 45%,#E5203F);}
.plan.hot{background:var(--ink);color:var(--text-on-dark);box-shadow:inset 0 0 0 2.5px #FF7A3D,0 16px 34px rgba(255,74,31,.22);}
.plan.hot .pm{color:var(--muted-on-dark);}
.plan.hot .pill.save{background:rgba(43,200,242,.17);color:#A8ECFC;}
.plan.prem{background:linear-gradient(150deg,#3A74FF 0%,#1E4BE0 52%,#122C8C 100%);color:#fff;box-shadow:0 16px 34px rgba(37,99,255,.25);}
.plan.prem .pm{color:#D6E4FF;}
.plan.prem .pill,.plan.prem .pill.save{background:rgba(255,255,255,.18);color:#fff;}
.plan.prem .ask{background:#fff;color:#1238B8;font-weight:800;}
.fn{margin-top:12px;font-size:17px;color:var(--muted-on-light);font-weight:500;}
.label{margin-top:24px;font-size:19px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--volt-deep);}
.ticks.inc{margin-top:16px;display:grid;grid-template-columns:1fr 1fr;gap:12px 22px;font-size:21px;font-weight:600;color:var(--text-on-light);}
.foot{position:absolute;left:0;right:0;bottom:0;height:162px;padding:0 72px;display:flex;align-items:center;justify-content:space-between;gap:26px;background:var(--ink);color:var(--text-on-dark);}
.foot .t{display:flex;flex-direction:column;gap:8px;min-width:0;}
.foot .t b{font-size:30px;font-weight:800;line-height:1.15;}
.foot .t > span{font-size:20px;line-height:1.38;color:var(--muted-on-dark);font-weight:500;}
.foot .cta-pill{font-size:27px;flex:0 0 auto;}
`;
  const plans = plansOf(P);
  const body = `<div class="canvas light">
  <div class="head">
    ${ribbon({ width: W, height: 430, id: 'gd', w: 60, opacity: 0.75,
      red: [1170, 110, 1084, 138, 1018, 204, 1036, 296],
      blue: [1036, 296, 1052, 378, 1100, 404, 1170, 470] })}
    <div class="in" data-fit="gia-doc-head">
      <div class="row">${topRow(P, 28, 17)}</div>
      <span class="kick">${esc(P.kicker)}</span>
      <h1>${rich(P.title)}</h1>
      <p>${rich(P.sub)}</p>
      <span class="trial"><i></i>${esc(P.trial)}</span>
    </div>
  </div>
  <div class="body" data-fit="gia-doc-body">
    <div class="rows n${plans.length}">${plans.map((p) => row(p)).join('')}</div>
    <p class="fn">${esc(footnote(P))}</p>
    <div class="label">Mọi gói đều có</div>
    ${ticks(P.includes, 'inc')}
  </div>
  <div class="foot">
    <div class="t" data-fit="gia-doc-foot"><b>${rich(P.more)}</b><span>${esc(P.contact)}</span></div>
    <span class="cta-pill">${esc(P.cta)}</span>
  </div>
</div>`;
  return page({ title: `${P.product} – dọc 4:5`, width: W, height: H, css, body });
}

// ------------------------------------------------------------------ Story 9:16 1080×1920
// Vùng an toàn: chừa ~190px trên và ~240px dưới cho thanh giao diện mạng xã hội.
function story(P) {
  const W = 1080, H = 1920;
  const css = darkPlanCss + `
.canvas{width:${W}px;height:${H}px;}
.bg{position:absolute;inset:0;background:${glow(W, 1500)};}
.top{position:absolute;left:80px;right:80px;top:190px;display:flex;align-items:center;justify-content:space-between;}
.head{position:absolute;left:80px;right:80px;top:288px;height:300px;display:flex;flex-direction:column;justify-content:center;gap:14px;}
.head .kick{font-size:28px;}
.head h1{font-size:84px;line-height:1.04;font-weight:800;}
.head p{margin-top:4px;font-size:30px;line-height:1.4;color:var(--muted-on-dark);font-weight:500;}
.plans{position:absolute;left:80px;right:80px;top:606px;height:620px;gap:20px;
  --r:32px;--pad:32px;--gap:12px;--fn:32px;--fp:64px;--fm:26px;--fs:22px;}
.plans.rows{--pad:26px 36px;--fn:34px;--fp:70px;}
.fn{position:absolute;left:80px;right:80px;top:1242px;font-size:22px;line-height:1.35;color:var(--muted-on-dark);font-weight:500;}
.ticks.inc{position:absolute;left:80px;right:80px;top:1318px;display:grid;grid-template-columns:1.35fr 1fr;gap:18px 28px;font-size:27px;font-weight:600;}
.bottom{position:absolute;left:80px;right:80px;bottom:240px;display:flex;flex-direction:column;align-items:center;gap:20px;text-align:center;}
.bottom b{font-size:42px;font-weight:800;line-height:1.15;}
.bottom .cta-pill{font-size:38px;padding:26px 50px;}
.bottom span.note{font-size:27px;line-height:1.4;color:var(--muted-on-dark);font-weight:500;max-width:880px;}
`;
  const body = `<div class="canvas dark">
  <div class="bg"></div>
  <div class="top">${topRow(P, 34, 20)}</div>
  <div class="head" data-fit="gia-story-head"><span class="kick">${esc(P.kicker)}</span><h1>${rich(P.title)}</h1><p>${rich(P.sub)}</p></div>
  ${plansBlock(P, 'gia-story-plans', { short: true })}
  <p class="fn">${esc(footnote(P))}</p>
  ${ticks(P.includesShort, 'inc')}
  <div class="bottom" data-fit="gia-story-bottom">
    <b>${rich(P.more)}</b>
    <span class="cta-pill">${esc(P.cta)}</span>
    <span class="note">${esc(P.contact)}</span>
  </div>
</div>`;
  return page({ title: `${P.product} – story`, width: W, height: H, css, body });
}

// ------------------------------------------------------------------ Banner ngang 1200×628 (gói xếp cột)
function ngang(P) {
  const W = 1200, H = 628;
  const n = P.plans.length;
  const css = darkPlanCss + `
.canvas{width:${W}px;height:${H}px;}
.bg{position:absolute;inset:0;background:${glow(W, H)};}
.top{position:absolute;left:56px;right:56px;top:36px;display:flex;align-items:center;justify-content:space-between;}
.head{position:absolute;left:56px;right:56px;top:98px;height:110px;display:flex;flex-direction:column;justify-content:center;gap:6px;}
.head .kick{font-size:14px;}
.head h1{font-size:46px;line-height:1.05;font-weight:800;white-space:nowrap;}
.head p{margin-top:2px;font-size:20px;line-height:1.35;color:var(--muted-on-dark);font-weight:500;}
.cols{position:absolute;left:56px;right:56px;top:222px;height:230px;display:grid;grid-template-columns:repeat(${n},1fr);gap:14px;
  --r:22px;--pad:20px;--gap:9px;--fn:19px;--fp:${n === 4 ? 36 : 44}px;--fm:16px;--fs:14px;}
.cols .plan .badge{font-size:12px;top:16px;right:14px;}
.cols .plan .price{margin:2px 0;}
.fn{position:absolute;left:56px;right:56px;top:462px;font-size:14px;color:var(--muted-on-dark);font-weight:500;}
.foot{position:absolute;left:56px;right:56px;bottom:30px;height:76px;display:flex;align-items:center;justify-content:space-between;gap:24px;
  padding-top:14px;border-top:1.5px solid rgba(255,255,255,.12);}
.foot .t{display:flex;flex-direction:column;gap:4px;min-width:0;}
.foot .t b{font-size:22px;font-weight:800;line-height:1.15;}
.foot .t > span{font-size:16px;line-height:1.35;color:var(--muted-on-dark);font-weight:500;}
.foot .cta-pill{font-size:20px;flex:0 0 auto;}
`;
  const body = `<div class="canvas dark">
  <div class="bg"></div>
  <div class="top">${topRow(P, 22, 14)}</div>
  <div class="head" data-fit="gia-ngang-head"><span class="kick">${esc(P.kicker)}</span><h1>${rich(P.title)}</h1><p>${rich(P.sub)}</p></div>
  <div class="cols" data-fit="gia-ngang-cols">${plansOf(P).map((p) => card(p, { short: true })).join('')}</div>
  <p class="fn">${esc(footnote(P))}</p>
  <div class="foot" data-fit="gia-ngang-foot">
    <div class="t"><b>${rich(P.more)}</b><span>${esc(P.contact)}</span></div>
    <span class="cta-pill">${esc(P.cta)}</span>
  </div>
</div>`;
  return page({ title: `${P.product} – ngang`, width: W, height: H, css, body });
}

// ------------------------------------------------------------------ Tờ A4 (một sản phẩm mỗi trang)
const a4Css = a4.css + `
html,body{height:auto;}
.gia .band{height:224px;}
.gia .band .in{gap:8px;}
.gia .band .kick{margin-top:6px;font-size:11px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#FF8A5C;}
.gia .band h2{font-size:34px;}
.gia .sec{font-size:12px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--volt-deep);}
.gia .plans{margin-top:10px;}
.gia .plans.grid4{display:grid;grid-template-columns:1fr 1fr;grid-template-rows:140px 140px;gap:10px;}
.gia .plans.rows{display:flex;flex-direction:column;gap:10px;}
.gia .plans.rows .plan{height:90px;}
.gia .plan{position:relative;display:flex;flex-direction:column;justify-content:center;align-items:flex-start;gap:6px;padding:16px 20px;border-radius:16px;
  background:#fff;box-shadow:inset 0 0 0 1px var(--line);color:var(--text-on-light);}
.gia .plan.row{display:grid;grid-template-columns:1fr auto;align-items:center;gap:16px;padding:12px 22px;}
.gia .plan.row .l{display:flex;flex-direction:column;gap:6px;min-width:0;}
.gia .plan.row .meta{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}
.gia .plan .pname{display:flex;align-items:center;gap:10px;font-size:15px;font-weight:800;line-height:1.2;}
.gia .plan .price{display:flex;align-items:baseline;font-size:34px;font-weight:800;line-height:1;letter-spacing:-.035em;white-space:nowrap;}
.gia .plan .price i{font-style:normal;font-size:.56em;margin-left:.04em;}
.gia .plan .price small{font-size:.42em;font-weight:700;letter-spacing:0;margin-right:.3em;}
.gia .plan .pm{font-size:12.5px;font-weight:600;color:var(--muted-on-light);line-height:1.35;}
.gia .plan .pill,.gia .plan .ask{display:inline-flex;align-items:center;padding:5px 10px;border-radius:999px;font-size:11px;font-weight:700;line-height:1.1;white-space:nowrap;background:#EDF1FA;color:var(--muted-on-light);}
.gia .plan .pill.save{background:#DDF6FD;color:#05607A;}
.gia .plan .badge{padding:5px 10px;border-radius:999px;font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;line-height:1;color:#fff;
  background:linear-gradient(100deg,#FF6A2B,var(--flame) 45%,#E5203F);}
.gia .plan:not(.row) .badge{position:absolute;top:14px;right:16px;}
.gia .plan.hot{background:var(--ink);color:var(--text-on-dark);box-shadow:inset 0 0 0 2px #FF7A3D,0 10px 22px rgba(255,74,31,.18);}
.gia .plan.hot .pm{color:var(--muted-on-dark);}
.gia .plan.hot .pill.save{background:rgba(43,200,242,.17);color:#A8ECFC;}
.gia .plan.prem{background:linear-gradient(150deg,#3A74FF 0%,#1E4BE0 52%,#122C8C 100%);color:#fff;}
.gia .plan.prem .pm{color:#D6E4FF;}
.gia .plan.prem .pill,.gia .plan.prem .pill.save{background:rgba(255,255,255,.18);color:#fff;}
.gia .plan.prem .ask{background:#fff;color:#1238B8;font-weight:800;}
.gia .fn{margin-top:8px;font-size:10.5px;color:var(--muted-on-light);font-weight:500;}
.gia .inc{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px;}
.gia .inc .it{display:flex;align-items:center;gap:12px;padding:11px 14px;border-radius:12px;background:#fff;box-shadow:inset 0 0 0 1px var(--line);font-size:12.5px;line-height:1.4;font-weight:500;}
.gia .inc .it b{font-weight:800;}
.gia .inc .ck{flex:0 0 auto;width:24px;height:24px;border-radius:50%;background:var(--volt) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23FFFFFF' stroke-width='3.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M5 12.5l4.2 4.2L19 7'/%3E%3C/svg%3E") center/62% no-repeat;}
.gia .start{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:10px;}
.gia .start .s{padding:14px 16px;border-radius:14px;background:var(--ink);color:var(--text-on-dark);}
.gia .start .s i{display:block;font-style:normal;font-size:11px;font-weight:800;letter-spacing:.14em;color:#FF8A5C;}
.gia .start .s b{display:block;margin-top:6px;font-size:14px;line-height:1.3;font-weight:800;}
.gia .start .s span{display:block;margin-top:5px;font-size:11.5px;line-height:1.5;color:var(--muted-on-dark);font-weight:500;}
.gia .call{display:flex;align-items:center;justify-content:space-between;gap:18px;margin-top:16px;padding:16px 20px;border-radius:16px;background:#FFF1EB;color:#5B1F0E;}
.gia .call .t{display:flex;flex-direction:column;gap:4px;min-width:0;}
.gia .call .t b{font-size:18px;font-weight:800;line-height:1.2;color:var(--text-on-light);}
.gia .call .t > span{font-size:12.5px;line-height:1.45;font-weight:600;}
.gia .call .t small{font-size:11.5px;line-height:1.45;font-weight:500;color:#7A3A22;}
.gia .call .cta-pill{font-size:15px;flex:0 0 auto;}
`;

function a4Section(P) {
  const { PW } = a4;
  return `<section class="page content light gia">
  <div class="band">
    ${ribbon({ width: PW, height: 224, id: `bg-${P.id}`, w: 56, opacity: 0.85,
      red: [880, 62, 812, 80, 756, 118, 768, 166],
      blue: [768, 166, 778, 204, 815, 220, 880, 246] })}
    <div class="in" data-fit="gia-a4-band-${P.id}">
      <div class="row">${lockup({ size: 16, product: P.brand })}<span class="chip on-dark" style="font-size:10px"><span class="dot"></span>${esc(P.platform)}</span></div>
      <span class="kick">${esc(P.kicker)}</span>
      <h2>${rich(P.title)}</h2>
      <p>${rich(P.sub)}</p>
    </div>
  </div>
  <div class="pad" style="top:250px;height:820px;display:flex;flex-direction:column" data-fit="gia-a4-body-${P.id}">
    <div class="sec">Chọn gói phù hợp</div>
    ${plansBlock(P, `gia-a4-plans-${P.id}`)}
    <p class="fn">${esc(footnote(P))}</p>
    <div class="sec" style="margin-top:18px">Mọi gói đều có</div>
    <div class="inc">${P.includes.map((x) => `<div class="it"><span class="ck"></span><span>${rich(x)}</span></div>`).join('')}</div>
    <div class="sec" style="margin-top:18px">Đăng ký trong 3 bước</div>
    <div class="start">${P.steps.map((x, i) => `<div class="s"><i>BƯỚC ${i + 1}</i><b>${rich(x.title)}</b><span>${rich(x.desc)}</span></div>`).join('')}</div>
    <div class="call">
      <div class="t"><b>${rich(P.more)}</b><span>${esc(P.contact)}</span><small>${esc(P.trial)}</small></div>
      <span class="cta-pill">${esc(P.cta)}</span>
    </div>
  </div>
  <div class="folio"><span>${esc(P.product)} · ${esc(P.kicker)}</span><span>Cập nhật ${esc(P.updated)}</span></div>
</section>`;
}

const a4Doc = (list, title) => page({ title, width: a4.PW, height: a4.PH, css: a4Css, body: list.map(a4Section).join('\n') });

module.exports = {
  plansOf, vnd, fileStem, footnote,
  vuong, doc, story, ngang,
  a4: (P) => a4Doc([P], `${P.product} – ${P.kicker}`),
  a4All: (list) => a4Doc(list, 'akaAgent – Bảng giá tổng hợp'),
};
