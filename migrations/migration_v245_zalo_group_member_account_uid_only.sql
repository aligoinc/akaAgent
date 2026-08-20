-- Zalo group-member messaging from a Data Group no longer requires proof that
-- the contact came from a current group-member scan. The semantic Zalo-person,
-- campaign-account ownership and non-empty UID guards remain authoritative.

BEGIN;

SET LOCAL statement_timeout = '5min';
SET LOCAL lock_timeout = '5s';

DO $preflight$
DECLARE
  v_preview regprocedure := pg_catalog.to_regprocedure(
    'public.aka_agent_internal_preview_data_group_target_key(bigint,bigint,bigint,bigint,text,bigint)'
  );
  v_router regprocedure := pg_catalog.to_regprocedure(
    'public.aka_agent_internal_route_data_group_member_v190_internal(bigint,bigint,bigint,bigint)'
  );
  v_snapshot regprocedure := pg_catalog.to_regprocedure(
    'public.aka_agent_snapshot_data_group_to_direct_campaign_v205_internal(bigint,bigint,text,bigint,bigint,timestamp with time zone,text,text,text)'
  );
  v_checksum text;
BEGIN
  IF v_preview IS NULL OR v_router IS NULL OR v_snapshot IS NULL THEN
    RAISE EXCEPTION 'v245_missing_data_group_routing_dependency';
  END IF;
  IF pg_catalog.to_regprocedure(
    'public.aka_agent_internal_route_data_group_member_v186_internal(bigint,bigint,bigint,bigint)'
  ) IS NULL THEN
    RAISE EXCEPTION 'v245_missing_v186_account_uid_router';
  END IF;

  SELECT pg_catalog.md5(pg_catalog.pg_get_functiondef(v_preview))
  INTO v_checksum;
  IF v_checksum NOT IN (
    '54460cd1805700321c327befe62ea7f9',
    '823555d408e459ea347189b3c8c0f785'
  ) THEN
    RAISE EXCEPTION 'v245_preview_definition_drift:%', v_checksum;
  END IF;

  SELECT pg_catalog.md5(pg_catalog.pg_get_functiondef(v_router))
  INTO v_checksum;
  IF v_checksum NOT IN (
    'eb4e21df9b3e7a31ba8cb30cc0ebd4bd',
    'b863040f712a87462f1bef543f6cdd4a'
  ) THEN
    RAISE EXCEPTION 'v245_router_definition_drift:%', v_checksum;
  END IF;

  SELECT pg_catalog.md5(pg_catalog.pg_get_functiondef(v_snapshot))
  INTO v_checksum;
  IF v_checksum NOT IN (
    'fb238e9d8f3afa759f82d48388599795',
    '94048cb3085c23ae578f5cd722d8c7ba'
  ) THEN
    RAISE EXCEPTION 'v245_snapshot_definition_drift:%', v_checksum;
  END IF;
END;
$preflight$;

DO $patch_preview$
DECLARE
  v_signature regprocedure := pg_catalog.to_regprocedure(
    'public.aka_agent_internal_preview_data_group_target_key(bigint,bigint,bigint,bigint,text,bigint)'
  );
  v_definition text;
  v_old_declaration text := $old$  v_has_relationship boolean := false;
$old$;
  v_old_guard text := $old$    IF v_action = 'zalo_message_group_member' THEN
      SELECT EXISTS (
        SELECT 1
        FROM public.auto_account_contact_group_member_origins AS origin
        WHERE origin.membership_id = p_membership_id
          AND origin.is_current = true
          AND origin.source_account_id = p_account_id
          AND origin.relationship_kind = 'zalo_group_members'
      ) OR EXISTS (
        SELECT 1
        FROM public.zalo_group_members AS relation
        WHERE relation.account_id = p_account_id
          AND relation.zalo_uid = v_uid
          AND relation.is_current = true
          AND (relation.staff_id IS NULL OR relation.staff_id = p_staff_id)
          AND (
            relation.organization_id IS NULL
            OR relation.organization_id = p_organization_id
          )
      )
      INTO v_has_relationship;
      IF NOT v_has_relationship THEN
        RETURN NULL;
      END IF;
    END IF;
$old$;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(v_signature) INTO v_definition;
  IF pg_catalog.md5(v_definition) =
    '54460cd1805700321c327befe62ea7f9'
  THEN
    IF (
      pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(
          v_definition, v_old_declaration, ''
        ))
    ) <> pg_catalog.length(v_old_declaration)
      OR (
        pg_catalog.length(v_definition)
        - pg_catalog.length(pg_catalog.replace(v_definition, v_old_guard, ''))
      ) <> pg_catalog.length(v_old_guard)
    THEN
      RAISE EXCEPTION 'v245_unexpected_preview_relationship_shape';
    END IF;
    v_definition := pg_catalog.replace(
      v_definition, v_old_declaration, ''
    );
    v_definition := pg_catalog.replace(v_definition, v_old_guard, '');
    EXECUTE v_definition;
  END IF;
END;
$patch_preview$;

DO $patch_router$
DECLARE
  v_signature regprocedure := pg_catalog.to_regprocedure(
    'public.aka_agent_internal_route_data_group_member_v190_internal(bigint,bigint,bigint,bigint)'
  );
  v_checksum text;
BEGIN
  SELECT pg_catalog.md5(pg_catalog.pg_get_functiondef(v_signature))
  INTO v_checksum;
  IF v_checksum = 'eb4e21df9b3e7a31ba8cb30cc0ebd4bd' THEN
    EXECUTE $ddl$
      CREATE OR REPLACE FUNCTION public.aka_agent_internal_route_data_group_member_v190_internal(
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
      BEGIN
        -- v186 already enforces Zalo person, campaign-account ownership and a
        -- non-empty UID. v245 intentionally removes only relationship proof.
        RETURN public.aka_agent_internal_route_data_group_member_v186_internal(
          p_source_id, p_membership_id, p_batch_id, p_group_revision
        );
      END;
      $function$
    $ddl$;
  END IF;
END;
$patch_router$;

DO $patch_direct_snapshot$
DECLARE
  v_signature regprocedure := pg_catalog.to_regprocedure(
    'public.aka_agent_snapshot_data_group_to_direct_campaign_v205_internal(bigint,bigint,text,bigint,bigint,timestamp with time zone,text,text,text)'
  );
  v_definition text;
  v_old_declaration text := $old$  v_has_relationship boolean;
$old$;
  v_old_reset text := $old$    v_has_relationship := false;
$old$;
  v_old_guard text := $old$      IF v_action = 'zalo_message_group_member' THEN
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
$old$;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(v_signature) INTO v_definition;
  IF pg_catalog.md5(v_definition) =
    'fb238e9d8f3afa759f82d48388599795'
  THEN
    IF (
      pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(
          v_definition, v_old_declaration, ''
        ))
    ) <> pg_catalog.length(v_old_declaration)
      OR (
        pg_catalog.length(v_definition)
        - pg_catalog.length(pg_catalog.replace(v_definition, v_old_reset, ''))
      ) <> pg_catalog.length(v_old_reset)
      OR (
        pg_catalog.length(v_definition)
        - pg_catalog.length(pg_catalog.replace(v_definition, v_old_guard, ''))
      ) <> pg_catalog.length(v_old_guard)
    THEN
      RAISE EXCEPTION 'v245_unexpected_snapshot_relationship_shape';
    END IF;
    v_definition := pg_catalog.replace(
      v_definition, v_old_declaration, ''
    );
    v_definition := pg_catalog.replace(v_definition, v_old_reset, '');
    v_definition := pg_catalog.replace(v_definition, v_old_guard, '');
    EXECUTE v_definition;
  END IF;
END;
$patch_direct_snapshot$;

COMMENT ON FUNCTION public.aka_agent_internal_route_data_group_member_v190_internal(
  bigint, bigint, bigint, bigint
) IS
  'Internal compatibility layer delegating to v186; Zalo group-member and remarketing targets use account-bound person/UID checks without relationship proof.';

COMMENT ON FUNCTION public.aka_agent_snapshot_data_group_to_direct_campaign_v205_internal(
  bigint, bigint, text, bigint, bigint, timestamptz, text, text, text
) IS
  'Idempotent whole-group snapshot into a direct campaign; Zalo group-member targets require an account-bound person UID without relationship proof, while ownership, semantic and canonical guards remain unchanged.';

NOTIFY pgrst, 'reload schema';

DO $postflight$
DECLARE
  v_preview regprocedure := pg_catalog.to_regprocedure(
    'public.aka_agent_internal_preview_data_group_target_key(bigint,bigint,bigint,bigint,text,bigint)'
  );
  v_router regprocedure := pg_catalog.to_regprocedure(
    'public.aka_agent_internal_route_data_group_member_v190_internal(bigint,bigint,bigint,bigint)'
  );
  v_snapshot regprocedure := pg_catalog.to_regprocedure(
    'public.aka_agent_snapshot_data_group_to_direct_campaign_v205_internal(bigint,bigint,text,bigint,bigint,timestamp with time zone,text,text,text)'
  );
BEGIN
  IF pg_catalog.md5(pg_catalog.pg_get_functiondef(v_preview)) <>
      '823555d408e459ea347189b3c8c0f785'
    OR pg_catalog.md5(pg_catalog.pg_get_functiondef(v_router)) <>
      'b863040f712a87462f1bef543f6cdd4a'
    OR pg_catalog.md5(pg_catalog.pg_get_functiondef(v_snapshot)) <>
      '94048cb3085c23ae578f5cd722d8c7ba'
  THEN
    RAISE EXCEPTION 'v245_target_checksum_mismatch';
  END IF;
END;
$postflight$;

COMMIT;
