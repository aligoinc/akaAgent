-- Kiểm V652 sau khi chạy fixture + p1 + p2 + p3. Mỗi khẳng định sai thì RAISE.
\set ON_ERROR_STOP 1
CREATE FUNCTION pg_temp.eq(p_label text, p_got anyelement, p_want anyelement) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_got IS DISTINCT FROM p_want THEN RAISE EXCEPTION 'FAIL %: got %, want %', p_label, p_got, p_want; END IF;
  RAISE NOTICE 'PASS %', p_label;
END $$;
CREATE FUNCTION pg_temp.st(p_staff bigint, p_action text, p_payload jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE sql AS
  $$ SELECT public.aka_agent_control_email_prompt(p_staff, (SELECT organization_id FROM public.org_staff WHERE id = p_staff), p_action, p_payload) $$;

-- Dữ liệu: A = admin không có email ở đâu; B = admin chỉ có email ở CRM; C = admin chỉ có email tổ chức + nhân viên;
-- D = hết gói; E = 2 tài khoản không ai có email (1 admin, 1 nhân viên).
INSERT INTO public.aka_customer(id, email) VALUES (101, NULL), (102, 'Crm.B@Gmail.com '), (103, NULL), (104, NULL), (105, '  ');
INSERT INTO public.org_organization(id, customer_id, name, email) VALUES
  (1, 101, 'Org A', NULL), (2, 102, 'Org B', ''), (3, 103, 'Org C', 'org.c@yahoo.com'), (4, 104, 'Org D', NULL), (5, 105, 'Org E', NULL);
INSERT INTO public.org_staff(id, organization_id, name, username, email, is_admin, is_admin_akabiz) VALUES
  (1, 1, 'Admin A', 'adminA', NULL, true, true),
  (2, 2, 'Admin B', 'adminB', NULL, true, false),
  (3, 3, 'Admin C', 'adminC', NULL, true, false),
  (4, 3, 'Staff C', 'staffC', NULL, false, false),
  (5, 4, 'Admin D', 'adminD', NULL, true, false),
  (6, 5, 'Admin E', 'adminE', NULL, true, false),
  (7, 5, 'Staff E', 'staffE', '', false, false);
INSERT INTO public.org_organization_product(organization_id, product_name, package_name, expiration_date, is_deleted, is_paid) VALUES
  (1, 'akaAgent Zalo', 'Gói năm', now() + interval '30 days', false, true),
  (1, 'akaAgent Facebook', 'Gói cũ', now() - interval '3 days', false, true),
  (2, 'akaAgent Zalo', 'Dùng thử', now() + interval '5 days', false, false),
  (3, 'akaAgent Zalo', 'Gói năm', now() + interval '30 days', NULL, true),
  (4, 'akaAgent Zalo', 'Gói năm', now() - interval '1 day', false, true),
  (5, 'akaAgent Zalo', 'Gói năm', now() + interval '30 days', false, true);

-- p3 đã điền danh sách cho dữ liệu cũ; khách CRM không nối tổ chức thì không.
SELECT pg_temp.eq('p3 org_staff', (SELECT email_list FROM public.org_staff WHERE id = 99), ARRAY['old.staff@x.vn']);
SELECT pg_temp.eq('p3 tổ chức', (SELECT email_list FROM public.org_organization WHERE id = 99), ARRAY['old.org@x.vn']);
SELECT pg_temp.eq('p3 CRM nối tổ chức', (SELECT email_list FROM public.aka_customer WHERE id = 199), ARRAY['old.crm@x.vn']);
SELECT pg_temp.eq('p3 bỏ qua khách tiềm năng', (SELECT email_list FROM public.aka_customer WHERE id = 198), '{}'::text[]);

-- Trigger email_list.
UPDATE public.aka_customer SET email = email WHERE id = 102;
SELECT pg_temp.eq('crm cập nhật email không đổi giá trị vẫn ghi danh sách', (SELECT email_list FROM public.aka_customer WHERE id = 102), ARRAY['crm.b@gmail.com']);

-- Công tắc tắt (mặc định).
SELECT pg_temp.eq('mặc định tắt', pg_temp.st(1, 'state') ->> 'reason', 'disabled');
SELECT pg_temp.eq('tắt thì save bị chặn', pg_temp.st(1, 'save', '{"email":"a@x.vn","client":"web"}') ->> 'reason', 'disabled');
SELECT pg_temp.eq('tắt thì không ghi email', (SELECT email FROM public.org_staff WHERE id = 1), NULL::text);

-- audience admin_akabiz: chỉ staff 1.
UPDATE public.auto_system_settings SET value = '{"audience":"admin_akabiz"}' WHERE key = 'account.email_prompt';
SELECT pg_temp.eq('admin_akabiz: staff 1 thấy form', pg_temp.st(1, 'state') ->> 'show', 'enter');
SELECT pg_temp.eq('admin_akabiz: staff 6 không', pg_temp.st(6, 'state') ->> 'reason', 'disabled');
-- audience orgs.
UPDATE public.auto_system_settings SET value = '{"audience":"orgs","organizationIds":[5]}' WHERE key = 'account.email_prompt';
SELECT pg_temp.eq('orgs: tổ chức 5 bật', pg_temp.st(6, 'state') ->> 'show', 'enter');
SELECT pg_temp.eq('orgs: tổ chức 1 tắt', pg_temp.st(1, 'state') ->> 'reason', 'disabled');
UPDATE public.auto_system_settings SET value = '{"audience":"all"}' WHERE key = 'account.email_prompt';

-- A: không có email ở đâu -> hiện form, đếm lượt hiện.
SELECT pg_temp.eq('A thấy form', pg_temp.st(1, 'state') ->> 'show', 'enter');
SELECT pg_temp.eq('A có nhãn', (pg_temp.st(1, 'state') ->> 'chip')::boolean, true);
SELECT pg_temp.eq('A shown_count', (SELECT shown_count FROM private.aka_staff_email_prompt WHERE staff_id = 1), 3);
-- Tắt form -> hôm nay không hiện, hôm sau hiện lại.
SELECT pg_temp.eq('A tắt', (pg_temp.st(1, 'dismiss') ->> 'dismissed')::boolean, true);
SELECT pg_temp.eq('A hôm nay không hiện', pg_temp.st(1, 'state') ->> 'reason', 'dismissed');
SELECT pg_temp.eq('A vẫn có nhãn', (pg_temp.st(1, 'state') ->> 'chip')::boolean, true);
UPDATE private.aka_staff_email_prompt SET last_dismissed_at = now() - interval '1 day' WHERE staff_id = 1;
SELECT pg_temp.eq('A hôm sau hiện lại', pg_temp.st(1, 'state') ->> 'show', 'enter');

-- Kiểm email.
SELECT pg_temp.eq('client sai', pg_temp.st(1, 'save', '{"email":"a@x.vn"}') ->> 'code', 'invalid_client');
SELECT pg_temp.eq('email sai định dạng', pg_temp.st(1, 'save', '{"email":"abc","client":"web"}') ->> 'code', 'email_invalid');
SELECT pg_temp.eq('tên miền mẫu', pg_temp.st(1, 'save', '{"email":"abc@example.com","client":"web"}') ->> 'code', 'email_invalid');
SELECT pg_temp.eq('gõ nhầm tên miền', pg_temp.st(1, 'save', '{"email":"An@Gmial.com","client":"web"}') ->> 'suggestion', 'an@gmail.com');
-- Giữ nguyên tên miền gõ nhầm: lưu được, coi là có email.
SELECT pg_temp.eq('giữ nguyên tên miền', (pg_temp.st(1, 'save', '{"email":"an@gmial.com","client":"desktop","allowTypo":"true"}') ->> 'saved')::boolean, true);
SELECT pg_temp.eq('A đã có email (giữ nguyên)', pg_temp.st(1, 'state') ->> 'reason', 'has_email');
SELECT pg_temp.eq('admin ghi org_staff', (SELECT email FROM public.org_staff WHERE id = 1), 'an@gmial.com');
SELECT pg_temp.eq('admin ghi tổ chức', (SELECT email FROM public.org_organization WHERE id = 1), 'an@gmial.com');
SELECT pg_temp.eq('admin ghi CRM', (SELECT email FROM public.aka_customer WHERE id = 101), 'an@gmial.com');
-- Admin đổi email -> ghi đè cả 3, email cũ vào danh sách.
SELECT pg_temp.eq('A đổi email', pg_temp.st(1, 'save', '{"email":" An@Gmail.com ","client":"web"}') ->> 'email', 'an@gmail.com');
SELECT pg_temp.eq('danh sách org_staff', (SELECT email_list FROM public.org_staff WHERE id = 1), ARRAY['an@gmail.com', 'an@gmial.com']);
SELECT pg_temp.eq('danh sách tổ chức', (SELECT email_list FROM public.org_organization WHERE id = 1), ARRAY['an@gmail.com', 'an@gmial.com']);
SELECT pg_temp.eq('danh sách CRM', (SELECT email_list FROM public.aka_customer WHERE id = 101), ARRAY['an@gmail.com', 'an@gmial.com']);
SELECT pg_temp.eq('A saved_mode', (SELECT saved_mode || '/' || saved_client FROM private.aka_staff_email_prompt WHERE staff_id = 1), 'typed/web');

-- B: chỉ có email ở CRM -> không hỏi, tự chép vào chỗ trống.
SELECT pg_temp.eq('B không hỏi + chép', pg_temp.st(2, 'state'), '{"ok":true,"show":"none","reason":"has_email","synced":true,"enabled":true}'::jsonb);
SELECT pg_temp.eq('B org_staff được chép', (SELECT email FROM public.org_staff WHERE id = 2), 'crm.b@gmail.com');
SELECT pg_temp.eq('B tổ chức được chép', (SELECT email FROM public.org_organization WHERE id = 2), 'crm.b@gmail.com');
SELECT pg_temp.eq('B CRM giữ nguyên chữ hoa', (SELECT email FROM public.aka_customer WHERE id = 102), 'Crm.B@Gmail.com ');
SELECT pg_temp.eq('B synced', (SELECT synced_email FROM private.aka_staff_email_prompt WHERE staff_id = 2), 'crm.b@gmail.com');
SELECT pg_temp.eq('B không xếp thư xác nhận', (SELECT saved_at FROM private.aka_staff_email_prompt WHERE staff_id = 2), NULL::timestamptz);
SELECT pg_temp.eq('B lần sau không chép lại', pg_temp.st(2, 'state') ->> 'synced', 'false');

-- C: tổ chức có email; nhân viên không hỏi và không chép; admin được chép.
SELECT pg_temp.eq('nhân viên C không hỏi', pg_temp.st(4, 'state') ->> 'reason', 'has_email');
SELECT pg_temp.eq('nhân viên C không được chép', (SELECT email FROM public.org_staff WHERE id = 4), NULL::text);
SELECT pg_temp.eq('admin C được chép', (pg_temp.st(3, 'state') ->> 'synced')::boolean, true);
SELECT pg_temp.eq('admin C CRM được chép', (SELECT email FROM public.aka_customer WHERE id = 103), 'org.c@yahoo.com');

-- D: hết gói.
SELECT pg_temp.eq('D hết gói', pg_temp.st(5, 'state') ->> 'reason', 'no_package');

-- E: nhân viên không admin lưu email -> chỉ org_staff.
SELECT pg_temp.eq('nhân viên E thấy form', pg_temp.st(7, 'state') ->> 'show', 'enter');
SELECT pg_temp.eq('nhân viên E lưu', (pg_temp.st(7, 'save', '{"email":"staff.e@x.vn","client":"web"}') ->> 'isAdmin')::boolean, false);
SELECT pg_temp.eq('E tổ chức không đổi', (SELECT email FROM public.org_organization WHERE id = 5), NULL::text);
SELECT pg_temp.eq('E CRM không đổi', (SELECT email FROM public.aka_customer WHERE id = 105), '  ');
-- Admin E giờ cũng không bị hỏi? Không: email nhân viên E không thuộc 3 chỗ của admin E.
SELECT pg_temp.eq('admin E vẫn thấy form', pg_temp.st(6, 'state') ->> 'show', 'enter');

-- Xác nhận lại email đã có (confirm).
SELECT pg_temp.eq('confirm khi không có gì', pg_temp.st(6, 'save', '{"confirm":"true","client":"web"}') ->> 'code', 'nothing_to_confirm');
SELECT pg_temp.eq('confirm B', pg_temp.st(2, 'save', '{"confirm":"true","client":"desktop"}') ->> 'email', 'crm.b@gmail.com');
SELECT pg_temp.eq('confirm B: CRM cùng email thì không ghi lại', (SELECT email FROM public.aka_customer WHERE id = 102), 'Crm.B@Gmail.com ');

-- Giới hạn 5 lần lưu / giờ.
SELECT pg_temp.st(7, 'save', '{"email":"e2@x.vn","client":"web"}');
SELECT pg_temp.st(7, 'save', '{"email":"e3@x.vn","client":"web"}');
SELECT pg_temp.st(7, 'save', '{"email":"e4@x.vn","client":"web"}');
SELECT pg_temp.st(7, 'save', '{"email":"e5@x.vn","client":"web"}');
SELECT pg_temp.eq('lần thứ 6 bị chặn', pg_temp.st(7, 'save', '{"email":"e6@x.vn","client":"web"}') ->> 'code', 'rate_limited');
SELECT pg_temp.eq('danh sách E', (SELECT email_list FROM public.org_staff WHERE id = 7), ARRAY['e5@x.vn','e4@x.vn','e3@x.vn','e2@x.vn','staff.e@x.vn']);

-- Bộ gửi thư.
CREATE TEMP TABLE claim1 AS SELECT public.aka_agent_email_prompt_worker('claim', '{"limit":10}') AS r;
SELECT pg_temp.eq('claim có A, B, E', (SELECT jsonb_agg(i ->> 'staffId' ORDER BY (i ->> 'staffId')::int) FROM claim1, jsonb_array_elements(r -> 'items') i), '["1","2","7"]'::jsonb);
SELECT pg_temp.eq('claim A: 1 gói còn hạn', (SELECT jsonb_array_length(i -> 'products') FROM claim1, jsonb_array_elements(r -> 'items') i WHERE i ->> 'staffId' = '1'), 1);
SELECT pg_temp.eq('claim A: tên tổ chức', (SELECT i ->> 'organizationName' FROM claim1, jsonb_array_elements(r -> 'items') i WHERE i ->> 'staffId' = '1'), 'Org A');
SELECT pg_temp.eq('claim lại ngay: rỗng', public.aka_agent_email_prompt_worker('claim', '{}') -> 'items', '[]'::jsonb);
SELECT pg_temp.eq('sent sai email', public.aka_agent_email_prompt_worker('sent', '{"staffId":"1","email":"x@x.vn"}') ->> 'code', 'email_changed');
SELECT pg_temp.eq('sent A', (public.aka_agent_email_prompt_worker('sent', '{"staffId":"1","email":"an@gmail.com"}') ->> 'ok')::boolean, true);
SELECT pg_temp.eq('failed E (không thử lại)', (public.aka_agent_email_prompt_worker('failed', '{"staffId":"7","email":"e5@x.vn","error":"550","retryable":false}') ->> 'ok')::boolean, true);
SELECT pg_temp.eq('E hết lượt', (SELECT verify_attempts FROM private.aka_staff_email_prompt WHERE staff_id = 7), 5);
SELECT pg_temp.eq('verify A', (public.aka_agent_email_prompt_worker('verify', '{"staffId":"1","email":"an@gmail.com"}') ->> 'verified')::boolean, true);
SELECT pg_temp.eq('profile A đã xác nhận', (pg_temp.st(1, 'profile') ->> 'verified')::boolean, true);
SELECT pg_temp.eq('lưu lại đúng email giữ xác nhận', (pg_temp.st(1, 'save', '{"email":"an@gmail.com","client":"web"}') ->> 'verified')::boolean, true);
SELECT pg_temp.eq('lưu email khác thì chưa xác nhận', (pg_temp.st(1, 'save', '{"email":"an2@gmail.com","client":"web"}') ->> 'verified')::boolean, false);
SELECT pg_temp.eq('link cũ hết hiệu lực', public.aka_agent_email_prompt_worker('verify', '{"staffId":"1","email":"an@gmail.com"}') ->> 'code', 'email_changed');

-- "Không phải tôi": admin A -> trả lại email trước ở cả 3 chỗ.
SELECT pg_temp.eq('unlink A', (public.aka_agent_email_prompt_worker('unlink', '{"staffId":"1","email":"an2@gmail.com"}') ->> 'unlinked')::boolean, true);
SELECT pg_temp.eq('A org_staff về email trước', (SELECT email FROM public.org_staff WHERE id = 1), 'an@gmail.com');
SELECT pg_temp.eq('A tổ chức về email trước', (SELECT email FROM public.org_organization WHERE id = 1), 'an@gmail.com');
SELECT pg_temp.eq('A CRM về email trước', (SELECT email FROM public.aka_customer WHERE id = 101), 'an@gmail.com');
SELECT pg_temp.eq('A email bị gỡ vẫn trong danh sách', (SELECT 'an2@gmail.com' = ANY(email_list) FROM public.org_staff WHERE id = 1), true);
-- Nhân viên chỉ có một email: gỡ thì về trống và form hiện lại.
UPDATE public.org_staff SET email = 'solo@x.vn' WHERE id = 4;
UPDATE private.aka_staff_email_prompt SET saved_email = 'solo@x.vn', saved_at = now() WHERE staff_id = 4;
INSERT INTO private.aka_staff_email_prompt(staff_id, organization_id, saved_email, saved_at) SELECT 4, 3, 'solo@x.vn', now() WHERE NOT EXISTS (SELECT 1 FROM private.aka_staff_email_prompt WHERE staff_id = 4);
SELECT pg_temp.eq('unlink nhân viên', (public.aka_agent_email_prompt_worker('unlink', '{"staffId":"4","email":"solo@x.vn"}') ->> 'unlinked')::boolean, true);
SELECT pg_temp.eq('nhân viên về trống', (SELECT email FROM public.org_staff WHERE id = 4), NULL::text);
SELECT pg_temp.eq('tổ chức C không bị đụng', (SELECT email FROM public.org_organization WHERE id = 3), 'org.c@yahoo.com');

-- Desktop: nhân viên lấy từ phiên.
SET test.staff = '6';
SELECT pg_temp.eq('desktop state theo phiên', public.aka_agent_email_prompt('state') ->> 'username', 'adminE');
RESET test.staff;
SELECT pg_temp.eq('desktop không phiên', public.aka_agent_email_prompt('state') ->> 'code', 'no_session');
SELECT pg_temp.eq('control lệch tổ chức', public.aka_agent_control_email_prompt(1, 2, 'state', '{}') ->> 'code', 'staff_inactive');
SELECT pg_temp.eq('lệnh lạ', pg_temp.st(1, 'xyz') ->> 'code', 'invalid_action');

-- Quyền.
SELECT pg_temp.eq('desktop gọi được hàm Desktop', has_function_privilege('aka_agent_desktop', 'public.aka_agent_email_prompt(text, jsonb)', 'EXECUTE'), true);
SELECT pg_temp.eq('desktop không gọi được worker', has_function_privilege('aka_agent_desktop', 'public.aka_agent_email_prompt_worker(text, jsonb)', 'EXECUTE'), false);
SELECT pg_temp.eq('anon không gọi được', has_function_privilege('anon', 'public.aka_agent_control_email_prompt(bigint, bigint, text, jsonb)', 'EXECUTE'), false);
SELECT pg_temp.eq('desktop không đọc bảng', has_table_privilege('aka_agent_desktop', 'private.aka_staff_email_prompt', 'SELECT'), false);
SET ROLE aka_agent_desktop;
SET test.staff = '6';
SELECT pg_temp.eq('gọi bằng role desktop', public.aka_agent_email_prompt('state') ->> 'show', 'enter');
RESET ROLE;
RESET test.staff;
