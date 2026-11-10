#!/usr/bin/env bash
# Thử V489 (Desktop gọi hàm báo cáo chiến dịch V487 bằng token Desktop) trên PostgreSQL 16 cục bộ, không chạm production.
# Dùng fixture của WebApp (scripts/test-fixtures/campaign-run-report-schema.sql: dữ liệu mẫu + chuỗi xác thực token Desktop
# chép từ production) rồi apply V487 và V489 của repo này. Kiểm: quyền, gọi bằng token Desktop ra đúng JSON như service_role,
# chặn token/mật khẩu/tổ chức/chiến dịch sai, anon vẫn bị chặn, preflight từ chối apply lại hoặc khi hàm V487 khác bản đã apply,
# rollback chỉ thu quyền Desktop.
# Dùng: AKA_AGENT_WEBAPP_REPO=<checkout akaAgentWebApp> bash scripts/test-v489-campaign-run-report-desktop.sh
#       (PGBIN mặc định /usr/lib/postgresql/16/bin; chạy bằng root thì tự chạy Postgres dưới user postgres)
set -euo pipefail
PGBIN=${PGBIN:-/usr/lib/postgresql/16/bin}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
WEBAPP=${AKA_AGENT_WEBAPP_REPO:-$ROOT/../akaAgentWebApp}
FIXTURE="$WEBAPP/scripts/test-fixtures/campaign-run-report-schema.sql"
V487="$ROOT/migrations/migration_v487_campaign_run_report.sql"
R487="$ROOT/migrations/rollback_v487_campaign_run_report.sql"
V489="$ROOT/migrations/migration_v489_campaign_run_report_desktop.sql"
R489="$ROOT/migrations/rollback_v489_campaign_run_report_desktop.sql"
for file in "$FIXTURE" "$V487" "$R487" "$V489" "$R489"; do
  [ -f "$file" ] || { echo "Không thấy $file (đặt AKA_AGENT_WEBAPP_REPO tới checkout akaAgentWebApp)" >&2; exit 1; }
done
WORK=$(mktemp -d "${TMPDIR:-/tmp}/v489.XXXXXX")
as_pg() { if [ "$(id -u)" = 0 ]; then runuser -u postgres -- "$@"; else "$@"; fi; }
cp "$FIXTURE" "$V487" "$R487" "$V489" "$R489" "$WORK/"
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
ACL_SQL="SELECT array_to_string(array_agg(g ORDER BY g), ',') FROM (SELECT DISTINCT CASE WHEN a.grantee = 0 THEN 'PUBLIC'
  ELSE a.grantee::regrole::text END AS g FROM pg_proc p, aclexplode(p.proacl) a
  WHERE p.oid = to_regprocedure('public.aka_agent_read_campaign_run_report(bigint,bigint,text,text,bigint,jsonb)')) x"

run_file "$(basename "$FIXTURE")" >/dev/null
run_file "$(basename "$V487")" >/dev/null
COUNTS_SQL="SELECT (SELECT count(*) FROM auto_campaign_details) || ' ' || (SELECT count(*) FROM auto_campaign_input_data) || ' ' || (SELECT count(*) FROM auto_campaigns)"
counts_before=$(sql -c "$COUNTS_SQL")
[ "$(sql -c "$ACL_SQL")" = "postgres,service_role" ] || fail "ACL sau V487"
ok "V487 apply: chỉ postgres, service_role"
[ "$(sql -c "SELECT md5(prosrc) FROM pg_proc WHERE proname = 'aka_agent_read_campaign_run_report'")" = "4bd734ca25612bfdade631c779373d42" ] \
  || fail "md5 prosrc cục bộ khác bản production"
ok "md5 thân hàm cục bộ = production (4bd734ca…)"

# Preflight: hàm V487 bị đổi thuộc tính hoặc quyền thì dừng, không cấp quyền.
sql -c "ALTER FUNCTION public.aka_agent_read_campaign_run_report(bigint,bigint,text,text,bigint,jsonb) SET statement_timeout = '20s'"
refused "$(basename "$V489")" "v489_reader_attributes_unexpected" "preflight dừng khi timeout của hàm khác 60s"
sql -c "ALTER FUNCTION public.aka_agent_read_campaign_run_report(bigint,bigint,text,text,bigint,jsonb) SET statement_timeout = '60s'"
sql -c "GRANT EXECUTE ON FUNCTION public.aka_agent_read_campaign_run_report(bigint,bigint,text,text,bigint,jsonb) TO anon"
refused "$(basename "$V489")" "v489_reader_acl_unexpected" "preflight dừng khi ACL khác bản V487"
sql -c "REVOKE EXECUTE ON FUNCTION public.aka_agent_read_campaign_run_report(bigint,bigint,text,text,bigint,jsonb) FROM anon"
[ "$(sql -c "$ACL_SQL")" = "postgres,service_role" ] || fail "ACL chưa về bản V487"

run_file "$(basename "$V489")" >/dev/null
[ "$(sql -c "$ACL_SQL")" = "aka_agent_desktop,postgres,service_role" ] || fail "ACL sau V489"
ok "V489 apply: thêm đúng aka_agent_desktop"
[ "$(sql -c "SELECT md5(prosrc) || '|' || array_to_string(proconfig, ';') || '|' || prosecdef::text || provolatile::text FROM pg_proc WHERE proname = 'aka_agent_read_campaign_run_report'")" \
  = "4bd734ca25612bfdade631c779373d42|search_path=pg_catalog, public;statement_timeout=60s|trues" ] || fail "thân/thuộc tính hàm đổi sau V489"
ok "thân hàm, SECURITY DEFINER, STABLE, 60s giữ nguyên"

# Gọi như PostgREST: token Desktop (role + sub) và mật khẩu tự động hóa của staff.
sql >"$WORK/calls.log" 2>&1 <<'SQL' || { cat "$WORK/calls.log" >&2; fail "kiểm thử gọi hàm"; }
SET TIME ZONE 'UTC';
CREATE SCHEMA t;
CREATE TABLE t.cmp(who text PRIMARY KEY, v jsonb);
CREATE FUNCTION t.q() RETURNS jsonb LANGUAGE sql AS $$
  SELECT '{"legacy":{"success":["thành công","đã xem","đã click","đã gửi","đã nhận"],"skipped":["đã gửi lời mời","đã là thành viên"],"failure":["thất bại","lỗi","không tồn tại"]},"auxiliaryActionCodes":["zalo_find_phone_user","zalo_tag_contact","zalo_change_alias"],"notFoundStatuses":["không tồn tại"],"notFoundStatusCodes":["campaign_detail_not_found"]}'::jsonb
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
INSERT INTO t.cmp SELECT 'service', public.aka_agent_read_campaign_run_report(7, 9, NULL, NULL, 201, t.q());
COMMIT;

SET request.jwt.claims = '{"role":"aka_agent_desktop","sub":"00000000-0000-4000-8000-000000000007"}';
BEGIN;
SET LOCAL ROLE aka_agent_desktop;
INSERT INTO t.cmp SELECT 'desktop', public.aka_agent_read_campaign_run_report(7, 9, 'nv7', 'pw7', 201, t.q());
SELECT t.fails('desktop token of another staff', $q$SELECT public.aka_agent_read_campaign_run_report(8, 9, 'nv8', 'pw8', 202, t.q())$q$, '42501', 'desktop_staff_scope_denied');
SELECT t.fails('desktop wrong password', $q$SELECT public.aka_agent_read_campaign_run_report(7, 9, 'nv7', 'sai', 201, t.q())$q$, 'P0001', 'automation_auth_invalid');
SELECT t.fails('desktop without credentials', $q$SELECT public.aka_agent_read_campaign_run_report(7, 9, NULL, NULL, 201, t.q())$q$, 'P0001', 'automation_auth_required');
SELECT t.fails('desktop wrong organization', $q$SELECT public.aka_agent_read_campaign_run_report(7, 10, 'nv7', 'pw7', 201, t.q())$q$, 'P0001', 'automation_auth_invalid');
SELECT t.fails('desktop campaign of another staff', $q$SELECT public.aka_agent_read_campaign_run_report(7, 9, 'nv7', 'pw7', 202, t.q())$q$, 'P0002', 'campaign_report_not_found');
SELECT t.fails('desktop deleted campaign', $q$SELECT public.aka_agent_read_campaign_run_report(7, 9, 'nv7', 'pw7', 203, t.q())$q$, 'P0002', 'campaign_report_not_found');
SELECT t.fails('desktop invalid query', $q$SELECT public.aka_agent_read_campaign_run_report(7, 9, 'nv7', 'pw7', 201, '[]'::jsonb)$q$, '22023', 'invalid_report_query');
COMMIT;

SET request.jwt.claims = '{"role":"aka_agent_desktop","sub":"00000000-0000-4000-8000-000000000999"}';
BEGIN;
SET LOCAL ROLE aka_agent_desktop;
SELECT t.fails('desktop token without staff binding', $q$SELECT public.aka_agent_read_campaign_run_report(7, 9, 'nv7', 'pw7', 201, t.q())$q$, '42501', 'desktop_staff_scope_denied');
COMMIT;

RESET request.jwt.claims;
BEGIN;
SET LOCAL ROLE anon;
SELECT t.fails('anon still refused', $q$SELECT public.aka_agent_read_campaign_run_report(7, 9, 'nv7', 'pw7', 201, t.q())$q$, '42501', 'permission denied');
COMMIT;
BEGIN;
SET LOCAL ROLE authenticated;
SELECT t.fails('authenticated still refused', $q$SELECT public.aka_agent_read_campaign_run_report(7, 9, 'nv7', 'pw7', 201, t.q())$q$, '42501', 'permission denied');
COMMIT;

SELECT CASE WHEN (SELECT v - 'dbNow' FROM t.cmp WHERE who = 'desktop') = (SELECT v - 'dbNow' FROM t.cmp WHERE who = 'service')
  AND (SELECT (v->'campaign'->>'id')::int FROM t.cmp WHERE who = 'desktop') = 201
  AND (SELECT (v->'results'->>'total')::int FROM t.cmp WHERE who = 'desktop') > 0
  THEN 'ok desktop JSON equals service_role JSON' ELSE 'FAIL desktop JSON differs' END;
SQL
grep -q '^FAIL' "$WORK/calls.log" && { cat "$WORK/calls.log" >&2; fail "kết quả gọi hàm"; }
while IFS= read -r line; do ok "${line#ok }"; done < <(grep '^ok ' "$WORK/calls.log")
[ "$(grep -c '^ok ' "$WORK/calls.log")" = 11 ] || { cat "$WORK/calls.log" >&2; fail "thiếu kiểm tra gọi hàm"; }

refused "$(basename "$V489")" "v489_already_applied_do_not_reapply" "apply lại V489 bị từ chối"

run_file "$(basename "$R489")" >/dev/null
[ "$(sql -c "$ACL_SQL")" = "postgres,service_role" ] || fail "ACL sau rollback V489"
ok "rollback V489: về đúng postgres, service_role"
out=$(sql 2>&1 <<'SQL' || true
SET request.jwt.claims = '{"role":"aka_agent_desktop","sub":"00000000-0000-4000-8000-000000000007"}';
SET ROLE aka_agent_desktop;
SELECT public.aka_agent_read_campaign_run_report(7, 9, 'nv7', 'pw7', 201, '{}'::jsonb);
SQL
)
echo "$out" | grep -q "permission denied for function aka_agent_read_campaign_run_report" || { echo "$out" >&2; fail "Desktop sau rollback"; }
ok "sau rollback Desktop nhận 42501 permission denied for function (app báo đang cập nhật)"
svc=$(sql -c "SET request.jwt.claims = '{\"role\":\"service_role\"}'" -c "SET ROLE service_role" \
  -c "SELECT (public.aka_agent_read_campaign_run_report(7, 9, NULL, NULL, 201, '{}'::jsonb)->'campaign'->>'id')")
[ "$svc" = "201" ] || fail "service_role sau rollback V489"
ok "service_role (WebApp API) vẫn đọc được sau rollback V489"

run_file "$(basename "$V489")" >/dev/null
[ "$(sql -c "$ACL_SQL")" = "aka_agent_desktop,postgres,service_role" ] || fail "apply lại sau rollback"
ok "apply lại V489 sau rollback đạt"

run_file "$(basename "$R487")" >/dev/null
refused "$(basename "$V489")" "v489_v487_reader_missing" "thiếu hàm V487 thì V489 dừng"
[ "$(sql -c "$COUNTS_SQL")" = "$counts_before" ] || fail "dữ liệu fixture bị đổi"
ok "dữ liệu không đổi"

echo "V489: $pass/$pass kiểm tra đạt"
