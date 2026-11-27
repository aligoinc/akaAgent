#!/usr/bin/env python3
"""Sinh migrations/migration_v680_notification_campaign_pause_default.sql từ thân production đọc 27/11/2026.

Nguồn: live_capture_campaign.sql (md5 thân 28c58b14…), live_seed_defaults.sql (md5 thân 1af8d8da…), chép nguyên văn từ
pg_get_functiondef và đã so md5 với production. Mỗi chỗ sửa phải khớp đúng một lần, không thì dừng.
Chạy: python3 scripts/zalo-uid-account-guard/build-v680-sql.py
"""
import hashlib
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT = os.path.join(ROOT, 'migrations', 'migration_v680_notification_campaign_pause_default.sql')
ROLLBACK = os.path.join(ROOT, 'migrations', 'rollback_v680_notification_campaign_pause_default.sql')

LIVE = {
    'capture': ('live_capture_campaign.sql', '28c58b148172224c2f88885b55dcb3b9'),
    'seed': ('live_seed_defaults.sql', '1af8d8da6de9002bd10d55ca3e65a025'),
}


def body_of(sql):
    return sql.split('AS $function$', 1)[1].rsplit('$function$', 1)[0]


def md5(s):
    return hashlib.md5(s.encode('utf-8')).hexdigest()


def load(key):
    name, want = LIVE[key]
    sql = open(os.path.join(HERE, name), encoding='utf-8').read()
    got = md5(body_of(sql))
    if got != want:
        raise SystemExit(f'{name}: md5 thân {got} khác bản production {want}')
    return sql


def replace_once(text, old, new, label):
    n = text.count(old)
    if n != 1:
        raise SystemExit(f'{label}: đoạn cần sửa xuất hiện {n} lần')
    return text.replace(old, new)


capture_old = load('capture')
seed_old = load('seed')

capture_new = replace_once(capture_old, """  IF jsonb_typeof(v_sub.filters -> 'campaignIds') = 'array' AND NOT ((v_sub.filters -> 'campaignIds') @> to_jsonb(NEW.id)) THEN
    RETURN NULL;
  END IF;
""", """  IF jsonb_typeof(v_sub.filters -> 'campaignIds') = 'array' AND NOT ((v_sub.filters -> 'campaignIds') @> to_jsonb(NEW.id)) THEN
    RETURN NULL;
  END IF;
  -- V680: chỉ báo "tạm dừng" khi hệ thống tự dừng (ghi chú có lý do). Khách tự bấm Tạm dừng thì ghi chú trống, hoặc giữ câu chờ
  -- của Nhóm data, hoặc là câu "Đang chờ tạm dừng" của bộ chạy Desktop (private.aka_agent_notification_user_pause_note).
  IF v_to = 'tạm dừng' AND private.aka_agent_notification_user_pause_note(NEW.note) THEN
    RETURN NULL;
  END IF;
""", 'capture: bỏ qua tạm dừng do khách bấm')

seed_new = replace_once(seed_old,
    "  if v_audience not in ('admin_akabiz', 'orgs', 'all') then return jsonb_build_object('audience', 'off'); end if;\n",
    "  if v_audience not in ('admin_akabiz', 'orgs', 'all') then\n"
    "    -- V680: bật sẵn thông báo tạm dừng theo công tắc riêng, kể cả khi báo cáo mặc định đang tắt.\n"
    "    return jsonb_build_object('audience', 'off') || private.aka_agent_notification_seed_campaign_pause(p_now);\n"
    "  end if;\n", 'seed: lối thoát sớm')
seed_new = replace_once(seed_new,
    """        update public.auto_notification_subscriptions set email_enabled = true, updated_at = p_now
         where staff_id = r.staff_id and scope = 'own' and event_type = 'report.morning' and is_enabled;
""",
    """        update public.auto_notification_subscriptions set email_enabled = true, updated_at = p_now
         where staff_id = r.staff_id and scope = 'own' and event_type = 'report.morning' and is_enabled;
        -- V680: dòng "tạm dừng" do hệ thống bật sẵn (khách chưa sửa) cũng nhận email khi vừa có email.
        update public.auto_notification_subscriptions set email_enabled = true, updated_at = p_now
         where staff_id = r.staff_id and scope = 'own' and event_type = 'campaign.status_changed' and is_enabled
           and filters ->> 'seededBy' = 'v680';
""", 'seed: email tự điền')
seed_new = replace_once(seed_new,
    """  perform set_config('aka.notification_center_write', '', true);
  return jsonb_build_object('audience', v_audience, 'seeded', v_full, 'morningAdded', v_morning, 'emailAdded', v_email,
                            'emailRoom', greatest(v_room - v_email, 0));
""",
    """  perform set_config('aka.notification_center_write', '', true);
  return jsonb_build_object('audience', v_audience, 'seeded', v_full, 'morningAdded', v_morning, 'emailAdded', v_email,
                            'emailRoom', greatest(v_room - v_email, 0))
         || private.aka_agent_notification_seed_campaign_pause(p_now);
""", 'seed: gọi bật sẵn tạm dừng')

NEW_FUNCS = r"""
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
"""


def as_create(sql):
    # Bản production dùng CREATE OR REPLACE; giữ nguyên tiêu đề hàm.
    return sql.strip() + '\n'


migration = f"""-- V680: bật sẵn thông báo "Chiến dịch tạm dừng" cho mọi nhân viên, chỉ báo khi hệ thống tự dừng (docs/ZALO_UID_ACCOUNT_GUARD_PLAN.md mục 4.5).
-- Sinh bằng scripts/zalo-uid-account-guard/build-v680-sql.py từ thân production đọc 27/11/2026. Không sửa tay.
-- 1) private.aka_agent_notification_capture_campaign: chuyển sang "tạm dừng" mà ghi chú là của khách tự bấm thì không ghi thông báo
--    (áp dụng cho mọi người, kể cả người đang tự bật).
-- 2) private.aka_agent_notification_seed_defaults gọi thêm private.aka_agent_notification_seed_campaign_pause: nhân viên đã có cài đặt
--    thông báo mà chưa có dòng "Chiến dịch" được thêm dòng toStatuses = ["tạm dừng"], đẩy iPhone, email khi đã có email.
--    Dòng do hệ thống thêm mang filters.seededBy = "v680" (khách lưu lại cài đặt thì mất dấu này).
-- 3) Công tắc notifications.default_campaign_pause = {{"audience":"all","batch":1000}}. Tắt: {{"audience":"off"}}.
-- Sửa thân hàm nên PostgREST nạp lại schema: apply buổi tối.

BEGIN;
SET LOCAL lock_timeout = '3s';

DO $pre$
BEGIN
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v680_%') THEN
    RAISE EXCEPTION 'v680: đã có trong sổ migration, không chạy lại';
  END IF;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'private.aka_agent_notification_capture_campaign()'::regprocedure) <> '{LIVE['capture'][1]}' THEN
    RAISE EXCEPTION 'v680: thân private.aka_agent_notification_capture_campaign đã đổi so với bản đọc 27/11/2026';
  END IF;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'private.aka_agent_notification_seed_defaults(timestamp with time zone)'::regprocedure) <> '{LIVE['seed'][1]}' THEN
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
{NEW_FUNCS}
{as_create(capture_new)}
{as_create(seed_new)}
INSERT INTO public.auto_system_settings (key, value, description, is_secret, is_active)
VALUES ('notifications.default_campaign_pause', '{{"audience":"all","batch":1000}}',
        'V680: bật sẵn thông báo Chiến dịch tạm dừng (chỉ khi hệ thống tự dừng). audience off | admin_akabiz | orgs | all.', false, true);

DO $post$
BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'private.aka_agent_notification_capture_campaign()'::regprocedure) <> '{md5(body_of(capture_new))}' THEN
    RAISE EXCEPTION 'v680: thân capture sau khi sửa không đúng';
  END IF;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'private.aka_agent_notification_seed_defaults(timestamp with time zone)'::regprocedure) <> '{md5(body_of(seed_new))}' THEN
    RAISE EXCEPTION 'v680: thân seed_defaults sau khi sửa không đúng';
  END IF;
END
$post$;

COMMIT;
"""

rollback = f"""-- Gỡ V680: trả hai hàm về thân production đọc 27/11/2026, tắt công tắc, bỏ các dòng "tạm dừng" do V680 thêm mà khách chưa sửa.
BEGIN;
SET LOCAL lock_timeout = '3s';
{as_create(capture_old)}
{as_create(seed_old)}
DELETE FROM public.auto_system_settings WHERE key = 'notifications.default_campaign_pause';
DELETE FROM public.auto_notification_subscriptions WHERE event_type = 'campaign.status_changed' AND filters ->> 'seededBy' = 'v680';
DROP FUNCTION private.aka_agent_notification_seed_campaign_pause(timestamptz);
DROP FUNCTION private.aka_agent_notification_user_pause_note(text);
COMMIT;
"""

with open(OUT, 'w', encoding='utf-8') as f:
    f.write(migration)
with open(ROLLBACK, 'w', encoding='utf-8') as f:
    f.write(rollback)
print('wrote', OUT, md5(migration))
print('capture new md5', md5(body_of(capture_new)), 'seed new md5', md5(body_of(seed_new)))
