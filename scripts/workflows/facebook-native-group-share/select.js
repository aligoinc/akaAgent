signal.throwIfAborted();
const target = vars.groupShareTarget;
if (!target || !target.name || !Array.isArray(target.keys) || !target.keys.length) throw new Error('Thiếu định danh nhóm để chia sẻ');
const stepMs = Math.max(0, Number(vars.facebookStepMs) || 1000);
const scoped = (root, xpath) => xpath.split('|').map(part => root + part.trim()).join(' | ');
const shareXPath = scoped("//*[@role='dialog']", await helpers.element('fb_share_button_inner'));
const toGroupXPath = await helpers.element('fb_share_to_group_button');
const searchXPath = scoped("//*[@role='dialog']", await helpers.element('SearchAddGroupToPostInp'));
const resultsXPath = await helpers.element('fb_share_group_result');
const emptyXPath = await helpers.element('fb_share_group_search_empty');
async function clickUnique(xpath) {
  signal.throwIfAborted();
  await page.evaluate(`
    const rows = document.evaluate(__args[0], document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    if (rows.snapshotLength !== 1) throw new Error('Không xác định được duy nhất nút chia sẻ');
    rows.snapshotItem(0).click();
  `, xpath);
}
// Reuse rawClear/rawType from live fb_select_group_post_share_targets (2794).
// The prototype setter bypasses React's tracked instance value setter.
async function rawClear(xpath) {
  return await page.evaluate(`
    const xpath = String(__args[0] || '');
    function firstByXPath(value) {
      try {
        return document.evaluate(value, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
      } catch (e) {
        return null;
      }
    }
    const el = firstByXPath(xpath);
    if (!el) return { found: false, cleared: false };
    try { el.focus(); } catch (e) {}
    try {
      if (typeof el.select === 'function') el.select();
      else if (typeof el.setSelectionRange === 'function') el.setSelectionRange(0, String(el.value || '').length);
    } catch (e) {}
    try { document.execCommand('delete', false); } catch (e) {}
    if ('value' in el) {
      const proto = Object.getPrototypeOf(el);
      const desc = proto ? Object.getOwnPropertyDescriptor(proto, 'value') : null;
      if (desc && typeof desc.set === 'function') desc.set.call(el, '');
      else el.value = '';
    }
    try { el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward', data: null })); } catch (e) { el.dispatchEvent(new Event('input', { bubbles: true })); }
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return { found: true, cleared: true };
  `, xpath).catch(err => ({ found: false, cleared: false, message: err && err.message ? err.message : String(err) }));
}

async function rawType(xpath, text) {
  return await page.evaluate(`
    const xpath = String(__args[0] || '');
    const text = String(__args[1] || '');
    function firstByXPath(value) {
      try {
        return document.evaluate(value, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
      } catch (e) {
        return null;
      }
    }
    const el = firstByXPath(xpath);
    if (!el) return { found: false, typed: false };
    try { el.focus(); } catch (e) {}
    if ('value' in el) {
      const proto = Object.getPrototypeOf(el);
      const desc = proto ? Object.getOwnPropertyDescriptor(proto, 'value') : null;
      if (desc && typeof desc.set === 'function') desc.set.call(el, text);
      else el.value = text;
    } else {
      try { document.execCommand('insertText', false, text); } catch (e) {}
    }
    try { el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text })); } catch (e) { el.dispatchEvent(new Event('input', { bubbles: true })); }
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return { found: true, typed: true };
  `, xpath, text).catch(err => ({ found: false, typed: false, message: err && err.message ? err.message : String(err) }));
}
await page.navigate(vars.groupShareSourceUrl);
await helpers.sleep(stepMs + 2000, signal);
await page.waitForSelector(shareXPath, { timeout: 10000 });
await clickUnique(shareXPath);
await helpers.sleep(stepMs + 2000, signal);
await page.waitForSelector(toGroupXPath, { timeout: 10000 });
await clickUnique(toGroupXPath);
await page.waitForSelector(searchXPath, { timeout: 10000 });
signal.throwIfAborted();
const cleared = await rawClear(searchXPath);
if (!cleared || cleared.cleared !== true) throw new Error('Không xóa được ô tìm kiếm nhóm');
await helpers.sleep(stepMs + 500, signal);
signal.throwIfAborted();
const typed = await rawType(searchXPath, target.name);
if (!typed || typed.typed !== true) throw new Error('Không nhập được tên nhóm để chia sẻ');
// Let the initial suggestions be replaced before reading any search result.
await helpers.sleep(10000, signal);
signal.throwIfAborted();
const state = await page.evaluate(`
    const [searchXPath, resultXPath, emptyXPath, targetName, targetKeys] = __args;
    const all = (xpath, root = document) => {
      const rows = document.evaluate(xpath, root, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      return Array.from({ length: rows.snapshotLength }, (_, i) => rows.snapshotItem(i));
    };
    const searches = all(searchXPath);
    if (searches.length !== 1) throw new Error('Hộp tìm nhóm không còn sẵn sàng');
    const search = searches[0], dialog = search.closest('[role="dialog"]');
    if (!dialog) throw new Error('Không tìm thấy hộp chọn nhóm');
    if (search.value !== targetName) throw new Error('Tên tìm kiếm nhóm đã thay đổi');
    const results = all(resultXPath).filter(el => dialog.contains(el));
    const matches = results.filter(el => {
      try {
        const [, prefix, value = ''] = new URL(el.href).pathname.split('/');
        return prefix.toLowerCase() === 'groups' && targetKeys.includes(decodeURIComponent(value).toLowerCase());
      } catch { return false; }
    });
    if (matches.length > 1) throw new Error('Có nhiều kết quả cùng định danh nhóm');
    if (matches.length === 1) {
      const button = matches[0].closest('[role="button"]');
      if (!button || !dialog.contains(button)) throw new Error('Không tìm thấy nút chọn nhóm');
      // Keep identity validation and click in this one synchronous DOM task.
      button.click();
      return { selected: true };
    }
    return { selected: false, empty: all(emptyXPath).some(el => dialog.contains(el)), hasResults: results.length > 0 };
  `, searchXPath, resultsXPath, emptyXPath, target.name, target.keys);
signal.throwIfAborted();
if (state.selected) {
  await helpers.sleep(stepMs + 2000, signal);
  vars.groupShareSelected = true;
  return { selected: true, groupName: target.name };
}
if (!state.empty && !state.hasResults) {
  throw new Error('Hết thời gian chờ kết quả tìm kiếm nhóm để chia sẻ');
}
// This message is the sole wording source for history and input-data note.
const message = 'Không tìm thấy nhóm để chia sẻ, chưa tham gia nhóm';
await page.navigate(target.url);
signal.throwIfAborted();
return { selected: false, actionResult: { actionCode: 'fb_post_group',
  statusCode: 'campaign_detail_skipped', operationState: 'not_committed', message,
  data: { shareMode: 'native_group_share', groupUrl: target.url, sourceUrl: vars.groupShareSourceUrl } } };
