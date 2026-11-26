
// V663 (câu 605 / 632 / 609 / 610 của bộ kiểm lỗi, anh chốt 26/11/2026): menu tài khoản của Facebook tải nội dung sau khi mở (ảnh + DOM lỗi
// 26/11: lúc 1,5 giây menu còn khung xám, khoảng một giây sau đã có link tên). Chờ phần tử hiện (tối đa WAIT_MS) thay cho ngủ cố định; chưa có
// thì đóng / mở menu lại một lần. Câu lỗi giữ nguyên.
const stepMs = Number(vars.facebookStepMs || input.facebookStepMs || 1000)
const WAIT_MS = 10000
const POLL_MS = 250
const menuSelector = await helpers.element('FbIdentityMenuButton')
const currentSelector = await helpers.element('FbCurrentIdentityLink')

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
    const el = xpathAll(selector)[0] || null;
    return el ? String(el.innerText || el.textContent || '').trim() : '';
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

const readName = async () => String(await rawText(currentSelector) || '').trim()

helpers.log('Đang lấy tên Facebook identity hiện tại')
await page.navigate('https://facebook.com')
if (!(await openMenu())) throw new Error('Không tìm thấy nút mở menu profile/page hiện tại')

let identityName = await waitFor(readName, WAIT_MS)
if (!identityName) {
  await closeMenu()
  await helpers.sleep(stepMs + 500, signal)
  if (await openMenu()) identityName = await waitFor(readName, WAIT_MS)
}
await closeMenu()
await helpers.sleep(stepMs + 500, signal)

if (!identityName) throw new Error('Không lấy được tên Facebook identity hiện tại')
vars.originalIdentityName = identityName
helpers.log('Identity hiện tại: ' + identityName)
return { ok: true, identityName }
