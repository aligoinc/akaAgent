-- Facebook newsfeed interaction campaign.
-- DOM selectors and operation order follow akaBizAuto Newsfeed_Fb C# flow.

BEGIN;

INSERT INTO public.auto_elements (name, xpath, description, category, is_builtin, staff_id, organization_id, updated_at)
VALUES
  ('fb_newsfeed_post', $$//*[@class='x1lliihq']$$, 'Newsfeed post root.', 'facebook', true, NULL, NULL, now()),
  ('fb_newsfeed_post_author_link', $$.//h2[contains(@class,'html-h2')]//a|.//h3[contains(@class,'html-h3')]//a|.//h4[contains(@class,'html-h4')]//a$$, 'Author link inside a newsfeed post.', 'facebook', true, NULL, NULL, now()),
  ('fb_newsfeed_see_more', $$.//*[@role='button' and .='Xem thêm']$$, 'See more button inside a post.', 'facebook', true, NULL, NULL, now()),
  ('fb_newsfeed_post_content', $$.//*[@dir='auto']//*[@data-ad-rendering-role='message' or @data-ad-rendering-role='story_message' or @data-ad-comet-preview='message' or @data-ad-preview='message' or @class='xh8yej3' or @id]$$, 'Post message content.', 'facebook', true, NULL, NULL, now()),
  ('fb_newsfeed_like_button', $$.//*[@role='button' and @aria-label='Thích']$$, 'Like button inside a post.', 'facebook', true, NULL, NULL, now()),
  ('fb_newsfeed_comment_button', $$.//*[@role='button' and .='Bình luận']$$, 'Comment button inside a post.', 'facebook', true, NULL, NULL, now()),
  ('fb_newsfeed_comment_input', $$.//*[@role='textbox' and (contains(@aria-label,'Bình luận') or contains(@aria-label,'bình luận') or contains(@aria-label,'Comment') or contains(@aria-label,'comment') or contains(@aria-label,'Trả lời') or contains(@aria-label,'trả lời'))]$$, 'Comment input inside a post.', 'facebook', true, NULL, NULL, now()),
  ('fb_newsfeed_dialog_comment_input', $$//*[@role='dialog']//*[@role='textbox' and (contains(@aria-label,'Bình luận') or contains(@aria-label,'bình luận') or contains(@aria-label,'Comment') or contains(@aria-label,'comment') or contains(@aria-label,'Trả lời') or contains(@aria-label,'trả lời'))]$$, 'Comment input inside dialog.', 'facebook', true, NULL, NULL, now()),
  ('fb_newsfeed_comment_submit', $$.//*[@role='button' and (@aria-label='Bình luận' or @aria-label='Post comment' or @aria-label='Đăng bình luận') and @tabindex=0]$$, 'Comment submit button.', 'facebook', true, NULL, NULL, now()),
  ('fb_newsfeed_dialog', $$//*[@role='dialog' and not(@aria-label='Thông báo') and not(@aria-label='Messenger')]$$, 'Facebook dialog.', 'facebook', true, NULL, NULL, now()),
  ('fb_newsfeed_close_dialog', $$//*[@role='dialog']//*[@role='button' and @aria-label='Đóng']|//*[@role='button' and .='Dùng Trang']$$, 'Close Facebook dialog.', 'facebook', true, NULL, NULL, now())
ON CONFLICT (name) DO UPDATE SET
  xpath = EXCLUDED.xpath,
  description = EXCLUDED.description,
  category = EXCLUDED.category,
  is_builtin = true,
  updated_at = now();

INSERT INTO public.auto_blocks (
  name, description, icon, category, kind, system_type, code,
  config_schema, output_schema, default_config, is_builtin, staff_id, organization_id, updated_at
)
VALUES
(
  'fb_newsfeed_init_state',
  'Khởi tạo state cho chiến dịch lướt newsfeed.',
  'ListChecks',
  'facebook',
  'js',
  NULL,
$block$
const timeMinutes = Math.max(1, Math.floor(Number(vars.newsfeedTimeMinutes || input.newsfeedTimeMinutes || 20)))
const likeKind = String(vars.newsfeedLikeKind || input.newsfeedLikeKind || '').trim()
const commentKind = String(vars.newsfeedCommentKind || input.newsfeedCommentKind || '').trim()
const likeLimit = likeKind ? Math.max(0, Math.floor(Number(vars.newsfeedLikeLimit ?? input.newsfeedLikeLimit ?? 10))) : 0
const commentLimit = commentKind ? Math.max(0, Math.floor(Number(vars.newsfeedCommentLimit ?? input.newsfeedCommentLimit ?? 10))) : 0
const allowLike = vars.allowNewsfeedLike !== false
const allowComment = vars.allowNewsfeedComment !== false
const remainingLike = allowLike ? likeLimit : 0
const remainingComment = allowComment ? commentLimit : 0

vars.newsfeedState = {
  startedAt: Date.now(),
  maxMs: timeMinutes * 60000,
  cursor: 0,
  lastCount: 0,
  stepDelayMs: 1000,
  loadPostDelayMs: 5000,
  actionGapSeconds: 4,
  tcRead: 3,
  timeRead100WordsMin: 20,
  tcWrite: 3,
  timeWrite100WordsMin: 90,
  likeKind,
  commentKind,
  commentContent: String(vars.newsfeedCommentContent || input.newsfeedCommentContent || ''),
  commentUseAI: vars.newsfeedCommentUseAI === true || input.newsfeedCommentUseAI === true,
  remainingLike,
  remainingComment,
  likeDone: 0,
  commentDone: 0,
  shouldContinue: remainingLike > 0 || remainingComment > 0
}

helpers.log('Bắt đầu lướt newsfeed trong ' + timeMinutes + ' phút')
return {
  ok: true,
  remainingLike,
  remainingComment,
  allowLike,
  allowComment
}
$block$,
  '[]'::jsonb,
  '[{"name":"remainingLike","type":"number","label":"Like còn lại"},{"name":"remainingComment","type":"number","label":"Comment còn lại"}]'::jsonb,
  '{}'::jsonb,
  true,
  NULL,
  NULL,
  now()
),
(
  'fb_newsfeed_select_next_post',
  'Chọn post newsfeed tiếp theo theo cursor, dùng raw XPath FindElements tương đương C#.',
  'MousePointer',
  'facebook',
  'js',
  NULL,
$block$
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
$block$,
  '[]'::jsonb,
  '[{"name":"hasPost","type":"boolean","label":"Có post"},{"name":"postIndex","type":"number","label":"Vị trí post"}]'::jsonb,
  '{}'::jsonb,
  true,
  NULL,
  NULL,
  now()
),
(
  'fb_newsfeed_read_post',
  'Đọc tác giả, UID và nội dung từ post newsfeed hiện tại theo root scope C#.',
  'FileText',
  'facebook',
  'js',
  NULL,
$block$
if (input.hasPost !== true) return { hasPost: false }
const state = vars.newsfeedState || {}
const selectors = {
  author: await helpers.element('fb_newsfeed_post_author_link'),
  seeMore: await helpers.element('fb_newsfeed_see_more'),
  content: await helpers.element('fb_newsfeed_post_content')
}

const result = await page.evaluate(`
  const selectors = __args[0];
  const stepDelayMs = Number(__args[1] || 1000);

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  function xpathOne(xpath, root) {
    const result = document.evaluate(xpath, root || document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
    return result.singleNodeValue || null;
  }
  function extractUid(href) {
    const raw = String(href || '').trim();
    try {
      const url = new URL(raw, 'https://www.facebook.com');
      const id = url.searchParams.get('id');
      if (id) return id;
      const parts = url.pathname.split('/').filter(Boolean);
      return parts.length > 0 ? parts[parts.length - 1] : raw;
    } catch {
      return raw;
    }
  }

  try {
    const post = document.querySelector('[data-aka-newsfeed-current="1"]');
    if (!post) return { hasPost: true, readablePost: false, skipReason: 'Không tìm thấy post newsfeed hiện tại' };

    const author = xpathOne(selectors.author, post);
    if (!author) return { hasPost: true, readablePost: false, skipReason: 'Không tìm thấy tác giả post newsfeed' };

    const seeMore = xpathOne(selectors.seeMore, post);
    if (seeMore) {
      seeMore.click();
      await delay(stepDelayMs);
    }

    const contentEl = xpathOne(selectors.content, post);
    if (!contentEl) return { hasPost: true, readablePost: false, skipReason: 'Không tìm thấy nội dung post newsfeed' };

    const targetName = (author.innerText || author.textContent || '').trim();
    const targetHref = author.getAttribute('href') || '';
    const postContent = (contentEl.innerText || contentEl.textContent || '').trim();
    return {
      hasPost: true,
      readablePost: true,
      targetName,
      targetUid: extractUid(targetHref),
      targetHref,
      postContent
    };
  } catch (e) {
    return { hasPost: true, readablePost: false, skipReason: e && e.message ? e.message : String(e) };
  }
`, selectors, state.stepDelayMs)

if (result.readablePost !== true) {
  state.currentPost = null
  helpers.log('Bỏ qua post newsfeed: ' + (result.skipReason || 'không đọc được post'))
  return result
}

state.currentPost = result
return result
$block$,
  '[]'::jsonb,
  '[{"name":"readablePost","type":"boolean","label":"Đọc được post"},{"name":"targetName","type":"string","label":"Tên người đăng"},{"name":"targetUid","type":"string","label":"UID"},{"name":"postContent","type":"string","label":"Nội dung"}]'::jsonb,
  '{}'::jsonb,
  true,
  NULL,
  NULL,
  now()
),
(
  'fb_newsfeed_wait_read',
  'Sleep đọc nội dung theo công thức CalcTimeSleepReadContent của C#.',
  'Clock',
  'facebook',
  'js',
  NULL,
$block$
if (input.hasPost !== true || input.readablePost !== true) return input
const state = vars.newsfeedState || {}
const content = String(input.postContent || state.currentPost?.postContent || '')
const wordCount = content ? content.split(' ').filter(Boolean).length : 0
const tc = helpers.randomBetween(1, Number(state.tcRead || 3))
const per100 = helpers.randomBetween(Number(state.timeRead100WordsMin || 20), Number(state.timeRead100WordsMin || 20) * 2)
const sleepMs = (tc + Math.floor(per100 * wordCount / 100)) * 1000
await helpers.sleep(sleepMs, signal)
return { ...input, readSleepMs: sleepMs }
$block$,
  '[]'::jsonb,
  '[{"name":"readSleepMs","type":"number","label":"Thời gian đọc"}]'::jsonb,
  '{}'::jsonb,
  true,
  NULL,
  NULL,
  now()
),
(
  'fb_newsfeed_check_like',
  'Dùng AI check post có phù hợp điều kiện like newsfeed không.',
  'Sparkles',
  'facebook',
  'js',
  NULL,
$block$
const state = vars.newsfeedState || {}
const post = state.currentPost || {}
if (input.hasPost !== true || input.readablePost !== true || state.remainingLike <= 0) return { shouldLike: false }
if (!state.likeKind) {
  state.remainingLike = 0
  return { shouldLike: false }
}
const postContent = String(post.postContent || '').trim()
if (!postContent) return { shouldLike: false }

try {
  const question = 'Bài viết sau có tính chất "' + state.likeKind + '" không? Chỉ trả lời có hoặc không.\\n\\n' + postContent
  const response = await page.apiCall({
    url: 'https://api.akaapp.vn/api/AI/chat',
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: { question, source: 'aka_agent' },
    timeout: 120000
  })
  if (!response || response.status < 200 || response.status >= 300) throw new Error('AI lỗi')
  const payload = response.data || {}
  const data = typeof payload === 'object' ? (payload.data ?? payload.Data ?? payload.message ?? payload.Message ?? '') : payload
  const text = String(data || '').toLowerCase()
  const isNegative = text.includes('không') || text.includes('khong') || text.includes('no') || text.includes('false') || text.includes('không phù hợp') || text.includes('khong phu hop')
  const ok = !isNegative && (text.includes('có') || text.includes('yes') || text.includes('true') || text.includes('đúng') || text.includes('dung') || text.includes('phù hợp') || text.includes('phu hop'))
  return { shouldLike: ok, likeAiText: String(data || '') }
} catch (e) {
  helpers.log('AI check like newsfeed lỗi, bỏ qua like: ' + (e && e.message ? e.message : String(e)))
  return { shouldLike: false }
}
$block$,
  '[]'::jsonb,
  '[{"name":"shouldLike","type":"boolean","label":"Có like"}]'::jsonb,
  '{}'::jsonb,
  true,
  NULL,
  NULL,
  now()
),
(
  'fb_newsfeed_like_post',
  'Like post newsfeed hiện tại theo XPath và JS click giống C#.',
  'ThumbsUp',
  'facebook',
  'js',
  NULL,
$block$
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
$block$,
  '[]'::jsonb,
  '[{"name":"liked","type":"boolean","label":"Đã like"}]'::jsonb,
  '{}'::jsonb,
  true,
  NULL,
  NULL,
  now()
),
(
  'fb_newsfeed_check_comment',
  'Dùng AI check post và chuẩn bị nội dung comment newsfeed.',
  'MessageSquare',
  'facebook',
  'js',
  NULL,
$block$
const state = vars.newsfeedState || {}
const post = state.currentPost || {}
if (!post || post.readablePost !== true || state.remainingComment <= 0) return { shouldComment: false }
if (!state.commentKind) {
  state.remainingComment = 0
  return { shouldComment: false }
}
const postContent = String(post.postContent || '').trim()
if (!postContent) return { shouldComment: false }

async function aiChat(question) {
  const response = await page.apiCall({
    url: 'https://api.akaapp.vn/api/AI/chat',
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: { question, source: 'aka_agent' },
    timeout: 120000
  })
  if (!response || response.status < 200 || response.status >= 300) throw new Error('AI lỗi')
  const payload = response.data || {}
  if (typeof payload !== 'object') return String(payload || '')
  return String(payload.data ?? payload.Data ?? payload.message ?? payload.Message ?? '')
}

let shouldComment = false
try {
  const checkQuestion = 'Bài viết sau có tính chất "' + state.commentKind + '" không? Chỉ trả lời có hoặc không.\\n\\n' + postContent
  const checkText = (await aiChat(checkQuestion)).toLowerCase()
  const isNegative = checkText.includes('không') || checkText.includes('khong') || checkText.includes('no') || checkText.includes('false') || checkText.includes('không phù hợp') || checkText.includes('khong phu hop')
  shouldComment = !isNegative && (checkText.includes('có') || checkText.includes('yes') || checkText.includes('true') || checkText.includes('đúng') || checkText.includes('dung') || checkText.includes('phù hợp') || checkText.includes('phu hop'))
} catch (e) {
  helpers.log('AI check comment newsfeed lỗi, bỏ qua comment: ' + (e && e.message ? e.message : String(e)))
  return { shouldComment: false }
}
if (!shouldComment) return { shouldComment: false }

const variants = helpers.splitVariants(String(state.commentContent || ''))
let text = helpers.cycleVariant(variants, Number(state.commentDone || 0))
if (state.commentUseAI === true) {
  try {
    const rawPrompt = String(state.commentContent || '')
      .replace(/\[post\]/gi, postContent)
      .replace(/\[name_post\]/gi, String(post.targetName || ''))
    const prompt = rawPrompt.trim() || ('Viết một bình luận ngắn, tự nhiên cho bài viết sau:\\n' + postContent)
    const aiText = (await aiChat(prompt)).trim()
    if (aiText) text = aiText
  } catch (e) {
    helpers.log('AI tạo comment newsfeed lỗi, dùng nội dung dự phòng: ' + (e && e.message ? e.message : String(e)))
  }
}
if (!String(text || '').trim()) {
  const fallback = ['❤', '👍', '👋']
  text = fallback[helpers.randomBetween(0, fallback.length - 1)]
}
state.commentText = text
return { shouldComment: true, text }
$block$,
  '[]'::jsonb,
  '[{"name":"shouldComment","type":"boolean","label":"Có comment"},{"name":"text","type":"string","label":"Nội dung"}]'::jsonb,
  '{}'::jsonb,
  true,
  NULL,
  NULL,
  now()
),
(
  'fb_newsfeed_comment_open',
  'Click nút Bình luận ngoài post newsfeed trước khi gọi helper comment.',
  'MessageCircle',
  'facebook',
  'js',
  NULL,
$block$
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
$block$,
  '[]'::jsonb,
  '[{"name":"opened","type":"boolean","label":"Đã mở comment"}]'::jsonb,
  '{}'::jsonb,
  true,
  NULL,
  NULL,
  now()
),
(
  'fb_newsfeed_comment_focus',
  'Click lại nút comment, tìm input dialog/root, scroll và focus theo helper C#.',
  'TextCursorInput',
  'facebook',
  'js',
  NULL,
$block$
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
$block$,
  '[]'::jsonb,
  '[{"name":"focused","type":"boolean","label":"Đã focus input"},{"name":"isDialog","type":"boolean","label":"Trong dialog"}]'::jsonb,
  '{}'::jsonb,
  true,
  NULL,
  NULL,
  now()
),
(
  'fb_newsfeed_comment_paste',
  'Paste nội dung comment và sleep theo công thức CalcTimeSleepWriteContent của C#.',
  'Clipboard',
  'facebook',
  'js',
  NULL,
$block$
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
$block$,
  '[]'::jsonb,
  '[{"name":"pasted","type":"boolean","label":"Đã paste"},{"name":"text","type":"string","label":"Nội dung"}]'::jsonb,
  '{}'::jsonb,
  true,
  NULL,
  NULL,
  now()
),
(
  'fb_newsfeed_comment_submit',
  'Click submit comment newsfeed và trả milestone cho scheduler.',
  'Send',
  'facebook',
  'js',
  NULL,
$block$
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
$block$,
  '[]'::jsonb,
  '[{"name":"commented","type":"boolean","label":"Đã comment"},{"name":"text","type":"string","label":"Nội dung"}]'::jsonb,
  '{}'::jsonb,
  true,
  NULL,
  NULL,
  now()
),
(
  'fb_newsfeed_comment_close_dialog',
  'Đóng dialog comment nếu Facebook mở dialog.',
  'X',
  'facebook',
  'js',
  NULL,
$block$
const state = vars.newsfeedState || {}
const closeDialog = await helpers.element('fb_newsfeed_close_dialog')
await page.evaluate(`
  const selector = __args[0];
  const stepDelayMs = Number(__args[1] || 1000);
  function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
  function xpathOne(xpath, root) {
    const result = document.evaluate(xpath, root || document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
    return result.singleNodeValue || null;
  }
  const closeBtn = xpathOne(selector, document);
  if (closeBtn) {
    closeBtn.click();
    await delay(stepDelayMs);
    return true;
  }
  return false;
`, closeDialog, state.stepDelayMs).catch(() => false)
return { closedDialog: true }
$block$,
  '[]'::jsonb,
  '[{"name":"closedDialog","type":"boolean","label":"Đã đóng dialog"}]'::jsonb,
  '{}'::jsonb,
  true,
  NULL,
  NULL,
  now()
),
(
  'fb_newsfeed_advance_cursor',
  'Cập nhật điều kiện loop sau mỗi post newsfeed.',
  'RefreshCw',
  'facebook',
  'js',
  NULL,
$block$
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
$block$,
  '[]'::jsonb,
  '[{"name":"shouldContinue","type":"boolean","label":"Tiếp tục"},{"name":"likeDone","type":"number","label":"Like đã làm"},{"name":"commentDone","type":"number","label":"Comment đã làm"}]'::jsonb,
  '{}'::jsonb,
  true,
  NULL,
  NULL,
  now()
),
(
  'fb_newsfeed_finalize',
  'Tổng kết lượt lướt newsfeed.',
  'CheckCircle',
  'facebook',
  'js',
  NULL,
$block$
const state = vars.newsfeedState || {}
return {
  ok: true,
  likeDone: Number(state.likeDone || 0),
  commentDone: Number(state.commentDone || 0),
  remainingLike: Number(state.remainingLike || 0),
  remainingComment: Number(state.remainingComment || 0)
}
$block$,
  '[]'::jsonb,
  '[{"name":"likeDone","type":"number","label":"Like đã làm"},{"name":"commentDone","type":"number","label":"Comment đã làm"}]'::jsonb,
  '{}'::jsonb,
  true,
  NULL,
  NULL,
  now()
)
ON CONFLICT (name) DO UPDATE SET
  description = EXCLUDED.description,
  icon = EXCLUDED.icon,
  category = EXCLUDED.category,
  kind = EXCLUDED.kind,
  system_type = EXCLUDED.system_type,
  code = EXCLUDED.code,
  config_schema = EXCLUDED.config_schema,
  output_schema = EXCLUDED.output_schema,
  default_config = EXCLUDED.default_config,
  is_builtin = true,
  updated_at = now();

DO $$
DECLARE
  missing_block_names text;
BEGIN
  WITH required_blocks AS (
    SELECT *
    FROM unnest(ARRAY[
      'nav_to_url',
      'sleep',
      'loop',
      'if_else',
      'merge',
      'fb_newsfeed_init_state',
      'fb_newsfeed_select_next_post',
      'fb_newsfeed_read_post',
      'fb_newsfeed_wait_read',
      'fb_newsfeed_check_like',
      'fb_newsfeed_like_post',
      'fb_newsfeed_check_comment',
      'fb_newsfeed_comment_open',
      'fb_newsfeed_comment_focus',
      'fb_newsfeed_comment_paste',
      'fb_newsfeed_comment_submit',
      'fb_newsfeed_comment_close_dialog',
      'fb_newsfeed_advance_cursor',
      'fb_newsfeed_finalize'
    ]) AS required(name)
  )
  SELECT string_agg(required.name, ', ')
  INTO missing_block_names
  FROM required_blocks required
  LEFT JOIN public.auto_blocks block ON block.name = required.name
  WHERE block.id IS NULL;

  IF missing_block_names IS NOT NULL THEN
    RAISE EXCEPTION 'Missing auto_blocks for facebook_newsfeed_interaction: %', missing_block_names;
  END IF;
END $$;

WITH block_ids AS (
  SELECT name, id
  FROM public.auto_blocks
  WHERE name IN (
    'nav_to_url',
    'sleep',
    'loop',
    'if_else',
    'merge',
    'fb_newsfeed_init_state',
    'fb_newsfeed_select_next_post',
    'fb_newsfeed_read_post',
    'fb_newsfeed_wait_read',
    'fb_newsfeed_check_like',
    'fb_newsfeed_like_post',
    'fb_newsfeed_check_comment',
    'fb_newsfeed_comment_open',
    'fb_newsfeed_comment_focus',
    'fb_newsfeed_comment_paste',
    'fb_newsfeed_comment_submit',
    'fb_newsfeed_comment_close_dialog',
    'fb_newsfeed_advance_cursor',
    'fb_newsfeed_finalize'
  )
)
INSERT INTO public.auto_workflows (
  name, description, nodes, edges, variables_schema, default_variables,
  is_builtin, staff_id, organization_id, updated_at
)
SELECT
  'facebook_newsfeed_interaction',
  'Workflow lướt newsfeed Facebook và tương tác like/comment.',
  jsonb_build_array(
    jsonb_build_object('id','nav_home','label','Mở Facebook','config',jsonb_build_object('url','https://www.facebook.com'),'blockId',(SELECT id FROM block_ids WHERE name='nav_to_url'),'position',jsonb_build_object('x',100,'y',0),'blockName','nav_to_url'),
    jsonb_build_object('id','sleep_home','label','Chờ trang tải','config',jsonb_build_object('ms',3000),'blockId',(SELECT id FROM block_ids WHERE name='sleep'),'position',jsonb_build_object('x',100,'y',100),'blockName','sleep'),
    jsonb_build_object('id','init_state','label','Khởi tạo','config','{}'::jsonb,'blockId',(SELECT id FROM block_ids WHERE name='fb_newsfeed_init_state'),'position',jsonb_build_object('x',100,'y',200),'blockName','fb_newsfeed_init_state'),
    jsonb_build_object('id','loop_newsfeed','config',jsonb_build_object('loopType','while','condition','vars.newsfeedState && vars.newsfeedState.shouldContinue === true','maxIterations',1000),'blockId',(SELECT id FROM block_ids WHERE name='loop'),'position',jsonb_build_object('x',100,'y',300),'blockName','loop','systemType','loop'),
    jsonb_build_object('id','select_post','label','Chọn post','config','{}'::jsonb,'blockId',(SELECT id FROM block_ids WHERE name='fb_newsfeed_select_next_post'),'position',jsonb_build_object('x',100,'y',420),'blockName','fb_newsfeed_select_next_post'),
    jsonb_build_object('id','read_post','label','Đọc post','config','{}'::jsonb,'blockId',(SELECT id FROM block_ids WHERE name='fb_newsfeed_read_post'),'position',jsonb_build_object('x',100,'y',520),'blockName','fb_newsfeed_read_post'),
    jsonb_build_object('id','wait_read','label','Đọc nội dung','config','{}'::jsonb,'blockId',(SELECT id FROM block_ids WHERE name='fb_newsfeed_wait_read'),'position',jsonb_build_object('x',100,'y',620),'blockName','fb_newsfeed_wait_read'),
    jsonb_build_object('id','check_like','label','Check like','config','{}'::jsonb,'blockId',(SELECT id FROM block_ids WHERE name='fb_newsfeed_check_like'),'position',jsonb_build_object('x',100,'y',720),'blockName','fb_newsfeed_check_like'),
    jsonb_build_object('id','if_like','config',jsonb_build_object('condition','input.shouldLike === true'),'blockId',(SELECT id FROM block_ids WHERE name='if_else'),'position',jsonb_build_object('x',100,'y',820),'blockName','if_else','systemType','ifElse'),
    jsonb_build_object('id','like_post','label','Like post','config','{}'::jsonb,'blockId',(SELECT id FROM block_ids WHERE name='fb_newsfeed_like_post'),'position',jsonb_build_object('x',0,'y',920),'blockName','fb_newsfeed_like_post'),
    jsonb_build_object('id','merge_like','config',jsonb_build_object('mode','any'),'blockId',(SELECT id FROM block_ids WHERE name='merge'),'position',jsonb_build_object('x',100,'y',1020),'blockName','merge','systemType','merge'),
    jsonb_build_object('id','check_comment','label','Check comment','config','{}'::jsonb,'blockId',(SELECT id FROM block_ids WHERE name='fb_newsfeed_check_comment'),'position',jsonb_build_object('x',100,'y',1120),'blockName','fb_newsfeed_check_comment'),
    jsonb_build_object('id','if_comment','config',jsonb_build_object('condition','input.shouldComment === true'),'blockId',(SELECT id FROM block_ids WHERE name='if_else'),'position',jsonb_build_object('x',100,'y',1220),'blockName','if_else','systemType','ifElse'),
    jsonb_build_object('id','comment_open','label','Mở comment','config','{}'::jsonb,'blockId',(SELECT id FROM block_ids WHERE name='fb_newsfeed_comment_open'),'position',jsonb_build_object('x',0,'y',1320),'blockName','fb_newsfeed_comment_open'),
    jsonb_build_object('id','comment_focus','label','Focus comment','config','{}'::jsonb,'blockId',(SELECT id FROM block_ids WHERE name='fb_newsfeed_comment_focus'),'position',jsonb_build_object('x',0,'y',1420),'blockName','fb_newsfeed_comment_focus'),
    jsonb_build_object('id','comment_paste','label','Paste comment','config','{}'::jsonb,'blockId',(SELECT id FROM block_ids WHERE name='fb_newsfeed_comment_paste'),'position',jsonb_build_object('x',0,'y',1520),'blockName','fb_newsfeed_comment_paste'),
    jsonb_build_object('id','comment_submit','label','Submit comment','config','{}'::jsonb,'blockId',(SELECT id FROM block_ids WHERE name='fb_newsfeed_comment_submit'),'position',jsonb_build_object('x',0,'y',1620),'blockName','fb_newsfeed_comment_submit'),
    jsonb_build_object('id','comment_close','label','Đóng dialog','config','{}'::jsonb,'blockId',(SELECT id FROM block_ids WHERE name='fb_newsfeed_comment_close_dialog'),'position',jsonb_build_object('x',0,'y',1720),'blockName','fb_newsfeed_comment_close_dialog'),
    jsonb_build_object('id','merge_comment','config',jsonb_build_object('mode','any'),'blockId',(SELECT id FROM block_ids WHERE name='merge'),'position',jsonb_build_object('x',100,'y',1820),'blockName','merge','systemType','merge'),
    jsonb_build_object('id','advance_cursor','label','Cập nhật loop','config','{}'::jsonb,'blockId',(SELECT id FROM block_ids WHERE name='fb_newsfeed_advance_cursor'),'position',jsonb_build_object('x',100,'y',1920),'blockName','fb_newsfeed_advance_cursor'),
    jsonb_build_object('id','finalize','label','Tổng kết','config','{}'::jsonb,'blockId',(SELECT id FROM block_ids WHERE name='fb_newsfeed_finalize'),'position',jsonb_build_object('x',300,'y',420),'blockName','fb_newsfeed_finalize')
  ),
  '[
    {"id":"e-nav-sleep","source":"nav_home","target":"sleep_home"},
    {"id":"e-sleep-init","source":"sleep_home","target":"init_state"},
    {"id":"e-init-loop","source":"init_state","target":"loop_newsfeed"},
    {"id":"e-loop-select-body","source":"loop_newsfeed","target":"select_post","sourceHandle":"body"},
    {"id":"e-loop-finalize-done","source":"loop_newsfeed","target":"finalize","sourceHandle":"done"},
    {"id":"e-select-read","source":"select_post","target":"read_post"},
    {"id":"e-read-wait","source":"read_post","target":"wait_read"},
    {"id":"e-wait-check-like","source":"wait_read","target":"check_like"},
    {"id":"e-check-like-if","source":"check_like","target":"if_like"},
    {"id":"e-if-like-true","source":"if_like","target":"like_post","sourceHandle":"true"},
    {"id":"e-if-like-false","source":"if_like","target":"merge_like","sourceHandle":"false"},
    {"id":"e-like-merge","source":"like_post","target":"merge_like"},
    {"id":"e-merge-like-check-comment","source":"merge_like","target":"check_comment"},
    {"id":"e-check-comment-if","source":"check_comment","target":"if_comment"},
    {"id":"e-if-comment-true","source":"if_comment","target":"comment_open","sourceHandle":"true"},
    {"id":"e-if-comment-false","source":"if_comment","target":"merge_comment","sourceHandle":"false"},
    {"id":"e-comment-open-focus","source":"comment_open","target":"comment_focus"},
    {"id":"e-comment-focus-paste","source":"comment_focus","target":"comment_paste"},
    {"id":"e-comment-paste-submit","source":"comment_paste","target":"comment_submit"},
    {"id":"e-comment-submit-close","source":"comment_submit","target":"comment_close"},
    {"id":"e-comment-close-merge","source":"comment_close","target":"merge_comment"},
    {"id":"e-merge-comment-advance","source":"merge_comment","target":"advance_cursor"}
  ]'::jsonb,
  '[
    {"name":"newsfeedTimeMinutes","type":"number","label":"Thời gian lướt"},
    {"name":"newsfeedLikeKind","type":"string","label":"Like nội dung có tính chất"},
    {"name":"newsfeedLikeLimit","type":"number","label":"Like tối đa"},
    {"name":"newsfeedCommentKind","type":"string","label":"Comment bài post có tính chất"},
    {"name":"newsfeedCommentLimit","type":"number","label":"Comment tối đa"},
    {"name":"newsfeedCommentContent","type":"string","label":"Nội dung comment"},
    {"name":"newsfeedCommentUseAI","type":"boolean","label":"AI tạo comment"},
    {"name":"allowNewsfeedLike","type":"boolean","label":"Cho phép like"},
    {"name":"allowNewsfeedComment","type":"boolean","label":"Cho phép comment"}
  ]'::jsonb,
  '{"newsfeedTimeMinutes":20,"newsfeedLikeKind":"","newsfeedLikeLimit":10,"newsfeedCommentKind":"","newsfeedCommentLimit":10,"newsfeedCommentContent":"","newsfeedCommentUseAI":false,"allowNewsfeedLike":true,"allowNewsfeedComment":true}'::jsonb,
  true,
  NULL,
  NULL,
  now()
ON CONFLICT (name) DO UPDATE SET
  description = EXCLUDED.description,
  nodes = EXCLUDED.nodes,
  edges = EXCLUDED.edges,
  variables_schema = EXCLUDED.variables_schema,
  default_variables = EXCLUDED.default_variables,
  is_builtin = true,
  updated_at = now();

INSERT INTO public.auto_campaign_actions (
  id, name, flatform_type, is_active, workflow_id, limit_check_action_codes, is_delete, created_at
)
VALUES (
  'facebook_newsfeed_interaction',
  'Facebook - Lướt newsfeed và tương tác',
  'facebook',
  true,
  (SELECT id FROM public.auto_workflows WHERE name = 'facebook_newsfeed_interaction'),
  '{}'::text[],
  false,
  now()
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  flatform_type = EXCLUDED.flatform_type,
  is_active = true,
  workflow_id = EXCLUDED.workflow_id,
  limit_check_action_codes = EXCLUDED.limit_check_action_codes,
  is_delete = false;

COMMIT;
