-- Zalo API-only birthday greeting campaign.
-- It reuses the friend-message block so details/quota/error policy stay on
-- action_code = 'zalo_message_friend'.

BEGIN;

INSERT INTO public.auto_account_actions (flatform_type, name, code)
VALUES ('zalo', 'Zalo - Gửi tin nhắn đến bạn bè', 'zalo_message_friend')
ON CONFLICT (code) DO UPDATE SET
  flatform_type = EXCLUDED.flatform_type,
  name = EXCLUDED.name,
  is_active = true,
  is_delete = false,
  updated_at = now();

DO $$
DECLARE
  friend_message_block_id bigint;
  birthday_workflow_id bigint;
  birthday_test_workflow_id bigint;
BEGIN
  SELECT id INTO friend_message_block_id
  FROM public.auto_blocks
  WHERE name = 'zalo_send_friend_message';

  IF friend_message_block_id IS NULL THEN
    RAISE EXCEPTION 'Cannot seed Zalo birthday workflow: missing block zalo_send_friend_message';
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
    'zalo_message_birthday',
    'Workflow browserless cho chiến dịch Zalo - Gửi tin nhắn chúc mừng sinh nhật.',
    jsonb_build_array(
      jsonb_build_object(
        'id','send_message',
        'blockId',friend_message_block_id,
        'blockName','zalo_send_friend_message',
        'position',jsonb_build_object('x',0,'y',0),
        'config',jsonb_build_object()
      )
    ),
    jsonb_build_array(),
    '[
      {"name":"targetUid","type":"string","label":"Target UID"},
      {"name":"targetName","type":"string","label":"Target name"},
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
  RETURNING id INTO birthday_workflow_id;

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
    'zalo_message_birthday__test__zalo_message_birthday',
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
  WHERE id = birthday_workflow_id
  ON CONFLICT (name) DO UPDATE SET
    description = EXCLUDED.description,
    nodes = EXCLUDED.nodes,
    edges = EXCLUDED.edges,
    variables_schema = EXCLUDED.variables_schema,
    default_variables = EXCLUDED.default_variables,
    updated_at = now();

  SELECT id INTO birthday_test_workflow_id
  FROM public.auto_workflows
  WHERE name = 'zalo_message_birthday__test__zalo_message_birthday';

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
    'zalo_message_birthday',
    'Zalo - Gửi tin nhắn chúc mừng sinh nhật',
    'zalo',
    true,
    birthday_workflow_id,
    birthday_test_workflow_id,
    ARRAY['zalo_message_friend']::text[],
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
