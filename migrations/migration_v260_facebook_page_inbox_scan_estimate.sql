-- Migration v260: Facebook Page inbox scan estimate.
-- Data only: no table, column, RPC, or permission changes.
-- Final user-selected budget: 2400 seconds / 20,000 customers (40 minutes).
-- This replaces the initial 1602-second projection; do not add another 20%.
-- Default 5,000-customer display: ceil(2400 * 5000 / 20000 / 60) = 10 minutes.
-- Live preflight on linked project cgjbsmqtfhqvttudyjzq captured the initial
-- value/description/flags checksum: 48581f326cd1e5237d745b14b8bac0c0.
--
-- Benchmark: installed akaAgent v7.0.0, 2026-09-07, Page Makeonce Marketing
-- Automation. The existing Graph API loader completed normally with 637 unique
-- customers (25 conversations per full response), updating existing local data.
-- No customer message bodies, tokens, or cookies are recorded here.
--
-- UI scan invocation:             2026-09-07T07:22:57.537Z
-- SQLite timestamp, first 500:    2026-09-07T07:23:36.849Z (+39.312 seconds)
-- SQLite timestamp, remaining 137:2026-09-07T07:23:45.947Z (+48.410 seconds)
-- These timestamps measure time through the final local save, excluding later
-- account release and UI refresh. The start includes the UI click dispatch.
--
-- Linear estimate from the two persistence checkpoints:
--   seconds/customer = (48.410 - 39.312) / 137 = 0.0664087591
--   setup seconds    = 39.312 - 500 * seconds/customer = 6.107620438
-- Setup is inferred from these checkpoints, not independently instrumented.
-- This is a projection from one 637-customer sample, not a 20,000-customer run.
--   padded seconds/20,000 = ceil((setup + 20000 * seconds/customer) * 1.20)
--                         = 1602 seconds (original projection only)
-- The measured sample remains unchanged; 2400 is the user's calibration.
-- This file replaces the uncommitted timestamp-named seed, which was executed
-- through db query without adding a Supabase migration-history entry.

DO $page_inbox_scan_estimate$
DECLARE
  v_key constant text := 'facebook.page_inbox.scan_estimated_seconds_per_20000';
  v_source_md5 constant text := '48581f326cd1e5237d745b14b8bac0c0';
  v_value constant text := '2400';
  v_description constant text := 'Thời gian ước tính (giây) quét 20.000 khách inbox Page: 2.400 giây, khoảng 40 phút theo cấu hình đã chốt ngày 07/09/2026. Đây là mốc cuối đã có dự phòng, không cộng thêm 20%. Số phút hiển thị theo Y = ceil(value * Y / 20000 / 60), tối thiểu 1 phút; 5.000 khách khoảng 10 phút. Thời gian thực tế phụ thuộc phản hồi Facebook.';
  v_current_md5 text;
  v_target_md5 text;
  v_updated integer;
BEGIN
  v_target_md5 := md5(jsonb_build_array(v_value, v_description, false, true)::text);

  -- Fresh databases seed the final budget; existing rows are checked below.
  INSERT INTO public.auto_system_settings (key, value, description, is_secret, is_active)
  VALUES (v_key, v_value, v_description, false, true)
  ON CONFLICT (key) DO NOTHING;

  SELECT md5(jsonb_build_array(setting.value, setting.description, setting.is_secret, setting.is_active)::text)
  INTO v_current_md5
  FROM public.auto_system_settings AS setting
  WHERE setting.key = v_key
  FOR UPDATE;

  IF v_current_md5 = v_target_md5 THEN
    RETURN;
  END IF;

  IF v_current_md5 IS DISTINCT FROM v_source_md5 THEN
    RAISE EXCEPTION 'v260 Page inbox estimate changed unexpectedly (expected source % or target %, got %)',
      v_source_md5, v_target_md5, v_current_md5;
  END IF;

  UPDATE public.auto_system_settings AS setting
  SET value = v_value,
      description = v_description,
      updated_at = now()
  WHERE setting.key = v_key
    AND md5(jsonb_build_array(setting.value, setting.description, setting.is_secret, setting.is_active)::text) = v_source_md5;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> 1 THEN
    RAISE EXCEPTION 'v260 failed to update the Page inbox estimate';
  END IF;
END;
$page_inbox_scan_estimate$;
