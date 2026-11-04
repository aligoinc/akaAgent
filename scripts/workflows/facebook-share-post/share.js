// Centralized AI rewrite via ai_using.
const __aiRewriteUsingCode = "fb_share_post_rewrite";
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
    const rewritten = await __callAIRewriteContent(content)
    if (!rewritten) throw new Error('AI trả về nội dung không hợp lệ.')
    helpers.log('Đã viết lại nội dung bằng AI')
    return rewritten
  } catch (e) {
    const message = e && e.message ? String(e.message) : String(e)
    helpers.log('AI viết lại nội dung lỗi, dùng nội dung gốc: ' + message)
    return original
  }
}

const link = String(input.sourceLink || vars.sourceLink || '').trim()
if (!link) throw new Error('sourceLink rỗng')
let content
if (typeof helpers.prepareCampaignContent === 'function') {
  const prepared = await helpers.prepareCampaignContent({
    rewriteCode: __aiRewriteUsingCode,
    sourceText: vars.campaignSourceText || '',
    sourceMedia: vars.campaignSourceMedia || []
  })
  content = prepared.content
  vars.campaignContent = prepared.content
  vars.images = prepared.media
  vars.contentVariantIndex = prepared.variantIndex
} else {
  content = String(input.content || vars.campaignContent || '')
  content = await renderContentTemplate(content)
  content = await rewriteContentForRun(content)
}

// Build URL từ link (UID/slug/full URL)
const url = /^https?:\/\//i.test(link) ? link
  : (/^\d+$/.test(link) ? 'https://www.facebook.com/profile.php?id=' + link
    : 'https://www.facebook.com/' + link)

await page.navigate(url)
await helpers.sleep(4000, signal)

// Scroll xuống để FB lazy-render bài (tránh waitForSelector container fail oan)
await page.scroll({ direction: 'down', amount: 2000 })
await helpers.sleep(1500, signal)

// Đợi container bài đăng (union 4 patterns: page/profile/dialog/group)
const containerSel = await helpers.element('fb_post_container')
const found = await page.waitForSelector(containerSel, { timeout: 10000 }).catch(() => false)
if (!found) throw new Error('Không tìm thấy container bài đăng nguồn')
await helpers.sleep(1500, signal)

// Element 257 contains the complete XPath, including the global Reel branch.
const shareInner = await helpers.element('fb_share_button_inner')
const shareBtnSel = shareInner
await page.click(shareBtnSel)
await helpers.sleep(2500, signal)

// Click "Chia sẻ ngay" trong menu pop-up
const shareNowSel = await helpers.element('fb_share_now_menuitem')
await page.click(shareNowSel)
await helpers.sleep(3500, signal)

// Composer dialog mở - thêm content + click Đăng
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
