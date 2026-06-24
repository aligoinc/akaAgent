-- Zalo API-only campaign: message/add friend to users who join/leave/interact in groups in realtime.

BEGIN;

CREATE TABLE IF NOT EXISTS public.auto_campaign_zalo_realtime_group_events (
  id bigserial PRIMARY KEY,
  campaign_id bigint NOT NULL REFERENCES public.auto_campaigns(id) ON DELETE CASCADE,
  account_id bigint NOT NULL REFERENCES public.auto_accounts(id) ON DELETE CASCADE,
  group_id text NOT NULL,
  group_name text,
  trigger_type text NOT NULL CHECK (trigger_type IN ('join', 'leave', 'interact')),
  target_uid text NOT NULL,
  target_name text,
  event_time timestamptz NOT NULL DEFAULT now(),
  input_data_id bigint REFERENCES public.auto_campaign_input_data(id) ON DELETE SET NULL,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, target_uid)
);

CREATE INDEX IF NOT EXISTS idx_campaign_zalo_realtime_group_events_campaign
  ON public.auto_campaign_zalo_realtime_group_events(campaign_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_campaign_zalo_realtime_group_events_account
  ON public.auto_campaign_zalo_realtime_group_events(account_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.enqueue_campaign_zalo_realtime_group_event(
  p_campaign_id bigint,
  p_account_id bigint,
  p_group_id text,
  p_group_name text,
  p_trigger_type text,
  p_target_uid text,
  p_target_name text,
  p_event_time timestamptz,
  p_schedule_at timestamptz,
  p_raw_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE(inserted boolean, event_id bigint, input_data_id bigint)
LANGUAGE plpgsql
AS $$
DECLARE
  v_event_id bigint;
  v_input_data_id bigint;
  v_target_uid text := btrim(coalesce(p_target_uid, ''));
  v_target_name text := nullif(btrim(coalesce(p_target_name, '')), '');
  v_group_id text := btrim(coalesce(p_group_id, ''));
  v_group_name text := nullif(btrim(coalesce(p_group_name, '')), '');
  v_schedule_at timestamptz := coalesce(p_schedule_at, now());
BEGIN
  IF p_campaign_id IS NULL OR p_campaign_id <= 0 THEN
    RAISE EXCEPTION 'campaign_id is required';
  END IF;
  IF p_account_id IS NULL OR p_account_id <= 0 THEN
    RAISE EXCEPTION 'account_id is required';
  END IF;
  IF v_group_id = '' THEN
    RAISE EXCEPTION 'group_id is required';
  END IF;
  IF v_target_uid = '' OR v_target_uid = '0' THEN
    RAISE EXCEPTION 'target_uid is required';
  END IF;
  IF p_trigger_type NOT IN ('join', 'leave', 'interact') THEN
    RAISE EXCEPTION 'invalid trigger_type: %', p_trigger_type;
  END IF;

  INSERT INTO public.auto_campaign_zalo_realtime_group_events (
    campaign_id,
    account_id,
    group_id,
    group_name,
    trigger_type,
    target_uid,
    target_name,
    event_time,
    raw_payload
  )
  VALUES (
    p_campaign_id,
    p_account_id,
    v_group_id,
    v_group_name,
    p_trigger_type,
    v_target_uid,
    v_target_name,
    coalesce(p_event_time, now()),
    coalesce(p_raw_payload, '{}'::jsonb)
  )
  ON CONFLICT (campaign_id, target_uid) DO NOTHING
  RETURNING id INTO v_event_id;

  IF v_event_id IS NULL THEN
    SELECT e.id, e.input_data_id
      INTO v_event_id, v_input_data_id
    FROM public.auto_campaign_zalo_realtime_group_events e
    WHERE e.campaign_id = p_campaign_id
      AND e.target_uid = v_target_uid;

    RETURN QUERY SELECT false, v_event_id, v_input_data_id;
    RETURN;
  END IF;

  INSERT INTO public.auto_campaign_input_data (
    campaign_id,
    input_id,
    name,
    uid,
    status,
    note,
    schedule
  )
  VALUES (
    p_campaign_id,
    NULL,
    v_target_name,
    v_target_uid,
    'chờ xử lý',
    '',
    v_schedule_at
  )
  RETURNING id INTO v_input_data_id;

  UPDATE public.auto_campaign_zalo_realtime_group_events
  SET input_data_id = v_input_data_id,
      updated_at = now()
  WHERE id = v_event_id;

  UPDATE public.auto_campaigns
  SET schedule = v_schedule_at,
      updated_at = now()
  WHERE id = p_campaign_id
    AND account_id = p_account_id
    AND (
      schedule IS NULL
      OR schedule < now()
      OR schedule > v_schedule_at
    );

  RETURN QUERY SELECT true, v_event_id, v_input_data_id;
END;
$$;

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
  SELECT id INTO resolve_block_id FROM public.auto_blocks WHERE name = 'zalo_resolve_group_member_target';
  SELECT id INTO message_block_id FROM public.auto_blocks WHERE name = 'zalo_send_group_member_message';
  SELECT id INTO friend_block_id FROM public.auto_blocks WHERE name = 'zalo_send_group_member_friend_request';
  SELECT id INTO tag_block_id FROM public.auto_blocks WHERE name = 'zalo_apply_contact_tag';
  SELECT id INTO alias_block_id FROM public.auto_blocks WHERE name = 'zalo_change_contact_alias';

  IF resolve_block_id IS NULL OR message_block_id IS NULL OR friend_block_id IS NULL OR tag_block_id IS NULL OR alias_block_id IS NULL THEN
    RAISE EXCEPTION 'Cannot seed zalo_message_group_realtime workflow: missing Zalo block ids';
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
    'zalo_message_group_realtime',
    'Workflow browserless cho chiến dịch Zalo - Nhắn tin, kết bạn đến người tham gia/rời/tương tác group theo thời gian thực.',
    jsonb_build_array(
      jsonb_build_object('id','resolve_member','blockId',resolve_block_id,'blockName','zalo_resolve_group_member_target','position',jsonb_build_object('x',0,'y',0),'config',jsonb_build_object()),
      jsonb_build_object('id','send_message','blockId',message_block_id,'blockName','zalo_send_group_member_message','position',jsonb_build_object('x',260,'y',0),'config',jsonb_build_object()),
      jsonb_build_object('id','send_friend_request','blockId',friend_block_id,'blockName','zalo_send_group_member_friend_request','position',jsonb_build_object('x',520,'y',0),'config',jsonb_build_object()),
      jsonb_build_object('id','apply_tag','blockId',tag_block_id,'blockName','zalo_apply_contact_tag','position',jsonb_build_object('x',780,'y',0),'config',jsonb_build_object()),
      jsonb_build_object('id','change_alias','blockId',alias_block_id,'blockName','zalo_change_contact_alias','position',jsonb_build_object('x',1040,'y',0),'config',jsonb_build_object())
    ),
    jsonb_build_array(
      jsonb_build_object('id','e_resolve_message','source','resolve_member','target','send_message'),
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
    'zalo_message_group_realtime__test__zalo_message_group_realtime',
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
  WHERE name = 'zalo_message_group_realtime__test__zalo_message_group_realtime';

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
    'zalo_message_group_realtime',
    'Zalo - Nhắn tin, kết bạn đến người tham gia/rời/tương tác group theo thời gian thực',
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
