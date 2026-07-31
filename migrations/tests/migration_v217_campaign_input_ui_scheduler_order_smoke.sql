-- Rollback smoke test for
-- migration_v217_campaign_input_ui_scheduler_order.sql.

BEGIN;

DO $v217_campaign_input_ui_scheduler_order$
DECLARE
  v_signature regprocedure := pg_catalog.to_regprocedure(
    'public.aka_agent_list_campaign_input_data_page(bigint,bigint,bigint,text,text,timestamptz,timestamptz,text,integer,integer)'
  );
  v_definition text;
BEGIN
  IF v_signature IS NULL THEN
    RAISE EXCEPTION 'v217_smoke: campaign input data page RPC is missing';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(v_signature)
  INTO v_definition;

  IF pg_catalog.strpos(
    v_definition,
    'ORDER BY filtered.created_at ASC, filtered.id ASC'
  ) = 0 THEN
    RAISE EXCEPTION 'v217_smoke: campaign input page is not oldest-first';
  END IF;

  IF pg_catalog.strpos(
    v_definition,
    'ORDER BY paged.created_at ASC, paged.id ASC'
  ) = 0 THEN
    RAISE EXCEPTION 'v217_smoke: campaign input result is not oldest-first';
  END IF;

  IF pg_catalog.strpos(
    v_definition,
    'ORDER BY filtered.created_at DESC, filtered.id DESC'
  ) > 0 OR pg_catalog.strpos(
    v_definition,
    'ORDER BY paged.created_at DESC, paged.id DESC'
  ) > 0 THEN
    RAISE EXCEPTION 'v217_smoke: descending campaign input order remains';
  END IF;
END;
$v217_campaign_input_ui_scheduler_order$;

ROLLBACK;
