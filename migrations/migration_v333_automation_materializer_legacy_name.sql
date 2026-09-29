-- Repair the v171 -> v174 rename mismatch on linked production akachat.
-- Source of truth: snapshots/v333_automation_materializer_audit.json.
-- Only the internal callee changes; preserve the complete live definition/ACL.
-- No execution is requeued by this migration. No API metadata changes.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';

DO $patch$
DECLARE
  dependency record;
  v_oid oid;
  v_definition text;
  v_before_attributes jsonb;
  v_after_attributes jsonb;
  v_signature constant text := 'public.materialize_auto_automation_detail_v201_campaign_internal(bigint,bigint,bigint,text,jsonb,text,text)';
  v_source constant text := '28b69445644d47b5783a454f4d9e0f5b';
  v_target constant text := '065b56a4fb9319f1d394a7c8b526ebc2';
BEGIN
  -- These guards preserve the public serialization wrapper, optional-group
  -- routing, and the original materializer's tenant/claim/idempotency checks.
  FOR dependency IN SELECT * FROM (VALUES
    ('public.materialize_auto_automation_detail(bigint,bigint,bigint,text,jsonb,text,text)', '70ecb0b024d768971c85bb46b36b87e4'),
    ('public.materialize_auto_automation_detail_v188_serialized_internal(bigint,bigint,bigint,text,jsonb,text,text)', '63e0f156247f173dc3fd4ac5a18c8153'),
    ('public.materialize_auto_automation_detail_v171_internal(bigint,bigint,bigint,text,jsonb,text,text)', '2f020d76ddf37573512d72e98421efae')
  ) AS expected(signature, checksum) LOOP
    IF md5(pg_get_functiondef(to_regprocedure(dependency.signature))) IS DISTINCT FROM dependency.checksum THEN
      RAISE EXCEPTION 'v333 preflight: dependency missing or changed: %', dependency.signature;
    END IF;
  END LOOP;

  v_oid := to_regprocedure(v_signature);
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'v333 preflight: missing exact signature: %', v_signature;
  END IF;
  v_definition := pg_get_functiondef(v_oid);
  IF md5(v_definition) = v_target THEN
    RETURN;
  END IF;
  IF md5(v_definition) IS DISTINCT FROM v_source THEN
    RAISE EXCEPTION 'v333 preflight: unexpected live definition: %', v_signature;
  END IF;
  IF to_regprocedure('public.materialize_auto_automation_detail_v174_internal(bigint,bigint,bigint,text,jsonb,text,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'v333 preflight: v174 helper now exists; inspect before applying';
  END IF;

  SELECT jsonb_build_object('owner', proowner, 'security_definer', prosecdef,
    'volatility', provolatile, 'config', proconfig, 'acl', proacl)
  INTO v_before_attributes FROM pg_proc WHERE oid = v_oid;

  v_definition := replace(v_definition,
    'public.materialize_auto_automation_detail_v174_internal(',
    'public.materialize_auto_automation_detail_v171_internal(');
  IF md5(v_definition) IS DISTINCT FROM v_target THEN
    RAISE EXCEPTION 'v333 preflight: replacement does not match reviewed target';
  END IF;
  EXECUTE v_definition;

  SELECT jsonb_build_object('owner', proowner, 'security_definer', prosecdef,
    'volatility', provolatile, 'config', proconfig, 'acl', proacl)
  INTO v_after_attributes FROM pg_proc WHERE oid = v_oid;
  IF v_after_attributes IS DISTINCT FROM v_before_attributes
    OR md5(pg_get_functiondef(v_oid)) IS DISTINCT FROM v_target THEN
    RAISE EXCEPTION 'v333 verification: definition or attributes mismatch';
  END IF;
END;
$patch$;

-- Body-only correction: no explicit PostgREST schema reload is necessary.
COMMIT;
