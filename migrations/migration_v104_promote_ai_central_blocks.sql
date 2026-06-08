BEGIN;

CREATE TEMP TABLE _ai_block_promotions (
  block_name text PRIMARY KEY,
  code text NOT NULL
) ON COMMIT DROP;

INSERT INTO _ai_block_promotions (block_name, code)
VALUES
  ($ai_block_0_name$fb_type_post_content$ai_block_0_name$, $ai_block_0_code$// Centralized AI rewrite via ai_using.
const __aiRewriteUsingCode = "fb_type_post_content_rewrite";
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

let text = String(input.content || vars.campaignContent || '')
text = await renderContentTemplate(text)
text = await rewriteContentForRun(text)

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

const dialog = await helpers.element('fb_composer_dialog')
await page.waitForSelector(dialog, { timeout: 10000 })
await helpers.sleep(800, signal)
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
await page.fill(dialog, text)
return { typed: true, content: text, rewrittenContent: shouldRewriteContentEachRun }
$ai_block_0_code$),
  ($ai_block_1_name$fb_send_message$ai_block_1_name$, $ai_block_1_code$// Centralized AI rewrite via ai_using.
const __aiRewriteUsingCode = "fb_send_message_rewrite";
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


try {
  let text = String(input.text || vars.campaignContent || '')
  const imgs = Array.isArray(input.images) && input.images.length > 0
    ? input.images
    : (Array.isArray(vars.images) ? vars.images : [])

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


  // Đóng dialog "Khôi phục đoạn chat" nếu hiện
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

  // Đóng dialog E2EE "Tiếp tục" nếu hiện
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
$ai_block_1_code$),
  ($ai_block_2_name$fb_share_post$ai_block_2_name$, $ai_block_2_code$// Centralized AI rewrite via ai_using.
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
let content = String(input.content || vars.campaignContent || '')
content = await renderContentTemplate(content)
content = await rewriteContentForRun(content)

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

// Build share button selector: append descendant pattern sau mỗi container path
const shareInner = await helpers.element('fb_share_button_inner')
const shareBtnSel = containerSel.split('|').map(c => c.trim() + shareInner).join(' | ')
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
$ai_block_2_code$),
  ($ai_block_3_name$fb_post_reels$ai_block_3_name$, $ai_block_3_code$// Centralized AI rewrite via ai_using.
const __aiRewriteUsingCode = "fb_post_reels_rewrite";
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

const videoPath = String(input.videoPath || vars.videoPath || '').trim()
if (!videoPath) throw new Error('videoPath rỗng (cần ít nhất 1 video trong vars.images)')
let content = String(input.content || vars.campaignContent || '')
content = await renderContentTemplate(content)
content = await rewriteContentForRun(content)

// Mở trang tạo Reels
await page.navigate('https://www.facebook.com/reels/create')
await helpers.sleep(5000, signal)

// Upload video
const uploadInput = await helpers.element('fb_reels_upload_input')
const uploaded = await page.uploadFile(uploadInput, [videoPath])
if (!uploaded || uploaded.fileCount === 0) throw new Error('Không upload được video cho Reels')
await helpers.sleep(6000, signal)

// Click Tiếp/Next 2 lần (Reels có 2-3 bước trước khi đến caption)
const nextSel = await helpers.element('fb_reels_next_button')
await page.click(nextSel).catch(() => {})
await helpers.sleep(3000, signal)
await page.click(nextSel).catch(() => {})
await helpers.sleep(3000, signal)

// Nhập caption
if (content) {
  const descSel = await helpers.element('fb_reels_description')
  await page.click(descSel).catch(() => {})
  await helpers.sleep(500, signal)
  await page.fill(descSel, content).catch(() => {})
  await helpers.sleep(1500, signal)
}

// Click Đăng
const publishSel = await helpers.element('fb_reels_publish_button')
await page.click(publishSel)
await helpers.sleep(6000, signal)

helpers.log('Đã đăng Reels: ' + videoPath)
return { posted: true, content, rewrittenContent: shouldRewriteContentEachRun }
$ai_block_3_code$),
  ($ai_block_4_name$fb_comment_at_position$ai_block_4_name$, $ai_block_4_code$// Centralized AI rewrite via ai_using.
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
}$ai_block_4_code$),
  ($ai_block_5_name$fb_comment_current_post$ai_block_5_name$, $ai_block_5_code$// Centralized AI rewrite via ai_using.
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
  await helpers.sleep(3000, signal)
  if (!text && imageCount <= 0) {
    return { commented: false, position: 1, text: '', imageCount: 0 }
  }
}

await page.click(inputXpath)
await helpers.sleep(500, signal)
await page.press('Enter')
await helpers.sleep(10000, signal)

const logSuffix = text ? ': ' + text.substring(0, 50) : ''
helpers.log('💬 Đã comment vào bài post' + logSuffix)
return { commented: true, position: 1, text: text, imageCount: imageCount, rewrittenContent: shouldRewriteCommentContentEachRun }
$ai_block_5_code$),
  ($ai_block_6_name$fb_page_post_api$ai_block_6_name$, $ai_block_6_code$// Centralized AI rewrite via ai_using.
const __aiRewriteUsingCode = "fb_page_post_api_rewrite";
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

const pageUid = String(vars.pageUid || input.pageUid || vars.inputDataUid || '').trim()
const pageName = String(vars.pageName || input.pageName || vars.inputDataName || '').trim()
const businessUrl = String(vars.businessUrl || input.businessUrl || 'https://business.facebook.com/content_management').trim()
const graphBaseUrl = String(vars.graphBaseUrl || input.graphBaseUrl || 'https://graph.facebook.com').replace(/\/+$/g, '')

if (!pageUid) throw new Error('Thiếu Page ID để đăng bài fanpage')
if (vars.pagePostMode && vars.pagePostMode !== 'api') {
  throw new Error('Đăng bài fanpage trên giao diện chưa được hỗ trợ trong phiên bản này')
}

const formatTemplateDate = (dayKey, formatKey) => {
  const d = new Date()
  const key = String(dayKey || 'TODAY').toUpperCase()
  if (key === 'TOMORROW') d.setDate(d.getDate() + 1)
  if (key === 'YESTERDAY') d.setDate(d.getDate() - 1)
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yyyy = String(d.getFullYear())
  return String(formatKey || 'DD/MM/YYYY').toUpperCase() === 'MM/DD/YYYY'
    ? mm + '/' + dd + '/' + yyyy
    : dd + '/' + mm + '/' + yyyy
}

const renderContentTemplate = async (raw) => {
  let rendered = String(raw || '')
  if (/#\{\s*FULL_NAME\s*\}/i.test(rendered)) {
    const fullName = String(vars.campaignInputDataName || vars.inputDataName || pageName || '').trim()
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
  if (vars.rewriteContentEachRun !== true || !content) return original
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

let message = String(vars.campaignContent || input.campaignContent || '').trim()
message = (await renderContentTemplate(message)).trim()
message = (await rewriteContentForRun(message)).trim()

const images = (Array.isArray(vars.images) ? vars.images : Array.isArray(input.images) ? input.images : [])
  .map(item => String(item || '').trim())
  .filter(Boolean)

if (!message && images.length === 0) {
  throw new Error('Không có nội dung hoặc ảnh để đăng fanpage')
}

function graphUrl(path, params) {
  const qs = new URLSearchParams(params || {}).toString()
  return graphBaseUrl + '/' + String(path || '').replace(/^\/+/g, '') + (qs ? '?' + qs : '')
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function redactTokens(value) {
  if (Array.isArray(value)) return value.map(redactTokens)
  if (!value || typeof value !== 'object') return value
  const out = {}
  for (const key of Object.keys(value)) {
    if (/token/i.test(key)) continue
    out[key] = redactTokens(value[key])
  }
  return out
}

function graphErrorFromResponse(phase, response, fallbackMessage) {
  const data = asObject(response && response.data)
  const rawError = asObject(data.error)
  const rawData = typeof (response && response.data) === 'string' ? response.data : ''
  const message = String(
    rawError.message ||
    data.message ||
    fallbackMessage ||
    rawData ||
    'Facebook Graph API không trả chi tiết lỗi'
  ).trim()
  return {
    phase,
    status: Number(response && response.status || 0),
    message,
    type: rawError.type ? String(rawError.type) : undefined,
    code: rawError.code !== undefined ? rawError.code : undefined,
    error_subcode: rawError.error_subcode !== undefined ? rawError.error_subcode : undefined,
    fbtrace_id: rawError.fbtrace_id ? String(rawError.fbtrace_id) : undefined
  }
}

function graphErrorFromException(phase, error) {
  return {
    phase,
    status: 0,
    message: error && error.message ? String(error.message) : String(error || 'Lỗi gọi Facebook Graph API')
  }
}

function describeGraphError(error) {
  const parts = []
  if (error.message) parts.push(String(error.message))
  if (error.type) parts.push('type=' + error.type)
  if (error.code !== undefined) parts.push('code=' + error.code)
  if (error.error_subcode !== undefined) parts.push('subcode=' + error.error_subcode)
  if (error.fbtrace_id) parts.push('fbtrace_id=' + error.fbtrace_id)
  return parts.join(' | ') || 'Facebook Graph API lỗi'
}

function logGraphError(error) {
  const parts = ['Facebook API lỗi khi ' + error.phase + ': HTTP ' + (error.status || 'network')]
  if (error.message) parts.push('message=' + error.message)
  if (error.type) parts.push('type=' + error.type)
  if (error.code !== undefined) parts.push('code=' + error.code)
  if (error.error_subcode !== undefined) parts.push('subcode=' + error.error_subcode)
  if (error.fbtrace_id) parts.push('fbtrace_id=' + error.fbtrace_id)
  helpers.log(parts.join(' | '))
}

async function callGraph(phase, opts) {
  try {
    const response = await page.apiCall(opts)
    const data = asObject(response.data)
    if (response.status < 200 || response.status >= 300 || data.error) {
      const graphError = graphErrorFromResponse(phase, response)
      logGraphError(graphError)
      return { ok: false, status: response.status, data: redactTokens(response.data), graphError }
    }
    return { ok: true, status: response.status, data: response.data }
  } catch (e) {
    const graphError = graphErrorFromException(phase, e)
    logGraphError(graphError)
    return { ok: false, status: 0, data: null, graphError }
  }
}

function fail(graphError, extra) {
  return {
    ok: false,
    posted: false,
    pageUid,
    pageName,
    postId: '',
    postUrl: '',
    imageCount: 0,
    error: describeGraphError(graphError),
    graphError,
    ...(extra || {})
  }
}

function postUrlFromId(postId) {
  const id = String(postId || '').trim()
  if (!id) return ''
  const parts = id.split('_').filter(Boolean)
  if (parts.length >= 2) return 'https://www.facebook.com/' + parts[0] + '/posts/' + parts[1]
  return 'https://www.facebook.com/' + id
}

helpers.log('Mở Business/Facebook để lấy phiên đăng nhập')
await page.navigate(businessUrl)
await helpers.sleep(4000, signal)

helpers.log('Đang lấy user access token từ session Business')
const userAccessToken = await page.evaluate(`
  const sources = [];
  function add(value) {
    if (typeof value === 'string' && value) sources.push(value);
  }
  try { add(document.body ? document.body.innerHTML : ''); } catch (e) {}
  try { add(document.documentElement ? document.documentElement.innerHTML : ''); } catch (e) {}
  try {
    for (const script of Array.from(document.scripts || [])) {
      add(script.textContent || script.innerText || '');
    }
  } catch (e) {}
  for (const source of sources) {
    const match = source.match(/EAAG[A-Za-z0-9_\\-]{20,}/);
    if (match && match[0]) return match[0];
  }
  const body = sources.join(' ');
  const legacy = body.match(/EAAG(.*?)"/);
  return legacy && legacy[1] ? 'EAAG' + legacy[1] : '';
`)

if (!userAccessToken) {
  throw new Error('Không tìm thấy user access token. Hãy mở lại tab Business/Facebook rồi thử chạy chiến dịch.')
}
helpers.log('Đã lấy user token từ session hiện tại')

const cookieHeader = await page.getCookieHeader('https://graph.facebook.com/')
const graphHeaders = {
  Accept: 'application/json',
  ...(cookieHeader ? { Cookie: cookieHeader } : {})
}

helpers.log('Đang lấy page access token cho fanpage ' + (pageName || pageUid))
const pageTokenResponse = await callGraph('lấy page token', {
  url: graphUrl(pageUid, { fields: 'access_token', access_token: userAccessToken }),
  method: 'GET',
  headers: graphHeaders,
  timeout: 30000
})
if (!pageTokenResponse.ok) return fail(pageTokenResponse.graphError, { graphResponse: redactTokens(pageTokenResponse.data) })

const pageTokenData = asObject(pageTokenResponse.data)
const pageAccessToken = String(pageTokenData.access_token || '').trim()
if (!pageAccessToken) {
  const graphError = {
    phase: 'lấy page token',
    status: Number(pageTokenResponse.status || 200),
    message: 'Graph API không trả page access_token. Kiểm tra quyền pages_manage_posts/pages_read_engagement và quyền quản lý page.'
  }
  logGraphError(graphError)
  return fail(graphError)
}
helpers.log('Đã lấy page token, chuẩn bị đăng bài')

const mediaFbids = []
for (let i = 0; i < images.length; i++) {
  const imagePath = images[i]
  const phase = 'upload ảnh ' + (i + 1) + '/' + images.length
  helpers.log('Đang ' + phase + ' lên fanpage')
  const uploadResponse = await callGraph(phase, {
    url: graphUrl(pageUid + '/photos'),
    method: 'POST',
    headers: graphHeaders,
    bodyType: 'multipart',
    body: {
      access_token: pageAccessToken,
      published: 'false',
      temporary: 'true'
    },
    files: [{ field: 'source', path: imagePath }],
    timeout: 120000
  })
  if (!uploadResponse.ok) {
    return fail(uploadResponse.graphError, {
      imageCount: mediaFbids.length,
      graphResponse: redactTokens(uploadResponse.data)
    })
  }
  const photoId = String(asObject(uploadResponse.data).id || '').trim()
  if (!photoId) {
    const graphError = {
      phase,
      status: Number(uploadResponse.status || 200),
      message: 'Facebook không trả photo_id sau khi upload ảnh'
    }
    logGraphError(graphError)
    return fail(graphError, { imageCount: mediaFbids.length, graphResponse: redactTokens(uploadResponse.data) })
  }
  mediaFbids.push(photoId)
}

helpers.log('Đang đăng bài lên fanpage ' + (pageName || pageUid))
const feedBody = {
  access_token: pageAccessToken,
  published: 'true'
}
if (message) feedBody.message = message
for (let i = 0; i < mediaFbids.length; i++) {
  feedBody['attached_media[' + i + ']'] = JSON.stringify({ media_fbid: mediaFbids[i] })
}

const feedResponse = await callGraph('đăng feed', {
  url: graphUrl(pageUid + '/feed'),
  method: 'POST',
  headers: graphHeaders,
  bodyType: 'form',
  body: feedBody,
  timeout: 60000
})
if (!feedResponse.ok) {
  return fail(feedResponse.graphError, {
    imageCount: mediaFbids.length,
    graphResponse: redactTokens(feedResponse.data)
  })
}

const postId = String(asObject(feedResponse.data).id || '').trim()
if (!postId) {
  const graphError = {
    phase: 'đăng feed',
    status: Number(feedResponse.status || 200),
    message: 'Facebook không trả id bài viết sau khi đăng feed'
  }
  logGraphError(graphError)
  return fail(graphError, { imageCount: mediaFbids.length, graphResponse: redactTokens(feedResponse.data) })
}

const postUrl = postUrlFromId(postId)
helpers.log('Đăng bài fanpage thành công: ' + postId)

return {
  ok: true,
  posted: true,
  pageUid,
  pageName,
  postId,
  postUrl,
  imageCount: mediaFbids.length,
  graphResponse: redactTokens(feedResponse.data)
}$ai_block_6_code$),
  ($ai_block_7_name$fb_post_current_identity_ui$ai_block_7_name$, $ai_block_7_code$// Centralized AI rewrite via ai_using.
const __aiRewriteUsingCode = "fb_post_current_identity_ui_rewrite";
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

try { /* v59-safe-output-wrapper */

const stepMs = Number(vars.facebookStepMs || input.facebookStepMs || 1000)
const submitTimeoutMs = Number(vars.facebookSubmitTimeoutMs || input.facebookSubmitTimeoutMs || 30000)
const publishTimeoutMs = Number(vars.facebookPublishTimeoutMs || input.facebookPublishTimeoutMs || 120000)

const closeSelector = await helpers.element('FbComposerCloseDialogButton')
const openSelector = await helpers.element('FbComposerOpenButton')
const textSelector = await helpers.element('FbComposerTextInput')
const backgroundButtonSelector = await helpers.element('FbComposerBackgroundButton')
const backgroundOptionSelector = await helpers.element('FbComposerBackgroundOption')
const formSelector = await helpers.element('FbComposerForm')
const nextSelector = await helpers.element('FbComposerNextButton')
const reelsNextSelector = await helpers.element('FbComposerReelsNextButton')
const submitSelector = await helpers.element('FbComposerSubmitButton')
const anotherTimeSelector = await helpers.element('FbComposerAnotherTimeButton')
const errorSelector = await helpers.element('FbComposerErrorMessage')
const rawLinkSelector = await helpers.element('FbComposerRawPostLink')
const postLinkSelector = await helpers.element('FbComposerPostLink')

function formatTemplateDate(dayKey, formatKey) {
  const d = new Date()
  const key = String(dayKey || 'TODAY').toUpperCase()
  if (key === 'TOMORROW') d.setDate(d.getDate() + 1)
  if (key === 'YESTERDAY') d.setDate(d.getDate() - 1)
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yyyy = String(d.getFullYear())
  return String(formatKey || 'DD/MM/YYYY').toUpperCase() === 'MM/DD/YYYY' ? mm + '/' + dd + '/' + yyyy : dd + '/' + mm + '/' + yyyy
}

async function renderContentTemplate(raw) {
  let rendered = String(raw || '')
  if (/#\{\s*FULL_NAME\s*\}/i.test(rendered)) {
    const fullName = String(vars.campaignInputDataName || vars.inputDataName || vars.pageName || '').trim()
    rendered = rendered.replace(/#\{\s*FULL_NAME\s*\}/gi, fullName)
  }
  rendered = rendered.replace(
    /#\{\s*(TODAY|TOMORROW|YESTERDAY)\s*(?:\(\s*(DD\/MM\/YYYY|MM\/DD\/YYYY)\s*\))?\s*\}/gi,
    (_match, dayKey, formatKey) => formatTemplateDate(dayKey, formatKey)
  )
  return rendered
}

async function rewriteContentForRun(raw) {
  const original = String(raw || '')
  const content = original.trim()
  if (vars.rewriteContentEachRun !== true || !content) return original
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

let message = String(vars.campaignContent || input.campaignContent || '').trim()
message = (await renderContentTemplate(message)).trim()
message = (await rewriteContentForRun(message)).trim()

const images = (Array.isArray(vars.images) ? vars.images : Array.isArray(input.images) ? input.images : [])
  .map(item => String(item || '').trim())
  .filter(Boolean)

if (!message && images.length === 0) {
  return { ok: false, posted: false, error: 'Không có nội dung hoặc ảnh để đăng' }
}

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

async function rawText(selector) {
  return await page.evaluate(`
    const selector = __args[0];
    try {
      const result = document.evaluate(selector, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      const el = result.snapshotItem(0);
      return el ? String(el.innerText || el.textContent || '').trim() : '';
    } catch {
      return '';
    }
  `, selector)
}

async function rawFillContent(selector, value) {
  return await page.evaluate(`
    const selector = __args[0];
    const value = String(__args[1] || '').replace(/\\t/g, '      ');
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
    if (!el) return { filled: false, message: 'Không tìm thấy ô nhập nội dung' };
    try { el.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch {}
    try { el.focus(); } catch {}
    const target = el.isContentEditable ? el : (el.querySelector && (el.querySelector('[contenteditable="true"]') || el.querySelector('[role="textbox"]'))) || el;
    try { target.focus(); } catch {}
    try {
      const dt = new DataTransfer();
      dt.setData('text/plain', value + ' ');
      const pasteEvent = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
      target.dispatchEvent(pasteEvent);
      if (target.isContentEditable) {
        document.execCommand('insertText', false, ' ');
      } else if ('value' in target) {
        target.value = String(target.value || '') + value + ' ';
        target.dispatchEvent(new Event('input', { bubbles: true }));
        target.dispatchEvent(new Event('change', { bubbles: true }));
      }
      return { filled: true };
    } catch (e) {
      if (target.isContentEditable) {
        document.execCommand('insertText', false, value + ' ');
        return { filled: true };
      }
      return { filled: false, message: e && e.message ? e.message : String(e) };
    }
  `, selector, value)
}

async function getPostUrl() {
  return await page.evaluate(`
    const rawSelector = __args[0];
    const linkSelector = __args[1];
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
    function cleanHref(href) {
      if (!href) return '';
      try {
        const url = new URL(href, location.href);
        if (/^(m|mbasic|mobile)\\.facebook\\.com$/i.test(url.hostname)) url.hostname = 'www.facebook.com';
        url.hash = '';
        Array.from(url.searchParams.keys()).forEach(key => {
          if (key.startsWith('__') || key === 'mibextid' || key === 'ref' || key === 'locale') url.searchParams.delete(key);
        });
        return url.href;
      } catch {
        return String(href || '').trim();
      }
    }
    const raw = xpathAll(rawSelector)[0] || null;
    if (raw) {
      try { raw.dispatchEvent(new FocusEvent('focusin', { bubbles: true, cancelable: true, view: window })); } catch {}
      try { raw.focus(); } catch {}
    }
    const link = xpathAll(linkSelector)[0] || null;
    return cleanHref(link ? (link.href || link.getAttribute('href') || '') : '');
  `, rawLinkSelector, postLinkSelector)
}

helpers.log('Đang mở composer đăng bài trên identity hiện tại')
await rawClick(closeSelector).catch(() => null)
await helpers.sleep(stepMs + 1000, signal)
await page.navigate('https://www.facebook.com/profile.php')
await helpers.sleep(stepMs + 3000, signal)
await rawClick(closeSelector).catch(() => null)
await helpers.sleep(stepMs + 1000, signal)

const openCount = await rawCount(openSelector)
if (openCount === 0) {
  return { ok: false, posted: false, error: 'Không tìm thấy nút tạo bài viết' }
}

const opened = await rawClick(openSelector)
if (!opened || opened.clicked !== true) {
  return { ok: false, posted: false, error: 'Lỗi khi nhấn nút tạo bài post' }
}
await helpers.sleep(stepMs + 1000, signal)

if ((vars.postWithBackground === true || input.postWithBackground === true) && message) {
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
  const filled = await rawFillContent(textSelector, message)
  if (!filled || filled.filled !== true) {
    return { ok: false, posted: false, error: 'Lỗi khi nhập nội dung bài post: ' + String(filled && filled.message ? filled.message : '') }
  }
  await helpers.sleep(3000, signal)
}

if (images.length > 0) {
  helpers.log('Đang upload ' + images.length + ' ảnh vào composer')
  const dropResult = await page.dropFile(formSelector, images)
  if (!dropResult || dropResult.fileCount < images.length) {
    return { ok: false, posted: false, imageCount: Number(dropResult && dropResult.fileCount || 0), error: 'Đường dẫn file media không hợp lệ hoặc upload ảnh thất bại' }
  }
  await helpers.sleep(stepMs + Math.max(3000, images.length * 1000), signal)
}

await rawClick(nextSelector, { last: true }).then(r => r && r.clicked ? helpers.sleep(2000, signal) : null).catch(() => null)
await rawClick(reelsNextSelector).then(r => r && r.clicked ? helpers.sleep(2000, signal) : null).catch(() => null)

let clickedSubmit = false
const submitStarted = Date.now()
while (Date.now() - submitStarted < submitTimeoutMs) {
  const count = await rawCount(submitSelector)
  if (count > 0) {
    const targetIndex = count > 1 ? 1 : 0
    const clicked = await rawClick(submitSelector, { index: targetIndex })
    if (clicked && clicked.clicked === true) {
      clickedSubmit = true
      break
    }
  }
  await helpers.sleep(500, signal)
}

if (!clickedSubmit) {
  return { ok: false, posted: false, imageCount: images.length, error: 'Lỗi khi nhấn nút đăng bài' }
}

await helpers.sleep(3000, signal)
await rawClick(anotherTimeSelector).then(r => r && r.clicked ? helpers.sleep(stepMs + 1000, signal) : null).catch(() => null)

const publishStarted = Date.now()
while (Date.now() - publishStarted < publishTimeoutMs) {
  const count = await rawCount(submitSelector)
  if (count > 0) {
    await helpers.sleep(500, signal)
    continue
  }
  break
}

if (await rawCount(submitSelector) > 0) {
  const errorMessage = await rawText(errorSelector)
  return {
    ok: false,
    posted: false,
    imageCount: images.length,
    error: 'Đăng bài thất bại: ' + (errorMessage || 'Vui lòng kiểm tra lỗi trên giao diện facebook')
  }
}

await helpers.sleep(stepMs + 3000, signal)
await rawClick(closeSelector).catch(() => null)
await helpers.sleep(stepMs + 1000, signal)
const postUrl = String(await getPostUrl() || '').trim()
helpers.log('Đăng bài bằng giao diện thành công')

return {
  ok: true,
  posted: true,
  mode: 'ui',
  postUrl,
  imageCount: images.length
}


} catch (e) {
  if (signal && signal.aborted) throw e
  const message = e && e.message ? String(e.message) : String(e)
  helpers.log('Đăng bài bằng giao diện lỗi: ' + message)
  return { ok: false, posted: false, mode: 'ui', postUrl: '', imageCount: 0, error: message }
}
$ai_block_7_code$),
  ($ai_block_8_name$fb_send_page_inbox_message$ai_block_8_name$, $ai_block_8_code$// Centralized AI rewrite via ai_using.
const __aiRewriteUsingCode = "fb_send_page_inbox_message_rewrite";
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


const stepMs = Number(vars.facebookStepMs || input.facebookStepMs || 1000)
const customerName = String(vars.inputDataName || vars.campaignInputDataName || input.name || '').trim()
const customerPsid = String(vars.inputDataUid || input.uid || '').trim()
const customerPhone = String(vars.inputDataPhone || input.phone || '').trim()

const searchButtonXpath = await helpers.element('FbPageInboxSearchButton')
const searchInputXpath = await helpers.element('FbPageInboxSearchInput')
const searchResultXpath = await helpers.element('FbPageInboxSearchResult')
const conversationResultXpath = await helpers.element('FbPageInboxConversationResult')
const searchClearXpath = await helpers.element('FbPageInboxSearchClearButton')
const closeButtonXpath = await helpers.element('FbPageInboxCloseButton')
const headerNameXpath = await helpers.element('FbPageInboxHeaderName')
const messageInputXpath = await helpers.element('FbPageInboxMessageInput')
const messageInputFallbackXpath = await helpers.element('FbPageInboxMessengerReplyInput')
const sendDisabledXpath = await helpers.element('FbPageInboxSendButtonDisabled')
const sendButtonXpath = await helpers.element('FbPageInboxSendButton')
const sendFailSelector = await helpers.element('FbPageInboxSendFailIcon')

if (!customerName) throw new Error('Thiếu tên khách để tìm trong inbox page')

const formatTemplateDate = (dayKey, formatKey) => {
  const d = new Date()
  const key = String(dayKey || 'TODAY').toUpperCase()
  if (key === 'TOMORROW') d.setDate(d.getDate() + 1)
  if (key === 'YESTERDAY') d.setDate(d.getDate() - 1)
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yyyy = String(d.getFullYear())
  return String(formatKey || 'DD/MM/YYYY').toUpperCase() === 'MM/DD/YYYY'
    ? mm + '/' + dd + '/' + yyyy
    : dd + '/' + mm + '/' + yyyy
}

const renderContentTemplate = async (raw) => {
  const fullName = customerName
  let rendered = String(raw || '')
  rendered = rendered
    .replace(/#\{\s*FULL_NAME\s*\}/gi, fullName)
  rendered = rendered.replace(
    /#\{\s*(TODAY|TOMORROW|YESTERDAY)\s*(?:\(\s*(DD\/MM\/YYYY|MM\/DD\/YYYY)\s*\))?\s*\}/gi,
    (_match, dayKey, formatKey) => formatTemplateDate(dayKey, formatKey)
  )
  return rendered
}

const rewriteContentForRun = async (raw) => {
  const original = String(raw || '')
  const content = original.trim()
  if (vars.rewriteContentEachRun !== true || !content) return original
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

const normalizeInboxName = (value) => String(value || '').replace(/\s+/g, ' ').trim()
const isSameInboxName = (left, right) => normalizeInboxName(left) === normalizeInboxName(right)

let message = String(vars.campaignContent || input.campaignContent || '').replace(/\t/g, '      ')
message = (await renderContentTemplate(message)).trim()
message = (await rewriteContentForRun(message)).trim()

const images = (Array.isArray(vars.images) ? vars.images : Array.isArray(input.images) ? input.images : [])
  .map(item => String(item || '').trim())
  .filter(Boolean)

if (!message && images.length === 0) {
  throw new Error('Không có nội dung hoặc ảnh để gửi tin')
}

async function dom(action, payload = {}) {
  return await page.evaluate(`
    const args = __args[0] || {};
    const action = args.action;
    const payload = args.payload || {};

    function frameDocuments() {
      const docs = [document];
      const frames = Array.from(document.querySelectorAll('iframe'));
      for (let i = 0; i < frames.length; i++) {
        try {
          const doc = frames[i].contentDocument || (frames[i].contentWindow && frames[i].contentWindow.document);
          if (doc) docs.push(doc);
        } catch (e) {}
      }
      return docs;
    }

    function xpathAllIn(doc, xpath) {
      const out = [];
      try {
        const result = doc.evaluate(xpath, doc, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
        for (let i = 0; i < result.snapshotLength; i++) {
          const item = result.snapshotItem(i);
          if (item) out.push(item);
        }
      } catch (e) {}
      return out;
    }

    function queryAllIn(doc, selector) {
      try {
        if (String(selector || '').startsWith('/') || String(selector || '').startsWith('(')) {
          return xpathAllIn(doc, selector);
        }
        return Array.from(doc.querySelectorAll(selector));
      } catch (e) {
        return [];
      }
    }

    function all(selector) {
      const out = [];
      frameDocuments().forEach(doc => {
        queryAllIn(doc, selector).forEach(el => {
          if (el && out.indexOf(el) === -1) out.push(el);
        });
      });
      return out;
    }

    function first(selector) {
      return all(selector)[0] || null;
    }

    function stripEmoji(text) {
      return String(text || '')
        .replace(/[\\uD800-\\uDBFF][\\uDC00-\\uDFFF]/g, '')
        .replace(/[\\u2600-\\u27BF]/g, '')
        .trim();
    }

    function normalizeText(text) {
      return stripEmoji(text).replace(/\\s+/g, ' ').toLocaleLowerCase();
    }

    function clickSynthetic(el) {
      if (!el) return false;
      const win = (el.ownerDocument && el.ownerDocument.defaultView) || window;
      try { el.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch (e) {}
      try { el.dispatchEvent(new win.FocusEvent('focusin', { bubbles: true, cancelable: true, view: win })); } catch (e) {}
      try { if (typeof el.focus === 'function') el.focus(); } catch (e) {}
      const init = { bubbles: true, cancelable: true, view: win };
      const pointerInit = Object.assign({}, init, { pointerId: 1, pointerType: 'mouse', isPrimary: true });
      try { el.dispatchEvent(new win.PointerEvent('pointerdown', pointerInit)); } catch (e) {}
      try { el.dispatchEvent(new win.MouseEvent('mousedown', init)); } catch (e) {}
      try { el.dispatchEvent(new win.PointerEvent('pointerup', pointerInit)); } catch (e) {}
      try { el.dispatchEvent(new win.MouseEvent('mouseup', init)); } catch (e) {}
      try { el.click(); } catch (e) {}
      return true;
    }

    function clickLikeAkaBizFacebookJs(el) {
      if (!el) return false;
      const win = (el.ownerDocument && el.ownerDocument.defaultView) || window;
      try { el.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch (e) {}
      try { if (typeof el.focus === 'function') el.focus(); } catch (e) {}
      let event = new win.MouseEvent('mousedown', {
        view: win,
        bubbles: true,
        cancelable: true,
        clientX: 10,
        clientY: 10
      });
      el.dispatchEvent(event);
      event = new win.MouseEvent('mouseup', {
        view: win,
        bubbles: true,
        cancelable: true,
        clientX: 10,
        clientY: 10
      });
      el.dispatchEvent(event);
      return true;
    }

    function clickSearchResult(match) {
      if (!match) return { ok: false, clickedTag: '', clickedText: '' };
      clickLikeAkaBizFacebookJs(match);
      return {
        ok: true,
        clickedTag: String(match.tagName || ''),
        clickedText: String(match.innerText || match.textContent || '').trim().slice(0, 120)
      };
    }

    function setNativeValue(el, value) {
      const win = (el.ownerDocument && el.ownerDocument.defaultView) || window;
      const proto = el.tagName === 'TEXTAREA'
        ? win.HTMLTextAreaElement.prototype
        : el.tagName === 'INPUT'
          ? win.HTMLInputElement.prototype
          : null;
      const descriptor = proto ? Object.getOwnPropertyDescriptor(proto, 'value') : null;
      if (descriptor && descriptor.set) descriptor.set.call(el, value);
      else el.value = value;
    }

    function setText(el, text) {
      if (!el) return false;
      const win = (el.ownerDocument && el.ownerDocument.defaultView) || window;
      try { el.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch (e) {}
      try { if (typeof el.focus === 'function') el.focus(); } catch (e) {}
      const tag = String(el.tagName || '').toUpperCase();
      if (tag === 'INPUT' || tag === 'TEXTAREA') {
        setNativeValue(el, String(text || ''));
        el.dispatchEvent(new win.InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: String(text || '') }));
        el.dispatchEvent(new win.Event('change', { bubbles: true, cancelable: true }));
        return true;
      }
      try {
        el.textContent = '';
        win.document.execCommand('insertText', false, String(text || ''));
      } catch (e) {
        el.textContent = String(text || '');
      }
      el.dispatchEvent(new win.InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: String(text || '') }));
      return true;
    }

    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

    async function deleteContent(el) {
      if (!el) return false;
      const doc = el.ownerDocument || document;
      try { if (typeof el.focus === 'function') el.focus(); } catch (e) {}
      await sleep(500);
      doc.execCommand('selectAll', false, null);
      doc.execCommand('delete', false, null);
      return true;
    }

    function dispatchPaste(el, content) {
      if (!el) return false;
      const win = (el.ownerDocument && el.ownerDocument.defaultView) || window;
      const dataTransfer = new win.DataTransfer();
      dataTransfer.setData('text/plain', String(content || ''));
      const pasteEvent = new win.ClipboardEvent('paste', {
        clipboardData: dataTransfer,
        bubbles: true,
        cancelable: true
      });
      el.dispatchEvent(pasteEvent);
      dataTransfer.clearData();
      return true;
    }

    if (action === 'clickFirst') {
      const el = first(payload.selector);
      return { ok: clickSynthetic(el), found: !!el };
    }

    if (action === 'setSearchText') {
      const el = first(payload.selector);
      if (!el) return { ok: false, found: false };
      setText(el, stripEmoji(payload.text || ''));
      return { ok: true, found: true };
    }

    if (action === 'clickExactSearchResult') {
      const wanted = normalizeText(payload.name || '');
      const items = all(payload.selector);
      const match = items.find(el => normalizeText(el.innerText || el.textContent || '') === wanted) || null;
      const clickResult = clickSearchResult(match);
      return { ok: clickResult.ok, found: !!match, count: items.length, clickedTag: clickResult.clickedTag, clickedText: clickResult.clickedText };
    }

    if (action === 'setMessageText') {
      const primary = first(payload.selector);
      const el = primary || first(payload.fallbackSelector);
      if (!el) return { ok: false, found: false };
      await deleteContent(el);
      dispatchPaste(el, payload.text || '');
      return { ok: true, found: true, selector: primary ? payload.selector : payload.fallbackSelector };
    }

    if (action === 'firstAvailableInputSelector') {
      if (first(payload.selector)) return { ok: true, selector: payload.selector };
      if (first(payload.fallbackSelector)) return { ok: true, selector: payload.fallbackSelector };
      return { ok: false, selector: '' };
    }

    if (action === 'exists') {
      return { ok: !!first(payload.selector) };
    }

    if (action === 'readText') {
      const el = first(payload.selector);
      return { ok: !!el, text: el ? String(el.innerText || el.textContent || '').trim() : '' };
    }

    if (action === 'clickSend') {
      const el = first(payload.selector);
      if (!el) return { ok: false, found: false };
      clickSynthetic(el);
      return { ok: true, found: true };
    }

    return { ok: false, error: 'Unknown action' };
  `, { action, payload })
}

helpers.log('Đang tìm khách trong inbox page: ' + customerName)
await dom('clickFirst', { selector: searchButtonXpath }).catch(() => null)
await helpers.sleep(stepMs + 1000, signal)

const searched = await dom('setSearchText', { selector: searchInputXpath, text: customerName })
if (!searched || searched.found !== true) {
  throw new Error('Lỗi khi nhập tên vào ô tìm kiếm')
}
await helpers.sleep(stepMs + 3000, signal)

const searchResult = await dom('clickExactSearchResult', { selector: searchResultXpath, name: customerName })
if (!searchResult || searchResult.found !== true) {
  return { ok: false, error: 'Không tìm thấy khách hàng trong inbox page', reason: 'not_found', customerName, customerPsid }
}
await helpers.sleep(3000, signal)

await dom('clickFirst', { selector: conversationResultXpath }).catch(() => null)
await helpers.sleep(3000, signal)

await dom('clickFirst', { selector: closeButtonXpath }).catch(() => null)
await helpers.sleep(2000, signal)

const clearSearch = await dom('clickFirst', { selector: searchClearXpath }).catch(() => null)
await helpers.sleep(2000, signal)

const headerName = await dom('readText', { selector: headerNameXpath })
if (headerName && headerName.text && !isSameInboxName(headerName.text, customerName)) {
  await helpers.sleep(stepMs + 1000, signal)
  const recheckedHeaderName = await dom('readText', { selector: headerNameXpath })
  if (recheckedHeaderName && recheckedHeaderName.text && !isSameInboxName(recheckedHeaderName.text, customerName)) {
    return {
      ok: false,
      error: 'Không tìm thấy đúng khách hàng trong inbox page',
      reason: 'wrong_conversation',
      customerName,
      customerPsid,
      openedName: recheckedHeaderName.text
    }
  }
}

const typed = await dom('setMessageText', {
  selector: messageInputXpath,
  fallbackSelector: messageInputFallbackXpath,
  text: message
})
if (!typed || typed.found !== true) {
  throw new Error('Không tìm thấy ô để nhập tin nhắn')
}
await helpers.sleep(stepMs + 1000, signal)

if (images.length > 0) {
  const inputSelector = await dom('firstAvailableInputSelector', {
    selector: messageInputXpath,
    fallbackSelector: messageInputFallbackXpath
  })
  const dropSelector = String(inputSelector.selector || messageInputXpath)
  if (typeof page.dropFileDeep === 'function') {
    await page.dropFileDeep(dropSelector, images)
  } else {
    await page.dropFile(dropSelector, images)
  }
  await helpers.sleep(stepMs + 5000, signal)

  const start = Date.now()
  while (Date.now() - start <= 60000) {
    const disabled = await dom('exists', { selector: sendDisabledXpath })
    if (!disabled || disabled.ok !== true) break
    await helpers.sleep(1000, signal)
  }
  const stillDisabled = await dom('exists', { selector: sendDisabledXpath })
  if (stillDisabled && stillDisabled.ok === true) {
    return { ok: false, error: 'Upload ảnh quá lâu', reason: 'upload_timeout', customerName, customerPsid, imageCount: images.length }
  }
}

const sent = await dom('clickSend', { selector: sendButtonXpath })
if (!sent || sent.found !== true) {
  throw new Error('Không tìm thấy nút gửi tin nhắn')
}
await helpers.sleep(stepMs + 2000, signal)

const failed = await dom('exists', { selector: sendFailSelector })
if (failed && failed.ok === true) {
  return { ok: false, error: 'Facebook không cho gửi tin nhắn đến khách này', reason: 'send_failed', customerName, customerPsid, imageCount: images.length }
}

return { ok: true, customerName, customerPsid, imageCount: images.length }
$ai_block_8_code$),
  ($ai_block_9_name$fb_rewrite_source_content_ai$ai_block_9_name$, $ai_block_9_code$// Centralized AI chat/check via ai_using.
const __aiChatUsingCode = "fb_rewrite_source_content_ai";
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
const __callAIChatContent = async (question) => {
  const text = String(question || '');
  return await __callAIText(__aiChatUsingCode, {
    question: text,
    content: text,
    source: 'aka_agent'
  });
};


const toText = (value) => value === undefined || value === null ? '' : String(value)
const trimText = (value) => toText(value).trim()
const pickText = (...values) => {
  for (const value of values) {
    const text = trimText(value)
    if (text) return text
  }
  return ''
}
const pickPayloadValue = (obj, lowerKey, upperKey) => {
  if (!obj || typeof obj !== 'object') return undefined
  if (Object.prototype.hasOwnProperty.call(obj, lowerKey)) return obj[lowerKey]
  if (Object.prototype.hasOwnProperty.call(obj, upperKey)) return obj[upperKey]
  return undefined
}
const extractAiText = (value) => {
  if (typeof value === 'string') return value.trim()
  if (!value || typeof value !== 'object') return ''
  return pickText(
    value.content,
    value.Content,
    value.answer,
    value.Answer,
    value.text,
    value.Text,
    value.result,
    value.Result,
    value.message,
    value.Message
  )
}
const stripManualContent = (combined, manual) => {
  const source = trimText(combined)
  const suffix = trimText(manual)
  if (!source || !suffix || source === suffix) return ''
  const idx = source.lastIndexOf(suffix)
  if (idx < 0) return ''
  return (source.slice(0, idx) + source.slice(idx + suffix.length))
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
const buildFinalContent = (combined, originalSource, rewrittenSource, manualContent) => {
  const current = trimText(combined)
  const source = trimText(originalSource)
  const rewritten = trimText(rewrittenSource)
  const manual = trimText(manualContent)
  if (!rewritten) return current
  if (current && source && current.includes(source)) {
    return current.replace(source, rewritten).trim()
  }
  return [rewritten, manual].filter(Boolean).join('\n\n')
}

if (vars.copyContentFromSource !== true || vars.rewriteSourceContentWithAI !== true) {
  return input
}

const rawPrompt = trimText(vars.sourceContentAiPrompt || input.sourceContentAiPrompt)
if (!rawPrompt) {
  helpers.log('Cảnh báo: Chưa có lời nhắc AI cho nội dung nguồn, dùng nội dung copy gốc.')
  return input
}

const originalCampaignContent = trimText(vars.originalCampaignContent || vars.campaignContent)
const combinedContent = pickText(input.campaignContent, vars.campaignContent, input.content)
let sourceContent = pickText(
  input.sourceContent,
  input.scrapedContent,
  input.scrapedText,
  input.copiedSourceContent,
  input.copiedContent,
  input.postText,
  input.text
)

if (!sourceContent) {
  sourceContent = stripManualContent(combinedContent, originalCampaignContent) || trimText(combinedContent)
}

if (!sourceContent) {
  helpers.log('Cảnh báo: Không lấy được nội dung nguồn để gửi AI, tiếp tục với nội dung copy gốc.')
  return input
}

const question = /\[content\]/i.test(rawPrompt)
  ? rawPrompt.replace(/\[content\]/gi, sourceContent)
  : rawPrompt + '\nNội dung: ' + sourceContent

try {
  const rewrittenSourceContent = await __callAIChatContent(question)
  if (!rewrittenSourceContent) {
    throw new Error('AI trả về nội dung nguồn không hợp lệ.')
  }

  const finalContent = buildFinalContent(combinedContent, sourceContent, rewrittenSourceContent, originalCampaignContent)
  vars.campaignContent = finalContent
  if (Array.isArray(input.images) && input.images.length > 0 && vars.includeSourceImages === true) {
    vars.images = input.images
  }

  helpers.log('Đã edit nội dung nguồn bằng AI')
  return {
    ...input,
    sourceContent: rewrittenSourceContent,
    scrapedContent: rewrittenSourceContent,
    scrapedText: rewrittenSourceContent,
    copiedSourceContent: rewrittenSourceContent,
    content: finalContent,
    campaignContent: finalContent,
    rewrittenSourceContentWithAI: true
  }
} catch (e) {
  if (signal && signal.aborted) throw e
  const message = e && e.message ? String(e.message) : String(e)
  helpers.log('Cảnh báo: AI edit nội dung nguồn lỗi, dùng nội dung copy gốc: ' + message)
  return {
    ...input,
    rewrittenSourceContentWithAI: false,
    sourceContentAiError: message
  }
}
$ai_block_9_code$),
  ($ai_block_10_name$fb_newsfeed_check_like$ai_block_10_name$, $ai_block_10_code$// Centralized AI chat/check via ai_using.
const __aiChatUsingCode = "fb_newsfeed_check_like";
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
const __callAIChatContent = async (question) => {
  const text = String(question || '');
  return await __callAIText(__aiChatUsingCode, {
    question: text,
    content: text,
    source: 'aka_agent'
  });
};


const state = vars.newsfeedState || {}
const post = state.currentPost || {}
if (input.hasPost !== true || input.readablePost !== true || state.remainingLike <= 0) return { shouldLike: false }
if (!state.likeKind) {
  state.remainingLike = 0
  return { shouldLike: false }
}
const postContent = String(post.postContent || '').trim()
if (!postContent) return { shouldLike: false }

try {
  const question = 'Bài viết sau có tính chất "' + state.likeKind + '" không? Chỉ trả lời có hoặc không.\\n\\n' + postContent
  const data = await __callAIChatContent(question)
  const text = String(data || '').toLowerCase()
  const isNegative = text.includes('không') || text.includes('khong') || text.includes('no') || text.includes('false') || text.includes('không phù hợp') || text.includes('khong phu hop')
  const ok = !isNegative && (text.includes('có') || text.includes('yes') || text.includes('true') || text.includes('đúng') || text.includes('dung') || text.includes('phù hợp') || text.includes('phu hop'))
  return { shouldLike: ok, likeAiText: String(data || '') }
} catch (e) {
  helpers.log('AI check like newsfeed lỗi, bỏ qua like: ' + (e && e.message ? e.message : String(e)))
  return { shouldLike: false }
}
$ai_block_10_code$),
  ($ai_block_11_name$fb_newsfeed_check_comment$ai_block_11_name$, $ai_block_11_code$// Centralized AI chat/check via ai_using.
const __aiChatUsingCode = "fb_newsfeed_check_comment";
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
const __callAIChatContent = async (question) => {
  const text = String(question || '');
  return await __callAIText(__aiChatUsingCode, {
    question: text,
    content: text,
    source: 'aka_agent'
  });
};


const state = vars.newsfeedState || {}
const post = state.currentPost || {}
if (!post || post.readablePost !== true || state.remainingComment <= 0) return { shouldComment: false }
if (!state.commentKind) {
  state.remainingComment = 0
  return { shouldComment: false }
}
const postContent = String(post.postContent || '').trim()
if (!postContent) return { shouldComment: false }

async function aiChat(question) {
  return await __callAIChatContent(question)
}

let shouldComment = false
try {
  const checkQuestion = 'Bài viết sau có tính chất "' + state.commentKind + '" không? Chỉ trả lời có hoặc không.\\n\\n' + postContent
  const checkText = (await aiChat(checkQuestion)).toLowerCase()
  const isNegative = checkText.includes('không') || checkText.includes('khong') || checkText.includes('no') || checkText.includes('false') || checkText.includes('không phù hợp') || checkText.includes('khong phu hop')
  shouldComment = !isNegative && (checkText.includes('có') || checkText.includes('yes') || checkText.includes('true') || checkText.includes('đúng') || checkText.includes('dung') || checkText.includes('phù hợp') || checkText.includes('phu hop'))
} catch (e) {
  helpers.log('AI check comment newsfeed lỗi, bỏ qua comment: ' + (e && e.message ? e.message : String(e)))
  return { shouldComment: false }
}
if (!shouldComment) return { shouldComment: false }

const variants = helpers.splitVariants(String(state.commentContent || ''))
let text = helpers.cycleVariant(variants, Number(state.commentDone || 0))
if (state.commentUseAI === true) {
  try {
    const rawPrompt = String(state.commentContent || '')
      .replace(/\[post\]/gi, postContent)
      .replace(/\[name_post\]/gi, String(post.targetName || ''))
    const prompt = rawPrompt.trim() || ('Viết một bình luận ngắn, tự nhiên cho bài viết sau:\\n' + postContent)
    const aiText = (await aiChat(prompt)).trim()
    if (aiText) text = aiText
  } catch (e) {
    helpers.log('AI tạo comment newsfeed lỗi, dùng nội dung dự phòng: ' + (e && e.message ? e.message : String(e)))
  }
}
if (!String(text || '').trim()) {
  const fallback = ['❤', '👍', '👋']
  text = fallback[helpers.randomBetween(0, fallback.length - 1)]
}
state.commentText = text
return { shouldComment: true, text }
$ai_block_11_code$),
  ($ai_block_12_name$fb_extract_data_from_group_posts$ai_block_12_name$, $ai_block_12_code$// Centralized AI find-data filter via ai_using.
const __aiFindDataUsingCode = "fb_extract_data_from_group_posts_ai_filter";
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
const __splitMeaningTraits = (prompt) => {
  const lines = String(prompt || '')
    .split(/\r?\n/)
    .map(line => line.replace(/^\s*(?:[-*\u2022]|\d+[.)])\s*/, '').trim())
    .filter(Boolean);
  return lines.length > 0 ? lines : [String(prompt || '').trim()].filter(Boolean);
};
const __extractJsonText = (raw) => {
  const trimmed = String(raw || '').trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const text = (fenced ? fenced[1] : trimmed).trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  return start >= 0 && end > start ? text.slice(start, end + 1) : text;
};
helpers.checkFindDataMeaningAI = async (options = {}) => {
  const prompt = String(options.prompt || '').trim();
  const contentText = String(options.contentText || '').trim();
  const entityType = String(options.entityType || 'content').trim() || 'content';
  const traits = __splitMeaningTraits(prompt);
  const criteria = traits.map((trait, index) => (index + 1) + '. ' + trait).join('\n');
  const result = await __callCentralAI(__aiFindDataUsingCode, {
    prompt,
    criteria,
    entity_type: entityType,
    entityType,
    content: JSON.stringify(contentText),
    contentText
  });
  const rawResult = __extractAIText(result && (result.content ?? result.data ?? result.text ?? result.output ?? result.response ?? result.rawResponse ?? result));
  let matched = false;
  let reason = '';
  try {
    const parsed = JSON.parse(__extractJsonText(rawResult));
    matched = parsed.matched === true || parsed.match === true || String(parsed.result || parsed.checkResult || '').toLowerCase() === 'matched';
    reason = String(parsed.reason || parsed.explanation || parsed.message || '').trim();
  } catch {
    const normalized = rawResult.toLowerCase();
    matched = normalized.includes('matched') || normalized.includes('true') || normalized.includes('phù hợp') || normalized.includes('phu hop') || normalized.includes('có');
    reason = rawResult.slice(0, 500);
  }
  return {
    ok: true,
    matched,
    checkResult: matched ? 'matched' : 'not_matched',
    prompt,
    finalPrompt: '',
    rawResult,
    reason,
    provider: result.provider || '',
    model: result.model || ''
  };
};


function ensureResults() {
  if (!vars.findDataResults || typeof vars.findDataResults !== 'object') {
    vars.findDataResults = {};
  }
  const results = vars.findDataResults;
  if (!Array.isArray(results.phones)) results.phones = [];
  if (!Array.isArray(results.linkGroupZalos)) results.linkGroupZalos = [];
  if (!Array.isArray(results.uids)) results.uids = [];
  if (!Array.isArray(results.postLinks)) results.postLinks = [];
  if (!Array.isArray(results.groupMembers)) results.groupMembers = [];
  if (!results.sourceData || typeof results.sourceData !== 'object') results.sourceData = {};
  if (!results.sourceData.post || typeof results.sourceData.post !== 'object') results.sourceData.post = {};
  if (!Array.isArray(results.sourceData.post.phones)) results.sourceData.post.phones = [];
  if (!Array.isArray(results.sourceData.post.linkGroupZalos)) results.sourceData.post.linkGroupZalos = [];
  if (!Array.isArray(results.sourceData.post.uids)) results.sourceData.post.uids = [];
  if (!Array.isArray(results.sourceData.post.postLinks)) results.sourceData.post.postLinks = [];
  if (!results.sourceData.newInteractors || typeof results.sourceData.newInteractors !== 'object') results.sourceData.newInteractors = {};
  if (!Array.isArray(results.sourceData.newInteractors.uids)) results.sourceData.newInteractors.uids = [];
  return results;
}

function normalizeKeywordText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}
function keywordList() {
  return String(vars.keywords || '')
    .split(',')
    .map(x => normalizeKeywordText(x.trim()))
    .filter(Boolean);
}

function matchesContent(text) {
  if (!vars.isFindByKeywords) return true;
  const words = keywordList();
  if (words.length === 0) return true;
  const haystack = normalizeKeywordText(text);
  return words.some(word => haystack.includes(word));
}

function isMeaningAiEnabled() {
  return vars.isFindByContentAI === true && String(vars.contentAI || '').trim().length > 0;
}

function createEmptyMeaningAiCheck() {
  return {
    ok: true,
    matched: true,
    checkResult: '',
    prompt: String(vars.contentAI || ''),
    finalPrompt: '',
    rawResult: '',
    reason: '',
    error: ''
  };
}

function normalizeMeaningAiCheck(result) {
  if (result && result.unsupported) {
    return {
      ok: false,
      matched: false,
      checkResult: 'error',
      prompt: String(vars.contentAI || ''),
      finalPrompt: '',
      rawResult: '',
      reason: 'Runtime chưa hỗ trợ helper checkFindDataMeaningAI',
      error: 'Runtime chưa hỗ trợ helper checkFindDataMeaningAI'
    };
  }
  const raw = result && typeof result === 'object' ? result : {};
  const checkResult = String(raw.checkResult || raw.check_result || (raw.ok === true ? (raw.matched === true ? 'matched' : 'not_matched') : 'error'));
  return {
    ok: raw.ok === true,
    matched: raw.matched === true,
    checkResult,
    prompt: String(raw.prompt || vars.contentAI || ''),
    finalPrompt: String(raw.finalPrompt || raw.final_prompt || ''),
    rawResult: String(raw.rawResult || raw.raw_result || ''),
    reason: String(raw.reason || raw.error || ''),
    error: String(raw.error || '')
  };
}

async function checkMeaningAi(content, entityType) {
  if (!isMeaningAiEnabled()) return createEmptyMeaningAiCheck();
  const result = await helpers.checkFindDataMeaningAI({
    contentText: String(content || ''),
    prompt: String(vars.contentAI || ''),
    entityType
  });
  return normalizeMeaningAiCheck(result);
}

function isMeaningAiAccepted(aiCheck) {
  return !isMeaningAiEnabled() || (aiCheck && aiCheck.ok === true && aiCheck.matched === true);
}

function isMeaningAiFailed(aiCheck) {
  return isMeaningAiEnabled() && (!aiCheck || aiCheck.ok !== true);
}

function getMeaningAiMessage(aiCheck) {
  if (isMeaningAiFailed(aiCheck)) return 'Lỗi kiểm tra ý nghĩa AI: ' + String(aiCheck && (aiCheck.error || aiCheck.reason) ? (aiCheck.error || aiCheck.reason) : 'Không rõ nguyên nhân');
  if (isMeaningAiEnabled() && aiCheck && aiCheck.matched !== true) return 'Không đúng ý nghĩa AI';
  return 'Đúng ý nghĩa AI';
}

function buildFilterData(matchedKeyword, aiCheck) {
  const keywordEnabled = vars.isFindByKeywords === true && String(vars.keywords || '').trim().length > 0;
  const rawResult = String(aiCheck && aiCheck.rawResult ? aiCheck.rawResult : '');
  const reason = String(aiCheck && aiCheck.reason ? aiCheck.reason : '');
  return {
    keywordEnabled,
    keyword: keywordEnabled ? String(vars.keywords || '') : null,
    matchedKeyword: keywordEnabled ? matchedKeyword : null,
    aiPrompt: String(vars.contentAI || '') || null,
    aiFinalPrompt: String(aiCheck && aiCheck.finalPrompt ? aiCheck.finalPrompt : ''),
    aiRawResult: rawResult,
    aiCheckResult: String(aiCheck && aiCheck.checkResult ? aiCheck.checkResult : ''),
    aiMatched: aiCheck && typeof aiCheck.matched === 'boolean' ? aiCheck.matched : null,
    aiReason: reason || null,
    aiResult: rawResult || null
  };
}


function normalizePhone(value) {
  const raw = String(value || '').trim();
  const compact = raw.replace(/[\s.\-]/g, '');
  let digits = compact.replace(/[^\d+]/g, '');
  if (digits.startsWith('+84')) digits = '0' + digits.slice(3);
  else if (digits.startsWith('84')) digits = '0' + digits.slice(2);
  digits = digits.replace(/\D/g, '');
  if (/^0[35789]\d{8}$/.test(digits)) return digits;
  return '';
}

function findPhones(text) {
  const matches = String(text || '').match(/(?:\+84|84|0)[\s.\-]?[35789](?:[\s.\-]?\d){8}\b/g) || [];
  return matches.map(normalizePhone).filter(Boolean);
}

function findZaloLinks(text) {
  const matches = String(text || '').match(/(?:https?:\/\/)?zalo\.me\/g\/[a-z0-9]+/gi) || [];
  return matches.map(x => x.trim()).filter(Boolean);
}

function unique(arr) {
  return Array.from(new Set((arr || []).map(x => String(x || '').trim()).filter(Boolean)));
}

function authorUidFromItem(item) {
  const rawHref = String(item && item.authorUrl ? item.authorUrl : '').trim();
  const fallbackUid = String(item && item.authorUid ? item.authorUid : '').trim();
  const href = rawHref.toLowerCase();
  if (
    href.includes('/permalink/') ||
    href.includes('/posts/') ||
    href.includes('story_fbid=') ||
    href.includes('comment_id=') ||
    href.includes('reply_comment_id=') ||
    (href.includes('/groups/') && !href.includes('/user/'))
  ) {
    return '';
  }

  try {
    const url = new URL(rawHref, 'https://www.facebook.com');
    const id = url.searchParams.get('id');
    if (id) return id.trim();
    const parts = url.pathname
      .split('/')
      .map(part => {
        try { return decodeURIComponent(part); } catch { return part; }
      })
      .map(part => part.trim())
      .filter(Boolean);
    const userIndex = parts.indexOf('user');
    if (userIndex >= 0 && parts[userIndex + 1]) return parts[userIndex + 1];
    const last = parts[parts.length - 1] || '';
    const blockedLastParts = new Set(['profile.php', 'groups', 'posts', 'permalink', 'story.php', 'photo.php', 'photos', 'watch', 'reel']);
    if (last && !blockedLastParts.has(last.toLowerCase())) return last;
  } catch {}

  return fallbackUid;
}

const results = ensureResults();
const sourcePost = results.sourceData.post;
const sourceNewInteractors = results.sourceData.newInteractors;
const posts = Array.isArray(input.posts) ? input.posts : (Array.isArray(vars.findDataPosts) ? vars.findDataPosts : []);
let matchedPosts = 0;

if (vars.isFindInPost || vars.isFindPostLink || vars.isFindNewInteractors) {
  for (const post of posts) {
    const content = String(post && post.content ? post.content : '');
    const contentMatches = matchesContent(content);
    const meaningAiCheck = (vars.isFindInPost || vars.isFindPostLink) && contentMatches ? await checkMeaningAi(content, 'post') : createEmptyMeaningAiCheck();
    const meaningAiAccepted = isMeaningAiAccepted(meaningAiCheck);
    const postAuthorUidForLog = authorUidFromItem(post);
    const postAuthorNameForLog = String(post && post.authorName ? post.authorName : '').trim();
    const postPhonesForLog = findPhones(content);
    const postZaloLinksForLog = findZaloLinks(content);
    const postLinksForLog = post && post.postLink ? [String(post.postLink)] : [];

    if ((vars.isFindInPost || vars.isFindPostLink) && !contentMatches) {
      await helpers.logRunEvent({
        eventType: 'extract_post_data',
        eventName: 'Lấy thông tin bài post',
        targetType: 'post',
        status: 'skipped',
        isUserVisible: true,
        itemIndex: post && post.index ? post.index : null,
        targetUrl: String(post && post.postLink ? post.postLink : ''),
        message: 'Không chứa keyword',
        extractedData: {
          entity: {
            type: 'post',
            url: String(post && post.postLink ? post.postLink : ''),
            name: postAuthorNameForLog || null,
            uid: postAuthorUidForLog || null,
            contentText: content
          },
          filters: buildFilterData(false, createEmptyMeaningAiCheck()),
          values: {
            phones: postPhonesForLog,
            zaloGroupLinks: postZaloLinksForLog,
            postLinks: postLinksForLog,
            uids: unique([postAuthorUidForLog].filter(Boolean))
          }
        },
        debugData: {
          postIndex: post && post.index ? post.index : null,
          authorName: postAuthorNameForLog,
          authorUrl: String(post && post.authorUrl ? post.authorUrl : ''),
          rawPostLink: String(post && post.rawPostLink ? post.rawPostLink : '')
        }
      });
    }

    if ((vars.isFindInPost || vars.isFindPostLink) && contentMatches && !meaningAiAccepted) {
      await helpers.logRunEvent({
        eventType: 'extract_post_data',
        eventName: 'Lấy thông tin bài post',
        targetType: 'post',
        status: isMeaningAiFailed(meaningAiCheck) ? 'failed' : 'skipped',
        isUserVisible: true,
        itemIndex: post && post.index ? post.index : null,
        targetUrl: String(post && post.postLink ? post.postLink : ''),
        message: getMeaningAiMessage(meaningAiCheck),
        extractedData: {
          entity: {
            type: 'post',
            url: String(post && post.postLink ? post.postLink : ''),
            name: postAuthorNameForLog || null,
            uid: postAuthorUidForLog || null,
            contentText: content
          },
          filters: buildFilterData(true, meaningAiCheck),
          values: {
            phones: postPhonesForLog,
            zaloGroupLinks: postZaloLinksForLog,
            postLinks: postLinksForLog,
            uids: unique([postAuthorUidForLog].filter(Boolean))
          }
        },
        debugData: {
          postIndex: post && post.index ? post.index : null,
          authorName: postAuthorNameForLog,
          authorUrl: String(post && post.authorUrl ? post.authorUrl : ''),
          rawPostLink: String(post && post.rawPostLink ? post.rawPostLink : '')
        }
      });
    }

    if ((vars.isFindInPost || vars.isFindPostLink) && contentMatches && meaningAiAccepted) {
      matchedPosts++;

      if (vars.isFindInPost && vars.isFindPhone) {
        const phones = findPhones(content);
        results.phones.push(...phones);
        sourcePost.phones.push(...phones);
      }
      if (vars.isFindInPost && vars.isFindLinkGroupZalo) {
        const linkGroupZalos = findZaloLinks(content);
        results.linkGroupZalos.push(...linkGroupZalos);
        sourcePost.linkGroupZalos.push(...linkGroupZalos);
      }
      const authorUid = authorUidFromItem(post);
      if (vars.isFindInPost && vars.isFindUid && authorUid) {
        results.uids.push(authorUid);
        sourcePost.uids.push(authorUid);
      }
      if (vars.isFindPostLink && post && post.postLink) {
        results.postLinks.push(String(post.postLink));
        sourcePost.postLinks.push(String(post.postLink));
      }
    }
    const newInteractorUid = authorUidFromItem(post);
    if (vars.isFindNewInteractors && vars.isFindUid && newInteractorUid) {
      results.uids.push(newInteractorUid);
      sourceNewInteractors.uids.push(newInteractorUid);
    }
    const shouldLogPostExtract = ((vars.isFindInPost || vars.isFindPostLink) && contentMatches && meaningAiAccepted) || (vars.isFindNewInteractors && vars.isFindUid && newInteractorUid);
    if (shouldLogPostExtract) {
      await helpers.logRunEvent({
        eventType: 'extract_post_data',
        eventName: 'Lấy thông tin bài post',
        targetType: 'post',
        status: 'success',
        isUserVisible: true,
        itemIndex: post && post.index ? post.index : null,
        targetUrl: String(post && post.postLink ? post.postLink : ''),
        message: 'Đã duyệt bài viết' + (post && post.index ? ' #' + post.index : ''),
        extractedData: {
          entity: {
            type: 'post',
            url: String(post && post.postLink ? post.postLink : ''),
            name: postAuthorNameForLog || null,
            uid: postAuthorUidForLog || newInteractorUid || null,
            contentText: content
          },
          filters: buildFilterData(contentMatches, meaningAiCheck),
          values: {
            phones: postPhonesForLog,
            zaloGroupLinks: postZaloLinksForLog,
            postLinks: postLinksForLog,
            uids: unique([postAuthorUidForLog, newInteractorUid].filter(Boolean))
          }
        },
        debugData: {
          postIndex: post && post.index ? post.index : null,
          authorName: postAuthorNameForLog,
          authorUrl: String(post && post.authorUrl ? post.authorUrl : ''),
          rawPostLink: String(post && post.rawPostLink ? post.rawPostLink : ''),
          source: vars.isFindNewInteractors ? 'new_interactors_or_post' : 'post'
        }
      });
    }
  }
}

results.phones = unique(results.phones);
results.linkGroupZalos = unique(results.linkGroupZalos);
results.uids = unique(results.uids);
results.postLinks = unique(results.postLinks);
sourcePost.phones = unique(sourcePost.phones);
sourcePost.linkGroupZalos = unique(sourcePost.linkGroupZalos);
sourcePost.uids = unique(sourcePost.uids);
sourcePost.postLinks = unique(sourcePost.postLinks);
sourceNewInteractors.uids = unique(sourceNewInteractors.uids);

return {
  matchedPosts,
  phones: results.phones,
  linkGroupZalos: results.linkGroupZalos,
  uids: results.uids,
  postLinks: results.postLinks,
  sourceCounts: {
    post: {
      phones: sourcePost.phones.length,
      linkGroupZalos: sourcePost.linkGroupZalos.length,
      uids: sourcePost.uids.length,
      postLinks: sourcePost.postLinks.length
    },
    newInteractors: {
      uids: sourceNewInteractors.uids.length
    }
  }
};
$ai_block_12_code$),
  ($ai_block_13_name$fb_collect_group_comments$ai_block_13_name$, $ai_block_13_code$// Centralized AI find-data filter via ai_using.
const __aiFindDataUsingCode = "fb_collect_group_comments_ai_filter";
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
const __splitMeaningTraits = (prompt) => {
  const lines = String(prompt || '')
    .split(/\r?\n/)
    .map(line => line.replace(/^\s*(?:[-*\u2022]|\d+[.)])\s*/, '').trim())
    .filter(Boolean);
  return lines.length > 0 ? lines : [String(prompt || '').trim()].filter(Boolean);
};
const __extractJsonText = (raw) => {
  const trimmed = String(raw || '').trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const text = (fenced ? fenced[1] : trimmed).trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  return start >= 0 && end > start ? text.slice(start, end + 1) : text;
};
helpers.checkFindDataMeaningAI = async (options = {}) => {
  const prompt = String(options.prompt || '').trim();
  const contentText = String(options.contentText || '').trim();
  const entityType = String(options.entityType || 'content').trim() || 'content';
  const traits = __splitMeaningTraits(prompt);
  const criteria = traits.map((trait, index) => (index + 1) + '. ' + trait).join('\n');
  const result = await __callCentralAI(__aiFindDataUsingCode, {
    prompt,
    criteria,
    entity_type: entityType,
    entityType,
    content: JSON.stringify(contentText),
    contentText
  });
  const rawResult = __extractAIText(result && (result.content ?? result.data ?? result.text ?? result.output ?? result.response ?? result.rawResponse ?? result));
  let matched = false;
  let reason = '';
  try {
    const parsed = JSON.parse(__extractJsonText(rawResult));
    matched = parsed.matched === true || parsed.match === true || String(parsed.result || parsed.checkResult || '').toLowerCase() === 'matched';
    reason = String(parsed.reason || parsed.explanation || parsed.message || '').trim();
  } catch {
    const normalized = rawResult.toLowerCase();
    matched = normalized.includes('matched') || normalized.includes('true') || normalized.includes('phù hợp') || normalized.includes('phu hop') || normalized.includes('có');
    reason = rawResult.slice(0, 500);
  }
  return {
    ok: true,
    matched,
    checkResult: matched ? 'matched' : 'not_matched',
    prompt,
    finalPrompt: '',
    rawResult,
    reason,
    provider: result.provider || '',
    model: result.model || ''
  };
};

if (vars.isFindInComment !== true && vars.isFindNewInteractors !== true) {
  vars.findDataComments = [];
  return { commentItems: [] };
}

const selectors = {
  posts: await helpers.element('fb_post_in_uid'),
  commentButton: await helpers.element('fb_comment_in_post_btn'),
  mostRelevant: await helpers.element('fb_most_relevant_btn'),
  allComments: await helpers.element('fb_all_comments_btn'),
  newestComments: await helpers.element('fb_newest_comments_btn'),
  dialog: await helpers.element('fb_dialog'),
  commentElement: await helpers.element('fb_cmt_element_full'),
  uidInComment: await helpers.element('fb_uid_in_cmt_element'),
  contentInComment: await helpers.element('fb_content_in_cmt_element'),
  closeDialog: await helpers.element('fb_close_dialog_btn')
};
const postLimit = Math.max(1, Number(vars.countPostFindData || 10));
const commentLimit = Math.max(1, Number(vars.countCommentFindData || 30));
const sortType = String(vars.sortTypeComment || 'most_relevant');

const commentResult = await page.evaluate(`
  const selectors = __args[0];
  const postLimit = __args[1];
  const commentLimit = __args[2];
  const sortType = __args[3];

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function isVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function xpathAll(xpath, root) {
    const out = [];
    if (!xpath) return out;
    try {
      const result = document.evaluate(xpath, root || document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      for (let i = 0; i < result.snapshotLength; i++) out.push(result.snapshotItem(i));
    } catch {}
    return out.filter(Boolean);
  }

  function first(xpath, root) {
    return xpathAll(xpath, root)[0] || null;
  }

  function clickSynthetic(el) {
    if (!el) return false;
    try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch {}
    const init = { bubbles: true, cancelable: true, view: window };
    try { el.dispatchEvent(new PointerEvent('pointerdown', Object.assign({}, init, { pointerId: 1, pointerType: 'mouse' }))); } catch {}
    try { el.dispatchEvent(new MouseEvent('mousedown', init)); } catch {}
    try { el.dispatchEvent(new PointerEvent('pointerup', Object.assign({}, init, { pointerId: 1, pointerType: 'mouse' }))); } catch {}
    try { el.dispatchEvent(new MouseEvent('mouseup', init)); } catch {}
    try { el.click(); return true; } catch {}
    return false;
  }

  async function waitFor(fn, timeoutMs) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const value = fn();
      if (value) return value;
      await delay(300);
    }
    return null;
  }

  function extractUid(href) {
    if (!href) return '';
    try {
      const url = new URL(href, location.href);
      const id = url.searchParams.get('id');
      if (id) return id;
      const parts = url.pathname.split('/').filter(Boolean);
      const userIndex = parts.indexOf('user');
      if (userIndex >= 0 && parts[userIndex + 1]) return parts[userIndex + 1];
      return parts[parts.length - 1] || '';
    } catch {
      return String(href || '').trim();
    }
  }

  function commentContentOf(comment, authorLink, messageXpath) {
    const candidates = xpathAll(messageXpath, comment)
      .filter(isVisible)
      .filter(el => !authorLink || el !== authorLink && !(el.contains && el.contains(authorLink)))
      .map(el => (el.innerText || el.textContent || '').trim())
      .filter(Boolean);
    return candidates[0] || (comment.innerText || comment.textContent || '').trim();
  }

  const rows = [];
  const postCommentStats = [];
  const posts = xpathAll(selectors.posts).slice(0, postLimit);
  for (let p = 0; p < posts.length; p++) {
    const post = posts[p];
    const postStat = {
      postIndex: p + 1,
      opened: false,
      sorted: sortType === 'most_relevant',
      commentsCount: 0,
      error: ''
    };
    try {
      post.scrollIntoView(true);
      await delay(700);
      const button = first(selectors.commentButton, post);
      if (!button) {
        postStat.error = 'Không tìm thấy nút comment';
        continue;
      }
      clickSynthetic(button);
      postStat.opened = true;
      await delay(2000);

      let root = await waitFor(() => first(selectors.dialog, document), 5000);
      if (!root) root = document.documentElement;

      if (sortType !== 'most_relevant') {
        postStat.sorted = false;
        const sortButton = first(selectors.mostRelevant, root) || first(selectors.mostRelevant, document);
        if (sortButton) {
          clickSynthetic(sortButton);
          await delay(800);
          const optionXpath = sortType === 'newest' ? selectors.newestComments : selectors.allComments;
          const option = first(optionXpath, document);
          if (option) {
            clickSynthetic(option);
            postStat.sorted = true;
            await delay(2000);
          } else {
            postStat.error = 'Không tìm thấy lựa chọn sắp xếp comment';
          }
        } else {
          postStat.error = 'Không tìm thấy nút sắp xếp comment';
        }
      }

      let comments = xpathAll(selectors.commentElement, root);
      const startedAt = Date.now();
      let stableCount = 0;
      while (comments.length < commentLimit && Date.now() - startedAt < 90 * 1000 && stableCount < 3) {
        const oldCount = comments.length;
        if (comments.length > 0) comments[comments.length - 1].scrollIntoView(true);
        await delay(1500);
        comments = xpathAll(selectors.commentElement, root);
        stableCount = comments.length <= oldCount ? stableCount + 1 : 0;
      }

      const selectedComments = comments.slice(0, commentLimit);
      postStat.commentsCount = selectedComments.length;
      selectedComments.forEach((comment, i) => {
        const link = first(selectors.uidInComment, comment);
        const href = link ? (link.href || link.getAttribute('href') || '') : '';
        const authorName = link ? (link.innerText || link.textContent || '').trim() : '';
        const content = commentContentOf(comment, link, selectors.contentInComment);
        rows.push({
          postIndex: p + 1,
          commentIndex: i + 1,
          content,
          authorName,
          authorUrl: href,
          authorUid: extractUid(href)
        });
      });
    } catch (err) {
      postStat.error = err && err.message ? err.message : String(err || 'Lỗi mở comment');
    } finally {
      const closeButton = first(selectors.closeDialog, document);
      if (closeButton) {
        clickSynthetic(closeButton);
        await delay(1000);
      }
      postCommentStats.push(postStat);
    }
  }

  return { rows, postCommentStats };
`, selectors, postLimit, commentLimit, sortType);

const commentItems = Array.isArray(commentResult)
  ? commentResult
  : (commentResult && Array.isArray(commentResult.rows) ? commentResult.rows : []);
const commentPostStats = commentResult && Array.isArray(commentResult.postCommentStats)
  ? commentResult.postCommentStats
  : [];
vars.findDataComments = commentItems;
helpers.log('Đã tải ' + vars.findDataComments.length + ' comment trong group');

function ensureResults() {
  if (!vars.findDataResults || typeof vars.findDataResults !== 'object') {
    vars.findDataResults = {};
  }
  const results = vars.findDataResults;
  if (!Array.isArray(results.phones)) results.phones = [];
  if (!Array.isArray(results.linkGroupZalos)) results.linkGroupZalos = [];
  if (!Array.isArray(results.uids)) results.uids = [];
  if (!Array.isArray(results.postLinks)) results.postLinks = [];
  if (!Array.isArray(results.groupMembers)) results.groupMembers = [];
  if (!results.sourceData || typeof results.sourceData !== 'object') results.sourceData = {};
  if (!results.sourceData.comment || typeof results.sourceData.comment !== 'object') results.sourceData.comment = {};
  if (!Array.isArray(results.sourceData.comment.phones)) results.sourceData.comment.phones = [];
  if (!Array.isArray(results.sourceData.comment.linkGroupZalos)) results.sourceData.comment.linkGroupZalos = [];
  if (!Array.isArray(results.sourceData.comment.uids)) results.sourceData.comment.uids = [];
  if (!results.sourceData.newInteractors || typeof results.sourceData.newInteractors !== 'object') results.sourceData.newInteractors = {};
  if (!Array.isArray(results.sourceData.newInteractors.uids)) results.sourceData.newInteractors.uids = [];
  return results;
}

function normalizeKeywordText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}

function keywordList() {
  return String(vars.keywords || '')
    .split(',')
    .map(x => normalizeKeywordText(x.trim()))
    .filter(Boolean);
}

function matchesContent(text) {
  if (!vars.isFindByKeywords) return true;
  const words = keywordList();
  if (words.length === 0) return true;
  const haystack = normalizeKeywordText(text);
  return words.some(word => haystack.includes(word));
}

function isMeaningAiEnabled() {
  return vars.isFindByContentAI === true && String(vars.contentAI || '').trim().length > 0;
}

function createEmptyMeaningAiCheck() {
  return {
    ok: true,
    matched: true,
    checkResult: '',
    prompt: String(vars.contentAI || ''),
    finalPrompt: '',
    rawResult: '',
    reason: '',
    error: ''
  };
}

function normalizeMeaningAiCheck(result) {
  if (result && result.unsupported) {
    return {
      ok: false,
      matched: false,
      checkResult: 'error',
      prompt: String(vars.contentAI || ''),
      finalPrompt: '',
      rawResult: '',
      reason: 'Runtime chưa hỗ trợ helper checkFindDataMeaningAI',
      error: 'Runtime chưa hỗ trợ helper checkFindDataMeaningAI'
    };
  }
  const raw = result && typeof result === 'object' ? result : {};
  const checkResult = String(raw.checkResult || raw.check_result || (raw.ok === true ? (raw.matched === true ? 'matched' : 'not_matched') : 'error'));
  return {
    ok: raw.ok === true,
    matched: raw.matched === true,
    checkResult,
    prompt: String(raw.prompt || vars.contentAI || ''),
    finalPrompt: String(raw.finalPrompt || raw.final_prompt || ''),
    rawResult: String(raw.rawResult || raw.raw_result || ''),
    reason: String(raw.reason || raw.error || ''),
    error: String(raw.error || '')
  };
}

async function checkMeaningAi(content, entityType) {
  if (!isMeaningAiEnabled()) return createEmptyMeaningAiCheck();
  const result = await helpers.checkFindDataMeaningAI({
    contentText: String(content || ''),
    prompt: String(vars.contentAI || ''),
    entityType
  });
  return normalizeMeaningAiCheck(result);
}

function isMeaningAiAccepted(aiCheck) {
  return !isMeaningAiEnabled() || (aiCheck && aiCheck.ok === true && aiCheck.matched === true);
}

function isMeaningAiFailed(aiCheck) {
  return isMeaningAiEnabled() && (!aiCheck || aiCheck.ok !== true);
}

function getMeaningAiMessage(aiCheck) {
  if (isMeaningAiFailed(aiCheck)) return 'Lỗi kiểm tra ý nghĩa AI: ' + String(aiCheck && (aiCheck.error || aiCheck.reason) ? (aiCheck.error || aiCheck.reason) : 'Không rõ nguyên nhân');
  if (isMeaningAiEnabled() && aiCheck && aiCheck.matched !== true) return 'Không đúng ý nghĩa AI';
  return 'Đúng ý nghĩa AI';
}

function buildFilterData(matchedKeyword, aiCheck) {
  const keywordEnabled = vars.isFindByKeywords === true && String(vars.keywords || '').trim().length > 0;
  const rawResult = String(aiCheck && aiCheck.rawResult ? aiCheck.rawResult : '');
  const reason = String(aiCheck && aiCheck.reason ? aiCheck.reason : '');
  return {
    keywordEnabled,
    keyword: keywordEnabled ? String(vars.keywords || '') : null,
    matchedKeyword: keywordEnabled ? matchedKeyword : null,
    aiPrompt: String(vars.contentAI || '') || null,
    aiFinalPrompt: String(aiCheck && aiCheck.finalPrompt ? aiCheck.finalPrompt : ''),
    aiRawResult: rawResult,
    aiCheckResult: String(aiCheck && aiCheck.checkResult ? aiCheck.checkResult : ''),
    aiMatched: aiCheck && typeof aiCheck.matched === 'boolean' ? aiCheck.matched : null,
    aiReason: reason || null,
    aiResult: rawResult || null
  };
}


function normalizePhone(value) {
  const raw = String(value || '').trim();
  const compact = raw.replace(/[\s.\-]/g, '');
  let digits = compact.replace(/[^\d+]/g, '');
  if (digits.startsWith('+84')) digits = '0' + digits.slice(3);
  else if (digits.startsWith('84')) digits = '0' + digits.slice(2);
  digits = digits.replace(/\D/g, '');
  if (/^0[35789]\d{8}$/.test(digits)) return digits;
  return '';
}

function findPhones(text) {
  const matches = String(text || '').match(/(?:\+84|84|0)[\s.\-]?[35789](?:[\s.\-]?\d){8}\b/g) || [];
  return matches.map(normalizePhone).filter(Boolean);
}

function findZaloLinks(text) {
  const matches = String(text || '').match(/(?:https?:\/\/)?zalo\.me\/g\/[a-z0-9]+/gi) || [];
  return matches.map(x => x.trim()).filter(Boolean);
}

function unique(arr) {
  return Array.from(new Set((arr || []).map(x => String(x || '').trim()).filter(Boolean)));
}

function authorUidFromItem(item) {
  const rawHref = String(item && item.authorUrl ? item.authorUrl : '').trim();
  const fallbackUid = String(item && item.authorUid ? item.authorUid : '').trim();
  const href = rawHref.toLowerCase();
  if (
    href.includes('/permalink/') ||
    href.includes('/posts/') ||
    href.includes('story_fbid=') ||
    href.includes('comment_id=') ||
    href.includes('reply_comment_id=') ||
    (href.includes('/groups/') && !href.includes('/user/'))
  ) {
    return '';
  }

  try {
    const url = new URL(rawHref, 'https://www.facebook.com');
    const id = url.searchParams.get('id');
    if (id) return id.trim();
    const parts = url.pathname
      .split('/')
      .map(part => {
        try { return decodeURIComponent(part); } catch { return part; }
      })
      .map(part => part.trim())
      .filter(Boolean);
    const userIndex = parts.indexOf('user');
    if (userIndex >= 0 && parts[userIndex + 1]) return parts[userIndex + 1];
    const last = parts[parts.length - 1] || '';
    const blockedLastParts = new Set(['profile.php', 'groups', 'posts', 'permalink', 'story.php', 'photo.php', 'photos', 'watch', 'reel']);
    if (last && !blockedLastParts.has(last.toLowerCase())) return last;
  } catch {}

  return fallbackUid;
}

const results = ensureResults();
const sourceComment = results.sourceData.comment;
const sourceNewInteractors = results.sourceData.newInteractors;
const commentSourcePosts = Array.isArray(vars.findDataPosts) ? vars.findDataPosts : [];
const commentsByPost = new Map();
for (const comment of vars.findDataComments) {
  const postIndex = Math.max(1, Number(comment && comment.postIndex ? comment.postIndex : 0));
  if (!commentsByPost.has(postIndex)) commentsByPost.set(postIndex, []);
  commentsByPost.get(postIndex).push(comment);
}

const commentLogEvents = [];
let matchedComments = 0;
let globalCommentIndex = 0;

for (const rawStat of commentPostStats) {
  const stat = rawStat && typeof rawStat === 'object' ? rawStat : {};
  const postIndex = Math.max(1, Number(stat.postIndex || 0));
  const commentsCount = Math.max(0, Number(stat.commentsCount || 0));
  const opened = stat.opened === true;
  const sorted = stat.sorted === true;
  const error = String(stat.error || '').trim();
  const sourcePost = commentSourcePosts[postIndex - 1] || {};
  const postUrl = String(sourcePost && sourcePost.postLink ? sourcePost.postLink : '');
  const commentsForPost = commentsByPost.get(postIndex) || [];

  commentLogEvents.push({
    eventType: 'open_comments',
    eventName: 'Mở comment',
    targetType: 'comment',
    status: opened ? 'success' : 'skipped',
    isUserVisible: false,
    xpath: selectors.commentButton,
    itemIndex: postIndex,
    targetUrl: postUrl,
    message: opened ? 'Đã mở comment của bài post #' + postIndex : 'Bỏ qua mở comment của bài post #' + postIndex,
    debugData: { postLimit, commentLimit, sortType, postIndex, postUrl, error }
  });

  if (sortType !== 'most_relevant' && opened) {
    commentLogEvents.push({
      eventType: 'sort_comments',
      eventName: 'Sắp xếp comment',
      targetType: 'comment',
      status: sorted ? 'success' : 'failed',
      isUserVisible: false,
      itemIndex: postIndex,
      targetUrl: postUrl,
      message: sorted ? 'Đã đổi sắp xếp comment của bài post #' + postIndex : (error || 'Không sắp xếp được comment của bài post #' + postIndex),
      debugData: {
        sortType,
        postIndex,
        postUrl,
        error,
        selectors: {
          sortButton: selectors.mostRelevant,
          allComments: selectors.allComments,
          newestComments: selectors.newestComments
        }
      }
    });
  }

  commentLogEvents.push({
    eventType: 'collect_comments',
    eventName: 'Lấy danh sách comment',
    targetType: 'comment',
    status: opened ? 'success' : 'skipped',
    isUserVisible: true,
    xpath: selectors.commentElement,
    elementCount: commentsCount,
    itemIndex: postIndex,
    targetUrl: postUrl,
    message: 'Bài post #' + postIndex + ': lấy được ' + commentsCount + ' comment',
    debugData: { postLimit, commentLimit, sortType, postIndex, postUrl, error }
  });

  for (const comment of commentsForPost) {
    globalCommentIndex++;
    const content = String(comment && comment.content ? comment.content : '');
    const contentMatches = matchesContent(content);
    const meaningAiCheck = vars.isFindInComment && contentMatches ? await checkMeaningAi(content, 'comment') : createEmptyMeaningAiCheck();
    const meaningAiAccepted = isMeaningAiAccepted(meaningAiCheck);
    const commentAuthorUidForLog = authorUidFromItem(comment);
    const commentAuthorNameForLog = String(comment && comment.authorName ? comment.authorName : '').trim();
    const commentPhonesForLog = findPhones(content);
    const commentZaloLinksForLog = findZaloLinks(content);
    const commentPostLinksForLog = postUrl ? [postUrl] : [];

    if (vars.isFindInComment && contentMatches && !meaningAiAccepted) {
      commentLogEvents.push({
        eventType: 'extract_comment_data',
        eventName: 'Lấy thông tin comment',
        targetType: 'comment',
        status: isMeaningAiFailed(meaningAiCheck) ? 'failed' : 'skipped',
        isUserVisible: true,
        itemIndex: Math.max(1, Number(comment && comment.commentIndex ? comment.commentIndex : 0)),
        targetUrl: String(comment && comment.authorUrl ? comment.authorUrl : ''),
        message: getMeaningAiMessage(meaningAiCheck),
        extractedData: {
          entity: {
            type: 'comment',
            url: String(comment && comment.authorUrl ? comment.authorUrl : ''),
            name: String(comment && comment.authorName ? comment.authorName : '').trim() || null,
            uid: authorUidFromItem(comment) || null,
            contentText: content
          },
          filters: buildFilterData(true, meaningAiCheck),
          values: {
            phones: findPhones(content),
            zaloGroupLinks: findZaloLinks(content),
            postLinks: postUrl ? [postUrl] : [],
            uids: unique([authorUidFromItem(comment)].filter(Boolean))
          }
        },
        debugData: {
          postIndex,
          commentIndexInPost: Math.max(1, Number(comment && comment.commentIndex ? comment.commentIndex : 0)),
          postUrl,
          authorName: String(comment && comment.authorName ? comment.authorName : '').trim(),
          authorUrl: String(comment && comment.authorUrl ? comment.authorUrl : '')
        }
      });
    }

    if (vars.isFindInComment && contentMatches && meaningAiAccepted) {
      matchedComments++;
      if (vars.isFindPhone) {
        results.phones.push(...commentPhonesForLog);
        sourceComment.phones.push(...commentPhonesForLog);
      }
      if (vars.isFindLinkGroupZalo) {
        results.linkGroupZalos.push(...commentZaloLinksForLog);
        sourceComment.linkGroupZalos.push(...commentZaloLinksForLog);
      }
      if (vars.isFindUid && commentAuthorUidForLog) {
        results.uids.push(commentAuthorUidForLog);
        sourceComment.uids.push(commentAuthorUidForLog);
      }
    }

    const newInteractorUid = authorUidFromItem(comment);
    if (vars.isFindNewInteractors && vars.isFindUid && newInteractorUid) {
      results.uids.push(newInteractorUid);
      sourceNewInteractors.uids.push(newInteractorUid);
    }

    const shouldLogCommentSuccess = (vars.isFindInComment && contentMatches && meaningAiAccepted) || (vars.isFindNewInteractors && vars.isFindUid && newInteractorUid);
    const commentIndexInPost = Math.max(1, Number(comment && comment.commentIndex ? comment.commentIndex : 0));
    const authorUrl = String(comment && comment.authorUrl ? comment.authorUrl : '');

    if (shouldLogCommentSuccess) {
      commentLogEvents.push({
        eventType: 'extract_comment_data',
        eventName: 'Lấy thông tin comment',
        targetType: 'comment',
        status: 'success',
        isUserVisible: true,
        itemIndex: commentIndexInPost,
        targetUrl: authorUrl,
        message: 'Đã duyệt comment #' + commentIndexInPost,
        extractedData: {
          entity: {
            type: 'comment',
            url: authorUrl,
            name: commentAuthorNameForLog || null,
            uid: commentAuthorUidForLog || newInteractorUid || null,
            contentText: content
          },
          filters: buildFilterData(contentMatches, meaningAiCheck),
          values: {
            phones: commentPhonesForLog,
            zaloGroupLinks: commentZaloLinksForLog,
            postLinks: commentPostLinksForLog,
            uids: unique([commentAuthorUidForLog, newInteractorUid].filter(Boolean))
          }
        },
        debugData: {
          postIndex,
          commentIndexInPost,
          globalCommentIndex,
          postUrl,
          authorName: commentAuthorNameForLog,
          authorUrl,
          source: vars.isFindNewInteractors ? 'new_interactors_or_comment' : 'comment'
        }
      });
    } else if (vars.isFindInComment && !contentMatches) {
      commentLogEvents.push({
        eventType: 'extract_comment_data',
        eventName: 'Lấy thông tin comment',
        targetType: 'comment',
        status: 'skipped',
        isUserVisible: true,
        itemIndex: commentIndexInPost,
        targetUrl: authorUrl,
        message: 'Không chứa keyword',
        extractedData: {
          entity: {
            type: 'comment',
            url: authorUrl,
            name: commentAuthorNameForLog || null,
            uid: commentAuthorUidForLog || null,
            contentText: content
          },
          filters: buildFilterData(false, createEmptyMeaningAiCheck()),
          values: {
            phones: commentPhonesForLog,
            zaloGroupLinks: commentZaloLinksForLog,
            postLinks: commentPostLinksForLog,
            uids: unique([commentAuthorUidForLog].filter(Boolean))
          }
        },
        debugData: { postIndex, commentIndexInPost, globalCommentIndex, postUrl, authorName: commentAuthorNameForLog, authorUrl }
      });
    }
  }
}

if (commentLogEvents.length === 0) {
  commentLogEvents.push({
    eventType: 'collect_comments',
    eventName: 'Lấy danh sách comment',
    targetType: 'comment',
    status: 'skipped',
    isUserVisible: true,
    xpath: selectors.commentElement,
    elementCount: 0,
    message: 'Không thấy bài post để lấy comment',
    debugData: { postLimit, commentLimit, sortType }
  });
}

results.phones = unique(results.phones);
results.linkGroupZalos = unique(results.linkGroupZalos);
results.uids = unique(results.uids);
sourceComment.phones = unique(sourceComment.phones);
sourceComment.linkGroupZalos = unique(sourceComment.linkGroupZalos);
sourceComment.uids = unique(sourceComment.uids);
sourceNewInteractors.uids = unique(sourceNewInteractors.uids);

commentLogEvents.push({
  eventType: 'collect_comments_summary',
  eventName: 'Tổng kết comment',
  targetType: 'comment',
  status: 'success',
  isUserVisible: true,
  xpath: selectors.commentElement,
  elementCount: vars.findDataComments.length,
  message: 'Tổng cộng lấy được ' + vars.findDataComments.length + ' comment từ ' + commentPostStats.length + ' bài post',
  debugData: { postLimit, commentLimit, sortType, postCount: commentPostStats.length }
});

await helpers.logRunEvents(commentLogEvents);
return {
  commentItems: vars.findDataComments,
  commentPostStats,
  matchedComments,
  phones: results.phones,
  linkGroupZalos: results.linkGroupZalos,
  uids: results.uids,
  sourceCounts: {
    comment: {
      phones: sourceComment.phones.length,
      linkGroupZalos: sourceComment.linkGroupZalos.length,
      uids: sourceComment.uids.length
    },
    newInteractors: {
      uids: sourceNewInteractors.uids.length
    }
  }
};$ai_block_13_code$),
  ($ai_block_14_name$fb_extract_data_from_search_posts$ai_block_14_name$, $ai_block_14_code$// Centralized AI find-data filter via ai_using.
const __aiFindDataUsingCode = "fb_extract_data_from_search_posts_ai_filter";
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
const __splitMeaningTraits = (prompt) => {
  const lines = String(prompt || '')
    .split(/\r?\n/)
    .map(line => line.replace(/^\s*(?:[-*\u2022]|\d+[.)])\s*/, '').trim())
    .filter(Boolean);
  return lines.length > 0 ? lines : [String(prompt || '').trim()].filter(Boolean);
};
const __extractJsonText = (raw) => {
  const trimmed = String(raw || '').trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const text = (fenced ? fenced[1] : trimmed).trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  return start >= 0 && end > start ? text.slice(start, end + 1) : text;
};
helpers.checkFindDataMeaningAI = async (options = {}) => {
  const prompt = String(options.prompt || '').trim();
  const contentText = String(options.contentText || '').trim();
  const entityType = String(options.entityType || 'content').trim() || 'content';
  const traits = __splitMeaningTraits(prompt);
  const criteria = traits.map((trait, index) => (index + 1) + '. ' + trait).join('\n');
  const result = await __callCentralAI(__aiFindDataUsingCode, {
    prompt,
    criteria,
    entity_type: entityType,
    entityType,
    content: JSON.stringify(contentText),
    contentText
  });
  const rawResult = __extractAIText(result && (result.content ?? result.data ?? result.text ?? result.output ?? result.response ?? result.rawResponse ?? result));
  let matched = false;
  let reason = '';
  try {
    const parsed = JSON.parse(__extractJsonText(rawResult));
    matched = parsed.matched === true || parsed.match === true || String(parsed.result || parsed.checkResult || '').toLowerCase() === 'matched';
    reason = String(parsed.reason || parsed.explanation || parsed.message || '').trim();
  } catch {
    const normalized = rawResult.toLowerCase();
    matched = normalized.includes('matched') || normalized.includes('true') || normalized.includes('phù hợp') || normalized.includes('phu hop') || normalized.includes('có');
    reason = rawResult.slice(0, 500);
  }
  return {
    ok: true,
    matched,
    checkResult: matched ? 'matched' : 'not_matched',
    prompt,
    finalPrompt: '',
    rawResult,
    reason,
    provider: result.provider || '',
    model: result.model || ''
  };
};

  function ensureResults() {
    if (!vars.findDataResults || typeof vars.findDataResults !== 'object') vars.findDataResults = {};
    const results = vars.findDataResults;
    if (!Array.isArray(results.phones)) results.phones = [];
    if (!Array.isArray(results.linkGroupZalos)) results.linkGroupZalos = [];
    if (!Array.isArray(results.uids)) results.uids = [];
    if (!Array.isArray(results.postLinks)) results.postLinks = [];
    if (!results.sourceData || typeof results.sourceData !== 'object') results.sourceData = {};
    if (!results.sourceData.post || typeof results.sourceData.post !== 'object') results.sourceData.post = {};
    if (!Array.isArray(results.sourceData.post.phones)) results.sourceData.post.phones = [];
    if (!Array.isArray(results.sourceData.post.linkGroupZalos)) results.sourceData.post.linkGroupZalos = [];
    if (!Array.isArray(results.sourceData.post.uids)) results.sourceData.post.uids = [];
    if (!Array.isArray(results.sourceData.post.postLinks)) results.sourceData.post.postLinks = [];
    return results;
  }
  function normalizeKeywordText(value) {
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
  }
  function keywordList() {
    return String(vars.keywords || '').split(',').map(x => normalizeKeywordText(x.trim())).filter(Boolean);
  }
  function matchesContent(text) {
    if (!vars.isFindByKeywords) return true;
    const words = keywordList();
    if (words.length === 0) return true;
    const haystack = normalizeKeywordText(text);
    return words.some(word => haystack.includes(word));
  }
  function isMeaningAiEnabled() { return vars.isFindByContentAI === true && String(vars.contentAI || '').trim().length > 0; }
  function createEmptyMeaningAiCheck() {
    return { ok: true, matched: true, checkResult: '', prompt: String(vars.contentAI || ''), finalPrompt: '', rawResult: '', reason: '', error: '' };
  }
  function normalizeMeaningAiCheck(result) {
    if (result && result.unsupported) {
      return { ok: false, matched: false, checkResult: 'error', prompt: String(vars.contentAI || ''), finalPrompt: '', rawResult: '', reason: 'Runtime chưa hỗ trợ helper checkFindDataMeaningAI', error: 'Runtime chưa hỗ trợ helper checkFindDataMeaningAI' };
    }
    const raw = result && typeof result === 'object' ? result : {};
    const checkResult = String(raw.checkResult || raw.check_result || (raw.ok === true ? (raw.matched === true ? 'matched' : 'not_matched') : 'error'));
    return { ok: raw.ok === true, matched: raw.matched === true, checkResult, prompt: String(raw.prompt || vars.contentAI || ''), finalPrompt: String(raw.finalPrompt || raw.final_prompt || ''), rawResult: String(raw.rawResult || raw.raw_result || ''), reason: String(raw.reason || raw.error || ''), error: String(raw.error || '') };
  }
  async function checkMeaningAi(content, entityType) {
    if (!isMeaningAiEnabled()) return createEmptyMeaningAiCheck();
    const result = await helpers.checkFindDataMeaningAI({ contentText: String(content || ''), prompt: String(vars.contentAI || ''), entityType });
    return normalizeMeaningAiCheck(result);
  }
  function isMeaningAiAccepted(aiCheck) { return !isMeaningAiEnabled() || (aiCheck && aiCheck.ok === true && aiCheck.matched === true); }
  function isMeaningAiFailed(aiCheck) { return isMeaningAiEnabled() && (!aiCheck || aiCheck.ok !== true); }
  function getMeaningAiMessage(aiCheck) {
    if (isMeaningAiFailed(aiCheck)) return 'Lỗi kiểm tra ý nghĩa AI: ' + String(aiCheck && (aiCheck.error || aiCheck.reason) ? (aiCheck.error || aiCheck.reason) : 'Không rõ nguyên nhân');
    if (isMeaningAiEnabled() && aiCheck && aiCheck.matched !== true) return 'Không đúng ý nghĩa AI';
    return 'Đúng ý nghĩa AI';
  }
  function buildFilterData(matchedKeyword, aiCheck) {
    const keywordEnabled = vars.isFindByKeywords === true && String(vars.keywords || '').trim().length > 0;
    const rawResult = String(aiCheck && aiCheck.rawResult ? aiCheck.rawResult : '');
    const reason = String(aiCheck && aiCheck.reason ? aiCheck.reason : '');
    return { keywordEnabled, keyword: keywordEnabled ? String(vars.keywords || '') : null, matchedKeyword: keywordEnabled ? matchedKeyword : null, aiPrompt: String(vars.contentAI || '') || null, aiFinalPrompt: String(aiCheck && aiCheck.finalPrompt ? aiCheck.finalPrompt : ''), aiRawResult: rawResult, aiCheckResult: String(aiCheck && aiCheck.checkResult ? aiCheck.checkResult : ''), aiMatched: aiCheck && typeof aiCheck.matched === 'boolean' ? aiCheck.matched : null, aiReason: reason || null, aiResult: rawResult || null };
  }
  function normalizePhone(value) {
    const raw = String(value || '').trim();
    const compact = raw.replace(/[\s.\-]/g, '');
    let digits = compact.replace(/[^\d+]/g, '');
    if (digits.startsWith('+84')) digits = '0' + digits.slice(3);
    else if (digits.startsWith('84')) digits = '0' + digits.slice(2);
    digits = digits.replace(/\D/g, '');
    if (/^0[35789]\d{8}$/.test(digits)) return digits;
    return '';
  }
  function findPhones(text) {
    const matches = String(text || '').match(/(?:\+84|84|0)[\s.\-]?[35789](?:[\s.\-]?\d){8}\b/g) || [];
    return matches.map(normalizePhone).filter(Boolean);
  }
  function findZaloLinks(text) {
    const matches = String(text || '').match(/(?:https?:\/\/)?zalo\.me\/g\/[a-z0-9]+/gi) || [];
    return matches.map(x => x.trim()).filter(Boolean);
  }
  function unique(arr) { return Array.from(new Set((arr || []).map(x => String(x || '').trim()).filter(Boolean))); }
  function authorUidFromItem(item) {
    const rawHref = String(item && item.authorUrl ? item.authorUrl : '').trim();
    const fallbackUid = String(item && item.authorUid ? item.authorUid : '').trim();
    const href = rawHref.toLowerCase();
    if (href.includes('/permalink/') || href.includes('/posts/') || href.includes('story_fbid=') || href.includes('comment_id=') || href.includes('reply_comment_id=') || (href.includes('/groups/') && !href.includes('/user/'))) return '';
    try {
      const url = new URL(rawHref, 'https://www.facebook.com');
      const id = url.searchParams.get('id');
      if (id) return id.trim();
      const parts = url.pathname.split('/').map(part => { try { return decodeURIComponent(part); } catch { return part; } }).map(part => part.trim()).filter(Boolean);
      const userIndex = parts.indexOf('user');
      if (userIndex >= 0 && parts[userIndex + 1]) return parts[userIndex + 1];
      const last = parts[parts.length - 1] || '';
      const blockedLastParts = new Set(['profile.php', 'groups', 'posts', 'permalink', 'story.php', 'photo.php', 'photos', 'watch', 'reel']);
      if (last && !blockedLastParts.has(last.toLowerCase())) return last;
    } catch {}
    return fallbackUid;
  }

  const results = ensureResults();
  const sourcePost = results.sourceData.post;
  const posts = Array.isArray(input.posts) ? input.posts : (Array.isArray(vars.findDataSearchPosts) ? vars.findDataSearchPosts : []);
  let matchedPosts = 0;

  if (vars.findDataSearchHasPost) {
    for (const post of posts) {
      const content = String(post && post.content ? post.content : '');
      const contentMatches = matchesContent(content);
      const meaningAiCheck = (vars.isFindInPost || vars.isFindPostLink) && contentMatches ? await checkMeaningAi(content, 'post') : createEmptyMeaningAiCheck();
      const meaningAiAccepted = isMeaningAiAccepted(meaningAiCheck);
      const postAuthorUidForLog = authorUidFromItem(post);
      const postAuthorNameForLog = String(post && post.authorName ? post.authorName : '').trim();
      const postPhonesForLog = findPhones(content);
      const postZaloLinksForLog = findZaloLinks(content);
      const postLinksForLog = post && post.postLink ? [String(post.postLink)] : [];
      const postIndex = post && post.index ? post.index : null;
      const postUrl = String(post && post.postLink ? post.postLink : '');

      if ((vars.isFindInPost || vars.isFindPostLink) && !contentMatches) {
        await helpers.logRunEvent({ eventType: 'extract_post_data', eventName: 'Lấy thông tin bài post', targetType: 'post', status: 'skipped', isUserVisible: true, itemIndex: postIndex, targetUrl: postUrl, message: 'Không chứa keyword', extractedData: { entity: { type: 'post', url: postUrl, name: postAuthorNameForLog || null, uid: postAuthorUidForLog || null, contentText: content }, filters: buildFilterData(false, createEmptyMeaningAiCheck()), values: { phones: postPhonesForLog, zaloGroupLinks: postZaloLinksForLog, postLinks: postLinksForLog, uids: unique([postAuthorUidForLog].filter(Boolean)) } }, debugData: { postIndex, authorName: postAuthorNameForLog, authorUrl: String(post && post.authorUrl ? post.authorUrl : ''), rawPostLink: String(post && post.rawPostLink ? post.rawPostLink : ''), searchKeyword: vars.findDataSearchKeyword || '' } });
        continue;
      }

      if ((vars.isFindInPost || vars.isFindPostLink) && contentMatches && !meaningAiAccepted) {
        await helpers.logRunEvent({ eventType: 'extract_post_data', eventName: 'Lấy thông tin bài post', targetType: 'post', status: isMeaningAiFailed(meaningAiCheck) ? 'failed' : 'skipped', isUserVisible: true, itemIndex: postIndex, targetUrl: postUrl, message: getMeaningAiMessage(meaningAiCheck), extractedData: { entity: { type: 'post', url: postUrl, name: postAuthorNameForLog || null, uid: postAuthorUidForLog || null, contentText: content }, filters: buildFilterData(true, meaningAiCheck), values: { phones: postPhonesForLog, zaloGroupLinks: postZaloLinksForLog, postLinks: postLinksForLog, uids: unique([postAuthorUidForLog].filter(Boolean)) } }, debugData: { postIndex, authorName: postAuthorNameForLog, authorUrl: String(post && post.authorUrl ? post.authorUrl : ''), rawPostLink: String(post && post.rawPostLink ? post.rawPostLink : ''), searchKeyword: vars.findDataSearchKeyword || '' } });
        continue;
      }

      if ((vars.isFindInPost || vars.isFindPostLink) && contentMatches && meaningAiAccepted) {
        matchedPosts++;
        if (vars.isFindInPost && vars.isFindPhone) { results.phones.push(...postPhonesForLog); sourcePost.phones.push(...postPhonesForLog); }
        if (vars.isFindInPost && vars.isFindLinkGroupZalo) { results.linkGroupZalos.push(...postZaloLinksForLog); sourcePost.linkGroupZalos.push(...postZaloLinksForLog); }
        if (vars.isFindInPost && vars.isFindUid && postAuthorUidForLog) { results.uids.push(postAuthorUidForLog); sourcePost.uids.push(postAuthorUidForLog); }
        if (vars.isFindPostLink) { results.postLinks.push(...postLinksForLog); sourcePost.postLinks.push(...postLinksForLog); }
        await helpers.logRunEvent({ eventType: 'extract_post_data', eventName: 'Lấy thông tin bài post', targetType: 'post', status: 'success', isUserVisible: true, itemIndex: postIndex, targetUrl: postUrl, message: 'Đã duyệt bài post #' + (postIndex || ''), extractedData: { entity: { type: 'post', url: postUrl, name: postAuthorNameForLog || null, uid: postAuthorUidForLog || null, contentText: content }, filters: buildFilterData(contentMatches, meaningAiCheck), values: { phones: postPhonesForLog, zaloGroupLinks: postZaloLinksForLog, postLinks: postLinksForLog, uids: unique([postAuthorUidForLog].filter(Boolean)) } }, debugData: { postIndex, authorName: postAuthorNameForLog, authorUrl: String(post && post.authorUrl ? post.authorUrl : ''), rawPostLink: String(post && post.rawPostLink ? post.rawPostLink : ''), searchKeyword: vars.findDataSearchKeyword || '' } });
      }
    }
  }

  results.phones = unique(results.phones); results.linkGroupZalos = unique(results.linkGroupZalos); results.uids = unique(results.uids); results.postLinks = unique(results.postLinks);
  sourcePost.phones = unique(sourcePost.phones); sourcePost.linkGroupZalos = unique(sourcePost.linkGroupZalos); sourcePost.uids = unique(sourcePost.uids); sourcePost.postLinks = unique(sourcePost.postLinks);
  return { matchedPosts, phones: results.phones, linkGroupZalos: results.linkGroupZalos, uids: results.uids, postLinks: results.postLinks };
$ai_block_14_code$),
  ($ai_block_15_name$fb_collect_search_post_comments$ai_block_15_name$, $ai_block_15_code$// Centralized AI find-data filter via ai_using.
const __aiFindDataUsingCode = "fb_collect_search_post_comments_ai_filter";
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
const __splitMeaningTraits = (prompt) => {
  const lines = String(prompt || '')
    .split(/\r?\n/)
    .map(line => line.replace(/^\s*(?:[-*\u2022]|\d+[.)])\s*/, '').trim())
    .filter(Boolean);
  return lines.length > 0 ? lines : [String(prompt || '').trim()].filter(Boolean);
};
const __extractJsonText = (raw) => {
  const trimmed = String(raw || '').trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const text = (fenced ? fenced[1] : trimmed).trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  return start >= 0 && end > start ? text.slice(start, end + 1) : text;
};
helpers.checkFindDataMeaningAI = async (options = {}) => {
  const prompt = String(options.prompt || '').trim();
  const contentText = String(options.contentText || '').trim();
  const entityType = String(options.entityType || 'content').trim() || 'content';
  const traits = __splitMeaningTraits(prompt);
  const criteria = traits.map((trait, index) => (index + 1) + '. ' + trait).join('\n');
  const result = await __callCentralAI(__aiFindDataUsingCode, {
    prompt,
    criteria,
    entity_type: entityType,
    entityType,
    content: JSON.stringify(contentText),
    contentText
  });
  const rawResult = __extractAIText(result && (result.content ?? result.data ?? result.text ?? result.output ?? result.response ?? result.rawResponse ?? result));
  let matched = false;
  let reason = '';
  try {
    const parsed = JSON.parse(__extractJsonText(rawResult));
    matched = parsed.matched === true || parsed.match === true || String(parsed.result || parsed.checkResult || '').toLowerCase() === 'matched';
    reason = String(parsed.reason || parsed.explanation || parsed.message || '').trim();
  } catch {
    const normalized = rawResult.toLowerCase();
    matched = normalized.includes('matched') || normalized.includes('true') || normalized.includes('phù hợp') || normalized.includes('phu hop') || normalized.includes('có');
    reason = rawResult.slice(0, 500);
  }
  return {
    ok: true,
    matched,
    checkResult: matched ? 'matched' : 'not_matched',
    prompt,
    finalPrompt: '',
    rawResult,
    reason,
    provider: result.provider || '',
    model: result.model || ''
  };
};

  if (!vars.findDataSearchHasPost || vars.isFindInComment !== true) {
    vars.findDataSearchComments = [];
    return { commentItems: [] };
  }

  const selectors = {
    posts: await helpers.element('fb_search_post_in_uid'),
    commentButton: await helpers.element('fb_comment_in_post_btn'),
    mostRelevant: await helpers.element('fb_most_relevant_btn'),
    allComments: await helpers.element('fb_all_comments_btn'),
    newestComments: await helpers.element('fb_newest_comments_btn'),
    dialog: await helpers.element('fb_dialog'),
    commentElement: await helpers.element('fb_cmt_element_full'),
    uidInComment: await helpers.element('fb_uid_in_cmt_element'),
    contentInComment: await helpers.element('fb_content_in_cmt_element'),
    closeDialog: await helpers.element('fb_close_dialog_btn')
  };
  const postLimit = Math.max(1, Number(vars.countSearchPostFindData || vars.countPostFindData || 10));
  const commentLimit = Math.max(1, Number(vars.countCommentFindData || 30));
  const sortType = String(vars.sortTypeComment || 'most_relevant');

  const commentResult = await page.evaluate(String.raw`
    const selectors = __args[0];
    const postLimit = __args[1];
    const commentLimit = __args[2];
    const sortType = __args[3];
    function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
    function norm(text) { return String(text || '').replace(/\s+/g, ' ').trim(); }
    function isVisible(el) { if (!el) return false; const style = window.getComputedStyle(el); if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false; const rect = el.getBoundingClientRect(); return rect.width > 0 && rect.height > 0; }
    function xpathAll(xpath, root) { const out = []; if (!xpath) return out; try { const result = document.evaluate(xpath, root || document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null); for (let i = 0; i < result.snapshotLength; i++) out.push(result.snapshotItem(i)); } catch {} return out.filter(Boolean); }
    function first(xpath, root) { return xpathAll(xpath, root)[0] || null; }
    function clickSynthetic(el) { if (!el) return false; try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch {} const init = { bubbles: true, cancelable: true, view: window }; try { el.dispatchEvent(new PointerEvent('pointerdown', Object.assign({}, init, { pointerId: 1, pointerType: 'mouse' }))); } catch {} try { el.dispatchEvent(new MouseEvent('mousedown', init)); } catch {} try { el.dispatchEvent(new PointerEvent('pointerup', Object.assign({}, init, { pointerId: 1, pointerType: 'mouse' }))); } catch {} try { el.dispatchEvent(new MouseEvent('mouseup', init)); } catch {} try { el.click(); return true; } catch {} return false; }
    async function waitFor(fn, timeoutMs) { const started = Date.now(); while (Date.now() - started < timeoutMs) { const value = fn(); if (value) return value; await delay(300); } return null; }
    function extractUid(href) { if (!href) return ''; try { const url = new URL(href, location.href); const id = url.searchParams.get('id'); if (id) return id; const parts = url.pathname.split('/').filter(Boolean); const userIndex = parts.indexOf('user'); if (userIndex >= 0 && parts[userIndex + 1]) return parts[userIndex + 1]; return parts[parts.length - 1] || ''; } catch { return String(href || '').trim(); } }
    function commentContentOf(comment, authorLink, messageXpath) { const candidates = xpathAll(messageXpath, comment).filter(isVisible).filter(el => !authorLink || el !== authorLink && !(el.contains && el.contains(authorLink))).map(el => (el.innerText || el.textContent || '').trim()).filter(Boolean); return candidates[0] || (comment.innerText || comment.textContent || '').trim(); }
    function findPostElementsFallback() { const main = document.querySelector('[role="main"]') || document.body; const byArticle = Array.from(main.querySelectorAll('[role="article"]')).filter(isVisible).filter(el => { const text = norm(el.innerText || el.textContent || ''); return text.includes('Bình luận') || text.includes('Comment') || text.includes('Chia sẻ') || text.includes('Share'); }); if (byArticle.length > 0) return byArticle; return []; }
    function getPostElements() { const fromElement = xpathAll(selectors.posts).filter(isVisible); return fromElement.length > 0 ? fromElement : findPostElementsFallback(); }

    const rows = [];
    const postCommentStats = [];
    const posts = getPostElements().slice(0, postLimit);
    for (let p = 0; p < posts.length; p++) {
      const post = posts[p];
      const postStat = { postIndex: p + 1, opened: false, sorted: sortType === 'most_relevant', commentsCount: 0, error: '' };
      try {
        post.scrollIntoView(true);
        await delay(700);
        const button = first(selectors.commentButton, post) || Array.from(post.querySelectorAll('[role="button"]')).filter(isVisible).find(btn => { const text = norm(btn.innerText || btn.textContent || btn.getAttribute('aria-label')); return text === 'Bình luận' || text === 'Comment'; });
        if (!button) { postStat.error = 'Không tìm thấy nút comment'; continue; }
        clickSynthetic(button);
        postStat.opened = true;
        await delay(2000);
        let root = await waitFor(() => first(selectors.dialog, document), 5000);
        if (!root) root = document.documentElement;
        if (sortType !== 'most_relevant') {
          postStat.sorted = false;
          const sortButton = first(selectors.mostRelevant, root) || first(selectors.mostRelevant, document);
          if (sortButton) {
            clickSynthetic(sortButton); await delay(800);
            const optionXpath = sortType === 'newest' ? selectors.newestComments : selectors.allComments;
            const option = first(optionXpath, document);
            if (option) { clickSynthetic(option); postStat.sorted = true; await delay(2000); }
            else { postStat.error = 'Không tìm thấy lựa chọn sắp xếp comment'; }
          } else { postStat.error = 'Không tìm thấy nút sắp xếp comment'; }
        }
        let comments = xpathAll(selectors.commentElement, root);
        const startedAt = Date.now();
        let stableCount = 0;
        while (comments.length < commentLimit && Date.now() - startedAt < 90000 && stableCount < 3) {
          const oldCount = comments.length;
          if (comments.length > 0) comments[comments.length - 1].scrollIntoView(true);
          await delay(1500);
          comments = xpathAll(selectors.commentElement, root);
          stableCount = comments.length <= oldCount ? stableCount + 1 : 0;
        }
        const selectedComments = comments.slice(0, commentLimit);
        postStat.commentsCount = selectedComments.length;
        selectedComments.forEach((comment, i) => {
          const link = first(selectors.uidInComment, comment);
          const href = link ? (link.href || link.getAttribute('href') || '') : '';
          const authorName = link ? (link.innerText || link.textContent || '').trim() : '';
          const content = commentContentOf(comment, link, selectors.contentInComment);
          rows.push({ postIndex: p + 1, commentIndex: i + 1, content, authorName, authorUrl: href, authorUid: extractUid(href) });
        });
      } catch (err) { postStat.error = err && err.message ? err.message : String(err || 'Lỗi mở comment'); }
      finally { const closeButton = first(selectors.closeDialog, document); if (closeButton) { clickSynthetic(closeButton); await delay(1000); } postCommentStats.push(postStat); }
    }
    return { rows, postCommentStats };
  `, selectors, postLimit, commentLimit, sortType);

  const commentItems = Array.isArray(commentResult) ? commentResult : (commentResult && Array.isArray(commentResult.rows) ? commentResult.rows : []);
  const commentPostStats = commentResult && Array.isArray(commentResult.postCommentStats) ? commentResult.postCommentStats : [];
  vars.findDataSearchComments = commentItems;
  helpers.log('Đã tải ' + vars.findDataSearchComments.length + ' comment từ search');

  function ensureResults() { if (!vars.findDataResults || typeof vars.findDataResults !== 'object') vars.findDataResults = {}; const results = vars.findDataResults; if (!Array.isArray(results.phones)) results.phones = []; if (!Array.isArray(results.linkGroupZalos)) results.linkGroupZalos = []; if (!Array.isArray(results.uids)) results.uids = []; if (!results.sourceData || typeof results.sourceData !== 'object') results.sourceData = {}; if (!results.sourceData.comment || typeof results.sourceData.comment !== 'object') results.sourceData.comment = {}; if (!Array.isArray(results.sourceData.comment.phones)) results.sourceData.comment.phones = []; if (!Array.isArray(results.sourceData.comment.linkGroupZalos)) results.sourceData.comment.linkGroupZalos = []; if (!Array.isArray(results.sourceData.comment.uids)) results.sourceData.comment.uids = []; return results; }
  function normalizeKeywordText(value) { return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase(); }
  function keywordList() { return String(vars.keywords || '').split(',').map(x => normalizeKeywordText(x.trim())).filter(Boolean); }
  function matchesContent(text) { if (!vars.isFindByKeywords) return true; const words = keywordList(); if (words.length === 0) return true; const haystack = normalizeKeywordText(text); return words.some(word => haystack.includes(word)); }
  function isMeaningAiEnabled() { return vars.isFindByContentAI === true && String(vars.contentAI || '').trim().length > 0; }
  function createEmptyMeaningAiCheck() { return { ok: true, matched: true, checkResult: '', prompt: String(vars.contentAI || ''), finalPrompt: '', rawResult: '', reason: '', error: '' }; }
  function normalizeMeaningAiCheck(result) { if (result && result.unsupported) return { ok: false, matched: false, checkResult: 'error', prompt: String(vars.contentAI || ''), finalPrompt: '', rawResult: '', reason: 'Runtime chưa hỗ trợ helper checkFindDataMeaningAI', error: 'Runtime chưa hỗ trợ helper checkFindDataMeaningAI' }; const raw = result && typeof result === 'object' ? result : {}; const checkResult = String(raw.checkResult || raw.check_result || (raw.ok === true ? (raw.matched === true ? 'matched' : 'not_matched') : 'error')); return { ok: raw.ok === true, matched: raw.matched === true, checkResult, prompt: String(raw.prompt || vars.contentAI || ''), finalPrompt: String(raw.finalPrompt || raw.final_prompt || ''), rawResult: String(raw.rawResult || raw.raw_result || ''), reason: String(raw.reason || raw.error || ''), error: String(raw.error || '') }; }
  async function checkMeaningAi(content, entityType) { if (!isMeaningAiEnabled()) return createEmptyMeaningAiCheck(); const result = await helpers.checkFindDataMeaningAI({ contentText: String(content || ''), prompt: String(vars.contentAI || ''), entityType }); return normalizeMeaningAiCheck(result); }
  function isMeaningAiAccepted(aiCheck) { return !isMeaningAiEnabled() || (aiCheck && aiCheck.ok === true && aiCheck.matched === true); }
  function isMeaningAiFailed(aiCheck) { return isMeaningAiEnabled() && (!aiCheck || aiCheck.ok !== true); }
  function getMeaningAiMessage(aiCheck) { if (isMeaningAiFailed(aiCheck)) return 'Lỗi kiểm tra ý nghĩa AI: ' + String(aiCheck && (aiCheck.error || aiCheck.reason) ? (aiCheck.error || aiCheck.reason) : 'Không rõ nguyên nhân'); if (isMeaningAiEnabled() && aiCheck && aiCheck.matched !== true) return 'Không đúng ý nghĩa AI'; return 'Đúng ý nghĩa AI'; }
  function buildFilterData(matchedKeyword, aiCheck) { const keywordEnabled = vars.isFindByKeywords === true && String(vars.keywords || '').trim().length > 0; const rawResult = String(aiCheck && aiCheck.rawResult ? aiCheck.rawResult : ''); const reason = String(aiCheck && aiCheck.reason ? aiCheck.reason : ''); return { keywordEnabled, keyword: keywordEnabled ? String(vars.keywords || '') : null, matchedKeyword: keywordEnabled ? matchedKeyword : null, aiPrompt: String(vars.contentAI || '') || null, aiFinalPrompt: String(aiCheck && aiCheck.finalPrompt ? aiCheck.finalPrompt : ''), aiRawResult: rawResult, aiCheckResult: String(aiCheck && aiCheck.checkResult ? aiCheck.checkResult : ''), aiMatched: aiCheck && typeof aiCheck.matched === 'boolean' ? aiCheck.matched : null, aiReason: reason || null, aiResult: rawResult || null }; }
  function normalizePhone(value) { const raw = String(value || '').trim(); const compact = raw.replace(/[\s.\-]/g, ''); let digits = compact.replace(/[^\d+]/g, ''); if (digits.startsWith('+84')) digits = '0' + digits.slice(3); else if (digits.startsWith('84')) digits = '0' + digits.slice(2); digits = digits.replace(/\D/g, ''); if (/^0[35789]\d{8}$/.test(digits)) return digits; return ''; }
  function findPhones(text) { const matches = String(text || '').match(/(?:\+84|84|0)[\s.\-]?[35789](?:[\s.\-]?\d){8}\b/g) || []; return matches.map(normalizePhone).filter(Boolean); }
  function findZaloLinks(text) { const matches = String(text || '').match(/(?:https?:\/\/)?zalo\.me\/g\/[a-z0-9]+/gi) || []; return matches.map(x => x.trim()).filter(Boolean); }
  function unique(arr) { return Array.from(new Set((arr || []).map(x => String(x || '').trim()).filter(Boolean))); }
  function authorUidFromItem(item) { const rawHref = String(item && item.authorUrl ? item.authorUrl : '').trim(); const fallbackUid = String(item && item.authorUid ? item.authorUid : '').trim(); const href = rawHref.toLowerCase(); if (href.includes('/permalink/') || href.includes('/posts/') || href.includes('story_fbid=') || href.includes('comment_id=') || href.includes('reply_comment_id=') || (href.includes('/groups/') && !href.includes('/user/'))) return ''; try { const url = new URL(rawHref, 'https://www.facebook.com'); const id = url.searchParams.get('id'); if (id) return id.trim(); const parts = url.pathname.split('/').map(part => { try { return decodeURIComponent(part); } catch { return part; } }).map(part => part.trim()).filter(Boolean); const userIndex = parts.indexOf('user'); if (userIndex >= 0 && parts[userIndex + 1]) return parts[userIndex + 1]; const last = parts[parts.length - 1] || ''; const blockedLastParts = new Set(['profile.php', 'groups', 'posts', 'permalink', 'story.php', 'photo.php', 'photos', 'watch', 'reel']); if (last && !blockedLastParts.has(last.toLowerCase())) return last; } catch {} return fallbackUid; }

  const results = ensureResults();
  const sourceComment = results.sourceData.comment;
  const commentSourcePosts = Array.isArray(vars.findDataSearchPosts) ? vars.findDataSearchPosts : [];
  const commentsByPost = new Map();
  for (const comment of vars.findDataSearchComments) { const postIndex = Math.max(1, Number(comment && comment.postIndex ? comment.postIndex : 0)); if (!commentsByPost.has(postIndex)) commentsByPost.set(postIndex, []); commentsByPost.get(postIndex).push(comment); }
  const commentLogEvents = [];
  let matchedComments = 0;
  let globalCommentIndex = 0;

  for (const rawStat of commentPostStats) {
    const stat = rawStat && typeof rawStat === 'object' ? rawStat : {};
    const postIndex = Math.max(1, Number(stat.postIndex || 0));
    const commentsCount = Math.max(0, Number(stat.commentsCount || 0));
    const opened = stat.opened === true;
    const sorted = stat.sorted === true;
    const error = String(stat.error || '').trim();
    const sourcePost = commentSourcePosts[postIndex - 1] || {};
    const postUrl = String(sourcePost && sourcePost.postLink ? sourcePost.postLink : '');
    const commentsForPost = commentsByPost.get(postIndex) || [];

    commentLogEvents.push({ eventType: 'open_comments', eventName: 'Mở comment', targetType: 'comment', status: opened ? 'success' : 'skipped', isUserVisible: false, xpath: selectors.commentButton, itemIndex: postIndex, targetUrl: postUrl, message: opened ? 'Đã mở comment của bài post #' + postIndex : 'Bỏ qua mở comment của bài post #' + postIndex, debugData: { postLimit, commentLimit, sortType, postIndex, postUrl, error, searchKeyword: vars.findDataSearchKeyword || '' } });
    if (sortType !== 'most_relevant' && opened) commentLogEvents.push({ eventType: 'sort_comments', eventName: 'Sắp xếp comment', targetType: 'comment', status: sorted ? 'success' : 'failed', isUserVisible: false, itemIndex: postIndex, targetUrl: postUrl, message: sorted ? 'Đã đổi sắp xếp comment của bài post #' + postIndex : (error || 'Không sắp xếp được comment của bài post #' + postIndex), debugData: { sortType, postIndex, postUrl, error, selectors: { sortButton: selectors.mostRelevant, allComments: selectors.allComments, newestComments: selectors.newestComments }, searchKeyword: vars.findDataSearchKeyword || '' } });
    commentLogEvents.push({ eventType: 'collect_comments', eventName: 'Lấy danh sách comment', targetType: 'comment', status: opened ? 'success' : 'skipped', isUserVisible: true, xpath: selectors.commentElement, elementCount: commentsCount, itemIndex: postIndex, targetUrl: postUrl, message: 'Bài post #' + postIndex + ': lấy được ' + commentsCount + ' comment', debugData: { postLimit, commentLimit, sortType, postIndex, postUrl, error, searchKeyword: vars.findDataSearchKeyword || '' } });

    for (const comment of commentsForPost) {
      globalCommentIndex++;
      const content = String(comment && comment.content ? comment.content : '');
      const contentMatches = matchesContent(content);
      const meaningAiCheck = vars.isFindInComment && contentMatches ? await checkMeaningAi(content, 'comment') : createEmptyMeaningAiCheck();
      const meaningAiAccepted = isMeaningAiAccepted(meaningAiCheck);
      const commentAuthorUidForLog = authorUidFromItem(comment);
      const commentAuthorNameForLog = String(comment && comment.authorName ? comment.authorName : '').trim();
      const commentPhonesForLog = findPhones(content);
      const commentZaloLinksForLog = findZaloLinks(content);
      const commentPostLinksForLog = postUrl ? [postUrl] : [];
      const commentIndexInPost = Math.max(1, Number(comment && comment.commentIndex ? comment.commentIndex : 0));
      const authorUrl = String(comment && comment.authorUrl ? comment.authorUrl : '');

      if (vars.isFindInComment && contentMatches && !meaningAiAccepted) {
        commentLogEvents.push({ eventType: 'extract_comment_data', eventName: 'Lấy thông tin comment', targetType: 'comment', status: isMeaningAiFailed(meaningAiCheck) ? 'failed' : 'skipped', isUserVisible: true, itemIndex: commentIndexInPost, targetUrl: authorUrl, message: getMeaningAiMessage(meaningAiCheck), extractedData: { entity: { type: 'comment', url: authorUrl, name: commentAuthorNameForLog || null, uid: commentAuthorUidForLog || null, contentText: content }, filters: buildFilterData(true, meaningAiCheck), values: { phones: commentPhonesForLog, zaloGroupLinks: commentZaloLinksForLog, postLinks: commentPostLinksForLog, uids: unique([commentAuthorUidForLog].filter(Boolean)) } }, debugData: { postIndex, commentIndexInPost, globalCommentIndex, postUrl, authorName: commentAuthorNameForLog, authorUrl, searchKeyword: vars.findDataSearchKeyword || '' } });
        continue;
      }
      if (vars.isFindInComment && contentMatches && meaningAiAccepted) {
        matchedComments++;
        if (vars.isFindPhone) { results.phones.push(...commentPhonesForLog); sourceComment.phones.push(...commentPhonesForLog); }
        if (vars.isFindLinkGroupZalo) { results.linkGroupZalos.push(...commentZaloLinksForLog); sourceComment.linkGroupZalos.push(...commentZaloLinksForLog); }
        if (vars.isFindUid && commentAuthorUidForLog) { results.uids.push(commentAuthorUidForLog); sourceComment.uids.push(commentAuthorUidForLog); }
        commentLogEvents.push({ eventType: 'extract_comment_data', eventName: 'Lấy thông tin comment', targetType: 'comment', status: 'success', isUserVisible: true, itemIndex: commentIndexInPost, targetUrl: authorUrl, message: 'Đã duyệt comment #' + commentIndexInPost, extractedData: { entity: { type: 'comment', url: authorUrl, name: commentAuthorNameForLog || null, uid: commentAuthorUidForLog || null, contentText: content }, filters: buildFilterData(contentMatches, meaningAiCheck), values: { phones: commentPhonesForLog, zaloGroupLinks: commentZaloLinksForLog, postLinks: commentPostLinksForLog, uids: unique([commentAuthorUidForLog].filter(Boolean)) } }, debugData: { postIndex, commentIndexInPost, globalCommentIndex, postUrl, authorName: commentAuthorNameForLog, authorUrl, searchKeyword: vars.findDataSearchKeyword || '' } });
      } else if (vars.isFindInComment && !contentMatches) {
        commentLogEvents.push({ eventType: 'extract_comment_data', eventName: 'Lấy thông tin comment', targetType: 'comment', status: 'skipped', isUserVisible: true, itemIndex: commentIndexInPost, targetUrl: authorUrl, message: 'Không chứa keyword', extractedData: { entity: { type: 'comment', url: authorUrl, name: commentAuthorNameForLog || null, uid: commentAuthorUidForLog || null, contentText: content }, filters: buildFilterData(false, createEmptyMeaningAiCheck()), values: { phones: commentPhonesForLog, zaloGroupLinks: commentZaloLinksForLog, postLinks: commentPostLinksForLog, uids: unique([commentAuthorUidForLog].filter(Boolean)) } }, debugData: { postIndex, commentIndexInPost, globalCommentIndex, postUrl, authorName: commentAuthorNameForLog, authorUrl, searchKeyword: vars.findDataSearchKeyword || '' } });
      }
    }
  }
  if (commentLogEvents.length > 0) commentLogEvents.push({ eventType: 'collect_comments_summary', eventName: 'Tổng kết comment', targetType: 'comment', status: 'success', isUserVisible: true, elementCount: vars.findDataSearchComments.length, message: 'Tổng cộng lấy được ' + vars.findDataSearchComments.length + ' comment từ search', debugData: { postLimit, commentLimit, sortType, matchedComments, searchKeyword: vars.findDataSearchKeyword || '' } });
  await helpers.logRunEvents(commentLogEvents);
  results.phones = unique(results.phones); results.linkGroupZalos = unique(results.linkGroupZalos); results.uids = unique(results.uids); sourceComment.phones = unique(sourceComment.phones); sourceComment.linkGroupZalos = unique(sourceComment.linkGroupZalos); sourceComment.uids = unique(sourceComment.uids);
  vars.findDataSearchMatchedComments = matchedComments;
  return { commentItems: vars.findDataSearchComments, commentPostStats, matchedComments };
$ai_block_15_code$);

UPDATE public.auto_blocks AS block
SET
  code = promoted.code,
  updated_at = now()
FROM _ai_block_promotions AS promoted
WHERE block.name = promoted.block_name
  AND block.code IS DISTINCT FROM promoted.code;

WITH rebuilt_workflows AS (
  SELECT
    wf.id,
    jsonb_agg(
      CASE
        WHEN promoted.block_name IS NOT NULL AND node.value ? 'codeOverride' THEN node.value - 'codeOverride'
        ELSE node.value
      END
      ORDER BY node.ordinality
    ) AS nodes
  FROM public.auto_workflows AS wf
  CROSS JOIN LATERAL jsonb_array_elements(wf.nodes::jsonb) WITH ORDINALITY AS node(value, ordinality)
  LEFT JOIN _ai_block_promotions AS promoted
    ON promoted.block_name = node.value->>'blockName'
  GROUP BY wf.id
), changed_workflows AS (
  SELECT rebuilt_workflows.id, rebuilt_workflows.nodes
  FROM rebuilt_workflows
  JOIN public.auto_workflows AS wf ON wf.id = rebuilt_workflows.id
  WHERE wf.nodes::jsonb IS DISTINCT FROM rebuilt_workflows.nodes
)
UPDATE public.auto_workflows AS wf
SET
  nodes = changed_workflows.nodes,
  updated_at = now()
FROM changed_workflows
WHERE wf.id = changed_workflows.id;

DO $$
DECLARE
  promoted_block_count integer;
  ai_code_override_count integer;
BEGIN
  SELECT count(*) INTO promoted_block_count
  FROM public.auto_blocks AS block
  JOIN _ai_block_promotions AS promoted
    ON promoted.block_name = block.name
  WHERE block.code = promoted.code;

  IF promoted_block_count <> 16 THEN
    RAISE EXCEPTION 'Expected 16 promoted AI blocks, got %', promoted_block_count;
  END IF;

  SELECT count(*) INTO ai_code_override_count
  FROM public.auto_workflows AS wf
  CROSS JOIN LATERAL jsonb_array_elements(wf.nodes::jsonb) AS node(value)
  WHERE node.value->>'blockName' IN (
    'fb_type_post_content',
    'fb_send_message',
    'fb_share_post',
    'fb_post_reels',
    'fb_comment_at_position',
    'fb_comment_current_post',
    'fb_page_post_api',
    'fb_post_current_identity_ui',
    'fb_send_page_inbox_message',
    'fb_rewrite_source_content_ai',
    'fb_newsfeed_check_like',
    'fb_newsfeed_check_comment',
    'fb_extract_data_from_group_posts',
    'fb_collect_group_comments',
    'fb_extract_data_from_search_posts',
    'fb_collect_search_post_comments'
  )
    AND node.value ? 'codeOverride';

  IF ai_code_override_count <> 0 THEN
    RAISE EXCEPTION 'Expected 0 AI codeOverride nodes after promoting blocks, got %', ai_code_override_count;
  END IF;
END $$;

COMMIT;
