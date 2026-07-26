-- Automatically expose standalone contact datasets as Data Groups.
--
-- `group_id` keeps its v186 meaning: the dataset was created inside an
-- existing, user-managed Data Group.  Standalone scan/upload datasets use the
-- separate `auto_data_group_id` ownership link so the legacy dataset identity
-- and partial unique indexes remain unchanged.

BEGIN;

ALTER TABLE public.auto_account_contact_groups
  ADD COLUMN IF NOT EXISTS dataset_sync_mode text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS dataset_sync_key text;

ALTER TABLE public.auto_account_contacts_dataset
  ADD COLUMN IF NOT EXISTS auto_data_group_id bigint;

DO $dataset_auto_group_constraints$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.auto_account_contact_groups'::regclass
      AND conname = 'auto_account_contact_groups_dataset_sync_mode_check'
  ) THEN
    ALTER TABLE public.auto_account_contact_groups
      ADD CONSTRAINT auto_account_contact_groups_dataset_sync_mode_check
      CHECK (
        (dataset_sync_mode = 'manual' AND dataset_sync_key IS NULL)
        OR
        (dataset_sync_mode = 'dataset_auto' AND dataset_sync_key IS NOT NULL)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.auto_account_contacts_dataset'::regclass
      AND conname = 'auto_account_contacts_dataset_auto_data_group_fkey'
  ) THEN
    ALTER TABLE public.auto_account_contacts_dataset
      ADD CONSTRAINT auto_account_contacts_dataset_auto_data_group_fkey
      FOREIGN KEY (auto_data_group_id)
      REFERENCES public.auto_account_contact_groups(id)
      ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.auto_account_contacts_dataset'::regclass
      AND conname = 'auto_account_contacts_dataset_group_mode_check'
  ) THEN
    ALTER TABLE public.auto_account_contacts_dataset
      ADD CONSTRAINT auto_account_contacts_dataset_group_mode_check
      CHECK (group_id IS NULL OR auto_data_group_id IS NULL);
  END IF;
END;
$dataset_auto_group_constraints$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_auto_data_groups_active_dataset_sync_key
  ON public.auto_account_contact_groups (
    staff_id,
    organization_id,
    dataset_sync_key
  )
  WHERE purpose = 'data_group'
    AND dataset_sync_mode = 'dataset_auto'
    AND dataset_sync_key IS NOT NULL
    AND is_delete = false;

CREATE INDEX IF NOT EXISTS idx_contact_datasets_auto_data_group
  ON public.auto_account_contacts_dataset (auto_data_group_id, updated_at DESC, id DESC)
  WHERE auto_data_group_id IS NOT NULL AND is_delete = false;

COMMENT ON COLUMN public.auto_account_contact_groups.dataset_sync_mode IS
  'manual for user-managed groups; dataset_auto for groups maintained from standalone dataset snapshots.';
COMMENT ON COLUMN public.auto_account_contact_groups.dataset_sync_key IS
  'Stable tenant-scoped identity used to reuse one automatically generated group across refreshes.';
COMMENT ON COLUMN public.auto_account_contacts_dataset.auto_data_group_id IS
  'Automatically generated Data Group owned by a standalone dataset. Distinct from group_id, which means upload inside an existing group.';

CREATE OR REPLACE FUNCTION public.aka_agent_internal_dataset_auto_group_key(
  p_source text,
  p_account_id bigint,
  p_flatform_type text,
  p_contact_type text,
  p_scan_type text,
  p_source_key text
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
      'sourceKey', v_upload_source_key
    );
  ELSE
    v_identity := jsonb_build_object(
      'source', COALESCE(p_source, ''),
      'accountId', p_account_id,
      'platform', COALESCE(p_flatform_type, ''),
      'contactType', COALESCE(p_contact_type, ''),
      'scanType', COALESCE(p_scan_type, ''),
      'sourceKey', v_source_key
    );
  END IF;

  RETURN COALESCE(p_source, 'dataset') || ':' || md5(v_identity::text);
END;
$$;

CREATE OR REPLACE FUNCTION public.aka_agent_internal_sync_dataset_auto_group_member(
  p_dataset_id bigint,
  p_contact_id bigint,
  p_is_current boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_dataset public.auto_account_contacts_dataset%ROWTYPE;
  v_group public.auto_account_contact_groups%ROWTYPE;
  v_member public.auto_account_contact_group_members%ROWTYPE;
  v_revision bigint;
  v_relationship_kind text;
  v_had_exact_current_origin boolean := false;
  v_became_active boolean := false;
  v_source record;
BEGIN
  SELECT dataset.*
  INTO v_dataset
  FROM public.auto_account_contacts_dataset AS dataset
  WHERE dataset.id = p_dataset_id
    AND dataset.auto_data_group_id IS NOT NULL
    AND dataset.group_id IS NULL
    AND (
      dataset.is_delete = false
      OR NOT COALESCE(p_is_current, false)
    );

  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Dataset-member triggers can also touch user-managed groups which copied
  -- this dataset previously. Lock every affected group, including the owned
  -- auto group, in one deterministic order before touching a membership.
  PERFORM contact_group.id
  FROM public.auto_account_contact_groups AS contact_group
  WHERE contact_group.purpose = 'data_group'
    AND contact_group.is_delete = false
    AND (
      contact_group.id = v_dataset.auto_data_group_id
      OR EXISTS (
        SELECT 1
        FROM public.auto_account_contact_group_members AS affected_member
        JOIN public.auto_account_contact_group_member_origins AS affected_origin
          ON affected_origin.membership_id = affected_member.id
        WHERE affected_member.group_id = contact_group.id
          AND affected_member.contact_id = p_contact_id
          AND affected_origin.dataset_id = v_dataset.id
      )
    )
  ORDER BY contact_group.id
  FOR UPDATE OF contact_group;

  SELECT contact_group.*
  INTO v_group
  FROM public.auto_account_contact_groups AS contact_group
  WHERE contact_group.id = v_dataset.auto_data_group_id
    AND contact_group.staff_id = v_dataset.staff_id
    AND contact_group.organization_id = v_dataset.organization_id
    AND contact_group.purpose = 'data_group'
    AND contact_group.dataset_sync_mode = 'dataset_auto'
    AND contact_group.is_delete = false
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF COALESCE(p_is_current, false) AND NOT EXISTS (
    SELECT 1
    FROM public.auto_account_contacts AS contact
    WHERE contact.id = p_contact_id
      AND contact.staff_id = v_dataset.staff_id
      AND contact.organization_id = v_dataset.organization_id
      AND COALESCE(contact.is_delete, false) = false
  ) THEN
    p_is_current := false;
  END IF;

  SELECT member.*
  INTO v_member
  FROM public.auto_account_contact_group_members AS member
  WHERE member.group_id = v_group.id
    AND member.contact_id = p_contact_id
  FOR UPDATE;

  IF COALESCE(p_is_current, false) THEN
    IF NOT FOUND THEN
      UPDATE public.auto_account_contact_groups
      SET revision = revision + 1,
          updated_at = clock_timestamp()
      WHERE id = v_group.id
      RETURNING revision INTO v_revision;

      INSERT INTO public.auto_account_contact_group_members (
        group_id,
        contact_id,
        is_delete,
        change_revision,
        created_at,
        updated_at
      ) VALUES (
        v_group.id,
        p_contact_id,
        false,
        v_revision,
        clock_timestamp(),
        clock_timestamp()
      )
      RETURNING * INTO v_member;
      v_became_active := true;
    ELSIF v_member.is_delete THEN
      UPDATE public.auto_account_contact_groups
      SET revision = revision + 1,
          updated_at = clock_timestamp()
      WHERE id = v_group.id
      RETURNING revision INTO v_revision;

      UPDATE public.auto_account_contact_group_members
      SET is_delete = false,
          change_revision = v_revision,
          updated_at = clock_timestamp()
      WHERE id = v_member.id
      RETURNING * INTO v_member;
      v_became_active := true;
    ELSE
      v_revision := v_group.revision;
    END IF;

    v_relationship_kind := public.aka_agent_derive_data_group_relationship_kind(
      v_member.id,
      v_dataset.account_id,
      v_dataset.id
    );

    SELECT EXISTS (
      SELECT 1
      FROM public.auto_account_contact_group_member_origins AS origin
      WHERE origin.membership_id = v_member.id
        AND origin.kind = v_dataset.source
        AND origin.dataset_id = v_dataset.id
        AND origin.batch_id IS NULL
        AND origin.source_account_id IS NOT DISTINCT FROM v_dataset.account_id
        AND origin.automation_detail_id IS NULL
        AND origin.source_name_snapshot IS NOT DISTINCT FROM v_dataset.name
        AND origin.relationship_kind IS NOT DISTINCT FROM v_relationship_kind
        AND origin.is_current = true
    )
    INTO v_had_exact_current_origin;

    -- Dataset name and relationship are snapshots in the provenance identity.
    -- Retire an older identity before activating the current one.
    UPDATE public.auto_account_contact_group_member_origins
    SET is_current = false,
        updated_at = clock_timestamp()
    WHERE membership_id = v_member.id
      AND dataset_id = v_dataset.id
      AND is_current = true;

    INSERT INTO public.auto_account_contact_group_member_origins (
      membership_id,
      kind,
      dataset_id,
      batch_id,
      source_account_id,
      automation_detail_id,
      source_name_snapshot,
      relationship_kind,
      is_current,
      created_at,
      updated_at
    ) VALUES (
      v_member.id,
      v_dataset.source,
      v_dataset.id,
      NULL,
      v_dataset.account_id,
      NULL,
      v_dataset.name,
      v_relationship_kind,
      true,
      clock_timestamp(),
      clock_timestamp()
    )
    ON CONFLICT DO NOTHING;

    UPDATE public.auto_account_contact_group_member_origins
    SET is_current = true,
        updated_at = clock_timestamp()
    WHERE membership_id = v_member.id
      AND kind = v_dataset.source
      AND dataset_id = v_dataset.id
      AND batch_id IS NULL
      AND source_account_id IS NOT DISTINCT FROM v_dataset.account_id
      AND automation_detail_id IS NULL
      AND source_name_snapshot IS NOT DISTINCT FROM v_dataset.name
      AND relationship_kind IS NOT DISTINCT FROM v_relationship_kind;

    IF v_became_active OR NOT v_had_exact_current_origin THEN
      FOR v_source IN
        SELECT source.id
        FROM public.auto_campaign_data_group_sources AS source
        WHERE source.group_id = v_group.id
          AND source.status IN ('baselining', 'active')
        ORDER BY source.campaign_id, source.id
      LOOP
        PERFORM public.aka_agent_internal_route_data_group_member(
          v_source.id,
          v_member.id,
          NULL,
          v_revision
        );
      END LOOP;
    END IF;
    RETURN;
  END IF;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  UPDATE public.auto_account_contact_group_member_origins
  SET is_current = false,
      updated_at = clock_timestamp()
  WHERE membership_id = v_member.id
    AND dataset_id = v_dataset.id
    AND is_current = true;

  IF NOT v_member.is_delete AND NOT EXISTS (
    SELECT 1
    FROM public.auto_account_contact_group_member_origins AS current_origin
    WHERE current_origin.membership_id = v_member.id
      AND current_origin.is_current = true
  ) THEN
    UPDATE public.auto_account_contact_groups
    SET revision = revision + 1,
        updated_at = clock_timestamp()
    WHERE id = v_group.id
    RETURNING revision INTO v_revision;

    UPDATE public.auto_account_contact_group_members
    SET is_delete = true,
        change_revision = v_revision,
        updated_at = clock_timestamp()
    WHERE id = v_member.id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.aka_agent_internal_retire_dataset_auto_data_group(
  p_dataset_id bigint,
  p_auto_data_group_id bigint
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_dataset public.auto_account_contacts_dataset%ROWTYPE;
  v_group public.auto_account_contact_groups%ROWTYPE;
  v_dataset_member record;
BEGIN
  IF p_auto_data_group_id IS NULL THEN
    RETURN;
  END IF;

  SELECT dataset.*
  INTO v_dataset
  FROM public.auto_account_contacts_dataset AS dataset
  WHERE dataset.id = p_dataset_id
    AND dataset.auto_data_group_id = p_auto_data_group_id
    AND dataset.group_id IS NULL;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Retire this dataset's proof first. A member remains active when another
  -- current dataset/manual origin in the same group still owns it.
  FOR v_dataset_member IN
    SELECT member.contact_id
    FROM public.auto_account_contacts_dataset_members AS member
    WHERE member.dataset_id = v_dataset.id
    ORDER BY member.contact_id
  LOOP
    PERFORM public.aka_agent_internal_sync_dataset_auto_group_member(
      v_dataset.id,
      v_dataset_member.contact_id,
      false
    );
  END LOOP;

  UPDATE public.auto_account_contact_group_member_origins
  SET is_current = false,
      updated_at = clock_timestamp()
  WHERE dataset_id = v_dataset.id
    AND is_current = true;

  SELECT contact_group.*
  INTO v_group
  FROM public.auto_account_contact_groups AS contact_group
  WHERE contact_group.id = p_auto_data_group_id
    AND contact_group.staff_id = v_dataset.staff_id
    AND contact_group.organization_id = v_dataset.organization_id
    AND contact_group.purpose = 'data_group'
    AND contact_group.dataset_sync_mode = 'dataset_auto'
  FOR UPDATE;

  IF NOT FOUND OR v_group.is_delete OR EXISTS (
    SELECT 1
    FROM public.auto_account_contacts_dataset AS other_dataset
    WHERE other_dataset.auto_data_group_id = v_group.id
      AND other_dataset.id <> v_dataset.id
      AND other_dataset.group_id IS NULL
      AND other_dataset.is_delete = false
  ) THEN
    RETURN;
  END IF;

  UPDATE public.auto_account_contact_groups
  SET is_delete = true,
      revision = revision + 1,
      updated_at = clock_timestamp()
  WHERE id = v_group.id
  RETURNING * INTO v_group;

  UPDATE public.auto_account_contact_group_members
  SET is_delete = true,
      change_revision = v_group.revision,
      updated_at = clock_timestamp()
  WHERE group_id = v_group.id
    AND is_delete = false;

  UPDATE public.auto_account_contact_group_member_origins AS origin
  SET is_current = false,
      updated_at = clock_timestamp()
  FROM public.auto_account_contact_group_members AS member
  WHERE member.group_id = v_group.id
    AND origin.membership_id = member.id
    AND origin.is_current = true;

  UPDATE public.auto_campaign_data_group_sources
  SET status = 'stopped',
      stopped_at = clock_timestamp(),
      stop_reason = 'dataset_deleted',
      updated_at = clock_timestamp()
  WHERE group_id = v_group.id
    AND status IN ('baselining', 'active');
END;
$$;

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
BEGIN
  -- A dataset created inside an existing Data Group already has its owner and
  -- must never create a second group.
  IF NEW.group_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.is_delete THEN
    PERFORM public.aka_agent_internal_retire_dataset_auto_data_group(
      NEW.id,
      NEW.auto_data_group_id
    );
    RETURN NEW;
  END IF;

  -- Failed scans only record an outcome. They do not create a dataset/group
  -- snapshot. Upload datasets are finalized as completed by their writer.
  IF NEW.source = 'scan'
    AND NEW.last_scan_status IS DISTINCT FROM 'completed'
    AND NEW.last_scan_status IS DISTINCT FROM 'partial' THEN
    RETURN NEW;
  END IF;
  IF NEW.source = 'upload'
    AND NEW.last_scan_status IS DISTINCT FROM 'completed' THEN
    RETURN NEW;
  END IF;

  v_sync_key := public.aka_agent_internal_dataset_auto_group_key(
    NEW.source,
    NEW.account_id,
    NEW.flatform_type,
    NEW.contact_type,
    NEW.scan_type,
    NEW.source_key
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
      AND contact_group.dataset_sync_key = v_sync_key
      AND contact_group.is_delete = false
    FOR UPDATE;
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
      updated_at = clock_timestamp()
    RETURNING * INTO v_group;
  ELSE
    UPDATE public.auto_account_contact_groups
    SET name = btrim(NEW.name),
        updated_at = clock_timestamp()
    WHERE id = v_group.id
      AND name IS DISTINCT FROM btrim(NEW.name)
    RETURNING * INTO v_group;

    IF NOT FOUND THEN
      SELECT contact_group.*
      INTO v_group
      FROM public.auto_account_contact_groups AS contact_group
      WHERE contact_group.id = NEW.auto_data_group_id;
    END IF;
  END IF;

  -- Relink every active dataset with the same logical upload identity. This
  -- makes one multi-account upload own one shared group and also rebuilds the
  -- complete union if a user deleted that generated group previously.
  FOR v_related_dataset IN
    SELECT dataset.id
    FROM public.auto_account_contacts_dataset AS dataset
    WHERE dataset.staff_id = NEW.staff_id
      AND dataset.organization_id = NEW.organization_id
      AND dataset.group_id IS NULL
      AND dataset.is_delete = false
      AND (
        (dataset.source = 'scan' AND dataset.last_scan_status IN ('completed', 'partial'))
        OR
        (dataset.source = 'upload' AND dataset.last_scan_status = 'completed')
      )
      AND public.aka_agent_internal_dataset_auto_group_key(
        dataset.source,
        dataset.account_id,
        dataset.flatform_type,
        dataset.contact_type,
        dataset.scan_type,
        dataset.source_key
      ) = v_sync_key
    ORDER BY dataset.id
  LOOP
    UPDATE public.auto_account_contacts_dataset
    SET auto_data_group_id = v_group.id,
        updated_at = clock_timestamp()
    WHERE id = v_related_dataset.id
      AND auto_data_group_id IS DISTINCT FROM v_group.id;

    -- This also attaches legacy datasets lazily on the next successful refresh
    -- of their logical source. No unrelated dataset is bulk-backfilled.
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

CREATE OR REPLACE FUNCTION public.aka_agent_cleanup_deleted_dataset_auto_data_group()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM public.aka_agent_internal_retire_dataset_auto_data_group(
    OLD.id,
    OLD.auto_data_group_id
  );
  RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION public.aka_agent_sync_dataset_auto_data_group_member()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_dataset_id bigint := CASE WHEN TG_OP = 'DELETE' THEN OLD.dataset_id ELSE NEW.dataset_id END;
  v_contact_id bigint := CASE WHEN TG_OP = 'DELETE' THEN OLD.contact_id ELSE NEW.contact_id END;
  v_is_current boolean := CASE WHEN TG_OP = 'DELETE' THEN false ELSE NEW.is_current END;
BEGIN
  PERFORM public.aka_agent_internal_sync_dataset_auto_group_member(
    v_dataset_id,
    v_contact_id,
    v_is_current
  );
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

-- The v186 mirror continues to maintain user-managed groups which explicitly
-- selected a scan dataset. Dataset-owned groups are handled exclusively by
-- the v200 trigger so an old provenance identity cannot be reactivated after
-- a rename or relationship change.
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
  IF EXISTS (
    SELECT 1 FROM public.auto_account_contacts_dataset AS dataset
    WHERE dataset.id = v_dataset_id AND dataset.source = 'scan'
  ) THEN
    PERFORM contact_group.id
    FROM public.auto_account_contact_groups AS contact_group
    WHERE contact_group.purpose = 'data_group'
      AND contact_group.dataset_sync_mode <> 'dataset_auto'
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
       AND contact_group.dataset_sync_mode <> 'dataset_auto'
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

DROP TRIGGER IF EXISTS trg_aka_agent_ensure_dataset_auto_data_group
  ON public.auto_account_contacts_dataset;
CREATE TRIGGER trg_aka_agent_ensure_dataset_auto_data_group
AFTER INSERT OR UPDATE OF name, last_scan_status, is_delete, group_id
ON public.auto_account_contacts_dataset
FOR EACH ROW
EXECUTE FUNCTION public.aka_agent_ensure_dataset_auto_data_group();

DROP TRIGGER IF EXISTS trg_aka_agent_cleanup_deleted_dataset_auto_data_group
  ON public.auto_account_contacts_dataset;
CREATE TRIGGER trg_aka_agent_cleanup_deleted_dataset_auto_data_group
BEFORE DELETE
ON public.auto_account_contacts_dataset
FOR EACH ROW
EXECUTE FUNCTION public.aka_agent_cleanup_deleted_dataset_auto_data_group();

DROP TRIGGER IF EXISTS trg_aka_agent_sync_dataset_auto_data_group_member
  ON public.auto_account_contacts_dataset_members;
CREATE TRIGGER trg_aka_agent_sync_dataset_auto_data_group_member
AFTER INSERT OR UPDATE OR DELETE
ON public.auto_account_contacts_dataset_members
FOR EACH ROW
EXECUTE FUNCTION public.aka_agent_sync_dataset_auto_data_group_member();

-- Keep the existing RPC contract while making an auto-owned dataset visible
-- even when its current snapshot is empty and therefore has no origin rows.
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
      OR dataset.auto_data_group_id = p_group_id
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

REVOKE ALL ON FUNCTION public.aka_agent_internal_dataset_auto_group_key(
  text, bigint, text, text, text, text
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.aka_agent_internal_sync_dataset_auto_group_member(
  bigint, bigint, boolean
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.aka_agent_internal_retire_dataset_auto_data_group(
  bigint, bigint
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.aka_agent_ensure_dataset_auto_data_group()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.aka_agent_cleanup_deleted_dataset_auto_data_group()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.aka_agent_sync_dataset_auto_data_group_member()
  FROM PUBLIC, anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
