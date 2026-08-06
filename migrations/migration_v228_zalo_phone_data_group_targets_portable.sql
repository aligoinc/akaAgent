-- Zalo phone-target campaigns accept every valid normalized phone number from
-- a Data Group. Source semantic type and legacy contact metadata must not stop
-- the portable phone branch; the UID fallback of zalo_add_group_member keeps
-- the existing Zalo/account-bound validation in the v186 materializer.

BEGIN;

CREATE OR REPLACE FUNCTION public.aka_agent_data_group_membership_has_valid_phone(
  p_membership_id bigint,
  p_group_id bigint
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.auto_account_contact_group_members AS member
    JOIN public.auto_account_contacts AS contact
      ON contact.id = member.contact_id
    WHERE member.id = p_membership_id
      AND member.group_id = p_group_id
      AND member.is_delete = false
      AND COALESCE(contact.is_delete, false) = false
      AND NULLIF(public.aka_agent_internal_normalize_phone(COALESCE(
        NULLIF(contact.phone, ''),
        NULLIF(contact.extra_data ->> 'phone', ''),
        CASE
          WHEN lower(btrim(COALESCE(contact.contact_type, ''))) = 'phone'
            THEN contact.uid
          ELSE NULL
        END,
        ''
      )), '') IS NOT NULL
  );
$function$;

REVOKE ALL ON FUNCTION public.aka_agent_data_group_membership_has_valid_phone(
  bigint, bigint
) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.aka_agent_data_group_type_compatible(
  p_group_id bigint,
  p_campaign_action_id text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.auto_account_contact_groups AS contact_group
    WHERE contact_group.id = p_group_id
      AND contact_group.purpose = 'data_group'
      AND contact_group.is_delete = false
      AND (
        -- v228: phone validity is the only Data Group compatibility rule for
        -- these two Zalo phone-target routes.
        btrim(COALESCE(p_campaign_action_id, '')) IN (
          'zalo_message_phone', 'zalo_add_group_member'
        )
        OR contact_group.data_type_category_item_id IS NULL
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
$function$;

CREATE OR REPLACE FUNCTION public.aka_agent_propagate_campaign_origin_semantic_type()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_category_item_id bigint;
  v_existing_category_item_id bigint;
  v_action_id text;
  v_input_has_valid_phone boolean := false;
BEGIN
  IF NEW.group_id IS NOT NULL THEN
    SELECT
      campaign.action_id,
      NULLIF(public.aka_agent_internal_normalize_phone(COALESCE(
        input_data.phone, ''
      )), '') IS NOT NULL
    INTO v_action_id, v_input_has_valid_phone
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

    IF v_action_id IN ('zalo_message_phone', 'zalo_add_group_member')
      AND v_input_has_valid_phone
    THEN
      -- v228: the materialized phone determines semantic identity. Never copy
      -- an unrelated source group's/contact's semantic type onto this input.
      v_category_item_id :=
        public.aka_agent_data_type_category_item_id('phone');
    ELSE
      SELECT contact_group.data_type_category_item_id
      INTO v_category_item_id
      FROM public.auto_account_contact_groups AS contact_group
      WHERE contact_group.id = NEW.group_id;
    END IF;
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
$function$;

-- Keep the v219 lock/finalization wrapper and bypass its member semantic guard
-- only when the selected action will take the portable valid-phone branch.
CREATE OR REPLACE FUNCTION public.aka_agent_internal_route_data_group_member(
  p_source_id bigint,
  p_membership_id bigint,
  p_batch_id bigint,
  p_group_revision bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog, public
AS $function$
DECLARE
  v_campaign_id bigint;
  v_action_id text;
  v_group_id bigint;
  v_staff_id bigint;
  v_organization_id bigint;
  v_campaign_is_delete boolean;
  v_campaign_schedule_end_date timestamptz;
BEGIN
  SELECT
    campaign.id,
    campaign.action_id,
    source.group_id,
    campaign.staff_id,
    campaign.organization_id
  INTO
    v_campaign_id,
    v_action_id,
    v_group_id,
    v_staff_id,
    v_organization_id
  FROM public.auto_campaign_data_group_sources AS source
  JOIN public.auto_campaigns AS campaign
    ON campaign.id = source.campaign_id
  WHERE source.id = p_source_id;

  IF v_campaign_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.auto_account_contact_group_members AS member
      WHERE member.id = p_membership_id
        AND member.group_id = v_group_id
    )
    AND NOT (
      -- v228: valid-phone routes ignore semantic/platform/contact/account and
      -- relationship metadata. UID-only add-member routing does not enter here.
      v_action_id IN ('zalo_message_phone', 'zalo_add_group_member')
      AND public.aka_agent_data_group_membership_has_valid_phone(
        p_membership_id, v_group_id
      )
    )
    AND NOT public.aka_agent_data_group_membership_semantic_compatible(
      p_membership_id, v_action_id, v_group_id
    )
  THEN
    RETURN jsonb_build_object(
      'status', 'incompatible',
      'reason', 'data_group_member_semantic_type_mismatch'
    );
  END IF;

  IF v_campaign_id IS NOT NULL THEN
    PERFORM public.aka_agent_lock_campaign_input_serialization(v_campaign_id);

    SELECT
      COALESCE(campaign.is_delete, false),
      campaign.schedule_end_date
    INTO
      v_campaign_is_delete,
      v_campaign_schedule_end_date
    FROM public.auto_campaigns AS campaign
    WHERE campaign.id = v_campaign_id
      AND campaign.staff_id = v_staff_id
      AND campaign.organization_id = v_organization_id
      AND campaign.data_target_source_mode = 'data_group'
    FOR UPDATE OF campaign;

    IF FOUND AND (
      v_campaign_is_delete
      OR (
        v_campaign_schedule_end_date IS NOT NULL
        AND v_campaign_schedule_end_date <= now()
      )
    ) THEN
      PERFORM public.aka_agent_internal_finalize_data_group_campaign_v219(
        v_staff_id,
        v_organization_id,
        v_campaign_id,
        CASE
          WHEN v_campaign_is_delete THEN 'Chiến dịch đã bị xoá'
          ELSE 'Chiến dịch đã hết hạn'
        END
      );
      RETURN jsonb_build_object(
        'status', 'no_intake', 'reason', 'campaign_hard_ended'
      );
    END IF;
  END IF;

  RETURN public.aka_agent_internal_route_data_group_member_v205_internal(
    p_source_id, p_membership_id, p_batch_id, p_group_revision
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.aka_agent_internal_route_data_group_member(
  bigint, bigint, bigint, bigint
) FROM PUBLIC, anon, authenticated, service_role;

DO $patch_direct_snapshot_phone_semantic_guard$
DECLARE
  v_signature regprocedure := pg_catalog.to_regprocedure(
    'public.aka_agent_snapshot_data_group_to_direct_campaign_v205_internal(bigint,bigint,text,bigint,bigint,timestamp with time zone,text,text,text)'
  );
  v_definition text;
  v_old text := $old$
    IF NOT public.aka_agent_data_group_membership_semantic_compatible(
      v_member.id, v_action, v_group.id
    ) THEN
      v_incompatible := v_incompatible + 1;
      CONTINUE;
    END IF;$old$;
  v_new text := $new$
    IF NOT (
      -- v228: valid-phone routes ignore all source semantic and contact
      -- metadata constraints; UID-only add-member still uses the old guard.
      v_action IN ('zalo_message_phone', 'zalo_add_group_member')
      AND public.aka_agent_data_group_membership_has_valid_phone(
        v_member.id, v_group.id
      )
    ) AND NOT public.aka_agent_data_group_membership_semantic_compatible(
      v_member.id, v_action, v_group.id
    ) THEN
      v_incompatible := v_incompatible + 1;
      CONTINUE;
    END IF;$new$;
BEGIN
  IF v_signature IS NULL THEN
    RAISE EXCEPTION 'missing_v205_direct_snapshot_for_v228';
  END IF;
  SELECT pg_catalog.pg_get_functiondef(v_signature) INTO v_definition;
  IF pg_catalog.strpos(v_definition, 'v228: valid-phone routes ignore all source') = 0 THEN
    IF (
      length(v_definition) - length(pg_catalog.replace(v_definition, v_old, ''))
    ) <> length(v_old) THEN
      RAISE EXCEPTION 'unexpected_direct_snapshot_semantic_guard_shape_for_v228';
    END IF;
    EXECUTE pg_catalog.replace(v_definition, v_old, v_new);
  END IF;
END;
$patch_direct_snapshot_phone_semantic_guard$;

DO $patch_preview_phone_semantic_guard$
DECLARE
  v_signature regprocedure := pg_catalog.to_regprocedure(
    'public.aka_agent_internal_preview_data_group_target_key(bigint,bigint,bigint,bigint,text,bigint)'
  );
  v_definition text;
  v_old text := $old$
  IF NOT public.aka_agent_data_group_membership_semantic_compatible(
    p_membership_id, v_action, p_group_id
  ) THEN
    RETURN NULL;
  END IF;$old$;
  v_new text := $new$
  IF NOT (
    -- v228: preview applies the same valid-phone-only route as materialization.
    v_action IN ('zalo_message_phone', 'zalo_add_group_member')
    AND public.aka_agent_data_group_membership_has_valid_phone(
      p_membership_id, p_group_id
    )
  ) AND NOT public.aka_agent_data_group_membership_semantic_compatible(
    p_membership_id, v_action, p_group_id
  ) THEN
    RETURN NULL;
  END IF;$new$;
BEGIN
  IF v_signature IS NULL THEN
    RAISE EXCEPTION 'missing_v225_data_group_preview_for_v228';
  END IF;
  SELECT pg_catalog.pg_get_functiondef(v_signature) INTO v_definition;
  IF pg_catalog.strpos(v_definition, 'v228: preview applies the same valid-phone-only') = 0 THEN
    IF (
      length(v_definition) - length(pg_catalog.replace(v_definition, v_old, ''))
    ) <> length(v_old) THEN
      RAISE EXCEPTION 'unexpected_preview_semantic_guard_shape_for_v228';
    END IF;
    EXECUTE pg_catalog.replace(v_definition, v_old, v_new);
  END IF;
END;
$patch_preview_phone_semantic_guard$;

NOTIFY pgrst, 'reload schema';

COMMIT;
