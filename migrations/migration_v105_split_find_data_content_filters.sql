-- Split find-data content filters into post-specific and comment-specific settings.

BEGIN;

WITH migrated_campaigns AS (
  SELECT
    id,
    COALESCE(extra_settings, '{}'::jsonb) AS extra
  FROM public.auto_campaigns
  WHERE action_id IN ('facebook_find_data_group', 'facebook_find_data_search')
)
UPDATE public.auto_campaigns AS campaign
SET
  extra_settings = (
    migrated.extra
      - 'isFindByKeywords'
      - 'keywords'
      - 'isFindByContentAI'
      - 'contentAI'
  ) || jsonb_build_object(
    'isFindPostByKeywords',
      CASE
        WHEN jsonb_typeof(migrated.extra->'isFindPostByKeywords') = 'boolean' THEN migrated.extra->'isFindPostByKeywords'
        WHEN jsonb_typeof(migrated.extra->'isFindByKeywords') = 'boolean' THEN migrated.extra->'isFindByKeywords'
        ELSE 'false'::jsonb
      END,
    'postKeywords',
      CASE
        WHEN jsonb_typeof(migrated.extra->'postKeywords') = 'string' THEN migrated.extra->'postKeywords'
        WHEN jsonb_typeof(migrated.extra->'keywords') = 'string' THEN migrated.extra->'keywords'
        ELSE to_jsonb(''::text)
      END,
    'isFindPostByContentAI',
      CASE
        WHEN jsonb_typeof(migrated.extra->'isFindPostByContentAI') = 'boolean' THEN migrated.extra->'isFindPostByContentAI'
        WHEN jsonb_typeof(migrated.extra->'isFindByContentAI') = 'boolean' THEN migrated.extra->'isFindByContentAI'
        ELSE 'false'::jsonb
      END,
    'postContentAI',
      CASE
        WHEN jsonb_typeof(migrated.extra->'postContentAI') = 'string' THEN migrated.extra->'postContentAI'
        WHEN jsonb_typeof(migrated.extra->'contentAI') = 'string' THEN migrated.extra->'contentAI'
        ELSE to_jsonb(''::text)
      END,
    'isFindCommentByKeywords',
      CASE
        WHEN jsonb_typeof(migrated.extra->'isFindCommentByKeywords') = 'boolean' THEN migrated.extra->'isFindCommentByKeywords'
        ELSE 'false'::jsonb
      END,
    'commentKeywords',
      CASE
        WHEN jsonb_typeof(migrated.extra->'commentKeywords') = 'string' THEN migrated.extra->'commentKeywords'
        ELSE to_jsonb(''::text)
      END,
    'isFindCommentByContentAI',
      CASE
        WHEN jsonb_typeof(migrated.extra->'isFindCommentByContentAI') = 'boolean' THEN migrated.extra->'isFindCommentByContentAI'
        ELSE 'false'::jsonb
      END,
    'commentContentAI',
      CASE
        WHEN jsonb_typeof(migrated.extra->'commentContentAI') = 'string' THEN migrated.extra->'commentContentAI'
        ELSE to_jsonb(''::text)
      END
  ),
  updated_at = now()
FROM migrated_campaigns AS migrated
WHERE campaign.id = migrated.id;

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
  UNION
  SELECT id
  FROM public.auto_workflows
  WHERE name IN (
    '[Built-in] Facebook - Tìm kiếm data trong group',
    '[Built-in] Facebook - Tìm kiếm data bằng search'
  )
)
UPDATE public.auto_workflows AS workflow
SET
  variables_schema = (
    SELECT COALESCE(jsonb_agg(variable.value ORDER BY variable.ordinality), '[]'::jsonb)
    FROM jsonb_array_elements(COALESCE(workflow.variables_schema, '[]'::jsonb)) WITH ORDINALITY AS variable(value, ordinality)
    WHERE variable.value->>'name' NOT IN (
      'isFindByKeywords',
      'keywords',
      'isFindByContentAI',
      'contentAI',
      'isFindPostByKeywords',
      'postKeywords',
      'isFindPostByContentAI',
      'postContentAI',
      'isFindCommentByKeywords',
      'commentKeywords',
      'isFindCommentByContentAI',
      'commentContentAI'
    )
  ) || '[
    {"name":"isFindPostByKeywords","type":"boolean","label":"Lọc từ khoá bài viết","default":false},
    {"name":"postKeywords","type":"string","label":"Từ khoá bài viết","default":""},
    {"name":"isFindPostByContentAI","type":"boolean","label":"Lọc ý nghĩa bài viết bằng AI","default":false},
    {"name":"postContentAI","type":"string","label":"Ý nghĩa bài viết","default":""},
    {"name":"isFindCommentByKeywords","type":"boolean","label":"Lọc từ khoá comment","default":false},
    {"name":"commentKeywords","type":"string","label":"Từ khoá comment","default":""},
    {"name":"isFindCommentByContentAI","type":"boolean","label":"Lọc ý nghĩa comment bằng AI","default":false},
    {"name":"commentContentAI","type":"string","label":"Ý nghĩa comment","default":""}
  ]'::jsonb,
  default_variables = (
    COALESCE(workflow.default_variables, '{}'::jsonb)
      - 'isFindByKeywords'
      - 'keywords'
      - 'isFindByContentAI'
      - 'contentAI'
      - 'isFindPostByKeywords'
      - 'postKeywords'
      - 'isFindPostByContentAI'
      - 'postContentAI'
      - 'isFindCommentByKeywords'
      - 'commentKeywords'
      - 'isFindCommentByContentAI'
      - 'commentContentAI'
  ) || jsonb_build_object(
    'isFindPostByKeywords', false,
    'postKeywords', '',
    'isFindPostByContentAI', false,
    'postContentAI', '',
    'isFindCommentByKeywords', false,
    'commentKeywords', '',
    'isFindCommentByContentAI', false,
    'commentContentAI', ''
  ),
  updated_at = now()
WHERE workflow.id IN (SELECT id FROM target_workflows);

UPDATE public.auto_blocks AS block
SET
  code = replace(
    replace(
      replace(
        replace(
          block.code,
          'vars.isFindByKeywords',
          'vars.isFindPostByKeywords'
        ),
        'vars.keywords',
        'vars.postKeywords'
      ),
      'vars.isFindByContentAI',
      'vars.isFindPostByContentAI'
    ),
    'vars.contentAI',
    'vars.postContentAI'
  ),
  updated_at = now()
WHERE block.name IN (
  'fb_extract_data_from_group_posts',
  'fb_extract_data_from_search_posts'
);

UPDATE public.auto_blocks AS block
SET
  code = replace(
    replace(
      replace(
        replace(
          block.code,
          'vars.isFindByKeywords',
          'vars.isFindCommentByKeywords'
        ),
        'vars.keywords',
        'vars.commentKeywords'
      ),
      'vars.isFindByContentAI',
      'vars.isFindCommentByContentAI'
    ),
    'vars.contentAI',
    'vars.commentContentAI'
  ),
  updated_at = now()
WHERE block.name IN (
  'fb_collect_group_comments',
  'fb_collect_search_post_comments'
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
  legacy_block_count integer;
BEGIN
  SELECT count(*)
  INTO legacy_block_count
  FROM public.auto_blocks
  WHERE name IN (
    'fb_extract_data_from_group_posts',
    'fb_collect_group_comments',
    'fb_extract_data_from_search_posts',
    'fb_collect_search_post_comments'
  )
    AND code ~ 'vars\.(isFindByKeywords|keywords|isFindByContentAI|contentAI)';

  IF legacy_block_count <> 0 THEN
    RAISE EXCEPTION 'Expected split find-data content filters in all promoted blocks, found % legacy block(s).', legacy_block_count;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;
