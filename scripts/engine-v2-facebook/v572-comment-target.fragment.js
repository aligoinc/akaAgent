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
