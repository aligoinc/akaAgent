-- Preserve the legacy integer account FK while matching the Data Group DTO's
-- bigint source_account_id result contract. PL/pgSQL RETURN QUERY does not
-- apply an implicit integer -> bigint cast for a declared TABLE column.

BEGIN;

DO $patch_data_group_member_account_id$
DECLARE
  v_signature regprocedure := pg_catalog.to_regprocedure(
    'public.aka_agent_list_data_group_members(bigint,bigint,bigint,text,bigint[],boolean,text[],text[],text,bigint[],bigint[],bigint[],integer,integer)'
  );
  v_definition text;
  v_old text := E'    filtered.account_id,\n    filtered.selected_account_name,';
  v_new text := E'    filtered.account_id::bigint,\n    filtered.selected_account_name,';
BEGIN
  IF v_signature IS NULL THEN
    RAISE EXCEPTION 'missing_data_group_member_list_implementation';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(v_signature)
  INTO v_definition;

  IF pg_catalog.strpos(v_definition, 'filtered.account_id::bigint') > 0 THEN
    RETURN;
  END IF;

  IF (
    pg_catalog.length(v_definition)
    - pg_catalog.length(pg_catalog.replace(v_definition, v_old, ''))
  ) <> pg_catalog.length(v_old) THEN
    RAISE EXCEPTION 'unexpected_data_group_member_account_id_projection';
  END IF;

  EXECUTE pg_catalog.replace(v_definition, v_old, v_new);
END;
$patch_data_group_member_account_id$;

COMMENT ON FUNCTION public.aka_agent_list_data_group_members(
  bigint, bigint, bigint, text, bigint[], boolean, text[], text[], text,
  bigint[], bigint[], bigint[], integer, integer
) IS
  'Lists paged Data Group memberships; source_account_id is explicitly projected as bigint.';

NOTIFY pgrst, 'reload schema';

COMMIT;
