// Chạy TRONG TRANG cá nhân mở bằng ?sk=directory_contact_info (page.evaluate). Đọc tên, dòng giới thiệu dưới tên và mục "Thông tin liên hệ".
// Xem Facebook thật 18/11/2026 (Cốc Cốc, tài khoản thử, giao diện tiếng Việt):
//   - trang không có thẻ h1 cho tên; vùng tên + số người theo dõi + dòng giới thiệu (bio) + hạng mục nằm ngay trước hàng tab của trang cá nhân
//     ([role="tablist"] đầu tiên trong [role="main"]);
//   - mục Giới thiệu có cột trái là một [role="tablist"] chứa các link .../directory_<mục>; chỉ khi người đó để công khai thông tin liên hệ
//     mới có link directory_contact_info, nội dung nằm ở khối bên phải ("Số điện thoại | 090 322 12 29 | Di động | Email | a@b.com | Email …");
//   - người không công khai: cột trái không có mục "Thông tin liên hệ", khối bên phải trống.
// Không đoán: không thấy vùng nào thì trả mảng rỗng. findPhones / findEmails: contact-extract.fragment.js (bộ sinh ghép vào trước đoạn này).
// Chỗ tìm phần tử lấy từ auto_elements (block truyền vào __args[1]; xpathAll ở dom-xpath.fragment.js): tablist = fb_profile_tablist,
// directoryLink = fb_profile_directory_link, contactLink = fb_profile_contact_link (hai cái sau tương đối so với cột trái), main = fb_main_region.
// Phần còn trong code: cách đi từ hàng tab ra vùng tên (khối đứng trước) và từ cột trái ra khối nội dung bên phải.
const maxWaitMs = Number(__args[0]) || 9000;
const xp = __args[1] || {};
function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function norm(text) { return String(text || '').replace(/\s+/g, ' ').trim(); }
function linesOf(element) { return String((element && element.innerText) || '').split('\n').map(norm).filter(Boolean); }
function unique(values) { return Array.from(new Set(values)); }
function read() {
  const main = xpathAll(xp.main)[0] || document.body;
  const lists = xpathAll(xp.tablist);
  let headerLines = [];
  for (let element = lists[0]; element && element !== main; element = element.parentElement) {
    let lines = [];
    for (let sibling = element.previousElementSibling; sibling; sibling = sibling.previousElementSibling) lines = linesOf(sibling).concat(lines);
    if (lines.length > 0) { headerLines = lines; break; }
  }
  const nav = lists.find(list => xpathAll(xp.directoryLink, list).length > 0) || null;
  const contactLink = nav ? xpathAll(xp.contactLink, nav)[0] || null : null;
  const contactSelected = !!contactLink && contactLink.getAttribute('aria-selected') === 'true';
  let contactLines = [];
  if (contactSelected) {
    let element = nav;
    for (let level = 0; level < 4 && element && element !== main; level += 1) {
      const parent = element.parentElement;
      if (!parent) break;
      if (level >= 1) {
        const lines = [];
        for (const child of parent.children) { if (child !== element) lines.push(...linesOf(child)); }
        if (lines.length > 0) { contactLines = lines; break; }
      }
      element = parent;
    }
  }
  return { hasTabs: lists.length > 0, headerLines, hasNav: !!nav, hasContactSection: !!contactLink, contactSelected, contactLines };
}
const startedAt = Date.now();
let state = read();
while (Date.now() - startedAt < maxWaitMs) {
  const ready = state.hasTabs && state.headerLines.length > 0 && state.hasNav && (!state.contactSelected || state.contactLines.length > 0);
  if (ready) break;
  await delay(500);
  state = read();
}
const headerText = state.headerLines.slice(0, 20).join('\n').slice(0, 1500);
const contactText = state.contactLines.slice(0, 40).join('\n').slice(0, 1500);
const contactPhones = findPhones(contactText);
const contactEmails = findEmails(contactText);
const headerPhones = findPhones(headerText);
const headerEmails = findEmails(headerText);
const segments = location.pathname.split('/').filter(Boolean);
const first = String(segments[0] || '').toLowerCase();
const vanity = segments.length > 0 && !['profile.php', 'people', 'groups', 'checkpoint', 'login', 'login.php'].includes(first) && /^[a-z0-9.\-_]+$/i.test(segments[0]) ? segments[0] : '';
return {
  available: state.hasTabs && state.headerLines.length > 0,
  blocked: first === 'checkpoint' || first === 'login' || first === 'login.php',
  name: state.headerLines[0] || '',
  vanity,
  headerText,
  hasContactSection: state.hasContactSection,
  contactText,
  phones: unique(contactPhones.concat(headerPhones)),
  emails: unique(contactEmails.concat(headerEmails)),
  contactPhones,
  contactEmails,
  pageText: state.hasTabs ? '' : norm((xpathAll(xp.main)[0] || document.body).innerText).slice(0, 300)
};
