-- Gỡ V572: trả bản "[engine] fb_comment_at_position" (block 2851) và md5 đã duyệt của danh mục bước về bản V563. Chỉ chạy khi block đang
-- đúng bản V572 (đã ai sửa sau V572 thì dừng, không ghi đè). Bộ cũ không đổi. SINH TỪ scripts/build-v572-sql.cjs.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = 2851 AND md5(code) = '16e51c5de52e79d246e87058a65e63eb') THEN
    RAISE EXCEPTION 'Gỡ V572: block 2851 không phải bản V572 (md5 16e51c5de52e79d246e87058a65e63eb), không ghi đè';
  END IF;
END $pre$;

UPDATE public.auto_blocks SET code = $v572_comment$// [engine] V563 (rà lỗi Facebook 17/11/2026): đăng nhóm kèm comment chỉ comment "bài của mình" khi thấy đúng bài vừa đăng: mã bài trong
// link lấy sau khi đăng (vars.groupPostPostUrl) trùng mã bài trong khung chứa ô bình luận. Không thấy (chưa lấy được link, bài video chưa
// hiện, bài chờ duyệt) thì bỏ qua, không comment vào bài người khác (chưa lấy được link thì block chỉnh comment đã bỏ lượt này và báo khách
// trước vòng comment). Comment bài khác mà ô ở đúng vị trí lại thuộc bài vừa
// đăng thì lấy ô của bài kế tiếp. Chỉ trong workflow đăng nhóm (vars.groupPostSubmitted); comment seeding giữ như bộ cũ.
const __OWN_POST_SKIP_MESSAGE = 'Chưa thấy bài vừa đăng trên trang nhóm nên bỏ qua comment vào bài của mình'
function __commentPostIdOf(url) {
  const text = String(url || '')
  const match = text.match(/\/(?:posts|permalink)\/(\d+)/) || text.match(/[?&]story_fbid=(\d+)/)
  return match ? match[1] : ''
}
async function __resolveCommentTarget(position) {
  if (vars.groupPostSubmitted !== true) return { xpath: null }
  const kind = String(vars.commentType || 'own')
  const ownTarget = position === 1 && (kind === 'own' || (kind === 'all' && vars.groupPostIsPending !== true))
  const ownId = __commentPostIdOf(vars.groupPostPostUrl)
  if (!ownTarget && !ownId) return { xpath: null }
  if (ownTarget && !ownId) return { skip: true, message: __OWN_POST_SKIP_MESSAGE }
  const indexed = String(await helpers.elementWith('fb_comment_box_at_n', { n: 1 }))
  if (!/\[1\]\s*$/.test(indexed)) return ownTarget ? { skip: true, message: __OWN_POST_SKIP_MESSAGE } : { xpath: null }
  const union = indexed.replace(/\[1\]\s*$/, '')
  const token = 'aka_cmt_' + Date.now() + '_' + Math.random().toString(36).slice(2)
  const picked = await page.evaluate(String.raw`
    const unionXpath = __args[0]; const ownId = __args[1]; const token = __args[2]; const mode = __args[3]; const position = Number(__args[4]) || 1;
    function xpathAll(xpath) { const out = []; try { const r = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null); for (let i = 0; i < r.snapshotLength; i++) { const it = r.snapshotItem(i); if (it) out.push(it); } } catch {} return out; }
    function idOfHref(href) { if (!href) return ''; let text = String(href); try { text = new URL(text, location.href).href; } catch {} const m = text.match(/\/(?:posts|permalink)\/(\d+)/) || text.match(/[?&]story_fbid=(\d+)/); return m ? m[1] : ''; }
    function postIdOf(el) { let node = el; let found = ''; for (let depth = 0; node && node.nodeType === 1 && depth < 40; depth++) { const ids = new Set(); const anchors = node.querySelectorAll('a[href]'); for (let i = 0; i < anchors.length; i++) { const id = idOfHref(anchors[i].getAttribute('href')); if (id) { ids.add(id); if (ids.size > 1) break; } } if (ids.size > 1) break; if (ids.size === 1) found = Array.from(ids)[0]; node = node.parentElement; } return found; }
    for (const el of Array.from(document.querySelectorAll('[data-aka-comment-target]'))) el.removeAttribute('data-aka-comment-target');
    const boxes = xpathAll(unionXpath);
    let chosen = null;
    if (mode === 'own') {
      chosen = boxes.find(el => postIdOf(el) === ownId) || null;
    } else {
      const atPosition = boxes[position - 1];
      if (!atPosition || postIdOf(atPosition) !== ownId) return 'legacy';
      for (let i = position; i < boxes.length; i++) { if (postIdOf(boxes[i]) !== ownId) { chosen = boxes[i]; break; } }
    }
    if (!chosen) return 'none';
    chosen.setAttribute('data-aka-comment-target', token);
    return 'marked';
  `, union, ownId, token, ownTarget ? 'own' : 'other', position)
  if (picked === 'marked') return { xpath: "//*[@data-aka-comment-target='" + token + "']" }
  if (ownTarget) return { skip: true, message: __OWN_POST_SKIP_MESSAGE }
  return { xpath: null }
}

// Read only after comment submit/settle and the existing frequency-limit check.
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
const __aiRewriteUsingCode = "fb_comment_at_position_rewrite";
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
const pos = Number(input.position || item.position || 1)
const __commentTarget = await __resolveCommentTarget(pos)
if (__commentTarget.skip) {
  helpers.log(__commentTarget.message)
  return { commented: false, position: pos, text: '', imageCount: 0, ownPostSkipped: true, skipReason: __commentTarget.message }
}
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

if (!text && images.length === 0) return { commented: false, position: pos, text: '', imageCount: 0 }

let imageCount = 0

try {
  // FB comment box dùng Lexical -> page.fill dispatch paste như akaBizAuto DispatchPaste.
  // Pattern: click -> sleep 2s -> paste/drop -> Enter.
  const boxXpath = __commentTarget.xpath || await helpers.elementWith('fb_comment_box_at_n', { n: pos })
  await page.waitForSelector(boxXpath, { timeout: 8000 })
  await page.click(boxXpath)
  await helpers.sleep(2000, signal)
  const inputXpath = await helpers.element('fb_comment_dialog_textbox')
  await page.waitForSelector(inputXpath, { timeout: 8000 })

  if (text) {
    await page.fill(inputXpath, text)
    await helpers.sleep(1000, signal)
    // Append a real space after paste so the final word no longer ends at the caret.
    await page.type(inputXpath, ' ')
    await helpers.sleep(500, signal)
  }

  if (images.length > 0) {
    const dropResult = await page.dropFile(inputXpath, images)
    imageCount = Number(dropResult.fileCount || 0)
    await helpers.sleep(10000, signal)
    if (!text && imageCount <= 0) {
      return { commented: false, position: pos, text: '', imageCount: 0 }
    }
  }

  await page.press('Enter')
  await helpers.sleep(10000, signal)
  await throwIfCommentFrequencyLimited()
  const commentUrl = await getFirstCommentUrl()
  const logSuffix = text ? ': ' + text.substring(0, 50) : ''
  helpers.log('💬 Đã comment vào bài #' + pos + logSuffix)
  return { commented: true, commentUrl, position: pos, text: text, imageCount: imageCount, rewrittenContent: shouldRewriteCommentContentEachRun }
} catch (e) {
  const message = e && e.message ? String(e.message) : String(e)
  if (message.includes(commentFrequencyLimitMessage)) throw e
  try {
    await page.press('Escape')
    await helpers.sleep(500, signal)
  } catch {}
  helpers.log('⚠️ Không comment được bài #' + pos + ': ' + message)
  return {
    commented: false,
    commentFailed: true,
    position: pos,
    text: text,
    imageCount: imageCount,
    error: message,
    rewrittenContent: shouldRewriteCommentContentEachRun
  }
}
$v572_comment$, updated_at = now()
 WHERE id = 2851 AND md5(code) = '16e51c5de52e79d246e87058a65e63eb';
UPDATE public.auto_engine_block_steps SET reviewed_code_md5 = '06889369d1c9f77ef62c846fa8e27e82', updated_at = now()
 WHERE id = 6 AND block_id = 2851 AND reviewed_code_md5 = '16e51c5de52e79d246e87058a65e63eb';

DO $post$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = 2851 AND md5(code) = '06889369d1c9f77ef62c846fa8e27e82') THEN
    RAISE EXCEPTION 'Gỡ V572 postflight: block 2851 chưa về bản V563';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_engine_block_steps WHERE block_id = 2851 AND reviewed_code_md5 IS DISTINCT FROM '06889369d1c9f77ef62c846fa8e27e82') THEN
    RAISE EXCEPTION 'Gỡ V572 postflight: danh mục bước của block 2851 chưa về md5 V563';
  END IF;
END $post$;

COMMIT;
