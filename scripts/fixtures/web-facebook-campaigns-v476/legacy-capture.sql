-- Chụp kết quả caller cũ trên định nghĩa trước V476.
DROP TABLE IF EXISTS v476_test.captured;
CREATE TABLE v476_test.captured AS SELECT * FROM v476_test.legacy_results();
DO $c$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM v476_test.captured;
  ASSERT n >= 100, 'captured only ' || n;
  ASSERT (SELECT count(DISTINCT name) FROM v476_test.captured) = n, 'duplicate capture names';
  -- Ca chụp phải có nội dung thật, không phải toàn mảng rỗng.
  ASSERT (SELECT jsonb_array_length(payload->'items') FROM v476_test.captured WHERE name = 'page:desktop:none') = 4, 'desktop page items';
  ASSERT (SELECT payload->>'reason' FROM v476_test.captured WHERE name = 'status:201:3003:tạm dừng') = 'updated', 'status pending';
  ASSERT (SELECT (payload->>'pause_pending')::boolean FROM v476_test.captured WHERE name = 'status:201:3003:tạm dừng'), 'pause pending';
  ASSERT (SELECT payload->>'reason' FROM v476_test.captured WHERE name = 'delete:201:3003') = 'campaign_running', 'delete lease';
  ASSERT (SELECT payload->>'status' FROM v476_test.captured WHERE name = 'auth:h-201-web') = 'authenticated', 'auth ok';
  ASSERT (SELECT payload->>'status' FROM v476_test.captured WHERE name = 'auth:h-211-web') = 'capability_unavailable', 'fb only blocked';
  ASSERT (SELECT jsonb_array_length(payload->'items') FROM v476_test.captured WHERE name = 'activity:desktop') = 2, 'desktop activity';
  RAISE NOTICE 'v476 legacy capture: % calls', n;
END
$c$;
