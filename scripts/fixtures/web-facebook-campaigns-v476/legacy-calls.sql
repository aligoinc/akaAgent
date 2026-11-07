-- Caller cũ (không gửi token 'facebook'): mọi lời gọi của 6 hàm V476 vá. Chạy trước apply để chụp,
-- sau apply/rollback để so: phải giống hệt sau khi bỏ trường thay đổi theo thời điểm (checkedAt) và
-- hai khoá xác thực mới (capabilities.facebook, web_facebook_campaigns). Lời gọi có ghi (dừng/tiếp tục,
-- xoá, xác thực) chạy trong subtransaction rồi hoàn tác, nên chạy lại bao nhiêu lần cũng như nhau.
SET client_min_messages = warning;
CREATE SCHEMA IF NOT EXISTS v476_test;
RESET client_min_messages;
CREATE OR REPLACE FUNCTION v476_test.strip(p jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN jsonb_typeof(p) <> 'object' THEN p
    WHEN p ? 'desktopPresence' AND jsonb_typeof(p->'desktopPresence') = 'object'
      THEN jsonb_set(p, '{desktopPresence}', (p->'desktopPresence') - 'checkedAt')
    WHEN p ? 'capabilities' THEN (p - 'web_facebook_campaigns') || jsonb_build_object('capabilities', (p->'capabilities') - 'facebook')
    ELSE p END
$$;

CREATE OR REPLACE FUNCTION v476_test.legacy_results() RETURNS TABLE(name text, payload jsonb)
LANGUAGE plpgsql AS $fn$
DECLARE
  scopes constant jsonb := '{"legacy":["zalo","sms"],"desktop":["zalo","sms","zalo_qr","zalo_web"],
    "qr":["zalo_qr"],"web":["zalo_web"],"server":["zalo"],"sms":["sms"]}';
  filters constant jsonb := '{"none":{},"desktop":{"runtimeTargets":["desktop"]},"web":{"runtimeTargets":["web"]},
    "zalo":{"platforms":["zalo"]},"status":{"statuses":["tạm dừng","chờ xử lý"],"search":"cd"},
    "visibility":{"applyDisplaySettings":true}}';
  drafts constant jsonb := '[{"id":"draft-1","schedule":"2026-11-07T01:00:00Z","actionId":"facebook_group_post"}]';
  k text; f text; p text[]; v jsonb; c bigint; s record; t text;
BEGIN
  FOR k IN SELECT jsonb_object_keys(scopes) LOOP
    SELECT array_agg(x ORDER BY o) INTO p FROM jsonb_array_elements_text(scopes->k) WITH ORDINALITY AS y(x, o);
    FOR f IN SELECT jsonb_object_keys(filters) LOOP
      name := 'page:' || k || ':' || f;
      payload := public.aka_agent_control_campaign_page(201, 20, p, filters->f);
      RETURN NEXT;
    END LOOP;
    name := 'page:' || k || ':selection';
    payload := public.aka_agent_control_campaign_page(201, 20, p, '{}', p_selection => true);
    RETURN NEXT;
    name := 'page:' || k || ':selected-fb';
    payload := public.aka_agent_control_campaign_page(201, 20, p, '{}', 1, drafts, 3005);
    RETURN NEXT;
    name := 'page:' || k || ':selected-qr';
    payload := public.aka_agent_control_campaign_page(201, 20, p, '{}', 1, '[]', 3002);
    RETURN NEXT;
    name := 'page:' || k || ':ids';
    payload := public.aka_agent_control_campaign_page(201, 20, p, '{}', p_ids => ARRAY[3001,3002,3005,3006]::bigint[]);
    RETURN NEXT;
    name := 'snapshot:' || k || ':accounts';
    payload := v476_test.strip(public.aka_agent_control_account_snapshot(201, 20, p));
    RETURN NEXT;
    name := 'snapshot:' || k || ':details';
    payload := v476_test.strip(public.aka_agent_control_account_snapshot(201, 20, p, 'details', ARRAY[2001,2002,2005,2006]::bigint[]));
    RETURN NEXT;
    name := 'snapshot:' || k || ':campaigns';
    payload := v476_test.strip(public.aka_agent_control_account_snapshot(201, 20, p, 'campaigns',
      ARRAY[2001,2002,2003,2004,2005,2006,2009]::bigint[]));
    RETURN NEXT;
    name := 'activity:' || k;
    payload := public.aka_agent_control_desktop_activity(201, 20, p, NULL, 100);
    RETURN NEXT;
    name := 'activity:' || k || ':cursor';
    payload := public.aka_agent_control_desktop_activity(201, 20, p,
      (SELECT max(l.id) FROM public.auto_campaign_logs l), 100);
    RETURN NEXT;
  END LOOP;
  FOR s IN SELECT * FROM (VALUES (211::bigint, 21::bigint), (251, 25), (202, 20)) AS x(staff, org) LOOP
    name := 'page:staff' || s.staff;
    payload := public.aka_agent_control_campaign_page(s.staff, s.org, ARRAY['zalo','sms','zalo_qr','zalo_web']);
    RETURN NEXT;
    name := 'snapshot:staff' || s.staff;
    payload := v476_test.strip(public.aka_agent_control_account_snapshot(s.staff, s.org, ARRAY['zalo','sms','zalo_qr','zalo_web']));
    RETURN NEXT;
    name := 'activity:staff' || s.staff;
    payload := public.aka_agent_control_desktop_activity(s.staff, s.org, ARRAY['zalo','sms','zalo_qr','zalo_web']);
    RETURN NEXT;
  END LOOP;

  -- Dừng/tiếp tục Zalo Desktop (V461) và các ca bị từ chối: kết quả + dòng lịch sử (bỏ giờ).
  FOR s IN SELECT * FROM (VALUES
    (201::bigint, 20::bigint, 3002::bigint, 'tạm dừng'), (201, 20, 3002, 'chờ xử lý'), (201, 20, 3003, 'tạm dừng'),
    (201, 20, 3003, 'chờ xử lý'), (201, 20, 3001, 'tạm dừng'), (201, 20, 3004, 'tạm dừng'),
    (202, 20, 3002, 'tạm dừng'), (211, 20, 3002, 'tạm dừng')
  ) AS x(staff, org, campaign, target) LOOP
    BEGIN
      SELECT to_jsonb(r) INTO v FROM public.aka_agent_control_set_desktop_campaign_status(s.staff, s.org, s.campaign, s.target) r;
      SELECT regexp_replace(l.log, '^\d{2}:\d{2}:\d{2} \d{2}/\d{2}/\d{4} - ', '') INTO t
      FROM public.auto_campaign_logs l WHERE l.campaign_id = s.campaign ORDER BY l.id DESC LIMIT 1;
      v := v || jsonb_build_object('lastLog', t,
        'row', (SELECT jsonb_build_object('status', c2.status, 'claim', c2.runtime_claim_token, 'unit', c2.runtime_unit_token)
          FROM public.auto_campaigns c2 WHERE c2.id = s.campaign));
      RAISE EXCEPTION 'v476_test_undo';
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM <> 'v476_test_undo' THEN RAISE; END IF;
    END;
    name := 'status:' || s.staff || ':' || s.campaign || ':' || s.target;
    payload := v;
    RETURN NEXT;
  END LOOP;

  -- Xoá: Zalo Desktop còn lease, Zalo QR rảnh, Server, SMS, nhân viên khác.
  FOR s IN SELECT * FROM (VALUES (201::bigint, 20::bigint, 3003::bigint), (201, 20, 3002), (201, 20, 3001),
    (201, 20, 3004), (202, 20, 3002)) AS x(staff, org, campaign) LOOP
    BEGIN
      v := public.delete_control_campaign_atomic(s.staff, s.org, s.campaign)
        || jsonb_build_object('isDelete', (SELECT c2.is_delete FROM public.auto_campaigns c2 WHERE c2.id = s.campaign));
      RAISE EXCEPTION 'v476_test_undo';
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM <> 'v476_test_undo' THEN RAISE; END IF;
    END;
    name := 'delete:' || s.staff || ':' || s.campaign;
    payload := v;
    RETURN NEXT;
  END LOOP;

  -- Xác thực phiên (có thể thu hồi/cập nhật phiên nên luôn hoàn tác).
  FOR t IN SELECT unnest(ARRAY['h-201-web','h-201-native','h-211-web','h-211-pwa','h-211-native','h-211-other',
    'h-221-web','h-231-web','h-241-web','h-251-web','h-missing']) LOOP
    BEGIN
      v := v476_test.strip(public.aka_agent_authenticate_control_session(t))
        || jsonb_build_object('revoked', (SELECT cs.revoked_at IS NOT NULL FROM public.auto_control_sessions cs WHERE cs.token_hash = t));
      RAISE EXCEPTION 'v476_test_undo';
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM <> 'v476_test_undo' THEN RAISE; END IF;
    END;
    name := 'auth:' || t;
    payload := v;
    RETURN NEXT;
  END LOOP;
END
$fn$;
