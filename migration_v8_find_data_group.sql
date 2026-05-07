-- Migration v8: Facebook - Tìm kiếm data trong group
-- Seed built-in v2 elements, blocks, workflow, and campaign action.

BEGIN;

INSERT INTO public.auto_elements (name, xpath, description, category, is_builtin, staff_id, organization_id, updated_at)
VALUES
  ('fb_group_discussion_tab', '//a[@href and @role=''tab'' and (.=''Discussion'' or .=''Thảo luận'')]', 'Tab Thảo luận trong group Facebook', 'facebook', true, NULL, NULL, now()),
  ('fb_most_relevant_btn', '//*[@role=''button'' and (contains(.,''Phù hợp nhất'') or contains(.,''Most relevant''))]', 'Nút sắp xếp phù hợp nhất', 'facebook', true, NULL, NULL, now()),
  ('fb_recent_activity_post_btn', '//*[@role=''menuitemradio'' and (contains(.,''Hoạt động mới đây'') or contains(.,''Recent activity''))]', 'Menu Hoạt động mới đây của bài viết group', 'facebook', true, NULL, NULL, now()),
  ('fb_new_post_btn', '//*[@role=''menuitemradio'' and (contains(.,''Bài viết mới'') or contains(.,''New posts''))]', 'Menu Bài viết mới của bài viết group', 'facebook', true, NULL, NULL, now()),
  ('fb_post_in_uid', '//*[@role=''feed'']//*[@class=''x1yztbdb x1n2onr6 xh8yej3 x1ja2u2z'' or @class=''x1n2onr6 x1ja2u2z'']|//*[@class=''x1yztbdb x1n2onr6 xh8yej3 x1ja2u2z'']', 'Bài viết trong group/profile feed', 'facebook', true, NULL, NULL, now()),
  ('fb_see_more_content_post_btn', './/*[@dir=''auto'']//*[@data-ad-comet-preview=''message'' or @data-ad-preview=''message'' or @data-ad-rendering-role=''story_message'' or @class=''xh8yej3'' or @id]//*[@role=''button'' and (.=''Xem thêm'' or .=''See more'')]', 'Nút xem thêm nội dung bài viết', 'facebook', true, NULL, NULL, now()),
  ('fb_uid_in_post_in_uid', './/h2[contains(@class,''html-h2'')]//a|.//h3[contains(@class,''html-h3'')]//a|.//h4[contains(@class,''html-h4'')]//a', 'Link người đăng bài', 'facebook', true, NULL, NULL, now()),
  ('fb_content_in_post_in_uid', './/*[@dir=''auto'']//*[@data-ad-rendering-role=''message'' or @data-ad-rendering-role=''story_message'' or @data-ad-comet-preview=''message'' or @data-ad-preview=''message'' or @class=''xh8yej3'' or @id]', 'Nội dung bài viết', 'facebook', true, NULL, NULL, now()),
  ('fb_comment_in_post_btn', './/*[@role=''button'' and (.=''Bình luận'' or .=''Comment'')]', 'Nút bình luận trên bài viết', 'facebook', true, NULL, NULL, now()),
  ('fb_all_comments_btn', '//*[@role=''menuitem'' and (contains(.,''Tất cả bình luận'') or contains(.,''All comments''))]', 'Menu tất cả bình luận', 'facebook', true, NULL, NULL, now()),
  ('fb_newest_comments_btn', '//*[@role=''menuitem'' and (contains(.,''Mới nhất'') or contains(.,''Newest''))]', 'Menu bình luận mới nhất', 'facebook', true, NULL, NULL, now()),
  ('fb_dialog', '//*[@role=''dialog'' and not(@aria-label=''Thông báo'') and not(@aria-label=''Messenger'') and not(@aria-label=''Notifications'')]', 'Dialog Facebook', 'facebook', true, NULL, NULL, now()),
  ('fb_cmt_element_full', './/*[@role=''article'' and .//*[@class=''xt0psk2'']]', 'Element bình luận đầy đủ', 'facebook', true, NULL, NULL, now()),
  ('fb_uid_in_cmt_element', './/*[@class=''xjp7ctv'']//a[@role=''link'' and @tabindex=0]|.//*[@class=''xt0psk2'']//a[@role=''link'' and @tabindex=0]', 'Link người comment', 'facebook', true, NULL, NULL, now()),
  ('fb_close_dialog_btn', '//*[@role=''dialog'']//*[@role=''button'' and (@aria-label=''Đóng'' or @aria-label=''Close'')]|//*[@role=''button'' and .=''Dùng Trang'']', 'Nút đóng dialog Facebook', 'facebook', true, NULL, NULL, now()),
  ('fb_see_more_comments_btn', '//*[@role=''button'' and ((contains(.,''Xem thêm'') and contains(.,''bình luận'')) or (contains(.,''View more'') and contains(.,''comments'')))]', 'Nút xem thêm bình luận', 'facebook', true, NULL, NULL, now())
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
  'fb_open_group_discussion',
  'Mở group Facebook và chuyển sang tab Thảo luận nếu có.',
  'Globe',
  'facebook',
  'js',
  NULL,
$block$
const raw = String(vars.targetUrl || vars.inputDataUid || input.raw || '').trim();
if (!raw) throw new Error('Thiếu link hoặc UID group');

function normalizeGroupUrl(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^(www\.)?facebook\.com\//i.test(trimmed)) return 'https://' + trimmed.replace(/^https?:\/\//i, '');
  const cleaned = trimmed.replace(/^\/+|\/+$/g, '');
  if (/^groups\//i.test(cleaned)) return 'https://www.facebook.com/' + cleaned;
  return 'https://www.facebook.com/groups/' + cleaned;
}

const groupUrl = normalizeGroupUrl(raw);
vars.findDataGroupUrl = groupUrl;
helpers.log('Mở group ' + (String(vars.inputDataName || '').trim() || groupUrl));

await page.navigate(groupUrl);
await helpers.sleep(5000, signal);

try {
  const discussionTab = await helpers.element('fb_group_discussion_tab');
  if (await page.$(discussionTab)) {
    await page.click(discussionTab);
    await helpers.sleep(2000, signal);
  }
} catch {}

return { groupUrl };
$block$,
  '[]'::jsonb,
  '[{"name":"groupUrl","type":"string","label":"Group URL"}]'::jsonb,
  '{}'::jsonb,
  true,
  NULL,
  NULL,
  now()
),
(
  'fb_sort_group_posts',
  'Chọn cách sắp xếp bài viết trong group.',
  'ArrowUpDown',
  'facebook',
  'js',
  NULL,
$block$
const sortType = String(vars.sortTypePost || input.sortTypePost || 'most_relevant');
if (sortType === 'most_relevant') return { postSort: sortType };

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
    }
  }
} catch (err) {
  helpers.log('Không đổi được sắp xếp bài viết: ' + (err && err.message ? err.message : String(err)));
}

return { postSort: sortType };
$block$,
  '[]'::jsonb,
  '[{"name":"postSort","type":"string","label":"Post sort"}]'::jsonb,
  '{}'::jsonb,
  true,
  NULL,
  NULL,
  now()
),
(
  'fb_collect_group_posts',
  'Tải và đọc các bài viết trong group theo số lượng cấu hình.',
  'Rows3',
  'facebook',
  'js',
  NULL,
$block$
const selectors = {
  posts: await helpers.element('fb_post_in_uid'),
  seeMore: await helpers.element('fb_see_more_content_post_btn'),
  uidInPost: await helpers.element('fb_uid_in_post_in_uid'),
  content: await helpers.element('fb_content_in_post_in_uid')
};
const limit = Math.max(1, Number(vars.countPostFindData || input.countPostFindData || 10));

const posts = await page.evaluate(`
  const selectors = __args[0];
  const limit = __args[1];

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

  let postElements = xpathAll(selectors.posts).filter(isVisible);
  const startedAt = Date.now();
  let stableCount = 0;
  while (postElements.length < limit && Date.now() - startedAt < 5 * 60 * 1000 && stableCount < 2) {
    const oldCount = postElements.length;
    if (postElements.length > 0) {
      postElements[postElements.length - 1].scrollIntoView({ block: 'end', inline: 'nearest' });
    } else {
      window.scrollBy(0, Math.max(700, Math.floor((window.innerHeight || 800) * 0.9)));
    }
    await delay(2500);
    postElements = xpathAll(selectors.posts).filter(isVisible);
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
    rows.push({
      index: i + 1,
      content,
      authorUrl,
      authorUid: extractUid(authorUrl)
    });
  }

  return rows;
`, selectors, limit);

vars.findDataPosts = Array.isArray(posts) ? posts : [];
helpers.log('Đã tải ' + vars.findDataPosts.length + ' bài viết trong group');
return { posts: vars.findDataPosts };
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
  'fb_extract_data_from_group_posts',
  'Lọc nội dung bài viết và trích số điện thoại, link group Zalo, UID người đăng.',
  'ScanSearch',
  'data',
  'js',
  NULL,
$block$
function ensureResults() {
  if (!vars.findDataResults || typeof vars.findDataResults !== 'object') {
    vars.findDataResults = { phones: [], linkGroupZalos: [], uids: [] };
  }
  return vars.findDataResults;
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
const posts = Array.isArray(input.posts) ? input.posts : (Array.isArray(vars.findDataPosts) ? vars.findDataPosts : []);
let matchedPosts = 0;

if (vars.isFindInPost) {
  for (const post of posts) {
    const content = String(post && post.content ? post.content : '');
    if (!matchesContent(content)) continue;
    matchedPosts++;
    if (vars.isFindPhone) results.phones.push(...findPhones(content));
    if (vars.isFindLinkGroupZalo) results.linkGroupZalos.push(...findZaloLinks(content));
    if (vars.isFindUid && post && post.authorUid) results.uids.push(String(post.authorUid));
  }
}

results.phones = unique(results.phones);
results.linkGroupZalos = unique(results.linkGroupZalos);
results.uids = unique(results.uids);

return {
  matchedPosts,
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
  'fb_collect_group_comments',
  'Mở comment của từng bài viết đã tải và đọc danh sách comment.',
  'MessageSquareText',
  'facebook',
  'js',
  NULL,
$block$
if (!vars.isFindInComment) {
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
  closeDialog: await helpers.element('fb_close_dialog_btn'),
  seeMoreComments: await helpers.element('fb_see_more_comments_btn')
};
const postLimit = Math.max(1, Number(vars.countPostFindData || 10));
const commentLimit = Math.max(1, Number(vars.countCommentFindData || 30));
const sortType = String(vars.sortTypeComment || 'most_relevant');

const commentItems = await page.evaluate(`
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

  const rows = [];
  const posts = xpathAll(selectors.posts).filter(isVisible).slice(0, postLimit);
  for (let p = 0; p < posts.length; p++) {
    const post = posts[p];
    try {
      post.scrollIntoView({ block: 'center', inline: 'nearest' });
      await delay(700);
      const button = first(selectors.commentButton, post);
      if (!button) continue;
      clickSynthetic(button);
      await delay(2000);

      let root = await waitFor(() => first(selectors.dialog, document), 5000);
      if (!root) root = document.documentElement;

      if (sortType !== 'most_relevant') {
        const sortButton = first(selectors.mostRelevant, root) || first(selectors.mostRelevant, document);
        if (sortButton) {
          clickSynthetic(sortButton);
          await delay(800);
          const optionXpath = sortType === 'newest' ? selectors.newestComments : selectors.allComments;
          const option = first(optionXpath, document);
          if (option) {
            clickSynthetic(option);
            await delay(2000);
          }
        }
      }

      let comments = xpathAll(selectors.commentElement, root).filter(isVisible);
      const startedAt = Date.now();
      let stableCount = 0;
      while (comments.length < commentLimit && Date.now() - startedAt < 90 * 1000 && stableCount < 3) {
        const oldCount = comments.length;
        const moreButton = first(selectors.seeMoreComments, root) || first(selectors.seeMoreComments, document);
        if (moreButton) clickSynthetic(moreButton);
        if (comments.length > 0) comments[comments.length - 1].scrollIntoView({ block: 'end', inline: 'nearest' });
        else root.scrollBy ? root.scrollBy(0, 700) : window.scrollBy(0, 700);
        await delay(1500);
        comments = xpathAll(selectors.commentElement, root).filter(isVisible);
        stableCount = comments.length <= oldCount ? stableCount + 1 : 0;
      }

      comments.slice(0, commentLimit).forEach((comment, i) => {
        const link = first(selectors.uidInComment, comment);
        const href = link ? (link.href || link.getAttribute('href') || '') : '';
        rows.push({
          postIndex: p + 1,
          commentIndex: i + 1,
          content: (comment.innerText || comment.textContent || '').trim(),
          authorUrl: href,
          authorUid: extractUid(href)
        });
      });

      const closeButton = first(selectors.closeDialog, document);
      if (closeButton) {
        clickSynthetic(closeButton);
        await delay(1000);
      }
    } catch {
      const closeButton = first(selectors.closeDialog, document);
      if (closeButton) {
        clickSynthetic(closeButton);
        await delay(500);
      }
    }
  }

  return rows;
`, selectors, postLimit, commentLimit, sortType);

vars.findDataComments = Array.isArray(commentItems) ? commentItems : [];
helpers.log('Đã tải ' + vars.findDataComments.length + ' comment trong group');
return { commentItems: vars.findDataComments };
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
  'fb_extract_data_from_group_comments',
  'Lọc nội dung comment và trích số điện thoại, link group Zalo, UID người comment.',
  'ListFilter',
  'data',
  'js',
  NULL,
$block$
function ensureResults() {
  if (!vars.findDataResults || typeof vars.findDataResults !== 'object') {
    vars.findDataResults = { phones: [], linkGroupZalos: [], uids: [] };
  }
  return vars.findDataResults;
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
const comments = Array.isArray(input.commentItems) ? input.commentItems : (Array.isArray(vars.findDataComments) ? vars.findDataComments : []);
let matchedComments = 0;

if (vars.isFindInComment) {
  for (const comment of comments) {
    const content = String(comment && comment.content ? comment.content : '');
    if (!matchesContent(content)) continue;
    matchedComments++;
    if (vars.isFindPhone) results.phones.push(...findPhones(content));
    if (vars.isFindLinkGroupZalo) results.linkGroupZalos.push(...findZaloLinks(content));
    if (vars.isFindUid && comment && comment.authorUid) results.uids.push(String(comment.authorUid));
  }
}

results.phones = unique(results.phones);
results.linkGroupZalos = unique(results.linkGroupZalos);
results.uids = unique(results.uids);

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
  'fb_find_group_data_summary',
  'Tổng kết kết quả tìm data trong group.',
  'ClipboardCheck',
  'data',
  'js',
  NULL,
$block$
function unique(arr) {
  return Array.from(new Set((arr || []).map(x => String(x || '').trim()).filter(Boolean)));
}

const results = vars.findDataResults || { phones: [], linkGroupZalos: [], uids: [] };
const phones = unique(results.phones);
const linkGroupZalos = unique(results.linkGroupZalos);
const uids = unique(results.uids);
const total = phones.length + linkGroupZalos.length + uids.length;
const notes = [];
if (vars.isFindPhone) notes.push('Đã tìm được ' + phones.length + ' số điện thoại');
if (vars.isFindLinkGroupZalo) notes.push('Đã tìm được ' + linkGroupZalos.length + ' link group Zalo');
if (vars.isFindUid) notes.push('Đã tìm được ' + uids.length + ' UID');
const message = notes.join(' - ') || 'Không có loại data nào được chọn';

vars.findDataResults = { phones, linkGroupZalos, uids };
helpers.log(message);

return {
  ok: true,
  groupUrl: vars.findDataGroupUrl || vars.targetUrl || vars.inputDataUid || '',
  phones,
  linkGroupZalos,
  uids,
  total,
  message
};
$block$,
  '[]'::jsonb,
  '[{"name":"phones","type":"json","label":"Phones"},{"name":"linkGroupZalos","type":"json","label":"Zalo links"},{"name":"uids","type":"json","label":"UIDs"},{"name":"total","type":"number","label":"Total"}]'::jsonb,
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
    'fb_open_group_discussion',
    'fb_sort_group_posts',
    'fb_collect_group_posts',
    'fb_extract_data_from_group_posts',
    'fb_collect_group_comments',
    'fb_extract_data_from_group_comments',
    'fb_find_group_data_summary'
  )
)
INSERT INTO public.auto_workflows (
  name, description, nodes, edges, variables_schema, default_variables,
  is_builtin, staff_id, organization_id, updated_at
)
SELECT
  '[Built-in] Facebook - Tìm kiếm data trong group',
  'Workflow tìm số điện thoại, link group Zalo và UID từ bài viết/comment trong group Facebook.',
  jsonb_build_array(
    jsonb_build_object(
      'id', 'node-open-group',
      'blockId', (SELECT id FROM block_ids WHERE name = 'fb_open_group_discussion'),
      'blockName', 'fb_open_group_discussion',
      'position', jsonb_build_object('x', 0, 'y', 0),
      'config', '{}'::jsonb,
      'label', 'Mở group'
    ),
    jsonb_build_object(
      'id', 'node-sort-posts',
      'blockId', (SELECT id FROM block_ids WHERE name = 'fb_sort_group_posts'),
      'blockName', 'fb_sort_group_posts',
      'position', jsonb_build_object('x', 260, 'y', 0),
      'config', '{}'::jsonb,
      'label', 'Sắp xếp bài viết'
    ),
    jsonb_build_object(
      'id', 'node-collect-posts',
      'blockId', (SELECT id FROM block_ids WHERE name = 'fb_collect_group_posts'),
      'blockName', 'fb_collect_group_posts',
      'position', jsonb_build_object('x', 520, 'y', 0),
      'config', '{}'::jsonb,
      'label', 'Tải bài viết'
    ),
    jsonb_build_object(
      'id', 'node-extract-posts',
      'blockId', (SELECT id FROM block_ids WHERE name = 'fb_extract_data_from_group_posts'),
      'blockName', 'fb_extract_data_from_group_posts',
      'position', jsonb_build_object('x', 780, 'y', 0),
      'config', '{}'::jsonb,
      'label', 'Lọc data từ bài viết'
    ),
    jsonb_build_object(
      'id', 'node-collect-comments',
      'blockId', (SELECT id FROM block_ids WHERE name = 'fb_collect_group_comments'),
      'blockName', 'fb_collect_group_comments',
      'position', jsonb_build_object('x', 1040, 'y', 0),
      'config', '{}'::jsonb,
      'label', 'Tải comment'
    ),
    jsonb_build_object(
      'id', 'node-extract-comments',
      'blockId', (SELECT id FROM block_ids WHERE name = 'fb_extract_data_from_group_comments'),
      'blockName', 'fb_extract_data_from_group_comments',
      'position', jsonb_build_object('x', 1300, 'y', 0),
      'config', '{}'::jsonb,
      'label', 'Lọc data từ comment'
    ),
    jsonb_build_object(
      'id', 'node-summary',
      'blockId', (SELECT id FROM block_ids WHERE name = 'fb_find_group_data_summary'),
      'blockName', 'fb_find_group_data_summary',
      'position', jsonb_build_object('x', 1560, 'y', 0),
      'config', '{}'::jsonb,
      'label', 'Tổng kết'
    )
  ),
  '[
    {"id":"e-open-sort","source":"node-open-group","target":"node-sort-posts"},
    {"id":"e-sort-collect-posts","source":"node-sort-posts","target":"node-collect-posts"},
    {"id":"e-collect-extract-posts","source":"node-collect-posts","target":"node-extract-posts"},
    {"id":"e-extract-posts-collect-comments","source":"node-extract-posts","target":"node-collect-comments"},
    {"id":"e-collect-comments-extract","source":"node-collect-comments","target":"node-extract-comments"},
    {"id":"e-extract-comments-summary","source":"node-extract-comments","target":"node-summary"}
  ]'::jsonb,
  '[
    {"name":"targetUrl","type":"string","label":"Group URL/UID"},
    {"name":"isFindPhone","type":"boolean","label":"Tìm số điện thoại","default":false},
    {"name":"isFindLinkGroupZalo","type":"boolean","label":"Tìm link group Zalo","default":false},
    {"name":"isFindUid","type":"boolean","label":"Tìm UID","default":false},
    {"name":"isFindInPost","type":"boolean","label":"Tìm trên post","default":false},
    {"name":"sortTypePost","type":"string","label":"Sắp xếp post","default":"most_relevant"},
    {"name":"countPostFindData","type":"number","label":"Số post tối đa","default":10},
    {"name":"isFindInComment","type":"boolean","label":"Tìm trong comment","default":false},
    {"name":"sortTypeComment","type":"string","label":"Sắp xếp comment","default":"most_relevant"},
    {"name":"countCommentFindData","type":"number","label":"Số comment tối đa","default":30},
    {"name":"isFindByKeywords","type":"boolean","label":"Lọc từ khoá","default":false},
    {"name":"keywords","type":"string","label":"Từ khoá","default":""},
    {"name":"isFindByContentAI","type":"boolean","label":"Lọc ý nghĩa bằng AI","default":false},
    {"name":"contentAI","type":"string","label":"Ý nghĩa nội dung","default":""}
  ]'::jsonb,
  '{
    "targetUrl": "",
    "isFindPhone": true,
    "isFindLinkGroupZalo": false,
    "isFindUid": false,
    "isFindInPost": true,
    "sortTypePost": "most_relevant",
    "countPostFindData": 10,
    "isFindInComment": false,
    "sortTypeComment": "most_relevant",
    "countCommentFindData": 30,
    "isFindByKeywords": false,
    "keywords": "",
    "isFindByContentAI": false,
    "contentAI": ""
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
  WHERE name = '[Built-in] Facebook - Tìm kiếm data trong group'
)
INSERT INTO public.auto_campaign_actions (id, name, flatform_type, is_active, workflow_id, is_delete, created_at)
SELECT
  'facebook_find_data_group',
  'Facebook - Tìm kiếm data trong group',
  'facebook',
  true,
  wf.id,
  false,
  now()
FROM wf
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  flatform_type = EXCLUDED.flatform_type,
  is_active = true,
  workflow_id = EXCLUDED.workflow_id,
  is_delete = false;

NOTIFY pgrst, 'reload schema';

COMMIT;
