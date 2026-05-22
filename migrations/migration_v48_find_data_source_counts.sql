-- Add source-specific counts to facebook_find_data_group logs.
-- Totals stay deduped; sourceCounts are only for customer-readable reporting.

BEGIN;

UPDATE public.auto_blocks
SET
  code = $block$
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
const posts = Array.isArray(input.posts) ? input.posts : (Array.isArray(vars.findDataPosts) ? vars.findDataPosts : []);
let matchedPosts = 0;

if (vars.isFindInPost || vars.isFindPostLink) {
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
      const linkGroupZalos = findZaloLinks(content);
      results.linkGroupZalos.push(...linkGroupZalos);
      sourcePost.linkGroupZalos.push(...linkGroupZalos);
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
  postLinks: results.postLinks,
  sourceCounts: {
    post: {
      phones: sourcePost.phones.length,
      linkGroupZalos: sourcePost.linkGroupZalos.length,
      uids: sourcePost.uids.length,
      postLinks: sourcePost.postLinks.length
    }
  }
};
$block$,
  output_schema = '[
    {"name":"phones","type":"json","label":"Phones"},
    {"name":"linkGroupZalos","type":"json","label":"Zalo links"},
    {"name":"uids","type":"json","label":"UIDs"},
    {"name":"postLinks","type":"json","label":"Post links"},
    {"name":"sourceCounts","type":"json","label":"Source counts"}
  ]'::jsonb,
  updated_at = now()
WHERE name = 'fb_extract_data_from_group_posts';

UPDATE public.auto_blocks
SET
  code = $block$
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
const comments = Array.isArray(input.commentItems) ? input.commentItems : (Array.isArray(vars.findDataComments) ? vars.findDataComments : []);
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
      const linkGroupZalos = findZaloLinks(content);
      results.linkGroupZalos.push(...linkGroupZalos);
      sourceComment.linkGroupZalos.push(...linkGroupZalos);
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
  uids: results.uids,
  sourceCounts: {
    comment: {
      phones: sourceComment.phones.length,
      linkGroupZalos: sourceComment.linkGroupZalos.length,
      uids: sourceComment.uids.length
    }
  }
};
$block$,
  output_schema = '[
    {"name":"phones","type":"json","label":"Phones"},
    {"name":"linkGroupZalos","type":"json","label":"Zalo links"},
    {"name":"uids","type":"json","label":"UIDs"},
    {"name":"sourceCounts","type":"json","label":"Source counts"}
  ]'::jsonb,
  updated_at = now()
WHERE name = 'fb_extract_data_from_group_comments';

UPDATE public.auto_blocks
SET
  code = $block$
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

  function isVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
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

  function isScrollable(el) {
    if (!el || el === document.body) return false;
    try {
      const style = window.getComputedStyle(el);
      const overflowY = style.overflowY || style.overflow;
      if (!/(auto|scroll|overlay)/i.test(overflowY)) return false;
      return el.scrollHeight > el.clientHeight + 80;
    } catch {
      return false;
    }
  }

  function scrollContainers() {
    const seen = new Set();
    const out = [];
    function add(el) {
      if (!el || seen.has(el)) return;
      seen.add(el);
      out.push(el);
    }
    add(document.scrollingElement || document.documentElement);
    const candidates = Array.from(document.querySelectorAll('main, div, section'))
      .filter(el => isVisible(el) && isScrollable(el))
      .sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight))
      .slice(0, 8);
    candidates.forEach(add);
    return out;
  }

  function scrollForMore(links) {
    const amount = Math.max(900, Math.floor((window.innerHeight || 800) * 0.9));
    if (links.length > 0) {
      try { links[links.length - 1].scrollIntoView({ block: 'end', inline: 'nearest' }); } catch {}
    }
    for (const container of scrollContainers()) {
      try { container.scrollTop = container.scrollTop + amount; } catch {}
    }
    window.scrollBy(0, amount);
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
    scrollForMore(links);
    await delay(2000);
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

return {
  members: memberRows,
  uids: memberUids,
  sourceCounts: {
    groupMembers: {
      uids: results.sourceData.groupMembers.uids.length
    }
  }
};
$block$,
  output_schema = '[
    {"name":"members","type":"json","label":"Members"},
    {"name":"uids","type":"json","label":"UIDs"},
    {"name":"sourceCounts","type":"json","label":"Source counts"}
  ]'::jsonb,
  updated_at = now()
WHERE name = 'fb_collect_group_members';

UPDATE public.auto_blocks
SET
  code = $block$
function unique(arr) {
  return Array.from(new Set((arr || []).map(x => String(x || '').trim()).filter(Boolean)));
}

function uniqueMembers(arr) {
  const map = new Map();
  for (const raw of Array.isArray(arr) ? arr : []) {
    if (!raw || typeof raw !== 'object') continue;
    const uid = String(raw.uid || '').trim();
    const name = String(raw.name || '').trim();
    if (!uid || !name || map.has(uid)) continue;
    map.set(uid, {
      uid,
      name,
      url: String(raw.url || '').trim()
    });
  }
  return Array.from(map.values());
}

function ensureSourceData(results) {
  if (!results.sourceData || typeof results.sourceData !== 'object') results.sourceData = {};
  if (!results.sourceData.post || typeof results.sourceData.post !== 'object') results.sourceData.post = {};
  if (!results.sourceData.comment || typeof results.sourceData.comment !== 'object') results.sourceData.comment = {};
  if (!results.sourceData.groupMembers || typeof results.sourceData.groupMembers !== 'object') results.sourceData.groupMembers = {};

  if (!Array.isArray(results.sourceData.post.phones)) results.sourceData.post.phones = [];
  if (!Array.isArray(results.sourceData.post.linkGroupZalos)) results.sourceData.post.linkGroupZalos = [];
  if (!Array.isArray(results.sourceData.post.uids)) results.sourceData.post.uids = [];
  if (!Array.isArray(results.sourceData.post.postLinks)) results.sourceData.post.postLinks = [];

  if (!Array.isArray(results.sourceData.comment.phones)) results.sourceData.comment.phones = [];
  if (!Array.isArray(results.sourceData.comment.linkGroupZalos)) results.sourceData.comment.linkGroupZalos = [];
  if (!Array.isArray(results.sourceData.comment.uids)) results.sourceData.comment.uids = [];

  if (!Array.isArray(results.sourceData.groupMembers.uids)) results.sourceData.groupMembers.uids = [];

  results.sourceData.post.phones = unique(results.sourceData.post.phones);
  results.sourceData.post.linkGroupZalos = unique(results.sourceData.post.linkGroupZalos);
  results.sourceData.post.uids = unique(results.sourceData.post.uids);
  results.sourceData.post.postLinks = unique(results.sourceData.post.postLinks);
  results.sourceData.comment.phones = unique(results.sourceData.comment.phones);
  results.sourceData.comment.linkGroupZalos = unique(results.sourceData.comment.linkGroupZalos);
  results.sourceData.comment.uids = unique(results.sourceData.comment.uids);
  results.sourceData.groupMembers.uids = unique(results.sourceData.groupMembers.uids);

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
$block$,
  output_schema = '[
    {"name":"phones","type":"json","label":"Phones"},
    {"name":"linkGroupZalos","type":"json","label":"Zalo links"},
    {"name":"uids","type":"json","label":"UIDs"},
    {"name":"postLinks","type":"json","label":"Post links"},
    {"name":"groupMembers","type":"json","label":"Group members"},
    {"name":"sourceCounts","type":"json","label":"Source counts"},
    {"name":"total","type":"number","label":"Total"}
  ]'::jsonb,
  updated_at = now()
WHERE name = 'fb_find_group_data_summary';

COMMIT;
