-- Let post content filters constrain comment collection without implying post data extraction.

BEGIN;

CREATE TEMP TABLE _v106_block_before (
  name text PRIMARY KEY,
  code text NOT NULL
) ON COMMIT DROP;

INSERT INTO _v106_block_before (name, code)
SELECT name, code
FROM public.auto_blocks
WHERE name IN (
  'fb_extract_data_from_group_posts',
  'fb_collect_group_comments',
  'fb_extract_data_from_search_posts',
  'fb_collect_search_post_comments'
);

UPDATE public.auto_blocks AS block
SET code = replace(block.code, 'let matchedPosts = 0;', $v106$
let matchedPosts = 0;
const postFilterEnabled = (
  vars.isFindPostByKeywords === true && String(vars.postKeywords || '').trim().length > 0
) || (
  vars.isFindPostByContentAI === true && String(vars.postContentAI || '').trim().length > 0
);
const matchedPostIndexes = [];
vars.findDataPostFilterEnabled = postFilterEnabled;
vars.findDataMatchedPostIndexes = [];
$v106$)
WHERE block.name IN (
  'fb_extract_data_from_group_posts',
  'fb_extract_data_from_search_posts'
);

UPDATE public.auto_blocks AS block
SET code = replace(block.code,
  'for (const post of posts) {',
  'for (let postLoopIndex = 0; postLoopIndex < posts.length; postLoopIndex++) {
    const post = posts[postLoopIndex];'
)
WHERE block.name IN (
  'fb_extract_data_from_group_posts',
  'fb_extract_data_from_search_posts'
);

UPDATE public.auto_blocks AS block
SET code = replace(block.code,
  'if (vars.isFindInPost || vars.isFindPostLink || vars.isFindNewInteractors) {',
  'if (vars.isFindInPost || vars.isFindInComment || vars.isFindPostLink || vars.isFindNewInteractors) {'
)
WHERE block.name = 'fb_extract_data_from_group_posts';

UPDATE public.auto_blocks AS block
SET code = replace(block.code,
  '    const content = String(post && post.content ? post.content : '''');',
  '    const content = String(post && post.content ? post.content : '''');
    const postIndexForFilter = Math.max(1, Number(post && post.index ? post.index : postLoopIndex + 1));'
)
WHERE block.name = 'fb_extract_data_from_group_posts';

UPDATE public.auto_blocks AS block
SET code = replace(block.code,
  '      const content = String(post && post.content ? post.content : '''');',
  '      const content = String(post && post.content ? post.content : '''');
      const postIndexForFilter = Math.max(1, Number(post && post.index ? post.index : postLoopIndex + 1));'
)
WHERE block.name = 'fb_extract_data_from_search_posts';

UPDATE public.auto_blocks AS block
SET code = replace(block.code,
  'const meaningAiCheck = (vars.isFindInPost || vars.isFindPostLink) && contentMatches ? await checkMeaningAi(content, ''post'') : createEmptyMeaningAiCheck();',
  'const shouldExtractPostData = vars.isFindInPost || vars.isFindPostLink;
    const shouldFilterPostForComments = vars.isFindInComment === true && postFilterEnabled;
    const shouldEvaluatePostContent = shouldExtractPostData || shouldFilterPostForComments;
    const meaningAiCheck = shouldEvaluatePostContent && contentMatches ? await checkMeaningAi(content, ''post'') : createEmptyMeaningAiCheck();'
)
WHERE block.name IN (
  'fb_extract_data_from_group_posts',
  'fb_extract_data_from_search_posts'
);

UPDATE public.auto_blocks AS block
SET code = replace(block.code,
  'if ((vars.isFindInPost || vars.isFindPostLink) && !contentMatches)',
  'if (shouldEvaluatePostContent && !contentMatches)'
)
WHERE block.name IN (
  'fb_extract_data_from_group_posts',
  'fb_extract_data_from_search_posts'
);

UPDATE public.auto_blocks AS block
SET code = replace(block.code,
  'if ((vars.isFindInPost || vars.isFindPostLink) && contentMatches && !meaningAiAccepted)',
  'if (shouldEvaluatePostContent && contentMatches && !meaningAiAccepted)'
)
WHERE block.name IN (
  'fb_extract_data_from_group_posts',
  'fb_extract_data_from_search_posts'
);

UPDATE public.auto_blocks AS block
SET code = replace(block.code,
  'if ((vars.isFindInPost || vars.isFindPostLink) && contentMatches && meaningAiAccepted)',
  'if (shouldEvaluatePostContent && contentMatches && meaningAiAccepted)'
)
WHERE block.name IN (
  'fb_extract_data_from_group_posts',
  'fb_extract_data_from_search_posts'
);

UPDATE public.auto_blocks AS block
SET code = replace(block.code,
  'matchedPosts++;',
  'matchedPosts++;
      if (postFilterEnabled) matchedPostIndexes.push(postIndexForFilter);'
)
WHERE block.name IN (
  'fb_extract_data_from_group_posts',
  'fb_extract_data_from_search_posts'
);

UPDATE public.auto_blocks AS block
SET code = replace(block.code,
  'const shouldLogPostExtract = ((vars.isFindInPost || vars.isFindPostLink) && contentMatches && meaningAiAccepted) || (vars.isFindNewInteractors && vars.isFindUid && newInteractorUid);',
  'const shouldLogPostExtract = (shouldEvaluatePostContent && contentMatches && meaningAiAccepted) || (vars.isFindNewInteractors && vars.isFindUid && newInteractorUid);'
)
WHERE block.name = 'fb_extract_data_from_group_posts';

UPDATE public.auto_blocks AS block
SET code = replace(block.code,
  'return {
  matchedPosts,',
  'vars.findDataMatchedPostIndexes = unique(matchedPostIndexes);
vars.findDataPostFilterEnabled = postFilterEnabled;

return {
  matchedPosts,'
)
WHERE block.name = 'fb_extract_data_from_group_posts';

UPDATE public.auto_blocks AS block
SET code = replace(block.code,
  'return { matchedPosts, phones: results.phones, linkGroupZalos: results.linkGroupZalos, uids: results.uids, postLinks: results.postLinks };',
  'vars.findDataMatchedPostIndexes = unique(matchedPostIndexes);
  vars.findDataPostFilterEnabled = postFilterEnabled;
  return { matchedPosts, phones: results.phones, linkGroupZalos: results.linkGroupZalos, uids: results.uids, postLinks: results.postLinks };'
)
WHERE block.name = 'fb_extract_data_from_search_posts';

UPDATE public.auto_blocks AS block
SET code = replace(block.code,
  'const sortType = String(vars.sortTypeComment || ''most_relevant'');',
  'const sortType = String(vars.sortTypeComment || ''most_relevant'');
const postFilterEnabled = vars.findDataPostFilterEnabled === true;
const matchedPostIndexesForComments = Array.isArray(vars.findDataMatchedPostIndexes)
  ? vars.findDataMatchedPostIndexes.map(value => Math.max(1, Number(value) || 0)).filter(Boolean)
  : [];'
)
WHERE block.name IN (
  'fb_collect_group_comments',
  'fb_collect_search_post_comments'
);

UPDATE public.auto_blocks AS block
SET code = replace(block.code,
  '  const sortType = __args[3];',
  '  const sortType = __args[3];
  const postFilterEnabled = __args[4] === true;
  const matchedPostIndexes = new Set((Array.isArray(__args[5]) ? __args[5] : []).map(value => Math.max(1, Number(value) || 0)).filter(Boolean));'
)
WHERE block.name = 'fb_collect_group_comments';

UPDATE public.auto_blocks AS block
SET code = replace(block.code,
  '    const sortType = __args[3];',
  '    const sortType = __args[3];
    const postFilterEnabled = __args[4] === true;
    const matchedPostIndexes = new Set((Array.isArray(__args[5]) ? __args[5] : []).map(value => Math.max(1, Number(value) || 0)).filter(Boolean));'
)
WHERE block.name = 'fb_collect_search_post_comments';

UPDATE public.auto_blocks AS block
SET code = replace(block.code,
  '      error: ''''
    };',
  '      error: '''',
      filteredByPostContent: false
    };
    if (postFilterEnabled && !matchedPostIndexes.has(p + 1)) {
      postStat.filteredByPostContent = true;
      postStat.error = ''Không đạt điều kiện nội dung bài viết'';
      postCommentStats.push(postStat);
      continue;
    }'
)
WHERE block.name = 'fb_collect_group_comments';

UPDATE public.auto_blocks AS block
SET code = replace(block.code,
  'const postStat = { postIndex: p + 1, opened: false, sorted: sortType === ''most_relevant'', commentsCount: 0, error: '''' };',
  'const postStat = { postIndex: p + 1, opened: false, sorted: sortType === ''most_relevant'', commentsCount: 0, error: '''', filteredByPostContent: false };
      if (postFilterEnabled && !matchedPostIndexes.has(p + 1)) {
        postStat.filteredByPostContent = true;
        postStat.error = ''Không đạt điều kiện nội dung bài viết'';
        postCommentStats.push(postStat);
        continue;
      }'
)
WHERE block.name = 'fb_collect_search_post_comments';

UPDATE public.auto_blocks AS block
SET code = replace(block.code,
  '`, selectors, postLimit, commentLimit, sortType);',
  '`, selectors, postLimit, commentLimit, sortType, postFilterEnabled, matchedPostIndexesForComments);'
)
WHERE block.name = 'fb_collect_group_comments';

UPDATE public.auto_blocks AS block
SET code = replace(block.code,
  '`, selectors, postLimit, commentLimit, sortType);',
  '`, selectors, postLimit, commentLimit, sortType, postFilterEnabled, matchedPostIndexesForComments);'
)
WHERE block.name = 'fb_collect_search_post_comments';

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
    FROM _v106_block_before before_block
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
  comment_filter_block_count integer;
BEGIN
  SELECT count(*)
  INTO patched_block_count
  FROM public.auto_blocks AS block
  JOIN _v106_block_before AS before_block ON before_block.name = block.name
  WHERE before_block.code IS DISTINCT FROM block.code;

  IF patched_block_count <> 4 THEN
    RAISE EXCEPTION 'Expected v106 to patch 4 find-data blocks, patched %.', patched_block_count;
  END IF;

  SELECT count(*)
  INTO comment_filter_block_count
  FROM public.auto_blocks
  WHERE name IN ('fb_collect_group_comments', 'fb_collect_search_post_comments')
    AND code LIKE '%Không đạt điều kiện nội dung bài viết%'
    AND code LIKE '%matchedPostIndexes%';

  IF comment_filter_block_count <> 2 THEN
    RAISE EXCEPTION 'Expected 2 comment blocks to filter by matched post indexes, got %.', comment_filter_block_count;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;
