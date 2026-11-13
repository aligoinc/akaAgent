-- V524: Tương tác Zalo — nhánh nạp danh mục (catalog) của aka_agent_campaign_engagement_batch đi
-- chỉ mục auto_campaign_engagement_catalog theo đúng thứ tự con trỏ (tracking_until,
-- campaign_detail_id) và dừng khi đủ 500 lượt hợp lệ; mỗi lượt kiểm sở hữu bằng khoá chính
-- (CROSS JOIN LATERAL … LIMIT 1, như nhánh đăng ký của V510). Thân V510 JOIN kết quả gửi/chiến
-- dịch/tài khoản cho MỌI lượt còn lại của (tổ chức, nhân viên) rồi mới sắp xếp và lấy 500: staff
-- 1988 (8.353 lượt) trang đầu 6,0 s khi nguội (10.669 trang auto_campaign_details), quét đủ một
-- lượt tốn O(N²/500) lượt-join. Worker Fly nạp hết danh mục mỗi lần khởi động. Xem
-- docs/ZALO_CAMPAIGN_ENGAGEMENT_V524.md.
-- Chỉ thay câu SELECT của nhánh catalog; các nhánh khác giữ nguyên từng byte; tập dòng, thứ tự,
-- catalogCursor, catalogDone như V510. Giữ chữ ký, owner, SECURITY DEFINER, VOLATILE, search_path,
-- statement_timeout 15s và ACL. Không đổi bảng/index/quyền/công tắc, không cần phát hành app.
-- CREATE OR REPLACE FUNCTION là DDL ⇒ PostgREST nạp lại schema: apply ngoài giờ cao điểm.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $preflight$
DECLARE v_oid oid := to_regprocedure('public.aka_agent_campaign_engagement_batch(bigint,bigint,text,jsonb,text,text,text)'); v_checksum text;
BEGIN
 IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
   IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v524_%') THEN
     RAISE EXCEPTION 'v524 already recorded in supabase_migrations.schema_migrations';
   END IF;
 END IF;
 IF v_oid IS NULL THEN RAISE EXCEPTION 'v524 engagement batch missing'; END IF;
 SELECT md5(prosrc) INTO v_checksum FROM pg_proc WHERE oid=v_oid;
 IF v_checksum IS DISTINCT FROM 'dd6cf2bd1f75998521d98ee46d8fff0e' THEN
   RAISE EXCEPTION 'v524 engagement batch drift (expected V510 body): %',v_checksum;
 END IF;
 IF EXISTS (SELECT 1 FROM pg_proc WHERE oid=v_oid AND (
   pg_get_userbyid(proowner)<>'postgres' OR NOT prosecdef OR provolatile<>'v'
   OR proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public','statement_timeout=15s']::text[]
   OR proacl::text IS DISTINCT FROM '{postgres=X/postgres}')) THEN
   RAISE EXCEPTION 'v524 engagement function attributes drift';
 END IF;
 -- The new body walks this index in cursor order.
 IF NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_am am ON am.oid=c.relam
   WHERE i.indexrelid=to_regclass('public.auto_campaign_engagement_catalog') AND am.amname='btree' AND i.indisvalid
     AND i.indpred IS NULL AND i.indexprs IS NULL AND i.indrelid='public.auto_campaign_detail_zalo_engagement'::regclass
     AND (SELECT array_agg(a.attname::text ORDER BY k.n) FROM unnest(i.indkey::int2[]) WITH ORDINALITY k(attnum,n)
       JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.attnum)=ARRAY['organization_id','staff_id','tracking_until','campaign_detail_id']) THEN
   RAISE EXCEPTION 'v524 catalog index missing or changed';
 END IF;
 -- LATERAL ... LIMIT 1 drops exactly the rows the V510 joins dropped only while each probed key is unique.
 IF EXISTS (SELECT 1 FROM (VALUES ('public.auto_campaign_details'),('public.auto_campaigns'),('public.auto_accounts'),('public.zalo_accounts')) k(rel)
   WHERE NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=i.indkey[0]
     WHERE i.indrelid=k.rel::regclass AND i.indisunique AND i.indisvalid AND i.indpred IS NULL AND i.indexprs IS NULL
       AND i.indnkeyatts=1 AND a.attname='id')) THEN
   RAISE EXCEPTION 'v524 ownership probes need a unique id key';
 END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.aka_agent_campaign_engagement_batch(p_staff_id bigint, p_organization_id bigint, p_revision text, p_items jsonb, p_mode text, p_auth_username text, p_auth_password text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET statement_timeout TO '15s'
AS $function$
DECLARE
 v_enabled boolean; v_revision text; v_window integer := 48; v_window_raw text; v_lock_key text;
 v_after bigint := 0; v_through bigint; v_catalog_from timestamptz; v_catalog_until timestamptz; v_catalog_id bigint;
 v_result jsonb; v_updated integer := 0; v_invalid text[] := '{}'; v_skipped integer := 0;
 v_ids bigint[];
BEGIN
 PERFORM public.auto_assert_automation_identity(p_staff_id,p_organization_id,p_auth_username,p_auth_password);
 IF p_staff_id IS NULL OR p_organization_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.org_staff WHERE id=p_staff_id AND organization_id=p_organization_id AND is_active=true) THEN RAISE EXCEPTION 'engagement_owner_invalid'; END IF;
 IF p_mode NOT IN ('register','events','read') OR jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items)>500 THEN RAISE EXCEPTION 'engagement_batch_invalid'; END IF;
 SELECT is_active AND NOT is_secret AND value='true',updated_at::text INTO v_enabled,v_revision FROM public.auto_system_settings WHERE key='zalo.campaign_engagement.enabled';
 -- Compare timestamps, not serializer formatting (PostgREST uses ISO, SQL uses a space).
 IF v_enabled IS DISTINCT FROM true OR p_revision IS NULL OR p_revision::timestamptz IS DISTINCT FROM v_revision::timestamptz THEN
   RETURN jsonb_build_object('enabled',false,'revision',v_revision,'items','[]'::jsonb,'updated',0);
 END IF;
 IF p_mode='register' THEN
   -- v510: every lookup starts from the requested detail IDs (primary keys).
   -- (staff_id, organization_id) are correlated, so the planner estimates ~1 row
   -- for "this staff's campaigns" and would otherwise start there and read the
   -- staff's whole send history (19.5 s for one staff on 12/11/2026).
   -- LATERAL ... LIMIT 1 cannot be flattened, so each lookup stays a key probe.
   v_ids:=ARRAY(SELECT DISTINCT (i->>'detailId')::bigint FROM jsonb_array_elements(p_items) i);
   -- Serialize only source registration versus Chat's inbox acknowledgement for
   -- the same recipient. A consumer must not see neither the source nor its event.
   FOR v_lock_key IN
     SELECT DISTINCT 'campaign-engagement:'||c.organization_id::text||':'||d.account_id::text||':'||
       (d.data#>>'{zaloEngagementSource,accountZaloUid}')||':'||(d.data#>>'{zaloEngagementSource,targetZaloUid}')
     FROM unnest(v_ids) w(id)
     CROSS JOIN LATERAL (SELECT x.account_id,x.campaign_id,x.data FROM public.auto_campaign_details x
       WHERE x.id=w.id AND x.is_delete=false AND x.data->'zaloEngagementSource' IS NOT NULL LIMIT 1) d
     CROSS JOIN LATERAL (SELECT y.organization_id FROM public.auto_campaigns y
       WHERE y.id=d.campaign_id AND y.staff_id=p_staff_id AND y.organization_id=p_organization_id LIMIT 1) c
     ORDER BY 1
   LOOP
     PERFORM pg_advisory_xact_lock(hashtextextended(v_lock_key,0));
   END LOOP;
   SELECT value INTO v_window_raw FROM public.auto_system_settings WHERE key='zalo.campaign_engagement.tracking_window_hours' AND is_active AND NOT is_secret;
   IF v_window_raw ~ '^[0-9]{1,9}$' AND v_window_raw::integer BETWEEN 1 AND 720 THEN v_window:=v_window_raw::integer; END IF;
   WITH sources AS MATERIALIZED (
     SELECT d.id,d.account_id,c.staff_id,c.organization_id,d.data->'zaloEngagementSource' AS s
     FROM unnest(v_ids) w(id)
     CROSS JOIN LATERAL (SELECT x.id,x.account_id,x.campaign_id,x.action_code,x.data FROM public.auto_campaign_details x
       WHERE x.id=w.id AND x.is_delete=false AND x.status='thành công' LIMIT 1) d
     CROSS JOIN LATERAL (SELECT y.staff_id,y.organization_id FROM public.auto_campaigns y
       WHERE y.id=d.campaign_id AND y.staff_id=p_staff_id AND y.organization_id=p_organization_id AND y.is_delete=false LIMIT 1) c
     CROSS JOIN LATERAL (SELECT x.id,x.organization_id,x.zalo_account_id FROM public.auto_accounts x
       WHERE x.id=d.account_id AND x.staff_id=c.staff_id AND x.organization_id=c.organization_id AND x.is_delete=false
         AND x.flatform_type='zalo' AND NOT COALESCE(x.is_zalo_show_web,false) LIMIT 1) a
     LEFT JOIN LATERAL (SELECT x.zalo_uid FROM public.zalo_accounts x WHERE x.id=a.zalo_account_id LIMIT 1) z ON true
     WHERE COALESCE((SELECT ca.zalo_id FROM public.chat_zalo_account_organization b JOIN public.chat_zalo_account ca ON ca.id=b.chat_zalo_account_id
       WHERE b.auto_account_id=a.id AND b.organization_id=a.organization_id AND b.is_active LIMIT 1),z.zalo_uid)=d.data#>>'{zaloEngagementSource,accountZaloUid}'
       AND (d.data#>>'{zaloEngagementSource,revision}')::timestamptz=v_revision::timestamptz
       AND d.data#>>'{zaloEngagementSource,version}'='1'
       AND d.action_code IN ('zalo_message_friend','zalo_message_stranger','zalo_add_friend')
       AND d.data->'partialSend' IS NULL
       AND d.data#>>'{zaloEngagementSource,actionType}'=CASE WHEN d.action_code='zalo_add_friend' THEN 'friend_request' ELSE 'message' END
   ), inserted AS (
     INSERT INTO public.auto_campaign_detail_zalo_engagement(campaign_detail_id,organization_id,staff_id,account_id,account_zalo_uid,target_zalo_uid,action_type,sent_at,tracking_until,message_ids)
     SELECT DISTINCT ON (id) id,organization_id,staff_id,account_id,s->>'accountZaloUid',s->>'targetZaloUid',s->>'actionType',
       (s->>'sentAt')::timestamptz,(s->>'sentAt')::timestamptz + make_interval(hours=>v_window),
       ARRAY(SELECT DISTINCT jsonb_array_elements_text(s->'messageIds'))
     FROM sources WHERE s->>'accountZaloUid'<>s->>'targetZaloUid'
     ON CONFLICT (campaign_detail_id) DO NOTHING RETURNING campaign_detail_id
   ) SELECT count(*) INTO v_updated FROM inserted;
   -- Reconcile only normalized metadata already persisted by Chat. No Zalo API,
   -- no historical conversation scan; the new index narrows by binding/UID/target/time.
   WITH watches AS MATERIALIZED (
     SELECT e.campaign_detail_id,e.organization_id,e.account_zalo_uid,e.target_zalo_uid,e.action_type,
       e.sent_at,e.tracking_until,e.message_ids,b.id AS binding_id
     FROM unnest(v_ids) w(id)
     CROSS JOIN LATERAL (SELECT x.* FROM public.auto_campaign_detail_zalo_engagement x
       WHERE x.campaign_detail_id=w.id AND x.staff_id=p_staff_id AND x.organization_id=p_organization_id LIMIT 1) e
     CROSS JOIN LATERAL (SELECT x.campaign_id FROM public.auto_campaign_details x
       WHERE x.id=e.campaign_detail_id AND x.is_delete=false LIMIT 1) detail
     CROSS JOIN LATERAL (SELECT 1 FROM public.auto_campaigns x WHERE x.id=detail.campaign_id AND x.staff_id=p_staff_id
       AND x.organization_id=p_organization_id AND x.is_delete=false LIMIT 1) campaign
     CROSS JOIN LATERAL (SELECT 1 FROM public.auto_accounts x WHERE x.id=e.account_id AND x.staff_id=p_staff_id
       AND x.organization_id=p_organization_id AND x.is_delete=false AND NOT COALESCE(x.is_zalo_show_web,false) LIMIT 1) owner
     JOIN public.chat_zalo_account_organization b ON b.auto_account_id=e.account_id AND b.organization_id=e.organization_id AND b.is_active
     JOIN public.chat_zalo_account profile ON profile.id=b.chat_zalo_account_id AND profile.zalo_id=e.account_zalo_uid
   ), matches AS MATERIALIZED (
     SELECT e.campaign_detail_id,
       min(i.engagement_occurred_at) FILTER (WHERE v.event->>'kind'='seen' AND e.action_type='message'
         AND e.message_ids && ARRAY(SELECT jsonb_array_elements_text(v.event->'messageIds'))) seen,
       min(i.engagement_occurred_at) FILTER (WHERE v.event->>'kind'='message' AND e.action_type='message') responded,
       min(i.engagement_occurred_at) FILTER (WHERE v.event->>'kind'='friend' AND e.action_type='friend_request') friended,
       min(i.engagement_occurred_at) FILTER (WHERE v.event->>'kind'='reaction' AND e.action_type='message'
         AND e.message_ids && ARRAY(SELECT jsonb_array_elements_text(v.event->'messageIds'))) reacted
     FROM watches e
     CROSS JOIN LATERAL (SELECT x.engagement_occurred_at,x.engagement_payload FROM public.chat_zalo_runtime_event x
       WHERE x.organization_id=e.organization_id AND x.chat_zalo_account_organization_id=e.binding_id
         AND x.engagement_account_uid=e.account_zalo_uid AND x.engagement_target_uid=e.target_zalo_uid
         AND x.engagement_occurred_at BETWEEN e.sent_at AND e.tracking_until AND x.engagement_payload IS NOT NULL
         AND x.engagement_state IN ('pending','done')
         AND x.engagement_revision::timestamptz=v_revision::timestamptz
         AND x.engagement_payload->>'staffId'=p_staff_id::text
       OFFSET 0) i
     CROSS JOIN LATERAL jsonb_array_elements(i.engagement_payload->'events') v(event)
     GROUP BY e.campaign_detail_id
   ) UPDATE public.auto_campaign_detail_zalo_engagement e SET
     seen_at=least(e.seen_at,m.seen),responded_at=least(e.responded_at,m.responded),reacted_at=least(e.reacted_at,m.reacted),friended_at=least(e.friended_at,m.friended),updated_at=now()
     FROM matches m WHERE m.campaign_detail_id=e.campaign_detail_id AND (
       (m.seen IS NOT NULL AND (e.seen_at IS NULL OR m.seen<e.seen_at)) OR
         (m.responded IS NOT NULL AND (e.responded_at IS NULL OR m.responded<e.responded_at)) OR
       (m.reacted IS NOT NULL AND (e.reacted_at IS NULL OR m.reacted<e.reacted_at)) OR
       (m.friended IS NOT NULL AND (e.friended_at IS NULL OR m.friended<e.friended_at)));
   WITH owned AS MATERIALIZED (
     SELECT d.id FROM unnest(v_ids) w(id)
     CROSS JOIN LATERAL (SELECT x.id,x.campaign_id FROM public.auto_campaign_details x
       WHERE x.id=w.id AND x.data->>'zaloEngagementPending'='true'
         AND COALESCE(x.data->>'zaloEngagementRuntime','desktop') IN ('desktop','chat') LIMIT 1) d
     CROSS JOIN LATERAL (SELECT 1 FROM public.auto_campaigns x WHERE x.id=d.campaign_id AND x.staff_id=p_staff_id
       AND x.organization_id=p_organization_id LIMIT 1) c
   ) UPDATE public.auto_campaign_details d SET data=d.data-'zaloEngagementPending'
    FROM owned o WHERE d.id=o.id
    AND d.data->>'zaloEngagementPending'='true' AND COALESCE(d.data->>'zaloEngagementRuntime','desktop') IN ('desktop','chat');
   SELECT COALESCE(jsonb_agg(to_jsonb(e)),'[]') INTO v_result FROM jsonb_array_elements(p_items) i
    CROSS JOIN LATERAL (SELECT x.* FROM public.auto_campaign_detail_zalo_engagement x
      WHERE x.campaign_detail_id=(i->>'detailId')::bigint AND x.staff_id=p_staff_id AND x.organization_id=p_organization_id LIMIT 1) e;
 ELSIF p_mode='read' AND jsonb_array_length(p_items)=1 AND p_items->0 ? 'catalog' THEN
   -- Bounded startup/revision warm-up, never a lookup triggered by an unknown event.
   v_catalog_from:=COALESCE((p_items#>>'{0,catalog,from}')::timestamptz,now());
   v_catalog_until:=COALESCE((p_items#>>'{0,catalog,until}')::timestamptz,v_catalog_from);
   v_catalog_id:=COALESCE((p_items#>>'{0,catalog,id}')::bigint,0);
   -- v524: walk auto_campaign_engagement_catalog in cursor order and stop at 500 owned
   -- rows. Every ownership check is a primary-key probe inside LATERAL ... LIMIT 1 (never
   -- flattened, estimated one row), so the planner keeps the ordered index walk instead of
   -- joining every remaining watch of the owner and sorting them for each page (O(N^2/500)
   -- per sweep; staff 1988, 8,353 watches: 6.0 s cold first page on 13/11/2026). The probes
   -- drop exactly the rows the V510 joins dropped; the cursor is still the last returned row.
   SELECT COALESCE(jsonb_agg(to_jsonb(w) ORDER BY w.tracking_until,w.campaign_detail_id),'[]') INTO v_result FROM (
     SELECT e.* FROM public.auto_campaign_detail_zalo_engagement e
     CROSS JOIN LATERAL (SELECT x.campaign_id FROM public.auto_campaign_details x
       WHERE x.id=e.campaign_detail_id AND x.is_delete=false LIMIT 1) d
     CROSS JOIN LATERAL (SELECT 1 FROM public.auto_campaigns x WHERE x.id=d.campaign_id AND x.staff_id=p_staff_id
       AND x.organization_id=p_organization_id AND x.is_delete=false LIMIT 1) c
     CROSS JOIN LATERAL (SELECT 1 FROM public.auto_accounts a LEFT JOIN public.zalo_accounts z ON z.id=a.zalo_account_id
       WHERE a.id=e.account_id AND a.staff_id=p_staff_id AND a.organization_id=p_organization_id
         AND a.is_delete=false AND NOT COALESCE(a.is_zalo_show_web,false)
         AND COALESCE((SELECT ca.zalo_id FROM public.chat_zalo_account_organization b JOIN public.chat_zalo_account ca ON ca.id=b.chat_zalo_account_id
           WHERE b.auto_account_id=a.id AND b.organization_id=a.organization_id AND b.is_active LIMIT 1),z.zalo_uid)=e.account_zalo_uid
       LIMIT 1) owner
     WHERE e.organization_id=p_organization_id AND e.staff_id=p_staff_id AND e.tracking_until>=v_catalog_from
       AND (e.tracking_until,e.campaign_detail_id)>(v_catalog_until,v_catalog_id)
     ORDER BY e.tracking_until,e.campaign_detail_id LIMIT 500
   ) w;
   RETURN jsonb_build_object('enabled',true,'revision',v_revision,'items',v_result,'updated',0,
     'catalogCursor',jsonb_build_object('from',v_catalog_from::text,'until',COALESCE(v_result->-1->>'tracking_until',v_catalog_until::text),'id',COALESCE(v_result->-1->>'campaign_detail_id',v_catalog_id::text)),
     'catalogDone',jsonb_array_length(v_result)<500);
 ELSIF p_mode='read' AND jsonb_array_length(p_items)>0 AND p_items->0 ? 'operation' THEN
   IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_items) i WHERE NOT (i ? 'operation')) THEN RAISE EXCEPTION 'engagement_operations_invalid'; END IF;
   SELECT COALESCE(jsonb_agg(jsonb_build_object(
     'operationId',i.op->>'operationId',
     'status',CASE WHEN c.id IS NULL OR a.id IS NULL OR
       COALESCE((SELECT ca.zalo_id FROM public.chat_zalo_account_organization b JOIN public.chat_zalo_account ca ON ca.id=b.chat_zalo_account_id
         WHERE b.auto_account_id=a.id AND b.organization_id=a.organization_id AND b.is_active LIMIT 1),z.zalo_uid) IS DISTINCT FROM i.op->>'accountZaloUid'
       THEN 'invalid' WHEN d.id IS NULL THEN 'missing'
       WHEN d.is_delete OR d.status IS DISTINCT FROM 'thành công' OR
         d.data#>>'{zaloEngagementSource,accountZaloUid}' IS DISTINCT FROM i.op->>'accountZaloUid' OR
         d.data#>>'{zaloEngagementSource,targetZaloUid}' IS DISTINCT FROM i.op->>'targetZaloUid' OR
         (d.data#>>'{zaloEngagementSource,revision}')::timestamptz IS DISTINCT FROM v_revision::timestamptz THEN 'invalid'
       ELSE 'found' END,
     'detailId',d.id::text,'source',d.data->'zaloEngagementSource') ORDER BY i.ordinality),'[]') INTO v_result
   FROM (SELECT x.value->'operation' op,x.ordinality FROM jsonb_array_elements(p_items) WITH ORDINALITY x(value,ordinality)) i
   LEFT JOIN public.auto_campaigns c ON c.id=(i.op->>'campaignId')::bigint AND c.staff_id=p_staff_id AND c.organization_id=p_organization_id AND c.is_delete=false
   LEFT JOIN public.auto_accounts a ON a.id=(i.op->>'accountId')::bigint AND a.staff_id=p_staff_id AND a.organization_id=p_organization_id
     AND a.is_delete=false AND a.flatform_type='zalo' AND NOT COALESCE(a.is_zalo_show_web,false)
   LEFT JOIN public.zalo_accounts z ON z.id=a.zalo_account_id
   LEFT JOIN LATERAL (
     SELECT detail.id,detail.is_delete,detail.status,detail.data FROM public.auto_campaign_details detail
     WHERE detail.campaign_id=c.id AND detail.account_id=a.id
       AND detail.data#>>'{zaloEngagementSource,operationId}'=i.op->>'operationId'
       AND detail.data#>>'{zaloEngagementSource,operationId}' IS NOT NULL
     ORDER BY detail.id LIMIT 1
   ) d ON true;
   RETURN jsonb_build_object('enabled',true,'revision',v_revision,'operations',v_result,'items','[]'::jsonb,'updated',0);
 ELSIF p_mode='read' AND (jsonb_array_length(p_items)=0 OR
   (jsonb_array_length(p_items)=1 AND p_items->0 ? 'recovery')) THEN
   -- Freeze the upper source ID for this sweep. New sends cannot keep restored
   -- holds alive forever; callers only advance after retaining the entire page.
   v_after:=COALESCE((p_items#>>'{0,recovery,afterId}')::bigint,0);
   v_through:=(p_items#>>'{0,recovery,throughId}')::bigint;
   IF v_through IS NULL THEN
     -- v510: walk the small pending partial index (auto_campaign_engagement_source)
     -- instead of every campaign of the staff; ownership is a key probe per row.
     SELECT COALESCE((SELECT d.id FROM public.auto_campaign_details d
       CROSS JOIN LATERAL (SELECT 1 FROM public.auto_campaigns x WHERE x.id=d.campaign_id AND x.staff_id=p_staff_id
         AND x.organization_id=p_organization_id AND x.is_delete=false LIMIT 1) c
       WHERE d.data->>'zaloEngagementPending'='true' AND d.is_delete=false
         AND COALESCE(d.data->>'zaloEngagementRuntime','desktop')='desktop'
       ORDER BY d.id DESC LIMIT 1),0) INTO v_through;
   END IF;
   SELECT COALESCE(jsonb_agg(jsonb_build_object('detailId',pending.id::text,'source',pending.source) ORDER BY pending.id),'[]') INTO v_result FROM (
     SELECT d.id,d.data->'zaloEngagementSource' source FROM public.auto_campaign_details d
       CROSS JOIN LATERAL (SELECT 1 FROM public.auto_campaigns x WHERE x.id=d.campaign_id AND x.staff_id=p_staff_id
         AND x.organization_id=p_organization_id AND x.is_delete=false LIMIT 1) c
       WHERE d.data->>'zaloEngagementPending'='true' AND d.is_delete=false
         AND COALESCE(d.data->>'zaloEngagementRuntime','desktop')='desktop'
         AND d.id>v_after AND d.id<=v_through
       ORDER BY d.id LIMIT 500
   ) pending;
   v_after:=COALESCE((v_result->-1->>'detailId')::bigint,v_through);
   RETURN jsonb_build_object('enabled',true,'revision',v_revision,'pending',v_result,'items','[]'::jsonb,'updated',0,
     'recoveryCursor',jsonb_build_object('afterId',v_after::text,'throughId',v_through::text),
     'recoveryDone',jsonb_array_length(v_result)<500 OR v_after>=v_through);
 ELSE
   -- Reject stale runtime/account identity before joining any watch rows.
   SELECT COALESCE(array_agg(i.account_id::text||':'||i.own_uid),'{}') INTO v_invalid FROM (SELECT DISTINCT (x->>'accountId')::bigint account_id,x->>'accountZaloUid' own_uid FROM jsonb_array_elements(p_items) x) i
     LEFT JOIN public.auto_accounts a ON a.id=i.account_id AND a.staff_id=p_staff_id AND a.organization_id=p_organization_id
       AND a.is_delete=false AND a.flatform_type='zalo' AND NOT COALESCE(a.is_zalo_show_web,false)
     LEFT JOIN public.zalo_accounts z ON z.id=a.zalo_account_id
     WHERE a.id IS NULL OR COALESCE((SELECT ca.zalo_id FROM public.chat_zalo_account_organization b JOIN public.chat_zalo_account ca ON ca.id=b.chat_zalo_account_id
       WHERE b.auto_account_id=a.id AND b.organization_id=a.organization_id AND b.is_active LIMIT 1),z.zalo_uid) IS DISTINCT FROM i.own_uid
   ;
   v_skipped:=cardinality(v_invalid);
   IF v_skipped>0 THEN
     SELECT COALESCE(jsonb_agg(x),'[]') INTO p_items FROM jsonb_array_elements(p_items) x
       WHERE NOT ((x->>'accountId')||':'||(x->>'accountZaloUid')=ANY(v_invalid));
   END IF;
   IF p_mode='read' THEN
     SELECT COALESCE(jsonb_agg(to_jsonb(w)),'[]') INTO v_result FROM (
       SELECT DISTINCT e.* FROM jsonb_array_elements(p_items) i
       CROSS JOIN LATERAL (SELECT x.* FROM public.auto_campaign_detail_zalo_engagement x
         WHERE x.organization_id=p_organization_id AND x.staff_id=p_staff_id
           AND x.account_id=(i->>'accountId')::bigint AND x.account_zalo_uid=i->>'accountZaloUid' AND x.target_zalo_uid=i->>'targetZaloUid'
           AND x.sent_at <= (i->>'occurredAt')::timestamptz AND x.tracking_until >= (i->>'occurredAt')::timestamptz
         OFFSET 0) e
       CROSS JOIN LATERAL (SELECT x.campaign_id FROM public.auto_campaign_details x WHERE x.id=e.campaign_detail_id AND x.is_delete=false LIMIT 1) d
       CROSS JOIN LATERAL (SELECT 1 FROM public.auto_campaigns x WHERE x.id=d.campaign_id AND x.staff_id=p_staff_id
         AND x.organization_id=p_organization_id AND x.is_delete=false LIMIT 1) c
       ORDER BY e.campaign_detail_id LIMIT 1001
     ) w;
   ELSE
     WITH matches AS MATERIALIZED (
       SELECT e.campaign_detail_id,
        min((i->>'occurredAt')::timestamptz) FILTER (WHERE i->>'kind'='seen' AND e.action_type='message' AND e.message_ids && ARRAY(SELECT jsonb_array_elements_text(i->'messageIds'))) AS seen,
        min((i->>'occurredAt')::timestamptz) FILTER (WHERE i->>'kind'='message' AND e.action_type='message') AS responded,
        min((i->>'occurredAt')::timestamptz) FILTER (WHERE i->>'kind'='reaction' AND e.action_type='message' AND e.message_ids && ARRAY(SELECT jsonb_array_elements_text(i->'messageIds'))) AS reacted,
        min((i->>'occurredAt')::timestamptz) FILTER (WHERE i->>'kind'='friend' AND e.action_type='friend_request') AS friended
       FROM jsonb_array_elements(p_items) i
       CROSS JOIN LATERAL (SELECT x.* FROM public.auto_campaign_detail_zalo_engagement x
         WHERE x.organization_id=p_organization_id AND x.staff_id=p_staff_id
           AND x.account_id=(i->>'accountId')::bigint AND x.account_zalo_uid=i->>'accountZaloUid' AND x.target_zalo_uid=i->>'targetZaloUid'
           AND x.sent_at <= (i->>'occurredAt')::timestamptz AND x.tracking_until >= (i->>'occurredAt')::timestamptz
         OFFSET 0) e
       CROSS JOIN LATERAL (SELECT x.campaign_id FROM public.auto_campaign_details x WHERE x.id=e.campaign_detail_id AND x.is_delete=false LIMIT 1) d
       CROSS JOIN LATERAL (SELECT 1 FROM public.auto_campaigns x WHERE x.id=d.campaign_id AND x.staff_id=p_staff_id
         AND x.organization_id=p_organization_id AND x.is_delete=false LIMIT 1) c
       WHERE i->>'targetZaloUid'<>i->>'accountZaloUid' AND (
         (i->>'kind'='message' AND e.action_type='message' AND (e.responded_at IS NULL OR (i->>'occurredAt')::timestamptz<e.responded_at)) OR
         (i->>'kind'='seen' AND e.action_type='message' AND (e.seen_at IS NULL OR (i->>'occurredAt')::timestamptz<e.seen_at)
           AND e.message_ids && ARRAY(SELECT jsonb_array_elements_text(i->'messageIds'))) OR
         (i->>'kind'='reaction' AND e.action_type='message' AND (e.reacted_at IS NULL OR (i->>'occurredAt')::timestamptz<e.reacted_at)
           AND e.message_ids && ARRAY(SELECT jsonb_array_elements_text(i->'messageIds'))) OR
         (i->>'kind'='friend' AND e.action_type='friend_request' AND (e.friended_at IS NULL OR (i->>'occurredAt')::timestamptz<e.friended_at)))
       GROUP BY e.campaign_detail_id
     ), updated AS (
       UPDATE public.auto_campaign_detail_zalo_engagement e SET
         seen_at=least(e.seen_at,m.seen),responded_at=least(e.responded_at,m.responded),reacted_at=least(e.reacted_at,m.reacted),friended_at=least(e.friended_at,m.friended),updated_at=now()
       FROM matches m WHERE m.campaign_detail_id=e.campaign_detail_id AND (
         (m.seen IS NOT NULL AND (e.seen_at IS NULL OR m.seen<e.seen_at)) OR
         (m.responded IS NOT NULL AND (e.responded_at IS NULL OR m.responded<e.responded_at)) OR
         (m.reacted IS NOT NULL AND (e.reacted_at IS NULL OR m.reacted<e.reacted_at)) OR
         (m.friended IS NOT NULL AND (e.friended_at IS NULL OR m.friended<e.friended_at))) RETURNING e.campaign_detail_id
     ) SELECT count(*) INTO v_updated FROM updated;
     v_result:='[]';
   END IF;
 END IF;
 RETURN jsonb_build_object('enabled',true,'revision',v_revision,'items',v_result,'updated',v_updated,'skippedAccounts',v_skipped);
END
$function$
;

DO $postflight$
DECLARE v_oid oid := to_regprocedure('public.aka_agent_campaign_engagement_batch(bigint,bigint,text,jsonb,text,text,text)');
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid=v_oid AND md5(prosrc)='167571de84782301ddd8bcd1ad3b2f89'
   AND pg_get_userbyid(proowner)='postgres' AND prosecdef AND provolatile='v'
   AND proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog, public','statement_timeout=15s']::text[]
   AND proacl::text IS NOT DISTINCT FROM '{postgres=X/postgres}') THEN
   RAISE EXCEPTION 'v524 engagement function postflight mismatch';
 END IF;
END;
$postflight$;

COMMIT;
