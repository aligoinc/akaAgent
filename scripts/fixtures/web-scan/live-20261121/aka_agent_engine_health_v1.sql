CREATE OR REPLACE FUNCTION public.aka_agent_engine_health_v1(p_minutes integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET statement_timeout TO '60s'
AS $function$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_minutes integer := greatest(1, least(coalesce(p_minutes, 30), 10080));
  v_since timestamptz;
  v_day timestamptz;
  v_stuck jsonb;
  v_open jsonb;
  v_unmatched jsonb;
  v_errors jsonb;
BEGIN
  v_since := v_now - make_interval(mins => v_minutes);
  v_day := v_now - make_interval(mins => greatest(v_minutes, 1440));
  -- Chiến dịch FB của tổ chức bật engine: đến lịch quá N phút mà không có lượt data nào của engine bắt đầu trong N phút.
  WITH last_run AS MATERIALIZED (
    SELECT tr.campaign_id, max(tr.started_at) AS started_at, count(*) FILTER (WHERE tr.completed_at IS NULL) AS open_runs
      FROM public.auto_engine_target_runs tr WHERE tr.started_at >= v_day GROUP BY tr.campaign_id
  ), fb AS MATERIALIZED (
    SELECT c.id, c.name, c.organization_id, c.staff_id, c.account_id, c.action_id, c.status, c.schedule, c.note, c.updated_at
      FROM public.auto_campaigns c JOIN public.auto_campaign_actions ca ON ca.id = c.action_id
     WHERE lower(btrim(coalesce(ca.flatform_type, ''))) = 'facebook' AND coalesce(c.is_delete, false) = false
       AND c.status IN ('chờ xử lý', 'đang chạy') AND (c.schedule IS NULL OR c.schedule <= v_since)
       AND public.aka_agent_engine_facebook_org_enabled(c.organization_id)
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('campaignId', fb.id, 'name', fb.name, 'organizationId', fb.organization_id, 'staffId', fb.staff_id,
           'accountId', fb.account_id, 'actionId', fb.action_id, 'status', fb.status, 'schedule', fb.schedule, 'note', fb.note,
           'updatedAt', fb.updated_at, 'lastRunAt', lr.started_at, 'openRuns', coalesce(lr.open_runs, 0),
           'accountLoginStatus', a.login_status, 'accountStatus', a.status,
           'lease', (SELECT jsonb_build_object('runnerId', l.runner_id, 'campaignId', l.campaign_id, 'expiresAt', l.expires_at,
                       'heartbeatAt', l.heartbeat_at) FROM public.auto_engine_leases l WHERE l.account_id = fb.account_id),
           'dueTargets', (SELECT count(*) FROM (SELECT 1 FROM public.auto_campaign_input_data d WHERE d.campaign_id = fb.id AND d.status = 'chờ xử lý'
                            AND coalesce(d.is_delete, false) = false AND (d.schedule IS NULL OR d.schedule <= v_now) LIMIT 1000) x)
         ) ORDER BY fb.schedule NULLS FIRST, fb.id), '[]'::jsonb) INTO v_stuck
    FROM fb
    LEFT JOIN last_run lr ON lr.campaign_id = fb.id
    LEFT JOIN public.auto_accounts a ON a.id = fb.account_id
   WHERE lr.started_at IS NULL OR lr.started_at < v_since;
  -- Lượt data FB còn mở quá N phút (block treo, máy ngủ, mất lease mà chưa đóng).
  SELECT coalesce(jsonb_agg(jsonb_build_object('targetRunId', tr.id, 'campaignId', tr.campaign_id, 'accountId', tr.account_id,
           'inputDataId', tr.input_data_id, 'startedAt', tr.started_at, 'firstMarkedAt', tr.first_marked_at, 'marks', tr.marks,
           'outcomeCount', tr.outcome_count) ORDER BY tr.started_at), '[]'::jsonb) INTO v_open
    FROM public.auto_engine_target_runs tr
    JOIN public.auto_accounts a ON a.id = tr.account_id
   WHERE tr.completed_at IS NULL AND tr.started_at < v_since AND lower(btrim(coalesce(a.flatform_type, ''))) = 'facebook';
  SELECT coalesce(jsonb_agg(jsonb_build_object('actionCode', u.action_code, 'phase', u.phase, 'signalKind', u.signal_kind, 'patternKey', u.pattern_key,
           'fallbackErrorCode', u.fallback_error_code, 'hitCount', u.hit_count, 'firstSeenAt', u.first_seen_at, 'lastSeenAt', u.last_seen_at,
           'sample', u.sample) ORDER BY u.hit_count DESC), '[]'::jsonb) INTO v_unmatched
    FROM (SELECT * FROM public.auto_outcome_unmatched x WHERE x.platform = 'facebook' AND x.last_seen_at >= v_since
           ORDER BY x.hit_count DESC LIMIT 50) u;
  SELECT coalesce(jsonb_object_agg(x.error_code, x.n), '{}'::jsonb) INTO v_errors
    FROM (SELECT coalesce(o.error_code, CASE WHEN o.ok THEN 'ok' ELSE 'unknown' END) AS error_code, count(*) AS n
            FROM public.auto_engine_outcomes o WHERE o.created_at >= v_since AND o.action_code LIKE 'fb\_%'
           GROUP BY 1) x;
  RETURN jsonb_build_object('ok', true, 'at', v_now, 'minutes', v_minutes, 'stuckCampaigns', v_stuck, 'openRuns', v_open,
    'unmatched', v_unmatched, 'outcomesByCode', v_errors);
END $function$
