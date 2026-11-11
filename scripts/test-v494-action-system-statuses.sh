#!/usr/bin/env bash
# Thử V494 (trạng thái hệ thống + danh sách trạng thái theo hành động) trên PostgreSQL 16 cục bộ, không chạm production.
# Fixture dựng lại các bảng danh mục như akachat ngày 11/11/2026 (41 dòng auto_status, 19 policy, hành động Zalo, quyền,
# RLS, ACL mặc định của schema public). Chính preflight md5 của migration xác nhận fixture trùng dữ liệu production.
# Kiểm: apply, dữ liệu cũ không đổi, ràng buộc/guard/quyền, lớp ActionStatusCatalog thật của bộ chạy nạp được danh mục
# sau migration, chạy lại bị từ chối, lệch dữ liệu bị từ chối, rollback trả đúng trạng thái đầu, rollback từ chối khi
# trạng thái mới đã được dùng.
# Dùng: bash scripts/test-v494-action-system-statuses.sh   (PGBIN mặc định /usr/lib/postgresql/16/bin; cần Node >= 22.7)
set -euo pipefail
PGBIN=${PGBIN:-/usr/lib/postgresql/16/bin}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
MIGRATION="$ROOT/migrations/migration_v494_action_system_statuses.sql"
ROLLBACK="$ROOT/migrations/rollback_v494_action_system_statuses.sql"
WORK=$(mktemp -d "${TMPDIR:-/tmp}/v494.XXXXXX")
as_pg() { if [ "$(id -u)" = 0 ]; then runuser -u postgres -- "$@"; else "$@"; fi; }
[ "$(id -u)" = 0 ] && chown postgres "$WORK"
chmod 755 "$WORK"
cleanup() { as_pg "$PGBIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT
as_pg "$PGBIN/initdb" -D "$WORK/data" -A trust -U postgres -E UTF8 --locale=C >/dev/null
as_pg "$PGBIN/pg_ctl" -D "$WORK/data" -o "-k $WORK -c listen_addresses=''" -l "$WORK/log" -w start >/dev/null
psql_db() { local db=$1; shift; as_pg "$PGBIN/psql" -h "$WORK" -U postgres -d "$db" -v ON_ERROR_STOP=1 -qAt "$@"; }
q() { psql_db "$DB" -c "$1"; }
# Chạy file SQL; in stderr ra stdout để so thông báo từ chối.
run_file() { psql_db "$1" -f "$2" 2>&1; }
pass=0
ok() { pass=$((pass + 1)); echo "ok $pass - $1"; }
fail() { echo "FAIL - $1" >&2; exit 1; }
expect() { [ "$2" = "$3" ] && ok "$1" || fail "$1 (mong đợi '$3', nhận '$2')"; }
# Lệnh phải lỗi và thông báo chứa chuỗi cho trước.
refuse() { local name=$1 pattern=$2 out; shift 2; if out=$("$@" 2>&1); then fail "$name (không bị từ chối)"; fi
  case "$out" in *"$pattern"*) ok "$name" ;; *) fail "$name (thông báo khác: $out)" ;; esac; }

psql_db postgres <<'SQL'
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE ROLE aka_agent_desktop NOLOGIN; CREATE ROLE aka_agent_chat_api LOGIN BYPASSRLS;
CREATE DATABASE base;
SQL
psql_db base >/dev/null <<'SQL'
-- ACL mặc định của Supabase: bảng/sequence/hàm mới trong public tự cấp cho anon, authenticated, service_role.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role, aka_agent_desktop, aka_agent_chat_api;

CREATE TABLE public.auto_status (
  id bigserial PRIMARY KEY,
  code text NOT NULL UNIQUE CHECK (code ~ '^[a-z0-9_]+$'),
  name text NOT NULL,
  description text,
  status_key text NOT NULL CHECK (status_key ~ '^[a-z0-9_]+$'),
  flatform_type text NOT NULL DEFAULT 'all' CHECK (flatform_type = ANY (ARRAY['all', 'facebook', 'zalo'])),
  component_type text NOT NULL CHECK (component_type = ANY (ARRAY['account', 'account_login', 'campaign', 'campaign_input', 'campaign_input_data', 'campaign_detail'])),
  is_default boolean NOT NULL DEFAULT false,
  is_terminal boolean NOT NULL DEFAULT false,
  can_set_manually boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  is_delete boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT '2026-10-06 03:23:36+00',
  updated_at timestamptz NOT NULL DEFAULT '2026-10-09 10:23:31+00',
  status_value text,
  color text
);
INSERT INTO public.auto_status (id, code, name, status_key, component_type, flatform_type, is_default, is_terminal, sort_order) VALUES
  (1, 'account_pending', 'Chờ xử lý', 'pending', 'account', 'all', true, false, 10),
  (2, 'account_running', 'Đang chạy', 'running', 'account', 'all', false, false, 20),
  (3, 'account_paused', 'Tạm dừng', 'paused', 'account', 'all', false, false, 30),
  (4, 'account_login_not_logged_in', 'Chưa đăng nhập', 'not_logged_in', 'account_login', 'all', true, false, 10),
  (5, 'account_login_logged_in', 'Đã đăng nhập', 'logged_in', 'account_login', 'all', false, false, 20),
  (6, 'account_login_checkpoint', 'Checkpoint', 'checkpoint', 'account_login', 'facebook', false, false, 30),
  (7, 'campaign_pending', 'Chờ xử lý', 'pending', 'campaign', 'all', true, false, 10),
  (8, 'campaign_running', 'Đang chạy', 'running', 'campaign', 'all', false, false, 20),
  (9, 'campaign_paused', 'Tạm dừng', 'paused', 'campaign', 'all', false, false, 30),
  (10, 'campaign_completed', 'Hoàn thành', 'completed', 'campaign', 'all', false, true, 40),
  (11, 'campaign_input_pending', 'Chờ xử lý', 'pending', 'campaign_input', 'all', true, false, 10),
  (12, 'campaign_input_paused', 'Tạm dừng', 'paused', 'campaign_input', 'all', false, false, 20),
  (13, 'campaign_input_running', 'Đang chạy', 'running', 'campaign_input', 'all', false, false, 30),
  (14, 'campaign_input_completed', 'Hoàn thành', 'completed', 'campaign_input', 'all', false, true, 40),
  (15, 'campaign_input_error', 'Lỗi', 'error', 'campaign_input', 'all', false, true, 50),
  (16, 'campaign_input_data_pending', 'Chờ xử lý', 'pending', 'campaign_input_data', 'all', true, false, 10),
  (17, 'campaign_input_data_paused', 'Tạm dừng', 'paused', 'campaign_input_data', 'all', false, false, 20),
  (18, 'campaign_input_data_running', 'Đang chạy', 'running', 'campaign_input_data', 'all', false, false, 30),
  (19, 'campaign_input_data_completed', 'Hoàn thành', 'completed', 'campaign_input_data', 'all', false, true, 40);
INSERT INTO public.auto_status (id, code, name, status_key, status_value, component_type, flatform_type, is_default, is_terminal, sort_order) VALUES
  (20, 'campaign_detail_success', 'Thành công', 'success', 'thành công', 'campaign_detail', 'all', true, true, 10),
  (21, 'campaign_detail_failed', 'Thất bại', 'failed', 'thất bại', 'campaign_detail', 'all', false, true, 20),
  (22, 'campaign_detail_error', 'Lỗi', 'error', 'lỗi', 'campaign_detail', 'all', false, true, 30),
  (23, 'campaign_detail_clicked', 'Đã click', 'clicked', 'đã click', 'campaign_detail', 'all', false, false, 40),
  (24, 'campaign_detail_alias_changed', 'Đã đổi tên', 'alias_changed', 'đã đổi tên', 'campaign_detail', 'all', false, true, 50),
  (25, 'campaign_detail_tag_applied', 'Đã gắn tag', 'tag_applied', 'đã gắn tag', 'campaign_detail', 'all', false, true, 60),
  (26, 'campaign_detail_sent', 'Đã gửi', 'sent', 'đã gửi', 'campaign_detail', 'all', false, false, 70),
  (27, 'campaign_detail_invitation_sent', 'Đã gửi lời mời', 'invitation_sent', 'đã gửi lời mời', 'campaign_detail', 'all', false, true, 80),
  (28, 'campaign_detail_friend_request_sent', 'Đã gửi lời mời kết bạn', 'friend_request_sent', 'đã gửi lời mời kết bạn', 'campaign_detail', 'all', false, true, 90),
  (29, 'campaign_detail_message_sent', 'Đã gửi tin nhắn', 'message_sent', 'đã gửi tin nhắn', 'campaign_detail', 'all', false, true, 100),
  (30, 'campaign_detail_already_friend', 'Đã là bạn bè', 'already_friend', 'đã là bạn bè', 'campaign_detail', 'all', false, true, 110),
  (31, 'campaign_detail_already_member', 'Đã là thành viên', 'already_member', 'đã là thành viên', 'campaign_detail', 'all', false, true, 120),
  (32, 'campaign_detail_received', 'Đã nhận', 'received', 'đã nhận', 'campaign_detail', 'all', false, false, 130),
  (33, 'campaign_detail_joined', 'Đã tham gia', 'joined', 'đã tham gia', 'campaign_detail', 'all', false, true, 140),
  (34, 'campaign_detail_viewed', 'Đã xem', 'viewed', 'đã xem', 'campaign_detail', 'all', false, false, 150),
  (35, 'campaign_detail_calling', 'Đang gọi', 'calling', 'đang gọi', 'campaign_detail', 'all', false, false, 160),
  (36, 'campaign_detail_not_found', 'Không tồn tại', 'not_found', 'không tồn tại', 'campaign_detail', 'all', false, true, 170),
  (37, 'campaign_detail_tag_not_found', 'Tag không tồn tại', 'tag_not_found', 'tag không tồn tại', 'campaign_detail', 'all', false, true, 180),
  (38, 'campaign_detail_invalid_parameter', 'Tham số không hợp lệ', 'invalid_parameter', 'tham số không hợp lệ', 'campaign_detail', 'all', false, true, 190),
  (51, 'campaign_detail_skipped', 'Bỏ qua', 'skipped', 'bỏ qua', 'campaign_detail', 'all', false, true, 200),
  (52, 'campaign_detail_post_pending', 'Chờ duyệt bài', 'post_pending', 'chờ duyệt bài', 'campaign_detail', 'all', false, false, 210),
  (55, 'campaign_detail_post_approved', 'Đã duyệt bài', 'post_approved', 'đã duyệt bài', 'campaign_detail', 'facebook', false, false, 220);
SELECT setval('public.auto_status_id_seq', 55, true);
ALTER TABLE public.auto_status ENABLE ROW LEVEL SECURITY;
CREATE POLICY v435_existing_role_access ON public.auto_status FOR ALL TO aka_agent_desktop USING (true) WITH CHECK (true);
REVOKE ALL ON public.auto_status FROM anon, authenticated;
GRANT SELECT ON public.auto_status TO aka_agent_desktop, aka_agent_chat_api;

CREATE TABLE public.auto_account_actions (
  id bigserial PRIMARY KEY, flatform_type text NOT NULL DEFAULT 'facebook', name text NOT NULL, code text NOT NULL UNIQUE,
  is_active boolean NOT NULL DEFAULT true, is_delete boolean NOT NULL DEFAULT false);
INSERT INTO public.auto_account_actions (id, flatform_type, name, code) VALUES
  (20, 'zalo', 'Zalo - Kết bạn', 'zalo_add_friend'), (21, 'zalo', 'Zalo - Thêm thành viên vào group', 'zalo_add_group_member'),
  (22, 'zalo', 'Zalo - Tìm SĐT', 'zalo_find_phone_user'), (23, 'zalo', 'Zalo - Gửi tin nhắn đến bạn bè', 'zalo_message_friend'),
  (24, 'zalo', 'Zalo - Gửi tin nhắn đến group', 'zalo_message_group'), (25, 'zalo', 'Zalo - Gửi tin nhắn đến người lạ', 'zalo_message_stranger'),
  (26, 'zalo', 'Zalo - Tham gia vào group', 'zalo_join_group'), (27, 'zalo', 'Zalo - Gắn tag', 'zalo_tag_contact'),
  (28, 'zalo', 'Zalo - Đổi tên', 'zalo_change_alias'), (59, 'zalo', 'Zalo - Tham gia group', 'zalo_join_group_link'),
  (64, 'zalo', 'Zalo - Huỷ lời mời kết bạn đã gửi', 'zalo_cancel_sent_friend_request'),
  (65, 'facebook', 'Tham gia group', 'fb_join_group'), (69, 'facebook', 'Mời vào group', 'fb_group_invite');
REVOKE ALL ON public.auto_account_actions FROM anon, authenticated;

CREATE TABLE public.auto_account_action_status_policies (
  id bigint PRIMARY KEY,
  action_code text REFERENCES public.auto_account_actions(code) ON DELETE RESTRICT,
  status_id bigint NOT NULL REFERENCES public.auto_status(id) ON DELETE RESTRICT,
  report_group text NOT NULL CHECK (report_group = ANY (ARRAY['success', 'failure', 'skipped', 'pending'])),
  counts_toward_limit boolean NOT NULL,
  bad_target_effect text NOT NULL CHECK (bad_target_effect = ANY (ARRAY['increment', 'reset', 'ignore'])),
  reset_error_streak boolean NOT NULL,
  input_effect text NOT NULL CHECK (input_effect = ANY (ARRAY['complete', 'pause', 'requeue', 'none'])),
  description text NOT NULL DEFAULT 'fixture',
  is_active boolean NOT NULL DEFAULT true,
  is_delete boolean NOT NULL DEFAULT false);
CREATE UNIQUE INDEX auto_aasp_default_status_uq ON public.auto_account_action_status_policies (status_id) WHERE action_code IS NULL;
CREATE UNIQUE INDEX auto_aasp_action_status_uq ON public.auto_account_action_status_policies (action_code, status_id) WHERE action_code IS NOT NULL;
INSERT INTO public.auto_account_action_status_policies (id, action_code, status_id, report_group, counts_toward_limit, bad_target_effect, reset_error_streak, input_effect) VALUES
  (1, NULL, 20, 'success', true, 'reset', true, 'complete'), (2, NULL, 21, 'failure', true, 'increment', true, 'complete'),
  (3, NULL, 22, 'failure', false, 'increment', false, 'complete'), (6, NULL, 27, 'skipped', false, 'ignore', false, 'complete'),
  (5, NULL, 30, 'skipped', false, 'ignore', false, 'complete'), (7, NULL, 31, 'skipped', false, 'ignore', false, 'complete'),
  (8, NULL, 33, 'skipped', false, 'ignore', false, 'complete'), (9, NULL, 36, 'failure', false, 'ignore', false, 'complete'),
  (26, NULL, 37, 'failure', false, 'ignore', false, 'complete'), (27, NULL, 38, 'failure', false, 'ignore', false, 'complete'),
  (4, NULL, 51, 'skipped', false, 'ignore', false, 'complete'),
  (10, 'fb_group_invite', 36, 'skipped', false, 'reset', false, 'complete'), (11, 'fb_join_group', 22, 'failure', true, 'increment', true, 'complete'),
  (12, 'zalo_tag_contact', 20, 'success', false, 'ignore', false, 'complete'), (13, 'zalo_tag_contact', 21, 'failure', false, 'ignore', false, 'complete'),
  (14, 'zalo_tag_contact', 22, 'failure', false, 'ignore', false, 'complete'), (15, 'zalo_change_alias', 20, 'success', false, 'ignore', false, 'complete'),
  (16, 'zalo_change_alias', 21, 'failure', false, 'ignore', false, 'complete'), (17, 'zalo_change_alias', 22, 'failure', false, 'ignore', false, 'complete');
REVOKE ALL ON public.auto_account_action_status_policies FROM anon, authenticated;

-- Bảng tham chiếu mà guard của migration/rollback đọc (cấu trúc rút gọn, đúng tên cột).
CREATE TABLE public.auto_error (
  id bigint PRIMARY KEY, error_code text NOT NULL, error_type text NOT NULL DEFAULT 'external zalo', detail_status text,
  detail_status_id bigint REFERENCES public.auto_status(id) ON DELETE RESTRICT, detail_mode text,
  zalo_action_codes text[] NOT NULL DEFAULT '{}', is_active boolean NOT NULL DEFAULT true, is_delete boolean NOT NULL DEFAULT false);
INSERT INTO public.auto_error (id, error_code, detail_status, zalo_action_codes) VALUES
  (7, 'err_zalo_user_not_found', 'không tồn tại', '{}'), (10, 'err_zalo_receiver_blocks_stranger_message', 'thất bại', '{}'),
  (18, 'err_zalo_api_business_failed', 'thất bại', '{}'), (31, 'err_zalo_friend_request_sent', 'thành công', '{zalo_add_friend}'),
  (32, 'err_zalo_already_friend', 'đã là bạn bè', '{}'), (35, 'err_zalo_group_member_already_exists', 'đã là thành viên', '{}'),
  (42, 'err_zalo_120_message_stranger', NULL, '{zalo_message_stranger}'), (16, 'err_zalo_session_invalid', NULL, '{}');
CREATE TABLE public.auto_campaign_action_detail_statuses (id bigint PRIMARY KEY, status_id bigint REFERENCES public.auto_status(id) ON DELETE SET NULL, status_value text NOT NULL);
INSERT INTO public.auto_campaign_action_detail_statuses VALUES (46, 20, 'thành công'), (111, NULL, 'không tồn tại');
CREATE TABLE public.auto_automation_trigger_statuses (id bigint PRIMARY KEY, sub_status_ids bigint[]);
INSERT INTO public.auto_automation_trigger_statuses VALUES (1, NULL), (2, ARRAY[52]::bigint[]);
CREATE TABLE public.auto_campaign_details (id bigserial PRIMARY KEY, status text, status_id bigint, sub_status_id bigint);
INSERT INTO public.auto_campaign_details (status, status_id) VALUES ('thành công', 20), ('thất bại', 21), ('không tồn tại', 36);
SQL

FP_ALL="SELECT md5(string_agg(to_jsonb(s)::text, '|' ORDER BY s.id)) FROM public.auto_status s"
FP_OLD="SELECT md5(string_agg((to_jsonb(s) - 'system_status_code')::text, '|' ORDER BY s.id)) FROM public.auto_status s WHERE s.id <= 55"
FP_POLICY="SELECT md5(string_agg(to_jsonb(p)::text, '|' ORDER BY p.id)) FROM public.auto_account_action_status_policies p"
FP_ERROR="SELECT md5(string_agg(to_jsonb(e)::text, '|' ORDER BY e.id)) FROM public.auto_error e"
DB=base
before_all=$(q "$FP_ALL"); before_policy=$(q "$FP_POLICY"); before_error=$(q "$FP_ERROR")
psql_db postgres -c "CREATE DATABASE t1 TEMPLATE base" -c "CREATE DATABASE t2 TEMPLATE base" -c "CREATE DATABASE t3 TEMPLATE base"

# ---- Apply ----
DB=t1
out=$(run_file t1 "$MIGRATION") || fail "apply V494: $out"
ok "apply V494 trên fixture trùng md5 production"
expect "6 trạng thái hệ thống" "$(q "SELECT string_agg(code || '>' || report_group, ',' ORDER BY sort_order) FROM public.auto_system_statuses")" \
  "success>success,failure>failure,skipped>skipped,stopped>pending,error>failure,pending>pending"
expect "41 dòng cũ của auto_status không đổi cột nào" "$(q "$FP_OLD")" "$before_all"
expect "policy và auto_error không đổi" "$(q "$FP_POLICY")|$(q "$FP_ERROR")" "$before_policy|$before_error"
expect "22 trạng thái cũ gắn trạng thái hệ thống" \
  "$(q "SELECT string_agg(id || ':' || system_status_code, ',' ORDER BY id) FROM public.auto_status WHERE component_type = 'campaign_detail' AND id <= 55")" \
  "20:success,21:failure,22:error,23:success,24:success,25:success,26:success,27:skipped,28:success,29:success,30:skipped,31:skipped,32:success,33:skipped,34:success,35:pending,36:failure,37:failure,38:failure,51:skipped,52:pending,55:success"
expect "19 trạng thái component khác để trống" "$(q "SELECT count(*) FROM public.auto_status WHERE component_type <> 'campaign_detail' AND system_status_code IS NULL")" "19"
expect "6 trạng thái Zalo mới, chưa bật" \
  "$(q "SELECT string_agg(status_value || '>' || system_status_code, ',' ORDER BY sort_order) FROM public.auto_status WHERE id > 55 AND NOT is_active AND flatform_type = 'zalo' AND component_type = 'campaign_detail'")" \
  "người nhận chặn tin>failure,tài khoản bị hạn chế>stopped,đạt giới hạn>stopped,hết phiên đăng nhập>stopped,lỗi kết nối>error,chưa rõ kết quả>error"
expect "2 trạng thái tương tác mới, chưa bật, xếp ngay sau 'đã xem'" \
  "$(q "SELECT string_agg(status_value || '>' || system_status_code || '>' || flatform_type, ',' ORDER BY sort_order) FROM public.auto_status WHERE component_type = 'campaign_detail' AND sort_order BETWEEN 150 AND 159")" \
  "đã xem>success>all,đã thả cảm xúc>success>all,đã phản hồi>success>all"
expect "trạng thái mới không có policy" "$(q "SELECT count(*) FROM public.auto_account_action_status_policies p JOIN public.auto_status s ON s.id = p.status_id WHERE s.id > 55")" "0"
expect "28 cặp đang ghi, 34 cặp chưa bật" "$(q "SELECT count(*) FILTER (WHERE is_active) || '/' || count(*) FILTER (WHERE NOT is_active) FROM public.auto_account_action_result_statuses")" "28/34"
expect "10 hành động Zalo có danh sách, zalo_join_group không có" \
  "$(q "SELECT count(DISTINCT action_code) || '/' || count(*) FILTER (WHERE action_code = 'zalo_join_group') FROM public.auto_account_action_result_statuses")" "10/0"
expect "danh sách đang ghi của Kết bạn" \
  "$(q "SELECT string_agg(s.status_value, ',' ORDER BY r.sort_order) FROM public.auto_account_action_result_statuses r JOIN public.auto_status s ON s.id = r.status_id WHERE r.action_code = 'zalo_add_friend' AND r.is_active")" \
  "thành công,thất bại,đã là bạn bè,không tồn tại"
expect "cặp đang ghi chỉ trỏ tới trạng thái đang bật" "$(q "SELECT count(*) FROM public.auto_account_action_result_statuses r JOIN public.auto_status s ON s.id = r.status_id WHERE r.is_active AND NOT s.is_active")" "0"
for action in zalo_message_stranger zalo_message_friend; do
  expect "$action: 4 trạng thái tương tác nằm giữa thành công và thất bại, chưa bật" \
    "$(q "SELECT string_agg(s.status_value || CASE WHEN r.is_active THEN '' ELSE '*' END, ',' ORDER BY r.sort_order) FROM public.auto_account_action_result_statuses r JOIN public.auto_status s ON s.id = r.status_id WHERE r.action_code = '$action' AND r.sort_order <= 20")" \
    "thành công,đã nhận*,đã xem*,đã thả cảm xúc*,đã phản hồi*,thất bại"
done
expect "nhắn group và hành động khác không có trạng thái tương tác" \
  "$(q "SELECT count(*) FROM public.auto_account_action_result_statuses r JOIN public.auto_status s ON s.id = r.status_id WHERE s.code IN ('campaign_detail_received', 'campaign_detail_viewed', 'campaign_detail_reacted', 'campaign_detail_replied') AND r.action_code NOT IN ('zalo_message_stranger', 'zalo_message_friend')")" "0"
expect "'đã nhận' và 'đã xem' dùng lại dòng có sẵn, không tạo trùng" \
  "$(q "SELECT string_agg(id || ':' || status_value || ':' || is_active::text, ',' ORDER BY id) FROM public.auto_status WHERE lower(status_value) IN ('đã nhận', 'đã xem')")" "32:đã nhận:true,34:đã xem:true"

# ---- Ràng buộc và guard ----
refuse "trạng thái kết quả mới thiếu trạng thái hệ thống bị từ chối" "auto_status_detail_system_status_check" \
  q "INSERT INTO public.auto_status (code, name, status_key, status_value, component_type) VALUES ('campaign_detail_x', 'X', 'x', 'x', 'campaign_detail')"
q "BEGIN; INSERT INTO public.auto_status (code, name, status_key, component_type) VALUES ('campaign_x', 'X', 'x', 'campaign'); ROLLBACK" >/dev/null
ok "trạng thái component khác không cần trạng thái hệ thống"
refuse "trạng thái hệ thống không có trong danh mục bị từ chối" "auto_status_system_status_code_fkey" \
  q "UPDATE public.auto_status SET system_status_code = 'unknown' WHERE id = 20"
refuse "không xóa được trạng thái hệ thống đang dùng" "auto_status_system_status_code_fkey" \
  q "DELETE FROM public.auto_system_statuses WHERE code = 'stopped'"
refuse "nhóm báo cáo lạ bị từ chối" "auto_system_statuses_report_group_check" \
  q "INSERT INTO public.auto_system_statuses (code, name, description, report_group, sort_order) VALUES ('x', 'X', 'x', 'stopped', 70)"
refuse "cặp hành động–trạng thái trỏ component khác bị từ chối" "action_result_status_component_invalid" \
  q "INSERT INTO public.auto_account_action_result_statuses (action_code, status_id) VALUES ('zalo_add_friend', 7)"
refuse "không bật được cặp khi trạng thái chưa bật" "action_result_status_inactive" \
  q "UPDATE public.auto_account_action_result_statuses SET is_active = true WHERE action_code = 'zalo_message_stranger' AND sort_order = 110"
refuse "cặp trùng bị từ chối" "auto_account_action_result_statuses_action_status_uq" \
  q "INSERT INTO public.auto_account_action_result_statuses (action_code, status_id) VALUES ('zalo_add_friend', 20)"
refuse "hành động không tồn tại bị từ chối" "auto_account_action_result_statuses_action_code_fkey" \
  q "INSERT INTO public.auto_account_action_result_statuses (action_code, status_id) VALUES ('zalo_unknown', 20)"

# ---- Quyền ----
expect "Desktop select * auto_status thấy cột mới" "$(q "SET ROLE aka_agent_desktop; SELECT count(*) FILTER (WHERE system_status_code IS NOT NULL) FROM (SELECT * FROM public.auto_status) s")" "30"
expect "chat worker to_jsonb(auto_status) chạy được" "$(q "SET ROLE aka_agent_chat_api; SELECT jsonb_array_length(jsonb_agg(to_jsonb(s))) FROM public.auto_status s")" "49"
for role in anon authenticated aka_agent_desktop; do
  for table in auto_system_statuses auto_account_action_result_statuses; do
    refuse "$role không đọc được $table" "permission denied" q "SET ROLE $role; SELECT count(*) FROM public.$table"
  done
done
expect "service_role đọc được hai bảng mới" "$(q "SET ROLE service_role; SELECT (SELECT count(*) FROM public.auto_system_statuses) + (SELECT count(*) FROM public.auto_account_action_result_statuses)")" "68"
expect "anon/authenticated không dùng được sequence và hàm guard mới" \
  "$(q "SELECT has_sequence_privilege('anon', 'public.auto_account_action_result_statuses_id_seq', 'USAGE')::text || has_sequence_privilege('authenticated', 'public.auto_account_action_result_statuses_id_seq', 'USAGE')::text || has_function_privilege('anon', 'public.aka_agent_guard_action_result_status_v494()', 'EXECUTE')::text || has_function_privilege('authenticated', 'public.aka_agent_guard_action_result_status_v494()', 'EXECUTE')::text")" \
  "falsefalsefalsefalse"
expect "hai bảng mới bật RLS" "$(q "SELECT bool_and(relrowsecurity)::text FROM pg_class WHERE oid IN ('public.auto_system_statuses'::regclass, 'public.auto_account_action_result_statuses'::regclass)")" "true"

# ---- Bộ đọc danh mục thật của bộ chạy (Desktop/App Server; chat worker dùng bản chép giống hệt) ----
q "SELECT json_build_object(
     'statuses', (SELECT json_agg(to_jsonb(s)) FROM public.auto_status s),
     'policies', (SELECT json_agg(to_jsonb(p)) FROM public.auto_account_action_status_policies p),
     'errors', (SELECT json_agg(to_jsonb(e)) FROM public.auto_error e),
     'actions', (SELECT json_agg(a.code) FROM public.auto_account_actions a WHERE a.flatform_type = 'zalo' AND a.code <> 'zalo_join_group'),
     'declared', (SELECT json_agg(json_build_object('action', r.action_code, 'code', s.code, 'active', r.is_active))
                    FROM public.auto_account_action_result_statuses r JOIN public.auto_status s ON s.id = r.status_id))" > "$WORK/catalog.json"
chmod 644 "$WORK/catalog.json"
cat > "$WORK/catalog-check.mts" <<NODE
import { readFileSync } from 'node:fs'
import { ActionStatusCatalog, ResultContractError } from '$ROOT/src/shared/actionStatusPolicy.ts'
const data = JSON.parse(readFileSync('$WORK/catalog.json', 'utf8'))
// Cùng phép ánh xạ với actionStatusPolicyRepository.ts và campaignActionResults.ts của chat worker.
const statuses = data.statuses.map((s: any) => ({ id: Number(s.id), code: String(s.code), name: String(s.name),
  statusValue: s.status_value == null ? null : String(s.status_value), color: s.color == null ? null : String(s.color),
  componentType: String(s.component_type), platform: String(s.flatform_type), isActive: s.is_active === true, isDelete: s.is_delete === true }))
const policies = data.policies.map((p: any) => ({ id: Number(p.id), actionCode: p.action_code == null ? null : String(p.action_code),
  statusId: Number(p.status_id), reportGroup: p.report_group, countsTowardLimit: p.counts_toward_limit, badTargetEffect: p.bad_target_effect,
  resetErrorStreak: p.reset_error_streak, inputEffect: p.input_effect, isActive: p.is_active === true, isDelete: p.is_delete === true }))
const catalog = new ActionStatusCatalog(statuses, policies)
// Preflight lúc bắt đầu chiến dịch: bộ ba cơ bản và mọi detail_status dạng chữ của policy lỗi Zalo.
catalog.preflight(data.actions.map((actionCode: string) => ({ actionCode,
  statusCodes: ['campaign_detail_success', 'campaign_detail_failed', 'campaign_detail_error'] })))
for (const error of data.errors) for (const actionCode of data.actions) {
  if (error.zalo_action_codes.length && !error.zalo_action_codes.includes(actionCode)) continue
  if (error.detail_status) catalog.selectPolicy(actionCode, catalog.statusForLegacyValue(String(error.detail_status), actionCode, 'zalo').code)
}
let active = 0, planned = 0
for (const row of data.declared) {
  if (row.active) { catalog.selectPolicy(row.action, row.code); active++; continue }
  // Cặp chưa bật không được phép phát: bộ chạy phải từ chối ngay ở danh mục, vì trạng thái chưa bật
  // (status_unavailable) hoặc vì trạng thái có sẵn nhưng chưa có policy kết quả ('đã nhận', 'đã xem': policy_missing).
  try { catalog.selectPolicy(row.action, row.code); throw new Error('planned status resolved: ' + row.code) }
  catch (error) { if (!(error instanceof ResultContractError) || !['status_unavailable', 'policy_missing'].includes(error.reason)) throw error }
  planned++
}
console.log(statuses.length + '/' + policies.length + '/' + active + '/' + planned)
NODE
chmod 644 "$WORK/catalog-check.mts"
expect "ActionStatusCatalog nạp danh mục sau V494, preflight Zalo đạt, cặp chưa bật bị từ chối" \
  "$(node --experimental-transform-types --no-warnings "$WORK/catalog-check.mts")" "49/19/28/34"

# ---- Chạy lại và lệch dữ liệu ----
refuse "apply lần hai bị từ chối" "v494: đã apply" run_file t1 "$MIGRATION"
DB=t2
q "UPDATE public.auto_status SET status_value = 'that bai' WHERE id = 21" >/dev/null
refuse "danh mục trạng thái lệch bản chụp bị từ chối" "danh mục trạng thái kết quả đã đổi" run_file t2 "$MIGRATION"
q "UPDATE public.auto_status SET status_value = 'thất bại' WHERE id = 21; UPDATE public.auto_account_action_status_policies SET report_group = 'skipped' WHERE id = 9" >/dev/null
refuse "policy mặc định lệch bản chụp bị từ chối" "policy mặc định đã đổi" run_file t2 "$MIGRATION"
q "UPDATE public.auto_account_action_status_policies SET report_group = 'failure' WHERE id = 9; INSERT INTO public.auto_account_actions (id, flatform_type, name, code) VALUES (90, 'zalo', 'Mới', 'zalo_new_action')" >/dev/null
refuse "hành động Zalo mới chưa khai báo bị từ chối" "danh sách hành động Zalo đã đổi" run_file t2 "$MIGRATION"
expect "lần apply bị từ chối không để lại gì" "$(q "SELECT (to_regclass('public.auto_system_statuses') IS NULL)::text || (SELECT count(*) FROM public.auto_status)")" "true41"

# ---- Rollback ----
DB=t1
out=$(run_file t1 "$ROLLBACK") || fail "rollback V494: $out"
ok "rollback V494"
expect "sau rollback auto_status trùng từng cột với ban đầu" "$(q "$FP_ALL")" "$before_all"
expect "sau rollback không còn bảng, cột, hàm của V494" \
  "$(q "SELECT (to_regclass('public.auto_system_statuses') IS NULL)::text || (to_regclass('public.auto_account_action_result_statuses') IS NULL)::text || (SELECT count(*) FROM pg_attribute WHERE attrelid = 'public.auto_status'::regclass AND attname = 'system_status_code' AND NOT attisdropped) || (SELECT count(*) FROM pg_proc WHERE proname = 'aka_agent_guard_action_result_status_v494')")" "truetrue00"
expect "rollback không đặt lại sequence (8 id đã cấp không dùng lại)" "$(q "SELECT (last_value >= 63)::text FROM public.auto_status_id_seq")" "true"
refuse "rollback lần hai bị từ chối" "chưa apply V494" run_file t1 "$ROLLBACK"
out=$(run_file t1 "$MIGRATION") || fail "apply lại sau rollback: $out"
ok "apply lại sau rollback"

DB=t3
run_file t3 "$MIGRATION" >/dev/null
q "INSERT INTO public.auto_campaign_details (status, status_id) SELECT status_value, id FROM public.auto_status WHERE code = 'campaign_detail_receiver_blocked'" >/dev/null
refuse "rollback từ chối khi trạng thái mới đã có kết quả" "đã được dùng" run_file t3 "$ROLLBACK"
q "DELETE FROM public.auto_campaign_details WHERE status = 'người nhận chặn tin'; UPDATE public.auto_error SET detail_status = 'đạt giới hạn' WHERE id = 42" >/dev/null
refuse "rollback từ chối khi auto_error đã trỏ tới trạng thái mới" "đã được dùng" run_file t3 "$ROLLBACK"
q "UPDATE public.auto_error SET detail_status = NULL WHERE id = 42; INSERT INTO public.auto_campaign_details (status, status_id, sub_status_id) SELECT 'thành công', 20, id FROM public.auto_status WHERE code = 'campaign_detail_replied'" >/dev/null
refuse "rollback từ chối khi 'đã phản hồi' đã được dùng làm trạng thái phụ" "đã được dùng" run_file t3 "$ROLLBACK"
q "DELETE FROM public.auto_campaign_details WHERE sub_status_id IS NOT NULL" >/dev/null
q "UPDATE public.auto_error SET detail_status = NULL WHERE id = 42; UPDATE public.auto_status SET is_active = true WHERE code = 'campaign_detail_session_expired'" >/dev/null
refuse "rollback từ chối khi trạng thái mới đã bật" "đã được bật" run_file t3 "$ROLLBACK"
q "UPDATE public.auto_status SET is_active = false WHERE code = 'campaign_detail_session_expired'; INSERT INTO public.auto_status (code, name, status_key, status_value, component_type, system_status_code) VALUES ('campaign_detail_later', 'Sau', 'later', 'sau', 'campaign_detail', 'failure')" >/dev/null
refuse "rollback từ chối khi đã có trạng thái thêm sau V494" "đã có trạng thái thêm sau V494" run_file t3 "$ROLLBACK"

echo "PASS $pass"
