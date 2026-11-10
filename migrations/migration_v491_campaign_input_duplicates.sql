-- V491: read-only phone duplicate lookup for the WebApp upload modal ("Lọc trùng dữ liệu").
--
-- Adds ONE function and ONE auto_system_settings row. No table, column, index, policy, trigger,
-- existing-function, role/global timeout, pool or connection change. Never writes.
--
-- Given up to 2,000 phones being uploaded into a campaign, returns the phones that already exist as
-- campaign data (auto_campaign_input_data) uploaded within the last N Vietnam calendar days (today
-- included) into campaigns of the SAME campaign type whose main account is one of the given Zalo
-- accounts of the calling staff/organization. Rules (docs/CAMPAIGN_INPUT_DUPLICATES_V491.md):
--   * every row status and every way the row entered the campaign count; soft-deleted rows do not;
--   * soft-deleted campaigns count only rows that already ran (status 'hoàn thành' or date_action set);
--   * half-created campaigns (provisioning_state 'staged') do not count;
--   * excludeCampaignId (the campaign receiving "Thêm data") is skipped;
--   * phones compare after public.normalize_phone, the expression of idx_campaign_input_cooldown_phone.
-- The candidate rows are read ONLY through idx_campaign_input_cooldown_phone (md5 of the normalized
-- phone, 28/10/2026). Production 10/11/2026: a join written the usual way made the planner scan
-- ~2 M rows through another index and computing normalize_phone per row (cancelled at 55 s); the
-- materialized "= ANY(md5 array)" probe below read 10,000 phones of the heaviest staff in ~4.7 s cold
-- (34k rows system-wide, 3.4 per phone), hence the 2,000-phone cap per call and the 20 s timeout.
-- Identity chain as V462/V487: service_role (WebApp backend singleton, credentials NULL) passes
-- public.auto_assert_automation_identity; Desktop can be granted later without changing the body.
-- Switch: auto_system_settings web.campaign_input_duplicates = {"audience":"admin_akabiz"|"all"|"off",
-- "defaultDays":30,"maxDays":365}; the API reads it with the other web settings (no extra request).
-- Rollback: migrations/rollback_v491_campaign_input_duplicates.sql
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $preflight$
BEGIN
  IF to_regprocedure('public.aka_agent_read_campaign_input_duplicates(bigint,bigint,text,text,jsonb)') IS NOT NULL THEN
    RAISE EXCEPTION 'v491_target_already_exists_do_not_overwrite';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_system_settings WHERE key = 'web.campaign_input_duplicates') THEN
    RAISE EXCEPTION 'v491_setting_already_exists_do_not_overwrite';
  END IF;
  IF to_regclass('public.auto_campaigns') IS NULL
    OR to_regclass('public.auto_campaign_input_data') IS NULL
    OR to_regclass('public.auto_accounts') IS NULL
    OR to_regclass('public.org_staff') IS NULL
    OR to_regprocedure('public.normalize_phone(text)') IS NULL
    OR to_regprocedure('public.aka_agent_internal_normalize_phone(text)') IS NULL
    OR to_regprocedure('public.auto_assert_automation_identity(bigint,bigint,text,text)') IS NULL THEN
    RAISE EXCEPTION 'v491_dependency_missing';
  END IF;
  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'auto_campaigns'
      AND column_name IN ('staff_id', 'organization_id', 'account_id', 'action_id', 'name', 'is_delete', 'provisioning_state')) <> 7
    OR (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'auto_campaign_input_data'
      AND column_name IN ('campaign_id', 'phone', 'status', 'date_action', 'is_delete', 'created_at')) <> 6
    OR (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'auto_accounts'
      AND column_name IN ('staff_id', 'organization_id', 'flatform_type', 'name')) <> 4 THEN
    RAISE EXCEPTION 'v491_expected_columns_missing';
  END IF;
  -- The md5 phone index drives every read; stop instead of creating a reader that would scan.
  IF NOT EXISTS (
    SELECT 1 FROM pg_index
    WHERE indexrelid = to_regclass('public.idx_campaign_input_cooldown_phone') AND indisvalid AND indisready
      AND pg_get_indexdef(indexrelid) = 'CREATE INDEX idx_campaign_input_cooldown_phone ON public.auto_campaign_input_data USING btree (md5(normalize_phone(phone))) WHERE ((phone IS NOT NULL) AND (btrim(phone) <> ''''::text))'
  ) THEN
    RAISE EXCEPTION 'v491_expected_index_missing';
  END IF;
  IF (SELECT last_value FROM pg_sequences WHERE schemaname = 'public' AND sequencename = 'auto_system_settings_id_seq')
       < (SELECT coalesce(max(id), 0) FROM public.auto_system_settings) THEN
    RAISE EXCEPTION 'v491_setting_sequence_behind';
  END IF;
END
$preflight$;

CREATE FUNCTION public.aka_agent_read_campaign_input_duplicates(
  p_staff_id bigint, p_organization_id bigint, p_auth_username text, p_auth_password text, p_query jsonb
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
SET statement_timeout = '20s'
AS $function$
DECLARE
  v_tz constant text := 'Asia/Ho_Chi_Minh';
  -- Campaign types whose upload modal offers the check (phase 1: Zalo message/friend by phone).
  v_supported constant text[] := ARRAY['zalo_message_phone'];
  v_max_phones constant integer := 2000;
  v_max_accounts constant integer := 500;
  v_max_days constant integer := 365;
  v_action text;
  v_days integer;
  v_account_ids bigint[];
  v_owned integer;
  v_phones text[];
  v_hashes text[];
  v_exclude bigint;
  v_since timestamptz;
  v_items jsonb;
BEGIN
  -- Desktop token must belong to p_staff_id and carry the automation credentials; service_role passes.
  PERFORM public.auto_assert_automation_identity(p_staff_id, p_organization_id, p_auth_username, p_auth_password);
  IF p_staff_id IS NULL OR p_organization_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.org_staff WHERE id = p_staff_id AND organization_id = p_organization_id AND is_active = true
  ) THEN RAISE EXCEPTION 'input_duplicates_access_denied' USING ERRCODE = '42501'; END IF;

  IF p_query IS NULL OR jsonb_typeof(p_query) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'input_duplicates_invalid_query' USING ERRCODE = '22023';
  END IF;

  v_action := p_query->>'actionId';
  IF v_action IS NULL OR NOT (v_action = ANY(v_supported)) THEN
    RAISE EXCEPTION 'input_duplicates_unsupported_action' USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(p_query->'days') IS DISTINCT FROM 'number' OR (p_query->>'days') !~ '^[0-9]{1,3}$' THEN
    RAISE EXCEPTION 'input_duplicates_invalid_days' USING ERRCODE = '22023';
  END IF;
  v_days := (p_query->>'days')::integer;
  IF v_days < 1 OR v_days > v_max_days THEN
    RAISE EXCEPTION 'input_duplicates_invalid_days' USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(p_query->'accountIds') IS DISTINCT FROM 'array'
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_query->'accountIds') AS e(v)
      WHERE jsonb_typeof(e.v) <> 'number' OR (e.v #>> '{}') !~ '^[1-9][0-9]{0,17}$') THEN
    RAISE EXCEPTION 'input_duplicates_invalid_accounts' USING ERRCODE = '22023';
  END IF;
  SELECT coalesce(array_agg(DISTINCT (e.v #>> '{}')::bigint), '{}'::bigint[]) INTO v_account_ids
  FROM jsonb_array_elements(p_query->'accountIds') AS e(v);
  IF cardinality(v_account_ids) = 0 OR cardinality(v_account_ids) > v_max_accounts THEN
    RAISE EXCEPTION 'input_duplicates_invalid_accounts' USING ERRCODE = '22023';
  END IF;
  -- Every account must be a Zalo account of this very staff in this organization (deleted ones included:
  -- their campaigns are still the staff's data). One foreign id rejects the whole call.
  SELECT count(*) INTO v_owned FROM public.auto_accounts AS a
  WHERE a.id = ANY(v_account_ids) AND a.staff_id = p_staff_id AND a.organization_id = p_organization_id
    AND a.flatform_type = 'zalo';
  IF v_owned <> cardinality(v_account_ids) THEN
    RAISE EXCEPTION 'input_duplicates_account_scope_denied' USING ERRCODE = '42501';
  END IF;

  IF p_query ? 'excludeCampaignId' AND jsonb_typeof(p_query->'excludeCampaignId') <> 'null' THEN
    IF jsonb_typeof(p_query->'excludeCampaignId') <> 'number' OR (p_query->>'excludeCampaignId') !~ '^[1-9][0-9]{0,17}$' THEN
      RAISE EXCEPTION 'input_duplicates_invalid_exclude' USING ERRCODE = '22023';
    END IF;
    v_exclude := (p_query->>'excludeCampaignId')::bigint;
  END IF;

  IF jsonb_typeof(p_query->'phones') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'input_duplicates_invalid_phones' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_query->'phones') > v_max_phones THEN
    RAISE EXCEPTION 'input_duplicates_too_many_phones' USING ERRCODE = '22023';
  END IF;
  -- Same normalization as the index; invalid Vietnamese mobiles are simply not looked up.
  SELECT coalesce(array_agg(DISTINCT n.p), '{}'::text[]) INTO v_phones
  FROM jsonb_array_elements_text(p_query->'phones') AS e(v)
  CROSS JOIN LATERAL (SELECT public.aka_agent_internal_normalize_phone(e.v) AS p) AS n
  WHERE n.p <> '';

  v_since := ((now() AT TIME ZONE v_tz)::date - (v_days - 1))::timestamp AT TIME ZONE v_tz;

  IF cardinality(v_phones) = 0 THEN
    RETURN jsonb_build_object('checkedAt', now(), 'since', v_since, 'days', v_days,
      'accountCount', cardinality(v_account_ids), 'phoneCount', 0, 'items', '[]'::jsonb);
  END IF;
  SELECT array_agg(md5(p)) INTO v_hashes FROM unnest(v_phones) AS p;

  WITH hits AS MATERIALIZED (
    -- Only predicate: the indexed expression plus the index's own partial predicate.
    SELECT i.id, i.campaign_id, i.phone, i.status, i.date_action, i.is_delete, i.created_at
    FROM public.auto_campaign_input_data AS i
    WHERE md5(public.normalize_phone(i.phone)) = ANY(v_hashes)
      AND i.phone IS NOT NULL AND btrim(i.phone) <> ''
  ), scoped AS MATERIALIZED (
    SELECT public.normalize_phone(h.phone) AS phone, h.id, h.created_at, h.status,
      (h.status = 'hoàn thành' OR h.date_action IS NOT NULL) AS processed,
      c.id AS campaign_id, c.name AS campaign_name, c.account_id, coalesce(c.is_delete, false) AS campaign_deleted
    FROM hits AS h
    JOIN public.auto_campaigns AS c ON c.id = h.campaign_id
    WHERE h.is_delete IS NOT TRUE
      AND h.created_at >= v_since
      AND c.staff_id = p_staff_id
      AND c.organization_id = p_organization_id
      AND c.action_id = v_action
      AND c.account_id = ANY(v_account_ids)
      AND c.provisioning_state IS DISTINCT FROM 'staged'
      AND (v_exclude IS NULL OR c.id <> v_exclude)
      AND (c.is_delete IS NOT TRUE OR h.status = 'hoàn thành' OR h.date_action IS NOT NULL)
      AND public.normalize_phone(h.phone) = ANY(v_phones)
  )
  SELECT coalesce(jsonb_agg(x.item ORDER BY x.phone), '[]'::jsonb) INTO v_items
  FROM (
    SELECT s.phone, jsonb_build_object(
      'phone', s.phone,
      'matchCount', count(*),
      'campaignCount', count(DISTINCT s.campaign_id),
      'latest', (array_agg(jsonb_build_object(
          'campaignId', s.campaign_id, 'campaignName', s.campaign_name, 'campaignDeleted', s.campaign_deleted,
          'accountId', s.account_id, 'accountName', a.name, 'uploadedAt', s.created_at,
          'status', s.status, 'processed', s.processed)
        ORDER BY s.created_at DESC, s.id DESC))[1]
    ) AS item
    FROM scoped AS s
    LEFT JOIN public.auto_accounts AS a ON a.id = s.account_id
    GROUP BY s.phone
  ) AS x;

  RETURN jsonb_build_object('checkedAt', now(), 'since', v_since, 'days', v_days,
    'accountCount', cardinality(v_account_ids), 'phoneCount', cardinality(v_phones), 'items', v_items);
END;
$function$;
ALTER FUNCTION public.aka_agent_read_campaign_input_duplicates(bigint,bigint,text,text,jsonb) OWNER TO postgres;
-- Default ACL in public grants EXECUTE to anon/authenticated: revoke them directly.
REVOKE ALL ON FUNCTION public.aka_agent_read_campaign_input_duplicates(bigint,bigint,text,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aka_agent_read_campaign_input_duplicates(bigint,bigint,text,text,jsonb) TO service_role;
COMMENT ON FUNCTION public.aka_agent_read_campaign_input_duplicates(bigint,bigint,text,text,jsonb) IS
  'V491 read-only "Lọc trùng dữ liệu" lookup: phones (≤2,000) already uploaded into same-type campaigns of the given Zalo accounts of this staff within N Vietnam days. Uses idx_campaign_input_cooldown_phone only; service_role only; 20s per call; never writes.';

INSERT INTO public.auto_system_settings (key, value, description, is_secret, is_active)
VALUES ('web.campaign_input_duplicates', '{"audience":"admin_akabiz","defaultDays":30,"maxDays":365}',
  'Lọc trùng dữ liệu khi tải file (Web, V491): audience admin_akabiz (chỉ admin akaBiz) | all (mọi khách) | off (ẩn lựa chọn đối chiếu chiến dịch khác, chỉ lọc trong file); defaultDays/maxDays là số ngày mặc định/tối đa. API đọc lại mỗi lượt, không cần deploy.',
  false, true);

DO $postflight$
DECLARE v_acl text;
BEGIN
  SELECT proacl::text INTO v_acl FROM pg_proc
    WHERE oid = to_regprocedure('public.aka_agent_read_campaign_input_duplicates(bigint,bigint,text,text,jsonb)');
  IF (SELECT array_agg(g ORDER BY g) FROM (
        SELECT DISTINCT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END AS g
        FROM pg_proc pr, aclexplode(pr.proacl) a
        WHERE pr.oid = to_regprocedure('public.aka_agent_read_campaign_input_duplicates(bigint,bigint,text,text,jsonb)')) x)
     IS DISTINCT FROM ARRAY['postgres', 'service_role'] THEN
    RAISE EXCEPTION 'v491_reader_acl_unexpected: %', v_acl;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_system_settings WHERE key = 'web.campaign_input_duplicates'
      AND is_active AND NOT is_secret AND value::jsonb ->> 'audience' = 'admin_akabiz') THEN
    RAISE EXCEPTION 'v491_setting_missing';
  END IF;
END
$postflight$;
NOTIFY pgrst, 'reload schema';
COMMIT;
