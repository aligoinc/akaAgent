-- Skip publishing to groups that are already known to require post approval.
-- The workflow still continues to the comment branch when enableComment=true.

BEGIN;

INSERT INTO public.auto_blocks (
  name,
  description,
  icon,
  category,
  kind,
  code,
  config_schema,
  output_schema,
  default_config,
  is_builtin,
  staff_id,
  organization_id,
  updated_at
)
VALUES (
  'fb_skip_group_post_for_known_approval',
  'Bỏ qua đăng bài group khi account contact đã biết group cần duyệt bài',
  'Ban',
  'facebook',
  'js',
  $block$
const shouldSkip = vars.skipGroupPostByKnownApproval === true;

if (!shouldSkip) {
  return { skipped: false, isPending: false };
}

const isPending = vars.groupPostRequiresPostApproval === true;
vars.groupPostSkippedByKnownApproval = true;
vars.groupPostSubmitted = false;
vars.groupPostIsPending = isPending;

const message = 'Bỏ qua đăng bài vì group đã biết cần duyệt bài';
helpers.log(message);

return {
  skipped: true,
  isPending,
  source: vars.groupPostApprovalSource || 'account_contact',
  message
};
$block$,
  '[]'::jsonb,
  '[
    {"name":"skipped","type":"boolean","label":"Đã bỏ qua đăng bài"},
    {"name":"isPending","type":"boolean","label":"Group cần duyệt bài"},
    {"name":"source","type":"string","label":"Nguồn trạng thái"},
    {"name":"message","type":"string","label":"Thông báo"}
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
  code = EXCLUDED.code,
  config_schema = EXCLUDED.config_schema,
  output_schema = EXCLUDED.output_schema,
  default_config = EXCLUDED.default_config,
  is_builtin = true,
  updated_at = now();

UPDATE public.auto_blocks
SET
  code = $block$
if (vars.groupPostSkippedByKnownApproval === true || vars.skipGroupPostByKnownApproval === true) {
  const isPending = vars.groupPostRequiresPostApproval === true;
  vars.groupPostIsPending = isPending;
  return {
    isPending,
    postUrl: '',
    skippedPost: true,
    source: vars.groupPostApprovalSource || 'account_contact'
  };
}

const groupPostUrl = String(vars.groupPostPostUrl || input.postUrl || input.link || '').trim();
if ('groupPostSubmitted' in vars || groupPostUrl) {
  const isPending = groupPostUrl.includes('/pending_posts/');
  vars.groupPostIsPending = isPending;
  return { isPending, postUrl: groupPostUrl };
}

const banner = await helpers.element('fb_pending_banner');
try {
  const found = await page.waitForSelector(banner, { timeout: 3000 });
  return { isPending: !!found };
} catch {
  return { isPending: false };
}
$block$,
  output_schema = '[
    {"name":"isPending","type":"boolean","label":"Bài có đang chờ duyệt không"},
    {"name":"postUrl","type":"string","label":"Post URL"},
    {"name":"skippedPost","type":"boolean","label":"Đã bỏ qua đăng bài"},
    {"name":"source","type":"string","label":"Nguồn trạng thái"}
  ]'::jsonb,
  updated_at = now()
WHERE name = 'fb_detect_pending_post';

WITH ids AS (
  SELECT
    (SELECT id FROM public.auto_blocks WHERE name = 'fb_skip_group_post_for_known_approval') AS skip_block_id,
    (SELECT id FROM public.auto_blocks WHERE name = 'if_else') AS if_block_id,
    (SELECT id FROM public.auto_blocks WHERE name = 'merge') AS merge_block_id
)
UPDATE public.auto_workflows AS wf
SET
  nodes = (
    SELECT COALESCE(jsonb_agg(node ORDER BY ord), '[]'::jsonb)
    FROM jsonb_array_elements(wf.nodes) WITH ORDINALITY AS t(node, ord)
    WHERE node->>'id' NOT IN ('if_skip_known_approval', 'skip_known_approval', 'merge_known_approval')
  ) || jsonb_build_array(
    jsonb_build_object(
      'id', 'if_skip_known_approval',
      'label', 'Bỏ qua đăng bài nếu group đã biết cần duyệt?',
      'config', jsonb_build_object('condition', 'vars.skipGroupPostByKnownApproval === true'),
      'blockId', ids.if_block_id,
      'position', jsonb_build_object('x', 100, 'y', 160),
      'blockName', 'if_else',
      'systemType', 'ifElse'
    ),
    jsonb_build_object(
      'id', 'skip_known_approval',
      'label', 'Bỏ qua đăng bài group cần duyệt',
      'config', '{}'::jsonb,
      'blockId', ids.skip_block_id,
      'position', jsonb_build_object('x', 360, 'y', 260),
      'blockName', 'fb_skip_group_post_for_known_approval'
    ),
    jsonb_build_object(
      'id', 'merge_known_approval',
      'label', 'Gộp nhánh đăng bài/bỏ qua',
      'config', jsonb_build_object('mode', 'any'),
      'blockId', ids.merge_block_id,
      'position', jsonb_build_object('x', 100, 'y', 880),
      'blockName', 'merge',
      'systemType', 'merge'
    )
  ),
  edges = (
    SELECT COALESCE(jsonb_agg(edge ORDER BY ord), '[]'::jsonb)
    FROM jsonb_array_elements(wf.edges) WITH ORDINALITY AS t(edge, ord)
    WHERE edge->>'id' NOT IN (
      'e-wait_main-if_skip_known_approval',
      'e-if_skip_known_approval-skip_known_approval-true',
      'e-if_skip_known_approval-open_composer-false',
      'e-skip_known_approval-merge_known_approval',
      'e-get_post_link-merge_known_approval',
      'e-merge_known_approval-detect_pending'
    )
      AND NOT (edge->>'source' = 'wait_main' AND edge->>'target' = 'open_composer')
      AND NOT (edge->>'source' = 'get_post_link' AND edge->>'target' = 'detect_pending')
  ) || jsonb_build_array(
    jsonb_build_object('id', 'e-wait_main-if_skip_known_approval', 'source', 'wait_main', 'target', 'if_skip_known_approval'),
    jsonb_build_object('id', 'e-if_skip_known_approval-skip_known_approval-true', 'source', 'if_skip_known_approval', 'target', 'skip_known_approval', 'sourceHandle', 'true'),
    jsonb_build_object('id', 'e-if_skip_known_approval-open_composer-false', 'source', 'if_skip_known_approval', 'target', 'open_composer', 'sourceHandle', 'false'),
    jsonb_build_object('id', 'e-skip_known_approval-merge_known_approval', 'source', 'skip_known_approval', 'target', 'merge_known_approval'),
    jsonb_build_object('id', 'e-get_post_link-merge_known_approval', 'source', 'get_post_link', 'target', 'merge_known_approval'),
    jsonb_build_object('id', 'e-merge_known_approval-detect_pending', 'source', 'merge_known_approval', 'target', 'detect_pending')
  ),
  updated_at = now()
FROM ids
WHERE wf.name = 'facebook_group_post';

COMMIT;
