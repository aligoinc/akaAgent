-- V563: engine v2 Facebook, sửa riêng phần engine (bộ cũ không đổi): bản "[engine] fb_collect_search_groups" đọc số bài/ngày + tên nhóm
-- giao diện tiếng Anh; bản "[engine] fb_comment_at_position" chỉ comment "bài của mình" khi thấy đúng bài vừa đăng (không comment nhầm bài người
-- khác); bản "[engine] fb_adjust_group_post_comments_after_pending" bỏ lượt comment "bài của mình" khi chưa lấy được link bài vừa đăng và báo
-- khách một câu ⚠️; dấu hiệu FB11 "Tham gia nhóm" khi đăng nhóm không thấy ô đăng bài (chính sách = FB40, chỉ đổi câu).
-- SINH TỪ scripts/build-v563-sql.cjs (nguồn guard: scripts/fixtures/engine-v2-facebook/v563-live-20261117.json), không sửa tay.
-- Rà soát và số liệu: docs/ENGINE_V2_FACEBOOK_ERROR_REVIEW_20261117.md. Chỉ dữ liệu, không DDL (không nạp lại schema PostgREST).
-- Bộ cũ không nạp block "[engine]" và không đọc facebook.error_signs. Desktop đọc lại block / dấu hiệu / danh mục ở lần nạp danh mục kế tiếp.
-- Gỡ: rollback_v563_engine_facebook_signs_search.sql.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
DECLARE v_n integer;
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v563_%') THEN
      RAISE EXCEPTION 'V563 đã có trong sổ migration, không chạy lại';
    END IF;
  END IF;
  IF to_regclass('public.auto_engine_block_copies') IS NULL OR to_regprocedure('public.aka_agent_engine_resolve_policy(text, bigint, text, text, text, text)') IS NULL THEN
    RAISE EXCEPTION 'V563 cần V556–V560 (sổ chép block, hàm chọn chính sách engine)';
  END IF;
  -- Block: đúng bản engine đã đọc, là bản chép trong sổ; danh mục bước đúng bản đã đọc.
  SELECT count(*) INTO v_n FROM public.auto_blocks b JOIN public.auto_engine_block_copies c ON c.engine_block_id = b.id
   WHERE b.id = 2909 AND b.name = '[engine] fb_collect_search_groups' AND md5(b.code) = '91e809e62911aea2c2391ae14676dc3b';
  IF v_n <> 1 THEN RAISE EXCEPTION 'V563: block % (%) không còn đúng bản đã đọc (md5 91e809e62911aea2c2391ae14676dc3b), đọc lại và sinh lại', 2909, '[engine] fb_collect_search_groups'; END IF;
  SELECT count(*) INTO v_n FROM public.auto_engine_block_steps WHERE block_id = 2909;
  IF v_n <> 0 THEN RAISE EXCEPTION 'V563: block 2909 có % dòng danh mục bước, cần 0', v_n; END IF;

  SELECT count(*) INTO v_n FROM public.auto_blocks b JOIN public.auto_engine_block_copies c ON c.engine_block_id = b.id
   WHERE b.id = 2851 AND b.name = '[engine] fb_comment_at_position' AND md5(b.code) = '30126bae87ff755164c80dbffda9d263';
  IF v_n <> 1 THEN RAISE EXCEPTION 'V563: block % (%) không còn đúng bản đã đọc (md5 30126bae87ff755164c80dbffda9d263), đọc lại và sinh lại', 2851, '[engine] fb_comment_at_position'; END IF;
  SELECT count(*) INTO v_n FROM public.auto_engine_block_steps WHERE block_id = 2851;
  IF v_n <> 1 THEN RAISE EXCEPTION 'V563: block 2851 có % dòng danh mục bước, cần 1', v_n; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_engine_block_steps WHERE id = 6 AND block_id = 2851 AND commit_level = 2
                   AND send_ops = '["press:Enter"]'::jsonb AND reviewed_code_md5 = '30126bae87ff755164c80dbffda9d263') THEN
    RAISE EXCEPTION 'V563: dòng danh mục bước 6 của block 2851 khác bản đã đọc';
  END IF;
  SELECT count(*) INTO v_n FROM public.auto_blocks b JOIN public.auto_engine_block_copies c ON c.engine_block_id = b.id
   WHERE b.id = 2874 AND b.name = '[engine] fb_adjust_group_post_comments_after_pending' AND md5(b.code) = 'ffeb17c8967ab564098da8f641650674';
  IF v_n <> 1 THEN RAISE EXCEPTION 'V563: block % (%) không còn đúng bản đã đọc (md5 ffeb17c8967ab564098da8f641650674), đọc lại và sinh lại', 2874, '[engine] fb_adjust_group_post_comments_after_pending'; END IF;
  SELECT count(*) INTO v_n FROM public.auto_engine_block_steps WHERE block_id = 2874;
  IF v_n <> 0 THEN RAISE EXCEPTION 'V563: block 2874 có % dòng danh mục bước, cần 0', v_n; END IF;

  -- Dòng dấu hiệu: đúng bản V559.
  IF NOT EXISTS (SELECT 1 FROM public.auto_system_settings WHERE key = 'facebook.error_signs' AND md5(value) = '9eae00aad9c77a7b1e248f3a52ba73c0') THEN
    RAISE EXCEPTION 'V563: dòng facebook.error_signs đã đổi so với bản đã đọc (md5 9eae00aad9c77a7b1e248f3a52ba73c0)';
  END IF;
  -- Chính sách: đúng một dòng FB40 chung (V559, bản đã đọc); chưa có dòng FB11 riêng cho đăng nhóm; câu FB11 là câu anh duyệt.
  SELECT count(*) INTO v_n FROM public.auto_outcome_policies p
   WHERE p.error_code = 'err_fb_group_composer_editor_not_found' AND p.action_code IS NULL AND p.campaign_action_id IS NULL AND p.runtime_target IS NULL AND p.is_active AND NOT p.is_delete
     AND md5(jsonb_strip_nulls(to_jsonb(p) - 'id' - 'created_at' - 'updated_at' - 'updated_by' - 'revision')::text) = '7ead85c5fa88a906d167ce52f46ecc03';
  IF v_n <> 1 THEN RAISE EXCEPTION 'V563: dòng chính sách FB40 chung không còn đúng bản đã đọc'; END IF;
  IF EXISTS (SELECT 1 FROM public.auto_outcome_policies WHERE error_code = 'err_fb_group_cannot_post_not_member' AND action_code = 'fb_post_group' AND NOT is_delete) THEN
    RAISE EXCEPTION 'V563: đã có chính sách FB11 cho đăng nhóm';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_error WHERE error_code = 'err_fb_group_cannot_post_not_member' AND public_code = 'FB11' AND is_active AND NOT is_delete
                   AND customer_title = 'Tài khoản chưa vào nhóm này nên chưa đăng bài được' AND customer_help IS NULL) THEN
    RAISE EXCEPTION 'V563: mã FB11 không bật hoặc câu cho khách không phải câu anh duyệt';
  END IF;
END $pre$;

-- 1–2. Bản engine của block tìm nhóm bằng search và block comment theo vị trí (bộ cũ: block 2723, 34, 2627 giữ nguyên);
-- danh mục bước của block comment ghi md5 bản đã duyệt mới (mức cam kết 2, gửi bằng Enter như cũ).
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
    function parseGroupCard(link) { const url = normalizeGroupUrl(link.href || link.getAttribute('href') || ''); if (!url) return null; let card = link; for (let depth = 0; depth < 8 && card && card.parentElement; depth++) { const text = norm(card.innerText || card.textContent || ''); if (text.includes('thành viên') || text.includes('members') || text.includes('bài viết/ngày') || text.includes('posts/day')) break; card = card.parentElement; } const text = norm(card.innerText || card.textContent || link.innerText || link.textContent || ''); if (!text || (!text.includes('thành viên') && !text.includes('members'))) return null; let name = norm(link.innerText || link.textContent || link.getAttribute('aria-label') || '').replace(/^(?:Profile photo of|Ảnh đại diện của)\s+/i, ''); if (!name) { const nameMatch = text.match(/^(.*?)(?:\s+(?:Công khai|Riêng tư|Public|Private)\s*·|\s+[\d.,]+\s*(?:K|N|M|Tr|triệu|nghìn)?\s*(?:thành viên|members))/i); name = norm(nameMatch ? nameMatch[1] : ''); } const memberMatch = text.match(/([\d.,]+\s*(?:K|N|M|Tr|triệu|nghìn)?)\s*thành viên/i) || text.match(/([\d.,]+\s*(?:K|M)?)\s*members/i); const postMatch = text.match(/([\d.,]+)\+?\s*bài viết\/ngày/i) || text.match(/([\d.,]+)\+?\s*posts\/day/i) || text.match(/([\d.,]+)\+?\s*posts?\s+(?:a|per)\s+day/i); const privacy = text.includes('Công khai') || text.includes('Public') ? 'Công khai' : text.includes('Riêng tư') || text.includes('Private') ? 'Riêng tư' : ''; return { url, name, privacy, memberCount: memberMatch ? parseNumber(memberMatch[1]) : 0, postsPerDay: postMatch ? parseNumber(postMatch[1]) : 0, keyword, rawText: text }; }
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
 WHERE id = 2909 AND md5(code) = '91e809e62911aea2c2391ae14676dc3b';


UPDATE public.auto_blocks SET code = $v563_comment$// [engine] V563 (rà lỗi Facebook 17/11/2026): đăng nhóm kèm comment chỉ comment "bài của mình" khi thấy đúng bài vừa đăng: mã bài trong
// link lấy sau khi đăng (vars.groupPostPostUrl) trùng mã bài trong khung chứa ô bình luận. Không thấy (chưa lấy được link, bài video chưa
// hiện, bài chờ duyệt) thì bỏ qua, không comment vào bài người khác (chưa lấy được link thì block chỉnh comment đã bỏ lượt này và báo khách
// trước vòng comment). Comment bài khác mà ô ở đúng vị trí lại thuộc bài vừa
// đăng thì lấy ô của bài kế tiếp. Chỉ trong workflow đăng nhóm (vars.groupPostSubmitted); comment seeding giữ như bộ cũ.
const __OWN_POST_SKIP_MESSAGE = 'Chưa thấy bài vừa đăng trên trang nhóm nên bỏ qua comment vào bài của mình'
function __commentPostIdOf(url) {
  const text = String(url || '')
  const match = text.match(/\/(?:posts|permalink)\/(\d+)/) || text.match(/[?&]story_fbid=(\d+)/)
  return match ? match[1] : ''
}
async function __resolveCommentTarget(position) {
  if (vars.groupPostSubmitted !== true) return { xpath: null }
  const kind = String(vars.commentType || 'own')
  const ownTarget = position === 1 && (kind === 'own' || (kind === 'all' && vars.groupPostIsPending !== true))
  const ownId = __commentPostIdOf(vars.groupPostPostUrl)
  if (!ownTarget && !ownId) return { xpath: null }
  if (ownTarget && !ownId) return { skip: true, message: __OWN_POST_SKIP_MESSAGE }
  const indexed = String(await helpers.elementWith('fb_comment_box_at_n', { n: 1 }))
  if (!/\[1\]\s*$/.test(indexed)) return ownTarget ? { skip: true, message: __OWN_POST_SKIP_MESSAGE } : { xpath: null }
  const union = indexed.replace(/\[1\]\s*$/, '')
  const token = 'aka_cmt_' + Date.now() + '_' + Math.random().toString(36).slice(2)
  const picked = await page.evaluate(String.raw`
    const unionXpath = __args[0]; const ownId = __args[1]; const token = __args[2]; const mode = __args[3]; const position = Number(__args[4]) || 1;
    function xpathAll(xpath) { const out = []; try { const r = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null); for (let i = 0; i < r.snapshotLength; i++) { const it = r.snapshotItem(i); if (it) out.push(it); } } catch {} return out; }
    function idOfHref(href) { if (!href) return ''; let text = String(href); try { text = new URL(text, location.href).href; } catch {} const m = text.match(/\/(?:posts|permalink)\/(\d+)/) || text.match(/[?&]story_fbid=(\d+)/); return m ? m[1] : ''; }
    function postIdOf(el) { let node = el; let found = ''; for (let depth = 0; node && node.nodeType === 1 && depth < 40; depth++) { const ids = new Set(); const anchors = node.querySelectorAll('a[href]'); for (let i = 0; i < anchors.length; i++) { const id = idOfHref(anchors[i].getAttribute('href')); if (id) { ids.add(id); if (ids.size > 1) break; } } if (ids.size > 1) break; if (ids.size === 1) found = Array.from(ids)[0]; node = node.parentElement; } return found; }
    for (const el of Array.from(document.querySelectorAll('[data-aka-comment-target]'))) el.removeAttribute('data-aka-comment-target');
    const boxes = xpathAll(unionXpath);
    let chosen = null;
    if (mode === 'own') {
      chosen = boxes.find(el => postIdOf(el) === ownId) || null;
    } else {
      const atPosition = boxes[position - 1];
      if (!atPosition || postIdOf(atPosition) !== ownId) return 'legacy';
      for (let i = position; i < boxes.length; i++) { if (postIdOf(boxes[i]) !== ownId) { chosen = boxes[i]; break; } }
    }
    if (!chosen) return 'none';
    chosen.setAttribute('data-aka-comment-target', token);
    return 'marked';
  `, union, ownId, token, ownTarget ? 'own' : 'other', position)
  if (picked === 'marked') return { xpath: "//*[@data-aka-comment-target='" + token + "']" }
  if (ownTarget) return { skip: true, message: __OWN_POST_SKIP_MESSAGE }
  return { xpath: null }
}

// Read only after comment submit/settle and the existing frequency-limit check.
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
const __commentTarget = await __resolveCommentTarget(pos)
if (__commentTarget.skip) {
  helpers.log(__commentTarget.message)
  return { commented: false, position: pos, text: '', imageCount: 0, ownPostSkipped: true, skipReason: __commentTarget.message }
}
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
  const boxXpath = __commentTarget.xpath || await helpers.elementWith('fb_comment_box_at_n', { n: pos })
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
 WHERE id = 2851 AND md5(code) = '30126bae87ff755164c80dbffda9d263';
UPDATE public.auto_engine_block_steps SET reviewed_code_md5 = '06889369d1c9f77ef62c846fa8e27e82', updated_at = now()
 WHERE id = 6 AND block_id = 2851 AND reviewed_code_md5 = '30126bae87ff755164c80dbffda9d263';

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

// [engine] V563 (anh chốt 17/11): đăng nhóm xong mà chưa lấy được link bài vừa đăng (bài video chưa hiện, Facebook chưa hiện bài…) thì bỏ
// lượt comment "bài của mình" thay vì comment vào ô đầu tiên trên trang (thường là bài người khác), và báo khách một câu tiến trình (bộ dựng
// lịch sử in câu ⚠️ khi skippedByGroupMode; không ghi dòng lịch sử, không tính lượt). Comment bài khác vẫn chạy.
if (enableComment && !skippedByGroupMode && vars.groupPostSubmitted === true && commentIterations.length > 0) {
  const ownPostWanted = commentType === 'own' || (commentType === 'all' && !isPending);
  const ownPostUrl = String(vars.groupPostPostUrl || '');
  const ownPostMatch = ownPostUrl.match(/\/(?:posts|permalink)\/(\d+)/) || ownPostUrl.match(/[?&]story_fbid=(\d+)/);
  if (ownPostWanted && !ownPostMatch) {
    commentIterations = commentIterations.filter((item, index) => {
      const row = item && typeof item === 'object' ? item : {};
      return Number(row.position || index + 1) !== 1;
    });
    adjusted = true;
    skippedByGroupMode = true;
    skipReason = 'Chưa thấy bài vừa đăng trên trang nhóm nên bỏ qua comment vào bài của mình';
    helpers.log(skipReason);
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
 WHERE id = 2874 AND md5(code) = 'ffeb17c8967ab564098da8f641650674';


-- 3. Dấu hiệu FB11: nút "Tham gia nhóm" / "Join group" trên trang khi đăng nhóm ra FB40.
UPDATE public.auto_system_settings SET value = '[{"code":"err_fb_page_inbox_customer_not_found","source":"message","actions":["fb_message_page_inbox_customer"],"phases":[],"replaces":[],"texts":["Không tìm thấy khách hàng trong inbox page"]},{"code":"err_fb_page_inbox_wrong_conversation","source":"message","actions":["fb_message_page_inbox_customer"],"phases":[],"replaces":[],"texts":["Không tìm thấy đúng khách hàng trong inbox page"]},{"code":"err_fb_upload_form_changed","source":"message","actions":[],"phases":["before_send"],"replaces":[],"texts":["Cần đúng 1 input file trong form đăng bài, tìm thấy 0","Input trong form không nhận ảnh/video"]},{"code":"err_fb_group_cannot_post_unavailable","source":"page","actions":["fb_post_group"],"phases":[],"replaces":["err_fb_group_composer_editor_not_found"],"texts":["Bạn hiện không xem được nội dung này","This content isn''t available right now"]},{"code":"err_fb_group_cannot_post_not_member","source":"page","actions":["fb_post_group"],"phases":[],"replaces":["err_fb_group_composer_editor_not_found"],"texts":["Tham gia nhóm","Join group"]}]', updated_at = now()
 WHERE key = 'facebook.error_signs' AND md5(value) = '9eae00aad9c77a7b1e248f3a52ba73c0';

-- 4. Chính sách FB11 khi đăng nhóm: chép nguyên dòng FB40 chung, đổi câu cho khách.
INSERT INTO public.auto_outcome_policies (error_code, action_code, error_class, status_id, campaign_action_id, runtime_target, detail_mode, detail_status_id, sub_status_id, quota_effect, target_streak_effect, streak_threshold, target_effect, requeue_after_minutes, remaining_steps, lock_action_codes, lock_mode, lock_minutes, lock_days, lock_time, run_effect, pace_mode, pace_seconds, campaign_effect, campaign_hold_minutes, account_effect, login_effect, streak_after_delivery, log_template, campaign_note_template,
  description, source, is_active, is_delete)
SELECT 'err_fb_group_cannot_post_not_member', 'fb_post_group', p.error_class, p.status_id, p.campaign_action_id, p.runtime_target, p.detail_mode, p.detail_status_id, p.sub_status_id, p.quota_effect, p.target_streak_effect, p.streak_threshold, p.target_effect, p.requeue_after_minutes, p.remaining_steps, p.lock_action_codes, p.lock_mode, p.lock_minutes, p.lock_days, p.lock_time, p.run_effect, p.pace_mode, p.pace_seconds, p.campaign_effect, p.campaign_hold_minutes, p.account_effect, p.login_effect, p.streak_after_delivery, 'Tài khoản chưa vào nhóm này nên chưa đăng bài được', 'Tài khoản chưa vào nhóm này nên chưa đăng bài được',
  '[anh chốt 17/11, V563] FB11 khi đăng nhóm: có chỗ phát (dấu hiệu: không thấy ô đăng bài (FB40) mà trang có nút "Tham gia nhóm" / "Join group"); giữ cách xử lý như FB40 hôm nay, chỉ đổi câu cho khách.', 'v563_fb_signs', true, false
  FROM public.auto_outcome_policies p
 WHERE p.error_code = 'err_fb_group_composer_editor_not_found' AND p.action_code IS NULL AND p.campaign_action_id IS NULL AND p.runtime_target IS NULL AND p.is_active AND NOT p.is_delete
   AND md5(jsonb_strip_nulls(to_jsonb(p) - 'id' - 'created_at' - 'updated_at' - 'updated_by' - 'revision')::text) = '7ead85c5fa88a906d167ce52f46ecc03';

DO $post$
DECLARE v_n integer; v_phase text; v_mine jsonb; v_today jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = 2909 AND md5(code) = '499445e4406d2095c951b5c1c9aef03d') THEN
    RAISE EXCEPTION 'V563 postflight: code block 2909 không phải bản mới (md5 499445e4406d2095c951b5c1c9aef03d)';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_engine_block_steps WHERE block_id = 2909 AND reviewed_code_md5 IS DISTINCT FROM '499445e4406d2095c951b5c1c9aef03d') THEN
    RAISE EXCEPTION 'V563 postflight: danh mục bước của block 2909 chưa ghi md5 bản mới';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = 2723 AND md5(code) = '91e809e62911aea2c2391ae14676dc3b') THEN
    RAISE EXCEPTION 'V563 postflight: block bộ cũ 2723 đã đổi (V563 không được đụng bộ cũ)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = 2851 AND md5(code) = '06889369d1c9f77ef62c846fa8e27e82') THEN
    RAISE EXCEPTION 'V563 postflight: code block 2851 không phải bản mới (md5 06889369d1c9f77ef62c846fa8e27e82)';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_engine_block_steps WHERE block_id = 2851 AND reviewed_code_md5 IS DISTINCT FROM '06889369d1c9f77ef62c846fa8e27e82') THEN
    RAISE EXCEPTION 'V563 postflight: danh mục bước của block 2851 chưa ghi md5 bản mới';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = 34 AND md5(code) = '30126bae87ff755164c80dbffda9d263') THEN
    RAISE EXCEPTION 'V563 postflight: block bộ cũ 34 đã đổi (V563 không được đụng bộ cũ)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = 2874 AND md5(code) = 'f7c07500e06511bee20f1c409c185211') THEN
    RAISE EXCEPTION 'V563 postflight: code block 2874 không phải bản mới (md5 f7c07500e06511bee20f1c409c185211)';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_engine_block_steps WHERE block_id = 2874 AND reviewed_code_md5 IS DISTINCT FROM 'f7c07500e06511bee20f1c409c185211') THEN
    RAISE EXCEPTION 'V563 postflight: danh mục bước của block 2874 chưa ghi md5 bản mới';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = 2627 AND md5(code) = 'ffeb17c8967ab564098da8f641650674') THEN
    RAISE EXCEPTION 'V563 postflight: block bộ cũ 2627 đã đổi (V563 không được đụng bộ cũ)';
  END IF;
  SELECT count(*) INTO v_n FROM public.auto_system_settings WHERE key = 'facebook.error_signs' AND md5(value) = '7e25dd65faab148bcf55b93654852a16'
     AND jsonb_array_length(value::jsonb) = 5;
  IF v_n <> 1 THEN RAISE EXCEPTION 'V563 postflight: dòng facebook.error_signs không phải bản mới (5 dấu hiệu)'; END IF;
  SELECT count(*) INTO v_n FROM public.auto_outcome_policies WHERE source = 'v563_fb_signs' AND error_code = 'err_fb_group_cannot_post_not_member' AND action_code = 'fb_post_group'
     AND is_active AND NOT is_delete;
  IF v_n <> 1 THEN RAISE EXCEPTION 'V563 postflight: cần đúng 1 dòng chính sách FB11 cho đăng nhóm, có %', v_n; END IF;
  -- Chính sách hiệu lực của FB11 khi đăng nhóm = FB40 (trừ câu cho khách) ở mọi pha.
  FOREACH v_phase IN ARRAY ARRAY['before_send', 'in_flight', 'after_send'] LOOP
    v_mine := public.aka_agent_engine_resolve_policy('err_fb_group_cannot_post_not_member', NULL, 'fb_post_group', NULL, 'desktop', v_phase) - 'policy_ids' - 'revisions' - 'log_template' - 'campaign_note_template';
    v_today := public.aka_agent_engine_resolve_policy('err_fb_group_composer_editor_not_found', NULL, 'fb_post_group', NULL, 'desktop', v_phase) - 'policy_ids' - 'revisions' - 'log_template' - 'campaign_note_template';
    IF v_mine IS DISTINCT FROM v_today THEN
      RAISE EXCEPTION 'V563 postflight: chính sách FB11 khi đăng nhóm khác FB40 ở pha %: % / %', v_phase, v_mine, v_today;
    END IF;
  END LOOP;
END $post$;

COMMIT;
