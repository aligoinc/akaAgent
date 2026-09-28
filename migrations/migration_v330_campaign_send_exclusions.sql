-- v330: catalog-driven campaign send exclusions. Production apply is separate.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='120s';
DO $preflight$
BEGIN
  IF to_regprocedure('public.auto_assert_automation_identity(bigint,bigint,text,text)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.auto_assert_automation_identity(bigint,bigint,text,text)'))) <> '5a9a503db72b965eb644739f5f60905d' THEN RAISE EXCEPTION 'v330 source drift: auto_assert_automation_identity(bigint,bigint,text,text)'; END IF;
  IF to_regprocedure('public.aka_agent_internal_delivery_cooldown_target_keys(text,text,text,text)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.aka_agent_internal_delivery_cooldown_target_keys(text,text,text,text)'))) <> 'f356ae8c97cab7890f4a1740b99adce3' THEN RAISE EXCEPTION 'v330 source drift: aka_agent_internal_delivery_cooldown_target_keys(text,text,text,text)'; END IF;
  IF to_regprocedure('public.aka_agent_apply_campaign_delivery_cooldown(bigint,bigint,bigint,bigint[])') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.aka_agent_apply_campaign_delivery_cooldown(bigint,bigint,bigint,bigint[])'))) <> '950e5b2f6a350421586ba7c1046ed9eb' THEN RAISE EXCEPTION 'v330 source drift: aka_agent_apply_campaign_delivery_cooldown(bigint,bigint,bigint,bigint[])'; END IF;
  IF to_regprocedure('public.aka_agent_data_group_zalo_facts(bigint)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.aka_agent_data_group_zalo_facts(bigint)'))) <> '9cac9151db1cd2e208f5f0f160e7100e' THEN RAISE EXCEPTION 'v330 source drift: aka_agent_data_group_zalo_facts(bigint)'; END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner WHERE p.oid=to_regprocedure('public.aka_agent_apply_campaign_delivery_cooldown(bigint,bigint,bigint,bigint[])') AND (r.rolname<>'postgres' OR p.proacl::text IS DISTINCT FROM '{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres,aka_agent_chat_api=X/postgres}')) THEN RAISE EXCEPTION 'v330 cooldown owner/ACL drift'; END IF;
  IF to_regclass('public.auto_filter_fields') IS NOT NULL THEN RAISE EXCEPTION 'v330 table already exists: auto_filter_fields'; END IF;
  IF to_regclass('public.auto_filter_operators') IS NOT NULL THEN RAISE EXCEPTION 'v330 table already exists: auto_filter_operators'; END IF;
  IF to_regclass('public.auto_filter_field_operators') IS NOT NULL THEN RAISE EXCEPTION 'v330 table already exists: auto_filter_field_operators'; END IF;
  IF to_regclass('public.auto_filter_field_options') IS NOT NULL THEN RAISE EXCEPTION 'v330 table already exists: auto_filter_field_options'; END IF;
  IF to_regclass('public.auto_campaign_send_exclusion_groups') IS NOT NULL THEN RAISE EXCEPTION 'v330 table already exists: auto_campaign_send_exclusion_groups'; END IF;
  IF to_regclass('public.auto_campaign_send_exclusion_rules') IS NOT NULL THEN RAISE EXCEPTION 'v330 table already exists: auto_campaign_send_exclusion_rules'; END IF;
END;
$preflight$;
CREATE FUNCTION public.aka_agent_internal_send_delivery_history(p_account_id bigint,p_action_codes text[],p_since timestamptz,p_now timestamptz)
RETURNS TABLE(detail_id bigint,created_at timestamptz,campaign_id bigint,campaign_name text,target_keys text[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $function$
    SELECT
      d.id AS detail_id,
      d.created_at,
      d.campaign_id,
      c.name AS campaign_name,
      public.aka_agent_internal_delivery_cooldown_target_keys(
        CASE d.action_code
          WHEN 'fb_post_group' THEN 'facebook_group'
          WHEN 'fb_post_page' THEN 'facebook_page'
          WHEN 'fb_message_friend' THEN 'facebook_person'
          WHEN 'fb_message_stranger' THEN 'facebook_person'
          WHEN 'fb_message_page_inbox_customer' THEN 'facebook_page_inbox'
          WHEN 'zalo_message_friend' THEN 'zalo_person'
          WHEN 'zalo_message_stranger' THEN 'zalo_person'
          WHEN 'zalo_message_group' THEN 'zalo_group'
          WHEN 'sms_send' THEN 'phone'
          WHEN 'email_send' THEN 'email'
          ELSE ''
        END,
        source_input.uid,
        source_input.phone,
        source_input.email
      ) AS target_keys
    FROM public.auto_campaign_details AS d
    JOIN public.auto_campaign_input_data AS source_input ON source_input.id = d.input_data_id
    LEFT JOIN public.auto_campaigns AS c ON c.id = d.campaign_id
    WHERE d.account_id = p_account_id
      AND d.action_code = ANY(p_action_codes)
      AND d.status IN ('thành công', 'đã gửi', 'đã nhận', 'đã xem', 'đã click')
      AND d.created_at >= p_since
      AND d.created_at <= p_now
$function$;
REVOKE ALL ON FUNCTION public.aka_agent_internal_send_delivery_history(bigint,text[],timestamptz,timestamptz) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.aka_agent_apply_campaign_delivery_cooldown(p_campaign_id bigint, p_account_id bigint, p_staff_id bigint, p_input_data_ids bigint[])
 RETURNS TABLE(input_data_id bigint, decision text, note text, last_sent_at timestamp with time zone, eligible_date date, source_campaign_id bigint, source_campaign_name text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_campaign public.auto_campaigns%ROWTYPE;
  v_extra jsonb;
  v_enabled boolean;
  v_days_text text;
  v_days integer;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_today date := pg_catalog.timezone('Asia/Ho_Chi_Minh', v_now)::date;
  v_history_since timestamptz;
  v_target_kind text;
  v_history_action_codes text[];
  v_ids bigint[];
  v_requested_count integer;
  v_locked_count integer;
  v_supported boolean := true;
BEGIN
  IF p_campaign_id IS NULL OR p_campaign_id <= 0
    OR p_account_id IS NULL OR p_account_id <= 0
    OR p_staff_id IS NULL OR p_staff_id <= 0 THEN
    RAISE EXCEPTION 'invalid_campaign_delivery_cooldown_scope';
  END IF;

  SELECT pg_catalog.array_agg(requested.id ORDER BY requested.ordinality), pg_catalog.count(*)::integer
  INTO v_ids, v_requested_count
  FROM (
    SELECT DISTINCT ON (u.id) u.id, u.ordinality
    FROM pg_catalog.unnest(COALESCE(p_input_data_ids, ARRAY[]::bigint[])) WITH ORDINALITY AS u(id, ordinality)
    WHERE u.id IS NOT NULL AND u.id > 0
    ORDER BY u.id, u.ordinality
  ) AS requested;

  IF v_requested_count IS NULL OR v_requested_count < 1 OR v_requested_count > 500 THEN
    RAISE EXCEPTION 'invalid_campaign_delivery_cooldown_batch_size';
  END IF;

  SELECT c.*
  INTO v_campaign
  FROM public.auto_campaigns AS c
  JOIN public.auto_accounts AS a
    ON a.id = c.account_id
   AND a.staff_id = p_staff_id
   AND a.organization_id = c.organization_id
   AND COALESCE(a.is_delete, false) = false
  JOIN public.org_staff AS s
    ON s.id = p_staff_id
   AND s.organization_id = c.organization_id
   AND s.is_active = true
  WHERE c.id = p_campaign_id
    AND c.account_id = p_account_id
    AND c.staff_id = p_staff_id
    AND COALESCE(c.is_delete, false) = false;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'campaign_delivery_cooldown_scope_not_found';
  END IF;

  PERFORM i.id
  FROM public.auto_campaign_input_data AS i
  WHERE i.id = ANY(v_ids)
    AND i.campaign_id = p_campaign_id
    AND COALESCE(i.is_delete, false) = false
  ORDER BY i.id
  FOR UPDATE;
  GET DIAGNOSTICS v_locked_count = ROW_COUNT;

  IF v_locked_count <> v_requested_count THEN
    RAISE EXCEPTION 'campaign_delivery_cooldown_input_scope_mismatch';
  END IF;

  v_extra := COALESCE(v_campaign.extra_settings, '{}'::jsonb);
  v_enabled := COALESCE((v_extra->>'recentDeliveryCooldownEnabled')::boolean, false);

  IF NOT v_enabled THEN
    RETURN QUERY
    SELECT i.id, 'allowed'::text, NULL::text, NULL::timestamptz, NULL::date, NULL::bigint, NULL::text
    FROM public.auto_campaign_input_data AS i
    WHERE i.id = ANY(v_ids)
    ORDER BY pg_catalog.array_position(v_ids, i.id);
    RETURN;
  END IF;

  v_days_text := COALESCE(NULLIF(pg_catalog.btrim(v_extra->>'recentDeliveryCooldownDays'), ''), '3');
  IF v_days_text !~ '^[0-9]+$' THEN
    RAISE EXCEPTION 'invalid_campaign_delivery_cooldown_days';
  END IF;
  v_days := v_days_text::integer;
  IF v_days < 1 OR v_days > 3650 THEN
    RAISE EXCEPTION 'invalid_campaign_delivery_cooldown_days';
  END IF;

  CASE v_campaign.action_id
    WHEN 'facebook_group_post' THEN
      v_target_kind := 'facebook_group';
      v_history_action_codes := ARRAY['fb_post_group', 'fb_post_page'];
    WHEN 'facebook_page_post' THEN
      v_target_kind := 'facebook_page';
      v_history_action_codes := ARRAY['fb_post_group', 'fb_post_page'];
    WHEN 'facebook_message_friend' THEN
      v_target_kind := 'facebook_person';
      v_history_action_codes := ARRAY['fb_message_friend', 'fb_message_stranger'];
    WHEN 'facebook_message_uid' THEN
      IF COALESCE((v_extra->>'enableMessage')::boolean, true) THEN
        v_target_kind := 'facebook_person';
        v_history_action_codes := ARRAY['fb_message_friend', 'fb_message_stranger'];
      ELSE
        v_supported := false;
      END IF;
    WHEN 'facebook_page_to_message' THEN
      v_target_kind := 'facebook_page_inbox';
      v_history_action_codes := ARRAY['fb_message_page_inbox_customer'];
    WHEN 'zalo_message_friend', 'zalo_message_birthday' THEN
      v_target_kind := 'zalo_person';
      v_history_action_codes := ARRAY['zalo_message_friend', 'zalo_message_stranger'];
    WHEN 'zalo_message_group' THEN
      v_target_kind := 'zalo_group';
      v_history_action_codes := ARRAY['zalo_message_group'];
    WHEN 'zalo_message_phone', 'zalo_message_group_member', 'zalo_message_group_realtime',
         'zalo_message_remarketing_customer', 'zalo_message_friend_recommendation' THEN
      IF COALESCE((v_extra->>'enableMessage')::boolean, false) THEN
        v_target_kind := 'zalo_person';
        v_history_action_codes := ARRAY['zalo_message_friend', 'zalo_message_stranger'];
      ELSE
        v_supported := false;
      END IF;
    WHEN 'sms_send' THEN
      v_target_kind := 'phone';
      v_history_action_codes := ARRAY['sms_send'];
    WHEN 'email_send' THEN
      v_target_kind := 'email';
      v_history_action_codes := ARRAY['email_send'];
    ELSE
      v_supported := false;
  END CASE;

  IF NOT v_supported THEN
    RETURN QUERY
    SELECT i.id, 'allowed'::text, NULL::text, NULL::timestamptz, NULL::date, NULL::bigint, NULL::text
    FROM public.auto_campaign_input_data AS i
    WHERE i.id = ANY(v_ids)
    ORDER BY pg_catalog.array_position(v_ids, i.id);
    RETURN;
  END IF;

  v_history_since := ((v_today - (v_days - 1))::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh');

  RETURN QUERY
  WITH requested AS MATERIALIZED (
    SELECT
      i.id,
      i.status,
      u.ordinality,
      public.aka_agent_internal_delivery_cooldown_target_keys(
        v_target_kind,
        i.uid,
        i.phone,
        i.email
      ) AS target_keys
    FROM pg_catalog.unnest(v_ids) WITH ORDINALITY AS u(id, ordinality)
    JOIN public.auto_campaign_input_data AS i ON i.id = u.id
  ),
  batch_duplicates AS MATERIALIZED (
    SELECT current_row.id
    FROM requested AS current_row
    WHERE EXISTS (
      SELECT 1
      FROM requested AS earlier_row
      WHERE earlier_row.ordinality < current_row.ordinality
        AND earlier_row.target_keys && current_row.target_keys
    )
  ),
  history AS MATERIALIZED (
    SELECT * FROM public.aka_agent_internal_send_delivery_history(p_account_id, v_history_action_codes, v_history_since, v_now)
  ),
  latest AS MATERIALIZED (
    SELECT DISTINCT ON (r.id)
      r.id AS input_data_id,
      h.created_at AS last_sent_at,
      h.campaign_id AS source_campaign_id,
      h.campaign_name AS source_campaign_name
    FROM requested AS r
    JOIN history AS h ON h.target_keys && r.target_keys
    ORDER BY r.id, h.created_at DESC, h.detail_id DESC
  ),
  decisions AS MATERIALIZED (
    SELECT
      r.id AS input_data_id,
      CASE
        WHEN r.status IS DISTINCT FROM 'chờ xử lý' THEN 'not_pending'
        WHEN pg_catalog.cardinality(r.target_keys) = 0 THEN 'paused_unidentifiable'
        WHEN bd.id IS NOT NULL THEN 'deferred_batch_duplicate'
        WHEN l.input_data_id IS NOT NULL
          AND v_today < (pg_catalog.timezone('Asia/Ho_Chi_Minh', l.last_sent_at)::date + v_days)
          THEN 'paused_recent_delivery'
        ELSE 'allowed'
      END AS decision,
      CASE
        WHEN r.status IS DISTINCT FROM 'chờ xử lý' THEN 'Data không còn ở trạng thái chờ xử lý.'
        WHEN pg_catalog.cardinality(r.target_keys) = 0
          THEN 'Tạm dừng vì không thể chuẩn hóa đối tượng để kiểm tra giới hạn gửi/đăng lặp.'
        WHEN bd.id IS NOT NULL
          THEN 'Giữ chờ xử lý vì trùng đối tượng với một data đứng trước trong cùng batch.'
        WHEN l.input_data_id IS NOT NULL
          AND v_today < (pg_catalog.timezone('Asia/Ho_Chi_Minh', l.last_sent_at)::date + v_days)
          THEN pg_catalog.format(
            CASE
              WHEN v_campaign.action_id IN ('facebook_group_post', 'facebook_page_post')
                THEN 'Tạm dừng: đã đăng bài trước đó ngày %s. Đăng lại từ %s.'
              WHEN v_campaign.action_id = 'email_send'
                THEN 'Tạm dừng: đã gửi email trước đó ngày %s. Gửi lại từ %s.'
              WHEN v_campaign.action_id = 'sms_send'
                THEN 'Tạm dừng: đã gửi SMS trước đó ngày %s. Gửi lại từ %s.'
              ELSE 'Tạm dừng: đã gửi tin trước đó ngày %s. Gửi lại từ %s.'
            END,
            pg_catalog.to_char(pg_catalog.timezone('Asia/Ho_Chi_Minh', l.last_sent_at)::date, 'DD/MM/YYYY'),
            pg_catalog.to_char(pg_catalog.timezone('Asia/Ho_Chi_Minh', l.last_sent_at)::date + v_days, 'DD/MM/YYYY')
          )
        ELSE NULL
      END AS note,
      l.last_sent_at,
      CASE WHEN l.last_sent_at IS NULL THEN NULL
        ELSE pg_catalog.timezone('Asia/Ho_Chi_Minh', l.last_sent_at)::date + v_days
      END AS eligible_date,
      l.source_campaign_id,
      l.source_campaign_name,
      r.ordinality
    FROM requested AS r
    LEFT JOIN batch_duplicates AS bd ON bd.id = r.id
    LEFT JOIN latest AS l ON l.input_data_id = r.id
  ),
  paused AS (
    UPDATE public.auto_campaign_input_data AS i
    SET status = 'tạm dừng',
        note = d.note
    FROM decisions AS d
    WHERE i.id = d.input_data_id
      AND i.status = 'chờ xử lý'
      AND d.decision IN ('paused_recent_delivery', 'paused_unidentifiable')
    RETURNING i.id
  )
  SELECT
    d.input_data_id,
    d.decision,
    d.note,
    d.last_sent_at,
    d.eligible_date,
    d.source_campaign_id,
    d.source_campaign_name
  FROM decisions AS d
  LEFT JOIN paused AS p ON p.id = d.input_data_id
  ORDER BY d.ordinality;
END;
$function$;

CREATE TABLE public.auto_filter_fields (
 id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, code text NOT NULL UNIQUE, name text NOT NULL,
 data_type text NOT NULL CHECK (data_type IN ('text','number','boolean','enum','set','date')),
 source_key text NOT NULL, source_config jsonb NOT NULL CHECK(jsonb_typeof(source_config)='object'),
 options_source text NOT NULL DEFAULT 'none', options_config jsonb NOT NULL DEFAULT '{}',
 is_active boolean NOT NULL DEFAULT true, sort_order integer NOT NULL DEFAULT 0
);
CREATE TABLE public.auto_filter_operators (
 id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, code text NOT NULL UNIQUE, name text NOT NULL,
 evaluator_key text NOT NULL, is_active boolean NOT NULL DEFAULT true, sort_order integer NOT NULL DEFAULT 0
);
CREATE TABLE public.auto_filter_field_operators (
 field_id bigint NOT NULL REFERENCES public.auto_filter_fields, operator_id bigint NOT NULL REFERENCES public.auto_filter_operators,
 value_type text NOT NULL CHECK(value_type IN ('text','number','boolean','enum','date')),
 min_values integer NOT NULL DEFAULT 1 CHECK(min_values>0), max_values integer NOT NULL DEFAULT 1,
 validation_config jsonb NOT NULL DEFAULT '{}', PRIMARY KEY(field_id,operator_id), CHECK(max_values>=min_values)
);
CREATE TABLE public.auto_filter_field_options (
 id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, field_id bigint NOT NULL REFERENCES public.auto_filter_fields,
 code text NOT NULL, label text NOT NULL, value jsonb NOT NULL, is_active boolean NOT NULL DEFAULT true,
 sort_order integer NOT NULL DEFAULT 0, UNIQUE(field_id,code), UNIQUE(field_id,value)
);
CREATE TABLE public.auto_campaign_send_exclusion_groups (
 id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
 staff_id bigint NOT NULL REFERENCES public.org_staff, organization_id bigint NOT NULL REFERENCES public.org_organization,
 account_id bigint NOT NULL REFERENCES public.auto_accounts, name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 200),
 match_mode text NOT NULL CHECK(match_mode IN ('and','or')), revision bigint NOT NULL DEFAULT 1,
 create_request_id uuid NOT NULL, UNIQUE(staff_id,organization_id,account_id,create_request_id),
 is_delete boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auto_send_exclusion_groups_owner ON public.auto_campaign_send_exclusion_groups(staff_id,organization_id,account_id,id) WHERE NOT is_delete;
CREATE TABLE public.auto_campaign_send_exclusion_rules (
 id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, group_id bigint NOT NULL REFERENCES public.auto_campaign_send_exclusion_groups ON DELETE CASCADE,
 field_id bigint NOT NULL, operator_id bigint NOT NULL, value jsonb NOT NULL, is_enabled boolean NOT NULL DEFAULT true, sort_order integer NOT NULL DEFAULT 0,
 FOREIGN KEY(field_id,operator_id) REFERENCES public.auto_filter_field_operators(field_id,operator_id), UNIQUE(group_id,field_id)
);
DO $tables$
DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['auto_filter_fields','auto_filter_operators','auto_filter_field_operators','auto_filter_field_options','auto_campaign_send_exclusion_groups','auto_campaign_send_exclusion_rules'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role,aka_agent_chat_api',t);
 END LOOP;
END;
$tables$;
INSERT INTO public.auto_filter_fields(code,name,data_type,source_key,source_config,options_source,sort_order) VALUES
 ('zalo_friend_status','Trạng thái bạn bè','enum','zalo_friendship','{"path":["status"]}','friend_status',10),
 ('zalo_tag','Tag Zalo','set','zalo_labels','{"path":["ids"]}','zalo_labels',20),
 ('akabiz_tag','Tag akaBiz','set','akabiz_contact','{"path":["ids"]}','akabiz_tags',30),
 ('recent_delivery','Đã gửi tin trong','number','campaign_delivery','{"path":["daysSince"]}','none',40);
UPDATE public.auto_filter_fields SET options_config='{"operatorPlacement":"afterValue"}' WHERE code='recent_delivery';
INSERT INTO public.auto_filter_operators(code,name,evaluator_key,sort_order) VALUES
 ('equals','bằng','equals',10),('not_equals','không bằng','not_equals',20),
 ('contains','chứa','contains_any',30),('not_contains','không chứa','contains_none',40),
 ('within_days','ngày gần nhất','lt',50),('text_contains','chứa','text_contains',60),
 ('text_not_contains','không chứa','text_not_contains',70),('starts_with','bắt đầu là','text_starts_with',80),
 ('not_starts_with','không bắt đầu là','text_not_starts_with',90),('lt','nhỏ hơn','lt',100),
 ('lte','nhỏ hơn hoặc bằng','lte',110),('gt','lớn hơn','gt',120),('gte','lớn hơn hoặc bằng','gte',130);
INSERT INTO public.auto_filter_field_operators(field_id,operator_id,value_type,min_values,max_values,validation_config)
SELECT f.id,o.id,CASE WHEN f.code='recent_delivery' THEN 'number' ELSE 'enum' END,1,
 CASE WHEN f.data_type='set' THEN 100 ELSE 1 END,
 CASE WHEN f.code='recent_delivery' THEN '{"min":1,"max":3650,"integer":true}'::jsonb ELSE '{}' END
FROM public.auto_filter_fields f CROSS JOIN public.auto_filter_operators o
WHERE (f.code='zalo_friend_status' AND o.code IN ('equals','not_equals'))
 OR (f.code IN ('zalo_tag','akabiz_tag') AND o.code IN ('contains','not_contains'))
 OR (f.code='recent_delivery' AND o.code='within_days');

CREATE FUNCTION public.aka_agent_internal_send_exclusion_catalog() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
 SELECT jsonb_build_object(
 'fields',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'code',code,'name',name,'dataType',data_type,'sourceKey',source_key,'sourceConfig',source_config,'optionsSource',options_source,'optionsConfig',options_config,'isActive',is_active,'sortOrder',sort_order) ORDER BY sort_order,id) FROM public.auto_filter_fields),'[]'),
 'operators',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'code',code,'name',name,'evaluatorKey',evaluator_key,'isActive',is_active,'sortOrder',sort_order) ORDER BY sort_order,id) FROM public.auto_filter_operators),'[]'),
 'fieldOperators',COALESCE((SELECT jsonb_agg(jsonb_build_object('fieldId',field_id,'operatorId',operator_id,'valueType',value_type,'minValues',min_values,'maxValues',max_values,'validationConfig',validation_config)) FROM public.auto_filter_field_operators),'[]'),
 'options',COALESCE((SELECT jsonb_agg(jsonb_build_object('fieldId',field_id,'code',code,'label',label,'value',value,'isActive',is_active,'sortOrder',sort_order) ORDER BY sort_order,id) FROM public.auto_filter_field_options),'[]'));
$fn$;
CREATE FUNCTION public.aka_agent_internal_send_exclusion_options(p_staff bigint,p_org bigint,p_account bigint) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
 SELECT COALESCE(jsonb_agg(jsonb_build_object('fieldId',field_id,'code',key,'label',label,'value',val,'isActive',true,'sortOrder',0) ORDER BY field_id,label,key),'[]') FROM (SELECT DISTINCT ON (field_id,val) * FROM (
 SELECT f.id field_id,i.code key,i.name label,to_jsonb(i.code) val,0 priority FROM public.auto_filter_fields f
 JOIN public.category_type t ON t.namespace='common' AND t.code='zalo_friend_status'
 JOIN public.category_item i ON i.category_type_id=t.id AND i.is_active WHERE f.options_source='friend_status'
 UNION ALL SELECT f.id,t.id::text,t.name,to_jsonb(t.id::text),0 FROM public.auto_filter_fields f CROSS JOIN public.auto_contact_tags t
 WHERE f.options_source='akabiz_tags' AND t.staff_id=p_staff AND t.organization_id=p_org AND NOT t.is_delete AND (t.auto_account_id IS NULL OR t.auto_account_id=p_account)
 UNION ALL SELECT DISTINCT f.id,c.uid,c.name,to_jsonb(c.uid),1 FROM public.auto_filter_fields f CROSS JOIN public.auto_account_contacts c
 WHERE f.options_source='zalo_labels' AND c.account_id=p_account AND c.staff_id=p_staff AND c.organization_id=p_org AND c.contact_type='zalo_tag' AND NOT c.is_delete
 UNION ALL SELECT DISTINCT f.id,t.zalo_id,COALESCE(t.name,t.zalo_id),to_jsonb(t.zalo_id),0 FROM public.auto_filter_fields f
 CROSS JOIN public.chat_zalo_account_tag t JOIN public.chat_zalo_account_organization b ON b.chat_zalo_account_id=t.chat_zalo_account_id
 WHERE f.options_source='zalo_labels' AND b.auto_account_id=p_account AND b.organization_id=p_org AND b.is_active
 UNION ALL SELECT field_id,code,label,value,0 FROM public.auto_filter_field_options WHERE is_active
 ) candidates ORDER BY field_id,val,priority,label,key) options;
$fn$;
CREATE FUNCTION public.aka_agent_internal_send_exclusion_group(p_id bigint) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
 SELECT jsonb_build_object('id',g.id,'requestId',g.create_request_id,'accountId',g.account_id,'name',g.name,'matchMode',g.match_mode,'revision',g.revision,
 'rules',COALESCE((SELECT jsonb_agg(jsonb_build_object('fieldId',r.field_id,'operatorId',r.operator_id,'value',r.value,'isEnabled',r.is_enabled,'sortOrder',r.sort_order) ORDER BY r.sort_order,r.id) FROM public.auto_campaign_send_exclusion_rules r WHERE r.group_id=g.id),'[]'))
 FROM public.auto_campaign_send_exclusion_groups g WHERE g.id=p_id AND NOT g.is_delete;
$fn$;

CREATE FUNCTION public.aka_agent_internal_validate_send_exclusion_rules(p_rules jsonb,p_staff bigint,p_org bigint,p_account bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE r jsonb; f public.auto_filter_fields%ROWTYPE; m public.auto_filter_field_operators%ROWTYPE; vals jsonb; v jsonb; opts jsonb;
BEGIN
 IF jsonb_typeof(p_rules) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rules)=0 OR jsonb_array_length(p_rules)>100
 OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_rules) x WHERE x->>'isEnabled'='true') THEN RAISE EXCEPTION 'send_exclusion_rules_required'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_rules) x GROUP BY x->>'fieldId' HAVING count(*)>1) THEN RAISE EXCEPTION 'send_exclusion_duplicate_field'; END IF;
 opts:=public.aka_agent_internal_send_exclusion_options(p_staff,p_org,p_account);
 FOR r IN SELECT * FROM jsonb_array_elements(p_rules) LOOP
  SELECT * INTO f FROM public.auto_filter_fields WHERE id=(r->>'fieldId')::bigint AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'send_exclusion_field_unavailable'; END IF;
  SELECT m0.* INTO m FROM public.auto_filter_field_operators m0 JOIN public.auto_filter_operators o ON o.id=m0.operator_id AND o.is_active
   WHERE m0.field_id=f.id AND m0.operator_id=(r->>'operatorId')::bigint;
  IF NOT FOUND THEN RAISE EXCEPTION 'send_exclusion_operator_unavailable'; END IF;
  IF NOT COALESCE((r->>'isEnabled')::boolean,false) THEN CONTINUE; END IF;
  vals:=CASE WHEN jsonb_typeof(r->'value')='array' THEN r->'value' WHEN r->'value' IS NOT NULL AND r->'value'<>'null' THEN jsonb_build_array(r->'value') ELSE '[]' END;
  IF jsonb_array_length(vals)<m.min_values OR jsonb_array_length(vals)>m.max_values THEN RAISE EXCEPTION 'send_exclusion_value_count'; END IF;
  FOR v IN SELECT * FROM jsonb_array_elements(vals) LOOP
   IF m.value_type='number' THEN
    IF jsonb_typeof(v)<>'number' THEN RAISE EXCEPTION 'send_exclusion_number_required'; END IF;
    IF (m.validation_config ? 'min' AND (v#>>'{}')::numeric<(m.validation_config->>'min')::numeric)
    OR (m.validation_config ? 'max' AND (v#>>'{}')::numeric>(m.validation_config->>'max')::numeric)
    OR (COALESCE((m.validation_config->>'integer')::boolean,false) AND trunc((v#>>'{}')::numeric)<>(v#>>'{}')::numeric) THEN RAISE EXCEPTION 'send_exclusion_number_range'; END IF;
   ELSIF m.value_type='date' THEN
    IF jsonb_typeof(v)<>'string' OR (v#>>'{}') !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'send_exclusion_date_required'; END IF;
    PERFORM (v#>>'{}')::date;
   ELSIF m.value_type='text' AND (jsonb_typeof(v)<>'string' OR length(btrim(v#>>'{}'))=0) THEN RAISE EXCEPTION 'send_exclusion_text_required';
   ELSIF m.value_type='boolean' AND jsonb_typeof(v)<>'boolean' THEN RAISE EXCEPTION 'send_exclusion_boolean_required'; END IF;
   IF f.options_source<>'none' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(opts) o WHERE (o->>'fieldId')::bigint=f.id AND o->'value'=v) THEN RAISE EXCEPTION 'send_exclusion_option_unavailable'; END IF;
  END LOOP;
 END LOOP;
END;
$fn$;

CREATE FUNCTION public.aka_agent_send_exclusion_groups(p_staff_id bigint,p_organization_id bigint,p_account_id bigint,p_operation text,p_payload jsonb,p_auth_username text,p_auth_password text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET statement_timeout='15s' AS $fn$
DECLARE gid bigint; revision bigint; r jsonb; prior jsonb; request_id uuid;
BEGIN
 PERFORM public.auto_assert_automation_identity(p_staff_id,p_organization_id,p_auth_username,p_auth_password);
 IF NOT EXISTS(SELECT 1 FROM public.auto_accounts WHERE id=p_account_id AND staff_id=p_staff_id AND organization_id=p_organization_id AND flatform_type='zalo' AND NOT is_delete) THEN RAISE EXCEPTION 'send_exclusion_account_not_found'; END IF;
 IF p_operation='list' THEN
  RETURN jsonb_build_object('catalog',public.aka_agent_internal_send_exclusion_catalog(),
   'options',public.aka_agent_internal_send_exclusion_options(p_staff_id,p_organization_id,p_account_id),
   'groups',COALESCE((SELECT jsonb_agg(public.aka_agent_internal_send_exclusion_group(id) ORDER BY name,id) FROM public.auto_campaign_send_exclusion_groups WHERE staff_id=p_staff_id AND organization_id=p_organization_id AND account_id=p_account_id AND NOT is_delete),'[]'),
   'blocklists',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',g.id,'name',g.name,'count',(SELECT count(*) FROM public.auto_account_contact_group_members m JOIN public.auto_account_contacts c ON c.id=m.contact_id WHERE m.group_id=g.id AND NOT m.is_delete AND NOT c.is_delete AND c.account_id=p_account_id AND c.staff_id=p_staff_id AND c.organization_id=p_organization_id)) ORDER BY g.name,g.id)
   FROM public.auto_account_contact_groups g WHERE g.account_id=p_account_id AND g.staff_id=p_staff_id AND g.organization_id=p_organization_id AND NOT g.is_delete AND g.purpose='zalo_friend_blocklist'),'[]'));
 ELSIF p_operation<>'save' THEN RAISE EXCEPTION 'send_exclusion_operation_invalid'; END IF;
 PERFORM public.aka_agent_internal_validate_send_exclusion_rules(p_payload->'rules',p_staff_id,p_organization_id,p_account_id);
 gid:=(p_payload->>'id')::bigint;
 IF gid IS NULL THEN
  request_id:=(p_payload->>'requestId')::uuid;
  IF request_id IS NULL THEN RAISE EXCEPTION 'send_exclusion_request_id_required'; END IF;
  INSERT INTO public.auto_campaign_send_exclusion_groups(staff_id,organization_id,account_id,name,match_mode,create_request_id)
   VALUES(p_staff_id,p_organization_id,p_account_id,btrim(p_payload->>'name'),p_payload->>'matchMode',request_id)
   ON CONFLICT(staff_id,organization_id,account_id,create_request_id) DO NOTHING RETURNING id INTO gid;
  IF gid IS NULL THEN
   SELECT public.aka_agent_internal_send_exclusion_group(id) INTO prior FROM public.auto_campaign_send_exclusion_groups
    WHERE staff_id=p_staff_id AND organization_id=p_organization_id AND account_id=p_account_id AND create_request_id=request_id AND NOT is_delete;
   IF prior IS NULL OR prior->>'name' IS DISTINCT FROM btrim(p_payload->>'name') OR prior->>'matchMode' IS DISTINCT FROM p_payload->>'matchMode'
    OR (SELECT jsonb_agg(v ORDER BY v->>'fieldId') FROM jsonb_array_elements(prior->'rules') v) IS DISTINCT FROM (SELECT jsonb_agg(v ORDER BY v->>'fieldId') FROM jsonb_array_elements(p_payload->'rules') v)
   THEN RAISE EXCEPTION 'send_exclusion_revision_conflict'; END IF;
   RETURN prior;
  END IF;
 ELSE
  UPDATE public.auto_campaign_send_exclusion_groups g SET name=btrim(p_payload->>'name'),match_mode=p_payload->>'matchMode',revision=g.revision+1,updated_at=now()
   WHERE g.id=gid AND g.staff_id=p_staff_id AND g.organization_id=p_organization_id AND g.account_id=p_account_id AND NOT g.is_delete AND g.revision=(p_payload->>'revision')::bigint RETURNING g.revision INTO revision;
  IF NOT FOUND THEN RAISE EXCEPTION 'send_exclusion_revision_conflict'; END IF;
  DELETE FROM public.auto_campaign_send_exclusion_rules WHERE group_id=gid;
 END IF;
 FOR r IN SELECT * FROM jsonb_array_elements(p_payload->'rules') LOOP
  INSERT INTO public.auto_campaign_send_exclusion_rules(group_id,field_id,operator_id,value,is_enabled,sort_order)
  VALUES(gid,(r->>'fieldId')::bigint,(r->>'operatorId')::bigint,COALESCE(r->'value','null'),COALESCE((r->>'isEnabled')::boolean,false),COALESCE((r->>'sortOrder')::integer,0));
 END LOOP;
 RETURN public.aka_agent_internal_send_exclusion_group(gid);
END;
$fn$;

CREATE FUNCTION public.aka_agent_internal_validate_send_exclusion_selection(p_map jsonb,p_staff bigint,p_org bigint,p_account bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE entry record; aid bigint; gid bigint; ids bigint[]; group_data jsonb;
BEGIN
 IF p_map IS NULL THEN RETURN; END IF;
 IF jsonb_typeof(p_map)<>'object' OR NOT p_map ? p_account::text THEN RAISE EXCEPTION 'send_exclusion_account_configuration_missing'; END IF;
 FOR entry IN SELECT * FROM jsonb_each(p_map) LOOP
  IF jsonb_typeof(entry.value) IS DISTINCT FROM 'object' OR NOT entry.value ? 'groupId'
    OR (entry.value->'groupId'<>'null' AND jsonb_typeof(entry.value->'groupId')<>'number') THEN RAISE EXCEPTION 'send_exclusion_group_reference_invalid'; END IF;
  aid:=entry.key::bigint;
  IF NOT EXISTS(SELECT 1 FROM public.auto_accounts WHERE id=aid AND staff_id=p_staff AND organization_id=p_org AND flatform_type='zalo' AND NOT is_delete) THEN RAISE EXCEPTION 'send_exclusion_account_not_found'; END IF;
  gid:=(entry.value->>'groupId')::bigint;
  IF gid IS NOT NULL THEN
   SELECT public.aka_agent_internal_send_exclusion_group(g.id) INTO group_data FROM public.auto_campaign_send_exclusion_groups g
    WHERE g.id=gid AND g.staff_id=p_staff AND g.organization_id=p_org AND g.account_id=aid AND NOT g.is_delete;
   IF group_data IS NULL THEN RAISE EXCEPTION 'send_exclusion_group_not_found'; END IF;
   PERFORM public.aka_agent_internal_validate_send_exclusion_rules(group_data->'rules',p_staff,p_org,aid);
  END IF;
  IF jsonb_typeof(entry.value->'blocklistIds') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'send_exclusion_blocklists_invalid'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(entry.value->'blocklistIds') v WHERE jsonb_typeof(v)<>'number' OR (v#>>'{}')::numeric<=0 OR trunc((v#>>'{}')::numeric)<>(v#>>'{}')::numeric) THEN RAISE EXCEPTION 'send_exclusion_blocklists_invalid'; END IF;
  SELECT ARRAY(SELECT DISTINCT value::bigint FROM jsonb_array_elements_text(entry.value->'blocklistIds')) INTO ids;
  IF cardinality(ids)<>(SELECT count(*) FROM public.auto_account_contact_groups g WHERE g.id=ANY(ids) AND g.account_id=aid AND g.staff_id=p_staff AND g.organization_id=p_org AND NOT g.is_delete AND g.purpose='zalo_friend_blocklist' AND g.contact_type='person') THEN RAISE EXCEPTION 'send_exclusion_blocklist_not_found'; END IF;
 END LOOP;
END;
$fn$;
CREATE FUNCTION public.auto_validate_campaign_send_exclusion() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
BEGIN
 IF TG_OP='UPDATE' AND NEW.extra_settings->'zaloSendExclusionsByAccountId' IS NOT DISTINCT FROM OLD.extra_settings->'zaloSendExclusionsByAccountId'
 AND NEW.account_id IS NOT DISTINCT FROM OLD.account_id AND NEW.staff_id IS NOT DISTINCT FROM OLD.staff_id AND NEW.organization_id IS NOT DISTINCT FROM OLD.organization_id THEN RETURN NEW; END IF;
 PERFORM public.aka_agent_internal_validate_send_exclusion_selection(NEW.extra_settings->'zaloSendExclusionsByAccountId',NEW.staff_id,NEW.organization_id,NEW.account_id);
 RETURN NEW;
END;
$fn$;
CREATE TRIGGER auto_validate_campaign_send_exclusion BEFORE INSERT OR UPDATE OF extra_settings,account_id,staff_id,organization_id ON public.auto_campaigns
 FOR EACH ROW EXECUTE FUNCTION public.auto_validate_campaign_send_exclusion();

CREATE FUNCTION public.aka_agent_campaign_send_exclusion_runtime(p_campaign_id bigint,p_account_id bigint,p_staff_id bigint,p_claim_token uuid,p_operation text,p_payload jsonb DEFAULT '{}') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET statement_timeout='15s' AS $fn$
DECLARE c public.auto_campaigns%ROWTYPE; selection jsonb; g jsonb; ids bigint[]; input public.auto_campaign_input_data%ROWTYPE;
 contact_id bigint; fact jsonb; v_uid text; days integer; last_sent timestamptz; current_time_value timestamptz:=clock_timestamp(); keys text[]; tag_ids jsonb; changed integer;
BEGIN
 SELECT campaign.* INTO c FROM public.auto_campaigns campaign JOIN public.auto_accounts a ON a.id=campaign.account_id
  JOIN public.org_staff s ON s.id=campaign.staff_id AND s.organization_id=campaign.organization_id AND s.is_active
  WHERE campaign.id=p_campaign_id AND campaign.account_id=p_account_id AND campaign.staff_id=p_staff_id AND NOT campaign.is_delete
   AND a.staff_id=p_staff_id AND a.organization_id=campaign.organization_id AND NOT a.is_delete
   AND campaign.runtime_claim_token=p_claim_token AND p_claim_token IS NOT NULL
  FOR UPDATE OF campaign;
 IF NOT FOUND THEN RAISE EXCEPTION 'send_exclusion_runtime_claim_lost'; END IF;
 IF p_operation='snapshot' THEN
  selection:=c.extra_settings->'zaloSendExclusionsByAccountId'->p_account_id::text;
  IF selection IS NULL THEN RAISE EXCEPTION 'send_exclusion_account_configuration_missing'; END IF;
  -- Other accounts are validated when saving configuration or starting their own run.
  PERFORM public.aka_agent_internal_validate_send_exclusion_selection(jsonb_build_object(p_account_id::text,selection),c.staff_id,c.organization_id,p_account_id);
  SELECT ARRAY(SELECT DISTINCT value::bigint FROM jsonb_array_elements_text(COALESCE(selection->'blocklistIds','[]'))) INTO ids;
  RETURN jsonb_build_object('catalog',public.aka_agent_internal_send_exclusion_catalog(),'group',public.aka_agent_internal_send_exclusion_group((selection->>'groupId')::bigint),
   'blocklistUids',COALESCE((SELECT jsonb_agg(DISTINCT btrim(ac.uid)) FROM public.auto_account_contact_group_members m
    JOIN public.auto_account_contacts ac ON ac.id=m.contact_id WHERE m.group_id=ANY(ids) AND NOT m.is_delete AND NOT ac.is_delete
    AND ac.account_id=p_account_id AND ac.staff_id=p_staff_id AND ac.organization_id=c.organization_id AND ac.contact_type='person' AND NULLIF(btrim(ac.uid),'') IS NOT NULL),'[]'));
 END IF;
 SELECT * INTO input FROM public.auto_campaign_input_data WHERE id=(p_payload->>'inputId')::bigint AND campaign_id=p_campaign_id AND NOT is_delete;
 IF NOT FOUND THEN RAISE EXCEPTION 'send_exclusion_input_not_found'; END IF;
 IF p_operation='pause' THEN
  UPDATE public.auto_campaign_input_data SET status='tạm dừng',note=left(p_payload->>'note',2000)
   WHERE id=input.id AND campaign_id=c.id AND status=p_payload->>'expectedStatus' AND status IN ('chờ xử lý','đang chạy') AND NOT is_delete;
  GET DIAGNOSTICS changed=ROW_COUNT;
  RETURN jsonb_build_object('changed',changed=1);
 ELSIF p_operation<>'facts' THEN RAISE EXCEPTION 'send_exclusion_operation_invalid'; END IF;
 v_uid:=COALESCE(NULLIF(btrim(p_payload->>'uid'),''),NULLIF(btrim(input.uid),''));
 IF COALESCE((p_payload->>'tags')::boolean,false) THEN
  IF v_uid IS NULL THEN tag_ids:=NULL; ELSE
   SELECT ac.id INTO contact_id FROM public.auto_account_contacts ac WHERE ac.account_id=c.account_id AND ac.staff_id=c.staff_id AND ac.organization_id=c.organization_id AND ac.contact_type='person' AND ac.uid=v_uid AND NOT ac.is_delete ORDER BY ac.id LIMIT 1;
   IF contact_id IS NOT NULL THEN
    fact:=public.aka_agent_data_group_zalo_facts(contact_id); tag_ids:=fact->'akabiz_tag_keys';
   ELSE
    SELECT COALESCE(jsonb_agg(DISTINCT t.id::text),'[]') INTO tag_ids
     FROM public.chat_zalo_account_organization b JOIN public.chat_zalo_account_conversation ac ON ac.chat_zalo_account_id=b.chat_zalo_account_id AND ac.zalo_id=v_uid AND ac.conversation_type='user'
     JOIN public.chat_zalo_conversation conv ON conv.chat_zalo_account_organization_id=b.id AND conv.chat_zalo_account_conversation_id=ac.id AND conv.organization_id=c.organization_id
     JOIN public.chat_zalo_conversation_system_tag link ON link.chat_zalo_conversation_id=conv.id AND link.organization_id=c.organization_id
     JOIN public.auto_contact_tags t ON t.id=link.auto_contact_tag_id AND t.staff_id=c.staff_id AND t.organization_id=c.organization_id AND NOT t.is_delete AND (t.auto_account_id IS NULL OR t.auto_account_id=c.account_id)
     WHERE b.auto_account_id=c.account_id AND b.organization_id=c.organization_id AND b.is_active;
   END IF;
  END IF;
 END IF;
 IF p_payload ? 'days' THEN
  days:=(p_payload->>'days')::integer;
  IF days<1 OR days>3650 THEN RAISE EXCEPTION 'send_exclusion_days_invalid'; END IF;
  keys:=public.aka_agent_internal_delivery_cooldown_target_keys('zalo_person',COALESCE(v_uid,input.uid),input.phone,input.email);
  IF cardinality(keys)>0 THEN
   SELECT max(h.created_at) INTO last_sent FROM public.aka_agent_internal_send_delivery_history(c.account_id,ARRAY['zalo_message_friend','zalo_message_stranger'],((timezone('Asia/Ho_Chi_Minh',current_time_value)::date-days)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh'),current_time_value) h WHERE h.target_keys && keys;
  END IF;
 END IF;
 RETURN jsonb_build_object('akabiz_contact',CASE WHEN tag_ids IS NULL THEN NULL ELSE jsonb_build_object('ids',tag_ids,'availableValues',(SELECT COALESCE(jsonb_agg(t.id::text),'[]') FROM public.auto_contact_tags t WHERE t.staff_id=c.staff_id AND t.organization_id=c.organization_id AND NOT t.is_delete AND (t.auto_account_id IS NULL OR t.auto_account_id=c.account_id))) END,
  'campaign_delivery',CASE WHEN days IS NULL OR cardinality(keys)=0 THEN NULL ELSE jsonb_build_object('daysSince',CASE WHEN last_sent IS NULL THEN 3651 ELSE timezone('Asia/Ho_Chi_Minh',current_time_value)::date-timezone('Asia/Ho_Chi_Minh',last_sent)::date END) END);
END;
$fn$;
-- Prevent metadata edits from silently changing groups already in use. Rename/deactivation remain explicit.
CREATE FUNCTION public.auto_guard_send_exclusion_definition() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE used boolean:=false; changed boolean:=false;
BEGIN
 IF TG_TABLE_NAME='auto_filter_fields' THEN
  SELECT EXISTS(SELECT 1 FROM public.auto_campaign_send_exclusion_rules WHERE field_id=OLD.id) INTO used;
  changed := (NEW.code,NEW.data_type,NEW.source_key,NEW.source_config,NEW.options_source,NEW.options_config) IS DISTINCT FROM (OLD.code,OLD.data_type,OLD.source_key,OLD.source_config,OLD.options_source,OLD.options_config);
 ELSIF TG_TABLE_NAME='auto_filter_operators' THEN
  SELECT EXISTS(SELECT 1 FROM public.auto_campaign_send_exclusion_rules WHERE operator_id=OLD.id) INTO used;
  changed := (NEW.code,NEW.evaluator_key) IS DISTINCT FROM (OLD.code,OLD.evaluator_key);
 ELSIF TG_TABLE_NAME='auto_filter_field_operators' THEN
  SELECT EXISTS(SELECT 1 FROM public.auto_campaign_send_exclusion_rules WHERE field_id=OLD.field_id AND operator_id=OLD.operator_id) INTO used;
  changed := NEW IS DISTINCT FROM OLD;
 ELSE
  SELECT EXISTS(SELECT 1 FROM public.auto_campaign_send_exclusion_rules WHERE field_id=OLD.field_id) INTO used;
  changed := (NEW.field_id,NEW.code,NEW.value) IS DISTINCT FROM (OLD.field_id,OLD.code,OLD.value);
 END IF;
 IF used AND changed THEN RAISE EXCEPTION 'send_exclusion_definition_in_use: create a versioned definition and explicitly migrate rules'; END IF;
 RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.auto_guard_send_exclusion_definition() FROM PUBLIC,anon,authenticated,service_role,aka_agent_chat_api;
CREATE TRIGGER auto_guard_send_exclusion_definition BEFORE UPDATE ON public.auto_filter_fields FOR EACH ROW EXECUTE FUNCTION public.auto_guard_send_exclusion_definition();
CREATE TRIGGER auto_guard_send_exclusion_definition BEFORE UPDATE ON public.auto_filter_operators FOR EACH ROW EXECUTE FUNCTION public.auto_guard_send_exclusion_definition();
CREATE TRIGGER auto_guard_send_exclusion_definition BEFORE UPDATE ON public.auto_filter_field_operators FOR EACH ROW EXECUTE FUNCTION public.auto_guard_send_exclusion_definition();
CREATE TRIGGER auto_guard_send_exclusion_definition BEFORE UPDATE ON public.auto_filter_field_options FOR EACH ROW EXECUTE FUNCTION public.auto_guard_send_exclusion_definition();

DO $acl$
DECLARE sig text;
BEGIN
 FOREACH sig IN ARRAY ARRAY[
 'aka_agent_internal_send_delivery_history(bigint,text[],timestamptz,timestamptz)', 'auto_guard_send_exclusion_definition()',
 'aka_agent_internal_send_exclusion_catalog()', 'aka_agent_internal_send_exclusion_options(bigint,bigint,bigint)',
 'aka_agent_internal_send_exclusion_group(bigint)', 'aka_agent_internal_validate_send_exclusion_rules(jsonb,bigint,bigint,bigint)',
 'aka_agent_internal_validate_send_exclusion_selection(jsonb,bigint,bigint,bigint)', 'auto_validate_campaign_send_exclusion()',
 'aka_agent_send_exclusion_groups(bigint,bigint,bigint,text,jsonb,text,text)',
 'aka_agent_campaign_send_exclusion_runtime(bigint,bigint,bigint,uuid,text,jsonb)'] LOOP
  EXECUTE 'ALTER FUNCTION public.'||sig||' OWNER TO postgres';
  EXECUTE 'REVOKE ALL ON FUNCTION public.'||sig||' FROM PUBLIC,anon,authenticated,service_role,aka_agent_chat_api';
 END LOOP;
END;
$acl$;
GRANT EXECUTE ON FUNCTION public.aka_agent_send_exclusion_groups(bigint,bigint,bigint,text,jsonb,text,text) TO anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.aka_agent_campaign_send_exclusion_runtime(bigint,bigint,bigint,uuid,text,jsonb) TO anon,authenticated,service_role,aka_agent_chat_api;
-- New RPC signatures require a schema-cache refresh on initial deployment only.
NOTIFY pgrst, 'reload schema';
COMMIT;
