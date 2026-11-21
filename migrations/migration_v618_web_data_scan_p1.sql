-- V618 p1: bảng tin đã quét / số đã hiện của quét data website. SINH TỪ scripts/build-v618-sql.cjs, không sửa tay.
-- Chỉ tạo bảng mới trong schema private (PostgREST không thấy, không nạp lại schema API). Gỡ: rollback_v618_web_data_scan_p1.sql (chỉ khi chưa apply p2).
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '120s';

DO $pre$
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name = 'migration_v618_web_data_scan_p1') THEN
      RAISE EXCEPTION 'V618 p1 đã có trong sổ migration, không chạy lại';
    END IF;
  END IF;
  IF to_regclass('private.auto_web_scan_seen') IS NOT NULL OR to_regclass('private.auto_web_scan_listings') IS NOT NULL THEN
    RAISE EXCEPTION 'V618 p1: đã có bảng quét data website (lần chạy trước để lại?)';
  END IF;
END $pre$;

-- Tin đã quét theo chiến dịch ("Bỏ qua tin đã quét ở lượt trước"). Mã tin theo trang (nhatot list_id, batdongsan prid, Trang Vàng mã hồ sơ).
CREATE TABLE private.auto_web_scan_seen (
  campaign_id bigint NOT NULL,
  site text NOT NULL CHECK (site IN ('nhatot', 'batdongsan', 'yellowpages')),
  listing_key text NOT NULL CHECK (length(listing_key) BETWEEN 1 AND 200),
  seen_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (campaign_id, site, listing_key)
);
CREATE INDEX idx_auto_web_scan_seen_seen_at ON private.auto_web_scan_seen (seen_at);

-- Số đã hiện theo tổ chức (anh chốt 21/11/2026: tin đã có số do chiến dịch khác cùng tổ chức hiện trong 30 ngày thì dùng lại, không bấm lại).
CREATE TABLE private.auto_web_scan_listings (
  organization_id bigint NOT NULL,
  site text NOT NULL CHECK (site IN ('nhatot', 'batdongsan', 'yellowpages')),
  listing_key text NOT NULL CHECK (length(listing_key) BETWEEN 1 AND 200),
  phone text NOT NULL CHECK (phone ~ '^0[0-9]{9,10}$'),
  name text,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  revealed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (organization_id, site, listing_key)
);
CREATE INDEX idx_auto_web_scan_listings_revealed_at ON private.auto_web_scan_listings (revealed_at);

ALTER TABLE private.auto_web_scan_seen ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.auto_web_scan_listings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.auto_web_scan_seen, private.auto_web_scan_listings FROM PUBLIC;
DO $grants$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role', 'aka_agent_desktop', 'aka_agent_chat_api'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON TABLE private.auto_web_scan_seen, private.auto_web_scan_listings FROM %I', r);
    END IF;
  END LOOP;
END $grants$;

COMMIT;
