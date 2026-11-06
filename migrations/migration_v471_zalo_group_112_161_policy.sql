-- V471: policy riêng cho mã Zalo 112 và 161 khi nhắn hoặc chia sẻ tin vào nhóm.
-- Dữ liệu live akachat đọc ngày 06/11/2026. Chỉ DML: thêm 2 dòng auto_error.
-- Không đổi RPC/schema/ACL, không nạp lại schema PostgREST, không phát hành app.
--
-- Trước V471 cả hai mã rơi vào policy dự phòng err_zalo_api_business_failed:
-- ghi thất bại, trừ hạn mức, tính chuỗi mục tiêu lỗi, và mục tiêu bị gửi lại ở mọi
-- khung giờ. 7 ngày tới 06/11: 112 = 17.769 lần/7 tài khoản, 161 = 575 lần/6 tài khoản.
--   112: ghi thất bại; không trừ hạn mức; vẫn tính chuỗi mục tiêu lỗi; không tạm dừng
--        mục tiêu nên lần chạy sau vẫn thử lại. Nhiều lượt 112 xảy ra SAU khi file đã
--        vào được nhóm (chỉ phần chữ gửi bằng chia sẻ bị từ chối), nên không được pause.
--   161: "Nhóm này không tồn tại." ghi không tồn tại; không trừ hạn mức; không tính chuỗi
--        mục tiêu lỗi; input_effect=pause nên mục tiêu chuyển tạm dừng, các khung giờ và
--        ngày sau bỏ qua nó (mọi chỗ đặt lại mục tiêu đều bỏ qua 'tạm dừng').
-- Cả hai chỉ áp cho zalo_message_group (nhắn nhóm và chia sẻ vào nhóm); đổi tên gợi nhớ,
-- nhắn bạn bè/người lạ vẫn đi policy cũ.
--
-- Mỗi lượt chạy Zalo kiểm trước mọi dòng auto_error của zalo (Desktop/App Server:
-- actionResultRuntime.beginActionResultRun; chat-sync: CampaignActionResults.begin).
-- detail_status phải khớp đúng một auto_status và có status-policy đang bật, nếu không
-- mọi chiến dịch nhắn nhóm lỗi ngay khi bắt đầu. Migration lặp lại đúng phép kiểm đó
-- trước và sau khi ghi. Giải theo mã/tên, không hardcode ID.
-- Chạy lại khi đã đúng thì không ghi gì; dòng đã rollback (inactive) thì bật lại.
BEGIN;
SET LOCAL statement_timeout='15s';
SET LOCAL lock_timeout='3s';
DO $migration$
DECLARE
  c_action constant text := 'zalo_message_group';
  -- Toàn bộ cột trừ id/created_at/updated_at; so khớp nguyên dòng.
  policies constant jsonb[] := ARRAY[
    $v471${"is_active":true,"is_delete":false,"error_code":"err_zalo_112_message_group","error_type":"external zalo","error_name":"Zalo từ chối gửi nội dung vào nhóm (mã 112)","error_desc":"Áp dụng riêng zalo_message_group (nhắn và chia sẻ tin vào nhóm) khi Zalo trả mã 112; Zalo không nêu lý do. Thường gặp ở bước chia sẻ phần chữ sau khi file đã vào được nhóm. Ghi thất bại, không trừ hạn mức, vẫn tính chuỗi mục tiêu lỗi, không tạm dừng mục tiêu nên lần chạy sau vẫn thử lại. Lượt đã gửi được file vẫn trừ hạn mức theo app. Không áp dụng cho đổi tên gợi nhớ, nhắn bạn bè hoặc người lạ.","error_element":null,"noti_running_process":"Zalo từ chối gửi nội dung vào nhóm này (mã 112)","noti_campaign":"Zalo từ chối gửi nội dung vào nhóm này (mã 112)","update_status_account":null,"update_status_campaign":null,"update_login_status":null,"disable_action_codes":[],"time_disable_actions":null,"disable_action_mode":"fixed_minutes","disable_action_days":null,"disable_action_time":null,"count_consecutive_errors":null,"zalo_error_codes":["112"],"zalo_action_codes":["zalo_message_group"],"detail_status":"thất bại","detail_status_id":null,"detail_mode":null,"input_effect":null,"counts_toward_limit":false,"counts_toward_bad_target":true}$v471$::jsonb,
    $v471${"is_active":true,"is_delete":false,"error_code":"err_zalo_161_group_not_found","error_type":"external zalo","error_name":"Nhóm Zalo không còn tồn tại (mã 161)","error_desc":"Áp dụng riêng zalo_message_group khi Zalo trả mã 161 “Nhóm này không tồn tại.” (nhóm đã giải tán hoặc bị xoá). Ghi không tồn tại, không trừ hạn mức, không tính chuỗi mục tiêu lỗi. input_effect=pause chuyển mục tiêu sang tạm dừng nên các khung giờ và ngày sau không gửi lại; muốn gửi lại phải chuyển mục tiêu về chờ xử lý.","error_element":null,"noti_running_process":"Nhóm Zalo này không còn tồn tại (mã 161)","noti_campaign":"Nhóm Zalo này không còn tồn tại (mã 161)","update_status_account":null,"update_status_campaign":null,"update_login_status":null,"disable_action_codes":[],"time_disable_actions":null,"disable_action_mode":"fixed_minutes","disable_action_days":null,"disable_action_time":null,"count_consecutive_errors":null,"zalo_error_codes":["161"],"zalo_action_codes":["zalo_message_group"],"detail_status":"không tồn tại","detail_status_id":null,"detail_mode":null,"input_effect":"pause","counts_toward_limit":false,"counts_toward_bad_target":false}$v471$::jsonb
  ];
  -- Trạng thái mà mỗi detail_status phải giải ra, và phần status-policy hai dòng dựa vào.
  -- 112 không đặt input_effect nên kế thừa 'complete' của status-policy (thử lại lần sau).
  status_pins constant jsonb := $v471${
    "thất bại": {"code":"campaign_detail_failed","policy":{"is_active":true,"report_group":"failure","input_effect":"complete"}},
    "không tồn tại": {"code":"campaign_detail_not_found","policy":{"is_active":true,"report_group":"failure"}}
  }$v471$::jsonb;
  our_codes text[];
  zalo_codes text[];
  expected jsonb;
  pin jsonb;
  existing public.auto_error%ROWTYPE;
  current_state jsonb;
  st public.auto_status%ROWTYPE;
  effective jsonb;
  others_before text;
  others_after text;
  n integer;
  bad text;
BEGIN
  SELECT array_agg(DISTINCT p->>'error_code'), array_agg(DISTINCT z) INTO our_codes, zalo_codes
    FROM unnest(policies) p CROSS JOIN LATERAL jsonb_array_elements_text(p->'zalo_error_codes') z;

  -- 1. Hành động phải đang bật.
  PERFORM 1 FROM public.auto_account_actions
    WHERE code=c_action AND flatform_type='zalo' AND is_active AND NOT is_delete FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'V471: action % unavailable', c_action; END IF;

  -- 2. Như ActionStatusCatalog.statusForLegacyValue + selectPolicy: đúng một
  --    campaign_detail theo status_value cho zalo/all (đếm cả dòng tắt), đang bật,
  --    status-policy riêng của hành động (nếu chưa xoá) hoặc mặc định phải đang bật.
  FOREACH expected IN ARRAY policies LOOP
    pin := status_pins->(expected->>'detail_status');
    IF pin IS NULL THEN RAISE EXCEPTION 'V471: no status pin for "%"', expected->>'detail_status'; END IF;
    SELECT count(*) INTO n FROM public.auto_status
      WHERE component_type='campaign_detail' AND status_value=expected->>'detail_status'
        AND flatform_type IN ('all','zalo');
    IF n <> 1 THEN
      RAISE EXCEPTION 'V471: status value "%" matches % campaign_detail rows', expected->>'detail_status', n;
    END IF;
    SELECT * INTO STRICT st FROM public.auto_status
      WHERE component_type='campaign_detail' AND status_value=expected->>'detail_status'
        AND flatform_type IN ('all','zalo')
      FOR SHARE;
    IF NOT st.is_active OR st.is_delete OR st.code <> pin->>'code' THEN
      RAISE EXCEPTION 'V471: status "%" drift (code %, active %, deleted %)',
        expected->>'detail_status', st.code, st.is_active, st.is_delete;
    END IF;
    effective := NULL;
    SELECT to_jsonb(p) INTO effective FROM public.auto_account_action_status_policies p
      WHERE p.status_id=st.id AND (p.action_code=c_action OR p.action_code IS NULL) AND NOT p.is_delete
      ORDER BY (p.action_code IS NOT NULL) DESC LIMIT 1 FOR SHARE;
    IF effective IS NULL OR NOT (effective @> (pin->'policy')) THEN
      RAISE EXCEPTION 'V471: status policy drift for "%": %', expected->>'detail_status', effective;
    END IF;
  END LOOP;

  -- 3. Không policy nào khác đang xử lý 112/161 cho hành động này (cả dòng không giới
  --    hạn hành động). Cùng điều kiện khớp với resolver Desktop và chat-sync.
  SELECT string_agg(DISTINCT e.error_code, ', ') INTO bad
    FROM public.auto_error e CROSS JOIN unnest(zalo_codes) code
    WHERE e.is_active AND NOT e.is_delete
      AND (e.error_code=code OR code=ANY(e.zalo_error_codes))
      AND (cardinality(e.zalo_action_codes)=0 OR c_action=ANY(e.zalo_action_codes))
      AND e.error_code <> ALL(our_codes);
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'V471: another active policy already handles %/% (%)', zalo_codes, c_action, bad;
  END IF;

  -- 4. Sequence không được tụt sau max(id) (bài học V463).
  IF (SELECT last_value FROM public.auto_error_id_seq) < (SELECT coalesce(max(id),0) FROM public.auto_error) THEN
    RAISE EXCEPTION 'V471: auto_error_id_seq is behind max(id)';
  END IF;

  SELECT md5(coalesce(string_agg(to_jsonb(e)::text, ',' ORDER BY e.id), '')) INTO others_before
    FROM public.auto_error e WHERE e.error_code <> ALL(our_codes);

  -- 5. Thêm, hoặc bật lại dòng đã rollback; dòng khác nội dung là xung đột.
  FOREACH expected IN ARRAY policies LOOP
    SELECT * INTO existing FROM public.auto_error WHERE error_code=expected->>'error_code' FOR UPDATE;
    IF FOUND THEN
      current_state := to_jsonb(existing)-'id'-'created_at'-'updated_at';
      IF current_state = expected THEN
        NULL;
      ELSIF current_state = expected || '{"is_active":false}'::jsonb THEN
        UPDATE public.auto_error SET is_active=true, updated_at=clock_timestamp() WHERE id=existing.id;
      ELSE
        RAISE EXCEPTION 'V471: % collision or drift', expected->>'error_code';
      END IF;
    ELSE
      INSERT INTO public.auto_error (is_active, is_delete, error_code, error_type, error_name, error_desc, error_element, noti_running_process, noti_campaign, update_status_account, update_status_campaign, update_login_status, disable_action_codes, time_disable_actions, disable_action_mode, disable_action_days, disable_action_time, count_consecutive_errors, zalo_error_codes, zalo_action_codes, detail_status, detail_status_id, detail_mode, input_effect, counts_toward_limit, counts_toward_bad_target)
        SELECT p.is_active, p.is_delete, p.error_code, p.error_type, p.error_name, p.error_desc, p.error_element, p.noti_running_process, p.noti_campaign, p.update_status_account, p.update_status_campaign, p.update_login_status, p.disable_action_codes, p.time_disable_actions, p.disable_action_mode, p.disable_action_days, p.disable_action_time, p.count_consecutive_errors, p.zalo_error_codes, p.zalo_action_codes, p.detail_status, p.detail_status_id, p.detail_mode, p.input_effect, p.counts_toward_limit, p.counts_toward_bad_target
        FROM jsonb_populate_record(NULL::public.auto_error, expected) p;
    END IF;
  END LOOP;

  -- 6. Hậu kiểm.
  FOREACH expected IN ARRAY policies LOOP
    IF (SELECT to_jsonb(e)-'id'-'created_at'-'updated_at' FROM public.auto_error e
        WHERE error_code=expected->>'error_code') IS DISTINCT FROM expected THEN
      RAISE EXCEPTION 'V471: % postflight failed', expected->>'error_code';
    END IF;
  END LOOP;

  SELECT md5(coalesce(string_agg(to_jsonb(e)::text, ',' ORDER BY e.id), '')) INTO others_after
    FROM public.auto_error e WHERE e.error_code <> ALL(our_codes);
  IF others_after IS DISTINCT FROM others_before THEN
    RAISE EXCEPTION 'V471: other auto_error rows changed';
  END IF;

  -- Resolver (chat-sync SQL; Desktop cho cùng kết quả khi mỗi mã chỉ có một dòng
  -- khớp): nhóm nhận đúng dòng mới, hành động khác không bao giờ nhận dòng mới.
  SELECT string_agg(format('%s/%s -> %s', c.code, c.action, coalesce(r.error_code, 'fallback')), '; ') INTO bad
    FROM (VALUES
      ('112', c_action, 'err_zalo_112_message_group', true),
      ('161', c_action, 'err_zalo_161_group_not_found', true),
      ('112', 'zalo_change_alias', 'err_zalo_112_message_group', false),
      ('112', 'zalo_message_stranger', 'err_zalo_112_message_group', false),
      ('112', 'zalo_message_friend', 'err_zalo_112_message_group', false),
      ('161', 'zalo_message_friend', 'err_zalo_161_group_not_found', false)
    ) c(code, action, ours, must_match)
    LEFT JOIN LATERAL (
      SELECT e.error_code FROM public.auto_error e
      WHERE (e.error_code=c.code OR c.code=ANY(e.zalo_error_codes))
        AND e.is_active AND NOT e.is_delete
        AND (cardinality(e.zalo_action_codes)=0 OR c.action=ANY(e.zalo_action_codes))
      ORDER BY (c.action=ANY(e.zalo_action_codes)) DESC, (e.error_code=c.code) DESC, e.id
      LIMIT 1
    ) r ON true
    WHERE (c.must_match AND r.error_code IS DISTINCT FROM c.ours)
       OR (NOT c.must_match AND r.error_code IS NOT DISTINCT FROM c.ours);
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'V471: resolver postflight failed: %', bad; END IF;

  -- Lặp lại phép kiểm lúc bắt đầu lượt chạy cho zalo_message_group trên mọi dòng
  -- lỗi đang bật của zalo/system: nếu dòng nào hỏng thì chiến dịch nhắn nhóm không
  -- chạy được, nên phải dừng ở đây.
  SELECT string_agg(r.error_code, ', ') INTO bad
    FROM (
      SELECT e.error_code,
        CASE WHEN e.detail_mode='override'
          THEN (SELECT count(*) FROM public.auto_status s WHERE s.id=e.detail_status_id)
          ELSE (SELECT count(*) FROM public.auto_status s WHERE s.component_type='campaign_detail'
                  AND s.status_value=e.detail_status AND s.flatform_type IN ('all','zalo')) END AS matches,
        CASE WHEN e.detail_mode='override'
          THEN e.detail_status_id
          ELSE (SELECT min(s.id) FROM public.auto_status s WHERE s.component_type='campaign_detail'
                  AND s.status_value=e.detail_status AND s.flatform_type IN ('all','zalo')) END AS status_id
      FROM public.auto_error e
      WHERE e.is_active AND NOT e.is_delete
        AND (position('zalo' in e.error_type) > 0 OR e.error_type='system')
        AND (cardinality(e.zalo_action_codes)=0 OR c_action=ANY(e.zalo_action_codes))
        AND e.detail_mode IS DISTINCT FROM 'suppress'
        AND (e.detail_mode='override' OR e.detail_status IS NOT NULL)
    ) r
    LEFT JOIN public.auto_status s ON s.id=r.status_id
    WHERE r.matches <> 1 OR s.id IS NULL OR s.component_type <> 'campaign_detail'
       OR NOT s.is_active OR s.is_delete OR s.status_value IS NULL
       OR NOT coalesce((
         SELECT p.is_active FROM public.auto_account_action_status_policies p
         WHERE p.status_id=s.id AND (p.action_code=c_action OR p.action_code IS NULL) AND NOT p.is_delete
         ORDER BY (p.action_code IS NOT NULL) DESC LIMIT 1), false);
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'V471: run preflight would fail for %: %', c_action, bad; END IF;
END
$migration$;
COMMIT;
