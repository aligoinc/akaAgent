-- Persist a browser screenshot when the actual Facebook message-send node
-- fails. Page Inbox targets that are absent or resolve to another conversation
-- remain `không tồn tại`, not failures. Keep navigation, Page Inbox opening and
-- add-friend nodes unchanged.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- Live source captured from linked project cgjbsmqtfhqvttudyjzq on 2026-08-28:
--   fb_send_page_inbox_message md5(code) = 0a99b6d239b85182ef0a16d75954adb3
-- Target checksum after removing only the two non-failure `ok:false` flags:
--   fb_send_page_inbox_message md5(code) = f4250a395c0d040163d7a37fe7528111
DO $patch_page_inbox_block$
DECLARE
  v_block_count integer;
  v_code text;
  v_code_md5 text;
  v_source_md5 constant text := '0a99b6d239b85182ef0a16d75954adb3';
  v_target_md5 constant text := 'f4250a395c0d040163d7a37fe7528111';
  v_not_found_old constant text :=
    'return { ok: false, error: ''Không tìm thấy khách hàng trong inbox page'', reason: ''not_found'', customerName, customerPsid }';
  v_not_found_new constant text :=
    'return { error: ''Không tìm thấy khách hàng trong inbox page'', reason: ''not_found'', customerName, customerPsid }';
  v_wrong_conversation_old constant text :=
    E'return {\n      ok: false,\n      error: ''Không tìm thấy đúng khách hàng trong inbox page'',';
  v_wrong_conversation_new constant text :=
    E'return {\n      error: ''Không tìm thấy đúng khách hàng trong inbox page'',';
BEGIN
  SELECT count(*)::integer
  INTO v_block_count
  FROM public.auto_blocks
  WHERE name = 'fb_send_page_inbox_message';

  IF v_block_count <> 1 THEN
    RAISE EXCEPTION
      'v257 expected exactly one fb_send_page_inbox_message block, found %',
      v_block_count;
  END IF;

  SELECT code
  INTO v_code
  FROM public.auto_blocks
  WHERE name = 'fb_send_page_inbox_message'
  FOR UPDATE;

  v_code_md5 := md5(v_code);
  IF v_code_md5 = v_target_md5 THEN
    RETURN;
  END IF;

  IF v_code_md5 <> v_source_md5 THEN
    RAISE EXCEPTION
      'v257 fb_send_page_inbox_message changed unexpectedly (expected source md5 % or target md5 %, got %)',
      v_source_md5,
      v_target_md5,
      v_code_md5;
  END IF;

  IF strpos(v_code, v_not_found_old) = 0
    OR strpos(v_code, v_wrong_conversation_old) = 0
    OR strpos(v_code, v_not_found_new) > 0
    OR strpos(v_code, v_wrong_conversation_new) > 0
  THEN
    RAISE EXCEPTION 'v257 Page Inbox non-failure return fragments changed unexpectedly';
  END IF;

  v_code := replace(v_code, v_not_found_old, v_not_found_new);
  v_code := replace(v_code, v_wrong_conversation_old, v_wrong_conversation_new);

  IF md5(v_code) <> v_target_md5 THEN
    RAISE EXCEPTION
      'v257 patched fb_send_page_inbox_message checksum mismatch (expected %, got %)',
      v_target_md5,
      md5(v_code);
  END IF;

  UPDATE public.auto_blocks
  SET code = v_code,
      updated_at = now()
  WHERE name = 'fb_send_page_inbox_message';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'v257 failed to update fb_send_page_inbox_message';
  END IF;
END;
$patch_page_inbox_block$;

DO $preflight$
DECLARE
  v_action_count integer;
  v_runtime_ref_count integer;
  v_test_ref_count integer;
  v_invalid_refs text;
BEGIN
  SELECT
    count(*)::integer,
    count(workflow_id)::integer,
    count(test_workflow_id)::integer
  INTO v_action_count, v_runtime_ref_count, v_test_ref_count
  FROM public.auto_campaign_actions
  WHERE id IN (
    'facebook_message_friend',
    'facebook_message_uid',
    'facebook_page_to_message'
  );

  IF v_action_count <> 3
    OR v_runtime_ref_count <> 3
    OR v_test_ref_count <> 3
  THEN
    RAISE EXCEPTION
      'v257 expected 3 Facebook message actions with runtime/test workflows; found actions=%, runtime refs=%, test refs=%',
      v_action_count,
      v_runtime_ref_count,
      v_test_ref_count;
  END IF;

  WITH target_refs AS (
    SELECT id AS action_id, 'runtime'::text AS ref_kind, workflow_id
    FROM public.auto_campaign_actions
    WHERE id IN (
      'facebook_message_friend',
      'facebook_message_uid',
      'facebook_page_to_message'
    )

    UNION ALL

    SELECT id AS action_id, 'test'::text AS ref_kind, test_workflow_id
    FROM public.auto_campaign_actions
    WHERE id IN (
      'facebook_message_friend',
      'facebook_message_uid',
      'facebook_page_to_message'
    )
  ), checked_refs AS (
    SELECT
      target.action_id,
      target.ref_kind,
      target.workflow_id,
      workflow.id IS NOT NULL AS workflow_exists,
      CASE
        WHEN workflow.id IS NULL THEN 0
        ELSE (
          SELECT count(*)
          FROM jsonb_array_elements(workflow.nodes) AS node
          WHERE node->>'blockName' = CASE
            WHEN target.action_id = 'facebook_page_to_message'
              THEN 'fb_send_page_inbox_message'
            ELSE 'fb_send_message'
          END
        )
      END AS matching_node_count
    FROM target_refs AS target
    LEFT JOIN public.auto_workflows AS workflow
      ON workflow.id = target.workflow_id
  )
  SELECT string_agg(
    format(
      '%s/%s workflow=%s exists=%s matching_send_nodes=%s',
      action_id,
      ref_kind,
      workflow_id,
      workflow_exists,
      matching_node_count
    ),
    '; '
    ORDER BY action_id, ref_kind
  )
  INTO v_invalid_refs
  FROM checked_refs
  WHERE NOT workflow_exists OR matching_node_count <> 1;

  IF v_invalid_refs IS NOT NULL THEN
    RAISE EXCEPTION 'v257 Facebook message workflow preflight failed: %', v_invalid_refs;
  END IF;
END;
$preflight$;

WITH target_refs AS (
  SELECT id AS action_id, workflow_id
  FROM public.auto_campaign_actions
  WHERE id IN (
    'facebook_message_friend',
    'facebook_message_uid',
    'facebook_page_to_message'
  )

  UNION ALL

  SELECT id AS action_id, test_workflow_id AS workflow_id
  FROM public.auto_campaign_actions
  WHERE id IN (
    'facebook_message_friend',
    'facebook_message_uid',
    'facebook_page_to_message'
  )
)
UPDATE public.auto_workflows AS workflow
SET
  nodes = (
    SELECT jsonb_agg(
      CASE
        WHEN EXISTS (
          SELECT 1
          FROM target_refs AS target
          WHERE target.workflow_id = workflow.id
            AND node->>'blockName' = CASE
              WHEN target.action_id = 'facebook_page_to_message'
                THEN 'fb_send_page_inbox_message'
              ELSE 'fb_send_message'
            END
        ) THEN
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
    )
    FROM jsonb_array_elements(workflow.nodes) WITH ORDINALITY AS item(node, ord)
  ),
  updated_at = now()
WHERE workflow.id IN (SELECT workflow_id FROM target_refs)
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(workflow.nodes) AS node
    JOIN target_refs AS target
      ON target.workflow_id = workflow.id
     AND node->>'blockName' = CASE
       WHEN target.action_id = 'facebook_page_to_message'
         THEN 'fb_send_page_inbox_message'
       ELSE 'fb_send_message'
     END
    WHERE node->'config'->>'screenshotCaptureTiming' IS DISTINCT FROM 'after'
       OR node->'config'->>'screenshotCaptureOn' IS DISTINCT FROM 'failure'
  );

DO $postflight$
DECLARE
  v_invalid_refs text;
BEGIN
  WITH target_refs AS (
    SELECT id AS action_id, 'runtime'::text AS ref_kind, workflow_id
    FROM public.auto_campaign_actions
    WHERE id IN (
      'facebook_message_friend',
      'facebook_message_uid',
      'facebook_page_to_message'
    )

    UNION ALL

    SELECT id AS action_id, 'test'::text AS ref_kind, test_workflow_id
    FROM public.auto_campaign_actions
    WHERE id IN (
      'facebook_message_friend',
      'facebook_message_uid',
      'facebook_page_to_message'
    )
  ), checked_nodes AS (
    SELECT
      target.action_id,
      target.ref_kind,
      target.workflow_id,
      node->>'id' AS node_id,
      node->'config'->>'screenshotCaptureTiming' AS capture_timing,
      node->'config'->>'screenshotCaptureOn' AS capture_on
    FROM target_refs AS target
    JOIN public.auto_workflows AS workflow
      ON workflow.id = target.workflow_id
    CROSS JOIN LATERAL jsonb_array_elements(workflow.nodes) AS node
    WHERE node->>'blockName' = CASE
      WHEN target.action_id = 'facebook_page_to_message'
        THEN 'fb_send_page_inbox_message'
      ELSE 'fb_send_message'
    END
  )
  SELECT string_agg(
    format(
      '%s/%s workflow=%s node=%s timing=%s on=%s',
      action_id,
      ref_kind,
      workflow_id,
      node_id,
      capture_timing,
      capture_on
    ),
    '; '
    ORDER BY action_id, ref_kind
  )
  INTO v_invalid_refs
  FROM checked_nodes
  WHERE capture_timing IS DISTINCT FROM 'after'
     OR capture_on IS DISTINCT FROM 'failure';

  IF v_invalid_refs IS NOT NULL THEN
    RAISE EXCEPTION 'v257 Facebook message screenshot postflight failed: %', v_invalid_refs;
  END IF;
END;
$postflight$;

COMMIT;
