CREATE OR REPLACE FUNCTION public.aka_agent_desktop_account_snapshot(p_staff_id bigint, p_organization_id bigint, p_auth_username text, p_auth_password text, p_access jsonb, p_catalog_version text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET statement_timeout TO '60s'
AS $function$
DECLARE v_result jsonb;
BEGIN
  PERFORM public.auto_assert_automation_identity(p_staff_id,p_organization_id,p_auth_username,p_auth_password);
  WITH scoped AS MATERIALIZED (
    SELECT a.id, a.status, a.login_status, a.updated_at, a.mobile_device_last_seen_at, a.mobile_device_info,
      a.zalo_session_updated_at, a.zalo_session_last_verified_at, a.zalo_session_last_error,
      a.email_session_updated_at, a.email_session_last_verified_at, a.email_session_last_error,
      a.facebook_login_claim_generation,
      jsonb_build_object(
        'id',a.id,'name',a.name,'flatform_type',a.flatform_type,'facebook_uid',a.facebook_uid,
        'facebook_login_managed',a.facebook_login_managed,
        'is_zalo_show_web',a.is_zalo_show_web,'is_zalo_server',a.is_zalo_server,
        'username',CASE WHEN a.flatform_type='sms' THEN a.username END,
        'password',CASE WHEN a.flatform_type='sms' THEN a.password END,
        'mobile_device_id',a.mobile_device_id,'mobile_device_registered_at',a.mobile_device_registered_at,
        'is_active',a.is_active,'rate_limit_minutes',a.rate_limit_minutes,
        'account_group_id',a.account_group_id,'proxy_id',a.proxy_id,'zalo_account_id',a.zalo_account_id,
        'is_delete',a.is_delete,'staff_id',a.staff_id,'organization_id',a.organization_id,'created_at',a.created_at,
        'auto_account_groups',CASE WHEN g.id IS NOT NULL THEN jsonb_build_object('name',g.name,'settings',g.settings) END,
        'auto_proxies',CASE WHEN pr.id IS NOT NULL THEN jsonb_build_object('name',pr.name,'protocol',pr.protocol,'host',pr.host,'port',pr.port) END,
        'zalo_accounts',CASE WHEN z.id IS NOT NULL THEN jsonb_build_object('id',z.id,'zalo_uid',z.zalo_uid,'display_name',z.display_name,'phone',z.phone,'avatar_url',z.avatar_url) END
      ) AS metadata
    FROM public.auto_accounts a
    LEFT JOIN public.auto_account_groups g ON g.id=a.account_group_id
    LEFT JOIN public.auto_proxies pr ON pr.id=a.proxy_id
    LEFT JOIN public.zalo_accounts z ON z.id=a.zalo_account_id
    WHERE a.staff_id=p_staff_id AND a.organization_id=p_organization_id AND a.is_delete=false
      AND coalesce((p_access->>CASE WHEN a.flatform_type='facebook' THEN 'facebookCore' ELSE a.flatform_type END)::boolean,false)
      AND (a.flatform_type<>'zalo' OR coalesce((p_access->>CASE WHEN a.is_zalo_show_web IS TRUE THEN 'web' WHEN a.is_zalo_server IS TRUE THEN 'server' ELSE 'qr' END)::boolean,false))
  ), restricted AS MATERIALIZED (
    SELECT DISTINCT x.account_id FROM public.auto_account_action_status x
    JOIN scoped a ON a.id=x.account_id
    WHERE x.is_disable=true AND (x.date_enable IS NULL OR x.date_enable>now())
  ), catalog AS (
    SELECT md5(coalesce(string_agg(metadata::text,',' ORDER BY id),'')) AS version FROM scoped
  )
  SELECT jsonb_build_object('version',c.version,
    'catalog',CASE WHEN c.version IS DISTINCT FROM p_catalog_version THEN
      coalesce((SELECT jsonb_agg(metadata ORDER BY (metadata->>'created_at')::timestamptz DESC,id DESC) FROM scoped),'[]') END,
    'states',coalesce((SELECT jsonb_agg(jsonb_build_object(
      'id',s.id,'status',s.status,'loginStatus',s.login_status,'updatedAt',s.updated_at,
      'mobileDeviceLastSeenAt',s.mobile_device_last_seen_at,'mobileDeviceInfo',s.mobile_device_info,
      'facebookLoginClaimGeneration',s.facebook_login_claim_generation,
      'zaloSessionUpdatedAt',s.zalo_session_updated_at,'zaloSessionLastVerifiedAt',s.zalo_session_last_verified_at,'zaloSessionLastError',s.zalo_session_last_error,
      'emailSessionUpdatedAt',s.email_session_updated_at,'emailSessionLastVerifiedAt',s.email_session_last_verified_at,'emailSessionLastError',s.email_session_last_error,
      'hasEmailSession',s.email_session_updated_at IS NOT NULL,
      'hasZaloSession',CASE WHEN (p_access->>'chatSync')::boolean IS TRUE AND s.metadata->>'flatform_type'='zalo' AND (s.metadata->>'is_zalo_server')::boolean IS TRUE AND (s.metadata->>'is_zalo_show_web')::boolean IS NOT TRUE THEN s.login_status='đã đăng nhập' ELSE s.zalo_session_updated_at IS NOT NULL END,
      'hasDisabledActions',r.account_id IS NOT NULL
    ) ORDER BY s.id) FROM scoped s LEFT JOIN restricted r ON r.account_id=s.id),'[]'))
  INTO v_result FROM catalog c;
  RETURN v_result;
END;
$function$
