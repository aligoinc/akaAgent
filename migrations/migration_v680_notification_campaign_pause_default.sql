-- V680: bật sẵn thông báo "Chiến dịch tạm dừng" cho mọi nhân viên, chỉ báo khi hệ thống tự dừng (docs/ZALO_UID_ACCOUNT_GUARD_PLAN.md mục 4.5).
-- Sinh bằng scripts/zalo-uid-account-guard/build-v680-sql.py từ thân production đọc 27/11/2026. Không sửa tay.
-- 1) private.aka_agent_notification_capture_campaign: chuyển sang "tạm dừng" mà ghi chú là của khách tự bấm thì không ghi thông báo
--    (áp dụng cho mọi người, kể cả người đang tự bật).
-- 2) private.aka_agent_notification_seed_defaults gọi thêm private.aka_agent_notification_seed_campaign_pause: nhân viên đã có cài đặt
--    thông báo mà chưa có dòng "Chiến dịch" được thêm dòng toStatuses = ["tạm dừng"], đẩy iPhone, email khi đã có email.
--    Dòng do hệ thống thêm mang filters.seededBy = "v680" (khách lưu lại cài đặt thì mất dấu này).
-- 3) Công tắc notifications.default_campaign_pause = {"audience":"all","batch":1000}. Tắt: {"audience":"off"}.
-- Sửa thân hàm nên PostgREST nạp lại schema: apply buổi tối.

BEGIN;
SET LOCAL lock_timeout = '3s';

DO $pre$
BEGIN
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v680_%') THEN
    RAISE EXCEPTION 'v680: đã có trong sổ migration, không chạy lại';
  END IF;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'private.aka_agent_notification_capture_campaign()'::regprocedure) <> '28c58b148172224c2f88885b55dcb3b9' THEN
    RAISE EXCEPTION 'v680: thân private.aka_agent_notification_capture_campaign đã đổi so với bản đọc 27/11/2026';
  END IF;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'private.aka_agent_notification_seed_defaults(timestamp with time zone)'::regprocedure) <> '1af8d8da6de9002bd10d55ca3e65a025' THEN
    RAISE EXCEPTION 'v680: thân private.aka_agent_notification_seed_defaults đã đổi so với bản đọc 27/11/2026';
  END IF;
  IF to_regprocedure('private.aka_agent_notification_seed_campaign_pause(timestamp with time zone)') IS NOT NULL
     OR to_regprocedure('private.aka_agent_notification_user_pause_note(text)') IS NOT NULL THEN
    RAISE EXCEPTION 'v680: hàm mới đã có';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_system_settings WHERE key = 'notifications.default_campaign_pause') THEN
    RAISE EXCEPTION 'v680: đã có dòng notifications.default_campaign_pause';
  END IF;
END
$pre$;

-- Ghi chú khi khách tự bấm Tạm dừng (mọi nút Tạm dừng của Web / iOS / Desktop / App Server đọc 27/11/2026): trống, hoặc giữ câu chờ
-- của Nhóm data ("Chờ data phù hợp" / "Chờ data mới"), hoặc câu "Đang chờ tạm dừng" của bộ chạy Desktop (có thể nối thêm cảnh báo).
CREATE FUNCTION private.aka_agent_notification_user_pause_note(p_note text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $f$
  -- Cắt khoảng trắng hai đầu theo bộ ký tự \s của JavaScript (gồm khoảng trắng Unicode như NBSP, U+3000).
  SELECT CASE
    WHEN p_note IS NULL THEN true
    ELSE (SELECT t = '' OR t IN ('Chờ data phù hợp', 'Chờ data mới') OR t LIKE 'Đang chờ tạm dừng%'
            FROM (SELECT regexp_replace(p_note, E'^[\\s\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]+|[\\s\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]+$', '', 'g') AS t) x)
  END
$f$;

-- Bật sẵn thông báo "Chiến dịch tạm dừng" cho nhân viên đã có cài đặt thông báo mà chưa có dòng "Chiến dịch".
-- Công tắc notifications.default_campaign_pause = {"audience":"off"|"admin_akabiz"|"orgs"|"all","organizationIds":[..],"batch":1000}.
CREATE FUNCTION private.aka_agent_notification_seed_campaign_pause(p_now timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $f$
declare
  v_cfg jsonb; v_aud text; v_orgs bigint[] := '{}'; v_batch integer; v_n integer := 0;
begin
  begin
    v_cfg := private.aka_agent_notification_setting('notifications.default_campaign_pause', '{"audience":"off"}')::jsonb;
    if jsonb_typeof(v_cfg) <> 'object' then
      return jsonb_build_object('campaignPause', jsonb_build_object('audience', 'off', 'error', 'invalid_setting'));
    end if;
    v_aud := coalesce(v_cfg ->> 'audience', 'off');
    if jsonb_typeof(v_cfg -> 'organizationIds') = 'array' then
      v_orgs := array(select (x #>> '{}')::bigint from jsonb_array_elements(v_cfg -> 'organizationIds') x where (x #>> '{}') ~ '^[0-9]{1,18}$');
    end if;
    v_batch := least(greatest(coalesce((v_cfg ->> 'batch')::integer, 1000), 1), 1000);
  exception when others then
    return jsonb_build_object('campaignPause', jsonb_build_object('audience', 'off', 'error', 'invalid_setting'));
  end;
  if v_aud not in ('admin_akabiz', 'orgs', 'all') then
    return jsonb_build_object('campaignPause', jsonb_build_object('audience', 'off'));
  end if;
  perform set_config('aka.notification_center_write', 'on', true);
  with cand as (
    select e.staff_id, st.organization_id, (e.is_enabled and cardinality(e.recipient_emails) > 0) as has_email
      from public.auto_email_notification_settings e
      join public.org_staff st on st.id = e.staff_id
     where e.is_delete is not true and st.is_active is true and st.deleted_at is null and st.organization_id is not null
       and (v_aud = 'all' or (v_aud = 'admin_akabiz' and st.is_admin_akabiz is true)
            or (v_aud = 'orgs' and st.organization_id = any (v_orgs)))
       and not exists (select 1 from public.auto_notification_subscriptions s
                        where s.staff_id = e.staff_id and s.event_type = 'campaign.status_changed' and s.scope = 'own')
       and public.aka_agent_app_access_staff_allowed(st.id, 'akaAgent')
     order by e.staff_id
     limit v_batch
  ), ins as (
    insert into public.auto_notification_subscriptions (staff_id, organization_id, event_type, is_enabled, email_enabled, push_enabled, filters)
    select c.staff_id, c.organization_id, 'campaign.status_changed', true, c.has_email, true,
           '{"toStatuses":["tạm dừng"],"campaignIds":null,"seededBy":"v680"}'::jsonb
      from cand c
    on conflict (staff_id, event_type, scope) do nothing
    returning 1
  )
  select count(*) into v_n from ins;
  perform set_config('aka.notification_center_write', '', true);
  return jsonb_build_object('campaignPause', jsonb_build_object('audience', v_aud, 'added', v_n));
end
$f$;

REVOKE ALL ON FUNCTION private.aka_agent_notification_user_pause_note(text) FROM PUBLIC, anon, authenticated, service_role, aka_agent_desktop, aka_agent_chat_api;
REVOKE ALL ON FUNCTION private.aka_agent_notification_seed_campaign_pause(timestamptz) FROM PUBLIC, anon, authenticated, service_role, aka_agent_desktop, aka_agent_chat_api;

CREATE OR REPLACE FUNCTION private.aka_agent_notification_capture_campaign()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
  -- V680: chỉ báo "tạm dừng" khi hệ thống tự dừng (ghi chú có lý do). Khách tự bấm Tạm dừng thì ghi chú trống, hoặc giữ câu chờ
  -- của Nhóm data, hoặc là câu "Đang chờ tạm dừng" của bộ chạy Desktop (private.aka_agent_notification_user_pause_note).
  IF v_to = 'tạm dừng' AND private.aka_agent_notification_user_pause_note(NEW.note) THEN
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
  -- V561: chiến dịch đang bật "Lặp lại sau khi chạy xong" mà bộ chạy chưa biết tính năng đánh "hoàn thành" ở lượt giữa: bộ quét sẽ mở
  -- lại ngay sau đó, nên không báo. Lượt cuối (đủ số lượt, tới ngày kết thúc) báo như thường. Bộ quét đang tắt, hàm chưa có hoặc
  -- hàm lỗi: báo như chiến dịch thường.
  IF v_to = 'hoàn thành' AND NEW.extra_settings -> 'repeatAfterCompletionEnabled' = 'true'::jsonb
     AND to_regprocedure('private.aka_agent_campaign_repeat_will_reopen(public.auto_campaigns)') IS NOT NULL THEN
    IF private.aka_agent_campaign_repeat_will_reopen(NEW) THEN RETURN NULL; END IF;
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
$function$;

CREATE OR REPLACE FUNCTION private.aka_agent_notification_seed_defaults(p_now timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_cfg jsonb; v_audience text; v_orgs bigint[] := '{}'; v_batch integer; r record;
  v_email_max integer := 0; v_sources text[] := array['profile', 'crm']; v_room integer := 0;
  v_full integer := 0; v_morning integer := 0; v_email integer := 0;
  v_days constant smallint[] := array[1, 2, 3, 4, 5, 6, 7]::smallint[];
  v_time constant time[] := array['07:00'::time];
  v_tz constant text := 'Asia/Ho_Chi_Minh';
begin
  begin
    v_cfg := private.aka_agent_notification_setting('notifications.default_reports', '{"audience":"off"}')::jsonb;
    if jsonb_typeof(v_cfg) <> 'object' then return jsonb_build_object('audience', 'off', 'error', 'invalid_setting'); end if;
    v_audience := coalesce(v_cfg ->> 'audience', 'off');
    if jsonb_typeof(v_cfg -> 'organizationIds') = 'array' then
      v_orgs := array(select (x #>> '{}')::bigint from jsonb_array_elements(v_cfg -> 'organizationIds') x where (x #>> '{}') ~ '^[0-9]{1,18}$');
    end if;
    v_batch := least(greatest(coalesce((v_cfg ->> 'batch')::integer, 200), 1), 1000);
    if (v_cfg ->> 'emailMax') ~ '^[0-9]{1,6}$' then v_email_max := (v_cfg ->> 'emailMax')::integer; end if;
    if jsonb_typeof(v_cfg -> 'emailSources') = 'array' then
      v_sources := array(select x #>> '{}' from jsonb_array_elements(v_cfg -> 'emailSources') x where (x #>> '{}') in ('profile', 'crm'));
    end if;
  exception when others then
    return jsonb_build_object('audience', 'off', 'error', 'invalid_setting');
  end;
  if v_audience not in ('admin_akabiz', 'orgs', 'all') then
    -- V680: bật sẵn thông báo tạm dừng theo công tắc riêng, kể cả khi báo cáo mặc định đang tắt.
    return jsonb_build_object('audience', 'off') || private.aka_agent_notification_seed_campaign_pause(p_now);
  end if;

  perform set_config('aka.notification_center_write', 'on', true);

  for r in
    select st.id, st.organization_id
      from public.org_staff st
     where st.is_active is true and st.deleted_at is null and st.organization_id is not null
       and (v_audience = 'all' or (v_audience = 'admin_akabiz' and st.is_admin_akabiz is true)
            or (v_audience = 'orgs' and st.organization_id = any (v_orgs)))
       and not exists (select 1 from public.auto_email_notification_settings e where e.staff_id = st.id)
       and public.aka_agent_app_access_staff_allowed(st.id, 'akaAgent')
     order by st.id
     limit v_batch
  loop
    insert into public.auto_email_notification_settings (staff_id, organization_id, is_enabled, recipient_emails, notify_campaign_completed,
           daily_report_enabled, is_delete, push_enabled, revision, settings_version, timezone, verified_emails, updated_by_client, updated_at)
    values (r.id, r.organization_id, false, '{}'::text[], false, false, false, true, 1, 2, v_tz, '{}'::text[], 'default_seed', p_now)
    on conflict (staff_id) do nothing;
    if not found then continue; end if;
    insert into public.auto_notification_subscriptions (staff_id, organization_id, event_type, is_enabled, email_enabled, push_enabled,
           filters, schedule_week_days, schedule_times, next_run_at)
    values (r.id, r.organization_id, 'report.morning', true, false, true, '{"skipWhenIdle":false}'::jsonb, v_days, v_time,
            private.aka_agent_notification_next_run(v_days, v_time, v_tz, p_now))
    on conflict (staff_id, event_type, scope) do nothing;
    v_full := v_full + 1;
  end loop;

  for r in
    select e.staff_id, st.organization_id, e.is_enabled and cardinality(e.recipient_emails) > 0 as has_email, e.timezone
      from public.auto_email_notification_settings e
      join public.org_staff st on st.id = e.staff_id
     where e.is_delete is not true and st.is_active is true and st.deleted_at is null and st.organization_id is not null
       and (v_audience = 'all' or (v_audience = 'admin_akabiz' and st.is_admin_akabiz is true)
            or (v_audience = 'orgs' and st.organization_id = any (v_orgs)))
       and not exists (select 1 from public.auto_notification_subscriptions s
                        where s.staff_id = e.staff_id and s.event_type = 'report.morning' and s.scope = 'own')
       and public.aka_agent_app_access_staff_allowed(st.id, 'akaAgent')
     order by e.staff_id
     limit v_batch
  loop
    insert into public.auto_notification_subscriptions (staff_id, organization_id, event_type, is_enabled, email_enabled, push_enabled,
           filters, schedule_week_days, schedule_times, next_run_at)
    values (r.staff_id, r.organization_id, 'report.morning', true, r.has_email, true, '{"skipWhenIdle":false}'::jsonb, v_days, v_time,
            private.aka_agent_notification_next_run(v_days, v_time,
              coalesce((select z.name from pg_catalog.pg_timezone_names z where z.name = btrim(r.timezone)), v_tz), p_now))
    on conflict (staff_id, event_type, scope) do nothing;
    if found then v_morning := v_morning + 1; end if;
  end loop;

  if v_email_max > 0 and cardinality(v_sources) > 0 then
    select v_email_max - count(*) into v_room
      from public.auto_email_notification_settings e
     where e.auto_email_filled_at is not null and e.is_delete is not true and cardinality(e.recipient_emails) > 0;
    if v_room > 0 then
      for r in
        select e.staff_id, c.email
          from public.auto_email_notification_settings e
          join public.org_staff st on st.id = e.staff_id
          join private.aka_agent_notification_email_candidates() c on c.staff_id = e.staff_id
         where e.is_delete is not true and e.auto_email_filled_at is null and cardinality(e.recipient_emails) = 0
           and st.is_active is true and st.deleted_at is null and st.organization_id is not null
           and (v_audience = 'all' or (v_audience = 'admin_akabiz' and st.is_admin_akabiz is true)
                or (v_audience = 'orgs' and st.organization_id = any (v_orgs)))
           and c.source = any (v_sources)
           and (c.source = 'profile' or not exists (
                 select 1 from public.auto_email_notification_settings o
                  where o.staff_id <> e.staff_id and o.is_delete is not true and c.email = any (o.recipient_emails)))
           and public.aka_agent_app_access_staff_allowed(st.id, 'akaAgent')
         order by (c.source <> 'profile'), e.staff_id
         limit least(v_batch, v_room)
      loop
        update public.auto_email_notification_settings
           set is_enabled = true, recipient_emails = array[r.email], verified_emails = array[r.email],
               auto_email_filled_at = p_now, revision = revision + 1, updated_at = p_now
         where staff_id = r.staff_id and auto_email_filled_at is null and cardinality(recipient_emails) = 0 and is_delete is not true;
        if not found then continue; end if;
        update public.auto_notification_subscriptions set email_enabled = true, updated_at = p_now
         where staff_id = r.staff_id and scope = 'own' and event_type = 'report.morning' and is_enabled;
        -- V680: dòng "tạm dừng" do hệ thống bật sẵn (khách chưa sửa) cũng nhận email khi vừa có email.
        update public.auto_notification_subscriptions set email_enabled = true, updated_at = p_now
         where staff_id = r.staff_id and scope = 'own' and event_type = 'campaign.status_changed' and is_enabled
           and filters ->> 'seededBy' = 'v680';
        v_email := v_email + 1;
      end loop;
    end if;
  end if;

  perform set_config('aka.notification_center_write', '', true);
  return jsonb_build_object('audience', v_audience, 'seeded', v_full, 'morningAdded', v_morning, 'emailAdded', v_email,
                            'emailRoom', greatest(v_room - v_email, 0))
         || private.aka_agent_notification_seed_campaign_pause(p_now);
end
$function$;

INSERT INTO public.auto_system_settings (key, value, description, is_secret, is_active)
VALUES ('notifications.default_campaign_pause', '{"audience":"all","batch":1000}',
        'V680: bật sẵn thông báo Chiến dịch tạm dừng (chỉ khi hệ thống tự dừng). audience off | admin_akabiz | orgs | all.', false, true);

DO $post$
BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'private.aka_agent_notification_capture_campaign()'::regprocedure) <> 'b780b8819b1f449527a02427c836ff93' THEN
    RAISE EXCEPTION 'v680: thân capture sau khi sửa không đúng';
  END IF;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'private.aka_agent_notification_seed_defaults(timestamp with time zone)'::regprocedure) <> 'd76e5fd1c8b6207dedd4a3ed865e6e81' THEN
    RAISE EXCEPTION 'v680: thân seed_defaults sau khi sửa không đúng';
  END IF;
END
$post$;

COMMIT;
