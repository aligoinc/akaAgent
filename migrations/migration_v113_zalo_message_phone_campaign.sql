-- Zalo API-only campaign: "Zalo - Nhắn tin, kết bạn đến SĐT".
-- Adds campaign input metadata columns, open-ended detail statuses, Zalo error
-- policies, and a browserless workflow that delegates to main-process helpers.

BEGIN;

ALTER TABLE public.auto_campaign_input_data
  ADD COLUMN IF NOT EXISTS info1 text,
  ADD COLUMN IF NOT EXISTS info2 text,
  ADD COLUMN IF NOT EXISTS info3 text,
  ADD COLUMN IF NOT EXISTS info4 text,
  ADD COLUMN IF NOT EXISTS info5 text;

COMMENT ON COLUMN public.auto_campaign_input_data.info1 IS 'Extra template column Info1 imported from campaign Excel input.';
COMMENT ON COLUMN public.auto_campaign_input_data.info2 IS 'Extra template column Info2 imported from campaign Excel input.';
COMMENT ON COLUMN public.auto_campaign_input_data.info3 IS 'Extra template column Info3 imported from campaign Excel input.';
COMMENT ON COLUMN public.auto_campaign_input_data.info4 IS 'Extra template column Info4 imported from campaign Excel input.';
COMMENT ON COLUMN public.auto_campaign_input_data.info5 IS 'Extra template column Info5 imported from campaign Excel input.';

ALTER TABLE public.auto_campaign_details
  DROP CONSTRAINT IF EXISTS auto_campaign_details_status_check,
  DROP CONSTRAINT IF EXISTS auto_campaign_result_actions_status_check;

COMMENT ON COLUMN public.auto_campaign_details.status IS
  'Open-ended user-facing action status. Facebook currently uses thành công/thất bại/lỗi; Zalo may store statuses such as không tồn tại.';

ALTER TABLE public.auto_error
  ADD COLUMN IF NOT EXISTS zalo_error_codes text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS detail_status text,
  ADD COLUMN IF NOT EXISTS counts_toward_limit boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS counts_toward_bad_target boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS update_login_status text;

CREATE INDEX IF NOT EXISTS idx_auto_error_zalo_error_codes
  ON public.auto_error USING gin (zalo_error_codes)
  WHERE is_delete = false;

COMMENT ON COLUMN public.auto_error.zalo_error_codes IS
  'zca-js/Zalo API error codes that map to this normalized policy.';
COMMENT ON COLUMN public.auto_error.detail_status IS
  'Status to write to auto_campaign_details.status. If NULL, no detail row is created for this policy.';
COMMENT ON COLUMN public.auto_error.counts_toward_limit IS
  'Whether this policy should increment auto_account_action_status counters when logged by Zalo runtime.';
COMMENT ON COLUMN public.auto_error.counts_toward_bad_target IS
  'Whether this policy should increment campaign-level consecutive bad target counters.';
COMMENT ON COLUMN public.auto_error.update_login_status IS
  'Optional auto_accounts.login_status update, e.g. chưa đăng nhập for invalid Zalo sessions.';

INSERT INTO public.auto_account_actions (flatform_type, name, code)
VALUES
  ('zalo', 'Zalo - Tìm SĐT', 'zalo_find_phone_user'),
  ('zalo', 'Zalo - Gửi tin nhắn đến bạn bè', 'zalo_message_friend'),
  ('zalo', 'Zalo - Gửi tin nhắn đến người lạ', 'zalo_message_stranger'),
  ('zalo', 'Zalo - Kết bạn', 'zalo_add_friend'),
  ('zalo', 'Zalo - Gắn tag', 'zalo_tag_contact'),
  ('zalo', 'Zalo - Đổi tên', 'zalo_change_alias')
ON CONFLICT (code) DO UPDATE SET
  flatform_type = EXCLUDED.flatform_type,
  name = EXCLUDED.name,
  is_active = true,
  is_delete = false,
  updated_at = now();

INSERT INTO public.auto_error (
  error_type,
  error_name,
  error_desc,
  error_code,
  error_element,
  noti_running_process,
  noti_campaign,
  update_status_account,
  update_status_campaign,
  disable_action_codes,
  time_disable_actions,
  count_consecutive_errors,
  zalo_error_codes,
  detail_status,
  counts_toward_limit,
  counts_toward_bad_target,
  update_login_status
)
VALUES
  ('external zalo', 'Zalo không tồn tại', 'Không tìm thấy user Zalo hợp lệ từ SĐT/user id', 'err_zalo_user_not_found', NULL, 'Không tồn tại', 'Không tồn tại', NULL, NULL, '{}'::text[], NULL, NULL, ARRAY['216','214','212']::text[], 'không tồn tại', true, false, NULL),
  ('external zalo', 'Tham số không hợp lệ', 'Zalo trả lỗi tham số không hợp lệ', 'err_zalo_invalid_param', NULL, 'Tham số không hợp lệ', 'Tham số không hợp lệ', NULL, NULL, '{}'::text[], NULL, NULL, ARRAY['114']::text[], 'thất bại', true, true, NULL),
  ('external zalo', 'Đạt giới hạn tìm SĐT', 'Zalo trả lỗi đạt giới hạn tìm kiếm số điện thoại', 'err_zalo_find_phone_limit', NULL, 'Đạt giới hạn tìm kiếm SĐT', 'Đạt giới hạn tìm kiếm SĐT, tạm nghỉ [x] phút', NULL, NULL, ARRAY['zalo_find_phone_user']::text[], 60, NULL, ARRAY['312','313','304','221']::text[], NULL, true, false, NULL),
  ('external zalo', 'Người nhận chặn tin nhắn người lạ', 'Người nhận không nhận tin nhắn từ người lạ', 'err_zalo_receiver_blocks_stranger_message', NULL, 'Người nhận chặn tin nhắn từ người lạ', 'Người nhận chặn tin nhắn từ người lạ', NULL, NULL, '{}'::text[], NULL, NULL, ARRAY['122']::text[], 'thất bại', true, false, NULL),
  ('external zalo', 'Người nhận chặn tin nhắn', 'Người nhận không muốn nhận tin nhắn từ tài khoản này', 'err_zalo_receiver_blocks_message', NULL, 'Người nhận chặn tin nhắn từ bạn', 'Người nhận chặn tin nhắn từ bạn', NULL, NULL, '{}'::text[], NULL, NULL, ARRAY['119']::text[], 'thất bại', true, false, NULL),
  ('external zalo', 'Hạn chế nhắn tin người lạ', 'Zalo hạn chế tài khoản gửi tin nhắn đến người lạ', 'err_zalo_message_stranger_limited', NULL, 'Zalo hạn chế gửi tin nhắn đến người lạ', 'Zalo hạn chế gửi tin nhắn đến người lạ, tạm nghỉ [x] phút', NULL, NULL, ARRAY['zalo_message_stranger']::text[], 60, NULL, ARRAY['120','802']::text[], 'thất bại', true, false, NULL),
  ('external zalo', 'Tin nhắn trùng lặp hoặc gửi quá nhanh', 'Zalo hạn chế do nội dung trùng lặp hoặc gửi quá nhanh', 'err_zalo_duplicate_or_fast_message', NULL, 'Tin nhắn bị trùng lặp hoặc gửi quá nhanh', 'Nội dung bị trùng lặp hoặc gửi quá nhanh, tạm nghỉ gửi tin [x] phút', NULL, NULL, ARRAY['zalo_message_friend','zalo_message_stranger']::text[], 30, NULL, ARRAY['123','126','127']::text[], 'thất bại', true, false, NULL),
  ('external zalo', 'Nội dung quá dài', 'Zalo trả lỗi nội dung quá dài', 'err_zalo_message_too_long', NULL, 'Nội dung quá dài', 'Nội dung quá dài, vui lòng sửa nội dung chiến dịch', NULL, 'tạm dừng', '{}'::text[], NULL, NULL, ARRAY['118']::text[], 'thất bại', true, true, NULL),
  ('external zalo', 'Yêu cầu kết bạn không thành công', 'Zalo trả lỗi yêu cầu kết bạn không thành công', 'err_zalo_add_friend_failed', NULL, 'Yêu cầu kết bạn không thành công', 'Yêu cầu kết bạn không thành công', NULL, NULL, '{}'::text[], NULL, NULL, ARRAY['311']::text[], 'thất bại', true, true, NULL),
  ('external zalo', 'Đã gửi lời mời kết bạn', 'Zalo báo lời mời kết bạn đã được gửi hoặc đang tồn tại', 'err_zalo_friend_request_sent', NULL, 'Đã gửi lời mời', 'Đã gửi lời mời', NULL, NULL, '{}'::text[], NULL, NULL, ARRAY['222']::text[], 'đã gửi lời mời', false, false, NULL),
  ('external zalo', 'Đã là bạn bè', 'Zalo báo user đã là bạn bè với tài khoản hiện tại', 'err_zalo_already_friend', NULL, 'Đã là bạn bè', 'Đã là bạn bè', NULL, NULL, '{}'::text[], NULL, NULL, ARRAY['225']::text[], 'đã là bạn bè', false, false, NULL),
  ('auth', 'Phiên đăng nhập Zalo không hợp lệ', 'Zalo session thiếu hoặc sai zpw_sek', 'err_zalo_session_invalid', NULL, 'Zalo đã bị đăng xuất, vui lòng đăng nhập lại', 'Zalo đã bị đăng xuất. Vui lòng đăng nhập lại để chiến dịch chạy tiếp', NULL, NULL, '{}'::text[], NULL, NULL, ARRAY['600']::text[], NULL, false, false, 'chưa đăng nhập'),
  ('external zalo', 'Đạt giới hạn mời người lạ vào group', 'Zalo trả lỗi đạt giới hạn mời người lạ vào group', 'err_zalo_group_invite_stranger_limit', NULL, 'Đạt giới hạn mời người lạ vào group', 'Đạt giới hạn mời người lạ vào group, tạm nghỉ [x] phút', NULL, NULL, ARRAY['zalo_add_group_member']::text[], 60, NULL, ARRAY['314']::text[], 'thất bại', true, false, NULL),
  ('external zalo', 'Thao tác Zalo thất bại', 'Fallback cho lỗi nghiệp vụ Zalo không có mã code', 'err_zalo_api_business_failed', NULL, NULL, NULL, NULL, NULL, '{}'::text[], NULL, NULL, '{}'::text[], 'thất bại', true, true, NULL)
ON CONFLICT (error_code) DO UPDATE SET
  error_type = EXCLUDED.error_type,
  error_name = EXCLUDED.error_name,
  error_desc = EXCLUDED.error_desc,
  error_element = EXCLUDED.error_element,
  noti_running_process = EXCLUDED.noti_running_process,
  noti_campaign = EXCLUDED.noti_campaign,
  update_status_account = EXCLUDED.update_status_account,
  update_status_campaign = EXCLUDED.update_status_campaign,
  disable_action_codes = EXCLUDED.disable_action_codes,
  time_disable_actions = EXCLUDED.time_disable_actions,
  count_consecutive_errors = EXCLUDED.count_consecutive_errors,
  zalo_error_codes = EXCLUDED.zalo_error_codes,
  detail_status = EXCLUDED.detail_status,
  counts_toward_limit = EXCLUDED.counts_toward_limit,
  counts_toward_bad_target = EXCLUDED.counts_toward_bad_target,
  update_login_status = EXCLUDED.update_login_status,
  is_active = true,
  is_delete = false,
  updated_at = now();

INSERT INTO public.auto_blocks (
  name,
  description,
  icon,
  category,
  kind,
  code,
  config_schema,
  output_schema,
  default_config,
  is_builtin,
  staff_id,
  organization_id,
  updated_at
)
VALUES
  (
    'zalo_find_phone_user',
    'Tìm tài khoản Zalo bằng số điện thoại trong campaign browserless.',
    'Search',
    'data',
    'js',
    $block$
return await helpers.zaloFindPhoneUser({
  phone: vars.targetPhone,
  inputData: vars.inputData,
  targetName: vars.inputDataName
});
$block$,
    '[]'::jsonb,
    '[{"name":"zaloTarget","type":"json","label":"Zalo target"},{"name":"found","type":"boolean","label":"Found"}]'::jsonb,
    '{}'::jsonb,
    true,
    NULL,
    NULL,
    now()
  ),
  (
    'zalo_send_phone_message',
    'Gửi tin nhắn/attachment Zalo đến user đã tìm được.',
    'MessageCircle',
    'data',
    'js',
    $block$
return await helpers.zaloSendPhoneMessage({
  target: input.zaloTarget,
  enabled: vars.enableMessage,
  message: vars.campaignContent,
  attachments: vars.images,
  inputData: vars.inputData
});
$block$,
    '[]'::jsonb,
    '[{"name":"messageResult","type":"json","label":"Message result"}]'::jsonb,
    '{}'::jsonb,
    true,
    NULL,
    NULL,
    now()
  ),
  (
    'zalo_send_phone_friend_request',
    'Gửi lời mời kết bạn Zalo đến user đã tìm được.',
    'UserPlus',
    'data',
    'js',
    $block$
return await helpers.zaloSendPhoneFriendRequest({
  target: input.zaloTarget,
  enabled: vars.enableAddFriend,
  message: vars.friendRequestMessage,
  inputData: vars.inputData
});
$block$,
    '[]'::jsonb,
    '[{"name":"friendRequestResult","type":"json","label":"Friend request result"}]'::jsonb,
    '{}'::jsonb,
    true,
    NULL,
    NULL,
    now()
  ),
  (
    'zalo_apply_contact_tag',
    'Gắn tag Zalo có sẵn cho user đã tìm được.',
    'Tag',
    'data',
    'js',
    $block$
return await helpers.zaloApplyContactTag({
  target: input.zaloTarget,
  enabled: vars.enableZaloTag,
  labelId: vars.zaloTagId,
  labelName: vars.zaloTagName
});
$block$,
    '[]'::jsonb,
    '[{"name":"tagResult","type":"json","label":"Tag result"}]'::jsonb,
    '{}'::jsonb,
    true,
    NULL,
    NULL,
    now()
  ),
  (
    'zalo_change_contact_alias',
    'Đổi tên gợi nhớ Zalo cho user đã tìm được.',
    'Pencil',
    'data',
    'js',
    $block$
return await helpers.zaloChangeContactAlias({
  target: input.zaloTarget,
  enabled: vars.enableZaloAlias,
  alias: vars.zaloAlias,
  inputData: vars.inputData
});
$block$,
    '[]'::jsonb,
    '[{"name":"aliasResult","type":"json","label":"Alias result"}]'::jsonb,
    '{}'::jsonb,
    true,
    NULL,
    NULL,
    now()
  )
ON CONFLICT (name) DO UPDATE SET
  description = EXCLUDED.description,
  icon = EXCLUDED.icon,
  category = EXCLUDED.category,
  kind = EXCLUDED.kind,
  code = EXCLUDED.code,
  config_schema = EXCLUDED.config_schema,
  output_schema = EXCLUDED.output_schema,
  default_config = EXCLUDED.default_config,
  is_builtin = true,
  updated_at = now();

DO $$
DECLARE
  find_block_id bigint;
  message_block_id bigint;
  friend_block_id bigint;
  tag_block_id bigint;
  alias_block_id bigint;
  workflow_id bigint;
  test_workflow_id bigint;
BEGIN
  SELECT id INTO find_block_id FROM public.auto_blocks WHERE name = 'zalo_find_phone_user';
  SELECT id INTO message_block_id FROM public.auto_blocks WHERE name = 'zalo_send_phone_message';
  SELECT id INTO friend_block_id FROM public.auto_blocks WHERE name = 'zalo_send_phone_friend_request';
  SELECT id INTO tag_block_id FROM public.auto_blocks WHERE name = 'zalo_apply_contact_tag';
  SELECT id INTO alias_block_id FROM public.auto_blocks WHERE name = 'zalo_change_contact_alias';

  IF find_block_id IS NULL OR message_block_id IS NULL OR friend_block_id IS NULL OR tag_block_id IS NULL OR alias_block_id IS NULL THEN
    RAISE EXCEPTION 'Cannot seed zalo_message_phone workflow: missing Zalo block ids';
  END IF;

  INSERT INTO public.auto_workflows (
    name,
    description,
    nodes,
    edges,
    variables_schema,
    default_variables,
    is_builtin,
    staff_id,
    organization_id,
    updated_at
  )
  VALUES (
    'zalo_message_phone',
    'Workflow browserless cho chiến dịch Zalo - Nhắn tin, kết bạn đến SĐT.',
    jsonb_build_array(
      jsonb_build_object('id','find_phone','blockId',find_block_id,'blockName','zalo_find_phone_user','position',jsonb_build_object('x',0,'y',0),'config',jsonb_build_object()),
      jsonb_build_object('id','send_message','blockId',message_block_id,'blockName','zalo_send_phone_message','position',jsonb_build_object('x',260,'y',0),'config',jsonb_build_object()),
      jsonb_build_object('id','send_friend_request','blockId',friend_block_id,'blockName','zalo_send_phone_friend_request','position',jsonb_build_object('x',520,'y',0),'config',jsonb_build_object()),
      jsonb_build_object('id','apply_tag','blockId',tag_block_id,'blockName','zalo_apply_contact_tag','position',jsonb_build_object('x',780,'y',0),'config',jsonb_build_object()),
      jsonb_build_object('id','change_alias','blockId',alias_block_id,'blockName','zalo_change_contact_alias','position',jsonb_build_object('x',1040,'y',0),'config',jsonb_build_object())
    ),
    jsonb_build_array(
      jsonb_build_object('id','e_find_message','source','find_phone','target','send_message'),
      jsonb_build_object('id','e_message_friend','source','send_message','target','send_friend_request'),
      jsonb_build_object('id','e_friend_tag','source','send_friend_request','target','apply_tag'),
      jsonb_build_object('id','e_tag_alias','source','apply_tag','target','change_alias')
    ),
    '[
      {"name":"targetPhone","type":"string","label":"Target phone"},
      {"name":"campaignContent","type":"string","label":"Message content"},
      {"name":"friendRequestMessage","type":"string","label":"Friend request message"},
      {"name":"enableMessage","type":"boolean","label":"Enable message"},
      {"name":"enableAddFriend","type":"boolean","label":"Enable add friend"},
      {"name":"enableZaloTag","type":"boolean","label":"Enable tag"},
      {"name":"enableZaloAlias","type":"boolean","label":"Enable alias"}
    ]'::jsonb,
    '{}'::jsonb,
    true,
    NULL,
    NULL,
    now()
  )
  ON CONFLICT (name) DO UPDATE SET
    description = EXCLUDED.description,
    nodes = EXCLUDED.nodes,
    edges = EXCLUDED.edges,
    variables_schema = EXCLUDED.variables_schema,
    default_variables = EXCLUDED.default_variables,
    is_builtin = true,
    updated_at = now()
  RETURNING id INTO workflow_id;

  INSERT INTO public.auto_workflows (
    name,
    description,
    nodes,
    edges,
    variables_schema,
    default_variables,
    is_builtin,
    staff_id,
    organization_id,
    updated_at
  )
  SELECT
    'zalo_message_phone__test__zalo_message_phone',
    description,
    nodes,
    edges,
    variables_schema,
    default_variables,
    false,
    staff_id,
    organization_id,
    now()
  FROM public.auto_workflows
  WHERE id = workflow_id
  ON CONFLICT (name) DO NOTHING;

  SELECT id INTO test_workflow_id
  FROM public.auto_workflows
  WHERE name = 'zalo_message_phone__test__zalo_message_phone';

  INSERT INTO public.auto_campaign_actions (
    id,
    name,
    flatform_type,
    is_active,
    workflow_id,
    test_workflow_id,
    limit_check_action_codes,
    is_delete,
    created_at
  )
  VALUES (
    'zalo_message_phone',
    'Zalo - Nhắn tin, kết bạn đến SĐT',
    'zalo',
    true,
    workflow_id,
    test_workflow_id,
    ARRAY['zalo_find_phone_user','zalo_message_stranger','zalo_add_friend']::text[],
    false,
    now()
  )
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    flatform_type = EXCLUDED.flatform_type,
    is_active = true,
    workflow_id = EXCLUDED.workflow_id,
    test_workflow_id = COALESCE(auto_campaign_actions.test_workflow_id, EXCLUDED.test_workflow_id),
    limit_check_action_codes = EXCLUDED.limit_check_action_codes,
    is_delete = false;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;
