-- Split the direct-post comment seeding flow into its own workflow.
-- v22 temporarily reused the feed workflow; this migration restores the feed
-- prepare block and points facebook_comment_seeding_post to post-link blocks.

BEGIN;

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

INSERT INTO public.auto_blocks (
  name, description, icon, category, kind, system_type, code,
  config_schema, output_schema, default_config, is_builtin, staff_id, organization_id, updated_at
)
VALUES
(
  'fb_prepare_post_link_comment_iteration',
  'Chuẩn bị 1 lượt comment cho workflow comment seeding theo link bài post.',
  'ListChecks',
  'facebook',
  'js',
  NULL,
$block$
const variants = Array.isArray(vars.commentVariants) ? vars.commentVariants : []
const text = variants.length > 0 ? String(variants[0] || '') : ''
const batchImages = Array.isArray(vars.commentImageBatches) && Array.isArray(vars.commentImageBatches[0])
  ? vars.commentImageBatches[0]
  : []
const fallbackImages = Array.isArray(vars.commentImages) ? vars.commentImages : []
const rawImages = batchImages.length > 0 ? batchImages : fallbackImages
const images = rawImages.map(x => String(x || '').trim()).filter(Boolean).slice(0, 1)

if (!text.trim() && images.length === 0) {
  helpers.log('⚠️ Chưa có nội dung hoặc ảnh để comment vào bài post')
  return { commentIterations: [], totalCount: 1, matchedCount: 0, targetMode: 'post_link' }
}

helpers.log('📋 Sẽ comment vào link bài post hiện tại')
return {
  commentIterations: [{ position: 1, text, images }],
  totalCount: 1,
  matchedCount: 1,
  targetMode: 'post_link'
}
$block$,
  '[]'::jsonb,
  '[
    {"name":"commentIterations","type":"json","label":"Danh sách comment"},
    {"name":"matchedCount","type":"number","label":"Số bài sẽ comment"}
  ]'::jsonb,
  '{}'::jsonb,
  true,
  NULL,
  NULL,
  now()
),
(
  'fb_click_like_current_post',
  'Like bài post hiện tại trong trang permalink, dùng DOM event không phụ thuộc toạ độ.',
  'ThumbsUp',
  'facebook',
  'js',
  NULL,
$block$
const enabled = input.enabled !== false && vars.enablePostLike === true
if (!enabled) return { liked: false, skipped: true }

const result = await page.evaluate(`
  function normalize(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\\u0300-\\u036f]/g, '')
      .replace(/[đĐ]/g, 'd')
      .toLowerCase()
      .replace(/\\s+/g, ' ')
      .trim();
  }

  function isVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function labelOf(el) {
    return [
      el.getAttribute('aria-label'),
      el.getAttribute('title'),
      el.innerText,
      el.textContent
    ].filter(Boolean).join(' ');
  }

  function clickSynthetic(el) {
    try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch {}
    const init = { bubbles: true, cancelable: true, view: window };
    try { el.dispatchEvent(new PointerEvent('pointerdown', Object.assign({}, init, { pointerId: 1, pointerType: 'mouse' }))); } catch {}
    try { el.dispatchEvent(new MouseEvent('mousedown', init)); } catch {}
    try { el.dispatchEvent(new PointerEvent('pointerup', Object.assign({}, init, { pointerId: 1, pointerType: 'mouse' }))); } catch {}
    try { el.dispatchEvent(new MouseEvent('mouseup', init)); } catch {}
    try { el.click(); } catch {}
  }

  const root = document.querySelector('[role="main"]') || document.body;
  const boxes = Array.from(root.querySelectorAll('[contenteditable="true"], [role="textbox"]')).filter(isVisible);
  const firstBoxTop = boxes.length > 0 ? boxes[0].getBoundingClientRect().top : Number.POSITIVE_INFINITY;
  const candidates = Array.from(root.querySelectorAll('[role="button"], button'))
    .filter(isVisible)
    .map(el => ({ el, label: labelOf(el), rect: el.getBoundingClientRect(), pressedAttr: el.getAttribute('aria-pressed') }))
    .filter(item => {
      const n = normalize(item.label);
      if (!n) return false;
      if (n.includes('comment') || n.includes('binh luan') || n.includes('reply') || n.includes('tra loi')) return false;
      if (item.rect.top > firstBoxTop + 40) return false;
      if (n === 'like' || n === 'thich' || n === 'unlike' || n === 'bo thich' || n === 'remove like') return true;
      return item.pressedAttr !== null && (n.includes('like') || n.includes('thich') || n.includes('bo thich') || n.includes('remove like'));
    })
    .sort((a, b) => a.rect.top - b.rect.top);

  const target = candidates[0];
  if (!target) return { liked: false, reason: 'Không tìm thấy nút Thích của bài post' };

  const label = target.label || '';
  const n = normalize(label);
  const pressed = target.el.getAttribute('aria-pressed') === 'true';
  if (pressed || n.includes('unlike') || n.includes('bo thich') || n.includes('remove like')) {
    return { liked: true, alreadyLiked: true, label: label.slice(0, 80) };
  }

  clickSynthetic(target.el);
  return { liked: true, alreadyLiked: false, label: label.slice(0, 80) };
`)

if (result && result.liked) {
  helpers.log(result.alreadyLiked ? 'ℹ️ Bài post đã được thích trước đó' : '✅ Đã thích bài post')
} else {
  helpers.log('⚠️ Không thể thích bài post: ' + ((result && result.reason) || 'không tìm thấy nút Thích'))
}

await helpers.sleep(1200, signal)
return result || { liked: false }
$block$,
  '[{"name":"enabled","type":"boolean","label":"Bật like","default":true}]'::jsonb,
  '[
    {"name":"liked","type":"boolean","label":"Đã thích"},
    {"name":"alreadyLiked","type":"boolean","label":"Đã thích trước đó"}
  ]'::jsonb,
  '{"enabled":true}'::jsonb,
  true,
  NULL,
  NULL,
  now()
),
(
  'fb_comment_current_post',
  'Comment vào bài post hiện tại trong trang permalink, hỗ trợ nội dung và 1 ảnh.',
  'MessageCircle',
  'facebook',
  'js',
  NULL,
$block$
const item = (vars && vars.loopItem) ? vars.loopItem : {}
const text = String(input.text || item.text || '')
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
const images = rawImages.map(x => String(x || '').trim()).filter(Boolean).slice(0, 1)

if (!text && images.length === 0) return { commented: false, position: 1, text: '', imageCount: 0 }

const boxSelector = '[data-akabiz-current-post-comment-box="1"]'
const prepareResult = await page.evaluate(`
  const marker = 'data-akabiz-current-post-comment-box';

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function normalize(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\\u0300-\\u036f]/g, '')
      .replace(/[đĐ]/g, 'd')
      .toLowerCase()
      .replace(/\\s+/g, ' ')
      .trim();
  }

  function isVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function labelOf(el) {
    return [
      el.getAttribute('aria-label'),
      el.getAttribute('aria-placeholder'),
      el.getAttribute('placeholder'),
      el.getAttribute('title'),
      el.innerText,
      el.textContent
    ].filter(Boolean).join(' ');
  }

  function clickSynthetic(el) {
    if (!el) return;
    const init = { bubbles: true, cancelable: true, view: window };
    try { el.dispatchEvent(new PointerEvent('pointerdown', Object.assign({}, init, { pointerId: 1, pointerType: 'mouse' }))); } catch {}
    try { el.dispatchEvent(new MouseEvent('mousedown', init)); } catch {}
    try { el.dispatchEvent(new PointerEvent('pointerup', Object.assign({}, init, { pointerId: 1, pointerType: 'mouse' }))); } catch {}
    try { el.dispatchEvent(new MouseEvent('mouseup', init)); } catch {}
    try { el.click(); } catch {}
  }

  function isCommentBox(el) {
    const n = normalize(labelOf(el));
    if (n.includes('search') || n.includes('tim kiem') || n.includes('message') || n.includes('nhan tin')) return false;
    if (n.includes('reply') || n.includes('tra loi') || n.includes('phan hoi')) return false;
    return n.includes('write a comment') || n.includes('viet binh luan') || n.includes('binh luan') || n.includes('comment as');
  }

  function editableFor(el) {
    if (!el) return null;
    if (el.isContentEditable) return el;
    const inner = el.querySelector && el.querySelector('[contenteditable="true"]');
    return inner || el;
  }

  function findCommentBox() {
    const dialogs = Array.from(document.querySelectorAll('[role="dialog"]')).filter(isVisible);
    const roots = dialogs.length > 0
      ? dialogs.slice().reverse()
      : [document.querySelector('[role="main"]') || document.body];

    for (const root of roots) {
      if (!root || !root.querySelectorAll) continue;
      const rootRect = root.getBoundingClientRect();
      const candidates = Array.from(root.querySelectorAll('[contenteditable="true"], [role="textbox"], textarea, div[aria-label], div[aria-placeholder]'))
        .filter(isVisible)
        .filter(isCommentBox)
        .map(editableFor)
        .filter(Boolean)
        .filter(isVisible)
        .map(el => ({ el, rect: el.getBoundingClientRect() }))
        .filter(item => item.rect.bottom >= rootRect.top && item.rect.top <= rootRect.bottom)
        .sort((a, b) => b.rect.bottom - a.rect.bottom);

      if (candidates.length > 0) return candidates[0].el;
    }

    return null;
  }

  document.querySelectorAll('[' + marker + ']').forEach(el => el.removeAttribute(marker));

  for (let attempt = 0; attempt < 3; attempt++) {
    const box = findCommentBox();
    if (box) {
      box.setAttribute(marker, '1');
      try { box.focus(); } catch {}
      clickSynthetic(box);
      return { ok: true, attempt };
    }

    await delay(700);
  }

  return { ok: false, error: 'Không tìm thấy ô bình luận đang mở của bài post' };
`)

if (!prepareResult || prepareResult.ok !== true) {
  throw new Error((prepareResult && prepareResult.error) || 'Không tìm thấy ô bình luận đang mở của bài post')
}

await page.waitForSelector(boxSelector, { timeout: 5000 })
await helpers.sleep(1000, signal)

if (text) {
  await page.type(boxSelector, text, { clearFirst: true })
  await helpers.sleep(1000, signal)
}

let imageCount = 0
if (images.length > 0) {
  const dropResult = await page.dropFile(boxSelector, images)
  imageCount = Number(dropResult.fileCount || 0)
  await helpers.sleep(3000, signal)
  if (!text && imageCount <= 0) {
    return { commented: false, position: 1, text: '', imageCount: 0 }
  }
}

await page.evaluate(`
  const el = document.querySelector('[data-akabiz-current-post-comment-box="1"]');
  if (el) {
    try { el.focus(); } catch {}
    const init = { bubbles: true, cancelable: true, view: window };
    try { el.dispatchEvent(new MouseEvent('mousedown', init)); } catch {}
    try { el.dispatchEvent(new MouseEvent('mouseup', init)); } catch {}
    try { el.click(); } catch {}
  }
`)
await helpers.sleep(500, signal)
await page.press('Enter')
await helpers.sleep(3000, signal)

const logSuffix = text ? ': ' + text.substring(0, 50) : ''
helpers.log('💬 Đã comment vào bài post' + logSuffix)
return { commented: true, position: 1, text: text, imageCount: imageCount }
$block$,
  '[
    {"name":"text","type":"textarea","label":"Nội dung comment (để rỗng = lấy từ loopItem)"},
    {"name":"images","type":"json","label":"Ảnh comment (array path, chỉ dùng ảnh đầu tiên; để rỗng = lấy từ loopItem/vars)"}
  ]'::jsonb,
  '[
    {"name":"commented","type":"boolean","label":"Đã comment chưa"},
    {"name":"position","type":"number","label":"Vị trí đã comment"},
    {"name":"text","type":"string","label":"Nội dung đã comment"},
    {"name":"imageCount","type":"number","label":"Số ảnh đã gửi"}
  ]'::jsonb,
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

WITH block_ids AS (
  SELECT name, id
  FROM public.auto_blocks
  WHERE name IN (
    'fb_resolve_url',
    'nav_to_url',
    'wait_for_selector',
    'sleep',
    'fb_prepare_post_link_comment_iteration',
    'loop',
    'if_else',
    'fb_click_like_current_post',
    'merge',
    'fb_comment_current_post'
  )
)
INSERT INTO public.auto_workflows (
  name, description, nodes, edges, variables_schema, default_variables,
  is_builtin, staff_id, organization_id, updated_at
)
SELECT
  'facebook_comment_seeding_post',
  'Workflow comment trực tiếp vào từng link bài post Facebook.',
  jsonb_build_array(
    jsonb_build_object(
      'id', 'resolve_url',
      'label', 'Resolve link bài post',
      'config', jsonb_build_object('urlType', 'profile'),
      'blockId', (SELECT id FROM block_ids WHERE name = 'fb_resolve_url'),
      'position', jsonb_build_object('x', 100, 'y', 0),
      'blockName', 'fb_resolve_url'
    ),
    jsonb_build_object(
      'id', 'nav',
      'label', 'Mở bài post',
      'config', '{}'::jsonb,
      'blockId', (SELECT id FROM block_ids WHERE name = 'nav_to_url'),
      'position', jsonb_build_object('x', 100, 'y', 100),
      'blockName', 'nav_to_url'
    ),
    jsonb_build_object(
      'id', 'wait_main',
      'label', 'Chờ bài post load',
      'config', jsonb_build_object('selector', '//*[@role=''main'']', 'timeout', 12000),
      'blockId', (SELECT id FROM block_ids WHERE name = 'wait_for_selector'),
      'position', jsonb_build_object('x', 100, 'y', 200),
      'blockName', 'wait_for_selector'
    ),
    jsonb_build_object(
      'id', 'sleep_after_nav',
      'config', jsonb_build_object('ms', 3500),
      'blockId', (SELECT id FROM block_ids WHERE name = 'sleep'),
      'position', jsonb_build_object('x', 100, 'y', 300),
      'blockName', 'sleep'
    ),
    jsonb_build_object(
      'id', 'prepare_iters',
      'label', 'Chuẩn bị comment bài post',
      'config', '{}'::jsonb,
      'blockId', (SELECT id FROM block_ids WHERE name = 'fb_prepare_post_link_comment_iteration'),
      'position', jsonb_build_object('x', 100, 'y', 400),
      'blockName', 'fb_prepare_post_link_comment_iteration'
    ),
    jsonb_build_object(
      'id', 'loop_comment',
      'config', jsonb_build_object('loopType', 'forEach', 'itemsExpr', '(input && Array.isArray(input.commentIterations)) ? input.commentIterations : []'),
      'blockId', (SELECT id FROM block_ids WHERE name = 'loop'),
      'position', jsonb_build_object('x', 100, 'y', 500),
      'blockName', 'loop',
      'systemType', 'loop'
    ),
    jsonb_build_object(
      'id', 'if_like',
      'config', jsonb_build_object('condition', 'vars.enablePostLike === true'),
      'blockId', (SELECT id FROM block_ids WHERE name = 'if_else'),
      'position', jsonb_build_object('x', 0, 'y', 600),
      'blockName', 'if_else',
      'systemType', 'ifElse'
    ),
    jsonb_build_object(
      'id', 'like_current_post',
      'label', 'Thích bài post hiện tại',
      'config', jsonb_build_object('enabled', true),
      'blockId', (SELECT id FROM block_ids WHERE name = 'fb_click_like_current_post'),
      'position', jsonb_build_object('x', -100, 'y', 700),
      'blockName', 'fb_click_like_current_post'
    ),
    jsonb_build_object(
      'id', 'merge_like',
      'config', jsonb_build_object('mode', 'any'),
      'blockId', (SELECT id FROM block_ids WHERE name = 'merge'),
      'position', jsonb_build_object('x', 0, 'y', 800),
      'blockName', 'merge',
      'systemType', 'merge'
    ),
    jsonb_build_object(
      'id', 'comment_current_post',
      'label', 'Comment bài post hiện tại',
      'config', '{}'::jsonb,
      'blockId', (SELECT id FROM block_ids WHERE name = 'fb_comment_current_post'),
      'position', jsonb_build_object('x', 0, 'y', 900),
      'blockName', 'fb_comment_current_post'
    ),
    jsonb_build_object(
      'id', 'merge_end',
      'config', jsonb_build_object('mode', 'any'),
      'blockId', (SELECT id FROM block_ids WHERE name = 'merge'),
      'position', jsonb_build_object('x', 100, 'y', 1000),
      'blockName', 'merge',
      'systemType', 'merge'
    )
  ),
  '[
    {"id":"e-resolve_url-nav","source":"resolve_url","target":"nav"},
    {"id":"e-nav-wait_main","source":"nav","target":"wait_main"},
    {"id":"e-wait_main-sleep_after_nav","source":"wait_main","target":"sleep_after_nav"},
    {"id":"e-sleep_after_nav-prepare_iters","source":"sleep_after_nav","target":"prepare_iters"},
    {"id":"e-prepare_iters-loop_comment","source":"prepare_iters","target":"loop_comment"},
    {"id":"e-loop_comment-if_like-body","source":"loop_comment","target":"if_like","sourceHandle":"body"},
    {"id":"e-loop_comment-merge_end-done","source":"loop_comment","target":"merge_end","sourceHandle":"done"},
    {"id":"e-if_like-like_current_post-true","source":"if_like","target":"like_current_post","sourceHandle":"true"},
    {"id":"e-if_like-merge_like-false","source":"if_like","target":"merge_like","sourceHandle":"false"},
    {"id":"e-like_current_post-merge_like","source":"like_current_post","target":"merge_like"},
    {"id":"e-merge_like-comment_current_post","source":"merge_like","target":"comment_current_post"}
  ]'::jsonb,
  '[
    {"name":"targetUrl","type":"string","label":"URL bài post"},
    {"name":"enablePostLike","type":"boolean","label":"Like bài trước khi comment"},
    {"name":"commentVariants","type":"array","label":"Danh sách biến thể nội dung comment"},
    {"name":"commentImageBatches","type":"array","label":"Ảnh comment theo lượt"}
  ]'::jsonb,
  '{"targetUrl":"","enablePostLike":false,"commentVariants":[],"commentImageBatches":[]}'::jsonb,
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

UPDATE public.auto_campaign_actions
SET
  workflow_id = (SELECT id FROM public.auto_workflows WHERE name = 'facebook_comment_seeding_post'),
  name = 'Facebook - Comment seeding vào danh sách bài post',
  limit_check_action_codes = ARRAY['fb_comment', 'fb_like_post']::text[],
  is_active = true,
  is_delete = false
WHERE id = 'facebook_comment_seeding_post';

UPDATE public.auto_campaign_actions
SET
  name = 'Facebook - Comment seeding vào danh sách group/page/profile',
  workflow_id = 157,
  limit_check_action_codes = ARRAY['fb_comment', 'fb_like_post']::text[],
  is_active = true,
  is_delete = false
WHERE id = 'facebook_comment_seeding';

COMMIT;
