-- V475: Trung tâm thông báo — không báo "hoàn thành"/"đang chạy"/"chờ xử lý" của chiến dịch do Quy trình quản lý.
-- Bộ máy Quy trình (V473) chạy mỗi bước gửi bằng một chiến dịch "[Quy trình] …" và mở lại nó ("hoàn thành" → "chờ xử lý")
-- mỗi khi có khách tới bước đó: quy trình nhận 20 khách/ngày với 3 bước gửi có thể sinh ~60 lần "hoàn thành"/ngày.
-- Chỉ thay private.aka_agent_notification_capture_campaign() (bản V465, md5 trước/sau khóa cứng): chiến dịch nằm trong
-- auto_journey_step_campaigns của quy trình đang chạy/tạm dừng (chưa xóa) thì chỉ ghi thông báo "tạm dừng"/"lỗi".
-- Không đổi: chiến dịch thường; chiến dịch của bước "Dùng chiến dịch có sẵn" (của người dùng, không nằm trong bảng trên);
-- quy trình đã dừng/xóa; cooldown, gộp, trần email của V465; bảng, trigger, quyền. Thiếu bảng Quy trình thì như cũ.
-- Trigger email cũ trg_aka_agent_enqueue_campaign_completed_email đã tắt từ 04/11/2026 23:39 VN (email đi qua Trung tâm
-- thông báo), nên không sửa hàm của nó. Rollback: migrations/rollback_v475_journey_campaign_notifications.sql.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $v475_preflight$
BEGIN
  IF md5(pg_get_functiondef(to_regprocedure('private.aka_agent_notification_capture_campaign()'))) IS DISTINCT FROM '4a5e881eb85efc1cc2280e8cf0c10721' THEN
    RAISE EXCEPTION 'v475: unexpected definition private.aka_agent_notification_capture_campaign()';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger t
                  WHERE t.tgrelid = 'public.auto_campaigns'::regclass AND t.tgname = 'trg_aka_agent_notify_campaign_status'
                    AND t.tgfoid = to_regprocedure('private.aka_agent_notification_capture_campaign()') AND t.tgenabled = 'O') THEN
    RAISE EXCEPTION 'v475: trg_aka_agent_notify_campaign_status missing or disabled';
  END IF;
  IF to_regclass('public.auto_journeys') IS NULL OR to_regclass('public.auto_journey_step_campaigns') IS NULL THEN
    RAISE EXCEPTION 'v475: requires V473 (auto_journeys, auto_journey_step_campaigns)';
  END IF;
  IF (SELECT count(*) FROM pg_attribute WHERE attrelid = 'public.auto_journeys'::regclass AND NOT attisdropped
       AND attname IN ('id', 'status', 'is_delete')) <> 3
     OR (SELECT count(*) FROM pg_attribute WHERE attrelid = 'public.auto_journey_step_campaigns'::regclass AND NOT attisdropped
       AND attname IN ('journey_id', 'campaign_id')) <> 2 THEN
    RAISE EXCEPTION 'v475: journey columns missing';
  END IF;
  -- Một lần tra theo campaign_id (index unique của V473) cho mỗi lần đổi trạng thái có người đăng ký nhận báo.
  IF NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = i.indkey[0]
                  WHERE i.indrelid = 'public.auto_journey_step_campaigns'::regclass AND i.indisunique AND i.indisvalid
                    AND i.indnkeyatts = 1 AND a.attname = 'campaign_id') THEN
    RAISE EXCEPTION 'v475: unique index on auto_journey_step_campaigns.campaign_id missing';
  END IF;
END
$v475_preflight$;

CREATE OR REPLACE FUNCTION private.aka_agent_notification_capture_campaign()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_sub public.auto_notification_subscriptions%ROWTYPE;
  v_now timestamptz := clock_timestamp();
  v_to text := NEW.status;
  v_cooldown integer;
  v_last bigint;
  v_org bigint;
  v_digest integer; v_deliver timestamptz; v_prev_deliver timestamptz; v_prev_status text;
BEGIN
  IF NOT private.aka_agent_notification_enabled() THEN RETURN NULL; END IF;
  SELECT * INTO v_sub FROM public.auto_notification_subscriptions
   WHERE staff_id = NEW.staff_id AND event_type = 'campaign.status_changed' AND scope = 'own' AND is_enabled;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF NOT (coalesce(v_sub.filters -> 'toStatuses', private.aka_agent_notification_default_filters('campaign.status_changed') -> 'toStatuses') ? v_to) THEN
    RETURN NULL;
  END IF;
  IF jsonb_typeof(v_sub.filters -> 'campaignIds') = 'array' AND NOT ((v_sub.filters -> 'campaignIds') @> to_jsonb(NEW.id)) THEN
    RETURN NULL;
  END IF;
  -- V475: chiến dịch do Quy trình quản lý. Bộ máy mở lại chiến dịch mỗi khi có khách tới bước gửi, nên "hoàn thành",
  -- "đang chạy", "chờ xử lý" lặp nhiều lần mỗi ngày mà không cần ai xử lý. Khi quy trình đang chạy hoặc tạm dừng chỉ báo
  -- "tạm dừng"/"lỗi". Quy trình đã dừng/xóa, hoặc chưa có bảng Quy trình (V473 gỡ ra): như chiến dịch thường.
  IF v_to NOT IN ('tạm dừng', 'lỗi') AND to_regclass('public.auto_journey_step_campaigns') IS NOT NULL
     AND to_regclass('public.auto_journeys') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.auto_journey_step_campaigns sc JOIN public.auto_journeys j ON j.id = sc.journey_id
                WHERE sc.campaign_id = NEW.id AND j.is_delete = false AND j.status IN ('active', 'paused')) THEN
      RETURN NULL;
    END IF;
  END IF;
  v_cooldown := CASE WHEN v_to IN ('đang chạy', 'chờ xử lý') THEN coalesce(v_sub.cooldown_minutes, 15)
    ELSE coalesce(v_sub.cooldown_minutes, private.aka_agent_notification_int_setting('notifications.cooldown_minutes.campaign', 10)) END;
  IF v_cooldown > 0 THEN
    SELECT n.id INTO v_last FROM public.auto_notifications n
     WHERE n.staff_id = NEW.staff_id AND n.event_type = 'campaign.status_changed' AND n.entity_key = 'campaign:' || NEW.id
       AND n.occurred_at > v_now - make_interval(mins => v_cooldown) AND n.payload ->> 'toStatus' = v_to
       AND n.content_status <> 'failed'
     ORDER BY n.occurred_at DESC LIMIT 1;
    IF FOUND THEN
      UPDATE public.auto_notifications
         SET payload = payload || jsonb_build_object('suppressedCount', coalesce((payload ->> 'suppressedCount')::integer, 0) + 1,
                                                    'lastOccurredAt', v_now),
             updated_at = v_now
       WHERE id = v_last;
      RETURN NULL;
    END IF;
  END IF;
  -- Gom: thông báo đầu tiên trong lúc yên gửi sau 30 giây; các thay đổi cùng trạng thái tiếp theo của nhân viên
  -- dồn vào mốc kế tiếp (cách lần gửi trước ≥ digest phút) để worker gộp thành 1 thông báo.
  v_deliver := v_now + interval '30 seconds';
  v_digest := private.aka_agent_notification_int_setting('notifications.digest_minutes.campaign', 10);
  IF v_digest > 0 THEN
    SELECT n.deliver_after, n.content_status INTO v_prev_deliver, v_prev_status FROM public.auto_notifications n
     WHERE n.staff_id = NEW.staff_id AND n.event_type = 'campaign.status_changed'
       AND n.deliver_after > v_now - make_interval(mins => v_digest)
       AND n.content_status IN ('pending', 'rendering', 'ready') AND n.payload ->> 'toStatus' = v_to
     ORDER BY n.deliver_after DESC LIMIT 1;
    IF FOUND THEN
      v_deliver := CASE WHEN v_prev_status = 'pending' THEN v_prev_deliver
                        ELSE greatest(v_deliver, v_prev_deliver + make_interval(mins => v_digest)) END;
    END IF;
  END IF;
  v_org := private.aka_agent_notification_staff_org(NEW.staff_id, NEW.organization_id);
  INSERT INTO public.auto_notifications (organization_id, staff_id, event_type, severity, campaign_id, account_id, entity_key,
                                         occurred_at, deliver_after, dedupe_key, payload)
  VALUES (v_org, NEW.staff_id, 'campaign.status_changed', CASE WHEN v_to = 'tạm dừng' THEN 'warning' ELSE 'info' END,
          NEW.id, NEW.account_id, 'campaign:' || NEW.id, v_now, v_deliver,
          format('cs:%s:%s:%s', NEW.id, v_to, txid_current()),
          jsonb_build_object('campaignId', NEW.id, 'campaignName', NEW.name, 'actionId', NEW.action_id, 'accountId', NEW.account_id,
                             'fromStatus', OLD.status, 'toStatus', v_to, 'note', NEW.note, 'changedAt', v_now,
                             'source', private.aka_agent_notification_change_source()))
  ON CONFLICT (dedupe_key) DO NOTHING;
  RETURN NULL;
END
$$;

DO $v475_postcheck$
BEGIN
  IF md5(pg_get_functiondef(to_regprocedure('private.aka_agent_notification_capture_campaign()'))) IS DISTINCT FROM '71cdeb0842f00fafaf8492366bf9e8dc' THEN
    RAISE EXCEPTION 'v475: checksum mismatch private.aka_agent_notification_capture_campaign()';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p
                  WHERE p.oid = to_regprocedure('private.aka_agent_notification_capture_campaign()')
                    AND p.prosecdef AND pg_get_userbyid(p.proowner) = 'postgres'
                    AND p.proconfig = ARRAY['search_path=pg_catalog, public'] AND p.proacl::text = '{postgres=X/postgres}') THEN
    RAISE EXCEPTION 'v475: owner/security/search_path/ACL of the capture function changed';
  END IF;
END
$v475_postcheck$;

COMMIT;
