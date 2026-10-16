BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $preflight$ BEGIN
IF to_regprocedure('public.append_auto_campaign_log(bigint,bigint,text)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.append_auto_campaign_log(bigint,bigint,text)'))) IS DISTINCT FROM 'f94520920cec83d91829b7f542435eeb' THEN RAISE EXCEPTION 'v408 source drift: append_auto_campaign_log(bigint,bigint,text)'; END IF;
IF to_regprocedure('public.aka_agent_desktop_campaign_detail(bigint,bigint,text,text,jsonb,bigint,text,jsonb)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.aka_agent_desktop_campaign_detail(bigint,bigint,text,text,jsonb,bigint,text,jsonb)'))) IS DISTINCT FROM '496c1f46adc7e4edfefbeeb0babd123e' THEN RAISE EXCEPTION 'v408 source drift: aka_agent_desktop_campaign_detail(bigint,bigint,text,text,jsonb,bigint,text,jsonb)'; END IF;
IF to_regprocedure('public.aka_agent_campaign_diagnostics_evidence(bigint,bigint,bigint,text,text)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.aka_agent_campaign_diagnostics_evidence(bigint,bigint,bigint,text,text)'))) IS DISTINCT FROM '2b0ba11c25cc61f111f5ed068a31626c' THEN RAISE EXCEPTION 'v408 source drift: aka_agent_campaign_diagnostics_evidence(bigint,bigint,bigint,text,text)'; END IF;
IF to_regclass('public.auto_campaign_logs') IS NOT NULL THEN RAISE EXCEPTION 'v408 table already exists'; END IF;
END $preflight$;

CREATE TABLE public.auto_campaign_logs (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 campaign_id bigint NOT NULL REFERENCES public.auto_campaigns(id) ON DELETE RESTRICT,
 log text NOT NULL CHECK (btrim(log)<>'' AND char_length(log)<=16000),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX idx_auto_campaign_logs_campaign_id_id ON public.auto_campaign_logs(campaign_id,id DESC);
ALTER TABLE public.auto_campaign_logs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.auto_campaign_logs FROM PUBLIC,anon,authenticated,service_role,aka_agent_chat_api;
REVOKE ALL ON SEQUENCE public.auto_campaign_logs_id_seq FROM PUBLIC,anon,authenticated,service_role,aka_agent_chat_api;
COMMENT ON TABLE public.auto_campaign_logs IS 'Campaign run history from V408 onward. One append per row, RPC only, retained indefinitely. No legacy backfill.';

CREATE OR REPLACE FUNCTION public.append_auto_campaign_log(p_campaign_id bigint,p_staff_id bigint,p_log_line text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE
 v_log text:=p_log_line;
 v_marker constant text:=' … [nội dung quá dài đã được rút gọn]';
BEGIN
 IF p_campaign_id IS NULL OR p_campaign_id<=0 THEN RAISE EXCEPTION 'Campaign ID must be a positive integer'; END IF;
 IF p_staff_id IS NULL OR p_staff_id<=0 THEN RAISE EXCEPTION 'Staff ID must be a positive integer'; END IF;
 IF nullif(btrim(coalesce(v_log,'')),'') IS NULL THEN RAISE EXCEPTION 'Campaign log line must not be empty'; END IF;
 IF char_length(v_log)>16000 THEN v_log:=left(v_log,16000-char_length(v_marker))||v_marker; END IF;
 -- All writers acquire this lock before identity allocation. A later cursor
 -- can therefore never jump over an earlier uncommitted append for this campaign.
 PERFORM pg_advisory_xact_lock(hashtextextended('auto_campaign_logs:'||p_campaign_id::text,0));
 IF NOT EXISTS (SELECT 1 FROM public.auto_campaigns c WHERE c.id=p_campaign_id AND c.staff_id=p_staff_id AND coalesce(c.is_delete,false)=false)
 THEN RAISE EXCEPTION 'Active campaign % was not found',p_campaign_id; END IF;
 INSERT INTO public.auto_campaign_logs(campaign_id,log) VALUES(p_campaign_id,v_log);
 RETURN true;
END $fn$;
-- Explicit callers of the previous invoker RPC; do not grant its new definer
-- implementation to arbitrary roles via PUBLIC.
REVOKE ALL ON FUNCTION public.append_auto_campaign_log(bigint,bigint,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.append_auto_campaign_log(bigint,bigint,text) TO anon,authenticated,service_role,aka_agent_chat_api;

CREATE FUNCTION private.campaign_log_legacy(p_campaign_id bigint)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=pg_catalog,public SET plan_cache_mode=force_custom_plan AS $fn$
DECLARE r record; v_entries text[]:='{}'; v_bytes integer:=0; v_count integer:=0;
 v_truncated boolean:=false; v_updated timestamptz;
BEGIN
 -- Stop the index cursor once the legacy byte budget is full; never materialize
 -- thousands of large entries merely to return a 256 KiB compatibility tail.
 FOR r IN SELECT id,log,created_at FROM public.auto_campaign_logs WHERE campaign_id=p_campaign_id ORDER BY id DESC LIMIT 2001 LOOP
  IF v_updated IS NULL THEN v_updated:=r.created_at; END IF;
  IF v_count>=2000 OR v_bytes+octet_length(r.log)+1>262000 THEN v_truncated:=true; EXIT; END IF;
  v_entries:=array_append(v_entries,r.log); v_bytes:=v_bytes+octet_length(r.log)+1; v_count:=v_count+1;
 END LOOP;
 RETURN jsonb_build_object('id',p_campaign_id,'log',
  CASE WHEN v_truncated THEN '--- Chỉ hiển thị lịch sử chạy gần nhất; dùng ứng dụng mới để tải lịch sử cũ hơn ---'||E'\n' ELSE '' END
  ||coalesce((SELECT string_agg(x,E'\n' ORDER BY n DESC) FROM unnest(v_entries) WITH ORDINALITY e(x,n)),''),
  'updatedAt',v_updated);
END $fn$;
REVOKE ALL ON FUNCTION private.campaign_log_legacy(bigint) FROM PUBLIC,anon,authenticated,service_role,aka_agent_chat_api;

CREATE FUNCTION private.campaign_log_page(p_campaign_id bigint,p_options jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=pg_catalog,public SET plan_cache_mode=force_custom_plan AS $fn$
DECLARE
 v_limit integer:=100; v_before bigint; v_after bigint; v_upper bigint; v_rows jsonb; v_more boolean; v_cursor text;
BEGIN
 IF p_options IS NULL OR jsonb_typeof(p_options)<>'object' THEN RAISE EXCEPTION 'Invalid campaign log options'; END IF;
 IF p_options->>'legacy'='true' THEN RETURN private.campaign_log_legacy(p_campaign_id); END IF;
 IF p_options ? 'limit' THEN
  IF coalesce(p_options->>'limit','') !~ '^[0-9]{1,3}$' THEN RAISE EXCEPTION 'Invalid campaign log limit'; END IF;
  v_limit:=(p_options->>'limit')::integer;
 END IF;
 IF v_limit<1 OR v_limit>500 THEN RAISE EXCEPTION 'Invalid campaign log limit'; END IF;
 IF p_options ? 'beforeId' THEN
  IF coalesce(p_options->>'beforeId','') !~ '^[1-9][0-9]{0,18}$' THEN RAISE EXCEPTION 'Invalid before cursor'; END IF;
  v_before:=(p_options->>'beforeId')::bigint;
 END IF;
 IF p_options ? 'afterId' THEN
  IF coalesce(p_options->>'afterId','') !~ '^(0|[1-9][0-9]{0,18})$' THEN RAISE EXCEPTION 'Invalid after cursor'; END IF;
  v_after:=(p_options->>'afterId')::bigint;
 END IF;
 IF v_before IS NOT NULL AND v_after IS NOT NULL THEN RAISE EXCEPTION 'Conflicting log cursors'; END IF;
 IF p_options ? 'throughId' THEN
  IF v_after IS NULL OR coalesce(p_options->>'throughId','') !~ '^(0|[1-9][0-9]{0,18})$' THEN RAISE EXCEPTION 'Invalid upper cursor'; END IF;
  v_upper:=(p_options->>'throughId')::bigint;
 END IF;
 IF v_after IS NOT NULL THEN
  IF v_upper IS NULL THEN SELECT coalesce((SELECT id FROM public.auto_campaign_logs WHERE campaign_id=p_campaign_id ORDER BY id DESC LIMIT 1),0) INTO v_upper; END IF;
  WITH candidates AS MATERIALIZED (
   SELECT id,log,created_at FROM public.auto_campaign_logs
   WHERE campaign_id=p_campaign_id AND id>v_after AND id<=v_upper ORDER BY id ASC LIMIT v_limit+1
  ), page AS (SELECT * FROM candidates ORDER BY id ASC LIMIT v_limit)
  SELECT coalesce((SELECT jsonb_agg(jsonb_build_object('id',id::text,'log',log,'createdAt',created_at) ORDER BY id) FROM page),'[]'),
   (SELECT count(*)>v_limit FROM candidates),(SELECT max(id)::text FROM page)
  INTO v_rows,v_more,v_cursor;
 ELSE
  WITH candidates AS MATERIALIZED (
   SELECT id,log,created_at FROM public.auto_campaign_logs
   -- Keep the cursor in the index condition. Custom plans avoid a generic
   -- estimate choosing the global PK for a campaign with very sparse history.
   WHERE campaign_id=p_campaign_id AND id<=coalesce(v_before-1,9223372036854775807::bigint) ORDER BY id DESC LIMIT v_limit+1
  ), page AS (SELECT * FROM candidates ORDER BY id DESC LIMIT v_limit)
  SELECT coalesce((SELECT jsonb_agg(jsonb_build_object('id',id::text,'log',log,'createdAt',created_at) ORDER BY id DESC) FROM page),'[]'),
   (SELECT count(*)>v_limit FROM candidates),(SELECT min(id)::text FROM page)
  INTO v_rows,v_more,v_cursor;
 END IF;
 RETURN jsonb_build_object('campaignId',p_campaign_id,'items',v_rows,'hasMore',v_more,'nextCursor',v_cursor,'throughId',v_upper::text);
END $fn$;
REVOKE ALL ON FUNCTION private.campaign_log_page(bigint,jsonb) FROM PUBLIC,anon,authenticated,service_role,aka_agent_chat_api;

CREATE FUNCTION public.aka_agent_desktop_campaign_logs(
 p_staff_id bigint,p_organization_id bigint,p_auth_username text,p_auth_password text,p_access jsonb,p_campaign_id bigint,p_options jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public SET statement_timeout='15s' AS $fn$
BEGIN
 PERFORM public.auto_assert_automation_identity(p_staff_id,p_organization_id,p_auth_username,p_auth_password);
 IF p_staff_id IS NULL OR p_organization_id IS NULL OR p_access IS NULL OR p_campaign_id IS NULL OR p_campaign_id<=0 THEN RAISE EXCEPTION 'Invalid campaign log scope'; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.auto_campaigns c
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
      AND c.id=p_campaign_id
 ) THEN RETURN NULL; END IF;
 RETURN private.campaign_log_page(p_campaign_id,p_options);
END $fn$;
REVOKE ALL ON FUNCTION public.aka_agent_desktop_campaign_logs(bigint,bigint,text,text,jsonb,bigint,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aka_agent_desktop_campaign_logs(bigint,bigint,text,text,jsonb,bigint,jsonb) TO anon,authenticated,service_role;

CREATE FUNCTION public.aka_agent_control_campaign_logs(
 p_staff_id bigint,p_organization_id bigint,p_campaign_id bigint,p_platforms text[],p_options jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public SET statement_timeout='15s' AS $fn$
BEGIN
 IF NOT EXISTS (
  SELECT 1 FROM public.auto_campaigns c JOIN public.auto_accounts a ON a.id=c.account_id
  WHERE c.id=p_campaign_id AND c.staff_id=p_staff_id AND c.organization_id=p_organization_id AND c.is_delete=false
   AND a.staff_id=p_staff_id AND a.organization_id=p_organization_id AND a.is_delete=false
   AND a.flatform_type=ANY(p_platforms)
   AND (a.flatform_type<>'zalo' OR (a.is_zalo_server IS TRUE AND a.is_zalo_show_web IS FALSE))
 ) THEN RETURN NULL; END IF;
 RETURN private.campaign_log_page(p_campaign_id,p_options);
END $fn$;
REVOKE ALL ON FUNCTION public.aka_agent_control_campaign_logs(bigint,bigint,bigint,text[],jsonb) FROM PUBLIC,anon,authenticated,aka_agent_chat_api;
GRANT EXECUTE ON FUNCTION public.aka_agent_control_campaign_logs(bigint,bigint,bigint,text[],jsonb) TO service_role;

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
  SELECT h.data->>'log',(h.data->>'updatedAt')::timestamptz INTO v_log,v_updated_at
  FROM public.auto_campaigns c
  CROSS JOIN LATERAL (SELECT private.campaign_log_legacy(c.id) AS data) h
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
  SELECT c.account_id INTO v_account_id
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
  -- Latest 30 nonempty physical lines, preserving the existing evidence contract.
  SELECT coalesce(jsonb_agg(left(x.line,8000) ORDER BY x.id DESC,x.n DESC),'[]') INTO v_campaign_history FROM (
    SELECT h.id,l.line,l.n
    FROM (SELECT id,log FROM public.auto_campaign_logs WHERE campaign_id=p_campaign_id ORDER BY id DESC LIMIT 30) h
    CROSS JOIN LATERAL unnest(string_to_array(h.log,E'\n')) WITH ORDINALITY l(line,n)
    WHERE btrim(l.line)<>'' ORDER BY h.id DESC,l.n DESC LIMIT 30
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

COMMENT ON FUNCTION public.append_auto_campaign_log(bigint,bigint,text) IS 'V408: append one immutable campaign history entry; no campaign row update or legacy history backfill. Existing explicit writer roles only.';
NOTIFY pgrst,'reload schema';
COMMIT;
