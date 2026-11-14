-- V531: Desktop chọn trước câu comment cho từng lượt up tin Facebook.
--
-- Bối cảnh (đo 14/11/2026): "Kiêm up tin" ở chế độ tạo mới sinh một chiến dịch up tin (facebook_comment_seeding_post)
-- cho mỗi tài khoản. Câu comment lấy qua aka_agent_take_campaign_content_index (V350), con trỏ nằm ở từng chiến dịch
-- (auto_campaigns.content_rotation_indexes) và cùng bắt đầu từ 0, nên các tài khoản up cùng một bài comment cùng một câu
-- (127/213 bài up từ nhiều tài khoản trong 3 ngày).
--
-- RPC V350 đã có sẵn nhánh dùng chỉ số ghi trên dòng data: dòng có khoá p_action_code trong
-- auto_campaign_input_data.content_rotation_indexes thì lấy đúng chỉ số đó (mod số câu) và không đụng con trỏ của
-- chiến dịch. Desktop cần ghi chỉ số này ngay lúc thêm dòng data up tin, nhưng aka_agent_desktop chỉ có quyền INSERT
-- theo từng cột và chưa có cột content_rotation_indexes.
--
-- Bản này chỉ GRANT INSERT (content_rotation_indexes) cho aka_agent_desktop. Không đổi hàm, bảng, ràng buộc, policy,
-- quyền UPDATE, hay quyền của vai trò khác; không COMMENT (COMMENT kích pgrst_ddl_watch, GRANT thì không) nên PostgREST
-- không nạp lại schema. RLS giữ nguyên: policy RESTRICTIVE desktop_owned_resource vẫn chỉ cho chèn dòng data của
-- chiến dịch thuộc chính nhân viên. CHECK auto_campaign_input_data_content_rotation_indexes_object vẫn ép kiểu object;
-- giá trị không phải số nguyên không âm thì RPC coi là 0.
-- Thứ tự: apply trước khi phát hành Desktop có bản sửa. Desktop gặp lỗi quyền (42501) khi chèn cột này thì tự chèn lại
-- không có cột (hành vi cũ), nên thứ tự sai cũng không làm hỏng việc thêm lượt up tin.
-- Số: V530 thuộc nhánh claude_tao-sua-chien-dich-facebook-email_from_dev_3_14_11 (wip, chưa apply).
-- Rollback: migrations/rollback_v531_post_bump_content_rotation_desktop.sql
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $preflight$
DECLARE
  v_fn regprocedure := to_regprocedure(
    'public.aka_agent_take_campaign_content_index(bigint,bigint,bigint,text,uuid,uuid,bigint,text,integer)');
BEGIN
  IF to_regrole('aka_agent_desktop') IS NULL THEN
    RAISE EXCEPTION 'v531_desktop_role_missing';
  END IF;
  IF v_fn IS NULL THEN
    RAISE EXCEPTION 'v531_content_index_rpc_missing';
  END IF;
  -- Đúng thân V350 đang chạy lúc soạn (14/11/2026): nhánh "dòng data đã có chỉ số" là điều bản sửa dựa vào.
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = v_fn) IS DISTINCT FROM 'df449a2b2eb195ddb3110edc4633ddfa' THEN
    RAISE EXCEPTION 'v531_content_index_rpc_body_unexpected';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'public.auto_campaign_input_data'::regclass AND attname = 'content_rotation_indexes'
      AND NOT attisdropped AND atttypid = 'jsonb'::regtype AND attnotnull
  ) THEN
    RAISE EXCEPTION 'v531_rotation_column_unexpected';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.auto_campaign_input_data'::regclass
      AND conname = 'auto_campaign_input_data_content_rotation_indexes_object'
  ) THEN
    RAISE EXCEPTION 'v531_rotation_check_missing';
  END IF;
  IF has_column_privilege('aka_agent_desktop', 'public.auto_campaign_input_data', 'content_rotation_indexes', 'INSERT') THEN
    RAISE EXCEPTION 'v531_already_applied_do_not_reapply';
  END IF;
  IF NOT has_column_privilege('aka_agent_desktop', 'public.auto_campaign_input_data', 'uid', 'INSERT') THEN
    RAISE EXCEPTION 'v531_desktop_insert_columns_unexpected';
  END IF;
END
$preflight$;

GRANT INSERT (content_rotation_indexes) ON public.auto_campaign_input_data TO aka_agent_desktop;

DO $postflight$
BEGIN
  IF NOT has_column_privilege('aka_agent_desktop', 'public.auto_campaign_input_data', 'content_rotation_indexes', 'INSERT') THEN
    RAISE EXCEPTION 'v531_desktop_cannot_insert_rotation';
  END IF;
  IF has_column_privilege('aka_agent_desktop', 'public.auto_campaign_input_data', 'content_rotation_indexes', 'UPDATE') THEN
    RAISE EXCEPTION 'v531_desktop_can_update_rotation';
  END IF;
  IF has_column_privilege('anon', 'public.auto_campaign_input_data', 'content_rotation_indexes', 'INSERT')
    OR has_column_privilege('authenticated', 'public.auto_campaign_input_data', 'content_rotation_indexes', 'INSERT') THEN
    RAISE EXCEPTION 'v531_public_roles_can_insert_rotation';
  END IF;
  IF (SELECT md5(prosrc) FROM pg_proc
      WHERE oid = 'public.aka_agent_take_campaign_content_index(bigint,bigint,bigint,text,uuid,uuid,bigint,text,integer)'::regprocedure)
    IS DISTINCT FROM 'df449a2b2eb195ddb3110edc4633ddfa' THEN
    RAISE EXCEPTION 'v531_content_index_rpc_body_changed';
  END IF;
END
$postflight$;

COMMIT;
