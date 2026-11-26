-- V671: engine giữ khoá thao tác dài hơn khi lỗi mới khoá ngắn hơn
-- Sinh bằng: node scripts/build-v671-sql.cjs (không sửa tay). aka_agent_engine_report_v1 md5 b39e1e9dbcab4775d96779bd4799b63a → 014a3d036874e3ea6cfbee02f4aa9441.
-- Khoá thao tác đến sau không ghi đè khoá đang còn hiệu lực và dài hơn (kể cả khoá không thời hạn). CREATE OR REPLACE: apply ngoài giờ cao điểm.
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $pre$
BEGIN
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration\_v671\_%') THEN
    RAISE EXCEPTION 'V671: số 671 đã có trong sổ migration';
  END IF;
END $pre$;

DO $patch$
DECLARE v_def text; v_new text;
BEGIN
  v_def := pg_get_functiondef('public.aka_agent_engine_report_v1(bigint, uuid, jsonb, boolean, boolean)'::regprocedure);
  IF md5(v_def) IS DISTINCT FROM 'b39e1e9dbcab4775d96779bd4799b63a' THEN RAISE EXCEPTION 'V671: aka_agent_engine_report_v1 đã đổi (md5 %)', md5(v_def); END IF;
  IF array_length(string_to_array(v_def, '            ON CONFLICT (account_id, action_code) DO UPDATE SET is_disable = true, date_enable = EXCLUDED.date_enable,
              disabled_error_code = EXCLUDED.disabled_error_code, disabled_reason = EXCLUDED.disabled_reason, disabled_at = EXCLUDED.disabled_at, updated_at = v_now;'), 1) <> 2 THEN RAISE EXCEPTION 'V671: đoạn ghi khoá không đúng một chỗ'; END IF;
  v_new := replace(v_def, '            ON CONFLICT (account_id, action_code) DO UPDATE SET is_disable = true, date_enable = EXCLUDED.date_enable,
              disabled_error_code = EXCLUDED.disabled_error_code, disabled_reason = EXCLUDED.disabled_reason, disabled_at = EXCLUDED.disabled_at, updated_at = v_now;', '            ON CONFLICT (account_id, action_code) DO UPDATE SET is_disable = true, date_enable = EXCLUDED.date_enable,
              disabled_error_code = EXCLUDED.disabled_error_code, disabled_reason = EXCLUDED.disabled_reason, disabled_at = EXCLUDED.disabled_at, updated_at = v_now
            -- V671: khoá đang có còn hiệu lực và dài hơn (kể cả không thời hạn) thì giữ nguyên, khoá đến sau không ghi đè.
            WHERE NOT coalesce(s.is_disable AND EXCLUDED.date_enable IS NOT NULL
                               AND (s.date_enable IS NULL OR (s.date_enable > v_now AND s.date_enable > EXCLUDED.date_enable)), false);');
  IF md5(v_new) IS DISTINCT FROM '014a3d036874e3ea6cfbee02f4aa9441' THEN RAISE EXCEPTION 'V671: thân report_v1 sau vá lệch (md5 %)', md5(v_new); END IF;
  EXECUTE v_new;
  IF md5(pg_get_functiondef('public.aka_agent_engine_report_v1(bigint, uuid, jsonb, boolean, boolean)'::regprocedure)) IS DISTINCT FROM '014a3d036874e3ea6cfbee02f4aa9441' THEN RAISE EXCEPTION 'V671: thân report_v1 sau khi tạo lại lệch'; END IF;
END $patch$;
COMMIT;
