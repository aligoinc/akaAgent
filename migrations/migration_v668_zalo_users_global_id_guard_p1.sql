-- V668 p1 (26/11/2026): chặn ghi Global ID của CHÍNH nick đang xem vào zalo_users.
-- Nguyên nhân (đo production 26/11, chỉ đọc): hồ sơ thành viên nhóm Zalo (/api/social/group/members) trả globalId của nick đang xem;
-- Desktop (accountContactRepository.upsertZaloUsersForGroupMembers, mọi bản từ 2.2.0 — 22/06/2026) và WebApp (aka-agent-control.dataScan
-- saveGroupMembers) chép vào global_id và còn đè Global ID đúng đã có. 1.188.119 / 6.158.201 dòng có Global ID (19,3%) mang Global ID của
-- nick, 1.062 tài khoản; 48 giờ tới 16:4x VN 26/11 còn ghi thêm 40.216 dòng sai (Desktop 9.2.0 → 10.6.0, WebApp).
-- Trigger chặn ở DB để bản app cũ / WebApp / ChatApi chưa sửa không ghi lại được (code đã sửa ở nhánh claude/zalo-users-global-id-426088):
--   - Global ID ghi vào (INSERT, hoặc UPDATE đổi giá trị) bị coi là của người xem khi: (a) dòng chỉ có dữ liệu quét nhóm (raw_payload có
--     zaloGroupId, không có khoá hồ sơ userId / username / bizPkg / phoneNumber) và Global ID trùng raw_payload.globalId (hoặc raw không
--     ghi); (b) raw_payload là hồ sơ ghi Global ID khác (quét nhóm đè — Desktop / WebApp giữ raw cũ, chỉ đổi cột); (c) Global ID là của
--     chính nick (private.aka_agent_zalo_own_global_ids); trừ dòng của chính nick. Nơi ghi đúng (bạn bè, tra số, đọc hồ sơ — Desktop,
--     WebApp, ChatApi) ghi cột và raw_payload cùng một hồ sơ nên không bị chặn.
--   - Khi đó giữ Global ID đang có của dòng (UPDATE: OLD; INSERT của upsert: dòng (tài khoản, Zalo ID) đã có — để phần ON CONFLICT DO
--     UPDATE SET global_id = EXCLUDED.global_id của Desktop / WebApp không đè NULL lên Global ID đúng), nếu giá trị đó không cũng là của
--     người xem; không thì để trống.
--   - Bỏ qua trong một giao dịch: SELECT set_config('aka.zalo_gid_guard', 'off', true) (hoàn tác sửa dữ liệu).
-- Thêm private.aka_agent_zalo_user_gid_trusted (dòng có Global ID tin được, dùng cho hàm so khớp ở p2) và private.aka_agent_zalo_own_uids.
-- Kiểm: scripts/zalo-users-gid-guard-smoke.cjs. Gỡ: migrations/rollback_v668_zalo_users_global_id_guard_p1.sql.
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $pre$
BEGIN
 IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v668_%') THEN
  RAISE EXCEPTION 'V668 đã có trong sổ migration, không chạy lại';
 END IF;
 IF to_regprocedure('private.aka_agent_zalo_users_guard_global_id()') IS NOT NULL
    OR to_regprocedure('private.aka_agent_zalo_user_gid_trusted(jsonb,text)') IS NOT NULL
    OR to_regprocedure('private.aka_agent_zalo_own_uids(bigint)') IS NOT NULL THEN
  RAISE EXCEPTION 'V668 p1: hàm mới đã có';
 END IF;
 IF md5(pg_get_functiondef(to_regprocedure('private.aka_agent_zalo_own_global_ids(bigint)'))) IS DISTINCT FROM 'cb133ccad54abf402e92c44ac853f707' THEN
  RAISE EXCEPTION 'V668 p1: private.aka_agent_zalo_own_global_ids khác bản production 26/11';
 END IF;
END $pre$;

CREATE FUNCTION private.aka_agent_zalo_user_gid_trusted(p_raw jsonb, p_gid text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO 'pg_catalog'
AS $function$
 -- V668: Global ID của một dòng zalo_users có phải của chính người đó không, theo nguồn gốc dòng. Hồ sơ thành viên nhóm Zalo
 -- (/api/social/group/members) trả globalId của CHÍNH nick đang xem (đo 26/11/2026: mọi dòng chỉ có dữ liệu quét nhóm mang Global ID
 -- của người xem). Không tin khi: dòng chỉ có dữ liệu quét nhóm (raw_payload có zaloGroupId, không có khoá hồ sơ userId / username /
 -- bizPkg / phoneNumber), hoặc cột global_id khác raw_payload.globalId (quét nhóm đè Global ID đúng đọc từ hồ sơ / bạn bè).
 SELECT NULLIF(btrim(COALESCE(p_gid,'')),'') IS NOT NULL
  AND NOT (COALESCE(p_raw,'{}'::jsonb) ? 'zaloGroupId'
           AND NOT (COALESCE(p_raw,'{}'::jsonb) ?| ARRAY['userId','username','bizPkg','phoneNumber']))
  AND (NULLIF(btrim(COALESCE(p_raw->>'globalId','')),'') IS NULL OR btrim(p_raw->>'globalId') = btrim(p_gid));
$function$;

CREATE FUNCTION private.aka_agent_zalo_own_uids(p_account bigint)
 RETURNS text[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
 -- V668: Zalo ID của chính nick mà tài khoản đang đăng nhập (zalo_accounts.zalo_uid của Desktop, chat_zalo_account.zalo_id của Fly).
 SELECT COALESCE(array_agg(DISTINCT x) FILTER (WHERE x IS NOT NULL), '{}') FROM (
  SELECT NULLIF(btrim(za.zalo_uid),'') x FROM public.auto_accounts a JOIN public.zalo_accounts za ON za.id = a.zalo_account_id WHERE a.id = p_account
  UNION ALL
  SELECT NULLIF(btrim(ca.zalo_id),'') FROM public.chat_zalo_account_organization ao JOIN public.chat_zalo_account ca ON ca.id = ao.chat_zalo_account_id
   WHERE ao.auto_account_id = p_account) s;
$function$;

CREATE FUNCTION private.aka_agent_zalo_users_guard_global_id()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
-- V668: chặn ghi Global ID của người xem (lần quét thành viên nhóm) / của chính nick vào dòng của người khác. WHEN của trigger đã lọc:
-- Global ID mới khác rỗng, và khi UPDATE thì khác giá trị cũ.
DECLARE v_gid text := btrim(NEW.global_id); v_raw jsonb := COALESCE(NEW.raw_payload, '{}'::jsonb); v_raw_gid text; v_own text[]; v_prev text;
BEGIN
 IF current_setting('aka.zalo_gid_guard', true) = 'off' THEN RETURN NEW; END IF;
 v_raw_gid := NULLIF(btrim(COALESCE(v_raw->>'globalId','')),'');
 -- Ghi sai khi: (a) dòng chỉ có dữ liệu quét nhóm và Global ID trùng Global ID lần quét ghi (hoặc lần quét không ghi);
 -- (b) raw_payload là hồ sơ (có khoá hồ sơ) ghi Global ID khác Global ID đang ghi vào (quét nhóm đè, kể cả nick không ghi nhận);
 -- (c) Global ID của chính nick.
 IF NOT (v_raw ? 'zaloGroupId' AND NOT (v_raw ?| ARRAY['userId','username','bizPkg','phoneNumber']) AND (v_raw_gid IS NULL OR v_raw_gid = v_gid))
    AND NOT (v_raw ?| ARRAY['userId','username','bizPkg','phoneNumber'] AND v_raw_gid IS NOT NULL AND v_raw_gid <> v_gid) THEN
  v_own := private.aka_agent_zalo_own_global_ids(NEW.account_id);
  IF NOT (v_gid = ANY(v_own)) THEN RETURN NEW; END IF;
 END IF;
 -- Dòng của chính nick mang Global ID của nick là đúng.
 IF btrim(NEW.zalo_uid) = ANY(private.aka_agent_zalo_own_uids(NEW.account_id)) THEN RETURN NEW; END IF;
 IF TG_OP = 'UPDATE' THEN
  v_prev := OLD.global_id;
 ELSE
  SELECT zu.global_id INTO v_prev FROM public.zalo_users zu WHERE zu.account_id = NEW.account_id AND zu.zalo_uid = NEW.zalo_uid;
 END IF;
 v_prev := NULLIF(btrim(COALESCE(v_prev,'')),'');
 IF v_prev IS NOT NULL AND (v_prev = v_gid OR v_prev = ANY(COALESCE(v_own, private.aka_agent_zalo_own_global_ids(NEW.account_id)))) THEN
  v_prev := NULL;
 END IF;
 NEW.global_id := v_prev;
 RETURN NEW;
END
$function$;

CREATE TRIGGER trg_zalo_users_guard_global_id_ins BEFORE INSERT ON public.zalo_users
 FOR EACH ROW WHEN (NEW.global_id IS NOT NULL AND NEW.global_id <> '')
 EXECUTE FUNCTION private.aka_agent_zalo_users_guard_global_id();
CREATE TRIGGER trg_zalo_users_guard_global_id_upd BEFORE UPDATE OF global_id ON public.zalo_users
 FOR EACH ROW WHEN (NEW.global_id IS DISTINCT FROM OLD.global_id AND NEW.global_id IS NOT NULL AND NEW.global_id <> '')
 EXECUTE FUNCTION private.aka_agent_zalo_users_guard_global_id();

DO $grants$
DECLARE r text;
BEGIN
 REVOKE ALL ON FUNCTION private.aka_agent_zalo_user_gid_trusted(jsonb, text) FROM PUBLIC;
 REVOKE ALL ON FUNCTION private.aka_agent_zalo_own_uids(bigint) FROM PUBLIC;
 REVOKE ALL ON FUNCTION private.aka_agent_zalo_users_guard_global_id() FROM PUBLIC;
 FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role','aka_agent_desktop','aka_agent_chat_api'] LOOP
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
   EXECUTE format('REVOKE ALL ON FUNCTION private.aka_agent_zalo_user_gid_trusted(jsonb, text) FROM %I', r);
   EXECUTE format('REVOKE ALL ON FUNCTION private.aka_agent_zalo_own_uids(bigint) FROM %I', r);
   EXECUTE format('REVOKE ALL ON FUNCTION private.aka_agent_zalo_users_guard_global_id() FROM %I', r);
  END IF;
 END LOOP;
END $grants$;

COMMIT;
