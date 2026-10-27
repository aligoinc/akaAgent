-- Candidate only: additive service-only HTTP boundaries; no existing body/ACL/RLS changes.
-- Live dependencies captured on akachat, 2026-10-28 Vietnam.
-- Keep typed SETOF rows for PostgREST row limits, native bigint/timestamp serialization.
DO $preflight$
DECLARE r record; f record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('public.aka_agent_block_denied_ip_request()', 'ecfc014981c5058f9cd84e0e8e504bed', 'postgres', false, 's', '["search_path=pg_catalog"]'::jsonb, '{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres,aka_agent_desktop=X/postgres}'),
    ('public.auto_assert_automation_identity(bigint,bigint,text,text)', '5a9a503db72b965eb644739f5f60905d', 'postgres', true, 's', '["search_path=pg_catalog, public"]'::jsonb, '{postgres=X/postgres,service_role=X/postgres}'),
    ('public.aka_agent_create_data_group(bigint,bigint,text,text,text,bigint,text,text)', '715a0e87caf388972e730b14d94ed6ed', 'postgres', true, 'v', '["search_path=pg_catalog, public"]'::jsonb, '{postgres=X/postgres,service_role=X/postgres}'),
    ('public.aka_agent_ingest_data_group(bigint,bigint,text,bigint,text,jsonb,bigint,text,text,bigint,text,text,bigint,text,text)', '450e18ee137eaa3f5f1032f945bb2dc7', 'postgres', true, 'v', '["search_path=pg_catalog, public","statement_timeout=60s"]'::jsonb, '{postgres=X/postgres,service_role=X/postgres,aka_agent_desktop=X/postgres}'),
    ('public.aka_agent_list_data_group_datasets(bigint,bigint,bigint,text,text)', 'bfb8d564579c245a983814bf94944e2f', 'postgres', true, 's', '["search_path=pg_catalog, public","statement_timeout=60s"]'::jsonb, '{postgres=X/postgres,service_role=X/postgres}'),
    ('public.aka_agent_list_data_groups(bigint,bigint,text,text,bigint,bigint[],integer,integer,text,text,boolean)', 'd4d42baec8810c79db4090b982a100e9', 'postgres', true, 's', '["search_path=pg_catalog, public","statement_timeout=60s"]'::jsonb, '{postgres=X/postgres,service_role=X/postgres}')
  ) AS expected(signature, checksum, owner_name, definer, volatility, config, acl) LOOP
    SELECT md5(pg_get_functiondef(p.oid)) checksum,pg_get_userbyid(p.proowner) owner_name,
      p.prosecdef definer,p.provolatile::text volatility,to_jsonb(p.proconfig) config,p.proacl::text acl
    INTO f FROM pg_proc p WHERE p.oid=to_regprocedure(r.signature);
    IF NOT FOUND OR f.checksum IS DISTINCT FROM r.checksum OR f.owner_name IS DISTINCT FROM r.owner_name
      OR f.definer IS DISTINCT FROM r.definer OR f.volatility IS DISTINCT FROM r.volatility
      OR f.config IS DISTINCT FROM r.config OR f.acl IS DISTINCT FROM r.acl THEN
      RAISE EXCEPTION 'cross_repo_http_dependency_drift: %',r.signature;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE (n.nspname,p.proname) IN (('public','aka_agent_chat_aux_settings'),('private','akamap_assert_data_group_identity'),('public','akamap_data_group_types'),('public','akamap_create_data_group'),('public','akamap_list_data_groups'),('public','akamap_list_data_group_datasets'),('public','akamap_ingest_data_group'))) THEN
    RAISE EXCEPTION 'cross_repo_http_target_already_exists';
  END IF;
END $preflight$;

CREATE FUNCTION public.aka_agent_chat_aux_settings(p_scope text)
RETURNS TABLE(id bigint,key text,value text,updated_at timestamptz,is_active boolean,is_secret boolean)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog SET statement_timeout='3s'
AS $function$
  SELECT s.id,s.key,s.value,s.updated_at,s.is_active,s.is_secret
  FROM public.auto_system_settings s
  WHERE s.is_active AND (
    (p_scope='engagement' AND NOT s.is_secret AND s.key IN (
      'zalo.campaign_engagement.enabled','zalo.campaign_engagement.flush_interval_seconds',
      'zalo.campaign_engagement.batch_size','zalo.campaign_engagement.tracking_window_hours'))
    OR (p_scope='notification' AND s.key='app.notification')
  )
  LIMIT CASE WHEN p_scope='engagement' THEN 4 ELSE 1 END;
$function$;

-- The legacy auto_assert_automation_identity intentionally trusts service_role.
-- Repeat exactly its ordinary-client predicate here, before entering that path.
CREATE FUNCTION private.akamap_assert_data_group_identity(p_payload jsonb)
RETURNS void LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog
AS $function$
DECLARE original_headers text := current_setting('request.headers',true);
BEGIN
  -- Edge supplies these candidates separately from the caller-controlled body.
  -- Reuse the live hook, including future deny-list changes, in the same request.
  IF jsonb_typeof(p_payload->'_edge_ip_headers') IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'akamap_request_context_required';
  END IF;
  PERFORM set_config('request.headers',(p_payload->'_edge_ip_headers')::text,true);
  PERFORM public.aka_agent_block_denied_ip_request();
  PERFORM set_config('request.headers',coalesce(original_headers,''),true);
  IF p_payload->>'p_auth_username' IS NULL OR p_payload->>'p_auth_password' IS NULL THEN
    RAISE EXCEPTION 'automation_auth_required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.org_staff s
    WHERE s.id=(p_payload->>'p_staff_id')::bigint AND s.organization_id=(p_payload->>'p_organization_id')::bigint
      AND s.is_active=true AND s.username=p_payload->>'p_auth_username' AND s.password=p_payload->>'p_auth_password') THEN
    RAISE EXCEPTION 'automation_auth_invalid';
  END IF;
END $function$;

CREATE FUNCTION public.akamap_data_group_types(p_payload jsonb)
RETURNS TABLE(id bigint,code text,name text,sort_order integer,is_active boolean,category_type jsonb) LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path=pg_catalog SET statement_timeout='3s'
AS $function$
BEGIN
  PERFORM private.akamap_assert_data_group_identity(p_payload);
  RETURN QUERY SELECT i.id,i.code,i.name,i.sort_order,i.is_active,
    jsonb_build_object('namespace',t.namespace,'code',t.code,'managed_by',t.managed_by,'is_active',t.is_active)
  FROM public.category_item i JOIN public.category_type t ON t.id=i.category_type_id
  WHERE t.namespace='common' AND t.code='data_type' AND t.managed_by='system'
    AND t.is_active=true AND i.managed_by='system' AND i.is_active=true
  ORDER BY i.sort_order,i.id;
END $function$;

CREATE FUNCTION public.akamap_create_data_group(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER
SET search_path=pg_catalog SET statement_timeout='3s'
AS $function$
BEGIN
  PERFORM private.akamap_assert_data_group_identity(p_payload);
  RETURN public.aka_agent_create_data_group((p_payload->>'p_staff_id')::bigint,(p_payload->>'p_organization_id')::bigint,p_payload->>'p_name',
    p_payload->>'p_color',p_payload->>'p_request_id',(p_payload->>'p_data_type_category_item_id')::bigint,p_payload->>'p_auth_username',p_payload->>'p_auth_password');
END $function$;

CREATE FUNCTION public.akamap_list_data_groups(p_payload jsonb)
RETURNS TABLE(id bigint, name text, color text, sort_order integer, revision bigint, data_type_category_item_id bigint, data_type_code text, data_type_name text, dataset_sync_mode text, active_membership_count bigint, is_delete boolean, staff_id bigint, organization_id bigint, created_at timestamp with time zone, updated_at timestamp with time zone, total_count bigint) LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path=pg_catalog SET statement_timeout='60s'
AS $function$
BEGIN
  PERFORM private.akamap_assert_data_group_identity(p_payload);
  RETURN QUERY SELECT * FROM public.aka_agent_list_data_groups((p_payload->>'p_staff_id')::bigint,(p_payload->>'p_organization_id')::bigint,p_payload->>'p_search',
    p_payload->>'p_compatible_action_id',(p_payload->>'p_compatible_data_type_category_item_id')::bigint,
    CASE WHEN p_payload->'p_data_type_category_item_ids' IS NULL OR p_payload->'p_data_type_category_item_ids'='null'::jsonb
      THEN NULL ELSE ARRAY(SELECT jsonb_array_elements_text(p_payload->'p_data_type_category_item_ids')::bigint) END,
    (p_payload->>'p_offset')::integer,(p_payload->>'p_limit')::integer,p_payload->>'p_auth_username',p_payload->>'p_auth_password',
    coalesce((p_payload->>'p_unrestricted_only')::boolean,false));
END $function$;

CREATE FUNCTION public.akamap_list_data_group_datasets(p_payload jsonb)
RETURNS TABLE(id bigint, group_id bigint, name text, link text, description text, source text, account_id bigint, source_account_name text, source_account_deleted boolean, flatform_type text, contact_type text, scan_type text, source_key text, import_source text, contact_count integer, data_type_category_item_id bigint, data_type_code text, data_type_name text, is_delete boolean, created_at timestamp with time zone, updated_at timestamp with time zone) LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path=pg_catalog SET statement_timeout='60s'
AS $function$
BEGIN
  PERFORM private.akamap_assert_data_group_identity(p_payload);
  RETURN QUERY SELECT * FROM public.aka_agent_list_data_group_datasets((p_payload->>'p_staff_id')::bigint,(p_payload->>'p_organization_id')::bigint,
    (p_payload->>'p_group_id')::bigint,p_payload->>'p_auth_username',p_payload->>'p_auth_password');
END $function$;

CREATE FUNCTION public.akamap_ingest_data_group(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER
SET search_path=pg_catalog SET statement_timeout='60s'
AS $function$
BEGIN
  PERFORM private.akamap_assert_data_group_identity(p_payload);
  RETURN public.aka_agent_ingest_data_group((p_payload->>'p_staff_id')::bigint,(p_payload->>'p_organization_id')::bigint,p_payload->>'p_request_id',
    (p_payload->>'p_group_id')::bigint,p_payload->>'p_kind',p_payload->'p_rows',
    (p_payload->>'p_dataset_id')::bigint,p_payload->>'p_dataset_name',p_payload->>'p_import_source',
    (p_payload->>'p_source_account_id')::bigint,p_payload->>'p_source_name',p_payload->>'p_payload_hash',
    (p_payload->>'p_data_type_category_item_id')::bigint,p_payload->>'p_auth_username',p_payload->>'p_auth_password');
END $function$;

-- Default ACLs also explicitly grant anon/authenticated; revoking PUBLIC alone is insufficient.
REVOKE ALL ON FUNCTION public.aka_agent_chat_aux_settings(text),
  private.akamap_assert_data_group_identity(jsonb),
  public.akamap_data_group_types(jsonb),
  public.akamap_create_data_group(jsonb),
  public.akamap_list_data_groups(jsonb),
  public.akamap_list_data_group_datasets(jsonb),
  public.akamap_ingest_data_group(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.aka_agent_chat_aux_settings(text),
  private.akamap_assert_data_group_identity(jsonb),
  public.akamap_data_group_types(jsonb),
  public.akamap_create_data_group(jsonb),
  public.akamap_list_data_groups(jsonb),
  public.akamap_list_data_group_datasets(jsonb),
  public.akamap_ingest_data_group(jsonb) TO service_role;

NOTIFY pgrst, 'reload schema';
