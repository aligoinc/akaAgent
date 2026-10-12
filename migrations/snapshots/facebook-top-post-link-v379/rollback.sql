-- Restore only v379 changes. Keep the added block for persisted run-step references.
BEGIN;
SET LOCAL timezone='UTC';
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='8s';
SELECT id FROM public.auto_blocks WHERE id=2672 FOR UPDATE;
SELECT id FROM public.auto_workflows WHERE id IN (2,251) ORDER BY id FOR UPDATE;
DO $rollback$
DECLARE new_block_id bigint;
BEGIN
SELECT id INTO STRICT new_block_id FROM public.auto_blocks WHERE name='fb_get_first_profile_post_link';
IF (SELECT to_jsonb(t)-'updated_at' FROM public.auto_blocks t WHERE id=2672) IS DISTINCT FROM ('{"category":"facebook","code":"// Centralized AI rewrite via ai_using.\nconst __aiRewriteUsingCode = \"fb_post_current_identity_ui_rewrite\";\nconst __extractAIText = (value) => {\n  if (value === null || value === undefined) return '''';\n  if (typeof value === ''string'') return value.trim();\n  if (typeof value === ''number'' || typeof value === ''boolean'') return String(value).trim();\n  if (Array.isArray(value)) return value.map(__extractAIText).filter(Boolean).join(''\\n'').trim();\n  if (typeof value === ''object'') {\n    const data = value;\n    const direct = data.content ?? data.data ?? data.Data ?? data.text ?? data.output ?? data.response ?? data.message ?? data.Message ?? data.answer ?? data.result;\n    if (direct !== undefined && direct !== null && direct !== value) {\n      const directText = __extractAIText(direct);\n      if (directText) return directText;\n    }\n    try { return JSON.stringify(value); } catch { return String(value); }\n  }\n  return String(value || '''').trim();\n};\nconst __callCentralAI = async (usingCode, payload) => {\n  if (!usingCode) throw new Error(''Thiếu mã cấu hình AI'');\n  if (typeof helpers.callAIUsing !== ''function'') throw new Error(''Runtime chưa hỗ trợ helper callAIUsing'');\n  const result = await helpers.callAIUsing(usingCode, payload || {});\n  if (result && result.unsupported) throw new Error(''Runtime chưa hỗ trợ helper callAIUsing'');\n  if (!result || result.ok !== true) throw new Error(String(result && result.error ? result.error : ''AI lỗi''));\n  return result;\n};\nconst __callAIText = async (usingCode, payload) => {\n  const result = await __callCentralAI(usingCode, payload);\n  return __extractAIText(result && (result.content ?? result.data ?? result.text ?? result.output ?? result.response ?? result.rawResponse ?? result));\n};\nconst __callAIRewriteContent = async (content) => {\n  const text = String(content || '''');\n  return await __callAIText(__aiRewriteUsingCode, {\n    content: text,\n    question: text,\n    source: ''aka_agent''\n  });\n};\n\ntry { /* v59-safe-output-wrapper */\n\nconst stepMs = Number(vars.facebookStepMs || input.facebookStepMs || 1000)\nconst submitTimeoutMs = Number(vars.facebookSubmitTimeoutMs || input.facebookSubmitTimeoutMs || 30000)\n\nconst closeSelector = await helpers.element(''FbComposerCloseDialogButton'')\nconst openSelector = await helpers.element(''FbComposerOpenButton'')\nconst textSelector = await helpers.element(''FbComposerTextInput'')\nconst backgroundButtonSelector = await helpers.element(''FbComposerBackgroundButton'')\nconst backgroundOptionSelector = await helpers.element(''FbComposerBackgroundOption'')\nconst formSelector = await helpers.element(''FbComposerForm'')\nconst nextSelector = await helpers.element(''FbComposerNextButton'')\nconst reelsNextSelector = await helpers.element(''FbComposerReelsNextButton'')\nconst submitSelector = await helpers.element(''FbComposerSubmitButton'')\nconst anotherTimeSelector = await helpers.element(''FbComposerAnotherTimeButton'')\nconst errorSelector = await helpers.element(''FbComposerErrorMessage'')\nconst rawLinkSelector = await helpers.element(''FbComposerRawPostLink'')\nconst postLinkSelector = await helpers.element(''FbComposerPostLink'')\n\nfunction formatTemplateDate(dayKey, formatKey) {\n  const d = new Date()\n  const key = String(dayKey || ''TODAY'').toUpperCase()\n  if (key === ''TOMORROW'') d.setDate(d.getDate() + 1)\n  if (key === ''YESTERDAY'') d.setDate(d.getDate() - 1)\n  const dd = String(d.getDate()).padStart(2, ''0'')\n  const mm = String(d.getMonth() + 1).padStart(2, ''0'')\n  const yyyy = String(d.getFullYear())\n  return String(formatKey || ''DD/MM/YYYY'').toUpperCase() === ''MM/DD/YYYY'' ? mm + ''/'' + dd + ''/'' + yyyy : dd + ''/'' + mm + ''/'' + yyyy\n}\n\nasync function renderContentTemplate(raw) {\n  let rendered = String(raw || '''')\n  if (/#\\{\\s*FULL_NAME\\s*\\}/i.test(rendered)) {\n    const fullName = String(vars.campaignInputDataName || vars.inputDataName || vars.pageName || '''').trim()\n    rendered = rendered.replace(/#\\{\\s*FULL_NAME\\s*\\}/gi, fullName)\n  }\n  rendered = rendered.replace(\n    /#\\{\\s*(TODAY|TOMORROW|YESTERDAY)\\s*(?:\\(\\s*(DD\\/MM\\/YYYY|MM\\/DD\\/YYYY)\\s*\\))?\\s*\\}/gi,\n    (_match, dayKey, formatKey) => formatTemplateDate(dayKey, formatKey)\n  )\n  return rendered\n}\n\nasync function rewriteContentForRun(raw) {\n  const original = String(raw || '''')\n  const content = original.trim()\n  if (vars.rewriteContentEachRun !== true || !content) return original\n  try {\n    const rewritten = await __callAIRewriteContent(content)\n    if (!rewritten) throw new Error(''AI trả về nội dung không hợp lệ.'')\n    helpers.log(''Đã viết lại nội dung bằng AI'')\n    return rewritten\n  } catch (e) {\n    const message = e && e.message ? String(e.message) : String(e)\n    helpers.log(''AI viết lại nội dung lỗi, dùng nội dung gốc: '' + message)\n    return original\n  }\n}\n\nlet message\nif (typeof helpers.prepareCampaignContent === ''function'') {\n  const prepared = await helpers.prepareCampaignContent({\n    rewriteCode: __aiRewriteUsingCode,\n    sourceText: vars.campaignSourceText || '''',\n    sourceMedia: vars.campaignSourceMedia || []\n  })\n  message = prepared.content\n  vars.campaignContent = prepared.content\n  vars.images = prepared.media\n  vars.contentVariantIndex = prepared.variantIndex\n} else {\n  message = String(vars.campaignContent || input.campaignContent || '''').trim()\n  message = (await renderContentTemplate(message)).trim()\n  message = (await rewriteContentForRun(message)).trim()\n}\n\nconst images = (Array.isArray(vars.images) ? vars.images : Array.isArray(input.images) ? input.images : [])\n  .map(item => String(item || '''').trim())\n  .filter(Boolean)\nconst publishHasVideo = images.some(path => /^data:video\\//i.test(String(path || '''')) || /\\.(3g2|3gp|avi|m2ts|m4v|mkv|mov|mp4|mpeg|mpg|ogv|webm|wmv)(?:[?#].*)?$/i.test(path))\nconst publishTimeoutMs = publishHasVideo ? 180000 : Number(vars.facebookPublishTimeoutMs || input.facebookPublishTimeoutMs || 120000)\n\nif (!message && images.length === 0) {\n  return { ok: false, posted: false, error: ''Không có nội dung hoặc ảnh để đăng'' }\n}\n\nasync function rawClick(selector, options) {\n  return await page.evaluate(`\n    const selector = __args[0];\n    const options = __args[1] || {};\n    function xpathAll(xpath) {\n      const out = [];\n      try {\n        const result = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);\n        for (let i = 0; i < result.snapshotLength; i++) {\n          const item = result.snapshotItem(i);\n          if (item) out.push(item);\n        }\n      } catch {}\n      return out;\n    }\n    function clickSynthetic(el) {\n      try { el.scrollIntoView({ block: ''center'', inline: ''nearest'' }); } catch {}\n      const init = { bubbles: true, cancelable: true, view: window };\n      const p = Object.assign({}, init, { pointerId: 1, pointerType: ''mouse'', isPrimary: true });\n      try { el.dispatchEvent(new PointerEvent(''pointerdown'', p)); } catch {}\n      try { el.dispatchEvent(new MouseEvent(''mousedown'', init)); } catch {}\n      try { el.dispatchEvent(new PointerEvent(''pointerup'', p)); } catch {}\n      try { el.dispatchEvent(new MouseEvent(''mouseup'', init)); } catch {}\n      try { el.click(); } catch {}\n    }\n    const arr = xpathAll(selector);\n    let el = null;\n    if (options.last === true) el = arr[arr.length - 1] || null;\n    else if (typeof options.index === ''number'') el = arr[options.index] || null;\n    else el = arr[0] || null;\n    if (!el) return { clicked: false, count: arr.length, label: '''' };\n    const label = el.getAttribute(''aria-label'') || String(el.innerText || el.textContent || '''').trim();\n    clickSynthetic(el);\n    return { clicked: true, count: arr.length, label };\n  `, selector, options || {})\n}\n\nasync function rawCount(selector) {\n  return await page.evaluate(`\n    const selector = __args[0];\n    try {\n      const result = document.evaluate(selector, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);\n      return result.snapshotLength;\n    } catch {\n      return 0;\n    }\n  `, selector)\n}\n\nasync function rawText(selector) {\n  return await page.evaluate(`\n    const selector = __args[0];\n    try {\n      const result = document.evaluate(selector, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);\n      const el = result.snapshotItem(0);\n      return el ? String(el.innerText || el.textContent || '''').trim() : '''';\n    } catch {\n      return '''';\n    }\n  `, selector)\n}\n\nasync function rawFillContent(selector, value) {\n  return await page.evaluate(`\n    const selector = __args[0];\n    const value = String(__args[1] || '''').replace(/\\\\t/g, ''      '');\n    function xpathAll(xpath) {\n      const out = [];\n      try {\n        const result = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);\n        for (let i = 0; i < result.snapshotLength; i++) {\n          const item = result.snapshotItem(i);\n          if (item) out.push(item);\n        }\n      } catch {}\n      return out;\n    }\n    const el = xpathAll(selector)[0] || null;\n    if (!el) return { filled: false, message: ''Không tìm thấy ô nhập nội dung'' };\n    try { el.scrollIntoView({ block: ''center'', inline: ''nearest'' }); } catch {}\n    try { el.focus(); } catch {}\n    const target = el.isContentEditable ? el : (el.querySelector && (el.querySelector(''[contenteditable=\"true\"]'') || el.querySelector(''[role=\"textbox\"]''))) || el;\n    try { target.focus(); } catch {}\n    try {\n      const dt = new DataTransfer();\n      dt.setData(''text/plain'', value + '' '');\n      const pasteEvent = new ClipboardEvent(''paste'', { clipboardData: dt, bubbles: true, cancelable: true });\n      target.dispatchEvent(pasteEvent);\n      if (target.isContentEditable) {\n        document.execCommand(''insertText'', false, '' '');\n      } else if (''value'' in target) {\n        target.value = String(target.value || '''') + value + '' '';\n        target.dispatchEvent(new Event(''input'', { bubbles: true }));\n        target.dispatchEvent(new Event(''change'', { bubbles: true }));\n      }\n      return { filled: true };\n    } catch (e) {\n      if (target.isContentEditable) {\n        document.execCommand(''insertText'', false, value + '' '');\n        return { filled: true };\n      }\n      return { filled: false, message: e && e.message ? e.message : String(e) };\n    }\n  `, selector, value)\n}\n\nasync function getPostUrl() {\n  return await page.evaluate(`\n    const rawSelector = __args[0];\n    const linkSelector = __args[1];\n    function xpathAll(xpath) {\n      const out = [];\n      try {\n        const result = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);\n        for (let i = 0; i < result.snapshotLength; i++) {\n          const item = result.snapshotItem(i);\n          if (item) out.push(item);\n        }\n      } catch {}\n      return out;\n    }\n    function cleanHref(href) {\n      if (!href) return '''';\n      try {\n        const url = new URL(href, location.href);\n        if (/^(m|mbasic|mobile)\\\\.facebook\\\\.com$/i.test(url.hostname)) url.hostname = ''www.facebook.com'';\n        url.hash = '''';\n        Array.from(url.searchParams.keys()).forEach(key => {\n          if (key.startsWith(''__'') || key === ''mibextid'' || key === ''ref'' || key === ''locale'') url.searchParams.delete(key);\n        });\n        return url.href;\n      } catch {\n        return String(href || '''').trim();\n      }\n    }\n    const raw = xpathAll(rawSelector)[0] || null;\n    if (raw) {\n      try { raw.dispatchEvent(new FocusEvent(''focusin'', { bubbles: true, cancelable: true, view: window })); } catch {}\n      try { raw.focus(); } catch {}\n      await new Promise(resolve => setTimeout(resolve, 700));\n    }\n    const link = xpathAll(linkSelector)[0] || null;\n    return cleanHref(link ? (link.href || link.getAttribute(''href'') || '''') : '''');\n  `, rawLinkSelector, postLinkSelector)\n}\n\nhelpers.log(''Đang mở composer đăng bài trên identity hiện tại'')\nawait rawClick(closeSelector).catch(() => null)\nawait helpers.sleep(stepMs + 1000, signal)\nawait page.navigate(''https://www.facebook.com/profile.php'')\nawait helpers.sleep(stepMs + 3000, signal)\nawait rawClick(closeSelector).catch(() => null)\nawait helpers.sleep(stepMs + 1000, signal)\n\nconst openCount = await rawCount(openSelector)\nif (openCount === 0) {\n  return { ok: false, posted: false, error: ''Không tìm thấy nút tạo bài viết'' }\n}\n\nconst opened = await rawClick(openSelector)\nif (!opened || opened.clicked !== true) {\n  return { ok: false, posted: false, error: ''Lỗi khi nhấn nút tạo bài post'' }\n}\nawait helpers.sleep(stepMs + 1000, signal)\n\nif ((vars.postWithBackground === true || input.postWithBackground === true) && message) {\n  try {\n    helpers.log(''Đang chọn phông nền bài viết'')\n    const showBackgroundSelectBtn = await rawClick(backgroundButtonSelector)\n    if (showBackgroundSelectBtn && showBackgroundSelectBtn.clicked === true) {\n      await helpers.sleep(stepMs + 1000, signal)\n      const backgroundCount = await rawCount(backgroundOptionSelector)\n      if (backgroundCount > 0) {\n        const iBg = Math.floor(Math.random() * backgroundCount)\n        await rawClick(backgroundOptionSelector, { index: iBg })\n        await helpers.sleep(stepMs + 1000, signal)\n      }\n    }\n  } catch (e) {\n    const errMessage = e && e.message ? String(e.message) : String(e)\n    helpers.log(''Chọn phông nền lỗi, tiếp tục đăng bài: '' + errMessage)\n  }\n}\n\nif (message) {\n  const filled = await rawFillContent(textSelector, message)\n  if (!filled || filled.filled !== true) {\n    return { ok: false, posted: false, error: ''Lỗi khi nhập nội dung bài post: '' + String(filled && filled.message ? filled.message : '''') }\n  }\n  await helpers.sleep(3000, signal)\n}\n\nif (images.length > 0) {\n  helpers.log(''Đang upload '' + images.length + '' ảnh vào composer'')\n  const uploadResult = await uploadPostMediaInput(formSelector, images)\n  if (!uploadResult || uploadResult.fileCount !== images.length) {\n    return { ok: false, posted: false, imageCount: Number(uploadResult && uploadResult.fileCount || 0), error: ''Đường dẫn file media không hợp lệ hoặc upload ảnh thất bại'' }\n  }\n  await helpers.sleep(stepMs + Math.max(3000, images.length * 1000), signal)\n}\n\nawait rawClick(nextSelector, { last: true }).then(r => r && r.clicked ? helpers.sleep(2000, signal) : null).catch(() => null)\nawait rawClick(reelsNextSelector).then(r => r && r.clicked ? helpers.sleep(2000, signal) : null).catch(() => null)\n\nlet clickedSubmit = false\nconst submitStarted = Date.now()\nwhile (Date.now() - submitStarted < submitTimeoutMs) {\n  const count = await rawCount(submitSelector)\n  if (count > 0) {\n    const targetIndex = count > 1 ? 1 : 0\n    const clicked = await rawClick(submitSelector, { index: targetIndex })\n    if (clicked && clicked.clicked === true) {\n      clickedSubmit = true\n      break\n    }\n  }\n  await helpers.sleep(500, signal)\n}\n\nif (!clickedSubmit) {\n  return { ok: false, posted: false, imageCount: images.length, error: ''Lỗi khi nhấn nút đăng bài'' }\n}\n\nconst publishStarted = Date.now()\nawait helpers.sleep(3000, signal)\nawait rawClick(anotherTimeSelector).then(r => r && r.clicked ? helpers.sleep(stepMs + 1000, signal) : null).catch(() => null)\n\nwhile (Date.now() - publishStarted < publishTimeoutMs) {\n  if (signal.aborted) throw new Error(''Đã dừng chờ xác nhận đăng bài fanpage'')\n  const count = await rawCount(submitSelector)\n  if (count > 0) {\n    await helpers.sleep(Math.min(500, Math.max(0, publishTimeoutMs - (Date.now() - publishStarted))), signal)\n    continue\n  }\n  break\n}\n\nif (await rawCount(submitSelector) > 0) {\n  const errorMessage = await rawText(errorSelector)\n  return {\n    ok: false,\n    posted: false,\n    imageCount: images.length,\n    error: ''Đăng bài thất bại: '' + (errorMessage || ''Form đăng bài chưa đóng sau '' + (publishTimeoutMs / 1000) + '' giây'')\n  }\n}\n\nawait helpers.sleep(stepMs + 3000, signal)\nawait rawClick(closeSelector).catch(() => null)\nawait helpers.sleep(stepMs + 1000, signal)\nconst postUrl = String(await getPostUrl().catch(() => '''') || '''').trim()\nhelpers.log(''Đăng bài bằng giao diện thành công'')\n\nreturn {\n  ok: true,\n  posted: true,\n  mode: ''ui'',\n  postUrl,\n  imageCount: images.length\n}\n\n\n} catch (e) {\n  if (signal && signal.aborted) throw e\n  const message = e && e.message ? String(e.message) : String(e)\n  helpers.log(''Đăng bài bằng giao diện lỗi: '' + message)\n  return { ok: false, posted: false, mode: ''ui'', postUrl: '''', imageCount: 0, error: message }\n}\n\n// Prefer the composer''s real file input; use legacy drop only when none exists.\n// uploadFile resolves a visible container before finding its hidden file input.\nasync function uploadPostMediaInput(formXPath, files) {\n  if (signal.aborted) throw new Error(''Đã dừng upload ảnh/video'')\n  const token = ''post_media_'' + Date.now() + ''_'' + Math.random().toString(36).slice(2)\n  const attribute = ''data-aka-post-media-upload''\n  const prepared = await page.evaluate(`\n    const formXPath = __args[0];\n    const token = __args[1];\n    const attribute = __args[2];\n    const fileCount = __args[3];\n    const matches = document.evaluate(formXPath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);\n    if (matches.snapshotLength !== 1) {\n      throw new Error(''Cần đúng 1 form đăng bài, tìm thấy '' + matches.snapshotLength);\n    }\n    const form = matches.snapshotItem(0);\n    if (!form || form.tagName !== ''FORM'') throw new Error(''Element đăng bài không phải form'');\n    const inputs = Array.from(form.querySelectorAll(''input[type=\"file\"]''));\n    if (inputs.length === 0) {\n      if (form.hasAttribute(attribute)) throw new Error(''Form đăng bài đang có lượt upload khác'');\n      form.setAttribute(attribute, token);\n      return ''drop'';\n    }\n    if (inputs.length !== 1) {\n      throw new Error(''Cần đúng 1 input file trong form đăng bài, tìm thấy '' + inputs.length);\n    }\n    const input = inputs[0];\n    if (input.matches('':disabled'')) throw new Error(''Input ảnh/video đang bị vô hiệu hóa'');\n    if (!/(image|video)/i.test(input.accept || '''')) {\n      throw new Error(''Input trong form không nhận ảnh/video'');\n    }\n    if (fileCount > 1 && !input.multiple) {\n      throw new Error(''Input trong form không hỗ trợ chọn nhiều ảnh/video'');\n    }\n    if (form.hasAttribute(attribute)) throw new Error(''Form đăng bài đang có lượt upload khác'');\n    form.setAttribute(attribute, token);\n    return ''upload'';\n  `, formXPath, token, attribute, files.length)\n  if (prepared !== ''upload'' && prepared !== ''drop'') throw new Error(''Không xác minh được input ảnh/video của form đăng bài'')\n\n  try {\n    if (signal.aborted) throw new Error(''Đã dừng upload ảnh/video'')\n    const selector = ''form['' + attribute + ''=\"'' + token + ''\"]''\n    if (prepared === ''drop'') return await page.dropFile(selector, files)\n    // The visible form contains exactly one validated, possibly hidden file input.\n    return await page.uploadFile(selector, files)\n  } finally {\n    await page.evaluate(`\n      const attribute = __args[0];\n      const token = __args[1];\n      for (const form of document.querySelectorAll(''form['' + attribute + '']'')) {\n        if (form.getAttribute(attribute) === token) form.removeAttribute(attribute);\n      }\n    `, attribute, token).catch(() => null)\n  }\n}\n","config_schema":[{"label":"Nội dung","name":"campaignContent","type":"string"},{"label":"Ảnh","name":"images","type":"array"},{"label":"Step delay","name":"facebookStepMs","type":"number"}],"created_at":"2026-05-23T05:52:27.137819+00:00","default_config":{"facebookPublishTimeoutMs":120000,"facebookStepMs":1000,"facebookSubmitTimeoutMs":30000},"description":"Đăng bài bằng giao diện lên Facebook identity hiện đang được chọn.","icon":"Send","id":2672,"is_builtin":true,"kind":"js","name":"fb_post_current_identity_ui","organization_id":null,"output_schema":[{"label":"OK","name":"ok","type":"boolean"},{"label":"Đã đăng","name":"posted","type":"boolean"},{"label":"Post URL","name":"postUrl","type":"string"},{"label":"Số ảnh","name":"imageCount","type":"number"},{"label":"Lỗi","name":"error","type":"string"}],"staff_id":null,"system_type":null,"updated_at":"2026-10-06T10:14:35.142327+00:00"}'::jsonb-'updated_at') THEN RAISE EXCEPTION 'v379 rollback: page drift'; END IF;
IF (SELECT to_jsonb(t)-'updated_at'-'nodes' FROM public.auto_workflows t WHERE id=2) IS DISTINCT FROM ('{"created_at":"2026-04-26T17:29:28.86938+00:00","default_variables":{"campaignContent":"","campaignContentPreparationVersion":1,"copyContentFromSource":false,"images":[],"includeSourceImages":false,"postAsReels":false,"rewriteSourceContentWithAI":false,"sharePost":false,"sourceContentAiPrompt":"","sourceLink":"","videoPath":""},"description":"Workflow đăng bài lên trang cá nhân (gộp các biến thể: default / share / reels / copy-source qua ifElse)","edges":[{"id":"e-nav-wait_main","source":"nav","target":"wait_main"},{"id":"e-wait_main-if_reels","source":"wait_main","target":"if_reels"},{"id":"e-if_reels-post_reels-true","source":"if_reels","sourceHandle":"true","target":"post_reels"},{"id":"e-if_reels-if_share-false","source":"if_reels","sourceHandle":"false","target":"if_share"},{"id":"e-if_share-share_post-true","source":"if_share","sourceHandle":"true","target":"share_post"},{"id":"e-if_share-if_copy-false","source":"if_share","sourceHandle":"false","target":"if_copy"},{"id":"e-if_copy-scrape-true","source":"if_copy","sourceHandle":"true","target":"scrape"},{"id":"e-if_copy-merge_compose-false","source":"if_copy","sourceHandle":"false","target":"merge_compose"},{"id":"e-scrape-nav_home_after_scrape","source":"scrape","target":"source_ai_prompt"},{"id":"e-nav_home_after_scrape-wait_main_after_scrape","source":"nav_home_after_scrape","target":"wait_main_after_scrape"},{"id":"e-wait_main_after_scrape-merge_compose","source":"wait_main_after_scrape","target":"merge_compose"},{"id":"e-merge_compose-nav_profile","source":"merge_compose","target":"nav_profile"},{"id":"e-if_composer_opened-sleep_after_open-true","source":"if_composer_opened","sourceHandle":"true","target":"sleep_after_open"},{"id":"e-sleep_after_open-type_content","source":"sleep_after_open","target":"type_content"},{"id":"e-type_content-drop_images","source":"type_content","target":"drop_images"},{"id":"e-drop_images-sleep_after_drop","source":"drop_images","target":"sleep_after_drop"},{"id":"e-sleep_after_drop-click_post","source":"sleep_after_drop","target":"click_post"},{"id":"e-post_reels-merge_all","source":"post_reels","target":"merge_all"},{"id":"e-share_post-merge_all","source":"share_post","target":"merge_all"},{"id":"e-click_post-get_post_link","source":"click_post","target":"get_post_link"},{"id":"e-source-ai-nav-home-after-scrape","source":"source_ai_prompt","target":"nav_home_after_scrape"},{"id":"e-open_composer-if_composer_opened","source":"open_composer","target":"if_composer_opened"},{"id":"e-nav_profile-open_composer","source":"nav_profile","target":"open_composer"},{"id":"e-get_post_link-merge_all","source":"get_post_link","target":"merge_all"}],"id":2,"is_builtin":true,"name":"facebook_timeline_post","nodes":[{"blockId":5,"blockName":"nav_to_url","config":{"url":"https://www.facebook.com"},"id":"nav","position":{"x":100,"y":0}},{"blockId":21,"blockName":"wait_for_selector","config":{"selector":"//*[@role=''main'']","timeout":10000},"id":"wait_main","position":{"x":100,"y":100}},{"blockId":1,"blockName":"if_else","config":{"condition":"vars.postAsReels === true"},"id":"if_reels","position":{"x":100,"y":200},"systemType":"ifElse"},{"blockId":37,"blockName":"fb_post_reels","config":{"screenshotCaptureOn":"failure","screenshotCaptureTiming":"after"},"id":"post_reels","position":{"x":0,"y":300}},{"blockId":1,"blockName":"if_else","config":{"condition":"vars.sharePost === true && !!vars.sourceLink"},"id":"if_share","position":{"x":200,"y":300},"systemType":"ifElse"},{"blockId":36,"blockName":"fb_share_post","config":{},"id":"share_post","position":{"x":100,"y":400}},{"blockId":1,"blockName":"if_else","config":{"condition":"vars.copyContentFromSource === true && !!vars.sourceLink"},"id":"if_copy","position":{"x":300,"y":400},"systemType":"ifElse"},{"blockId":35,"blockName":"fb_scrape_post","config":{},"id":"scrape","position":{"x":200,"y":500}},{"blockId":5,"blockName":"nav_to_url","config":{"url":"https://www.facebook.com"},"id":"nav_home_after_scrape","label":"Quay về trang chủ FB","position":{"x":200,"y":580}},{"blockId":21,"blockName":"wait_for_selector","config":{"selector":"//*[@role=''main'']","timeout":10000},"id":"wait_main_after_scrape","position":{"x":200,"y":660}},{"blockId":4,"blockName":"merge","config":{"mode":"any"},"id":"merge_compose","position":{"x":300,"y":740},"systemType":"merge"},{"blockId":27,"blockName":"fb_open_composer","config":{"composerActionCode":"fb_post_my_profile"},"id":"open_composer","position":{"x":300,"y":820}},{"blockId":20,"blockName":"sleep","config":{"ms":2000},"id":"sleep_after_open","position":{"x":300,"y":900}},{"blockId":28,"blockName":"fb_type_post_content","config":{},"id":"type_content","position":{"x":300,"y":980}},{"blockId":29,"blockName":"fb_drop_post_images","config":{},"id":"drop_images","position":{"x":300,"y":1060}},{"blockId":20,"blockName":"sleep","config":{"ms":5000},"id":"sleep_after_drop","position":{"x":300,"y":1140}},{"blockId":30,"blockName":"fb_click_post_button","config":{"screenshotCaptureOn":"failure","screenshotCaptureTiming":"after","verifyPostAfterClick":true},"id":"click_post","position":{"x":300,"y":1220}},{"blockId":4,"blockName":"merge","config":{"mode":"any"},"id":"merge_all","position":{"x":200,"y":1340},"systemType":"merge"},{"blockId":2674,"blockName":"fb_rewrite_source_content_ai","config":{},"id":"source_ai_prompt","label":"AI edit nội dung nguồn","position":{"x":200,"y":540}},{"blockId":1,"blockName":"if_else","config":{"condition":"input.opened === true"},"id":"if_composer_opened","position":{"x":520,"y":880},"systemType":"ifElse"}],"organization_id":1,"staff_id":1,"updated_at":"2026-10-09T19:44:00.999739+00:00","variables_schema":[{"label":"Nội dung bài","name":"campaignContent","type":"string"},{"label":"Ảnh","name":"images","type":"array"},{"label":"Đăng dưới dạng Reels","name":"postAsReels","type":"boolean"},{"label":"Chia sẻ từ source link","name":"sharePost","type":"boolean"},{"label":"Copy nội dung từ source","name":"copyContentFromSource","type":"boolean"},{"label":"Source link (cho share/copy)","name":"sourceLink","type":"string"},{"label":"Đường dẫn video (cho reels)","name":"videoPath","type":"string"},{"label":"Lấy kèm ảnh từ source","name":"includeSourceImages","type":"boolean"},{"label":"Lời nhắc AI - Edit lại nội dung","name":"rewriteSourceContentWithAI","type":"boolean"},{"label":"Lời nhắc AI","name":"sourceContentAiPrompt","placeholder":"Viết lại nội dung sau: [content]","type":"textarea"}]}'::jsonb-'updated_at'-'nodes')
OR (SELECT nodes FROM public.auto_workflows WHERE id=2) IS DISTINCT FROM ('[{"blockId":5,"blockName":"nav_to_url","config":{"url":"https://www.facebook.com"},"id":"nav","position":{"x":100,"y":0}},{"blockId":21,"blockName":"wait_for_selector","config":{"selector":"//*[@role=''main'']","timeout":10000},"id":"wait_main","position":{"x":100,"y":100}},{"blockId":1,"blockName":"if_else","config":{"condition":"vars.postAsReels === true"},"id":"if_reels","position":{"x":100,"y":200},"systemType":"ifElse"},{"blockId":37,"blockName":"fb_post_reels","config":{"screenshotCaptureOn":"failure","screenshotCaptureTiming":"after"},"id":"post_reels","position":{"x":0,"y":300}},{"blockId":1,"blockName":"if_else","config":{"condition":"vars.sharePost === true && !!vars.sourceLink"},"id":"if_share","position":{"x":200,"y":300},"systemType":"ifElse"},{"blockId":36,"blockName":"fb_share_post","config":{},"id":"share_post","position":{"x":100,"y":400}},{"blockId":1,"blockName":"if_else","config":{"condition":"vars.copyContentFromSource === true && !!vars.sourceLink"},"id":"if_copy","position":{"x":300,"y":400},"systemType":"ifElse"},{"blockId":35,"blockName":"fb_scrape_post","config":{},"id":"scrape","position":{"x":200,"y":500}},{"blockId":5,"blockName":"nav_to_url","config":{"url":"https://www.facebook.com"},"id":"nav_home_after_scrape","label":"Quay về trang chủ FB","position":{"x":200,"y":580}},{"blockId":21,"blockName":"wait_for_selector","config":{"selector":"//*[@role=''main'']","timeout":10000},"id":"wait_main_after_scrape","position":{"x":200,"y":660}},{"blockId":4,"blockName":"merge","config":{"mode":"any"},"id":"merge_compose","position":{"x":300,"y":740},"systemType":"merge"},{"blockId":27,"blockName":"fb_open_composer","config":{"composerActionCode":"fb_post_my_profile"},"id":"open_composer","position":{"x":300,"y":820}},{"blockId":20,"blockName":"sleep","config":{"ms":2000},"id":"sleep_after_open","position":{"x":300,"y":900}},{"blockId":28,"blockName":"fb_type_post_content","config":{},"id":"type_content","position":{"x":300,"y":980}},{"blockId":29,"blockName":"fb_drop_post_images","config":{},"id":"drop_images","position":{"x":300,"y":1060}},{"blockId":20,"blockName":"sleep","config":{"ms":5000},"id":"sleep_after_drop","position":{"x":300,"y":1140}},{"blockId":30,"blockName":"fb_click_post_button","config":{"screenshotCaptureOn":"failure","screenshotCaptureTiming":"after","verifyPostAfterClick":true},"id":"click_post","position":{"x":300,"y":1220}},{"blockId":4,"blockName":"merge","config":{"mode":"any"},"id":"merge_all","position":{"x":200,"y":1340},"systemType":"merge"},{"blockId":2674,"blockName":"fb_rewrite_source_content_ai","config":{},"id":"source_ai_prompt","label":"AI edit nội dung nguồn","position":{"x":200,"y":540}},{"blockId":1,"blockName":"if_else","config":{"condition":"input.opened === true"},"id":"if_composer_opened","position":{"x":520,"y":880},"systemType":"ifElse"},{"id":"nav_profile","blockId":5,"blockName":"nav_to_url","label":"Mở trang cá nhân","config":{"url":"https://www.facebook.com/profile.php"},"position":{"x":300,"y":780}}]'::jsonb || jsonb_build_array('{"id":"get_post_link","blockName":"fb_get_first_profile_post_link","label":"Lấy link bài trên cùng","config":{},"position":{"x":300,"y":1280}}'::jsonb || jsonb_build_object('blockId',new_block_id))) THEN RAISE EXCEPTION 'v379 rollback: workflow 2 drift'; END IF;
UPDATE public.auto_workflows SET nodes='[{"blockId":5,"blockName":"nav_to_url","config":{"url":"https://www.facebook.com"},"id":"nav","position":{"x":100,"y":0}},{"blockId":21,"blockName":"wait_for_selector","config":{"selector":"//*[@role=''main'']","timeout":10000},"id":"wait_main","position":{"x":100,"y":100}},{"blockId":1,"blockName":"if_else","config":{"condition":"vars.postAsReels === true"},"id":"if_reels","position":{"x":100,"y":200},"systemType":"ifElse"},{"blockId":37,"blockName":"fb_post_reels","config":{"screenshotCaptureOn":"failure","screenshotCaptureTiming":"after"},"id":"post_reels","position":{"x":0,"y":300}},{"blockId":1,"blockName":"if_else","config":{"condition":"vars.sharePost === true && !!vars.sourceLink"},"id":"if_share","position":{"x":200,"y":300},"systemType":"ifElse"},{"blockId":36,"blockName":"fb_share_post","config":{},"id":"share_post","position":{"x":100,"y":400}},{"blockId":1,"blockName":"if_else","config":{"condition":"vars.copyContentFromSource === true && !!vars.sourceLink"},"id":"if_copy","position":{"x":300,"y":400},"systemType":"ifElse"},{"blockId":35,"blockName":"fb_scrape_post","config":{},"id":"scrape","position":{"x":200,"y":500}},{"blockId":5,"blockName":"nav_to_url","config":{"url":"https://www.facebook.com"},"id":"nav_home_after_scrape","label":"Quay về trang chủ FB","position":{"x":200,"y":580}},{"blockId":21,"blockName":"wait_for_selector","config":{"selector":"//*[@role=''main'']","timeout":10000},"id":"wait_main_after_scrape","position":{"x":200,"y":660}},{"blockId":4,"blockName":"merge","config":{"mode":"any"},"id":"merge_compose","position":{"x":300,"y":740},"systemType":"merge"},{"blockId":27,"blockName":"fb_open_composer","config":{"composerActionCode":"fb_post_my_profile"},"id":"open_composer","position":{"x":300,"y":820}},{"blockId":20,"blockName":"sleep","config":{"ms":2000},"id":"sleep_after_open","position":{"x":300,"y":900}},{"blockId":28,"blockName":"fb_type_post_content","config":{},"id":"type_content","position":{"x":300,"y":980}},{"blockId":29,"blockName":"fb_drop_post_images","config":{},"id":"drop_images","position":{"x":300,"y":1060}},{"blockId":20,"blockName":"sleep","config":{"ms":5000},"id":"sleep_after_drop","position":{"x":300,"y":1140}},{"blockId":30,"blockName":"fb_click_post_button","config":{"screenshotCaptureOn":"failure","screenshotCaptureTiming":"after","verifyPostAfterClick":true},"id":"click_post","position":{"x":300,"y":1220}},{"blockId":4,"blockName":"merge","config":{"mode":"any"},"id":"merge_all","position":{"x":200,"y":1340},"systemType":"merge"},{"blockId":2674,"blockName":"fb_rewrite_source_content_ai","config":{},"id":"source_ai_prompt","label":"AI edit nội dung nguồn","position":{"x":200,"y":540}},{"blockId":1,"blockName":"if_else","config":{"condition":"input.opened === true"},"id":"if_composer_opened","position":{"x":520,"y":880},"systemType":"ifElse"}]'::jsonb,edges='[{"id":"e-nav-wait_main","source":"nav","target":"wait_main"},{"id":"e-wait_main-if_reels","source":"wait_main","target":"if_reels"},{"id":"e-if_reels-post_reels-true","source":"if_reels","sourceHandle":"true","target":"post_reels"},{"id":"e-if_reels-if_share-false","source":"if_reels","sourceHandle":"false","target":"if_share"},{"id":"e-if_share-share_post-true","source":"if_share","sourceHandle":"true","target":"share_post"},{"id":"e-if_share-if_copy-false","source":"if_share","sourceHandle":"false","target":"if_copy"},{"id":"e-if_copy-scrape-true","source":"if_copy","sourceHandle":"true","target":"scrape"},{"id":"e-if_copy-merge_compose-false","source":"if_copy","sourceHandle":"false","target":"merge_compose"},{"id":"e-scrape-nav_home_after_scrape","source":"scrape","target":"source_ai_prompt"},{"id":"e-nav_home_after_scrape-wait_main_after_scrape","source":"nav_home_after_scrape","target":"wait_main_after_scrape"},{"id":"e-wait_main_after_scrape-merge_compose","source":"wait_main_after_scrape","target":"merge_compose"},{"id":"e-merge_compose-open_composer","source":"merge_compose","target":"open_composer"},{"id":"e-if_composer_opened-sleep_after_open-true","source":"if_composer_opened","sourceHandle":"true","target":"sleep_after_open"},{"id":"e-sleep_after_open-type_content","source":"sleep_after_open","target":"type_content"},{"id":"e-type_content-drop_images","source":"type_content","target":"drop_images"},{"id":"e-drop_images-sleep_after_drop","source":"drop_images","target":"sleep_after_drop"},{"id":"e-sleep_after_drop-click_post","source":"sleep_after_drop","target":"click_post"},{"id":"e-post_reels-merge_all","source":"post_reels","target":"merge_all"},{"id":"e-share_post-merge_all","source":"share_post","target":"merge_all"},{"id":"e-click_post-merge_all","source":"click_post","target":"merge_all"},{"id":"e-source-ai-nav-home-after-scrape","source":"source_ai_prompt","target":"nav_home_after_scrape"},{"id":"e-open_composer-if_composer_opened","source":"open_composer","target":"if_composer_opened"}]'::jsonb,updated_at='2026-10-09T19:44:00.999739+00:00' WHERE id=2;
IF (SELECT to_jsonb(t)-'updated_at'-'nodes' FROM public.auto_workflows t WHERE id=251) IS DISTINCT FROM ('{"created_at":"2026-06-03T10:01:07.982314+00:00","default_variables":{"campaignContent":"","campaignContentPreparationVersion":1,"copyContentFromSource":false,"images":[],"includeSourceImages":false,"postAsReels":false,"rewriteSourceContentWithAI":false,"sharePost":false,"sourceContentAiPrompt":"","sourceLink":"","videoPath":""},"description":"Workflow đăng bài lên trang cá nhân (gộp các biến thể: default / share / reels / copy-source qua ifElse)","edges":[{"id":"e-nav-wait_main","source":"nav","target":"wait_main"},{"id":"e-wait_main-if_reels","source":"wait_main","target":"if_reels"},{"id":"e-if_reels-post_reels-true","source":"if_reels","sourceHandle":"true","target":"post_reels"},{"id":"e-if_reels-if_share-false","source":"if_reels","sourceHandle":"false","target":"if_share"},{"id":"e-if_share-share_post-true","source":"if_share","sourceHandle":"true","target":"share_post"},{"id":"e-if_share-if_copy-false","source":"if_share","sourceHandle":"false","target":"if_copy"},{"id":"e-if_copy-scrape-true","source":"if_copy","sourceHandle":"true","target":"scrape"},{"id":"e-if_copy-merge_compose-false","source":"if_copy","sourceHandle":"false","target":"merge_compose"},{"id":"e-scrape-nav_home_after_scrape","source":"scrape","target":"source_ai_prompt"},{"id":"e-nav_home_after_scrape-wait_main_after_scrape","source":"nav_home_after_scrape","target":"wait_main_after_scrape"},{"id":"e-wait_main_after_scrape-merge_compose","source":"wait_main_after_scrape","target":"merge_compose"},{"id":"e-merge_compose-nav_profile","source":"merge_compose","target":"nav_profile"},{"id":"e-if_composer_opened-sleep_after_open-true","source":"if_composer_opened","sourceHandle":"true","target":"sleep_after_open"},{"id":"e-sleep_after_open-type_content","source":"sleep_after_open","target":"type_content"},{"id":"e-type_content-drop_images","source":"type_content","target":"drop_images"},{"id":"e-drop_images-sleep_after_drop","source":"drop_images","target":"sleep_after_drop"},{"id":"e-sleep_after_drop-click_post","source":"sleep_after_drop","target":"click_post"},{"id":"e-post_reels-merge_all","source":"post_reels","target":"merge_all"},{"id":"e-share_post-merge_all","source":"share_post","target":"merge_all"},{"id":"e-click_post-get_post_link","source":"click_post","target":"get_post_link"},{"id":"e-source-ai-nav-home-after-scrape","source":"source_ai_prompt","target":"nav_home_after_scrape"},{"id":"e-open_composer-if_composer_opened","source":"open_composer","target":"if_composer_opened"},{"id":"e-nav_profile-open_composer","source":"nav_profile","target":"open_composer"},{"id":"e-get_post_link-merge_all","source":"get_post_link","target":"merge_all"}],"id":251,"is_builtin":false,"name":"facebook_timeline_post__test__facebook_timeline_post","nodes":[{"blockId":5,"blockName":"nav_to_url","config":{"url":"https://www.facebook.com"},"id":"nav","position":{"x":100,"y":0}},{"blockId":21,"blockName":"wait_for_selector","config":{"selector":"//*[@role=''main'']","timeout":10000},"id":"wait_main","position":{"x":100,"y":100}},{"blockId":1,"blockName":"if_else","config":{"condition":"vars.postAsReels === true"},"id":"if_reels","position":{"x":100,"y":200},"systemType":"ifElse"},{"blockId":37,"blockName":"fb_post_reels","config":{"screenshotCaptureOn":"failure","screenshotCaptureTiming":"after"},"id":"post_reels","position":{"x":0,"y":300}},{"blockId":1,"blockName":"if_else","config":{"condition":"vars.sharePost === true && !!vars.sourceLink"},"id":"if_share","position":{"x":200,"y":300},"systemType":"ifElse"},{"blockId":36,"blockName":"fb_share_post","config":{},"id":"share_post","position":{"x":100,"y":400}},{"blockId":1,"blockName":"if_else","config":{"condition":"vars.copyContentFromSource === true && !!vars.sourceLink"},"id":"if_copy","position":{"x":300,"y":400},"systemType":"ifElse"},{"blockId":35,"blockName":"fb_scrape_post","config":{},"id":"scrape","position":{"x":200,"y":500}},{"blockId":5,"blockName":"nav_to_url","config":{"url":"https://www.facebook.com"},"id":"nav_home_after_scrape","label":"Quay về trang chủ FB","position":{"x":200,"y":580}},{"blockId":21,"blockName":"wait_for_selector","config":{"selector":"//*[@role=''main'']","timeout":10000},"id":"wait_main_after_scrape","position":{"x":200,"y":660}},{"blockId":4,"blockName":"merge","config":{"mode":"any"},"id":"merge_compose","position":{"x":300,"y":740},"systemType":"merge"},{"blockId":27,"blockName":"fb_open_composer","config":{"composerActionCode":"fb_post_my_profile"},"id":"open_composer","position":{"x":300,"y":820}},{"blockId":20,"blockName":"sleep","config":{"ms":2000},"id":"sleep_after_open","position":{"x":300,"y":900}},{"blockId":28,"blockName":"fb_type_post_content","config":{},"id":"type_content","position":{"x":300,"y":980}},{"blockId":29,"blockName":"fb_drop_post_images","config":{},"id":"drop_images","position":{"x":300,"y":1060}},{"blockId":20,"blockName":"sleep","config":{"ms":5000},"id":"sleep_after_drop","position":{"x":300,"y":1140}},{"blockId":30,"blockName":"fb_click_post_button","config":{"screenshotCaptureOn":"failure","screenshotCaptureTiming":"after","verifyPostAfterClick":true},"id":"click_post","position":{"x":300,"y":1220}},{"blockId":4,"blockName":"merge","config":{"mode":"any"},"id":"merge_all","position":{"x":200,"y":1340},"systemType":"merge"},{"blockId":2674,"blockName":"fb_rewrite_source_content_ai","config":{},"id":"source_ai_prompt","label":"AI edit nội dung nguồn","position":{"x":200,"y":540}},{"blockId":1,"blockName":"if_else","config":{"condition":"input.opened === true"},"id":"if_composer_opened","position":{"x":520,"y":880},"systemType":"ifElse"}],"organization_id":1,"staff_id":1,"updated_at":"2026-10-09T19:44:01.000151+00:00","variables_schema":[{"label":"Nội dung bài","name":"campaignContent","type":"string"},{"label":"Ảnh","name":"images","type":"array"},{"label":"Đăng dưới dạng Reels","name":"postAsReels","type":"boolean"},{"label":"Chia sẻ từ source link","name":"sharePost","type":"boolean"},{"label":"Copy nội dung từ source","name":"copyContentFromSource","type":"boolean"},{"label":"Source link (cho share/copy)","name":"sourceLink","type":"string"},{"label":"Đường dẫn video (cho reels)","name":"videoPath","type":"string"},{"label":"Lấy kèm ảnh từ source","name":"includeSourceImages","type":"boolean"},{"label":"Lời nhắc AI - Edit lại nội dung","name":"rewriteSourceContentWithAI","type":"boolean"},{"label":"Lời nhắc AI","name":"sourceContentAiPrompt","placeholder":"Viết lại nội dung sau: [content]","type":"textarea"}]}'::jsonb-'updated_at'-'nodes')
OR (SELECT nodes FROM public.auto_workflows WHERE id=251) IS DISTINCT FROM ('[{"blockId":5,"blockName":"nav_to_url","config":{"url":"https://www.facebook.com"},"id":"nav","position":{"x":100,"y":0}},{"blockId":21,"blockName":"wait_for_selector","config":{"selector":"//*[@role=''main'']","timeout":10000},"id":"wait_main","position":{"x":100,"y":100}},{"blockId":1,"blockName":"if_else","config":{"condition":"vars.postAsReels === true"},"id":"if_reels","position":{"x":100,"y":200},"systemType":"ifElse"},{"blockId":37,"blockName":"fb_post_reels","config":{"screenshotCaptureOn":"failure","screenshotCaptureTiming":"after"},"id":"post_reels","position":{"x":0,"y":300}},{"blockId":1,"blockName":"if_else","config":{"condition":"vars.sharePost === true && !!vars.sourceLink"},"id":"if_share","position":{"x":200,"y":300},"systemType":"ifElse"},{"blockId":36,"blockName":"fb_share_post","config":{},"id":"share_post","position":{"x":100,"y":400}},{"blockId":1,"blockName":"if_else","config":{"condition":"vars.copyContentFromSource === true && !!vars.sourceLink"},"id":"if_copy","position":{"x":300,"y":400},"systemType":"ifElse"},{"blockId":35,"blockName":"fb_scrape_post","config":{},"id":"scrape","position":{"x":200,"y":500}},{"blockId":5,"blockName":"nav_to_url","config":{"url":"https://www.facebook.com"},"id":"nav_home_after_scrape","label":"Quay về trang chủ FB","position":{"x":200,"y":580}},{"blockId":21,"blockName":"wait_for_selector","config":{"selector":"//*[@role=''main'']","timeout":10000},"id":"wait_main_after_scrape","position":{"x":200,"y":660}},{"blockId":4,"blockName":"merge","config":{"mode":"any"},"id":"merge_compose","position":{"x":300,"y":740},"systemType":"merge"},{"blockId":27,"blockName":"fb_open_composer","config":{"composerActionCode":"fb_post_my_profile"},"id":"open_composer","position":{"x":300,"y":820}},{"blockId":20,"blockName":"sleep","config":{"ms":2000},"id":"sleep_after_open","position":{"x":300,"y":900}},{"blockId":28,"blockName":"fb_type_post_content","config":{},"id":"type_content","position":{"x":300,"y":980}},{"blockId":29,"blockName":"fb_drop_post_images","config":{},"id":"drop_images","position":{"x":300,"y":1060}},{"blockId":20,"blockName":"sleep","config":{"ms":5000},"id":"sleep_after_drop","position":{"x":300,"y":1140}},{"blockId":30,"blockName":"fb_click_post_button","config":{"screenshotCaptureOn":"failure","screenshotCaptureTiming":"after","verifyPostAfterClick":true},"id":"click_post","position":{"x":300,"y":1220}},{"blockId":4,"blockName":"merge","config":{"mode":"any"},"id":"merge_all","position":{"x":200,"y":1340},"systemType":"merge"},{"blockId":2674,"blockName":"fb_rewrite_source_content_ai","config":{},"id":"source_ai_prompt","label":"AI edit nội dung nguồn","position":{"x":200,"y":540}},{"blockId":1,"blockName":"if_else","config":{"condition":"input.opened === true"},"id":"if_composer_opened","position":{"x":520,"y":880},"systemType":"ifElse"},{"id":"nav_profile","blockId":5,"blockName":"nav_to_url","label":"Mở trang cá nhân","config":{"url":"https://www.facebook.com/profile.php"},"position":{"x":300,"y":780}}]'::jsonb || jsonb_build_array('{"id":"get_post_link","blockName":"fb_get_first_profile_post_link","label":"Lấy link bài trên cùng","config":{},"position":{"x":300,"y":1280}}'::jsonb || jsonb_build_object('blockId',new_block_id))) THEN RAISE EXCEPTION 'v379 rollback: workflow 251 drift'; END IF;
UPDATE public.auto_workflows SET nodes='[{"blockId":5,"blockName":"nav_to_url","config":{"url":"https://www.facebook.com"},"id":"nav","position":{"x":100,"y":0}},{"blockId":21,"blockName":"wait_for_selector","config":{"selector":"//*[@role=''main'']","timeout":10000},"id":"wait_main","position":{"x":100,"y":100}},{"blockId":1,"blockName":"if_else","config":{"condition":"vars.postAsReels === true"},"id":"if_reels","position":{"x":100,"y":200},"systemType":"ifElse"},{"blockId":37,"blockName":"fb_post_reels","config":{"screenshotCaptureOn":"failure","screenshotCaptureTiming":"after"},"id":"post_reels","position":{"x":0,"y":300}},{"blockId":1,"blockName":"if_else","config":{"condition":"vars.sharePost === true && !!vars.sourceLink"},"id":"if_share","position":{"x":200,"y":300},"systemType":"ifElse"},{"blockId":36,"blockName":"fb_share_post","config":{},"id":"share_post","position":{"x":100,"y":400}},{"blockId":1,"blockName":"if_else","config":{"condition":"vars.copyContentFromSource === true && !!vars.sourceLink"},"id":"if_copy","position":{"x":300,"y":400},"systemType":"ifElse"},{"blockId":35,"blockName":"fb_scrape_post","config":{},"id":"scrape","position":{"x":200,"y":500}},{"blockId":5,"blockName":"nav_to_url","config":{"url":"https://www.facebook.com"},"id":"nav_home_after_scrape","label":"Quay về trang chủ FB","position":{"x":200,"y":580}},{"blockId":21,"blockName":"wait_for_selector","config":{"selector":"//*[@role=''main'']","timeout":10000},"id":"wait_main_after_scrape","position":{"x":200,"y":660}},{"blockId":4,"blockName":"merge","config":{"mode":"any"},"id":"merge_compose","position":{"x":300,"y":740},"systemType":"merge"},{"blockId":27,"blockName":"fb_open_composer","config":{"composerActionCode":"fb_post_my_profile"},"id":"open_composer","position":{"x":300,"y":820}},{"blockId":20,"blockName":"sleep","config":{"ms":2000},"id":"sleep_after_open","position":{"x":300,"y":900}},{"blockId":28,"blockName":"fb_type_post_content","config":{},"id":"type_content","position":{"x":300,"y":980}},{"blockId":29,"blockName":"fb_drop_post_images","config":{},"id":"drop_images","position":{"x":300,"y":1060}},{"blockId":20,"blockName":"sleep","config":{"ms":5000},"id":"sleep_after_drop","position":{"x":300,"y":1140}},{"blockId":30,"blockName":"fb_click_post_button","config":{"screenshotCaptureOn":"failure","screenshotCaptureTiming":"after","verifyPostAfterClick":true},"id":"click_post","position":{"x":300,"y":1220}},{"blockId":4,"blockName":"merge","config":{"mode":"any"},"id":"merge_all","position":{"x":200,"y":1340},"systemType":"merge"},{"blockId":2674,"blockName":"fb_rewrite_source_content_ai","config":{},"id":"source_ai_prompt","label":"AI edit nội dung nguồn","position":{"x":200,"y":540}},{"blockId":1,"blockName":"if_else","config":{"condition":"input.opened === true"},"id":"if_composer_opened","position":{"x":520,"y":880},"systemType":"ifElse"}]'::jsonb,edges='[{"id":"e-nav-wait_main","source":"nav","target":"wait_main"},{"id":"e-wait_main-if_reels","source":"wait_main","target":"if_reels"},{"id":"e-if_reels-post_reels-true","source":"if_reels","sourceHandle":"true","target":"post_reels"},{"id":"e-if_reels-if_share-false","source":"if_reels","sourceHandle":"false","target":"if_share"},{"id":"e-if_share-share_post-true","source":"if_share","sourceHandle":"true","target":"share_post"},{"id":"e-if_share-if_copy-false","source":"if_share","sourceHandle":"false","target":"if_copy"},{"id":"e-if_copy-scrape-true","source":"if_copy","sourceHandle":"true","target":"scrape"},{"id":"e-if_copy-merge_compose-false","source":"if_copy","sourceHandle":"false","target":"merge_compose"},{"id":"e-scrape-nav_home_after_scrape","source":"scrape","target":"source_ai_prompt"},{"id":"e-nav_home_after_scrape-wait_main_after_scrape","source":"nav_home_after_scrape","target":"wait_main_after_scrape"},{"id":"e-wait_main_after_scrape-merge_compose","source":"wait_main_after_scrape","target":"merge_compose"},{"id":"e-merge_compose-open_composer","source":"merge_compose","target":"open_composer"},{"id":"e-if_composer_opened-sleep_after_open-true","source":"if_composer_opened","sourceHandle":"true","target":"sleep_after_open"},{"id":"e-sleep_after_open-type_content","source":"sleep_after_open","target":"type_content"},{"id":"e-type_content-drop_images","source":"type_content","target":"drop_images"},{"id":"e-drop_images-sleep_after_drop","source":"drop_images","target":"sleep_after_drop"},{"id":"e-sleep_after_drop-click_post","source":"sleep_after_drop","target":"click_post"},{"id":"e-post_reels-merge_all","source":"post_reels","target":"merge_all"},{"id":"e-share_post-merge_all","source":"share_post","target":"merge_all"},{"id":"e-click_post-merge_all","source":"click_post","target":"merge_all"},{"id":"e-source-ai-nav-home-after-scrape","source":"source_ai_prompt","target":"nav_home_after_scrape"},{"id":"e-open_composer-if_composer_opened","source":"open_composer","target":"if_composer_opened"}]'::jsonb,updated_at='2026-10-09T19:44:01.000151+00:00' WHERE id=251;
UPDATE public.auto_blocks SET code='// Centralized AI rewrite via ai_using.
const __aiRewriteUsingCode = "fb_post_current_identity_ui_rewrite";
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

try { /* v59-safe-output-wrapper */

const stepMs = Number(vars.facebookStepMs || input.facebookStepMs || 1000)
const submitTimeoutMs = Number(vars.facebookSubmitTimeoutMs || input.facebookSubmitTimeoutMs || 30000)

const closeSelector = await helpers.element(''FbComposerCloseDialogButton'')
const openSelector = await helpers.element(''FbComposerOpenButton'')
const textSelector = await helpers.element(''FbComposerTextInput'')
const backgroundButtonSelector = await helpers.element(''FbComposerBackgroundButton'')
const backgroundOptionSelector = await helpers.element(''FbComposerBackgroundOption'')
const formSelector = await helpers.element(''FbComposerForm'')
const nextSelector = await helpers.element(''FbComposerNextButton'')
const reelsNextSelector = await helpers.element(''FbComposerReelsNextButton'')
const submitSelector = await helpers.element(''FbComposerSubmitButton'')
const anotherTimeSelector = await helpers.element(''FbComposerAnotherTimeButton'')
const errorSelector = await helpers.element(''FbComposerErrorMessage'')
const rawLinkSelector = await helpers.element(''FbComposerRawPostLink'')
const postLinkSelector = await helpers.element(''FbComposerPostLink'')

function formatTemplateDate(dayKey, formatKey) {
  const d = new Date()
  const key = String(dayKey || ''TODAY'').toUpperCase()
  if (key === ''TOMORROW'') d.setDate(d.getDate() + 1)
  if (key === ''YESTERDAY'') d.setDate(d.getDate() - 1)
  const dd = String(d.getDate()).padStart(2, ''0'')
  const mm = String(d.getMonth() + 1).padStart(2, ''0'')
  const yyyy = String(d.getFullYear())
  return String(formatKey || ''DD/MM/YYYY'').toUpperCase() === ''MM/DD/YYYY'' ? mm + ''/'' + dd + ''/'' + yyyy : dd + ''/'' + mm + ''/'' + yyyy
}

async function renderContentTemplate(raw) {
  let rendered = String(raw || '''')
  if (/#\{\s*FULL_NAME\s*\}/i.test(rendered)) {
    const fullName = String(vars.campaignInputDataName || vars.inputDataName || vars.pageName || '''').trim()
    rendered = rendered.replace(/#\{\s*FULL_NAME\s*\}/gi, fullName)
  }
  rendered = rendered.replace(
    /#\{\s*(TODAY|TOMORROW|YESTERDAY)\s*(?:\(\s*(DD\/MM\/YYYY|MM\/DD\/YYYY)\s*\))?\s*\}/gi,
    (_match, dayKey, formatKey) => formatTemplateDate(dayKey, formatKey)
  )
  return rendered
}

async function rewriteContentForRun(raw) {
  const original = String(raw || '''')
  const content = original.trim()
  if (vars.rewriteContentEachRun !== true || !content) return original
  try {
    const rewritten = await __callAIRewriteContent(content)
    if (!rewritten) throw new Error(''AI trả về nội dung không hợp lệ.'')
    helpers.log(''Đã viết lại nội dung bằng AI'')
    return rewritten
  } catch (e) {
    const message = e && e.message ? String(e.message) : String(e)
    helpers.log(''AI viết lại nội dung lỗi, dùng nội dung gốc: '' + message)
    return original
  }
}

let message
if (typeof helpers.prepareCampaignContent === ''function'') {
  const prepared = await helpers.prepareCampaignContent({
    rewriteCode: __aiRewriteUsingCode,
    sourceText: vars.campaignSourceText || '''',
    sourceMedia: vars.campaignSourceMedia || []
  })
  message = prepared.content
  vars.campaignContent = prepared.content
  vars.images = prepared.media
  vars.contentVariantIndex = prepared.variantIndex
} else {
  message = String(vars.campaignContent || input.campaignContent || '''').trim()
  message = (await renderContentTemplate(message)).trim()
  message = (await rewriteContentForRun(message)).trim()
}

const images = (Array.isArray(vars.images) ? vars.images : Array.isArray(input.images) ? input.images : [])
  .map(item => String(item || '''').trim())
  .filter(Boolean)
const publishHasVideo = images.some(path => /^data:video\//i.test(String(path || '''')) || /\.(3g2|3gp|avi|m2ts|m4v|mkv|mov|mp4|mpeg|mpg|ogv|webm|wmv)(?:[?#].*)?$/i.test(path))
const publishTimeoutMs = publishHasVideo ? 180000 : Number(vars.facebookPublishTimeoutMs || input.facebookPublishTimeoutMs || 120000)

if (!message && images.length === 0) {
  return { ok: false, posted: false, error: ''Không có nội dung hoặc ảnh để đăng'' }
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
      try { el.scrollIntoView({ block: ''center'', inline: ''nearest'' }); } catch {}
      const init = { bubbles: true, cancelable: true, view: window };
      const p = Object.assign({}, init, { pointerId: 1, pointerType: ''mouse'', isPrimary: true });
      try { el.dispatchEvent(new PointerEvent(''pointerdown'', p)); } catch {}
      try { el.dispatchEvent(new MouseEvent(''mousedown'', init)); } catch {}
      try { el.dispatchEvent(new PointerEvent(''pointerup'', p)); } catch {}
      try { el.dispatchEvent(new MouseEvent(''mouseup'', init)); } catch {}
      try { el.click(); } catch {}
    }
    const arr = xpathAll(selector);
    let el = null;
    if (options.last === true) el = arr[arr.length - 1] || null;
    else if (typeof options.index === ''number'') el = arr[options.index] || null;
    else el = arr[0] || null;
    if (!el) return { clicked: false, count: arr.length, label: '''' };
    const label = el.getAttribute(''aria-label'') || String(el.innerText || el.textContent || '''').trim();
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
      return el ? String(el.innerText || el.textContent || '''').trim() : '''';
    } catch {
      return '''';
    }
  `, selector)
}

async function rawFillContent(selector, value) {
  return await page.evaluate(`
    const selector = __args[0];
    const value = String(__args[1] || '''').replace(/\\t/g, ''      '');
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
    if (!el) return { filled: false, message: ''Không tìm thấy ô nhập nội dung'' };
    try { el.scrollIntoView({ block: ''center'', inline: ''nearest'' }); } catch {}
    try { el.focus(); } catch {}
    const target = el.isContentEditable ? el : (el.querySelector && (el.querySelector(''[contenteditable="true"]'') || el.querySelector(''[role="textbox"]''))) || el;
    try { target.focus(); } catch {}
    try {
      const dt = new DataTransfer();
      dt.setData(''text/plain'', value + '' '');
      const pasteEvent = new ClipboardEvent(''paste'', { clipboardData: dt, bubbles: true, cancelable: true });
      target.dispatchEvent(pasteEvent);
      if (target.isContentEditable) {
        document.execCommand(''insertText'', false, '' '');
      } else if (''value'' in target) {
        target.value = String(target.value || '''') + value + '' '';
        target.dispatchEvent(new Event(''input'', { bubbles: true }));
        target.dispatchEvent(new Event(''change'', { bubbles: true }));
      }
      return { filled: true };
    } catch (e) {
      if (target.isContentEditable) {
        document.execCommand(''insertText'', false, value + '' '');
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
      if (!href) return '''';
      try {
        const url = new URL(href, location.href);
        if (/^(m|mbasic|mobile)\\.facebook\\.com$/i.test(url.hostname)) url.hostname = ''www.facebook.com'';
        url.hash = '''';
        Array.from(url.searchParams.keys()).forEach(key => {
          if (key.startsWith(''__'') || key === ''mibextid'' || key === ''ref'' || key === ''locale'') url.searchParams.delete(key);
        });
        return url.href;
      } catch {
        return String(href || '''').trim();
      }
    }
    const raw = xpathAll(rawSelector)[0] || null;
    if (raw) {
      try { raw.dispatchEvent(new FocusEvent(''focusin'', { bubbles: true, cancelable: true, view: window })); } catch {}
      try { raw.focus(); } catch {}
    }
    const link = xpathAll(linkSelector)[0] || null;
    return cleanHref(link ? (link.href || link.getAttribute(''href'') || '''') : '''');
  `, rawLinkSelector, postLinkSelector)
}

helpers.log(''Đang mở composer đăng bài trên identity hiện tại'')
await rawClick(closeSelector).catch(() => null)
await helpers.sleep(stepMs + 1000, signal)
await page.navigate(''https://www.facebook.com/profile.php'')
await helpers.sleep(stepMs + 3000, signal)
await rawClick(closeSelector).catch(() => null)
await helpers.sleep(stepMs + 1000, signal)

const openCount = await rawCount(openSelector)
if (openCount === 0) {
  return { ok: false, posted: false, error: ''Không tìm thấy nút tạo bài viết'' }
}

const opened = await rawClick(openSelector)
if (!opened || opened.clicked !== true) {
  return { ok: false, posted: false, error: ''Lỗi khi nhấn nút tạo bài post'' }
}
await helpers.sleep(stepMs + 1000, signal)

if ((vars.postWithBackground === true || input.postWithBackground === true) && message) {
  try {
    helpers.log(''Đang chọn phông nền bài viết'')
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
    helpers.log(''Chọn phông nền lỗi, tiếp tục đăng bài: '' + errMessage)
  }
}

if (message) {
  const filled = await rawFillContent(textSelector, message)
  if (!filled || filled.filled !== true) {
    return { ok: false, posted: false, error: ''Lỗi khi nhập nội dung bài post: '' + String(filled && filled.message ? filled.message : '''') }
  }
  await helpers.sleep(3000, signal)
}

if (images.length > 0) {
  helpers.log(''Đang upload '' + images.length + '' ảnh vào composer'')
  const uploadResult = await uploadPostMediaInput(formSelector, images)
  if (!uploadResult || uploadResult.fileCount !== images.length) {
    return { ok: false, posted: false, imageCount: Number(uploadResult && uploadResult.fileCount || 0), error: ''Đường dẫn file media không hợp lệ hoặc upload ảnh thất bại'' }
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
  return { ok: false, posted: false, imageCount: images.length, error: ''Lỗi khi nhấn nút đăng bài'' }
}

const publishStarted = Date.now()
await helpers.sleep(3000, signal)
await rawClick(anotherTimeSelector).then(r => r && r.clicked ? helpers.sleep(stepMs + 1000, signal) : null).catch(() => null)

while (Date.now() - publishStarted < publishTimeoutMs) {
  if (signal.aborted) throw new Error(''Đã dừng chờ xác nhận đăng bài fanpage'')
  const count = await rawCount(submitSelector)
  if (count > 0) {
    await helpers.sleep(Math.min(500, Math.max(0, publishTimeoutMs - (Date.now() - publishStarted))), signal)
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
    error: ''Đăng bài thất bại: '' + (errorMessage || ''Form đăng bài chưa đóng sau '' + (publishTimeoutMs / 1000) + '' giây'')
  }
}

await helpers.sleep(stepMs + 3000, signal)
await rawClick(closeSelector).catch(() => null)
await helpers.sleep(stepMs + 1000, signal)
const postUrl = String(await getPostUrl() || '''').trim()
helpers.log(''Đăng bài bằng giao diện thành công'')

return {
  ok: true,
  posted: true,
  mode: ''ui'',
  postUrl,
  imageCount: images.length
}


} catch (e) {
  if (signal && signal.aborted) throw e
  const message = e && e.message ? String(e.message) : String(e)
  helpers.log(''Đăng bài bằng giao diện lỗi: '' + message)
  return { ok: false, posted: false, mode: ''ui'', postUrl: '''', imageCount: 0, error: message }
}

// Prefer the composer''s real file input; use legacy drop only when none exists.
// uploadFile resolves a visible container before finding its hidden file input.
async function uploadPostMediaInput(formXPath, files) {
  if (signal.aborted) throw new Error(''Đã dừng upload ảnh/video'')
  const token = ''post_media_'' + Date.now() + ''_'' + Math.random().toString(36).slice(2)
  const attribute = ''data-aka-post-media-upload''
  const prepared = await page.evaluate(`
    const formXPath = __args[0];
    const token = __args[1];
    const attribute = __args[2];
    const fileCount = __args[3];
    const matches = document.evaluate(formXPath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    if (matches.snapshotLength !== 1) {
      throw new Error(''Cần đúng 1 form đăng bài, tìm thấy '' + matches.snapshotLength);
    }
    const form = matches.snapshotItem(0);
    if (!form || form.tagName !== ''FORM'') throw new Error(''Element đăng bài không phải form'');
    const inputs = Array.from(form.querySelectorAll(''input[type="file"]''));
    if (inputs.length === 0) {
      if (form.hasAttribute(attribute)) throw new Error(''Form đăng bài đang có lượt upload khác'');
      form.setAttribute(attribute, token);
      return ''drop'';
    }
    if (inputs.length !== 1) {
      throw new Error(''Cần đúng 1 input file trong form đăng bài, tìm thấy '' + inputs.length);
    }
    const input = inputs[0];
    if (input.matches('':disabled'')) throw new Error(''Input ảnh/video đang bị vô hiệu hóa'');
    if (!/(image|video)/i.test(input.accept || '''')) {
      throw new Error(''Input trong form không nhận ảnh/video'');
    }
    if (fileCount > 1 && !input.multiple) {
      throw new Error(''Input trong form không hỗ trợ chọn nhiều ảnh/video'');
    }
    if (form.hasAttribute(attribute)) throw new Error(''Form đăng bài đang có lượt upload khác'');
    form.setAttribute(attribute, token);
    return ''upload'';
  `, formXPath, token, attribute, files.length)
  if (prepared !== ''upload'' && prepared !== ''drop'') throw new Error(''Không xác minh được input ảnh/video của form đăng bài'')

  try {
    if (signal.aborted) throw new Error(''Đã dừng upload ảnh/video'')
    const selector = ''form['' + attribute + ''="'' + token + ''"]''
    if (prepared === ''drop'') return await page.dropFile(selector, files)
    // The visible form contains exactly one validated, possibly hidden file input.
    return await page.uploadFile(selector, files)
  } finally {
    await page.evaluate(`
      const attribute = __args[0];
      const token = __args[1];
      for (const form of document.querySelectorAll(''form['' + attribute + '']'')) {
        if (form.getAttribute(attribute) === token) form.removeAttribute(attribute);
      }
    `, attribute, token).catch(() => null)
  }
}
',updated_at='2026-10-06T10:14:35.142327+00:00' WHERE id=2672;
END $rollback$;
COMMIT;
