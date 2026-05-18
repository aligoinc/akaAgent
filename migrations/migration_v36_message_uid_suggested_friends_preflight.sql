-- Put suggested-friends collection into facebook_message_uid as a preflight branch.
-- The old wrapper workflow is removed because this is still part of the UID campaign.

DELETE FROM public.auto_workflows
WHERE name = 'facebook_collect_suggested_friends';

DO $$
DECLARE
  if_block_id bigint;
  collect_block_id bigint;
BEGIN
  SELECT id INTO if_block_id
  FROM public.auto_blocks
  WHERE name = 'if_else';

  SELECT id INTO collect_block_id
  FROM public.auto_blocks
  WHERE name = 'fb_collect_suggested_friends';

  IF if_block_id IS NULL THEN
    RAISE EXCEPTION 'Cannot patch facebook_message_uid: if_else block not found';
  END IF;

  IF collect_block_id IS NULL THEN
    RAISE EXCEPTION 'Cannot patch facebook_message_uid: fb_collect_suggested_friends block not found';
  END IF;

  UPDATE public.auto_workflows
  SET
    nodes = (
      COALESCE(
        (
          SELECT jsonb_agg(node)
          FROM jsonb_array_elements(COALESCE(nodes, '[]'::jsonb)) AS node
          WHERE node->>'id' NOT IN ('if_collect_suggested_friends', 'collect_suggested_friends')
        ),
        '[]'::jsonb
      )
      || jsonb_build_array(
        jsonb_build_object(
          'id', 'if_collect_suggested_friends',
          'blockId', if_block_id,
          'blockName', 'if_else',
          'systemType', 'ifElse',
          'position', jsonb_build_object('x', 100, 'y', -180),
          'config', jsonb_build_object('condition', 'vars.collectSuggestedFriendsOnly === true')
        ),
        jsonb_build_object(
          'id', 'collect_suggested_friends',
          'blockId', collect_block_id,
          'blockName', 'fb_collect_suggested_friends',
          'label', 'Lấy đề xuất bạn bè',
          'position', jsonb_build_object('x', -120, 'y', -80),
          'config', '{}'::jsonb
        )
      )
    ),
    edges = (
      COALESCE(
        (
          SELECT jsonb_agg(edge)
          FROM jsonb_array_elements(COALESCE(edges, '[]'::jsonb)) AS edge
          WHERE edge->>'id' NOT IN (
            'e-if_collect_suggested_friends-collect-true',
            'e-if_collect_suggested_friends-if_msg-false'
          )
        ),
        '[]'::jsonb
      )
      || '[
        {"id":"e-if_collect_suggested_friends-collect-true","source":"if_collect_suggested_friends","target":"collect_suggested_friends","sourceHandle":"true"},
        {"id":"e-if_collect_suggested_friends-if_msg-false","source":"if_collect_suggested_friends","target":"if_msg","sourceHandle":"false"}
      ]'::jsonb
    ),
    variables_schema = (
      COALESCE(
        (
          SELECT jsonb_agg(variable)
          FROM jsonb_array_elements(COALESCE(variables_schema, '[]'::jsonb)) AS variable
          WHERE variable->>'name' NOT IN ('collectSuggestedFriendsOnly', 'suggestedFriendsCount')
        ),
        '[]'::jsonb
      )
      || '[
        {"name":"collectSuggestedFriendsOnly","type":"boolean","label":"Chỉ lấy đề xuất bạn bè","default":false},
        {"name":"suggestedFriendsCount","type":"number","label":"Số lượng đề xuất","default":10}
      ]'::jsonb
    ),
    default_variables = jsonb_set(
      jsonb_set(
        COALESCE(default_variables, '{}'::jsonb),
        '{collectSuggestedFriendsOnly}',
        'false'::jsonb,
        true
      ),
      '{suggestedFriendsCount}',
      '10'::jsonb,
      true
    ),
    updated_at = now()
  WHERE name = 'facebook_message_uid';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cannot patch facebook_message_uid: workflow not found';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
