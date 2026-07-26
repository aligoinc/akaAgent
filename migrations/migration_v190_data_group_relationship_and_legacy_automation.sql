-- Preserve account-bound relationship provenance for shared Data Groups and
-- move pre-v186 automation destinations off the legacy contact-group header.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Relationship provenance belongs to an origin, not to the shared member.
-- ---------------------------------------------------------------------------

ALTER TABLE public.auto_account_contact_group_member_origins
  ADD COLUMN IF NOT EXISTS relationship_kind text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.auto_account_contact_group_member_origins'::regclass
      AND conname = 'auto_account_contact_group_member_origins_relationship_kind_check'
  ) THEN
    ALTER TABLE public.auto_account_contact_group_member_origins
      ADD CONSTRAINT auto_account_contact_group_member_origins_relationship_kind_check
      CHECK (
        relationship_kind IS NULL
        OR relationship_kind IN ('zalo_group_members', 'zalo_remarketing_customers')
      );
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_data_group_origin_current_relationship
  ON public.auto_account_contact_group_member_origins (
    membership_id, source_account_id, relationship_kind
  )
  WHERE is_current = true AND relationship_kind IS NOT NULL;

COMMENT ON COLUMN public.auto_account_contact_group_member_origins.relationship_kind IS
  'Exact account-bound relationship proven by this current origin. Only Zalo group-member and remarketing-customer relationships are routable.';

-- Derivation deliberately requires account agreement. A contact marker alone
-- never makes a relationship portable to another Zalo account.
CREATE OR REPLACE FUNCTION public.aka_agent_derive_data_group_relationship_kind(
  p_membership_id bigint,
  p_source_account_id bigint,
  p_dataset_id bigint
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_contact public.auto_account_contacts%ROWTYPE;
  v_effective_account_id bigint;
  v_declared_kind text;
  v_source_marker text;
  v_campaign_id_text text;
  v_hint jsonb;
  v_hint_text text;
BEGIN
  SELECT contact.*
  INTO v_contact
  FROM public.auto_account_contact_group_members AS member
  JOIN public.auto_account_contacts AS contact ON contact.id = member.contact_id
  WHERE member.id = p_membership_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  v_effective_account_id := COALESCE(p_source_account_id, v_contact.account_id);
  IF v_effective_account_id IS NULL
    OR v_contact.account_id IS DISTINCT FROM v_effective_account_id
    OR lower(btrim(COALESCE(v_contact.flatform_type, ''))) <> 'zalo'
    OR lower(btrim(COALESCE(v_contact.contact_type, ''))) <> 'person'
  THEN
    RETURN NULL;
  END IF;

  -- A current scan dataset is the strongest source-specific proof and wins
  -- even when the same contact later participates in another relationship.
  IF p_dataset_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.auto_account_contacts_dataset AS dataset
    JOIN public.auto_account_contacts_dataset_members AS dataset_member
      ON dataset_member.dataset_id = dataset.id
    WHERE dataset.id = p_dataset_id
      AND dataset.account_id = v_effective_account_id
      AND dataset.staff_id = v_contact.staff_id
      AND dataset.organization_id = v_contact.organization_id
      AND dataset.scan_type = 'zalo_group_members'
      AND dataset.source = 'scan'
      AND dataset.is_delete = false
      AND dataset_member.contact_id = v_contact.id
      AND dataset_member.is_current = true
  ) THEN
    RETURN 'zalo_group_members';
  END IF;

  v_declared_kind := lower(btrim(COALESCE(
    v_contact.extra_data ->> 'relationshipKind',
    v_contact.extra_data ->> 'relationship_kind',
    ''
  )));
  v_source_marker := lower(btrim(COALESCE(v_contact.extra_data ->> 'source', '')));

  -- The ingest wrapper supplies call-local hints so a new origin is not
  -- confused by an older relationshipKind already stored on the canonical
  -- contact. set_config(..., true) scopes this JSON to the current transaction.
  BEGIN
    v_hint_text := NULLIF(pg_catalog.current_setting(
      'aka_agent.data_group_relationship_hints', true
    ), '');
    IF v_hint_text IS NOT NULL THEN
      SELECT hint.value
      INTO v_hint
      FROM jsonb_array_elements(v_hint_text::jsonb) AS hint(value)
      WHERE hint.value ->> 'sourceAccountId' = v_effective_account_id::text
        AND (
          hint.value ->> 'contactId' = v_contact.id::text
          OR (
            NULLIF(btrim(COALESCE(hint.value ->> 'uid', '')), '') IS NOT NULL
            AND hint.value ->> 'uid' = v_contact.uid
          )
        )
      ORDER BY CASE WHEN hint.value ->> 'contactId' = v_contact.id::text
        THEN 0 ELSE 1 END
      LIMIT 1;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- Missing/malformed hints are never authority; durable proof below remains.
    v_hint := NULL;
  END;

  IF v_hint ->> 'relationshipKind' IN (
    'zalo_group_members', 'zalo_remarketing_customers'
  ) THEN
    v_declared_kind := v_hint ->> 'relationshipKind';
  END IF;

  -- Remarketing rows are projections of a persisted source campaign. Require
  -- both the exact projection marker and proof that campaign belongs to the
  -- same account; a copied JSON marker without that campaign is insufficient.
  IF v_declared_kind = 'zalo_remarketing_customers'
    OR v_source_marker = 'zalo_remarketing_customers'
  THEN
    v_campaign_id_text := btrim(COALESCE(
      v_hint ->> 'latestCampaignId',
      v_contact.extra_data ->> 'latestCampaignId',
      v_contact.extra_data ->> 'latest_campaign_id',
      v_contact.extra_data ->> 'sourceCampaignId',
      v_contact.extra_data ->> 'source_campaign_id',
      ''
    ));
    IF v_campaign_id_text ~ '^[1-9][0-9]{0,17}$' AND EXISTS (
      SELECT 1
      FROM public.auto_campaigns AS campaign
      WHERE campaign.id = v_campaign_id_text::bigint
        AND campaign.account_id = v_effective_account_id
        AND campaign.staff_id = v_contact.staff_id
        AND campaign.organization_id = v_contact.organization_id
        AND campaign.action_id IN (
          'zalo_message_phone',
          'zalo_message_friend',
          'zalo_message_group_member',
          'zalo_message_group_realtime',
          'zalo_message_friend_recommendation'
        )
    ) THEN
      RETURN 'zalo_remarketing_customers';
    END IF;
  END IF;

  -- The durable current relation is authoritative for group members. It also
  -- recovers older scans whose contact marker predates Data Group provenance.
  IF EXISTS (
    SELECT 1
    FROM public.zalo_group_members AS relation
    WHERE relation.account_id = v_effective_account_id
      AND relation.zalo_uid = v_contact.uid
      AND relation.is_current = true
      AND (relation.staff_id IS NULL OR relation.staff_id = v_contact.staff_id)
      AND (relation.organization_id IS NULL
        OR relation.organization_id = v_contact.organization_id)
  ) THEN
    RETURN 'zalo_group_members';
  END IF;

  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.aka_agent_stamp_data_group_relationship_kind()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.relationship_kind IS NULL THEN
    NEW.relationship_kind := public.aka_agent_derive_data_group_relationship_kind(
      NEW.membership_id, NEW.source_account_id, NEW.dataset_id
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_aka_agent_stamp_data_group_relationship_kind
  ON public.auto_account_contact_group_member_origins;
CREATE TRIGGER trg_aka_agent_stamp_data_group_relationship_kind
BEFORE INSERT OR UPDATE OF membership_id, source_account_id, dataset_id, relationship_kind
ON public.auto_account_contact_group_member_origins
FOR EACH ROW
EXECUTE FUNCTION public.aka_agent_stamp_data_group_relationship_kind();

-- Backfill only proof that is current now. Historical origins remain honest:
-- absence of relationship_kind means the exact relationship was not proven.
UPDATE public.auto_account_contact_group_member_origins AS origin
SET relationship_kind = public.aka_agent_derive_data_group_relationship_kind(
      origin.membership_id, origin.source_account_id, origin.dataset_id
    ),
    updated_at = now()
WHERE origin.is_current = true
  AND origin.relationship_kind IS NULL;

-- ---------------------------------------------------------------------------
-- 2. Accept a future top-level relationship_kind without changing RPC arity.
-- ---------------------------------------------------------------------------

-- Keep the v186 implementation intact. The replacement same-signature entry
-- point only projects allowed per-row metadata into extra_data, where the
-- origin trigger can consume it transaction-safely without session globals.
DO $$
BEGIN
  IF pg_catalog.to_regprocedure(
    'public.aka_agent_ingest_data_group_v186_internal(bigint,bigint,text,bigint,text,jsonb,bigint,text,text,bigint,text,text)'
  ) IS NULL THEN
    IF pg_catalog.to_regprocedure(
      'public.aka_agent_ingest_data_group(bigint,bigint,text,bigint,text,jsonb,bigint,text,text,bigint,text,text)'
    ) IS NULL THEN
      RAISE EXCEPTION 'missing_v186_data_group_ingest';
    END IF;
    ALTER FUNCTION public.aka_agent_ingest_data_group(
      bigint, bigint, text, bigint, text, jsonb, bigint, text, text, bigint, text, text
    ) RENAME TO aka_agent_ingest_data_group_v186_internal;
  END IF;
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
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_rows jsonb;
  v_hints jsonb;
  v_result jsonb;
  v_previous_hints text;
BEGIN
  SELECT COALESCE(jsonb_agg(
    CASE
      WHEN jsonb_typeof(row_value.value) = 'object'
        AND row_value.value ->> 'relationship_kind' IN (
          'zalo_group_members', 'zalo_remarketing_customers'
        )
      THEN jsonb_set(
        row_value.value - 'relationship_kind',
        '{extra_data}',
        CASE WHEN jsonb_typeof(row_value.value -> 'extra_data') = 'object'
          THEN row_value.value -> 'extra_data'
          ELSE '{}'::jsonb
        END || jsonb_build_object(
          'relationshipKind', row_value.value ->> 'relationship_kind'
        ),
        true
      )
      ELSE row_value.value
    END
    ORDER BY row_value.ordinality
  ), '[]'::jsonb)
  INTO v_rows
  FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb))
    WITH ORDINALITY AS row_value(value, ordinality);

  SELECT COALESCE(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'relationshipKind', row_value.value ->> 'relationship_kind',
    'sourceAccountId', COALESCE(
      NULLIF(btrim(COALESCE(row_value.value ->> 'source_account_id', '')), ''),
      p_source_account_id::text
    ),
    'contactId', NULLIF(btrim(COALESCE(row_value.value ->> 'contact_id', '')), ''),
    'uid', COALESCE(
      NULLIF(btrim(COALESCE(row_value.value ->> 'uid', '')), ''),
      NULLIF(btrim(COALESCE(row_value.value ->> 'url', '')), '')
    ),
    'latestCampaignId', COALESCE(
      row_value.value -> 'extra_data' ->> 'latestCampaignId',
      row_value.value -> 'extra_data' ->> 'latest_campaign_id',
      row_value.value -> 'extra_data' ->> 'sourceCampaignId',
      row_value.value -> 'extra_data' ->> 'source_campaign_id'
    )
  ))), '[]'::jsonb)
  INTO v_hints
  FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb)) AS row_value(value)
  WHERE jsonb_typeof(row_value.value) = 'object'
    AND row_value.value ->> 'relationship_kind' IN (
      'zalo_group_members', 'zalo_remarketing_customers'
    );

  v_previous_hints := pg_catalog.current_setting(
    'aka_agent.data_group_relationship_hints', true
  );
  PERFORM pg_catalog.set_config(
    'aka_agent.data_group_relationship_hints', v_hints::text, true
  );

  BEGIN
    v_result := public.aka_agent_ingest_data_group_v186_internal(
      p_staff_id, p_organization_id, p_request_id, p_group_id, p_kind, v_rows,
      p_dataset_id, p_dataset_name, p_import_source, p_source_account_id,
      p_source_name, p_payload_hash
    );
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_catalog.set_config(
      'aka_agent.data_group_relationship_hints',
      COALESCE(v_previous_hints, ''), true
    );
    RAISE;
  END;

  PERFORM pg_catalog.set_config(
    'aka_agent.data_group_relationship_hints',
    COALESCE(v_previous_hints, ''), true
  );
  RETURN v_result;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Tighten only the two relationship-bound routes.
-- ---------------------------------------------------------------------------

-- Renaming preserves every byte of v186 routing logic behind a narrow
-- relationship preflight. All other actions delegate without new conditions.
DO $$
BEGIN
  IF pg_catalog.to_regprocedure(
    'public.aka_agent_internal_route_data_group_member_v186_internal(bigint,bigint,bigint,bigint)'
  ) IS NULL THEN
    IF pg_catalog.to_regprocedure(
      'public.aka_agent_internal_route_data_group_member(bigint,bigint,bigint,bigint)'
    ) IS NULL THEN
      RAISE EXCEPTION 'missing_v186_data_group_router';
    END IF;
    ALTER FUNCTION public.aka_agent_internal_route_data_group_member(
      bigint, bigint, bigint, bigint
    ) RENAME TO aka_agent_internal_route_data_group_member_v186_internal;
  END IF;
END;
$$;

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
  v_action text;
  v_account_id bigint;
  v_contact_id bigint;
  v_contact_uid text;
  v_staff_id bigint;
  v_organization_id bigint;
  v_has_relationship boolean := false;
  v_relationship_check_applicable boolean := false;
BEGIN
  SELECT
    campaign.action_id,
    campaign.account_id,
    member.contact_id,
    contact.uid,
    source.staff_id,
    source.organization_id,
    source.status IN ('baselining', 'active')
      AND campaign.staff_id IS NOT DISTINCT FROM source.staff_id
      AND campaign.organization_id IS NOT DISTINCT FROM source.organization_id
      AND COALESCE(campaign.is_delete, false) = false
      AND campaign.data_target_source_mode = 'data_group'
      AND campaign.data_group_id IS NOT DISTINCT FROM source.group_id
      AND campaign.status IN ('chờ xử lý', 'tạm dừng', 'đang chạy')
      AND (campaign.schedule_end_date IS NULL OR campaign.schedule_end_date > now())
      AND member.is_delete = false
      AND contact.staff_id IS NOT DISTINCT FROM source.staff_id
      AND contact.organization_id IS NOT DISTINCT FROM source.organization_id
      AND COALESCE(contact.is_delete, false) = false
      AND lower(btrim(COALESCE(contact.flatform_type, ''))) = 'zalo'
      AND lower(btrim(COALESCE(contact.contact_type, ''))) = 'person'
      AND contact.account_id IS NOT DISTINCT FROM campaign.account_id
      AND NULLIF(btrim(COALESCE(contact.uid, '')), '') IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.auto_accounts AS account
        WHERE account.id = campaign.account_id
          AND account.staff_id = source.staff_id
          AND (account.organization_id IS NULL
            OR account.organization_id = source.organization_id)
          AND COALESCE(account.is_delete, false) = false
      )
  INTO
    v_action,
    v_account_id,
    v_contact_id,
    v_contact_uid,
    v_staff_id,
    v_organization_id,
    v_relationship_check_applicable
  FROM public.auto_campaign_data_group_sources AS source
  JOIN public.auto_campaigns AS campaign ON campaign.id = source.campaign_id
  JOIN public.auto_account_contact_group_members AS member
    ON member.id = p_membership_id AND member.group_id = source.group_id
  JOIN public.auto_account_contacts AS contact ON contact.id = member.contact_id
  WHERE source.id = p_source_id;

  IF FOUND AND v_relationship_check_applicable AND v_action IN (
    'zalo_message_group_member', 'zalo_message_remarketing_customer'
  ) THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.auto_account_contact_group_member_origins AS origin
      WHERE origin.membership_id = p_membership_id
        AND origin.is_current = true
        AND origin.source_account_id = v_account_id
        AND origin.relationship_kind = CASE v_action
          WHEN 'zalo_message_group_member' THEN 'zalo_group_members'
          ELSE 'zalo_remarketing_customers'
        END
    )
    INTO v_has_relationship;

    -- Group membership also has a durable account-scoped relation table. This
    -- fallback is intentionally unavailable to remarketing projections.
    IF NOT v_has_relationship AND v_action = 'zalo_message_group_member' THEN
      SELECT EXISTS (
        SELECT 1
        FROM public.zalo_group_members AS relation
        WHERE relation.account_id = v_account_id
          AND relation.zalo_uid = v_contact_uid
          AND relation.is_current = true
          AND (relation.staff_id IS NULL OR relation.staff_id = v_staff_id)
          AND (relation.organization_id IS NULL
            OR relation.organization_id = v_organization_id)
      )
      INTO v_has_relationship;
    END IF;

    IF NOT v_has_relationship THEN
      RETURN jsonb_build_object(
        'status', 'incompatible',
        'reason', CASE v_action
          WHEN 'zalo_message_group_member'
            THEN 'bound_zalo_group_member_relationship_required'
          ELSE 'bound_zalo_remarketing_relationship_required'
        END
      );
    END IF;
  END IF;

  RETURN public.aka_agent_internal_route_data_group_member_v186_internal(
    p_source_id, p_membership_id, p_batch_id, p_group_revision
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Convert legacy automation destinations that already point at Data Group.
-- ---------------------------------------------------------------------------

-- Detail rows snapshot rule headers, so migrate them before clearing the rule.
-- Existing explicit target_data_group_id always wins over the legacy header.
WITH candidates AS (
  SELECT
    detail.id,
    COALESCE(
      detail.target_data_group_id,
      CASE WHEN detail_group.purpose = 'data_group'
        THEN detail.target_contact_group_id END,
      CASE WHEN rule_group.purpose = 'data_group'
        THEN automation.target_contact_group_id END,
      CASE WHEN member_group.purpose = 'data_group'
        THEN legacy_member.group_id END
    ) AS resolved_group_id,
    detail_group.purpose = 'data_group' AS clear_legacy_group,
    member_group.purpose = 'data_group' AS clear_legacy_member,
    legacy_member.id AS legacy_member_id,
    legacy_member.group_id AS legacy_member_group_id
  FROM public.auto_automation_detail AS detail
  JOIN public.auto_automation AS automation ON automation.id = detail.automation_id
  LEFT JOIN public.auto_account_contact_groups AS detail_group
    ON detail_group.id = detail.target_contact_group_id
  LEFT JOIN public.auto_account_contact_groups AS rule_group
    ON rule_group.id = automation.target_contact_group_id
  LEFT JOIN public.auto_account_contact_group_members AS legacy_member
    ON legacy_member.id = detail.target_contact_group_member_id
  LEFT JOIN public.auto_account_contact_groups AS member_group
    ON member_group.id = legacy_member.group_id
  WHERE detail.target_data_group_id IS NOT NULL
    OR detail_group.purpose = 'data_group'
    OR rule_group.purpose = 'data_group'
    OR member_group.purpose = 'data_group'
), resolved AS (
  SELECT *
  FROM candidates
  WHERE resolved_group_id IS NOT NULL
)
UPDATE public.auto_automation_detail AS detail
SET target_data_group_id = resolved.resolved_group_id,
    target_contact_group_id = CASE WHEN resolved.clear_legacy_group
      THEN NULL ELSE detail.target_contact_group_id END,
    target_data_group_member_id = COALESCE(
      detail.target_data_group_member_id,
      CASE WHEN resolved.legacy_member_group_id = resolved.resolved_group_id
        THEN resolved.legacy_member_id END
    ),
    target_contact_group_member_id = CASE WHEN resolved.clear_legacy_member
      THEN NULL ELSE detail.target_contact_group_member_id END,
    target_data_group_sync_status = COALESCE(
      detail.target_data_group_sync_status,
      CASE
        WHEN detail.target_data_group_member_id IS NOT NULL
          OR resolved.legacy_member_group_id = resolved.resolved_group_id
          THEN 'completed'
        WHEN detail.status = 'bỏ qua' THEN 'skipped'
        ELSE 'pending'
      END
    ),
    config_snapshot = COALESCE(detail.config_snapshot, '{}'::jsonb)
      || jsonb_build_object('target_data_group_id', resolved.resolved_group_id),
    updated_at = now()
FROM resolved
WHERE detail.id = resolved.id;

UPDATE public.auto_automation AS automation
SET target_data_group_id = COALESCE(
      automation.target_data_group_id, automation.target_contact_group_id
    ),
    target_contact_group_id = NULL,
    updated_at = now()
FROM public.auto_account_contact_groups AS legacy_group
WHERE legacy_group.id = automation.target_contact_group_id
  AND legacy_group.purpose = 'data_group';

COMMENT ON FUNCTION public.aka_agent_derive_data_group_relationship_kind(bigint, bigint, bigint) IS
  'Internal exact-account relationship derivation for Data Group provenance.';
COMMENT ON FUNCTION public.aka_agent_stamp_data_group_relationship_kind() IS
  'Internal trigger that stamps relationship provenance on origin insert/copy/move.';
COMMENT ON FUNCTION public.aka_agent_internal_route_data_group_member(bigint, bigint, bigint, bigint) IS
  'Internal v190 router preflight; delegates all v186 routing after exact Zalo relationship checks.';
COMMENT ON FUNCTION public.aka_agent_ingest_data_group(
  bigint, bigint, text, bigint, text, jsonb, bigint, text, text, bigint, text, text
) IS
  'Service-role ingest entrypoint; accepts top-level per-row relationship_kind without changing RPC arity.';

-- Helpers, triggers and preserved implementations are never Data API entrypoints.
REVOKE ALL ON FUNCTION public.aka_agent_derive_data_group_relationship_kind(bigint, bigint, bigint)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.aka_agent_stamp_data_group_relationship_kind()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.aka_agent_internal_route_data_group_member(bigint, bigint, bigint, bigint)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.aka_agent_internal_route_data_group_member_v186_internal(bigint, bigint, bigint, bigint)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.aka_agent_ingest_data_group_v186_internal(
  bigint, bigint, text, bigint, text, jsonb, bigint, text, text, bigint, text, text
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.aka_agent_ingest_data_group(
  bigint, bigint, text, bigint, text, jsonb, bigint, text, text, bigint, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aka_agent_ingest_data_group(
  bigint, bigint, text, bigint, text, jsonb, bigint, text, text, bigint, text, text
) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
