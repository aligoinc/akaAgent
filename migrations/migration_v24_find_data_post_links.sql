-- Add post-link extraction to facebook_find_data_group and fan-out targets in app code.
-- Runtime reads built-in elements/blocks/workflows from Supabase, so this migration
-- updates existing DB rows.

BEGIN;

INSERT INTO public.auto_elements (name, xpath, description, category, is_builtin, staff_id, organization_id, updated_at)
VALUES
  ('RawPostLinkInUid', '//*[@role=''main'']//a[@target=''_blank'' and contains(@href, ''?__cft__[0]='')]', 'Raw link bài post trong feed trước khi Facebook render permalink thật', 'facebook', true, NULL, NULL, now()),
  ('PostLinkInUid', '//a[contains(@href, ''/posts/'') or contains(@href, ''story_fbid='')]', 'Permalink thật của bài post trong feed sau khi focusin raw link', 'facebook', true, NULL, NULL, now())
ON CONFLICT (name) DO UPDATE SET
  xpath = EXCLUDED.xpath,
  description = EXCLUDED.description,
  category = EXCLUDED.category,
  is_builtin = true,
  updated_at = now();

UPDATE public.auto_blocks
SET
  code = $block$
const selectors = {
  posts: await helpers.element('fb_post_in_uid'),
  seeMore: await helpers.element('fb_see_more_content_post_btn'),
  uidInPost: await helpers.element('fb_uid_in_post_in_uid'),
  content: await helpers.element('fb_content_in_post_in_uid'),
  rawPostLink: await helpers.element('RawPostLinkInUid'),
  postLink: await helpers.element('PostLinkInUid')
};
const limit = Math.max(1, Number(vars.countPostFindData || input.countPostFindData || 10));
const collectPostLinks = vars.isFindPostLink === true || input.isFindPostLink === true;

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

  function normalizeHref(href) {
    if (!href) return '';
    try {
      const url = new URL(href, location.href);
      return url.href;
    } catch {
      return String(href || '').trim();
    }
  }

  function firstPostLink(post) {
    const links = xpathAll(selectors.postLink, post)
      .map(el => normalizeHref(hrefOf(el)))
      .filter(Boolean)
      .filter(href => href.includes('/posts/') || href.includes('story_fbid='));
    return links[0] || '';
  }

  async function resolvePostLink(post) {
    let rawPostLink = '';
    let postLink = firstPostLink(post);
    if (postLink) return { rawPostLink, postLink };

    const rawLinks = xpathAll(selectors.rawPostLink, post).slice(0, 5);
    for (const rawLinkEl of rawLinks) {
      rawPostLink = rawPostLink || normalizeHref(hrefOf(rawLinkEl));
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
    const linkInfo = collectPostLinks ? await resolvePostLink(post) : { rawPostLink: '', postLink: '' };
    rows.push({
      index: i + 1,
      content,
      authorUrl,
      authorUid: extractUid(authorUrl),
      rawPostLink: linkInfo.rawPostLink || '',
      postLink: linkInfo.postLink || ''
    });
  }

  return rows;
`, selectors, limit, collectPostLinks);

vars.findDataPosts = Array.isArray(posts) ? posts : [];
helpers.log('Đã tải ' + vars.findDataPosts.length + ' bài viết trong group');
return { posts: vars.findDataPosts };
$block$,
  output_schema = '[{"name":"posts","type":"json","label":"Posts"}]'::jsonb,
  updated_at = now()
WHERE name = 'fb_collect_group_posts';

UPDATE public.auto_blocks
SET
  code = $block$
function ensureResults() {
  if (!vars.findDataResults || typeof vars.findDataResults !== 'object') {
    vars.findDataResults = { phones: [], linkGroupZalos: [], uids: [], postLinks: [] };
  }
  if (!Array.isArray(vars.findDataResults.postLinks)) vars.findDataResults.postLinks = [];
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

if (vars.isFindInPost || vars.isFindPostLink) {
  for (const post of posts) {
    const content = String(post && post.content ? post.content : '');
    if (!matchesContent(content)) continue;
    matchedPosts++;
    if (vars.isFindPhone) results.phones.push(...findPhones(content));
    if (vars.isFindLinkGroupZalo) results.linkGroupZalos.push(...findZaloLinks(content));
    if (vars.isFindUid && post && post.authorUid) results.uids.push(String(post.authorUid));
    if (vars.isFindPostLink && post && post.postLink) results.postLinks.push(String(post.postLink));
  }
}

results.phones = unique(results.phones);
results.linkGroupZalos = unique(results.linkGroupZalos);
results.uids = unique(results.uids);
results.postLinks = unique(results.postLinks);

return {
  matchedPosts,
  phones: results.phones,
  linkGroupZalos: results.linkGroupZalos,
  uids: results.uids,
  postLinks: results.postLinks
};
$block$,
  output_schema = '[
    {"name":"phones","type":"json","label":"Phones"},
    {"name":"linkGroupZalos","type":"json","label":"Zalo links"},
    {"name":"uids","type":"json","label":"UIDs"},
    {"name":"postLinks","type":"json","label":"Post links"}
  ]'::jsonb,
  updated_at = now()
WHERE name = 'fb_extract_data_from_group_posts';

UPDATE public.auto_blocks
SET
  code = $block$
function unique(arr) {
  return Array.from(new Set((arr || []).map(x => String(x || '').trim()).filter(Boolean)));
}

const results = vars.findDataResults || { phones: [], linkGroupZalos: [], uids: [], postLinks: [] };
const phones = unique(results.phones);
const linkGroupZalos = unique(results.linkGroupZalos);
const uids = unique(results.uids);
const postLinks = unique(results.postLinks);
const total = phones.length + linkGroupZalos.length + uids.length + postLinks.length;
const notes = [];
if (vars.isFindPhone) notes.push('Đã tìm được ' + phones.length + ' số điện thoại');
if (vars.isFindLinkGroupZalo) notes.push('Đã tìm được ' + linkGroupZalos.length + ' link group Zalo');
if (vars.isFindUid) notes.push('Đã tìm được ' + uids.length + ' UID');
if (vars.isFindPostLink) notes.push('Đã tìm được ' + postLinks.length + ' link bài post');
const message = notes.join(' - ') || 'Không có loại data nào được chọn';

vars.findDataResults = { phones, linkGroupZalos, uids, postLinks };
helpers.log(message);

return {
  ok: true,
  groupUrl: vars.findDataGroupUrl || vars.targetUrl || vars.inputDataUid || '',
  phones,
  linkGroupZalos,
  uids,
  postLinks,
  total,
  message
};
$block$,
  output_schema = '[
    {"name":"phones","type":"json","label":"Phones"},
    {"name":"linkGroupZalos","type":"json","label":"Zalo links"},
    {"name":"uids","type":"json","label":"UIDs"},
    {"name":"postLinks","type":"json","label":"Post links"},
    {"name":"total","type":"number","label":"Total"}
  ]'::jsonb,
  updated_at = now()
WHERE name = 'fb_find_group_data_summary';

UPDATE public.auto_workflows
SET
  variables_schema = '[
    {"name":"targetUrl","type":"string","label":"Group URL/UID"},
    {"name":"isFindPhone","type":"boolean","label":"Tìm số điện thoại","default":false},
    {"name":"isFindLinkGroupZalo","type":"boolean","label":"Tìm link group Zalo","default":false},
    {"name":"isFindUid","type":"boolean","label":"Tìm UID","default":false},
    {"name":"isFindPostLink","type":"boolean","label":"Tìm link bài post","default":false},
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
  default_variables = coalesce(default_variables, '{}'::jsonb) || '{"isFindPostLink": false}'::jsonb,
  updated_at = now()
WHERE name = '[Built-in] Facebook - Tìm kiếm data trong group';

COMMIT;
