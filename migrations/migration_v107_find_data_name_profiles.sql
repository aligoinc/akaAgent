-- Carry author/name metadata for found UIDs and phones.

BEGIN;

CREATE TEMP TABLE _v107_block_before (
  name text PRIMARY KEY,
  code text NOT NULL
) ON COMMIT DROP;

INSERT INTO _v107_block_before (name, code)
SELECT name, code
FROM public.auto_blocks
WHERE name IN (
  'fb_extract_data_from_group_posts',
  'fb_collect_group_comments',
  'fb_extract_data_from_search_posts',
  'fb_collect_search_post_comments',
  'fb_find_group_data_summary',
  'fb_find_search_data_summary'
);

-- All find-data extract blocks keep legacy arrays and add profile arrays.
UPDATE public.auto_blocks AS block
SET code = replace(block.code,
  'if (!Array.isArray(results.uids)) results.uids = [];',
  'if (!Array.isArray(results.uids)) results.uids = [];
  if (!Array.isArray(results.uidProfiles)) results.uidProfiles = [];
  if (!Array.isArray(results.phoneProfiles)) results.phoneProfiles = [];'
)
WHERE block.name IN (
  'fb_extract_data_from_group_posts',
  'fb_collect_group_comments',
  'fb_extract_data_from_search_posts',
  'fb_collect_search_post_comments'
);

-- Group post extraction profiles.
UPDATE public.auto_blocks AS block
SET code = replace(block.code, $v107$
      if (vars.isFindInPost && vars.isFindPhone) {
        const phones = findPhones(content);
        results.phones.push(...phones);
        sourcePost.phones.push(...phones);
      }
$v107$, $v107$
      if (vars.isFindInPost && vars.isFindPhone) {
        const phones = findPhones(content);
        results.phones.push(...phones);
        sourcePost.phones.push(...phones);
        for (const phone of phones) {
          results.phoneProfiles.push({
            phone,
            name: postAuthorNameForLog,
            uid: authorUidFromItem(post),
            url: String(post && post.authorUrl ? post.authorUrl : ''),
            source: 'post'
          });
        }
      }
$v107$)
WHERE block.name = 'fb_extract_data_from_group_posts';

UPDATE public.auto_blocks AS block
SET code = replace(block.code, $v107$
      if (vars.isFindInPost && vars.isFindUid && authorUid) {
        results.uids.push(authorUid);
        sourcePost.uids.push(authorUid);
      }
$v107$, $v107$
      if (vars.isFindInPost && vars.isFindUid && authorUid) {
        results.uids.push(authorUid);
        sourcePost.uids.push(authorUid);
        results.uidProfiles.push({
          uid: authorUid,
          name: postAuthorNameForLog,
          url: String(post && post.authorUrl ? post.authorUrl : ''),
          source: 'post'
        });
      }
$v107$)
WHERE block.name = 'fb_extract_data_from_group_posts';

UPDATE public.auto_blocks AS block
SET code = replace(block.code, $v107$
    if (vars.isFindNewInteractors && vars.isFindUid && newInteractorUid) {
      results.uids.push(newInteractorUid);
      sourceNewInteractors.uids.push(newInteractorUid);
    }
$v107$, $v107$
    if (vars.isFindNewInteractors && vars.isFindUid && newInteractorUid) {
      results.uids.push(newInteractorUid);
      sourceNewInteractors.uids.push(newInteractorUid);
      results.uidProfiles.push({
        uid: newInteractorUid,
        name: postAuthorNameForLog,
        url: String(post && post.authorUrl ? post.authorUrl : ''),
        source: 'new_interactor'
      });
    }
$v107$)
WHERE block.name = 'fb_extract_data_from_group_posts';

-- Group comment extraction profiles.
UPDATE public.auto_blocks AS block
SET code = replace(block.code, $v107$
      if (vars.isFindPhone) {
        results.phones.push(...commentPhonesForLog);
        sourceComment.phones.push(...commentPhonesForLog);
      }
$v107$, $v107$
      if (vars.isFindPhone) {
        results.phones.push(...commentPhonesForLog);
        sourceComment.phones.push(...commentPhonesForLog);
        for (const phone of commentPhonesForLog) {
          results.phoneProfiles.push({
            phone,
            name: commentAuthorNameForLog,
            uid: commentAuthorUidForLog,
            url: String(comment && comment.authorUrl ? comment.authorUrl : ''),
            source: 'comment'
          });
        }
      }
$v107$)
WHERE block.name = 'fb_collect_group_comments';

UPDATE public.auto_blocks AS block
SET code = replace(block.code, $v107$
      if (vars.isFindUid && commentAuthorUidForLog) {
        results.uids.push(commentAuthorUidForLog);
        sourceComment.uids.push(commentAuthorUidForLog);
      }
$v107$, $v107$
      if (vars.isFindUid && commentAuthorUidForLog) {
        results.uids.push(commentAuthorUidForLog);
        sourceComment.uids.push(commentAuthorUidForLog);
        results.uidProfiles.push({
          uid: commentAuthorUidForLog,
          name: commentAuthorNameForLog,
          url: String(comment && comment.authorUrl ? comment.authorUrl : ''),
          source: 'comment'
        });
      }
$v107$)
WHERE block.name = 'fb_collect_group_comments';

UPDATE public.auto_blocks AS block
SET code = replace(block.code, $v107$
    if (vars.isFindNewInteractors && vars.isFindUid && newInteractorUid) {
      results.uids.push(newInteractorUid);
      sourceNewInteractors.uids.push(newInteractorUid);
    }
$v107$, $v107$
    if (vars.isFindNewInteractors && vars.isFindUid && newInteractorUid) {
      results.uids.push(newInteractorUid);
      sourceNewInteractors.uids.push(newInteractorUid);
      results.uidProfiles.push({
        uid: newInteractorUid,
        name: commentAuthorNameForLog,
        url: String(comment && comment.authorUrl ? comment.authorUrl : ''),
        source: 'new_interactor'
      });
    }
$v107$)
WHERE block.name = 'fb_collect_group_comments';

-- Search post/comment extraction profiles.
UPDATE public.auto_blocks AS block
SET code = replace(block.code,
  'if (vars.isFindInPost && vars.isFindPhone) { results.phones.push(...postPhonesForLog); sourcePost.phones.push(...postPhonesForLog); }',
  'if (vars.isFindInPost && vars.isFindPhone) { results.phones.push(...postPhonesForLog); sourcePost.phones.push(...postPhonesForLog); for (const phone of postPhonesForLog) results.phoneProfiles.push({ phone, name: postAuthorNameForLog, uid: postAuthorUidForLog, url: String(post && post.authorUrl ? post.authorUrl : ''''), source: ''post'' }); }'
)
WHERE block.name = 'fb_extract_data_from_search_posts';

UPDATE public.auto_blocks AS block
SET code = replace(block.code,
  'if (vars.isFindInPost && vars.isFindUid && postAuthorUidForLog) { results.uids.push(postAuthorUidForLog); sourcePost.uids.push(postAuthorUidForLog); }',
  'if (vars.isFindInPost && vars.isFindUid && postAuthorUidForLog) { results.uids.push(postAuthorUidForLog); sourcePost.uids.push(postAuthorUidForLog); results.uidProfiles.push({ uid: postAuthorUidForLog, name: postAuthorNameForLog, url: String(post && post.authorUrl ? post.authorUrl : ''''), source: ''post'' }); }'
)
WHERE block.name = 'fb_extract_data_from_search_posts';

UPDATE public.auto_blocks AS block
SET code = replace(block.code,
  'if (vars.isFindPhone) { results.phones.push(...commentPhonesForLog); sourceComment.phones.push(...commentPhonesForLog); }',
  'if (vars.isFindPhone) { results.phones.push(...commentPhonesForLog); sourceComment.phones.push(...commentPhonesForLog); for (const phone of commentPhonesForLog) results.phoneProfiles.push({ phone, name: commentAuthorNameForLog, uid: commentAuthorUidForLog, url: authorUrl, source: ''comment'' }); }'
)
WHERE block.name = 'fb_collect_search_post_comments';

UPDATE public.auto_blocks AS block
SET code = replace(block.code,
  'if (vars.isFindUid && commentAuthorUidForLog) { results.uids.push(commentAuthorUidForLog); sourceComment.uids.push(commentAuthorUidForLog); }',
  'if (vars.isFindUid && commentAuthorUidForLog) { results.uids.push(commentAuthorUidForLog); sourceComment.uids.push(commentAuthorUidForLog); results.uidProfiles.push({ uid: commentAuthorUidForLog, name: commentAuthorNameForLog, url: authorUrl, source: ''comment'' }); }'
)
WHERE block.name = 'fb_collect_search_post_comments';

-- Summary blocks dedupe profile metadata and expose it to scheduler/UI.
UPDATE public.auto_blocks AS block
SET code = replace(block.code, $v107$
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
$v107$, $v107$
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

function uniqueUidProfiles(arr, allowedUids) {
  const allowed = new Set(unique(allowedUids));
  const map = new Map();
  for (const item of arr || []) {
    if (!item || typeof item !== 'object') continue;
    const uid = String(item.uid || '').trim();
    if (!uid || !allowed.has(uid)) continue;
    const current = map.get(uid) || { uid, name: '', url: '', source: '' };
    map.set(uid, {
      uid,
      name: current.name || String(item.name || '').trim(),
      url: current.url || String(item.url || '').trim(),
      source: current.source || String(item.source || '').trim()
    });
  }
  return Array.from(map.values());
}

function uniquePhoneProfiles(arr, allowedPhones) {
  const allowed = new Set(unique(allowedPhones).map(phone => phone.toLowerCase()));
  const map = new Map();
  for (const item of arr || []) {
    if (!item || typeof item !== 'object') continue;
    const phone = String(item.phone || '').trim();
    const key = phone.toLowerCase();
    if (!phone || !allowed.has(key)) continue;
    const current = map.get(key) || { phone, name: '', uid: '', url: '', source: '' };
    map.set(key, {
      phone: current.phone || phone,
      name: current.name || String(item.name || '').trim(),
      uid: current.uid || String(item.uid || '').trim(),
      url: current.url || String(item.url || '').trim(),
      source: current.source || String(item.source || '').trim()
    });
  }
  return Array.from(map.values());
}
$v107$)
WHERE block.name = 'fb_find_group_data_summary';

UPDATE public.auto_blocks AS block
SET code = replace(block.code,
  'const postLinks = unique(results.postLinks);',
  'const postLinks = unique(results.postLinks);
const uidProfiles = uniqueUidProfiles(results.uidProfiles, uids);
const phoneProfiles = uniquePhoneProfiles(results.phoneProfiles, phones);'
)
WHERE block.name = 'fb_find_group_data_summary';

UPDATE public.auto_blocks AS block
SET code = replace(block.code,
  'vars.findDataResults = { phones, linkGroupZalos, uids, postLinks, groupMembers, sourceData, sourceCounts };',
  'vars.findDataResults = { phones, linkGroupZalos, uids, postLinks, groupMembers, uidProfiles, phoneProfiles, sourceData, sourceCounts };'
)
WHERE block.name = 'fb_find_group_data_summary';

UPDATE public.auto_blocks AS block
SET code = replace(block.code,
  'groupMembers
    }',
  'groupMembers,
      uidProfiles,
      phoneProfiles
    }'
)
WHERE block.name = 'fb_find_group_data_summary';

UPDATE public.auto_blocks AS block
SET code = replace(block.code,
  'groupMembers,
  sourceCounts,',
  'groupMembers,
  uidProfiles,
  phoneProfiles,
  sourceCounts,'
)
WHERE block.name = 'fb_find_group_data_summary';

UPDATE public.auto_blocks AS block
SET code = replace(block.code,
  'function uniqueGroups(rawGroups) { const map = new Map(); for (const rawGroup of Array.isArray(rawGroups) ? rawGroups : []) { if (!rawGroup || typeof rawGroup !== ''object'') continue; const url = String(rawGroup.url || '''').trim(); const key = url.replace(/\/+$/g, '''').toLowerCase(); if (!url || !key || map.has(key)) continue; map.set(key, { url, name: String(rawGroup.name || '''').trim(), privacy: String(rawGroup.privacy || '''').trim(), memberCount: Number(rawGroup.memberCount || 0), postsPerDay: Number(rawGroup.postsPerDay || 0), keyword: String(rawGroup.keyword || vars.findDataSearchKeyword || '''').trim() }); } return Array.from(map.values()); }',
  'function uniqueGroups(rawGroups) { const map = new Map(); for (const rawGroup of Array.isArray(rawGroups) ? rawGroups : []) { if (!rawGroup || typeof rawGroup !== ''object'') continue; const url = String(rawGroup.url || '''').trim(); const key = url.replace(/\/+$/g, '''').toLowerCase(); if (!url || !key || map.has(key)) continue; map.set(key, { url, name: String(rawGroup.name || '''').trim(), privacy: String(rawGroup.privacy || '''').trim(), memberCount: Number(rawGroup.memberCount || 0), postsPerDay: Number(rawGroup.postsPerDay || 0), keyword: String(rawGroup.keyword || vars.findDataSearchKeyword || '''').trim() }); } return Array.from(map.values()); }
  function uniqueUidProfiles(arr, allowedUids) { const allowed = new Set(unique(allowedUids)); const map = new Map(); for (const item of Array.isArray(arr) ? arr : []) { if (!item || typeof item !== ''object'') continue; const uid = String(item.uid || '''').trim(); if (!uid || !allowed.has(uid)) continue; const current = map.get(uid) || { uid, name: '''', url: '''', source: '''' }; map.set(uid, { uid, name: current.name || String(item.name || '''').trim(), url: current.url || String(item.url || '''').trim(), source: current.source || String(item.source || '''').trim() }); } return Array.from(map.values()); }
  function uniquePhoneProfiles(arr, allowedPhones) { const allowed = new Set(unique(allowedPhones).map(phone => phone.toLowerCase())); const map = new Map(); for (const item of Array.isArray(arr) ? arr : []) { if (!item || typeof item !== ''object'') continue; const phone = String(item.phone || '''').trim(); const key = phone.toLowerCase(); if (!phone || !allowed.has(key)) continue; const current = map.get(key) || { phone, name: '''', uid: '''', url: '''', source: '''' }; map.set(key, { phone: current.phone || phone, name: current.name || String(item.name || '''').trim(), uid: current.uid || String(item.uid || '''').trim(), url: current.url || String(item.url || '''').trim(), source: current.source || String(item.source || '''').trim() }); } return Array.from(map.values()); }'
)
WHERE block.name = 'fb_find_search_data_summary';

UPDATE public.auto_blocks AS block
SET code = replace(block.code,
  'const phones = unique(results.phones); const linkGroupZalos = unique(results.linkGroupZalos); const uids = unique(results.uids); const postLinks = unique(results.postLinks);',
  'const phones = unique(results.phones); const linkGroupZalos = unique(results.linkGroupZalos); const uids = unique(results.uids); const postLinks = unique(results.postLinks); const uidProfiles = uniqueUidProfiles(results.uidProfiles, uids); const phoneProfiles = uniquePhoneProfiles(results.phoneProfiles, phones);'
)
WHERE block.name = 'fb_find_search_data_summary';

UPDATE public.auto_blocks AS block
SET code = replace(block.code,
  'vars.findDataResults = { phones, linkGroupZalos, uids, postLinks, groupMembers: [], facebookGroups, sourceData, sourceCounts };',
  'vars.findDataResults = { phones, linkGroupZalos, uids, postLinks, groupMembers: [], facebookGroups, uidProfiles, phoneProfiles, sourceData, sourceCounts };'
)
WHERE block.name = 'fb_find_search_data_summary';

UPDATE public.auto_blocks AS block
SET code = replace(block.code,
  'values: { phones, zaloGroupLinks: linkGroupZalos, postLinks, uids, facebookGroups: facebookGroups.map(group => group.url) }',
  'values: { phones, zaloGroupLinks: linkGroupZalos, postLinks, uids, facebookGroups: facebookGroups.map(group => group.url), uidProfiles, phoneProfiles }'
)
WHERE block.name = 'fb_find_search_data_summary';

UPDATE public.auto_blocks AS block
SET code = replace(block.code,
  'return { ok: true, searchKeyword: vars.findDataSearchKeyword || vars.inputDataUid || vars.inputDataName || '''', phones, linkGroupZalos, uids, postLinks, groupMembers: [], facebookGroups, sourceCounts, total, message };',
  'return { ok: true, searchKeyword: vars.findDataSearchKeyword || vars.inputDataUid || vars.inputDataName || '''', phones, linkGroupZalos, uids, postLinks, groupMembers: [], facebookGroups, uidProfiles, phoneProfiles, sourceCounts, total, message };'
)
WHERE block.name = 'fb_find_search_data_summary';

UPDATE public.auto_blocks AS block
SET updated_at = now()
WHERE block.name IN (
  'fb_extract_data_from_group_posts',
  'fb_collect_group_comments',
  'fb_extract_data_from_search_posts',
  'fb_collect_search_post_comments',
  'fb_find_group_data_summary',
  'fb_find_search_data_summary'
)
  AND EXISTS (
    SELECT 1
    FROM _v107_block_before before_block
    WHERE before_block.name = block.name
      AND before_block.code IS DISTINCT FROM block.code
  );

WITH target_workflows AS (
  SELECT workflow_id AS id
  FROM public.auto_campaign_actions
  WHERE id IN ('facebook_find_data_group', 'facebook_find_data_search')
    AND workflow_id IS NOT NULL
  UNION
  SELECT test_workflow_id AS id
  FROM public.auto_campaign_actions
  WHERE id IN ('facebook_find_data_group', 'facebook_find_data_search')
    AND test_workflow_id IS NOT NULL
)
UPDATE public.auto_workflows AS workflow
SET
  nodes = (
    SELECT COALESCE(
      jsonb_agg(
        CASE
          WHEN node.value->>'blockName' IN (
            'fb_extract_data_from_group_posts',
            'fb_collect_group_comments',
            'fb_extract_data_from_search_posts',
            'fb_collect_search_post_comments',
            'fb_find_group_data_summary',
            'fb_find_search_data_summary'
          ) THEN node.value - 'codeOverride'
          ELSE node.value
        END
        ORDER BY node.ordinality
      ),
      '[]'::jsonb
    )
    FROM jsonb_array_elements(COALESCE(workflow.nodes, '[]'::jsonb)) WITH ORDINALITY AS node(value, ordinality)
  ),
  updated_at = now()
WHERE workflow.id IN (SELECT id FROM target_workflows)
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(COALESCE(workflow.nodes, '[]'::jsonb)) AS node(value)
    WHERE node.value ? 'codeOverride'
      AND node.value->>'blockName' IN (
        'fb_extract_data_from_group_posts',
        'fb_collect_group_comments',
        'fb_extract_data_from_search_posts',
        'fb_collect_search_post_comments',
        'fb_find_group_data_summary',
        'fb_find_search_data_summary'
      )
  );

DO $$
DECLARE
  patched_block_count integer;
  profile_block_count integer;
  summary_output_count integer;
BEGIN
  SELECT count(*)
  INTO patched_block_count
  FROM public.auto_blocks AS block
  JOIN _v107_block_before AS before_block ON before_block.name = block.name
  WHERE before_block.code IS DISTINCT FROM block.code;

  IF patched_block_count <> 6 THEN
    RAISE EXCEPTION 'Expected v107 to patch 6 find-data blocks, patched %.', patched_block_count;
  END IF;

  SELECT count(*)
  INTO profile_block_count
  FROM public.auto_blocks
  WHERE name IN (
    'fb_extract_data_from_group_posts',
    'fb_collect_group_comments',
    'fb_extract_data_from_search_posts',
    'fb_collect_search_post_comments',
    'fb_find_group_data_summary',
    'fb_find_search_data_summary'
  )
    AND code LIKE '%uidProfiles%'
    AND code LIKE '%phoneProfiles%';

  IF profile_block_count <> 6 THEN
    RAISE EXCEPTION 'Expected 6 blocks to include uidProfiles/phoneProfiles, got %.', profile_block_count;
  END IF;

  SELECT count(*)
  INTO summary_output_count
  FROM public.auto_blocks
  WHERE name IN ('fb_find_group_data_summary', 'fb_find_search_data_summary')
    AND code LIKE '%return%uidProfiles%'
    AND code LIKE '%return%phoneProfiles%'
    AND code LIKE '%uids%'
    AND code LIKE '%phones%'
    AND code LIKE '%postLinks%';

  IF summary_output_count <> 2 THEN
    RAISE EXCEPTION 'Expected 2 summary blocks to return legacy arrays and profile arrays, got %.', summary_output_count;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;
