-- Zalo API-only campaign: join group by invite link.

BEGIN;

INSERT INTO public.auto_account_actions (flatform_type, name, code)
VALUES
  ('zalo', 'Zalo - Tham gia group', 'zalo_join_group_link')
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
    'zalo_join_group_link',
    'Tham gia group Zalo bằng link mời.',
    'LogIn',
    'data',
    'js',
    $block$
return await helpers.zaloJoinGroupLink({
  targetLink: vars.targetUid || vars.inputDataUid,
  targetName: vars.targetName || vars.inputDataName,
  inputData: vars.inputData
});
$block$,
    '[]'::jsonb,
    '[{"name":"joinResult","type":"json","label":"Join result"}]'::jsonb,
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
  join_block_id bigint;
  workflow_id bigint;
  test_workflow_id bigint;
BEGIN
  SELECT id INTO join_block_id FROM public.auto_blocks WHERE name = 'zalo_join_group_link';

  IF join_block_id IS NULL THEN
    RAISE EXCEPTION 'Cannot seed zalo_join_group_link workflow: missing Zalo block id';
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
    'zalo_join_group_link',
    'Workflow browserless cho chiến dịch Zalo - Tham gia vào group bằng link.',
    jsonb_build_array(
      jsonb_build_object('id','join_group','blockId',join_block_id,'blockName','zalo_join_group_link','position',jsonb_build_object('x',0,'y',0),'config',jsonb_build_object())
    ),
    '[]'::jsonb,
    '[
      {"name":"targetUid","type":"string","label":"Link group Zalo"},
      {"name":"targetName","type":"string","label":"Tên group"}
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
    'zalo_join_group_link__test__zalo_join_group_link',
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
  WHERE name = 'zalo_join_group_link__test__zalo_join_group_link';

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
    'zalo_join_group_link',
    'Zalo - Tham gia vào group bằng link',
    'zalo',
    true,
    workflow_id,
    test_workflow_id,
    ARRAY['zalo_join_group_link']::text[],
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
