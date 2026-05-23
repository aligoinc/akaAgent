-- Migration v59: compose fanpage UI posting workflow from reusable small blocks.
-- The legacy fb_page_post_ui block is kept for backward compatibility but is no longer used by facebook_page_post.

BEGIN;

UPDATE public.auto_blocks
SET
  code = $block$
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
$block$,
  default_config = COALESCE(default_config, '{}'::jsonb) || '{"facebookStepMs":1000}'::jsonb,
  updated_at = now()
WHERE name = 'fb_switch_identity_by_name';

UPDATE public.auto_blocks
SET
  code = CASE
    WHEN position('v59-safe-output-wrapper' in code) > 0 THEN code
    ELSE 'try { /* v59-safe-output-wrapper */' || chr(10) || code || chr(10) || $catch$
} catch (e) {
  if (signal && signal.aborted) throw e
  const message = e && e.message ? String(e.message) : String(e)
  helpers.log('Đăng bài bằng giao diện lỗi: ' + message)
  return { ok: false, posted: false, mode: 'ui', postUrl: '', imageCount: 0, error: message }
}
$catch$
  END,
  updated_at = now()
WHERE name = 'fb_post_current_identity_ui';

WITH block_ids AS (
  SELECT name, id
  FROM public.auto_blocks
  WHERE name IN (
    'if_else',
    'fb_scrape_post',
    'merge',
    'fb_get_current_identity_name',
    'fb_switch_identity_by_name',
    'fb_post_current_identity_ui',
    'fb_page_post_api'
  )
)
UPDATE public.auto_workflows
SET
  nodes = jsonb_build_array(
    jsonb_build_object(
      'id', 'if_copy_source',
      'blockId', (SELECT id FROM block_ids WHERE name = 'if_else'),
      'blockName', 'if_else',
      'systemType', 'ifElse',
      'label', 'Có copy nguồn?',
      'position', jsonb_build_object('x', 0, 'y', 0),
      'config', jsonb_build_object('condition', 'vars.copyContentFromSource === true && !!vars.sourceLink')
    ),
    jsonb_build_object(
      'id', 'scrape_source',
      'blockId', (SELECT id FROM block_ids WHERE name = 'fb_scrape_post'),
      'blockName', 'fb_scrape_post',
      'label', 'Copy nội dung nguồn',
      'position', jsonb_build_object('x', -180, 'y', 120),
      'config', '{}'::jsonb
    ),
    jsonb_build_object(
      'id', 'merge_source',
      'blockId', (SELECT id FROM block_ids WHERE name = 'merge'),
      'blockName', 'merge',
      'systemType', 'merge',
      'label', 'Gộp nguồn',
      'position', jsonb_build_object('x', 0, 'y', 240),
      'config', jsonb_build_object('mode', 'any')
    ),
    jsonb_build_object(
      'id', 'if_ui_mode',
      'blockId', (SELECT id FROM block_ids WHERE name = 'if_else'),
      'blockName', 'if_else',
      'systemType', 'ifElse',
      'label', 'Đăng bằng giao diện?',
      'position', jsonb_build_object('x', 0, 'y', 360),
      'config', jsonb_build_object('condition', 'vars.pagePostMode === ''ui''')
    ),
    jsonb_build_object(
      'id', 'get_original_identity',
      'blockId', (SELECT id FROM block_ids WHERE name = 'fb_get_current_identity_name'),
      'blockName', 'fb_get_current_identity_name',
      'label', 'Lấy profile gốc',
      'position', jsonb_build_object('x', -360, 'y', 480),
      'config', '{}'::jsonb
    ),
    jsonb_build_object(
      'id', 'switch_to_page',
      'blockId', (SELECT id FROM block_ids WHERE name = 'fb_switch_identity_by_name'),
      'blockName', 'fb_switch_identity_by_name',
      'label', 'Chuyển sang fanpage',
      'position', jsonb_build_object('x', -360, 'y', 600),
      'config', jsonb_build_object('identityNameFromVars', 'pageName')
    ),
    jsonb_build_object(
      'id', 'if_page_switched',
      'blockId', (SELECT id FROM block_ids WHERE name = 'if_else'),
      'blockName', 'if_else',
      'systemType', 'ifElse',
      'label', 'Đã chuyển page?',
      'position', jsonb_build_object('x', -360, 'y', 720),
      'config', jsonb_build_object('condition', 'input.ok === true')
    ),
    jsonb_build_object(
      'id', 'post_current_identity_ui',
      'blockId', (SELECT id FROM block_ids WHERE name = 'fb_post_current_identity_ui'),
      'blockName', 'fb_post_current_identity_ui',
      'label', 'Đăng trên identity hiện tại',
      'position', jsonb_build_object('x', -500, 'y', 840),
      'config', '{}'::jsonb
    ),
    jsonb_build_object(
      'id', 'merge_restore_identity',
      'blockId', (SELECT id FROM block_ids WHERE name = 'merge'),
      'blockName', 'merge',
      'systemType', 'merge',
      'label', 'Gộp restore',
      'position', jsonb_build_object('x', -360, 'y', 960),
      'config', jsonb_build_object('mode', 'any')
    ),
    jsonb_build_object(
      'id', 'restore_original_identity',
      'blockId', (SELECT id FROM block_ids WHERE name = 'fb_switch_identity_by_name'),
      'blockName', 'fb_switch_identity_by_name',
      'label', 'Chuyển lại profile gốc',
      'position', jsonb_build_object('x', -360, 'y', 1080),
      'config', jsonb_build_object('useOriginalIdentity', true)
    ),
    jsonb_build_object(
      'id', 'post_page_api',
      'blockId', (SELECT id FROM block_ids WHERE name = 'fb_page_post_api'),
      'blockName', 'fb_page_post_api',
      'label', 'Đăng fanpage bằng API',
      'position', jsonb_build_object('x', 220, 'y', 480),
      'config', '{}'::jsonb
    )
  ),
  edges = jsonb_build_array(
    jsonb_build_object('id', 'e-if-copy-true', 'source', 'if_copy_source', 'target', 'scrape_source', 'sourceHandle', 'true'),
    jsonb_build_object('id', 'e-if-copy-false', 'source', 'if_copy_source', 'target', 'merge_source', 'sourceHandle', 'false'),
    jsonb_build_object('id', 'e-scrape-merge', 'source', 'scrape_source', 'target', 'merge_source'),
    jsonb_build_object('id', 'e-merge-if-ui', 'source', 'merge_source', 'target', 'if_ui_mode'),
    jsonb_build_object('id', 'e-if-ui-true', 'source', 'if_ui_mode', 'target', 'get_original_identity', 'sourceHandle', 'true'),
    jsonb_build_object('id', 'e-if-ui-false', 'source', 'if_ui_mode', 'target', 'post_page_api', 'sourceHandle', 'false'),
    jsonb_build_object('id', 'e-get-original-switch-page', 'source', 'get_original_identity', 'target', 'switch_to_page'),
    jsonb_build_object('id', 'e-switch-page-if', 'source', 'switch_to_page', 'target', 'if_page_switched'),
    jsonb_build_object('id', 'e-page-switched-true', 'source', 'if_page_switched', 'target', 'post_current_identity_ui', 'sourceHandle', 'true'),
    jsonb_build_object('id', 'e-page-switched-false', 'source', 'if_page_switched', 'target', 'merge_restore_identity', 'sourceHandle', 'false'),
    jsonb_build_object('id', 'e-post-current-merge-restore', 'source', 'post_current_identity_ui', 'target', 'merge_restore_identity'),
    jsonb_build_object('id', 'e-merge-restore-original', 'source', 'merge_restore_identity', 'target', 'restore_original_identity')
  ),
  default_variables = COALESCE(default_variables, '{}'::jsonb) || '{"businessUrl":"https://business.facebook.com/content_management","pagePostMode":"api","published":true,"facebookStepMs":1000,"facebookSubmitTimeoutMs":30000,"facebookPublishTimeoutMs":120000}'::jsonb,
  updated_at = now()
WHERE name = 'facebook_page_post';

COMMIT;
