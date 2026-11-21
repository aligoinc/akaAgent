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
                              'campaigns', v_campaigns, 'issues', v_issues, 'countedAt', v_now, 'dayStart', v_day_start, 'timezone', v_tz);

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
