-- Staff-shared data groups with durable provenance and live campaign intake.
--
-- This migration deliberately keeps the legacy account contact/group tables in
-- place.  Existing IDs and memberships are preserved, while purpose=data_group
-- rows become staff-shared containers.  Zalo friend blocklists retain their
-- account-scoped values and are not subjected to new behavioural constraints.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Backward-additive columns and indexes
-- ---------------------------------------------------------------------------

ALTER TABLE public.auto_account_contact_groups
  ALTER COLUMN account_id DROP NOT NULL,
  ALTER COLUMN contact_type DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS color text NOT NULL DEFAULT '#2563EB',
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS revision bigint NOT NULL DEFAULT 0;

ALTER TABLE public.auto_account_contact_group_members
  ADD COLUMN IF NOT EXISTS is_delete boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS change_revision bigint NOT NULL DEFAULT 0;

ALTER TABLE public.auto_account_contacts
  ALTER COLUMN account_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS flatform_type text,
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS email text;

UPDATE public.auto_account_contacts AS contact
SET flatform_type = account.flatform_type
FROM public.auto_accounts AS account
WHERE contact.account_id = account.id
  AND NULLIF(btrim(COALESCE(contact.flatform_type, '')), '') IS NULL;

UPDATE public.auto_account_contacts
SET phone = COALESCE(phone, CASE
      WHEN contact_type = 'phone' THEN NULLIF(btrim(uid), '')
      ELSE NULLIF(btrim(extra_data ->> 'phone'), '')
    END),
    email = COALESCE(email, CASE
      WHEN contact_type = 'email' THEN lower(NULLIF(btrim(uid), ''))
      ELSE lower(NULLIF(btrim(extra_data ->> 'email'), ''))
    END)
WHERE phone IS NULL OR email IS NULL;

-- Old installs allowed nullable tenant columns. Recover only provable scope,
-- preserving every existing ID/name/membership. Rows without any account or
-- membership evidence remain untouched instead of being guessed.
UPDATE public.auto_account_contact_groups AS contact_group
SET organization_id = staff.organization_id
FROM public.org_staff AS staff
WHERE contact_group.staff_id = staff.id
  AND contact_group.organization_id IS NULL;

UPDATE public.auto_account_contacts AS contact
SET organization_id = staff.organization_id
FROM public.org_staff AS staff
WHERE contact.staff_id = staff.id
  AND contact.organization_id IS NULL;

WITH account_scope AS (
  SELECT account.id AS account_id, account.staff_id,
         COALESCE(account.organization_id, staff.organization_id) AS organization_id
  FROM public.auto_accounts AS account
  LEFT JOIN public.org_staff AS staff ON staff.id = account.staff_id
)
UPDATE public.auto_account_contact_groups AS contact_group
SET staff_id = COALESCE(contact_group.staff_id, account_scope.staff_id),
    organization_id = COALESCE(contact_group.organization_id, account_scope.organization_id)
FROM account_scope
WHERE contact_group.account_id = account_scope.account_id
  AND (contact_group.staff_id IS NULL OR contact_group.organization_id IS NULL);

WITH account_scope AS (
  SELECT account.id AS account_id, account.staff_id,
         COALESCE(account.organization_id, staff.organization_id) AS organization_id
  FROM public.auto_accounts AS account
  LEFT JOIN public.org_staff AS staff ON staff.id = account.staff_id
)
UPDATE public.auto_account_contacts AS contact
SET staff_id = COALESCE(contact.staff_id, account_scope.staff_id),
    organization_id = COALESCE(contact.organization_id, account_scope.organization_id)
FROM account_scope
WHERE contact.account_id = account_scope.account_id
  AND (contact.staff_id IS NULL OR contact.organization_id IS NULL);

WITH member_scope AS (
  SELECT member.group_id,
    min(contact.staff_id) AS staff_id,
    min(contact.organization_id) AS organization_id
  FROM public.auto_account_contact_group_members AS member
  JOIN public.auto_account_contacts AS contact ON contact.id = member.contact_id
  WHERE contact.staff_id IS NOT NULL AND contact.organization_id IS NOT NULL
  GROUP BY member.group_id
  HAVING min(contact.staff_id) = max(contact.staff_id)
    AND min(contact.organization_id) = max(contact.organization_id)
)
UPDATE public.auto_account_contact_groups AS contact_group
SET staff_id = COALESCE(contact_group.staff_id, member_scope.staff_id),
    organization_id = COALESCE(contact_group.organization_id, member_scope.organization_id)
FROM member_scope
WHERE contact_group.id = member_scope.group_id
  AND (contact_group.staff_id IS NULL OR contact_group.organization_id IS NULL);

WITH group_scope AS (
  SELECT member.contact_id,
    min(contact_group.staff_id) AS staff_id,
    min(contact_group.organization_id) AS organization_id
  FROM public.auto_account_contact_group_members AS member
  JOIN public.auto_account_contact_groups AS contact_group ON contact_group.id = member.group_id
  WHERE contact_group.staff_id IS NOT NULL AND contact_group.organization_id IS NOT NULL
  GROUP BY member.contact_id
  HAVING min(contact_group.staff_id) = max(contact_group.staff_id)
    AND min(contact_group.organization_id) = max(contact_group.organization_id)
)
UPDATE public.auto_account_contacts AS contact
SET staff_id = COALESCE(contact.staff_id, group_scope.staff_id),
    organization_id = COALESCE(contact.organization_id, group_scope.organization_id)
FROM group_scope
WHERE contact.id = group_scope.contact_id
  AND (contact.staff_id IS NULL OR contact.organization_id IS NULL);

CREATE INDEX IF NOT EXISTS idx_auto_account_contacts_shared_lookup
  ON public.auto_account_contacts (
    staff_id, organization_id, flatform_type, contact_type, updated_at DESC, id DESC
  )
  WHERE account_id IS NULL AND COALESCE(is_delete, false) = false;

ALTER TABLE public.auto_account_contacts_dataset
  ALTER COLUMN account_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS group_id bigint
    REFERENCES public.auto_account_contact_groups(id) ON DELETE SET NULL;

-- Split v170's account-scoped dataset identity from new group-scoped uploads.
-- Keeping the old broad index would collide across groups whenever an upload
-- carries a non-null provenance account.
DROP INDEX IF EXISTS public.uq_account_contact_datasets_active_identity;

CREATE UNIQUE INDEX IF NOT EXISTS uq_account_contact_datasets_active_legacy_identity
  ON public.auto_account_contacts_dataset (
    staff_id, account_id, scan_type, contact_type, source_key
  )
  WHERE is_delete = false AND group_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_account_contact_datasets_active_group_upload
  ON public.auto_account_contacts_dataset (
    staff_id,
    organization_id,
    group_id,
    COALESCE(account_id, 0::bigint),
    flatform_type,
    contact_type,
    scan_type,
    lower(btrim(source_key))
  )
  WHERE is_delete = false AND source = 'upload' AND group_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_account_contact_datasets_group_list
  ON public.auto_account_contacts_dataset (group_id, created_at DESC, id DESC)
  WHERE is_delete = false AND group_id IS NOT NULL;

-- Both v170 writers infer their unique index with an explicit conflict-target
-- predicate. Patch that predicate in-place so the legacy RPC bodies keep their
-- exact behavior while inferring the split legacy index above.
DO $patch_v170_dataset_writers$
DECLARE
  v_oid oid;
  v_definition text;
  v_patched text;
  v_patched_count integer := 0;
BEGIN
  FOR v_oid IN
    SELECT proc.oid
    FROM pg_proc AS proc
    JOIN pg_namespace AS namespace ON namespace.oid = proc.pronamespace
    WHERE namespace.nspname = 'public'
      AND proc.proname IN (
        'aka_agent_finalize_contact_dataset',
        'aka_agent_save_upload_contact_datasets'
      )
  LOOP
    v_definition := pg_get_functiondef(v_oid);
    v_patched := regexp_replace(
      v_definition,
      'ON CONFLICT[[:space:]]*\(staff_id,[[:space:]]*account_id,[[:space:]]*scan_type,[[:space:]]*contact_type,[[:space:]]*source_key\)[[:space:]]*WHERE[[:space:]]*\(?is_delete[[:space:]]*=[[:space:]]*false\)?',
      'ON CONFLICT (staff_id, account_id, scan_type, contact_type, source_key) WHERE is_delete = false AND group_id IS NULL',
      'g'
    );
    v_patched := regexp_replace(
      v_patched,
      'AND[[:space:]]+dataset\.is_delete[[:space:]]*=[[:space:]]*false',
      'AND dataset.is_delete = false AND dataset.group_id IS NULL',
      'g'
    );
    IF v_patched = v_definition THEN
      RAISE EXCEPTION 'cannot_patch_v170_dataset_writer:%', v_oid::regprocedure;
    END IF;
    EXECUTE v_patched;
    v_patched_count := v_patched_count + 1;
  END LOOP;
  IF v_patched_count <> 2 THEN
    RAISE EXCEPTION 'expected_two_v170_dataset_writers_found:%', v_patched_count;
  END IF;
END
$patch_v170_dataset_writers$;

ALTER TABLE public.auto_campaign_input_data
  ADD COLUMN IF NOT EXISTS canonical_target_key text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_auto_campaign_input_data_canonical_target
  ON public.auto_campaign_input_data (campaign_id, canonical_target_key)
  WHERE canonical_target_key IS NOT NULL AND COALESCE(is_delete, false) = false;

-- A single canonical input may have several automation executions as origins.
-- v174 made this pointer one-to-one; data-group provenance requires many-to-one.
DROP INDEX IF EXISTS public.uq_auto_automation_detail_target_input;
CREATE INDEX IF NOT EXISTS idx_auto_automation_detail_target_input
  ON public.auto_automation_detail (target_input_data_id)
  WHERE target_input_data_id IS NOT NULL;

COMMENT ON COLUMN public.auto_campaign_input_data.canonical_target_key IS
  'Action-specific immutable delivery identity. Legacy rows intentionally remain NULL.';

-- Once a delivery has a canonical identity, its target snapshot is a ledger
-- record. Runtime may advance status/note/date_action, but it must never turn
-- that row into another target or soft-delete it to bypass the campaign key.
CREATE OR REPLACE FUNCTION public.aka_agent_guard_canonical_campaign_input_payload()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO public
AS $$
BEGIN
  IF OLD.canonical_target_key IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.campaign_id IS DISTINCT FROM OLD.campaign_id
    OR NEW.input_id IS DISTINCT FROM OLD.input_id
    OR NEW.name IS DISTINCT FROM OLD.name
    OR NEW.phone IS DISTINCT FROM OLD.phone
    OR NEW.phone_carrier IS DISTINCT FROM OLD.phone_carrier
    OR NEW.uid IS DISTINCT FROM OLD.uid
    OR NEW.email IS DISTINCT FROM OLD.email
    OR NEW.info1 IS DISTINCT FROM OLD.info1
    OR NEW.info2 IS DISTINCT FROM OLD.info2
    OR NEW.info3 IS DISTINCT FROM OLD.info3
    OR NEW.info4 IS DISTINCT FROM OLD.info4
    OR NEW.info5 IS DISTINCT FROM OLD.info5
    OR NEW.content IS DISTINCT FROM OLD.content
    OR NEW.schedule IS DISTINCT FROM OLD.schedule
    OR NEW.canonical_target_key IS DISTINCT FROM OLD.canonical_target_key
    OR NEW.auto_automation_detail_id IS DISTINCT FROM OLD.auto_automation_detail_id
    OR NEW.is_delete IS DISTINCT FROM OLD.is_delete
  THEN
    RAISE EXCEPTION 'canonical_campaign_input_payload_immutable';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_aka_agent_guard_canonical_campaign_input_payload
  ON public.auto_campaign_input_data;
CREATE TRIGGER trg_aka_agent_guard_canonical_campaign_input_payload
BEFORE UPDATE ON public.auto_campaign_input_data
FOR EACH ROW
EXECUTE FUNCTION public.aka_agent_guard_canonical_campaign_input_payload();

-- Shared data-group names are intentionally not unique.  Retain uniqueness for
-- the legacy blocklist UI only, without imposing any account/type/friend rule.
DROP INDEX IF EXISTS public.idx_auto_account_contact_groups_active_name;

CREATE UNIQUE INDEX IF NOT EXISTS uq_auto_account_contact_groups_blocklist_name
  ON public.auto_account_contact_groups (
    staff_id, account_id, contact_type, purpose, lower(name)
  )
  WHERE is_delete = false AND purpose = 'zalo_friend_blocklist';

CREATE INDEX IF NOT EXISTS idx_auto_account_contact_groups_shared_list
  ON public.auto_account_contact_groups (
    staff_id, organization_id, sort_order, updated_at DESC, id DESC
  )
  WHERE is_delete = false AND purpose = 'data_group';

CREATE INDEX IF NOT EXISTS idx_auto_account_contact_group_members_active
  ON public.auto_account_contact_group_members (group_id, updated_at DESC, id DESC)
  WHERE is_delete = false;

-- ---------------------------------------------------------------------------
-- 2. RPC-only support tables
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.auto_data_ingest_batches (
  id bigserial PRIMARY KEY,
  request_id text NOT NULL,
  operation text NOT NULL,
  group_id bigint REFERENCES public.auto_account_contact_groups(id) ON DELETE SET NULL,
  target_group_id bigint REFERENCES public.auto_account_contact_groups(id) ON DELETE SET NULL,
  kind text,
  dataset_id bigint REFERENCES public.auto_account_contacts_dataset(id) ON DELETE SET NULL,
  source_account_id bigint REFERENCES public.auto_accounts(id) ON DELETE SET NULL,
  source_name text,
  client_payload_hash text,
  request_hash text NOT NULL,
  status text NOT NULL DEFAULT 'processing',
  result jsonb,
  staff_id bigint NOT NULL REFERENCES public.org_staff(id) ON DELETE CASCADE,
  organization_id bigint NOT NULL REFERENCES public.org_organization(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auto_data_ingest_batches_operation_check CHECK (
    operation IN (
      'legacy_backfill', 'create_group', 'delete_group', 'duplicate_group', 'ingest',
      'remove_members', 'move_members', 'bind_source', 'stop_source', 'reactivate_source'
    )
  ),
  CONSTRAINT auto_data_ingest_batches_kind_check CHECK (
    kind IS NULL OR kind IN (
      'manual', 'upload', 'scan', 'automation', 'api', 'legacy', 'legacy_unknown'
    )
  ),
  CONSTRAINT auto_data_ingest_batches_status_check CHECK (
    status IN ('processing', 'completed', 'failed')
  ),
  CONSTRAINT auto_data_ingest_batches_request_check CHECK (
    length(btrim(request_id)) BETWEEN 1 AND 500
  ),
  CONSTRAINT uq_auto_data_ingest_batches_request
    UNIQUE (staff_id, organization_id, request_id)
);

CREATE INDEX IF NOT EXISTS idx_auto_data_ingest_batches_group
  ON public.auto_data_ingest_batches (group_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS public.auto_account_contact_group_member_origins (
  id bigserial PRIMARY KEY,
  membership_id bigint NOT NULL
    REFERENCES public.auto_account_contact_group_members(id) ON DELETE CASCADE,
  kind text NOT NULL,
  dataset_id bigint REFERENCES public.auto_account_contacts_dataset(id) ON DELETE SET NULL,
  batch_id bigint REFERENCES public.auto_data_ingest_batches(id) ON DELETE SET NULL,
  source_account_id bigint REFERENCES public.auto_accounts(id) ON DELETE SET NULL,
  automation_detail_id bigint REFERENCES public.auto_automation_detail(id) ON DELETE SET NULL,
  source_name_snapshot text,
  is_current boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auto_account_contact_group_member_origins_kind_check CHECK (
    kind IN ('manual', 'upload', 'scan', 'automation', 'api', 'legacy', 'legacy_unknown')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_auto_account_contact_group_member_origins_identity
  ON public.auto_account_contact_group_member_origins (
    membership_id,
    kind,
    COALESCE(dataset_id, 0::bigint),
    COALESCE(batch_id, 0::bigint),
    COALESCE(source_account_id, 0::bigint),
    COALESCE(automation_detail_id, 0::bigint),
    COALESCE(source_name_snapshot, '')
  );

CREATE INDEX IF NOT EXISTS idx_auto_account_contact_group_member_origins_dataset
  ON public.auto_account_contact_group_member_origins (dataset_id, membership_id)
  WHERE dataset_id IS NOT NULL AND is_current = true;

CREATE INDEX IF NOT EXISTS idx_auto_account_contact_group_member_origins_automation
  ON public.auto_account_contact_group_member_origins (automation_detail_id, membership_id)
  WHERE automation_detail_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.auto_campaign_creation_bundles (
  id bigserial PRIMARY KEY,
  request_id text NOT NULL,
  status text NOT NULL DEFAULT 'staged',
  expected_campaign_count integer NOT NULL,
  ready_campaign_count integer NOT NULL DEFAULT 0,
  error text,
  staff_id bigint NOT NULL REFERENCES public.org_staff(id) ON DELETE CASCADE,
  organization_id bigint NOT NULL REFERENCES public.org_organization(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auto_campaign_creation_bundles_status_check
    CHECK (status IN ('staged', 'ready', 'failed')),
  CONSTRAINT auto_campaign_creation_bundles_count_check
    CHECK (
      expected_campaign_count > 0
      AND ready_campaign_count >= 0
      AND ready_campaign_count <= expected_campaign_count
    ),
  CONSTRAINT uq_auto_campaign_creation_bundles_request
    UNIQUE (staff_id, organization_id, request_id)
);

ALTER TABLE public.auto_campaigns
  ADD COLUMN IF NOT EXISTS data_target_source_mode text NOT NULL DEFAULT 'direct',
  ADD COLUMN IF NOT EXISTS data_group_id bigint
    REFERENCES public.auto_account_contact_groups(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS provisioning_state text NOT NULL DEFAULT 'ready',
  ADD COLUMN IF NOT EXISTS creation_bundle_id bigint
    REFERENCES public.auto_campaign_creation_bundles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS creation_bundle_child_index integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.auto_campaigns'::regclass
      AND conname = 'auto_campaigns_data_target_source_mode_check'
  ) THEN
    ALTER TABLE public.auto_campaigns
      ADD CONSTRAINT auto_campaigns_data_target_source_mode_check
      CHECK (data_target_source_mode IN ('direct', 'data_group'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.auto_campaigns'::regclass
      AND conname = 'auto_campaigns_provisioning_state_check'
  ) THEN
    ALTER TABLE public.auto_campaigns
      ADD CONSTRAINT auto_campaigns_provisioning_state_check
      CHECK (provisioning_state IN ('staged', 'ready', 'failed'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_auto_campaigns_data_group
  ON public.auto_campaigns (data_group_id, status, schedule, id)
  WHERE data_target_source_mode = 'data_group' AND COALESCE(is_delete, false) = false;

CREATE UNIQUE INDEX IF NOT EXISTS uq_auto_campaigns_creation_bundle_child
  ON public.auto_campaigns (creation_bundle_id, creation_bundle_child_index)
  WHERE creation_bundle_id IS NOT NULL AND creation_bundle_child_index IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.auto_campaign_data_group_sources (
  id bigserial PRIMARY KEY,
  campaign_id bigint NOT NULL REFERENCES public.auto_campaigns(id) ON DELETE CASCADE,
  group_id bigint NOT NULL REFERENCES public.auto_account_contact_groups(id) ON DELETE RESTRICT,
  bundle_id bigint REFERENCES public.auto_campaign_creation_bundles(id) ON DELETE SET NULL,
  baseline_revision bigint NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'baselining',
  started_at timestamptz,
  stopped_at timestamptz,
  stop_reason text,
  last_ingest_at timestamptz,
  staff_id bigint NOT NULL REFERENCES public.org_staff(id) ON DELETE CASCADE,
  organization_id bigint NOT NULL REFERENCES public.org_organization(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auto_campaign_data_group_sources_status_check
    CHECK (status IN ('baselining', 'active', 'stopped')),
  CONSTRAINT uq_auto_campaign_data_group_sources_campaign UNIQUE (campaign_id)
);

CREATE INDEX IF NOT EXISTS idx_auto_campaign_data_group_sources_group_intake
  ON public.auto_campaign_data_group_sources (group_id, status, campaign_id)
  WHERE status IN ('baselining', 'active');

CREATE TABLE IF NOT EXISTS public.auto_campaign_input_origins (
  id bigserial PRIMARY KEY,
  input_data_id bigint NOT NULL
    REFERENCES public.auto_campaign_input_data(id) ON DELETE CASCADE,
  source_id bigint
    REFERENCES public.auto_campaign_data_group_sources(id) ON DELETE CASCADE,
  group_id bigint
    REFERENCES public.auto_account_contact_groups(id) ON DELETE SET NULL,
  membership_id bigint
    REFERENCES public.auto_account_contact_group_members(id) ON DELETE SET NULL,
  batch_id bigint
    REFERENCES public.auto_data_ingest_batches(id) ON DELETE SET NULL,
  origin_kind text NOT NULL DEFAULT 'group',
  automation_detail_id bigint
    REFERENCES public.auto_automation_detail(id) ON DELETE CASCADE,
  group_revision bigint NOT NULL,
  canonical_target_key text NOT NULL,
  payload_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auto_campaign_input_origins_kind_check
    CHECK (origin_kind IN ('group', 'manual', 'automation', 'api')),
  CONSTRAINT auto_campaign_input_origins_source_check
    CHECK (
      (origin_kind = 'group' AND source_id IS NOT NULL AND membership_id IS NOT NULL)
      OR (origin_kind = 'automation' AND automation_detail_id IS NOT NULL)
      OR (origin_kind IN ('manual', 'api')
        AND source_id IS NULL AND automation_detail_id IS NULL)
    ),
  CONSTRAINT auto_campaign_input_origins_payload_check
    CHECK (jsonb_typeof(payload_snapshot) = 'object')
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_auto_campaign_input_origins_identity
  ON public.auto_campaign_input_origins (
    input_data_id,
    origin_kind,
    COALESCE(source_id, 0::bigint),
    COALESCE(membership_id, 0::bigint),
    COALESCE(batch_id, 0::bigint),
    COALESCE(automation_detail_id, 0::bigint)
  );

CREATE INDEX IF NOT EXISTS idx_auto_campaign_input_origins_membership
  ON public.auto_campaign_input_origins (membership_id, input_data_id)
  WHERE membership_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_auto_campaign_input_origins_automation_detail
  ON public.auto_campaign_input_origins (automation_detail_id, input_data_id)
  WHERE automation_detail_id IS NOT NULL;

-- Supports group-level lifetime statistics without walking the input ledger or
-- stopped source rows.  Keeping canonical_target_key before input_data_id also
-- makes both DISTINCT aggregates index-friendly.
CREATE INDEX IF NOT EXISTS idx_auto_campaign_input_origins_group_canonical_input
  ON public.auto_campaign_input_origins (
    group_id, canonical_target_key, input_data_id
  )
  WHERE origin_kind = 'group' AND group_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.auto_campaign_input_target_aliases (
  id bigserial PRIMARY KEY,
  campaign_id bigint NOT NULL REFERENCES public.auto_campaigns(id) ON DELETE CASCADE,
  alias_key text NOT NULL,
  canonical_target_key text NOT NULL,
  input_data_id bigint REFERENCES public.auto_campaign_input_data(id) ON DELETE SET NULL,
  conflict_count integer NOT NULL DEFAULT 0,
  last_conflict_at timestamptz,
  last_conflict_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auto_campaign_input_target_aliases_conflict_count_check
    CHECK (conflict_count >= 0),
  CONSTRAINT uq_auto_campaign_input_target_aliases_alias
    UNIQUE (campaign_id, alias_key)
);

-- Automation can continue materializing its legacy A -> B input while also
-- publishing the result into a shared data group.  The detail column freezes
-- the selected destination when a detail is enqueued.
ALTER TABLE public.auto_automation
  ADD COLUMN IF NOT EXISTS target_data_group_id bigint
    REFERENCES public.auto_account_contact_groups(id) ON DELETE SET NULL;

ALTER TABLE public.auto_automation_detail
  ADD COLUMN IF NOT EXISTS target_data_group_id bigint
    REFERENCES public.auto_account_contact_groups(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS target_data_group_member_id bigint
    REFERENCES public.auto_account_contact_group_members(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS target_data_group_sync_status text,
  ADD COLUMN IF NOT EXISTS target_data_group_sync_error text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.auto_automation_detail'::regclass
      AND conname = 'auto_automation_detail_data_group_sync_status_check'
  ) THEN
    ALTER TABLE public.auto_automation_detail
      ADD CONSTRAINT auto_automation_detail_data_group_sync_status_check
      CHECK (target_data_group_sync_status IS NULL OR target_data_group_sync_status IN (
        'pending', 'completed', 'skipped', 'failed'
      ));
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Preserve legacy provenance, then remove account/type scope from data rows
-- ---------------------------------------------------------------------------

INSERT INTO public.auto_data_ingest_batches (
  request_id, operation, group_id, kind, source_account_id, source_name,
  request_hash, status, result, staff_id, organization_id
)
SELECT
  'migration-v186:legacy-group:' || contact_group.id::text,
  'legacy_backfill',
  contact_group.id,
  CASE WHEN contact_group.account_id IS NULL THEN 'legacy_unknown' ELSE 'legacy' END,
  contact_group.account_id,
  account.name,
  md5('migration-v186:legacy-group:' || contact_group.id::text),
  'completed',
  jsonb_build_object('legacyBackfill', true),
  contact_group.staff_id,
  contact_group.organization_id
FROM public.auto_account_contact_groups AS contact_group
LEFT JOIN public.auto_accounts AS account ON account.id = contact_group.account_id
WHERE contact_group.purpose = 'data_group'
  AND contact_group.staff_id IS NOT NULL
  AND contact_group.organization_id IS NOT NULL
ON CONFLICT (staff_id, organization_id, request_id) DO NOTHING;

INSERT INTO public.auto_account_contact_group_member_origins (
  membership_id, kind, batch_id, source_account_id, source_name_snapshot,
  is_current, created_at, updated_at
)
SELECT
  member.id,
  CASE WHEN contact_group.account_id IS NULL THEN 'legacy_unknown' ELSE 'legacy' END,
  batch.id,
  contact_group.account_id,
  account.name,
  NOT COALESCE(member.is_delete, false),
  COALESCE(member.created_at, now()),
  now()
FROM public.auto_account_contact_group_members AS member
JOIN public.auto_account_contact_groups AS contact_group
  ON contact_group.id = member.group_id
LEFT JOIN public.auto_accounts AS account ON account.id = contact_group.account_id
LEFT JOIN public.auto_data_ingest_batches AS batch
  ON batch.staff_id = contact_group.staff_id
 AND batch.organization_id = contact_group.organization_id
 AND batch.request_id = 'migration-v186:legacy-group:' || contact_group.id::text
WHERE contact_group.purpose = 'data_group'
ON CONFLICT DO NOTHING;

-- Recover every dataset observation that can be proven by the existing
-- contact/dataset membership graph. This is additive to the legacy account
-- header above; one membership may correctly have many origins.
INSERT INTO public.auto_account_contact_group_member_origins (
  membership_id, kind, dataset_id, batch_id, source_account_id,
  source_name_snapshot, is_current, created_at, updated_at
)
SELECT
  group_member.id,
  CASE dataset.source WHEN 'scan' THEN 'scan' ELSE 'upload' END,
  dataset.id,
  batch.id,
  dataset.account_id,
  dataset.name,
  NOT COALESCE(group_member.is_delete, false)
    AND dataset_member.is_current
    AND NOT dataset.is_delete,
  COALESCE(dataset_member.first_seen_at, dataset_member.created_at, now()),
  now()
FROM public.auto_account_contact_group_members AS group_member
JOIN public.auto_account_contact_groups AS contact_group
  ON contact_group.id = group_member.group_id AND contact_group.purpose = 'data_group'
JOIN public.auto_account_contacts_dataset_members AS dataset_member
  ON dataset_member.contact_id = group_member.contact_id
JOIN public.auto_account_contacts_dataset AS dataset
  ON dataset.id = dataset_member.dataset_id
LEFT JOIN public.auto_data_ingest_batches AS batch
  ON batch.staff_id = contact_group.staff_id
 AND batch.organization_id = contact_group.organization_id
 AND batch.request_id = 'migration-v186:legacy-group:' || contact_group.id::text
WHERE dataset.staff_id = contact_group.staff_id
  AND dataset.organization_id = contact_group.organization_id
ON CONFLICT DO NOTHING;

-- Automation details have an exact persisted membership pointer, so preserve
-- that provenance without inferring from campaign payloads or target keys.
INSERT INTO public.auto_account_contact_group_member_origins (
  membership_id, kind, batch_id, source_account_id, automation_detail_id, source_name_snapshot,
  is_current, created_at, updated_at
)
SELECT
  group_member.id,
  'automation',
  batch.id,
  detail.source_account_id,
  detail.id,
  'Automation #' || detail.automation_id::text || ' / detail #' || detail.id::text,
  NOT COALESCE(group_member.is_delete, false),
  COALESCE(detail.processed_at, detail.created_at, now()),
  now()
FROM public.auto_account_contact_group_members AS group_member
JOIN public.auto_account_contact_groups AS contact_group
  ON contact_group.id = group_member.group_id AND contact_group.purpose = 'data_group'
JOIN public.auto_automation_detail AS detail
  ON detail.target_contact_group_member_id = group_member.id
LEFT JOIN public.auto_data_ingest_batches AS batch
  ON batch.staff_id = contact_group.staff_id
 AND batch.organization_id = contact_group.organization_id
 AND batch.request_id = 'migration-v186:legacy-group:' || contact_group.id::text
WHERE detail.staff_id = contact_group.staff_id
  AND detail.organization_id = contact_group.organization_id
ON CONFLICT DO NOTHING;

WITH ranked AS (
  SELECT
    contact_group.id,
    (row_number() OVER (
      PARTITION BY contact_group.staff_id, contact_group.organization_id
      ORDER BY contact_group.created_at, contact_group.id
    ) - 1)::integer AS next_sort_order,
    EXISTS (
      SELECT 1
      FROM public.auto_account_contact_group_members AS member
      WHERE member.group_id = contact_group.id
        AND COALESCE(member.is_delete, false) = false
    ) AS has_members
  FROM public.auto_account_contact_groups AS contact_group
  WHERE contact_group.purpose = 'data_group'
)
UPDATE public.auto_account_contact_groups AS contact_group
SET account_id = NULL,
    contact_type = NULL,
    sort_order = ranked.next_sort_order,
    revision = CASE WHEN ranked.has_members THEN GREATEST(contact_group.revision, 1) ELSE contact_group.revision END,
    updated_at = now()
FROM ranked
WHERE contact_group.id = ranked.id;

UPDATE public.auto_account_contact_group_members AS member
SET change_revision = contact_group.revision,
    updated_at = COALESCE(member.updated_at, member.created_at, now())
FROM public.auto_account_contact_groups AS contact_group
WHERE contact_group.id = member.group_id
  AND contact_group.purpose = 'data_group';

COMMENT ON COLUMN public.auto_account_contact_groups.revision IS
  'Monotonic group mutation revision used to serialize baselines and live intake.';
COMMENT ON COLUMN public.auto_account_contact_group_members.change_revision IS
  'Group revision at which this membership was last activated or soft-deleted.';
COMMENT ON TABLE public.auto_account_contact_group_member_origins IS
  'Durable many-to-many provenance for a data-group membership.';
COMMENT ON TABLE public.auto_campaign_input_origins IS
  'Immutable payload snapshots connecting canonical campaign inputs to group memberships.';

-- ---------------------------------------------------------------------------
-- 4. Small internal helpers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.aka_agent_internal_require_staff_tenant(
  p_staff_id bigint,
  p_organization_id bigint
)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $$
BEGIN
  IF p_staff_id IS NULL OR p_staff_id <= 0
    OR p_organization_id IS NULL OR p_organization_id <= 0
    OR NOT EXISTS (
      SELECT 1
      FROM public.org_staff AS staff
      WHERE staff.id = p_staff_id
        AND staff.organization_id = p_organization_id
        AND staff.is_active = true
    )
  THEN
    RAISE EXCEPTION 'data_group_tenant_not_found';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.aka_agent_internal_normalize_phone(p_value text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path TO public
AS $$
DECLARE
  v_digits text := regexp_replace(p_value, '[^0-9]+', '', 'g');
BEGIN
  IF v_digits = '' THEN RETURN ''; END IF;
  IF v_digits LIKE '0084%' AND length(v_digits) >= 13 THEN
    v_digits := '0' || substr(v_digits, 5);
  ELSIF v_digits LIKE '84%' AND length(v_digits) >= 11 THEN
    v_digits := '0' || substr(v_digits, 3);
  END IF;
  IF length(v_digits) = 9 AND left(v_digits, 1) ~ '[35789]' THEN
    v_digits := '0' || v_digits;
  END IF;
  IF length(v_digits) = 11 THEN
    v_digits := CASE left(v_digits, 4)
      WHEN '0162' THEN '032' || substr(v_digits, 5)
      WHEN '0163' THEN '033' || substr(v_digits, 5)
      WHEN '0164' THEN '034' || substr(v_digits, 5)
      WHEN '0165' THEN '035' || substr(v_digits, 5)
      WHEN '0166' THEN '036' || substr(v_digits, 5)
      WHEN '0167' THEN '037' || substr(v_digits, 5)
      WHEN '0168' THEN '038' || substr(v_digits, 5)
      WHEN '0169' THEN '039' || substr(v_digits, 5)
      WHEN '0120' THEN '070' || substr(v_digits, 5)
      WHEN '0121' THEN '079' || substr(v_digits, 5)
      WHEN '0122' THEN '077' || substr(v_digits, 5)
      WHEN '0126' THEN '076' || substr(v_digits, 5)
      WHEN '0128' THEN '078' || substr(v_digits, 5)
      WHEN '0123' THEN '083' || substr(v_digits, 5)
      WHEN '0124' THEN '084' || substr(v_digits, 5)
      WHEN '0125' THEN '085' || substr(v_digits, 5)
      WHEN '0127' THEN '081' || substr(v_digits, 5)
      WHEN '0129' THEN '082' || substr(v_digits, 5)
      WHEN '0186' THEN '056' || substr(v_digits, 5)
      WHEN '0188' THEN '058' || substr(v_digits, 5)
      WHEN '0199' THEN '059' || substr(v_digits, 5)
      ELSE v_digits
    END;
  END IF;
  IF v_digits ~ '^0[35789][0-9]{8}$' THEN RETURN v_digits; END IF;
  RETURN '';
END;
$$;

CREATE OR REPLACE FUNCTION public.aka_agent_internal_normalize_facebook_identity(p_value text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path TO public
AS $$
DECLARE
  v_raw text := btrim(p_value);
  v_clean text;
  v_id text;
BEGIN
  IF v_raw = '' THEN RETURN ''; END IF;
  -- Numeric IDs are already canonical.
  IF v_raw ~ '^[0-9]+$' THEN RETURN v_raw; END IF;
  -- profile.php?id=... must be extracted before query removal.
  v_id := substring(lower(v_raw) FROM '[?&]id=([0-9]+)');
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  v_clean := regexp_replace(v_raw, '^(https?://)?((www|m|mbasic)\.)?facebook\.com/', '', 'i');
  v_clean := regexp_replace(v_clean, '[?#].*$', '');
  v_clean := regexp_replace(v_clean, '/+$', '');
  v_clean := regexp_replace(v_clean, '^(groups|people|pages)/', '', 'i');
  IF v_clean ~ '/' THEN
    -- /people/name/123 and /pages/name/123 use the final numeric component.
    v_id := substring(v_clean FROM '([0-9]+)$');
    IF v_id IS NOT NULL THEN RETURN v_id; END IF;
    v_clean := split_part(v_clean, '/', 1);
  END IF;
  RETURN lower(v_clean);
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. Data-group list and CRUD RPCs
-- ---------------------------------------------------------------------------

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
SET search_path TO public
AS $$
BEGIN
  PERFORM public.aka_agent_internal_require_staff_tenant(p_staff_id, p_organization_id);
  IF COALESCE(p_offset, 0) < 0 OR COALESCE(p_limit, 100) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'invalid_data_group_page';
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
  )
  SELECT
    filtered.id,
    filtered.name,
    filtered.color,
    filtered.sort_order,
    filtered.revision,
    (
        SELECT count(*)
        FROM public.auto_account_contact_group_members AS member
        WHERE member.group_id = filtered.id AND member.is_delete = false
    )::bigint,
    filtered.is_delete,
    filtered.staff_id,
    filtered.organization_id,
    filtered.created_at,
    filtered.updated_at,
    count(*) OVER ()::bigint
  FROM filtered
  ORDER BY filtered.sort_order, filtered.updated_at DESC, filtered.id DESC
  OFFSET COALESCE(p_offset, 0)
  LIMIT COALESCE(p_limit, 100);
END;
$$;

CREATE OR REPLACE FUNCTION public.aka_agent_create_data_group(
  p_staff_id bigint,
  p_organization_id bigint,
  p_name text,
  p_color text DEFAULT '#2563EB',
  p_request_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_group public.auto_account_contact_groups%ROWTYPE;
  v_batch public.auto_data_ingest_batches%ROWTYPE;
  v_request_hash text;
BEGIN
  PERFORM public.aka_agent_internal_require_staff_tenant(p_staff_id, p_organization_id);
  IF length(btrim(COALESCE(p_name, ''))) NOT BETWEEN 1 AND 255
    OR length(btrim(COALESCE(p_color, '#2563EB'))) NOT BETWEEN 1 AND 64 THEN
    RAISE EXCEPTION 'invalid_data_group_payload';
  END IF;
  v_request_hash := md5(jsonb_build_object(
    'operation', 'create_group', 'name', btrim(p_name),
    'color', btrim(COALESCE(p_color, '#2563EB'))
  )::text);

  IF NULLIF(btrim(COALESCE(p_request_id, '')), '') IS NOT NULL THEN
    INSERT INTO public.auto_data_ingest_batches (
      request_id, operation, request_hash, status, staff_id, organization_id
    ) VALUES (
      btrim(p_request_id), 'create_group', v_request_hash, 'processing',
      p_staff_id, p_organization_id
    )
    ON CONFLICT (staff_id, organization_id, request_id) DO NOTHING
    RETURNING * INTO v_batch;

    IF NOT FOUND THEN
      SELECT * INTO v_batch
      FROM public.auto_data_ingest_batches
      WHERE staff_id = p_staff_id
        AND organization_id = p_organization_id
        AND request_id = btrim(p_request_id)
      FOR UPDATE;
      IF v_batch.operation <> 'create_group' OR v_batch.request_hash <> v_request_hash THEN
        RAISE EXCEPTION 'data_group_request_id_conflict';
      END IF;
      IF v_batch.result IS NOT NULL THEN RETURN v_batch.result; END IF;
      RAISE EXCEPTION 'data_group_request_incomplete';
    END IF;
  END IF;

  INSERT INTO public.auto_account_contact_groups (
    account_id, contact_type, name, purpose, color, sort_order, revision,
    is_delete, staff_id, organization_id
  ) VALUES (
    NULL, NULL, btrim(p_name), 'data_group', btrim(COALESCE(p_color, '#2563EB')),
    COALESCE((
      SELECT max(contact_group.sort_order) + 1
      FROM public.auto_account_contact_groups AS contact_group
      WHERE contact_group.staff_id = p_staff_id
        AND contact_group.organization_id = p_organization_id
        AND contact_group.purpose = 'data_group'
        AND contact_group.is_delete = false
    ), 0),
    0, false, p_staff_id, p_organization_id
  )
  RETURNING * INTO v_group;

  IF v_batch.id IS NOT NULL THEN
    UPDATE public.auto_data_ingest_batches
    SET group_id = v_group.id,
        status = 'completed',
        result = to_jsonb(v_group) || jsonb_build_object('active_membership_count', 0),
        updated_at = now()
    WHERE id = v_batch.id
    RETURNING result INTO v_batch.result;
    RETURN v_batch.result;
  END IF;

  RETURN to_jsonb(v_group) || jsonb_build_object('active_membership_count', 0);
END;
$$;

CREATE OR REPLACE FUNCTION public.aka_agent_update_data_group(
  p_staff_id bigint,
  p_organization_id bigint,
  p_group_id bigint,
  p_name text DEFAULT NULL,
  p_color text DEFAULT NULL,
  p_sort_order integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_group public.auto_account_contact_groups%ROWTYPE;
BEGIN
  PERFORM public.aka_agent_internal_require_staff_tenant(p_staff_id, p_organization_id);
  IF p_name IS NOT NULL AND length(btrim(p_name)) NOT BETWEEN 1 AND 255 THEN
    RAISE EXCEPTION 'invalid_data_group_name';
  END IF;
  IF p_color IS NOT NULL AND length(btrim(p_color)) NOT BETWEEN 1 AND 64 THEN
    RAISE EXCEPTION 'invalid_data_group_color';
  END IF;
  IF p_sort_order IS NOT NULL AND p_sort_order < 0 THEN
    RAISE EXCEPTION 'invalid_data_group_sort_order';
  END IF;

  UPDATE public.auto_account_contact_groups AS contact_group
  SET name = COALESCE(btrim(p_name), contact_group.name),
      color = COALESCE(btrim(p_color), contact_group.color),
      sort_order = COALESCE(p_sort_order, contact_group.sort_order),
      updated_at = now()
  WHERE contact_group.id = p_group_id
    AND contact_group.staff_id = p_staff_id
    AND contact_group.organization_id = p_organization_id
    AND contact_group.purpose = 'data_group'
    AND contact_group.is_delete = false
  RETURNING contact_group.* INTO v_group;

  IF NOT FOUND THEN RAISE EXCEPTION 'data_group_not_found'; END IF;
  RETURN to_jsonb(v_group) || jsonb_build_object(
    'active_membership_count', (
      SELECT count(*) FROM public.auto_account_contact_group_members AS member
      WHERE member.group_id = v_group.id AND member.is_delete = false
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.aka_agent_delete_data_group(
  p_staff_id bigint,
  p_organization_id bigint,
  p_group_id bigint,
  p_request_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_group public.auto_account_contact_groups%ROWTYPE;
  v_count integer := 0;
  v_result jsonb;
  v_batch public.auto_data_ingest_batches%ROWTYPE;
  v_request_hash text := md5('delete_group:' || COALESCE(p_group_id, 0)::text);
BEGIN
  PERFORM public.aka_agent_internal_require_staff_tenant(p_staff_id, p_organization_id);

  IF NULLIF(btrim(COALESCE(p_request_id, '')), '') IS NOT NULL THEN
    INSERT INTO public.auto_data_ingest_batches (
      request_id, operation, group_id, request_hash, status, staff_id, organization_id
    ) VALUES (
      btrim(p_request_id), 'delete_group', p_group_id, v_request_hash, 'processing',
      p_staff_id, p_organization_id
    )
    ON CONFLICT (staff_id, organization_id, request_id) DO NOTHING
    RETURNING * INTO v_batch;
    IF NOT FOUND THEN
      SELECT * INTO v_batch
      FROM public.auto_data_ingest_batches
      WHERE staff_id = p_staff_id AND organization_id = p_organization_id
        AND request_id = btrim(p_request_id)
      FOR UPDATE;
      IF v_batch.operation <> 'delete_group' OR v_batch.request_hash <> v_request_hash THEN
        RAISE EXCEPTION 'data_group_request_id_conflict';
      END IF;
      IF v_batch.result IS NOT NULL THEN RETURN v_batch.result; END IF;
      RAISE EXCEPTION 'data_group_request_incomplete';
    END IF;
  END IF;

  SELECT * INTO v_group
  FROM public.auto_account_contact_groups AS contact_group
  WHERE contact_group.id = p_group_id
    AND contact_group.staff_id = p_staff_id
    AND contact_group.organization_id = p_organization_id
    AND contact_group.purpose = 'data_group'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'data_group_not_found'; END IF;

  IF v_group.is_delete THEN
    v_result := jsonb_build_object(
      'success', true, 'count', 0, 'group_revision', v_group.revision
    );
  ELSE
    UPDATE public.auto_account_contact_groups
    SET is_delete = true, revision = revision + 1, updated_at = now()
    WHERE id = v_group.id
    RETURNING * INTO v_group;

    UPDATE public.auto_account_contact_group_members
    SET is_delete = true,
        change_revision = v_group.revision,
        updated_at = now()
    WHERE group_id = v_group.id AND is_delete = false;
    GET DIAGNOSTICS v_count = ROW_COUNT;

    UPDATE public.auto_account_contact_group_member_origins AS origin
    SET is_current = false, updated_at = now()
    FROM public.auto_account_contact_group_members AS member
    WHERE member.group_id = v_group.id
      AND origin.membership_id = member.id
      AND origin.is_current = true;

    UPDATE public.auto_campaign_data_group_sources
    SET status = 'stopped', stopped_at = now(), stop_reason = 'group_deleted', updated_at = now()
    WHERE group_id = v_group.id AND status IN ('baselining', 'active');

    v_result := jsonb_build_object(
      'success', true, 'count', v_count, 'group_revision', v_group.revision
    );
  END IF;

  IF v_batch.id IS NOT NULL THEN
    UPDATE public.auto_data_ingest_batches
    SET status = 'completed', result = v_result, updated_at = now()
    WHERE id = v_batch.id;
  END IF;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.aka_agent_duplicate_data_group(
  p_staff_id bigint,
  p_organization_id bigint,
  p_group_id bigint,
  p_name text DEFAULT NULL,
  p_request_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_source public.auto_account_contact_groups%ROWTYPE;
  v_target public.auto_account_contact_groups%ROWTYPE;
  v_batch public.auto_data_ingest_batches%ROWTYPE;
  v_request_hash text;
  v_member_count integer := 0;
BEGIN
  PERFORM public.aka_agent_internal_require_staff_tenant(p_staff_id, p_organization_id);
  SELECT * INTO v_source
  FROM public.auto_account_contact_groups AS contact_group
  WHERE contact_group.id = p_group_id
    AND contact_group.staff_id = p_staff_id
    AND contact_group.organization_id = p_organization_id
    AND contact_group.purpose = 'data_group'
    AND contact_group.is_delete = false
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'data_group_not_found'; END IF;
  IF p_name IS NOT NULL AND length(btrim(p_name)) NOT BETWEEN 1 AND 255 THEN
    RAISE EXCEPTION 'invalid_data_group_name';
  END IF;

  v_request_hash := md5(jsonb_build_object(
    'operation', 'duplicate_group', 'groupId', p_group_id,
    'name', COALESCE(NULLIF(btrim(COALESCE(p_name, '')), ''), v_source.name || ' (Bản sao)')
  )::text);
  IF NULLIF(btrim(COALESCE(p_request_id, '')), '') IS NOT NULL THEN
    INSERT INTO public.auto_data_ingest_batches (
      request_id, operation, group_id, request_hash, status, staff_id, organization_id
    ) VALUES (
      btrim(p_request_id), 'duplicate_group', p_group_id, v_request_hash, 'processing',
      p_staff_id, p_organization_id
    )
    ON CONFLICT (staff_id, organization_id, request_id) DO NOTHING
    RETURNING * INTO v_batch;
    IF NOT FOUND THEN
      SELECT * INTO v_batch
      FROM public.auto_data_ingest_batches
      WHERE staff_id = p_staff_id AND organization_id = p_organization_id
        AND request_id = btrim(p_request_id)
      FOR UPDATE;
      IF v_batch.operation <> 'duplicate_group' OR v_batch.request_hash <> v_request_hash THEN
        RAISE EXCEPTION 'data_group_request_id_conflict';
      END IF;
      IF v_batch.result IS NOT NULL THEN RETURN v_batch.result; END IF;
      RAISE EXCEPTION 'data_group_request_incomplete';
    END IF;
  END IF;

  INSERT INTO public.auto_account_contact_groups (
    account_id, contact_type, name, purpose, color, sort_order, revision,
    is_delete, staff_id, organization_id
  ) VALUES (
    NULL, NULL,
    COALESCE(NULLIF(btrim(COALESCE(p_name, '')), ''), v_source.name || ' (Bản sao)'),
    'data_group', v_source.color,
    COALESCE((
      SELECT max(contact_group.sort_order) + 1
      FROM public.auto_account_contact_groups AS contact_group
      WHERE contact_group.staff_id = p_staff_id
        AND contact_group.organization_id = p_organization_id
        AND contact_group.purpose = 'data_group'
        AND contact_group.is_delete = false
    ), 0),
    CASE WHEN EXISTS (
      SELECT 1 FROM public.auto_account_contact_group_members AS member
      WHERE member.group_id = v_source.id AND member.is_delete = false
    ) THEN 1 ELSE 0 END,
    false, p_staff_id, p_organization_id
  ) RETURNING * INTO v_target;

  INSERT INTO public.auto_account_contact_group_members (
    group_id, contact_id, is_delete, change_revision, created_at, updated_at
  )
  SELECT v_target.id, member.contact_id, false, v_target.revision, now(), now()
  FROM public.auto_account_contact_group_members AS member
  WHERE member.group_id = v_source.id AND member.is_delete = false;
  GET DIAGNOSTICS v_member_count = ROW_COUNT;

  INSERT INTO public.auto_account_contact_group_member_origins (
    membership_id, kind, dataset_id, batch_id, source_account_id, automation_detail_id,
    source_name_snapshot, is_current, created_at, updated_at
  )
  SELECT
    target_member.id, origin.kind, origin.dataset_id, origin.batch_id,
    origin.source_account_id, origin.automation_detail_id,
    origin.source_name_snapshot, true, now(), now()
  FROM public.auto_account_contact_group_members AS source_member
  JOIN public.auto_account_contact_group_members AS target_member
    ON target_member.group_id = v_target.id
   AND target_member.contact_id = source_member.contact_id
  JOIN public.auto_account_contact_group_member_origins AS origin
    ON origin.membership_id = source_member.id AND origin.is_current = true
  WHERE source_member.group_id = v_source.id AND source_member.is_delete = false
  ON CONFLICT DO NOTHING;

  IF v_batch.id IS NOT NULL THEN
    UPDATE public.auto_data_ingest_batches
    SET target_group_id = v_target.id,
        status = 'completed',
        result = to_jsonb(v_target) || jsonb_build_object('active_membership_count', v_member_count),
        updated_at = now()
    WHERE id = v_batch.id
    RETURNING result INTO v_batch.result;
    RETURN v_batch.result;
  END IF;
  RETURN to_jsonb(v_target) || jsonb_build_object('active_membership_count', v_member_count);
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
  total_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $$
BEGIN
  PERFORM public.aka_agent_internal_require_staff_tenant(p_staff_id, p_organization_id);
  IF COALESCE(p_status, 'all') NOT IN (
    'all', 'active', 'inactive', 'friend', 'stranger', 'joined', 'not_joined'
  )
    OR COALESCE(p_offset, 0) < 0 OR COALESCE(p_limit, 100) NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'invalid_data_group_member_query';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.auto_account_contact_groups AS contact_group
    WHERE contact_group.id = p_group_id
      AND contact_group.staff_id = p_staff_id
      AND contact_group.organization_id = p_organization_id
      AND contact_group.purpose = 'data_group'
      AND contact_group.is_delete = false
  ) THEN RAISE EXCEPTION 'data_group_not_found'; END IF;

  RETURN QUERY
  WITH filtered AS (
    SELECT
      member.id AS selected_member_id,
      member.group_id AS selected_group_id,
      member.contact_id,
      member.created_at AS member_created_at,
      member.updated_at AS member_updated_at,
      member.is_delete AS member_is_delete,
      member.change_revision,
      contact.name,
      contact.uid,
      contact.url,
      contact.phone,
      contact.email,
      contact.extra_data,
      contact.contact_type,
      contact.flatform_type,
      contact.account_id,
      contact.is_friend,
      contact.is_joined,
      account.name AS selected_account_name,
      COALESCE(account.is_delete, false) AS selected_account_deleted
    FROM public.auto_account_contact_group_members AS member
    JOIN public.auto_account_contacts AS contact ON contact.id = member.contact_id
    LEFT JOIN public.auto_accounts AS account ON account.id = contact.account_id
    WHERE member.group_id = p_group_id
      AND contact.staff_id = p_staff_id
      AND contact.organization_id = p_organization_id
      AND member.is_delete = false
      AND (
        COALESCE(p_status, 'all') = 'all'
        OR (
          COALESCE(p_status, 'all') = 'active' AND (
            (contact.contact_type = 'person' AND contact.is_friend = true)
            OR (contact.contact_type = 'group' AND contact.is_joined = true)
            OR contact.contact_type NOT IN ('person', 'group')
          )
        )
        OR (
          COALESCE(p_status, 'all') = 'inactive' AND (
            (contact.contact_type = 'person' AND contact.is_friend = false)
            OR (contact.contact_type = 'group' AND contact.is_joined = false)
          )
        )
        OR (COALESCE(p_status, 'all') = 'friend'
          AND contact.contact_type = 'person' AND contact.is_friend = true)
        OR (COALESCE(p_status, 'all') = 'stranger'
          AND contact.contact_type = 'person' AND contact.is_friend = false)
        OR (COALESCE(p_status, 'all') = 'joined'
          AND contact.contact_type = 'group' AND contact.is_joined = true)
        OR (COALESCE(p_status, 'all') = 'not_joined'
          AND contact.contact_type = 'group' AND contact.is_joined = false)
      )
      AND (
        NULLIF(btrim(COALESCE(p_search, '')), '') IS NULL
        OR contact.name ILIKE '%' || btrim(p_search) || '%'
        OR contact.uid ILIKE '%' || btrim(p_search) || '%'
        OR contact.phone ILIKE '%' || btrim(p_search) || '%'
        OR contact.email ILIKE '%' || btrim(p_search) || '%'
      )
      AND (
        p_account_ids IS NULL
        OR contact.account_id = ANY(p_account_ids)
        OR (COALESCE(p_include_accountless, true) AND contact.account_id IS NULL)
      )
      AND (COALESCE(p_include_accountless, true) OR contact.account_id IS NOT NULL)
      AND (p_contact_types IS NULL OR contact.contact_type = ANY(p_contact_types))
      AND (p_flatform_types IS NULL OR contact.flatform_type = ANY(p_flatform_types))
      AND (p_ids IS NULL OR member.id = ANY(p_ids))
      AND (p_exclude_ids IS NULL OR NOT (member.id = ANY(p_exclude_ids)))
      AND (
        p_dataset_ids IS NULL OR EXISTS (
          SELECT 1
          FROM public.auto_account_contact_group_member_origins AS dataset_origin
          WHERE dataset_origin.membership_id = member.id
            AND dataset_origin.dataset_id = ANY(p_dataset_ids)
            AND dataset_origin.is_current = true
        )
      )
  )
  SELECT
    filtered.selected_member_id,
    filtered.selected_group_id,
    filtered.contact_id,
    filtered.name,
    filtered.uid,
    filtered.url,
    filtered.phone,
    filtered.email,
    NULLIF(filtered.extra_data ->> 'info1', ''),
    NULLIF(filtered.extra_data ->> 'info2', ''),
    NULLIF(filtered.extra_data ->> 'info3', ''),
    NULLIF(filtered.extra_data ->> 'info4', ''),
    NULLIF(filtered.extra_data ->> 'info5', ''),
    filtered.contact_type,
    filtered.flatform_type,
    filtered.account_id,
    filtered.selected_account_name,
    filtered.selected_account_deleted,
    COALESCE((
      SELECT array_agg(current_dataset.id ORDER BY current_dataset.id)
      FROM (
        SELECT DISTINCT dataset.id, dataset.name
        FROM public.auto_account_contact_group_member_origins AS origin
        JOIN public.auto_account_contacts_dataset AS dataset ON dataset.id = origin.dataset_id
        WHERE origin.membership_id = filtered.selected_member_id
          AND origin.is_current = true AND dataset.is_delete = false
      ) AS current_dataset
    ), '{}'::bigint[]),
    COALESCE((
      SELECT array_agg(current_dataset.name ORDER BY current_dataset.id)
      FROM (
        SELECT DISTINCT dataset.id, dataset.name
        FROM public.auto_account_contact_group_member_origins AS origin
        JOIN public.auto_account_contacts_dataset AS dataset ON dataset.id = origin.dataset_id
        WHERE origin.membership_id = filtered.selected_member_id
          AND origin.is_current = true AND dataset.is_delete = false
      ) AS current_dataset
    ), '{}'::text[]),
    filtered.is_friend,
    filtered.is_joined,
    filtered.member_is_delete,
    filtered.change_revision,
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', origin.id,
        'membership_id', origin.membership_id,
        'kind', origin.kind,
        'dataset_id', origin.dataset_id,
        'batch_id', origin.batch_id,
        'source_account_id', origin.source_account_id,
        'source_account_name', source_account.name,
        'source_account_deleted', COALESCE(source_account.is_delete, false),
        'automation_detail_id', origin.automation_detail_id,
        'automation_id', automation_detail.automation_id,
        'automation_name', automation.name,
        'automation_detail_status', automation_detail.status,
        'source_campaign_id', automation_detail.source_campaign_id,
        'source_campaign_name', source_campaign.name,
        'target_campaign_id', automation_detail.target_campaign_id,
        'target_campaign_name', target_campaign.name,
        'source_name_snapshot', origin.source_name_snapshot,
        'is_current', origin.is_current,
        'created_at', origin.created_at,
        'updated_at', origin.updated_at
      ) ORDER BY origin.created_at, origin.id)
      FROM public.auto_account_contact_group_member_origins AS origin
      LEFT JOIN public.auto_accounts AS source_account ON source_account.id = origin.source_account_id
      LEFT JOIN public.auto_automation_detail AS automation_detail
        ON automation_detail.id = origin.automation_detail_id
      LEFT JOIN public.auto_automation AS automation
        ON automation.id = automation_detail.automation_id
      LEFT JOIN public.auto_campaigns AS source_campaign
        ON source_campaign.id = automation_detail.source_campaign_id
      LEFT JOIN public.auto_campaigns AS target_campaign
        ON target_campaign.id = automation_detail.target_campaign_id
      WHERE origin.membership_id = filtered.selected_member_id
    ), '[]'::jsonb),
    filtered.member_created_at,
    filtered.member_updated_at,
    count(*) OVER ()::bigint
  FROM filtered
  ORDER BY filtered.member_created_at DESC, filtered.selected_member_id DESC
  OFFSET COALESCE(p_offset, 0)
  LIMIT COALESCE(p_limit, 100);
END;
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
  is_delete boolean,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $$
BEGIN
  PERFORM public.aka_agent_internal_require_staff_tenant(p_staff_id, p_organization_id);
  IF NOT EXISTS (
    SELECT 1 FROM public.auto_account_contact_groups AS contact_group
    WHERE contact_group.id = p_group_id AND contact_group.staff_id = p_staff_id
      AND contact_group.organization_id = p_organization_id
      AND contact_group.purpose = 'data_group' AND contact_group.is_delete = false
  ) THEN RAISE EXCEPTION 'data_group_not_found'; END IF;

  RETURN QUERY
  SELECT
    dataset.id,
    dataset.group_id,
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
      WHERE member.group_id = p_group_id AND member.is_delete = false
        AND origin.dataset_id = dataset.id AND origin.is_current = true
    ),
    dataset.is_delete,
    dataset.created_at,
    dataset.updated_at
  FROM public.auto_account_contacts_dataset AS dataset
  LEFT JOIN public.auto_accounts AS account ON account.id = dataset.account_id
  WHERE dataset.staff_id = p_staff_id
    AND dataset.organization_id = p_organization_id
    AND dataset.is_delete = false
    AND (
      dataset.group_id = p_group_id
      OR EXISTS (
        SELECT 1
        FROM public.auto_account_contact_group_member_origins AS origin
        JOIN public.auto_account_contact_group_members AS member
          ON member.id = origin.membership_id
        WHERE member.group_id = p_group_id AND origin.dataset_id = dataset.id
      )
    )
  ORDER BY dataset.updated_at DESC, dataset.id DESC;
END;
$$;

-- One-row refresh payload for the Data Group UI.  Batch result counts are the
-- durable values returned by the ingest transaction; source counts describe
-- the current fan-out state and are intentionally calculated at read time.
CREATE OR REPLACE FUNCTION public.aka_agent_get_data_group_latest_ingest_stats(
  p_staff_id bigint,
  p_organization_id bigint,
  p_group_id bigint
)
RETURNS TABLE (
  group_id bigint,
  group_revision bigint,
  active_membership_count bigint,
  unique_compatible_target_count bigint,
  campaign_input_count bigint,
  latest_batch_id bigint,
  latest_request_id text,
  latest_kind text,
  latest_source_name text,
  latest_batch_status text,
  latest_result jsonb,
  inserted_membership_count bigint,
  reactivated_membership_count bigint,
  already_member_count bigint,
  removed_membership_count bigint,
  inserted_input_count bigint,
  already_seen_input_count bigint,
  incompatible_count bigint,
  conflict_count bigint,
  invalid_count bigint,
  baselining_source_count bigint,
  active_source_count bigint,
  stopped_source_count bigint,
  latest_batch_created_at timestamptz,
  latest_batch_updated_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public
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
    contact_group.id,
    contact_group.revision,
    (
      SELECT count(*)::bigint
      FROM public.auto_account_contact_group_members AS member
      WHERE member.group_id = contact_group.id AND member.is_delete = false
    ),
    COALESCE(group_input_counts.unique_compatible_target_count, 0),
    COALESCE(group_input_counts.campaign_input_count, 0),
    latest_batch.id,
    latest_batch.request_id,
    latest_batch.kind,
    latest_batch.source_name,
    latest_batch.status,
    latest_batch.result,
    COALESCE((latest_batch.result ->> 'inserted_membership_count')::bigint, 0),
    COALESCE((latest_batch.result ->> 'reactivated_membership_count')::bigint, 0),
    COALESCE((latest_batch.result ->> 'already_member_count')::bigint, 0),
    COALESCE((latest_batch.result ->> 'removed_membership_count')::bigint, 0),
    COALESCE((latest_batch.result ->> 'inserted_input_count')::bigint, 0),
    COALESCE((latest_batch.result ->> 'already_seen_input_count')::bigint, 0),
    COALESCE((latest_batch.result ->> 'incompatible_count')::bigint, 0),
    COALESCE((latest_batch.result ->> 'conflict_count')::bigint, 0),
    COALESCE((latest_batch.result ->> 'invalid_count')::bigint, 0),
    COALESCE(source_counts.baselining_count, 0),
    COALESCE(source_counts.active_count, 0),
    COALESCE(source_counts.stopped_count, 0),
    latest_batch.created_at,
    latest_batch.updated_at
  FROM public.auto_account_contact_groups AS contact_group
  LEFT JOIN LATERAL (
    SELECT
      count(DISTINCT input_origin.canonical_target_key)
        FILTER (WHERE member.is_delete = false)::bigint
        AS unique_compatible_target_count,
      count(DISTINCT input_origin.input_data_id)::bigint AS campaign_input_count
    FROM public.auto_campaign_input_origins AS input_origin
    LEFT JOIN public.auto_account_contact_group_members AS member
      ON member.id = input_origin.membership_id
    WHERE input_origin.group_id = contact_group.id
      AND input_origin.origin_kind = 'group'
  ) AS group_input_counts ON true
  LEFT JOIN LATERAL (
    SELECT batch.*
    FROM public.auto_data_ingest_batches AS batch
    WHERE batch.group_id = contact_group.id
      AND batch.staff_id = p_staff_id
      AND batch.organization_id = p_organization_id
      AND batch.operation = 'ingest'
    ORDER BY batch.created_at DESC, batch.id DESC
    LIMIT 1
  ) AS latest_batch ON true
  LEFT JOIN LATERAL (
    SELECT
      count(*) FILTER (WHERE source.status = 'baselining')::bigint AS baselining_count,
      count(*) FILTER (WHERE source.status = 'active')::bigint AS active_count,
      count(*) FILTER (WHERE source.status = 'stopped')::bigint AS stopped_count
    FROM public.auto_campaign_data_group_sources AS source
    WHERE source.group_id = contact_group.id
      AND source.staff_id = p_staff_id
      AND source.organization_id = p_organization_id
  ) AS source_counts ON true
  WHERE contact_group.id = p_group_id
    AND contact_group.staff_id = p_staff_id
    AND contact_group.organization_id = p_organization_id
    AND contact_group.purpose = 'data_group'
    AND contact_group.is_delete = false;
END;
$$;

-- Project and insert one membership into one bound campaign.  This is the only
-- routine that knows the routing matrix; baseline, ingest, move, reactivation,
-- and automation all share it.
CREATE OR REPLACE FUNCTION public.aka_agent_internal_route_data_group_member(
  p_source_id bigint,
  p_membership_id bigint,
  p_batch_id bigint,
  p_group_revision bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_source public.auto_campaign_data_group_sources%ROWTYPE;
  v_campaign public.auto_campaigns%ROWTYPE;
  v_member public.auto_account_contact_group_members%ROWTYPE;
  v_contact public.auto_account_contacts%ROWTYPE;
  v_account public.auto_accounts%ROWTYPE;
  v_action text;
  v_platform text;
  v_contact_type text;
  v_name text;
  v_uid text;
  v_url text;
  v_phone text;
  v_email text;
  v_input_uid text;
  v_input_phone text;
  v_input_email text;
  v_target_value text;
  v_identity_value text;
  v_uid_identity text;
  v_url_identity text;
  v_allow_alias_resolution boolean := false;
  v_target_kind text;
  v_scope text;
  v_candidate_key text;
  v_canonical_key text;
  v_aliases text[] := '{}'::text[];
  v_mapped_keys text[] := '{}'::text[];
  v_payload jsonb;
  v_input_id bigint;
  v_inserted boolean := false;
  v_info1 text;
  v_info2 text;
  v_info3 text;
  v_info4 text;
  v_info5 text;
  v_phone_carrier text;
BEGIN
  SELECT * INTO v_source
  FROM public.auto_campaign_data_group_sources AS source
  WHERE source.id = p_source_id;
  IF NOT FOUND OR v_source.status NOT IN ('baselining', 'active') THEN
    RETURN jsonb_build_object('status', 'no_intake', 'reason', 'source_stopped');
  END IF;

  SELECT * INTO v_campaign
  FROM public.auto_campaigns AS campaign
  WHERE campaign.id = v_source.campaign_id
  FOR UPDATE;
  IF FOUND AND v_campaign.data_target_source_mode = 'data_group'
    AND (
      COALESCE(v_campaign.is_delete, false)
      OR (v_campaign.schedule_end_date IS NOT NULL AND v_campaign.schedule_end_date <= now())
    )
  THEN
    EXECUTE 'SELECT public.aka_agent_finalize_data_group_campaign($1, $2, $3, $4)'
    USING v_source.staff_id, v_source.organization_id, v_campaign.id,
      CASE WHEN COALESCE(v_campaign.is_delete, false)
        THEN 'Chiến dịch đã bị xoá' ELSE 'Chiến dịch đã hết hạn' END;
    RETURN jsonb_build_object('status', 'no_intake', 'reason', 'campaign_hard_ended');
  END IF;
  IF NOT FOUND
    OR v_campaign.staff_id IS DISTINCT FROM v_source.staff_id
    OR v_campaign.organization_id IS DISTINCT FROM v_source.organization_id
    OR COALESCE(v_campaign.is_delete, false)
    OR v_campaign.data_target_source_mode <> 'data_group'
    OR v_campaign.data_group_id IS DISTINCT FROM v_source.group_id
    OR v_campaign.status NOT IN ('chờ xử lý', 'tạm dừng', 'đang chạy')
    OR (v_campaign.schedule_end_date IS NOT NULL AND v_campaign.schedule_end_date <= now())
  THEN
    RETURN jsonb_build_object('status', 'no_intake', 'reason', 'campaign_terminal');
  END IF;

  SELECT * INTO v_member
  FROM public.auto_account_contact_group_members AS member
  WHERE member.id = p_membership_id
    AND member.group_id = v_source.group_id
    AND member.is_delete = false;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'no_intake', 'reason', 'membership_inactive');
  END IF;

  SELECT * INTO v_contact
  FROM public.auto_account_contacts AS contact
  WHERE contact.id = v_member.contact_id
    AND contact.staff_id = v_source.staff_id
    AND contact.organization_id = v_source.organization_id
    AND COALESCE(contact.is_delete, false) = false;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'incompatible', 'reason', 'contact_inactive');
  END IF;

  SELECT * INTO v_account
  FROM public.auto_accounts AS account
  WHERE account.id = v_campaign.account_id
    AND account.staff_id = v_source.staff_id
    AND (account.organization_id IS NULL OR account.organization_id = v_source.organization_id)
    AND COALESCE(account.is_delete, false) = false;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'no_intake', 'reason', 'campaign_account_inactive');
  END IF;

  v_action := btrim(COALESCE(v_campaign.action_id, ''));
  v_platform := lower(btrim(COALESCE(v_contact.flatform_type, '')));
  v_contact_type := lower(btrim(COALESCE(v_contact.contact_type, '')));
  v_name := NULLIF(btrim(COALESCE(v_contact.name, '')), '');
  v_uid := NULLIF(btrim(COALESCE(v_contact.uid, '')), '');
  v_url := NULLIF(btrim(COALESCE(v_contact.url, '')), '');
  v_phone := public.aka_agent_internal_normalize_phone(COALESCE(
    NULLIF(v_contact.phone, ''), NULLIF(v_contact.extra_data ->> 'phone', ''),
    CASE WHEN v_contact_type = 'phone' THEN v_contact.uid ELSE NULL END, ''
  ));
  v_phone := NULLIF(v_phone, '');
  v_email := NULLIF(lower(btrim(COALESCE(
    NULLIF(v_contact.email, ''), NULLIF(v_contact.extra_data ->> 'email', ''),
    CASE WHEN v_contact_type = 'email' THEN v_contact.uid ELSE NULL END, ''
  ))), '');
  IF v_email IS NOT NULL AND (v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      OR length(v_email) > 254) THEN
    v_email := NULL;
  END IF;
  v_info1 := NULLIF(v_contact.extra_data ->> 'info1', '');
  v_info2 := NULLIF(v_contact.extra_data ->> 'info2', '');
  v_info3 := NULLIF(v_contact.extra_data ->> 'info3', '');
  v_info4 := NULLIF(v_contact.extra_data ->> 'info4', '');
  v_info5 := NULLIF(v_contact.extra_data ->> 'info5', '');
  v_phone_carrier := COALESCE(
    NULLIF(v_contact.extra_data ->> 'phoneCarrier', ''),
    NULLIF(v_contact.extra_data ->> 'phone_carrier', '')
  );

  -- Portable Facebook routes.
  IF v_action IN ('facebook_group_post', 'facebook_join_group', 'facebook_find_data_group') THEN
    IF v_platform <> 'facebook' OR v_contact_type <> 'group' THEN
      RETURN jsonb_build_object('status', 'incompatible', 'reason', 'facebook_group_required');
    END IF;
    v_target_value := COALESCE(v_url, v_uid);
    v_target_kind := 'facebook_group';
    v_scope := 'portable';
    v_input_uid := v_target_value;
  ELSIF v_action = 'facebook_message_uid' THEN
    IF v_platform <> 'facebook' OR v_contact_type <> 'person' THEN
      RETURN jsonb_build_object('status', 'incompatible', 'reason', 'facebook_person_required');
    END IF;
    v_target_value := COALESCE(v_url, v_uid);
    v_target_kind := 'facebook_person';
    v_scope := 'portable';
    v_input_uid := v_target_value;
  ELSIF v_action = 'facebook_find_data_search' THEN
    IF v_platform <> 'facebook' OR v_contact_type <> 'campaign_input' THEN
      RETURN jsonb_build_object('status', 'incompatible', 'reason', 'facebook_search_input_required');
    END IF;
    v_target_value := v_uid;
    v_target_kind := 'facebook_search';
    v_scope := 'portable';
    v_input_uid := v_target_value;
  ELSIF v_action IN ('facebook_comment_seeding', 'facebook_comment_seeding_post') THEN
    IF v_platform <> 'facebook'
      OR (
        v_action = 'facebook_comment_seeding'
        AND v_contact_type NOT IN ('group', 'page', 'person', 'campaign_input')
      )
      OR (
        v_action = 'facebook_comment_seeding_post'
        AND v_contact_type <> 'campaign_input'
      )
    THEN
      RETURN jsonb_build_object('status', 'incompatible', 'reason',
        CASE WHEN v_action = 'facebook_comment_seeding_post'
          THEN 'facebook_post_target_required'
          ELSE 'facebook_comment_target_required'
        END
      );
    END IF;
    v_target_value := COALESCE(v_url, v_uid);
    v_target_kind := CASE WHEN v_action = 'facebook_comment_seeding_post'
      THEN 'facebook_post' ELSE 'facebook_comment_target' END;
    v_scope := 'portable';
    v_input_uid := v_target_value;
  ELSIF v_action = 'zalo_message_phone' THEN
    IF v_phone IS NULL THEN
      RETURN jsonb_build_object('status', 'incompatible', 'reason', 'valid_phone_required');
    END IF;
    v_target_value := v_phone;
    v_target_kind := 'phone';
    v_scope := 'portable';
    v_input_phone := v_target_value;
  ELSIF v_action = 'zalo_join_group_link' THEN
    IF v_platform <> 'zalo' OR v_contact_type <> 'group' THEN
      RETURN jsonb_build_object('status', 'incompatible', 'reason', 'zalo_group_required');
    END IF;
    v_target_value := COALESCE(v_url, v_uid);
    v_target_kind := 'zalo_group_link';
    v_scope := 'portable';
    v_input_uid := v_target_value;
  ELSIF v_action = 'email_send' THEN
    IF v_email IS NULL THEN
      RETURN jsonb_build_object('status', 'incompatible', 'reason', 'valid_email_required');
    END IF;
    v_target_value := v_email;
    v_target_kind := 'email';
    v_scope := 'portable';
    v_input_email := v_target_value;

  -- Account-bound routes.
  ELSIF v_action IN ('facebook_message_friend', 'facebook_group_invite') THEN
    IF v_platform <> 'facebook' OR v_contact_type <> 'person'
      OR v_contact.account_id IS DISTINCT FROM v_campaign.account_id
      OR v_contact.is_friend IS DISTINCT FROM true THEN
      RETURN jsonb_build_object('status', 'incompatible', 'reason', 'bound_facebook_friend_required');
    END IF;
    v_target_value := COALESCE(v_url, v_uid);
    v_target_kind := 'facebook_person';
    v_scope := 'bound:' || v_campaign.account_id::text;
    v_input_uid := v_target_value;
  ELSIF v_action = 'facebook_page_post' THEN
    IF v_platform <> 'facebook' OR v_contact_type <> 'page'
      OR v_contact.account_id IS DISTINCT FROM v_campaign.account_id THEN
      RETURN jsonb_build_object('status', 'incompatible', 'reason', 'bound_facebook_page_required');
    END IF;
    -- Page-post workflows consume the Page ID.  Keep URL only as a legacy
    -- fallback when an older contact row has no UID.
    v_target_value := COALESCE(v_uid, v_url);
    v_target_kind := 'facebook_page';
    v_scope := 'bound:' || v_campaign.account_id::text;
    v_input_uid := v_target_value;
  ELSIF v_action IN (
    'zalo_message_friend', 'zalo_message_group_member',
    'zalo_message_remarketing_customer'
  ) THEN
    IF v_platform <> 'zalo' OR v_contact_type <> 'person'
      OR v_contact.account_id IS DISTINCT FROM v_campaign.account_id THEN
      RETURN jsonb_build_object('status', 'incompatible', 'reason', 'bound_zalo_person_required');
    END IF;
    IF v_action = 'zalo_message_friend' AND v_contact.is_friend IS DISTINCT FROM true THEN
      RETURN jsonb_build_object('status', 'incompatible', 'reason', 'bound_zalo_friend_required');
    END IF;
    v_target_value := v_uid;
    v_target_kind := 'zalo_person';
    v_scope := 'bound:' || v_campaign.account_id::text;
    v_input_uid := v_target_value;
  ELSIF v_action = 'zalo_message_group' THEN
    IF v_platform <> 'zalo' OR v_contact_type <> 'group'
      OR v_contact.account_id IS DISTINCT FROM v_campaign.account_id
      OR v_contact.is_joined IS DISTINCT FROM true THEN
      RETURN jsonb_build_object('status', 'incompatible', 'reason', 'bound_joined_zalo_group_required');
    END IF;
    v_target_value := v_uid;
    v_target_kind := 'zalo_group';
    v_scope := 'bound:' || v_campaign.account_id::text;
    v_input_uid := v_target_value;

  -- Hybrid: a valid phone is portable and must force uid=''; UID-only remains
  -- account-bound so one account's Zalo identity is never used by another.
  ELSIF v_action = 'zalo_add_group_member' THEN
    IF v_phone IS NOT NULL THEN
      v_target_value := v_phone;
      v_target_kind := 'phone';
      v_scope := 'portable';
      v_input_phone := v_phone;
      v_input_uid := '';
    ELSIF v_platform = 'zalo' AND v_contact_type = 'person'
      AND v_uid IS NOT NULL
      AND v_contact.account_id IS NOT DISTINCT FROM v_campaign.account_id THEN
      v_target_value := v_uid;
      v_target_kind := 'zalo_person';
      v_scope := 'bound:' || v_campaign.account_id::text;
      v_input_uid := v_uid;
    ELSE
      RETURN jsonb_build_object('status', 'incompatible', 'reason', 'hybrid_target_not_routable');
    END IF;
  ELSE
    -- Includes SMS, voice, Zalo realtime, cancel-request and every future action
    -- until its delivery contract is explicitly added here.
    RETURN jsonb_build_object('status', 'incompatible', 'reason', 'unsupported_action');
  END IF;

  IF NULLIF(v_target_value, '') IS NULL THEN
    RETURN jsonb_build_object('status', 'incompatible', 'reason', 'target_value_missing');
  END IF;

  -- Canonicalization is action-aware.  Phone/email routes intentionally carry
  -- no unrelated UID/URL aliases; doing so could merge two different people
  -- merely because an imported row happened to contain extra columns.
  IF v_target_kind LIKE 'facebook_%' THEN
    v_uid_identity := CASE WHEN v_uid IS NULL THEN NULL
      ELSE NULLIF(public.aka_agent_internal_normalize_facebook_identity(v_uid), '') END;
    v_url_identity := CASE WHEN v_url IS NULL THEN NULL
      ELSE NULLIF(public.aka_agent_internal_normalize_facebook_identity(v_url), '') END;
    v_identity_value := COALESCE(
      v_uid_identity,
      v_url_identity,
      NULLIF(public.aka_agent_internal_normalize_facebook_identity(v_target_value), '')
    );
    -- UID and URL stored on the same Facebook contact are explicit aliases for
    -- that row. Canonical identity prefers UID while input.uid keeps the raw
    -- URL/value required by the runtime.
    v_allow_alias_resolution := true;
  ELSIF v_target_kind = 'email' THEN
    v_identity_value := lower(v_target_value);
  ELSE
    v_identity_value := v_target_value;
  END IF;
  IF NULLIF(v_identity_value, '') IS NULL THEN
    RETURN jsonb_build_object('status', 'incompatible', 'reason', 'canonical_identity_missing');
  END IF;
  v_candidate_key := v_scope || ':' || v_target_kind || ':' || v_identity_value;
  v_aliases := array_append(v_aliases, v_candidate_key);
  IF v_target_kind LIKE 'facebook_%' AND v_uid_identity IS NOT NULL THEN
    v_aliases := array_append(
      v_aliases, v_scope || ':' || v_target_kind || ':' || v_uid_identity
    );
  END IF;
  IF v_target_kind LIKE 'facebook_%' AND v_url_identity IS NOT NULL THEN
    v_aliases := array_append(
      v_aliases, v_scope || ':' || v_target_kind || ':' || v_url_identity
    );
  END IF;
  SELECT COALESCE(array_agg(DISTINCT alias.canonical_target_key), '{}'::text[])
  INTO v_mapped_keys
  FROM public.auto_campaign_input_target_aliases AS alias
  WHERE alias.campaign_id = v_campaign.id AND alias.alias_key = ANY(v_aliases);

  IF cardinality(v_mapped_keys) > 1
    OR (
      cardinality(v_mapped_keys) = 1
      AND NOT v_allow_alias_resolution
      AND v_mapped_keys[1] IS DISTINCT FROM v_candidate_key
    )
  THEN
    UPDATE public.auto_campaign_input_target_aliases AS alias
    SET conflict_count = alias.conflict_count + 1,
        last_conflict_at = now(),
        last_conflict_payload = jsonb_build_object(
          'membershipId', v_member.id,
          'candidateCanonicalKey', v_candidate_key,
          'mappedCanonicalKeys', to_jsonb(v_mapped_keys),
          'aliases', to_jsonb(v_aliases)
        ),
        updated_at = now()
    WHERE alias.campaign_id = v_campaign.id AND alias.alias_key = ANY(v_aliases);
    RETURN jsonb_build_object(
      'status', 'conflict', 'reason', 'canonical_alias_conflict',
      'aliases', to_jsonb(v_aliases), 'canonicalKeys', to_jsonb(v_mapped_keys)
    );
  END IF;
  -- One established Facebook alias may resolve a UID-only or URL-only row.
  -- All other actions require exact candidate agreement.
  v_canonical_key := CASE
    WHEN v_allow_alias_resolution AND cardinality(v_mapped_keys) = 1
      THEN v_mapped_keys[1]
    ELSE v_candidate_key
  END;

  v_payload := jsonb_strip_nulls(jsonb_build_object(
    'name', COALESCE(v_name, v_target_value),
    'phone', v_input_phone,
    'phone_carrier', v_phone_carrier,
    'uid', v_input_uid,
    'email', v_input_email,
    'info1', v_info1, 'info2', v_info2, 'info3', v_info3,
    'info4', v_info4, 'info5', v_info5,
    'contact_id', v_contact.id,
    'membership_id', v_member.id,
    'source_account_id', v_contact.account_id,
    'contact_type', v_contact.contact_type,
    'flatform_type', v_contact.flatform_type,
    'canonical_target_key', v_canonical_key
  ));

  INSERT INTO public.auto_campaign_input_data (
    campaign_id, input_id, name, phone, phone_carrier, uid, email,
    info1, info2, info3, info4, info5, status, schedule, is_delete,
    canonical_target_key, created_at
  ) VALUES (
    v_campaign.id, NULL, COALESCE(v_name, v_target_value),
    v_input_phone, v_phone_carrier, v_input_uid, v_input_email,
    v_info1, v_info2, v_info3, v_info4, v_info5,
    'chờ xử lý', COALESCE(v_campaign.schedule, now()), false,
    v_canonical_key, now()
  )
  ON CONFLICT (campaign_id, canonical_target_key)
    WHERE canonical_target_key IS NOT NULL AND COALESCE(is_delete, false) = false
  DO NOTHING
  RETURNING id INTO v_input_id;

  IF v_input_id IS NULL THEN
    SELECT input_data.id INTO v_input_id
    FROM public.auto_campaign_input_data AS input_data
    WHERE input_data.campaign_id = v_campaign.id
      AND input_data.canonical_target_key = v_canonical_key
      AND COALESCE(input_data.is_delete, false) = false
    FOR UPDATE;
  ELSE
    v_inserted := true;
  END IF;

  INSERT INTO public.auto_campaign_input_target_aliases (
    campaign_id, alias_key, canonical_target_key, input_data_id
  )
  SELECT v_campaign.id, candidate.alias_key, v_canonical_key, v_input_id
  FROM (SELECT DISTINCT unnest(v_aliases) AS alias_key) AS candidate
  ON CONFLICT (campaign_id, alias_key) DO UPDATE
  SET input_data_id = EXCLUDED.input_data_id,
      updated_at = now()
  WHERE auto_campaign_input_target_aliases.canonical_target_key = EXCLUDED.canonical_target_key;

  INSERT INTO public.auto_campaign_input_origins (
    input_data_id, source_id, group_id, membership_id, batch_id,
    group_revision, canonical_target_key, payload_snapshot
  ) VALUES (
    v_input_id, v_source.id, v_source.group_id, v_member.id, p_batch_id,
    p_group_revision, v_canonical_key, v_payload
  ) ON CONFLICT DO NOTHING;

  UPDATE public.auto_campaign_data_group_sources
  SET last_ingest_at = now(), updated_at = now()
  WHERE id = v_source.id;

  UPDATE public.auto_campaigns
  SET note = NULL, updated_at = now()
  WHERE id = v_campaign.id
    AND note IN ('Chờ data phù hợp', 'Chờ data mới');

  RETURN jsonb_build_object(
    'status', CASE WHEN v_inserted THEN 'inserted' ELSE 'existing' END,
    'inputDataId', v_input_id,
    'canonicalTargetKey', v_canonical_key
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.aka_agent_internal_route_group_snapshot(
  p_source_id bigint,
  p_batch_id bigint,
  p_group_revision bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_member_id bigint;
  v_outcome jsonb;
  v_inserted integer := 0;
  v_existing integer := 0;
  v_incompatible integer := 0;
  v_conflict integer := 0;
BEGIN
  FOR v_member_id IN
    SELECT member.id
    FROM public.auto_campaign_data_group_sources AS source
    JOIN public.auto_account_contact_group_members AS member ON member.group_id = source.group_id
    WHERE source.id = p_source_id AND member.is_delete = false
    ORDER BY member.id
  LOOP
    v_outcome := public.aka_agent_internal_route_data_group_member(
      p_source_id, v_member_id, p_batch_id, p_group_revision
    );
    CASE v_outcome ->> 'status'
      WHEN 'inserted' THEN v_inserted := v_inserted + 1;
      WHEN 'existing' THEN v_existing := v_existing + 1;
      WHEN 'incompatible' THEN v_incompatible := v_incompatible + 1;
      WHEN 'conflict' THEN v_conflict := v_conflict + 1;
      ELSE NULL;
    END CASE;
  END LOOP;
  RETURN jsonb_build_object(
    'inserted_input_count', v_inserted,
    'already_seen_input_count', v_existing,
    'incompatible_count', v_incompatible,
    'conflict_count', v_conflict
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.aka_agent_ingest_data_group(
  p_staff_id bigint,
  p_organization_id bigint,
  p_request_id text,
  p_group_id bigint,
  p_kind text,
  p_rows jsonb,
  p_dataset_id bigint DEFAULT NULL,
  p_dataset_name text DEFAULT NULL,
  p_import_source text DEFAULT NULL,
  p_source_account_id bigint DEFAULT NULL,
  p_source_name text DEFAULT NULL,
  p_payload_hash text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_group public.auto_account_contact_groups%ROWTYPE;
  v_batch public.auto_data_ingest_batches%ROWTYPE;
  v_dataset public.auto_account_contacts_dataset%ROWTYPE;
  v_source_account public.auto_accounts%ROWTYPE;
  v_contact public.auto_account_contacts%ROWTYPE;
  v_member public.auto_account_contact_group_members%ROWTYPE;
  v_row record;
  v_source record;
  v_raw_account_id text;
  v_raw_contact_id text;
  v_raw_automation_detail_id text;
  v_origin_automation_detail_id bigint;
  v_row_account_id bigint;
  v_contact_type text;
  v_platform text;
  v_name text;
  v_uid text;
  v_url text;
  v_phone text;
  v_email text;
  v_extra jsonb;
  v_dataset_contact_type text;
  v_dataset_platform text;
  v_dataset_source_key text;
  v_dataset_display_name text;
  v_duplicate_in_batch boolean := false;
  v_duplicate_conflict boolean := false;
  v_member_found boolean := false;
  v_batch_seen jsonb := '{}'::jsonb;
  v_first_payload jsonb;
  v_current_payload jsonb;
  v_request_hash text;
  v_revision bigint;
  v_revision_started boolean := false;
  v_inserted_members integer := 0;
  v_reactivated_members integer := 0;
  v_existing_members integer := 0;
  v_removed_members integer := 0;
  v_inserted_inputs integer := 0;
  v_existing_inputs integer := 0;
  v_incompatible integer := 0;
  v_conflict integer := 0;
  v_invalid integer := 0;
  v_conflicts jsonb := '[]'::jsonb;
  v_outcome jsonb;
  v_result jsonb;
BEGIN
  PERFORM public.aka_agent_internal_require_staff_tenant(p_staff_id, p_organization_id);
  IF NULLIF(btrim(COALESCE(p_request_id, '')), '') IS NULL
    OR length(btrim(p_request_id)) > 500
    OR p_kind NOT IN ('manual', 'upload', 'scan', 'automation', 'api')
    OR jsonb_typeof(COALESCE(p_rows, 'null'::jsonb)) <> 'array'
    OR jsonb_array_length(p_rows) > 10000
    OR (p_import_source IS NOT NULL AND p_import_source NOT IN ('textbox', 'image', 'sheet', 'excel'))
  THEN
    RAISE EXCEPTION 'invalid_data_group_ingest_payload';
  END IF;

  SELECT * INTO v_group
  FROM public.auto_account_contact_groups AS contact_group
  WHERE contact_group.id = p_group_id
    AND contact_group.staff_id = p_staff_id
    AND contact_group.organization_id = p_organization_id
    AND contact_group.purpose = 'data_group'
    AND contact_group.is_delete = false
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'data_group_not_found'; END IF;

  IF p_source_account_id IS NOT NULL THEN
    SELECT * INTO v_source_account
    FROM public.auto_accounts AS account
    WHERE account.id = p_source_account_id
      AND account.staff_id = p_staff_id
      AND (account.organization_id IS NULL OR account.organization_id = p_organization_id);
    IF NOT FOUND THEN RAISE EXCEPTION 'data_group_source_account_not_found'; END IF;
  END IF;

  v_request_hash := md5(jsonb_build_object(
    'operation', 'ingest', 'groupId', p_group_id, 'kind', p_kind,
    'rows', p_rows, 'datasetId', p_dataset_id, 'datasetName', p_dataset_name,
    'importSource', p_import_source, 'sourceAccountId', p_source_account_id,
    'sourceName', p_source_name
  )::text);

  INSERT INTO public.auto_data_ingest_batches (
    request_id, operation, group_id, kind, dataset_id, source_account_id,
    source_name, client_payload_hash, request_hash, status,
    staff_id, organization_id
  ) VALUES (
    btrim(p_request_id), 'ingest', p_group_id, p_kind, p_dataset_id,
    p_source_account_id, NULLIF(btrim(COALESCE(p_source_name, '')), ''),
    NULLIF(btrim(COALESCE(p_payload_hash, '')), ''), v_request_hash, 'processing',
    p_staff_id, p_organization_id
  )
  ON CONFLICT (staff_id, organization_id, request_id) DO NOTHING
  RETURNING * INTO v_batch;

  IF NOT FOUND THEN
    SELECT * INTO v_batch
    FROM public.auto_data_ingest_batches AS batch
    WHERE batch.staff_id = p_staff_id
      AND batch.organization_id = p_organization_id
      AND batch.request_id = btrim(p_request_id)
    FOR UPDATE;
    IF v_batch.operation <> 'ingest' OR v_batch.group_id IS DISTINCT FROM p_group_id
      OR v_batch.request_hash <> v_request_hash THEN
      RAISE EXCEPTION 'data_group_request_id_conflict';
    END IF;
    IF v_batch.result IS NOT NULL THEN RETURN v_batch.result; END IF;
    RAISE EXCEPTION 'data_group_request_incomplete';
  END IF;

  IF p_kind = 'upload' THEN
    v_dataset_display_name := COALESCE(
      NULLIF(btrim(COALESCE(p_dataset_name, '')), ''),
      NULLIF(btrim(COALESCE(p_source_name, '')), ''),
      v_group.name
    );
    IF length(v_dataset_display_name) > 255 THEN
      RAISE EXCEPTION 'invalid_data_group_dataset_name';
    END IF;
    -- The explicit dataset name is the logical identity.  When absent, the
    -- source filename/name becomes that identity. A changed physical filename
    -- therefore still refreshes the same named dataset.
    v_dataset_source_key := 'upload:'
      || lower(regexp_replace(v_dataset_display_name, '[[:space:]]+', ' ', 'g'));

    WITH row_types AS (
      SELECT DISTINCT lower(btrim(item.value ->> 'contact_type')) AS value
      FROM jsonb_array_elements(p_rows) AS item(value)
      WHERE jsonb_typeof(item.value) = 'object'
        AND lower(btrim(COALESCE(item.value ->> 'contact_type', ''))) IN (
          'person', 'group', 'page', 'page_inbox_customer', 'zalo_tag',
          'phone', 'email', 'campaign_input'
        )
    )
    SELECT CASE WHEN count(*) = 1 THEN min(value) ELSE 'campaign_input' END
    INTO v_dataset_contact_type
    FROM row_types;

    WITH row_platforms AS (
      SELECT DISTINCT lower(btrim(COALESCE(
        NULLIF(item.value ->> 'flatform_type', ''),
        v_source_account.flatform_type,
        CASE WHEN lower(btrim(item.value ->> 'contact_type')) = 'email' THEN 'email' END,
        ''
      ))) AS value
      FROM jsonb_array_elements(p_rows) AS item(value)
      WHERE jsonb_typeof(item.value) = 'object'
    ), valid_platforms AS (
      SELECT value FROM row_platforms
      WHERE value IN ('facebook', 'zalo', 'email', 'sms')
    )
    SELECT CASE WHEN count(*) = 1 THEN min(value) ELSE 'mixed' END
    INTO v_dataset_platform
    FROM valid_platforms;
  END IF;

  IF p_dataset_id IS NOT NULL THEN
    SELECT * INTO v_dataset
    FROM public.auto_account_contacts_dataset AS dataset
    WHERE dataset.id = p_dataset_id
      AND dataset.staff_id = p_staff_id
      AND dataset.organization_id = p_organization_id
      AND dataset.is_delete = false;
    IF NOT FOUND THEN RAISE EXCEPTION 'data_group_dataset_not_found'; END IF;
    IF p_kind = 'upload' AND (
      v_dataset.source <> 'upload' OR v_dataset.group_id IS DISTINCT FROM v_group.id
    ) THEN
      RAISE EXCEPTION 'data_group_upload_dataset_mismatch';
    END IF;
    IF p_kind = 'upload' THEN
      UPDATE public.auto_account_contacts_dataset_members
      SET is_current = false, updated_at = now()
      WHERE dataset_id = v_dataset.id AND is_current = true;
      UPDATE public.auto_account_contact_group_member_origins
      SET is_current = false, updated_at = now()
      WHERE dataset_id = v_dataset.id AND is_current = true;
    END IF;
  ELSIF p_kind = 'upload' THEN
    INSERT INTO public.auto_account_contacts_dataset (
      name, link, description, source, account_id, group_id, flatform_type,
      contact_type, scan_type, source_key, last_scanned_at, last_scan_status,
      extra_data, contact_count, is_delete, staff_id, organization_id
    ) VALUES (
      v_dataset_display_name,
      NULL, NULL, 'upload', p_source_account_id, v_group.id,
      COALESCE(v_dataset_platform, 'mixed'),
      COALESCE(v_dataset_contact_type, 'campaign_input'),
      'upload_data', v_dataset_source_key, now(), 'completed',
      jsonb_strip_nulls(jsonb_build_object(
        'importSource', p_import_source, 'requestId', btrim(p_request_id)
      )),
      0, false, p_staff_id, p_organization_id
    )
    ON CONFLICT (
      staff_id, organization_id, group_id, COALESCE(account_id, 0::bigint),
      flatform_type, contact_type, scan_type, lower(btrim(source_key))
    )
      WHERE is_delete = false AND source = 'upload' AND group_id IS NOT NULL
    DO UPDATE SET
      name = EXCLUDED.name,
      extra_data = COALESCE(auto_account_contacts_dataset.extra_data, '{}'::jsonb)
        || EXCLUDED.extra_data,
      updated_at = now(), last_scanned_at = now(), last_scan_status = 'completed'
    RETURNING * INTO v_dataset;

    -- Re-import refreshes one logical dataset snapshot. Historical batch and
    -- origin rows remain, but only incoming contacts are current afterward.
    UPDATE public.auto_account_contacts_dataset_members
    SET is_current = false, updated_at = now()
    WHERE dataset_id = v_dataset.id AND is_current = true;
    UPDATE public.auto_account_contact_group_member_origins
    SET is_current = false, updated_at = now()
    WHERE dataset_id = v_dataset.id AND is_current = true;

    UPDATE public.auto_data_ingest_batches
    SET dataset_id = v_dataset.id, updated_at = now()
    WHERE id = v_batch.id;
  END IF;

  FOR v_row IN
    SELECT item.value AS payload, item.ordinality::integer AS row_index
    FROM jsonb_array_elements(p_rows) WITH ORDINALITY AS item(value, ordinality)
  LOOP
    v_duplicate_in_batch := false;
    v_duplicate_conflict := false;
    v_member_found := false;
    v_origin_automation_detail_id := NULL;
    v_contact_type := NULL;
    v_platform := NULL;
    v_name := NULL;
    v_uid := NULL;
    v_url := NULL;
    v_phone := NULL;
    v_email := NULL;
    v_extra := '{}'::jsonb;
    IF jsonb_typeof(v_row.payload) <> 'object' THEN
      v_invalid := v_invalid + 1;
      CONTINUE;
    END IF;

    v_raw_account_id := NULLIF(btrim(COALESCE(v_row.payload ->> 'source_account_id', '')), '');
    IF v_raw_account_id IS NOT NULL AND v_raw_account_id !~ '^[1-9][0-9]{0,17}$' THEN
      v_invalid := v_invalid + 1;
      CONTINUE;
    END IF;
    v_row_account_id := COALESCE(
      CASE WHEN v_raw_account_id IS NULL THEN NULL ELSE v_raw_account_id::bigint END,
      p_source_account_id
    );
    v_contact := NULL;

    v_raw_contact_id := NULLIF(btrim(COALESCE(v_row.payload ->> 'contact_id', '')), '');
    IF v_raw_contact_id IS NOT NULL AND v_raw_contact_id !~ '^[1-9][0-9]{0,17}$' THEN
      v_invalid := v_invalid + 1;
      CONTINUE;
    END IF;
    IF v_raw_contact_id IS NOT NULL THEN
      SELECT * INTO v_contact
      FROM public.auto_account_contacts AS contact
      WHERE contact.id = v_raw_contact_id::bigint
        AND contact.staff_id = p_staff_id
        AND contact.organization_id = p_organization_id
      FOR UPDATE;
      IF NOT FOUND OR (
        v_row_account_id IS NOT NULL
        AND v_contact.account_id IS DISTINCT FROM v_row_account_id
      ) THEN
        v_invalid := v_invalid + 1;
        CONTINUE;
      END IF;
      v_row_account_id := COALESCE(v_row_account_id, v_contact.account_id);
      -- Selecting an existing source contact only changes group membership;
      -- it must never resurrect the source contact's own lifecycle flag.
      v_contact_type := lower(btrim(COALESCE(v_contact.contact_type, '')));
      v_platform := NULLIF(lower(btrim(COALESCE(v_contact.flatform_type, ''))), '');
      v_name := NULLIF(btrim(COALESCE(v_contact.name, '')), '');
      v_uid := NULLIF(btrim(COALESCE(v_contact.uid, '')), '');
      v_url := NULLIF(btrim(COALESCE(v_contact.url, '')), '');
      v_phone := NULLIF(public.aka_agent_internal_normalize_phone(COALESCE(
        NULLIF(v_contact.phone, ''), NULLIF(v_contact.extra_data ->> 'phone', ''),
        CASE WHEN v_contact.contact_type = 'phone' THEN v_contact.uid END, ''
      )), '');
      v_email := NULLIF(lower(btrim(COALESCE(
        NULLIF(v_contact.email, ''), NULLIF(v_contact.extra_data ->> 'email', ''),
        CASE WHEN v_contact.contact_type = 'email' THEN v_contact.uid END, ''
      ))), '');
      v_extra := COALESCE(v_contact.extra_data, '{}'::jsonb);
    ELSE
      v_contact_type := lower(btrim(COALESCE(v_row.payload ->> 'contact_type', '')));
      IF v_contact_type NOT IN (
        'person', 'group', 'page', 'page_inbox_customer', 'zalo_tag',
        'phone', 'email', 'campaign_input'
      ) THEN
        v_invalid := v_invalid + 1;
        CONTINUE;
      END IF;

      IF v_row_account_id IS NOT NULL THEN
        SELECT * INTO v_source_account
        FROM public.auto_accounts AS account
        WHERE account.id = v_row_account_id
          AND account.staff_id = p_staff_id
          AND (account.organization_id IS NULL OR account.organization_id = p_organization_id);
        IF NOT FOUND THEN
          v_invalid := v_invalid + 1;
          CONTINUE;
        END IF;
      ELSE
        v_source_account := NULL;
      END IF;

      v_platform := NULLIF(lower(btrim(COALESCE(
        NULLIF(v_row.payload ->> 'flatform_type', ''),
        v_source_account.flatform_type,
        CASE WHEN v_contact_type = 'email' THEN 'email' ELSE NULL END,
        ''
      ))), '');
      -- Accountless phone/email rows are deliberately platform-neutral.  A
      -- campaign decides portability from the validated value, not this label.
      IF (v_platform IS NULL AND v_contact_type NOT IN ('phone', 'email'))
        OR (v_platform IS NOT NULL AND v_platform NOT IN ('facebook', 'zalo', 'email', 'sms'))
      THEN
        v_invalid := v_invalid + 1;
        CONTINUE;
      END IF;

      v_phone := public.aka_agent_internal_normalize_phone(COALESCE(
        NULLIF(v_row.payload ->> 'phone', ''),
        CASE WHEN v_contact_type = 'phone' THEN v_row.payload ->> 'uid' ELSE NULL END,
        ''
      ));
      v_phone := NULLIF(v_phone, '');
      v_email := NULLIF(lower(btrim(COALESCE(
        NULLIF(v_row.payload ->> 'email', ''),
        CASE WHEN v_contact_type = 'email' THEN v_row.payload ->> 'uid' ELSE NULL END,
        ''
      ))), '');
      IF v_email IS NOT NULL AND (v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
          OR length(v_email) > 254) THEN
        v_email := NULL;
      END IF;
      v_url := NULLIF(btrim(COALESCE(v_row.payload ->> 'url', '')), '');
      v_uid := CASE v_contact_type
        WHEN 'phone' THEN v_phone
        WHEN 'email' THEN v_email
        ELSE COALESCE(
          NULLIF(btrim(COALESCE(v_row.payload ->> 'uid', '')), ''),
          v_url
        )
      END;
      IF v_uid IS NULL THEN
        v_invalid := v_invalid + 1;
        CONTINUE;
      END IF;
      v_name := COALESCE(NULLIF(btrim(COALESCE(v_row.payload ->> 'name', '')), ''), v_uid);
      v_extra := COALESCE(v_row.payload -> 'extra_data', '{}'::jsonb);
      IF jsonb_typeof(v_extra) <> 'object' THEN
        v_invalid := v_invalid + 1;
        CONTINUE;
      END IF;
      v_extra := v_extra || jsonb_strip_nulls(jsonb_build_object(
        'phone', v_phone,
        'email', v_email,
        'info1', NULLIF(v_row.payload ->> 'info1', ''),
        'info2', NULLIF(v_row.payload ->> 'info2', ''),
        'info3', NULLIF(v_row.payload ->> 'info3', ''),
        'info4', NULLIF(v_row.payload ->> 'info4', ''),
        'info5', NULLIF(v_row.payload ->> 'info5', '')
      ));

      IF v_row_account_id IS NULL THEN
        -- Accountless identity is intentionally NOT global. Reuse is allowed
        -- only inside the explicitly supplied dataset; otherwise each row gets
        -- its own canonical contact and campaign delivery dedupe happens later.
        IF v_dataset.id IS NOT NULL THEN
          SELECT contact.* INTO v_contact
          FROM public.auto_account_contacts_dataset_members AS dataset_member
          JOIN public.auto_account_contacts AS contact ON contact.id = dataset_member.contact_id
          WHERE dataset_member.dataset_id = v_dataset.id
            AND contact.account_id IS NULL
            AND contact.staff_id = p_staff_id
            AND contact.organization_id = p_organization_id
            AND contact.flatform_type IS NOT DISTINCT FROM v_platform
            AND contact.contact_type = v_contact_type
            AND contact.uid = v_uid
          ORDER BY dataset_member.created_at, contact.id
          LIMIT 1
          FOR UPDATE OF contact;
        END IF;
        IF v_contact.id IS NULL THEN
          INSERT INTO public.auto_account_contacts (
            account_id, flatform_type, contact_type, name, uid, url, phone, email,
            extra_data, is_delete, staff_id, organization_id, updated_at
          ) VALUES (
            NULL, v_platform, v_contact_type, v_name, v_uid, v_url, v_phone, v_email,
            v_extra, false, p_staff_id, p_organization_id, now()
          ) RETURNING * INTO v_contact;
        ELSE
          UPDATE public.auto_account_contacts AS contact
          SET name = CASE
                WHEN NULLIF(btrim(contact.name), '') IS NULL OR contact.name = contact.uid
                  THEN v_name ELSE contact.name END,
              url = COALESCE(contact.url, v_url),
              phone = COALESCE(contact.phone, v_phone),
              email = COALESCE(contact.email, v_email),
              -- Existing/earlier values win; this only fills absent keys.
              extra_data = v_extra || COALESCE(contact.extra_data, '{}'::jsonb),
              is_delete = false, updated_at = now()
          WHERE contact.id = v_contact.id
          RETURNING * INTO v_contact;
        END IF;
      ELSE
        INSERT INTO public.auto_account_contacts AS existing_contact (
          account_id, flatform_type, contact_type, name, uid, url, phone, email,
          extra_data, is_delete, staff_id, organization_id, updated_at
        ) VALUES (
          v_row_account_id, v_platform, v_contact_type, v_name, v_uid, v_url, v_phone, v_email,
          v_extra, false, p_staff_id, p_organization_id, now()
        )
        ON CONFLICT (account_id, contact_type, uid) DO UPDATE SET
          flatform_type = COALESCE(existing_contact.flatform_type, EXCLUDED.flatform_type),
          name = CASE
            WHEN NULLIF(btrim(existing_contact.name), '') IS NULL
              OR existing_contact.name = existing_contact.uid THEN EXCLUDED.name
            ELSE existing_contact.name END,
          url = COALESCE(existing_contact.url, EXCLUDED.url),
          phone = COALESCE(existing_contact.phone, EXCLUDED.phone),
          email = COALESCE(existing_contact.email, EXCLUDED.email),
          -- First persisted value wins; later duplicates only fill missing keys.
          extra_data = EXCLUDED.extra_data || COALESCE(existing_contact.extra_data, '{}'::jsonb),
          is_delete = false,
          staff_id = EXCLUDED.staff_id,
          organization_id = EXCLUDED.organization_id,
          updated_at = now()
        RETURNING * INTO v_contact;
      END IF;
    END IF;

    SELECT * INTO v_member
    FROM public.auto_account_contact_group_members AS member
    WHERE member.group_id = v_group.id AND member.contact_id = v_contact.id
    FOR UPDATE;
    v_member_found := FOUND;
    v_current_payload := jsonb_strip_nulls(jsonb_build_object(
      'name', NULLIF(btrim(COALESCE(v_row.payload ->> 'name', '')), ''),
      'uid', NULLIF(btrim(COALESCE(v_row.payload ->> 'uid', '')), ''),
      'url', NULLIF(btrim(COALESCE(v_row.payload ->> 'url', '')), ''),
      'phone', NULLIF(public.aka_agent_internal_normalize_phone(
        COALESCE(v_row.payload ->> 'phone', '')
      ), ''),
      'email', NULLIF(lower(btrim(COALESCE(v_row.payload ->> 'email', ''))), ''),
      'info1', NULLIF(v_row.payload ->> 'info1', ''),
      'info2', NULLIF(v_row.payload ->> 'info2', ''),
      'info3', NULLIF(v_row.payload ->> 'info3', ''),
      'info4', NULLIF(v_row.payload ->> 'info4', ''),
      'info5', NULLIF(v_row.payload ->> 'info5', ''),
      'extra_data', CASE WHEN jsonb_typeof(v_row.payload -> 'extra_data') = 'object'
        THEN v_row.payload -> 'extra_data' ELSE '{}'::jsonb END
    ));
    v_raw_automation_detail_id := NULLIF(btrim(COALESCE(
      v_row.payload -> 'extra_data' ->> 'automationDetailId',
      v_row.payload ->> 'automation_detail_id',
      ''
    )), '');
    IF p_kind = 'automation'
      AND v_raw_automation_detail_id ~ '^[1-9][0-9]{0,17}$'
    THEN
      SELECT detail.id INTO v_origin_automation_detail_id
      FROM public.auto_automation_detail AS detail
      WHERE detail.id = v_raw_automation_detail_id::bigint
        AND detail.staff_id = p_staff_id
        AND detail.organization_id = p_organization_id;
    END IF;
    v_duplicate_in_batch := v_batch_seen ? v_contact.id::text;

    IF v_duplicate_in_batch THEN
      v_first_payload := v_batch_seen -> v_contact.id::text;
      SELECT EXISTS (
        SELECT 1
        FROM jsonb_each(v_first_payload - 'extra_data') AS first_value(key, value)
        JOIN jsonb_each(v_current_payload - 'extra_data') AS current_value(key, value)
          USING (key)
        WHERE first_value.value IS DISTINCT FROM current_value.value
      ) OR EXISTS (
        SELECT 1
        FROM jsonb_each(COALESCE(v_first_payload -> 'extra_data', '{}'::jsonb))
          AS first_extra(key, value)
        JOIN jsonb_each(COALESCE(v_current_payload -> 'extra_data', '{}'::jsonb))
          AS current_extra(key, value)
          USING (key)
        WHERE first_extra.value IS DISTINCT FROM current_extra.value
      ) INTO v_duplicate_conflict;

      -- Extend the first-row snapshot only with fields it did not provide.
      v_first_payload := v_current_payload || v_first_payload;
      v_first_payload := jsonb_set(
        v_first_payload,
        '{extra_data}',
        COALESCE(v_current_payload -> 'extra_data', '{}'::jsonb)
          || COALESCE((v_batch_seen -> v_contact.id::text) -> 'extra_data', '{}'::jsonb),
        true
      );
      v_batch_seen := jsonb_set(
        v_batch_seen, ARRAY[v_contact.id::text], v_first_payload, true
      );
      IF v_duplicate_conflict THEN
        v_conflict := v_conflict + 1;
        v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
          'rowIndex', v_row.row_index - 1,
          'code', 'duplicate_identity_conflict',
          'message', 'Dòng trùng định danh có giá trị khác; giữ giá trị của dòng đầu.',
          'contactId', v_contact.id
        ));
      END IF;
    ELSE
      v_batch_seen := jsonb_set(
        v_batch_seen, ARRAY[v_contact.id::text], v_current_payload, true
      );
    END IF;

    IF NOT v_revision_started THEN
      UPDATE public.auto_account_contact_groups
      SET revision = revision + 1, updated_at = now()
      WHERE id = v_group.id
      RETURNING revision INTO v_revision;
      v_revision_started := true;
    END IF;

    IF NOT v_member_found THEN
      INSERT INTO public.auto_account_contact_group_members (
        group_id, contact_id, is_delete, change_revision, created_at, updated_at
      ) VALUES (v_group.id, v_contact.id, false, v_revision, now(), now())
      RETURNING * INTO v_member;
      v_inserted_members := v_inserted_members + 1;
    ELSIF v_duplicate_in_batch THEN
      IF NOT v_duplicate_conflict THEN
        v_existing_members := v_existing_members + 1;
      END IF;
    ELSIF v_member.is_delete THEN
      UPDATE public.auto_account_contact_group_members
      SET is_delete = false, change_revision = v_revision, updated_at = now()
      WHERE id = v_member.id
      RETURNING * INTO v_member;
      v_reactivated_members := v_reactivated_members + 1;
    ELSE
      UPDATE public.auto_account_contact_group_members
      SET change_revision = v_revision, updated_at = now()
      WHERE id = v_member.id
      RETURNING * INTO v_member;
      v_existing_members := v_existing_members + 1;
    END IF;

    INSERT INTO public.auto_account_contact_group_member_origins (
      membership_id, kind, dataset_id, batch_id, source_account_id, automation_detail_id,
      source_name_snapshot, is_current, created_at, updated_at
    ) VALUES (
      v_member.id, p_kind, v_dataset.id, v_batch.id,
      COALESCE(v_row_account_id, v_contact.account_id),
      v_origin_automation_detail_id,
      COALESCE(NULLIF(btrim(COALESCE(p_source_name, '')), ''), v_source_account.name),
      CASE
        WHEN v_dataset.id IS NOT NULL AND v_dataset.source = 'scan' THEN EXISTS (
          SELECT 1 FROM public.auto_account_contacts_dataset_members AS dataset_member
          WHERE dataset_member.dataset_id = v_dataset.id
            AND dataset_member.contact_id = v_contact.id
            AND dataset_member.is_current = true
        )
        ELSE true
      END,
      now(), now()
    )
    ON CONFLICT DO NOTHING;

    IF v_dataset.id IS NOT NULL AND v_dataset.source = 'upload' AND v_dataset.group_id = v_group.id THEN
      INSERT INTO public.auto_account_contacts_dataset_members (
        dataset_id, contact_id, sort_order, is_current,
        first_seen_at, last_seen_at, created_at, updated_at
      ) VALUES (
        v_dataset.id, v_contact.id, GREATEST(v_row.row_index - 1, 0), true,
        now(), now(), now(), now()
      )
      ON CONFLICT (dataset_id, contact_id) DO UPDATE SET
        sort_order = LEAST(auto_account_contacts_dataset_members.sort_order, EXCLUDED.sort_order),
        is_current = true, last_seen_at = now(), updated_at = now();
    END IF;

    FOR v_source IN
      SELECT source.id
      FROM public.auto_campaign_data_group_sources AS source
      WHERE source.group_id = v_group.id AND source.status IN ('baselining', 'active')
      ORDER BY source.campaign_id
    LOOP
      v_outcome := public.aka_agent_internal_route_data_group_member(
        v_source.id, v_member.id, v_batch.id, v_revision
      );
      CASE v_outcome ->> 'status'
        WHEN 'inserted' THEN v_inserted_inputs := v_inserted_inputs + 1;
        WHEN 'existing' THEN v_existing_inputs := v_existing_inputs + 1;
        WHEN 'incompatible' THEN v_incompatible := v_incompatible + 1;
        WHEN 'conflict' THEN
          v_conflict := v_conflict + 1;
          v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
            'rowIndex', v_row.row_index - 1,
            'code', 'canonical_alias_conflict',
            'message', 'Các định danh của dòng đang trỏ tới nhiều target khác nhau.',
            'aliases', COALESCE(v_outcome -> 'aliases', '[]'::jsonb)
          ));
        ELSE NULL;
      END CASE;
    END LOOP;
  END LOOP;

  IF v_dataset.id IS NOT NULL AND v_dataset.source = 'upload' AND v_dataset.group_id = v_group.id THEN
    SELECT count(*)::integer INTO v_removed_members
    FROM public.auto_account_contact_group_members AS member
    WHERE member.group_id = v_group.id AND member.is_delete = false
      AND EXISTS (
        SELECT 1 FROM public.auto_account_contact_group_member_origins AS historical_origin
        WHERE historical_origin.membership_id = member.id
          AND historical_origin.dataset_id = v_dataset.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.auto_account_contact_group_member_origins AS current_origin
        WHERE current_origin.membership_id = member.id
          AND current_origin.is_current = true
      );
    IF v_removed_members > 0 THEN
      IF NOT v_revision_started THEN
        UPDATE public.auto_account_contact_groups
        SET revision = revision + 1, updated_at = now()
        WHERE id = v_group.id
        RETURNING revision INTO v_revision;
        v_revision_started := true;
      END IF;
      UPDATE public.auto_account_contact_group_members AS member
      SET is_delete = true, change_revision = v_revision, updated_at = now()
      WHERE member.group_id = v_group.id AND member.is_delete = false
        AND EXISTS (
          SELECT 1 FROM public.auto_account_contact_group_member_origins AS historical_origin
          WHERE historical_origin.membership_id = member.id
            AND historical_origin.dataset_id = v_dataset.id
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.auto_account_contact_group_member_origins AS current_origin
          WHERE current_origin.membership_id = member.id
            AND current_origin.is_current = true
        );
    END IF;

    UPDATE public.auto_account_contacts_dataset AS dataset
    SET contact_count = (
      SELECT count(*)::integer
      FROM public.auto_account_contacts_dataset_members AS member
      WHERE member.dataset_id = v_dataset.id AND member.is_current = true
    ), updated_at = now()
    WHERE dataset.id = v_dataset.id;
  END IF;
  IF NOT v_revision_started THEN v_revision := v_group.revision; END IF;

  v_result := jsonb_build_object(
    'request_id', btrim(p_request_id),
    'batch_id', v_batch.id,
    'group_id', v_group.id,
    'group_revision', v_revision,
    'inserted_membership_count', v_inserted_members,
    'reactivated_membership_count', v_reactivated_members,
    'already_member_count', v_existing_members,
    'removed_membership_count', v_removed_members,
    'inserted_input_count', v_inserted_inputs,
    'already_seen_input_count', v_existing_inputs,
    'incompatible_count', v_incompatible,
    'conflict_count', v_conflict,
    'invalid_count', v_invalid,
    'conflicts', v_conflicts
  );
  UPDATE public.auto_data_ingest_batches
  SET status = 'completed', result = v_result, updated_at = now()
  WHERE id = v_batch.id;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.aka_agent_sync_scan_dataset_group_origins()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_dataset_id bigint := CASE WHEN TG_OP = 'DELETE' THEN OLD.dataset_id ELSE NEW.dataset_id END;
  v_contact_id bigint := CASE WHEN TG_OP = 'DELETE' THEN OLD.contact_id ELSE NEW.contact_id END;
  v_is_current boolean := CASE WHEN TG_OP = 'DELETE' THEN false ELSE NEW.is_current END;
  v_member record;
  v_revision bigint;
  v_source record;
BEGIN
  -- Uploads own their batch-by-batch refresh inside the ingest RPC. Scan
  -- datasets are refreshed by the existing scanners, so mirror their current
  -- bit into every group that previously selected that dataset contact.
  IF EXISTS (
    SELECT 1 FROM public.auto_account_contacts_dataset AS dataset
    WHERE dataset.id = v_dataset_id AND dataset.source = 'scan'
  ) THEN
    -- All group mutations lock the group header before any membership row.
    -- Pre-lock every affected group in a deterministic order so concurrent
    -- scan refreshes cannot invert that order and deadlock with ingest/move.
    PERFORM contact_group.id
    FROM public.auto_account_contact_groups AS contact_group
    WHERE contact_group.purpose = 'data_group'
      AND contact_group.is_delete = false
      AND EXISTS (
        SELECT 1
        FROM public.auto_account_contact_group_members AS member
        WHERE member.group_id = contact_group.id
          AND member.contact_id = v_contact_id
          AND EXISTS (
            SELECT 1
            FROM public.auto_account_contact_group_member_origins AS origin
            WHERE origin.membership_id = member.id
              AND origin.dataset_id = v_dataset_id
          )
      )
    ORDER BY contact_group.id
    FOR UPDATE OF contact_group;

    FOR v_member IN
      SELECT member.id, member.group_id, member.is_delete
      FROM public.auto_account_contact_group_members AS member
      JOIN public.auto_account_contact_groups AS contact_group
        ON contact_group.id = member.group_id
       AND contact_group.purpose = 'data_group'
       AND contact_group.is_delete = false
      WHERE member.contact_id = v_contact_id
        AND EXISTS (
          SELECT 1 FROM public.auto_account_contact_group_member_origins AS origin
          WHERE origin.membership_id = member.id AND origin.dataset_id = v_dataset_id
        )
      ORDER BY member.group_id, member.id
      FOR UPDATE OF member
    LOOP
      IF v_is_current THEN
        IF v_member.is_delete THEN
          UPDATE public.auto_account_contact_groups
          SET revision = revision + 1, updated_at = now()
          WHERE id = v_member.group_id
          RETURNING revision INTO v_revision;
          UPDATE public.auto_account_contact_group_members
          SET is_delete = false, change_revision = v_revision, updated_at = now()
          WHERE id = v_member.id;
        ELSE
          SELECT revision INTO v_revision
          FROM public.auto_account_contact_groups WHERE id = v_member.group_id;
        END IF;
        UPDATE public.auto_account_contact_group_member_origins
        SET is_current = true, updated_at = now()
        WHERE membership_id = v_member.id AND dataset_id = v_dataset_id
          AND is_current = false;

        IF v_member.is_delete THEN
          FOR v_source IN
            SELECT source.id
            FROM public.auto_campaign_data_group_sources AS source
            WHERE source.group_id = v_member.group_id
              AND source.status IN ('baselining', 'active')
            ORDER BY source.campaign_id
          LOOP
            PERFORM public.aka_agent_internal_route_data_group_member(
              v_source.id, v_member.id, NULL, v_revision
            );
          END LOOP;
        END IF;
      ELSE
        UPDATE public.auto_account_contact_group_member_origins
        SET is_current = false, updated_at = now()
        WHERE membership_id = v_member.id AND dataset_id = v_dataset_id
          AND is_current = true;
        IF NOT v_member.is_delete AND NOT EXISTS (
          SELECT 1 FROM public.auto_account_contact_group_member_origins AS current_origin
          WHERE current_origin.membership_id = v_member.id
            AND current_origin.is_current = true
        ) THEN
          UPDATE public.auto_account_contact_groups
          SET revision = revision + 1, updated_at = now()
          WHERE id = v_member.group_id
          RETURNING revision INTO v_revision;
          UPDATE public.auto_account_contact_group_members
          SET is_delete = true, change_revision = v_revision, updated_at = now()
          WHERE id = v_member.id;
        END IF;
      END IF;
    END LOOP;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_aka_agent_sync_scan_dataset_group_origins
  ON public.auto_account_contacts_dataset_members;
CREATE TRIGGER trg_aka_agent_sync_scan_dataset_group_origins
AFTER INSERT OR UPDATE OR DELETE ON public.auto_account_contacts_dataset_members
FOR EACH ROW EXECUTE FUNCTION public.aka_agent_sync_scan_dataset_group_origins();

CREATE OR REPLACE FUNCTION public.aka_agent_remove_data_group_members(
  p_staff_id bigint,
  p_organization_id bigint,
  p_request_id text,
  p_group_id bigint,
  p_membership_ids bigint[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_group public.auto_account_contact_groups%ROWTYPE;
  v_batch public.auto_data_ingest_batches%ROWTYPE;
  v_request_hash text;
  v_requested integer;
  v_count integer := 0;
  v_result jsonb;
BEGIN
  PERFORM public.aka_agent_internal_require_staff_tenant(p_staff_id, p_organization_id);
  IF NULLIF(btrim(COALESCE(p_request_id, '')), '') IS NULL
    OR COALESCE(cardinality(p_membership_ids), 0) = 0
    OR EXISTS (SELECT 1 FROM unnest(p_membership_ids) AS value(id) WHERE id IS NULL OR id <= 0)
  THEN RAISE EXCEPTION 'invalid_data_group_member_mutation'; END IF;
  SELECT count(DISTINCT id)::integer INTO v_requested FROM unnest(p_membership_ids) AS value(id);

  SELECT * INTO v_group
  FROM public.auto_account_contact_groups AS contact_group
  WHERE contact_group.id = p_group_id AND contact_group.staff_id = p_staff_id
    AND contact_group.organization_id = p_organization_id
    AND contact_group.purpose = 'data_group' AND contact_group.is_delete = false
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'data_group_not_found'; END IF;

  v_request_hash := md5(jsonb_build_object(
    'operation', 'remove_members', 'groupId', p_group_id,
    'membershipIds', (SELECT jsonb_agg(id ORDER BY id) FROM (
      SELECT DISTINCT id FROM unnest(p_membership_ids) AS value(id)
    ) AS sorted)
  )::text);
  INSERT INTO public.auto_data_ingest_batches (
    request_id, operation, group_id, kind, request_hash, status, staff_id, organization_id
  ) VALUES (
    btrim(p_request_id), 'remove_members', p_group_id, 'manual', v_request_hash,
    'processing', p_staff_id, p_organization_id
  ) ON CONFLICT (staff_id, organization_id, request_id) DO NOTHING
  RETURNING * INTO v_batch;
  IF NOT FOUND THEN
    SELECT * INTO v_batch FROM public.auto_data_ingest_batches
    WHERE staff_id = p_staff_id AND organization_id = p_organization_id
      AND request_id = btrim(p_request_id)
    FOR UPDATE;
    IF v_batch.operation <> 'remove_members' OR v_batch.request_hash <> v_request_hash THEN
      RAISE EXCEPTION 'data_group_request_id_conflict';
    END IF;
    IF v_batch.result IS NOT NULL THEN RETURN v_batch.result; END IF;
    RAISE EXCEPTION 'data_group_request_incomplete';
  END IF;

  IF (
    SELECT count(DISTINCT member.id)
    FROM public.auto_account_contact_group_members AS member
    WHERE member.group_id = v_group.id AND member.id = ANY(p_membership_ids)
  ) <> v_requested THEN
    RAISE EXCEPTION 'data_group_membership_not_found';
  END IF;

  SELECT count(*)::integer INTO v_count
  FROM public.auto_account_contact_group_members AS member
  WHERE member.group_id = v_group.id AND member.id = ANY(p_membership_ids)
    AND member.is_delete = false;
  IF v_count > 0 THEN
    UPDATE public.auto_account_contact_groups
    SET revision = revision + 1, updated_at = now()
    WHERE id = v_group.id RETURNING * INTO v_group;
    UPDATE public.auto_account_contact_group_members
    SET is_delete = true, change_revision = v_group.revision, updated_at = now()
    WHERE group_id = v_group.id AND id = ANY(p_membership_ids) AND is_delete = false;
    UPDATE public.auto_account_contact_group_member_origins AS origin
    SET is_current = false, updated_at = now()
    FROM public.auto_account_contact_group_members AS member
    WHERE member.group_id = v_group.id AND member.id = ANY(p_membership_ids)
      AND origin.membership_id = member.id AND origin.is_current = true;
  END IF;

  v_result := jsonb_build_object(
    'success', true, 'count', v_count, 'group_revision', v_group.revision
  );
  UPDATE public.auto_data_ingest_batches
  SET status = 'completed', result = v_result, updated_at = now()
  WHERE id = v_batch.id;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.aka_agent_move_data_group_members(
  p_staff_id bigint,
  p_organization_id bigint,
  p_request_id text,
  p_group_id bigint,
  p_membership_ids bigint[],
  p_target_group_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_source_group public.auto_account_contact_groups%ROWTYPE;
  v_target_group public.auto_account_contact_groups%ROWTYPE;
  v_batch public.auto_data_ingest_batches%ROWTYPE;
  v_request_hash text;
  v_requested integer;
  v_count integer := 0;
  v_source_member record;
  v_target_member public.auto_account_contact_group_members%ROWTYPE;
  v_bound_source record;
  v_result jsonb;
BEGIN
  PERFORM public.aka_agent_internal_require_staff_tenant(p_staff_id, p_organization_id);
  IF NULLIF(btrim(COALESCE(p_request_id, '')), '') IS NULL
    OR p_group_id IS NOT DISTINCT FROM p_target_group_id
    OR COALESCE(cardinality(p_membership_ids), 0) = 0
    OR EXISTS (SELECT 1 FROM unnest(p_membership_ids) AS value(id) WHERE id IS NULL OR id <= 0)
  THEN RAISE EXCEPTION 'invalid_data_group_member_move'; END IF;
  SELECT count(DISTINCT id)::integer INTO v_requested FROM unnest(p_membership_ids) AS value(id);

  -- Stable lock order avoids inverse source/destination move deadlocks.
  PERFORM contact_group.id
  FROM public.auto_account_contact_groups AS contact_group
  WHERE contact_group.id IN (p_group_id, p_target_group_id)
  ORDER BY contact_group.id
  FOR UPDATE;

  SELECT * INTO v_source_group
  FROM public.auto_account_contact_groups AS contact_group
  WHERE contact_group.id = p_group_id AND contact_group.staff_id = p_staff_id
    AND contact_group.organization_id = p_organization_id
    AND contact_group.purpose = 'data_group' AND contact_group.is_delete = false;
  SELECT * INTO v_target_group
  FROM public.auto_account_contact_groups AS contact_group
  WHERE contact_group.id = p_target_group_id AND contact_group.staff_id = p_staff_id
    AND contact_group.organization_id = p_organization_id
    AND contact_group.purpose = 'data_group' AND contact_group.is_delete = false;
  IF v_source_group.id IS NULL OR v_target_group.id IS NULL THEN
    RAISE EXCEPTION 'data_group_not_found';
  END IF;

  v_request_hash := md5(jsonb_build_object(
    'operation', 'move_members', 'groupId', p_group_id,
    'targetGroupId', p_target_group_id,
    'membershipIds', (SELECT jsonb_agg(id ORDER BY id) FROM (
      SELECT DISTINCT id FROM unnest(p_membership_ids) AS value(id)
    ) AS sorted)
  )::text);
  INSERT INTO public.auto_data_ingest_batches (
    request_id, operation, group_id, target_group_id, kind, request_hash,
    status, staff_id, organization_id
  ) VALUES (
    btrim(p_request_id), 'move_members', p_group_id, p_target_group_id, 'manual',
    v_request_hash, 'processing', p_staff_id, p_organization_id
  ) ON CONFLICT (staff_id, organization_id, request_id) DO NOTHING
  RETURNING * INTO v_batch;
  IF NOT FOUND THEN
    SELECT * INTO v_batch FROM public.auto_data_ingest_batches
    WHERE staff_id = p_staff_id AND organization_id = p_organization_id
      AND request_id = btrim(p_request_id)
    FOR UPDATE;
    IF v_batch.operation <> 'move_members' OR v_batch.request_hash <> v_request_hash THEN
      RAISE EXCEPTION 'data_group_request_id_conflict';
    END IF;
    IF v_batch.result IS NOT NULL THEN RETURN v_batch.result; END IF;
    RAISE EXCEPTION 'data_group_request_incomplete';
  END IF;

  IF (
    SELECT count(DISTINCT member.id)
    FROM public.auto_account_contact_group_members AS member
    WHERE member.group_id = v_source_group.id AND member.id = ANY(p_membership_ids)
  ) <> v_requested THEN
    RAISE EXCEPTION 'data_group_membership_not_found';
  END IF;
  SELECT count(*)::integer INTO v_count
  FROM public.auto_account_contact_group_members AS member
  WHERE member.group_id = v_source_group.id AND member.id = ANY(p_membership_ids)
    AND member.is_delete = false;

  IF v_count > 0 THEN
    UPDATE public.auto_account_contact_groups
    SET revision = revision + 1, updated_at = now()
    WHERE id = v_target_group.id RETURNING * INTO v_target_group;
    UPDATE public.auto_account_contact_groups
    SET revision = revision + 1, updated_at = now()
    WHERE id = v_source_group.id RETURNING * INTO v_source_group;

    -- Activate destination memberships and provenance first.
    FOR v_source_member IN
      SELECT member.*
      FROM public.auto_account_contact_group_members AS member
      WHERE member.group_id = v_source_group.id
        AND member.id = ANY(p_membership_ids) AND member.is_delete = false
      ORDER BY member.id
    LOOP
      INSERT INTO public.auto_account_contact_group_members AS existing_member (
        group_id, contact_id, is_delete, change_revision, created_at, updated_at
      ) VALUES (
        v_target_group.id, v_source_member.contact_id, false,
        v_target_group.revision, now(), now()
      )
      ON CONFLICT (group_id, contact_id) DO UPDATE SET
        is_delete = false,
        change_revision = EXCLUDED.change_revision,
        updated_at = now()
      RETURNING * INTO v_target_member;

      INSERT INTO public.auto_account_contact_group_member_origins (
        membership_id, kind, dataset_id, batch_id, source_account_id, automation_detail_id,
        source_name_snapshot, is_current, created_at, updated_at
      )
      SELECT
        v_target_member.id, origin.kind, origin.dataset_id, origin.batch_id,
        origin.source_account_id, origin.automation_detail_id,
        origin.source_name_snapshot, true, now(), now()
      FROM public.auto_account_contact_group_member_origins AS origin
      WHERE origin.membership_id = v_source_member.id AND origin.is_current = true
      ON CONFLICT DO NOTHING;

      INSERT INTO public.auto_account_contact_group_member_origins (
        membership_id, kind, batch_id, source_name_snapshot, is_current
      ) VALUES (
        v_target_member.id, 'manual', v_batch.id,
        'move:' || v_source_group.name, true
      ) ON CONFLICT DO NOTHING;

      FOR v_bound_source IN
        SELECT source.id FROM public.auto_campaign_data_group_sources AS source
        WHERE source.group_id = v_target_group.id AND source.status IN ('baselining', 'active')
        ORDER BY source.campaign_id
      LOOP
        PERFORM public.aka_agent_internal_route_data_group_member(
          v_bound_source.id, v_target_member.id, v_batch.id, v_target_group.revision
        );
      END LOOP;
    END LOOP;

    -- Source is soft-deleted only after all destination activations/fanout.
    UPDATE public.auto_account_contact_group_members
    SET is_delete = true, change_revision = v_source_group.revision, updated_at = now()
    WHERE group_id = v_source_group.id AND id = ANY(p_membership_ids) AND is_delete = false;
    UPDATE public.auto_account_contact_group_member_origins AS origin
    SET is_current = false, updated_at = now()
    FROM public.auto_account_contact_group_members AS member
    WHERE member.group_id = v_source_group.id AND member.id = ANY(p_membership_ids)
      AND origin.membership_id = member.id AND origin.is_current = true;
  END IF;

  v_result := jsonb_build_object(
    'success', true, 'count', v_count, 'group_revision', v_source_group.revision,
    'target_group_revision', v_target_group.revision
  );
  UPDATE public.auto_data_ingest_batches
  SET status = 'completed', result = v_result, updated_at = now()
  WHERE id = v_batch.id;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.aka_agent_create_campaign_creation_bundle(
  p_staff_id bigint,
  p_organization_id bigint,
  p_request_id text,
  p_expected_campaign_count integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_bundle public.auto_campaign_creation_bundles%ROWTYPE;
BEGIN
  PERFORM public.aka_agent_internal_require_staff_tenant(p_staff_id, p_organization_id);
  IF NULLIF(btrim(COALESCE(p_request_id, '')), '') IS NULL
    OR length(btrim(p_request_id)) > 500
    OR p_expected_campaign_count NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'invalid_campaign_creation_bundle';
  END IF;

  INSERT INTO public.auto_campaign_creation_bundles (
    request_id, expected_campaign_count, ready_campaign_count,
    status, staff_id, organization_id
  ) VALUES (
    btrim(p_request_id), p_expected_campaign_count, 0,
    'staged', p_staff_id, p_organization_id
  )
  ON CONFLICT (staff_id, organization_id, request_id) DO NOTHING
  RETURNING * INTO v_bundle;
  IF NOT FOUND THEN
    SELECT * INTO v_bundle
    FROM public.auto_campaign_creation_bundles AS bundle
    WHERE bundle.staff_id = p_staff_id
      AND bundle.organization_id = p_organization_id
      AND bundle.request_id = btrim(p_request_id)
    FOR UPDATE;
    IF v_bundle.expected_campaign_count <> p_expected_campaign_count THEN
      RAISE EXCEPTION 'campaign_creation_bundle_request_conflict';
    END IF;
  END IF;
  RETURN to_jsonb(v_bundle);
END;
$$;

-- Read-only guard for edit forms.  The database trigger remains authoritative,
-- but this RPC lets the UI reject a group switch before saving other campaign
-- fields and thereby avoids a partial multi-call save experience.
CREATE OR REPLACE FUNCTION public.aka_agent_preflight_campaign_data_group_change(
  p_staff_id bigint,
  p_organization_id bigint,
  p_campaign_id bigint,
  p_group_id bigint
)
RETURNS TABLE (
  allowed boolean,
  reason text,
  canonical_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_campaign public.auto_campaigns%ROWTYPE;
  v_source public.auto_campaign_data_group_sources%ROWTYPE;
BEGIN
  PERFORM public.aka_agent_internal_require_staff_tenant(
    p_staff_id, p_organization_id
  );
  canonical_count := 0;

  SELECT campaign.* INTO v_campaign
  FROM public.auto_campaigns AS campaign
  WHERE campaign.id = p_campaign_id
    AND campaign.staff_id = p_staff_id
    AND campaign.organization_id = p_organization_id;
  IF NOT FOUND OR COALESCE(v_campaign.is_delete, false) THEN
    allowed := false;
    reason := 'data_group_campaign_not_found';
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT count(*)::bigint INTO canonical_count
  FROM public.auto_campaign_input_data AS input_row
  WHERE input_row.campaign_id = v_campaign.id
    AND input_row.canonical_target_key IS NOT NULL
    AND COALESCE(input_row.is_delete, false) = false;

  IF p_group_id IS NULL OR p_group_id <= 0 OR NOT EXISTS (
    SELECT 1
    FROM public.auto_account_contact_groups AS contact_group
    WHERE contact_group.id = p_group_id
      AND contact_group.staff_id = p_staff_id
      AND contact_group.organization_id = p_organization_id
      AND contact_group.purpose = 'data_group'
      AND contact_group.is_delete = false
  ) THEN
    allowed := false;
    reason := 'data_group_not_found';
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_campaign.data_target_source_mode = 'data_group'
    AND v_campaign.data_group_id IS NOT DISTINCT FROM p_group_id
  THEN
    allowed := true;
    reason := 'unchanged';
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_campaign.status IN ('đang chạy', 'hoàn thành')
    OR (v_campaign.schedule_end_date IS NOT NULL
      AND v_campaign.schedule_end_date <= now())
  THEN
    allowed := false;
    reason := 'data_group_campaign_not_bindable';
    RETURN NEXT;
    RETURN;
  END IF;
  IF v_campaign.action_id NOT IN (
    'facebook_group_post', 'facebook_join_group', 'facebook_message_uid',
    'facebook_find_data_group', 'facebook_find_data_search',
    'facebook_comment_seeding', 'facebook_comment_seeding_post',
    'zalo_message_phone', 'zalo_join_group_link', 'email_send',
    'facebook_message_friend', 'facebook_group_invite', 'facebook_page_post',
    'zalo_message_friend', 'zalo_message_group_member',
    'zalo_message_remarketing_customer', 'zalo_message_group',
    'zalo_add_group_member'
  ) THEN
    allowed := false;
    reason := 'data_group_campaign_action_incompatible';
    RETURN NEXT;
    RETURN;
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.auto_accounts AS account
    WHERE account.id = v_campaign.account_id
      AND account.staff_id = p_staff_id
      AND (account.organization_id IS NULL OR account.organization_id = p_organization_id)
      AND COALESCE(account.is_delete, false) = false
  ) THEN
    allowed := false;
    reason := 'data_group_campaign_account_not_found';
    RETURN NEXT;
    RETURN;
  END IF;
  IF canonical_count > 0 THEN
    allowed := false;
    reason := 'campaign_data_group_source_immutable_after_intake';
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT source.* INTO v_source
  FROM public.auto_campaign_data_group_sources AS source
  WHERE source.campaign_id = v_campaign.id
    AND source.staff_id = p_staff_id
    AND source.organization_id = p_organization_id;
  IF FOUND AND v_source.bundle_id IS NOT NULL THEN
    allowed := false;
    reason := 'campaign_data_group_source_immutable';
    RETURN NEXT;
    RETURN;
  END IF;

  allowed := true;
  reason := 'allowed';
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.aka_agent_bind_campaign_data_group_source(
  p_staff_id bigint,
  p_organization_id bigint,
  p_request_id text,
  p_campaign_id bigint,
  p_group_id bigint,
  p_bundle_id bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_group public.auto_account_contact_groups%ROWTYPE;
  v_campaign public.auto_campaigns%ROWTYPE;
  v_bundle public.auto_campaign_creation_bundles%ROWTYPE;
  v_source public.auto_campaign_data_group_sources%ROWTYPE;
  v_batch public.auto_data_ingest_batches%ROWTYPE;
  v_request_hash text;
  v_ready_count integer;
  v_rebinding boolean := false;
  v_snapshot jsonb;
BEGIN
  PERFORM public.aka_agent_internal_require_staff_tenant(p_staff_id, p_organization_id);
  IF NULLIF(btrim(COALESCE(p_request_id, '')), '') IS NULL THEN
    RAISE EXCEPTION 'invalid_data_group_bind_request';
  END IF;

  SELECT * INTO v_group
  FROM public.auto_account_contact_groups AS contact_group
  WHERE contact_group.id = p_group_id AND contact_group.staff_id = p_staff_id
    AND contact_group.organization_id = p_organization_id
    AND contact_group.purpose = 'data_group' AND contact_group.is_delete = false
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'data_group_not_found'; END IF;

  SELECT * INTO v_campaign
  FROM public.auto_campaigns AS campaign
  WHERE campaign.id = p_campaign_id AND campaign.staff_id = p_staff_id
    AND campaign.organization_id = p_organization_id
  FOR UPDATE;
  IF NOT FOUND OR COALESCE(v_campaign.is_delete, false) THEN
    RAISE EXCEPTION 'data_group_campaign_not_found';
  END IF;
  IF v_campaign.status IN ('đang chạy', 'hoàn thành')
    OR (v_campaign.schedule_end_date IS NOT NULL AND v_campaign.schedule_end_date <= now()) THEN
    RAISE EXCEPTION 'data_group_campaign_not_bindable';
  END IF;
  IF v_campaign.action_id NOT IN (
    'facebook_group_post', 'facebook_join_group', 'facebook_message_uid',
    'facebook_find_data_group', 'facebook_find_data_search',
    'facebook_comment_seeding', 'facebook_comment_seeding_post',
    'zalo_message_phone', 'zalo_join_group_link', 'email_send',
    'facebook_message_friend', 'facebook_group_invite', 'facebook_page_post',
    'zalo_message_friend', 'zalo_message_group_member',
    'zalo_message_remarketing_customer', 'zalo_message_group',
    'zalo_add_group_member'
  ) THEN
    RAISE EXCEPTION 'data_group_campaign_action_incompatible';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.auto_accounts AS account
    WHERE account.id = v_campaign.account_id AND account.staff_id = p_staff_id
      AND (account.organization_id IS NULL OR account.organization_id = p_organization_id)
      AND COALESCE(account.is_delete, false) = false
  ) THEN RAISE EXCEPTION 'data_group_campaign_account_not_found'; END IF;

  IF p_bundle_id IS NOT NULL THEN
    SELECT * INTO v_bundle
    FROM public.auto_campaign_creation_bundles AS bundle
    WHERE bundle.id = p_bundle_id AND bundle.staff_id = p_staff_id
      AND bundle.organization_id = p_organization_id
    FOR UPDATE;
    IF NOT FOUND OR v_bundle.status = 'failed' THEN
      RAISE EXCEPTION 'campaign_creation_bundle_not_found';
    END IF;
    IF v_campaign.creation_bundle_id IS DISTINCT FROM p_bundle_id
      OR v_campaign.creation_bundle_child_index IS NULL
      OR v_campaign.creation_bundle_child_index < 0
      OR v_campaign.creation_bundle_child_index >= v_bundle.expected_campaign_count THEN
      RAISE EXCEPTION 'campaign_creation_bundle_child_invalid';
    END IF;
  ELSIF v_campaign.creation_bundle_id IS NOT NULL THEN
    RAISE EXCEPTION 'campaign_creation_bundle_required';
  END IF;

  SELECT * INTO v_source
  FROM public.auto_campaign_data_group_sources AS source
  WHERE source.campaign_id = v_campaign.id
  FOR UPDATE;
  IF FOUND THEN
    IF v_source.bundle_id IS DISTINCT FROM p_bundle_id THEN
      RAISE EXCEPTION 'campaign_data_group_source_immutable';
    END IF;
    IF v_source.group_id IS DISTINCT FROM v_group.id THEN
      IF EXISTS (
        SELECT 1 FROM public.auto_campaign_input_data AS input_data
        WHERE input_data.campaign_id = v_campaign.id
          AND input_data.canonical_target_key IS NOT NULL
          AND COALESCE(input_data.is_delete, false) = false
      ) THEN
        RAISE EXCEPTION 'campaign_data_group_source_immutable_after_intake';
      END IF;
      v_rebinding := true;
    ELSE
      IF v_source.status = 'active' THEN RETURN to_jsonb(v_source); END IF;
      IF v_source.status = 'stopped' THEN
        RAISE EXCEPTION 'campaign_data_group_source_stopped_use_reactivate';
      END IF;
    END IF;
  END IF;

  v_request_hash := md5(jsonb_build_object(
    'operation', 'bind_source', 'campaignId', p_campaign_id,
    'groupId', p_group_id, 'bundleId', p_bundle_id
  )::text);
  INSERT INTO public.auto_data_ingest_batches (
    request_id, operation, group_id, request_hash, status, staff_id, organization_id
  ) VALUES (
    btrim(p_request_id), 'bind_source', p_group_id, v_request_hash,
    'processing', p_staff_id, p_organization_id
  ) ON CONFLICT (staff_id, organization_id, request_id) DO NOTHING
  RETURNING * INTO v_batch;
  IF NOT FOUND THEN
    SELECT * INTO v_batch FROM public.auto_data_ingest_batches
    WHERE staff_id = p_staff_id AND organization_id = p_organization_id
      AND request_id = btrim(p_request_id)
    FOR UPDATE;
    IF v_batch.operation <> 'bind_source' OR v_batch.request_hash <> v_request_hash THEN
      RAISE EXCEPTION 'data_group_request_id_conflict';
    END IF;
    IF v_batch.result IS NOT NULL THEN RETURN v_batch.result; END IF;
    RAISE EXCEPTION 'data_group_request_incomplete';
  END IF;

  UPDATE public.auto_campaigns
  SET data_target_source_mode = 'data_group',
      data_group_id = v_group.id,
      provisioning_state = 'staged',
      updated_at = now()
  WHERE id = v_campaign.id;

  IF v_source.id IS NULL THEN
    INSERT INTO public.auto_campaign_data_group_sources (
      campaign_id, group_id, bundle_id, baseline_revision, status,
      staff_id, organization_id
    ) VALUES (
      v_campaign.id, v_group.id, p_bundle_id, v_group.revision, 'baselining',
      p_staff_id, p_organization_id
    ) RETURNING * INTO v_source;
  ELSIF v_rebinding THEN
    -- Campaign and source rows are both locked; changing an empty source is one
    -- atomic rebind. Historical soft-deleted input rows remain audit-only.
    DELETE FROM public.auto_campaign_input_target_aliases AS alias
    WHERE alias.campaign_id = v_campaign.id
      AND NOT EXISTS (
        SELECT 1 FROM public.auto_campaign_input_data AS input_data
        WHERE input_data.id = alias.input_data_id
          AND COALESCE(input_data.is_delete, false) = false
      );
    UPDATE public.auto_campaign_data_group_sources
    SET group_id = v_group.id, baseline_revision = v_group.revision,
        status = 'baselining', started_at = NULL, stopped_at = NULL,
        stop_reason = NULL, last_ingest_at = NULL, updated_at = now()
    WHERE id = v_source.id
    RETURNING * INTO v_source;
  END IF;

  v_snapshot := public.aka_agent_internal_route_group_snapshot(
    v_source.id, v_batch.id, v_group.revision
  );
  UPDATE public.auto_campaign_data_group_sources
  SET status = 'active', baseline_revision = v_group.revision,
      started_at = COALESCE(started_at, now()), stopped_at = NULL,
      stop_reason = NULL, last_ingest_at = now(), updated_at = now()
  WHERE id = v_source.id RETURNING * INTO v_source;

  UPDATE public.auto_campaigns
  SET note = CASE
      WHEN COALESCE((v_snapshot ->> 'inserted_input_count')::integer, 0)
         + COALESCE((v_snapshot ->> 'already_seen_input_count')::integer, 0) = 0
        THEN 'Chờ data phù hợp'
      WHEN note IN ('Chờ data phù hợp', 'Chờ data mới') THEN NULL
      ELSE note
    END,
    updated_at = now()
  WHERE id = v_campaign.id;

  IF p_bundle_id IS NULL THEN
    UPDATE public.auto_campaigns
    SET provisioning_state = 'ready', updated_at = now()
    WHERE id = v_campaign.id;
  ELSE
    SELECT count(*)::integer INTO v_ready_count
    FROM public.auto_campaign_data_group_sources AS source
    JOIN public.auto_campaigns AS campaign ON campaign.id = source.campaign_id
    WHERE source.bundle_id = p_bundle_id AND source.status = 'active'
      AND campaign.creation_bundle_id = p_bundle_id
      AND campaign.staff_id = p_staff_id AND campaign.organization_id = p_organization_id
      AND COALESCE(campaign.is_delete, false) = false;
    UPDATE public.auto_campaign_creation_bundles
    SET ready_campaign_count = LEAST(v_ready_count, expected_campaign_count),
        status = CASE WHEN v_ready_count = expected_campaign_count THEN 'ready' ELSE 'staged' END,
        updated_at = now()
    WHERE id = p_bundle_id RETURNING * INTO v_bundle;
    IF v_ready_count = v_bundle.expected_campaign_count THEN
      UPDATE public.auto_campaigns
      SET provisioning_state = 'ready', updated_at = now()
      WHERE creation_bundle_id = p_bundle_id
        AND staff_id = p_staff_id AND organization_id = p_organization_id
        AND COALESCE(is_delete, false) = false;
    END IF;
  END IF;

  UPDATE public.auto_data_ingest_batches
  SET status = 'completed', result = to_jsonb(v_source), updated_at = now()
  WHERE id = v_batch.id;
  RETURN to_jsonb(v_source);
END;
$$;

CREATE OR REPLACE FUNCTION public.aka_agent_get_campaign_data_group_source(
  p_staff_id bigint,
  p_organization_id bigint,
  p_campaign_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_source public.auto_campaign_data_group_sources%ROWTYPE;
BEGIN
  PERFORM public.aka_agent_internal_require_staff_tenant(p_staff_id, p_organization_id);
  SELECT * INTO v_source
  FROM public.auto_campaign_data_group_sources AS source
  WHERE source.campaign_id = p_campaign_id
    AND source.staff_id = p_staff_id
    AND source.organization_id = p_organization_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN to_jsonb(v_source);
END;
$$;

CREATE OR REPLACE FUNCTION public.aka_agent_stop_campaign_data_group_source(
  p_staff_id bigint,
  p_organization_id bigint,
  p_campaign_id bigint,
  p_request_id text,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_source public.auto_campaign_data_group_sources%ROWTYPE;
  v_batch public.auto_data_ingest_batches%ROWTYPE;
  v_hash text;
BEGIN
  PERFORM public.aka_agent_internal_require_staff_tenant(p_staff_id, p_organization_id);
  IF NULLIF(btrim(COALESCE(p_request_id, '')), '') IS NULL THEN
    RAISE EXCEPTION 'invalid_data_group_source_request';
  END IF;
  SELECT * INTO v_source
  FROM public.auto_campaign_data_group_sources AS source
  WHERE source.campaign_id = p_campaign_id AND source.staff_id = p_staff_id
    AND source.organization_id = p_organization_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'campaign_data_group_source_not_found'; END IF;

  v_hash := md5(jsonb_build_object(
    'operation', 'stop_source', 'campaignId', p_campaign_id,
    'reason', COALESCE(NULLIF(btrim(COALESCE(p_reason, '')), ''), 'manual_stop')
  )::text);
  INSERT INTO public.auto_data_ingest_batches (
    request_id, operation, group_id, request_hash, status, staff_id, organization_id
  ) VALUES (
    btrim(p_request_id), 'stop_source', v_source.group_id, v_hash,
    'processing', p_staff_id, p_organization_id
  ) ON CONFLICT (staff_id, organization_id, request_id) DO NOTHING
  RETURNING * INTO v_batch;
  IF NOT FOUND THEN
    SELECT * INTO v_batch FROM public.auto_data_ingest_batches
    WHERE staff_id = p_staff_id AND organization_id = p_organization_id
      AND request_id = btrim(p_request_id)
    FOR UPDATE;
    IF v_batch.operation <> 'stop_source' OR v_batch.request_hash <> v_hash THEN
      RAISE EXCEPTION 'data_group_request_id_conflict';
    END IF;
    IF v_batch.result IS NOT NULL THEN RETURN v_batch.result; END IF;
    RAISE EXCEPTION 'data_group_request_incomplete';
  END IF;

  UPDATE public.auto_campaign_data_group_sources
  SET status = 'stopped', stopped_at = COALESCE(stopped_at, now()),
      stop_reason = COALESCE(NULLIF(btrim(COALESCE(p_reason, '')), ''), 'manual_stop'),
      updated_at = now()
  WHERE id = v_source.id RETURNING * INTO v_source;
  UPDATE public.auto_data_ingest_batches
  SET status = 'completed', result = to_jsonb(v_source), updated_at = now()
  WHERE id = v_batch.id;
  RETURN to_jsonb(v_source);
END;
$$;

CREATE OR REPLACE FUNCTION public.aka_agent_reactivate_campaign_data_group_source(
  p_staff_id bigint,
  p_organization_id bigint,
  p_campaign_id bigint,
  p_request_id text,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_source public.auto_campaign_data_group_sources%ROWTYPE;
  v_campaign public.auto_campaigns%ROWTYPE;
  v_group public.auto_account_contact_groups%ROWTYPE;
  v_batch public.auto_data_ingest_batches%ROWTYPE;
  v_hash text;
BEGIN
  PERFORM public.aka_agent_internal_require_staff_tenant(p_staff_id, p_organization_id);
  IF NULLIF(btrim(COALESCE(p_request_id, '')), '') IS NULL THEN
    RAISE EXCEPTION 'invalid_data_group_source_request';
  END IF;

  SELECT * INTO v_source
  FROM public.auto_campaign_data_group_sources AS source
  WHERE source.campaign_id = p_campaign_id AND source.staff_id = p_staff_id
    AND source.organization_id = p_organization_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'campaign_data_group_source_not_found'; END IF;
  SELECT * INTO v_group
  FROM public.auto_account_contact_groups AS contact_group
  WHERE contact_group.id = v_source.group_id AND contact_group.staff_id = p_staff_id
    AND contact_group.organization_id = p_organization_id
    AND contact_group.purpose = 'data_group' AND contact_group.is_delete = false
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'data_group_not_found'; END IF;
  SELECT * INTO v_campaign
  FROM public.auto_campaigns AS campaign
  WHERE campaign.id = p_campaign_id AND campaign.staff_id = p_staff_id
    AND campaign.organization_id = p_organization_id
  FOR UPDATE;
  IF NOT FOUND OR COALESCE(v_campaign.is_delete, false)
    OR v_campaign.data_group_id IS DISTINCT FROM v_source.group_id
    OR v_campaign.data_target_source_mode <> 'data_group'
    OR (v_campaign.schedule_end_date IS NOT NULL AND v_campaign.schedule_end_date <= now()) THEN
    RAISE EXCEPTION 'data_group_campaign_terminal';
  END IF;
  -- Re-lock in the shared group -> campaign -> source order used by bind and
  -- intake, then verify the optimistic source read did not change underneath.
  SELECT * INTO v_source
  FROM public.auto_campaign_data_group_sources AS source
  WHERE source.id = v_source.id
    AND source.campaign_id = p_campaign_id
    AND source.group_id = v_group.id
    AND source.staff_id = p_staff_id
    AND source.organization_id = p_organization_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'campaign_data_group_source_changed'; END IF;
  IF v_source.status <> 'stopped' THEN RETURN to_jsonb(v_source); END IF;

  v_hash := md5(jsonb_build_object(
    'operation', 'reactivate_source', 'campaignId', p_campaign_id,
    'groupId', v_source.group_id
  )::text);
  INSERT INTO public.auto_data_ingest_batches (
    request_id, operation, group_id, request_hash, status, staff_id, organization_id
  ) VALUES (
    btrim(p_request_id), 'reactivate_source', v_source.group_id, v_hash,
    'processing', p_staff_id, p_organization_id
  ) ON CONFLICT (staff_id, organization_id, request_id) DO NOTHING
  RETURNING * INTO v_batch;
  IF NOT FOUND THEN
    SELECT * INTO v_batch FROM public.auto_data_ingest_batches
    WHERE staff_id = p_staff_id AND organization_id = p_organization_id
      AND request_id = btrim(p_request_id)
    FOR UPDATE;
    IF v_batch.operation <> 'reactivate_source' OR v_batch.request_hash <> v_hash THEN
      RAISE EXCEPTION 'data_group_request_id_conflict';
    END IF;
    IF v_batch.result IS NOT NULL THEN RETURN v_batch.result; END IF;
    RAISE EXCEPTION 'data_group_request_incomplete';
  END IF;

  UPDATE public.auto_campaign_data_group_sources
  SET status = 'baselining', stopped_at = NULL, stop_reason = NULL, updated_at = now()
  WHERE id = v_source.id RETURNING * INTO v_source;
  PERFORM public.aka_agent_internal_route_group_snapshot(
    v_source.id, v_batch.id, v_group.revision
  );
  UPDATE public.auto_campaign_data_group_sources
  SET status = 'active', baseline_revision = v_group.revision,
      started_at = COALESCE(started_at, now()), last_ingest_at = now(), updated_at = now()
  WHERE id = v_source.id RETURNING * INTO v_source;
  UPDATE public.auto_campaigns
  SET status = CASE WHEN status = 'hoàn thành' THEN 'chờ xử lý' ELSE status END,
      completed_at = CASE WHEN status = 'hoàn thành' THEN NULL ELSE completed_at END,
      note = CASE WHEN status = 'hoàn thành' THEN 'Chờ data mới' ELSE note END,
      updated_at = now()
  WHERE id = v_campaign.id;
  UPDATE public.auto_data_ingest_batches
  SET status = 'completed', result = to_jsonb(v_source), updated_at = now()
  WHERE id = v_batch.id;
  RETURN to_jsonb(v_source);
END;
$$;

CREATE OR REPLACE FUNCTION public.aka_agent_finalize_data_group_campaign(
  p_staff_id bigint,
  p_organization_id bigint,
  p_campaign_id bigint,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_campaign public.auto_campaigns%ROWTYPE;
  v_source public.auto_campaign_data_group_sources%ROWTYPE;
  v_has_pending boolean;
  v_has_inflight boolean;
  v_before_hard_end boolean;
  v_hard_terminal boolean;
  v_status text;
  v_reason text;
BEGIN
  PERFORM public.aka_agent_internal_require_staff_tenant(p_staff_id, p_organization_id);
  SELECT * INTO v_campaign
  FROM public.auto_campaigns AS campaign
  WHERE campaign.id = p_campaign_id AND campaign.staff_id = p_staff_id
    AND campaign.organization_id = p_organization_id
    AND campaign.data_target_source_mode = 'data_group'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'data_group_campaign_not_found'; END IF;
  SELECT * INTO v_source
  FROM public.auto_campaign_data_group_sources AS source
  WHERE source.campaign_id = v_campaign.id AND source.staff_id = p_staff_id
    AND source.organization_id = p_organization_id
  FOR UPDATE;

  SELECT EXISTS (
    SELECT 1 FROM public.auto_campaign_input_data AS input_data
    WHERE input_data.campaign_id = v_campaign.id
      AND COALESCE(input_data.is_delete, false) = false
      AND input_data.status = 'chờ xử lý'
  ), EXISTS (
    SELECT 1 FROM public.auto_campaign_input_data AS input_data
    WHERE input_data.campaign_id = v_campaign.id
      AND COALESCE(input_data.is_delete, false) = false
      AND input_data.status = 'đang chạy'
  ) INTO v_has_pending, v_has_inflight;
  v_before_hard_end := NOT COALESCE(v_campaign.is_delete, false)
    AND (v_campaign.schedule_end_date IS NULL OR v_campaign.schedule_end_date > now());
  v_hard_terminal := COALESCE(v_campaign.is_delete, false)
    OR (v_campaign.schedule_end_date IS NOT NULL AND v_campaign.schedule_end_date <= now())
    OR v_campaign.status = 'hoàn thành';

  -- Hard terminal state wins over the ordinary pending-input race.  No new
  -- target may start after delete/end/explicit completion; an already-running
  -- target is allowed to finish and the next finalize call completes cleanup.
  IF v_hard_terminal THEN
    IF v_source.id IS NOT NULL AND v_source.status <> 'stopped' THEN
      UPDATE public.auto_campaign_data_group_sources
      SET status = 'stopped', stopped_at = COALESCE(stopped_at, now()),
          stop_reason = COALESCE(stop_reason, CASE
            WHEN COALESCE(v_campaign.is_delete, false) THEN 'campaign_deleted'
            WHEN v_campaign.status = 'hoàn thành' THEN 'campaign_completed'
            ELSE 'hard_end_reached'
          END),
          updated_at = now()
      WHERE id = v_source.id;
    END IF;
    UPDATE public.auto_campaign_input_data
    SET status = 'hoàn thành',
        note = COALESCE(note, CASE
          WHEN COALESCE(v_campaign.is_delete, false) THEN 'Chiến dịch đã bị xoá'
          WHEN v_campaign.status = 'hoàn thành' THEN 'Chiến dịch đã hoàn thành'
          ELSE 'Chiến dịch đã hết hạn'
        END),
        date_action = COALESCE(date_action, now())
    WHERE campaign_id = v_campaign.id
      AND COALESCE(is_delete, false) = false
      AND status = 'chờ xử lý';
    v_has_pending := false;

    IF v_has_inflight THEN
      RETURN jsonb_build_object(
        'completed', false, 'status', v_campaign.status,
        'reason', 'terminal_input_inflight'
      );
    END IF;

    UPDATE public.auto_campaigns
    SET status = 'hoàn thành',
        note = COALESCE(NULLIF(btrim(COALESCE(p_note, '')), ''), note),
        completed_at = COALESCE(completed_at, now()), updated_at = now()
    WHERE id = v_campaign.id;
    RETURN jsonb_build_object(
      'completed', true, 'status', 'hoàn thành',
      'reason', CASE
        WHEN COALESCE(v_campaign.is_delete, false) THEN 'campaign_deleted'
        WHEN v_campaign.status = 'hoàn thành' THEN 'campaign_completed'
        ELSE 'hard_end_reached'
      END
    );
  END IF;

  -- Durable client pause wins every finalize race.
  IF v_campaign.status = 'tạm dừng' THEN
    RETURN jsonb_build_object(
      'completed', false, 'status', v_campaign.status, 'reason', 'paused'
    );
  END IF;
  IF v_has_inflight THEN
    RETURN jsonb_build_object(
      'completed', false, 'status', v_campaign.status, 'reason', 'input_inflight'
    );
  END IF;

  IF v_has_pending THEN
    v_status := 'chờ xử lý';
    v_reason := 'pending_input_raced';
    UPDATE public.auto_campaigns
    SET status = v_status,
        note = NULLIF(btrim(COALESCE(p_note, '')), ''),
        completed_at = NULL,
        updated_at = now()
    WHERE id = v_campaign.id AND status <> 'tạm dừng';
  ELSIF v_source.id IS NOT NULL AND v_source.status IN ('baselining', 'active')
    AND v_before_hard_end THEN
    v_status := 'chờ xử lý';
    v_reason := 'active_source_waiting';
    UPDATE public.auto_campaigns
    SET status = v_status, note = 'Chờ data mới', completed_at = NULL, updated_at = now()
    WHERE id = v_campaign.id AND status <> 'tạm dừng';
  ELSE
    v_status := 'hoàn thành';
    v_reason := CASE
      WHEN COALESCE(v_campaign.is_delete, false) THEN 'campaign_deleted'
      WHEN NOT v_before_hard_end THEN 'hard_end_reached'
      WHEN v_source.id IS NULL THEN 'source_missing'
      ELSE 'source_stopped_and_drained'
    END;
    UPDATE public.auto_campaigns
    SET status = v_status,
        note = COALESCE(NULLIF(btrim(COALESCE(p_note, '')), ''), note),
        completed_at = COALESCE(completed_at, now()),
        updated_at = now()
    WHERE id = v_campaign.id AND status <> 'tạm dừng';
  END IF;

  SELECT status INTO v_status FROM public.auto_campaigns WHERE id = v_campaign.id;
  RETURN jsonb_build_object(
    'completed', v_status = 'hoàn thành', 'status', v_status, 'reason', v_reason
  );
END;
$$;

-- Scheduler barrier: hard-end cleanup must not depend on whether an account is
-- currently eligible or whether the campaign is runnable.  Lock candidate
-- campaigns in deterministic order and let the single-campaign finalizer close
-- intake, settle pending rows, and leave any in-flight row to finish.
CREATE OR REPLACE FUNCTION public.aka_agent_finalize_expired_data_group_campaigns(
  p_staff_id bigint,
  p_organization_id bigint,
  p_limit integer DEFAULT 200
)
RETURNS TABLE (
  campaign_id bigint,
  campaign_status text,
  result jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_candidate record;
  v_result jsonb;
  v_limit integer := COALESCE(p_limit, 200);
BEGIN
  PERFORM public.aka_agent_internal_require_staff_tenant(
    p_staff_id, p_organization_id
  );
  IF v_limit NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'invalid_expired_data_group_campaign_limit';
  END IF;

  FOR v_candidate IN
    SELECT campaign.id
    FROM public.auto_campaigns AS campaign
    JOIN public.auto_campaign_data_group_sources AS source
      ON source.campaign_id = campaign.id
     AND source.staff_id = p_staff_id
     AND source.organization_id = p_organization_id
    WHERE campaign.staff_id = p_staff_id
      AND campaign.organization_id = p_organization_id
      AND campaign.data_target_source_mode = 'data_group'
      AND campaign.schedule_end_date IS NOT NULL
      AND campaign.schedule_end_date <= now()
      AND (
        campaign.status <> 'hoàn thành'
        OR EXISTS (
          SELECT 1
          FROM public.auto_campaign_input_data AS pending_input
          WHERE pending_input.campaign_id = campaign.id
            AND COALESCE(pending_input.is_delete, false) = false
            AND pending_input.status IN ('chờ xử lý', 'đang chạy')
        )
      )
    ORDER BY campaign.schedule_end_date, campaign.id
    FOR UPDATE OF campaign SKIP LOCKED
    LIMIT v_limit
  LOOP
    v_result := public.aka_agent_finalize_data_group_campaign(
      p_staff_id,
      p_organization_id,
      v_candidate.id,
      'Chiến dịch đã hết hạn'
    );
    campaign_id := v_candidate.id;
    campaign_status := v_result ->> 'status';
    result := v_result;
    RETURN NEXT;
  END LOOP;
END;
$$;

-- Keep the current v182 runtime ownership semantics and add only provisioning
-- and due-input guards. Direct campaigns retain their previous claim behavior.
CREATE OR REPLACE FUNCTION public.claim_campaign_runtime(
  p_campaign_id bigint,
  p_account_id bigint,
  p_staff_id bigint,
  p_runtime_target text
)
RETURNS boolean
LANGUAGE plpgsql
SET search_path TO public
AS $$
DECLARE
  v_campaign public.auto_campaigns%ROWTYPE;
  v_account public.auto_accounts%ROWTYPE;
  v_organization_id bigint;
  v_runtime_target text := lower(btrim(COALESCE(p_runtime_target, '')));
  v_mode record;
  v_is_zalo boolean;
  v_is_web boolean;
BEGIN
  IF p_campaign_id IS NULL OR p_campaign_id <= 0
    OR p_account_id IS NULL OR p_account_id <= 0
    OR p_staff_id IS NULL OR p_staff_id <= 0
  THEN RAISE EXCEPTION 'Campaign, account and staff IDs must be positive integers'; END IF;
  IF v_runtime_target NOT IN ('desktop', 'server') THEN
    RAISE EXCEPTION 'Runtime target must be desktop or server';
  END IF;

  SELECT staff.organization_id INTO v_organization_id
  FROM public.org_staff AS staff
  WHERE staff.id = p_staff_id AND staff.is_active = true
  FOR SHARE OF staff;
  IF NOT FOUND OR v_organization_id IS NULL THEN RETURN false; END IF;

  PERFORM pg_advisory_xact_lock_shared(
    hashtextextended('aka-agent-zalo-runtime-entitlement-mutation', 0)
  );
  SELECT * INTO v_mode
  FROM public.resolve_organization_zalo_runtime_mode(v_organization_id);

  SELECT campaign.* INTO v_campaign
  FROM public.auto_campaigns AS campaign
  WHERE campaign.id = p_campaign_id
    AND campaign.staff_id = p_staff_id
    AND campaign.account_id = p_account_id
  FOR UPDATE OF campaign;
  IF NOT FOUND THEN RETURN false; END IF;

  SELECT account.* INTO v_account
  FROM public.auto_accounts AS account
  WHERE account.id = p_account_id AND account.staff_id = p_staff_id
  FOR UPDATE OF account;
  IF NOT FOUND THEN RETURN false; END IF;

  IF v_campaign.data_target_source_mode = 'data_group'
    AND v_campaign.schedule_end_date IS NOT NULL
    AND v_campaign.schedule_end_date <= now()
  THEN
    PERFORM public.aka_agent_finalize_data_group_campaign(
      p_staff_id, v_organization_id, v_campaign.id, 'Chiến dịch đã hết hạn'
    );
    RETURN false;
  END IF;

  IF COALESCE(v_campaign.is_delete, false)
    OR v_campaign.status <> 'chờ xử lý'
    OR v_campaign.schedule IS NULL
    OR v_campaign.schedule > now()
    OR COALESCE(v_campaign.provisioning_state, 'ready') <> 'ready'
    OR (
      v_campaign.data_target_source_mode = 'data_group'
      AND NOT EXISTS (
        SELECT 1
        FROM public.auto_campaign_input_data AS input_data
        WHERE input_data.campaign_id = v_campaign.id
          AND COALESCE(input_data.is_delete, false) = false
          AND input_data.status = 'chờ xử lý'
          AND (input_data.schedule IS NULL OR input_data.schedule <= now())
      )
    )
    OR (v_campaign.daily_stop_time IS NOT NULL
      AND v_campaign.daily_stop_time < (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::time)
    OR COALESCE(v_account.is_delete, false)
    OR v_account.is_active IS NOT TRUE
    OR v_account.status <> 'chờ xử lý'
    OR v_account.login_status <> 'đã đăng nhập'
  THEN RETURN false; END IF;

  v_is_zalo := lower(btrim(COALESCE(v_account.flatform_type, ''))) = 'zalo';
  v_is_web := COALESCE(v_account.is_zalo_show_web, false);

  IF v_runtime_target = 'server' THEN
    IF NOT v_is_zalo OR v_is_web
      OR NOT COALESCE(v_mode.qr_enabled, false)
      OR NOT COALESCE(v_mode.is_zalo_server, false)
    THEN RETURN false; END IF;
  ELSIF v_is_zalo AND (
    (v_is_web AND NOT COALESCE(v_mode.web_enabled, false))
    OR (NOT v_is_web AND (
      NOT COALESCE(v_mode.qr_enabled, false)
      OR COALESCE(v_mode.is_zalo_server, false)
    ))
  ) THEN RETURN false; END IF;

  UPDATE public.auto_campaigns
  SET status = 'đang chạy', note = NULL, updated_at = now()
  WHERE id = p_campaign_id;
  UPDATE public.auto_accounts
  SET status = 'đang chạy', updated_at = now()
  WHERE id = p_account_id;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.aka_agent_guard_campaign_data_group_identity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO public
AS $$
BEGIN
  IF (NEW.data_target_source_mode IS DISTINCT FROM OLD.data_target_source_mode
      OR NEW.data_group_id IS DISTINCT FROM OLD.data_group_id)
    AND EXISTS (
      SELECT 1 FROM public.auto_campaign_input_data AS input_data
      WHERE input_data.campaign_id = OLD.id
        AND input_data.canonical_target_key IS NOT NULL
        AND COALESCE(input_data.is_delete, false) = false
    ) THEN
    RAISE EXCEPTION 'campaign_data_group_identity_immutable_after_intake';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_aka_agent_guard_campaign_data_group_identity
  ON public.auto_campaigns;
CREATE TRIGGER trg_aka_agent_guard_campaign_data_group_identity
BEFORE UPDATE OF data_target_source_mode, data_group_id
ON public.auto_campaigns
FOR EACH ROW
EXECUTE FUNCTION public.aka_agent_guard_campaign_data_group_identity();

CREATE OR REPLACE FUNCTION public.aka_agent_close_terminal_campaign_data_group_source()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO public
AS $$
BEGIN
  IF NEW.data_target_source_mode = 'data_group' AND (
    (COALESCE(NEW.is_delete, false) AND NOT COALESCE(OLD.is_delete, false))
    OR (NEW.status = 'hoàn thành' AND OLD.status IS DISTINCT FROM 'hoàn thành')
    OR (NEW.schedule_end_date IS NOT NULL AND NEW.schedule_end_date <= now()
      AND OLD.schedule_end_date IS DISTINCT FROM NEW.schedule_end_date)
  ) THEN
    UPDATE public.auto_campaign_data_group_sources
    SET status = 'stopped', stopped_at = COALESCE(stopped_at, now()),
        stop_reason = CASE
          WHEN COALESCE(NEW.is_delete, false) THEN 'campaign_deleted'
          WHEN NEW.schedule_end_date IS NOT NULL AND NEW.schedule_end_date <= now() THEN 'hard_end_reached'
          ELSE 'campaign_completed'
        END,
        updated_at = now()
    WHERE campaign_id = NEW.id AND status IN ('baselining', 'active');

    IF COALESCE(NEW.is_delete, false)
      OR (NEW.schedule_end_date IS NOT NULL AND NEW.schedule_end_date <= now()) THEN
      UPDATE public.auto_campaign_input_data
      SET status = 'hoàn thành',
          note = COALESCE(note, 'Hết hạn nguồn Nhóm data'),
          date_action = COALESCE(date_action, now())
      WHERE campaign_id = NEW.id AND COALESCE(is_delete, false) = false
        AND status = 'chờ xử lý';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_aka_agent_close_deleted_campaign_data_group_source
  ON public.auto_campaigns;
DROP TRIGGER IF EXISTS trg_aka_agent_close_terminal_campaign_data_group_source
  ON public.auto_campaigns;
CREATE TRIGGER trg_aka_agent_close_terminal_campaign_data_group_source
AFTER UPDATE OF is_delete, status, schedule_end_date
ON public.auto_campaigns
FOR EACH ROW
EXECUTE FUNCTION public.aka_agent_close_terminal_campaign_data_group_source();

CREATE OR REPLACE FUNCTION public.aka_agent_guard_campaign_data_group_source_identity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO public
AS $$
BEGIN
  IF NEW.campaign_id IS DISTINCT FROM OLD.campaign_id THEN
    RAISE EXCEPTION 'campaign_data_group_source_identity_immutable';
  END IF;
  IF NEW.group_id IS DISTINCT FROM OLD.group_id AND EXISTS (
    SELECT 1 FROM public.auto_campaign_input_data AS input_data
    WHERE input_data.campaign_id = OLD.campaign_id
      AND input_data.canonical_target_key IS NOT NULL
      AND COALESCE(input_data.is_delete, false) = false
  ) THEN
    RAISE EXCEPTION 'campaign_data_group_source_immutable_after_intake';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_aka_agent_guard_campaign_data_group_source_identity
  ON public.auto_campaign_data_group_sources;
CREATE TRIGGER trg_aka_agent_guard_campaign_data_group_source_identity
BEFORE UPDATE OF campaign_id, group_id
ON public.auto_campaign_data_group_sources
FOR EACH ROW
EXECUTE FUNCTION public.aka_agent_guard_campaign_data_group_source_identity();

-- ---------------------------------------------------------------------------
-- 8. Optional automation destination (legacy A -> B remains authoritative)
-- ---------------------------------------------------------------------------

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
BEGIN
  IF p_target_data_group_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.auto_account_contact_groups AS contact_group
    WHERE contact_group.id = p_target_data_group_id
      AND contact_group.staff_id = p_staff_id
      AND contact_group.organization_id = p_organization_id
      AND contact_group.purpose = 'data_group'
      AND contact_group.is_delete = false
  ) THEN
    RAISE EXCEPTION 'invalid_target_data_group';
  END IF;

  -- Delegate the established v177 validation/status/scheduling contract to the
  -- old overload; only the optional shared destination is new here.
  v_saved := public.aka_agent_save_automation(
    p_staff_id, p_organization_id, p_automation_id, p_name,
    p_source_campaign_id, p_target_campaign_id, p_data_type_code,
    p_target_contact_group_id, p_schedule_mode, p_delay_days, p_delay_hours,
    p_fixed_at, p_note, p_is_active, p_trigger_statuses,
    p_auth_username, p_auth_password, p_delay_value, p_delay_unit,
    p_daily_time, p_delay_exact_time, p_delay_exact_time_present
  );
  v_rule_id := NULLIF(v_saved ->> 'id', '')::bigint;
  IF v_rule_id IS NULL THEN RAISE EXCEPTION 'automation_save_failed'; END IF;

  UPDATE public.auto_automation
  SET target_data_group_id = p_target_data_group_id, updated_at = clock_timestamp()
  WHERE id = v_rule_id AND staff_id = p_staff_id AND organization_id = p_organization_id;

  RETURN public.auto_automation_to_json(v_rule_id, p_staff_id, p_organization_id);
END;
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
      'target_data_group_name', target_data_group.name,
      'source_campaign', jsonb_build_object(
        'id', source_campaign.id, 'name', source_campaign.name,
        'action_id', source_campaign.action_id, 'action_name', source_action.name,
        'account_id', source_campaign.account_id, 'account_name', source_account.name,
        'flatform_type', source_action.flatform_type
      ),
      'target_campaign', jsonb_build_object(
        'id', target_campaign.id, 'name', target_campaign.name,
        'action_id', target_campaign.action_id, 'action_name', target_action.name,
        'account_id', target_campaign.account_id, 'account_name', target_account.name,
        'flatform_type', target_action.flatform_type
      ),
      'target_contact_group', CASE WHEN target_group.id IS NULL THEN NULL ELSE jsonb_build_object(
        'id', target_group.id, 'name', target_group.name,
        'contact_type', target_group.contact_type, 'purpose', target_group.purpose
      ) END,
      'trigger_statuses', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', trigger_status.id,
          'status_mapping_id', trigger_status.status_mapping_id,
          'semantic_status_id', status_mapping.status_id,
          'action_code', trigger_status.action_code,
          'action_name', account_action.name,
          'is_wildcard', trigger_status.action_code IS NULL,
          'status_value', trigger_status.status_value,
          'status_label', COALESCE(status_mapping.label, trigger_status.status_value)
        ) ORDER BY lower(trigger_status.status_value), status_mapping.sort_order, trigger_status.id)
        FROM public.auto_automation_trigger_statuses AS trigger_status
        JOIN public.auto_campaign_action_detail_statuses AS status_mapping
          ON status_mapping.id = trigger_status.status_mapping_id
        LEFT JOIN public.auto_account_actions AS account_action
          ON account_action.code = trigger_status.action_code
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
  JOIN public.auto_automation_actions AS automation_action ON automation_action.id = automation.automation_action_id
  JOIN public.auto_automation_data_types AS data_type ON data_type.code = automation.data_type_code
  JOIN public.auto_campaigns AS source_campaign ON source_campaign.id = automation.source_campaign_id
  JOIN public.auto_campaign_actions AS source_action ON source_action.id = source_campaign.action_id
  JOIN public.auto_accounts AS source_account ON source_account.id = source_campaign.account_id
  JOIN public.auto_campaigns AS target_campaign ON target_campaign.id = automation.target_campaign_id
  JOIN public.auto_campaign_actions AS target_action ON target_action.id = target_campaign.action_id
  JOIN public.auto_accounts AS target_account ON target_account.id = target_campaign.account_id
  LEFT JOIN public.auto_account_contact_groups AS target_group
    ON target_group.id = automation.target_contact_group_id
  LEFT JOIN public.auto_account_contact_groups AS target_data_group
    ON target_data_group.id = automation.target_data_group_id
   AND target_data_group.purpose = 'data_group' AND target_data_group.is_delete = false
  LEFT JOIN LATERAL (
    SELECT
      count(*)::integer AS total,
      count(*) FILTER (WHERE detail.status = 'chờ xử lý')::integer AS queued,
      count(*) FILTER (WHERE detail.status = 'đang xử lý')::integer AS processing,
      count(*) FILTER (WHERE detail.status = 'đã thêm')::integer AS materialized,
      count(*) FILTER (WHERE detail.status = 'bỏ qua')::integer AS skipped,
      count(*) FILTER (WHERE detail.status = 'lỗi')::integer AS failed
    FROM public.auto_automation_detail AS detail WHERE detail.automation_id = automation.id
  ) AS execution_count ON true
  LEFT JOIN LATERAL (
    SELECT detail.status, detail.created_at, detail.processed_at
    FROM public.auto_automation_detail AS detail
    WHERE detail.automation_id = automation.id
    ORDER BY detail.created_at DESC, detail.id DESC LIMIT 1
  ) AS latest_execution ON true
  WHERE automation.id = p_automation_id
    AND automation.staff_id = p_staff_id
    AND automation.organization_id = p_organization_id;
$$;

CREATE OR REPLACE FUNCTION public.aka_agent_snapshot_automation_data_group()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT automation.target_data_group_id INTO NEW.target_data_group_id
    FROM public.auto_automation AS automation
    WHERE automation.id = NEW.automation_id;
    NEW.target_data_group_sync_status := CASE
      WHEN NEW.target_data_group_id IS NULL THEN NULL ELSE 'pending' END;
    NEW.config_snapshot := COALESCE(NEW.config_snapshot, '{}'::jsonb)
      || jsonb_build_object('target_data_group_id', NEW.target_data_group_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_aka_agent_snapshot_automation_data_group
  ON public.auto_automation_detail;
CREATE TRIGGER trg_aka_agent_snapshot_automation_data_group
BEFORE INSERT ON public.auto_automation_detail
FOR EACH ROW EXECUTE FUNCTION public.aka_agent_snapshot_automation_data_group();

-- materialize_auto_automation_detail is intentionally left intact: v174 owns
-- its transactional A -> B contract.  This AFTER INSERT reservation runs while
-- that function still holds the target campaign row lock, projects its direct
-- row into the same canonical ledger as group intake, and keeps the newly
-- inserted row as a soft-deleted audit row when a canonical target already
-- exists.  The detail trigger below then points the execution at the winning
-- active input.
CREATE OR REPLACE FUNCTION public.aka_agent_reserve_automation_data_group_input()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_campaign public.auto_campaigns%ROWTYPE;
  v_action text;
  v_scope text;
  v_target_kind text;
  v_target_value text;
  v_identity_value text;
  v_candidate_key text;
  v_canonical_key text;
  v_phone text;
  v_email text;
  v_mapped_keys text[] := '{}'::text[];
  v_winner_id bigint;
  v_group_revision bigint := 0;
  v_payload jsonb;
BEGIN
  IF NEW.auto_automation_detail_id IS NULL THEN RETURN NEW; END IF;

  SELECT campaign.* INTO v_campaign
  FROM public.auto_campaigns AS campaign
  WHERE campaign.id = NEW.campaign_id
  FOR UPDATE;
  IF NOT FOUND OR v_campaign.data_target_source_mode <> 'data_group'
    OR v_campaign.data_group_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_action := btrim(COALESCE(v_campaign.action_id, ''));
  v_phone := NULLIF(public.aka_agent_internal_normalize_phone(COALESCE(NEW.phone, '')), '');
  v_email := NULLIF(lower(btrim(COALESCE(NEW.email, ''))), '');
  IF v_email IS NOT NULL AND (
    v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    OR length(v_email) > 254
  ) THEN v_email := NULL; END IF;

  IF v_action IN ('facebook_group_post', 'facebook_join_group', 'facebook_find_data_group') THEN
    v_target_kind := 'facebook_group';
    v_target_value := NULLIF(btrim(COALESCE(NEW.uid, '')), '');
    v_scope := 'portable';
  ELSIF v_action = 'facebook_message_uid' THEN
    v_target_kind := 'facebook_person';
    v_target_value := NULLIF(btrim(COALESCE(NEW.uid, '')), '');
    v_scope := 'portable';
  ELSIF v_action = 'facebook_find_data_search' THEN
    v_target_kind := 'facebook_search';
    v_target_value := NULLIF(btrim(COALESCE(NEW.uid, '')), '');
    v_scope := 'portable';
  ELSIF v_action IN ('facebook_comment_seeding', 'facebook_comment_seeding_post') THEN
    v_target_kind := CASE WHEN v_action = 'facebook_comment_seeding_post'
      THEN 'facebook_post' ELSE 'facebook_comment_target' END;
    v_target_value := NULLIF(btrim(COALESCE(NEW.uid, '')), '');
    v_scope := 'portable';
  ELSIF v_action = 'zalo_message_phone' THEN
    v_target_kind := 'phone'; v_target_value := v_phone; v_scope := 'portable';
  ELSIF v_action = 'zalo_join_group_link' THEN
    v_target_kind := 'zalo_group_link';
    v_target_value := NULLIF(btrim(COALESCE(NEW.uid, '')), '');
    v_scope := 'portable';
  ELSIF v_action = 'email_send' THEN
    v_target_kind := 'email'; v_target_value := v_email; v_scope := 'portable';
  ELSIF v_action IN ('facebook_message_friend', 'facebook_group_invite') THEN
    v_target_kind := 'facebook_person';
    v_target_value := NULLIF(btrim(COALESCE(NEW.uid, '')), '');
    v_scope := 'bound:' || v_campaign.account_id::text;
  ELSIF v_action = 'facebook_page_post' THEN
    v_target_kind := 'facebook_page';
    v_target_value := NULLIF(btrim(COALESCE(NEW.uid, '')), '');
    v_scope := 'bound:' || v_campaign.account_id::text;
  ELSIF v_action IN (
    'zalo_message_friend', 'zalo_message_group_member',
    'zalo_message_remarketing_customer'
  ) THEN
    v_target_kind := 'zalo_person';
    v_target_value := NULLIF(btrim(COALESCE(NEW.uid, '')), '');
    v_scope := 'bound:' || v_campaign.account_id::text;
  ELSIF v_action = 'zalo_message_group' THEN
    v_target_kind := 'zalo_group';
    v_target_value := NULLIF(btrim(COALESCE(NEW.uid, '')), '');
    v_scope := 'bound:' || v_campaign.account_id::text;
  ELSIF v_action = 'zalo_add_group_member' THEN
    IF v_phone IS NOT NULL THEN
      v_target_kind := 'phone'; v_target_value := v_phone; v_scope := 'portable';
      UPDATE public.auto_campaign_input_data SET uid = '' WHERE id = NEW.id;
    ELSE
      v_target_kind := 'zalo_person';
      v_target_value := NULLIF(btrim(COALESCE(NEW.uid, '')), '');
      v_scope := 'bound:' || v_campaign.account_id::text;
    END IF;
  ELSE
    RETURN NEW;
  END IF;

  IF v_target_value IS NULL THEN RETURN NEW; END IF;
  v_identity_value := CASE
    WHEN v_target_kind LIKE 'facebook_%'
      THEN public.aka_agent_internal_normalize_facebook_identity(v_target_value)
    WHEN v_target_kind = 'email' THEN lower(v_target_value)
    ELSE v_target_value
  END;
  IF NULLIF(v_identity_value, '') IS NULL THEN RETURN NEW; END IF;
  v_candidate_key := v_scope || ':' || v_target_kind || ':' || v_identity_value;

  SELECT COALESCE(array_agg(DISTINCT alias.canonical_target_key), '{}'::text[])
  INTO v_mapped_keys
  FROM public.auto_campaign_input_target_aliases AS alias
  WHERE alias.campaign_id = v_campaign.id AND alias.alias_key = v_candidate_key;

  SELECT COALESCE(contact_group.revision, 0) INTO v_group_revision
  FROM public.auto_account_contact_groups AS contact_group
  WHERE contact_group.id = v_campaign.data_group_id;
  v_group_revision := COALESCE(v_group_revision, 0);
  v_payload := jsonb_strip_nulls(jsonb_build_object(
    'name', NEW.name, 'phone', NEW.phone, 'phone_carrier', NEW.phone_carrier,
    'uid', NEW.uid, 'email', NEW.email,
    'info1', NEW.info1, 'info2', NEW.info2, 'info3', NEW.info3,
    'info4', NEW.info4, 'info5', NEW.info5,
    'automation_detail_id', NEW.auto_automation_detail_id,
    'canonical_target_key', v_candidate_key
  ));

  IF cardinality(v_mapped_keys) > 1 OR (
    cardinality(v_mapped_keys) = 1
    AND v_target_kind NOT LIKE 'facebook_%'
    AND v_mapped_keys[1] IS DISTINCT FROM v_candidate_key
  ) THEN
    UPDATE public.auto_campaign_input_target_aliases AS alias
    SET conflict_count = alias.conflict_count + 1,
        last_conflict_at = now(),
        last_conflict_payload = jsonb_build_object(
          'automationDetailId', NEW.auto_automation_detail_id,
          'candidateCanonicalKey', v_candidate_key,
          'mappedCanonicalKeys', to_jsonb(v_mapped_keys)
        ),
        updated_at = now()
    WHERE alias.campaign_id = v_campaign.id AND alias.alias_key = v_candidate_key;
    UPDATE public.auto_campaign_input_data
    SET canonical_target_key = v_candidate_key,
        is_delete = true,
        status = 'hoàn thành',
        note = COALESCE(note, 'Xung đột định danh canonical; không tự gộp'),
        date_action = COALESCE(date_action, now())
    WHERE id = NEW.id;
    INSERT INTO public.auto_campaign_input_origins (
      input_data_id, source_id, group_id, membership_id, batch_id,
      origin_kind, automation_detail_id, group_revision,
      canonical_target_key, payload_snapshot
    ) VALUES (
      NEW.id, NULL, v_campaign.data_group_id, NULL, NULL,
      'automation', NEW.auto_automation_detail_id, v_group_revision,
      v_candidate_key, v_payload
    ) ON CONFLICT DO NOTHING;
    RETURN NEW;
  END IF;

  -- A single Facebook mapping may have been proven earlier by one contact row
  -- carrying both UID and URL. Reuse that sole mapping; disagreement between
  -- two mapped aliases was rejected above.
  v_canonical_key := CASE
    WHEN v_target_kind LIKE 'facebook_%' AND cardinality(v_mapped_keys) = 1
      THEN v_mapped_keys[1]
    ELSE v_candidate_key
  END;

  SELECT input_data.id INTO v_winner_id
  FROM public.auto_campaign_input_data AS input_data
  WHERE input_data.campaign_id = v_campaign.id
    AND input_data.canonical_target_key = v_canonical_key
    AND COALESCE(input_data.is_delete, false) = false
    AND input_data.id <> NEW.id
  ORDER BY input_data.id
  LIMIT 1
  FOR UPDATE;

  IF v_winner_id IS NULL THEN
    v_winner_id := NEW.id;
    UPDATE public.auto_campaign_input_data
    SET canonical_target_key = v_canonical_key
    WHERE id = NEW.id;
  ELSE
    UPDATE public.auto_campaign_input_data
    SET canonical_target_key = v_canonical_key,
        is_delete = true,
        status = 'hoàn thành',
        note = COALESCE(note, 'Đã gộp vào target canonical #' || v_winner_id::text),
        date_action = COALESCE(date_action, now())
    WHERE id = NEW.id;
  END IF;

  INSERT INTO public.auto_campaign_input_target_aliases (
    campaign_id, alias_key, canonical_target_key, input_data_id
  ) VALUES (
    v_campaign.id, v_candidate_key, v_canonical_key, v_winner_id
  )
  ON CONFLICT (campaign_id, alias_key) DO UPDATE
  SET input_data_id = EXCLUDED.input_data_id, updated_at = now()
  WHERE auto_campaign_input_target_aliases.canonical_target_key = EXCLUDED.canonical_target_key;

  INSERT INTO public.auto_campaign_input_origins (
    input_data_id, source_id, group_id, membership_id, batch_id,
    origin_kind, automation_detail_id, group_revision,
    canonical_target_key, payload_snapshot
  ) VALUES (
    v_winner_id, NULL, v_campaign.data_group_id, NULL, NULL,
    'automation', NEW.auto_automation_detail_id, v_group_revision,
    v_canonical_key, v_payload || jsonb_build_object(
      'canonical_target_key', v_canonical_key
    )
  ) ON CONFLICT DO NOTHING;
  UPDATE public.auto_campaigns
  SET note = NULL, updated_at = now()
  WHERE id = v_campaign.id
    AND note IN ('Chờ data phù hợp', 'Chờ data mới');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_aka_agent_reserve_automation_data_group_input
  ON public.auto_campaign_input_data;
CREATE TRIGGER trg_aka_agent_reserve_automation_data_group_input
AFTER INSERT ON public.auto_campaign_input_data
FOR EACH ROW
WHEN (NEW.auto_automation_detail_id IS NOT NULL)
EXECUTE FUNCTION public.aka_agent_reserve_automation_data_group_input();

CREATE OR REPLACE FUNCTION public.aka_agent_resolve_automation_canonical_input()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO public
AS $$
DECLARE
  v_input_id bigint;
BEGIN
  IF NEW.status = 'đã thêm' AND OLD.status IS DISTINCT FROM 'đã thêm' THEN
    SELECT origin.input_data_id INTO v_input_id
    FROM public.auto_campaign_input_origins AS origin
    WHERE origin.origin_kind = 'automation'
      AND origin.automation_detail_id = NEW.id
    ORDER BY origin.created_at DESC, origin.id DESC
    LIMIT 1;
    IF v_input_id IS NOT NULL THEN NEW.target_input_data_id := v_input_id; END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_aka_agent_resolve_automation_canonical_input
  ON public.auto_automation_detail;
CREATE TRIGGER trg_aka_agent_resolve_automation_canonical_input
BEFORE UPDATE OF status, target_input_data_id ON public.auto_automation_detail
FOR EACH ROW
EXECUTE FUNCTION public.aka_agent_resolve_automation_canonical_input();

UPDATE public.auto_automation_detail AS detail
SET target_data_group_id = automation.target_data_group_id,
    target_data_group_sync_status = CASE
      WHEN automation.target_data_group_id IS NULL THEN NULL
      WHEN detail.target_data_group_member_id IS NOT NULL THEN 'completed'
      ELSE 'pending' END
FROM public.auto_automation AS automation
WHERE automation.id = detail.automation_id
  AND detail.target_data_group_id IS NULL
  AND automation.target_data_group_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.aka_agent_ingest_automation_data_group_result(
  p_staff_id bigint,
  p_organization_id bigint,
  p_automation_detail_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_detail public.auto_automation_detail%ROWTYPE;
  v_group public.auto_account_contact_groups%ROWTYPE;
  v_account public.auto_accounts%ROWTYPE;
  v_ingest jsonb;
  v_member_id bigint;
  v_contact_type text;
  v_row jsonb;
  v_request_id text;
BEGIN
  PERFORM public.aka_agent_internal_require_staff_tenant(p_staff_id, p_organization_id);
  SELECT * INTO v_detail
  FROM public.auto_automation_detail AS detail
  WHERE detail.id = p_automation_detail_id
    AND detail.staff_id = p_staff_id AND detail.organization_id = p_organization_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('code', 'skipped', 'reason', 'automation_detail_not_found');
  END IF;
  IF v_detail.target_data_group_id IS NULL THEN
    RETURN jsonb_build_object(
      'code', 'skipped', 'reason', 'no_target_data_group',
      'automation_detail_id', v_detail.id
    );
  END IF;
  IF v_detail.target_data_group_sync_status IN ('completed', 'skipped') THEN
    RETURN jsonb_build_object(
      'code', v_detail.target_data_group_sync_status,
      'reason', 'already_final',
      'automation_detail_id', v_detail.id,
      'target_data_group_id', v_detail.target_data_group_id,
      'target_data_group_member_id', v_detail.target_data_group_member_id
    );
  END IF;
  IF v_detail.status <> 'đã thêm' OR v_detail.target_input_snapshot IS NULL THEN
    RETURN jsonb_build_object(
      'code', 'pending', 'reason', 'automation_not_materialized',
      'automation_detail_id', v_detail.id
    );
  END IF;

  SELECT * INTO v_group
  FROM public.auto_account_contact_groups AS contact_group
  WHERE contact_group.id = v_detail.target_data_group_id
    AND contact_group.staff_id = p_staff_id
    AND contact_group.organization_id = p_organization_id
    AND contact_group.purpose = 'data_group' AND contact_group.is_delete = false;
  IF NOT FOUND THEN
    UPDATE public.auto_automation_detail
    SET target_data_group_sync_status = 'skipped',
        target_data_group_sync_error = 'data_group_deleted', updated_at = now()
    WHERE id = v_detail.id;
    RETURN jsonb_build_object(
      'code', 'skipped', 'reason', 'data_group_deleted',
      'automation_detail_id', v_detail.id,
      'target_data_group_id', v_detail.target_data_group_id
    );
  END IF;

  SELECT * INTO v_account
  FROM public.auto_accounts AS account
  WHERE account.id = v_detail.target_account_id
    AND account.staff_id = p_staff_id
    AND (account.organization_id IS NULL OR account.organization_id = p_organization_id);
  IF NOT FOUND THEN
    UPDATE public.auto_automation_detail
    SET target_data_group_sync_status = 'failed',
        target_data_group_sync_error = 'target_account_not_found', updated_at = now()
    WHERE id = v_detail.id;
    RETURN jsonb_build_object(
      'code', 'failed', 'reason', 'target_account_not_found',
      'automation_detail_id', v_detail.id
    );
  END IF;

  v_contact_type := COALESCE(
    NULLIF(btrim(v_detail.config_snapshot ->> 'target_contact_type'), ''),
    CASE v_detail.data_type_code WHEN 'phone' THEN 'phone' WHEN 'email' THEN 'email' ELSE 'person' END
  );
  v_row := jsonb_strip_nulls(jsonb_build_object(
    'source_account_id', v_detail.target_account_id,
    'contact_type', v_contact_type,
    'flatform_type', v_account.flatform_type,
    'name', v_detail.target_input_snapshot ->> 'name',
    'uid', v_detail.target_input_snapshot ->> 'uid',
    'url', COALESCE(v_detail.target_input_snapshot ->> 'url', v_detail.target_input_snapshot ->> 'contact_url'),
    'phone', v_detail.target_input_snapshot ->> 'phone',
    'email', v_detail.target_input_snapshot ->> 'email',
    'info1', v_detail.target_input_snapshot ->> 'info1',
    'info2', v_detail.target_input_snapshot ->> 'info2',
    'info3', v_detail.target_input_snapshot ->> 'info3',
    'info4', v_detail.target_input_snapshot ->> 'info4',
    'info5', v_detail.target_input_snapshot ->> 'info5',
    'extra_data', jsonb_build_object(
      'automationDetailId', v_detail.id,
      'sourceCampaignDetailId', v_detail.source_campaign_detail_id,
      'content', v_detail.target_input_snapshot ->> 'content'
    )
  ));
  v_request_id := 'automation-detail:' || v_detail.id::text || ':data-group:v1';

  BEGIN
    v_ingest := public.aka_agent_ingest_data_group(
      p_staff_id, p_organization_id, v_request_id,
      v_detail.target_data_group_id, 'automation', jsonb_build_array(v_row),
      NULL, NULL, NULL, v_detail.target_account_id,
      'Automation #' || v_detail.automation_id::text,
      md5(v_row::text)
    );
  EXCEPTION WHEN OTHERS THEN
    UPDATE public.auto_automation_detail
    SET target_data_group_sync_status = 'failed',
        target_data_group_sync_error = left(SQLERRM, 2000), updated_at = now()
    WHERE id = v_detail.id;
    RETURN jsonb_build_object(
      'code', 'failed', 'reason', 'data_group_ingest_failed',
      'error', left(SQLERRM, 2000), 'automation_detail_id', v_detail.id,
      'target_data_group_id', v_detail.target_data_group_id
    );
  END;

  SELECT member.id INTO v_member_id
  FROM public.auto_data_ingest_batches AS batch
  JOIN public.auto_account_contact_group_member_origins AS origin ON origin.batch_id = batch.id
  JOIN public.auto_account_contact_group_members AS member ON member.id = origin.membership_id
  WHERE batch.staff_id = p_staff_id AND batch.organization_id = p_organization_id
    AND batch.request_id = v_request_id
    AND member.group_id = v_detail.target_data_group_id
  ORDER BY member.id LIMIT 1;

  IF v_member_id IS NULL THEN
    UPDATE public.auto_automation_detail
    SET target_data_group_sync_status = 'failed',
        target_data_group_sync_error = 'automation_data_group_row_invalid', updated_at = now()
    WHERE id = v_detail.id;
    RETURN jsonb_build_object(
      'code', 'failed', 'reason', 'automation_data_group_row_invalid',
      'automation_detail_id', v_detail.id,
      'target_data_group_id', v_detail.target_data_group_id,
      'ingest', v_ingest
    );
  END IF;

  UPDATE public.auto_automation_detail
  SET target_data_group_member_id = v_member_id,
      target_data_group_sync_status = 'completed',
      target_data_group_sync_error = NULL, updated_at = now()
  WHERE id = v_detail.id;
  RETURN jsonb_build_object(
    'code', 'completed',
    'automation_detail_id', v_detail.id,
    'target_data_group_id', v_detail.target_data_group_id,
    'target_data_group_member_id', v_member_id,
    'inserted_membership_count', COALESCE((v_ingest ->> 'inserted_membership_count')::integer, 0),
    'reactivated_membership_count', COALESCE((v_ingest ->> 'reactivated_membership_count')::integer, 0),
    'already_member_count', COALESCE((v_ingest ->> 'already_member_count')::integer, 0),
    'inserted_input_count', COALESCE((v_ingest ->> 'inserted_input_count')::integer, 0),
    'already_seen_input_count', COALESCE((v_ingest ->> 'already_seen_input_count')::integer, 0)
  );
END;
$$;

DROP FUNCTION IF EXISTS public.claim_auto_automation_details(
  bigint, bigint, text, integer, text, text
);

CREATE FUNCTION public.claim_auto_automation_details(
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
    p_staff_id, p_organization_id, p_auth_username, p_auth_password
  );
  IF NULLIF(btrim(COALESCE(p_worker_id, '')), '') IS NULL
    OR length(btrim(p_worker_id)) > 200 THEN
    RAISE EXCEPTION 'invalid_automation_worker_id';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.org_staff AS staff
    WHERE staff.id = p_staff_id AND staff.organization_id = p_organization_id
      AND staff.is_active = true
  ) THEN RAISE EXCEPTION 'inactive_automation_staff'; END IF;

  FOR v_execution IN
    SELECT detail.id, detail.target_campaign_id, detail.target_row_index
    FROM public.auto_automation_detail AS detail
    JOIN public.auto_automation AS automation ON automation.id = detail.automation_id
    WHERE detail.staff_id = p_staff_id
      AND detail.organization_id = p_organization_id
      AND detail.status = 'chờ xử lý'
      AND detail.next_attempt_at <= clock_timestamp()
      AND detail.scheduled_at <= clock_timestamp()
      AND automation.staff_id = p_staff_id
      AND automation.organization_id = p_organization_id
      AND automation.is_active = true AND automation.is_delete = false
    ORDER BY detail.scheduled_at, detail.created_at, detail.id
    FOR UPDATE OF detail SKIP LOCKED
    LIMIT v_limit
  LOOP
    v_row_index := v_execution.target_row_index;
    IF v_row_index IS NULL THEN
      SELECT count(*)::bigint INTO v_existing_input_count
      FROM public.auto_campaign_input_data AS input_data
      WHERE input_data.campaign_id = v_execution.target_campaign_id
        AND COALESCE(input_data.is_delete, false) = false;

      INSERT INTO public.auto_automation_target_counters AS counter (
        target_campaign_id, next_row_index, staff_id, organization_id, updated_at
      ) VALUES (
        v_execution.target_campaign_id, v_existing_input_count + 1,
        p_staff_id, p_organization_id, clock_timestamp()
      )
      ON CONFLICT ON CONSTRAINT auto_automation_target_counters_pkey
      DO UPDATE SET
        next_row_index = GREATEST(counter.next_row_index + 1, EXCLUDED.next_row_index),
        updated_at = clock_timestamp()
      RETURNING counter.next_row_index - 1 INTO v_row_index;
    END IF;

    UPDATE public.auto_automation_detail AS detail
    SET status = 'đang xử lý', target_row_index = v_row_index,
        attempt_count = detail.attempt_count + 1,
        locked_at = clock_timestamp(), locked_by = btrim(p_worker_id),
        last_error = NULL, updated_at = clock_timestamp()
    WHERE detail.id = v_execution.id;

    RETURN QUERY
    SELECT
      claimed.id, claimed.automation_id, claimed.parent_automation_detail_id,
      claimed.source_campaign_detail_id, claimed.source_campaign_input_data_id,
      claimed.source_campaign_id, claimed.source_account_id,
      claimed.source_action_id, claimed.source_action_code, claimed.source_status,
      claimed.target_campaign_id, claimed.target_account_id, claimed.target_action_id,
      claimed.data_type_code, claimed.data_value, claimed.source_input_snapshot,
      claimed.config_snapshot, claimed.target_contact_group_id,
      claimed.target_data_group_id, claimed.scheduled_at,
      claimed.target_row_index, claimed.attempt_count
    FROM public.auto_automation_detail AS claimed WHERE claimed.id = v_execution.id;
  END LOOP;
END;
$$;

-- Extend the existing per-cycle reconciliation without changing its enqueue
-- failure behavior.  Materialized details are durable retry records themselves.
ALTER FUNCTION public.reconcile_auto_automation_enqueue_failures(
  bigint, bigint, text, integer, text, text
) RENAME TO reconcile_auto_automation_enqueue_failures_v185_internal;

CREATE FUNCTION public.reconcile_auto_automation_enqueue_failures(
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
  v_base jsonb;
  v_detail record;
  v_outcome jsonb;
  v_processed integer := 0;
  v_completed integer := 0;
  v_skipped integer := 0;
  v_failed integer := 0;
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500);
BEGIN
  v_base := public.reconcile_auto_automation_enqueue_failures_v185_internal(
    p_staff_id, p_organization_id, p_worker_id, p_limit,
    p_auth_username, p_auth_password
  );

  FOR v_detail IN
    SELECT detail.id
    FROM public.auto_automation_detail AS detail
    WHERE detail.staff_id = p_staff_id AND detail.organization_id = p_organization_id
      AND detail.status = 'đã thêm'
      AND detail.target_data_group_id IS NOT NULL
      AND detail.target_data_group_member_id IS NULL
      AND COALESCE(detail.target_data_group_sync_status, 'pending') IN ('pending', 'failed')
    ORDER BY detail.processed_at, detail.id
    LIMIT v_limit
  LOOP
    v_processed := v_processed + 1;
    v_outcome := public.aka_agent_ingest_automation_data_group_result(
      p_staff_id, p_organization_id, v_detail.id
    );
    CASE v_outcome ->> 'code'
      WHEN 'completed' THEN v_completed := v_completed + 1;
      WHEN 'skipped' THEN v_skipped := v_skipped + 1;
      ELSE v_failed := v_failed + 1;
    END CASE;
  END LOOP;

  RETURN COALESCE(v_base, '{}'::jsonb) || jsonb_build_object(
    'data_group_processed', v_processed,
    'data_group_completed', v_completed,
    'data_group_skipped', v_skipped,
    'data_group_failed', v_failed
  );
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
    p_staff_id, p_organization_id, p_auth_username, p_auth_password
  );
  IF p_status IS NOT NULL
    AND p_status NOT IN ('chờ xử lý', 'đang xử lý', 'đã thêm', 'bỏ qua', 'lỗi') THEN
    RAISE EXCEPTION 'invalid_automation_detail_status';
  END IF;
  IF p_automation_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.auto_automation AS automation
    WHERE automation.id = p_automation_id AND automation.staff_id = p_staff_id
      AND automation.organization_id = p_organization_id
  ) THEN RAISE EXCEPTION 'automation_not_found'; END IF;

  SELECT count(*)::integer INTO v_total
  FROM public.auto_automation_detail AS detail
  WHERE detail.staff_id = p_staff_id AND detail.organization_id = p_organization_id
    AND (p_automation_id IS NULL OR detail.automation_id = p_automation_id)
    AND (p_status IS NULL OR detail.status = p_status);

  SELECT COALESCE(jsonb_agg(page.payload ORDER BY page.created_at DESC, page.id DESC), '[]'::jsonb)
  INTO v_items
  FROM (
    SELECT
      detail.id, detail.created_at,
      to_jsonb(detail) || jsonb_build_object(
        'automation_name', automation.name,
        'source_campaign_name', source_campaign.name,
        'source_campaign_detail_status', source_detail.status,
        'target_campaign_name', target_campaign.name,
        'target_campaign_status', target_campaign.status,
        'target_result_status', target_result.status,
        'target_result_count', COALESCE(target_result.result_count, 0),
        'target_contact_group_name', target_group.name,
        'target_data_group_name', target_data_group.name
      ) AS payload
    FROM public.auto_automation_detail AS detail
    JOIN public.auto_automation AS automation ON automation.id = detail.automation_id
    JOIN public.auto_campaigns AS source_campaign ON source_campaign.id = detail.source_campaign_id
    JOIN public.auto_campaign_details AS source_detail ON source_detail.id = detail.source_campaign_detail_id
    JOIN public.auto_campaigns AS target_campaign ON target_campaign.id = detail.target_campaign_id
    LEFT JOIN public.auto_account_contact_groups AS target_group
      ON target_group.id = detail.target_contact_group_id
    LEFT JOIN public.auto_account_contact_groups AS target_data_group
      ON target_data_group.id = detail.target_data_group_id
     AND target_data_group.purpose = 'data_group' AND target_data_group.is_delete = false
    LEFT JOIN LATERAL (
      SELECT latest.status, count(*) OVER ()::integer AS result_count
      FROM public.auto_campaign_details AS latest
      WHERE latest.auto_automation_detail_id = detail.id
        AND COALESCE(latest.is_delete, false) = false
      ORDER BY latest.created_at DESC, latest.id DESC LIMIT 1
    ) AS target_result ON true
    WHERE detail.staff_id = p_staff_id AND detail.organization_id = p_organization_id
      AND (p_automation_id IS NULL OR detail.automation_id = p_automation_id)
      AND (p_status IS NULL OR detail.status = p_status)
    ORDER BY detail.created_at DESC, detail.id DESC
    LIMIT v_limit OFFSET v_offset
  ) AS page;

  RETURN jsonb_build_object(
    'items', v_items, 'total', v_total, 'limit', v_limit, 'offset', v_offset
  );
END;
$$;

-- Campaign Data tab: page the materialized inputs while returning every known
-- immutable provenance edge for each row.  The input object deliberately uses
-- to_jsonb(row) so additive input columns remain visible without revising this
-- RPC. Provenance is read-only audit data; payload snapshots are never folded
-- back into the materialized input.
CREATE OR REPLACE FUNCTION public.aka_agent_list_campaign_input_data_page(
  p_staff_id bigint,
  p_organization_id bigint,
  p_campaign_id bigint,
  p_search text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_date_from timestamptz DEFAULT NULL,
  p_date_to timestamptz DEFAULT NULL,
  p_offset integer DEFAULT 0,
  p_limit integer DEFAULT 100
)
RETURNS TABLE (
  input_data jsonb,
  origins jsonb,
  total_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_search text := NULLIF(btrim(COALESCE(p_search, '')), '');
  v_status text := NULLIF(btrim(COALESCE(p_status, '')), '');
BEGIN
  PERFORM public.aka_agent_internal_require_staff_tenant(
    p_staff_id, p_organization_id
  );
  IF p_campaign_id IS NULL OR p_campaign_id <= 0
    OR COALESCE(p_offset, 0) < 0
    OR COALESCE(p_limit, 100) NOT BETWEEN 1 AND 500
  THEN
    RAISE EXCEPTION 'invalid_campaign_input_data_page';
  END IF;
  IF p_date_from IS NOT NULL AND p_date_to IS NOT NULL
    AND p_date_from > p_date_to
  THEN
    RAISE EXCEPTION 'invalid_campaign_input_data_date_range';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.auto_campaigns AS campaign
    WHERE campaign.id = p_campaign_id
      AND campaign.staff_id = p_staff_id
      AND campaign.organization_id = p_organization_id
  ) THEN
    RAISE EXCEPTION 'campaign_not_found';
  END IF;

  RETURN QUERY
  WITH filtered AS MATERIALIZED (
    SELECT input_row.*
    FROM public.auto_campaign_input_data AS input_row
    WHERE input_row.campaign_id = p_campaign_id
      AND COALESCE(input_row.is_delete, false) = false
      AND (v_status IS NULL OR input_row.status = v_status)
      AND (p_date_from IS NULL OR input_row.created_at >= p_date_from)
      AND (p_date_to IS NULL OR input_row.created_at <= p_date_to)
      AND (
        v_search IS NULL
        OR concat_ws(
          ' ', input_row.id::text, input_row.name, input_row.phone,
          input_row.phone_carrier, input_row.uid, input_row.email,
          input_row.status, input_row.note, input_row.content,
          input_row.info1, input_row.info2, input_row.info3,
          input_row.info4, input_row.info5,
          input_row.canonical_target_key
        ) ILIKE '%' || v_search || '%'
      )
  ), paged AS (
    SELECT filtered.*, count(*) OVER ()::bigint AS page_total_count
    FROM filtered
    ORDER BY filtered.created_at DESC, filtered.id DESC
    OFFSET COALESCE(p_offset, 0)
    LIMIT COALESCE(p_limit, 100)
  )
  SELECT
    to_jsonb(paged) - 'page_total_count' AS input_data,
    COALESCE(origin_page.items, '[]'::jsonb) AS origins,
    paged.page_total_count AS total_count
  FROM paged
  LEFT JOIN LATERAL (
    SELECT COALESCE(
      jsonb_agg(
        jsonb_strip_nulls(jsonb_build_object(
          'origin_id', campaign_origin.id,
          'origin_kind', campaign_origin.origin_kind,
          'group_id', contact_group.id,
          'group_name', contact_group.name,
          'group_color', contact_group.color,
          'membership_id', campaign_origin.membership_id,
          'membership_is_delete', group_member.is_delete,
          'membership_change_revision', group_member.change_revision,
          'contact_id', contact.id,
          'contact_name', contact.name,
          'contact_uid', contact.uid,
          'contact_url', contact.url,
          'contact_phone', contact.phone,
          'contact_email', contact.email,
          'contact_type', contact.contact_type,
          'contact_platform', contact.flatform_type,
          'contact_account_id', contact.account_id,
          'source_id', campaign_source.id,
          'source_status', campaign_source.status,
          'source_started_at', campaign_source.started_at,
          'source_stopped_at', campaign_source.stopped_at,
          'source_stop_reason', campaign_source.stop_reason,
          'source_last_ingest_at', campaign_source.last_ingest_at,
          'batch_id', ingest_batch.id,
          'batch_request_id', ingest_batch.request_id,
          'batch_operation', ingest_batch.operation,
          'batch_kind', ingest_batch.kind,
          'batch_source_name', ingest_batch.source_name,
          'batch_source_account_id', ingest_batch.source_account_id,
          'batch_dataset_id', ingest_batch.dataset_id,
          'batch_status', ingest_batch.status,
          'batch_created_at', ingest_batch.created_at,
          'dataset_ids', COALESCE(dataset_page.ids, '[]'::jsonb),
          'dataset_names', COALESCE(dataset_page.names, '[]'::jsonb),
          'datasets', COALESCE(dataset_page.items, '[]'::jsonb),
          'automation_detail_id', automation_detail.id,
          'automation_detail_status', automation_detail.status,
          'automation_id', automation.id,
          'automation_name', automation.name,
          'automation_source_campaign_id', automation_detail.source_campaign_id,
          'automation_source_campaign_name', automation_source_campaign.name,
          'automation_target_campaign_id', automation_detail.target_campaign_id,
          'automation_target_campaign_name', automation_target_campaign.name,
          'member_origins', COALESCE(member_origin_page.items, '[]'::jsonb),
          'group_revision', campaign_origin.group_revision,
          'canonical_target_key', campaign_origin.canonical_target_key,
          'payload_snapshot', campaign_origin.payload_snapshot,
          'created_at', campaign_origin.created_at
        ))
        ORDER BY campaign_origin.created_at, campaign_origin.id
      ),
      '[]'::jsonb
    ) AS items
    FROM public.auto_campaign_input_origins AS campaign_origin
    LEFT JOIN public.auto_campaign_data_group_sources AS campaign_source
      ON campaign_source.id = campaign_origin.source_id
     AND campaign_source.campaign_id = p_campaign_id
     AND campaign_source.staff_id = p_staff_id
     AND campaign_source.organization_id = p_organization_id
    LEFT JOIN public.auto_account_contact_groups AS contact_group
      ON contact_group.id = COALESCE(campaign_origin.group_id, campaign_source.group_id)
     AND contact_group.staff_id = p_staff_id
     AND contact_group.organization_id = p_organization_id
    LEFT JOIN public.auto_account_contact_group_members AS group_member
      ON group_member.id = campaign_origin.membership_id
     AND group_member.group_id = contact_group.id
    LEFT JOIN public.auto_account_contacts AS contact
      ON contact.id = group_member.contact_id
     AND contact.staff_id = p_staff_id
     AND contact.organization_id = p_organization_id
    LEFT JOIN public.auto_data_ingest_batches AS ingest_batch
      ON ingest_batch.id = campaign_origin.batch_id
     AND ingest_batch.staff_id = p_staff_id
     AND ingest_batch.organization_id = p_organization_id
    LEFT JOIN LATERAL (
      SELECT member_origin.automation_detail_id
      FROM public.auto_account_contact_group_member_origins AS member_origin
      WHERE member_origin.membership_id = campaign_origin.membership_id
        AND member_origin.automation_detail_id IS NOT NULL
        AND member_origin.batch_id IS NOT DISTINCT FROM campaign_origin.batch_id
      ORDER BY
        member_origin.is_current DESC,
        member_origin.created_at DESC,
        member_origin.id DESC
      LIMIT 1
    ) AS preferred_automation_origin ON true
    LEFT JOIN public.auto_automation_detail AS automation_detail
      ON automation_detail.id = COALESCE(
        campaign_origin.automation_detail_id,
        preferred_automation_origin.automation_detail_id
      )
     AND automation_detail.staff_id = p_staff_id
     AND automation_detail.organization_id = p_organization_id
    LEFT JOIN public.auto_automation AS automation
      ON automation.id = automation_detail.automation_id
     AND automation.staff_id = p_staff_id
     AND automation.organization_id = p_organization_id
    LEFT JOIN public.auto_campaigns AS automation_source_campaign
      ON automation_source_campaign.id = automation_detail.source_campaign_id
     AND automation_source_campaign.staff_id = p_staff_id
     AND automation_source_campaign.organization_id = p_organization_id
    LEFT JOIN public.auto_campaigns AS automation_target_campaign
      ON automation_target_campaign.id = automation_detail.target_campaign_id
     AND automation_target_campaign.staff_id = p_staff_id
     AND automation_target_campaign.organization_id = p_organization_id
    LEFT JOIN LATERAL (
      SELECT
        COALESCE(jsonb_agg(dataset_row.id ORDER BY dataset_row.id), '[]'::jsonb) AS ids,
        COALESCE(jsonb_agg(dataset_row.name ORDER BY dataset_row.id), '[]'::jsonb) AS names,
        COALESCE(jsonb_agg(
          jsonb_strip_nulls(jsonb_build_object(
            'id', dataset_row.id,
            'name', dataset_row.name,
            'source', dataset_row.source,
            'scan_type', dataset_row.scan_type,
            'source_key', dataset_row.source_key,
            'last_scan_status', dataset_row.last_scan_status,
            'is_delete', dataset_row.is_delete,
            'created_at', dataset_row.created_at
          )) ORDER BY dataset_row.id
        ), '[]'::jsonb) AS items
      FROM (
        SELECT
          dataset.id, dataset.name, dataset.source, dataset.scan_type,
          dataset.source_key, dataset.last_scan_status, dataset.is_delete,
          dataset.created_at
        FROM public.auto_account_contacts_dataset AS dataset
        WHERE dataset.id = ingest_batch.dataset_id
          AND dataset.staff_id = p_staff_id
          AND dataset.organization_id = p_organization_id
        UNION
        SELECT
          dataset.id, dataset.name, dataset.source, dataset.scan_type,
          dataset.source_key, dataset.last_scan_status, dataset.is_delete,
          dataset.created_at
        FROM public.auto_account_contact_group_member_origins AS member_origin
        JOIN public.auto_account_contacts_dataset AS dataset
          ON dataset.id = member_origin.dataset_id
         AND dataset.staff_id = p_staff_id
         AND dataset.organization_id = p_organization_id
        WHERE member_origin.membership_id = campaign_origin.membership_id
      ) AS dataset_row
    ) AS dataset_page ON true
    LEFT JOIN LATERAL (
      SELECT COALESCE(
        jsonb_agg(
          jsonb_strip_nulls(jsonb_build_object(
            'id', member_origin.id,
            'kind', member_origin.kind,
            'dataset_id', origin_dataset.id,
            'dataset_name', origin_dataset.name,
            'batch_id', origin_batch.id,
            'batch_request_id', origin_batch.request_id,
            'source_account_id', member_origin.source_account_id,
            'source_name', member_origin.source_name_snapshot,
            'is_current', member_origin.is_current,
            'automation_detail_id', member_automation_detail.id,
            'automation_detail_status', member_automation_detail.status,
            'automation_id', member_automation.id,
            'automation_name', member_automation.name,
            'source_campaign_id', member_automation_detail.source_campaign_id,
            'source_campaign_name', member_source_campaign.name,
            'target_campaign_id', member_automation_detail.target_campaign_id,
            'target_campaign_name', member_target_campaign.name,
            'created_at', member_origin.created_at,
            'updated_at', member_origin.updated_at
          ))
          ORDER BY member_origin.created_at, member_origin.id
        ),
        '[]'::jsonb
      ) AS items
      FROM public.auto_account_contact_group_member_origins AS member_origin
      LEFT JOIN public.auto_account_contacts_dataset AS origin_dataset
        ON origin_dataset.id = member_origin.dataset_id
       AND origin_dataset.staff_id = p_staff_id
       AND origin_dataset.organization_id = p_organization_id
      LEFT JOIN public.auto_data_ingest_batches AS origin_batch
        ON origin_batch.id = member_origin.batch_id
       AND origin_batch.staff_id = p_staff_id
       AND origin_batch.organization_id = p_organization_id
      LEFT JOIN public.auto_automation_detail AS member_automation_detail
        ON member_automation_detail.id = member_origin.automation_detail_id
       AND member_automation_detail.staff_id = p_staff_id
       AND member_automation_detail.organization_id = p_organization_id
      LEFT JOIN public.auto_automation AS member_automation
        ON member_automation.id = member_automation_detail.automation_id
       AND member_automation.staff_id = p_staff_id
       AND member_automation.organization_id = p_organization_id
      LEFT JOIN public.auto_campaigns AS member_source_campaign
        ON member_source_campaign.id = member_automation_detail.source_campaign_id
       AND member_source_campaign.staff_id = p_staff_id
       AND member_source_campaign.organization_id = p_organization_id
      LEFT JOIN public.auto_campaigns AS member_target_campaign
        ON member_target_campaign.id = member_automation_detail.target_campaign_id
       AND member_target_campaign.staff_id = p_staff_id
       AND member_target_campaign.organization_id = p_organization_id
      WHERE member_origin.membership_id = campaign_origin.membership_id
    ) AS member_origin_page ON true
    WHERE campaign_origin.input_data_id = paged.id
  ) AS origin_page ON true
  ORDER BY paged.created_at DESC, paged.id DESC;
END;
$$;

-- ---------------------------------------------------------------------------
-- 9. RPC-only permissions
-- ---------------------------------------------------------------------------

ALTER TABLE public.auto_data_ingest_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auto_account_contact_group_member_origins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auto_campaign_creation_bundles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auto_campaign_data_group_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auto_campaign_input_origins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auto_campaign_input_target_aliases ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE public.auto_data_ingest_batches
  FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.auto_account_contact_group_member_origins
  FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.auto_campaign_creation_bundles
  FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.auto_campaign_data_group_sources
  FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.auto_campaign_input_origins
  FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.auto_campaign_input_target_aliases
  FROM PUBLIC, anon, authenticated;

REVOKE ALL PRIVILEGES ON SEQUENCE public.auto_data_ingest_batches_id_seq
  FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON SEQUENCE public.auto_account_contact_group_member_origins_id_seq
  FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON SEQUENCE public.auto_campaign_creation_bundles_id_seq
  FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON SEQUENCE public.auto_campaign_data_group_sources_id_seq
  FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON SEQUENCE public.auto_campaign_input_origins_id_seq
  FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON SEQUENCE public.auto_campaign_input_target_aliases_id_seq
  FROM PUBLIC, anon, authenticated;

-- Internal helpers and trigger functions are never Data API entrypoints.
REVOKE ALL ON FUNCTION public.aka_agent_internal_require_staff_tenant(bigint, bigint)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.aka_agent_internal_normalize_phone(text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.aka_agent_internal_normalize_facebook_identity(text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.aka_agent_guard_canonical_campaign_input_payload()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.aka_agent_internal_route_data_group_member(bigint, bigint, bigint, bigint)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.aka_agent_internal_route_group_snapshot(bigint, bigint, bigint)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.aka_agent_sync_scan_dataset_group_origins()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.aka_agent_guard_campaign_data_group_identity()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.aka_agent_close_terminal_campaign_data_group_source()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.aka_agent_guard_campaign_data_group_source_identity()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.aka_agent_snapshot_automation_data_group()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.aka_agent_reserve_automation_data_group_input()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.aka_agent_resolve_automation_canonical_input()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.auto_automation_to_json(bigint, bigint, bigint)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reconcile_auto_automation_enqueue_failures_v185_internal(
  bigint, bigint, text, integer, text, text
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.claim_auto_automation_details(
  bigint, bigint, text, integer, text, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reconcile_auto_automation_enqueue_failures(
  bigint, bigint, text, integer, text, text
) FROM PUBLIC;

-- Keep the implementation overloads callable by trusted service workers only.
-- Desktop roles receive same-name overloads with two mandatory process-only
-- credentials.  Building these wrappers from the implementation catalog keeps
-- their TABLE/scalar return contracts exactly aligned without duplicating the
-- substantial result definitions above.
DO $create_data_group_auth_wrappers$
DECLARE
  v_old_signature text;
  v_old_oid oid;
  v_name name;
  v_result text;
  v_volatility text;
  v_input_declarations text;
  v_input_names text;
  v_input_types text;
BEGIN
  FOREACH v_old_signature IN ARRAY ARRAY[
    'public.aka_agent_list_data_groups(bigint,bigint,text,integer,integer)',
    'public.aka_agent_create_data_group(bigint,bigint,text,text,text)',
    'public.aka_agent_update_data_group(bigint,bigint,bigint,text,text,integer)',
    'public.aka_agent_delete_data_group(bigint,bigint,bigint,text)',
    'public.aka_agent_duplicate_data_group(bigint,bigint,bigint,text,text)',
    'public.aka_agent_list_data_group_members(bigint,bigint,bigint,text,bigint[],boolean,text[],text[],text,bigint[],bigint[],bigint[],integer,integer)',
    'public.aka_agent_list_data_group_datasets(bigint,bigint,bigint)',
    'public.aka_agent_get_data_group_latest_ingest_stats(bigint,bigint,bigint)',
    'public.aka_agent_ingest_data_group(bigint,bigint,text,bigint,text,jsonb,bigint,text,text,bigint,text,text)',
    'public.aka_agent_remove_data_group_members(bigint,bigint,text,bigint,bigint[])',
    'public.aka_agent_move_data_group_members(bigint,bigint,text,bigint,bigint[],bigint)',
    'public.aka_agent_create_campaign_creation_bundle(bigint,bigint,text,integer)',
    'public.aka_agent_preflight_campaign_data_group_change(bigint,bigint,bigint,bigint)',
    'public.aka_agent_bind_campaign_data_group_source(bigint,bigint,text,bigint,bigint,bigint)',
    'public.aka_agent_get_campaign_data_group_source(bigint,bigint,bigint)',
    'public.aka_agent_stop_campaign_data_group_source(bigint,bigint,bigint,text,text)',
    'public.aka_agent_reactivate_campaign_data_group_source(bigint,bigint,bigint,text,text)',
    'public.aka_agent_finalize_data_group_campaign(bigint,bigint,bigint,text)',
    'public.aka_agent_finalize_expired_data_group_campaigns(bigint,bigint,integer)',
    'public.aka_agent_ingest_automation_data_group_result(bigint,bigint,bigint)',
    'public.aka_agent_list_campaign_input_data_page(bigint,bigint,bigint,text,text,timestamp with time zone,timestamp with time zone,integer,integer)'
  ] LOOP
    v_old_oid := pg_catalog.to_regprocedure(v_old_signature);
    IF v_old_oid IS NULL THEN
      RAISE EXCEPTION 'missing_data_group_rpc_implementation: %', v_old_signature;
    END IF;

    SELECT
      routine.proname,
      pg_catalog.pg_get_function_result(routine.oid),
      CASE routine.provolatile
        WHEN 'i' THEN 'IMMUTABLE'
        WHEN 's' THEN 'STABLE'
        ELSE 'VOLATILE'
      END
    INTO v_name, v_result, v_volatility
    FROM pg_catalog.pg_proc AS routine
    WHERE routine.oid = v_old_oid;

    SELECT
      pg_catalog.string_agg(
        pg_catalog.format(
          '%I %s',
          routine.proargnames[input_arg.ordinality::integer],
          pg_catalog.format_type(input_arg.type_oid, NULL)
        ),
        ', ' ORDER BY input_arg.ordinality
      ),
      pg_catalog.string_agg(
        pg_catalog.format('%I', routine.proargnames[input_arg.ordinality::integer]),
        ', ' ORDER BY input_arg.ordinality
      ),
      pg_catalog.string_agg(
        pg_catalog.format_type(input_arg.type_oid, NULL),
        ', ' ORDER BY input_arg.ordinality
      )
    INTO v_input_declarations, v_input_names, v_input_types
    FROM pg_catalog.pg_proc AS routine
    CROSS JOIN LATERAL pg_catalog.unnest(routine.proargtypes::oid[])
      WITH ORDINALITY AS input_arg(type_oid, ordinality)
    WHERE routine.oid = v_old_oid;

    IF v_input_declarations IS NULL OR v_input_names IS NULL OR v_input_types IS NULL THEN
      RAISE EXCEPTION 'invalid_data_group_rpc_implementation: %', v_old_signature;
    END IF;

    EXECUTE pg_catalog.format($create_auth_wrapper$
CREATE OR REPLACE FUNCTION public.%1$I(
  %2$s,
  p_auth_username text,
  p_auth_password text
)
RETURNS %3$s
LANGUAGE sql
%4$s
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $auth_wrapper$
  SELECT public.auto_assert_automation_identity(
    p_staff_id, p_organization_id, p_auth_username, p_auth_password
  );
  SELECT * FROM public.%1$I(%5$s);
$auth_wrapper$
$create_auth_wrapper$,
      v_name,
      v_input_declarations,
      v_result,
      v_volatility,
      v_input_names
    );

    EXECUTE pg_catalog.format(
      'REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC, anon, authenticated',
      v_name, v_input_types
    );
    EXECUTE pg_catalog.format(
      'GRANT EXECUTE ON FUNCTION public.%I(%s) TO service_role',
      v_name, v_input_types
    );
    EXECUTE pg_catalog.format(
      'REVOKE ALL ON FUNCTION public.%I(%s, text, text) FROM PUBLIC',
      v_name, v_input_types
    );
    EXECUTE pg_catalog.format(
      'GRANT EXECUTE ON FUNCTION public.%I(%s, text, text) TO anon, authenticated, service_role',
      v_name, v_input_types
    );
  END LOOP;
END;
$create_data_group_auth_wrappers$;

-- Preserve the established automation service-role surface after replacing
-- claim/reconcile, and expose the new save overload to desktop roles.
REVOKE ALL ON FUNCTION public.aka_agent_save_automation(
  bigint, bigint, bigint, text, bigint, bigint, text, bigint, bigint,
  text, integer, integer, timestamptz, text, boolean, jsonb, text, text,
  integer, text, time without time zone, time without time zone, boolean
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aka_agent_save_automation(
  bigint, bigint, bigint, text, bigint, bigint, text, bigint, bigint,
  text, integer, integer, timestamptz, text, boolean, jsonb, text, text,
  integer, text, time without time zone, time without time zone, boolean
) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_auto_automation_details(
  bigint, bigint, text, integer, text, text
) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reconcile_auto_automation_enqueue_failures(
  bigint, bigint, text, integer, text, text
) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.aka_agent_list_automation_details(
  bigint, bigint, bigint, text, integer, integer, text, text
) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
