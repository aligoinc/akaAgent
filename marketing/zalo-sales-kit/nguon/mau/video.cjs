// Video dọc 9:16 (1080×1920) dựng bằng CSS animation, quay từng khung bằng quay-video.cjs.
// Mỗi chủ đề ~27 giây: mở đầu (câu hỏi) → giải pháp → 4 bước + khung chat → lợi ích → kêu gọi dùng thử.
const { page, lockup, phone, rich, esc } = require('./chung.cjs');

const W = 1080, H = 1920;

// Mốc thời gian (giây)
const T = { hook: [0, 3.6], title: [3.6, 8.0], steps: [8.0, 18.4], perks: [18.4, 22.6], cta: [22.6, 27.2] };
const DURATION = 27.2;

function sceneStyle([a, b], last = false) {
  return `animation: sIn .55s cubic-bezier(.2,.8,.2,1) both ${a}s${last ? '' : `, sOut .45s cubic-bezier(.4,0,1,1) forwards ${(b - 0.45).toFixed(2)}s`};`;
}
const rise = (t, dur = 0.6) => `animation: rise ${dur}s cubic-bezier(.2,.8,.2,1) both ${t.toFixed(2)}s;`;
const pop = (t) => `animation: pop .5s cubic-bezier(.2,1.4,.4,1) both ${t.toFixed(2)}s;`;

function video(t) {
  const steps = t.steps.slice(0, 4);
  const stepDur = (T.steps[1] - T.steps[0]) / steps.length;
  const items = (t.chat.items || []);
  const chatTimes = items.map((_, i) => T.steps[0] + 0.6 + i * ((T.steps[1] - T.steps[0] - 1.4) / Math.max(1, items.length)));
  const hookLines = t.video?.hookLines || [t.hook];

  const css = `
.canvas{width:${W}px;height:${H}px;}
@keyframes sIn{from{opacity:0;transform:translateY(46px) scale(.985)}to{opacity:1;transform:none}}
@keyframes sOut{from{opacity:1;transform:none}to{opacity:0;transform:translateY(-40px) scale(.985)}}
@keyframes rise{from{opacity:0;transform:translateY(38px)}to{opacity:1;transform:none}}
@keyframes pop{from{opacity:0;transform:translateY(18px) scale(.86)}to{opacity:1;transform:none}}
@keyframes draw{from{stroke-dashoffset:1}to{stroke-dashoffset:0}}
@keyframes drift{from{transform:translate(0,0) scale(1)}to{transform:translate(-60px,40px) scale(1.08)}}
@keyframes drift2{from{transform:translate(0,0)}to{transform:translate(70px,-50px)}}
@keyframes stepIn{from{opacity:0;transform:translateX(70px)}to{opacity:1;transform:none}}
@keyframes stepOut{from{opacity:1;transform:none}to{opacity:0;transform:translateX(-70px)}}
@keyframes bar{from{transform:scaleX(0)}to{transform:scaleX(1)}}
@keyframes glow{0%,100%{box-shadow:0 18px 48px rgba(255,74,31,.35)}50%{box-shadow:0 18px 70px rgba(255,74,31,.65)}}
.g1,.g2{position:absolute;border-radius:50%;filter:blur(40px);}
.g1{width:900px;height:900px;right:-300px;top:-200px;background:radial-gradient(circle,rgba(255,74,31,.32),transparent 65%);animation:drift ${DURATION}s linear both 0s;}
.g2{width:1100px;height:1100px;left:-420px;bottom:-260px;background:radial-gradient(circle,rgba(37,99,255,.38),transparent 65%);animation:drift2 ${DURATION}s linear both 0s;}
.rib{position:absolute;inset:0;}
.rib path{fill:none;stroke-linecap:round;stroke-dasharray:1;stroke-dashoffset:1;}
.scene{position:absolute;inset:0;}
.wm{position:absolute;left:80px;top:150px;}
.hook{position:absolute;left:80px;right:80px;top:480px;display:flex;flex-direction:column;gap:6px;}
.hook .k{font-size:30px;font-weight:700;color:#FF8A5C;letter-spacing:.12em;text-transform:uppercase;margin-bottom:22px;}
.hook .l{font-size:96px;line-height:1.06;font-weight:800;letter-spacing:-.03em;}
.title{position:absolute;left:80px;right:80px;top:420px;display:flex;flex-direction:column;gap:34px;}
.title .chip{font-size:24px;align-self:flex-start;}
.title h1{font-size:82px;line-height:1.06;font-weight:800;}
.title p{font-size:36px;line-height:1.45;color:var(--muted-on-dark);font-weight:500;}
.stepbox{position:absolute;left:80px;right:80px;top:250px;height:400px;}
.st{position:absolute;inset:0;display:grid;grid-template-columns:120px 1fr;gap:30px;align-content:start;}
.st .n{width:120px;height:120px;border-radius:36px;display:grid;place-items:center;font-size:56px;font-weight:800;color:#fff;background:linear-gradient(140deg,#FF7A3D,var(--flame) 55%,#D61F3C);}
.st.even .n{background:linear-gradient(140deg,#4C8DFF,var(--volt) 55%,#1238B8);}
.st small{display:block;font-size:24px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--muted-on-dark);margin-bottom:10px;}
.st h2{font-size:56px;line-height:1.1;font-weight:800;}
.st p{font-size:32px;line-height:1.42;color:var(--muted-on-dark);margin-top:14px;font-weight:500;}
.prog{position:absolute;left:80px;right:80px;top:200px;height:8px;border-radius:8px;background:rgba(255,255,255,.12);overflow:hidden;}
.prog i{position:absolute;inset:0;transform-origin:0 50%;background:linear-gradient(90deg,var(--flame),#FF2E6A);animation:bar ${(T.steps[1] - T.steps[0]).toFixed(2)}s linear both ${T.steps[0]}s;}
.phwrap{position:absolute;left:50%;top:700px;transform:translateX(-50%);}
.perks{position:absolute;left:80px;right:80px;top:400px;display:flex;flex-direction:column;gap:40px;}
.perks h2{font-size:72px;line-height:1.08;font-weight:800;margin-bottom:16px;}
.perk{display:flex;align-items:center;gap:30px;padding:34px 38px;border-radius:34px;background:rgba(255,255,255,.06);box-shadow:inset 0 0 0 2px rgba(255,255,255,.1);font-size:44px;line-height:1.25;font-weight:700;}
.perk::before{content:"";flex:0 0 auto;width:64px;height:64px;border-radius:50%;background:var(--sky) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23070A14' stroke-width='3.4' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M5 12.5l4.2 4.2L19 7'/%3E%3C/svg%3E") center/62% no-repeat;}
.cta{position:absolute;left:80px;right:80px;top:330px;display:flex;flex-direction:column;align-items:center;text-align:center;gap:40px;}
.cta .lockup{font-size:52px;}
.cta h2{font-size:96px;line-height:1.04;font-weight:800;}
.cta p{font-size:38px;line-height:1.45;color:var(--muted-on-dark);font-weight:500;text-wrap:balance;max-width:840px;}
.cta .cta-pill{font-size:46px;padding:34px 56px;animation:glow 1.6s ease-in-out infinite;}
.cta .hint{font-size:32px;color:var(--text-on-dark);font-weight:700;}
.cta .hint span{color:#FF8A5C;}
`;

  const ribbonSvg = `<svg class="rib" viewBox="0 0 ${W} ${H}" aria-hidden="true">
  <defs>
    <linearGradient id="vr" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FF8A4C"/><stop offset=".5" stop-color="#FF4A1F"/><stop offset="1" stop-color="#9E1206"/></linearGradient>
    <linearGradient id="vb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2BC8F2"/><stop offset=".5" stop-color="#2563FF"/><stop offset="1" stop-color="#0E2A8F"/></linearGradient>
  </defs>
  <g style="opacity:.62">
  <path pathLength="1" d="M1320 1060 C1010 1090 770 1260 850 1490" stroke="url(#vr)" stroke-width="160" stroke-linecap="butt" style="animation:draw 1.3s cubic-bezier(.3,.7,.2,1) both .15s"/>
  <path pathLength="1" d="M850 1490 C910 1690 1110 1730 1330 1910" stroke="url(#vb)" stroke-width="160" stroke-linecap="butt" style="animation:draw 1.3s cubic-bezier(.3,.7,.2,1) both 1.2s"/>
  </g>
</svg>`;

  const stepsHtml = steps.map((s, i) => {
    const a = T.steps[0] + i * stepDur;
    const b = a + stepDur;
    const anim = `animation: stepIn .5s cubic-bezier(.2,.8,.2,1) both ${a.toFixed(2)}s${i < steps.length - 1 ? `, stepOut .4s ease-in forwards ${(b - 0.4).toFixed(2)}s` : ''};`;
    return `<div class="st ${i % 2 ? 'even' : ''}" style="${anim}"><span class="n">${i + 1}</span><div><small>Bước ${i + 1}/${steps.length}</small><h2>${rich(s.title)}</h2><p>${rich(s.desc)}</p></div></div>`;
  }).join('');

  // khung chat: bong bóng hiện lần lượt
  const chat = { ...t.chat, items: items.map((m, i) => ({ ...m, _style: pop(chatTimes[i]) })) };
  const phoneHtml = phone({ width: 640, height: 1000, chat, fontSize: 32 })
    .replace(/<div class="(sys|bubble [a-z]+)">/g, (m) => m); // giữ nguyên
  // gắn animation cho từng bong bóng theo thứ tự xuất hiện
  let k = 0;
  const phoneAnimated = phoneHtml.replace(/<div class="(sys|bubble (?:me|them))">/g, (m, cls) => `<div class="${cls}" style="${chat.items[k++]._style}">`);

  const body = `<div class="canvas dark">
  <div class="g1"></div><div class="g2"></div>
  ${ribbonSvg}
  <div class="scene" style="${sceneStyle(T.hook)}">
    <div class="wm" style="${rise(0.2)}">${lockup({ size: 40 })}</div>
    <div class="hook">
      <span class="k" style="${rise(0.35)}">${esc(t.video?.kicker || t.tag)}</span>
      ${hookLines.map((l, i) => `<span class="l" style="${rise(0.55 + i * 0.35)}">${rich(l)}</span>`).join('')}
    </div>
  </div>
  <div class="scene" style="${sceneStyle(T.title)}">
    <div class="wm">${lockup({ size: 40 })}</div>
    <div class="title">
      <span class="chip on-dark" style="${rise(T.title[0] + 0.25)}"><span class="dot"></span>${esc(t.tag)}</span>
      <h1 style="${rise(T.title[0] + 0.4)}">${rich(t.video?.title || t.story?.title || t.title)}</h1>
      <p style="${rise(T.title[0] + 0.75)}">${rich(t.video?.sub || t.square?.sub || t.sub)}</p>
    </div>
  </div>
  <div class="scene" style="${sceneStyle(T.steps)}">
    <div class="prog"><i></i></div>
    <div class="stepbox">${stepsHtml}</div>
    <div class="phwrap">${phoneAnimated}</div>
  </div>
  <div class="scene" style="${sceneStyle(T.perks)}">
    <div class="wm">${lockup({ size: 40 })}</div>
    <div class="perks">
      <h2 style="${rise(T.perks[0] + 0.2)}">${rich(t.video?.perksTitle || 'Bạn nhận được')}</h2>
      ${(t.video?.perks || t.ticks).map((x, i) => `<div class="perk" style="${pop(T.perks[0] + 0.45 + i * 0.4)}">${rich(x)}</div>`).join('')}
    </div>
  </div>
  <div class="scene" style="${sceneStyle(T.cta, true)}">
    <div class="cta">
      <div style="${rise(T.cta[0] + 0.2)}">${lockup({ size: 52 })}</div>
      <h2 style="${rise(T.cta[0] + 0.4)}">Dùng thử<br><span class="grad-text">miễn phí 3 ngày</span></h2>
      <p style="${rise(T.cta[0] + 0.7)}">Full tính năng, chạy trên chính tệp khách của bạn.</p>
      <span class="cta-pill" style="${pop(T.cta[0] + 1.0)}">Nhắn "ZALO" để nhận tài khoản</span>
      <span class="hint" style="${rise(T.cta[0] + 1.4)}">Tư vấn viên akaBiz <span>hỗ trợ cài đặt 1:1</span></span>
    </div>
  </div>
</div>`;
  return page({ title: `${t.tag} – video`, width: W, height: H, css, body });
}

module.exports = { video, DURATION, W, H };
