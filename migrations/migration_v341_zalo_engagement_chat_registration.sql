-- Chat registration consumes its pending flag within the existing owner-checked RPC.
-- No new grants, signature, tables, settings, connections or schema reload.
DO $preflight$
DECLARE v_oid oid := to_regprocedure('public.aka_agent_campaign_engagement_batch(bigint,bigint,text,jsonb,text,text,text)'); v_checksum text;
BEGIN
 IF v_oid IS NULL THEN RAISE EXCEPTION 'v341 engagement batch missing'; END IF;
 SELECT md5(pg_get_functiondef(v_oid)) INTO v_checksum;
 IF v_checksum NOT IN ('0bdce96014857158991a7c0ce78e81ca','2bacb504c895ea6efd6a1d9b68d6e213') THEN
   RAISE EXCEPTION 'v341 engagement batch drift: %',v_checksum;
 END IF;
 IF EXISTS (SELECT 1 FROM pg_proc WHERE oid=v_oid AND (
   pg_get_userbyid(proowner)<>'postgres' OR NOT prosecdef OR provolatile<>'v'
   OR proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public','statement_timeout=15s']::text[]
   OR proacl::text IS DISTINCT FROM '{postgres=X/postgres}')) THEN
   RAISE EXCEPTION 'v341 engagement function attributes drift';
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
   -- Serialize only source registration versus Chat's inbox acknowledgement for
   -- the same recipient. A consumer must not see neither the source nor its event.
   FOR v_lock_key IN
     SELECT DISTINCT 'campaign-engagement:'||c.organization_id::text||':'||d.account_id::text||':'||
       (d.data#>>'{zaloEngagementSource,accountZaloUid}')||':'||(d.data#>>'{zaloEngagementSource,targetZaloUid}')
     FROM jsonb_array_elements(p_items) i JOIN public.auto_campaign_details d ON d.id=(i->>'detailId')::bigint
     JOIN public.auto_campaigns c ON c.id=d.campaign_id AND c.staff_id=p_staff_id AND c.organization_id=p_organization_id
     WHERE d.is_delete=false AND d.data->'zaloEngagementSource' IS NOT NULL
     ORDER BY 1
   LOOP
     PERFORM pg_advisory_xact_lock(hashtextextended(v_lock_key,0));
   END LOOP;
   SELECT value INTO v_window_raw FROM public.auto_system_settings WHERE key='zalo.campaign_engagement.tracking_window_hours' AND is_active AND NOT is_secret;
   IF v_window_raw ~ '^[0-9]{1,9}$' AND v_window_raw::integer BETWEEN 1 AND 720 THEN v_window:=v_window_raw::integer; END IF;
   WITH sources AS MATERIALIZED (
     SELECT d.id,d.account_id,c.staff_id,c.organization_id,d.data->'zaloEngagementSource' AS s
     FROM jsonb_array_elements(p_items) i
     JOIN public.auto_campaign_details d ON d.id=(i->>'detailId')::bigint AND d.is_delete=false AND d.status='thành công'
     JOIN public.auto_campaigns c ON c.id=d.campaign_id AND c.staff_id=p_staff_id AND c.organization_id=p_organization_id AND c.is_delete=false
     JOIN public.auto_accounts a ON a.id=d.account_id AND a.staff_id=c.staff_id AND a.organization_id=c.organization_id AND a.is_delete=false AND a.flatform_type='zalo' AND NOT COALESCE(a.is_zalo_show_web,false)
     LEFT JOIN public.zalo_accounts z ON z.id=a.zalo_account_id
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
   WITH matches AS MATERIALIZED (
     SELECT e.campaign_detail_id,
       min(i.engagement_occurred_at) FILTER (WHERE v.event->>'kind'='seen' AND e.action_type='message'
         AND e.message_ids && ARRAY(SELECT jsonb_array_elements_text(v.event->'messageIds'))) seen,
       min(i.engagement_occurred_at) FILTER (WHERE v.event->>'kind'='message' AND e.action_type='message') responded,
       min(i.engagement_occurred_at) FILTER (WHERE v.event->>'kind'='friend' AND e.action_type='friend_request') friended,
       min(i.engagement_occurred_at) FILTER (WHERE v.event->>'kind'='reaction' AND e.action_type='message'
         AND e.message_ids && ARRAY(SELECT jsonb_array_elements_text(v.event->'messageIds'))) reacted
     FROM jsonb_array_elements(p_items) wanted
     JOIN public.auto_campaign_detail_zalo_engagement e ON e.campaign_detail_id=(wanted->>'detailId')::bigint
       AND e.staff_id=p_staff_id AND e.organization_id=p_organization_id
     JOIN public.auto_campaign_details detail ON detail.id=e.campaign_detail_id AND detail.is_delete=false
     JOIN public.auto_campaigns campaign ON campaign.id=detail.campaign_id AND campaign.staff_id=p_staff_id
       AND campaign.organization_id=p_organization_id AND campaign.is_delete=false
     JOIN public.auto_accounts owner ON owner.id=e.account_id AND owner.staff_id=p_staff_id AND owner.organization_id=p_organization_id
       AND owner.is_delete=false AND NOT COALESCE(owner.is_zalo_show_web,false)
     JOIN public.chat_zalo_account_organization b ON b.auto_account_id=e.account_id AND b.organization_id=e.organization_id AND b.is_active
     JOIN public.chat_zalo_account profile ON profile.id=b.chat_zalo_account_id AND profile.zalo_id=e.account_zalo_uid
     JOIN public.chat_zalo_runtime_event i ON i.organization_id=e.organization_id AND i.chat_zalo_account_organization_id=b.id
       AND i.engagement_account_uid=e.account_zalo_uid AND i.engagement_target_uid=e.target_zalo_uid
       AND i.engagement_occurred_at BETWEEN e.sent_at AND e.tracking_until AND i.engagement_payload IS NOT NULL
       AND i.engagement_state IN ('pending','done')
       AND i.engagement_revision::timestamptz=v_revision::timestamptz
       AND i.engagement_payload->>'staffId'=p_staff_id::text
     CROSS JOIN LATERAL jsonb_array_elements(i.engagement_payload->'events') v(event)
     GROUP BY e.campaign_detail_id
   ) UPDATE public.auto_campaign_detail_zalo_engagement e SET
     seen_at=least(e.seen_at,m.seen),responded_at=least(e.responded_at,m.responded),reacted_at=least(e.reacted_at,m.reacted),friended_at=least(e.friended_at,m.friended),updated_at=now()
     FROM matches m WHERE m.campaign_detail_id=e.campaign_detail_id AND (
       (m.seen IS NOT NULL AND (e.seen_at IS NULL OR m.seen<e.seen_at)) OR
         (m.responded IS NOT NULL AND (e.responded_at IS NULL OR m.responded<e.responded_at)) OR
       (m.reacted IS NOT NULL AND (e.reacted_at IS NULL OR m.reacted<e.reacted_at)) OR
       (m.friended IS NOT NULL AND (e.friended_at IS NULL OR m.friended<e.friended_at)));
   UPDATE public.auto_campaign_details d SET data=d.data-'zaloEngagementPending'
    FROM public.auto_campaigns c WHERE c.id=d.campaign_id AND c.staff_id=p_staff_id AND c.organization_id=p_organization_id
    AND d.id IN (SELECT (x->>'detailId')::bigint FROM jsonb_array_elements(p_items) x)
    AND d.data->>'zaloEngagementPending'='true' AND COALESCE(d.data->>'zaloEngagementRuntime','desktop') IN ('desktop','chat');
   SELECT COALESCE(jsonb_agg(to_jsonb(e)),'[]') INTO v_result FROM public.auto_campaign_detail_zalo_engagement e
    JOIN jsonb_array_elements(p_items) i ON e.campaign_detail_id=(i->>'detailId')::bigint
    WHERE e.staff_id=p_staff_id AND e.organization_id=p_organization_id;
 ELSIF p_mode='read' AND jsonb_array_length(p_items)=1 AND p_items->0 ? 'catalog' THEN
   -- Bounded startup/revision warm-up, never a lookup triggered by an unknown event.
   v_catalog_from:=COALESCE((p_items#>>'{0,catalog,from}')::timestamptz,now());
   v_catalog_until:=COALESCE((p_items#>>'{0,catalog,until}')::timestamptz,v_catalog_from);
   v_catalog_id:=COALESCE((p_items#>>'{0,catalog,id}')::bigint,0);
   SELECT COALESCE(jsonb_agg(to_jsonb(w) ORDER BY w.tracking_until,w.campaign_detail_id),'[]') INTO v_result FROM (
     SELECT e.* FROM public.auto_campaign_detail_zalo_engagement e
     JOIN public.auto_campaign_details d ON d.id=e.campaign_detail_id AND d.is_delete=false
     JOIN public.auto_campaigns c ON c.id=d.campaign_id AND c.staff_id=p_staff_id AND c.organization_id=p_organization_id AND c.is_delete=false
     JOIN public.auto_accounts a ON a.id=e.account_id AND a.staff_id=p_staff_id AND a.organization_id=p_organization_id
       AND a.is_delete=false AND NOT COALESCE(a.is_zalo_show_web,false)
     LEFT JOIN public.zalo_accounts z ON z.id=a.zalo_account_id
     WHERE e.organization_id=p_organization_id AND e.staff_id=p_staff_id AND e.tracking_until>=v_catalog_from
       AND (e.tracking_until,e.campaign_detail_id)>(v_catalog_until,v_catalog_id)
       AND COALESCE((SELECT ca.zalo_id FROM public.chat_zalo_account_organization b JOIN public.chat_zalo_account ca ON ca.id=b.chat_zalo_account_id
         WHERE b.auto_account_id=a.id AND b.organization_id=a.organization_id AND b.is_active LIMIT 1),z.zalo_uid)=e.account_zalo_uid
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
     SELECT COALESCE(max(d.id),0) INTO v_through FROM public.auto_campaign_details d
       JOIN public.auto_campaigns c ON c.id=d.campaign_id AND c.staff_id=p_staff_id AND c.organization_id=p_organization_id
       WHERE d.data->>'zaloEngagementPending'='true' AND d.is_delete=false AND c.is_delete=false
         AND COALESCE(d.data->>'zaloEngagementRuntime','desktop')='desktop';
   END IF;
   SELECT COALESCE(jsonb_agg(jsonb_build_object('detailId',pending.id::text,'source',pending.source) ORDER BY pending.id),'[]') INTO v_result FROM (
     SELECT d.id,d.data->'zaloEngagementSource' source FROM public.auto_campaign_details d
       JOIN public.auto_campaigns c ON c.id=d.campaign_id AND c.staff_id=p_staff_id AND c.organization_id=p_organization_id
       WHERE d.data->>'zaloEngagementPending'='true' AND d.is_delete=false AND c.is_delete=false
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
       JOIN public.auto_campaign_detail_zalo_engagement e ON e.organization_id=p_organization_id AND e.staff_id=p_staff_id
         AND e.account_id=(i->>'accountId')::bigint AND e.account_zalo_uid=i->>'accountZaloUid' AND e.target_zalo_uid=i->>'targetZaloUid'
         AND e.sent_at <= (i->>'occurredAt')::timestamptz AND e.tracking_until >= (i->>'occurredAt')::timestamptz
       JOIN public.auto_campaign_details d ON d.id=e.campaign_detail_id AND d.is_delete=false
       JOIN public.auto_campaigns c ON c.id=d.campaign_id AND c.staff_id=p_staff_id AND c.organization_id=p_organization_id AND c.is_delete=false
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
       JOIN public.auto_campaign_detail_zalo_engagement e ON e.organization_id=p_organization_id AND e.staff_id=p_staff_id
         AND e.account_id=(i->>'accountId')::bigint AND e.account_zalo_uid=i->>'accountZaloUid' AND e.target_zalo_uid=i->>'targetZaloUid'
         AND e.sent_at <= (i->>'occurredAt')::timestamptz AND e.tracking_until >= (i->>'occurredAt')::timestamptz
       JOIN public.auto_campaign_details d ON d.id=e.campaign_detail_id AND d.is_delete=false
       JOIN public.auto_campaigns c ON c.id=d.campaign_id AND c.staff_id=p_staff_id AND c.organization_id=p_organization_id AND c.is_delete=false
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
