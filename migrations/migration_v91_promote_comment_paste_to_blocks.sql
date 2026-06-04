-- ============================================================
-- Migration v91: Promote Facebook comment paste fix to blocks
-- - Updates real auto_blocks to paste comment content with page.fill().
-- - Removes the v90 test workflow codeOverride trial for these blocks.
-- ============================================================

BEGIN;

WITH normalized_blocks AS (
  SELECT
    b.name,
    CASE
      WHEN b.name IN ('fb_comment_at_position', 'fb_comment_current_post') THEN
        replace(
          replace(
            b.code,
            $old$
text = text.replace(/\t/g, '      ')$old$,
            ''
          ),
          $old$text = await rewriteCommentForRun(text)$old$,
          $new$text = await rewriteCommentForRun(text)
text = text.replace(/\t/g, '      ')$new$
        )
      ELSE b.code
    END AS code
  FROM public.auto_blocks b
  WHERE b.name IN (
    'fb_comment_at_position',
    'fb_comment_current_post',
    'fb_newsfeed_comment_paste'
  )
),
target_blocks AS (
  SELECT
    name,
    replace(
      replace(
        replace(
          replace(
            code,
            $old$// FB comment box dùng Lexical -> page.type (insertText) hoạt động, page.fill (paste) thì không.
// Pattern giống block "Comment vào bài viết" cũ: click -> sleep 2s -> type/drop -> Enter.$old$,
            $new$// FB comment box dùng Lexical -> page.fill dispatch paste như akaBizAuto DispatchPaste.
// Pattern: click -> sleep 2s -> paste/drop -> Enter.$new$
          ),
          $old$await page.type(inputXpath, text, { clearFirst: true })$old$,
          $new$await page.fill(inputXpath, text)$new$
        ),
        $old$await page.type(boxXpath, text, { clearFirst: true })$old$,
        $new$await page.fill(boxXpath, text)$new$
      ),
      $old$await page.type(inputSelector, text, { clearFirst: true })$old$,
      $new$await page.fill(inputSelector, text)$new$
    ) AS new_code
  FROM normalized_blocks
)
UPDATE public.auto_blocks b
SET
  code = tb.new_code,
  updated_at = now()
FROM target_blocks tb
WHERE b.name = tb.name
  AND b.code IS DISTINCT FROM tb.new_code;

WITH test_workflows AS (
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
        WHEN node.value->>'blockName' IN (
          'fb_comment_at_position',
          'fb_comment_current_post',
          'fb_newsfeed_comment_paste'
        ) THEN node.value - 'codeOverride'
        ELSE node.value
      END
      ORDER BY node.ordinality
    ) AS nodes
  FROM public.auto_workflows wf
  JOIN test_workflows tw ON tw.workflow_id = wf.id
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(wf.nodes, '[]'::jsonb)) WITH ORDINALITY AS node(value, ordinality)
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
