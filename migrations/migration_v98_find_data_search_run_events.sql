-- Add structured run-event logging and complete extraction data for facebook_find_data_search.
-- Source of truth: DB auto_blocks snapshot captured at 2026-06-05T20:06:35.392Z.

BEGIN;

INSERT INTO public.auto_elements (name, xpath, description, category, is_builtin, staff_id, organization_id, updated_at)
VALUES (
  'fb_search_post_in_uid',
  '//*[@class=''x1yztbdb x1n2onr6 xh8yej3 x1ja2u2z'']',
  'Bài viết trong kết quả search Facebook',
  'facebook',
  true,
  null,
  null,
  now()
),
(
  'fb_group_user_author_in_post',
  './/a[contains(@href,''/groups/'') and contains(@href,''/user/'') and @tabindex=''0'']',
  'Link người đăng bài dạng group user trong post',
  'facebook',
  true,
  null,
  null,
  now()
)
ON CONFLICT (name) DO UPDATE SET
  xpath = EXCLUDED.xpath,
  description = EXCLUDED.description,
  category = EXCLUDED.category,
  is_builtin = EXCLUDED.is_builtin,
  staff_id = EXCLUDED.staff_id,
  organization_id = EXCLUDED.organization_id,
  updated_at = now();

CREATE TEMP TABLE _find_data_search_block_codes (
  id bigint PRIMARY KEY,
  name text NOT NULL,
  code text NOT NULL
) ON COMMIT DROP;

INSERT INTO _find_data_search_block_codes (id, name, code)
VALUES
  (2714, 'fb_prepare_search_data_context', $fds_fb_prepare_search_data_context$
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

$fds_fb_prepare_search_data_context$),
  (2715, 'fb_open_search_posts', $fds_fb_open_search_posts$
  if (!vars.findDataSearchHasPost) {
    return { skipped: true, reason: 'Không bật nguồn bài post/comment/link post' };
  }

  const keyword = String(vars.findDataSearchKeyword || '').trim();
  if (!keyword) throw new Error('Thiếu từ khóa search');
  const url = 'https://www.facebook.com/search/top/?q=' + encodeURIComponent(keyword);
  try {
    helpers.log('Mở search bài viết: ' + keyword);
    await page.navigate(url);
    await helpers.sleep(5000, signal);
    const selectorReady = await page.waitForSelector('[role="main"]', { timeout: 15000 }).catch(() => false);
    await helpers.logRunEvent({
      eventType: 'open_search_posts',
      eventName: 'Mở search bài viết',
      targetType: 'post',
      status: 'success',
      isUserVisible: false,
      targetUrl: url,
      message: 'Mở search bài viết với từ khóa "' + keyword + '"',
      debugData: { searchKeyword: keyword, selectorReady: !!selectorReady }
    });
    return { url, keyword };
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    await helpers.logRunEvent({
      eventType: 'open_search_posts',
      eventName: 'Mở search bài viết',
      targetType: 'post',
      status: 'failed',
      isUserVisible: false,
      targetUrl: url,
      message,
      debugData: { searchKeyword: keyword }
    });
    throw err;
  }

$fds_fb_open_search_posts$),
  (2716, 'fb_apply_search_post_filters', $fds_fb_apply_search_post_filters$

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

const warnings = Array.isArray(result.warnings) ? result.warnings : [];
for (const warning of warnings) {
  helpers.log('Không áp dụng được filter bài viết "' + (warning.label || '') + '": ' + (warning.reason || 'unknown'));
}
await helpers.logRunEvent({
  eventType: 'apply_search_post_filters',
  eventName: 'Áp dụng filter bài viết',
  targetType: 'post',
  status: warnings.length > 0 ? 'failed' : 'success',
  isUserVisible: false,
  message: warnings.length > 0 ? 'Có filter không áp dụng được' : 'Đã áp dụng filter',
  debugData: { applied: Array.isArray(result.applied) ? result.applied : [], warnings, searchKeyword: vars.findDataSearchKeyword || '' }
});
return result;

$fds_fb_apply_search_post_filters$),
  (2717, 'fb_collect_search_posts', $fds_fb_collect_search_posts$
  if (!vars.findDataSearchHasPost) {
    vars.findDataSearchPosts = [];
    return { posts: [] };
  }

  const selectors = {
    posts: await helpers.element('fb_search_post_in_uid'),
    seeMore: await helpers.element('fb_see_more_content_post_btn'),
    groupUserAuthorInPost: await helpers.element('fb_group_user_author_in_post'),
    uidInPost: await helpers.element('fb_uid_in_post_in_uid'),
    content: await helpers.element('fb_content_in_post_in_uid'),
    rawPostLink: await helpers.element('RawPostLinkInUid'),
    postLink: await helpers.element('PostLinkInUid')
  };
  const limit = Math.max(1, Number(vars.countSearchPostFindData || vars.countPostFindData || 10));
  const collectPostLinks = true;

  const posts = await page.evaluate(String.raw`
    const selectors = __args[0];
    const limit = __args[1];
    const collectPostLinks = __args[2] === true;

    function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
    function norm(text) { return String(text || '').replace(/\s+/g, ' ').trim(); }
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
      const context = root || document;
      try {
        const result = document.evaluate(xpath, context, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
        for (let i = 0; i < result.snapshotLength; i++) out.push(result.snapshotItem(i));
      } catch {}
      const filtered = out.filter(Boolean);
      if (root && root !== document && root.nodeType === 1) {
        return filtered.filter(el => el === root || (root.contains && root.contains(el)));
      }
      return filtered;
    }
    function clickSynthetic(el) {
      if (!el) return false;
      try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch {}
      const init = { bubbles: true, cancelable: true, view: window };
      try { el.dispatchEvent(new PointerEvent('pointerdown', Object.assign({}, init, { pointerId: 1, pointerType: 'mouse' }))); } catch {}
      try { el.dispatchEvent(new MouseEvent('mousedown', init)); } catch {}
      try { el.dispatchEvent(new PointerEvent('pointerup', Object.assign({}, init, { pointerId: 1, pointerType: 'mouse' }))); } catch {}
      try { el.dispatchEvent(new MouseEvent('mouseup', init)); } catch {}
      try { el.click(); return true; } catch {}
      return false;
    }
    function simulateFocusin(element) {
      if (!element) return;
      try { element.dispatchEvent(new FocusEvent('focusin', { view: window, bubbles: true, cancelable: true })); }
      catch { try { element.dispatchEvent(new Event('focusin', { bubbles: true, cancelable: true })); } catch {} }
    }
    function hrefOf(el) { return el ? (el.href || el.getAttribute('href') || '') : ''; }
    function cleanPostHref(href) {
      if (!href) return '';
      try {
        const url = new URL(href, location.href);
        if (/^(m|mbasic|mobile)\.facebook\.com$/i.test(url.hostname)) url.hostname = 'www.facebook.com';
        if (!/facebook\.com$/i.test(url.hostname) && !/\.facebook\.com$/i.test(url.hostname)) return '';
        const multiPermalink = String(url.searchParams.get('multi_permalinks') || '').trim();
        if (multiPermalink) {
          const parts = url.pathname.split('/').filter(Boolean);
          const groupIndex = parts.indexOf('groups');
          const groupId = groupIndex >= 0 ? String(parts[groupIndex + 1] || '').trim() : '';
          if (groupId) return 'https://www.facebook.com/groups/' + encodeURIComponent(groupId) + '/posts/' + encodeURIComponent(multiPermalink) + '/';
        }
        url.hash = '';
        Array.from(url.searchParams.keys()).forEach(key => {
          if (key.startsWith('__') || key === 'mibextid' || key === 'ref' || key === 'locale' || key === 'comment_id' || key === 'reply_comment_id') {
            url.searchParams.delete(key);
          }
        });
        return url.href;
      } catch { return String(href || '').trim(); }
    }
    function normalizeHref(href) { return cleanPostHref(href); }
    function isCommentPermalink(href) {
      if (!href) return false;
      try {
        const url = new URL(href, location.href);
        if (url.searchParams.has('comment_id') || url.searchParams.has('reply_comment_id')) return true;
        const rawQuery = String(url.search || '').toLowerCase();
        return rawQuery.includes('comment_id=') || rawQuery.includes('reply_comment_id=');
      } catch {
        const raw = String(href || '').toLowerCase();
        return raw.includes('comment_id=') || raw.includes('reply_comment_id=');
      }
    }
    function isPostPermalink(href) {
      if (!href || isCommentPermalink(href)) return false;
      const raw = String(href || '');
      if (raw.includes('/hashtag/') || raw.includes('hashtag_id=')) return false;
      return raw.includes('/posts/') || raw.includes('story_fbid=') || raw.includes('multi_permalinks=') || raw.includes('/videos/') || raw.includes('/reel/') || raw.includes('/watch/') || raw.includes('/permalink/') || raw.includes('/photos/') || raw.includes('/photo.php') || raw.includes('/permalink.php');
    }
    function firstPostLink(post) {
      const links = xpathAll(selectors.postLink, post)
        .map(el => normalizeHref(hrefOf(el)))
        .filter(Boolean)
        .filter(isPostPermalink);
      if (links[0]) return links[0];
      return Array.from(post.querySelectorAll('a[href]'))
        .map(link => normalizeHref(hrefOf(link)))
        .filter(Boolean)
        .filter(isPostPermalink)[0] || '';
    }
    async function resolvePostLink(post) {
      let rawPostLink = '';
      let postLink = firstPostLink(post);
      if (postLink) return { rawPostLink, postLink };
      const rawLinks = xpathAll(selectors.rawPostLink, post)
        .filter(el => !isCommentPermalink(normalizeHref(hrefOf(el))))
        .slice(0, 5);
      if (rawLinks.length === 0) {
        rawLinks.push(...Array.from(post.querySelectorAll('a[href]')).filter(el => !isCommentPermalink(normalizeHref(hrefOf(el)))).slice(0, 5));
      }
      for (const rawLinkEl of rawLinks) {
        rawPostLink = rawPostLink || cleanPostHref(hrefOf(rawLinkEl));
        try { rawLinkEl.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch {}
        simulateFocusin(rawLinkEl);
        await delay(500);
        const focusedRawPostLink = cleanPostHref(hrefOf(rawLinkEl));
        if (focusedRawPostLink && (!rawPostLink || rawPostLink.includes('/search/'))) rawPostLink = focusedRawPostLink;
        postLink = firstPostLink(post);
        if (postLink) break;
      }
      return { rawPostLink, postLink };
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
      } catch { return String(href || '').trim(); }
    }
    function findPostElementsFallback() {
      const main = document.querySelector('[role="main"]') || document.body;
      const byArticle = Array.from(main.querySelectorAll('[role="article"]')).filter(isVisible).filter(el => {
        const text = norm(el.innerText || el.textContent || '');
        return text.includes('Bình luận') || text.includes('Comment') || text.includes('Chia sẻ') || text.includes('Share');
      });
      if (byArticle.length > 0) return byArticle;
      const roots = [];
      const seen = new Set();
      const messageNodes = Array.from(main.querySelectorAll('[data-ad-comet-preview="message"], [data-ad-preview="message"], [data-ad-rendering-role="story_message"]')).filter(isVisible);
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
    function getPostElements() {
      const fromElement = xpathAll(selectors.posts).filter(isVisible);
      return fromElement.length > 0 ? fromElement : findPostElementsFallback();
    }

    let postElements = getPostElements();
    const startedAt = Date.now();
    let stableCount = 0;
    while (postElements.length < limit && Date.now() - startedAt < 180000 && stableCount < 3) {
      const oldCount = postElements.length;
      if (postElements.length > 0) postElements[postElements.length - 1].scrollIntoView({ block: 'end', inline: 'nearest' });
      else window.scrollBy(0, Math.max(700, Math.floor((window.innerHeight || 800) * 0.9)));
      await delay(2200);
      postElements = getPostElements();
      stableCount = postElements.length <= oldCount ? stableCount + 1 : 0;
    }

    const rows = [];
    const selected = postElements.slice(0, limit);
    for (let i = 0; i < selected.length; i++) {
      const post = selected[i];
      const seeMoreButtons = xpathAll(selectors.seeMore, post).filter(isVisible).slice(0, 5);
      if (seeMoreButtons.length === 0) {
        seeMoreButtons.push(...Array.from(post.querySelectorAll('[role="button"]')).filter(isVisible).filter(btn => ['Xem thêm', 'See more'].includes(norm(btn.innerText || btn.textContent || btn.getAttribute('aria-label')))).slice(0, 5));
      }
      for (const btn of seeMoreButtons) { clickSynthetic(btn); await delay(300); }
      const contentParts = xpathAll(selectors.content, post).map(el => (el.innerText || el.textContent || '').trim()).filter(Boolean);
      if (contentParts.length === 0) {
        contentParts.push(...Array.from(post.querySelectorAll('[data-ad-comet-preview="message"], [data-ad-preview="message"], [data-ad-rendering-role="story_message"]')).filter(isVisible).map(el => (el.innerText || el.textContent || '').trim()).filter(Boolean));
      }
      const content = Array.from(new Set(contentParts)).join('\n').trim() || (post.innerText || post.textContent || '').trim();
      const fallbackVisibleProfileLink = Array.from(post.querySelectorAll('a[href]')).filter(isVisible).find(link => {
        const href = hrefOf(link);
        return href && !href.includes('/groups/') && !isPostPermalink(href) && !isCommentPermalink(href);
      }) || null;
      const authorLink = xpathAll(selectors.groupUserAuthorInPost, post)[0] || xpathAll(selectors.uidInPost, post)[0] || fallbackVisibleProfileLink;
      const authorUrl = authorLink ? hrefOf(authorLink) : '';
      const authorName = authorLink ? (authorLink.innerText || authorLink.textContent || '').trim() : '';
      const linkInfo = collectPostLinks ? await resolvePostLink(post) : { rawPostLink: '', postLink: '' };
      rows.push({
        index: i + 1,
        content,
        authorUrl,
        authorName,
        authorUid: extractUid(authorUrl),
        rawPostLink: linkInfo.rawPostLink || '',
        postLink: linkInfo.postLink || ''
      });
    }
    return rows;
  `, selectors, limit, collectPostLinks);

  vars.findDataSearchPosts = Array.isArray(posts) ? posts : [];
  helpers.log('Đã tải ' + vars.findDataSearchPosts.length + ' bài viết từ search');
  await helpers.logRunEvent({
    eventType: 'scroll_search_posts',
    eventName: 'Cuộn search bài viết',
    targetType: 'feed',
    status: 'success',
    isUserVisible: false,
    xpath: selectors.posts,
    message: 'Đã cuộn search để tải bài viết',
    debugData: { limit, collectPostLinks, searchKeyword: vars.findDataSearchKeyword || '' }
  });
  await helpers.logRunEvent({
    eventType: 'collect_posts',
    eventName: 'Lấy danh sách bài post',
    targetType: 'post',
    status: 'success',
    isUserVisible: true,
    xpath: selectors.posts,
    elementCount: vars.findDataSearchPosts.length,
    message: 'Lấy được ' + vars.findDataSearchPosts.length + ' bài viết từ search',
    debugData: { limit, collectPostLinks, searchKeyword: vars.findDataSearchKeyword || '' }
  });
  return { posts: vars.findDataSearchPosts };

$fds_fb_collect_search_posts$),
  (2718, 'fb_extract_data_from_search_posts', $fds_fb_extract_data_from_search_posts$
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
  function normalizeKeywordText(value) {
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
  }
  function keywordList() {
    return String(vars.keywords || '').split(',').map(x => normalizeKeywordText(x.trim())).filter(Boolean);
  }
  function matchesContent(text) {
    if (!vars.isFindByKeywords) return true;
    const words = keywordList();
    if (words.length === 0) return true;
    const haystack = normalizeKeywordText(text);
    return words.some(word => haystack.includes(word));
  }
  function isMeaningAiEnabled() { return vars.isFindByContentAI === true && String(vars.contentAI || '').trim().length > 0; }
  function createEmptyMeaningAiCheck() {
    return { ok: true, matched: true, checkResult: '', prompt: String(vars.contentAI || ''), finalPrompt: '', rawResult: '', reason: '', error: '' };
  }
  function normalizeMeaningAiCheck(result) {
    if (result && result.unsupported) {
      return { ok: false, matched: false, checkResult: 'error', prompt: String(vars.contentAI || ''), finalPrompt: '', rawResult: '', reason: 'Runtime chưa hỗ trợ helper checkFindDataMeaningAI', error: 'Runtime chưa hỗ trợ helper checkFindDataMeaningAI' };
    }
    const raw = result && typeof result === 'object' ? result : {};
    const checkResult = String(raw.checkResult || raw.check_result || (raw.ok === true ? (raw.matched === true ? 'matched' : 'not_matched') : 'error'));
    return { ok: raw.ok === true, matched: raw.matched === true, checkResult, prompt: String(raw.prompt || vars.contentAI || ''), finalPrompt: String(raw.finalPrompt || raw.final_prompt || ''), rawResult: String(raw.rawResult || raw.raw_result || ''), reason: String(raw.reason || raw.error || ''), error: String(raw.error || '') };
  }
  async function checkMeaningAi(content, entityType) {
    if (!isMeaningAiEnabled()) return createEmptyMeaningAiCheck();
    const result = await helpers.checkFindDataMeaningAI({ contentText: String(content || ''), prompt: String(vars.contentAI || ''), entityType });
    return normalizeMeaningAiCheck(result);
  }
  function isMeaningAiAccepted(aiCheck) { return !isMeaningAiEnabled() || (aiCheck && aiCheck.ok === true && aiCheck.matched === true); }
  function isMeaningAiFailed(aiCheck) { return isMeaningAiEnabled() && (!aiCheck || aiCheck.ok !== true); }
  function getMeaningAiMessage(aiCheck) {
    if (isMeaningAiFailed(aiCheck)) return 'Lỗi kiểm tra ý nghĩa AI: ' + String(aiCheck && (aiCheck.error || aiCheck.reason) ? (aiCheck.error || aiCheck.reason) : 'Không rõ nguyên nhân');
    if (isMeaningAiEnabled() && aiCheck && aiCheck.matched !== true) return 'Không đúng ý nghĩa AI';
    return 'Đúng ý nghĩa AI';
  }
  function buildFilterData(matchedKeyword, aiCheck) {
    const keywordEnabled = vars.isFindByKeywords === true && String(vars.keywords || '').trim().length > 0;
    const rawResult = String(aiCheck && aiCheck.rawResult ? aiCheck.rawResult : '');
    const reason = String(aiCheck && aiCheck.reason ? aiCheck.reason : '');
    return { keywordEnabled, keyword: keywordEnabled ? String(vars.keywords || '') : null, matchedKeyword: keywordEnabled ? matchedKeyword : null, aiPrompt: String(vars.contentAI || '') || null, aiFinalPrompt: String(aiCheck && aiCheck.finalPrompt ? aiCheck.finalPrompt : ''), aiRawResult: rawResult, aiCheckResult: String(aiCheck && aiCheck.checkResult ? aiCheck.checkResult : ''), aiMatched: aiCheck && typeof aiCheck.matched === 'boolean' ? aiCheck.matched : null, aiReason: reason || null, aiResult: rawResult || null };
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
  function unique(arr) { return Array.from(new Set((arr || []).map(x => String(x || '').trim()).filter(Boolean))); }
  function authorUidFromItem(item) {
    const rawHref = String(item && item.authorUrl ? item.authorUrl : '').trim();
    const fallbackUid = String(item && item.authorUid ? item.authorUid : '').trim();
    const href = rawHref.toLowerCase();
    if (href.includes('/permalink/') || href.includes('/posts/') || href.includes('story_fbid=') || href.includes('comment_id=') || href.includes('reply_comment_id=') || (href.includes('/groups/') && !href.includes('/user/'))) return '';
    try {
      const url = new URL(rawHref, 'https://www.facebook.com');
      const id = url.searchParams.get('id');
      if (id) return id.trim();
      const parts = url.pathname.split('/').map(part => { try { return decodeURIComponent(part); } catch { return part; } }).map(part => part.trim()).filter(Boolean);
      const userIndex = parts.indexOf('user');
      if (userIndex >= 0 && parts[userIndex + 1]) return parts[userIndex + 1];
      const last = parts[parts.length - 1] || '';
      const blockedLastParts = new Set(['profile.php', 'groups', 'posts', 'permalink', 'story.php', 'photo.php', 'photos', 'watch', 'reel']);
      if (last && !blockedLastParts.has(last.toLowerCase())) return last;
    } catch {}
    return fallbackUid;
  }

  const results = ensureResults();
  const sourcePost = results.sourceData.post;
  const posts = Array.isArray(input.posts) ? input.posts : (Array.isArray(vars.findDataSearchPosts) ? vars.findDataSearchPosts : []);
  let matchedPosts = 0;

  if (vars.findDataSearchHasPost) {
    for (const post of posts) {
      const content = String(post && post.content ? post.content : '');
      const contentMatches = matchesContent(content);
      const meaningAiCheck = (vars.isFindInPost || vars.isFindPostLink) && contentMatches ? await checkMeaningAi(content, 'post') : createEmptyMeaningAiCheck();
      const meaningAiAccepted = isMeaningAiAccepted(meaningAiCheck);
      const postAuthorUidForLog = authorUidFromItem(post);
      const postAuthorNameForLog = String(post && post.authorName ? post.authorName : '').trim();
      const postPhonesForLog = findPhones(content);
      const postZaloLinksForLog = findZaloLinks(content);
      const postLinksForLog = post && post.postLink ? [String(post.postLink)] : [];
      const postIndex = post && post.index ? post.index : null;
      const postUrl = String(post && post.postLink ? post.postLink : '');

      if ((vars.isFindInPost || vars.isFindPostLink) && !contentMatches) {
        await helpers.logRunEvent({ eventType: 'extract_post_data', eventName: 'Lấy thông tin bài post', targetType: 'post', status: 'skipped', isUserVisible: true, itemIndex: postIndex, targetUrl: postUrl, message: 'Không chứa keyword', extractedData: { entity: { type: 'post', url: postUrl, name: postAuthorNameForLog || null, uid: postAuthorUidForLog || null, contentText: content }, filters: buildFilterData(false, createEmptyMeaningAiCheck()), values: { phones: postPhonesForLog, zaloGroupLinks: postZaloLinksForLog, postLinks: postLinksForLog, uids: unique([postAuthorUidForLog].filter(Boolean)) } }, debugData: { postIndex, authorName: postAuthorNameForLog, authorUrl: String(post && post.authorUrl ? post.authorUrl : ''), rawPostLink: String(post && post.rawPostLink ? post.rawPostLink : ''), searchKeyword: vars.findDataSearchKeyword || '' } });
        continue;
      }

      if ((vars.isFindInPost || vars.isFindPostLink) && contentMatches && !meaningAiAccepted) {
        await helpers.logRunEvent({ eventType: 'extract_post_data', eventName: 'Lấy thông tin bài post', targetType: 'post', status: isMeaningAiFailed(meaningAiCheck) ? 'failed' : 'skipped', isUserVisible: true, itemIndex: postIndex, targetUrl: postUrl, message: getMeaningAiMessage(meaningAiCheck), extractedData: { entity: { type: 'post', url: postUrl, name: postAuthorNameForLog || null, uid: postAuthorUidForLog || null, contentText: content }, filters: buildFilterData(true, meaningAiCheck), values: { phones: postPhonesForLog, zaloGroupLinks: postZaloLinksForLog, postLinks: postLinksForLog, uids: unique([postAuthorUidForLog].filter(Boolean)) } }, debugData: { postIndex, authorName: postAuthorNameForLog, authorUrl: String(post && post.authorUrl ? post.authorUrl : ''), rawPostLink: String(post && post.rawPostLink ? post.rawPostLink : ''), searchKeyword: vars.findDataSearchKeyword || '' } });
        continue;
      }

      if ((vars.isFindInPost || vars.isFindPostLink) && contentMatches && meaningAiAccepted) {
        matchedPosts++;
        if (vars.isFindInPost && vars.isFindPhone) { results.phones.push(...postPhonesForLog); sourcePost.phones.push(...postPhonesForLog); }
        if (vars.isFindInPost && vars.isFindLinkGroupZalo) { results.linkGroupZalos.push(...postZaloLinksForLog); sourcePost.linkGroupZalos.push(...postZaloLinksForLog); }
        if (vars.isFindInPost && vars.isFindUid && postAuthorUidForLog) { results.uids.push(postAuthorUidForLog); sourcePost.uids.push(postAuthorUidForLog); }
        if (vars.isFindPostLink) { results.postLinks.push(...postLinksForLog); sourcePost.postLinks.push(...postLinksForLog); }
        await helpers.logRunEvent({ eventType: 'extract_post_data', eventName: 'Lấy thông tin bài post', targetType: 'post', status: 'success', isUserVisible: true, itemIndex: postIndex, targetUrl: postUrl, message: 'Đã duyệt bài post #' + (postIndex || ''), extractedData: { entity: { type: 'post', url: postUrl, name: postAuthorNameForLog || null, uid: postAuthorUidForLog || null, contentText: content }, filters: buildFilterData(contentMatches, meaningAiCheck), values: { phones: postPhonesForLog, zaloGroupLinks: postZaloLinksForLog, postLinks: postLinksForLog, uids: unique([postAuthorUidForLog].filter(Boolean)) } }, debugData: { postIndex, authorName: postAuthorNameForLog, authorUrl: String(post && post.authorUrl ? post.authorUrl : ''), rawPostLink: String(post && post.rawPostLink ? post.rawPostLink : ''), searchKeyword: vars.findDataSearchKeyword || '' } });
      }
    }
  }

  results.phones = unique(results.phones); results.linkGroupZalos = unique(results.linkGroupZalos); results.uids = unique(results.uids); results.postLinks = unique(results.postLinks);
  sourcePost.phones = unique(sourcePost.phones); sourcePost.linkGroupZalos = unique(sourcePost.linkGroupZalos); sourcePost.uids = unique(sourcePost.uids); sourcePost.postLinks = unique(sourcePost.postLinks);
  return { matchedPosts, phones: results.phones, linkGroupZalos: results.linkGroupZalos, uids: results.uids, postLinks: results.postLinks };

$fds_fb_extract_data_from_search_posts$),
  (2719, 'fb_collect_search_post_comments', $fds_fb_collect_search_post_comments$
  if (!vars.findDataSearchHasPost || vars.isFindInComment !== true) {
    vars.findDataSearchComments = [];
    return { commentItems: [] };
  }

  const selectors = {
    posts: await helpers.element('fb_search_post_in_uid'),
    commentButton: await helpers.element('fb_comment_in_post_btn'),
    mostRelevant: await helpers.element('fb_most_relevant_btn'),
    allComments: await helpers.element('fb_all_comments_btn'),
    newestComments: await helpers.element('fb_newest_comments_btn'),
    dialog: await helpers.element('fb_dialog'),
    commentElement: await helpers.element('fb_cmt_element_full'),
    uidInComment: await helpers.element('fb_uid_in_cmt_element'),
    contentInComment: await helpers.element('fb_content_in_cmt_element'),
    closeDialog: await helpers.element('fb_close_dialog_btn')
  };
  const postLimit = Math.max(1, Number(vars.countSearchPostFindData || vars.countPostFindData || 10));
  const commentLimit = Math.max(1, Number(vars.countCommentFindData || 30));
  const sortType = String(vars.sortTypeComment || 'most_relevant');

  const commentResult = await page.evaluate(String.raw`
    const selectors = __args[0];
    const postLimit = __args[1];
    const commentLimit = __args[2];
    const sortType = __args[3];
    function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
    function norm(text) { return String(text || '').replace(/\s+/g, ' ').trim(); }
    function isVisible(el) { if (!el) return false; const style = window.getComputedStyle(el); if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false; const rect = el.getBoundingClientRect(); return rect.width > 0 && rect.height > 0; }
    function xpathAll(xpath, root) { const out = []; if (!xpath) return out; try { const result = document.evaluate(xpath, root || document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null); for (let i = 0; i < result.snapshotLength; i++) out.push(result.snapshotItem(i)); } catch {} return out.filter(Boolean); }
    function first(xpath, root) { return xpathAll(xpath, root)[0] || null; }
    function clickSynthetic(el) { if (!el) return false; try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch {} const init = { bubbles: true, cancelable: true, view: window }; try { el.dispatchEvent(new PointerEvent('pointerdown', Object.assign({}, init, { pointerId: 1, pointerType: 'mouse' }))); } catch {} try { el.dispatchEvent(new MouseEvent('mousedown', init)); } catch {} try { el.dispatchEvent(new PointerEvent('pointerup', Object.assign({}, init, { pointerId: 1, pointerType: 'mouse' }))); } catch {} try { el.dispatchEvent(new MouseEvent('mouseup', init)); } catch {} try { el.click(); return true; } catch {} return false; }
    async function waitFor(fn, timeoutMs) { const started = Date.now(); while (Date.now() - started < timeoutMs) { const value = fn(); if (value) return value; await delay(300); } return null; }
    function extractUid(href) { if (!href) return ''; try { const url = new URL(href, location.href); const id = url.searchParams.get('id'); if (id) return id; const parts = url.pathname.split('/').filter(Boolean); const userIndex = parts.indexOf('user'); if (userIndex >= 0 && parts[userIndex + 1]) return parts[userIndex + 1]; return parts[parts.length - 1] || ''; } catch { return String(href || '').trim(); } }
    function commentContentOf(comment, authorLink, messageXpath) { const candidates = xpathAll(messageXpath, comment).filter(isVisible).filter(el => !authorLink || el !== authorLink && !(el.contains && el.contains(authorLink))).map(el => (el.innerText || el.textContent || '').trim()).filter(Boolean); return candidates[0] || (comment.innerText || comment.textContent || '').trim(); }
    function findPostElementsFallback() { const main = document.querySelector('[role="main"]') || document.body; const byArticle = Array.from(main.querySelectorAll('[role="article"]')).filter(isVisible).filter(el => { const text = norm(el.innerText || el.textContent || ''); return text.includes('Bình luận') || text.includes('Comment') || text.includes('Chia sẻ') || text.includes('Share'); }); if (byArticle.length > 0) return byArticle; return []; }
    function getPostElements() { const fromElement = xpathAll(selectors.posts).filter(isVisible); return fromElement.length > 0 ? fromElement : findPostElementsFallback(); }

    const rows = [];
    const postCommentStats = [];
    const posts = getPostElements().slice(0, postLimit);
    for (let p = 0; p < posts.length; p++) {
      const post = posts[p];
      const postStat = { postIndex: p + 1, opened: false, sorted: sortType === 'most_relevant', commentsCount: 0, error: '' };
      try {
        post.scrollIntoView(true);
        await delay(700);
        const button = first(selectors.commentButton, post) || Array.from(post.querySelectorAll('[role="button"]')).filter(isVisible).find(btn => { const text = norm(btn.innerText || btn.textContent || btn.getAttribute('aria-label')); return text === 'Bình luận' || text === 'Comment'; });
        if (!button) { postStat.error = 'Không tìm thấy nút comment'; continue; }
        clickSynthetic(button);
        postStat.opened = true;
        await delay(2000);
        let root = await waitFor(() => first(selectors.dialog, document), 5000);
        if (!root) root = document.documentElement;
        if (sortType !== 'most_relevant') {
          postStat.sorted = false;
          const sortButton = first(selectors.mostRelevant, root) || first(selectors.mostRelevant, document);
          if (sortButton) {
            clickSynthetic(sortButton); await delay(800);
            const optionXpath = sortType === 'newest' ? selectors.newestComments : selectors.allComments;
            const option = first(optionXpath, document);
            if (option) { clickSynthetic(option); postStat.sorted = true; await delay(2000); }
            else { postStat.error = 'Không tìm thấy lựa chọn sắp xếp comment'; }
          } else { postStat.error = 'Không tìm thấy nút sắp xếp comment'; }
        }
        let comments = xpathAll(selectors.commentElement, root);
        const startedAt = Date.now();
        let stableCount = 0;
        while (comments.length < commentLimit && Date.now() - startedAt < 90000 && stableCount < 3) {
          const oldCount = comments.length;
          if (comments.length > 0) comments[comments.length - 1].scrollIntoView(true);
          await delay(1500);
          comments = xpathAll(selectors.commentElement, root);
          stableCount = comments.length <= oldCount ? stableCount + 1 : 0;
        }
        const selectedComments = comments.slice(0, commentLimit);
        postStat.commentsCount = selectedComments.length;
        selectedComments.forEach((comment, i) => {
          const link = first(selectors.uidInComment, comment);
          const href = link ? (link.href || link.getAttribute('href') || '') : '';
          const authorName = link ? (link.innerText || link.textContent || '').trim() : '';
          const content = commentContentOf(comment, link, selectors.contentInComment);
          rows.push({ postIndex: p + 1, commentIndex: i + 1, content, authorName, authorUrl: href, authorUid: extractUid(href) });
        });
      } catch (err) { postStat.error = err && err.message ? err.message : String(err || 'Lỗi mở comment'); }
      finally { const closeButton = first(selectors.closeDialog, document); if (closeButton) { clickSynthetic(closeButton); await delay(1000); } postCommentStats.push(postStat); }
    }
    return { rows, postCommentStats };
  `, selectors, postLimit, commentLimit, sortType);

  const commentItems = Array.isArray(commentResult) ? commentResult : (commentResult && Array.isArray(commentResult.rows) ? commentResult.rows : []);
  const commentPostStats = commentResult && Array.isArray(commentResult.postCommentStats) ? commentResult.postCommentStats : [];
  vars.findDataSearchComments = commentItems;
  helpers.log('Đã tải ' + vars.findDataSearchComments.length + ' comment từ search');

  function ensureResults() { if (!vars.findDataResults || typeof vars.findDataResults !== 'object') vars.findDataResults = {}; const results = vars.findDataResults; if (!Array.isArray(results.phones)) results.phones = []; if (!Array.isArray(results.linkGroupZalos)) results.linkGroupZalos = []; if (!Array.isArray(results.uids)) results.uids = []; if (!results.sourceData || typeof results.sourceData !== 'object') results.sourceData = {}; if (!results.sourceData.comment || typeof results.sourceData.comment !== 'object') results.sourceData.comment = {}; if (!Array.isArray(results.sourceData.comment.phones)) results.sourceData.comment.phones = []; if (!Array.isArray(results.sourceData.comment.linkGroupZalos)) results.sourceData.comment.linkGroupZalos = []; if (!Array.isArray(results.sourceData.comment.uids)) results.sourceData.comment.uids = []; return results; }
  function normalizeKeywordText(value) { return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase(); }
  function keywordList() { return String(vars.keywords || '').split(',').map(x => normalizeKeywordText(x.trim())).filter(Boolean); }
  function matchesContent(text) { if (!vars.isFindByKeywords) return true; const words = keywordList(); if (words.length === 0) return true; const haystack = normalizeKeywordText(text); return words.some(word => haystack.includes(word)); }
  function isMeaningAiEnabled() { return vars.isFindByContentAI === true && String(vars.contentAI || '').trim().length > 0; }
  function createEmptyMeaningAiCheck() { return { ok: true, matched: true, checkResult: '', prompt: String(vars.contentAI || ''), finalPrompt: '', rawResult: '', reason: '', error: '' }; }
  function normalizeMeaningAiCheck(result) { if (result && result.unsupported) return { ok: false, matched: false, checkResult: 'error', prompt: String(vars.contentAI || ''), finalPrompt: '', rawResult: '', reason: 'Runtime chưa hỗ trợ helper checkFindDataMeaningAI', error: 'Runtime chưa hỗ trợ helper checkFindDataMeaningAI' }; const raw = result && typeof result === 'object' ? result : {}; const checkResult = String(raw.checkResult || raw.check_result || (raw.ok === true ? (raw.matched === true ? 'matched' : 'not_matched') : 'error')); return { ok: raw.ok === true, matched: raw.matched === true, checkResult, prompt: String(raw.prompt || vars.contentAI || ''), finalPrompt: String(raw.finalPrompt || raw.final_prompt || ''), rawResult: String(raw.rawResult || raw.raw_result || ''), reason: String(raw.reason || raw.error || ''), error: String(raw.error || '') }; }
  async function checkMeaningAi(content, entityType) { if (!isMeaningAiEnabled()) return createEmptyMeaningAiCheck(); const result = await helpers.checkFindDataMeaningAI({ contentText: String(content || ''), prompt: String(vars.contentAI || ''), entityType }); return normalizeMeaningAiCheck(result); }
  function isMeaningAiAccepted(aiCheck) { return !isMeaningAiEnabled() || (aiCheck && aiCheck.ok === true && aiCheck.matched === true); }
  function isMeaningAiFailed(aiCheck) { return isMeaningAiEnabled() && (!aiCheck || aiCheck.ok !== true); }
  function getMeaningAiMessage(aiCheck) { if (isMeaningAiFailed(aiCheck)) return 'Lỗi kiểm tra ý nghĩa AI: ' + String(aiCheck && (aiCheck.error || aiCheck.reason) ? (aiCheck.error || aiCheck.reason) : 'Không rõ nguyên nhân'); if (isMeaningAiEnabled() && aiCheck && aiCheck.matched !== true) return 'Không đúng ý nghĩa AI'; return 'Đúng ý nghĩa AI'; }
  function buildFilterData(matchedKeyword, aiCheck) { const keywordEnabled = vars.isFindByKeywords === true && String(vars.keywords || '').trim().length > 0; const rawResult = String(aiCheck && aiCheck.rawResult ? aiCheck.rawResult : ''); const reason = String(aiCheck && aiCheck.reason ? aiCheck.reason : ''); return { keywordEnabled, keyword: keywordEnabled ? String(vars.keywords || '') : null, matchedKeyword: keywordEnabled ? matchedKeyword : null, aiPrompt: String(vars.contentAI || '') || null, aiFinalPrompt: String(aiCheck && aiCheck.finalPrompt ? aiCheck.finalPrompt : ''), aiRawResult: rawResult, aiCheckResult: String(aiCheck && aiCheck.checkResult ? aiCheck.checkResult : ''), aiMatched: aiCheck && typeof aiCheck.matched === 'boolean' ? aiCheck.matched : null, aiReason: reason || null, aiResult: rawResult || null }; }
  function normalizePhone(value) { const raw = String(value || '').trim(); const compact = raw.replace(/[\s.\-]/g, ''); let digits = compact.replace(/[^\d+]/g, ''); if (digits.startsWith('+84')) digits = '0' + digits.slice(3); else if (digits.startsWith('84')) digits = '0' + digits.slice(2); digits = digits.replace(/\D/g, ''); if (/^0[35789]\d{8}$/.test(digits)) return digits; return ''; }
  function findPhones(text) { const matches = String(text || '').match(/(?:\+84|84|0)[\s.\-]?[35789](?:[\s.\-]?\d){8}\b/g) || []; return matches.map(normalizePhone).filter(Boolean); }
  function findZaloLinks(text) { const matches = String(text || '').match(/(?:https?:\/\/)?zalo\.me\/g\/[a-z0-9]+/gi) || []; return matches.map(x => x.trim()).filter(Boolean); }
  function unique(arr) { return Array.from(new Set((arr || []).map(x => String(x || '').trim()).filter(Boolean))); }
  function authorUidFromItem(item) { const rawHref = String(item && item.authorUrl ? item.authorUrl : '').trim(); const fallbackUid = String(item && item.authorUid ? item.authorUid : '').trim(); const href = rawHref.toLowerCase(); if (href.includes('/permalink/') || href.includes('/posts/') || href.includes('story_fbid=') || href.includes('comment_id=') || href.includes('reply_comment_id=') || (href.includes('/groups/') && !href.includes('/user/'))) return ''; try { const url = new URL(rawHref, 'https://www.facebook.com'); const id = url.searchParams.get('id'); if (id) return id.trim(); const parts = url.pathname.split('/').map(part => { try { return decodeURIComponent(part); } catch { return part; } }).map(part => part.trim()).filter(Boolean); const userIndex = parts.indexOf('user'); if (userIndex >= 0 && parts[userIndex + 1]) return parts[userIndex + 1]; const last = parts[parts.length - 1] || ''; const blockedLastParts = new Set(['profile.php', 'groups', 'posts', 'permalink', 'story.php', 'photo.php', 'photos', 'watch', 'reel']); if (last && !blockedLastParts.has(last.toLowerCase())) return last; } catch {} return fallbackUid; }

  const results = ensureResults();
  const sourceComment = results.sourceData.comment;
  const commentSourcePosts = Array.isArray(vars.findDataSearchPosts) ? vars.findDataSearchPosts : [];
  const commentsByPost = new Map();
  for (const comment of vars.findDataSearchComments) { const postIndex = Math.max(1, Number(comment && comment.postIndex ? comment.postIndex : 0)); if (!commentsByPost.has(postIndex)) commentsByPost.set(postIndex, []); commentsByPost.get(postIndex).push(comment); }
  const commentLogEvents = [];
  let matchedComments = 0;
  let globalCommentIndex = 0;

  for (const rawStat of commentPostStats) {
    const stat = rawStat && typeof rawStat === 'object' ? rawStat : {};
    const postIndex = Math.max(1, Number(stat.postIndex || 0));
    const commentsCount = Math.max(0, Number(stat.commentsCount || 0));
    const opened = stat.opened === true;
    const sorted = stat.sorted === true;
    const error = String(stat.error || '').trim();
    const sourcePost = commentSourcePosts[postIndex - 1] || {};
    const postUrl = String(sourcePost && sourcePost.postLink ? sourcePost.postLink : '');
    const commentsForPost = commentsByPost.get(postIndex) || [];

    commentLogEvents.push({ eventType: 'open_comments', eventName: 'Mở comment', targetType: 'comment', status: opened ? 'success' : 'skipped', isUserVisible: false, xpath: selectors.commentButton, itemIndex: postIndex, targetUrl: postUrl, message: opened ? 'Đã mở comment của bài post #' + postIndex : 'Bỏ qua mở comment của bài post #' + postIndex, debugData: { postLimit, commentLimit, sortType, postIndex, postUrl, error, searchKeyword: vars.findDataSearchKeyword || '' } });
    if (sortType !== 'most_relevant' && opened) commentLogEvents.push({ eventType: 'sort_comments', eventName: 'Sắp xếp comment', targetType: 'comment', status: sorted ? 'success' : 'failed', isUserVisible: false, itemIndex: postIndex, targetUrl: postUrl, message: sorted ? 'Đã đổi sắp xếp comment của bài post #' + postIndex : (error || 'Không sắp xếp được comment của bài post #' + postIndex), debugData: { sortType, postIndex, postUrl, error, selectors: { sortButton: selectors.mostRelevant, allComments: selectors.allComments, newestComments: selectors.newestComments }, searchKeyword: vars.findDataSearchKeyword || '' } });
    commentLogEvents.push({ eventType: 'collect_comments', eventName: 'Lấy danh sách comment', targetType: 'comment', status: opened ? 'success' : 'skipped', isUserVisible: true, xpath: selectors.commentElement, elementCount: commentsCount, itemIndex: postIndex, targetUrl: postUrl, message: 'Bài post #' + postIndex + ': lấy được ' + commentsCount + ' comment', debugData: { postLimit, commentLimit, sortType, postIndex, postUrl, error, searchKeyword: vars.findDataSearchKeyword || '' } });

    for (const comment of commentsForPost) {
      globalCommentIndex++;
      const content = String(comment && comment.content ? comment.content : '');
      const contentMatches = matchesContent(content);
      const meaningAiCheck = vars.isFindInComment && contentMatches ? await checkMeaningAi(content, 'comment') : createEmptyMeaningAiCheck();
      const meaningAiAccepted = isMeaningAiAccepted(meaningAiCheck);
      const commentAuthorUidForLog = authorUidFromItem(comment);
      const commentAuthorNameForLog = String(comment && comment.authorName ? comment.authorName : '').trim();
      const commentPhonesForLog = findPhones(content);
      const commentZaloLinksForLog = findZaloLinks(content);
      const commentPostLinksForLog = postUrl ? [postUrl] : [];
      const commentIndexInPost = Math.max(1, Number(comment && comment.commentIndex ? comment.commentIndex : 0));
      const authorUrl = String(comment && comment.authorUrl ? comment.authorUrl : '');

      if (vars.isFindInComment && contentMatches && !meaningAiAccepted) {
        commentLogEvents.push({ eventType: 'extract_comment_data', eventName: 'Lấy thông tin comment', targetType: 'comment', status: isMeaningAiFailed(meaningAiCheck) ? 'failed' : 'skipped', isUserVisible: true, itemIndex: commentIndexInPost, targetUrl: authorUrl, message: getMeaningAiMessage(meaningAiCheck), extractedData: { entity: { type: 'comment', url: authorUrl, name: commentAuthorNameForLog || null, uid: commentAuthorUidForLog || null, contentText: content }, filters: buildFilterData(true, meaningAiCheck), values: { phones: commentPhonesForLog, zaloGroupLinks: commentZaloLinksForLog, postLinks: commentPostLinksForLog, uids: unique([commentAuthorUidForLog].filter(Boolean)) } }, debugData: { postIndex, commentIndexInPost, globalCommentIndex, postUrl, authorName: commentAuthorNameForLog, authorUrl, searchKeyword: vars.findDataSearchKeyword || '' } });
        continue;
      }
      if (vars.isFindInComment && contentMatches && meaningAiAccepted) {
        matchedComments++;
        if (vars.isFindPhone) { results.phones.push(...commentPhonesForLog); sourceComment.phones.push(...commentPhonesForLog); }
        if (vars.isFindLinkGroupZalo) { results.linkGroupZalos.push(...commentZaloLinksForLog); sourceComment.linkGroupZalos.push(...commentZaloLinksForLog); }
        if (vars.isFindUid && commentAuthorUidForLog) { results.uids.push(commentAuthorUidForLog); sourceComment.uids.push(commentAuthorUidForLog); }
        commentLogEvents.push({ eventType: 'extract_comment_data', eventName: 'Lấy thông tin comment', targetType: 'comment', status: 'success', isUserVisible: true, itemIndex: commentIndexInPost, targetUrl: authorUrl, message: 'Đã duyệt comment #' + commentIndexInPost, extractedData: { entity: { type: 'comment', url: authorUrl, name: commentAuthorNameForLog || null, uid: commentAuthorUidForLog || null, contentText: content }, filters: buildFilterData(contentMatches, meaningAiCheck), values: { phones: commentPhonesForLog, zaloGroupLinks: commentZaloLinksForLog, postLinks: commentPostLinksForLog, uids: unique([commentAuthorUidForLog].filter(Boolean)) } }, debugData: { postIndex, commentIndexInPost, globalCommentIndex, postUrl, authorName: commentAuthorNameForLog, authorUrl, searchKeyword: vars.findDataSearchKeyword || '' } });
      } else if (vars.isFindInComment && !contentMatches) {
        commentLogEvents.push({ eventType: 'extract_comment_data', eventName: 'Lấy thông tin comment', targetType: 'comment', status: 'skipped', isUserVisible: true, itemIndex: commentIndexInPost, targetUrl: authorUrl, message: 'Không chứa keyword', extractedData: { entity: { type: 'comment', url: authorUrl, name: commentAuthorNameForLog || null, uid: commentAuthorUidForLog || null, contentText: content }, filters: buildFilterData(false, createEmptyMeaningAiCheck()), values: { phones: commentPhonesForLog, zaloGroupLinks: commentZaloLinksForLog, postLinks: commentPostLinksForLog, uids: unique([commentAuthorUidForLog].filter(Boolean)) } }, debugData: { postIndex, commentIndexInPost, globalCommentIndex, postUrl, authorName: commentAuthorNameForLog, authorUrl, searchKeyword: vars.findDataSearchKeyword || '' } });
      }
    }
  }
  if (commentLogEvents.length > 0) commentLogEvents.push({ eventType: 'collect_comments_summary', eventName: 'Tổng kết comment', targetType: 'comment', status: 'success', isUserVisible: true, elementCount: vars.findDataSearchComments.length, message: 'Tổng cộng lấy được ' + vars.findDataSearchComments.length + ' comment từ search', debugData: { postLimit, commentLimit, sortType, matchedComments, searchKeyword: vars.findDataSearchKeyword || '' } });
  await helpers.logRunEvents(commentLogEvents);
  results.phones = unique(results.phones); results.linkGroupZalos = unique(results.linkGroupZalos); results.uids = unique(results.uids); sourceComment.phones = unique(sourceComment.phones); sourceComment.linkGroupZalos = unique(sourceComment.linkGroupZalos); sourceComment.uids = unique(sourceComment.uids);
  vars.findDataSearchMatchedComments = matchedComments;
  return { commentItems: vars.findDataSearchComments, commentPostStats, matchedComments };

$fds_fb_collect_search_post_comments$),
  (2720, 'fb_extract_data_from_search_comments', $fds_fb_extract_data_from_search_comments$
  const results = vars.findDataResults || {};
  const comments = Array.isArray(input.commentItems) ? input.commentItems : (Array.isArray(vars.findDataSearchComments) ? vars.findDataSearchComments : []);
  return {
    matchedComments: Number(vars.findDataSearchMatchedComments || 0),
    commentItems: comments,
    phones: Array.isArray(results.phones) ? results.phones : [],
    linkGroupZalos: Array.isArray(results.linkGroupZalos) ? results.linkGroupZalos : [],
    uids: Array.isArray(results.uids) ? results.uids : []
  };

$fds_fb_extract_data_from_search_comments$),
  (2721, 'fb_open_search_groups', $fds_fb_open_search_groups$
  if (!vars.findDataSearchHasGroup) return { skipped: true, reason: 'Không bật nguồn group Facebook' };
  const keyword = String(vars.findDataSearchKeyword || '').trim();
  if (!keyword) throw new Error('Thiếu từ khóa search');
  const url = 'https://www.facebook.com/search/groups/?q=' + encodeURIComponent(keyword);
  try {
    helpers.log('Mở search group: ' + keyword);
    await page.navigate(url);
    await helpers.sleep(5000, signal);
    const selectorReady = await page.waitForSelector('[role="main"]', { timeout: 15000 }).catch(() => false);
    await helpers.logRunEvent({ eventType: 'open_search_groups', eventName: 'Mở search group Facebook', targetType: 'group', status: 'success', isUserVisible: false, targetUrl: url, message: 'Mở search group Facebook với từ khóa "' + keyword + '"', debugData: { searchKeyword: keyword, selectorReady: !!selectorReady } });
    return { url, keyword };
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    await helpers.logRunEvent({ eventType: 'open_search_groups', eventName: 'Mở search group Facebook', targetType: 'group', status: 'failed', isUserVisible: false, targetUrl: url, message, debugData: { searchKeyword: keyword } });
    throw err;
  }

$fds_fb_open_search_groups$),
  (2722, 'fb_apply_search_group_filters', $fds_fb_apply_search_group_filters$

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

const warnings = Array.isArray(result.warnings) ? result.warnings : [];
for (const warning of warnings) {
  helpers.log('Không áp dụng được filter group "' + (warning.label || '') + '": ' + (warning.reason || 'unknown'));
}
await helpers.logRunEvent({
  eventType: 'apply_search_group_filters',
  eventName: 'Áp dụng filter group Facebook',
  targetType: 'group',
  status: warnings.length > 0 ? 'failed' : 'success',
  isUserVisible: false,
  message: warnings.length > 0 ? 'Có filter không áp dụng được' : 'Đã áp dụng filter',
  debugData: { applied: Array.isArray(result.applied) ? result.applied : [], warnings, searchKeyword: vars.findDataSearchKeyword || '' }
});
return result;

$fds_fb_apply_search_group_filters$),
  (2723, 'fb_collect_search_groups', $fds_fb_collect_search_groups$

  if (!vars.findDataSearchHasGroup) { vars.findDataSearchGroups = []; return { facebookGroups: [] }; }

  const limit = Math.max(1, Number(vars.countSearchGroupFindData || 20));
  const minMembers = Math.max(0, Number(vars.minSearchGroupMembers || 0));
  const minPostsPerDay = Math.max(0, Number(vars.minSearchGroupPostsPerDay || 0));
  const keyword = String(vars.findDataSearchKeyword || '').trim();
  const groupResult = await page.evaluate(String.raw`
    const limit = __args[0]; const minMembers = __args[1]; const minPostsPerDay = __args[2]; const keyword = __args[3];
    function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
    function norm(text) { return String(text || '').replace(/\s+/g, ' ').trim(); }
    function isVisible(el) { if (!el) return false; const style = window.getComputedStyle(el); if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false; const rect = el.getBoundingClientRect(); return rect.width > 0 && rect.height > 0; }
    function parseNumber(text) { const raw = String(text || '').trim(); if (!raw) return 0; const suffixMatch = raw.match(/(k|n|m|tr|triệu|nghìn)$/i); const suffix = suffixMatch ? suffixMatch[1].toLowerCase() : ''; const numberText = raw.replace(/(k|n|m|tr|triệu|nghìn)$/i, '').trim(); let normalized = numberText; if (normalized.includes(',') && !normalized.includes('.')) normalized = normalized.replace(',', '.'); normalized = normalized.replace(/\.(?=\d{3}(\D|$))/g, '').replace(/,/g, '.'); const value = Number(normalized); if (!Number.isFinite(value)) return 0; const multiplier = suffix === 'k' || suffix === 'n' || suffix === 'nghìn' ? 1000 : suffix === 'm' || suffix === 'tr' || suffix === 'triệu' ? 1000000 : 1; return Math.round(value * multiplier); }
    function normalizeGroupUrl(href) { if (!href) return ''; try { const url = new URL(href, location.href); const parts = url.pathname.split('/').filter(Boolean); const groupIndex = parts.findIndex(part => part.toLowerCase() === 'groups'); const groupKey = groupIndex >= 0 ? parts[groupIndex + 1] : ''; if (!groupKey || groupKey === 'feed' || groupKey === 'discover') return ''; return 'https://www.facebook.com/groups/' + groupKey + '/'; } catch { return ''; } }
    function parseGroupCard(link) { const url = normalizeGroupUrl(link.href || link.getAttribute('href') || ''); if (!url) return null; let card = link; for (let depth = 0; depth < 8 && card && card.parentElement; depth++) { const text = norm(card.innerText || card.textContent || ''); if (text.includes('thành viên') || text.includes('members') || text.includes('bài viết/ngày') || text.includes('posts/day')) break; card = card.parentElement; } const text = norm(card.innerText || card.textContent || link.innerText || link.textContent || ''); if (!text || (!text.includes('thành viên') && !text.includes('members'))) return null; let name = norm(link.innerText || link.textContent || link.getAttribute('aria-label') || '').replace(/^Ảnh đại diện của\s+/i, ''); if (!name) { const nameMatch = text.match(/^(.*?)(?:\s+(?:Công khai|Riêng tư|Public|Private)\s*·|\s+[\d.,]+\s*(?:K|N|M|Tr|triệu|nghìn)?\s*(?:thành viên|members))/i); name = norm(nameMatch ? nameMatch[1] : ''); } const memberMatch = text.match(/([\d.,]+\s*(?:K|N|M|Tr|triệu|nghìn)?)\s*thành viên/i) || text.match(/([\d.,]+\s*(?:K|M)?)\s*members/i); const postMatch = text.match(/([\d.,]+)\+?\s*bài viết\/ngày/i) || text.match(/([\d.,]+)\+?\s*posts\/day/i); const privacy = text.includes('Công khai') || text.includes('Public') ? 'Công khai' : text.includes('Riêng tư') || text.includes('Private') ? 'Riêng tư' : ''; return { url, name, privacy, memberCount: memberMatch ? parseNumber(memberMatch[1]) : 0, postsPerDay: postMatch ? parseNumber(postMatch[1]) : 0, keyword, rawText: text }; }
    function getSkipReasons(group) { const reasons = []; if (minMembers > 0 && group.memberCount < minMembers) reasons.push('Không đạt số thành viên tối thiểu'); if (minPostsPerDay > 0 && group.postsPerDay < minPostsPerDay) reasons.push('Không đạt số bài/ngày tối thiểu'); return reasons; }
    function collect() { const main = document.querySelector('[role="main"]') || document.body; const links = Array.from(main.querySelectorAll('a[href*="/groups/"]')).filter(isVisible); const map = new Map(); for (const link of links) { const group = parseGroupCard(link); if (!group) continue; const key = group.url.replace(/\/+$/g, '').toLowerCase(); if (!key || map.has(key)) continue; const skipReasons = getSkipReasons(group); group.skipReasons = skipReasons; group.skipReason = skipReasons.join('; '); group.accepted = skipReasons.length === 0; map.set(key, group); } return Array.from(map.values()).map((group, index) => Object.assign({}, group, { scanIndex: index + 1 })); }
    function acceptedCount(rows) { return rows.filter(group => group && group.accepted === true).length; }
    let rows = collect(); const startedAt = Date.now(); let stableCount = 0; while (acceptedCount(rows) < limit && Date.now() - startedAt < 180000 && stableCount < 3) { const before = rows.length; window.scrollBy(0, Math.max(700, Math.floor((window.innerHeight || 800) * 0.9))); await delay(2200); rows = collect(); stableCount = rows.length <= before ? stableCount + 1 : 0; }
    const acceptedRows = []; const skippedRows = [];
    for (const group of rows) { if (group.accepted === true) { if (acceptedRows.length < limit) acceptedRows.push(Object.assign({}, group, { acceptedIndex: acceptedRows.length + 1 })); } else { skippedRows.push(group); } }
    return { acceptedRows, skippedRows, scannedCount: rows.length };
  `, limit, minMembers, minPostsPerDay, keyword);

  const acceptedGroups = groupResult && Array.isArray(groupResult.acceptedRows) ? groupResult.acceptedRows : [];
  const skippedGroups = groupResult && Array.isArray(groupResult.skippedRows) ? groupResult.skippedRows : [];
  const scannedCount = Math.max(acceptedGroups.length + skippedGroups.length, Number(groupResult && groupResult.scannedCount ? groupResult.scannedCount : 0));
  vars.findDataSearchGroups = acceptedGroups;
  if (!vars.findDataResults || typeof vars.findDataResults !== 'object') vars.findDataResults = {};
  if (!Array.isArray(vars.findDataResults.facebookGroups)) vars.findDataResults.facebookGroups = [];
  if (!vars.findDataResults.sourceData || typeof vars.findDataResults.sourceData !== 'object') vars.findDataResults.sourceData = {};
  if (!vars.findDataResults.sourceData.facebookGroups || typeof vars.findDataResults.sourceData.facebookGroups !== 'object') vars.findDataResults.sourceData.facebookGroups = {};
  if (!Array.isArray(vars.findDataResults.sourceData.facebookGroups.groups)) vars.findDataResults.sourceData.facebookGroups.groups = [];
  vars.findDataResults.facebookGroups.push(...vars.findDataSearchGroups);
  vars.findDataResults.sourceData.facebookGroups.groups.push(...vars.findDataSearchGroups.map(group => group.url));
  helpers.log('Đã tải ' + vars.findDataSearchGroups.length + ' group Facebook từ search');
  await helpers.logRunEvent({ eventType: 'scroll_search_groups', eventName: 'Cuộn search group Facebook', targetType: 'group', status: 'success', isUserVisible: false, elementCount: scannedCount, message: 'Đã cuộn search để tải group Facebook', debugData: { limit, minMembers, minPostsPerDay, scannedCount, acceptedCount: acceptedGroups.length, skippedCount: skippedGroups.length, searchKeyword: keyword } });
  await helpers.logRunEvent({ eventType: 'collect_facebook_groups', eventName: 'Lấy danh sách group Facebook', targetType: 'group', status: 'success', isUserVisible: true, elementCount: acceptedGroups.length, message: 'Lấy được ' + acceptedGroups.length + ' group Facebook đạt điều kiện từ ' + scannedCount + ' group đã quét', debugData: { limit, minMembers, minPostsPerDay, scannedCount, acceptedCount: acceptedGroups.length, skippedCount: skippedGroups.length, searchKeyword: keyword } });

  function groupContentText(group) { return [group.privacy, group.memberCount ? group.memberCount + ' thành viên' : '', group.postsPerDay ? group.postsPerDay + ' bài viết/ngày' : ''].filter(Boolean).join(' - '); }
  function groupExtractedData(group) { return { entity: { type: 'group', url: String(group.url || ''), name: String(group.name || '') || null, uid: null, contentText: groupContentText(group) }, filters: { keywordEnabled: false, keyword: null, matchedKeyword: null, aiPrompt: null, aiFinalPrompt: '', aiRawResult: '', aiCheckResult: '', aiMatched: null, aiReason: null, aiResult: null }, values: { phones: [], zaloGroupLinks: [], postLinks: [], facebookGroups: [String(group.url || '')] } }; }
  function groupDebugData(group, extra) { return Object.assign({ privacy: group.privacy || '', memberCount: Number(group.memberCount || 0), postsPerDay: Number(group.postsPerDay || 0), searchKeyword: keyword, rawText: group.rawText || '', minMembers, minPostsPerDay, scanIndex: Number(group.scanIndex || 0) }, extra || {}); }

  const groupEvents = [];
  for (const group of acceptedGroups) {
    groupEvents.push({ eventType: 'extract_facebook_group_data', eventName: 'Lấy thông tin group Facebook', targetType: 'group', status: 'success', isUserVisible: true, itemIndex: Number(group.scanIndex || group.acceptedIndex || 0) || null, targetUrl: group.url, message: 'Đã duyệt group Facebook #' + (group.scanIndex || group.acceptedIndex || ''), extractedData: groupExtractedData(group), debugData: groupDebugData(group, { acceptedIndex: Number(group.acceptedIndex || 0) }) });
  }
  for (const group of skippedGroups) {
    const reason = String(group.skipReason || 'Không đạt điều kiện lọc group');
    groupEvents.push({ eventType: 'extract_facebook_group_data', eventName: 'Lấy thông tin group Facebook', targetType: 'group', status: 'skipped', isUserVisible: true, itemIndex: Number(group.scanIndex || 0) || null, targetUrl: group.url, message: 'Bỏ qua group Facebook #' + (group.scanIndex || '') + ': ' + reason, extractedData: groupExtractedData(group), debugData: groupDebugData(group, { skipReason: reason, skipReasons: Array.isArray(group.skipReasons) ? group.skipReasons : [] }) });
  }
  groupEvents.sort((a, b) => Number(a.itemIndex || 0) - Number(b.itemIndex || 0));
  await helpers.logRunEvents(groupEvents);
  return { facebookGroups: vars.findDataSearchGroups, skippedGroups };

$fds_fb_collect_search_groups$),
  (2724, 'fb_find_search_data_summary', $fds_fb_find_search_data_summary$
  function unique(arr) { return Array.from(new Set((arr || []).map(x => String(x || '').trim()).filter(Boolean))); }
  function uniqueGroups(rawGroups) { const map = new Map(); for (const rawGroup of Array.isArray(rawGroups) ? rawGroups : []) { if (!rawGroup || typeof rawGroup !== 'object') continue; const url = String(rawGroup.url || '').trim(); const key = url.replace(/\/+$/g, '').toLowerCase(); if (!url || !key || map.has(key)) continue; map.set(key, { url, name: String(rawGroup.name || '').trim(), privacy: String(rawGroup.privacy || '').trim(), memberCount: Number(rawGroup.memberCount || 0), postsPerDay: Number(rawGroup.postsPerDay || 0), keyword: String(rawGroup.keyword || vars.findDataSearchKeyword || '').trim() }); } return Array.from(map.values()); }
  function ensureSourceData(results) { if (!results.sourceData || typeof results.sourceData !== 'object') results.sourceData = {}; for (const key of ['post', 'comment']) { if (!results.sourceData[key] || typeof results.sourceData[key] !== 'object') results.sourceData[key] = {}; if (!Array.isArray(results.sourceData[key].phones)) results.sourceData[key].phones = []; if (!Array.isArray(results.sourceData[key].linkGroupZalos)) results.sourceData[key].linkGroupZalos = []; if (!Array.isArray(results.sourceData[key].uids)) results.sourceData[key].uids = []; } if (!Array.isArray(results.sourceData.post.postLinks)) results.sourceData.post.postLinks = []; if (!results.sourceData.facebookGroups || typeof results.sourceData.facebookGroups !== 'object') results.sourceData.facebookGroups = {}; if (!Array.isArray(results.sourceData.facebookGroups.groups)) results.sourceData.facebookGroups.groups = []; results.sourceData.post.phones = unique(results.sourceData.post.phones); results.sourceData.post.linkGroupZalos = unique(results.sourceData.post.linkGroupZalos); results.sourceData.post.uids = unique(results.sourceData.post.uids); results.sourceData.post.postLinks = unique(results.sourceData.post.postLinks); results.sourceData.comment.phones = unique(results.sourceData.comment.phones); results.sourceData.comment.linkGroupZalos = unique(results.sourceData.comment.linkGroupZalos); results.sourceData.comment.uids = unique(results.sourceData.comment.uids); results.sourceData.facebookGroups.groups = unique(results.sourceData.facebookGroups.groups); return results.sourceData; }
  const results = vars.findDataResults || {};
  const sourceData = ensureSourceData(results);
  const facebookGroups = uniqueGroups(results.facebookGroups || vars.findDataSearchGroups || []);
  sourceData.facebookGroups.groups = unique([...(sourceData.facebookGroups.groups || []), ...facebookGroups.map(group => group.url)]);
  const phones = unique(results.phones); const linkGroupZalos = unique(results.linkGroupZalos); const uids = unique(results.uids); const postLinks = unique(results.postLinks);
  const sourceCounts = { post: { phones: sourceData.post.phones.length, linkGroupZalos: sourceData.post.linkGroupZalos.length, uids: sourceData.post.uids.length, postLinks: sourceData.post.postLinks.length }, comment: { phones: sourceData.comment.phones.length, linkGroupZalos: sourceData.comment.linkGroupZalos.length, uids: sourceData.comment.uids.length }, groupMembers: { uids: 0 }, newInteractors: { uids: 0 }, facebookGroups: { groups: sourceData.facebookGroups.groups.length } };
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
  if (vars.findDataSearchHasPost || vars.findDataSearchHasGroup) {
    await helpers.logRunEvent({ eventType: 'find_data_source_summary', eventName: 'Tổng kết tìm data', targetType: 'summary', status: 'success', isUserVisible: true, elementCount: total, message, extractedData: { entity: { type: 'summary', url: '', name: String(vars.findDataSearchKeyword || vars.inputDataUid || vars.inputDataName || ''), uid: null, contentText: message }, filters: { keywordEnabled: false, keyword: null, matchedKeyword: null, aiPrompt: null, aiFinalPrompt: '', aiRawResult: '', aiCheckResult: '', aiMatched: null, aiReason: null, aiResult: null }, values: { phones, zaloGroupLinks: linkGroupZalos, postLinks, uids, facebookGroups: facebookGroups.map(group => group.url) } }, debugData: { searchKeyword: vars.findDataSearchKeyword || vars.inputDataUid || vars.inputDataName || '', sourceCounts, facebookGroups } });
  }
  return { ok: true, searchKeyword: vars.findDataSearchKeyword || vars.inputDataUid || vars.inputDataName || '', phones, linkGroupZalos, uids, postLinks, groupMembers: [], facebookGroups, sourceCounts, total, message };

$fds_fb_find_search_data_summary$);

UPDATE public.auto_blocks AS block
SET
  code = promoted.code,
  updated_at = now()
FROM _find_data_search_block_codes AS promoted
WHERE block.id = promoted.id
  AND block.name = promoted.name
  AND block.is_builtin IS TRUE;

WITH target_workflows AS (
  SELECT workflow_id AS id
  FROM public.auto_campaign_actions
  WHERE id = 'facebook_find_data_search'
  UNION
  SELECT test_workflow_id AS id
  FROM public.auto_campaign_actions
  WHERE id = 'facebook_find_data_search'
), stripped_nodes AS (
  SELECT
    wf.id,
    COALESCE(jsonb_agg(node.value - 'codeOverride' ORDER BY node.ordinality), '[]'::jsonb) AS nodes
  FROM public.auto_workflows AS wf
  JOIN target_workflows AS target ON target.id = wf.id
  CROSS JOIN LATERAL jsonb_array_elements(wf.nodes::jsonb) WITH ORDINALITY AS node(value, ordinality)
  GROUP BY wf.id
)
UPDATE public.auto_workflows AS wf
SET
  nodes = stripped.nodes,
  updated_at = now()
FROM stripped_nodes AS stripped
WHERE wf.id = stripped.id;

DO $$
DECLARE
  promoted_count integer;
  remaining_override_count integer;
  search_post_element_count integer;
  old_search_post_element_count integer;
BEGIN
  SELECT count(*) INTO promoted_count
  FROM public.auto_blocks AS block
  JOIN _find_data_search_block_codes AS promoted ON promoted.id = block.id AND promoted.name = block.name
  WHERE block.code = promoted.code
    AND block.is_builtin IS TRUE;

  IF promoted_count <> 11 THEN
    RAISE EXCEPTION 'Expected 11 promoted find-data search blocks, got %', promoted_count;
  END IF;

  SELECT count(*) INTO search_post_element_count
  FROM public.auto_elements
  WHERE name = 'fb_search_post_in_uid'
    AND xpath = '//*[@class=''x1yztbdb x1n2onr6 xh8yej3 x1ja2u2z'']';

  IF search_post_element_count <> 1 THEN
    RAISE EXCEPTION 'Expected fb_search_post_in_uid element with search post XPath, got %', search_post_element_count;
  END IF;

  SELECT count(*) INTO search_post_element_count
  FROM public.auto_elements
  WHERE name = 'fb_group_user_author_in_post'
    AND xpath = './/a[contains(@href,''/groups/'') and contains(@href,''/user/'') and @tabindex=''0'']';

  IF search_post_element_count <> 1 THEN
    RAISE EXCEPTION 'Expected fb_group_user_author_in_post element with group user author XPath, got %', search_post_element_count;
  END IF;

  SELECT count(*) INTO old_search_post_element_count
  FROM _find_data_search_block_codes
  WHERE name IN ('fb_collect_search_posts', 'fb_collect_search_post_comments')
    AND code LIKE '%helpers.element(''fb_post_in_uid'')%';

  IF old_search_post_element_count <> 0 THEN
    RAISE EXCEPTION 'Expected search collect blocks to use fb_search_post_in_uid, old refs %', old_search_post_element_count;
  END IF;

  SELECT count(*) INTO old_search_post_element_count
  FROM _find_data_search_block_codes
  WHERE name = 'fb_collect_search_posts'
    AND code LIKE '%helpers.element(''fb_group_user_author_in_post'')%'
    AND code LIKE '%xpathAll(selectors.groupUserAuthorInPost, post)[0] || xpathAll(selectors.uidInPost, post)[0]%';

  IF old_search_post_element_count <> 1 THEN
    RAISE EXCEPTION 'Expected fb_collect_search_posts to prioritize group user author link, got %', old_search_post_element_count;
  END IF;

  WITH target_workflows AS (
    SELECT workflow_id AS id
    FROM public.auto_campaign_actions
    WHERE id = 'facebook_find_data_search'
    UNION
    SELECT test_workflow_id AS id
    FROM public.auto_campaign_actions
    WHERE id = 'facebook_find_data_search'
  )
  SELECT count(*) INTO remaining_override_count
  FROM public.auto_workflows AS wf
  JOIN target_workflows AS target ON target.id = wf.id
  CROSS JOIN LATERAL jsonb_array_elements(wf.nodes::jsonb) AS node(value)
  WHERE node.value ? 'codeOverride';

  IF remaining_override_count <> 0 THEN
    RAISE EXCEPTION 'Expected no codeOverride after promoting find-data search blocks, got %', remaining_override_count;
  END IF;
END $$;

COMMIT;
