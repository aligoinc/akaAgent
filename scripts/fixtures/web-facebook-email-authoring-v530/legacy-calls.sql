-- Caller cũ (không gửi token 'email', không gửi khoá mới): mọi lời gọi của 11 hàm v530 vá. Chạy trước apply để
-- chụp, sau apply/rollback để so: phải giống hệt sau khi bỏ trường thay đổi theo thời điểm/identity và các khoá
-- mới của v530 (capabilities.email, web_email_campaigns, authoring của chính sách Facebook). Lời gọi có ghi chạy
-- trong subtransaction rồi hoàn tác, nên chạy lại bao nhiêu lần cũng như nhau.
-- Không có trong tập này (hành vi đổi có chủ đích, kiểm ở assertions.sql): chiến dịch/tài khoản Email, sửa chiến dịch
-- Desktop còn lease khi app đang mở, patch extra_settings có khoá do bộ chạy sở hữu, gọi chéo nền tảng Facebook.
SET client_min_messages = warning;
CREATE SCHEMA IF NOT EXISTS v530_test;
RESET client_min_messages;

CREATE OR REPLACE FUNCTION v530_test.strip(p jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN jsonb_typeof(p) <> 'object' THEN p
    WHEN p ? 'desktopPresence' AND jsonb_typeof(p->'desktopPresence') = 'object'
      THEN jsonb_set(p, '{desktopPresence}', (p->'desktopPresence') - 'checkedAt')
    WHEN p ? 'capabilities' THEN (p - 'web_email_campaigns')
      || jsonb_build_object('capabilities', (p->'capabilities') - 'email')
      || CASE WHEN jsonb_typeof(p->'web_facebook_campaigns') = 'object'
        THEN jsonb_build_object('web_facebook_campaigns', (p->'web_facebook_campaigns') - 'authoring') ELSE '{}'::jsonb END
    WHEN p ? 'facebookOnlyLogin' THEN p - 'authoring'
    ELSE p END
$$;

-- Ảnh chụp chiến dịch + data sau một lời gọi ghi, bỏ trường theo thời điểm/identity.
CREATE OR REPLACE FUNCTION v530_test.campaign_state(p_campaign_id bigint) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'campaign', (SELECT to_jsonb(c) - 'id' - 'created_at' - 'updated_at' - 'log' FROM public.auto_campaigns c WHERE c.id = p_campaign_id),
    'inputs', COALESCE((SELECT jsonb_agg(to_jsonb(i) - 'id' - 'created_at' - 'campaign_id'
      ORDER BY i.control_append_row_index NULLS FIRST, i.name, i.phone, i.uid, i.email)
      FROM public.auto_campaign_input_data i WHERE i.campaign_id = p_campaign_id), '[]'::jsonb))
$$;

CREATE OR REPLACE FUNCTION v530_test.legacy_results() RETURNS TABLE(name text, payload jsonb)
LANGUAGE plpgsql AS $fn$
DECLARE
  scopes constant jsonb := '{"legacy":["zalo","sms"],"desktop":["zalo","sms","zalo_qr","zalo_web"],
    "facebook":["zalo","sms","zalo_qr","zalo_web","facebook"],"fbonly":["facebook"],"qr":["zalo_qr"],"web":["zalo_web"],
    "server":["zalo"],"sms":["sms"]}';
  filters constant jsonb := '{"none":{},"desktop":{"runtimeTargets":["desktop"]},"web":{"runtimeTargets":["web"]},
    "zalo":{"platforms":["zalo"]},"facebook":{"platforms":["facebook"]},"email":{"platforms":["email"]},
    "status":{"statuses":["tạm dừng","chờ xử lý"],"search":"cd"},"visibility":{"applyDisplaySettings":true}}';
  drafts constant jsonb := '[{"id":"draft-1","schedule":"2026-11-14T01:00:00Z","actionId":"email_send"}]';
  k text; f text; p text[]; v jsonb; s record; t text; id bigint;
BEGIN
  FOR k IN SELECT jsonb_object_keys(scopes) LOOP
    SELECT array_agg(x ORDER BY o) INTO p FROM jsonb_array_elements_text(scopes->k) WITH ORDINALITY AS y(x, o);
    FOR f IN SELECT jsonb_object_keys(filters) LOOP
      name := 'page:' || k || ':' || f;
      payload := public.aka_agent_control_campaign_page(301, 30, p, filters->f);
      RETURN NEXT;
    END LOOP;
    name := 'page:' || k || ':selection';
    payload := public.aka_agent_control_campaign_page(301, 30, p, '{}', p_selection => true);
    RETURN NEXT;
    name := 'page:' || k || ':selected-email';
    payload := public.aka_agent_control_campaign_page(301, 30, p, '{}', 1, drafts, 30008);
    RETURN NEXT;
    name := 'page:' || k || ':selected-fb';
    payload := public.aka_agent_control_campaign_page(301, 30, p, '{}', 1, '[]', 30005);
    RETURN NEXT;
    name := 'page:' || k || ':ids';
    payload := public.aka_agent_control_campaign_page(301, 30, p, '{}', p_ids => ARRAY[30001,30002,30005,30008,30009]::bigint[]);
    RETURN NEXT;
    name := 'snapshot:' || k || ':accounts';
    payload := v530_test.strip(public.aka_agent_control_account_snapshot(301, 30, p));
    RETURN NEXT;
    name := 'snapshot:' || k || ':details';
    payload := v530_test.strip(public.aka_agent_control_account_snapshot(301, 30, p, 'details', ARRAY[3001,3002,3005,3009]::bigint[]));
    RETURN NEXT;
    name := 'snapshot:' || k || ':campaigns';
    payload := v530_test.strip(public.aka_agent_control_account_snapshot(301, 30, p, 'campaigns',
      ARRAY[3001,3002,3003,3004,3005,3006,3009,3010]::bigint[]));
    RETURN NEXT;
    name := 'activity:' || k;
    payload := public.aka_agent_control_desktop_activity(301, 30, p, NULL, 100);
    RETURN NEXT;
    name := 'activity:' || k || ':cursor';
    payload := public.aka_agent_control_desktop_activity(301, 30, p, (SELECT max(l.id) FROM public.auto_campaign_logs l), 100);
    RETURN NEXT;
  END LOOP;
  FOR s IN SELECT * FROM (VALUES (302::bigint, 30::bigint), (311, 31), (341, 34), (303, 30)) AS x(staff, org) LOOP
    name := 'page:staff' || s.staff;
    payload := public.aka_agent_control_campaign_page(s.staff, s.org, ARRAY['zalo','sms','zalo_qr','zalo_web','facebook']);
    RETURN NEXT;
    name := 'snapshot:staff' || s.staff;
    payload := v530_test.strip(public.aka_agent_control_account_snapshot(s.staff, s.org, ARRAY['zalo','sms','zalo_qr','zalo_web','facebook']));
    RETURN NEXT;
    name := 'activity:staff' || s.staff;
    payload := public.aka_agent_control_desktop_activity(s.staff, s.org, ARRAY['zalo','sms','zalo_qr','zalo_web','facebook']);
    RETURN NEXT;
  END LOOP;

  -- Dừng/tiếp tục chiến dịch Desktop (V461/V476) và các ca bị từ chối: kết quả + dòng lịch sử (bỏ giờ).
  FOR s IN SELECT * FROM (VALUES
    (301::bigint, 30::bigint, 30002::bigint, 'tạm dừng'), (301, 30, 30002, 'chờ xử lý'), (301, 30, 30003, 'chờ xử lý'),
    (301, 30, 30001, 'tạm dừng'), (301, 30, 30004, 'tạm dừng'), (301, 30, 30005, 'chờ xử lý'), (301, 30, 30006, 'chờ xử lý'),
    (301, 30, 30007, 'tạm dừng'), (302, 30, 30005, 'tạm dừng')
  ) AS x(staff, org, campaign, target) LOOP
    BEGIN
      SELECT to_jsonb(r) INTO v FROM public.aka_agent_control_set_desktop_campaign_status(s.staff, s.org, s.campaign, s.target) r;
      SELECT regexp_replace(l.log, '^\d{2}:\d{2}:\d{2} \d{2}/\d{2}/\d{4} - ', '') INTO t
      FROM public.auto_campaign_logs l WHERE l.campaign_id = s.campaign ORDER BY l.id DESC LIMIT 1;
      v := v || jsonb_build_object('lastLog', t,
        'row', (SELECT jsonb_build_object('status', c2.status, 'claim', c2.runtime_claim_token, 'unit', c2.runtime_unit_token)
          FROM public.auto_campaigns c2 WHERE c2.id = s.campaign));
      RAISE EXCEPTION 'v530_test_undo';
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM <> 'v530_test_undo' THEN RAISE; END IF;
    END;
    name := 'status:' || s.staff || ':' || s.campaign || ':' || s.target;
    payload := v;
    RETURN NEXT;
  END LOOP;

  -- Xoá: Zalo Desktop còn lease, Zalo QR rảnh, Server, SMS, Facebook rảnh/còn claim, nhân viên khác.
  FOR s IN SELECT * FROM (VALUES (301::bigint, 30::bigint, 30003::bigint), (301, 30, 30002), (301, 30, 30001),
    (301, 30, 30004), (302, 30, 30002), (301, 30, 30005), (301, 30, 30006)) AS x(staff, org, campaign) LOOP
    BEGIN
      v := public.delete_control_campaign_atomic(s.staff, s.org, s.campaign)
        || jsonb_build_object('isDelete', (SELECT c2.is_delete FROM public.auto_campaigns c2 WHERE c2.id = s.campaign));
      RAISE EXCEPTION 'v530_test_undo';
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM <> 'v530_test_undo' THEN RAISE; END IF;
    END;
    name := 'delete:' || s.staff || ':' || s.campaign;
    payload := v;
    RETURN NEXT;
  END LOOP;

  -- Xác thực phiên (có thể thu hồi/cập nhật phiên nên luôn hoàn tác), cả bản chat_v2 của V490.
  FOR t IN SELECT unnest(ARRAY['h-301-web','h-301-native','h-304-web','h-311-web','h-311-pwa','h-311-native','h-311-other',
    'h-321-web','h-331-web','h-341-web','h-351-web','h-missing']) LOOP
    BEGIN
      v := v530_test.strip(public.aka_agent_authenticate_control_session(t))
        || jsonb_build_object('revoked', (SELECT cs.revoked_at IS NOT NULL FROM public.auto_control_sessions cs WHERE cs.token_hash = t));
      RAISE EXCEPTION 'v530_test_undo';
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM <> 'v530_test_undo' THEN RAISE; END IF;
    END;
    name := 'auth:' || t;
    payload := v;
    RETURN NEXT;
    BEGIN
      v := v530_test.strip(public.aka_agent_authenticate_control_session_chat_v2(t))
        || jsonb_build_object('revoked', (SELECT cs.revoked_at IS NOT NULL FROM public.auto_control_sessions cs WHERE cs.token_hash = t));
      RAISE EXCEPTION 'v530_test_undo';
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM <> 'v530_test_undo' THEN RAISE; END IF;
    END;
    name := 'auth_chat:' || t;
    payload := v;
    RETURN NEXT;
  END LOOP;
  FOR id IN SELECT unnest(ARRAY[1, 30, 34, 0]::bigint[]) LOOP
    name := 'facebook_policy:' || id;
    payload := v530_test.strip(public.aka_agent_control_web_facebook_campaigns_policy(id));
    RETURN NEXT;
  END LOOP;
  name := 'facebook_policy:null';
  payload := v530_test.strip(public.aka_agent_control_web_facebook_campaigns_policy(NULL));
  RETURN NEXT;

  -- Tạo chiến dịch Zalo/SMS (create_control_campaign_v2 gọi create_control_campaign) và các ca bị từ chối.
  FOR s IN SELECT * FROM (VALUES
    ('qr', 301::bigint, 30::bigint, 'k-qr', '{"accountId":3002,"actionId":"zalo_message_phone","name":" CD mới QR ","schedule":"2026-11-20T02:00:00Z","content":"Chào","extraSettings":{"enableMessage":true},"images":[],"webCampaignForm":"form_1"}'::jsonb,
      '[{"phone":"0901111111","name":"A"},{"phone":"0902222222","name":"B","info1":"x"}]'::jsonb, 'tạm dừng'),
    ('sms', 301, 30, 'k-sms', '{"accountId":3004,"actionId":"sms_send","name":"CD mới SMS","schedule":"2026-11-20T02:00:00Z","content":"SMS"}',
      '[{"phone":"0903333333","content":"SMS 1","phoneCarrier":"viettel"}]', 'chờ xử lý'),
    ('server', 301, 30, 'k-server', '{"accountId":3001,"actionId":"zalo_message_phone","name":"CD mới Server","scheduleType":"weekly","continueNextDay":true}',
      '[]', 'chờ xử lý'),
    ('cross', 301, 30, 'k-cross', '{"accountId":3004,"actionId":"zalo_message_phone","name":"Sai loại"}', '[]', 'chờ xử lý'),
    ('other-staff', 301, 30, 'k-other', '{"accountId":3023,"actionId":"zalo_message_phone","name":"TK nhân viên khác"}', '[]', 'chờ xử lý'),
    ('fb-deleted', 301, 30, 'k-fbdel', '{"accountId":3007,"actionId":"facebook_group_post","name":"FB đã xoá"}', '[]', 'chờ xử lý'),
    ('inactive-staff', 304, 30, 'k-inactive', '{"accountId":3002,"actionId":"zalo_message_phone","name":"x"}', '[]', 'chờ xử lý'),
    ('bad-status', 301, 30, 'k-bad', '{"accountId":3002,"actionId":"zalo_message_phone","name":"x"}', '[]', 'đang chạy')
  ) AS x(label, staff, org, idem, campaign, inputs, initial) LOOP
    BEGIN
      v := public.create_control_campaign_v2(s.staff, s.org, s.idem, s.campaign, s.inputs, s.initial);
      id := (v->>'campaign_id')::bigint;
      v := (v - 'campaign_id') || jsonb_build_object('state', v530_test.campaign_state(id),
        'replay', public.create_control_campaign_v2(s.staff, s.org, s.idem, s.campaign, s.inputs, s.initial) - 'campaign_id');
      RAISE EXCEPTION 'v530_test_undo';
    EXCEPTION
      WHEN raise_exception THEN
        IF SQLERRM <> 'v530_test_undo' THEN
          v := jsonb_build_object('error', SQLERRM);
        END IF;
    END;
    name := 'create:' || s.label;
    payload := v;
    RETURN NEXT;
  END LOOP;

  -- Sửa chiến dịch Zalo/SMS (không patch khoá do bộ chạy sở hữu, không sửa chiến dịch Desktop còn lease khi app mở).
  FOR s IN SELECT * FROM (VALUES
    ('qr-meta', 301::bigint, 30::bigint, 30002::bigint, '{"name":"CD QR sửa","content":"Nội dung mới","schedule":"2026-11-21T03:00:00Z"}'::jsonb, NULL::jsonb, NULL::text, NULL::integer),
    ('qr-extra', 301, 30, 30014, '{"extra_settings":{"enableMessage":false,"note":"x"},"images":[{"cloudUrl":"https://cdn.example.test/a.png"}]}', NULL, NULL, NULL),
    ('qr-status-ignored', 301, 30, 30014, '{"status":"hoàn thành","name":"CD Zalo nhận SĐT 2"}', NULL, NULL, NULL),
    ('sms-status', 301, 30, 30004, '{"status":"tạm dừng","content":"SMS mới"}', NULL, NULL, NULL),
    ('server-lease-app-alive', 301, 30, 30001, '{"content":"Server mới","continue_next_day":true}', NULL, NULL, NULL),
    ('qr-302-lease-app-off', 302, 30, 30023, '{"name":"CD QR 302 sửa","extra_settings":{"enableMessage":true}}', NULL, NULL, NULL),
    ('qr-append', 301, 30, 30014, '{"name":"CD có append"}', '[{"phone":"0904444444","name":"C"}]', 'append-key-1', 0),
    ('qr-reassign-server', 301, 30, 30002, '{"account_id":3001}', NULL, NULL, NULL),
    ('qr-reassign-qr', 301, 30, 30014, '{"account_id":3002}', NULL, NULL, NULL),
    ('other-staff', 302, 30, 30002, '{"name":"x"}', NULL, NULL, NULL),
    ('bad-action', 301, 30, 30002, '{"action_id":"sms_send"}', NULL, NULL, NULL)
  ) AS x(label, staff, org, campaign, patch, append_inputs, append_key, expected_count) LOOP
    BEGIN
      v := public.update_control_campaign_atomic(s.staff, s.org, s.campaign,
        (SELECT c.updated_at FROM public.auto_campaigns c WHERE c.id = s.campaign), s.patch, NULL, false,
        s.append_key, s.expected_count, s.append_inputs);
      v := (v - 'updated_at') || jsonb_build_object('state', v530_test.campaign_state(s.campaign));
      RAISE EXCEPTION 'v530_test_undo';
    EXCEPTION
      WHEN raise_exception THEN
        IF SQLERRM <> 'v530_test_undo' THEN
          v := jsonb_build_object('error', SQLERRM);
        END IF;
    END;
    name := 'update:' || s.label;
    payload := v;
    RETURN NEXT;
  END LOOP;
  BEGIN
    v := public.update_control_campaign_atomic(301, 30, 30002, now() - interval '1 year', '{"name":"x"}');
  END;
  name := 'update:version-conflict';
  payload := v;
  RETURN NEXT;
  BEGIN
    v := public.update_control_campaign_by_config_version_atomic(301, 30, 30002, now() - interval '1 year',
      jsonb_build_object('name', 'Theo phiên bản cấu hình', '_expected_config_version',
        (SELECT public.aka_agent_campaign_config_version(c) FROM public.auto_campaigns c WHERE c.id = 30002)));
    v := (v - 'updated_at') || jsonb_build_object('state', v530_test.campaign_state(30002));
    RAISE EXCEPTION 'v530_test_undo';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'v530_test_undo' THEN RAISE; END IF;
  END;
  name := 'update_by_config:qr';
  payload := v;
  RETURN NEXT;

  -- Thêm data Zalo/SMS.
  FOR s IN SELECT * FROM (VALUES
    ('qr', 301::bigint, 30::bigint, 30014::bigint, 'add-1', 0, '[{"phone":"0905555555","name":"D"}]'::jsonb, 'chờ xử lý'),
    ('sms', 301, 30, 30004, 'add-2', 1, '[{"phone":"0906666666","content":"x"}]', 'tạm dừng'),
    ('count-conflict', 301, 30, 30004, 'add-3', 9, '[{"phone":"0906666666"}]', 'chờ xử lý'),
    ('other-staff', 302, 30, 30014, 'add-4', 0, '[{"phone":"0906666666"}]', 'chờ xử lý')
  ) AS x(label, staff, org, campaign, idem, expected_count, inputs, status) LOOP
    BEGIN
      v := public.add_control_campaign_input_rows(s.staff, s.org, s.campaign, s.idem, s.expected_count, s.inputs,
        '2026-11-22T01:00:00Z'::timestamptz, s.status);
      v := v || jsonb_build_object('state', v530_test.campaign_state(s.campaign));
      RAISE EXCEPTION 'v530_test_undo';
    EXCEPTION
      WHEN raise_exception THEN
        IF SQLERRM <> 'v530_test_undo' THEN
          v := jsonb_build_object('error', SQLERRM);
        END IF;
    END;
    name := 'add_rows:' || s.label;
    payload := v;
    RETURN NEXT;
  END LOOP;
END
$fn$;
