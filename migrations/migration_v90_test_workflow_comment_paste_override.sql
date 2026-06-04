-- ============================================================
-- Migration v90: Test workflow comment paste override
-- - Trial Facebook multiline comment fix in test workflows only.
-- - Does not update auto_blocks or production workflow_id workflows.
-- - Sets node.codeOverride for test workflow nodes so comment text is
--   pasted via page.fill(), matching akaBizAuto DispatchPaste behavior.
-- ============================================================

BEGIN;

WITH target_blocks AS (
  SELECT
    b.name,
    replace(
      replace(
        replace(
          CASE
            WHEN b.name IN ('fb_comment_at_position', 'fb_comment_current_post') THEN
              replace(
                b.code,
                $old$text = await rewriteCommentForRun(text)$old$,
                $new$text = await rewriteCommentForRun(text)
text = text.replace(/\t/g, '      ')$new$
              )
            ELSE b.code
          END,
          $old$await page.type(inputXpath, text, { clearFirst: true })$old$,
          $new$await page.fill(inputXpath, text)$new$
        ),
        $old$await page.type(boxXpath, text, { clearFirst: true })$old$,
        $new$await page.fill(boxXpath, text)$new$
      ),
      $old$await page.type(inputSelector, text, { clearFirst: true })$old$,
      $new$await page.fill(inputSelector, text)$new$
    ) AS override_code
  FROM public.auto_blocks b
  WHERE b.name IN (
    'fb_comment_at_position',
    'fb_comment_current_post',
    'fb_newsfeed_comment_paste'
  )
),
test_workflows AS (
  SELECT DISTINCT ca.test_workflow_id AS workflow_id
  FROM public.auto_campaign_actions ca
  WHERE ca.test_workflow_id IS NOT NULL
    AND ca.is_delete = false
    AND NOT EXISTS (
      SELECT 1
      FROM public.auto_campaign_actions prod
      WHERE prod.workflow_id = ca.test_workflow_id
        AND prod.is_delete = false
    )
),
rebuilt AS (
  SELECT
    wf.id,
    jsonb_agg(
      CASE
        WHEN tb.override_code IS NULL THEN node.value
        ELSE jsonb_set(node.value, '{codeOverride}', to_jsonb(tb.override_code), true)
      END
      ORDER BY node.ordinality
    ) AS nodes
  FROM public.auto_workflows wf
  JOIN test_workflows tw ON tw.workflow_id = wf.id
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(wf.nodes, '[]'::jsonb)) WITH ORDINALITY AS node(value, ordinality)
  LEFT JOIN target_blocks tb ON tb.name = node.value->>'blockName'
  GROUP BY wf.id
)
UPDATE public.auto_workflows wf
SET
  nodes = rebuilt.nodes,
  updated_at = now()
FROM rebuilt
WHERE wf.id = rebuilt.id
  AND wf.nodes IS DISTINCT FROM rebuilt.nodes;

COMMIT;
