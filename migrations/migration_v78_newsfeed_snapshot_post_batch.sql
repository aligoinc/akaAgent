-- Keep Facebook newsfeed like/comment anchored to the same post root as C# Selenium snapshot iteration.
-- Selectors stay unchanged; only the per-batch root handling is updated.

BEGIN;

UPDATE public.auto_blocks
SET code = $code$
const state = vars.newsfeedState || {}
if (state.shouldContinue !== true) return { hasPost: false, skipped: true }

const selectors = {
  post: await helpers.element('fb_newsfeed_post'),
  author: await helpers.element('fb_newsfeed_post_author_link'),
  content: await helpers.element('fb_newsfeed_post_content'),
  like: await helpers.element('fb_newsfeed_like_button'),
  commentButton: await helpers.element('fb_newsfeed_comment_button')
}

const result = await page.evaluate(`
  const selectors = __args[0];
  const cursor = Number(__args[1] || 0);
  const batchIdArg = String(__args[2] || '');
  const batchIndexArg = Number(__args[3] || 0);
  const batchSizeArg = Number(__args[4] || 0);
  const loadPostDelayMs = Number(__args[5] || 5000);

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  function xpathAll(xpath, root) {
    const out = [];
    const result = document.evaluate(xpath, root || document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    for (let i = 0; i < result.snapshotLength; i++) out.push(result.snapshotItem(i));
    return out.filter(Boolean);
  }
  function xpathOne(xpath, root) {
    const result = document.evaluate(xpath, root || document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
    return result.singleNodeValue || null;
  }
  function clearCurrent() {
    try {
      document.querySelectorAll('[data-aka-newsfeed-current="1"]').forEach(el => el.removeAttribute('data-aka-newsfeed-current'));
    } catch {}
  }
  function clearBatch() {
    try {
      document.querySelectorAll('[data-aka-newsfeed-batch-id]').forEach(el => {
        el.removeAttribute('data-aka-newsfeed-batch-id');
        el.removeAttribute('data-aka-newsfeed-batch-index');
        el.removeAttribute('data-aka-newsfeed-batch-raw-index');
      });
    } catch {}
  }
  function makeBatchId() {
    return 'batch-' + Date.now() + '-' + Math.floor(Math.random() * 1000000);
  }
  function findBatchPost(batchId, batchIndex) {
    return document.querySelector('[data-aka-newsfeed-batch-id="' + batchId + '"][data-aka-newsfeed-batch-index="' + batchIndex + '"]');
  }
  function normalizePostRoot(rawPost) {
    let node = rawPost;
    for (let i = 0; node && i < 10; i++) {
      if (node === document.body || node === document.documentElement) break;
      if (node.getAttribute && node.getAttribute('role') === 'feed') break;
      const hasAuthor = !!xpathOne(selectors.author, node);
      const hasContent = !!xpathOne(selectors.content, node);
      const hasAction = !!xpathOne(selectors.like, node) || !!xpathOne(selectors.commentButton, node);
      if (hasAuthor && hasContent && hasAction) return node;
      node = node.parentElement;
    }
    return rawPost;
  }
  function buildBatchPosts(rawPosts, startCursor) {
    const batchPosts = [];
    function addRoot(root, rawIndex) {
      for (let i = 0; i < batchPosts.length; i++) {
        const existing = batchPosts[i].root;
        if (existing === root || existing.contains(root)) return;
        if (root.contains(existing)) {
          batchPosts[i] = { root, rawIndex: Math.min(batchPosts[i].rawIndex, rawIndex) };
          return;
        }
      }
      batchPosts.push({ root, rawIndex });
    }
    for (let i = startCursor; i < rawPosts.length; i++) {
      const root = normalizePostRoot(rawPosts[i]);
      if (!root) continue;
      addRoot(root, i);
    }
    return batchPosts;
  }

  let batchId = batchIdArg;
  let batchIndex = batchIndexArg;
  let batchSize = batchSizeArg;
  let batchRawCount = Number(__args[6] || 0);
  let batchStartCursor = cursor;

  if (!batchId || batchIndex >= batchSize) {
    clearBatch();
    clearCurrent();
    let rawPosts = xpathAll(selectors.post, document);
    if (rawPosts.length === 0) {
      return { hasPost: false, total: 0, postIndex: cursor + 1, nextCursor: cursor, batchId: '', batchIndex: 0, batchSize: 0, batchRawCount: 0, batchStartCursor: cursor };
    }

    if (cursor >= rawPosts.length) {
      rawPosts[rawPosts.length - 1].scrollIntoView(true);
      await delay(loadPostDelayMs);
      rawPosts = xpathAll(selectors.post, document);
    }

    if (cursor >= rawPosts.length) {
      return { hasPost: false, total: rawPosts.length, postIndex: cursor + 1, nextCursor: cursor, batchId: '', batchIndex: 0, batchSize: 0, batchRawCount: rawPosts.length, batchStartCursor: cursor };
    }

    const batchPosts = buildBatchPosts(rawPosts, cursor);
    if (batchPosts.length === 0) {
      return { hasPost: false, total: rawPosts.length, postIndex: cursor + 1, nextCursor: cursor, batchId: '', batchIndex: 0, batchSize: 0, batchRawCount: rawPosts.length, batchStartCursor: cursor };
    }

    batchId = makeBatchId();
    batchIndex = 0;
    batchStartCursor = cursor;
    batchRawCount = rawPosts.length;
    batchSize = batchPosts.length;

    for (let i = 0; i < batchPosts.length; i++) {
      const post = batchPosts[i].root;
      post.setAttribute('data-aka-newsfeed-batch-id', batchId);
      post.setAttribute('data-aka-newsfeed-batch-index', String(i));
      post.setAttribute('data-aka-newsfeed-batch-raw-index', String(batchPosts[i].rawIndex));
    }
  }

  const post = findBatchPost(batchId, batchIndex);
  const rawIndex = post ? Number(post.getAttribute('data-aka-newsfeed-batch-raw-index') || (batchStartCursor + batchIndex)) : (batchStartCursor + batchIndex);
  const postIndex = rawIndex + 1;
  const nextBatchIndex = batchIndex + 1;
  if (!post) {
    clearCurrent();
    return {
      hasPost: true,
      readablePost: false,
      skipped: true,
      skipReason: 'Không tìm thấy post newsfeed trong batch hiện tại',
      total: batchRawCount,
      postIndex,
      nextCursor: cursor,
      batchId,
      batchIndex: nextBatchIndex,
      batchSize,
      batchRawCount,
      batchStartCursor
    };
  }
  clearCurrent();
  post.setAttribute('data-aka-newsfeed-current', '1');
  post.scrollIntoView(false);
  return {
    hasPost: true,
    total: batchRawCount,
    postIndex,
    nextCursor: cursor,
    batchId,
    batchIndex: nextBatchIndex,
    batchSize,
    batchRawCount,
    batchStartCursor
  };
`, selectors.post, state.cursor, state.newsfeedBatchId || '', state.newsfeedBatchIndex || 0, state.newsfeedBatchSize || 0, state.loadPostDelayMs, state.newsfeedBatchRawCount || 0).catch(() => ({
  hasPost: false,
  total: Number(state.lastCount || 0),
  postIndex: Number(state.cursor || 0) + 1,
  nextCursor: Number(state.cursor || 0),
  batchId: '',
  batchIndex: 0,
  batchSize: 0,
  batchRawCount: Number(state.lastCount || 0),
  batchStartCursor: Number(state.cursor || 0)
}))

state.newsfeedBatchId = String(result.batchId || '')
state.newsfeedBatchIndex = Number(result.batchIndex || 0)
state.newsfeedBatchSize = Number(result.batchSize || 0)
state.newsfeedBatchRawCount = Number(result.batchRawCount || result.total || 0)
state.newsfeedBatchStartCursor = Number(result.batchStartCursor ?? state.cursor ?? 0)
state.newsfeedCurrentBatchId = result.hasPost === true ? String(result.batchId || '') : ''
state.newsfeedCurrentBatchIndex = result.hasPost === true ? Math.max(0, Number(result.batchIndex || 1) - 1) : -1
state.lastCount = Number(result.total || state.lastCount || 0)
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
const elapsedMs = Date.now() - Number(state.startedAt || Date.now())
state.shouldContinue = elapsedMs < Number(state.maxMs || 0) && (Number(state.remainingLike || 0) > 0 || Number(state.remainingComment || 0) > 0)
if (state.shouldContinue === true) {
  const batchIndex = Number(state.newsfeedBatchIndex || 0)
  const batchSize = Number(state.newsfeedBatchSize || 0)
  if (batchSize > 0 && batchIndex >= batchSize) {
    const result = await page.evaluate(`
      const batchId = String(__args[0] || '');
      const batchSize = Number(__args[1] || 0);
      const batchRawCount = Number(__args[2] || 0);
      const loadPostDelayMs = Number(__args[3] || 5000);
      function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
      function clearBatch() {
        try {
          document.querySelectorAll('[data-aka-newsfeed-batch-id]').forEach(el => {
            el.removeAttribute('data-aka-newsfeed-batch-id');
            el.removeAttribute('data-aka-newsfeed-batch-index');
            el.removeAttribute('data-aka-newsfeed-batch-raw-index');
          });
        } catch {}
      }
      try {
        const lastIndex = Math.max(0, batchSize - 1);
        const lastPost = document.querySelector('[data-aka-newsfeed-batch-id="' + batchId + '"][data-aka-newsfeed-batch-index="' + lastIndex + '"]');
        if (lastPost) {
          lastPost.scrollIntoView(true);
          await delay(loadPostDelayMs);
        }
        clearBatch();
        return { cursor: batchRawCount, batchCleared: true };
      } catch {
        clearBatch();
        return { cursor: batchRawCount, batchCleared: true };
      }
    `, state.newsfeedBatchId || '', batchSize, state.newsfeedBatchRawCount || state.lastCount || state.cursor || 0, state.loadPostDelayMs).catch(() => ({
      cursor: Number(state.newsfeedBatchRawCount || state.lastCount || state.cursor || 0),
      batchCleared: true
    }))

    state.cursor = Number(result.cursor || state.cursor || 0)
    state.newsfeedBatchId = ''
    state.newsfeedBatchIndex = 0
    state.newsfeedBatchSize = 0
    state.newsfeedBatchRawCount = 0
    state.newsfeedBatchStartCursor = state.cursor
    state.newsfeedCurrentBatchId = ''
    state.newsfeedCurrentBatchIndex = -1
  }
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
