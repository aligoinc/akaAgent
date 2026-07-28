-- Metadata-only regression checks for migration v204.

DO $smoke$
DECLARE
  v_security_definer boolean;
  v_config text[];
BEGIN
  SELECT procedure.prosecdef, procedure.proconfig
  INTO v_security_definer, v_config
  FROM pg_catalog.pg_proc AS procedure
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = procedure.pronamespace
  WHERE namespace.nspname = 'public'
    AND procedure.proname =
      'aka_agent_close_terminal_campaign_data_group_source'
    AND procedure.pronargs = 0;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'missing_campaign_data_group_close_trigger_function';
  END IF;

  IF NOT COALESCE(v_security_definer, false) THEN
    RAISE EXCEPTION 'campaign_data_group_close_trigger_not_security_definer';
  END IF;

  IF NOT COALESCE(
    'search_path=pg_catalog, public' = ANY(v_config),
    false
  ) THEN
    RAISE EXCEPTION 'campaign_data_group_close_trigger_search_path_not_pinned';
  END IF;

  IF has_table_privilege(
      'anon',
      'public.auto_campaign_data_group_sources',
      'INSERT, UPDATE, DELETE'
    )
    OR has_table_privilege(
      'authenticated',
      'public.auto_campaign_data_group_sources',
      'INSERT, UPDATE, DELETE'
    )
  THEN
    RAISE EXCEPTION 'campaign_data_group_source_table_write_privilege_leaked';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger AS trigger
    JOIN pg_catalog.pg_class AS relation
      ON relation.oid = trigger.tgrelid
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relname = 'auto_campaigns'
      AND trigger.tgname =
        'trg_aka_agent_close_terminal_campaign_data_group_source'
      AND NOT trigger.tgisinternal
      AND trigger.tgenabled <> 'D'
  ) THEN
    RAISE EXCEPTION 'campaign_data_group_close_trigger_missing_or_disabled';
  END IF;
END;
$smoke$;
