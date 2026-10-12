-- Captured live source and rollback: migrations/snapshots/facebook-top-post-link-v379/.
-- Only block/workflow data changes: no DDL, RPC, schema reload, or historical detail writes.
BEGIN;
SET LOCAL timezone='UTC';
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='8s';
SELECT id FROM public.auto_blocks WHERE id IN (5,20,30,2626,2672) ORDER BY id FOR UPDATE;
SELECT id FROM public.auto_workflows WHERE id IN (2,226,250,251) ORDER BY id FOR UPDATE;
SELECT id FROM public.auto_elements WHERE id IN (1551,1552) ORDER BY id FOR SHARE;
DO $v379$
DECLARE new_block_id bigint;
BEGIN
IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v379_%') THEN RAISE EXCEPTION 'v379 already applied'; END IF;
IF EXISTS(SELECT 1 FROM public.auto_blocks WHERE name='fb_get_first_profile_post_link') THEN RAISE EXCEPTION 'v379 block already exists'; END IF;
IF (SELECT md5(to_jsonb(t)::text) FROM public.auto_blocks t WHERE id=5) IS DISTINCT FROM '1a7caeb6f3a5f6371910dc4832d61af4' THEN RAISE EXCEPTION 'v379: auto_blocks/5 drift'; END IF;
IF (SELECT md5(to_jsonb(t)::text) FROM public.auto_blocks t WHERE id=20) IS DISTINCT FROM 'b783209cb9604117179ce7c8a3b82f67' THEN RAISE EXCEPTION 'v379: auto_blocks/20 drift'; END IF;
IF (SELECT md5(to_jsonb(t)::text) FROM public.auto_blocks t WHERE id=30) IS DISTINCT FROM '9fa594892a4cf9b5783a6b9a4ec812a9' THEN RAISE EXCEPTION 'v379: auto_blocks/30 drift'; END IF;
IF (SELECT md5(to_jsonb(t)::text) FROM public.auto_blocks t WHERE id=2626) IS DISTINCT FROM '2f0cd602c45bc32b9789d2bf5bb12cb3' THEN RAISE EXCEPTION 'v379: auto_blocks/2626 drift'; END IF;
IF (SELECT md5(to_jsonb(t)::text) FROM public.auto_blocks t WHERE id=2672) IS DISTINCT FROM '63a67d2e73ea6a07329be058964dd4a1' THEN RAISE EXCEPTION 'v379: auto_blocks/2672 drift'; END IF;
IF (SELECT md5(to_jsonb(t)::text) FROM public.auto_elements t WHERE id=1551) IS DISTINCT FROM '2df7ef049ab7821a4016e7478b3e6f39' THEN RAISE EXCEPTION 'v379: auto_elements/1551 drift'; END IF;
IF (SELECT md5(to_jsonb(t)::text) FROM public.auto_elements t WHERE id=1552) IS DISTINCT FROM 'a061b734049ac401e9498ce6695ea57d' THEN RAISE EXCEPTION 'v379: auto_elements/1552 drift'; END IF;
IF (SELECT md5(to_jsonb(t)::text) FROM public.auto_workflows t WHERE id=2) IS DISTINCT FROM '73831ab572c9c9272f181d957aff97a7' THEN RAISE EXCEPTION 'v379: auto_workflows/2 drift'; END IF;
IF (SELECT md5(to_jsonb(t)::text) FROM public.auto_workflows t WHERE id=226) IS DISTINCT FROM 'f1d58ed05b9ca3f6a0cf38d209d47026' THEN RAISE EXCEPTION 'v379: auto_workflows/226 drift'; END IF;
IF (SELECT md5(to_jsonb(t)::text) FROM public.auto_workflows t WHERE id=250) IS DISTINCT FROM '5cd8533576b5d1bd1606fb11dd8fcf34' THEN RAISE EXCEPTION 'v379: auto_workflows/250 drift'; END IF;
IF (SELECT md5(to_jsonb(t)::text) FROM public.auto_workflows t WHERE id=251) IS DISTINCT FROM '47a74098cc7019b28b386d40e23e363e' THEN RAISE EXCEPTION 'v379: auto_workflows/251 drift'; END IF;
IF (SELECT jsonb_agg(jsonb_build_object('id',id,'workflow_id',workflow_id,'test_workflow_id',test_workflow_id) ORDER BY id) FROM public.auto_campaign_actions WHERE id IN ('facebook_timeline_post','facebook_page_post')) IS DISTINCT FROM '[{"id":"facebook_page_post","test_workflow_id":250,"workflow_id":226},{"id":"facebook_timeline_post","test_workflow_id":251,"workflow_id":2}]'::jsonb THEN RAISE EXCEPTION 'v379 action mapping drift'; END IF;
INSERT INTO public.auto_blocks (category,code,config_schema,default_config,description,icon,is_builtin,kind,name,organization_id,output_schema,staff_id,system_type) VALUES ('facebook','// Run only after a confirmed ordinary timeline publish; keep missing links best effort.
if (input.posted !== true) return { ok: true, linkFound: false, postUrl: '''', link: '''' };
try {
await helpers.sleep(3000, signal);

const rawSelector = await helpers.element(''FbComposerRawPostLink'');
const linkSelector = await helpers.element(''FbComposerPostLink'');

const result = await page.evaluate(`
  const rawSelector = __args[0];
  const linkSelector = __args[1];

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
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

  function hrefOf(el) {
    return el ? (el.href || el.getAttribute(''href'') || '''') : '''';
  }

  function cleanPostHref(href) {
    if (!href) return '''';
    try {
      const url = new URL(href, location.href);
      if (/^(m|mbasic|mobile)\\.facebook\\.com$/i.test(url.hostname)) {
        url.hostname = ''www.facebook.com'';
      }
      url.hash = '''';
      Array.from(url.searchParams.keys()).forEach(key => {
        if (
          key.startsWith(''__'') ||
          key === ''mibextid'' ||
          key === ''ref'' ||
          key === ''locale'' ||
          key === ''comment_id'' ||
          key === ''reply_comment_id''
        ) {
          url.searchParams.delete(key);
        }
      });
      return url.href;
    } catch {
      return String(href || '''').trim();
    }
  }

  function isCommentPermalink(href) {
    if (!href) return false;
    try {
      const url = new URL(href, location.href);
      if (url.searchParams.has(''comment_id'') || url.searchParams.has(''reply_comment_id'')) return true;
      const rawQuery = String(url.search || '''').toLowerCase();
      return rawQuery.includes(''comment_id='') || rawQuery.includes(''reply_comment_id='');
    } catch {
      const raw = String(href || '''').toLowerCase();
      return raw.includes(''comment_id='') || raw.includes(''reply_comment_id='');
    }
  }

  function isPostPermalink(href) {
    if (!href || isCommentPermalink(href)) return false;
    return href.includes(''/pending_posts/'') || href.includes(''/posts/'') || href.includes(''story_fbid='');
  }

  function simulateFocusin(element) {
    if (!element) return;
    try {
      element.scrollIntoView({ block: ''center'', inline: ''nearest'' });
    } catch {}
    try {
      element.dispatchEvent(new FocusEvent(''focusin'', {
        view: window,
        bubbles: true,
        cancelable: true
      }));
    } catch {
      try { element.dispatchEvent(new Event(''focusin'', { bubbles: true, cancelable: true })); } catch {}
    }
  }

  const rawEl = xpathAll(rawSelector)[0] || null;
  const rawPostLink = rawEl ? cleanPostHref(hrefOf(rawEl)) : '''';
  if (rawEl) {
    simulateFocusin(rawEl);
    await delay(700);
  }

  const postUrl = xpathAll(linkSelector)
    .map(el => cleanPostHref(hrefOf(el)))
    .filter(Boolean)
    .filter(isPostPermalink)[0] || '''';

  return { rawPostLink, postUrl };
`, rawSelector, linkSelector);

const rawPostLink = String(result && result.rawPostLink ? result.rawPostLink : '''').trim();
const postUrl = String(result && result.postUrl ? result.postUrl : '''').trim();
helpers.log(postUrl ? ''Đã lấy được link bài post'' : ''Chưa lấy được link bài post sau khi đăng'');

return {
  ok: true,
  linkFound: postUrl.length > 0,
  rawPostLink,
  postUrl,
  link: postUrl
};

} catch (error) {
  if (signal.aborted) throw error;
  helpers.log(''Chưa lấy được link bài post sau khi đăng'');
  return { ok: true, linkFound: false, postUrl: '''', link: '''' };
}
','[]'::jsonb,'{}'::jsonb,'Lấy link bài trên cùng sau khi đăng trang cá nhân thành công bằng raw link + focusin.','Link',true,'js','fb_get_first_profile_post_link',NULL,'[{"label":"Hoàn tất bước lấy link","name":"ok","type":"boolean"},{"label":"Raw post link","name":"rawPostLink","type":"string"},{"label":"Post URL","name":"postUrl","type":"string"},{"label":"Link","name":"link","type":"string"},{"name":"linkFound","type":"boolean","label":"Đã lấy được link"}]'::jsonb,NULL,NULL) RETURNING id INTO new_block_id;
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
      await new Promise(resolve => setTimeout(resolve, 700));
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
const postUrl = String(await getPostUrl().catch(() => '''') || '''').trim()
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
',updated_at=clock_timestamp() WHERE id=2672;
UPDATE public.auto_workflows SET nodes='[{"blockId":5,"blockName":"nav_to_url","config":{"url":"https://www.facebook.com"},"id":"nav","position":{"x":100,"y":0}},{"blockId":21,"blockName":"wait_for_selector","config":{"selector":"//*[@role=''main'']","timeout":10000},"id":"wait_main","position":{"x":100,"y":100}},{"blockId":1,"blockName":"if_else","config":{"condition":"vars.postAsReels === true"},"id":"if_reels","position":{"x":100,"y":200},"systemType":"ifElse"},{"blockId":37,"blockName":"fb_post_reels","config":{"screenshotCaptureOn":"failure","screenshotCaptureTiming":"after"},"id":"post_reels","position":{"x":0,"y":300}},{"blockId":1,"blockName":"if_else","config":{"condition":"vars.sharePost === true && !!vars.sourceLink"},"id":"if_share","position":{"x":200,"y":300},"systemType":"ifElse"},{"blockId":36,"blockName":"fb_share_post","config":{},"id":"share_post","position":{"x":100,"y":400}},{"blockId":1,"blockName":"if_else","config":{"condition":"vars.copyContentFromSource === true && !!vars.sourceLink"},"id":"if_copy","position":{"x":300,"y":400},"systemType":"ifElse"},{"blockId":35,"blockName":"fb_scrape_post","config":{},"id":"scrape","position":{"x":200,"y":500}},{"blockId":5,"blockName":"nav_to_url","config":{"url":"https://www.facebook.com"},"id":"nav_home_after_scrape","label":"Quay về trang chủ FB","position":{"x":200,"y":580}},{"blockId":21,"blockName":"wait_for_selector","config":{"selector":"//*[@role=''main'']","timeout":10000},"id":"wait_main_after_scrape","position":{"x":200,"y":660}},{"blockId":4,"blockName":"merge","config":{"mode":"any"},"id":"merge_compose","position":{"x":300,"y":740},"systemType":"merge"},{"blockId":27,"blockName":"fb_open_composer","config":{"composerActionCode":"fb_post_my_profile"},"id":"open_composer","position":{"x":300,"y":820}},{"blockId":20,"blockName":"sleep","config":{"ms":2000},"id":"sleep_after_open","position":{"x":300,"y":900}},{"blockId":28,"blockName":"fb_type_post_content","config":{},"id":"type_content","position":{"x":300,"y":980}},{"blockId":29,"blockName":"fb_drop_post_images","config":{},"id":"drop_images","position":{"x":300,"y":1060}},{"blockId":20,"blockName":"sleep","config":{"ms":5000},"id":"sleep_after_drop","position":{"x":300,"y":1140}},{"blockId":30,"blockName":"fb_click_post_button","config":{"screenshotCaptureOn":"failure","screenshotCaptureTiming":"after","verifyPostAfterClick":true},"id":"click_post","position":{"x":300,"y":1220}},{"blockId":4,"blockName":"merge","config":{"mode":"any"},"id":"merge_all","position":{"x":200,"y":1340},"systemType":"merge"},{"blockId":2674,"blockName":"fb_rewrite_source_content_ai","config":{},"id":"source_ai_prompt","label":"AI edit nội dung nguồn","position":{"x":200,"y":540}},{"blockId":1,"blockName":"if_else","config":{"condition":"input.opened === true"},"id":"if_composer_opened","position":{"x":520,"y":880},"systemType":"ifElse"},{"id":"nav_profile","blockId":5,"blockName":"nav_to_url","label":"Mở trang cá nhân","config":{"url":"https://www.facebook.com/profile.php"},"position":{"x":300,"y":780}}]'::jsonb || jsonb_build_array('{"id":"get_post_link","blockName":"fb_get_first_profile_post_link","label":"Lấy link bài trên cùng","config":{},"position":{"x":300,"y":1280}}'::jsonb || jsonb_build_object('blockId',new_block_id)),edges='[{"id":"e-nav-wait_main","source":"nav","target":"wait_main"},{"id":"e-wait_main-if_reels","source":"wait_main","target":"if_reels"},{"id":"e-if_reels-post_reels-true","source":"if_reels","sourceHandle":"true","target":"post_reels"},{"id":"e-if_reels-if_share-false","source":"if_reels","sourceHandle":"false","target":"if_share"},{"id":"e-if_share-share_post-true","source":"if_share","sourceHandle":"true","target":"share_post"},{"id":"e-if_share-if_copy-false","source":"if_share","sourceHandle":"false","target":"if_copy"},{"id":"e-if_copy-scrape-true","source":"if_copy","sourceHandle":"true","target":"scrape"},{"id":"e-if_copy-merge_compose-false","source":"if_copy","sourceHandle":"false","target":"merge_compose"},{"id":"e-scrape-nav_home_after_scrape","source":"scrape","target":"source_ai_prompt"},{"id":"e-nav_home_after_scrape-wait_main_after_scrape","source":"nav_home_after_scrape","target":"wait_main_after_scrape"},{"id":"e-wait_main_after_scrape-merge_compose","source":"wait_main_after_scrape","target":"merge_compose"},{"id":"e-merge_compose-nav_profile","source":"merge_compose","target":"nav_profile"},{"id":"e-if_composer_opened-sleep_after_open-true","source":"if_composer_opened","sourceHandle":"true","target":"sleep_after_open"},{"id":"e-sleep_after_open-type_content","source":"sleep_after_open","target":"type_content"},{"id":"e-type_content-drop_images","source":"type_content","target":"drop_images"},{"id":"e-drop_images-sleep_after_drop","source":"drop_images","target":"sleep_after_drop"},{"id":"e-sleep_after_drop-click_post","source":"sleep_after_drop","target":"click_post"},{"id":"e-post_reels-merge_all","source":"post_reels","target":"merge_all"},{"id":"e-share_post-merge_all","source":"share_post","target":"merge_all"},{"id":"e-click_post-get_post_link","source":"click_post","target":"get_post_link"},{"id":"e-source-ai-nav-home-after-scrape","source":"source_ai_prompt","target":"nav_home_after_scrape"},{"id":"e-open_composer-if_composer_opened","source":"open_composer","target":"if_composer_opened"},{"id":"e-nav_profile-open_composer","source":"nav_profile","target":"open_composer"},{"id":"e-get_post_link-merge_all","source":"get_post_link","target":"merge_all"}]'::jsonb,updated_at=clock_timestamp() WHERE id=2;
UPDATE public.auto_workflows SET nodes='[{"blockId":5,"blockName":"nav_to_url","config":{"url":"https://www.facebook.com"},"id":"nav","position":{"x":100,"y":0}},{"blockId":21,"blockName":"wait_for_selector","config":{"selector":"//*[@role=''main'']","timeout":10000},"id":"wait_main","position":{"x":100,"y":100}},{"blockId":1,"blockName":"if_else","config":{"condition":"vars.postAsReels === true"},"id":"if_reels","position":{"x":100,"y":200},"systemType":"ifElse"},{"blockId":37,"blockName":"fb_post_reels","config":{"screenshotCaptureOn":"failure","screenshotCaptureTiming":"after"},"id":"post_reels","position":{"x":0,"y":300}},{"blockId":1,"blockName":"if_else","config":{"condition":"vars.sharePost === true && !!vars.sourceLink"},"id":"if_share","position":{"x":200,"y":300},"systemType":"ifElse"},{"blockId":36,"blockName":"fb_share_post","config":{},"id":"share_post","position":{"x":100,"y":400}},{"blockId":1,"blockName":"if_else","config":{"condition":"vars.copyContentFromSource === true && !!vars.sourceLink"},"id":"if_copy","position":{"x":300,"y":400},"systemType":"ifElse"},{"blockId":35,"blockName":"fb_scrape_post","config":{},"id":"scrape","position":{"x":200,"y":500}},{"blockId":5,"blockName":"nav_to_url","config":{"url":"https://www.facebook.com"},"id":"nav_home_after_scrape","label":"Quay về trang chủ FB","position":{"x":200,"y":580}},{"blockId":21,"blockName":"wait_for_selector","config":{"selector":"//*[@role=''main'']","timeout":10000},"id":"wait_main_after_scrape","position":{"x":200,"y":660}},{"blockId":4,"blockName":"merge","config":{"mode":"any"},"id":"merge_compose","position":{"x":300,"y":740},"systemType":"merge"},{"blockId":27,"blockName":"fb_open_composer","config":{"composerActionCode":"fb_post_my_profile"},"id":"open_composer","position":{"x":300,"y":820}},{"blockId":20,"blockName":"sleep","config":{"ms":2000},"id":"sleep_after_open","position":{"x":300,"y":900}},{"blockId":28,"blockName":"fb_type_post_content","config":{},"id":"type_content","position":{"x":300,"y":980}},{"blockId":29,"blockName":"fb_drop_post_images","config":{},"id":"drop_images","position":{"x":300,"y":1060}},{"blockId":20,"blockName":"sleep","config":{"ms":5000},"id":"sleep_after_drop","position":{"x":300,"y":1140}},{"blockId":30,"blockName":"fb_click_post_button","config":{"screenshotCaptureOn":"failure","screenshotCaptureTiming":"after","verifyPostAfterClick":true},"id":"click_post","position":{"x":300,"y":1220}},{"blockId":4,"blockName":"merge","config":{"mode":"any"},"id":"merge_all","position":{"x":200,"y":1340},"systemType":"merge"},{"blockId":2674,"blockName":"fb_rewrite_source_content_ai","config":{},"id":"source_ai_prompt","label":"AI edit nội dung nguồn","position":{"x":200,"y":540}},{"blockId":1,"blockName":"if_else","config":{"condition":"input.opened === true"},"id":"if_composer_opened","position":{"x":520,"y":880},"systemType":"ifElse"},{"id":"nav_profile","blockId":5,"blockName":"nav_to_url","label":"Mở trang cá nhân","config":{"url":"https://www.facebook.com/profile.php"},"position":{"x":300,"y":780}}]'::jsonb || jsonb_build_array('{"id":"get_post_link","blockName":"fb_get_first_profile_post_link","label":"Lấy link bài trên cùng","config":{},"position":{"x":300,"y":1280}}'::jsonb || jsonb_build_object('blockId',new_block_id)),edges='[{"id":"e-nav-wait_main","source":"nav","target":"wait_main"},{"id":"e-wait_main-if_reels","source":"wait_main","target":"if_reels"},{"id":"e-if_reels-post_reels-true","source":"if_reels","sourceHandle":"true","target":"post_reels"},{"id":"e-if_reels-if_share-false","source":"if_reels","sourceHandle":"false","target":"if_share"},{"id":"e-if_share-share_post-true","source":"if_share","sourceHandle":"true","target":"share_post"},{"id":"e-if_share-if_copy-false","source":"if_share","sourceHandle":"false","target":"if_copy"},{"id":"e-if_copy-scrape-true","source":"if_copy","sourceHandle":"true","target":"scrape"},{"id":"e-if_copy-merge_compose-false","source":"if_copy","sourceHandle":"false","target":"merge_compose"},{"id":"e-scrape-nav_home_after_scrape","source":"scrape","target":"source_ai_prompt"},{"id":"e-nav_home_after_scrape-wait_main_after_scrape","source":"nav_home_after_scrape","target":"wait_main_after_scrape"},{"id":"e-wait_main_after_scrape-merge_compose","source":"wait_main_after_scrape","target":"merge_compose"},{"id":"e-merge_compose-nav_profile","source":"merge_compose","target":"nav_profile"},{"id":"e-if_composer_opened-sleep_after_open-true","source":"if_composer_opened","sourceHandle":"true","target":"sleep_after_open"},{"id":"e-sleep_after_open-type_content","source":"sleep_after_open","target":"type_content"},{"id":"e-type_content-drop_images","source":"type_content","target":"drop_images"},{"id":"e-drop_images-sleep_after_drop","source":"drop_images","target":"sleep_after_drop"},{"id":"e-sleep_after_drop-click_post","source":"sleep_after_drop","target":"click_post"},{"id":"e-post_reels-merge_all","source":"post_reels","target":"merge_all"},{"id":"e-share_post-merge_all","source":"share_post","target":"merge_all"},{"id":"e-click_post-get_post_link","source":"click_post","target":"get_post_link"},{"id":"e-source-ai-nav-home-after-scrape","source":"source_ai_prompt","target":"nav_home_after_scrape"},{"id":"e-open_composer-if_composer_opened","source":"open_composer","target":"if_composer_opened"},{"id":"e-nav_profile-open_composer","source":"nav_profile","target":"open_composer"},{"id":"e-get_post_link-merge_all","source":"get_post_link","target":"merge_all"}]'::jsonb,updated_at=clock_timestamp() WHERE id=251;
IF (SELECT code FROM public.auto_blocks WHERE id=2672) IS DISTINCT FROM '// Centralized AI rewrite via ai_using.
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
      await new Promise(resolve => setTimeout(resolve, 700));
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
const postUrl = String(await getPostUrl().catch(() => '''') || '''').trim()
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
' THEN RAISE EXCEPTION 'v379 page postflight'; END IF;
IF NOT EXISTS(SELECT 1 FROM public.auto_workflows WHERE id=2
    AND nodes='[{"blockId":5,"blockName":"nav_to_url","config":{"url":"https://www.facebook.com"},"id":"nav","position":{"x":100,"y":0}},{"blockId":21,"blockName":"wait_for_selector","config":{"selector":"//*[@role=''main'']","timeout":10000},"id":"wait_main","position":{"x":100,"y":100}},{"blockId":1,"blockName":"if_else","config":{"condition":"vars.postAsReels === true"},"id":"if_reels","position":{"x":100,"y":200},"systemType":"ifElse"},{"blockId":37,"blockName":"fb_post_reels","config":{"screenshotCaptureOn":"failure","screenshotCaptureTiming":"after"},"id":"post_reels","position":{"x":0,"y":300}},{"blockId":1,"blockName":"if_else","config":{"condition":"vars.sharePost === true && !!vars.sourceLink"},"id":"if_share","position":{"x":200,"y":300},"systemType":"ifElse"},{"blockId":36,"blockName":"fb_share_post","config":{},"id":"share_post","position":{"x":100,"y":400}},{"blockId":1,"blockName":"if_else","config":{"condition":"vars.copyContentFromSource === true && !!vars.sourceLink"},"id":"if_copy","position":{"x":300,"y":400},"systemType":"ifElse"},{"blockId":35,"blockName":"fb_scrape_post","config":{},"id":"scrape","position":{"x":200,"y":500}},{"blockId":5,"blockName":"nav_to_url","config":{"url":"https://www.facebook.com"},"id":"nav_home_after_scrape","label":"Quay về trang chủ FB","position":{"x":200,"y":580}},{"blockId":21,"blockName":"wait_for_selector","config":{"selector":"//*[@role=''main'']","timeout":10000},"id":"wait_main_after_scrape","position":{"x":200,"y":660}},{"blockId":4,"blockName":"merge","config":{"mode":"any"},"id":"merge_compose","position":{"x":300,"y":740},"systemType":"merge"},{"blockId":27,"blockName":"fb_open_composer","config":{"composerActionCode":"fb_post_my_profile"},"id":"open_composer","position":{"x":300,"y":820}},{"blockId":20,"blockName":"sleep","config":{"ms":2000},"id":"sleep_after_open","position":{"x":300,"y":900}},{"blockId":28,"blockName":"fb_type_post_content","config":{},"id":"type_content","position":{"x":300,"y":980}},{"blockId":29,"blockName":"fb_drop_post_images","config":{},"id":"drop_images","position":{"x":300,"y":1060}},{"blockId":20,"blockName":"sleep","config":{"ms":5000},"id":"sleep_after_drop","position":{"x":300,"y":1140}},{"blockId":30,"blockName":"fb_click_post_button","config":{"screenshotCaptureOn":"failure","screenshotCaptureTiming":"after","verifyPostAfterClick":true},"id":"click_post","position":{"x":300,"y":1220}},{"blockId":4,"blockName":"merge","config":{"mode":"any"},"id":"merge_all","position":{"x":200,"y":1340},"systemType":"merge"},{"blockId":2674,"blockName":"fb_rewrite_source_content_ai","config":{},"id":"source_ai_prompt","label":"AI edit nội dung nguồn","position":{"x":200,"y":540}},{"blockId":1,"blockName":"if_else","config":{"condition":"input.opened === true"},"id":"if_composer_opened","position":{"x":520,"y":880},"systemType":"ifElse"},{"id":"nav_profile","blockId":5,"blockName":"nav_to_url","label":"Mở trang cá nhân","config":{"url":"https://www.facebook.com/profile.php"},"position":{"x":300,"y":780}}]'::jsonb || jsonb_build_array('{"id":"get_post_link","blockName":"fb_get_first_profile_post_link","label":"Lấy link bài trên cùng","config":{},"position":{"x":300,"y":1280}}'::jsonb || jsonb_build_object('blockId',new_block_id))
    AND edges='[{"id":"e-nav-wait_main","source":"nav","target":"wait_main"},{"id":"e-wait_main-if_reels","source":"wait_main","target":"if_reels"},{"id":"e-if_reels-post_reels-true","source":"if_reels","sourceHandle":"true","target":"post_reels"},{"id":"e-if_reels-if_share-false","source":"if_reels","sourceHandle":"false","target":"if_share"},{"id":"e-if_share-share_post-true","source":"if_share","sourceHandle":"true","target":"share_post"},{"id":"e-if_share-if_copy-false","source":"if_share","sourceHandle":"false","target":"if_copy"},{"id":"e-if_copy-scrape-true","source":"if_copy","sourceHandle":"true","target":"scrape"},{"id":"e-if_copy-merge_compose-false","source":"if_copy","sourceHandle":"false","target":"merge_compose"},{"id":"e-scrape-nav_home_after_scrape","source":"scrape","target":"source_ai_prompt"},{"id":"e-nav_home_after_scrape-wait_main_after_scrape","source":"nav_home_after_scrape","target":"wait_main_after_scrape"},{"id":"e-wait_main_after_scrape-merge_compose","source":"wait_main_after_scrape","target":"merge_compose"},{"id":"e-merge_compose-nav_profile","source":"merge_compose","target":"nav_profile"},{"id":"e-if_composer_opened-sleep_after_open-true","source":"if_composer_opened","sourceHandle":"true","target":"sleep_after_open"},{"id":"e-sleep_after_open-type_content","source":"sleep_after_open","target":"type_content"},{"id":"e-type_content-drop_images","source":"type_content","target":"drop_images"},{"id":"e-drop_images-sleep_after_drop","source":"drop_images","target":"sleep_after_drop"},{"id":"e-sleep_after_drop-click_post","source":"sleep_after_drop","target":"click_post"},{"id":"e-post_reels-merge_all","source":"post_reels","target":"merge_all"},{"id":"e-share_post-merge_all","source":"share_post","target":"merge_all"},{"id":"e-click_post-get_post_link","source":"click_post","target":"get_post_link"},{"id":"e-source-ai-nav-home-after-scrape","source":"source_ai_prompt","target":"nav_home_after_scrape"},{"id":"e-open_composer-if_composer_opened","source":"open_composer","target":"if_composer_opened"},{"id":"e-nav_profile-open_composer","source":"nav_profile","target":"open_composer"},{"id":"e-get_post_link-merge_all","source":"get_post_link","target":"merge_all"}]'::jsonb) THEN RAISE EXCEPTION 'v379: workflow 2 postflight'; END IF;
IF NOT EXISTS(SELECT 1 FROM public.auto_workflows WHERE id=251
    AND nodes='[{"blockId":5,"blockName":"nav_to_url","config":{"url":"https://www.facebook.com"},"id":"nav","position":{"x":100,"y":0}},{"blockId":21,"blockName":"wait_for_selector","config":{"selector":"//*[@role=''main'']","timeout":10000},"id":"wait_main","position":{"x":100,"y":100}},{"blockId":1,"blockName":"if_else","config":{"condition":"vars.postAsReels === true"},"id":"if_reels","position":{"x":100,"y":200},"systemType":"ifElse"},{"blockId":37,"blockName":"fb_post_reels","config":{"screenshotCaptureOn":"failure","screenshotCaptureTiming":"after"},"id":"post_reels","position":{"x":0,"y":300}},{"blockId":1,"blockName":"if_else","config":{"condition":"vars.sharePost === true && !!vars.sourceLink"},"id":"if_share","position":{"x":200,"y":300},"systemType":"ifElse"},{"blockId":36,"blockName":"fb_share_post","config":{},"id":"share_post","position":{"x":100,"y":400}},{"blockId":1,"blockName":"if_else","config":{"condition":"vars.copyContentFromSource === true && !!vars.sourceLink"},"id":"if_copy","position":{"x":300,"y":400},"systemType":"ifElse"},{"blockId":35,"blockName":"fb_scrape_post","config":{},"id":"scrape","position":{"x":200,"y":500}},{"blockId":5,"blockName":"nav_to_url","config":{"url":"https://www.facebook.com"},"id":"nav_home_after_scrape","label":"Quay về trang chủ FB","position":{"x":200,"y":580}},{"blockId":21,"blockName":"wait_for_selector","config":{"selector":"//*[@role=''main'']","timeout":10000},"id":"wait_main_after_scrape","position":{"x":200,"y":660}},{"blockId":4,"blockName":"merge","config":{"mode":"any"},"id":"merge_compose","position":{"x":300,"y":740},"systemType":"merge"},{"blockId":27,"blockName":"fb_open_composer","config":{"composerActionCode":"fb_post_my_profile"},"id":"open_composer","position":{"x":300,"y":820}},{"blockId":20,"blockName":"sleep","config":{"ms":2000},"id":"sleep_after_open","position":{"x":300,"y":900}},{"blockId":28,"blockName":"fb_type_post_content","config":{},"id":"type_content","position":{"x":300,"y":980}},{"blockId":29,"blockName":"fb_drop_post_images","config":{},"id":"drop_images","position":{"x":300,"y":1060}},{"blockId":20,"blockName":"sleep","config":{"ms":5000},"id":"sleep_after_drop","position":{"x":300,"y":1140}},{"blockId":30,"blockName":"fb_click_post_button","config":{"screenshotCaptureOn":"failure","screenshotCaptureTiming":"after","verifyPostAfterClick":true},"id":"click_post","position":{"x":300,"y":1220}},{"blockId":4,"blockName":"merge","config":{"mode":"any"},"id":"merge_all","position":{"x":200,"y":1340},"systemType":"merge"},{"blockId":2674,"blockName":"fb_rewrite_source_content_ai","config":{},"id":"source_ai_prompt","label":"AI edit nội dung nguồn","position":{"x":200,"y":540}},{"blockId":1,"blockName":"if_else","config":{"condition":"input.opened === true"},"id":"if_composer_opened","position":{"x":520,"y":880},"systemType":"ifElse"},{"id":"nav_profile","blockId":5,"blockName":"nav_to_url","label":"Mở trang cá nhân","config":{"url":"https://www.facebook.com/profile.php"},"position":{"x":300,"y":780}}]'::jsonb || jsonb_build_array('{"id":"get_post_link","blockName":"fb_get_first_profile_post_link","label":"Lấy link bài trên cùng","config":{},"position":{"x":300,"y":1280}}'::jsonb || jsonb_build_object('blockId',new_block_id))
    AND edges='[{"id":"e-nav-wait_main","source":"nav","target":"wait_main"},{"id":"e-wait_main-if_reels","source":"wait_main","target":"if_reels"},{"id":"e-if_reels-post_reels-true","source":"if_reels","sourceHandle":"true","target":"post_reels"},{"id":"e-if_reels-if_share-false","source":"if_reels","sourceHandle":"false","target":"if_share"},{"id":"e-if_share-share_post-true","source":"if_share","sourceHandle":"true","target":"share_post"},{"id":"e-if_share-if_copy-false","source":"if_share","sourceHandle":"false","target":"if_copy"},{"id":"e-if_copy-scrape-true","source":"if_copy","sourceHandle":"true","target":"scrape"},{"id":"e-if_copy-merge_compose-false","source":"if_copy","sourceHandle":"false","target":"merge_compose"},{"id":"e-scrape-nav_home_after_scrape","source":"scrape","target":"source_ai_prompt"},{"id":"e-nav_home_after_scrape-wait_main_after_scrape","source":"nav_home_after_scrape","target":"wait_main_after_scrape"},{"id":"e-wait_main_after_scrape-merge_compose","source":"wait_main_after_scrape","target":"merge_compose"},{"id":"e-merge_compose-nav_profile","source":"merge_compose","target":"nav_profile"},{"id":"e-if_composer_opened-sleep_after_open-true","source":"if_composer_opened","sourceHandle":"true","target":"sleep_after_open"},{"id":"e-sleep_after_open-type_content","source":"sleep_after_open","target":"type_content"},{"id":"e-type_content-drop_images","source":"type_content","target":"drop_images"},{"id":"e-drop_images-sleep_after_drop","source":"drop_images","target":"sleep_after_drop"},{"id":"e-sleep_after_drop-click_post","source":"sleep_after_drop","target":"click_post"},{"id":"e-post_reels-merge_all","source":"post_reels","target":"merge_all"},{"id":"e-share_post-merge_all","source":"share_post","target":"merge_all"},{"id":"e-click_post-get_post_link","source":"click_post","target":"get_post_link"},{"id":"e-source-ai-nav-home-after-scrape","source":"source_ai_prompt","target":"nav_home_after_scrape"},{"id":"e-open_composer-if_composer_opened","source":"open_composer","target":"if_composer_opened"},{"id":"e-nav_profile-open_composer","source":"nav_profile","target":"open_composer"},{"id":"e-get_post_link-merge_all","source":"get_post_link","target":"merge_all"}]'::jsonb) THEN RAISE EXCEPTION 'v379: workflow 251 postflight'; END IF;
END $v379$;
COMMIT;
