-- V561 "Lặp lại sau khi chạy xong": giả lập đủ luồng trên DB thật trong MỘT giao dịch rồi ROLLBACK (không để lại dòng nào; chỉ tiêu
-- vài số id của sequence). Tài khoản / chiến dịch / data giả thuộc tổ chức 1 (akaBiz), nhân viên 4 (admin akaBiz); bộ chạy thật không
-- thấy vì giao dịch không commit. Chạy sau khi apply V561 p1 + p2:
--   supabase db query --linked --workdir <repo akaAgent> -f scripts/campaign-repeat-v561-prod-sim.sql -o json
-- Kết quả: một dòng JSON {checks, failed, steps[]}; failed = 0 là đạt.
begin;
set local statement_timeout = '120s';
set local lock_timeout = '3s';
create temp table sim_result(n serial, step text, ok boolean, detail jsonb) on commit drop;
-- Cả bài giả lập chạy trong một giao dịch: now() (trigger đặt completed_at) là lúc bắt đầu giao dịch. Ngoài đời mỗi bước là một
-- giao dịch riêng, nên sau mỗi lần chuyển "hoàn thành" bài đặt lại completed_at bằng giờ thật.

DO $sim$
DECLARE
  c_staff CONSTANT bigint := 4;
  c_org CONSTANT bigint := 1;
  c_repeat_day CONSTANT jsonb := '{"repeatAfterCompletionEnabled":true,"repeatAfterCompletionEvery":1,"repeatAfterCompletionUnit":"day","repeatAfterCompletionMaxRuns":3}';
  v_acc bigint; v_fb bigint;
  v_c bigint; v_d bigint; v_s bigint; v_tl bigint; v_plain bigint;
  v jsonb; v2 jsonb; s jsonb;
  v_lease uuid;
  v_txt text;
  v_n integer;
  v_auth uuid;
  v_vn date := (clock_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date;
  v_start timestamptz := (v_vn + time '08:30') AT TIME ZONE 'Asia/Ho_Chi_Minh';
  -- Lượt xong hôm nay, lặp 1 ngày: lượt kế = 08:30 ngày mai (giờ Việt Nam).
  v_tomorrow timestamptz := (v_vn + 1 + time '08:30') AT TIME ZONE 'Asia/Ho_Chi_Minh';
BEGIN
  -- ---- dựng dữ liệu giả ---------------------------------------------------------------------------------------------------
  INSERT INTO public.auto_accounts(name, flatform_type, login_status, status, is_active, is_delete, staff_id, organization_id, is_zalo_server, is_zalo_show_web)
  VALUES ('[giả lập V561] Zalo', 'zalo', 'đã đăng nhập', 'chờ xử lý', true, false, c_staff, c_org, false, false) RETURNING id INTO v_acc;
  INSERT INTO public.auto_accounts(name, flatform_type, login_status, status, is_active, is_delete, staff_id, organization_id, is_zalo_server, is_zalo_show_web)
  VALUES ('[giả lập V561] Facebook', 'facebook', 'đã đăng nhập', 'chờ xử lý', true, false, c_staff, c_org, false, false) RETURNING id INTO v_fb;


  -- ---- 1. engine v2: hàm kết thúc lượt (Zalo, Desktop) ---------------------------------------------------------------------
  INSERT INTO public.auto_campaigns(name, action_id, account_id, status, schedule, original_schedule, schedule_type, continue_next_day,
    provisioning_state, data_target_source_mode, extra_settings, is_delete, staff_id, organization_id)
  VALUES ('[giả lập V561] engine', 'zalo_message_phone', v_acc, 'chờ xử lý', now() + interval '30 days', v_start, 'daily', true, 'ready', 'direct',
    c_repeat_day, false, c_staff, c_org) RETURNING id INTO v_c;
  INSERT INTO public.auto_campaign_input_data(campaign_id, name, phone, status, is_delete)
  SELECT v_c, 'Khách giả ' || g, '090000000' || g, CASE WHEN g = 3 THEN 'tạm dừng' ELSE 'chờ xử lý' END, false FROM generate_series(1, 3) g;
  v := public.aka_agent_campaign_repeat_sync_v1(c_staff, v_c);
  INSERT INTO sim_result(step, ok, detail) VALUES ('1a sync_v1 đăng ký lặp', v->>'ok' = 'true' AND v->>'enabled' = 'true' AND (v->>'runsDone')::int = 0, v);
  FOR i IN 1..3 LOOP
    UPDATE public.auto_campaign_input_data SET status = 'hoàn thành' WHERE campaign_id = v_c AND status = 'chờ xử lý';
    UPDATE public.auto_campaigns SET status = 'đang chạy' WHERE id = v_c;
    INSERT INTO public.auto_engine_leases(account_id, lease_token, runner_id, runtime_target, campaign_id, expires_at)
    VALUES (v_acc, gen_random_uuid(), 'desktop:sim-v561', 'desktop', v_c, now() + interval '5 minutes') RETURNING lease_token INTO v_lease;
    v := public.aka_agent_engine_finish_campaign_v2(v_acc, v_lease, NULL);
    DELETE FROM public.auto_engine_leases WHERE account_id = v_acc;
    SELECT jsonb_build_object('status', c.status, 'schedule', c.schedule, 'runsDone', c.repeat_runs_done,
      'data', (SELECT jsonb_agg(d.status ORDER BY d.id) FROM public.auto_campaign_input_data d WHERE d.campaign_id = c.id)) INTO s
      FROM public.auto_campaigns c WHERE c.id = v_c;
    IF i < 3 THEN
      INSERT INTO sim_result(step, ok, detail) VALUES (format('1b engine lượt %s/3: hẹn lượt kế, đặt lại data trừ tạm dừng', i),
        v->>'reason' = 'repeat_scheduled' AND (v->'repeat'->>'run')::int = i AND s->>'status' = 'chờ xử lý'
          AND (s->>'schedule')::timestamptz = v_tomorrow
          AND s->'data' = '["chờ xử lý","chờ xử lý","tạm dừng"]'::jsonb AND (s->>'runsDone')::int = i,
        jsonb_build_object('finish', v, 'campaign', s));
    ELSE
      INSERT INTO sim_result(step, ok, detail) SELECT '1c engine lượt 3/3: hoàn thành, chốt vòng lặp',
        v->>'reason' = 'completed' AND v->'repeat'->>'reason' = 'max_runs' AND s->>'status' = 'hoàn thành'
          AND private.aka_agent_campaign_repeat_state(c.*)->>'endedReason' = 'max_runs',
        jsonb_build_object('finish', v, 'campaign', s, 'state', private.aka_agent_campaign_repeat_state(c.*))
        FROM public.auto_campaigns c WHERE c.id = v_c;
    END IF;
  END LOOP;

  -- Chiến dịch không bật lặp: kết thúc lượt như trước, không có bộ đếm.
  INSERT INTO public.auto_campaigns(name, action_id, account_id, status, schedule, original_schedule, schedule_type, continue_next_day,
    provisioning_state, data_target_source_mode, extra_settings, is_delete, staff_id, organization_id)
  VALUES ('[giả lập V561] không lặp', 'zalo_message_phone', v_acc, 'đang chạy', now() + interval '30 days', v_start, 'daily', true, 'ready', 'direct',
    '{}', false, c_staff, c_org) RETURNING id INTO v_plain;
  INSERT INTO public.auto_campaign_input_data(campaign_id, name, phone, status, is_delete) VALUES (v_plain, 'Khách giả', '0900000009', 'hoàn thành', false);
  INSERT INTO public.auto_engine_leases(account_id, lease_token, runner_id, runtime_target, campaign_id, expires_at)
  VALUES (v_acc, gen_random_uuid(), 'desktop:sim-v561', 'desktop', v_plain, now() + interval '5 minutes') RETURNING lease_token INTO v_lease;
  v := public.aka_agent_engine_finish_campaign_v2(v_acc, v_lease, NULL);
  DELETE FROM public.auto_engine_leases WHERE account_id = v_acc;
  INSERT INTO sim_result(step, ok, detail) SELECT '1d engine: chiến dịch không bật lặp hoàn thành như trước',
    v->>'reason' = 'completed' AND NOT v ? 'repeat' AND c.status = 'hoàn thành' AND c.repeat_log IS NULL AND c.repeat_runs_done = 0, v
    FROM public.auto_campaigns c WHERE c.id = v_plain;

  -- ---- 2. engine v2: đăng trang cá nhân Facebook không có dòng data ---------------------------------------------------------
  INSERT INTO public.auto_campaigns(name, action_id, account_id, status, schedule, original_schedule, schedule_type, continue_next_day,
    provisioning_state, data_target_source_mode, extra_settings, is_delete, staff_id, organization_id, daily_stop_time)
  VALUES ('[giả lập V561] trang cá nhân', 'facebook_timeline_post', v_fb, 'đang chạy', now() + interval '30 days', v_start, 'daily', true, 'ready', 'direct',
    '{"repeatAfterCompletionEnabled":true,"repeatAfterCompletionEvery":6,"repeatAfterCompletionUnit":"hour","repeatAfterCompletionMaxRuns":2}', false, c_staff, c_org,
    time '23:00') RETURNING id INTO v_tl;
  INSERT INTO public.auto_engine_leases(account_id, lease_token, runner_id, runtime_target, campaign_id, expires_at)
  VALUES (v_fb, gen_random_uuid(), 'desktop:sim-v561', 'desktop', v_tl, now() + interval '5 minutes') RETURNING lease_token INTO v_lease;
  v := public.aka_agent_engine_finish_campaign_v2(v_fb, v_lease, NULL);
  DELETE FROM public.auto_engine_leases WHERE account_id = v_fb;
  INSERT INTO sim_result(step, ok, detail) SELECT '2 engine Facebook trang cá nhân không data: hẹn lượt kế (giờ, trong khung chạy)',
    v->>'reason' = 'repeat_scheduled' AND (v->'repeat'->>'run')::int = 1 AND c.status = 'chờ xử lý'
      AND c.schedule = private.aka_agent_campaign_repeat_clamp(c.*, (v->'repeat'->>'next')::timestamptz) AND c.schedule > now(),
    jsonb_build_object('finish', v, 'schedule', c.schedule)
    FROM public.auto_campaigns c WHERE c.id = v_tl;

  -- ---- 3. bộ chạy cũ Desktop: decide_v1 ------------------------------------------------------------------------------------
  INSERT INTO public.auto_campaigns(name, action_id, account_id, status, schedule, original_schedule, schedule_type, continue_next_day,
    provisioning_state, data_target_source_mode, extra_settings, is_delete, staff_id, organization_id)
  VALUES ('[giả lập V561] bộ chạy cũ', 'zalo_message_phone', v_acc, 'chờ xử lý', now() + interval '30 days', v_start, 'daily', true, 'ready', 'direct',
    '{"repeatAfterCompletionEnabled":true,"repeatAfterCompletionEvery":2,"repeatAfterCompletionUnit":"hour","repeatAfterCompletionMaxRuns":2}', false, c_staff, c_org)
  RETURNING id INTO v_d;
  INSERT INTO public.auto_campaign_input_data(campaign_id, name, phone, status, is_delete) VALUES (v_d, 'Khách giả', '0900000010', 'hoàn thành', false);
  PERFORM public.aka_agent_campaign_repeat_sync_v1(c_staff, v_d);
  v := public.aka_agent_campaign_repeat_decide_v1(c_staff, v_d);
  INSERT INTO sim_result(step, ok, detail) VALUES ('3a decide_v1 khi chưa chạy: từ chối (not_running)', v->>'reason' = 'not_running', v);
  UPDATE public.auto_campaigns SET status = 'đang chạy' WHERE id = v_d;
  v := public.aka_agent_campaign_repeat_decide_v1(c_staff, v_d);
  INSERT INTO sim_result(step, ok, detail) VALUES ('3b decide_v1 lượt 1/2: lặp tiếp, có giờ lượt kế',
    v->>'ok' = 'true' AND v->>'repeat' = 'true' AND (v->>'run')::int = 1 AND (v->>'next')::timestamptz > now(), v);
  v := public.aka_agent_campaign_repeat_decide_v1(c_staff, v_d);
  INSERT INTO sim_result(step, ok, detail) VALUES ('3c decide_v1 lượt 2/2: lượt cuối', v->>'repeat' = 'false' AND v->>'reason' = 'max_runs', v);
  SELECT count(*) INTO v_n FROM public.auto_notifications WHERE campaign_id = v_d;
  UPDATE public.auto_campaigns SET status = 'hoàn thành' WHERE id = v_d;
  UPDATE public.auto_campaigns SET completed_at = clock_timestamp() WHERE id = v_d;
  INSERT INTO sim_result(step, ok, detail) SELECT '3d lượt cuối hoàn thành: không bị coi là lượt giữa (will_reopen = false)',
    NOT private.aka_agent_campaign_repeat_will_reopen(c.*),
    jsonb_build_object('notificationsAdded', (SELECT count(*) FROM public.auto_notifications WHERE campaign_id = v_d) - v_n)
    FROM public.auto_campaigns c WHERE c.id = v_d;
  UPDATE public.auto_campaigns SET status = 'đang chạy' WHERE id = v_d;
  v := public.aka_agent_campaign_repeat_decide_v1(c_staff, v_d);
  INSERT INTO sim_result(step, ok, detail) VALUES ('3e khách cho chạy lại sau lượt cuối: vòng đếm mới', v->>'repeat' = 'true' AND (v->>'run')::int = 1, v);

  -- ---- 4. bộ quét dự phòng (bộ chạy chưa biết tính năng đánh "hoàn thành") ---------------------------------------------------
  INSERT INTO public.auto_campaigns(name, action_id, account_id, status, schedule, original_schedule, schedule_type, continue_next_day,
    provisioning_state, data_target_source_mode, extra_settings, is_delete, staff_id, organization_id)
  VALUES ('[giả lập V561] bộ quét', 'zalo_message_phone', v_acc, 'đang chạy', now() + interval '30 days', v_start, 'daily', true, 'ready', 'direct',
    '{"repeatAfterCompletionEnabled":true,"repeatAfterCompletionEvery":1,"repeatAfterCompletionUnit":"day","repeatAfterCompletionMaxRuns":2}', false, c_staff, c_org)
  RETURNING id INTO v_s;
  INSERT INTO public.auto_campaign_input_data(campaign_id, name, phone, status, is_delete)
  SELECT v_s, 'Khách giả ' || g, '090000002' || g, 'hoàn thành', false FROM generate_series(1, 2) g;
  PERFORM public.aka_agent_campaign_repeat_sync_v1(c_staff, v_s);
  UPDATE public.auto_campaigns SET status = 'hoàn thành' WHERE id = v_s;
  UPDATE public.auto_campaigns SET completed_at = clock_timestamp() WHERE id = v_s;
  INSERT INTO sim_result(step, ok, detail) SELECT '4a lượt giữa hoàn thành: bộ quét sẽ mở lại (không báo "hoàn thành")',
    private.aka_agent_campaign_repeat_will_reopen(c.*), jsonb_build_object('completedAt', c.completed_at)
    FROM public.auto_campaigns c WHERE c.id = v_s;
  v := public.aka_agent_campaign_repeat_tick_v1(50);
  SELECT jsonb_build_object('status', c.status, 'schedule', c.schedule, 'completedAt', c.completed_at, 'runsDone', c.repeat_runs_done,
    'data', (SELECT jsonb_agg(d.status ORDER BY d.id) FROM public.auto_campaign_input_data d WHERE d.campaign_id = c.id),
    'log', (SELECT l.log FROM public.auto_campaign_logs l WHERE l.campaign_id = c.id ORDER BY l.id DESC LIMIT 1)) INTO s
    FROM public.auto_campaigns c WHERE c.id = v_s;
  INSERT INTO sim_result(step, ok, detail) VALUES ('4b tick_v1 mở lại: chờ xử lý, lịch ngày mai 08:30, data về chờ, ghi lịch sử chạy',
    (v->>'reopened')::int = 1 AND (v->>'failed')::int = 0 AND s->>'status' = 'chờ xử lý' AND s->>'completedAt' IS NULL
      AND (s->>'schedule')::timestamptz = v_tomorrow
      AND s->'data' = '["chờ xử lý","chờ xử lý"]'::jsonb AND (s->>'runsDone')::int = 1 AND s->>'log' LIKE '%⏳ Đã chạy xong lượt 1/2, hẹn chạy lại chiến dịch%',
    jsonb_build_object('tick', v, 'campaign', s));
  v := public.aka_agent_campaign_repeat_tick_v1(50);
  INSERT INTO sim_result(step, ok, detail) VALUES ('4c quét lại: không làm gì thêm', coalesce((v->>'reopened')::int, 0) = 0 AND coalesce((v->>'ended')::int, 0) = 0, v);
  UPDATE public.auto_campaign_input_data SET status = 'hoàn thành' WHERE campaign_id = v_s;
  UPDATE public.auto_campaigns SET status = 'hoàn thành' WHERE id = v_s;
  UPDATE public.auto_campaigns SET completed_at = clock_timestamp() WHERE id = v_s;
  v := public.aka_agent_campaign_repeat_tick_v1(50);
  INSERT INTO sim_result(step, ok, detail) SELECT '4d lượt cuối: bộ quét chốt kết thúc, không mở lại',
    (v->>'ended')::int = 1 AND c.status = 'hoàn thành' AND private.aka_agent_campaign_repeat_state(c.*)->>'endedReason' = 'max_runs',
    jsonb_build_object('tick', v, 'state', private.aka_agent_campaign_repeat_state(c.*))
    FROM public.auto_campaigns c WHERE c.id = v_s;

  -- ---- 5. state_v1 và quyền ------------------------------------------------------------------------------------------------
  v := public.aka_agent_campaign_repeat_state_v1(c_staff, ARRAY[v_c, v_d, v_s, v_plain]);
  INSERT INTO sim_result(step, ok, detail) VALUES ('5a state_v1: chỉ chiến dịch đang đăng ký lặp', jsonb_array_length(v) = 3, v);
  v := public.aka_agent_campaign_repeat_state_v1(1, ARRAY[v_c]);
  INSERT INTO sim_result(step, ok, detail) VALUES ('5b state_v1 của nhân viên khác: rỗng', v = '[]'::jsonb, v);
  INSERT INTO sim_result(step, ok, detail) SELECT '5c quyền: desktop không ghi được bộ đếm, không gọi được tick',
    NOT has_column_privilege('aka_agent_desktop', 'public.auto_campaigns', 'repeat_runs_done', 'UPDATE')
      AND NOT has_column_privilege('aka_agent_desktop', 'public.auto_campaigns', 'repeat_log', 'UPDATE')
      AND NOT has_function_privilege('aka_agent_desktop', 'public.aka_agent_campaign_repeat_tick_v1(integer)', 'EXECUTE')
      AND has_function_privilege('aka_agent_desktop', 'public.aka_agent_campaign_repeat_decide_v1(bigint,bigint)', 'EXECUTE')
      AND NOT has_function_privilege('anon', 'public.aka_agent_campaign_repeat_decide_v1(bigint,bigint)', 'EXECUTE')
      AND NOT has_function_privilege('authenticated', 'public.aka_agent_campaign_repeat_sync_v1(bigint,bigint)', 'EXECUTE'),
    NULL;
  -- Phiên Desktop thật của nhân viên 4 (nếu đã từng đăng nhập Desktop 9.x): chỉ chạm được chiến dịch của mình.
  SELECT du.auth_user_id INTO v_auth FROM private.aka_agent_desktop_users du WHERE du.staff_id = c_staff LIMIT 1;
  IF v_auth IS NOT NULL THEN
    PERFORM set_config('request.jwt.claims', json_build_object('role', 'aka_agent_desktop', 'sub', v_auth)::text, true);
    BEGIN
      EXECUTE 'SET LOCAL ROLE aka_agent_desktop';
      v := public.aka_agent_campaign_repeat_state_v1(c_staff, ARRAY[v_c]);
      v_txt := 'own_ok';
      BEGIN
        v2 := public.aka_agent_campaign_repeat_state_v1(1, ARRAY[v_c]);
        v_txt := v_txt || ',other_allowed';
      EXCEPTION WHEN insufficient_privilege THEN v_txt := v_txt || ',other_forbidden';
      END;
      EXECUTE 'RESET ROLE';
    EXCEPTION WHEN OTHERS THEN
      EXECUTE 'RESET ROLE';
      v_txt := 'error: ' || SQLERRM;
    END;
    PERFORM set_config('request.jwt.claims', '', true);
    INSERT INTO sim_result(step, ok, detail) VALUES ('5d phiên Desktop thật: đọc được chiến dịch của mình, chiến dịch người khác bị chặn',
      v_txt = 'own_ok,other_forbidden' AND jsonb_array_length(v) = 1, jsonb_build_object('result', v_txt, 'own', v));
  ELSE
    INSERT INTO sim_result(step, ok, detail) VALUES ('5d phiên Desktop: bỏ qua (nhân viên 4 chưa có phiên Desktop 9.x)', true, NULL);
  END IF;
END $sim$;

select json_build_object('checks', count(*), 'failed', count(*) filter (where not ok),
  'steps', json_agg(json_build_object('step', step, 'ok', ok, 'detail', detail) order by n)) from sim_result;
rollback;
