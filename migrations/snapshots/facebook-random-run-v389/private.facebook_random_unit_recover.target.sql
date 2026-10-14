CREATE OR REPLACE FUNCTION private.facebook_random_unit_recover(p_campaign bigint, p_account bigint, p_unit uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE c record;t jsonb;
BEGIN
 SELECT runtime_unit_input_data_ids ids,runtime_claim_token claim INTO c FROM public.auto_campaigns WHERE id=p_campaign AND account_id=p_account AND runtime_unit_token=p_unit;
 IF NOT FOUND THEN RETURN; END IF;
 SELECT x INTO t FROM public.auto_account_random_run_days d,jsonb_array_elements(d.state->'turns') x
 WHERE d.account_id=p_account AND d.status='open' AND x->>'unitToken'=p_unit::text AND x->>'status'='running';
 IF t IS NULL THEN RETURN; END IF;
 PERFORM private.facebook_random_unit_settled(p_campaign,p_account,p_unit,true);
 UPDATE public.auto_campaign_input_data SET status='hoàn thành',note='Lượt ngẫu nhiên bị gián đoạn; kết quả chưa rõ, không tự thực hiện lại'
 WHERE campaign_id=p_campaign AND id=ANY(c.ids) AND status IN ('đang chạy','chờ xử lý');
 IF t->>'unit'<>'data' THEN
   UPDATE public.auto_campaigns SET status='tạm dừng',note='Lượt ngẫu nhiên bị gián đoạn; kiểm tra kết quả trước khi chạy lại' WHERE id=p_campaign;
 END IF;
 PERFORM private.facebook_random_finalize_turn(p_campaign,p_account,c.claim,p_unit,true);
END $function$
;
