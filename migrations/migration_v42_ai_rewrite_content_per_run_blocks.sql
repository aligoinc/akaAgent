-- AI rewrite per run for campaign content/comment blocks.
-- The UI/source only stores flags and injects vars; DB blocks call akaApp AI and fallback to original content when AI fails.

BEGIN;

DO $migration$
DECLARE
  main_content_helper text := $js$
const shouldRewriteContentEachRun = vars.rewriteContentEachRun === true

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

const renderContentTemplate = async (raw, options = {}) => {
  let rendered = String(raw || '')

  if (/#\{\s*FULL_NAME\s*\}/i.test(rendered)) {
    let fullName = String(vars.campaignInputDataName || vars.inputDataName || '').trim()
    if (!fullName && options.resolveFullNameFromPage) {
      const nameXpath = "//*[contains(@class,'xxymvpz x1dyh7pn')]"
      try {
        const found = await page.waitForSelector(nameXpath, { timeout: 3000 }).catch(() => false)
        if (found) fullName = String(await page.getText(nameXpath).catch(() => '') || '').trim()
      } catch (e) {
        fullName = ''
      }
    }
    rendered = rendered.replace(/#\{\s*FULL_NAME\s*\}/gi, fullName)
  }

  rendered = rendered.replace(
    /#\{\s*(TODAY|TOMORROW|YESTERDAY)\s*(?:\(\s*(DD\/MM\/YYYY|MM\/DD\/YYYY)\s*\))?\s*\}/gi,
    (_match, dayKey, formatKey) => formatTemplateDate(dayKey, formatKey)
  )

  return rendered
}

const rewriteContentForRun = async (raw) => {
  const original = String(raw || '')
  const content = original.trim()
  if (!shouldRewriteContentEachRun || !content) return original

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

    helpers.log('Đã viết lại nội dung bằng AI')
    return payload.data
  } catch (e) {
    const message = e && e.message ? String(e.message) : String(e)
    helpers.log('AI viết lại nội dung lỗi, dùng nội dung gốc: ' + message)
    return original
  }
}
$js$;

  comment_content_helper text := $js$
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
$js$;
BEGIN
  UPDATE public.auto_blocks
  SET
    code = main_content_helper || $js$
let text = String(input.content || vars.campaignContent || '')
text = await renderContentTemplate(text)
text = await rewriteContentForRun(text)

const dialog = await helpers.element('fb_composer_dialog')
await page.waitForSelector(dialog, { timeout: 10000 })
await helpers.sleep(800, signal)
await page.fill(dialog, text)
return { typed: true, content: text, rewrittenContent: shouldRewriteContentEachRun }
$js$,
    updated_at = now()
  WHERE name = 'fb_type_post_content';

  UPDATE public.auto_blocks
  SET
    code = main_content_helper || $js$
try {
  let text = String(input.text || vars.campaignContent || '')
  const imgs = Array.isArray(input.images) && input.images.length > 0
    ? input.images
    : (Array.isArray(vars.images) ? vars.images : [])

  try {
    const closeBtn = '[aria-label="Đóng"], [aria-label="Close"]'
    const found = await page.waitForSelector(closeBtn, { timeout: 3000 })
    if (found) {
      await page.click(closeBtn)
      await helpers.sleep(2000, signal)
      const confirm = '(//*[@role="button" and @aria-label="Không khôi phục tin nhắn" and @tabindex="0"])[position()=1]'
      const c = await page.waitForSelector(confirm, { timeout: 3000 }).catch(() => false)
      if (c) {
        await page.click(confirm)
        await helpers.sleep(2000, signal)
      }
    }
  } catch (e) { /* không có dialog -> bỏ qua */ }

  try {
    const cont = '//*[@role="button" and .="Tiếp tục"]'
    const found = await page.waitForSelector(cont, { timeout: 2000 })
    if (found) {
      await page.click(cont)
      await helpers.sleep(2000, signal)
    }
  } catch (e) { /* không có -> bỏ qua */ }

  const box = await helpers.element('fb_messenger_textbox')
  await page.waitForSelector(box, { timeout: 15000 })
  await helpers.sleep(1000, signal)
  await page.click(box)
  await helpers.sleep(500, signal)

  text = (await renderContentTemplate(text, { resolveFullNameFromPage: true })).trim()
  text = (await rewriteContentForRun(text)).trim()

  if (text) {
    await page.fill(box, text)
    await helpers.sleep(1000, signal)
  }
  if (imgs.length > 0) {
    await page.dropFile(box, imgs)
    await helpers.sleep(Math.max(3000, imgs.length * 1500), signal)
  }
  if (text || imgs.length > 0) {
    await page.press('Enter')
    await helpers.sleep(2000, signal)
  }
  return { ok: true, content: text, rewrittenContent: shouldRewriteContentEachRun }
} catch (e) {
  return { ok: false, error: e.message }
}
$js$,
    updated_at = now()
  WHERE name = 'fb_send_message';

  UPDATE public.auto_blocks
  SET
    code = main_content_helper || $js$
const link = String(input.sourceLink || vars.sourceLink || '').trim()
if (!link) throw new Error('sourceLink rỗng')
let content = String(input.content || vars.campaignContent || '')
content = await renderContentTemplate(content)
content = await rewriteContentForRun(content)

const url = /^https?:\/\//i.test(link) ? link
  : (/^\d+$/.test(link) ? 'https://www.facebook.com/profile.php?id=' + link
    : 'https://www.facebook.com/' + link)

await page.navigate(url)
await helpers.sleep(4000, signal)

await page.scroll({ direction: 'down', amount: 2000 })
await helpers.sleep(1500, signal)

const containerSel = await helpers.element('fb_post_container')
const found = await page.waitForSelector(containerSel, { timeout: 10000 }).catch(() => false)
if (!found) throw new Error('Không tìm thấy container bài đăng nguồn')
await helpers.sleep(1500, signal)

const shareInner = await helpers.element('fb_share_button_inner')
const shareBtnSel = containerSel.split('|').map(c => c.trim() + shareInner).join(' | ')
await page.click(shareBtnSel)
await helpers.sleep(2500, signal)

const shareNowSel = await helpers.element('fb_share_now_menuitem')
await page.click(shareNowSel)
await helpers.sleep(3500, signal)

const composer = await helpers.element('fb_composer_dialog')
const composerFound = await page.waitForSelector(composer, { timeout: 5000 }).catch(() => false)
if (composerFound && content) {
  await page.click(composer).catch(() => {})
  await helpers.sleep(500, signal)
  await page.fill(composer, content).catch(() => {})
  await helpers.sleep(1500, signal)
}
const postBtn = await helpers.element('fb_post_button')
await page.click(postBtn)
await helpers.sleep(5000, signal)

helpers.log('Đã chia sẻ từ ' + link)
return { shared: true, sourceLink: link, content, rewrittenContent: shouldRewriteContentEachRun }
$js$,
    updated_at = now()
  WHERE name = 'fb_share_post';

  UPDATE public.auto_blocks
  SET
    code = main_content_helper || $js$
const videoPath = String(input.videoPath || vars.videoPath || '').trim()
if (!videoPath) throw new Error('videoPath rỗng (cần ít nhất 1 video trong vars.images)')
let content = String(input.content || vars.campaignContent || '')
content = await renderContentTemplate(content)
content = await rewriteContentForRun(content)

await page.navigate('https://www.facebook.com/reels/create')
await helpers.sleep(5000, signal)

const uploadInput = await helpers.element('fb_reels_upload_input')
const uploaded = await page.uploadFile(uploadInput, [videoPath])
if (!uploaded || uploaded.fileCount === 0) throw new Error('Không upload được video cho Reels')
await helpers.sleep(6000, signal)

const nextSel = await helpers.element('fb_reels_next_button')
await page.click(nextSel).catch(() => {})
await helpers.sleep(3000, signal)
await page.click(nextSel).catch(() => {})
await helpers.sleep(3000, signal)

if (content) {
  const descSel = await helpers.element('fb_reels_description')
  await page.click(descSel).catch(() => {})
  await helpers.sleep(500, signal)
  await page.fill(descSel, content).catch(() => {})
  await helpers.sleep(1500, signal)
}

const publishSel = await helpers.element('fb_reels_publish_button')
await page.click(publishSel)
await helpers.sleep(6000, signal)

helpers.log('Đã đăng Reels: ' + videoPath)
return { posted: true, content, rewrittenContent: shouldRewriteContentEachRun }
$js$,
    updated_at = now()
  WHERE name = 'fb_post_reels';

  UPDATE public.auto_blocks
  SET
    code = comment_content_helper || $js$
const item = (vars && vars.loopItem) ? vars.loopItem : {}
const pos = Number(input.position || item.position || 1)
let text = String(input.text || item.text || '')
text = await renderCommentTemplate(text)
text = await rewriteCommentForRun(text)
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

const boxXpath = await helpers.elementWith('fb_comment_box_at_n', { n: pos })
await page.waitForSelector(boxXpath, { timeout: 8000 })
await page.click(boxXpath)
await helpers.sleep(2000, signal)
const inputXpath = await helpers.element('fb_comment_dialog_textbox')
await page.waitForSelector(inputXpath, { timeout: 8000 })

if (text) {
  await page.type(inputXpath, text, { clearFirst: true })
  await helpers.sleep(1000, signal)
}

let imageCount = 0
if (images.length > 0) {
  const dropResult = await page.dropFile(inputXpath, images)
  imageCount = Number(dropResult.fileCount || 0)
  await helpers.sleep(3000, signal)
  if (!text && imageCount <= 0) {
    return { commented: false, position: pos, text: '', imageCount: 0 }
  }
}

await page.press('Enter')
await helpers.sleep(3000, signal)
const logSuffix = text ? ': ' + text.substring(0, 50) : ''
helpers.log('💬 Đã comment vào bài #' + pos + logSuffix)
return { commented: true, position: pos, text: text, imageCount: imageCount, rewrittenContent: shouldRewriteCommentContentEachRun }
$js$,
    updated_at = now()
  WHERE name = 'fb_comment_at_position';

  UPDATE public.auto_blocks
  SET
    code = comment_content_helper || $js$
const item = (vars && vars.loopItem) ? vars.loopItem : {}
let text = String(input.text || item.text || '')
text = await renderCommentTemplate(text)
text = await rewriteCommentForRun(text)
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

if (!text && images.length === 0) return { commented: false, position: 1, text: '', imageCount: 0 }

const inputXpath = await helpers.element('fb_comment_dialog_textbox')
await page.waitForSelector(inputXpath, { timeout: 8000 })
await page.click(inputXpath)
await helpers.sleep(1000, signal)

if (text) {
  await page.type(inputXpath, text, { clearFirst: true })
  await helpers.sleep(1000, signal)
}

let imageCount = 0
if (images.length > 0) {
  const dropResult = await page.dropFile(inputXpath, images)
  imageCount = Number(dropResult.fileCount || 0)
  await helpers.sleep(3000, signal)
  if (!text && imageCount <= 0) {
    return { commented: false, position: 1, text: '', imageCount: 0 }
  }
}

await page.click(inputXpath)
await helpers.sleep(500, signal)
await page.press('Enter')
await helpers.sleep(5000, signal)

const logSuffix = text ? ': ' + text.substring(0, 50) : ''
helpers.log('💬 Đã comment vào bài post' + logSuffix)
return { commented: true, position: 1, text: text, imageCount: imageCount, rewrittenContent: shouldRewriteCommentContentEachRun }
$js$,
    updated_at = now()
  WHERE name = 'fb_comment_current_post';
END;
$migration$;

COMMIT;
