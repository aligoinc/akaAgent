#!/usr/bin/env bash
# Thử V493 (Desktop gọi hàm lọc trùng SĐT V491 bằng token Desktop) trên PostgreSQL 16 cục bộ, không chạm production.
# Dùng fixture của WebApp (scripts/test-fixtures/campaign-input-duplicates-schema.sql: dữ liệu mẫu + chuỗi xác thực token
# Desktop chép từ production) rồi apply V491 và V493 của repo này. Kiểm: quyền, gọi bằng token Desktop ra đúng JSON như
# service_role, chặn token/mật khẩu/tổ chức/tài khoản sai, anon vẫn bị chặn, preflight từ chối apply lại hoặc khi hàm V491
# khác bản đã apply, rollback chỉ thu quyền Desktop.
# Dùng: AKA_AGENT_WEBAPP_REPO=<checkout akaAgentWebApp> bash scripts/test-v493-campaign-input-duplicates-desktop.sh
#       (PGBIN mặc định /usr/lib/postgresql/16/bin; chạy bằng root thì tự chạy Postgres dưới user postgres)
set -euo pipefail
PGBIN=${PGBIN:-/usr/lib/postgresql/16/bin}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
WEBAPP=${AKA_AGENT_WEBAPP_REPO:-$ROOT/../akaAgentWebApp}
FIXTURE="$WEBAPP/scripts/test-fixtures/campaign-input-duplicates-schema.sql"
V491="$ROOT/migrations/migration_v491_campaign_input_duplicates.sql"
R491="$ROOT/migrations/rollback_v491_campaign_input_duplicates.sql"
V493="$ROOT/migrations/migration_v493_campaign_input_duplicates_desktop.sql"
R493="$ROOT/migrations/rollback_v493_campaign_input_duplicates_desktop.sql"
for file in "$FIXTURE" "$V491" "$R491" "$V493" "$R493"; do
  [ -f "$file" ] || { echo "Không thấy $file (đặt AKA_AGENT_WEBAPP_REPO tới checkout akaAgentWebApp)" >&2; exit 1; }
done
WORK=$(mktemp -d "${TMPDIR:-/tmp}/v493.XXXXXX")
as_pg() { if [ "$(id -u)" = 0 ]; then runuser -u postgres -- "$@"; else "$@"; fi; }
cp "$FIXTURE" "$V491" "$R491" "$V493" "$R493" "$WORK/"
if [ "$(id -u)" = 0 ]; then chown -R postgres "$WORK"; chmod 755 "$WORK"; fi
cleanup() { as_pg "$PGBIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT
as_pg "$PGBIN/initdb" -D "$WORK/data" -A trust -U postgres -E UTF8 --locale=C >/dev/null
as_pg "$PGBIN/pg_ctl" -D "$WORK/data" -o "-k $WORK -c listen_addresses=''" -l "$WORK/log" -w start >/dev/null
PSQL=("$PGBIN/psql" -X -h "$WORK" -U postgres -d postgres -v ON_ERROR_STOP=1 -qAt)
run_file() { as_pg "${PSQL[@]}" -f "$WORK/$1"; }
sql() { as_pg "${PSQL[@]}" "$@"; }
pass=0
ok() { pass=$((pass + 1)); echo "ok $pass - $1"; }
fail() { echo "FAIL - $1" >&2; exit 1; }
# Apply một file và đòi thất bại có chữ mong đợi.
refused() {
  local file=$1 marker=$2 label=$3
  if run_file "$file" >"$WORK/out.log" 2>&1; then fail "$label: apply thành công ngoài dự kiến"; fi
  grep -q "$marker" "$WORK/out.log" || { cat "$WORK/out.log" >&2; fail "$label: lỗi khác dự kiến"; }
  ok "$label"
}
FN="public.aka_agent_read_campaign_input_duplicates(bigint,bigint,text,text,jsonb)"
ACL_SQL="SELECT array_to_string(array_agg(g ORDER BY g), ',') FROM (SELECT DISTINCT CASE WHEN a.grantee = 0 THEN 'PUBLIC'
  ELSE a.grantee::regrole::text END AS g FROM pg_proc p, aclexplode(p.proacl) a WHERE p.oid = to_regprocedure('$FN')) x"

run_file "$(basename "$FIXTURE")" >/dev/null
run_file "$(basename "$V491")" >/dev/null
COUNTS_SQL="SELECT (SELECT count(*) FROM auto_campaign_input_data) || ' ' || (SELECT count(*) FROM auto_campaigns) || ' ' || (SELECT count(*) FROM auto_system_settings)"
counts_before=$(sql -c "$COUNTS_SQL")
[ "$(sql -c "$ACL_SQL")" = "postgres,service_role" ] || fail "ACL sau V491"
ok "V491 apply: chỉ postgres, service_role"
[ "$(sql -c "SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure('$FN')")" = "fec350637de79d8d65e6cc1a9cbfc34f" ] \
  || fail "md5 prosrc cục bộ khác bản production"
ok "md5 thân hàm cục bộ = production (fec35063…)"

# Preflight: hàm V491 bị đổi thuộc tính hoặc quyền thì dừng, không cấp quyền.
sql -c "ALTER FUNCTION $FN SET statement_timeout = '60s'"
refused "$(basename "$V493")" "v493_reader_attributes_unexpected" "preflight dừng khi timeout của hàm khác 20s"
sql -c "ALTER FUNCTION $FN SET statement_timeout = '20s'"
sql -c "GRANT EXECUTE ON FUNCTION $FN TO anon"
refused "$(basename "$V493")" "v493_reader_acl_unexpected" "preflight dừng khi ACL khác bản V491"
sql -c "REVOKE EXECUTE ON FUNCTION $FN FROM anon"
[ "$(sql -c "$ACL_SQL")" = "postgres,service_role" ] || fail "ACL chưa về bản V491"

run_file "$(basename "$V493")" >/dev/null
[ "$(sql -c "$ACL_SQL")" = "aka_agent_desktop,postgres,service_role" ] || fail "ACL sau V493"
ok "V493 apply: thêm đúng aka_agent_desktop"
[ "$(sql -c "SELECT md5(prosrc) || '|' || array_to_string(proconfig, ';') || '|' || prosecdef::text || provolatile::text FROM pg_proc WHERE oid = to_regprocedure('$FN')")" \
  = "fec350637de79d8d65e6cc1a9cbfc34f|search_path=pg_catalog, public;statement_timeout=20s|trues" ] || fail "thân/thuộc tính hàm đổi sau V493"
ok "thân hàm, SECURITY DEFINER, STABLE, 20s giữ nguyên"

# Gọi như PostgREST: token Desktop (role + sub) và mật khẩu tự động hóa của staff.
sql >"$WORK/calls.log" 2>&1 <<'SQL' || { cat "$WORK/calls.log" >&2; fail "kiểm thử gọi hàm"; }
SET TIME ZONE 'UTC';
CREATE SCHEMA t;
CREATE TABLE t.cmp(who text PRIMARY KEY, v jsonb);
CREATE FUNCTION t.q(p_accounts jsonb DEFAULT '[11,12]', p_action text DEFAULT 'zalo_message_phone') RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('actionId', p_action, 'accountIds', p_accounts, 'days', 30,
    'phones', '["0912000001","0912000003","+84 912 000 004","0912000099"]'::jsonb)
$$;
CREATE FUNCTION t.fails(p_label text, p_sql text, p_state text, p_message text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RAISE EXCEPTION '% unexpectedly succeeded', p_label;
EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE IS DISTINCT FROM p_state OR position(p_message IN SQLERRM) = 0 THEN
    RAISE EXCEPTION '% failed differently: % %', p_label, SQLSTATE, SQLERRM;
  END IF;
  RETURN 'ok ' || p_label;
END $$;
GRANT USAGE ON SCHEMA t TO service_role, aka_agent_desktop, anon, authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA t TO service_role, aka_agent_desktop, anon, authenticated;
GRANT INSERT ON t.cmp TO service_role, aka_agent_desktop;

SET request.jwt.claims = '{"role":"service_role"}';
BEGIN;
SET LOCAL ROLE service_role;
INSERT INTO t.cmp SELECT 'service', public.aka_agent_read_campaign_input_duplicates(7, 9, NULL, NULL, t.q());
COMMIT;

SET request.jwt.claims = '{"role":"aka_agent_desktop","sub":"00000000-0000-4000-8000-000000000007"}';
BEGIN;
SET LOCAL ROLE aka_agent_desktop;
INSERT INTO t.cmp SELECT 'desktop', public.aka_agent_read_campaign_input_duplicates(7, 9, 'nv7', 'pw7', t.q());
SELECT t.fails('desktop token of another staff', $q$SELECT public.aka_agent_read_campaign_input_duplicates(8, 9, 'nv8', 'pw8', t.q('[14]'))$q$, '42501', 'desktop_staff_scope_denied');
SELECT t.fails('desktop wrong password', $q$SELECT public.aka_agent_read_campaign_input_duplicates(7, 9, 'nv7', 'sai', t.q())$q$, 'P0001', 'automation_auth_invalid');
SELECT t.fails('desktop without credentials', $q$SELECT public.aka_agent_read_campaign_input_duplicates(7, 9, NULL, NULL, t.q())$q$, 'P0001', 'automation_auth_required');
SELECT t.fails('desktop wrong organization', $q$SELECT public.aka_agent_read_campaign_input_duplicates(7, 10, 'nv7', 'pw7', t.q())$q$, 'P0001', 'automation_auth_invalid');
SELECT t.fails('desktop account of another staff', $q$SELECT public.aka_agent_read_campaign_input_duplicates(7, 9, 'nv7', 'pw7', t.q('[11,14]'))$q$, '42501', 'input_duplicates_account_scope_denied');
SELECT t.fails('desktop SMS account', $q$SELECT public.aka_agent_read_campaign_input_duplicates(7, 9, 'nv7', 'pw7', t.q('[15]'))$q$, '42501', 'input_duplicates_account_scope_denied');
SELECT t.fails('desktop account of another organization', $q$SELECT public.aka_agent_read_campaign_input_duplicates(7, 9, 'nv7', 'pw7', t.q('[16]'))$q$, '42501', 'input_duplicates_account_scope_denied');
SELECT t.fails('desktop unsupported campaign type', $q$SELECT public.aka_agent_read_campaign_input_duplicates(7, 9, 'nv7', 'pw7', t.q('[11]', 'zalo_message_friend'))$q$, '22023', 'input_duplicates_unsupported_action');
COMMIT;

SET request.jwt.claims = '{"role":"aka_agent_desktop","sub":"00000000-0000-4000-8000-000000000999"}';
BEGIN;
SET LOCAL ROLE aka_agent_desktop;
SELECT t.fails('desktop token without staff binding', $q$SELECT public.aka_agent_read_campaign_input_duplicates(7, 9, 'nv7', 'pw7', t.q())$q$, '42501', 'desktop_staff_scope_denied');
COMMIT;

RESET request.jwt.claims;
BEGIN;
SET LOCAL ROLE anon;
SELECT t.fails('anon still refused', $q$SELECT public.aka_agent_read_campaign_input_duplicates(7, 9, 'nv7', 'pw7', t.q())$q$, '42501', 'permission denied');
COMMIT;
BEGIN;
SET LOCAL ROLE authenticated;
SELECT t.fails('authenticated still refused', $q$SELECT public.aka_agent_read_campaign_input_duplicates(7, 9, 'nv7', 'pw7', t.q())$q$, '42501', 'permission denied');
COMMIT;

SELECT CASE WHEN (SELECT v - 'checkedAt' FROM t.cmp WHERE who = 'desktop') = (SELECT v - 'checkedAt' FROM t.cmp WHERE who = 'service')
  AND (SELECT jsonb_path_query_array(v, '$.items[*].phone') FROM t.cmp WHERE who = 'desktop')
    = '["0912000001","0912000003","0912000004"]'::jsonb
  AND (SELECT (v->>'phoneCount')::int FROM t.cmp WHERE who = 'desktop') = 4
  THEN 'ok desktop JSON equals service_role JSON (3 phones already uploaded, +84 normalized)' ELSE 'FAIL desktop JSON differs' END;
SQL
grep -q '^FAIL' "$WORK/calls.log" && { cat "$WORK/calls.log" >&2; fail "kết quả gọi hàm"; }
while IFS= read -r line; do ok "${line#ok }"; done < <(grep '^ok ' "$WORK/calls.log")
[ "$(grep -c '^ok ' "$WORK/calls.log")" = 12 ] || { cat "$WORK/calls.log" >&2; fail "thiếu kiểm tra gọi hàm"; }

refused "$(basename "$V493")" "v493_already_applied_do_not_reapply" "apply lại V493 bị từ chối"

run_file "$(basename "$R493")" >/dev/null
[ "$(sql -c "$ACL_SQL")" = "postgres,service_role" ] || fail "ACL sau rollback V493"
ok "rollback V493: về đúng postgres, service_role"
out=$(sql 2>&1 <<'SQL' || true
SET request.jwt.claims = '{"role":"aka_agent_desktop","sub":"00000000-0000-4000-8000-000000000007"}';
SET ROLE aka_agent_desktop;
SELECT public.aka_agent_read_campaign_input_duplicates(7, 9, 'nv7', 'pw7', '{"actionId":"zalo_message_phone","accountIds":[11],"days":30,"phones":[]}'::jsonb);
SQL
)
echo "$out" | grep -q "permission denied for function aka_agent_read_campaign_input_duplicates" || { echo "$out" >&2; fail "Desktop sau rollback"; }
ok "sau rollback Desktop nhận 42501 permission denied for function (app báo đang cập nhật)"
svc=$(sql -c "SET request.jwt.claims = '{\"role\":\"service_role\"}'" -c "SET ROLE service_role" \
  -c "SELECT (public.aka_agent_read_campaign_input_duplicates(7, 9, NULL, NULL, '{\"actionId\":\"zalo_message_phone\",\"accountIds\":[11,12],\"days\":30,\"phones\":[\"0912000001\"]}'::jsonb)->>'phoneCount')")
[ "$svc" = "1" ] || fail "service_role sau rollback V493"
ok "service_role (WebApp API) vẫn đọc được sau rollback V493"

run_file "$(basename "$V493")" >/dev/null
[ "$(sql -c "$ACL_SQL")" = "aka_agent_desktop,postgres,service_role" ] || fail "apply lại sau rollback"
ok "apply lại V493 sau rollback đạt"

run_file "$(basename "$R491")" >/dev/null
refused "$(basename "$V493")" "v493_v491_reader_missing" "thiếu hàm V491 thì V493 dừng"
[ "$(sql -c "SELECT (SELECT count(*) FROM auto_campaign_input_data) || ' ' || (SELECT count(*) FROM auto_campaigns)")" = "$(echo "$counts_before" | cut -d' ' -f1-2)" ] \
  || fail "dữ liệu fixture bị đổi"
ok "dữ liệu chiến dịch không đổi (rollback V491 chỉ xóa hàm + công tắc)"

echo "V493: $pass/$pass kiểm tra đạt"
