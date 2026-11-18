-- V572: engine v2 Facebook, bản "[engine] fb_comment_at_position" (block 2851): đăng nhóm kèm comment, chọn bài để comment theo mã bài
-- của hộp thoại vừa mở (link /groups/<nhóm>/permalink/<mã bài>/ khi bấm ô bình luận), không comment 2 lần vào một bài, không comment bài vừa
-- đăng khi chọn "Không comment vào post của mình". Chỉ sửa code block engine + md5 đã duyệt của danh mục bước; bộ cũ (block 34)
-- không đổi. SINH TỪ scripts/build-v572-sql.cjs (nguồn guard: scripts/fixtures/engine-v2-facebook/v572-live-20261118.json), không sửa tay.
-- Chỉ dữ liệu, không DDL (không nạp lại schema PostgREST). Desktop đọc code block mỗi lượt, danh mục bước ở lần nạp danh mục kế tiếp (trong
-- lúc chưa nạp lại, bước comment chạy ở mức cam kết 1 như mọi block đổi code chưa duyệt). Gỡ: rollback_v572_engine_facebook_comment_dialog_post.sql.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
DECLARE v_n integer;
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v572_%') THEN
      RAISE EXCEPTION 'V572 đã có trong sổ migration, không chạy lại';
    END IF;
  END IF;
  IF to_regclass('public.auto_engine_block_copies') IS NULL OR to_regclass('public.auto_engine_block_steps') IS NULL THEN
    RAISE EXCEPTION 'V572 cần V556–V560 (sổ chép block, danh mục bước)';
  END IF;
  SELECT count(*) INTO v_n FROM public.auto_blocks b JOIN public.auto_engine_block_copies c ON c.engine_block_id = b.id
   WHERE b.id = 2851 AND b.name = '[engine] fb_comment_at_position' AND c.source_block_id = 34 AND md5(b.code) = '06889369d1c9f77ef62c846fa8e27e82';
  IF v_n <> 1 THEN RAISE EXCEPTION 'V572: block 2851 không còn đúng bản V563 (md5 06889369d1c9f77ef62c846fa8e27e82), đọc lại và sinh lại'; END IF;
  SELECT count(*) INTO v_n FROM public.auto_engine_block_steps WHERE block_id = 2851;
  IF v_n <> 1 THEN RAISE EXCEPTION 'V572: block 2851 có % dòng danh mục bước, cần 1', v_n; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_engine_block_steps WHERE id = 6 AND block_id = 2851 AND commit_level = 2
                   AND send_ops = '["press:Enter"]'::jsonb AND reviewed_code_md5 = '06889369d1c9f77ef62c846fa8e27e82') THEN
    RAISE EXCEPTION 'V572: dòng danh mục bước 6 của block 2851 khác bản đã đọc';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = 34 AND md5(code) = '30126bae87ff755164c80dbffda9d263') THEN
    RAISE EXCEPTION 'V572: block bộ cũ 34 khác bản đã đọc';
  END IF;
END $pre$;

UPDATE public.auto_blocks SET code = $v572_comment$// [engine] V563 (rà lỗi Facebook 17/11/2026): đăng nhóm kèm comment chỉ comment "bài của mình" khi thấy đúng bài vừa đăng: mã bài trong
// link lấy sau khi đăng (vars.groupPostPostUrl) trùng mã bài trong khung chứa ô bình luận. Không thấy (chưa lấy được link, bài video chưa
// hiện, bài chờ duyệt) thì bỏ qua, không comment vào bài người khác (chưa lấy được link thì block chỉnh comment đã bỏ lượt này và báo khách
// trước vòng comment). Bản sửa 18/11/2026 (thay bản V568 đã gỡ): trong vòng comment của workflow đăng nhóm, bấm ô bình luận rồi đọc mã bài
// của hộp thoại vừa mở (link trang đổi ngay sang /groups/<nhóm>/permalink/<mã bài>/, thử trên Facebook thật 18/11). Bài của mình: chọn ô như
// V563, mã hộp thoại khác bài vừa đăng thì không comment. Bài khác: bỏ bài vừa đăng và bài đã comment trong lượt (nhớ trong vars), bấm ô kế;
// hết ô thì đóng hộp thoại, cuộn cho feed nạp thêm bài; gõ khi hộp thoại đã đổi sang bài mới. Trước bản sửa này (chọn ô theo vị trí / mã bài đọc
// từ link trong khung):
// feed chưa nạp link bài nên nhiều bài nhận cùng một mã, mở hộp thoại thì ô thứ N đổi bài, ô "Bình luận về bài viết…" trong hộp thoại cũng
// khớp, gõ khi hộp thoại chưa đổi xong thì rơi vào bài cũ: một bài bị comment 2 lần. Comment seeding giữ như bộ cũ.
const __OWN_POST_SKIP_MESSAGE = 'Chưa thấy bài vừa đăng trên trang nhóm nên bỏ qua comment vào bài của mình'
function __commentPostIdOf(url) {
  const text = String(url || '')
  const match = text.match(/\/(?:posts|permalink)\/(\d+)/) || text.match(/[?&]story_fbid=(\d+)/)
  return match ? match[1] : ''
}
const __NO_OTHER_POST_MESSAGE = 'Không còn bài khác chưa comment trên trang nhóm nên bỏ qua lượt comment này'
const __DIALOG_NOT_SWITCHED_MESSAGE = 'Hộp thoại chưa đổi sang bài vừa chọn nên bỏ qua lượt comment này'
const __NO_GROUP_FEED_MESSAGE = 'Không mở lại được trang nhóm nên bỏ qua lượt comment này'
// Trang nhóm vừa tải (thử 18/11: bấm sau 6–11 giây) thì Facebook chưa mở bài trong hộp thoại mà chuyển hẳn sang trang riêng của bài, phía sau là
// trang chủ có bài ngoài nhóm (bấm sau 17–29 giây thì mở hộp thoại ngay trong trang nhóm): chọn bài chỉ khi trang nhóm đã mở đủ lâu.
const __GROUP_PAGE_WARM_MS = 25000
// Bản sửa 18/11/2026: mã các bài đã comment / đã thử comment trong lượt của data này (vars dựng mới cho mỗi data), không comment lại.
function __commentedPostIds() {
  return Array.isArray(vars.__akaCommentedPostIds) ? vars.__akaCommentedPostIds.map(String).filter(Boolean) : []
}
function __rememberCommentedPost(id) {
  if (!id) return
  const ids = __commentedPostIds()
  if (!ids.includes(id)) ids.push(id)
  vars.__akaCommentedPostIds = ids
}
// Mã bài của hộp thoại đang mở: bấm ô bình luận của một bài thì link trang đổi ngay sang /groups/<nhóm>/permalink/<mã bài>/ (thử trên
// Facebook thật 18/11/2026); đóng hộp thoại thì link về trang nhóm, không có mã.
async function __pagePostId() {
  try {
    return __commentPostIdOf(await page.evaluate('return String(location.href || "")'))
  } catch (error) {
    if (signal.aborted) throw error
    return ''
  }
}
function __groupKeyOf(path) {
  const match = String(path || '').match(/^\/groups\/([^/?#]+)/)
  return match ? match[1] : ''
}
async function __pageState() {
  try {
    return await page.evaluate(String.raw`
      return { href: String(location.href || ''), path: String(location.pathname || ''), feed: !!document.querySelector('[role="feed"]'), since: Math.round(performance.now()) };
    `)
  } catch (error) {
    if (signal.aborted) throw error
    return { href: '', path: '', feed: false, since: 0 }
  }
}
// Sau cú bấm: mã bài và nhóm của link trang (Facebook đổi link ngay trong cú bấm; chờ thêm tối đa 3 giây).
async function __postAfterClick(beforeId) {
  let state = { href: '', path: '' }
  for (let i = 0; i < 15; i++) {
    state = await __pageState()
    const id = __commentPostIdOf(state.href)
    if (id && id !== beforeId) return { id, changed: true, groupKey: __groupKeyOf(state.path) }
    await helpers.sleep(200, signal)
  }
  return { id: __commentPostIdOf(state.href), changed: false, groupKey: __groupKeyOf(state.path) }
}
// Về trang nhóm (đang ở trang riêng của bài) và chờ trang mở đủ lâu.
async function __ensureGroupFeed(groupKey) {
  let state = await __pageState()
  if (!state.feed || __groupKeyOf(state.path) !== groupKey) {
    try {
      await page.navigate('https://www.facebook.com/groups/' + groupKey + '/')
      await page.waitForSelector('//*[@role="feed"]', { timeout: 20000 })
    } catch (error) {
      if (signal.aborted) throw error
      return false
    }
    state = await __pageState()
  }
  if (state.since < __GROUP_PAGE_WARM_MS) await helpers.sleep(__GROUP_PAGE_WARM_MS - state.since, signal)
  return true
}
// Lệnh đọc / đánh dấu trên trang sau cú bấm: trang có thể đang chuyển (Facebook chuyển hẳn sang trang riêng của bài) nên lỗi thì coi như không
// đọc được, không dừng block (bước sau tự quay về trang nhóm).
async function __pageEval(code, ...args) {
  try {
    return await page.evaluate(code, ...args)
  } catch (error) {
    if (signal.aborted) throw error
    return null
  }
}
const __PAGE_HELPERS = String.raw`
  function xpathAll(xpath) { const out = []; try { const r = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null); for (let i = 0; i < r.snapshotLength; i++) { const it = r.snapshotItem(i); if (it) out.push(it); } } catch {} return out; }
  function isVisible(el) { if (!el) return false; const s = window.getComputedStyle(el); if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return false; return el.offsetWidth > 0 && el.offsetHeight > 0; }
`
// Hộp thoại đang mở mà bấm ô của bài khác thì nội dung đổi sang bài đó sau 0,1–0,5 giây; ô nhập có khi được tạo mới, có khi giữ nguyên (hai bài
// cùng người đăng), còn mã theo dõi __cft__ trong link của hộp thoại đổi theo bài (thử 18/11). Trước khi bấm: đánh dấu ô nhập và ghi mã của hộp
// thoại đang mở; chỉ gõ khi ô cũ đã bị thay hoặc mã đã đổi (gõ sớm là comment vào bài cũ).
const __DIALOG_TOKEN_JS = String.raw`
  function dialogToken(inputXpath) {
    const input = xpathAll(inputXpath).find(isVisible);
    const dialog = input ? input.closest('[role="dialog"]') : null;
    const link = dialog ? dialog.querySelector('a[href*="__cft__"]') : null;
    const match = link ? String(link.getAttribute('href') || '').match(/__cft__\[0\]=([^&]+)/) : null;
    return match ? match[1] : '';
  }
`
async function __markOldInput(token, inputXpath) {
  return await __pageEval(__PAGE_HELPERS + __DIALOG_TOKEN_JS + String.raw`
    const token = __args[0]; const inputXpath = __args[1];
    for (const el of Array.from(document.querySelectorAll('[data-aka-comment-old]'))) el.removeAttribute('data-aka-comment-old');
    const inputs = xpathAll(inputXpath);
    for (const el of inputs) el.setAttribute('data-aka-comment-old', token);
    return { hadInput: inputs.length > 0, dialogToken: dialogToken(inputXpath) };
  `, token, inputXpath)
}
async function __waitDialogSwitched(token, inputXpath, before) {
  if (!before || !before.hadInput) return true
  for (let i = 0; i < 50; i++) {
    const state = await __pageEval(__PAGE_HELPERS + __DIALOG_TOKEN_JS + String.raw`
      const token = __args[0]; const inputXpath = __args[1];
      const oldLeft = Array.from(document.querySelectorAll('[data-aka-comment-old]')).some(el => el.getAttribute('data-aka-comment-old') === token);
      return { oldLeft, dialogToken: dialogToken(inputXpath) };
    `, token, inputXpath)
    if (state && !state.oldLeft) return true
    // Hộp thoại cũ không có mã theo dõi: chờ như bộ cũ (khoảng 2,4 giây) rồi gõ.
    if (state && (before.dialogToken ? (state.dialogToken && state.dialogToken !== before.dialogToken) : i >= 12)) return true
    await helpers.sleep(200, signal)
  }
  return false
}
async function __clickCandidate(token, inputXpath) {
  const beforeId = await __pagePostId()
  const before = await __markOldInput(token, inputXpath)
  try {
    await page.click("//*[@data-aka-comment-target='" + token + "']")
  } catch (error) {
    if (signal.aborted || /not connected/i.test(String(error && error.message))) throw error
    return { id: '', changed: false, groupKey: '', failed: true, before }
  }
  const after = await __postAfterClick(beforeId)
  return { id: after.id, changed: after.changed, groupKey: after.groupKey, failed: false, before }
}
async function __tagCandidate(token, id) {
  await __pageEval(String.raw`
    const token = __args[0]; const id = __args[1];
    for (const el of Array.from(document.querySelectorAll('[data-aka-comment-target]'))) {
      if (el.getAttribute('data-aka-comment-target') !== token) continue;
      el.setAttribute('data-aka-comment-seen', id || 'x');
      el.removeAttribute('data-aka-comment-target');
    }
    return true;
  `, token, id)
}
// Ô bình luận kế tiếp chưa thử, theo thứ tự trên trang; bỏ ô trong hộp thoại (nút "Bình luận về bài viết…" của hộp thoại cũng khớp phần tử).
async function __markNextOtherBox(union, token) {
  return (await __pageEval(__PAGE_HELPERS + String.raw`
    const unionXpath = __args[0]; const token = __args[1];
    for (const el of Array.from(document.querySelectorAll('[data-aka-comment-target]'))) el.removeAttribute('data-aka-comment-target');
    const next = xpathAll(unionXpath).find(el => !el.closest('[role="dialog"]') && !el.hasAttribute('data-aka-comment-seen') && isVisible(el));
    if (!next) return false;
    next.setAttribute('data-aka-comment-target', token);
    return true;
  `, union, token)) === true
}
async function __closePostDialog() {
  for (let i = 0; i < 3 && await __pagePostId(); i++) {
    if (i < 2) {
      try { await page.press('Escape') } catch (error) { if (signal.aborted) throw error }
    } else {
      const token = 'aka_cmt_close_' + Date.now()
      const marked = await __pageEval(__PAGE_HELPERS + String.raw`
        const token = __args[0];
        const buttons = Array.from(document.querySelectorAll('[role="dialog"] [aria-label="Đóng"], [role="dialog"] [aria-label="Close"]')).filter(isVisible);
        const button = buttons[buttons.length - 1];
        if (!button) return false;
        button.setAttribute('data-aka-comment-close', token);
        return true;
      `, token)
      if (marked) {
        try { await page.click("//*[@data-aka-comment-close='" + token + "']") } catch (error) { if (signal.aborted) throw error }
      }
    }
    await helpers.sleep(800, signal)
  }
  return !(await __pagePostId())
}
// Hộp thoại bài đang mở thì trang nền bị khoá cuộn (thử 18/11): đóng rồi cuộn cho feed nạp thêm bài.
async function __loadMorePosts() {
  if (!(await __closePostDialog())) return false
  await __pageEval('window.scrollBy(0, Math.max(600, Math.floor((window.innerHeight || 800) * 0.85))); return true')
  await helpers.sleep(1500, signal)
  return true
}
// Comment bài khác: bấm lần lượt các ô chưa thử, đọc mã bài của hộp thoại; bỏ bài vừa đăng và bài đã comment trong lượt.
async function __openOtherPost(union, ownId, inputXpath) {
  const groupKey = String(vars.__akaCommentGroupKey || __groupKeyOf((await __pageState()).path))
  if (!groupKey) return { xpath: null }
  vars.__akaCommentGroupKey = groupKey
  const done = new Set(__commentedPostIds())
  if (ownId) done.add(ownId)
  const learnedOwnId = String(vars.__akaCommentOwnPostId || '')
  if (learnedOwnId) done.add(learnedOwnId)
  // Chưa có link bài vừa đăng mà bài không chờ duyệt: bài đầu tiên trên trang là bài vừa đăng (như vị trí 2..N+1 của bộ cũ); nhớ mã, không comment.
  let learnOwn = !ownId && !learnedOwnId && vars.groupPostSubmitted === true && vars.groupPostIsPending !== true
  let clicks = 0
  let scrolls = 0
  let recoveries = 0
  while (clicks < 12) {
    const state = await __pageState()
    const onGroupFeed = state.feed && __groupKeyOf(state.path) === groupKey
    if (!onGroupFeed || state.since < __GROUP_PAGE_WARM_MS) {
      if (!onGroupFeed && recoveries++ >= 2) return { skip: true, other: true, message: __NO_GROUP_FEED_MESSAGE }
      if (!(await __ensureGroupFeed(groupKey))) return { skip: true, other: true, message: __NO_GROUP_FEED_MESSAGE }
    }
    const token = 'aka_cmt_' + Date.now() + '_' + Math.random().toString(36).slice(2)
    if (!(await __markNextOtherBox(union, token))) {
      if (scrolls >= 6 || !(await __loadMorePosts())) return { skip: true, other: true, message: __NO_OTHER_POST_MESSAGE }
      scrolls++
      continue
    }
    clicks++
    const opened = await __clickCandidate(token, inputXpath)
    // Chỉ nhận bài của đúng nhóm này (bài ngoài nhóm, bấm không mở bài khác: bỏ ô đó).
    const sameGroup = opened.changed && opened.groupKey === groupKey
    await __tagCandidate(token, sameGroup ? opened.id : '')
    if (!sameGroup) continue
    if (learnOwn) {
      learnOwn = false
      vars.__akaCommentOwnPostId = opened.id
      done.add(opened.id)
      continue
    }
    if (done.has(opened.id)) continue
    if (!(await __waitDialogSwitched(token, inputXpath, opened.before))) return { skip: true, other: true, message: __DIALOG_NOT_SWITCHED_MESSAGE }
    return { opened: true, postId: opened.id }
  }
  return { skip: true, other: true, message: __NO_OTHER_POST_MESSAGE }
}
async function __resolveCommentTarget(position) {
  // Bản sửa 18/11/2026: vòng comment của workflow đăng nhóm, cả khi bỏ qua đăng vì nhóm đã biết cần duyệt (không có bài của mình).
  if (vars.groupPostSubmitted !== true && vars.groupPostSkippedByKnownApproval !== true) return { xpath: null }
  const kind = String(vars.commentType || 'own')
  const ownTarget = position === 1 && (kind === 'own' || (kind === 'all' && vars.groupPostIsPending !== true))
  const ownId = vars.groupPostSubmitted === true ? __commentPostIdOf(vars.groupPostPostUrl) : ''
  if (ownTarget && !ownId) return { skip: true, message: __OWN_POST_SKIP_MESSAGE }
  const indexed = String(await helpers.elementWith('fb_comment_box_at_n', { n: 1 }))
  if (!/\[1\]\s*$/.test(indexed)) return ownTarget ? { skip: true, message: __OWN_POST_SKIP_MESSAGE } : { xpath: null }
  const union = indexed.replace(/\[1\]\s*$/, '')
  const inputXpath = await helpers.element('fb_comment_dialog_textbox')
  if (!ownTarget) return await __openOtherPost(union, ownId, inputXpath)
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
  `, union, ownId, token, 'own', position)
  if (picked !== 'marked') return { skip: true, message: __OWN_POST_SKIP_MESSAGE }
  // Bản sửa 18/11/2026: bài của mình chọn như V563 (mã bài trong khung chứa ô), rồi đọc mã bài của hộp thoại vừa mở: khác bài vừa đăng thì không comment.
  const opened = await __clickCandidate(token, inputXpath)
  if (opened.failed) return { xpath: "//*[@data-aka-comment-target='" + token + "']" }
  await __tagCandidate(token, opened.id)
  if (opened.id && opened.id !== ownId) return { skip: true, message: __OWN_POST_SKIP_MESSAGE }
  if (opened.changed && !(await __waitDialogSwitched(token, inputXpath, opened.before))) return { skip: true, message: __OWN_POST_SKIP_MESSAGE }
  return { opened: true, postId: opened.id || ownId }
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
  if (__commentTarget.other) return { commented: false, position: pos, text: '', imageCount: 0, otherPostSkipped: true, skipReason: __commentTarget.message }
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
  if (__commentTarget.opened !== true) {
    const boxXpath = __commentTarget.xpath || await helpers.elementWith('fb_comment_box_at_n', { n: pos })
    await page.waitForSelector(boxXpath, { timeout: 8000 })
    await page.click(boxXpath)
  }
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
  __rememberCommentedPost(__commentTarget.postId)
  await helpers.sleep(10000, signal)
  await throwIfCommentFrequencyLimited()
  const commentUrl = await getFirstCommentUrl()
  const logSuffix = text ? ': ' + text.substring(0, 50) : ''
  helpers.log('💬 Đã comment vào bài #' + pos + logSuffix)
  return { commented: true, commentUrl, position: pos, text: text, imageCount: imageCount, rewrittenContent: shouldRewriteCommentContentEachRun, commentPostId: __commentTarget.postId || '' }
} catch (e) {
  __rememberCommentedPost(__commentTarget.postId)
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
$v572_comment$, updated_at = now()
 WHERE id = 2851 AND md5(code) = '06889369d1c9f77ef62c846fa8e27e82';
UPDATE public.auto_engine_block_steps SET reviewed_code_md5 = '16e51c5de52e79d246e87058a65e63eb', updated_at = now()
 WHERE id = 6 AND block_id = 2851 AND reviewed_code_md5 = '06889369d1c9f77ef62c846fa8e27e82';

DO $post$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = 2851 AND md5(code) = '16e51c5de52e79d246e87058a65e63eb') THEN
    RAISE EXCEPTION 'V572 postflight: code block 2851 không phải bản mới (md5 16e51c5de52e79d246e87058a65e63eb)';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_engine_block_steps WHERE block_id = 2851 AND reviewed_code_md5 IS DISTINCT FROM '16e51c5de52e79d246e87058a65e63eb') THEN
    RAISE EXCEPTION 'V572 postflight: danh mục bước của block 2851 chưa ghi md5 bản mới';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = 34 AND md5(code) = '30126bae87ff755164c80dbffda9d263') THEN
    RAISE EXCEPTION 'V572 postflight: block bộ cũ 34 đã đổi (V572 không được đụng bộ cũ)';
  END IF;
END $post$;

COMMIT;
