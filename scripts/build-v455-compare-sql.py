#!/usr/bin/env python3
"""Sinh script so sánh v455 trước khi apply (CHỈ ĐỌC) từ chính migration.

Chạy lại script này mỗi khi sửa migration_v455_web_desktop_accounts.sql:
    python3 scripts/build-v455-compare-sql.py

Script SQL sinh ra (migrations/tests/migration_v455_web_desktop_accounts_compare.sql):
- chạy đúng các bước kiểm md5 + vá của migration trên định nghĩa live (dry run cả 10 hàm),
- chỉ tạo bản sao vá của 3 hàm đọc + hàm Tiến trình Desktop trong pg_temp (không đụng public,
  không làm PostgREST nạp lại schema vì event trigger bỏ qua pg_temp),
- so kết quả/thời gian bản đang chạy với bản vá cho caller cũ (zalo/sms) và đo đường Desktop.
Phải chạy trong MỘT phiên (một lệnh execute_sql) vì đối tượng pg_temp chỉ sống trong phiên đó.
"""
from pathlib import Path
import re

root = Path(__file__).resolve().parent.parent
migration = (root / 'migrations/migration_v455_web_desktop_accounts.sql').read_text()
out = root / 'migrations/tests/migration_v455_web_desktop_accounts_compare.sql'


def between(text: str, start: str, end: str, include_end: bool = True) -> str:
    i = text.index(start)
    j = text.index(end, i)
    return text[i:j + (len(end) if include_end else 0)]


helpers = between(migration, 'CREATE OR REPLACE FUNCTION pg_temp.v455_replace(', 'DO $migration$', include_end=False)
activity = between(migration, 'CREATE OR REPLACE FUNCTION public.aka_agent_control_desktop_activity(', '$function$;')
activity = activity.replace('FUNCTION public.aka_agent_control_desktop_activity(',
                            'FUNCTION pg_temp.aka_agent_control_desktop_activity_v455(', 1)
patch = between(migration, 'DO $migration$', '$migration$;')

old_execute = """    EXECUTE d;
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc p WHERE p.oid = f
        AND jsonb_build_object('secdef', p.prosecdef, 'volatile', p.provolatile, 'config', p.proconfig, 'acl', p.proacl::text) = attrs
    ) THEN
      RAISE EXCEPTION 'v455_attributes_changed:%', r.signature;
    END IF;
  END LOOP;"""
new_execute = """    -- So sánh: không EXECUTE lên public. Chỉ ghi nhận bản vá khớp md5 đích và tạo bản sao
    -- pg_temp cho 3 hàm đọc (cột runtime_state chưa có trên production nên thay bằng NULL).
    INSERT INTO v455_cmp(check_name, ok, detail) VALUES ('patch_dry_run', true, r.signature);
    IF r.signature LIKE 'public.aka_agent_control_account_snapshot(%'
       OR r.signature LIKE 'public.aka_agent_control_campaign_page(%'
       OR r.signature LIKE 'public.aka_agent_control_campaign_logs(%' THEN
      d := regexp_replace(d, 'FUNCTION public\\.([a-z_]+)\\(', 'FUNCTION pg_temp.\\1_v455(');
      d := replace(replace(d, 'presence.runtime_state_at', 'NULL::timestamptz'), 'presence.runtime_state', 'NULL::jsonb');
      EXECUTE d;
    END IF;
  END LOOP;"""
assert patch.count(old_execute) == 1, 'migration execute block changed; update this generator'
patch = patch.replace(old_execute, new_execute)
postflight_start = patch.index('  -- Postflight:')
postflight_end = patch.index('END\n$migration$;')
patch = patch[:postflight_start] + patch[postflight_end:]
patch = patch.replace("CONTINUE WHEN md5(d) = r.target;",
                      "IF md5(d) = r.target THEN\n      INSERT INTO v455_cmp(check_name, ok, detail) VALUES ('already_applied', false, r.signature);\n      CONTINUE;\n    END IF;")
assert 'EXECUTE d;' in patch and '-- Postflight' not in patch

compare = r"""
CREATE OR REPLACE FUNCTION pg_temp.v455_strip_page(p jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $strip$
  -- Bản vá chỉ thêm hai trường vào mỗi dòng chiến dịch; bỏ chúng để so với bản đang chạy.
  SELECT CASE WHEN jsonb_typeof(p) IS DISTINCT FROM 'object' THEN p ELSE
    (CASE WHEN jsonb_typeof(p->'selected') = 'object'
      THEN jsonb_set(p, '{selected}', (p->'selected') - 'isZaloShowWeb' - 'runtimeBusy') ELSE p END)
    || CASE WHEN jsonb_typeof(p->'items') = 'array' THEN jsonb_build_object('items', COALESCE((
      SELECT jsonb_agg(CASE WHEN jsonb_typeof(e) = 'object' THEN e - 'isZaloShowWeb' - 'runtimeBusy' ELSE e END ORDER BY o)
      FROM jsonb_array_elements(p->'items') WITH ORDINALITY AS x(e, o)), '[]'::jsonb)) ELSE '{}'::jsonb END
  END
$strip$;

CREATE OR REPLACE FUNCTION pg_temp.v455_strip_snapshot(p jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $strip$
  -- Caller cũ nhận thêm khoá desktopPresence = null; bỏ để so.
  SELECT CASE WHEN p ? 'desktopPresence' AND p->'desktopPresence' = 'null'::jsonb THEN p - 'desktopPresence' ELSE p END
$strip$;

DO $compare$
DECLARE
  s record;
  t0 timestamptz;
  v_old jsonb;
  v_new jsonb;
  old_ms numeric;
  new_ms numeric;
  v_campaign bigint;
  v_legacy text[] := ARRAY['zalo', 'sms'];
  v_desktop text[] := ARRAY['zalo', 'sms', 'zalo_qr', 'zalo_web'];
  v_filters jsonb := jsonb_build_object('applyDisplaySettings', true,
    'dateFrom', to_char(timezone('Asia/Ho_Chi_Minh', now()) - interval '7 days', 'YYYY-MM-DD'),
    'dateTo', to_char(timezone('Asia/Ho_Chi_Minh', now()), 'YYYY-MM-DD'));
  i integer;
BEGIN
  -- 1. Caller cũ (Web/API/app mobile đang chạy): nhân viên có nhiều chiến dịch Zalo Server/SMS nhất.
  FOR s IN
    SELECT c.staff_id, c.organization_id, count(*) AS n
    FROM auto_campaigns c JOIN auto_accounts a ON a.id = c.account_id
    WHERE c.is_delete = false
      AND (a.flatform_type = 'sms' OR (a.flatform_type = 'zalo' AND a.is_zalo_server IS TRUE AND a.is_zalo_show_web IS FALSE))
    GROUP BY 1, 2 ORDER BY n DESC LIMIT 3
  LOOP
    old_ms := NULL; new_ms := NULL;
    FOR i IN 1..2 LOOP
      t0 := clock_timestamp();
      v_old := public.aka_agent_control_campaign_page(p_staff_id => s.staff_id, p_organization_id => s.organization_id,
        p_platforms => v_legacy, p_filters => v_filters, p_page => 1, p_drafts => '[]'::jsonb, p_selected_id => NULL);
      old_ms := least(COALESCE(old_ms, 1e9), extract(epoch FROM clock_timestamp() - t0) * 1000);
      t0 := clock_timestamp();
      v_new := pg_temp.aka_agent_control_campaign_page_v455(p_staff_id => s.staff_id, p_organization_id => s.organization_id,
        p_platforms => v_legacy, p_filters => v_filters, p_page => 1, p_drafts => '[]'::jsonb, p_selected_id => NULL);
      new_ms := least(COALESCE(new_ms, 1e9), extract(epoch FROM clock_timestamp() - t0) * 1000);
    END LOOP;
    INSERT INTO v455_cmp(check_name, staff_id, organization_id, ok, old_ms, new_ms, detail)
    VALUES ('page_legacy_same', s.staff_id, s.organization_id, pg_temp.v455_strip_page(v_new) = v_old,
      round(old_ms, 1), round(new_ms, 1), 'campaigns=' || s.n || ' items=' || COALESCE(jsonb_array_length(v_old->'items'), 0));

    old_ms := NULL; new_ms := NULL;
    FOR i IN 1..2 LOOP
      t0 := clock_timestamp();
      v_old := public.aka_agent_control_account_snapshot(p_staff_id => s.staff_id, p_organization_id => s.organization_id,
        p_platforms => v_legacy, p_view => 'accounts', p_account_ids => NULL, p_versions => '{}'::jsonb, p_catalog_version => NULL);
      old_ms := least(COALESCE(old_ms, 1e9), extract(epoch FROM clock_timestamp() - t0) * 1000);
      t0 := clock_timestamp();
      v_new := pg_temp.aka_agent_control_account_snapshot_v455(p_staff_id => s.staff_id, p_organization_id => s.organization_id,
        p_platforms => v_legacy, p_view => 'accounts', p_account_ids => NULL, p_versions => '{}'::jsonb, p_catalog_version => NULL);
      new_ms := least(COALESCE(new_ms, 1e9), extract(epoch FROM clock_timestamp() - t0) * 1000);
    END LOOP;
    INSERT INTO v455_cmp(check_name, staff_id, organization_id, ok, old_ms, new_ms, detail)
    VALUES ('snapshot_legacy_same', s.staff_id, s.organization_id, pg_temp.v455_strip_snapshot(v_new) = v_old,
      round(old_ms, 1), round(new_ms, 1), 'accounts=' || COALESCE(jsonb_array_length(v_old->'items'), 0));

    SELECT c.id INTO v_campaign
    FROM auto_campaigns c JOIN auto_accounts a ON a.id = c.account_id
    WHERE c.staff_id = s.staff_id AND c.organization_id = s.organization_id AND c.is_delete = false
      AND (a.flatform_type = 'sms' OR (a.flatform_type = 'zalo' AND a.is_zalo_server IS TRUE AND a.is_zalo_show_web IS FALSE))
    ORDER BY c.last_run_at DESC NULLS LAST, c.id DESC LIMIT 1;
    IF v_campaign IS NOT NULL THEN
      t0 := clock_timestamp();
      v_old := public.aka_agent_control_campaign_logs(s.staff_id, s.organization_id, v_campaign, v_legacy, '{}'::jsonb);
      old_ms := extract(epoch FROM clock_timestamp() - t0) * 1000;
      t0 := clock_timestamp();
      v_new := pg_temp.aka_agent_control_campaign_logs_v455(s.staff_id, s.organization_id, v_campaign, v_legacy, '{}'::jsonb);
      new_ms := extract(epoch FROM clock_timestamp() - t0) * 1000;
      INSERT INTO v455_cmp(check_name, staff_id, organization_id, ok, old_ms, new_ms, detail)
      VALUES ('logs_legacy_same', s.staff_id, s.organization_id, v_new = v_old, round(old_ms, 1), round(new_ms, 1),
        'campaign=' || v_campaign || ' entries=' || COALESCE(jsonb_array_length(v_old->'items'), 0));
    END IF;
  END LOOP;

  -- 2. Đường Desktop mới: nhân viên có nhiều chiến dịch Zalo mã QR/trình duyệt nhất (chỉ đo, chưa ai gọi).
  FOR s IN
    SELECT c.staff_id, c.organization_id, count(*) AS n
    FROM auto_campaigns c JOIN auto_accounts a ON a.id = c.account_id
    WHERE c.is_delete = false AND a.flatform_type = 'zalo' AND a.is_zalo_server IS NOT TRUE
    GROUP BY 1, 2 ORDER BY n DESC LIMIT 3
  LOOP
    t0 := clock_timestamp();
    v_new := pg_temp.aka_agent_control_campaign_page_v455(p_staff_id => s.staff_id, p_organization_id => s.organization_id,
      p_platforms => v_desktop, p_filters => v_filters, p_page => 1, p_drafts => '[]'::jsonb, p_selected_id => NULL);
    INSERT INTO v455_cmp(check_name, staff_id, organization_id, ok, new_ms, detail)
    VALUES ('page_desktop', s.staff_id, s.organization_id, v_new ? 'items', round(extract(epoch FROM clock_timestamp() - t0) * 1000, 1),
      'campaigns=' || s.n || ' items=' || COALESCE(jsonb_array_length(v_new->'items'), 0) || ' total=' || COALESCE(v_new->>'total', '?'));

    t0 := clock_timestamp();
    v_new := pg_temp.aka_agent_control_account_snapshot_v455(p_staff_id => s.staff_id, p_organization_id => s.organization_id,
      p_platforms => v_desktop, p_view => 'accounts', p_account_ids => NULL, p_versions => '{}'::jsonb, p_catalog_version => NULL);
    INSERT INTO v455_cmp(check_name, staff_id, organization_id, ok, new_ms, detail)
    VALUES ('snapshot_desktop', s.staff_id, s.organization_id, v_new ? 'desktopPresence', round(extract(epoch FROM clock_timestamp() - t0) * 1000, 1),
      'accounts=' || COALESCE(jsonb_array_length(v_new->'items'), 0) || ' online=' || COALESCE(v_new->'desktopPresence'->>'online', '?'));

    t0 := clock_timestamp();
    v_new := pg_temp.aka_agent_control_desktop_activity_v455(s.staff_id, s.organization_id, v_desktop, NULL, 100);
    INSERT INTO v455_cmp(check_name, staff_id, organization_id, ok, new_ms, detail)
    VALUES ('activity_desktop', s.staff_id, s.organization_id, v_new ? 'items', round(extract(epoch FROM clock_timestamp() - t0) * 1000, 1),
      'items=' || COALESCE(jsonb_array_length(v_new->'items'), 0));
  END LOOP;
END
$compare$;
"""

header = """-- v455 SO SÁNH TRƯỚC KHI APPLY — CHỈ ĐỌC. File sinh tự động bởi scripts/build-v455-compare-sql.py
-- từ migrations/migration_v455_web_desktop_accounts.sql; đừng sửa tay.
-- Không tạo/sửa đối tượng public (mọi bản sao nằm trong pg_temp, event trigger PostgREST bỏ qua pg_temp)
-- và không ghi dữ liệu nghiệp vụ. Chạy trong MỘT phiên, ví dụ một lệnh execute_sql.
-- Kết quả: patch_dry_run (10 hàm vá khớp md5 đích), *_legacy_same (caller cũ nhận đúng kết quả cũ,
-- kèm thời gian cũ/mới), *_desktop (đường Desktop mới chỉ đo thời gian).
SET statement_timeout = '110s';
CREATE TEMP TABLE IF NOT EXISTS v455_cmp (
  seq bigserial, check_name text, staff_id bigint, organization_id bigint,
  ok boolean, old_ms numeric, new_ms numeric, detail text
);
TRUNCATE v455_cmp;

"""
footer = """
SELECT check_name, staff_id, organization_id, ok, old_ms, new_ms, detail FROM v455_cmp ORDER BY seq;
"""
out.write_text(header + helpers + '\n' + activity + '\n\n' + patch + '\n' + compare + footer)
print(f'wrote {out.relative_to(root)} ({len(out.read_text())} bytes)')
