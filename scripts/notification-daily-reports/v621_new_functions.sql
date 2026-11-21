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
