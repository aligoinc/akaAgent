-- V472: Up tin / comment vào bài post — phân loại khi không thấy ô bình luận.
-- Data only, không DDL nên không reload schema PostgREST. Production cgjbsmqtfhqvttudyjzq.
-- 1) auto_blocks 2616 fb_comment_current_post: hết 8 giây không thấy ô bình luận thì đọc trang và trả
--    actionResult (bài không còn → Không tồn tại; tắt bình luận/chờ duyệt/chưa vào nhóm → Thất bại;
--    còn lại, kể cả checkpoint/đăng xuất → Lỗi err_fb_comment_box_not_found) thay vì ném lỗi chứa XPath.
-- 2) auto_error 74–77 detail_mode='inherit': với fb_comment, cờ counts_toward_limit/bad_target của mã lỗi chỉ
--    có hiệu lực khi detail_mode khác NULL (src/main/services/actionResultRuntime.ts:151). Giữ mọi cột khác.
-- 3) Thêm err_fb_comment_box_not_found: không tính hạn mức, vẫn tính chuỗi target lỗi chung (ngưỡng 4 của
--    err_undefined) để tự dừng khi Facebook đổi giao diện hàng loạt. Workflow 207 không đổi.
-- Backup: migrations/snapshots/fb-comment-post-unavailable-v472/before.json. Rollback: rollback_v472_*.sql
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

DO $preflight$
BEGIN
  IF (SELECT md5(code) FROM public.auto_blocks WHERE id = 2616 AND name = 'fb_comment_current_post') IS DISTINCT FROM 'fd83066b95a5a2c3c0932bd6009dd2be'
     OR (SELECT md5((to_jsonb(b) - 'updated_at')::text) FROM public.auto_blocks b WHERE id = 2616) IS DISTINCT FROM '2a7f9a7a4323ab48cdccb3a13f1c7321' THEN
    RAISE EXCEPTION 'v472 preflight: auto_blocks/2616 changed since snapshot';
  END IF;
  IF (SELECT md5(nodes::text || edges::text) FROM public.auto_workflows WHERE id = 207) IS DISTINCT FROM '1ee0f7c880e8afa2f205e649d22c2ff9' THEN
    RAISE EXCEPTION 'v472 preflight: auto_workflows/207 changed since snapshot';
  END IF;
  IF (SELECT jsonb_object_agg(id, md5((to_jsonb(e) - 'updated_at')::text)) FROM public.auto_error e WHERE id IN (74, 75, 76, 77))
     IS DISTINCT FROM '{"74": "2cb2190572e82acf69648d78911adb44", "75": "79a0ab984d05d8e6b63e09c25e6d91f8", "76": "0b0473e36b85d7f66e49fad4e9263bae", "77": "982a989f9bbdbb80ee80a8f78155a591"}'::jsonb THEN
    RAISE EXCEPTION 'v472 preflight: auto_error 74-77 changed since snapshot';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_error WHERE error_code = 'err_fb_comment_box_not_found') THEN
    RAISE EXCEPTION 'v472 preflight: err_fb_comment_box_not_found already exists';
  END IF;
  IF (SELECT last_value FROM public.auto_error_id_seq) < (SELECT max(id) FROM public.auto_error) THEN
    RAISE EXCEPTION 'v472 preflight: auto_error_id_seq is behind max(id)';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_blocks WHERE id <> 2616
             AND (code LIKE '%err_fb_comment_unavailable%' OR code LIKE '%err_fb_comment_box_not_found%')) THEN
    RAISE EXCEPTION 'v472 preflight: another block already emits these error codes';
  END IF;
END
$preflight$;

UPDATE public.auto_error
SET detail_mode = 'inherit', updated_at = now()
WHERE id IN (74, 75, 76, 77) AND detail_mode IS NULL;

INSERT INTO public.auto_error (
  error_type, error_name, error_desc, error_code, noti_running_process, noti_campaign,
  counts_toward_limit, counts_toward_bad_target, detail_mode
) VALUES (
  'external facebook', 'Không tìm thấy ô bình luận', $desc$Phạm vi: đã mở link bài post nhưng không thấy ô bình luận trong hộp thoại bài, và trang không khớp trường hợp đã biết (bài không còn, tắt bình luận, chờ duyệt, chưa vào nhóm); gồm cả checkpoint/bị đăng xuất phát hiện qua URL.

Producer: block fb_comment_current_post (id 2616) từ V472, trả actionResult campaign_detail_error. Không tính hạn mức; tính vào chuỗi target lỗi chung (ngưỡng err_undefined). data.reason/headings/sample dùng để bổ sung nhận diện.$desc$, 'err_fb_comment_box_not_found',
  'Không tìm thấy ô bình luận', 'Không tìm thấy ô bình luận', false, true, 'inherit'
);

UPDATE public.auto_blocks
SET code = $v472_block$// Read only after comment submit/settle and the existing frequency-limit check.
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

// V472: when the dialog comment box is missing, classify the opened page and
// return a standard result instead of throwing. Customer text never shows XPath.
const COMMENT_BOX_NOT_FOUND = 'err_fb_comment_box_not_found'
const COMMENT_UNAVAILABLE_RULES = [
  { reason: 'post_not_found', statusCode: 'campaign_detail_not_found',
    errorCode: 'err_fb_comment_unavailable_post_not_found', message: 'Không tìm thấy bài Facebook để bình luận',
    phrases: ['bạn hiện không xem được nội dung này', 'nội dung này hiện không hiển thị', 'nội dung này hiện không có',
      'liên kết bạn truy cập có thể bị hỏng', "this content isn't available", 'this content is not available',
      "this page isn't available", 'the link you followed may be broken'] },
  { reason: 'comment_disabled', statusCode: 'campaign_detail_failed',
    errorCode: 'err_fb_comment_unavailable_comment_disabled', message: 'Bài Facebook đã tắt bình luận',
    phrases: ['đã tắt tính năng bình luận', 'tính năng bình luận đã bị tắt', 'đã tắt bình luận', 'bình luận đã bị tắt',
      'commenting has been turned off', 'comments have been turned off', 'turned off commenting', 'comments are turned off'] },
  { reason: 'post_pending', statusCode: 'campaign_detail_failed',
    errorCode: 'err_fb_comment_unavailable_post_pending', message: 'Bài Facebook đang chờ duyệt nên chưa bình luận được',
    phrases: ['bài viết của bạn đang chờ', 'đang chờ quản trị viên phê duyệt', 'your post is pending', 'pending admin approval'] },
  { reason: 'not_member', statusCode: 'campaign_detail_failed',
    errorCode: 'err_fb_comment_unavailable_not_member', message: 'Chưa đủ quyền thành viên để bình luận trong nhóm',
    phrases: ['tham gia nhóm để bình luận', 'chỉ thành viên mới có thể bình luận', 'join group to comment', 'only members can comment'],
    // Only when the post itself is not shown, so an ad text cannot trigger it.
    gatePhrases: ['tham gia nhóm để xem', 'join this group to', 'join group to view'] }
]

async function readCommentPageSignals() {
  return await page.evaluate(`
    const norm = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
    const visible = (el) => {
      if (!el) return false;
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const dialogs = Array.from(document.querySelectorAll('[role="dialog"]')).filter(visible);
    const main = document.querySelector('[role="main"]');
    const scope = dialogs.length ? dialogs[dialogs.length - 1] : (main || document.body);
    const skip = '[data-ad-preview="message"], [data-ad-comet-preview="message"]';
    const texts = [];
    const seen = new Set();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode() && texts.length < 400) {
      const el = walker.currentNode.parentElement;
      if (!el || el.closest(skip) || !visible(el)) continue;
      const text = norm(el.innerText || el.textContent);
      if (text.length < 6 || text.length > 200 || seen.has(text)) continue;
      seen.add(text);
      texts.push(text);
    }
    const headings = Array.from(document.querySelectorAll('[role="heading"], h1, h2'))
      .filter(visible).map(el => norm(el.innerText || el.textContent)).filter(Boolean)
      .slice(0, 6).map(text => text.slice(0, 120));
    return {
      url: String(location.href || ''),
      title: norm(document.title).slice(0, 120),
      hasDialog: dialogs.length > 0,
      articleCount: scope ? scope.querySelectorAll('[role="article"]').length : 0,
      headings,
      texts
    };
  `)
}

function normalizeCommentPageText(value) {
  return String(value || '').normalize('NFC').replace(/[‘’]/g, "'").toLowerCase()
}

function classifyCommentPage(signals) {
  const url = String((signals && signals.url) || '')
  if (/\/checkpoint\//i.test(url)) {
    return { reason: 'checkpoint', statusCode: 'campaign_detail_error', errorCode: COMMENT_BOX_NOT_FOUND,
      message: 'Facebook yêu cầu xác minh tài khoản (checkpoint)' }
  }
  if (/\/login(\.php)?([/?#]|$)/i.test(url)) {
    return { reason: 'logged_out', statusCode: 'campaign_detail_error', errorCode: COMMENT_BOX_NOT_FOUND,
      message: 'Tài khoản Facebook đã bị đăng xuất' }
  }
  const texts = (signals && Array.isArray(signals.texts) ? signals.texts : []).map(normalizeCommentPageText)
  const articleCount = Number((signals && signals.articleCount) || 0)
  for (const rule of COMMENT_UNAVAILABLE_RULES) {
    const phrases = rule.phrases.concat(articleCount === 0 && rule.gatePhrases ? rule.gatePhrases : [])
    const matched = phrases.find(phrase => texts.some(text => text.includes(phrase)))
    if (matched) {
      return { reason: rule.reason, statusCode: rule.statusCode, errorCode: rule.errorCode, message: rule.message, matched }
    }
  }
  return { reason: 'unknown', statusCode: 'campaign_detail_error', errorCode: COMMENT_BOX_NOT_FOUND,
    message: 'Không tìm thấy ô bình luận trên bài' }
}

async function waitForCommentBox(selector) {
  try {
    await page.waitForSelector(selector, { timeout: 8000 })
    return null
  } catch (cause) {
    const raw = cause && cause.message ? String(cause.message) : String(cause)
    if (signal.aborted || !raw.startsWith('waitForSelector timeout:')) throw cause
    const signals = (await readCommentPageSignals()) || {}
    const result = classifyCommentPage(signals)
    helpers.log('⚠️ ' + result.message)
    // No "error" key: that field becomes the pause-note reason in the runtime.
    const data = {
      reason: result.reason,
      matched: result.matched || null,
      url: String(signals.url || '').slice(0, 300),
      title: String(signals.title || ''),
      hasDialog: signals.hasDialog === true,
      articleCount: Number(signals.articleCount || 0),
      headings: Array.isArray(signals.headings) ? signals.headings.slice(0, 6) : [],
      rawError: raw.slice(0, 300),
      source: 'fb_comment_current_post'
    }
    if (result.reason === 'unknown') {
      data.sample = (Array.isArray(signals.texts) ? signals.texts : []).slice(0, 12).map(t => String(t).slice(0, 100))
    }
    return {
      commented: false, commentFailed: true, position: 1, text, imageCount: 0, error: result.message,
      actionResult: {
        actionCode: 'fb_comment', statusCode: result.statusCode, errorCode: result.errorCode,
        inputDataId: vars.inputDataId ?? null, operationState: 'not_committed', message: result.message, data
      }
    }
  }
}

const inputXpath = await helpers.element('fb_comment_dialog_textbox')
const commentUnavailable = await waitForCommentBox(inputXpath)
if (commentUnavailable) return commentUnavailable
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
$v472_block$, updated_at = now()
WHERE id = 2616 AND md5(code) = 'fd83066b95a5a2c3c0932bd6009dd2be';

DO $postflight$
BEGIN
  IF (SELECT md5(code) FROM public.auto_blocks WHERE id = 2616) IS DISTINCT FROM '83bcdb4081685f2c858f4e0937348767'
     OR (SELECT md5((to_jsonb(b) - 'updated_at' - 'code')::text) FROM public.auto_blocks b WHERE id = 2616) IS DISTINCT FROM '1cb8e08fe5e4e06b9cf05de7d93f23c2' THEN
    RAISE EXCEPTION 'v472 postflight: auto_blocks/2616 unexpected';
  END IF;
  IF (SELECT jsonb_object_agg(id, md5((to_jsonb(e) - 'updated_at' - 'detail_mode')::text)) FROM public.auto_error e WHERE id IN (74, 75, 76, 77))
     IS DISTINCT FROM '{"74": "dba7f65af48feade708087e828294573", "75": "c75aae42d6b5c13e4aa5962289939f4e", "76": "d5417309824696d9492a83ebb554c814", "77": "fbd6c3ce0675bf93ebb224aad631da02"}'::jsonb
     OR (SELECT count(*) FROM public.auto_error WHERE id IN (74, 75, 76, 77) AND detail_mode = 'inherit') <> 4 THEN
    RAISE EXCEPTION 'v472 postflight: auto_error 74-77 unexpected';
  END IF;
  IF (SELECT count(*) FROM public.auto_error
      WHERE error_code = 'err_fb_comment_box_not_found' AND error_type = 'external facebook' AND detail_mode = 'inherit'
        AND counts_toward_limit = false AND counts_toward_bad_target = true AND detail_status IS NULL AND detail_status_id IS NULL
        AND update_status_campaign IS NULL AND update_status_account IS NULL AND update_login_status IS NULL
        AND disable_action_codes = '{}'::text[] AND count_consecutive_errors IS NULL AND input_effect IS NULL
        AND is_active AND NOT is_delete) <> 1 THEN
    RAISE EXCEPTION 'v472 postflight: err_fb_comment_box_not_found unexpected';
  END IF;
  IF (SELECT md5(nodes::text || edges::text) FROM public.auto_workflows WHERE id = 207) IS DISTINCT FROM '1ee0f7c880e8afa2f205e649d22c2ff9' THEN
    RAISE EXCEPTION 'v472 postflight: auto_workflows/207 changed';
  END IF;
END
$postflight$;

COMMIT;
