#!/bin/sh
# V675 (trả quyền sequence public.auto_zalo_api_error_logs_id_seq mà V525 thu nhầm): test trên PostgreSQL cục bộ dùng một lần.
# Mặc định PostgreSQL 17 như production (17.6). Không đọc credential, không kết nối ra ngoài, chỉ nghe 127.0.0.1.
# Nền: bảng, quyền bảng / cột, RLS của public.auto_zalo_api_error_logs và các vai trò như production đọc 27/11/2026; quyền
# sequence trước V525 (migrations/snapshots/desktop-session-rls/least-privilege-after.json, trừ anon / authenticated đã thu ở
# V435); bản sao pgrst_ddl_watch với đúng danh sách lệnh của production. Như Supabase: superuser là supabase_admin, còn
# postgres (chủ mọi đối tượng, người chạy V525 / V675) không phải superuser, có CREATEROLE / CREATEDB / BYPASSRLS.
# Ca:
#   1. trước V525: ChatApi (aka_agent_chat_api, đúng câu INSERT của campaignRuntimeRepository.createZaloApiErrorLog),
#      Desktop và App Server qua PostgREST (authenticator → aka_agent_desktop / service_role, đúng câu trong postgres_logs)
#      ghi được;
#   2. chạy nguyên khối $grants$ của tệp V525 (md5 tệp = sổ production): ACL còn {postgres=rwU/postgres}, ba đường ghi báo
#      đúng "permission denied for sequence auto_zalo_api_error_logs_id_seq" như production, sequence khác không đổi;
#   3. V675 chạy thử kết thúc ROLLBACK không đổi gì; bài hậu kiểm báo lỗi trên trạng thái hỏng;
#   4. V675: không NOTIFY pgrst (bộ dò có đối chứng COMMENT), ACL đúng đích, ba đường ghi lại được, anon / authenticated vẫn
#      bị chặn, mọi quyền khác không đổi, bài hậu kiểm đạt;
#   5. apply lại bị chặn (khi chưa và khi đã có dòng sổ) và không đổi gì;
#   6. rollback về đúng trạng thái sau V525 (ghi lại hỏng), rollback lần hai bị chặn, apply lại được;
#   7. lệch quyền sequence hoặc quyền bảng: V675 dừng trước khi đổi gì;
#   8. đang có traffic: kết nối đã mở sẵn (như pool PostgREST / Supavisor) với câu lệnh đã PREPARE và đã lỗi trước V675 ghi
#      được ngay sau V675, không cần nối lại; V675 không phải chờ một giao dịch ghi đang giữ khoá trên bảng và sequence.
# Chạy: scripts/test-v675-zalo-api-error-logs-sequence-grants.sh   (PG_TEST_BINDIR=…/bin để chọn bản PostgreSQL khác)
set -eu
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
pg_bin=${PG_TEST_BINDIR:-/opt/homebrew/opt/postgresql@17/bin}
port=${PG_TEST_PORT:-25675}
v525="$repo_dir/migrations/migration_v525_zalo_message_status_sync.sql"
v675="$repo_dir/migrations/migration_v675_zalo_api_error_logs_sequence_grants.sql"
rollback="$repo_dir/migrations/rollback_v675_zalo_api_error_logs_sequence_grants.sql"
smoke="$repo_dir/migrations/tests/migration_v675_zalo_api_error_logs_sequence_grants_smoke.sql"
v525_ledger_md5=1250bb56209c1632b3865ed3dd94906c
# macOS: thiếu LC_ALL thì postmaster dừng với "postmaster became multithreaded during startup".
LC_ALL=${LC_ALL:-C}; export LC_ALL
PGCLIENTENCODING=UTF8; export PGCLIENTENCODING
test_dir=$(mktemp -d "${TMPDIR:-/tmp}/aka-v675-sql.XXXXXX")
# initdb/pg_ctl không chạy dưới root (container cloud): khi đó chạy bằng user postgres.
as_pg() { if [ "$(id -u)" = 0 ]; then runuser -u postgres -- "$@"; else "$@"; fi; }
if [ "$(id -u)" = 0 ]; then chown postgres "$test_dir"; fi
cleanup() { as_pg "$pg_bin/pg_ctl" -D "$test_dir/db" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$test_dir"; }
trap cleanup EXIT INT TERM
as_pg "$pg_bin/initdb" -D "$test_dir/db" -A trust --encoding=UTF8 --locale=C -U supabase_admin >/dev/null
as_pg "$pg_bin/pg_ctl" -D "$test_dir/db" -l "$test_dir/server.log" \
  -o "-h 127.0.0.1 -k '' -p $port -c max_connections=20" -w start >/dev/null
export PGOPTIONS='-c client_min_messages=warning'
psql_as() { who=$1; db=$2; shift 2; "$pg_bin/psql" -X -q -h 127.0.0.1 -p "$port" -U "$who" -d "$db" -v ON_ERROR_STOP=1 "$@"; }
scalar() { psql_as postgres "$1" -At -c "$2"; }
checks=0
pass() { checks=$((checks + 1)); echo "PASS $checks $1"; }
fail() { echo "FAIL $1" >&2; exit 1; }
file_md5() { if command -v md5sum >/dev/null 2>&1; then md5sum "$1" | cut -d' ' -f1; else md5 -q "$1"; fi; }
# Lệnh phải lỗi, và lỗi phải chứa mẫu cho trước (chỉ bắt stderr).
expect_error() {
  label=$1; pattern=$2; shift 2
  if out=$("$@" 2>&1 >/dev/null); then fail "$label: lệnh chạy được, cần lỗi"; fi
  printf '%s\n' "$out" | grep -F -q -- "$pattern" || { printf '%s\n' "$out" >&2; fail "$label: lỗi khác mẫu '$pattern'"; }
}
seq_acl() { scalar "$1" "SELECT relacl::text FROM pg_class WHERE oid = 'public.auto_zalo_api_error_logs_id_seq'::regclass"; }
row_count() { scalar "$1" "SELECT count(*) FROM public.auto_zalo_api_error_logs"; }
# Mọi quyền / định nghĩa khác ngoài ACL của chính sequence V675 sửa.
fingerprint() {
  scalar "$1" "SELECT md5(string_agg(x, E'\n' ORDER BY x)) FROM (
    SELECT 'rel:' || c.oid::regclass::text || ':' || c.relkind::text || ':' || coalesce(c.relacl::text, '') || ':'
      || c.relrowsecurity::text
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('public', 'private', 'extensions', 'supabase_migrations')
      AND c.oid <> 'public.auto_zalo_api_error_logs_id_seq'::regclass
    UNION ALL SELECT 'col:' || a.attrelid::regclass::text || '.' || a.attname || ':' || coalesce(a.attacl::text, '')
    FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('public', 'private') AND a.attnum > 0
    UNION ALL SELECT 'pol:' || polrelid::regclass::text || ':' || polname || ':' || polcmd::text || ':' || polroles::text
    FROM pg_policy
    UNION ALL SELECT 'fn:' || p.oid::regprocedure::text || ':' || coalesce(p.proacl::text, '') || ':' || md5(p.prosrc)
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname IN ('public', 'private', 'extensions')
    UNION ALL SELECT 'role:' || rolname || ':' || concat_ws(',', rolsuper, rolinherit, rolbypassrls, rolcanlogin)
    FROM pg_roles WHERE rolname !~ '^pg_'
    UNION ALL SELECT 'nsp:' || nspname || ':' || coalesce(nspacl::text, '') FROM pg_namespace
  ) s(x)"
}
# Ba đường ghi của production.
write_chat_api() { psql_as aka_agent_chat_api "$1" -f "$test_dir/chat_api_insert.sql" >/dev/null; }
write_postgrest() { psql_as authenticator "$1" -v pgrst_role="$2" -f "$test_dir/postgrest_insert.sql" >/dev/null; }
expect_all_writes_denied() {
  db=$1; label=$2
  for who in aka_agent_desktop service_role; do
    expect_error "$label: PostgREST $who" 'permission denied for sequence auto_zalo_api_error_logs_id_seq' \
      write_postgrest "$db" "$who"
  done
  expect_error "$label: ChatApi" 'permission denied for sequence auto_zalo_api_error_logs_id_seq' write_chat_api "$db"
}
expect_all_writes_ok() {
  db=$1; label=$2
  before=$(row_count "$db")
  write_chat_api "$db" || fail "$label: ChatApi không ghi được"
  write_postgrest "$db" aka_agent_desktop || fail "$label: Desktop qua PostgREST không ghi được"
  write_postgrest "$db" service_role || fail "$label: service_role qua PostgREST không ghi được"
  test "$(row_count "$db")" -eq $((before + 3)) || fail "$label: số dòng không tăng đúng 3"
}
target_acl='{postgres=rwU/postgres,service_role=rwU/postgres,aka_agent_desktop=U/postgres,aka_agent_chat_api=rU/postgres}'
after_v525_acl='{postgres=rwU/postgres}'

# --- Câu ghi giống production ---------------------------------------------------------------------------------------------
# ChatApi packages/database/src/campaignRuntimeRepository.ts createZaloApiErrorLog (Kysely gửi tham số không kiểu).
cat >"$test_dir/chat_api_insert.sql" <<'SQL'
PREPARE chat_api_insert AS
      INSERT INTO public.auto_zalo_api_error_logs (
        staff_id, organization_id, account_id, campaign_id,
        campaign_input_data_id, campaign_detail_id,
        action_code, action_name, api_name,
        zalo_error_code, zalo_error_message, normalized_error_code, detail_status,
        request_payload, target_payload, raw_error
      ) VALUES (
        $1::bigint,
        $2::bigint,
        $3::bigint,
        $4::bigint,
        $5::bigint,
        $6::bigint,
        $7,
        $8,
        $9,
        $10,
        $11,
        $12,
        $13,
        $14::jsonb,
        $15::jsonb,
        $16::jsonb
      );
EXECUTE chat_api_insert('7', '9', '11', '61226', '501', NULL, 'zalo_send_stranger_message', 'Nhắn tin người lạ',
  'sendMessage', '-1', 'v675 test', 'err_test', 'thất bại', '{}', '{}', '{}');
SQL
# Desktop / App Server src/main/data/repositories/zaloApiErrorLogRepository.ts qua supabase-js: câu PostgREST trong
# postgres_logs 25/11/2026 11:42:15 UTC; PostgREST đổi vai trò bằng set_config('role', …, true).
cat >"$test_dir/postgrest_insert.sql" <<'SQL'
BEGIN;
SELECT set_config('role', :'pgrst_role', true);
WITH pgrst_source AS (INSERT INTO "public"."auto_zalo_api_error_logs"("account_id", "action_code", "action_name", "api_name", "campaign_detail_id", "campaign_id", "campaign_input_data_id", "detail_status", "normalized_error_code", "organization_id", "raw_error", "request_payload", "staff_id", "target_payload", "zalo_error_code", "zalo_error_message") SELECT "pgrst_body"."account_id", "pgrst_body"."action_code", "pgrst_body"."action_name", "pgrst_body"."api_name", "pgrst_body"."campaign_detail_id", "pgrst_body"."campaign_id", "pgrst_body"."campaign_input_data_id", "pgrst_body"."detail_status", "pgrst_body"."normalized_error_code", "pgrst_body"."organization_id", "pgrst_body"."raw_error", "pgrst_body"."request_payload", "pgrst_body"."staff_id", "pgrst_body"."target_payload", "pgrst_body"."zalo_error_code", "pgrst_body"."zalo_error_message" FROM (SELECT '{"account_id":11,"action_code":"zalo_send_stranger_message","action_name":"Nhắn tin người lạ","api_name":"sendMessage","campaign_detail_id":null,"campaign_id":61226,"campaign_input_data_id":501,"detail_status":"thất bại","normalized_error_code":"err_test","organization_id":9,"raw_error":{},"request_payload":{},"staff_id":7,"target_payload":{},"zalo_error_code":"-1","zalo_error_message":"v675 test"}'::json AS json_data) pgrst_payload, LATERAL (SELECT "account_id", "action_code", "action_name", "api_name", "campaign_detail_id", "campaign_id", "campaign_input_data_id", "detail_status", "normalized_error_code", "organization_id", "raw_error", "request_payload", "staff_id", "target_payload", "zalo_error_code", "zalo_error_message" FROM json_to_record(pgrst_payload.json_data) AS _("account_id" bigint, "action_code" text, "action_name" text, "api_name" text, "campaign_detail_id" bigint, "campaign_id" bigint, "campaign_input_data_id" bigint, "detail_status" text, "normalized_error_code" text, "organization_id" bigint, "raw_error" jsonb, "request_payload" jsonb, "staff_id" bigint, "target_payload" jsonb, "zalo_error_code" text, "zalo_error_message" text) ) pgrst_body  RETURNING 1) SELECT '' AS total_result_set, pg_catalog.count(_postgrest_t) AS page_total, array[]::text[] AS header, ''::text AS body, nullif(current_setting('response.headers', true), '') AS response_headers, nullif(current_setting('response.status', true), '') AS response_status, '' AS response_inserted FROM (SELECT * FROM pgrst_source) _postgrest_t;
COMMIT;
SQL

# --- Nền trước V525 ------------------------------------------------------------------------------------------------------
# Vai trò như production (pg_roles / pg_auth_members đọc 27/11/2026).
psql_as supabase_admin postgres -c "CREATE ROLE postgres LOGIN CREATEROLE CREATEDB REPLICATION BYPASSRLS;
  CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;
  CREATE ROLE service_role NOLOGIN BYPASSRLS; CREATE ROLE aka_agent_desktop NOLOGIN NOINHERIT;
  CREATE ROLE aka_agent_chat_api LOGIN BYPASSRLS; CREATE ROLE authenticator LOGIN NOINHERIT;
  GRANT anon, authenticated, service_role, aka_agent_desktop TO authenticator;
  GRANT anon, authenticated, service_role, aka_agent_desktop, aka_agent_chat_api, authenticator TO postgres WITH ADMIN OPTION;" \
  -c 'CREATE DATABASE fixture OWNER postgres' >/dev/null
new_db() { psql_as supabase_admin postgres -c "CREATE DATABASE $1 TEMPLATE $2 OWNER postgres" >/dev/null; }
cat >"$test_dir/fixture.sql" <<'SQL'
CREATE SCHEMA private;
CREATE SCHEMA supabase_migrations;
CREATE TABLE supabase_migrations.schema_migrations (version text PRIMARY KEY, statements text[], name text, created_by text,
  idempotency_key text, rollback text[]);
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role, aka_agent_desktop, aka_agent_chat_api;

-- Bảng nhật ký, quyền bảng / cột và RLS như production.
CREATE TABLE public.auto_zalo_api_error_logs (
  id bigserial PRIMARY KEY,
  staff_id bigint, organization_id bigint, account_id bigint, campaign_id bigint,
  campaign_input_data_id bigint, campaign_detail_id bigint,
  action_code text, action_name text, api_name text,
  zalo_error_code text, zalo_error_message text, normalized_error_code text, detail_status text,
  request_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  target_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw_error jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON TABLE public.auto_zalo_api_error_logs FROM PUBLIC;
GRANT ALL ON TABLE public.auto_zalo_api_error_logs TO service_role;
GRANT INSERT ON TABLE public.auto_zalo_api_error_logs TO aka_agent_chat_api;
GRANT INSERT (staff_id, organization_id, account_id, campaign_id, campaign_input_data_id, campaign_detail_id,
  action_code, action_name, api_name, zalo_error_code, zalo_error_message, normalized_error_code, detail_status,
  request_payload, target_payload, raw_error) ON TABLE public.auto_zalo_api_error_logs TO aka_agent_desktop;
ALTER TABLE public.auto_zalo_api_error_logs ENABLE ROW LEVEL SECURITY;
-- Production có hai policy FOR ALL cho aka_agent_desktop; ở đây cho qua hết để chỉ quyền sequence quyết định.
CREATE POLICY fixture_desktop_all ON public.auto_zalo_api_error_logs FOR ALL TO aka_agent_desktop USING (true) WITH CHECK (true);
-- Quyền sequence trước V525.
REVOKE ALL ON SEQUENCE public.auto_zalo_api_error_logs_id_seq FROM PUBLIC;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.auto_zalo_api_error_logs_id_seq TO service_role;
GRANT USAGE ON SEQUENCE public.auto_zalo_api_error_logs_id_seq TO aka_agent_desktop;
GRANT SELECT, USAGE ON SEQUENCE public.auto_zalo_api_error_logs_id_seq TO aka_agent_chat_api;

-- Đối tượng mà khối $grants$ của V525 nhắc tên (chỉ khung, đủ để chạy nguyên khối đó).
CREATE TABLE public.auto_zalo_message_status (id bigint PRIMARY KEY);
CREATE TABLE private.auto_zalo_status_events (id bigserial PRIMARY KEY);
CREATE TABLE private.auto_zalo_status_accounts (account_id bigint PRIMARY KEY);
CREATE TABLE private.auto_zalo_status_failures (id bigint PRIMARY KEY);
CREATE TABLE private.auto_zalo_status_counters (key text PRIMARY KEY);
CREATE TABLE private.auto_zalo_status_state (key text PRIMARY KEY);
CREATE TABLE private.auto_zalo_status_runs (id bigserial PRIMARY KEY);
CREATE TABLE private.auto_zalo_status_result_queue (id bigint PRIMARY KEY);
CREATE TABLE private.auto_zalo_status_result_state (key text PRIMARY KEY);
CREATE TABLE private.auto_zalo_status_desktop_usage (key text PRIMARY KEY);
-- Lời V525: quyền mặc định có thể đã cấp sẵn trên sequence của nó.
GRANT USAGE ON SEQUENCE private.auto_zalo_status_events_id_seq, private.auto_zalo_status_runs_id_seq TO service_role;
CREATE FUNCTION public.aka_agent_ingest_zalo_message_status(text, jsonb) RETURNS void LANGUAGE plpgsql AS $$BEGIN END$$;
CREATE FUNCTION public.aka_agent_desktop_ingest_zalo_message_status(jsonb) RETURNS void LANGUAGE plpgsql AS $$BEGIN END$$;

-- Một sequence cùng họ, không khớp mẫu 'auto\_zalo\_%' (V525 và V675 đều không được đụng).
CREATE TABLE public.auto_account_contacts (id bigserial PRIMARY KEY);
REVOKE ALL ON SEQUENCE public.auto_account_contacts_id_seq FROM PUBLIC;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.auto_account_contacts_id_seq TO service_role;
GRANT USAGE ON SEQUENCE public.auto_account_contacts_id_seq TO aka_agent_desktop;
GRANT SELECT, USAGE ON SEQUENCE public.auto_account_contacts_id_seq TO aka_agent_chat_api;
SQL
# Phần cần superuser: bản sao pgrst_ddl_watch của production (chủ supabase_admin, danh sách lệnh đọc 27/11/2026).
cat >"$test_dir/fixture_superuser.sql" <<'SQL'
CREATE SCHEMA extensions;
CREATE FUNCTION extensions.pgrst_ddl_watch() RETURNS event_trigger LANGUAGE plpgsql AS $$
DECLARE cmd record;
BEGIN
  FOR cmd IN SELECT * FROM pg_event_trigger_ddl_commands() LOOP
    IF cmd.command_tag IN ('CREATE SCHEMA', 'ALTER SCHEMA', 'CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO', 'ALTER TABLE',
        'CREATE FOREIGN TABLE', 'ALTER FOREIGN TABLE', 'CREATE VIEW', 'ALTER VIEW', 'CREATE MATERIALIZED VIEW',
        'ALTER MATERIALIZED VIEW', 'CREATE FUNCTION', 'ALTER FUNCTION', 'CREATE TRIGGER', 'CREATE TYPE', 'ALTER TYPE',
        'CREATE RULE', 'COMMENT')
       AND cmd.schema_name IS DISTINCT FROM 'pg_temp' THEN
      NOTIFY pgrst, 'reload schema';
    END IF;
  END LOOP;
END $$;
CREATE EVENT TRIGGER pgrst_ddl_watch ON ddl_command_end EXECUTE FUNCTION extensions.pgrst_ddl_watch();
SQL
psql_as postgres fixture -f "$test_dir/fixture.sql" >/dev/null
psql_as supabase_admin fixture -f "$test_dir/fixture_superuser.sql" >/dev/null
test "$(scalar fixture "SELECT rolsuper::text || ',' || (SELECT pg_get_userbyid(relowner) FROM pg_class
  WHERE oid = 'public.auto_zalo_api_error_logs_id_seq'::regclass) FROM pg_roles WHERE rolname = current_user")" = 'false,postgres' \
  || fail 'postgres phải là chủ sequence và không phải superuser'
pass 'nền như Supabase: postgres là chủ sequence, không phải superuser'

# 1. Trước V525: ba đường ghi được.
new_db pre fixture
expect_all_writes_ok pre 'trước V525'
pass 'trước V525: ChatApi, Desktop (aka_agent_desktop) và service_role qua PostgREST đều ghi được'

# 2. Nguyên khối $grants$ của tệp V525 đã apply.
test "$(file_md5 "$v525")" = "$v525_ledger_md5" || fail 'tệp V525 khác bản trong sổ production'
awk '/^DO \$grants\$$/ { f = 1 } f { print } f && /^\$grants\$;$/ { exit }' "$v525" >"$test_dir/v525_grants.sql"
test "$(wc -l <"$test_dir/v525_grants.sql")" -gt 30 || fail 'không tách được khối $grants$ của V525'
grep -F -q "c.relname LIKE 'auto\_zalo\_%'" "$test_dir/v525_grants.sql" || fail 'khối $grants$ không có mẫu auto_zalo'
grep -F -q "n.nspname IN ('private', 'public')" "$test_dir/v525_grants.sql" || fail 'khối $grants$ không quét public'
pass 'tệp V525 có md5 bằng sổ production; khối $grants$ quét mọi sequence auto\_zalo\_% ở private + public'
new_db post525 fixture
contacts_acl_before=$(scalar post525 "SELECT relacl::text FROM pg_class WHERE oid = 'public.auto_account_contacts_id_seq'::regclass")
psql_as postgres post525 -f "$test_dir/v525_grants.sql" >/dev/null
test "$(seq_acl post525)" = "$after_v525_acl" || fail "sau V525 ACL là $(seq_acl post525)"
test "$(scalar post525 "SELECT string_agg(coalesce(relacl::text, '-'), ' ' ORDER BY relname) FROM pg_class
  WHERE oid IN ('private.auto_zalo_status_events_id_seq'::regclass, 'private.auto_zalo_status_runs_id_seq'::regclass)")" \
  = "$after_v525_acl $after_v525_acl" || fail 'V525 không thu sequence private của nó'
test "$(scalar post525 "SELECT relacl::text FROM pg_class WHERE oid = 'public.auto_account_contacts_id_seq'::regclass")" \
  = "$contacts_acl_before" || fail 'V525 đụng sequence không khớp mẫu'
pass "sau V525: auto_zalo_api_error_logs_id_seq còn $after_v525_acl như production; sequence khác mẫu không đổi"
test "$(scalar post525 "SELECT has_table_privilege('aka_agent_chat_api', 'public.auto_zalo_api_error_logs', 'INSERT')
  AND has_table_privilege('service_role', 'public.auto_zalo_api_error_logs', 'INSERT')
  AND has_any_column_privilege('aka_agent_desktop', 'public.auto_zalo_api_error_logs', 'INSERT')")" = t \
  || fail 'V525 đụng quyền bảng'
expect_all_writes_denied post525 'sau V525'
pass 'sau V525: quyền bảng còn nguyên, cả ba đường ghi báo đúng lỗi production (permission denied for sequence)'
# V660 (26/11, sau V525) tạo sequence auto_zalo_ mới với quyền mặc định của production; V675 không được đụng.
psql_as postgres post525 -c "CREATE TABLE public.auto_zalo_tag_member_events (id bigserial PRIMARY KEY);
  GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.auto_zalo_tag_member_events_id_seq TO anon, authenticated, service_role;" >/dev/null
for db in main drift live_chat live_rest live_lock; do new_db "$db" post525; done
new_db ctl fixture

# 3. Chạy thử V675 rồi ROLLBACK; bài hậu kiểm bắt được trạng thái hỏng.
base=$(fingerprint main)
sed 's/^COMMIT;$/ROLLBACK;/' "$v675" >"$test_dir/v675_dry.sql"
grep -q '^ROLLBACK;$' "$test_dir/v675_dry.sql" || fail 'không tạo được bản chạy thử'
psql_as postgres main -f "$test_dir/v675_dry.sql" >/dev/null
test "$(seq_acl main)" = "$after_v525_acl" && test "$(fingerprint main)" = "$base" || fail 'chạy thử ROLLBACK vẫn đổi trạng thái'
expect_all_writes_denied main 'sau chạy thử'
pass 'V675 chạy thử kết thúc ROLLBACK: không đổi gì'
expect_error 'hậu kiểm trên trạng thái hỏng' 'V675 smoke: service_role USAGE' psql_as postgres main -f "$smoke"
pass 'bài hậu kiểm báo lỗi trên trạng thái sau V525'

# 4. V675.
out=$(psql_as postgres ctl -c 'LISTEN pgrst' -c 'COMMENT ON TABLE public.auto_zalo_api_error_logs IS NULL' -c 'SELECT 1' 2>&1)
printf '%s\n' "$out" | grep -q 'Asynchronous notification "pgrst"' || { printf '%s\n' "$out"; fail 'bộ dò NOTIFY không thấy COMMENT'; }
pass 'đối chứng: COMMENT làm pgrst_ddl_watch NOTIFY, bộ dò thấy'
out=$(psql_as postgres main -c 'LISTEN pgrst' -f "$v675" -c 'SELECT 1' 2>&1)
if printf '%s\n' "$out" | grep -q 'Asynchronous notification'; then printf '%s\n' "$out"; fail 'V675 làm PostgREST nạp lại schema'; fi
pass 'V675 apply được và không NOTIFY pgrst (PostgREST không nạp lại schema)'
test "$(seq_acl main)" = "$target_acl" || fail "sau V675 ACL là $(seq_acl main)"
test "$(fingerprint main)" = "$base" || fail 'V675 đổi quyền / định nghĩa ngoài sequence đích'
pass "sau V675: ACL $target_acl, mọi quyền / định nghĩa khác không đổi (kể cả sequence V525 và V660)"
expect_all_writes_ok main 'sau V675'
pass 'sau V675: ChatApi, Desktop và service_role ghi được như trước V525'
for who in anon authenticated; do
  expect_error "sau V675: $who" 'permission denied for table auto_zalo_api_error_logs' write_postgrest main "$who"
done
test "$(scalar main "SELECT has_sequence_privilege('anon', 'public.auto_zalo_api_error_logs_id_seq', 'USAGE,UPDATE,SELECT')
  OR has_sequence_privilege('authenticated', 'public.auto_zalo_api_error_logs_id_seq', 'USAGE,UPDATE,SELECT')")" = f \
  || fail 'anon / authenticated dùng được sequence'
pass 'sau V675: anon / authenticated vẫn không ghi bảng, không dùng sequence'
out=$(PGOPTIONS='-c client_min_messages=notice' psql_as postgres main -f "$smoke" 2>&1)
printf '%s\n' "$out" | grep -q 'V675 smoke: đạt' || { printf '%s\n' "$out"; fail 'hậu kiểm không đạt sau V675'; }
pass 'bài hậu kiểm đạt sau V675'

# 5. Apply lại bị chặn, không đổi gì.
applied=$(fingerprint main)
expect_error 'apply lại' 'V675: quyền sequence đã đúng bản sửa, không apply lại' psql_as postgres main -f "$v675"
psql_as postgres main -c "INSERT INTO supabase_migrations.schema_migrations (version, name)
  VALUES ('20261127000000', 'migration_v675_zalo_api_error_logs_sequence_grants')" >/dev/null
expect_error 'apply lại khi sổ đã có' 'V675: số 675 đã có trong sổ migration' psql_as postgres main -f "$v675"
psql_as postgres main -c "DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261127000000'" >/dev/null
test "$(seq_acl main)" = "$target_acl" && test "$(fingerprint main)" = "$applied" || fail 'apply lại làm đổi trạng thái'
pass 'apply lại bị chặn (chưa có và đã có dòng sổ), không đổi gì'

# 6. Rollback, rollback lần hai, apply lại.
psql_as postgres main -f "$rollback" >/dev/null
test "$(seq_acl main)" = "$after_v525_acl" && test "$(fingerprint main)" = "$base" || fail 'rollback không về đúng trạng thái sau V525'
expect_all_writes_denied main 'sau rollback'
pass 'rollback về đúng trạng thái sau V525 (ba đường ghi lại hỏng như production)'
expect_error 'rollback lần hai' 'Gỡ V675: quyền sequence đã ở trạng thái sau V525' psql_as postgres main -f "$rollback"
pass 'rollback lần hai bị chặn'
psql_as postgres main -f "$v675" >/dev/null
test "$(seq_acl main)" = "$target_acl" || fail 'apply lại sau rollback lệch'
expect_all_writes_ok main 'apply lại sau rollback'
pass 'apply lại sau rollback: ba đường ghi được'

# 7. Lệch thì dừng trước khi đổi gì.
psql_as postgres drift -c 'GRANT USAGE ON SEQUENCE public.auto_zalo_api_error_logs_id_seq TO anon' >/dev/null
drifted=$(seq_acl drift)
expect_error 'lệch quyền sequence' 'V675: quyền sequence đã khác lúc viết' psql_as postgres drift -f "$v675"
test "$(seq_acl drift)" = "$drifted" || fail 'V675 đổi ACL khi lệch'
pass 'quyền sequence lệch (thêm anon): V675 dừng, không đổi gì'
psql_as postgres drift -c 'REVOKE USAGE ON SEQUENCE public.auto_zalo_api_error_logs_id_seq FROM anon;
  REVOKE INSERT ON TABLE public.auto_zalo_api_error_logs FROM aka_agent_chat_api' >/dev/null
expect_error 'lệch quyền bảng' 'V675: quyền INSERT trên bảng đã khác lúc viết' psql_as postgres drift -f "$v675"
test "$(seq_acl drift)" = "$after_v525_acl" || fail 'V675 đổi ACL khi quyền bảng lệch'
pass 'quyền bảng lệch (ChatApi mất INSERT): V675 dừng, không đổi gì'
psql_as postgres drift -c 'GRANT INSERT ON TABLE public.auto_zalo_api_error_logs TO aka_agent_chat_api' >/dev/null
psql_as postgres drift -f "$v675" >/dev/null
test "$(seq_acl drift)" = "$target_acl" || fail 'V675 không apply được sau khi hết lệch'
pass 'hết lệch: V675 apply được'

# 8. Đang có traffic.
# Phiên ghi mở sẵn; giữa phiên, psql \! chạy V675 qua một kết nối khác (đồng bộ), rồi phiên cũ ghi tiếp trên cùng backend.
cat >"$test_dir/apply_v675.sh" <<EOF
#!/bin/sh
exec "$pg_bin/psql" -X -q -h 127.0.0.1 -p "$port" -U postgres -d "\$1" -v ON_ERROR_STOP=1 -f "$v675" >/dev/null
EOF
check_live() {
  db=$1; label=$2; rows=$3
  test "$(printf '%s\n' "$out" | grep -c 'ERROR')" -eq 1 \
    && printf '%s\n' "$out" | grep -F -q 'permission denied for sequence auto_zalo_api_error_logs_id_seq' \
    && printf '%s\n' "$out" | grep -q '^same_backend=true$' || { printf '%s\n' "$out"; fail "$label: kết quả phiên mở sẵn lệch"; }
  test "$(seq_acl "$db")" = "$target_acl" || fail "$label: V675 không apply"
  test "$(row_count "$db")" -eq "$rows" || fail "$label: có $(row_count "$db") dòng, cần $rows"
}
# ChatApi: câu INSERT đã PREPARE trên một kết nối giữ lâu (pool qua Supavisor).
cat >"$test_dir/live_chat.sql" <<'SQL'
\set ON_ERROR_STOP off
SELECT pg_backend_pid() AS pid_before \gset
\i chat_api_insert.sql
\! sh ./apply_v675.sh live_chat
EXECUTE chat_api_insert('7', '9', '11', '61226', '501', NULL, 'zalo_send_stranger_message', 'Nhắn tin người lạ',
  'sendMessage', '-1', 'v675 live', 'err_test', 'thất bại', '{}', '{}', '{}');
SELECT 'same_backend=' || (pg_backend_pid() = :pid_before)::text;
SQL
out=$(cd "$test_dir" && psql_as aka_agent_chat_api live_chat -At -f live_chat.sql 2>&1)
check_live live_chat 'ChatApi mở sẵn' 1
pass 'ChatApi: cùng kết nối, câu đã PREPARE lỗi trước V675 ghi được ngay sau V675, không cần nối lại'
# PostgREST: câu đã PREPARE trên kết nối authenticator, đổi vai trò từng giao dịch (Desktop rồi service_role).
cat >"$test_dir/live_rest.sql" <<'SQL'
\set ON_ERROR_STOP off
SELECT pg_backend_pid() AS pid_before \gset
PREPARE pgrst_ins(json) AS WITH pgrst_source AS (INSERT INTO "public"."auto_zalo_api_error_logs"("account_id", "action_code", "action_name", "api_name", "campaign_detail_id", "campaign_id", "campaign_input_data_id", "detail_status", "normalized_error_code", "organization_id", "raw_error", "request_payload", "staff_id", "target_payload", "zalo_error_code", "zalo_error_message") SELECT "pgrst_body"."account_id", "pgrst_body"."action_code", "pgrst_body"."action_name", "pgrst_body"."api_name", "pgrst_body"."campaign_detail_id", "pgrst_body"."campaign_id", "pgrst_body"."campaign_input_data_id", "pgrst_body"."detail_status", "pgrst_body"."normalized_error_code", "pgrst_body"."organization_id", "pgrst_body"."raw_error", "pgrst_body"."request_payload", "pgrst_body"."staff_id", "pgrst_body"."target_payload", "pgrst_body"."zalo_error_code", "pgrst_body"."zalo_error_message" FROM (SELECT $1 AS json_data) pgrst_payload, LATERAL (SELECT "account_id", "action_code", "action_name", "api_name", "campaign_detail_id", "campaign_id", "campaign_input_data_id", "detail_status", "normalized_error_code", "organization_id", "raw_error", "request_payload", "staff_id", "target_payload", "zalo_error_code", "zalo_error_message" FROM json_to_record(pgrst_payload.json_data) AS _("account_id" bigint, "action_code" text, "action_name" text, "api_name" text, "campaign_detail_id" bigint, "campaign_id" bigint, "campaign_input_data_id" bigint, "detail_status" text, "normalized_error_code" text, "organization_id" bigint, "raw_error" jsonb, "request_payload" jsonb, "staff_id" bigint, "target_payload" jsonb, "zalo_error_code" text, "zalo_error_message" text) ) pgrst_body  RETURNING 1) SELECT '' AS total_result_set, pg_catalog.count(_postgrest_t) AS page_total, array[]::text[] AS header, ''::text AS body, nullif(current_setting('response.headers', true), '') AS response_headers, nullif(current_setting('response.status', true), '') AS response_status, '' AS response_inserted FROM (SELECT * FROM pgrst_source) _postgrest_t;
BEGIN;
SELECT set_config('role', 'aka_agent_desktop', true);
EXECUTE pgrst_ins('{"account_id":11,"action_code":"zalo_send_stranger_message","action_name":"Nhắn tin người lạ","api_name":"sendMessage","campaign_detail_id":null,"campaign_id":61226,"campaign_input_data_id":501,"detail_status":"thất bại","normalized_error_code":"err_test","organization_id":9,"raw_error":{},"request_payload":{},"staff_id":7,"target_payload":{},"zalo_error_code":"-1","zalo_error_message":"v675 live"}');
COMMIT;
\! sh ./apply_v675.sh live_rest
BEGIN;
SELECT set_config('role', 'aka_agent_desktop', true);
EXECUTE pgrst_ins('{"account_id":11,"action_code":"zalo_send_stranger_message","action_name":"Nhắn tin người lạ","api_name":"sendMessage","campaign_detail_id":null,"campaign_id":61226,"campaign_input_data_id":501,"detail_status":"thất bại","normalized_error_code":"err_test","organization_id":9,"raw_error":{},"request_payload":{},"staff_id":7,"target_payload":{},"zalo_error_code":"-1","zalo_error_message":"v675 live"}');
COMMIT;
BEGIN;
SELECT set_config('role', 'service_role', true);
EXECUTE pgrst_ins('{"account_id":11,"action_code":"zalo_send_stranger_message","action_name":"Nhắn tin người lạ","api_name":"sendMessage","campaign_detail_id":null,"campaign_id":61226,"campaign_input_data_id":501,"detail_status":"thất bại","normalized_error_code":"err_test","organization_id":9,"raw_error":{},"request_payload":{},"staff_id":7,"target_payload":{},"zalo_error_code":"-1","zalo_error_message":"v675 live"}');
COMMIT;
SELECT 'same_backend=' || (pg_backend_pid() = :pid_before)::text;
SQL
out=$(cd "$test_dir" && psql_as authenticator live_rest -At -f live_rest.sql 2>&1)
check_live live_rest 'PostgREST mở sẵn' 2
pass 'PostgREST: cùng kết nối, câu đã PREPARE lỗi trước V675 ghi được ngay sau V675 (Desktop và service_role), không cần nối lại'
# Giao dịch ghi đang giữ RowExclusiveLock trên bảng và sequence (như một INSERT đang chạy): V675 không phải chờ.
psql_as postgres live_lock -c 'BEGIN' -c "INSERT INTO public.auto_zalo_api_error_logs (action_code) VALUES ('v675 lock')" \
  -c 'SELECT pg_sleep(8)' -c 'COMMIT' >"$test_dir/lock_writer.log" 2>&1 &
writer=$!
held() { scalar live_lock "SELECT count(*) FROM pg_locks WHERE mode = 'RowExclusiveLock' AND granted
  AND relation IN ('public.auto_zalo_api_error_logs'::regclass, 'public.auto_zalo_api_error_logs_id_seq'::regclass)"; }
tries=0
until [ "$(held)" -eq 2 ]; do
  tries=$((tries + 1)); [ "$tries" -lt 100 ] || fail 'giao dịch ghi không giữ được khoá'
  scalar live_lock 'SELECT pg_sleep(0.05)' >/dev/null
done
started=$(date +%s)
psql_as postgres live_lock -f "$v675" >/dev/null || fail 'V675 lỗi khi có giao dịch ghi đang mở'
elapsed=$(( $(date +%s) - started ))
test "$(held)" -eq 2 || fail 'giao dịch ghi đã xong trước V675, ca kiểm không còn ý nghĩa'
test "$elapsed" -le 2 || fail "V675 mất $elapsed giây, có chờ khoá"
wait "$writer" || { cat "$test_dir/lock_writer.log"; fail 'giao dịch ghi lỗi sau V675'; }
test "$(seq_acl live_lock)" = "$target_acl" && test "$(row_count live_lock)" -eq 1 || fail 'sau ca khoá trạng thái lệch'
pass "V675 xong trong ${elapsed} giây khi một giao dịch ghi đang giữ RowExclusiveLock trên bảng và sequence; giao dịch đó commit bình thường"

echo "OK $checks/$checks ($("$pg_bin/postgres" --version))"
