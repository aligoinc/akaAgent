-- Gỡ V663: trả block 2879 / 2880 về bản production trước V663 (= bộ cũ, md5 dfc2ad1c4bf6a6831968cedf206807ed / aaf3d54ca1041881d67073359168647f), danh mục bước của 2880,
-- câu chính sách 284 và tên mã FB06 (auto_error 65) về câu cũ. Chỉ chạy khi mọi thứ đang đúng bản V663 (đã ai sửa sau V663 thì dừng,
-- không ghi đè). Bộ cũ không đổi. SINH TỪ scripts/build-v663-sql.cjs.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = 2879 AND md5(code) = 'ad88ba5e6b3f56bc96e0ca9f79571cf6')
     OR NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = 2880 AND md5(code) = '46a9e22dd09d5efc5953eece67451285') THEN
    RAISE EXCEPTION 'Gỡ V663: block 2879 / 2880 không phải bản V663, không ghi đè';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_engine_block_steps WHERE id = 24 AND block_id = 2880 AND reviewed_code_md5 = '46a9e22dd09d5efc5953eece67451285') THEN
    RAISE EXCEPTION 'Gỡ V663: danh mục bước 24 không phải bản V663';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_outcome_policies WHERE id = 284 AND log_template = 'Không chuyển được sang Page đã chọn' AND campaign_note_template = 'Không chuyển được sang Page đã chọn (FB06). Kiểm tra tài khoản còn quản lý Page này và tên Page trong chiến dịch đã đúng chưa, rồi bấm Tiếp tục chiến dịch.') THEN
    RAISE EXCEPTION 'Gỡ V663: câu chính sách 284 không phải bản V663';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_error WHERE id = 65 AND customer_title = 'Không chuyển được sang Page đã chọn') THEN
    RAISE EXCEPTION 'Gỡ V663: tên mã FB06 không phải bản V663';
  END IF;
END $pre$;

UPDATE public.auto_blocks SET code = $v663_identity$
const stepMs = Number(vars.facebookStepMs || input.facebookStepMs || 1000)
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

helpers.log('Đang lấy tên Facebook identity hiện tại')
await page.navigate('https://facebook.com')
const opened = await rawClick(menuSelector)
if (!opened || opened.clicked !== true) throw new Error('Không tìm thấy nút mở menu profile/page hiện tại')
await helpers.sleep(stepMs + 500, signal)

const identityName = String(await rawText(currentSelector) || '').trim()
await rawClick(menuSelector).catch(() => null)
await helpers.sleep(stepMs + 500, signal)

if (!identityName) throw new Error('Không lấy được tên Facebook identity hiện tại')
vars.originalIdentityName = identityName
helpers.log('Identity hiện tại: ' + identityName)
return { ok: true, identityName }
$v663_identity$, updated_at = now()
 WHERE id = 2879 AND md5(code) = 'ad88ba5e6b3f56bc96e0ca9f79571cf6';

UPDATE public.auto_blocks SET code = $v663_identity$
const stepMs = Number(vars.facebookStepMs || input.facebookStepMs || 1000)
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

try {
  helpers.log('Đang chuyển Facebook identity sang "' + identityName + '"')
  await page.navigate('https://facebook.com')
  const opened = await rawClick(menuSelector)
  if (!opened || opened.clicked !== true) return { ok: false, identityName, message: 'Không tìm thấy nút mở menu profile/page hiện tại' }
  await helpers.sleep(stepMs + 500, signal)

  const seeAll = await rawClick(seeAllSelector)
  if (!seeAll || seeAll.clicked !== true) return { ok: false, identityName, message: 'Không tìm thấy nút xem tất cả profile/page' }
  await helpers.sleep(stepMs + 500, signal)

  let selected = await rawClick(selectSelector)
  if (selected && selected.clicked === true) {
    await helpers.sleep(stepMs + 7000, signal)
    helpers.log('Đã chuyển identity sang "' + identityName + '"')
    return { ok: true, identityName }
  }

  await page.type(searchSelector, identityName, { clearFirst: true })
  await helpers.sleep(stepMs + 500, signal)

  selected = await rawClick(selectSelector)
  if (selected && selected.clicked === true) {
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
$v663_identity$, updated_at = now()
 WHERE id = 2880 AND md5(code) = '46a9e22dd09d5efc5953eece67451285';

UPDATE public.auto_engine_block_steps SET reviewed_code_md5 = 'aaf3d54ca1041881d67073359168647f', updated_at = now()
 WHERE id = 24 AND block_id = 2880 AND reviewed_code_md5 = '46a9e22dd09d5efc5953eece67451285';

UPDATE public.auto_outcome_policies SET log_template = 'Không chuyển được sang Page để đăng bài', campaign_note_template = 'Không chuyển được sang Page để đăng bài (FB06). Kiểm tra tài khoản còn quản lý Page này và tên Page trong chiến dịch đã đúng chưa, rồi bấm Tiếp tục chiến dịch.', updated_at = now()
 WHERE id = 284 AND log_template = 'Không chuyển được sang Page đã chọn' AND campaign_note_template = 'Không chuyển được sang Page đã chọn (FB06). Kiểm tra tài khoản còn quản lý Page này và tên Page trong chiến dịch đã đúng chưa, rồi bấm Tiếp tục chiến dịch.';

UPDATE public.auto_error SET customer_title = 'Không chuyển được sang Page để đăng bài', updated_at = now()
 WHERE id = 65 AND customer_title = 'Không chuyển được sang Page đã chọn';

DO $post$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = 2879 AND md5(code) = 'dfc2ad1c4bf6a6831968cedf206807ed')
     OR NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = 2880 AND md5(code) = 'aaf3d54ca1041881d67073359168647f') THEN
    RAISE EXCEPTION 'Gỡ V663 postflight: block 2879 / 2880 chưa về bản trước V663';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_engine_block_steps WHERE block_id = 2880 AND reviewed_code_md5 IS DISTINCT FROM 'aaf3d54ca1041881d67073359168647f')
     OR NOT EXISTS (SELECT 1 FROM public.auto_outcome_policies WHERE id = 284 AND log_template = 'Không chuyển được sang Page để đăng bài' AND campaign_note_template = 'Không chuyển được sang Page để đăng bài (FB06). Kiểm tra tài khoản còn quản lý Page này và tên Page trong chiến dịch đã đúng chưa, rồi bấm Tiếp tục chiến dịch.')
     OR NOT EXISTS (SELECT 1 FROM public.auto_error WHERE id = 65 AND customer_title = 'Không chuyển được sang Page để đăng bài') THEN
    RAISE EXCEPTION 'Gỡ V663 postflight: danh mục bước / câu FB06 chưa về bản trước V663';
  END IF;
END $post$;

COMMIT;
