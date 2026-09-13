-- v278: Facebook publish confirmation, video timeouts, failure screenshots.
-- Source: exact live rows from linked production cgjbsmqtfhqvttudyjzq,
-- captured 2026-09-13. No historical block/workflow body was used.
-- Full-row preflight checksums protect code, overrides, metadata and graph edits.
-- Only block code and selected node config keys are changed; links/edges remain intact.
-- Data-only: no DDL, RPC changes, migration-table preparation or schema reload.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $facebook_publish$
DECLARE
  v_patch constant jsonb := $publish_patch$
{
  "blocks": [
    {
      "id": 30,
      "name": "fb_click_post_button",
      "checksum": "0d112746ddf0a42d0811d9b96928537e",
      "code": "\nlet nextClicked = false\ntry {\n  const nextSelector = await helpers.element('FbComposerNextButton')\n  const nextButton = await page.$(nextSelector)\n  if (nextButton) {\n    await page.click(nextSelector)\n    nextClicked = true\n  }\n} catch {}\n\nif (nextClicked) await helpers.sleep(2000, signal)\n\nconst publishMedia = Array.isArray(vars.images) ? vars.images : []\nconst publishHasVideo = publishMedia.some(path => /\\.(3g2|3gp|avi|m2ts|m4v|mkv|mov|mp4|mpeg|mpg|ogv|webm|wmv)(?:[?#].*)?$/i.test(String(path || '')))\nconst publishTimeoutMs = publishHasVideo ? 180000 : 60000\n// Match the existing Group visibility check; a disabled button still exists.\nasync function postSubmitButtonIsVisible(selector) {\n  return await page.evaluate(`\n    const result = document.evaluate(__args[0], document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);\n    for (let i = 0; i < result.snapshotLength; i++) {\n      const el = result.snapshotItem(i);\n      const style = window.getComputedStyle(el);\n      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue;\n      const rect = el.getBoundingClientRect();\n      if (rect.width > 0 && rect.height > 0) return true;\n    }\n    return false;\n  `, selector);\n}\n\nconst btn = await helpers.element('fb_post_button')\nawait page.waitForSelector(btn, { timeout: 10000 })\nawait page.click(btn)\nvars.facebookPostPublishStartedAt = Date.now()\nif (input.verifyPostAfterClick === true) {\n  while (true) {\n    if (signal.aborted) throw new Error('Đã dừng chờ xác nhận đăng bài')\n    if (!await postSubmitButtonIsVisible(btn)) {\n      return { ok: true, posted: true, submitClosed: true, publishTimeoutMs }\n    }\n    const remainingMs = publishTimeoutMs - (Date.now() - vars.facebookPostPublishStartedAt)\n    if (remainingMs <= 0) throw new Error('Form đăng bài chưa đóng sau ' + (publishTimeoutMs / 1000) + ' giây')\n    await helpers.sleep(Math.min(500, remainingMs), signal)\n  }\n}\n// Group retains its separate verify block and frequency-limit policy.\nawait helpers.sleep(3000, signal)\nreturn { posted: true }\n",
      "code_md5": "fdf9228ad1898ff90d3202bdbe9a02aa"
    },
    {
      "id": 2624,
      "name": "fb_verify_group_post_form_closed",
      "checksum": "9f20574200ceba30def811df2708b103",
      "code": "\nconst submitButton = await helpers.element('GroupPostSubmitButtonAfterClick');\nconst frequencyLimitError = await helpers.element('GroupPostFrequencyLimitError');\nconst publishMedia = Array.isArray(vars.images) ? vars.images : []\nconst publishHasVideo = publishMedia.some(path => /\\.(3g2|3gp|avi|m2ts|m4v|mkv|mov|mp4|mpeg|mpg|ogv|webm|wmv)(?:[?#].*)?$/i.test(String(path || '')))\nconst publishTimeoutMs = publishHasVideo ? 180000 : 60000\nconst publishStarted = Number(vars.facebookPostPublishStartedAt) || Date.now();\nlet posted = false;\nlet message = '';\n\nasync function hasVisibleElement(selector) {\n  return await page.evaluate(`\n    const selector = __args[0];\n\n    function isVisible(el) {\n      if (!el) return false;\n      const style = window.getComputedStyle(el);\n      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;\n      const rect = el.getBoundingClientRect();\n      return rect.width > 0 && rect.height > 0;\n    }\n\n    function xpathAll(xpath) {\n      const out = [];\n      if (!xpath) return out;\n      try {\n        const result = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);\n        for (let i = 0; i < result.snapshotLength; i++) {\n          const item = result.snapshotItem(i);\n          if (item) out.push(item);\n        }\n      } catch {}\n      return out;\n    }\n\n    return xpathAll(selector).some(isVisible);\n  `, selector);\n}\n\nwhile (true) {\n  if (signal.aborted) throw new Error('Đã dừng chờ xác nhận đăng bài');\n  if (!await hasVisibleElement(submitButton)) {\n    posted = true;\n    message = 'Form đăng bài đã đóng';\n    break;\n  }\n  const remainingMs = publishTimeoutMs - (Date.now() - publishStarted);\n  if (remainingMs <= 0) break;\n  await helpers.sleep(Math.min(500, remainingMs), signal);\n}\nif (!posted) {\n  const hasFrequencyLimitError = await hasVisibleElement(frequencyLimitError);\n  if (hasFrequencyLimitError) {\n    message = 'Facebook báo giới hạn tần suất bạn đăng bài';\n    vars.groupPostSubmitted = false;\n    vars.groupPostFrequencyLimitError = true;\n    helpers.log(message);\n    throw new Error(message);\n  }\n  message = 'Form đăng bài chưa đóng sau ' + (publishTimeoutMs / 1000) + ' giây';\n}\n\nvars.groupPostSubmitted = posted;\nif (!posted) helpers.log(message);\n\nreturn {\n  ok: posted,\n  posted,\n  submitClosed: posted,\n  publishTimeoutMs,\n  message\n};\n",
      "code_md5": "3ab3caa081a67691171036ab237f922d"
    },
    {
      "id": 37,
      "name": "fb_post_reels",
      "checksum": "b37a14c54fbaad41db6dac42770b7f6d",
      "code": "// Centralized AI rewrite via ai_using.\nconst __aiRewriteUsingCode = \"fb_post_reels_rewrite\";\nconst __extractAIText = (value) => {\n  if (value === null || value === undefined) return '';\n  if (typeof value === 'string') return value.trim();\n  if (typeof value === 'number' || typeof value === 'boolean') return String(value).trim();\n  if (Array.isArray(value)) return value.map(__extractAIText).filter(Boolean).join('\\n').trim();\n  if (typeof value === 'object') {\n    const data = value;\n    const direct = data.content ?? data.data ?? data.Data ?? data.text ?? data.output ?? data.response ?? data.message ?? data.Message ?? data.answer ?? data.result;\n    if (direct !== undefined && direct !== null && direct !== value) {\n      const directText = __extractAIText(direct);\n      if (directText) return directText;\n    }\n    try { return JSON.stringify(value); } catch { return String(value); }\n  }\n  return String(value || '').trim();\n};\nconst __callCentralAI = async (usingCode, payload) => {\n  if (!usingCode) throw new Error('Thiếu mã cấu hình AI');\n  if (typeof helpers.callAIUsing !== 'function') throw new Error('Runtime chưa hỗ trợ helper callAIUsing');\n  const result = await helpers.callAIUsing(usingCode, payload || {});\n  if (result && result.unsupported) throw new Error('Runtime chưa hỗ trợ helper callAIUsing');\n  if (!result || result.ok !== true) throw new Error(String(result && result.error ? result.error : 'AI lỗi'));\n  return result;\n};\nconst __callAIText = async (usingCode, payload) => {\n  const result = await __callCentralAI(usingCode, payload);\n  return __extractAIText(result && (result.content ?? result.data ?? result.text ?? result.output ?? result.response ?? result.rawResponse ?? result));\n};\nconst __callAIRewriteContent = async (content) => {\n  const text = String(content || '');\n  return await __callAIText(__aiRewriteUsingCode, {\n    content: text,\n    question: text,\n    source: 'aka_agent'\n  });\n};\n\nconst shouldRewriteContentEachRun = vars.rewriteContentEachRun === true\n\nconst formatTemplateDate = (dayKey, formatKey) => {\n  const d = new Date()\n  const key = String(dayKey || 'TODAY').toUpperCase()\n  if (key === 'TOMORROW') d.setDate(d.getDate() + 1)\n  if (key === 'YESTERDAY') d.setDate(d.getDate() - 1)\n\n  const dd = String(d.getDate()).padStart(2, '0')\n  const mm = String(d.getMonth() + 1).padStart(2, '0')\n  const yyyy = String(d.getFullYear())\n  const format = String(formatKey || 'DD/MM/YYYY').toUpperCase()\n  return format === 'MM/DD/YYYY'\n    ? mm + '/' + dd + '/' + yyyy\n    : dd + '/' + mm + '/' + yyyy\n}\n\nconst renderContentTemplate = async (raw, options = {}) => {\n  let rendered = String(raw || '')\n\n  if (/#\\{\\s*FULL_NAME\\s*\\}/i.test(rendered)) {\n    let fullName = String(vars.campaignInputDataName || vars.inputDataName || '').trim()\n    if (!fullName && options.resolveFullNameFromPage) {\n      const nameXpath = \"//*[contains(@class,'xxymvpz x1dyh7pn')]\"\n      try {\n        const found = await page.waitForSelector(nameXpath, { timeout: 3000 }).catch(() => false)\n        if (found) fullName = String(await page.getText(nameXpath).catch(() => '') || '').trim()\n      } catch (e) {\n        fullName = ''\n      }\n    }\n    rendered = rendered.replace(/#\\{\\s*FULL_NAME\\s*\\}/gi, fullName)\n  }\n\n  rendered = rendered.replace(\n    /#\\{\\s*(TODAY|TOMORROW|YESTERDAY)\\s*(?:\\(\\s*(DD\\/MM\\/YYYY|MM\\/DD\\/YYYY)\\s*\\))?\\s*\\}/gi,\n    (_match, dayKey, formatKey) => formatTemplateDate(dayKey, formatKey)\n  )\n\n  return rendered\n}\n\nconst rewriteContentForRun = async (raw) => {\n  const original = String(raw || '')\n  const content = original.trim()\n  if (!shouldRewriteContentEachRun || !content) return original\n\n  try {\n    const rewritten = await __callAIRewriteContent(content)\n    if (!rewritten) throw new Error('AI trả về nội dung không hợp lệ.')\n    helpers.log('Đã viết lại nội dung bằng AI')\n    return rewritten\n  } catch (e) {\n    const message = e && e.message ? String(e.message) : String(e)\n    helpers.log('AI viết lại nội dung lỗi, dùng nội dung gốc: ' + message)\n    return original\n  }\n}\n\nconst videoPath = String(input.videoPath || vars.videoPath || '').trim()\nif (!videoPath) throw new Error('videoPath rỗng (cần ít nhất 1 video trong vars.images)')\nlet content = String(input.content || vars.campaignContent || '')\ncontent = await renderContentTemplate(content)\ncontent = await rewriteContentForRun(content)\n\n// Mở trang tạo Reels\nawait page.navigate('https://www.facebook.com/reels/create')\nawait helpers.sleep(5000, signal)\n\n// Upload video\nconst uploadInput = await helpers.element('fb_reels_upload_input')\nconst uploaded = await page.uploadFile(uploadInput, [videoPath])\nif (!uploaded || uploaded.fileCount === 0) throw new Error('Không upload được video cho Reels')\nawait helpers.sleep(6000, signal)\n\n// Click Tiếp/Next 2 lần (Reels có 2-3 bước trước khi đến caption)\nconst nextSel = await helpers.element('fb_reels_next_button')\nawait page.click(nextSel).catch(() => {})\nawait helpers.sleep(3000, signal)\nawait page.click(nextSel).catch(() => {})\nawait helpers.sleep(3000, signal)\n\n// Nhập caption\nif (content) {\n  const descSel = await helpers.element('fb_reels_description')\n  await page.click(descSel).catch(() => {})\n  await helpers.sleep(500, signal)\n  await page.fill(descSel, content).catch(() => {})\n  await helpers.sleep(1500, signal)\n}\n\n// Match the existing Group visibility check; a disabled button still exists.\nasync function postSubmitButtonIsVisible(selector) {\n  return await page.evaluate(`\n    const result = document.evaluate(__args[0], document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);\n    for (let i = 0; i < result.snapshotLength; i++) {\n      const el = result.snapshotItem(i);\n      const style = window.getComputedStyle(el);\n      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue;\n      const rect = el.getBoundingClientRect();\n      if (rect.width > 0 && rect.height > 0) return true;\n    }\n    return false;\n  `, selector);\n}\n\n// Click Đăng\nconst publishSel = await helpers.element('fb_reels_publish_button')\nawait page.click(publishSel)\nconst publishTimeoutMs = 180000\nconst publishStarted = Date.now()\nwhile (true) {\n  if (signal.aborted) throw new Error('Đã dừng chờ xác nhận đăng Reels')\n  if (!await postSubmitButtonIsVisible(publishSel)) break\n  const remainingMs = publishTimeoutMs - (Date.now() - publishStarted)\n  if (remainingMs <= 0) throw new Error('Form đăng Reels chưa đóng sau 180 giây')\n  await helpers.sleep(Math.min(500, remainingMs), signal)\n}\n\nhelpers.log('Đã đăng Reels: ' + videoPath)\nreturn { ok: true, posted: true, submitClosed: true, publishTimeoutMs, content, rewrittenContent: shouldRewriteContentEachRun }\n",
      "code_md5": "b7dbbf4c078a81dc0a8147e269a2d8c0"
    },
    {
      "id": 2672,
      "name": "fb_post_current_identity_ui",
      "checksum": "72ee4196540d556af590a42aa99a12f1",
      "code": "// Centralized AI rewrite via ai_using.\nconst __aiRewriteUsingCode = \"fb_post_current_identity_ui_rewrite\";\nconst __extractAIText = (value) => {\n  if (value === null || value === undefined) return '';\n  if (typeof value === 'string') return value.trim();\n  if (typeof value === 'number' || typeof value === 'boolean') return String(value).trim();\n  if (Array.isArray(value)) return value.map(__extractAIText).filter(Boolean).join('\\n').trim();\n  if (typeof value === 'object') {\n    const data = value;\n    const direct = data.content ?? data.data ?? data.Data ?? data.text ?? data.output ?? data.response ?? data.message ?? data.Message ?? data.answer ?? data.result;\n    if (direct !== undefined && direct !== null && direct !== value) {\n      const directText = __extractAIText(direct);\n      if (directText) return directText;\n    }\n    try { return JSON.stringify(value); } catch { return String(value); }\n  }\n  return String(value || '').trim();\n};\nconst __callCentralAI = async (usingCode, payload) => {\n  if (!usingCode) throw new Error('Thiếu mã cấu hình AI');\n  if (typeof helpers.callAIUsing !== 'function') throw new Error('Runtime chưa hỗ trợ helper callAIUsing');\n  const result = await helpers.callAIUsing(usingCode, payload || {});\n  if (result && result.unsupported) throw new Error('Runtime chưa hỗ trợ helper callAIUsing');\n  if (!result || result.ok !== true) throw new Error(String(result && result.error ? result.error : 'AI lỗi'));\n  return result;\n};\nconst __callAIText = async (usingCode, payload) => {\n  const result = await __callCentralAI(usingCode, payload);\n  return __extractAIText(result && (result.content ?? result.data ?? result.text ?? result.output ?? result.response ?? result.rawResponse ?? result));\n};\nconst __callAIRewriteContent = async (content) => {\n  const text = String(content || '');\n  return await __callAIText(__aiRewriteUsingCode, {\n    content: text,\n    question: text,\n    source: 'aka_agent'\n  });\n};\n\ntry { /* v59-safe-output-wrapper */\n\nconst stepMs = Number(vars.facebookStepMs || input.facebookStepMs || 1000)\nconst submitTimeoutMs = Number(vars.facebookSubmitTimeoutMs || input.facebookSubmitTimeoutMs || 30000)\n\nconst closeSelector = await helpers.element('FbComposerCloseDialogButton')\nconst openSelector = await helpers.element('FbComposerOpenButton')\nconst textSelector = await helpers.element('FbComposerTextInput')\nconst backgroundButtonSelector = await helpers.element('FbComposerBackgroundButton')\nconst backgroundOptionSelector = await helpers.element('FbComposerBackgroundOption')\nconst formSelector = await helpers.element('FbComposerForm')\nconst nextSelector = await helpers.element('FbComposerNextButton')\nconst reelsNextSelector = await helpers.element('FbComposerReelsNextButton')\nconst submitSelector = await helpers.element('FbComposerSubmitButton')\nconst anotherTimeSelector = await helpers.element('FbComposerAnotherTimeButton')\nconst errorSelector = await helpers.element('FbComposerErrorMessage')\nconst rawLinkSelector = await helpers.element('FbComposerRawPostLink')\nconst postLinkSelector = await helpers.element('FbComposerPostLink')\n\nfunction formatTemplateDate(dayKey, formatKey) {\n  const d = new Date()\n  const key = String(dayKey || 'TODAY').toUpperCase()\n  if (key === 'TOMORROW') d.setDate(d.getDate() + 1)\n  if (key === 'YESTERDAY') d.setDate(d.getDate() - 1)\n  const dd = String(d.getDate()).padStart(2, '0')\n  const mm = String(d.getMonth() + 1).padStart(2, '0')\n  const yyyy = String(d.getFullYear())\n  return String(formatKey || 'DD/MM/YYYY').toUpperCase() === 'MM/DD/YYYY' ? mm + '/' + dd + '/' + yyyy : dd + '/' + mm + '/' + yyyy\n}\n\nasync function renderContentTemplate(raw) {\n  let rendered = String(raw || '')\n  if (/#\\{\\s*FULL_NAME\\s*\\}/i.test(rendered)) {\n    const fullName = String(vars.campaignInputDataName || vars.inputDataName || vars.pageName || '').trim()\n    rendered = rendered.replace(/#\\{\\s*FULL_NAME\\s*\\}/gi, fullName)\n  }\n  rendered = rendered.replace(\n    /#\\{\\s*(TODAY|TOMORROW|YESTERDAY)\\s*(?:\\(\\s*(DD\\/MM\\/YYYY|MM\\/DD\\/YYYY)\\s*\\))?\\s*\\}/gi,\n    (_match, dayKey, formatKey) => formatTemplateDate(dayKey, formatKey)\n  )\n  return rendered\n}\n\nasync function rewriteContentForRun(raw) {\n  const original = String(raw || '')\n  const content = original.trim()\n  if (vars.rewriteContentEachRun !== true || !content) return original\n  try {\n    const rewritten = await __callAIRewriteContent(content)\n    if (!rewritten) throw new Error('AI trả về nội dung không hợp lệ.')\n    helpers.log('Đã viết lại nội dung bằng AI')\n    return rewritten\n  } catch (e) {\n    const message = e && e.message ? String(e.message) : String(e)\n    helpers.log('AI viết lại nội dung lỗi, dùng nội dung gốc: ' + message)\n    return original\n  }\n}\n\nlet message = String(vars.campaignContent || input.campaignContent || '').trim()\nmessage = (await renderContentTemplate(message)).trim()\nmessage = (await rewriteContentForRun(message)).trim()\n\nconst images = (Array.isArray(vars.images) ? vars.images : Array.isArray(input.images) ? input.images : [])\n  .map(item => String(item || '').trim())\n  .filter(Boolean)\nconst publishHasVideo = images.some(path => /\\.(3g2|3gp|avi|m2ts|m4v|mkv|mov|mp4|mpeg|mpg|ogv|webm|wmv)(?:[?#].*)?$/i.test(path))\nconst publishTimeoutMs = publishHasVideo ? 180000 : Number(vars.facebookPublishTimeoutMs || input.facebookPublishTimeoutMs || 120000)\n\nif (!message && images.length === 0) {\n  return { ok: false, posted: false, error: 'Không có nội dung hoặc ảnh để đăng' }\n}\n\nasync function rawClick(selector, options) {\n  return await page.evaluate(`\n    const selector = __args[0];\n    const options = __args[1] || {};\n    function xpathAll(xpath) {\n      const out = [];\n      try {\n        const result = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);\n        for (let i = 0; i < result.snapshotLength; i++) {\n          const item = result.snapshotItem(i);\n          if (item) out.push(item);\n        }\n      } catch {}\n      return out;\n    }\n    function clickSynthetic(el) {\n      try { el.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch {}\n      const init = { bubbles: true, cancelable: true, view: window };\n      const p = Object.assign({}, init, { pointerId: 1, pointerType: 'mouse', isPrimary: true });\n      try { el.dispatchEvent(new PointerEvent('pointerdown', p)); } catch {}\n      try { el.dispatchEvent(new MouseEvent('mousedown', init)); } catch {}\n      try { el.dispatchEvent(new PointerEvent('pointerup', p)); } catch {}\n      try { el.dispatchEvent(new MouseEvent('mouseup', init)); } catch {}\n      try { el.click(); } catch {}\n    }\n    const arr = xpathAll(selector);\n    let el = null;\n    if (options.last === true) el = arr[arr.length - 1] || null;\n    else if (typeof options.index === 'number') el = arr[options.index] || null;\n    else el = arr[0] || null;\n    if (!el) return { clicked: false, count: arr.length, label: '' };\n    const label = el.getAttribute('aria-label') || String(el.innerText || el.textContent || '').trim();\n    clickSynthetic(el);\n    return { clicked: true, count: arr.length, label };\n  `, selector, options || {})\n}\n\nasync function rawCount(selector) {\n  return await page.evaluate(`\n    const selector = __args[0];\n    try {\n      const result = document.evaluate(selector, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);\n      return result.snapshotLength;\n    } catch {\n      return 0;\n    }\n  `, selector)\n}\n\nasync function rawText(selector) {\n  return await page.evaluate(`\n    const selector = __args[0];\n    try {\n      const result = document.evaluate(selector, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);\n      const el = result.snapshotItem(0);\n      return el ? String(el.innerText || el.textContent || '').trim() : '';\n    } catch {\n      return '';\n    }\n  `, selector)\n}\n\nasync function rawFillContent(selector, value) {\n  return await page.evaluate(`\n    const selector = __args[0];\n    const value = String(__args[1] || '').replace(/\\\\t/g, '      ');\n    function xpathAll(xpath) {\n      const out = [];\n      try {\n        const result = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);\n        for (let i = 0; i < result.snapshotLength; i++) {\n          const item = result.snapshotItem(i);\n          if (item) out.push(item);\n        }\n      } catch {}\n      return out;\n    }\n    const el = xpathAll(selector)[0] || null;\n    if (!el) return { filled: false, message: 'Không tìm thấy ô nhập nội dung' };\n    try { el.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch {}\n    try { el.focus(); } catch {}\n    const target = el.isContentEditable ? el : (el.querySelector && (el.querySelector('[contenteditable=\"true\"]') || el.querySelector('[role=\"textbox\"]'))) || el;\n    try { target.focus(); } catch {}\n    try {\n      const dt = new DataTransfer();\n      dt.setData('text/plain', value + ' ');\n      const pasteEvent = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });\n      target.dispatchEvent(pasteEvent);\n      if (target.isContentEditable) {\n        document.execCommand('insertText', false, ' ');\n      } else if ('value' in target) {\n        target.value = String(target.value || '') + value + ' ';\n        target.dispatchEvent(new Event('input', { bubbles: true }));\n        target.dispatchEvent(new Event('change', { bubbles: true }));\n      }\n      return { filled: true };\n    } catch (e) {\n      if (target.isContentEditable) {\n        document.execCommand('insertText', false, value + ' ');\n        return { filled: true };\n      }\n      return { filled: false, message: e && e.message ? e.message : String(e) };\n    }\n  `, selector, value)\n}\n\nasync function getPostUrl() {\n  return await page.evaluate(`\n    const rawSelector = __args[0];\n    const linkSelector = __args[1];\n    function xpathAll(xpath) {\n      const out = [];\n      try {\n        const result = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);\n        for (let i = 0; i < result.snapshotLength; i++) {\n          const item = result.snapshotItem(i);\n          if (item) out.push(item);\n        }\n      } catch {}\n      return out;\n    }\n    function cleanHref(href) {\n      if (!href) return '';\n      try {\n        const url = new URL(href, location.href);\n        if (/^(m|mbasic|mobile)\\\\.facebook\\\\.com$/i.test(url.hostname)) url.hostname = 'www.facebook.com';\n        url.hash = '';\n        Array.from(url.searchParams.keys()).forEach(key => {\n          if (key.startsWith('__') || key === 'mibextid' || key === 'ref' || key === 'locale') url.searchParams.delete(key);\n        });\n        return url.href;\n      } catch {\n        return String(href || '').trim();\n      }\n    }\n    const raw = xpathAll(rawSelector)[0] || null;\n    if (raw) {\n      try { raw.dispatchEvent(new FocusEvent('focusin', { bubbles: true, cancelable: true, view: window })); } catch {}\n      try { raw.focus(); } catch {}\n    }\n    const link = xpathAll(linkSelector)[0] || null;\n    return cleanHref(link ? (link.href || link.getAttribute('href') || '') : '');\n  `, rawLinkSelector, postLinkSelector)\n}\n\nhelpers.log('Đang mở composer đăng bài trên identity hiện tại')\nawait rawClick(closeSelector).catch(() => null)\nawait helpers.sleep(stepMs + 1000, signal)\nawait page.navigate('https://www.facebook.com/profile.php')\nawait helpers.sleep(stepMs + 3000, signal)\nawait rawClick(closeSelector).catch(() => null)\nawait helpers.sleep(stepMs + 1000, signal)\n\nconst openCount = await rawCount(openSelector)\nif (openCount === 0) {\n  return { ok: false, posted: false, error: 'Không tìm thấy nút tạo bài viết' }\n}\n\nconst opened = await rawClick(openSelector)\nif (!opened || opened.clicked !== true) {\n  return { ok: false, posted: false, error: 'Lỗi khi nhấn nút tạo bài post' }\n}\nawait helpers.sleep(stepMs + 1000, signal)\n\nif ((vars.postWithBackground === true || input.postWithBackground === true) && message) {\n  try {\n    helpers.log('Đang chọn phông nền bài viết')\n    const showBackgroundSelectBtn = await rawClick(backgroundButtonSelector)\n    if (showBackgroundSelectBtn && showBackgroundSelectBtn.clicked === true) {\n      await helpers.sleep(stepMs + 1000, signal)\n      const backgroundCount = await rawCount(backgroundOptionSelector)\n      if (backgroundCount > 0) {\n        const iBg = Math.floor(Math.random() * backgroundCount)\n        await rawClick(backgroundOptionSelector, { index: iBg })\n        await helpers.sleep(stepMs + 1000, signal)\n      }\n    }\n  } catch (e) {\n    const errMessage = e && e.message ? String(e.message) : String(e)\n    helpers.log('Chọn phông nền lỗi, tiếp tục đăng bài: ' + errMessage)\n  }\n}\n\nif (message) {\n  const filled = await rawFillContent(textSelector, message)\n  if (!filled || filled.filled !== true) {\n    return { ok: false, posted: false, error: 'Lỗi khi nhập nội dung bài post: ' + String(filled && filled.message ? filled.message : '') }\n  }\n  await helpers.sleep(3000, signal)\n}\n\nif (images.length > 0) {\n  helpers.log('Đang upload ' + images.length + ' ảnh vào composer')\n  const dropResult = await page.dropFile(formSelector, images)\n  if (!dropResult || dropResult.fileCount < images.length) {\n    return { ok: false, posted: false, imageCount: Number(dropResult && dropResult.fileCount || 0), error: 'Đường dẫn file media không hợp lệ hoặc upload ảnh thất bại' }\n  }\n  await helpers.sleep(stepMs + Math.max(3000, images.length * 1000), signal)\n}\n\nawait rawClick(nextSelector, { last: true }).then(r => r && r.clicked ? helpers.sleep(2000, signal) : null).catch(() => null)\nawait rawClick(reelsNextSelector).then(r => r && r.clicked ? helpers.sleep(2000, signal) : null).catch(() => null)\n\nlet clickedSubmit = false\nconst submitStarted = Date.now()\nwhile (Date.now() - submitStarted < submitTimeoutMs) {\n  const count = await rawCount(submitSelector)\n  if (count > 0) {\n    const targetIndex = count > 1 ? 1 : 0\n    const clicked = await rawClick(submitSelector, { index: targetIndex })\n    if (clicked && clicked.clicked === true) {\n      clickedSubmit = true\n      break\n    }\n  }\n  await helpers.sleep(500, signal)\n}\n\nif (!clickedSubmit) {\n  return { ok: false, posted: false, imageCount: images.length, error: 'Lỗi khi nhấn nút đăng bài' }\n}\n\nconst publishStarted = Date.now()\nawait helpers.sleep(3000, signal)\nawait rawClick(anotherTimeSelector).then(r => r && r.clicked ? helpers.sleep(stepMs + 1000, signal) : null).catch(() => null)\n\nwhile (Date.now() - publishStarted < publishTimeoutMs) {\n  if (signal.aborted) throw new Error('Đã dừng chờ xác nhận đăng bài fanpage')\n  const count = await rawCount(submitSelector)\n  if (count > 0) {\n    await helpers.sleep(Math.min(500, Math.max(0, publishTimeoutMs - (Date.now() - publishStarted))), signal)\n    continue\n  }\n  break\n}\n\nif (await rawCount(submitSelector) > 0) {\n  const errorMessage = await rawText(errorSelector)\n  return {\n    ok: false,\n    posted: false,\n    imageCount: images.length,\n    error: 'Đăng bài thất bại: ' + (errorMessage || 'Form đăng bài chưa đóng sau ' + (publishTimeoutMs / 1000) + ' giây')\n  }\n}\n\nawait helpers.sleep(stepMs + 3000, signal)\nawait rawClick(closeSelector).catch(() => null)\nawait helpers.sleep(stepMs + 1000, signal)\nconst postUrl = String(await getPostUrl() || '').trim()\nhelpers.log('Đăng bài bằng giao diện thành công')\n\nreturn {\n  ok: true,\n  posted: true,\n  mode: 'ui',\n  postUrl,\n  imageCount: images.length\n}\n\n\n} catch (e) {\n  if (signal && signal.aborted) throw e\n  const message = e && e.message ? String(e.message) : String(e)\n  helpers.log('Đăng bài bằng giao diện lỗi: ' + message)\n  return { ok: false, posted: false, mode: 'ui', postUrl: '', imageCount: 0, error: message }\n}\n",
      "code_md5": "239989a1ee6bd5d91b9a22659014094a"
    }
  ],
  "workflows": [
    {
      "id": 1,
      "name": "facebook_group_post",
      "checksum": "e8c94e8c8ec48310eda32eebc95ba59a",
      "nodes": [
        {
          "node_id": "click_post",
          "block_id": 30,
          "block_name": "fb_click_post_button",
          "config": {
            "screenshotCaptureTiming": "after",
            "screenshotCaptureOn": "failure"
          }
        },
        {
          "node_id": "verify_submit",
          "block_id": 2624,
          "block_name": "fb_verify_group_post_form_closed",
          "config": {
            "screenshotCaptureTiming": "after",
            "screenshotCaptureOn": "failure"
          }
        }
      ]
    },
    {
      "id": 226,
      "name": "facebook_page_post",
      "checksum": "fa6cd2ac020fcdd7d4f629753e2f00e2",
      "nodes": [
        {
          "node_id": "post_current_identity_ui",
          "block_id": 2672,
          "block_name": "fb_post_current_identity_ui",
          "config": {
            "screenshotCaptureTiming": "after",
            "screenshotCaptureOn": "failure"
          }
        },
        {
          "node_id": "post_page_api",
          "block_id": 2669,
          "block_name": "fb_page_post_api",
          "config": {
            "screenshotCaptureTiming": "after",
            "screenshotCaptureOn": "failure"
          }
        }
      ]
    },
    {
      "id": 2,
      "name": "facebook_timeline_post",
      "checksum": "9c88463fd2d4f7fa6416007c0c78b705",
      "nodes": [
        {
          "node_id": "post_reels",
          "block_id": 37,
          "block_name": "fb_post_reels",
          "config": {
            "screenshotCaptureTiming": "after",
            "screenshotCaptureOn": "failure"
          }
        },
        {
          "node_id": "click_post",
          "block_id": 30,
          "block_name": "fb_click_post_button",
          "config": {
            "screenshotCaptureTiming": "after",
            "screenshotCaptureOn": "failure",
            "verifyPostAfterClick": true
          }
        }
      ]
    },
    {
      "id": 252,
      "name": "facebook_group_post__test__facebook_group_post",
      "checksum": "68d9bb877a0ea6666f94b19d87aa242f",
      "nodes": [
        {
          "node_id": "click_post",
          "block_id": 30,
          "block_name": "fb_click_post_button",
          "config": {
            "screenshotCaptureTiming": "after",
            "screenshotCaptureOn": "failure"
          }
        },
        {
          "node_id": "verify_submit",
          "block_id": 2624,
          "block_name": "fb_verify_group_post_form_closed",
          "config": {
            "screenshotCaptureTiming": "after",
            "screenshotCaptureOn": "failure"
          }
        }
      ]
    },
    {
      "id": 250,
      "name": "facebook_page_post__test__facebook_page_post",
      "checksum": "a8d5c6885bf913b3a650319d4f2fb465",
      "nodes": [
        {
          "node_id": "post_current_identity_ui",
          "block_id": 2672,
          "block_name": "fb_post_current_identity_ui",
          "config": {
            "screenshotCaptureTiming": "after",
            "screenshotCaptureOn": "failure"
          }
        },
        {
          "node_id": "post_page_api",
          "block_id": 2669,
          "block_name": "fb_page_post_api",
          "config": {
            "screenshotCaptureTiming": "after",
            "screenshotCaptureOn": "failure"
          }
        }
      ]
    },
    {
      "id": 251,
      "name": "facebook_timeline_post__test__facebook_timeline_post",
      "checksum": "15b21e6b481a54a38a49f3a7e75575c3",
      "nodes": [
        {
          "node_id": "post_reels",
          "block_id": 37,
          "block_name": "fb_post_reels",
          "config": {
            "screenshotCaptureTiming": "after",
            "screenshotCaptureOn": "failure"
          }
        },
        {
          "node_id": "click_post",
          "block_id": 30,
          "block_name": "fb_click_post_button",
          "config": {
            "screenshotCaptureTiming": "after",
            "screenshotCaptureOn": "failure",
            "verifyPostAfterClick": true
          }
        }
      ]
    }
  ]
}
$publish_patch$::jsonb;
  v_item jsonb;
  v_node jsonb;
  v_row jsonb;
  v_nodes jsonb;
  v_index integer;
  v_count integer;
BEGIN
  -- Lock/check every touched row before the first write. An unexpected edit
  -- aborts this transaction instead of restoring an older live snapshot.
  FOR v_item IN SELECT value FROM jsonb_array_elements(v_patch->'blocks') ORDER BY (value->>'id')::bigint LOOP
    SELECT to_jsonb(b) INTO v_row FROM public.auto_blocks b
    WHERE b.id=(v_item->>'id')::bigint AND b.name=v_item->>'name' FOR UPDATE;
    IF v_row IS NULL OR md5(v_row::text) IS DISTINCT FROM v_item->>'checksum' THEN
      RAISE EXCEPTION 'v278 live block % changed; recapture live row before patching',v_item->>'name';
    END IF;
  END LOOP;
  FOR v_item IN SELECT value FROM jsonb_array_elements(v_patch->'workflows') ORDER BY (value->>'id')::bigint LOOP
    SELECT to_jsonb(w) INTO v_row FROM public.auto_workflows w
    WHERE w.id=(v_item->>'id')::bigint AND w.name=v_item->>'name' FOR UPDATE;
    IF v_row IS NULL OR md5(v_row::text) IS DISTINCT FROM v_item->>'checksum' THEN
      RAISE EXCEPTION 'v278 live workflow % changed; recapture live row before patching',v_item->>'name';
    END IF;
  END LOOP;

  FOR v_item IN SELECT value FROM jsonb_array_elements(v_patch->'blocks') LOOP
    UPDATE public.auto_blocks SET code=v_item->>'code',updated_at=now()
    WHERE id=(v_item->>'id')::bigint;
    IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id=(v_item->>'id')::bigint AND md5(code)=v_item->>'code_md5') THEN
      RAISE EXCEPTION 'v278 block % postflight failed',v_item->>'name';
    END IF;
  END LOOP;
  FOR v_item IN SELECT value FROM jsonb_array_elements(v_patch->'workflows') LOOP
    SELECT nodes::jsonb INTO v_nodes FROM public.auto_workflows WHERE id=(v_item->>'id')::bigint;
    FOR v_node IN SELECT value FROM jsonb_array_elements(v_item->'nodes') LOOP
      SELECT count(*),min(ord::integer-1) INTO v_count,v_index
      FROM jsonb_array_elements(v_nodes) WITH ORDINALITY AS n(value,ord)
      WHERE value->>'id'=v_node->>'node_id'
        AND value->>'blockName'=v_node->>'block_name'
        AND value->>'blockId'=v_node->>'block_id'
        AND coalesce(value->>'codeOverride','')='';
      IF v_count<>1 THEN RAISE EXCEPTION 'v278 workflow % node % mismatch',v_item->>'name',v_node->>'node_id'; END IF;
      v_nodes:=jsonb_set(v_nodes,ARRAY[v_index::text,'config'],coalesce(v_nodes->v_index->'config','{}'::jsonb)||(v_node->'config'),true);
    END LOOP;
    UPDATE public.auto_workflows SET nodes=v_nodes,updated_at=now() WHERE id=(v_item->>'id')::bigint;
    IF NOT EXISTS (SELECT 1 FROM public.auto_workflows WHERE id=(v_item->>'id')::bigint AND nodes::jsonb=v_nodes) THEN
      RAISE EXCEPTION 'v278 workflow % postflight failed',v_item->>'name';
    END IF;
  END LOOP;
END;
$facebook_publish$;
COMMIT;
