-- Campaign-detail automation A -> B.
--
-- The detail trigger is deliberately an outbox producer only. A desktop/server
-- authenticated worker claims executions and calls the atomic materialization
-- RPC so campaign input rendering (especially SMS) remains in the application
-- runtime.

BEGIN;

-- ---------------------------------------------------------------------------
-- Catalogs
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.auto_automation_actions (
  id text PRIMARY KEY,
  name text NOT NULL,
  description text,
  is_available boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  is_delete boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auto_automation_actions_id_check
    CHECK (id ~ '^[a-z0-9_]+$')
);

INSERT INTO public.auto_automation_actions (
  id, name, description, is_available, sort_order
)
VALUES
  (
    'campaign_detail_route',
    'Chuyển dữ liệu theo kết quả chiến dịch',
    'Khi kết quả chạy của chiến dịch A đạt trạng thái đã chọn, thêm dữ liệu tương ứng vào chiến dịch B.',
    true,
    10
  ),
  (
    'zalo_friend_status_check',
    'Kiểm tra trạng thái bạn bè Zalo',
    'Tự động kiểm tra trạng thái bạn bè của người đã gửi lời mời kết bạn.',
    false,
    20
  ),
  (
    'akaagent_campaign_notification',
    'Nhận thông báo chiến dịch từ akaAgent',
    'Tự động nhận và xử lý thông báo chiến dịch từ akaAgent.',
    false,
    30
  )
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  is_available = EXCLUDED.is_available,
  sort_order = EXCLUDED.sort_order,
  is_active = true,
  is_delete = false,
  updated_at = now();

CREATE TABLE IF NOT EXISTS public.auto_automation_data_types (
  code text PRIMARY KEY,
  name text NOT NULL,
  source_column text NOT NULL,
  contact_type text NOT NULL,
  flatform_type text NOT NULL,
  is_account_scoped boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  is_delete boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auto_automation_data_types_code_check
    CHECK (code IN ('phone', 'email', 'zalo_uid', 'facebook_uid')),
  CONSTRAINT auto_automation_data_types_source_column_check
    CHECK (source_column IN ('phone', 'email', 'uid')),
  CONSTRAINT auto_automation_data_types_contact_type_check
    CHECK (contact_type IN ('phone', 'email', 'person')),
  CONSTRAINT auto_automation_data_types_flatform_type_check
    CHECK (flatform_type IN ('all', 'facebook', 'zalo', 'email', 'sms'))
);

INSERT INTO public.auto_automation_data_types (
  code,
  name,
  source_column,
  contact_type,
  flatform_type,
  is_account_scoped,
  sort_order
)
VALUES
  ('phone', 'Số điện thoại', 'phone', 'phone', 'all', false, 10),
  ('email', 'Email', 'email', 'email', 'email', false, 20),
  ('zalo_uid', 'UID Zalo', 'uid', 'person', 'zalo', true, 30),
  ('facebook_uid', 'UID Facebook', 'uid', 'person', 'facebook', false, 40)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  source_column = EXCLUDED.source_column,
  contact_type = EXCLUDED.contact_type,
  flatform_type = EXCLUDED.flatform_type,
  is_account_scoped = EXCLUDED.is_account_scoped,
  sort_order = EXCLUDED.sort_order,
  is_active = true,
  is_delete = false,
  updated_at = now();

CREATE TABLE IF NOT EXISTS public.auto_campaign_action_data_types (
  campaign_action_id text NOT NULL
    REFERENCES public.auto_campaign_actions(id) ON DELETE CASCADE,
  data_type_code text NOT NULL
    REFERENCES public.auto_automation_data_types(code) ON DELETE RESTRICT,
  can_source boolean NOT NULL DEFAULT true,
  can_target boolean NOT NULL DEFAULT true,
  target_contact_type text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  is_delete boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auto_campaign_action_data_types_pkey
    PRIMARY KEY (campaign_action_id, data_type_code),
  CONSTRAINT auto_campaign_action_data_types_contact_type_check
    CHECK (target_contact_type IN (
      'person', 'group', 'page', 'page_inbox_customer',
      'phone', 'email', 'campaign_input'
    ))
);

WITH seed(campaign_action_id, data_type_code, target_contact_type, sort_order) AS (
  VALUES
    ('zalo_message_phone', 'phone', 'phone', 10),
    ('zalo_add_group_member', 'phone', 'phone', 10),
    ('sms_send', 'phone', 'phone', 10),
    ('email_send', 'email', 'email', 20),
    ('zalo_message_friend', 'zalo_uid', 'person', 30),
    ('zalo_message_group_member', 'zalo_uid', 'person', 30),
    ('zalo_message_group_realtime', 'zalo_uid', 'person', 30),
    ('zalo_message_remarketing_customer', 'zalo_uid', 'person', 30),
    ('zalo_message_group', 'zalo_uid', 'group', 30),
    ('zalo_join_group_link', 'zalo_uid', 'group', 30),
    ('zalo_cancel_sent_friend_request', 'zalo_uid', 'person', 30),
    ('zalo_add_group_member', 'zalo_uid', 'person', 30),
    ('facebook_group_post', 'facebook_uid', 'group', 40),
    ('facebook_join_group', 'facebook_uid', 'group', 40),
    ('facebook_group_invite', 'facebook_uid', 'person', 40),
    ('facebook_page_post', 'facebook_uid', 'page', 40),
    ('facebook_message_friend', 'facebook_uid', 'person', 40),
    ('facebook_message_uid', 'facebook_uid', 'person', 40),
    ('facebook_page_to_message', 'facebook_uid', 'page_inbox_customer', 40),
    ('facebook_find_data_group', 'facebook_uid', 'group', 40),
    ('facebook_find_data_search', 'facebook_uid', 'campaign_input', 40),
    ('facebook_comment_seeding', 'facebook_uid', 'campaign_input', 40),
    ('facebook_comment_seeding_post', 'facebook_uid', 'campaign_input', 40)
)
INSERT INTO public.auto_campaign_action_data_types (
  campaign_action_id,
  data_type_code,
  can_source,
  can_target,
  target_contact_type,
  sort_order
)
SELECT
  seed.campaign_action_id,
  seed.data_type_code,
  true,
  true,
  seed.target_contact_type,
  seed.sort_order
FROM seed
JOIN public.auto_campaign_actions AS action
  ON action.id = seed.campaign_action_id
ON CONFLICT (campaign_action_id, data_type_code) DO UPDATE SET
  can_source = EXCLUDED.can_source,
  can_target = EXCLUDED.can_target,
  target_contact_type = EXCLUDED.target_contact_type,
  sort_order = EXCLUDED.sort_order,
  is_active = true,
  is_delete = false,
  updated_at = now();

CREATE TABLE IF NOT EXISTS public.auto_campaign_action_detail_statuses (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  campaign_action_id text NOT NULL
    REFERENCES public.auto_campaign_actions(id) ON DELETE CASCADE,
  action_code text
    REFERENCES public.auto_account_actions(code) ON DELETE SET NULL,
  status_id bigint
    REFERENCES public.auto_status(id) ON DELETE SET NULL,
  status_value text NOT NULL,
  label text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  is_delete boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auto_campaign_action_detail_statuses_value_check
    CHECK (length(btrim(status_value)) BETWEEN 1 AND 200)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_campaign_action_detail_status_identity
  ON public.auto_campaign_action_detail_statuses (
    campaign_action_id,
    COALESCE(action_code, ''),
    lower(status_value)
  )
  WHERE is_delete = false;

CREATE INDEX IF NOT EXISTS idx_campaign_action_detail_status_options
  ON public.auto_campaign_action_detail_statuses (
    campaign_action_id,
    action_code,
    sort_order,
    id
  )
  WHERE is_delete = false AND is_active = true;

-- Seed statuses that are valid before a campaign has its first result row.
-- The outbox trigger below also records newly observed open-ended statuses.
WITH common_status(status_value, status_code, sort_order) AS (
  VALUES
    ('thành công', 'campaign_detail_success', 10),
    ('thất bại', 'campaign_detail_failed', 20),
    ('lỗi', 'campaign_detail_error', 30)
)
INSERT INTO public.auto_campaign_action_detail_statuses (
  campaign_action_id,
  action_code,
  status_id,
  status_value,
  label,
  sort_order
)
SELECT
  campaign_action.id,
  NULL,
  status_catalog.id,
  common_status.status_value,
  common_status.status_value,
  common_status.sort_order
FROM public.auto_campaign_actions AS campaign_action
CROSS JOIN common_status
LEFT JOIN public.auto_status AS status_catalog
  ON status_catalog.code = common_status.status_code
WHERE campaign_action.is_delete = false
ON CONFLICT DO NOTHING;

WITH specific_status(
  campaign_action_id,
  action_code,
  status_value,
  sort_order
) AS (
  VALUES
    ('email_send', 'email_send', 'đã xem', 40),
    ('email_send', 'email_send', 'đã click', 50),
    ('sms_send', 'sms_send', 'đã gửi', 40),
    ('sms_send', 'sms_send', 'đã nhận', 50)
)
INSERT INTO public.auto_campaign_action_detail_statuses (
  campaign_action_id,
  action_code,
  status_value,
  label,
  sort_order
)
SELECT
  specific_status.campaign_action_id,
  specific_status.action_code,
  specific_status.status_value,
  specific_status.status_value,
  specific_status.sort_order
FROM specific_status
JOIN public.auto_campaign_actions AS campaign_action
  ON campaign_action.id = specific_status.campaign_action_id
JOIN public.auto_account_actions AS account_action
  ON account_action.code = specific_status.action_code
ON CONFLICT DO NOTHING;

WITH zalo_status(status_value, sort_order) AS (
  VALUES
    ('không tồn tại', 40),
    ('đã gửi tin nhắn', 50),
    ('đã gửi lời mời kết bạn', 60),
    ('đã là bạn bè', 70),
    ('đã tham gia', 80),
    ('đã gắn tag', 90),
    ('đã đổi tên', 100)
)
INSERT INTO public.auto_campaign_action_detail_statuses (
  campaign_action_id,
  action_code,
  status_value,
  label,
  sort_order
)
SELECT
  campaign_action.id,
  NULL,
  zalo_status.status_value,
  zalo_status.status_value,
  zalo_status.sort_order
FROM public.auto_campaign_actions AS campaign_action
CROSS JOIN zalo_status
WHERE campaign_action.flatform_type = 'zalo'
  AND campaign_action.is_delete = false
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- Tenant configuration, queue/ledger and deterministic target row counters
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.auto_automation (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  automation_action_id text NOT NULL DEFAULT 'campaign_detail_route'
    REFERENCES public.auto_automation_actions(id) ON DELETE RESTRICT,
  name text NOT NULL,
  source_campaign_id bigint NOT NULL
    REFERENCES public.auto_campaigns(id) ON DELETE RESTRICT,
  target_campaign_id bigint NOT NULL
    REFERENCES public.auto_campaigns(id) ON DELETE RESTRICT,
  data_type_code text NOT NULL
    REFERENCES public.auto_automation_data_types(code) ON DELETE RESTRICT,
  target_contact_group_id bigint
    REFERENCES public.auto_account_contact_groups(id) ON DELETE SET NULL,
  schedule_mode text NOT NULL DEFAULT 'immediate',
  delay_days integer NOT NULL DEFAULT 0,
  delay_hours integer NOT NULL DEFAULT 0,
  fixed_at timestamptz,
  note text,
  is_active boolean NOT NULL DEFAULT false,
  activated_at timestamptz,
  last_data_at timestamptz,
  config_version integer NOT NULL DEFAULT 1,
  is_delete boolean NOT NULL DEFAULT false,
  staff_id bigint NOT NULL
    REFERENCES public.org_staff(id) ON DELETE CASCADE,
  organization_id bigint NOT NULL
    REFERENCES public.org_organization(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auto_automation_name_check
    CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  CONSTRAINT auto_automation_distinct_campaigns_check
    CHECK (source_campaign_id <> target_campaign_id),
  CONSTRAINT auto_automation_schedule_mode_check
    CHECK (schedule_mode IN ('immediate', 'after_delay', 'fixed_at')),
  CONSTRAINT auto_automation_delay_days_check
    CHECK (delay_days BETWEEN 0 AND 3650),
  CONSTRAINT auto_automation_delay_hours_check
    CHECK (delay_hours BETWEEN 0 AND 23),
  CONSTRAINT auto_automation_schedule_config_check
    CHECK (
      (
        schedule_mode = 'immediate'
        AND delay_days = 0
        AND delay_hours = 0
        AND fixed_at IS NULL
      )
      OR (
        schedule_mode = 'after_delay'
        AND (delay_days > 0 OR delay_hours > 0)
        AND fixed_at IS NULL
      )
      OR (
        schedule_mode = 'fixed_at'
        AND delay_days = 0
        AND delay_hours = 0
        AND fixed_at IS NOT NULL
      )
    ),
  CONSTRAINT auto_automation_active_activation_check
    CHECK (NOT is_active OR activated_at IS NOT NULL),
  CONSTRAINT auto_automation_config_version_check
    CHECK (config_version > 0)
);

CREATE TABLE IF NOT EXISTS public.auto_automation_trigger_statuses (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  automation_id bigint NOT NULL
    REFERENCES public.auto_automation(id) ON DELETE CASCADE,
  status_mapping_id bigint NOT NULL
    REFERENCES public.auto_campaign_action_detail_statuses(id) ON DELETE RESTRICT,
  action_code text
    REFERENCES public.auto_account_actions(code) ON DELETE SET NULL,
  status_value text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auto_automation_trigger_statuses_value_check
    CHECK (length(btrim(status_value)) BETWEEN 1 AND 200)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_auto_automation_trigger_status
  ON public.auto_automation_trigger_statuses (
    automation_id,
    COALESCE(action_code, ''),
    lower(status_value)
  );

CREATE TABLE IF NOT EXISTS public.auto_automation_detail (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  automation_id bigint NOT NULL
    REFERENCES public.auto_automation(id) ON DELETE RESTRICT,
  parent_automation_detail_id bigint
    REFERENCES public.auto_automation_detail(id) ON DELETE SET NULL,
  source_campaign_detail_id bigint NOT NULL
    REFERENCES public.auto_campaign_details(id) ON DELETE RESTRICT,
  source_campaign_input_data_id bigint NOT NULL
    REFERENCES public.auto_campaign_input_data(id) ON DELETE RESTRICT,
  source_campaign_id bigint NOT NULL
    REFERENCES public.auto_campaigns(id) ON DELETE RESTRICT,
  source_account_id bigint NOT NULL
    REFERENCES public.auto_accounts(id) ON DELETE RESTRICT,
  source_action_id text NOT NULL
    REFERENCES public.auto_campaign_actions(id) ON DELETE RESTRICT,
  source_action_code text,
  source_status text NOT NULL,
  target_campaign_id bigint NOT NULL
    REFERENCES public.auto_campaigns(id) ON DELETE RESTRICT,
  target_account_id bigint NOT NULL
    REFERENCES public.auto_accounts(id) ON DELETE RESTRICT,
  target_action_id text NOT NULL
    REFERENCES public.auto_campaign_actions(id) ON DELETE RESTRICT,
  data_type_code text NOT NULL
    REFERENCES public.auto_automation_data_types(code) ON DELETE RESTRICT,
  data_value text,
  source_input_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  config_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  target_contact_group_id bigint
    REFERENCES public.auto_account_contact_groups(id) ON DELETE SET NULL,
  scheduled_at timestamptz NOT NULL,
  target_row_index bigint,
  status text NOT NULL DEFAULT 'chờ xử lý',
  attempt_count integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  locked_by text,
  target_input_data_id bigint
    REFERENCES public.auto_campaign_input_data(id) ON DELETE SET NULL,
  target_contact_id bigint
    REFERENCES public.auto_account_contacts(id) ON DELETE SET NULL,
  target_contact_group_member_id bigint
    REFERENCES public.auto_account_contact_group_members(id) ON DELETE SET NULL,
  target_input_snapshot jsonb,
  last_error text,
  processed_at timestamptz,
  staff_id bigint NOT NULL
    REFERENCES public.org_staff(id) ON DELETE CASCADE,
  organization_id bigint NOT NULL
    REFERENCES public.org_organization(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auto_automation_detail_unique_source
    UNIQUE (automation_id, source_campaign_detail_id),
  CONSTRAINT auto_automation_detail_status_check
    CHECK (status IN ('chờ xử lý', 'đang xử lý', 'đã thêm', 'bỏ qua', 'lỗi')),
  CONSTRAINT auto_automation_detail_attempt_count_check
    CHECK (attempt_count >= 0),
  CONSTRAINT auto_automation_detail_snapshot_type_check
    CHECK (
      jsonb_typeof(source_input_snapshot) = 'object'
      AND jsonb_typeof(config_snapshot) = 'object'
      AND (
        target_input_snapshot IS NULL
        OR jsonb_typeof(target_input_snapshot) = 'object'
      )
    )
);

CREATE TABLE IF NOT EXISTS public.auto_automation_target_counters (
  target_campaign_id bigint PRIMARY KEY
    REFERENCES public.auto_campaigns(id) ON DELETE CASCADE,
  next_row_index bigint NOT NULL DEFAULT 0,
  staff_id bigint NOT NULL
    REFERENCES public.org_staff(id) ON DELETE CASCADE,
  organization_id bigint NOT NULL
    REFERENCES public.org_organization(id) ON DELETE CASCADE,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auto_automation_target_counters_index_check
    CHECK (next_row_index >= 0)
);

CREATE TABLE IF NOT EXISTS public.auto_automation_enqueue_failures (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  source_campaign_detail_id bigint NOT NULL
    REFERENCES public.auto_campaign_details(id) ON DELETE CASCADE,
  source_campaign_id bigint NOT NULL
    REFERENCES public.auto_campaigns(id) ON DELETE CASCADE,
  source_status text NOT NULL,
  source_action_code text,
  source_is_delete boolean NOT NULL DEFAULT false,
  event_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempt_count integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  resolved_at timestamptz,
  staff_id bigint NOT NULL
    REFERENCES public.org_staff(id) ON DELETE CASCADE,
  organization_id bigint NOT NULL
    REFERENCES public.org_organization(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auto_automation_enqueue_failures_source_unique
    UNIQUE (source_campaign_detail_id),
  CONSTRAINT auto_automation_enqueue_failures_status_check
    CHECK (status IN ('pending', 'resolved')),
  CONSTRAINT auto_automation_enqueue_failures_attempt_check
    CHECK (attempt_count >= 0)
);

CREATE INDEX IF NOT EXISTS idx_auto_automation_enqueue_failures_pending
  ON public.auto_automation_enqueue_failures (
    staff_id,
    organization_id,
    next_attempt_at,
    event_at,
    id
  )
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_auto_automation_tenant_list
  ON public.auto_automation (
    staff_id,
    organization_id,
    updated_at DESC,
    id DESC
  )
  WHERE is_delete = false;

CREATE INDEX IF NOT EXISTS idx_auto_automation_source_active
  ON public.auto_automation (source_campaign_id, activated_at, id)
  WHERE is_delete = false AND is_active = true;

CREATE INDEX IF NOT EXISTS idx_auto_automation_target_active
  ON public.auto_automation (target_campaign_id, id)
  WHERE is_delete = false AND is_active = true;

CREATE INDEX IF NOT EXISTS idx_auto_automation_trigger_match
  ON public.auto_automation_trigger_statuses (
    automation_id,
    lower(status_value),
    action_code
  );

CREATE INDEX IF NOT EXISTS idx_auto_automation_detail_queue
  ON public.auto_automation_detail (
    staff_id,
    organization_id,
    next_attempt_at,
    scheduled_at,
    id
  )
  WHERE status = 'chờ xử lý';

CREATE INDEX IF NOT EXISTS idx_auto_automation_detail_locked
  ON public.auto_automation_detail (staff_id, organization_id, locked_at, id)
  WHERE status = 'đang xử lý';

CREATE INDEX IF NOT EXISTS idx_auto_automation_detail_history
  ON public.auto_automation_detail (automation_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_auto_automation_detail_status_summary
  ON public.auto_automation_detail (automation_id, status);

CREATE INDEX IF NOT EXISTS idx_auto_automation_detail_parent
  ON public.auto_automation_detail (parent_automation_detail_id)
  WHERE parent_automation_detail_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_auto_automation_detail_target_input
  ON public.auto_automation_detail (target_input_data_id)
  WHERE target_input_data_id IS NOT NULL;

-- One source/target detail status option lookup should not require scanning all
-- result rows without a usable prefix.
CREATE INDEX IF NOT EXISTS idx_auto_campaign_details_automation_status
  ON public.auto_campaign_details (campaign_id, status, action_code, created_at DESC)
  WHERE is_delete = false;

-- ---------------------------------------------------------------------------
-- Trace columns. One automation execution creates exactly one target input, but
-- that input can later create many campaign detail rows.
-- ---------------------------------------------------------------------------

ALTER TABLE public.auto_campaign_input_data
  ADD COLUMN IF NOT EXISTS auto_automation_detail_id bigint;

ALTER TABLE public.auto_campaign_details
  ADD COLUMN IF NOT EXISTS auto_automation_detail_id bigint;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.auto_campaign_input_data'::regclass
      AND conname = 'auto_campaign_input_data_automation_detail_fkey'
  ) THEN
    ALTER TABLE public.auto_campaign_input_data
      ADD CONSTRAINT auto_campaign_input_data_automation_detail_fkey
      FOREIGN KEY (auto_automation_detail_id)
      REFERENCES public.auto_automation_detail(id)
      ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.auto_campaign_details'::regclass
      AND conname = 'auto_campaign_details_automation_detail_fkey'
  ) THEN
    ALTER TABLE public.auto_campaign_details
      ADD CONSTRAINT auto_campaign_details_automation_detail_fkey
      FOREIGN KEY (auto_automation_detail_id)
      REFERENCES public.auto_automation_detail(id)
      ON DELETE SET NULL;
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_auto_campaign_input_data_automation_detail
  ON public.auto_campaign_input_data (auto_automation_detail_id)
  WHERE auto_automation_detail_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_auto_campaign_details_automation_detail
  ON public.auto_campaign_details (auto_automation_detail_id, created_at, id)
  WHERE auto_automation_detail_id IS NOT NULL;

COMMENT ON TABLE public.auto_automation IS
  'Tenant automation rules that route a matching campaign A result into campaign B.';
COMMENT ON TABLE public.auto_automation_detail IS
  'Idempotent outbox plus immutable execution ledger for one automation/source detail pair.';
COMMENT ON COLUMN public.auto_automation_detail.config_snapshot IS
  'Rule and target-campaign snapshot used by workers so later edits cannot change an already-triggered execution.';
COMMENT ON COLUMN public.auto_campaign_input_data.auto_automation_detail_id IS
  'Trace to the automation execution that materialized this target input row.';
COMMENT ON COLUMN public.auto_campaign_details.auto_automation_detail_id IS
  'Inherited trace from target input; non-unique because one input can emit many result milestones.';

-- ---------------------------------------------------------------------------
-- Validation and JSON projection helpers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.auto_assert_automation_identity(
  p_staff_id bigint,
  p_organization_id bigint,
  p_auth_username text,
  p_auth_password text
)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_claim_role text;
  v_claims jsonb;
BEGIN
  v_claim_role := NULLIF(current_setting('request.jwt.claim.role', true), '');

  IF v_claim_role IS NULL THEN
    BEGIN
      v_claims := NULLIF(
        current_setting('request.jwt.claims', true),
        ''
      )::jsonb;
      v_claim_role := NULLIF(v_claims ->> 'role', '');
    EXCEPTION
      WHEN OTHERS THEN
        v_claim_role := NULL;
    END;
  END IF;

  IF v_claim_role IS NULL THEN
    v_claim_role := NULLIF(auth.jwt() ->> 'role', '');
  END IF;

  IF v_claim_role = 'service_role' THEN
    RETURN;
  END IF;

  IF p_auth_username IS NULL OR p_auth_password IS NULL THEN
    RAISE EXCEPTION 'automation_auth_required';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.org_staff AS staff
    WHERE staff.id = p_staff_id
      AND staff.organization_id = p_organization_id
      AND staff.is_active = true
      AND staff.username = p_auth_username
      AND staff.password = p_auth_password
  ) THEN
    RAISE EXCEPTION 'automation_auth_invalid';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.auto_validate_automation_rule_internal(
  p_staff_id bigint,
  p_organization_id bigint,
  p_automation_id bigint,
  p_source_campaign_id bigint,
  p_target_campaign_id bigint,
  p_data_type_code text,
  p_target_contact_group_id bigint,
  p_schedule_mode text,
  p_delay_days integer,
  p_delay_hours integer,
  p_fixed_at timestamptz,
  p_is_active boolean,
  p_require_trigger_statuses boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_source record;
  v_target record;
  v_data_type public.auto_automation_data_types%ROWTYPE;
  v_target_mapping public.auto_campaign_action_data_types%ROWTYPE;
  v_group record;
BEGIN
  IF p_staff_id IS NULL OR p_staff_id <= 0
    OR p_organization_id IS NULL OR p_organization_id <= 0 THEN
    RAISE EXCEPTION 'invalid_automation_tenant';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.org_staff AS staff
    WHERE staff.id = p_staff_id
      AND staff.organization_id = p_organization_id
      AND staff.is_active = true
  ) THEN
    RAISE EXCEPTION 'inactive_automation_staff';
  END IF;

  IF p_source_campaign_id IS NULL
    OR p_target_campaign_id IS NULL
    OR p_source_campaign_id = p_target_campaign_id THEN
    RAISE EXCEPTION 'automation_campaigns_must_be_distinct';
  END IF;

  SELECT
    campaign.id,
    campaign.action_id,
    campaign.account_id,
    campaign.staff_id,
    campaign.organization_id,
    campaign_action.flatform_type AS action_flatform_type,
    account.flatform_type AS account_flatform_type
  INTO v_source
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_campaign_actions AS campaign_action
    ON campaign_action.id = campaign.action_id
  JOIN public.auto_accounts AS account
    ON account.id = campaign.account_id
  WHERE campaign.id = p_source_campaign_id
    AND campaign.staff_id = p_staff_id
    AND campaign.organization_id = p_organization_id
    AND COALESCE(campaign.is_delete, false) = false
    AND campaign_action.is_active = true
    AND COALESCE(campaign_action.is_delete, false) = false
    AND account.staff_id = p_staff_id
    AND account.organization_id = p_organization_id
    AND COALESCE(account.is_delete, false) = false;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_source_campaign';
  END IF;

  SELECT
    campaign.id,
    campaign.action_id,
    campaign.account_id,
    campaign.staff_id,
    campaign.organization_id,
    campaign.status,
    campaign_action.flatform_type AS action_flatform_type,
    account.flatform_type AS account_flatform_type
  INTO v_target
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_campaign_actions AS campaign_action
    ON campaign_action.id = campaign.action_id
  JOIN public.auto_accounts AS account
    ON account.id = campaign.account_id
  WHERE campaign.id = p_target_campaign_id
    AND campaign.staff_id = p_staff_id
    AND campaign.organization_id = p_organization_id
    AND COALESCE(campaign.is_delete, false) = false
    AND campaign_action.is_active = true
    AND COALESCE(campaign_action.is_delete, false) = false
    AND account.staff_id = p_staff_id
    AND account.organization_id = p_organization_id
    AND COALESCE(account.is_delete, false) = false;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_target_campaign';
  END IF;

  SELECT *
  INTO v_data_type
  FROM public.auto_automation_data_types AS data_type
  WHERE data_type.code = p_data_type_code
    AND data_type.is_active = true
    AND data_type.is_delete = false;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_automation_data_type';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.auto_campaign_action_data_types AS mapping
    WHERE mapping.campaign_action_id = v_source.action_id
      AND mapping.data_type_code = p_data_type_code
      AND mapping.can_source = true
      AND mapping.is_active = true
      AND mapping.is_delete = false
  ) THEN
    RAISE EXCEPTION 'source_campaign_data_type_not_supported';
  END IF;

  SELECT *
  INTO v_target_mapping
  FROM public.auto_campaign_action_data_types AS mapping
  WHERE mapping.campaign_action_id = v_target.action_id
    AND mapping.data_type_code = p_data_type_code
    AND mapping.can_target = true
    AND mapping.is_active = true
    AND mapping.is_delete = false;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'target_campaign_data_type_not_supported';
  END IF;

  IF v_data_type.is_account_scoped
    AND v_source.account_id <> v_target.account_id THEN
    RAISE EXCEPTION 'account_scoped_data_requires_same_account';
  END IF;

  IF p_target_contact_group_id IS NOT NULL THEN
    SELECT
      contact_group.id,
      contact_group.account_id,
      contact_group.contact_type,
      contact_group.purpose
    INTO v_group
    FROM public.auto_account_contact_groups AS contact_group
    WHERE contact_group.id = p_target_contact_group_id
      AND contact_group.account_id = v_target.account_id
      AND contact_group.staff_id = p_staff_id
      AND contact_group.organization_id = p_organization_id
      AND contact_group.purpose = 'data_group'
      AND contact_group.contact_type = v_target_mapping.target_contact_type
      AND contact_group.is_delete = false;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'invalid_target_contact_group';
    END IF;
  END IF;

  IF p_schedule_mode NOT IN ('immediate', 'after_delay', 'fixed_at')
    OR COALESCE(p_delay_days, 0) < 0
    OR COALESCE(p_delay_days, 0) > 3650
    OR COALESCE(p_delay_hours, 0) < 0
    OR COALESCE(p_delay_hours, 0) > 23 THEN
    RAISE EXCEPTION 'invalid_automation_schedule';
  END IF;

  IF p_schedule_mode = 'immediate'
    AND (
      COALESCE(p_delay_days, 0) <> 0
      OR COALESCE(p_delay_hours, 0) <> 0
      OR p_fixed_at IS NOT NULL
    ) THEN
    RAISE EXCEPTION 'invalid_immediate_schedule';
  ELSIF p_schedule_mode = 'after_delay'
    AND (
      (COALESCE(p_delay_days, 0) = 0 AND COALESCE(p_delay_hours, 0) = 0)
      OR p_fixed_at IS NOT NULL
    ) THEN
    RAISE EXCEPTION 'invalid_delay_schedule';
  ELSIF p_schedule_mode = 'fixed_at'
    AND (
      p_fixed_at IS NULL
      OR COALESCE(p_delay_days, 0) <> 0
      OR COALESCE(p_delay_hours, 0) <> 0
      OR (p_is_active AND p_fixed_at <= clock_timestamp())
    ) THEN
    RAISE EXCEPTION 'invalid_fixed_schedule';
  END IF;

  IF p_require_trigger_statuses
    AND (
      p_automation_id IS NULL
      OR NOT EXISTS (
        SELECT 1
        FROM public.auto_automation_trigger_statuses AS trigger_status
        WHERE trigger_status.automation_id = p_automation_id
      )
    ) THEN
    RAISE EXCEPTION 'automation_trigger_status_required';
  END IF;

  IF p_is_active AND EXISTS (
    WITH RECURSIVE reachable(campaign_id, visited) AS (
      SELECT
        p_target_campaign_id,
        ARRAY[p_target_campaign_id]::bigint[]

      UNION ALL

      SELECT
        automation.target_campaign_id,
        reachable.visited || automation.target_campaign_id
      FROM reachable
      JOIN public.auto_automation AS automation
        ON automation.source_campaign_id = reachable.campaign_id
      WHERE automation.staff_id = p_staff_id
        AND automation.organization_id = p_organization_id
        AND automation.is_active = true
        AND automation.is_delete = false
        AND (p_automation_id IS NULL OR automation.id <> p_automation_id)
        AND NOT automation.target_campaign_id = ANY(reachable.visited)
    )
    SELECT 1
    FROM reachable
    WHERE reachable.campaign_id = p_source_campaign_id
  ) THEN
    RAISE EXCEPTION 'automation_cycle_detected';
  END IF;

  RETURN jsonb_build_object(
    'source_campaign_id', v_source.id,
    'source_action_id', v_source.action_id,
    'source_account_id', v_source.account_id,
    'target_campaign_id', v_target.id,
    'target_action_id', v_target.action_id,
    'target_account_id', v_target.account_id,
    'data_type_code', v_data_type.code,
    'target_contact_type', v_target_mapping.target_contact_type
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.aka_agent_validate_automation_rule(
  p_staff_id bigint,
  p_organization_id bigint,
  p_automation_id bigint,
  p_source_campaign_id bigint,
  p_target_campaign_id bigint,
  p_data_type_code text,
  p_target_contact_group_id bigint,
  p_schedule_mode text,
  p_delay_days integer,
  p_delay_hours integer,
  p_fixed_at timestamptz,
  p_is_active boolean,
  p_require_trigger_statuses boolean DEFAULT false,
  p_auth_username text DEFAULT NULL,
  p_auth_password text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT public.auto_assert_automation_identity(
    p_staff_id,
    p_organization_id,
    p_auth_username,
    p_auth_password
  );

  SELECT public.auto_validate_automation_rule_internal(
    p_staff_id,
    p_organization_id,
    p_automation_id,
    p_source_campaign_id,
    p_target_campaign_id,
    p_data_type_code,
    p_target_contact_group_id,
    p_schedule_mode,
    COALESCE(p_delay_days, 0),
    COALESCE(p_delay_hours, 0),
    p_fixed_at,
    COALESCE(p_is_active, false),
    COALESCE(p_require_trigger_statuses, false)
  );
$$;

CREATE OR REPLACE FUNCTION public.auto_automation_to_json(
  p_automation_id bigint,
  p_staff_id bigint,
  p_organization_id bigint
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    to_jsonb(automation)
    || jsonb_build_object(
      'automation_action_name', automation_action.name,
      'data_type_name', data_type.name,
      'source_campaign', jsonb_build_object(
        'id', source_campaign.id,
        'name', source_campaign.name,
        'action_id', source_campaign.action_id,
        'action_name', source_action.name,
        'account_id', source_campaign.account_id,
        'account_name', source_account.name,
        'flatform_type', source_action.flatform_type
      ),
      'target_campaign', jsonb_build_object(
        'id', target_campaign.id,
        'name', target_campaign.name,
        'action_id', target_campaign.action_id,
        'action_name', target_action.name,
        'account_id', target_campaign.account_id,
        'account_name', target_account.name,
        'flatform_type', target_action.flatform_type
      ),
      'target_contact_group', CASE
        WHEN target_group.id IS NULL THEN NULL
        ELSE jsonb_build_object(
          'id', target_group.id,
          'name', target_group.name,
          'contact_type', target_group.contact_type,
          'purpose', target_group.purpose
        )
      END,
      'trigger_statuses', COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', trigger_status.id,
            'status_mapping_id', trigger_status.status_mapping_id,
            'action_code', trigger_status.action_code,
            'status_value', trigger_status.status_value
          )
          ORDER BY lower(trigger_status.status_value), trigger_status.id
        )
        FROM public.auto_automation_trigger_statuses AS trigger_status
        WHERE trigger_status.automation_id = automation.id
      ), '[]'::jsonb),
      'execution_summary', jsonb_build_object(
        'total', COALESCE(execution_count.total, 0),
        'queued', COALESCE(execution_count.queued, 0),
        'processing', COALESCE(execution_count.processing, 0),
        'materialized', COALESCE(execution_count.materialized, 0),
        'skipped', COALESCE(execution_count.skipped, 0),
        'failed', COALESCE(execution_count.failed, 0),
        'latest_status', latest_execution.status,
        'latest_created_at', latest_execution.created_at,
        'latest_processed_at', latest_execution.processed_at
      )
    )
  FROM public.auto_automation AS automation
  JOIN public.auto_automation_actions AS automation_action
    ON automation_action.id = automation.automation_action_id
  JOIN public.auto_automation_data_types AS data_type
    ON data_type.code = automation.data_type_code
  JOIN public.auto_campaigns AS source_campaign
    ON source_campaign.id = automation.source_campaign_id
  JOIN public.auto_campaign_actions AS source_action
    ON source_action.id = source_campaign.action_id
  JOIN public.auto_accounts AS source_account
    ON source_account.id = source_campaign.account_id
  JOIN public.auto_campaigns AS target_campaign
    ON target_campaign.id = automation.target_campaign_id
  JOIN public.auto_campaign_actions AS target_action
    ON target_action.id = target_campaign.action_id
  JOIN public.auto_accounts AS target_account
    ON target_account.id = target_campaign.account_id
  LEFT JOIN public.auto_account_contact_groups AS target_group
    ON target_group.id = automation.target_contact_group_id
  LEFT JOIN LATERAL (
    SELECT
      count(*)::integer AS total,
      count(*) FILTER (WHERE detail.status = 'chờ xử lý')::integer AS queued,
      count(*) FILTER (WHERE detail.status = 'đang xử lý')::integer AS processing,
      count(*) FILTER (WHERE detail.status = 'đã thêm')::integer AS materialized,
      count(*) FILTER (WHERE detail.status = 'bỏ qua')::integer AS skipped,
      count(*) FILTER (WHERE detail.status = 'lỗi')::integer AS failed
    FROM public.auto_automation_detail AS detail
    WHERE detail.automation_id = automation.id
  ) AS execution_count ON true
  LEFT JOIN LATERAL (
    SELECT detail.status, detail.created_at, detail.processed_at
    FROM public.auto_automation_detail AS detail
    WHERE detail.automation_id = automation.id
    ORDER BY detail.created_at DESC, detail.id DESC
    LIMIT 1
  ) AS latest_execution ON true
  WHERE automation.id = p_automation_id
    AND automation.staff_id = p_staff_id
    AND automation.organization_id = p_organization_id;
$$;

-- ---------------------------------------------------------------------------
-- RPC-only CRUD/query surface for desktop/server clients using the anon key.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.aka_agent_list_automations(
  p_staff_id bigint,
  p_organization_id bigint,
  p_search text DEFAULT NULL,
  p_is_active boolean DEFAULT NULL,
  p_data_type_code text DEFAULT NULL,
  p_source_campaign_id bigint DEFAULT NULL,
  p_target_campaign_id bigint DEFAULT NULL,
  p_updated_from timestamptz DEFAULT NULL,
  p_limit integer DEFAULT 200,
  p_offset integer DEFAULT 0,
  p_sort_by text DEFAULT 'updated_at',
  p_sort_direction text DEFAULT 'desc',
  p_auth_username text DEFAULT NULL,
  p_auth_password text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_items jsonb := '[]'::jsonb;
  v_total integer := 0;
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 200), 1), 500);
  v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
  v_sort_by text := lower(COALESCE(NULLIF(btrim(p_sort_by), ''), 'updated_at'));
  v_sort_direction text := lower(COALESCE(NULLIF(btrim(p_sort_direction), ''), 'desc'));
BEGIN
  PERFORM public.auto_assert_automation_identity(
    p_staff_id,
    p_organization_id,
    p_auth_username,
    p_auth_password
  );

  IF p_staff_id IS NULL OR p_organization_id IS NULL THEN
    RAISE EXCEPTION 'invalid_automation_tenant';
  END IF;

  IF v_sort_by NOT IN ('name', 'created_at', 'updated_at', 'last_data_at', 'is_active') THEN
    RAISE EXCEPTION 'invalid_automation_sort';
  END IF;
  IF v_sort_direction NOT IN ('asc', 'desc') THEN
    RAISE EXCEPTION 'invalid_automation_sort_direction';
  END IF;

  SELECT count(*)::integer
  INTO v_total
  FROM public.auto_automation AS automation
  WHERE automation.staff_id = p_staff_id
    AND automation.organization_id = p_organization_id
    AND automation.is_delete = false
    AND (p_is_active IS NULL OR automation.is_active = p_is_active)
    AND (p_data_type_code IS NULL OR automation.data_type_code = p_data_type_code)
    AND (p_source_campaign_id IS NULL OR automation.source_campaign_id = p_source_campaign_id)
    AND (p_target_campaign_id IS NULL OR automation.target_campaign_id = p_target_campaign_id)
    AND (p_updated_from IS NULL OR automation.updated_at >= p_updated_from)
    AND (
      NULLIF(btrim(COALESCE(p_search, '')), '') IS NULL
      OR automation.name ILIKE '%' || btrim(p_search) || '%'
      OR COALESCE(automation.note, '') ILIKE '%' || btrim(p_search) || '%'
      OR EXISTS (
        SELECT 1
        FROM public.auto_campaigns AS campaign
        WHERE campaign.id IN (
          automation.source_campaign_id,
          automation.target_campaign_id
        )
          AND campaign.name ILIKE '%' || btrim(p_search) || '%'
      )
    );

  SELECT COALESCE(
    jsonb_agg(
      public.auto_automation_to_json(
        page.id,
        p_staff_id,
        p_organization_id
      )
      ORDER BY
        CASE WHEN v_sort_by = 'name' AND v_sort_direction = 'asc' THEN lower(page.name) END ASC NULLS LAST,
        CASE WHEN v_sort_by = 'name' AND v_sort_direction = 'desc' THEN lower(page.name) END DESC NULLS LAST,
        CASE WHEN v_sort_by = 'created_at' AND v_sort_direction = 'asc' THEN page.created_at END ASC NULLS LAST,
        CASE WHEN v_sort_by = 'created_at' AND v_sort_direction = 'desc' THEN page.created_at END DESC NULLS LAST,
        CASE WHEN v_sort_by = 'updated_at' AND v_sort_direction = 'asc' THEN page.updated_at END ASC NULLS LAST,
        CASE WHEN v_sort_by = 'updated_at' AND v_sort_direction = 'desc' THEN page.updated_at END DESC NULLS LAST,
        CASE WHEN v_sort_by = 'last_data_at' AND v_sort_direction = 'asc' THEN page.last_data_at END ASC NULLS LAST,
        CASE WHEN v_sort_by = 'last_data_at' AND v_sort_direction = 'desc' THEN page.last_data_at END DESC NULLS LAST,
        CASE WHEN v_sort_by = 'is_active' AND v_sort_direction = 'asc' THEN page.is_active END ASC NULLS LAST,
        CASE WHEN v_sort_by = 'is_active' AND v_sort_direction = 'desc' THEN page.is_active END DESC NULLS LAST,
        page.id DESC
    ),
    '[]'::jsonb
  )
  INTO v_items
  FROM (
    SELECT automation.*
    FROM public.auto_automation AS automation
    WHERE automation.staff_id = p_staff_id
      AND automation.organization_id = p_organization_id
      AND automation.is_delete = false
      AND (p_is_active IS NULL OR automation.is_active = p_is_active)
      AND (p_data_type_code IS NULL OR automation.data_type_code = p_data_type_code)
      AND (p_source_campaign_id IS NULL OR automation.source_campaign_id = p_source_campaign_id)
      AND (p_target_campaign_id IS NULL OR automation.target_campaign_id = p_target_campaign_id)
      AND (p_updated_from IS NULL OR automation.updated_at >= p_updated_from)
      AND (
        NULLIF(btrim(COALESCE(p_search, '')), '') IS NULL
        OR automation.name ILIKE '%' || btrim(p_search) || '%'
        OR COALESCE(automation.note, '') ILIKE '%' || btrim(p_search) || '%'
        OR EXISTS (
          SELECT 1
          FROM public.auto_campaigns AS campaign
          WHERE campaign.id IN (
            automation.source_campaign_id,
            automation.target_campaign_id
          )
            AND campaign.name ILIKE '%' || btrim(p_search) || '%'
        )
      )
    ORDER BY
      CASE WHEN v_sort_by = 'name' AND v_sort_direction = 'asc' THEN lower(automation.name) END ASC NULLS LAST,
      CASE WHEN v_sort_by = 'name' AND v_sort_direction = 'desc' THEN lower(automation.name) END DESC NULLS LAST,
      CASE WHEN v_sort_by = 'created_at' AND v_sort_direction = 'asc' THEN automation.created_at END ASC NULLS LAST,
      CASE WHEN v_sort_by = 'created_at' AND v_sort_direction = 'desc' THEN automation.created_at END DESC NULLS LAST,
      CASE WHEN v_sort_by = 'updated_at' AND v_sort_direction = 'asc' THEN automation.updated_at END ASC NULLS LAST,
      CASE WHEN v_sort_by = 'updated_at' AND v_sort_direction = 'desc' THEN automation.updated_at END DESC NULLS LAST,
      CASE WHEN v_sort_by = 'last_data_at' AND v_sort_direction = 'asc' THEN automation.last_data_at END ASC NULLS LAST,
      CASE WHEN v_sort_by = 'last_data_at' AND v_sort_direction = 'desc' THEN automation.last_data_at END DESC NULLS LAST,
      CASE WHEN v_sort_by = 'is_active' AND v_sort_direction = 'asc' THEN automation.is_active END ASC NULLS LAST,
      CASE WHEN v_sort_by = 'is_active' AND v_sort_direction = 'desc' THEN automation.is_active END DESC NULLS LAST,
      automation.id DESC
    LIMIT v_limit
    OFFSET v_offset
  ) AS page;

  RETURN jsonb_build_object(
    'items', v_items,
    'total', v_total,
    'limit', v_limit,
    'offset', v_offset
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.aka_agent_get_automation(
  p_staff_id bigint,
  p_organization_id bigint,
  p_automation_id bigint,
  p_auth_username text DEFAULT NULL,
  p_auth_password text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT public.auto_assert_automation_identity(
    p_staff_id,
    p_organization_id,
    p_auth_username,
    p_auth_password
  );

  SELECT public.auto_automation_to_json(
    p_automation_id,
    p_staff_id,
    p_organization_id
  );
$$;

CREATE OR REPLACE FUNCTION public.aka_agent_get_automation_options(
  p_staff_id bigint,
  p_organization_id bigint,
  p_auth_username text DEFAULT NULL,
  p_auth_password text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT public.auto_assert_automation_identity(
    p_staff_id,
    p_organization_id,
    p_auth_username,
    p_auth_password
  );

  SELECT jsonb_build_object(
    'automation_actions', COALESCE((
      SELECT jsonb_agg(to_jsonb(automation_action) ORDER BY automation_action.sort_order, automation_action.id)
      FROM public.auto_automation_actions AS automation_action
      WHERE automation_action.is_active = true
        AND automation_action.is_delete = false
    ), '[]'::jsonb),
    'data_types', COALESCE((
      SELECT jsonb_agg(to_jsonb(data_type) ORDER BY data_type.sort_order, data_type.code)
      FROM public.auto_automation_data_types AS data_type
      WHERE data_type.is_active = true
        AND data_type.is_delete = false
    ), '[]'::jsonb),
    'action_data_types', COALESCE((
      SELECT jsonb_agg(to_jsonb(mapping) ORDER BY mapping.sort_order, mapping.campaign_action_id, mapping.data_type_code)
      FROM public.auto_campaign_action_data_types AS mapping
      WHERE mapping.is_active = true
        AND mapping.is_delete = false
    ), '[]'::jsonb),
    'campaigns', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', campaign.id,
          'name', campaign.name,
          'action_id', campaign.action_id,
          'action_name', campaign_action.name,
          'account_id', campaign.account_id,
          'account_name', account.name,
          'flatform_type', campaign_action.flatform_type,
          'status', campaign.status,
          'schedule', campaign.schedule,
          'original_schedule', campaign.original_schedule,
          'data_types', COALESCE((
            SELECT jsonb_agg(
              jsonb_build_object(
                'code', mapping.data_type_code,
                'can_source', mapping.can_source,
                'can_target', mapping.can_target,
                'target_contact_type', mapping.target_contact_type
              )
              ORDER BY mapping.sort_order, mapping.data_type_code
            )
            FROM public.auto_campaign_action_data_types AS mapping
            WHERE mapping.campaign_action_id = campaign.action_id
              AND mapping.is_active = true
              AND mapping.is_delete = false
          ), '[]'::jsonb)
        )
        ORDER BY campaign.updated_at DESC, campaign.id DESC
      )
      FROM public.auto_campaigns AS campaign
      JOIN public.auto_campaign_actions AS campaign_action
        ON campaign_action.id = campaign.action_id
      JOIN public.auto_accounts AS account
        ON account.id = campaign.account_id
      WHERE campaign.staff_id = p_staff_id
        AND campaign.organization_id = p_organization_id
        AND COALESCE(campaign.is_delete, false) = false
        AND campaign_action.is_active = true
        AND COALESCE(campaign_action.is_delete, false) = false
        AND account.staff_id = p_staff_id
        AND account.organization_id = p_organization_id
        AND COALESCE(account.is_delete, false) = false
        AND EXISTS (
          SELECT 1
          FROM public.auto_campaign_action_data_types AS mapping
          WHERE mapping.campaign_action_id = campaign.action_id
            AND mapping.is_active = true
            AND mapping.is_delete = false
        )
    ), '[]'::jsonb),
    'contact_groups', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', contact_group.id,
          'name', contact_group.name,
          'account_id', contact_group.account_id,
          'contact_type', contact_group.contact_type,
          'purpose', contact_group.purpose
        )
        ORDER BY lower(contact_group.name), contact_group.id
      )
      FROM public.auto_account_contact_groups AS contact_group
      JOIN public.auto_accounts AS account
        ON account.id = contact_group.account_id
      WHERE contact_group.staff_id = p_staff_id
        AND contact_group.organization_id = p_organization_id
        AND contact_group.purpose = 'data_group'
        AND contact_group.is_delete = false
        AND account.staff_id = p_staff_id
        AND account.organization_id = p_organization_id
        AND COALESCE(account.is_delete, false) = false
    ), '[]'::jsonb),
    'catalog_statuses', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', status_mapping.id,
          'campaign_action_id', status_mapping.campaign_action_id,
          'action_code', status_mapping.action_code,
          'status_id', status_mapping.status_id,
          'status_value', status_mapping.status_value,
          'label', status_mapping.label
        )
        ORDER BY status_mapping.campaign_action_id, status_mapping.sort_order, status_mapping.id
      )
      FROM public.auto_campaign_action_detail_statuses AS status_mapping
      WHERE status_mapping.is_active = true
        AND status_mapping.is_delete = false
    ), '[]'::jsonb),
    'status_options', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'campaign_id', observed.campaign_id,
          'campaign_action_id', observed.campaign_action_id,
          'action_code', observed.action_code,
          'status_value', observed.status_value,
          'occurrence_count', observed.occurrence_count,
          'last_seen_at', observed.last_seen_at
        )
        ORDER BY observed.campaign_id, lower(observed.status_value), observed.action_code
      )
      FROM (
        SELECT
          campaign.id AS campaign_id,
          campaign.action_id AS campaign_action_id,
          detail.action_code,
          detail.status AS status_value,
          count(*)::integer AS occurrence_count,
          max(detail.created_at) AS last_seen_at
        FROM public.auto_campaigns AS campaign
        JOIN public.auto_campaign_details AS detail
          ON detail.campaign_id = campaign.id
        WHERE campaign.staff_id = p_staff_id
          AND campaign.organization_id = p_organization_id
          AND COALESCE(campaign.is_delete, false) = false
          AND COALESCE(detail.is_delete, false) = false
        GROUP BY campaign.id, campaign.action_id, detail.action_code, detail.status
      ) AS observed
    ), '[]'::jsonb)
  );
$$;

CREATE OR REPLACE FUNCTION public.aka_agent_save_automation(
  p_staff_id bigint,
  p_organization_id bigint,
  p_automation_id bigint,
  p_name text,
  p_source_campaign_id bigint,
  p_target_campaign_id bigint,
  p_data_type_code text,
  p_target_contact_group_id bigint,
  p_schedule_mode text,
  p_delay_days integer,
  p_delay_hours integer,
  p_fixed_at timestamptz,
  p_note text,
  p_is_active boolean,
  p_trigger_statuses jsonb,
  p_auth_username text DEFAULT NULL,
  p_auth_password text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_existing public.auto_automation%ROWTYPE;
  v_rule_id bigint;
  v_validation jsonb;
  v_source_action_id text;
  v_status jsonb;
  v_action_code text;
  v_status_value text;
  v_status_mapping_id bigint;
  v_semantic_status_id bigint;
BEGIN
  PERFORM public.auto_assert_automation_identity(
    p_staff_id,
    p_organization_id,
    p_auth_username,
    p_auth_password
  );

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'auto_automation_graph:' || p_staff_id::text || ':' || p_organization_id::text,
    0
  ));

  IF NULLIF(btrim(COALESCE(p_name, '')), '') IS NULL
    OR length(btrim(p_name)) > 200 THEN
    RAISE EXCEPTION 'invalid_automation_name';
  END IF;

  IF jsonb_typeof(COALESCE(p_trigger_statuses, 'null'::jsonb)) <> 'array'
    OR jsonb_array_length(p_trigger_statuses) = 0
    OR jsonb_array_length(p_trigger_statuses) > 100 THEN
    RAISE EXCEPTION 'invalid_automation_trigger_statuses';
  END IF;

  -- Validate tenant/campaign/data/schedule before any rule mutation. Trigger
  -- status validation happens again after the replacement set is inserted.
  v_validation := public.auto_validate_automation_rule_internal(
    p_staff_id,
    p_organization_id,
    p_automation_id,
    p_source_campaign_id,
    p_target_campaign_id,
    p_data_type_code,
    p_target_contact_group_id,
    p_schedule_mode,
    COALESCE(p_delay_days, 0),
    COALESCE(p_delay_hours, 0),
    p_fixed_at,
    COALESCE(p_is_active, false),
    false
  );
  v_source_action_id := v_validation ->> 'source_action_id';

  IF p_automation_id IS NULL THEN
    INSERT INTO public.auto_automation (
      automation_action_id,
      name,
      source_campaign_id,
      target_campaign_id,
      data_type_code,
      target_contact_group_id,
      schedule_mode,
      delay_days,
      delay_hours,
      fixed_at,
      note,
      is_active,
      activated_at,
      config_version,
      is_delete,
      staff_id,
      organization_id
    )
    VALUES (
      'campaign_detail_route',
      btrim(p_name),
      p_source_campaign_id,
      p_target_campaign_id,
      p_data_type_code,
      p_target_contact_group_id,
      p_schedule_mode,
      COALESCE(p_delay_days, 0),
      COALESCE(p_delay_hours, 0),
      p_fixed_at,
      NULLIF(btrim(COALESCE(p_note, '')), ''),
      COALESCE(p_is_active, false),
      CASE WHEN COALESCE(p_is_active, false) THEN clock_timestamp() ELSE NULL END,
      1,
      false,
      p_staff_id,
      p_organization_id
    )
    RETURNING id INTO v_rule_id;
  ELSE
    SELECT *
    INTO v_existing
    FROM public.auto_automation AS automation
    WHERE automation.id = p_automation_id
      AND automation.staff_id = p_staff_id
      AND automation.organization_id = p_organization_id
      AND automation.is_delete = false
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'automation_not_found';
    END IF;

    UPDATE public.auto_automation AS automation
    SET
      name = btrim(p_name),
      source_campaign_id = p_source_campaign_id,
      target_campaign_id = p_target_campaign_id,
      data_type_code = p_data_type_code,
      target_contact_group_id = p_target_contact_group_id,
      schedule_mode = p_schedule_mode,
      delay_days = COALESCE(p_delay_days, 0),
      delay_hours = COALESCE(p_delay_hours, 0),
      fixed_at = p_fixed_at,
      note = NULLIF(btrim(COALESCE(p_note, '')), ''),
      is_active = COALESCE(p_is_active, false),
      -- A configuration edit starts a new event boundary. Existing executions
      -- keep their snapshot and the rule never backfills older result rows.
      activated_at = CASE
        WHEN COALESCE(p_is_active, false) THEN clock_timestamp()
        ELSE automation.activated_at
      END,
      config_version = automation.config_version + 1,
      updated_at = clock_timestamp()
    WHERE automation.id = v_existing.id
    RETURNING automation.id INTO v_rule_id;

    DELETE FROM public.auto_automation_trigger_statuses AS trigger_status
    WHERE trigger_status.automation_id = v_rule_id;
  END IF;

  FOR v_status IN
    SELECT item.value
    FROM jsonb_array_elements(p_trigger_statuses) AS item(value)
  LOOP
    IF jsonb_typeof(v_status) <> 'object' THEN
      RAISE EXCEPTION 'invalid_automation_trigger_status';
    END IF;

    v_action_code := NULLIF(btrim(COALESCE(
      v_status ->> 'actionCode',
      v_status ->> 'action_code',
      ''
    )), '');
    v_status_value := NULLIF(btrim(COALESCE(
      v_status ->> 'statusValue',
      v_status ->> 'status_value',
      v_status ->> 'status',
      ''
    )), '');

    IF v_status_value IS NULL OR length(v_status_value) > 200 THEN
      RAISE EXCEPTION 'invalid_automation_trigger_status_value';
    END IF;

    IF v_action_code IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.auto_account_actions AS account_action
        WHERE account_action.code = v_action_code
          AND account_action.is_active = true
          AND account_action.is_delete = false
      ) THEN
      RAISE EXCEPTION 'invalid_automation_trigger_action_code';
    END IF;

    SELECT status_catalog.id
    INTO v_semantic_status_id
    FROM public.auto_status AS status_catalog
    WHERE status_catalog.component_type = 'campaign_detail'
      AND status_catalog.is_active = true
      AND status_catalog.is_delete = false
      AND lower(status_catalog.name) = lower(v_status_value)
    ORDER BY status_catalog.sort_order, status_catalog.id
    LIMIT 1;

    INSERT INTO public.auto_campaign_action_detail_statuses (
      campaign_action_id,
      action_code,
      status_id,
      status_value,
      label,
      is_active,
      is_delete,
      updated_at
    )
    VALUES (
      v_source_action_id,
      v_action_code,
      v_semantic_status_id,
      v_status_value,
      v_status_value,
      true,
      false,
      clock_timestamp()
    )
    ON CONFLICT DO NOTHING;

    UPDATE public.auto_campaign_action_detail_statuses AS status_mapping
    SET
      is_active = true,
      label = v_status_value,
      status_id = COALESCE(status_mapping.status_id, v_semantic_status_id),
      updated_at = clock_timestamp()
    WHERE status_mapping.campaign_action_id = v_source_action_id
      AND status_mapping.action_code IS NOT DISTINCT FROM v_action_code
      AND lower(status_mapping.status_value) = lower(v_status_value)
      AND status_mapping.is_delete = false;

    SELECT status_mapping.id
    INTO v_status_mapping_id
    FROM public.auto_campaign_action_detail_statuses AS status_mapping
    WHERE status_mapping.campaign_action_id = v_source_action_id
      AND status_mapping.action_code IS NOT DISTINCT FROM v_action_code
      AND lower(status_mapping.status_value) = lower(v_status_value)
      AND status_mapping.is_delete = false
    ORDER BY status_mapping.id
    LIMIT 1;

    IF v_status_mapping_id IS NULL THEN
      RAISE EXCEPTION 'automation_status_mapping_failed';
    END IF;

    INSERT INTO public.auto_automation_trigger_statuses (
      automation_id,
      status_mapping_id,
      action_code,
      status_value
    )
    VALUES (
      v_rule_id,
      v_status_mapping_id,
      v_action_code,
      v_status_value
    )
    ON CONFLICT DO NOTHING;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
    FROM public.auto_automation_trigger_statuses AS trigger_status
    WHERE trigger_status.automation_id = v_rule_id
  ) THEN
    RAISE EXCEPTION 'automation_trigger_status_required';
  END IF;

  PERFORM public.auto_validate_automation_rule_internal(
    p_staff_id,
    p_organization_id,
    v_rule_id,
    p_source_campaign_id,
    p_target_campaign_id,
    p_data_type_code,
    p_target_contact_group_id,
    p_schedule_mode,
    COALESCE(p_delay_days, 0),
    COALESCE(p_delay_hours, 0),
    p_fixed_at,
    COALESCE(p_is_active, false),
    true
  );

  RETURN public.auto_automation_to_json(
    v_rule_id,
    p_staff_id,
    p_organization_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.aka_agent_set_automation_active(
  p_staff_id bigint,
  p_organization_id bigint,
  p_automation_id bigint,
  p_is_active boolean,
  p_auth_username text DEFAULT NULL,
  p_auth_password text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_rule public.auto_automation%ROWTYPE;
BEGIN
  PERFORM public.auto_assert_automation_identity(
    p_staff_id,
    p_organization_id,
    p_auth_username,
    p_auth_password
  );

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'auto_automation_graph:' || p_staff_id::text || ':' || p_organization_id::text,
    0
  ));

  SELECT *
  INTO v_rule
  FROM public.auto_automation AS automation
  WHERE automation.id = p_automation_id
    AND automation.staff_id = p_staff_id
    AND automation.organization_id = p_organization_id
    AND automation.is_delete = false
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'automation_not_found';
  END IF;

  IF COALESCE(p_is_active, false) THEN
    PERFORM public.auto_validate_automation_rule_internal(
      p_staff_id,
      p_organization_id,
      v_rule.id,
      v_rule.source_campaign_id,
      v_rule.target_campaign_id,
      v_rule.data_type_code,
      v_rule.target_contact_group_id,
      v_rule.schedule_mode,
      v_rule.delay_days,
      v_rule.delay_hours,
      v_rule.fixed_at,
      true,
      true
    );
  END IF;

  UPDATE public.auto_automation AS automation
  SET
    is_active = COALESCE(p_is_active, false),
    activated_at = CASE
      WHEN COALESCE(p_is_active, false) AND NOT automation.is_active
        THEN clock_timestamp()
      ELSE automation.activated_at
    END,
    updated_at = clock_timestamp()
  WHERE automation.id = v_rule.id;

  RETURN public.auto_automation_to_json(
    v_rule.id,
    p_staff_id,
    p_organization_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.aka_agent_delete_automation(
  p_staff_id bigint,
  p_organization_id bigint,
  p_automation_id bigint,
  p_auth_username text DEFAULT NULL,
  p_auth_password text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_rule public.auto_automation%ROWTYPE;
  v_result jsonb;
BEGIN
  PERFORM public.auto_assert_automation_identity(
    p_staff_id,
    p_organization_id,
    p_auth_username,
    p_auth_password
  );

  SELECT *
  INTO v_rule
  FROM public.auto_automation AS automation
  WHERE automation.id = p_automation_id
    AND automation.staff_id = p_staff_id
    AND automation.organization_id = p_organization_id
    AND automation.is_delete = false
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'automation_not_found';
  END IF;

  UPDATE public.auto_automation AS automation
  SET
    is_active = false,
    is_delete = true,
    updated_at = clock_timestamp()
  WHERE automation.id = v_rule.id;

  UPDATE public.auto_automation_detail AS detail
  SET
    status = 'bỏ qua',
    last_error = 'automation_deleted',
    locked_at = NULL,
    locked_by = NULL,
    processed_at = clock_timestamp(),
    updated_at = clock_timestamp()
  WHERE detail.automation_id = v_rule.id
    AND detail.status IN ('chờ xử lý', 'đang xử lý');

  v_result := to_jsonb(v_rule) || jsonb_build_object(
    'is_active', false,
    'is_delete', true,
    'deleted_at', clock_timestamp()
  );
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.aka_agent_list_automation_details(
  p_staff_id bigint,
  p_organization_id bigint,
  p_automation_id bigint DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_limit integer DEFAULT 100,
  p_offset integer DEFAULT 0,
  p_auth_username text DEFAULT NULL,
  p_auth_password text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_items jsonb := '[]'::jsonb;
  v_total integer := 0;
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500);
  v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
BEGIN
  PERFORM public.auto_assert_automation_identity(
    p_staff_id,
    p_organization_id,
    p_auth_username,
    p_auth_password
  );

  IF p_status IS NOT NULL
    AND p_status NOT IN ('chờ xử lý', 'đang xử lý', 'đã thêm', 'bỏ qua', 'lỗi') THEN
    RAISE EXCEPTION 'invalid_automation_detail_status';
  END IF;

  IF p_automation_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.auto_automation AS automation
      WHERE automation.id = p_automation_id
        AND automation.staff_id = p_staff_id
        AND automation.organization_id = p_organization_id
    ) THEN
    RAISE EXCEPTION 'automation_not_found';
  END IF;

  SELECT count(*)::integer
  INTO v_total
  FROM public.auto_automation_detail AS detail
  WHERE detail.staff_id = p_staff_id
    AND detail.organization_id = p_organization_id
    AND (p_automation_id IS NULL OR detail.automation_id = p_automation_id)
    AND (p_status IS NULL OR detail.status = p_status);

  SELECT COALESCE(jsonb_agg(page.payload ORDER BY page.created_at DESC, page.id DESC), '[]'::jsonb)
  INTO v_items
  FROM (
    SELECT
      detail.id,
      detail.created_at,
      to_jsonb(detail)
      || jsonb_build_object(
        'automation_name', automation.name,
        'source_campaign_name', source_campaign.name,
        'source_campaign_detail_status', source_detail.status,
        'target_campaign_name', target_campaign.name,
        'target_campaign_status', target_campaign.status,
        'target_result_status', target_result.status,
        'target_result_count', COALESCE(target_result.result_count, 0),
        'target_contact_group_name', target_group.name
      ) AS payload
    FROM public.auto_automation_detail AS detail
    JOIN public.auto_automation AS automation
      ON automation.id = detail.automation_id
    JOIN public.auto_campaigns AS source_campaign
      ON source_campaign.id = detail.source_campaign_id
    JOIN public.auto_campaign_details AS source_detail
      ON source_detail.id = detail.source_campaign_detail_id
    JOIN public.auto_campaigns AS target_campaign
      ON target_campaign.id = detail.target_campaign_id
    LEFT JOIN public.auto_account_contact_groups AS target_group
      ON target_group.id = detail.target_contact_group_id
    LEFT JOIN LATERAL (
      SELECT
        latest.status,
        count(*) OVER ()::integer AS result_count
      FROM public.auto_campaign_details AS latest
      WHERE latest.auto_automation_detail_id = detail.id
        AND COALESCE(latest.is_delete, false) = false
      ORDER BY latest.created_at DESC, latest.id DESC
      LIMIT 1
    ) AS target_result ON true
    WHERE detail.staff_id = p_staff_id
      AND detail.organization_id = p_organization_id
      AND (p_automation_id IS NULL OR detail.automation_id = p_automation_id)
      AND (p_status IS NULL OR detail.status = p_status)
    ORDER BY detail.created_at DESC, detail.id DESC
    LIMIT v_limit
    OFFSET v_offset
  ) AS page;

  RETURN jsonb_build_object(
    'items', v_items,
    'total', v_total,
    'limit', v_limit,
    'offset', v_offset
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Detail trace inheritance and thin outbox producer
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.aka_agent_inherit_automation_detail_trace()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.auto_automation_detail_id IS NULL
    AND NEW.input_data_id IS NOT NULL THEN
    SELECT input_data.auto_automation_detail_id
    INTO NEW.auto_automation_detail_id
    FROM public.auto_campaign_input_data AS input_data
    WHERE input_data.id = NEW.input_data_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.aka_agent_enqueue_campaign_detail_automations()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_event_at timestamptz := clock_timestamp();
  v_reconcile_event_at text;
  v_is_reconcile boolean := false;
  v_enqueue_error text;
  v_source_action_id text;
  v_semantic_status_id bigint;
BEGIN
  v_is_reconcile := COALESCE(
    current_setting('aka_agent.automation_reconcile', true),
    ''
  ) = 'on';
  v_reconcile_event_at := NULLIF(
    current_setting('aka_agent.automation_event_at', true),
    ''
  );
  IF v_is_reconcile AND v_reconcile_event_at IS NOT NULL THEN
    BEGIN
      v_event_at := v_reconcile_event_at::timestamptz;
    EXCEPTION
      WHEN OTHERS THEN
        v_event_at := clock_timestamp();
    END;
  END IF;

  IF NEW.input_data_id IS NULL OR COALESCE(NEW.is_delete, false) THEN
    UPDATE public.auto_automation_enqueue_failures AS failure
    SET
      status = 'resolved',
      resolved_at = clock_timestamp(),
      last_error = NULL,
      updated_at = clock_timestamp()
    WHERE failure.source_campaign_detail_id = NEW.id
      AND failure.status = 'pending';
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
    AND NEW.status IS NOT DISTINCT FROM OLD.status
    AND NEW.action_code IS NOT DISTINCT FROM OLD.action_code
    AND NEW.is_delete IS NOT DISTINCT FROM OLD.is_delete
    AND NOT v_is_reconcile THEN
    RETURN NEW;
  END IF;

  SELECT campaign.action_id
  INTO v_source_action_id
  FROM public.auto_campaigns AS campaign
  WHERE campaign.id = NEW.campaign_id
    AND COALESCE(campaign.is_delete, false) = false;

  IF v_source_action_id IS NULL THEN
    UPDATE public.auto_automation_enqueue_failures AS failure
    SET
      status = 'resolved',
      resolved_at = clock_timestamp(),
      last_error = 'source_campaign_missing_or_deleted',
      updated_at = clock_timestamp()
    WHERE failure.source_campaign_detail_id = NEW.id
      AND failure.status = 'pending';
    RETURN NEW;
  END IF;

  -- Keep the open-ended status catalog useful even before a rule selects a new
  -- runtime value. This is metadata-only and stays inside the protected outbox
  -- trigger subtransaction.
  BEGIN
    SELECT status_catalog.id
    INTO v_semantic_status_id
    FROM public.auto_status AS status_catalog
    WHERE status_catalog.component_type = 'campaign_detail'
      AND status_catalog.is_active = true
      AND status_catalog.is_delete = false
      AND lower(status_catalog.name) = lower(NEW.status)
    ORDER BY status_catalog.sort_order, status_catalog.id
    LIMIT 1;

    INSERT INTO public.auto_campaign_action_detail_statuses (
      campaign_action_id,
      action_code,
      status_id,
      status_value,
      label,
      is_active,
      is_delete,
      updated_at
    )
    VALUES (
      v_source_action_id,
      NEW.action_code,
      v_semantic_status_id,
      NEW.status,
      NEW.status,
      true,
      false,
      v_event_at
    )
    ON CONFLICT DO NOTHING;

    UPDATE public.auto_campaign_action_detail_statuses AS status_mapping
    SET
      is_active = true,
      label = NEW.status,
      status_id = COALESCE(status_mapping.status_id, v_semantic_status_id),
      updated_at = v_event_at
    WHERE status_mapping.campaign_action_id = v_source_action_id
      AND status_mapping.action_code IS NOT DISTINCT FROM NEW.action_code
      AND lower(status_mapping.status_value) = lower(NEW.status)
      AND status_mapping.is_delete = false;
  EXCEPTION
    WHEN OTHERS THEN
      RAISE WARNING
        'Automation status catalog update ignored for campaign detail %: %',
        NEW.id,
        SQLERRM;
  END;

  INSERT INTO public.auto_automation_detail (
    automation_id,
    parent_automation_detail_id,
    source_campaign_detail_id,
    source_campaign_input_data_id,
    source_campaign_id,
    source_account_id,
    source_action_id,
    source_action_code,
    source_status,
    target_campaign_id,
    target_account_id,
    target_action_id,
    data_type_code,
    data_value,
    source_input_snapshot,
    config_snapshot,
    target_contact_group_id,
    scheduled_at,
    status,
    next_attempt_at,
    last_error,
    processed_at,
    staff_id,
    organization_id,
    created_at,
    updated_at
  )
  SELECT
    automation.id,
    parent_execution.id,
    NEW.id,
    source_input.id,
    source_campaign.id,
    source_campaign.account_id,
    source_campaign.action_id,
    NEW.action_code,
    NEW.status,
    target_campaign.id,
    target_campaign.account_id,
    target_campaign.action_id,
    automation.data_type_code,
    NULLIF(btrim(CASE data_type.source_column
      WHEN 'phone' THEN source_input.phone
      WHEN 'email' THEN source_input.email
      ELSE source_input.uid
    END), ''),
    jsonb_strip_nulls(jsonb_build_object(
      'id', source_input.id,
      'campaign_id', source_input.campaign_id,
      'input_id', source_input.input_id,
      'name', source_input.name,
      'phone', source_input.phone,
      'phone_carrier', source_input.phone_carrier,
      'uid', source_input.uid,
      'email', source_input.email,
      'info1', source_input.info1,
      'info2', source_input.info2,
      'info3', source_input.info3,
      'info4', source_input.info4,
      'info5', source_input.info5,
      'content', source_input.content,
      'schedule', source_input.schedule,
      'created_at', source_input.created_at
    )),
    jsonb_build_object(
      'automation_id', automation.id,
      'automation_name', automation.name,
      'automation_action_id', automation.automation_action_id,
      'config_version', automation.config_version,
      'data_type_code', automation.data_type_code,
      'target_contact_type', target_mapping.target_contact_type,
      'target_contact_group_id', automation.target_contact_group_id,
      'schedule_mode', automation.schedule_mode,
      'delay_days', automation.delay_days,
      'delay_hours', automation.delay_hours,
      'fixed_at', automation.fixed_at,
      'target_campaign', jsonb_strip_nulls(jsonb_build_object(
        'id', target_campaign.id,
        'name', target_campaign.name,
        'action_id', target_campaign.action_id,
        'account_id', target_campaign.account_id,
        'status', target_campaign.status,
        'schedule', target_campaign.schedule,
        'original_schedule', target_campaign.original_schedule,
        'content', target_campaign.content,
        'extra_settings', target_campaign.extra_settings,
        'images', target_campaign.images
      ))
    ),
    automation.target_contact_group_id,
    CASE automation.schedule_mode
      WHEN 'after_delay' THEN v_event_at + make_interval(
        days => automation.delay_days,
        hours => automation.delay_hours
      )
      WHEN 'fixed_at' THEN automation.fixed_at
      ELSE v_event_at
    END,
    CASE
      WHEN automation.schedule_mode = 'fixed_at'
        AND v_event_at > automation.fixed_at THEN 'bỏ qua'
      WHEN NULLIF(btrim(CASE data_type.source_column
        WHEN 'phone' THEN source_input.phone
        WHEN 'email' THEN source_input.email
        ELSE source_input.uid
      END), '') IS NULL THEN 'bỏ qua'
      ELSE 'chờ xử lý'
    END,
    CASE automation.schedule_mode
      WHEN 'after_delay' THEN v_event_at + make_interval(
        days => automation.delay_days,
        hours => automation.delay_hours
      )
      WHEN 'fixed_at' THEN automation.fixed_at
      ELSE v_event_at
    END,
    CASE
      WHEN automation.schedule_mode = 'fixed_at'
        AND v_event_at > automation.fixed_at THEN 'fixed_schedule_expired'
      WHEN NULLIF(btrim(CASE data_type.source_column
        WHEN 'phone' THEN source_input.phone
        WHEN 'email' THEN source_input.email
        ELSE source_input.uid
      END), '') IS NULL THEN 'source_data_missing'
      ELSE NULL
    END,
    CASE
      WHEN automation.schedule_mode = 'fixed_at'
        AND v_event_at > automation.fixed_at THEN v_event_at
      WHEN NULLIF(btrim(CASE data_type.source_column
        WHEN 'phone' THEN source_input.phone
        WHEN 'email' THEN source_input.email
        ELSE source_input.uid
      END), '') IS NULL THEN v_event_at
      ELSE NULL
    END,
    automation.staff_id,
    automation.organization_id,
    v_event_at,
    v_event_at
  FROM public.auto_automation AS automation
  JOIN public.auto_automation_actions AS automation_action
    ON automation_action.id = automation.automation_action_id
  JOIN public.auto_automation_data_types AS data_type
    ON data_type.code = automation.data_type_code
  JOIN public.auto_campaigns AS source_campaign
    ON source_campaign.id = automation.source_campaign_id
  JOIN public.auto_campaign_input_data AS source_input
    ON source_input.id = NEW.input_data_id
   AND source_input.campaign_id = source_campaign.id
   AND COALESCE(source_input.is_delete, false) = false
  JOIN public.auto_campaigns AS target_campaign
    ON target_campaign.id = automation.target_campaign_id
   AND COALESCE(target_campaign.is_delete, false) = false
  JOIN public.auto_campaign_action_data_types AS source_mapping
    ON source_mapping.campaign_action_id = source_campaign.action_id
   AND source_mapping.data_type_code = automation.data_type_code
   AND source_mapping.can_source = true
   AND source_mapping.is_active = true
   AND source_mapping.is_delete = false
  JOIN public.auto_campaign_action_data_types AS target_mapping
    ON target_mapping.campaign_action_id = target_campaign.action_id
   AND target_mapping.data_type_code = automation.data_type_code
   AND target_mapping.can_target = true
   AND target_mapping.is_active = true
   AND target_mapping.is_delete = false
  LEFT JOIN public.auto_automation_detail AS parent_execution
    ON parent_execution.id = NEW.auto_automation_detail_id
   AND parent_execution.staff_id = automation.staff_id
   AND parent_execution.organization_id = automation.organization_id
  WHERE automation.source_campaign_id = NEW.campaign_id
    AND automation.is_active = true
    AND automation.is_delete = false
    AND automation.activated_at IS NOT NULL
    AND automation.activated_at <= v_event_at
    AND automation_action.id = 'campaign_detail_route'
    AND automation_action.is_available = true
    AND automation_action.is_active = true
    AND automation_action.is_delete = false
    AND source_campaign.staff_id = automation.staff_id
    AND source_campaign.organization_id = automation.organization_id
    AND target_campaign.staff_id = automation.staff_id
    AND target_campaign.organization_id = automation.organization_id
    AND EXISTS (
      SELECT 1
      FROM public.auto_automation_trigger_statuses AS trigger_status
      WHERE trigger_status.automation_id = automation.id
        AND lower(trigger_status.status_value) = lower(NEW.status)
        AND (
          trigger_status.action_code IS NULL
          OR trigger_status.action_code IS NOT DISTINCT FROM NEW.action_code
        )
    )
  ON CONFLICT (automation_id, source_campaign_detail_id) DO NOTHING;

  UPDATE public.auto_automation_enqueue_failures AS failure
  SET
    status = 'resolved',
    resolved_at = clock_timestamp(),
    last_error = NULL,
    updated_at = clock_timestamp()
  WHERE failure.source_campaign_detail_id = NEW.id
    AND failure.status = 'pending';

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    v_enqueue_error := SQLERRM;
    BEGIN
      INSERT INTO public.auto_automation_enqueue_failures (
        source_campaign_detail_id,
        source_campaign_id,
        source_status,
        source_action_code,
        source_is_delete,
        event_at,
        status,
        next_attempt_at,
        last_error,
        resolved_at,
        staff_id,
        organization_id,
        updated_at
      )
      SELECT
        NEW.id,
        campaign.id,
        NEW.status,
        NEW.action_code,
        COALESCE(NEW.is_delete, false),
        v_event_at,
        'pending',
        clock_timestamp(),
        left(v_enqueue_error, 2000),
        NULL,
        campaign.staff_id,
        campaign.organization_id,
        clock_timestamp()
      FROM public.auto_campaigns AS campaign
      WHERE campaign.id = NEW.campaign_id
      ON CONFLICT (source_campaign_detail_id) DO UPDATE SET
        source_campaign_id = EXCLUDED.source_campaign_id,
        source_status = EXCLUDED.source_status,
        source_action_code = EXCLUDED.source_action_code,
        source_is_delete = EXCLUDED.source_is_delete,
        event_at = EXCLUDED.event_at,
        status = 'pending',
        next_attempt_at = clock_timestamp(),
        last_error = EXCLUDED.last_error,
        resolved_at = NULL,
        staff_id = EXCLUDED.staff_id,
        organization_id = EXCLUDED.organization_id,
        updated_at = clock_timestamp();
    EXCEPTION
      WHEN OTHERS THEN
        RAISE WARNING
          'Automation enqueue failure could not be persisted for campaign detail %: %',
          NEW.id,
          SQLERRM;
    END;

    RAISE WARNING
      'Automation enqueue deferred for campaign detail %: %',
      NEW.id,
      v_enqueue_error;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.auto_retry_automation_enqueue_failure_internal(
  p_failure_id bigint
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_failure public.auto_automation_enqueue_failures%ROWTYPE;
  v_status text;
BEGIN
  SELECT *
  INTO v_failure
  FROM public.auto_automation_enqueue_failures AS failure
  WHERE failure.id = p_failure_id
  FOR UPDATE;

  IF NOT FOUND OR v_failure.status = 'resolved' THEN
    RETURN true;
  END IF;

  PERFORM set_config('aka_agent.automation_reconcile', 'on', true);
  PERFORM set_config(
    'aka_agent.automation_event_at',
    v_failure.event_at::text,
    true
  );

  -- UPDATE OF status deliberately re-enters the same trigger implementation.
  -- The session-local reconcile flag bypasses its no-change fast path.
  UPDATE public.auto_campaign_details AS detail
  SET status = detail.status
  WHERE detail.id = v_failure.source_campaign_detail_id;

  PERFORM set_config('aka_agent.automation_reconcile', 'off', true);
  PERFORM set_config('aka_agent.automation_event_at', '', true);

  SELECT failure.status
  INTO v_status
  FROM public.auto_automation_enqueue_failures AS failure
  WHERE failure.id = p_failure_id;

  RETURN v_status IS NULL OR v_status = 'resolved';
EXCEPTION
  WHEN OTHERS THEN
    PERFORM set_config('aka_agent.automation_reconcile', 'off', true);
    PERFORM set_config('aka_agent.automation_event_at', '', true);
    RAISE;
END;
$$;

DROP TRIGGER IF EXISTS trg_aka_agent_inherit_automation_detail_trace
  ON public.auto_campaign_details;
CREATE TRIGGER trg_aka_agent_inherit_automation_detail_trace
  BEFORE INSERT ON public.auto_campaign_details
  FOR EACH ROW
  EXECUTE FUNCTION public.aka_agent_inherit_automation_detail_trace();

DROP TRIGGER IF EXISTS trg_aka_agent_enqueue_campaign_detail_automations
  ON public.auto_campaign_details;
CREATE TRIGGER trg_aka_agent_enqueue_campaign_detail_automations
  AFTER INSERT OR UPDATE OF status, action_code, is_delete
  ON public.auto_campaign_details
  FOR EACH ROW
  EXECUTE FUNCTION public.aka_agent_enqueue_campaign_detail_automations();

-- ---------------------------------------------------------------------------
-- Worker queue RPCs
-- ---------------------------------------------------------------------------

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
  scheduled_at timestamptz,
  target_row_index bigint,
  attempt_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_execution record;
  v_row_index bigint;
  v_existing_input_count bigint;
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
BEGIN
  PERFORM public.auto_assert_automation_identity(
    p_staff_id,
    p_organization_id,
    p_auth_username,
    p_auth_password
  );

  IF NULLIF(btrim(COALESCE(p_worker_id, '')), '') IS NULL
    OR length(btrim(p_worker_id)) > 200 THEN
    RAISE EXCEPTION 'invalid_automation_worker_id';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.org_staff AS staff
    WHERE staff.id = p_staff_id
      AND staff.organization_id = p_organization_id
      AND staff.is_active = true
  ) THEN
    RAISE EXCEPTION 'inactive_automation_staff';
  END IF;

  FOR v_execution IN
    SELECT detail.id, detail.target_campaign_id, detail.target_row_index
    FROM public.auto_automation_detail AS detail
    JOIN public.auto_automation AS automation
      ON automation.id = detail.automation_id
    WHERE detail.staff_id = p_staff_id
      AND detail.organization_id = p_organization_id
      AND detail.status = 'chờ xử lý'
      AND detail.next_attempt_at <= clock_timestamp()
      AND detail.scheduled_at <= clock_timestamp()
      AND automation.staff_id = p_staff_id
      AND automation.organization_id = p_organization_id
      AND automation.is_active = true
      AND automation.is_delete = false
    ORDER BY detail.scheduled_at ASC, detail.created_at ASC, detail.id ASC
    FOR UPDATE OF detail SKIP LOCKED
    LIMIT v_limit
  LOOP
    v_row_index := v_execution.target_row_index;

    IF v_row_index IS NULL THEN
      SELECT count(*)::bigint
      INTO v_existing_input_count
      FROM public.auto_campaign_input_data AS input_data
      WHERE input_data.campaign_id = v_execution.target_campaign_id
        AND COALESCE(input_data.is_delete, false) = false;

      INSERT INTO public.auto_automation_target_counters AS counter (
        target_campaign_id,
        next_row_index,
        staff_id,
        organization_id,
        updated_at
      )
      VALUES (
        v_execution.target_campaign_id,
        v_existing_input_count + 1,
        p_staff_id,
        p_organization_id,
        clock_timestamp()
      )
      ON CONFLICT (target_campaign_id) DO UPDATE SET
        next_row_index = GREATEST(
          counter.next_row_index + 1,
          EXCLUDED.next_row_index
        ),
        updated_at = clock_timestamp()
      RETURNING counter.next_row_index - 1
      INTO v_row_index;
    END IF;

    UPDATE public.auto_automation_detail AS detail
    SET
      status = 'đang xử lý',
      target_row_index = v_row_index,
      attempt_count = detail.attempt_count + 1,
      locked_at = clock_timestamp(),
      locked_by = btrim(p_worker_id),
      last_error = NULL,
      updated_at = clock_timestamp()
    WHERE detail.id = v_execution.id;

    RETURN QUERY
    SELECT
      claimed.id,
      claimed.automation_id,
      claimed.parent_automation_detail_id,
      claimed.source_campaign_detail_id,
      claimed.source_campaign_input_data_id,
      claimed.source_campaign_id,
      claimed.source_account_id,
      claimed.source_action_id,
      claimed.source_action_code,
      claimed.source_status,
      claimed.target_campaign_id,
      claimed.target_account_id,
      claimed.target_action_id,
      claimed.data_type_code,
      claimed.data_value,
      claimed.source_input_snapshot,
      claimed.config_snapshot,
      claimed.target_contact_group_id,
      claimed.scheduled_at,
      claimed.target_row_index,
      claimed.attempt_count
    FROM public.auto_automation_detail AS claimed
    WHERE claimed.id = v_execution.id;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.retry_auto_automation_detail(
  p_staff_id bigint,
  p_organization_id bigint,
  p_automation_detail_id bigint,
  p_worker_id text,
  p_error text,
  p_delay_seconds integer DEFAULT 30,
  p_terminal boolean DEFAULT false,
  p_skip boolean DEFAULT false,
  p_count_attempt boolean DEFAULT true,
  p_auth_username text DEFAULT NULL,
  p_auth_password text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_automation_id bigint;
  v_automation public.auto_automation%ROWTYPE;
  v_execution public.auto_automation_detail%ROWTYPE;
  v_next_status text;
BEGIN
  PERFORM public.auto_assert_automation_identity(
    p_staff_id,
    p_organization_id,
    p_auth_username,
    p_auth_password
  );

  IF COALESCE(p_delay_seconds, 30) < 0
    OR COALESCE(p_delay_seconds, 30) > 86400 THEN
    RAISE EXCEPTION 'invalid_automation_retry_delay';
  END IF;

  SELECT detail.automation_id
  INTO v_automation_id
  FROM public.auto_automation_detail AS detail
  WHERE detail.id = p_automation_detail_id
    AND detail.staff_id = p_staff_id
    AND detail.organization_id = p_organization_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'automation_detail_not_found';
  END IF;

  -- Global lock order for delete/materialize is automation -> execution.
  -- Reading the immutable FK first does not acquire a row lock.
  SELECT *
  INTO v_automation
  FROM public.auto_automation AS automation
  WHERE automation.id = v_automation_id
    AND automation.staff_id = p_staff_id
    AND automation.organization_id = p_organization_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'automation_not_found';
  END IF;

  SELECT *
  INTO v_execution
  FROM public.auto_automation_detail AS detail
  WHERE detail.id = p_automation_detail_id
    AND detail.automation_id = v_automation.id
    AND detail.staff_id = p_staff_id
    AND detail.organization_id = p_organization_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'automation_detail_not_found';
  END IF;

  IF v_execution.status IN ('đã thêm', 'bỏ qua', 'lỗi') THEN
    RETURN jsonb_build_object(
      'result', 'already_final',
      'automation_detail_id', v_execution.id,
      'status', v_execution.status,
      'attempt_count', v_execution.attempt_count
    );
  END IF;

  IF v_execution.status <> 'đang xử lý'
    OR v_execution.locked_by IS DISTINCT FROM btrim(p_worker_id) THEN
    RETURN jsonb_build_object(
      'result', 'not_claimed',
      'automation_detail_id', v_execution.id,
      'status', v_execution.status
    );
  END IF;

  v_next_status := CASE
    WHEN COALESCE(p_skip, false) THEN 'bỏ qua'
    WHEN COALESCE(p_terminal, false) THEN 'lỗi'
    ELSE 'chờ xử lý'
  END;

  UPDATE public.auto_automation_detail AS detail
  SET
    status = v_next_status,
    attempt_count = CASE
      WHEN COALESCE(p_count_attempt, true) THEN detail.attempt_count
      ELSE GREATEST(detail.attempt_count - 1, 0)
    END,
    next_attempt_at = CASE
      WHEN v_next_status = 'chờ xử lý'
        THEN clock_timestamp() + make_interval(secs => COALESCE(p_delay_seconds, 30))
      ELSE detail.next_attempt_at
    END,
    locked_at = NULL,
    locked_by = NULL,
    last_error = NULLIF(btrim(COALESCE(p_error, '')), ''),
    processed_at = CASE
      WHEN v_next_status IN ('bỏ qua', 'lỗi') THEN clock_timestamp()
      ELSE NULL
    END,
    updated_at = clock_timestamp()
  WHERE detail.id = v_execution.id
  RETURNING * INTO v_execution;

  RETURN jsonb_build_object(
    'result', CASE
      WHEN v_next_status = 'chờ xử lý' THEN 'retry_scheduled'
      WHEN v_next_status = 'bỏ qua' THEN 'skipped'
      ELSE 'failed'
    END,
    'automation_detail_id', v_execution.id,
    'status', v_execution.status,
    'attempt_count', v_execution.attempt_count,
    'next_attempt_at', v_execution.next_attempt_at,
    'last_error', v_execution.last_error
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.recover_stale_auto_automation_details(
  p_staff_id bigint,
  p_organization_id bigint,
  p_stale_after_seconds integer DEFAULT 120,
  p_auth_username text DEFAULT NULL,
  p_auth_password text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_recovered integer := 0;
BEGIN
  PERFORM public.auto_assert_automation_identity(
    p_staff_id,
    p_organization_id,
    p_auth_username,
    p_auth_password
  );

  IF COALESCE(p_stale_after_seconds, 120) < 30
    OR COALESCE(p_stale_after_seconds, 120) > 86400 THEN
    RAISE EXCEPTION 'invalid_automation_stale_window';
  END IF;

  UPDATE public.auto_automation_detail AS detail
  SET
    status = 'chờ xử lý',
    next_attempt_at = clock_timestamp(),
    locked_at = NULL,
    locked_by = NULL,
    last_error = 'worker_lock_timeout',
    updated_at = clock_timestamp()
  WHERE detail.staff_id = p_staff_id
    AND detail.organization_id = p_organization_id
    AND detail.status = 'đang xử lý'
    AND detail.locked_at < clock_timestamp()
      - make_interval(secs => COALESCE(p_stale_after_seconds, 120));

  GET DIAGNOSTICS v_recovered = ROW_COUNT;
  RETURN v_recovered;
END;
$$;

CREATE OR REPLACE FUNCTION public.reconcile_auto_automation_enqueue_failures(
  p_staff_id bigint,
  p_organization_id bigint,
  p_worker_id text,
  p_limit integer DEFAULT 100,
  p_auth_username text DEFAULT NULL,
  p_auth_password text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_failure record;
  v_processed integer := 0;
  v_resolved integer := 0;
  v_failed integer := 0;
  v_pending integer := 0;
  v_success boolean;
  v_error text;
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500);
BEGIN
  PERFORM public.auto_assert_automation_identity(
    p_staff_id,
    p_organization_id,
    p_auth_username,
    p_auth_password
  );

  IF NULLIF(btrim(COALESCE(p_worker_id, '')), '') IS NULL
    OR length(btrim(p_worker_id)) > 200 THEN
    RAISE EXCEPTION 'invalid_automation_worker_id';
  END IF;

  FOR v_failure IN
    SELECT failure.id
    FROM public.auto_automation_enqueue_failures AS failure
    WHERE failure.staff_id = p_staff_id
      AND failure.organization_id = p_organization_id
      AND failure.status = 'pending'
      AND failure.next_attempt_at <= clock_timestamp()
    ORDER BY failure.event_at ASC, failure.id ASC
    FOR UPDATE OF failure SKIP LOCKED
    LIMIT v_limit
  LOOP
    v_processed := v_processed + 1;

    UPDATE public.auto_automation_enqueue_failures AS failure
    SET
      attempt_count = failure.attempt_count + 1,
      updated_at = clock_timestamp()
    WHERE failure.id = v_failure.id;

    BEGIN
      v_success := public.auto_retry_automation_enqueue_failure_internal(
        v_failure.id
      );

      IF v_success THEN
        v_resolved := v_resolved + 1;
      ELSE
        v_failed := v_failed + 1;
        UPDATE public.auto_automation_enqueue_failures AS failure
        SET
          next_attempt_at = clock_timestamp() + interval '30 seconds',
          updated_at = clock_timestamp()
        WHERE failure.id = v_failure.id
          AND failure.status = 'pending';
      END IF;
    EXCEPTION
      WHEN OTHERS THEN
        v_error := SQLERRM;
        v_failed := v_failed + 1;
        UPDATE public.auto_automation_enqueue_failures AS failure
        SET
          status = 'pending',
          next_attempt_at = clock_timestamp() + interval '30 seconds',
          last_error = left(v_error, 2000),
          resolved_at = NULL,
          updated_at = clock_timestamp()
        WHERE failure.id = v_failure.id;
    END;
  END LOOP;

  SELECT count(*)::integer
  INTO v_pending
  FROM public.auto_automation_enqueue_failures AS failure
  WHERE failure.staff_id = p_staff_id
    AND failure.organization_id = p_organization_id
    AND failure.status = 'pending';

  RETURN jsonb_build_object(
    'processed', v_processed,
    'resolved', v_resolved,
    'failed', v_failed,
    'pending', v_pending,
    'worker_id', btrim(p_worker_id)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.materialize_auto_automation_detail(
  p_staff_id bigint,
  p_organization_id bigint,
  p_automation_detail_id bigint,
  p_worker_id text,
  p_target_input jsonb,
  p_auth_username text DEFAULT NULL,
  p_auth_password text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_automation_id bigint;
  v_automation public.auto_automation%ROWTYPE;
  v_execution public.auto_automation_detail%ROWTYPE;
  v_campaign record;
  v_group record;
  v_target_input_id bigint;
  v_target_contact_id bigint;
  v_target_group_member_id bigint;
  v_target_contact_type text;
  v_payload jsonb := COALESCE(p_target_input, '{}'::jsonb);
  v_name text;
  v_phone text;
  v_phone_carrier text;
  v_uid text;
  v_email text;
  v_info1 text;
  v_info2 text;
  v_info3 text;
  v_info4 text;
  v_info5 text;
  v_content text;
  v_contact_uid text;
  v_contact_url text;
  v_contact_name text;
  v_contact_extra jsonb;
  v_target_snapshot jsonb;
BEGIN
  PERFORM public.auto_assert_automation_identity(
    p_staff_id,
    p_organization_id,
    p_auth_username,
    p_auth_password
  );

  IF jsonb_typeof(v_payload) <> 'object' THEN
    RAISE EXCEPTION 'invalid_automation_target_input';
  END IF;

  -- Keep the same lock order as delete: automation first, execution second.
  -- The initial read is only used to discover the immutable parent id.
  SELECT detail.automation_id
  INTO v_automation_id
  FROM public.auto_automation_detail AS detail
  WHERE detail.id = p_automation_detail_id
    AND detail.staff_id = p_staff_id
    AND detail.organization_id = p_organization_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'automation_detail_not_found';
  END IF;

  SELECT *
  INTO v_automation
  FROM public.auto_automation AS automation
  WHERE automation.id = v_automation_id
    AND automation.staff_id = p_staff_id
    AND automation.organization_id = p_organization_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'automation_not_found';
  END IF;

  SELECT *
  INTO v_execution
  FROM public.auto_automation_detail AS detail
  WHERE detail.id = p_automation_detail_id
    AND detail.automation_id = v_automation.id
    AND detail.staff_id = p_staff_id
    AND detail.organization_id = p_organization_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'automation_detail_not_found';
  END IF;

  IF v_execution.status = 'đã thêm' THEN
    RETURN jsonb_build_object(
      'result', 'already_materialized',
      'retryable', false,
      'automation_detail_id', v_execution.id,
      'target_input_data_id', v_execution.target_input_data_id,
      'target_contact_id', v_execution.target_contact_id,
      'target_contact_group_member_id', v_execution.target_contact_group_member_id,
      'target_row_index', v_execution.target_row_index
    );
  END IF;

  IF v_execution.status IN ('bỏ qua', 'lỗi') THEN
    RETURN jsonb_build_object(
      'result', 'failed',
      'retryable', false,
      'automation_detail_id', v_execution.id,
      'status', v_execution.status,
      'error', v_execution.last_error
    );
  END IF;

  IF v_execution.status <> 'đang xử lý'
    OR v_execution.locked_by IS DISTINCT FROM btrim(p_worker_id) THEN
    RETURN jsonb_build_object(
      'result', 'not_claimed',
      'retryable', true,
      'automation_detail_id', v_execution.id,
      'status', v_execution.status
    );
  END IF;

  -- Defensive idempotency repair for a target input manually committed by an
  -- older client before the ledger row was finalized.
  SELECT input_data.id
  INTO v_target_input_id
  FROM public.auto_campaign_input_data AS input_data
  WHERE input_data.auto_automation_detail_id = v_execution.id
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    UPDATE public.auto_automation_detail AS detail
    SET
      status = 'đã thêm',
      target_input_data_id = v_target_input_id,
      locked_at = NULL,
      locked_by = NULL,
      processed_at = COALESCE(detail.processed_at, clock_timestamp()),
      updated_at = clock_timestamp()
    WHERE detail.id = v_execution.id
    RETURNING * INTO v_execution;

    RETURN jsonb_build_object(
      'result', 'already_materialized',
      'retryable', false,
      'automation_detail_id', v_execution.id,
      'target_input_data_id', v_execution.target_input_data_id,
      'target_contact_id', v_execution.target_contact_id,
      'target_contact_group_member_id', v_execution.target_contact_group_member_id,
      'target_row_index', v_execution.target_row_index
    );
  END IF;

  SELECT
    campaign.id,
    campaign.name,
    campaign.action_id,
    campaign.account_id,
    campaign.status,
    campaign.schedule,
    campaign.is_delete
  INTO v_campaign
  FROM public.auto_campaigns AS campaign
  WHERE campaign.id = v_execution.target_campaign_id
    AND campaign.staff_id = p_staff_id
    AND campaign.organization_id = p_organization_id
  FOR UPDATE;

  IF NOT FOUND
    OR COALESCE(v_campaign.is_delete, false)
    OR v_campaign.action_id IS DISTINCT FROM v_execution.target_action_id
    OR v_campaign.account_id IS DISTINCT FROM v_execution.target_account_id THEN
    UPDATE public.auto_automation_detail AS detail
    SET
      status = 'lỗi',
      last_error = 'target_campaign_changed_or_deleted',
      locked_at = NULL,
      locked_by = NULL,
      processed_at = clock_timestamp(),
      updated_at = clock_timestamp()
    WHERE detail.id = v_execution.id;

    RETURN jsonb_build_object(
      'result', 'failed',
      'retryable', false,
      'automation_detail_id', v_execution.id,
      'error', 'target_campaign_changed_or_deleted'
    );
  END IF;

  IF v_campaign.status = 'đang chạy' THEN
    RETURN jsonb_build_object(
      'result', 'target_running',
      'retryable', true,
      'automation_detail_id', v_execution.id,
      'target_campaign_id', v_campaign.id,
      'target_row_index', v_execution.target_row_index
    );
  END IF;

  IF v_campaign.status NOT IN ('chờ xử lý', 'tạm dừng', 'hoàn thành') THEN
    UPDATE public.auto_automation_detail AS detail
    SET
      status = 'lỗi',
      last_error = 'invalid_target_campaign_status',
      locked_at = NULL,
      locked_by = NULL,
      processed_at = clock_timestamp(),
      updated_at = clock_timestamp()
    WHERE detail.id = v_execution.id;

    RETURN jsonb_build_object(
      'result', 'failed',
      'retryable', false,
      'automation_detail_id', v_execution.id,
      'error', 'invalid_target_campaign_status'
    );
  END IF;

  v_target_contact_type := NULLIF(
    btrim(v_execution.config_snapshot ->> 'target_contact_type'),
    ''
  );

  IF v_execution.target_contact_group_id IS NOT NULL THEN
    SELECT
      contact_group.id,
      contact_group.account_id,
      contact_group.contact_type,
      contact_group.purpose,
      contact_group.is_delete
    INTO v_group
    FROM public.auto_account_contact_groups AS contact_group
    WHERE contact_group.id = v_execution.target_contact_group_id
      AND contact_group.staff_id = p_staff_id
      AND contact_group.organization_id = p_organization_id
    FOR UPDATE;

    IF NOT FOUND
      OR COALESCE(v_group.is_delete, false)
      OR v_group.account_id <> v_execution.target_account_id
      OR v_group.purpose <> 'data_group'
      OR v_group.contact_type IS DISTINCT FROM v_target_contact_type THEN
      UPDATE public.auto_automation_detail AS detail
      SET
        status = 'lỗi',
        last_error = 'target_contact_group_changed_or_deleted',
        locked_at = NULL,
        locked_by = NULL,
        processed_at = clock_timestamp(),
        updated_at = clock_timestamp()
      WHERE detail.id = v_execution.id;

      RETURN jsonb_build_object(
        'result', 'failed',
        'retryable', false,
        'automation_detail_id', v_execution.id,
        'error', 'target_contact_group_changed_or_deleted'
      );
    END IF;
  END IF;

  v_name := COALESCE(
    NULLIF(btrim(v_payload ->> 'name'), ''),
    NULLIF(btrim(v_execution.source_input_snapshot ->> 'name'), ''),
    v_execution.data_value
  );
  v_phone := COALESCE(
    NULLIF(btrim(v_payload ->> 'phone'), ''),
    NULLIF(btrim(v_execution.source_input_snapshot ->> 'phone'), '')
  );
  v_phone_carrier := COALESCE(
    NULLIF(btrim(v_payload ->> 'phoneCarrier'), ''),
    NULLIF(btrim(v_payload ->> 'phone_carrier'), ''),
    NULLIF(btrim(v_execution.source_input_snapshot ->> 'phone_carrier'), '')
  );
  v_uid := COALESCE(
    NULLIF(btrim(v_payload ->> 'uid'), ''),
    NULLIF(btrim(v_execution.source_input_snapshot ->> 'uid'), '')
  );
  v_email := lower(COALESCE(
    NULLIF(btrim(v_payload ->> 'email'), ''),
    NULLIF(btrim(v_execution.source_input_snapshot ->> 'email'), ''),
    ''
  ));
  v_email := NULLIF(v_email, '');
  v_info1 := COALESCE(v_payload ->> 'info1', v_execution.source_input_snapshot ->> 'info1');
  v_info2 := COALESCE(v_payload ->> 'info2', v_execution.source_input_snapshot ->> 'info2');
  v_info3 := COALESCE(v_payload ->> 'info3', v_execution.source_input_snapshot ->> 'info3');
  v_info4 := COALESCE(v_payload ->> 'info4', v_execution.source_input_snapshot ->> 'info4');
  v_info5 := COALESCE(v_payload ->> 'info5', v_execution.source_input_snapshot ->> 'info5');
  v_content := COALESCE(v_payload ->> 'content', v_execution.source_input_snapshot ->> 'content');

  IF v_execution.data_type_code = 'phone' THEN
    v_phone := COALESCE(v_phone, NULLIF(btrim(v_execution.data_value), ''));
    IF v_phone IS NULL THEN
      RAISE EXCEPTION 'automation_target_phone_missing';
    END IF;
  ELSIF v_execution.data_type_code = 'email' THEN
    v_email := lower(COALESCE(v_email, NULLIF(btrim(v_execution.data_value), '')));
    IF v_email IS NULL THEN
      RAISE EXCEPTION 'automation_target_email_missing';
    END IF;
  ELSE
    v_uid := COALESCE(v_uid, NULLIF(btrim(v_execution.data_value), ''));
    IF v_uid IS NULL THEN
      RAISE EXCEPTION 'automation_target_uid_missing';
    END IF;
  END IF;

  IF v_execution.target_action_id = 'sms_send'
    AND NULLIF(btrim(COALESCE(v_content, '')), '') IS NULL THEN
    RAISE EXCEPTION 'automation_sms_content_missing';
  END IF;

  v_target_snapshot := jsonb_strip_nulls(jsonb_build_object(
    'campaign_id', v_execution.target_campaign_id,
    'name', v_name,
    'phone', v_phone,
    'phone_carrier', v_phone_carrier,
    'uid', v_uid,
    'email', v_email,
    'info1', v_info1,
    'info2', v_info2,
    'info3', v_info3,
    'info4', v_info4,
    'info5', v_info5,
    'content', v_content,
    'schedule', v_execution.scheduled_at,
    'row_index', v_execution.target_row_index
  ));

  INSERT INTO public.auto_campaign_input_data (
    campaign_id,
    input_id,
    name,
    phone,
    phone_carrier,
    uid,
    email,
    info1,
    info2,
    info3,
    info4,
    info5,
    content,
    status,
    note,
    schedule,
    is_delete,
    auto_automation_detail_id
  )
  VALUES (
    v_execution.target_campaign_id,
    NULL,
    v_name,
    v_phone,
    v_phone_carrier,
    v_uid,
    v_email,
    v_info1,
    v_info2,
    v_info3,
    v_info4,
    v_info5,
    v_content,
    'chờ xử lý',
    NULL,
    v_execution.scheduled_at,
    false,
    v_execution.id
  )
  RETURNING id INTO v_target_input_id;

  IF v_execution.target_contact_group_id IS NOT NULL THEN
    v_contact_uid := COALESCE(
      NULLIF(btrim(v_payload ->> 'contactUid'), ''),
      NULLIF(btrim(v_payload ->> 'contact_uid'), ''),
      CASE v_execution.data_type_code
        WHEN 'phone' THEN v_phone
        WHEN 'email' THEN v_email
        ELSE v_uid
      END
    );
    v_contact_url := COALESCE(
      NULLIF(btrim(v_payload ->> 'contactUrl'), ''),
      NULLIF(btrim(v_payload ->> 'contact_url'), '')
    );
    v_contact_name := COALESCE(
      NULLIF(btrim(v_payload ->> 'contactName'), ''),
      NULLIF(btrim(v_payload ->> 'contact_name'), ''),
      NULLIF(btrim(v_name), ''),
      v_contact_uid
    );

    IF v_contact_uid IS NULL THEN
      RAISE EXCEPTION 'automation_contact_identity_missing';
    END IF;

    v_contact_extra := jsonb_strip_nulls(jsonb_build_object(
      'platform', CASE
        WHEN v_execution.data_type_code = 'zalo_uid' THEN 'zalo'
        WHEN v_execution.data_type_code = 'facebook_uid' THEN 'facebook'
        WHEN v_execution.data_type_code = 'email' THEN 'email'
        ELSE 'sms'
      END,
      'phone', v_phone,
      'email', v_email,
      'automationDetailId', v_execution.id,
      'sourceCampaignDetailId', v_execution.source_campaign_detail_id
    ));

    INSERT INTO public.auto_account_contacts AS existing_contact (
      account_id,
      contact_type,
      name,
      uid,
      url,
      extra_data,
      is_delete,
      staff_id,
      organization_id,
      updated_at
    )
    VALUES (
      v_execution.target_account_id,
      v_target_contact_type,
      v_contact_name,
      v_contact_uid,
      v_contact_url,
      v_contact_extra,
      false,
      p_staff_id,
      p_organization_id,
      clock_timestamp()
    )
    ON CONFLICT (account_id, contact_type, uid) DO UPDATE SET
      name = CASE
        WHEN NULLIF(btrim(existing_contact.name), '') IS NULL
          THEN EXCLUDED.name
        ELSE existing_contact.name
      END,
      url = COALESCE(existing_contact.url, EXCLUDED.url),
      extra_data = COALESCE(existing_contact.extra_data, '{}'::jsonb)
        || EXCLUDED.extra_data,
      is_delete = false,
      staff_id = EXCLUDED.staff_id,
      organization_id = EXCLUDED.organization_id,
      updated_at = clock_timestamp()
    RETURNING id INTO v_target_contact_id;

    INSERT INTO public.auto_account_contact_group_members (
      group_id,
      contact_id
    )
    VALUES (
      v_execution.target_contact_group_id,
      v_target_contact_id
    )
    ON CONFLICT (group_id, contact_id) DO NOTHING
    RETURNING id INTO v_target_group_member_id;

    IF v_target_group_member_id IS NULL THEN
      SELECT member.id
      INTO v_target_group_member_id
      FROM public.auto_account_contact_group_members AS member
      WHERE member.group_id = v_execution.target_contact_group_id
        AND member.contact_id = v_target_contact_id;
    END IF;
  END IF;

  UPDATE public.auto_campaigns AS campaign
  SET
    status = CASE
      WHEN campaign.status = 'hoàn thành' THEN 'chờ xử lý'
      ELSE campaign.status
    END,
    schedule = CASE
      WHEN campaign.status = 'hoàn thành' THEN v_execution.scheduled_at
      ELSE LEAST(
        COALESCE(campaign.schedule, v_execution.scheduled_at),
        v_execution.scheduled_at
      )
    END,
    completed_at = CASE
      WHEN campaign.status = 'hoàn thành' THEN NULL
      ELSE campaign.completed_at
    END,
    note = CASE
      WHEN campaign.status = 'hoàn thành' THEN NULL
      ELSE campaign.note
    END,
    updated_at = clock_timestamp()
  WHERE campaign.id = v_execution.target_campaign_id;

  UPDATE public.auto_automation_detail AS detail
  SET
    status = 'đã thêm',
    target_input_data_id = v_target_input_id,
    target_contact_id = v_target_contact_id,
    target_contact_group_member_id = v_target_group_member_id,
    target_input_snapshot = v_target_snapshot,
    last_error = NULL,
    locked_at = NULL,
    locked_by = NULL,
    processed_at = clock_timestamp(),
    updated_at = clock_timestamp()
  WHERE detail.id = v_execution.id
  RETURNING * INTO v_execution;

  UPDATE public.auto_automation AS automation
  SET
    last_data_at = v_execution.processed_at,
    updated_at = clock_timestamp()
  WHERE automation.id = v_execution.automation_id
    AND automation.staff_id = p_staff_id
    AND automation.organization_id = p_organization_id;

  RETURN jsonb_build_object(
    'result', 'materialized',
    'retryable', false,
    'automation_detail_id', v_execution.id,
    'target_campaign_id', v_execution.target_campaign_id,
    'target_campaign_status', CASE
      WHEN v_campaign.status = 'hoàn thành' THEN 'chờ xử lý'
      ELSE v_campaign.status
    END,
    'target_input_data_id', v_execution.target_input_data_id,
    'target_contact_id', v_execution.target_contact_id,
    'target_contact_group_member_id', v_execution.target_contact_group_member_id,
    'target_row_index', v_execution.target_row_index,
    'scheduled_at', v_execution.scheduled_at
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Supabase Data API permissions
-- ---------------------------------------------------------------------------

ALTER TABLE public.auto_automation_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auto_automation_data_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auto_campaign_action_data_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auto_campaign_action_detail_statuses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auto_automation ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auto_automation_trigger_statuses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auto_automation_detail ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auto_automation_target_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auto_automation_enqueue_failures ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS auto_automation_actions_read_catalog
  ON public.auto_automation_actions;
CREATE POLICY auto_automation_actions_read_catalog
  ON public.auto_automation_actions
  FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS auto_automation_data_types_read_catalog
  ON public.auto_automation_data_types;
CREATE POLICY auto_automation_data_types_read_catalog
  ON public.auto_automation_data_types
  FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS auto_campaign_action_data_types_read_catalog
  ON public.auto_campaign_action_data_types;
CREATE POLICY auto_campaign_action_data_types_read_catalog
  ON public.auto_campaign_action_data_types
  FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS auto_campaign_action_detail_statuses_read_catalog
  ON public.auto_campaign_action_detail_statuses;
CREATE POLICY auto_campaign_action_detail_statuses_read_catalog
  ON public.auto_campaign_action_detail_statuses
  FOR SELECT
  TO anon, authenticated
  USING (true);

REVOKE ALL PRIVILEGES ON TABLE public.auto_automation_actions
  FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.auto_automation_data_types
  FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.auto_campaign_action_data_types
  FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.auto_campaign_action_detail_statuses
  FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.auto_automation_actions
  TO anon, authenticated, service_role;
GRANT SELECT ON TABLE public.auto_automation_data_types
  TO anon, authenticated, service_role;
GRANT SELECT ON TABLE public.auto_campaign_action_data_types
  TO anon, authenticated, service_role;
GRANT SELECT ON TABLE public.auto_campaign_action_detail_statuses
  TO anon, authenticated, service_role;

REVOKE ALL PRIVILEGES ON TABLE public.auto_automation
  FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.auto_automation_trigger_statuses
  FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.auto_automation_detail
  FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.auto_automation_target_counters
  FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.auto_automation_enqueue_failures
  FROM PUBLIC, anon, authenticated;

GRANT ALL PRIVILEGES ON TABLE public.auto_automation TO service_role;
GRANT ALL PRIVILEGES ON TABLE public.auto_automation_trigger_statuses TO service_role;
GRANT ALL PRIVILEGES ON TABLE public.auto_automation_detail TO service_role;
GRANT ALL PRIVILEGES ON TABLE public.auto_automation_target_counters TO service_role;
GRANT ALL PRIVILEGES ON TABLE public.auto_automation_enqueue_failures TO service_role;

REVOKE ALL PRIVILEGES ON SEQUENCE public.auto_campaign_action_detail_statuses_id_seq
  FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON SEQUENCE public.auto_automation_id_seq
  FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON SEQUENCE public.auto_automation_trigger_statuses_id_seq
  FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON SEQUENCE public.auto_automation_detail_id_seq
  FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON SEQUENCE public.auto_automation_enqueue_failures_id_seq
  FROM PUBLIC, anon, authenticated;

GRANT USAGE, SELECT ON SEQUENCE public.auto_campaign_action_detail_statuses_id_seq TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.auto_automation_id_seq TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.auto_automation_trigger_statuses_id_seq TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.auto_automation_detail_id_seq TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.auto_automation_enqueue_failures_id_seq TO service_role;

REVOKE ALL ON FUNCTION public.auto_assert_automation_identity(
  bigint, bigint, text, text
) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.auto_validate_automation_rule_internal(
  bigint, bigint, bigint, bigint, bigint, text, bigint,
  text, integer, integer, timestamptz, boolean, boolean
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.auto_automation_to_json(bigint, bigint, bigint)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.aka_agent_inherit_automation_detail_trace()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.aka_agent_enqueue_campaign_detail_automations()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.auto_retry_automation_enqueue_failure_internal(bigint)
  FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.aka_agent_validate_automation_rule(
  bigint, bigint, bigint, bigint, bigint, text, bigint,
  text, integer, integer, timestamptz, boolean, boolean, text, text
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.aka_agent_list_automations(
  bigint, bigint, text, boolean, text, bigint, bigint, timestamptz,
  integer, integer, text, text, text, text
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.aka_agent_get_automation(bigint, bigint, bigint, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.aka_agent_get_automation_options(bigint, bigint, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.aka_agent_save_automation(
  bigint, bigint, bigint, text, bigint, bigint, text, bigint,
  text, integer, integer, timestamptz, text, boolean, jsonb, text, text
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.aka_agent_set_automation_active(
  bigint, bigint, bigint, boolean, text, text
)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.aka_agent_delete_automation(bigint, bigint, bigint, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.aka_agent_list_automation_details(
  bigint, bigint, bigint, text, integer, integer, text, text
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_auto_automation_details(
  bigint, bigint, text, integer, text, text
)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.retry_auto_automation_detail(
  bigint, bigint, bigint, text, text, integer, boolean, boolean, boolean,
  text, text
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.recover_stale_auto_automation_details(
  bigint, bigint, integer, text, text
)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reconcile_auto_automation_enqueue_failures(
  bigint, bigint, text, integer, text, text
)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.materialize_auto_automation_detail(
  bigint, bigint, bigint, text, jsonb, text, text
)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.aka_agent_validate_automation_rule(
  bigint, bigint, bigint, bigint, bigint, text, bigint,
  text, integer, integer, timestamptz, boolean, boolean, text, text
) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.aka_agent_list_automations(
  bigint, bigint, text, boolean, text, bigint, bigint, timestamptz,
  integer, integer, text, text, text, text
) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.aka_agent_get_automation(bigint, bigint, bigint, text, text)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.aka_agent_get_automation_options(bigint, bigint, text, text)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.aka_agent_save_automation(
  bigint, bigint, bigint, text, bigint, bigint, text, bigint,
  text, integer, integer, timestamptz, text, boolean, jsonb, text, text
) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.aka_agent_set_automation_active(
  bigint, bigint, bigint, boolean, text, text
)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.aka_agent_delete_automation(bigint, bigint, bigint, text, text)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.aka_agent_list_automation_details(
  bigint, bigint, bigint, text, integer, integer, text, text
) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_auto_automation_details(
  bigint, bigint, text, integer, text, text
)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.retry_auto_automation_detail(
  bigint, bigint, bigint, text, text, integer, boolean, boolean, boolean,
  text, text
) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.recover_stale_auto_automation_details(
  bigint, bigint, integer, text, text
)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reconcile_auto_automation_enqueue_failures(
  bigint, bigint, text, integer, text, text
)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.materialize_auto_automation_detail(
  bigint, bigint, bigint, text, jsonb, text, text
)
  TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
