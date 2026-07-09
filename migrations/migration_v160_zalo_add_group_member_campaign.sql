-- Zalo API-only campaign: add/invite members to an existing Zalo group.

BEGIN;

INSERT INTO public.auto_account_actions (flatform_type, name, code)
VALUES
  ('zalo', 'Zalo - Tìm SĐT', 'zalo_find_phone_user'),
  ('zalo', 'Zalo - Thêm thành viên vào group', 'zalo_add_group_member')
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
    'zalo_resolve_add_group_member_target',
    'Chuẩn bị target Zalo từ UID hoặc số điện thoại để thêm vào group.',
    'UserSearch',
    'data',
    'js',
    $block$
return await helpers.zaloResolveAddGroupMemberTarget({
  targetUid: vars.targetUid || vars.inputDataUid,
  phone: vars.targetPhone || vars.inputDataPhone,
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
    'zalo_add_group_member',
    'Thêm, mời, hoặc gửi link mời thành viên vào group Zalo.',
    'UserPlus',
    'data',
    'js',
    $block$
return await helpers.zaloAddGroupMember({
  target: input.zaloTarget,
  targetGroupId: vars.zaloAddGroupMemberTargetGroupId,
  targetGroupName: vars.zaloAddGroupMemberTargetGroupName,
  useShareMethod: vars.zaloAddGroupMemberUseShareMethod,
  inputData: vars.inputData
});
$block$,
    '[]'::jsonb,
    '[{"name":"addGroupMemberResult","type":"json","label":"Add group member result"}]'::jsonb,
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
  add_block_id bigint;
  workflow_id bigint;
  test_workflow_id bigint;
BEGIN
  SELECT id INTO resolve_block_id FROM public.auto_blocks WHERE name = 'zalo_resolve_add_group_member_target';
  SELECT id INTO add_block_id FROM public.auto_blocks WHERE name = 'zalo_add_group_member';

  IF resolve_block_id IS NULL OR add_block_id IS NULL THEN
    RAISE EXCEPTION 'Cannot seed zalo_add_group_member workflow: missing Zalo block ids';
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
    'zalo_add_group_member',
    'Workflow browserless cho chiến dịch Zalo - Thêm thành viên vào group.',
    jsonb_build_array(
      jsonb_build_object('id','resolve_target','blockId',resolve_block_id,'blockName','zalo_resolve_add_group_member_target','position',jsonb_build_object('x',0,'y',0),'config',jsonb_build_object()),
      jsonb_build_object('id','add_member','blockId',add_block_id,'blockName','zalo_add_group_member','position',jsonb_build_object('x',260,'y',0),'config',jsonb_build_object())
    ),
    jsonb_build_array(
      jsonb_build_object('id','e_resolve_add','source','resolve_target','target','add_member')
    ),
    '[
      {"name":"targetUid","type":"string","label":"Target UID"},
      {"name":"targetPhone","type":"string","label":"Target phone"},
      {"name":"targetName","type":"string","label":"Target name"},
      {"name":"zaloAddGroupMemberTargetGroupId","type":"string","label":"Target group ID"},
      {"name":"zaloAddGroupMemberTargetGroupName","type":"string","label":"Target group name"},
      {"name":"zaloAddGroupMemberUseShareMethod","type":"boolean","label":"Use share group link"}
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
    'zalo_add_group_member__test__zalo_add_group_member',
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
  WHERE name = 'zalo_add_group_member__test__zalo_add_group_member';

  INSERT INTO public.auto_campaign_actions (
    id,
    name,
    flatform_type,
    is_active,
    workflow_id,
    test_workflow_id,
    limit_check_action_codes,
    allow_multiple_accounts,
    is_delete,
    created_at
  )
  VALUES (
    'zalo_add_group_member',
    'Zalo - Thêm thành viên vào group',
    'zalo',
    true,
    workflow_id,
    test_workflow_id,
    ARRAY['zalo_add_group_member']::text[],
    false,
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
    allow_multiple_accounts = false,
    is_delete = false;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;
