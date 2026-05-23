-- Migration v57: Facebook page post via UI, with generic profile/page identity DOM blocks.

BEGIN;

INSERT INTO public.auto_elements (name, xpath, description, category, is_builtin, staff_id, organization_id, updated_at)
VALUES
  ('FbIdentityMenuButton', '//*[@role=''button'' and @aria-label=''Trang cá nhân của bạn'']', 'Nút mở menu profile/page hiện tại', 'facebook', true, NULL, NULL, now()),
  ('FbCurrentIdentityLink', '//a[@href=''/me/'']', 'Link identity hiện tại trong menu profile', 'facebook', true, NULL, NULL, now()),
  ('FbIdentitySeeAllButton', '//*[@role=''button'' and @aria-label=''Xem tất cả trang cá nhân'']', 'Nút xem tất cả profile/page trong switcher', 'facebook', true, NULL, NULL, now()),
  ('FbIdentitySearchInput', '//input[contains(@aria-label, ''Tìm kiếm trang'')]', 'Ô tìm kiếm page/profile trong switcher', 'facebook', true, NULL, NULL, now()),
  ('FbIdentitySelectByNameButton', '//*[@role=''button'' and .//span[.=''$page_name'']]', 'Nút chọn identity/page theo tên', 'facebook', true, NULL, NULL, now()),
  ('FbComposerCloseDialogButton', '//*[@role=''dialog'']//*[@role=''button'' and @aria-label=''Đóng'']|//*[@role=''button'' and .=''Dùng Trang'']', 'Đóng dialog hoặc CTA Dùng Trang nếu xuất hiện', 'facebook', true, NULL, NULL, now()),
  ('FbComposerOpenButton', '//*[@role = ''button'' and (contains(.,''Bạn đang nghĩ gì?'') or contains(.,''on your mind?'') or contains(.,''Write something'') or contains(.,''Bạn viết gì đi'') or contains(.,''đang bán gì''))]', 'Nút mở composer đăng bài cho identity hiện tại', 'facebook', true, NULL, NULL, now()),
  ('FbComposerDiscussionTab', '//a[@href and @role=''tab'' and (.=''Discussion'' or .=''Thảo luận'')]', 'Tab thảo luận fallback theo C#', 'facebook', true, NULL, NULL, now()),
  ('FbComposerTextInput', '//form[@method=''POST'']//*[contains(@class,''notranslate'')]|//form[@method=''POST'']//div[@role=''textbox'']', 'Ô nhập nội dung trong composer', 'facebook', true, NULL, NULL, now()),
  ('FbComposerForm', '//*[@role=''dialog'']//form[@method=''POST'']', 'Form composer dùng để drop media', 'facebook', true, NULL, NULL, now()),
  ('FbComposerNextButton', '//*[@role=''button'' and (contains(.,''Next'') or contains(.,''Tiếp''))]', 'Nút Next/Tiếp trong composer', 'facebook', true, NULL, NULL, now()),
  ('FbComposerReelsNextButton', '//*[@role=''button'' and (@aria-label=''Tiếp'' or @aria-label=''Next'') and not(@aria-disabled)]', 'Nút Next/Tiếp của reels nếu xuất hiện', 'facebook', true, NULL, NULL, now()),
  ('FbComposerSubmitButton', '//*[not(@aria-hidden)]/form//*[@role=''button'' and (contains(.,''Post'') or .=''Đăng'')]', 'Nút Post/Đăng trong composer', 'facebook', true, NULL, NULL, now()),
  ('FbComposerAnotherTimeButton', '//*[@role=''button'' and .=''Lúc khác'']', 'Nút Lúc khác sau khi đăng nếu Facebook hỏi', 'facebook', true, NULL, NULL, now()),
  ('FbComposerErrorMessage', '//span[@id=''akabiz'' and contains(.,''giới hạn tần suất bạn đăng bài'')]', 'Thông báo lỗi đăng bài theo C#', 'facebook', true, NULL, NULL, now()),
  ('FbComposerRawPostLink', '//*[@role=''main'']//a[@target=''_blank'' and contains(@href, ''?__cft__[0]='')]', 'Raw link bài vừa đăng trước khi Facebook render permalink', 'facebook', true, NULL, NULL, now()),
  ('FbComposerPostLink', '//a[contains(@href, ''/posts/'') or contains(@href, ''story_fbid='')]', 'Permalink bài vừa đăng sau khi focusin raw link', 'facebook', true, NULL, NULL, now())
ON CONFLICT (name) DO UPDATE SET
  xpath = EXCLUDED.xpath,
  description = EXCLUDED.description,
  category = EXCLUDED.category,
  is_builtin = true,
  updated_at = now();

INSERT INTO public.auto_blocks (
  name, description, icon, category, kind, system_type, code,
  config_schema, output_schema, default_config, is_builtin, staff_id, organization_id, updated_at
)
VALUES
(
  'fb_get_current_identity_name',
  'Lấy tên profile/page Facebook hiện tại bằng menu identity theo C# DOM.',
  'UserRound',
  'facebook',
  'js',
  NULL,
$block$
const stepMs = Number(vars.facebookStepMs || input.facebookStepMs || 1000)
const menuSelector = await helpers.element('FbIdentityMenuButton')
const currentSelector = await helpers.element('FbCurrentIdentityLink')

async function rawClick(selector) {
  return await page.evaluate(`
    const selector = __args[0];
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
    const el = xpathAll(selector)[0] || null;
    if (!el) return { clicked: false };
    clickSynthetic(el);
    return { clicked: true };
  `, selector)
}

async function rawText(selector) {
  return await page.evaluate(`
    const selector = __args[0];
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
    return el ? String(el.innerText || el.textContent || '').trim() : '';
  `, selector)
}

helpers.log('Đang lấy tên Facebook identity hiện tại')
await page.navigate('https://facebook.com')
const opened = await rawClick(menuSelector)
if (!opened || opened.clicked !== true) throw new Error('Không tìm thấy nút mở menu profile/page hiện tại')
await helpers.sleep(stepMs + 500, signal)

const identityName = String(await rawText(currentSelector) || '').trim()
await rawClick(menuSelector).catch(() => null)
await helpers.sleep(stepMs + 500, signal)

if (!identityName) throw new Error('Không lấy được tên Facebook identity hiện tại')
vars.originalIdentityName = identityName
helpers.log('Identity hiện tại: ' + identityName)
return { ok: true, identityName }
$block$,
  '[
    {"name":"facebookStepMs","type":"number","label":"Step delay"}
  ]'::jsonb,
  '[
    {"name":"ok","type":"boolean","label":"OK"},
    {"name":"identityName","type":"string","label":"Tên identity"}
  ]'::jsonb,
  '{"facebookStepMs":1000}'::jsonb,
  true,
  NULL,
  NULL,
  now()
),
(
  'fb_switch_identity_by_name',
  'Chuyển Facebook sang profile/page theo tên bằng switcher identity theo C# DOM.',
  'RefreshCw',
  'facebook',
  'js',
  NULL,
$block$
const stepMs = Number(vars.facebookStepMs || input.facebookStepMs || 1000)
const identityName = String(input.identityName || vars.identityName || vars.pageName || '').trim()
if (!identityName) throw new Error('Thiếu tên identity/page cần chuyển')

const menuSelector = await helpers.element('FbIdentityMenuButton')
const seeAllSelector = await helpers.element('FbIdentitySeeAllButton')
const searchSelector = await helpers.element('FbIdentitySearchInput')
const selectTemplate = await helpers.element('FbIdentitySelectByNameButton')

function xpathLiteral(value) {
  const text = String(value || '')
  if (!text.includes("'")) return "'" + text + "'"
  const singleQuoteLiteral = '"\'"'
  return 'concat(' + text.split("'").map(part => "'" + part + "'").join(', ' + singleQuoteLiteral + ', ') + ')'
}

const selectSelector = selectTemplate.replace("'$page_name'", xpathLiteral(identityName)).replace('$page_name', identityName)

async function rawClick(selector) {
  return await page.evaluate(`
    const selector = __args[0];
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
    const el = xpathAll(selector)[0] || null;
    if (!el) return { clicked: false };
    clickSynthetic(el);
    return { clicked: true };
  `, selector)
}

async function rawFill(selector, value) {
  return await page.evaluate(`
    const selector = __args[0];
    const value = __args[1];
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
    if (!el) return { filled: false };
    try { el.focus(); } catch {}
    el.value = '';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.value = String(value || '');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return { filled: true };
  `, selector, value)
}

helpers.log('Đang chuyển Facebook identity sang "' + identityName + '"')
await page.navigate('https://facebook.com')
const opened = await rawClick(menuSelector)
if (!opened || opened.clicked !== true) throw new Error('Không tìm thấy nút mở menu profile/page hiện tại')
await helpers.sleep(stepMs + 500, signal)

const seeAll = await rawClick(seeAllSelector)
if (!seeAll || seeAll.clicked !== true) throw new Error('Không tìm thấy nút xem tất cả profile/page')
await helpers.sleep(stepMs + 500, signal)

let selected = await rawClick(selectSelector)
if (selected && selected.clicked === true) {
  await helpers.sleep(stepMs + 7000, signal)
  helpers.log('Đã chuyển identity sang "' + identityName + '"')
  return { ok: true, identityName }
}

const filled = await rawFill(searchSelector, identityName)
if (filled && filled.filled === true) await helpers.sleep(stepMs + 500, signal)

selected = await rawClick(selectSelector)
if (selected && selected.clicked === true) {
  await helpers.sleep(stepMs + 7000, signal)
  helpers.log('Đã chuyển identity sang "' + identityName + '"')
  return { ok: true, identityName }
}

return { ok: false, identityName, message: 'Không tìm thấy page/profile "' + identityName + '"' }
$block$,
  '[
    {"name":"identityName","type":"string","label":"Tên identity"},
    {"name":"facebookStepMs","type":"number","label":"Step delay"}
  ]'::jsonb,
  '[
    {"name":"ok","type":"boolean","label":"OK"},
    {"name":"identityName","type":"string","label":"Tên identity"},
    {"name":"message","type":"string","label":"Thông báo"}
  ]'::jsonb,
  '{"facebookStepMs":1000}'::jsonb,
  true,
  NULL,
  NULL,
  now()
),
(
  'fb_post_current_identity_ui',
  'Đăng bài bằng giao diện lên Facebook identity hiện đang được chọn.',
  'Send',
  'facebook',
  'js',
  NULL,
$block$
const stepMs = Number(vars.facebookStepMs || input.facebookStepMs || 1000)
const submitTimeoutMs = Number(vars.facebookSubmitTimeoutMs || input.facebookSubmitTimeoutMs || 30000)
const publishTimeoutMs = Number(vars.facebookPublishTimeoutMs || input.facebookPublishTimeoutMs || 120000)

const closeSelector = await helpers.element('FbComposerCloseDialogButton')
const openSelector = await helpers.element('FbComposerOpenButton')
const discussionSelector = await helpers.element('FbComposerDiscussionTab')
const textSelector = await helpers.element('FbComposerTextInput')
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
    const response = await page.apiCall({
      url: 'https://api.akaapp.vn/api/AI/rewriteContent',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: { content, questionContentName: 'rewrite_content', source: 'aka_agent' },
      timeout: 120000
    })
    if (response.status < 200 || response.status >= 300) throw new Error('AI trả về lỗi ' + response.status)
    const payload = response.data || {}
    const ok = payload.status === 1 || payload.status === '1'
    if (!ok) throw new Error(String(payload.message || 'AI không thể xử lý nội dung lúc này.'))
    if (typeof payload.data !== 'string') throw new Error('AI trả về nội dung không hợp lệ.')
    helpers.log('Đã viết lại nội dung bằng AI')
    return payload.data
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

function sleepAfterTypingMs(content) {
  const words = String(content || '').split(/\s+/).filter(Boolean).length
  if (words === 0) return stepMs
  return Math.min(60000, Math.max(2000, stepMs + words * 120))
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
await helpers.sleep(stepMs, signal)
await page.navigate('https://www.facebook.com/profile.php')
await helpers.sleep(stepMs + 2000, signal)
await rawClick(closeSelector).catch(() => null)

let openCount = await rawCount(openSelector)
if (openCount === 0) {
  await rawClick(discussionSelector).catch(() => null)
  await helpers.sleep(stepMs + 1000, signal)
}
openCount = await rawCount(openSelector)
if (openCount === 0) {
  return { ok: false, posted: false, error: 'Không tìm thấy nút tạo bài viết' }
}

const opened = await rawClick(openSelector)
if (!opened || opened.clicked !== true) {
  return { ok: false, posted: false, error: 'Lỗi khi nhấn nút tạo bài post' }
}
await helpers.sleep(stepMs + 1000, signal)

if (message) {
  const filled = await rawFillContent(textSelector, message)
  if (!filled || filled.filled !== true) {
    return { ok: false, posted: false, error: 'Lỗi khi nhập nội dung bài post: ' + String(filled && filled.message ? filled.message : '') }
  }
  await helpers.sleep(sleepAfterTypingMs(message), signal)
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
const postUrl = String(await getPostUrl() || '').trim()
helpers.log('Đăng bài bằng giao diện thành công')

return {
  ok: true,
  posted: true,
  mode: 'ui',
  postUrl,
  imageCount: images.length
}
$block$,
  '[
    {"name":"campaignContent","type":"string","label":"Nội dung"},
    {"name":"images","type":"array","label":"Ảnh"},
    {"name":"facebookStepMs","type":"number","label":"Step delay"}
  ]'::jsonb,
  '[
    {"name":"ok","type":"boolean","label":"OK"},
    {"name":"posted","type":"boolean","label":"Đã đăng"},
    {"name":"postUrl","type":"string","label":"Post URL"},
    {"name":"imageCount","type":"number","label":"Số ảnh"},
    {"name":"error","type":"string","label":"Lỗi"}
  ]'::jsonb,
  '{"facebookStepMs":1000,"facebookSubmitTimeoutMs":30000,"facebookPublishTimeoutMs":120000}'::jsonb,
  true,
  NULL,
  NULL,
  now()
),
(
  'fb_page_post_ui',
  'Đăng bài lên fanpage bằng giao diện Facebook: lưu profile gốc, chuyển page, đăng, rồi chuyển lại profile gốc.',
  'Send',
  'facebook',
  'js',
  NULL,
$block$
const pageUid = String(vars.pageUid || input.pageUid || vars.inputDataUid || '').trim()
const pageName = String(vars.pageName || input.pageName || vars.inputDataName || '').trim()
const stepMs = Number(vars.facebookStepMs || input.facebookStepMs || 1000)
const submitTimeoutMs = Number(vars.facebookSubmitTimeoutMs || input.facebookSubmitTimeoutMs || 30000)
const publishTimeoutMs = Number(vars.facebookPublishTimeoutMs || input.facebookPublishTimeoutMs || 120000)

if (!pageName) throw new Error('Thiếu tên fanpage để chuyển identity Facebook')

const menuSelector = await helpers.element('FbIdentityMenuButton')
const currentSelector = await helpers.element('FbCurrentIdentityLink')
const seeAllSelector = await helpers.element('FbIdentitySeeAllButton')
const searchSelector = await helpers.element('FbIdentitySearchInput')
const selectTemplate = await helpers.element('FbIdentitySelectByNameButton')
const closeSelector = await helpers.element('FbComposerCloseDialogButton')
const openSelector = await helpers.element('FbComposerOpenButton')
const discussionSelector = await helpers.element('FbComposerDiscussionTab')
const textSelector = await helpers.element('FbComposerTextInput')
const formSelector = await helpers.element('FbComposerForm')
const nextSelector = await helpers.element('FbComposerNextButton')
const reelsNextSelector = await helpers.element('FbComposerReelsNextButton')
const submitSelector = await helpers.element('FbComposerSubmitButton')
const anotherTimeSelector = await helpers.element('FbComposerAnotherTimeButton')
const errorSelector = await helpers.element('FbComposerErrorMessage')
const rawLinkSelector = await helpers.element('FbComposerRawPostLink')
const postLinkSelector = await helpers.element('FbComposerPostLink')

function xpathLiteral(value) {
  const text = String(value || '')
  if (!text.includes("'")) return "'" + text + "'"
  const singleQuoteLiteral = '"\'"'
  return 'concat(' + text.split("'").map(part => "'" + part + "'").join(', ' + singleQuoteLiteral + ', ') + ')'
}

function selectIdentitySelector(identityName) {
  return selectTemplate.replace("'$page_name'", xpathLiteral(identityName)).replace('$page_name', identityName)
}

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
    const fullName = String(vars.campaignInputDataName || vars.inputDataName || pageName || '').trim()
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
    const response = await page.apiCall({
      url: 'https://api.akaapp.vn/api/AI/rewriteContent',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: { content, questionContentName: 'rewrite_content', source: 'aka_agent' },
      timeout: 120000
    })
    if (response.status < 200 || response.status >= 300) throw new Error('AI trả về lỗi ' + response.status)
    const payload = response.data || {}
    const ok = payload.status === 1 || payload.status === '1'
    if (!ok) throw new Error(String(payload.message || 'AI không thể xử lý nội dung lúc này.'))
    if (typeof payload.data !== 'string') throw new Error('AI trả về nội dung không hợp lệ.')
    helpers.log('Đã viết lại nội dung bằng AI')
    return payload.data
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
  return { ok: false, posted: false, mode: 'ui', pageUid, pageName, postUrl: '', imageCount: 0, restoreOk: false, error: 'Không có nội dung hoặc ảnh để đăng fanpage' }
}

function sleepAfterTypingMs(content) {
  const words = String(content || '').split(/\s+/).filter(Boolean).length
  if (words === 0) return stepMs
  return Math.min(60000, Math.max(2000, stepMs + words * 120))
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

async function rawFill(selector, value) {
  return await page.evaluate(`
    const selector = __args[0];
    const value = __args[1];
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
    if (!el) return { filled: false };
    try { el.focus(); } catch {}
    el.value = '';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.value = String(value || '');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return { filled: true };
  `, selector, value)
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

async function getCurrentIdentityName() {
  helpers.log('Đang lấy tên profile gốc')
  await page.navigate('https://facebook.com')
  const opened = await rawClick(menuSelector)
  if (!opened || opened.clicked !== true) throw new Error('Không tìm thấy nút mở menu profile/page hiện tại')
  await helpers.sleep(stepMs + 500, signal)
  const identityName = String(await rawText(currentSelector) || '').trim()
  await rawClick(menuSelector).catch(() => null)
  await helpers.sleep(stepMs + 500, signal)
  if (!identityName) throw new Error('Không lấy được tên profile gốc')
  vars.originalIdentityName = identityName
  return identityName
}

async function switchIdentity(identityName, useSignal) {
  const activeSignal = useSignal === false ? undefined : signal
  helpers.log('Đang chuyển sang "' + identityName + '"')
  await page.navigate('https://facebook.com')
  const opened = await rawClick(menuSelector)
  if (!opened || opened.clicked !== true) return { ok: false, message: 'Không tìm thấy nút mở menu profile/page hiện tại' }
  await helpers.sleep(stepMs + 500, activeSignal)
  const seeAll = await rawClick(seeAllSelector)
  if (!seeAll || seeAll.clicked !== true) return { ok: false, message: 'Không tìm thấy nút xem tất cả profile/page' }
  await helpers.sleep(stepMs + 500, activeSignal)

  const selector = selectIdentitySelector(identityName)
  let selected = await rawClick(selector)
  if (selected && selected.clicked === true) {
    await helpers.sleep(stepMs + 7000, activeSignal)
    return { ok: true }
  }

  const filled = await rawFill(searchSelector, identityName)
  if (filled && filled.filled === true) await helpers.sleep(stepMs + 500, activeSignal)

  selected = await rawClick(selector)
  if (selected && selected.clicked === true) {
    await helpers.sleep(stepMs + 7000, activeSignal)
    return { ok: true }
  }

  return { ok: false, message: 'Không tìm thấy page/profile "' + identityName + '"' }
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

async function postCurrentIdentity() {
  helpers.log('Đang mở composer đăng bài trên fanpage "' + pageName + '"')
  await rawClick(closeSelector).catch(() => null)
  await helpers.sleep(stepMs, signal)
  await page.navigate('https://www.facebook.com/profile.php')
  await helpers.sleep(stepMs + 2000, signal)
  await rawClick(closeSelector).catch(() => null)

  let openCount = await rawCount(openSelector)
  if (openCount === 0) {
    await rawClick(discussionSelector).catch(() => null)
    await helpers.sleep(stepMs + 1000, signal)
  }
  openCount = await rawCount(openSelector)
  if (openCount === 0) return { ok: false, error: 'Không tìm thấy nút tạo bài viết' }

  const opened = await rawClick(openSelector)
  if (!opened || opened.clicked !== true) return { ok: false, error: 'Lỗi khi nhấn nút tạo bài post' }
  await helpers.sleep(stepMs + 1000, signal)

  if (message) {
    const filled = await rawFillContent(textSelector, message)
    if (!filled || filled.filled !== true) {
      return { ok: false, error: 'Lỗi khi nhập nội dung bài post: ' + String(filled && filled.message ? filled.message : '') }
    }
    await helpers.sleep(sleepAfterTypingMs(message), signal)
  }

  if (images.length > 0) {
    helpers.log('Đang upload ' + images.length + ' ảnh vào composer')
    const dropResult = await page.dropFile(formSelector, images)
    if (!dropResult || dropResult.fileCount < images.length) {
      return { ok: false, imageCount: Number(dropResult && dropResult.fileCount || 0), error: 'Đường dẫn file media không hợp lệ hoặc upload ảnh thất bại' }
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

  if (!clickedSubmit) return { ok: false, imageCount: images.length, error: 'Lỗi khi nhấn nút đăng bài' }

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
      imageCount: images.length,
      error: 'Đăng bài thất bại: ' + (errorMessage || 'Vui lòng kiểm tra lỗi trên giao diện facebook')
    }
  }

  await helpers.sleep(stepMs + 3000, signal)
  await rawClick(closeSelector).catch(() => null)
  const postUrl = String(await getPostUrl() || '').trim()
  return { ok: true, postUrl, imageCount: images.length }
}

let originalIdentityName = ''
let restoreOk = false
let postResult = null
let finalResult = null

try {
  originalIdentityName = await getCurrentIdentityName()
  helpers.log('Profile gốc: ' + originalIdentityName)

  const switched = await switchIdentity(pageName, true)
  if (!switched.ok) {
    finalResult = {
      ok: false,
      posted: false,
      mode: 'ui',
      pageUid,
      pageName,
      postUrl: '',
      imageCount: 0,
      restoreOk: false,
      error: switched.message || 'Không chuyển được sang fanpage'
    }
  } else {
    postResult = await postCurrentIdentity()
    if (!postResult || postResult.ok !== true) {
      finalResult = {
        ok: false,
        posted: false,
        mode: 'ui',
        pageUid,
        pageName,
        postUrl: '',
        imageCount: Number(postResult && postResult.imageCount || 0),
        restoreOk: false,
        error: String(postResult && postResult.error ? postResult.error : 'Đăng bài fanpage trên giao diện thất bại')
      }
    } else {
      helpers.log('Đăng bài fanpage bằng giao diện thành công')
      finalResult = {
        ok: true,
        posted: true,
        mode: 'ui',
        pageUid,
        pageName,
        postUrl: String(postResult.postUrl || ''),
        imageCount: images.length,
        restoreOk: false
      }
    }
  }
} catch (e) {
  finalResult = {
    ok: false,
    posted: false,
    mode: 'ui',
    pageUid,
    pageName,
    postUrl: '',
    imageCount: Number(postResult && postResult.imageCount || 0),
    restoreOk: false,
    error: e && e.message ? String(e.message) : String(e)
  }
} finally {
  if (originalIdentityName) {
    try {
      const restored = await switchIdentity(originalIdentityName, false)
      restoreOk = restored && restored.ok === true
      if (restoreOk) helpers.log('Đã chuyển lại profile gốc "' + originalIdentityName + '"')
      else helpers.log('Không chuyển lại được profile gốc "' + originalIdentityName + '": ' + String(restored && restored.message ? restored.message : 'lỗi không xác định'))
    } catch (restoreError) {
      helpers.log('Lỗi khi chuyển lại profile gốc "' + originalIdentityName + '": ' + (restoreError && restoreError.message ? restoreError.message : String(restoreError)))
    }
  }
}
if (finalResult && typeof finalResult === 'object') finalResult.restoreOk = restoreOk
return finalResult || { ok: false, posted: false, mode: 'ui', pageUid, pageName, postUrl: '', imageCount: 0, restoreOk, error: 'Đăng bài fanpage trên giao diện thất bại' }
$block$,
  '[
    {"name":"pageUid","type":"string","label":"Page ID"},
    {"name":"pageName","type":"string","label":"Tên page"},
    {"name":"campaignContent","type":"string","label":"Nội dung"},
    {"name":"images","type":"array","label":"Ảnh"},
    {"name":"facebookStepMs","type":"number","label":"Step delay"}
  ]'::jsonb,
  '[
    {"name":"ok","type":"boolean","label":"OK"},
    {"name":"posted","type":"boolean","label":"Đã đăng"},
    {"name":"mode","type":"string","label":"Mode"},
    {"name":"pageUid","type":"string","label":"Page ID"},
    {"name":"pageName","type":"string","label":"Tên page"},
    {"name":"postUrl","type":"string","label":"Post URL"},
    {"name":"imageCount","type":"number","label":"Số ảnh"},
    {"name":"restoreOk","type":"boolean","label":"Đã restore profile"},
    {"name":"error","type":"string","label":"Lỗi"}
  ]'::jsonb,
  '{"facebookStepMs":1000,"facebookSubmitTimeoutMs":30000,"facebookPublishTimeoutMs":120000}'::jsonb,
  true,
  NULL,
  NULL,
  now()
)
ON CONFLICT (name) DO UPDATE SET
  description = EXCLUDED.description,
  icon = EXCLUDED.icon,
  category = EXCLUDED.category,
  kind = EXCLUDED.kind,
  system_type = EXCLUDED.system_type,
  code = EXCLUDED.code,
  config_schema = EXCLUDED.config_schema,
  output_schema = EXCLUDED.output_schema,
  default_config = EXCLUDED.default_config,
  is_builtin = true,
  updated_at = now();

WITH block_ids AS (
  SELECT name, id
  FROM public.auto_blocks
  WHERE name IN ('if_else', 'fb_scrape_post', 'merge', 'fb_page_post_api', 'fb_page_post_ui')
)
INSERT INTO public.auto_workflows (
  name, description, nodes, edges, variables_schema, default_variables,
  is_builtin, staff_id, organization_id, updated_at
)
SELECT
  'facebook_page_post',
  'Workflow đăng bài lên fanpage Facebook, route API hoặc giao diện theo pagePostMode.',
  jsonb_build_array(
    jsonb_build_object(
      'id', 'if_copy_source',
      'label', 'Có copy nguồn?',
      'config', jsonb_build_object('condition', 'vars.copyContentFromSource === true && !!vars.sourceLink'),
      'blockId', (SELECT id FROM block_ids WHERE name = 'if_else'),
      'position', jsonb_build_object('x', 0, 'y', 0),
      'blockName', 'if_else',
      'systemType', 'ifElse'
    ),
    jsonb_build_object(
      'id', 'scrape_source',
      'label', 'Copy nội dung nguồn',
      'config', '{}'::jsonb,
      'blockId', (SELECT id FROM block_ids WHERE name = 'fb_scrape_post'),
      'position', jsonb_build_object('x', -160, 'y', 120),
      'blockName', 'fb_scrape_post'
    ),
    jsonb_build_object(
      'id', 'merge_source',
      'label', 'Gộp nguồn',
      'config', jsonb_build_object('mode', 'any'),
      'blockId', (SELECT id FROM block_ids WHERE name = 'merge'),
      'position', jsonb_build_object('x', 0, 'y', 240),
      'blockName', 'merge',
      'systemType', 'merge'
    ),
    jsonb_build_object(
      'id', 'if_ui_mode',
      'label', 'Đăng bằng giao diện?',
      'config', jsonb_build_object('condition', 'vars.pagePostMode === ''ui'''),
      'blockId', (SELECT id FROM block_ids WHERE name = 'if_else'),
      'position', jsonb_build_object('x', 0, 'y', 360),
      'blockName', 'if_else',
      'systemType', 'ifElse'
    ),
    jsonb_build_object(
      'id', 'post_page_ui',
      'label', 'Đăng fanpage bằng giao diện',
      'config', '{}'::jsonb,
      'blockId', (SELECT id FROM block_ids WHERE name = 'fb_page_post_ui'),
      'position', jsonb_build_object('x', -160, 'y', 480),
      'blockName', 'fb_page_post_ui'
    ),
    jsonb_build_object(
      'id', 'post_page_api',
      'label', 'Đăng fanpage bằng API',
      'config', '{}'::jsonb,
      'blockId', (SELECT id FROM block_ids WHERE name = 'fb_page_post_api'),
      'position', jsonb_build_object('x', 160, 'y', 480),
      'blockName', 'fb_page_post_api'
    )
  ),
  '[
    {"id":"e-if-copy-true","source":"if_copy_source","target":"scrape_source","sourceHandle":"true"},
    {"id":"e-if-copy-false","source":"if_copy_source","target":"merge_source","sourceHandle":"false"},
    {"id":"e-scrape-merge","source":"scrape_source","target":"merge_source"},
    {"id":"e-merge-if-ui","source":"merge_source","target":"if_ui_mode"},
    {"id":"e-if-ui-true","source":"if_ui_mode","target":"post_page_ui","sourceHandle":"true"},
    {"id":"e-if-ui-false","source":"if_ui_mode","target":"post_page_api","sourceHandle":"false"}
  ]'::jsonb,
  '[
    {"name":"pageUid","type":"string","label":"Page ID"},
    {"name":"pageName","type":"string","label":"Tên page"},
    {"name":"campaignContent","type":"string","label":"Nội dung"},
    {"name":"images","type":"array","label":"Ảnh"},
    {"name":"copyContentFromSource","type":"boolean","label":"Copy nội dung từ nguồn"},
    {"name":"includeSourceImages","type":"boolean","label":"Lấy kèm hình ảnh"},
    {"name":"sourceLink","type":"string","label":"Link nguồn"},
    {"name":"pagePostMode","type":"string","label":"Chế độ đăng"}
  ]'::jsonb,
  '{"businessUrl":"https://business.facebook.com/content_management","pagePostMode":"api","published":true,"facebookStepMs":1000,"facebookSubmitTimeoutMs":30000,"facebookPublishTimeoutMs":120000}'::jsonb,
  true,
  NULL,
  NULL,
  now()
ON CONFLICT (name) DO UPDATE SET
  description = EXCLUDED.description,
  nodes = EXCLUDED.nodes,
  edges = EXCLUDED.edges,
  variables_schema = EXCLUDED.variables_schema,
  default_variables = EXCLUDED.default_variables,
  is_builtin = true,
  updated_at = now();

UPDATE public.auto_campaign_actions
SET workflow_id = (SELECT id FROM public.auto_workflows WHERE name = 'facebook_page_post')
WHERE id = 'facebook_page_post';

NOTIFY pgrst, 'reload schema';

COMMIT;
