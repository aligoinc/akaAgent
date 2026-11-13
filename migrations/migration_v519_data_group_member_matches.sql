-- V519: read-only "đã có trong nhóm / ở nhóm khác" lookup for the WebApp import window of data groups.
--
-- Adds ONE function. No table, column, index, policy, trigger, setting row, existing-function, role/global
-- timeout, pool or connection change. Never writes.
--
-- Why: public.aka_agent_ingest_data_group only recognises a customer already in the group when the row
-- resolves to an account-bound contact (identity = account + contact_type + uid). Groups without a bound
-- Zalo account (5,031 of 5,094 data groups on 13/11/2026) reuse a contact only inside the same upload
-- dataset ("Accountless identity is intentionally NOT global"), so the same phone imported from another
-- file or pasted again becomes a new member row: 13 of 20 sampled groups with repeated file/paste imports
-- carried 7.6% duplicate rows. The WebApp therefore asks, BEFORE sending rows, which identities are already
-- members of this group and (optionally) of the staff's other data groups, and leaves them out.
--
-- Given up to 2,000 identities of one contact type ('phone' | 'person' | 'group'), returns for each input
-- index whether a non-deleted member of the group has a contact of that type and uid (any account of the
-- staff or accountless), and how many other data groups of the same staff hold it (with the most recent).
--   * 'phone' values are normalised with public.aka_agent_internal_normalize_phone, exactly as the ingest
--     function builds contact.uid for phone rows; 'person'/'group' compare btrim(value) and platform.
--   * Only groups owned by the calling staff in the calling organization are read (purpose 'data_group',
--     not deleted). The target group must be one of them; otherwise the call is denied.
--   * Membership counts when the member row is not soft-deleted, whatever the contact's own lifecycle flag
--     (same as the ingest function's member lookup).
-- Reads are index probes per identity on uq_auto_account_contacts_account_type_uid (account_id IS NULL and
-- account_id = each account of the staff) and idx_auto_account_contact_group_members_contact; cost follows
-- the number of identities (x accounts of the staff), not the group size. Production 13/11/2026 (read-only
-- EXPLAIN ANALYZE of the same query shape, groups of ~15,500 members, 1,000 phones that all match): 0.6-1.5 s
-- on cold pages, 9 ms when nothing matches.
-- Identity chain as V491: service_role (WebApp backend singleton, credentials NULL) passes
-- public.auto_assert_automation_identity; Desktop can be granted later without changing the body.
-- Switch: optional field "groupMatches" of auto_system_settings web.campaign_input_duplicates (missing = on,
-- false = off); read by the WebApp API with the other web settings. No row is added or changed here.
-- Rollback: migrations/rollback_v519_data_group_member_matches.sql
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $preflight$
BEGIN
  IF to_regprocedure('public.aka_agent_read_data_group_member_matches(bigint,bigint,text,text,jsonb)') IS NOT NULL THEN
    RAISE EXCEPTION 'v519_target_already_exists_do_not_overwrite';
  END IF;
  IF to_regclass('public.auto_account_contacts') IS NULL
    OR to_regclass('public.auto_account_contact_groups') IS NULL
    OR to_regclass('public.auto_account_contact_group_members') IS NULL
    OR to_regclass('public.auto_accounts') IS NULL
    OR to_regclass('public.org_staff') IS NULL
    OR to_regprocedure('public.aka_agent_internal_normalize_phone(text)') IS NULL
    OR to_regprocedure('public.auto_assert_automation_identity(bigint,bigint,text,text)') IS NULL THEN
    RAISE EXCEPTION 'v519_dependency_missing';
  END IF;
  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'auto_account_contacts'
      AND column_name IN ('id', 'account_id', 'contact_type', 'flatform_type', 'uid', 'staff_id', 'organization_id')) <> 7
    OR (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'auto_account_contact_groups'
      AND column_name IN ('id', 'name', 'staff_id', 'organization_id', 'is_delete', 'purpose')) <> 6
    OR (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'auto_account_contact_group_members'
      AND column_name IN ('group_id', 'contact_id', 'is_delete', 'created_at')) <> 4 THEN
    RAISE EXCEPTION 'v519_expected_columns_missing';
  END IF;
  -- The two indexes drive every read; stop instead of creating a reader that would scan 6.3 M contacts.
  IF NOT EXISTS (
    SELECT 1 FROM pg_index AS i
    WHERE i.indrelid = to_regclass('public.auto_account_contacts') AND i.indisvalid AND i.indisready AND i.indpred IS NULL
      AND pg_get_indexdef(i.indexrelid) ~ 'USING btree \(account_id, contact_type, uid\)$'
  ) THEN
    RAISE EXCEPTION 'v519_expected_contact_index_missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_index AS i
    WHERE i.indrelid = to_regclass('public.auto_account_contact_group_members') AND i.indisvalid AND i.indisready
      AND i.indpred IS NULL AND pg_get_indexdef(i.indexrelid) ~ 'USING btree \(contact_id\)$'
  ) THEN
    RAISE EXCEPTION 'v519_expected_member_index_missing';
  END IF;
END
$preflight$;

CREATE FUNCTION public.aka_agent_read_data_group_member_matches(
  p_staff_id bigint, p_organization_id bigint, p_auth_username text, p_auth_password text, p_query jsonb
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_max_values constant integer := 2000;
  v_max_other_groups constant integer := 200;
  v_max_value_length constant integer := 512;
  v_group_id bigint;
  v_type text;
  v_platform text;
  v_other_mode text;
  v_other_ids bigint[];
  v_account_ids bigint[];
  v_uids text[];
  v_value_count integer;
  v_items jsonb;
BEGIN
  -- Desktop token must belong to p_staff_id and carry the automation credentials; service_role passes.
  PERFORM public.auto_assert_automation_identity(p_staff_id, p_organization_id, p_auth_username, p_auth_password);
  IF p_staff_id IS NULL OR p_organization_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.org_staff WHERE id = p_staff_id AND organization_id = p_organization_id AND is_active = true
  ) THEN RAISE EXCEPTION 'data_group_matches_access_denied' USING ERRCODE = '42501'; END IF;

  IF p_query IS NULL OR jsonb_typeof(p_query) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'data_group_matches_invalid_query' USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(p_query->'groupId') IS DISTINCT FROM 'number' OR (p_query->>'groupId') !~ '^[1-9][0-9]{0,17}$' THEN
    RAISE EXCEPTION 'data_group_matches_invalid_group' USING ERRCODE = '22023';
  END IF;
  v_group_id := (p_query->>'groupId')::bigint;
  -- Only the owner imports into a data group; a group shared by someone else is not a write destination.
  IF NOT EXISTS (
    SELECT 1 FROM public.auto_account_contact_groups AS g
    WHERE g.id = v_group_id AND g.staff_id = p_staff_id AND g.organization_id = p_organization_id
      AND g.is_delete = false AND g.purpose = 'data_group'
  ) THEN RAISE EXCEPTION 'data_group_matches_group_denied' USING ERRCODE = '42501'; END IF;

  v_type := p_query->>'contactType';
  IF v_type IS NULL OR v_type NOT IN ('phone', 'person', 'group') THEN
    RAISE EXCEPTION 'data_group_matches_invalid_contact_type' USING ERRCODE = '22023';
  END IF;
  v_platform := COALESCE(NULLIF(lower(btrim(COALESCE(p_query->>'platform', ''))), ''), 'zalo');
  IF v_platform NOT IN ('zalo', 'facebook') THEN
    RAISE EXCEPTION 'data_group_matches_invalid_platform' USING ERRCODE = '22023';
  END IF;

  -- otherGroups: "none" (only this group), "all" (every other data group of the staff) or an id array.
  IF NOT (p_query ? 'otherGroups') OR jsonb_typeof(p_query->'otherGroups') = 'null' THEN
    v_other_mode := 'none';
  ELSIF jsonb_typeof(p_query->'otherGroups') = 'string' AND (p_query->>'otherGroups') IN ('none', 'all') THEN
    v_other_mode := p_query->>'otherGroups';
  ELSIF jsonb_typeof(p_query->'otherGroups') = 'array' THEN
    IF jsonb_array_length(p_query->'otherGroups') > v_max_other_groups
      OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_query->'otherGroups') AS e(v)
        WHERE jsonb_typeof(e.v) <> 'number' OR (e.v #>> '{}') !~ '^[1-9][0-9]{0,17}$') THEN
      RAISE EXCEPTION 'data_group_matches_invalid_other_groups' USING ERRCODE = '22023';
    END IF;
    SELECT coalesce(array_agg(DISTINCT (e.v #>> '{}')::bigint), '{}'::bigint[]) INTO v_other_ids
    FROM jsonb_array_elements(p_query->'otherGroups') AS e(v)
    WHERE (e.v #>> '{}')::bigint <> v_group_id;
    v_other_mode := CASE WHEN cardinality(v_other_ids) = 0 THEN 'none' ELSE 'some' END;
  ELSE
    RAISE EXCEPTION 'data_group_matches_invalid_other_groups' USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(p_query->'values') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'data_group_matches_invalid_values' USING ERRCODE = '22023';
  END IF;
  v_value_count := jsonb_array_length(p_query->'values');
  IF v_value_count > v_max_values THEN
    RAISE EXCEPTION 'data_group_matches_too_many_values' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_query->'values') AS e(v) WHERE jsonb_typeof(e.v) <> 'string') THEN
    RAISE EXCEPTION 'data_group_matches_invalid_values' USING ERRCODE = '22023';
  END IF;

  -- Same identity the ingest function stores in contact.uid; values it cannot normalise are not looked up.
  SELECT coalesce(array_agg(DISTINCT n.uid), '{}'::text[]) INTO v_uids
  FROM jsonb_array_elements_text(p_query->'values') AS e(v)
  CROSS JOIN LATERAL (SELECT CASE WHEN v_type = 'phone'
      THEN public.aka_agent_internal_normalize_phone(e.v) ELSE btrim(e.v) END AS uid) AS n
  WHERE n.uid IS NOT NULL AND n.uid <> '' AND length(n.uid) <= v_max_value_length;

  IF cardinality(v_uids) = 0 THEN
    RETURN jsonb_build_object('checkedAt', now(), 'groupId', v_group_id, 'contactType', v_type,
      'valueCount', v_value_count, 'items', '[]'::jsonb);
  END IF;

  -- Account-bound contacts are unique per (account, type, uid): probe each account of this staff
  -- (13/11/2026: at most 86 accounts per staff, median 3). Person/group identities belong to one platform.
  SELECT coalesce(array_agg(a.id), '{}'::bigint[]) INTO v_account_ids
  FROM public.auto_accounts AS a
  WHERE a.staff_id = p_staff_id AND (a.organization_id IS NULL OR a.organization_id = p_organization_id)
    AND (v_type = 'phone' OR a.flatform_type = v_platform);

  -- Every read is one index probe per identity. The LATERAL ... OFFSET 0 subqueries keep the planner from
  -- turning them into scans of all contacts of the staff/account (production 13/11/2026: written as plain
  -- joins, the staff-scope index read 23,305 contacts for 1,000 phones and the per-account bitmap scan would
  -- read every phone contact of an account).
  WITH wanted AS MATERIALIZED (
    SELECT u.uid FROM unnest(v_uids) AS u(uid)
  ), cand AS MATERIALIZED (
    SELECT c.id, w.uid
    FROM wanted AS w
    CROSS JOIN LATERAL (
      SELECT ct.id, ct.staff_id, ct.organization_id, ct.flatform_type
      FROM public.auto_account_contacts AS ct
      WHERE ct.account_id IS NULL AND ct.contact_type = v_type AND ct.uid = w.uid
      OFFSET 0
    ) AS c
    WHERE c.staff_id = p_staff_id AND c.organization_id = p_organization_id
      AND (v_type = 'phone' OR c.flatform_type IS NOT DISTINCT FROM v_platform)
    UNION ALL
    SELECT c.id, k.uid
    FROM (SELECT w.uid, a.id AS account_id FROM wanted AS w CROSS JOIN unnest(v_account_ids) AS a(id) OFFSET 0) AS k
    CROSS JOIN LATERAL (
      SELECT ct.id, ct.staff_id, ct.organization_id, ct.flatform_type
      FROM public.auto_account_contacts AS ct
      WHERE ct.account_id = k.account_id AND ct.contact_type = v_type AND ct.uid = k.uid
      OFFSET 0
    ) AS c
    WHERE c.staff_id = p_staff_id AND c.organization_id = p_organization_id
      AND (v_type = 'phone' OR c.flatform_type IS NOT DISTINCT FROM v_platform)
  ), hits AS MATERIALIZED (
    SELECT cand.uid, m.group_id, m.created_at
    FROM cand
    CROSS JOIN LATERAL (
      SELECT mb.group_id, mb.created_at, mb.is_delete
      FROM public.auto_account_contact_group_members AS mb
      WHERE mb.contact_id = cand.id
      OFFSET 0
    ) AS m
    WHERE m.is_delete = false
      AND (m.group_id = v_group_id
        OR v_other_mode = 'all'
        OR (v_other_mode = 'some' AND m.group_id = ANY(v_other_ids)))
  ), scoped AS MATERIALIZED (
    SELECT h.uid, h.group_id, h.created_at, g.name
    FROM hits AS h
    JOIN public.auto_account_contact_groups AS g ON g.id = h.group_id
    WHERE g.staff_id = p_staff_id AND g.organization_id = p_organization_id
      AND g.is_delete = false AND g.purpose = 'data_group'
  ), per_uid AS (
    SELECT s.uid,
      bool_or(s.group_id = v_group_id) AS in_group,
      count(DISTINCT s.group_id) FILTER (WHERE s.group_id <> v_group_id) AS other_count,
      (array_agg(jsonb_build_object('id', s.group_id, 'name', s.name, 'addedAt', s.created_at)
          ORDER BY s.created_at DESC, s.group_id DESC) FILTER (WHERE s.group_id <> v_group_id))[1] AS other_group
    FROM scoped AS s
    GROUP BY s.uid
  ), input AS (
    SELECT (e.ord - 1)::integer AS idx,
      CASE WHEN v_type = 'phone' THEN public.aka_agent_internal_normalize_phone(e.v) ELSE btrim(e.v) END AS uid
    FROM jsonb_array_elements_text(p_query->'values') WITH ORDINALITY AS e(v, ord)
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'index', i.idx, 'inGroup', p.in_group, 'otherGroupCount', p.other_count, 'otherGroup', p.other_group)
    ORDER BY i.idx), '[]'::jsonb) INTO v_items
  FROM input AS i
  JOIN per_uid AS p ON p.uid = i.uid;

  RETURN jsonb_build_object('checkedAt', now(), 'groupId', v_group_id, 'contactType', v_type,
    'valueCount', v_value_count, 'items', v_items);
END;
$function$;
ALTER FUNCTION public.aka_agent_read_data_group_member_matches(bigint,bigint,text,text,jsonb) OWNER TO postgres;
-- Default ACL in public grants EXECUTE to anon/authenticated: revoke them directly.
REVOKE ALL ON FUNCTION public.aka_agent_read_data_group_member_matches(bigint,bigint,text,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aka_agent_read_data_group_member_matches(bigint,bigint,text,text,jsonb) TO service_role;
COMMENT ON FUNCTION public.aka_agent_read_data_group_member_matches(bigint,bigint,text,text,jsonb) IS
  'V519 read-only lookup for the data group import window: which of up to 2,000 identities (phone/person/group) already are members of the staff''s data group and of the staff''s other data groups. Index probes by identity, service_role only, 15s per call, never writes.';

DO $postflight$
DECLARE v_acl text;
BEGIN
  SELECT proacl::text INTO v_acl FROM pg_proc
    WHERE oid = to_regprocedure('public.aka_agent_read_data_group_member_matches(bigint,bigint,text,text,jsonb)');
  IF (SELECT array_agg(g ORDER BY g) FROM (
        SELECT DISTINCT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END AS g
        FROM pg_proc pr, aclexplode(pr.proacl) a
        WHERE pr.oid = to_regprocedure('public.aka_agent_read_data_group_member_matches(bigint,bigint,text,text,jsonb)')) x)
     IS DISTINCT FROM ARRAY['postgres', 'service_role'] THEN
    RAISE EXCEPTION 'v519_reader_acl_unexpected: %', v_acl;
  END IF;
END
$postflight$;
NOTIFY pgrst, 'reload schema';
COMMIT;
