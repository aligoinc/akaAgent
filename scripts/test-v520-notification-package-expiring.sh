#!/usr/bin/env bash
# Thử V520 (thông báo chuông "Gói sắp hết hạn") trên PostgreSQL 16 cục bộ, không chạm production. Fixture dựng bảng
# auto_notifications đúng định nghĩa V457 (cột, ràng buộc, index hộp thư) và bản thay của công tắc notifications.enabled.
# Kiểm: apply, loại mới được nhận còn loại lạ vẫn bị chặn, quyền gọi, công tắc tắt không ghi, nội dung ghi đúng và hiện ngay
# trong hộp thư, gọi lại không sinh trùng, mốc mới đánh dấu mốc cũ đã đọc, phần tử sai bị bỏ qua, giới hạn 500, apply lại
# bị từ chối, rollback.
# Dùng: bash scripts/test-v520-notification-package-expiring.sh   (PGBIN mặc định /usr/lib/postgresql/16/bin)
set -euo pipefail
PGBIN=${PGBIN:-/usr/lib/postgresql/16/bin}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
MIGRATION="$ROOT/migrations/migration_v520_notification_package_expiring.sql"
ROLLBACK="$ROOT/migrations/rollback_v520_notification_package_expiring.sql"
WORK=$(mktemp -d "${TMPDIR:-/tmp}/v520.XXXXXX")
as_pg() { if [ "$(id -u)" = 0 ]; then runuser -u postgres -- "$@"; else "$@"; fi; }
[ "$(id -u)" = 0 ] && chown postgres "$WORK"
chmod 755 "$WORK"
cleanup() { as_pg "$PGBIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT
as_pg "$PGBIN/initdb" -D "$WORK/data" -A trust -U postgres -E UTF8 --locale=C >/dev/null
as_pg "$PGBIN/pg_ctl" -D "$WORK/data" -o "-k $WORK -c listen_addresses=''" -l "$WORK/log" -w start >/dev/null
psql_db() { as_pg "$PGBIN/psql" -h "$WORK" -U postgres -d fixture -v ON_ERROR_STOP=1 -qAt "$@"; }
q() { psql_db -c "$1"; }
emit() { psql_db -c "SET ROLE service_role; SELECT public.aka_agent_notification_emit_package_expiring(\$json\$$1\$json\$::jsonb)"; }
run_file() { psql_db -f "$1" 2>&1; }
pass=0
ok() { pass=$((pass + 1)); echo "ok $pass - $1"; }
fail() { echo "FAIL - $1" >&2; exit 1; }
expect() { [ "$2" = "$3" ] && ok "$1" || fail "$1 (mong đợi '$3', nhận '$2')"; }
refuse() { local name=$1 pattern=$2 out; shift 2; if out=$("$@" 2>&1); then fail "$name (không bị từ chối)"; fi
  case "$out" in *"$pattern"*) ok "$name" ;; *) fail "$name (thông báo khác: $out)" ;; esac; }
field() { q "SELECT (\$json\$$1\$json\$::jsonb) ->> '$2'"; }

as_pg "$PGBIN/psql" -h "$WORK" -U postgres -d postgres -v ON_ERROR_STOP=1 -q <<'SQL'
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE ROLE aka_agent_desktop NOLOGIN; CREATE ROLE aka_agent_chat_api NOLOGIN;
CREATE DATABASE fixture;
SQL
psql_db >/dev/null <<'SQL'
CREATE SCHEMA private;
GRANT USAGE ON SCHEMA public, private TO anon, authenticated, service_role, aka_agent_desktop, aka_agent_chat_api;
CREATE SCHEMA supabase_migrations;
CREATE TABLE supabase_migrations.schema_migrations (version text PRIMARY KEY, name text, statements text[]);
CREATE TABLE public.org_staff (id bigint PRIMARY KEY, organization_id bigint NOT NULL, is_active boolean NOT NULL DEFAULT true);
CREATE TABLE public.org_organization_product (id bigint PRIMARY KEY, organization_id bigint, is_deleted boolean DEFAULT false);
CREATE TABLE public.auto_system_settings (key text PRIMARY KEY, value text);
INSERT INTO public.auto_system_settings VALUES ('notifications.enabled', 'true');
CREATE FUNCTION private.aka_agent_notification_enabled()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT lower(btrim(coalesce((SELECT value FROM public.auto_system_settings WHERE key = 'notifications.enabled'), 'false'))) IN ('true', '1', 'on', 'yes')
$$;
-- Đúng định nghĩa V457.
CREATE TABLE public.auto_notifications (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id bigint NOT NULL,
  staff_id bigint NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('campaign.status_changed','account.status_changed','report.scheduled',
    'data_group.membership_changed','system.test','system.verify_email')),
  severity text NOT NULL DEFAULT 'info' CHECK (severity IN ('info','warning','critical')),
  account_id bigint, campaign_id bigint, data_group_id bigint, dynamic_filter_id bigint,
  entity_key text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  deliver_after timestamptz NOT NULL DEFAULT now(),
  dedupe_key text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload) = 'object'),
  content_status text NOT NULL DEFAULT 'pending' CHECK (content_status IN ('pending','rendering','ready','merged','suppressed','failed')),
  merged_into_id bigint REFERENCES public.auto_notifications(id) ON DELETE SET NULL,
  app_title text, app_body text, email_subject text, content_snapshot jsonb, template_version smallint,
  email_state text NOT NULL DEFAULT 'none' CHECK (email_state IN ('none','pending','sent','partial','failed','skipped')),
  push_state text NOT NULL DEFAULT 'none' CHECK (push_state IN ('none','pending','sent','partial','failed','skipped')),
  email_sent_at timestamptz, push_sent_at timestamptz, read_at timestamptz,
  lease_token uuid, leased_until timestamptz, attempt_count integer NOT NULL DEFAULT 0, last_error text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auto_notifications_dedupe_unique UNIQUE (dedupe_key)
);
CREATE INDEX idx_auto_notifications_inbox ON public.auto_notifications (staff_id, created_at DESC, id DESC) WHERE content_status = 'ready';
CREATE INDEX idx_auto_notifications_unread ON public.auto_notifications (staff_id) WHERE read_at IS NULL AND content_status = 'ready';
ALTER TABLE public.auto_notifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.auto_notifications FROM PUBLIC, anon, authenticated, service_role, aka_agent_desktop;
INSERT INTO public.org_staff VALUES (7, 9, true), (8, 9, false), (20, 30, true);
INSERT INTO public.org_organization_product VALUES (501, 9, false), (502, 9, false), (504, 9, true), (601, 30, false);
INSERT INTO public.auto_notifications (organization_id, staff_id, event_type, entity_key, dedupe_key, content_status, app_title)
VALUES (9, 7, 'campaign.status_changed', 'campaign:1', 'old-1', 'ready', 'Chiến dịch A đã hoàn thành');
SQL

item() { # staff org product expiry stage severity title body
  printf '{"staffId":%s,"organizationId":%s,"organizationProductId":%s,"expiryDay":"%s","stageKey":"%s","severity":"%s","title":"%s","body":"%s","daysLeft":7,"kind":"paid","content":{"kind":"package","headline":"%s","sections":[{"title":"Gói","rows":[{"label":"Hết hạn","value":"20/11/2026"}]}]}}' "$1" "$2" "$3" "$4" "$5" "$6" "$7" "$8" "$7"
}

# --- apply ---
run_file "$MIGRATION" >/dev/null || fail "apply V520"
ok "apply V520"
q "INSERT INTO supabase_migrations.schema_migrations VALUES ('20261113000002', 'migration_v520_notification_package_expiring', ARRAY['x'])"

expect "ràng buộc nhận loại mới và đã kiểm dữ liệu cũ" "$(q "SELECT (pg_get_constraintdef(oid) LIKE '%package.expiring%')::text || ',' || convalidated::text FROM pg_constraint WHERE conname = 'auto_notifications_event_type_check'")" "true,true"
refuse "loại lạ vẫn bị chặn" "auto_notifications_event_type_check" q "INSERT INTO public.auto_notifications (organization_id, staff_id, event_type, entity_key, dedupe_key) VALUES (9, 7, 'something.else', 'x', 'x')"
expect "loại cũ vẫn ghi được" "$(q "INSERT INTO public.auto_notifications (organization_id, staff_id, event_type, entity_key, dedupe_key) VALUES (9, 7, 'system.test', 'test:email', 'old-2') RETURNING 1")" "1"
expect "chỉ service_role gọi được hàm" "$(q "SELECT string_agg(r.rolname, ',' ORDER BY r.rolname) FROM pg_roles r WHERE r.rolname IN ('anon','authenticated','service_role','aka_agent_desktop','aka_agent_chat_api') AND has_function_privilege(r.rolname, 'public.aka_agent_notification_emit_package_expiring(jsonb)', 'EXECUTE')")" "service_role"
refuse "Desktop gọi hàm bị từ chối" "permission denied" psql_db -c "SET ROLE aka_agent_desktop; SELECT public.aka_agent_notification_emit_package_expiring('[]'::jsonb)"

# --- công tắc tắt ---
q "UPDATE public.auto_system_settings SET value = 'false' WHERE key = 'notifications.enabled'"
R=$(emit "[$(item 7 9 501 2026-11-20 s7:medium warning 'Gói akaAgent Zalo còn 7 ngày' 'Hết hạn ngày 20/11/2026.')]")
expect "công tắc trung tâm thông báo tắt: không ghi gì" "$(field "$R" enabled),$(q "SELECT count(*) FROM public.auto_notifications WHERE event_type = 'package.expiring'")" "false,0"
q "UPDATE public.auto_system_settings SET value = 'true' WHERE key = 'notifications.enabled'"

# --- ghi ---
R=$(emit "[$(item 7 9 501 2026-11-20 s14:mild info 'Gói akaAgent Zalo còn 14 ngày' 'Hết hạn ngày 20/11/2026.'),$(item 20 30 601 2026-11-25 s7:medium warning 'Gói akaAgent Zalo còn 7 ngày' 'Hết hạn ngày 25/11/2026.')]")
expect "ghi 2 thông báo" "$(field "$R" enabled),$(field "$R" received),$(field "$R" valid),$(field "$R" inserted)" "true,2,2,2"
expect "nội dung, khóa trùng, trạng thái của thông báo" "$(q "SELECT organization_id || '|' || severity || '|' || entity_key || '|' || dedupe_key || '|' || content_status || '|' || app_title || '|' || app_body || '|' || email_state || '|' || push_state || '|' || (read_at IS NULL)::text || '|' || template_version FROM public.auto_notifications WHERE staff_id = 7 AND event_type = 'package.expiring'")" "9|info|package:501|pkg:7:501:2026-11-20:s14:mild|ready|Gói akaAgent Zalo còn 14 ngày|Hết hạn ngày 20/11/2026.|none|none|true|1"
expect "payload và nội dung chi tiết" "$(q "SELECT (payload ->> 'organizationProductId') || ',' || (payload ->> 'expiryDay') || ',' || (payload ->> 'stageKey') || ',' || (payload ->> 'daysLeft') || ',' || (payload ->> 'kind') || ',' || (content_snapshot ->> 'kind') || ',' || (content_snapshot #>> '{sections,0,rows,0,value}') FROM public.auto_notifications WHERE staff_id = 7 AND event_type = 'package.expiring'")" "501,2026-11-20,s14:mild,7,paid,package,20/11/2026"
expect "hiện trong hộp thư (truy vấn danh sách của V457) và tính vào số chưa đọc" "$(q "SELECT (SELECT string_agg(event_type, ',' ORDER BY created_at DESC, id DESC) FROM public.auto_notifications WHERE staff_id = 7 AND content_status = 'ready' AND event_type <> 'system.verify_email') || '|' || (SELECT count(*) FROM public.auto_notifications WHERE staff_id = 7 AND read_at IS NULL AND content_status = 'ready')")" "package.expiring,campaign.status_changed|2"

# --- gọi lại không sinh trùng ---
R=$(emit "[$(item 7 9 501 2026-11-20 s14:mild info 'Gói akaAgent Zalo còn 13 ngày' 'x')]")
expect "gọi lại cùng mốc: không ghi thêm, không đổi nội dung cũ" "$(field "$R" valid),$(field "$R" inserted),$(q "SELECT app_title FROM public.auto_notifications WHERE dedupe_key = 'pkg:7:501:2026-11-20:s14:mild'")" "1,0,Gói akaAgent Zalo còn 14 ngày"

# --- mốc mới: mốc cũ chưa đọc của cùng gói thành đã đọc; gói khác và loại khác giữ nguyên ---
emit "[$(item 7 9 502 2026-12-01 s30:mild info 'Gói akaAgent Facebook còn 30 ngày' 'Hết hạn ngày 01/12/2026.')]" >/dev/null
R=$(emit "[$(item 7 9 501 2026-11-20 s7:medium warning 'Gói akaAgent Zalo còn 7 ngày' 'Hết hạn ngày 20/11/2026.')]")
expect "mốc mới: ghi 1, đánh dấu 1 mốc cũ đã đọc" "$(field "$R" inserted),$(field "$R" superseded)" "1,1"
expect "chỉ mốc cũ của đúng gói đó thành đã đọc" "$(q "SELECT string_agg(dedupe_key || '=' || (read_at IS NULL)::text, ' ' ORDER BY id) FROM public.auto_notifications WHERE staff_id = 7 AND event_type IN ('package.expiring', 'campaign.status_changed')")" "old-1=true pkg:7:501:2026-11-20:s14:mild=false pkg:7:502:2026-12-01:s30:mild=true pkg:7:501:2026-11-20:s7:medium=true"
expect "gia hạn xong (hạn mới) là thông báo riêng" "$(field "$(emit "[$(item 7 9 501 2027-01-19 s30:mild info 'Gói akaAgent Zalo còn 30 ngày' 'Hết hạn ngày 19/01/2027.')]")" inserted)" "1"

# --- phần tử sai bị bỏ qua ---
BAD="[$(item 8 9 501 2026-11-20 s7:medium warning 'nhan vien bi khoa' 'x'),$(item 7 30 601 2026-11-25 s7:medium warning 'sai to chuc' 'x'),$(item 7 9 504 2026-11-20 s7:medium warning 'san pham da xoa' 'x'),$(item 7 9 601 2026-11-25 s7:medium warning 'san pham cua to chuc khac' 'x'),$(item 7 9 501 20-11-2026 s7:medium warning 'sai ngay' 'x'),$(item 7 9 501 2026-11-20 'S7 Medium' warning 'sai moc' 'x'),$(item 999 9 501 2026-11-20 s7:medium warning 'khong co nhan vien' 'x'),{\"staffId\":7},\"chuoi\",null]"
R=$(emit "$BAD")
expect "10 phần tử sai: nhận 10, hợp lệ 0, ghi 0" "$(field "$R" received),$(field "$R" valid),$(field "$R" inserted)" "10,0,0"
LONG=$(printf 'a%.0s' $(seq 1 201))
expect "tiêu đề rỗng hoặc quá 200 ký tự bị bỏ qua" "$(field "$(emit "[$(item 7 9 501 2026-11-20 s5:medium warning '' 'x'),$(item 7 9 501 2026-11-20 s5:medium warning "$LONG" 'x')]")" valid)" "0"
R=$(emit "[{\"staffId\":7,\"organizationId\":9,\"organizationProductId\":501,\"expiryDay\":\"2026-11-20\",\"stageKey\":\"s5:medium\",\"severity\":\"la\",\"title\":\"Gói còn 5 ngày\",\"content\":\"khong phai object\"}]")
expect "mức lạ thành info, nội dung chi tiết sai kiểu thành trống, thiếu body vẫn ghi" "$(field "$R" inserted),$(q "SELECT severity || ',' || (content_snapshot IS NULL)::text || ',' || (app_body IS NULL)::text FROM public.auto_notifications WHERE dedupe_key = 'pkg:7:501:2026-11-20:s5:medium'")" "1,info,true,true"
expect "hai phần tử trùng khóa trong một lượt: ghi một" "$(field "$(emit "[$(item 20 30 601 2026-11-25 s3:strong critical 'Gói còn 3 ngày' 'x'),$(item 20 30 601 2026-11-25 s3:strong critical 'Gói còn 3 ngày' 'x')]")" inserted)" "1"
refuse "không phải mảng bị từ chối" "notification_invalid_items" emit '{"staffId":7}'
MANY=$(q "SELECT jsonb_agg(jsonb_build_object('staffId', 7))::text FROM generate_series(1, 501)")
refuse "quá 500 phần tử bị từ chối" "notification_too_many_items" emit "$MANY"
expect "mảng rỗng: không lỗi" "$(field "$(emit '[]')" inserted)" "0"

# --- apply lại / rollback ---
refuse "apply lại V520 bị từ chối" "đã có trong sổ migration" run_file "$MIGRATION"
run_file "$ROLLBACK" >/dev/null || fail "rollback V520"
ok "rollback V520"
expect "sau rollback: hàm không còn, thông báo loại mới đã xoá, loại cũ còn nguyên, ràng buộc về 6 giá trị" "$(q "SELECT (to_regprocedure('public.aka_agent_notification_emit_package_expiring(jsonb)') IS NULL)::text || ',' || (SELECT count(*) FROM public.auto_notifications WHERE event_type = 'package.expiring') || ',' || (SELECT count(*) FROM public.auto_notifications) || ',' || (SELECT (pg_get_constraintdef(oid) NOT LIKE '%package.expiring%')::text FROM pg_constraint WHERE conname = 'auto_notifications_event_type_check')")" "true,0,2,true"
q "DELETE FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v520_%'"
run_file "$MIGRATION" >/dev/null || fail "apply lại sau rollback"
ok "apply lại sau rollback (preflight khớp lại đúng ràng buộc V457)"
echo "V520: $pass khẳng định đạt"
