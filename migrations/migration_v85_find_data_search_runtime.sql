-- Runtime workflow for Facebook - Tìm kiếm data bằng search.
-- Uses Facebook search result pages inspected from a logged-in webview:
--   Post/comment filters: /search/top/?q=...
--   Group filters/results: /search/groups/?q=...

BEGIN;

INSERT INTO public.auto_blocks (
  name, description, icon, category, kind, system_type, code,
  config_schema, output_schema, default_config, is_builtin, staff_id, organization_id, updated_at
)
VALUES
(
  'fb_prepare_search_data_context',
  'Chuẩn bị từ khóa và vùng kết quả cho chiến dịch tìm data bằng Facebook Search.',
  'Search',
  'facebook',
  'js',
  NULL,
$block$
function ensureResults() {
  if (!vars.findDataResults || typeof vars.findDataResults !== 'object') vars.findDataResults = {};
  const results = vars.findDataResults;
  if (!Array.isArray(results.phones)) results.phones = [];
  if (!Array.isArray(results.linkGroupZalos)) results.linkGroupZalos = [];
  if (!Array.isArray(results.uids)) results.uids = [];
  if (!Array.isArray(results.postLinks)) results.postLinks = [];
  if (!Array.isArray(results.groupMembers)) results.groupMembers = [];
  if (!Array.isArray(results.facebookGroups)) results.facebookGroups = [];
  if (!results.sourceData || typeof results.sourceData !== 'object') results.sourceData = {};
  for (const key of ['post', 'comment']) {
    if (!results.sourceData[key] || typeof results.sourceData[key] !== 'object') results.sourceData[key] = {};
    if (!Array.isArray(results.sourceData[key].phones)) results.sourceData[key].phones = [];
    if (!Array.isArray(results.sourceData[key].linkGroupZalos)) results.sourceData[key].linkGroupZalos = [];
    if (!Array.isArray(results.sourceData[key].uids)) results.sourceData[key].uids = [];
  }
  if (!Array.isArray(results.sourceData.post.postLinks)) results.sourceData.post.postLinks = [];
  if (!results.sourceData.facebookGroups || typeof results.sourceData.facebookGroups !== 'object') results.sourceData.facebookGroups = {};
  if (!Array.isArray(results.sourceData.facebookGroups.groups)) results.sourceData.facebookGroups.groups = [];
  return results;
}

const keyword = String(
  vars.inputDataUid ||
  vars.inputDataName ||
  vars.targetUrl ||
  input.keyword ||
  ''
).trim();
if (!keyword) throw new Error('Thiếu từ khóa search');

const hasPostSearch = vars.isFindInPost === true || vars.isFindInComment === true || vars.isFindPostLink === true;
const hasGroupSearch = vars.isFindFacebookGroup === true;
vars.findDataSearchKeyword = keyword;
vars.findDataSearchHasPost = hasPostSearch;
vars.findDataSearchHasGroup = hasGroupSearch;
vars.findDataSearchPosts = [];
vars.findDataSearchComments = [];
vars.findDataSearchGroups = [];
ensureResults();

helpers.log('Chuẩn bị tìm data bằng search với từ khóa "' + keyword + '"');
return { keyword, hasPostSearch, hasGroupSearch };
$block$,
  '[]'::jsonb,
  '[{"name":"keyword","type":"string","label":"Keyword"},{"name":"hasPostSearch","type":"boolean","label":"Has post search"},{"name":"hasGroupSearch","type":"boolean","label":"Has group search"}]'::jsonb,
  '{}'::jsonb,
  true,
  NULL,
  NULL,
  now()
),
(
  'fb_open_search_posts',
  'Mở trang Facebook Search tất cả để dùng bộ lọc bài viết/comment.',
  'Globe',
  'facebook',
  'js',
  NULL,
$block$
if (!vars.findDataSearchHasPost) {
  return { skipped: true, reason: 'Không bật nguồn bài post/comment/link post' };
}

const keyword = String(vars.findDataSearchKeyword || '').trim();
if (!keyword) throw new Error('Thiếu từ khóa search');
const url = 'https://www.facebook.com/search/top/?q=' + encodeURIComponent(keyword);
helpers.log('Mở search bài viết: ' + keyword);
await page.navigate(url);
await helpers.sleep(5000, signal);
await page.waitForSelector('[role="main"]', { timeout: 15000 }).catch(() => false);
return { url, keyword };
$block$,
  '[]'::jsonb,
  '[{"name":"url","type":"string","label":"URL"},{"name":"keyword","type":"string","label":"Keyword"}]'::jsonb,
  '{}'::jsonb,
  true,
  NULL,
  NULL,
  now()
),
(
  'fb_apply_search_post_filters',
  'Áp dụng bộ lọc bài viết trên Facebook Search.',
  'SlidersHorizontal',
  'facebook',
  'js',
  NULL,
$block$
if (!vars.findDataSearchHasPost) {
  return { skipped: true, applied: [] };
}

const filters = {
  recentOnly: vars.searchPostRecentOnly === true || String(vars.sortTypePost || '') === 'recent_activity' || String(vars.sortTypePost || '') === 'new_posts',
  seenOnly: vars.searchPostSeenOnly === true,
  dateFilter: String(vars.searchPostDateFilter || 'all'),
  authorFilter: String(vars.searchPostAuthorFilter || 'all'),
  taggedLocation: String(vars.searchPostTaggedLocation || 'all')
};

const result = await page.evaluate(`
  const filters = __args[0];

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function norm(text) {
    return String(text || '').replace(/\\s+/g, ' ').trim();
  }

  function isVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function clickSynthetic(el) {
    if (!el) return false;
    try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch {}
    const init = { bubbles: true, cancelable: true, view: window };
    try { el.dispatchEvent(new PointerEvent('pointerdown', Object.assign({}, init, { pointerId: 1, pointerType: 'mouse' }))); } catch {}
    try { el.dispatchEvent(new MouseEvent('mousedown', init)); } catch {}
    try { el.dispatchEvent(new PointerEvent('pointerup', Object.assign({}, init, { pointerId: 1, pointerType: 'mouse' }))); } catch {}
    try { el.dispatchEvent(new MouseEvent('mouseup', init)); } catch {}
    try { el.click(); } catch {}
    return true;
  }

  function switchByAria(label, shouldCheck) {
    if (!shouldCheck) return null;
    const el = Array.from(document.querySelectorAll('input[role="switch"], [role="switch"]'))
      .find(node => norm(node.getAttribute('aria-label')).includes(label) && isVisible(node));
    if (!el) return { label, ok: false, reason: 'missing' };
    if (String(el.getAttribute('aria-checked')) !== 'true') clickSynthetic(el);
    return { label, ok: true };
  }

  function optionLabels(kind, value) {
    const map = {
      date: {
        today: ['Hôm nay', 'Today'],
        this_week: ['Tuần này', 'This week'],
        this_month: ['Tháng này', 'This month']
      },
      author: {
        you: ['Bài viết của bạn', 'Bạn', 'Posts from you'],
        friends: ['Bạn bè', 'Your friends'],
        groups_pages: ['Nhóm và Trang', 'Groups and Pages', 'Groups and pages']
      },
      location: {
        near_me: ['Gần tôi', 'Near me']
      }
    };
    return (map[kind] && map[kind][value]) || [];
  }

  async function pickCombobox(ariaPart, labels) {
    if (!labels || labels.length === 0) return null;
    const combo = Array.from(document.querySelectorAll('[role="combobox"], input[role="combobox"]'))
      .find(node => norm(node.getAttribute('aria-label')).includes(ariaPart) && isVisible(node));
    if (!combo) return { label: ariaPart, ok: false, reason: 'missing' };
    clickSynthetic(combo);
    await delay(900);
    const options = Array.from(document.querySelectorAll('[role="option"], [role="menuitemradio"], [role="menuitem"], [role="button"]'))
      .filter(isVisible);
    const option = options.find(node => {
      const text = norm(node.innerText || node.textContent || node.getAttribute('aria-label'));
      return labels.some(label => text === label || text.includes(label));
    });
    if (!option) return { label: ariaPart, ok: false, reason: 'option-missing', labels };
    clickSynthetic(option);
    await delay(1200);
    return { label: ariaPart, ok: true, selected: labels[0] };
  }

  const applied = [];
  const warnings = [];
  const recent = switchByAria('Bài viết mới đây', filters.recentOnly);
  if (recent) (recent.ok ? applied : warnings).push(recent);
  const seen = switchByAria('Bài viết bạn đã xem', filters.seenOnly);
  if (seen) (seen.ok ? applied : warnings).push(seen);

  if (filters.dateFilter && filters.dateFilter !== 'all') {
    const picked = await pickCombobox('Ngày đăng', optionLabels('date', filters.dateFilter));
    if (picked) (picked.ok ? applied : warnings).push(picked);
  }
  if (filters.authorFilter && filters.authorFilter !== 'all') {
    const picked = await pickCombobox('Bài viết của', optionLabels('author', filters.authorFilter));
    if (picked) (picked.ok ? applied : warnings).push(picked);
  }
  if (filters.taggedLocation && filters.taggedLocation !== 'all') {
    const picked = await pickCombobox('Vị trí được gắn thẻ', optionLabels('location', filters.taggedLocation));
    if (picked) (picked.ok ? applied : warnings).push(picked);
  }

  return { applied, warnings };
`, filters);

for (const warning of (Array.isArray(result.warnings) ? result.warnings : [])) {
  helpers.log('Không áp dụng được filter bài viết "' + (warning.label || '') + '": ' + (warning.reason || 'unknown'));
}
return result;
$block$,
  '[]'::jsonb,
  '[{"name":"applied","type":"json","label":"Applied filters"},{"name":"warnings","type":"json","label":"Warnings"}]'::jsonb,
  '{}'::jsonb,
  true,
  NULL,
  NULL,
  now()
),
(
  'fb_collect_search_posts',
  'Tải và đọc bài viết từ trang Facebook Search.',
  'Rows3',
  'facebook',
  'js',
  NULL,
$block$
if (!vars.findDataSearchHasPost) {
  vars.findDataSearchPosts = [];
  return { posts: [] };
}

const limit = Math.max(1, Number(vars.countSearchPostFindData || vars.countPostFindData || 10));
const posts = await page.evaluate(`
  const limit = __args[0];

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function norm(text) {
    return String(text || '').replace(/\\s+/g, ' ').trim();
  }

  function isVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function clickSynthetic(el) {
    if (!el) return false;
    try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch {}
    const init = { bubbles: true, cancelable: true, view: window };
    try { el.dispatchEvent(new PointerEvent('pointerdown', Object.assign({}, init, { pointerId: 1, pointerType: 'mouse' }))); } catch {}
    try { el.dispatchEvent(new MouseEvent('mousedown', init)); } catch {}
    try { el.dispatchEvent(new PointerEvent('pointerup', Object.assign({}, init, { pointerId: 1, pointerType: 'mouse' }))); } catch {}
    try { el.dispatchEvent(new MouseEvent('mouseup', init)); } catch {}
    try { el.click(); } catch {}
    return true;
  }

  function extractUid(href) {
    if (!href) return '';
    try {
      const url = new URL(href, location.href);
      const id = url.searchParams.get('id');
      if (id) return id;
      const parts = url.pathname.split('/').filter(Boolean);
      const userIndex = parts.indexOf('user');
      if (userIndex >= 0 && parts[userIndex + 1]) return parts[userIndex + 1];
      return parts[parts.length - 1] || '';
    } catch {
      return String(href || '').trim();
    }
  }

  function cleanPostLink(href) {
    if (!href) return '';
    try {
      const url = new URL(href, location.href);
      if (!/facebook\\.com$/i.test(url.hostname) && !/\\.facebook\\.com$/i.test(url.hostname)) return '';
      if (url.searchParams.has('comment_id') || url.searchParams.has('reply_comment_id')) return '';
      const path = url.pathname;
      const isPost =
        path.includes('/posts/') ||
        path.includes('/videos/') ||
        path.includes('/reel/') ||
        path.includes('/watch/') ||
        path.includes('/permalink/') ||
        path.includes('/photos/') ||
        path.includes('/story.php') ||
        path.includes('/photo.php') ||
        path.includes('/permalink.php');
      if (!isPost) return '';
      const keep = new URL(url.origin + url.pathname);
      const story = url.searchParams.get('story_fbid');
      const id = url.searchParams.get('id');
      if (story) keep.searchParams.set('story_fbid', story);
      if (id) keep.searchParams.set('id', id);
      return keep.toString();
    } catch {
      return '';
    }
  }

  function findPostElements() {
    const main = document.querySelector('[role="main"]') || document.body;
    const byArticle = Array.from(main.querySelectorAll('[role="article"]'))
      .filter(isVisible)
      .filter(el => {
        const text = norm(el.innerText || el.textContent || '');
        return text.includes('Bình luận') || text.includes('Comment') || text.includes('Chia sẻ') || text.includes('Share');
      });
    if (byArticle.length > 0) return byArticle;

    const roots = [];
    const seen = new Set();
    const messageNodes = Array.from(main.querySelectorAll('[data-ad-comet-preview="message"], [data-ad-preview="message"], [data-ad-rendering-role="story_message"]'))
      .filter(isVisible);
    for (const messageNode of messageNodes) {
      let root = messageNode;
      for (let depth = 0; depth < 12 && root && root.parentElement; depth++) {
        const text = norm(root.innerText || root.textContent || '');
        const hasActions = (text.includes('Bình luận') || text.includes('Comment')) && (text.includes('Chia sẻ') || text.includes('Share') || text.includes('Thích') || text.includes('Like'));
        if (hasActions) break;
        root = root.parentElement;
      }
      if (!root || !isVisible(root)) continue;
      const text = norm(root.innerText || root.textContent || '');
      if (!text.includes('Bình luận') && !text.includes('Comment')) continue;
      const key = norm(messageNode.innerText || messageNode.textContent || text).slice(0, 180);
      if (seen.has(key)) continue;
      seen.add(key);
      roots.push(root);
    }
    return roots;
  }

  let postElements = findPostElements();
  const startedAt = Date.now();
  let stableCount = 0;
  while (postElements.length < limit && Date.now() - startedAt < 180000 && stableCount < 3) {
    const before = postElements.length;
    if (postElements.length > 0) postElements[postElements.length - 1].scrollIntoView({ block: 'end', inline: 'nearest' });
    else window.scrollBy(0, Math.max(700, Math.floor((window.innerHeight || 800) * 0.9)));
    await delay(2200);
    postElements = findPostElements();
    stableCount = postElements.length <= before ? stableCount + 1 : 0;
  }

  const rows = [];
  for (const post of postElements.slice(0, limit)) {
    const moreButtons = Array.from(post.querySelectorAll('[role="button"]'))
      .filter(isVisible)
      .filter(btn => ['Xem thêm', 'See more'].includes(norm(btn.innerText || btn.textContent || btn.getAttribute('aria-label'))))
      .slice(0, 5);
    for (const btn of moreButtons) {
      clickSynthetic(btn);
      await delay(250);
    }

    const contentNodes = Array.from(post.querySelectorAll('[data-ad-comet-preview="message"], [data-ad-preview="message"], [data-ad-rendering-role="story_message"]'))
      .filter(isVisible);
    const contentParts = contentNodes.map(el => norm(el.innerText || el.textContent || '')).filter(Boolean);
    const content = Array.from(new Set(contentParts)).join('\\n').trim() || norm(post.innerText || post.textContent || '');
    const links = Array.from(post.querySelectorAll('a[href]')).filter(isVisible);
    for (const link of links) {
      try { link.dispatchEvent(new FocusEvent('focusin', { bubbles: true, cancelable: true, view: window })); } catch {}
    }
    await delay(150);
    const authorLink = links.find(link => {
      const href = link.href || link.getAttribute('href') || '';
      return href && !href.includes('/groups/') && !cleanPostLink(href);
    }) || null;
    const postLink = links.map(link => cleanPostLink(link.href || link.getAttribute('href') || '')).find(Boolean) || '';
    const authorUrl = authorLink ? (authorLink.href || authorLink.getAttribute('href') || '') : '';
    rows.push({
      index: rows.length + 1,
      content,
      authorUrl,
      authorUid: extractUid(authorUrl),
      postLink
    });
  }

  return rows;
`, limit);

vars.findDataSearchPosts = Array.isArray(posts) ? posts : [];
helpers.log('Đã tải ' + vars.findDataSearchPosts.length + ' bài viết từ search');
return { posts: vars.findDataSearchPosts };
$block$,
  '[]'::jsonb,
  '[{"name":"posts","type":"json","label":"Posts"}]'::jsonb,
  '{}'::jsonb,
  true,
  NULL,
  NULL,
  now()
),
(
  'fb_extract_data_from_search_posts',
  'Lọc nội dung bài viết search và trích số điện thoại, link group Zalo, UID, link bài post.',
  'ScanSearch',
  'data',
  'js',
  NULL,
$block$
function ensureResults() {
  if (!vars.findDataResults || typeof vars.findDataResults !== 'object') vars.findDataResults = {};
  const results = vars.findDataResults;
  if (!Array.isArray(results.phones)) results.phones = [];
  if (!Array.isArray(results.linkGroupZalos)) results.linkGroupZalos = [];
  if (!Array.isArray(results.uids)) results.uids = [];
  if (!Array.isArray(results.postLinks)) results.postLinks = [];
  if (!results.sourceData || typeof results.sourceData !== 'object') results.sourceData = {};
  if (!results.sourceData.post || typeof results.sourceData.post !== 'object') results.sourceData.post = {};
  if (!Array.isArray(results.sourceData.post.phones)) results.sourceData.post.phones = [];
  if (!Array.isArray(results.sourceData.post.linkGroupZalos)) results.sourceData.post.linkGroupZalos = [];
  if (!Array.isArray(results.sourceData.post.uids)) results.sourceData.post.uids = [];
  if (!Array.isArray(results.sourceData.post.postLinks)) results.sourceData.post.postLinks = [];
  return results;
}

function keywordList() {
  return String(vars.keywords || '')
    .split(',')
    .map(x => x.trim().toLowerCase())
    .filter(Boolean);
}

function matchesContent(text) {
  if (!vars.isFindByKeywords) return true;
  const words = keywordList();
  if (words.length === 0) return true;
  const haystack = String(text || '').toLowerCase();
  return words.some(word => haystack.includes(word));
}

function normalizePhone(value) {
  const raw = String(value || '').trim();
  const compact = raw.replace(/[\s.\-]/g, '');
  let digits = compact.replace(/[^\d+]/g, '');
  if (digits.startsWith('+84')) digits = '0' + digits.slice(3);
  else if (digits.startsWith('84')) digits = '0' + digits.slice(2);
  digits = digits.replace(/\D/g, '');
  if (/^0[35789]\d{8}$/.test(digits)) return digits;
  return '';
}

function findPhones(text) {
  const matches = String(text || '').match(/(?:\+84|84|0)[\s.\-]?[35789](?:[\s.\-]?\d){8}\b/g) || [];
  return matches.map(normalizePhone).filter(Boolean);
}

function findZaloLinks(text) {
  const matches = String(text || '').match(/(?:https?:\/\/)?zalo\.me\/g\/[a-z0-9]+/gi) || [];
  return matches.map(x => x.trim()).filter(Boolean);
}

function unique(arr) {
  return Array.from(new Set((arr || []).map(x => String(x || '').trim()).filter(Boolean)));
}

const results = ensureResults();
const sourcePost = results.sourceData.post;
const posts = Array.isArray(input.posts) ? input.posts : (Array.isArray(vars.findDataSearchPosts) ? vars.findDataSearchPosts : []);
let matchedPosts = 0;

for (const post of posts) {
  const content = String(post && post.content ? post.content : '');
  if (!matchesContent(content)) continue;
  matchedPosts++;

  if (vars.isFindInPost && vars.isFindPhone) {
    const phones = findPhones(content);
    results.phones.push(...phones);
    sourcePost.phones.push(...phones);
  }
  if (vars.isFindInPost && vars.isFindLinkGroupZalo) {
    const links = findZaloLinks(content);
    results.linkGroupZalos.push(...links);
    sourcePost.linkGroupZalos.push(...links);
  }
  if (vars.isFindInPost && vars.isFindUid && post && post.authorUid) {
    results.uids.push(String(post.authorUid));
    sourcePost.uids.push(String(post.authorUid));
  }
  if (vars.isFindPostLink && post && post.postLink) {
    results.postLinks.push(String(post.postLink));
    sourcePost.postLinks.push(String(post.postLink));
  }
}

results.phones = unique(results.phones);
results.linkGroupZalos = unique(results.linkGroupZalos);
results.uids = unique(results.uids);
results.postLinks = unique(results.postLinks);
sourcePost.phones = unique(sourcePost.phones);
sourcePost.linkGroupZalos = unique(sourcePost.linkGroupZalos);
sourcePost.uids = unique(sourcePost.uids);
sourcePost.postLinks = unique(sourcePost.postLinks);

return {
  matchedPosts,
  phones: results.phones,
  linkGroupZalos: results.linkGroupZalos,
  uids: results.uids,
  postLinks: results.postLinks
};
$block$,
  '[]'::jsonb,
  '[{"name":"phones","type":"json","label":"Phones"},{"name":"linkGroupZalos","type":"json","label":"Zalo links"},{"name":"uids","type":"json","label":"UIDs"},{"name":"postLinks","type":"json","label":"Post links"}]'::jsonb,
  '{}'::jsonb,
  true,
  NULL,
  NULL,
  now()
),
(
  'fb_collect_search_post_comments',
  'Mở comment trong các bài viết search và đọc comment.',
  'MessageSquareText',
  'facebook',
  'js',
  NULL,
$block$
if (!vars.findDataSearchHasPost || vars.isFindInComment !== true) {
  vars.findDataSearchComments = [];
  return { commentItems: [] };
}

const postLimit = Math.max(1, Number(vars.countSearchPostFindData || vars.countPostFindData || 10));
const commentLimit = Math.max(1, Number(vars.countCommentFindData || 30));
const sortType = String(vars.sortTypeComment || 'most_relevant');

const commentItems = await page.evaluate(`
  const postLimit = __args[0];
  const commentLimit = __args[1];
  const sortType = __args[2];

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function norm(text) {
    return String(text || '').replace(/\\s+/g, ' ').trim();
  }

  function isVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function clickSynthetic(el) {
    if (!el) return false;
    try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch {}
    const init = { bubbles: true, cancelable: true, view: window };
    try { el.dispatchEvent(new PointerEvent('pointerdown', Object.assign({}, init, { pointerId: 1, pointerType: 'mouse' }))); } catch {}
    try { el.dispatchEvent(new MouseEvent('mousedown', init)); } catch {}
    try { el.dispatchEvent(new PointerEvent('pointerup', Object.assign({}, init, { pointerId: 1, pointerType: 'mouse' }))); } catch {}
    try { el.dispatchEvent(new MouseEvent('mouseup', init)); } catch {}
    try { el.click(); } catch {}
    return true;
  }

  function extractUid(href) {
    if (!href) return '';
    try {
      const url = new URL(href, location.href);
      const id = url.searchParams.get('id');
      if (id) return id;
      const parts = url.pathname.split('/').filter(Boolean);
      const userIndex = parts.indexOf('user');
      if (userIndex >= 0 && parts[userIndex + 1]) return parts[userIndex + 1];
      return parts[parts.length - 1] || '';
    } catch {
      return String(href || '').trim();
    }
  }

  function findPostElements() {
    const main = document.querySelector('[role="main"]') || document.body;
    const byArticle = Array.from(main.querySelectorAll('[role="article"]'))
      .filter(isVisible)
      .filter(el => {
        const text = norm(el.innerText || el.textContent || '');
        return text.includes('Bình luận') || text.includes('Comment') || text.includes('Chia sẻ') || text.includes('Share');
      });
    if (byArticle.length > 0) return byArticle;

    const roots = [];
    const seen = new Set();
    const messageNodes = Array.from(main.querySelectorAll('[data-ad-comet-preview="message"], [data-ad-preview="message"], [data-ad-rendering-role="story_message"]'))
      .filter(isVisible);
    for (const messageNode of messageNodes) {
      let root = messageNode;
      for (let depth = 0; depth < 12 && root && root.parentElement; depth++) {
        const text = norm(root.innerText || root.textContent || '');
        const hasActions = (text.includes('Bình luận') || text.includes('Comment')) && (text.includes('Chia sẻ') || text.includes('Share') || text.includes('Thích') || text.includes('Like'));
        if (hasActions) break;
        root = root.parentElement;
      }
      if (!root || !isVisible(root)) continue;
      const text = norm(root.innerText || root.textContent || '');
      if (!text.includes('Bình luận') && !text.includes('Comment')) continue;
      const key = norm(messageNode.innerText || messageNode.textContent || text).slice(0, 180);
      if (seen.has(key)) continue;
      seen.add(key);
      roots.push(root);
    }
    return roots;
  }

  function findCommentButton(post) {
    return Array.from(post.querySelectorAll('[role="button"]'))
      .filter(isVisible)
      .find(btn => {
        const text = norm(btn.innerText || btn.textContent || btn.getAttribute('aria-label'));
        return text === 'Bình luận' || text === 'Comment';
      });
  }

  async function chooseCommentSort(root) {
    if (sortType === 'most_relevant') return;
    const sortButton = Array.from((root || document).querySelectorAll('[role="button"]'))
      .filter(isVisible)
      .find(btn => {
        const text = norm(btn.innerText || btn.textContent || btn.getAttribute('aria-label'));
        return text.includes('Phù hợp nhất') || text.includes('Most relevant');
      });
    if (!sortButton) return;
    clickSynthetic(sortButton);
    await delay(700);
    const labels = sortType === 'newest' ? ['Mới nhất', 'Newest'] : ['Tất cả bình luận', 'All comments'];
    const option = Array.from(document.querySelectorAll('[role="menuitem"], [role="menuitemradio"], [role="option"]'))
      .filter(isVisible)
      .find(el => labels.some(label => norm(el.innerText || el.textContent || el.getAttribute('aria-label')).includes(label)));
    if (option) {
      clickSynthetic(option);
      await delay(1000);
    }
  }

  function commentCandidates(root) {
    return Array.from((root || document).querySelectorAll('[role="article"]'))
      .filter(isVisible)
      .map(el => {
        const text = norm(el.innerText || el.textContent || '');
        const link = Array.from(el.querySelectorAll('a[href]')).find(a => isVisible(a) && (a.href || '').includes('facebook.com'));
        const href = link ? (link.href || link.getAttribute('href') || '') : '';
        return {
          content: text,
          authorUrl: href,
          authorUid: extractUid(href)
        };
      })
      .filter(item => item.content && item.authorUid)
      .slice(0, commentLimit);
  }

  const rows = [];
  const posts = findPostElements().slice(0, postLimit);
  for (let index = 0; index < posts.length; index++) {
    const post = posts[index];
    const btn = findCommentButton(post);
    if (!btn) continue;
    clickSynthetic(btn);
    await delay(2500);
    let root = document.querySelector('[role="dialog"]:not([aria-label="Thông báo"]):not([aria-label="Messenger"]):not([aria-label="Notifications"])') || post;
    await chooseCommentSort(root);
    for (let i = 0; i < 3; i++) {
      const more = Array.from(root.querySelectorAll('[role="button"]'))
        .filter(isVisible)
        .find(el => {
          const text = norm(el.innerText || el.textContent || el.getAttribute('aria-label'));
          return (text.includes('Xem thêm') && text.includes('bình luận')) || (text.includes('View more') && text.includes('comments'));
        });
      if (!more) break;
      clickSynthetic(more);
      await delay(1200);
    }
    root = document.querySelector('[role="dialog"]:not([aria-label="Thông báo"]):not([aria-label="Messenger"]):not([aria-label="Notifications"])') || post;
    const comments = commentCandidates(root);
    comments.forEach(comment => rows.push(Object.assign({ postIndex: index + 1 }, comment)));
    const close = root && root.getAttribute && root.getAttribute('role') === 'dialog'
      ? Array.from(root.querySelectorAll('[role="button"]')).find(el => {
          const label = norm(el.getAttribute('aria-label') || el.innerText || el.textContent || '');
          return label === 'Đóng' || label === 'Close';
        })
      : null;
    if (close) {
      clickSynthetic(close);
      await delay(800);
    }
  }

  return rows;
`, postLimit, commentLimit, sortType);

vars.findDataSearchComments = Array.isArray(commentItems) ? commentItems : [];
helpers.log('Đã tải ' + vars.findDataSearchComments.length + ' comment từ search');
return { commentItems: vars.findDataSearchComments };
$block$,
  '[]'::jsonb,
  '[{"name":"commentItems","type":"json","label":"Comments"}]'::jsonb,
  '{}'::jsonb,
  true,
  NULL,
  NULL,
  now()
),
(
  'fb_extract_data_from_search_comments',
  'Lọc comment search và trích số điện thoại, link group Zalo, UID người comment.',
  'ListFilter',
  'data',
  'js',
  NULL,
$block$
function ensureResults() {
  if (!vars.findDataResults || typeof vars.findDataResults !== 'object') vars.findDataResults = {};
  const results = vars.findDataResults;
  if (!Array.isArray(results.phones)) results.phones = [];
  if (!Array.isArray(results.linkGroupZalos)) results.linkGroupZalos = [];
  if (!Array.isArray(results.uids)) results.uids = [];
  if (!results.sourceData || typeof results.sourceData !== 'object') results.sourceData = {};
  if (!results.sourceData.comment || typeof results.sourceData.comment !== 'object') results.sourceData.comment = {};
  if (!Array.isArray(results.sourceData.comment.phones)) results.sourceData.comment.phones = [];
  if (!Array.isArray(results.sourceData.comment.linkGroupZalos)) results.sourceData.comment.linkGroupZalos = [];
  if (!Array.isArray(results.sourceData.comment.uids)) results.sourceData.comment.uids = [];
  return results;
}

function keywordList() {
  return String(vars.keywords || '')
    .split(',')
    .map(x => x.trim().toLowerCase())
    .filter(Boolean);
}

function matchesContent(text) {
  if (!vars.isFindByKeywords) return true;
  const words = keywordList();
  if (words.length === 0) return true;
  const haystack = String(text || '').toLowerCase();
  return words.some(word => haystack.includes(word));
}

function normalizePhone(value) {
  const raw = String(value || '').trim();
  const compact = raw.replace(/[\s.\-]/g, '');
  let digits = compact.replace(/[^\d+]/g, '');
  if (digits.startsWith('+84')) digits = '0' + digits.slice(3);
  else if (digits.startsWith('84')) digits = '0' + digits.slice(2);
  digits = digits.replace(/\D/g, '');
  if (/^0[35789]\d{8}$/.test(digits)) return digits;
  return '';
}

function findPhones(text) {
  const matches = String(text || '').match(/(?:\+84|84|0)[\s.\-]?[35789](?:[\s.\-]?\d){8}\b/g) || [];
  return matches.map(normalizePhone).filter(Boolean);
}

function findZaloLinks(text) {
  const matches = String(text || '').match(/(?:https?:\/\/)?zalo\.me\/g\/[a-z0-9]+/gi) || [];
  return matches.map(x => x.trim()).filter(Boolean);
}

function unique(arr) {
  return Array.from(new Set((arr || []).map(x => String(x || '').trim()).filter(Boolean)));
}

const results = ensureResults();
const sourceComment = results.sourceData.comment;
const comments = Array.isArray(input.commentItems) ? input.commentItems : (Array.isArray(vars.findDataSearchComments) ? vars.findDataSearchComments : []);
let matchedComments = 0;

if (vars.isFindInComment) {
  for (const comment of comments) {
    const content = String(comment && comment.content ? comment.content : '');
    if (!matchesContent(content)) continue;
    matchedComments++;
    if (vars.isFindPhone) {
      const phones = findPhones(content);
      results.phones.push(...phones);
      sourceComment.phones.push(...phones);
    }
    if (vars.isFindLinkGroupZalo) {
      const links = findZaloLinks(content);
      results.linkGroupZalos.push(...links);
      sourceComment.linkGroupZalos.push(...links);
    }
    if (vars.isFindUid && comment && comment.authorUid) {
      results.uids.push(String(comment.authorUid));
      sourceComment.uids.push(String(comment.authorUid));
    }
  }
}

results.phones = unique(results.phones);
results.linkGroupZalos = unique(results.linkGroupZalos);
results.uids = unique(results.uids);
sourceComment.phones = unique(sourceComment.phones);
sourceComment.linkGroupZalos = unique(sourceComment.linkGroupZalos);
sourceComment.uids = unique(sourceComment.uids);

return {
  matchedComments,
  phones: results.phones,
  linkGroupZalos: results.linkGroupZalos,
  uids: results.uids
};
$block$,
  '[]'::jsonb,
  '[{"name":"phones","type":"json","label":"Phones"},{"name":"linkGroupZalos","type":"json","label":"Zalo links"},{"name":"uids","type":"json","label":"UIDs"}]'::jsonb,
  '{}'::jsonb,
  true,
  NULL,
  NULL,
  now()
),
(
  'fb_open_search_groups',
  'Mở trang Facebook Search nhóm.',
  'Users',
  'facebook',
  'js',
  NULL,
$block$
if (!vars.findDataSearchHasGroup) {
  return { skipped: true, reason: 'Không bật nguồn group Facebook' };
}

const keyword = String(vars.findDataSearchKeyword || '').trim();
if (!keyword) throw new Error('Thiếu từ khóa search');
const url = 'https://www.facebook.com/search/groups/?q=' + encodeURIComponent(keyword);
helpers.log('Mở search group: ' + keyword);
await page.navigate(url);
await helpers.sleep(5000, signal);
await page.waitForSelector('[role="main"]', { timeout: 15000 }).catch(() => false);
return { url, keyword };
$block$,
  '[]'::jsonb,
  '[{"name":"url","type":"string","label":"URL"},{"name":"keyword","type":"string","label":"Keyword"}]'::jsonb,
  '{}'::jsonb,
  true,
  NULL,
  NULL,
  now()
),
(
  'fb_apply_search_group_filters',
  'Áp dụng bộ lọc nhóm trên Facebook Search.',
  'Filter',
  'facebook',
  'js',
  NULL,
$block$
if (!vars.findDataSearchHasGroup) {
  return { skipped: true, applied: [] };
}

const filters = {
  city: String(vars.searchGroupCity || '').trim(),
  nearMe: vars.searchGroupNearMe === true,
  publicOnly: vars.searchGroupPublicOnly === true,
  mineOnly: vars.searchGroupMineOnly === true
};

const result = await page.evaluate(`
  const filters = __args[0];

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function norm(text) {
    return String(text || '').replace(/\\s+/g, ' ').trim();
  }

  function isVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function clickSynthetic(el) {
    if (!el) return false;
    try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch {}
    const init = { bubbles: true, cancelable: true, view: window };
    try { el.dispatchEvent(new PointerEvent('pointerdown', Object.assign({}, init, { pointerId: 1, pointerType: 'mouse' }))); } catch {}
    try { el.dispatchEvent(new MouseEvent('mousedown', init)); } catch {}
    try { el.dispatchEvent(new PointerEvent('pointerup', Object.assign({}, init, { pointerId: 1, pointerType: 'mouse' }))); } catch {}
    try { el.dispatchEvent(new MouseEvent('mouseup', init)); } catch {}
    try { el.click(); } catch {}
    return true;
  }

  function switchByLabel(label, shouldCheck) {
    if (!shouldCheck) return null;
    const nodes = Array.from(document.querySelectorAll('input[role="switch"], [role="switch"], [role="button"]')).filter(isVisible);
    const el = nodes.find(node => {
      const text = norm(node.getAttribute('aria-label') || node.innerText || node.textContent || '');
      return text.includes(label);
    });
    if (!el) return { label, ok: false, reason: 'missing' };
    if (String(el.getAttribute('aria-checked')) !== 'true') clickSynthetic(el);
    return { label, ok: true };
  }

  async function selectCity(city) {
    if (!city) return null;
    const input = Array.from(document.querySelectorAll('input[role="combobox"], [role="combobox"]'))
      .find(node => norm(node.getAttribute('aria-label')).includes('Tỉnh/Thành phố') && isVisible(node));
    if (!input) return { label: 'Tỉnh/Thành phố', ok: false, reason: 'missing' };
    clickSynthetic(input);
    await delay(300);
    if ('value' in input) {
      input.value = city;
      input.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: city }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
    await delay(1400);
    const options = Array.from(document.querySelectorAll('[role="option"], [role="menuitem"], [role="button"]')).filter(isVisible);
    const option = options.find(node => {
      const text = norm(node.innerText || node.textContent || node.getAttribute('aria-label'));
      return text.toLowerCase().includes(city.toLowerCase());
    });
    if (option) {
      clickSynthetic(option);
      await delay(1500);
      return { label: 'Tỉnh/Thành phố', ok: true, selected: city };
    }
    return { label: 'Tỉnh/Thành phố', ok: false, reason: 'option-missing', selected: city };
  }

  const applied = [];
  const warnings = [];
  const city = await selectCity(filters.city);
  if (city) (city.ok ? applied : warnings).push(city);
  for (const item of [
    switchByLabel('Gần tôi', filters.nearMe),
    switchByLabel('Nhóm công khai', filters.publicOnly),
    switchByLabel('Nhóm của tôi', filters.mineOnly)
  ]) {
    if (item) (item.ok ? applied : warnings).push(item);
  }
  return { applied, warnings };
`, filters);

for (const warning of (Array.isArray(result.warnings) ? result.warnings : [])) {
  helpers.log('Không áp dụng được filter group "' + (warning.label || '') + '": ' + (warning.reason || 'unknown'));
}
return result;
$block$,
  '[]'::jsonb,
  '[{"name":"applied","type":"json","label":"Applied filters"},{"name":"warnings","type":"json","label":"Warnings"}]'::jsonb,
  '{}'::jsonb,
  true,
  NULL,
  NULL,
  now()
),
(
  'fb_collect_search_groups',
  'Tải và đọc group từ kết quả Facebook Search.',
  'UsersRound',
  'facebook',
  'js',
  NULL,
$block$
if (!vars.findDataSearchHasGroup) {
  vars.findDataSearchGroups = [];
  return { facebookGroups: [] };
}

const limit = Math.max(1, Number(vars.countSearchGroupFindData || 20));
const minMembers = Math.max(0, Number(vars.minSearchGroupMembers || 0));
const minPostsPerDay = Math.max(0, Number(vars.minSearchGroupPostsPerDay || 0));
const keyword = String(vars.findDataSearchKeyword || '').trim();

const groups = await page.evaluate(`
  const limit = __args[0];
  const minMembers = __args[1];
  const minPostsPerDay = __args[2];
  const keyword = __args[3];

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function norm(text) {
    return String(text || '').replace(/\\s+/g, ' ').trim();
  }

  function isVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function parseNumber(text) {
    const raw = String(text || '').trim();
    if (!raw) return 0;
    const suffixMatch = raw.match(/(k|n|m|tr|triệu|nghìn)$/i);
    const suffix = suffixMatch ? suffixMatch[1].toLowerCase() : '';
    const numberText = raw.replace(/(k|n|m|tr|triệu|nghìn)$/i, '').trim();
    let normalized = numberText;
    if (normalized.includes(',') && !normalized.includes('.')) normalized = normalized.replace(',', '.');
    normalized = normalized.replace(/\\.(?=\\d{3}(\\D|$))/g, '').replace(/,/g, '.');
    const value = Number(normalized);
    if (!Number.isFinite(value)) return 0;
    const multiplier = suffix === 'k' || suffix === 'n' || suffix === 'nghìn'
      ? 1000
      : suffix === 'm' || suffix === 'tr' || suffix === 'triệu'
        ? 1000000
        : 1;
    return Math.round(value * multiplier);
  }

  function normalizeGroupUrl(href) {
    if (!href) return '';
    try {
      const url = new URL(href, location.href);
      const parts = url.pathname.split('/').filter(Boolean);
      const groupIndex = parts.findIndex(part => part.toLowerCase() === 'groups');
      const groupKey = groupIndex >= 0 ? parts[groupIndex + 1] : '';
      if (!groupKey || groupKey === 'feed' || groupKey === 'discover') return '';
      return 'https://www.facebook.com/groups/' + groupKey + '/';
    } catch {
      return '';
    }
  }

  function parseGroupCard(link) {
    const url = normalizeGroupUrl(link.href || link.getAttribute('href') || '');
    if (!url) return null;
    let card = link;
    for (let depth = 0; depth < 8 && card && card.parentElement; depth++) {
      const text = norm(card.innerText || card.textContent || '');
      if (text.includes('thành viên') || text.includes('members') || text.includes('bài viết/ngày') || text.includes('posts/day')) break;
      card = card.parentElement;
    }
    const text = norm(card.innerText || card.textContent || link.innerText || link.textContent || '');
    if (!text || (!text.includes('thành viên') && !text.includes('members'))) return null;
    let name = norm(link.innerText || link.textContent || link.getAttribute('aria-label') || '').replace(/^Ảnh đại diện của\\s+/i, '');
    if (!name) {
      const nameMatch = text.match(/^(.*?)(?:\\s+(?:Công khai|Riêng tư|Public|Private)\\s*·|\\s+[\\d.,]+\\s*(?:K|N|M|Tr|triệu|nghìn)?\\s*(?:thành viên|members))/i);
      name = norm(nameMatch ? nameMatch[1] : '');
    }
    const memberMatch = text.match(/([\\d.,]+\\s*(?:K|N|M|Tr|triệu|nghìn)?)\\s*thành viên/i) || text.match(/([\\d.,]+\\s*(?:K|M)?)\\s*members/i);
    const postMatch = text.match(/([\\d.,]+)\\+?\\s*bài viết\\/ngày/i) || text.match(/([\\d.,]+)\\+?\\s*posts\\/day/i);
    const privacy = text.includes('Công khai') || text.includes('Public')
      ? 'Công khai'
      : text.includes('Riêng tư') || text.includes('Private')
        ? 'Riêng tư'
        : '';
    return {
      url,
      name,
      privacy,
      memberCount: memberMatch ? parseNumber(memberMatch[1]) : 0,
      postsPerDay: postMatch ? parseNumber(postMatch[1]) : 0,
      keyword
    };
  }

  function collect() {
    const main = document.querySelector('[role="main"]') || document.body;
    const links = Array.from(main.querySelectorAll('a[href*="/groups/"]')).filter(isVisible);
    const map = new Map();
    for (const link of links) {
      const group = parseGroupCard(link);
      if (!group) continue;
      const key = group.url.replace(/\\/+$/g, '').toLowerCase();
      if (!key || map.has(key)) continue;
      if (minMembers > 0 && group.memberCount < minMembers) continue;
      if (minPostsPerDay > 0 && group.postsPerDay < minPostsPerDay) continue;
      map.set(key, group);
      if (map.size >= limit) break;
    }
    return Array.from(map.values());
  }

  let rows = collect();
  const startedAt = Date.now();
  let stableCount = 0;
  while (rows.length < limit && Date.now() - startedAt < 180000 && stableCount < 3) {
    const before = rows.length;
    window.scrollBy(0, Math.max(700, Math.floor((window.innerHeight || 800) * 0.9)));
    await delay(2200);
    rows = collect();
    stableCount = rows.length <= before ? stableCount + 1 : 0;
  }

  return rows.slice(0, limit);
`, limit, minMembers, minPostsPerDay, keyword);

vars.findDataSearchGroups = Array.isArray(groups) ? groups : [];
if (!vars.findDataResults || typeof vars.findDataResults !== 'object') vars.findDataResults = {};
if (!Array.isArray(vars.findDataResults.facebookGroups)) vars.findDataResults.facebookGroups = [];
if (!vars.findDataResults.sourceData || typeof vars.findDataResults.sourceData !== 'object') vars.findDataResults.sourceData = {};
if (!vars.findDataResults.sourceData.facebookGroups || typeof vars.findDataResults.sourceData.facebookGroups !== 'object') {
  vars.findDataResults.sourceData.facebookGroups = {};
}
if (!Array.isArray(vars.findDataResults.sourceData.facebookGroups.groups)) vars.findDataResults.sourceData.facebookGroups.groups = [];
vars.findDataResults.facebookGroups.push(...vars.findDataSearchGroups);
vars.findDataResults.sourceData.facebookGroups.groups.push(...vars.findDataSearchGroups.map(group => group.url));
helpers.log('Đã tải ' + vars.findDataSearchGroups.length + ' group Facebook từ search');
return { facebookGroups: vars.findDataSearchGroups };
$block$,
  '[]'::jsonb,
  '[{"name":"facebookGroups","type":"json","label":"Facebook groups"}]'::jsonb,
  '{}'::jsonb,
  true,
  NULL,
  NULL,
  now()
),
(
  'fb_find_search_data_summary',
  'Tổng kết kết quả tìm data bằng Facebook Search.',
  'ClipboardCheck',
  'data',
  'js',
  NULL,
$block$
function unique(arr) {
  return Array.from(new Set((arr || []).map(x => String(x || '').trim()).filter(Boolean)));
}

function uniqueGroups(rawGroups) {
  const map = new Map();
  for (const rawGroup of Array.isArray(rawGroups) ? rawGroups : []) {
    if (!rawGroup || typeof rawGroup !== 'object') continue;
    const url = String(rawGroup.url || '').trim();
    const key = url.replace(/\/+$/g, '').toLowerCase();
    if (!url || !key || map.has(key)) continue;
    map.set(key, {
      url,
      name: String(rawGroup.name || '').trim(),
      privacy: String(rawGroup.privacy || '').trim(),
      memberCount: Number(rawGroup.memberCount || 0),
      postsPerDay: Number(rawGroup.postsPerDay || 0),
      keyword: String(rawGroup.keyword || vars.findDataSearchKeyword || '').trim()
    });
  }
  return Array.from(map.values());
}

function ensureSourceData(results) {
  if (!results.sourceData || typeof results.sourceData !== 'object') results.sourceData = {};
  for (const key of ['post', 'comment']) {
    if (!results.sourceData[key] || typeof results.sourceData[key] !== 'object') results.sourceData[key] = {};
    if (!Array.isArray(results.sourceData[key].phones)) results.sourceData[key].phones = [];
    if (!Array.isArray(results.sourceData[key].linkGroupZalos)) results.sourceData[key].linkGroupZalos = [];
    if (!Array.isArray(results.sourceData[key].uids)) results.sourceData[key].uids = [];
  }
  if (!Array.isArray(results.sourceData.post.postLinks)) results.sourceData.post.postLinks = [];
  if (!results.sourceData.facebookGroups || typeof results.sourceData.facebookGroups !== 'object') results.sourceData.facebookGroups = {};
  if (!Array.isArray(results.sourceData.facebookGroups.groups)) results.sourceData.facebookGroups.groups = [];
  results.sourceData.post.phones = unique(results.sourceData.post.phones);
  results.sourceData.post.linkGroupZalos = unique(results.sourceData.post.linkGroupZalos);
  results.sourceData.post.uids = unique(results.sourceData.post.uids);
  results.sourceData.post.postLinks = unique(results.sourceData.post.postLinks);
  results.sourceData.comment.phones = unique(results.sourceData.comment.phones);
  results.sourceData.comment.linkGroupZalos = unique(results.sourceData.comment.linkGroupZalos);
  results.sourceData.comment.uids = unique(results.sourceData.comment.uids);
  results.sourceData.facebookGroups.groups = unique(results.sourceData.facebookGroups.groups);
  return results.sourceData;
}

const results = vars.findDataResults || {};
const sourceData = ensureSourceData(results);
const facebookGroups = uniqueGroups(results.facebookGroups || vars.findDataSearchGroups || []);
sourceData.facebookGroups.groups = unique([
  ...(sourceData.facebookGroups.groups || []),
  ...facebookGroups.map(group => group.url)
]);
const phones = unique(results.phones);
const linkGroupZalos = unique(results.linkGroupZalos);
const uids = unique(results.uids);
const postLinks = unique(results.postLinks);
const sourceCounts = {
  post: {
    phones: sourceData.post.phones.length,
    linkGroupZalos: sourceData.post.linkGroupZalos.length,
    uids: sourceData.post.uids.length,
    postLinks: sourceData.post.postLinks.length
  },
  comment: {
    phones: sourceData.comment.phones.length,
    linkGroupZalos: sourceData.comment.linkGroupZalos.length,
    uids: sourceData.comment.uids.length
  },
  groupMembers: { uids: 0 },
  newInteractors: { uids: 0 },
  facebookGroups: {
    groups: sourceData.facebookGroups.groups.length
  }
};
const total = phones.length + linkGroupZalos.length + uids.length + postLinks.length + facebookGroups.length;
const notes = [];
if (vars.isFindPhone) notes.push('Đã tìm được ' + phones.length + ' số điện thoại');
if (vars.isFindLinkGroupZalo) notes.push('Đã tìm được ' + linkGroupZalos.length + ' link group Zalo');
if (vars.isFindUid) notes.push('Đã tìm được ' + uids.length + ' UID');
if (vars.isFindPostLink) notes.push('Đã tìm được ' + postLinks.length + ' link bài post');
if (vars.isFindFacebookGroup) notes.push('Đã tìm được ' + facebookGroups.length + ' link group Facebook');
const message = notes.join(' - ') || 'Không có loại data nào được chọn';

vars.findDataResults = { phones, linkGroupZalos, uids, postLinks, groupMembers: [], facebookGroups, sourceData, sourceCounts };
helpers.log(message);

return {
  ok: true,
  searchKeyword: vars.findDataSearchKeyword || vars.inputDataUid || vars.inputDataName || '',
  phones,
  linkGroupZalos,
  uids,
  postLinks,
  groupMembers: [],
  facebookGroups,
  sourceCounts,
  total,
  message
};
$block$,
  '[]'::jsonb,
  '[{"name":"phones","type":"json","label":"Phones"},{"name":"linkGroupZalos","type":"json","label":"Zalo links"},{"name":"uids","type":"json","label":"UIDs"},{"name":"postLinks","type":"json","label":"Post links"},{"name":"facebookGroups","type":"json","label":"Facebook groups"},{"name":"sourceCounts","type":"json","label":"Source counts"},{"name":"total","type":"number","label":"Total"}]'::jsonb,
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
    'fb_prepare_search_data_context',
    'fb_open_search_posts',
    'fb_apply_search_post_filters',
    'fb_collect_search_posts',
    'fb_extract_data_from_search_posts',
    'fb_collect_search_post_comments',
    'fb_extract_data_from_search_comments',
    'fb_open_search_groups',
    'fb_apply_search_group_filters',
    'fb_collect_search_groups',
    'fb_find_search_data_summary'
  )
)
INSERT INTO public.auto_workflows (
  name, description, nodes, edges, variables_schema, default_variables,
  is_builtin, staff_id, organization_id, updated_at
)
SELECT
  '[Built-in] Facebook - Tìm kiếm data bằng search',
  'Workflow tìm data từ Facebook Search: bài viết/comment và link group Facebook.',
  jsonb_build_array(
    jsonb_build_object('id','prepare','blockId',(SELECT id FROM block_ids WHERE name='fb_prepare_search_data_context'),'blockName','fb_prepare_search_data_context','position',jsonb_build_object('x',0,'y',0),'config','{}'::jsonb,'label','Chuẩn bị'),
    jsonb_build_object('id','open_posts','blockId',(SELECT id FROM block_ids WHERE name='fb_open_search_posts'),'blockName','fb_open_search_posts','position',jsonb_build_object('x',260,'y',0),'config','{}'::jsonb,'label','Mở search post'),
    jsonb_build_object('id','post_filters','blockId',(SELECT id FROM block_ids WHERE name='fb_apply_search_post_filters'),'blockName','fb_apply_search_post_filters','position',jsonb_build_object('x',520,'y',0),'config','{}'::jsonb,'label','Lọc bài viết'),
    jsonb_build_object('id','collect_posts','blockId',(SELECT id FROM block_ids WHERE name='fb_collect_search_posts'),'blockName','fb_collect_search_posts','position',jsonb_build_object('x',780,'y',0),'config','{}'::jsonb,'label','Tải bài viết'),
    jsonb_build_object('id','extract_posts','blockId',(SELECT id FROM block_ids WHERE name='fb_extract_data_from_search_posts'),'blockName','fb_extract_data_from_search_posts','position',jsonb_build_object('x',1040,'y',0),'config','{}'::jsonb,'label','Lọc data post'),
    jsonb_build_object('id','collect_comments','blockId',(SELECT id FROM block_ids WHERE name='fb_collect_search_post_comments'),'blockName','fb_collect_search_post_comments','position',jsonb_build_object('x',1300,'y',0),'config','{}'::jsonb,'label','Tải comment'),
    jsonb_build_object('id','extract_comments','blockId',(SELECT id FROM block_ids WHERE name='fb_extract_data_from_search_comments'),'blockName','fb_extract_data_from_search_comments','position',jsonb_build_object('x',1560,'y',0),'config','{}'::jsonb,'label','Lọc data comment'),
    jsonb_build_object('id','open_groups','blockId',(SELECT id FROM block_ids WHERE name='fb_open_search_groups'),'blockName','fb_open_search_groups','position',jsonb_build_object('x',1820,'y',0),'config','{}'::jsonb,'label','Mở search group'),
    jsonb_build_object('id','group_filters','blockId',(SELECT id FROM block_ids WHERE name='fb_apply_search_group_filters'),'blockName','fb_apply_search_group_filters','position',jsonb_build_object('x',2080,'y',0),'config','{}'::jsonb,'label','Lọc group'),
    jsonb_build_object('id','collect_groups','blockId',(SELECT id FROM block_ids WHERE name='fb_collect_search_groups'),'blockName','fb_collect_search_groups','position',jsonb_build_object('x',2340,'y',0),'config','{}'::jsonb,'label','Tải group'),
    jsonb_build_object('id','summary','blockId',(SELECT id FROM block_ids WHERE name='fb_find_search_data_summary'),'blockName','fb_find_search_data_summary','position',jsonb_build_object('x',2600,'y',0),'config','{}'::jsonb,'label','Tổng kết')
  ),
  '[
    {"id":"e-prepare-open-posts","source":"prepare","target":"open_posts"},
    {"id":"e-open-posts-filters","source":"open_posts","target":"post_filters"},
    {"id":"e-post-filters-collect","source":"post_filters","target":"collect_posts"},
    {"id":"e-collect-posts-extract","source":"collect_posts","target":"extract_posts"},
    {"id":"e-extract-posts-comments","source":"extract_posts","target":"collect_comments"},
    {"id":"e-collect-comments-extract","source":"collect_comments","target":"extract_comments"},
    {"id":"e-extract-comments-open-groups","source":"extract_comments","target":"open_groups"},
    {"id":"e-open-groups-filters","source":"open_groups","target":"group_filters"},
    {"id":"e-group-filters-collect","source":"group_filters","target":"collect_groups"},
    {"id":"e-collect-groups-summary","source":"collect_groups","target":"summary"}
  ]'::jsonb,
  '[
    {"name":"inputDataUid","type":"string","label":"Từ khóa"},
    {"name":"isFindPhone","type":"boolean","label":"Tìm số điện thoại","default":false},
    {"name":"isFindLinkGroupZalo","type":"boolean","label":"Tìm link group Zalo","default":false},
    {"name":"isFindUid","type":"boolean","label":"Tìm UID","default":false},
    {"name":"isFindPostLink","type":"boolean","label":"Tìm link bài post","default":false},
    {"name":"isFindFacebookGroup","type":"boolean","label":"Tìm link group Facebook","default":false},
    {"name":"isFindInPost","type":"boolean","label":"Tìm trên post","default":false},
    {"name":"isFindInComment","type":"boolean","label":"Tìm trong comment","default":false},
    {"name":"countSearchPostFindData","type":"number","label":"Số post tối đa / từ khóa","default":10},
    {"name":"countCommentFindData","type":"number","label":"Số comment tối đa / post","default":30},
    {"name":"countSearchGroupFindData","type":"number","label":"Số group tối đa / từ khóa","default":20},
    {"name":"searchPostRecentOnly","type":"boolean","label":"Bài viết mới đây","default":false},
    {"name":"searchPostSeenOnly","type":"boolean","label":"Bài viết đã xem","default":false},
    {"name":"searchPostDateFilter","type":"string","label":"Ngày đăng","default":"all"},
    {"name":"searchPostAuthorFilter","type":"string","label":"Bài viết của","default":"all"},
    {"name":"searchPostTaggedLocation","type":"string","label":"Vị trí được gắn thẻ","default":"all"},
    {"name":"searchGroupCity","type":"string","label":"Tỉnh/Thành phố","default":""},
    {"name":"searchGroupNearMe","type":"boolean","label":"Gần tôi","default":false},
    {"name":"searchGroupPublicOnly","type":"boolean","label":"Nhóm công khai","default":false},
    {"name":"searchGroupMineOnly","type":"boolean","label":"Nhóm của tôi","default":false},
    {"name":"minSearchGroupMembers","type":"number","label":"Thành viên tối thiểu","default":0},
    {"name":"minSearchGroupPostsPerDay","type":"number","label":"Bài đăng tối thiểu/ngày","default":0},
    {"name":"isFindByKeywords","type":"boolean","label":"Lọc từ khoá nội dung","default":false},
    {"name":"keywords","type":"string","label":"Từ khoá nội dung","default":""}
  ]'::jsonb,
  '{
    "isFindPhone": true,
    "isFindLinkGroupZalo": false,
    "isFindUid": false,
    "isFindPostLink": false,
    "isFindFacebookGroup": false,
    "isFindInPost": true,
    "isFindInComment": false,
    "countSearchPostFindData": 10,
    "countCommentFindData": 30,
    "countSearchGroupFindData": 20,
    "searchPostRecentOnly": false,
    "searchPostSeenOnly": false,
    "searchPostDateFilter": "all",
    "searchPostAuthorFilter": "all",
    "searchPostTaggedLocation": "all",
    "searchGroupCity": "",
    "searchGroupNearMe": false,
    "searchGroupPublicOnly": false,
    "searchGroupMineOnly": false,
    "minSearchGroupMembers": 0,
    "minSearchGroupPostsPerDay": 0,
    "isFindByKeywords": false,
    "keywords": ""
  }'::jsonb,
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

WITH wf AS (
  SELECT id
  FROM public.auto_workflows
  WHERE name = '[Built-in] Facebook - Tìm kiếm data bằng search'
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
  'facebook_find_data_search',
  'Facebook - Tìm kiếm data bằng search',
  'facebook',
  true,
  wf.id,
  '{}'::text[],
  false,
  now()
FROM wf
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  flatform_type = EXCLUDED.flatform_type,
  is_active = true,
  workflow_id = EXCLUDED.workflow_id,
  limit_check_action_codes = EXCLUDED.limit_check_action_codes,
  is_delete = false;

NOTIFY pgrst, 'reload schema';

COMMIT;
