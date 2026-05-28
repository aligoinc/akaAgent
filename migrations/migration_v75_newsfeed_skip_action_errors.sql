-- Make Facebook newsfeed interaction tolerate skippable per-post/per-action DOM failures.
-- Selector set is unchanged; operation order still follows akaBizAuto Newsfeed_Fb.

BEGIN;

UPDATE public.auto_blocks
SET code = $code$
const state = vars.newsfeedState || {}
if (state.shouldContinue !== true) return { hasPost: false, skipped: true }

const selectors = {
  post: await helpers.element('fb_newsfeed_post')
}

const result = await page.evaluate(`
  const selectors = __args[0];
  const cursor = Number(__args[1] || 0);
  const loadPostDelayMs = Number(__args[2] || 5000);

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  function xpathAll(xpath, root) {
    const out = [];
    const result = document.evaluate(xpath, root || document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    for (let i = 0; i < result.snapshotLength; i++) out.push(result.snapshotItem(i));
    return out.filter(Boolean);
  }
  function clearCurrent() {
    try {
      document.querySelectorAll('[data-aka-newsfeed-current="1"]').forEach(el => el.removeAttribute('data-aka-newsfeed-current'));
    } catch {}
  }

  let posts = xpathAll(selectors.post, document);
  if (posts.length === 0) return { hasPost: false, total: 0, postIndex: cursor + 1, nextCursor: cursor };

  if (cursor >= posts.length) {
    posts[posts.length - 1].scrollIntoView(true);
    await delay(loadPostDelayMs);
    posts = xpathAll(selectors.post, document);
  }

  if (cursor >= posts.length) {
    return { hasPost: false, total: posts.length, postIndex: cursor + 1, nextCursor: cursor };
  }

  const post = posts[cursor];
  clearCurrent();
  post.setAttribute('data-aka-newsfeed-current', '1');
  post.scrollIntoView(false);
  return { hasPost: true, total: posts.length, postIndex: cursor + 1, nextCursor: cursor + 1 };
`, selectors, state.cursor, state.loadPostDelayMs).catch(() => ({
  hasPost: false,
  total: Number(state.lastCount || 0),
  postIndex: Number(state.cursor || 0) + 1,
  nextCursor: Number(state.cursor || 0)
}))

state.cursor = Number(result.nextCursor || state.cursor || 0)
state.lastCount = Number(result.total || 0)
if (result.hasPost !== true) {
  state.shouldContinue = false
  state.currentPost = null
  helpers.log('Không có post newsfeed mới để xử lý')
}
return result
$code$,
updated_at = now()
WHERE name = 'fb_newsfeed_select_next_post';

UPDATE public.auto_blocks
SET code = $code$
const state = vars.newsfeedState || {}
const post = state.currentPost || {}
const shouldRunLike = input.shouldLike === true || input.conditionResult === true || input.branch === 'true'
if (shouldRunLike !== true || state.remainingLike <= 0) return { liked: false }
const selectors = { like: await helpers.element('fb_newsfeed_like_button') }
const actionGap = helpers.randomBetween(Number(state.actionGapSeconds || 4) * 600, Number(state.actionGapSeconds || 4) * 1400)

const clicked = await page.evaluate(`
  const selector = __args[0];
  const stepDelayMs = Number(__args[1] || 1000);
  const actionGap = Number(__args[2] || 0);
  function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
  function xpathOne(xpath, root) {
    const result = document.evaluate(xpath, root || document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
    return result.singleNodeValue || null;
  }
  function clickSynthetic(el) {
    const init = { bubbles: true, cancelable: true, view: window };
    try { el.dispatchEvent(new PointerEvent('pointerdown', Object.assign({}, init, { pointerId: 1, pointerType: 'mouse' }))); } catch {}
    try { el.dispatchEvent(new MouseEvent('mousedown', init)); } catch {}
    try { el.dispatchEvent(new PointerEvent('pointerup', Object.assign({}, init, { pointerId: 1, pointerType: 'mouse' }))); } catch {}
    try { el.dispatchEvent(new MouseEvent('mouseup', init)); } catch {}
    el.click();
  }
  try {
    const post = document.querySelector('[data-aka-newsfeed-current="1"]');
    if (!post) return false;
    const likeBtn = xpathOne(selector, post);
    if (!likeBtn) return false;
    likeBtn.scrollIntoView(false);
    await delay(stepDelayMs);
    clickSynthetic(likeBtn);
    await delay(stepDelayMs + actionGap);
    return true;
  } catch {
    return false;
  }
`, selectors.like, state.stepDelayMs, actionGap)

if (!clicked) {
  helpers.log('Bỏ qua like newsfeed: không tìm thấy hoặc không click được nút Thích')
  return { liked: false }
}

state.remainingLike = Math.max(0, Number(state.remainingLike || 0) - 1)
state.likeDone = Number(state.likeDone || 0) + 1
helpers.log('Đã like bài newsfeed của ' + (post.targetName || 'người đăng'))
return {
  liked: true,
  targetName: post.targetName || '',
  targetUid: post.targetUid || '',
  postContent: post.postContent || ''
}
$code$,
updated_at = now()
WHERE name = 'fb_newsfeed_like_post';

UPDATE public.auto_blocks
SET code = $code$
const state = vars.newsfeedState || {}
const shouldRunComment = input.shouldComment === true || input.conditionResult === true || input.branch === 'true'
if (shouldRunComment !== true || state.remainingComment <= 0) return { opened: false }
const selectors = { commentButton: await helpers.element('fb_newsfeed_comment_button') }
const actionGap = helpers.randomBetween(Number(state.actionGapSeconds || 4) * 600, Number(state.actionGapSeconds || 4) * 1400)
const result = await page.evaluate(`
  const selector = __args[0];
  const delayMs = Number(__args[1] || 1000) + Number(__args[2] || 0);
  function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
  function xpathOne(xpath, root) {
    const result = document.evaluate(xpath, root || document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
    return result.singleNodeValue || null;
  }
  try {
    const post = document.querySelector('[data-aka-newsfeed-current="1"]');
    if (!post) return { opened: false, skipReason: 'Không tìm thấy post newsfeed hiện tại' };
    const btn = xpathOne(selector, post);
    if (!btn) return { opened: false, skipReason: 'Không tìm thấy nút Bình luận' };
    btn.click();
    await delay(delayMs);
    return { opened: true };
  } catch (e) {
    return { opened: false, skipReason: e && e.message ? e.message : String(e) };
  }
`, selectors.commentButton, state.stepDelayMs, actionGap)
if (result.opened !== true && result.skipReason) {
  helpers.log('Bỏ qua mở comment newsfeed: ' + result.skipReason)
}
return result
$code$,
updated_at = now()
WHERE name = 'fb_newsfeed_comment_open';

UPDATE public.auto_blocks
SET code = $code$
const state = vars.newsfeedState || {}
if (input.opened !== true) return { focused: false }
const selectors = {
  commentButton: await helpers.element('fb_newsfeed_comment_button'),
  dialogInput: await helpers.element('fb_newsfeed_dialog_comment_input'),
  postInput: await helpers.element('fb_newsfeed_comment_input'),
  closeDialog: await helpers.element('fb_newsfeed_close_dialog')
}
const result = await page.evaluate(`
  const selectors = __args[0];
  const stepDelayMs = Number(__args[1] || 1000);
  function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
  function xpathOne(xpath, root) {
    const result = document.evaluate(xpath, root || document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
    return result.singleNodeValue || null;
  }
  function clickSynthetic(el) {
    const init = { bubbles: true, cancelable: true, view: window };
    try { el.dispatchEvent(new PointerEvent('pointerdown', Object.assign({}, init, { pointerId: 1, pointerType: 'mouse' }))); } catch {}
    try { el.dispatchEvent(new MouseEvent('mousedown', init)); } catch {}
    try { el.dispatchEvent(new PointerEvent('pointerup', Object.assign({}, init, { pointerId: 1, pointerType: 'mouse' }))); } catch {}
    try { el.dispatchEvent(new MouseEvent('mouseup', init)); } catch {}
    el.click();
  }
  try {
    const post = document.querySelector('[data-aka-newsfeed-current="1"]');
    if (!post) return { focused: false, skipReason: 'Không tìm thấy post newsfeed hiện tại' };

    const cmtBtn = xpathOne(selectors.commentButton, post);
    if (cmtBtn) {
      clickSynthetic(cmtBtn);
      await delay(stepDelayMs + 500);
    }

    let isDialog = true;
    let input = xpathOne(selectors.dialogInput, document);
    if (!input) {
      isDialog = false;
      input = xpathOne(selectors.postInput, post);
    }
    if (!input) return { focused: false, skipReason: 'Không tìm thấy ô nhập comment' };

    try { document.querySelectorAll('[data-aka-newsfeed-comment-input="1"]').forEach(el => el.removeAttribute('data-aka-newsfeed-comment-input')); } catch {}
    input.setAttribute('data-aka-newsfeed-comment-input', '1');
    input.scrollIntoView(false);
    window.scrollBy(0, 200);
    try { input.click(); } catch { clickSynthetic(input); }
    await delay(stepDelayMs);
    if (!isDialog) {
      try {
        const closeBtn = xpathOne(selectors.closeDialog, document);
        if (closeBtn) closeBtn.click();
      } catch {}
    }
    return { focused: true, isDialog };
  } catch (e) {
    return { focused: false, skipReason: e && e.message ? e.message : String(e) };
  }
`, selectors, state.stepDelayMs)
if (result.focused !== true && result.skipReason) {
  helpers.log('Bỏ qua focus comment newsfeed: ' + result.skipReason)
}
return result
$code$,
updated_at = now()
WHERE name = 'fb_newsfeed_comment_focus';

UPDATE public.auto_blocks
SET code = $code$
const state = vars.newsfeedState || {}
const text = String(state.commentText || '').replace(/\t/g, '      ')
if (input.focused !== true || !text.trim()) return { pasted: false, text }
const pasted = await page.evaluate(`
  const text = __args[0];
  try {
    const input = document.querySelector('[data-aka-newsfeed-comment-input="1"]');
    if (!input) return false;
    input.focus();
    const dt = new DataTransfer();
    dt.setData('text/plain', String(text));
    const pasteEvent = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
    const handled = !input.dispatchEvent(pasteEvent);
    if (!handled) {
      const lines = String(text).split('\\n');
      for (let i = 0; i < lines.length; i++) {
        if (i > 0) document.execCommand('insertParagraph', false, null) || document.execCommand('insertLineBreak', false, null);
        if (lines[i].length > 0) document.execCommand('insertText', false, lines[i]);
      }
    }
    return true;
  } catch {
    return false;
  }
`, text).catch(() => false)
if (!pasted) {
  helpers.log('Bỏ qua paste comment newsfeed: không tìm thấy hoặc không nhập được ô comment')
  return { pasted: false, text }
}
const wordCount = text ? text.split(' ').filter(Boolean).length : 0
const tc = helpers.randomBetween(1, Number(state.tcWrite || 3))
const per100 = helpers.randomBetween(Number(state.timeWrite100WordsMin || 90), Number(state.timeWrite100WordsMin || 90) * 2)
const sleepMs = (tc + Math.floor(per100 * wordCount / 100)) * 1000
await helpers.sleep(sleepMs, signal)
return { pasted: true, text, writeSleepMs: sleepMs }
$code$,
updated_at = now()
WHERE name = 'fb_newsfeed_comment_paste';

UPDATE public.auto_blocks
SET code = $code$
const state = vars.newsfeedState || {}
const post = state.currentPost || {}
const text = String(input.text || state.commentText || '')
if (input.pasted !== true || state.remainingComment <= 0) return { commented: false, text }
const selectors = { submit: await helpers.element('fb_newsfeed_comment_submit') }
const actionGapBefore = helpers.randomBetween(Number(state.actionGapSeconds || 4) * 600, Number(state.actionGapSeconds || 4) * 1400)
const actionGapAfter = helpers.randomBetween(Number(state.actionGapSeconds || 4) * 600, Number(state.actionGapSeconds || 4) * 1400)
const beforeDelay = Number(state.stepDelayMs || 1000) + 2000 + actionGapBefore
const afterDelay = Number(state.stepDelayMs || 1000) + 2000 + actionGapAfter
const clicked = await page.evaluate(`
  const selector = __args[0];
  const beforeDelay = Number(__args[1] || 0);
  const afterDelay = Number(__args[2] || 0);
  function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
  function xpathOne(xpath, root) {
    const result = document.evaluate(xpath, root || document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
    return result.singleNodeValue || null;
  }
  function clickSynthetic(el) {
    const init = { bubbles: true, cancelable: true, view: window };
    try { el.dispatchEvent(new PointerEvent('pointerdown', Object.assign({}, init, { pointerId: 1, pointerType: 'mouse' }))); } catch {}
    try { el.dispatchEvent(new MouseEvent('mousedown', init)); } catch {}
    try { el.dispatchEvent(new PointerEvent('pointerup', Object.assign({}, init, { pointerId: 1, pointerType: 'mouse' }))); } catch {}
    try { el.dispatchEvent(new MouseEvent('mouseup', init)); } catch {}
    el.click();
  }
  try {
    await delay(beforeDelay);
    const btn = xpathOne(selector, document);
    if (!btn) return false;
    clickSynthetic(btn);
    await delay(afterDelay);
    return true;
  } catch {
    return false;
  }
`, selectors.submit, beforeDelay, afterDelay).catch(() => false)

if (!clicked) {
  helpers.log('Bỏ qua submit comment newsfeed: không tìm thấy hoặc không click được nút gửi')
  return { commented: false, text }
}
state.remainingComment = Math.max(0, Number(state.remainingComment || 0) - 1)
state.commentDone = Number(state.commentDone || 0) + 1
helpers.log('Đã comment bài newsfeed của ' + (post.targetName || 'người đăng'))
return {
  commented: true,
  text,
  targetName: post.targetName || '',
  targetUid: post.targetUid || '',
  postContent: post.postContent || ''
}
$code$,
updated_at = now()
WHERE name = 'fb_newsfeed_comment_submit';

UPDATE public.auto_blocks
SET code = $code$
const state = vars.newsfeedState || {}
const elapsedMs = Date.now() - Number(state.startedAt || Date.now())
state.shouldContinue = elapsedMs < Number(state.maxMs || 0) && (Number(state.remainingLike || 0) > 0 || Number(state.remainingComment || 0) > 0)
if (state.shouldContinue === true && Number(state.cursor || 0) >= Number(state.lastCount || 0)) {
  const postSelector = await helpers.element('fb_newsfeed_post')
  const total = await page.evaluate(`
    const selector = __args[0];
    const loadPostDelayMs = Number(__args[1] || 5000);
    function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
    function xpathAll(xpath, root) {
      const out = [];
      const result = document.evaluate(xpath, root || document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      for (let i = 0; i < result.snapshotLength; i++) out.push(result.snapshotItem(i));
      return out.filter(Boolean);
    }
    try {
      const posts = xpathAll(selector, document);
      if (posts.length > 0) {
        posts[posts.length - 1].scrollIntoView(true);
        await delay(loadPostDelayMs);
      }
      return xpathAll(selector, document).length;
    } catch {
      return 0;
    }
  `, postSelector, state.loadPostDelayMs).catch(() => 0)
  state.lastCount = Number(total || state.lastCount || 0)
}
return {
  shouldContinue: state.shouldContinue,
  elapsedMs,
  remainingLike: Number(state.remainingLike || 0),
  remainingComment: Number(state.remainingComment || 0),
  likeDone: Number(state.likeDone || 0),
  commentDone: Number(state.commentDone || 0)
}
$code$,
updated_at = now()
WHERE name = 'fb_newsfeed_advance_cursor';

COMMIT;
