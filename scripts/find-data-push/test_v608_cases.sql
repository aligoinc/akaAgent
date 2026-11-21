-- Kiểm thử V608 sau khi apply (chạy bằng scripts/find-data-push/test_v608.sh).
\set ON_ERROR_STOP on
SET client_min_messages = warning;

CREATE FUNCTION pg_temp.t_assert(ok boolean, msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS NOT TRUE THEN RAISE EXCEPTION 'FAIL: %', msg; END IF;
  RAISE NOTICE 'PASS: %', msg;
END $$;

-- Gọi hàm như phiên Desktop của nhân viên p_staff (SET ROLE aka_agent_desktop + GUC thay JWT).
CREATE FUNCTION pg_temp.t_push(p_staff bigint, p_payload jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v jsonb;
BEGIN
  PERFORM set_config('test.staff_id', p_staff::text, true);
  PERFORM set_config('role', 'aka_agent_desktop', true);
  v := public.aka_agent_find_data_push_v1(p_payload);
  PERFORM set_config('role', 'postgres', true);
  RETURN v;
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('role', 'postgres', true);
  RAISE;
END $$;

CREATE FUNCTION pg_temp.t_target(p_result jsonb, p_target bigint) RETURNS jsonb LANGUAGE sql AS $$
  SELECT t FROM jsonb_array_elements(p_result -> 'targets') AS t WHERE (t ->> 'targetCampaignId')::bigint = p_target LIMIT 1
$$;

SET client_min_messages = notice;

-- 1. Quy tắc + liên kết điền sẵn từ cấu hình cũ.
SELECT pg_temp.t_assert((SELECT count(*) FROM public.auto_campaign_data_link_rules) = 11, '11 quy tắc');
SELECT pg_temp.t_assert(
  (SELECT string_agg(l.target_campaign_id || ':' || l.status || ':' || COALESCE(l.block_reason, '-'), ',' ORDER BY l.target_campaign_id)
     FROM public.auto_campaign_data_links l JOIN public.auto_campaign_data_link_rules r ON r.id = l.rule_id
    WHERE l.source_campaign_id = 10 AND r.output_kind = 'facebook_uid')
  = '11:active:-,12:blocked:target_deleted,13:blocked:target_data_group_mode,14:blocked:target_other_owner,15:blocked:target_action_mismatch',
  'điền sẵn: trạng thái từng đích UID của nguồn 10 (bỏ chính nguồn, bỏ id trùng)');
SELECT pg_temp.t_assert(NOT EXISTS (SELECT 1 FROM public.auto_campaign_data_links WHERE source_campaign_id = 20 AND target_campaign_id = 11),
  'điền sẵn: khoá bật tắt (isFindUid=false) thì không liên kết');
SELECT pg_temp.t_assert(NOT EXISTS (SELECT 1 FROM public.auto_campaign_data_links WHERE source_campaign_id = 30),
  'điền sẵn: bỏ chiến dịch nguồn đã xoá');
SELECT pg_temp.t_assert((SELECT count(*) FROM public.auto_campaign_data_links WHERE source_campaign_id = 40) = 1,
  'điền sẵn: chiến dịch của nhân viên khác vẫn có liên kết của họ');

-- 2. Đẩy UID: thêm mới, bỏ data đã có ở đích, báo đích không nhận, mở lại đích "hoàn thành".
DO $$
DECLARE v jsonb; t jsonb;
BEGIN
  v := pg_temp.t_push(1, jsonb_build_object(
    'sourceCampaignId', 10, 'outputKind', 'facebook_uid', 'sourceDetailId', 555, 'sourceInputDataId', 66,
    'items', jsonb_build_array(
      jsonb_build_object('value', 'u1', 'key', 'u1', 'name', 'Người 1'),
      jsonb_build_object('value', 'u2', 'key', 'u2'),
      jsonb_build_object('value', 'U2 ', 'key', 'u2'),
      jsonb_build_object('value', 'u3', 'key', 'u3'),
      jsonb_build_object('value', 'u4', 'key', 'u4'),
      jsonb_build_object('value', '', 'key', 'x'),
      '"rác"'::jsonb)));
  t := pg_temp.t_target(v, 11);
  PERFORM pg_temp.t_assert((v ->> 'itemCount')::int = 4, 'bỏ dòng rỗng / rác / khoá trùng');
  PERFORM pg_temp.t_assert(t ->> 'status' = 'delivered' AND (t ->> 'inserted')::int = 3 AND (t ->> 'existing')::int = 1,
    'đích 11: thêm u1, u2, u4 (dòng u4 đã xoá không tính), bỏ u3 đã có');
  PERFORM pg_temp.t_assert((t ->> 'reopened')::boolean, 'đích 11 "hoàn thành" được mở lại');
  PERFORM pg_temp.t_assert(pg_temp.t_target(v, 12) ->> 'reason' = 'target_deleted', 'đích 12 đã xoá: blocked');
  PERFORM pg_temp.t_assert(pg_temp.t_target(v, 13) ->> 'reason' = 'target_data_group_mode', 'đích 13 chạy bằng Nhóm data: blocked');
  PERFORM pg_temp.t_assert(pg_temp.t_target(v, 14) ->> 'reason' = 'target_other_owner' AND pg_temp.t_target(v, 14) ->> 'targetCampaignName' IS NULL,
    'đích 14 của nhân viên khác: blocked, không lộ tên');
  PERFORM pg_temp.t_assert(pg_temp.t_target(v, 15) ->> 'reason' = 'target_action_mismatch', 'đích 15 sai loại chiến dịch: blocked');
END $$;
SELECT pg_temp.t_assert((SELECT status FROM public.auto_campaigns WHERE id = 11) = 'chờ xử lý'
  AND (SELECT completed_at FROM public.auto_campaigns WHERE id = 11) IS NULL, 'đích 11 về "chờ xử lý"');
SELECT pg_temp.t_assert((SELECT count(*) FROM public.auto_campaign_input_data WHERE campaign_id = 11 AND uid IN ('u1','u2','u4')
   AND status = 'chờ xử lý' AND note = 'Đã thêm từ chiến dịch "Nguồn A"' AND NOT is_delete) = 3, 'dòng mới ở đích 11 đúng trạng thái + ghi chú');
SELECT pg_temp.t_assert((SELECT name FROM public.auto_campaign_input_data WHERE campaign_id = 11 AND uid = 'u1') = 'Người 1', 'giữ tên');
SELECT pg_temp.t_assert((SELECT count(*) FROM public.auto_campaign_input_data WHERE campaign_id IN (12,13,14,15)) = 0, 'không thêm gì vào đích blocked');
SELECT pg_temp.t_assert(
  (SELECT count(*) FROM public.auto_campaign_data_link_deliveries d WHERE d.target_campaign_id = 11 AND d.result = 'inserted'
      AND d.target_input_data_id IS NOT NULL AND d.source_detail_id = 555 AND d.source_input_data_id = 66) = 3
  AND (SELECT count(*) FROM public.auto_campaign_data_link_deliveries d WHERE d.target_campaign_id = 11 AND d.result = 'existing') = 1,
  'sổ đẩy: 3 inserted (có id dòng đích, dòng Tìm data) + 1 existing');
SELECT pg_temp.t_assert((SELECT inserted_count = 3 AND existing_count = 1 AND last_push_at IS NOT NULL FROM public.auto_campaign_data_links
   WHERE source_campaign_id = 10 AND target_campaign_id = 11), 'bộ đếm liên kết');

-- 3. Đẩy lại cùng data: không thêm (idempotent).
DO $$
DECLARE v jsonb;
BEGIN
  v := pg_temp.t_push(1, '{"sourceCampaignId":10,"outputKind":"facebook_uid","items":[{"value":"u1","key":"u1"},{"value":"u2","key":"u2"}]}');
  PERFORM pg_temp.t_assert((pg_temp.t_target(v, 11) ->> 'inserted')::int = 0 AND (pg_temp.t_target(v, 11) ->> 'existing')::int = 2,
    'đẩy lại: 0 mới, 2 đã có');
  PERFORM pg_temp.t_assert(NOT (pg_temp.t_target(v, 11) ->> 'reopened')::boolean, 'không mở lại khi không thêm gì');
END $$;
SELECT pg_temp.t_assert((SELECT count(*) FROM public.auto_campaign_input_data WHERE campaign_id = 11 AND NOT is_delete) = 4, 'đích 11 vẫn 4 dòng');

-- 4. Hai nguồn khác nhau đẩy cùng group (khác cách viết, cùng khoá) vào một đích: chỉ một dòng.
DO $$
DECLARE v jsonb;
BEGIN
  v := pg_temp.t_push(1, '{"sourceCampaignId":20,"outputKind":"facebook_group","items":[{"value":"https://www.facebook.com/groups/abc/","key":"facebook.com/groups/abc","name":"Nhóm ABC"}]}');
  PERFORM pg_temp.t_assert((pg_temp.t_target(v, 21) ->> 'inserted')::int = 1, 'nguồn B thêm group abc vào đích 21');
  v := pg_temp.t_push(1, '{"sourceCampaignId":22,"outputKind":"facebook_group","items":[{"value":"https://facebook.com/groups/abc","key":"facebook.com/groups/abc"}]}');
  PERFORM pg_temp.t_assert((pg_temp.t_target(v, 21) ->> 'inserted')::int = 0 AND (pg_temp.t_target(v, 21) ->> 'existing')::int = 1,
    'nguồn C đẩy cùng group (khác cách viết): không thêm trùng');
END $$;
SELECT pg_temp.t_assert((SELECT count(*) FROM public.auto_campaign_input_data WHERE campaign_id = 21) = 1, 'đích 21 có đúng 1 dòng');

-- 5. Khoá bật tắt: isFindUid=false thì nguồn 20 không đẩy UID dù có id đích.
DO $$
DECLARE v jsonb;
BEGIN
  v := pg_temp.t_push(1, '{"sourceCampaignId":20,"outputKind":"facebook_uid","items":[{"value":"u9","key":"u9"}]}');
  PERFORM pg_temp.t_assert(jsonb_array_length(v -> 'targets') = 0, 'loại đầu ra đang tắt: không đẩy');
END $$;

-- 6. SĐT: khớp theo normalize_phone (đã có 0912345678, gửi +84 912 345 678).
DO $$
DECLARE v jsonb;
BEGIN
  v := pg_temp.t_push(1, '{"sourceCampaignId":10,"outputKind":"phone","items":[{"value":"+84 912 345 678","key":"0912345678"},{"value":"0987654321","key":"0987654321","name":"Khách"}]}');
  PERFORM pg_temp.t_assert((pg_temp.t_target(v, 17) ->> 'inserted')::int = 1 AND (pg_temp.t_target(v, 17) ->> 'existing')::int = 1,
    'SĐT khác cách viết được coi là đã có; số mới được thêm vào cột phone');
END $$;
SELECT pg_temp.t_assert((SELECT phone FROM public.auto_campaign_input_data WHERE campaign_id = 17 AND name = 'Khách') = '0987654321'
  AND (SELECT uid FROM public.auto_campaign_input_data WHERE campaign_id = 17 AND name = 'Khách') IS NULL, 'SĐT ghi vào cột phone');

-- 7. Gói dịch vụ: allowedTargetActionIds không có loại đích thì blocked.
DO $$
DECLARE v jsonb;
BEGIN
  v := pg_temp.t_push(1, '{"sourceCampaignId":10,"outputKind":"post_link","allowedTargetActionIds":["facebook_message_uid"],"items":[{"value":"https://fb.com/p/1","key":"fb.com/p/1"}]}');
  PERFORM pg_temp.t_assert(pg_temp.t_target(v, 16) ->> 'reason' = 'target_not_entitled', 'đích không có quyền theo gói: blocked');
  v := pg_temp.t_push(1, '{"sourceCampaignId":10,"outputKind":"post_link","allowedTargetActionIds":["facebook_comment_seeding_post"],"items":[{"value":"https://fb.com/p/1","key":"fb.com/p/1"}]}');
  PERFORM pg_temp.t_assert((pg_temp.t_target(v, 16) ->> 'inserted')::int = 1, 'có quyền thì thêm');
END $$;
SELECT pg_temp.t_assert((SELECT status FROM public.auto_campaign_data_links WHERE source_campaign_id = 10 AND target_campaign_id = 16) = 'active',
  'liên kết blocked trở lại active khi đích nhận được');

-- 8. Bỏ đích khỏi cấu hình: liên kết thành removed.
UPDATE public.auto_campaigns SET extra_settings = jsonb_set(extra_settings, '{findUidTargetCampaignIds}', '[11]') WHERE id = 10;
DO $$
DECLARE v jsonb;
BEGIN
  v := pg_temp.t_push(1, '{"sourceCampaignId":10,"outputKind":"facebook_uid","items":[{"value":"u1","key":"u1"}]}');
  PERFORM pg_temp.t_assert(jsonb_array_length(v -> 'targets') = 1, 'chỉ còn đích 11');
END $$;
SELECT pg_temp.t_assert((SELECT count(*) FROM public.auto_campaign_data_links l JOIN public.auto_campaign_data_link_rules r ON r.id = l.rule_id
   WHERE l.source_campaign_id = 10 AND r.output_kind = 'facebook_uid' AND l.status = 'removed') = 4, '4 liên kết bị bỏ thành removed');

-- 9. Lỗi: không phải phiên Desktop, nguồn của người khác, payload sai, quá nhiều data.
DO $$
BEGIN
  BEGIN
    PERFORM public.aka_agent_find_data_push_v1('{"sourceCampaignId":10,"outputKind":"facebook_uid","items":[]}');
    RAISE EXCEPTION 'FAIL: gọi ngoài phiên Desktop phải lỗi';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS: ngoài phiên Desktop bị từ chối';
  END;
  BEGIN
    PERFORM pg_temp.t_push(2, '{"sourceCampaignId":10,"outputKind":"facebook_uid","items":[]}');
    RAISE EXCEPTION 'FAIL: nguồn của người khác phải lỗi';
  EXCEPTION WHEN no_data_found THEN RAISE NOTICE 'PASS: nguồn của nhân viên khác: find_data_push_source_not_found';
  END;
  BEGIN
    PERFORM pg_temp.t_push(1, '{"sourceCampaignId":11,"outputKind":"facebook_uid","items":[]}');
    RAISE EXCEPTION 'FAIL: nguồn không phải chiến dịch tìm data phải lỗi';
  EXCEPTION WHEN no_data_found THEN RAISE NOTICE 'PASS: nguồn không phải chiến dịch tìm data bị từ chối';
  END;
  BEGIN
    PERFORM pg_temp.t_push(1, '{"sourceCampaignId":10,"outputKind":"email","items":[]}');
    RAISE EXCEPTION 'FAIL: outputKind lạ phải lỗi';
  EXCEPTION WHEN invalid_parameter_value THEN RAISE NOTICE 'PASS: outputKind lạ bị từ chối';
  END;
  BEGIN
    PERFORM pg_temp.t_push(1, jsonb_build_object('sourceCampaignId', 10, 'outputKind', 'facebook_uid',
      'items', (SELECT jsonb_agg(jsonb_build_object('value', 'v' || g, 'key', 'v' || g)) FROM generate_series(1, 5001) g)));
    RAISE EXCEPTION 'FAIL: quá 5000 data phải lỗi';
  EXCEPTION WHEN invalid_parameter_value THEN RAISE NOTICE 'PASS: quá 5000 data bị từ chối';
  END;
END $$;

-- 10. Quyền.
SELECT pg_temp.t_assert(NOT has_function_privilege('anon', 'public.aka_agent_find_data_push_v1(jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.aka_agent_find_data_push_v1(jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('service_role', 'public.aka_agent_find_data_push_v1(jsonb)', 'EXECUTE')
  AND has_function_privilege('aka_agent_desktop', 'public.aka_agent_find_data_push_v1(jsonb)', 'EXECUTE'), 'chỉ Desktop gọi được hàm');
SELECT pg_temp.t_assert(NOT has_table_privilege('aka_agent_desktop', 'public.auto_campaign_data_link_deliveries', 'SELECT')
  AND NOT has_table_privilege('aka_agent_desktop', 'public.auto_campaign_data_links', 'SELECT'), 'Desktop không đọc thẳng bảng');

-- 11. 2.000 data một lượt vào đích có sẵn 20.000 dòng: đo thời gian.
INSERT INTO public.auto_campaign_input_data (campaign_id, uid) SELECT 11, 'old' || g FROM generate_series(1, 20000) g;
ANALYZE public.auto_campaign_input_data;
DO $$
DECLARE v jsonb; t0 timestamptz := clock_timestamp(); ms numeric;
BEGIN
  v := pg_temp.t_push(1, jsonb_build_object('sourceCampaignId', 10, 'outputKind', 'facebook_uid',
    'items', (SELECT jsonb_agg(jsonb_build_object('value', CASE WHEN g % 2 = 0 THEN 'old' || g ELSE 'new' || g END,
                                                  'key', CASE WHEN g % 2 = 0 THEN 'old' || g ELSE 'new' || g END))
                FROM generate_series(1, 2000) g)));
  ms := extract(epoch FROM clock_timestamp() - t0) * 1000;
  PERFORM pg_temp.t_assert((pg_temp.t_target(v, 11) ->> 'inserted')::int = 1000 AND (pg_temp.t_target(v, 11) ->> 'existing')::int = 1000,
    format('2.000 data (1.000 đã có trong 20.000 dòng): thêm 1.000 trong %s ms', round(ms)));
  PERFORM pg_temp.t_assert(ms < 5000, 'dưới 5 giây');
END $$;
