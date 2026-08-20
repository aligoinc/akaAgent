BEGIN;

DO $smoke$
DECLARE
  v_finalize_signature regprocedure := pg_catalog.to_regprocedure(
    'public.aka_agent_finalize_contact_dataset(bigint,bigint,bigint,text,text,text,text,text,text,text,text[],jsonb,bigint)'
  );
  v_platform_signature regprocedure := pg_catalog.to_regprocedure(
    'public.aka_agent_stamp_account_contact_platform()'
  );
  v_finalize_checksum text;
  v_platform_checksum text;
  v_account record;
  v_dataset public.auto_account_contacts_dataset%ROWTYPE;
  v_contact_platform text;
  v_previous_context text;
  v_expected_type bigint := public.aka_agent_data_type_category_item_id('zalo_person');
  v_smoke_uid text := 'v244-smoke-' || pg_catalog.txid_current()::text;
BEGIN
  IF v_finalize_signature IS NULL OR v_platform_signature IS NULL THEN
    RAISE EXCEPTION 'v244_smoke:missing_function';
  END IF;

  SELECT pg_catalog.md5(pg_catalog.pg_get_functiondef(fn.oid))
  INTO v_finalize_checksum
  FROM pg_catalog.pg_proc AS fn
  WHERE fn.oid = v_finalize_signature;
  SELECT pg_catalog.md5(pg_catalog.pg_get_functiondef(fn.oid))
  INTO v_platform_checksum
  FROM pg_catalog.pg_proc AS fn
  WHERE fn.oid = v_platform_signature;
  IF v_finalize_checksum <> 'fbf9566fb1e5e7d346980abf33362fba'
    OR v_platform_checksum <> '6559974e86d24c818b2b1b1326184dc7'
  THEN
    RAISE EXCEPTION
      'v244_smoke:function_checksum finalize=% platform=%',
      v_finalize_checksum, v_platform_checksum;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS fn
    WHERE fn.oid = v_finalize_signature
      AND pg_catalog.pg_get_userbyid(fn.proowner) = 'postgres'
      AND fn.prosecdef
      AND fn.provolatile = 'v'
      AND fn.proconfig IS NOT DISTINCT FROM
        ARRAY['search_path=pg_catalog, public']::text[]
      AND fn.proacl::text = '{postgres=X/postgres,service_role=X/postgres}'
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS fn
    WHERE fn.oid = v_platform_signature
      AND pg_catalog.pg_get_userbyid(fn.proowner) = 'postgres'
      AND fn.prosecdef
      AND fn.provolatile = 'v'
      AND fn.proconfig IS NOT DISTINCT FROM
        ARRAY['search_path=pg_catalog, public']::text[]
      AND fn.proacl::text = '{postgres=X/postgres,service_role=X/postgres}'
  ) THEN
    RAISE EXCEPTION 'v244_smoke:function_metadata';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger AS trigger_row
    WHERE trigger_row.tgrelid = 'public.auto_account_contacts'::regclass
      AND trigger_row.tgname = 'trg_aka_agent_stamp_account_contact_platform'
      AND trigger_row.tgfoid = v_platform_signature::oid
      AND trigger_row.tgenabled = 'O'
      AND NOT trigger_row.tgisinternal
  ) THEN
    RAISE EXCEPTION 'v244_smoke:platform_trigger';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.auto_account_contacts_dataset AS dataset
    WHERE dataset.source = 'scan'
      AND dataset.is_delete = false
      AND dataset.data_type_category_item_id IS NULL
      AND public.aka_agent_derive_dataset_data_type(
        dataset.source,
        dataset.flatform_type,
        dataset.contact_type,
        dataset.scan_type,
        dataset.extra_data
      ) IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'v244_smoke:deriveable_scan_dataset_untyped';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.auto_account_contacts AS contact
    JOIN public.auto_accounts AS account
      ON account.id = contact.account_id
     AND account.staff_id = contact.staff_id
     AND account.organization_id IS NOT DISTINCT FROM contact.organization_id
    WHERE contact.is_delete = false
      AND contact.flatform_type IS NULL
      AND contact.contact_type IN ('person', 'group', 'page', 'page_inbox_customer')
      AND lower(btrim(COALESCE(account.flatform_type, ''))) IN ('facebook', 'zalo')
  ) THEN
    RAISE EXCEPTION 'v244_smoke:account_bound_contact_platform_null';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.auto_account_contact_group_members AS member
    JOIN public.auto_account_contacts AS contact ON contact.id = member.contact_id
    WHERE member.is_delete = false
      AND contact.is_delete = false
      AND contact.flatform_type = 'zalo'
      AND contact.contact_type = 'person'
      AND EXISTS (
        SELECT 1
        FROM public.zalo_group_members AS relation
        WHERE relation.account_id = contact.account_id
          AND relation.staff_id = contact.staff_id
          AND relation.organization_id IS NOT DISTINCT FROM contact.organization_id
          AND relation.zalo_uid = contact.uid
          AND relation.is_current = true
      )
      AND EXISTS (
        SELECT 1
        FROM public.auto_account_contact_group_member_origins AS scan_origin
        WHERE scan_origin.membership_id = member.id
          AND scan_origin.kind = 'scan'
          AND scan_origin.is_current = true
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.auto_account_contact_group_member_origins AS proof_origin
        WHERE proof_origin.membership_id = member.id
          AND proof_origin.source_account_id = contact.account_id
          AND proof_origin.relationship_kind = 'zalo_group_members'
          AND proof_origin.is_current = true
      )
  ) THEN
    RAISE EXCEPTION 'v244_smoke:provable_relationship_missing';
  END IF;

  SELECT account.id, account.staff_id, account.organization_id
  INTO v_account
  FROM public.auto_accounts AS account
  WHERE lower(btrim(COALESCE(account.flatform_type, ''))) = 'zalo'
    AND account.is_delete = false
  ORDER BY account.id
  LIMIT 1;
  IF v_account.id IS NULL THEN
    RAISE EXCEPTION 'v244_smoke:no_zalo_account_fixture';
  END IF;

  v_previous_context := current_setting(
    'aka_agent.data_type_category_item_id', true
  );

  INSERT INTO public.auto_account_contacts (
    account_id, contact_type, name, uid, flatform_type, is_delete,
    staff_id, organization_id, created_at, updated_at
  ) VALUES (
    v_account.id,
    'person',
    'v244 platform smoke',
    v_smoke_uid,
    NULL,
    false,
    v_account.staff_id,
    v_account.organization_id,
    clock_timestamp(),
    clock_timestamp()
  )
  RETURNING flatform_type INTO v_contact_platform;
  IF v_contact_platform IS DISTINCT FROM 'zalo' THEN
    RAISE EXCEPTION 'v244_smoke:platform_not_stamped:%', v_contact_platform;
  END IF;

  SELECT finalized.*
  INTO v_dataset
  FROM public.aka_agent_finalize_contact_dataset(
    v_account.staff_id,
    v_account.organization_id,
    v_account.id,
    'zalo_group_members',
    'person',
    v_smoke_uid,
    'v244 semantic smoke',
    NULL,
    NULL,
    'completed',
    ARRAY[v_smoke_uid]::text[],
    '{}'::jsonb,
    NULL
  ) AS finalized;
  IF v_dataset.data_type_category_item_id IS DISTINCT FROM v_expected_type THEN
    RAISE EXCEPTION
      'v244_smoke:derived_type expected=% actual=%',
      v_expected_type, v_dataset.data_type_category_item_id;
  END IF;
  IF current_setting('aka_agent.data_type_category_item_id', true)
    IS DISTINCT FROM COALESCE(v_previous_context, '')
  THEN
    RAISE EXCEPTION 'v244_smoke:guc_not_restored';
  END IF;

END;
$smoke$;

ROLLBACK;
