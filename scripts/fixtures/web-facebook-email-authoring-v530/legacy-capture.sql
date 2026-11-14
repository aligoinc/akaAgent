-- Chụp kết quả caller cũ trên định nghĩa trước v530.
DROP TABLE IF EXISTS v530_test.captured;
CREATE TABLE v530_test.captured AS SELECT * FROM v530_test.legacy_results();
DO $c$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM v530_test.captured;
  ASSERT n >= 150, 'captured only ' || n;
  ASSERT (SELECT count(DISTINCT name) FROM v530_test.captured) = n, 'duplicate capture names';
  -- Ca chụp phải có nội dung thật, không phải toàn mảng rỗng hoặc toàn lỗi.
  ASSERT (SELECT jsonb_array_length(payload->'items') FROM v530_test.captured WHERE name = 'page:facebook:none') >= 10, 'facebook scope page items';
  ASSERT (SELECT payload->>'reason' FROM v530_test.captured WHERE name = 'status:301:30002:chờ xử lý') = 'updated', 'status resume';
  ASSERT (SELECT payload->>'reason' FROM v530_test.captured WHERE name = 'delete:301:30003') = 'campaign_running', 'delete lease';
  ASSERT (SELECT payload->>'status' FROM v530_test.captured WHERE name = 'auth:h-301-web') = 'authenticated', 'auth ok';
  ASSERT (SELECT payload->>'status' FROM v530_test.captured WHERE name = 'auth:h-311-web') = 'capability_unavailable', 'email only blocked';
  ASSERT (SELECT payload->>'created' FROM v530_test.captured WHERE name = 'create:qr') = 'true', 'create qr';
  ASSERT (SELECT payload->'state'->'campaign'->>'web_campaign_form' FROM v530_test.captured WHERE name = 'create:qr') = 'form_1', 'create qr form';
  ASSERT (SELECT payload->>'error' FROM v530_test.captured WHERE name = 'create:cross') = 'control_action_not_allowed', 'create cross';
  ASSERT (SELECT payload->>'updated' FROM v530_test.captured WHERE name = 'update:qr-302-lease-app-off') = 'true', 'update qr app off';
  ASSERT (SELECT payload->>'updated' FROM v530_test.captured WHERE name = 'update:server-lease-app-alive') = 'true', 'update server lease';
  ASSERT (SELECT payload->>'appended_input_count' FROM v530_test.captured WHERE name = 'update:qr-append') = '1', 'update append';
  ASSERT (SELECT payload->>'updated' FROM v530_test.captured WHERE name = 'update_by_config:qr') = 'true', 'update by config';
  ASSERT (SELECT payload->>'inserted' FROM v530_test.captured WHERE name = 'add_rows:qr') = '1', 'add rows';
  -- Khoá tài khoản phụ ở Zalo/SMS bị bỏ qua từ trước v530 (kể cả giá trị không phải số).
  ASSERT (SELECT payload->>'created' = 'true' AND payload->'state'->'campaign'->'secondary_account_id' = 'null'::jsonb
    FROM v530_test.captured WHERE name = 'create:qr-secondary-text'), 'zalo create ignores secondaryAccountId';
  ASSERT (SELECT payload->>'created' FROM v530_test.captured WHERE name = 'create:sms-secondary-object') = 'true', 'sms create ignores secondaryAccountId';
  ASSERT (SELECT payload->>'updated' FROM v530_test.captured WHERE name = 'update:qr-secondary-keys') = 'true', 'zalo update ignores secondary keys';
  -- Đặt lại dấu "đã lấy data" bằng JSON null được ghi nguyên từ trước v530.
  ASSERT (SELECT payload->'state'->'campaign'->'extra_settings' FROM v530_test.captured WHERE name = 'update:server-reset-friend')
    = '{"enableMessage":true,"zaloFriendTargetMode":"selected","zaloFriendDataMaterializedAt":null,"zaloFriendMaterializedCount":0}'::jsonb, 'reset friend pair';
  ASSERT (SELECT payload->'state'->'campaign'->'extra_settings'->'zaloBirthdayMaterializedCount' FROM v530_test.captured WHERE name = 'update:qr-web-form-resets')
    = '0'::jsonb, 'web form reset birthday count';
  ASSERT (SELECT payload->'state'->'campaign'->'extra_settings' FROM v530_test.captured WHERE name = 'update_by_config:server-reset')
    = '{"zaloFriendDataMaterializedAt":null,"zaloFriendMaterializedCount":0}'::jsonb, 'reset through config version';
  RAISE NOTICE 'v530 legacy capture: % calls', n;
END
$c$;
