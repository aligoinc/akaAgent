-- Route Zalo remarketing Data Group contacts by account ownership alone.
--
-- Relationship provenance remains stored and exposed for audit. Only the
-- exact zalo_message_remarketing_customer delivery contract changes: a
-- current Zalo person contact with a non-empty UID is compatible when its
-- account_id matches the campaign account. Friend-status and group-member
-- relationship requirements remain unchanged.
--
-- This migration deliberately does not rewrite provenance or replay historical
-- memberships. Future ingest and ordinary source reactivation use the patched
-- router, while existing audit rows remain byte-for-byte intact.

BEGIN;

DO $preflight$
BEGIN
  IF pg_catalog.to_regprocedure(
    'public.aka_agent_internal_route_data_group_member_v190_internal(bigint,bigint,bigint,bigint)'
  ) IS NULL THEN
    RAISE EXCEPTION 'missing_v190_data_group_router';
  END IF;
  IF pg_catalog.to_regprocedure(
    'public.aka_agent_internal_route_data_group_member_v186_internal(bigint,bigint,bigint,bigint)'
  ) IS NULL THEN
    RAISE EXCEPTION 'missing_v186_data_group_router';
  END IF;
  IF pg_catalog.to_regprocedure(
    'public.aka_agent_snapshot_data_group_to_direct_campaign(bigint,bigint,text,bigint,bigint,timestamptz,text,text,text)'
  ) IS NULL THEN
    RAISE EXCEPTION 'missing_v195_direct_campaign_snapshot';
  END IF;
END;
$preflight$;

-- v193's live router delegates to this preserved v190 layer for every
-- baseline, ingest, move, reactivation and automation intake. Keep the exact
-- group-member proof, while allowing remarketing to reach the v186 routing
-- matrix where platform/person/account/UID checks are already authoritative.
CREATE OR REPLACE FUNCTION public.aka_agent_internal_route_data_group_member_v190_internal(
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

  IF FOUND
    AND v_relationship_check_applicable
    AND v_action = 'zalo_message_group_member'
  THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.auto_account_contact_group_member_origins AS origin
      WHERE origin.membership_id = p_membership_id
        AND origin.is_current = true
        AND origin.source_account_id = v_account_id
        AND origin.relationship_kind = 'zalo_group_members'
    )
    INTO v_has_relationship;

    IF NOT v_has_relationship THEN
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
        'reason', 'bound_zalo_group_member_relationship_required'
      );
    END IF;
  END IF;

  RETURN public.aka_agent_internal_route_data_group_member_v186_internal(
    p_source_id, p_membership_id, p_batch_id, p_group_revision
  );
END;
$$;

-- v195 copied the routing matrix for one-time snapshots. Patch only its
-- relationship sub-block so all unrelated snapshot behavior remains byte-for-
-- byte identical to the installed definition.
DO $patch_direct_snapshot$
DECLARE
  v_signature regprocedure := pg_catalog.to_regprocedure(
    'public.aka_agent_snapshot_data_group_to_direct_campaign(bigint,bigint,text,bigint,bigint,timestamptz,text,text,text)'
  );
  v_definition text;
  v_old text := $old$
      IF v_action IN ('zalo_message_group_member', 'zalo_message_remarketing_customer') THEN
        SELECT EXISTS (
          SELECT 1
          FROM public.auto_account_contact_group_member_origins AS origin
          WHERE origin.membership_id = v_member.id
            AND origin.is_current = true
            AND origin.source_account_id = v_campaign.account_id
            AND origin.relationship_kind = CASE v_action
              WHEN 'zalo_message_group_member' THEN 'zalo_group_members'
              ELSE 'zalo_remarketing_customers'
            END
        ) INTO v_has_relationship;
        IF NOT v_has_relationship AND v_action = 'zalo_message_group_member' THEN
          SELECT EXISTS (
            SELECT 1
            FROM public.zalo_group_members AS relation
            WHERE relation.account_id = v_campaign.account_id
              AND relation.zalo_uid = v_uid
              AND relation.is_current = true
              AND (relation.staff_id IS NULL OR relation.staff_id = p_staff_id)
              AND (relation.organization_id IS NULL OR relation.organization_id = p_organization_id)
          ) INTO v_has_relationship;
        END IF;
        IF NOT v_has_relationship THEN
          v_incompatible := v_incompatible + 1; CONTINUE;
        END IF;
      END IF;
$old$;
  v_new text := $new$
      IF v_action = 'zalo_message_group_member' THEN
        SELECT EXISTS (
          SELECT 1
          FROM public.auto_account_contact_group_member_origins AS origin
          WHERE origin.membership_id = v_member.id
            AND origin.is_current = true
            AND origin.source_account_id = v_campaign.account_id
            AND origin.relationship_kind = 'zalo_group_members'
        ) INTO v_has_relationship;
        IF NOT v_has_relationship THEN
          SELECT EXISTS (
            SELECT 1
            FROM public.zalo_group_members AS relation
            WHERE relation.account_id = v_campaign.account_id
              AND relation.zalo_uid = v_uid
              AND relation.is_current = true
              AND (relation.staff_id IS NULL OR relation.staff_id = p_staff_id)
              AND (relation.organization_id IS NULL OR relation.organization_id = p_organization_id)
          ) INTO v_has_relationship;
        END IF;
        IF NOT v_has_relationship THEN
          v_incompatible := v_incompatible + 1; CONTINUE;
        END IF;
      END IF;
$new$;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(v_signature)
  INTO v_definition;

  IF pg_catalog.strpos(
    v_definition,
    'bound_zalo_remarketing_relationship_required'
  ) > 0 THEN
    RAISE EXCEPTION 'unexpected_v195_remarketing_reason_marker';
  END IF;

  IF pg_catalog.strpos(v_definition, 'zalo_remarketing_customers') = 0
    AND pg_catalog.strpos(
      v_definition,
      $$IF v_action = 'zalo_message_group_member' THEN$$
    ) > 0
  THEN
    RETURN;
  END IF;

  IF (
    pg_catalog.length(v_definition)
    - pg_catalog.length(pg_catalog.replace(v_definition, v_old, ''))
  ) <> pg_catalog.length(v_old) THEN
    RAISE EXCEPTION 'unexpected_v195_direct_snapshot_relationship_shape';
  END IF;

  EXECUTE pg_catalog.replace(v_definition, v_old, v_new);
END;
$patch_direct_snapshot$;

COMMENT ON FUNCTION public.aka_agent_internal_route_data_group_member_v190_internal(
  bigint, bigint, bigint, bigint
) IS
  'Internal v190 compatibility layer: group-member routing requires exact relationship proof; remarketing delegates to account-bound v186 person/UID checks.';
COMMENT ON FUNCTION public.aka_agent_internal_route_data_group_member(
  bigint, bigint, bigint, bigint
) IS
  'Internal v193 staged-bundle intake gate; live routing delegates to v190/v186, with remarketing scoped by campaign account rather than relationship origin.';
COMMENT ON FUNCTION public.aka_agent_snapshot_data_group_to_direct_campaign(
  bigint, bigint, text, bigint, bigint, timestamptz, text, text, text
) IS
  'Idempotent one-time snapshot into a direct campaign; Zalo remarketing accepts account-bound person contacts with a valid UID while preserving origin provenance.';

-- These remain internal implementations, including after CREATE OR REPLACE.
REVOKE ALL ON FUNCTION public.aka_agent_internal_route_data_group_member_v190_internal(
  bigint, bigint, bigint, bigint
) FROM PUBLIC, anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
