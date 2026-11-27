-- Gỡ V677: bỏ luật và chính sách của mã err_engine_zalo_profile_unavailable, tắt mã (tín hiệu profile_unavailable lại rơi vào luật chung NET01: data về hàng đợi).
BEGIN;
SET LOCAL lock_timeout = '3s';
DO $pre$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.auto_outcome_signal_rules WHERE source = 'v677') THEN RAISE EXCEPTION 'Chưa có V677, không gỡ'; END IF;
END $pre$;
DELETE FROM public.auto_outcome_signal_rules WHERE source = 'v677';
DELETE FROM public.auto_outcome_policies WHERE source = 'v677';
UPDATE public.auto_error SET is_active = false, is_delete = true WHERE error_type = 'engine v2' AND error_code = 'err_engine_zalo_profile_unavailable';
DO $post$
BEGIN
  IF (SELECT cs.error_code FROM public.aka_agent_engine_classify_signal('zalo', 'zalo_message_stranger', 'before_send', '{"kind": "engine", "code": "profile_unavailable"}'::jsonb) cs)
     = 'err_engine_zalo_profile_unavailable' THEN RAISE EXCEPTION 'Gỡ V677: tín hiệu vẫn ra mã mới'; END IF;
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    DELETE FROM supabase_migrations.schema_migrations WHERE name = 'migration_v677_zalo_profile_unavailable';
  END IF;
END $post$;
COMMIT;
