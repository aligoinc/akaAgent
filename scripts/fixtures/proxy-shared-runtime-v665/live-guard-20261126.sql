CREATE OR REPLACE FUNCTION private.aka_agent_guard_account_proxy_scope()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_owner bigint;
  v_org bigint;
  v_server boolean;
BEGIN
  IF NEW.proxy_id IS NULL OR COALESCE(NEW.is_delete, false) THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND NEW.proxy_id IS NOT DISTINCT FROM OLD.proxy_id
     AND NEW.staff_id IS NOT DISTINCT FROM OLD.staff_id
     AND NEW.organization_id IS NOT DISTINCT FROM OLD.organization_id
     AND NEW.flatform_type IS NOT DISTINCT FROM OLD.flatform_type
     AND NEW.is_zalo_server IS NOT DISTINCT FROM OLD.is_zalo_server
     AND NEW.is_zalo_show_web IS NOT DISTINCT FROM OLD.is_zalo_show_web
     AND NEW.is_delete IS NOT DISTINCT FROM OLD.is_delete THEN
    RETURN NEW;
  END IF;
  SELECT proxy.staff_id, proxy.organization_id INTO v_owner, v_org
  FROM public.auto_proxies AS proxy WHERE proxy.id = NEW.proxy_id;
  IF NOT FOUND THEN
    RETURN NEW; -- FK và trg_lock_auto_account_control_resources báo lỗi proxy không tồn tại.
  END IF;
  IF v_org IS DISTINCT FROM NEW.organization_id THEN
    RAISE EXCEPTION 'proxy_wrong_organization';
  END IF;
  IF v_owner IS NOT DISTINCT FROM NEW.staff_id THEN
    RETURN NEW;
  END IF;
  v_server := lower(btrim(COALESCE(NEW.flatform_type, ''))) = 'zalo'
    AND COALESCE(NEW.is_zalo_server, false) AND NOT COALESCE(NEW.is_zalo_show_web, false);
  IF NOT private.aka_agent_proxy_shared_runtime_ready(NEW.staff_id, v_server) THEN
    RAISE EXCEPTION 'proxy_shared_runtime_not_ready'
      USING DETAIL = CASE WHEN v_server THEN 'server' ELSE 'desktop' END;
  END IF;
  RETURN NEW;
END;
$function$
