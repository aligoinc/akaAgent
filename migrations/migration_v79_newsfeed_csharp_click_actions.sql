-- Align newsfeed action clicks with C# ClickByJS and keep current post recoverable by snapshot tag.

BEGIN;

UPDATE public.auto_blocks
SET code = replace(
  code,
  $$state.newsfeedBatchStartCursor = Number(result.batchStartCursor ?? state.cursor ?? 0)
state.lastCount = Number(result.total || state.lastCount || 0)$$,
  $$state.newsfeedBatchStartCursor = Number(result.batchStartCursor ?? state.cursor ?? 0)
state.newsfeedCurrentBatchId = result.hasPost === true ? String(result.batchId || '') : ''
state.newsfeedCurrentBatchIndex = result.hasPost === true ? Math.max(0, Number(result.batchIndex || 1) - 1) : -1
state.lastCount = Number(result.total || state.lastCount || 0)$$
),
updated_at = now()
WHERE name = 'fb_newsfeed_select_next_post'
  AND code NOT LIKE '%newsfeedCurrentBatchId%';

UPDATE public.auto_blocks
SET code = replace(
  code,
  $$state.newsfeedBatchStartCursor = state.cursor
  }
}$$,
  $$state.newsfeedBatchStartCursor = state.cursor
    state.newsfeedCurrentBatchId = ''
    state.newsfeedCurrentBatchIndex = -1
  }
}$$
),
updated_at = now()
WHERE name = 'fb_newsfeed_advance_cursor'
  AND code NOT LIKE '%newsfeedCurrentBatchId%';

UPDATE public.auto_blocks
SET code = $code$
const state = vars.newsfeedState || {}
const post = state.currentPost || {}
const shouldRunLike = input.shouldLike === true || input.conditionResult === true || input.branch === 'true'
if (shouldRunLike !== true || state.remainingLike <= 0) return { liked: false }
const selectors = { like: await helpers.element('fb_newsfeed_like_button') }
const actionGap = helpers.randomBetween(Number(state.actionGapSeconds || 4) * 600, Number(state.actionGapSeconds || 4) * 1400)

const result = await page.evaluate(`
  const selector = __args[0];
  const stepDelayMs = Number(__args[1] || 1000);
  const actionGap = Number(__args[2] || 0);
  const batchId = String(__args[3] || '');
  const batchIndex = Number(__args[4]);
  function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
  function xpathOne(xpath, root) {
    const result = document.evaluate(xpath, root || document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
    return result.singleNodeValue || null;
  }
  function findActionRoot(start, selector) {
    let node = start;
    for (let i = 0; node && i < 8; i++) {
      if (xpathOne(selector, node)) return node;
      if (node === document.body || (node.getAttribute && node.getAttribute('role') === 'feed')) break;
      node = node.parentElement;
    }
    return start;
  }
  function findCurrentPost() {
    const current = document.querySelector('[data-aka-newsfeed-current="1"]');
    if (current) return current;
    if (batchId && batchIndex >= 0) {
      return document.querySelector('[data-aka-newsfeed-batch-id="' + batchId + '"][data-aka-newsfeed-batch-index="' + batchIndex + '"]');
    }
    return null;
  }
  try {
    const post = findCurrentPost();
    if (!post) return { clicked: false, skipReason: 'Không tìm thấy post newsfeed hiện tại' };
    const root = findActionRoot(post, selector);
    const likeBtn = xpathOne(selector, root);
    if (!likeBtn) return { clicked: false, skipReason: 'Không tìm thấy nút Thích trong post hiện tại' };
    likeBtn.scrollIntoView(false);
    await delay(stepDelayMs);
    likeBtn.click();
    await delay(stepDelayMs + actionGap);
    return { clicked: true };
  } catch (e) {
    return { clicked: false, skipReason: e && e.message ? e.message : String(e) };
  }
`, selectors.like, state.stepDelayMs, actionGap, state.newsfeedCurrentBatchId || '', Number(state.newsfeedCurrentBatchIndex ?? -1)).catch(e => ({
  clicked: false,
  skipReason: e && e.message ? e.message : String(e)
}))

if (result.clicked !== true) {
  const skipReason = result.skipReason || 'không tìm thấy hoặc không click được nút Thích'
  helpers.log('Bỏ qua like newsfeed: ' + skipReason)
  return { liked: false, skipReason }
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
  const batchId = String(__args[3] || '');
  const batchIndex = Number(__args[4]);
  function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
  function xpathOne(xpath, root) {
    const result = document.evaluate(xpath, root || document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
    return result.singleNodeValue || null;
  }
  function findActionRoot(start, selector) {
    let node = start;
    for (let i = 0; node && i < 8; i++) {
      if (xpathOne(selector, node)) return node;
      if (node === document.body || (node.getAttribute && node.getAttribute('role') === 'feed')) break;
      node = node.parentElement;
    }
    return start;
  }
  function findCurrentPost() {
    const current = document.querySelector('[data-aka-newsfeed-current="1"]');
    if (current) return current;
    if (batchId && batchIndex >= 0) {
      return document.querySelector('[data-aka-newsfeed-batch-id="' + batchId + '"][data-aka-newsfeed-batch-index="' + batchIndex + '"]');
    }
    return null;
  }
  try {
    const post = findCurrentPost();
    if (!post) return { opened: false, skipReason: 'Không tìm thấy post newsfeed hiện tại' };
    const root = findActionRoot(post, selector);
    const btn = xpathOne(selector, root);
    if (!btn) return { opened: false, skipReason: 'Không tìm thấy nút Bình luận' };
    btn.click();
    await delay(delayMs);
    return { opened: true };
  } catch (e) {
    return { opened: false, skipReason: e && e.message ? e.message : String(e) };
  }
`, selectors.commentButton, state.stepDelayMs, actionGap, state.newsfeedCurrentBatchId || '', Number(state.newsfeedCurrentBatchIndex ?? -1))
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
  dialog: await helpers.element('fb_newsfeed_dialog'),
  dialogInput: await helpers.element('fb_newsfeed_dialog_comment_input'),
  postInput: await helpers.element('fb_newsfeed_comment_input'),
  closeDialog: await helpers.element('fb_newsfeed_close_dialog')
}
const result = await page.evaluate(`
  const selectors = __args[0];
  const stepDelayMs = Number(__args[1] || 1000);
  const batchId = String(__args[2] || '');
  const batchIndex = Number(__args[3]);
  function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
  function xpathOne(xpath, root) {
    const result = document.evaluate(xpath, root || document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
    return result.singleNodeValue || null;
  }
  function findActionRoot(start, selector) {
    let node = start;
    for (let i = 0; node && i < 8; i++) {
      if (xpathOne(selector, node)) return node;
      if (node === document.body || (node.getAttribute && node.getAttribute('role') === 'feed')) break;
      node = node.parentElement;
    }
    return start;
  }
  function findCurrentPost() {
    const current = document.querySelector('[data-aka-newsfeed-current="1"]');
    if (current) return current;
    if (batchId && batchIndex >= 0) {
      return document.querySelector('[data-aka-newsfeed-batch-id="' + batchId + '"][data-aka-newsfeed-batch-index="' + batchIndex + '"]');
    }
    return null;
  }
  try {
    const currentPost = findCurrentPost();
    if (!currentPost) return { focused: false, skipReason: 'Không tìm thấy post newsfeed hiện tại' };

    const dialog = xpathOne(selectors.dialog, document);
    const postRoot = findActionRoot(currentPost, selectors.commentButton);
    const root = dialog || postRoot;

    const cmtBtn = xpathOne(selectors.commentButton, root);
    if (cmtBtn) {
      cmtBtn.click();
      await delay(stepDelayMs + 500);
    }

    let isDialog = true;
    let input = xpathOne(selectors.dialogInput, document);
    if (!input) {
      isDialog = false;
      input = xpathOne(selectors.postInput, root);
    }
    if (!input) return { focused: false, skipReason: 'Không tìm thấy ô nhập comment' };

    try { document.querySelectorAll('[data-aka-newsfeed-comment-input="1"]').forEach(el => el.removeAttribute('data-aka-newsfeed-comment-input')); } catch {}
    input.setAttribute('data-aka-newsfeed-comment-input', '1');
    input.scrollIntoView(false);
    window.scrollBy(0, 200);
    try { input.click(); } catch {}
    await delay(stepDelayMs);
    if (!isDialog) {
      try {
        const closeBtn = xpathOne(selectors.closeDialog, document);
        if (closeBtn) {
          closeBtn.click();
          await delay(stepDelayMs);
        }
      } catch {}
    }
    return { focused: true, isDialog };
  } catch (e) {
    return { focused: false, skipReason: e && e.message ? e.message : String(e) };
  }
`, selectors, state.stepDelayMs, state.newsfeedCurrentBatchId || '', Number(state.newsfeedCurrentBatchIndex ?? -1))
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
const post = state.currentPost || {}
const text = String(input.text || state.commentText || '')
if (input.pasted !== true || state.remainingComment <= 0) return { commented: false, text }
const selectors = { submit: await helpers.element('fb_newsfeed_comment_submit') }
const actionGapBefore = helpers.randomBetween(Number(state.actionGapSeconds || 4) * 600, Number(state.actionGapSeconds || 4) * 1400)
const actionGapAfter = helpers.randomBetween(Number(state.actionGapSeconds || 4) * 600, Number(state.actionGapSeconds || 4) * 1400)
const beforeDelay = Number(state.stepDelayMs || 1000) + 2000 + actionGapBefore
const afterDelay = Number(state.stepDelayMs || 1000) + 2000 + actionGapAfter
const result = await page.evaluate(`
  const selector = __args[0];
  const beforeDelay = Number(__args[1] || 0);
  const afterDelay = Number(__args[2] || 0);
  function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
  function xpathOne(xpath, root) {
    const result = document.evaluate(xpath, root || document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
    return result.singleNodeValue || null;
  }
  try {
    await delay(beforeDelay);
    const btn = xpathOne(selector, document);
    if (!btn) return { clicked: false, skipReason: 'Không tìm thấy nút gửi comment' };
    btn.click();
    await delay(afterDelay);
    return { clicked: true };
  } catch (e) {
    return { clicked: false, skipReason: e && e.message ? e.message : String(e) };
  }
`, selectors.submit, beforeDelay, afterDelay).catch(e => ({
  clicked: false,
  skipReason: e && e.message ? e.message : String(e)
}))

if (result.clicked !== true) {
  const skipReason = result.skipReason || 'không tìm thấy hoặc không click được nút gửi'
  helpers.log('Bỏ qua submit comment newsfeed: ' + skipReason)
  return { commented: false, text, skipReason }
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

COMMIT;
