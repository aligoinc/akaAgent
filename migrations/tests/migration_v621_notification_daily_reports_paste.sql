-- V621 (thông báo mặc định) — dán nguyên khối này vào Supabase SQL Editor (project akachat) rồi bấm Run.
-- Thành công: bảng kết quả có status = applied. Lỗi bất kỳ: không đổi gì trong DB.
BEGIN;
DO $v621_run$
DECLARE
  v_src text := $v621_src$-- V621: thông báo mặc định cho mọi tài khoản (Chào ngày mới 06:00–08:00, báo cáo 12:00 + 18:00, chiến dịch hoàn thành).
-- Sinh bằng scripts/build-v621-sql.py (không sửa tay); phương án docs/NOTIFICATION_DEFAULT_REPORTS_PLAN.md.
--
-- 1) Loại thông báo mới report.morning (CHECK của auto_notifications / auto_notification_subscriptions, NOT VALID; p2 VALIDATE).
-- 2) Hàm mới (private, chỉ owner): account_actions (kết quả theo tài khoản × thao tác + data chờ), completed_today, failure_reasons,
--    morning (chiến dịch chạy hôm nay + dự kiến + tài khoản cần xử lý), default_email, seed_defaults (bật sẵn cho nhân viên).
-- 3) Thay 9 hàm đang chạy (khoá md5 thân production đọc 21/11/2026 trước và sau): snapshot (kind account_actions / morning /
--    failure_reasons, report thêm completedToday), schedule_reports (lập lịch cả report.morning, rải 0–4 phút, 500 dòng/lượt),
--    center (get/save morningReport, lọc / tắt nhận report.morning), settings_json, subscription_json, default_filters,
--    save_subscription, cleanup, tick (gọi seed_defaults trong bước dọn hằng giờ, chỉ chế độ fly).
-- 4) Công tắc auto_system_settings notifications.default_reports = {"audience":"off"} (không gieo gì tới khi bật):
--    admin_akabiz → orgs (organizationIds) → all; "batch" nhân viên mỗi giờ (mặc định 200, tối đa 1000).
--    Chưa có email thì chỉ bật hộp thư + App, không xin email; có email lúc nào thì bật Email lúc đó (anh chốt 21/11/2026).
-- Client cũ không đổi hành vi: không gửi morningReport thì dòng đăng ký giữ nguyên; nội dung dựng sẵn vẫn là sections.
-- DDL: PostgREST nạp lại schema; apply buổi tối. Sau đó chạy migration_v621_notification_daily_reports_p2.sql (từng lệnh).
-- Gỡ: rollback_v621_notification_daily_reports.sql.

BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $v621_pre$
BEGIN
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v621_%') THEN
    RAISE EXCEPTION 'v621: sổ migration đã có V621, không chạy lại';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_system_settings WHERE key IN ('notifications.default_reports', 'notifications.report_spread_seconds')) THEN
    RAISE EXCEPTION 'v621: đã có notifications.default_reports / report_spread_seconds';
  END IF;
  IF to_regprocedure('private.aka_agent_notification_account_actions(bigint,text,text,timestamp with time zone)') IS NOT NULL THEN RAISE EXCEPTION 'v621: private.aka_agent_notification_account_actions(bigint,text,text,timestamp with time zone) đã có'; END IF;
  IF to_regprocedure('private.aka_agent_notification_completed_today(bigint,timestamp with time zone)') IS NOT NULL THEN RAISE EXCEPTION 'v621: private.aka_agent_notification_completed_today(bigint,timestamp with time zone) đã có'; END IF;
  IF to_regprocedure('private.aka_agent_notification_failure_reasons(bigint,bigint)') IS NOT NULL THEN RAISE EXCEPTION 'v621: private.aka_agent_notification_failure_reasons(bigint,bigint) đã có'; END IF;
  IF to_regprocedure('private.aka_agent_notification_morning(bigint,text,timestamp with time zone)') IS NOT NULL THEN RAISE EXCEPTION 'v621: private.aka_agent_notification_morning(bigint,text,timestamp with time zone) đã có'; END IF;
  IF to_regprocedure('private.aka_agent_notification_default_email(bigint)') IS NOT NULL THEN RAISE EXCEPTION 'v621: private.aka_agent_notification_default_email(bigint) đã có'; END IF;
  IF to_regprocedure('private.aka_agent_notification_seed_defaults(timestamp with time zone)') IS NOT NULL THEN RAISE EXCEPTION 'v621: private.aka_agent_notification_seed_defaults(timestamp with time zone) đã có'; END IF;
  IF to_regprocedure('public.aka_agent_engine_action_limit(bigint,bigint,text)') IS NULL THEN RAISE EXCEPTION 'v621: thiếu public.aka_agent_engine_action_limit(bigint,bigint,text)'; END IF;
  IF to_regprocedure('public.aka_agent_app_access_staff_allowed(bigint,text)') IS NULL THEN RAISE EXCEPTION 'v621: thiếu public.aka_agent_app_access_staff_allowed(bigint,text)'; END IF;
  IF to_regprocedure('private.aka_agent_notification_result_group(text,text)') IS NULL THEN RAISE EXCEPTION 'v621: thiếu private.aka_agent_notification_result_group(text,text)'; END IF;
  IF to_regprocedure('private.aka_agent_notification_next_run(smallint[],time without time zone[],text,timestamp with time zone)') IS NULL THEN RAISE EXCEPTION 'v621: thiếu private.aka_agent_notification_next_run(smallint[],time without time zone[],text,timestamp with time zone)'; END IF;
  IF to_regprocedure('private.aka_agent_notification_setting(text,text)') IS NULL THEN RAISE EXCEPTION 'v621: thiếu private.aka_agent_notification_setting(text,text)'; END IF;
  IF to_regprocedure('private.aka_agent_notification_flag(jsonb,boolean)') IS NULL THEN RAISE EXCEPTION 'v621: thiếu private.aka_agent_notification_flag(jsonb,boolean)'; END IF;
  IF md5(pg_get_functiondef('private.aka_agent_notification_default_filters(text)'::regprocedure)) IS DISTINCT FROM 'c5cc0691cc495c86e5b59b5f2f6e39c8' THEN
    RAISE EXCEPTION 'v621: private.aka_agent_notification_default_filters(text) khác bản đã đọc 21/11/2026 (md5 %)', md5(pg_get_functiondef('private.aka_agent_notification_default_filters(text)'::regprocedure));
  END IF;
  IF md5(pg_get_functiondef('private.aka_agent_notification_subscription_json(bigint,text)'::regprocedure)) IS DISTINCT FROM 'b400edcd2237492c18e19311ea719002' THEN
    RAISE EXCEPTION 'v621: private.aka_agent_notification_subscription_json(bigint,text) khác bản đã đọc 21/11/2026 (md5 %)', md5(pg_get_functiondef('private.aka_agent_notification_subscription_json(bigint,text)'::regprocedure));
  END IF;
  IF md5(pg_get_functiondef('private.aka_agent_notification_settings_json(bigint,uuid)'::regprocedure)) IS DISTINCT FROM '7f73a571f8e85077c8c3cce611d9c661' THEN
    RAISE EXCEPTION 'v621: private.aka_agent_notification_settings_json(bigint,uuid) khác bản đã đọc 21/11/2026 (md5 %)', md5(pg_get_functiondef('private.aka_agent_notification_settings_json(bigint,uuid)'::regprocedure));
  END IF;
  IF md5(pg_get_functiondef('private.aka_agent_notification_save_subscription(bigint,bigint,text,boolean,boolean,boolean,jsonb,integer,smallint[],time without time zone[],text)'::regprocedure)) IS DISTINCT FROM '208e5a5c185503c514d1c687cde4211e' THEN
    RAISE EXCEPTION 'v621: private.aka_agent_notification_save_subscription(bigint,bigint,text,boolean,boolean,boolean,jsonb,integer,smallint[],time without time zone[],text) khác bản đã đọc 21/11/2026 (md5 %)', md5(pg_get_functiondef('private.aka_agent_notification_save_subscription(bigint,bigint,text,boolean,boolean,boolean,jsonb,integer,smallint[],time without time zone[],text)'::regprocedure));
  END IF;
  IF md5(pg_get_functiondef('private.aka_agent_notification_schedule_reports(timestamp with time zone)'::regprocedure)) IS DISTINCT FROM '801b8ea24fea1dc96e11eb63758a675b' THEN
    RAISE EXCEPTION 'v621: private.aka_agent_notification_schedule_reports(timestamp with time zone) khác bản đã đọc 21/11/2026 (md5 %)', md5(pg_get_functiondef('private.aka_agent_notification_schedule_reports(timestamp with time zone)'::regprocedure));
  END IF;
  IF md5(pg_get_functiondef('private.aka_agent_notification_cleanup(timestamp with time zone)'::regprocedure)) IS DISTINCT FROM '5f8f4b5859b9224e8f1efcc734cdb883' THEN
    RAISE EXCEPTION 'v621: private.aka_agent_notification_cleanup(timestamp with time zone) khác bản đã đọc 21/11/2026 (md5 %)', md5(pg_get_functiondef('private.aka_agent_notification_cleanup(timestamp with time zone)'::regprocedure));
  END IF;
  IF md5(pg_get_functiondef('public.aka_agent_notification_tick()'::regprocedure)) IS DISTINCT FROM '18973d977bbdc8519a0e36148d5ada91' THEN
    RAISE EXCEPTION 'v621: public.aka_agent_notification_tick() khác bản đã đọc 21/11/2026 (md5 %)', md5(pg_get_functiondef('public.aka_agent_notification_tick()'::regprocedure));
  END IF;
  IF md5(pg_get_functiondef('private.aka_agent_notification_center(bigint,bigint,text,text,jsonb,uuid)'::regprocedure)) IS DISTINCT FROM 'ce94e5820e068aa441361500b0204715' THEN
    RAISE EXCEPTION 'v621: private.aka_agent_notification_center(bigint,bigint,text,text,jsonb,uuid) khác bản đã đọc 21/11/2026 (md5 %)', md5(pg_get_functiondef('private.aka_agent_notification_center(bigint,bigint,text,text,jsonb,uuid)'::regprocedure));
  END IF;
  IF md5(pg_get_functiondef('public.aka_agent_notification_snapshot(text,jsonb)'::regprocedure)) IS DISTINCT FROM 'c67d59fad197519aeb90e43c6e146e16' THEN
    RAISE EXCEPTION 'v621: public.aka_agent_notification_snapshot(text,jsonb) khác bản đã đọc 21/11/2026 (md5 %)', md5(pg_get_functiondef('public.aka_agent_notification_snapshot(text,jsonb)'::regprocedure));
  END IF;
END
$v621_pre$;

CREATE TEMP TABLE v621_acl (sig text PRIMARY KEY, acl text) ON COMMIT DROP;
DO $v621_acl$
BEGIN
  INSERT INTO pg_temp.v621_acl VALUES ('private.aka_agent_notification_default_filters(text)', (SELECT proacl::text FROM pg_proc WHERE oid = 'private.aka_agent_notification_default_filters(text)'::regprocedure));
  INSERT INTO pg_temp.v621_acl VALUES ('private.aka_agent_notification_subscription_json(bigint,text)', (SELECT proacl::text FROM pg_proc WHERE oid = 'private.aka_agent_notification_subscription_json(bigint,text)'::regprocedure));
  INSERT INTO pg_temp.v621_acl VALUES ('private.aka_agent_notification_settings_json(bigint,uuid)', (SELECT proacl::text FROM pg_proc WHERE oid = 'private.aka_agent_notification_settings_json(bigint,uuid)'::regprocedure));
  INSERT INTO pg_temp.v621_acl VALUES ('private.aka_agent_notification_save_subscription(bigint,bigint,text,boolean,boolean,boolean,jsonb,integer,smallint[],time without time zone[],text)', (SELECT proacl::text FROM pg_proc WHERE oid = 'private.aka_agent_notification_save_subscription(bigint,bigint,text,boolean,boolean,boolean,jsonb,integer,smallint[],time without time zone[],text)'::regprocedure));
  INSERT INTO pg_temp.v621_acl VALUES ('private.aka_agent_notification_schedule_reports(timestamp with time zone)', (SELECT proacl::text FROM pg_proc WHERE oid = 'private.aka_agent_notification_schedule_reports(timestamp with time zone)'::regprocedure));
  INSERT INTO pg_temp.v621_acl VALUES ('private.aka_agent_notification_cleanup(timestamp with time zone)', (SELECT proacl::text FROM pg_proc WHERE oid = 'private.aka_agent_notification_cleanup(timestamp with time zone)'::regprocedure));
  INSERT INTO pg_temp.v621_acl VALUES ('public.aka_agent_notification_tick()', (SELECT proacl::text FROM pg_proc WHERE oid = 'public.aka_agent_notification_tick()'::regprocedure));
  INSERT INTO pg_temp.v621_acl VALUES ('private.aka_agent_notification_center(bigint,bigint,text,text,jsonb,uuid)', (SELECT proacl::text FROM pg_proc WHERE oid = 'private.aka_agent_notification_center(bigint,bigint,text,text,jsonb,uuid)'::regprocedure));
  INSERT INTO pg_temp.v621_acl VALUES ('public.aka_agent_notification_snapshot(text,jsonb)', (SELECT proacl::text FROM pg_proc WHERE oid = 'public.aka_agent_notification_snapshot(text,jsonb)'::regprocedure));
END
$v621_acl$;

INSERT INTO public.auto_system_settings (key, value, description, is_secret, is_active) VALUES
  ('notifications.default_reports', '{"audience":"off","batch":200}',
   'V621: bật sẵn Chào ngày mới 07:00, báo cáo 12:00 + 18:00, chiến dịch Hoàn thành cho nhân viên chưa có cài đặt thông báo. audience: off | admin_akabiz | orgs (organizationIds) | all; batch: số nhân viên mỗi giờ (1–1000). Chưa có email thì chỉ hộp thư + App.',
   false, true),
  ('notifications.report_spread_seconds', '240',
   'V621: báo cáo theo lịch (12:00/18:00, Chào ngày mới) dựng rải 0..N giây theo nhân viên để hàng nghìn báo cáo cùng mốc không dựng cùng giây. 0 = dựng ngay.',
   false, true);

DO $v621_checks$
DECLARE v_def text; v_vals text[];
BEGIN
  -- auto_notifications_event_type_check: thêm 'report.morning', giữ nguyên mọi giá trị đang có (đọc từ định nghĩa hiện tại).
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint WHERE conrelid = 'public.auto_notifications'::regclass AND conname = 'auto_notifications_event_type_check';
  IF v_def IS NULL THEN RAISE EXCEPTION 'v621: thiếu ràng buộc auto_notifications_event_type_check'; END IF;
  v_vals := ARRAY(SELECT m[1] FROM regexp_matches(v_def, '''([^'']+)''::text', 'g') AS m);
  IF cardinality(v_vals) = 0 THEN RAISE EXCEPTION 'v621: không đọc được giá trị của auto_notifications_event_type_check: %', v_def; END IF;
  IF 'report.morning' = ANY (v_vals) THEN RAISE EXCEPTION 'v621: auto_notifications_event_type_check đã có report.morning'; END IF;
  v_vals := v_vals || 'report.morning'::text;
  EXECUTE format('ALTER TABLE public.auto_notifications DROP CONSTRAINT auto_notifications_event_type_check');
  EXECUTE format('ALTER TABLE public.auto_notifications ADD CONSTRAINT auto_notifications_event_type_check CHECK (event_type = ANY (ARRAY[%s])) NOT VALID',
    (SELECT string_agg(quote_literal(v) || '::text', ', ' ORDER BY o) FROM unnest(v_vals) WITH ORDINALITY AS t(v, o)));
  -- auto_notification_subscriptions_event_type_check: thêm 'report.morning', giữ nguyên mọi giá trị đang có (đọc từ định nghĩa hiện tại).
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint WHERE conrelid = 'public.auto_notification_subscriptions'::regclass AND conname = 'auto_notification_subscriptions_event_type_check';
  IF v_def IS NULL THEN RAISE EXCEPTION 'v621: thiếu ràng buộc auto_notification_subscriptions_event_type_check'; END IF;
  v_vals := ARRAY(SELECT m[1] FROM regexp_matches(v_def, '''([^'']+)''::text', 'g') AS m);
  IF cardinality(v_vals) = 0 THEN RAISE EXCEPTION 'v621: không đọc được giá trị của auto_notification_subscriptions_event_type_check: %', v_def; END IF;
  IF 'report.morning' = ANY (v_vals) THEN RAISE EXCEPTION 'v621: auto_notification_subscriptions_event_type_check đã có report.morning'; END IF;
  v_vals := v_vals || 'report.morning'::text;
  EXECUTE format('ALTER TABLE public.auto_notification_subscriptions DROP CONSTRAINT auto_notification_subscriptions_event_type_check');
  EXECUTE format('ALTER TABLE public.auto_notification_subscriptions ADD CONSTRAINT auto_notification_subscriptions_event_type_check CHECK (event_type = ANY (ARRAY[%s])) NOT VALID',
    (SELECT string_agg(quote_literal(v) || '::text', ', ' ORDER BY o) FROM unnest(v_vals) WITH ORDINALITY AS t(v, o)));
  -- auto_email_notification_settings_client_check: thêm 'default_seed', giữ nguyên mọi giá trị đang có (đọc từ định nghĩa hiện tại).
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint WHERE conrelid = 'public.auto_email_notification_settings'::regclass AND conname = 'auto_email_notification_settings_client_check';
  IF v_def IS NULL THEN RAISE EXCEPTION 'v621: thiếu ràng buộc auto_email_notification_settings_client_check'; END IF;
  v_vals := ARRAY(SELECT m[1] FROM regexp_matches(v_def, '''([^'']+)''::text', 'g') AS m);
  IF cardinality(v_vals) = 0 THEN RAISE EXCEPTION 'v621: không đọc được giá trị của auto_email_notification_settings_client_check: %', v_def; END IF;
  IF 'default_seed' = ANY (v_vals) THEN RAISE EXCEPTION 'v621: auto_email_notification_settings_client_check đã có default_seed'; END IF;
  v_vals := v_vals || 'default_seed'::text;
  EXECUTE format('ALTER TABLE public.auto_email_notification_settings DROP CONSTRAINT auto_email_notification_settings_client_check');
  EXECUTE format('ALTER TABLE public.auto_email_notification_settings ADD CONSTRAINT auto_email_notification_settings_client_check CHECK (updated_by_client IS NULL OR updated_by_client = ANY (ARRAY[%s])) NOT VALID',
    (SELECT string_agg(quote_literal(v) || '::text', ', ' ORDER BY o) FROM unnest(v_vals) WITH ORDINALITY AS t(v, o)));
END
$v621_checks$;

-- Hàm mới
-- V621: hàm mới của "Thông báo mặc định" (chào ngày mới, báo cáo 12:00/18:00, chiến dịch hoàn thành).
-- Bộ sinh scripts/build-v621-sql.py chép nguyên văn file này vào migration; sửa ở đây rồi sinh lại (khi chưa apply).

-- Kết quả theo tài khoản × thao tác trong một khung (hôm nay 00:00 → bây giờ, hoặc cả ngày hôm qua) + số data chờ.
-- Đọc theo từng cặp (tài khoản, thao tác) qua idx_auto_campaign_details_action_rate (account_id, action_code, created_at):
-- đọc chung theo tài khoản thì planner chọn idx_campaign_details_rate_limit (account_id, action_name, created_at) và quét cả
-- khoảng action_name (đo production 21/11/2026, nhân viên 385, 51 tài khoản, cùng dữ liệu đã nóng: 3,8 giây so với 0,26 giây).
-- Đọc nguội vẫn ~0,5 ms mỗi dòng kết quả (đọc heap; 8,8 nghìn dòng = 4 giây): API gọi kiểu này như phần phụ, lỗi/chậm thì bỏ bảng.
CREATE FUNCTION private.aka_agent_notification_account_actions(p_staff bigint, p_tz text, p_window text, p_now timestamptz)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_tz text := coalesce(nullif(p_tz, ''), 'Asia/Ho_Chi_Minh');
  v_today date := (p_now AT TIME ZONE v_tz)::date;
  v_from timestamptz; v_to timestamptz;
  v_with_pending boolean := p_window IS DISTINCT FROM 'yesterday';
  v_result jsonb;
BEGIN
  IF p_window = 'yesterday' THEN
    v_from := (v_today - 1)::timestamp AT TIME ZONE v_tz;
    v_to := v_today::timestamp AT TIME ZONE v_tz;
  ELSE
    v_from := v_today::timestamp AT TIME ZONE v_tz;
    v_to := p_now;
  END IF;
  WITH acc AS MATERIALIZED (
    SELECT a.id, a.name, a.flatform_type FROM public.auto_accounts a WHERE a.staff_id = p_staff AND a.is_delete IS NOT TRUE
  ), codes AS MATERIALIZED (
    SELECT aa.id AS ord, aa.code, regexp_replace(aa.name, '^(Zalo|Facebook|SMS|Email|Website) - ', '') AS name
      FROM public.auto_account_actions aa WHERE aa.is_delete = false
  ), res AS MATERIALIZED (
    SELECT acc.id AS account_id, codes.code, r.grp, r.n
      FROM acc CROSS JOIN codes
      CROSS JOIN LATERAL (
        SELECT private.aka_agent_notification_result_group(d.report_group, d.status) AS grp, count(*) AS n
          FROM public.auto_campaign_details d
         WHERE d.account_id = acc.id AND d.action_code = codes.code AND d.is_delete = false
           AND d.created_at >= v_from AND d.created_at < v_to
         GROUP BY 1) r
  ), camp AS MATERIALIZED (
    SELECT c.id, c.account_id, c.action_id,
           (SELECT count(*) FROM public.auto_campaign_input_data i
             WHERE i.campaign_id = c.id AND i.is_delete = false AND i.status = 'chờ xử lý') AS pending
      FROM public.auto_campaigns c JOIN acc ON acc.id = c.account_id
     WHERE v_with_pending AND c.staff_id = p_staff AND c.is_delete IS NOT TRUE AND c.status IN ('đang chạy', 'chờ xử lý')
  ), pend AS (
    -- Data chờ của một chiến dịch tính cho mọi thao tác của loại chiến dịch đó; comment đi kèm đăng nhóm không có số chờ riêng.
    SELECT camp.account_id, x.code, sum(camp.pending)::bigint AS n,
           bool_and(camp.action_id = 'facebook_group_post' AND x.code = 'fb_comment') AS attached
      FROM camp JOIN public.auto_campaign_actions ca ON ca.id = camp.action_id
      CROSS JOIN LATERAL unnest(ca.limit_check_action_codes) AS x(code)
     GROUP BY 1, 2
  ), agg AS (
    SELECT account_id, code,
           coalesce(sum(n) FILTER (WHERE grp = 'success'), 0) AS success,
           coalesce(sum(n) FILTER (WHERE grp = 'failure'), 0) AS failure,
           coalesce(sum(n) FILTER (WHERE grp NOT IN ('success', 'failure')), 0) AS skipped
      FROM res GROUP BY 1, 2
  ), cells AS (
    SELECT coalesce(r.account_id, p.account_id) AS account_id, coalesce(r.code, p.code) AS code,
           coalesce(r.success, 0) AS success, coalesce(r.failure, 0) AS failure, coalesce(r.skipped, 0) AS skipped,
           CASE WHEN NOT v_with_pending OR p.attached IS TRUE THEN NULL ELSE coalesce(p.n, 0) END AS pending
      FROM agg r FULL JOIN pend p ON p.account_id = r.account_id AND p.code = r.code
  ), rows AS (
    SELECT acc.id, acc.name,
           jsonb_build_object('accountId', acc.id, 'accountName', acc.name, 'platform', acc.flatform_type,
             'actions', jsonb_agg(jsonb_build_object('code', cells.code, 'name', coalesce(codes.name, cells.code),
                          'success', cells.success, 'failure', cells.failure, 'skipped', cells.skipped, 'pending', cells.pending)
                        ORDER BY codes.ord NULLS LAST, cells.code)) AS j
      FROM cells JOIN acc ON acc.id = cells.account_id LEFT JOIN codes ON codes.code = cells.code
     WHERE cells.success + cells.failure + cells.skipped + coalesce(cells.pending, 0) > 0
     GROUP BY acc.id, acc.name, acc.flatform_type
  )
  SELECT jsonb_build_object(
           'found', true, 'window', CASE WHEN p_window = 'yesterday' THEN 'yesterday' ELSE 'today' END,
           'from', v_from, 'to', v_to,
           'accountActions', coalesce((SELECT jsonb_agg(j ORDER BY name, id) FROM rows), '[]'::jsonb),
           'pendingTotal', CASE WHEN v_with_pending THEN coalesce((SELECT sum(pending) FROM camp), 0) END,
           'countedAt', p_now)
    INTO v_result;
  RETURN v_result;
END
$function$;

-- Chiến dịch hoàn thành hôm nay (≤ 20, mới nhất trước) với thành công / thất bại của cả chiến dịch, không tính bước Tìm SĐT.
-- Đếm theo status qua idx_auto_campaign_details_automation_status (campaign_id, status, action_code, created_at): chỉ đọc index.
-- Bỏ chiến dịch "Up tin cho chiến dịch …" do app tự tạo (anh chốt 21/11/2026).
CREATE FUNCTION private.aka_agent_notification_completed_today(p_staff bigint, p_day_start timestamptz)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
  WITH done AS MATERIALIZED (
    SELECT c.id, c.name, c.account_id, c.completed_at
      FROM public.auto_campaigns c
     WHERE c.staff_id = p_staff AND c.is_delete IS NOT TRUE AND c.status = 'hoàn thành' AND c.completed_at >= p_day_start
       AND NOT (c.action_id = 'facebook_comment_seeding_post' AND c.name LIKE 'Up tin cho chiến dịch %')
     ORDER BY c.completed_at DESC LIMIT 20
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', done.id, 'name', done.name, 'accountName', acc.name, 'completedAt', done.completed_at,
           'success', coalesce(g.success, 0), 'failure', coalesce(g.failure, 0)) ORDER BY done.completed_at DESC), '[]'::jsonb)
    FROM done
    LEFT JOIN public.auto_accounts acc ON acc.id = done.account_id
    LEFT JOIN LATERAL (
      SELECT count(*) FILTER (WHERE private.aka_agent_notification_result_group(NULL, d.status) = 'success') AS success,
             count(*) FILTER (WHERE private.aka_agent_notification_result_group(NULL, d.status) = 'failure') AS failure
        FROM public.auto_campaign_details d
       WHERE d.campaign_id = done.id AND d.is_delete = false AND d.action_code IS DISTINCT FROM 'zalo_find_phone_user'
    ) g ON true
$function$;

-- Lý do thất bại của một chiến dịch theo mã lỗi (mã công khai + câu cho khách), nhiều nhất trước, tối đa 8 dòng.
-- Đọc tối đa 5.000 dòng lỗi (chiến dịch lớn: số là ước lượng theo mẫu mới nhất của index, đủ để xếp hạng lý do).
CREATE FUNCTION private.aka_agent_notification_failure_reasons(p_staff bigint, p_campaign bigint)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM public.auto_campaigns c WHERE c.id = p_campaign AND c.staff_id = p_staff)
    THEN jsonb_build_object('found', false)
    ELSE jsonb_build_object('found', true, 'failureReasons', coalesce((
      SELECT jsonb_agg(jsonb_build_object('code', e.public_code, 'label', nullif(btrim(coalesce(e.customer_title, '')), ''), 'count', f.n)
                       ORDER BY f.n DESC)
        FROM (SELECT s.error_code, count(*) AS n
                FROM (SELECT d.error_code FROM public.auto_campaign_details d
                       WHERE d.campaign_id = p_campaign AND d.is_delete = false
                         AND d.status IN ('thất bại', 'lỗi', 'không tồn tại', 'tag không tồn tại', 'tham số không hợp lệ')
                       LIMIT 5000) s
               GROUP BY 1 ORDER BY 2 DESC LIMIT 8) f
        LEFT JOIN public.auto_error e ON e.error_code = f.error_code), '[]'::jsonb)) END
$function$;

-- "Chào ngày mới": chiến dịch sẽ chạy hôm nay (≤ 50, theo giờ chạy) với số data chờ và số dự kiến chạy hôm nay, tài khoản cần xử
-- lý trước giờ chạy, các báo cáo sẽ gửi trong ngày. Kết quả hôm qua do API đọc riêng bằng account_actions (window = yesterday).
-- Chạy hôm nay = chiến dịch chờ / đang chạy có lịch trước cuối ngày, chưa qua ngày kết thúc; lịch chưa được dời sang hôm nay (máy
-- Desktop tắt qua đêm) thì lịch tuần / tháng chỉ tính khi hôm nay là ngày chạy.
-- Dự kiến = data chờ, tối đa bằng giới hạn ngày còn lại nhỏ nhất của các thao tác gửi (aka_agent_engine_action_limit = công thức
-- bộ chạy, trừ lượt đã dùng hôm nay trong auto_account_action_status); chiến dịch cùng tài khoản chia phần còn lại theo giờ chạy.
CREATE FUNCTION private.aka_agent_notification_morning(p_staff bigint, p_tz text, p_now timestamptz)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_tz text := coalesce(nullif(p_tz, ''), 'Asia/Ho_Chi_Minh');
  v_today date := (p_now AT TIME ZONE v_tz)::date;
  v_day_start timestamptz := v_today::timestamp AT TIME ZONE v_tz;
  v_day_end timestamptz := (v_today + 1)::timestamp AT TIME ZONE v_tz;
  v_yesterday timestamptz := (v_today - 1)::timestamp AT TIME ZONE v_tz;
  -- Chiến dịch lưu ngày trong tuần 2 = Thứ Hai … 8 = Chủ nhật; đăng ký thông báo dùng 1 … 7.
  v_campaign_weekday text := (extract(isodow FROM v_today)::integer + 1)::text;
  v_isodow smallint := extract(isodow FROM v_today)::smallint;
  v_mday text := extract(day FROM v_today)::integer::text;
  v_today_part jsonb; v_report_times jsonb; v_notify boolean; v_completed integer;
BEGIN
  WITH c AS MATERIALIZED (
    SELECT c.id, c.name, c.account_id, c.action_id, c.schedule, acc.name AS account_name, acc.flatform_type, acc.login_status,
           acc.mobile_device_id, a.name AS action_name, coalesce(a.limit_check_action_codes, '{}'::text[]) AS codes,
           (SELECT count(*) FROM public.auto_campaign_input_data i
             WHERE i.campaign_id = c.id AND i.is_delete = false AND i.status = 'chờ xử lý') AS pending,
           c.action_id IN ('facebook_newsfeed_interaction', 'facebook_timeline_post', 'facebook_page_post') AS no_data
      FROM public.auto_campaigns c
      JOIN public.auto_accounts acc ON acc.id = c.account_id AND acc.is_delete IS NOT TRUE
      LEFT JOIN public.auto_campaign_actions a ON a.id = c.action_id
     WHERE c.staff_id = p_staff AND c.is_delete IS NOT TRUE AND c.status IN ('chờ xử lý', 'đang chạy')
       AND (c.schedule IS NULL OR c.schedule < v_day_end)
       AND (c.schedule_end_date IS NULL OR c.schedule_end_date >= v_day_start)
       AND NOT (c.action_id = 'facebook_comment_seeding_post' AND c.name LIKE 'Up tin cho chiến dịch %')
       AND (c.schedule IS NULL OR c.schedule >= v_day_start OR coalesce(c.schedule_type, 'daily') NOT IN ('weekly', 'monthly')
            OR (c.schedule_type = 'weekly'
                AND v_campaign_weekday = ANY (string_to_array(replace(coalesce(c.schedule_week_days, ''), ' ', ''), ',')))
            OR (c.schedule_type = 'monthly'
                AND v_mday = ANY (ARRAY(SELECT ltrim(btrim(x), '0') FROM unnest(string_to_array(coalesce(c.schedule_days, ''), ',')) AS x))))
  ), e AS MATERIALIZED (
    SELECT c.*, lim.daily, lim.day_left, lim.code AS limit_code,
           CASE WHEN c.schedule IS NULL THEN NULL WHEN c.schedule >= v_day_start THEN c.schedule
                ELSE (v_today + (c.schedule AT TIME ZONE v_tz)::time)::timestamp AT TIME ZONE v_tz END AS run_at
      FROM c
      LEFT JOIN LATERAL (
        SELECT x.code, l.daily, greatest(l.daily - coalesce(s.count_action_in_day, 0), 0) AS day_left
          FROM unnest(c.codes) AS x(code)
          CROSS JOIN LATERAL (SELECT (public.aka_agent_engine_action_limit(c.id, c.account_id, x.code) ->> 'daily')::numeric AS daily) l
          LEFT JOIN public.auto_account_action_status s
                 ON s.account_id = c.account_id AND s.action_code = x.code AND s.count_date = v_today
         WHERE x.code <> 'zalo_find_phone_user'
         ORDER BY 3, 2 LIMIT 1) lim ON NOT c.no_data
     WHERE c.no_data OR c.pending > 0
  ), shared AS (
    -- Các chiến dịch cùng tài khoản dùng chung giới hạn ngày của thao tác: chia theo thứ tự giờ chạy.
    SELECT e.*, coalesce(sum(least(e.pending, e.day_left)) OVER (PARTITION BY e.account_id, e.limit_code ORDER BY e.run_at NULLS LAST, e.id
                                                              ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS used_before
      FROM e
  ), ranked AS (
    SELECT shared.*, row_number() OVER (ORDER BY shared.run_at NULLS LAST, shared.id) AS rn FROM shared
  )
  SELECT jsonb_build_object(
           'campaignsToday', coalesce((SELECT jsonb_agg(jsonb_build_object('id', id, 'name', name, 'accountId', account_id,
                 'accountName', account_name, 'actionName', action_name, 'runAt', run_at, 'pendingInputs', pending,
                 'needsData', NOT no_data,
                 'expectedToday', CASE WHEN no_data THEN NULL WHEN day_left IS NULL THEN pending
                                       ELSE least(pending, greatest(day_left - used_before, 0)) END,
                 'dailyLimit', daily) ORDER BY rn) FROM ranked WHERE rn <= 50), '[]'::jsonb),
           'campaignsTodayTotal', (SELECT count(*) FROM ranked),
           'issues', coalesce((SELECT jsonb_agg(jsonb_build_object('severity', 'critical', 'code', 'account_logged_out_with_campaigns',
                 'subject', account_name,
                 'message', CASE WHEN flatform_type = 'sms' THEN 'Chưa gắn máy SMS'
                                 ELSE 'Tài khoản ' || CASE login_status WHEN 'checkpoint' THEN 'bị checkpoint' ELSE 'đã đăng xuất' END END
                            || ' trong khi còn ' || n || ' chiến dịch sẽ chạy hôm nay') ORDER BY account_name)
               FROM (SELECT account_id, account_name, flatform_type, login_status, count(*) AS n FROM ranked
                      WHERE CASE WHEN flatform_type = 'sms' THEN mobile_device_id IS NULL
                                 ELSE login_status IN ('chưa đăng nhập', 'checkpoint') END
                      GROUP BY 1, 2, 3, 4 LIMIT 20) x), '[]'::jsonb))
    INTO v_today_part;

  SELECT coalesce(jsonb_agg(to_char(t, 'HH24:MI') ORDER BY t), '[]'::jsonb) INTO v_report_times
    FROM public.auto_notification_subscriptions s CROSS JOIN LATERAL unnest(s.schedule_times) AS t
   WHERE s.staff_id = p_staff AND s.event_type = 'report.scheduled' AND s.scope = 'own' AND s.is_enabled
     AND v_isodow = ANY (coalesce(s.schedule_week_days, ARRAY[1, 2, 3, 4, 5, 6, 7]::smallint[]));
  SELECT EXISTS (SELECT 1 FROM public.auto_notification_subscriptions s
                  WHERE s.staff_id = p_staff AND s.event_type = 'campaign.status_changed' AND s.scope = 'own' AND s.is_enabled
                    AND coalesce(s.filters -> 'toStatuses', '["hoàn thành"]'::jsonb) ? 'hoàn thành') INTO v_notify;
  SELECT count(*) INTO v_completed FROM public.auto_campaigns c
   WHERE c.staff_id = p_staff AND c.is_delete IS NOT TRUE AND c.status = 'hoàn thành'
     AND c.completed_at >= v_yesterday AND c.completed_at < v_day_start
     AND NOT (c.action_id = 'facebook_comment_seeding_post' AND c.name LIKE 'Up tin cho chiến dịch %');

  RETURN jsonb_build_object('found', true, 'yesterday', jsonb_build_object('dayStart', v_yesterday, 'completedCampaigns', v_completed),
           'reportTimes', v_report_times, 'campaignNotify', v_notify, 'countedAt', p_now, 'dayStart', v_day_start, 'timezone', v_tz)
         || v_today_part;
END
$function$;

-- Email mặc định để gửi thông báo: email nhân viên; không có thì email tổ chức khi tổ chức chỉ có một nhân viên đang hoạt động.
-- Chưa có email hợp lệ thì NULL: không gửi email (anh chốt 21/11/2026: không xin email, có email lúc nào thì gửi lúc đó).
CREATE FUNCTION private.aka_agent_notification_default_email(p_staff bigint)
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT x.e FROM (
    SELECT lower(btrim(st.email)) AS e, 1 AS ord FROM public.org_staff st WHERE st.id = p_staff
    UNION ALL
    SELECT lower(btrim(o.email)), 2
      FROM public.org_staff st JOIN public.org_organization o ON o.id = st.organization_id
     WHERE st.id = p_staff
       AND (SELECT count(*) FROM public.org_staff s2
             WHERE s2.organization_id = st.organization_id AND s2.is_active IS TRUE AND s2.deleted_at IS NULL) = 1
  ) x
  WHERE x.e IS NOT NULL AND char_length(x.e) <= 254 AND x.e ~ '^[a-z0-9._%+''-]+@[a-z0-9.-]+\.[a-z]{2,}$'
  ORDER BY x.ord LIMIT 1
$function$;

-- Bật sẵn thông báo cho mọi nhân viên (gói còn hạn, kể cả dùng thử), chạy trong bước dọn hằng giờ của tick (chế độ fly).
-- Công tắc auto_system_settings notifications.default_reports = {"audience": "off" | "admin_akabiz" | "orgs" | "all",
-- "organizationIds": [...], "batch": 200}; V621 đặt "off". Ba việc, mỗi việc tối đa `batch` nhân viên mỗi lượt:
--   1. Chưa có dòng cài đặt: tạo cài đặt + Chào ngày mới 07:00, báo cáo 12:00 + 18:00 (bỏ khi không có gì), chiến dịch Hoàn thành;
--      mọi loại bật hộp thư + App; Email chỉ khi có email (đánh dấu đã xác minh vì là email đăng ký của chính tài khoản).
--   2. Đã có dòng cài đặt (khách tự lưu trước đây) mà chưa có Chào ngày mới: chỉ thêm Chào ngày mới, giữ mọi lựa chọn cũ.
--   3. Dòng do bước 1 tạo, khách chưa sửa (updated_by_client = 'default_seed'), chưa có email mà nay đã có: điền email và bật kênh
--      Email cho các loại đang bật. Thư đầu tiên là thông báo kế tiếp, không gửi bù.
CREATE FUNCTION private.aka_agent_notification_seed_defaults(p_now timestamptz)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_cfg jsonb; v_audience text; v_orgs bigint[] := '{}'; v_batch integer; r record;
  v_full integer := 0; v_morning integer := 0; v_email integer := 0; v_has_email boolean;
  v_days constant smallint[] := ARRAY[1, 2, 3, 4, 5, 6, 7]::smallint[];
  v_tz constant text := 'Asia/Ho_Chi_Minh';
BEGIN
  BEGIN
    v_cfg := private.aka_agent_notification_setting('notifications.default_reports', '{"audience":"off"}')::jsonb;
    v_audience := coalesce(v_cfg ->> 'audience', 'off');
    IF jsonb_typeof(v_cfg -> 'organizationIds') = 'array' THEN
      v_orgs := ARRAY(SELECT (x #>> '{}')::bigint FROM jsonb_array_elements(v_cfg -> 'organizationIds') x WHERE (x #>> '{}') ~ '^[0-9]{1,18}$');
    END IF;
    v_batch := least(greatest(coalesce((v_cfg ->> 'batch')::integer, 200), 1), 1000);
  EXCEPTION WHEN others THEN
    RETURN jsonb_build_object('audience', 'off', 'error', 'invalid_setting');
  END;
  IF v_audience NOT IN ('admin_akabiz', 'orgs', 'all') THEN RETURN jsonb_build_object('audience', 'off'); END IF;

  PERFORM set_config('aka.notification_center_write', 'on', true);

  -- 1. Nhân viên chưa có cài đặt.
  FOR r IN
    SELECT st.id, st.organization_id, private.aka_agent_notification_default_email(st.id) AS email
      FROM public.org_staff st
     WHERE st.is_active IS TRUE AND st.deleted_at IS NULL
       AND (v_audience = 'all' OR (v_audience = 'admin_akabiz' AND st.is_admin_akabiz IS TRUE)
            OR (v_audience = 'orgs' AND st.organization_id = ANY (v_orgs)))
       AND NOT EXISTS (SELECT 1 FROM public.auto_email_notification_settings e WHERE e.staff_id = st.id)
       AND public.aka_agent_app_access_staff_allowed(st.id, 'akaAgent')
     ORDER BY st.id
     LIMIT v_batch
  LOOP
    v_has_email := r.email IS NOT NULL;
    INSERT INTO public.auto_email_notification_settings (staff_id, organization_id, is_enabled, recipient_emails, notify_campaign_completed,
           daily_report_enabled, daily_report_time, is_delete, push_enabled, revision, settings_version, timezone, verified_emails,
           updated_by_client, updated_at)
    VALUES (r.id, r.organization_id, v_has_email, CASE WHEN v_has_email THEN ARRAY[r.email] ELSE '{}'::text[] END, v_has_email,
            v_has_email, '12:00', false, true, 1, 2, v_tz, CASE WHEN v_has_email THEN ARRAY[r.email] ELSE '{}'::text[] END,
            'default_seed', p_now)
    ON CONFLICT (staff_id) DO NOTHING;
    IF NOT FOUND THEN CONTINUE; END IF;
    INSERT INTO public.auto_notification_subscriptions AS s (staff_id, organization_id, event_type, is_enabled, email_enabled, push_enabled,
           filters, schedule_week_days, schedule_times, next_run_at)
    VALUES (r.id, r.organization_id, 'report.morning', true, v_has_email, true, '{"skipWhenIdle":true}'::jsonb, v_days, ARRAY['07:00'::time],
            private.aka_agent_notification_next_run(v_days, ARRAY['07:00'::time], v_tz, p_now)),
           (r.id, r.organization_id, 'report.scheduled', true, v_has_email, true, '{"skipWhenIdle":true,"maxCampaigns":50}'::jsonb, v_days,
            ARRAY['12:00'::time, '18:00'::time], private.aka_agent_notification_next_run(v_days, ARRAY['12:00'::time, '18:00'::time], v_tz, p_now)),
           (r.id, r.organization_id, 'campaign.status_changed', true, v_has_email, true,
            '{"toStatuses":["hoàn thành"],"campaignIds":null}'::jsonb, NULL, NULL, NULL)
    ON CONFLICT (staff_id, event_type, scope) DO NOTHING;
    v_full := v_full + 1;
  END LOOP;

  -- 2. Đã có cài đặt (tự lưu trước đây) mà chưa có Chào ngày mới.
  FOR r IN
    SELECT e.staff_id, e.organization_id, e.is_enabled AND cardinality(e.recipient_emails) > 0 AS has_email, e.timezone
      FROM public.auto_email_notification_settings e
      JOIN public.org_staff st ON st.id = e.staff_id
     WHERE e.is_delete IS NOT TRUE AND st.is_active IS TRUE AND st.deleted_at IS NULL
       AND (v_audience = 'all' OR (v_audience = 'admin_akabiz' AND st.is_admin_akabiz IS TRUE)
            OR (v_audience = 'orgs' AND st.organization_id = ANY (v_orgs)))
       AND NOT EXISTS (SELECT 1 FROM public.auto_notification_subscriptions s WHERE s.staff_id = e.staff_id AND s.event_type = 'report.morning')
       AND public.aka_agent_app_access_staff_allowed(st.id, 'akaAgent')
     ORDER BY e.staff_id
     LIMIT v_batch
  LOOP
    INSERT INTO public.auto_notification_subscriptions (staff_id, organization_id, event_type, is_enabled, email_enabled, push_enabled,
           filters, schedule_week_days, schedule_times, next_run_at)
    VALUES (r.staff_id, r.organization_id, 'report.morning', true, r.has_email, true, '{"skipWhenIdle":true}'::jsonb, v_days,
            ARRAY['07:00'::time], private.aka_agent_notification_next_run(v_days, ARRAY['07:00'::time], coalesce(r.timezone, v_tz), p_now))
    ON CONFLICT (staff_id, event_type, scope) DO NOTHING;
    IF FOUND THEN v_morning := v_morning + 1; END IF;
  END LOOP;

  -- 3. Cài đặt gieo sẵn, khách chưa sửa, nay đã có email.
  FOR r IN
    SELECT e.staff_id, x.email
      FROM public.auto_email_notification_settings e
      CROSS JOIN LATERAL (SELECT private.aka_agent_notification_default_email(e.staff_id) AS email) x
     WHERE e.updated_by_client = 'default_seed' AND e.is_delete IS NOT TRUE AND cardinality(e.recipient_emails) = 0
       AND x.email IS NOT NULL
     ORDER BY e.staff_id
     LIMIT v_batch
  LOOP
    UPDATE public.auto_email_notification_settings
       SET is_enabled = true, recipient_emails = ARRAY[r.email], verified_emails = ARRAY[r.email], notify_campaign_completed = true,
           daily_report_enabled = true, revision = revision + 1, updated_at = p_now
     WHERE staff_id = r.staff_id AND updated_by_client = 'default_seed' AND cardinality(recipient_emails) = 0;
    IF NOT FOUND THEN CONTINUE; END IF;
    UPDATE public.auto_notification_subscriptions SET email_enabled = true, updated_at = p_now
     WHERE staff_id = r.staff_id AND scope = 'own' AND is_enabled
       AND event_type IN ('report.morning', 'report.scheduled', 'campaign.status_changed');
    v_email := v_email + 1;
  END LOOP;

  PERFORM set_config('aka.notification_center_write', '', true);
  RETURN jsonb_build_object('audience', v_audience, 'seeded', v_full, 'morningAdded', v_morning, 'emailAdded', v_email);
END
$function$;


DO $v621_grants$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['private.aka_agent_notification_account_actions(bigint,text,text,timestamp with time zone)', 'private.aka_agent_notification_completed_today(bigint,timestamp with time zone)', 'private.aka_agent_notification_failure_reasons(bigint,bigint)', 'private.aka_agent_notification_morning(bigint,text,timestamp with time zone)', 'private.aka_agent_notification_default_email(bigint)', 'private.aka_agent_notification_seed_defaults(timestamp with time zone)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role, aka_agent_desktop, aka_agent_chat_api', f);
  END LOOP;
END
$v621_grants$;

-- Hàm thay thế (CREATE OR REPLACE giữ chủ sở hữu và quyền)
CREATE OR REPLACE FUNCTION private.aka_agent_notification_default_filters(p_event_type text)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
  SELECT CASE p_event_type
    WHEN 'campaign.status_changed' THEN '{"toStatuses":["hoàn thành","tạm dừng"],"campaignIds":null}'::jsonb
    WHEN 'account.status_changed' THEN '{"loginEvents":["logout","checkpoint","login"],"runStatuses":[],"accountIds":null}'::jsonb
    WHEN 'report.scheduled' THEN '{"skipWhenIdle":false,"maxCampaigns":50}'::jsonb
    WHEN 'report.morning' THEN '{"skipWhenIdle":true}'::jsonb
    WHEN 'data_group.membership_changed' THEN '{"groupIds":null,"actions":["added","removed"],"bucketMinutes":5,"includeSharedGroups":false}'::jsonb
    ELSE '{}'::jsonb END
$function$
;

CREATE OR REPLACE FUNCTION private.aka_agent_notification_subscription_json(p_staff_id bigint, p_event_type text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  WITH sub AS (SELECT * FROM public.auto_notification_subscriptions WHERE staff_id = p_staff_id AND event_type = p_event_type AND scope = 'own'),
       d AS (SELECT private.aka_agent_notification_default_filters(p_event_type) AS f),
       m AS (SELECT coalesce((SELECT filters FROM sub), '{}'::jsonb) AS f)
  SELECT jsonb_build_object('enabled', coalesce((SELECT is_enabled FROM sub), false),
                            'email', coalesce((SELECT email_enabled FROM sub), false),
                            'push', coalesce((SELECT push_enabled FROM sub), false),
                            'cooldownMinutes', (SELECT cooldown_minutes FROM sub))
         || CASE p_event_type
              WHEN 'campaign.status_changed' THEN jsonb_build_object(
                'toStatuses', coalesce(m.f -> 'toStatuses', d.f -> 'toStatuses'), 'campaignIds', coalesce(m.f -> 'campaignIds', 'null'::jsonb))
              WHEN 'account.status_changed' THEN jsonb_build_object(
                'loginEvents', coalesce(m.f -> 'loginEvents', d.f -> 'loginEvents'), 'runStatuses', coalesce(m.f -> 'runStatuses', d.f -> 'runStatuses'),
                'accountIds', coalesce(m.f -> 'accountIds', 'null'::jsonb))
              WHEN 'report.scheduled' THEN jsonb_build_object(
                'weekDays', coalesce(to_jsonb((SELECT schedule_week_days FROM sub)), '[1,2,3,4,5,6,7]'::jsonb),
                'times', coalesce((SELECT jsonb_agg(to_char(t, 'HH24:MI') ORDER BY t) FROM unnest((SELECT schedule_times FROM sub)) AS t), '["18:00"]'::jsonb),
                'skipWhenIdle', coalesce(m.f -> 'skipWhenIdle', d.f -> 'skipWhenIdle'), 'nextRunAt', (SELECT next_run_at FROM sub))
              WHEN 'report.morning' THEN jsonb_build_object(
                'time', coalesce((SELECT to_char((SELECT schedule_times FROM sub)[1], 'HH24:MI')), '07:00'),
                'skipWhenIdle', coalesce(m.f -> 'skipWhenIdle', d.f -> 'skipWhenIdle'), 'nextRunAt', (SELECT next_run_at FROM sub))
              WHEN 'data_group.membership_changed' THEN jsonb_build_object(
                'groupIds', coalesce(m.f -> 'groupIds', 'null'::jsonb), 'actions', coalesce(m.f -> 'actions', d.f -> 'actions'),
                'bucketMinutes', coalesce(m.f -> 'bucketMinutes', d.f -> 'bucketMinutes'),
                'includeSharedGroups', coalesce(m.f -> 'includeSharedGroups', d.f -> 'includeSharedGroups'))
              ELSE '{}'::jsonb END
    FROM d, m
$function$
;

CREATE OR REPLACE FUNCTION private.aka_agent_notification_settings_json(p_staff_id bigint, p_session_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE s public.auto_email_notification_settings%ROWTYPE; v_found boolean; v_devices jsonb;
BEGIN
  SELECT * INTO s FROM public.auto_email_notification_settings WHERE staff_id = p_staff_id AND is_delete IS NOT TRUE;
  v_found := FOUND;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', dv.id, 'name', dv.device_name, 'model', dv.device_model, 'osVersion', dv.os_version,
           'appVersion', dv.app_version, 'enabled', dv.is_enabled, 'hasToken', dv.push_token IS NOT NULL, 'permissionStatus', dv.permission_status,
           'lastRegisteredAt', dv.last_registered_at, 'lastSuccessAt', dv.last_success_at,
           'isCurrentDevice', p_session_id IS NOT NULL AND dv.control_session_id = p_session_id) ORDER BY dv.last_registered_at DESC), '[]'::jsonb)
    INTO v_devices
    FROM public.auto_notification_devices dv
    LEFT JOIN public.auto_control_sessions cs ON cs.id = dv.control_session_id
   WHERE dv.staff_id = p_staff_id AND dv.is_active AND (cs.id IS NULL OR (cs.revoked_at IS NULL AND cs.expires_at > now()));
  RETURN jsonb_build_object(
    'revision', CASE WHEN v_found THEN s.revision ELSE 0 END,
    'timezone', CASE WHEN v_found THEN s.timezone ELSE 'Asia/Ho_Chi_Minh' END,
    'updatedAt', CASE WHEN v_found THEN s.updated_at END,
    'updatedByClient', CASE WHEN v_found THEN s.updated_by_client END,
    'centerEnabled', private.aka_agent_notification_enabled(),
    'deliveryMode', private.aka_agent_notification_setting('notifications.delivery_mode', 'dry_run'),
    'channels', jsonb_build_object(
      'email', jsonb_build_object('enabled', CASE WHEN v_found THEN s.is_enabled ELSE false END,
                                  'recipients', to_jsonb(CASE WHEN v_found THEN s.recipient_emails ELSE '{}'::text[] END),
                                  'unverified', to_jsonb(CASE WHEN v_found THEN ARRAY(SELECT e FROM unnest(s.recipient_emails) AS e
                                                                                       WHERE NOT (e = ANY (s.verified_emails))) ELSE '{}'::text[] END)),
      'push', jsonb_build_object('enabled', CASE WHEN v_found THEN s.push_enabled ELSE false END, 'devices', v_devices)),
    'subscriptions', jsonb_build_object(
      'campaignStatus', private.aka_agent_notification_subscription_json(p_staff_id, 'campaign.status_changed'),
      'accountStatus', private.aka_agent_notification_subscription_json(p_staff_id, 'account.status_changed'),
      'scheduledReport', private.aka_agent_notification_subscription_json(p_staff_id, 'report.scheduled'),
      'morningReport', private.aka_agent_notification_subscription_json(p_staff_id, 'report.morning'),
      'dataGroupMembership', private.aka_agent_notification_subscription_json(p_staff_id, 'data_group.membership_changed')));
END
$function$
;

CREATE OR REPLACE FUNCTION private.aka_agent_notification_save_subscription(p_staff_id bigint, p_organization_id bigint, p_event_type text, p_enabled boolean, p_email boolean, p_push boolean, p_filters jsonb, p_cooldown integer, p_week_days smallint[], p_times time without time zone[], p_timezone text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  INSERT INTO public.auto_notification_subscriptions AS s (staff_id, organization_id, event_type, is_enabled, email_enabled, push_enabled,
                                                          filters, cooldown_minutes, schedule_week_days, schedule_times, next_run_at)
  VALUES (p_staff_id, p_organization_id, p_event_type, p_enabled, p_email, p_push, p_filters, p_cooldown, p_week_days, p_times,
          CASE WHEN p_event_type IN ('report.scheduled', 'report.morning') AND p_enabled
               THEN private.aka_agent_notification_next_run(p_week_days, p_times, p_timezone, clock_timestamp()) END)
  ON CONFLICT (staff_id, event_type, scope) DO UPDATE
     SET organization_id = EXCLUDED.organization_id, is_enabled = EXCLUDED.is_enabled, email_enabled = EXCLUDED.email_enabled,
         push_enabled = EXCLUDED.push_enabled, filters = EXCLUDED.filters, cooldown_minutes = EXCLUDED.cooldown_minutes,
         schedule_week_days = EXCLUDED.schedule_week_days, schedule_times = EXCLUDED.schedule_times,
         next_run_at = CASE WHEN EXCLUDED.schedule_week_days IS NOT DISTINCT FROM s.schedule_week_days
                              AND EXCLUDED.schedule_times IS NOT DISTINCT FROM s.schedule_times AND s.is_enabled AND s.next_run_at IS NOT NULL
                            THEN CASE WHEN EXCLUDED.is_enabled THEN s.next_run_at END
                            ELSE EXCLUDED.next_run_at END,
         updated_at = now();
END
$function$
;

CREATE OR REPLACE FUNCTION private.aka_agent_notification_schedule_reports(p_now timestamp with time zone)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE r record; v_count integer := 0; v_tz text; v_slot_local text; v_allowed boolean;
  -- notifications.report_spread_seconds (V621, mặc định 240; 0 = dựng ngay như trước).
  v_spread integer := greatest(least(private.aka_agent_notification_int_setting('notifications.report_spread_seconds', 240), 3600), 0) + 1;
BEGIN
  FOR r IN
    SELECT s.* FROM public.auto_notification_subscriptions s
     WHERE s.event_type IN ('report.scheduled', 'report.morning') AND s.is_enabled AND s.next_run_at IS NOT NULL AND s.next_run_at <= p_now
     ORDER BY s.next_run_at LIMIT 500 FOR UPDATE SKIP LOCKED
  LOOP
    SELECT coalesce(min(e.timezone), 'Asia/Ho_Chi_Minh') INTO v_tz FROM public.auto_email_notification_settings e WHERE e.staff_id = r.staff_id;
    v_slot_local := to_char(r.next_run_at AT TIME ZONE v_tz, 'YYYY-MM-DD"T"HH24:MI');
    SELECT st.is_active IS TRUE AND st.deleted_at IS NULL AND public.aka_agent_app_access_staff_allowed(st.id, 'akaAgent')
      INTO v_allowed FROM public.org_staff st WHERE st.id = r.staff_id;
    -- Lỡ nhiều mốc (sự cố) chỉ tạo một báo cáo cho mốc đến hạn sớm nhất rồi nhảy tới mốc tương lai.
    -- V621: thêm Chào ngày mới (report.morning, entity morning:, dedupe rm:); dựng rải 0–4 phút theo nhân viên để hàng nghìn báo
    -- cáo cùng mốc không dựng cùng giây (notifications.report_spread_seconds).
    IF coalesce(v_allowed, false) THEN
    INSERT INTO public.auto_notifications (organization_id, staff_id, event_type, severity, entity_key, occurred_at, deliver_after, dedupe_key, payload)
    VALUES (r.organization_id, r.staff_id, r.event_type, 'info',
            CASE WHEN r.event_type = 'report.morning' THEN 'morning:' ELSE 'report:' END || v_slot_local, p_now,
            p_now + make_interval(secs => (r.staff_id % v_spread)::double precision),
            format(CASE WHEN r.event_type = 'report.morning' THEN 'rm:%s:%s' ELSE 'rp:%s:%s' END, r.staff_id, v_slot_local),
            jsonb_build_object('slotAt', r.next_run_at, 'slotLocal', v_slot_local, 'timezone', v_tz,
                               'skipWhenIdle', coalesce((r.filters ->> 'skipWhenIdle')::boolean, false),
                               'maxCampaigns', least(greatest(coalesce((r.filters ->> 'maxCampaigns')::integer, 50), 1), 100)))
    ON CONFLICT (dedupe_key) DO NOTHING;
    v_count := v_count + 1;
    END IF;
    UPDATE public.auto_notification_subscriptions
       SET last_run_at = r.next_run_at,
           next_run_at = private.aka_agent_notification_next_run(r.schedule_week_days, r.schedule_times, v_tz, p_now),
           updated_at = p_now
     WHERE id = r.id;
  END LOOP;
  RETURN v_count;
END
$function$
;

CREATE OR REPLACE FUNCTION private.aka_agent_notification_cleanup(p_now timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_notifications integer; v_snapshots integer; v_events integer;
BEGIN
  DELETE FROM public.auto_notifications WHERE id IN (
    SELECT id FROM public.auto_notifications
     WHERE created_at < p_now - make_interval(days => private.aka_agent_notification_int_setting('notifications.retention_days', 90))
     ORDER BY created_at LIMIT 1000);
  GET DIAGNOSTICS v_notifications = ROW_COUNT;
  UPDATE public.auto_notifications SET content_snapshot = NULL, updated_at = p_now WHERE id IN (
    SELECT id FROM public.auto_notifications
     WHERE event_type IN ('report.scheduled', 'report.morning') AND content_snapshot IS NOT NULL
       AND created_at < p_now - make_interval(days => private.aka_agent_notification_int_setting('notifications.report_retention_days', 30))
     ORDER BY created_at LIMIT 1000);
  GET DIAGNOSTICS v_snapshots = ROW_COUNT;
  DELETE FROM public.auto_data_group_member_events WHERE id IN (
    SELECT id FROM public.auto_data_group_member_events
     WHERE created_at < p_now - make_interval(days => private.aka_agent_notification_int_setting('notifications.member_event_retention_days', 90))
     ORDER BY created_at LIMIT 5000);
  GET DIAGNOSTICS v_events = ROW_COUNT;
  RETURN jsonb_build_object('notifications', v_notifications, 'reportSnapshots', v_snapshots, 'memberEvents', v_events);
END
$function$
;

CREATE OR REPLACE FUNCTION public.aka_agent_notification_tick()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_state private.aka_agent_notification_dispatch_state%ROWTYPE;
  v_reports integer := 0; v_cleanup jsonb; v_has_work boolean; v_seed jsonb;
BEGIN
  IF NOT private.aka_agent_notification_enabled() THEN RETURN jsonb_build_object('enabled', false, 'run', false); END IF;
  -- Chưa chuyển sang Fly: tick 30 giây trong DB vẫn lo lập lịch và gọi worker như cũ.
  IF lower(btrim(private.aka_agent_notification_setting('notifications.dispatch_mode', 'pg_net'))) <> 'fly' THEN
    RETURN jsonb_build_object('enabled', true, 'mode', 'pg_net', 'run', false);
  END IF;
  v_reports := private.aka_agent_notification_schedule_reports(v_now);
  SELECT * INTO v_state FROM private.aka_agent_notification_dispatch_state WHERE id = 1 FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('enabled', true, 'mode', 'fly', 'reports', v_reports, 'run', false, 'skipped', 'state_locked');
  END IF;
  IF v_state.last_cleanup_at IS NULL OR v_state.last_cleanup_at < v_now - interval '1 hour' THEN
    v_cleanup := private.aka_agent_notification_cleanup(v_now);
    -- V621: bật sẵn thông báo cho nhân viên chưa có (theo notifications.default_reports); lỗi không làm hỏng lượt tick.
    BEGIN
      v_seed := private.aka_agent_notification_seed_defaults(v_now);
    EXCEPTION WHEN others THEN
      v_seed := jsonb_build_object('error', SQLSTATE);
    END;
    v_cleanup := v_cleanup || jsonb_build_object('seed', v_seed);
    UPDATE private.aka_agent_notification_dispatch_state SET last_cleanup_at = v_now, updated_at = v_now WHERE id = 1;
  END IF;
  v_has_work := EXISTS (SELECT 1 FROM public.auto_notifications n
                         WHERE (n.content_status = 'pending' AND n.deliver_after <= v_now)
                            OR (n.content_status = 'rendering' AND n.leased_until < v_now))
             OR EXISTS (SELECT 1 FROM public.auto_notification_deliveries d
                         WHERE (d.status IN ('pending', 'retrying') AND d.next_attempt_at <= v_now)
                            OR (d.status = 'sending' AND d.leased_until < v_now));
  IF NOT v_has_work THEN
    RETURN jsonb_build_object('enabled', true, 'mode', 'fly', 'reports', v_reports, 'run', false, 'work', false, 'cleanup', v_cleanup);
  END IF;
  -- Cùng khóa thuê với đường pg_net: một lượt worker tại một thời điểm, kể cả khi có nhiều máy Fly hoặc lúc đổi chế độ.
  -- Worker gọi action 'release' khi xong; máy chết giữa lượt thì khóa tự hết sau 60 giây.
  IF v_state.leased_until IS NOT NULL AND v_state.leased_until > v_now THEN
    RETURN jsonb_build_object('enabled', true, 'mode', 'fly', 'reports', v_reports, 'run', false, 'work', true, 'busy', true);
  END IF;
  UPDATE private.aka_agent_notification_dispatch_state
     SET leased_until = v_now + interval '60 seconds', last_called_at = v_now, last_request_id = NULL, updated_at = v_now
   WHERE id = 1;
  RETURN jsonb_build_object('enabled', true, 'mode', 'fly', 'reports', v_reports, 'run', true, 'work', true, 'cleanup', v_cleanup);
END
$function$
;

CREATE OR REPLACE FUNCTION private.aka_agent_notification_center(p_staff_id bigint, p_organization_id bigint, p_client text, p_action text, p_payload jsonb, p_session_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_p jsonb := coalesce(p_payload, '{}'::jsonb);
  s public.auto_email_notification_settings%ROWTYPE;
  v_found boolean; v_current_rev bigint; v_rev bigint;
  v_email_enabled boolean; v_push_enabled boolean; v_recipients text[]; v_old_recipients text[]; v_verified text[]; v_email text;
  v_c jsonb; v_a jsonb; v_r jsonb; v_g jsonb; v_m jsonb; v_m_time time without time zone;
  v_c_enabled boolean; v_c_email boolean; v_c_push boolean; v_c_statuses jsonb; v_c_ids jsonb; v_c_cool integer;
  v_a_enabled boolean; v_a_email boolean; v_a_push boolean; v_a_login jsonb; v_a_run jsonb; v_a_ids jsonb; v_a_cool integer;
  v_r_enabled boolean; v_r_email boolean; v_r_push boolean; v_r_days smallint[]; v_r_times time without time zone[]; v_r_idle boolean;
  v_g_enabled boolean; v_g_email boolean; v_g_push boolean; v_g_ids jsonb; v_g_actions jsonb; v_g_bucket integer; v_g_shared boolean;
  v_limit integer; v_cursor_at timestamptz; v_cursor_id bigint; v_type text; v_unread boolean; v_items jsonb; v_count integer;
  v_id bigint; v_installation uuid; v_token text; v_bundle text; v_env text; v_rows integer; v_session record; v_ids bigint[];
  v_n public.auto_notifications%ROWTYPE; v_tz text; v_explicit boolean; v_active boolean;
BEGIN
  IF p_client NOT IN ('web', 'ios', 'desktop') THEN RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'notification_invalid_client'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.org_staff st WHERE st.id = p_staff_id AND st.organization_id = p_organization_id
                  AND st.is_active IS TRUE AND st.deleted_at IS NULL) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'notification_access_denied';
  END IF;

  IF p_action = 'get_settings' THEN
    RETURN private.aka_agent_notification_settings_json(p_staff_id, p_session_id);

  ELSIF p_action = 'save_settings' THEN
    IF jsonb_typeof(v_p -> 'revision') <> 'number' THEN RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'notification_revision_required'; END IF;
    v_rev := (v_p ->> 'revision')::bigint;
    SELECT * INTO s FROM public.auto_email_notification_settings WHERE staff_id = p_staff_id FOR UPDATE;
    v_found := FOUND;
    v_current_rev := CASE WHEN v_found AND s.is_delete IS NOT TRUE THEN s.revision ELSE 0 END;
    IF v_rev IS DISTINCT FROM v_current_rev THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'notification_settings_conflict';
    END IF;
    v_tz := CASE WHEN v_found THEN s.timezone ELSE 'Asia/Ho_Chi_Minh' END;
    v_old_recipients := CASE WHEN v_found AND s.is_delete IS NOT TRUE THEN s.recipient_emails ELSE '{}'::text[] END;
    -- Kênh
    v_email_enabled := private.aka_agent_notification_flag(v_p #> '{channels,email,enabled}', CASE WHEN v_found THEN s.is_enabled ELSE false END);
    v_push_enabled := private.aka_agent_notification_flag(v_p #> '{channels,push,enabled}', CASE WHEN v_found THEN s.push_enabled ELSE false END);
    IF v_p #> '{channels,email,recipients}' IS NULL THEN
      v_recipients := v_old_recipients;
    ELSE
      IF jsonb_typeof(v_p #> '{channels,email,recipients}') <> 'array' OR jsonb_array_length(v_p #> '{channels,email,recipients}') > 5
         OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_p #> '{channels,email,recipients}') e
                     WHERE jsonb_typeof(e) <> 'string' OR char_length(btrim(e #>> '{}')) > 254
                        OR lower(btrim(e #>> '{}')) !~ '^[a-z0-9._%+''-]+@[a-z0-9.-]+\.[a-z]{2,}$') THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'notification_invalid_email';
      END IF;
      SELECT coalesce(array_agg(e ORDER BY o), '{}'::text[]) INTO v_recipients
        FROM (SELECT lower(btrim(x #>> '{}')) AS e, min(o) AS o
                FROM jsonb_array_elements(v_p #> '{channels,email,recipients}') WITH ORDINALITY AS t(x, o) GROUP BY 1) y;
    END IF;
    IF v_email_enabled AND cardinality(v_recipients) = 0 THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'notification_email_required';
    END IF;
    v_verified := ARRAY(SELECT e FROM unnest(CASE WHEN v_found THEN s.verified_emails ELSE '{}'::text[] END) AS e WHERE e = ANY (v_recipients));
    -- Chiến dịch
    v_c := coalesce(v_p #> '{subscriptions,campaignStatus}', private.aka_agent_notification_subscription_json(p_staff_id, 'campaign.status_changed'));
    v_c_enabled := private.aka_agent_notification_flag(v_c -> 'enabled', false);
    v_c_email := private.aka_agent_notification_flag(v_c -> 'email', false);
    v_c_push := private.aka_agent_notification_flag(v_c -> 'push', false);
    v_c_statuses := private.aka_agent_notification_string_set(v_c -> 'toStatuses', ARRAY['hoàn thành','tạm dừng','đang chạy','chờ xử lý'],
                                                             private.aka_agent_notification_default_filters('campaign.status_changed') -> 'toStatuses');
    IF v_c_enabled AND jsonb_array_length(v_c_statuses) = 0 THEN RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'notification_invalid_filter'; END IF;
    v_c_ids := private.aka_agent_notification_valid_ids(p_staff_id, 'campaign', v_c -> 'campaignIds');
    v_c_cool := private.aka_agent_notification_cooldown(v_c -> 'cooldownMinutes');
    -- Tài khoản
    v_a := coalesce(v_p #> '{subscriptions,accountStatus}', private.aka_agent_notification_subscription_json(p_staff_id, 'account.status_changed'));
    v_a_enabled := private.aka_agent_notification_flag(v_a -> 'enabled', false);
    v_a_email := private.aka_agent_notification_flag(v_a -> 'email', false);
    v_a_push := private.aka_agent_notification_flag(v_a -> 'push', false);
    v_a_login := private.aka_agent_notification_string_set(v_a -> 'loginEvents', ARRAY['logout','checkpoint','login'],
                                                          private.aka_agent_notification_default_filters('account.status_changed') -> 'loginEvents');
    v_a_run := private.aka_agent_notification_string_set(v_a -> 'runStatuses', ARRAY['chờ xử lý','đang chạy','tạm dừng'], '[]'::jsonb);
    IF v_a_enabled AND jsonb_array_length(v_a_login) + jsonb_array_length(v_a_run) = 0 THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'notification_invalid_filter';
    END IF;
    v_a_ids := private.aka_agent_notification_valid_ids(p_staff_id, 'account', v_a -> 'accountIds');
    v_a_cool := private.aka_agent_notification_cooldown(v_a -> 'cooldownMinutes');
    -- Báo cáo
    v_r := coalesce(v_p #> '{subscriptions,scheduledReport}', private.aka_agent_notification_subscription_json(p_staff_id, 'report.scheduled'));
    v_r_enabled := private.aka_agent_notification_flag(v_r -> 'enabled', false);
    v_r_email := private.aka_agent_notification_flag(v_r -> 'email', false);
    v_r_push := private.aka_agent_notification_flag(v_r -> 'push', false);
    v_r_idle := private.aka_agent_notification_flag(v_r -> 'skipWhenIdle', false);
    IF jsonb_typeof(v_r -> 'weekDays') IS DISTINCT FROM 'array' OR jsonb_array_length(v_r -> 'weekDays') NOT BETWEEN 1 AND 7
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_r -> 'weekDays') e WHERE jsonb_typeof(e) <> 'number' OR (e #>> '{}') !~ '^[1-7]$')
       OR jsonb_typeof(v_r -> 'times') IS DISTINCT FROM 'array' OR jsonb_array_length(v_r -> 'times') NOT BETWEEN 1 AND 6
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_r -> 'times') e WHERE jsonb_typeof(e) <> 'string' OR (e #>> '{}') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'notification_invalid_schedule';
    END IF;
    SELECT array_agg(DISTINCT (e #>> '{}')::smallint ORDER BY (e #>> '{}')::smallint) INTO v_r_days FROM jsonb_array_elements(v_r -> 'weekDays') e;
    SELECT array_agg(DISTINCT (e #>> '{}')::time ORDER BY (e #>> '{}')::time) INTO v_r_times FROM jsonb_array_elements(v_r -> 'times') e;
    IF cardinality(v_r_times) <> jsonb_array_length(v_r -> 'times') THEN RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'notification_invalid_schedule'; END IF;
    -- Nhóm data
    v_g := coalesce(v_p #> '{subscriptions,dataGroupMembership}', private.aka_agent_notification_subscription_json(p_staff_id, 'data_group.membership_changed'));
    v_g_enabled := private.aka_agent_notification_flag(v_g -> 'enabled', false);
    v_g_email := private.aka_agent_notification_flag(v_g -> 'email', false);
    v_g_push := private.aka_agent_notification_flag(v_g -> 'push', false);
    v_g_shared := private.aka_agent_notification_flag(v_g -> 'includeSharedGroups', false);
    v_g_actions := private.aka_agent_notification_string_set(v_g -> 'actions', ARRAY['added','removed'], '["added","removed"]'::jsonb);
    IF v_g_enabled AND jsonb_array_length(v_g_actions) = 0 THEN RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'notification_invalid_filter'; END IF;
    IF v_g -> 'bucketMinutes' IS NULL THEN v_g_bucket := 5;
    ELSIF (v_g ->> 'bucketMinutes') IN ('5', '15', '30', '60') AND jsonb_typeof(v_g -> 'bucketMinutes') = 'number' THEN v_g_bucket := (v_g ->> 'bucketMinutes')::integer;
    ELSE RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'notification_invalid_filter'; END IF;
    v_g_ids := private.aka_agent_notification_valid_ids(p_staff_id, 'group', v_g -> 'groupIds');
    -- Chào ngày mới (V621): chỉ khi client gửi khoá này; client cũ không gửi thì dòng đăng ký giữ nguyên.
    v_m := v_p #> '{subscriptions,morningReport}';
    IF v_m IS NOT NULL THEN
      IF jsonb_typeof(v_m) <> 'object' OR coalesce(v_m ->> 'time', '07:00') NOT IN ('06:00', '06:30', '07:00', '07:30', '08:00') THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'notification_invalid_schedule';
      END IF;
      v_m_time := coalesce(v_m ->> 'time', '07:00')::time;
    END IF;

    PERFORM set_config('aka.notification_center_write', 'on', true);
    INSERT INTO public.auto_email_notification_settings AS es (staff_id, organization_id, is_enabled, recipient_emails, notify_campaign_completed,
           daily_report_enabled, daily_report_time, is_delete, push_enabled, revision, settings_version, timezone, verified_emails, updated_by_client, updated_at)
    VALUES (p_staff_id, p_organization_id, v_email_enabled, v_recipients,
            v_c_enabled AND v_c_email AND v_c_statuses ? 'hoàn thành', v_r_enabled AND v_r_email, v_r_times[1], false,
            v_push_enabled, 1, 2, v_tz, v_verified, p_client, v_now)
    ON CONFLICT (staff_id) DO UPDATE
       SET organization_id = EXCLUDED.organization_id, is_enabled = EXCLUDED.is_enabled, recipient_emails = EXCLUDED.recipient_emails,
           notify_campaign_completed = EXCLUDED.notify_campaign_completed, daily_report_enabled = EXCLUDED.daily_report_enabled,
           daily_report_time = EXCLUDED.daily_report_time, is_delete = false, push_enabled = EXCLUDED.push_enabled,
           revision = es.revision + 1, settings_version = 2, verified_emails = EXCLUDED.verified_emails,
           updated_by_client = EXCLUDED.updated_by_client, updated_at = EXCLUDED.updated_at;
    PERFORM private.aka_agent_notification_save_subscription(p_staff_id, p_organization_id, 'campaign.status_changed', v_c_enabled, v_c_email, v_c_push,
      jsonb_build_object('toStatuses', v_c_statuses, 'campaignIds', v_c_ids), v_c_cool, NULL, NULL, v_tz);
    PERFORM private.aka_agent_notification_save_subscription(p_staff_id, p_organization_id, 'account.status_changed', v_a_enabled, v_a_email, v_a_push,
      jsonb_build_object('loginEvents', v_a_login, 'runStatuses', v_a_run, 'accountIds', v_a_ids), v_a_cool, NULL, NULL, v_tz);
    PERFORM private.aka_agent_notification_save_subscription(p_staff_id, p_organization_id, 'report.scheduled', v_r_enabled, v_r_email, v_r_push,
      jsonb_build_object('skipWhenIdle', v_r_idle, 'maxCampaigns', 50), NULL, v_r_days, v_r_times, v_tz);
    PERFORM private.aka_agent_notification_save_subscription(p_staff_id, p_organization_id, 'data_group.membership_changed', v_g_enabled, v_g_email, v_g_push,
      jsonb_build_object('groupIds', v_g_ids, 'actions', v_g_actions, 'bucketMinutes', v_g_bucket, 'includeSharedGroups', v_g_shared), NULL, NULL, NULL, v_tz);
    IF v_m IS NOT NULL THEN
      PERFORM private.aka_agent_notification_save_subscription(p_staff_id, p_organization_id, 'report.morning',
        private.aka_agent_notification_flag(v_m -> 'enabled', false), private.aka_agent_notification_flag(v_m -> 'email', false),
        private.aka_agent_notification_flag(v_m -> 'push', false),
        jsonb_build_object('skipWhenIdle', private.aka_agent_notification_flag(v_m -> 'skipWhenIdle', true)), NULL,
        ARRAY[1, 2, 3, 4, 5, 6, 7]::smallint[], ARRAY[v_m_time], v_tz);
    END IF;
    PERFORM set_config('aka.notification_center_write', '', true);
    IF v_email_enabled THEN
      FOREACH v_email IN ARRAY v_recipients LOOP
        IF NOT (v_email = ANY (v_verified)) AND NOT (v_email = ANY (v_old_recipients)) THEN
          PERFORM private.aka_agent_notification_request_verification(p_staff_id, p_organization_id, v_email);
        END IF;
      END LOOP;
    END IF;
    RETURN private.aka_agent_notification_settings_json(p_staff_id, p_session_id);

  ELSIF p_action = 'list' THEN
    v_limit := least(greatest(coalesce((v_p ->> 'limit')::integer, 20), 1), 50);
    v_cursor_at := (v_p #>> '{cursor,createdAt}')::timestamptz;
    v_cursor_id := (v_p #>> '{cursor,id}')::bigint;
    v_type := nullif(v_p ->> 'type', '');
    IF v_type IS NOT NULL AND v_type NOT IN ('campaign.status_changed','account.status_changed','report.scheduled','report.morning','data_group.membership_changed','system.test') THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'notification_invalid_filter';
    END IF;
    v_unread := coalesce((v_p ->> 'unreadOnly')::boolean, false);
    SELECT coalesce(jsonb_agg(item ORDER BY created_at DESC, id DESC), '[]'::jsonb), count(*) INTO v_items, v_count
      FROM (SELECT n.id, n.created_at,
                   jsonb_build_object('id', n.id, 'eventType', n.event_type, 'severity', n.severity, 'title', n.app_title, 'body', n.app_body,
                     'occurredAt', n.occurred_at, 'createdAt', n.created_at, 'readAt', n.read_at, 'emailState', n.email_state, 'pushState', n.push_state,
                     'campaignId', n.campaign_id, 'accountId', n.account_id, 'dataGroupId', n.data_group_id, 'entityKey', n.entity_key) AS item
              FROM public.auto_notifications n
             WHERE n.staff_id = p_staff_id AND n.content_status = 'ready' AND n.event_type <> 'system.verify_email'
               AND (v_type IS NULL OR n.event_type = v_type)
               AND (NOT v_unread OR n.read_at IS NULL)
               AND (v_cursor_at IS NULL OR (n.created_at, n.id) < (v_cursor_at, coalesce(v_cursor_id, 9223372036854775807)))
             ORDER BY n.created_at DESC, n.id DESC
             LIMIT v_limit + 1) x;
    IF v_count > v_limit THEN
      v_items := (SELECT jsonb_agg(e ORDER BY o) FROM jsonb_array_elements(v_items) WITH ORDINALITY t(e, o) WHERE o <= v_limit);
    END IF;
    RETURN jsonb_build_object('items', v_items,
      'nextCursor', CASE WHEN v_count > v_limit THEN jsonb_build_object('createdAt', v_items -> (v_limit - 1) ->> 'createdAt', 'id', (v_items -> (v_limit - 1) ->> 'id')::bigint) END,
      'unreadCount', private.aka_agent_notification_unread_count(p_staff_id));

  ELSIF p_action = 'detail' THEN
    v_id := (v_p ->> 'id')::bigint;
    SELECT * INTO v_n FROM public.auto_notifications WHERE id = v_id AND staff_id = p_staff_id AND content_status = 'ready' AND event_type <> 'system.verify_email';
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'notification_not_found'; END IF;
    RETURN jsonb_build_object('id', v_n.id, 'eventType', v_n.event_type, 'severity', v_n.severity, 'title', v_n.app_title, 'body', v_n.app_body,
      'emailSubject', v_n.email_subject, 'occurredAt', v_n.occurred_at, 'createdAt', v_n.created_at, 'readAt', v_n.read_at,
      'campaignId', v_n.campaign_id, 'accountId', v_n.account_id, 'dataGroupId', v_n.data_group_id, 'entityKey', v_n.entity_key,
      'content', v_n.content_snapshot, 'templateVersion', v_n.template_version, 'emailState', v_n.email_state, 'pushState', v_n.push_state,
      'suppressedCount', coalesce((v_n.payload ->> 'suppressedCount')::integer, 0), 'mergedCount', coalesce((v_n.payload ->> 'mergedCount')::integer, 0),
      'deliveries', (SELECT coalesce(jsonb_agg(jsonb_build_object('channel', d.channel, 'status', d.status, 'sentAt', d.sent_at, 'attempts', d.attempt_count,
                       'errorCode', d.last_error_code,
                       'destination', CASE WHEN d.channel = 'email' THEN private.aka_agent_notification_mask_email(d.destination)
                                           ELSE coalesce(dv.device_name, dv.device_model, 'iPhone') END) ORDER BY d.channel, d.id), '[]'::jsonb)
                       FROM public.auto_notification_deliveries d LEFT JOIN public.auto_notification_devices dv ON dv.id = d.device_id
                      WHERE d.notification_id = v_n.id));

  ELSIF p_action = 'mark_read' THEN
    IF v_p ? 'ids' THEN
      IF jsonb_typeof(v_p -> 'ids') <> 'array' OR jsonb_array_length(v_p -> 'ids') NOT BETWEEN 1 AND 200 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'notification_invalid_ids';
      END IF;
      SELECT array_agg((e #>> '{}')::bigint) INTO v_ids FROM jsonb_array_elements(v_p -> 'ids') e;
      UPDATE public.auto_notifications SET read_at = v_now, updated_at = v_now
       WHERE staff_id = p_staff_id AND id = ANY (v_ids) AND read_at IS NULL;
    ELSIF v_p ? 'upToId' THEN
      -- "Đánh dấu đã đọc tất cả" theo đúng thứ tự hộp thư (created_at, id) tới mục mới nhất đã thấy; tùy chọn chỉ một loại.
      v_type := nullif(v_p ->> 'type', '');
      IF v_type IS NOT NULL AND v_type NOT IN ('campaign.status_changed','account.status_changed','report.scheduled','report.morning','data_group.membership_changed','system.test') THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'notification_invalid_filter';
      END IF;
      SELECT n.created_at, n.id INTO v_cursor_at, v_cursor_id FROM public.auto_notifications n
       WHERE n.id = (v_p ->> 'upToId')::bigint AND n.staff_id = p_staff_id AND n.content_status = 'ready';
      IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'notification_not_found'; END IF;
      UPDATE public.auto_notifications SET read_at = v_now, updated_at = v_now
       WHERE staff_id = p_staff_id AND read_at IS NULL AND content_status = 'ready'
         AND (v_type IS NULL OR event_type = v_type) AND (created_at, id) <= (v_cursor_at, v_cursor_id);
    ELSE
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'notification_invalid_ids';
    END IF;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RETURN jsonb_build_object('ok', true, 'updated', v_rows, 'unreadCount', private.aka_agent_notification_unread_count(p_staff_id));

  ELSIF p_action = 'unread_count' THEN
    RETURN jsonb_build_object('unreadCount', private.aka_agent_notification_unread_count(p_staff_id));

  ELSIF p_action = 'register_device' THEN
    IF p_client <> 'ios' OR p_session_id IS NULL THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'notification_action_not_allowed'; END IF;
    SELECT * INTO v_session FROM public.auto_control_sessions
     WHERE id = p_session_id AND staff_id = p_staff_id AND client_type = 'native' AND revoked_at IS NULL AND expires_at > v_now;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'notification_session_invalid'; END IF;
    BEGIN v_installation := (v_p ->> 'installationId')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'notification_invalid_device'; END;
    v_token := lower(nullif(btrim(v_p ->> 'pushToken'), ''));
    v_explicit := private.aka_agent_notification_flag(v_p -> 'explicit', false);
    v_bundle := v_p ->> 'bundleId';
    v_env := coalesce(v_p ->> 'apnsEnvironment', 'production');
    IF v_installation IS NULL OR v_bundle IS NULL OR v_bundle NOT IN ('net.akabiz.agent', 'net.akabiz.agent.dev')
       OR v_env NOT IN ('sandbox', 'production') OR (v_token IS NOT NULL AND v_token !~ '^[0-9a-f]{32,200}$')
       OR coalesce(v_p ->> 'permissionStatus', 'granted') NOT IN ('granted', 'denied', 'undetermined', 'provisional') THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'notification_invalid_device';
    END IF;
    IF v_token IS NOT NULL THEN
      UPDATE public.auto_notification_devices SET is_active = false, deactivated_reason = 'staff_changed', updated_at = v_now
       WHERE push_token = v_token AND is_active AND installation_id <> v_installation;
    END IF;
    INSERT INTO public.auto_notification_devices AS dv (staff_id, organization_id, control_session_id, installation_id, platform, device_name,
           device_model, os_version, app_version, bundle_id, push_token, apns_environment, permission_status, is_enabled, is_active,
           last_registered_at, updated_at)
    VALUES (p_staff_id, p_organization_id, p_session_id, v_installation, 'ios', left(v_p ->> 'deviceName', 120), left(v_p ->> 'deviceModel', 120),
            left(v_p ->> 'osVersion', 40), left(v_p ->> 'appVersion', 40), v_bundle, v_token, v_env, v_p ->> 'permissionStatus',
            true, true, v_now, v_now)
    ON CONFLICT (installation_id) DO UPDATE
       SET staff_id = EXCLUDED.staff_id, organization_id = EXCLUDED.organization_id, control_session_id = EXCLUDED.control_session_id,
           device_name = EXCLUDED.device_name, device_model = EXCLUDED.device_model, os_version = EXCLUDED.os_version,
           app_version = EXCLUDED.app_version, bundle_id = EXCLUDED.bundle_id, push_token = EXCLUDED.push_token,
           apns_environment = EXCLUDED.apns_environment, permission_status = EXCLUDED.permission_status,
           is_enabled = CASE WHEN dv.staff_id = EXCLUDED.staff_id THEN dv.is_enabled ELSE true END,
           -- Máy bị gỡ từ nơi khác chỉ bật lại khi người dùng tự bật trên chính máy đó (explicit); lần làm mới tự động thì giữ nguyên.
           is_active = NOT (dv.deactivated_reason = 'user_removed' AND dv.staff_id = EXCLUDED.staff_id AND NOT v_explicit),
           deactivated_reason = CASE WHEN dv.deactivated_reason = 'user_removed' AND dv.staff_id = EXCLUDED.staff_id AND NOT v_explicit
                                     THEN 'user_removed' END,
           failure_count = 0, last_registered_at = EXCLUDED.last_registered_at,
           updated_at = EXCLUDED.updated_at
    RETURNING dv.id, dv.is_active INTO v_id, v_active;
    RETURN jsonb_build_object('ok', true, 'deviceId', v_id, 'active', v_active);

  ELSIF p_action = 'unregister_device' THEN
    IF coalesce((v_p ->> 'current')::boolean, false) THEN
      IF p_client = 'desktop' OR p_session_id IS NULL THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'notification_action_not_allowed'; END IF;
      UPDATE public.auto_notification_devices SET is_active = false, deactivated_reason = 'logout', updated_at = v_now
       WHERE staff_id = p_staff_id AND control_session_id = p_session_id AND is_active;
    ELSE
      UPDATE public.auto_notification_devices SET is_active = false, deactivated_reason = 'user_removed', updated_at = v_now
       WHERE staff_id = p_staff_id AND id = (v_p ->> 'deviceId')::bigint AND is_active;
    END IF;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RETURN jsonb_build_object('ok', true, 'updated', v_rows);

  ELSIF p_action = 'set_device_enabled' THEN
    UPDATE public.auto_notification_devices SET is_enabled = private.aka_agent_notification_flag(v_p -> 'enabled', true), updated_at = v_now
     WHERE staff_id = p_staff_id AND id = (v_p ->> 'deviceId')::bigint AND is_active;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows = 0 THEN RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'notification_device_not_found'; END IF;
    RETURN jsonb_build_object('ok', true);

  ELSIF p_action = 'test' THEN
    IF NOT private.aka_agent_notification_enabled() THEN RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'notification_center_disabled'; END IF;
    IF coalesce(v_p ->> 'channel', '') NOT IN ('email', 'push') THEN RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'notification_invalid_channel'; END IF;
    IF (SELECT count(*) FROM public.auto_notifications WHERE staff_id = p_staff_id AND event_type = 'system.test' AND created_at > v_now - interval '10 minutes') >= 3 THEN
      RAISE EXCEPTION USING ERRCODE = '54000', MESSAGE = 'notification_test_rate_limited';
    END IF;
    INSERT INTO public.auto_notifications (organization_id, staff_id, event_type, severity, entity_key, occurred_at, deliver_after, dedupe_key, payload)
    VALUES (p_organization_id, p_staff_id, 'system.test', 'info', 'test:' || (v_p ->> 'channel'), v_now, v_now,
            format('ts:%s:%s', p_staff_id, gen_random_uuid()), jsonb_build_object('channel', v_p ->> 'channel', 'client', p_client))
    RETURNING id INTO v_id;
    RETURN jsonb_build_object('ok', true, 'id', v_id, 'deliveryMode', private.aka_agent_notification_setting('notifications.delivery_mode', 'dry_run'));

  ELSIF p_action = 'resend_verification' THEN
    SELECT * INTO s FROM public.auto_email_notification_settings WHERE staff_id = p_staff_id AND is_delete IS NOT TRUE;
    v_email := lower(btrim(v_p ->> 'email'));
    IF NOT FOUND OR v_email IS NULL OR NOT (v_email = ANY (s.recipient_emails)) OR v_email = ANY (s.verified_emails) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'notification_invalid_email';
    END IF;
    RETURN jsonb_build_object('ok', true, 'requested', private.aka_agent_notification_request_verification(p_staff_id, p_organization_id, v_email));

  ELSIF p_action = 'verify_email' THEN
    IF p_client = 'desktop' THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'notification_action_not_allowed'; END IF;
    v_email := lower(btrim(v_p ->> 'email'));
    PERFORM set_config('aka.notification_center_write', 'on', true);
    UPDATE public.auto_email_notification_settings
       SET verified_emails = verified_emails || v_email, updated_at = v_now
     WHERE staff_id = p_staff_id AND is_delete IS NOT TRUE AND v_email = ANY (recipient_emails) AND NOT (v_email = ANY (verified_emails));
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    PERFORM set_config('aka.notification_center_write', '', true);
    RETURN jsonb_build_object('ok', true, 'verified', v_rows > 0 OR EXISTS (
      SELECT 1 FROM public.auto_email_notification_settings WHERE staff_id = p_staff_id AND v_email = ANY (verified_emails)));

  ELSIF p_action = 'unsubscribe' THEN
    IF p_client = 'desktop' THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'notification_action_not_allowed'; END IF;
    v_type := v_p ->> 'eventType';
    IF v_type NOT IN ('campaign.status_changed','account.status_changed','report.scheduled','report.morning','data_group.membership_changed') THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'notification_invalid_filter';
    END IF;
    UPDATE public.auto_notification_subscriptions SET email_enabled = false, is_enabled = is_enabled AND push_enabled, updated_at = v_now
     WHERE staff_id = p_staff_id AND event_type = v_type AND scope = 'own';
    PERFORM set_config('aka.notification_center_write', 'on', true);
    UPDATE public.auto_email_notification_settings
       SET notify_campaign_completed = CASE WHEN v_type = 'campaign.status_changed' THEN false ELSE notify_campaign_completed END,
           daily_report_enabled = CASE WHEN v_type = 'report.scheduled' THEN false ELSE daily_report_enabled END,
           revision = revision + 1, updated_by_client = 'system', updated_at = v_now
     WHERE staff_id = p_staff_id;
    PERFORM set_config('aka.notification_center_write', '', true);
    RETURN jsonb_build_object('ok', true);
  END IF;
  RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'notification_invalid_action';
END
$function$
;

CREATE OR REPLACE FUNCTION public.aka_agent_notification_snapshot(p_kind text, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_staff bigint := (v_payload ->> 'staffId')::bigint;
  v_tz text := coalesce(nullif(v_payload ->> 'timezone', ''), 'Asia/Ho_Chi_Minh');
  v_now timestamptz := clock_timestamp();
  v_day_start timestamptz;
  v_id bigint; v_main jsonb; v_inputs jsonb; v_results jsonb; v_first timestamptz; v_at timestamptz;
  v_accounts jsonb; v_logged_out jsonb; v_campaign_counts jsonb; v_campaigns jsonb; v_issues jsonb; v_limit integer;
  v_from timestamptz; v_to timestamptz;
BEGIN
  IF v_staff IS NULL THEN RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'notification_snapshot_staff_required'; END IF;
  v_day_start := date_trunc('day', v_now AT TIME ZONE v_tz) AT TIME ZONE v_tz;

  IF p_kind = 'campaign' THEN
    v_id := (v_payload ->> 'campaignId')::bigint;
    SELECT jsonb_build_object('id', c.id, 'name', c.name, 'status', c.status, 'note', c.note, 'actionId', c.action_id, 'actionName', a.name,
             'accountId', c.account_id, 'accountName', acc.name, 'platform', acc.flatform_type, 'completedAt', c.completed_at,
             'createdAt', c.created_at, 'lastRunAt', c.last_run_at, 'scheduleEndDate', c.schedule_end_date, 'isDeleted', coalesce(c.is_delete, false))
      INTO v_main
      FROM public.auto_campaigns c
      LEFT JOIN public.auto_campaign_actions a ON a.id = c.action_id
      LEFT JOIN public.auto_accounts acc ON acc.id = c.account_id
     WHERE c.id = v_id AND c.staff_id = v_staff;
    IF v_main IS NULL THEN RETURN jsonb_build_object('found', false); END IF;
    SELECT coalesce(jsonb_object_agg(status, n), '{}'::jsonb) INTO v_inputs
      FROM (SELECT status, count(*) AS n FROM public.auto_campaign_input_data WHERE campaign_id = v_id AND is_delete = false GROUP BY status) x;
    -- Đếm theo (action_code, status) chỉ đọc index idx_auto_campaign_details_automation_status (không đọc heap: chiến dịch
    -- 60 nghìn dòng 36,8s → <1s); tên hành động và nhóm kết quả lấy từ 1 dòng gần nhất của mỗi nhóm.
    WITH g AS (
      SELECT d.action_code, d.status, count(*) AS total, count(*) FILTER (WHERE d.created_at >= v_day_start) AS today
        FROM public.auto_campaign_details d
       WHERE d.campaign_id = v_id AND d.is_delete = false
       GROUP BY d.action_code, d.status
    ), labeled AS (
      SELECT coalesce(nullif(coalesce(rc.action_name, rn.action_name), ''), g.action_code, 'Hành động') AS action,
             private.aka_agent_notification_result_group(coalesce(rc.report_group, rn.report_group), g.status) AS grp, g.total, g.today
        FROM g
        LEFT JOIN LATERAL (SELECT d.action_name, d.report_group FROM public.auto_campaign_details d
                            WHERE d.campaign_id = v_id AND d.is_delete = false AND d.status = g.status AND d.action_code = g.action_code
                            ORDER BY d.created_at DESC LIMIT 1) rc ON g.action_code IS NOT NULL
        LEFT JOIN LATERAL (SELECT d.action_name, d.report_group FROM public.auto_campaign_details d
                            WHERE d.campaign_id = v_id AND d.is_delete = false AND d.status = g.status AND d.action_code IS NULL
                            ORDER BY d.created_at DESC LIMIT 1) rn ON g.action_code IS NULL
    )
    SELECT coalesce(jsonb_agg(jsonb_build_object('action', action, 'group', grp, 'total', total, 'today', today) ORDER BY action, grp), '[]'::jsonb)
      INTO v_results
      FROM (SELECT action, grp, sum(total)::bigint AS total, sum(today)::bigint AS today FROM labeled GROUP BY 1, 2) r;
    SELECT min(d.created_at) INTO v_first FROM public.auto_campaign_details d WHERE d.campaign_id = v_id AND d.is_delete = false;
    RETURN jsonb_build_object('found', true, 'campaign', v_main, 'inputs', v_inputs, 'results', v_results,
                              'startedAt', coalesce(v_first, (v_main ->> 'createdAt')::timestamptz), 'countedAt', v_now, 'dayStart', v_day_start);

  ELSIF p_kind = 'account' THEN
    v_id := (v_payload ->> 'accountId')::bigint;
    v_at := coalesce((v_payload ->> 'occurredAt')::timestamptz, v_now);
    SELECT jsonb_build_object('id', a.id, 'name', a.name, 'platform', a.flatform_type, 'loginStatus', a.login_status, 'status', a.status,
             'isZaloServer', coalesce(a.is_zalo_server, false), 'isZaloWeb', coalesce(a.is_zalo_show_web, false), 'proxyName', p.name,
             'device', CASE WHEN a.flatform_type = 'sms' AND a.mobile_device_info IS NOT NULL THEN jsonb_build_object(
                         'app', a.mobile_device_info -> 'app', 'osVersion', a.mobile_device_info -> 'osVersion',
                         'platform', a.mobile_device_info -> 'platform', 'lastSeenAt', a.mobile_device_last_seen_at) END,
             'chatSession', (SELECT jsonb_build_object('lastError', left(o.session_last_error, 300), 'closeReason', left(o.socket_last_close_reason, 300),
                               'closeCode', o.socket_last_close_code, 'lastDisconnectedAt', o.last_socket_disconnected_at, 'updatedAt', o.updated_at)
                               FROM public.chat_zalo_account_organization o WHERE o.auto_account_id = a.id ORDER BY o.updated_at DESC LIMIT 1),
             'lastLog', (SELECT jsonb_build_object('at', l.created_at, 'event', l.event_type, 'message', left(l.message, 300), 'source', l.source)
                           FROM public.auto_account_logs l
                          WHERE l.account_id = a.id AND l.created_at BETWEEN v_at - interval '2 minutes' AND v_at + interval '2 minutes'
                          ORDER BY l.created_at DESC LIMIT 1),
             'loginLog', (SELECT jsonb_build_object('at', l.created_at, 'event', l.event_type, 'loginStatus', l.login_status,
                                   'reason', left(l.details ->> 'reason', 300), 'source', l.source)
                            FROM public.auto_account_logs l
                           WHERE l.account_id = a.id AND l.event_type IN ('logout', 'login', 'login_status_changed')
                             AND l.created_at BETWEEN v_at - interval '2 minutes' AND v_at + interval '2 minutes'
                           ORDER BY abs(extract(epoch FROM l.created_at - v_at)), l.created_at DESC LIMIT 1),
             'warnLog', (SELECT jsonb_build_object('at', l.created_at, 'event', l.event_type, 'message', left(l.message, 300), 'source', l.source)
                           FROM public.auto_account_logs l
                          WHERE l.account_id = a.id AND l.event_type IN ('zalo_warning', 'runtime_error')
                            AND l.created_at BETWEEN v_at - interval '2 minutes' AND v_at + interval '1 minute'
                          ORDER BY l.created_at DESC LIMIT 1),
             'desktopDevice', CASE WHEN a.flatform_type = 'zalo' AND NOT coalesce(a.is_zalo_server, false) THEN (
                         SELECT CASE WHEN count(*) = 1 THEN min(dp.device_label || coalesce(' · v' || dp.app_version, '')) END
                           FROM public.auto_staff_device_presence dp
                          WHERE dp.staff_id = a.staff_id AND dp.ended_at IS NULL AND dp.last_seen_at > v_now - interval '5 minutes') END,
             'activeCampaigns', (SELECT count(*) FROM public.auto_campaigns c
                                  WHERE c.account_id = a.id AND c.is_delete IS NOT TRUE AND c.status IN ('đang chạy', 'chờ xử lý')))
      INTO v_main
      FROM public.auto_accounts a LEFT JOIN public.auto_proxies p ON p.id = a.proxy_id
     WHERE a.id = v_id AND a.staff_id = v_staff;
    IF v_main IS NULL THEN RETURN jsonb_build_object('found', false); END IF;
    RETURN jsonb_build_object('found', true, 'account', v_main, 'countedAt', v_now);

  ELSIF p_kind = 'report' THEN
    v_limit := least(greatest(coalesce((v_payload ->> 'maxCampaigns')::integer, 50), 1), 100);
    -- SMS: login_status luôn 'chưa đăng nhập'; kết nối thật là máy đã gắn (mobile_device_id). Tài khoản SMS chưa gắn máy
    -- và không có chiến dịch đang chạy/chờ là chưa dùng (mỗi nhân viên có 1 tài khoản SMS mặc định): không tính.
    SELECT jsonb_build_object('total', count(*),
             'loggedIn', count(*) FILTER (WHERE x.eff = 'đã đăng nhập'),
             'loggedOut', count(*) FILTER (WHERE x.eff = 'chưa đăng nhập'),
             'checkpoint', count(*) FILTER (WHERE x.eff = 'checkpoint'),
             'running', count(*) FILTER (WHERE x.status = 'đang chạy'),
             'pending', count(*) FILTER (WHERE x.status = 'chờ xử lý'),
             'paused', count(*) FILTER (WHERE x.status = 'tạm dừng'))
      INTO v_accounts
      FROM (SELECT a.status, CASE WHEN a.flatform_type = 'sms'
                                  THEN CASE WHEN a.mobile_device_id IS NOT NULL THEN 'đã đăng nhập' ELSE 'chưa đăng nhập' END
                                  ELSE a.login_status END AS eff
              FROM public.auto_accounts a
             WHERE a.staff_id = v_staff AND a.is_delete IS NOT TRUE
               AND (a.flatform_type IS DISTINCT FROM 'sms' OR a.mobile_device_id IS NOT NULL
                    OR EXISTS (SELECT 1 FROM public.auto_campaigns c WHERE c.account_id = a.id AND c.is_delete IS NOT TRUE
                                 AND c.status IN ('đang chạy', 'chờ xử lý')))) x;
    SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'platform', flatform_type, 'loginStatus', eff, 'since', updated_at)
                              ORDER BY updated_at DESC), '[]'::jsonb)
      INTO v_logged_out
      FROM (SELECT a.id, a.name, a.flatform_type, a.updated_at,
                   CASE WHEN a.flatform_type = 'sms' THEN 'chưa đăng nhập' ELSE a.login_status END AS eff
              FROM public.auto_accounts a
             WHERE a.staff_id = v_staff AND a.is_delete IS NOT TRUE
               AND CASE WHEN a.flatform_type = 'sms'
                        THEN a.mobile_device_id IS NULL
                             AND EXISTS (SELECT 1 FROM public.auto_campaigns c WHERE c.account_id = a.id AND c.is_delete IS NOT TRUE
                                           AND c.status IN ('đang chạy', 'chờ xử lý'))
                        ELSE a.login_status IN ('chưa đăng nhập', 'checkpoint') END
             ORDER BY a.updated_at DESC LIMIT 20) x;
    SELECT jsonb_build_object('byStatus', coalesce(jsonb_object_agg(status, n), '{}'::jsonb),
             'completedToday', (SELECT count(*) FROM public.auto_campaigns
                                 WHERE staff_id = v_staff AND is_delete IS NOT TRUE AND status = 'hoàn thành' AND completed_at >= v_day_start))
      INTO v_campaign_counts
      FROM (SELECT status, count(*) AS n FROM public.auto_campaigns WHERE staff_id = v_staff AND is_delete IS NOT TRUE GROUP BY status) x;
    WITH picked AS (
      SELECT c.id, c.name, c.status, c.note, c.action_id, c.account_id, c.completed_at, c.last_run_at,
             row_number() OVER (ORDER BY (c.last_run_at >= v_day_start) DESC NULLS LAST,
                                (c.status IN ('tạm dừng', 'chờ xử lý') AND coalesce(c.note, '') <> '') DESC,
                                CASE c.status WHEN 'đang chạy' THEN 1 WHEN 'chờ xử lý' THEN 2 WHEN 'tạm dừng' THEN 3 ELSE 4 END,
                                c.last_run_at DESC NULLS LAST, c.id DESC) AS rn
        FROM public.auto_campaigns c
       WHERE c.staff_id = v_staff AND c.is_delete IS NOT TRUE
         AND (c.status <> 'hoàn thành' OR c.completed_at >= v_day_start)
       ORDER BY (c.last_run_at >= v_day_start) DESC NULLS LAST,
                (c.status IN ('tạm dừng', 'chờ xử lý') AND coalesce(c.note, '') <> '') DESC,
                CASE c.status WHEN 'đang chạy' THEN 1 WHEN 'chờ xử lý' THEN 2 WHEN 'tạm dừng' THEN 3 ELSE 4 END,
                c.last_run_at DESC NULLS LAST, c.id DESC
       LIMIT v_limit
    )
    SELECT coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'status', p.status, 'note', p.note, 'actionName', a.name,
             'accountName', acc.name, 'completedAt', p.completed_at, 'lastRunAt', p.last_run_at,
             'pendingInputs', (SELECT count(*) FROM public.auto_campaign_input_data i WHERE i.campaign_id = p.id AND i.is_delete = false AND i.status = 'chờ xử lý'),
             'today', (SELECT coalesce(jsonb_object_agg(grp, n), '{}'::jsonb) FROM (
                         SELECT private.aka_agent_notification_result_group(d.report_group, d.status) AS grp, count(*) AS n
                           FROM public.auto_campaign_details d
                          WHERE d.campaign_id = p.id AND d.is_delete = false AND d.created_at >= v_day_start
                          GROUP BY 1) t)
           ) ORDER BY p.rn), '[]'::jsonb)
      INTO v_campaigns
      FROM picked p
      LEFT JOIN public.auto_campaign_actions a ON a.id = p.action_id
      LEFT JOIN public.auto_accounts acc ON acc.id = p.account_id;
    WITH issues AS (
      SELECT 'critical' AS severity, 'account_logged_out_with_campaigns' AS code, a.name AS subject,
             CASE WHEN a.flatform_type = 'sms' THEN 'Chưa gắn máy SMS'
                  ELSE 'Tài khoản ' || CASE a.login_status WHEN 'checkpoint' THEN 'bị checkpoint' ELSE 'đã đăng xuất' END END
               || ' trong khi còn ' || count(c.id) || ' chiến dịch đang chạy hoặc chờ xử lý' AS message, 1 AS rank
        FROM public.auto_accounts a JOIN public.auto_campaigns c ON c.account_id = a.id
       WHERE a.staff_id = v_staff AND a.is_delete IS NOT TRUE
         AND CASE WHEN a.flatform_type = 'sms' THEN a.mobile_device_id IS NULL ELSE a.login_status IN ('chưa đăng nhập', 'checkpoint') END
         AND c.is_delete IS NOT TRUE AND c.status IN ('đang chạy', 'chờ xử lý')
       GROUP BY a.id, a.name, a.login_status, a.flatform_type
      UNION ALL
      SELECT CASE WHEN c.note ILIKE '%đăng xuất%' OR c.note ILIKE '%checkpoint%' THEN 'critical' ELSE 'warning' END,
             'campaign_stopped_with_reason', c.name, left(c.note, 300), 2
        FROM public.auto_campaigns c
       WHERE c.staff_id = v_staff AND c.is_delete IS NOT TRUE AND c.status IN ('tạm dừng', 'chờ xử lý') AND coalesce(c.note, '') <> ''
      UNION ALL
      SELECT 'warning', 'high_failure_rate_today', p ->> 'name',
             'Tỷ lệ thất bại hôm nay ' || round(100.0 * (p -> 'today' ->> 'failure')::numeric
               / nullif(coalesce((p -> 'today' ->> 'failure')::numeric, 0) + coalesce((p -> 'today' ->> 'success')::numeric, 0)
                        + coalesce((p -> 'today' ->> 'skipped')::numeric, 0), 0)) || '%', 3
        FROM jsonb_array_elements(v_campaigns) p
       WHERE coalesce((p -> 'today' ->> 'failure')::numeric, 0) + coalesce((p -> 'today' ->> 'success')::numeric, 0)
             + coalesce((p -> 'today' ->> 'skipped')::numeric, 0) >= 20
         AND coalesce((p -> 'today' ->> 'failure')::numeric, 0) * 100 >= 30 * (coalesce((p -> 'today' ->> 'failure')::numeric, 0)
             + coalesce((p -> 'today' ->> 'success')::numeric, 0) + coalesce((p -> 'today' ->> 'skipped')::numeric, 0))
      UNION ALL
      SELECT 'info', 'staff_expiring', st.name, 'Tài khoản nhân viên hết hạn ngày ' || to_char(st.expiration_date AT TIME ZONE v_tz, 'DD/MM/YYYY'), 4
        FROM public.org_staff st
       WHERE st.id = v_staff AND st.expiration_date IS NOT NULL AND st.expiration_date BETWEEN v_now AND v_now + interval '7 days'
      UNION ALL
      SELECT 'info', 'package_expiring', op.product_name, 'Gói ' || coalesce(op.product_name, '') || ' hết hạn ngày '
               || to_char(op.expiration_date AT TIME ZONE v_tz, 'DD/MM/YYYY'), 4
        FROM public.org_staff st JOIN public.org_organization_product op ON op.organization_id = st.organization_id
       WHERE st.id = v_staff AND op.is_deleted IS NOT TRUE AND op.expiration_date BETWEEN v_now AND v_now + interval '7 days'
    )
    SELECT coalesce(jsonb_agg(jsonb_build_object('severity', severity, 'code', code, 'subject', subject, 'message', message)
                              ORDER BY rank, severity), '[]'::jsonb)
      INTO v_issues
      FROM (SELECT * FROM issues ORDER BY CASE severity WHEN 'critical' THEN 1 WHEN 'warning' THEN 2 ELSE 3 END, rank LIMIT 20) i;
    RETURN jsonb_build_object('found', true, 'accounts', v_accounts, 'loggedOutAccounts', v_logged_out, 'campaignCounts', v_campaign_counts,
                              'campaigns', v_campaigns, 'issues', v_issues, 'countedAt', v_now, 'dayStart', v_day_start, 'timezone', v_tz,
                              'completedToday', private.aka_agent_notification_completed_today(v_staff, v_day_start));

  -- V621: phần đọc thêm của báo cáo / Chào ngày mới / chiến dịch hoàn thành (API gọi riêng, lỗi thì bỏ đúng mục đó).
  ELSIF p_kind = 'account_actions' THEN
    RETURN private.aka_agent_notification_account_actions(v_staff, v_tz, v_payload ->> 'window', v_now);
  ELSIF p_kind = 'morning' THEN
    RETURN private.aka_agent_notification_morning(v_staff, v_tz, v_now);
  ELSIF p_kind = 'failure_reasons' THEN
    RETURN private.aka_agent_notification_failure_reasons(v_staff, (v_payload ->> 'campaignId')::bigint);

  ELSIF p_kind = 'data_group' THEN
    v_id := (v_payload ->> 'groupId')::bigint;
    v_from := coalesce((v_payload ->> 'from')::timestamptz, v_now - interval '5 minutes');
    v_to := coalesce((v_payload ->> 'to')::timestamptz, v_now);
    SELECT jsonb_build_object('id', g.id, 'name', g.name, 'ownerStaffId', g.staff_id) INTO v_main
      FROM public.auto_account_contact_groups g
     WHERE g.id = v_id AND g.is_delete IS NOT TRUE
       AND (g.staff_id = v_staff OR EXISTS (SELECT 1 FROM public.auto_data_group_recipients r WHERE r.group_id = g.id AND r.staff_id = v_staff));
    IF v_main IS NULL THEN RETURN jsonb_build_object('found', false); END IF;
    SELECT jsonb_build_object('added', count(*) FILTER (WHERE action = 'added'), 'removed', count(*) FILTER (WHERE action = 'removed'),
             'totalAfter', (array_agg(group_total_after ORDER BY occurred_at DESC, id DESC))[1],
             'samples', (SELECT coalesce(jsonb_agg(jsonb_build_object('action', s.action, 'label', s.contact_label, 'at', s.occurred_at) ORDER BY s.occurred_at DESC), '[]'::jsonb)
                           FROM (SELECT action, contact_label, occurred_at FROM public.auto_data_group_member_events
                                  WHERE group_id = v_id AND occurred_at >= v_from AND occurred_at < v_to ORDER BY occurred_at DESC LIMIT 20) s),
             'filterSummary', (array_agg(filter_summary ORDER BY occurred_at DESC, id DESC))[1])
      INTO v_results
      FROM public.auto_data_group_member_events WHERE group_id = v_id AND occurred_at >= v_from AND occurred_at < v_to;
    RETURN jsonb_build_object('found', true, 'group', v_main, 'changes', v_results, 'from', v_from, 'to', v_to, 'countedAt', v_now);
  END IF;
  RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'notification_snapshot_invalid_kind';
END
$function$
;

DO $v621_post$
DECLARE r record;
BEGIN
  IF md5(pg_get_functiondef('private.aka_agent_notification_default_filters(text)'::regprocedure)) IS DISTINCT FROM '43937b2446fe28cedd03ae5a3bdca38a' THEN
    RAISE EXCEPTION 'v621: private.aka_agent_notification_default_filters(text) sau khi thay có md5 %, cần 43937b2446fe28cedd03ae5a3bdca38a', md5(pg_get_functiondef('private.aka_agent_notification_default_filters(text)'::regprocedure));
  END IF;
  IF md5(pg_get_functiondef('private.aka_agent_notification_subscription_json(bigint,text)'::regprocedure)) IS DISTINCT FROM 'a8a85761e99528e0f977856d6bd43bf4' THEN
    RAISE EXCEPTION 'v621: private.aka_agent_notification_subscription_json(bigint,text) sau khi thay có md5 %, cần a8a85761e99528e0f977856d6bd43bf4', md5(pg_get_functiondef('private.aka_agent_notification_subscription_json(bigint,text)'::regprocedure));
  END IF;
  IF md5(pg_get_functiondef('private.aka_agent_notification_settings_json(bigint,uuid)'::regprocedure)) IS DISTINCT FROM '9878053033e2fde6a8117390329df9a0' THEN
    RAISE EXCEPTION 'v621: private.aka_agent_notification_settings_json(bigint,uuid) sau khi thay có md5 %, cần 9878053033e2fde6a8117390329df9a0', md5(pg_get_functiondef('private.aka_agent_notification_settings_json(bigint,uuid)'::regprocedure));
  END IF;
  IF md5(pg_get_functiondef('private.aka_agent_notification_save_subscription(bigint,bigint,text,boolean,boolean,boolean,jsonb,integer,smallint[],time without time zone[],text)'::regprocedure)) IS DISTINCT FROM '812c7b4f262128ea397cf9a9b30ed82b' THEN
    RAISE EXCEPTION 'v621: private.aka_agent_notification_save_subscription(bigint,bigint,text,boolean,boolean,boolean,jsonb,integer,smallint[],time without time zone[],text) sau khi thay có md5 %, cần 812c7b4f262128ea397cf9a9b30ed82b', md5(pg_get_functiondef('private.aka_agent_notification_save_subscription(bigint,bigint,text,boolean,boolean,boolean,jsonb,integer,smallint[],time without time zone[],text)'::regprocedure));
  END IF;
  IF md5(pg_get_functiondef('private.aka_agent_notification_schedule_reports(timestamp with time zone)'::regprocedure)) IS DISTINCT FROM 'c72d5b2380e374a7c6061a6b87367269' THEN
    RAISE EXCEPTION 'v621: private.aka_agent_notification_schedule_reports(timestamp with time zone) sau khi thay có md5 %, cần c72d5b2380e374a7c6061a6b87367269', md5(pg_get_functiondef('private.aka_agent_notification_schedule_reports(timestamp with time zone)'::regprocedure));
  END IF;
  IF md5(pg_get_functiondef('private.aka_agent_notification_cleanup(timestamp with time zone)'::regprocedure)) IS DISTINCT FROM '90d9ef7c9664f744aa3c2afbc99f01a0' THEN
    RAISE EXCEPTION 'v621: private.aka_agent_notification_cleanup(timestamp with time zone) sau khi thay có md5 %, cần 90d9ef7c9664f744aa3c2afbc99f01a0', md5(pg_get_functiondef('private.aka_agent_notification_cleanup(timestamp with time zone)'::regprocedure));
  END IF;
  IF md5(pg_get_functiondef('public.aka_agent_notification_tick()'::regprocedure)) IS DISTINCT FROM '45e7d23a5589a11a71d66ff8ed6fc938' THEN
    RAISE EXCEPTION 'v621: public.aka_agent_notification_tick() sau khi thay có md5 %, cần 45e7d23a5589a11a71d66ff8ed6fc938', md5(pg_get_functiondef('public.aka_agent_notification_tick()'::regprocedure));
  END IF;
  IF md5(pg_get_functiondef('private.aka_agent_notification_center(bigint,bigint,text,text,jsonb,uuid)'::regprocedure)) IS DISTINCT FROM '00d45d1c0fcad33d75134f8269fa6565' THEN
    RAISE EXCEPTION 'v621: private.aka_agent_notification_center(bigint,bigint,text,text,jsonb,uuid) sau khi thay có md5 %, cần 00d45d1c0fcad33d75134f8269fa6565', md5(pg_get_functiondef('private.aka_agent_notification_center(bigint,bigint,text,text,jsonb,uuid)'::regprocedure));
  END IF;
  IF md5(pg_get_functiondef('public.aka_agent_notification_snapshot(text,jsonb)'::regprocedure)) IS DISTINCT FROM 'fff0363be7f2e62ee1db7e0e06ca974b' THEN
    RAISE EXCEPTION 'v621: public.aka_agent_notification_snapshot(text,jsonb) sau khi thay có md5 %, cần fff0363be7f2e62ee1db7e0e06ca974b', md5(pg_get_functiondef('public.aka_agent_notification_snapshot(text,jsonb)'::regprocedure));
  END IF;
  FOR r IN SELECT a.sig, a.acl, p.proacl::text AS now_acl FROM pg_temp.v621_acl a JOIN pg_proc p ON p.oid = a.sig::regprocedure LOOP
    IF r.acl IS DISTINCT FROM r.now_acl THEN RAISE EXCEPTION 'v621: quyền của % đổi: % → %', r.sig, r.acl, r.now_acl; END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_proc p, unnest(ARRAY['private.aka_agent_notification_account_actions(bigint,text,text,timestamp with time zone)', 'private.aka_agent_notification_completed_today(bigint,timestamp with time zone)', 'private.aka_agent_notification_failure_reasons(bigint,bigint)', 'private.aka_agent_notification_morning(bigint,text,timestamp with time zone)', 'private.aka_agent_notification_default_email(bigint)', 'private.aka_agent_notification_seed_defaults(timestamp with time zone)']) AS s
              WHERE p.oid = s::regprocedure AND (has_function_privilege('anon', p.oid, 'EXECUTE')
                 OR has_function_privilege('authenticated', p.oid, 'EXECUTE') OR has_function_privilege('aka_agent_desktop', p.oid, 'EXECUTE'))) THEN
    RAISE EXCEPTION 'v621: hàm mới còn quyền EXECUTE cho anon/authenticated/aka_agent_desktop';
  END IF;
END
$v621_post$;

COMMIT;
$v621_src$;
  v_body text;
BEGIN
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name = 'migration_v621_notification_daily_reports') THEN
    RAISE EXCEPTION 'V621 đã chạy rồi, không chạy lại';
  END IF;
  v_src := replace(v_src, E'\r\n', E'\n');
  IF md5(v_src) <> '72f45c390df6d44736f83ab92addd5ab' THEN
    RAISE EXCEPTION 'Nội dung dán bị thiếu hoặc sai (md5 %), chưa chạy gì; chép lại nguyên khối', md5(v_src);
  END IF;
  v_body := substr(v_src, strpos(v_src, E'\nBEGIN;\n') + 8);
  v_body := left(v_body, length(v_body) - length(E'COMMIT;\n'));
  EXECUTE v_body;
  INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
  SELECT to_char(greatest(clock_timestamp() AT TIME ZONE 'UTC',
                          max(to_timestamp(version, 'YYYYMMDDHH24MISS')::timestamp) + interval '1 second'),
                 'YYYYMMDDHH24MISS'), 'migration_v621_notification_daily_reports', ARRAY[v_src]
  FROM supabase_migrations.schema_migrations WHERE version ~ '^[0-9]{14}$';
END
$v621_run$;
COMMIT;
SELECT 'applied' AS status, version, name, md5(statements[1]) = '72f45c390df6d44736f83ab92addd5ab' AS md5_khop_file
FROM supabase_migrations.schema_migrations WHERE name = 'migration_v621_notification_daily_reports';
