-- Catalog-only smoke test for
-- migration_v197_zalo_remarketing_account_only_routing.sql.
--
-- Run after v197. It verifies the exact routing delta without inserting or
-- rewriting contacts, memberships or origin provenance.

BEGIN;

SET LOCAL statement_timeout = '5min';
SET LOCAL lock_timeout = '5s';

DO $smoke$
DECLARE
  v_live_definition text;
  v_v190_definition text;
  v_v186_definition text;
  v_snapshot_definition text;
BEGIN
  IF pg_catalog.to_regprocedure(
    'public.aka_agent_internal_route_data_group_member(bigint,bigint,bigint,bigint)'
  ) IS NULL
    OR pg_catalog.to_regprocedure(
      'public.aka_agent_internal_route_data_group_member_v190_internal(bigint,bigint,bigint,bigint)'
    ) IS NULL
    OR pg_catalog.to_regprocedure(
      'public.aka_agent_internal_route_data_group_member_v186_internal(bigint,bigint,bigint,bigint)'
    ) IS NULL
    OR pg_catalog.to_regprocedure(
      'public.aka_agent_snapshot_data_group_to_direct_campaign(bigint,bigint,text,bigint,bigint,timestamptz,text,text,text)'
    ) IS NULL
  THEN
    RAISE EXCEPTION 'v197_smoke: required Data Group routing function is missing';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(
    'public.aka_agent_internal_route_data_group_member(bigint,bigint,bigint,bigint)'::regprocedure
  ) INTO v_live_definition;
  IF pg_catalog.strpos(
    v_live_definition,
    'aka_agent_internal_route_data_group_member_v190_internal'
  ) = 0 THEN
    RAISE EXCEPTION 'v197_smoke: live v193 router no longer delegates to v190';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(
    'public.aka_agent_internal_route_data_group_member_v190_internal(bigint,bigint,bigint,bigint)'::regprocedure
  ) INTO v_v190_definition;
  IF pg_catalog.strpos(
    v_v190_definition,
    $$v_action = 'zalo_message_group_member'$$
  ) = 0
    OR pg_catalog.strpos(
      v_v190_definition,
      $$origin.relationship_kind = 'zalo_group_members'$$
    ) = 0
    OR pg_catalog.strpos(
      v_v190_definition,
      'bound_zalo_group_member_relationship_required'
    ) = 0
  THEN
    RAISE EXCEPTION 'v197_smoke: group-member relationship guard was loosened';
  END IF;
  IF pg_catalog.strpos(v_v190_definition, 'zalo_remarketing_customers') > 0
    OR pg_catalog.strpos(
      v_v190_definition,
      'bound_zalo_remarketing_relationship_required'
    ) > 0
  THEN
    RAISE EXCEPTION 'v197_smoke: live remarketing still requires relationship provenance';
  END IF;

  -- The v186 matrix is the authoritative account-only remarketing gate. It
  -- must retain platform/person/account ownership and non-empty target checks.
  SELECT pg_catalog.pg_get_functiondef(
    'public.aka_agent_internal_route_data_group_member_v186_internal(bigint,bigint,bigint,bigint)'::regprocedure
  ) INTO v_v186_definition;
  IF pg_catalog.strpos(
    v_v186_definition,
    $$'zalo_message_remarketing_customer'$$
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
      $$v_action = 'zalo_message_friend' AND v_contact.is_friend IS DISTINCT FROM true$$
    ) = 0
    OR pg_catalog.strpos(
      v_v186_definition,
      $$IF NULLIF(v_target_value, '') IS NULL$$
    ) = 0
  THEN
    RAISE EXCEPTION 'v197_smoke: v186 account-bound person/UID guard drifted';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(
    'public.aka_agent_snapshot_data_group_to_direct_campaign(bigint,bigint,text,bigint,bigint,timestamptz,text,text,text)'::regprocedure
  ) INTO v_snapshot_definition;
  IF pg_catalog.strpos(
    v_snapshot_definition,
    $$'zalo_message_remarketing_customer'$$
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
    RAISE EXCEPTION 'v197_smoke: direct snapshot lost remarketing account/UID routing';
  END IF;
  IF pg_catalog.strpos(
    v_snapshot_definition,
    $$IF v_action = 'zalo_message_group_member' THEN$$
  ) = 0
    OR pg_catalog.strpos(
      v_snapshot_definition,
      $$origin.relationship_kind = 'zalo_group_members'$$
    ) = 0
  THEN
    RAISE EXCEPTION 'v197_smoke: direct snapshot group-member guard was loosened';
  END IF;
  IF pg_catalog.strpos(v_snapshot_definition, 'zalo_remarketing_customers') > 0 THEN
    RAISE EXCEPTION 'v197_smoke: direct snapshot still requires remarketing provenance';
  END IF;

  -- v197 is routing-only: provenance columns and trigger stay available for
  -- auditing current and future origins.
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute AS attribute
    WHERE attribute.attrelid =
      'public.auto_account_contact_group_member_origins'::regclass
      AND attribute.attname = 'relationship_kind'
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
  )
    OR NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_trigger AS trigger_row
      WHERE trigger_row.tgrelid =
        'public.auto_account_contact_group_member_origins'::regclass
        AND trigger_row.tgname = 'trg_aka_agent_stamp_data_group_relationship_kind'
        AND trigger_row.tgenabled <> 'D'
        AND NOT trigger_row.tgisinternal
    )
  THEN
    RAISE EXCEPTION 'v197_smoke: relationship provenance audit contract is missing';
  END IF;

  IF pg_catalog.has_function_privilege(
    'anon',
    'public.aka_agent_internal_route_data_group_member_v190_internal(bigint,bigint,bigint,bigint)',
    'EXECUTE'
  )
    OR pg_catalog.has_function_privilege(
      'authenticated',
      'public.aka_agent_internal_route_data_group_member_v190_internal(bigint,bigint,bigint,bigint)',
      'EXECUTE'
    )
  THEN
    RAISE EXCEPTION 'v197_smoke: internal v190 router became API-callable';
  END IF;
END;
$smoke$;

ROLLBACK;
