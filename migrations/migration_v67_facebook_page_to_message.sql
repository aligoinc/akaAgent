-- Migration v67: Facebook campaign gửi tin nhắn đến khách từng inbox với page.

BEGIN;

INSERT INTO public.auto_account_actions (flatform_type, name, code)
VALUES ('facebook', 'Nhắn tin khách inbox page', 'fb_message_page_inbox_customer')
ON CONFLICT (code) DO UPDATE SET
  flatform_type = EXCLUDED.flatform_type,
  name = EXCLUDED.name,
  is_active = true,
  is_delete = false,
  updated_at = now();

INSERT INTO public.auto_elements (name, xpath, description, category, is_builtin, staff_id, organization_id, updated_at)
VALUES
  ('FbPageInboxSearchButton', $xpath$//*[@class='img sp_eC3AlU9C1ar_1_5x sx_122ae6' or @class='img sp_mKapIAr9nK6_1_5x sx_7ba3ff']$xpath$, 'Nút tìm kiếm khách trong Business Inbox theo JS akaBizFacebook', 'facebook', true, NULL, NULL, now()),
  ('FbPageInboxSearchInput', $xpath$//*[@placeholder='Tìm kiếm' or @placeholder='Search']$xpath$, 'Ô tìm kiếm khách trong Business Inbox theo JS akaBizFacebook', 'facebook', true, NULL, NULL, now()),
  ('FbPageInboxSearchResult', $xpath$//*[@class='_7znk']//span[not(@class)]$xpath$, 'Kết quả tìm kiếm khách trong Business Inbox theo JS akaBizFacebook', 'facebook', true, NULL, NULL, now()),
  ('FbPageInboxConversationResult', $xpath$//*[@class='uiScrollableAreaContent']//*[@role='presentation']$xpath$, 'Conversation result để chọn lại sau khi search theo JS akaBizFacebook', 'facebook', true, NULL, NULL, now()),
  ('FbPageInboxSearchClearButton', $xpath$//*[@aria-label='Xóa' or @aria-label='Clear']$xpath$, 'Nút xoá/đóng tìm kiếm trong Business Inbox theo JS akaBizFacebook', 'facebook', true, NULL, NULL, now()),
  ('FbPageInboxCloseButton', $xpath$//*[@role='button' and @aria-label='Đóng']$xpath$, 'Nút đóng dialog nếu có theo JS akaBizFacebook', 'facebook', true, NULL, NULL, now()),
  ('FbPageInboxHeaderName', $xpath$//*[@data-pagelet='BizInboxDetailViewHeaderSectionWrapper']//*[@class='_4ik4 _4ik5']$xpath$, 'Tên khách đang mở trong header Business Inbox theo JS akaBizFacebook', 'facebook', true, NULL, NULL, now()),
  ('FbPageInboxMessageInput', $xpath$//textarea[@type='text']|//div[@role='textbox']$xpath$, 'Ô nhập tin Business Inbox theo JS akaBizFacebook', 'facebook', true, NULL, NULL, now()),
  ('FbPageInboxMessengerReplyInput', $xpath$//*[@class='notranslate _5rpu' or @placeholder='Reply in Messenger…' or @placeholder='Trả lời trong Messenger…' or @aria-label='Reply in Messenger…' or @aria-label='Trả lời trong Messenger…']$xpath$, 'Ô reply Messenger theo element hiện tại', 'facebook', true, NULL, NULL, now()),
  ('FbPageInboxSendButtonDisabled', $xpath$//*[@role='button' and (.='Gửi' or .='Send') and @aria-disabled='true']$xpath$, 'Nút gửi đang disabled khi upload theo C#', 'facebook', true, NULL, NULL, now()),
  ('FbPageInboxSendButton', $xpath$//*[@role='button' and (.='Gửi' or .='Send')]$xpath$, 'Nút gửi tin trong Business Inbox theo C#', 'facebook', true, NULL, NULL, now()),
  ('FbPageInboxSendFailIcon', '._61ag', 'Icon báo gửi tin thất bại theo C#', 'facebook', true, NULL, NULL, now())
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
  'fb_page_inbox_open',
  'Mở Business Inbox của page trước khi gửi tin khách inbox page.',
  'Inbox',
  'facebook',
  'js',
  NULL,
$block$
const pageUid = String(vars.pageInboxPageUid || input.pageInboxPageUid || '').trim()
const pageName = String(vars.pageInboxPageName || input.pageInboxPageName || pageUid).trim()
const inboxBaseUrl = String(vars.pageInboxUrl || input.pageInboxUrl || 'https://business.facebook.com/latest/inbox/all').trim()
const stepMs = Number(vars.facebookStepMs || input.facebookStepMs || 1000)

if (!pageUid) throw new Error('Thiếu Page ID để mở Business Inbox')

const targetUrl = inboxBaseUrl + '?asset_id=' + encodeURIComponent(pageUid)
const currentUrl = String(page.getURL() || '')
if (!currentUrl.includes('business.facebook.com/latest/inbox') || !currentUrl.includes(pageUid)) {
  helpers.log('Đang mở inbox của page' + (pageName ? ': ' + pageName : ''))
  await page.navigate(targetUrl)
  await helpers.sleep(stepMs + 5000, signal)
}

return { ok: true, pageUid, pageName, url: targetUrl }
$block$,
  '[
    {"name":"pageInboxPageUid","type":"string","label":"Page ID"},
    {"name":"pageInboxPageName","type":"string","label":"Tên page"},
    {"name":"facebookStepMs","type":"number","label":"Step delay"}
  ]'::jsonb,
  '[
    {"name":"ok","type":"boolean","label":"OK"},
    {"name":"pageUid","type":"string","label":"Page ID"},
    {"name":"pageName","type":"string","label":"Tên page"}
  ]'::jsonb,
  '{"pageInboxUrl":"https://business.facebook.com/latest/inbox/all","facebookStepMs":1000}'::jsonb,
  true,
  NULL,
  NULL,
  now()
),
(
  'fb_send_page_inbox_message',
  'Gửi tin đến khách đã inbox page trong Business Inbox, bám theo JS akaBizFacebook pageToMessage.',
  'Send',
  'facebook',
  'js',
  NULL,
$block$
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
$block$,
  '[
    {"name":"campaignContent","type":"textarea","label":"Nội dung"},
    {"name":"images","type":"json","label":"Ảnh"},
    {"name":"facebookStepMs","type":"number","label":"Step delay"}
  ]'::jsonb,
  '[
    {"name":"ok","type":"boolean","label":"OK"},
    {"name":"customerName","type":"string","label":"Tên khách"},
    {"name":"customerPsid","type":"string","label":"PSID"},
    {"name":"imageCount","type":"number","label":"Số ảnh"},
    {"name":"error","type":"string","label":"Lỗi"}
  ]'::jsonb,
  '{"facebookStepMs":1000}'::jsonb,
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
  WHERE name IN ('fb_page_inbox_open', 'fb_send_page_inbox_message')
)
INSERT INTO public.auto_workflows (
  name, description, nodes, edges, variables_schema, default_variables,
  is_builtin, staff_id, organization_id, updated_at
)
SELECT
  'facebook_page_to_message',
  'Workflow gửi tin nhắn đến khách từng inbox với page qua Business Inbox.',
  jsonb_build_array(
    jsonb_build_object(
      'id', 'open_page_inbox',
      'label', 'Mở inbox page',
      'config', '{}'::jsonb,
      'blockId', (SELECT id FROM block_ids WHERE name = 'fb_page_inbox_open'),
      'position', jsonb_build_object('x', 0, 'y', 0),
      'blockName', 'fb_page_inbox_open'
    ),
    jsonb_build_object(
      'id', 'send_message',
      'label', 'Gửi tin khách inbox page',
      'config', '{}'::jsonb,
      'blockId', (SELECT id FROM block_ids WHERE name = 'fb_send_page_inbox_message'),
      'position', jsonb_build_object('x', 0, 'y', 140),
      'blockName', 'fb_send_page_inbox_message'
    )
  ),
  '[
    {"id":"e-open-send","source":"open_page_inbox","target":"send_message"}
  ]'::jsonb,
  '[
    {"name":"pageInboxPageUid","type":"string","label":"Page ID"},
    {"name":"pageInboxPageName","type":"string","label":"Tên page"},
    {"name":"campaignContent","type":"string","label":"Nội dung"},
    {"name":"images","type":"array","label":"Ảnh"},
    {"name":"inputDataName","type":"string","label":"Tên khách"},
    {"name":"inputDataUid","type":"string","label":"PSID"}
  ]'::jsonb,
  '{"pageInboxUrl":"https://business.facebook.com/latest/inbox/all","facebookStepMs":1000}'::jsonb,
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

INSERT INTO public.auto_campaign_actions (
  id, name, flatform_type, is_active, workflow_id, limit_check_action_codes, is_delete, created_at
)
VALUES (
  'facebook_page_to_message',
  'Facebook - Gửi tin nhắn đến khách hàng từng inbox với page',
  'facebook',
  true,
  (SELECT id FROM public.auto_workflows WHERE name = 'facebook_page_to_message'),
  ARRAY['fb_message_page_inbox_customer']::text[],
  false,
  now()
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  flatform_type = EXCLUDED.flatform_type,
  is_active = true,
  workflow_id = EXCLUDED.workflow_id,
  limit_check_action_codes = EXCLUDED.limit_check_action_codes,
  is_delete = false;

NOTIFY pgrst, 'reload schema';

COMMIT;
