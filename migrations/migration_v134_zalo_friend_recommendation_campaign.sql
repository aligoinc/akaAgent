-- Zalo API-only campaign: message/add friend to Zalo friend recommendations.
-- Targets are fetched once per campaign/account at runtime and materialized into auto_campaign_input_data.

BEGIN;

INSERT INTO public.auto_account_actions (flatform_type, name, code)
VALUES
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
    'zalo_resolve_friend_recommendation_target',
    'Chuẩn bị target Zalo từ UID đề xuất Zalo đã materialize.',
    'UserSearch',
    'data',
    'js',
    $block$
return await helpers.zaloResolveFriendRecommendationTarget({
  targetUid: vars.targetUid || vars.inputDataUid,
  targetName: vars.targetName || vars.inputDataName,
  inputData: vars.inputData
});
$block$,
    '[]'::jsonb,
    '[{"name":"zaloTarget","type":"json","label":"Zalo target"}]'::jsonb,
    '{}'::jsonb,
    true,
    NULL,
    NULL,
    now()
  ),
  (
    'zalo_send_friend_recommendation_message',
    'Gửi tin nhắn/attachment Zalo đến người trong danh sách đề xuất.',
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
    'zalo_send_friend_recommendation_friend_request',
    'Gửi lời mời kết bạn Zalo đến người trong danh sách đề xuất.',
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
  resolve_block_id bigint;
  message_block_id bigint;
  friend_block_id bigint;
  tag_block_id bigint;
  alias_block_id bigint;
  workflow_id bigint;
  test_workflow_id bigint;
BEGIN
  SELECT id INTO resolve_block_id FROM public.auto_blocks WHERE name = 'zalo_resolve_friend_recommendation_target';
  SELECT id INTO message_block_id FROM public.auto_blocks WHERE name = 'zalo_send_friend_recommendation_message';
  SELECT id INTO friend_block_id FROM public.auto_blocks WHERE name = 'zalo_send_friend_recommendation_friend_request';
  SELECT id INTO tag_block_id FROM public.auto_blocks WHERE name = 'zalo_apply_contact_tag';
  SELECT id INTO alias_block_id FROM public.auto_blocks WHERE name = 'zalo_change_contact_alias';

  IF resolve_block_id IS NULL OR message_block_id IS NULL OR friend_block_id IS NULL OR tag_block_id IS NULL OR alias_block_id IS NULL THEN
    RAISE EXCEPTION 'Cannot seed zalo_message_friend_recommendation workflow: missing Zalo block ids';
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
    'zalo_message_friend_recommendation',
    'Workflow browserless cho chiến dịch Zalo - Nhắn tin, kết bạn theo đề xuất Zalo.',
    jsonb_build_array(
      jsonb_build_object('id','resolve_recommendation','blockId',resolve_block_id,'blockName','zalo_resolve_friend_recommendation_target','position',jsonb_build_object('x',0,'y',0),'config',jsonb_build_object()),
      jsonb_build_object('id','send_message','blockId',message_block_id,'blockName','zalo_send_friend_recommendation_message','position',jsonb_build_object('x',260,'y',0),'config',jsonb_build_object()),
      jsonb_build_object('id','send_friend_request','blockId',friend_block_id,'blockName','zalo_send_friend_recommendation_friend_request','position',jsonb_build_object('x',520,'y',0),'config',jsonb_build_object()),
      jsonb_build_object('id','apply_tag','blockId',tag_block_id,'blockName','zalo_apply_contact_tag','position',jsonb_build_object('x',780,'y',0),'config',jsonb_build_object()),
      jsonb_build_object('id','change_alias','blockId',alias_block_id,'blockName','zalo_change_contact_alias','position',jsonb_build_object('x',1040,'y',0),'config',jsonb_build_object())
    ),
    jsonb_build_array(
      jsonb_build_object('id','e_resolve_message','source','resolve_recommendation','target','send_message'),
      jsonb_build_object('id','e_message_friend','source','send_message','target','send_friend_request'),
      jsonb_build_object('id','e_friend_tag','source','send_friend_request','target','apply_tag'),
      jsonb_build_object('id','e_tag_alias','source','apply_tag','target','change_alias')
    ),
    '[
      {"name":"targetUid","type":"string","label":"Target UID"},
      {"name":"targetName","type":"string","label":"Target name"},
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
    'zalo_message_friend_recommendation__test__zalo_message_friend_recommendation',
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
  WHERE name = 'zalo_message_friend_recommendation__test__zalo_message_friend_recommendation';

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
    'zalo_message_friend_recommendation',
    'Zalo - Nhắn tin, kết bạn theo đề xuất Zalo',
    'zalo',
    true,
    workflow_id,
    test_workflow_id,
    ARRAY['zalo_message_stranger','zalo_add_friend']::text[],
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
