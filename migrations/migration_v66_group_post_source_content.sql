-- Migration v66: Let group post campaigns copy/edit source content before posting.

BEGIN;

DO $$
DECLARE
  missing_blocks text;
BEGIN
  SELECT string_agg(required.name, ', ')
  INTO missing_blocks
  FROM unnest(ARRAY['if_else', 'merge', 'fb_scrape_post', 'fb_rewrite_source_content_ai']) AS required(name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.auto_blocks b
    WHERE b.name = required.name
  );

  IF missing_blocks IS NOT NULL THEN
    RAISE EXCEPTION 'Missing required block(s): %. Apply earlier workflow migrations first.', missing_blocks;
  END IF;
END $$;

INSERT INTO public.auto_blocks (
  name, description, icon, category, kind, system_type, code,
  config_schema, output_schema, default_config, is_builtin, staff_id, organization_id, updated_at
)
VALUES (
  'fb_navigate_to_target_url',
  'Quay lại link mục tiêu sau khi copy nội dung nguồn.',
  'Navigation',
  'facebook',
  'js',
  NULL,
$block$
const rawTargetUrl = String(input.targetUrl || vars.targetUrl || vars.inputDataUid || '').trim()
const targetUrl = helpers.normalizeFbUrl(rawTargetUrl)
if (!targetUrl) throw new Error('Thiếu link group để quay lại sau khi copy nguồn')

helpers.log('Quay lại group để đăng bài')
await page.navigate(targetUrl)
await helpers.sleep(2500, signal)
return { targetUrl }
$block$,
  '[
    {"name":"targetUrl","type":"string","label":"Link mục tiêu"}
  ]'::jsonb,
  '[
    {"name":"targetUrl","type":"string","label":"Link mục tiêu đã mở"}
  ]'::jsonb,
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
    'if_else',
    'merge',
    'fb_scrape_post',
    'fb_rewrite_source_content_ai',
    'fb_navigate_to_target_url'
  )
)
UPDATE public.auto_workflows AS wf
SET
  nodes = (
    SELECT COALESCE(jsonb_agg(node ORDER BY ord), '[]'::jsonb)
    FROM jsonb_array_elements(COALESCE(wf.nodes, '[]'::jsonb)) WITH ORDINALITY AS t(node, ord)
    WHERE node->>'id' NOT IN (
      'if_copy_source',
      'scrape_source',
      'source_ai_prompt',
      'nav_group_after_source',
      'merge_source_ready'
    )
  ) || jsonb_build_array(
    jsonb_build_object(
      'id', 'if_copy_source',
      'label', 'Có copy nguồn?',
      'config', jsonb_build_object('condition', 'vars.copyContentFromSource === true && !!vars.sourceLink'),
      'blockId', (SELECT id FROM block_ids WHERE name = 'if_else'),
      'position', jsonb_build_object('x', -260, 'y', -220),
      'blockName', 'if_else',
      'systemType', 'ifElse'
    ),
    jsonb_build_object(
      'id', 'scrape_source',
      'label', 'Copy nội dung nguồn',
      'config', '{}'::jsonb,
      'blockId', (SELECT id FROM block_ids WHERE name = 'fb_scrape_post'),
      'position', jsonb_build_object('x', -500, 'y', -80),
      'blockName', 'fb_scrape_post'
    ),
    jsonb_build_object(
      'id', 'source_ai_prompt',
      'label', 'AI edit nội dung nguồn',
      'config', '{}'::jsonb,
      'blockId', (SELECT id FROM block_ids WHERE name = 'fb_rewrite_source_content_ai'),
      'position', jsonb_build_object('x', -500, 'y', 60),
      'blockName', 'fb_rewrite_source_content_ai'
    ),
    jsonb_build_object(
      'id', 'nav_group_after_source',
      'label', 'Quay lại group',
      'config', '{}'::jsonb,
      'blockId', (SELECT id FROM block_ids WHERE name = 'fb_navigate_to_target_url'),
      'position', jsonb_build_object('x', -500, 'y', 200),
      'blockName', 'fb_navigate_to_target_url'
    ),
    jsonb_build_object(
      'id', 'merge_source_ready',
      'label', 'Gộp nguồn trước khi đăng group',
      'config', jsonb_build_object('mode', 'any'),
      'blockId', (SELECT id FROM block_ids WHERE name = 'merge'),
      'position', jsonb_build_object('x', -260, 'y', 340),
      'blockName', 'merge',
      'systemType', 'merge'
    )
  ),
  edges = (
    SELECT COALESCE(jsonb_agg(edge ORDER BY ord), '[]'::jsonb)
    FROM jsonb_array_elements(COALESCE(wf.edges, '[]'::jsonb)) WITH ORDINALITY AS t(edge, ord)
    WHERE edge->>'id' NOT IN (
      'e-if-copy-source-true',
      'e-if-copy-source-false',
      'e-source-scrape-ai',
      'e-source-ai-nav-group',
      'e-nav-after-source-merge',
      'e-nav-merge-source-ready',
      'e-merge-source-ready-next'
    )
      AND NOT (edge->>'source' = 'nav' AND edge->>'target' = 'dismiss_after_nav')
      AND NOT (edge->>'source' = 'nav' AND edge->>'target' = 'wait_main')
  ) || jsonb_build_array(
    jsonb_build_object('id', 'e-if-copy-source-true', 'source', 'if_copy_source', 'target', 'scrape_source', 'sourceHandle', 'true'),
    jsonb_build_object('id', 'e-if-copy-source-false', 'source', 'if_copy_source', 'target', 'resolve_url', 'sourceHandle', 'false'),
    jsonb_build_object('id', 'e-source-scrape-ai', 'source', 'scrape_source', 'target', 'source_ai_prompt'),
    jsonb_build_object('id', 'e-source-ai-nav-group', 'source', 'source_ai_prompt', 'target', 'nav_group_after_source'),
    jsonb_build_object('id', 'e-nav-after-source-merge', 'source', 'nav_group_after_source', 'target', 'merge_source_ready'),
    jsonb_build_object('id', 'e-nav-merge-source-ready', 'source', 'nav', 'target', 'merge_source_ready'),
    CASE
      WHEN EXISTS (
        SELECT 1
        FROM jsonb_array_elements(COALESCE(wf.nodes, '[]'::jsonb)) AS node_item(value)
        WHERE node_item.value->>'id' = 'dismiss_after_nav'
      )
      THEN jsonb_build_object('id', 'e-merge-source-ready-next', 'source', 'merge_source_ready', 'target', 'dismiss_after_nav')
      ELSE jsonb_build_object('id', 'e-merge-source-ready-next', 'source', 'merge_source_ready', 'target', 'wait_main')
    END
  ),
  variables_schema = COALESCE(wf.variables_schema, '[]'::jsonb)
    || CASE
      WHEN NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(COALESCE(wf.variables_schema, '[]'::jsonb)) AS schema_item(value)
        WHERE schema_item.value->>'name' = 'copyContentFromSource'
      )
      THEN jsonb_build_array(jsonb_build_object(
        'name', 'copyContentFromSource',
        'type', 'boolean',
        'label', 'Copy nội dung từ nguồn'
      ))
      ELSE '[]'::jsonb
    END
    || CASE
      WHEN NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(COALESCE(wf.variables_schema, '[]'::jsonb)) AS schema_item(value)
        WHERE schema_item.value->>'name' = 'includeSourceImages'
      )
      THEN jsonb_build_array(jsonb_build_object(
        'name', 'includeSourceImages',
        'type', 'boolean',
        'label', 'Lấy kèm hình ảnh'
      ))
      ELSE '[]'::jsonb
    END
    || CASE
      WHEN NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(COALESCE(wf.variables_schema, '[]'::jsonb)) AS schema_item(value)
        WHERE schema_item.value->>'name' = 'sourceLink'
      )
      THEN jsonb_build_array(jsonb_build_object(
        'name', 'sourceLink',
        'type', 'string',
        'label', 'Link nguồn'
      ))
      ELSE '[]'::jsonb
    END
    || CASE
      WHEN NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(COALESCE(wf.variables_schema, '[]'::jsonb)) AS schema_item(value)
        WHERE schema_item.value->>'name' = 'rewriteSourceContentWithAI'
      )
      THEN jsonb_build_array(jsonb_build_object(
        'name', 'rewriteSourceContentWithAI',
        'type', 'boolean',
        'label', 'Lời nhắc AI - Edit lại nội dung'
      ))
      ELSE '[]'::jsonb
    END
    || CASE
      WHEN NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(COALESCE(wf.variables_schema, '[]'::jsonb)) AS schema_item(value)
        WHERE schema_item.value->>'name' = 'sourceContentAiPrompt'
      )
      THEN jsonb_build_array(jsonb_build_object(
        'name', 'sourceContentAiPrompt',
        'type', 'textarea',
        'label', 'Lời nhắc AI',
        'placeholder', 'Viết lại nội dung sau: [content]'
      ))
      ELSE '[]'::jsonb
    END,
  default_variables = COALESCE(wf.default_variables, '{}'::jsonb)
    || '{"copyContentFromSource":false,"includeSourceImages":false,"sourceLink":"","rewriteSourceContentWithAI":false,"sourceContentAiPrompt":""}'::jsonb,
  updated_at = now()
WHERE wf.name = 'facebook_group_post';

COMMIT;
