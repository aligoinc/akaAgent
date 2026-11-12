#!/usr/bin/env bash
# Thử V502 (hàm đọc tiến độ giới hạn cho danh sách chiến dịch Web và tab "Hành động") trên PostgreSQL 16 cục bộ,
# không chạm production. Fixture chỉ dựng các cột mà hàm đọc, kèm index idx_auto_campaign_details_action_rate.
# Kiểm: apply, quyền (hàm đọc chỉ service_role, hàm Desktop chỉ aka_agent_desktop), phạm vi nhân viên/tổ chức, cách gắn
# nhãn dòng trong khung giờ, khung lớn nhất theo cài đặt chiến dịch/nhóm, trần 500 dòng, chế độ chi tiết, tham số sai,
# hàm Desktop với chuỗi xác thực token chép từ production (token đúng nhân viên + tài khoản/mật khẩu tự động hóa) ra đúng
# JSON như hàm đọc, apply lại bị từ chối, rollback.
# Dùng: bash scripts/test-v502-campaign-limit-progress.sh   (PGBIN mặc định /usr/lib/postgresql/16/bin)
set -euo pipefail
PGBIN=${PGBIN:-/usr/lib/postgresql/16/bin}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
MIGRATION="$ROOT/migrations/migration_v502_campaign_limit_progress.sql"
ROLLBACK="$ROOT/migrations/rollback_v502_campaign_limit_progress.sql"
WORK=$(mktemp -d "${TMPDIR:-/tmp}/v502.XXXXXX")
as_pg() { if [ "$(id -u)" = 0 ]; then runuser -u postgres -- "$@"; else "$@"; fi; }
[ "$(id -u)" = 0 ] && chown postgres "$WORK"
chmod 755 "$WORK"
cleanup() { as_pg "$PGBIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT
as_pg "$PGBIN/initdb" -D "$WORK/data" -A trust -U postgres -E UTF8 --locale=C >/dev/null
as_pg "$PGBIN/pg_ctl" -D "$WORK/data" -o "-k $WORK -c listen_addresses=''" -l "$WORK/log" -w start >/dev/null
psql_db() { as_pg "$PGBIN/psql" -h "$WORK" -U postgres -d fixture -v ON_ERROR_STOP=1 -qAt "$@"; }
q() { psql_db -c "$1"; }
# Gọi hàm dưới service_role như API WebApp.
fn() { psql_db -c "SET ROLE service_role; SELECT $1"; }
run_file() { psql_db -f "$1" 2>&1; }
pass=0
ok() { pass=$((pass + 1)); echo "ok $pass - $1"; }
fail() { echo "FAIL - $1" >&2; exit 1; }
expect() { [ "$2" = "$3" ] && ok "$1" || fail "$1 (mong đợi '$3', nhận '$2')"; }
refuse() { local name=$1 pattern=$2 out; shift 2; if out=$("$@" 2>&1); then fail "$name (không bị từ chối)"; fi
  case "$out" in *"$pattern"*) ok "$name" ;; *) fail "$name (thông báo khác: $out)" ;; esac; }

as_pg "$PGBIN/psql" -h "$WORK" -U postgres -d postgres -v ON_ERROR_STOP=1 -q <<'SQL'
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE ROLE aka_agent_desktop NOLOGIN;
CREATE DATABASE fixture;
SQL
psql_db >/dev/null <<'SQL'
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role, aka_agent_desktop;

CREATE TABLE public.auto_account_groups (id bigint PRIMARY KEY, name text, flatform_type text, settings jsonb,
  staff_id bigint, organization_id bigint, is_active boolean DEFAULT true, is_delete boolean DEFAULT false);
CREATE TABLE public.auto_accounts (id bigint PRIMARY KEY, name text, flatform_type text, staff_id bigint, organization_id bigint,
  is_delete boolean DEFAULT false, is_zalo_show_web boolean DEFAULT false, is_zalo_server boolean DEFAULT false, account_group_id bigint);
CREATE TABLE public.auto_campaign_actions (id text PRIMARY KEY, name text, limit_check_action_codes text[]);
CREATE TABLE public.auto_account_actions (id bigserial PRIMARY KEY, flatform_type text, name text, code text,
  is_active boolean DEFAULT true, is_delete boolean DEFAULT false);
CREATE TABLE public.auto_campaigns (id bigint PRIMARY KEY, name text, action_id text, account_id bigint, status text,
  schedule timestamptz, original_schedule timestamptz, schedule_type text, schedule_days text, schedule_week_days text,
  schedule_end_date timestamptz, daily_stop_time time, continue_next_day boolean, time_sleep_between_2 integer,
  last_run_at timestamptz, extra_settings jsonb, staff_id bigint, organization_id bigint, is_delete boolean DEFAULT false);
CREATE INDEX idx_auto_campaigns_staff_last_run ON public.auto_campaigns (staff_id, last_run_at);
CREATE TABLE public.auto_account_action_status (id bigserial PRIMARY KEY, account_id bigint, action_code text,
  count_action_in_day integer DEFAULT 0, count_date date, is_disable boolean DEFAULT false, date_enable timestamptz,
  disabled_error_code text, disabled_reason text, disabled_at timestamptz, updated_at timestamptz DEFAULT now(),
  UNIQUE (account_id, action_code));
CREATE TABLE public.auto_campaign_details (id bigserial PRIMARY KEY, campaign_id bigint, account_id bigint, action_code text,
  status text, counts_toward_limit boolean, created_at timestamptz DEFAULT now(), is_delete boolean DEFAULT false);
CREATE INDEX idx_auto_campaign_details_action_rate ON public.auto_campaign_details (account_id, action_code, created_at)
  WHERE is_delete = false AND action_code IS NOT NULL;
CREATE TABLE public.org_organization_product (id bigserial PRIMARY KEY, organization_id bigint, product_id bigint,
  expiration_date timestamptz, is_deleted boolean, is_chat_sync boolean);

-- Chuỗi xác thực token Desktop chép từ production (V434/V435), cùng bản với fixture WebApp
-- scripts/test-fixtures/campaign-input-duplicates-schema.sql: token -> nhân viên, rồi tài khoản/mật khẩu tự động hóa.
-- Đối chiếu production 12/11/2026: cùng logic (bỏ chú thích và nhánh tài khoản/chiến dịch mà V502 không dùng);
-- md5(prosrc) production: auto_assert 7ffeb0f1…, assert_request_ownership 2d02b1ac…, staff_scope 72417ffd….
CREATE SCHEMA private;
CREATE TABLE public.org_staff (id bigint PRIMARY KEY, organization_id bigint, is_active boolean, username text, password text);
INSERT INTO public.org_staff VALUES (1, 10, true, 'nv1', 'pw1'), (2, 10, true, 'nv2', 'pw2'), (3, 10, false, 'nv3', 'pw3');
CREATE SCHEMA auth;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;
CREATE TABLE private.aka_agent_desktop_users(auth_user_id uuid PRIMARY KEY, staff_id bigint NOT NULL);
INSERT INTO private.aka_agent_desktop_users VALUES ('00000000-0000-4000-8000-000000000001', 1), ('00000000-0000-4000-8000-000000000002', 2);
CREATE FUNCTION private.aka_agent_staff_scope_for_request() RETURNS bigint
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE v_claims jsonb; v_user uuid; v_staff bigint;
BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'aka_agent_desktop' THEN RETURN NULL; END IF;
 BEGIN
  v_claims := NULLIF(current_setting('request.jwt.claims',true),'')::jsonb;
  IF v_claims->>'role' IS DISTINCT FROM 'aka_agent_desktop' THEN RETURN 0; END IF;
  v_user := NULLIF(v_claims->>'sub','')::uuid;
 EXCEPTION WHEN invalid_text_representation THEN RETURN 0;
 END;
 SELECT staff_id INTO v_staff FROM private.aka_agent_desktop_users WHERE auth_user_id=v_user;
 RETURN COALESCE(v_staff,0);
END;
$$;
CREATE FUNCTION private.aka_agent_assert_request_ownership(p_staff_id bigint, p_account_id bigint, p_campaign_id bigint) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_staff bigint := private.aka_agent_staff_scope_for_request();
BEGIN
 IF v_staff IS NULL THEN RETURN true; END IF;
 IF v_staff <= 0 OR (p_staff_id IS NOT NULL AND p_staff_id IS DISTINCT FROM v_staff) THEN
   RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='desktop_staff_scope_denied';
 END IF;
 RETURN true;
END;
$$;
CREATE FUNCTION public.auto_assert_automation_identity(p_staff_id bigint, p_organization_id bigint, p_auth_username text, p_auth_password text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_claim_role text;
  v_claims jsonb;
BEGIN
  PERFORM private.aka_agent_assert_request_ownership(p_staff_id, NULL, NULL);
  v_claim_role := NULLIF(current_setting('request.jwt.claim.role', true), '');
  IF v_claim_role IS NULL THEN
    BEGIN
      v_claims := NULLIF(current_setting('request.jwt.claims', true), '')::jsonb;
      v_claim_role := NULLIF(v_claims ->> 'role', '');
    EXCEPTION WHEN OTHERS THEN v_claim_role := NULL;
    END;
  END IF;
  IF v_claim_role IS NULL THEN v_claim_role := NULLIF(auth.jwt() ->> 'role', ''); END IF;
  IF v_claim_role = 'service_role' THEN RETURN; END IF;
  IF p_auth_username IS NULL OR p_auth_password IS NULL THEN RAISE EXCEPTION 'automation_auth_required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.org_staff AS staff WHERE staff.id = p_staff_id AND staff.organization_id = p_organization_id
      AND staff.is_active = true AND staff.username = p_auth_username AND staff.password = p_auth_password) THEN
    RAISE EXCEPTION 'automation_auth_invalid';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.auto_assert_automation_identity(bigint,bigint,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auto_assert_automation_identity(bigint,bigint,text,text) TO service_role;
REVOKE ALL ON FUNCTION private.aka_agent_staff_scope_for_request() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.aka_agent_assert_request_ownership(bigint,bigint,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.aka_agent_staff_scope_for_request() TO aka_agent_desktop, service_role;
GRANT EXECUTE ON FUNCTION private.aka_agent_assert_request_ownership(bigint,bigint,bigint) TO aka_agent_desktop, service_role;

INSERT INTO auto_campaign_actions VALUES
  ('zalo_message_phone', 'Nhắn tin theo SĐT', '{zalo_find_phone_user,zalo_message_stranger,zalo_add_friend}'),
  ('zalo_message_friend', 'Nhắn tin bạn bè', '{zalo_message_friend}'),
  ('sms_send', 'Gửi SMS', '{sms_send}');
INSERT INTO auto_account_actions (flatform_type, name, code) VALUES
  ('zalo', 'Kết bạn', 'zalo_add_friend'), ('zalo', 'Nhắn tin người lạ', 'zalo_message_stranger'),
  ('sms', 'Gửi SMS', 'sms_send'), ('facebook', 'Comment', 'fb_comment');
INSERT INTO auto_account_actions (flatform_type, name, code, is_active) VALUES ('zalo', 'Đã tắt', 'zalo_off', false);
INSERT INTO auto_account_groups VALUES (7, 'Nhóm A', 'zalo', '{"byActionCode":{"zalo_add_friend":{"dailyLimit":20,"rateLimitMinutes":"90"}},"secret":"x"}', 1, 10);
-- Nhân viên 1 / tổ chức 10: tài khoản 100 (Zalo Server, nhóm 7), 101 (SMS). Nhân viên 2: tài khoản 200.
INSERT INTO auto_accounts VALUES
  (100, 'Zalo A', 'zalo', 1, 10, false, false, true, 7),
  (101, 'Máy SMS', 'sms', 1, 10, false, false, false, NULL),
  (200, 'Zalo người khác', 'zalo', 2, 10, false, false, true, NULL),
  (300, 'Zalo đã xóa', 'zalo', 1, 10, true, false, true, NULL);
INSERT INTO auto_campaigns (id, name, action_id, account_id, status, schedule, schedule_type, daily_stop_time, time_sleep_between_2,
  last_run_at, extra_settings, staff_id, organization_id, is_delete) VALUES
  (1, 'CD theo SĐT', 'zalo_message_phone', 100, 'chờ xử lý', now(), 'daily', '18:00', 120, now(),
    jsonb_build_object('enableMessage', true, 'enableAddFriend', true, 'note', 'ngắn',
      'advancedContentItems', jsonb_build_array(repeat('x', 500)), 'longText', repeat('y', 300),
      'actionLimits', jsonb_build_object('dailyLimit', 30, 'rateLimitCount', 9, 'rateLimitMinutes', 65,
        'byActionCode', jsonb_build_object('zalo_message_stranger', jsonb_build_object('rateLimitMinutes', 70)))),
    1, 10, false),
  (2, 'CD bạn bè', 'zalo_message_friend', 100, 'đang chạy', now(), 'once', NULL, 60, now(), '{"actionLimits":{"rateLimitMinutes":2000}}', 1, 10, false),
  (3, 'CD SMS', 'sms_send', 101, 'đang chạy', now(), 'daily', NULL, 5, now() - interval '3 days', '{}', 1, 10, false),
  (4, 'CD đã xóa', 'zalo_message_friend', 100, 'tạm dừng', now(), 'once', NULL, 60, now(), '{}', 1, 10, true),
  (5, 'CD của người khác', 'zalo_message_friend', 200, 'đang chạy', now(), 'once', NULL, 60, now(), '{}', 2, 10, false),
  (6, 'CD lệch tài khoản', 'zalo_message_friend', 200, 'đang chạy', now(), 'once', NULL, 60, now(), '{}', 1, 10, false),
  (7, 'CD tài khoản đã xóa', 'zalo_message_friend', 300, 'tạm dừng', now(), 'once', NULL, 60, NULL, 'null', 1, 10, false);
INSERT INTO auto_account_action_status (account_id, action_code, count_action_in_day, count_date, is_disable, date_enable, disabled_reason, updated_at) VALUES
  (100, 'zalo_add_friend', 18, (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date, false, NULL, NULL, now()),
  (100, 'zalo_tag_contact', 4, (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date, false, NULL, NULL, now()),
  (100, 'zalo_message_stranger', 3, (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date - 1, true, now() + interval '2 hours', 'Zalo tạm khóa', now() - interval '2 days'),
  (200, 'zalo_message_friend', 9, (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date, false, NULL, NULL, now());
-- Khung giờ của Kết bạn trên tài khoản 100: 3 dòng tính rõ, 1 dòng không tính, 2 dòng cũ (1 thành công, 1 trạng thái khác),
-- 1 dòng đã xóa, 1 dòng ngoài khung 90 phút (nhưng trong 24 giờ).
INSERT INTO auto_campaign_details (campaign_id, account_id, action_code, status, counts_toward_limit, created_at, is_delete) VALUES
  (1, 100, 'zalo_add_friend', 'thành công', true, now() - interval '5 minutes', false),
  (1, 100, 'zalo_add_friend', 'thất bại', true, now() - interval '20 minutes', false),
  (5, 100, 'zalo_add_friend', 'thành công', true, now() - interval '80 minutes', false),
  (1, 100, 'zalo_add_friend', 'thất bại', false, now() - interval '6 minutes', false),
  (1, 100, 'zalo_add_friend', 'thành công', NULL, now() - interval '30 minutes', false),
  (1, 100, 'zalo_add_friend', 'lỗi', NULL, now() - interval '31 minutes', false),
  (1, 100, 'zalo_add_friend', 'thành công', true, now() - interval '7 minutes', true),
  (1, 100, 'zalo_add_friend', 'thành công', true, now() - interval '100 minutes', false),
  (1, 100, 'zalo_tag_contact', 'thành công', false, now() - interval '9 minutes', false);
-- 520 SMS trong 10 phút gần nhất: vượt trần 500 dòng.
INSERT INTO auto_campaign_details (campaign_id, account_id, action_code, status, counts_toward_limit, created_at)
  SELECT 3, 101, 'sms_send', 'đã gửi', NULL, now() - (g || ' seconds')::interval FROM generate_series(1, 520) g;
INSERT INTO org_organization_product (organization_id, product_id, expiration_date, is_deleted, is_chat_sync) VALUES
  (10, 16, now() + interval '30 days', false, true), (11, 16, now() + interval '30 days', false, true),
  (10, 18, now() - interval '30 days', false, true);
SQL

SIG='public.aka_agent_control_campaign_limit_progress(bigint,bigint,bigint[],bigint[],text[],boolean)'
out=$(run_file "$MIGRATION") || fail "apply V502: $out"
ok "apply V502"
expect "hàm tồn tại" "$(q "SELECT to_regprocedure('$SIG') IS NOT NULL")" "t"
expect "chỉ postgres và service_role được gọi" "$(q "SELECT string_agg(g, ',' ORDER BY g) FROM (SELECT DISTINCT a.grantee::regrole::text g FROM pg_proc p, aclexplode(p.proacl) a WHERE p.oid = to_regprocedure('$SIG')) x")" "postgres,service_role"
expect "hàm STABLE, SECURITY INVOKER" "$(q "SELECT provolatile::text || prosecdef::text FROM pg_proc WHERE oid = to_regprocedure('$SIG')")" "sfalse"
expect "statement_timeout 8s" "$(q "SELECT array_to_string(proconfig, ',') FROM pg_proc WHERE oid = to_regprocedure('$SIG')")" "search_path=public, pg_temp,statement_timeout=8s"
refuse "anon không gọi được" "permission denied" psql_db -c "SET ROLE anon; SELECT aka_agent_control_campaign_limit_progress(1, 10, '{1}')"
refuse "aka_agent_desktop không gọi được" "permission denied" psql_db -c "SET ROLE aka_agent_desktop; SELECT aka_agent_control_campaign_limit_progress(1, 10, '{1}')"

KEYS="'{enableMessage,enableAddFriend,note,longText,advancedContentItems}'"
LIST="aka_agent_control_campaign_limit_progress(1, 10, '{1,2,3,4,5,6,7,999}', '{16,18}', $KEYS)"
expect "chỉ trả chiến dịch của đúng nhân viên, tài khoản cùng nhân viên, chưa xóa" "$(fn "(SELECT string_agg(c->>'id', ',' ORDER BY (c->>'id')::int) FROM jsonb_array_elements($LIST->'campaigns') c)")" "1,2,3,7"
expect "tổ chức khác không thấy gì" "$(fn "jsonb_array_length(aka_agent_control_campaign_limit_progress(1, 11, '{1,2,3}')->'campaigns')")" "0"
expect "tài khoản đã xóa được đánh dấu" "$(fn "(SELECT c #>> '{account,is_delete}' FROM jsonb_array_elements($LIST->'campaigns') c WHERE c->>'id' = '7')")" "true"
expect "extra_settings không phải object vẫn đọc được" "$(fn "(SELECT c->>'extra' FROM jsonb_array_elements($LIST->'campaigns') c WHERE c->>'id' = '7')")" "{}"
expect "extra chỉ giữ actionLimits và khóa được hỏi (cờ, số, chuỗi ngắn)" "$(fn "(SELECT string_agg(k, ',' ORDER BY k) FROM jsonb_array_elements($LIST->'campaigns') c, jsonb_object_keys(c->'extra') k WHERE c->>'id' = '1')")" "actionLimits,enableAddFriend,enableMessage,note"
expect "trả mã kiểm tra giới hạn của loại chiến dịch" "$(fn "(SELECT c->>'limitCheckActionCodes' FROM jsonb_array_elements($LIST->'campaigns') c WHERE c->>'id' = '1')")" '["zalo_find_phone_user", "zalo_message_stranger", "zalo_add_friend"]'
expect "nhóm tài khoản chỉ trả byActionCode" "$(fn "(SELECT c #>> '{group,settings}' FROM jsonb_array_elements($LIST->'campaigns') c WHERE c->>'id' = '1')")" '{"byActionCode": {"zalo_add_friend": {"dailyLimit": 20, "rateLimitMinutes": "90"}}}'
expect "lịch và nhịp chạy" "$(fn "(SELECT concat_ws('|', c->>'scheduleType', c->>'dailyStopTime', c->>'timeSleepBetween2') FROM jsonb_array_elements($LIST->'campaigns') c WHERE c->>'id' = '1')")" "daily|18:00:00|120"

WIN="(SELECT w FROM jsonb_array_elements($LIST->'windows') w WHERE w->>'accountId' = '100' AND w->>'actionCode' = 'zalo_add_friend')"
expect "khung lấy mức lớn nhất của chiến dịch và nhóm (90 phút)" "$(fn "$WIN->>'lookbackMinutes'")" "90"
expect "khung quá lớn bị giới hạn ở 24 giờ" "$(fn "(SELECT w->>'lookbackMinutes' FROM jsonb_array_elements($LIST->'windows') w WHERE w->>'accountId' = '100' AND w->>'actionCode' = 'zalo_message_friend')")" "1440"
expect "dòng tính rõ (true), bỏ dòng false, dòng đã xóa và dòng ngoài khung" "$(fn "jsonb_array_length($WIN->'e')")" "3"
expect "dòng cũ NULL thành công/thất bại" "$(fn "jsonb_array_length($WIN->'l')")" "1"
expect "dòng cũ NULL trạng thái khác" "$(fn "jsonb_array_length($WIN->'o')")" "1"
expect "mốc thời gian tăng dần" "$(fn "(SELECT bool_and(a.v <= b.v) FROM jsonb_array_elements_text($WIN->'e') WITH ORDINALITY a(v, i) JOIN jsonb_array_elements_text($WIN->'e') WITH ORDINALITY b(v, i) ON b.i = a.i + 1)")" "t"
ONE="aka_agent_control_campaign_limit_progress(1, 10, '{1}', '{16,18}')"
WIN1="(SELECT w FROM jsonb_array_elements($ONE->'windows') w WHERE w->>'actionCode' = 'zalo_add_friend')"
expect "mỗi mã kiểm tra giới hạn một khung" "$(fn "(SELECT string_agg(w->>'actionCode', ',' ORDER BY w->>'actionCode') FROM jsonb_array_elements($ONE->'windows') w)")" "zalo_add_friend,zalo_find_phone_user,zalo_message_stranger"
SMS="(SELECT w FROM jsonb_array_elements($LIST->'windows') w WHERE w->>'actionCode' = 'sms_send')"
expect "trần 500 dòng mỗi cặp và cờ truncated" "$(fn "concat_ws('|', jsonb_array_length($SMS->'o'), $SMS->>'truncated', $SMS->>'lookbackMinutes')")" "500|true|65"
expect "khung thường không bị cắt" "$(fn "$WIN1->>'truncated'")" "false"

expect "danh sách: chỉ trạng thái của hành động có kiểm tra giới hạn" "$(fn "(SELECT string_agg(s->>'actionCode', ',' ORDER BY s->>'actionCode') FROM jsonb_array_elements($LIST->'statuses') s)")" "zalo_add_friend,zalo_message_stranger"
expect "không hỏi khóa nào thì extra chỉ còn actionLimits" "$(fn "(SELECT string_agg(k, ',') FROM jsonb_array_elements(aka_agent_control_campaign_limit_progress(1, 10, '{1}')->'campaigns') c, jsonb_object_keys(c->'extra') k)")" "actionLimits"
expect "bộ đếm ngày và khóa" "$(fn "(SELECT concat_ws('|', s->>'countActionInDay', s->>'isDisable', s->>'disabledReason') FROM jsonb_array_elements($LIST->'statuses') s WHERE s->>'actionCode' = 'zalo_message_stranger')")" "3|true|Zalo tạm khóa"
expect "gói akaChat còn hạn" "$(fn "$LIST->>'chatSync'")" "true"
expect "gói akaChat hết hạn không tính" "$(fn "aka_agent_control_campaign_limit_progress(1, 10, '{1}', '{18}')->>'chatSync'")" "false"
expect "không truyền mã gói thì không phải akaChat" "$(fn "aka_agent_control_campaign_limit_progress(1, 10, '{1}')->>'chatSync'")" "false"
expect "chiến dịch cùng tài khoản chạy hôm nay (đúng nhân viên, chưa xóa)" "$(fn "(SELECT string_agg(s->>'campaignId', ',' ORDER BY (s->>'campaignId')::int) FROM jsonb_array_elements($LIST->'siblings') s)")" "1,2"
expect "tên hành động theo nền tảng của trang, bỏ dòng đã tắt" "$(fn "(SELECT string_agg(n->>'code', ',' ORDER BY n->>'code') FROM jsonb_array_elements($LIST->'actionNames') n)")" "sms_send,zalo_add_friend,zalo_message_stranger"
expect "mốc ngày Việt Nam" "$(fn "($LIST->>'nextDayStartsAt')::timestamptz - ($LIST->>'dayStartsAt')::timestamptz = interval '1 day' AND ($LIST->>'vietnamDate')::date = (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date")" "t"
expect "danh sách không đọc kết quả trong ngày" "$(fn "$LIST->>'today' IS NULL")" "t"

DETAIL="aka_agent_control_campaign_limit_progress(1, 10, '{1}', '{16}', '{}', true)"
# Kết quả trong ngày theo giờ Việt Nam: các dòng fixture cách hiện tại <= 100 phút có thể rơi vào hôm qua khi chạy ngay sau 00:00.
TODAY_COUNT=$(q "SELECT count(*) FROM auto_campaign_details WHERE account_id = 100 AND action_code = 'zalo_add_friend' AND is_delete = false AND created_at >= ((now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')")
expect "chi tiết: trạng thái của mọi hành động trên tài khoản" "$(fn "(SELECT string_agg(s->>'actionCode', ',' ORDER BY s->>'actionCode') FROM jsonb_array_elements($DETAIL->'statuses') s)")" "zalo_add_friend,zalo_message_stranger,zalo_tag_contact"
expect "chi tiết: tổng kết quả Kết bạn hôm nay, bỏ dòng đã xóa" "$(fn "(SELECT coalesce(sum((t->>'count')::int), 0) FROM jsonb_array_elements($DETAIL->'today') t WHERE t->>'actionCode' = 'zalo_add_friend')")" "$TODAY_COUNT"
expect "chi tiết: có cả hành động không giới hạn đã chạy hôm nay" "$(fn "(SELECT count(*) > 0 FROM jsonb_array_elements($DETAIL->'today') t WHERE t->>'actionCode' = 'zalo_tag_contact') OR NOT EXISTS (SELECT 1 FROM auto_campaign_details WHERE action_code = 'zalo_tag_contact' AND created_at >= ((now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh'))")" "t"
expect "chi tiết: tên chiến dịch của mình" "$(fn "(SELECT count(*) = 0 FROM jsonb_array_elements($DETAIL->'today') t WHERE t->>'campaignId' = '1' AND t->>'campaignName' IS DISTINCT FROM 'CD theo SĐT')")" "t"
expect "chi tiết: không lộ tên chiến dịch của nhân viên khác" "$(fn "(SELECT count(*) = 0 FROM jsonb_array_elements($DETAIL->'today') t WHERE t->>'campaignId' = '5' AND t->>'campaignName' IS NOT NULL)")" "t"
expect "chi tiết: tách theo cờ tính giới hạn" "$(fn "(SELECT count(DISTINCT t->>'countsTowardLimit') >= 1 FROM jsonb_array_elements($DETAIL->'today') t)")" "t"

refuse "chi tiết chỉ nhận một chiến dịch" "Invalid campaign ids" psql_db -c "SET ROLE service_role; SELECT aka_agent_control_campaign_limit_progress(1, 10, '{1,2}', '{}', '{}', true)"
refuse "danh sách rỗng bị từ chối" "Invalid campaign ids" psql_db -c "SET ROLE service_role; SELECT aka_agent_control_campaign_limit_progress(1, 10, '{}')"
refuse "quá 101 chiến dịch bị từ chối" "Invalid campaign ids" psql_db -c "SET ROLE service_role; SELECT aka_agent_control_campaign_limit_progress(1, 10, (SELECT array_agg(g) FROM generate_series(1, 102) g))"
refuse "thiếu nhân viên bị từ chối" "Missing campaign scope" psql_db -c "SET ROLE service_role; SELECT aka_agent_control_campaign_limit_progress(NULL, 10, '{1}')"

DSIG='public.aka_agent_read_campaign_limit_progress(bigint,bigint,text,text,bigint[],text[],boolean)'
# Gọi như PostgREST với token Desktop của nhân viên $1.
desk() { psql_db -c "SET ROLE aka_agent_desktop; SET request.jwt.claims = '{\"role\":\"aka_agent_desktop\",\"sub\":\"00000000-0000-4000-8000-00000000000$1\"}'; SELECT $2"; }
expect "hàm Desktop tồn tại" "$(q "SELECT to_regprocedure('$DSIG') IS NOT NULL")" "t"
expect "hàm Desktop chỉ postgres và aka_agent_desktop được gọi" "$(q "SELECT string_agg(g, ',' ORDER BY g) FROM (SELECT DISTINCT a.grantee::regrole::text g FROM pg_proc p, aclexplode(p.proacl) a WHERE p.oid = to_regprocedure('$DSIG')) x")" "aka_agent_desktop,postgres"
expect "hàm Desktop STABLE, SECURITY DEFINER, 8 giây" "$(q "SELECT provolatile::text || prosecdef::text || '|' || array_to_string(proconfig, ',') FROM pg_proc WHERE oid = to_regprocedure('$DSIG')")" "strue|search_path=pg_catalog, public,statement_timeout=8s"
refuse "service_role không gọi hàm Desktop" "permission denied" psql_db -c "SET ROLE service_role; SELECT aka_agent_read_campaign_limit_progress(1, 10, 'nv1', 'pw1', '{1}')"
refuse "anon không gọi hàm Desktop" "permission denied" psql_db -c "SET ROLE anon; SELECT aka_agent_read_campaign_limit_progress(1, 10, 'nv1', 'pw1', '{1}')"
DESK_LIST="aka_agent_read_campaign_limit_progress(1, 10, 'nv1', 'pw1', '{1,2,3,4,5,6,7,999}', $KEYS)"
CORE_LIST="aka_agent_control_campaign_limit_progress(1, 10, '{1,2,3,4,5,6,7,999}', '{}', $KEYS)"
# Cùng một giao dịch nên now() như nhau: JSON của Desktop phải trùng từng byte với hàm đọc (không mã gói akaChat).
same=$(psql_db -c "BEGIN; SET LOCAL ROLE aka_agent_desktop; SET LOCAL request.jwt.claims = '{\"role\":\"aka_agent_desktop\",\"sub\":\"00000000-0000-4000-8000-000000000001\"}'; SELECT md5($DESK_LIST::text); RESET ROLE; SET LOCAL ROLE service_role; SELECT md5($CORE_LIST::text); COMMIT;")
expect "Desktop ra đúng JSON của hàm đọc (danh sách)" "$(echo "$same" | sort -u | wc -l)|$(echo "$same" | wc -l)" "1|2"
same=$(psql_db -c "BEGIN; SET LOCAL ROLE aka_agent_desktop; SET LOCAL request.jwt.claims = '{\"role\":\"aka_agent_desktop\",\"sub\":\"00000000-0000-4000-8000-000000000001\"}'; SELECT md5(aka_agent_read_campaign_limit_progress(1, 10, 'nv1', 'pw1', '{1}', '{}', true)::text); RESET ROLE; SET LOCAL ROLE service_role; SELECT md5(aka_agent_control_campaign_limit_progress(1, 10, '{1}', '{}', '{}', true)::text); COMMIT;")
expect "Desktop ra đúng JSON của hàm đọc (chi tiết)" "$(echo "$same" | sort -u | wc -l)|$(echo "$same" | wc -l)" "1|2"
expect "Desktop thấy chiến dịch của mình" "$(desk 1 "(SELECT string_agg(c->>'id', ',' ORDER BY (c->>'id')::int) FROM jsonb_array_elements($DESK_LIST->'campaigns') c)")" "1,2,3,7"
expect "Desktop không dùng mã gói akaChat" "$(desk 1 "$DESK_LIST->>'chatSync'")" "false"
refuse "token của nhân viên khác bị từ chối" "desktop_staff_scope_denied" desk 2 "aka_agent_read_campaign_limit_progress(1, 10, 'nv1', 'pw1', '{1}')"
refuse "sai mật khẩu bị từ chối" "automation_auth_invalid" desk 1 "aka_agent_read_campaign_limit_progress(1, 10, 'nv1', 'sai', '{1}')"
refuse "sai tổ chức bị từ chối" "automation_auth_invalid" desk 1 "aka_agent_read_campaign_limit_progress(1, 11, 'nv1', 'pw1', '{1}')"
refuse "thiếu mật khẩu bị từ chối" "automation_auth_required" desk 1 "aka_agent_read_campaign_limit_progress(1, 10, 'nv1', NULL, '{1}')"
refuse "không có token bị từ chối" "desktop_staff_scope_denied" psql_db -c "SET ROLE aka_agent_desktop; SELECT aka_agent_read_campaign_limit_progress(1, 10, 'nv1', 'pw1', '{1}')"
refuse "Desktop: quá 101 chiến dịch bị từ chối" "Invalid campaign ids" desk 1 "aka_agent_read_campaign_limit_progress(1, 10, 'nv1', 'pw1', (SELECT array_agg(g) FROM generate_series(1, 102) g))"
refuse "Desktop vẫn không gọi thẳng hàm đọc" "permission denied" desk 1 "aka_agent_control_campaign_limit_progress(1, 10, '{1}')"

expect "hàm không ghi dữ liệu" "$(q "SELECT (SELECT count(*) FROM auto_campaign_details) || '|' || (SELECT sum(count_action_in_day) FROM auto_account_action_status)")" "529|34"
expect "đọc khung giờ bằng index action_rate" "$(q "SET enable_seqscan = off; EXPLAIN SELECT d.created_at FROM auto_campaign_details d WHERE d.account_id = 100 AND d.action_code = 'zalo_add_friend' AND d.is_delete = false AND d.created_at >= now() - make_interval(mins => 65) AND d.counts_toward_limit IS NOT FALSE ORDER BY d.created_at DESC LIMIT 500" | grep -c idx_auto_campaign_details_action_rate)" "1"

refuse "apply lần hai bị từ chối" "v502_target_already_exists_do_not_overwrite" run_file "$MIGRATION"
q "DROP INDEX idx_auto_campaign_details_action_rate" >/dev/null
out=$(run_file "$ROLLBACK") || fail "rollback: $out"
expect "rollback xóa cả hai hàm" "$(q "SELECT to_regprocedure('$SIG') IS NULL AND to_regprocedure('$DSIG') IS NULL")" "t"
refuse "thiếu index thì không apply" "v502_action_rate_index_missing" run_file "$MIGRATION"
out=$(run_file "$ROLLBACK") || fail "rollback lần hai: $out"
ok "rollback chạy lại được"
echo "V502: $pass kiểm tra đạt"
