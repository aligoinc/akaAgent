-- Keep the Campaign Data table in the same oldest-first order used by the
-- campaign scheduler. The authenticated overload delegates to this internal
-- RPC, so patching the internal function updates both desktop and web callers.

BEGIN;

DO $patch_campaign_input_page_order$
DECLARE
  v_signature regprocedure := pg_catalog.to_regprocedure(
    'public.aka_agent_list_campaign_input_data_page(bigint,bigint,bigint,text,text,timestamptz,timestamptz,text,integer,integer)'
  );
  v_definition text;
  v_page_order_old text :=
    'ORDER BY filtered.created_at DESC, filtered.id DESC';
  v_page_order_new text :=
    'ORDER BY filtered.created_at ASC, filtered.id ASC';
  v_result_order_old text :=
    'ORDER BY paged.created_at DESC, paged.id DESC';
  v_result_order_new text :=
    'ORDER BY paged.created_at ASC, paged.id ASC';
BEGIN
  IF v_signature IS NULL THEN
    RAISE EXCEPTION 'missing_campaign_input_data_page_rpc';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(v_signature)
  INTO v_definition;

  IF (
    pg_catalog.length(v_definition)
    - pg_catalog.length(pg_catalog.replace(v_definition, v_page_order_old, ''))
  ) <> pg_catalog.length(v_page_order_old) THEN
    RAISE EXCEPTION 'unexpected_campaign_input_data_page_paging_order';
  END IF;

  IF (
    pg_catalog.length(v_definition)
    - pg_catalog.length(pg_catalog.replace(v_definition, v_result_order_old, ''))
  ) <> pg_catalog.length(v_result_order_old) THEN
    RAISE EXCEPTION 'unexpected_campaign_input_data_page_result_order';
  END IF;

  v_definition := pg_catalog.replace(
    v_definition,
    v_page_order_old,
    v_page_order_new
  );
  v_definition := pg_catalog.replace(
    v_definition,
    v_result_order_old,
    v_result_order_new
  );

  EXECUTE v_definition;
END;
$patch_campaign_input_page_order$;

NOTIFY pgrst, 'reload schema';

COMMIT;
