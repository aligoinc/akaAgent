-- Rollback V464: restores the V462 body of public.aka_agent_read_campaign_effectiveness (unique customers keyed
-- by engagement UID, then canonical key, then result id). Signature, attributes and ACL are unchanged by either
-- version. Refuses unless the live body is exactly V464 (prosrc md5 cead5384a60003570db2f2d6a907519f).
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $preflight$
DECLARE v_md5 text;
BEGIN
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc
    WHERE oid = to_regprocedure('public.aka_agent_read_campaign_effectiveness(bigint,bigint,text,text,jsonb)');
  IF v_md5 IS DISTINCT FROM 'cead5384a60003570db2f2d6a907519f' THEN RAISE EXCEPTION 'rollback_v464_reader_not_v464: %', v_md5; END IF;
END
$preflight$;

CREATE OR REPLACE FUNCTION public.aka_agent_read_campaign_effectiveness(
  p_staff_id bigint, p_organization_id bigint, p_auth_username text, p_auth_password text, p_query jsonb
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
SET statement_timeout = '60s'
AS $function$
DECLARE
  v_mode text := p_query->>'mode';
  v_tz constant text := 'Asia/Ho_Chi_Minh';
  v_message constant text[] := ARRAY['zalo_message_friend','zalo_message_stranger'];
  v_tracked_actions constant text[] := ARRAY['zalo_message_friend','zalo_message_stranger','zalo_add_friend'];
  -- Default "customers reached" codes (shared contract REACH_ACTIONS); callers may pass reachActionCodes.
  v_reach text[] := ARRAY['zalo_message_friend','zalo_message_stranger','zalo_add_friend','sms_send','voice_call','email_send',
    'fb_message_friend','fb_message_stranger','fb_message_page_inbox_customer','fb_add_friend'];
  v_from timestamptz;
  v_to timestamptz;
  v_limit integer;
  v_offset integer;
  v_stage text;
  v_accounts bigint[];
  v_actions text[];
  v_campaigns bigint[];
  v_success text[];
  v_skipped text[];
  v_failure text[];
  v_rows jsonb;
  v_codes jsonb;
  v_unique jsonb;
  v_total bigint;
  v_result jsonb;
BEGIN
  -- Desktop token must belong to p_staff_id and carry the automation credentials; service_role passes.
  PERFORM public.auto_assert_automation_identity(p_staff_id, p_organization_id, p_auth_username, p_auth_password);
  IF p_staff_id IS NULL OR p_organization_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.org_staff WHERE id = p_staff_id AND organization_id = p_organization_id AND is_active = true
  ) THEN RAISE EXCEPTION 'report_access_denied' USING ERRCODE = '42501'; END IF;

  IF p_query IS NULL OR jsonb_typeof(p_query) IS DISTINCT FROM 'object'
    OR v_mode IS NULL OR v_mode NOT IN ('summary','campaigns','hours','data_groups','list','lifetime')
    OR jsonb_typeof(p_query->'accountIds') IS DISTINCT FROM 'array' OR jsonb_array_length(p_query->'accountIds') > 10000
    OR jsonb_typeof(p_query->'actionCodes') IS DISTINCT FROM 'array' OR jsonb_array_length(p_query->'actionCodes') > 200
    OR (p_query ? 'campaignIds' AND (jsonb_typeof(p_query->'campaignIds') IS DISTINCT FROM 'array'
      OR jsonb_array_length(p_query->'campaignIds') > 1000))
    OR (p_query ? 'legacy' AND jsonb_typeof(p_query->'legacy') IS DISTINCT FROM 'object')
    OR (p_query ? 'reachActionCodes' AND (jsonb_typeof(p_query->'reachActionCodes') IS DISTINCT FROM 'array'
      OR jsonb_array_length(p_query->'reachActionCodes') > 50)) THEN
    RAISE EXCEPTION 'invalid_report_query' USING ERRCODE = '22023';
  END IF;
  BEGIN
    v_from := (p_query->>'startIso')::timestamptz;
    v_to := (p_query->>'endIso')::timestamptz;
    v_limit := coalesce((p_query->>'limit')::integer, 100);
    v_offset := coalesce((p_query->>'offset')::integer, 0);
    SELECT coalesce(array_agg(DISTINCT value::bigint), '{}') INTO v_accounts FROM jsonb_array_elements_text(p_query->'accountIds');
    SELECT coalesce(array_agg(DISTINCT value), '{}') INTO v_actions FROM jsonb_array_elements_text(p_query->'actionCodes');
    IF p_query ? 'campaignIds' THEN
      SELECT coalesce(array_agg(DISTINCT value::bigint), '{}') INTO v_campaigns FROM jsonb_array_elements_text(p_query->'campaignIds');
    END IF;
    SELECT coalesce(array_agg(value), '{}') INTO v_success FROM jsonb_array_elements_text(coalesce(p_query#>'{legacy,success}', '[]'));
    SELECT coalesce(array_agg(value), '{}') INTO v_skipped FROM jsonb_array_elements_text(coalesce(p_query#>'{legacy,skipped}', '[]'));
    SELECT coalesce(array_agg(value), '{}') INTO v_failure FROM jsonb_array_elements_text(coalesce(p_query#>'{legacy,failure}', '[]'));
    IF p_query ? 'reachActionCodes' THEN
      SELECT coalesce(array_agg(DISTINCT value), '{}') INTO v_reach FROM jsonb_array_elements_text(p_query->'reachActionCodes');
    END IF;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'invalid_report_query' USING ERRCODE = '22023';
  END;
  IF v_from IS NULL OR v_to IS NULL OR v_from >= v_to OR v_to - v_from > interval '400 days'
    OR v_limit < 1 OR v_limit > 500 OR v_offset < 0 OR v_offset > 1000000 THEN
    RAISE EXCEPTION 'invalid_report_query' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(v_accounts) requested(id) WHERE NOT EXISTS (
    SELECT 1 FROM public.auto_accounts a WHERE a.id = requested.id AND a.staff_id = p_staff_id
      AND a.organization_id = p_organization_id AND a.is_delete = false
  )) THEN RAISE EXCEPTION 'report_account_access_denied' USING ERRCODE = '42501'; END IF;
  IF v_campaigns IS NOT NULL AND EXISTS (SELECT 1 FROM unnest(v_campaigns) requested(id) WHERE NOT EXISTS (
    SELECT 1 FROM public.auto_campaigns c WHERE c.id = requested.id AND c.staff_id = p_staff_id
      AND c.organization_id = p_organization_id
  )) THEN RAISE EXCEPTION 'report_campaign_access_denied' USING ERRCODE = '42501'; END IF;

  IF cardinality(v_accounts) = 0 OR cardinality(v_actions) = 0 OR (v_campaigns IS NOT NULL AND cardinality(v_campaigns) = 0) THEN
    RETURN CASE v_mode
      WHEN 'summary' THEN jsonb_build_object('rows','[]'::jsonb,'statusCodes','{}'::jsonb,'unique',NULL)
      WHEN 'hours' THEN jsonb_build_object('cells','[]'::jsonb,'activity','[]'::jsonb,'medianResponseMinutes',NULL,'medianSeenMinutes',NULL)
      WHEN 'list' THEN jsonb_build_object('rows','[]'::jsonb,'total',0)
      WHEN 'lifetime' THEN jsonb_build_object('monthly','[]'::jsonb,'unique',NULL,
        'firstCampaignAt',(SELECT min(created_at) FROM public.auto_campaigns WHERE staff_id = p_staff_id AND organization_id = p_organization_id))
      ELSE jsonb_build_object('rows','[]'::jsonb) END;
  END IF;

  IF v_mode = 'summary' THEN
    -- One pass: Vietnam day × account × action × report bucket (× status for
    -- unsuccessful buckets). Engagement stages are exclusive per successful result.
    SELECT coalesce(jsonb_agg(jsonb_build_object(
        'day', g.day, 'accountId', g.account_id, 'actionCode', g.action_code, 'group', g.bucket,
        'statusId', g.status_id, 'count', g.n, 'tracked', g.tracked, 'responded', g.responded,
        'reacted', g.reacted, 'seen', g.seen, 'friended', g.friended, 'pendingInputIds', g.pending_inputs)
        ORDER BY g.day, g.account_id, g.action_code, g.bucket, g.status_id), '[]'::jsonb)
      INTO v_rows
    FROM (
      SELECT (s.created_at AT TIME ZONE v_tz)::date AS day, s.account_id, s.action_code, s.bucket,
        CASE WHEN s.bucket IN ('failure','skipped') THEN s.status_id END AS status_id,
        count(*) AS n,
        count(*) FILTER (WHERE s.bucket = 'success' AND s.tracked) AS tracked,
        count(*) FILTER (WHERE s.bucket = 'success' AND s.responded_at IS NOT NULL) AS responded,
        count(*) FILTER (WHERE s.bucket = 'success' AND s.responded_at IS NULL AND s.reacted_at IS NOT NULL) AS reacted,
        count(*) FILTER (WHERE s.bucket = 'success' AND s.responded_at IS NULL AND s.reacted_at IS NULL AND s.seen_at IS NOT NULL) AS seen,
        count(*) FILTER (WHERE s.bucket = 'success' AND s.friended_at IS NOT NULL) AS friended,
        array_agg(s.input_data_id) FILTER (WHERE s.bucket = 'pending' AND s.input_data_id IS NOT NULL) AS pending_inputs
      FROM private.aka_agent_campaign_effectiveness_scope(p_staff_id, p_organization_id, v_accounts, v_actions, v_campaigns,
        v_from, v_to, v_success, v_skipped, v_failure) s
      WHERE s.bucket IS NOT NULL
      GROUP BY 1, 2, 3, 4, 5
    ) g;
    SELECT coalesce(jsonb_object_agg(st.id::text, st.code), '{}'::jsonb) INTO v_codes
    FROM public.auto_status st
    WHERE st.id IN (SELECT DISTINCT (r->>'statusId')::bigint FROM jsonb_array_elements(v_rows) r WHERE r->>'statusId' IS NOT NULL);
    IF coalesce((p_query->>'includeUnique')::boolean, false) THEN
      -- Customer key matches canonical_target_key ('zalo_person_uid:' + lower UID); phone-only
      -- inputs keep their phone key, rows without any identity count once by detail.
      SELECT jsonb_build_object('reached', count(*), 'seen', count(*) FILTER (WHERE u.seen),
          'interacted', count(*) FILTER (WHERE u.interacted), 'friended', count(*) FILTER (WHERE u.friended))
        INTO v_unique
      FROM (
        SELECT k.key, bool_or(k.seen) AS seen, bool_or(k.interacted) AS interacted, bool_or(k.friended) AS friended
        FROM (
          SELECT coalesce('zalo_person_uid:' || nullif(lower(btrim(s.target_zalo_uid)), ''), nullif(i.canonical_target_key, ''), 'detail:' || s.detail_id::text) AS key,
            (s.seen_at IS NOT NULL OR s.reacted_at IS NOT NULL OR s.responded_at IS NOT NULL) AS seen,
            (s.reacted_at IS NOT NULL OR s.responded_at IS NOT NULL) AS interacted,
            (s.friended_at IS NOT NULL) AS friended
          FROM private.aka_agent_campaign_effectiveness_scope(p_staff_id, p_organization_id, v_accounts, v_actions, v_campaigns,
            v_from, v_to, v_success, v_skipped, v_failure) s
          LEFT JOIN public.auto_campaign_input_data i ON i.id = s.input_data_id
          WHERE s.bucket = 'success' AND s.action_code = ANY(v_reach)
        ) k
        GROUP BY k.key
      ) u;
    END IF;
    RETURN jsonb_build_object('rows', v_rows, 'statusCodes', v_codes, 'unique', v_unique);
  END IF;

  IF v_mode = 'campaigns' THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object(
        'campaignId', g.campaign_id, 'actionCode', g.action_code, 'group', g.bucket, 'count', g.n,
        'tracked', g.tracked, 'responded', g.responded, 'reacted', g.reacted, 'seen', g.seen, 'friended', g.friended,
        'firstAt', g.first_at, 'lastAt', g.last_at, 'pendingInputIds', g.pending_inputs)
        ORDER BY g.campaign_id, g.action_code, g.bucket), '[]'::jsonb)
      INTO v_rows
    FROM (
      SELECT s.campaign_id, s.action_code, s.bucket, count(*) AS n,
        count(*) FILTER (WHERE s.bucket = 'success' AND s.tracked) AS tracked,
        count(*) FILTER (WHERE s.bucket = 'success' AND s.responded_at IS NOT NULL) AS responded,
        count(*) FILTER (WHERE s.bucket = 'success' AND s.responded_at IS NULL AND s.reacted_at IS NOT NULL) AS reacted,
        count(*) FILTER (WHERE s.bucket = 'success' AND s.responded_at IS NULL AND s.reacted_at IS NULL AND s.seen_at IS NOT NULL) AS seen,
        count(*) FILTER (WHERE s.bucket = 'success' AND s.friended_at IS NOT NULL) AS friended,
        min(s.created_at) AS first_at, max(s.created_at) AS last_at,
        array_agg(s.input_data_id) FILTER (WHERE s.bucket = 'pending' AND s.input_data_id IS NOT NULL) AS pending_inputs
      FROM private.aka_agent_campaign_effectiveness_scope(p_staff_id, p_organization_id, v_accounts, v_actions, v_campaigns,
        v_from, v_to, v_success, v_skipped, v_failure) s
      WHERE s.bucket IS NOT NULL
      GROUP BY 1, 2, 3
    ) g;
    RETURN jsonb_build_object('rows', v_rows);
  END IF;

  IF v_mode = 'hours' THEN
    -- Only tracked successful sends; hour of the send and hour of each customer action (Vietnam time).
    WITH t AS MATERIALIZED (
      SELECT CASE WHEN s.action_code = 'zalo_add_friend' THEN 'friend' ELSE 'message' END AS family,
        coalesce(s.sent_at, s.created_at) AS sent_at, s.seen_at, s.responded_at, s.reacted_at, s.friended_at
      FROM private.aka_agent_campaign_effectiveness_scope(p_staff_id, p_organization_id, v_accounts, v_actions, v_campaigns,
        v_from, v_to, v_success, v_skipped, v_failure) s
      WHERE s.bucket = 'success' AND s.tracked AND s.action_code = ANY(v_tracked_actions)
    )
    SELECT jsonb_build_object(
      'cells', (SELECT coalesce(jsonb_agg(jsonb_build_object('dow', c.dow, 'hour', c.hour, 'family', c.family,
          'tracked', c.tracked, 'seen', c.seen, 'interacted', c.interacted, 'friended', c.friended)
          ORDER BY c.family, c.dow, c.hour), '[]'::jsonb)
        FROM (
          SELECT extract(isodow FROM t.sent_at AT TIME ZONE v_tz)::int AS dow,
            extract(hour FROM t.sent_at AT TIME ZONE v_tz)::int AS hour, t.family, count(*) AS tracked,
            count(*) FILTER (WHERE t.seen_at IS NOT NULL OR t.reacted_at IS NOT NULL OR t.responded_at IS NOT NULL) AS seen,
            count(*) FILTER (WHERE t.reacted_at IS NOT NULL OR t.responded_at IS NOT NULL) AS interacted,
            count(*) FILTER (WHERE t.friended_at IS NOT NULL) AS friended
          FROM t GROUP BY 1, 2, 3
        ) c),
      'activity', (SELECT coalesce(jsonb_agg(jsonb_build_object('hour', a.hour, 'seen', a.seen, 'responded', a.responded,
          'reacted', a.reacted, 'friended', a.friended) ORDER BY a.hour), '[]'::jsonb)
        FROM (
          SELECT x.hour, sum(x.seen)::bigint AS seen, sum(x.responded)::bigint AS responded,
            sum(x.reacted)::bigint AS reacted, sum(x.friended)::bigint AS friended
          FROM (
            SELECT extract(hour FROM t.seen_at AT TIME ZONE v_tz)::int AS hour, 1 AS seen, 0 AS responded, 0 AS reacted, 0 AS friended FROM t WHERE t.seen_at IS NOT NULL
            UNION ALL SELECT extract(hour FROM t.responded_at AT TIME ZONE v_tz)::int, 0, 1, 0, 0 FROM t WHERE t.responded_at IS NOT NULL
            UNION ALL SELECT extract(hour FROM t.reacted_at AT TIME ZONE v_tz)::int, 0, 0, 1, 0 FROM t WHERE t.reacted_at IS NOT NULL
            UNION ALL SELECT extract(hour FROM t.friended_at AT TIME ZONE v_tz)::int, 0, 0, 0, 1 FROM t WHERE t.friended_at IS NOT NULL
          ) x GROUP BY x.hour
        ) a),
      'medianResponseMinutes', (SELECT round((percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM t.responded_at - t.sent_at) / 60))::numeric, 1)
        FROM t WHERE t.family = 'message' AND t.responded_at IS NOT NULL AND t.responded_at >= t.sent_at),
      'medianSeenMinutes', (SELECT round((percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM t.seen_at - t.sent_at) / 60))::numeric, 1)
        FROM t WHERE t.family = 'message' AND t.seen_at IS NOT NULL AND t.seen_at >= t.sent_at)
    ) INTO v_result;
    RETURN v_result;
  END IF;

  IF v_mode = 'data_groups' THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('groupId', g.group_id, 'name', grp.name, 'reached', g.reached,
        'tracked', g.tracked, 'seen', g.seen, 'interacted', g.interacted, 'friended', g.friended)
        ORDER BY g.reached DESC, g.group_id), '[]'::jsonb)
      INTO v_rows
    FROM (
      SELECT o.group_id, count(*) AS reached, count(*) FILTER (WHERE s.tracked) AS tracked,
        count(*) FILTER (WHERE s.seen_at IS NOT NULL OR s.reacted_at IS NOT NULL OR s.responded_at IS NOT NULL) AS seen,
        count(*) FILTER (WHERE s.reacted_at IS NOT NULL OR s.responded_at IS NOT NULL) AS interacted,
        count(*) FILTER (WHERE s.friended_at IS NOT NULL) AS friended
      FROM private.aka_agent_campaign_effectiveness_scope(p_staff_id, p_organization_id, v_accounts, v_actions, v_campaigns,
        v_from, v_to, v_success, v_skipped, v_failure) s
      JOIN LATERAL (
        SELECT DISTINCT og.group_id FROM public.auto_campaign_input_origins og
        WHERE og.input_data_id = s.input_data_id AND og.origin_kind = 'group' AND og.group_id IS NOT NULL
      ) o ON true
      WHERE s.bucket = 'success' AND s.action_code = ANY(v_reach) AND s.input_data_id IS NOT NULL
      GROUP BY o.group_id
      ORDER BY count(*) DESC, o.group_id
      LIMIT 50
    ) g
    JOIN public.auto_account_contact_groups grp ON grp.id = g.group_id AND grp.organization_id = p_organization_id;
    RETURN jsonb_build_object('rows', v_rows);
  END IF;

  IF v_mode = 'list' THEN
    v_stage := p_query->>'stage';
    IF v_stage IS NULL OR v_stage NOT IN ('responded','reacted','seen','sent','friended','requested','interacted','engaged') THEN
      RAISE EXCEPTION 'invalid_report_query' USING ERRCODE = '22023';
    END IF;
    SELECT coalesce(jsonb_agg(jsonb_build_object('id', r.detail_id, 'campaignId', r.campaign_id, 'campaignName', r.campaign_name,
        'accountId', r.account_id, 'actionCode', r.action_code, 'sentAt', r.created_at, 'seenAt', r.seen_at,
        'respondedAt', r.responded_at, 'reactedAt', r.reacted_at, 'friendedAt', r.friended_at,
        'name', r.name, 'uid', r.uid, 'phone', r.phone) ORDER BY r.created_at DESC, r.detail_id DESC), '[]'::jsonb)
      INTO v_rows
    FROM (
      SELECT s.detail_id, s.campaign_id, c.name AS campaign_name, s.account_id, s.action_code, s.created_at,
        s.seen_at, s.responded_at, s.reacted_at, s.friended_at, i.name, coalesce(nullif(i.uid, ''), s.target_zalo_uid) AS uid, i.phone
      FROM private.aka_agent_campaign_effectiveness_scope(p_staff_id, p_organization_id, v_accounts, v_actions, v_campaigns,
        v_from, v_to, v_success, v_skipped, v_failure) s
      JOIN public.auto_campaigns c ON c.id = s.campaign_id
      LEFT JOIN public.auto_campaign_input_data i ON i.id = s.input_data_id
      WHERE s.bucket = 'success' AND CASE v_stage
        WHEN 'responded' THEN s.action_code = ANY(v_message) AND s.responded_at IS NOT NULL
        WHEN 'reacted' THEN s.action_code = ANY(v_message) AND s.responded_at IS NULL AND s.reacted_at IS NOT NULL
        WHEN 'seen' THEN s.action_code = ANY(v_message) AND s.responded_at IS NULL AND s.reacted_at IS NULL AND s.seen_at IS NOT NULL
        WHEN 'sent' THEN s.action_code = ANY(v_message) AND s.responded_at IS NULL AND s.reacted_at IS NULL AND s.seen_at IS NULL
        WHEN 'friended' THEN s.action_code = 'zalo_add_friend' AND s.friended_at IS NOT NULL
        WHEN 'requested' THEN s.action_code = 'zalo_add_friend' AND s.friended_at IS NULL
        WHEN 'interacted' THEN s.action_code = ANY(v_message) AND (s.responded_at IS NOT NULL OR s.reacted_at IS NOT NULL)
        ELSE (s.action_code = ANY(v_message) AND (s.responded_at IS NOT NULL OR s.reacted_at IS NOT NULL))
          OR (s.action_code = 'zalo_add_friend' AND s.friended_at IS NOT NULL)
      END
      ORDER BY s.created_at DESC, s.detail_id DESC
      LIMIT v_limit OFFSET v_offset
    ) r;
    IF coalesce((p_query->>'count')::boolean, false) THEN
      SELECT count(*) INTO v_total
      FROM private.aka_agent_campaign_effectiveness_scope(p_staff_id, p_organization_id, v_accounts, v_actions, v_campaigns,
        v_from, v_to, v_success, v_skipped, v_failure) s
      WHERE s.bucket = 'success' AND CASE v_stage
        WHEN 'responded' THEN s.action_code = ANY(v_message) AND s.responded_at IS NOT NULL
        WHEN 'reacted' THEN s.action_code = ANY(v_message) AND s.responded_at IS NULL AND s.reacted_at IS NOT NULL
        WHEN 'seen' THEN s.action_code = ANY(v_message) AND s.responded_at IS NULL AND s.reacted_at IS NULL AND s.seen_at IS NOT NULL
        WHEN 'sent' THEN s.action_code = ANY(v_message) AND s.responded_at IS NULL AND s.reacted_at IS NULL AND s.seen_at IS NULL
        WHEN 'friended' THEN s.action_code = 'zalo_add_friend' AND s.friended_at IS NOT NULL
        WHEN 'requested' THEN s.action_code = 'zalo_add_friend' AND s.friended_at IS NULL
        WHEN 'interacted' THEN s.action_code = ANY(v_message) AND (s.responded_at IS NOT NULL OR s.reacted_at IS NOT NULL)
        ELSE (s.action_code = ANY(v_message) AND (s.responded_at IS NOT NULL OR s.reacted_at IS NOT NULL))
          OR (s.action_code = 'zalo_add_friend' AND s.friended_at IS NOT NULL)
      END;
    END IF;
    RETURN jsonb_build_object('rows', v_rows, 'total', v_total);
  END IF;

  -- lifetime: Vietnam month × action for successful results, plus unique reach.
  SELECT coalesce(jsonb_agg(jsonb_build_object('month', m.month, 'actionCode', m.action_code, 'count', m.n,
      'tracked', m.tracked, 'seen', m.seen, 'interacted', m.interacted, 'friended', m.friended)
      ORDER BY m.month, m.action_code), '[]'::jsonb)
    INTO v_rows
  FROM (
    SELECT to_char(s.created_at AT TIME ZONE v_tz, 'YYYY-MM') AS month, s.action_code, count(*) AS n,
      count(*) FILTER (WHERE s.tracked) AS tracked,
      count(*) FILTER (WHERE s.seen_at IS NOT NULL OR s.reacted_at IS NOT NULL OR s.responded_at IS NOT NULL) AS seen,
      count(*) FILTER (WHERE s.reacted_at IS NOT NULL OR s.responded_at IS NOT NULL) AS interacted,
      count(*) FILTER (WHERE s.friended_at IS NOT NULL) AS friended
    FROM private.aka_agent_campaign_effectiveness_scope(p_staff_id, p_organization_id, v_accounts, v_actions, v_campaigns,
      v_from, v_to, v_success, v_skipped, v_failure) s
    WHERE s.bucket = 'success'
    GROUP BY 1, 2
  ) m;
  IF coalesce((p_query->>'includeUnique')::boolean, false) THEN
    SELECT jsonb_build_object('reached', count(*)) INTO v_unique
    FROM (
      SELECT DISTINCT coalesce('zalo_person_uid:' || nullif(lower(btrim(s.target_zalo_uid)), ''), nullif(i.canonical_target_key, ''), 'detail:' || s.detail_id::text)
      FROM private.aka_agent_campaign_effectiveness_scope(p_staff_id, p_organization_id, v_accounts, v_actions, v_campaigns,
        v_from, v_to, v_success, v_skipped, v_failure) s
      LEFT JOIN public.auto_campaign_input_data i ON i.id = s.input_data_id
      WHERE s.bucket = 'success' AND s.action_code = ANY(v_reach)
    ) u;
  END IF;
  RETURN jsonb_build_object('monthly', v_rows, 'unique', v_unique,
    'firstCampaignAt', (SELECT min(created_at) FROM public.auto_campaigns WHERE staff_id = p_staff_id AND organization_id = p_organization_id));
END;
$function$;
COMMENT ON FUNCTION public.aka_agent_read_campaign_effectiveness(bigint,bigint,text,text,jsonb) IS
  'V462 read-only campaign effectiveness aggregates (summary, campaigns, hours, data_groups, list, lifetime) for WebApp/iOS/Desktop reports. service_role, or aka_agent_desktop bound to the same staff with automation credentials; 60s per call; reads engagement marks, never writes.';

DO $postflight$
BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc
      WHERE oid = to_regprocedure('public.aka_agent_read_campaign_effectiveness(bigint,bigint,text,text,jsonb)'))
     IS DISTINCT FROM 'bac1ca83f7b5cab19c0aa026ad75ea3b' THEN
    RAISE EXCEPTION 'rollback_v464_checksum_mismatch';
  END IF;
  IF (SELECT array_agg(g ORDER BY g) FROM (
        SELECT DISTINCT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END AS g
        FROM pg_proc pr, aclexplode(pr.proacl) a
        WHERE pr.oid = to_regprocedure('public.aka_agent_read_campaign_effectiveness(bigint,bigint,text,text,jsonb)')) x)
     IS DISTINCT FROM ARRAY['aka_agent_desktop','postgres','service_role'] THEN
    RAISE EXCEPTION 'rollback_v464_reader_acl_unexpected';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = to_regprocedure('public.aka_agent_read_campaign_effectiveness(bigint,bigint,text,text,jsonb)')
      AND prosecdef AND provolatile = 's' AND proowner = 'postgres'::regrole
      AND proconfig = ARRAY['search_path=pg_catalog, public', 'statement_timeout=60s']) THEN
    RAISE EXCEPTION 'rollback_v464_reader_attributes_unexpected';
  END IF;
END
$postflight$;
NOTIFY pgrst, 'reload schema';
COMMIT;
