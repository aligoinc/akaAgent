#!/usr/bin/env bash
# Thử V539 + V540 (Desktop gọi hai hàm của bộ lọc "Hành động" ở tab Kết quả chạy bằng token Desktop) trên PostgreSQL 16
# cục bộ, không chạm production. Dùng fixture của WebApp (scripts/test-fixtures/campaign-result-actions-schema.sql: dữ
# liệu mẫu, v2 thật, chuỗi xác thực token Desktop chép từ production) rồi apply V539 và V540 của repo này. Kiểm: V539 giống
# từng byte bản WebApp đã áp, quyền, gọi bằng token Desktop ra đúng JSON như service_role (bốn chế độ của hàm người nhận,
# v3 theo hành động / chưa ghi hành động / NULL = v2), chặn token/mật khẩu/tổ chức/chiến dịch sai, anon vẫn bị chặn,
# preflight từ chối apply lại, apply một nửa hoặc khi hàm V539 khác bản đã apply, rollback chỉ thu quyền Desktop.
# Dùng: AKA_AGENT_WEBAPP_REPO=<checkout akaAgentWebApp> bash scripts/test-v540-campaign-result-actions-desktop.sh
#       (PGBIN mặc định /usr/lib/postgresql/16/bin; chạy bằng root thì tự chạy Postgres dưới user postgres)
set -euo pipefail
PGBIN=${PGBIN:-/usr/lib/postgresql/16/bin}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
WEBAPP=${AKA_AGENT_WEBAPP_REPO:-$ROOT/../akaAgentWebApp}
FIXTURE="$WEBAPP/scripts/test-fixtures/campaign-result-actions-schema.sql"
WEBAPP_SQL="$WEBAPP/scripts/sql/campaign-result-actions/migration_campaign_result_actions.sql"
V539="$ROOT/migrations/migration_v539_campaign_result_actions.sql"
R539="$ROOT/migrations/rollback_v539_campaign_result_actions.sql"
V540="$ROOT/migrations/migration_v540_campaign_result_actions_desktop.sql"
R540="$ROOT/migrations/rollback_v540_campaign_result_actions_desktop.sql"
for file in "$FIXTURE" "$WEBAPP_SQL" "$V539" "$R539" "$V540" "$R540"; do
  [ -f "$file" ] || { echo "Không thấy $file (đặt AKA_AGENT_WEBAPP_REPO tới checkout akaAgentWebApp)" >&2; exit 1; }
done
pass=0
ok() { pass=$((pass + 1)); echo "ok $pass - $1"; }
fail() { echo "FAIL - $1" >&2; exit 1; }

cmp -s "$V539" "$WEBAPP_SQL" || fail "V539 khác tệp WebApp đã áp"
[ "$(md5sum < "$V539" | cut -d' ' -f1)" = "e845efc8b9b2f37f0793addd316a599f" ] || fail "md5 tệp V539 khác bản đã áp 14/11"
ok "V539 giống từng byte tệp WebApp đã áp (md5 e845efc8…)"

WORK=$(mktemp -d "${TMPDIR:-/tmp}/v540.XXXXXX")
as_pg() { if [ "$(id -u)" = 0 ]; then runuser -u postgres -- "$@"; else "$@"; fi; }
cp "$FIXTURE" "$V539" "$R539" "$V540" "$R540" "$WORK/"
if [ "$(id -u)" = 0 ]; then chown -R postgres "$WORK"; chmod 755 "$WORK"; fi
cleanup() { as_pg "$PGBIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT
as_pg "$PGBIN/initdb" -D "$WORK/data" -A trust -U postgres -E UTF8 --locale=C >/dev/null
as_pg "$PGBIN/pg_ctl" -D "$WORK/data" -o "-k $WORK -c listen_addresses=''" -l "$WORK/log" -w start >/dev/null
PSQL=("$PGBIN/psql" -X -h "$WORK" -U postgres -d postgres -v ON_ERROR_STOP=1 -qAt)
run_file() { as_pg "${PSQL[@]}" -f "$WORK/$1"; }
sql() { as_pg "${PSQL[@]}" "$@"; }
# Apply một file và đòi thất bại có chữ mong đợi.
refused() {
  local file=$1 marker=$2 label=$3
  if run_file "$file" >"$WORK/out.log" 2>&1; then fail "$label: apply thành công ngoài dự kiến"; fi
  grep -q "$marker" "$WORK/out.log" || { cat "$WORK/out.log" >&2; fail "$label: lỗi khác dự kiến"; }
  ok "$label"
}
PAGE_FN="public.aka_agent_list_campaign_details_page_v3(bigint,bigint,bigint,text,text,timestamp with time zone,timestamp with time zone,integer,integer,text,text,text,text,text)"
RECIPIENTS_FN="public.aka_agent_read_campaign_result_recipients(bigint,bigint,text,text,bigint,jsonb)"
acl() {
  sql -c "SELECT array_to_string(array_agg(g ORDER BY g), ',') FROM (SELECT DISTINCT CASE WHEN a.grantee = 0 THEN 'PUBLIC'
    ELSE a.grantee::regrole::text END AS g FROM pg_proc p, aclexplode(p.proacl) a WHERE p.oid = to_regprocedure('$1')) x"
}
attrs() {
  sql -c "SELECT md5(prosrc) || '|' || array_to_string(proconfig, ';') || '|' || prosecdef::text || provolatile::text
    FROM pg_proc WHERE oid = to_regprocedure('$1')"
}

run_file "$(basename "$FIXTURE")" >/dev/null
run_file "$(basename "$V539")" >/dev/null
COUNTS_SQL="SELECT (SELECT count(*) FROM auto_campaign_details) || ' ' || (SELECT count(*) FROM auto_campaign_input_data) || ' ' || (SELECT count(*) FROM auto_campaigns)"
counts_before=$(sql -c "$COUNTS_SQL")
[ "$(acl "$PAGE_FN")" = "postgres,service_role" ] && [ "$(acl "$RECIPIENTS_FN")" = "postgres,service_role" ] || fail "ACL sau V539"
ok "V539 apply: hai hàm chỉ postgres, service_role"
PAGE_ATTRS="4e5c300305409908295c49d5d1941224|search_path=pg_catalog, public;statement_timeout=60s;jit=off|trues"
RECIPIENTS_ATTRS="3fe7e5982398b42cc73fcc0433109b05|search_path=pg_catalog, public;statement_timeout=60s;jit=off|trues"
[ "$(attrs "$PAGE_FN")" = "$PAGE_ATTRS" ] && [ "$(attrs "$RECIPIENTS_FN")" = "$RECIPIENTS_ATTRS" ] \
  || fail "md5 thân hàm/thuộc tính cục bộ khác bản production"
ok "md5 thân hàm và thuộc tính cục bộ = production (4e5c3003…, 3fe7e598…)"

# Preflight: thuộc tính, quyền hoặc quyền một nửa khác bản V539 thì dừng, không cấp quyền.
sql -c "ALTER FUNCTION $RECIPIENTS_FN SET jit = on"
refused "$(basename "$V540")" "v540_reader_attributes_unexpected" "preflight dừng khi thuộc tính hàm khác bản V539"
sql -c "ALTER FUNCTION $RECIPIENTS_FN SET jit = off"
[ "$(attrs "$RECIPIENTS_FN")" = "$RECIPIENTS_ATTRS" ] || fail "thuộc tính chưa về bản V539"
sql -c "GRANT EXECUTE ON FUNCTION $PAGE_FN TO anon"
refused "$(basename "$V540")" "v540_reader_acl_unexpected" "preflight dừng khi ACL khác bản V539"
sql -c "REVOKE EXECUTE ON FUNCTION $PAGE_FN FROM anon"
sql -c "GRANT EXECUTE ON FUNCTION $PAGE_FN TO aka_agent_desktop"
refused "$(basename "$V540")" "v540_partially_applied_check_acl_by_hand" "preflight dừng khi chỉ một hàm đã cấp quyền"
sql -c "REVOKE EXECUTE ON FUNCTION $PAGE_FN FROM aka_agent_desktop"
[ "$(acl "$PAGE_FN")" = "postgres,service_role" ] || fail "ACL chưa về bản V539"

run_file "$(basename "$V540")" >/dev/null
[ "$(acl "$PAGE_FN")" = "aka_agent_desktop,postgres,service_role" ] && [ "$(acl "$RECIPIENTS_FN")" = "aka_agent_desktop,postgres,service_role" ] \
  || fail "ACL sau V540"
ok "V540 apply: thêm đúng aka_agent_desktop cho hai hàm"
[ "$(attrs "$PAGE_FN")" = "$PAGE_ATTRS" ] && [ "$(attrs "$RECIPIENTS_FN")" = "$RECIPIENTS_ATTRS" ] || fail "thân/thuộc tính hàm đổi sau V540"
ok "thân hàm, SECURITY DEFINER, STABLE, 60s, jit off giữ nguyên"

# Gọi như PostgREST: token Desktop (role + sub) và mật khẩu tự động hóa của staff.
sql >"$WORK/calls.log" 2>&1 <<'SQL' || { cat "$WORK/calls.log" >&2; fail "kiểm thử gọi hàm"; }
SET TIME ZONE 'UTC';
CREATE SCHEMA t;
CREATE TABLE t.cmp(who text, k text, v jsonb, PRIMARY KEY (who, k));
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
-- Mọi lượt gọi cần so: chế độ người nhận (có và không lọc kết quả) và v3 (hành động, chưa ghi hành động, NULL = v2).
CREATE FUNCTION t.record(p_who text, p_user text, p_password text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO t.cmp VALUES
    (p_who, 'actions', public.aka_agent_read_campaign_result_recipients(7, 9, p_user, p_password, 301, '{"mode":"actions"}')),
    (p_who, 'page', public.aka_agent_read_campaign_result_recipients(7, 9, p_user, p_password, 301, '{"mode":"page","limit":100,"offset":0}')),
    (p_who, 'page-filtered', public.aka_agent_read_campaign_result_recipients(7, 9, p_user, p_password, 301,
      '{"mode":"page","limit":2,"offset":0,"status":"thất bại","sort":"created_asc"}')),
    (p_who, 'keys', public.aka_agent_read_campaign_result_recipients(7, 9, p_user, p_password, 301, '{"mode":"keys","engagementFilter":"seen"}')),
    (p_who, 'byKeys', public.aka_agent_read_campaign_result_recipients(7, 9, p_user, p_password, 301, '{"mode":"byKeys","ids":[5,1,2]}')),
    (p_who, 'v3-action', public.aka_agent_list_campaign_details_page_v3(7, 9, 301, NULL, NULL, NULL, NULL, 0, 100, 'created_desc', p_user, p_password, NULL, 'zalo_add_friend')),
    (p_who, 'v3-none', public.aka_agent_list_campaign_details_page_v3(7, 9, 301, NULL, NULL, NULL, NULL, 0, 100, 'created_desc', p_user, p_password, NULL, '')),
    (p_who, 'v3-null', public.aka_agent_list_campaign_details_page_v3(7, 9, 301, NULL, NULL, NULL, NULL, 0, 100, 'created_desc', p_user, p_password, NULL, NULL));
END $$;
GRANT USAGE ON SCHEMA t TO service_role, aka_agent_desktop, anon, authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA t TO service_role, aka_agent_desktop, anon, authenticated;
GRANT INSERT ON t.cmp TO service_role, aka_agent_desktop;

SET request.jwt.claims = '{"role":"service_role"}';
BEGIN;
SET LOCAL ROLE service_role;
SELECT t.record('service', NULL, NULL);
COMMIT;

SET request.jwt.claims = '{"role":"aka_agent_desktop","sub":"00000000-0000-4000-8000-000000000007"}';
BEGIN;
SET LOCAL ROLE aka_agent_desktop;
SELECT t.record('desktop', 'nv7', 'pw7');
SELECT t.fails('desktop token of another staff', $q$SELECT public.aka_agent_read_campaign_result_recipients(8, 9, 'nv8', 'pw8', 302, '{"mode":"actions"}')$q$, '42501', 'desktop_staff_scope_denied');
SELECT t.fails('desktop v3 token of another staff', $q$SELECT public.aka_agent_list_campaign_details_page_v3(8, 9, 302, NULL, NULL, NULL, NULL, 0, 100, 'created_desc', 'nv8', 'pw8', NULL, 'zalo_add_friend')$q$, '42501', 'desktop_staff_scope_denied');
SELECT t.fails('desktop wrong password', $q$SELECT public.aka_agent_read_campaign_result_recipients(7, 9, 'nv7', 'sai', 301, '{"mode":"actions"}')$q$, 'P0001', 'automation_auth_invalid');
SELECT t.fails('desktop v3 wrong password', $q$SELECT public.aka_agent_list_campaign_details_page_v3(7, 9, 301, NULL, NULL, NULL, NULL, 0, 100, 'created_desc', 'nv7', 'sai', NULL, '')$q$, 'P0001', 'automation_auth_invalid');
SELECT t.fails('desktop without credentials', $q$SELECT public.aka_agent_read_campaign_result_recipients(7, 9, NULL, NULL, 301, '{"mode":"actions"}')$q$, 'P0001', 'automation_auth_required');
SELECT t.fails('desktop wrong organization', $q$SELECT public.aka_agent_read_campaign_result_recipients(7, 10, 'nv7', 'pw7', 301, '{"mode":"actions"}')$q$, 'P0001', 'automation_auth_invalid');
SELECT t.fails('desktop campaign of another staff', $q$SELECT public.aka_agent_read_campaign_result_recipients(7, 9, 'nv7', 'pw7', 302, '{"mode":"actions"}')$q$, 'P0001', 'campaign_not_found');
SELECT t.fails('desktop v3 campaign of another staff', $q$SELECT public.aka_agent_list_campaign_details_page_v3(7, 9, 302, NULL, NULL, NULL, NULL, 0, 100, 'created_desc', 'nv7', 'pw7', NULL, '')$q$, 'P0001', 'campaign_not_found');
SELECT t.fails('desktop invalid query', $q$SELECT public.aka_agent_read_campaign_result_recipients(7, 9, 'nv7', 'pw7', 301, '{"mode":"all"}')$q$, '22023', 'invalid_campaign_result_recipients');
SELECT t.fails('desktop invalid action code', $q$SELECT public.aka_agent_list_campaign_details_page_v3(7, 9, 301, NULL, NULL, NULL, NULL, 0, 100, 'created_desc', 'nv7', 'pw7', NULL, 'Kết bạn')$q$, 'P0001', 'invalid_campaign_details_action');
COMMIT;

SET request.jwt.claims = '{"role":"aka_agent_desktop","sub":"00000000-0000-4000-8000-000000000999"}';
BEGIN;
SET LOCAL ROLE aka_agent_desktop;
SELECT t.fails('desktop token without staff binding', $q$SELECT public.aka_agent_read_campaign_result_recipients(7, 9, 'nv7', 'pw7', 301, '{"mode":"actions"}')$q$, '42501', 'desktop_staff_scope_denied');
COMMIT;

RESET request.jwt.claims;
BEGIN;
SET LOCAL ROLE anon;
SELECT t.fails('anon still refused (recipients)', $q$SELECT public.aka_agent_read_campaign_result_recipients(7, 9, 'nv7', 'pw7', 301, '{"mode":"actions"}')$q$, '42501', 'permission denied');
SELECT t.fails('anon still refused (v3)', $q$SELECT public.aka_agent_list_campaign_details_page_v3(7, 9, 301, NULL, NULL, NULL, NULL, 0, 100, 'created_desc', 'nv7', 'pw7', NULL, '')$q$, '42501', 'permission denied');
COMMIT;
BEGIN;
SET LOCAL ROLE authenticated;
SELECT t.fails('authenticated still refused', $q$SELECT public.aka_agent_read_campaign_result_recipients(7, 9, 'nv7', 'pw7', 301, '{"mode":"actions"}')$q$, '42501', 'permission denied');
COMMIT;

SELECT CASE WHEN (SELECT count(*) FROM t.cmp d JOIN t.cmp s ON s.who = 'service' AND s.k = d.k AND s.v = d.v WHERE d.who = 'desktop') = 8
  THEN 'ok desktop JSON equals service_role JSON for the 8 calls' ELSE 'FAIL desktop JSON differs' END;
SELECT CASE WHEN (SELECT jsonb_array_length(v->'actions') FROM t.cmp WHERE who = 'desktop' AND k = 'actions') = 5
  AND (SELECT (v->>'total')::int FROM t.cmp WHERE who = 'desktop' AND k = 'page') = 6
  AND (SELECT jsonb_array_length(v->'items') FROM t.cmp WHERE who = 'desktop' AND k = 'byKeys') = 3
  AND (SELECT (v->>'total')::int FROM t.cmp WHERE who = 'desktop' AND k = 'v3-action') = 2
  AND (SELECT (v->>'total')::int FROM t.cmp WHERE who = 'desktop' AND k = 'v3-none') = 1
  AND (SELECT (v->>'total')::int FROM t.cmp WHERE who = 'desktop' AND k = 'v3-null') > 3
  THEN 'ok desktop results are not empty (actions, page, byKeys, v3 by action, v3 without action, v3 = v2)'
  ELSE 'FAIL desktop results unexpected' END;
SQL
grep -q '^FAIL' "$WORK/calls.log" && { cat "$WORK/calls.log" >&2; fail "kết quả gọi hàm"; }
while IFS= read -r line; do ok "${line#ok }"; done < <(grep '^ok ' "$WORK/calls.log")
[ "$(grep -c '^ok ' "$WORK/calls.log")" = 16 ] || { cat "$WORK/calls.log" >&2; fail "thiếu kiểm tra gọi hàm"; }

refused "$(basename "$V540")" "v540_already_applied_do_not_reapply" "apply lại V540 bị từ chối"
refused "$(basename "$V539")" "campaign_result_actions_already_exists_do_not_overwrite" "apply lại V539 bị từ chối"

run_file "$(basename "$R540")" >/dev/null
[ "$(acl "$PAGE_FN")" = "postgres,service_role" ] && [ "$(acl "$RECIPIENTS_FN")" = "postgres,service_role" ] || fail "ACL sau rollback V540"
ok "rollback V540: về đúng postgres, service_role"
for call in \
  "SELECT public.aka_agent_read_campaign_result_recipients(7, 9, 'nv7', 'pw7', 301, '{\"mode\":\"actions\"}'::jsonb)|aka_agent_read_campaign_result_recipients" \
  "SELECT public.aka_agent_list_campaign_details_page_v3(7, 9, 301, NULL, NULL, NULL, NULL, 0, 100, 'created_desc', 'nv7', 'pw7', NULL, '')|aka_agent_list_campaign_details_page_v3"; do
  out=$(sql 2>&1 <<SQL || true
SET request.jwt.claims = '{"role":"aka_agent_desktop","sub":"00000000-0000-4000-8000-000000000007"}';
SET ROLE aka_agent_desktop;
${call%%|*};
SQL
)
  echo "$out" | grep -q "permission denied for function ${call##*|}" || { echo "$out" >&2; fail "Desktop sau rollback: ${call##*|}"; }
done
ok "sau rollback Desktop nhận 42501 permission denied for function (app chỉ còn \"Tất cả\")"
v2=$(sql 2>&1 <<'SQL'
SET request.jwt.claims = '{"role":"aka_agent_desktop","sub":"00000000-0000-4000-8000-000000000007"}';
SET ROLE aka_agent_desktop;
SELECT (public.aka_agent_list_campaign_details_page_v2(7, 9, 301, NULL, NULL, NULL, NULL, 0, 100, 'created_desc', 'nv7', 'pw7', NULL)->>'total')::int > 0;
SQL
)
[ "$v2" = "t" ] || { echo "$v2" >&2; fail "Desktop đọc v2 sau rollback"; }
ok "Desktop vẫn đọc v2 (danh sách \"Tất cả\") sau rollback V540"
svc=$(sql -c "SET request.jwt.claims = '{\"role\":\"service_role\"}'" -c "SET ROLE service_role" \
  -c "SELECT (public.aka_agent_read_campaign_result_recipients(7, 9, NULL, NULL, 301, '{\"mode\":\"actions\"}')->>'total')::int > 0")
[ "$svc" = "t" ] || fail "service_role sau rollback V540"
ok "service_role (WebApp API) vẫn đọc được sau rollback V540"

run_file "$(basename "$V540")" >/dev/null
[ "$(acl "$PAGE_FN")" = "aka_agent_desktop,postgres,service_role" ] && [ "$(acl "$RECIPIENTS_FN")" = "aka_agent_desktop,postgres,service_role" ] \
  || fail "apply lại sau rollback"
ok "apply lại V540 sau rollback đạt"

run_file "$(basename "$R539")" >/dev/null
refused "$(basename "$V540")" "v540_v539_readers_missing" "thiếu hàm V539 thì V540 dừng"
[ "$(sql -c "$COUNTS_SQL")" = "$counts_before" ] || fail "dữ liệu fixture bị đổi"
ok "dữ liệu không đổi"

echo "V540: $pass/$pass kiểm tra đạt"
