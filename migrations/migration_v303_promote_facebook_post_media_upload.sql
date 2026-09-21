-- v303: Promote user-tested post media overrides into shared blocks.
-- Source: live blocks AND live workflow codeOverride, captured 2026-09-21
-- from linked production cgjbsmqtfhqvttudyjzq. No historical body is restored.
-- Update only block code/updated_at and remove three matching test overrides.
-- No RPC/schema changes, helper DDL, extra connections or PostgREST reload.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $promote_post_media$
DECLARE
  v_patch jsonb := $promote_patch${
  "blocks": [
    {
      "id": 29,
      "name": "fb_drop_post_images",
      "source_md5": "e4e285f4ee864a33ddfa4881c0801a03",
      "source_code_md5": "5158ca080780a76b21bde1e0b6f3664b",
      "target_code": "\nconst imgs = Array.isArray(input.images) && input.images.length > 0\n  ? input.images\n  : (Array.isArray(vars.images) ? vars.images : [])\nif (imgs.length === 0) return { fileCount: 0 }\nconst form = await helpers.element('FbComposerForm')\nconst result = await uploadPostMediaInput(form, imgs)\nif (!result || result.fileCount !== imgs.length) {\n  throw new Error('Không đưa đủ ảnh/video vào form đăng bài')\n}\nawait helpers.sleep(2000, signal)\nreturn result\n\n// Test override only: use the composer's real file input, never drag/drop.\n// uploadFile resolves a visible container before finding its hidden file input.\nasync function uploadPostMediaInput(formXPath, files) {\n  if (signal.aborted) throw new Error('Đã dừng upload ảnh/video')\n  const token = 'post_media_' + Date.now() + '_' + Math.random().toString(36).slice(2)\n  const attribute = 'data-aka-post-media-upload'\n  const prepared = await page.evaluate(`\n    const formXPath = __args[0];\n    const token = __args[1];\n    const attribute = __args[2];\n    const fileCount = __args[3];\n    const matches = document.evaluate(formXPath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);\n    if (matches.snapshotLength !== 1) {\n      throw new Error('Cần đúng 1 form đăng bài, tìm thấy ' + matches.snapshotLength);\n    }\n    const form = matches.snapshotItem(0);\n    if (!form || form.tagName !== 'FORM') throw new Error('Element đăng bài không phải form');\n    const inputs = Array.from(form.querySelectorAll('input[type=\"file\"]'));\n    if (inputs.length !== 1) {\n      throw new Error('Cần đúng 1 input file trong form đăng bài, tìm thấy ' + inputs.length);\n    }\n    const input = inputs[0];\n    if (input.matches(':disabled')) throw new Error('Input ảnh/video đang bị vô hiệu hóa');\n    if (!/(image|video)/i.test(input.accept || '')) {\n      throw new Error('Input trong form không nhận ảnh/video');\n    }\n    if (fileCount > 1 && !input.multiple) {\n      throw new Error('Input trong form không hỗ trợ chọn nhiều ảnh/video');\n    }\n    if (form.hasAttribute(attribute)) throw new Error('Form đăng bài đang có lượt upload khác');\n    form.setAttribute(attribute, token);\n    return true;\n  `, formXPath, token, attribute, files.length)\n  if (prepared !== true) throw new Error('Không xác minh được input ảnh/video của form đăng bài')\n\n  try {\n    if (signal.aborted) throw new Error('Đã dừng upload ảnh/video')\n    // The unique form has exactly one validated file input. Passing this visible\n    // form lets the existing runtime reach the hidden input without a UI change.\n    return await page.uploadFile('form[' + attribute + '=\"' + token + '\"]', files)\n  } finally {\n    await page.evaluate(`\n      const attribute = __args[0];\n      const token = __args[1];\n      for (const form of document.querySelectorAll('form[' + attribute + ']')) {\n        if (form.getAttribute(attribute) === token) form.removeAttribute(attribute);\n      }\n    `, attribute, token).catch(() => null)\n  }\n}\n",
      "target_code_md5": "75bf3975ef06fc9a6f6b9613f248af16"
    },
    {
      "id": 2672,
      "name": "fb_post_current_identity_ui",
      "source_md5": "183052913c4a937831b58339129a15bf",
      "source_code_md5": "448a190506a6470a8b36dd8febd2382e",
      "target_code": "// Centralized AI rewrite via ai_using.\nconst __aiRewriteUsingCode = \"fb_post_current_identity_ui_rewrite\";\nconst __extractAIText = (value) => {\n  if (value === null || value === undefined) return '';\n  if (typeof value === 'string') return value.trim();\n  if (typeof value === 'number' || typeof value === 'boolean') return String(value).trim();\n  if (Array.isArray(value)) return value.map(__extractAIText).filter(Boolean).join('\\n').trim();\n  if (typeof value === 'object') {\n    const data = value;\n    const direct = data.content ?? data.data ?? data.Data ?? data.text ?? data.output ?? data.response ?? data.message ?? data.Message ?? data.answer ?? data.result;\n    if (direct !== undefined && direct !== null && direct !== value) {\n      const directText = __extractAIText(direct);\n      if (directText) return directText;\n    }\n    try { return JSON.stringify(value); } catch { return String(value); }\n  }\n  return String(value || '').trim();\n};\nconst __callCentralAI = async (usingCode, payload) => {\n  if (!usingCode) throw new Error('Thiếu mã cấu hình AI');\n  if (typeof helpers.callAIUsing !== 'function') throw new Error('Runtime chưa hỗ trợ helper callAIUsing');\n  const result = await helpers.callAIUsing(usingCode, payload || {});\n  if (result && result.unsupported) throw new Error('Runtime chưa hỗ trợ helper callAIUsing');\n  if (!result || result.ok !== true) throw new Error(String(result && result.error ? result.error : 'AI lỗi'));\n  return result;\n};\nconst __callAIText = async (usingCode, payload) => {\n  const result = await __callCentralAI(usingCode, payload);\n  return __extractAIText(result && (result.content ?? result.data ?? result.text ?? result.output ?? result.response ?? result.rawResponse ?? result));\n};\nconst __callAIRewriteContent = async (content) => {\n  const text = String(content || '');\n  return await __callAIText(__aiRewriteUsingCode, {\n    content: text,\n    question: text,\n    source: 'aka_agent'\n  });\n};\n\ntry { /* v59-safe-output-wrapper */\n\nconst stepMs = Number(vars.facebookStepMs || input.facebookStepMs || 1000)\nconst submitTimeoutMs = Number(vars.facebookSubmitTimeoutMs || input.facebookSubmitTimeoutMs || 30000)\n\nconst closeSelector = await helpers.element('FbComposerCloseDialogButton')\nconst openSelector = await helpers.element('FbComposerOpenButton')\nconst textSelector = await helpers.element('FbComposerTextInput')\nconst backgroundButtonSelector = await helpers.element('FbComposerBackgroundButton')\nconst backgroundOptionSelector = await helpers.element('FbComposerBackgroundOption')\nconst formSelector = await helpers.element('FbComposerForm')\nconst nextSelector = await helpers.element('FbComposerNextButton')\nconst reelsNextSelector = await helpers.element('FbComposerReelsNextButton')\nconst submitSelector = await helpers.element('FbComposerSubmitButton')\nconst anotherTimeSelector = await helpers.element('FbComposerAnotherTimeButton')\nconst errorSelector = await helpers.element('FbComposerErrorMessage')\nconst rawLinkSelector = await helpers.element('FbComposerRawPostLink')\nconst postLinkSelector = await helpers.element('FbComposerPostLink')\n\nfunction formatTemplateDate(dayKey, formatKey) {\n  const d = new Date()\n  const key = String(dayKey || 'TODAY').toUpperCase()\n  if (key === 'TOMORROW') d.setDate(d.getDate() + 1)\n  if (key === 'YESTERDAY') d.setDate(d.getDate() - 1)\n  const dd = String(d.getDate()).padStart(2, '0')\n  const mm = String(d.getMonth() + 1).padStart(2, '0')\n  const yyyy = String(d.getFullYear())\n  return String(formatKey || 'DD/MM/YYYY').toUpperCase() === 'MM/DD/YYYY' ? mm + '/' + dd + '/' + yyyy : dd + '/' + mm + '/' + yyyy\n}\n\nasync function renderContentTemplate(raw) {\n  let rendered = String(raw || '')\n  if (/#\\{\\s*FULL_NAME\\s*\\}/i.test(rendered)) {\n    const fullName = String(vars.campaignInputDataName || vars.inputDataName || vars.pageName || '').trim()\n    rendered = rendered.replace(/#\\{\\s*FULL_NAME\\s*\\}/gi, fullName)\n  }\n  rendered = rendered.replace(\n    /#\\{\\s*(TODAY|TOMORROW|YESTERDAY)\\s*(?:\\(\\s*(DD\\/MM\\/YYYY|MM\\/DD\\/YYYY)\\s*\\))?\\s*\\}/gi,\n    (_match, dayKey, formatKey) => formatTemplateDate(dayKey, formatKey)\n  )\n  return rendered\n}\n\nasync function rewriteContentForRun(raw) {\n  const original = String(raw || '')\n  const content = original.trim()\n  if (vars.rewriteContentEachRun !== true || !content) return original\n  try {\n    const rewritten = await __callAIRewriteContent(content)\n    if (!rewritten) throw new Error('AI trả về nội dung không hợp lệ.')\n    helpers.log('Đã viết lại nội dung bằng AI')\n    return rewritten\n  } catch (e) {\n    const message = e && e.message ? String(e.message) : String(e)\n    helpers.log('AI viết lại nội dung lỗi, dùng nội dung gốc: ' + message)\n    return original\n  }\n}\n\nlet message = String(vars.campaignContent || input.campaignContent || '').trim()\nmessage = (await renderContentTemplate(message)).trim()\nmessage = (await rewriteContentForRun(message)).trim()\n\nconst images = (Array.isArray(vars.images) ? vars.images : Array.isArray(input.images) ? input.images : [])\n  .map(item => String(item || '').trim())\n  .filter(Boolean)\nconst publishHasVideo = images.some(path => /^data:video\\//i.test(String(path || '')) || /\\.(3g2|3gp|avi|m2ts|m4v|mkv|mov|mp4|mpeg|mpg|ogv|webm|wmv)(?:[?#].*)?$/i.test(path))\nconst publishTimeoutMs = publishHasVideo ? 180000 : Number(vars.facebookPublishTimeoutMs || input.facebookPublishTimeoutMs || 120000)\n\nif (!message && images.length === 0) {\n  return { ok: false, posted: false, error: 'Không có nội dung hoặc ảnh để đăng' }\n}\n\nasync function rawClick(selector, options) {\n  return await page.evaluate(`\n    const selector = __args[0];\n    const options = __args[1] || {};\n    function xpathAll(xpath) {\n      const out = [];\n      try {\n        const result = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);\n        for (let i = 0; i < result.snapshotLength; i++) {\n          const item = result.snapshotItem(i);\n          if (item) out.push(item);\n        }\n      } catch {}\n      return out;\n    }\n    function clickSynthetic(el) {\n      try { el.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch {}\n      const init = { bubbles: true, cancelable: true, view: window };\n      const p = Object.assign({}, init, { pointerId: 1, pointerType: 'mouse', isPrimary: true });\n      try { el.dispatchEvent(new PointerEvent('pointerdown', p)); } catch {}\n      try { el.dispatchEvent(new MouseEvent('mousedown', init)); } catch {}\n      try { el.dispatchEvent(new PointerEvent('pointerup', p)); } catch {}\n      try { el.dispatchEvent(new MouseEvent('mouseup', init)); } catch {}\n      try { el.click(); } catch {}\n    }\n    const arr = xpathAll(selector);\n    let el = null;\n    if (options.last === true) el = arr[arr.length - 1] || null;\n    else if (typeof options.index === 'number') el = arr[options.index] || null;\n    else el = arr[0] || null;\n    if (!el) return { clicked: false, count: arr.length, label: '' };\n    const label = el.getAttribute('aria-label') || String(el.innerText || el.textContent || '').trim();\n    clickSynthetic(el);\n    return { clicked: true, count: arr.length, label };\n  `, selector, options || {})\n}\n\nasync function rawCount(selector) {\n  return await page.evaluate(`\n    const selector = __args[0];\n    try {\n      const result = document.evaluate(selector, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);\n      return result.snapshotLength;\n    } catch {\n      return 0;\n    }\n  `, selector)\n}\n\nasync function rawText(selector) {\n  return await page.evaluate(`\n    const selector = __args[0];\n    try {\n      const result = document.evaluate(selector, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);\n      const el = result.snapshotItem(0);\n      return el ? String(el.innerText || el.textContent || '').trim() : '';\n    } catch {\n      return '';\n    }\n  `, selector)\n}\n\nasync function rawFillContent(selector, value) {\n  return await page.evaluate(`\n    const selector = __args[0];\n    const value = String(__args[1] || '').replace(/\\\\t/g, '      ');\n    function xpathAll(xpath) {\n      const out = [];\n      try {\n        const result = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);\n        for (let i = 0; i < result.snapshotLength; i++) {\n          const item = result.snapshotItem(i);\n          if (item) out.push(item);\n        }\n      } catch {}\n      return out;\n    }\n    const el = xpathAll(selector)[0] || null;\n    if (!el) return { filled: false, message: 'Không tìm thấy ô nhập nội dung' };\n    try { el.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch {}\n    try { el.focus(); } catch {}\n    const target = el.isContentEditable ? el : (el.querySelector && (el.querySelector('[contenteditable=\"true\"]') || el.querySelector('[role=\"textbox\"]'))) || el;\n    try { target.focus(); } catch {}\n    try {\n      const dt = new DataTransfer();\n      dt.setData('text/plain', value + ' ');\n      const pasteEvent = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });\n      target.dispatchEvent(pasteEvent);\n      if (target.isContentEditable) {\n        document.execCommand('insertText', false, ' ');\n      } else if ('value' in target) {\n        target.value = String(target.value || '') + value + ' ';\n        target.dispatchEvent(new Event('input', { bubbles: true }));\n        target.dispatchEvent(new Event('change', { bubbles: true }));\n      }\n      return { filled: true };\n    } catch (e) {\n      if (target.isContentEditable) {\n        document.execCommand('insertText', false, value + ' ');\n        return { filled: true };\n      }\n      return { filled: false, message: e && e.message ? e.message : String(e) };\n    }\n  `, selector, value)\n}\n\nasync function getPostUrl() {\n  return await page.evaluate(`\n    const rawSelector = __args[0];\n    const linkSelector = __args[1];\n    function xpathAll(xpath) {\n      const out = [];\n      try {\n        const result = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);\n        for (let i = 0; i < result.snapshotLength; i++) {\n          const item = result.snapshotItem(i);\n          if (item) out.push(item);\n        }\n      } catch {}\n      return out;\n    }\n    function cleanHref(href) {\n      if (!href) return '';\n      try {\n        const url = new URL(href, location.href);\n        if (/^(m|mbasic|mobile)\\\\.facebook\\\\.com$/i.test(url.hostname)) url.hostname = 'www.facebook.com';\n        url.hash = '';\n        Array.from(url.searchParams.keys()).forEach(key => {\n          if (key.startsWith('__') || key === 'mibextid' || key === 'ref' || key === 'locale') url.searchParams.delete(key);\n        });\n        return url.href;\n      } catch {\n        return String(href || '').trim();\n      }\n    }\n    const raw = xpathAll(rawSelector)[0] || null;\n    if (raw) {\n      try { raw.dispatchEvent(new FocusEvent('focusin', { bubbles: true, cancelable: true, view: window })); } catch {}\n      try { raw.focus(); } catch {}\n    }\n    const link = xpathAll(linkSelector)[0] || null;\n    return cleanHref(link ? (link.href || link.getAttribute('href') || '') : '');\n  `, rawLinkSelector, postLinkSelector)\n}\n\nhelpers.log('Đang mở composer đăng bài trên identity hiện tại')\nawait rawClick(closeSelector).catch(() => null)\nawait helpers.sleep(stepMs + 1000, signal)\nawait page.navigate('https://www.facebook.com/profile.php')\nawait helpers.sleep(stepMs + 3000, signal)\nawait rawClick(closeSelector).catch(() => null)\nawait helpers.sleep(stepMs + 1000, signal)\n\nconst openCount = await rawCount(openSelector)\nif (openCount === 0) {\n  return { ok: false, posted: false, error: 'Không tìm thấy nút tạo bài viết' }\n}\n\nconst opened = await rawClick(openSelector)\nif (!opened || opened.clicked !== true) {\n  return { ok: false, posted: false, error: 'Lỗi khi nhấn nút tạo bài post' }\n}\nawait helpers.sleep(stepMs + 1000, signal)\n\nif ((vars.postWithBackground === true || input.postWithBackground === true) && message) {\n  try {\n    helpers.log('Đang chọn phông nền bài viết')\n    const showBackgroundSelectBtn = await rawClick(backgroundButtonSelector)\n    if (showBackgroundSelectBtn && showBackgroundSelectBtn.clicked === true) {\n      await helpers.sleep(stepMs + 1000, signal)\n      const backgroundCount = await rawCount(backgroundOptionSelector)\n      if (backgroundCount > 0) {\n        const iBg = Math.floor(Math.random() * backgroundCount)\n        await rawClick(backgroundOptionSelector, { index: iBg })\n        await helpers.sleep(stepMs + 1000, signal)\n      }\n    }\n  } catch (e) {\n    const errMessage = e && e.message ? String(e.message) : String(e)\n    helpers.log('Chọn phông nền lỗi, tiếp tục đăng bài: ' + errMessage)\n  }\n}\n\nif (message) {\n  const filled = await rawFillContent(textSelector, message)\n  if (!filled || filled.filled !== true) {\n    return { ok: false, posted: false, error: 'Lỗi khi nhập nội dung bài post: ' + String(filled && filled.message ? filled.message : '') }\n  }\n  await helpers.sleep(3000, signal)\n}\n\nif (images.length > 0) {\n  helpers.log('Đang upload ' + images.length + ' ảnh vào composer')\n  const uploadResult = await uploadPostMediaInput(formSelector, images)\n  if (!uploadResult || uploadResult.fileCount !== images.length) {\n    return { ok: false, posted: false, imageCount: Number(uploadResult && uploadResult.fileCount || 0), error: 'Đường dẫn file media không hợp lệ hoặc upload ảnh thất bại' }\n  }\n  await helpers.sleep(stepMs + Math.max(3000, images.length * 1000), signal)\n}\n\nawait rawClick(nextSelector, { last: true }).then(r => r && r.clicked ? helpers.sleep(2000, signal) : null).catch(() => null)\nawait rawClick(reelsNextSelector).then(r => r && r.clicked ? helpers.sleep(2000, signal) : null).catch(() => null)\n\nlet clickedSubmit = false\nconst submitStarted = Date.now()\nwhile (Date.now() - submitStarted < submitTimeoutMs) {\n  const count = await rawCount(submitSelector)\n  if (count > 0) {\n    const targetIndex = count > 1 ? 1 : 0\n    const clicked = await rawClick(submitSelector, { index: targetIndex })\n    if (clicked && clicked.clicked === true) {\n      clickedSubmit = true\n      break\n    }\n  }\n  await helpers.sleep(500, signal)\n}\n\nif (!clickedSubmit) {\n  return { ok: false, posted: false, imageCount: images.length, error: 'Lỗi khi nhấn nút đăng bài' }\n}\n\nconst publishStarted = Date.now()\nawait helpers.sleep(3000, signal)\nawait rawClick(anotherTimeSelector).then(r => r && r.clicked ? helpers.sleep(stepMs + 1000, signal) : null).catch(() => null)\n\nwhile (Date.now() - publishStarted < publishTimeoutMs) {\n  if (signal.aborted) throw new Error('Đã dừng chờ xác nhận đăng bài fanpage')\n  const count = await rawCount(submitSelector)\n  if (count > 0) {\n    await helpers.sleep(Math.min(500, Math.max(0, publishTimeoutMs - (Date.now() - publishStarted))), signal)\n    continue\n  }\n  break\n}\n\nif (await rawCount(submitSelector) > 0) {\n  const errorMessage = await rawText(errorSelector)\n  return {\n    ok: false,\n    posted: false,\n    imageCount: images.length,\n    error: 'Đăng bài thất bại: ' + (errorMessage || 'Form đăng bài chưa đóng sau ' + (publishTimeoutMs / 1000) + ' giây')\n  }\n}\n\nawait helpers.sleep(stepMs + 3000, signal)\nawait rawClick(closeSelector).catch(() => null)\nawait helpers.sleep(stepMs + 1000, signal)\nconst postUrl = String(await getPostUrl() || '').trim()\nhelpers.log('Đăng bài bằng giao diện thành công')\n\nreturn {\n  ok: true,\n  posted: true,\n  mode: 'ui',\n  postUrl,\n  imageCount: images.length\n}\n\n\n} catch (e) {\n  if (signal && signal.aborted) throw e\n  const message = e && e.message ? String(e.message) : String(e)\n  helpers.log('Đăng bài bằng giao diện lỗi: ' + message)\n  return { ok: false, posted: false, mode: 'ui', postUrl: '', imageCount: 0, error: message }\n}\n\n// Test override only: use the composer's real file input, never drag/drop.\n// uploadFile resolves a visible container before finding its hidden file input.\nasync function uploadPostMediaInput(formXPath, files) {\n  if (signal.aborted) throw new Error('Đã dừng upload ảnh/video')\n  const token = 'post_media_' + Date.now() + '_' + Math.random().toString(36).slice(2)\n  const attribute = 'data-aka-post-media-upload'\n  const prepared = await page.evaluate(`\n    const formXPath = __args[0];\n    const token = __args[1];\n    const attribute = __args[2];\n    const fileCount = __args[3];\n    const matches = document.evaluate(formXPath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);\n    if (matches.snapshotLength !== 1) {\n      throw new Error('Cần đúng 1 form đăng bài, tìm thấy ' + matches.snapshotLength);\n    }\n    const form = matches.snapshotItem(0);\n    if (!form || form.tagName !== 'FORM') throw new Error('Element đăng bài không phải form');\n    const inputs = Array.from(form.querySelectorAll('input[type=\"file\"]'));\n    if (inputs.length !== 1) {\n      throw new Error('Cần đúng 1 input file trong form đăng bài, tìm thấy ' + inputs.length);\n    }\n    const input = inputs[0];\n    if (input.matches(':disabled')) throw new Error('Input ảnh/video đang bị vô hiệu hóa');\n    if (!/(image|video)/i.test(input.accept || '')) {\n      throw new Error('Input trong form không nhận ảnh/video');\n    }\n    if (fileCount > 1 && !input.multiple) {\n      throw new Error('Input trong form không hỗ trợ chọn nhiều ảnh/video');\n    }\n    if (form.hasAttribute(attribute)) throw new Error('Form đăng bài đang có lượt upload khác');\n    form.setAttribute(attribute, token);\n    return true;\n  `, formXPath, token, attribute, files.length)\n  if (prepared !== true) throw new Error('Không xác minh được input ảnh/video của form đăng bài')\n\n  try {\n    if (signal.aborted) throw new Error('Đã dừng upload ảnh/video')\n    // The unique form has exactly one validated file input. Passing this visible\n    // form lets the existing runtime reach the hidden input without a UI change.\n    return await page.uploadFile('form[' + attribute + '=\"' + token + '\"]', files)\n  } finally {\n    await page.evaluate(`\n      const attribute = __args[0];\n      const token = __args[1];\n      for (const form of document.querySelectorAll('form[' + attribute + ']')) {\n        if (form.getAttribute(attribute) === token) form.removeAttribute(attribute);\n      }\n    `, attribute, token).catch(() => null)\n  }\n}\n",
      "target_code_md5": "c42c9828416a761a782f4cf12bdff9f7"
    }
  ],
  "workflows": [
    {
      "id": 1,
      "name": "facebook_group_post",
      "source_md5": "3c229f52be88728aaeea9f289262758a"
    },
    {
      "id": 2,
      "name": "facebook_timeline_post",
      "source_md5": "d648fceddb7b73616aa44d9d2e7a65b7"
    },
    {
      "id": 226,
      "name": "facebook_page_post",
      "source_md5": "fc9fc5f118ee5ae51305b6dbc1049440"
    },
    {
      "id": 250,
      "name": "facebook_page_post__test__facebook_page_post",
      "source_md5": "9af1350dd141448bc591ad1cf9e90d13",
      "node_id": "post_current_identity_ui",
      "block_id": 2672
    },
    {
      "id": 251,
      "name": "facebook_timeline_post__test__facebook_timeline_post",
      "source_md5": "a0de1cc5f4d544464939966ab6906b93",
      "node_id": "drop_images",
      "block_id": 29
    },
    {
      "id": 252,
      "name": "facebook_group_post__test__facebook_group_post",
      "source_md5": "88cd29386d0c67a4237573a51370f4b6",
      "node_id": "drop_images",
      "block_id": 29
    }
  ],
  "actions": [
    {
      "id": "facebook_page_post",
      "source_md5": "e006e3d205f79ff263fab425597b8f9c",
      "workflow_id": 226,
      "test_workflow_id": 250
    },
    {
      "id": "facebook_timeline_post",
      "source_md5": "55b3a9c9daf3a2ed79b1581d3b4c3701",
      "workflow_id": 2,
      "test_workflow_id": 251
    },
    {
      "id": "facebook_group_post",
      "source_md5": "29a92e9d790fe4e9d31ae1c4ef8bdce2",
      "workflow_id": 1,
      "test_workflow_id": 252
    }
  ],
  "element": {
    "id": 1545,
    "name": "FbComposerForm",
    "source_md5": "837a2952487d9b92c0e35b532cb9cd46"
  }
}$promote_patch$;
  v_item jsonb;
  v_row jsonb;
  v_before jsonb;
  v_nodes jsonb;
  v_node jsonb;
  v_codes jsonb := '{}'::jsonb;
  v_block_rows jsonb := '{}'::jsonb;
  v_workflow_rows jsonb := '{}'::jsonb;
  v_count integer;
BEGIN
  PERFORM 1 FROM public.auto_blocks WHERE id IN (29,2672) ORDER BY id FOR UPDATE;
  PERFORM 1 FROM public.auto_elements WHERE id=1545 FOR SHARE;
  PERFORM 1 FROM public.auto_campaign_actions
    WHERE id IN ('facebook_group_post','facebook_timeline_post','facebook_page_post') ORDER BY id FOR SHARE;
  PERFORM 1 FROM public.auto_workflows WHERE id IN (1,2,226,250,251,252) ORDER BY id FOR UPDATE;

  -- Preflight the entire current row, not just an old migration's code fragment.
  FOR v_item IN SELECT value FROM jsonb_array_elements(v_patch->'blocks') LOOP
    SELECT to_jsonb(b) INTO v_row FROM public.auto_blocks b WHERE b.id=(v_item->>'id')::bigint;
    IF v_row IS NULL OR md5(v_row::text) IS DISTINCT FROM v_item->>'source_md5'
      OR md5(v_row->>'code') IS DISTINCT FROM v_item->>'source_code_md5' THEN
      RAISE EXCEPTION 'v303 live block drift: %; recapture before applying',v_item->>'name';
    END IF;
    IF md5(v_item->>'target_code') IS DISTINCT FROM v_item->>'target_code_md5' THEN
      RAISE EXCEPTION 'v303 target code checksum mismatch: %',v_item->>'name';
    END IF;
    v_codes := v_codes || jsonb_build_object(v_item->>'id',v_item->>'target_code');
    v_block_rows := v_block_rows || jsonb_build_object(v_item->>'id',v_row);
  END LOOP;

  SELECT to_jsonb(e) INTO v_row FROM public.auto_elements e WHERE e.id=1545;
  IF v_row IS NULL OR md5(v_row::text) IS DISTINCT FROM v_patch#>>'{element,source_md5}' THEN
    RAISE EXCEPTION 'v303 FbComposerForm drift';
  END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(v_patch->'actions') LOOP
    SELECT to_jsonb(a) INTO v_row FROM public.auto_campaign_actions a WHERE a.id=v_item->>'id';
    IF v_row IS NULL OR md5(v_row::text) IS DISTINCT FROM v_item->>'source_md5' THEN
      RAISE EXCEPTION 'v303 real/test action mapping drift: %',v_item->>'id';
    END IF;
  END LOOP;

  FOR v_item IN SELECT value FROM jsonb_array_elements(v_patch->'workflows') LOOP
    SELECT to_jsonb(w) INTO v_row FROM public.auto_workflows w WHERE w.id=(v_item->>'id')::bigint;
    IF v_row IS NULL OR md5(v_row::text) IS DISTINCT FROM v_item->>'source_md5' THEN
      RAISE EXCEPTION 'v303 live workflow drift: %; recapture before applying',v_item->>'name';
    END IF;
    v_workflow_rows := v_workflow_rows || jsonb_build_object(v_item->>'id',v_row);
    IF v_item ? 'node_id' THEN
      SELECT count(*) INTO v_count FROM jsonb_array_elements(v_row->'nodes') n
        WHERE n->>'id'=v_item->>'node_id' AND n->>'blockId'=v_item->>'block_id'
          AND n->>'codeOverride'=v_codes->>(v_item->>'block_id');
      IF v_count <> 1 THEN
        RAISE EXCEPTION 'v303 tested override differs from promotion target: %',v_item->>'name';
      END IF;
    END IF;
  END LOOP;

  FOR v_item IN SELECT value FROM jsonb_array_elements(v_patch->'blocks') LOOP
    UPDATE public.auto_blocks SET code=v_item->>'target_code',updated_at=now()
      WHERE id=(v_item->>'id')::bigint;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    IF v_count <> 1 THEN RAISE EXCEPTION 'v303 block update count mismatch'; END IF;
    SELECT to_jsonb(b) INTO v_row FROM public.auto_blocks b WHERE b.id=(v_item->>'id')::bigint;
    v_before := v_block_rows->(v_item->>'id');
    IF md5(v_row->>'code') IS DISTINCT FROM v_item->>'target_code_md5'
      OR (v_row - 'code' - 'updated_at') IS DISTINCT FROM (v_before - 'code' - 'updated_at') THEN
      RAISE EXCEPTION 'v303 block postflight failed: %',v_item->>'name';
    END IF;
  END LOOP;

  FOR v_item IN SELECT value FROM jsonb_array_elements(v_patch->'workflows') WHERE value ? 'node_id' LOOP
    v_before := v_workflow_rows->(v_item->>'id');
    SELECT jsonb_agg(CASE WHEN n->>'id'=v_item->>'node_id' THEN n - 'codeOverride' ELSE n END ORDER BY ord)
      INTO v_nodes FROM jsonb_array_elements(v_before->'nodes') WITH ORDINALITY AS nodes(n,ord);
    UPDATE public.auto_workflows SET nodes=v_nodes,updated_at=now() WHERE id=(v_item->>'id')::bigint;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    IF v_count <> 1 THEN RAISE EXCEPTION 'v303 workflow update count mismatch'; END IF;
    SELECT to_jsonb(w) INTO v_row FROM public.auto_workflows w WHERE w.id=(v_item->>'id')::bigint;
    IF v_row->'nodes' IS DISTINCT FROM v_nodes
      OR (v_row - 'nodes' - 'updated_at') IS DISTINCT FROM (v_before - 'nodes' - 'updated_at') THEN
      RAISE EXCEPTION 'v303 workflow postflight failed: %',v_item->>'name';
    END IF;
    SELECT n INTO v_node FROM jsonb_array_elements(v_row->'nodes') n WHERE n->>'id'=v_item->>'node_id';
    IF v_node ? 'codeOverride' OR NOT EXISTS (SELECT 1 FROM public.auto_blocks b
      WHERE b.id=(v_node->>'blockId')::bigint AND b.code=v_codes->>(v_item->>'block_id')) THEN
      RAISE EXCEPTION 'v303 test workflow no longer resolves the tested code: %',v_item->>'name';
    END IF;
  END LOOP;

  FOR v_item IN SELECT value FROM jsonb_array_elements(v_patch->'workflows') WHERE NOT value ? 'node_id' LOOP
    IF NOT EXISTS (SELECT 1 FROM public.auto_workflows w WHERE w.id=(v_item->>'id')::bigint
      AND md5(to_jsonb(w)::text)=v_item->>'source_md5') THEN
      RAISE EXCEPTION 'v303 real workflow graph changed: %',v_item->>'name';
    END IF;
  END LOOP;
END;
$promote_post_media$;
COMMIT;
