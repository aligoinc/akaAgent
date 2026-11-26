
// V663 (câu 605 / 2843 / 637 / 3186 của bộ kiểm lỗi, anh chốt 26/11/2026):
//  - Menu tài khoản và danh sách trang cá nhân của Facebook tải sau khi mở (ảnh + DOM lỗi 26/11: lúc 1,5 giây menu còn khung xám, khoảng một
//    giây sau đã có nút xem tất cả). Chờ phần tử hiện (tối đa WAIT_MS, mục tên Page SELECT_WAIT_MS) thay cho ngủ cố định; không thấy nút xem tất
//    cả thì đóng / mở menu lại một lần. Câu lỗi giữ nguyên.
//  - Vẫn mở danh sách và bấm mục đúng tên như trước (anh chốt "Chỉ khi không chọn được": trang cá nhân có thể đặt trùng tên Page, 261/352 lần
//    chuyển 7 ngày có tên hiện tại trùng tên Page). Chỉ khi danh sách đã mở mà không có mục nào để bấm (kể cả sau khi gõ ô tìm kiếm, hay không có
//    ô tìm kiếm) và danh tính đang dùng trùng đúng tên cần chuyển thì coi là đang dùng sẵn (câu 3186: Facebook không liệt kê chính Page đang dùng).
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
// Danh tính đang dùng: chuyển sang → tên block đọc tên vừa đọc; chuyển về → danh tính vừa chuyển sang trong cùng lượt, không có thì Page của
// chiến dịch (lượt chuyển về chạy riêng sau khi đã chuyển sang Page).
const currentIdentityName = String(useOriginalIdentity ? (vars.currentIdentityName || vars.runAsPageName || '') : (vars.originalIdentityName || '')).trim()
const alreadyCurrent = !!currentIdentityName && sameName(currentIdentityName, identityName)
let listOpened = false

function switched(result) {
  vars.currentIdentityName = identityName
  return result
}

// Không chọn được mục đúng tên: lỗi như trước, trừ khi danh sách đã mở và đang dùng sẵn đúng danh tính đó.
function notSelectable(message) {
  if (listOpened && alreadyCurrent) {
    helpers.log('Đang dùng sẵn "' + identityName + '" (danh sách không có mục để chọn lại), không cần chuyển')
    return switched({ ok: true, identityName, alreadyCurrent: true })
  }
  return { ok: false, identityName, message }
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
  listOpened = true

  let selected = await clickWhenPresent(selectSelector, SELECT_WAIT_MS)
  if (selected) {
    await helpers.sleep(stepMs + 7000, signal)
    helpers.log('Đã chuyển identity sang "' + identityName + '"')
    return switched({ ok: true, identityName })
  }

  await page.type(searchSelector, identityName, { clearFirst: true })

  selected = await clickWhenPresent(selectSelector, SELECT_WAIT_MS)
  if (selected) {
    await helpers.sleep(stepMs + 7000, signal)
    helpers.log('Đã chuyển identity sang "' + identityName + '"')
    return switched({ ok: true, identityName })
  }

  return notSelectable('Không tìm thấy page/profile "' + identityName + '"')
} catch (e) {
  if (signal && signal.aborted) throw e
  const message = e && e.message ? String(e.message) : String(e)
  return notSelectable('Có lỗi xảy ra khi chọn page/profile: ' + message)
}
