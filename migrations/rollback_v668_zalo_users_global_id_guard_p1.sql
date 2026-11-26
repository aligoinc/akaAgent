-- Gỡ V668 p1: bỏ trigger chặn ghi Global ID của người xem vào zalo_users và 3 hàm mới. Gỡ p2 (nếu đã apply) trước: p2 dùng
-- private.aka_agent_zalo_user_gid_trusted.
SET LOCAL lock_timeout = '5s';
DO $pre$
BEGIN
 IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'private' AND p.proname IN ('aka_agent_zalo_gid_ok','aka_agent_send_exclusion_match','aka_agent_send_exclusion_person_keys','aka_agent_send_exclusion_block_facts')
              AND p.prosrc LIKE '%aka_agent_zalo_user_gid_trusted%') THEN
  RAISE EXCEPTION 'Gỡ V668 p1: hàm so khớp còn dùng aka_agent_zalo_user_gid_trusted (gỡ p2 trước)';
 END IF;
END $pre$;
DROP TRIGGER IF EXISTS trg_zalo_users_guard_global_id_ins ON public.zalo_users;
DROP TRIGGER IF EXISTS trg_zalo_users_guard_global_id_upd ON public.zalo_users;
DROP FUNCTION IF EXISTS private.aka_agent_zalo_users_guard_global_id();
DROP FUNCTION IF EXISTS private.aka_agent_zalo_own_uids(bigint);
DROP FUNCTION IF EXISTS private.aka_agent_zalo_user_gid_trusted(jsonb, text);
