-- v277: finalize non-Chat App Server group scans using the live account claim.
-- Audited akachat / cgjbsmqtfhqvttudyjzq on 2026-09-12.
-- Existing credential/core/claim RPC definitions and ACLs remain unchanged.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $preflight$
DECLARE
  dependency record;
  signature regprocedure;
  existing regprocedure := to_regprocedure(
    'public.aka_agent_finalize_zalo_server_contact_dataset(bigint,bigint,bigint,text,text,text,text,text,text,text,text[],jsonb,bigint,uuid)'
  );
BEGIN
  FOR dependency IN SELECT * FROM (VALUES
      ('public.aka_agent_finalize_contact_dataset(bigint,bigint,bigint,text,text,text,text,text,text,text,text[],jsonb,bigint)', 'fbf9566fb1e5e7d346980abf33362fba'),
      ('public.aka_agent_finalize_contact_dataset(bigint,bigint,bigint,text,text,text,text,text,text,text,text[],jsonb,bigint,text,text)', '8cda2541c0b811a8184c9b1adc29934c'),
      ('public.aka_agent_finalize_contact_dataset_v205_internal(bigint,bigint,bigint,text,text,text,text,text,text,text,text[],jsonb)', 'f5722a4b4554b0d496eb6cb3379f043f'),
      ('public.auto_assert_automation_identity(bigint,bigint,text,text)', '5a9a503db72b965eb644739f5f60905d'),
      ('public.claim_zalo_account_runtime_operation(bigint,bigint,text,boolean)', '8fa70359975cb87d842310131438b2d4'),
      ('public.claim_zalo_account_runtime_operation(bigint,bigint,text,text,uuid,boolean)', '78d5cdd05a02bdf3b78349e598e9d512'),
      ('public.release_zalo_account_runtime_operation(bigint,bigint,text,text)', 'c8962dc3218edc9c1a42567bd800ebaa'),
      ('public.release_zalo_account_runtime_operation(bigint,bigint,text,text,uuid)', 'b32f324928cef0699697f259b3899c75'),
      ('public.aka_agent_data_type_category_item_id(text,boolean)', 'eea298c08ec2e32418b1b0fa9d09b9d9'),
      ('public.aka_agent_derive_dataset_data_type(text,text,text,text,jsonb)', '0a5e6a2be4daf467a9ae37dffa1b19f1'),
      ('public.aka_agent_is_data_type_category_item(bigint,boolean)', 'cb109007927a56761bde7d53e40285dd'),
      ('public.resolve_organization_zalo_account_capabilities(bigint)', '46412e94cf00a788230835f6d56d8d3b')
  ) AS expected(signature, checksum)
  LOOP
    signature := to_regprocedure(dependency.signature);
    IF signature IS NULL OR md5(pg_get_functiondef(signature)) <> dependency.checksum THEN
      RAISE EXCEPTION 'v277_dependency_changed:%', dependency.signature;
    END IF;
  END LOOP;
  IF existing IS NOT NULL AND md5(pg_get_functiondef(existing)) <> 'c97300fa762faa37e7b931761a9b2abb' THEN
    RAISE EXCEPTION 'v277_server_finalizer_already_exists_with_different_definition';
  END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.aka_agent_finalize_zalo_server_contact_dataset(
  p_staff_id bigint,
  p_organization_id bigint,
  p_account_id bigint,
  p_scan_type text,
  p_contact_type text,
  p_source_key text,
  p_name text,
  p_link text,
  p_description text,
  p_status text,
  p_contact_uids text[],
  p_extra_data jsonb,
  p_data_type_category_item_id bigint,
  p_claim_token uuid
)
RETURNS SETOF public.auto_account_contacts_dataset
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
SET statement_timeout TO '60s'
AS $function$
DECLARE
  v_account public.auto_accounts%ROWTYPE;
  v_capabilities record;
  v_expected_type bigint;
BEGIN
  IF p_staff_id IS NULL OR p_staff_id <= 0
    OR p_organization_id IS NULL OR p_organization_id <= 0
    OR p_account_id IS NULL OR p_account_id <= 0
    OR p_claim_token IS NULL
  THEN
    RAISE EXCEPTION 'server_contact_dataset_claim_required';
  END IF;
  IF p_scan_type IS DISTINCT FROM 'zalo_group_members'
    OR p_contact_type IS DISTINCT FROM 'person'
  THEN
    RAISE EXCEPTION 'server_contact_dataset_scan_not_supported';
  END IF;

  -- Match claim lock order: staff, entitlement barrier, account.
  PERFORM 1 FROM public.org_staff AS staff
  WHERE staff.id = p_staff_id
    AND staff.organization_id = p_organization_id
    AND staff.is_active = true
  FOR SHARE OF staff;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'server_contact_dataset_staff_invalid';
  END IF;
  PERFORM pg_advisory_xact_lock_shared(
    hashtextextended('aka-agent-zalo-runtime-entitlement-mutation', 0)
  );
  SELECT * INTO v_capabilities
  FROM public.resolve_organization_zalo_account_capabilities(p_organization_id);
  IF NOT COALESCE(v_capabilities.qr_enabled, false)
    OR NOT COALESCE(v_capabilities.server_enabled, false)
  THEN
    RAISE EXCEPTION 'server_contact_dataset_runtime_not_owner';
  END IF;

  SELECT account.* INTO v_account
  FROM public.auto_accounts AS account
  WHERE account.id = p_account_id
    AND account.staff_id = p_staff_id
    AND account.organization_id = p_organization_id
    AND COALESCE(account.is_delete, false) = false
  FOR UPDATE OF account;
  IF NOT FOUND
    OR lower(btrim(COALESCE(v_account.flatform_type, ''))) <> 'zalo'
    OR v_account.is_zalo_server IS NOT TRUE
    OR v_account.is_zalo_show_web IS TRUE
    OR v_account.status IS DISTINCT FROM 'đang chạy'
    OR v_account.runtime_operation_claim_token IS DISTINCT FROM p_claim_token
  THEN
    RAISE EXCEPTION 'server_contact_dataset_claim_invalid';
  END IF;

  v_expected_type := public.aka_agent_data_type_category_item_id('zalo_person', true);
  IF v_expected_type IS NULL OR (p_data_type_category_item_id IS NOT NULL
    AND p_data_type_category_item_id <> v_expected_type)
  THEN
    RAISE EXCEPTION 'server_contact_dataset_data_type_invalid';
  END IF;

  -- Reuse the live v244 semantic core and v205 snapshot behavior. In particular,
  -- partial results merge, completed snapshots replace, and failed scans preserve members.
  RETURN QUERY SELECT * FROM public.aka_agent_finalize_contact_dataset(
    p_staff_id, p_organization_id, p_account_id,
    p_scan_type, p_contact_type, p_source_key, p_name, p_link, p_description,
    p_status, p_contact_uids, p_extra_data, v_expected_type
  );
END;
$function$;

ALTER FUNCTION public.aka_agent_finalize_zalo_server_contact_dataset(
  bigint,bigint,bigint,text,text,text,text,text,text,text,text[],jsonb,bigint,uuid
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.aka_agent_finalize_zalo_server_contact_dataset(
  bigint,bigint,bigint,text,text,text,text,text,text,text,text[],jsonb,bigint,uuid
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aka_agent_finalize_zalo_server_contact_dataset(
  bigint,bigint,bigint,text,text,text,text,text,text,text,text[],jsonb,bigint,uuid
) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.aka_agent_finalize_zalo_server_contact_dataset(
  bigint,bigint,bigint,text,text,text,text,text,text,text,text[],jsonb,bigint,uuid
) IS 'Finalize a Zalo Server group-member dataset under its live account-operation claim; no desktop credentials.';

DO $postflight$
DECLARE
  signature regprocedure := 'public.aka_agent_finalize_zalo_server_contact_dataset(bigint,bigint,bigint,text,text,text,text,text,text,text,text[],jsonb,bigint,uuid)'::regprocedure;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid = signature
      AND md5(pg_get_functiondef(p.oid)) = 'c97300fa762faa37e7b931761a9b2abb'
      AND pg_get_userbyid(p.proowner) = 'postgres'
      AND p.prosecdef AND p.provolatile = 'v'
      AND p.proconfig = ARRAY['search_path=pg_catalog, public', 'statement_timeout=60s']::text[]
      AND p.proacl::text = '{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'
  ) THEN RAISE EXCEPTION 'v277_target_metadata_mismatch'; END IF;
END;
$postflight$;

-- A new RPC signature must become visible to PostgREST after commit.
NOTIFY pgrst, 'reload schema';
COMMIT;
