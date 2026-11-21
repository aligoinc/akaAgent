-- Gỡ V618 p1: xoá hai bảng quét data website. SINH TỪ scripts/build-v618-sql.cjs. Chỉ chạy sau khi đã gỡ p2.
BEGIN;
SET LOCAL lock_timeout = '3s';
DO $pre$
BEGIN
  IF to_regprocedure('public.aka_agent_web_scan_seen_v1(bigint,text,text[])') IS NOT NULL THEN
    RAISE EXCEPTION 'Gỡ V618 p1: còn hàm của p2, gỡ p2 trước';
  END IF;
END $pre$;
DROP TABLE IF EXISTS private.auto_web_scan_seen;
DROP TABLE IF EXISTS private.auto_web_scan_listings;
COMMIT;
