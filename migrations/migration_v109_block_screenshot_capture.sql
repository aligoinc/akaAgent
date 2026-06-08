-- Enable browser screenshot capture for the group-post submit verification node.
-- Metadata is stored in auto_campaign_run_events by runtime code; no schema change needed.

BEGIN;

WITH target_workflows AS (
  SELECT workflow_id AS id
  FROM public.auto_campaign_actions
  WHERE id = 'facebook_group_post'
    AND workflow_id IS NOT NULL

  UNION

  SELECT test_workflow_id AS id
  FROM public.auto_campaign_actions
  WHERE id = 'facebook_group_post'
    AND test_workflow_id IS NOT NULL
)
UPDATE public.auto_workflows AS wf
SET
  nodes = (
    SELECT COALESCE(jsonb_agg(
      CASE
        WHEN node->>'id' = 'verify_submit' THEN
          jsonb_set(
            jsonb_set(
              jsonb_set(node, '{config}', COALESCE(node->'config', '{}'::jsonb), true),
              '{config,screenshotCaptureTiming}',
              to_jsonb('after'::text),
              true
            ),
            '{config,screenshotCaptureOn}',
            to_jsonb('failure'::text),
            true
          )
        ELSE node
      END
      ORDER BY ord
    ), '[]'::jsonb)
    FROM jsonb_array_elements(wf.nodes) WITH ORDINALITY AS t(node, ord)
  ),
  updated_at = now()
WHERE wf.id IN (SELECT id FROM target_workflows)
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(wf.nodes) AS node
    WHERE node->>'id' = 'verify_submit'
      AND node->>'blockName' = 'fb_verify_group_post_form_closed'
  );

COMMIT;
