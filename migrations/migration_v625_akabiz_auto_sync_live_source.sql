-- V625 — Đồng bộ akaBiz Auto: chạy đúng khi akaBiz Auto vẫn thêm / xoá data trong lúc đồng bộ.
-- Người dùng yêu cầu 22/11/2026: giả lập đồng bộ trên SQLite như khách thật, sửa lỗi tìm ra (akaAgentWebApp
-- scripts/akabiz-auto-sync-sim). Chỉ thay thân public.akabiz_import_auto_desktop_v1(jsonb) của V623:
--  1. 'inputs' không báo SOURCE_CHANGED khi đã đọc nhiều dòng hơn lúc dựng bản chép (akaBiz Auto thêm data giữa lượt).
--  2. 'publish' nhận payload.after_id (bên đọc đã đọc hết tới con trỏ này) thay cho so số dòng; thiếu after_id thì như V623.
--  3. 'campaign' gọi lại cho bản chép còn ẩn: ghi số dòng mới; loại / tài khoản nguồn đổi thì dựng lại bản chép
--     (V623 báo SOURCE_CHANGED mãi, chiến dịch không bao giờ chép được).
-- Sinh bằng scripts/build-v625-sql.py từ thân V623; bản gỡ: rollback_v625_akabiz_auto_sync_live_source.sql.
-- Một khối DO = một câu lệnh: kiểm trước, thay, kiểm sau cùng thành công hoặc cùng thất bại. Không đổi bảng, quyền, ACL.
DO $v625$
DECLARE v_body text;
BEGIN
 SELECT md5(pg_get_functiondef('public.akabiz_import_auto_desktop_v1(jsonb)'::regprocedure)) INTO v_body;
 IF v_body IS DISTINCT FROM 'f4ae76455879213d60526bc6cc20a805' THEN
   RAISE EXCEPTION 'V625 preflight: thân hàm hiện tại không như mong đợi: %', v_body;
 END IF;

 EXECUTE $create$
CREATE OR REPLACE FUNCTION public.akabiz_import_auto_desktop_v1(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
 SET lock_timeout TO '3s'
 SET statement_timeout TO '15s'
AS $function$
#variable_conflict use_variable
DECLARE
 op text:=p->>'operation'; payload jsonb:=coalesce(p->'payload','{}'::jsonb);
 dry boolean:=coalesce((p->>'dry_run')::boolean,false);
 src_account bigint; src_staff bigint; staff_id bigint; org_id bigint;
 r public.akabiz_zalo_import_history%ROWTYPE; h public.akabiz_zalo_import_history%ROWTYPE; n public.akabiz_zalo_import_history%ROWTYPE;
 a public.auto_accounts%ROWTYPE; c public.auto_campaigns%ROWTYPE;
 source_key text:=p->>'source_id'; entity_kind text:=p->>'kind';
 result jsonb; item jsonb; config jsonb; desired text; target bigint; created boolean:=false;
 acc_type text; platform text; fb_count integer; fb_max integer; fb_products integer; pool record; used integer;
 actual_count bigint; consumed integer; batch_hash text; err text;
BEGIN
 IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR octet_length(p::text)>1048576 THEN RAISE EXCEPTION 'IMPORT_PAYLOAD_INVALID'; END IF;

 -- Lượt đang chạy (mọi thao tác ghi) hoặc phạm vi nguồn + đích (inspect, begin, thao tác xem trước).
 IF op IN ('inspect','begin') OR dry THEN
   src_account:=(p->>'source_account_id')::bigint; src_staff:=(p->>'source_staff_id')::bigint; staff_id:=(p->>'target_staff_id')::bigint;
   IF src_account IS NULL OR src_account<=0 OR src_staff IS NULL OR src_staff<=0 OR staff_id IS NULL OR staff_id<=0 THEN RAISE EXCEPTION 'IMPORT_PAYLOAD_INVALID'; END IF;
   SELECT s.organization_id INTO org_id FROM public.org_staff s WHERE s.id=staff_id AND s.deleted_at IS NULL;
   IF org_id IS NULL THEN RAISE EXCEPTION 'TARGET_STAFF_UNRESOLVED'; END IF;
   IF NOT public.aka_agent_staff_time_allowed(staff_id) THEN RAISE EXCEPTION 'TARGET_STAFF_INACTIVE'; END IF;
   SELECT * INTO r FROM public.akabiz_zalo_import_history x WHERE x.source_system='akabiz_auto_sqlite'
     AND x.source_account_id=src_account AND x.source_staff_id=src_staff AND x.target_staff_id=staff_id
     AND x.target_organization_id=org_id AND x.kind='run' AND x.state<>'complete';
   IF r.id IS NULL THEN
     r.source_system:='akabiz_auto_sqlite'; r.source_account_id:=src_account; r.source_staff_id:=src_staff;
     r.target_staff_id:=staff_id; r.target_organization_id:=org_id;
   END IF;
 ELSE
   SELECT * INTO r FROM public.akabiz_zalo_import_history x WHERE x.run_id=(p->>'run_id')::uuid AND x.kind='run'
     AND x.source_system='akabiz_auto_sqlite' FOR UPDATE;
   IF r.id IS NULL OR r.state='complete' OR r.lease_token IS DISTINCT FROM (p->>'lease_token')::uuid OR r.lease_until<=clock_timestamp() THEN RAISE EXCEPTION 'IMPORT_LEASE_LOST'; END IF;
   staff_id:=r.target_staff_id; org_id:=r.target_organization_id; src_account:=r.source_account_id; src_staff:=r.source_staff_id;
   IF NOT public.aka_agent_staff_time_allowed(staff_id) OR NOT EXISTS(SELECT 1 FROM public.org_staff s WHERE s.id=staff_id AND s.organization_id=org_id AND s.deleted_at IS NULL) THEN RAISE EXCEPTION 'TARGET_STAFF_INACTIVE'; END IF;
   UPDATE public.akabiz_zalo_import_history SET lease_until=clock_timestamp()+interval '90 seconds',updated_at=clock_timestamp() WHERE id=r.id;
 END IF;

 IF op='inspect' THEN
   -- Quyền + hạn mức theo loại tài khoản đích, đếm như trigger hạn mức Zalo (cùng bể gói) và như Desktop (Facebook).
   result:='{}';
   FOR pool IN SELECT * FROM private.resolve_organization_zalo_entitlement_pools(org_id) LOOP
     IF pool.entitlement_id IS NULL THEN
       result:=result||jsonb_build_object('zalo_'||pool.account_subtype,jsonb_build_object('allowed',false,'used',0,'max',NULL));
       CONTINUE;
     END IF;
     SELECT count(*) INTO used FROM public.auto_accounts account WHERE account.staff_id=staff_id
       AND (account.organization_id IS NULL OR account.organization_id=org_id)
       AND lower(btrim(coalesce(account.flatform_type,'')))='zalo' AND NOT coalesce(account.is_delete,false)
       AND (CASE WHEN coalesce(account.is_zalo_show_web,false) THEN 'web' WHEN coalesce(account.is_zalo_server,false) THEN 'server' ELSE 'qr' END)
         IN (SELECT q.account_subtype FROM private.resolve_organization_zalo_entitlement_pools(org_id) q WHERE q.entitlement_id=pool.entitlement_id);
     result:=result||jsonb_build_object('zalo_'||pool.account_subtype,
       jsonb_build_object('allowed',true,'used',used,'max',CASE WHEN coalesce(pool.max_accounts,0)>0 THEN pool.max_accounts END));
   END LOOP;
   SELECT count(*),CASE WHEN bool_or(max_accounts IS NULL OR max_accounts<=0) THEN NULL ELSE max(max_accounts) END INTO fb_products,fb_max
     FROM public.org_organization_product WHERE organization_id=org_id AND product_id IN (3,10) AND is_deleted=false
       AND expiration_date>=(date_trunc('day',now() AT TIME ZONE 'Asia/Ho_Chi_Minh') AT TIME ZONE 'Asia/Ho_Chi_Minh');
   SELECT count(*) INTO fb_count FROM public.auto_accounts account WHERE account.staff_id=staff_id AND account.organization_id=org_id
     AND account.flatform_type='facebook' AND NOT coalesce(account.is_delete,false);
   result:=jsonb_build_object('options',result||jsonb_build_object('facebook',jsonb_build_object('allowed',fb_products>0,'used',fb_count,'max',fb_max)),
     'organizationId',org_id,
     'linkedElsewhere',EXISTS(SELECT 1 FROM public.akabiz_zalo_import_history x WHERE x.source_staff_id=src_staff AND x.source_account_id=src_account
         AND x.kind IN ('run','account') AND (x.target_staff_id<>staff_id OR x.target_organization_id<>org_id))
       OR EXISTS(SELECT 1 FROM public.org_staff s WHERE s.sql_staff_id=src_staff AND s.id<>staff_id AND s.deleted_at IS NULL),
     'run',CASE WHEN r.id IS NULL THEN NULL ELSE jsonb_build_object('runId',r.run_id,'asOf',r.as_of,'startedAt',r.created_at,'settings',r.data->'settings') END,
     'mappings',coalesce((SELECT jsonb_agg(jsonb_build_object('shopId',m.source_id,'accountId',m.target_id::text,'name',account.name,
         'type',CASE WHEN account.flatform_type='facebook' THEN 'facebook' WHEN coalesce(account.is_zalo_show_web,false) THEN 'zalo_web'
           WHEN coalesce(account.is_zalo_server,false) THEN 'zalo_server' ELSE 'zalo_qr' END,'source',m.source_system) ORDER BY m.source_id)
       FROM (SELECT DISTINCT ON (x.source_id) x.source_id,x.target_id,x.source_system FROM public.akabiz_zalo_import_history x
         WHERE x.kind='account' AND x.state='complete' AND x.target_id IS NOT NULL AND x.source_account_id=src_account AND x.source_staff_id=src_staff
           AND x.target_staff_id=staff_id AND x.target_organization_id=org_id
           AND x.source_id IN (SELECT jsonb_array_elements_text(coalesce(payload->'shopIds','[]')))
         ORDER BY x.source_id,(x.source_system='akabiz_auto_sqlite') DESC,x.created_at) m
       JOIN public.auto_accounts account ON account.id=m.target_id AND account.staff_id=staff_id AND account.organization_id=org_id
         AND NOT coalesce(account.is_delete,false)),'[]'));
   RETURN result;
 END IF;

 IF op='begin' THEN
   PERFORM pg_advisory_xact_lock(hashtextextended('akabiz-auto-sync:'||src_account||':'||src_staff||':'||org_id||':'||staff_id,0));
   SELECT * INTO h FROM public.akabiz_zalo_import_history x WHERE x.source_system='akabiz_auto_sqlite'
     AND x.source_account_id=src_account AND x.source_staff_id=src_staff AND x.target_staff_id=staff_id
     AND x.target_organization_id=org_id AND x.kind='run' AND x.state<>'complete' FOR UPDATE;
   IF (p->>'lease_token')::uuid IS NULL THEN RAISE EXCEPTION 'IMPORT_PAYLOAD_INVALID'; END IF;
   IF h.id IS NOT NULL AND h.lease_until>clock_timestamp() AND h.lease_token IS DISTINCT FROM (p->>'lease_token')::uuid THEN RAISE EXCEPTION 'IMPORT_BUSY'; END IF;
   IF h.id IS NULL THEN
     IF jsonb_typeof(payload->'settings') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'IMPORT_PAYLOAD_INVALID'; END IF;
     h:=r; h.id:=gen_random_uuid(); h.run_id:=h.id; h.source_id:=h.id::text; h.kind:='run'; h.state:='pending';
     h.data:=jsonb_build_object('settings',payload->'settings'); h.adjustments:='[]'; h.as_of:=clock_timestamp();
     h.created_at:=clock_timestamp(); h.updated_at:=h.created_at;
     INSERT INTO public.akabiz_zalo_import_history SELECT h.*;
   END IF;
   UPDATE public.akabiz_zalo_import_history SET lease_token=(p->>'lease_token')::uuid,lease_until=clock_timestamp()+interval '90 seconds',updated_at=clock_timestamp()
     WHERE id=h.id RETURNING * INTO h;
   RETURN jsonb_build_object('runId',h.run_id,'asOf',h.as_of,'settings',h.data->'settings',
     'campaigns',jsonb_build_object(
       'complete',coalesce((SELECT jsonb_agg(x.source_id ORDER BY x.source_id) FROM public.akabiz_zalo_import_history x WHERE x.source_system='akabiz_auto_sqlite'
         AND x.source_account_id=src_account AND x.source_staff_id=src_staff AND x.target_staff_id=staff_id AND x.target_organization_id=org_id
         AND x.kind='campaign' AND x.state='complete'),'[]'),
       'pending',coalesce((SELECT jsonb_agg(jsonb_build_object('sourceId',x.source_id,'cursor',jsonb_build_object('afterId',x.data->'after_id','consumed',coalesce((x.data->>'consumed_count')::integer,0))) ORDER BY x.source_id)
         FROM public.akabiz_zalo_import_history x WHERE x.source_system='akabiz_auto_sqlite' AND x.source_account_id=src_account AND x.source_staff_id=src_staff
         AND x.target_staff_id=staff_id AND x.target_organization_id=org_id AND x.kind='campaign' AND x.state<>'complete' AND x.target_id IS NOT NULL),'[]')));
 END IF;

 IF op IN ('checkpoint','release','finish') THEN
   -- Kết thúc luôn đóng lượt (lượt sau được chọn lại cài đặt); chiến dịch cần xử lý vẫn ghi ở dòng 'campaign' của nó.
   UPDATE public.akabiz_zalo_import_history SET data=data||coalesce(p->'progress','{}'::jsonb)
       ||CASE WHEN op='finish' THEN jsonb_build_object('hasIssues',coalesce((p->>'has_issues')::boolean,false),'finishedAt',clock_timestamp()) ELSE '{}'::jsonb END,
     state=CASE WHEN op='finish' THEN 'complete' ELSE state END,
     lease_until=CASE WHEN op IN ('release','finish') THEN NULL ELSE lease_until END,
     lease_token=CASE WHEN op IN ('release','finish') THEN NULL ELSE lease_token END,
     updated_at=clock_timestamp() WHERE id=r.id;
   RETURN jsonb_build_object('ok',true);
 END IF;

 IF source_key IS NULL OR source_key='' OR length(source_key)>200 OR entity_kind NOT IN ('account','campaign','tag') THEN RAISE EXCEPTION 'IMPORT_PAYLOAD_INVALID'; END IF;
 SELECT * INTO h FROM public.akabiz_zalo_import_history x WHERE x.source_system='akabiz_auto_sqlite' AND x.source_account_id=src_account
   AND x.source_staff_id=src_staff AND x.target_staff_id=staff_id AND x.target_organization_id=org_id AND x.kind=entity_kind AND x.source_id=source_key;
 n:=r; n.id:=gen_random_uuid(); n.source_system:='akabiz_auto_sqlite'; n.kind:=entity_kind; n.source_id:=source_key;
 n.parent_source_id:=p->>'parent_source_id'; n.target_id:=NULL; n.source_version:=p->>'source_version'; n.source_status:=p->>'source_status';
 n.state:='pending'; n.data:='{}'; n.adjustments:=coalesce(p->'adjustments','[]'); n.error_code:=NULL; n.lease_token:=NULL; n.lease_until:=NULL;
 n.as_of:=coalesce(r.as_of,clock_timestamp()); n.run_id:=coalesce(r.run_id,gen_random_uuid()); n.created_at:=clock_timestamp(); n.updated_at:=n.created_at;

 IF op='issue' THEN
   IF dry THEN RETURN jsonb_build_object('ok',true); END IF;
   IF h.id IS NULL THEN n.state:='needs_resolution'; n.error_code:=left(p->>'code',100); INSERT INTO public.akabiz_zalo_import_history SELECT n.*;
   ELSIF h.state<>'complete' THEN UPDATE public.akabiz_zalo_import_history SET error_code=left(p->>'code',100),state='needs_resolution',updated_at=clock_timestamp() WHERE id=h.id; END IF;
   RETURN jsonb_build_object('ok',true);
 END IF;

 IF op='account' AND entity_kind='account' THEN
   acc_type:=payload->>'type';
   IF acc_type NOT IN ('zalo_server','zalo_web','zalo_qr','facebook') THEN RAISE EXCEPTION 'IMPORT_PAYLOAD_INVALID'; END IF;
   platform:=CASE WHEN acc_type='facebook' THEN 'facebook' ELSE 'zalo' END;
   -- Đã chép trước đó (bộ này, hoặc bộ akaBiz Zalo Web cùng Shop): dùng lại, giữ loại cũ.
   IF h.target_id IS NOT NULL THEN target:=h.target_id;
   ELSE
     SELECT x.target_id INTO target FROM public.akabiz_zalo_import_history x WHERE x.source_system='akabiz_main_sql' AND x.kind='account'
       AND x.state='complete' AND x.source_id=source_key AND x.source_account_id=src_account AND x.source_staff_id=src_staff
       AND x.target_staff_id=staff_id AND x.target_organization_id=org_id;
   END IF;
   IF target IS NOT NULL THEN
     SELECT * INTO a FROM public.auto_accounts WHERE id=target AND auto_accounts.staff_id=staff_id AND organization_id=org_id AND NOT coalesce(is_delete,false);
     IF a.id IS NULL THEN
       target:=NULL;  -- tài khoản đã chép trước đó đã bị xoá: tạo lại, ghi đè ánh xạ.
     ELSIF a.flatform_type IS DISTINCT FROM platform THEN RAISE EXCEPTION 'ACCOUNT_MODE_CONFLICT';
     END IF;
   END IF;
   IF target IS NULL THEN
     IF dry THEN
       RETURN jsonb_build_object('accountId',NULL,'created',true,'type',acc_type);
     END IF;
     IF platform='facebook' THEN
       PERFORM pg_advisory_xact_lock(hashtextextended('akabiz-auto-sync-facebook-account:'||staff_id,0));
       SELECT count(*),CASE WHEN bool_or(max_accounts IS NULL OR max_accounts<=0) THEN NULL ELSE max(max_accounts) END INTO fb_products,fb_max
         FROM public.org_organization_product WHERE organization_id=org_id AND product_id IN (3,10) AND is_deleted=false
           AND expiration_date>=(date_trunc('day',now() AT TIME ZONE 'Asia/Ho_Chi_Minh') AT TIME ZONE 'Asia/Ho_Chi_Minh');
       IF fb_products=0 THEN RAISE EXCEPTION 'ACCOUNT_TYPE_UNAVAILABLE'; END IF;
       SELECT count(*) INTO fb_count FROM public.auto_accounts account WHERE account.staff_id=staff_id AND account.organization_id=org_id
         AND account.flatform_type='facebook' AND NOT coalesce(account.is_delete,false);
       IF fb_max IS NOT NULL AND fb_count>=fb_max THEN RAISE EXCEPTION 'ACCOUNT_LIMIT_REACHED'; END IF;
     END IF;
     BEGIN
       -- Cùng cột như app Desktop (accountRepository.createAccount) và Control API; trigger kiểm gói / hạn mức Zalo.
       INSERT INTO public.auto_accounts(name,flatform_type,is_zalo_show_web,is_zalo_server,login_status,status,is_active,rate_limit_minutes,staff_id,organization_id,is_delete)
       VALUES(left(coalesce(nullif(btrim(payload->>'name'),''),'akaBiz '||source_key),200),platform,acc_type='zalo_web',acc_type='zalo_server',
         'chưa đăng nhập','chờ xử lý',coalesce((payload->>'isActive')::boolean,true),65,staff_id,org_id,false)
       RETURNING id INTO target;
     EXCEPTION WHEN raise_exception THEN
       GET STACKED DIAGNOSTICS err=MESSAGE_TEXT;
       IF err='zalo_account_limit_reached' THEN RAISE EXCEPTION 'ACCOUNT_LIMIT_REACHED';
       ELSIF err='zalo_account_capability_unavailable' THEN RAISE EXCEPTION 'ACCOUNT_TYPE_UNAVAILABLE';
       ELSE RAISE EXCEPTION 'ACCOUNT_CREATE_REJECTED: %',err; END IF;
     END;
     created:=true;
   END IF;
   IF NOT dry THEN
     IF h.id IS NULL THEN n.target_id:=target; n.state:='complete'; n.data:=jsonb_build_object('created',created,'type',acc_type); INSERT INTO public.akabiz_zalo_import_history SELECT n.*;
     ELSIF h.target_id IS DISTINCT FROM target THEN UPDATE public.akabiz_zalo_import_history SET target_id=target,state='complete',error_code=NULL,data=jsonb_build_object('created',created,'type',acc_type),updated_at=clock_timestamp() WHERE id=h.id; END IF;
   END IF;
   SELECT * INTO a FROM public.auto_accounts WHERE id=target;
   RETURN jsonb_build_object('accountId',target::text,'created',created,
     'type',CASE WHEN a.flatform_type='facebook' THEN 'facebook' WHEN coalesce(a.is_zalo_show_web,false) THEN 'zalo_web' WHEN coalesce(a.is_zalo_server,false) THEN 'zalo_server' ELSE 'zalo_qr' END);
 END IF;

 IF op='tag' AND entity_kind='tag' THEN
   IF h.target_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.auto_contact_tags t WHERE t.id=h.target_id AND t.staff_id=staff_id AND t.organization_id=org_id AND NOT coalesce(t.is_delete,false)) THEN
     RETURN jsonb_build_object('tagId',h.target_id::text);
   END IF;
   IF dry THEN RETURN jsonb_build_object('tagId',NULL); END IF;
   IF coalesce(btrim(payload->>'name'),'')='' THEN RAISE EXCEPTION 'IMPORT_PAYLOAD_INVALID'; END IF;
   INSERT INTO public.auto_contact_tags(name,color,staff_id,organization_id,is_delete)
     VALUES(left(btrim(payload->>'name'),200),nullif(payload->>'color',''),staff_id,org_id,false) RETURNING id INTO target;
   IF h.id IS NULL THEN n.target_id:=target; n.state:='complete'; INSERT INTO public.akabiz_zalo_import_history SELECT n.*;
   ELSE UPDATE public.akabiz_zalo_import_history SET target_id=target,state='complete',updated_at=clock_timestamp() WHERE id=h.id; END IF;
   RETURN jsonb_build_object('tagId',target::text);
 END IF;

 IF entity_kind<>'campaign' OR op NOT IN ('campaign','campaign_state','inputs','publish') THEN RAISE EXCEPTION 'IMPORT_PAYLOAD_INVALID'; END IF;
 IF h.target_id IS NOT NULL THEN
   SELECT * INTO c FROM public.auto_campaigns WHERE id=h.target_id AND auto_campaigns.staff_id=staff_id AND organization_id=org_id;
   IF c.id IS NULL THEN RAISE EXCEPTION 'TARGET_CONFLICT'; END IF;
   IF h.state='complete' THEN
     RETURN jsonb_build_object('state','complete','campaignId',c.id::text);
   END IF;
   IF c.is_delete IS DISTINCT FROM true OR c.status IS DISTINCT FROM h.data->>'desired_status' THEN RAISE EXCEPTION 'TARGET_CONFLICT'; END IF;
 END IF;

 IF op='campaign_state' THEN
   RETURN jsonb_build_object('state',CASE WHEN h.id IS NULL THEN 'none' WHEN h.target_id IS NULL THEN h.state ELSE 'staged' END,
     'campaignId',h.target_id::text,'errorCode',h.error_code,
     'cursor',jsonb_build_object('afterId',h.data->'after_id','consumed',coalesce((h.data->>'consumed_count')::integer,0)),
     'expected',(h.data->>'expected_count')::integer,'imported',coalesce((h.data->>'imported_count')::integer,0));
 END IF;

 IF op='campaign' THEN
   IF dry THEN RAISE EXCEPTION 'IMPORT_PAYLOAD_INVALID'; END IF;
   IF h.target_id IS NOT NULL THEN
     IF h.source_version IS DISTINCT FROM n.source_version THEN
       -- Nguồn đổi giữa lượt: loại chiến dịch / tài khoản nguồn đổi khi bản chép còn ẩn: bỏ dòng đã chép, dựng bản chép mới bên dưới
       -- (bản ẩn cũ giữ is_delete=true, không còn dòng nào).
       DELETE FROM public.auto_campaign_input_data WHERE campaign_id=c.id;
     ELSE
       -- Nguồn đổi giữa lượt: số dòng nguồn có thể đổi giữa hai lượt (akaBiz Auto vẫn chạy): ghi số mới để đối chiếu.
       IF coalesce((payload->>'expected_count')::bigint,-1)>=0 THEN
         UPDATE public.akabiz_zalo_import_history SET data=data||jsonb_build_object('expected_count',(payload->>'expected_count')::integer),
           updated_at=clock_timestamp() WHERE id=h.id RETURNING * INTO h;
       END IF;
       RETURN jsonb_build_object('state','staged','campaignId',c.id::text,
         'cursor',jsonb_build_object('afterId',h.data->'after_id','consumed',coalesce((h.data->>'consumed_count')::integer,0)));
     END IF;
   END IF;
   config:=payload->'campaign'; desired:=payload->>'desiredStatus';
   IF desired NOT IN ('tạm dừng','hoàn thành') OR coalesce((payload->>'expected_count')::bigint,-1)<0 OR jsonb_typeof(config) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'IMPORT_PAYLOAD_INVALID'; END IF;
   SELECT * INTO a FROM public.auto_accounts WHERE id=(config->>'accountId')::bigint AND auto_accounts.staff_id=staff_id AND organization_id=org_id AND NOT coalesce(is_delete,false) FOR SHARE;
   IF a.id IS NULL OR NOT EXISTS(SELECT 1 FROM public.akabiz_zalo_import_history x WHERE x.kind='account' AND x.target_id=a.id AND x.state='complete'
     AND x.source_id=n.parent_source_id AND x.source_account_id=src_account AND x.source_staff_id=src_staff AND x.target_staff_id=staff_id AND x.target_organization_id=org_id) THEN RAISE EXCEPTION 'TARGET_CONFLICT'; END IF;
   IF NOT EXISTS(SELECT 1 FROM public.auto_campaign_actions ac WHERE ac.id=config->>'actionId' AND ac.is_active=true AND NOT coalesce(ac.is_delete,false)
     AND ac.flatform_type=a.flatform_type) THEN RAISE EXCEPTION 'ACTION_UNAVAILABLE'; END IF;
   INSERT INTO public.auto_campaigns(name,account_id,action_id,status,is_delete,staff_id,organization_id,schedule,original_schedule,
     schedule_type,schedule_end_date,schedule_days,schedule_week_days,daily_stop_time,continue_next_day,refresh_data,time_sleep_between_2,content,images,extra_settings,completed_at)
   VALUES(left(config->>'name',500),a.id,config->>'actionId',desired,true,staff_id,org_id,(config->>'schedule')::timestamptz,(config->>'originalSchedule')::timestamptz,
     config->>'scheduleType',(config->>'scheduleEndDate')::timestamptz,config->>'scheduleDays',config->>'scheduleWeekDays',(config->>'dailyStopTime')::time,
     coalesce((config->>'continueNextDay')::boolean,false),coalesce((config->>'refreshData')::boolean,false),(config->>'timeSleepBetween2')::integer,
     config->>'content',coalesce(config->'images','[]'::jsonb),coalesce(config->'extraSettings','{}'::jsonb),
     CASE WHEN desired='hoàn thành' THEN coalesce((config->>'completedAt')::timestamptz,clock_timestamp()) END) RETURNING * INTO c;
   n.target_id:=c.id; n.data:=jsonb_build_object('desired_status',desired,'expected_count',(payload->>'expected_count')::integer,
     'consumed_count',0,'imported_count',0,'after_id',NULL);
   IF h.id IS NULL THEN INSERT INTO public.akabiz_zalo_import_history SELECT n.*;
   ELSE UPDATE public.akabiz_zalo_import_history SET target_id=n.target_id,parent_source_id=n.parent_source_id,source_version=n.source_version,
     source_status=n.source_status,state='pending',data=n.data,adjustments=n.adjustments,error_code=NULL,updated_at=clock_timestamp() WHERE id=h.id; END IF;
   RETURN jsonb_build_object('state','staged','campaignId',c.id::text,'cursor',jsonb_build_object('afterId',NULL,'consumed',0));
 END IF;

 IF h.target_id IS NULL OR dry THEN RAISE EXCEPTION 'IMPORT_PAYLOAD_INVALID'; END IF;

 IF op='inputs' THEN
   consumed:=(payload->>'consumed')::integer; batch_hash:=md5(coalesce(payload->'inputs','[]'::jsonb)::text||':'||coalesce(payload->>'after_id',''));
   IF jsonb_typeof(payload->'inputs') IS DISTINCT FROM 'array' OR consumed IS NULL OR consumed<1 OR consumed>500
     OR jsonb_array_length(payload->'inputs')>consumed OR (payload->>'after_id')::bigint IS NULL THEN RAISE EXCEPTION 'IMPORT_PAYLOAD_INVALID'; END IF;
   IF (h.data->'after_id') IS DISTINCT FROM coalesce(payload->'expected_after_id','null'::jsonb) THEN
     -- Mất câu trả lời rồi gửi lại đúng lô vừa ghi: trả tiến độ, không ghi lại.
     IF h.data->'after_id'=payload->'after_id' AND h.data->>'last_batch_hash'=batch_hash THEN
       RETURN jsonb_build_object('cursor',jsonb_build_object('afterId',h.data->'after_id','consumed',(h.data->>'consumed_count')::integer),
         'imported',(h.data->>'imported_count')::integer,'replayed',true);
     END IF;
     RAISE EXCEPTION 'IMPORT_CURSOR_CONFLICT';
   END IF;
   IF (payload->>'after_id')::bigint<=coalesce((h.data->>'after_id')::bigint,-1) THEN RAISE EXCEPTION 'IMPORT_PAYLOAD_INVALID'; END IF;
   FOR item IN SELECT value FROM jsonb_array_elements(payload->'inputs') LOOP
     IF item->>'status' NOT IN ('chờ xử lý','tạm dừng','hoàn thành') THEN RAISE EXCEPTION 'UNKNOWN_DETAIL_STATUS'; END IF;
     INSERT INTO public.auto_campaign_input_data(campaign_id,name,phone,uid,email,info1,info2,info3,info4,info5,status,is_delete)
       VALUES(c.id,item->>'name',item->>'phone',item->>'uid',item->>'email',item->>'info1',item->>'info2',item->>'info3',item->>'info4',item->>'info5',item->>'status',false);
   END LOOP;
   UPDATE public.akabiz_zalo_import_history SET data=data||jsonb_build_object('after_id',(payload->>'after_id')::bigint,
       'consumed_count',(data->>'consumed_count')::integer+consumed,'imported_count',(data->>'imported_count')::integer+jsonb_array_length(payload->'inputs'),
       'last_batch_hash',batch_hash),error_code=NULL,state='pending',updated_at=clock_timestamp()
     WHERE id=h.id RETURNING * INTO h;
   RETURN jsonb_build_object('cursor',jsonb_build_object('afterId',h.data->'after_id','consumed',(h.data->>'consumed_count')::integer),
     'imported',(h.data->>'imported_count')::integer,'replayed',false);
 END IF;

 -- publish
 -- Nguồn đổi giữa lượt: bên đọc gửi after_id = con trỏ nó đã đọc hết tới (không còn dòng nào sau đó); phải trùng con trỏ máy chủ.
 IF payload ? 'after_id' THEN
   IF (payload->'after_id') IS DISTINCT FROM coalesce(h.data->'after_id','null'::jsonb) THEN RAISE EXCEPTION 'IMPORT_INCOMPLETE'; END IF;
 ELSIF (h.data->>'consumed_count')::integer IS DISTINCT FROM (h.data->>'expected_count')::integer THEN RAISE EXCEPTION 'IMPORT_INCOMPLETE'; END IF;
 SELECT count(*) INTO actual_count FROM public.auto_campaign_input_data i WHERE i.campaign_id=c.id AND NOT coalesce(i.is_delete,false);
 IF actual_count IS DISTINCT FROM (h.data->>'imported_count')::bigint THEN RAISE EXCEPTION 'TARGET_CONFLICT'; END IF;
 PERFORM 1 FROM public.auto_accounts account WHERE account.id=c.account_id AND account.staff_id=staff_id AND account.organization_id=org_id
   AND NOT coalesce(account.is_delete,false) FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'TARGET_CONFLICT'; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(CASE WHEN jsonb_typeof(c.extra_settings->'akaBizTagIds')='array' THEN c.extra_settings->'akaBizTagIds' ELSE '[]'::jsonb END) LOOP
   PERFORM 1 FROM public.auto_contact_tags t WHERE t.id=(item#>>'{}')::bigint AND t.staff_id=staff_id AND t.organization_id=org_id AND NOT coalesce(t.is_delete,false) FOR SHARE;
   IF NOT FOUND THEN RAISE EXCEPTION 'TARGET_CONFLICT'; END IF;
 END LOOP;
 UPDATE public.auto_campaigns SET is_delete=false,updated_at=clock_timestamp() WHERE id=c.id;
 UPDATE public.akabiz_zalo_import_history SET state='complete',error_code=NULL,
   data=data||jsonb_build_object('expected_count',(data->>'consumed_count')::integer),updated_at=clock_timestamp() WHERE id=h.id;
 RETURN jsonb_build_object('state','complete','campaignId',c.id::text);
END;
$function$;
$create$;

 SELECT md5(pg_get_functiondef('public.akabiz_import_auto_desktop_v1(jsonb)'::regprocedure)) INTO v_body;
 IF v_body IS DISTINCT FROM 'a4684e49cede91e434f99701b3e394e3' THEN
   RAISE EXCEPTION 'V625 postflight: thân hàm sau khi thay không như mong đợi: %', v_body;
 END IF;
END $v625$;
