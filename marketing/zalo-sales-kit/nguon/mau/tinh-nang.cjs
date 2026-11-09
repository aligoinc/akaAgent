// Ảnh từng tính năng (1080×1350): mỗi ảnh một ý, chữ lớn để khách đọc ngay trên điện thoại.
// Nội dung lấy từ noi-dung.cjs (features). Đầu ảnh nền tối (logo, nhóm, icon, tiêu đề), thân sáng (giải thích, 3–4 ý, ví dụ), chân CTA.
const { page, lockup, ribbon, rich, esc } = require('./chung.cjs');

const W = 1080, H = 1350;

// Icon nét 24×24 tự vẽ (stroke trắng), mỗi tính năng một icon.
const ICONS = {
  sparkles: '<path d="M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9z"/><path d="M18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"/>',
  grid: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.8"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.8"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.8"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.8"/>',
  phone: '<rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M10.5 18.5h3"/><path d="M9.5 7h5M9.5 10.5h5M9.5 14h3"/>',
  sms: '<path d="M4 5h16a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 20 17h-9.5L6 20.5V17H4a1.5 1.5 0 0 1-1.5-1.5v-9A1.5 1.5 0 0 1 4 5z"/><path d="M7.5 11h.01M12 11h.01M16.5 11h.01"/>',
  users: '<circle cx="9" cy="8.5" r="3.2"/><path d="M3 19.5c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5"/><circle cx="17" cy="9.5" r="2.5"/><path d="M15.8 14.3c2.9.1 5.2 2 5.2 4.8"/>',
  'eye-off': '<path d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12s-3.5 6.5-9.5 6.5S2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/><path d="M4 20L20 4"/>',
  'user-check': '<circle cx="9.5" cy="8" r="3.5"/><path d="M3 20c0-3.6 2.9-6 6.5-6 1.6 0 3 .5 4.1 1.3"/><path d="M15.5 17.5l2.2 2.2 4.3-4.3"/>',
  cake: '<path d="M4 20.5h16v-6.5a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2z"/><path d="M4 16c1.3 1 2.7 1 4 0s2.7-1 4 0 2.7 1 4 0 2.7-1 4 0"/><path d="M12 12V8.5"/><path d="M12 6.5c-.8-.8-.8-1.9 0-3 .8 1.1.8 2.2 0 3z"/>',
  'user-plus': '<circle cx="9.5" cy="8" r="3.5"/><path d="M3 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><path d="M19 8v6M16 11h6"/>',
  messages: '<path d="M3.5 4.5h11A1.5 1.5 0 0 1 16 6v6.5a1.5 1.5 0 0 1-1.5 1.5H8l-3.5 3v-3h-1A1.5 1.5 0 0 1 2 12.5V6a1.5 1.5 0 0 1 1.5-1.5z"/><path d="M18.5 8.5H20a1.5 1.5 0 0 1 1.5 1.5v6.5A1.5 1.5 0 0 1 20 18h-1v3l-3.5-3H11"/>',
  link: '<path d="M10 14a4.2 4.2 0 0 0 6 .2l3-3a4.2 4.2 0 0 0-6-6l-1.5 1.5"/><path d="M14 10a4.2 4.2 0 0 0-6-.2l-3 3a4.2 4.2 0 0 0 6 6l1.5-1.5"/>',
  sheet: '<rect x="3.5" y="3.5" width="17" height="17" rx="2.5"/><path d="M3.5 9h17M3.5 14.5h17M9.5 9v11.5"/>',
  'phone-check': '<rect x="4" y="2.5" width="11" height="19" rx="2.5"/><path d="M8 18.5h3"/><path d="M14 12.5l2.4 2.4 5.1-5.1"/>',
  'message-text': '<path d="M4 4.5h16A1.5 1.5 0 0 1 21.5 6v10a1.5 1.5 0 0 1-1.5 1.5h-9l-5 4v-4H4A1.5 1.5 0 0 1 2.5 16V6A1.5 1.5 0 0 1 4 4.5z"/><path d="M7 9h10M7 13h6"/>',
  paperclip: '<path d="M20 11.5l-7.8 7.8a5 5 0 0 1-7.1-7.1l7.8-7.8a3.4 3.4 0 0 1 4.8 4.8l-7.7 7.7a1.7 1.7 0 0 1-2.4-2.4l7.1-7.1"/>',
  tag: '<path d="M3 4.5v6.2c0 .5.2 1 .6 1.4l8.3 8.3a1.8 1.8 0 0 0 2.6 0l6.2-6.2a1.8 1.8 0 0 0 0-2.6L12.4 3.3A2 2 0 0 0 11 2.7H4.8A1.8 1.8 0 0 0 3 4.5z"/><circle cx="7.8" cy="7.5" r="1.4"/>',
  layers: '<path d="M12 3l9 4.5-9 4.5-9-4.5z"/><path d="M3 12l9 4.5 9-4.5"/><path d="M3 16.5L12 21l9-4.5"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/><path d="M8 14h3v3H8z"/>',
  server: '<rect x="3.5" y="3.5" width="17" height="7" rx="2"/><rect x="3.5" y="13.5" width="17" height="7" rx="2"/><path d="M7.5 7h.01M7.5 17h.01M11 7h5.5M11 17h5.5"/>',
  smartphone: '<rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M10.5 18.5h3"/><path d="M9.5 13.5v-2M12 13.5v-5M14.5 13.5v-3.5"/>',
  chart: '<path d="M3.5 20.5h17"/><path d="M6.5 16.5v-5M10.5 16.5v-9M14.5 16.5v-6.5M18.5 16.5V5"/>',
  shield: '<path d="M12 2.8l7.5 2.8v6c0 4.7-3.2 8.2-7.5 9.6-4.3-1.4-7.5-4.9-7.5-9.6v-6z"/><path d="M8.8 12l2.2 2.2 4.4-4.4"/>',
  pause: '<circle cx="12" cy="12" r="9"/><path d="M10 9v6M14 9v6"/>',
  filter: '<path d="M3.5 4.5h17l-6.5 8v6l-4 2v-8z"/>',
  hand: '<circle cx="12" cy="12" r="9"/><path d="M5.7 5.7l12.6 12.6"/>',
  headset: '<path d="M4 14.5v-2.5a8 8 0 0 1 16 0v2.5"/><rect x="2.5" y="13.5" width="4.5" height="6.5" rx="1.8"/><rect x="17" y="13.5" width="4.5" height="6.5" rx="1.8"/><path d="M19.5 20c0 1-1.5 1.5-4 1.5h-2"/>',
  history: '<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1"/><path d="M3.5 4v4.5H8"/><path d="M12 7.5V12l3 2"/>',
  'users-plus': '<circle cx="9" cy="8.5" r="3.2"/><path d="M3 19.5c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5"/><path d="M18.5 8v6M15.5 11h6"/>',
  'user-x': '<circle cx="9.5" cy="8" r="3.5"/><path d="M3 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><path d="M17 8.5l4 4M21 8.5l-4 4"/>',
  gift: '<rect x="3" y="8" width="18" height="4.5" rx="1.2"/><path d="M4.5 12.5v8h15v-8"/><path d="M12 8v12.5"/><path d="M12 8C10.5 4.5 7.5 4 6.8 5.6 6.2 7 8.5 8 12 8zM12 8c1.5-3.5 4.5-4 5.2-2.4.6 1.4-1.7 2.4-5.2 2.4z"/>',
};

// Nhóm: nhãn trên ảnh + màu ô icon.
const CATS = {
  'gioi-thieu': { label: 'Giới thiệu', grad: 'linear-gradient(140deg,#FF8A4C 0%,#FF4A1F 50%,#D61F3C 100%)', dot: '#FF6A2B', glow: 'rgba(255,74,31,.38)' },
  'chien-dich': { label: 'Chiến dịch', grad: 'linear-gradient(140deg,#FF7A3D 0%,#FF4A1F 55%,#D61F3C 100%)', dot: '#FF4A1F', glow: 'rgba(255,74,31,.38)' },
  'tinh-nang': { label: 'Tính năng', grad: 'linear-gradient(140deg,#5B97FF 0%,#2563FF 55%,#1238B8 100%)', dot: '#5B97FF', glow: 'rgba(37,99,255,.40)' },
  'an-toan': { label: 'An toàn & bền', grad: 'linear-gradient(140deg,#4FD8F7 0%,#22A9E8 45%,#1E5FE0 100%)', dot: '#2BC8F2', glow: 'rgba(43,200,242,.38)' },
  'ho-tro': { label: 'Hỗ trợ', grad: 'linear-gradient(140deg,#FF7A3D 0%,#E5203F 60%,#B0174A 100%)', dot: '#FF7A3D', glow: 'rgba(229,32,63,.38)' },
};

const css = `
.canvas{width:${W}px;height:${H}px;}
.head{position:absolute;left:0;top:0;width:${W}px;height:480px;color:var(--text-on-dark);overflow:hidden;background:
  radial-gradient(560px 420px at 100% 0%, rgba(255,74,31,.26), transparent 70%),
  radial-gradient(640px 460px at 0% 100%, rgba(37,99,255,.32), transparent 70%), var(--ink);}
.head .in{position:absolute;left:72px;right:72px;top:56px;bottom:36px;display:flex;flex-direction:column;}
.head .row{display:flex;align-items:center;justify-content:space-between;}
.head .ic{margin-top:34px;width:120px;height:120px;border-radius:34px;display:grid;place-items:center;flex:0 0 auto;}
.head .ic svg{width:68px;height:68px;fill:none;stroke:#fff;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round;}
.head h1{margin-top:26px;max-width:900px;font-size:64px;line-height:1.08;font-weight:800;}
.body{position:absolute;left:72px;right:72px;top:480px;bottom:150px;padding:36px 0 32px;display:flex;flex-direction:column;justify-content:center;gap:30px;}
.lead{font-size:36px;line-height:1.42;font-weight:500;color:#25304A;text-wrap:pretty;}
.ticks.pts{gap:16px;font-size:34px;font-weight:700;color:var(--text-on-light);}
/* Ảnh không có ví dụ: chữ to hơn cho dễ đọc */
.body.big{gap:36px;}
.body.big .lead{font-size:42px;line-height:1.4;}
.body.big .ticks.pts{gap:20px;font-size:40px;}
.ticks.pts li::before{margin-top:.12em;}
.ticks.pts li span{text-wrap:pretty;}
.ex{display:flex;flex-direction:column;gap:12px;padding:22px 24px;border-radius:26px;background:#E6ECF7;}
.ex .lbl{font-size:18px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--volt-deep);}
.ex .bubble{font-size:27px;max-width:92%;}
.note{font-size:23px;line-height:1.45;color:var(--muted-on-light);font-weight:500;}
.foot{position:absolute;left:0;right:0;bottom:0;height:150px;padding:0 72px;display:flex;align-items:center;justify-content:space-between;background:var(--ink);color:var(--text-on-dark);}
.foot .cta-pill{font-size:27px;}
.foot .note{font-size:21px;line-height:1.38;color:var(--muted-on-dark);text-align:right;}
.foot .note b{color:var(--text-on-dark);}
`;

function card(f) {
  const cat = CATS[f.cat];
  const icon = ICONS[f.icon];
  if (!cat) throw new Error(`Nhóm không hợp lệ: ${f.cat} (${f.id})`);
  if (!icon) throw new Error(`Thiếu icon: ${f.icon} (${f.id})`);
  const example = f.example?.length
    ? `<div class="ex"><span class="lbl">Ví dụ tin nhắn</span>${f.example.map((m) => `<div class="bubble ${m.t}">${rich(m.text)}</div>`).join('')}</div>`
    : '';
  const body = `<div class="canvas light">
  <div class="head">
    ${ribbon({ width: W, height: 480, id: 'tn', w: 60, opacity: 0.75,
      red: [1170, 110, 1084, 138, 1018, 200, 1036, 286],
      blue: [1036, 286, 1052, 360, 1100, 384, 1170, 446] })}
    <div class="in" data-fit="tn-head-${f.id}">
      <div class="row">${lockup({ size: 28 })}<span class="chip on-dark" style="font-size:17px"><span class="dot" style="background:${cat.dot}"></span>${esc(cat.label)}</span></div>
      <div class="ic" style="background:${cat.grad};box-shadow:0 18px 40px ${cat.glow}"><svg viewBox="0 0 24 24" aria-hidden="true">${icon}</svg></div>
      <h1>${rich(f.title)}</h1>
    </div>
  </div>
  <div class="body${f.example?.length ? '' : ' big'}" data-fit="tn-body-${f.id}">
    <p class="lead">${rich(f.lead)}</p>
    <ul class="ticks pts">${f.points.map((x) => `<li><span>${rich(x)}</span></li>`).join('')}</ul>
    ${example}
    ${f.note ? `<p class="note">${rich(f.note)}</p>` : ''}
  </div>
  <div class="foot">
    <span class="cta-pill">Dùng thử miễn phí 3 ngày</span>
    <span class="note">Full tính năng<br><b>Nhắn tư vấn viên để nhận tài khoản</b></span>
  </div>
</div>`;
  return page({ title: `akaAgent Zalo – ${f.id}`, width: W, height: H, css, body });
}

module.exports = { card, CATS, W, H };
