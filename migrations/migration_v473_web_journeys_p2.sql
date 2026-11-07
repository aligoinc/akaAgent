-- V473 phần 2/4: Quy trình tự động trên Web (hàm điều khiển của route Web), production cgjbsmqtfhqvttudyjzq only.
-- Apply sau p1, trước p3; mỗi phần một giao dịch. Hợp đồng và lý do tách: đầu migration_v473_web_journeys_p1.sql.
-- Rollback (gỡ cả bốn phần): migrations/rollback_v473_web_journeys.sql
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- Phần trước phải đã commit (hàm cuối của nó có mặt); phần này chưa chạy (hàm đầu của nó chưa có).
DO $guard_p2$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'private' AND p.proname = 'aka_agent_journey_owned') THEN
    RAISE EXCEPTION 'v473_p2_requires_p1';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'private' AND p.proname = 'aka_agent_journey_ctl_access') THEN
    RAISE EXCEPTION 'v473_p2_already_applied_do_not_overwrite';
  END IF;
END
$guard_p2$;

-- ---------------------------------------------------------------------------------------------------------
-- Control actions
-- ---------------------------------------------------------------------------------------------------------
CREATE FUNCTION private.aka_agent_journey_ctl_access(p_staff_id bigint, p_organization_id bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $function$
DECLARE
  v_value jsonb := private.aka_agent_journey_setting('web.journeys');
  v_orgs jsonb;
  v_enabled boolean := false;
BEGIN
  IF jsonb_typeof(v_value) = 'object' AND jsonb_typeof(v_value -> 'enabled') = 'boolean' THEN
    v_enabled := (v_value ->> 'enabled')::boolean;
    v_orgs := v_value -> 'organizationIds';
    IF v_enabled AND v_orgs IS NOT NULL AND jsonb_typeof(v_orgs) <> 'null' THEN
      v_enabled := jsonb_typeof(v_orgs) = 'array' AND v_orgs @> to_jsonb(p_organization_id);
    END IF;
  END IF;
  RETURN jsonb_build_object('enabled', coalesce(v_enabled, false));
END
$function$;

CREATE FUNCTION private.aka_agent_journey_ctl_list(p_staff_id bigint, p_organization_id bigint) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $function$
  SELECT jsonb_build_object('items', coalesce(jsonb_agg(private.aka_agent_journey_summary(x.id) ORDER BY x.updated_at DESC, x.id DESC), '[]'::jsonb))
  FROM (
    SELECT j.id, j.updated_at FROM public.auto_journeys j
    WHERE j.staff_id = p_staff_id AND j.organization_id = p_organization_id AND j.is_delete = false
    ORDER BY j.updated_at DESC, j.id DESC
    LIMIT 200
  ) x
$function$;

CREATE FUNCTION private.aka_agent_journey_ctl_get(p_staff_id bigint, p_organization_id bigint, p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $function$
DECLARE
  j public.auto_journeys%ROWTYPE;
BEGIN
  j := private.aka_agent_journey_owned(p_staff_id, p_organization_id, p_payload, false);
  RETURN private.aka_agent_journey_detail(j.id);
END
$function$;

-- Draft payload checks shared by create and save_draft.
CREATE FUNCTION private.aka_agent_journey_check_draft(p_graph jsonb, p_settings jsonb) RETURNS void
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog AS $function$
BEGIN
  IF jsonb_typeof(p_graph) IS DISTINCT FROM 'object' OR jsonb_typeof(p_settings) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'journey_invalid_payload';
  END IF;
  IF octet_length(p_graph::text) + octet_length(p_settings::text) > 262144 THEN
    RAISE EXCEPTION 'journey_payload_too_large';
  END IF;
END
$function$;

CREATE FUNCTION private.aka_agent_journey_ctl_create(p_staff_id bigint, p_organization_id bigint, p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $function$
DECLARE
  v_name text := btrim(coalesce(p_payload ->> 'name', ''));
  v_origin text := coalesce(nullif(p_payload ->> 'origin', ''), 'blank');
  v_template text;
  v_count integer;
  v_id bigint;
BEGIN
  IF jsonb_typeof(p_payload -> 'name') IS DISTINCT FROM 'string' OR v_name = '' OR char_length(v_name) > 200
     OR v_origin NOT IN ('blank', 'template', 'ai', 'legacy')
     OR coalesce(jsonb_typeof(p_payload -> 'templateCode'), 'null') NOT IN ('string', 'null') THEN
    RAISE EXCEPTION 'journey_invalid_payload';
  END IF;
  v_template := nullif(btrim(coalesce(p_payload ->> 'templateCode', '')), '');
  IF char_length(v_template) > 100 THEN
    RAISE EXCEPTION 'journey_invalid_payload';
  END IF;
  PERFORM private.aka_agent_journey_check_draft(p_payload -> 'graph', p_payload -> 'settings');
  -- Serialize creates of one staff so the limit holds under concurrency.
  PERFORM pg_advisory_xact_lock(hashtextextended('aka-agent-journey-staff:' || p_staff_id::text, 0));
  SELECT count(*) INTO v_count FROM public.auto_journeys
  WHERE staff_id = p_staff_id AND organization_id = p_organization_id AND is_delete = false;
  IF v_count >= 100 THEN
    RAISE EXCEPTION 'journey_limit_reached';
  END IF;
  INSERT INTO public.auto_journeys (staff_id, organization_id, name, status, origin, template_code, draft_graph, draft_settings)
  VALUES (p_staff_id, p_organization_id, v_name, 'draft', v_origin, v_template, p_payload -> 'graph', p_payload -> 'settings')
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('id', v_id);
END
$function$;

CREATE FUNCTION private.aka_agent_journey_ctl_save_draft(p_staff_id bigint, p_organization_id bigint, p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $function$
DECLARE
  j public.auto_journeys%ROWTYPE;
  v_revision bigint := private.aka_agent_journey_bigint(p_payload -> 'revision');
  v_name text;
BEGIN
  j := private.aka_agent_journey_owned(p_staff_id, p_organization_id, p_payload, true);
  IF p_payload ? 'name' AND jsonb_typeof(p_payload -> 'name') <> 'null' THEN
    v_name := btrim(coalesce(p_payload ->> 'name', ''));
    IF jsonb_typeof(p_payload -> 'name') <> 'string' OR v_name = '' OR char_length(v_name) > 200 THEN
      RAISE EXCEPTION 'journey_invalid_payload';
    END IF;
  END IF;
  PERFORM private.aka_agent_journey_check_draft(p_payload -> 'graph', p_payload -> 'settings');
  IF v_revision IS NULL OR v_revision <> j.draft_revision THEN
    RAISE EXCEPTION 'journey_revision_conflict';
  END IF;
  UPDATE public.auto_journeys
  SET draft_graph = p_payload -> 'graph', draft_settings = p_payload -> 'settings', name = coalesce(v_name, name),
      draft_revision = draft_revision + 1, draft_updated_at = now(), updated_at = now()
  WHERE id = j.id
  RETURNING * INTO j;
  RETURN jsonb_build_object('revision', j.draft_revision, 'updatedAt', j.draft_updated_at);
END
$function$;

CREATE FUNCTION private.aka_agent_journey_campaign_ids(p_journey_id bigint, p_active_only boolean) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $function$
  SELECT coalesce(jsonb_agg(sc.campaign_id ORDER BY sc.campaign_id), '[]'::jsonb)
  FROM public.auto_journey_step_campaigns sc
  WHERE sc.journey_id = p_journey_id AND (NOT p_active_only OR sc.is_active)
$function$;

-- Every active enrollment of a journey leaves (stop/delete). Returns how many left.
CREATE FUNCTION private.aka_agent_journey_exit_all(p_journey_id bigint, p_code text, p_reason text) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $function$
DECLARE
  v_by_step jsonb;
  v_stats jsonb := '{}'::jsonb;
  v_total bigint := 0;
  r record;
BEGIN
  WITH o AS (
    UPDATE public.auto_journey_enrollments e
    SET status = 'exited', exit_code = p_code, exit_reason = p_reason, finished_at = now(), next_run_at = NULL,
        paused_next_run_at = NULL, phase = 'ready', pending_outcome = NULL, pending_reason = NULL,
        lease_token = NULL, lease_until = NULL, updated_at = now()
    WHERE e.journey_id = p_journey_id AND e.status = 'active'
    RETURNING e.id, e.step_id
  ), ev AS (
    INSERT INTO public.auto_journey_events (journey_id, enrollment_id, step_id, kind, message)
    SELECT p_journey_id, o.id, o.step_id, 'exit', p_reason FROM o
  )
  SELECT coalesce(jsonb_object_agg(coalesce(x.step_id, ''), x.n), '{}'::jsonb) INTO v_by_step
  FROM (SELECT o.step_id, count(*) AS n FROM o GROUP BY o.step_id) x;
  FOR r IN SELECT e.key, e.value::bigint AS n FROM jsonb_each_text(v_by_step) e LOOP
    v_total := v_total + r.n;
    IF r.key <> '' THEN
      v_stats := private.aka_agent_journey_stat_add(v_stats, p_journey_id, r.key, 'exited', r.n);
    END IF;
  END LOOP;
  v_stats := private.aka_agent_journey_stat_add(v_stats, p_journey_id, '*', 'exited', v_total);
  PERFORM private.aka_agent_journey_stats_flush(v_stats);
  RETURN v_total;
END
$function$;

CREATE FUNCTION private.aka_agent_journey_ctl_publish_prepare(p_staff_id bigint, p_organization_id bigint, p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $function$
DECLARE
  j public.auto_journeys%ROWTYPE;
  v public.auto_journey_versions%ROWTYPE;
  v_revision bigint := private.aka_agent_journey_bigint(p_payload -> 'revision');
  v_steps text[];
  v_step_campaigns jsonb;
  v_orphans jsonb;
BEGIN
  j := private.aka_agent_journey_owned(p_staff_id, p_organization_id, p_payload, false);
  IF v_revision IS NULL OR v_revision <> j.draft_revision THEN
    RAISE EXCEPTION 'journey_revision_conflict';
  END IF;
  IF j.active_version_id IS NOT NULL THEN
    SELECT * INTO v FROM public.auto_journey_versions WHERE id = j.active_version_id;
  END IF;
  v_steps := ARRAY(SELECT s.step_id FROM private.aka_agent_journey_steps(j.draft_graph) s);
  SELECT coalesce(jsonb_agg(jsonb_build_object('stepId', sc.step_id, 'accountId', sc.account_id, 'actionCode', sc.action_code,
      'campaignId', sc.campaign_id, 'configHash', sc.config_hash) ORDER BY sc.step_id, sc.account_id, sc.action_code, sc.id), '[]'::jsonb)
  INTO v_step_campaigns
  FROM public.auto_journey_step_campaigns sc
  WHERE sc.journey_id = j.id AND sc.is_active;
  SELECT coalesce(jsonb_object_agg(x.step_id, x.n), '{}'::jsonb) INTO v_orphans
  FROM (
    SELECT e.step_id, count(*) AS n
    FROM public.auto_journey_enrollments e
    WHERE e.journey_id = j.id AND e.status = 'active' AND e.step_id IS NOT NULL AND NOT (e.step_id = ANY(v_steps))
    GROUP BY e.step_id
  ) x;
  RETURN jsonb_build_object(
    'name', j.name,
    'draft', jsonb_build_object('graph', j.draft_graph, 'settings', j.draft_settings, 'revision', j.draft_revision),
    'active', CASE WHEN v.id IS NULL THEN NULL ELSE jsonb_build_object('versionId', v.id, 'graph', v.graph, 'settings', v.settings) END,
    'stepCampaigns', v_step_campaigns,
    'orphanedByStep', v_orphans,
    'status', j.status);
END
$function$;

CREATE FUNCTION private.aka_agent_journey_ctl_publish(p_staff_id bigint, p_organization_id bigint, p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $function$
DECLARE
  j public.auto_journeys%ROWTYPE;
  s public.auto_journey_sources%ROWTYPE;
  v_revision bigint := private.aka_agent_journey_bigint(p_payload -> 'revision');
  v_graph jsonb := p_payload -> 'graph';
  v_settings jsonb := p_payload -> 'settings';
  v_policy text := coalesce(nullif(p_payload ->> 'orphanPolicy', ''), 'continue');
  v_next jsonb := coalesce(nullif(p_payload -> 'orphanNext', 'null'::jsonb), '{}'::jsonb);
  v_checksum text;
  v_steps text[];
  v_item jsonb;
  v_step text;
  v_account bigint;
  v_action text;
  v_campaign bigint;
  v_hash text;
  v_kind text;
  v_group bigint;
  v_key text;
  v_entry boolean;
  v_stop boolean;
  v_mark boolean;
  v_include boolean;
  v_statuses text[];
  v_seen_keys text[] := '{}';
  v_seen_campaigns bigint[] := '{}';
  v_sources jsonb := '{}'::jsonb;
  v_src jsonb;
  v_old jsonb;
  v_gained boolean;
  v_found boolean;
  v_accounts bigint[];
  v_groups bigint[];
  v_campaigns bigint[];
  v_version_id bigint;
  v_version_no integer;
  v_paused boolean;
  v_by_step jsonb;
  v_stats jsonb := '{}'::jsonb;
  r record;
BEGIN
  j := private.aka_agent_journey_owned(p_staff_id, p_organization_id, p_payload, true);
  IF j.status = 'stopped' THEN
    RAISE EXCEPTION 'journey_invalid_transition';
  END IF;
  IF v_revision IS NULL OR v_revision <> j.draft_revision
     OR v_graph IS DISTINCT FROM j.draft_graph OR v_settings IS DISTINCT FROM j.draft_settings THEN
    RAISE EXCEPTION 'journey_revision_conflict';
  END IF;
  IF v_policy NOT IN ('continue', 'exit') OR jsonb_typeof(v_next) <> 'object'
     OR coalesce(jsonb_typeof(p_payload -> 'stepCampaigns'), 'null') NOT IN ('array', 'null')
     OR coalesce(jsonb_typeof(p_payload -> 'sources'), 'null') NOT IN ('array', 'null')
     OR coalesce(jsonb_typeof(p_payload -> 'checksum'), 'null') NOT IN ('string', 'null') THEN
    RAISE EXCEPTION 'journey_invalid_payload';
  END IF;
  v_checksum := left(coalesce(nullif(btrim(p_payload ->> 'checksum'), ''), md5(v_graph::text || v_settings::text)), 200);
  v_steps := ARRAY(SELECT st.step_id FROM private.aka_agent_journey_steps(v_graph) st);
  IF EXISTS (SELECT 1 FROM jsonb_each(v_next) n
             WHERE jsonb_typeof(n.value) <> 'null' AND (jsonb_typeof(n.value) <> 'string' OR NOT ((n.value #>> '{}') = ANY(v_steps)))) THEN
    RAISE EXCEPTION 'journey_invalid_payload';
  END IF;

  -- Managed step campaigns: same tenant, not deleted, same account/action, not owned by another journey.
  FOR v_item IN SELECT x.value FROM jsonb_array_elements(coalesce(nullif(p_payload -> 'stepCampaigns', 'null'::jsonb), '[]'::jsonb)) x LOOP
    IF jsonb_typeof(v_item) <> 'object' OR coalesce(jsonb_typeof(v_item -> 'configHash'), 'null') NOT IN ('string', 'null') THEN
      RAISE EXCEPTION 'journey_invalid_payload';
    END IF;
    v_step := v_item ->> 'stepId';
    v_account := private.aka_agent_journey_bigint(v_item -> 'accountId');
    v_action := nullif(btrim(coalesce(v_item ->> 'actionCode', '')), '');
    v_campaign := private.aka_agent_journey_bigint(v_item -> 'campaignId');
    v_hash := coalesce(v_item ->> 'configHash', '');
    IF v_step IS NULL OR char_length(v_step) NOT BETWEEN 1 AND 100 OR v_account IS NULL OR v_action IS NULL
       OR v_campaign IS NULL OR char_length(v_hash) > 200 THEN
      RAISE EXCEPTION 'journey_invalid_payload';
    END IF;
    v_key := v_step || chr(31) || v_account::text || chr(31) || v_action;
    IF NOT (v_step = ANY(v_steps)) OR v_key = ANY(v_seen_keys) OR v_campaign = ANY(v_seen_campaigns) THEN
      RAISE EXCEPTION 'journey_campaign_invalid';
    END IF;
    v_seen_keys := v_seen_keys || v_key;
    v_seen_campaigns := v_seen_campaigns || v_campaign;
    IF NOT EXISTS (
         SELECT 1 FROM public.auto_campaigns c
         WHERE c.id = v_campaign AND c.staff_id = p_staff_id AND c.organization_id = p_organization_id
           AND c.is_delete IS NOT TRUE AND c.action_id = v_action AND c.account_id = v_account)
       OR EXISTS (
         SELECT 1 FROM public.auto_journey_step_campaigns sc
         WHERE sc.campaign_id = v_campaign
           AND (sc.journey_id <> j.id OR (sc.step_id, sc.account_id, sc.action_code, sc.config_hash)
                IS DISTINCT FROM (v_step, v_account, v_action, v_hash))) THEN
      RAISE EXCEPTION 'journey_campaign_invalid';
    END IF;
  END LOOP;

  -- Sources, merged by key (same data group may be entry + stop/mark).
  FOR v_item IN SELECT x.value FROM jsonb_array_elements(coalesce(nullif(p_payload -> 'sources', 'null'::jsonb), '[]'::jsonb)) x LOOP
    IF jsonb_typeof(v_item) <> 'object'
       OR coalesce(jsonb_typeof(v_item -> 'isEntry'), 'boolean') <> 'boolean'
       OR coalesce(jsonb_typeof(v_item -> 'isStop'), 'boolean') <> 'boolean'
       OR coalesce(jsonb_typeof(v_item -> 'isMark'), 'boolean') <> 'boolean'
       OR coalesce(jsonb_typeof(v_item -> 'includeExisting'), 'boolean') <> 'boolean'
       OR coalesce(jsonb_typeof(v_item -> 'statuses'), 'null') NOT IN ('array', 'null') THEN
      RAISE EXCEPTION 'journey_invalid_payload';
    END IF;
    v_kind := v_item ->> 'kind';
    v_entry := coalesce((v_item ->> 'isEntry')::boolean, false);
    v_stop := coalesce((v_item ->> 'isStop')::boolean, false);
    v_mark := coalesce((v_item ->> 'isMark')::boolean, false);
    v_include := coalesce((v_item ->> 'includeExisting')::boolean, false);
    v_statuses := '{}';
    IF v_kind = 'data_group' THEN
      v_group := private.aka_agent_journey_bigint(v_item -> 'groupId');
      IF v_group IS NULL THEN
        RAISE EXCEPTION 'journey_invalid_payload';
      END IF;
      v_key := 'g:' || v_group::text;
    ELSIF v_kind = 'campaign_result' THEN
      v_campaign := private.aka_agent_journey_bigint(v_item -> 'campaignId');
      IF v_campaign IS NULL OR v_stop OR v_mark
         OR EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(nullif(v_item -> 'statuses', 'null'::jsonb), '[]'::jsonb)) st
                    WHERE jsonb_typeof(st.value) <> 'string' OR char_length(st.value #>> '{}') > 100)
         OR jsonb_array_length(coalesce(nullif(v_item -> 'statuses', 'null'::jsonb), '[]'::jsonb)) > 30 THEN
        RAISE EXCEPTION 'journey_invalid_payload';
      END IF;
      v_statuses := ARRAY(SELECT DISTINCT btrim(st.value #>> '{}')
                          FROM jsonb_array_elements(coalesce(nullif(v_item -> 'statuses', 'null'::jsonb), '[]'::jsonb)) st
                          WHERE btrim(st.value #>> '{}') <> '' ORDER BY 1);
      IF v_entry AND cardinality(v_statuses) = 0 THEN
        RAISE EXCEPTION 'journey_invalid_payload';
      END IF;
      v_key := 'c:' || v_campaign::text;
    ELSE
      RAISE EXCEPTION 'journey_invalid_payload';
    END IF;
    CONTINUE WHEN NOT (v_entry OR v_stop OR v_mark);
    v_old := v_sources -> v_key;
    v_sources := v_sources || jsonb_build_object(v_key, jsonb_build_object(
      'kind', v_kind,
      'id', CASE WHEN v_kind = 'data_group' THEN v_group ELSE v_campaign END,
      'entry', v_entry OR coalesce((v_old ->> 'entry')::boolean, false),
      'stop', v_stop OR coalesce((v_old ->> 'stop')::boolean, false),
      'mark', v_mark OR coalesce((v_old ->> 'mark')::boolean, false),
      'include', v_include OR coalesce((v_old ->> 'include')::boolean, false),
      'statuses', (SELECT coalesce(jsonb_agg(DISTINCT u.x ORDER BY u.x), '[]'::jsonb) FROM (
          SELECT unnest(v_statuses) AS x
          UNION SELECT jsonb_array_elements_text(coalesce(v_old -> 'statuses', '[]'::jsonb))) u)));
  END LOOP;

  -- Every account, data group and campaign the version uses belongs to this staff.
  v_accounts := ARRAY(SELECT DISTINCT rf.ref_id FROM private.aka_agent_journey_graph_refs(v_graph) rf WHERE rf.kind = 'account');
  v_groups := ARRAY(SELECT DISTINCT g.id FROM (
      SELECT rf.ref_id AS id FROM private.aka_agent_journey_graph_refs(v_graph) rf WHERE rf.kind IN ('group', 'condition_group')
      UNION SELECT unnest(private.aka_agent_journey_bigint_array(v_settings -> 'stopGroupIds'))
      UNION SELECT (sv.value ->> 'id')::bigint FROM jsonb_each(v_sources) sv WHERE sv.value ->> 'kind' = 'data_group') g
    WHERE g.id IS NOT NULL);
  v_campaigns := ARRAY(SELECT DISTINCT c.id FROM (
      SELECT rf.ref_id AS id FROM private.aka_agent_journey_graph_refs(v_graph) rf WHERE rf.kind = 'campaign'
      UNION SELECT (sv.value ->> 'id')::bigint FROM jsonb_each(v_sources) sv WHERE sv.value ->> 'kind' = 'campaign_result') c
    WHERE c.id IS NOT NULL);
  IF EXISTS (SELECT 1 FROM unnest(v_accounts) a(id) WHERE NOT EXISTS (
         SELECT 1 FROM public.auto_accounts x WHERE x.id = a.id AND x.staff_id = p_staff_id
           AND (x.organization_id IS NULL OR x.organization_id = p_organization_id) AND x.is_delete IS NOT TRUE))
     OR EXISTS (SELECT 1 FROM unnest(v_groups) g(id) WHERE NOT EXISTS (
         SELECT 1 FROM public.auto_account_contact_groups x WHERE x.id = g.id AND x.staff_id = p_staff_id
           AND x.organization_id = p_organization_id AND x.purpose = 'data_group' AND x.is_delete IS NOT TRUE))
     OR EXISTS (SELECT 1 FROM unnest(v_campaigns) c(id) WHERE NOT EXISTS (
         SELECT 1 FROM public.auto_campaigns x WHERE x.id = c.id AND x.staff_id = p_staff_id
           AND x.organization_id = p_organization_id AND x.is_delete IS NOT TRUE)) THEN
    RAISE EXCEPTION 'journey_reference_invalid';
  END IF;

  -- Version.
  SELECT coalesce(max(version_no), 0) + 1 INTO v_version_no FROM public.auto_journey_versions WHERE journey_id = j.id;
  INSERT INTO public.auto_journey_versions (journey_id, version_no, graph, settings, checksum, published_by_staff_id)
  VALUES (j.id, v_version_no, v_graph, v_settings, v_checksum, p_staff_id)
  RETURNING id INTO v_version_id;
  v_paused := j.status = 'paused';
  UPDATE public.auto_journeys
  SET active_version_id = v_version_id, status = CASE WHEN v_paused THEN 'paused' ELSE 'active' END,
      activated_at = coalesce(activated_at, now()), updated_at = now()
  WHERE id = j.id;

  -- Step campaigns: the payload set becomes the active set.
  UPDATE public.auto_journey_step_campaigns SET is_active = false, updated_at = now() WHERE journey_id = j.id AND is_active;
  BEGIN
    INSERT INTO public.auto_journey_step_campaigns (journey_id, step_id, account_id, action_code, config_hash, campaign_id, is_active)
    SELECT j.id, x.value ->> 'stepId', private.aka_agent_journey_bigint(x.value -> 'accountId'), btrim(x.value ->> 'actionCode'),
      coalesce(x.value ->> 'configHash', ''), private.aka_agent_journey_bigint(x.value -> 'campaignId'), true
    FROM jsonb_array_elements(coalesce(nullif(p_payload -> 'stepCampaigns', 'null'::jsonb), '[]'::jsonb)) x
    ON CONFLICT (journey_id, step_id, account_id, action_code, config_hash)
    DO UPDATE SET campaign_id = EXCLUDED.campaign_id, is_active = true, updated_at = now();
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'journey_campaign_invalid';
  END;

  -- Sources: existing active ones keep their cursor; new (or re-activated) ones start per includeExisting.
  FOR v_key, v_src IN SELECT sv.key, sv.value FROM jsonb_each(v_sources) sv LOOP
    IF v_src ->> 'kind' = 'data_group' THEN
      SELECT * INTO s FROM public.auto_journey_sources
      WHERE journey_id = j.id AND kind = 'data_group' AND group_id = (v_src ->> 'id')::bigint FOR UPDATE;
    ELSE
      SELECT * INTO s FROM public.auto_journey_sources
      WHERE journey_id = j.id AND kind = 'campaign_result' AND campaign_id = (v_src ->> 'id')::bigint FOR UPDATE;
    END IF;
    v_found := FOUND;
    v_entry := (v_src ->> 'entry')::boolean;
    v_stop := (v_src ->> 'stop')::boolean;
    v_mark := (v_src ->> 'mark')::boolean;
    v_include := (v_src ->> 'include')::boolean;
    v_statuses := ARRAY(SELECT jsonb_array_elements_text(v_src -> 'statuses'));
    IF v_found AND s.is_active THEN
      -- Gaining stop/mark needs the whole group for marks; entries keep starting after the old cursor.
      v_gained := s.kind = 'data_group' AND (v_stop OR v_mark) AND NOT (s.is_stop OR s.is_mark);
      UPDATE public.auto_journey_sources
      SET is_entry = v_entry, is_stop = v_stop, is_mark = v_mark, include_existing = v_include, statuses = v_statuses,
          cursor_ts = CASE WHEN v_gained THEN NULL ELSE cursor_ts END,
          cursor_id = CASE WHEN v_gained THEN 0 ELSE cursor_id END,
          entry_since = CASE WHEN NOT v_gained THEN entry_since
            WHEN cursor_ts IS NULL THEN entry_since WHEN entry_since IS NULL THEN cursor_ts
            ELSE greatest(entry_since, cursor_ts) END,
          seeded_at = CASE WHEN v_gained THEN NULL ELSE seeded_at END,
          updated_at = now()
      WHERE id = s.id;
    ELSIF v_found THEN
      UPDATE public.auto_journey_sources
      SET is_entry = v_entry, is_stop = v_stop, is_mark = v_mark, include_existing = v_include, statuses = v_statuses,
          cursor_ts = CASE WHEN v_include OR v_stop OR v_mark THEN NULL ELSE now() END, cursor_id = 0,
          entry_since = CASE WHEN v_include THEN NULL ELSE now() END,
          seeded_at = NULL, last_scanned_at = NULL, is_active = true, updated_at = now()
      WHERE id = s.id;
    ELSE
      INSERT INTO public.auto_journey_sources (journey_id, kind, group_id, campaign_id, statuses, is_entry, is_stop, is_mark,
        include_existing, entry_since, cursor_ts, cursor_id)
      VALUES (j.id, v_src ->> 'kind',
        CASE WHEN v_src ->> 'kind' = 'data_group' THEN (v_src ->> 'id')::bigint END,
        CASE WHEN v_src ->> 'kind' = 'campaign_result' THEN (v_src ->> 'id')::bigint END,
        v_statuses, v_entry, v_stop, v_mark, v_include,
        CASE WHEN v_include THEN NULL ELSE now() END,
        CASE WHEN v_include OR v_stop OR v_mark THEN NULL ELSE now() END, 0);
    END IF;
  END LOOP;
  UPDATE public.auto_journey_sources src
  SET is_active = false, updated_at = now()
  WHERE src.journey_id = j.id AND src.is_active
    AND NOT ((CASE WHEN src.kind = 'data_group' THEN 'g:' || src.group_id::text ELSE 'c:' || src.campaign_id::text END)
             = ANY(ARRAY(SELECT jsonb_object_keys(v_sources))));

  -- Enrollments at a step that is not in the new graph.
  IF v_policy = 'exit' THEN
    WITH o AS (
      UPDATE public.auto_journey_enrollments e
      SET status = 'exited', exit_code = 'step_removed', exit_reason = 'Bước khách đang ở đã bị xóa khỏi quy trình.',
          finished_at = now(), next_run_at = NULL, paused_next_run_at = NULL, phase = 'ready', pending_outcome = NULL,
          pending_reason = NULL, lease_token = NULL, lease_until = NULL, version_id = v_version_id, updated_at = now()
      WHERE e.journey_id = j.id AND e.status = 'active' AND e.step_id IS NOT NULL AND NOT (e.step_id = ANY(v_steps))
      RETURNING e.id, e.step_id
    ), ev AS (
      INSERT INTO public.auto_journey_events (journey_id, enrollment_id, step_id, kind, message)
      SELECT j.id, o.id, o.step_id, 'exit', 'Bước khách đang ở đã bị xóa khỏi quy trình; khách ra khỏi quy trình.' FROM o
    )
    SELECT coalesce(jsonb_object_agg(x.step_id, x.n), '{}'::jsonb) INTO v_by_step
    FROM (SELECT o.step_id, count(*) AS n FROM o GROUP BY o.step_id) x;
    FOR r IN SELECT e.key, e.value::bigint AS n FROM jsonb_each_text(v_by_step) e LOOP
      v_stats := private.aka_agent_journey_stat_add(v_stats, j.id, r.key, 'exited', r.n);
      v_stats := private.aka_agent_journey_stat_add(v_stats, j.id, '*', 'exited', r.n);
    END LOOP;
  ELSE
    WITH o AS (
      UPDATE public.auto_journey_enrollments e
      SET step_id = nx.target, phase = 'ready',
          next_run_at = CASE WHEN v_paused THEN NULL ELSE now() END,
          paused_next_run_at = CASE WHEN v_paused THEN now() ELSE NULL END,
          attempts = 0, defer_code = NULL, step_entered_at = now(), pending_outcome = NULL, pending_reason = NULL,
          lease_token = NULL, lease_until = NULL, version_id = v_version_id, updated_at = now()
      FROM (SELECT n.key AS old_step, n.value #>> '{}' AS target FROM jsonb_each(v_next) n WHERE jsonb_typeof(n.value) = 'string') nx
      WHERE e.journey_id = j.id AND e.status = 'active' AND e.step_id = nx.old_step AND NOT (e.step_id = ANY(v_steps))
      RETURNING e.id, nx.old_step, nx.target
    ), ev AS (
      INSERT INTO public.auto_journey_events (journey_id, enrollment_id, step_id, kind, message)
      SELECT j.id, o.id, o.target, 'step', 'Bước cũ đã bị xóa khỏi quy trình; khách chuyển sang bước tiếp theo.' FROM o
    )
    SELECT coalesce(jsonb_agg(jsonb_build_object('old', x.old_step, 'new', x.target, 'n', x.n)), '[]'::jsonb) INTO v_by_step
    FROM (SELECT o.old_step, o.target, count(*) AS n FROM o GROUP BY o.old_step, o.target) x;
    FOR r IN SELECT x.value ->> 'old' AS old_step, x.value ->> 'new' AS new_step, (x.value ->> 'n')::bigint AS n
             FROM jsonb_array_elements(v_by_step) x LOOP
      v_stats := private.aka_agent_journey_stat_add(v_stats, j.id, r.old_step, 'passed', r.n);
      v_stats := private.aka_agent_journey_stat_add(v_stats, j.id, r.new_step, 'entered', r.n);
    END LOOP;

    WITH o AS (
      UPDATE public.auto_journey_enrollments e
      SET status = 'completed', exit_code = 'step_removed',
          exit_reason = 'Bước khách đang ở đã bị xóa khỏi quy trình; khách hoàn thành quy trình.',
          finished_at = now(), next_run_at = NULL, paused_next_run_at = NULL, phase = 'ready', pending_outcome = NULL,
          pending_reason = NULL, lease_token = NULL, lease_until = NULL, version_id = v_version_id, updated_at = now()
      WHERE e.journey_id = j.id AND e.status = 'active' AND e.step_id IS NOT NULL AND NOT (e.step_id = ANY(v_steps))
      RETURNING e.id, e.step_id
    ), ev AS (
      INSERT INTO public.auto_journey_events (journey_id, enrollment_id, step_id, kind, message)
      SELECT j.id, o.id, o.step_id, 'complete', 'Bước khách đang ở đã bị xóa khỏi quy trình; khách hoàn thành quy trình.' FROM o
    )
    SELECT coalesce(jsonb_object_agg(x.step_id, x.n), '{}'::jsonb) INTO v_by_step
    FROM (SELECT o.step_id, count(*) AS n FROM o GROUP BY o.step_id) x;
    FOR r IN SELECT e.key, e.value::bigint AS n FROM jsonb_each_text(v_by_step) e LOOP
      v_stats := private.aka_agent_journey_stat_add(v_stats, j.id, r.key, 'passed', r.n);
      v_stats := private.aka_agent_journey_stat_add(v_stats, j.id, r.key, 'completed', r.n);
      v_stats := private.aka_agent_journey_stat_add(v_stats, j.id, '*', 'completed', r.n);
    END LOOP;
  END IF;
  -- Everyone else moves to the new version; in-flight engine results computed on the old one are dropped.
  UPDATE public.auto_journey_enrollments
  SET version_id = v_version_id, lease_token = NULL, lease_until = NULL, updated_at = now()
  WHERE journey_id = j.id AND status = 'active' AND (version_id <> v_version_id OR lease_token IS NOT NULL);
  PERFORM private.aka_agent_journey_stats_flush(v_stats);
  RETURN jsonb_build_object('versionId', v_version_id, 'versionNo', v_version_no);
END
$function$;

CREATE FUNCTION private.aka_agent_journey_ctl_set_status(p_staff_id bigint, p_organization_id bigint, p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $function$
DECLARE
  j public.auto_journeys%ROWTYPE;
  v_action text := p_payload ->> 'action';
  v_status text;
  v_campaigns jsonb;
BEGIN
  IF v_action IS NULL OR v_action NOT IN ('pause', 'resume', 'stop')
     OR coalesce(jsonb_typeof(p_payload -> 'skipPaused'), 'null') NOT IN ('boolean', 'null') THEN
    RAISE EXCEPTION 'journey_invalid_payload';
  END IF;
  j := private.aka_agent_journey_owned(p_staff_id, p_organization_id, p_payload, true);
  IF v_action = 'pause' THEN
    IF j.status <> 'active' THEN
      RAISE EXCEPTION 'journey_invalid_transition';
    END IF;
    UPDATE public.auto_journey_enrollments
    SET paused_next_run_at = next_run_at, next_run_at = NULL, lease_token = NULL, lease_until = NULL, updated_at = now()
    WHERE journey_id = j.id AND status = 'active';
    v_status := 'paused';
    UPDATE public.auto_journeys SET status = v_status, paused_at = now(), updated_at = now() WHERE id = j.id;
    v_campaigns := private.aka_agent_journey_campaign_ids(j.id, false);
  ELSIF v_action = 'resume' THEN
    IF j.status <> 'paused' THEN
      RAISE EXCEPTION 'journey_invalid_transition';
    END IF;
    UPDATE public.auto_journey_enrollments
    SET next_run_at = paused_next_run_at, paused_next_run_at = NULL, updated_at = now()
    WHERE journey_id = j.id AND status = 'active' AND paused_next_run_at IS NOT NULL;
    IF coalesce((p_payload ->> 'skipPaused')::boolean, false) THEN
      -- Skip customers who joined while paused; stop/mark groups keep reading so their marks stay complete.
      UPDATE public.auto_journey_sources
      SET entry_since = now(),
          cursor_ts = CASE WHEN is_stop OR is_mark THEN cursor_ts ELSE now() END,
          cursor_id = CASE WHEN is_stop OR is_mark THEN cursor_id ELSE 0 END,
          updated_at = now()
      WHERE journey_id = j.id AND is_active AND is_entry;
    END IF;
    v_status := 'active';
    UPDATE public.auto_journeys SET status = v_status, paused_at = NULL, updated_at = now() WHERE id = j.id;
    v_campaigns := private.aka_agent_journey_campaign_ids(j.id, true);
  ELSE
    IF j.status NOT IN ('active', 'paused') THEN
      RAISE EXCEPTION 'journey_invalid_transition';
    END IF;
    PERFORM private.aka_agent_journey_exit_all(j.id, 'journey_stopped', 'Quy trình đã dừng.');
    v_status := 'stopped';
    UPDATE public.auto_journeys SET status = v_status, stopped_at = now(), updated_at = now() WHERE id = j.id;
    v_campaigns := private.aka_agent_journey_campaign_ids(j.id, false);
  END IF;
  RETURN jsonb_build_object('status', v_status, 'campaignIds', v_campaigns);
END
$function$;

CREATE FUNCTION private.aka_agent_journey_ctl_delete(p_staff_id bigint, p_organization_id bigint, p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $function$
DECLARE
  j public.auto_journeys%ROWTYPE;
BEGIN
  j := private.aka_agent_journey_owned(p_staff_id, p_organization_id, p_payload, true);
  IF j.status = 'active' THEN
    RAISE EXCEPTION 'journey_active';
  END IF;
  PERFORM private.aka_agent_journey_exit_all(j.id, 'journey_deleted', 'Quy trình đã bị xóa.');
  UPDATE public.auto_journey_sources SET is_active = false, updated_at = now() WHERE journey_id = j.id AND is_active;
  UPDATE public.auto_journeys SET is_delete = true, deleted_at = now(), updated_at = now() WHERE id = j.id;
  RETURN jsonb_build_object('campaignIds', private.aka_agent_journey_campaign_ids(j.id, false));
END
$function$;

CREATE FUNCTION private.aka_agent_journey_enrollment_row(e public.auto_journey_enrollments) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = pg_catalog AS $function$
  SELECT jsonb_build_object('id', e.id, 'contactKey', e.contact_key, 'contact', e.contact, 'status', e.status,
    'stepId', e.step_id, 'phase', e.phase, 'nextRunAt', e.next_run_at, 'pausedNextRunAt', e.paused_next_run_at,
    'enteredAt', e.entered_at, 'finishedAt', e.finished_at, 'exitCode', e.exit_code, 'exitReason', e.exit_reason,
    'stickyAccountId', e.sticky_account_id, 'isTest', e.is_test, 'zaloStatus', e.zalo_status, 'stepEnteredAt', e.step_entered_at)
$function$;

CREATE FUNCTION private.aka_agent_journey_ctl_enrollments(p_staff_id bigint, p_organization_id bigint, p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $function$
DECLARE
  j public.auto_journeys%ROWTYPE;
  v_status text := nullif(btrim(coalesce(p_payload ->> 'status', '')), '');
  v_step text := nullif(btrim(coalesce(p_payload ->> 'stepId', '')), '');
  v_search text := left(nullif(btrim(coalesce(p_payload ->> 'search', '')), ''), 100);
  v_cursor bigint := private.aka_agent_journey_bigint(p_payload -> 'cursor');
  v_limit integer := least(greatest(coalesce(private.aka_agent_journey_bigint(p_payload -> 'limit'), 50), 1), 100)::integer;
  v_phone text;
  v_pattern text;
  v_items jsonb;
  v_count integer;
BEGIN
  j := private.aka_agent_journey_owned(p_staff_id, p_organization_id, p_payload, false);
  IF v_status = 'all' THEN
    v_status := NULL;
  END IF;
  IF v_status IS NOT NULL AND v_status NOT IN ('active', 'completed', 'exited', 'failed') THEN
    RAISE EXCEPTION 'journey_invalid_payload';
  END IF;
  IF v_search IS NOT NULL THEN
    v_phone := private.aka_agent_journey_phone(v_search);
    v_pattern := '%' || replace(replace(replace(v_search, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  END IF;
  SELECT coalesce(jsonb_agg(private.aka_agent_journey_enrollment_row(p.e) ORDER BY (p.e).id DESC), '[]'::jsonb), count(*)
  INTO v_items, v_count
  FROM (
    SELECT e FROM public.auto_journey_enrollments e
    WHERE e.journey_id = j.id
      AND (v_status IS NULL OR e.status = v_status)
      AND (v_step IS NULL OR e.step_id = v_step)
      AND (v_cursor IS NULL OR e.id < v_cursor)
      AND (v_search IS NULL
        OR (v_phone IS NOT NULL AND e.contact_key IN ('phone:' || v_phone, 'test:phone:' || v_phone))
        OR (v_phone IS NULL AND (e.contact_key ILIKE v_pattern OR e.contact ->> 'name' ILIKE v_pattern
          OR e.contact ->> 'email' ILIKE v_pattern OR e.contact ->> 'uid' ILIKE v_pattern)))
    ORDER BY e.id DESC
    LIMIT v_limit + 1
  ) p;
  IF v_count > v_limit THEN
    v_items := v_items - v_limit;
    RETURN jsonb_build_object('items', v_items, 'nextCursor', (v_items -> (v_limit - 1) ->> 'id')::bigint);
  END IF;
  RETURN jsonb_build_object('items', v_items, 'nextCursor', NULL);
END
$function$;

CREATE FUNCTION private.aka_agent_journey_ctl_enrollment(p_staff_id bigint, p_organization_id bigint, p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $function$
DECLARE
  j public.auto_journeys%ROWTYPE;
  e public.auto_journey_enrollments%ROWTYPE;
  v_id bigint := private.aka_agent_journey_bigint(p_payload -> 'enrollmentId');
  v_events jsonb;
  v_sends jsonb;
BEGIN
  j := private.aka_agent_journey_owned(p_staff_id, p_organization_id, p_payload, false);
  SELECT * INTO e FROM public.auto_journey_enrollments WHERE id = v_id AND journey_id = j.id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'journey_not_found';
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'stepId', x.step_id, 'kind', x.kind, 'message', x.message,
      'data', x.data, 'createdAt', x.created_at) ORDER BY x.id), '[]'::jsonb)
  INTO v_events
  FROM (SELECT * FROM public.auto_journey_events ev WHERE ev.enrollment_id = e.id ORDER BY ev.id DESC LIMIT 300) x;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'stepId', r.step_id, 'accountId', r.account_id,
      'campaignId', r.campaign_id, 'actionCode', r.action_code, 'status', r.status, 'outcome', r.outcome, 'reason', r.reason,
      'dispatchedAt', r.dispatched_at, 'settledAt', r.settled_at) ORDER BY r.dispatched_at, r.id), '[]'::jsonb)
  INTO v_sends
  FROM public.auto_journey_step_runs r WHERE r.enrollment_id = e.id;
  RETURN jsonb_build_object('enrollment', private.aka_agent_journey_enrollment_row(e), 'events', v_events, 'sends', v_sends);
END
$function$;

CREATE FUNCTION private.aka_agent_journey_ctl_exit_enrollment(p_staff_id bigint, p_organization_id bigint, p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $function$
DECLARE
  j public.auto_journeys%ROWTYPE;
  v_id bigint := private.aka_agent_journey_bigint(p_payload -> 'enrollmentId');
  v_step text;
  v_reason text := 'Nhân viên cho khách ra khỏi quy trình.';
  v_stats jsonb := '{}'::jsonb;
BEGIN
  j := private.aka_agent_journey_owned(p_staff_id, p_organization_id, p_payload, false);
  UPDATE public.auto_journey_enrollments
  SET status = 'exited', exit_code = 'manual', exit_reason = v_reason, finished_at = now(), next_run_at = NULL,
      paused_next_run_at = NULL, phase = 'ready', pending_outcome = NULL, pending_reason = NULL,
      lease_token = NULL, lease_until = NULL, updated_at = now()
  WHERE id = v_id AND journey_id = j.id AND status = 'active'
  RETURNING step_id INTO v_step;
  IF NOT FOUND THEN
    IF EXISTS (SELECT 1 FROM public.auto_journey_enrollments WHERE id = v_id AND journey_id = j.id) THEN
      RETURN jsonb_build_object('ok', false);
    END IF;
    RAISE EXCEPTION 'journey_not_found';
  END IF;
  INSERT INTO public.auto_journey_events (journey_id, enrollment_id, step_id, kind, message)
  VALUES (j.id, v_id, v_step, 'exit', v_reason);
  v_stats := private.aka_agent_journey_stat_add(v_stats, j.id, v_step, 'exited', 1);
  v_stats := private.aka_agent_journey_stat_add(v_stats, j.id, '*', 'exited', 1);
  PERFORM private.aka_agent_journey_stats_flush(v_stats);
  RETURN jsonb_build_object('ok', true);
END
$function$;

CREATE FUNCTION private.aka_agent_journey_ctl_test_enroll(p_staff_id bigint, p_organization_id bigint, p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $function$
DECLARE
  j public.auto_journeys%ROWTYPE;
  v_c jsonb := p_payload -> 'contact';
  v_phone text;
  v_uid text;
  v_account bigint;
  v_email text;
  v_key text;
  v_id bigint;
  v_stats jsonb := '{}'::jsonb;
BEGIN
  j := private.aka_agent_journey_owned(p_staff_id, p_organization_id, p_payload, true);
  IF j.status <> 'active' OR j.active_version_id IS NULL THEN
    RAISE EXCEPTION 'journey_not_active';
  END IF;
  IF jsonb_typeof(v_c) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'journey_invalid_payload';
  END IF;
  v_phone := private.aka_agent_journey_phone(v_c ->> 'phone');
  v_uid := left(nullif(btrim(coalesce(v_c ->> 'uid', '')), ''), 500);
  v_account := private.aka_agent_journey_bigint(v_c -> 'accountId');
  v_email := private.aka_agent_journey_email(v_c ->> 'email');
  IF v_account IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.auto_accounts a WHERE a.id = v_account AND a.staff_id = p_staff_id
        AND (a.organization_id IS NULL OR a.organization_id = p_organization_id) AND a.is_delete IS NOT TRUE) THEN
    RAISE EXCEPTION 'journey_reference_invalid';
  END IF;
  v_key := private.aka_agent_journey_contact_key(v_phone, v_uid, v_account, v_email, NULL);
  IF v_key IS NULL THEN
    RAISE EXCEPTION 'journey_invalid_payload';
  END IF;
  v_key := 'test:' || v_key;
  INSERT INTO public.auto_journey_enrollments (journey_id, version_id, staff_id, organization_id, contact_key, contact,
    source_kind, status, phase, next_run_at, is_test)
  VALUES (j.id, j.active_version_id, j.staff_id, j.organization_id, v_key,
    private.aka_agent_journey_contact(v_c ->> 'name', v_phone, v_uid, v_email, v_c ->> 'info1', v_c ->> 'info2', v_c ->> 'info3',
      v_c ->> 'info4', v_c ->> 'info5', v_c ->> 'carrier', v_account),
    'test', 'active', 'ready', now(), true)
  ON CONFLICT (journey_id, contact_key) WHERE status = 'active' DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM public.auto_journey_enrollments WHERE journey_id = j.id AND contact_key = v_key AND status = 'active';
    RETURN jsonb_build_object('enrollmentId', v_id, 'created', false);
  END IF;
  INSERT INTO public.auto_journey_events (journey_id, enrollment_id, step_id, kind, message)
  VALUES (j.id, v_id, NULL, 'enter', 'Chạy thử với 1 khách: tin gửi thật trong giờ gửi, mỗi bước Chờ rút còn 1 phút, không tính trần tin mỗi ngày.');
  v_stats := private.aka_agent_journey_stat_add(v_stats, j.id, '*', 'enrolled', 1);
  PERFORM private.aka_agent_journey_stats_flush(v_stats);
  RETURN jsonb_build_object('enrollmentId', v_id, 'created', true);
END
$function$;

CREATE FUNCTION private.aka_agent_journey_ctl_tasks(p_staff_id bigint, p_organization_id bigint, p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $function$
DECLARE
  j public.auto_journeys%ROWTYPE;
  v_done boolean;
  v_cursor bigint := private.aka_agent_journey_bigint(p_payload -> 'cursor');
  v_limit integer := least(greatest(coalesce(private.aka_agent_journey_bigint(p_payload -> 'limit'), 50), 1), 100)::integer;
  v_items jsonb;
  v_count integer;
BEGIN
  j := private.aka_agent_journey_owned(p_staff_id, p_organization_id, p_payload, false);
  IF coalesce(jsonb_typeof(p_payload -> 'done'), 'null') NOT IN ('boolean', 'null') THEN
    RAISE EXCEPTION 'journey_invalid_payload';
  END IF;
  v_done := (p_payload ->> 'done')::boolean;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'enrollmentId', x.enrollment_id, 'stepId', x.step_id, 'note', x.note,
      'contact', x.contact, 'createdAt', x.created_at, 'doneAt', x.done_at) ORDER BY x.id DESC), '[]'::jsonb), count(*)
  INTO v_items, v_count
  FROM (
    SELECT t.id, t.enrollment_id, t.step_id, t.note, e.contact, t.created_at, t.done_at
    FROM public.auto_journey_tasks t
    JOIN public.auto_journey_enrollments e ON e.id = t.enrollment_id
    WHERE t.journey_id = j.id
      AND (v_done IS NULL OR (v_done AND t.done_at IS NOT NULL) OR (NOT v_done AND t.done_at IS NULL))
      AND (v_cursor IS NULL OR t.id < v_cursor)
    ORDER BY t.id DESC
    LIMIT v_limit + 1
  ) x;
  IF v_count > v_limit THEN
    v_items := v_items - v_limit;
    RETURN jsonb_build_object('items', v_items, 'nextCursor', (v_items -> (v_limit - 1) ->> 'id')::bigint);
  END IF;
  RETURN jsonb_build_object('items', v_items, 'nextCursor', NULL);
END
$function$;

CREATE FUNCTION private.aka_agent_journey_ctl_task_done(p_staff_id bigint, p_organization_id bigint, p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $function$
DECLARE
  j public.auto_journeys%ROWTYPE;
  v_id bigint := private.aka_agent_journey_bigint(p_payload -> 'taskId');
BEGIN
  j := private.aka_agent_journey_owned(p_staff_id, p_organization_id, p_payload, false);
  UPDATE public.auto_journey_tasks
  SET done_at = coalesce(done_at, now()), done_by_staff_id = coalesce(done_by_staff_id, p_staff_id)
  WHERE id = v_id AND journey_id = j.id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'journey_not_found';
  END IF;
  RETURN jsonb_build_object('ok', true);
END
$function$;

-- Builder catalog: the staff's 300 most recently updated campaigns (any action) and which ones journeys manage.
CREATE FUNCTION private.aka_agent_journey_ctl_catalog_campaigns(p_staff_id bigint, p_organization_id bigint) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $function$
  WITH managed AS MATERIALIZED (
    SELECT DISTINCT sc.campaign_id
    FROM public.auto_journeys j
    JOIN public.auto_journey_step_campaigns sc ON sc.journey_id = j.id
    WHERE j.staff_id = p_staff_id AND j.organization_id = p_organization_id AND j.is_delete = false
  ), recent AS MATERIALIZED (
    SELECT c.id, c.name, c.action_id, c.account_id, c.status, c.updated_at
    FROM public.auto_campaigns c
    WHERE c.staff_id = p_staff_id AND c.organization_id = p_organization_id AND c.is_delete IS NOT TRUE
    ORDER BY c.updated_at DESC NULLS LAST, c.id DESC
    LIMIT 300
  )
  SELECT jsonb_build_object(
    'campaigns', coalesce((SELECT jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name, 'actionCode', r.action_id,
        'accountId', r.account_id, 'status', r.status, 'managed', EXISTS (SELECT 1 FROM managed m WHERE m.campaign_id = r.id))
      ORDER BY r.updated_at DESC NULLS LAST, r.id DESC) FROM recent r), '[]'::jsonb),
    'managedCampaignIds', coalesce((SELECT jsonb_agg(m.campaign_id ORDER BY m.campaign_id) FROM managed m), '[]'::jsonb))
$function$;

-- Khóa quyền ngay trong phần này (schema private có USAGE cho các role API): mọi hàm private.aka_agent_journey_*
-- thuộc postgres, không ai khác EXECUTE. p4 chạy lại bước này cho mọi hàm rồi mới cấp hai RPC public cho service_role.
DO $lockdown_p2$
DECLARE
  v_fn regprocedure;
  v_role text;
BEGIN
  FOR v_fn IN
    SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'private' AND p.proname LIKE 'aka\_agent\_journey\_%'
  LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO postgres', v_fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', v_fn);
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role', 'aka_agent_desktop', 'aka_agent_chat_api'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_role) THEN
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', v_fn, v_role);
      END IF;
    END LOOP;
  END LOOP;
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    WHERE n.nspname = 'private' AND p.proname LIKE 'aka\_agent\_journey\_%'
      AND (a.grantee = 0 OR a.grantee::regrole::text IN ('anon', 'authenticated', 'service_role', 'aka_agent_desktop', 'aka_agent_chat_api'))
  ) OR EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname LIKE 'aka\_agent\_journey\_%'
  ) THEN
    RAISE EXCEPTION 'v473_p2_function_acl_unexpected';
  END IF;
END
$lockdown_p2$;

COMMIT;
