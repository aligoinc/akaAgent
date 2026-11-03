CREATE OR REPLACE FUNCTION private.app_access_reserve_chat_identity(p_account bigint, p_org bigint, p_zalo bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
DECLARE uid text; chat_id bigint; bound_id bigint; login_id bigint; socket_id bigint;
BEGIN
  SELECT zalo_uid INTO uid FROM public.zalo_accounts WHERE id=p_zalo;
  IF uid IS NULL THEN RAISE EXCEPTION 'app_access_invalid_identity'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_org::text||':'||uid,0));
  IF EXISTS(SELECT 1 FROM public.chat_zalo_account_organization b JOIN public.chat_zalo_account z ON z.id=b.chat_zalo_account_id
    WHERE b.auto_account_id=p_account AND (b.organization_id<>p_org OR z.zalo_id<>uid)) THEN
    RAISE EXCEPTION 'account_already_has_another_zalo';
  END IF;
  SELECT b.auto_account_id INTO bound_id FROM public.chat_zalo_account_organization b
    JOIN public.chat_zalo_account z ON z.id=b.chat_zalo_account_id
    WHERE b.organization_id=p_org AND z.zalo_id=uid FOR UPDATE OF b;
  -- An existing binding owns this identity even if legacy duplicate flags remain.
  IF bound_id=p_account THEN RETURN; END IF;
  IF bound_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.auto_accounts WHERE id=bound_id AND NOT COALESCE(is_delete,false))
    THEN RAISE EXCEPTION 'zalo_already_linked'; END IF;
  -- Only unbound logged-in rows reserve a future enrollment, including reuse of
  -- a deleted binding. A row bound to another Zalo cannot reserve its stale ID.
  IF EXISTS(SELECT 1 FROM public.auto_accounts a JOIN public.org_staff s ON s.id=a.staff_id
    WHERE s.organization_id=p_org AND a.id<>p_account AND NOT COALESCE(a.is_delete,false)
      AND a.is_akachat_enabled AND a.zalo_account_id=p_zalo AND a.login_status='đã đăng nhập'
      AND NOT EXISTS(SELECT 1 FROM public.chat_zalo_account_organization own_binding WHERE own_binding.auto_account_id=a.id)) THEN
    RAISE EXCEPTION 'zalo_already_linked';
  END IF;
  IF bound_id IS NOT NULL THEN RETURN; END IF;
  INSERT INTO public.chat_zalo_account(zalo_id) VALUES(uid)
    ON CONFLICT(zalo_id) DO NOTHING;
  SELECT id INTO chat_id FROM public.chat_zalo_account WHERE zalo_id=uid;
  SELECT i.id INTO login_id FROM public.category_item i JOIN public.category_type t ON t.id=i.category_type_id
    WHERE t.namespace='zalo' AND t.code='zalo_login_status' AND i.code='logged_out' AND t.is_active AND i.is_active ORDER BY i.id LIMIT 1;
  SELECT i.id INTO socket_id FROM public.category_item i JOIN public.category_type t ON t.id=i.category_type_id
    WHERE t.namespace='zalo' AND t.code='zalo_socket_status' AND i.code='disconnected' AND t.is_active AND i.is_active ORDER BY i.id LIMIT 1;
  IF login_id IS NULL OR socket_id IS NULL THEN RAISE EXCEPTION 'app_access_category_missing'; END IF;
  INSERT INTO public.chat_zalo_account_organization(chat_zalo_account_id,organization_id,auto_account_id,
    login_status_category_item_id,socket_status_category_item_id,is_active,runtime_generation)
    VALUES(chat_id,p_org,p_account,login_id,socket_id,false,0);
END $function$;

CREATE OR REPLACE FUNCTION private.app_access_reserve_enabled_identity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
DECLARE org bigint;
BEGIN
  SELECT organization_id INTO org FROM public.org_staff WHERE id=NEW.staff_id;
  IF EXISTS(SELECT 1 FROM private.app_access_requests r WHERE r.organization_id=org AND r.target_type='initialize'
    AND r.status='processing' AND r.result->>'transactionId'=pg_current_xact_id()::text) THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND NEW.is_akachat_enabled IS NOT DISTINCT FROM OLD.is_akachat_enabled
    AND NEW.zalo_account_id IS NOT DISTINCT FROM OLD.zalo_account_id
    AND NEW.is_delete IS NOT DISTINCT FROM OLD.is_delete AND NEW.staff_id IS NOT DISTINCT FROM OLD.staff_id
    AND NEW.organization_id IS NOT DISTINCT FROM OLD.organization_id AND NEW.login_status IS NOT DISTINCT FROM OLD.login_status
    THEN RETURN NEW; END IF;
  IF public.aka_agent_app_access_separate(org) AND NEW.is_akachat_enabled AND NOT COALESCE(NEW.is_delete,false)
    AND NEW.zalo_account_id IS NOT NULL AND NEW.login_status='đã đăng nhập' THEN
    -- Flags/status confirm the retained binding, not stale legacy metadata.
    -- New session/identity/owner/tenant changes and undelete still reserve the
    -- actual candidate; QR commit independently checks its sealed receipt.
    IF TG_OP='UPDATE'
      AND (NEW.is_akachat_enabled IS DISTINCT FROM OLD.is_akachat_enabled
        OR NEW.login_status IS DISTINCT FROM OLD.login_status)
      AND NEW.zalo_account_id IS NOT DISTINCT FROM OLD.zalo_account_id
      AND NEW.is_delete IS NOT DISTINCT FROM OLD.is_delete AND NEW.staff_id IS NOT DISTINCT FROM OLD.staff_id
      AND NEW.organization_id IS NOT DISTINCT FROM OLD.organization_id
      AND NEW.flatform_type IS NOT DISTINCT FROM OLD.flatform_type
      AND NEW.is_zalo_server IS NOT DISTINCT FROM OLD.is_zalo_server
      AND NEW.is_zalo_show_web IS NOT DISTINCT FROM OLD.is_zalo_show_web
      AND NEW.zalo_session IS NOT DISTINCT FROM OLD.zalo_session
      AND EXISTS(SELECT 1 FROM public.chat_zalo_account_organization b WHERE b.auto_account_id=NEW.id AND b.organization_id=org)
      THEN RETURN NEW; END IF;
    PERFORM private.app_access_reserve_chat_identity(NEW.id,org,NEW.zalo_account_id);
  END IF;
  RETURN NEW;
END $function$;
