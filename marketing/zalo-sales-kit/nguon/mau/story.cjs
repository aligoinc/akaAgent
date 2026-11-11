// Ảnh story 9:16 (1080×1920): Zalo/Facebook/TikTok story, ảnh dọc gửi chat.
// Vùng an toàn: chừa ~200px trên và ~240px dưới cho thanh giao diện của mạng xã hội.
const { page, lockup, ribbon, phone, rich, esc } = require('./chung.cjs');

const W = 1080, H = 1920;

module.exports = function story(t) {
  const css = `
.canvas{width:${W}px;height:${H}px;}
.bg{position:absolute;inset:0;background:
  radial-gradient(760px 640px at 100% 6%, rgba(255,74,31,.26), transparent 70%),
  radial-gradient(900px 760px at 0% 78%, rgba(37,99,255,.34), transparent 70%), var(--ink);}
.top{position:absolute;left:80px;right:80px;top:190px;display:flex;align-items:center;justify-content:space-between;}
.copy{position:absolute;left:80px;right:80px;top:320px;height:430px;display:flex;flex-direction:column;gap:26px;}
.copy h1{font-size:${t.story?.titleSize || 74}px;line-height:1.06;font-weight:800;}
.copy p{font-size:31px;line-height:1.42;color:var(--muted-on-dark);font-weight:500;text-wrap:pretty;}
.ph{position:absolute;left:50%;top:790px;transform:translateX(-50%) rotate(-2deg);}
.ticks-box{position:absolute;left:80px;right:80px;top:1350px;display:none;}
.bottom{position:absolute;left:80px;right:80px;bottom:240px;display:flex;flex-direction:column;align-items:center;gap:18px;}
.bottom .cta-pill{font-size:36px;padding:26px 46px;}
.bottom .note{font-size:26px;color:var(--muted-on-dark);font-weight:500;text-align:center;}
.bottom .note b{color:var(--text-on-dark);}
.fade{position:absolute;left:0;right:0;bottom:0;height:470px;background:linear-gradient(180deg,rgba(7,10,20,0),rgba(7,10,20,.96) 34%);}
`;
  const body = `<div class="canvas dark">
  <div class="bg"></div>
  ${ribbon({ width: W, height: H, id: 'st', w: 170, opacity: 0.9,
    red: [1320, 860, 1010, 900, 790, 1080, 870, 1320],
    blue: [870, 1320, 930, 1520, 1120, 1570, 1330, 1760] })}
  <div class="top">${lockup({ size: 34 })}<span class="chip on-dark" style="font-size:20px"><span class="dot"></span>${esc(t.tag)}</span></div>
  <div class="copy" data-fit="story-copy">
    <h1>${rich(t.story?.title || t.title)}</h1>
    <p>${rich(t.story?.sub || t.sub)}</p>
  </div>
  <div class="ph">${phone({ width: 500, height: 740, chat: t.chat, fontSize: 26 })}</div>
  <div class="fade"></div>
  <div class="bottom">
    <span class="cta-pill">Dùng thử miễn phí 3 ngày</span>
    <span class="note">Full tính năng · <b>Nhắn tư vấn viên để nhận tài khoản</b></span>
  </div>
</div>`;
  return page({ title: `${t.tag} – story`, width: W, height: H, css, body });
};
