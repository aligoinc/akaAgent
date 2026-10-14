CREATE OR REPLACE FUNCTION private.facebook_random_unit_settled(p_campaign bigint, p_account bigint, p_unit uuid, p_cancelled boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE c record; done integer; seconds integer;
BEGIN
 SELECT runtime_unit_input_data_ids ids, runtime_unit_vietnam_date AS unit_day, runtime_unit_claimed_at started
 INTO c FROM public.auto_campaigns WHERE id=p_campaign AND account_id=p_account AND runtime_unit_token=p_unit;
 IF NOT FOUND THEN RETURN; END IF;
 SELECT count(*)::int INTO done FROM public.auto_campaign_input_data i WHERE i.campaign_id=p_campaign AND i.id=ANY(c.ids)
 AND i.status NOT IN ('chờ xử lý','đang chạy');
 seconds:=greatest(0,floor(extract(epoch FROM clock_timestamp()-c.started))::int);
 UPDATE public.auto_account_random_run_days d SET state=jsonb_set(d.state,'{turns}',(
   SELECT jsonb_agg(CASE WHEN x->>'unitToken'=p_unit::text AND x->>'status'='running'
     THEN (x-'unitToken'-'unitStartedAt')||jsonb_build_object(
       'processed',(x->>'processed')::int+CASE WHEN x->>'unit'='data' THEN done WHEN p_cancelled THEN 0 ELSE 1 END,
       'elapsedSeconds',CASE WHEN x->>'unit'='minute' AND NOT p_cancelled THEN least((x->>'quantity')::bigint*60,seconds) ELSE coalesce((x->>'elapsedSeconds')::int,0) END,
       'lastUnitToken',p_unit) ELSE x END ORDER BY n)
   FROM jsonb_array_elements(d.state->'turns') WITH ORDINALITY a(x,n))),updated_at=clock_timestamp()
 WHERE d.account_id=p_account AND d.run_date=c.unit_day AND EXISTS(
   SELECT 1 FROM jsonb_array_elements(d.state->'turns') x WHERE x->>'unitToken'=p_unit::text AND x->>'status'='running');
END $function$
;
