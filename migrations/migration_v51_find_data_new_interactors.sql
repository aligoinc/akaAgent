-- Add "Những người tương tác mới" as a UID-only source for facebook_find_data_group.
-- It reuses the post/comment scan, forces recent-activity/newest ordering from app vars, and keeps Post/Comment sources independent.

BEGIN;

UPDATE public.auto_blocks
SET
  code = replace(
    code,
    'const needsFeed = vars.isFindInPost === true || vars.isFindInComment === true || vars.isFindPostLink === true;',
    'const needsFeed = vars.isFindInPost === true || vars.isFindInComment === true || vars.isFindPostLink === true || vars.isFindNewInteractors === true;'
  ),
  updated_at = now()
WHERE name IN ('fb_open_group_discussion', 'fb_sort_group_posts', 'fb_collect_group_posts')
  AND code LIKE '%const needsFeed = vars.isFindInPost === true || vars.isFindInComment === true || vars.isFindPostLink === true;%';

UPDATE public.auto_blocks
SET
  code = replace(
    code,
    'if (!vars.isFindInComment) {',
    'if (vars.isFindInComment !== true && vars.isFindNewInteractors !== true) {'
  ),
  updated_at = now()
WHERE name = 'fb_collect_group_comments'
  AND code LIKE '%if (!vars.isFindInComment) {%';

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
  if (!results.sourceData.newInteractors || typeof results.sourceData.newInteractors !== 'object') results.sourceData.newInteractors = {};
  if (!Array.isArray(results.sourceData.newInteractors.uids)) results.sourceData.newInteractors.uids = [];
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
const sourceNewInteractors = results.sourceData.newInteractors;
const posts = Array.isArray(input.posts) ? input.posts : (Array.isArray(vars.findDataPosts) ? vars.findDataPosts : []);
let matchedPosts = 0;

if (vars.isFindInPost || vars.isFindPostLink || vars.isFindNewInteractors) {
  for (const post of posts) {
    const content = String(post && post.content ? post.content : '');
    const contentMatches = matchesContent(content);

    if ((vars.isFindInPost || vars.isFindPostLink) && contentMatches) {
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
    if (vars.isFindNewInteractors && vars.isFindUid && post && post.authorUid) {
      results.uids.push(String(post.authorUid));
      sourceNewInteractors.uids.push(String(post.authorUid));
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
  if (!results.sourceData.newInteractors || typeof results.sourceData.newInteractors !== 'object') results.sourceData.newInteractors = {};
  if (!Array.isArray(results.sourceData.newInteractors.uids)) results.sourceData.newInteractors.uids = [];
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
const sourceNewInteractors = results.sourceData.newInteractors;
const comments = Array.isArray(input.commentItems) ? input.commentItems : (Array.isArray(vars.findDataComments) ? vars.findDataComments : []);
let matchedComments = 0;

if (vars.isFindInComment || vars.isFindNewInteractors) {
  for (const comment of comments) {
    const content = String(comment && comment.content ? comment.content : '');
    const contentMatches = matchesContent(content);

    if (vars.isFindInComment && contentMatches) {
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
    if (vars.isFindNewInteractors && vars.isFindUid && comment && comment.authorUid) {
      results.uids.push(String(comment.authorUid));
      sourceNewInteractors.uids.push(String(comment.authorUid));
    }
  }
}

results.phones = unique(results.phones);
results.linkGroupZalos = unique(results.linkGroupZalos);
results.uids = unique(results.uids);
sourceComment.phones = unique(sourceComment.phones);
sourceComment.linkGroupZalos = unique(sourceComment.linkGroupZalos);
sourceComment.uids = unique(sourceComment.uids);
sourceNewInteractors.uids = unique(sourceNewInteractors.uids);

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
    },
    newInteractors: {
      uids: sourceNewInteractors.uids.length
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

UPDATE public.auto_workflows wf
SET
  variables_schema = (
    COALESCE((
      SELECT jsonb_agg(variable.value ORDER BY variable.ordinality)
      FROM jsonb_array_elements(COALESCE(wf.variables_schema, '[]'::jsonb)) WITH ORDINALITY AS variable(value, ordinality)
      WHERE variable.value->>'name' <> 'isFindNewInteractors'
    ), '[]'::jsonb)
    || '[
      {"name":"isFindNewInteractors","type":"boolean","label":"Tìm người tương tác mới","default":false}
    ]'::jsonb
  ),
  default_variables = COALESCE(wf.default_variables, '{}'::jsonb) || '{"isFindNewInteractors": false}'::jsonb,
  updated_at = now()
WHERE wf.name = '[Built-in] Facebook - Tìm kiếm data trong group';

NOTIFY pgrst, 'reload schema';

COMMIT;
