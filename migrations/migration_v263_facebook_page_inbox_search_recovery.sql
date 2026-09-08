-- Recover Page Inbox search state between customers, including early exits.
-- Source: linked production cgjbsmqtfhqvttudyjzq, block 2679, captured 2026-09-08.
-- Keep centralized AI, exact-name guard, message/media delivery and composer delay.
-- Only auto-reload during pre-send search preparation; never retry message sending.
BEGIN;

DO $migration$
DECLARE
  v_live_code text;
  v_live_row_md5 text;
  v_target_code text := $block_code$// Centralized AI rewrite via ai_using.
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

    function firstVisible(selector) {
      return all(selector).find(el => {
        if (!el.isConnected || typeof el.getClientRects !== 'function' || el.getClientRects().length === 0) return false;
        const win = (el.ownerDocument && el.ownerDocument.defaultView) || window;
        const style = win.getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden';
      }) || null;
    }

    if (action === 'searchState') {
      const el = firstVisible(payload.inputSelector);
      return {
        inputFound: !!el,
        value: el ? String(el.value || '') : '',
        clearFound: !!firstVisible(payload.clearSelector),
        buttonFound: !!firstVisible(payload.buttonSelector)
      };
    }

    if (action === 'clearSearch') {
      const clear = firstVisible(payload.clearSelector);
      if (clear) return { ok: clickSynthetic(clear) };
      const el = firstVisible(payload.inputSelector);
      return { ok: el ? setText(el, '') : false };
    }

    if (action === 'openSearch') {
      if (firstVisible(payload.inputSelector)) return { ok: true };
      return { ok: clickSynthetic(firstVisible(payload.buttonSelector)) };
    }

    if (action === 'searchTextMatches') {
      const el = firstVisible(payload.selector);
      return { ok: !!el && String(el.value || '') === stripEmoji(payload.text || '') };
    }

    if (action === 'setSearchText') {
      const el = firstVisible(payload.selector);
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

const searchSelectors = {
  inputSelector: searchInputXpath,
  clearSelector: searchClearXpath,
  buttonSelector: searchButtonXpath
}

function throwIfCancelled() {
  if (signal && signal.aborted) throw new Error('Aborted')
}

async function waitForSearchState(predicate) {
  for (let attempt = 0; attempt < 13; attempt++) {
    throwIfCancelled()
    const state = await dom('searchState', searchSelectors)
    if (state && predicate(state)) return true
    if (attempt < 12) await helpers.sleep(250, signal)
  }
  return false
}

async function clearInboxSearch() {
  const isClear = state => !state.clearFound && (
    state.inputFound ? state.value === '' : state.buttonFound
  )
  const state = await dom('searchState', searchSelectors)
  if (state && isClear(state)) return true
  for (let attempt = 0; attempt < 2; attempt++) {
    throwIfCancelled()
    await dom('clearSearch', searchSelectors)
    if (await waitForSearchState(isClear)) return true
  }
  return false
}

async function prepareInboxSearch() {
  for (let attempt = 0; attempt < 2; attempt++) {
    throwIfCancelled()
    try {
      if (await clearInboxSearch()) {
        await dom('openSearch', searchSelectors)
        if (await waitForSearchState(state => state.inputFound && state.value === '' && !state.clearFound)) return
      }
    } catch (error) {
      throwIfCancelled()
      if (attempt > 0) throw error
    }
    if (attempt === 0) {
      const pageUid = String(vars.pageInboxPageUid || input.pageInboxPageUid || '').trim()
      if (!/^\d+$/.test(pageUid)) throw new Error('Thiếu Page ID hợp lệ để khôi phục Business Inbox')
      const inboxBaseUrl = String(vars.pageInboxUrl || input.pageInboxUrl || 'https://business.facebook.com/latest/inbox/all').trim()
      helpers.log('Tìm kiếm inbox page đang kẹt; đang tải lại hộp thư')
      throwIfCancelled()
      await page.navigate(inboxBaseUrl + '?asset_id=' + encodeURIComponent(pageUid))
      await helpers.sleep(stepMs + 5000, signal)
    }
  }
  throw new Error('Lỗi khi nhập tên vào ô tìm kiếm: không thể khôi phục ô tìm kiếm trống')
}

let searchNeedsCleanup = true
try {
  helpers.log('Đang tìm khách trong inbox page: ' + customerName)
  await prepareInboxSearch()

  const searched = await dom('setSearchText', { selector: searchInputXpath, text: customerName })
  if (!searched || searched.found !== true) {
    throw new Error('Lỗi khi nhập tên vào ô tìm kiếm')
  }
  await helpers.sleep(stepMs + 3000, signal)
  const searchText = await dom('searchTextMatches', { selector: searchInputXpath, text: customerName })
  if (!searchText || searchText.ok !== true) {
    throw new Error('Lỗi khi nhập tên vào ô tìm kiếm: tên tìm kiếm chưa khớp khách hiện tại')
  }

  const searchResult = await dom('clickExactSearchResult', { selector: searchResultXpath, name: customerName })
  if (!searchResult || searchResult.found !== true) {
    return { error: 'Không tìm thấy khách hàng trong inbox page', reason: 'not_found', customerName, customerPsid }
  }
  await helpers.sleep(3000, signal)

  await dom('clickFirst', { selector: conversationResultXpath }).catch(() => null)
  await helpers.sleep(3000, signal)

  await dom('clickFirst', { selector: closeButtonXpath }).catch(() => null)
  await helpers.sleep(2000, signal)

  if (!(await clearInboxSearch())) {
    throw new Error('Không thể xoá tìm kiếm trong inbox page trước khi gửi tin nhắn')
  }
  searchNeedsCleanup = false
  await helpers.sleep(stepMs + 4000, signal)

  const headerName = await dom('readText', { selector: headerNameXpath })
  if (headerName && headerName.text && !isSameInboxName(headerName.text, customerName)) {
    await helpers.sleep(stepMs + 1000, signal)
    const recheckedHeaderName = await dom('readText', { selector: headerNameXpath })
    if (recheckedHeaderName && recheckedHeaderName.text && !isSameInboxName(recheckedHeaderName.text, customerName)) {
      return {
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
} finally {
  if (searchNeedsCleanup && !(signal && signal.aborted)) {
    try {
      if (!(await clearInboxSearch())) {
        helpers.log('Chưa xoá được tìm kiếm inbox page; sẽ khôi phục trước lượt tiếp theo')
      }
    } catch (error) {
      if (!(signal && signal.aborted)) helpers.log('Chưa xoá được tìm kiếm inbox page; sẽ khôi phục trước lượt tiếp theo')
    }
  }
}
$block_code$;
BEGIN
  SELECT block.code, md5(row_to_json(block)::text)
  INTO v_live_code, v_live_row_md5
  FROM public.auto_blocks AS block
  WHERE block.id = 2679
    AND block.name = 'fb_send_page_inbox_message'
    AND block.is_builtin = true
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Expected built-in Page Inbox send block 2679 was not found';
  END IF;
  IF md5(v_target_code) <> '309936df4519c0a86065a363c7105566' THEN
    RAISE EXCEPTION 'Page Inbox target code checksum mismatch';
  END IF;
  IF v_live_code = v_target_code THEN
    RETURN;
  END IF;
  IF md5(v_live_code) <> 'f4250a395c0d040163d7a37fe7528111'
     OR v_live_row_md5 <> '3ec10381a15ef5e2b560e0fbce547a2a' THEN
    RAISE EXCEPTION 'Page Inbox block changed since capture; inspect live row before applying';
  END IF;

  UPDATE public.auto_blocks
  SET code = v_target_code, updated_at = now()
  WHERE id = 2679;
END;
$migration$;

COMMIT;
