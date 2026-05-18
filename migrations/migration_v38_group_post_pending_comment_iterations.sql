-- Adjust group-post comment targets after pending state is known.
-- Pending own-post comment is skipped; pending other-post comments start from the first visible post.

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
  'fb_adjust_group_post_comments_after_pending',
  'Điều chỉnh danh sách comment group post sau khi biết bài có pending không',
  'ListFilter',
  'facebook',
  'js',
  $block$
const originalIterations = Array.isArray(vars.commentIterations) ? vars.commentIterations : [];
const enableComment = vars.enableComment === true;
const isPending = vars.groupPostIsPending === true;
const commentType = String(vars.commentType || 'own');

let commentIterations = originalIterations;
let adjusted = false;
let skippedOwnPending = false;

if (enableComment && isPending && commentType === 'own') {
  commentIterations = [];
  adjusted = true;
  skippedOwnPending = true;
  helpers.log('Bài đang chờ duyệt nên bỏ qua comment vào bài của mình');
} else if (enableComment && isPending && commentType === 'others') {
  commentIterations = originalIterations.map((item, index) => {
    const row = item && typeof item === 'object' ? item : {};
    const currentPosition = Number(row.position || index + 2);
    return {
      ...row,
      position: Math.max(1, currentPosition - 1)
    };
  });
  adjusted = true;
  helpers.log('Bài đang chờ duyệt nên comment bài khác bắt đầu từ bài đầu tiên');
}

vars.commentIterations = commentIterations;

return {
  adjusted,
  skippedOwnPending,
  commentType,
  isPending,
  commentIterations
};
$block$,
  '[]'::jsonb,
  '[
    {"name":"adjusted","type":"boolean","label":"Đã điều chỉnh"},
    {"name":"skippedOwnPending","type":"boolean","label":"Bỏ qua comment bài mình"},
    {"name":"commentType","type":"string","label":"Kiểu comment"},
    {"name":"isPending","type":"boolean","label":"Bài pending"},
    {"name":"commentIterations","type":"json","label":"Danh sách comment"}
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

WITH ids AS (
  SELECT (SELECT id FROM public.auto_blocks WHERE name = 'fb_adjust_group_post_comments_after_pending') AS adjust_block_id
)
UPDATE public.auto_workflows AS wf
SET
  nodes = (
    SELECT COALESCE(jsonb_agg(node ORDER BY ord), '[]'::jsonb)
    FROM jsonb_array_elements(wf.nodes) WITH ORDINALITY AS t(node, ord)
    WHERE node->>'id' <> 'adjust_comments_after_pending'
  ) || jsonb_build_array(
    jsonb_build_object(
      'id', 'adjust_comments_after_pending',
      'label', 'Điều chỉnh comment khi pending',
      'config', '{}'::jsonb,
      'blockId', ids.adjust_block_id,
      'position', jsonb_build_object('x', 100, 'y', 960),
      'blockName', 'fb_adjust_group_post_comments_after_pending'
    )
  ),
  edges = (
    SELECT COALESCE(jsonb_agg(edge ORDER BY ord), '[]'::jsonb)
    FROM jsonb_array_elements(wf.edges) WITH ORDINALITY AS t(edge, ord)
    WHERE edge->>'id' NOT IN (
      'e-detect_pending-adjust_comments_after_pending',
      'e-adjust_comments_after_pending-if_comment'
    )
      AND NOT (edge->>'source' = 'detect_pending' AND edge->>'target' = 'if_comment')
  ) || jsonb_build_array(
    jsonb_build_object('id', 'e-detect_pending-adjust_comments_after_pending', 'source', 'detect_pending', 'target', 'adjust_comments_after_pending'),
    jsonb_build_object('id', 'e-adjust_comments_after_pending-if_comment', 'source', 'adjust_comments_after_pending', 'target', 'if_comment')
  ),
  updated_at = now()
FROM ids
WHERE wf.name = 'facebook_group_post';

COMMIT;
