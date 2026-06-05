-- Promote tested facebook_find_data_group run-event workflow code into real blocks.
-- Source of truth: DB snapshot from workflow test 246 captured at 2026-06-05T19:38:44.302Z.

BEGIN;

CREATE TEMP TABLE _find_data_group_promoted_block_codes (
  name text PRIMARY KEY,
  code text NOT NULL
) ON COMMIT DROP;

INSERT INTO _find_data_group_promoted_block_codes (name, code)
VALUES
  ('fb_open_group_discussion', $fdg_fb_open_group_discussion$

const raw = String(vars.targetUrl || vars.inputDataUid || input.raw || '').trim();
if (!raw) throw new Error('Thiếu link hoặc UID group');

function normalizeGroupUrl(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';

  if (/^https?:\/\//i.test(trimmed) || /^(www\.)?facebook\.com\//i.test(trimmed)) {
    const urlText = /^https?:\/\//i.test(trimmed) ? trimmed : 'https://' + trimmed.replace(/^https?:\/\//i, '');
    try {
      const url = new URL(urlText);
      const parts = url.pathname.split('/').filter(Boolean);
      const groupIndex = parts.findIndex(part => part.toLowerCase() === 'groups');
      if (groupIndex >= 0 && parts[groupIndex + 1]) {
        return 'https://www.facebook.com/groups/' + parts[groupIndex + 1];
      }
      url.hash = '';
      url.search = '';
      return url.href.replace(/\/+$/g, '');
    } catch {}
  }

  const cleaned = trimmed.replace(/^\/+|\/+$/g, '');
  const parts = cleaned.split('/').filter(Boolean);
  if (parts[0] && parts[0].toLowerCase() === 'groups' && parts[1]) {
    return 'https://www.facebook.com/groups/' + parts[1];
  }
  return 'https://www.facebook.com/groups/' + cleaned;
}

const groupUrl = normalizeGroupUrl(raw);
vars.findDataGroupUrl = groupUrl;

const needsFeed = vars.isFindInPost === true || vars.isFindInComment === true || vars.isFindPostLink === true || vars.isFindNewInteractors === true;
if (!needsFeed) {
  return { groupUrl, skippedFeed: true };
}

helpers.log('Mở group ' + (String(vars.inputDataName || '').trim() || groupUrl));

await page.navigate(groupUrl);
await helpers.sleep(5000, signal);
await helpers.logRunEvent({
  eventType: 'open_group',
  eventName: 'Mở group',
  targetType: 'group',
  status: 'success',
  isUserVisible: false,
  targetUrl: groupUrl,
  message: 'Đã mở group ' + (String(vars.inputDataName || '').trim() || groupUrl)
});

try {
  const discussionTab = await helpers.element('fb_group_discussion_tab');
  if (await page.$(discussionTab)) {
    await page.click(discussionTab);
    await helpers.logRunEvent({
      eventType: 'open_discussion_tab',
      eventName: 'Mở tab thảo luận',
      targetType: 'group',
      status: 'success',
      isUserVisible: false,
      xpath: discussionTab,
      targetUrl: groupUrl
    });
    await helpers.sleep(2000, signal);
  }
} catch {}

return { groupUrl };

$fdg_fb_open_group_discussion$),
  ('fb_sort_group_posts', $fdg_fb_sort_group_posts$

const needsFeed = vars.isFindInPost === true || vars.isFindInComment === true || vars.isFindPostLink === true || vars.isFindNewInteractors === true;
if (!needsFeed) {
  const skippedSort = String(vars.sortTypePost || input.sortTypePost || 'most_relevant');
  return { postSort: skippedSort, skippedFeed: true };
}

const sortType = String(vars.sortTypePost || input.sortTypePost || 'most_relevant');
if (sortType === 'most_relevant') {
  await helpers.logRunEvent({
    eventType: 'sort_posts',
    eventName: 'Sắp xếp bài viết',
    targetType: 'feed',
    status: 'success',
    isUserVisible: false,
    message: 'Giữ sắp xếp phù hợp nhất',
    debugData: { sortType }
  });
  return { postSort: sortType };
}

try {
  const sortButton = await helpers.element('fb_most_relevant_btn');
  if (await page.$(sortButton)) {
    await page.click(sortButton);
    await helpers.sleep(1000, signal);
    const optionName = sortType === 'new_posts' ? 'fb_new_post_btn' : 'fb_recent_activity_post_btn';
    const option = await helpers.element(optionName);
    if (await page.$(option)) {
      await page.click(option);
      await helpers.sleep(2500, signal);
      await helpers.logRunEvent({
        eventType: 'sort_posts',
        eventName: 'Sắp xếp bài viết',
        targetType: 'feed',
        status: 'success',
        isUserVisible: false,
        xpath: option,
        message: 'Đã đổi sắp xếp bài viết',
        debugData: { sortType, optionName }
      });
    }
  }
} catch (err) {
  const message = err && err.message ? err.message : String(err);
  helpers.log('Không đổi được sắp xếp bài viết: ' + message);
  await helpers.logRunEvent({
    eventType: 'sort_posts',
    eventName: 'Sắp xếp bài viết',
    targetType: 'feed',
    status: 'failed',
    isUserVisible: false,
    message,
    debugData: { sortType }
  });
}

return { postSort: sortType };

$fdg_fb_sort_group_posts$),
  ('fb_collect_group_posts', $fdg_fb_collect_group_posts$

const needsFeed = vars.isFindInPost === true || vars.isFindInComment === true || vars.isFindPostLink === true || vars.isFindNewInteractors === true;
if (!needsFeed) {
  vars.findDataPosts = [];
  return { posts: [], skippedFeed: true };
}

const limit = Math.max(1, Number(vars.countPostFindData || input.countPostFindData || 10));
const collectPostDetails = vars.isFindInPost === true || vars.isFindPostLink === true;
const useUidOnlyPostScan = vars.isFindNewInteractors === true && collectPostDetails !== true;

const selectors = {
  posts: await helpers.element('fb_post_in_uid'),
  seeMore: await helpers.element('fb_see_more_content_post_btn'),
  uidInPost: await helpers.element('fb_uid_in_post_in_uid'),
  content: await helpers.element('fb_content_in_post_in_uid'),
  rawPostLink: await helpers.element('RawPostLinkInUid'),
  postLink: await helpers.element('PostLinkInUid')
};
const collectPostLinks = true;

const posts = await page.evaluate(`
  const selectors = __args[0];
  const limit = __args[1];
  const collectPostLinks = __args[2] === true;

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
    if (!el) return;
    try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch {}
    const init = { bubbles: true, cancelable: true, view: window };
    try { el.dispatchEvent(new PointerEvent('pointerdown', Object.assign({}, init, { pointerId: 1, pointerType: 'mouse' }))); } catch {}
    try { el.dispatchEvent(new MouseEvent('mousedown', init)); } catch {}
    try { el.dispatchEvent(new PointerEvent('pointerup', Object.assign({}, init, { pointerId: 1, pointerType: 'mouse' }))); } catch {}
    try { el.dispatchEvent(new MouseEvent('mouseup', init)); } catch {}
    try { el.click(); } catch {}
  }

  function simulateFocusin(element) {
    if (!element) return;
    try {
      let event = new FocusEvent("focusin", {
        view: window,
        bubbles: true,
        cancelable: true,
      });

      element.dispatchEvent(event);
    } catch {
      try { element.dispatchEvent(new Event('focusin', { bubbles: true, cancelable: true })); } catch {}
    }
  }

  function hrefOf(el) {
    return el ? (el.href || el.getAttribute('href') || '') : '';
  }

  function cleanPostHref(href) {
    if (!href) return '';
    try {
      const url = new URL(href, location.href);
      if (/^(m|mbasic|mobile)\.facebook\.com$/i.test(url.hostname)) {
        url.hostname = 'www.facebook.com';
      }
      url.hash = '';
      Array.from(url.searchParams.keys()).forEach(key => {
        if (
          key.startsWith('__') ||
          key === 'mibextid' ||
          key === 'ref' ||
          key === 'locale' ||
          key === 'comment_id' ||
          key === 'reply_comment_id'
        ) {
          url.searchParams.delete(key);
        }
      });
      return url.href;
    } catch {
      return String(href || '').trim();
    }
  }

  function normalizeHref(href) {
    return cleanPostHref(href);
  }

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
    return href.includes('/posts/') || href.includes('story_fbid=');
  }

  function firstPostLink(post) {
    const links = xpathAll(selectors.postLink, post)
      .map(el => normalizeHref(hrefOf(el)))
      .filter(Boolean)
      .filter(isPostPermalink);
    return links[0] || '';
  }

  async function resolvePostLink(post) {
    let rawPostLink = '';
    let postLink = firstPostLink(post);
    if (postLink) return { rawPostLink, postLink };

    const rawLinks = xpathAll(selectors.rawPostLink, post)
      .filter(el => !isCommentPermalink(normalizeHref(hrefOf(el))))
      .slice(0, 5);
    for (const rawLinkEl of rawLinks) {
      rawPostLink = rawPostLink || cleanPostHref(hrefOf(rawLinkEl));
      try { rawLinkEl.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch {}
      simulateFocusin(rawLinkEl);
      await delay(500);
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
    } catch {
      return String(href || '').trim();
    }
  }

  let postElements = xpathAll(selectors.posts);
  const startedAt = Date.now();
  let stableCount = 0;
  while (postElements.length < limit && Date.now() - startedAt < 5 * 60 * 1000 && stableCount < 2) {
    const oldCount = postElements.length;
    if (postElements.length > 0) {
      postElements[postElements.length - 1].scrollIntoView(true);
    }
    await delay(2500);
    postElements = xpathAll(selectors.posts);
    stableCount = postElements.length <= oldCount ? stableCount + 1 : 0;
  }

  const rows = [];
  const selected = postElements.slice(0, limit);
  for (let i = 0; i < selected.length; i++) {
    const post = selected[i];
    try {
      const seeMoreButtons = xpathAll(selectors.seeMore, post).filter(isVisible).slice(0, 5);
      for (const btn of seeMoreButtons) {
        clickSynthetic(btn);
        await delay(300);
      }
    } catch {}

    const contentParts = xpathAll(selectors.content, post)
      .map(el => (el.innerText || el.textContent || '').trim())
      .filter(Boolean);
    const content = Array.from(new Set(contentParts)).join('\\n').trim() || (post.innerText || post.textContent || '').trim();
    const authorLink = xpathAll(selectors.uidInPost, post)[0];
    const authorUrl = authorLink ? (authorLink.href || authorLink.getAttribute('href') || '') : '';
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

vars.findDataPosts = Array.isArray(posts) ? posts : [];
helpers.log('Đã tải ' + vars.findDataPosts.length + ' bài viết trong group');
await helpers.logRunEvent({
  eventType: 'scroll_feed',
  eventName: 'Cuộn feed',
  targetType: 'feed',
  status: 'success',
  isUserVisible: false,
  xpath: selectors.posts,
  message: 'Đã cuộn feed để tải bài viết',
  debugData: { limit, collectPostLinks, useUidOnlyPostScan }
});
await helpers.logRunEvent({
  eventType: 'collect_posts',
  eventName: 'Lấy danh sách bài post',
  targetType: 'post',
  status: 'success',
  isUserVisible: true,
  xpath: selectors.posts,
  elementCount: vars.findDataPosts.length,
  message: 'Lấy được ' + vars.findDataPosts.length + ' bài viết trong group',
  debugData: { limit, collectPostLinks }
});
return { posts: vars.findDataPosts };

$fdg_fb_collect_group_posts$),
  ('fb_extract_data_from_group_posts', $fdg_fb_extract_data_from_group_posts$

function ensureResults() {
  if (!vars.findDataResults || typeof vars.findDataResults !== 'object') {
    vars.findDataResults = {};
  }
  const results = vars.findDataResults;
  if (!Array.isArray(results.phones)) results.phones = [];
  if (!Array.isArray(results.linkGroupZalos)) results.linkGroupZalos = [];
  if (!Array.isArray(results.uids)) results.uids = [];
  if (!Array.isArray(results.postLinks)) results.postLinks = [];
  if (!Array.isArray(results.groupMembers)) results.groupMembers = [];
  if (!results.sourceData || typeof results.sourceData !== 'object') results.sourceData = {};
  if (!results.sourceData.post || typeof results.sourceData.post !== 'object') results.sourceData.post = {};
  if (!Array.isArray(results.sourceData.post.phones)) results.sourceData.post.phones = [];
  if (!Array.isArray(results.sourceData.post.linkGroupZalos)) results.sourceData.post.linkGroupZalos = [];
  if (!Array.isArray(results.sourceData.post.uids)) results.sourceData.post.uids = [];
  if (!Array.isArray(results.sourceData.post.postLinks)) results.sourceData.post.postLinks = [];
  if (!results.sourceData.newInteractors || typeof results.sourceData.newInteractors !== 'object') results.sourceData.newInteractors = {};
  if (!Array.isArray(results.sourceData.newInteractors.uids)) results.sourceData.newInteractors.uids = [];
  return results;
}

function normalizeKeywordText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}
function keywordList() {
  return String(vars.keywords || '')
    .split(',')
    .map(x => normalizeKeywordText(x.trim()))
    .filter(Boolean);
}

function matchesContent(text) {
  if (!vars.isFindByKeywords) return true;
  const words = keywordList();
  if (words.length === 0) return true;
  const haystack = normalizeKeywordText(text);
  return words.some(word => haystack.includes(word));
}

function isMeaningAiEnabled() {
  return vars.isFindByContentAI === true && String(vars.contentAI || '').trim().length > 0;
}

function createEmptyMeaningAiCheck() {
  return {
    ok: true,
    matched: true,
    checkResult: '',
    prompt: String(vars.contentAI || ''),
    finalPrompt: '',
    rawResult: '',
    reason: '',
    error: ''
  };
}

function normalizeMeaningAiCheck(result) {
  if (result && result.unsupported) {
    return {
      ok: false,
      matched: false,
      checkResult: 'error',
      prompt: String(vars.contentAI || ''),
      finalPrompt: '',
      rawResult: '',
      reason: 'Runtime chưa hỗ trợ helper checkFindDataMeaningAI',
      error: 'Runtime chưa hỗ trợ helper checkFindDataMeaningAI'
    };
  }
  const raw = result && typeof result === 'object' ? result : {};
  const checkResult = String(raw.checkResult || raw.check_result || (raw.ok === true ? (raw.matched === true ? 'matched' : 'not_matched') : 'error'));
  return {
    ok: raw.ok === true,
    matched: raw.matched === true,
    checkResult,
    prompt: String(raw.prompt || vars.contentAI || ''),
    finalPrompt: String(raw.finalPrompt || raw.final_prompt || ''),
    rawResult: String(raw.rawResult || raw.raw_result || ''),
    reason: String(raw.reason || raw.error || ''),
    error: String(raw.error || '')
  };
}

async function checkMeaningAi(content, entityType) {
  if (!isMeaningAiEnabled()) return createEmptyMeaningAiCheck();
  const result = await helpers.checkFindDataMeaningAI({
    contentText: String(content || ''),
    prompt: String(vars.contentAI || ''),
    entityType
  });
  return normalizeMeaningAiCheck(result);
}

function isMeaningAiAccepted(aiCheck) {
  return !isMeaningAiEnabled() || (aiCheck && aiCheck.ok === true && aiCheck.matched === true);
}

function isMeaningAiFailed(aiCheck) {
  return isMeaningAiEnabled() && (!aiCheck || aiCheck.ok !== true);
}

function getMeaningAiMessage(aiCheck) {
  if (isMeaningAiFailed(aiCheck)) return 'Lỗi kiểm tra ý nghĩa AI: ' + String(aiCheck && (aiCheck.error || aiCheck.reason) ? (aiCheck.error || aiCheck.reason) : 'Không rõ nguyên nhân');
  if (isMeaningAiEnabled() && aiCheck && aiCheck.matched !== true) return 'Không đúng ý nghĩa AI';
  return 'Đúng ý nghĩa AI';
}

function buildFilterData(matchedKeyword, aiCheck) {
  const keywordEnabled = vars.isFindByKeywords === true && String(vars.keywords || '').trim().length > 0;
  const rawResult = String(aiCheck && aiCheck.rawResult ? aiCheck.rawResult : '');
  const reason = String(aiCheck && aiCheck.reason ? aiCheck.reason : '');
  return {
    keywordEnabled,
    keyword: keywordEnabled ? String(vars.keywords || '') : null,
    matchedKeyword: keywordEnabled ? matchedKeyword : null,
    aiPrompt: String(vars.contentAI || '') || null,
    aiFinalPrompt: String(aiCheck && aiCheck.finalPrompt ? aiCheck.finalPrompt : ''),
    aiRawResult: rawResult,
    aiCheckResult: String(aiCheck && aiCheck.checkResult ? aiCheck.checkResult : ''),
    aiMatched: aiCheck && typeof aiCheck.matched === 'boolean' ? aiCheck.matched : null,
    aiReason: reason || null,
    aiResult: rawResult || null
  };
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

function authorUidFromItem(item) {
  const rawHref = String(item && item.authorUrl ? item.authorUrl : '').trim();
  const fallbackUid = String(item && item.authorUid ? item.authorUid : '').trim();
  const href = rawHref.toLowerCase();
  if (
    href.includes('/permalink/') ||
    href.includes('/posts/') ||
    href.includes('story_fbid=') ||
    href.includes('comment_id=') ||
    href.includes('reply_comment_id=') ||
    (href.includes('/groups/') && !href.includes('/user/'))
  ) {
    return '';
  }

  try {
    const url = new URL(rawHref, 'https://www.facebook.com');
    const id = url.searchParams.get('id');
    if (id) return id.trim();
    const parts = url.pathname
      .split('/')
      .map(part => {
        try { return decodeURIComponent(part); } catch { return part; }
      })
      .map(part => part.trim())
      .filter(Boolean);
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
const sourceNewInteractors = results.sourceData.newInteractors;
const posts = Array.isArray(input.posts) ? input.posts : (Array.isArray(vars.findDataPosts) ? vars.findDataPosts : []);
let matchedPosts = 0;

if (vars.isFindInPost || vars.isFindPostLink || vars.isFindNewInteractors) {
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

    if ((vars.isFindInPost || vars.isFindPostLink) && !contentMatches) {
      await helpers.logRunEvent({
        eventType: 'extract_post_data',
        eventName: 'Lấy thông tin bài post',
        targetType: 'post',
        status: 'skipped',
        isUserVisible: true,
        itemIndex: post && post.index ? post.index : null,
        targetUrl: String(post && post.postLink ? post.postLink : ''),
        message: 'Không chứa keyword',
        extractedData: {
          entity: {
            type: 'post',
            url: String(post && post.postLink ? post.postLink : ''),
            name: postAuthorNameForLog || null,
            uid: postAuthorUidForLog || null,
            contentText: content
          },
          filters: buildFilterData(false, createEmptyMeaningAiCheck()),
          values: {
            phones: postPhonesForLog,
            zaloGroupLinks: postZaloLinksForLog,
            postLinks: postLinksForLog,
            uids: unique([postAuthorUidForLog].filter(Boolean))
          }
        },
        debugData: {
          postIndex: post && post.index ? post.index : null,
          authorName: postAuthorNameForLog,
          authorUrl: String(post && post.authorUrl ? post.authorUrl : ''),
          rawPostLink: String(post && post.rawPostLink ? post.rawPostLink : '')
        }
      });
    }

    if ((vars.isFindInPost || vars.isFindPostLink) && contentMatches && !meaningAiAccepted) {
      await helpers.logRunEvent({
        eventType: 'extract_post_data',
        eventName: 'Lấy thông tin bài post',
        targetType: 'post',
        status: isMeaningAiFailed(meaningAiCheck) ? 'failed' : 'skipped',
        isUserVisible: true,
        itemIndex: post && post.index ? post.index : null,
        targetUrl: String(post && post.postLink ? post.postLink : ''),
        message: getMeaningAiMessage(meaningAiCheck),
        extractedData: {
          entity: {
            type: 'post',
            url: String(post && post.postLink ? post.postLink : ''),
            name: postAuthorNameForLog || null,
            uid: postAuthorUidForLog || null,
            contentText: content
          },
          filters: buildFilterData(true, meaningAiCheck),
          values: {
            phones: postPhonesForLog,
            zaloGroupLinks: postZaloLinksForLog,
            postLinks: postLinksForLog,
            uids: unique([postAuthorUidForLog].filter(Boolean))
          }
        },
        debugData: {
          postIndex: post && post.index ? post.index : null,
          authorName: postAuthorNameForLog,
          authorUrl: String(post && post.authorUrl ? post.authorUrl : ''),
          rawPostLink: String(post && post.rawPostLink ? post.rawPostLink : '')
        }
      });
    }

    if ((vars.isFindInPost || vars.isFindPostLink) && contentMatches && meaningAiAccepted) {
      matchedPosts++;

      if (vars.isFindInPost && vars.isFindPhone) {
        const phones = findPhones(content);
        results.phones.push(...phones);
        sourcePost.phones.push(...phones);
      }
      if (vars.isFindInPost && vars.isFindLinkGroupZalo) {
        const linkGroupZalos = findZaloLinks(content);
        results.linkGroupZalos.push(...linkGroupZalos);
        sourcePost.linkGroupZalos.push(...linkGroupZalos);
      }
      const authorUid = authorUidFromItem(post);
      if (vars.isFindInPost && vars.isFindUid && authorUid) {
        results.uids.push(authorUid);
        sourcePost.uids.push(authorUid);
      }
      if (vars.isFindPostLink && post && post.postLink) {
        results.postLinks.push(String(post.postLink));
        sourcePost.postLinks.push(String(post.postLink));
      }
    }
    const newInteractorUid = authorUidFromItem(post);
    if (vars.isFindNewInteractors && vars.isFindUid && newInteractorUid) {
      results.uids.push(newInteractorUid);
      sourceNewInteractors.uids.push(newInteractorUid);
    }
    const shouldLogPostExtract = ((vars.isFindInPost || vars.isFindPostLink) && contentMatches && meaningAiAccepted) || (vars.isFindNewInteractors && vars.isFindUid && newInteractorUid);
    if (shouldLogPostExtract) {
      await helpers.logRunEvent({
        eventType: 'extract_post_data',
        eventName: 'Lấy thông tin bài post',
        targetType: 'post',
        status: 'success',
        isUserVisible: true,
        itemIndex: post && post.index ? post.index : null,
        targetUrl: String(post && post.postLink ? post.postLink : ''),
        message: 'Đã duyệt bài viết' + (post && post.index ? ' #' + post.index : ''),
        extractedData: {
          entity: {
            type: 'post',
            url: String(post && post.postLink ? post.postLink : ''),
            name: postAuthorNameForLog || null,
            uid: postAuthorUidForLog || newInteractorUid || null,
            contentText: content
          },
          filters: buildFilterData(contentMatches, meaningAiCheck),
          values: {
            phones: postPhonesForLog,
            zaloGroupLinks: postZaloLinksForLog,
            postLinks: postLinksForLog,
            uids: unique([postAuthorUidForLog, newInteractorUid].filter(Boolean))
          }
        },
        debugData: {
          postIndex: post && post.index ? post.index : null,
          authorName: postAuthorNameForLog,
          authorUrl: String(post && post.authorUrl ? post.authorUrl : ''),
          rawPostLink: String(post && post.rawPostLink ? post.rawPostLink : ''),
          source: vars.isFindNewInteractors ? 'new_interactors_or_post' : 'post'
        }
      });
    }
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
sourceNewInteractors.uids = unique(sourceNewInteractors.uids);

return {
  matchedPosts,
  phones: results.phones,
  linkGroupZalos: results.linkGroupZalos,
  uids: results.uids,
  postLinks: results.postLinks,
  sourceCounts: {
    post: {
      phones: sourcePost.phones.length,
      linkGroupZalos: sourcePost.linkGroupZalos.length,
      uids: sourcePost.uids.length,
      postLinks: sourcePost.postLinks.length
    },
    newInteractors: {
      uids: sourceNewInteractors.uids.length
    }
  }
};

$fdg_fb_extract_data_from_group_posts$),
  ('fb_collect_group_comments', $fdg_fb_collect_group_comments$
if (vars.isFindInComment !== true && vars.isFindNewInteractors !== true) {
  vars.findDataComments = [];
  return { commentItems: [] };
}

const selectors = {
  posts: await helpers.element('fb_post_in_uid'),
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
const postLimit = Math.max(1, Number(vars.countPostFindData || 10));
const commentLimit = Math.max(1, Number(vars.countCommentFindData || 30));
const sortType = String(vars.sortTypeComment || 'most_relevant');

const commentResult = await page.evaluate(`
  const selectors = __args[0];
  const postLimit = __args[1];
  const commentLimit = __args[2];
  const sortType = __args[3];

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

  function first(xpath, root) {
    return xpathAll(xpath, root)[0] || null;
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

  async function waitFor(fn, timeoutMs) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const value = fn();
      if (value) return value;
      await delay(300);
    }
    return null;
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

  function commentContentOf(comment, authorLink, messageXpath) {
    const candidates = xpathAll(messageXpath, comment)
      .filter(isVisible)
      .filter(el => !authorLink || el !== authorLink && !(el.contains && el.contains(authorLink)))
      .map(el => (el.innerText || el.textContent || '').trim())
      .filter(Boolean);
    return candidates[0] || (comment.innerText || comment.textContent || '').trim();
  }

  const rows = [];
  const postCommentStats = [];
  const posts = xpathAll(selectors.posts).slice(0, postLimit);
  for (let p = 0; p < posts.length; p++) {
    const post = posts[p];
    const postStat = {
      postIndex: p + 1,
      opened: false,
      sorted: sortType === 'most_relevant',
      commentsCount: 0,
      error: ''
    };
    try {
      post.scrollIntoView(true);
      await delay(700);
      const button = first(selectors.commentButton, post);
      if (!button) {
        postStat.error = 'Không tìm thấy nút comment';
        continue;
      }
      clickSynthetic(button);
      postStat.opened = true;
      await delay(2000);

      let root = await waitFor(() => first(selectors.dialog, document), 5000);
      if (!root) root = document.documentElement;

      if (sortType !== 'most_relevant') {
        postStat.sorted = false;
        const sortButton = first(selectors.mostRelevant, root) || first(selectors.mostRelevant, document);
        if (sortButton) {
          clickSynthetic(sortButton);
          await delay(800);
          const optionXpath = sortType === 'newest' ? selectors.newestComments : selectors.allComments;
          const option = first(optionXpath, document);
          if (option) {
            clickSynthetic(option);
            postStat.sorted = true;
            await delay(2000);
          } else {
            postStat.error = 'Không tìm thấy lựa chọn sắp xếp comment';
          }
        } else {
          postStat.error = 'Không tìm thấy nút sắp xếp comment';
        }
      }

      let comments = xpathAll(selectors.commentElement, root);
      const startedAt = Date.now();
      let stableCount = 0;
      while (comments.length < commentLimit && Date.now() - startedAt < 90 * 1000 && stableCount < 3) {
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
        rows.push({
          postIndex: p + 1,
          commentIndex: i + 1,
          content,
          authorName,
          authorUrl: href,
          authorUid: extractUid(href)
        });
      });
    } catch (err) {
      postStat.error = err && err.message ? err.message : String(err || 'Lỗi mở comment');
    } finally {
      const closeButton = first(selectors.closeDialog, document);
      if (closeButton) {
        clickSynthetic(closeButton);
        await delay(1000);
      }
      postCommentStats.push(postStat);
    }
  }

  return { rows, postCommentStats };
`, selectors, postLimit, commentLimit, sortType);

const commentItems = Array.isArray(commentResult)
  ? commentResult
  : (commentResult && Array.isArray(commentResult.rows) ? commentResult.rows : []);
const commentPostStats = commentResult && Array.isArray(commentResult.postCommentStats)
  ? commentResult.postCommentStats
  : [];
vars.findDataComments = commentItems;
helpers.log('Đã tải ' + vars.findDataComments.length + ' comment trong group');

function ensureResults() {
  if (!vars.findDataResults || typeof vars.findDataResults !== 'object') {
    vars.findDataResults = {};
  }
  const results = vars.findDataResults;
  if (!Array.isArray(results.phones)) results.phones = [];
  if (!Array.isArray(results.linkGroupZalos)) results.linkGroupZalos = [];
  if (!Array.isArray(results.uids)) results.uids = [];
  if (!Array.isArray(results.postLinks)) results.postLinks = [];
  if (!Array.isArray(results.groupMembers)) results.groupMembers = [];
  if (!results.sourceData || typeof results.sourceData !== 'object') results.sourceData = {};
  if (!results.sourceData.comment || typeof results.sourceData.comment !== 'object') results.sourceData.comment = {};
  if (!Array.isArray(results.sourceData.comment.phones)) results.sourceData.comment.phones = [];
  if (!Array.isArray(results.sourceData.comment.linkGroupZalos)) results.sourceData.comment.linkGroupZalos = [];
  if (!Array.isArray(results.sourceData.comment.uids)) results.sourceData.comment.uids = [];
  if (!results.sourceData.newInteractors || typeof results.sourceData.newInteractors !== 'object') results.sourceData.newInteractors = {};
  if (!Array.isArray(results.sourceData.newInteractors.uids)) results.sourceData.newInteractors.uids = [];
  return results;
}

function normalizeKeywordText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}

function keywordList() {
  return String(vars.keywords || '')
    .split(',')
    .map(x => normalizeKeywordText(x.trim()))
    .filter(Boolean);
}

function matchesContent(text) {
  if (!vars.isFindByKeywords) return true;
  const words = keywordList();
  if (words.length === 0) return true;
  const haystack = normalizeKeywordText(text);
  return words.some(word => haystack.includes(word));
}

function isMeaningAiEnabled() {
  return vars.isFindByContentAI === true && String(vars.contentAI || '').trim().length > 0;
}

function createEmptyMeaningAiCheck() {
  return {
    ok: true,
    matched: true,
    checkResult: '',
    prompt: String(vars.contentAI || ''),
    finalPrompt: '',
    rawResult: '',
    reason: '',
    error: ''
  };
}

function normalizeMeaningAiCheck(result) {
  if (result && result.unsupported) {
    return {
      ok: false,
      matched: false,
      checkResult: 'error',
      prompt: String(vars.contentAI || ''),
      finalPrompt: '',
      rawResult: '',
      reason: 'Runtime chưa hỗ trợ helper checkFindDataMeaningAI',
      error: 'Runtime chưa hỗ trợ helper checkFindDataMeaningAI'
    };
  }
  const raw = result && typeof result === 'object' ? result : {};
  const checkResult = String(raw.checkResult || raw.check_result || (raw.ok === true ? (raw.matched === true ? 'matched' : 'not_matched') : 'error'));
  return {
    ok: raw.ok === true,
    matched: raw.matched === true,
    checkResult,
    prompt: String(raw.prompt || vars.contentAI || ''),
    finalPrompt: String(raw.finalPrompt || raw.final_prompt || ''),
    rawResult: String(raw.rawResult || raw.raw_result || ''),
    reason: String(raw.reason || raw.error || ''),
    error: String(raw.error || '')
  };
}

async function checkMeaningAi(content, entityType) {
  if (!isMeaningAiEnabled()) return createEmptyMeaningAiCheck();
  const result = await helpers.checkFindDataMeaningAI({
    contentText: String(content || ''),
    prompt: String(vars.contentAI || ''),
    entityType
  });
  return normalizeMeaningAiCheck(result);
}

function isMeaningAiAccepted(aiCheck) {
  return !isMeaningAiEnabled() || (aiCheck && aiCheck.ok === true && aiCheck.matched === true);
}

function isMeaningAiFailed(aiCheck) {
  return isMeaningAiEnabled() && (!aiCheck || aiCheck.ok !== true);
}

function getMeaningAiMessage(aiCheck) {
  if (isMeaningAiFailed(aiCheck)) return 'Lỗi kiểm tra ý nghĩa AI: ' + String(aiCheck && (aiCheck.error || aiCheck.reason) ? (aiCheck.error || aiCheck.reason) : 'Không rõ nguyên nhân');
  if (isMeaningAiEnabled() && aiCheck && aiCheck.matched !== true) return 'Không đúng ý nghĩa AI';
  return 'Đúng ý nghĩa AI';
}

function buildFilterData(matchedKeyword, aiCheck) {
  const keywordEnabled = vars.isFindByKeywords === true && String(vars.keywords || '').trim().length > 0;
  const rawResult = String(aiCheck && aiCheck.rawResult ? aiCheck.rawResult : '');
  const reason = String(aiCheck && aiCheck.reason ? aiCheck.reason : '');
  return {
    keywordEnabled,
    keyword: keywordEnabled ? String(vars.keywords || '') : null,
    matchedKeyword: keywordEnabled ? matchedKeyword : null,
    aiPrompt: String(vars.contentAI || '') || null,
    aiFinalPrompt: String(aiCheck && aiCheck.finalPrompt ? aiCheck.finalPrompt : ''),
    aiRawResult: rawResult,
    aiCheckResult: String(aiCheck && aiCheck.checkResult ? aiCheck.checkResult : ''),
    aiMatched: aiCheck && typeof aiCheck.matched === 'boolean' ? aiCheck.matched : null,
    aiReason: reason || null,
    aiResult: rawResult || null
  };
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

function authorUidFromItem(item) {
  const rawHref = String(item && item.authorUrl ? item.authorUrl : '').trim();
  const fallbackUid = String(item && item.authorUid ? item.authorUid : '').trim();
  const href = rawHref.toLowerCase();
  if (
    href.includes('/permalink/') ||
    href.includes('/posts/') ||
    href.includes('story_fbid=') ||
    href.includes('comment_id=') ||
    href.includes('reply_comment_id=') ||
    (href.includes('/groups/') && !href.includes('/user/'))
  ) {
    return '';
  }

  try {
    const url = new URL(rawHref, 'https://www.facebook.com');
    const id = url.searchParams.get('id');
    if (id) return id.trim();
    const parts = url.pathname
      .split('/')
      .map(part => {
        try { return decodeURIComponent(part); } catch { return part; }
      })
      .map(part => part.trim())
      .filter(Boolean);
    const userIndex = parts.indexOf('user');
    if (userIndex >= 0 && parts[userIndex + 1]) return parts[userIndex + 1];
    const last = parts[parts.length - 1] || '';
    const blockedLastParts = new Set(['profile.php', 'groups', 'posts', 'permalink', 'story.php', 'photo.php', 'photos', 'watch', 'reel']);
    if (last && !blockedLastParts.has(last.toLowerCase())) return last;
  } catch {}

  return fallbackUid;
}

const results = ensureResults();
const sourceComment = results.sourceData.comment;
const sourceNewInteractors = results.sourceData.newInteractors;
const commentSourcePosts = Array.isArray(vars.findDataPosts) ? vars.findDataPosts : [];
const commentsByPost = new Map();
for (const comment of vars.findDataComments) {
  const postIndex = Math.max(1, Number(comment && comment.postIndex ? comment.postIndex : 0));
  if (!commentsByPost.has(postIndex)) commentsByPost.set(postIndex, []);
  commentsByPost.get(postIndex).push(comment);
}

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

  commentLogEvents.push({
    eventType: 'open_comments',
    eventName: 'Mở comment',
    targetType: 'comment',
    status: opened ? 'success' : 'skipped',
    isUserVisible: false,
    xpath: selectors.commentButton,
    itemIndex: postIndex,
    targetUrl: postUrl,
    message: opened ? 'Đã mở comment của bài post #' + postIndex : 'Bỏ qua mở comment của bài post #' + postIndex,
    debugData: { postLimit, commentLimit, sortType, postIndex, postUrl, error }
  });

  if (sortType !== 'most_relevant' && opened) {
    commentLogEvents.push({
      eventType: 'sort_comments',
      eventName: 'Sắp xếp comment',
      targetType: 'comment',
      status: sorted ? 'success' : 'failed',
      isUserVisible: false,
      itemIndex: postIndex,
      targetUrl: postUrl,
      message: sorted ? 'Đã đổi sắp xếp comment của bài post #' + postIndex : (error || 'Không sắp xếp được comment của bài post #' + postIndex),
      debugData: {
        sortType,
        postIndex,
        postUrl,
        error,
        selectors: {
          sortButton: selectors.mostRelevant,
          allComments: selectors.allComments,
          newestComments: selectors.newestComments
        }
      }
    });
  }

  commentLogEvents.push({
    eventType: 'collect_comments',
    eventName: 'Lấy danh sách comment',
    targetType: 'comment',
    status: opened ? 'success' : 'skipped',
    isUserVisible: true,
    xpath: selectors.commentElement,
    elementCount: commentsCount,
    itemIndex: postIndex,
    targetUrl: postUrl,
    message: 'Bài post #' + postIndex + ': lấy được ' + commentsCount + ' comment',
    debugData: { postLimit, commentLimit, sortType, postIndex, postUrl, error }
  });

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

    if (vars.isFindInComment && contentMatches && !meaningAiAccepted) {
      commentLogEvents.push({
        eventType: 'extract_comment_data',
        eventName: 'Lấy thông tin comment',
        targetType: 'comment',
        status: isMeaningAiFailed(meaningAiCheck) ? 'failed' : 'skipped',
        isUserVisible: true,
        itemIndex: Math.max(1, Number(comment && comment.commentIndex ? comment.commentIndex : 0)),
        targetUrl: String(comment && comment.authorUrl ? comment.authorUrl : ''),
        message: getMeaningAiMessage(meaningAiCheck),
        extractedData: {
          entity: {
            type: 'comment',
            url: String(comment && comment.authorUrl ? comment.authorUrl : ''),
            name: String(comment && comment.authorName ? comment.authorName : '').trim() || null,
            uid: authorUidFromItem(comment) || null,
            contentText: content
          },
          filters: buildFilterData(true, meaningAiCheck),
          values: {
            phones: findPhones(content),
            zaloGroupLinks: findZaloLinks(content),
            postLinks: postUrl ? [postUrl] : [],
            uids: unique([authorUidFromItem(comment)].filter(Boolean))
          }
        },
        debugData: {
          postIndex,
          commentIndexInPost: Math.max(1, Number(comment && comment.commentIndex ? comment.commentIndex : 0)),
          postUrl,
          authorName: String(comment && comment.authorName ? comment.authorName : '').trim(),
          authorUrl: String(comment && comment.authorUrl ? comment.authorUrl : '')
        }
      });
    }

    if (vars.isFindInComment && contentMatches && meaningAiAccepted) {
      matchedComments++;
      if (vars.isFindPhone) {
        results.phones.push(...commentPhonesForLog);
        sourceComment.phones.push(...commentPhonesForLog);
      }
      if (vars.isFindLinkGroupZalo) {
        results.linkGroupZalos.push(...commentZaloLinksForLog);
        sourceComment.linkGroupZalos.push(...commentZaloLinksForLog);
      }
      if (vars.isFindUid && commentAuthorUidForLog) {
        results.uids.push(commentAuthorUidForLog);
        sourceComment.uids.push(commentAuthorUidForLog);
      }
    }

    const newInteractorUid = authorUidFromItem(comment);
    if (vars.isFindNewInteractors && vars.isFindUid && newInteractorUid) {
      results.uids.push(newInteractorUid);
      sourceNewInteractors.uids.push(newInteractorUid);
    }

    const shouldLogCommentSuccess = (vars.isFindInComment && contentMatches && meaningAiAccepted) || (vars.isFindNewInteractors && vars.isFindUid && newInteractorUid);
    const commentIndexInPost = Math.max(1, Number(comment && comment.commentIndex ? comment.commentIndex : 0));
    const authorUrl = String(comment && comment.authorUrl ? comment.authorUrl : '');

    if (shouldLogCommentSuccess) {
      commentLogEvents.push({
        eventType: 'extract_comment_data',
        eventName: 'Lấy thông tin comment',
        targetType: 'comment',
        status: 'success',
        isUserVisible: true,
        itemIndex: commentIndexInPost,
        targetUrl: authorUrl,
        message: 'Đã duyệt comment #' + commentIndexInPost,
        extractedData: {
          entity: {
            type: 'comment',
            url: authorUrl,
            name: commentAuthorNameForLog || null,
            uid: commentAuthorUidForLog || newInteractorUid || null,
            contentText: content
          },
          filters: buildFilterData(contentMatches, meaningAiCheck),
          values: {
            phones: commentPhonesForLog,
            zaloGroupLinks: commentZaloLinksForLog,
            postLinks: commentPostLinksForLog,
            uids: unique([commentAuthorUidForLog, newInteractorUid].filter(Boolean))
          }
        },
        debugData: {
          postIndex,
          commentIndexInPost,
          globalCommentIndex,
          postUrl,
          authorName: commentAuthorNameForLog,
          authorUrl,
          source: vars.isFindNewInteractors ? 'new_interactors_or_comment' : 'comment'
        }
      });
    } else if (vars.isFindInComment && !contentMatches) {
      commentLogEvents.push({
        eventType: 'extract_comment_data',
        eventName: 'Lấy thông tin comment',
        targetType: 'comment',
        status: 'skipped',
        isUserVisible: true,
        itemIndex: commentIndexInPost,
        targetUrl: authorUrl,
        message: 'Không chứa keyword',
        extractedData: {
          entity: {
            type: 'comment',
            url: authorUrl,
            name: commentAuthorNameForLog || null,
            uid: commentAuthorUidForLog || null,
            contentText: content
          },
          filters: buildFilterData(false, createEmptyMeaningAiCheck()),
          values: {
            phones: commentPhonesForLog,
            zaloGroupLinks: commentZaloLinksForLog,
            postLinks: commentPostLinksForLog,
            uids: unique([commentAuthorUidForLog].filter(Boolean))
          }
        },
        debugData: { postIndex, commentIndexInPost, globalCommentIndex, postUrl, authorName: commentAuthorNameForLog, authorUrl }
      });
    }
  }
}

if (commentLogEvents.length === 0) {
  commentLogEvents.push({
    eventType: 'collect_comments',
    eventName: 'Lấy danh sách comment',
    targetType: 'comment',
    status: 'skipped',
    isUserVisible: true,
    xpath: selectors.commentElement,
    elementCount: 0,
    message: 'Không thấy bài post để lấy comment',
    debugData: { postLimit, commentLimit, sortType }
  });
}

results.phones = unique(results.phones);
results.linkGroupZalos = unique(results.linkGroupZalos);
results.uids = unique(results.uids);
sourceComment.phones = unique(sourceComment.phones);
sourceComment.linkGroupZalos = unique(sourceComment.linkGroupZalos);
sourceComment.uids = unique(sourceComment.uids);
sourceNewInteractors.uids = unique(sourceNewInteractors.uids);

commentLogEvents.push({
  eventType: 'collect_comments_summary',
  eventName: 'Tổng kết comment',
  targetType: 'comment',
  status: 'success',
  isUserVisible: true,
  xpath: selectors.commentElement,
  elementCount: vars.findDataComments.length,
  message: 'Tổng cộng lấy được ' + vars.findDataComments.length + ' comment từ ' + commentPostStats.length + ' bài post',
  debugData: { postLimit, commentLimit, sortType, postCount: commentPostStats.length }
});

await helpers.logRunEvents(commentLogEvents);
return {
  commentItems: vars.findDataComments,
  commentPostStats,
  matchedComments,
  phones: results.phones,
  linkGroupZalos: results.linkGroupZalos,
  uids: results.uids,
  sourceCounts: {
    comment: {
      phones: sourceComment.phones.length,
      linkGroupZalos: sourceComment.linkGroupZalos.length,
      uids: sourceComment.uids.length
    },
    newInteractors: {
      uids: sourceNewInteractors.uids.length
    }
  }
};
$fdg_fb_collect_group_comments$),
  ('fb_extract_data_from_group_comments', $fdg_fb_extract_data_from_group_comments$
const comments = Array.isArray(input.commentItems)
  ? input.commentItems
  : (Array.isArray(vars.findDataComments) ? vars.findDataComments : []);
const results = vars.findDataResults && typeof vars.findDataResults === 'object'
  ? vars.findDataResults
  : {};
const sourceData = results.sourceData && typeof results.sourceData === 'object'
  ? results.sourceData
  : {};
const sourceComment = sourceData.comment && typeof sourceData.comment === 'object'
  ? sourceData.comment
  : {};
const sourceNewInteractors = sourceData.newInteractors && typeof sourceData.newInteractors === 'object'
  ? sourceData.newInteractors
  : {};

return {
  skippedExtractComments: true,
  commentItems: comments,
  matchedComments: null,
  phones: Array.isArray(results.phones) ? results.phones : [],
  linkGroupZalos: Array.isArray(results.linkGroupZalos) ? results.linkGroupZalos : [],
  uids: Array.isArray(results.uids) ? results.uids : [],
  sourceCounts: {
    comment: {
      phones: Array.isArray(sourceComment.phones) ? sourceComment.phones.length : 0,
      linkGroupZalos: Array.isArray(sourceComment.linkGroupZalos) ? sourceComment.linkGroupZalos.length : 0,
      uids: Array.isArray(sourceComment.uids) ? sourceComment.uids.length : 0
    },
    newInteractors: {
      uids: Array.isArray(sourceNewInteractors.uids) ? sourceNewInteractors.uids.length : 0
    }
  }
};
$fdg_fb_extract_data_from_group_comments$),
  ('fb_find_group_data_summary', $fdg_fb_find_group_data_summary$

function unique(arr) {
  return Array.from(new Set((arr || []).map(x => String(x || '').trim()).filter(Boolean)));
}

function uniqueMembers(arr) {
  const seen = new Set();
  const out = [];
  for (const item of arr || []) {
    if (!item || typeof item !== 'object') continue;
    const uid = String(item.uid || '').trim();
    if (!uid || seen.has(uid)) continue;
    const name = String(item.name || '').trim();
    if (!name) continue;
    seen.add(uid);
    out.push({
      uid,
      name,
      url: String(item.url || '').trim()
    });
  }
  return out;
}

function ensureSourceData(results) {
  if (!results.sourceData || typeof results.sourceData !== 'object') results.sourceData = {};
  if (!results.sourceData.post || typeof results.sourceData.post !== 'object') results.sourceData.post = {};
  if (!Array.isArray(results.sourceData.post.phones)) results.sourceData.post.phones = [];
  if (!Array.isArray(results.sourceData.post.linkGroupZalos)) results.sourceData.post.linkGroupZalos = [];
  if (!Array.isArray(results.sourceData.post.uids)) results.sourceData.post.uids = [];
  if (!Array.isArray(results.sourceData.post.postLinks)) results.sourceData.post.postLinks = [];
  if (!results.sourceData.comment || typeof results.sourceData.comment !== 'object') results.sourceData.comment = {};
  if (!Array.isArray(results.sourceData.comment.phones)) results.sourceData.comment.phones = [];
  if (!Array.isArray(results.sourceData.comment.linkGroupZalos)) results.sourceData.comment.linkGroupZalos = [];
  if (!Array.isArray(results.sourceData.comment.uids)) results.sourceData.comment.uids = [];
  if (!results.sourceData.groupMembers || typeof results.sourceData.groupMembers !== 'object') results.sourceData.groupMembers = {};
  if (!Array.isArray(results.sourceData.groupMembers.uids)) results.sourceData.groupMembers.uids = [];
  if (!results.sourceData.newInteractors || typeof results.sourceData.newInteractors !== 'object') results.sourceData.newInteractors = {};
  if (!Array.isArray(results.sourceData.newInteractors.uids)) results.sourceData.newInteractors.uids = [];
  return results.sourceData;
}

const results = vars.findDataResults || { phones: [], linkGroupZalos: [], uids: [], postLinks: [], groupMembers: [] };
const groupMembers = uniqueMembers(results.groupMembers || vars.findDataGroupMembers || []);
const groupMemberUids = unique(groupMembers.map(member => member.uid));
const sourceData = ensureSourceData(results);
sourceData.groupMembers.uids = unique([...(sourceData.groupMembers.uids || []), ...groupMemberUids]);

const phones = unique(results.phones);
const linkGroupZalos = unique(results.linkGroupZalos);
const uids = unique([...(results.uids || []), ...groupMemberUids]);
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
  groupMembers: {
    uids: sourceData.groupMembers.uids.length
  },
  newInteractors: {
    uids: sourceData.newInteractors.uids.length
  }
};
const total = phones.length + linkGroupZalos.length + uids.length + postLinks.length;
const notes = [];
if (vars.isFindPhone) notes.push('Đã tìm được ' + phones.length + ' số điện thoại');
if (vars.isFindLinkGroupZalo) notes.push('Đã tìm được ' + linkGroupZalos.length + ' link group Zalo');
if (vars.isFindUid) notes.push('Đã tìm được ' + uids.length + ' UID');
if (vars.isFindPostLink) notes.push('Đã tìm được ' + postLinks.length + ' link bài post');
const message = notes.join(' - ') || 'Không có loại data nào được chọn';

vars.findDataResults = { phones, linkGroupZalos, uids, postLinks, groupMembers, sourceData, sourceCounts };
helpers.log(message);
await helpers.logRunEvent({
  eventType: 'find_data_source_summary',
  eventName: 'Tổng kết tìm data',
  targetType: 'group',
  status: 'success',
  isUserVisible: true,
  targetUrl: String(vars.findDataGroupUrl || vars.targetUrl || vars.inputDataUid || ''),
  elementCount: total,
  message,
  extractedData: {
    entity: {
      type: 'group',
      url: String(vars.findDataGroupUrl || vars.targetUrl || vars.inputDataUid || ''),
      name: String(vars.inputDataName || ''),
      uid: String(vars.inputDataUid || ''),
      contentText: ''
    },
    filters: {
      keywordEnabled: false,
      keyword: null,
      matchedKeyword: null,
      aiPrompt: null,
      aiFinalPrompt: '',
      aiRawResult: '',
      aiCheckResult: '',
      aiMatched: null,
      aiReason: null,
      aiResult: null
    },
    values: {
      phones,
      zaloGroupLinks: linkGroupZalos,
      postLinks,
      uids,
      groupMembers
    }
  },
  debugData: { sourceCounts }
});

return {
  ok: true,
  groupUrl: vars.findDataGroupUrl || vars.targetUrl || vars.inputDataUid || '',
  phones,
  linkGroupZalos,
  uids,
  postLinks,
  groupMembers,
  sourceCounts,
  total,
  message
};

$fdg_fb_find_group_data_summary$),
  ('fb_open_group_members', $fdg_fb_open_group_members$

if (vars.isFindInGroupMembers !== true || vars.isFindUid !== true) {
  vars.findDataGroupMembers = [];
  return { memberPageUrl: '', skippedMembers: true };
}

const raw = String(vars.findDataGroupUrl || vars.targetUrl || vars.inputDataUid || input.groupUrl || '').trim();
if (!raw) throw new Error('Thiếu link hoặc UID group');

function normalizeGroupUrl(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';

  if (/^https?:\/\//i.test(trimmed) || /^(www\.)?facebook\.com\//i.test(trimmed)) {
    const urlText = /^https?:\/\//i.test(trimmed) ? trimmed : 'https://' + trimmed.replace(/^https?:\/\//i, '');
    try {
      const url = new URL(urlText);
      const parts = url.pathname.split('/').filter(Boolean);
      const groupIndex = parts.findIndex(part => part.toLowerCase() === 'groups');
      if (groupIndex >= 0 && parts[groupIndex + 1]) {
        return 'https://www.facebook.com/groups/' + parts[groupIndex + 1];
      }
      url.hash = '';
      url.search = '';
      return url.href.replace(/\/+$/g, '');
    } catch {}
  }

  const cleaned = trimmed.replace(/^\/+|\/+$/g, '');
  const parts = cleaned.split('/').filter(Boolean);
  if (parts[0] && parts[0].toLowerCase() === 'groups' && parts[1]) {
    return 'https://www.facebook.com/groups/' + parts[1];
  }
  return 'https://www.facebook.com/groups/' + cleaned;
}

const groupUrl = normalizeGroupUrl(raw);
const memberPageUrl = groupUrl.replace(/\/+$/g, '') + '/members';
vars.findDataGroupUrl = groupUrl;
vars.findDataGroupMembersUrl = memberPageUrl;

helpers.log('Mở danh sách thành viên group ' + (String(vars.inputDataName || '').trim() || groupUrl));
await page.navigate(memberPageUrl);
await helpers.sleep(5000, signal);
await helpers.logRunEvent({
  eventType: 'open_group_members',
  eventName: 'Mở danh sách thành viên',
  targetType: 'member',
  status: 'success',
  isUserVisible: false,
  targetUrl: memberPageUrl,
  message: 'Đã mở danh sách thành viên group'
});

return { groupUrl, memberPageUrl };

$fdg_fb_open_group_members$),
  ('fb_collect_group_members', $fdg_fb_collect_group_members$

if (vars.isFindInGroupMembers !== true || vars.isFindUid !== true) {
  vars.findDataGroupMembers = [];
  return { members: [], uids: [], skippedMembers: true };
}

function ensureResults() {
  if (!vars.findDataResults || typeof vars.findDataResults !== 'object') {
    vars.findDataResults = {};
  }
  const results = vars.findDataResults;
  if (!Array.isArray(results.phones)) results.phones = [];
  if (!Array.isArray(results.linkGroupZalos)) results.linkGroupZalos = [];
  if (!Array.isArray(results.uids)) results.uids = [];
  if (!Array.isArray(results.postLinks)) results.postLinks = [];
  if (!Array.isArray(results.groupMembers)) results.groupMembers = [];
  if (!results.sourceData || typeof results.sourceData !== 'object') results.sourceData = {};
  if (!results.sourceData.groupMembers || typeof results.sourceData.groupMembers !== 'object') results.sourceData.groupMembers = {};
  if (!Array.isArray(results.sourceData.groupMembers.uids)) results.sourceData.groupMembers.uids = [];
  return results;
}

function unique(arr) {
  return Array.from(new Set((arr || []).map(x => String(x || '').trim()).filter(Boolean)));
}

const selector = await helpers.element('fb_group_member_link');
const limit = Math.max(1, Number(vars.countGroupMemberFindData || input.countGroupMemberFindData || 100));

const members = await page.evaluate(`
  const selector = __args[0];
  const limit = __args[1];

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
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

  function hrefOf(el) {
    return el ? (el.href || el.getAttribute('href') || '') : '';
  }

  function extractUserUid(href) {
    if (!href || !String(href).includes('/user/')) return '';
    try {
      const url = new URL(href, location.href);
      const parts = url.pathname.split('/').filter(Boolean);
      const userIndex = parts.findIndex(part => part.toLowerCase() === 'user');
      if (userIndex >= 0 && parts[userIndex + 1]) return parts[userIndex + 1].replace(/\\D/g, '') || parts[userIndex + 1];
      return '';
    } catch {
      const match = String(href || '').match(/\\/user\\/([^/?#]+)/i);
      return match ? match[1].replace(/\\D/g, '') || match[1] : '';
    }
  }

  function extractName(link) {
    if (!link) return '';
    const text = (link.innerText || link.textContent || '').trim();
    const firstLine = text.split('\\n').map(x => x.trim()).filter(Boolean)[0];
    if (firstLine) return firstLine;
    return String(link.getAttribute('aria-label') || link.getAttribute('title') || '').trim();
  }

  function scrollForMore(links) {
    if (links.length > 0) {
      try { links[links.length - 1].scrollIntoView(true); } catch {}
    }
  }

  const rows = [];
  const rowByUid = new Map();

  function collectVisibleMembers() {
    const links = xpathAll(selector);
    for (const link of links) {
      const href = hrefOf(link);
      const uid = extractUserUid(href);
      if (!uid) continue;
      const name = extractName(link);
      if (!name) continue;
      const existing = rowByUid.get(uid);
      if (existing) {
        if (!existing.url && href) existing.url = href;
        continue;
      }
      const row = {
        uid,
        name,
        url: href
      };
      rowByUid.set(uid, row);
      rows.push(row);
      if (rows.length >= limit) break;
    }
    return links;
  }

  let links = collectVisibleMembers();
  let stableCount = 0;

  while (rows.length < limit && stableCount < 5) {
    const oldCount = rows.length;
    if (links.length > 0) {
      scrollForMore(links);
      await delay(2000);
      try { window.scrollBy(0, 500); } catch {}
      await delay(2000);
    }
    links = collectVisibleMembers();
    stableCount = rows.length <= oldCount ? stableCount + 1 : 0;
  }

  return rows.slice(0, limit);
`, selector, limit);

const memberRows = (Array.isArray(members) ? members : [])
  .filter(member => member && member.uid && String(member.name || '').trim());
const memberUids = unique(memberRows.map(member => member && member.uid));
const results = ensureResults();
results.uids = unique([...(results.uids || []), ...memberUids]);
results.groupMembers = memberRows;
results.sourceData.groupMembers.uids = unique([...(results.sourceData.groupMembers.uids || []), ...memberUids]);
vars.findDataGroupMembers = memberRows;

helpers.log('Đã lấy ' + memberUids.length + ' thành viên group');

await helpers.logRunEvent({
  eventType: 'scroll_members',
  eventName: 'Cuộn danh sách thành viên',
  targetType: 'member',
  status: 'success',
  isUserVisible: false,
  xpath: selector,
  message: 'Đã cuộn danh sách thành viên group',
  debugData: { limit }
});
await helpers.logRunEvent({
  eventType: 'collect_members',
  eventName: 'Lấy danh sách thành viên group',
  targetType: 'member',
  status: 'success',
  isUserVisible: true,
  xpath: selector,
  elementCount: memberRows.length,
  message: 'Lấy được ' + memberRows.length + ' thành viên group',
  debugData: { limit }
});
await helpers.logRunEvents(memberRows.map((member, index) => ({
  eventType: 'extract_member_data',
  eventName: 'Lấy thông tin thành viên group',
  targetType: 'member',
  status: 'success',
  isUserVisible: true,
  itemIndex: index + 1,
  targetUrl: String(member && member.url ? member.url : ''),
  message: 'Đã duyệt thành viên ' + String(member && member.name ? member.name : ''),
  extractedData: {
    entity: {
      type: 'member',
      url: String(member && member.url ? member.url : ''),
      name: String(member && member.name ? member.name : ''),
      uid: String(member && member.uid ? member.uid : ''),
      contentText: ''
    },
    filters: {
      keywordEnabled: false,
      keyword: null,
      matchedKeyword: null,
      aiPrompt: null,
      aiFinalPrompt: '',
      aiRawResult: '',
      aiCheckResult: '',
      aiMatched: null,
      aiReason: null,
      aiResult: null
    },
    values: {
      phones: [],
      zaloGroupLinks: [],
      postLinks: [],
      uids: member && member.uid ? [String(member.uid)] : []
    }
  },
  debugData: { memberIndex: index + 1 }
})));

return {
  members: memberRows,
  uids: memberUids,
  sourceCounts: {
    groupMembers: {
      uids: results.sourceData.groupMembers.uids.length
    }
  }
};

$fdg_fb_collect_group_members$);

UPDATE public.auto_blocks AS block
SET
  code = promoted.code,
  updated_at = now()
FROM _find_data_group_promoted_block_codes AS promoted
WHERE block.name = promoted.name
  AND block.is_builtin IS TRUE;

WITH target_workflows AS (
  SELECT workflow_id AS id
  FROM public.auto_campaign_actions
  WHERE id = 'facebook_find_data_group'
  UNION
  SELECT test_workflow_id AS id
  FROM public.auto_campaign_actions
  WHERE id = 'facebook_find_data_group'
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
BEGIN
  SELECT count(*) INTO promoted_count
  FROM public.auto_blocks AS block
  JOIN _find_data_group_promoted_block_codes AS promoted ON promoted.name = block.name
  WHERE block.code = promoted.code
    AND block.is_builtin IS TRUE;

  IF promoted_count <> 9 THEN
    RAISE EXCEPTION 'Expected 9 promoted find-data group blocks, got %', promoted_count;
  END IF;

  WITH target_workflows AS (
    SELECT workflow_id AS id
    FROM public.auto_campaign_actions
    WHERE id = 'facebook_find_data_group'
    UNION
    SELECT test_workflow_id AS id
    FROM public.auto_campaign_actions
    WHERE id = 'facebook_find_data_group'
  )
  SELECT count(*) INTO remaining_override_count
  FROM public.auto_workflows AS wf
  JOIN target_workflows AS target ON target.id = wf.id
  CROSS JOIN LATERAL jsonb_array_elements(wf.nodes::jsonb) AS node(value)
  WHERE node.value ? 'codeOverride';

  IF remaining_override_count <> 0 THEN
    RAISE EXCEPTION 'Expected no codeOverride after promoting find-data group blocks, got %', remaining_override_count;
  END IF;
END $$;

COMMIT;
