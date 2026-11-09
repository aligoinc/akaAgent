-- Rollback V483: trả 2 wrapper Desktop của aka_agent_ingest_data_group về đúng thân trước V483 (md5 d3ba6d79…,
-- 9a75506b…) rồi xoá private.aka_agent_assert_data_group_ingest_budget. Chỉ chạy khi wrapper đang đúng bản V483
-- (không ghi đè thay đổi mới hơn). ACL/owner/SET giữ nguyên. DDL ⇒ PostgREST nạp lại schema, chạy ngoài giờ cao điểm.
BEGIN;
SET LOCAL lock_timeout = '3s';

DO $v483_rollback_preflight$
BEGIN
  IF (SELECT count(*) FROM pg_proc p
      WHERE (p.oid = to_regprocedure('public.aka_agent_ingest_data_group(bigint,bigint,text,bigint,text,jsonb,bigint,text,text,bigint,text,text,text,text)')
             AND md5(p.prosrc) = 'f324434527d755f005a9f2f3744643d0')
         OR (p.oid = to_regprocedure('public.aka_agent_ingest_data_group(bigint,bigint,text,bigint,text,jsonb,bigint,text,text,bigint,text,text,bigint,text,text)')
             AND md5(p.prosrc) = '901b27e30590aa0f522bcf8b6a805bb7')) <> 2 THEN
    RAISE EXCEPTION 'v483 rollback: Desktop wrappers are not the V483 version; re-read live definitions';
  END IF;
  IF to_regprocedure('private.aka_agent_assert_data_group_ingest_budget(bigint,bigint,text,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'v483 rollback: guard function missing';
  END IF;
END
$v483_rollback_preflight$;

CREATE OR REPLACE FUNCTION public.aka_agent_ingest_data_group(p_staff_id bigint, p_organization_id bigint, p_request_id text, p_group_id bigint, p_kind text, p_rows jsonb, p_dataset_id bigint, p_dataset_name text, p_import_source text, p_source_account_id bigint, p_source_name text, p_payload_hash text, p_auth_username text, p_auth_password text)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET statement_timeout TO '60s'
AS $function$
  SELECT public.auto_assert_automation_identity(
    p_staff_id, p_organization_id, p_auth_username, p_auth_password
  );
  SELECT * FROM public.aka_agent_ingest_data_group(p_staff_id, p_organization_id, p_request_id, p_group_id, p_kind, p_rows, p_dataset_id, p_dataset_name, p_import_source, p_source_account_id, p_source_name, p_payload_hash);
$function$;

CREATE OR REPLACE FUNCTION public.aka_agent_ingest_data_group(p_staff_id bigint, p_organization_id bigint, p_request_id text, p_group_id bigint, p_kind text, p_rows jsonb, p_dataset_id bigint, p_dataset_name text, p_import_source text, p_source_account_id bigint, p_source_name text, p_payload_hash text, p_data_type_category_item_id bigint, p_auth_username text, p_auth_password text)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET statement_timeout TO '60s'
AS $function$
  SELECT public.auto_assert_automation_identity(
    p_staff_id, p_organization_id, p_auth_username, p_auth_password
  );
  SELECT public.aka_agent_ingest_data_group(
    p_staff_id,
    p_organization_id,
    p_request_id,
    p_group_id,
    p_kind,
    p_rows,
    p_dataset_id,
    p_dataset_name,
    p_import_source,
    p_source_account_id,
    p_source_name,
    p_payload_hash,
    p_data_type_category_item_id
  );
$function$;

DROP FUNCTION private.aka_agent_assert_data_group_ingest_budget(bigint, bigint, text, jsonb);

DO $v483_rollback_postflight$
BEGIN
  IF (SELECT count(*) FROM pg_proc p
      WHERE ((p.oid = to_regprocedure('public.aka_agent_ingest_data_group(bigint,bigint,text,bigint,text,jsonb,bigint,text,text,bigint,text,text,text,text)')
              AND md5(p.prosrc) = 'd3ba6d794b51ef41a6af705920cab7af')
          OR (p.oid = to_regprocedure('public.aka_agent_ingest_data_group(bigint,bigint,text,bigint,text,jsonb,bigint,text,text,bigint,text,text,bigint,text,text)')
              AND md5(p.prosrc) = '9a75506b8a5a2ddc197052bfc725cb7f'))
        AND p.proacl::text = '{postgres=X/postgres,service_role=X/postgres,aka_agent_desktop=X/postgres}'
        AND p.prosecdef AND p.proconfig::text = '{"search_path=pg_catalog, public",statement_timeout=60s}') <> 2 THEN
    RAISE EXCEPTION 'v483 rollback: wrappers not restored exactly';
  END IF;
END
$v483_rollback_postflight$;

COMMIT;
