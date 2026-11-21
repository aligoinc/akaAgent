-- Gỡ V618 p3: xoá dữ liệu quét data website. SINH TỪ scripts/build-v618-sql.cjs.
-- Còn chiến dịch / tài khoản web thì không xoá được loại chiến dịch (khoá ngoại): khi đó chỉ tắt công tắc (đổi web_scan.campaigns thành
-- {"organizationIds": []}) là đủ để không ai thấy / chạy được.
BEGIN;
SET LOCAL lock_timeout = '3s';
DO $pre$
BEGIN
  IF EXISTS (SELECT 1 FROM public.auto_campaigns WHERE action_id LIKE 'web\_find\_data\_%') THEN
    RAISE EXCEPTION 'Gỡ V618 p3: còn chiến dịch web, chỉ tắt công tắc web_scan.campaigns';
  END IF;
END $pre$;
DO $rules$
BEGIN
  IF to_regclass('public.auto_campaign_data_link_rules') IS NOT NULL THEN
    DELETE FROM public.auto_campaign_data_links WHERE rule_id IN
      (SELECT id FROM public.auto_campaign_data_link_rules WHERE source_action_id LIKE 'web\_find\_data\_%');
    DELETE FROM public.auto_campaign_data_link_rules WHERE source_action_id LIKE 'web\_find\_data\_%';
  END IF;
END $rules$;
DELETE FROM public.auto_outcome_policies WHERE source = 'v618';
DELETE FROM public.auto_account_action_status WHERE action_code IN ('web_nhatot_phone', 'web_batdongsan_phone', 'web_yellowpages_page')
   OR disabled_error_code IN ('err_web_scan_challenge', 'err_web_scan_batdongsan_login', 'err_web_scan_quota_reached', 'err_web_scan_layout_changed');
DELETE FROM public.auto_error WHERE error_code IN ('err_web_scan_challenge', 'err_web_scan_batdongsan_login', 'err_web_scan_quota_reached', 'err_web_scan_layout_changed');
DELETE FROM public.auto_elements WHERE name IN ('web_nhatot_phone_button', 'web_nhatot_phone_value', 'web_bds_card', 'web_bds_phone_button', 'web_bds_login_gate', 'web_bds_search_input', 'web_bds_search_button', 'web_yp_card');
DELETE FROM public.auto_blocks WHERE name IN ('[engine] web_nhatot_list', '[engine] web_nhatot_reveal', '[engine] web_batdongsan_search', '[engine] web_batdongsan_list', '[engine] web_batdongsan_reveal', '[engine] web_batdongsan_detail', '[engine] web_yellowpages_list', '[engine] web_yellowpages_detail');
DELETE FROM public.auto_campaign_actions WHERE id IN ('web_find_data_nhatot', 'web_find_data_batdongsan', 'web_find_data_yellowpages');
DELETE FROM public.auto_account_actions WHERE code IN ('web_nhatot_phone', 'web_batdongsan_phone', 'web_yellowpages_page');
DELETE FROM public.auto_system_settings WHERE key = 'web_scan.campaigns';
COMMIT;
