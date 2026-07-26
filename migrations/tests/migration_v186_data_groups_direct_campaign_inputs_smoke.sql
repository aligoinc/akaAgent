-- Catalog-only smoke test for migration_v186_data_groups_direct_campaign_inputs.sql.
--
-- Run after migration v186 has been applied.  This test deliberately performs
-- no application RPC calls and writes no fixtures: it only verifies the
-- backward-additive schema, RPC surface, ACL boundary and blocklist contract.

BEGIN;

SET LOCAL statement_timeout = '5min';
SET LOCAL lock_timeout = '5s';

DO $core_schema$
DECLARE
  v_relation text;
  v_column record;
  v_actual_type text;
  v_actual_nullable text;
  v_purpose_definition text;
BEGIN
  -- v186 must retain and extend these tables, never replace them with a second
  -- contact/dataset/input model.
  FOREACH v_relation IN ARRAY ARRAY[
    'auto_account_contact_groups',
    'auto_account_contact_group_members',
    'auto_account_contacts',
    'auto_account_contacts_dataset',
    'auto_account_contacts_dataset_members',
    'auto_campaign_input_data'
  ] LOOP
    IF to_regclass(format('public.%I', v_relation)) IS NULL THEN
      RAISE EXCEPTION 'v186_smoke: retained core table public.% is missing', v_relation;
    END IF;
  END LOOP;

  -- These alternative models are explicitly outside the approved design.
  FOREACH v_relation IN ARRAY ARRAY[
    'auto_data_groups',
    'auto_data_records',
    'auto_data_datasets'
  ] LOOP
    IF to_regclass(format('public.%I', v_relation)) IS NOT NULL THEN
      RAISE EXCEPTION 'v186_smoke: forbidden replacement table public.% exists', v_relation;
    END IF;
  END LOOP;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relkind IN ('r', 'p')
      AND relation.relname ~ '^auto_(data|campaign).*pending.*deliver'
  ) THEN
    RAISE EXCEPTION 'v186_smoke: forbidden pending-delivery table exists';
  END IF;

  -- Expected column type/nullability contracts.  The nullable account/scope
  -- columns are essential for shared groups and accountless imports.
  FOR v_column IN
    SELECT *
    FROM (VALUES
      ('auto_account_contact_groups', 'account_id', 'bigint', 'YES'),
      ('auto_account_contact_groups', 'contact_type', 'text', 'YES'),
      ('auto_account_contact_groups', 'color', 'text', 'NO'),
      ('auto_account_contact_groups', 'sort_order', 'integer', 'NO'),
      ('auto_account_contact_groups', 'revision', 'bigint', 'NO'),
      ('auto_account_contact_group_members', 'is_delete', 'boolean', 'NO'),
      ('auto_account_contact_group_members', 'updated_at', 'timestamp with time zone', 'NO'),
      ('auto_account_contact_group_members', 'change_revision', 'bigint', 'NO'),
      -- Preserve the legacy FK type; this installation uses integer here.
      ('auto_account_contacts', 'account_id', 'integer', 'YES'),
      ('auto_account_contacts', 'flatform_type', 'text', 'YES'),
      ('auto_account_contacts', 'phone', 'text', 'YES'),
      ('auto_account_contacts', 'email', 'text', 'YES'),
      ('auto_account_contacts_dataset', 'account_id', 'bigint', 'YES'),
      ('auto_account_contacts_dataset', 'group_id', 'bigint', 'YES'),
      ('auto_campaign_input_data', 'canonical_target_key', 'text', 'YES'),
      ('auto_campaigns', 'data_target_source_mode', 'text', 'NO'),
      ('auto_campaigns', 'data_group_id', 'bigint', 'YES'),
      ('auto_campaigns', 'provisioning_state', 'text', 'NO'),
      ('auto_campaigns', 'creation_bundle_id', 'bigint', 'YES'),
      ('auto_campaigns', 'creation_bundle_child_index', 'integer', 'YES'),
      ('auto_automation', 'target_data_group_id', 'bigint', 'YES'),
      ('auto_automation_detail', 'target_data_group_id', 'bigint', 'YES'),
      ('auto_automation_detail', 'target_data_group_member_id', 'bigint', 'YES'),
      ('auto_automation_detail', 'target_data_group_sync_status', 'text', 'YES'),
      ('auto_automation_detail', 'target_data_group_sync_error', 'text', 'YES')
    ) AS expected(table_name, column_name, data_type, is_nullable)
  LOOP
    SELECT column_row.data_type, column_row.is_nullable
    INTO v_actual_type, v_actual_nullable
    FROM information_schema.columns AS column_row
    WHERE column_row.table_schema = 'public'
      AND column_row.table_name = v_column.table_name
      AND column_row.column_name = v_column.column_name;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'v186_smoke: missing column public.%.%',
        v_column.table_name, v_column.column_name;
    END IF;
    IF v_actual_type IS DISTINCT FROM v_column.data_type
      OR v_actual_nullable IS DISTINCT FROM v_column.is_nullable THEN
      RAISE EXCEPTION
        'v186_smoke: public.%.% has type/nullability %/%, expected %/%',
        v_column.table_name, v_column.column_name,
        v_actual_type, v_actual_nullable,
        v_column.data_type, v_column.is_nullable;
    END IF;
  END LOOP;

  SELECT lower(pg_get_constraintdef(constraint_row.oid, true))
  INTO v_purpose_definition
  FROM pg_catalog.pg_constraint AS constraint_row
  WHERE constraint_row.conrelid = 'public.auto_account_contact_groups'::regclass
    AND constraint_row.conname = 'auto_account_contact_groups_purpose_check'
    AND constraint_row.contype = 'c'
    AND constraint_row.convalidated;

  IF v_purpose_definition IS NULL
    OR position('data_group' IN v_purpose_definition) = 0
    OR position('zalo_friend_blocklist' IN v_purpose_definition) = 0 THEN
    RAISE EXCEPTION 'v186_smoke: retained group-purpose allowed-value CHECK is missing';
  END IF;

  -- Apart from the allowed-value purpose check, v186 must not enforce the
  -- blocklist's account/person/friend semantics in a database CHECK.
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'public.auto_account_contact_groups'::regclass
      AND constraint_row.contype = 'c'
      AND constraint_row.conname <> 'auto_account_contact_groups_purpose_check'
      AND lower(pg_get_constraintdef(constraint_row.oid, true))
        LIKE '%zalo_friend_blocklist%'
  ) THEN
    RAISE EXCEPTION 'v186_smoke: blocklist semantics must not be enforced by a new CHECK';
  END IF;

  -- Nor may an enabled trigger force account_id, contact_type=person or friend
  -- state for zalo_friend_blocklist rows.  Ordinary updated_at triggers remain
  -- valid and are intentionally ignored here.
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger AS trigger_row
    JOIN pg_catalog.pg_proc AS routine ON routine.oid = trigger_row.tgfoid
    WHERE trigger_row.tgrelid = 'public.auto_account_contact_groups'::regclass
      AND NOT trigger_row.tgisinternal
      AND trigger_row.tgenabled <> 'D'
      AND lower(pg_get_functiondef(routine.oid)) LIKE '%zalo_friend_blocklist%'
      AND (
        lower(pg_get_functiondef(routine.oid)) LIKE '%account_id%'
        OR lower(pg_get_functiondef(routine.oid)) LIKE '%contact_type%'
        OR lower(pg_get_functiondef(routine.oid)) LIKE '%person%'
        OR lower(pg_get_functiondef(routine.oid)) LIKE '%is_friend%'
      )
  ) THEN
    RAISE EXCEPTION 'v186_smoke: blocklist semantics must remain TypeScript-only';
  END IF;
END;
$core_schema$;

DO $support_tables$
DECLARE
  v_table text;
  v_sequence text;
  v_column record;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'auto_account_contact_group_member_origins',
    'auto_data_ingest_batches',
    'auto_campaign_data_group_sources',
    'auto_campaign_input_origins',
    'auto_campaign_input_target_aliases',
    'auto_campaign_creation_bundles'
  ] LOOP
    IF to_regclass(format('public.%I', v_table)) IS NULL THEN
      RAISE EXCEPTION 'v186_smoke: support table public.% is missing', v_table;
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_class AS relation
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public'
        AND relation.relname = v_table
        AND relation.relkind IN ('r', 'p')
        AND relation.relrowsecurity
    ) THEN
      RAISE EXCEPTION 'v186_smoke: support table public.% must have RLS enabled', v_table;
    END IF;
    IF has_table_privilege('anon', format('public.%I', v_table), 'SELECT')
      OR has_table_privilege('anon', format('public.%I', v_table), 'INSERT')
      OR has_table_privilege('anon', format('public.%I', v_table), 'UPDATE')
      OR has_table_privilege('anon', format('public.%I', v_table), 'DELETE')
      OR has_table_privilege('authenticated', format('public.%I', v_table), 'SELECT')
      OR has_table_privilege('authenticated', format('public.%I', v_table), 'INSERT')
      OR has_table_privilege('authenticated', format('public.%I', v_table), 'UPDATE')
      OR has_table_privilege('authenticated', format('public.%I', v_table), 'DELETE') THEN
      RAISE EXCEPTION 'v186_smoke: support table public.% is not RPC-only', v_table;
    END IF;
  END LOOP;

  -- The support-table shape is checked separately from its FKs below so a
  -- missing nullable provenance/audit field yields a precise failure.
  FOR v_column IN
    SELECT *
    FROM (VALUES
      ('auto_data_ingest_batches', 'request_id', 'text', 'NO'),
      ('auto_data_ingest_batches', 'request_hash', 'text', 'NO'),
      ('auto_data_ingest_batches', 'result', 'jsonb', 'YES'),
      ('auto_account_contact_group_member_origins', 'membership_id', 'bigint', 'NO'),
      ('auto_account_contact_group_member_origins', 'kind', 'text', 'NO'),
      ('auto_account_contact_group_member_origins', 'relationship_kind', 'text', 'YES'),
      ('auto_account_contact_group_member_origins', 'is_current', 'boolean', 'NO'),
      ('auto_campaign_creation_bundles', 'request_id', 'text', 'NO'),
      ('auto_campaign_creation_bundles', 'status', 'text', 'NO'),
      ('auto_campaign_creation_bundles', 'data_group_id', 'bigint', 'YES'),
      ('auto_campaign_creation_bundles', 'baseline_revision', 'bigint', 'YES'),
      ('auto_campaign_data_group_sources', 'campaign_id', 'bigint', 'NO'),
      ('auto_campaign_data_group_sources', 'group_id', 'bigint', 'NO'),
      ('auto_campaign_data_group_sources', 'baseline_revision', 'bigint', 'NO'),
      ('auto_campaign_data_group_sources', 'status', 'text', 'NO'),
      ('auto_campaign_input_origins', 'input_data_id', 'bigint', 'NO'),
      ('auto_campaign_input_origins', 'origin_kind', 'text', 'NO'),
      ('auto_campaign_input_origins', 'payload_snapshot', 'jsonb', 'NO'),
      ('auto_campaign_input_target_aliases', 'campaign_id', 'bigint', 'NO'),
      ('auto_campaign_input_target_aliases', 'alias_key', 'text', 'NO'),
      ('auto_campaign_input_target_aliases', 'canonical_target_key', 'text', 'NO')
    ) AS expected(table_name, column_name, data_type, is_nullable)
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.columns AS column_row
      WHERE column_row.table_schema = 'public'
        AND column_row.table_name = v_column.table_name
        AND column_row.column_name = v_column.column_name
        AND column_row.data_type = v_column.data_type
        AND column_row.is_nullable = v_column.is_nullable
    ) THEN
      RAISE EXCEPTION 'v186_smoke: support column public.%.% shape mismatch',
        v_column.table_name, v_column.column_name;
    END IF;
  END LOOP;

  FOREACH v_sequence IN ARRAY ARRAY[
    'auto_data_ingest_batches_id_seq',
    'auto_account_contact_group_member_origins_id_seq',
    'auto_campaign_creation_bundles_id_seq',
    'auto_campaign_data_group_sources_id_seq',
    'auto_campaign_input_origins_id_seq',
    'auto_campaign_input_target_aliases_id_seq'
  ] LOOP
    IF to_regclass(format('public.%I', v_sequence)) IS NULL THEN
      RAISE EXCEPTION 'v186_smoke: support sequence public.% is missing', v_sequence;
    END IF;
    IF has_sequence_privilege('anon', format('public.%I', v_sequence), 'USAGE')
      OR has_sequence_privilege('anon', format('public.%I', v_sequence), 'SELECT')
      OR has_sequence_privilege('anon', format('public.%I', v_sequence), 'UPDATE')
      OR has_sequence_privilege('authenticated', format('public.%I', v_sequence), 'USAGE')
      OR has_sequence_privilege('authenticated', format('public.%I', v_sequence), 'SELECT')
      OR has_sequence_privilege('authenticated', format('public.%I', v_sequence), 'UPDATE') THEN
      RAISE EXCEPTION 'v186_smoke: support sequence public.% must be RPC-only', v_sequence;
    END IF;
  END LOOP;
END;
$support_tables$;

DO $required_triggers$
DECLARE
  v_trigger record;
BEGIN
  FOR v_trigger IN
    SELECT *
    FROM (VALUES
      ('auto_account_contacts_dataset_members', 'trg_aka_agent_sync_scan_dataset_group_origins'),
      ('auto_campaign_input_data', 'trg_aka_agent_guard_canonical_campaign_input_payload'),
      ('auto_campaigns', 'trg_aka_agent_guard_campaign_data_group_identity'),
      ('auto_campaigns', 'trg_aka_agent_close_terminal_campaign_data_group_source'),
      ('auto_campaign_data_group_sources', 'trg_aka_agent_guard_campaign_data_group_source_identity'),
      ('auto_campaign_data_group_sources', 'trg_aka_agent_guard_campaign_creation_bundle_group'),
      ('auto_campaign_creation_bundles', 'trg_aka_agent_guard_campaign_creation_bundle_identity'),
      ('auto_automation_detail', 'trg_aka_agent_snapshot_automation_data_group'),
      ('auto_campaign_input_data', 'trg_aka_agent_reserve_automation_data_group_input'),
      ('auto_automation_detail', 'trg_aka_agent_resolve_automation_canonical_input')
    ) AS expected(table_name, trigger_name)
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_trigger AS trigger_row
      WHERE trigger_row.tgrelid = format('public.%I', v_trigger.table_name)::regclass
        AND trigger_row.tgname = v_trigger.trigger_name
        AND NOT trigger_row.tgisinternal
        AND trigger_row.tgenabled <> 'D'
    ) THEN
      RAISE EXCEPTION 'v186_smoke: required trigger public.%.% is missing or disabled',
        v_trigger.table_name, v_trigger.trigger_name;
    END IF;
  END LOOP;
END;
$required_triggers$;

DO $foreign_keys$
DECLARE
  v_fk record;
  v_actual_delete "char";
BEGIN
  FOR v_fk IN
    SELECT *
    FROM (VALUES
      ('auto_account_contact_group_members', 'group_id', 'auto_account_contact_groups', 'c'::"char"),
      ('auto_account_contact_group_members', 'contact_id', 'auto_account_contacts', 'c'::"char"),
      ('auto_account_contacts_dataset', 'group_id', 'auto_account_contact_groups', 'n'::"char"),
      ('auto_data_ingest_batches', 'group_id', 'auto_account_contact_groups', 'n'::"char"),
      ('auto_data_ingest_batches', 'target_group_id', 'auto_account_contact_groups', 'n'::"char"),
      ('auto_data_ingest_batches', 'dataset_id', 'auto_account_contacts_dataset', 'n'::"char"),
      ('auto_data_ingest_batches', 'source_account_id', 'auto_accounts', 'n'::"char"),
      ('auto_data_ingest_batches', 'staff_id', 'org_staff', 'c'::"char"),
      ('auto_data_ingest_batches', 'organization_id', 'org_organization', 'c'::"char"),
      ('auto_account_contact_group_member_origins', 'membership_id', 'auto_account_contact_group_members', 'c'::"char"),
      ('auto_account_contact_group_member_origins', 'dataset_id', 'auto_account_contacts_dataset', 'n'::"char"),
      ('auto_account_contact_group_member_origins', 'batch_id', 'auto_data_ingest_batches', 'n'::"char"),
      ('auto_account_contact_group_member_origins', 'source_account_id', 'auto_accounts', 'n'::"char"),
      ('auto_account_contact_group_member_origins', 'automation_detail_id', 'auto_automation_detail', 'n'::"char"),
      ('auto_campaign_creation_bundles', 'staff_id', 'org_staff', 'c'::"char"),
      ('auto_campaign_creation_bundles', 'organization_id', 'org_organization', 'c'::"char"),
      ('auto_campaign_creation_bundles', 'data_group_id', 'auto_account_contact_groups', 'r'::"char"),
      ('auto_campaigns', 'data_group_id', 'auto_account_contact_groups', 'n'::"char"),
      ('auto_campaigns', 'creation_bundle_id', 'auto_campaign_creation_bundles', 'n'::"char"),
      ('auto_campaign_data_group_sources', 'campaign_id', 'auto_campaigns', 'c'::"char"),
      ('auto_campaign_data_group_sources', 'group_id', 'auto_account_contact_groups', 'r'::"char"),
      ('auto_campaign_data_group_sources', 'bundle_id', 'auto_campaign_creation_bundles', 'n'::"char"),
      ('auto_campaign_data_group_sources', 'staff_id', 'org_staff', 'c'::"char"),
      ('auto_campaign_data_group_sources', 'organization_id', 'org_organization', 'c'::"char"),
      ('auto_campaign_input_origins', 'input_data_id', 'auto_campaign_input_data', 'c'::"char"),
      ('auto_campaign_input_origins', 'source_id', 'auto_campaign_data_group_sources', 'c'::"char"),
      ('auto_campaign_input_origins', 'group_id', 'auto_account_contact_groups', 'n'::"char"),
      ('auto_campaign_input_origins', 'membership_id', 'auto_account_contact_group_members', 'n'::"char"),
      ('auto_campaign_input_origins', 'batch_id', 'auto_data_ingest_batches', 'n'::"char"),
      ('auto_campaign_input_origins', 'automation_detail_id', 'auto_automation_detail', 'c'::"char"),
      ('auto_campaign_input_target_aliases', 'campaign_id', 'auto_campaigns', 'c'::"char"),
      ('auto_campaign_input_target_aliases', 'input_data_id', 'auto_campaign_input_data', 'n'::"char"),
      ('auto_automation', 'target_data_group_id', 'auto_account_contact_groups', 'n'::"char"),
      ('auto_automation_detail', 'target_data_group_id', 'auto_account_contact_groups', 'n'::"char"),
      ('auto_automation_detail', 'target_data_group_member_id', 'auto_account_contact_group_members', 'n'::"char")
    ) AS expected(table_name, column_name, referenced_table, delete_action)
  LOOP
    SELECT constraint_row.confdeltype
    INTO v_actual_delete
    FROM pg_catalog.pg_constraint AS constraint_row
    JOIN pg_catalog.pg_attribute AS local_column
      ON local_column.attrelid = constraint_row.conrelid
     AND local_column.attnum = constraint_row.conkey[1]
    WHERE constraint_row.contype = 'f'
      AND constraint_row.conrelid = format('public.%I', v_fk.table_name)::regclass
      AND constraint_row.confrelid = format('public.%I', v_fk.referenced_table)::regclass
      AND array_length(constraint_row.conkey, 1) = 1
      AND local_column.attname = v_fk.column_name;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'v186_smoke: missing FK public.%.% -> public.%',
        v_fk.table_name, v_fk.column_name, v_fk.referenced_table;
    END IF;
    IF v_actual_delete IS DISTINCT FROM v_fk.delete_action THEN
      RAISE EXCEPTION 'v186_smoke: wrong ON DELETE action for public.%.%',
        v_fk.table_name, v_fk.column_name;
    END IF;
  END LOOP;
END;
$foreign_keys$;

DO $indexes$
DECLARE
  v_index record;
  v_definition text;
  v_predicate text;
BEGIN
  FOR v_index IN
    SELECT *
    FROM (VALUES
      ('idx_auto_account_contact_group_members_unique', true),
      ('uq_account_contact_datasets_active_legacy_identity', true),
      ('uq_account_contact_datasets_active_group_upload', true),
      ('idx_account_contact_datasets_group_list', false),
      ('uq_auto_campaign_input_data_canonical_target', true),
      ('uq_auto_account_contact_groups_blocklist_name', true),
      ('idx_auto_account_contact_groups_shared_list', false),
      ('idx_auto_account_contact_group_members_active', false),
      ('uq_auto_data_ingest_batches_request', true),
      ('uq_auto_account_contact_group_member_origins_identity', true),
      ('uq_auto_campaign_creation_bundles_request', true),
      ('uq_auto_campaigns_creation_bundle_child', true),
      ('uq_auto_campaign_data_group_sources_campaign', true),
      ('idx_auto_campaign_data_group_sources_group_intake', false),
      ('uq_auto_campaign_input_origins_identity', true),
      ('idx_auto_campaign_input_origins_group_canonical_input', false),
      ('uq_auto_campaign_input_target_aliases_alias', true)
    ) AS expected(index_name, is_unique)
  LOOP
    SELECT lower(pg_get_indexdef(index_row.indexrelid)),
           lower(COALESCE(pg_get_expr(index_row.indpred, index_row.indrelid), ''))
    INTO v_definition, v_predicate
    FROM pg_catalog.pg_index AS index_row
    WHERE index_row.indexrelid = to_regclass(format('public.%I', v_index.index_name))
      AND index_row.indisvalid
      AND index_row.indisready
      AND index_row.indisunique = v_index.is_unique;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'v186_smoke: missing/invalid index public.% (unique=%)',
        v_index.index_name, v_index.is_unique;
    END IF;
  END LOOP;

  SELECT lower(pg_get_indexdef(index_row.indexrelid)),
         lower(COALESCE(pg_get_expr(index_row.indpred, index_row.indrelid), ''))
  INTO v_definition, v_predicate
  FROM pg_catalog.pg_index AS index_row
  WHERE index_row.indexrelid =
    'public.uq_auto_campaign_input_data_canonical_target'::regclass;
  IF position('(campaign_id, canonical_target_key)' IN v_definition) = 0
    OR position('canonical_target_key is not null' IN v_predicate) = 0
    OR position('is_delete' IN v_predicate) = 0 THEN
    RAISE EXCEPTION 'v186_smoke: canonical campaign-input partial unique index is malformed';
  END IF;

  SELECT lower(pg_get_indexdef(index_row.indexrelid)),
         lower(COALESCE(pg_get_expr(index_row.indpred, index_row.indrelid), ''))
  INTO v_definition, v_predicate
  FROM pg_catalog.pg_index AS index_row
  WHERE index_row.indexrelid =
    'public.idx_auto_campaign_input_origins_group_canonical_input'::regclass;
  IF position('(group_id, canonical_target_key, input_data_id)' IN v_definition) = 0
    OR position('origin_kind' IN v_predicate) = 0
    OR position('group_id is not null' IN v_predicate) = 0 THEN
    RAISE EXCEPTION 'v186_smoke: data-group lifetime stats index is malformed';
  END IF;

  SELECT lower(pg_get_indexdef(index_row.indexrelid))
  INTO v_definition
  FROM pg_catalog.pg_index AS index_row
  WHERE index_row.indexrelid =
    'public.uq_auto_account_contact_group_member_origins_identity'::regclass;
  IF position('relationship_kind' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'v186_smoke: origin identity must include relationship_kind';
  END IF;

  SELECT lower(pg_get_indexdef(index_row.indexrelid)),
         lower(COALESCE(pg_get_expr(index_row.indpred, index_row.indrelid), ''))
  INTO v_definition, v_predicate
  FROM pg_catalog.pg_index AS index_row
  WHERE index_row.indexrelid =
    'public.uq_auto_account_contact_groups_blocklist_name'::regclass;
  IF position('lower(name)' IN v_definition) = 0
    OR position('zalo_friend_blocklist' IN v_predicate) = 0 THEN
    RAISE EXCEPTION 'v186_smoke: blocklist-only name index is malformed';
  END IF;

  -- Duplicate names are valid for data_group.  No unique lower(name) index may
  -- apply to data groups (the purpose-filtered blocklist index above is valid).
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_index AS index_row
    WHERE index_row.indrelid = 'public.auto_account_contact_groups'::regclass
      AND index_row.indisunique
      AND lower(pg_get_indexdef(index_row.indexrelid)) LIKE '%lower(name)%'
      AND (
        index_row.indpred IS NULL
        OR lower(pg_get_expr(index_row.indpred, index_row.indrelid)) LIKE '%data_group%'
      )
  ) THEN
    RAISE EXCEPTION 'v186_smoke: data-group names must not be unique';
  END IF;

  IF to_regclass('public.idx_auto_account_contact_groups_active_name') IS NOT NULL
    OR to_regclass('public.uq_account_contact_datasets_active_identity') IS NOT NULL THEN
    RAISE EXCEPTION 'v186_smoke: superseded broad unique index still exists';
  END IF;
END;
$indexes$;

DO $rpc_surface$
DECLARE
  v_signature text;
  v_routine oid;
  v_wrapper_signature text;
  v_wrapper oid;
BEGIN
  -- The original Data Group/input signatures are implementation-only.  Each
  -- desktop endpoint is a same-name overload with mandatory process
  -- credentials, a hardened search_path and an identity assertion before it
  -- delegates to the implementation overload.
  FOREACH v_signature IN ARRAY ARRAY[
    'public.aka_agent_list_data_groups(bigint,bigint,text,integer,integer)',
    'public.aka_agent_create_data_group(bigint,bigint,text,text,text)',
    'public.aka_agent_update_data_group(bigint,bigint,bigint,text,text,integer)',
    'public.aka_agent_delete_data_group(bigint,bigint,bigint,text)',
    'public.aka_agent_duplicate_data_group(bigint,bigint,bigint,text,text)',
    'public.aka_agent_list_data_group_members(bigint,bigint,bigint,text,bigint[],boolean,text[],text[],text,bigint[],bigint[],bigint[],integer,integer)',
    'public.aka_agent_list_data_group_datasets(bigint,bigint,bigint)',
    'public.aka_agent_get_data_group_latest_ingest_stats(bigint,bigint,bigint)',
    'public.aka_agent_ingest_data_group(bigint,bigint,text,bigint,text,jsonb,bigint,text,text,bigint,text,text)',
    'public.aka_agent_remove_data_group_members(bigint,bigint,text,bigint,bigint[])',
    'public.aka_agent_move_data_group_members(bigint,bigint,text,bigint,bigint[],bigint)',
    'public.aka_agent_create_campaign_creation_bundle(bigint,bigint,text,integer)',
    'public.aka_agent_preflight_campaign_data_group_change(bigint,bigint,bigint,bigint)',
    'public.aka_agent_bind_campaign_data_group_source(bigint,bigint,text,bigint,bigint,bigint)',
    'public.aka_agent_get_campaign_data_group_source(bigint,bigint,bigint)',
    'public.aka_agent_stop_campaign_data_group_source(bigint,bigint,bigint,text,text)',
    'public.aka_agent_reactivate_campaign_data_group_source(bigint,bigint,bigint,text,text)',
    'public.aka_agent_finalize_data_group_campaign(bigint,bigint,bigint,text)',
    'public.aka_agent_finalize_expired_data_group_campaigns(bigint,bigint,integer)',
    'public.aka_agent_ingest_automation_data_group_result(bigint,bigint,bigint)',
    'public.aka_agent_list_campaign_input_data_page(bigint,bigint,bigint,text,text,timestamp with time zone,timestamp with time zone,integer,integer)'
  ] LOOP
    v_routine := to_regprocedure(v_signature);
    IF v_routine IS NULL THEN
      RAISE EXCEPTION 'v186_smoke: missing implementation RPC %', v_signature;
    END IF;
    IF NOT (SELECT routine.prosecdef FROM pg_catalog.pg_proc AS routine
            WHERE routine.oid = v_routine) THEN
      RAISE EXCEPTION 'v186_smoke: implementation RPC % must be SECURITY DEFINER',
        v_signature;
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_proc AS routine
      CROSS JOIN LATERAL unnest(COALESCE(routine.proconfig, ARRAY[]::text[])) AS setting(value)
      WHERE routine.oid = v_routine
        AND setting.value LIKE 'search_path=%public%'
    ) THEN
      RAISE EXCEPTION 'v186_smoke: implementation RPC % must pin search_path',
        v_signature;
    END IF;
    IF has_function_privilege('anon', v_signature, 'EXECUTE')
      OR has_function_privilege('authenticated', v_signature, 'EXECUTE') THEN
      RAISE EXCEPTION 'v186_smoke: implementation RPC % is exposed to desktop roles',
        v_signature;
    END IF;
    IF NOT has_function_privilege('service_role', v_signature, 'EXECUTE') THEN
      RAISE EXCEPTION 'v186_smoke: implementation RPC % is missing service_role EXECUTE',
        v_signature;
    END IF;
    IF EXISTS (
      SELECT 1
      FROM pg_catalog.pg_proc AS routine
      CROSS JOIN LATERAL aclexplode(
        COALESCE(routine.proacl, acldefault('f', routine.proowner))
      ) AS privilege
      WHERE routine.oid = v_routine
        AND privilege.grantee = 0
        AND privilege.privilege_type = 'EXECUTE'
    ) THEN
      RAISE EXCEPTION 'v186_smoke: implementation RPC % grants EXECUTE to PUBLIC',
        v_signature;
    END IF;

    v_wrapper_signature := left(v_signature, length(v_signature) - 1)
      || ',text,text)';
    v_wrapper := to_regprocedure(v_wrapper_signature);
    IF v_wrapper IS NULL THEN
      RAISE EXCEPTION 'v186_smoke: missing authenticated wrapper RPC %',
        v_wrapper_signature;
    END IF;
    IF NOT (SELECT routine.prosecdef FROM pg_catalog.pg_proc AS routine
            WHERE routine.oid = v_wrapper) THEN
      RAISE EXCEPTION 'v186_smoke: wrapper RPC % must be SECURITY DEFINER',
        v_wrapper_signature;
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_proc AS routine
      CROSS JOIN LATERAL unnest(COALESCE(routine.proconfig, ARRAY[]::text[])) AS setting(value)
      WHERE routine.oid = v_wrapper
        AND replace(setting.value, ' ', '') = 'search_path=pg_catalog,public'
    ) THEN
      RAISE EXCEPTION 'v186_smoke: wrapper RPC % must pin pg_catalog,public search_path',
        v_wrapper_signature;
    END IF;
    IF EXISTS (
      SELECT 1
      FROM pg_catalog.pg_proc AS routine
      WHERE routine.oid = v_wrapper
        AND (
          routine.pronargdefaults <> 0
          OR routine.proargnames[routine.pronargs - 1]
            IS DISTINCT FROM 'p_auth_username'
          OR routine.proargnames[routine.pronargs]
            IS DISTINCT FROM 'p_auth_password'
        )
    ) THEN
      RAISE EXCEPTION 'v186_smoke: wrapper RPC % credentials must be named and mandatory',
        v_wrapper_signature;
    END IF;
    IF position(
      'auto_assert_automation_identity' IN lower(pg_get_functiondef(v_wrapper))
    ) = 0 THEN
      RAISE EXCEPTION 'v186_smoke: wrapper RPC % does not assert desktop identity',
        v_wrapper_signature;
    END IF;
    IF EXISTS (
      SELECT 1
      FROM pg_catalog.pg_proc AS routine
      CROSS JOIN LATERAL aclexplode(
        COALESCE(routine.proacl, acldefault('f', routine.proowner))
      ) AS privilege
      WHERE routine.oid = v_wrapper
        AND privilege.grantee = 0
        AND privilege.privilege_type = 'EXECUTE'
    ) THEN
      RAISE EXCEPTION 'v186_smoke: wrapper RPC % grants EXECUTE to PUBLIC',
        v_wrapper_signature;
    END IF;
    IF NOT has_function_privilege('anon', v_wrapper_signature, 'EXECUTE')
      OR NOT has_function_privilege('authenticated', v_wrapper_signature, 'EXECUTE')
      OR NOT has_function_privilege('service_role', v_wrapper_signature, 'EXECUTE') THEN
      RAISE EXCEPTION 'v186_smoke: wrapper RPC % is missing an explicit role grant',
        v_wrapper_signature;
    END IF;
  END LOOP;

  -- Existing authenticated automation RPCs retain their established surface.
  FOREACH v_signature IN ARRAY ARRAY[
    'public.aka_agent_save_automation(bigint,bigint,bigint,text,bigint,bigint,text,bigint,bigint,text,integer,integer,timestamp with time zone,text,boolean,jsonb,text,text,integer,text,time without time zone,time without time zone,boolean)',
    'public.claim_auto_automation_details(bigint,bigint,text,integer,text,text)',
    'public.reconcile_auto_automation_enqueue_failures(bigint,bigint,text,integer,text,text)',
    'public.aka_agent_list_automation_details(bigint,bigint,bigint,text,integer,integer,text,text)'
  ] LOOP
    v_routine := to_regprocedure(v_signature);
    IF v_routine IS NULL THEN
      RAISE EXCEPTION 'v186_smoke: missing RPC %', v_signature;
    END IF;
    IF NOT (SELECT routine.prosecdef FROM pg_catalog.pg_proc AS routine
            WHERE routine.oid = v_routine) THEN
      RAISE EXCEPTION 'v186_smoke: RPC % must be SECURITY DEFINER', v_signature;
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_proc AS routine
      CROSS JOIN LATERAL unnest(COALESCE(routine.proconfig, ARRAY[]::text[])) AS setting(value)
      WHERE routine.oid = v_routine
        AND setting.value LIKE 'search_path=%public%'
    ) THEN
      RAISE EXCEPTION 'v186_smoke: RPC % must pin search_path', v_signature;
    END IF;
    IF EXISTS (
      SELECT 1
      FROM pg_catalog.pg_proc AS routine
      CROSS JOIN LATERAL aclexplode(
        COALESCE(routine.proacl, acldefault('f', routine.proowner))
      ) AS privilege
      WHERE routine.oid = v_routine
        AND privilege.grantee = 0
        AND privilege.privilege_type = 'EXECUTE'
    ) THEN
      RAISE EXCEPTION 'v186_smoke: RPC % must not grant EXECUTE to PUBLIC', v_signature;
    END IF;
    IF NOT has_function_privilege('anon', v_signature, 'EXECUTE')
      OR NOT has_function_privilege('authenticated', v_signature, 'EXECUTE') THEN
      RAISE EXCEPTION 'v186_smoke: RPC % is missing a desktop-role grant', v_signature;
    END IF;
  END LOOP;

  -- The existing scheduler claim remains invoker security, but v186 must gate
  -- staged bundle children in that exact function rather than a second claim.
  v_routine := to_regprocedure(
    'public.claim_campaign_runtime(bigint,bigint,bigint,text)'
  );
  IF v_routine IS NULL THEN
    RAISE EXCEPTION 'v186_smoke: claim_campaign_runtime signature is missing';
  END IF;
  IF (SELECT routine.prosecdef FROM pg_catalog.pg_proc AS routine
      WHERE routine.oid = v_routine) THEN
    RAISE EXCEPTION 'v186_smoke: claim_campaign_runtime must remain SECURITY INVOKER';
  END IF;
  IF position(
    'provisioning_state' IN lower(pg_get_functiondef(v_routine))
  ) = 0 THEN
    RAISE EXCEPTION 'v186_smoke: scheduler claim does not gate staged bundles';
  END IF;

  -- Service-only callers used while the desktop is not eligible/running.
  FOREACH v_signature IN ARRAY ARRAY[
    'public.aka_agent_finalize_data_group_campaign(bigint,bigint,bigint,text)',
    'public.aka_agent_finalize_expired_data_group_campaigns(bigint,bigint,integer)',
    'public.aka_agent_ingest_automation_data_group_result(bigint,bigint,bigint)',
    'public.aka_agent_save_automation(bigint,bigint,bigint,text,bigint,bigint,text,bigint,bigint,text,integer,integer,timestamp with time zone,text,boolean,jsonb,text,text,integer,text,time without time zone,time without time zone,boolean)',
    'public.claim_auto_automation_details(bigint,bigint,text,integer,text,text)',
    'public.reconcile_auto_automation_enqueue_failures(bigint,bigint,text,integer,text,text)',
    'public.aka_agent_list_automation_details(bigint,bigint,bigint,text,integer,integer,text,text)'
  ] LOOP
    IF NOT has_function_privilege('service_role', v_signature, 'EXECUTE') THEN
      RAISE EXCEPTION 'v186_smoke: RPC % is missing service_role EXECUTE', v_signature;
    END IF;
  END LOOP;
END;
$rpc_surface$;

DO $internal_acl$
DECLARE
  v_signature text;
  v_routine oid;
BEGIN
  -- Helpers and trigger functions must not become direct PostgREST endpoints.
  FOREACH v_signature IN ARRAY ARRAY[
    'public.aka_agent_internal_require_staff_tenant(bigint,bigint)',
    'public.aka_agent_internal_normalize_phone(text)',
    'public.aka_agent_internal_normalize_facebook_identity(text)',
    'public.aka_agent_guard_canonical_campaign_input_payload()',
    'public.aka_agent_internal_route_data_group_member(bigint,bigint,bigint,bigint)',
    'public.aka_agent_internal_route_group_snapshot(bigint,bigint,bigint)',
    'public.aka_agent_sync_scan_dataset_group_origins()',
    'public.aka_agent_guard_campaign_data_group_identity()',
    'public.aka_agent_close_terminal_campaign_data_group_source()',
    'public.aka_agent_guard_campaign_data_group_source_identity()',
    'public.aka_agent_guard_campaign_creation_bundle_group()',
    'public.aka_agent_guard_campaign_creation_bundle_identity()',
    'public.aka_agent_validate_data_group_relationship_kind(bigint,bigint,bigint,text,jsonb)',
    'public.aka_agent_derive_data_group_relationship_kind(bigint,bigint,bigint)',
    'public.aka_agent_internal_route_data_group_member_v190_internal(bigint,bigint,bigint,bigint)',
    'public.aka_agent_internal_route_data_group_member_v186_internal(bigint,bigint,bigint,bigint)',
    'public.aka_agent_ingest_data_group_v186_internal(bigint,bigint,text,bigint,text,jsonb,bigint,text,text,bigint,text,text)',
    'public.aka_agent_snapshot_automation_data_group()',
    'public.aka_agent_reserve_automation_data_group_input()',
    'public.aka_agent_resolve_automation_canonical_input()',
    'public.auto_automation_to_json(bigint,bigint,bigint)',
    'public.reconcile_auto_automation_enqueue_failures_v185_internal(bigint,bigint,text,integer,text,text)'
  ] LOOP
    v_routine := to_regprocedure(v_signature);
    IF v_routine IS NULL THEN
      RAISE EXCEPTION 'v186_smoke: internal routine % is missing', v_signature;
    END IF;
    IF has_function_privilege('anon', v_signature, 'EXECUTE')
      OR has_function_privilege('authenticated', v_signature, 'EXECUTE') THEN
      RAISE EXCEPTION 'v186_smoke: internal routine % is exposed to desktop roles',
        v_signature;
    END IF;
    IF EXISTS (
      SELECT 1
      FROM pg_catalog.pg_proc AS routine
      CROSS JOIN LATERAL aclexplode(
        COALESCE(routine.proacl, acldefault('f', routine.proowner))
      ) AS privilege
      WHERE routine.oid = v_routine
        AND privilege.grantee = 0
        AND privilege.privilege_type = 'EXECUTE'
    ) THEN
      RAISE EXCEPTION 'v186_smoke: internal routine % grants EXECUTE to PUBLIC',
        v_signature;
    END IF;
  END LOOP;
END;
$internal_acl$;

DO $stats_and_lock_order$
DECLARE
  v_stats_oid oid := to_regprocedure(
    'public.aka_agent_get_data_group_latest_ingest_stats(bigint,bigint,bigint)'
  );
  v_sync_oid oid := to_regprocedure(
    'public.aka_agent_sync_scan_dataset_group_origins()'
  );
  v_definition text;
  v_group_lock_position integer;
  v_member_lock_position integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS routine
    WHERE routine.oid = v_stats_oid
      AND routine.proargnames @> ARRAY[
        'active_membership_count',
        'unique_compatible_target_count',
        'campaign_input_count',
        'inserted_input_count'
      ]::text[]
  ) THEN
    RAISE EXCEPTION 'v186_smoke: data-group stats RPC is missing separated lifetime/latest counts';
  END IF;

  v_definition := lower(pg_get_functiondef(v_sync_oid));
  v_group_lock_position := position('for update of contact_group' IN v_definition);
  v_member_lock_position := position('for update of member' IN v_definition);
  IF v_group_lock_position = 0
    OR v_member_lock_position = 0
    OR v_group_lock_position >= v_member_lock_position THEN
    RAISE EXCEPTION 'v186_smoke: scan dataset trigger must lock group rows before membership rows';
  END IF;
END;
$stats_and_lock_order$;

DO $bundle_relationship_hardening$
DECLARE
  v_bind text := lower(pg_get_functiondef(to_regprocedure(
    'public.aka_agent_bind_campaign_data_group_source(bigint,bigint,text,bigint,bigint,bigint)'
  )));
  v_router text := lower(pg_get_functiondef(to_regprocedure(
    'public.aka_agent_internal_route_data_group_member(bigint,bigint,bigint,bigint)'
  )));
  v_ingest_core text := lower(pg_get_functiondef(to_regprocedure(
    'public.aka_agent_ingest_data_group_v186_internal(bigint,bigint,text,bigint,text,jsonb,bigint,text,text,bigint,text,text)'
  )));
  v_member_list text := lower(pg_get_functiondef(to_regprocedure(
    'public.aka_agent_list_data_group_members(bigint,bigint,bigint,text,bigint[],boolean,text[],text[],text,bigint[],bigint[],bigint[],integer,integer)'
  )));
  v_save_automation text := lower(pg_get_functiondef(to_regprocedure(
    'public.aka_agent_save_automation(bigint,bigint,bigint,text,bigint,bigint,text,bigint,bigint,text,integer,integer,timestamp with time zone,text,boolean,jsonb,text,text,integer,text,time without time zone,time without time zone,boolean)'
  )));
  v_stop text := lower(pg_get_functiondef(to_regprocedure(
    'public.aka_agent_stop_campaign_data_group_source(bigint,bigint,bigint,text,text)'
  )));
  v_auth_position integer;
  v_group_lookup_position integer;
  v_stop_group_position integer;
  v_stop_campaign_position integer;
  v_stop_source_position integer;
BEGIN
  IF position('campaign_creation_bundle_baseline_incomplete' IN v_bind) = 0
    OR position('aka_agent_internal_route_group_snapshot' IN v_bind) = 0
    OR position('baseline_revision = v_group.revision' IN v_bind) = 0
    OR position('provisioning_state = ''ready''' IN v_bind) = 0
  THEN
    RAISE EXCEPTION 'v186_smoke: bundle bind is missing its atomic same-revision barrier';
  END IF;

  IF position('campaign_creation_bundle_not_ready' IN v_router) = 0
    OR position('aka_agent_internal_route_data_group_member_v190_internal' IN v_router) = 0
    OR position('batch.operation = ''bind_source''' IN v_router) = 0
  THEN
    RAISE EXCEPTION 'v186_smoke: staged bundle routing gate is incomplete';
  END IF;

  IF position('aka_agent_validate_data_group_relationship_kind' IN v_ingest_core) = 0
    OR position('relationship_kind' IN v_member_list) = 0
  THEN
    RAISE EXCEPTION 'v186_smoke: exact per-row relationship provenance is not wired end-to-end';
  END IF;

  v_auth_position := position('auto_assert_automation_identity' IN v_save_automation);
  v_group_lookup_position := position(
    'from public.auto_account_contact_groups' IN v_save_automation
  );
  IF v_auth_position = 0
    OR v_group_lookup_position = 0
    OR v_auth_position >= v_group_lookup_position
    OR position('for share of contact_group' IN v_save_automation) = 0
  THEN
    RAISE EXCEPTION 'v186_smoke: automation Data Group validation must authenticate and lock first';
  END IF;

  v_stop_group_position := position(
    'from public.auto_account_contact_groups' IN v_stop
  );
  v_stop_campaign_position := position('from public.auto_campaigns' IN v_stop);
  v_stop_source_position := v_stop_campaign_position + position(
    'from public.auto_campaign_data_group_sources' IN substring(
      v_stop FROM v_stop_campaign_position + 1
    )
  );
  IF v_stop_group_position = 0
    OR v_stop_campaign_position <= v_stop_group_position
    OR v_stop_source_position <= v_stop_campaign_position
  THEN
    RAISE EXCEPTION 'v186_smoke: source stop must preserve group -> campaign -> source lock order';
  END IF;
END;
$bundle_relationship_hardening$;

ROLLBACK;
