-- Execute with v277 available. All fixture rows and writes are rolled back.
-- Only synthetic accounts/contacts are mutated; no Zalo session or campaign is used.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $smoke$
DECLARE
  v_owner record;
  v_account_id bigint;
  v_other_account_id bigint;
  v_token uuid := gen_random_uuid();
  v_other_token uuid := gen_random_uuid();
  v_claim jsonb;
  v_dataset public.auto_account_contacts_dataset%ROWTYPE;
  v_dataset_id bigint;
  v_source text := 'v277-smoke-' || txid_current()::text;
  v_type_id bigint := public.aka_agent_data_type_category_item_id('zalo_person', true);
  v_input jsonb;
  v_case record;
  v_error text;
  v_fn regprocedure := 'public.aka_agent_finalize_zalo_server_contact_dataset(bigint,bigint,bigint,text,text,text,text,text,text,text,text[],jsonb,bigint,uuid)'::regprocedure;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid = v_fn AND p.prosecdef
      AND p.provolatile = 'v' AND pg_get_userbyid(p.proowner) = 'postgres'
      AND p.proconfig = ARRAY['search_path=pg_catalog, public', 'statement_timeout=60s']::text[]
      AND p.proacl::text = '{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'
      AND md5(pg_get_functiondef(p.oid)) = 'c97300fa762faa37e7b931761a9b2abb'
  ) THEN RAISE EXCEPTION 'v277_smoke:function_metadata'; END IF;

  SELECT account.staff_id, account.organization_id INTO v_owner
  FROM public.auto_accounts account
  JOIN public.org_staff staff ON staff.id = account.staff_id
    AND staff.organization_id = account.organization_id AND staff.is_active = true
  CROSS JOIN LATERAL public.resolve_organization_zalo_account_capabilities(account.organization_id) caps
  WHERE account.is_zalo_server = true AND account.is_zalo_show_web = false
    AND account.is_delete = false AND caps.qr_enabled AND caps.server_enabled
  ORDER BY account.id LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'v277_smoke:no_server_tenant_fixture'; END IF;

  INSERT INTO public.auto_accounts(name, flatform_type, staff_id, organization_id,
    is_zalo_server, is_zalo_show_web, is_active, is_delete, login_status, status)
  VALUES (v_source, 'zalo', v_owner.staff_id, v_owner.organization_id,
    true, false, true, false, 'đã đăng nhập', 'tạm dừng') RETURNING id INTO v_account_id;
  INSERT INTO public.auto_accounts(name, flatform_type, staff_id, organization_id,
    is_zalo_server, is_zalo_show_web, is_active, is_delete, login_status, status)
  VALUES (v_source || '-other', 'zalo', v_owner.staff_id, v_owner.organization_id,
    true, false, true, false, 'đã đăng nhập', 'tạm dừng') RETURNING id INTO v_other_account_id;
  INSERT INTO public.auto_account_contacts(account_id, staff_id, organization_id,
    contact_type, name, uid, is_delete)
  VALUES (v_account_id, v_owner.staff_id, v_owner.organization_id, 'person', v_source, v_source || '-1', false),
         (v_account_id, v_owner.staff_id, v_owner.organization_id, 'person', v_source, v_source || '-2', false),
         (v_other_account_id, v_owner.staff_id, v_owner.organization_id, 'person', v_source, v_source || '-foreign', false);

  SET LOCAL ROLE anon;
  v_claim := public.claim_zalo_account_runtime_operation(v_account_id, v_owner.staff_id, 'server', 'tạm dừng', v_token, true);
  IF v_claim->>'claimed' <> 'true' OR v_claim->>'claim_token' <> v_token::text THEN
    RAISE EXCEPTION 'v277_smoke:claim_failed:%', v_claim->>'reason';
  END IF;
  -- The current token can repeat a claim, while a competing scan cannot take it.
  v_claim := public.claim_zalo_account_runtime_operation(v_account_id, v_owner.staff_id, 'server', 'tạm dừng', v_token, true);
  IF v_claim->>'claimed' <> 'true' THEN RAISE EXCEPTION 'v277_smoke:claim_retry'; END IF;
  v_claim := public.claim_zalo_account_runtime_operation(v_account_id, v_owner.staff_id, 'server', 'tạm dừng', v_other_token, true);
  IF v_claim->>'claimed' <> 'false' THEN RAISE EXCEPTION 'v277_smoke:claim_stolen'; END IF;

  SELECT * INTO v_dataset FROM public.aka_agent_finalize_zalo_server_contact_dataset(
    v_owner.staff_id,v_owner.organization_id,v_account_id,'zalo_group_members','person',v_source,v_source,
    NULL,NULL,'completed',ARRAY[v_source || '-1', v_source || '-1'],'{}'::jsonb,NULL,v_token);
  v_dataset_id := v_dataset.id;
  IF v_dataset_id IS NULL OR v_dataset.contact_count <> 1 OR v_dataset.data_type_category_item_id <> v_type_id THEN
    RAISE EXCEPTION 'v277_smoke:completed_dataset';
  END IF;
  SELECT * INTO v_dataset FROM public.aka_agent_finalize_zalo_server_contact_dataset(
    v_owner.staff_id,v_owner.organization_id,v_account_id,'zalo_group_members','person',v_source,v_source,
    NULL,NULL,'partial',ARRAY[v_source || '-2'],'{}'::jsonb,NULL,v_token);
  IF v_dataset.id <> v_dataset_id OR v_dataset.contact_count <> 2 OR v_dataset.last_scan_status <> 'partial' THEN
    RAISE EXCEPTION 'v277_smoke:partial_merge';
  END IF;
  SELECT * INTO v_dataset FROM public.aka_agent_finalize_zalo_server_contact_dataset(
    v_owner.staff_id,v_owner.organization_id,v_account_id,'zalo_group_members','person',v_source,v_source,
    NULL,NULL,'failed','{}'::text[],'{}'::jsonb,NULL,v_token);
  IF v_dataset.contact_count <> 2 OR v_dataset.last_scan_status <> 'failed' THEN
    RAISE EXCEPTION 'v277_smoke:failed_preserves_members';
  END IF;
  SELECT * INTO v_dataset FROM public.aka_agent_finalize_zalo_server_contact_dataset(
    v_owner.staff_id,v_owner.organization_id,v_account_id,'zalo_group_members','person',v_source,v_source,
    NULL,NULL,'completed',ARRAY[v_source || '-2'],'{}'::jsonb,NULL,v_token);
  IF v_dataset.contact_count <> 1 THEN RAISE EXCEPTION 'v277_smoke:completed_replaces'; END IF;

  v_input := jsonb_build_object('staff',v_owner.staff_id,'organization',v_owner.organization_id,
    'account',v_account_id,'token',v_token,'scan','zalo_group_members','type','person','semantic',v_type_id,
    'uids',jsonb_build_array(v_source || '-2'));
  FOR v_case IN SELECT * FROM (VALUES
    ('missing token', jsonb_build_object('token',NULL), 'server_contact_dataset_claim_required'),
    ('wrong token', jsonb_build_object('token',v_other_token), 'server_contact_dataset_claim_invalid'),
    ('wrong account', jsonb_build_object('account',v_other_account_id), 'server_contact_dataset_claim_invalid'),
    ('wrong staff', jsonb_build_object('staff',9223372036854775807::bigint), 'server_contact_dataset_staff_invalid'),
    ('wrong organization', jsonb_build_object('organization',9223372036854775807::bigint), 'server_contact_dataset_staff_invalid'),
    ('wrong scan', jsonb_build_object('scan','facebook_group_members'), 'server_contact_dataset_scan_not_supported'),
    ('wrong contact type', jsonb_build_object('type','group'), 'server_contact_dataset_scan_not_supported'),
    ('wrong semantic', jsonb_build_object('semantic',0), 'server_contact_dataset_data_type_invalid'),
    ('foreign contact', jsonb_build_object('uids',jsonb_build_array(v_source || '-foreign')), 'contact_dataset_contacts_not_found')
  ) AS cases(name, patch, expected)
  LOOP
    BEGIN
      PERFORM public.aka_agent_finalize_zalo_server_contact_dataset(
        ((v_input || v_case.patch)->>'staff')::bigint,
        ((v_input || v_case.patch)->>'organization')::bigint,
        ((v_input || v_case.patch)->>'account')::bigint,
        (v_input || v_case.patch)->>'scan', (v_input || v_case.patch)->>'type',v_source,v_source,
        NULL,NULL,'completed',ARRAY(SELECT jsonb_array_elements_text((v_input || v_case.patch)->'uids')),
        '{}'::jsonb,((v_input || v_case.patch)->>'semantic')::bigint,
        ((v_input || v_case.patch)->>'token')::uuid);
      RAISE EXCEPTION 'v277_smoke:accepted_invalid_case:%',v_case.name;
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
      IF v_error <> v_case.expected THEN RAISE EXCEPTION 'v277_smoke:case:%:%',v_case.name,v_error; END IF;
    END;
  END LOOP;

  -- The new entrypoint must not relax Desktop credential checks or core ACLs.
  BEGIN
    PERFORM public.aka_agent_finalize_contact_dataset(v_owner.staff_id,v_owner.organization_id,v_account_id,
      'zalo_group_members','person',v_source,v_source,NULL,NULL,'completed','{}'::text[],'{}'::jsonb,NULL,NULL,NULL);
    RAISE EXCEPTION 'v277_smoke:desktop_auth_bypassed';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
    IF v_error <> 'automation_auth_required' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.aka_agent_finalize_contact_dataset(v_owner.staff_id,v_owner.organization_id,v_account_id,
      'zalo_group_members','person',v_source,v_source,NULL,NULL,'completed','{}'::text[],'{}'::jsonb,NULL);
    RAISE EXCEPTION 'v277_smoke:core_acl_bypassed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  IF public.release_zalo_account_runtime_operation(v_account_id,v_owner.staff_id,'server','tạm dừng',v_other_token) THEN
    RAISE EXCEPTION 'v277_smoke:wrong_token_release';
  END IF;
  IF NOT public.release_zalo_account_runtime_operation(v_account_id,v_owner.staff_id,'server','tạm dừng',v_token) THEN
    RAISE EXCEPTION 'v277_smoke:release_failed';
  END IF;
  BEGIN
    PERFORM public.aka_agent_finalize_zalo_server_contact_dataset(v_owner.staff_id,v_owner.organization_id,v_account_id,
      'zalo_group_members','person',v_source,v_source,NULL,NULL,'completed','{}'::text[],'{}'::jsonb,NULL,v_token);
    RAISE EXCEPTION 'v277_smoke:released_token_accepted';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
    IF v_error <> 'server_contact_dataset_claim_invalid' THEN RAISE; END IF;
  END;
  RESET ROLE;
  IF NOT EXISTS (SELECT 1 FROM public.auto_accounts WHERE id=v_account_id
    AND status='tạm dừng' AND runtime_operation_claim_token IS NULL) THEN
    RAISE EXCEPTION 'v277_smoke:account_not_restored';
  END IF;
  -- Change only the synthetic account through the normal tokenized subtype guard.
  SET LOCAL ROLE anon;
  v_claim := public.claim_zalo_account_runtime_operation(v_account_id,v_owner.staff_id,'server','tạm dừng',v_other_token,true);
  IF v_claim->>'claimed' <> 'true' THEN RAISE EXCEPTION 'v277_smoke:subtype_claim'; END IF;
  BEGIN
    PERFORM public.aka_agent_finalize_zalo_server_contact_dataset(v_owner.staff_id,v_owner.organization_id,v_account_id,
      'zalo_group_members','person',v_source,v_source,NULL,NULL,'completed','{}'::text[],'{}'::jsonb,NULL,v_token);
    RAISE EXCEPTION 'v277_smoke:stale_token_accepted';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
    IF v_error <> 'server_contact_dataset_claim_invalid' THEN RAISE; END IF;
  END;
  RESET ROLE;
  -- A former Server owner cannot finalize after the account becomes local.
  UPDATE public.auto_accounts SET is_zalo_server=false
  WHERE id=v_account_id;
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM public.aka_agent_finalize_zalo_server_contact_dataset(v_owner.staff_id,v_owner.organization_id,v_account_id,
      'zalo_group_members','person',v_source,v_source,NULL,NULL,'completed','{}'::text[],'{}'::jsonb,NULL,v_other_token);
    RAISE EXCEPTION 'v277_smoke:local_account_accepted';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
    IF v_error <> 'server_contact_dataset_claim_invalid' THEN RAISE; END IF;
  END;
  RESET ROLE;
END;
$smoke$;

SELECT 'v277 scan dataset, tenant/claim guards, snapshot semantics and unchanged Desktop auth passed' AS result;
ROLLBACK;
