-- Restore only after rolling applications back; preserve the table and every new log.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $preflight$ BEGIN
IF md5(pg_get_functiondef(to_regprocedure('public.append_auto_campaign_log(bigint,bigint,text)'))) IS DISTINCT FROM '230e219f5b854a2d2154ee0dc6c867a2' THEN RAISE EXCEPTION 'v408 rollback source drift: append_auto_campaign_log(bigint,bigint,text)'; END IF;
IF md5(pg_get_functiondef(to_regprocedure('public.aka_agent_desktop_campaign_detail(bigint,bigint,text,text,jsonb,bigint,text,jsonb)'))) IS DISTINCT FROM '8cd5def0920f178d5efed9fb73ddefab' THEN RAISE EXCEPTION 'v408 rollback source drift: aka_agent_desktop_campaign_detail(bigint,bigint,text,text,jsonb,bigint,text,jsonb)'; END IF;
IF md5(pg_get_functiondef(to_regprocedure('public.aka_agent_campaign_diagnostics_evidence(bigint,bigint,bigint,text,text)'))) IS DISTINCT FROM '9391f47e1be976e0d7e595325d3c2f31' THEN RAISE EXCEPTION 'v408 rollback source drift: aka_agent_campaign_diagnostics_evidence(bigint,bigint,bigint,text,text)'; END IF;
END $preflight$;
CREATE OR REPLACE FUNCTION public.append_auto_campaign_log(p_campaign_id bigint, p_staff_id bigint, p_log_line text)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  c_max_log_bytes constant integer := 262144;
  c_max_log_entries constant integer := 2000;
  c_max_entry_chars constant integer := 16000;
  c_history_marker constant text :=
    '--- Chỉ lưu lịch sử chạy gần nhất; các mục cũ hơn đã được lược bỏ ---';
  c_entry_marker constant text := ' … [nội dung quá dài đã được rút gọn]';
  v_existing_log text;
  v_existing_updated_at timestamptz;
  v_log_line text := p_log_line;
  v_combined_log text;
  v_lines text[];
  v_entries text[] := ARRAY[]::text[];
  v_retained_entries text[] := ARRAY[]::text[];
  v_line text;
  v_line_index integer := 0;
  v_current_entry text;
  v_entry text;
  v_entry_count integer;
  v_first_candidate integer;
  v_index integer;
  v_used_bytes integer := 0;
  v_entry_bytes integer;
  v_was_already_truncated boolean := false;
  v_needs_truncation_marker boolean;
  v_retained_log text;
  v_next_updated_at timestamptz;
BEGIN
  IF p_campaign_id IS NULL OR p_campaign_id <= 0 THEN
    RAISE EXCEPTION 'Campaign ID must be a positive integer';
  END IF;

  IF p_staff_id IS NULL OR p_staff_id <= 0 THEN
    RAISE EXCEPTION 'Staff ID must be a positive integer';
  END IF;

  IF NULLIF(btrim(COALESCE(p_log_line, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Campaign log line must not be empty';
  END IF;

  -- Keep the timestamp/prefix of an abnormal single entry. Character-based
  -- slicing is UTF-8 safe; 16,000 characters are at most about 64 KiB.
  IF char_length(v_log_line) > c_max_entry_chars THEN
    v_log_line := left(
      v_log_line,
      c_max_entry_chars - char_length(c_entry_marker)
    ) || c_entry_marker;
  END IF;

  -- The row lock preserves the no-lost-update guarantee when Desktop and
  -- Server append concurrently. All trimming happens before releasing it.
  SELECT COALESCE(campaign.log, ''), campaign.updated_at
  INTO v_existing_log, v_existing_updated_at
  FROM public.auto_campaigns AS campaign
  WHERE campaign.id = p_campaign_id
    AND campaign.staff_id = p_staff_id
    AND COALESCE(campaign.is_delete, false) = false
  FOR UPDATE OF campaign;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active campaign % was not found', p_campaign_id;
  END IF;

  -- A stored entry starts at either the legacy "[timestamp]" form or the
  -- current "HH:mm:ss dd/MM/yyyy -" form. Continuation lines stay attached to
  -- their entry, so stack traces and screenshot markers are never cut midway.
  -- Parse only existing history; the new RPC argument is appended below as one
  -- indivisible logical entry even when it contains embedded newlines.
  v_lines := string_to_array(v_existing_log, E'\n');
  FOREACH v_line IN ARRAY v_lines LOOP
    v_line_index := v_line_index + 1;
    IF v_line_index = 1 AND v_line = c_history_marker THEN
      v_was_already_truncated := true;
      CONTINUE;
    END IF;

    IF v_line ~ '^\[[^]]+\][[:space:]]*'
      OR v_line ~ '^[0-9]{1,2}:[0-9]{2}:[0-9]{2}[[:space:]]+[0-9]{1,2}/[0-9]{1,2}/[0-9]{4}[[:space:]]+-[[:space:]]*'
    THEN
      IF v_current_entry IS NOT NULL AND char_length(v_current_entry) > 0 THEN
        v_entries := array_append(v_entries, v_current_entry);
      END IF;
      v_current_entry := v_line;
    ELSIF v_current_entry IS NULL THEN
      v_current_entry := v_line;
    ELSE
      v_current_entry := v_current_entry || E'\n' || v_line;
    END IF;
  END LOOP;

  IF v_current_entry IS NOT NULL AND char_length(v_current_entry) > 0 THEN
    v_entries := array_append(v_entries, v_current_entry);
  END IF;

  v_entries := array_append(v_entries, v_log_line);
  v_combined_log := array_to_string(v_entries, E'\n');

  v_entry_count := COALESCE(array_length(v_entries, 1), 0);
  v_needs_truncation_marker := v_was_already_truncated
    OR v_entry_count > c_max_log_entries
    OR octet_length(v_combined_log) > c_max_log_bytes;

  IF v_needs_truncation_marker THEN
    v_used_bytes := octet_length(c_history_marker) + 1;
  END IF;

  v_first_candidate := GREATEST(1, v_entry_count - c_max_log_entries + 1);
  IF v_entry_count > 0 THEN
    FOR v_index IN REVERSE v_entry_count..v_first_candidate LOOP
      v_entry := v_entries[v_index];
      v_entry_bytes := octet_length(v_entry)
        + CASE WHEN array_length(v_retained_entries, 1) IS NULL THEN 0 ELSE 1 END;

      IF v_used_bytes + v_entry_bytes > c_max_log_bytes THEN
        v_needs_truncation_marker := true;
        EXIT;
      END IF;

      v_retained_entries := array_prepend(v_entry, v_retained_entries);
      v_used_bytes := v_used_bytes + v_entry_bytes;
    END LOOP;
  END IF;

  v_retained_log := array_to_string(v_retained_entries, E'\n');
  IF v_needs_truncation_marker THEN
    v_retained_log := c_history_marker || CASE
      WHEN NULLIF(v_retained_log, '') IS NULL THEN ''
      ELSE E'\n' || v_retained_log
    END;
  END IF;

  -- clock_timestamp() is evaluated after the row lock. Advancing from the
  -- locked revision also prevents concurrent appends from moving updated_at
  -- backwards and hiding a renderer cache invalidation.
  v_next_updated_at := GREATEST(
    clock_timestamp(),
    COALESCE(
      v_existing_updated_at + interval '1 microsecond',
      '-infinity'::timestamptz
    )
  );

  UPDATE public.auto_campaigns AS campaign
  SET log = v_retained_log,
    updated_at = v_next_updated_at
  WHERE campaign.id = p_campaign_id
    AND campaign.staff_id = p_staff_id
    AND COALESCE(campaign.is_delete, false) = false;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active campaign % was not found', p_campaign_id;
  END IF;

  RETURN true;
END;
$function$;
ALTER FUNCTION public.append_auto_campaign_log(bigint,bigint,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.append_auto_campaign_log(bigint,bigint,text) FROM PUBLIC,anon,authenticated,service_role,aka_agent_chat_api;
GRANT EXECUTE ON FUNCTION public.append_auto_campaign_log(bigint,bigint,text) TO PUBLIC,anon,authenticated,service_role,aka_agent_chat_api;
COMMENT ON FUNCTION public.append_auto_campaign_log(bigint,bigint,text) IS 'Atomically append one formatted campaign-log entry while retaining at most 2,000 recent entries and 256 KiB of UTF-8 text.';
CREATE OR REPLACE FUNCTION public.aka_agent_desktop_campaign_detail(p_staff_id bigint, p_organization_id bigint, p_auth_username text, p_auth_password text, p_access jsonb, p_campaign_id bigint, p_part text, p_cursor jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET statement_timeout TO '60s'
AS $function$
DECLARE
  v_row jsonb; v_version text; v_log text; v_updated_at timestamptz;
  v_tail text; v_length integer; v_end integer; v_prefix text; v_keep integer;
BEGIN
  PERFORM public.auto_assert_automation_identity(p_staff_id,p_organization_id,p_auth_username,p_auth_password);
  IF p_staff_id IS NULL OR p_organization_id IS NULL OR p_access IS NULL OR p_campaign_id IS NULL OR p_campaign_id <= 0 OR p_part NOT IN ('config','log') OR p_part IS NULL THEN
    RAISE EXCEPTION 'Invalid campaign detail scope';
  END IF;
  IF p_part='config' THEN
    SELECT jsonb_build_object('id',c.id,'name',c.name,'action_id',c.action_id,'account_id',c.account_id,'secondary_account_id',c.secondary_account_id,'status',c.status,'schedule',c.schedule,'original_schedule',c.original_schedule,'schedule_type',c.schedule_type,'schedule_end_date',c.schedule_end_date,'daily_stop_time',c.daily_stop_time,'schedule_days',c.schedule_days,'schedule_week_days',c.schedule_week_days,'continue_next_day',c.continue_next_day,'refresh_data',c.refresh_data,'content',c.content,'extra_settings',c.extra_settings,'images',c.images,'note',c.note,'is_delete',c.is_delete,'staff_id',c.staff_id,'organization_id',c.organization_id,'created_at',c.created_at,'updated_at',c.updated_at,'completed_at',c.completed_at,'last_run_at',c.last_run_at,'data_target_source_mode',c.data_target_source_mode,'data_group_id',c.data_group_id,'provisioning_state',c.provisioning_state,'creation_bundle_id',c.creation_bundle_id,'creation_bundle_child_index',c.creation_bundle_child_index,'primary_account',jsonb_build_object('name',a.name,'flatform_type',a.flatform_type,'is_zalo_show_web',a.is_zalo_show_web,'is_zalo_server',a.is_zalo_server),'auto_campaign_actions',jsonb_build_object('name',ca.name)),public.aka_agent_desktop_campaign_config_version(c) INTO v_row,v_version
    FROM public.auto_campaigns c
    LEFT JOIN public.auto_campaign_actions ca ON ca.id=c.action_id
    JOIN public.auto_accounts a ON a.id = c.account_id
      AND a.staff_id = p_staff_id AND a.organization_id = p_organization_id
    WHERE c.staff_id = p_staff_id AND c.organization_id = p_organization_id AND c.is_delete = false
      AND coalesce((p_access->>CASE
        WHEN c.action_id IN ('sms_send','voice_call') THEN 'sms'
        WHEN c.action_id='email_send' THEN 'email'
        WHEN c.action_id = ANY(ARRAY['zalo_message_phone','zalo_message_friend','zalo_message_birthday','zalo_message_group_member','zalo_message_group_realtime','zalo_message_remarketing_customer','zalo_message_friend_recommendation','zalo_message_group','zalo_add_group_member','zalo_join_group_link','zalo_cancel_sent_friend_request']) THEN 'zalo'
        WHEN c.action_id IN ('facebook_page_post','facebook_page_to_message') THEN 'facebookFanpage'
        ELSE 'facebookCore' END)::boolean,false)
      AND (a.flatform_type<>'zalo' OR coalesce((p_access->>CASE WHEN a.is_zalo_show_web IS TRUE THEN 'web' WHEN a.is_zalo_server IS TRUE THEN 'server' ELSE 'qr' END)::boolean,false))
      AND c.id=p_campaign_id;
    RETURN CASE WHEN v_row IS NULL THEN NULL ELSE jsonb_build_object('row',v_row,'version',v_version) END;
  END IF;
  IF p_cursor IS NOT NULL AND (jsonb_typeof(p_cursor)<>'object'
    OR coalesce(p_cursor->>'version','') !~ '^[a-f0-9]{32}$'
    OR coalesce(p_cursor->>'length','') !~ '^[0-9]{1,7}$'
    OR jsonb_typeof(p_cursor->'tail') IS DISTINCT FROM 'string'
    OR char_length(p_cursor->>'tail')>1024) THEN
    RAISE EXCEPTION 'Invalid campaign log cursor';
  END IF;
  SELECT coalesce(c.log,''),c.updated_at INTO v_log,v_updated_at FROM public.auto_campaigns c
    LEFT JOIN public.auto_campaign_actions ca ON ca.id=c.action_id
    JOIN public.auto_accounts a ON a.id = c.account_id
      AND a.staff_id = p_staff_id AND a.organization_id = p_organization_id
    WHERE c.staff_id = p_staff_id AND c.organization_id = p_organization_id AND c.is_delete = false
      AND coalesce((p_access->>CASE
        WHEN c.action_id IN ('sms_send','voice_call') THEN 'sms'
        WHEN c.action_id='email_send' THEN 'email'
        WHEN c.action_id = ANY(ARRAY['zalo_message_phone','zalo_message_friend','zalo_message_birthday','zalo_message_group_member','zalo_message_group_realtime','zalo_message_remarketing_customer','zalo_message_friend_recommendation','zalo_message_group','zalo_add_group_member','zalo_join_group_link','zalo_cancel_sent_friend_request']) THEN 'zalo'
        WHEN c.action_id IN ('facebook_page_post','facebook_page_to_message') THEN 'facebookFanpage'
        ELSE 'facebookCore' END)::boolean,false)
      AND (a.flatform_type<>'zalo' OR coalesce((p_access->>CASE WHEN a.is_zalo_show_web IS TRUE THEN 'web' WHEN a.is_zalo_server IS TRUE THEN 'server' ELSE 'qr' END)::boolean,false))
      AND c.id=p_campaign_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  v_version:=md5(v_log);
  IF v_version=p_cursor->>'version' THEN
    RETURN jsonb_build_object('mode','unchanged','version',v_version,'updatedAt',v_updated_at);
  END IF;
  -- A rolling log can drop its oldest entries. Locate the old suffix, retain
  -- the overlap and send only a small new prefix plus the appended text. The
  -- caller MUST verify the reconstructed MD5 and refetch without a cursor if
  -- an anchor is ambiguous, the log was replaced or a concurrent edit occurred.
  v_tail:=p_cursor->>'tail';
  v_length:=(p_cursor->>'length')::integer;
  IF char_length(v_tail)>0 AND char_length(v_tail)<=v_length THEN
    v_end:=strpos(v_log,v_tail);
    IF v_end>0 THEN
      v_end:=v_end+char_length(v_tail)-1;
      v_prefix:=left(v_log,least(256,v_end));
      v_keep:=v_end-char_length(v_prefix);
      IF v_keep>=0 AND v_keep<=v_length THEN
        RETURN jsonb_build_object('mode','delta','version',v_version,'updatedAt',v_updated_at,
          'prefix',v_prefix,'keepChars',v_keep,'append',substr(v_log,v_end+1));
      END IF;
    END IF;
  END IF;
  RETURN jsonb_build_object('mode','replace','version',v_version,'updatedAt',v_updated_at,'log',v_log);
END;
$function$;
ALTER FUNCTION public.aka_agent_desktop_campaign_detail(bigint,bigint,text,text,jsonb,bigint,text,jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.aka_agent_desktop_campaign_detail(bigint,bigint,text,text,jsonb,bigint,text,jsonb) FROM PUBLIC,anon,authenticated,service_role,aka_agent_chat_api;
GRANT EXECUTE ON FUNCTION public.aka_agent_desktop_campaign_detail(bigint,bigint,text,text,jsonb,bigint,text,jsonb) TO anon,authenticated,service_role;
COMMENT ON FUNCTION public.aka_agent_desktop_campaign_detail(bigint,bigint,text,text,jsonb,bigint,text,jsonb) IS NULL;
CREATE OR REPLACE FUNCTION public.aka_agent_campaign_diagnostics_evidence(p_staff_id bigint, p_organization_id bigint, p_campaign_id bigint, p_auth_username text, p_auth_password text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET statement_timeout TO '15s'
AS $function$
DECLARE
  v_account_id bigint;
  v_log text;
  v_account_history jsonb;
  v_campaign_history jsonb;
  v_results jsonb;
  v_summary jsonb;
  v_inputs jsonb;
BEGIN
  PERFORM public.auto_assert_automation_identity(p_staff_id, p_organization_id, p_auth_username, p_auth_password);
  -- Explicit credentials and tenant ownership are required even for a service-role caller.
  IF p_staff_id IS NULL OR p_organization_id IS NULL OR p_campaign_id IS NULL
    OR NOT EXISTS (SELECT 1 FROM public.org_staff s JOIN public.org_organization o ON o.id=s.organization_id
      WHERE s.id=p_staff_id AND s.organization_id=p_organization_id AND s.is_active
        AND s.username=p_auth_username AND s.password=p_auth_password) THEN
    RAISE EXCEPTION 'diagnostics_access_denied' USING ERRCODE='42501';
  END IF;
  SELECT c.account_id, c.log INTO v_account_id, v_log
  FROM public.auto_campaigns c JOIN public.auto_accounts a ON a.id=c.account_id
  WHERE c.id=p_campaign_id AND c.staff_id=p_staff_id AND NOT c.is_delete
    AND (c.organization_id=p_organization_id OR c.organization_id IS NULL)
    AND a.staff_id=p_staff_id AND (a.organization_id=p_organization_id OR a.organization_id IS NULL)
    AND a.flatform_type IN ('facebook','zalo','email');
  IF NOT FOUND THEN RAISE EXCEPTION 'diagnostics_access_denied' USING ERRCODE='42501'; END IF;

  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC,x.id DESC),'[]') INTO v_account_history FROM (
    SELECT id,created_at,login_status,account_status,source,event_type,left(message,8000) AS message,details
    FROM public.auto_account_logs WHERE account_id=v_account_id
    ORDER BY created_at DESC,id DESC LIMIT 30
  ) x;
  -- Campaign log is append-only chronological text. Transfer only the last 30 nonempty lines.
  SELECT coalesce(jsonb_agg(left(x.line,8000) ORDER BY x.n DESC),'[]') INTO v_campaign_history FROM (
    SELECT line,n FROM unnest(string_to_array(coalesce(v_log,''),E'\n')) WITH ORDINALITY AS lines(line,n)
    WHERE btrim(line)<>'' ORDER BY n DESC LIMIT 30
  ) x;
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC,x.id DESC),'[]') INTO v_results FROM (
    SELECT id,input_data_id,created_at,action_name,action_code,status,left(log,8000) AS log,
      error_code,status_id,sub_status_id,action_status_policy_id,report_group,policy_snapshot,counts_toward_limit,post_url
    FROM public.auto_campaign_details WHERE campaign_id=p_campaign_id AND account_id=v_account_id AND NOT is_delete
    ORDER BY created_at DESC,id DESC LIMIT 30
  ) x;
  SELECT coalesce(jsonb_object_agg(x.status,x.total),'{}') INTO v_summary FROM (
    SELECT coalesce(status,'chưa xác minh') AS status,count(*) AS total FROM public.auto_campaign_input_data
    WHERE campaign_id=p_campaign_id AND NOT is_delete GROUP BY status
  ) x;
  WITH pending AS MATERIALIZED (
    SELECT id,input_id,name,phone,uid,email,status,schedule,note,content,info1,info2,info3,info4,info5,created_at
    FROM public.auto_campaign_input_data WHERE campaign_id=p_campaign_id AND NOT is_delete AND status='chờ xử lý'
    ORDER BY created_at DESC,id DESC LIMIT 30
  ), others AS (
    SELECT id,input_id,name,phone,uid,email,status,schedule,note,content,info1,info2,info3,info4,info5,created_at
    FROM public.auto_campaign_input_data WHERE campaign_id=p_campaign_id AND NOT is_delete AND status IS DISTINCT FROM 'chờ xử lý'
    ORDER BY created_at DESC,id DESC LIMIT (SELECT 30-count(*) FROM pending)
  ), sample AS (SELECT * FROM pending UNION ALL SELECT * FROM others)
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY (x.status='chờ xử lý') DESC NULLS LAST,x.created_at DESC,x.id DESC),'[]') INTO v_inputs FROM sample x;
  RETURN jsonb_build_object('accountHistory',v_account_history,'campaignHistory',v_campaign_history,
    'results',v_results,'inputSummary',v_summary,'inputs',v_inputs);
END;
$function$;
ALTER FUNCTION public.aka_agent_campaign_diagnostics_evidence(bigint,bigint,bigint,text,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.aka_agent_campaign_diagnostics_evidence(bigint,bigint,bigint,text,text) FROM PUBLIC,anon,authenticated,service_role,aka_agent_chat_api;
GRANT EXECUTE ON FUNCTION public.aka_agent_campaign_diagnostics_evidence(bigint,bigint,bigint,text,text) TO anon,authenticated,service_role;
COMMENT ON FUNCTION public.aka_agent_campaign_diagnostics_evidence(bigint,bigint,bigint,text,text) IS 'Read-only staff-owned campaign evidence, maximum 30 per history/sample; account logs are diagnostic telemetry only. No direct account-log SELECT grant.';
NOTIFY pgrst,'reload schema';
COMMIT;
