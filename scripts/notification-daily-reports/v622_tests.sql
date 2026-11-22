-- V622 (chạy sau v621_tests.sql trên cùng cụm): tổng data chờ / dự kiến hôm nay tính trên mọi chiến dịch, không chỉ 50 dòng đầu.
\echo '== V622: tổng Chào ngày mới trên mọi chiến dịch'
SELECT fixture_assert((SELECT (r ->> 'campaignsTodayNeedsData')::int = 2 AND (r ->> 'campaignsTodayPending')::int = 71
                              AND (r ->> 'campaignsTodayExpected')::int = 20
                              AND (r ->> 'campaignsTodayExpected')::int = (SELECT sum((x ->> 'expectedToday')::int) FROM jsonb_array_elements(r -> 'campaignsToday') x)
                         FROM (SELECT public.aka_agent_notification_snapshot('morning', '{"staffId":1}') r) x),
                      'ít chiến dịch: tổng = cộng các dòng (20 dự kiến, 71 chờ)');
INSERT INTO auto_accounts (id, name, flatform_type, login_status, status, staff_id, organization_id)
SELECT 1000 + g, 'Zalo ' || g, 'zalo', 'đã đăng nhập', 'chờ xử lý', 1, 1 FROM generate_series(0, 59) g;
INSERT INTO auto_accounts (id, name, flatform_type, login_status, status, staff_id, organization_id)
VALUES (1100, 'Facebook Hà', 'facebook', 'đã đăng nhập', 'chờ xử lý', 1, 1);
INSERT INTO auto_campaigns (id, name, action_id, account_id, status, staff_id, organization_id, schedule, schedule_type)
SELECT 2000 + g, 'Loạt mới ' || g, 'zalo_message_phone', 1000 + g, 'chờ xử lý', 1, 1, now() + interval '2 hours' + g * interval '10 seconds', 'daily'
  FROM generate_series(0, 59) g;
INSERT INTO auto_campaigns (id, name, action_id, account_id, status, staff_id, organization_id, schedule, schedule_type)
VALUES (2100, 'Đăng fanpage', 'facebook_page_post', 1100, 'chờ xử lý', 1, 1, now() + interval '3 hours', 'daily');
INSERT INTO auto_campaign_input_data (campaign_id, status) SELECT 2000 + g, 'chờ xử lý' FROM generate_series(0, 59) g, generate_series(1, 3);
SELECT fixture_assert((SELECT jsonb_array_length(r -> 'campaignsToday') = 50 AND (r ->> 'campaignsTodayTotal')::int = 63
                              AND (r ->> 'campaignsTodayNeedsData')::int = 62
                              AND (r ->> 'campaignsTodayPending')::int = 71 + 180
                              AND (r ->> 'campaignsTodayExpected')::int = 20 + 180
                         FROM (SELECT public.aka_agent_notification_snapshot('morning', '{"staffId":1}') r) x),
                      'hơn 50 chiến dịch: tổng đủ 62 chiến dịch cần data (251 chờ, 200 dự kiến), bỏ chiến dịch đăng fanpage');
SELECT fixture_assert((SELECT (r ->> 'campaignsTodayExpected')::int > (SELECT sum(coalesce((x ->> 'expectedToday')::int, 0)) FROM jsonb_array_elements(r -> 'campaignsToday') x)
                         FROM (SELECT public.aka_agent_notification_snapshot('morning', '{"staffId":1}') r) x),
                      'tổng mới lớn hơn tổng cộng từ 50 dòng (lỗi của V621)');
UPDATE auto_campaigns SET status = 'tạm dừng' WHERE id BETWEEN 2000 AND 2059;
SELECT fixture_assert((SELECT (r ->> 'campaignsTodayNeedsData')::int = 2 AND (r ->> 'campaignsTodayTotal')::int = 3 AND (r ->> 'campaignsTodayExpected')::int = 20
                         FROM (SELECT public.aka_agent_notification_snapshot('morning', '{"staffId":1}') r) x),
                      'chỉ còn chiến dịch đăng fanpage + 2 chiến dịch cũ: cần data 2');
UPDATE auto_campaigns SET status = 'tạm dừng' WHERE id IN (10, 11);
SELECT fixture_assert((SELECT (r ->> 'campaignsTodayNeedsData')::int = 0 AND (r ->> 'campaignsTodayExpected')::int = 0 AND (r ->> 'campaignsTodayTotal')::int = 1
                         FROM (SELECT public.aka_agent_notification_snapshot('morning', '{"staffId":1}') r) x),
                      'chỉ chiến dịch không cần data: cần data 0 (API bỏ câu "dự kiến … data")');
