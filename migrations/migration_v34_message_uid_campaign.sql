-- Split friend-message campaign from UID message/add-friend campaign.

DO $$
DECLARE
  source_wf public.auto_workflows%ROWTYPE;
  target_wf_id bigint;
BEGIN
  SELECT aw.*
  INTO source_wf
  FROM public.auto_campaign_actions ca
  JOIN public.auto_workflows aw ON aw.id = ca.workflow_id
  WHERE ca.id = 'facebook_message_friend';

  IF source_wf.id IS NULL THEN
    RAISE EXCEPTION 'Cannot create facebook_message_uid: source workflow for facebook_message_friend was not found';
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
    'facebook_message_uid',
    'Workflow nhắn tin và kết bạn đến UID Facebook, clone từ workflow nhắn tin bạn bè.',
    source_wf.nodes,
    source_wf.edges,
    source_wf.variables_schema,
    source_wf.default_variables,
    true,
    source_wf.staff_id,
    source_wf.organization_id,
    now()
  )
  ON CONFLICT (name) DO UPDATE SET
    description = EXCLUDED.description,
    nodes = EXCLUDED.nodes,
    edges = EXCLUDED.edges,
    variables_schema = EXCLUDED.variables_schema,
    default_variables = EXCLUDED.default_variables,
    is_builtin = EXCLUDED.is_builtin,
    staff_id = EXCLUDED.staff_id,
    organization_id = EXCLUDED.organization_id,
    updated_at = now()
  RETURNING id INTO target_wf_id;

  UPDATE public.auto_campaign_actions
  SET
    name = 'Facebook - Nhắn tin đến bạn bè',
    flatform_type = 'facebook',
    limit_check_action_codes = ARRAY['fb_message_friend']::text[],
    is_active = true,
    is_delete = false
  WHERE id = 'facebook_message_friend';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cannot update facebook_message_friend: campaign action was not found';
  END IF;

  INSERT INTO public.auto_campaign_actions (
    id,
    name,
    flatform_type,
    is_active,
    workflow_id,
    limit_check_action_codes,
    is_delete,
    created_at
  )
  VALUES (
    'facebook_message_uid',
    'Facebook - Nhắn tin & Kết bạn đến UID',
    'facebook',
    true,
    target_wf_id,
    ARRAY['fb_message_stranger', 'fb_add_friend']::text[],
    false,
    now()
  )
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    flatform_type = EXCLUDED.flatform_type,
    is_active = true,
    workflow_id = EXCLUDED.workflow_id,
    limit_check_action_codes = EXCLUDED.limit_check_action_codes,
    is_delete = false;
END $$;

UPDATE public.auto_campaigns
SET
  extra_settings = jsonb_set(
    jsonb_set(
      COALESCE(extra_settings, '{}'::jsonb),
      '{enableMessage}',
      'true'::jsonb,
      true
    ),
    '{enableAddFriend}',
    'false'::jsonb,
    true
  ),
  updated_at = now()
WHERE action_id = 'facebook_message_friend';

NOTIFY pgrst, 'reload schema';
