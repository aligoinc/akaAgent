-- Restore the Campaign Data UI contract that was added by v206/v217 and
-- accidentally overwritten when v219 recreated the per-account runtime RPC.
-- Patch the installed definition so every v219 Desktop/Server ownership guard
-- and the v221 authenticated wrappers remain unchanged.

BEGIN;

DO $restore_campaign_input_page_contract$
DECLARE
  v_signature regprocedure := pg_catalog.to_regprocedure(
    'public.aka_agent_list_campaign_input_data_page(bigint,bigint,bigint,text,text,timestamptz,timestamptz,text,integer,integer)'
  );
  v_definition text;
  v_next_definition text;
  v_raw_projection text :=
    'to_jsonb(paged) - ''page_total_count'' AS input_data';
  v_semantic_projection text :=
    'public.aka_agent_campaign_input_semantic_json(to_jsonb(paged) - ''page_total_count'') AS input_data';
  v_page_order_desc text :=
    'ORDER BY filtered.created_at DESC, filtered.id DESC';
  v_page_order_asc text :=
    'ORDER BY filtered.created_at ASC, filtered.id ASC';
  v_result_order_desc text :=
    'ORDER BY paged.created_at DESC, paged.id DESC';
  v_result_order_asc text :=
    'ORDER BY paged.created_at ASC, paged.id ASC';
BEGIN
  IF v_signature IS NULL THEN
    RAISE EXCEPTION 'missing_campaign_input_data_page_origin_core';
  END IF;
  IF pg_catalog.to_regprocedure(
    'public.aka_agent_campaign_input_semantic_json(jsonb)'
  ) IS NULL THEN
    RAISE EXCEPTION 'missing_campaign_input_semantic_projection_helper';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(v_signature)
  INTO v_definition;
  v_next_definition := v_definition;

  IF pg_catalog.strpos(v_next_definition, v_semantic_projection) = 0 THEN
    IF (
      pg_catalog.length(v_next_definition)
      - pg_catalog.length(pg_catalog.replace(
          v_next_definition, v_raw_projection, ''
        ))
    ) <> pg_catalog.length(v_raw_projection) THEN
      RAISE EXCEPTION 'unexpected_campaign_input_data_page_projection';
    END IF;
    v_next_definition := pg_catalog.replace(
      v_next_definition, v_raw_projection, v_semantic_projection
    );
  END IF;

  IF pg_catalog.strpos(v_next_definition, v_page_order_asc) = 0 THEN
    IF (
      pg_catalog.length(v_next_definition)
      - pg_catalog.length(pg_catalog.replace(
          v_next_definition, v_page_order_desc, ''
        ))
    ) <> pg_catalog.length(v_page_order_desc) THEN
      RAISE EXCEPTION 'unexpected_campaign_input_data_page_paging_order';
    END IF;
    v_next_definition := pg_catalog.replace(
      v_next_definition, v_page_order_desc, v_page_order_asc
    );
  END IF;

  IF pg_catalog.strpos(v_next_definition, v_result_order_asc) = 0 THEN
    IF (
      pg_catalog.length(v_next_definition)
      - pg_catalog.length(pg_catalog.replace(
          v_next_definition, v_result_order_desc, ''
        ))
    ) <> pg_catalog.length(v_result_order_desc) THEN
      RAISE EXCEPTION 'unexpected_campaign_input_data_page_result_order';
    END IF;
    v_next_definition := pg_catalog.replace(
      v_next_definition, v_result_order_desc, v_result_order_asc
    );
  END IF;

  IF v_next_definition IS DISTINCT FROM v_definition THEN
    EXECUTE v_next_definition;
  END IF;

  SELECT pg_catalog.pg_get_functiondef(v_signature)
  INTO v_definition;
  IF pg_catalog.strpos(v_definition, v_semantic_projection) = 0
    OR pg_catalog.strpos(v_definition, v_raw_projection) > 0
    OR pg_catalog.strpos(v_definition, v_page_order_asc) = 0
    OR pg_catalog.strpos(v_definition, v_page_order_desc) > 0
    OR pg_catalog.strpos(v_definition, v_result_order_asc) = 0
    OR pg_catalog.strpos(v_definition, v_result_order_desc) > 0
    OR pg_catalog.strpos(v_definition, 'aka_agent.zalo_runtime_target') = 0
  THEN
    RAISE EXCEPTION 'campaign_input_data_page_contract_restore_failed';
  END IF;
END;
$restore_campaign_input_page_contract$;

COMMENT ON FUNCTION public.aka_agent_list_campaign_input_data_page(
  bigint, bigint, bigint, text, text, timestamptz, timestamptz,
  text, integer, integer
) IS
  'Per-account runtime-scoped Campaign Data page; preserves semantic data type projection and scheduler-aligned oldest-first ordering.';

NOTIFY pgrst, 'reload schema';

COMMIT;
