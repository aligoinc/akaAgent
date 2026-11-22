-- V622: "Chào ngày mới" (snapshot morning) trả thêm tổng data chờ / dự kiến hôm nay trên MỌI chiến dịch chạy hôm nay.
-- V621 chỉ có 50 chiến dịch đầu trong campaignsToday nên tổng do API cộng thiếu khi nhân viên có hơn 50 chiến dịch.
-- Thêm khoá campaignsTodayNeedsData / campaignsTodayPending / campaignsTodayExpected; khoá cũ giữ nguyên.
-- Chỉ thay thân private.aka_agent_notification_morning (CREATE OR REPLACE giữ chủ sở hữu và quyền), khoá md5 trước / sau.
-- Sinh bằng: python3 scripts/build-v622-sql.py
BEGIN;
SET LOCAL lock_timeout = '3s';
DO $v622_pre$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name = 'migration_v621_notification_daily_reports') THEN
    RAISE EXCEPTION 'v622: cần V621 trước';
  END IF;
  IF md5(pg_get_functiondef('private.aka_agent_notification_morning(bigint,text,timestamp with time zone)'::regprocedure)) IS DISTINCT FROM '94392489bb0b5f3c25bd281c2fe1eb06' THEN
    RAISE EXCEPTION 'v622: private.aka_agent_notification_morning(bigint,text,timestamp with time zone) khác bản đã đọc 22/11/2026 (md5 %)', md5(pg_get_functiondef('private.aka_agent_notification_morning(bigint,text,timestamp with time zone)'::regprocedure));
  END IF;
END
$v622_pre$;

CREATE OR REPLACE FUNCTION private.aka_agent_notification_morning(p_staff bigint, p_tz text, p_now timestamp with time zone)
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
           -- V622: tổng trên mọi chiến dịch chạy hôm nay (campaignsToday chỉ có 50 dòng đầu).
           'campaignsTodayNeedsData', (SELECT count(*) FROM ranked WHERE NOT no_data),
           'campaignsTodayPending', (SELECT coalesce(sum(pending), 0) FROM ranked WHERE NOT no_data),
           'campaignsTodayExpected', (SELECT coalesce(sum(CASE WHEN day_left IS NULL THEN pending
                                                              ELSE least(pending, greatest(day_left - used_before, 0)) END), 0)
                                        FROM ranked WHERE NOT no_data),
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

DO $v622_post$
BEGIN
  IF md5(pg_get_functiondef('private.aka_agent_notification_morning(bigint,text,timestamp with time zone)'::regprocedure)) IS DISTINCT FROM 'a3ff4875140d65498f0e10327d5f8952' THEN
    RAISE EXCEPTION 'v622: private.aka_agent_notification_morning(bigint,text,timestamp with time zone) sau khi thay không đúng bản V622 (md5 %)', md5(pg_get_functiondef('private.aka_agent_notification_morning(bigint,text,timestamp with time zone)'::regprocedure));
  END IF;
END
$v622_post$;
COMMIT;
