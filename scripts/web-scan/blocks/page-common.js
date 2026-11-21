// Hàm chạy TRONG TRANG, ghép đầu mỗi script page.evaluate của block quét web (bộ sinh nối chuỗi, không sửa tay trong DB).
// Bộ tìm phần tử nhận cả XPath (bắt đầu bằng "/", "(" hoặc ".") lẫn CSS, như PageController của Desktop.
function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function norm(value) { return value == null ? '' : String(value).replace(/\s+/g, ' ').trim(); }
function isXpath(selector) { return /^\s*(\/|\(|\.\/)/.test(String(selector || '')); }
function findAll(selector, context) {
  const root = context || document;
  if (!selector) return [];
  if (isXpath(selector)) {
    const out = [];
    const snap = document.evaluate(selector, root, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    for (let i = 0; i < snap.snapshotLength; i++) out.push(snap.snapshotItem(i));
    return out;
  }
  return Array.from(root.querySelectorAll(selector));
}
function findOne(selector, context) { return findAll(selector, context)[0] || null; }
function visible(el) {
  if (!el) return false;
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}
// Trang chặn truy cập (Cloudflare "Chờ một chút…" / Turnstile).
function isChallenge() {
  return /Chờ một chút|Just a moment|Attention Required|Một chút thôi/i.test(document.title || '')
    || !!document.querySelector('iframe[src*="challenges.cloudflare.com"], [name="cf-turnstile-response"], #challenge-form');
}
// SĐT di động Việt Nam (0xxxxxxxxx); số bàn / sai thì ''.
function normalizeMobile(value) {
  let digits = String(value || '').replace(/[^\d+]/g, '');
  if (digits.startsWith('+84')) digits = '0' + digits.slice(3);
  else if (digits.startsWith('84') && digits.length === 11) digits = '0' + digits.slice(2);
  digits = digits.replace(/\D/g, '');
  if (digits.length === 9 && /^[35789]/.test(digits)) digits = '0' + digits;
  return /^0[35789]\d{8}$/.test(digits) ? digits : '';
}
function normalizeAnyPhone(value) {
  const mobile = normalizeMobile(value);
  if (mobile) return mobile;
  let digits = String(value || '').replace(/[^\d+]/g, '');
  if (digits.startsWith('+84')) digits = '0' + digits.slice(3);
  digits = digits.replace(/\D/g, '');
  return /^0\d{9,10}$/.test(digits) ? digits : '';
}
function formatDate(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return '';
  const d = new Date(n);
  const pad = x => String(x).padStart(2, '0');
  return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear();
}
