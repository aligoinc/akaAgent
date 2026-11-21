#!/usr/bin/env python3
"""Sinh migration V621 (thông báo mặc định: Chào ngày mới, báo cáo 12:00/18:00, chiến dịch hoàn thành) và bản gỡ.

Nguồn:
  - migrations/snapshots/notification-daily-reports-v621/live/*.sql : pg_get_functiondef production đọc 21/11/2026 (md5 = tên ghi dưới)
  - scripts/notification-daily-reports/v621_new_functions.sql      : hàm mới (chép nguyên văn)
Mỗi thay đổi trên thân cũ là một cặp (cũ, mới) phải khớp đúng một lần. Migration khoá md5 trước (thân production) và sau (thân mới).

Chạy: python3 scripts/build-v621-sql.py   (ghi migrations/migration_v621_*.sql và rollback_v621_*.sql)
Sau khi apply thì không sinh lại: viết migration mới.
"""
import hashlib
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent
LIVE = ROOT / 'migrations/snapshots/notification-daily-reports-v621/live'
NEW_FUNCS = (ROOT / 'scripts/notification-daily-reports/v621_new_functions.sql').read_text()
MIG = 'migration_v621_notification_daily_reports'

def md5(s: str) -> str:
    return hashlib.md5(s.encode()).hexdigest()

def sub_once(text: str, old: str, new: str, fn: str) -> str:
    n = text.count(old)
    if n != 1:
        raise SystemExit(f'{fn}: đoạn cần thay xuất hiện {n} lần, phải đúng 1: {old[:80]!r}')
    return text.replace(old, new)

# (file, regprocedure, md5 production, [(cũ, mới), ...])
EDITS = []

EDITS.append(('private.aka_agent_notification_default_filters.sql', 'private.aka_agent_notification_default_filters(text)',
  'c5cc0691cc495c86e5b59b5f2f6e39c8', [
  ("""    WHEN 'report.scheduled' THEN '{"skipWhenIdle":false,"maxCampaigns":50}'::jsonb
""", """    WHEN 'report.scheduled' THEN '{"skipWhenIdle":false,"maxCampaigns":50}'::jsonb
    WHEN 'report.morning' THEN '{"skipWhenIdle":true}'::jsonb
""")]))

EDITS.append(('private.aka_agent_notification_subscription_json.sql', 'private.aka_agent_notification_subscription_json(bigint,text)',
  'b400edcd2237492c18e19311ea719002', [
  ("""                'skipWhenIdle', coalesce(m.f -> 'skipWhenIdle', d.f -> 'skipWhenIdle'), 'nextRunAt', (SELECT next_run_at FROM sub))
              WHEN 'data_group.membership_changed'""",
   """                'skipWhenIdle', coalesce(m.f -> 'skipWhenIdle', d.f -> 'skipWhenIdle'), 'nextRunAt', (SELECT next_run_at FROM sub))
              WHEN 'report.morning' THEN jsonb_build_object(
                'time', coalesce((SELECT to_char((SELECT schedule_times FROM sub)[1], 'HH24:MI')), '07:00'),
                'skipWhenIdle', coalesce(m.f -> 'skipWhenIdle', d.f -> 'skipWhenIdle'), 'nextRunAt', (SELECT next_run_at FROM sub))
              WHEN 'data_group.membership_changed'""")]))

EDITS.append(('private.aka_agent_notification_settings_json.sql', 'private.aka_agent_notification_settings_json(bigint,uuid)',
  '7f73a571f8e85077c8c3cce611d9c661', [
  ("""      'scheduledReport', private.aka_agent_notification_subscription_json(p_staff_id, 'report.scheduled'),
""", """      'scheduledReport', private.aka_agent_notification_subscription_json(p_staff_id, 'report.scheduled'),
      'morningReport', private.aka_agent_notification_subscription_json(p_staff_id, 'report.morning'),
""")]))

EDITS.append(('private.aka_agent_notification_save_subscription.sql',
  'private.aka_agent_notification_save_subscription(bigint,bigint,text,boolean,boolean,boolean,jsonb,integer,smallint[],time without time zone[],text)',
  '208e5a5c185503c514d1c687cde4211e', [
  ("CASE WHEN p_event_type = 'report.scheduled' AND p_enabled",
   "CASE WHEN p_event_type IN ('report.scheduled', 'report.morning') AND p_enabled")]))

EDITS.append(('private.aka_agent_notification_schedule_reports.sql', 'private.aka_agent_notification_schedule_reports(timestamp with time zone)',
  '801b8ea24fea1dc96e11eb63758a675b', [
  ("WHERE s.event_type = 'report.scheduled' AND s.is_enabled",
   "WHERE s.event_type IN ('report.scheduled', 'report.morning') AND s.is_enabled"),
  ("ORDER BY s.next_run_at LIMIT 200 FOR UPDATE SKIP LOCKED", "ORDER BY s.next_run_at LIMIT 500 FOR UPDATE SKIP LOCKED"),
  ("DECLARE r record; v_count integer := 0; v_tz text; v_slot_local text; v_allowed boolean;\nBEGIN\n",
   "DECLARE r record; v_count integer := 0; v_tz text; v_slot_local text; v_allowed boolean;\n"
   "  -- notifications.report_spread_seconds (V621, mặc định 240; 0 = dựng ngay như trước).\n"
   "  v_spread integer := greatest(least(private.aka_agent_notification_int_setting('notifications.report_spread_seconds', 240), 3600), 0) + 1;\nBEGIN\n"),
  ("""    -- Lỡ nhiều mốc (sự cố) chỉ tạo một báo cáo cho mốc đến hạn sớm nhất rồi nhảy tới mốc tương lai.
""", """    -- Lỡ nhiều mốc (sự cố) chỉ tạo một báo cáo cho mốc đến hạn sớm nhất rồi nhảy tới mốc tương lai.
    -- V621: thêm Chào ngày mới (report.morning, entity morning:, dedupe rm:); dựng rải 0–4 phút theo nhân viên để hàng nghìn báo
    -- cáo cùng mốc không dựng cùng giây (notifications.report_spread_seconds).
"""),
  ("""    VALUES (r.organization_id, r.staff_id, 'report.scheduled', 'info', 'report:' || v_slot_local, p_now, p_now,
            format('rp:%s:%s', r.staff_id, v_slot_local),""",
   """    VALUES (r.organization_id, r.staff_id, r.event_type, 'info',
            CASE WHEN r.event_type = 'report.morning' THEN 'morning:' ELSE 'report:' END || v_slot_local, p_now,
            p_now + make_interval(secs => (r.staff_id % v_spread)::double precision),
            format(CASE WHEN r.event_type = 'report.morning' THEN 'rm:%s:%s' ELSE 'rp:%s:%s' END, r.staff_id, v_slot_local),""")]))

EDITS.append(('private.aka_agent_notification_cleanup.sql', 'private.aka_agent_notification_cleanup(timestamp with time zone)',
  '5f8f4b5859b9224e8f1efcc734cdb883', [
  ("WHERE event_type = 'report.scheduled' AND content_snapshot IS NOT NULL",
   "WHERE event_type IN ('report.scheduled', 'report.morning') AND content_snapshot IS NOT NULL")]))

EDITS.append(('aka_agent_notification_tick.sql', 'public.aka_agent_notification_tick()', '18973d977bbdc8519a0e36148d5ada91', [
  ("  v_reports integer := 0; v_cleanup jsonb; v_has_work boolean;",
   "  v_reports integer := 0; v_cleanup jsonb; v_has_work boolean; v_seed jsonb;"),
  ("""    v_cleanup := private.aka_agent_notification_cleanup(v_now);
""", """    v_cleanup := private.aka_agent_notification_cleanup(v_now);
    -- V621: bật sẵn thông báo cho nhân viên chưa có (theo notifications.default_reports); lỗi không làm hỏng lượt tick.
    BEGIN
      v_seed := private.aka_agent_notification_seed_defaults(v_now);
    EXCEPTION WHEN others THEN
      v_seed := jsonb_build_object('error', SQLSTATE);
    END;
    v_cleanup := v_cleanup || jsonb_build_object('seed', v_seed);
""")]))

CENTER_TYPES_OLD = "('campaign.status_changed','account.status_changed','report.scheduled','data_group.membership_changed','system.test')"
CENTER_TYPES_NEW = "('campaign.status_changed','account.status_changed','report.scheduled','report.morning','data_group.membership_changed','system.test')"
center = (LIVE / 'private.aka_agent_notification_center.sql').read_text()
if center.count(CENTER_TYPES_OLD) != 2:
    raise SystemExit('center: danh sách loại của list/mark phải xuất hiện đúng 2 lần')
EDITS.append(('private.aka_agent_notification_center.sql', 'private.aka_agent_notification_center(bigint,bigint,text,text,jsonb,uuid)',
  'ce94e5820e068aa441361500b0204715', [
  ("  v_c jsonb; v_a jsonb; v_r jsonb; v_g jsonb;",
   "  v_c jsonb; v_a jsonb; v_r jsonb; v_g jsonb; v_m jsonb; v_m_time time without time zone;"),
  # Chào ngày mới: chỉ khi client gửi khoá morningReport (client cũ không gửi thì giữ nguyên dòng đăng ký).
  ("""    v_g_ids := private.aka_agent_notification_valid_ids(p_staff_id, 'group', v_g -> 'groupIds');
""", """    v_g_ids := private.aka_agent_notification_valid_ids(p_staff_id, 'group', v_g -> 'groupIds');
    -- Chào ngày mới (V621): chỉ khi client gửi khoá này; client cũ không gửi thì dòng đăng ký giữ nguyên.
    v_m := v_p #> '{subscriptions,morningReport}';
    IF v_m IS NOT NULL THEN
      IF jsonb_typeof(v_m) <> 'object' OR coalesce(v_m ->> 'time', '07:00') NOT IN ('06:00', '06:30', '07:00', '07:30', '08:00') THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'notification_invalid_schedule';
      END IF;
      v_m_time := coalesce(v_m ->> 'time', '07:00')::time;
    END IF;
"""),
  ("""      jsonb_build_object('groupIds', v_g_ids, 'actions', v_g_actions, 'bucketMinutes', v_g_bucket, 'includeSharedGroups', v_g_shared), NULL, NULL, NULL, v_tz);
""", """      jsonb_build_object('groupIds', v_g_ids, 'actions', v_g_actions, 'bucketMinutes', v_g_bucket, 'includeSharedGroups', v_g_shared), NULL, NULL, NULL, v_tz);
    IF v_m IS NOT NULL THEN
      PERFORM private.aka_agent_notification_save_subscription(p_staff_id, p_organization_id, 'report.morning',
        private.aka_agent_notification_flag(v_m -> 'enabled', false), private.aka_agent_notification_flag(v_m -> 'email', false),
        private.aka_agent_notification_flag(v_m -> 'push', false),
        jsonb_build_object('skipWhenIdle', private.aka_agent_notification_flag(v_m -> 'skipWhenIdle', true)), NULL,
        ARRAY[1, 2, 3, 4, 5, 6, 7]::smallint[], ARRAY[v_m_time], v_tz);
    END IF;
"""),
  (CENTER_TYPES_OLD, CENTER_TYPES_NEW),  # thay cả 2 chỗ (kiểm số lần ở trên)
  ("    IF v_type NOT IN ('campaign.status_changed','account.status_changed','report.scheduled','data_group.membership_changed') THEN",
   "    IF v_type NOT IN ('campaign.status_changed','account.status_changed','report.scheduled','report.morning','data_group.membership_changed') THEN"),
]))

EDITS.append(('aka_agent_notification_snapshot.sql', 'public.aka_agent_notification_snapshot(text,jsonb)', 'c67d59fad197519aeb90e43c6e146e16', [
  ("""    RETURN jsonb_build_object('found', true, 'accounts', v_accounts, 'loggedOutAccounts', v_logged_out, 'campaignCounts', v_campaign_counts,
                              'campaigns', v_campaigns, 'issues', v_issues, 'countedAt', v_now, 'dayStart', v_day_start, 'timezone', v_tz);
""", """    RETURN jsonb_build_object('found', true, 'accounts', v_accounts, 'loggedOutAccounts', v_logged_out, 'campaignCounts', v_campaign_counts,
                              'campaigns', v_campaigns, 'issues', v_issues, 'countedAt', v_now, 'dayStart', v_day_start, 'timezone', v_tz,
                              'completedToday', private.aka_agent_notification_completed_today(v_staff, v_day_start));

  -- V621: phần đọc thêm của báo cáo / Chào ngày mới / chiến dịch hoàn thành (API gọi riêng, lỗi thì bỏ đúng mục đó).
  ELSIF p_kind = 'account_actions' THEN
    RETURN private.aka_agent_notification_account_actions(v_staff, v_tz, v_payload ->> 'window', v_now);
  ELSIF p_kind = 'morning' THEN
    RETURN private.aka_agent_notification_morning(v_staff, v_tz, v_now);
  ELSIF p_kind = 'failure_reasons' THEN
    RETURN private.aka_agent_notification_failure_reasons(v_staff, (v_payload ->> 'campaignId')::bigint);
""")]))

NEW_NAMES = [
  'private.aka_agent_notification_account_actions(bigint,text,text,timestamp with time zone)',
  'private.aka_agent_notification_completed_today(bigint,timestamp with time zone)',
  'private.aka_agent_notification_failure_reasons(bigint,bigint)',
  'private.aka_agent_notification_morning(bigint,text,timestamp with time zone)',
  'private.aka_agent_notification_default_email(bigint)',
  'private.aka_agent_notification_seed_defaults(timestamp with time zone)',
]
DEPS = [
  'public.aka_agent_engine_action_limit(bigint,bigint,text)',
  'public.aka_agent_app_access_staff_allowed(bigint,text)',
  'private.aka_agent_notification_result_group(text,text)',
  'private.aka_agent_notification_next_run(smallint[],time without time zone[],text,timestamp with time zone)',
  'private.aka_agent_notification_setting(text,text)',
  'private.aka_agent_notification_flag(jsonb,boolean)',
]
CONSTRAINTS = [  # (bảng, tên, giá trị thêm)
  ('public.auto_notifications', 'auto_notifications_event_type_check', 'report.morning'),
  ('public.auto_notification_subscriptions', 'auto_notification_subscriptions_event_type_check', 'report.morning'),
  ('public.auto_email_notification_settings', 'auto_email_notification_settings_client_check', 'default_seed'),
]
ROLES = 'PUBLIC, anon, authenticated, service_role, aka_agent_desktop, aka_agent_chat_api'

built = []
for fname, sig, live_md5, edits in EDITS:
    old = (LIVE / fname).read_text()
    if md5(old) != live_md5:
        raise SystemExit(f'{fname}: md5 bản chụp {md5(old)} khác {live_md5}')
    new = old
    for o, n in edits:
        if o == CENTER_TYPES_OLD:
            new = new.replace(o, n)
        else:
            new = sub_once(new, o, n, fname)
    built.append((sig, live_md5, md5(new), old, new))

def q(s):
    return "'" + s.replace("'", "''") + "'"

def arr(xs):
    return 'ARRAY[' + ', '.join(q(x) for x in xs) + ']'

def constraint_sql(add: bool) -> str:
    out = []
    for table, name, value in CONSTRAINTS:
        out.append(f"""  -- {name}: {'thêm' if add else 'bỏ'} {value!r}, giữ nguyên mọi giá trị đang có (đọc từ định nghĩa hiện tại).
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint WHERE conrelid = {q(table)}::regclass AND conname = {q(name)};
  IF v_def IS NULL THEN RAISE EXCEPTION 'v621: thiếu ràng buộc {name}'; END IF;
  v_vals := ARRAY(SELECT m[1] FROM regexp_matches(v_def, '''([^'']+)''::text', 'g') AS m);
  IF cardinality(v_vals) = 0 THEN RAISE EXCEPTION 'v621: không đọc được giá trị của {name}: %', v_def; END IF;""")
        if add:
            out.append(f"""  IF {q(value)} = ANY (v_vals) THEN RAISE EXCEPTION 'v621: {name} đã có {value}'; END IF;
  v_vals := v_vals || {q(value)}::text;""")
        else:
            if value == 'default_seed':
                out.append(f"""  UPDATE {table} SET updated_by_client = 'system' WHERE updated_by_client = 'default_seed';""")
            else:
                out.append(f"""  IF EXISTS (SELECT 1 FROM {table} WHERE event_type = {q(value)}) THEN
    RAISE EXCEPTION 'v621 rollback: {table} còn dòng {value}';
  END IF;""")
            out.append(f"""  v_vals := array_remove(v_vals, {q(value)}::text);""")
        col = 'updated_by_client' if 'client' in name else 'event_type'
        null_ok = f'{col} IS NULL OR ' if col == 'updated_by_client' else ''
        out.append(f"""  EXECUTE format('ALTER TABLE {table} DROP CONSTRAINT {name}');
  EXECUTE format('ALTER TABLE {table} ADD CONSTRAINT {name} CHECK ({null_ok}{col} = ANY (ARRAY[%s])) NOT VALID',
    (SELECT string_agg(quote_literal(v) || '::text', ', ' ORDER BY o) FROM unnest(v_vals) WITH ORDINALITY AS t(v, o)));""")
    return '\n'.join(out)

new_sigs_check = '\n'.join(f"  IF to_regprocedure({q(s)}) IS NOT NULL THEN RAISE EXCEPTION 'v621: {s} đã có'; END IF;" for s in NEW_NAMES)
deps_check = '\n'.join(f"  IF to_regprocedure({q(s)}) IS NULL THEN RAISE EXCEPTION 'v621: thiếu {s}'; END IF;" for s in DEPS)
pre_md5 = '\n'.join(f"""  IF md5(pg_get_functiondef({q(sig)}::regprocedure)) IS DISTINCT FROM {q(old_md5)} THEN
    RAISE EXCEPTION 'v621: {sig} khác bản đã đọc 21/11/2026 (md5 %)', md5(pg_get_functiondef({q(sig)}::regprocedure));
  END IF;""" for sig, old_md5, _, _, _ in built)
post_md5 = '\n'.join(f"""  IF md5(pg_get_functiondef({q(sig)}::regprocedure)) IS DISTINCT FROM {q(new_md5)} THEN
    RAISE EXCEPTION 'v621: {sig} sau khi thay có md5 %, cần {new_md5}', md5(pg_get_functiondef({q(sig)}::regprocedure));
  END IF;""" for sig, _, new_md5, _, _ in built)
acl_save = '\n'.join(f"  INSERT INTO pg_temp.v621_acl VALUES ({q(sig)}, (SELECT proacl::text FROM pg_proc WHERE oid = {q(sig)}::regprocedure));" for sig, *_ in built)

migration = f"""-- V621: thông báo mặc định cho mọi tài khoản (Chào ngày mới 06:00–08:00, báo cáo 12:00 + 18:00, chiến dịch hoàn thành).
-- Sinh bằng scripts/build-v621-sql.py (không sửa tay); phương án docs/NOTIFICATION_DEFAULT_REPORTS_PLAN.md.
--
-- 1) Loại thông báo mới report.morning (CHECK của auto_notifications / auto_notification_subscriptions, NOT VALID; p2 VALIDATE).
-- 2) Hàm mới (private, chỉ owner): account_actions (kết quả theo tài khoản × thao tác + data chờ), completed_today, failure_reasons,
--    morning (chiến dịch chạy hôm nay + dự kiến + tài khoản cần xử lý), default_email, seed_defaults (bật sẵn cho nhân viên).
-- 3) Thay 9 hàm đang chạy (khoá md5 thân production đọc 21/11/2026 trước và sau): snapshot (kind account_actions / morning /
--    failure_reasons, report thêm completedToday), schedule_reports (lập lịch cả report.morning, rải 0–4 phút, 500 dòng/lượt),
--    center (get/save morningReport, lọc / tắt nhận report.morning), settings_json, subscription_json, default_filters,
--    save_subscription, cleanup, tick (gọi seed_defaults trong bước dọn hằng giờ, chỉ chế độ fly).
-- 4) Công tắc auto_system_settings notifications.default_reports = {{"audience":"off"}} (không gieo gì tới khi bật):
--    admin_akabiz → orgs (organizationIds) → all; "batch" nhân viên mỗi giờ (mặc định 200, tối đa 1000).
--    Chưa có email thì chỉ bật hộp thư + App, không xin email; có email lúc nào thì bật Email lúc đó (anh chốt 21/11/2026).
-- Client cũ không đổi hành vi: không gửi morningReport thì dòng đăng ký giữ nguyên; nội dung dựng sẵn vẫn là sections.
-- DDL: PostgREST nạp lại schema; apply buổi tối. Sau đó chạy {MIG.replace('migration_', 'migration_')}_p2.sql (từng lệnh).
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
{new_sigs_check}
{deps_check}
{pre_md5}
END
$v621_pre$;

CREATE TEMP TABLE v621_acl (sig text PRIMARY KEY, acl text) ON COMMIT DROP;
DO $v621_acl$
BEGIN
{acl_save}
END
$v621_acl$;

INSERT INTO public.auto_system_settings (key, value, description, is_secret, is_active) VALUES
  ('notifications.default_reports', '{{"audience":"off","batch":200}}',
   'V621: bật sẵn Chào ngày mới 07:00, báo cáo 12:00 + 18:00, chiến dịch Hoàn thành cho nhân viên chưa có cài đặt thông báo. audience: off | admin_akabiz | orgs (organizationIds) | all; batch: số nhân viên mỗi giờ (1–1000). Chưa có email thì chỉ hộp thư + App.',
   false, true),
  ('notifications.report_spread_seconds', '240',
   'V621: báo cáo theo lịch (12:00/18:00, Chào ngày mới) dựng rải 0..N giây theo nhân viên để hàng nghìn báo cáo cùng mốc không dựng cùng giây. 0 = dựng ngay.',
   false, true);

DO $v621_checks$
DECLARE v_def text; v_vals text[];
BEGIN
{constraint_sql(True)}
END
$v621_checks$;

-- Hàm mới
{NEW_FUNCS}

DO $v621_grants$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY {arr(NEW_NAMES)} LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM {ROLES}', f);
  END LOOP;
END
$v621_grants$;

-- Hàm thay thế (CREATE OR REPLACE giữ chủ sở hữu và quyền)
{chr(10).join(new + ';' + chr(10) for _, _, _, _, new in built)}
DO $v621_post$
DECLARE r record;
BEGIN
{post_md5}
  FOR r IN SELECT a.sig, a.acl, p.proacl::text AS now_acl FROM pg_temp.v621_acl a JOIN pg_proc p ON p.oid = a.sig::regprocedure LOOP
    IF r.acl IS DISTINCT FROM r.now_acl THEN RAISE EXCEPTION 'v621: quyền của % đổi: % → %', r.sig, r.acl, r.now_acl; END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_proc p, unnest({arr(NEW_NAMES)}) AS s
              WHERE p.oid = s::regprocedure AND (has_function_privilege('anon', p.oid, 'EXECUTE')
                 OR has_function_privilege('authenticated', p.oid, 'EXECUTE') OR has_function_privilege('aka_agent_desktop', p.oid, 'EXECUTE'))) THEN
    RAISE EXCEPTION 'v621: hàm mới còn quyền EXECUTE cho anon/authenticated/aka_agent_desktop';
  END IF;
END
$v621_post$;

COMMIT;
"""

p2 = """-- V621 p2: xác nhận ràng buộc và chỉ mục lập lịch mới. Chạy SAU migration_v621_notification_daily_reports.sql,
-- TỪNG LỆNH một (CREATE/DROP INDEX CONCURRENTLY không chạy trong giao dịch; Supabase CLI: mỗi lệnh một lần `db query`).
-- Chỉ mục cũ chỉ phủ report.scheduled nên lượt lập lịch quét bảng đăng ký (vài chục nghìn dòng sau khi gieo) mỗi 30 giây.
ALTER TABLE public.auto_notifications VALIDATE CONSTRAINT auto_notifications_event_type_check;
ALTER TABLE public.auto_notification_subscriptions VALIDATE CONSTRAINT auto_notification_subscriptions_event_type_check;
ALTER TABLE public.auto_email_notification_settings VALIDATE CONSTRAINT auto_email_notification_settings_client_check;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_auto_notification_subscriptions_reports_due ON public.auto_notification_subscriptions (next_run_at)
  WHERE event_type IN ('report.scheduled', 'report.morning') AND is_enabled;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_auto_notification_subscriptions_report_due;
"""

restore = '\n'.join(old + ';\n' for _, _, _, old, _ in built)
rollback_md5 = '\n'.join(f"""  IF md5(pg_get_functiondef({q(sig)}::regprocedure)) IS DISTINCT FROM {q(new_md5)} THEN
    RAISE EXCEPTION 'v621 rollback: {sig} không phải bản V621 (md5 %)', md5(pg_get_functiondef({q(sig)}::regprocedure));
  END IF;""" for sig, _, new_md5, _, _ in built)
rollback_post = '\n'.join(f"""  IF md5(pg_get_functiondef({q(sig)}::regprocedure)) IS DISTINCT FROM {q(old_md5)} THEN
    RAISE EXCEPTION 'v621 rollback: {sig} chưa về bản cũ';
  END IF;""" for sig, old_md5, _, _, _ in built)

rollback = f"""-- Gỡ V621. Thứ tự:
--   (tuỳ chọn) dừng gieo thêm mà giữ tính năng: UPDATE public.auto_system_settings SET value = '{{"audience":"off"}}'
--     WHERE key = 'notifications.default_reports';
--   (tuỳ chọn) tắt các dòng đã gieo mà khách chưa sửa:
--     UPDATE public.auto_notification_subscriptions s SET is_enabled = false, next_run_at = NULL, updated_at = now()
--       FROM public.auto_email_notification_settings e
--      WHERE e.staff_id = s.staff_id AND e.updated_by_client = 'default_seed'
--        AND s.event_type IN ('report.morning','report.scheduled','campaign.status_changed');
--   Gỡ hẳn: file này xoá dòng đăng ký + thông báo report.morning (và lượt gửi của chúng), trả 9 hàm về đúng bản 21/11/2026,
--   xoá 6 hàm mới, đổi updated_by_client 'default_seed' → 'system', trả các CHECK, xoá công tắc. Chỉ mục mới của p2 giữ lại
--   (phủ cả report.scheduled); muốn trả chỉ mục cũ thì tạo lại idx_auto_notification_subscriptions_report_due CONCURRENTLY.
BEGIN;
SET LOCAL lock_timeout = '3s';

DO $v621_rb_pre$
BEGIN
{rollback_md5}
END
$v621_rb_pre$;

DELETE FROM public.auto_notification_deliveries d USING public.auto_notifications n WHERE d.notification_id = n.id AND n.event_type = 'report.morning';
DELETE FROM public.auto_notifications WHERE event_type = 'report.morning';
DELETE FROM public.auto_notification_subscriptions WHERE event_type = 'report.morning';

{restore}
DROP FUNCTION {', '.join(NEW_NAMES)};

DO $v621_rb_checks$
DECLARE v_def text; v_vals text[];
BEGIN
  PERFORM set_config('aka.notification_center_write', 'on', true);
{constraint_sql(False)}
  PERFORM set_config('aka.notification_center_write', '', true);
END
$v621_rb_checks$;

DELETE FROM public.auto_system_settings WHERE key IN ('notifications.default_reports', 'notifications.report_spread_seconds');

DO $v621_rb_post$
BEGIN
{rollback_post}
END
$v621_rb_post$;

COMMIT;
"""

(ROOT / f'migrations/{MIG}.sql').write_text(migration)
(ROOT / f'migrations/{MIG}_p2.sql').write_text(p2)
(ROOT / 'migrations/rollback_v621_notification_daily_reports.sql').write_text(rollback)
for sig, a, b, _, _ in built:
    print(f'{sig}: {a} -> {b}')
print('md5 migration', md5(migration))
