// V663 (câu 605 / 2843 / 637 / 632 / 609 / 610 / 3186): trang chủ Facebook giả và các ca chung cho v663-smoke.cjs (Playwright) và
// v663-electron-main.ts (Electron thật, PageController + BlockExecutor như app). Mỗi ca: block (get | switch), cfg của trang giả, opts (vars,
// input, abortAfterMs), kỳ vọng của bản production (old) và bản V663 (new) trên kết quả { out, ops, vars, state }.
//
// Trang giả theo DOM thật đo 26/11 (ảnh + DOM lỗi yêu cầu 35–38, thử thật trên tài khoản có trang cá nhân và Page cùng tên):
//  - nút menu tài khoản có aria-expanded; menu mở ra còn khung xám rồi mới có link /me/ (tên danh tính đang dùng) và nút xem tất cả;
//  - menu có ô chuyển nhanh "Chuyển sang <tên>" (role=button, span tên) trỏ tới danh tính khác danh tính đang dùng, đứng trước danh sách;
//  - bấm xem tất cả: danh sách hiện thêm trong cùng hộp thoại, mục danh tính đang dùng có nhãn "<tên>, đang chọn";
//  - đang dùng Page thì có cookie i_user, trang cá nhân thì không; chuyển danh tính giữ qua lần mở trang sau (cookie).
'use strict'
const assert = require('node:assert/strict')

const ME = 'Tài khoản thử'
const PAGE = 'Trang thử'

// cfg: current (tên danh tính đang dùng), currentIsPage (mặc định: current === PAGE), quickSwitch ({ name, isPage }: ô chuyển nhanh), profiles
// (danh sách khi bấm xem tất cả: tên hoặc { name, isPage }; tên PAGE là Page), searchOnly (chỉ hiện khi gõ tìm), search (có ô tìm kiếm trang),
// seeAll (menu có nút xem tất cả), menuDelayMs (nút menu có sau khi trang tải), ignoreClicksMs (nút menu có nhưng chưa nhận bấm trong N ms
// đầu, như trang chưa gắn xử lý), noExpanded (nút không có aria-expanded), loadMs (mảng, độ trễ nội dung menu theo lần mở; null = không bao giờ
// tải), listMs (độ trễ danh sách), brokenSwitch (bấm chọn không đổi danh tính), button (false: không có nút menu).
function homePage(cfg) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Facebook</title></head><body>
<div role="navigation" id="top"></div><div role="main"><div role="button">Bạn đang nghĩ gì thế?</div></div>
<script>
const cfg = ${JSON.stringify(cfg)};
const PAGE_NAME = ${JSON.stringify(PAGE)};
const norm = p => typeof p === 'string' ? { name: p, isPage: p === PAGE_NAME } : p;
const readCookie = n => { const m = document.cookie.match(new RegExp('(?:^|; )' + n + '=([^;]*)')); return m ? decodeURIComponent(m[1]) : null };
let cur = (() => { try { const raw = readCookie('fake_cur'); if (raw) return JSON.parse(raw) } catch (e) {}
  return { name: cfg.current, isPage: cfg.currentIsPage ?? cfg.current === PAGE_NAME } })();
function syncCookies() {
  document.cookie = 'fake_cur=' + encodeURIComponent(JSON.stringify(cur)) + '; path=/';
  document.cookie = cur.isPage ? 'i_user=1000000000001; path=/' : 'i_user=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
}
syncCookies();
window.__cur = cur;
window.__opens = 0; window.__typed = null;
const loadedAt = Date.now();
function switchTo(id) {
  const log = JSON.parse(sessionStorage.getItem('fake_switches') || '[]'); log.push(id); sessionStorage.setItem('fake_switches', JSON.stringify(log));
  if (!cfg.brokenSwitch) { cur = { name: id.name, isPage: !!id.isPage }; window.__cur = cur; syncCookies() }
  closeMenu();
}
const bar = document.getElementById('top');
let btn = null;
function addButton() {
  btn = document.createElement('div');
  btn.setAttribute('role', 'button'); btn.setAttribute('tabindex', '0'); btn.setAttribute('aria-haspopup', 'dialog');
  btn.setAttribute('aria-label', 'Tài khoản, trang cá nhân của bạn');
  if (!cfg.noExpanded) btn.setAttribute('aria-expanded', 'false');
  btn.innerHTML = '<svg width="40" height="40"></svg>';
  btn.addEventListener('click', () => { if (cfg.ignoreClicksMs && Date.now() - loadedAt < cfg.ignoreClicksMs) return; toggle() });
  bar.appendChild(btn);
}
let menu = null;
function closeMenu() { if (menu) { menu.remove(); menu = null } if (btn && !cfg.noExpanded) btn.setAttribute('aria-expanded', 'false') }
function item(id, label) {
  const el = document.createElement('div'); el.setAttribute('role', 'button'); el.setAttribute('aria-label', label);
  el.innerHTML = '<div><span></span></div>'; el.querySelector('span').textContent = id.name;
  el.addEventListener('click', () => switchTo(id));
  return el;
}
function toggle() {
  if (menu) { closeMenu(); return }
  const n = window.__opens++;
  menu = document.createElement('div'); menu.setAttribute('role', 'dialog'); menu.setAttribute('aria-label', 'Trang cá nhân của bạn');
  menu.innerHTML = '<div data-visualcompletion="loading-state">&nbsp;</div><div data-visualcompletion="loading-state">&nbsp;</div>';
  document.body.appendChild(menu);
  if (!cfg.noExpanded) btn.setAttribute('aria-expanded', 'true');
  const mine = menu;
  const delays = cfg.loadMs || [0];
  const delay = n < delays.length ? delays[n] : delays[delays.length - 1];
  if (delay === null) return;
  setTimeout(() => {
    if (menu !== mine) return;
    mine.innerHTML = '<div role="menu"><a href="/me/"><span></span></a><div id="quick"></div>'
      + (cfg.seeAll === false ? '' : '<div role="button" aria-label="Xem tất cả trang cá nhân"><span>Xem tất cả trang cá nhân</span></div>')
      + '<div id="profiles"></div><div role="button"><span>Cài đặt và quyền riêng tư</span></div></div>';
    mine.querySelector('a[href="/me/"] span').textContent = cur.name;
    if (cfg.quickSwitch) mine.querySelector('#quick').appendChild(item(cfg.quickSwitch, 'Chuyển sang ' + cfg.quickSwitch.name));
    const seeAll = mine.querySelector('[aria-label="Xem tất cả trang cá nhân"]');
    if (seeAll) seeAll.addEventListener('click', () => openList(mine));
  }, delay);
}
function openList(mine) {
  const box = mine.querySelector('#profiles');
  box.innerHTML = '<div data-visualcompletion="loading-state">&nbsp;</div>';
  setTimeout(() => {
    if (menu !== mine) return;
    box.innerHTML = (cfg.search === false ? '' : '<input type="text" aria-label="Tìm kiếm trang cá nhân">') + '<div id="list"></div>';
    render('');
    const input = box.querySelector('input');
    // Ô nhập nhận chữ theo nhiều đường (insertText, gán value): đọc giá trị theo nhịp như danh sách tìm kiếm của Facebook.
    let last = '';
    if (input) setInterval(() => { const v = input.value || ''; if (v !== last) { last = v; window.__typed = v; render(v) } }, 100);
  }, cfg.listMs ?? 0);
}
function render(q) {
  const list = document.getElementById('list');
  if (!list) return;
  const ids = [...(cfg.profiles || []), ...(q ? (cfg.searchOnly || []) : [])].map(norm).filter(id => !q || id.name.includes(q));
  list.innerHTML = '';
  for (const id of ids) list.appendChild(item(id, id.name + (id.name === cur.name && !!id.isPage === !!cur.isPage ? ', đang chọn' : '')));
}
if (cfg.button !== false) setTimeout(addButton, cfg.menuDelayMs || 0);
</script></body></html>`
}

// Thân hàm đọc trạng thái trang giả sau khi block chạy (PageController.evaluate / Playwright).
const STATE_SCRIPT = `return { name: window.__cur ? window.__cur.name : null, isPage: /(?:^|; )i_user=/.test(document.cookie),
  switches: JSON.parse(sessionStorage.getItem('fake_switches') || '[]'), typed: window.__typed ?? null, opens: window.__opens ?? 0,
  expanded: document.querySelector('[aria-label="Tài khoản, trang cá nhân của bạn"]')?.getAttribute('aria-expanded') ?? null }`

const SWITCH_INPUT = { identityNameFromVars: 'runAsPageName' }
const RESTORE_INPUT = { useOriginalIdentity: true }
const typed = ops => ops.some(o => o.op === 'type')
// Tài khoản có trang cá nhân và Page cùng tên (thử thật 26/11).
const SAME_PROFILE = { name: ME, isPage: false }
const SAME_PAGE = { name: ME, isPage: true }
const sameNameCfg = onPage => ({ loadMs: [0], current: ME, currentIsPage: onPage, quickSwitch: onPage ? SAME_PROFILE : SAME_PAGE,
  profiles: onPage ? [SAME_PAGE, SAME_PROFILE] : [SAME_PROFILE, SAME_PAGE], search: false })
const onTarget = (r, name, isPage) => { assert.equal(r.state.name, name, 'danh tính cuối'); assert.equal(r.state.isPage, isPage, isPage ? 'phải đang dùng Page' : 'phải ở trang cá nhân') }

// key, why, block (get | switch), cfg, opts, old (kỳ vọng bản production), new (kỳ vọng bản V663): hàm kiểm nhận kết quả chạy.
const CASES = [
  { key: 'get_instant', why: 'menu tải ngay: đọc được tên như hôm nay, ghi danh tính ban đầu là trang cá nhân', block: 'get', cfg: { loadMs: [0], current: ME },
    old: r => assert.deepEqual(r.out, { ok: true, identityName: ME }),
    new: r => { assert.deepEqual(r.out, { ok: true, identityName: ME, isPage: false }); assert.equal(r.vars.originalIdentityIsPage, false)
      assert.equal(r.state.expanded, 'false', 'đóng menu') } },
  { key: 'get_on_page', why: 'đang dùng Page (có cookie i_user): ghi danh tính ban đầu là Page', block: 'get', cfg: { loadMs: [0], current: PAGE },
    old: r => assert.deepEqual(r.out, { ok: true, identityName: PAGE }),
    new: r => { assert.deepEqual(r.out, { ok: true, identityName: PAGE, isPage: true }); assert.equal(r.vars.originalIdentityIsPage, true) } },
  { key: 'get_slow_menu', why: 'câu 632 / 609 / 610: menu mở ra còn khung xám, nội dung tới sau 2,5 giây', block: 'get', cfg: { loadMs: [2500], current: ME },
    old: r => assert.equal(r.out.thrown, 'Không lấy được tên Facebook identity hiện tại'),
    new: r => { assert.deepEqual(r.out, { ok: true, identityName: ME, isPage: false }); assert.equal(r.state.opens, 1, 'không mở lại'); assert.equal(r.state.expanded, 'false') } },
  { key: 'get_late_button', why: 'câu 631 (lỗi thoáng qua): nút menu có sau khi trang tải 2 giây', block: 'get', cfg: { menuDelayMs: 2000, loadMs: [0], current: ME },
    old: r => assert.equal(r.out.thrown, 'Không tìm thấy nút mở menu profile/page hiện tại'), new: r => assert.equal(r.out.ok, true) },
  { key: 'get_not_hydrated', why: 'thử thật 26/11: nút menu có ngay nhưng 2 giây đầu bấm không mở (trang chưa gắn xử lý): bấm lại', block: 'get',
    cfg: { ignoreClicksMs: 2000, loadMs: [0], current: ME },
    old: r => assert.equal(r.out.thrown, 'Không lấy được tên Facebook identity hiện tại'),
    new: r => { assert.deepEqual(r.out, { ok: true, identityName: ME, isPage: false }); assert.equal(r.state.opens, 1, 'mở được ở lần bấm lại'); assert.equal(r.state.expanded, 'false') } },
  { key: 'get_reopen', why: 'lần mở đầu menu không tải xong, mở lại thì có', block: 'get', cfg: { loadMs: [null, 300], current: ME },
    old: r => assert.equal(r.out.thrown, 'Không lấy được tên Facebook identity hiện tại'),
    new: r => { assert.equal(r.out.ok, true); assert.equal(r.state.opens, 2, 'đóng / mở lại đúng một lần'); assert.equal(r.state.expanded, 'false') } },
  { key: 'get_no_expanded', why: 'nút menu không có aria-expanded: bấm mở / đóng như cũ', block: 'get', cfg: { noExpanded: true, loadMs: [2500], current: ME },
    old: r => assert.equal(r.out.thrown, 'Không lấy được tên Facebook identity hiện tại'), new: r => assert.deepEqual(r.out, { ok: true, identityName: ME, isPage: false }) },
  { key: 'get_never', why: 'menu không bao giờ tải: vẫn đúng câu cũ, menu đóng lại', block: 'get', cfg: { loadMs: [null], current: ME },
    old: r => assert.equal(r.out.thrown, 'Không lấy được tên Facebook identity hiện tại'),
    new: r => { assert.equal(r.out.thrown, 'Không lấy được tên Facebook identity hiện tại'); assert.equal(r.state.opens, 2); assert.equal(r.state.expanded, 'false') } },
  { key: 'get_no_button', why: 'không bao giờ có nút menu (trang khác): vẫn đúng câu cũ', block: 'get', cfg: { button: false, current: ME },
    old: r => assert.equal(r.out.thrown, 'Không tìm thấy nút mở menu profile/page hiện tại'), new: r => assert.equal(r.out.thrown, 'Không tìm thấy nút mở menu profile/page hiện tại') },

  { key: 'switch_instant', why: 'trang cá nhân → Page, menu và danh sách tải ngay: chuyển như hôm nay, đọc lại thấy đang dùng Page', block: 'switch',
    cfg: { loadMs: [0], current: ME, profiles: [ME, PAGE] }, opts: { vars: { runAsPageName: PAGE, originalIdentityName: ME }, input: SWITCH_INPUT },
    old: r => { assert.deepEqual(r.out, { ok: true, identityName: PAGE }); onTarget(r, PAGE, true) },
    new: r => { assert.deepEqual(r.out, { ok: true, identityName: PAGE }); onTarget(r, PAGE, true); assert.equal(r.state.switches.length, 1); assert.ok(!typed(r.ops))
      assert.equal(r.vars.currentIdentityName, PAGE) } },
  { key: 'switch_slow_menu', why: 'câu 605 / 2843 / 637: menu còn khung xám lúc 1,5 giây, nút xem tất cả tới sau 2,5 giây', block: 'switch',
    cfg: { loadMs: [2500], current: ME, profiles: [ME, PAGE] }, opts: { vars: { runAsPageName: PAGE, originalIdentityName: ME }, input: SWITCH_INPUT },
    old: r => assert.deepEqual(r.out, { ok: false, identityName: PAGE, message: 'Không tìm thấy nút xem tất cả profile/page' }),
    new: r => { assert.deepEqual(r.out, { ok: true, identityName: PAGE }); onTarget(r, PAGE, true) } },
  { key: 'switch_slow_list', why: 'danh sách trang cá nhân tải sau 3 giây: chờ mục tên Page, không phải gõ tìm', block: 'switch',
    cfg: { loadMs: [0], listMs: 3000, current: ME, profiles: [ME, PAGE] }, opts: { vars: { runAsPageName: PAGE, originalIdentityName: ME }, input: SWITCH_INPUT },
    old: null, new: r => { assert.deepEqual(r.out, { ok: true, identityName: PAGE }); onTarget(r, PAGE, true); assert.ok(!typed(r.ops), 'không gõ ô tìm kiếm') } },
  { key: 'switch_not_hydrated', why: 'thử thật 26/11: nút menu chưa nhận bấm 2 giây đầu: bấm lại rồi chuyển được', block: 'switch',
    cfg: { ignoreClicksMs: 2000, loadMs: [0], current: ME, profiles: [ME, PAGE] }, opts: { vars: { runAsPageName: PAGE, originalIdentityName: ME }, input: SWITCH_INPUT },
    old: null, new: r => { assert.deepEqual(r.out, { ok: true, identityName: PAGE }); onTarget(r, PAGE, true) } },
  { key: 'switch_already_page', why: 'câu 3186: đang dùng đúng Page (cookie i_user, cùng tên), danh sách không có chính nó: không mở danh sách', block: 'switch',
    cfg: { loadMs: [0], current: PAGE, profiles: [ME], search: false }, opts: { vars: { runAsPageName: PAGE, originalIdentityName: PAGE }, input: SWITCH_INPUT },
    old: r => { assert.equal(r.out.ok, false); assert.match(r.out.message, /^Có lỗi xảy ra khi chọn page\/profile: waitForSelector timeout/) },
    new: r => { assert.deepEqual(r.out, { ok: true, identityName: PAGE, alreadyCurrent: true }); onTarget(r, PAGE, true); assert.deepEqual(r.state.switches, [])
      assert.equal(r.state.opens, 1, 'chỉ mở menu đọc tên'); assert.equal(r.vars.currentIdentityName, PAGE) } },
  { key: 'switch_already_page_listed', why: 'đang dùng đúng Page, danh sách có Page đó: không bấm gì', block: 'switch',
    cfg: { loadMs: [0], current: PAGE, profiles: [ME, PAGE] }, opts: { vars: { runAsPageName: PAGE, originalIdentityName: PAGE }, input: SWITCH_INPUT },
    old: r => { assert.deepEqual(r.out, { ok: true, identityName: PAGE }); onTarget(r, PAGE, true) },
    new: r => { assert.deepEqual(r.out, { ok: true, identityName: PAGE, alreadyCurrent: true }); assert.deepEqual(r.state.switches, []) } },
  { key: 'switch_already_page_no_see_all', why: 'đang dùng đúng Page mà menu không có nút xem tất cả: không cần danh sách', block: 'switch',
    cfg: { loadMs: [0], seeAll: false, current: PAGE, profiles: [ME] }, opts: { vars: { runAsPageName: PAGE, originalIdentityName: PAGE }, input: SWITCH_INPUT },
    old: r => assert.deepEqual(r.out, { ok: false, identityName: PAGE, message: 'Không tìm thấy nút xem tất cả profile/page' }),
    new: r => assert.deepEqual(r.out, { ok: true, identityName: PAGE, alreadyCurrent: true }) },
  { key: 'same_name_profile_to_page', why: 'thử thật 26/11 (trang cá nhân và Page cùng tên), đang ở trang cá nhân: sang đúng Page', block: 'switch',
    cfg: sameNameCfg(false), opts: { vars: { runAsPageName: ME, originalIdentityName: ME }, input: SWITCH_INPUT },
    old: r => { assert.equal(r.out.ok, true); onTarget(r, ME, true) },
    new: r => { assert.deepEqual(r.out, { ok: true, identityName: ME }); onTarget(r, ME, true); assert.deepEqual(r.state.switches, [SAME_PAGE]) } },
  { key: 'same_name_page_stay', why: 'thử thật 26/11 (lỗi của bộ cũ): đang dùng Page cùng tên, bộ cũ bấm ô "Chuyển sang" về trang cá nhân; V663 giữ Page', block: 'switch',
    cfg: sameNameCfg(true), opts: { vars: { runAsPageName: ME, originalIdentityName: ME }, input: SWITCH_INPUT },
    old: r => { assert.equal(r.out.ok, true, 'bộ cũ báo đã chuyển'); onTarget(r, ME, false) },
    new: r => { assert.deepEqual(r.out, { ok: true, identityName: ME, alreadyCurrent: true }); onTarget(r, ME, true); assert.deepEqual(r.state.switches, []) } },
  { key: 'same_name_restore_profile', why: 'trang cá nhân và Page cùng tên, chuyển về trang cá nhân ban đầu (cùng lượt): về đúng trang cá nhân', block: 'switch',
    cfg: sameNameCfg(true), opts: { vars: { runAsPageName: ME, originalIdentityName: ME, originalIdentityIsPage: false }, input: RESTORE_INPUT },
    old: r => { assert.equal(r.out.ok, true); onTarget(r, ME, false) },
    new: r => { assert.deepEqual(r.out, { ok: true, identityName: ME }); onTarget(r, ME, false) } },
  { key: 'same_name_restore_unknown_kind', why: 'như trên nhưng không biết loại danh tính ban đầu (bản Desktop chưa truyền): chỉ so tên như trước, bấm ô chuyển nhanh', block: 'switch',
    cfg: sameNameCfg(true), opts: { vars: { runAsPageName: ME, originalIdentityName: ME }, input: RESTORE_INPUT },
    old: r => { assert.equal(r.out.ok, true); onTarget(r, ME, false) },
    new: r => { assert.deepEqual(r.out, { ok: true, identityName: ME }); onTarget(r, ME, false) } },
  { key: 'same_name_restore_page_original', why: 'trang cá nhân và Page cùng tên, danh tính ban đầu là Page: bộ cũ đưa về trang cá nhân; V663 giữ Page', block: 'switch',
    cfg: sameNameCfg(true), opts: { vars: { runAsPageName: ME, originalIdentityName: ME, originalIdentityIsPage: true }, input: RESTORE_INPUT },
    old: r => { assert.equal(r.out.ok, true); onTarget(r, ME, false) },
    new: r => { assert.deepEqual(r.out, { ok: true, identityName: ME, alreadyCurrent: true }); onTarget(r, ME, true) } },
  { key: 'switch_no_original', why: 'không có tên danh tính ban đầu (workflow không đọc tên): vẫn chuyển', block: 'switch',
    cfg: { loadMs: [0], current: ME, profiles: [ME, PAGE] }, opts: { vars: { runAsPageName: PAGE }, input: SWITCH_INPUT },
    old: r => assert.deepEqual(r.out, { ok: true, identityName: PAGE }), new: r => { assert.deepEqual(r.out, { ok: true, identityName: PAGE }); onTarget(r, PAGE, true) } },
  { key: 'restore_original_is_page', why: 'chuyển về danh tính ban đầu là chính Page đang dùng (Desktop truyền originalIdentityIsPage): không chuyển', block: 'switch',
    cfg: { loadMs: [0], current: PAGE, profiles: [ME], search: false }, opts: { vars: { runAsPageName: PAGE, originalIdentityName: PAGE, originalIdentityIsPage: true }, input: RESTORE_INPUT },
    old: r => assert.equal(r.out.ok, false), new: r => { assert.deepEqual(r.out, { ok: true, identityName: PAGE, alreadyCurrent: true }); onTarget(r, PAGE, true) } },
  { key: 'restore_original_is_page_unknown', why: 'như trên nhưng không biết loại (bản Desktop chưa truyền): như trước, danh sách không có chính Page thì lỗi', block: 'switch',
    cfg: { loadMs: [0], current: PAGE, profiles: [ME], search: false }, opts: { vars: { runAsPageName: PAGE, originalIdentityName: PAGE }, input: RESTORE_INPUT },
    old: r => assert.equal(r.out.ok, false), new: r => { assert.equal(r.out.ok, false); assert.match(r.out.message, /^Có lỗi xảy ra khi chọn page\/profile: waitForSelector timeout/) } },
  { key: 'restore_same_run_current', why: 'workflow đăng Page 326: danh tính ban đầu là Page cần đăng (2879 ghi vars cùng lượt): không chuyển về', block: 'switch',
    cfg: { loadMs: [0], current: PAGE, profiles: [ME], search: false }, opts: { vars: { pageName: PAGE, originalIdentityName: PAGE, originalIdentityIsPage: true, currentIdentityName: PAGE }, input: RESTORE_INPUT },
    old: r => assert.equal(r.out.ok, false), new: r => assert.deepEqual(r.out, { ok: true, identityName: PAGE, alreadyCurrent: true }) },
  { key: 'restore_page_missing_other', why: 'chuyển về trang cá nhân ban đầu mà danh sách không có, gõ tìm cũng không: vẫn đúng câu cũ', block: 'switch',
    cfg: { loadMs: [0], current: PAGE, profiles: [PAGE] }, opts: { vars: { runAsPageName: PAGE, originalIdentityName: ME }, input: RESTORE_INPUT },
    old: r => assert.deepEqual(r.out, { ok: false, identityName: ME, message: `Không tìm thấy page/profile "${ME}"` }),
    new: r => assert.deepEqual(r.out, { ok: false, identityName: ME, message: `Không tìm thấy page/profile "${ME}"` }) },
  { key: 'restore_normal', why: 'chuyển về trang cá nhân ban đầu (khác tên Page): chuyển như hôm nay, đọc lại thấy ở trang cá nhân', block: 'switch',
    cfg: { loadMs: [0], current: PAGE, profiles: [ME, PAGE] }, opts: { vars: { runAsPageName: PAGE, originalIdentityName: ME }, input: RESTORE_INPUT },
    old: r => { assert.deepEqual(r.out, { ok: true, identityName: ME }); onTarget(r, ME, false) },
    new: r => { assert.deepEqual(r.out, { ok: true, identityName: ME }); onTarget(r, ME, false) } },
  { key: 'switch_search', why: 'Page chỉ hiện khi gõ tìm: gõ ô tìm kiếm rồi chọn như hôm nay', block: 'switch',
    cfg: { loadMs: [0], current: ME, profiles: [ME], searchOnly: [PAGE] }, opts: { vars: { runAsPageName: PAGE, originalIdentityName: ME }, input: SWITCH_INPUT },
    old: r => { assert.deepEqual(r.out, { ok: true, identityName: PAGE }); assert.equal(r.state.typed, PAGE) },
    new: r => { assert.deepEqual(r.out, { ok: true, identityName: PAGE }); assert.ok(typed(r.ops)); onTarget(r, PAGE, true) } },
  { key: 'switch_verify_fail', why: 'bấm chọn Page mà danh tính không đổi: bộ cũ báo đã chuyển (chạy nhầm danh tính); V663 đọc lại và báo lỗi', block: 'switch',
    cfg: { loadMs: [0], current: ME, profiles: [ME, PAGE], brokenSwitch: true }, opts: { vars: { runAsPageName: PAGE, originalIdentityName: ME }, input: SWITCH_INPUT },
    old: r => { assert.equal(r.out.ok, true, 'bộ cũ báo đã chuyển'); onTarget(r, ME, false) },
    new: r => { assert.deepEqual(r.out, { ok: false, identityName: PAGE, message: `Đã chọn "${PAGE}" nhưng chưa chuyển sang được đúng danh tính` }); onTarget(r, ME, false) } },
  { key: 'switch_never_see_all', why: 'menu không bao giờ có nút xem tất cả: vẫn đúng câu cũ', block: 'switch',
    cfg: { loadMs: [0], seeAll: false, current: ME, profiles: [ME, PAGE] }, opts: { vars: { runAsPageName: PAGE, originalIdentityName: ME }, input: SWITCH_INPUT },
    old: r => assert.deepEqual(r.out, { ok: false, identityName: PAGE, message: 'Không tìm thấy nút xem tất cả profile/page' }),
    new: r => { assert.deepEqual(r.out, { ok: false, identityName: PAGE, message: 'Không tìm thấy nút xem tất cả profile/page' }); assert.deepEqual(r.state.switches, []) } },
  { key: 'switch_page_missing', why: 'không có Page đúng tên kể cả khi gõ tìm: vẫn đúng câu cũ', block: 'switch',
    cfg: { loadMs: [0], current: ME, profiles: [ME] }, opts: { vars: { runAsPageName: PAGE, originalIdentityName: ME }, input: SWITCH_INPUT },
    old: r => assert.deepEqual(r.out, { ok: false, identityName: PAGE, message: `Không tìm thấy page/profile "${PAGE}"` }),
    new: r => assert.deepEqual(r.out, { ok: false, identityName: PAGE, message: `Không tìm thấy page/profile "${PAGE}"` }) },
  { key: 'switch_aborted', why: 'lượt bị ngắt từ ngoài khi đang chờ menu: block ném lỗi huỷ (host báo RUN01 / SYS02 như #734)', block: 'switch',
    cfg: { loadMs: [null], current: ME, profiles: [ME, PAGE] }, opts: { vars: { runAsPageName: PAGE, originalIdentityName: ME }, input: SWITCH_INPUT, abortAfterMs: 800 },
    old: null, new: r => assert.match(String(r.out.thrown), /^Block bị huỷ/) }
]

module.exports = { homePage, STATE_SCRIPT, CASES, ME, PAGE }
