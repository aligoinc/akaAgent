-- Reuse legacy direct-campaign inputs when taking a one-time Data Group
-- snapshot.
--
-- Direct inputs created before canonical delivery keys intentionally retain
-- canonical_target_key = NULL.  The v195 snapshot RPC only checked canonical
-- rows, so a later whole-group snapshot could create a second input for an
-- already-seen phone/email/UID.  Keep those legacy rows immutable: match them
-- with the same action-aware normalizers, attach aliases/origin provenance to
-- the existing input, and create a canonical row only when no active input is
-- reusable.
--
-- v197 patched the same RPC's Zalo remarketing routing after v195.  Patch the
-- installed definition in place so that routing, authentication, locking,
-- idempotency, SECURITY DEFINER settings, and the public 9-argument contract
-- remain unchanged.

BEGIN;

DO $preflight$
BEGIN
  IF pg_catalog.to_regprocedure(
    'public.aka_agent_snapshot_data_group_to_direct_campaign(bigint,bigint,text,bigint,bigint,timestamptz,text,text,text)'
  ) IS NULL THEN
    RAISE EXCEPTION 'missing_v197_direct_campaign_snapshot';
  END IF;
  IF pg_catalog.to_regprocedure(
    'public.aka_agent_internal_normalize_phone(text)'
  ) IS NULL THEN
    RAISE EXCEPTION 'missing_data_group_phone_normalizer';
  END IF;
  IF pg_catalog.to_regprocedure(
    'public.aka_agent_internal_normalize_facebook_identity(text)'
  ) IS NULL THEN
    RAISE EXCEPTION 'missing_data_group_facebook_normalizer';
  END IF;
  IF pg_catalog.to_regclass(
    'public.auto_campaign_input_target_aliases'
  ) IS NULL THEN
    RAISE EXCEPTION 'missing_campaign_input_target_aliases';
  END IF;
END;
$preflight$;

DO $patch_direct_snapshot$
DECLARE
  v_signature regprocedure := pg_catalog.to_regprocedure(
    'public.aka_agent_snapshot_data_group_to_direct_campaign(bigint,bigint,text,bigint,bigint,timestamptz,text,text,text)'
  );
  v_definition text;
  v_old text := $old$
    -- Legacy direct rows deliberately keep canonical_target_key=NULL. Snapshot
    -- dedupe starts with canonical inputs and never guesses/backfills identity.
    INSERT INTO public.auto_campaign_input_data (
      campaign_id, input_id, name, phone, phone_carrier, uid, email,
      info1, info2, info3, info4, info5, status, schedule, is_delete,
      canonical_target_key, created_at
    ) VALUES (
      v_campaign.id, NULL, COALESCE(v_name, v_target_value),
      v_input_phone, v_phone_carrier, v_input_uid, v_input_email,
      v_info1, v_info2, v_info3, v_info4, v_info5,
      'chờ xử lý', p_campaign_schedule, false,
      v_canonical_key, now()
    )
    ON CONFLICT (campaign_id, canonical_target_key)
      WHERE canonical_target_key IS NOT NULL AND COALESCE(is_delete, false) = false
    DO NOTHING
    RETURNING id INTO v_input_id;

    IF v_input_id IS NULL THEN
      SELECT input_data.id
      INTO v_input_id
      FROM public.auto_campaign_input_data AS input_data
      WHERE input_data.campaign_id = v_campaign.id
        AND input_data.canonical_target_key = v_canonical_key
        AND COALESCE(input_data.is_delete, false) = false
      FOR UPDATE;
    ELSE
      v_inserted_row := true;
    END IF;
$old$;
  v_new text := $new$
    -- Reuse order for one-time snapshots:
    --   1. the active canonical row;
    --   2. an active row already mapped by one of this target's aliases;
    --   3. the oldest active legacy row whose action target normalizes equally;
    --   4. a newly inserted canonical row.
    -- Legacy rows remain canonical_target_key=NULL.  Aliases and immutable
    -- origin provenance below make every later snapshot resolve to that row.
    SELECT input_data.id
    INTO v_input_id
    FROM public.auto_campaign_input_data AS input_data
    WHERE input_data.campaign_id = v_campaign.id
      AND input_data.canonical_target_key = v_canonical_key
      AND COALESCE(input_data.is_delete, false) = false
    ORDER BY input_data.id
    LIMIT 1
    FOR UPDATE;

    IF v_input_id IS NULL THEN
      SELECT input_data.id
      INTO v_input_id
      FROM public.auto_campaign_input_target_aliases AS alias
      JOIN public.auto_campaign_input_data AS input_data
        ON input_data.id = alias.input_data_id
       AND input_data.campaign_id = v_campaign.id
       AND COALESCE(input_data.is_delete, false) = false
       AND (
         input_data.canonical_target_key IS NULL
         OR input_data.canonical_target_key = v_canonical_key
       )
      WHERE alias.campaign_id = v_campaign.id
        AND alias.canonical_target_key = v_canonical_key
        AND alias.alias_key = ANY(v_aliases)
      ORDER BY input_data.id
      LIMIT 1
      FOR UPDATE OF input_data;
    END IF;

    IF v_input_id IS NULL THEN
      SELECT input_data.id
      INTO v_input_id
      FROM public.auto_campaign_input_data AS input_data
      WHERE input_data.campaign_id = v_campaign.id
        AND input_data.canonical_target_key IS NULL
        AND COALESCE(input_data.is_delete, false) = false
        AND CASE
          WHEN v_target_kind = 'phone' THEN
            public.aka_agent_internal_normalize_phone(
              COALESCE(input_data.phone, '')
            ) = v_identity_value
          WHEN v_target_kind = 'email' THEN
            lower(btrim(COALESCE(input_data.email, ''))) = v_identity_value
          WHEN v_target_kind LIKE 'facebook_%' THEN
            (
              v_scope || ':' || v_target_kind || ':' ||
              public.aka_agent_internal_normalize_facebook_identity(
                COALESCE(input_data.uid, '')
              )
            ) = ANY(v_aliases)
          ELSE
            btrim(COALESCE(input_data.uid, '')) = v_identity_value
        END
      ORDER BY input_data.id
      LIMIT 1
      FOR UPDATE;
    END IF;

    IF v_input_id IS NULL THEN
      INSERT INTO public.auto_campaign_input_data (
        campaign_id, input_id, name, phone, phone_carrier, uid, email,
        info1, info2, info3, info4, info5, status, schedule, is_delete,
        canonical_target_key, created_at
      ) VALUES (
        v_campaign.id, NULL, COALESCE(v_name, v_target_value),
        v_input_phone, v_phone_carrier, v_input_uid, v_input_email,
        v_info1, v_info2, v_info3, v_info4, v_info5,
        'chờ xử lý', p_campaign_schedule, false,
        v_canonical_key, now()
      )
      ON CONFLICT (campaign_id, canonical_target_key)
        WHERE canonical_target_key IS NOT NULL AND COALESCE(is_delete, false) = false
      DO NOTHING
      RETURNING id INTO v_input_id;

      IF v_input_id IS NULL THEN
        SELECT input_data.id
        INTO v_input_id
        FROM public.auto_campaign_input_data AS input_data
        WHERE input_data.campaign_id = v_campaign.id
          AND input_data.canonical_target_key = v_canonical_key
          AND COALESCE(input_data.is_delete, false) = false
        FOR UPDATE;
      ELSE
        v_inserted_row := true;
      END IF;
    END IF;
$new$;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(v_signature)
  INTO v_definition;

  -- Safe to re-run locally or in a rebuilt environment.
  IF pg_catalog.strpos(
    v_definition,
    'Reuse order for one-time snapshots:'
  ) > 0 THEN
    RETURN;
  END IF;

  -- v197 must already be present.  This also prevents accidentally restoring
  -- the earlier remarketing relationship requirement through an unexpected
  -- function definition.
  IF pg_catalog.strpos(
    v_definition,
    $$IF v_action = 'zalo_message_group_member' THEN$$
  ) = 0 THEN
    RAISE EXCEPTION 'missing_v197_direct_snapshot_routing';
  END IF;

  IF (
    pg_catalog.length(v_definition)
    - pg_catalog.length(pg_catalog.replace(v_definition, v_old, ''))
  ) <> pg_catalog.length(v_old) THEN
    RAISE EXCEPTION 'unexpected_direct_snapshot_insert_shape';
  END IF;

  EXECUTE pg_catalog.replace(v_definition, v_old, v_new);

  SELECT pg_catalog.pg_get_functiondef(v_signature)
  INTO v_definition;
  IF pg_catalog.strpos(
    v_definition,
    'Reuse order for one-time snapshots:'
  ) = 0
    OR pg_catalog.strpos(
      v_definition,
      $$IF v_action = 'zalo_message_group_member' THEN$$
    ) = 0
  THEN
    RAISE EXCEPTION 'direct_snapshot_dedupe_patch_verification_failed';
  END IF;
END;
$patch_direct_snapshot$;

COMMENT ON FUNCTION public.aka_agent_snapshot_data_group_to_direct_campaign(
  bigint, bigint, text, bigint, bigint, timestamptz, text, text, text
) IS
  'Idempotent whole-group snapshot into a direct campaign; preserves v197 routing and reuses active normalized legacy or alias-mapped inputs without backfilling canonical keys.';

REVOKE ALL ON FUNCTION public.aka_agent_snapshot_data_group_to_direct_campaign(
  bigint, bigint, text, bigint, bigint, timestamptz, text, text, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aka_agent_snapshot_data_group_to_direct_campaign(
  bigint, bigint, text, bigint, bigint, timestamptz, text, text, text
) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
