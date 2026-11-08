// Thành phần dùng chung cho mọi mẫu thiết kế (ảnh, brochure, khung video).
const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Cho phép **đậm** và ==tô màu== trong nội dung.
const rich = (s) => esc(s)
  .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
  .replace(/==(.+?)==/g, '<span class="grad-text">$1</span>')
  .replace(/\n/g, '<br>');

function page({ title, width, height, css = '', body, assetsRel = '../../assets', bodyClass = '' }) {
  return `<!doctype html>
<html lang="vi"><head><meta charset="utf-8">
<title>${esc(title)}</title>
<link rel="stylesheet" href="${assetsRel}/base.css">
<style>
html,body{width:${width}px;height:${height}px;}
${css}
</style></head>
<body class="${bodyClass}">${body}</body></html>`;
}

function lockup({ assetsRel = '../../assets', size = 34, sub = 'by akaBiz', onLight = false } = {}) {
  return `<div class="lockup" style="font-size:${size}px;color:${onLight ? 'var(--text-on-light)' : 'var(--text-on-dark)'}">
  <img src="${assetsRel}/akabiz-logo.png" alt="akaBiz">
  <span class="name"><b>akaAgent <span>Zalo</span></b><small>${esc(sub)}</small></span>
</div>`;
}

// Hai dải ruy băng đỏ – xanh gợi lại logo AKABIZ.
// pts: { red: [x0,y0,c1x,c1y,c2x,c2y,x1,y1], blue: [...] }, w: bề rộng dải.
function ribbon({ width, height, red, blue, w = 150, opacity = 1, id = 'r' }) {
  const d = (p) => `M${p[0]} ${p[1]} C${p[2]} ${p[3]} ${p[4]} ${p[5]} ${p[6]} ${p[7]}`;
  return `<svg class="ribbon" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" style="left:0;top:0;opacity:${opacity}" aria-hidden="true">
  <defs>
    <linearGradient id="${id}-red" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#FF8A4C"/><stop offset=".45" stop-color="#FF4A1F"/><stop offset="1" stop-color="#9E1206"/>
    </linearGradient>
    <linearGradient id="${id}-blue" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#2BC8F2"/><stop offset=".5" stop-color="#2563FF"/><stop offset="1" stop-color="#0E2A8F"/>
    </linearGradient>
    <filter id="${id}-glow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="${Math.round(w * 0.32)}"/></filter>
  </defs>
  <g filter="url(#${id}-glow)" opacity=".55">
    ${red ? `<path d="${d(red)}" stroke="url(#${id}-red)" stroke-width="${w * 1.25}" fill="none" stroke-linecap="round"/>` : ''}
    ${blue ? `<path d="${d(blue)}" stroke="url(#${id}-blue)" stroke-width="${w * 1.25}" fill="none" stroke-linecap="round"/>` : ''}
  </g>
  ${red ? `<path d="${d(red)}" stroke="url(#${id}-red)" stroke-width="${w}" fill="none" stroke-linecap="butt"/>
  <path d="${d(red)}" stroke="#FFD2B8" stroke-opacity=".32" stroke-width="${Math.max(3, w * 0.05)}" fill="none" stroke-linecap="butt" transform="translate(${-w * 0.18},${-w * 0.2})"/>` : ''}
  ${blue ? `<path d="${d(blue)}" stroke="url(#${id}-blue)" stroke-width="${w}" fill="none" stroke-linecap="butt"/>
  <path d="${d(blue)}" stroke="#BFF3FF" stroke-opacity=".32" stroke-width="${Math.max(3, w * 0.05)}" fill="none" stroke-linecap="butt" transform="translate(${-w * 0.18},${-w * 0.2})"/>` : ''}
</svg>`;
}

// Khung điện thoại minh hoạ. chat: { name, sub, avatarColor, items: [{t:'me'|'them'|'sys', text, img}] }
function phone({ width, height, chat, fontSize = 22 }) {
  const initials = (chat.name || '?').split(' ').map((w) => w[0]).slice(-2).join('').toUpperCase();
  const items = (chat.items || []).map((m) => {
    if (m.t === 'sys') return `<div class="sys">${rich(m.text)}</div>`;
    return `<div class="bubble ${m.t}">${m.img ? '<span class="img"></span>' : ''}${rich(m.text)}</div>`;
  }).join('');
  return `<div class="phone" style="width:${width}px;height:${height}px;font-size:${fontSize}px">
  <div class="screen">
    <div class="bar"><span class="av" style="background:${chat.avatarColor || 'linear-gradient(135deg,#2563FF,#2BC8F2)'}">${esc(chat.avatar || initials)}</span>
      <span><b>${esc(chat.name)}</b><small>${esc(chat.sub || '')}</small></span></div>
    <div class="msgs">${items}</div>
  </div>
</div>`;
}

module.exports = { esc, rich, page, lockup, ribbon, phone };
