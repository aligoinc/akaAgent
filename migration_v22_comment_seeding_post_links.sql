-- Split Facebook comment seeding into feed targets and direct post-link targets.
-- Existing action keeps the feed/group/page/profile workflow; the new action reuses
-- the same workflow but passes vars.commentTargetMode = 'post_link' from scheduler.

UPDATE public.auto_campaign_actions
SET
  name = 'Facebook - Comment seeding vào danh sách group/page/profile',
  limit_check_action_codes = ARRAY['fb_comment', 'fb_like_post']::text[]
WHERE id = 'facebook_comment_seeding';

WITH source_action AS (
  SELECT workflow_id
  FROM public.auto_campaign_actions
  WHERE id = 'facebook_comment_seeding'
)
INSERT INTO public.auto_campaign_actions (
  id,
  name,
  flatform_type,
  is_active,
  workflow_id,
  limit_check_action_codes,
  is_delete,
  created_at
)
SELECT
  'facebook_comment_seeding_post',
  'Facebook - Comment seeding vào danh sách bài post',
  'facebook',
  true,
  workflow_id,
  ARRAY['fb_comment', 'fb_like_post']::text[],
  false,
  now()
FROM source_action
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  flatform_type = EXCLUDED.flatform_type,
  is_active = EXCLUDED.is_active,
  workflow_id = EXCLUDED.workflow_id,
  limit_check_action_codes = EXCLUDED.limit_check_action_codes,
  is_delete = false;

UPDATE public.auto_blocks
SET code = $block$
const N = Math.max(1, Number(input.limit || vars.postsPerTarget || 3))
const kwRaw = String(input.keywords || vars.keywordFilter || '')
function normalizeForMatch(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
const keywords = kwRaw.split(',').map(normalizeForMatch).filter(Boolean)
const variants = Array.isArray(vars.commentVariants) ? vars.commentVariants : []
const targetMode = String(vars.commentTargetMode || '')

if (targetMode === 'post_link') {
  const text = variants.length > 0 ? variants[0] : ''
  helpers.log('📋 Sẽ comment vào link bài post hiện tại')
  return {
    commentIterations: [{ position: 1, text }],
    totalCount: 1,
    matchedCount: 1,
    targetMode: 'post_link'
  }
}

const selectors = {
  posts: await helpers.element('fb_post_in_uid'),
  seeMore: await helpers.element('fb_see_more_content_post_btn'),
  content: await helpers.element('fb_content_in_post_in_uid')
}

// Scroll enough for Facebook to lazy-load posts before reading the visible feed.
const scrollTimes = keywords.length > 0 ? Math.max(5, N * 2 + 2) : Math.max(3, N + 2)
for (let i = 0; i < scrollTimes; i++) {
  if (signal && signal.aborted) break
  try { await page.scroll({ direction: 'down', amount: 1500 }) } catch (e) {}
  await helpers.sleep(2000, signal)
}

try {
  await page.evaluate('window.scrollTo({ top: 0, behavior: "instant" });')
} catch (e) {}
await helpers.sleep(2500, signal)

const evalCode = `
  const selectors = __args[0];

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function isVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function xpathAll(xpath, root) {
    const out = [];
    if (!xpath) return out;
    try {
      const result = document.evaluate(xpath, root || document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      for (let i = 0; i < result.snapshotLength; i++) out.push(result.snapshotItem(i));
    } catch {}
    return out.filter(Boolean);
  }

  function clickSynthetic(el) {
    if (!el) return;
    try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch {}
    const init = { bubbles: true, cancelable: true, view: window };
    try { el.dispatchEvent(new PointerEvent('pointerdown', Object.assign({}, init, { pointerId: 1, pointerType: 'mouse' }))); } catch {}
    try { el.dispatchEvent(new MouseEvent('mousedown', init)); } catch {}
    try { el.dispatchEvent(new PointerEvent('pointerup', Object.assign({}, init, { pointerId: 1, pointerType: 'mouse' }))); } catch {}
    try { el.dispatchEvent(new MouseEvent('mouseup', init)); } catch {}
    try { el.click(); } catch {}
  }

  function uniqueText(parts) {
    const seen = {};
    const out = [];
    for (const part of parts || []) {
      const text = String(part || '').replace(/\\s+/g, ' ').trim();
      if (!text || seen[text]) continue;
      seen[text] = 1;
      out.push(text);
    }
    return out;
  }

  const postElements = xpathAll(selectors.posts).filter(isVisible);
  const rows = [];

  for (let i = 0; i < postElements.length; i++) {
    const post = postElements[i];
    try {
      post.scrollIntoView({ block: 'center', inline: 'nearest' });
      await delay(300);
    } catch {}

    try {
      const seeMoreButtons = xpathAll(selectors.seeMore, post).filter(isVisible).slice(0, 5);
      for (const btn of seeMoreButtons) {
        clickSynthetic(btn);
        await delay(300);
      }
    } catch {}

    let contentParts = xpathAll(selectors.content, post)
      .map(el => (el.innerText || el.textContent || el.getAttribute('aria-label') || '').trim())
      .filter(Boolean);

    if (contentParts.length === 0) {
      contentParts = Array.from(post.querySelectorAll('[data-ad-rendering-role="message"], [data-ad-rendering-role="story_message"], [data-ad-comet-preview="message"], [data-ad-preview="message"], [dir="auto"]'))
        .filter(isVisible)
        .map(el => (el.innerText || el.textContent || el.getAttribute('aria-label') || '').trim())
        .filter(Boolean);
    }

    let content = uniqueText(contentParts).join('\\n').trim();
    if (!content) content = (post.innerText || post.textContent || '').trim();

    rows.push({
      position: i + 1,
      content
    });
  }

  return { posts: rows, count: postElements.length };
`

let postData = { posts: [], count: 0 }
try { postData = await page.evaluate(evalCode, selectors) } catch (e) {
  helpers.log('⚠️ Lỗi đọc nội dung bài viết: ' + (e && e.message || e))
}

helpers.log('🔍 Tìm thấy ' + postData.count + ' bài viết trong trang hiện tại')

const result = []
const samples = []
for (const post of (postData.posts || [])) {
  if (result.length >= N) break
  const rawText = String(post && post.content ? post.content : '')
  const normalizedText = normalizeForMatch(rawText)
  if (samples.length < 3 && rawText) samples.push(rawText.replace(/\s+/g, ' ').trim().slice(0, 120))
  if (keywords.length > 0) {
    if (!keywords.some(k => normalizedText.includes(k))) continue
  }
  result.push({
    position: Number(post.position || (result.length + 1)),
    text: variants.length > 0 ? variants[result.length % variants.length] : ''
  })
}

if (result.length === 0) {
  if (postData.count === 0) {
    helpers.log('⚠️ Không tìm thấy bài viết nào. Tài khoản có thể chưa được duyệt vào nhóm hoặc trang chưa load xong.')
  } else if (keywords.length > 0) {
    helpers.log('⚠️ Có ' + postData.count + ' bài viết nhưng không khớp từ khoá: ' + kwRaw)
    if (samples.length > 0) helpers.log('ℹ️ Nội dung đã đọc thử: ' + samples.join(' | '))
  } else {
    helpers.log('⚠️ Chưa chuẩn bị được danh sách bài để comment')
  }
} else {
  helpers.log('📋 Sẽ comment vào ' + result.length + '/' + N + ' bài' + (keywords.length ? ' theo từ khoá: ' + kwRaw : ''))
}

return { commentIterations: result, totalCount: postData.count, matchedCount: result.length }
$block$,
updated_at = now()
WHERE name = 'fb_prepare_seeding_iterations';
