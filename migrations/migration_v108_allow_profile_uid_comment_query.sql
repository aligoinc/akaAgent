-- Accept profile URLs that carry comment query params while still rejecting content permalinks.

BEGIN;

CREATE TEMP TABLE _v108_block_before (
  name text PRIMARY KEY,
  code text NOT NULL
) ON COMMIT DROP;

INSERT INTO _v108_block_before (name, code)
SELECT name, code
FROM public.auto_blocks
WHERE name IN (
  'fb_extract_data_from_group_posts',
  'fb_collect_group_comments',
  'fb_extract_data_from_search_posts',
  'fb_collect_search_post_comments'
);

UPDATE public.auto_blocks AS block
SET code = replace(block.code, $old$
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
$old$, $new$
function authorUidFromItem(item) {
  const rawHref = String(item && item.authorUrl ? item.authorUrl : '').trim();
  const fallbackUid = String(item && item.authorUid ? item.authorUid : '').trim();

  try {
    const url = new URL(rawHref, 'https://www.facebook.com');
    const parts = url.pathname
      .split('/')
      .map(part => {
        try { return decodeURIComponent(part); } catch { return part; }
      })
      .map(part => part.trim())
      .filter(Boolean);
    const lowerParts = parts.map(part => part.toLowerCase());
    const firstPathPart = lowerParts[0] || '';

    if (firstPathPart === 'profile.php') {
      const id = url.searchParams.get('id');
      return id ? id.trim() : '';
    }

    const userIndex = lowerParts.indexOf('user');
    if (userIndex >= 0 && parts[userIndex + 1]) return parts[userIndex + 1];

    if (firstPathPart === 'groups') return '';

    const blockedPathParts = new Set(['posts', 'permalink', 'permalink.php', 'story.php', 'photo.php', 'photos', 'watch', 'reel', 'videos', 'video.php']);
    if (lowerParts.some(part => blockedPathParts.has(part))) return '';

    if (parts.length === 1 && parts[0]) return parts[0];
  } catch {}

  return fallbackUid;
}
$new$)
WHERE block.name IN (
  'fb_extract_data_from_group_posts',
  'fb_collect_group_comments'
);

UPDATE public.auto_blocks AS block
SET code = replace(block.code,
  'function authorUidFromItem(item) { const rawHref = String(item && item.authorUrl ? item.authorUrl : '''').trim(); const fallbackUid = String(item && item.authorUid ? item.authorUid : '''').trim(); const href = rawHref.toLowerCase(); if (href.includes(''/permalink/'') || href.includes(''/posts/'') || href.includes(''story_fbid='') || href.includes(''comment_id='') || href.includes(''reply_comment_id='') || (href.includes(''/groups/'') && !href.includes(''/user/''))) return ''''; try { const url = new URL(rawHref, ''https://www.facebook.com''); const id = url.searchParams.get(''id''); if (id) return id.trim(); const parts = url.pathname.split(''/'').map(part => { try { return decodeURIComponent(part); } catch { return part; } }).map(part => part.trim()).filter(Boolean); const userIndex = parts.indexOf(''user''); if (userIndex >= 0 && parts[userIndex + 1]) return parts[userIndex + 1]; const last = parts[parts.length - 1] || ''''; const blockedLastParts = new Set([''profile.php'', ''groups'', ''posts'', ''permalink'', ''story.php'', ''photo.php'', ''photos'', ''watch'', ''reel'']); if (last && !blockedLastParts.has(last.toLowerCase())) return last; } catch {} return fallbackUid; }',
  'function authorUidFromItem(item) { const rawHref = String(item && item.authorUrl ? item.authorUrl : '''').trim(); const fallbackUid = String(item && item.authorUid ? item.authorUid : '''').trim(); try { const url = new URL(rawHref, ''https://www.facebook.com''); const parts = url.pathname.split(''/'').map(part => { try { return decodeURIComponent(part); } catch { return part; } }).map(part => part.trim()).filter(Boolean); const lowerParts = parts.map(part => part.toLowerCase()); const firstPathPart = lowerParts[0] || ''''; if (firstPathPart === ''profile.php'') { const id = url.searchParams.get(''id''); return id ? id.trim() : ''''; } const userIndex = lowerParts.indexOf(''user''); if (userIndex >= 0 && parts[userIndex + 1]) return parts[userIndex + 1]; if (firstPathPart === ''groups'') return ''''; const blockedPathParts = new Set([''posts'', ''permalink'', ''permalink.php'', ''story.php'', ''photo.php'', ''photos'', ''watch'', ''reel'', ''videos'', ''video.php'']); if (lowerParts.some(part => blockedPathParts.has(part))) return ''''; if (parts.length === 1 && parts[0]) return parts[0]; } catch {} return fallbackUid; }'
)
WHERE block.name IN (
  'fb_extract_data_from_search_posts',
  'fb_collect_search_post_comments'
);

UPDATE public.auto_blocks AS block
SET code = replace(block.code, $old$
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
$old$, $new$
  function authorUidFromItem(item) {
    const rawHref = String(item && item.authorUrl ? item.authorUrl : '').trim();
    const fallbackUid = String(item && item.authorUid ? item.authorUid : '').trim();
    try {
      const url = new URL(rawHref, 'https://www.facebook.com');
      const parts = url.pathname.split('/').map(part => { try { return decodeURIComponent(part); } catch { return part; } }).map(part => part.trim()).filter(Boolean);
      const lowerParts = parts.map(part => part.toLowerCase());
      const firstPathPart = lowerParts[0] || '';
      if (firstPathPart === 'profile.php') {
        const id = url.searchParams.get('id');
        return id ? id.trim() : '';
      }
      const userIndex = lowerParts.indexOf('user');
      if (userIndex >= 0 && parts[userIndex + 1]) return parts[userIndex + 1];
      if (firstPathPart === 'groups') return '';
      const blockedPathParts = new Set(['posts', 'permalink', 'permalink.php', 'story.php', 'photo.php', 'photos', 'watch', 'reel', 'videos', 'video.php']);
      if (lowerParts.some(part => blockedPathParts.has(part))) return '';
      if (parts.length === 1 && parts[0]) return parts[0];
    } catch {}
    return fallbackUid;
  }
$new$)
WHERE block.name = 'fb_extract_data_from_search_posts';

UPDATE public.auto_blocks AS block
SET updated_at = now()
WHERE block.name IN (
  'fb_extract_data_from_group_posts',
  'fb_collect_group_comments',
  'fb_extract_data_from_search_posts',
  'fb_collect_search_post_comments'
)
  AND EXISTS (
    SELECT 1
    FROM _v108_block_before before_block
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
            'fb_collect_search_post_comments'
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
        'fb_collect_search_post_comments'
      )
  );

DO $$
DECLARE
  patched_block_count integer;
  profile_path_filter_count integer;
BEGIN
  SELECT count(*)
  INTO patched_block_count
  FROM public.auto_blocks AS block
  JOIN _v108_block_before AS before_block ON before_block.name = block.name
  WHERE before_block.code IS DISTINCT FROM block.code;

  IF patched_block_count <> 4 THEN
    RAISE EXCEPTION 'Expected v108 to patch 4 find-data UID blocks, patched %.', patched_block_count;
  END IF;

  SELECT count(*)
  INTO profile_path_filter_count
  FROM public.auto_blocks
  WHERE name IN (
    'fb_extract_data_from_group_posts',
    'fb_collect_group_comments',
    'fb_extract_data_from_search_posts',
    'fb_collect_search_post_comments'
  )
    AND code LIKE '%firstPathPart === ''profile.php''%'
    AND code LIKE '%const userIndex = lowerParts.indexOf(''user'')%'
    AND code LIKE '%blockedPathParts%';

  IF profile_path_filter_count <> 4 THEN
    RAISE EXCEPTION 'Expected 4 blocks to use path-based UID filtering, got %.', profile_path_filter_count;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;
