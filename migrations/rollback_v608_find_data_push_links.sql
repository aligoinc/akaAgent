-- Gỡ V608 (migrations/migration_v608_find_data_push_links.sql).
-- Xoá hàm đẩy data, hai hàm phụ và ba bảng (kèm toàn bộ liên kết và sổ đẩy). Dòng data đã thêm vào chiến dịch đích giữ nguyên.
-- Desktop có bản gọi hàm tự quay về cách đẩy cũ khi hàm không còn (PGRST202).
-- Không xoá dòng sổ migration: V608 không chạy lại được sau khi gỡ (preflight chặn theo sổ); muốn chạy lại phải xoá dòng sổ bằng tay.

BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DROP FUNCTION IF EXISTS public.aka_agent_find_data_push_v1(jsonb);
DROP FUNCTION IF EXISTS private.aka_agent_find_data_link_block_reason(bigint, bigint, bigint, bigint, text[]);
DROP FUNCTION IF EXISTS private.aka_agent_find_data_link_target_ids(jsonb, text, bigint);
DROP TABLE IF EXISTS public.auto_campaign_data_link_deliveries;
DROP TABLE IF EXISTS public.auto_campaign_data_links;
DROP TABLE IF EXISTS public.auto_campaign_data_link_rules;

DO $post$
BEGIN
  IF to_regclass('public.auto_campaign_data_link_rules') IS NOT NULL
    OR to_regclass('public.auto_campaign_data_links') IS NOT NULL
    OR to_regclass('public.auto_campaign_data_link_deliveries') IS NOT NULL
    OR to_regprocedure('public.aka_agent_find_data_push_v1(jsonb)') IS NOT NULL
  THEN
    RAISE EXCEPTION 'Rollback V608: còn đối tượng của V608';
  END IF;
END $post$;

COMMIT;
