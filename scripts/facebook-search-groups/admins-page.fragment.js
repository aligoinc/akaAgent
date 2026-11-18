// Chạy TRONG TRANG /groups/<nhóm>/members/admins (page.evaluate). Đọc danh sách "Quản trị viên và người kiểm duyệt".
// Xem Facebook thật 18/11/2026 (Cốc Cốc, tài khoản thử, giao diện tiếng Việt):
//   - nhóm công khai hoặc đã tham gia: h2 "Quản trị viên và người kiểm duyệt · N", mỗi người một [role="listitem"] có link
//     /groups/<nhóm>/user/<uid>/ (aria-label = tên) và một dòng chữ đúng bằng "Quản trị viên" hoặc "Người kiểm duyệt";
//   - nhóm riêng tư chưa tham gia: Facebook hiện trang Giới thiệu, chỉ có hàng ảnh đại diện (listitem không chữ) và câu
//     "A và N thành viên khác là quản trị viên…", không ghi vai trò từng người: trả listed = false, không đoán.
// findPhones / findEmails: contact-extract.fragment.js (bộ sinh ghép vào trước đoạn này); SĐT / email viết ngay trong tên được giữ lại để
// dùng khi không mở được trang cá nhân.
// Chỗ tìm phần tử lấy từ auto_elements (block truyền vào __args[1]; xpathAll ở dom-xpath.fragment.js): row = fb_group_admin_row,
// link = fb_group_admin_profile_link, avatar = fb_group_admin_avatar (hai cái sau tương đối so với dòng), heading = fb_group_admin_heading,
// main = fb_main_region. Phần còn trong code: nhãn vai trò, dạng link /groups/<nhóm>/user/<uid>/ để lấy UID.
const maxWaitMs = Number(__args[0]) || 45000;
const xp = __args[1] || {};
function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function norm(text) { return String(text || '').replace(/\s+/g, ' ').trim(); }
const ADMIN_LABELS = ['quản trị viên', 'admin'];
const MODERATOR_LABELS = ['người kiểm duyệt', 'moderator'];
function profileOf(item) {
  for (const link of xpathAll(xp.link, item)) {
    let url;
    try { url = new URL(link.getAttribute('href') || '', location.href); } catch (error) { continue; }
    if (!/(^|\.)facebook\.com$/i.test(url.hostname)) continue;
    const label = norm(link.getAttribute('aria-label'));
    const scoped = url.pathname.match(/^\/groups\/[^/]+\/user\/(\d+)\/?$/);
    if (scoped) return { uid: scoped[1], label };
    const id = url.searchParams.get('id') || '';
    if (url.pathname === '/profile.php' && /^\d+$/.test(id)) return { uid: id, label };
  }
  return null;
}
function read() {
  const people = [];
  const seen = new Set();
  let avatarOnly = 0;
  for (const item of xpathAll(xp.row)) {
    const lines = String(item.innerText || '').split('\n').map(norm).filter(Boolean);
    if (lines.length === 0) { if (xpathAll(xp.avatar, item).length > 0) avatarOnly += 1; continue; }
    const lower = lines.map(line => line.toLowerCase());
    const role = lower.some(line => ADMIN_LABELS.includes(line)) ? 'admin' : lower.some(line => MODERATOR_LABELS.includes(line)) ? 'moderator' : '';
    if (!role) continue;
    const profile = profileOf(item);
    if (!profile || seen.has(profile.uid)) continue;
    seen.add(profile.uid);
    const name = profile.label || lines[0];
    people.push({ uid: profile.uid, name, role, phones: findPhones(name), emails: findEmails(name), rowText: lines.join(' | ').slice(0, 300) });
  }
  let expected = 0;
  for (const heading of xpathAll(xp.heading)) {
    const text = norm(heading.innerText || heading.textContent);
    if (!/quản trị viên|admin/i.test(text)) continue;
    const match = text.match(/·\s*([\d.,]+)\s*$/);
    if (match) { expected = Number(match[1].replace(/[.,]/g, '')) || 0; break; }
  }
  return { people, expected, avatarOnly };
}
const startedAt = Date.now();
let state = read();
let stable = 0;
while (Date.now() - startedAt < maxWaitMs && stable < 3) {
  if (state.expected > 0 && state.people.length >= state.expected) break;
  if (state.people.length === 0 && state.avatarOnly > 0 && Date.now() - startedAt > 4000) break;
  const before = state.people.length;
  window.scrollBy(0, Math.max(700, Math.floor((window.innerHeight || 800) * 0.9)));
  await delay(1800);
  state = read();
  stable = state.people.length > before ? 0 : stable + 1;
}
const mainText = norm((xpathAll(xp.main)[0] || document.body).innerText).slice(0, 400);
return {
  listed: state.people.length > 0,
  people: state.people,
  expected: state.expected,
  avatarOnly: state.avatarOnly,
  path: location.pathname,
  pageText: state.people.length > 0 ? '' : mainText
};
