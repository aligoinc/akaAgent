// Ảnh vuông 1:1 (1080×1080): ảnh gửi nhanh trong chat / đăng bài.
const { page, lockup, ribbon, phone, rich, esc } = require('./chung.cjs');

const W = 1080, H = 1080;

module.exports = function vuong(t) {
  const css = `
.canvas{width:${W}px;height:${H}px;}
.bg{position:absolute;inset:0;background:
  radial-gradient(620px 520px at 92% 8%, rgba(255,74,31,.22), transparent 70%),
  radial-gradient(700px 600px at 78% 96%, rgba(37,99,255,.30), transparent 70%),
  var(--ink);}
.top{position:absolute;left:72px;right:72px;top:64px;display:flex;align-items:center;justify-content:space-between;}
.copy{position:absolute;left:72px;top:170px;width:560px;height:740px;display:flex;flex-direction:column;justify-content:center;gap:28px;}
.copy .chip{font-size:20px;align-self:flex-start;}
.copy h1{font-size:${t.square?.titleSize || 58}px;line-height:1.08;font-weight:800;}
.copy p.sub{font-size:25px;line-height:1.45;color:var(--muted-on-dark);font-weight:500;text-wrap:pretty;}
.copy .ticks{gap:14px;font-size:25px;font-weight:600;}
.ph{position:absolute;right:56px;top:178px;transform:rotate(3deg);}
.foot{position:absolute;left:0;right:0;bottom:0;height:150px;padding:0 72px;display:flex;align-items:center;justify-content:space-between;
  background:linear-gradient(180deg, rgba(7,10,20,0) 0%, rgba(7,10,20,.92) 38%);}
.foot .cta-pill{font-size:28px;}
.foot .note{font-size:22px;line-height:1.35;color:var(--muted-on-dark);text-align:right;font-weight:500;}
.foot .note b{color:var(--text-on-dark);}
`;
  const body = `<div class="canvas dark">
  <div class="bg"></div>
  ${ribbon({ width: W, height: H, id: 'sq', w: 150, opacity: 0.95,
    red: [1240, 60, 960, 90, 700, 250, 760, 470],
    blue: [760, 470, 820, 700, 1010, 760, 1240, 1000] })}
  <div class="top">${lockup({ size: 30 })}<span class="chip on-dark" style="font-size:18px"><span class="dot"></span>${esc(t.tag)}</span></div>
  <div class="copy" data-fit="vuong-copy">
    <h1>${rich(t.square?.title || t.title)}</h1>
    <p class="sub">${rich(t.square?.sub || t.sub)}</p>
    <ul class="ticks">${(t.square?.ticks || t.ticks).map((x) => `<li><span>${rich(x)}</span></li>`).join('')}</ul>
  </div>
  <div class="ph">${phone({ width: 360, height: 700, chat: t.chat, fontSize: 21 })}</div>
  <div class="foot">
    <span class="cta-pill">Dùng thử miễn phí 3 ngày</span>
    <span class="note">Full tính năng<br><b>Nhắn tư vấn viên để nhận tài khoản</b></span>
  </div>
</div>`;
  return page({ title: `${t.tag} – vuông`, width: W, height: H, css, body });
};
