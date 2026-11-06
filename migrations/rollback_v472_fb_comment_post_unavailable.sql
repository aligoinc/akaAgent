-- Rollback V472: trả block 2616 về bản trước V472, bỏ detail_mode của 74–77, tắt err_fb_comment_box_not_found.
-- Chỉ chạy khi block đang đúng bản V472. Không xoá dòng lỗi mới (chi tiết lịch sử có thể đã tham chiếu mã này).
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

DO $preflight$
BEGIN
  IF (SELECT md5(code) FROM public.auto_blocks WHERE id = 2616) IS DISTINCT FROM '83bcdb4081685f2c858f4e0937348767' THEN
    RAISE EXCEPTION 'v472 rollback: auto_blocks/2616 is not the V472 version';
  END IF;
END
$preflight$;

UPDATE public.auto_blocks
SET code = $v472_before$// Read only after comment submit/settle and the existing frequency-limit check.
// Missing links do not retry the comment or change its successful result.
async function getFirstCommentUrl() {
  try {
    const selector = await helpers.element('fb_comment_permalink')
    return await page.evaluate(`
      const link = document.evaluate(__args[0], document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
      const raw = link ? String(link.href || link.getAttribute('href') || '').trim() : '';
      if (!raw) return '';
      try {
        const url = new URL(raw, 'https://www.facebook.com');
        // Keep comment/reply and post routing parameters; remove tracking only.
        for (const key of Array.from(url.searchParams.keys())) {
          if (key.startsWith('__') || key.startsWith('utm_') ||
              ['fbclid', 'mibextid', 'ref', 'refid', 'refsrc', 'locale'].includes(key)) {
            url.searchParams.delete(key);
          }
        }
        return url.toString();
      } catch {
        return raw;
      }
    `, selector)
  } catch (error) {
    if (signal.aborted) throw error
    return ''
  }
}

// Centralized AI rewrite via ai_using.
const __aiRewriteUsingCode = "fb_comment_current_post_rewrite";
const __extractAIText = (value) => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value).trim();
  if (Array.isArray(value)) return value.map(__extractAIText).filter(Boolean).join('\n').trim();
  if (typeof value === 'object') {
    const data = value;
    const direct = data.content ?? data.data ?? data.Data ?? data.text ?? data.output ?? data.response ?? data.message ?? data.Message ?? data.answer ?? data.result;
    if (direct !== undefined && direct !== null && direct !== value) {
      const directText = __extractAIText(direct);
      if (directText) return directText;
    }
    try { return JSON.stringify(value); } catch { return String(value); }
  }
  return String(value || '').trim();
};
const __callCentralAI = async (usingCode, payload) => {
  if (!usingCode) throw new Error('Thiếu mã cấu hình AI');
  if (typeof helpers.callAIUsing !== 'function') throw new Error('Runtime chưa hỗ trợ helper callAIUsing');
  const result = await helpers.callAIUsing(usingCode, payload || {});
  if (result && result.unsupported) throw new Error('Runtime chưa hỗ trợ helper callAIUsing');
  if (!result || result.ok !== true) throw new Error(String(result && result.error ? result.error : 'AI lỗi'));
  return result;
};
const __callAIText = async (usingCode, payload) => {
  const result = await __callCentralAI(usingCode, payload);
  return __extractAIText(result && (result.content ?? result.data ?? result.text ?? result.output ?? result.response ?? result.rawResponse ?? result));
};
const __callAIRewriteContent = async (content) => {
  const text = String(content || '');
  return await __callAIText(__aiRewriteUsingCode, {
    content: text,
    question: text,
    source: 'aka_agent'
  });
};

const commentFrequencyLimitMessage = 'Facebook báo giới hạn tần suất comment'
const shouldRewriteCommentContentEachRun = vars.rewriteCommentContentEachRun === true

async function hasVisibleElement(selector) {
  return await page.evaluate(`
    const selector = __args[0];

    function isVisible(el) {
      if (!el) return false;
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }

    function xpathAll(xpath) {
      const out = [];
      if (!xpath) return out;
      try {
        const result = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
        for (let i = 0; i < result.snapshotLength; i++) {
          const item = result.snapshotItem(i);
          if (item) out.push(item);
        }
      } catch {}
      return out;
    }

    return xpathAll(selector).some(isVisible);
  `, selector);
}

async function throwIfCommentFrequencyLimited() {
  const frequencyLimitError = await helpers.element('GroupPostFrequencyLimitError');
  const hasFrequencyLimitError = await hasVisibleElement(frequencyLimitError);
  if (hasFrequencyLimitError) {
    helpers.log(commentFrequencyLimitMessage);
    throw new Error(commentFrequencyLimitMessage);
  }
}

const formatTemplateDate = (dayKey, formatKey) => {
  const d = new Date()
  const key = String(dayKey || 'TODAY').toUpperCase()
  if (key === 'TOMORROW') d.setDate(d.getDate() + 1)
  if (key === 'YESTERDAY') d.setDate(d.getDate() - 1)

  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yyyy = String(d.getFullYear())
  const format = String(formatKey || 'DD/MM/YYYY').toUpperCase()
  return format === 'MM/DD/YYYY'
    ? mm + '/' + dd + '/' + yyyy
    : dd + '/' + mm + '/' + yyyy
}

const renderCommentTemplate = async (raw) => {
  let rendered = String(raw || '')

  if (/#\{\s*FULL_NAME\s*\}/i.test(rendered)) {
    const fullName = String(vars.campaignInputDataName || vars.inputDataName || '').trim()
    rendered = rendered.replace(/#\{\s*FULL_NAME\s*\}/gi, fullName)
  }

  rendered = rendered.replace(
    /#\{\s*(TODAY|TOMORROW|YESTERDAY)\s*(?:\(\s*(DD\/MM\/YYYY|MM\/DD\/YYYY)\s*\))?\s*\}/gi,
    (_match, dayKey, formatKey) => formatTemplateDate(dayKey, formatKey)
  )

  return rendered
}

const rewriteCommentForRun = async (raw) => {
  const original = String(raw || '')
  const content = original.trim()
  if (!shouldRewriteCommentContentEachRun || !content) return original

  try {
    const rewritten = await __callAIRewriteContent(content)
    if (!rewritten) throw new Error('AI trả về nội dung không hợp lệ.')
    helpers.log('Đã viết lại nội dung comment bằng AI')
    return rewritten
  } catch (e) {
    const message = e && e.message ? String(e.message) : String(e)
    helpers.log('AI viết lại nội dung comment lỗi, dùng nội dung gốc: ' + message)
    return original
  }
}

const item = (vars && vars.loopItem) ? vars.loopItem : {}
let text
let images
if (typeof helpers.prepareCampaignContent === 'function') {
  const prepared = await helpers.prepareCampaignContent({ kind: 'comment', rewriteCode: __aiRewriteUsingCode })
  text = prepared.content.replace(/\t/g, '      ')
  images = prepared.media.slice(0, 1)
  vars.contentVariantIndex = prepared.variantIndex
} else {
text = String(input.text || item.text || '')
text = await renderCommentTemplate(text)
text = await rewriteCommentForRun(text)
text = text.replace(/\t/g, '      ')
const batchIndex = Number(vars && vars.loopIndex)
const batchImages = Array.isArray(vars && vars.commentImageBatches) && Array.isArray(vars.commentImageBatches[batchIndex])
  ? vars.commentImageBatches[batchIndex]
  : []
const fallbackImages = Array.isArray(vars && vars.commentImages) ? vars.commentImages : []
const rawImages = Array.isArray(input.images) && input.images.length > 0
  ? input.images
  : (Array.isArray(item.images) && item.images.length > 0
      ? item.images
      : (batchImages.length > 0 ? batchImages : fallbackImages))
images = rawImages.map(x => String(x || '').trim()).filter(Boolean).slice(0, 1)
}

if (!text && images.length === 0) return { commented: false, position: 1, text: '', imageCount: 0 }

const inputXpath = await helpers.element('fb_comment_dialog_textbox')
await page.waitForSelector(inputXpath, { timeout: 8000 })
await page.click(inputXpath)
await helpers.sleep(1000, signal)

if (text) {
  await page.fill(inputXpath, text)
  await helpers.sleep(1000, signal)
}

let imageCount = 0
if (images.length > 0) {
  const dropResult = await page.dropFile(inputXpath, images)
  imageCount = Number(dropResult.fileCount || 0)
  await helpers.sleep(10000, signal)
  if (!text && imageCount <= 0) {
    return { commented: false, position: 1, text: '', imageCount: 0 }
  }
}

await page.click(inputXpath)
await helpers.sleep(500, signal)
await page.press('Enter')
await helpers.sleep(10000, signal)
await throwIfCommentFrequencyLimited()
const commentUrl = await getFirstCommentUrl()

const logSuffix = text ? ': ' + text.substring(0, 50) : ''
helpers.log('💬 Đã comment vào bài post' + logSuffix)
return { commented: true, commentUrl, position: 1, text: text, imageCount: imageCount, rewrittenContent: shouldRewriteCommentContentEachRun }
$v472_before$, updated_at = now()
WHERE id = 2616 AND md5(code) = '83bcdb4081685f2c858f4e0937348767';

UPDATE public.auto_error SET detail_mode = NULL, updated_at = now()
WHERE id IN (74, 75, 76, 77) AND detail_mode = 'inherit';

UPDATE public.auto_error SET is_active = false, updated_at = now()
WHERE error_code = 'err_fb_comment_box_not_found';

DO $postflight$
BEGIN
  IF (SELECT md5(code) FROM public.auto_blocks WHERE id = 2616) IS DISTINCT FROM 'fd83066b95a5a2c3c0932bd6009dd2be' THEN
    RAISE EXCEPTION 'v472 rollback postflight: block 2616 not restored';
  END IF;
  IF (SELECT jsonb_object_agg(id, md5((to_jsonb(e) - 'updated_at')::text)) FROM public.auto_error e WHERE id IN (74, 75, 76, 77))
     IS DISTINCT FROM '{"74": "2cb2190572e82acf69648d78911adb44", "75": "79a0ab984d05d8e6b63e09c25e6d91f8", "76": "0b0473e36b85d7f66e49fad4e9263bae", "77": "982a989f9bbdbb80ee80a8f78155a591"}'::jsonb THEN
    RAISE EXCEPTION 'v472 rollback postflight: auto_error 74-77 not restored';
  END IF;
END
$postflight$;

COMMIT;
