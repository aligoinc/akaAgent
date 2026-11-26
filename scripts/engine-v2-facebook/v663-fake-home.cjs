// V663 (câu 605 / 2843 / 637 / 632 / 609 / 610 / 3186): trang chủ Facebook giả và các ca chung cho v663-smoke.cjs (Playwright) và
// v663-electron-main.ts (Electron thật, PageController + BlockExecutor như app). Mỗi ca: block (get | switch), cfg của trang giả, opts (vars,
// input, abortAfterMs), kỳ vọng của bản production (old) và bản V663 (new) trên kết quả { out, ops, vars, state }.
'use strict'
const assert = require('node:assert/strict')

// ------------------------------------------------------------------------------------------------ trang chủ giả (chữ giả, cấu trúc như DOM thật 26/11)
// cfg: menuDelayMs (nút menu có sau khi trang tải), noExpanded (nút không có aria-expanded), loadMs (mảng, độ trễ nội dung menu theo lần mở;
// null = không bao giờ tải), current (tên danh tính hiện tại), seeAll (menu có nút xem tất cả), listMs (độ trễ danh sách trang cá nhân), profiles
// (tên trong danh sách), search (có ô tìm kiếm trang), searchOnly (tên chỉ hiện khi gõ tìm).
function homePage(cfg) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Facebook</title></head><body>
<div role="navigation" id="top"></div><div role="main"><div role="button">Bạn đang nghĩ gì thế?</div></div>
<script>
const cfg = ${JSON.stringify(cfg)};
window.__opens = 0; window.__switched = null; window.__typed = null;
const bar = document.getElementById('top');
function addButton() {
  const b = document.createElement('div');
  b.setAttribute('role', 'button'); b.setAttribute('tabindex', '0'); b.setAttribute('aria-haspopup', 'dialog');
  b.setAttribute('aria-label', 'Tài khoản, trang cá nhân của bạn');
  if (!cfg.noExpanded) b.setAttribute('aria-expanded', 'false');
  b.innerHTML = '<svg width="40" height="40"></svg>';
  b.addEventListener('click', () => toggle(b));
  bar.appendChild(b);
}
let menu = null;
function toggle(b) {
  if (menu) { menu.remove(); menu = null; if (!cfg.noExpanded) b.setAttribute('aria-expanded', 'false'); return }
  const n = window.__opens++;
  menu = document.createElement('div'); menu.setAttribute('role', 'dialog');
  menu.innerHTML = '<div data-visualcompletion="loading-state">&nbsp;</div><div data-visualcompletion="loading-state">&nbsp;</div>';
  document.body.appendChild(menu);
  if (!cfg.noExpanded) b.setAttribute('aria-expanded', 'true');
  const mine = menu;
  const delays = cfg.loadMs || [0];
  const delay = n < delays.length ? delays[n] : delays[delays.length - 1];
  if (delay === null) return;
  setTimeout(() => {
    if (menu !== mine) return;
    mine.innerHTML = '<div role="menu"><a href="/me/"><span>' + cfg.current + '</span></a>'
      + (cfg.seeAll === false ? '' : '<div role="button" aria-label="Xem tất cả trang cá nhân"><span>Xem tất cả trang cá nhân</span></div>')
      + '<div role="button"><span>Cài đặt và quyền riêng tư</span></div></div>';
    const seeAll = mine.querySelector('[aria-label="Xem tất cả trang cá nhân"]');
    if (seeAll) seeAll.addEventListener('click', openList);
  }, delay);
}
function openList() {
  if (menu) { menu.remove(); menu = null }
  const d = document.createElement('div'); d.setAttribute('role', 'dialog'); d.id = 'profiles';
  d.innerHTML = '<div data-visualcompletion="loading-state">&nbsp;</div>';
  document.body.appendChild(d);
  setTimeout(() => {
    d.innerHTML = (cfg.search === false ? '' : '<input type="text" aria-label="Tìm kiếm trang cá nhân">') + '<div id="list"></div>';
    render('');
    const input = d.querySelector('input');
    // Ô nhập nhận chữ theo nhiều đường (insertText, gán value): đọc giá trị theo nhịp như danh sách tìm kiếm của Facebook.
    let last = '';
    if (input) setInterval(() => { const v = input.value || ''; if (v !== last) { last = v; window.__typed = v; render(v) } }, 100);
  }, cfg.listMs ?? 0);
}
function render(q) {
  const list = document.getElementById('list');
  const names = [...(cfg.profiles || []), ...(q ? (cfg.searchOnly || []) : [])].filter(name => !q || name.includes(q));
  list.innerHTML = '';
  for (const name of names) {
    const item = document.createElement('div'); item.setAttribute('role', 'button');
    item.innerHTML = '<div><span></span></div>'; item.querySelector('span').textContent = name;
    item.addEventListener('click', () => { window.__switched = name; document.getElementById('profiles')?.remove() });
    list.appendChild(item);
  }
}
if (cfg.button !== false) setTimeout(addButton, cfg.menuDelayMs || 0);
</script></body></html>`
}


const ME = 'Tài khoản thử'
const PAGE = 'Trang thử'
const SWITCH_INPUT = { identityNameFromVars: 'runAsPageName' }
const RESTORE_INPUT = { useOriginalIdentity: true }
const navigated = ops => ops.some(o => o.op === 'navigate')
// key, why, block (get | switch), cfg, opts, old (kỳ vọng bản production), new (kỳ vọng bản V663): hàm kiểm nhận kết quả chạy.
const CASES = [
  { key: 'get_instant', why: 'menu tải ngay: đọc được tên như hôm nay', block: 'get', cfg: { loadMs: [0], current: ME },
    old: r => assert.deepEqual(r.out, { ok: true, identityName: ME }), new: r => { assert.deepEqual(r.out, { ok: true, identityName: ME }); assert.equal(r.vars.originalIdentityName, ME); assert.equal(r.state.expanded, 'false', 'đóng menu') } },
  { key: 'get_slow_menu', why: 'câu 632 / 609 / 610: menu mở ra còn khung xám, nội dung tới sau 2,5 giây', block: 'get', cfg: { loadMs: [2500], current: ME },
    old: r => assert.equal(r.out.thrown, 'Không lấy được tên Facebook identity hiện tại'),
    new: r => { assert.deepEqual(r.out, { ok: true, identityName: ME }); assert.equal(r.state.opens, 1, 'không mở lại'); assert.equal(r.state.expanded, 'false') } },
  { key: 'get_late_button', why: 'câu 631 (lỗi thoáng qua): nút menu có sau khi trang tải 2 giây', block: 'get', cfg: { menuDelayMs: 2000, loadMs: [0], current: ME },
    old: r => assert.equal(r.out.thrown, 'Không tìm thấy nút mở menu profile/page hiện tại'), new: r => assert.deepEqual(r.out, { ok: true, identityName: ME }) },
  { key: 'get_reopen', why: 'lần mở đầu menu không tải xong, mở lại thì có', block: 'get', cfg: { loadMs: [null, 300], current: ME },
    old: r => assert.equal(r.out.thrown, 'Không lấy được tên Facebook identity hiện tại'),
    new: r => { assert.deepEqual(r.out, { ok: true, identityName: ME }); assert.equal(r.state.opens, 2, 'đóng / mở lại đúng một lần'); assert.equal(r.state.expanded, 'false') } },
  { key: 'get_no_expanded', why: 'nút menu không có aria-expanded: bấm mở / đóng như cũ', block: 'get', cfg: { noExpanded: true, loadMs: [2500], current: ME },
    old: r => assert.equal(r.out.thrown, 'Không lấy được tên Facebook identity hiện tại'), new: r => assert.deepEqual(r.out, { ok: true, identityName: ME }) },
  { key: 'get_never', why: 'menu không bao giờ tải: vẫn đúng câu cũ, menu đóng lại', block: 'get', cfg: { loadMs: [null], current: ME },
    old: r => assert.equal(r.out.thrown, 'Không lấy được tên Facebook identity hiện tại'),
    new: r => { assert.equal(r.out.thrown, 'Không lấy được tên Facebook identity hiện tại'); assert.equal(r.state.opens, 2); assert.equal(r.state.expanded, 'false') } },
  { key: 'get_no_button', why: 'không bao giờ có nút menu (trang khác): vẫn đúng câu cũ', block: 'get', cfg: { button: false, current: ME },
    old: r => assert.equal(r.out.thrown, 'Không tìm thấy nút mở menu profile/page hiện tại'), new: r => assert.equal(r.out.thrown, 'Không tìm thấy nút mở menu profile/page hiện tại') },

  { key: 'switch_instant', why: 'menu, danh sách tải ngay: chuyển sang Page như hôm nay', block: 'switch', cfg: { loadMs: [0], current: ME, profiles: [ME, PAGE] },
    opts: { vars: { runAsPageName: PAGE, originalIdentityName: ME }, input: SWITCH_INPUT },
    old: r => { assert.deepEqual(r.out, { ok: true, identityName: PAGE }); assert.equal(r.state.switched, PAGE) },
    new: r => { assert.deepEqual(r.out, { ok: true, identityName: PAGE }); assert.equal(r.state.switched, PAGE); assert.ok(!r.ops.some(o => o.op === 'type'), 'không gõ ô tìm kiếm')
      assert.equal(r.vars.currentIdentityName, PAGE) } },
  { key: 'switch_slow_menu', why: 'câu 605 / 2843 / 637: menu còn khung xám lúc 1,5 giây, nút xem tất cả tới sau 2,5 giây', block: 'switch',
    cfg: { loadMs: [2500], current: ME, profiles: [ME, PAGE] }, opts: { vars: { runAsPageName: PAGE, originalIdentityName: ME }, input: SWITCH_INPUT },
    old: r => assert.deepEqual(r.out, { ok: false, identityName: PAGE, message: 'Không tìm thấy nút xem tất cả profile/page' }),
    new: r => { assert.deepEqual(r.out, { ok: true, identityName: PAGE }); assert.equal(r.state.switched, PAGE) } },
  { key: 'switch_slow_list', why: 'danh sách trang cá nhân tải sau 3 giây: chờ mục tên Page, không phải gõ tìm', block: 'switch',
    cfg: { loadMs: [0], listMs: 3000, current: ME, profiles: [ME, PAGE] }, opts: { vars: { runAsPageName: PAGE, originalIdentityName: ME }, input: SWITCH_INPUT },
    old: null, new: r => { assert.deepEqual(r.out, { ok: true, identityName: PAGE }); assert.ok(!r.ops.some(o => o.op === 'type'), 'không gõ ô tìm kiếm') } },
  { key: 'switch_already_page', why: 'câu 3186: đang ở sẵn đúng Page, danh sách không có chính nó, không có ô tìm kiếm: mở danh sách rồi coi là đang dùng sẵn', block: 'switch',
    cfg: { loadMs: [0], current: PAGE, profiles: [ME], search: false }, opts: { vars: { runAsPageName: PAGE, originalIdentityName: PAGE }, input: SWITCH_INPUT },
    old: r => { assert.equal(r.out.ok, false); assert.match(r.out.message, /^Có lỗi xảy ra khi chọn page\/profile: waitForSelector timeout/) },
    new: r => { assert.deepEqual(r.out, { ok: true, identityName: PAGE, alreadyCurrent: true }); assert.ok(navigated(r.ops), 'vẫn mở trang, mở danh sách')
      assert.equal(r.state.switched, null); assert.equal(r.vars.currentIdentityName, PAGE) } },
  { key: 'switch_already_page_listed', why: 'đang ở sẵn đúng Page mà danh sách có Page đó: bấm lại như hôm nay (không bỏ qua)', block: 'switch',
    cfg: { loadMs: [0], current: PAGE, profiles: [ME, PAGE] }, opts: { vars: { runAsPageName: PAGE, originalIdentityName: PAGE }, input: SWITCH_INPUT },
    old: r => { assert.deepEqual(r.out, { ok: true, identityName: PAGE }); assert.equal(r.state.switched, PAGE) },
    new: r => { assert.deepEqual(r.out, { ok: true, identityName: PAGE }); assert.equal(r.state.switched, PAGE) } },
  { key: 'switch_same_name_profile', why: 'trang cá nhân đặt trùng tên Page (tên đọc được = tên Page), danh sách có Page: vẫn bấm Page, không chạy bằng trang cá nhân', block: 'switch',
    cfg: { loadMs: [2500], current: PAGE, profiles: [PAGE] }, opts: { vars: { runAsPageName: PAGE, originalIdentityName: PAGE }, input: SWITCH_INPUT },
    old: r => assert.deepEqual(r.out, { ok: false, identityName: PAGE, message: 'Không tìm thấy nút xem tất cả profile/page' }),
    new: r => { assert.deepEqual(r.out, { ok: true, identityName: PAGE }); assert.equal(r.state.switched, PAGE, 'đã bấm Page') } },
  { key: 'switch_already_page_no_see_all', why: 'đang ở sẵn đúng Page mà không mở được danh sách (không có nút xem tất cả): vẫn lỗi như cũ, không coi là đang dùng sẵn', block: 'switch',
    cfg: { loadMs: [0], seeAll: false, current: PAGE, profiles: [ME] }, opts: { vars: { runAsPageName: PAGE, originalIdentityName: PAGE }, input: SWITCH_INPUT },
    old: r => assert.deepEqual(r.out, { ok: false, identityName: PAGE, message: 'Không tìm thấy nút xem tất cả profile/page' }),
    new: r => assert.deepEqual(r.out, { ok: false, identityName: PAGE, message: 'Không tìm thấy nút xem tất cả profile/page' }) },
  { key: 'switch_no_original', why: 'không có tên danh tính hiện tại (workflow không đọc tên): vẫn chuyển', block: 'switch',
    cfg: { loadMs: [0], current: ME, profiles: [ME, PAGE] }, opts: { vars: { runAsPageName: PAGE }, input: SWITCH_INPUT },
    old: r => assert.deepEqual(r.out, { ok: true, identityName: PAGE }), new: r => { assert.deepEqual(r.out, { ok: true, identityName: PAGE }); assert.equal(r.state.switched, PAGE) } },
  { key: 'restore_original_is_page', why: 'chuyển về danh tính ban đầu mà danh tính ban đầu chính là Page đang dùng, danh sách không có Page đó: coi là đang dùng sẵn', block: 'switch',
    cfg: { loadMs: [0], current: PAGE, profiles: [ME], search: false }, opts: { vars: { runAsPageName: PAGE, originalIdentityName: PAGE }, input: RESTORE_INPUT },
    old: r => assert.equal(r.out.ok, false),
    new: r => { assert.deepEqual(r.out, { ok: true, identityName: PAGE, alreadyCurrent: true }); assert.ok(navigated(r.ops)); assert.equal(r.state.switched, null) } },
  { key: 'restore_same_run_current', why: 'cùng lượt vừa chuyển sang Page (workflow đăng Page 326), danh tính ban đầu cũng là Page đó: coi là đang dùng sẵn', block: 'switch',
    cfg: { loadMs: [0], current: PAGE, profiles: [ME], search: false }, opts: { vars: { pageName: PAGE, originalIdentityName: PAGE, currentIdentityName: PAGE }, input: RESTORE_INPUT },
    old: r => assert.equal(r.out.ok, false), new: r => assert.deepEqual(r.out, { ok: true, identityName: PAGE, alreadyCurrent: true }) },
  { key: 'restore_page_missing_other', why: 'chuyển về trang cá nhân ban đầu (khác Page đang dùng) mà danh sách không có: vẫn lỗi như cũ', block: 'switch',
    cfg: { loadMs: [0], current: PAGE, profiles: [PAGE] }, opts: { vars: { runAsPageName: PAGE, originalIdentityName: ME }, input: RESTORE_INPUT },
    old: r => assert.deepEqual(r.out, { ok: false, identityName: ME, message: `Không tìm thấy page/profile "${ME}"` }),
    new: r => assert.deepEqual(r.out, { ok: false, identityName: ME, message: `Không tìm thấy page/profile "${ME}"` }) },
  { key: 'restore_normal', why: 'chuyển về trang cá nhân ban đầu (khác Page): chuyển như hôm nay', block: 'switch',
    cfg: { loadMs: [0], current: PAGE, profiles: [ME, PAGE] }, opts: { vars: { runAsPageName: PAGE, originalIdentityName: ME }, input: RESTORE_INPUT },
    old: r => { assert.deepEqual(r.out, { ok: true, identityName: ME }); assert.equal(r.state.switched, ME) },
    new: r => { assert.deepEqual(r.out, { ok: true, identityName: ME }); assert.equal(r.state.switched, ME) } },
  { key: 'switch_search', why: 'Page chỉ hiện khi gõ tìm: gõ ô tìm kiếm rồi chọn như hôm nay', block: 'switch',
    cfg: { loadMs: [0], current: ME, profiles: [ME], searchOnly: [PAGE] }, opts: { vars: { runAsPageName: PAGE, originalIdentityName: ME }, input: SWITCH_INPUT },
    old: r => { assert.deepEqual(r.out, { ok: true, identityName: PAGE }); assert.equal(r.state.typed, PAGE) },
    new: r => { assert.deepEqual(r.out, { ok: true, identityName: PAGE }); assert.equal(r.state.typed, PAGE); assert.equal(r.state.switched, PAGE) } },
  { key: 'switch_never_see_all', why: 'menu không bao giờ có nút xem tất cả: vẫn đúng câu cũ, menu đóng / mở lại một lần', block: 'switch',
    cfg: { loadMs: [0], seeAll: false, current: ME, profiles: [ME, PAGE] }, opts: { vars: { runAsPageName: PAGE, originalIdentityName: ME }, input: SWITCH_INPUT },
    old: r => assert.deepEqual(r.out, { ok: false, identityName: PAGE, message: 'Không tìm thấy nút xem tất cả profile/page' }),
    new: r => { assert.deepEqual(r.out, { ok: false, identityName: PAGE, message: 'Không tìm thấy nút xem tất cả profile/page' }); assert.equal(r.state.opens, 2) } },
  { key: 'switch_page_missing', why: 'không có Page đúng tên kể cả khi gõ tìm: vẫn đúng câu cũ', block: 'switch',
    cfg: { loadMs: [0], current: ME, profiles: [ME] }, opts: { vars: { runAsPageName: PAGE, originalIdentityName: ME }, input: SWITCH_INPUT },
    old: r => assert.deepEqual(r.out, { ok: false, identityName: PAGE, message: `Không tìm thấy page/profile "${PAGE}"` }),
    new: r => assert.deepEqual(r.out, { ok: false, identityName: PAGE, message: `Không tìm thấy page/profile "${PAGE}"` }) },
  { key: 'switch_aborted', why: 'lượt bị ngắt từ ngoài khi đang chờ menu: block ném lỗi huỷ (host báo RUN01 / SYS02 như #734)', block: 'switch',
    cfg: { loadMs: [null], current: ME, profiles: [ME, PAGE] }, opts: { vars: { runAsPageName: PAGE, originalIdentityName: ME }, input: SWITCH_INPUT, abortAfterMs: 800 },
    old: null, new: r => assert.match(String(r.out.thrown), /^Block bị huỷ/) }
]

module.exports = { homePage, CASES, ME, PAGE }
