-- V596: fanpage Facebook dùng akaChat (hộp thư Chat Web) như tài khoản Zalo; mỗi Page chiếm một suất akaChat.
-- SINH TỪ scripts/build-v596-sql.cjs, không sửa tay. Thay thân hai hàm (giữ chữ ký, chủ sở hữu, quyền, thuộc tính):
-- - aka_agent_app_access_account_allowed: nhánh akaChat nhận thêm flatform_type 'facebook_page';
-- - private.app_access_validate_account: với 'facebook_page' bỏ các bước chỉ Zalo có (phiên Desktop, giữ chỗ UID Zalo); gói và suất
--   akaChat vẫn kiểm như mọi tài khoản.
-- Không có dòng auto_accounts 'facebook_page' nào trước khi Chat API bản fanpage chạy, nên hành vi với dữ liệu hiện có không đổi.
-- Nguồn = pg_get_functiondef production 20/11/2026: allowed 410005b7e2720a1db565acfcd8c7e197, validate f9f8f66c263a45c7196808f1781a64cf.
-- Bản mới: allowed 15578db6836e492ecd7279577d15519c, validate 343293b52b9eae719e8f6ab29da459a1.
-- DDL làm PostgREST nạp lại schema: apply ngoài giờ cao điểm. Gỡ: rollback_v596_chat_facebook_page_access.sql.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
DECLARE v_oid oid; v_md5 text; v_acl text;
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v596_%') THEN
      RAISE EXCEPTION 'V596 đã có trong sổ migration, không chạy lại';
    END IF;
  END IF;
  v_oid := to_regprocedure('public.aka_agent_app_access_account_allowed(bigint,text)');
  IF v_oid IS NULL THEN RAISE EXCEPTION 'V596: không có public.aka_agent_app_access_account_allowed(bigint,text)'; END IF;
  v_md5 := md5(pg_get_functiondef(v_oid));
  IF v_md5 = '15578db6836e492ecd7279577d15519c' THEN RAISE EXCEPTION 'V596: allowed đã là bản đích'; END IF;
  IF v_md5 IS DISTINCT FROM '410005b7e2720a1db565acfcd8c7e197' THEN RAISE EXCEPTION 'V596: định nghĩa allowed khác bản đã đối chiếu (%)', v_md5; END IF;
  SELECT coalesce(p.proacl::text, '') || '|' || pg_get_userbyid(p.proowner) || '|' || p.prosecdef::text || '|' || p.provolatile::text
    || '|' || coalesce(array_to_string(p.proconfig, ','), '') INTO v_acl FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;
  PERFORM set_config('aka.v596_meta_allowed', v_acl, true);
  v_oid := to_regprocedure('private.app_access_validate_account(public.auto_accounts,public.auto_accounts)');
  IF v_oid IS NULL THEN RAISE EXCEPTION 'V596: không có private.app_access_validate_account(public.auto_accounts,public.auto_accounts)'; END IF;
  v_md5 := md5(pg_get_functiondef(v_oid));
  IF v_md5 = '343293b52b9eae719e8f6ab29da459a1' THEN RAISE EXCEPTION 'V596: validate đã là bản đích'; END IF;
  IF v_md5 IS DISTINCT FROM 'f9f8f66c263a45c7196808f1781a64cf' THEN RAISE EXCEPTION 'V596: định nghĩa validate khác bản đã đối chiếu (%)', v_md5; END IF;
  SELECT coalesce(p.proacl::text, '') || '|' || pg_get_userbyid(p.proowner) || '|' || p.prosecdef::text || '|' || p.provolatile::text
    || '|' || coalesce(array_to_string(p.proconfig, ','), '') INTO v_acl FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;
  PERFORM set_config('aka.v596_meta_validate', v_acl, true);
END $pre$;

CREATE OR REPLACE FUNCTION public.aka_agent_app_access_account_allowed(p_account bigint, p_app text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
  SELECT COALESCE((SELECT CASE WHEN NOT public.aka_agent_app_access_separate(s.organization_id) THEN true ELSE
    NOT COALESCE(a.is_delete,false) AND s.deleted_at IS NULL
    AND (a.organization_id IS NULL OR a.organization_id=s.organization_id)
    AND CASE p_app WHEN 'akaAgent' THEN a.is_aka_agent_enabled
        AND s.is_active=true AND s.is_aka_agent_enabled
        AND private.app_access_staff_time_allowed(s.id)
        AND EXISTS(SELECT 1 FROM private.app_access_packages(s.organization_id,'akaAgent',lower(a.flatform_type)))
        AND (lower(a.flatform_type)<>'zalo' OR EXISTS(SELECT 1 FROM private.resolve_organization_zalo_entitlement_pools(s.organization_id) p
          WHERE p.entitlement_id IS NOT NULL AND p.account_subtype=CASE WHEN a.is_zalo_show_web THEN 'web' WHEN a.is_zalo_server THEN 'server' ELSE 'qr' END))
      -- Fanpage Facebook (Chat API nhận tin qua webhook Meta) dùng akaChat như tài khoản Zalo; Zalo trình duyệt thì không.
      WHEN 'akaChat' THEN a.is_akachat_enabled
        AND ((lower(a.flatform_type)='zalo' AND NOT COALESCE(a.is_zalo_show_web,false)) OR lower(a.flatform_type)='facebook_page')
        AND EXISTS(SELECT 1 FROM private.app_access_packages(s.organization_id,'akaChat'))
      ELSE false END END FROM public.auto_accounts a JOIN public.org_staff s ON s.id=a.staff_id
    WHERE a.id=p_account),false)
$function$
;

CREATE OR REPLACE FUNCTION private.app_access_validate_account(n auto_accounts, o auto_accounts DEFAULT NULL::auto_accounts)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
DECLARE owner_row public.org_staff%ROWTYPE; q jsonb; used integer; app_name text; assigned boolean; previous boolean; uid text; binding_org bigint;
BEGIN
  SELECT * INTO owner_row FROM public.org_staff WHERE id=n.staff_id;
  IF NOT public.aka_agent_app_access_separate(owner_row.organization_id) OR COALESCE(n.is_delete,false) THEN RETURN; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('control-zalo-account:'||n.staff_id::text,0));
  FOREACH app_name IN ARRAY ARRAY['akaAgent','akaChat'] LOOP
    assigned:=CASE app_name WHEN 'akaAgent' THEN n.is_aka_agent_enabled ELSE n.is_akachat_enabled END;
    previous:=CASE app_name WHEN 'akaAgent' THEN o.is_aka_agent_enabled ELSE o.is_akachat_enabled END;
    IF NOT assigned OR (previous AND NOT COALESCE(o.is_delete,false)
      AND o.staff_id=n.staff_id AND o.organization_id IS NOT DISTINCT FROM n.organization_id
      AND o.flatform_type IS NOT DISTINCT FROM n.flatform_type
      AND o.is_zalo_show_web IS NOT DISTINCT FROM n.is_zalo_show_web
      AND o.is_zalo_server IS NOT DISTINCT FROM n.is_zalo_server) THEN CONTINUE; END IF;
    -- Server Chat can be granted by an authorized actor while its owner is locked/expired.
    -- Agent and local QR still require an active, unexpired owner; keep tenant/deletion guards.
    IF owner_row.id IS NULL OR owner_row.deleted_at IS NOT NULL
      OR (n.organization_id IS NOT NULL AND n.organization_id IS DISTINCT FROM owner_row.organization_id)
      OR ((app_name='akaAgent' OR NOT COALESCE(n.is_zalo_server,false))
        AND NOT private.app_access_staff_time_allowed(owner_row.id))
      THEN RAISE EXCEPTION 'app_access_denied'; END IF;
    q:=private.app_access_quota(owner_row.organization_id,n.staff_id,app_name,'account',lower(n.flatform_type));
    IF NOT (q->>'hasPackage')::boolean THEN RAISE EXCEPTION 'app_access_package_required'; END IF;
    SELECT count(*) INTO used FROM public.auto_accounts a WHERE a.staff_id=n.staff_id AND a.id IS DISTINCT FROM n.id
      AND NOT COALESCE(a.is_delete,false) AND (a.organization_id IS NULL OR a.organization_id=owner_row.organization_id)
      AND CASE app_name WHEN 'akaAgent' THEN a.is_aka_agent_enabled AND lower(a.flatform_type)=lower(n.flatform_type) ELSE a.is_akachat_enabled END;
    IF q->>'limit' IS NOT NULL AND used >= (q->>'limit')::integer THEN RAISE EXCEPTION 'app_access_account_limit'; END IF;
    IF app_name='akaAgent' THEN
      IF NOT public.aka_agent_app_access_staff_allowed(n.staff_id,'akaAgent') THEN RAISE EXCEPTION 'app_access_owner_agent_required'; END IF;
      IF lower(n.flatform_type)='zalo' AND NOT EXISTS(SELECT 1 FROM private.resolve_organization_zalo_entitlement_pools(owner_row.organization_id) p
        WHERE p.entitlement_id IS NOT NULL AND p.account_subtype=CASE WHEN n.is_zalo_show_web THEN 'web' WHEN n.is_zalo_server THEN 'server' ELSE 'qr' END)
        THEN RAISE EXCEPTION 'zalo_account_capability_unavailable'; END IF;
    ELSIF lower(n.flatform_type)='facebook_page' THEN
      -- Fanpage Facebook: không có phiên Zalo hay máy Desktop đọc tin, không có UID Zalo để giữ chỗ. Chat API giữ mỗi Page cho
      -- đúng một tổ chức (chat_zalo_account zalo_id 'fb:<page>', một binding mỗi tổ chức). Gói và suất akaChat đã kiểm ở trên.
      NULL;
    ELSE
      IF lower(n.flatform_type)<>'zalo' OR COALESCE(n.is_zalo_show_web,false) THEN RAISE EXCEPTION 'app_access_zalo_only'; END IF;
      IF NOT COALESCE(n.is_zalo_server,false) AND NOT public.aka_agent_app_access_staff_allowed(n.staff_id,'akaAgent')
        THEN RAISE EXCEPTION 'app_access_local_reader_required'; END IF;
      -- Match the Chat account list: a retained Chat binding is the canonical identity.
      SELECT z.zalo_id,b.organization_id INTO uid,binding_org
        FROM public.chat_zalo_account_organization b JOIN public.chat_zalo_account z ON z.id=b.chat_zalo_account_id
        WHERE b.auto_account_id=n.id;
      IF FOUND THEN
        IF binding_org IS DISTINCT FROM owner_row.organization_id THEN RAISE EXCEPTION 'app_access_denied'; END IF;
      ELSIF n.login_status='đã đăng nhập' THEN
        -- Unbound, live sessions still reserve their identity atomically on enable.
        -- Logged-out legacy IDs are stale metadata, not a completed Chat link.
        SELECT z.zalo_uid INTO uid FROM public.zalo_accounts z WHERE z.id=n.zalo_account_id;
      END IF;
      IF uid IS NOT NULL THEN
        -- Same identity lock as Chat API QR completion, never another UNIQUE or identity record.
        PERFORM pg_advisory_xact_lock(hashtextextended(owner_row.organization_id::text||':'||uid,0));
        IF EXISTS(SELECT 1 FROM public.chat_zalo_account_organization b JOIN public.chat_zalo_account z ON z.id=b.chat_zalo_account_id
          JOIN public.auto_accounts bound ON bound.id=b.auto_account_id
          WHERE b.organization_id=owner_row.organization_id AND z.zalo_id=uid AND b.auto_account_id<>n.id AND NOT COALESCE(bound.is_delete,false))
          THEN RAISE EXCEPTION 'zalo_already_linked'; END IF;
        IF EXISTS(SELECT 1 FROM public.chat_zalo_account_organization b JOIN public.chat_zalo_account z ON z.id=b.chat_zalo_account_id
          WHERE b.auto_account_id=n.id AND z.zalo_id<>uid) THEN RAISE EXCEPTION 'account_already_has_another_zalo'; END IF;
      END IF;
    END IF;
  END LOOP;
END $function$
;

DO $post$
DECLARE v_oid oid; v_acl text;
BEGIN
  v_oid := 'public.aka_agent_app_access_account_allowed(bigint,text)'::regprocedure;
  IF md5(pg_get_functiondef(v_oid)) IS DISTINCT FROM '15578db6836e492ecd7279577d15519c' THEN
    RAISE EXCEPTION 'V596 postflight: định nghĩa allowed %', md5(pg_get_functiondef(v_oid));
  END IF;
  SELECT coalesce(p.proacl::text, '') || '|' || pg_get_userbyid(p.proowner) || '|' || p.prosecdef::text || '|' || p.provolatile::text
    || '|' || coalesce(array_to_string(p.proconfig, ','), '') INTO v_acl FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;
  IF v_acl IS DISTINCT FROM current_setting('aka.v596_meta_allowed', true) THEN
    RAISE EXCEPTION 'V596 postflight: quyền / chủ sở hữu / thuộc tính allowed bị đổi';
  END IF;
  v_oid := 'private.app_access_validate_account(public.auto_accounts,public.auto_accounts)'::regprocedure;
  IF md5(pg_get_functiondef(v_oid)) IS DISTINCT FROM '343293b52b9eae719e8f6ab29da459a1' THEN
    RAISE EXCEPTION 'V596 postflight: định nghĩa validate %', md5(pg_get_functiondef(v_oid));
  END IF;
  SELECT coalesce(p.proacl::text, '') || '|' || pg_get_userbyid(p.proowner) || '|' || p.prosecdef::text || '|' || p.provolatile::text
    || '|' || coalesce(array_to_string(p.proconfig, ','), '') INTO v_acl FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;
  IF v_acl IS DISTINCT FROM current_setting('aka.v596_meta_validate', true) THEN
    RAISE EXCEPTION 'V596 postflight: quyền / chủ sở hữu / thuộc tính validate bị đổi';
  END IF;
END $post$;

COMMIT;
