-- V663: engine v2 Facebook, nhóm FB06 chuyển sang Page (câu 605 / 2843 / 637 / 632 / 609 / 610 / 3186 của bộ kiểm lỗi, anh chốt 26/11/2026).
-- Block "[engine] fb_get_current_identity_name" (2879) và "[engine] fb_switch_identity_by_name" (2880): chờ menu tài khoản / danh sách trang
-- cá nhân tải xong thay cho ngủ cố định 1,5 giây (ảnh + DOM lỗi 26/11: menu còn khung xám lúc bấm), đóng / mở menu lại một lần; tài khoản đã ở
-- sẵn đúng Page mà danh sách không có mục để chọn lại thì coi là đang dùng sẵn (vẫn mở danh sách, bấm như cũ). Câu lỗi giữ nguyên. Danh mục bước của 2880 theo
-- code mới. Câu FB06 cho khách bỏ "để đăng bài" (chính sách 284, auto_error 65); cách xử lý FB06 giữ nguyên (tạm dừng chiến dịch).
-- Bộ cũ (2670 / 2671) và sổ chép block không đổi.
-- SINH TỪ scripts/build-v663-sql.cjs (nguồn guard: scripts/fixtures/engine-v2-facebook/v663-live-20261126.json), không sửa tay.
-- Chỉ dữ liệu, không DDL (không nạp lại schema PostgREST). Desktop đọc code block mỗi lượt. Gỡ: rollback_v663_engine_facebook_page_identity_wait.sql.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
DECLARE v_n integer;
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v663_%') THEN
      RAISE EXCEPTION 'V663 đã có trong sổ migration, không chạy lại';
    END IF;
  END IF;
  IF to_regclass('public.auto_engine_block_copies') IS NULL OR to_regclass('public.auto_engine_block_steps') IS NULL THEN
    RAISE EXCEPTION 'V663 cần V556–V560 (sổ chép block, danh mục bước)';
  END IF;
  SELECT count(*) INTO v_n FROM public.auto_blocks b JOIN public.auto_engine_block_copies c ON c.engine_block_id = b.id
   WHERE (b.id, b.name, c.source_block_id, md5(b.code)) IN ((2879, '[engine] fb_get_current_identity_name', 2670, 'dfc2ad1c4bf6a6831968cedf206807ed'),
     (2880, '[engine] fb_switch_identity_by_name', 2671, 'aaf3d54ca1041881d67073359168647f'));
  IF v_n <> 2 THEN RAISE EXCEPTION 'V663: block 2879 / 2880 không còn đúng bản production (md5 dfc2ad1c4bf6a6831968cedf206807ed / aaf3d54ca1041881d67073359168647f), đọc lại và sinh lại'; END IF;
  SELECT count(*) INTO v_n FROM public.auto_blocks WHERE (id, md5(code)) IN ((2670, 'dfc2ad1c4bf6a6831968cedf206807ed'), (2671, 'aaf3d54ca1041881d67073359168647f'));
  IF v_n <> 2 THEN RAISE EXCEPTION 'V663: block bộ cũ 2670 / 2671 khác bản đã đọc'; END IF;
  SELECT count(*) INTO v_n FROM public.auto_engine_block_steps WHERE block_id IN (2879, 2880);
  IF v_n <> 1 OR NOT EXISTS (SELECT 1 FROM public.auto_engine_block_steps WHERE id = 24 AND block_id = 2880 AND step_kind = 'session'
     AND is_active AND workflow_id IS NULL AND node_id IS NULL AND reviewed_code_md5 = 'aaf3d54ca1041881d67073359168647f') THEN
    RAISE EXCEPTION 'V663: danh mục bước của block 2879 / 2880 khác bản đã đọc (một dòng session 24)';
  END IF;
  SELECT count(*) INTO v_n FROM public.auto_elements WHERE (name, xpath) IN (
      ('FbIdentityMenuButton', '//*[@role=''button'' and (@aria-label=''Trang cá nhân của bạn'' or @aria-label=''Tài khoản, trang cá nhân của bạn'' or @aria-label=''Account, your profile'')]'),
      ('FbCurrentIdentityLink', '//a[@href=''/me/'']'),
      ('FbIdentitySeeAllButton', '//*[@role=''button'' and @aria-label=''Xem tất cả trang cá nhân'']'),
      ('FbIdentitySearchInput', '//input[contains(@aria-label, ''Tìm kiếm trang'')]'),
      ('FbIdentitySelectByNameButton', '//*[@role=''button'' and .//span[.=''$page_name'']]'));
  IF v_n <> 5 THEN RAISE EXCEPTION 'V663: element danh tính Facebook (FbIdentity*) khác bản đã đọc'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_outcome_policies WHERE id = 284 AND error_code = 'err_fb_identity_switch_failed' AND is_active
     AND NOT is_delete AND action_code IS NULL AND campaign_action_id IS NULL AND campaign_effect = 'pause' AND target_effect = 'requeue'
     AND log_template = 'Không chuyển được sang Page để đăng bài' AND campaign_note_template = 'Không chuyển được sang Page để đăng bài (FB06). Kiểm tra tài khoản còn quản lý Page này và tên Page trong chiến dịch đã đúng chưa, rồi bấm Tiếp tục chiến dịch.') THEN
    RAISE EXCEPTION 'V663: chính sách 284 (FB06) khác bản đã đọc';
  END IF;
  SELECT count(*) INTO v_n FROM public.auto_outcome_policies WHERE error_code = 'err_fb_identity_switch_failed' AND is_active AND NOT is_delete;
  IF v_n <> 1 THEN RAISE EXCEPTION 'V663: FB06 có % chính sách đang bật (cần đúng 1: 284)', v_n; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_error WHERE id = 65 AND error_code = 'err_fb_identity_switch_failed' AND public_code = 'FB06'
     AND customer_title = 'Không chuyển được sang Page để đăng bài') THEN
    RAISE EXCEPTION 'V663: mã FB06 (auto_error 65) khác bản đã đọc';
  END IF;
END $pre$;

UPDATE public.auto_blocks SET code = $v663_identity$
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
$v663_identity$, updated_at = now()
 WHERE id = 2879 AND md5(code) = 'dfc2ad1c4bf6a6831968cedf206807ed';

UPDATE public.auto_blocks SET code = $v663_identity$
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
$v663_identity$, updated_at = now()
 WHERE id = 2880 AND md5(code) = 'aaf3d54ca1041881d67073359168647f';

UPDATE public.auto_engine_block_steps SET reviewed_code_md5 = '4ada28c669fe48a8758a7ae55f016f44', updated_at = now()
 WHERE id = 24 AND block_id = 2880 AND reviewed_code_md5 = 'aaf3d54ca1041881d67073359168647f';

UPDATE public.auto_outcome_policies SET log_template = 'Không chuyển được sang Page đã chọn', campaign_note_template = 'Không chuyển được sang Page đã chọn (FB06). Kiểm tra tài khoản còn quản lý Page này và tên Page trong chiến dịch đã đúng chưa, rồi bấm Tiếp tục chiến dịch.', updated_at = now()
 WHERE id = 284 AND log_template = 'Không chuyển được sang Page để đăng bài' AND campaign_note_template = 'Không chuyển được sang Page để đăng bài (FB06). Kiểm tra tài khoản còn quản lý Page này và tên Page trong chiến dịch đã đúng chưa, rồi bấm Tiếp tục chiến dịch.';

UPDATE public.auto_error SET customer_title = 'Không chuyển được sang Page đã chọn', updated_at = now()
 WHERE id = 65 AND customer_title = 'Không chuyển được sang Page để đăng bài';

DO $post$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = 2879 AND md5(code) = 'd8ecb8593bc930a8c5461e802684d475')
     OR NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = 2880 AND md5(code) = '4ada28c669fe48a8758a7ae55f016f44') THEN
    RAISE EXCEPTION 'V663 postflight: code block 2879 / 2880 không phải bản mới (md5 d8ecb8593bc930a8c5461e802684d475 / 4ada28c669fe48a8758a7ae55f016f44)';
  END IF;
  IF (SELECT count(*) FROM public.auto_blocks WHERE (id, md5(code)) IN ((2670, 'dfc2ad1c4bf6a6831968cedf206807ed'), (2671, 'aaf3d54ca1041881d67073359168647f'))) <> 2 THEN
    RAISE EXCEPTION 'V663 postflight: block bộ cũ đã đổi (V663 không được đụng bộ cũ)';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_engine_block_steps WHERE block_id = 2880 AND reviewed_code_md5 IS DISTINCT FROM '4ada28c669fe48a8758a7ae55f016f44') THEN
    RAISE EXCEPTION 'V663 postflight: danh mục bước của block 2880 chưa theo code mới';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_outcome_policies WHERE id = 284 AND is_active AND campaign_effect = 'pause' AND target_effect = 'requeue'
     AND log_template = 'Không chuyển được sang Page đã chọn' AND campaign_note_template = 'Không chuyển được sang Page đã chọn (FB06). Kiểm tra tài khoản còn quản lý Page này và tên Page trong chiến dịch đã đúng chưa, rồi bấm Tiếp tục chiến dịch.') THEN
    RAISE EXCEPTION 'V663 postflight: câu chính sách 284 chưa đổi hoặc cách xử lý FB06 bị đổi';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_error WHERE id = 65 AND customer_title = 'Không chuyển được sang Page đã chọn') THEN
    RAISE EXCEPTION 'V663 postflight: tên mã FB06 cho khách chưa đổi';
  END IF;
END $post$;

COMMIT;
