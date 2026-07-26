-- Catalog-only smoke checks for migration_v200_dataset_auto_data_groups.sql.
-- Run after v200 is applied. The test creates no fixtures and writes no app data.

BEGIN;

SET LOCAL statement_timeout = '5min';
SET LOCAL lock_timeout = '5s';

DO $v200_schema$
DECLARE
  v_definition text;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'auto_account_contacts_dataset'
      AND column_name = 'auto_data_group_id'
      AND data_type = 'bigint'
      AND is_nullable = 'YES'
  ) THEN
    RAISE EXCEPTION 'v200_smoke: dataset.auto_data_group_id is missing or invalid';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'auto_account_contact_groups'
      AND column_name = 'dataset_sync_mode'
      AND data_type = 'text'
      AND is_nullable = 'NO'
  ) OR NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'auto_account_contact_groups'
      AND column_name = 'dataset_sync_key'
      AND data_type = 'text'
      AND is_nullable = 'YES'
  ) THEN
    RAISE EXCEPTION 'v200_smoke: Data Group dataset-sync columns are missing or invalid';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.auto_account_contacts_dataset'::regclass
      AND conname = 'auto_account_contacts_dataset_auto_data_group_fkey'
      AND contype = 'f'
      AND convalidated
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.auto_account_contacts_dataset'::regclass
      AND conname = 'auto_account_contacts_dataset_group_mode_check'
      AND contype = 'c'
      AND convalidated
  ) THEN
    RAISE EXCEPTION 'v200_smoke: dataset auto-group FK/CHECK is missing';
  END IF;

  IF to_regclass('public.uq_auto_data_groups_active_dataset_sync_key') IS NULL
    OR to_regclass('public.idx_contact_datasets_auto_data_group') IS NULL THEN
    RAISE EXCEPTION 'v200_smoke: dataset auto-group indexes are missing';
  END IF;

  -- Multiple account-scoped datasets from one upload intentionally share one
  -- generated group, so auto_data_group_id itself must not be unique.
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_index AS index_row
    WHERE index_row.indrelid = 'public.auto_account_contacts_dataset'::regclass
      AND index_row.indisunique
      AND pg_get_indexdef(index_row.indexrelid) LIKE '%auto_data_group_id%'
  ) THEN
    RAISE EXCEPTION 'v200_smoke: dataset.auto_data_group_id must allow a shared upload group';
  END IF;

  SELECT pg_get_functiondef(
    'public.aka_agent_ensure_dataset_auto_data_group()'::regprocedure
  ) INTO v_definition;
  IF position('NEW.group_id IS NOT NULL' IN v_definition) = 0
    OR position('dataset_auto' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'v200_smoke: ensure trigger does not exclude datasets created inside a group';
  END IF;

  SELECT pg_get_functiondef(
    'public.aka_agent_internal_sync_dataset_auto_group_member(bigint,bigint,boolean)'::regprocedure
  ) INTO v_definition;
  IF position('is_delete = false' IN v_definition) = 0
    OR position('is_delete = true' IN v_definition) = 0
    OR position('aka_agent_internal_route_data_group_member' IN v_definition) = 0
    OR position('aka_agent_derive_data_group_relationship_kind' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'v200_smoke: snapshot reactivation/removal/routing contract is incomplete';
  END IF;

  SELECT pg_get_functiondef(
    'public.aka_agent_list_data_group_datasets(bigint,bigint,bigint)'::regprocedure
  ) INTO v_definition;
  IF position('auto_data_group_id' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'v200_smoke: Data Group dataset list does not include auto-owned datasets';
  END IF;

  SELECT pg_get_functiondef(
    'public.aka_agent_sync_scan_dataset_group_origins()'::regprocedure
  ) INTO v_definition;
  IF position('dataset_sync_mode <> ''dataset_auto''' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'v200_smoke: legacy scan mirror still mutates dataset-owned groups';
  END IF;
END;
$v200_schema$;

DO $v200_triggers_acl$
DECLARE
  v_trigger text;
  v_signature text;
BEGIN
  FOREACH v_trigger IN ARRAY ARRAY[
    'trg_aka_agent_ensure_dataset_auto_data_group',
    'trg_aka_agent_cleanup_deleted_dataset_auto_data_group',
    'trg_aka_agent_sync_dataset_auto_data_group_member'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_trigger
      WHERE tgname = v_trigger
        AND NOT tgisinternal
        AND tgenabled <> 'D'
    ) THEN
      RAISE EXCEPTION 'v200_smoke: trigger % is missing or disabled', v_trigger;
    END IF;
  END LOOP;

  FOREACH v_signature IN ARRAY ARRAY[
    'public.aka_agent_internal_dataset_auto_group_key(text,bigint,text,text,text,text)',
    'public.aka_agent_internal_sync_dataset_auto_group_member(bigint,bigint,boolean)',
    'public.aka_agent_internal_retire_dataset_auto_data_group(bigint,bigint)',
    'public.aka_agent_ensure_dataset_auto_data_group()',
    'public.aka_agent_cleanup_deleted_dataset_auto_data_group()',
    'public.aka_agent_sync_dataset_auto_data_group_member()'
  ] LOOP
    IF to_regprocedure(v_signature) IS NULL THEN
      RAISE EXCEPTION 'v200_smoke: helper % is missing', v_signature;
    END IF;
    IF has_function_privilege('anon', v_signature, 'EXECUTE')
      OR has_function_privilege('authenticated', v_signature, 'EXECUTE') THEN
      RAISE EXCEPTION 'v200_smoke: internal helper % is exposed to Data API roles', v_signature;
    END IF;
  END LOOP;
END;
$v200_triggers_acl$;

ROLLBACK;
