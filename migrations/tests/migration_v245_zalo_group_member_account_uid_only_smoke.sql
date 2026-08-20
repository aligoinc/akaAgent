-- Rollback smoke for migration_v245_zalo_group_member_account_uid_only.sql.

BEGIN;

SET LOCAL statement_timeout = '5min';
SET LOCAL lock_timeout = '5s';

DO $metadata$
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
  v_live_router regprocedure := pg_catalog.to_regprocedure(
    'public.aka_agent_internal_route_data_group_member(bigint,bigint,bigint,bigint)'
  );
  v_v186 regprocedure := pg_catalog.to_regprocedure(
    'public.aka_agent_internal_route_data_group_member_v186_internal(bigint,bigint,bigint,bigint)'
  );
  v_preview_definition text;
  v_router_definition text;
  v_snapshot_definition text;
  v_live_router_definition text;
  v_v186_definition text;
BEGIN
  IF v_preview IS NULL OR v_router IS NULL OR v_snapshot IS NULL
    OR v_live_router IS NULL OR v_v186 IS NULL
  THEN
    RAISE EXCEPTION 'v245_smoke: required function missing';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(v_preview)
  INTO v_preview_definition;
  SELECT pg_catalog.pg_get_functiondef(v_router)
  INTO v_router_definition;
  SELECT pg_catalog.pg_get_functiondef(v_snapshot)
  INTO v_snapshot_definition;
  SELECT pg_catalog.pg_get_functiondef(v_live_router)
  INTO v_live_router_definition;
  SELECT pg_catalog.pg_get_functiondef(v_v186)
  INTO v_v186_definition;

  IF pg_catalog.md5(v_preview_definition) <>
      '823555d408e459ea347189b3c8c0f785'
    OR pg_catalog.md5(v_router_definition) <>
      'b863040f712a87462f1bef543f6cdd4a'
    OR pg_catalog.md5(v_snapshot_definition) <>
      '94048cb3085c23ae578f5cd722d8c7ba'
  THEN
    RAISE EXCEPTION 'v245_smoke: target checksum mismatch';
  END IF;

  IF pg_catalog.strpos(v_preview_definition, 'zalo_group_members') > 0
    OR pg_catalog.strpos(v_router_definition, 'zalo_group_members') > 0
    OR pg_catalog.strpos(v_snapshot_definition, 'zalo_group_members') > 0
    OR pg_catalog.strpos(
      v_router_definition,
      'bound_zalo_group_member_relationship_required'
    ) > 0
  THEN
    RAISE EXCEPTION 'v245_smoke: relationship proof still affects routing';
  END IF;

  IF pg_catalog.strpos(
      v_preview_definition,
      'v_contact.account_id IS DISTINCT FROM p_account_id'
    ) = 0
    OR pg_catalog.strpos(v_preview_definition, 'OR v_uid IS NULL') = 0
    OR pg_catalog.strpos(
      v_router_definition,
      'aka_agent_internal_route_data_group_member_v186_internal'
    ) = 0
    OR pg_catalog.strpos(
      v_v186_definition,
      $$v_platform <> 'zalo' OR v_contact_type <> 'person'$$
    ) = 0
    OR pg_catalog.strpos(
      v_v186_definition,
      'v_contact.account_id IS DISTINCT FROM v_campaign.account_id'
    ) = 0
    OR pg_catalog.strpos(
      v_v186_definition,
      $$IF NULLIF(v_target_value, '') IS NULL$$
    ) = 0
    OR pg_catalog.strpos(
      v_snapshot_definition,
      'v_contact.account_id IS DISTINCT FROM v_campaign.account_id'
    ) = 0
    OR pg_catalog.strpos(
      v_snapshot_definition,
      $$IF NULLIF(v_target_value, '') IS NULL$$
    ) = 0
  THEN
    RAISE EXCEPTION 'v245_smoke: account/person/UID guard drifted';
  END IF;

  IF pg_catalog.strpos(
      v_live_router_definition,
      'aka_agent_lock_campaign_input_serialization'
    ) = 0
    OR pg_catalog.strpos(
      v_live_router_definition,
      'aka_agent_internal_finalize_data_group_campaign_v219'
    ) = 0
    OR pg_catalog.strpos(
      v_snapshot_definition,
      'aka_agent_lock_campaign_input_serialization'
    ) = 0
    OR pg_catalog.strpos(
      v_snapshot_definition,
      'direct_campaign_runtime_not_owner'
    ) = 0
  THEN
    RAISE EXCEPTION 'v245_smoke: concurrency/runtime ownership guard drifted';
  END IF;

  IF pg_catalog.has_function_privilege('anon', v_preview, 'EXECUTE')
    OR pg_catalog.has_function_privilege('authenticated', v_preview, 'EXECUTE')
    OR pg_catalog.has_function_privilege('service_role', v_preview, 'EXECUTE')
    OR pg_catalog.has_function_privilege('anon', v_router, 'EXECUTE')
    OR pg_catalog.has_function_privilege('authenticated', v_router, 'EXECUTE')
    OR pg_catalog.has_function_privilege('service_role', v_router, 'EXECUTE')
    OR pg_catalog.has_function_privilege('anon', v_snapshot, 'EXECUTE')
    OR pg_catalog.has_function_privilege('authenticated', v_snapshot, 'EXECUTE')
    OR pg_catalog.has_function_privilege('service_role', v_snapshot, 'EXECUTE')
  THEN
    RAISE EXCEPTION 'v245_smoke: internal function became externally callable';
  END IF;
END;
$metadata$;

DO $behavior$
DECLARE
  v_staff_id bigint;
  v_organization_id bigint;
  v_group_id bigint;
  v_membership_id bigint;
  v_account_id bigint;
  v_uid text;
  v_target_key text;
  v_wrong_account_target_key text;
BEGIN
  SELECT
    contact.staff_id,
    contact.organization_id,
    member.group_id,
    member.id,
    contact.account_id,
    btrim(contact.uid)
  INTO
    v_staff_id,
    v_organization_id,
    v_group_id,
    v_membership_id,
    v_account_id,
    v_uid
  FROM public.auto_account_contact_group_members AS member
  JOIN public.auto_account_contacts AS contact
    ON contact.id = member.contact_id
  JOIN public.auto_account_contact_groups AS contact_group
    ON contact_group.id = member.group_id
  WHERE member.is_delete = false
    AND COALESCE(contact.is_delete, false) = false
    AND lower(btrim(COALESCE(contact.flatform_type, ''))) = 'zalo'
    AND lower(btrim(COALESCE(contact.contact_type, ''))) = 'person'
    AND NULLIF(btrim(COALESCE(contact.uid, '')), '') IS NOT NULL
    AND public.aka_agent_data_group_type_compatible(
      member.group_id, 'zalo_message_group_member'
    )
    AND public.aka_agent_data_group_membership_semantic_compatible(
      member.id, 'zalo_message_group_member', member.group_id
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.auto_account_contact_group_member_origins AS origin
      WHERE origin.membership_id = member.id
        AND origin.is_current = true
        AND origin.source_account_id = contact.account_id
        AND origin.relationship_kind = 'zalo_group_members'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.zalo_group_members AS relation
      WHERE relation.account_id = contact.account_id
        AND relation.zalo_uid = contact.uid
        AND relation.is_current = true
        AND (relation.staff_id IS NULL OR relation.staff_id = contact.staff_id)
        AND (
          relation.organization_id IS NULL
          OR relation.organization_id = contact.organization_id
        )
    )
  ORDER BY member.id
  LIMIT 1;

  IF v_membership_id IS NULL THEN
    RAISE NOTICE 'v245_smoke: no relationship-free production fixture; behavior lookup skipped';
    RETURN;
  END IF;

  v_target_key := public.aka_agent_internal_preview_data_group_target_key(
    v_staff_id,
    v_organization_id,
    v_group_id,
    v_membership_id,
    'zalo_message_group_member',
    v_account_id
  );
  v_wrong_account_target_key :=
    public.aka_agent_internal_preview_data_group_target_key(
      v_staff_id,
      v_organization_id,
      v_group_id,
      v_membership_id,
      'zalo_message_group_member',
      v_account_id + 1
    );

  IF v_target_key IS DISTINCT FROM
      ('bound:' || v_account_id::text || ':zalo_person:' || v_uid)
    OR v_wrong_account_target_key IS NOT NULL
  THEN
    RAISE EXCEPTION 'v245_smoke: account-bound UID-only behavior is wrong';
  END IF;
END;
$behavior$;

ROLLBACK;
