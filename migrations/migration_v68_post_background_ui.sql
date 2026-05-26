-- Migration v68: Facebook UI post background support for timeline/page composer.

BEGIN;

INSERT INTO public.auto_elements (name, xpath, description, category, is_builtin, staff_id, organization_id, updated_at)
VALUES
  ('FbComposerBackgroundButton', '//*[@role=''button'' and contains(@aria-label, ''phông nền'')]', 'Nút mở danh sách phông nền bài viết theo C# akaBizAuto', 'facebook', true, NULL, NULL, now()),
  ('FbComposerBackgroundOption', '//*[@role=''button'' and contains(@aria-label, '','') and (contains(@aria-label, ''nền'') or contains(@aria-label, ''Nền''))]', 'Các lựa chọn phông nền bài viết theo C# akaBizAuto', 'facebook', true, NULL, NULL, now())
ON CONFLICT (name) DO UPDATE SET
  xpath = EXCLUDED.xpath,
  description = EXCLUDED.description,
  category = EXCLUDED.category,
  is_builtin = true,
  updated_at = now();

UPDATE public.auto_blocks
SET
  code = replace(
  code,
$old$const textSelector = await helpers.element('FbComposerTextInput')
const formSelector = await helpers.element('FbComposerForm')$old$,
$new$const textSelector = await helpers.element('FbComposerTextInput')
const backgroundButtonSelector = await helpers.element('FbComposerBackgroundButton')
const backgroundOptionSelector = await helpers.element('FbComposerBackgroundOption')
const formSelector = await helpers.element('FbComposerForm')$new$
  ),
  updated_at = now()
WHERE name = 'fb_post_current_identity_ui'
  AND code NOT LIKE '%FbComposerBackgroundButton%';

UPDATE public.auto_blocks
SET
  code = replace(
  code,
$old$if (message) {
  const filled = await rawFillContent(textSelector, message)$old$,
$new$if ((vars.postWithBackground === true || input.postWithBackground === true) && message) {
  try {
    helpers.log('Đang chọn phông nền bài viết')
    const showBackgroundSelectBtn = await rawClick(backgroundButtonSelector)
    if (showBackgroundSelectBtn && showBackgroundSelectBtn.clicked === true) {
      await helpers.sleep(stepMs + 1000, signal)
      const backgroundCount = await rawCount(backgroundOptionSelector)
      if (backgroundCount > 0) {
        const iBg = Math.floor(Math.random() * backgroundCount)
        await rawClick(backgroundOptionSelector, { index: iBg })
        await helpers.sleep(stepMs + 1000, signal)
      }
    }
  } catch (e) {
    const errMessage = e && e.message ? String(e.message) : String(e)
    helpers.log('Chọn phông nền lỗi, tiếp tục đăng bài: ' + errMessage)
  }
}

if (message) {
  const filled = await rawFillContent(textSelector, message)$new$
  ),
  updated_at = now()
WHERE name = 'fb_post_current_identity_ui'
  AND code LIKE '%FbComposerBackgroundButton%'
  AND code NOT LIKE '%Đang chọn phông nền bài viết%';

UPDATE public.auto_blocks
SET
  code = replace(
  code,
$old$text = await rewriteContentForRun(text)

const dialog = await helpers.element('fb_composer_dialog')$old$,
$new$text = await rewriteContentForRun(text)

const backgroundButtonSelector = await helpers.element('FbComposerBackgroundButton')
const backgroundOptionSelector = await helpers.element('FbComposerBackgroundOption')

async function rawClick(selector, options) {
  return await page.evaluate(`
    const selector = __args[0];
    const options = __args[1] || {};
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
    const arr = xpathAll(selector);
    let el = null;
    if (options.last === true) el = arr[arr.length - 1] || null;
    else if (typeof options.index === 'number') el = arr[options.index] || null;
    else el = arr[0] || null;
    if (!el) return { clicked: false, count: arr.length, label: '' };
    const label = el.getAttribute('aria-label') || String(el.innerText || el.textContent || '').trim();
    clickSynthetic(el);
    return { clicked: true, count: arr.length, label };
  `, selector, options || {})
}

async function rawCount(selector) {
  return await page.evaluate(`
    const selector = __args[0];
    try {
      const result = document.evaluate(selector, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      return result.snapshotLength;
    } catch {
      return 0;
    }
  `, selector)
}

const dialog = await helpers.element('fb_composer_dialog')$new$
  ),
  updated_at = now()
WHERE name = 'fb_type_post_content'
  AND code NOT LIKE '%FbComposerBackgroundButton%';

UPDATE public.auto_blocks
SET
  code = replace(
  code,
$old$await helpers.sleep(800, signal)
await page.fill(dialog, text)$old$,
$new$await helpers.sleep(800, signal)
if (vars.postWithBackground === true && String(text || '').trim()) {
  try {
    helpers.log('Đang chọn phông nền bài viết')
    const showBackgroundSelectBtn = await rawClick(backgroundButtonSelector)
    if (showBackgroundSelectBtn && showBackgroundSelectBtn.clicked === true) {
      await helpers.sleep(Number(vars.facebookStepMs || 1000) + 1000, signal)
      const backgroundCount = await rawCount(backgroundOptionSelector)
      if (backgroundCount > 0) {
        const iBg = Math.floor(Math.random() * backgroundCount)
        await rawClick(backgroundOptionSelector, { index: iBg })
        await helpers.sleep(Number(vars.facebookStepMs || 1000) + 1000, signal)
      }
    }
  } catch (e) {
    const errMessage = e && e.message ? String(e.message) : String(e)
    helpers.log('Chọn phông nền lỗi, tiếp tục đăng bài: ' + errMessage)
  }
}
await page.fill(dialog, text)$new$
  ),
  updated_at = now()
WHERE name = 'fb_type_post_content'
  AND code LIKE '%FbComposerBackgroundButton%'
  AND code NOT LIKE '%Đang chọn phông nền bài viết%';

COMMIT;
