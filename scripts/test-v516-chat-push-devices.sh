#!/usr/bin/env bash
# Thử V516 (hai hàm để Chat đọc iPhone đang nhận thông báo đẩy và ghi kết quả gửi) trên PostgreSQL 16 cục bộ, không
# chạm production. Bảng thiết bị lấy nguyên văn từ migration V457; bảng phiên chỉ dựng các cột hàm đọc. Quyền mặc định
# của schema public dựng như production (EXECUTE hàm mới cho anon/authenticated/service_role), bảng bật RLS và chỉ chủ
# bảng có quyền, role aka_agent_chat_api có BYPASSRLS.
# Kiểm: apply, quyền (chỉ aka_agent_chat_api gọi được; không role nào đọc thẳng bảng), luật chọn thiết bị (bật, có token,
# phiên còn hạn và đúng nhân viên, tối đa 10 máy mỗi người, tối đa 500 nhân viên), ghi kết quả (sent / failed /
# invalid_token, từ chối giá trị khác), preflight (apply lại, thiếu role, bảng lệch cột), rollback rồi apply lại.
# Dùng: bash scripts/test-v516-chat-push-devices.sh   (PGBIN mặc định /usr/lib/postgresql/16/bin)
set -euo pipefail
PGBIN=${PGBIN:-/usr/lib/postgresql/16/bin}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
MIGRATION="$ROOT/migrations/migration_v516_chat_push_devices.sql"
ROLLBACK="$ROOT/migrations/rollback_v516_chat_push_devices.sql"
V457="$ROOT/migrations/migration_v457_notification_center.sql"
WORK=$(mktemp -d "${TMPDIR:-/tmp}/v516.XXXXXX")
as_pg() { if [ "$(id -u)" = 0 ]; then runuser -u postgres -- "$@"; else "$@"; fi; }
[ "$(id -u)" = 0 ] && chown postgres "$WORK"
chmod 755 "$WORK"
cleanup() { as_pg "$PGBIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT
as_pg "$PGBIN/initdb" -D "$WORK/data" -A trust -U postgres -E UTF8 --locale=C >/dev/null
as_pg "$PGBIN/pg_ctl" -D "$WORK/data" -o "-k $WORK -c listen_addresses=''" -l "$WORK/log" -w start >/dev/null
DB=fixture
psql_db() { as_pg "$PGBIN/psql" -h "$WORK" -U postgres -d "$DB" -v ON_ERROR_STOP=1 -qAt "$@"; }
q() { psql_db -c "$1"; }
# Gọi dưới role của Chat API, như bộ phát thông báo.
chat() { psql_db -c "SET ROLE aka_agent_chat_api; $1"; }
as_role() { psql_db -c "SET ROLE $1; $2"; }
run_file() { psql_db -f "$1" 2>&1; }
pass=0
ok() { pass=$((pass + 1)); echo "ok $pass - $1"; }
fail() { echo "FAIL - $1" >&2; exit 1; }
expect() { [ "$2" = "$3" ] && ok "$1" || fail "$1 (mong đợi '$3', nhận '$2')"; }
refuse() { local name=$1 pattern=$2 out; shift 2; if out=$("$@" 2>&1); then fail "$name (không bị từ chối)"; fi
  case "$out" in *"$pattern"*) ok "$name" ;; *) fail "$name (thông báo khác: $out)" ;; esac; }

as_pg "$PGBIN/psql" -h "$WORK" -U postgres -d postgres -v ON_ERROR_STOP=1 -q <<'SQL'
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE ROLE aka_agent_desktop NOLOGIN; CREATE ROLE aka_agent_chat_api NOLOGIN BYPASSRLS;
CREATE DATABASE fixture; CREATE DATABASE drifted; CREATE DATABASE norole;
SQL

# Bảng thiết bị và ba index của nó: nguyên văn từ V457.
DEVICE_DDL=$(awk '/^CREATE TABLE public.auto_notification_devices \(/,/^\);/' "$V457"; grep -E '^CREATE (UNIQUE )?INDEX (uq|idx)_auto_notification_devices_' "$V457")
[ -n "$DEVICE_DDL" ] || fail "không đọc được DDL bảng thiết bị từ V457"

build_fixture() {
  psql_db >/dev/null <<SQL
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role, aka_agent_desktop, aka_agent_chat_api;
CREATE TABLE public.auto_control_sessions (
  id uuid PRIMARY KEY, staff_id bigint NOT NULL, organization_id bigint NOT NULL, token_hash text NOT NULL DEFAULT '',
  client_type text NOT NULL DEFAULT 'native', user_agent text, created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz, expires_at timestamptz NOT NULL, revoked_at timestamptz);
$DEVICE_DDL
ALTER TABLE public.auto_control_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auto_notification_devices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.auto_control_sessions, public.auto_notification_devices FROM PUBLIC, anon, authenticated, service_role;
SQL
}
build_fixture

token() { printf '%064d' "$1"; }
session() { printf '00000000-0000-4000-8000-%012d' "$1"; }
install() { printf '11111111-1111-4111-8111-%012d' "$1"; }
add_session() { # id staff expires_in revoked?
  q "INSERT INTO public.auto_control_sessions (id, staff_id, organization_id, expires_at, revoked_at)
     VALUES ('$(session "$1")', $2, 1, now() + interval '$3', $([ "${4:-}" = revoked ] && echo "now()" || echo NULL))"; }
add_device() { # id staff session token|- [extra columns sql]
  local tok; if [ "$4" = - ]; then tok=NULL; else tok="'$(token "$4")'"; fi
  q "INSERT INTO public.auto_notification_devices (staff_id, organization_id, control_session_id, installation_id, bundle_id, push_token${5:+, $5})
     VALUES ($2, 1, $([ "$3" = - ] && echo NULL || echo "'$(session "$3")'"), '$(install "$1")', 'net.akabiz.agent', $tok${6:+, $6})" >/dev/null; }

# Nhân viên 1: một máy đang nhận, và ba máy không được nhận (đã tắt, đã gỡ, chưa có token).
add_session 1 1 '7 days'
add_device 1 1 1 101
add_device 2 1 1 102 is_enabled false
add_device 3 1 1 103 "is_active, deactivated_reason" "false, 'user_removed'"
add_device 4 1 1 -
# Nhân viên 2: phiên bị thu hồi, phiên hết hạn, phiên của người khác, không có phiên.
add_session 2 2 '7 days' revoked
add_session 3 2 '-1 minute'
add_device 5 2 2 105
add_device 6 2 3 106
add_device 7 2 1 107
add_device 8 2 - 108
# Nhân viên 3: 12 máy đang nhận, đăng ký lần lượt cách nhau một phút; máy sandbox của bản dev.
add_session 4 3 '7 days'
for n in $(seq 1 12); do
  add_device $((20 + n)) 3 4 $((120 + n)) "last_registered_at" "now() - interval '$((13 - n)) minutes'"
done
q "UPDATE public.auto_notification_devices SET apns_environment = 'sandbox', bundle_id = 'net.akabiz.agent.dev' WHERE push_token = '$(token 132)'" >/dev/null
# Nhân viên 4: một máy đang nhận, không ai hỏi tới.
add_session 5 4 '7 days'
add_device 40 4 5 140
id_of() { q "SELECT id FROM public.auto_notification_devices WHERE push_token = '$(token "$1")'"; }
before=$(q "SELECT md5(string_agg(d::text, '|' ORDER BY d.id)) FROM public.auto_notification_devices d")

out=$(run_file "$MIGRATION") || fail "apply V516: $out"
ok "apply V516"
expect "hai hàm có mặt" "$(q "SELECT count(*) FROM pg_proc WHERE proname LIKE 'aka_agent_chat_push%'")" 2
expect "apply không đổi dòng thiết bị nào" "$(q "SELECT md5(string_agg(d::text, '|' ORDER BY d.id)) FROM public.auto_notification_devices d")" "$before"

# ---- Quyền ----
for role in anon authenticated service_role aka_agent_desktop; do
  refuse "$role không gọi được hàm đọc thiết bị" "permission denied" as_role "$role" "SELECT * FROM public.aka_agent_chat_push_devices(ARRAY[1]::bigint[])"
  refuse "$role không gọi được hàm ghi kết quả" "permission denied" as_role "$role" "SELECT public.aka_agent_chat_push_device_result(1, 'sent')"
done
refuse "Chat không đọc thẳng được bảng thiết bị" "permission denied" chat "SELECT count(*) FROM public.auto_notification_devices"
refuse "Chat không đọc thẳng được bảng phiên" "permission denied" chat "SELECT count(*) FROM public.auto_control_sessions"
refuse "Chat không sửa thẳng được bảng thiết bị" "permission denied" chat "UPDATE public.auto_notification_devices SET is_active = false"
expect "ACL của hàm chỉ có chủ hàm và aka_agent_chat_api" \
  "$(q "SELECT string_agg(DISTINCT pg_get_userbyid(a.grantee), ',' ORDER BY pg_get_userbyid(a.grantee)) FROM pg_proc p, aclexplode(p.proacl) a WHERE p.proname LIKE 'aka_agent_chat_push%'")" \
  "aka_agent_chat_api,postgres"
expect "cả hai là SECURITY DEFINER với search_path cố định" \
  "$(q "SELECT bool_and(prosecdef AND proconfig = ARRAY['search_path=pg_catalog, public']) FROM pg_proc WHERE proname LIKE 'aka_agent_chat_push%'")" t

# ---- Chọn thiết bị ----
devices() { chat "SELECT string_agg(staff_id || ':' || right(push_token, 3), ',' ORDER BY staff_id, device_id) FROM public.aka_agent_chat_push_devices($1)"; }
expect "chỉ máy đang bật, có token, phiên còn hạn và đúng nhân viên" "$(devices "ARRAY[1,2]::bigint[]")" "1:101"
expect "cột trả về: mã máy, nhân viên, token, môi trường, bundle" \
  "$(chat "SELECT device_id = $(id_of 101), staff_id, push_token = '$(token 101)', apns_environment, bundle_id FROM public.aka_agent_chat_push_devices(ARRAY[1]::bigint[])")" \
  "t|1|t|production|net.akabiz.agent"
expect "tối đa 10 máy mỗi nhân viên, máy đăng ký gần nhất trước" "$(devices "ARRAY[3]::bigint[]")" \
  "3:123,3:124,3:125,3:126,3:127,3:128,3:129,3:130,3:131,3:132"
expect "máy sandbox của bản dev giữ đúng môi trường và bundle" \
  "$(chat "SELECT apns_environment || '/' || bundle_id FROM public.aka_agent_chat_push_devices(ARRAY[3]::bigint[]) WHERE push_token = '$(token 132)'")" \
  "sandbox/net.akabiz.agent.dev"
expect "nhân viên không được hỏi thì không có trong kết quả" "$(devices "ARRAY[1,3]::bigint[]" | tr ',' '\n' | grep -c '^4:' || true)" 0
expect "nhiều nhân viên một lượt" "$(chat "SELECT count(*) || '/' || count(DISTINCT staff_id) FROM public.aka_agent_chat_push_devices(ARRAY[1,2,3,4,999]::bigint[])")" "12/3"
expect "mảng rỗng" "$(chat "SELECT count(*) FROM public.aka_agent_chat_push_devices(ARRAY[]::bigint[])")" 0
expect "mảng NULL" "$(chat "SELECT count(*) FROM public.aka_agent_chat_push_devices(NULL)")" 0
expect "chỉ 500 nhân viên đầu của một lượt gọi" \
  "$(chat "SELECT count(*) FROM public.aka_agent_chat_push_devices((SELECT array_agg(g) FROM generate_series(1000, 1499) g) || ARRAY[1]::bigint[])")" 0
expect "500 nhân viên thì đủ" \
  "$(chat "SELECT count(*) FROM public.aka_agent_chat_push_devices((SELECT array_agg(g) FROM generate_series(1000, 1498) g) || ARRAY[1]::bigint[])")" 1
# Phiên vừa bị thu hồi hoặc thiết bị vừa bị tắt thì thôi nhận ngay ở lượt đọc kế tiếp.
q "UPDATE public.auto_control_sessions SET revoked_at = now() WHERE id = '$(session 5)'" >/dev/null
expect "phiên vừa bị thu hồi" "$(devices "ARRAY[4]::bigint[]")" ""
q "UPDATE public.auto_control_sessions SET revoked_at = NULL WHERE id = '$(session 5)'" >/dev/null
expect "phiên được dùng lại" "$(devices "ARRAY[4]::bigint[]")" "4:140"

# ---- Ghi kết quả ----
dev=$(id_of 140)
row() { q "SELECT is_active, coalesce(deactivated_reason, '-'), failure_count, last_success_at IS NOT NULL, last_failure_at IS NOT NULL FROM public.auto_notification_devices WHERE id = $dev"; }
q "UPDATE public.auto_notification_devices SET failure_count = 3 WHERE id = $dev" >/dev/null
chat "SELECT public.aka_agent_chat_push_device_result($dev, 'failed')" >/dev/null
expect "failed: cộng số lần lỗi, ghi lần lỗi gần nhất" "$(row)" "t|-|4|f|t"
chat "SELECT public.aka_agent_chat_push_device_result($dev, 'sent')" >/dev/null
expect "sent: xoá số lần lỗi, ghi lần gửi được gần nhất" "$(row)" "t|-|0|t|t"
refuse "kết quả lạ bị từ chối" "chat_push_invalid_outcome" chat "SELECT public.aka_agent_chat_push_device_result($dev, 'retry')"
refuse "kết quả NULL bị từ chối" "chat_push_invalid_outcome" chat "SELECT public.aka_agent_chat_push_device_result($dev, NULL)"
refuse "mã máy NULL bị từ chối" "chat_push_invalid_outcome" chat "SELECT public.aka_agent_chat_push_device_result(NULL, 'sent')"
expect "kết quả bị từ chối không đổi gì" "$(row)" "t|-|0|t|t"
chat "SELECT public.aka_agent_chat_push_device_result(999999, 'invalid_token')" >/dev/null
ok "mã máy không có: không lỗi, không đổi gì"
chat "SELECT public.aka_agent_chat_push_device_result($dev, 'invalid_token')" >/dev/null
expect "invalid_token: máy ngừng nhận với lý do token_invalid" "$(row)" "f|token_invalid|0|t|t"
expect "máy đã ngừng không còn được trả về" "$(devices "ARRAY[4]::bigint[]")" ""
q "UPDATE public.auto_notification_devices SET last_success_at = NULL WHERE id = $dev" >/dev/null
chat "SELECT public.aka_agent_chat_push_device_result($dev, 'sent')" >/dev/null
expect "máy đã ngừng không bị ghi thêm" "$(row)" "f|token_invalid|0|f|t"
gone=$(id_of 103)
chat "SELECT public.aka_agent_chat_push_device_result($gone, 'invalid_token')" >/dev/null
expect "máy người dùng đã gỡ giữ nguyên lý do của nó" "$(q "SELECT deactivated_reason FROM public.auto_notification_devices WHERE id = $gone")" "user_removed"
expect "chỉ đúng một máy bị đổi trạng thái" "$(q "SELECT count(*) FROM public.auto_notification_devices WHERE deactivated_reason = 'token_invalid'")" 1

# ---- Preflight ----
refuse "apply lại bị từ chối" "đã có" run_file "$MIGRATION"
DB=norole
build_fixture
q "ALTER ROLE aka_agent_chat_api RENAME TO aka_agent_chat_api_gone" >/dev/null
refuse "thiếu role aka_agent_chat_api thì không apply" "thiếu role aka_agent_chat_api" run_file "$MIGRATION"
q "ALTER ROLE aka_agent_chat_api_gone RENAME TO aka_agent_chat_api" >/dev/null
expect "apply bị từ chối không để lại hàm nào" "$(q "SELECT count(*) FROM pg_proc WHERE proname LIKE 'aka_agent_chat_push%'")" 0
DB=drifted
build_fixture
q "ALTER TABLE public.auto_notification_devices RENAME COLUMN is_enabled TO enabled" >/dev/null
refuse "bảng thiết bị lệch cột thì không apply" "thiếu hoặc khác kiểu cột: is_enabled" run_file "$MIGRATION"
q "ALTER TABLE public.auto_notification_devices RENAME COLUMN enabled TO is_enabled" >/dev/null
q "ALTER TABLE public.auto_control_sessions ALTER COLUMN staff_id TYPE integer" >/dev/null
refuse "bảng phiên khác kiểu cột thì không apply" "thiếu hoặc khác kiểu cột: staff_id" run_file "$MIGRATION"
expect "apply bị từ chối không để lại hàm nào (bảng lệch)" "$(q "SELECT count(*) FROM pg_proc WHERE proname LIKE 'aka_agent_chat_push%'")" 0
DB=fixture

# ---- Rollback rồi apply lại ----
out=$(run_file "$ROLLBACK") || fail "rollback V516: $out"
expect "rollback xoá cả hai hàm" "$(q "SELECT count(*) FROM pg_proc WHERE proname LIKE 'aka_agent_chat_push%'")" 0
expect "rollback không đụng bảng thiết bị" "$(q "SELECT count(*) FROM public.auto_notification_devices")" 21
out=$(run_file "$ROLLBACK") || fail "rollback lần hai: $out"
ok "rollback chạy lại không lỗi"
out=$(run_file "$MIGRATION") || fail "apply lại sau rollback: $out"
expect "apply lại sau rollback" "$(devices "ARRAY[1]::bigint[]")" "1:101"

echo "V516: $pass khẳng định đạt"
