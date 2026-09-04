-- Bulk akaAgent RPCs are invoked through PostgREST with the anon role, whose
-- project-level statement_timeout is 3 seconds. Keep scheduler/claim/control
-- polling on the short fail-fast timeout, but give interactive bulk reads,
-- whole-group mutations/materialization and bounded discovery up to 60 seconds.
--
-- This migration intentionally changes only each function's SET config. Live
-- definitions and metadata were captured from linked production project
-- cgjbsmqtfhqvttudyjzq (akachat) on 2026-09-04. The checksum preflight accepts
-- only that source state or this migration's idempotent target state.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE TEMP TABLE heavy_rpc_timeout_targets (
  signature text PRIMARY KEY,
  source_checksum text NOT NULL,
  target_checksum text NOT NULL,
  metadata_checksum text NOT NULL,
  source_config text NOT NULL
) ON COMMIT DROP;

INSERT INTO heavy_rpc_timeout_targets (
  signature, source_checksum, target_checksum, metadata_checksum, source_config
) VALUES
  (
    'public.aka_agent_bind_campaign_data_group_source(bigint,bigint,text,bigint,bigint,bigint,text,text)',
    '25cb803b9a15305f7a884d6a55da395c', '869d902d319748ea1ce3376b3526df3d',
    '0d42ee236234b473e8d0df663e667654', 'search_path=pg_catalog, public'
  ),
  (
    'public.aka_agent_delete_data_group_with_options(bigint,bigint,bigint,text,boolean,text,text)',
    '07bee063fcefa742c9cb493db94258a9', '6198b0a6155832cf40f37266a26d01b9',
    '0d42ee236234b473e8d0df663e667654', 'search_path=pg_catalog, public'
  ),
  (
    'public.aka_agent_delete_data_group(bigint,bigint,bigint,text,text,text)',
    'f4d71d752e4d94ce5bb37734e6ed4e23', 'e18bb557fcd094dd735b6c8b8211e7e2',
    '0d42ee236234b473e8d0df663e667654', 'search_path=pg_catalog, public'
  ),
  (
    'public.aka_agent_duplicate_data_group(bigint,bigint,bigint,text,text,text,text)',
    'e2ee45fdd94fb2845f1cf60da9f9813c', 'a0616d5dfccc3fdc8e88d8153abb375e',
    '0d42ee236234b473e8d0df663e667654', 'search_path=pg_catalog, public'
  ),
  (
    'public.aka_agent_get_automation_options(bigint,bigint,text,text)',
    'a6c07174ca375c86d2e1a4587efd8684', '80ec7c7d50f1c86dfa77472d0ae8e3c3',
    '85a685f77602625b1c72b1a988152c22', 'search_path=pg_catalog, public'
  ),
  (
    'public.aka_agent_get_data_group_latest_ingest_stats(bigint,bigint,bigint,text,text)',
    '0e8be9db7f4447ff0cb39ecd46b6a47e', '2fd9c13762039fa87bc3860797c9567f',
    '2fb7efb155a977d5391d9af1f567d07d', 'search_path=pg_catalog, public'
  ),
  (
    'public.aka_agent_get_data_group_panel(bigint,bigint,bigint,text,text)',
    'aea3037e5560e5ec7c28523d154d0a13', '0365d8eae3b99217e5063f0e5cbaa480',
    '2fb7efb155a977d5391d9af1f567d07d', 'search_path=pg_catalog, public'
  ),
  (
    'public.aka_agent_ingest_automation_data_group_result(bigint,bigint,bigint,text,text)',
    'e192a7a02a76ad0fd02ceac71e9631dd', '25b094235a53019affdbb8700d579eef',
    '0d42ee236234b473e8d0df663e667654', 'search_path=pg_catalog, public'
  ),
  (
    'public.aka_agent_list_automation_details(bigint,bigint,bigint,text,integer,integer,text,text)',
    '2cdd0d56e51144a9e36afabce2416dfb', '947d98945a281def47f259585ece6835',
    '85a685f77602625b1c72b1a988152c22', 'search_path=pg_catalog, public'
  ),
  (
    'public.aka_agent_list_automations(bigint,bigint,text,boolean,text,bigint,bigint,timestamp with time zone,integer,integer,text,text,text,text)',
    'ac92efa1019144ce51fd116df817fce1', '5637b4d0bfe6fe96c9b1910baeba3bf3',
    '85a685f77602625b1c72b1a988152c22', 'search_path=pg_catalog, public'
  ),
  (
    'public.aka_agent_list_campaign_automation_details(bigint,bigint,bigint,text,text,text,timestamp with time zone,timestamp with time zone,integer,integer,text,text)',
    'ff4739e31c6e801bc6ca62df36fad36c', 'ecad3867d725b6fbb27148366f90b6ce',
    '2fb7efb155a977d5391d9af1f567d07d', 'search_path=pg_catalog, public'
  ),
  (
    'public.aka_agent_list_campaign_input_data_page(bigint,bigint,bigint,text,text,timestamp with time zone,timestamp with time zone,integer,integer,text,text)',
    'fdcf92414df4095818e83c097b638e10', '3e208a30d46d5168dd509ca4736b3012',
    '0d42ee236234b473e8d0df663e667654', 'search_path=pg_catalog, public'
  ),
  (
    'public.aka_agent_list_campaign_input_data_page(bigint,bigint,bigint,text,text,timestamp with time zone,timestamp with time zone,text,integer,integer,text,text)',
    '4d850ca32890194ea9c7ba08957950f8', '2ac65746a79de69ba99911b3301e1340',
    '0d42ee236234b473e8d0df663e667654', 'search_path=pg_catalog, public'
  ),
  (
    'public.aka_agent_list_contact_dataset_member_ids(bigint,bigint,bigint,bigint,text)',
    '4114a38e504f7b71a83792d0c2095d25', 'a726cda368e948073c609d963912e637',
    '2fb7efb155a977d5391d9af1f567d07d', 'search_path=public'
  ),
  (
    'public.aka_agent_list_data_group_datasets(bigint,bigint,bigint,text,text)',
    'a263ee0aa864991aa4e414ac0d42bd27', 'bfb8d564579c245a983814bf94944e2f',
    '2fb7efb155a977d5391d9af1f567d07d', 'search_path=pg_catalog, public'
  ),
  (
    'public.aka_agent_list_data_group_members(bigint,bigint,bigint,text,bigint[],boolean,text[],text[],text,bigint[],bigint[],bigint[],bigint[],integer,integer,text,text)',
    'be77ab2c69a15378a68216efb158b422', '4564edccd0be59ea0f9563367859f3d3',
    '2fb7efb155a977d5391d9af1f567d07d', 'search_path=pg_catalog, public'
  ),
  (
    'public.aka_agent_list_data_group_members(bigint,bigint,bigint,text,bigint[],boolean,text[],text[],text,bigint[],bigint[],bigint[],integer,integer,text,text)',
    '8a6d6d039f339c8c55f1690a0a54db7a', '6c6044a8598df80c417be2aa489ed5e2',
    '2fb7efb155a977d5391d9af1f567d07d', 'search_path=pg_catalog, public'
  ),
  (
    'public.aka_agent_list_data_groups(bigint,bigint,text,integer,integer,text,text)',
    '2a2d75fd50bd9a6c0ffd4e80f4cb64d2', '625640cf6fd46d7cd993084c5a378451',
    '2fb7efb155a977d5391d9af1f567d07d', 'search_path=pg_catalog, public'
  ),
  (
    'public.aka_agent_list_data_groups(bigint,bigint,text,text,bigint,bigint[],integer,integer,text,text,boolean)',
    '89e15bcc27e26a948c6b95cbc37d9a03', 'd4d42baec8810c79db4090b982a100e9',
    '2fb7efb155a977d5391d9af1f567d07d', 'search_path=pg_catalog, public'
  ),
  (
    'public.aka_agent_move_data_group_members(bigint,bigint,text,bigint,bigint[],bigint,text,text)',
    'c7eeeee45b74c5ac12d01cc1f5bb9d3c', '1bcf491f2b74b62bedf175223a38079b',
    '0d42ee236234b473e8d0df663e667654', 'search_path=pg_catalog, public'
  ),
  (
    'public.aka_agent_preview_data_group_campaign_targets(bigint,bigint,bigint,text,bigint[],text,text)',
    '701c6016b5a2f4301d97f672308f2ecf', '8ac956748ce306a38d68f69b02f4262c',
    '0d42ee236234b473e8d0df663e667654', 'search_path=pg_catalog, public'
  ),
  (
    'public.aka_agent_preview_data_group_dynamic_filter(bigint,bigint,bigint,jsonb,integer,text,text)',
    '1ac138afc4cd0b4a84ec80a9a765b2be', 'f38373674f16e954359ba361b056ba39',
    '2fb7efb155a977d5391d9af1f567d07d', 'search_path=pg_catalog, public'
  ),
  (
    'public.aka_agent_process_data_group_dynamic_filters(bigint,bigint,integer,text,text)',
    '4e855f4769b4f5537bdf351d9f20c6b6', '7da4e8b9633fb92cc16af4872f2d9dc3',
    '0d42ee236234b473e8d0df663e667654', 'search_path=pg_catalog, public'
  ),
  (
    'public.aka_agent_reactivate_campaign_data_group_source(bigint,bigint,bigint,text,text,text,text)',
    'fd57dabdd70fc7d9b208fe71373018c1', '56c07dc3ce73ba9bb5e0660bf15ab34e',
    '0d42ee236234b473e8d0df663e667654', 'search_path=pg_catalog, public'
  ),
  (
    'public.aka_agent_remove_data_group_members(bigint,bigint,text,bigint,bigint[],text,text)',
    '2560bc3591b831793129a41b9ec04ebd', '3f969f38ba95cb1bf0ca10a7663fcdad',
    '0d42ee236234b473e8d0df663e667654', 'search_path=pg_catalog, public'
  ),
  (
    'public.aka_agent_snapshot_data_group_to_direct_campaign(bigint,bigint,text,bigint,bigint,timestamp with time zone,text,text,text)',
    'de05a4568d87acdfa2171517fe3f7c57', '852fe0a78dcd9d0fbedc3bdfb84b3628',
    '0d42ee236234b473e8d0df663e667654', 'search_path=pg_catalog, public'
  ),
  (
    'public.discover_zalo_server_account_runtime_users(bigint,integer)',
    'a92860a4503e7c337e724fb96d9f0f94', '47fc86fdd6506bf1dbb8836569f792ab',
    '7716f1c6a1d13c698ce9d5edaa788b0d', 'search_path=public'
  );

DO $preflight$
DECLARE
  v record;
  v_oid regprocedure;
  v_checksum text;
  v_metadata_checksum text;
  v_config text[];
  v_expected_target_config text[];
BEGIN
  IF (SELECT count(*) FROM heavy_rpc_timeout_targets) <> 27 THEN
    RAISE EXCEPTION 'heavy_rpc_timeout_target_count_mismatch';
  END IF;

  FOR v IN SELECT * FROM heavy_rpc_timeout_targets ORDER BY signature
  LOOP
    v_oid := pg_catalog.to_regprocedure(v.signature);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'missing_heavy_rpc:%', v.signature;
    END IF;

    SELECT
      pg_catalog.md5(pg_catalog.pg_get_functiondef(fn.oid)),
      pg_catalog.md5(pg_catalog.concat_ws(
        '|',
        pg_catalog.pg_get_userbyid(fn.proowner),
        fn.prosecdef::text,
        fn.provolatile::text,
        COALESCE(fn.proacl::text, '')
      )),
      fn.proconfig
    INTO v_checksum, v_metadata_checksum, v_config
    FROM pg_catalog.pg_proc AS fn
    WHERE fn.oid = v_oid;

    IF v_checksum NOT IN (v.source_checksum, v.target_checksum) THEN
      RAISE EXCEPTION
        'unexpected_heavy_rpc_checksum signature=% checksum=%',
        v.signature, v_checksum;
    END IF;
    IF v_metadata_checksum <> v.metadata_checksum THEN
      RAISE EXCEPTION
        'unexpected_heavy_rpc_metadata signature=% checksum=%',
        v.signature, v_metadata_checksum;
    END IF;

    v_expected_target_config := ARRAY[
      v.source_config, 'statement_timeout=60s'
    ]::text[];
    IF v_checksum = v.source_checksum
      AND v_config IS DISTINCT FROM ARRAY[v.source_config]::text[]
    THEN
      RAISE EXCEPTION
        'unexpected_heavy_rpc_source_config signature=% config=%',
        v.signature, v_config;
    END IF;
    IF v_checksum = v.target_checksum
      AND v_config IS DISTINCT FROM v_expected_target_config
    THEN
      RAISE EXCEPTION
        'unexpected_heavy_rpc_target_config signature=% config=%',
        v.signature, v_config;
    END IF;
  END LOOP;
END;
$preflight$;

DO $apply_timeout$
DECLARE
  v record;
BEGIN
  FOR v IN SELECT signature FROM heavy_rpc_timeout_targets ORDER BY signature
  LOOP
    EXECUTE pg_catalog.format(
      'ALTER FUNCTION %s SET statement_timeout TO %L',
      v.signature,
      '60s'
    );
  END LOOP;
END;
$apply_timeout$;

DO $postflight$
DECLARE
  v record;
  v_oid regprocedure;
  v_checksum text;
  v_metadata_checksum text;
  v_config text[];
BEGIN
  FOR v IN SELECT * FROM heavy_rpc_timeout_targets ORDER BY signature
  LOOP
    v_oid := pg_catalog.to_regprocedure(v.signature);
    SELECT
      pg_catalog.md5(pg_catalog.pg_get_functiondef(fn.oid)),
      pg_catalog.md5(pg_catalog.concat_ws(
        '|',
        pg_catalog.pg_get_userbyid(fn.proowner),
        fn.prosecdef::text,
        fn.provolatile::text,
        COALESCE(fn.proacl::text, '')
      )),
      fn.proconfig
    INTO v_checksum, v_metadata_checksum, v_config
    FROM pg_catalog.pg_proc AS fn
    WHERE fn.oid = v_oid;

    IF v_checksum <> v.target_checksum
      OR v_metadata_checksum <> v.metadata_checksum
      OR v_config IS DISTINCT FROM ARRAY[
        v.source_config, 'statement_timeout=60s'
      ]::text[]
    THEN
      RAISE EXCEPTION
        'heavy_rpc_timeout_postflight_failed signature=% checksum=% metadata=% config=%',
        v.signature, v_checksum, v_metadata_checksum, v_config;
    END IF;
  END LOOP;
END;
$postflight$;

NOTIFY pgrst, 'reload schema';

COMMIT;
