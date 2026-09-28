-- New service-role-only read RPC. Source audit: signature absent on akachat, 2026-09-28.
-- No existing function, table, index, policy, or runtime writer is changed.
BEGIN;
DO $$ BEGIN
  IF to_regprocedure('public.aka_agent_control_account_snapshot(bigint,bigint,text[],text,bigint[],jsonb,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'Account snapshot RPC already exists: audit its live definition before applying';
  END IF;
END $$;
CREATE FUNCTION public.aka_agent_control_account_snapshot(
  p_staff_id bigint, p_organization_id bigint, p_platforms text[],
  p_view text DEFAULT 'accounts', p_account_ids bigint[] DEFAULT NULL,
  p_versions jsonb DEFAULT '{}'::jsonb, p_catalog_version text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = public, pg_temp
SET statement_timeout = '20s'
AS $function$
DECLARE
  v_catalog jsonb;
  v_catalog_version text;
  v_items jsonb;
  v_running jsonb := '[]'::jsonb;
  v_chat boolean;
BEGIN
  IF p_staff_id IS NULL OR p_organization_id IS NULL OR p_view IS NULL OR p_view NOT IN ('accounts','campaigns','details')
     OR jsonb_typeof(p_versions) IS DISTINCT FROM 'object'
     OR (p_view = 'campaigns' AND (p_account_ids IS NULL OR cardinality(p_account_ids) > 101)) THEN
    RAISE EXCEPTION 'Invalid account snapshot scope';
  END IF;

  IF p_view = 'campaigns' THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id',a.id,'name',coalesce(nullif(a.name,''),nullif(z.display_name,''),'Tài khoản #'||a.id),
      'platform',a.flatform_type,'isZaloServer',a.flatform_type='zalo' AND a.is_zalo_server IS TRUE,
      'isZaloShowWeb',a.flatform_type='zalo' AND a.is_zalo_show_web IS TRUE
    ) ORDER BY a.created_at DESC,a.id DESC),'[]'::jsonb)
    INTO v_catalog
    FROM auto_accounts a LEFT JOIN zalo_accounts z ON z.id=a.zalo_account_id
    WHERE a.staff_id=p_staff_id AND a.organization_id=p_organization_id AND a.is_delete IS FALSE
      AND a.flatform_type=ANY(p_platforms)
      AND (a.flatform_type='sms' OR (a.flatform_type='zalo' AND a.is_zalo_server IS TRUE AND a.is_zalo_show_web IS FALSE));
    v_catalog_version := md5(v_catalog::text);
  END IF;

  IF p_view='accounts' THEN
  SELECT EXISTS(SELECT 1 FROM org_organization_product
    WHERE organization_id=p_organization_id AND product_id IN (16,18) AND is_deleted IS FALSE
      AND is_chat_sync IS TRUE
      AND expiration_date >= (date_trunc('day',now() AT TIME ZONE 'Asia/Ho_Chi_Minh') AT TIME ZONE 'Asia/Ho_Chi_Minh')) INTO v_chat;
  END IF;

  WITH account_rows AS MATERIALIZED (
    SELECT a.id,a.created_at,
      jsonb_build_object('id',a.id,'name',a.name,'flatform_type',a.flatform_type,
        'is_active',a.is_active,'is_zalo_show_web',a.is_zalo_show_web,'is_zalo_server',a.is_zalo_server,
        'account_group_id',a.account_group_id,'rate_limit_minutes',a.rate_limit_minutes,'proxy_id',a.proxy_id,
        'username',CASE WHEN a.flatform_type='sms' THEN a.username END,
        'mobile_device_id',CASE WHEN a.flatform_type='sms' THEN a.mobile_device_id END,
        'mobile_device_info',CASE WHEN a.flatform_type='sms' THEN coalesce(a.mobile_device_info,'{}'::jsonb) ELSE '{}'::jsonb END,
        'mobile_device_registered_at',CASE WHEN a.flatform_type='sms' THEN a.mobile_device_registered_at END,
        'created_at',a.created_at,
        'auto_account_groups',jsonb_build_object('name',g.name),
        'auto_proxies',jsonb_build_object('name',p.name),
        'zalo_accounts',jsonb_build_object('zalo_uid',z.zalo_uid,'display_name',z.display_name,'phone',z.phone,'avatar_url',z.avatar_url)
      ) AS metadata,
      (jsonb_build_object('id',a.id,'status',a.status,'login_status',a.login_status,'is_active',a.is_active,
        'mobile_device_last_seen_at',CASE WHEN a.flatform_type='sms' THEN a.mobile_device_last_seen_at END,
        'updated_at',a.updated_at)
      || CASE WHEN p_view<>'campaigns' THEN jsonb_build_object(
        'has_zalo_session',CASE WHEN a.flatform_type='zalo' AND v_chat THEN a.login_status IS NOT DISTINCT FROM 'đã đăng nhập'
          ELSE a.zalo_session IS NOT NULL AND a.zalo_session <> 'null'::jsonb END,
        'has_disabled_actions',CASE WHEN p_account_ids IS NULL THEN EXISTS (
          SELECT 1 FROM auto_account_action_status s WHERE s.account_id=a.id AND s.is_disable IS TRUE
            AND (s.date_enable IS NULL OR s.date_enable > now())
        ) ELSE NULL END
      ) ELSE '{}'::jsonb END
      || CASE WHEN p_view='details' THEN jsonb_build_object(
        'zalo_session_updated_at',a.zalo_session_updated_at,'zalo_session_last_verified_at',a.zalo_session_last_verified_at,
        'zalo_session_last_error',a.zalo_session_last_error
      ) ELSE '{}'::jsonb END) AS state
    FROM auto_accounts a
    LEFT JOIN auto_account_groups g ON g.id=a.account_group_id
    LEFT JOIN auto_proxies p ON p.id=a.proxy_id
    LEFT JOIN zalo_accounts z ON z.id=a.zalo_account_id
    WHERE a.staff_id=p_staff_id AND a.organization_id=p_organization_id AND a.is_delete IS FALSE
      AND a.flatform_type=ANY(p_platforms)
      AND (p_account_ids IS NULL OR a.id=ANY(p_account_ids))
      AND (a.flatform_type='sms' OR (a.flatform_type='zalo' AND a.is_zalo_server IS TRUE AND a.is_zalo_show_web IS FALSE))
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'version',md5(metadata::text),'state',state,
    'metadata',CASE WHEN p_view<>'campaigns' AND (p_versions->>id::text) IS DISTINCT FROM md5(metadata::text) THEN metadata ELSE NULL END
  ) ORDER BY created_at DESC,id DESC),'[]'::jsonb) INTO v_items FROM account_rows;

  IF p_view='accounts' AND p_account_ids IS NULL THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'accountId',c.account_id,'status',c.status)
      ORDER BY c.created_at DESC,c.id DESC),'[]'::jsonb) INTO v_running
    FROM auto_campaigns c JOIN auto_accounts a ON a.id=c.account_id
    WHERE c.staff_id=p_staff_id AND c.organization_id=p_organization_id AND c.is_delete IS FALSE AND c.status='đang chạy'
      AND a.staff_id=p_staff_id AND a.organization_id=p_organization_id AND a.is_delete IS FALSE
      AND a.flatform_type=ANY(p_platforms)
      AND (a.flatform_type='sms' OR (a.flatform_type='zalo' AND a.is_zalo_server IS TRUE AND a.is_zalo_show_web IS FALSE));
  END IF;
  RETURN jsonb_build_object('items',v_items,'runningCampaigns',v_running,'catalogVersion',v_catalog_version,
    'catalog',CASE WHEN v_catalog_version IS DISTINCT FROM p_catalog_version THEN v_catalog ELSE NULL END);
END
$function$;
ALTER FUNCTION public.aka_agent_control_account_snapshot(bigint,bigint,text[],text,bigint[],jsonb,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.aka_agent_control_account_snapshot(bigint,bigint,text[],text,bigint[],jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.aka_agent_control_account_snapshot(bigint,bigint,text[],text,bigint[],jsonb,text) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
