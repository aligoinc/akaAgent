-- Gỡ V657 phần 1 (chạy sau khi đã gỡ phần 2): xoá job, hàm nạp, bảng đối chiếu, thiết lập.
BEGIN;
SET LOCAL lock_timeout = '3s';
DO $g$
BEGIN
 IF to_regprocedure('private.aka_agent_send_exclusion_match(public.auto_campaigns,bigint,jsonb,text,text,text,boolean)') IS NOT NULL THEN
  RAISE EXCEPTION 'Gỡ V657 p2 trước';
 END IF;
 IF to_regclass('cron.job') IS NOT NULL THEN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='aka-agent-zalo-phone-identity') THEN PERFORM cron.unschedule('aka-agent-zalo-phone-identity'); END IF;
 END IF;
END $g$;
DROP FUNCTION private.aka_agent_zalo_phone_identity_ingest(integer,integer);
DROP TABLE private.auto_zalo_phone_identity_state;
DROP TABLE private.auto_zalo_phone_identity;
DELETE FROM public.auto_system_settings WHERE key='send_exclusion.identity';
DELETE FROM supabase_migrations.schema_migrations WHERE name='migration_v657_send_exclusion_global_match_p1';
COMMIT;
