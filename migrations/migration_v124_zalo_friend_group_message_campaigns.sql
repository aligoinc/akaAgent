-- Zalo API-only campaigns: message friends and groups.
-- Friend campaign can auto-materialize target data once, then send message,
-- optionally apply a Zalo tag and change alias via existing policy flow.

BEGIN;

INSERT INTO public.auto_account_actions (flatform_type, name, code)
VALUES
  ('zalo', 'Zalo - Gửi tin nhắn đến bạn bè', 'zalo_message_friend'),
  ('zalo', 'Zalo - Gửi tin nhắn đến group', 'zalo_message_group'),
  ('zalo', 'Zalo - Gắn tag', 'zalo_tag_contact'),
  ('zalo', 'Zalo - Đổi tên', 'zalo_change_alias')
ON CONFLICT (code) DO UPDATE SET
  flatform_type = EXCLUDED.flatform_type,
  name = EXCLUDED.name,
  is_active = true,
  is_delete = false,
  updated_at = now();

UPDATE public.auto_error
SET disable_action_codes = ARRAY['zalo_message_friend','zalo_message_stranger','zalo_message_group']::text[],
    updated_at = now()
WHERE error_code = 'err_zalo_duplicate_or_fast_message';

UPDATE public.auto_error
SET disable_action_codes = ARRAY['zalo_message_friend','zalo_message_group']::text[],
    updated_at = now()
WHERE error_code = 'err_zalo_receiver_blocks_message'
  AND COALESCE(array_length(disable_action_codes, 1), 0) > 0;

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
    'zalo_send_friend_message',
    'Gửi tin nhắn/attachment Zalo đến bạn bè từ campaign input data.',
    'MessageCircle',
    'data',
    'js',
    $block$
return await helpers.zaloSendFriendMessage({
  targetUid: vars.targetUid || vars.inputDataUid,
  targetName: vars.targetName || vars.inputDataName,
  message: vars.campaignContent,
  attachments: vars.images,
  inputData: vars.inputData
});
$block$,
    '[]'::jsonb,
    '[{"name":"zaloTarget","type":"json","label":"Zalo target"},{"name":"messageResult","type":"json","label":"Message result"}]'::jsonb,
    '{}'::jsonb,
    true,
    NULL,
    NULL,
    now()
  ),
  (
    'zalo_send_group_message',
    'Gửi tin nhắn/attachment Zalo vào group từ campaign input data.',
    'MessagesSquare',
    'data',
    'js',
    $block$
return await helpers.zaloSendGroupMessage({
  targetUid: vars.targetUid || vars.inputDataUid,
  targetName: vars.targetName || vars.inputDataName,
  message: vars.campaignContent,
  attachments: vars.images,
  inputData: vars.inputData
});
$block$,
    '[]'::jsonb,
    '[{"name":"zaloTarget","type":"json","label":"Zalo group target"},{"name":"messageResult","type":"json","label":"Message result"}]'::jsonb,
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
  friend_message_block_id bigint;
  group_message_block_id bigint;
  tag_block_id bigint;
  alias_block_id bigint;
  friend_workflow_id bigint;
  friend_test_workflow_id bigint;
  group_workflow_id bigint;
  group_test_workflow_id bigint;
BEGIN
  SELECT id INTO friend_message_block_id FROM public.auto_blocks WHERE name = 'zalo_send_friend_message';
  SELECT id INTO group_message_block_id FROM public.auto_blocks WHERE name = 'zalo_send_group_message';
  SELECT id INTO tag_block_id FROM public.auto_blocks WHERE name = 'zalo_apply_contact_tag';
  SELECT id INTO alias_block_id FROM public.auto_blocks WHERE name = 'zalo_change_contact_alias';

  IF friend_message_block_id IS NULL OR group_message_block_id IS NULL OR tag_block_id IS NULL OR alias_block_id IS NULL THEN
    RAISE EXCEPTION 'Cannot seed Zalo friend/group workflows: missing Zalo block ids';
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
    'zalo_message_friend',
    'Workflow browserless cho chiến dịch Zalo - Gửi tin nhắn đến bạn bè.',
    jsonb_build_array(
      jsonb_build_object('id','send_message','blockId',friend_message_block_id,'blockName','zalo_send_friend_message','position',jsonb_build_object('x',0,'y',0),'config',jsonb_build_object()),
      jsonb_build_object('id','apply_tag','blockId',tag_block_id,'blockName','zalo_apply_contact_tag','position',jsonb_build_object('x',260,'y',0),'config',jsonb_build_object()),
      jsonb_build_object('id','change_alias','blockId',alias_block_id,'blockName','zalo_change_contact_alias','position',jsonb_build_object('x',520,'y',0),'config',jsonb_build_object())
    ),
    jsonb_build_array(
      jsonb_build_object('id','e_message_tag','source','send_message','target','apply_tag'),
      jsonb_build_object('id','e_tag_alias','source','apply_tag','target','change_alias')
    ),
    '[
      {"name":"targetUid","type":"string","label":"Target UID"},
      {"name":"targetName","type":"string","label":"Target name"},
      {"name":"campaignContent","type":"string","label":"Message content"},
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
  RETURNING id INTO friend_workflow_id;

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
    'zalo_message_friend__test__zalo_message_friend',
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
  WHERE id = friend_workflow_id
  ON CONFLICT (name) DO NOTHING;

  SELECT id INTO friend_test_workflow_id
  FROM public.auto_workflows
  WHERE name = 'zalo_message_friend__test__zalo_message_friend';

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
    'zalo_message_group',
    'Workflow browserless cho chiến dịch Zalo - Gửi tin nhắn đến group.',
    jsonb_build_array(
      jsonb_build_object('id','send_group_message','blockId',group_message_block_id,'blockName','zalo_send_group_message','position',jsonb_build_object('x',0,'y',0),'config',jsonb_build_object())
    ),
    jsonb_build_array(),
    '[
      {"name":"targetUid","type":"string","label":"Group ID"},
      {"name":"targetName","type":"string","label":"Group name"},
      {"name":"campaignContent","type":"string","label":"Message content"}
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
  RETURNING id INTO group_workflow_id;

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
    'zalo_message_group__test__zalo_message_group',
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
  WHERE id = group_workflow_id
  ON CONFLICT (name) DO NOTHING;

  SELECT id INTO group_test_workflow_id
  FROM public.auto_workflows
  WHERE name = 'zalo_message_group__test__zalo_message_group';

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
  VALUES
    (
      'zalo_message_friend',
      'Zalo - Gửi tin nhắn đến bạn bè',
      'zalo',
      true,
      friend_workflow_id,
      friend_test_workflow_id,
      ARRAY['zalo_message_friend']::text[],
      false,
      now()
    ),
    (
      'zalo_message_group',
      'Zalo - Gửi tin nhắn đến group',
      'zalo',
      true,
      group_workflow_id,
      group_test_workflow_id,
      ARRAY['zalo_message_group']::text[],
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
