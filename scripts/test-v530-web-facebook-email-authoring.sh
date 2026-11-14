#!/bin/sh
# v530 Web/iOS soạn chiến dịch Facebook/Email + tài khoản Email SMTP: test trên PostgreSQL cục bộ dùng một lần.
# Không đọc credential ứng dụng, không kết nối ra ngoài.
# Nền = fixtures V461 + migration V461 + V464 + V476 + V490 + phần production có mà chuỗi repo chưa dựng
# (schema-extension.sql: create_control_campaign_v2 bản V482, aka_agent_campaign_config_version, trigger khoá tài
# nguyên tài khoản của V219, danh tính + trigger sở hữu + quyền cột + RLS phiên Desktop, đều nguyên văn production)
# + baseline.sql của v530; baseline-check.sql kiểm đúng md5 + ACL production 14/11/2026 của 11 hàm v530 vá,
# 5 hàm phụ thuộc và 4 hàm production chép vào fixture.
# Ca:
#   1. caller cũ (không token 'email', không trường mới) giống hệt trước apply, sau apply, sau rollback, sau apply lại;
#   2. assertions (chính sách, xác thực, đọc/dừng/xoá Email, tạo/sửa/thêm data Facebook/Email, khoá bộ chạy sở hữu,
#      tài khoản phụ, chặn khi app Desktop còn giữ lượt, tài khoản Email SMTP, liên kết tìm data, RPC bộ chạy ghi
#      từng khoá theo quyền cột + RLS phiên Desktop, quyền hàm mới);
#   3. apply lại không đổi gì và giữ giá trị chính sách đã chỉnh; rollback chạy lại được;
#   4. định nghĩa nguồn lệch / hàm phụ thuộc lệch / hàm mới trùng tên có sẵn → dừng trước khi đổi gì;
#   5. script so sánh chỉ đọc (một thông điệp như execute_sql) không đổi gì;
#   6. script áp một lần dán: thành công giống hệt migration thường, ghi đúng một dòng sổ (md5 = file),
#      chạy lại bị chặn, nguồn lệch thì dừng;
#   7. smoke production sau apply;
#   8. bản thử production trong giao dịch tự huỷ (migration + smoke + mỗi đường ghi một lần): kết thúc bằng
#      'v530_trial_ok' kèm kết quả từng bước, không đổi gì, không ghi sổ;
#   9. khoá chéo: hai phiên thật chạy update_control_email_account_atomic xen với lượt ghi auto_accounts thường
#      (trigger production khoá dòng trước, khoá nhóm dùng chung sau) và hai lượt chuyển nhóm ngược chiều; có đối
#      chứng bằng thứ tự khoá cũ (phải ra "deadlock detected") để chắc bài kiểm bắt được lỗi;
#  10. phát lại các lời gọi RPC do API WebApp thật tạo ra (scripts/v530-api-contract-replay.py).
# Chạy: PG_TEST_BINDIR=/usr/lib/postgresql/16/bin scripts/test-v530-web-facebook-email-authoring.sh
set -eu
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
if [ -n "${PG_TEST_BINDIR:-}" ]; then
  pg_bin=$PG_TEST_BINDIR
elif [ -x /usr/lib/postgresql/16/bin/initdb ]; then
  pg_bin=/usr/lib/postgresql/16/bin
else
  pg_bin=/opt/homebrew/opt/postgresql@16/bin
fi
v461_fixtures="$script_dir/fixtures/web-desktop-accounts-v461"
v461_snapshot="$repo_dir/migrations/snapshots/web-desktop-accounts-v461"
v476_snapshot="$repo_dir/migrations/snapshots/web-facebook-campaigns-v476"
fixtures="$script_dir/fixtures/web-facebook-email-authoring-v530"
snapshot="$repo_dir/migrations/snapshots/web-facebook-email-authoring-v530"
migration="$repo_dir/migrations/migration_v530_web_facebook_email_authoring.sql"
compare="$repo_dir/migrations/tests/migration_v530_web_facebook_email_authoring_compare.sql"
guarded="$repo_dir/migrations/tests/migration_v530_web_facebook_email_authoring_guarded_apply.sql"
smoke="$repo_dir/migrations/tests/migration_v530_web_facebook_email_authoring_smoke.sql"
trial="$repo_dir/migrations/tests/migration_v530_web_facebook_email_authoring_rollback_trial.sql"
ledger_name=migration_v530_web_facebook_email_authoring
port=${PG_TEST_PORT:-25530}
# macOS: postmaster cần LC_ALL=C (không thì "postmaster became multithreaded during startup").
export LC_ALL=C
test_dir=$(mktemp -d /tmp/aka-v530-sql.XXXXXX)
# initdb/pg_ctl không chạy dưới root (container cloud): khi đó chạy bằng user postgres.
as_pg() { if [ "$(id -u)" = 0 ]; then runuser -u postgres -- "$@"; else "$@"; fi; }
if [ "$(id -u)" = 0 ]; then chown postgres "$test_dir"; fi
cleanup() { as_pg "$pg_bin/pg_ctl" -D "$test_dir/db" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$test_dir"; }
trap cleanup EXIT INT TERM
as_pg "$pg_bin/initdb" -D "$test_dir/db" -A trust --encoding=UTF8 --locale=C -U postgres >/dev/null
as_pg "$pg_bin/pg_ctl" -D "$test_dir/db" -l "$test_dir/server.log" -o "-h '' -k $test_dir -p $port -c max_connections=12" -w start >/dev/null
export PGOPTIONS='-c client_min_messages=warning'
run() { "$pg_bin/psql" -X -q -h "$test_dir" -p "$port" -U postgres -v ON_ERROR_STOP=1 "$@"; }
# Gửi CẢ FILE trong MỘT thông điệp Query như execute_sql/SQL Editor (psql tách theo câu; `psql -c` không nhận chuỗi
# > 128 KB, file áp một lần dán ~200 KB). In mọi dòng kết quả kiểu `psql -At -F '|'`, lỗi ra stderr + mã thoát 1.
one_message() {
  python3 - "$test_dir" "$port" "$1" "$2" <<'PY'
import os, socket, struct, sys
sock_dir, port, db, path = sys.argv[1:5]
query = open(path, 'rb').read()
s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
s.connect(f'{sock_dir}/.s.PGSQL.{port}')
buf = b''
def read_msg():
    global buf
    while len(buf) < 5 or len(buf) < 1 + struct.unpack('!i', buf[1:5])[0]:
        chunk = s.recv(1 << 16)
        if not chunk:
            sys.exit('connection closed')
        buf += chunk
    n = struct.unpack('!i', buf[1:5])[0]
    kind, body, buf = buf[0:1], buf[5:1 + n], buf[1 + n:]
    return kind, body
def fields(body):
    return {p[0:1]: p[1:].decode() for p in body.split(b'\0') if p}
level = os.environ.get('ONE_MESSAGE_MIN_MESSAGES', 'warning').encode()
params = b'user\0postgres\0database\0' + db.encode() + b'\0options\0-c client_min_messages=' + level + b'\0\0'
s.sendall(struct.pack('!ii', 8 + len(params), 196608) + params)
while True:
    kind, body = read_msg()
    if kind == b'R' and struct.unpack('!i', body[:4])[0] != 0:
        sys.exit('unsupported auth')
    if kind == b'E':
        sys.exit(fields(body).get(b'M', 'startup error'))
    if kind == b'Z':
        break
s.sendall(b'Q' + struct.pack('!i', 4 + len(query) + 1) + query + b'\0')
rows, error = [], None
while True:
    kind, body = read_msg()
    if kind == b'D':
        count, off, values = struct.unpack('!h', body[:2])[0], 2, []
        for _ in range(count):
            size = struct.unpack('!i', body[off:off + 4])[0]
            off += 4
            values.append('' if size < 0 else body[off:off + size].decode())
            off += max(size, 0)
        rows.append('|'.join(values))
    elif kind == b'E':
        f = fields(body)
        error = f"{f.get(b'S', 'ERROR')}:  {f.get(b'M', '')}"
    elif kind == b'N':
        print(fields(body).get(b'M', ''), file=sys.stderr)
    elif kind == b'Z':
        break
s.sendall(b'X' + struct.pack('!i', 4))
if rows:
    print('\n'.join(rows))
if error:
    print(error, file=sys.stderr)
    sys.exit(1)
PY
}
seed_db() {
  run -d postgres -c "create database $1"
  run -d "$1" -f "$v461_fixtures/schema.sql" -f "$v461_snapshot/baseline.sql" -f "$v461_fixtures/baseline-acl.sql" \
    -f "$repo_dir/migrations/migration_v461_web_desktop_accounts.sql" \
    -f "$repo_dir/migrations/migration_v464_native_desktop_only_login.sql" \
    -f "$v476_snapshot/baseline.sql" -f "$repo_dir/migrations/migration_v476_web_facebook_campaigns.sql" \
    -f "$repo_dir/migrations/migration_v490_control_session_chat_scope.sql" \
    -f "$fixtures/schema-extension.sql" -f "$snapshot/baseline.sql" -f "$fixtures/baseline-check.sql" -f "$fixtures/seed.sql"
  run -d "$1" -c "create schema if not exists supabase_migrations; create table supabase_migrations.schema_migrations (version text primary key, statements text[], name text, created_by text, idempotency_key text, rollback text[])"
}
fingerprint() {
  run -d "$1" -At -c "select md5(string_agg(x, E'\\n' order by x)) from (
    select 'fn:' || p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)) || ':' || coalesce(p.proacl::text, '') as x
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'private')
    union all select 'col:' || table_name || '.' || column_name || ':' || data_type || ':' || is_nullable
    from information_schema.columns where table_schema = 'public'
    union all select 'set:' || key || ':' || coalesce(value, '') || ':' || is_secret || ':' || is_active from public.auto_system_settings
    union all select 'acc:' || count(*) || ':' || coalesce(max(id), 0) from public.auto_accounts
    union all select 'cmp:' || count(*) || ':' || md5(string_agg(id || ':' || coalesce(extra_settings::text, '') || ':'
      || coalesce(secondary_account_id::text, '') || ':' || status, ',' order by id)) from public.auto_campaigns) s"
}
new_objects() {
  run -d "$1" -At -c "select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'private') and p.proname in ('aka_agent_web_email_campaigns_policy',
        'aka_agent_control_web_email_campaigns_policy', 'aka_agent_control_assert_campaign_inputs',
        'aka_agent_control_resolve_secondary_account', 'aka_agent_control_normalize_email_session',
        'aka_agent_control_email_account_view', 'create_control_email_account_atomic', 'update_control_email_account_atomic',
        'delete_control_email_account_atomic', 'aka_agent_control_email_account_session', 'aka_agent_control_link_find_data_target',
        'aka_agent_desktop_merge_campaign_runtime_settings')
    union all select count(*) from auto_system_settings where key = 'web.email_campaigns'" | tr '\n' ' '
}
fb_production='{"enabled":true,"organizationIds":[1],"facebookOnlyLogin":false}'

# 1–3. Apply, caller cũ, assertions, apply lại, rollback, apply lại.
seed_db main
run -d main -f "$fixtures/legacy-calls.sql" -f "$fixtures/legacy-capture.sql"
test "$(new_objects main)" = '0 0 ' || { echo 'baseline already has v530 objects'; exit 1; }
run -d main -f "$migration"
run -d main -f "$fixtures/legacy-compare.sql" -f "$fixtures/assertions.sql"
# Apply lại khi đã bật chính sách: không đổi gì, giữ nguyên giá trị đã chỉnh.
run -d main -c "update auto_system_settings set value = '{\"enabled\":true,\"organizationIds\":[31],\"emailOnlyLogin\":true,\"authoring\":{\"enabled\":true}}' where key = 'web.email_campaigns'"
run -d main -c "update auto_system_settings set value = '{\"enabled\":true,\"organizationIds\":[1],\"facebookOnlyLogin\":false,\"authoring\":{\"enabled\":true,\"organizationIds\":[1],\"actionIds\":[\"facebook_group_post\"]}}' where key = 'web.facebook_campaigns'"
before=$(fingerprint main)
reapply=$(PGOPTIONS='-c client_min_messages=notice' run -d main -f "$migration" 2>&1)
echo "$reapply" | grep -q 'v530 đã được apply trước đó; không đổi gì' || { echo "$reapply"; echo 'reapply notice missing'; exit 1; }
test "$(fingerprint main)" = "$before" || { echo 'reapply changed state'; exit 1; }
# Rollback khi dòng chính sách Facebook còn nhánh authoring: hàm baseline bỏ qua nhánh này, caller cũ giống hệt.
run -d main -f "$snapshot/rollback.sql"
run -d main -f "$fixtures/legacy-compare.sql"
run -d main -c "update auto_system_settings set value = '$fb_production' where key = 'web.facebook_campaigns'"
run -d main -f "$fixtures/rollback-assertions.sql"
test "$(new_objects main)" = '0 0 ' || { echo 'rollback left new objects'; exit 1; }
rerollback=$(PGOPTIONS='-c client_min_messages=notice' run -d main -f "$snapshot/rollback.sql" 2>&1)
echo "$rerollback" | grep -q 'v530 đã ở baseline' || { echo "$rerollback"; echo 'second rollback notice missing'; exit 1; }
run -d main -f "$fixtures/rollback-assertions.sql"
run -d main -f "$migration" -f "$fixtures/legacy-compare.sql" -f "$fixtures/assertions.sql"
# 7. Smoke production trên nền đã apply.
smoke_out=$(PGOPTIONS='-c client_min_messages=notice' run -d main -c "begin" -f "$smoke" -c "rollback" 2>&1)
echo "$smoke_out" | grep -q 'v530 production smoke passed' || { echo "$smoke_out"; echo 'smoke notice missing'; exit 1; }
echo 'v530: apply/legacy/assertions/reapply/rollback/smoke passed'

# 4. Nguồn lệch → dừng, không đổi gì (một giao dịch: không seed chính sách, không tạo hàm mới).
drift_case() {
  db=$1; sql=$2; expect=$3; objects=$4
  seed_db "$db"
  run -d "$db" -c "$sql"
  drift_before=$(fingerprint "$db")
  if run -d "$db" -f "$migration" >"$test_dir/$db.out" 2>&1; then echo "$db should fail"; exit 1; fi
  grep -q "$expect" "$test_dir/$db.out" || { cat "$test_dir/$db.out"; exit 1; }
  test "$(fingerprint "$db")" = "$drift_before" || { echo "$db changed state"; exit 1; }
  test "$(new_objects "$db")" = "$objects" || { echo "$db left new objects: $(new_objects "$db")"; exit 1; }
}
drift_case drift_source "alter function public.delete_control_campaign_atomic(bigint,bigint,bigint) set work_mem = '64kB'" \
  'v530_unexpected_definition' '0 0 '
drift_case drift_dependency "alter function public.create_control_campaign_v2(bigint,bigint,text,jsonb,jsonb,text) set work_mem = '64kB'" \
  'v530_dependency_changed' '0 0 '
drift_case drift_existing "create function public.aka_agent_control_link_find_data_target(bigint,bigint,bigint[],bigint,text,boolean)
  returns jsonb language sql as 'select ''{}''::jsonb'" 'v530_unexpected_existing_function' '1 0 '
drift_case drift_privilege "revoke update (extra_settings) on public.auto_campaigns from aka_agent_desktop" \
  'v530_desktop_column_privileges_missing' '0 0 '
echo 'v530: drift guards passed'

# 5. Script so sánh chỉ đọc chạy như một lệnh execute_sql: đủ dòng, mọi dòng đạt, không đổi gì.
seed_db cmp
cmp_before=$(fingerprint cmp)
result=$(one_message cmp "$compare")
echo "$result" | grep -c '^patch_dry_run|||t|' | grep -qx 11 || { echo "$result"; echo 'patch dry run rows missing'; exit 1; }
echo "$result" | grep -q '|f|' && { echo "$result"; echo 'compare row failed'; exit 1; }
for check in page_legacy_same page_desktop_same page_facebook_same snapshot_legacy_same snapshot_desktop_same \
  snapshot_facebook_same catalog_legacy_same catalog_desktop_same catalog_facebook_same activity_legacy_same \
  activity_desktop_same activity_facebook_same page_email snapshot_email activity_email facebook_policy_same \
  facebook_authoring_orgs; do
  echo "$result" | grep -q "^$check|" || { echo "$result"; echo "missing $check"; exit 1; }
done
test "$(fingerprint cmp)" = "$cmp_before" || { echo 'compare changed state'; exit 1; }
test "$(new_objects cmp)" = '0 0 ' || { echo 'compare left new objects'; exit 1; }
echo "$result" | grep -c '_same|' | xargs printf 'v530: compare passed (%s legacy rows)\n'

# 6. Áp một lần dán như SQL Editor.
seed_db guard_ok
result=$(one_message guard_ok "$guarded")
echo "$result" | grep -q '^applied|||t|' || { echo "$result"; echo 'applied row missing'; exit 1; }
seed_db plain_case
run -d plain_case -f "$migration"
test "$(fingerprint guard_ok)" = "$(fingerprint plain_case)" || { echo 'guarded apply differs from plain migration'; exit 1; }
test "$(run -d guard_ok -At -c "select count(*) from supabase_migrations.schema_migrations where name='$ledger_name'")" = 1
file_md5=$(md5sum <"$migration" | cut -d' ' -f1)
test "$(run -d guard_ok -At -c "select md5(statements[1]) from supabase_migrations.schema_migrations where name='$ledger_name'")" = "$file_md5" \
  || { echo 'ledger statements differ from migration file'; exit 1; }
if one_message guard_ok "$guarded" >"$test_dir/rerun.out" 2>&1; then echo 'guarded rerun should fail'; exit 1; fi
grep -q 'v530_guard_failed' "$test_dir/rerun.out" || { cat "$test_dir/rerun.out"; exit 1; }
test "$(run -d guard_ok -At -c "select count(*) from supabase_migrations.schema_migrations")" = 1
seed_db guard_drift
run -d guard_drift -c "alter function public.aka_agent_control_desktop_activity(bigint,bigint,text[],bigint,integer) set work_mem = '64kB'"
if one_message guard_drift "$guarded" >"$test_dir/guard-drift.out" 2>&1; then echo 'guarded drift should fail'; exit 1; fi
grep -q 'v530_unexpected_definition' "$test_dir/guard-drift.out" || { cat "$test_dir/guard-drift.out"; exit 1; }
test "$(new_objects guard_drift)" = '0 0 ' || { echo 'guarded drift left new objects'; exit 1; }
test "$(run -d guard_drift -At -c "select count(*) from supabase_migrations.schema_migrations")" = 0
echo "v530: guarded apply passed (ledger md5 $file_md5)"

# 8. Thử trong giao dịch tự huỷ (bản chạy trên production trước khi apply): migration + smoke đạt rồi RAISE
#    'v530_trial_ok'; không đổi gì, không ghi sổ. Nguồn lệch thì báo lỗi của bước đó, cũng không đổi gì.
seed_db trial
trial_before=$(fingerprint trial)
if ONE_MESSAGE_MIN_MESSAGES=notice one_message trial "$trial" >"$test_dir/trial.out" 2>&1; then echo 'trial must end with v530_trial_ok error'; exit 1; fi
grep -q 'v530_trial_ok' "$test_dir/trial.out" || { cat "$test_dir/trial.out"; exit 1; }
grep -q 'v530 production smoke passed' "$test_dir/trial.out" || { cat "$test_dir/trial.out"; echo 'trial smoke notice missing'; exit 1; }
# Mọi đường ghi phải chạy thật trên nền test (nhân viên 302: app tắt, có tài khoản Email, có phiên Desktop).
for step in 'staff=302 org=30 app_online=f' 'fb_create=ok' 'fb_update=ok' 'fb_add_rows=ok' 'email_account_create=ok' \
  'email_account_update=ok' 'email_campaign_create=ok' 'email_account_delete=ok' 'find_data_link=ok' \
  'desktop_merge=ok desktop_merge_foreign=denied' 'web_update_keeps_runtime_keys=ok'; do
  grep -q "$step" "$test_dir/trial.out" || { cat "$test_dir/trial.out"; echo "trial step missing: $step"; exit 1; }
done
if grep -Eq 'FAILED|skipped|blocked|v530-trial-secret' "$test_dir/trial.out"; then cat "$test_dir/trial.out"; echo 'trial reported a failed/skipped step or a secret'; exit 1; fi
test "$(fingerprint trial)" = "$trial_before" || { echo 'trial changed state'; exit 1; }
test "$(new_objects trial)" = '0 0 ' || { echo 'trial left new objects'; exit 1; }
test "$(run -d trial -At -c "select count(*) from supabase_migrations.schema_migrations")" = 0
run -d trial -c "alter function public.add_control_campaign_input_rows(bigint,bigint,bigint,text,integer,jsonb,timestamptz,text) set work_mem = '64kB'"
if one_message trial "$trial" >"$test_dir/trial-drift.out" 2>&1; then echo 'trial drift should fail'; exit 1; fi
grep -q 'v530_unexpected_definition' "$test_dir/trial-drift.out" || { cat "$test_dir/trial-drift.out"; exit 1; }
test "$(new_objects trial)" = '0 0 ' || { echo 'trial drift left new objects'; exit 1; }
# Không có phiên Desktop / không có chiến dịch tìm data: bước tương ứng ghi "skipped", vẫn kết thúc v530_trial_ok.
run -d trial -c "alter function public.add_control_campaign_input_rows(bigint,bigint,bigint,text,integer,jsonb,timestamptz,text) reset work_mem"
run -d trial -c "delete from private.aka_agent_desktop_users; update auto_campaigns set is_delete = true where id = 30024"
if one_message trial "$trial" >"$test_dir/trial-skip.out" 2>&1; then echo 'trial must end with an error'; exit 1; fi
grep -q 'v530_trial_ok' "$test_dir/trial-skip.out" || { cat "$test_dir/trial-skip.out"; exit 1; }
grep -q 'find_data_link=skipped' "$test_dir/trial-skip.out" && grep -q 'desktop_merge=skipped' "$test_dir/trial-skip.out" \
  || { cat "$test_dir/trial-skip.out"; echo 'trial skip notes missing'; exit 1; }
# Một bước ghi hỏng (trigger chặn thêm tài khoản): báo v530_trial_failed kèm bước hỏng, vẫn không đổi gì.
run -d trial -c "create function public.v530_test_block_email() returns trigger language plpgsql as \$\$ begin if new.flatform_type = 'email' then raise exception 'blocked_by_test'; end if; return new; end \$\$; create trigger v530_test_block_email before insert on auto_accounts for each row execute function public.v530_test_block_email()"
if one_message trial "$trial" >"$test_dir/trial-fail.out" 2>&1; then echo 'trial must end with an error'; exit 1; fi
grep -q 'v530_trial_failed' "$test_dir/trial-fail.out" && grep -q 'email_account_create=FAILED(P0001 blocked_by_test)' "$test_dir/trial-fail.out" \
  || { cat "$test_dir/trial-fail.out"; echo 'trial failure report missing'; exit 1; }
test "$(run -d trial -At -c "select count(*) from auto_accounts where name like '[v530 trial]%'")" = 0
echo 'v530: rollback trial passed'

# 9. Khoá chéo với trigger production trg_lock_auto_account_control_resources, bằng các phiên thật chạy song song.
#    Phiên giữ dòng (holder) khoá dòng tài khoản rồi ngủ; các phiên còn lại bắt đầu khi holder đang ngủ.
wait_for_sleeper() {
  tries=0
  while [ "$(run -d "$1" -At -c "select count(*) from pg_stat_activity where datname = current_database() and wait_event = 'PgSleep'")" = 0 ]; do
    tries=$((tries + 1))
    [ "$tries" -lt 100 ] || { echo 'holder session did not reach pg_sleep'; exit 1; }
    sleep 0.1
  done
}
# race <db> <SQL của holder> <SQL phiên 1> [<SQL phiên 2>]: đặt race_result = ok | deadlock, kết quả từng phiên ở race-N.out.
race() {
  race_db=$1; holder_sql=$2; shift 2
  rm -f "$test_dir"/race-*.out
  run -d "$race_db" -At -c "$holder_sql" >"$test_dir/race-0.out" 2>&1 &
  race_pids=$!
  wait_for_sleeper "$race_db"
  race_n=0
  for race_sql in "$@"; do
    race_n=$((race_n + 1))
    run -d "$race_db" -At -c "$race_sql" >"$test_dir/race-$race_n.out" 2>&1 &
    race_pids="$race_pids $!"
  done
  race_failed=0
  for race_pid in $race_pids; do wait "$race_pid" || race_failed=$((race_failed + 1)); done
  if cat "$test_dir"/race-*.out | grep -q 'deadlock detected'; then race_result=deadlock
  elif [ "$race_failed" = 0 ]; then race_result=ok
  else cat "$test_dir"/race-*.out; echo 'race session failed without a deadlock'; exit 1; fi
}
seed_db conc
run -d conc -f "$migration" -f "$fixtures/concurrency.sql"
hold_and_write="BEGIN; SELECT 1 FROM auto_accounts WHERE id = 3013 FOR UPDATE; SELECT pg_sleep(2); UPDATE auto_accounts SET proxy_id = 3951 WHERE id = 3013; COMMIT;"
hold_both="BEGIN; SELECT 1 FROM auto_accounts WHERE id IN (3013, 3014) FOR UPDATE; SELECT pg_sleep(2); COMMIT;"
rpc_update() { echo "SELECT public.update_control_email_account_atomic(301, 30, $1, (SELECT updated_at FROM auto_accounts WHERE id = $1), $2, NULL, NULL, NULL, $3)"; }
# 9a. Đối chứng: thứ tự khoá cũ (khoá nhóm độc quyền trước dòng) khoá chéo với một lượt UPDATE proxy_id thường.
race conc "$hold_and_write" "SELECT v530_test.old_lock_order_update(3013, 3901, 'Đối chứng')"
test "$race_result" = deadlock || { cat "$test_dir"/race-*.out; echo 'control: old lock order should deadlock with a plain account update'; exit 1; }
# 9b. Bản v530: đổi tên (nhóm giữ nguyên) trong lúc phiên khác giữ dòng rồi ghi proxy_id: cả hai xong, không khoá chéo.
run -d conc -c "update auto_accounts set proxy_id = null, account_group_id = 3901, name = 'Email khoá chéo A' where id = 3013"
race conc "$hold_and_write" "$(rpc_update 3013 "'Đổi tên khi phiên khác đang ghi'" 3901)"
test "$race_result" = ok || { cat "$test_dir"/race-*.out; echo 'rename vs plain account update deadlocked'; exit 1; }
grep -q '"updated": true' "$test_dir/race-1.out" || { cat "$test_dir/race-1.out"; echo 'rename did not update'; exit 1; }
test "$(run -d conc -At -c "select name || '|' || proxy_id || '|' || account_group_id from auto_accounts where id = 3013")" = 'Đổi tên khi phiên khác đang ghi|3951|3901' \
  || { echo 'rename/proxy final state wrong'; exit 1; }
# 9c. Đối chứng: hai lượt chuyển nhóm ngược chiều (3901→3905 và 3905→3901) với thứ tự khoá cũ khoá chéo.
race conc "$hold_both" "SELECT v530_test.old_lock_order_update(3013, 3905, NULL)" "SELECT v530_test.old_lock_order_update(3014, 3901, NULL)"
test "$race_result" = deadlock || { cat "$test_dir"/race-*.out; echo 'control: opposite group moves should deadlock with the old lock order'; exit 1; }
# 9d. Bản v530: hai lượt chuyển nhóm ngược chiều cùng xong.
run -d conc -c "update auto_accounts set account_group_id = 3901 where id = 3013; update auto_accounts set account_group_id = 3905 where id = 3014"
race conc "$hold_both" "$(rpc_update 3013 NULL 3905)" "$(rpc_update 3014 NULL 3901)"
test "$race_result" = ok || { cat "$test_dir"/race-*.out; echo 'opposite group moves deadlocked'; exit 1; }
grep -q '"updated": true' "$test_dir/race-1.out" && grep -q '"updated": true' "$test_dir/race-2.out" || { cat "$test_dir"/race-*.out; echo 'group move did not update'; exit 1; }
test "$(run -d conc -At -c "select string_agg(id || ':' || account_group_id, ',' order by id) from auto_accounts where id in (3013, 3014)")" = '3013:3905,3014:3901' \
  || { echo 'group move final state wrong'; exit 1; }
# 9e. Sửa/xoá nhóm của Control Web (khoá độc quyền cùng key) vẫn bị loại trừ: lượt sửa tài khoản chờ tới khi nhả.
race conc "BEGIN; SELECT pg_advisory_xact_lock(hashtextextended('control-zalo-account-group:3905', 0)); SELECT pg_sleep(2); UPDATE auto_account_groups SET is_delete = true WHERE id = 3905; COMMIT;" \
  "$(rpc_update 3014 NULL 3905)"
test "$race_result" = ok || { cat "$test_dir"/race-*.out; echo 'group delete race failed'; exit 1; }
grep -q '"reason": "account_group_not_found"' "$test_dir/race-1.out" || { cat "$test_dir/race-1.out"; echo 'update did not wait for the exclusive group lock'; exit 1; }
echo 'v530: lock order passed (control deadlocks reproduced, fixed order has none)'

# 10. Hợp đồng API ⇄ SQL: phát lại các lời gọi RPC ghi do mã API WebApp thật tạo ra, trên DB mới đã apply v530.
seed_db contract
run -d contract -f "$migration"
python3 "$script_dir/v530-api-contract-replay.py" "$pg_bin/psql" "$test_dir" "$port" contract "$fixtures/api-rpc-calls.json"
echo "v530 web facebook/email authoring SQL tests passed"
