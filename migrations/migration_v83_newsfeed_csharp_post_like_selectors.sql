-- Align newsfeed post root and like selector with the current Facebook DOM shape.
-- Keep action lookup scoped to the current post element, matching C# postEle.FindElement.

BEGIN;

INSERT INTO public.auto_elements (name, xpath, description, category, is_builtin, staff_id, organization_id, updated_at)
VALUES
  ('fb_newsfeed_post', $$//*[@class='x1lliihq']//*[@class='x1lliihq']$$, 'Newsfeed post root.', 'facebook', true, NULL, NULL, now()),
  ('fb_newsfeed_like_button', $$.//*[@role='button' and .='Thích']$$, 'Like button inside a post.', 'facebook', true, NULL, NULL, now())
ON CONFLICT (name) DO UPDATE SET
  xpath = EXCLUDED.xpath,
  description = EXCLUDED.description,
  category = EXCLUDED.category,
  is_builtin = true,
  updated_at = now();

UPDATE public.auto_blocks
SET code = $code$
const state = vars.newsfeedState || {}
if (state.shouldContinue !== true) return { hasPost: false, skipped: true }

const selectors = {
  post: await helpers.element('fb_newsfeed_post')
}

const result = await page.evaluate(`
  const selector = __args[0];
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

  let batchId = batchIdArg;
  let batchIndex = batchIndexArg;
  let batchSize = batchSizeArg;
  let batchRawCount = Number(__args[6] || 0);
  let batchStartCursor = cursor;

  if (!batchId || batchIndex >= batchSize) {
    clearBatch();
    clearCurrent();
    let posts = xpathAll(selector, document);
    if (posts.length === 0) {
      return { hasPost: false, total: 0, postIndex: cursor + 1, nextCursor: cursor, batchId: '', batchIndex: 0, batchSize: 0, batchRawCount: 0, batchStartCursor: cursor };
    }

    if (cursor >= posts.length) {
      posts[posts.length - 1].scrollIntoView(true);
      await delay(loadPostDelayMs);
      posts = xpathAll(selector, document);
    }

    if (cursor >= posts.length) {
      return { hasPost: false, total: posts.length, postIndex: cursor + 1, nextCursor: cursor, batchId: '', batchIndex: 0, batchSize: 0, batchRawCount: posts.length, batchStartCursor: cursor };
    }

    batchId = makeBatchId();
    batchIndex = 0;
    batchStartCursor = cursor;
    batchRawCount = posts.length;
    batchSize = Math.max(0, posts.length - cursor);

    for (let i = cursor; i < posts.length; i++) {
      const post = posts[i];
      post.setAttribute('data-aka-newsfeed-batch-id', batchId);
      post.setAttribute('data-aka-newsfeed-batch-index', String(i - cursor));
      post.setAttribute('data-aka-newsfeed-batch-raw-index', String(i));
    }
  }

  const post = findBatchPost(batchId, batchIndex);
  const postIndex = batchStartCursor + batchIndex + 1;
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
    const likeBtn = xpathOne(selector, post);
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
    const btn = xpathOne(selector, post);
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
    const root = dialog || currentPost;

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

COMMIT;
