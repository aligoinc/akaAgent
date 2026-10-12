-- Source: migrations/snapshots/facebook-first-comment-link-v380/before.json.
-- Data only: no RPC/schema changes, reload, historical detail edits or new connection source.
BEGIN;
SET LOCAL timezone='UTC';
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='8s';
SELECT id FROM public.auto_blocks WHERE id IN (34,2616,2710) ORDER BY id FOR UPDATE;
SELECT id FROM public.auto_elements WHERE id=1517 FOR SHARE;
SELECT id FROM public.auto_workflows WHERE id IN (1,157,207,238,244,245,252,254) ORDER BY id FOR SHARE;
DO $v380$
BEGIN
IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v380_%') THEN RAISE EXCEPTION 'v380 already applied'; END IF;
IF EXISTS(SELECT 1 FROM public.auto_elements WHERE name='fb_comment_permalink') THEN RAISE EXCEPTION 'v380 element already exists'; END IF;
IF (SELECT md5(to_jsonb(t)::text) FROM public.auto_blocks t WHERE id=34) IS DISTINCT FROM 'ec2be390d574048d0d8bd78a816b1c53' THEN RAISE EXCEPTION 'v380: auto_blocks/34 drift'; END IF;
IF (SELECT md5(to_jsonb(t)::text) FROM public.auto_blocks t WHERE id=2616) IS DISTINCT FROM '03fed9cf8e6aa777553a12b6550f0ba5' THEN RAISE EXCEPTION 'v380: auto_blocks/2616 drift'; END IF;
IF (SELECT md5(to_jsonb(t)::text) FROM public.auto_blocks t WHERE id=2710) IS DISTINCT FROM '3b9b2808a1a28c18df86eb5200108d04' THEN RAISE EXCEPTION 'v380: auto_blocks/2710 drift'; END IF;
IF (SELECT md5(to_jsonb(t)::text) FROM public.auto_elements t WHERE id=1517) IS DISTINCT FROM 'fe7cb9063f40b17d1b23490cb7d3d964' THEN RAISE EXCEPTION 'v380: auto_elements/1517 drift'; END IF;
IF (SELECT md5(to_jsonb(t)::text) FROM public.auto_workflows t WHERE id=1) IS DISTINCT FROM 'bd87d312f3a64de77376387dd31e4c06' THEN RAISE EXCEPTION 'v380: workflow/1 drift'; END IF;
IF (SELECT md5(to_jsonb(t)::text) FROM public.auto_workflows t WHERE id=157) IS DISTINCT FROM 'c71addb507fc158e3da0ff73a1877656' THEN RAISE EXCEPTION 'v380: workflow/157 drift'; END IF;
IF (SELECT md5(to_jsonb(t)::text) FROM public.auto_workflows t WHERE id=207) IS DISTINCT FROM '0bf510a8374bc4f1758413decdc99513' THEN RAISE EXCEPTION 'v380: workflow/207 drift'; END IF;
IF (SELECT md5(to_jsonb(t)::text) FROM public.auto_workflows t WHERE id=238) IS DISTINCT FROM 'bb6fc0af416f5e902b43543cdcfdc64b' THEN RAISE EXCEPTION 'v380: workflow/238 drift'; END IF;
IF (SELECT md5(to_jsonb(t)::text) FROM public.auto_workflows t WHERE id=244) IS DISTINCT FROM '62543fa005207634ce8466825161a992' THEN RAISE EXCEPTION 'v380: workflow/244 drift'; END IF;
IF (SELECT md5(to_jsonb(t)::text) FROM public.auto_workflows t WHERE id=245) IS DISTINCT FROM '346b0e46e083f7030e4dfe959d73f7f6' THEN RAISE EXCEPTION 'v380: workflow/245 drift'; END IF;
IF (SELECT md5(to_jsonb(t)::text) FROM public.auto_workflows t WHERE id=252) IS DISTINCT FROM '50a4db70f2f52ecffeb52998594ee389' THEN RAISE EXCEPTION 'v380: workflow/252 drift'; END IF;
IF (SELECT md5(to_jsonb(t)::text) FROM public.auto_workflows t WHERE id=254) IS DISTINCT FROM '1af7b8c5249ed954281c41e6b045bb4e' THEN RAISE EXCEPTION 'v380: workflow/254 drift'; END IF;
INSERT INTO public.auto_elements (category,description,is_builtin,name,organization_id,staff_id,xpath) VALUES ('facebook','Link bình luận trong dialog bài viết; sau khi gửi comment lấy href đầu tiên theo thứ tự DOM.',true,'fb_comment_permalink',NULL,NULL,'(//*[@role=''dialog'' and not(@aria-label=''Thông báo'') and not(@aria-label=''Messenger'')])[1]//*[@role=''article'' and .//*[@class=''xt0psk2'']]//a[contains(@href,''comment_id='') or contains(@href,''reply_comment_id='')]');
UPDATE public.auto_blocks SET code='// Read only after comment submit/settle and the existing frequency-limit check.
// Missing links do not retry the comment or change its successful result.
async function getFirstCommentUrl() {
  try {
    const selector = await helpers.element(''fb_comment_permalink'')
    return await page.evaluate(`
      const link = document.evaluate(__args[0], document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
      return link ? String(link.href || link.getAttribute(''href'') || '''').trim() : '''';
    `, selector)
  } catch (error) {
    if (signal.aborted) throw error
    return ''''
  }
}

// Centralized AI rewrite via ai_using.
const __aiRewriteUsingCode = "fb_comment_at_position_rewrite";
const __extractAIText = (value) => {
  if (value === null || value === undefined) return '''';
  if (typeof value === ''string'') return value.trim();
  if (typeof value === ''number'' || typeof value === ''boolean'') return String(value).trim();
  if (Array.isArray(value)) return value.map(__extractAIText).filter(Boolean).join(''\n'').trim();
  if (typeof value === ''object'') {
    const data = value;
    const direct = data.content ?? data.data ?? data.Data ?? data.text ?? data.output ?? data.response ?? data.message ?? data.Message ?? data.answer ?? data.result;
    if (direct !== undefined && direct !== null && direct !== value) {
      const directText = __extractAIText(direct);
      if (directText) return directText;
    }
    try { return JSON.stringify(value); } catch { return String(value); }
  }
  return String(value || '''').trim();
};
const __callCentralAI = async (usingCode, payload) => {
  if (!usingCode) throw new Error(''Thiếu mã cấu hình AI'');
  if (typeof helpers.callAIUsing !== ''function'') throw new Error(''Runtime chưa hỗ trợ helper callAIUsing'');
  const result = await helpers.callAIUsing(usingCode, payload || {});
  if (result && result.unsupported) throw new Error(''Runtime chưa hỗ trợ helper callAIUsing'');
  if (!result || result.ok !== true) throw new Error(String(result && result.error ? result.error : ''AI lỗi''));
  return result;
};
const __callAIText = async (usingCode, payload) => {
  const result = await __callCentralAI(usingCode, payload);
  return __extractAIText(result && (result.content ?? result.data ?? result.text ?? result.output ?? result.response ?? result.rawResponse ?? result));
};
const __callAIRewriteContent = async (content) => {
  const text = String(content || '''');
  return await __callAIText(__aiRewriteUsingCode, {
    content: text,
    question: text,
    source: ''aka_agent''
  });
};

const commentFrequencyLimitMessage = ''Facebook báo giới hạn tần suất comment''
const shouldRewriteCommentContentEachRun = vars.rewriteCommentContentEachRun === true

async function hasVisibleElement(selector) {
  return await page.evaluate(`
    const selector = __args[0];

    function isVisible(el) {
      if (!el) return false;
      const style = window.getComputedStyle(el);
      if (style.display === ''none'' || style.visibility === ''hidden'' || style.opacity === ''0'') return false;
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
  const frequencyLimitError = await helpers.element(''GroupPostFrequencyLimitError'');
  const hasFrequencyLimitError = await hasVisibleElement(frequencyLimitError);
  if (hasFrequencyLimitError) {
    helpers.log(commentFrequencyLimitMessage);
    throw new Error(commentFrequencyLimitMessage);
  }
}

const formatTemplateDate = (dayKey, formatKey) => {
  const d = new Date()
  const key = String(dayKey || ''TODAY'').toUpperCase()
  if (key === ''TOMORROW'') d.setDate(d.getDate() + 1)
  if (key === ''YESTERDAY'') d.setDate(d.getDate() - 1)

  const dd = String(d.getDate()).padStart(2, ''0'')
  const mm = String(d.getMonth() + 1).padStart(2, ''0'')
  const yyyy = String(d.getFullYear())
  const format = String(formatKey || ''DD/MM/YYYY'').toUpperCase()
  return format === ''MM/DD/YYYY''
    ? mm + ''/'' + dd + ''/'' + yyyy
    : dd + ''/'' + mm + ''/'' + yyyy
}

const renderCommentTemplate = async (raw) => {
  let rendered = String(raw || '''')

  if (/#\{\s*FULL_NAME\s*\}/i.test(rendered)) {
    const fullName = String(vars.campaignInputDataName || vars.inputDataName || '''').trim()
    rendered = rendered.replace(/#\{\s*FULL_NAME\s*\}/gi, fullName)
  }

  rendered = rendered.replace(
    /#\{\s*(TODAY|TOMORROW|YESTERDAY)\s*(?:\(\s*(DD\/MM\/YYYY|MM\/DD\/YYYY)\s*\))?\s*\}/gi,
    (_match, dayKey, formatKey) => formatTemplateDate(dayKey, formatKey)
  )

  return rendered
}

const rewriteCommentForRun = async (raw) => {
  const original = String(raw || '''')
  const content = original.trim()
  if (!shouldRewriteCommentContentEachRun || !content) return original

  try {
    const rewritten = await __callAIRewriteContent(content)
    if (!rewritten) throw new Error(''AI trả về nội dung không hợp lệ.'')
    helpers.log(''Đã viết lại nội dung comment bằng AI'')
    return rewritten
  } catch (e) {
    const message = e && e.message ? String(e.message) : String(e)
    helpers.log(''AI viết lại nội dung comment lỗi, dùng nội dung gốc: '' + message)
    return original
  }
}

const item = (vars && vars.loopItem) ? vars.loopItem : {}
const pos = Number(input.position || item.position || 1)
let text
let images
if (typeof helpers.prepareCampaignContent === ''function'') {
  const prepared = await helpers.prepareCampaignContent({ kind: ''comment'', rewriteCode: __aiRewriteUsingCode })
  text = prepared.content.replace(/\t/g, ''      '')
  images = prepared.media.slice(0, 1)
  vars.contentVariantIndex = prepared.variantIndex
} else {
text = String(input.text || item.text || '''')
text = await renderCommentTemplate(text)
text = await rewriteCommentForRun(text)
text = text.replace(/\t/g, ''      '')
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
images = rawImages.map(x => String(x || '''').trim()).filter(Boolean).slice(0, 1)
}

if (!text && images.length === 0) return { commented: false, position: pos, text: '''', imageCount: 0 }

let imageCount = 0

try {
  // FB comment box dùng Lexical -> page.fill dispatch paste như akaBizAuto DispatchPaste.
  // Pattern: click -> sleep 2s -> paste/drop -> Enter.
  const boxXpath = await helpers.elementWith(''fb_comment_box_at_n'', { n: pos })
  await page.waitForSelector(boxXpath, { timeout: 8000 })
  await page.click(boxXpath)
  await helpers.sleep(2000, signal)
  const inputXpath = await helpers.element(''fb_comment_dialog_textbox'')
  await page.waitForSelector(inputXpath, { timeout: 8000 })

  if (text) {
    await page.fill(inputXpath, text)
    await helpers.sleep(1000, signal)
    // Append a real space after paste so the final word no longer ends at the caret.
    await page.type(inputXpath, '' '')
    await helpers.sleep(500, signal)
  }

  if (images.length > 0) {
    const dropResult = await page.dropFile(inputXpath, images)
    imageCount = Number(dropResult.fileCount || 0)
    await helpers.sleep(10000, signal)
    if (!text && imageCount <= 0) {
      return { commented: false, position: pos, text: '''', imageCount: 0 }
    }
  }

  await page.press(''Enter'')
  await helpers.sleep(10000, signal)
  await throwIfCommentFrequencyLimited()
  const commentUrl = await getFirstCommentUrl()
  const logSuffix = text ? '': '' + text.substring(0, 50) : ''''
  helpers.log(''💬 Đã comment vào bài #'' + pos + logSuffix)
  return { commented: true, commentUrl, position: pos, text: text, imageCount: imageCount, rewrittenContent: shouldRewriteCommentContentEachRun }
} catch (e) {
  const message = e && e.message ? String(e.message) : String(e)
  if (message.includes(commentFrequencyLimitMessage)) throw e
  try {
    await page.press(''Escape'')
    await helpers.sleep(500, signal)
  } catch {}
  helpers.log(''⚠️ Không comment được bài #'' + pos + '': '' + message)
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
',output_schema='[{"label":"Đã comment chưa","name":"commented","type":"boolean"},{"label":"Comment lỗi","name":"commentFailed","type":"boolean"},{"label":"Vị trí đã comment","name":"position","type":"number"},{"label":"Nội dung đã comment","name":"text","type":"string"},{"label":"Số ảnh đã gửi","name":"imageCount","type":"number"},{"label":"Lỗi comment","name":"error","type":"string"},{"name":"commentUrl","type":"string","label":"Link comment"}]'::jsonb,updated_at=clock_timestamp() WHERE id=34;
UPDATE public.auto_blocks SET code='// Read only after comment submit/settle and the existing frequency-limit check.
// Missing links do not retry the comment or change its successful result.
async function getFirstCommentUrl() {
  try {
    const selector = await helpers.element(''fb_comment_permalink'')
    return await page.evaluate(`
      const link = document.evaluate(__args[0], document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
      return link ? String(link.href || link.getAttribute(''href'') || '''').trim() : '''';
    `, selector)
  } catch (error) {
    if (signal.aborted) throw error
    return ''''
  }
}

// Centralized AI rewrite via ai_using.
const __aiRewriteUsingCode = "fb_comment_current_post_rewrite";
const __extractAIText = (value) => {
  if (value === null || value === undefined) return '''';
  if (typeof value === ''string'') return value.trim();
  if (typeof value === ''number'' || typeof value === ''boolean'') return String(value).trim();
  if (Array.isArray(value)) return value.map(__extractAIText).filter(Boolean).join(''\n'').trim();
  if (typeof value === ''object'') {
    const data = value;
    const direct = data.content ?? data.data ?? data.Data ?? data.text ?? data.output ?? data.response ?? data.message ?? data.Message ?? data.answer ?? data.result;
    if (direct !== undefined && direct !== null && direct !== value) {
      const directText = __extractAIText(direct);
      if (directText) return directText;
    }
    try { return JSON.stringify(value); } catch { return String(value); }
  }
  return String(value || '''').trim();
};
const __callCentralAI = async (usingCode, payload) => {
  if (!usingCode) throw new Error(''Thiếu mã cấu hình AI'');
  if (typeof helpers.callAIUsing !== ''function'') throw new Error(''Runtime chưa hỗ trợ helper callAIUsing'');
  const result = await helpers.callAIUsing(usingCode, payload || {});
  if (result && result.unsupported) throw new Error(''Runtime chưa hỗ trợ helper callAIUsing'');
  if (!result || result.ok !== true) throw new Error(String(result && result.error ? result.error : ''AI lỗi''));
  return result;
};
const __callAIText = async (usingCode, payload) => {
  const result = await __callCentralAI(usingCode, payload);
  return __extractAIText(result && (result.content ?? result.data ?? result.text ?? result.output ?? result.response ?? result.rawResponse ?? result));
};
const __callAIRewriteContent = async (content) => {
  const text = String(content || '''');
  return await __callAIText(__aiRewriteUsingCode, {
    content: text,
    question: text,
    source: ''aka_agent''
  });
};

const commentFrequencyLimitMessage = ''Facebook báo giới hạn tần suất comment''
const shouldRewriteCommentContentEachRun = vars.rewriteCommentContentEachRun === true

async function hasVisibleElement(selector) {
  return await page.evaluate(`
    const selector = __args[0];

    function isVisible(el) {
      if (!el) return false;
      const style = window.getComputedStyle(el);
      if (style.display === ''none'' || style.visibility === ''hidden'' || style.opacity === ''0'') return false;
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
  const frequencyLimitError = await helpers.element(''GroupPostFrequencyLimitError'');
  const hasFrequencyLimitError = await hasVisibleElement(frequencyLimitError);
  if (hasFrequencyLimitError) {
    helpers.log(commentFrequencyLimitMessage);
    throw new Error(commentFrequencyLimitMessage);
  }
}

const formatTemplateDate = (dayKey, formatKey) => {
  const d = new Date()
  const key = String(dayKey || ''TODAY'').toUpperCase()
  if (key === ''TOMORROW'') d.setDate(d.getDate() + 1)
  if (key === ''YESTERDAY'') d.setDate(d.getDate() - 1)

  const dd = String(d.getDate()).padStart(2, ''0'')
  const mm = String(d.getMonth() + 1).padStart(2, ''0'')
  const yyyy = String(d.getFullYear())
  const format = String(formatKey || ''DD/MM/YYYY'').toUpperCase()
  return format === ''MM/DD/YYYY''
    ? mm + ''/'' + dd + ''/'' + yyyy
    : dd + ''/'' + mm + ''/'' + yyyy
}

const renderCommentTemplate = async (raw) => {
  let rendered = String(raw || '''')

  if (/#\{\s*FULL_NAME\s*\}/i.test(rendered)) {
    const fullName = String(vars.campaignInputDataName || vars.inputDataName || '''').trim()
    rendered = rendered.replace(/#\{\s*FULL_NAME\s*\}/gi, fullName)
  }

  rendered = rendered.replace(
    /#\{\s*(TODAY|TOMORROW|YESTERDAY)\s*(?:\(\s*(DD\/MM\/YYYY|MM\/DD\/YYYY)\s*\))?\s*\}/gi,
    (_match, dayKey, formatKey) => formatTemplateDate(dayKey, formatKey)
  )

  return rendered
}

const rewriteCommentForRun = async (raw) => {
  const original = String(raw || '''')
  const content = original.trim()
  if (!shouldRewriteCommentContentEachRun || !content) return original

  try {
    const rewritten = await __callAIRewriteContent(content)
    if (!rewritten) throw new Error(''AI trả về nội dung không hợp lệ.'')
    helpers.log(''Đã viết lại nội dung comment bằng AI'')
    return rewritten
  } catch (e) {
    const message = e && e.message ? String(e.message) : String(e)
    helpers.log(''AI viết lại nội dung comment lỗi, dùng nội dung gốc: '' + message)
    return original
  }
}

const item = (vars && vars.loopItem) ? vars.loopItem : {}
let text
let images
if (typeof helpers.prepareCampaignContent === ''function'') {
  const prepared = await helpers.prepareCampaignContent({ kind: ''comment'', rewriteCode: __aiRewriteUsingCode })
  text = prepared.content.replace(/\t/g, ''      '')
  images = prepared.media.slice(0, 1)
  vars.contentVariantIndex = prepared.variantIndex
} else {
text = String(input.text || item.text || '''')
text = await renderCommentTemplate(text)
text = await rewriteCommentForRun(text)
text = text.replace(/\t/g, ''      '')
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
images = rawImages.map(x => String(x || '''').trim()).filter(Boolean).slice(0, 1)
}

if (!text && images.length === 0) return { commented: false, position: 1, text: '''', imageCount: 0 }

const inputXpath = await helpers.element(''fb_comment_dialog_textbox'')
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
    return { commented: false, position: 1, text: '''', imageCount: 0 }
  }
}

await page.click(inputXpath)
await helpers.sleep(500, signal)
await page.press(''Enter'')
await helpers.sleep(10000, signal)
await throwIfCommentFrequencyLimited()
const commentUrl = await getFirstCommentUrl()

const logSuffix = text ? '': '' + text.substring(0, 50) : ''''
helpers.log(''💬 Đã comment vào bài post'' + logSuffix)
return { commented: true, commentUrl, position: 1, text: text, imageCount: imageCount, rewrittenContent: shouldRewriteCommentContentEachRun }
',output_schema='[{"label":"Đã comment chưa","name":"commented","type":"boolean"},{"label":"Vị trí đã comment","name":"position","type":"number"},{"label":"Nội dung đã comment","name":"text","type":"string"},{"label":"Số ảnh đã gửi","name":"imageCount","type":"number"},{"name":"commentUrl","type":"string","label":"Link comment"}]'::jsonb,updated_at=clock_timestamp() WHERE id=2616;
UPDATE public.auto_blocks SET code='// Read only after comment submit/settle and the existing frequency-limit check.
// Missing links do not retry the comment or change its successful result.
async function getFirstCommentUrl() {
  try {
    const selector = await helpers.element(''fb_comment_permalink'')
    return await page.evaluate(`
      const link = document.evaluate(__args[0], document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
      return link ? String(link.href || link.getAttribute(''href'') || '''').trim() : '''';
    `, selector)
  } catch (error) {
    if (signal.aborted) throw error
    return ''''
  }
}

const state = vars.newsfeedState || {}
const post = state.currentPost || {}
const text = String(input.text || state.commentText || '''')
if (input.pasted !== true || state.remainingComment <= 0) return { commented: false, text }
const commentFrequencyLimitMessage = ''Facebook báo giới hạn tần suất comment''

async function hasVisibleElement(selector) {
  return await page.evaluate(`
    const selector = __args[0];

    function isVisible(el) {
      if (!el) return false;
      const style = window.getComputedStyle(el);
      if (style.display === ''none'' || style.visibility === ''hidden'' || style.opacity === ''0'') return false;
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
  const frequencyLimitError = await helpers.element(''GroupPostFrequencyLimitError'');
  const hasFrequencyLimitError = await hasVisibleElement(frequencyLimitError);
  if (hasFrequencyLimitError) {
    helpers.log(commentFrequencyLimitMessage);
    throw new Error(commentFrequencyLimitMessage);
  }
}

const inputSelector = ''[data-aka-newsfeed-comment-input="1"]''
try {
  await page.waitForSelector(inputSelector, { timeout: 8000 })
  await page.click(inputSelector)
  await helpers.sleep(500, signal)
  await page.press(''Enter'')
  await helpers.sleep(10000, signal)
  await throwIfCommentFrequencyLimited()
} catch (e) {
  const skipReason = e && e.message ? e.message : String(e)
  if (skipReason.includes(commentFrequencyLimitMessage)) throw e
  helpers.log(''Bỏ qua submit comment newsfeed: '' + skipReason)
  return { commented: false, text, skipReason }
}
const commentUrl = await getFirstCommentUrl()
state.remainingComment = Math.max(0, Number(state.remainingComment || 0) - 1)
state.commentDone = Number(state.commentDone || 0) + 1
helpers.log(''Đã comment bài newsfeed của '' + (post.targetName || ''người đăng''))
return {
  commented: true,
  commentUrl,
  text,
  targetName: post.targetName || '''',
  targetUid: post.targetUid || '''',
  postContent: post.postContent || ''''
}
',output_schema='[{"label":"Đã comment","name":"commented","type":"boolean"},{"label":"Nội dung","name":"text","type":"string"},{"name":"commentUrl","type":"string","label":"Link comment"}]'::jsonb,updated_at=clock_timestamp() WHERE id=2710;
IF (SELECT to_jsonb(t)-'id'-'created_at'-'updated_at' FROM public.auto_elements t WHERE name='fb_comment_permalink') IS DISTINCT FROM '{"category":"facebook","description":"Link bình luận trong dialog bài viết; sau khi gửi comment lấy href đầu tiên theo thứ tự DOM.","is_builtin":true,"name":"fb_comment_permalink","organization_id":null,"staff_id":null,"xpath":"(//*[@role=''dialog'' and not(@aria-label=''Thông báo'') and not(@aria-label=''Messenger'')])[1]//*[@role=''article'' and .//*[@class=''xt0psk2'']]//a[contains(@href,''comment_id='') or contains(@href,''reply_comment_id='')]"}'::jsonb THEN RAISE EXCEPTION 'v380 element postflight'; END IF;
IF (SELECT to_jsonb(t)-'updated_at' FROM public.auto_blocks t WHERE id=34) IS DISTINCT FROM ('{"category":"facebook","code":"// Read only after comment submit/settle and the existing frequency-limit check.\n// Missing links do not retry the comment or change its successful result.\nasync function getFirstCommentUrl() {\n  try {\n    const selector = await helpers.element(''fb_comment_permalink'')\n    return await page.evaluate(`\n      const link = document.evaluate(__args[0], document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;\n      return link ? String(link.href || link.getAttribute(''href'') || '''').trim() : '''';\n    `, selector)\n  } catch (error) {\n    if (signal.aborted) throw error\n    return ''''\n  }\n}\n\n// Centralized AI rewrite via ai_using.\nconst __aiRewriteUsingCode = \"fb_comment_at_position_rewrite\";\nconst __extractAIText = (value) => {\n  if (value === null || value === undefined) return '''';\n  if (typeof value === ''string'') return value.trim();\n  if (typeof value === ''number'' || typeof value === ''boolean'') return String(value).trim();\n  if (Array.isArray(value)) return value.map(__extractAIText).filter(Boolean).join(''\\n'').trim();\n  if (typeof value === ''object'') {\n    const data = value;\n    const direct = data.content ?? data.data ?? data.Data ?? data.text ?? data.output ?? data.response ?? data.message ?? data.Message ?? data.answer ?? data.result;\n    if (direct !== undefined && direct !== null && direct !== value) {\n      const directText = __extractAIText(direct);\n      if (directText) return directText;\n    }\n    try { return JSON.stringify(value); } catch { return String(value); }\n  }\n  return String(value || '''').trim();\n};\nconst __callCentralAI = async (usingCode, payload) => {\n  if (!usingCode) throw new Error(''Thiếu mã cấu hình AI'');\n  if (typeof helpers.callAIUsing !== ''function'') throw new Error(''Runtime chưa hỗ trợ helper callAIUsing'');\n  const result = await helpers.callAIUsing(usingCode, payload || {});\n  if (result && result.unsupported) throw new Error(''Runtime chưa hỗ trợ helper callAIUsing'');\n  if (!result || result.ok !== true) throw new Error(String(result && result.error ? result.error : ''AI lỗi''));\n  return result;\n};\nconst __callAIText = async (usingCode, payload) => {\n  const result = await __callCentralAI(usingCode, payload);\n  return __extractAIText(result && (result.content ?? result.data ?? result.text ?? result.output ?? result.response ?? result.rawResponse ?? result));\n};\nconst __callAIRewriteContent = async (content) => {\n  const text = String(content || '''');\n  return await __callAIText(__aiRewriteUsingCode, {\n    content: text,\n    question: text,\n    source: ''aka_agent''\n  });\n};\n\nconst commentFrequencyLimitMessage = ''Facebook báo giới hạn tần suất comment''\nconst shouldRewriteCommentContentEachRun = vars.rewriteCommentContentEachRun === true\n\nasync function hasVisibleElement(selector) {\n  return await page.evaluate(`\n    const selector = __args[0];\n\n    function isVisible(el) {\n      if (!el) return false;\n      const style = window.getComputedStyle(el);\n      if (style.display === ''none'' || style.visibility === ''hidden'' || style.opacity === ''0'') return false;\n      const rect = el.getBoundingClientRect();\n      return rect.width > 0 && rect.height > 0;\n    }\n\n    function xpathAll(xpath) {\n      const out = [];\n      if (!xpath) return out;\n      try {\n        const result = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);\n        for (let i = 0; i < result.snapshotLength; i++) {\n          const item = result.snapshotItem(i);\n          if (item) out.push(item);\n        }\n      } catch {}\n      return out;\n    }\n\n    return xpathAll(selector).some(isVisible);\n  `, selector);\n}\n\nasync function throwIfCommentFrequencyLimited() {\n  const frequencyLimitError = await helpers.element(''GroupPostFrequencyLimitError'');\n  const hasFrequencyLimitError = await hasVisibleElement(frequencyLimitError);\n  if (hasFrequencyLimitError) {\n    helpers.log(commentFrequencyLimitMessage);\n    throw new Error(commentFrequencyLimitMessage);\n  }\n}\n\nconst formatTemplateDate = (dayKey, formatKey) => {\n  const d = new Date()\n  const key = String(dayKey || ''TODAY'').toUpperCase()\n  if (key === ''TOMORROW'') d.setDate(d.getDate() + 1)\n  if (key === ''YESTERDAY'') d.setDate(d.getDate() - 1)\n\n  const dd = String(d.getDate()).padStart(2, ''0'')\n  const mm = String(d.getMonth() + 1).padStart(2, ''0'')\n  const yyyy = String(d.getFullYear())\n  const format = String(formatKey || ''DD/MM/YYYY'').toUpperCase()\n  return format === ''MM/DD/YYYY''\n    ? mm + ''/'' + dd + ''/'' + yyyy\n    : dd + ''/'' + mm + ''/'' + yyyy\n}\n\nconst renderCommentTemplate = async (raw) => {\n  let rendered = String(raw || '''')\n\n  if (/#\\{\\s*FULL_NAME\\s*\\}/i.test(rendered)) {\n    const fullName = String(vars.campaignInputDataName || vars.inputDataName || '''').trim()\n    rendered = rendered.replace(/#\\{\\s*FULL_NAME\\s*\\}/gi, fullName)\n  }\n\n  rendered = rendered.replace(\n    /#\\{\\s*(TODAY|TOMORROW|YESTERDAY)\\s*(?:\\(\\s*(DD\\/MM\\/YYYY|MM\\/DD\\/YYYY)\\s*\\))?\\s*\\}/gi,\n    (_match, dayKey, formatKey) => formatTemplateDate(dayKey, formatKey)\n  )\n\n  return rendered\n}\n\nconst rewriteCommentForRun = async (raw) => {\n  const original = String(raw || '''')\n  const content = original.trim()\n  if (!shouldRewriteCommentContentEachRun || !content) return original\n\n  try {\n    const rewritten = await __callAIRewriteContent(content)\n    if (!rewritten) throw new Error(''AI trả về nội dung không hợp lệ.'')\n    helpers.log(''Đã viết lại nội dung comment bằng AI'')\n    return rewritten\n  } catch (e) {\n    const message = e && e.message ? String(e.message) : String(e)\n    helpers.log(''AI viết lại nội dung comment lỗi, dùng nội dung gốc: '' + message)\n    return original\n  }\n}\n\nconst item = (vars && vars.loopItem) ? vars.loopItem : {}\nconst pos = Number(input.position || item.position || 1)\nlet text\nlet images\nif (typeof helpers.prepareCampaignContent === ''function'') {\n  const prepared = await helpers.prepareCampaignContent({ kind: ''comment'', rewriteCode: __aiRewriteUsingCode })\n  text = prepared.content.replace(/\\t/g, ''      '')\n  images = prepared.media.slice(0, 1)\n  vars.contentVariantIndex = prepared.variantIndex\n} else {\ntext = String(input.text || item.text || '''')\ntext = await renderCommentTemplate(text)\ntext = await rewriteCommentForRun(text)\ntext = text.replace(/\\t/g, ''      '')\nconst batchIndex = Number(vars && vars.loopIndex)\nconst batchImages = Array.isArray(vars && vars.commentImageBatches) && Array.isArray(vars.commentImageBatches[batchIndex])\n  ? vars.commentImageBatches[batchIndex]\n  : []\nconst fallbackImages = Array.isArray(vars && vars.commentImages) ? vars.commentImages : []\nconst rawImages = Array.isArray(input.images) && input.images.length > 0\n  ? input.images\n  : (Array.isArray(item.images) && item.images.length > 0\n      ? item.images\n      : (batchImages.length > 0 ? batchImages : fallbackImages))\nimages = rawImages.map(x => String(x || '''').trim()).filter(Boolean).slice(0, 1)\n}\n\nif (!text && images.length === 0) return { commented: false, position: pos, text: '''', imageCount: 0 }\n\nlet imageCount = 0\n\ntry {\n  // FB comment box dùng Lexical -> page.fill dispatch paste như akaBizAuto DispatchPaste.\n  // Pattern: click -> sleep 2s -> paste/drop -> Enter.\n  const boxXpath = await helpers.elementWith(''fb_comment_box_at_n'', { n: pos })\n  await page.waitForSelector(boxXpath, { timeout: 8000 })\n  await page.click(boxXpath)\n  await helpers.sleep(2000, signal)\n  const inputXpath = await helpers.element(''fb_comment_dialog_textbox'')\n  await page.waitForSelector(inputXpath, { timeout: 8000 })\n\n  if (text) {\n    await page.fill(inputXpath, text)\n    await helpers.sleep(1000, signal)\n    // Append a real space after paste so the final word no longer ends at the caret.\n    await page.type(inputXpath, '' '')\n    await helpers.sleep(500, signal)\n  }\n\n  if (images.length > 0) {\n    const dropResult = await page.dropFile(inputXpath, images)\n    imageCount = Number(dropResult.fileCount || 0)\n    await helpers.sleep(10000, signal)\n    if (!text && imageCount <= 0) {\n      return { commented: false, position: pos, text: '''', imageCount: 0 }\n    }\n  }\n\n  await page.press(''Enter'')\n  await helpers.sleep(10000, signal)\n  await throwIfCommentFrequencyLimited()\n  const commentUrl = await getFirstCommentUrl()\n  const logSuffix = text ? '': '' + text.substring(0, 50) : ''''\n  helpers.log(''💬 Đã comment vào bài #'' + pos + logSuffix)\n  return { commented: true, commentUrl, position: pos, text: text, imageCount: imageCount, rewrittenContent: shouldRewriteCommentContentEachRun }\n} catch (e) {\n  const message = e && e.message ? String(e.message) : String(e)\n  if (message.includes(commentFrequencyLimitMessage)) throw e\n  try {\n    await page.press(''Escape'')\n    await helpers.sleep(500, signal)\n  } catch {}\n  helpers.log(''⚠️ Không comment được bài #'' + pos + '': '' + message)\n  return {\n    commented: false,\n    commentFailed: true,\n    position: pos,\n    text: text,\n    imageCount: imageCount,\n    error: message,\n    rewrittenContent: shouldRewriteCommentContentEachRun\n  }\n}\n","config_schema":[{"label":"Vị trí (1-based, để rỗng = lấy từ loopItem)","name":"position","type":"number"},{"label":"Nội dung comment (để rỗng = lấy từ loopItem)","name":"text","type":"textarea"},{"label":"Ảnh comment (array path, chỉ dùng ảnh đầu tiên; để rỗng = lấy từ loopItem/vars)","name":"images","type":"json"}],"created_at":"2026-04-26T17:29:28.017367+00:00","default_config":{},"description":"Comment vào bài thứ N, hỗ trợ nội dung và 1 ảnh comment (fallback vars.loopItem khi chạy trong loop)","icon":"MessageCircle","id":34,"is_builtin":true,"kind":"js","name":"fb_comment_at_position","organization_id":1,"output_schema":[{"label":"Đã comment chưa","name":"commented","type":"boolean"},{"label":"Comment lỗi","name":"commentFailed","type":"boolean"},{"label":"Vị trí đã comment","name":"position","type":"number"},{"label":"Nội dung đã comment","name":"text","type":"string"},{"label":"Số ảnh đã gửi","name":"imageCount","type":"number"},{"label":"Lỗi comment","name":"error","type":"string"},{"name":"commentUrl","type":"string","label":"Link comment"}],"staff_id":1,"system_type":null,"updated_at":"2026-10-06T10:14:35.142327+00:00"}'::jsonb-'updated_at') THEN RAISE EXCEPTION 'v380 block/34 postflight'; END IF;
IF (SELECT to_jsonb(t)-'updated_at' FROM public.auto_blocks t WHERE id=2616) IS DISTINCT FROM ('{"category":"facebook","code":"// Read only after comment submit/settle and the existing frequency-limit check.\n// Missing links do not retry the comment or change its successful result.\nasync function getFirstCommentUrl() {\n  try {\n    const selector = await helpers.element(''fb_comment_permalink'')\n    return await page.evaluate(`\n      const link = document.evaluate(__args[0], document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;\n      return link ? String(link.href || link.getAttribute(''href'') || '''').trim() : '''';\n    `, selector)\n  } catch (error) {\n    if (signal.aborted) throw error\n    return ''''\n  }\n}\n\n// Centralized AI rewrite via ai_using.\nconst __aiRewriteUsingCode = \"fb_comment_current_post_rewrite\";\nconst __extractAIText = (value) => {\n  if (value === null || value === undefined) return '''';\n  if (typeof value === ''string'') return value.trim();\n  if (typeof value === ''number'' || typeof value === ''boolean'') return String(value).trim();\n  if (Array.isArray(value)) return value.map(__extractAIText).filter(Boolean).join(''\\n'').trim();\n  if (typeof value === ''object'') {\n    const data = value;\n    const direct = data.content ?? data.data ?? data.Data ?? data.text ?? data.output ?? data.response ?? data.message ?? data.Message ?? data.answer ?? data.result;\n    if (direct !== undefined && direct !== null && direct !== value) {\n      const directText = __extractAIText(direct);\n      if (directText) return directText;\n    }\n    try { return JSON.stringify(value); } catch { return String(value); }\n  }\n  return String(value || '''').trim();\n};\nconst __callCentralAI = async (usingCode, payload) => {\n  if (!usingCode) throw new Error(''Thiếu mã cấu hình AI'');\n  if (typeof helpers.callAIUsing !== ''function'') throw new Error(''Runtime chưa hỗ trợ helper callAIUsing'');\n  const result = await helpers.callAIUsing(usingCode, payload || {});\n  if (result && result.unsupported) throw new Error(''Runtime chưa hỗ trợ helper callAIUsing'');\n  if (!result || result.ok !== true) throw new Error(String(result && result.error ? result.error : ''AI lỗi''));\n  return result;\n};\nconst __callAIText = async (usingCode, payload) => {\n  const result = await __callCentralAI(usingCode, payload);\n  return __extractAIText(result && (result.content ?? result.data ?? result.text ?? result.output ?? result.response ?? result.rawResponse ?? result));\n};\nconst __callAIRewriteContent = async (content) => {\n  const text = String(content || '''');\n  return await __callAIText(__aiRewriteUsingCode, {\n    content: text,\n    question: text,\n    source: ''aka_agent''\n  });\n};\n\nconst commentFrequencyLimitMessage = ''Facebook báo giới hạn tần suất comment''\nconst shouldRewriteCommentContentEachRun = vars.rewriteCommentContentEachRun === true\n\nasync function hasVisibleElement(selector) {\n  return await page.evaluate(`\n    const selector = __args[0];\n\n    function isVisible(el) {\n      if (!el) return false;\n      const style = window.getComputedStyle(el);\n      if (style.display === ''none'' || style.visibility === ''hidden'' || style.opacity === ''0'') return false;\n      const rect = el.getBoundingClientRect();\n      return rect.width > 0 && rect.height > 0;\n    }\n\n    function xpathAll(xpath) {\n      const out = [];\n      if (!xpath) return out;\n      try {\n        const result = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);\n        for (let i = 0; i < result.snapshotLength; i++) {\n          const item = result.snapshotItem(i);\n          if (item) out.push(item);\n        }\n      } catch {}\n      return out;\n    }\n\n    return xpathAll(selector).some(isVisible);\n  `, selector);\n}\n\nasync function throwIfCommentFrequencyLimited() {\n  const frequencyLimitError = await helpers.element(''GroupPostFrequencyLimitError'');\n  const hasFrequencyLimitError = await hasVisibleElement(frequencyLimitError);\n  if (hasFrequencyLimitError) {\n    helpers.log(commentFrequencyLimitMessage);\n    throw new Error(commentFrequencyLimitMessage);\n  }\n}\n\nconst formatTemplateDate = (dayKey, formatKey) => {\n  const d = new Date()\n  const key = String(dayKey || ''TODAY'').toUpperCase()\n  if (key === ''TOMORROW'') d.setDate(d.getDate() + 1)\n  if (key === ''YESTERDAY'') d.setDate(d.getDate() - 1)\n\n  const dd = String(d.getDate()).padStart(2, ''0'')\n  const mm = String(d.getMonth() + 1).padStart(2, ''0'')\n  const yyyy = String(d.getFullYear())\n  const format = String(formatKey || ''DD/MM/YYYY'').toUpperCase()\n  return format === ''MM/DD/YYYY''\n    ? mm + ''/'' + dd + ''/'' + yyyy\n    : dd + ''/'' + mm + ''/'' + yyyy\n}\n\nconst renderCommentTemplate = async (raw) => {\n  let rendered = String(raw || '''')\n\n  if (/#\\{\\s*FULL_NAME\\s*\\}/i.test(rendered)) {\n    const fullName = String(vars.campaignInputDataName || vars.inputDataName || '''').trim()\n    rendered = rendered.replace(/#\\{\\s*FULL_NAME\\s*\\}/gi, fullName)\n  }\n\n  rendered = rendered.replace(\n    /#\\{\\s*(TODAY|TOMORROW|YESTERDAY)\\s*(?:\\(\\s*(DD\\/MM\\/YYYY|MM\\/DD\\/YYYY)\\s*\\))?\\s*\\}/gi,\n    (_match, dayKey, formatKey) => formatTemplateDate(dayKey, formatKey)\n  )\n\n  return rendered\n}\n\nconst rewriteCommentForRun = async (raw) => {\n  const original = String(raw || '''')\n  const content = original.trim()\n  if (!shouldRewriteCommentContentEachRun || !content) return original\n\n  try {\n    const rewritten = await __callAIRewriteContent(content)\n    if (!rewritten) throw new Error(''AI trả về nội dung không hợp lệ.'')\n    helpers.log(''Đã viết lại nội dung comment bằng AI'')\n    return rewritten\n  } catch (e) {\n    const message = e && e.message ? String(e.message) : String(e)\n    helpers.log(''AI viết lại nội dung comment lỗi, dùng nội dung gốc: '' + message)\n    return original\n  }\n}\n\nconst item = (vars && vars.loopItem) ? vars.loopItem : {}\nlet text\nlet images\nif (typeof helpers.prepareCampaignContent === ''function'') {\n  const prepared = await helpers.prepareCampaignContent({ kind: ''comment'', rewriteCode: __aiRewriteUsingCode })\n  text = prepared.content.replace(/\\t/g, ''      '')\n  images = prepared.media.slice(0, 1)\n  vars.contentVariantIndex = prepared.variantIndex\n} else {\ntext = String(input.text || item.text || '''')\ntext = await renderCommentTemplate(text)\ntext = await rewriteCommentForRun(text)\ntext = text.replace(/\\t/g, ''      '')\nconst batchIndex = Number(vars && vars.loopIndex)\nconst batchImages = Array.isArray(vars && vars.commentImageBatches) && Array.isArray(vars.commentImageBatches[batchIndex])\n  ? vars.commentImageBatches[batchIndex]\n  : []\nconst fallbackImages = Array.isArray(vars && vars.commentImages) ? vars.commentImages : []\nconst rawImages = Array.isArray(input.images) && input.images.length > 0\n  ? input.images\n  : (Array.isArray(item.images) && item.images.length > 0\n      ? item.images\n      : (batchImages.length > 0 ? batchImages : fallbackImages))\nimages = rawImages.map(x => String(x || '''').trim()).filter(Boolean).slice(0, 1)\n}\n\nif (!text && images.length === 0) return { commented: false, position: 1, text: '''', imageCount: 0 }\n\nconst inputXpath = await helpers.element(''fb_comment_dialog_textbox'')\nawait page.waitForSelector(inputXpath, { timeout: 8000 })\nawait page.click(inputXpath)\nawait helpers.sleep(1000, signal)\n\nif (text) {\n  await page.fill(inputXpath, text)\n  await helpers.sleep(1000, signal)\n}\n\nlet imageCount = 0\nif (images.length > 0) {\n  const dropResult = await page.dropFile(inputXpath, images)\n  imageCount = Number(dropResult.fileCount || 0)\n  await helpers.sleep(10000, signal)\n  if (!text && imageCount <= 0) {\n    return { commented: false, position: 1, text: '''', imageCount: 0 }\n  }\n}\n\nawait page.click(inputXpath)\nawait helpers.sleep(500, signal)\nawait page.press(''Enter'')\nawait helpers.sleep(10000, signal)\nawait throwIfCommentFrequencyLimited()\nconst commentUrl = await getFirstCommentUrl()\n\nconst logSuffix = text ? '': '' + text.substring(0, 50) : ''''\nhelpers.log(''💬 Đã comment vào bài post'' + logSuffix)\nreturn { commented: true, commentUrl, position: 1, text: text, imageCount: imageCount, rewrittenContent: shouldRewriteCommentContentEachRun }\n","config_schema":[{"label":"Nội dung comment (để rỗng = lấy từ loopItem)","name":"text","type":"textarea"},{"label":"Ảnh comment (array path, chỉ dùng ảnh đầu tiên; để rỗng = lấy từ loopItem/vars)","name":"images","type":"json"}],"created_at":"2026-05-15T07:53:19.812231+00:00","default_config":{},"description":"Comment vào bài post hiện tại trong trang permalink, hỗ trợ nội dung và 1 ảnh.","icon":"MessageCircle","id":2616,"is_builtin":true,"kind":"js","name":"fb_comment_current_post","organization_id":1,"output_schema":[{"label":"Đã comment chưa","name":"commented","type":"boolean"},{"label":"Vị trí đã comment","name":"position","type":"number"},{"label":"Nội dung đã comment","name":"text","type":"string"},{"label":"Số ảnh đã gửi","name":"imageCount","type":"number"},{"name":"commentUrl","type":"string","label":"Link comment"}],"staff_id":1,"system_type":null,"updated_at":"2026-10-06T10:14:35.142327+00:00"}'::jsonb-'updated_at') THEN RAISE EXCEPTION 'v380 block/2616 postflight'; END IF;
IF (SELECT to_jsonb(t)-'updated_at' FROM public.auto_blocks t WHERE id=2710) IS DISTINCT FROM ('{"category":"facebook","code":"// Read only after comment submit/settle and the existing frequency-limit check.\n// Missing links do not retry the comment or change its successful result.\nasync function getFirstCommentUrl() {\n  try {\n    const selector = await helpers.element(''fb_comment_permalink'')\n    return await page.evaluate(`\n      const link = document.evaluate(__args[0], document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;\n      return link ? String(link.href || link.getAttribute(''href'') || '''').trim() : '''';\n    `, selector)\n  } catch (error) {\n    if (signal.aborted) throw error\n    return ''''\n  }\n}\n\nconst state = vars.newsfeedState || {}\nconst post = state.currentPost || {}\nconst text = String(input.text || state.commentText || '''')\nif (input.pasted !== true || state.remainingComment <= 0) return { commented: false, text }\nconst commentFrequencyLimitMessage = ''Facebook báo giới hạn tần suất comment''\n\nasync function hasVisibleElement(selector) {\n  return await page.evaluate(`\n    const selector = __args[0];\n\n    function isVisible(el) {\n      if (!el) return false;\n      const style = window.getComputedStyle(el);\n      if (style.display === ''none'' || style.visibility === ''hidden'' || style.opacity === ''0'') return false;\n      const rect = el.getBoundingClientRect();\n      return rect.width > 0 && rect.height > 0;\n    }\n\n    function xpathAll(xpath) {\n      const out = [];\n      if (!xpath) return out;\n      try {\n        const result = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);\n        for (let i = 0; i < result.snapshotLength; i++) {\n          const item = result.snapshotItem(i);\n          if (item) out.push(item);\n        }\n      } catch {}\n      return out;\n    }\n\n    return xpathAll(selector).some(isVisible);\n  `, selector);\n}\n\nasync function throwIfCommentFrequencyLimited() {\n  const frequencyLimitError = await helpers.element(''GroupPostFrequencyLimitError'');\n  const hasFrequencyLimitError = await hasVisibleElement(frequencyLimitError);\n  if (hasFrequencyLimitError) {\n    helpers.log(commentFrequencyLimitMessage);\n    throw new Error(commentFrequencyLimitMessage);\n  }\n}\n\nconst inputSelector = ''[data-aka-newsfeed-comment-input=\"1\"]''\ntry {\n  await page.waitForSelector(inputSelector, { timeout: 8000 })\n  await page.click(inputSelector)\n  await helpers.sleep(500, signal)\n  await page.press(''Enter'')\n  await helpers.sleep(10000, signal)\n  await throwIfCommentFrequencyLimited()\n} catch (e) {\n  const skipReason = e && e.message ? e.message : String(e)\n  if (skipReason.includes(commentFrequencyLimitMessage)) throw e\n  helpers.log(''Bỏ qua submit comment newsfeed: '' + skipReason)\n  return { commented: false, text, skipReason }\n}\nconst commentUrl = await getFirstCommentUrl()\nstate.remainingComment = Math.max(0, Number(state.remainingComment || 0) - 1)\nstate.commentDone = Number(state.commentDone || 0) + 1\nhelpers.log(''Đã comment bài newsfeed của '' + (post.targetName || ''người đăng''))\nreturn {\n  commented: true,\n  commentUrl,\n  text,\n  targetName: post.targetName || '''',\n  targetUid: post.targetUid || '''',\n  postContent: post.postContent || ''''\n}\n","config_schema":[],"created_at":"2026-05-28T16:28:42.550407+00:00","default_config":{},"description":"Gửi comment newsfeed bằng Enter giống comment seeding post.","icon":"Send","id":2710,"is_builtin":true,"kind":"js","name":"fb_newsfeed_comment_submit","organization_id":null,"output_schema":[{"label":"Đã comment","name":"commented","type":"boolean"},{"label":"Nội dung","name":"text","type":"string"},{"name":"commentUrl","type":"string","label":"Link comment"}],"staff_id":null,"system_type":null,"updated_at":"2026-07-01T09:07:05.028889+00:00"}'::jsonb-'updated_at') THEN RAISE EXCEPTION 'v380 block/2710 postflight'; END IF;
END $v380$;
COMMIT;
