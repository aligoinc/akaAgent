-- v290: set-based Data Group profiles and one tag projection per changed contact.
-- Bodies captured from linked akachat production in this task. Signatures/ACLs stay unchanged.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='120s';
DO $preflight$ BEGIN
IF to_regprocedure('public.aka_agent_list_data_group_members_v205_internal(bigint,bigint,bigint,text,bigint[],boolean,text[],text[],text,bigint[],bigint[],bigint[],integer,integer)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.aka_agent_list_data_group_members_v205_internal(bigint,bigint,bigint,text,bigint[],boolean,text[],text[],text,bigint[],bigint[],bigint[],integer,integer)'))) IS DISTINCT FROM '778357ef05c9261d77db7faddf241046' THEN RAISE EXCEPTION 'v290 RPC drift: public.aka_agent_list_data_group_members_v205_internal(bigint,bigint,bigint,text,bigint[],boolean,text[],text[],text,bigint[],bigint[],bigint[],integer,integer)'; END IF;
IF to_regprocedure('public.aka_agent_list_data_group_members_v2(bigint,bigint,bigint,text,bigint[],boolean,text[],text[],text,bigint[],bigint[],bigint[],bigint[],integer,integer,text,text)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.aka_agent_list_data_group_members_v2(bigint,bigint,bigint,text,bigint[],boolean,text[],text[],text,bigint[],bigint[],bigint[],bigint[],integer,integer,text,text)'))) IS DISTINCT FROM 'c5cf3b29b5721aff8a0b605b9d2f57cc' THEN RAISE EXCEPTION 'v290 RPC drift: public.aka_agent_list_data_group_members_v2(bigint,bigint,bigint,text,bigint[],boolean,text[],text[],text,bigint[],bigint[],bigint[],bigint[],integer,integer,text,text)'; END IF;
IF to_regprocedure('public.aka_agent_refresh_contact_chat_tags(bigint)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.aka_agent_refresh_contact_chat_tags(bigint)'))) IS DISTINCT FROM 'b581724c1c84c68cf997043039555611' THEN RAISE EXCEPTION 'v290 RPC drift: public.aka_agent_refresh_contact_chat_tags(bigint)'; END IF;
IF to_regprocedure('public.aka_agent_sync_contact_chat_tag_delta()') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.aka_agent_sync_contact_chat_tag_delta()'))) IS DISTINCT FROM '10aa869d5625e0afac011344a9e92c52' THEN RAISE EXCEPTION 'v290 RPC drift: public.aka_agent_sync_contact_chat_tag_delta()'; END IF;
IF to_regprocedure('public.aka_agent_mutate_contact_tags(bigint,bigint,bigint[],bigint[],text,text,text)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.aka_agent_mutate_contact_tags(bigint,bigint,bigint[],bigint[],text,text,text)'))) IS DISTINCT FROM 'decf57350ad6e47478d342745be552d4' THEN RAISE EXCEPTION 'v290 RPC drift: public.aka_agent_mutate_contact_tags(bigint,bigint,bigint[],bigint[],text,text,text)'; END IF;
IF to_regprocedure('public.aka_agent_dynamic_filter_chat_event()') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.aka_agent_dynamic_filter_chat_event()'))) IS DISTINCT FROM 'ea43ac7d147b5bc86a38f3936bcb9cee' THEN RAISE EXCEPTION 'v290 RPC drift: public.aka_agent_dynamic_filter_chat_event()'; END IF;
IF to_regprocedure('public.aka_agent_data_group_zalo_facts(bigint)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.aka_agent_data_group_zalo_facts(bigint)'))) IS DISTINCT FROM '9cac9151db1cd2e208f5f0f160e7100e' THEN RAISE EXCEPTION 'v290 RPC drift: public.aka_agent_data_group_zalo_facts(bigint)'; END IF;
IF to_regprocedure('public.aka_agent_enqueue_data_group_chat_user(bigint,text,bigint)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.aka_agent_enqueue_data_group_chat_user(bigint,text,bigint)'))) IS DISTINCT FROM '3dface1e4b48d8c92a5100dadaaf4ebb' THEN RAISE EXCEPTION 'v290 RPC drift: public.aka_agent_enqueue_data_group_chat_user(bigint,text,bigint)'; END IF;
IF to_regprocedure('public.aka_agent_dynamic_filter_enqueue_contact()') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.aka_agent_dynamic_filter_enqueue_contact()'))) IS DISTINCT FROM '1dfe012e1407c6401e299fd81b0d9447' THEN RAISE EXCEPTION 'v290 RPC drift: public.aka_agent_dynamic_filter_enqueue_contact()'; END IF;
IF to_regprocedure('public.auto_assert_automation_identity(bigint,bigint,text,text)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.auto_assert_automation_identity(bigint,bigint,text,text)'))) IS DISTINCT FROM '5a9a503db72b965eb644739f5f60905d' THEN RAISE EXCEPTION 'v290 RPC drift: public.auto_assert_automation_identity(bigint,bigint,text,text)'; END IF;
IF to_regprocedure('public.aka_agent_process_data_group_dynamic_filters_core(bigint,bigint,integer)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.aka_agent_process_data_group_dynamic_filters_core(bigint,bigint,integer)'))) IS DISTINCT FROM 'd40d1a23943ae1a4a66339504382526f' THEN RAISE EXCEPTION 'v290 RPC drift: public.aka_agent_process_data_group_dynamic_filters_core(bigint,bigint,integer)'; END IF;
IF to_regprocedure('public.aka_agent_run_data_group_dynamic_filter_worker(integer,integer)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.aka_agent_run_data_group_dynamic_filter_worker(integer,integer)'))) IS DISTINCT FROM '56510e2f6e8450b684486336e773746d' THEN RAISE EXCEPTION 'v290 RPC drift: public.aka_agent_run_data_group_dynamic_filter_worker(integer,integer)'; END IF;
END; $preflight$;

CREATE OR REPLACE FUNCTION public.aka_agent_list_data_group_members_v205_internal(p_staff_id bigint, p_organization_id bigint, p_group_id bigint, p_search text DEFAULT NULL::text, p_account_ids bigint[] DEFAULT NULL::bigint[], p_include_accountless boolean DEFAULT true, p_contact_types text[] DEFAULT NULL::text[], p_flatform_types text[] DEFAULT NULL::text[], p_status text DEFAULT 'all'::text, p_dataset_ids bigint[] DEFAULT NULL::bigint[], p_ids bigint[] DEFAULT NULL::bigint[], p_exclude_ids bigint[] DEFAULT NULL::bigint[], p_offset integer DEFAULT 0, p_limit integer DEFAULT 100)
 RETURNS TABLE(id bigint, group_id bigint, contact_id bigint, name text, uid text, url text, phone text, email text, info1 text, info2 text, info3 text, info4 text, info5 text, contact_type text, flatform_type text, source_account_id bigint, source_account_name text, source_account_deleted boolean, dataset_ids bigint[], dataset_names text[], is_friend boolean, is_joined boolean, is_delete boolean, change_revision bigint, provenance jsonb, created_at timestamp with time zone, updated_at timestamp with time zone, primary_origin_id bigint, source_category_item_id bigint, source_code text, source_name text, source_automation_id bigint, source_automation_name text, total_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  PERFORM public.aka_agent_internal_require_staff_tenant(
    p_staff_id, p_organization_id
  );
  IF COALESCE(p_status, 'all') NOT IN (
    'all', 'active', 'inactive', 'friend', 'stranger', 'joined', 'not_joined', 'request_sent', 'request_received'
  )
    OR COALESCE(p_offset, 0) < 0
    OR COALESCE(p_limit, 100) NOT BETWEEN 1 AND 1000
  THEN
    RAISE EXCEPTION 'invalid_data_group_member_query';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.auto_account_contact_groups AS contact_group
    WHERE contact_group.id = p_group_id
      AND contact_group.staff_id = p_staff_id
      AND contact_group.organization_id = p_organization_id
      AND contact_group.purpose = 'data_group'
      AND contact_group.is_delete = false
  ) THEN
    RAISE EXCEPTION 'data_group_not_found';
  END IF;

  RETURN QUERY
  WITH filtered AS (
    SELECT
      member.id AS selected_member_id,
      member.group_id AS selected_group_id,
      member.contact_id,
      member.created_at AS member_created_at,
      member.updated_at AS member_updated_at,
      member.is_delete AS member_is_delete,
      member.change_revision,
      member.primary_origin_id,
      contact.name,
      contact.uid,
      contact.url,
      contact.phone,
      contact.email,
      contact.extra_data,
      contact.contact_type,
      contact.flatform_type,
      contact.account_id,
      contact.is_friend,
      contact.is_joined,
      account.name AS selected_account_name,
      COALESCE(account.is_delete, false) AS selected_account_deleted
    FROM public.auto_account_contact_group_members AS member
    JOIN public.auto_account_contacts AS contact
      ON contact.id = member.contact_id
    LEFT JOIN public.auto_accounts AS account
      ON account.id = contact.account_id
    LEFT JOIN public.zalo_users z ON z.account_id=contact.account_id AND z.zalo_uid=contact.uid
      AND z.staff_id=contact.staff_id AND z.organization_id=contact.organization_id AND contact.flatform_type='zalo'
    LEFT JOIN public.chat_zalo_account_organization b ON b.auto_account_id=contact.account_id
      AND b.organization_id=contact.organization_id AND b.is_active AND contact.flatform_type='zalo'
    LEFT JOIN public.chat_zalo_account_user u ON u.chat_zalo_account_id=b.chat_zalo_account_id
      AND u.zalo_id=contact.uid AND contact.contact_type='person'
    LEFT JOIN public.category_item status ON status.id=u.friendship_status_category_item_id
    WHERE member.group_id = p_group_id
      AND contact.staff_id = p_staff_id
      AND contact.organization_id = p_organization_id
      AND member.is_delete = false
      AND (
        COALESCE(p_status, 'all') = 'all'
        OR (
          COALESCE(p_status, 'all') = 'active' AND (
            (contact.contact_type = 'person' AND contact.is_friend = true)
            OR (contact.contact_type = 'group' AND contact.is_joined = true)
            OR contact.contact_type NOT IN ('person', 'group')
          )
        )
        OR (
          COALESCE(p_status, 'all') = 'inactive' AND (
            (contact.contact_type = 'person' AND contact.is_friend = false)
            OR (contact.contact_type = 'group' AND contact.is_joined = false)
          )
        )
        OR (
          COALESCE(p_status, 'all') = 'friend'
          AND contact.contact_type = 'person'
          AND CASE WHEN contact.flatform_type='zalo' THEN (CASE WHEN contact.flatform_type='zalo' AND contact.contact_type='person' THEN
        CASE WHEN u.id IS NOT NULL THEN CASE WHEN status.code IN ('friend','request_sent','request_received') THEN status.code ELSE 'stranger' END
          WHEN contact.is_friend IS TRUE THEN 'friend'
          WHEN COALESCE(contact.extra_data->>'friendRequestReceived',contact.extra_data->>'friend_request_received','false')='true' THEN 'request_received'
          WHEN COALESCE(contact.extra_data->>'friendRequestSent',contact.extra_data->>'friend_request_sent','false')='true' THEN 'request_sent'
          ELSE 'stranger' END END)='friend' ELSE contact.is_friend=true END
        )
        OR (
          COALESCE(p_status, 'all') = 'stranger'
          AND contact.contact_type = 'person'
          AND CASE WHEN contact.flatform_type='zalo' THEN (CASE WHEN contact.flatform_type='zalo' AND contact.contact_type='person' THEN
        CASE WHEN u.id IS NOT NULL THEN CASE WHEN status.code IN ('friend','request_sent','request_received') THEN status.code ELSE 'stranger' END
          WHEN contact.is_friend IS TRUE THEN 'friend'
          WHEN COALESCE(contact.extra_data->>'friendRequestReceived',contact.extra_data->>'friend_request_received','false')='true' THEN 'request_received'
          WHEN COALESCE(contact.extra_data->>'friendRequestSent',contact.extra_data->>'friend_request_sent','false')='true' THEN 'request_sent'
          ELSE 'stranger' END END)='stranger' ELSE contact.is_friend=false END
        )
        OR (p_status IN ('request_sent','request_received') AND contact.flatform_type='zalo' AND contact.contact_type='person' AND (CASE WHEN contact.flatform_type='zalo' AND contact.contact_type='person' THEN
        CASE WHEN u.id IS NOT NULL THEN CASE WHEN status.code IN ('friend','request_sent','request_received') THEN status.code ELSE 'stranger' END
          WHEN contact.is_friend IS TRUE THEN 'friend'
          WHEN COALESCE(contact.extra_data->>'friendRequestReceived',contact.extra_data->>'friend_request_received','false')='true' THEN 'request_received'
          WHEN COALESCE(contact.extra_data->>'friendRequestSent',contact.extra_data->>'friend_request_sent','false')='true' THEN 'request_sent'
          ELSE 'stranger' END END)=p_status)
        OR (
          COALESCE(p_status, 'all') = 'joined'
          AND contact.contact_type = 'group'
          AND contact.is_joined = true
        )
        OR (
          COALESCE(p_status, 'all') = 'not_joined'
          AND contact.contact_type = 'group'
          AND contact.is_joined = false
        )
      )
      AND (
        NULLIF(btrim(COALESCE(p_search, '')), '') IS NULL
        OR contact.name ILIKE '%' || btrim(p_search) || '%'
        OR (CASE WHEN contact.flatform_type='zalo' THEN COALESCE(NULLIF(u.zalo_name,''),NULLIF(z.zalo_name,''),contact.name) END) ILIKE '%' || btrim(p_search) || '%'
        OR (CASE WHEN contact.flatform_type='zalo' THEN COALESCE(NULLIF(u.display_name,''),NULLIF(u.zalo_name,''),NULLIF(z.display_name,''),NULLIF(z.zalo_name,''),contact.name) END) ILIKE '%' || btrim(p_search) || '%'
        OR contact.uid ILIKE '%' || btrim(p_search) || '%'
        OR contact.phone ILIKE '%' || btrim(p_search) || '%'
        OR contact.email ILIKE '%' || btrim(p_search) || '%'
      )
      AND (
        p_account_ids IS NULL
        OR contact.account_id = ANY(p_account_ids)
        OR (
          COALESCE(p_include_accountless, true)
          AND contact.account_id IS NULL
        )
      )
      AND (
        COALESCE(p_include_accountless, true)
        OR contact.account_id IS NOT NULL
      )
      AND (
        p_contact_types IS NULL
        OR contact.contact_type = ANY(p_contact_types)
      )
      AND (
        p_flatform_types IS NULL
        OR contact.flatform_type = ANY(p_flatform_types)
      )
      AND (p_ids IS NULL OR member.id = ANY(p_ids))
      AND (
        p_exclude_ids IS NULL
        OR NOT (member.id = ANY(p_exclude_ids))
      )
      AND (
        p_dataset_ids IS NULL OR EXISTS (
          SELECT 1
          FROM public.auto_account_contact_group_member_origins AS dataset_origin
          WHERE dataset_origin.membership_id = member.id
            AND dataset_origin.dataset_id = ANY(p_dataset_ids)
            AND dataset_origin.is_current = true
        )
      )
  ), paged AS MATERIALIZED (
    SELECT filtered.*,count(*) OVER ()::bigint AS selected_total_count
    FROM filtered
    ORDER BY filtered.member_created_at DESC,filtered.selected_member_id DESC
    OFFSET COALESCE(p_offset,0) LIMIT COALESCE(p_limit,100)
  )
  SELECT
    filtered.selected_member_id,
    filtered.selected_group_id,
    filtered.contact_id,
    filtered.name,
    filtered.uid,
    filtered.url,
    filtered.phone,
    filtered.email,
    NULLIF(filtered.extra_data ->> 'info1', ''),
    NULLIF(filtered.extra_data ->> 'info2', ''),
    NULLIF(filtered.extra_data ->> 'info3', ''),
    NULLIF(filtered.extra_data ->> 'info4', ''),
    NULLIF(filtered.extra_data ->> 'info5', ''),
    filtered.contact_type,
    filtered.flatform_type,
    filtered.account_id::bigint,
    filtered.selected_account_name,
    filtered.selected_account_deleted,
    COALESCE((
      SELECT array_agg(current_dataset.id ORDER BY current_dataset.id)
      FROM (
        SELECT DISTINCT dataset.id, dataset.name
        FROM public.auto_account_contact_group_member_origins AS origin
        JOIN public.auto_account_contacts_dataset AS dataset
          ON dataset.id = origin.dataset_id
        WHERE origin.membership_id = filtered.selected_member_id
          AND origin.is_current = true
          AND dataset.is_delete = false
      ) AS current_dataset
    ), '{}'::bigint[]),
    COALESCE((
      SELECT array_agg(current_dataset.name ORDER BY current_dataset.id)
      FROM (
        SELECT DISTINCT dataset.id, dataset.name
        FROM public.auto_account_contact_group_member_origins AS origin
        JOIN public.auto_account_contacts_dataset AS dataset
          ON dataset.id = origin.dataset_id
        WHERE origin.membership_id = filtered.selected_member_id
          AND origin.is_current = true
          AND dataset.is_delete = false
      ) AS current_dataset
    ), '{}'::text[]),
    filtered.is_friend,
    filtered.is_joined,
    filtered.member_is_delete,
    filtered.change_revision,
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', origin.id,
        'membership_id', origin.membership_id,
        'kind', origin.kind,
        'relationship_kind', origin.relationship_kind,
        'dataset_id', origin.dataset_id,
        'batch_id', origin.batch_id,
        'source_account_id', origin.source_account_id,
        'source_account_name', source_account.name,
        'source_account_deleted', COALESCE(source_account.is_delete, false),
        'automation_detail_id', origin.automation_detail_id,
        'automation_id', automation_detail.automation_id,
        'automation_name', automation.name,
        'automation_detail_status', automation_detail.status,
        'source_campaign_id', automation_detail.source_campaign_id,
        'source_campaign_name', source_campaign.name,
        'target_campaign_id', automation_detail.target_campaign_id,
        'target_campaign_name', target_campaign.name,
        'source_name_snapshot', origin.source_name_snapshot,
        'is_current', origin.is_current,
        'created_at', origin.created_at,
        'updated_at', origin.updated_at
      ) ORDER BY origin.created_at, origin.id)
      FROM public.auto_account_contact_group_member_origins AS origin
      LEFT JOIN public.auto_accounts AS source_account
        ON source_account.id = origin.source_account_id
      LEFT JOIN public.auto_automation_detail AS automation_detail
        ON automation_detail.id = origin.automation_detail_id
      LEFT JOIN public.auto_automation AS automation
        ON automation.id = automation_detail.automation_id
      LEFT JOIN public.auto_campaigns AS source_campaign
        ON source_campaign.id = automation_detail.source_campaign_id
      LEFT JOIN public.auto_campaigns AS target_campaign
        ON target_campaign.id = automation_detail.target_campaign_id
      WHERE origin.membership_id = filtered.selected_member_id
    ), '[]'::jsonb),
    filtered.member_created_at,
    filtered.member_updated_at,
    primary_source.primary_origin_id,
    primary_source.source_category_item_id,
    primary_source.source_code,
    primary_source.source_name,
    primary_source.source_automation_id,
    primary_source.source_automation_name,
    filtered.selected_total_count
  FROM paged AS filtered
  LEFT JOIN LATERAL (
    SELECT
      primary_origin.id AS primary_origin_id,
      category_item.id AS source_category_item_id,
      category_item.code AS source_code,
      category_item.name AS source_name,
      automation.id AS source_automation_id,
      CASE WHEN category_item.code = 'automation' THEN COALESCE(
        NULLIF(btrim(automation.name), ''),
        NULLIF(btrim(primary_origin.source_name_snapshot), '')
      ) END AS source_automation_name
    FROM public.auto_account_contact_group_member_origins AS primary_origin
    JOIN public.category_item AS category_item
      ON category_item.id = primary_origin.source_category_item_id
     AND category_item.is_active = true
     AND category_item.managed_by = 'system'
     AND category_item.code =
       public.aka_agent_data_group_source_code(primary_origin.kind)
    JOIN public.category_type AS category_type
      ON category_type.id = category_item.category_type_id
     AND category_type.namespace = 'common'
     AND category_type.code = 'data_source'
     AND category_type.managed_by = 'system'
     AND category_type.is_active = true
    LEFT JOIN public.auto_automation_detail AS automation_detail
      ON automation_detail.id = primary_origin.automation_detail_id
     AND automation_detail.staff_id = p_staff_id
     AND automation_detail.organization_id = p_organization_id
    LEFT JOIN public.auto_automation AS automation
      ON automation.id = automation_detail.automation_id
     AND automation.staff_id = p_staff_id
     AND automation.organization_id = p_organization_id
    WHERE primary_origin.id = filtered.primary_origin_id
      AND primary_origin.membership_id = filtered.selected_member_id
      AND primary_origin.is_current = true
    LIMIT 1
  ) AS primary_source ON true
  ORDER BY filtered.member_created_at DESC, filtered.selected_member_id DESC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.aka_agent_list_data_group_members_v2(p_staff_id bigint, p_organization_id bigint, p_group_id bigint, p_search text, p_account_ids bigint[], p_include_accountless boolean, p_contact_types text[], p_flatform_types text[], p_status text, p_dataset_ids bigint[], p_data_type_category_item_ids bigint[], p_ids bigint[], p_exclude_ids bigint[], p_offset integer, p_limit integer, p_auth_username text, p_auth_password text)
 RETURNS SETOF jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET statement_timeout TO '60s'
AS $function$
BEGIN
  RETURN QUERY SELECT to_jsonb(m) || jsonb_build_object('zalo_name',CASE WHEN contact.flatform_type='zalo' THEN COALESCE(NULLIF(u.zalo_name,''),NULLIF(z.zalo_name,''),contact.name) END,'display_name',CASE WHEN contact.flatform_type='zalo' THEN COALESCE(NULLIF(u.display_name,''),NULLIF(u.zalo_name,''),NULLIF(z.display_name,''),NULLIF(z.zalo_name,''),contact.name) END,'zalo_friend_status',CASE WHEN contact.flatform_type='zalo' AND contact.contact_type='person' THEN
        CASE WHEN u.id IS NOT NULL THEN CASE WHEN status.code IN ('friend','request_sent','request_received') THEN status.code ELSE 'stranger' END
          WHEN contact.is_friend IS TRUE THEN 'friend'
          WHEN COALESCE(contact.extra_data->>'friendRequestReceived',contact.extra_data->>'friend_request_received','false')='true' THEN 'request_received'
          WHEN COALESCE(contact.extra_data->>'friendRequestSent',contact.extra_data->>'friend_request_sent','false')='true' THEN 'request_sent'
          ELSE 'stranger' END END)
  FROM public.aka_agent_list_data_group_members(p_staff_id,p_organization_id,p_group_id,p_search,p_account_ids,p_include_accountless,p_contact_types,p_flatform_types,p_status,p_dataset_ids,p_data_type_category_item_ids,p_ids,p_exclude_ids,p_offset,p_limit,p_auth_username,p_auth_password) m
  JOIN public.auto_account_contacts contact ON contact.id=m.contact_id
  LEFT JOIN public.zalo_users z ON z.account_id=contact.account_id AND z.zalo_uid=contact.uid
      AND z.staff_id=contact.staff_id AND z.organization_id=contact.organization_id AND contact.flatform_type='zalo'
    LEFT JOIN public.chat_zalo_account_organization b ON b.auto_account_id=contact.account_id
      AND b.organization_id=contact.organization_id AND b.is_active AND contact.flatform_type='zalo'
    LEFT JOIN public.chat_zalo_account_user u ON u.chat_zalo_account_id=b.chat_zalo_account_id
      AND u.zalo_id=contact.uid AND contact.contact_type='person'
    LEFT JOIN public.category_item status ON status.id=u.friendship_status_category_item_id
  ORDER BY m.created_at DESC,m.id DESC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.aka_agent_refresh_contact_chat_tags(p_contact_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_tags bigint[]; v_previous text;
BEGIN
  IF current_setting('aka_agent.chat_tag_writeback',true)='on' THEN RETURN; END IF;
  -- Read canonical tags only after owning the row, so a waiting mirror cannot
  -- overwrite tags committed while it was waiting.
  PERFORM 1 FROM public.auto_account_contacts WHERE id=p_contact_id AND NOT is_delete FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT ARRAY(
    SELECT t.id FROM public.chat_zalo_conversation_system_tag link
    JOIN public.auto_contact_tags t ON t.id=link.auto_contact_tag_id
    WHERE link.chat_zalo_conversation_id=conv.id AND link.organization_id=c.organization_id
      AND t.staff_id=c.staff_id AND t.organization_id=c.organization_id AND NOT t.is_delete
      AND (t.auto_account_id IS NULL OR t.auto_account_id=c.account_id)
    ORDER BY t.id
  ) INTO v_tags
  FROM public.auto_account_contacts c
    JOIN public.chat_zalo_account_organization b ON b.auto_account_id=c.account_id
      AND b.organization_id=c.organization_id AND b.is_active AND c.flatform_type='zalo'
    JOIN public.chat_zalo_account_conversation ac ON ac.chat_zalo_account_id=b.chat_zalo_account_id
      AND ac.zalo_id=c.uid AND ac.conversation_type=CASE WHEN c.contact_type='person' THEN 'user' WHEN c.contact_type='group' THEN 'group' END
    JOIN public.chat_zalo_conversation conv ON conv.chat_zalo_account_organization_id=b.id
      AND conv.chat_zalo_account_conversation_id=ac.id AND conv.organization_id=c.organization_id
  WHERE c.id=p_contact_id;
  IF NOT FOUND THEN RETURN; END IF;
  v_previous:=current_setting('aka_agent.chat_tag_projection',true);
  PERFORM set_config('aka_agent.chat_tag_projection','on',true);
  BEGIN
    UPDATE public.auto_account_contacts SET akabiz_tag_ids=v_tags,updated_at=clock_timestamp()
      WHERE id=p_contact_id AND NOT is_delete AND akabiz_tag_ids IS DISTINCT FROM v_tags;
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('aka_agent.chat_tag_projection',COALESCE(v_previous,''),true);
    RAISE;
  END;
  PERFORM set_config('aka_agent.chat_tag_projection',COALESCE(v_previous,''),true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.aka_agent_sync_contact_chat_tag_delta()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_conversation_id bigint; v_before bigint[];
  v_added bigint[]; v_removed bigint[]; v_previous text;
BEGIN
  IF current_setting('aka_agent.chat_tag_projection',true)='on'
    OR NEW.is_delete OR NEW.flatform_type IS DISTINCT FROM 'zalo' THEN RETURN NEW; END IF;
  v_before := CASE WHEN TG_OP='INSERT' THEN '{}'::bigint[] ELSE COALESCE(OLD.akabiz_tag_ids,'{}'::bigint[]) END;
  IF TG_OP='UPDATE' AND NEW.akabiz_tag_ids IS NOT DISTINCT FROM OLD.akabiz_tag_ids THEN RETURN NEW; END IF;
  SELECT conv.id INTO v_conversation_id
  FROM public.auto_account_contacts c
    JOIN public.chat_zalo_account_organization b ON b.auto_account_id=c.account_id
      AND b.organization_id=c.organization_id AND b.is_active AND c.flatform_type='zalo'
    JOIN public.chat_zalo_account_conversation ac ON ac.chat_zalo_account_id=b.chat_zalo_account_id
      AND ac.zalo_id=c.uid AND ac.conversation_type=CASE WHEN c.contact_type='person' THEN 'user' WHEN c.contact_type='group' THEN 'group' END
    JOIN public.chat_zalo_conversation conv ON conv.chat_zalo_account_organization_id=b.id
      AND conv.chat_zalo_account_conversation_id=ac.id AND conv.organization_id=c.organization_id
  WHERE c.id=NEW.id;
  IF v_conversation_id IS NULL THEN RETURN NEW; END IF;
  SELECT COALESCE(array_agg(DISTINCT k),'{}'::bigint[]) INTO v_added
    FROM unnest(COALESCE(NEW.akabiz_tag_ids,'{}'::bigint[])) k WHERE NOT k=ANY(v_before);
  SELECT COALESCE(array_agg(DISTINCT k),'{}'::bigint[]) INTO v_removed
    FROM unnest(v_before) k WHERE NOT k=ANY(COALESCE(NEW.akabiz_tag_ids,'{}'::bigint[]));
  IF EXISTS (SELECT 1 FROM unnest(v_added) k WHERE NOT EXISTS (
    SELECT 1 FROM public.auto_contact_tags t WHERE t.id=k AND t.staff_id=NEW.staff_id
      AND t.organization_id=NEW.organization_id AND NOT t.is_delete
      AND (t.auto_account_id IS NULL OR t.auto_account_id=NEW.account_id)
  )) THEN RAISE EXCEPTION 'contact_tag_scope_invalid'; END IF;
  v_previous := current_setting('aka_agent.chat_tag_writeback',true);
  PERFORM set_config('aka_agent.chat_tag_writeback','on',true);
  BEGIN
    DELETE FROM public.chat_zalo_conversation_system_tag link USING public.auto_contact_tags t
      WHERE link.chat_zalo_conversation_id=v_conversation_id AND link.organization_id=NEW.organization_id
        AND link.auto_contact_tag_id=t.id AND t.id=ANY(v_removed)
        AND t.staff_id=NEW.staff_id AND t.organization_id=NEW.organization_id;
    INSERT INTO public.chat_zalo_conversation_system_tag(organization_id,chat_zalo_conversation_id,auto_contact_tag_id,assigned_by_org_staff_id)
      SELECT NEW.organization_id,v_conversation_id,k,NEW.staff_id FROM unnest(v_added) k
      ON CONFLICT(chat_zalo_conversation_id,auto_contact_tag_id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('aka_agent.chat_tag_writeback',COALESCE(v_previous,''),true);
    RAISE;
  END;
  PERFORM set_config('aka_agent.chat_tag_writeback',COALESCE(v_previous,''),true);
  PERFORM public.aka_agent_refresh_contact_chat_tags(NEW.id);
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.aka_agent_mutate_contact_tags(p_staff_id bigint, p_organization_id bigint, p_contact_ids bigint[], p_tag_ids bigint[], p_auth_username text, p_auth_password text, p_mode text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET statement_timeout TO '60s'
AS $function$
DECLARE v_contact public.auto_account_contacts%ROWTYPE; v_tags bigint[];
  v_previous_batch text; v_chat_account_id bigint; v_zalo_uid text; v_conversation_type text;
  v_conversation_id bigint; v_changed integer; v_count integer:=0;
BEGIN
  PERFORM public.auto_assert_automation_identity(p_staff_id,p_organization_id,p_auth_username,p_auth_password);
  IF p_mode IS NULL OR p_mode NOT IN ('add','remove') THEN RAISE EXCEPTION 'contact_tag_mode_invalid'; END IF;
  IF COALESCE(cardinality(p_contact_ids),0)>100
    THEN RAISE EXCEPTION 'contact_tag_batch_limit_exceeded'; END IF;
  SELECT COALESCE(array_agg(DISTINCT id ORDER BY id),'{}'::bigint[]) INTO v_tags
    FROM public.auto_contact_tags WHERE id=ANY(p_tag_ids) AND staff_id=p_staff_id
      AND organization_id=p_organization_id AND (p_mode='remove' OR NOT is_delete);
  IF cardinality(v_tags)=0 THEN RETURN jsonb_build_object('success',true,'count',0); END IF;
  FOR v_contact IN SELECT * FROM public.auto_account_contacts
    WHERE id=ANY(p_contact_ids) AND staff_id=p_staff_id AND organization_id=p_organization_id AND NOT is_delete
    ORDER BY id
  LOOP
    IF p_mode='add' AND EXISTS (SELECT 1 FROM public.auto_contact_tags t WHERE t.id=ANY(v_tags)
      AND t.auto_account_id IS NOT NULL AND t.auto_account_id IS DISTINCT FROM v_contact.account_id)
      THEN RAISE EXCEPTION 'contact_tag_scope_invalid'; END IF;
    SELECT conv.id,ac.chat_zalo_account_id,ac.zalo_id,ac.conversation_type
      INTO v_conversation_id,v_chat_account_id,v_zalo_uid,v_conversation_type
    FROM public.auto_account_contacts c
    JOIN public.chat_zalo_account_organization b ON b.auto_account_id=c.account_id
      AND b.organization_id=c.organization_id AND b.is_active AND c.flatform_type='zalo'
    JOIN public.chat_zalo_account_conversation ac ON ac.chat_zalo_account_id=b.chat_zalo_account_id
      AND ac.zalo_id=c.uid AND ac.conversation_type=CASE WHEN c.contact_type='person' THEN 'user' WHEN c.contact_type='group' THEN 'group' END
    JOIN public.chat_zalo_conversation conv ON conv.chat_zalo_account_organization_id=b.id
      AND conv.chat_zalo_account_conversation_id=ac.id AND conv.organization_id=c.organization_id
    WHERE c.id=v_contact.id;
    IF v_conversation_id IS NOT NULL THEN
      -- Suppress per-tag mirrors/queue writes only inside this batch. Restore
      -- before the single contact event and projection, including on errors.
      v_previous_batch:=current_setting('aka_agent.chat_tag_batch',true);
      PERFORM set_config('aka_agent.chat_tag_batch','on',true);
      BEGIN
        IF p_mode='add' THEN
          INSERT INTO public.chat_zalo_conversation_system_tag(organization_id,chat_zalo_conversation_id,auto_contact_tag_id,assigned_by_org_staff_id)
            SELECT p_organization_id,v_conversation_id,k,p_staff_id FROM unnest(v_tags) k
            ON CONFLICT(chat_zalo_conversation_id,auto_contact_tag_id) DO NOTHING;
        ELSE
          DELETE FROM public.chat_zalo_conversation_system_tag
            WHERE chat_zalo_conversation_id=v_conversation_id AND organization_id=p_organization_id AND auto_contact_tag_id=ANY(v_tags);
        END IF;
        GET DIAGNOSTICS v_changed=ROW_COUNT;
      EXCEPTION WHEN OTHERS THEN
        PERFORM set_config('aka_agent.chat_tag_batch',COALESCE(v_previous_batch,''),true);
        RAISE;
      END;
      PERFORM set_config('aka_agent.chat_tag_batch',COALESCE(v_previous_batch,''),true);
      IF v_changed>0 AND v_conversation_type='user' THEN
        PERFORM public.aka_agent_enqueue_data_group_chat_user(v_chat_account_id,v_zalo_uid,p_organization_id);
      END IF;
      PERFORM public.aka_agent_refresh_contact_chat_tags(v_contact.id);
    ELSE
      UPDATE public.auto_account_contacts SET akabiz_tag_ids=ARRAY(
        SELECT DISTINCT k FROM unnest(COALESCE(akabiz_tag_ids,'{}'::bigint[])||CASE WHEN p_mode='add' THEN v_tags ELSE '{}'::bigint[] END) k
        WHERE p_mode='add' OR NOT k=ANY(v_tags) ORDER BY k
      ),updated_at=clock_timestamp()
      WHERE id=v_contact.id AND NOT is_delete AND CASE WHEN p_mode='add'
        THEN NOT COALESCE(akabiz_tag_ids,'{}'::bigint[]) @> v_tags
        ELSE COALESCE(akabiz_tag_ids,'{}'::bigint[]) && v_tags END;
      GET DIAGNOSTICS v_changed=ROW_COUNT;
    END IF;
    IF v_changed>0 THEN v_count:=v_count+1; END IF;
  END LOOP;
  RETURN jsonb_build_object('success',true,'count',v_count);
END;
$function$;

CREATE OR REPLACE FUNCTION public.aka_agent_dynamic_filter_chat_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_row jsonb; v_old jsonb; v_target record;
BEGIN
  IF current_setting('aka_agent.chat_tag_batch',true)='on' AND TG_TABLE_NAME='chat_zalo_conversation_system_tag' THEN
    IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
  END IF;
  v_row:=CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  IF TG_OP='UPDATE' THEN
    v_old:=to_jsonb(OLD);
    IF TG_TABLE_NAME='chat_zalo_account_user' AND v_row->'friendship_status_category_item_id' IS NOT DISTINCT FROM v_old->'friendship_status_category_item_id' THEN RETURN NEW; END IF;
    IF TG_TABLE_NAME<>'chat_zalo_account_user' AND (v_row - ARRAY['updated_at','created_at']) IS NOT DISTINCT FROM (v_old - ARRAY['updated_at','created_at']) THEN RETURN NEW; END IF;
  END IF;
  IF TG_TABLE_NAME='chat_zalo_account_user' THEN
    PERFORM public.aka_agent_enqueue_data_group_chat_user((v_row->>'chat_zalo_account_id')::bigint,v_row->>'zalo_id');
  ELSE
    FOR v_target IN
      SELECT DISTINCT ac.chat_zalo_account_id,ac.zalo_id,c.organization_id,c.id conversation_id,ac.conversation_type
      FROM public.chat_zalo_conversation c JOIN public.chat_zalo_account_conversation ac ON ac.id=c.chat_zalo_account_conversation_id
      WHERE c.id IN ((v_row->>'chat_zalo_conversation_id')::bigint,(v_old->>'chat_zalo_conversation_id')::bigint)
        AND ac.conversation_type IN ('user','group')
    LOOP
      -- Enqueue/materialize first, then mirror each live contact once.
      IF v_target.conversation_type='user' THEN
        PERFORM public.aka_agent_enqueue_data_group_chat_user(v_target.chat_zalo_account_id,v_target.zalo_id,v_target.organization_id);
      END IF;
      PERFORM public.aka_agent_refresh_contact_chat_tags(contact.id)
      FROM public.chat_zalo_conversation conv
      JOIN public.chat_zalo_account_organization binding ON binding.id=conv.chat_zalo_account_organization_id AND binding.organization_id=conv.organization_id AND binding.is_active
      JOIN public.auto_accounts account ON account.id=binding.auto_account_id AND account.organization_id=binding.organization_id AND NOT account.is_delete
      JOIN public.auto_account_contacts contact ON contact.account_id=account.id AND contact.staff_id=account.staff_id AND contact.organization_id=conv.organization_id
        AND contact.uid=v_target.zalo_id AND contact.flatform_type='zalo'
        AND contact.contact_type=CASE WHEN v_target.conversation_type='user' THEN 'person' ELSE 'group' END AND NOT contact.is_delete
      WHERE conv.id=v_target.conversation_id;
    END LOOP;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END;
$function$;

-- Body-only changes: no PostgREST metadata changed, so no schema reload.
COMMIT;
