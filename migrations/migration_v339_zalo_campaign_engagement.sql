-- Canonical phased migration. Use scripts/apply-zalo-engagement-migration.cjs.
-- Existing-table indexes run outside transactions; never bulk-push pending migrations.
-- @phase schema
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '15s';
DO $preflight$
BEGIN
 IF md5(pg_get_functiondef(to_regprocedure('public.auto_assert_automation_identity(bigint,bigint,text,text)'))) IS DISTINCT FROM '5a9a503db72b965eb644739f5f60905d' THEN RAISE EXCEPTION 'v339 identity drift'; END IF;
 IF md5(pg_get_functiondef(to_regprocedure('public.aka_agent_list_campaign_details_page(bigint,bigint,bigint,text,text,timestamptz,timestamptz,integer,integer,text,text,text)'))) IS DISTINCT FROM '9652783556c25109e6250375da031fa3' THEN RAISE EXCEPTION 'v339 detail page drift'; END IF;
 IF EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('aka_agent_campaign_engagement_batch','aka_agent_register_campaign_engagement','aka_agent_record_campaign_engagement','aka_agent_read_campaign_engagement','aka_agent_list_campaign_details_page_v2','aka_agent_campaign_engagement_revision')) THEN RAISE EXCEPTION 'v339 target already exists: inspect live definition before reapply'; END IF;
 IF to_regclass('public.auto_campaign_detail_zalo_engagement') IS NOT NULL THEN RAISE EXCEPTION 'v339 target table already exists'; END IF;
END
$preflight$;

INSERT INTO public.auto_system_settings(key,value,description,is_active,is_secret) VALUES
 ('zalo.campaign_engagement.enabled','false','Bật theo dõi tương tác Zalo từ sự kiện hiện có; tắt sẽ bỏ việc chưa ghi.',true,false),
 ('zalo.campaign_engagement.flush_interval_seconds','5','Thời gian gom tối đa mỗi lô tương tác (số nguyên 1–60 giây).',true,false),
 ('zalo.campaign_engagement.batch_size','100','Số mục mỗi lô tương tác (số nguyên 1–500). Một lô đang ghi/process.',true,false),
 ('zalo.campaign_engagement.tracking_window_hours','48','Thời hạn theo dõi lượt đăng ký mới (số nguyên 1–720 giờ). Lượt cũ giữ hạn đã lưu.',true,false)
ON CONFLICT (key) DO NOTHING;

CREATE FUNCTION public.aka_agent_campaign_engagement_revision() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $fn$
BEGIN
 -- Every write changes the generation, even false -> false, including admin CAS writes.
 IF NEW.key='zalo.campaign_engagement.enabled' THEN
   NEW.updated_at := greatest(clock_timestamp(), COALESCE(OLD.updated_at, '-infinity') + interval '1 microsecond');
 END IF;
 RETURN NEW;
END
$fn$;
CREATE TRIGGER auto_campaign_engagement_revision BEFORE UPDATE ON public.auto_system_settings
 FOR EACH ROW WHEN (NEW.key='zalo.campaign_engagement.enabled') EXECUTE FUNCTION public.aka_agent_campaign_engagement_revision();

CREATE TABLE public.auto_campaign_detail_zalo_engagement (
 campaign_detail_id bigint PRIMARY KEY REFERENCES public.auto_campaign_details(id) ON DELETE CASCADE,
 organization_id bigint NOT NULL, staff_id bigint NOT NULL, account_id bigint NOT NULL,
 account_zalo_uid text NOT NULL CHECK (length(account_zalo_uid) BETWEEN 1 AND 128),
 target_zalo_uid text NOT NULL CHECK (length(target_zalo_uid) BETWEEN 1 AND 128),
 action_type text NOT NULL CHECK (action_type IN ('message','friend_request')),
 sent_at timestamptz NOT NULL, tracking_until timestamptz NOT NULL,
 message_ids text[] NOT NULL DEFAULT '{}',
 seen_at timestamptz, responded_at timestamptz, reacted_at timestamptz, friended_at timestamptz,
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK (tracking_until > sent_at),
 CHECK (seen_at IS NULL OR seen_at BETWEEN sent_at AND tracking_until),
 CHECK (responded_at IS NULL OR responded_at BETWEEN sent_at AND tracking_until),
 CHECK (reacted_at IS NULL OR reacted_at BETWEEN sent_at AND tracking_until),
 CHECK (friended_at IS NULL OR friended_at BETWEEN sent_at AND tracking_until)
);
ALTER TABLE public.auto_campaign_detail_zalo_engagement ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.auto_campaign_detail_zalo_engagement FROM PUBLIC,anon,authenticated,service_role;
CREATE INDEX auto_campaign_engagement_target ON public.auto_campaign_detail_zalo_engagement
 (organization_id,staff_id,account_id,account_zalo_uid,target_zalo_uid,sent_at DESC) INCLUDE (tracking_until,action_type);
CREATE INDEX auto_campaign_engagement_deadline ON public.auto_campaign_detail_zalo_engagement
 (organization_id,staff_id,account_id,account_zalo_uid,tracking_until,campaign_detail_id);
CREATE INDEX auto_campaign_engagement_catalog ON public.auto_campaign_detail_zalo_engagement
 (organization_id,staff_id,tracking_until,campaign_detail_id);

-- Scoped recovery of ambiguous detail commits, including consumed pending markers.


ALTER TABLE public.chat_zalo_runtime_event
 ADD COLUMN engagement_state text,
 ADD COLUMN engagement_revision text,
 ADD COLUMN engagement_payload jsonb,
 ADD COLUMN engagement_occurred_at timestamptz,
 ADD COLUMN engagement_target_uid text,
 ADD COLUMN engagement_account_uid text,
 ADD COLUMN engagement_claim_token uuid,
 ADD COLUMN engagement_claim_until timestamptz,
 ADD COLUMN engagement_next_attempt_at timestamptz,
 ADD COLUMN engagement_attempts integer NOT NULL DEFAULT 0,
 ADD CONSTRAINT chat_zalo_runtime_event_engagement_state_check
 CHECK (engagement_state IN ('waiting_config','pending','done')) NOT VALID;



CREATE FUNCTION public.aka_agent_campaign_engagement_batch(
 p_staff_id bigint,p_organization_id bigint,p_revision text,p_items jsonb,p_mode text,
 p_auth_username text,p_auth_password text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET statement_timeout='15s' AS $fn$
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
    AND d.data->>'zaloEngagementPending'='true' AND COALESCE(d.data->>'zaloEngagementRuntime','desktop')='desktop';
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
$fn$;
REVOKE ALL ON FUNCTION public.aka_agent_campaign_engagement_revision() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.aka_agent_campaign_engagement_batch(bigint,bigint,text,jsonb,text,text,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.aka_agent_register_campaign_engagement(p_staff_id bigint,p_organization_id bigint,p_revision text,p_items jsonb,p_auth_username text DEFAULT NULL,p_auth_password text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public SET statement_timeout='15s' AS $fn$
 SELECT public.aka_agent_campaign_engagement_batch(p_staff_id,p_organization_id,p_revision,p_items,'register',p_auth_username,p_auth_password);
$fn$;
REVOKE ALL ON FUNCTION public.aka_agent_register_campaign_engagement(bigint,bigint,text,jsonb,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aka_agent_register_campaign_engagement(bigint,bigint,text,jsonb,text,text) TO anon,authenticated,service_role,aka_agent_chat_api;

CREATE FUNCTION public.aka_agent_record_campaign_engagement(p_staff_id bigint,p_organization_id bigint,p_revision text,p_items jsonb,p_auth_username text DEFAULT NULL,p_auth_password text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public SET statement_timeout='15s' AS $fn$
 SELECT public.aka_agent_campaign_engagement_batch(p_staff_id,p_organization_id,p_revision,p_items,'events',p_auth_username,p_auth_password);
$fn$;
REVOKE ALL ON FUNCTION public.aka_agent_record_campaign_engagement(bigint,bigint,text,jsonb,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aka_agent_record_campaign_engagement(bigint,bigint,text,jsonb,text,text) TO anon,authenticated,service_role,aka_agent_chat_api;

CREATE FUNCTION public.aka_agent_read_campaign_engagement(p_staff_id bigint,p_organization_id bigint,p_revision text,p_items jsonb,p_auth_username text DEFAULT NULL,p_auth_password text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public SET statement_timeout='15s' AS $fn$
 SELECT public.aka_agent_campaign_engagement_batch(p_staff_id,p_organization_id,p_revision,p_items,'read',p_auth_username,p_auth_password);
$fn$;
REVOKE ALL ON FUNCTION public.aka_agent_read_campaign_engagement(bigint,bigint,text,jsonb,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aka_agent_read_campaign_engagement(bigint,bigint,text,jsonb,text,text) TO anon,authenticated,service_role,aka_agent_chat_api;
CREATE OR REPLACE FUNCTION public.aka_agent_list_campaign_details_page_v2(p_staff_id bigint, p_organization_id bigint, p_campaign_id bigint, p_search text, p_status text, p_date_from timestamp with time zone, p_date_to timestamp with time zone, p_offset integer, p_limit integer, p_sort text, p_auth_username text, p_auth_password text, p_engagement_filter text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET statement_timeout TO '60s'
AS $function$
DECLARE
  v_sort text := COALESCE(p_sort, 'created_desc');
  v_search text := NULLIF(btrim(left(p_search, 200)), '');
  v_status text := NULLIF(btrim(left(p_status, 120)), '');
  v_where text := 'd.campaign_id = $1 AND d.is_delete = false';
  v_direction text;
  v_result jsonb;
BEGIN
  -- Same credential + campaign ownership guard as the live detail provenance RPC.
  PERFORM public.auto_assert_automation_identity(
    p_staff_id, p_organization_id, p_auth_username, p_auth_password
  );
  IF p_campaign_id IS NULL OR p_campaign_id <= 0
    OR COALESCE(p_offset, 0) < 0 OR COALESCE(p_limit, 100) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'invalid_campaign_details_page';
  END IF;
  IF v_sort NOT IN ('created_asc', 'created_desc') THEN
    RAISE EXCEPTION 'invalid_campaign_details_sort';
  END IF;
  IF p_date_from IS NOT NULL AND p_date_to IS NOT NULL AND p_date_from > p_date_to THEN
    RAISE EXCEPTION 'invalid_campaign_details_date_range';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.auto_campaigns AS campaign
    WHERE campaign.id = p_campaign_id
      AND campaign.staff_id = p_staff_id
      AND campaign.organization_id = p_organization_id
  ) THEN
    RAISE EXCEPTION 'campaign_not_found';
  END IF;

  -- Only fixed SQL fragments are concatenated. All user values are bound.
  -- Omitting inactive predicates avoids generic OR plans scanning wide rows.
  IF v_status IS NOT NULL THEN v_where := v_where || ' AND d.status = $2'; END IF;
  IF p_date_from IS NOT NULL THEN v_where := v_where || ' AND d.created_at >= $3'; END IF;
  IF p_date_to IS NOT NULL THEN v_where := v_where || ' AND d.created_at <= $4'; END IF;
  IF v_search IS NOT NULL THEN
    v_where := v_where || ' AND (d.action_name ILIKE $5 OR d.action_code ILIKE $5
      OR d.status ILIKE $5 OR d.error_code ILIKE $5 OR d.log ILIKE $5 OR d.post_url ILIKE $5)';
  END IF;
  IF COALESCE(p_engagement_filter, 'all') NOT IN ('all','seen','responded','reacted','friended','none') THEN
    RAISE EXCEPTION 'invalid_engagement_filter';
  END IF;
  IF p_engagement_filter IN ('seen','responded','reacted','friended','none') THEN
    v_where := v_where || ' AND EXISTS (SELECT 1 FROM public.auto_campaign_detail_zalo_engagement e WHERE e.campaign_detail_id=d.id AND ' ||
      CASE p_engagement_filter WHEN 'seen' THEN 'e.seen_at IS NOT NULL' WHEN 'responded' THEN 'e.responded_at IS NOT NULL'
        WHEN 'reacted' THEN 'e.reacted_at IS NOT NULL' WHEN 'friended' THEN 'e.friended_at IS NOT NULL'
        ELSE 'e.seen_at IS NULL AND e.responded_at IS NULL AND e.reacted_at IS NULL AND e.friended_at IS NULL' END || ')';
  END IF;
  v_direction := CASE WHEN v_sort = 'created_asc' THEN 'ASC' ELSE 'DESC' END;

  -- Both keys are NOT NULL in the live schema (checked by preflight). Default
  -- NULL placement is therefore equivalent to NULLS LAST for both directions,
  -- and allows one index to support forward and backward index-only scans.
  -- MATERIALIZED limits the narrow ID set before any full-row payload lookup.
  -- Count, page IDs and payload are read by one statement / MVCC snapshot;
  -- count remains available even when the requested page has no items.
  EXECUTE format($query$
    WITH page_ids AS MATERIALIZED (
      SELECT d.id, d.created_at
      FROM public.auto_campaign_details AS d
      WHERE %1$s
      ORDER BY d.created_at %2$s, d.id %2$s
      LIMIT $6 OFFSET $7
    )
    SELECT jsonb_build_object(
      'items', COALESCE((
        SELECT jsonb_agg((to_jsonb(detail) || jsonb_build_object('zalo_engagement', to_jsonb(engagement), 'zalo_engagement_applicable',
          engagement.campaign_detail_id IS NOT NULL OR (account.flatform_type='zalo' AND NOT COALESCE(account.is_zalo_show_web,false)
            AND detail.status='thành công' AND detail.action_code IN ('zalo_message_friend','zalo_message_stranger','zalo_add_friend')
            AND detail.data->'partialSend' IS NULL))) ORDER BY page.created_at %2$s, page.id %2$s)
        FROM page_ids AS page
        JOIN public.auto_campaign_details AS detail ON detail.id = page.id
        LEFT JOIN public.auto_campaign_detail_zalo_engagement engagement ON engagement.campaign_detail_id=page.id
        LEFT JOIN public.auto_accounts account ON account.id=detail.account_id
      ), '[]'::jsonb),
      'total', (SELECT count(*) FROM public.auto_campaign_details AS d WHERE %1$s)
    )
  $query$, v_where, v_direction)
  INTO v_result
  USING p_campaign_id, v_status, p_date_from, p_date_to,
    '%' || v_search || '%', COALESCE(p_limit,100), COALESCE(p_offset,0);
  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.aka_agent_list_campaign_details_page_v2(bigint,bigint,bigint,text,text,timestamptz,timestamptz,integer,integer,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aka_agent_list_campaign_details_page_v2(bigint,bigint,bigint,text,text,timestamptz,timestamptz,integer,integer,text,text,text,text) TO anon,authenticated,service_role;
COMMIT;


-- @phase auto_campaign_engagement_source
CREATE INDEX CONCURRENTLY auto_campaign_engagement_source ON public.auto_campaign_details
 (id) WHERE data->>'zaloEngagementPending'='true' AND is_delete=false;

-- @phase auto_campaign_engagement_operation
CREATE INDEX CONCURRENTLY auto_campaign_engagement_operation ON public.auto_campaign_details
 (campaign_id,account_id,(data#>>'{zaloEngagementSource,operationId}'))
 WHERE data#>>'{zaloEngagementSource,operationId}' IS NOT NULL;

-- @phase chat_runtime_engagement_pending
CREATE INDEX CONCURRENTLY chat_runtime_engagement_pending ON public.chat_zalo_runtime_event
 (engagement_next_attempt_at,id) WHERE engagement_state IN ('waiting_config','pending');

-- @phase chat_runtime_engagement_reconcile
CREATE INDEX CONCURRENTLY chat_runtime_engagement_reconcile ON public.chat_zalo_runtime_event
 (organization_id,chat_zalo_account_organization_id,engagement_account_uid,engagement_target_uid,engagement_occurred_at) WHERE engagement_payload IS NOT NULL;

-- @phase validate
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '90s';
ALTER TABLE public.chat_zalo_runtime_event
 VALIDATE CONSTRAINT chat_zalo_runtime_event_engagement_state_check;
COMMIT;

-- @phase postflight
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '10s';
DO $postflight$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM public.auto_system_settings WHERE key='zalo.campaign_engagement.enabled' AND value='false' AND is_active AND NOT is_secret) THEN
   RAISE EXCEPTION 'v339 rollout must remain disabled';
 END IF;
 IF (SELECT count(*) FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid
   WHERE c.relnamespace='public'::regnamespace AND c.relname IN (
    'auto_campaign_engagement_target','auto_campaign_engagement_deadline','auto_campaign_engagement_catalog',
    'auto_campaign_engagement_source','auto_campaign_engagement_operation','chat_runtime_engagement_pending','chat_runtime_engagement_reconcile')
   AND i.indisvalid AND i.indisready AND i.indislive) <> 7 THEN
   RAISE EXCEPTION 'v339 indexes incomplete';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.chat_zalo_runtime_event'::regclass
   AND conname='chat_zalo_runtime_event_engagement_state_check' AND convalidated) THEN
   RAISE EXCEPTION 'v339 inbox constraint unvalidated';
 END IF;
END
$postflight$;
NOTIFY pgrst, 'reload schema';
COMMIT;
