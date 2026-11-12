#!/usr/bin/env python3
"""Sinh migration V497 (định tuyến tài khoản Zalo Server theo cờ use_new_zalo_runtime) và bản gỡ.

Thân hai hàm cũ lấy NGUYÊN VĂN từ bản live (scripts/fixtures/zalo-server-flag-route/live-functions-20261111.json,
chỉ đọc akachat 11/11/2026); script chỉ chèn phần thêm vào đúng một chỗ và tính md5 cho preflight/postflight.
Chạy lại sau khi đọc lại bản live nếu production đổi một trong hai hàm.

    python3 scripts/build-v497-sql.py
"""
import hashlib
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
LIVE = json.loads((ROOT / 'scripts/fixtures/zalo-server-flag-route/live-functions-20261111.json').read_text(encoding='utf-8'))
CHAT_ORGS_SIG = 'public.aka_agent_app_access_chat_organizations(bigint[])'
RECOVER_SIG = 'public.recover_server_zalo_running_state(bigint,text,boolean)'


def md5(text: str) -> str:
    return hashlib.md5(text.encode('utf-8')).hexdigest()


def insert_once(text: str, anchor: str, addition: str, before: bool) -> str:
    assert text.count(anchor) == 1, f'anchor phải xuất hiện đúng một lần: {anchor!r}'
    return text.replace(anchor, addition + anchor) if before else text.replace(anchor, anchor + addition)


chat_orgs_old = LIVE['functions'][CHAT_ORGS_SIG]['definition']
recover_old = LIVE['functions'][RECOVER_SIG]['definition']
assert md5(chat_orgs_old) == LIVE['functions'][CHAT_ORGS_SIG]['md5']
assert md5(recover_old) == LIVE['functions'][RECOVER_SIG]['md5']

# VPS bỏ qua tổ chức hàm này trả về. Thêm: tổ chức mà ChatApi đã nhận (có dòng to_fly: đang chờ chép phiên hoặc đang
# chạy trên Fly). ChatApi chỉ tạo dòng cho tổ chức theo luật cờ, nên VPS thả SAU khi dòng chờ đã có (mốc VPS thả luôn có
# dòng để ghi), ChatApi chưa sẵn sàng thì bật cờ không đổi gì, và khi tắt cờ VPS chỉ nhận lại sau khi ChatApi trả phiên.
# Bảng handoff không có cột id nên `id` vẫn là phần tử của p_orgs.
chat_orgs_new = insert_once(
    chat_orgs_old,
    '    OR public.aka_agent_app_access_chat_runtime(id)\n',
    "    OR EXISTS (\n"
    "      SELECT 1 FROM private.auto_zalo_server_session_handoff AS handoff\n"
    "       WHERE handoff.organization_id = id AND handoff.direction = 'to_fly'\n"
    "    )\n",
    before=False)

recover_new = insert_once(
    recover_old,
    '  RETURN jsonb_build_object(\n',
    "  -- V497: App Server dừng runtime của nhân viên (đã ngắt mọi kết nối Zalo, rồi gọi hàm này với\n"
    "  -- p_require_server_mode false) thì ghi mốc cho việc chép phiên sang Fly. Fly (aka_agent_chat_api) và lúc\n"
    "  -- khởi động (p_require_server_mode true) không ghi. Lỗi ở bước ghi mốc không được làm hỏng việc dọn của VPS.\n"
    "  IF current_user = 'service_role' AND NOT COALESCE(p_require_server_mode, false) THEN\n"
    "    BEGIN\n"
    "      PERFORM private.aka_agent_zalo_server_mark_vps_released(p_staff_id);\n"
    "    EXCEPTION WHEN OTHERS THEN\n"
    "      RAISE WARNING 'V497 mark_vps_released staff %: %', p_staff_id, SQLERRM;\n"
    "    END;\n"
    "  END IF;\n\n",
    before=True)

MD5 = {
    'chat_orgs_old': md5(chat_orgs_old), 'chat_orgs_new': md5(chat_orgs_new),
    'recover_old': md5(recover_old), 'recover_new': md5(recover_new),
}

FLAG_ROUTE = """CREATE FUNCTION public.aka_agent_zalo_server_flag_route(p_org bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $function$
  SELECT COALESCE((SELECT organization.use_new_zalo_runtime FROM public.org_organization AS organization
                    WHERE organization.id = p_org), false)
    AND EXISTS (
      SELECT 1 FROM public.org_organization_product AS entitlement
       WHERE entitlement.organization_id = p_org
         AND entitlement.product_id IN (16, 18)
         AND entitlement.is_deleted = false
         AND entitlement.expiration_date IS NOT NULL
         AND entitlement.expiration_date >= (
           date_trunc('day', timezone('Asia/Ho_Chi_Minh', now())) AT TIME ZONE 'Asia/Ho_Chi_Minh'
         ))
    AND EXISTS (
      SELECT 1 FROM public.resolve_organization_zalo_account_capabilities(p_org) AS capability
       WHERE capability.qr_enabled = true AND capability.server_enabled = true)
$function$;"""

HANDOFF_TABLE = """CREATE TABLE private.auto_zalo_server_session_handoff (
  account_id bigint PRIMARY KEY,
  organization_id bigint NOT NULL,
  staff_id bigint NOT NULL,
  direction text NOT NULL CHECK (direction IN ('to_fly', 'to_vps')),
  requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  vps_released_at timestamptz,
  completed_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error text CHECK (last_error IS NULL OR length(last_error) <= 500),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX auto_zalo_server_session_handoff_open_staff_idx
  ON private.auto_zalo_server_session_handoff (staff_id) WHERE completed_at IS NULL;
CREATE INDEX auto_zalo_server_session_handoff_to_fly_org_idx
  ON private.auto_zalo_server_session_handoff (organization_id) WHERE direction = 'to_fly';"""

MARK = """CREATE FUNCTION private.aka_agent_zalo_server_mark_vps_released(p_staff_id bigint)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_count integer;
BEGIN
  UPDATE private.auto_zalo_server_session_handoff
     SET vps_released_at = clock_timestamp(), updated_at = clock_timestamp()
   WHERE staff_id = p_staff_id AND direction = 'to_fly' AND completed_at IS NULL AND vps_released_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END
$function$;"""

migration = f"""-- V497: định tuyến tài khoản Zalo Server theo cờ org_organization.use_new_zalo_runtime cho tổ chức không có Chat
-- (kế hoạch engine v2 mục 16; sinh bằng scripts/build-v497-sql.py từ bản live đọc 11/11/2026, đừng sửa tay).
-- 1) public.aka_agent_zalo_server_flag_route(org): tổ chức bật cờ, có gói 16/18 còn hạn và có quyền Server
--    (qr_enabled + server_enabled), đúng điều kiện VPS đang dùng ở discover_zalo_server_account_runtime_users.
-- 2) aka_agent_app_access_chat_organizations thêm "OR ChatApi đã nhận tổ chức" (có dòng to_fly): App Server (nơi duy nhất
--    gọi hàm này, đọc lại mỗi 60 giây) chỉ thả tổ chức sau khi ChatApi đã tạo dòng chờ chép phiên, và chỉ nhận lại sau khi
--    ChatApi đã trả phiên. Bảng mới chưa có dòng nên lúc apply kết quả y như cũ (so ngay trong giao dịch).
-- 3) private.auto_zalo_server_session_handoff: ChatApi theo dõi việc chép phiên VPS <-> Fly (một dòng mỗi tài khoản).
-- 4) recover_server_zalo_running_state: lời gọi của App Server lúc dừng runtime ghi mốc vps_released_at cho dòng to_fly
--    đang chờ của nhân viên (qua private.aka_agent_zalo_server_mark_vps_released). Không có dòng chờ thì như cũ.
-- Không đổi aka_agent_app_access_chat_runtime (Desktop/Web dùng cho màn Chat). Code cũ chạy y như trước khi chưa tổ
-- chức nào bật cờ. Lệnh sửa schema: PostgREST nạp lại schema, apply ngoài giờ cao điểm.
-- Gỡ: rollback_v497_zalo_server_flag_route.sql (chỉ khi không còn dòng to_fly: tắt cờ và chờ phiên về VPS trước).
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '60s';

DO $pre$
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v497_%') THEN
      RAISE EXCEPTION 'V497 đã có trong sổ migration, không chạy lại';
    END IF;
  END IF;
  IF to_regprocedure('public.aka_agent_zalo_server_flag_route(bigint)') IS NOT NULL
     OR to_regprocedure('private.aka_agent_zalo_server_mark_vps_released(bigint)') IS NOT NULL
     OR to_regclass('private.auto_zalo_server_session_handoff') IS NOT NULL THEN
    RAISE EXCEPTION 'V497: đối tượng mới đã tồn tại';
  END IF;
  IF md5(pg_get_functiondef('{CHAT_ORGS_SIG}'::regprocedure)) <> '{MD5['chat_orgs_old']}' THEN
    RAISE EXCEPTION 'V497: aka_agent_app_access_chat_organizations khác bản live đã đọc 11/11';
  END IF;
  IF md5(pg_get_functiondef('{RECOVER_SIG}'::regprocedure)) <> '{MD5['recover_old']}' THEN
    RAISE EXCEPTION 'V497: recover_server_zalo_running_state khác bản live đã đọc 11/11';
  END IF;
  IF to_regprocedure('public.resolve_organization_zalo_account_capabilities(bigint)') IS NULL
     OR to_regprocedure('public.aka_agent_app_access_chat_runtime(bigint,boolean)') IS NULL
     OR to_regprocedure('public.aka_agent_app_access_separate(bigint)') IS NULL THEN
    RAISE EXCEPTION 'V497: thiếu hàm quyền dùng app/khả năng Zalo';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.org_organization'::regclass
                  AND attname = 'use_new_zalo_runtime' AND NOT attisdropped) THEN
    RAISE EXCEPTION 'V497: thiếu cột org_organization.use_new_zalo_runtime (V371)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aka_agent_chat_api')
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    RAISE EXCEPTION 'V497: thiếu role aka_agent_chat_api hoặc service_role';
  END IF;
END $pre$;

CREATE TEMP TABLE v497_before ON COMMIT DROP AS
SELECT
  ARRAY(SELECT x FROM public.aka_agent_app_access_chat_organizations(ARRAY(SELECT o.id FROM public.org_organization o)) AS x ORDER BY 1)
    AS chat_orgs,
  (SELECT proacl::text FROM pg_proc WHERE oid = '{CHAT_ORGS_SIG}'::regprocedure) AS chat_orgs_acl,
  (SELECT proacl::text FROM pg_proc WHERE oid = '{RECOVER_SIG}'::regprocedure) AS recover_acl;

{FLAG_ROUTE}
COMMENT ON FUNCTION public.aka_agent_zalo_server_flag_route(bigint) IS
  'V497: tài khoản Zalo Server của tổ chức chạy trên Fly theo cờ use_new_zalo_runtime (tổ chức bật cờ, có gói 16/18 còn hạn, có quyền QR + Server). Tổ chức có Chat vẫn theo luật Chat như cũ.';
REVOKE ALL ON FUNCTION public.aka_agent_zalo_server_flag_route(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aka_agent_zalo_server_flag_route(bigint) TO service_role, aka_agent_chat_api;

{HANDOFF_TABLE}
COMMENT ON TABLE private.auto_zalo_server_session_handoff IS
  'V497: chép phiên Zalo Server giữa App Server (auto_accounts.zalo_session) và Fly (chat_zalo_account_organization). Chỉ ChatApi đọc/ghi; mốc vps_released_at do App Server ghi qua recover_server_zalo_running_state.';
ALTER TABLE private.auto_zalo_server_session_handoff ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.auto_zalo_server_session_handoff FROM PUBLIC, anon, authenticated, service_role, aka_agent_desktop;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE private.auto_zalo_server_session_handoff TO aka_agent_chat_api;

{MARK}
REVOKE ALL ON FUNCTION private.aka_agent_zalo_server_mark_vps_released(bigint) FROM PUBLIC, anon, authenticated, aka_agent_desktop, aka_agent_chat_api;
GRANT EXECUTE ON FUNCTION private.aka_agent_zalo_server_mark_vps_released(bigint) TO service_role;

{chat_orgs_new.rstrip()};

{recover_new.rstrip()};

DO $post$
DECLARE
  b record;
  v_after bigint[];
BEGIN
  SELECT * INTO b FROM v497_before;
  IF md5(pg_get_functiondef('{CHAT_ORGS_SIG}'::regprocedure)) <> '{MD5['chat_orgs_new']}' THEN
    RAISE EXCEPTION 'V497 postflight: aka_agent_app_access_chat_organizations khác bản sinh';
  END IF;
  IF md5(pg_get_functiondef('{RECOVER_SIG}'::regprocedure)) <> '{MD5['recover_new']}' THEN
    RAISE EXCEPTION 'V497 postflight: recover_server_zalo_running_state khác bản sinh';
  END IF;
  IF (SELECT proacl::text FROM pg_proc WHERE oid = '{CHAT_ORGS_SIG}'::regprocedure) IS DISTINCT FROM b.chat_orgs_acl
     OR (SELECT proacl::text FROM pg_proc WHERE oid = '{RECOVER_SIG}'::regprocedure) IS DISTINCT FROM b.recover_acl THEN
    RAISE EXCEPTION 'V497 postflight: quyền của hàm cũ bị đổi';
  END IF;
  IF has_function_privilege('anon', 'public.aka_agent_zalo_server_flag_route(bigint)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.aka_agent_zalo_server_flag_route(bigint)', 'EXECUTE')
     OR NOT has_function_privilege('aka_agent_chat_api', 'public.aka_agent_zalo_server_flag_route(bigint)', 'EXECUTE')
     OR has_function_privilege('anon', 'private.aka_agent_zalo_server_mark_vps_released(bigint)', 'EXECUTE')
     OR has_function_privilege('aka_agent_chat_api', 'private.aka_agent_zalo_server_mark_vps_released(bigint)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'private.aka_agent_zalo_server_mark_vps_released(bigint)', 'EXECUTE')
     OR has_table_privilege('anon', 'private.auto_zalo_server_session_handoff', 'SELECT')
     OR has_table_privilege('authenticated', 'private.auto_zalo_server_session_handoff', 'SELECT')
     OR NOT has_table_privilege('aka_agent_chat_api', 'private.auto_zalo_server_session_handoff', 'SELECT, INSERT, UPDATE, DELETE') THEN
    RAISE EXCEPTION 'V497 postflight: quyền đối tượng mới sai';
  END IF;
  -- Bảng handoff vừa tạo nên chưa có dòng to_fly: App Server phải nhận đúng danh sách cũ, kể cả khi đang có tổ chức bật cờ.
  v_after := ARRAY(SELECT x FROM public.aka_agent_app_access_chat_organizations(ARRAY(SELECT o.id FROM public.org_organization o)) AS x ORDER BY 1);
  IF v_after IS DISTINCT FROM b.chat_orgs THEN
    RAISE EXCEPTION 'V497 postflight: hàm định tuyến của App Server đổi kết quả ngay lúc apply';
  END IF;
END $post$;

COMMIT;
"""

rollback = f"""-- Gỡ V497: trả aka_agent_app_access_chat_organizations và recover_server_zalo_running_state về bản live 11/11/2026,
-- xoá hàm luật cờ, hàm ghi mốc và bảng handoff (sinh bằng scripts/build-v497-sql.py, đừng sửa tay).
-- Chỉ chạy khi không còn dòng to_fly: tắt cờ các tổ chức không Chat và chờ ChatApi trả phiên về VPS (dòng thành to_vps),
-- nếu không VPS và Fly có thể cùng nối một tài khoản. Lệnh sửa schema: apply ngoài giờ cao điểm.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '60s';

DO $pre$
BEGIN
  IF to_regclass('private.auto_zalo_server_session_handoff') IS NULL
     OR to_regprocedure('public.aka_agent_zalo_server_flag_route(bigint)') IS NULL
     OR to_regprocedure('private.aka_agent_zalo_server_mark_vps_released(bigint)') IS NULL THEN
    RAISE EXCEPTION 'Rollback V497: thiếu đối tượng của V497';
  END IF;
  IF md5(pg_get_functiondef('{CHAT_ORGS_SIG}'::regprocedure)) <> '{MD5['chat_orgs_new']}'
     OR md5(pg_get_functiondef('{RECOVER_SIG}'::regprocedure)) <> '{MD5['recover_new']}' THEN
    RAISE EXCEPTION 'Rollback V497: hàm đã bị đổi sau V497, không ghi đè';
  END IF;
  IF EXISTS (SELECT 1 FROM private.auto_zalo_server_session_handoff WHERE direction = 'to_fly') THEN
    RAISE EXCEPTION 'Rollback V497: còn tài khoản đang ở Fly theo cờ; tắt cờ và chờ phiên về VPS trước';
  END IF;
END $pre$;

{chat_orgs_old.rstrip()};

{recover_old.rstrip()};

DROP FUNCTION private.aka_agent_zalo_server_mark_vps_released(bigint);
DROP TABLE private.auto_zalo_server_session_handoff;
DROP FUNCTION public.aka_agent_zalo_server_flag_route(bigint);

DO $post$
BEGIN
  IF md5(pg_get_functiondef('{CHAT_ORGS_SIG}'::regprocedure)) <> '{MD5['chat_orgs_old']}'
     OR md5(pg_get_functiondef('{RECOVER_SIG}'::regprocedure)) <> '{MD5['recover_old']}' THEN
    RAISE EXCEPTION 'Rollback V497 postflight: hàm chưa về bản live';
  END IF;
END $post$;

COMMIT;
"""

(ROOT / 'migrations/migration_v497_zalo_server_flag_route.sql').write_text(migration, encoding='utf-8')
(ROOT / 'migrations/rollback_v497_zalo_server_flag_route.sql').write_text(rollback, encoding='utf-8')
(ROOT / 'scripts/fixtures/zalo-server-flag-route/v497-md5.json').write_text(json.dumps(MD5, indent=2) + '\n', encoding='utf-8')
print(json.dumps(MD5, indent=2))
