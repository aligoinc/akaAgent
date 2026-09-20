-- V297 follow-up: preserve group -> source -> run lock order on recovery.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $preflight$
BEGIN
  IF to_regprocedure('public.aka_agent_sheet_claim(uuid)') IS NULL OR
    md5(pg_get_functiondef('public.aka_agent_sheet_claim(uuid)'::regprocedure)) IS DISTINCT FROM '99cfd6c369ffe9a29b08ccedd55adcdf'
  THEN RAISE EXCEPTION 'v298 sheet claim RPC drift'; END IF;
END;
$preflight$;
CREATE OR REPLACE FUNCTION public.aka_agent_sheet_claim(p_token uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_source public.auto_data_group_external_sync_sources%ROWTYPE; v_group public.auto_account_contact_groups%ROWTYPE;
  v_run_id bigint; v_state public.auto_data_group_sheet_worker_state%ROWTYPE;
BEGIN
  SELECT * INTO v_state FROM public.auto_data_group_sheet_worker_state WHERE id FOR UPDATE;
  IF NOT v_state.enabled OR v_state.token IS DISTINCT FROM p_token OR v_state.claimed OR v_state.lease_expires_at<=now() THEN RETURN NULL; END IF;
  UPDATE public.auto_data_group_sheet_worker_state SET claimed=true WHERE id;
  SELECT * INTO v_source FROM public.auto_data_group_external_sync_sources WHERE is_enabled AND NOT is_delete
    AND status IN ('pending','success','retry','running') AND next_run_at<=now() ORDER BY next_run_at,id LIMIT 1;
  IF NOT FOUND THEN
    UPDATE public.auto_data_group_sheet_worker_state SET lease_expires_at=NULL,token=NULL WHERE id; RETURN NULL;
  END IF;
  SELECT * INTO v_group FROM public.auto_account_contact_groups WHERE id=v_source.group_id FOR UPDATE;
  SELECT * INTO v_source FROM public.auto_data_group_external_sync_sources WHERE id=v_source.id FOR UPDATE;
  IF NOT v_source.is_enabled OR v_source.is_delete OR v_source.next_run_at>now() THEN
    UPDATE public.auto_data_group_sheet_worker_state SET lease_expires_at=NULL,token=NULL WHERE id; RETURN NULL;
  END IF;
  IF v_source.end_date<(now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date THEN
    UPDATE public.auto_data_group_external_sync_sources SET is_enabled=false,status='expired',run_token=NULL,updated_at=now() WHERE id=v_source.id;
    UPDATE public.auto_data_group_sheet_worker_state SET lease_expires_at=NULL,token=NULL WHERE id; RETURN NULL;
  END IF;
  -- Keep group -> source -> run order, including lease recovery. Never lock
  -- another group's run before its group; toggle/delete use this same order.
  UPDATE public.auto_data_group_external_sync_runs SET status='interrupted',finished_at=now(),error='Lượt trước bị gián đoạn; sẽ kiểm tra lại dữ liệu.'
    WHERE source_id=v_source.id AND status='running' AND started_at<now()-interval '180 seconds';
  INSERT INTO public.auto_data_group_external_sync_runs(source_id,group_id,staff_id,organization_id,source_name,token,source_revision)
    VALUES(v_source.id,v_source.group_id,v_source.staff_id,v_source.organization_id,v_source.name,p_token,v_source.revision) RETURNING id INTO v_run_id;
  IF v_group.is_delete OR v_group.staff_id<>v_source.staff_id OR v_group.organization_id<>v_source.organization_id
    OR NOT EXISTS(SELECT 1 FROM public.org_staff WHERE id=v_source.staff_id AND organization_id=v_source.organization_id AND is_active)
    OR v_group.bound_zalo_account_id IS DISTINCT FROM v_source.source_account_id
    OR (v_group.data_type_category_item_id IS NOT NULL AND v_group.data_type_category_item_id<>v_source.data_type_category_item_id)
    OR (v_source.source_account_id IS NOT NULL AND NOT public.aka_agent_data_group_account_available(v_source.source_account_id,v_source.staff_id,v_source.organization_id))
  THEN
    UPDATE public.auto_data_group_external_sync_sources SET is_enabled=false,status='error',run_token=NULL,last_error='Nhóm, loại data hoặc tài khoản nguồn không còn hợp lệ.',updated_at=now() WHERE id=v_source.id;
    UPDATE public.auto_data_group_external_sync_runs SET status='error',finished_at=now(),error='Nhóm, loại data hoặc tài khoản nguồn không còn hợp lệ.' WHERE id=v_run_id;
    UPDATE public.auto_data_group_sheet_worker_state SET lease_expires_at=NULL,token=NULL WHERE id; RETURN NULL;
  END IF;
  UPDATE public.auto_data_group_external_sync_sources SET status='running',run_token=p_token,last_run_at=now(),next_run_at=now()+interval '180 seconds',updated_at=now() WHERE id=v_source.id;
  RETURN jsonb_build_object('runId',v_run_id,'sourceId',v_source.id,'config',v_source.config);
END;
$function$
;
COMMIT;
