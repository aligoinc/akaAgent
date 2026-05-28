-- Fix newsfeed post reading selectors and skip unreadable posts.

BEGIN;

INSERT INTO public.auto_elements (name, xpath, description, category, is_builtin, staff_id, organization_id, updated_at)
VALUES
  ('fb_newsfeed_post_author_link', $$.//h2[contains(@class,'html-h2')]//a|.//h3[contains(@class,'html-h3')]//a|.//h4[contains(@class,'html-h4')]//a$$, 'Author link inside a newsfeed post.', 'facebook', true, NULL, NULL, now()),
  ('fb_newsfeed_post_content', $$.//*[@dir='auto']//*[@data-ad-rendering-role='message' or @data-ad-rendering-role='story_message' or @data-ad-comet-preview='message' or @data-ad-preview='message' or @class='xh8yej3' or @id]$$, 'Post message content.', 'facebook', true, NULL, NULL, now()),
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

UPDATE public.auto_blocks
SET
  code = $block$
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
  output_schema = '[{"name":"readablePost","type":"boolean","label":"Đọc được post"},{"name":"targetName","type":"string","label":"Tên người đăng"},{"name":"targetUid","type":"string","label":"UID"},{"name":"postContent","type":"string","label":"Nội dung"}]'::jsonb,
  updated_at = now()
WHERE name = 'fb_newsfeed_read_post';

UPDATE public.auto_blocks
SET
  code = $block$
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
  updated_at = now()
WHERE name = 'fb_newsfeed_wait_read';

UPDATE public.auto_blocks
SET
  code = $block$
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
  updated_at = now()
WHERE name = 'fb_newsfeed_check_like';

UPDATE public.auto_blocks
SET
  code = $block$
const state = vars.newsfeedState || {}
const post = state.currentPost || {}
if (input.hasPost !== true || input.readablePost !== true || state.remainingComment <= 0) return { shouldComment: false }
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
  updated_at = now()
WHERE name = 'fb_newsfeed_check_comment';

COMMIT;
