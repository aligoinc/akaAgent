-- Let feed/group comment loops continue when one post cannot be commented.

BEGIN;

UPDATE public.auto_blocks
SET
  code = $block$
const shouldRewriteCommentContentEachRun = vars.rewriteCommentContentEachRun === true

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
    const response = await page.apiCall({
      url: 'https://api.akaapp.vn/api/AI/rewriteContent',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: {
        content,
        questionContentName: 'rewrite_content',
        source: 'aka_agent'
      },
      timeout: 120000
    })

    if (response.status < 200 || response.status >= 300) {
      throw new Error('AI trả về lỗi ' + response.status)
    }

    const payload = response.data || {}
    const ok = payload.status === 1 || payload.status === '1'
    if (!ok) {
      const message = typeof payload.message === 'string' && payload.message.trim()
        ? payload.message.trim()
        : 'AI không thể xử lý nội dung lúc này.'
      throw new Error(message)
    }
    if (typeof payload.data !== 'string') {
      throw new Error('AI trả về nội dung không hợp lệ.')
    }

    helpers.log('Đã viết lại nội dung comment bằng AI')
    return payload.data
  } catch (e) {
    const message = e && e.message ? String(e.message) : String(e)
    helpers.log('AI viết lại nội dung comment lỗi, dùng nội dung gốc: ' + message)
    return original
  }
}

const item = (vars && vars.loopItem) ? vars.loopItem : {}
const pos = Number(input.position || item.position || 1)
let text = String(input.text || item.text || '')
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
const images = rawImages.map(x => String(x || '').trim()).filter(Boolean).slice(0, 1)

if (!text && images.length === 0) return { commented: false, position: pos, text: '', imageCount: 0 }

let imageCount = 0

try {
  // FB comment box dùng Lexical -> page.fill dispatch paste như akaBizAuto DispatchPaste.
  // Pattern: click -> sleep 2s -> paste/drop -> Enter.
  const boxXpath = await helpers.elementWith('fb_comment_box_at_n', { n: pos })
  await page.waitForSelector(boxXpath, { timeout: 8000 })
  await page.click(boxXpath)
  await helpers.sleep(2000, signal)
  const inputXpath = await helpers.element('fb_comment_dialog_textbox')
  await page.waitForSelector(inputXpath, { timeout: 8000 })

  if (text) {
    await page.fill(inputXpath, text)
    await helpers.sleep(1000, signal)
  }

  if (images.length > 0) {
    const dropResult = await page.dropFile(inputXpath, images)
    imageCount = Number(dropResult.fileCount || 0)
    await helpers.sleep(3000, signal)
    if (!text && imageCount <= 0) {
      return { commented: false, position: pos, text: '', imageCount: 0 }
    }
  }

  await page.press('Enter')
  await helpers.sleep(10000, signal)
  const logSuffix = text ? ': ' + text.substring(0, 50) : ''
  helpers.log('💬 Đã comment vào bài #' + pos + logSuffix)
  return { commented: true, position: pos, text: text, imageCount: imageCount, rewrittenContent: shouldRewriteCommentContentEachRun }
} catch (e) {
  const message = e && e.message ? String(e.message) : String(e)
  helpers.log('⚠️ Không comment được bài #' + pos + ': ' + message)
  try {
    await page.press('Escape')
    await helpers.sleep(500, signal)
  } catch {}
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
  $block$,
  output_schema = '[
    {"name":"commented","type":"boolean","label":"Đã comment chưa"},
    {"name":"commentFailed","type":"boolean","label":"Comment lỗi"},
    {"name":"position","type":"number","label":"Vị trí đã comment"},
    {"name":"text","type":"string","label":"Nội dung đã comment"},
    {"name":"imageCount","type":"number","label":"Số ảnh đã gửi"},
    {"name":"error","type":"string","label":"Lỗi comment"}
  ]'::jsonb,
  updated_at = now()
WHERE name = 'fb_comment_at_position';

COMMIT;
