-- Gỡ V563: trả bản "[engine] fb_collect_search_groups", "[engine] fb_comment_at_position" (kèm md5 đã duyệt của danh mục bước) và dòng
-- facebook.error_signs về bản trước V563, xoá chính sách FB11 khi đăng nhóm (V563). Chỉ chạy khi các thứ đó đang đúng bản V563 (đã ai sửa sau V563 thì
-- dừng, không ghi đè). Bộ cũ không đổi. SINH TỪ scripts/build-v563-sql.cjs.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = 2909 AND md5(code) = '499445e4406d2095c951b5c1c9aef03d') THEN
    RAISE EXCEPTION 'Gỡ V563: block 2909 không phải bản V563 (md5 499445e4406d2095c951b5c1c9aef03d), không ghi đè';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = 2851 AND md5(code) = '06889369d1c9f77ef62c846fa8e27e82') THEN
    RAISE EXCEPTION 'Gỡ V563: block 2851 không phải bản V563 (md5 06889369d1c9f77ef62c846fa8e27e82), không ghi đè';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = 2874 AND md5(code) = 'f7c07500e06511bee20f1c409c185211') THEN
    RAISE EXCEPTION 'Gỡ V563: block 2874 không phải bản V563 (md5 f7c07500e06511bee20f1c409c185211), không ghi đè';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_system_settings WHERE key = 'facebook.error_signs' AND md5(value) = '7e25dd65faab148bcf55b93654852a16') THEN
    RAISE EXCEPTION 'Gỡ V563: dòng facebook.error_signs không phải bản V563, không ghi đè';
  END IF;
END $pre$;

UPDATE public.auto_blocks SET code = $v563_search$
  if (!vars.findDataSearchHasGroup) { vars.findDataSearchGroups = []; return { facebookGroups: [] }; }

  const limit = Math.max(1, Number(vars.countSearchGroupFindData || 20));
  const minMembers = Math.max(0, Number(vars.minSearchGroupMembers || 0));
  const minPostsPerDay = Math.max(0, Number(vars.minSearchGroupPostsPerDay || 0));
  const keyword = String(vars.findDataSearchKeyword || '').trim();
  const groupResult = await page.evaluate(String.raw`
    const limit = __args[0]; const minMembers = __args[1]; const minPostsPerDay = __args[2]; const keyword = __args[3];
    function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
    function norm(text) { return String(text || '').replace(/\s+/g, ' ').trim(); }
    function isVisible(el) { if (!el) return false; const style = window.getComputedStyle(el); if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false; const rect = el.getBoundingClientRect(); return rect.width > 0 && rect.height > 0; }
    function parseNumber(text) { const raw = String(text || '').trim(); if (!raw) return 0; const suffixMatch = raw.match(/(k|n|m|tr|triệu|nghìn)$/i); const suffix = suffixMatch ? suffixMatch[1].toLowerCase() : ''; const numberText = raw.replace(/(k|n|m|tr|triệu|nghìn)$/i, '').trim(); let normalized = numberText; if (normalized.includes(',') && !normalized.includes('.')) normalized = normalized.replace(',', '.'); normalized = normalized.replace(/\.(?=\d{3}(\D|$))/g, '').replace(/,/g, '.'); const value = Number(normalized); if (!Number.isFinite(value)) return 0; const multiplier = suffix === 'k' || suffix === 'n' || suffix === 'nghìn' ? 1000 : suffix === 'm' || suffix === 'tr' || suffix === 'triệu' ? 1000000 : 1; return Math.round(value * multiplier); }
    function normalizeGroupUrl(href) { if (!href) return ''; try { const url = new URL(href, location.href); const parts = url.pathname.split('/').filter(Boolean); const groupIndex = parts.findIndex(part => part.toLowerCase() === 'groups'); const groupKey = groupIndex >= 0 ? parts[groupIndex + 1] : ''; if (!groupKey || groupKey === 'feed' || groupKey === 'discover') return ''; return 'https://www.facebook.com/groups/' + groupKey + '/'; } catch { return ''; } }
    function parseGroupCard(link) { const url = normalizeGroupUrl(link.href || link.getAttribute('href') || ''); if (!url) return null; let card = link; for (let depth = 0; depth < 8 && card && card.parentElement; depth++) { const text = norm(card.innerText || card.textContent || ''); if (text.includes('thành viên') || text.includes('members') || text.includes('bài viết/ngày') || text.includes('posts/day')) break; card = card.parentElement; } const text = norm(card.innerText || card.textContent || link.innerText || link.textContent || ''); if (!text || (!text.includes('thành viên') && !text.includes('members'))) return null; let name = norm(link.innerText || link.textContent || link.getAttribute('aria-label') || '').replace(/^Ảnh đại diện của\s+/i, ''); if (!name) { const nameMatch = text.match(/^(.*?)(?:\s+(?:Công khai|Riêng tư|Public|Private)\s*·|\s+[\d.,]+\s*(?:K|N|M|Tr|triệu|nghìn)?\s*(?:thành viên|members))/i); name = norm(nameMatch ? nameMatch[1] : ''); } const memberMatch = text.match(/([\d.,]+\s*(?:K|N|M|Tr|triệu|nghìn)?)\s*thành viên/i) || text.match(/([\d.,]+\s*(?:K|M)?)\s*members/i); const postMatch = text.match(/([\d.,]+)\+?\s*bài viết\/ngày/i) || text.match(/([\d.,]+)\+?\s*posts\/day/i); const privacy = text.includes('Công khai') || text.includes('Public') ? 'Công khai' : text.includes('Riêng tư') || text.includes('Private') ? 'Riêng tư' : ''; return { url, name, privacy, memberCount: memberMatch ? parseNumber(memberMatch[1]) : 0, postsPerDay: postMatch ? parseNumber(postMatch[1]) : 0, keyword, rawText: text }; }
    function getSkipReasons(group) { const reasons = []; if (minMembers > 0 && group.memberCount < minMembers) reasons.push('Không đạt số thành viên tối thiểu'); if (minPostsPerDay > 0 && group.postsPerDay < minPostsPerDay) reasons.push('Không đạt số bài/ngày tối thiểu'); return reasons; }
    function collect() { const main = document.querySelector('[role="main"]') || document.body; const links = Array.from(main.querySelectorAll('a[href*="/groups/"]')).filter(isVisible); const map = new Map(); for (const link of links) { const group = parseGroupCard(link); if (!group) continue; const key = group.url.replace(/\/+$/g, '').toLowerCase(); if (!key || map.has(key)) continue; const skipReasons = getSkipReasons(group); group.skipReasons = skipReasons; group.skipReason = skipReasons.join('; '); group.accepted = skipReasons.length === 0; map.set(key, group); } return Array.from(map.values()).map((group, index) => Object.assign({}, group, { scanIndex: index + 1 })); }
    function acceptedCount(rows) { return rows.filter(group => group && group.accepted === true).length; }
    let rows = collect(); const startedAt = Date.now(); let stableCount = 0; while (acceptedCount(rows) < limit && Date.now() - startedAt < 180000 && stableCount < 3) { const before = rows.length; window.scrollBy(0, Math.max(700, Math.floor((window.innerHeight || 800) * 0.9))); await delay(2200); rows = collect(); stableCount = rows.length <= before ? stableCount + 1 : 0; }
    const acceptedRows = []; const skippedRows = [];
    for (const group of rows) { if (group.accepted === true) { if (acceptedRows.length < limit) acceptedRows.push(Object.assign({}, group, { acceptedIndex: acceptedRows.length + 1 })); } else { skippedRows.push(group); } }
    return { acceptedRows, skippedRows, scannedCount: rows.length };
  `, limit, minMembers, minPostsPerDay, keyword);

  const acceptedGroups = groupResult && Array.isArray(groupResult.acceptedRows) ? groupResult.acceptedRows : [];
  const skippedGroups = groupResult && Array.isArray(groupResult.skippedRows) ? groupResult.skippedRows : [];
  const scannedCount = Math.max(acceptedGroups.length + skippedGroups.length, Number(groupResult && groupResult.scannedCount ? groupResult.scannedCount : 0));
  vars.findDataSearchGroups = acceptedGroups;
  if (!vars.findDataResults || typeof vars.findDataResults !== 'object') vars.findDataResults = {};
  if (!Array.isArray(vars.findDataResults.facebookGroups)) vars.findDataResults.facebookGroups = [];
  if (!vars.findDataResults.sourceData || typeof vars.findDataResults.sourceData !== 'object') vars.findDataResults.sourceData = {};
  if (!vars.findDataResults.sourceData.facebookGroups || typeof vars.findDataResults.sourceData.facebookGroups !== 'object') vars.findDataResults.sourceData.facebookGroups = {};
  if (!Array.isArray(vars.findDataResults.sourceData.facebookGroups.groups)) vars.findDataResults.sourceData.facebookGroups.groups = [];
  vars.findDataResults.facebookGroups.push(...vars.findDataSearchGroups);
  vars.findDataResults.sourceData.facebookGroups.groups.push(...vars.findDataSearchGroups.map(group => group.url));
  helpers.log('Đã tải ' + vars.findDataSearchGroups.length + ' group Facebook từ search');
  await helpers.logRunEvent({ eventType: 'scroll_search_groups', eventName: 'Cuộn search group Facebook', targetType: 'group', status: 'success', isUserVisible: false, elementCount: scannedCount, message: 'Đã cuộn search để tải group Facebook', debugData: { limit, minMembers, minPostsPerDay, scannedCount, acceptedCount: acceptedGroups.length, skippedCount: skippedGroups.length, searchKeyword: keyword } });
  await helpers.logRunEvent({ eventType: 'collect_facebook_groups', eventName: 'Lấy danh sách group Facebook', targetType: 'group', status: 'success', isUserVisible: true, elementCount: acceptedGroups.length, message: 'Lấy được ' + acceptedGroups.length + ' group Facebook đạt điều kiện từ ' + scannedCount + ' group đã quét', debugData: { limit, minMembers, minPostsPerDay, scannedCount, acceptedCount: acceptedGroups.length, skippedCount: skippedGroups.length, searchKeyword: keyword } });

  function groupContentText(group) { return [group.privacy, group.memberCount ? group.memberCount + ' thành viên' : '', group.postsPerDay ? group.postsPerDay + ' bài viết/ngày' : ''].filter(Boolean).join(' - '); }
  function groupExtractedData(group) { return { entity: { type: 'group', url: String(group.url || ''), name: String(group.name || '') || null, uid: null, contentText: groupContentText(group) }, filters: { keywordEnabled: false, keyword: null, matchedKeyword: null, aiPrompt: null, aiFinalPrompt: '', aiRawResult: '', aiCheckResult: '', aiMatched: null, aiReason: null, aiResult: null }, values: { phones: [], zaloGroupLinks: [], postLinks: [], facebookGroups: [String(group.url || '')] } }; }
  function groupDebugData(group, extra) { return Object.assign({ privacy: group.privacy || '', memberCount: Number(group.memberCount || 0), postsPerDay: Number(group.postsPerDay || 0), searchKeyword: keyword, rawText: group.rawText || '', minMembers, minPostsPerDay, scanIndex: Number(group.scanIndex || 0) }, extra || {}); }

  const groupEvents = [];
  for (const group of acceptedGroups) {
    groupEvents.push({ eventType: 'extract_facebook_group_data', eventName: 'Lấy thông tin group Facebook', targetType: 'group', status: 'success', isUserVisible: true, itemIndex: Number(group.scanIndex || group.acceptedIndex || 0) || null, targetUrl: group.url, message: 'Đã duyệt group Facebook #' + (group.scanIndex || group.acceptedIndex || ''), extractedData: groupExtractedData(group), debugData: groupDebugData(group, { acceptedIndex: Number(group.acceptedIndex || 0) }) });
  }
  for (const group of skippedGroups) {
    const reason = String(group.skipReason || 'Không đạt điều kiện lọc group');
    groupEvents.push({ eventType: 'extract_facebook_group_data', eventName: 'Lấy thông tin group Facebook', targetType: 'group', status: 'skipped', isUserVisible: true, itemIndex: Number(group.scanIndex || 0) || null, targetUrl: group.url, message: 'Bỏ qua group Facebook #' + (group.scanIndex || '') + ': ' + reason, extractedData: groupExtractedData(group), debugData: groupDebugData(group, { skipReason: reason, skipReasons: Array.isArray(group.skipReasons) ? group.skipReasons : [] }) });
  }
  groupEvents.sort((a, b) => Number(a.itemIndex || 0) - Number(b.itemIndex || 0));
  await helpers.logRunEvents(groupEvents);
  return { facebookGroups: vars.findDataSearchGroups, skippedGroups };
$v563_search$, updated_at = now()
 WHERE id = 2909 AND md5(code) = '499445e4406d2095c951b5c1c9aef03d';


UPDATE public.auto_blocks SET code = $v563_comment$// Read only after comment submit/settle and the existing frequency-limit check.
// Missing links do not retry the comment or change its successful result.
async function getFirstCommentUrl() {
  try {
    const selector = await helpers.element('fb_comment_permalink')
    return await page.evaluate(`
      const link = document.evaluate(__args[0], document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
      const raw = link ? String(link.href || link.getAttribute('href') || '').trim() : '';
      if (!raw) return '';
      try {
        const url = new URL(raw, 'https://www.facebook.com');
        // Keep comment/reply and post routing parameters; remove tracking only.
        for (const key of Array.from(url.searchParams.keys())) {
          if (key.startsWith('__') || key.startsWith('utm_') ||
              ['fbclid', 'mibextid', 'ref', 'refid', 'refsrc', 'locale'].includes(key)) {
            url.searchParams.delete(key);
          }
        }
        return url.toString();
      } catch {
        return raw;
      }
    `, selector)
  } catch (error) {
    if (signal.aborted) throw error
    return ''
  }
}

// Centralized AI rewrite via ai_using.
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

const commentFrequencyLimitMessage = 'Facebook báo giới hạn tần suất comment'
const shouldRewriteCommentContentEachRun = vars.rewriteCommentContentEachRun === true

async function hasVisibleElement(selector) {
  return await page.evaluate(`
    const selector = __args[0];

    function isVisible(el) {
      if (!el) return false;
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
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

    return xpathAll(selector).some(isVisible);
  `, selector);
}

async function throwIfCommentFrequencyLimited() {
  const frequencyLimitError = await helpers.element('GroupPostFrequencyLimitError');
  const hasFrequencyLimitError = await hasVisibleElement(frequencyLimitError);
  if (hasFrequencyLimitError) {
    helpers.log(commentFrequencyLimitMessage);
    throw new Error(commentFrequencyLimitMessage);
  }
}

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
let text
let images
if (typeof helpers.prepareCampaignContent === 'function') {
  const prepared = await helpers.prepareCampaignContent({ kind: 'comment', rewriteCode: __aiRewriteUsingCode })
  text = prepared.content.replace(/\t/g, '      ')
  images = prepared.media.slice(0, 1)
  vars.contentVariantIndex = prepared.variantIndex
} else {
text = String(input.text || item.text || '')
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
images = rawImages.map(x => String(x || '').trim()).filter(Boolean).slice(0, 1)
}

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
    // Append a real space after paste so the final word no longer ends at the caret.
    await page.type(inputXpath, ' ')
    await helpers.sleep(500, signal)
  }

  if (images.length > 0) {
    const dropResult = await page.dropFile(inputXpath, images)
    imageCount = Number(dropResult.fileCount || 0)
    await helpers.sleep(10000, signal)
    if (!text && imageCount <= 0) {
      return { commented: false, position: pos, text: '', imageCount: 0 }
    }
  }

  await page.press('Enter')
  await helpers.sleep(10000, signal)
  await throwIfCommentFrequencyLimited()
  const commentUrl = await getFirstCommentUrl()
  const logSuffix = text ? ': ' + text.substring(0, 50) : ''
  helpers.log('💬 Đã comment vào bài #' + pos + logSuffix)
  return { commented: true, commentUrl, position: pos, text: text, imageCount: imageCount, rewrittenContent: shouldRewriteCommentContentEachRun }
} catch (e) {
  const message = e && e.message ? String(e.message) : String(e)
  if (message.includes(commentFrequencyLimitMessage)) throw e
  try {
    await page.press('Escape')
    await helpers.sleep(500, signal)
  } catch {}
  helpers.log('⚠️ Không comment được bài #' + pos + ': ' + message)
  return {
    commented: false,
    commentFailed: true,
    position: pos,
    text: text,
    imageCount: imageCount,
    error: message,
    rewrittenContent: shouldRewriteCommentContentEachRun
  }
}
$v563_comment$, updated_at = now()
 WHERE id = 2851 AND md5(code) = '06889369d1c9f77ef62c846fa8e27e82';
UPDATE public.auto_engine_block_steps SET reviewed_code_md5 = '30126bae87ff755164c80dbffda9d263', updated_at = now()
 WHERE id = 6 AND block_id = 2851 AND reviewed_code_md5 = '06889369d1c9f77ef62c846fa8e27e82';

UPDATE public.auto_blocks SET code = $v563_adjust$
const originalIterations = Array.isArray(vars.commentIterations) ? vars.commentIterations : [];
const enableComment = vars.enableComment === true;
const isPending = vars.groupPostIsPending === true;
const rawCommentType = String(vars.commentType || 'own');
const commentType = ['own', 'others', 'all'].includes(rawCommentType) ? rawCommentType : 'own';
const rawGroupMode = String(vars.commentGroupMode || 'all');
const commentGroupMode = ['all', 'pending_only', 'published_only'].includes(rawGroupMode) ? rawGroupMode : 'all';

let commentIterations = originalIterations;
let adjusted = false;
let skippedOwnPending = false;
let skippedByGroupMode = false;
let skipReason = '';

if (enableComment) {
  if (commentGroupMode === 'pending_only' && !isPending) {
    commentIterations = [];
    adjusted = true;
    skippedByGroupMode = true;
    skipReason = 'Bỏ qua comment vì chỉ chọn comment group bị duyệt đăng bài';
    helpers.log(skipReason);
  } else if (commentGroupMode === 'published_only' && isPending) {
    commentIterations = [];
    adjusted = true;
    skippedByGroupMode = true;
    skipReason = 'Bỏ qua comment vì chỉ chọn comment group đăng bài thành công ngay';
    helpers.log(skipReason);
  } else if (isPending && commentType === 'own') {
    commentIterations = [];
    adjusted = true;
    skippedOwnPending = true;
    helpers.log('Bài đang chờ duyệt nên bỏ qua comment vào bài của mình');
  } else if (isPending && commentType === 'others') {
    commentIterations = originalIterations.map((item, index) => {
      const row = item && typeof item === 'object' ? item : {};
      const currentPosition = Number(row.position || index + 2);
      return {
        ...row,
        position: Math.max(1, currentPosition - 1)
      };
    });
    adjusted = true;
    helpers.log('Bài đang chờ duyệt nên comment bài khác bắt đầu từ bài đầu tiên');
  }
}

vars.commentIterations = commentIterations;

return {
  adjusted,
  skippedOwnPending,
  skippedByGroupMode,
  skipReason,
  commentGroupMode,
  commentType,
  isPending,
  commentIterations
};
$v563_adjust$, updated_at = now()
 WHERE id = 2874 AND md5(code) = 'f7c07500e06511bee20f1c409c185211';

UPDATE public.auto_system_settings SET value = '[{"code":"err_fb_page_inbox_customer_not_found","source":"message","actions":["fb_message_page_inbox_customer"],"phases":[],"replaces":[],"texts":["Không tìm thấy khách hàng trong inbox page"]},{"code":"err_fb_page_inbox_wrong_conversation","source":"message","actions":["fb_message_page_inbox_customer"],"phases":[],"replaces":[],"texts":["Không tìm thấy đúng khách hàng trong inbox page"]},{"code":"err_fb_upload_form_changed","source":"message","actions":[],"phases":["before_send"],"replaces":[],"texts":["Cần đúng 1 input file trong form đăng bài, tìm thấy 0","Input trong form không nhận ảnh/video"]},{"code":"err_fb_group_cannot_post_unavailable","source":"page","actions":["fb_post_group"],"phases":[],"replaces":["err_fb_group_composer_editor_not_found"],"texts":["Bạn hiện không xem được nội dung này","This content isn''t available right now"]}]', updated_at = now()
 WHERE key = 'facebook.error_signs' AND md5(value) = '7e25dd65faab148bcf55b93654852a16';
DELETE FROM public.auto_outcome_policies WHERE source = 'v563_fb_signs' AND error_code = 'err_fb_group_cannot_post_not_member' AND action_code = 'fb_post_group';

DO $post$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = 2909 AND md5(code) = '91e809e62911aea2c2391ae14676dc3b') THEN
    RAISE EXCEPTION 'Gỡ V563 postflight: block 2909 chưa về bản trước V563';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_engine_block_steps WHERE block_id = 2909 AND reviewed_code_md5 IS DISTINCT FROM '91e809e62911aea2c2391ae14676dc3b') THEN
    RAISE EXCEPTION 'Gỡ V563 postflight: danh mục bước của block 2909 chưa về md5 cũ';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = 2851 AND md5(code) = '30126bae87ff755164c80dbffda9d263') THEN
    RAISE EXCEPTION 'Gỡ V563 postflight: block 2851 chưa về bản trước V563';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_engine_block_steps WHERE block_id = 2851 AND reviewed_code_md5 IS DISTINCT FROM '30126bae87ff755164c80dbffda9d263') THEN
    RAISE EXCEPTION 'Gỡ V563 postflight: danh mục bước của block 2851 chưa về md5 cũ';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = 2874 AND md5(code) = 'ffeb17c8967ab564098da8f641650674') THEN
    RAISE EXCEPTION 'Gỡ V563 postflight: block 2874 chưa về bản trước V563';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_engine_block_steps WHERE block_id = 2874 AND reviewed_code_md5 IS DISTINCT FROM 'ffeb17c8967ab564098da8f641650674') THEN
    RAISE EXCEPTION 'Gỡ V563 postflight: danh mục bước của block 2874 chưa về md5 cũ';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_system_settings WHERE key = 'facebook.error_signs' AND md5(value) = '9eae00aad9c77a7b1e248f3a52ba73c0') THEN
    RAISE EXCEPTION 'Gỡ V563 postflight: dòng facebook.error_signs chưa về bản V559';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_outcome_policies WHERE source = 'v563_fb_signs') THEN
    RAISE EXCEPTION 'Gỡ V563 postflight: còn chính sách của V563';
  END IF;
END $post$;

COMMIT;
