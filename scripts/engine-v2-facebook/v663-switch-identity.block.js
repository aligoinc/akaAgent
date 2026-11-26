
// V663 (câu 605 / 2843 / 637 / 3186 của bộ kiểm lỗi, anh chốt 26/11/2026):
//  - Menu tài khoản và danh sách trang cá nhân của Facebook tải sau khi mở (ảnh + DOM lỗi 26/11: lúc 1,5 giây menu còn khung xám, khoảng một
//    giây sau đã có nút xem tất cả). Chờ phần tử hiện (tối đa WAIT_MS, mục tên SELECT_WAIT_MS) thay cho ngủ cố định; không thấy nút xem tất cả
//    thì đóng / mở menu lại một lần; bấm nút menu mà menu chưa mở thì bấm lại sau RECLICK_MS. Câu lỗi cũ giữ nguyên.
//  - Thử thật 26/11 trên tài khoản có trang cá nhân và Page cùng tên: mục đầu tiên khớp tên là ô chuyển nhanh "Chuyển sang <tên>", trỏ tới danh
//    tính KHÁC danh tính đang dùng, nên đang ở Page mà "chuyển sang Page" thì bị đưa về trang cá nhân (lỗi có từ bộ cũ). Anh chốt dùng dấu hiệu
//    có mặt: cookie i_user chỉ có khi đang dùng Page. Đã ở đúng danh tính cần tới (đúng tên và đúng loại Page / trang cá nhân) thì không bấm
//    gì; bấm chọn xong thì đọc lại danh tính, chưa đúng thì thử mục khác cùng tên, hết mục mới báo lỗi. Không bao giờ coi là xong khi chưa đúng.
//  - Loại cần tới: chuyển sang (identityNameFromVars runAsPageName / pageName) là Page; chuyển về là loại block đọc tên ghi lại đầu lượt
//    (vars.originalIdentityIsPage: cùng lượt, hoặc bộ lập lịch Desktop truyền vào lượt chuyển về chạy riêng). Không biết loại (bản Desktop
//    chưa truyền) thì chỉ so tên như trước: không bỏ qua bước chuyển, bấm rồi đọc lại tên.
const stepMs = Number(vars.facebookStepMs || input.facebookStepMs || 1000)
const WAIT_MS = 10000
const SELECT_WAIT_MS = 8000
const POLL_MS = 250
const RECLICK_MS = 1500
const MAX_TRIES = 3
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
const menuSelector = await helpers.element('FbIdentityMenuButton')
const currentSelector = await helpers.element('FbCurrentIdentityLink')
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

async function rawText(selector) {
  return await page.evaluate(`
    const selector = __args[0];
    let el = null;
    try { el = document.evaluate(selector, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue; } catch {}
    return el ? String(el.innerText || el.textContent || '').trim() : '';
  `, selector)
}

// Mục thứ index (theo thứ tự trên trang) khớp selector: đếm / bấm.
async function countMatches(selector) {
  return await page.evaluate(`
    try { return document.evaluate(__args[0], document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null).snapshotLength; } catch { return 0; }
  `, selector)
}

async function clickMatch(selector, index) {
  return await page.evaluate(`
    let el = null;
    try { el = document.evaluate(__args[0], document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null).snapshotItem(__args[1]); } catch {}
    if (!el) return { clicked: false };
    try { el.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch {}
    const init = { bubbles: true, cancelable: true, view: window };
    const p = Object.assign({}, init, { pointerId: 1, pointerType: 'mouse', isPrimary: true });
    try { el.dispatchEvent(new PointerEvent('pointerdown', p)); } catch {}
    try { el.dispatchEvent(new MouseEvent('mousedown', init)); } catch {}
    try { el.dispatchEvent(new PointerEvent('pointerup', p)); } catch {}
    try { el.dispatchEvent(new MouseEvent('mouseup', init)); } catch {}
    try { el.click(); } catch {}
    return { clicked: true, label: el.getAttribute('aria-label') || '' };
  `, selector, index)
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

// Đang dùng Page: Facebook đặt cookie i_user (mã Page) khi chuyển sang Page, bỏ khi về trang cá nhân (thử thật 26/11).
async function usingPage() {
  return await page.evaluate(`return /(?:^|; )i_user=/.test(document.cookie)`)
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

// Mở menu: chờ nút có mặt rồi bấm; menu đang mở thì không bấm (bấm nữa là đóng); bấm rồi mà sau RECLICK_MS menu chưa mở thì bấm lại.
// Trả 'open', 'clicked' (đã bấm, không xác nhận được là mở) hoặc 'missing' (không có nút).
async function openMenu() {
  let clickedAt = 0
  const opened = await waitFor(async () => {
    const state = await menuState()
    if (state === 'missing') return false
    if (state === 'open') return true
    if (clickedAt && state === 'unknown') return true
    if (clickedAt && Date.now() - clickedAt < RECLICK_MS) return false
    const clicked = await rawClick(menuSelector)
    if (clicked && clicked.clicked === true) clickedAt = Date.now()
    return false
  }, WAIT_MS)
  return opened ? 'open' : clickedAt ? 'clicked' : 'missing'
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

// Loại danh tính cần tới: 'page', 'profile' hoặc null (không biết: chỉ so tên, không bỏ qua bước chuyển).
function targetKind() {
  if (!useOriginalIdentity) return identityNameFromVars === 'runAsPageName' || identityNameFromVars === 'pageName' ? 'page' : null
  return typeof vars.originalIdentityIsPage === 'boolean' ? (vars.originalIdentityIsPage ? 'page' : 'profile') : null
}

// Danh tính đang dùng: tên trong menu tài khoản và có cookie i_user (đang dùng Page) hay không.
async function readCurrent() {
  if ((await openMenu()) === 'missing') return null
  const name = await waitFor(async () => String(await rawText(currentSelector) || '').trim(), WAIT_MS) || ''
  const isPage = !!(await usingPage().catch(() => false))
  await closeMenu()
  return { name, isPage }
}

const atTarget = (current, kind) => !!current && !!current.name && sameName(current.name, identityName)
  && (kind === 'page' ? current.isPage : kind === 'profile' ? !current.isPage : true)

function switched(result) {
  vars.currentIdentityName = identityName
  return result
}

try {
  helpers.log('Đang chuyển Facebook identity sang "' + identityName + '"')
  await page.navigate('https://facebook.com')
  const kind = targetKind()
  const before = await readCurrent()
  if (!before) return { ok: false, identityName, message: 'Không tìm thấy nút mở menu profile/page hiện tại' }
  if (kind && atTarget(before, kind)) {
    helpers.log('Đang dùng sẵn "' + identityName + '"' + (kind === 'page' ? ' (Page)' : '') + ', không cần chuyển')
    return switched({ ok: true, identityName, alreadyCurrent: true })
  }

  let tried = 0
  for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
    if ((await openMenu()) === 'missing') return { ok: false, identityName, message: 'Không tìm thấy nút mở menu profile/page hiện tại' }
    let seeAll = await clickWhenPresent(seeAllSelector, WAIT_MS)
    if (!seeAll) {
      await closeMenu()
      await helpers.sleep(stepMs + 500, signal)
      if ((await openMenu()) !== 'missing') seeAll = await clickWhenPresent(seeAllSelector, WAIT_MS)
    }
    if (!seeAll) return { ok: false, identityName, message: 'Không tìm thấy nút xem tất cả profile/page' }

    // Lần thử thứ n bấm mục khớp tên thứ n (mục đầu thường là ô chuyển nhanh sang danh tính khác danh tính đang dùng).
    const enough = async () => (await countMatches(selectSelector)) > attempt
    let found = await waitFor(enough, SELECT_WAIT_MS)
    if (!found && attempt === 0) {
      await page.type(searchSelector, identityName, { clearFirst: true })
      found = await waitFor(enough, SELECT_WAIT_MS)
    }
    if (!found) break
    const clicked = await clickMatch(selectSelector, attempt)
    if (!clicked || clicked.clicked !== true) break
    tried++
    await helpers.sleep(stepMs + 7000, signal)
    await page.navigate('https://facebook.com')
    const after = await readCurrent()
    if (atTarget(after, kind)) {
      helpers.log('Đã chuyển identity sang "' + identityName + '"' + (kind === 'page' ? ' (Page)' : ''))
      return switched({ ok: true, identityName })
    }
    helpers.log('Chọn mục ' + (attempt + 1) + ' xong nhưng chưa ở đúng danh tính "' + identityName + '", thử mục khác')
  }

  if (tried) return { ok: false, identityName, message: 'Đã chọn "' + identityName + '" nhưng chưa chuyển sang được đúng danh tính' }
  return { ok: false, identityName, message: 'Không tìm thấy page/profile "' + identityName + '"' }
} catch (e) {
  if (signal && signal.aborted) throw e
  const message = e && e.message ? String(e.message) : String(e)
  return { ok: false, identityName, message: 'Có lỗi xảy ra khi chọn page/profile: ' + message }
}
