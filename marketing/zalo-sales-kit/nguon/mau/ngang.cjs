// Banner ngang 1200×628 (tỉ lệ 1.91:1): bài đăng có link Facebook, ảnh bìa bài viết, banner website, quảng cáo.
const { page, lockup, ribbon, phone, rich, esc } = require('./chung.cjs');

const W = 1200, H = 628;

module.exports = function ngang(t) {
  const css = `
.canvas{width:${W}px;height:${H}px;}
.bg{position:absolute;inset:0;background:
  radial-gradient(520px 420px at 100% 0%, rgba(255,74,31,.26), transparent 70%),
  radial-gradient(620px 460px at 70% 110%, rgba(37,99,255,.34), transparent 70%), var(--ink);}
.top{position:absolute;left:60px;top:48px;display:flex;align-items:center;gap:18px;}
.copy{position:absolute;left:60px;top:132px;width:650px;height:340px;display:flex;flex-direction:column;justify-content:center;gap:22px;}
.copy h1{font-size:${t.banner?.titleSize || 48}px;line-height:1.08;font-weight:800;}
.copy .ticks{gap:10px;font-size:21px;font-weight:600;}
.ph{position:absolute;right:70px;top:46px;transform:rotate(4deg);}
.foot{position:absolute;left:60px;bottom:44px;display:flex;align-items:center;gap:20px;}
.foot .cta-pill{font-size:22px;}
.foot .note{font-size:18px;color:var(--muted-on-dark);font-weight:500;}
.foot .note b{color:var(--text-on-dark);}
`;
  const body = `<div class="canvas dark">
  <div class="bg"></div>
  ${ribbon({ width: W, height: H, id: 'ng', w: 120, opacity: 0.9,
    red: [1290, 40, 1060, 70, 880, 200, 940, 380],
    blue: [940, 380, 990, 540, 1140, 580, 1300, 680] })}
  <div class="top">${lockup({ size: 24 })}<span class="chip on-dark" style="font-size:14px"><span class="dot"></span>${esc(t.tag)}</span></div>
  <div class="copy" data-fit="ngang-copy">
    <h1>${rich(t.banner?.title || t.square?.title || t.title)}</h1>
    <ul class="ticks">${(t.ticks || []).map((x) => `<li><span>${rich(x)}</span></li>`).join('')}</ul>
  </div>
  <div class="ph">${phone({ width: 300, height: 540, chat: t.chat, fontSize: 17 })}</div>
  <div class="foot"><span class="cta-pill">Dùng thử miễn phí 3 ngày</span><span class="note"><b>Nhắn tư vấn viên để nhận tài khoản</b></span></div>
</div>`;
  return page({ title: `${t.tag} – ngang`, width: W, height: H, css, body });
};
