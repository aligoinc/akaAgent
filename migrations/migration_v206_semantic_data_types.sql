-- Semantic data types for Data Groups, Data Sets, Campaign input provenance,
-- Campaign actions and Automations.
--
-- A canonical contact deliberately remains transport/identity-only. Semantic
-- type belongs to the context which observed or uses that contact.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Shared common/data_type catalog
-- ---------------------------------------------------------------------------

INSERT INTO public.category_type (
  namespace,
  code,
  name,
  managed_by,
  description,
  is_active
)
VALUES (
  'common',
  'data_type',
  'Loại dữ liệu',
  'system',
  'Loại dữ liệu ngữ nghĩa dùng chung cho Data Group, Data Set, Campaign và Automation.',
  true
)
ON CONFLICT (namespace, code) DO UPDATE SET
  name = EXCLUDED.name,
  managed_by = 'system',
  description = EXCLUDED.description,
  is_active = true,
  updated_at = clock_timestamp();

WITH data_type AS (
  SELECT category_type.id
  FROM public.category_type
  WHERE category_type.namespace = 'common'
    AND category_type.code = 'data_type'
)
INSERT INTO public.category_item (
  category_type_id,
  code,
  name,
  managed_by,
  description,
  sort_order,
  external_id,
  metadata,
  is_active
)
SELECT
  data_type.id,
  seed.code,
  seed.name,
  'system',
  seed.description,
  seed.sort_order,
  seed.code,
  seed.metadata,
  true
FROM data_type
CROSS JOIN (VALUES
  ('phone'::text, 'Số điện thoại'::text, 10,
    'Dữ liệu được định tuyến bằng số điện thoại.'::text,
    '{"transportCodes":["phone"]}'::jsonb),
  ('email', 'Email', 20,
    'Dữ liệu được định tuyến bằng địa chỉ email.',
    '{"transportCodes":["email"]}'::jsonb),
  ('facebook_search_keyword', 'Facebook · Từ khóa tìm kiếm', 30,
    'Từ khóa đầu vào cho chiến dịch tìm kiếm Facebook.',
    '{"transportCodes":["facebook_uid"]}'::jsonb),
  ('facebook_post_url', 'Facebook · Link bài viết', 40,
    'Link bài viết đầu vào cho chiến dịch Facebook.',
    '{"transportCodes":["facebook_uid"]}'::jsonb),
  ('facebook_person', 'Facebook · User', 50,
    'User/profile Facebook.',
    '{"transportCodes":["facebook_uid"]}'::jsonb),
  ('facebook_group', 'Facebook · Group', 60,
    'Group Facebook.',
    '{"transportCodes":["facebook_uid"]}'::jsonb),
  ('facebook_page', 'Facebook · Page', 70,
    'Page Facebook.',
    '{"transportCodes":["facebook_uid"]}'::jsonb),
  ('facebook_page_inbox_customer', 'Facebook · Khách inbox Page', 80,
    'Khách hàng trong Page Inbox Facebook.',
    '{"transportCodes":["facebook_uid"]}'::jsonb),
  ('zalo_person', 'Zalo · User theo UID', 90,
    'User Zalo được định tuyến bằng UID.',
    '{"transportCodes":["zalo_uid"]}'::jsonb),
  ('zalo_group', 'Zalo · Group/link', 100,
    'Group hoặc link group Zalo.',
    '{"transportCodes":["zalo_uid"]}'::jsonb)
) AS seed(code, name, sort_order, description, metadata)
ON CONFLICT (category_type_id, code) DO UPDATE SET
  name = EXCLUDED.name,
  managed_by = 'system',
  description = EXCLUDED.description,
  sort_order = EXCLUDED.sort_order,
  external_id = EXCLUDED.external_id,
  metadata = EXCLUDED.metadata,
  is_active = true,
  updated_at = clock_timestamp();

-- Keep unknown historical system rows for FK audit, but make exactly the ten
-- release values selectable.
UPDATE public.category_item AS item
SET is_active = false,
    updated_at = clock_timestamp()
FROM public.category_type AS category_type
WHERE category_type.id = item.category_type_id
  AND category_type.namespace = 'common'
  AND category_type.code = 'data_type'
  AND item.managed_by = 'system'
  AND item.code NOT IN (
    'phone', 'email', 'facebook_search_keyword', 'facebook_post_url',
    'facebook_person', 'facebook_group', 'facebook_page',
    'facebook_page_inbox_customer', 'zalo_person', 'zalo_group'
  )
  AND item.is_active = true;

-- ---------------------------------------------------------------------------
-- 2. Context columns and FK-only history policy
-- ---------------------------------------------------------------------------

ALTER TABLE public.auto_account_contact_groups
  ADD COLUMN IF NOT EXISTS data_type_category_item_id bigint;
ALTER TABLE public.auto_account_contacts_dataset
  ADD COLUMN IF NOT EXISTS data_type_category_item_id bigint;
ALTER TABLE public.auto_account_contact_group_member_origins
  ADD COLUMN IF NOT EXISTS data_type_category_item_id bigint;
ALTER TABLE public.auto_campaign_input_data
  ADD COLUMN IF NOT EXISTS data_type_category_item_id bigint;
ALTER TABLE public.auto_campaign_action_data_types
  ADD COLUMN IF NOT EXISTS data_type_category_item_id bigint;
ALTER TABLE public.auto_automation
  ADD COLUMN IF NOT EXISTS data_type_category_item_id bigint;
ALTER TABLE public.auto_automation_detail
  ADD COLUMN IF NOT EXISTS data_type_category_item_id bigint;

DO $semantic_type_fks$
DECLARE
  v_target regclass;
  v_constraint text;
BEGIN
  FOR v_target, v_constraint IN
    SELECT *
    FROM (VALUES
      ('public.auto_account_contact_groups'::regclass,
        'auto_account_contact_groups_data_type_category_item_fkey'),
      ('public.auto_account_contacts_dataset'::regclass,
        'auto_account_contacts_dataset_data_type_category_item_fkey'),
      ('public.auto_account_contact_group_member_origins'::regclass,
        'auto_group_member_origins_data_type_category_item_fkey'),
      ('public.auto_campaign_input_data'::regclass,
        'auto_campaign_input_data_data_type_category_item_fkey'),
      ('public.auto_campaign_action_data_types'::regclass,
        'auto_campaign_action_data_types_data_type_category_item_fkey'),
      ('public.auto_automation'::regclass,
        'auto_automation_data_type_category_item_fkey'),
      ('public.auto_automation_detail'::regclass,
        'auto_automation_detail_data_type_category_item_fkey')
    ) AS targets(target_table, constraint_name)
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_constraint AS constraint_row
      WHERE constraint_row.conrelid = v_target
        AND constraint_row.conname = v_constraint
    ) THEN
      EXECUTE pg_catalog.format(
        'ALTER TABLE %s ADD CONSTRAINT %I FOREIGN KEY (data_type_category_item_id) REFERENCES public.category_item(id) ON DELETE RESTRICT',
        v_target,
        v_constraint
      );
    END IF;
  END LOOP;
END;
$semantic_type_fks$;

CREATE INDEX IF NOT EXISTS idx_data_groups_semantic_type
  ON public.auto_account_contact_groups (
    staff_id, organization_id, data_type_category_item_id, sort_order, id
  )
  WHERE purpose = 'data_group' AND is_delete = false;
CREATE INDEX IF NOT EXISTS idx_contact_datasets_semantic_type
  ON public.auto_account_contacts_dataset (
    data_type_category_item_id, staff_id, organization_id, updated_at DESC, id DESC
  )
  WHERE is_delete = false;
CREATE INDEX IF NOT EXISTS idx_data_group_origins_semantic_type
  ON public.auto_account_contact_group_member_origins (
    data_type_category_item_id, membership_id, created_at, id
  )
  WHERE is_current = true;
CREATE INDEX IF NOT EXISTS idx_campaign_inputs_semantic_type
  ON public.auto_campaign_input_data (
    campaign_id, data_type_category_item_id, id
  )
  WHERE COALESCE(is_delete, false) = false;
CREATE INDEX IF NOT EXISTS idx_automations_semantic_type
  ON public.auto_automation (
    data_type_category_item_id, source_campaign_id, id
  )
  WHERE is_delete = false;
CREATE INDEX IF NOT EXISTS idx_automation_details_semantic_type
  ON public.auto_automation_detail (
    data_type_category_item_id, source_campaign_input_data_id, id
  );

COMMENT ON COLUMN public.auto_account_contact_groups.data_type_category_item_id IS
  'Optional common/data_type constraint. NULL means unrestricted/mixed.';
COMMENT ON COLUMN public.auto_account_contacts_dataset.data_type_category_item_id IS
  'Authoritative semantic type of this Data Set; NULL means mixed or not known with certainty.';
COMMENT ON COLUMN public.auto_account_contact_group_member_origins.data_type_category_item_id IS
  'Semantic type of this exact observation/provenance; independent from canonical contact identity.';
COMMENT ON COLUMN public.auto_campaign_input_data.data_type_category_item_id IS
  'Immutable semantic type snapshot for this Campaign input; legacy ambiguous rows remain NULL.';
COMMENT ON COLUMN public.auto_campaign_action_data_types.data_type_category_item_id IS
  'Semantic common/data_type accepted by the action; data_type_code remains the extraction transport.';
COMMENT ON COLUMN public.auto_automation.data_type_category_item_id IS
  'Semantic type selected by this Automation; data_type_code remains the extraction transport.';
COMMENT ON COLUMN public.auto_automation_detail.data_type_category_item_id IS
  'Frozen semantic type copied from the Automation at enqueue time.';

-- ---------------------------------------------------------------------------
-- 3. Semantic lookup and validation helpers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.aka_agent_data_type_category_item_id(
  p_code text,
  p_require_active boolean DEFAULT true
)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT item.id
  FROM public.category_type AS category_type
  JOIN public.category_item AS item
    ON item.category_type_id = category_type.id
  WHERE category_type.namespace = 'common'
    AND category_type.code = 'data_type'
    AND category_type.managed_by = 'system'
    AND item.managed_by = 'system'
    AND item.code = lower(btrim(COALESCE(p_code, '')))
    AND (
      NOT COALESCE(p_require_active, true)
      OR (category_type.is_active = true AND item.is_active = true)
    )
  ORDER BY item.id
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.aka_agent_is_data_type_category_item(
  p_item_id bigint,
  p_require_active boolean DEFAULT true
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT p_item_id IS NULL OR EXISTS (
    SELECT 1
    FROM public.category_type AS category_type
    JOIN public.category_item AS item
      ON item.category_type_id = category_type.id
    WHERE item.id = p_item_id
      AND category_type.namespace = 'common'
      AND category_type.code = 'data_type'
      AND category_type.managed_by = 'system'
      AND item.managed_by = 'system'
      AND (
        NOT COALESCE(p_require_active, true)
        OR (category_type.is_active = true AND item.is_active = true)
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.aka_agent_current_data_type_category_item_id()
RETURNS bigint
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_value text := NULLIF(
    current_setting('aka_agent.data_type_category_item_id', true),
    ''
  );
BEGIN
  IF v_value IS NULL THEN
    RETURN NULL;
  END IF;
  IF lower(v_value) = 'null' THEN
    RETURN NULL;
  END IF;
  IF v_value !~ '^[1-9][0-9]*$' THEN
    RAISE EXCEPTION 'invalid_data_type_category_context';
  END IF;
  RETURN v_value::bigint;
END;
$$;

CREATE OR REPLACE FUNCTION public.aka_agent_data_type_context_present()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT NULLIF(
    current_setting('aka_agent.data_type_category_item_id', true),
    ''
  ) IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION public.aka_agent_legacy_action_semantic_type(
  p_campaign_action_id text,
  p_data_type_code text
)
RETURNS bigint
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  RETURN CASE
    WHEN p_data_type_code = 'phone'
      THEN public.aka_agent_data_type_category_item_id('phone')
    WHEN p_data_type_code = 'email'
      THEN public.aka_agent_data_type_category_item_id('email')
    WHEN p_campaign_action_id = 'facebook_find_data_search'
      THEN public.aka_agent_data_type_category_item_id(
        'facebook_search_keyword'
      )
    WHEN p_campaign_action_id = 'facebook_comment_seeding_post'
      THEN public.aka_agent_data_type_category_item_id('facebook_post_url')
    WHEN p_campaign_action_id = 'facebook_page_to_message'
      THEN public.aka_agent_data_type_category_item_id(
        'facebook_page_inbox_customer'
      )
    WHEN p_campaign_action_id = 'facebook_page_post'
      THEN public.aka_agent_data_type_category_item_id('facebook_page')
    WHEN p_campaign_action_id IN (
      'facebook_group_post',
      'facebook_join_group',
      'facebook_find_data_group'
    )
      THEN public.aka_agent_data_type_category_item_id('facebook_group')
    WHEN p_data_type_code = 'facebook_uid'
      THEN public.aka_agent_data_type_category_item_id('facebook_person')
    WHEN p_campaign_action_id IN (
      'zalo_message_group',
      'zalo_join_group_link'
    )
      THEN public.aka_agent_data_type_category_item_id('zalo_group')
    WHEN p_data_type_code = 'zalo_uid'
      THEN public.aka_agent_data_type_category_item_id('zalo_person')
    ELSE NULL
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.aka_agent_derive_dataset_data_type(
  p_source text,
  p_flatform_type text,
  p_contact_type text,
  p_scan_type text,
  p_extra_data jsonb
)
RETURNS bigint
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_action_id text := NULLIF(btrim(COALESCE(
    p_extra_data ->> 'actionId',
    p_extra_data ->> 'action_id',
    ''
  )), '');
  v_result bigint;
BEGIN
  IF p_source = 'scan' THEN
    IF p_scan_type IN (
      'facebook_group_members', 'facebook_profile_friends',
      'facebook_post_commenters', 'facebook_post_likes'
    ) THEN
      RETURN public.aka_agent_data_type_category_item_id('facebook_person');
    ELSIF p_scan_type = 'zalo_group_members' THEN
      RETURN public.aka_agent_data_type_category_item_id('zalo_person');
    END IF;
  END IF;

  IF p_source = 'upload' AND v_action_id = 'zalo_add_group_member' THEN
    RETURN public.aka_agent_data_type_category_item_id('phone');
  ELSIF p_source = 'upload' AND v_action_id = 'facebook_comment_seeding' THEN
    -- This direct uploader intentionally accepts User/Group/Page in one set.
    RETURN NULL;
  ELSIF v_action_id IS NOT NULL THEN
    SELECT min(mapping.data_type_category_item_id)
    INTO v_result
    FROM public.auto_campaign_action_data_types AS mapping
    WHERE mapping.campaign_action_id = v_action_id
      AND mapping.is_active = true
      AND mapping.is_delete = false
    HAVING count(DISTINCT mapping.data_type_category_item_id) = 1;
    IF v_result IS NOT NULL THEN
      RETURN v_result;
    END IF;
  END IF;

  RETURN CASE
    WHEN p_contact_type = 'phone'
      THEN public.aka_agent_data_type_category_item_id('phone')
    WHEN p_contact_type = 'email'
      THEN public.aka_agent_data_type_category_item_id('email')
    WHEN p_flatform_type = 'facebook' AND p_contact_type = 'person'
      THEN public.aka_agent_data_type_category_item_id('facebook_person')
    WHEN p_flatform_type = 'facebook' AND p_contact_type = 'group'
      THEN public.aka_agent_data_type_category_item_id('facebook_group')
    WHEN p_flatform_type = 'facebook' AND p_contact_type = 'page'
      THEN public.aka_agent_data_type_category_item_id('facebook_page')
    WHEN p_flatform_type = 'facebook' AND p_contact_type = 'page_inbox_customer'
      THEN public.aka_agent_data_type_category_item_id('facebook_page_inbox_customer')
    WHEN p_flatform_type = 'zalo' AND p_contact_type = 'person'
      THEN public.aka_agent_data_type_category_item_id('zalo_person')
    WHEN p_flatform_type = 'zalo' AND p_contact_type = 'group'
      THEN public.aka_agent_data_type_category_item_id('zalo_group')
    ELSE NULL
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.aka_agent_data_group_type_compatible(
  p_group_id bigint,
  p_campaign_action_id text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.auto_account_contact_groups AS contact_group
    WHERE contact_group.id = p_group_id
      AND contact_group.purpose = 'data_group'
      AND contact_group.is_delete = false
      AND (
        contact_group.data_type_category_item_id IS NULL
        OR EXISTS (
          SELECT 1
          FROM public.auto_campaign_action_data_types AS mapping
          WHERE mapping.campaign_action_id = p_campaign_action_id
            AND mapping.data_type_category_item_id =
              contact_group.data_type_category_item_id
            AND mapping.can_target = true
            AND mapping.is_active = true
            AND mapping.is_delete = false
        )
      )
  );
$$;

-- ---------------------------------------------------------------------------
-- 4. Action -> semantic type identity and exact mappings
-- ---------------------------------------------------------------------------

UPDATE public.auto_campaign_action_data_types AS mapping
SET data_type_category_item_id = CASE
  WHEN mapping.data_type_code = 'phone'
    THEN public.aka_agent_data_type_category_item_id('phone')
  WHEN mapping.data_type_code = 'email'
    THEN public.aka_agent_data_type_category_item_id('email')
  WHEN mapping.campaign_action_id = 'facebook_find_data_search'
    THEN public.aka_agent_data_type_category_item_id('facebook_search_keyword')
  WHEN mapping.campaign_action_id = 'facebook_comment_seeding_post'
    THEN public.aka_agent_data_type_category_item_id('facebook_post_url')
  WHEN mapping.campaign_action_id = 'facebook_page_to_message'
    THEN public.aka_agent_data_type_category_item_id('facebook_page_inbox_customer')
  WHEN mapping.campaign_action_id = 'facebook_page_post'
    THEN public.aka_agent_data_type_category_item_id('facebook_page')
  WHEN mapping.campaign_action_id IN (
    'facebook_group_post', 'facebook_join_group', 'facebook_find_data_group'
  ) THEN public.aka_agent_data_type_category_item_id('facebook_group')
  WHEN mapping.data_type_code = 'facebook_uid'
    THEN public.aka_agent_data_type_category_item_id('facebook_person')
  WHEN mapping.campaign_action_id IN (
    'zalo_message_group', 'zalo_join_group_link'
  ) THEN public.aka_agent_data_type_category_item_id('zalo_group')
  WHEN mapping.data_type_code = 'zalo_uid'
    THEN public.aka_agent_data_type_category_item_id('zalo_person')
  ELSE mapping.data_type_category_item_id
END
WHERE mapping.data_type_category_item_id IS NULL;

DO $semantic_mapping_identity_preflight$
DECLARE
  v_action_id text;
BEGIN
  SELECT mapping.campaign_action_id
  INTO v_action_id
  FROM public.auto_campaign_action_data_types AS mapping
  WHERE mapping.data_type_category_item_id IS NULL
  GROUP BY mapping.campaign_action_id
  HAVING count(*) > 1
  ORDER BY mapping.campaign_action_id
  LIMIT 1;
  IF v_action_id IS NOT NULL THEN
    RAISE EXCEPTION
      'ambiguous_legacy_action_semantic_mapping:%', v_action_id;
  END IF;
END;
$semantic_mapping_identity_preflight$;

ALTER TABLE public.auto_campaign_action_data_types
  DROP CONSTRAINT IF EXISTS auto_campaign_action_data_types_pkey;
ALTER TABLE public.auto_campaign_action_data_types
  DROP CONSTRAINT IF EXISTS uq_auto_campaign_action_semantic_data_type;
ALTER TABLE public.auto_campaign_action_data_types
  ADD CONSTRAINT uq_auto_campaign_action_semantic_data_type
  UNIQUE NULLS NOT DISTINCT (
    campaign_action_id,
    data_type_category_item_id
  );

WITH seed(
  campaign_action_id,
  semantic_code,
  data_type_code,
  target_contact_type,
  sort_order
) AS (
  VALUES
    ('zalo_message_phone', 'phone', 'phone', 'phone', 10),
    ('zalo_add_group_member', 'phone', 'phone', 'phone', 10),
    ('sms_send', 'phone', 'phone', 'phone', 10),
    ('voice_call', 'phone', 'phone', 'phone', 10),
    ('email_send', 'email', 'email', 'email', 20),
    ('facebook_find_data_search', 'facebook_search_keyword',
      'facebook_uid', 'campaign_input', 30),
    ('facebook_comment_seeding_post', 'facebook_post_url',
      'facebook_uid', 'campaign_input', 40),
    ('facebook_message_uid', 'facebook_person',
      'facebook_uid', 'person', 50),
    ('facebook_message_friend', 'facebook_person',
      'facebook_uid', 'person', 50),
    ('facebook_group_invite', 'facebook_person',
      'facebook_uid', 'person', 50),
    ('facebook_comment_seeding', 'facebook_person',
      'facebook_uid', 'campaign_input', 50),
    ('facebook_group_post', 'facebook_group',
      'facebook_uid', 'group', 60),
    ('facebook_join_group', 'facebook_group',
      'facebook_uid', 'group', 60),
    ('facebook_find_data_group', 'facebook_group',
      'facebook_uid', 'group', 60),
    ('facebook_comment_seeding', 'facebook_group',
      'facebook_uid', 'campaign_input', 60),
    ('facebook_page_post', 'facebook_page',
      'facebook_uid', 'page', 70),
    ('facebook_comment_seeding', 'facebook_page',
      'facebook_uid', 'campaign_input', 70),
    ('facebook_page_to_message', 'facebook_page_inbox_customer',
      'facebook_uid', 'page_inbox_customer', 80),
    ('zalo_message_friend', 'zalo_person', 'zalo_uid', 'person', 90),
    ('zalo_message_group_member', 'zalo_person', 'zalo_uid', 'person', 90),
    ('zalo_message_group_realtime', 'zalo_person', 'zalo_uid', 'person', 90),
    ('zalo_message_remarketing_customer', 'zalo_person',
      'zalo_uid', 'person', 90),
    ('zalo_message_birthday', 'zalo_person', 'zalo_uid', 'person', 90),
    ('zalo_message_friend_recommendation', 'zalo_person',
      'zalo_uid', 'person', 90),
    ('zalo_cancel_sent_friend_request', 'zalo_person',
      'zalo_uid', 'person', 90),
    ('zalo_add_group_member', 'zalo_person', 'zalo_uid', 'person', 90),
    ('zalo_message_group', 'zalo_group', 'zalo_uid', 'group', 100),
    ('zalo_join_group_link', 'zalo_group', 'zalo_uid', 'group', 100)
),
resolved AS (
  SELECT
    seed.campaign_action_id,
    item.id AS data_type_category_item_id,
    seed.data_type_code,
    seed.target_contact_type,
    seed.sort_order
  FROM seed
  JOIN public.auto_campaign_actions AS action
    ON action.id = seed.campaign_action_id
  JOIN public.category_type AS category_type
    ON category_type.namespace = 'common'
   AND category_type.code = 'data_type'
  JOIN public.category_item AS item
    ON item.category_type_id = category_type.id
   AND item.code = seed.semantic_code
)
INSERT INTO public.auto_campaign_action_data_types (
  campaign_action_id,
  data_type_category_item_id,
  data_type_code,
  can_source,
  can_target,
  target_contact_type,
  is_active,
  is_delete,
  sort_order,
  updated_at
)
SELECT
  resolved.campaign_action_id,
  resolved.data_type_category_item_id,
  resolved.data_type_code,
  true,
  true,
  resolved.target_contact_type,
  true,
  false,
  resolved.sort_order,
  clock_timestamp()
FROM resolved
ON CONFLICT ON CONSTRAINT uq_auto_campaign_action_semantic_data_type
DO UPDATE SET
  data_type_code = EXCLUDED.data_type_code,
  can_source = true,
  can_target = true,
  target_contact_type = EXCLUDED.target_contact_type,
  is_active = true,
  is_delete = false,
  sort_order = EXCLUDED.sort_order,
  updated_at = clock_timestamp();

WITH seed(campaign_action_id, semantic_code) AS (
  VALUES
    ('zalo_message_phone', 'phone'),
    ('zalo_add_group_member', 'phone'),
    ('sms_send', 'phone'),
    ('voice_call', 'phone'),
    ('email_send', 'email'),
    ('facebook_find_data_search', 'facebook_search_keyword'),
    ('facebook_comment_seeding_post', 'facebook_post_url'),
    ('facebook_message_uid', 'facebook_person'),
    ('facebook_message_friend', 'facebook_person'),
    ('facebook_group_invite', 'facebook_person'),
    ('facebook_comment_seeding', 'facebook_person'),
    ('facebook_group_post', 'facebook_group'),
    ('facebook_join_group', 'facebook_group'),
    ('facebook_find_data_group', 'facebook_group'),
    ('facebook_comment_seeding', 'facebook_group'),
    ('facebook_page_post', 'facebook_page'),
    ('facebook_comment_seeding', 'facebook_page'),
    ('facebook_page_to_message', 'facebook_page_inbox_customer'),
    ('zalo_message_friend', 'zalo_person'),
    ('zalo_message_group_member', 'zalo_person'),
    ('zalo_message_group_realtime', 'zalo_person'),
    ('zalo_message_remarketing_customer', 'zalo_person'),
    ('zalo_message_birthday', 'zalo_person'),
    ('zalo_message_friend_recommendation', 'zalo_person'),
    ('zalo_cancel_sent_friend_request', 'zalo_person'),
    ('zalo_add_group_member', 'zalo_person'),
    ('zalo_message_group', 'zalo_group'),
    ('zalo_join_group_link', 'zalo_group')
),
resolved AS (
  SELECT seed.campaign_action_id, item.id AS data_type_category_item_id
  FROM seed
  JOIN public.category_type AS category_type
    ON category_type.namespace = 'common'
   AND category_type.code = 'data_type'
  JOIN public.category_item AS item
    ON item.category_type_id = category_type.id
   AND item.code = seed.semantic_code
)
UPDATE public.auto_campaign_action_data_types AS mapping
SET is_active = false,
    is_delete = true,
    updated_at = clock_timestamp()
WHERE mapping.campaign_action_id IN (
  SELECT DISTINCT seed.campaign_action_id
  FROM seed
)
  AND NOT EXISTS (
  SELECT 1
  FROM resolved
  WHERE resolved.campaign_action_id = mapping.campaign_action_id
    AND resolved.data_type_category_item_id =
      mapping.data_type_category_item_id
);

CREATE OR REPLACE FUNCTION public.aka_agent_guard_action_semantic_mapping()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.data_type_category_item_id IS NULL THEN
    IF (
      TG_OP = 'INSERT'
      OR NEW.is_active IS DISTINCT FROM OLD.is_active
      OR NEW.is_delete IS DISTINCT FROM OLD.is_delete
    )
      AND NEW.is_active = true
      AND NEW.is_delete = false
    THEN
      RAISE EXCEPTION 'action_semantic_type_required';
    END IF;
    RETURN NEW;
  END IF;

  IF (
    TG_OP = 'INSERT'
    OR NEW.data_type_category_item_id IS DISTINCT FROM
      OLD.data_type_category_item_id
    OR (
      NEW.is_active = true
      AND NEW.is_delete = false
      AND (
        NEW.is_active IS DISTINCT FROM OLD.is_active
        OR NEW.is_delete IS DISTINCT FROM OLD.is_delete
      )
    )
  )
    AND NOT public.aka_agent_is_data_type_category_item(
      NEW.data_type_category_item_id,
      NEW.is_active = true AND NEW.is_delete = false
    )
  THEN
    RAISE EXCEPTION 'invalid_data_type_category_item';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_aka_agent_guard_action_semantic_mapping
  ON public.auto_campaign_action_data_types;
CREATE TRIGGER trg_aka_agent_guard_action_semantic_mapping
BEFORE INSERT OR UPDATE OF
  data_type_category_item_id, is_active, is_delete
ON public.auto_campaign_action_data_types
FOR EACH ROW
EXECUTE FUNCTION public.aka_agent_guard_action_semantic_mapping();

-- ---------------------------------------------------------------------------
-- 5. Conservative backfill
-- ---------------------------------------------------------------------------

UPDATE public.auto_account_contacts_dataset AS dataset
SET data_type_category_item_id = public.aka_agent_derive_dataset_data_type(
      dataset.source,
      dataset.flatform_type,
      dataset.contact_type,
      dataset.scan_type,
      dataset.extra_data
    ),
    updated_at = clock_timestamp()
WHERE dataset.data_type_category_item_id IS NULL
  AND public.aka_agent_derive_dataset_data_type(
        dataset.source,
        dataset.flatform_type,
        dataset.contact_type,
        dataset.scan_type,
        dataset.extra_data
      ) IS NOT NULL;

WITH candidates AS (
  SELECT
    automation.id,
    min(source_mapping.data_type_category_item_id) AS category_item_id
  FROM public.auto_automation AS automation
  JOIN public.auto_campaigns AS source_campaign
    ON source_campaign.id = automation.source_campaign_id
  JOIN public.auto_campaign_action_data_types AS source_mapping
    ON source_mapping.campaign_action_id = source_campaign.action_id
   AND source_mapping.data_type_code = automation.data_type_code
   AND source_mapping.can_source = true
   AND source_mapping.is_active = true
   AND source_mapping.is_delete = false
  LEFT JOIN public.auto_campaigns AS target_campaign
    ON target_campaign.id = automation.target_campaign_id
  WHERE automation.data_type_category_item_id IS NULL
    AND (
      target_campaign.id IS NULL
      OR EXISTS (
        SELECT 1
        FROM public.auto_campaign_action_data_types AS target_mapping
        WHERE target_mapping.campaign_action_id = target_campaign.action_id
          AND target_mapping.data_type_category_item_id =
            source_mapping.data_type_category_item_id
          AND target_mapping.data_type_code = automation.data_type_code
          AND target_mapping.can_target = true
          AND target_mapping.is_active = true
          AND target_mapping.is_delete = false
      )
    )
    AND (
      automation.target_data_group_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM public.auto_account_contact_groups AS target_group
        WHERE target_group.id = automation.target_data_group_id
          AND (
            target_group.data_type_category_item_id IS NULL
            OR target_group.data_type_category_item_id =
              source_mapping.data_type_category_item_id
          )
      )
    )
  GROUP BY automation.id
  HAVING count(DISTINCT source_mapping.data_type_category_item_id) = 1
)
UPDATE public.auto_automation AS automation
SET data_type_category_item_id = candidates.category_item_id,
    updated_at = clock_timestamp()
FROM candidates
WHERE automation.id = candidates.id;

UPDATE public.auto_automation_detail AS detail
SET data_type_category_item_id = automation.data_type_category_item_id,
    updated_at = clock_timestamp()
FROM public.auto_automation AS automation
WHERE automation.id = detail.automation_id
  AND detail.data_type_category_item_id IS NULL
  AND automation.data_type_category_item_id IS NOT NULL;

UPDATE public.auto_account_contact_group_member_origins AS origin
SET data_type_category_item_id = dataset.data_type_category_item_id,
    updated_at = clock_timestamp()
FROM public.auto_account_contacts_dataset AS dataset
WHERE dataset.id = origin.dataset_id
  AND origin.data_type_category_item_id IS NULL
  AND dataset.data_type_category_item_id IS NOT NULL;

UPDATE public.auto_account_contact_group_member_origins AS origin
SET data_type_category_item_id = detail.data_type_category_item_id,
    updated_at = clock_timestamp()
FROM public.auto_automation_detail AS detail
WHERE detail.id = origin.automation_detail_id
  AND origin.data_type_category_item_id IS NULL
  AND detail.data_type_category_item_id IS NOT NULL;

-- Manual and legacy groups deliberately remain unrestricted. Only dataset
-- owned groups with a complete, uniform authoritative set are typed.
WITH typed_auto_groups AS (
  SELECT
    contact_group.id,
    min(dataset.data_type_category_item_id) AS category_item_id
  FROM public.auto_account_contact_groups AS contact_group
  JOIN public.auto_account_contacts_dataset AS dataset
    ON dataset.auto_data_group_id = contact_group.id
   AND dataset.group_id IS NULL
   AND dataset.is_delete = false
  WHERE contact_group.purpose = 'data_group'
    AND contact_group.dataset_sync_mode = 'dataset_auto'
    AND contact_group.is_delete = false
  GROUP BY contact_group.id
  HAVING count(*) = count(dataset.data_type_category_item_id)
     AND count(DISTINCT dataset.data_type_category_item_id) = 1
)
UPDATE public.auto_account_contact_groups AS contact_group
SET data_type_category_item_id = typed_auto_groups.category_item_id,
    updated_at = clock_timestamp()
FROM typed_auto_groups
WHERE contact_group.id = typed_auto_groups.id
  AND contact_group.data_type_category_item_id IS NULL;

WITH group_candidates AS (
  SELECT
    campaign_origin.input_data_id,
    min(COALESCE(
      contact_group.data_type_category_item_id,
      primary_origin.data_type_category_item_id
    )) AS category_item_id
  FROM public.auto_campaign_input_origins AS campaign_origin
  LEFT JOIN public.auto_account_contact_groups AS contact_group
    ON contact_group.id = campaign_origin.group_id
  LEFT JOIN public.auto_account_contact_group_members AS member
    ON member.id = campaign_origin.membership_id
  LEFT JOIN public.auto_account_contact_group_member_origins AS primary_origin
    ON primary_origin.id = member.primary_origin_id
   AND primary_origin.is_current = true
  WHERE campaign_origin.origin_kind = 'group'
  GROUP BY campaign_origin.input_data_id
  HAVING count(DISTINCT COALESCE(
           contact_group.data_type_category_item_id,
           primary_origin.data_type_category_item_id
         )) = 1
),
automation_candidates AS (
  SELECT
    campaign_origin.input_data_id,
    min(detail.data_type_category_item_id) AS category_item_id
  FROM public.auto_campaign_input_origins AS campaign_origin
  JOIN public.auto_automation_detail AS detail
    ON detail.id = campaign_origin.automation_detail_id
  WHERE campaign_origin.origin_kind = 'automation'
    AND detail.data_type_category_item_id IS NOT NULL
  GROUP BY campaign_origin.input_data_id
  HAVING count(DISTINCT detail.data_type_category_item_id) = 1
),
origin_candidates AS (
  SELECT input_data_id, category_item_id FROM group_candidates
  UNION ALL
  SELECT input_data_id, category_item_id FROM automation_candidates
),
unambiguous AS (
  SELECT input_data_id, min(category_item_id) AS category_item_id
  FROM origin_candidates
  WHERE category_item_id IS NOT NULL
  GROUP BY input_data_id
  HAVING count(DISTINCT category_item_id) = 1
)
UPDATE public.auto_campaign_input_data AS input_data
SET data_type_category_item_id = unambiguous.category_item_id
FROM unambiguous
WHERE input_data.id = unambiguous.input_data_id
  AND input_data.data_type_category_item_id IS NULL;

WITH action_candidates AS (
  SELECT
    input_data.id,
    min(mapping.data_type_category_item_id) AS category_item_id
  FROM public.auto_campaign_input_data AS input_data
  JOIN public.auto_campaigns AS campaign
    ON campaign.id = input_data.campaign_id
  JOIN public.auto_campaign_action_data_types AS mapping
    ON mapping.campaign_action_id = campaign.action_id
   AND mapping.is_active = true
   AND mapping.is_delete = false
  WHERE input_data.data_type_category_item_id IS NULL
  GROUP BY input_data.id
  HAVING count(DISTINCT mapping.data_type_category_item_id) = 1
)
UPDATE public.auto_campaign_input_data AS input_data
SET data_type_category_item_id = action_candidates.category_item_id
FROM action_candidates
WHERE input_data.id = action_candidates.id;

-- ---------------------------------------------------------------------------
-- 6. Write guards and propagation
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.aka_agent_guard_data_group_semantic_type()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.data_type_category_item_id IS NOT NULL
    AND (
      TG_OP = 'INSERT'
      OR NEW.data_type_category_item_id IS DISTINCT FROM
        OLD.data_type_category_item_id
    )
    AND NOT public.aka_agent_is_data_type_category_item(
      NEW.data_type_category_item_id, true
    )
  THEN
    RAISE EXCEPTION 'invalid_data_type_category_item';
  END IF;

  IF TG_OP = 'UPDATE'
    AND NEW.data_type_category_item_id IS DISTINCT FROM
      OLD.data_type_category_item_id
    AND NEW.data_type_category_item_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.auto_account_contact_group_members AS member
      WHERE member.group_id = OLD.id
        AND member.is_delete = false
        AND (
          NOT EXISTS (
            SELECT 1
            FROM public.auto_account_contact_group_member_origins AS origin
            WHERE origin.membership_id = member.id
              AND origin.is_current = true
          )
          OR EXISTS (
            SELECT 1
            FROM public.auto_account_contact_group_member_origins AS origin
            WHERE origin.membership_id = member.id
              AND origin.is_current = true
              AND origin.data_type_category_item_id IS DISTINCT FROM
                NEW.data_type_category_item_id
          )
        )
    )
  THEN
    RAISE EXCEPTION 'data_group_members_semantic_type_mismatch';
  END IF;

  IF TG_OP = 'UPDATE'
    AND NEW.data_type_category_item_id IS DISTINCT FROM
      OLD.data_type_category_item_id
    AND NEW.data_type_category_item_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.auto_campaign_data_group_sources AS source
      JOIN public.auto_campaigns AS campaign
        ON campaign.id = source.campaign_id
      WHERE source.group_id = OLD.id
        AND source.status IN ('baselining', 'active')
        AND NOT EXISTS (
          SELECT 1
          FROM public.auto_campaign_action_data_types AS mapping
          WHERE mapping.campaign_action_id = campaign.action_id
            AND mapping.data_type_category_item_id =
              NEW.data_type_category_item_id
            AND mapping.can_target = true
            AND mapping.is_active = true
            AND mapping.is_delete = false
        )
    )
  THEN
    RAISE EXCEPTION 'data_group_active_campaign_semantic_type_mismatch';
  END IF;

  IF TG_OP = 'UPDATE'
    AND NEW.data_type_category_item_id IS DISTINCT FROM
      OLD.data_type_category_item_id
    AND NEW.data_type_category_item_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.auto_automation AS automation
      WHERE automation.target_data_group_id = OLD.id
        AND automation.is_active = true
        AND automation.is_delete = false
        AND automation.data_type_category_item_id IS DISTINCT FROM
          NEW.data_type_category_item_id
    )
  THEN
    RAISE EXCEPTION 'data_group_active_automation_semantic_type_mismatch';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_aka_agent_guard_data_group_semantic_type
  ON public.auto_account_contact_groups;
CREATE TRIGGER trg_aka_agent_guard_data_group_semantic_type
BEFORE INSERT OR UPDATE OF data_type_category_item_id
ON public.auto_account_contact_groups
FOR EACH ROW
WHEN (NEW.purpose = 'data_group')
EXECUTE FUNCTION public.aka_agent_guard_data_group_semantic_type();

CREATE OR REPLACE FUNCTION public.aka_agent_stamp_dataset_semantic_type()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_context_type bigint :=
    public.aka_agent_current_data_type_category_item_id();
  v_context_present boolean :=
    public.aka_agent_data_type_context_present();
  v_group_type bigint;
BEGIN
  IF v_context_present THEN
    NEW.data_type_category_item_id := v_context_type;
  ELSIF NEW.data_type_category_item_id IS NULL THEN
    NEW.data_type_category_item_id :=
      public.aka_agent_derive_dataset_data_type(
        NEW.source,
        NEW.flatform_type,
        NEW.contact_type,
        NEW.scan_type,
        NEW.extra_data
      );
  END IF;

  IF NEW.data_type_category_item_id IS NOT NULL
    AND (
      TG_OP = 'INSERT'
      OR NEW.data_type_category_item_id IS DISTINCT FROM
        OLD.data_type_category_item_id
    )
    AND NOT public.aka_agent_is_data_type_category_item(
      NEW.data_type_category_item_id, true
    )
  THEN
    RAISE EXCEPTION 'invalid_data_type_category_item';
  END IF;

  IF NEW.group_id IS NOT NULL THEN
    SELECT contact_group.data_type_category_item_id
    INTO v_group_type
    FROM public.auto_account_contact_groups AS contact_group
    WHERE contact_group.id = NEW.group_id
      AND contact_group.staff_id = NEW.staff_id
      AND contact_group.organization_id = NEW.organization_id
      AND contact_group.purpose = 'data_group'
      AND contact_group.is_delete = false;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'data_group_not_found';
    END IF;
    IF v_group_type IS NOT NULL
      AND NEW.data_type_category_item_id IS DISTINCT FROM v_group_type
    THEN
      RAISE EXCEPTION 'data_group_dataset_semantic_type_mismatch';
    END IF;
  END IF;

  IF NEW.source = 'upload'
    AND NULLIF(btrim(COALESCE(
      NEW.extra_data ->> 'actionId',
      NEW.extra_data ->> 'action_id',
      ''
    )), '') = 'zalo_add_group_member'
    AND (
      lower(btrim(COALESCE(NEW.contact_type, ''))) <> 'phone'
      OR NEW.data_type_category_item_id IS DISTINCT FROM
        public.aka_agent_data_type_category_item_id('phone')
    )
  THEN
    RAISE EXCEPTION 'zalo_add_group_member_upload_requires_phone';
  END IF;
  IF NEW.source = 'upload'
    AND NULLIF(btrim(COALESCE(
      NEW.extra_data ->> 'actionId',
      NEW.extra_data ->> 'action_id',
      ''
    )), '') = 'facebook_comment_seeding'
    AND NEW.data_type_category_item_id IS NOT NULL
  THEN
    RAISE EXCEPTION 'facebook_comment_seeding_upload_must_be_unrestricted';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_aka_agent_stamp_dataset_semantic_type
  ON public.auto_account_contacts_dataset;
CREATE TRIGGER trg_aka_agent_stamp_dataset_semantic_type
BEFORE INSERT OR UPDATE OF
  data_type_category_item_id, group_id, source, flatform_type,
  contact_type, scan_type, extra_data
ON public.auto_account_contacts_dataset
FOR EACH ROW
EXECUTE FUNCTION public.aka_agent_stamp_dataset_semantic_type();

CREATE OR REPLACE FUNCTION public.aka_agent_stamp_origin_semantic_type()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_group_type bigint;
BEGIN
  IF public.aka_agent_data_type_context_present() THEN
    NEW.data_type_category_item_id :=
      public.aka_agent_current_data_type_category_item_id();
  ELSE
    IF NEW.data_type_category_item_id IS NULL
      AND NEW.dataset_id IS NOT NULL
    THEN
      SELECT dataset.data_type_category_item_id
      INTO NEW.data_type_category_item_id
      FROM public.auto_account_contacts_dataset AS dataset
      WHERE dataset.id = NEW.dataset_id;
    END IF;

    IF NEW.data_type_category_item_id IS NULL
      AND NEW.automation_detail_id IS NOT NULL
    THEN
      SELECT detail.data_type_category_item_id
      INTO NEW.data_type_category_item_id
      FROM public.auto_automation_detail AS detail
      WHERE detail.id = NEW.automation_detail_id;
    END IF;
  END IF;

  SELECT contact_group.data_type_category_item_id
  INTO v_group_type
  FROM public.auto_account_contact_group_members AS member
  JOIN public.auto_account_contact_groups AS contact_group
    ON contact_group.id = member.group_id
  WHERE member.id = NEW.membership_id
    AND contact_group.purpose = 'data_group'
    AND contact_group.is_delete = false;

  IF NEW.data_type_category_item_id IS NOT NULL
    AND (
      TG_OP = 'INSERT'
      OR NEW.data_type_category_item_id IS DISTINCT FROM
        OLD.data_type_category_item_id
    )
    AND NOT public.aka_agent_is_data_type_category_item(
      NEW.data_type_category_item_id, true
    )
  THEN
    RAISE EXCEPTION 'invalid_data_type_category_item';
  END IF;

  IF TG_OP = 'UPDATE'
    AND OLD.data_type_category_item_id IS NOT NULL
    AND NEW.data_type_category_item_id IS DISTINCT FROM
      OLD.data_type_category_item_id
  THEN
    RAISE EXCEPTION 'data_group_origin_semantic_type_immutable';
  END IF;

  IF v_group_type IS NOT NULL
    AND NEW.data_type_category_item_id IS DISTINCT FROM v_group_type
  THEN
    RAISE EXCEPTION 'data_group_origin_semantic_type_mismatch';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_aka_agent_stamp_origin_semantic_type
  ON public.auto_account_contact_group_member_origins;
CREATE TRIGGER trg_aka_agent_stamp_origin_semantic_type
BEFORE INSERT OR UPDATE OF
  membership_id, dataset_id, automation_detail_id, batch_id,
  data_type_category_item_id, is_current
ON public.auto_account_contact_group_member_origins
FOR EACH ROW
EXECUTE FUNCTION public.aka_agent_stamp_origin_semantic_type();

CREATE OR REPLACE FUNCTION public.aka_agent_membership_semantic_type(
  p_membership_id bigint
)
RETURNS bigint
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_result bigint;
BEGIN
  SELECT primary_origin.data_type_category_item_id
  INTO v_result
  FROM public.auto_account_contact_group_members AS member
  JOIN public.auto_account_contact_group_member_origins AS primary_origin
    ON primary_origin.id = member.primary_origin_id
   AND primary_origin.membership_id = member.id
   AND primary_origin.is_current = true
  WHERE member.id = p_membership_id;

  IF v_result IS NOT NULL THEN
    RETURN v_result;
  END IF;

  SELECT min(origin.data_type_category_item_id)
  INTO v_result
  FROM public.auto_account_contact_group_member_origins AS origin
  WHERE origin.membership_id = p_membership_id
    AND origin.is_current = true
    AND origin.data_type_category_item_id IS NOT NULL
  HAVING count(DISTINCT origin.data_type_category_item_id) = 1;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION
public.aka_agent_data_group_membership_semantic_compatible(
  p_membership_id bigint,
  p_campaign_action_id text,
  p_group_id bigint
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_group_type bigint;
  v_membership_type bigint;
BEGIN
  SELECT contact_group.data_type_category_item_id
  INTO v_group_type
  FROM public.auto_account_contact_group_members AS member
  JOIN public.auto_account_contact_groups AS contact_group
    ON contact_group.id = member.group_id
  WHERE member.id = p_membership_id
    AND member.group_id = p_group_id
    AND member.is_delete = false
    AND contact_group.purpose = 'data_group'
    AND contact_group.is_delete = false;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  v_membership_type :=
    public.aka_agent_membership_semantic_type(p_membership_id);

  -- A typed group is an invariant, not a wildcard.  Legacy origins without a
  -- semantic snapshot may continue through the old field router only while
  -- they are in an unrestricted group.
  IF v_group_type IS NOT NULL
    AND (
      v_membership_type IS NULL
      OR v_membership_type IS DISTINCT FROM v_group_type
    )
  THEN
    RETURN false;
  END IF;

  IF v_membership_type IS NULL THEN
    RETURN true;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.auto_campaign_action_data_types AS mapping
    WHERE mapping.campaign_action_id =
        btrim(COALESCE(p_campaign_action_id, ''))
      AND mapping.data_type_category_item_id = v_membership_type
      AND mapping.can_target = true
      AND mapping.is_active = true
      AND mapping.is_delete = false
  );
END;
$$;

DO $preserve_pre_v206_data_group_router$
BEGIN
  IF pg_catalog.to_regprocedure(
    'public.aka_agent_internal_route_data_group_member_v205_internal(bigint,bigint,bigint,bigint)'
  ) IS NULL
    AND pg_catalog.to_regprocedure(
      'public.aka_agent_internal_route_data_group_member(bigint,bigint,bigint,bigint)'
    ) IS NOT NULL
  THEN
    ALTER FUNCTION public.aka_agent_internal_route_data_group_member(
      bigint, bigint, bigint, bigint
    ) RENAME TO aka_agent_internal_route_data_group_member_v205_internal;
  END IF;
END;
$preserve_pre_v206_data_group_router$;

CREATE OR REPLACE FUNCTION public.aka_agent_internal_route_data_group_member(
  p_source_id bigint,
  p_membership_id bigint,
  p_batch_id bigint,
  p_group_revision bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_action_id text;
  v_group_id bigint;
BEGIN
  SELECT campaign.action_id, source.group_id
  INTO v_action_id, v_group_id
  FROM public.auto_campaign_data_group_sources AS source
  JOIN public.auto_campaigns AS campaign
    ON campaign.id = source.campaign_id
  JOIN public.auto_account_contact_group_members AS member
    ON member.id = p_membership_id
   AND member.group_id = source.group_id
  WHERE source.id = p_source_id;

  IF FOUND
    AND NOT public.aka_agent_data_group_membership_semantic_compatible(
      p_membership_id, v_action_id, v_group_id
    )
  THEN
    RETURN jsonb_build_object(
      'status', 'incompatible',
      'reason', 'data_group_member_semantic_type_mismatch'
    );
  END IF;

  RETURN public.aka_agent_internal_route_data_group_member_v205_internal(
    p_source_id, p_membership_id, p_batch_id, p_group_revision
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.aka_agent_stamp_campaign_input_semantic_type()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_category_item_id bigint;
BEGIN
  IF NEW.data_type_category_item_id IS NOT NULL
    AND (
      TG_OP = 'INSERT'
      OR NEW.data_type_category_item_id IS DISTINCT FROM
        OLD.data_type_category_item_id
    )
    AND NOT public.aka_agent_is_data_type_category_item(
      NEW.data_type_category_item_id, true
    )
  THEN
    RAISE EXCEPTION 'invalid_data_type_category_item';
  END IF;

  IF TG_OP = 'UPDATE'
    AND OLD.data_type_category_item_id IS NOT NULL
    AND NEW.data_type_category_item_id IS DISTINCT FROM
      OLD.data_type_category_item_id
  THEN
    RAISE EXCEPTION 'campaign_input_semantic_type_immutable';
  END IF;

  IF NEW.data_type_category_item_id IS NULL THEN
    SELECT CASE
      WHEN campaign.action_id = 'zalo_add_group_member'
        AND NULLIF(btrim(COALESCE(NEW.phone, '')), '') IS NOT NULL
      THEN public.aka_agent_data_type_category_item_id('phone')
      WHEN campaign.action_id = 'zalo_add_group_member'
        AND NULLIF(btrim(COALESCE(NEW.uid, '')), '') IS NOT NULL
      THEN public.aka_agent_data_type_category_item_id('zalo_person')
      ELSE (
        SELECT min(mapping.data_type_category_item_id)
        FROM public.auto_campaign_action_data_types AS mapping
        WHERE mapping.campaign_action_id = campaign.action_id
          AND mapping.is_active = true
          AND mapping.is_delete = false
        HAVING count(DISTINCT mapping.data_type_category_item_id) = 1
      )
    END
    INTO v_category_item_id
    FROM public.auto_campaigns AS campaign
    WHERE campaign.id = NEW.campaign_id;
    NEW.data_type_category_item_id := v_category_item_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_aka_agent_stamp_campaign_input_semantic_type
  ON public.auto_campaign_input_data;
CREATE TRIGGER trg_aka_agent_stamp_campaign_input_semantic_type
BEFORE INSERT OR UPDATE OF data_type_category_item_id, campaign_id
ON public.auto_campaign_input_data
FOR EACH ROW
EXECUTE FUNCTION public.aka_agent_stamp_campaign_input_semantic_type();

CREATE OR REPLACE FUNCTION public.aka_agent_propagate_campaign_origin_semantic_type()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_category_item_id bigint;
  v_existing_category_item_id bigint;
  v_action_id text;
BEGIN
  IF NEW.group_id IS NOT NULL THEN
    SELECT campaign.action_id
    INTO v_action_id
    FROM public.auto_campaign_input_data AS input_data
    JOIN public.auto_campaigns AS campaign
      ON campaign.id = input_data.campaign_id
    WHERE input_data.id = NEW.input_data_id;

    IF v_action_id IS NULL
      OR NOT public.aka_agent_data_group_type_compatible(
        NEW.group_id, v_action_id
      )
    THEN
      RAISE EXCEPTION 'data_group_campaign_semantic_type_incompatible';
    END IF;

    SELECT contact_group.data_type_category_item_id
    INTO v_category_item_id
    FROM public.auto_account_contact_groups AS contact_group
    WHERE contact_group.id = NEW.group_id;
  END IF;

  IF v_category_item_id IS NULL AND NEW.membership_id IS NOT NULL THEN
    v_category_item_id :=
      public.aka_agent_membership_semantic_type(NEW.membership_id);
  END IF;

  IF v_category_item_id IS NULL
    AND NEW.automation_detail_id IS NOT NULL
  THEN
    SELECT detail.data_type_category_item_id
    INTO v_category_item_id
    FROM public.auto_automation_detail AS detail
    WHERE detail.id = NEW.automation_detail_id;
  END IF;

  IF v_category_item_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT input_data.data_type_category_item_id
  INTO v_existing_category_item_id
  FROM public.auto_campaign_input_data AS input_data
  WHERE input_data.id = NEW.input_data_id
  FOR UPDATE;

  IF v_existing_category_item_id IS NULL THEN
    UPDATE public.auto_campaign_input_data
    SET data_type_category_item_id = v_category_item_id
    WHERE id = NEW.input_data_id
      AND data_type_category_item_id IS NULL;
  ELSIF v_existing_category_item_id IS DISTINCT FROM v_category_item_id THEN
    RAISE EXCEPTION 'campaign_input_semantic_type_conflict';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_aka_agent_propagate_campaign_origin_semantic_type
  ON public.auto_campaign_input_origins;
CREATE TRIGGER trg_aka_agent_propagate_campaign_origin_semantic_type
AFTER INSERT OR UPDATE OF
  input_data_id, group_id, membership_id, automation_detail_id
ON public.auto_campaign_input_origins
FOR EACH ROW
EXECUTE FUNCTION public.aka_agent_propagate_campaign_origin_semantic_type();

CREATE OR REPLACE FUNCTION public.aka_agent_guard_campaign_data_group_semantic_type()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_action_id text;
BEGIN
  SELECT campaign.action_id
  INTO v_action_id
  FROM public.auto_campaigns AS campaign
  WHERE campaign.id = NEW.campaign_id;

  IF v_action_id IS NULL
    OR NOT public.aka_agent_data_group_type_compatible(
      NEW.group_id, v_action_id
    )
  THEN
    RAISE EXCEPTION 'data_group_campaign_semantic_type_incompatible';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_aka_agent_guard_campaign_data_group_semantic_type
  ON public.auto_campaign_data_group_sources;
CREATE TRIGGER trg_aka_agent_guard_campaign_data_group_semantic_type
BEFORE INSERT OR UPDATE OF campaign_id, group_id
ON public.auto_campaign_data_group_sources
FOR EACH ROW
EXECUTE FUNCTION public.aka_agent_guard_campaign_data_group_semantic_type();

CREATE OR REPLACE FUNCTION public.aka_agent_guard_automation_semantic_type()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_source_action_id text;
  v_target_action_id text;
  v_target_group_type bigint;
  v_context_present boolean :=
    public.aka_agent_data_type_context_present();
  v_context_type bigint :=
    public.aka_agent_current_data_type_category_item_id();
  v_effective_type bigint;
BEGIN
  v_effective_type := CASE
    WHEN v_context_present THEN v_context_type
    ELSE NEW.data_type_category_item_id
  END;

  -- aka_agent_save_automation temporarily clears the persisted snapshot before
  -- the preserved v205 writer changes its routing columns.  Only that exact
  -- transition is exempt here; every following routing update is checked
  -- against the semantic value carried in the transaction-local context.
  IF TG_OP = 'UPDATE'
    AND v_context_present
    AND NEW.data_type_category_item_id IS NULL
    AND OLD.data_type_category_item_id IS NOT NULL
    AND NEW.data_type_code IS NOT DISTINCT FROM OLD.data_type_code
    AND NEW.source_campaign_id IS NOT DISTINCT FROM OLD.source_campaign_id
    AND NEW.target_campaign_id IS NOT DISTINCT FROM OLD.target_campaign_id
    AND NEW.target_data_group_id IS NOT DISTINCT FROM
      OLD.target_data_group_id
    AND NEW.is_active IS NOT DISTINCT FROM OLD.is_active
  THEN
    RETURN NEW;
  END IF;

  -- Always allow a pure deactivation so a mapping/group retired after the
  -- rule was saved cannot trap that rule in the active state.
  IF TG_OP = 'UPDATE'
    AND NEW.is_active = false
    AND OLD.is_active = true
    AND NEW.data_type_category_item_id IS NOT DISTINCT FROM
      OLD.data_type_category_item_id
    AND NEW.data_type_code IS NOT DISTINCT FROM OLD.data_type_code
    AND NEW.source_campaign_id IS NOT DISTINCT FROM OLD.source_campaign_id
    AND NEW.target_campaign_id IS NOT DISTINCT FROM OLD.target_campaign_id
    AND NEW.target_data_group_id IS NOT DISTINCT FROM
      OLD.target_data_group_id
  THEN
    RETURN NEW;
  END IF;

  IF v_effective_type IS NULL THEN
    IF NEW.target_data_group_id IS NOT NULL THEN
      SELECT contact_group.data_type_category_item_id
      INTO v_target_group_type
      FROM public.auto_account_contact_groups AS contact_group
      WHERE contact_group.id = NEW.target_data_group_id
        AND contact_group.staff_id = NEW.staff_id
        AND contact_group.organization_id = NEW.organization_id
        AND contact_group.purpose = 'data_group'
        AND contact_group.is_delete = false;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'invalid_target_data_group';
      END IF;
      IF v_target_group_type IS NOT NULL THEN
        RAISE EXCEPTION 'legacy_automation_requires_unrestricted_data_group';
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  IF NOT public.aka_agent_is_data_type_category_item(
    v_effective_type, true
  )
  THEN
    RAISE EXCEPTION 'invalid_data_type_category_item';
  END IF;

  SELECT campaign.action_id
  INTO v_source_action_id
  FROM public.auto_campaigns AS campaign
  WHERE campaign.id = NEW.source_campaign_id;
  IF NOT EXISTS (
    SELECT 1
    FROM public.auto_campaign_action_data_types AS mapping
    WHERE mapping.campaign_action_id = v_source_action_id
      AND mapping.data_type_category_item_id =
        v_effective_type
      AND mapping.data_type_code = NEW.data_type_code
      AND mapping.can_source = true
      AND mapping.is_active = true
      AND mapping.is_delete = false
  ) THEN
    RAISE EXCEPTION 'source_campaign_semantic_type_not_supported';
  END IF;

  IF NEW.target_campaign_id IS NOT NULL THEN
    SELECT campaign.action_id
    INTO v_target_action_id
    FROM public.auto_campaigns AS campaign
    WHERE campaign.id = NEW.target_campaign_id;
    IF NOT EXISTS (
      SELECT 1
      FROM public.auto_campaign_action_data_types AS mapping
      WHERE mapping.campaign_action_id = v_target_action_id
        AND mapping.data_type_category_item_id =
          v_effective_type
        AND mapping.data_type_code = NEW.data_type_code
        AND mapping.can_target = true
        AND mapping.is_active = true
        AND mapping.is_delete = false
    ) THEN
      RAISE EXCEPTION 'target_campaign_semantic_type_not_supported';
    END IF;
  END IF;

  IF NEW.target_data_group_id IS NOT NULL THEN
    SELECT contact_group.data_type_category_item_id
    INTO v_target_group_type
    FROM public.auto_account_contact_groups AS contact_group
    WHERE contact_group.id = NEW.target_data_group_id
      AND contact_group.staff_id = NEW.staff_id
      AND contact_group.organization_id = NEW.organization_id
      AND contact_group.purpose = 'data_group'
      AND contact_group.is_delete = false;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'invalid_target_data_group';
    END IF;
    IF v_target_group_type IS NOT NULL
      AND v_target_group_type IS DISTINCT FROM
        v_effective_type
    THEN
      RAISE EXCEPTION 'automation_data_group_semantic_type_mismatch';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_aka_agent_guard_automation_semantic_type
  ON public.auto_automation;
CREATE TRIGGER trg_aka_agent_guard_automation_semantic_type
BEFORE INSERT OR UPDATE OF
  data_type_category_item_id, data_type_code, source_campaign_id,
  target_campaign_id, target_data_group_id, is_active
ON public.auto_automation
FOR EACH ROW
EXECUTE FUNCTION public.aka_agent_guard_automation_semantic_type();

CREATE OR REPLACE FUNCTION public.aka_agent_stamp_automation_detail_semantic_type()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_rule_type bigint;
  v_input_type bigint;
BEGIN
  SELECT automation.data_type_category_item_id
  INTO v_rule_type
  FROM public.auto_automation AS automation
  WHERE automation.id = NEW.automation_id;

  IF NEW.data_type_category_item_id IS NULL THEN
    NEW.data_type_category_item_id := v_rule_type;
  ELSIF v_rule_type IS NOT NULL
    AND NEW.data_type_category_item_id IS DISTINCT FROM v_rule_type
  THEN
    RAISE EXCEPTION 'automation_detail_semantic_type_mismatch';
  END IF;

  IF NEW.data_type_category_item_id IS NOT NULL
    AND (
      TG_OP = 'INSERT'
      OR NEW.data_type_category_item_id IS DISTINCT FROM
        OLD.data_type_category_item_id
    )
    AND NOT public.aka_agent_is_data_type_category_item(
      NEW.data_type_category_item_id, true
    )
  THEN
    RAISE EXCEPTION 'invalid_data_type_category_item';
  END IF;

  IF TG_OP = 'UPDATE'
    AND OLD.data_type_category_item_id IS NOT NULL
    AND NEW.data_type_category_item_id IS DISTINCT FROM
      OLD.data_type_category_item_id
  THEN
    RAISE EXCEPTION 'automation_detail_semantic_type_immutable';
  END IF;

  IF NEW.data_type_category_item_id IS NOT NULL THEN
    SELECT input_data.data_type_category_item_id
    INTO v_input_type
    FROM public.auto_campaign_input_data AS input_data
    WHERE input_data.id = NEW.source_campaign_input_data_id;
    IF v_input_type IS DISTINCT FROM NEW.data_type_category_item_id THEN
      RAISE EXCEPTION 'automation_source_input_semantic_type_mismatch';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_aka_agent_stamp_automation_detail_semantic_type
  ON public.auto_automation_detail;
CREATE TRIGGER trg_aka_agent_stamp_automation_detail_semantic_type
BEFORE INSERT OR UPDATE OF
  automation_id, source_campaign_input_data_id,
  data_type_category_item_id
ON public.auto_automation_detail
FOR EACH ROW
EXECUTE FUNCTION public.aka_agent_stamp_automation_detail_semantic_type();

-- ---------------------------------------------------------------------------
-- 7. Dataset-owned group identity includes semantic type
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.aka_agent_internal_dataset_auto_group_key(
  p_source text,
  p_account_id bigint,
  p_flatform_type text,
  p_contact_type text,
  p_scan_type text,
  p_source_key text,
  p_data_type_category_item_id bigint
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_source_key text := btrim(COALESCE(p_source_key, ''));
  v_upload_source_key text;
  v_identity jsonb;
BEGIN
  IF p_source = 'upload' AND p_account_id IS NOT NULL THEN
    v_upload_source_key := regexp_replace(
      v_source_key,
      ':' || p_account_id::text || '$',
      ''
    );
    v_identity := jsonb_build_object(
      'source', 'upload',
      'platform', COALESCE(p_flatform_type, ''),
      'contactType', COALESCE(p_contact_type, ''),
      'scanType', COALESCE(p_scan_type, ''),
      'sourceKey', v_upload_source_key,
      'dataTypeCategoryItemId', p_data_type_category_item_id
    );
  ELSE
    v_identity := jsonb_build_object(
      'source', COALESCE(p_source, ''),
      'accountId', p_account_id,
      'platform', COALESCE(p_flatform_type, ''),
      'contactType', COALESCE(p_contact_type, ''),
      'scanType', COALESCE(p_scan_type, ''),
      'sourceKey', v_source_key,
      'dataTypeCategoryItemId', p_data_type_category_item_id
    );
  END IF;

  RETURN COALESCE(p_source, 'dataset') || ':' || md5(v_identity::text);
END;
$$;

-- Compatibility for trusted code that still supplies the pre-v206 identity.
CREATE OR REPLACE FUNCTION public.aka_agent_internal_dataset_auto_group_key(
  p_source text,
  p_account_id bigint,
  p_flatform_type text,
  p_contact_type text,
  p_scan_type text,
  p_source_key text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
  SELECT public.aka_agent_internal_dataset_auto_group_key(
    p_source,
    p_account_id,
    p_flatform_type,
    p_contact_type,
    p_scan_type,
    p_source_key,
    NULL
  );
$$;

-- v170 persisted upload identity as <logical-key>:<account-id>.  The v206
-- writer appends semantic type before that account suffix.  Rewrite the
-- existing identity in place so the first post-upgrade refresh updates the
-- same dataset row (and therefore retains its group, membership and origins).
-- Scan source_key stays unchanged; only its generated group key changes.
DROP TRIGGER IF EXISTS trg_aka_agent_ensure_dataset_auto_data_group
  ON public.auto_account_contacts_dataset;

DO $semantic_upload_source_key_collision$
DECLARE
  v_collision record;
BEGIN
  SELECT
    dataset.id AS legacy_dataset_id,
    conflicting.id AS semantic_dataset_id
  INTO v_collision
  FROM public.auto_account_contacts_dataset AS dataset
  LEFT JOIN public.category_item AS category_item
    ON category_item.id = dataset.data_type_category_item_id
  JOIN public.auto_account_contacts_dataset AS conflicting
    ON conflicting.id <> dataset.id
   AND conflicting.staff_id = dataset.staff_id
   AND conflicting.account_id = dataset.account_id
   AND conflicting.scan_type = dataset.scan_type
   AND conflicting.contact_type = dataset.contact_type
   AND conflicting.source_key =
     left(
       dataset.source_key,
       length(dataset.source_key)
         - length(':' || dataset.account_id::text)
     )
     || ':data-type:'
     || COALESCE(category_item.code, 'unrestricted')
     || ':' || dataset.account_id::text
   AND conflicting.is_delete = false
   AND conflicting.group_id IS NULL
  WHERE dataset.source = 'upload'
    AND dataset.account_id IS NOT NULL
    AND dataset.group_id IS NULL
    AND dataset.is_delete = false
    AND right(
      dataset.source_key,
      length(':' || dataset.account_id::text)
    ) = ':' || dataset.account_id::text
    AND dataset.source_key !~ (
      ':data-type:[^:]+:' || dataset.account_id::text || '$'
    )
  ORDER BY dataset.id
  LIMIT 1;

  IF v_collision.legacy_dataset_id IS NOT NULL THEN
    RAISE EXCEPTION
      'semantic_upload_source_key_collision:legacy=%,semantic=%',
      v_collision.legacy_dataset_id,
      v_collision.semantic_dataset_id;
  END IF;
END;
$semantic_upload_source_key_collision$;

WITH semantic_upload_keys AS (
  SELECT
    dataset.id,
    left(
      dataset.source_key,
      length(dataset.source_key)
        - length(':' || dataset.account_id::text)
    )
    || ':data-type:'
    || COALESCE(category_item.code, 'unrestricted')
    || ':' || dataset.account_id::text AS source_key
  FROM public.auto_account_contacts_dataset AS dataset
  LEFT JOIN public.category_item AS category_item
    ON category_item.id = dataset.data_type_category_item_id
  WHERE dataset.source = 'upload'
    AND dataset.account_id IS NOT NULL
    AND dataset.group_id IS NULL
    AND dataset.is_delete = false
    AND right(
      dataset.source_key,
      length(':' || dataset.account_id::text)
    ) = ':' || dataset.account_id::text
    AND dataset.source_key !~ (
      ':data-type:[^:]+:' || dataset.account_id::text || '$'
    )
)
UPDATE public.auto_account_contacts_dataset AS dataset
SET source_key = semantic_upload_keys.source_key,
    updated_at = clock_timestamp()
FROM semantic_upload_keys
WHERE dataset.id = semantic_upload_keys.id;

-- Re-key only groups whose currently owned datasets resolve to one semantic
-- identity.  Mixed legacy groups deliberately keep their existing wildcard
-- identity and their original group id; the runtime trigger below recognizes
-- that legacy ownership instead of splitting or retiring it.
DO $semantic_dataset_auto_group_key_collision$
DECLARE
  v_collision record;
BEGIN
  WITH owned_keys AS (
    SELECT
      contact_group.id,
      contact_group.staff_id,
      contact_group.organization_id,
      public.aka_agent_internal_dataset_auto_group_key(
        dataset.source,
        dataset.account_id,
        dataset.flatform_type,
        dataset.contact_type,
        dataset.scan_type,
        dataset.source_key,
        dataset.data_type_category_item_id
      ) AS semantic_key
    FROM public.auto_account_contact_groups AS contact_group
    JOIN public.auto_account_contacts_dataset AS dataset
      ON dataset.auto_data_group_id = contact_group.id
     AND dataset.group_id IS NULL
     AND dataset.is_delete = false
    WHERE contact_group.purpose = 'data_group'
      AND contact_group.dataset_sync_mode = 'dataset_auto'
      AND contact_group.is_delete = false
  ),
  uniform_groups AS (
    SELECT
      id,
      staff_id,
      organization_id,
      min(semantic_key) AS semantic_key
    FROM owned_keys
    GROUP BY id, staff_id, organization_id
    HAVING count(DISTINCT semantic_key) = 1
  )
  SELECT
    first_group.id AS first_group_id,
    second_group.id AS second_group_id,
    first_group.semantic_key
  INTO v_collision
  FROM uniform_groups AS first_group
  JOIN uniform_groups AS second_group
    ON second_group.id > first_group.id
   AND second_group.staff_id = first_group.staff_id
   AND second_group.organization_id = first_group.organization_id
   AND second_group.semantic_key = first_group.semantic_key
  LIMIT 1;

  IF v_collision.first_group_id IS NOT NULL THEN
    RAISE EXCEPTION
      'semantic_dataset_auto_group_key_collision:first=%,second=%,key=%',
      v_collision.first_group_id,
      v_collision.second_group_id,
      v_collision.semantic_key;
  END IF;
END;
$semantic_dataset_auto_group_key_collision$;

WITH owned_keys AS (
  SELECT
    contact_group.id,
    public.aka_agent_internal_dataset_auto_group_key(
      dataset.source,
      dataset.account_id,
      dataset.flatform_type,
      dataset.contact_type,
      dataset.scan_type,
      dataset.source_key,
      dataset.data_type_category_item_id
    ) AS semantic_key
  FROM public.auto_account_contact_groups AS contact_group
  JOIN public.auto_account_contacts_dataset AS dataset
    ON dataset.auto_data_group_id = contact_group.id
   AND dataset.group_id IS NULL
   AND dataset.is_delete = false
  WHERE contact_group.purpose = 'data_group'
    AND contact_group.dataset_sync_mode = 'dataset_auto'
    AND contact_group.is_delete = false
),
uniform_groups AS (
  SELECT id, min(semantic_key) AS semantic_key
  FROM owned_keys
  GROUP BY id
  HAVING count(DISTINCT semantic_key) = 1
)
UPDATE public.auto_account_contact_groups AS contact_group
SET dataset_sync_key = uniform_groups.semantic_key,
    updated_at = clock_timestamp()
FROM uniform_groups
WHERE contact_group.id = uniform_groups.id
  AND contact_group.dataset_sync_key IS DISTINCT FROM
    uniform_groups.semantic_key;

CREATE OR REPLACE FUNCTION public.aka_agent_ensure_dataset_auto_data_group()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_sync_key text;
  v_group public.auto_account_contact_groups%ROWTYPE;
  v_related_dataset record;
  v_member record;
  v_owned_semantic_key_count integer;
  v_owned_semantic_key text;
  v_preserve_legacy_group boolean := false;
BEGIN
  -- A dataset created inside an existing Data Group already has its owner and
  -- must never create a second group.
  IF NEW.group_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
    AND OLD.auto_data_group_id IS NOT NULL
    AND NEW.data_type_category_item_id IS DISTINCT FROM
      OLD.data_type_category_item_id
  THEN
    PERFORM public.aka_agent_internal_retire_dataset_auto_data_group(
      NEW.id,
      OLD.auto_data_group_id
    );
    NEW.auto_data_group_id := NULL;
  END IF;

  IF NEW.is_delete THEN
    PERFORM public.aka_agent_internal_retire_dataset_auto_data_group(
      NEW.id,
      NEW.auto_data_group_id
    );
    RETURN NEW;
  END IF;

  IF NEW.source = 'scan'
    AND NEW.last_scan_status IS DISTINCT FROM 'completed'
    AND NEW.last_scan_status IS DISTINCT FROM 'partial'
  THEN
    RETURN NEW;
  END IF;
  IF NEW.source = 'upload'
    AND NEW.last_scan_status IS DISTINCT FROM 'completed'
  THEN
    RETURN NEW;
  END IF;

  v_sync_key := public.aka_agent_internal_dataset_auto_group_key(
    NEW.source,
    NEW.account_id,
    NEW.flatform_type,
    NEW.contact_type,
    NEW.scan_type,
    NEW.source_key,
    NEW.data_type_category_item_id
  );

  IF NEW.auto_data_group_id IS NOT NULL THEN
    SELECT contact_group.*
    INTO v_group
    FROM public.auto_account_contact_groups AS contact_group
    WHERE contact_group.id = NEW.auto_data_group_id
      AND contact_group.staff_id = NEW.staff_id
      AND contact_group.organization_id = NEW.organization_id
      AND contact_group.purpose = 'data_group'
      AND contact_group.dataset_sync_mode = 'dataset_auto'
      AND contact_group.is_delete = false
    FOR UPDATE;

    IF v_group.id IS NOT NULL
      AND v_group.data_type_category_item_id IS NOT NULL
      AND v_group.data_type_category_item_id IS DISTINCT FROM
        NEW.data_type_category_item_id
    THEN
      RAISE EXCEPTION 'dataset_auto_group_semantic_type_mismatch';
    END IF;

    IF v_group.id IS NOT NULL
      AND v_group.dataset_sync_key IS DISTINCT FROM v_sync_key
    THEN
      SELECT
        count(DISTINCT owned.semantic_key),
        min(owned.semantic_key)
      INTO v_owned_semantic_key_count, v_owned_semantic_key
      FROM (
        SELECT public.aka_agent_internal_dataset_auto_group_key(
          dataset.source,
          dataset.account_id,
          dataset.flatform_type,
          dataset.contact_type,
          dataset.scan_type,
          dataset.source_key,
          dataset.data_type_category_item_id
        ) AS semantic_key
        FROM public.auto_account_contacts_dataset AS dataset
        WHERE dataset.auto_data_group_id = v_group.id
          AND dataset.group_id IS NULL
          AND dataset.is_delete = false
      ) AS owned;

      IF v_owned_semantic_key_count = 1
        AND v_owned_semantic_key = v_sync_key
      THEN
        UPDATE public.auto_account_contact_groups
        SET dataset_sync_key = v_sync_key,
            updated_at = clock_timestamp()
        WHERE id = v_group.id
        RETURNING * INTO v_group;
      ELSIF v_owned_semantic_key_count > 1
        AND v_group.data_type_category_item_id IS NULL
      THEN
        v_preserve_legacy_group := true;
      ELSE
        RAISE EXCEPTION 'dataset_auto_group_identity_mismatch';
      END IF;
    END IF;
  END IF;

  IF v_group.id IS NULL THEN
    INSERT INTO public.auto_account_contact_groups (
      account_id,
      contact_type,
      name,
      purpose,
      color,
      sort_order,
      revision,
      is_delete,
      staff_id,
      organization_id,
      dataset_sync_mode,
      dataset_sync_key,
      data_type_category_item_id,
      created_at,
      updated_at
    ) VALUES (
      NULL,
      NULL,
      btrim(NEW.name),
      'data_group',
      '#6366F1',
      COALESCE((
        SELECT max(contact_group.sort_order) + 1
        FROM public.auto_account_contact_groups AS contact_group
        WHERE contact_group.staff_id = NEW.staff_id
          AND contact_group.organization_id = NEW.organization_id
          AND contact_group.purpose = 'data_group'
          AND contact_group.is_delete = false
      ), 0),
      0,
      false,
      NEW.staff_id,
      NEW.organization_id,
      'dataset_auto',
      v_sync_key,
      NEW.data_type_category_item_id,
      clock_timestamp(),
      clock_timestamp()
    )
    ON CONFLICT (staff_id, organization_id, dataset_sync_key)
      WHERE purpose = 'data_group'
        AND dataset_sync_mode = 'dataset_auto'
        AND dataset_sync_key IS NOT NULL
        AND is_delete = false
    DO UPDATE SET
      name = EXCLUDED.name,
      data_type_category_item_id =
        EXCLUDED.data_type_category_item_id,
      updated_at = clock_timestamp()
    RETURNING * INTO v_group;
  ELSE
    UPDATE public.auto_account_contact_groups
    SET name = btrim(NEW.name),
        data_type_category_item_id = CASE
          WHEN v_preserve_legacy_group
            THEN v_group.data_type_category_item_id
          ELSE NEW.data_type_category_item_id
        END,
        updated_at = clock_timestamp()
    WHERE id = v_group.id
      AND (
        name IS DISTINCT FROM btrim(NEW.name)
        OR data_type_category_item_id IS DISTINCT FROM
          CASE
            WHEN v_preserve_legacy_group
              THEN v_group.data_type_category_item_id
            ELSE NEW.data_type_category_item_id
          END
      )
    RETURNING * INTO v_group;

    IF NOT FOUND THEN
      SELECT contact_group.*
      INTO v_group
      FROM public.auto_account_contact_groups AS contact_group
      WHERE contact_group.id = NEW.auto_data_group_id;
    END IF;
  END IF;

  FOR v_related_dataset IN
    SELECT dataset.id
    FROM public.auto_account_contacts_dataset AS dataset
    WHERE dataset.staff_id = NEW.staff_id
      AND dataset.organization_id = NEW.organization_id
      AND dataset.group_id IS NULL
      AND dataset.is_delete = false
      AND (
        (dataset.source = 'scan'
          AND dataset.last_scan_status IN ('completed', 'partial'))
        OR
        (dataset.source = 'upload'
          AND dataset.last_scan_status = 'completed')
      )
      AND (
        (
          v_preserve_legacy_group
          AND dataset.auto_data_group_id = v_group.id
        )
        OR (
          NOT v_preserve_legacy_group
          AND public.aka_agent_internal_dataset_auto_group_key(
            dataset.source,
            dataset.account_id,
            dataset.flatform_type,
            dataset.contact_type,
            dataset.scan_type,
            dataset.source_key,
            dataset.data_type_category_item_id
          ) = v_sync_key
        )
      )
    ORDER BY dataset.id
  LOOP
    UPDATE public.auto_account_contacts_dataset
    SET auto_data_group_id = v_group.id,
        updated_at = clock_timestamp()
    WHERE id = v_related_dataset.id
      AND auto_data_group_id IS DISTINCT FROM v_group.id;

    FOR v_member IN
      SELECT member.contact_id
      FROM public.auto_account_contacts_dataset_members AS member
      WHERE member.dataset_id = v_related_dataset.id
        AND member.is_current = true
      ORDER BY member.sort_order, member.contact_id
    LOOP
      PERFORM public.aka_agent_internal_sync_dataset_auto_group_member(
        v_related_dataset.id,
        v_member.contact_id,
        true
      );
    END LOOP;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_aka_agent_ensure_dataset_auto_data_group
  ON public.auto_account_contacts_dataset;
CREATE TRIGGER trg_aka_agent_ensure_dataset_auto_data_group
AFTER INSERT OR UPDATE OF
  name, last_scan_status, is_delete, group_id, source, account_id,
  flatform_type, contact_type, scan_type, source_key,
  data_type_category_item_id
ON public.auto_account_contacts_dataset
FOR EACH ROW
EXECUTE FUNCTION public.aka_agent_ensure_dataset_auto_data_group();

-- ---------------------------------------------------------------------------
-- 8. Data Group list/create/update contracts
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.aka_agent_data_type_json(
  p_item_id bigint
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT jsonb_build_object(
    'data_type_category_item_id', p_item_id,
    'data_type_code', item.code,
    'data_type_name', item.name
  )
  FROM (SELECT 1) AS singleton
  LEFT JOIN public.category_item AS item
    ON item.id = p_item_id;
$$;

DO $preserve_v186_group_rpcs$
BEGIN
  IF pg_catalog.to_regprocedure(
    'public.aka_agent_list_data_groups_v205_internal(bigint,bigint,text,integer,integer)'
  ) IS NULL
    AND pg_catalog.to_regprocedure(
      'public.aka_agent_list_data_groups(bigint,bigint,text,integer,integer)'
    ) IS NOT NULL
  THEN
    ALTER FUNCTION public.aka_agent_list_data_groups(
      bigint, bigint, text, integer, integer
    ) RENAME TO aka_agent_list_data_groups_v205_internal;
  END IF;
  IF pg_catalog.to_regprocedure(
    'public.aka_agent_list_data_groups_v205_auth_internal(bigint,bigint,text,integer,integer,text,text)'
  ) IS NULL
    AND pg_catalog.to_regprocedure(
      'public.aka_agent_list_data_groups(bigint,bigint,text,integer,integer,text,text)'
    ) IS NOT NULL
  THEN
    ALTER FUNCTION public.aka_agent_list_data_groups(
      bigint, bigint, text, integer, integer, text, text
    ) RENAME TO aka_agent_list_data_groups_v205_auth_internal;
  END IF;

  IF pg_catalog.to_regprocedure(
    'public.aka_agent_create_data_group_v205_internal(bigint,bigint,text,text,text)'
  ) IS NULL
    AND pg_catalog.to_regprocedure(
      'public.aka_agent_create_data_group(bigint,bigint,text,text,text)'
    ) IS NOT NULL
  THEN
    ALTER FUNCTION public.aka_agent_create_data_group(
      bigint, bigint, text, text, text
    ) RENAME TO aka_agent_create_data_group_v205_internal;
  END IF;
  IF pg_catalog.to_regprocedure(
    'public.aka_agent_create_data_group_v205_auth_internal(bigint,bigint,text,text,text,text,text)'
  ) IS NULL
    AND pg_catalog.to_regprocedure(
      'public.aka_agent_create_data_group(bigint,bigint,text,text,text,text,text)'
    ) IS NOT NULL
  THEN
    ALTER FUNCTION public.aka_agent_create_data_group(
      bigint, bigint, text, text, text, text, text
    ) RENAME TO aka_agent_create_data_group_v205_auth_internal;
  END IF;

  IF pg_catalog.to_regprocedure(
    'public.aka_agent_update_data_group_v205_internal(bigint,bigint,bigint,text,text,integer)'
  ) IS NULL
    AND pg_catalog.to_regprocedure(
      'public.aka_agent_update_data_group(bigint,bigint,bigint,text,text,integer)'
    ) IS NOT NULL
  THEN
    ALTER FUNCTION public.aka_agent_update_data_group(
      bigint, bigint, bigint, text, text, integer
    ) RENAME TO aka_agent_update_data_group_v205_internal;
  END IF;
  IF pg_catalog.to_regprocedure(
    'public.aka_agent_update_data_group_v205_auth_internal(bigint,bigint,bigint,text,text,integer,text,text)'
  ) IS NULL
    AND pg_catalog.to_regprocedure(
      'public.aka_agent_update_data_group(bigint,bigint,bigint,text,text,integer,text,text)'
    ) IS NOT NULL
  THEN
    ALTER FUNCTION public.aka_agent_update_data_group(
      bigint, bigint, bigint, text, text, integer, text, text
    ) RENAME TO aka_agent_update_data_group_v205_auth_internal;
  END IF;
END;
$preserve_v186_group_rpcs$;

CREATE OR REPLACE FUNCTION public.aka_agent_list_data_groups(
  p_staff_id bigint,
  p_organization_id bigint,
  p_search text,
  p_compatible_action_id text,
  p_compatible_data_type_category_item_id bigint,
  p_data_type_category_item_ids bigint[],
  p_offset integer,
  p_limit integer,
  p_unrestricted_only boolean DEFAULT false
)
RETURNS TABLE (
  id bigint,
  name text,
  color text,
  sort_order integer,
  revision bigint,
  data_type_category_item_id bigint,
  data_type_code text,
  data_type_name text,
  dataset_sync_mode text,
  active_membership_count bigint,
  is_delete boolean,
  staff_id bigint,
  organization_id bigint,
  created_at timestamptz,
  updated_at timestamptz,
  total_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM public.aka_agent_internal_require_staff_tenant(
    p_staff_id, p_organization_id
  );
  IF COALESCE(p_offset, 0) < 0
    OR COALESCE(p_limit, 100) NOT BETWEEN 1 AND 500
  THEN
    RAISE EXCEPTION 'invalid_data_group_page';
  END IF;
  IF p_compatible_data_type_category_item_id IS NOT NULL
    AND NOT public.aka_agent_is_data_type_category_item(
      p_compatible_data_type_category_item_id, true
    )
  THEN
    RAISE EXCEPTION 'invalid_data_type_category_item';
  END IF;

  RETURN QUERY
  WITH filtered AS (
    SELECT contact_group.*
    FROM public.auto_account_contact_groups AS contact_group
    WHERE contact_group.staff_id = p_staff_id
      AND contact_group.organization_id = p_organization_id
      AND contact_group.purpose = 'data_group'
      AND contact_group.is_delete = false
      AND (
        NULLIF(btrim(COALESCE(p_search, '')), '') IS NULL
        OR contact_group.name ILIKE '%' || btrim(p_search) || '%'
      )
      AND (
        p_data_type_category_item_ids IS NULL
        OR contact_group.data_type_category_item_id =
          ANY(p_data_type_category_item_ids)
      )
      AND (
        NOT COALESCE(p_unrestricted_only, false)
        OR contact_group.data_type_category_item_id IS NULL
      )
      AND (
        p_compatible_data_type_category_item_id IS NULL
        OR contact_group.data_type_category_item_id IS NULL
        OR contact_group.data_type_category_item_id =
          p_compatible_data_type_category_item_id
      )
      AND (
        NULLIF(btrim(COALESCE(p_compatible_action_id, '')), '') IS NULL
        OR contact_group.data_type_category_item_id IS NULL
        OR EXISTS (
          SELECT 1
          FROM public.auto_campaign_action_data_types AS mapping
          WHERE mapping.campaign_action_id =
              btrim(p_compatible_action_id)
            AND mapping.data_type_category_item_id =
              contact_group.data_type_category_item_id
            AND mapping.can_target = true
            AND mapping.is_active = true
            AND mapping.is_delete = false
        )
      )
  )
  SELECT
    filtered.id,
    filtered.name,
    filtered.color,
    filtered.sort_order,
    filtered.revision,
    filtered.data_type_category_item_id,
    data_type_item.code,
    data_type_item.name,
    filtered.dataset_sync_mode,
    (
      SELECT count(*)
      FROM public.auto_account_contact_group_members AS member
      WHERE member.group_id = filtered.id
        AND member.is_delete = false
    )::bigint,
    filtered.is_delete,
    filtered.staff_id,
    filtered.organization_id,
    filtered.created_at,
    filtered.updated_at,
    count(*) OVER ()::bigint
  FROM filtered
  LEFT JOIN public.category_item AS data_type_item
    ON data_type_item.id = filtered.data_type_category_item_id
  ORDER BY
    filtered.sort_order,
    filtered.updated_at DESC,
    filtered.id DESC
  OFFSET COALESCE(p_offset, 0)
  LIMIT COALESCE(p_limit, 100);
END;
$$;

CREATE OR REPLACE FUNCTION public.aka_agent_list_data_groups(
  p_staff_id bigint,
  p_organization_id bigint,
  p_search text DEFAULT NULL,
  p_offset integer DEFAULT 0,
  p_limit integer DEFAULT 100
)
RETURNS TABLE (
  id bigint,
  name text,
  color text,
  sort_order integer,
  revision bigint,
  data_type_category_item_id bigint,
  data_type_code text,
  data_type_name text,
  dataset_sync_mode text,
  active_membership_count bigint,
  is_delete boolean,
  staff_id bigint,
  organization_id bigint,
  created_at timestamptz,
  updated_at timestamptz,
  total_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT *
  FROM public.aka_agent_list_data_groups(
    p_staff_id, p_organization_id, p_search,
    NULL, NULL, NULL, p_offset, p_limit, false
  );
$$;

CREATE OR REPLACE FUNCTION public.aka_agent_list_data_groups(
  p_staff_id bigint,
  p_organization_id bigint,
  p_search text,
  p_compatible_action_id text,
  p_compatible_data_type_category_item_id bigint,
  p_data_type_category_item_ids bigint[],
  p_offset integer,
  p_limit integer,
  p_auth_username text,
  p_auth_password text,
  p_unrestricted_only boolean DEFAULT false
)
RETURNS TABLE (
  id bigint,
  name text,
  color text,
  sort_order integer,
  revision bigint,
  data_type_category_item_id bigint,
  data_type_code text,
  data_type_name text,
  dataset_sync_mode text,
  active_membership_count bigint,
  is_delete boolean,
  staff_id bigint,
  organization_id bigint,
  created_at timestamptz,
  updated_at timestamptz,
  total_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT public.auto_assert_automation_identity(
    p_staff_id, p_organization_id, p_auth_username, p_auth_password
  );
  SELECT *
  FROM public.aka_agent_list_data_groups(
    p_staff_id, p_organization_id, p_search,
    p_compatible_action_id,
    p_compatible_data_type_category_item_id,
    p_data_type_category_item_ids,
    p_offset, p_limit,
    p_unrestricted_only
  );
$$;

CREATE OR REPLACE FUNCTION public.aka_agent_list_data_groups(
  p_staff_id bigint,
  p_organization_id bigint,
  p_search text,
  p_offset integer,
  p_limit integer,
  p_auth_username text,
  p_auth_password text
)
RETURNS TABLE (
  id bigint,
  name text,
  color text,
  sort_order integer,
  revision bigint,
  data_type_category_item_id bigint,
  data_type_code text,
  data_type_name text,
  dataset_sync_mode text,
  active_membership_count bigint,
  is_delete boolean,
  staff_id bigint,
  organization_id bigint,
  created_at timestamptz,
  updated_at timestamptz,
  total_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT *
  FROM public.aka_agent_list_data_groups(
    p_staff_id, p_organization_id, p_search,
    NULL, NULL, NULL, p_offset, p_limit,
    p_auth_username, p_auth_password, false
  );
$$;

CREATE OR REPLACE FUNCTION public.aka_agent_create_data_group(
  p_staff_id bigint,
  p_organization_id bigint,
  p_name text,
  p_color text,
  p_request_id text,
  p_data_type_category_item_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_group public.auto_account_contact_groups%ROWTYPE;
  v_batch public.auto_data_ingest_batches%ROWTYPE;
  v_request_hash text;
  v_result jsonb;
BEGIN
  PERFORM public.aka_agent_internal_require_staff_tenant(
    p_staff_id, p_organization_id
  );
  IF length(btrim(COALESCE(p_name, ''))) NOT BETWEEN 1 AND 255
    OR length(btrim(COALESCE(p_color, '#2563EB'))) NOT BETWEEN 1 AND 64
  THEN
    RAISE EXCEPTION 'invalid_data_group_payload';
  END IF;
  IF p_data_type_category_item_id IS NOT NULL
    AND NOT public.aka_agent_is_data_type_category_item(
      p_data_type_category_item_id, true
    )
  THEN
    RAISE EXCEPTION 'invalid_data_type_category_item';
  END IF;

  v_request_hash := md5(jsonb_build_object(
    'operation', 'create_group',
    'name', btrim(p_name),
    'color', btrim(COALESCE(p_color, '#2563EB')),
    'dataTypeCategoryItemId', p_data_type_category_item_id
  )::text);

  IF NULLIF(btrim(COALESCE(p_request_id, '')), '') IS NOT NULL THEN
    INSERT INTO public.auto_data_ingest_batches (
      request_id, operation, request_hash, status,
      staff_id, organization_id
    ) VALUES (
      btrim(p_request_id), 'create_group', v_request_hash, 'processing',
      p_staff_id, p_organization_id
    )
    ON CONFLICT (staff_id, organization_id, request_id) DO NOTHING
    RETURNING * INTO v_batch;

    IF NOT FOUND THEN
      SELECT *
      INTO v_batch
      FROM public.auto_data_ingest_batches AS batch
      WHERE batch.staff_id = p_staff_id
        AND batch.organization_id = p_organization_id
        AND batch.request_id = btrim(p_request_id)
      FOR UPDATE;
      IF v_batch.operation <> 'create_group'
        OR v_batch.request_hash <> v_request_hash
      THEN
        RAISE EXCEPTION 'data_group_request_id_conflict';
      END IF;
      IF v_batch.result IS NOT NULL THEN
        RETURN v_batch.result;
      END IF;
      RAISE EXCEPTION 'data_group_request_incomplete';
    END IF;
  END IF;

  INSERT INTO public.auto_account_contact_groups (
    account_id, contact_type, name, purpose, color, sort_order, revision,
    data_type_category_item_id, dataset_sync_mode, dataset_sync_key,
    is_delete, staff_id, organization_id
  ) VALUES (
    NULL, NULL, btrim(p_name), 'data_group',
    btrim(COALESCE(p_color, '#2563EB')),
    COALESCE((
      SELECT max(contact_group.sort_order) + 1
      FROM public.auto_account_contact_groups AS contact_group
      WHERE contact_group.staff_id = p_staff_id
        AND contact_group.organization_id = p_organization_id
        AND contact_group.purpose = 'data_group'
        AND contact_group.is_delete = false
    ), 0),
    0, p_data_type_category_item_id, 'manual', NULL,
    false, p_staff_id, p_organization_id
  )
  RETURNING * INTO v_group;

  v_result := to_jsonb(v_group)
    || public.aka_agent_data_type_json(v_group.data_type_category_item_id)
    || jsonb_build_object('active_membership_count', 0);

  IF v_batch.id IS NOT NULL THEN
    UPDATE public.auto_data_ingest_batches
    SET group_id = v_group.id,
        status = 'completed',
        result = v_result,
        updated_at = clock_timestamp()
    WHERE id = v_batch.id;
  END IF;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.aka_agent_create_data_group(
  p_staff_id bigint,
  p_organization_id bigint,
  p_name text,
  p_color text,
  p_request_id text,
  p_data_type_category_item_id bigint,
  p_auth_username text,
  p_auth_password text
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT public.auto_assert_automation_identity(
    p_staff_id, p_organization_id, p_auth_username, p_auth_password
  );
  SELECT public.aka_agent_create_data_group(
    p_staff_id, p_organization_id, p_name, p_color, p_request_id,
    p_data_type_category_item_id
  );
$$;

CREATE OR REPLACE FUNCTION public.aka_agent_create_data_group(
  p_staff_id bigint,
  p_organization_id bigint,
  p_name text,
  p_color text DEFAULT '#2563EB',
  p_request_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT public.aka_agent_create_data_group(
    p_staff_id, p_organization_id, p_name, p_color, p_request_id, NULL
  );
$$;

CREATE OR REPLACE FUNCTION public.aka_agent_create_data_group(
  p_staff_id bigint,
  p_organization_id bigint,
  p_name text,
  p_color text,
  p_request_id text,
  p_auth_username text,
  p_auth_password text
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT public.aka_agent_create_data_group(
    p_staff_id, p_organization_id, p_name, p_color, p_request_id,
    NULL, p_auth_username, p_auth_password
  );
$$;

CREATE OR REPLACE FUNCTION public.aka_agent_update_data_group(
  p_staff_id bigint,
  p_organization_id bigint,
  p_group_id bigint,
  p_name text,
  p_color text,
  p_sort_order integer,
  p_data_type_category_item_id bigint,
  p_update_data_type boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_group public.auto_account_contact_groups%ROWTYPE;
BEGIN
  PERFORM public.aka_agent_internal_require_staff_tenant(
    p_staff_id, p_organization_id
  );
  IF p_name IS NOT NULL
    AND length(btrim(p_name)) NOT BETWEEN 1 AND 255
  THEN
    RAISE EXCEPTION 'invalid_data_group_name';
  END IF;
  IF p_color IS NOT NULL
    AND length(btrim(p_color)) NOT BETWEEN 1 AND 64
  THEN
    RAISE EXCEPTION 'invalid_data_group_color';
  END IF;
  IF p_sort_order IS NOT NULL AND p_sort_order < 0 THEN
    RAISE EXCEPTION 'invalid_data_group_sort_order';
  END IF;
  IF COALESCE(p_update_data_type, false)
    AND p_data_type_category_item_id IS NOT NULL
    AND NOT public.aka_agent_is_data_type_category_item(
      p_data_type_category_item_id, true
    )
  THEN
    RAISE EXCEPTION 'invalid_data_type_category_item';
  END IF;

  SELECT contact_group.*
  INTO v_group
  FROM public.auto_account_contact_groups AS contact_group
  WHERE contact_group.id = p_group_id
    AND contact_group.staff_id = p_staff_id
    AND contact_group.organization_id = p_organization_id
    AND contact_group.purpose = 'data_group'
    AND contact_group.is_delete = false
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'data_group_not_found';
  END IF;
  IF COALESCE(p_update_data_type, false)
    AND v_group.dataset_sync_mode = 'dataset_auto'
  THEN
    RAISE EXCEPTION 'dataset_auto_data_group_type_read_only';
  END IF;

  UPDATE public.auto_account_contact_groups AS contact_group
  SET name = COALESCE(btrim(p_name), contact_group.name),
      color = COALESCE(btrim(p_color), contact_group.color),
      sort_order = COALESCE(p_sort_order, contact_group.sort_order),
      data_type_category_item_id = CASE
        WHEN COALESCE(p_update_data_type, false)
          THEN p_data_type_category_item_id
        ELSE contact_group.data_type_category_item_id
      END,
      revision = contact_group.revision + CASE
        WHEN COALESCE(p_update_data_type, false)
          AND contact_group.data_type_category_item_id IS DISTINCT FROM
            p_data_type_category_item_id
        THEN 1 ELSE 0
      END,
      updated_at = clock_timestamp()
  WHERE contact_group.id = v_group.id
  RETURNING contact_group.* INTO v_group;

  RETURN to_jsonb(v_group)
    || public.aka_agent_data_type_json(v_group.data_type_category_item_id)
    || jsonb_build_object(
      'active_membership_count', (
        SELECT count(*)
        FROM public.auto_account_contact_group_members AS member
        WHERE member.group_id = v_group.id
          AND member.is_delete = false
      )
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.aka_agent_update_data_group(
  p_staff_id bigint,
  p_organization_id bigint,
  p_group_id bigint,
  p_name text,
  p_color text,
  p_sort_order integer,
  p_data_type_category_item_id bigint,
  p_update_data_type boolean,
  p_auth_username text,
  p_auth_password text
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT public.auto_assert_automation_identity(
    p_staff_id, p_organization_id, p_auth_username, p_auth_password
  );
  SELECT public.aka_agent_update_data_group(
    p_staff_id, p_organization_id, p_group_id, p_name, p_color,
    p_sort_order, p_data_type_category_item_id, p_update_data_type
  );
$$;

-- ---------------------------------------------------------------------------
-- 11. Direct campaign snapshots validate the group before fan-out
-- ---------------------------------------------------------------------------

DO $preserve_v205_direct_snapshot$
BEGIN
  IF pg_catalog.to_regprocedure(
    'public.aka_agent_snapshot_data_group_to_direct_campaign_v205_internal(bigint,bigint,text,bigint,bigint,timestamptz,text,text,text)'
  ) IS NULL
    AND pg_catalog.to_regprocedure(
      'public.aka_agent_snapshot_data_group_to_direct_campaign(bigint,bigint,text,bigint,bigint,timestamptz,text,text,text)'
    ) IS NOT NULL
  THEN
    ALTER FUNCTION public.aka_agent_snapshot_data_group_to_direct_campaign(
      bigint, bigint, text, bigint, bigint, timestamptz, text, text, text
    ) RENAME TO aka_agent_snapshot_data_group_to_direct_campaign_v205_internal;
  END IF;
END;
$preserve_v205_direct_snapshot$;

DO $patch_direct_snapshot_member_semantic_filter$
DECLARE
  v_signature regprocedure := pg_catalog.to_regprocedure(
    'public.aka_agent_snapshot_data_group_to_direct_campaign_v205_internal(bigint,bigint,text,bigint,bigint,timestamptz,text,text,text)'
  );
  v_definition text;
  v_old text := $old$
    v_has_relationship := false;

    SELECT contact.*
$old$;
  v_new text := $new$
    v_has_relationship := false;

    IF NOT public.aka_agent_data_group_membership_semantic_compatible(
      v_member.id, v_action, v_group.id
    ) THEN
      v_incompatible := v_incompatible + 1;
      CONTINUE;
    END IF;

    SELECT contact.*
$new$;
BEGIN
  IF v_signature IS NULL THEN
    RAISE EXCEPTION 'missing_v205_direct_snapshot';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(v_signature)
  INTO v_definition;
  IF pg_catalog.strpos(
    v_definition,
    'aka_agent_data_group_membership_semantic_compatible'
  ) = 0 THEN
    IF pg_catalog.strpos(v_definition, v_old) = 0 THEN
      RAISE EXCEPTION 'unexpected_direct_snapshot_member_loop_shape';
    END IF;
    EXECUTE pg_catalog.replace(v_definition, v_old, v_new);
  END IF;
END;
$patch_direct_snapshot_member_semantic_filter$;

CREATE OR REPLACE FUNCTION public.aka_agent_snapshot_data_group_to_direct_campaign(
  p_staff_id bigint,
  p_organization_id bigint,
  p_request_id text,
  p_campaign_id bigint,
  p_group_id bigint,
  p_campaign_schedule timestamptz,
  p_campaign_status text,
  p_auth_username text,
  p_auth_password text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_action_id text;
  v_completed_result jsonb;
BEGIN
  PERFORM public.auto_assert_automation_identity(
    p_staff_id, p_organization_id, p_auth_username, p_auth_password
  );

  -- Preserve the pre-v206 retry contract: once a request committed, let the
  -- installed implementation return its immutable result even if the group is
  -- subsequently retyped.
  SELECT batch.result
  INTO v_completed_result
  FROM public.auto_data_ingest_batches AS batch
  WHERE batch.staff_id = p_staff_id
    AND batch.organization_id = p_organization_id
    AND batch.request_id = btrim(COALESCE(p_request_id, ''))
    AND batch.operation = 'snapshot_campaign'
    AND batch.group_id = p_group_id
    AND batch.result IS NOT NULL;

  IF v_completed_result IS NULL THEN
    SELECT campaign.action_id
    INTO v_action_id
    FROM public.auto_campaigns AS campaign
    JOIN public.auto_account_contact_groups AS contact_group
      ON contact_group.id = p_group_id
     AND contact_group.staff_id = p_staff_id
     AND contact_group.organization_id = p_organization_id
     AND contact_group.purpose = 'data_group'
     AND contact_group.is_delete = false
    WHERE campaign.id = p_campaign_id
      AND campaign.staff_id = p_staff_id
      AND campaign.organization_id = p_organization_id
      AND COALESCE(campaign.is_delete, false) = false;

    IF v_action_id IS NOT NULL
      AND NOT public.aka_agent_data_group_type_compatible(
        p_group_id, v_action_id
      )
    THEN
      RAISE EXCEPTION 'data_group_campaign_semantic_type_incompatible';
    END IF;
  END IF;

  RETURN public.aka_agent_snapshot_data_group_to_direct_campaign_v205_internal(
    p_staff_id,
    p_organization_id,
    p_request_id,
    p_campaign_id,
    p_group_id,
    p_campaign_schedule,
    p_campaign_status,
    p_auth_username,
    p_auth_password
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.aka_agent_semantic_row_json(
  p_row jsonb
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT COALESCE(p_row, '{}'::jsonb)
    || jsonb_build_object(
      'data_type_category_code', category_item.code,
      'data_type_category_name', category_item.name
    )
  FROM (SELECT 1) AS singleton
  LEFT JOIN public.category_item AS category_item
    ON category_item.id = CASE
      WHEN COALESCE(p_row ->> 'data_type_category_item_id', '')
        ~ '^[1-9][0-9]*$'
      THEN (p_row ->> 'data_type_category_item_id')::bigint
      ELSE NULL
    END;
$$;

CREATE OR REPLACE FUNCTION public.aka_agent_campaign_input_semantic_json(
  p_input_data jsonb
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT public.aka_agent_semantic_row_json(p_input_data);
$$;

DO $patch_campaign_input_page_semantic_projection$
DECLARE
  v_signature regprocedure := pg_catalog.to_regprocedure(
    'public.aka_agent_list_campaign_input_data_page(bigint,bigint,bigint,text,text,timestamptz,timestamptz,text,integer,integer)'
  );
  v_definition text;
  v_old text :=
    'to_jsonb(paged) - ''page_total_count'' AS input_data';
  v_new text :=
    'public.aka_agent_campaign_input_semantic_json(to_jsonb(paged) - ''page_total_count'') AS input_data';
BEGIN
  IF v_signature IS NULL THEN
    RAISE EXCEPTION 'missing_campaign_input_data_page_rpc';
  END IF;
  SELECT pg_catalog.pg_get_functiondef(v_signature)
  INTO v_definition;

  IF pg_catalog.strpos(
    v_definition, 'aka_agent_campaign_input_semantic_json'
  ) = 0 THEN
    IF (
      pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(v_definition, v_old, ''))
    ) <> pg_catalog.length(v_old) THEN
      RAISE EXCEPTION 'unexpected_campaign_input_data_page_shape';
    END IF;
    EXECUTE pg_catalog.replace(v_definition, v_old, v_new);
  END IF;
END;
$patch_campaign_input_page_semantic_projection$;

-- ---------------------------------------------------------------------------
-- 9. Member and Data Set projections
-- ---------------------------------------------------------------------------

DO $preserve_v201_member_dataset_rpcs$
BEGIN
  IF pg_catalog.to_regprocedure(
    'public.aka_agent_list_data_group_members_v205_internal(bigint,bigint,bigint,text,bigint[],boolean,text[],text[],text,bigint[],bigint[],bigint[],integer,integer)'
  ) IS NULL
    AND pg_catalog.to_regprocedure(
      'public.aka_agent_list_data_group_members(bigint,bigint,bigint,text,bigint[],boolean,text[],text[],text,bigint[],bigint[],bigint[],integer,integer)'
    ) IS NOT NULL
  THEN
    ALTER FUNCTION public.aka_agent_list_data_group_members(
      bigint, bigint, bigint, text, bigint[], boolean, text[], text[],
      text, bigint[], bigint[], bigint[], integer, integer
    ) RENAME TO aka_agent_list_data_group_members_v205_internal;
  END IF;
  IF pg_catalog.to_regprocedure(
    'public.aka_agent_list_data_group_members_v205_auth_internal(bigint,bigint,bigint,text,bigint[],boolean,text[],text[],text,bigint[],bigint[],bigint[],integer,integer,text,text)'
  ) IS NULL
    AND pg_catalog.to_regprocedure(
      'public.aka_agent_list_data_group_members(bigint,bigint,bigint,text,bigint[],boolean,text[],text[],text,bigint[],bigint[],bigint[],integer,integer,text,text)'
    ) IS NOT NULL
  THEN
    ALTER FUNCTION public.aka_agent_list_data_group_members(
      bigint, bigint, bigint, text, bigint[], boolean, text[], text[],
      text, bigint[], bigint[], bigint[], integer, integer, text, text
    ) RENAME TO aka_agent_list_data_group_members_v205_auth_internal;
  END IF;

  IF pg_catalog.to_regprocedure(
    'public.aka_agent_list_data_group_datasets_v205_internal(bigint,bigint,bigint)'
  ) IS NULL
    AND pg_catalog.to_regprocedure(
      'public.aka_agent_list_data_group_datasets(bigint,bigint,bigint)'
    ) IS NOT NULL
  THEN
    ALTER FUNCTION public.aka_agent_list_data_group_datasets(
      bigint, bigint, bigint
    ) RENAME TO aka_agent_list_data_group_datasets_v205_internal;
  END IF;
  IF pg_catalog.to_regprocedure(
    'public.aka_agent_list_data_group_datasets_v205_auth_internal(bigint,bigint,bigint,text,text)'
  ) IS NULL
    AND pg_catalog.to_regprocedure(
      'public.aka_agent_list_data_group_datasets(bigint,bigint,bigint,text,text)'
    ) IS NOT NULL
  THEN
    ALTER FUNCTION public.aka_agent_list_data_group_datasets(
      bigint, bigint, bigint, text, text
    ) RENAME TO aka_agent_list_data_group_datasets_v205_auth_internal;
  END IF;
END;
$preserve_v201_member_dataset_rpcs$;

CREATE OR REPLACE FUNCTION public.aka_agent_list_data_group_members(
  p_staff_id bigint,
  p_organization_id bigint,
  p_group_id bigint,
  p_search text,
  p_account_ids bigint[],
  p_include_accountless boolean,
  p_contact_types text[],
  p_flatform_types text[],
  p_status text,
  p_dataset_ids bigint[],
  p_data_type_category_item_ids bigint[],
  p_ids bigint[],
  p_exclude_ids bigint[],
  p_offset integer,
  p_limit integer
)
RETURNS TABLE (
  id bigint,
  group_id bigint,
  contact_id bigint,
  name text,
  uid text,
  url text,
  phone text,
  email text,
  info1 text,
  info2 text,
  info3 text,
  info4 text,
  info5 text,
  contact_type text,
  flatform_type text,
  source_account_id bigint,
  source_account_name text,
  source_account_deleted boolean,
  dataset_ids bigint[],
  dataset_names text[],
  is_friend boolean,
  is_joined boolean,
  is_delete boolean,
  change_revision bigint,
  provenance jsonb,
  created_at timestamptz,
  updated_at timestamptz,
  primary_origin_id bigint,
  source_category_item_id bigint,
  source_code text,
  source_name text,
  source_automation_id bigint,
  source_automation_name text,
  data_type_category_item_id bigint,
  data_type_code text,
  data_type_name text,
  group_data_type_category_item_id bigint,
  group_data_type_code text,
  group_data_type_name text,
  total_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_effective_ids bigint[] := p_ids;
BEGIN
  IF p_data_type_category_item_ids IS NOT NULL THEN
    SELECT COALESCE(array_agg(member.id ORDER BY member.id), '{}'::bigint[])
    INTO v_effective_ids
    FROM public.auto_account_contact_group_members AS member
    WHERE member.group_id = p_group_id
      AND member.is_delete = false
      AND (
        p_ids IS NULL
        OR member.id = ANY(p_ids)
      )
      AND EXISTS (
        SELECT 1
        FROM public.auto_account_contact_group_member_origins
          AS primary_origin
        WHERE primary_origin.id = member.primary_origin_id
          AND primary_origin.membership_id = member.id
          AND primary_origin.is_current = true
          AND primary_origin.data_type_category_item_id =
            ANY(p_data_type_category_item_ids)
      );
  END IF;

  RETURN QUERY
  SELECT
    legacy.id,
    legacy.group_id,
    legacy.contact_id,
    legacy.name,
    legacy.uid,
    legacy.url,
    legacy.phone,
    legacy.email,
    legacy.info1,
    legacy.info2,
    legacy.info3,
    legacy.info4,
    legacy.info5,
    legacy.contact_type,
    legacy.flatform_type,
    legacy.source_account_id,
    legacy.source_account_name,
    legacy.source_account_deleted,
    legacy.dataset_ids,
    legacy.dataset_names,
    legacy.is_friend,
    legacy.is_joined,
    legacy.is_delete,
    legacy.change_revision,
    COALESCE(enriched_provenance.items, '[]'::jsonb),
    legacy.created_at,
    legacy.updated_at,
    legacy.primary_origin_id,
    legacy.source_category_item_id,
    legacy.source_code,
    legacy.source_name,
    legacy.source_automation_id,
    legacy.source_automation_name,
    primary_origin.data_type_category_item_id,
    primary_type.code,
    primary_type.name,
    contact_group.data_type_category_item_id,
    group_type.code,
    group_type.name,
    legacy.total_count
  FROM public.aka_agent_list_data_group_members_v205_internal(
    p_staff_id,
    p_organization_id,
    p_group_id,
    p_search,
    p_account_ids,
    p_include_accountless,
    p_contact_types,
    p_flatform_types,
    p_status,
    p_dataset_ids,
    v_effective_ids,
    p_exclude_ids,
    p_offset,
    p_limit
  ) AS legacy
  JOIN public.auto_account_contact_groups AS contact_group
    ON contact_group.id = legacy.group_id
  LEFT JOIN public.category_item AS group_type
    ON group_type.id = contact_group.data_type_category_item_id
  LEFT JOIN public.auto_account_contact_group_member_origins AS primary_origin
    ON primary_origin.id = legacy.primary_origin_id
   AND primary_origin.membership_id = legacy.id
   AND primary_origin.is_current = true
  LEFT JOIN public.category_item AS primary_type
    ON primary_type.id = primary_origin.data_type_category_item_id
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(
      provenance_item.value
      || jsonb_build_object(
        'data_type_category_item_id',
          provenance_origin.data_type_category_item_id,
        'data_type_code', provenance_type.code,
        'data_type_name', provenance_type.name
      )
      ORDER BY provenance_item.ordinality
    ) AS items
    FROM jsonb_array_elements(COALESCE(
      legacy.provenance, '[]'::jsonb
    )) WITH ORDINALITY AS provenance_item(value, ordinality)
    LEFT JOIN public.auto_account_contact_group_member_origins
      AS provenance_origin
      ON provenance_origin.id = CASE
        WHEN provenance_item.value ->> 'id' ~ '^[1-9][0-9]*$'
        THEN (provenance_item.value ->> 'id')::bigint
        ELSE NULL
      END
    LEFT JOIN public.category_item AS provenance_type
      ON provenance_type.id =
        provenance_origin.data_type_category_item_id
  ) AS enriched_provenance ON true;
END;
$$;

CREATE OR REPLACE FUNCTION public.aka_agent_list_data_group_members(
  p_staff_id bigint,
  p_organization_id bigint,
  p_group_id bigint,
  p_search text DEFAULT NULL,
  p_account_ids bigint[] DEFAULT NULL,
  p_include_accountless boolean DEFAULT true,
  p_contact_types text[] DEFAULT NULL,
  p_flatform_types text[] DEFAULT NULL,
  p_status text DEFAULT 'all',
  p_dataset_ids bigint[] DEFAULT NULL,
  p_ids bigint[] DEFAULT NULL,
  p_exclude_ids bigint[] DEFAULT NULL,
  p_offset integer DEFAULT 0,
  p_limit integer DEFAULT 100
)
RETURNS TABLE (
  id bigint,
  group_id bigint,
  contact_id bigint,
  name text,
  uid text,
  url text,
  phone text,
  email text,
  info1 text,
  info2 text,
  info3 text,
  info4 text,
  info5 text,
  contact_type text,
  flatform_type text,
  source_account_id bigint,
  source_account_name text,
  source_account_deleted boolean,
  dataset_ids bigint[],
  dataset_names text[],
  is_friend boolean,
  is_joined boolean,
  is_delete boolean,
  change_revision bigint,
  provenance jsonb,
  created_at timestamptz,
  updated_at timestamptz,
  primary_origin_id bigint,
  source_category_item_id bigint,
  source_code text,
  source_name text,
  source_automation_id bigint,
  source_automation_name text,
  data_type_category_item_id bigint,
  data_type_code text,
  data_type_name text,
  group_data_type_category_item_id bigint,
  group_data_type_code text,
  group_data_type_name text,
  total_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT *
  FROM public.aka_agent_list_data_group_members(
    p_staff_id, p_organization_id, p_group_id, p_search, p_account_ids,
    p_include_accountless, p_contact_types, p_flatform_types, p_status,
    p_dataset_ids, NULL, p_ids, p_exclude_ids, p_offset, p_limit
  );
$$;

CREATE OR REPLACE FUNCTION public.aka_agent_list_data_group_members(
  p_staff_id bigint,
  p_organization_id bigint,
  p_group_id bigint,
  p_search text,
  p_account_ids bigint[],
  p_include_accountless boolean,
  p_contact_types text[],
  p_flatform_types text[],
  p_status text,
  p_dataset_ids bigint[],
  p_data_type_category_item_ids bigint[],
  p_ids bigint[],
  p_exclude_ids bigint[],
  p_offset integer,
  p_limit integer,
  p_auth_username text,
  p_auth_password text
)
RETURNS TABLE (
  id bigint,
  group_id bigint,
  contact_id bigint,
  name text,
  uid text,
  url text,
  phone text,
  email text,
  info1 text,
  info2 text,
  info3 text,
  info4 text,
  info5 text,
  contact_type text,
  flatform_type text,
  source_account_id bigint,
  source_account_name text,
  source_account_deleted boolean,
  dataset_ids bigint[],
  dataset_names text[],
  is_friend boolean,
  is_joined boolean,
  is_delete boolean,
  change_revision bigint,
  provenance jsonb,
  created_at timestamptz,
  updated_at timestamptz,
  primary_origin_id bigint,
  source_category_item_id bigint,
  source_code text,
  source_name text,
  source_automation_id bigint,
  source_automation_name text,
  data_type_category_item_id bigint,
  data_type_code text,
  data_type_name text,
  group_data_type_category_item_id bigint,
  group_data_type_code text,
  group_data_type_name text,
  total_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT public.auto_assert_automation_identity(
    p_staff_id, p_organization_id, p_auth_username, p_auth_password
  );
  SELECT *
  FROM public.aka_agent_list_data_group_members(
    p_staff_id, p_organization_id, p_group_id, p_search, p_account_ids,
    p_include_accountless, p_contact_types, p_flatform_types, p_status,
    p_dataset_ids, p_data_type_category_item_ids, p_ids, p_exclude_ids,
    p_offset, p_limit
  );
$$;

CREATE OR REPLACE FUNCTION public.aka_agent_list_data_group_members(
  p_staff_id bigint,
  p_organization_id bigint,
  p_group_id bigint,
  p_search text,
  p_account_ids bigint[],
  p_include_accountless boolean,
  p_contact_types text[],
  p_flatform_types text[],
  p_status text,
  p_dataset_ids bigint[],
  p_ids bigint[],
  p_exclude_ids bigint[],
  p_offset integer,
  p_limit integer,
  p_auth_username text,
  p_auth_password text
)
RETURNS TABLE (
  id bigint,
  group_id bigint,
  contact_id bigint,
  name text,
  uid text,
  url text,
  phone text,
  email text,
  info1 text,
  info2 text,
  info3 text,
  info4 text,
  info5 text,
  contact_type text,
  flatform_type text,
  source_account_id bigint,
  source_account_name text,
  source_account_deleted boolean,
  dataset_ids bigint[],
  dataset_names text[],
  is_friend boolean,
  is_joined boolean,
  is_delete boolean,
  change_revision bigint,
  provenance jsonb,
  created_at timestamptz,
  updated_at timestamptz,
  primary_origin_id bigint,
  source_category_item_id bigint,
  source_code text,
  source_name text,
  source_automation_id bigint,
  source_automation_name text,
  data_type_category_item_id bigint,
  data_type_code text,
  data_type_name text,
  group_data_type_category_item_id bigint,
  group_data_type_code text,
  group_data_type_name text,
  total_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT *
  FROM public.aka_agent_list_data_group_members(
    p_staff_id, p_organization_id, p_group_id, p_search, p_account_ids,
    p_include_accountless, p_contact_types, p_flatform_types, p_status,
    p_dataset_ids, NULL, p_ids, p_exclude_ids, p_offset, p_limit,
    p_auth_username, p_auth_password
  );
$$;

CREATE OR REPLACE FUNCTION public.aka_agent_list_data_group_datasets(
  p_staff_id bigint,
  p_organization_id bigint,
  p_group_id bigint
)
RETURNS TABLE (
  id bigint,
  group_id bigint,
  name text,
  link text,
  description text,
  source text,
  account_id bigint,
  source_account_name text,
  source_account_deleted boolean,
  flatform_type text,
  contact_type text,
  scan_type text,
  source_key text,
  import_source text,
  contact_count integer,
  data_type_category_item_id bigint,
  data_type_code text,
  data_type_name text,
  is_delete boolean,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM public.aka_agent_internal_require_staff_tenant(
    p_staff_id, p_organization_id
  );
  IF NOT EXISTS (
    SELECT 1
    FROM public.auto_account_contact_groups AS contact_group
    WHERE contact_group.id = p_group_id
      AND contact_group.staff_id = p_staff_id
      AND contact_group.organization_id = p_organization_id
      AND contact_group.purpose = 'data_group'
      AND contact_group.is_delete = false
  ) THEN
    RAISE EXCEPTION 'data_group_not_found';
  END IF;

  RETURN QUERY
  SELECT
    dataset.id,
    COALESCE(dataset.group_id, dataset.auto_data_group_id),
    dataset.name,
    dataset.link,
    dataset.description,
    dataset.source,
    dataset.account_id,
    account.name,
    COALESCE(account.is_delete, false),
    dataset.flatform_type,
    dataset.contact_type,
    dataset.scan_type,
    dataset.source_key,
    NULLIF(dataset.extra_data ->> 'importSource', ''),
    (
      SELECT count(DISTINCT member.id)::integer
      FROM public.auto_account_contact_group_member_origins AS origin
      JOIN public.auto_account_contact_group_members AS member
        ON member.id = origin.membership_id
      WHERE member.group_id = p_group_id
        AND member.is_delete = false
        AND origin.dataset_id = dataset.id
        AND origin.is_current = true
    ),
    dataset.data_type_category_item_id,
    data_type_item.code,
    data_type_item.name,
    dataset.is_delete,
    dataset.created_at,
    dataset.updated_at
  FROM public.auto_account_contacts_dataset AS dataset
  LEFT JOIN public.auto_accounts AS account
    ON account.id = dataset.account_id
  LEFT JOIN public.category_item AS data_type_item
    ON data_type_item.id = dataset.data_type_category_item_id
  WHERE dataset.staff_id = p_staff_id
    AND dataset.organization_id = p_organization_id
    AND dataset.is_delete = false
    AND (
      dataset.group_id = p_group_id
      OR dataset.auto_data_group_id = p_group_id
      OR EXISTS (
        SELECT 1
        FROM public.auto_account_contact_group_member_origins AS origin
        JOIN public.auto_account_contact_group_members AS member
          ON member.id = origin.membership_id
        WHERE member.group_id = p_group_id
          AND origin.dataset_id = dataset.id
      )
    )
  ORDER BY dataset.updated_at DESC, dataset.id DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.aka_agent_list_data_group_datasets(
  p_staff_id bigint,
  p_organization_id bigint,
  p_group_id bigint,
  p_auth_username text,
  p_auth_password text
)
RETURNS TABLE (
  id bigint,
  group_id bigint,
  name text,
  link text,
  description text,
  source text,
  account_id bigint,
  source_account_name text,
  source_account_deleted boolean,
  flatform_type text,
  contact_type text,
  scan_type text,
  source_key text,
  import_source text,
  contact_count integer,
  data_type_category_item_id bigint,
  data_type_code text,
  data_type_name text,
  is_delete boolean,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT public.auto_assert_automation_identity(
    p_staff_id, p_organization_id, p_auth_username, p_auth_password
  );
  SELECT *
  FROM public.aka_agent_list_data_group_datasets(
    p_staff_id, p_organization_id, p_group_id
  );
$$;

-- ---------------------------------------------------------------------------
-- 10. Data Set and Data Group ingest writers
-- ---------------------------------------------------------------------------

DO $preserve_v205_dataset_writers$
BEGIN
  IF pg_catalog.to_regprocedure(
    'public.aka_agent_finalize_contact_dataset_v205_internal(bigint,bigint,bigint,text,text,text,text,text,text,text,text[],jsonb)'
  ) IS NULL
    AND pg_catalog.to_regprocedure(
      'public.aka_agent_finalize_contact_dataset(bigint,bigint,bigint,text,text,text,text,text,text,text,text[],jsonb)'
    ) IS NOT NULL
  THEN
    ALTER FUNCTION public.aka_agent_finalize_contact_dataset(
      bigint, bigint, bigint, text, text, text, text, text, text, text,
      text[], jsonb
    ) RENAME TO aka_agent_finalize_contact_dataset_v205_internal;
  END IF;

  IF pg_catalog.to_regprocedure(
    'public.aka_agent_save_upload_contact_datasets_v205_internal(bigint,bigint,bigint[],text,text,text,text,text,text,text,text,jsonb,jsonb)'
  ) IS NULL
    AND pg_catalog.to_regprocedure(
      'public.aka_agent_save_upload_contact_datasets(bigint,bigint,bigint[],text,text,text,text,text,text,text,text,jsonb,jsonb)'
    ) IS NOT NULL
  THEN
    ALTER FUNCTION public.aka_agent_save_upload_contact_datasets(
      bigint, bigint, bigint[], text, text, text, text, text, text, text,
      text, jsonb, jsonb
    ) RENAME TO aka_agent_save_upload_contact_datasets_v205_internal;
  END IF;
END;
$preserve_v205_dataset_writers$;

CREATE OR REPLACE FUNCTION public.aka_agent_finalize_contact_dataset(
  p_staff_id bigint,
  p_organization_id bigint,
  p_account_id bigint,
  p_scan_type text,
  p_contact_type text,
  p_source_key text,
  p_name text,
  p_link text,
  p_description text,
  p_status text,
  p_contact_uids text[],
  p_extra_data jsonb,
  p_data_type_category_item_id bigint DEFAULT NULL
)
RETURNS SETOF public.auto_account_contacts_dataset
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_previous_context text :=
    current_setting('aka_agent.data_type_category_item_id', true);
BEGIN
  IF p_data_type_category_item_id IS NOT NULL
    AND NOT public.aka_agent_is_data_type_category_item(
      p_data_type_category_item_id, true
    )
  THEN
    RAISE EXCEPTION 'invalid_data_type_category_item';
  END IF;

  PERFORM set_config(
    'aka_agent.data_type_category_item_id',
    COALESCE(p_data_type_category_item_id::text, 'null'),
    true
  );
  RETURN QUERY
  SELECT *
  FROM public.aka_agent_finalize_contact_dataset_v205_internal(
    p_staff_id,
    p_organization_id,
    p_account_id,
    p_scan_type,
    p_contact_type,
    p_source_key,
    p_name,
    p_link,
    p_description,
    p_status,
    p_contact_uids,
    p_extra_data
  );
  PERFORM set_config(
    'aka_agent.data_type_category_item_id',
    COALESCE(v_previous_context, ''),
    true
  );
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config(
    'aka_agent.data_type_category_item_id',
    COALESCE(v_previous_context, ''),
    true
  );
  RAISE;
END;
$$;

CREATE OR REPLACE FUNCTION public.aka_agent_save_upload_contact_datasets(
  p_staff_id bigint,
  p_organization_id bigint,
  p_account_ids bigint[],
  p_name text,
  p_flatform_type text,
  p_contact_type text,
  p_action_id text,
  p_import_source text,
  p_source_link text,
  p_description text,
  p_source_key_prefix text,
  p_contacts jsonb,
  p_extra_data jsonb,
  p_data_type_category_item_id bigint DEFAULT NULL
)
RETURNS SETOF public.auto_account_contacts_dataset
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_previous_context text :=
    current_setting('aka_agent.data_type_category_item_id', true);
  v_phone_type bigint :=
    public.aka_agent_data_type_category_item_id('phone');
  v_effective_type bigint := p_data_type_category_item_id;
  v_semantic_source_key_prefix text;
BEGIN
  IF p_data_type_category_item_id IS NOT NULL
    AND NOT public.aka_agent_is_data_type_category_item(
      p_data_type_category_item_id, true
    )
  THEN
    RAISE EXCEPTION 'invalid_data_type_category_item';
  END IF;
  IF p_action_id = 'zalo_add_group_member'
    AND (
      p_contact_type IS DISTINCT FROM 'phone'
      OR COALESCE(p_data_type_category_item_id, v_phone_type)
        IS DISTINCT FROM v_phone_type
    )
  THEN
    RAISE EXCEPTION 'zalo_add_group_member_upload_requires_phone';
  END IF;
  IF p_action_id = 'zalo_add_group_member' THEN
    v_effective_type := v_phone_type;
  END IF;
  IF p_action_id = 'facebook_comment_seeding'
    AND p_data_type_category_item_id IS NOT NULL
  THEN
    RAISE EXCEPTION 'facebook_comment_seeding_upload_must_be_unrestricted';
  END IF;
  IF p_action_id = 'facebook_comment_seeding' THEN
    v_effective_type := NULL;
  ELSIF v_effective_type IS NULL THEN
    v_effective_type := public.aka_agent_derive_dataset_data_type(
      'upload',
      p_flatform_type,
      p_contact_type,
      'upload_data',
      COALESCE(p_extra_data, '{}'::jsonb)
        || jsonb_build_object('actionId', p_action_id)
    );
  END IF;

  SELECT btrim(p_source_key_prefix)
    || ':data-type:'
    || COALESCE(category_item.code, 'unrestricted')
  INTO v_semantic_source_key_prefix
  FROM (SELECT 1) AS singleton
  LEFT JOIN public.category_item AS category_item
    ON category_item.id = v_effective_type;

  PERFORM set_config(
    'aka_agent.data_type_category_item_id',
    COALESCE(v_effective_type::text, 'null'),
    true
  );
  RETURN QUERY
  SELECT *
  FROM public.aka_agent_save_upload_contact_datasets_v205_internal(
    p_staff_id,
    p_organization_id,
    p_account_ids,
    p_name,
    p_flatform_type,
    p_contact_type,
    p_action_id,
    p_import_source,
    p_source_link,
    p_description,
    v_semantic_source_key_prefix,
    p_contacts,
    p_extra_data
  );
  PERFORM set_config(
    'aka_agent.data_type_category_item_id',
    COALESCE(v_previous_context, ''),
    true
  );
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config(
    'aka_agent.data_type_category_item_id',
    COALESCE(v_previous_context, ''),
    true
  );
  RAISE;
END;
$$;

ALTER FUNCTION public.aka_agent_save_upload_contact_datasets(
  bigint, bigint, bigint[], text, text, text, text, text, text, text,
  text, jsonb, jsonb, bigint
)
SET statement_timeout TO '120s';

CREATE OR REPLACE FUNCTION public.aka_agent_ingest_data_group(
  p_staff_id bigint,
  p_organization_id bigint,
  p_request_id text,
  p_group_id bigint,
  p_kind text,
  p_rows jsonb,
  p_dataset_id bigint,
  p_dataset_name text,
  p_import_source text,
  p_source_account_id bigint,
  p_source_name text,
  p_payload_hash text,
  p_data_type_category_item_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_group_type bigint;
  v_effective_type bigint := p_data_type_category_item_id;
  v_previous_context text :=
    current_setting('aka_agent.data_type_category_item_id', true);
  v_semantic_payload_hash text;
  v_result jsonb;
BEGIN
  PERFORM public.aka_agent_internal_require_staff_tenant(
    p_staff_id, p_organization_id
  );
  IF p_data_type_category_item_id IS NOT NULL
    AND NOT public.aka_agent_is_data_type_category_item(
      p_data_type_category_item_id, true
    )
  THEN
    RAISE EXCEPTION 'invalid_data_type_category_item';
  END IF;

  SELECT contact_group.data_type_category_item_id
  INTO v_group_type
  FROM public.auto_account_contact_groups AS contact_group
  WHERE contact_group.id = p_group_id
    AND contact_group.staff_id = p_staff_id
    AND contact_group.organization_id = p_organization_id
    AND contact_group.purpose = 'data_group'
    AND contact_group.is_delete = false
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'data_group_not_found';
  END IF;

  IF p_dataset_id IS NOT NULL AND v_effective_type IS NULL THEN
    SELECT dataset.data_type_category_item_id
    INTO v_effective_type
    FROM public.auto_account_contacts_dataset AS dataset
    WHERE dataset.id = p_dataset_id
      AND dataset.staff_id = p_staff_id
      AND dataset.organization_id = p_organization_id
      AND dataset.is_delete = false;
  END IF;

  IF v_group_type IS NOT NULL
    AND v_effective_type IS DISTINCT FROM v_group_type
  THEN
    RAISE EXCEPTION 'data_group_ingest_semantic_type_mismatch';
  END IF;

  v_semantic_payload_hash := md5(
    COALESCE(
      NULLIF(btrim(COALESCE(p_payload_hash, '')), ''),
      md5(COALESCE(p_rows, 'null'::jsonb)::text)
    )
    || ':data_type:'
    || COALESCE(v_effective_type::text, 'null')
  );

  PERFORM set_config(
    'aka_agent.data_type_category_item_id',
    COALESCE(v_effective_type::text, 'null'),
    true
  );
  v_result := public.aka_agent_ingest_data_group(
    p_staff_id,
    p_organization_id,
    p_request_id,
    p_group_id,
    p_kind,
    p_rows,
    p_dataset_id,
    p_dataset_name,
    p_import_source,
    p_source_account_id,
    p_source_name,
    v_semantic_payload_hash
  );
  PERFORM set_config(
    'aka_agent.data_type_category_item_id',
    COALESCE(v_previous_context, ''),
    true
  );
  RETURN v_result;
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config(
    'aka_agent.data_type_category_item_id',
    COALESCE(v_previous_context, ''),
    true
  );
  RAISE;
END;
$$;

CREATE OR REPLACE FUNCTION public.aka_agent_ingest_data_group(
  p_staff_id bigint,
  p_organization_id bigint,
  p_request_id text,
  p_group_id bigint,
  p_kind text,
  p_rows jsonb,
  p_dataset_id bigint,
  p_dataset_name text,
  p_import_source text,
  p_source_account_id bigint,
  p_source_name text,
  p_payload_hash text,
  p_data_type_category_item_id bigint,
  p_auth_username text,
  p_auth_password text
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT public.auto_assert_automation_identity(
    p_staff_id, p_organization_id, p_auth_username, p_auth_password
  );
  SELECT public.aka_agent_ingest_data_group(
    p_staff_id,
    p_organization_id,
    p_request_id,
    p_group_id,
    p_kind,
    p_rows,
    p_dataset_id,
    p_dataset_name,
    p_import_source,
    p_source_account_id,
    p_source_name,
    p_payload_hash,
    p_data_type_category_item_id
  );
$$;



DO $patch_copied_origin_semantic_type$
DECLARE
  v_signature text;
  v_oid regprocedure;
  v_definition text;
  v_old_columns text :=
    'source_name_snapshot, relationship_kind, is_current, created_at, updated_at';
  v_new_columns text :=
    'source_name_snapshot, relationship_kind, data_type_category_item_id, is_current, created_at, updated_at';
  v_old_values text :=
    'origin.source_name_snapshot, origin.relationship_kind, true, now(), now()';
  v_new_values text :=
    'origin.source_name_snapshot, origin.relationship_kind, origin.data_type_category_item_id, true, now(), now()';
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'public.aka_agent_duplicate_data_group(bigint,bigint,bigint,text,text)',
    'public.aka_agent_move_data_group_members(bigint,bigint,text,bigint,bigint[],bigint)'
  ] LOOP
    v_oid := pg_catalog.to_regprocedure(v_signature);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'missing_data_group_origin_copy:%', v_signature;
    END IF;
    SELECT pg_catalog.pg_get_functiondef(v_oid)
    INTO v_definition;

    IF pg_catalog.strpos(
      v_definition, 'origin.data_type_category_item_id'
    ) = 0 THEN
      IF (
        pg_catalog.length(v_definition)
        - pg_catalog.length(pg_catalog.replace(
            v_definition, v_old_columns, ''
          ))
      ) <> pg_catalog.length(v_old_columns)
        OR (
          pg_catalog.length(v_definition)
          - pg_catalog.length(pg_catalog.replace(
              v_definition, v_old_values, ''
            ))
        ) <> pg_catalog.length(v_old_values)
      THEN
        RAISE EXCEPTION 'unexpected_data_group_origin_copy_shape:%',
          v_signature;
      END IF;
      v_definition := pg_catalog.replace(
        v_definition, v_old_columns, v_new_columns
      );
      v_definition := pg_catalog.replace(
        v_definition, v_old_values, v_new_values
      );
      EXECUTE v_definition;
    END IF;
  END LOOP;
END;
$patch_copied_origin_semantic_type$;

DO $patch_duplicate_group_semantic_type$
DECLARE
  v_oid regprocedure := pg_catalog.to_regprocedure(
    'public.aka_agent_duplicate_data_group(bigint,bigint,bigint,text,text)'
  );
  v_definition text;
  v_old_columns text :=
    'is_delete, staff_id, organization_id';
  v_new_columns text :=
    'data_type_category_item_id, dataset_sync_mode, dataset_sync_key, is_delete, staff_id, organization_id';
  v_old_values text :=
    'false, p_staff_id, p_organization_id
  ) RETURNING * INTO v_target';
  v_new_values text :=
    'v_source.data_type_category_item_id, ''manual'', NULL,
    false, p_staff_id, p_organization_id
  ) RETURNING * INTO v_target';
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'missing_duplicate_data_group_rpc';
  END IF;
  SELECT pg_catalog.pg_get_functiondef(v_oid)
  INTO v_definition;

  IF pg_catalog.strpos(
    v_definition,
    'v_source.data_type_category_item_id'
  ) = 0 THEN
    IF (
      pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(
          v_definition, v_old_columns, ''
        ))
    ) <> pg_catalog.length(v_old_columns)
      OR (
        pg_catalog.length(v_definition)
        - pg_catalog.length(pg_catalog.replace(
            v_definition, v_old_values, ''
          ))
      ) <> pg_catalog.length(v_old_values)
      OR pg_catalog.strpos(
        v_definition,
        'to_jsonb(v_target) || jsonb_build_object(''active_membership_count'','
      ) = 0
    THEN
      RAISE EXCEPTION 'unexpected_duplicate_data_group_shape';
    END IF;
    v_definition := pg_catalog.replace(
      v_definition, v_old_columns, v_new_columns
    );
    v_definition := pg_catalog.replace(
      v_definition, v_old_values, v_new_values
    );
    v_definition := pg_catalog.replace(
      v_definition,
      'to_jsonb(v_target) || jsonb_build_object(''active_membership_count'',',
      'to_jsonb(v_target) || public.aka_agent_data_type_json(v_target.data_type_category_item_id) || jsonb_build_object(''active_membership_count'','
    );
    EXECUTE v_definition;
  END IF;
END;
$patch_duplicate_group_semantic_type$;

DO $patch_move_group_semantic_type$
DECLARE
  v_oid regprocedure := pg_catalog.to_regprocedure(
    'public.aka_agent_move_data_group_members(bigint,bigint,text,bigint,bigint[],bigint)'
  );
  v_definition text;
  v_old_preflight text := $old$
  IF v_source_group.id IS NULL OR v_target_group.id IS NULL THEN
    RAISE EXCEPTION 'data_group_not_found';
  END IF;

  v_request_hash := md5(jsonb_build_object(
$old$;
  v_new_preflight text := $new$
  IF v_source_group.id IS NULL OR v_target_group.id IS NULL THEN
    RAISE EXCEPTION 'data_group_not_found';
  END IF;

  IF v_target_group.data_type_category_item_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.auto_account_contact_group_members AS member
      WHERE member.group_id = v_source_group.id
        AND member.id = ANY(p_membership_ids)
        AND member.is_delete = false
        AND (
          NOT EXISTS (
            SELECT 1
            FROM public.auto_account_contact_group_member_origins AS origin
            WHERE origin.membership_id = member.id
              AND origin.is_current = true
          )
          OR EXISTS (
            SELECT 1
            FROM public.auto_account_contact_group_member_origins AS origin
            WHERE origin.membership_id = member.id
              AND origin.is_current = true
              AND origin.data_type_category_item_id IS DISTINCT FROM
                v_target_group.data_type_category_item_id
          )
        )
    )
  THEN
    RAISE EXCEPTION 'data_group_move_semantic_type_mismatch';
  END IF;

  v_request_hash := md5(jsonb_build_object(
$new$;
  v_old_manual_origin text := $old$
      INSERT INTO public.auto_account_contact_group_member_origins (
        membership_id, kind, batch_id, source_name_snapshot, is_current
      ) VALUES (
        v_target_member.id, 'manual', v_batch.id,
        'move:' || v_source_group.name, true
      ) ON CONFLICT DO NOTHING;
$old$;
  v_new_manual_origin text := $new$
      INSERT INTO public.auto_account_contact_group_member_origins (
        membership_id, kind, batch_id, source_name_snapshot, is_current,
        data_type_category_item_id
      ) VALUES (
        v_target_member.id, 'manual', v_batch.id,
        'move:' || v_source_group.name, true,
        (
          SELECT min(origin.data_type_category_item_id)
          FROM public.auto_account_contact_group_member_origins AS origin
          WHERE origin.membership_id = v_source_member.id
            AND origin.is_current = true
          HAVING count(*) > 0
            AND count(origin.data_type_category_item_id) = count(*)
            AND count(DISTINCT origin.data_type_category_item_id) = 1
        )
      ) ON CONFLICT DO NOTHING;
$new$;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'missing_move_data_group_members_rpc';
  END IF;
  SELECT pg_catalog.pg_get_functiondef(v_oid)
  INTO v_definition;

  IF pg_catalog.strpos(
    v_definition, 'data_group_move_semantic_type_mismatch'
  ) = 0 THEN
    IF pg_catalog.strpos(v_definition, v_old_preflight) = 0
      OR pg_catalog.strpos(v_definition, v_old_manual_origin) = 0
    THEN
      RAISE EXCEPTION 'unexpected_move_data_group_members_shape';
    END IF;
    v_definition := pg_catalog.replace(
      v_definition, v_old_preflight, v_new_preflight
    );
    v_definition := pg_catalog.replace(
      v_definition, v_old_manual_origin, v_new_manual_origin
    );
    EXECUTE v_definition;
  END IF;
END;
$patch_move_group_semantic_type$;

CREATE OR REPLACE FUNCTION public.aka_agent_update_data_group(
  p_staff_id bigint,
  p_organization_id bigint,
  p_group_id bigint,
  p_name text DEFAULT NULL,
  p_color text DEFAULT NULL,
  p_sort_order integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT public.aka_agent_update_data_group(
    p_staff_id, p_organization_id, p_group_id, p_name, p_color,
    p_sort_order, NULL, false
  );
$$;

CREATE OR REPLACE FUNCTION public.aka_agent_update_data_group(
  p_staff_id bigint,
  p_organization_id bigint,
  p_group_id bigint,
  p_name text,
  p_color text,
  p_sort_order integer,
  p_auth_username text,
  p_auth_password text
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT public.aka_agent_update_data_group(
    p_staff_id, p_organization_id, p_group_id, p_name, p_color,
    p_sort_order, NULL, false, p_auth_username, p_auth_password
  );
$$;

-- ---------------------------------------------------------------------------
-- 12. Automation semantic contracts and projections
-- ---------------------------------------------------------------------------

DO $patch_legacy_automation_validator_semantic_context$
DECLARE
  -- Some production databases promoted the exact-time wrapper directly on
  -- top of v173 and therefore never retained the otherwise equivalent v176
  -- helper. Patch whichever installed base validator actually owns the
  -- campaign-action mapping checks.
  v_signature regprocedure := COALESCE(
    pg_catalog.to_regprocedure(
      'public.auto_validate_automation_rule_v176_internal(bigint,bigint,bigint,bigint,bigint,text,bigint,text,integer,integer,timestamptz,boolean,boolean,integer,text,time without time zone)'
    ),
    pg_catalog.to_regprocedure(
      'public.auto_validate_automation_rule_v173_internal(bigint,bigint,bigint,bigint,bigint,text,bigint,text,integer,integer,timestamptz,boolean,boolean,integer,text,time without time zone)'
    )
  );
  v_definition text;
  v_source_old text :=
    'AND mapping.data_type_code = p_data_type_code
      AND mapping.can_source = true';
  v_source_new text :=
    'AND mapping.data_type_code = p_data_type_code
      AND mapping.data_type_category_item_id IS NOT DISTINCT FROM
        COALESCE(
          public.aka_agent_current_data_type_category_item_id(),
          public.aka_agent_legacy_action_semantic_type(
            v_source.action_id, p_data_type_code
          )
        )
      AND mapping.can_source = true';
  v_target_old text :=
    'AND mapping.data_type_code = p_data_type_code
    AND mapping.can_target = true';
  v_target_new text :=
    'AND mapping.data_type_code = p_data_type_code
    AND mapping.data_type_category_item_id IS NOT DISTINCT FROM
      COALESCE(
        public.aka_agent_current_data_type_category_item_id(),
        public.aka_agent_legacy_action_semantic_type(
          v_target.action_id, p_data_type_code
        )
      )
    AND mapping.can_target = true';
BEGIN
  IF v_signature IS NULL THEN
    RAISE EXCEPTION 'missing_automation_rule_validator';
  END IF;
  SELECT pg_catalog.pg_get_functiondef(v_signature)
  INTO v_definition;
  IF pg_catalog.strpos(
    v_definition, 'aka_agent_current_data_type_category_item_id'
  ) = 0 THEN
    IF pg_catalog.strpos(v_definition, v_source_old) = 0
      OR pg_catalog.strpos(v_definition, v_target_old) = 0
    THEN
      RAISE EXCEPTION 'unexpected_automation_rule_validator_shape';
    END IF;
    v_definition := pg_catalog.replace(
      v_definition, v_source_old, v_source_new
    );
    v_definition := pg_catalog.replace(
      v_definition, v_target_old, v_target_new
    );
    EXECUTE v_definition;
  END IF;
END;
$patch_legacy_automation_validator_semantic_context$;

DO $patch_automation_json_projections$
DECLARE
  v_signature regprocedure;
  v_definition text;
  v_old text;
  v_new text;
BEGIN
  v_signature := pg_catalog.to_regprocedure(
    'public.auto_automation_to_json(bigint,bigint,bigint)'
  );
  IF v_signature IS NULL THEN
    RAISE EXCEPTION 'missing_auto_automation_to_json';
  END IF;
  SELECT pg_catalog.pg_get_functiondef(v_signature)
  INTO v_definition;
  IF pg_catalog.strpos(v_definition, 'aka_agent_semantic_row_json') = 0 THEN
    v_old := 'to_jsonb(automation)
    || jsonb_build_object(';
    v_new := 'public.aka_agent_semantic_row_json(to_jsonb(automation))
    || jsonb_build_object(';
    IF pg_catalog.strpos(v_definition, v_old) = 0 THEN
      RAISE EXCEPTION 'unexpected_automation_json_shape';
    END IF;
    EXECUTE pg_catalog.replace(v_definition, v_old, v_new);
  END IF;

  v_signature := pg_catalog.to_regprocedure(
    'public.aka_agent_get_automation_options(bigint,bigint,text,text)'
  );
  IF v_signature IS NULL THEN
    RAISE EXCEPTION 'missing_automation_options_rpc';
  END IF;
  SELECT pg_catalog.pg_get_functiondef(v_signature)
  INTO v_definition;
  IF pg_catalog.strpos(
    v_definition,
    'aka_agent_semantic_row_json(to_jsonb(mapping))'
  ) = 0 THEN
    v_old := 'jsonb_agg(to_jsonb(mapping) ORDER BY mapping.sort_order, mapping.campaign_action_id, mapping.data_type_code)';
    v_new := 'jsonb_agg(public.aka_agent_semantic_row_json(to_jsonb(mapping)) ORDER BY mapping.sort_order, mapping.campaign_action_id, mapping.data_type_code, mapping.data_type_category_item_id)';
    IF pg_catalog.strpos(v_definition, v_old) = 0 THEN
      RAISE EXCEPTION 'unexpected_automation_options_shape';
    END IF;
    EXECUTE pg_catalog.replace(v_definition, v_old, v_new);
  END IF;

  v_signature := pg_catalog.to_regprocedure(
    'public.aka_agent_list_automation_details(bigint,bigint,bigint,text,integer,integer,text,text)'
  );
  IF v_signature IS NULL THEN
    RAISE EXCEPTION 'missing_automation_details_rpc';
  END IF;
  SELECT pg_catalog.pg_get_functiondef(v_signature)
  INTO v_definition;
  IF pg_catalog.strpos(v_definition, 'aka_agent_semantic_row_json') = 0 THEN
    v_old := 'to_jsonb(detail) || jsonb_build_object(';
    v_new := 'public.aka_agent_semantic_row_json(to_jsonb(detail)) || jsonb_build_object(';
    IF pg_catalog.strpos(v_definition, v_old) = 0 THEN
      RAISE EXCEPTION 'unexpected_automation_details_shape';
    END IF;
    EXECUTE pg_catalog.replace(v_definition, v_old, v_new);
  END IF;

  v_signature := pg_catalog.to_regprocedure(
    'public.aka_agent_list_campaign_automation_details(bigint,bigint,bigint,text,text,text,timestamptz,timestamptz,integer,integer,text,text)'
  );
  IF v_signature IS NULL THEN
    RAISE EXCEPTION 'missing_campaign_automation_details_rpc';
  END IF;
  SELECT pg_catalog.pg_get_functiondef(v_signature)
  INTO v_definition;
  IF pg_catalog.strpos(v_definition, 'aka_agent_semantic_row_json') = 0 THEN
    v_old := 'to_jsonb(page)
      || jsonb_build_object(';
    v_new := 'public.aka_agent_semantic_row_json(to_jsonb(page))
      || jsonb_build_object(';
    IF pg_catalog.strpos(v_definition, v_old) = 0 THEN
      RAISE EXCEPTION 'unexpected_campaign_automation_details_shape';
    END IF;
    EXECUTE pg_catalog.replace(v_definition, v_old, v_new);
  END IF;
END;
$patch_automation_json_projections$;

DO $preserve_v202_automation_save$
BEGIN
  IF pg_catalog.to_regprocedure(
    'public.aka_agent_save_automation_v205_internal(bigint,bigint,bigint,text,bigint,bigint,text,bigint,bigint,text,integer,integer,timestamptz,text,boolean,jsonb,text,text,integer,text,time without time zone,time without time zone,boolean)'
  ) IS NULL
    AND pg_catalog.to_regprocedure(
      'public.aka_agent_save_automation(bigint,bigint,bigint,text,bigint,bigint,text,bigint,bigint,text,integer,integer,timestamptz,text,boolean,jsonb,text,text,integer,text,time without time zone,time without time zone,boolean)'
    ) IS NOT NULL
  THEN
    ALTER FUNCTION public.aka_agent_save_automation(
      bigint, bigint, bigint, text, bigint, bigint, text, bigint, bigint,
      text, integer, integer, timestamptz, text, boolean, jsonb, text,
      text, integer, text, time without time zone, time without time zone,
      boolean
    ) RENAME TO aka_agent_save_automation_v205_internal;
  END IF;
END;
$preserve_v202_automation_save$;

CREATE OR REPLACE FUNCTION public.aka_agent_save_automation(
  p_staff_id bigint,
  p_organization_id bigint,
  p_automation_id bigint,
  p_name text,
  p_source_campaign_id bigint,
  p_target_campaign_id bigint,
  p_data_type_code text,
  p_target_contact_group_id bigint,
  p_target_data_group_id bigint,
  p_schedule_mode text,
  p_delay_days integer,
  p_delay_hours integer,
  p_fixed_at timestamptz,
  p_note text,
  p_is_active boolean,
  p_trigger_statuses jsonb,
  p_data_type_category_item_id bigint,
  p_auth_username text DEFAULT NULL,
  p_auth_password text DEFAULT NULL,
  p_delay_value integer DEFAULT NULL,
  p_delay_unit text DEFAULT NULL,
  p_daily_time time without time zone DEFAULT NULL,
  p_delay_exact_time time without time zone DEFAULT NULL,
  p_delay_exact_time_present boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_saved jsonb;
  v_rule_id bigint;
  v_previous_context text :=
    current_setting('aka_agent.data_type_category_item_id', true);
BEGIN
  PERFORM public.auto_assert_automation_identity(
    p_staff_id, p_organization_id, p_auth_username, p_auth_password
  );
  IF p_data_type_category_item_id IS NOT NULL
    AND NOT public.aka_agent_is_data_type_category_item(
      p_data_type_category_item_id, true
    )
  THEN
    RAISE EXCEPTION 'invalid_data_type_category_item';
  END IF;

  PERFORM set_config(
    'aka_agent.data_type_category_item_id',
    COALESCE(p_data_type_category_item_id::text, 'null'),
    true
  );

  -- The installed v202 save path updates routing columns before this wrapper
  -- can stamp a changed semantic value. Clear only an A -> B/A -> NULL
  -- transition; ordinary typed edits retain A so pure deactivation and
  -- no-op semantic saves preserve their established trigger contract.
  IF p_automation_id IS NOT NULL THEN
    UPDATE public.auto_automation AS automation
    SET data_type_category_item_id = NULL
    WHERE automation.id = p_automation_id
      AND automation.staff_id = p_staff_id
      AND automation.organization_id = p_organization_id
      AND automation.is_delete = false
      AND automation.data_type_category_item_id IS NOT NULL
      AND automation.data_type_category_item_id IS DISTINCT FROM
        p_data_type_category_item_id;
  END IF;

  v_saved := public.aka_agent_save_automation_v205_internal(
    p_staff_id,
    p_organization_id,
    p_automation_id,
    p_name,
    p_source_campaign_id,
    p_target_campaign_id,
    p_data_type_code,
    p_target_contact_group_id,
    p_target_data_group_id,
    p_schedule_mode,
    p_delay_days,
    p_delay_hours,
    p_fixed_at,
    p_note,
    p_is_active,
    p_trigger_statuses,
    p_auth_username,
    p_auth_password,
    p_delay_value,
    p_delay_unit,
    p_daily_time,
    p_delay_exact_time,
    p_delay_exact_time_present
  );

  IF COALESCE(v_saved ->> 'id', '') !~ '^[1-9][0-9]*$' THEN
    RAISE EXCEPTION 'automation_save_result_invalid';
  END IF;
  v_rule_id := (v_saved ->> 'id')::bigint;

  UPDATE public.auto_automation AS automation
  SET data_type_category_item_id = p_data_type_category_item_id
  WHERE automation.id = v_rule_id
    AND automation.staff_id = p_staff_id
    AND automation.organization_id = p_organization_id
    AND automation.is_delete = false
    AND automation.data_type_category_item_id IS DISTINCT FROM
      p_data_type_category_item_id;
  IF NOT FOUND THEN
    PERFORM 1
    FROM public.auto_automation AS automation
    WHERE automation.id = v_rule_id
      AND automation.staff_id = p_staff_id
      AND automation.organization_id = p_organization_id
      AND automation.is_delete = false
      AND automation.data_type_category_item_id IS NOT DISTINCT FROM
        p_data_type_category_item_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'automation_not_found';
    END IF;
  END IF;

  PERFORM set_config(
    'aka_agent.data_type_category_item_id',
    COALESCE(v_previous_context, ''),
    true
  );
  RETURN public.auto_automation_to_json(
    v_rule_id, p_staff_id, p_organization_id
  );
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config(
    'aka_agent.data_type_category_item_id',
    COALESCE(v_previous_context, ''),
    true
  );
  RAISE;
END;
$$;

DO $patch_automation_enqueue_semantic_type$
DECLARE
  v_signature regprocedure;
  v_definition text;
  v_source_old text :=
    'AND source_mapping.is_delete = false';
  v_source_new text :=
    'AND source_mapping.is_delete = false
   AND source_mapping.data_type_category_item_id IS NOT DISTINCT FROM
     COALESCE(
       automation.data_type_category_item_id,
       public.aka_agent_legacy_action_semantic_type(
         source_campaign.action_id, automation.data_type_code
       )
     )
   AND (
     automation.data_type_category_item_id IS NULL
     OR source_input.data_type_category_item_id =
       automation.data_type_category_item_id
   )';
  v_target_old text :=
    'AND target_mapping.is_delete = false';
  v_target_new text :=
    'AND target_mapping.is_delete = false
   AND target_mapping.data_type_category_item_id IS NOT DISTINCT FROM
     COALESCE(
       automation.data_type_category_item_id,
       public.aka_agent_legacy_action_semantic_type(
         target_campaign.action_id, automation.data_type_code
       )
     )';
  v_transport_snapshot text :=
    '''data_type_code'', automation.data_type_code,';
  v_semantic_snapshot text :=
    '''data_type_code'', automation.data_type_code,
      ''data_type_category_item_id'', automation.data_type_category_item_id,';
BEGIN
  v_signature := pg_catalog.to_regprocedure(
    'public.aka_agent_enqueue_campaign_detail_automations()'
  );
  IF v_signature IS NULL THEN
    RAISE EXCEPTION 'missing_campaign_automation_enqueue_trigger';
  END IF;
  SELECT pg_catalog.pg_get_functiondef(v_signature)
  INTO v_definition;
  IF pg_catalog.strpos(
    v_definition, 'source_mapping.data_type_category_item_id'
  ) = 0 THEN
    IF pg_catalog.strpos(v_definition, v_source_old) = 0
      OR pg_catalog.strpos(v_definition, v_target_old) = 0
      OR (
        pg_catalog.length(v_definition)
        - pg_catalog.length(pg_catalog.replace(
            v_definition, v_transport_snapshot, ''
          ))
      ) <> pg_catalog.length(v_transport_snapshot)
    THEN
      RAISE EXCEPTION 'unexpected_campaign_automation_enqueue_shape';
    END IF;
    v_definition := pg_catalog.replace(
      v_definition, v_source_old, v_source_new
    );
    v_definition := pg_catalog.replace(
      v_definition, v_target_old, v_target_new
    );
    v_definition := pg_catalog.replace(
      v_definition, v_transport_snapshot, v_semantic_snapshot
    );
    EXECUTE v_definition;
  END IF;

  v_signature := pg_catalog.to_regprocedure(
    'public.aka_agent_enqueue_group_only_automations()'
  );
  IF v_signature IS NULL THEN
    RAISE EXCEPTION 'missing_group_only_automation_enqueue_trigger';
  END IF;
  SELECT pg_catalog.pg_get_functiondef(v_signature)
  INTO v_definition;
  IF pg_catalog.strpos(
    v_definition, 'source_mapping.data_type_category_item_id'
  ) = 0 THEN
    IF pg_catalog.strpos(v_definition, v_source_old) = 0
      OR (
        pg_catalog.length(v_definition)
        - pg_catalog.length(pg_catalog.replace(
            v_definition, v_transport_snapshot, ''
          ))
      ) <> pg_catalog.length(v_transport_snapshot)
    THEN
      RAISE EXCEPTION 'unexpected_group_only_automation_enqueue_shape';
    END IF;
    v_definition := pg_catalog.replace(
      v_definition, v_source_old, v_source_new
    );
    v_definition := pg_catalog.replace(
      v_definition, v_transport_snapshot, v_semantic_snapshot
    );
    EXECUTE v_definition;
  END IF;
END;
$patch_automation_enqueue_semantic_type$;

DO $preserve_v202_automation_claim$
BEGIN
  IF pg_catalog.to_regprocedure(
    'public.claim_auto_automation_details_v205_internal(bigint,bigint,text,integer,text,text)'
  ) IS NULL
    AND pg_catalog.to_regprocedure(
      'public.claim_auto_automation_details(bigint,bigint,text,integer,text,text)'
    ) IS NOT NULL
  THEN
    ALTER FUNCTION public.claim_auto_automation_details(
      bigint, bigint, text, integer, text, text
    ) RENAME TO claim_auto_automation_details_v205_internal;
  END IF;
END;
$preserve_v202_automation_claim$;

CREATE OR REPLACE FUNCTION public.claim_auto_automation_details(
  p_staff_id bigint,
  p_organization_id bigint,
  p_worker_id text,
  p_limit integer DEFAULT 50,
  p_auth_username text DEFAULT NULL,
  p_auth_password text DEFAULT NULL
)
RETURNS TABLE (
  automation_detail_id bigint,
  automation_id bigint,
  parent_automation_detail_id bigint,
  source_campaign_detail_id bigint,
  source_campaign_input_data_id bigint,
  source_campaign_id bigint,
  source_account_id bigint,
  source_action_id text,
  source_action_code text,
  source_status text,
  target_campaign_id bigint,
  target_account_id bigint,
  target_action_id text,
  data_type_code text,
  data_value text,
  source_input_snapshot jsonb,
  config_snapshot jsonb,
  target_contact_group_id bigint,
  target_data_group_id bigint,
  scheduled_at timestamptz,
  target_row_index bigint,
  attempt_count integer,
  data_type_category_item_id bigint,
  data_type_category_code text,
  data_type_category_name text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    claimed.*,
    detail.data_type_category_item_id,
    category_item.code,
    category_item.name
  FROM public.claim_auto_automation_details_v205_internal(
    p_staff_id,
    p_organization_id,
    p_worker_id,
    p_limit,
    p_auth_username,
    p_auth_password
  ) AS claimed
  JOIN public.auto_automation_detail AS detail
    ON detail.id = claimed.automation_detail_id
   AND detail.staff_id = p_staff_id
   AND detail.organization_id = p_organization_id
  LEFT JOIN public.category_item AS category_item
    ON category_item.id = detail.data_type_category_item_id;
$$;

-- ---------------------------------------------------------------------------
-- 13. Function ACLs and schema cache
-- ---------------------------------------------------------------------------

DO $semantic_type_function_acls$
DECLARE
  v_oid regprocedure;
  v_signature text;
  v_service_signatures text[] := ARRAY[
    'public.aka_agent_list_data_groups(bigint,bigint,text,text,bigint,bigint[],integer,integer,boolean)',
    'public.aka_agent_list_data_groups(bigint,bigint,text,integer,integer)',
    'public.aka_agent_create_data_group(bigint,bigint,text,text,text,bigint)',
    'public.aka_agent_create_data_group(bigint,bigint,text,text,text)',
    'public.aka_agent_update_data_group(bigint,bigint,bigint,text,text,integer,bigint,boolean)',
    'public.aka_agent_update_data_group(bigint,bigint,bigint,text,text,integer)',
    'public.aka_agent_list_data_group_members(bigint,bigint,bigint,text,bigint[],boolean,text[],text[],text,bigint[],bigint[],bigint[],bigint[],integer,integer)',
    'public.aka_agent_list_data_group_members(bigint,bigint,bigint,text,bigint[],boolean,text[],text[],text,bigint[],bigint[],bigint[],integer,integer)',
    'public.aka_agent_list_data_group_datasets(bigint,bigint,bigint)',
    'public.aka_agent_ingest_data_group(bigint,bigint,text,bigint,text,jsonb,bigint,text,text,bigint,text,text,bigint)',
    'public.aka_agent_ingest_data_group(bigint,bigint,text,bigint,text,jsonb,bigint,text,text,bigint,text,text)'
  ];
  v_client_signatures text[] := ARRAY[
    'public.aka_agent_list_data_groups(bigint,bigint,text,text,bigint,bigint[],integer,integer,text,text,boolean)',
    'public.aka_agent_list_data_groups(bigint,bigint,text,integer,integer,text,text)',
    'public.aka_agent_create_data_group(bigint,bigint,text,text,text,bigint,text,text)',
    'public.aka_agent_create_data_group(bigint,bigint,text,text,text,text,text)',
    'public.aka_agent_update_data_group(bigint,bigint,bigint,text,text,integer,bigint,boolean,text,text)',
    'public.aka_agent_update_data_group(bigint,bigint,bigint,text,text,integer,text,text)',
    'public.aka_agent_list_data_group_members(bigint,bigint,bigint,text,bigint[],boolean,text[],text[],text,bigint[],bigint[],bigint[],bigint[],integer,integer,text,text)',
    'public.aka_agent_list_data_group_members(bigint,bigint,bigint,text,bigint[],boolean,text[],text[],text,bigint[],bigint[],bigint[],integer,integer,text,text)',
    'public.aka_agent_list_data_group_datasets(bigint,bigint,bigint,text,text)',
    'public.aka_agent_ingest_data_group(bigint,bigint,text,bigint,text,jsonb,bigint,text,text,bigint,text,text,bigint,text,text)',
    'public.aka_agent_ingest_data_group(bigint,bigint,text,bigint,text,jsonb,bigint,text,text,bigint,text,text,text,text)',
    'public.aka_agent_finalize_contact_dataset(bigint,bigint,bigint,text,text,text,text,text,text,text,text[],jsonb,bigint)',
    'public.aka_agent_save_upload_contact_datasets(bigint,bigint,bigint[],text,text,text,text,text,text,text,text,jsonb,jsonb,bigint)',
    'public.aka_agent_snapshot_data_group_to_direct_campaign(bigint,bigint,text,bigint,bigint,timestamptz,text,text,text)',
    'public.aka_agent_save_automation(bigint,bigint,bigint,text,bigint,bigint,text,bigint,bigint,text,integer,integer,timestamptz,text,boolean,jsonb,bigint,text,text,integer,text,time without time zone,time without time zone,boolean)',
    'public.claim_auto_automation_details(bigint,bigint,text,integer,text,text)'
  ];
BEGIN
  FOR v_oid IN
    SELECT proc.oid::regprocedure
    FROM pg_catalog.pg_proc AS proc
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = proc.pronamespace
    WHERE namespace.nspname = 'public'
      AND (
        proc.proname = ANY(ARRAY[
          'aka_agent_data_type_category_item_id',
          'aka_agent_is_data_type_category_item',
          'aka_agent_current_data_type_category_item_id',
          'aka_agent_data_type_context_present',
          'aka_agent_legacy_action_semantic_type',
          'aka_agent_derive_dataset_data_type',
          'aka_agent_data_group_type_compatible',
          'aka_agent_guard_action_semantic_mapping',
          'aka_agent_guard_data_group_semantic_type',
          'aka_agent_stamp_dataset_semantic_type',
          'aka_agent_stamp_origin_semantic_type',
          'aka_agent_membership_semantic_type',
          'aka_agent_data_group_membership_semantic_compatible',
          'aka_agent_internal_route_data_group_member',
          'aka_agent_internal_route_data_group_member_v205_internal',
          'aka_agent_stamp_campaign_input_semantic_type',
          'aka_agent_propagate_campaign_origin_semantic_type',
          'aka_agent_guard_campaign_data_group_semantic_type',
          'aka_agent_guard_automation_semantic_type',
          'aka_agent_stamp_automation_detail_semantic_type',
          'aka_agent_internal_dataset_auto_group_key',
          'aka_agent_ensure_dataset_auto_data_group',
          'aka_agent_data_type_json',
          'aka_agent_semantic_row_json',
          'aka_agent_campaign_input_semantic_json',
          'aka_agent_list_data_groups',
          'aka_agent_create_data_group',
          'aka_agent_update_data_group',
          'aka_agent_list_data_group_members',
          'aka_agent_list_data_group_datasets',
          'aka_agent_finalize_contact_dataset',
          'aka_agent_save_upload_contact_datasets',
          'aka_agent_ingest_data_group',
          'aka_agent_snapshot_data_group_to_direct_campaign',
          'aka_agent_save_automation',
          'claim_auto_automation_details',
          'aka_agent_snapshot_data_group_to_direct_campaign_v205_internal',
          'aka_agent_save_automation_v205_internal',
          'claim_auto_automation_details_v205_internal',
          'aka_agent_finalize_contact_dataset_v205_internal',
          'aka_agent_save_upload_contact_datasets_v205_internal',
          'aka_agent_list_data_groups_v205_internal',
          'aka_agent_list_data_groups_v205_auth_internal',
          'aka_agent_create_data_group_v205_internal',
          'aka_agent_create_data_group_v205_auth_internal',
          'aka_agent_update_data_group_v205_internal',
          'aka_agent_update_data_group_v205_auth_internal',
          'aka_agent_list_data_group_members_v205_internal',
          'aka_agent_list_data_group_members_v205_auth_internal',
          'aka_agent_list_data_group_datasets_v205_internal',
          'aka_agent_list_data_group_datasets_v205_auth_internal'
        ]::text[])
      )
  LOOP
    EXECUTE pg_catalog.format(
      'REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role',
      v_oid::text
    );
  END LOOP;

  FOREACH v_signature IN ARRAY v_service_signatures LOOP
    v_oid := pg_catalog.to_regprocedure(v_signature);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'missing_service_function_acl_target:%', v_signature;
    END IF;
    EXECUTE pg_catalog.format(
      'GRANT EXECUTE ON FUNCTION %s TO service_role',
      v_oid::text
    );
  END LOOP;

  FOREACH v_signature IN ARRAY v_client_signatures LOOP
    v_oid := pg_catalog.to_regprocedure(v_signature);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'missing_client_function_acl_target:%', v_signature;
    END IF;
    EXECUTE pg_catalog.format(
      'GRANT EXECUTE ON FUNCTION %s TO anon, authenticated, service_role',
      v_oid::text
    );
  END LOOP;
END;
$semantic_type_function_acls$;

COMMENT ON COLUMN public.auto_account_contacts_dataset.data_type_category_item_id
  IS 'Authoritative semantic type of this Data Set; NULL means mixed or unknown.';
COMMENT ON COLUMN public.auto_account_contact_group_member_origins.data_type_category_item_id
  IS 'Immutable semantic type observed by this membership origin.';
COMMENT ON COLUMN public.auto_account_contact_groups.data_type_category_item_id
  IS 'Optional group constraint; NULL is the unrestricted wildcard.';
COMMENT ON COLUMN public.auto_campaign_input_data.data_type_category_item_id
  IS 'Immutable semantic type snapshot used by this campaign input.';
COMMENT ON COLUMN public.auto_automation.data_type_category_item_id
  IS 'Semantic data type selected by the rule; data_type_code remains transport.';
COMMENT ON COLUMN public.auto_automation_detail.data_type_category_item_id
  IS 'Semantic data type snapshot copied from the automation rule.';

NOTIFY pgrst, 'reload schema';

COMMIT;
