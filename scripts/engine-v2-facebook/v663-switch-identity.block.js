
// V663 (câu 605 / 2843 / 637 / 3186 của bộ kiểm lỗi, anh chốt 26/11/2026):
//  - Menu tài khoản và danh sách trang cá nhân của Facebook tải sau khi mở (ảnh + DOM lỗi 26/11: lúc 1,5 giây menu còn khung xám, khoảng một
//    giây sau đã có nút xem tất cả). Chờ phần tử hiện (tối đa WAIT_MS, mục tên Page SELECT_WAIT_MS) thay cho ngủ cố định; không thấy nút xem tất
//    cả thì đóng / mở menu lại một lần. Câu lỗi giữ nguyên.
//  - Tên danh tính hiện tại (block đọc tên vừa đọc) trùng tên cần chuyển: đang dùng sẵn, không mở danh sách chọn lại chính nó. Chuyển về danh
//    tính ban đầu mà danh tính ban đầu chính là Page của chiến dịch (lượt đó không chuyển): cũng không cần chuyển.
const stepMs = Number(vars.facebookStepMs || input.facebookStepMs || 1000)
const WAIT_MS = 10000
const SELECT_WAIT_MS = 8000
const POLL_MS = 250
const useOriginalIdentity = input.useOriginalIdentity === true
const identityNameFromVars = String(input.identityNameFromVars || '').trim()
const identityName = String(
  useOriginalIdentity
    ? (vars.originalIdentityName || '')
    : identityNameFromVars
      ? (vars[identityNameFromVars] || '')
      : (input.identityName || vars.identityName || vars.pageName || '')
).trim()

if (!identityName) {
  return {
    ok: false,
    identityName,
    message: useOriginalIdentity ? 'Không có tên profile gốc để chuyển lại' : 'Thiếu tên identity/page cần chuyển'
  }
}

const sameName = (a, b) => String(a || '').trim().normalize('NFC') === String(b || '').trim().normalize('NFC')
if (!useOriginalIdentity && vars.originalIdentityName && sameName(vars.originalIdentityName, identityName)) {
  vars.identitySwitchSkipped = true
  helpers.log('Đang dùng sẵn "' + identityName + '", không cần chuyển')
  return { ok: true, identityName, alreadyCurrent: true }
}
if (useOriginalIdentity && (vars.identitySwitchSkipped === true || (vars.runAsPageName && sameName(identityName, vars.runAsPageName)))) {
  helpers.log('Danh tính ban đầu "' + identityName + '" đang dùng sẵn, không cần chuyển về')
  return { ok: true, identityName, alreadyCurrent: true }
}

const menuSelector = await helpers.element('FbIdentityMenuButton')
const seeAllSelector = await helpers.element('FbIdentitySeeAllButton')
const searchSelector = await helpers.element('FbIdentitySearchInput')
const selectTemplate = await helpers.element('FbIdentitySelectByNameButton')

function xpathLiteral(value) {
  const text = String(value || '')
  if (!text.includes("'")) return "'" + text + "'"
  const singleQuoteLiteral = '"\'"'
  return 'concat(' + text.split("'").map(part => "'" + part + "'").join(', ' + singleQuoteLiteral + ', ') + ')'
}

const selectSelector = selectTemplate.replace("'$page_name'", xpathLiteral(identityName)).replace('$page_name', identityName)

async function rawClick(selector) {
  return await page.evaluate(`
    const selector = __args[0];
    function xpathAll(xpath) {
      const out = [];
      try {
        const result = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
        for (let i = 0; i < result.snapshotLength; i++) {
          const item = result.snapshotItem(i);
          if (item) out.push(item);
        }
      } catch {}
      return out;
    }
    function clickSynthetic(el) {
      try { el.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch {}
      const init = { bubbles: true, cancelable: true, view: window };
      const p = Object.assign({}, init, { pointerId: 1, pointerType: 'mouse', isPrimary: true });
      try { el.dispatchEvent(new PointerEvent('pointerdown', p)); } catch {}
      try { el.dispatchEvent(new MouseEvent('mousedown', init)); } catch {}
      try { el.dispatchEvent(new PointerEvent('pointerup', p)); } catch {}
      try { el.dispatchEvent(new MouseEvent('mouseup', init)); } catch {}
      try { el.click(); } catch {}
    }
    const el = xpathAll(selector)[0] || null;
    if (!el) return { clicked: false };
    clickSynthetic(el);
    return { clicked: true };
  `, selector)
}

// Nút menu tài khoản: 'missing' (chưa có), 'open' / 'closed' (aria-expanded), 'unknown' (không có aria-expanded).
async function menuState() {
  return await page.evaluate(`
    const selector = __args[0];
    let el = null;
    try { el = document.evaluate(selector, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue; } catch {}
    if (!el) return 'missing';
    const expanded = el.getAttribute('aria-expanded');
    return expanded === 'true' ? 'open' : expanded === 'false' ? 'closed' : 'unknown';
  `, menuSelector)
}

async function waitFor(read, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await read()
    if (value) return value
    if (Date.now() >= deadline) return null
    await helpers.sleep(POLL_MS, signal)
  }
}

// Mở menu: chờ nút có mặt rồi bấm; menu đang mở thì không bấm (bấm nữa là đóng).
async function openMenu() {
  return await waitFor(async () => {
    const state = await menuState()
    if (state === 'missing') return false
    if (state === 'open') return true
    const clicked = await rawClick(menuSelector)
    return !!(clicked && clicked.clicked === true)
  }, WAIT_MS)
}

// Đóng menu: chỉ bấm khi menu đang mở (hoặc không biết trạng thái, như trước).
async function closeMenu() {
  const state = await menuState().catch(() => 'unknown')
  if (state === 'open' || state === 'unknown') await rawClick(menuSelector).catch(() => null)
}

async function clickWhenPresent(selector, timeoutMs) {
  return await waitFor(async () => {
    const clicked = await rawClick(selector)
    return !!(clicked && clicked.clicked === true)
  }, timeoutMs)
}

try {
  helpers.log('Đang chuyển Facebook identity sang "' + identityName + '"')
  await page.navigate('https://facebook.com')
  if (!(await openMenu())) return { ok: false, identityName, message: 'Không tìm thấy nút mở menu profile/page hiện tại' }

  let seeAll = await clickWhenPresent(seeAllSelector, WAIT_MS)
  if (!seeAll) {
    await closeMenu()
    await helpers.sleep(stepMs + 500, signal)
    if (await openMenu()) seeAll = await clickWhenPresent(seeAllSelector, WAIT_MS)
  }
  if (!seeAll) return { ok: false, identityName, message: 'Không tìm thấy nút xem tất cả profile/page' }

  let selected = await clickWhenPresent(selectSelector, SELECT_WAIT_MS)
  if (selected) {
    await helpers.sleep(stepMs + 7000, signal)
    helpers.log('Đã chuyển identity sang "' + identityName + '"')
    return { ok: true, identityName }
  }

  await page.type(searchSelector, identityName, { clearFirst: true })

  selected = await clickWhenPresent(selectSelector, SELECT_WAIT_MS)
  if (selected) {
    await helpers.sleep(stepMs + 7000, signal)
    helpers.log('Đã chuyển identity sang "' + identityName + '"')
    return { ok: true, identityName }
  }

  return { ok: false, identityName, message: 'Không tìm thấy page/profile "' + identityName + '"' }
} catch (e) {
  if (signal && signal.aborted) throw e
  const message = e && e.message ? String(e.message) : String(e)
  return { ok: false, identityName, message: 'Có lỗi xảy ra khi chọn page/profile: ' + message }
}
