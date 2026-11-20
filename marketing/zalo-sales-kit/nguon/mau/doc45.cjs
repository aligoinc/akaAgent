// Ảnh dọc 4:5 (1080×1350): infographic giải thích cách hoạt động.
const { page, lockup, ribbon, rich, esc } = require('./chung.cjs');

const W = 1080, H = 1350;

module.exports = function doc45(t) {
  const steps = t.steps || [];
  const css = `
.canvas{width:${W}px;height:${H}px;}
.head{position:absolute;left:0;top:0;width:${W}px;height:490px;background:
  radial-gradient(560px 420px at 100% 0%, rgba(255,74,31,.28), transparent 70%),
  radial-gradient(640px 460px at 0% 100%, rgba(37,99,255,.32), transparent 70%), var(--ink);color:var(--text-on-dark);overflow:hidden;}
.head .in{position:absolute;left:72px;right:72px;top:58px;bottom:44px;display:flex;flex-direction:column;gap:22px;}
.head .row{display:flex;align-items:center;justify-content:space-between;}
.head h1{font-size:${t.portrait?.titleSize || 50}px;line-height:1.1;font-weight:800;max-width:850px;}
.head p{font-size:23px;line-height:1.45;color:var(--muted-on-dark);max-width:830px;font-weight:500;text-wrap:pretty;}
.body{position:absolute;left:0;right:0;top:490px;bottom:150px;padding:40px 72px 36px;display:flex;flex-direction:column;justify-content:space-between;}
.label{font-size:19px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--volt-deep);}
.steps{display:flex;flex-direction:column;gap:0;}
.step{display:grid;grid-template-columns:72px 1fr;gap:22px;position:relative;padding-bottom:22px;}
.step:not(:last-child)::after{content:"";position:absolute;left:35px;top:72px;bottom:2px;width:3px;border-radius:3px;background:linear-gradient(var(--volt),rgba(37,99,255,.15));}
.num{width:72px;height:72px;border-radius:22px;display:grid;place-items:center;font-size:32px;font-weight:800;color:#fff;
  background:linear-gradient(140deg,#FF7A3D,var(--flame) 55%,#D61F3C);box-shadow:0 10px 24px rgba(255,74,31,.28);}
.step:nth-child(even) .num{background:linear-gradient(140deg,#4C8DFF,var(--volt) 55%,#1238B8);box-shadow:0 10px 24px rgba(37,99,255,.28);}
.step h3{font-size:29px;line-height:1.2;font-weight:800;margin-top:2px;}
.step p{font-size:22px;line-height:1.4;color:var(--muted-on-light);margin-top:5px;font-weight:500;text-wrap:pretty;}
.badges{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;}
.badge{display:flex;align-items:center;gap:10px;padding:14px 16px;border-radius:16px;background:#fff;box-shadow:inset 0 0 0 1.5px var(--line);font-size:19px;line-height:1.28;font-weight:700;color:var(--text-on-light);}
.badge i{width:12px;height:12px;border-radius:50%;background:var(--sky);flex:0 0 auto;}
.foot{position:absolute;left:0;right:0;bottom:0;height:150px;padding:0 72px;display:flex;align-items:center;justify-content:space-between;background:var(--ink);color:var(--text-on-dark);}
.foot .cta-pill{font-size:27px;}
.foot .note{font-size:21px;line-height:1.38;color:var(--muted-on-dark);text-align:right;font-weight:500;}
.foot .note b{color:var(--text-on-dark);}
`;
  const body = `<div class="canvas light">
  <div class="head">
    ${ribbon({ width: W, height: 490, id: 'hd', w: 76, opacity: 0.85,
      red: [1170, 130, 1080, 160, 1010, 230, 1030, 330],
      blue: [1030, 330, 1048, 420, 1100, 450, 1170, 520] })}
    <div class="in" data-fit="doc45-head">
      <div class="row">${lockup({ size: 28 })}<span class="chip on-dark" style="font-size:17px"><span class="dot"></span>${esc(t.tag)}</span></div>
      <h1>${rich(t.portrait?.title || t.title)}</h1>
      <p>${rich(t.portrait?.sub || t.sub)}</p>
    </div>
  </div>
  <div class="body" data-fit="doc45-body">
    <div style="display:flex;flex-direction:column;gap:26px"><div class="label">${esc(t.portrait?.stepsLabel || t.stepsLabel || 'Cách hoạt động')}</div>
    <div class="steps">${steps.map((s, i) => `<div class="step"><div class="num">${i + 1}</div><div><h3>${rich(s.title)}</h3><p>${rich(s.desc)}</p></div></div>`).join('')}</div></div>
    <div class="badges">${(t.badges || []).map((b) => `<span class="badge"><i></i>${rich(b)}</span>`).join('')}</div>
  </div>
  <div class="foot">
    <span class="cta-pill">Dùng thử miễn phí 3 ngày</span>
    <span class="note">Full tính năng<br><b>Nhắn tư vấn viên để nhận tài khoản</b></span>
  </div>
</div>`;
  return page({ title: `${t.tag} – dọc 4:5`, width: W, height: H, css, body });
};
