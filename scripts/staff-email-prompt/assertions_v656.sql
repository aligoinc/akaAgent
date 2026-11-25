-- Kiểm V656 (chạy sau assertions.sql của V652 và V656). Mỗi khẳng định sai thì RAISE.
\set ON_ERROR_STOP 1
CREATE FUNCTION pg_temp.eq3(p_label text, p_got anyelement, p_want anyelement) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_got IS DISTINCT FROM p_want THEN RAISE EXCEPTION 'FAIL %: got %, want %', p_label, p_got, p_want; END IF;
  RAISE NOTICE 'PASS %', p_label;
END $$;
CREATE FUNCTION pg_temp.st3(p_staff bigint, p_action text, p_payload jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE sql AS
  $$ SELECT public.aka_agent_control_email_prompt(p_staff, (SELECT organization_id FROM public.org_staff WHERE id = p_staff), p_action, p_payload) $$;

INSERT INTO public.aka_customer(id, email) VALUES (301, NULL);
INSERT INTO public.org_organization(id, customer_id, name, email) VALUES (31, 301, 'Org V656', NULL);
INSERT INTO public.org_staff(id, organization_id, name, username, email, is_admin) VALUES (31, 31, 'Admin', 'a653', NULL, true);
INSERT INTO public.org_organization_product(organization_id, product_name, package_name, expiration_date, is_deleted, is_paid)
VALUES (31, 'akaAgent Zalo', 'Gói năm', now() + interval '30 days', false, true);

-- 1. audience orgs thiếu danh sách = tắt.
UPDATE public.auto_system_settings SET value = '{"audience":"orgs"}' WHERE key = 'account.email_prompt';
SELECT pg_temp.eq3('orgs thiếu organizationIds là tắt', pg_temp.st3(31, 'state') ->> 'reason', 'disabled');
UPDATE public.auto_system_settings SET value = '{"audience":"orgs","organizationIds":"31"}' WHERE key = 'account.email_prompt';
SELECT pg_temp.eq3('organizationIds không phải mảng là tắt', pg_temp.st3(31, 'state') ->> 'reason', 'disabled');
UPDATE public.auto_system_settings SET value = '{"audience":"all"}' WHERE key = 'account.email_prompt';

-- 2. limit sai kiểu.
SET ROLE service_role;
SELECT pg_temp.eq3('claim limit chữ', public.aka_agent_email_prompt_worker('claim', '{"limit":"x"}') ->> 'ok', 'true');
SELECT pg_temp.eq3('claim limit số thực', public.aka_agent_email_prompt_worker('claim', '{"limit":2.5}') ->> 'ok', 'true');
RESET ROLE;

-- 3. "Không phải tôi" trả đúng email trước lần lưu, kể cả khi trước đó trống mà danh sách còn email cũ.
UPDATE public.org_staff SET email = 'cu@gmail.com' WHERE id = 31;
UPDATE public.org_staff SET email = NULL WHERE id = 31;
UPDATE public.org_organization SET email = 'org.cu@gmail.com' WHERE id = 31;
SELECT pg_temp.eq3('lưu', pg_temp.st3(31, 'save', '{"client":"web","email":"moi@gmail.com"}') ->> 'saved', 'true');
SELECT pg_temp.eq3('lưu ghi prev', (SELECT ARRAY[coalesce(prev_staff_email,'-'), prev_org_email, coalesce(prev_crm_email,'-')] FROM private.aka_staff_email_prompt WHERE staff_id = 31),
  ARRAY['-', 'org.cu@gmail.com', '-']);
SET ROLE service_role;
SELECT pg_temp.eq3('gỡ', public.aka_agent_email_prompt_worker('unlink', '{"staffId":31,"email":"moi@gmail.com"}') ->> 'ok', 'true');
RESET ROLE;
SELECT pg_temp.eq3('gỡ: tài khoản về trống (trước lần lưu trống)', (SELECT email FROM public.org_staff WHERE id = 31), NULL::text);
SELECT pg_temp.eq3('gỡ: tổ chức về email trước', (SELECT email FROM public.org_organization WHERE id = 31), 'org.cu@gmail.com');
SELECT pg_temp.eq3('gỡ: CRM về trống', (SELECT email FROM public.aka_customer WHERE id = 301), NULL::text);
SELECT pg_temp.eq3('gỡ: xoá prev', (SELECT prev_org_email FROM private.aka_staff_email_prompt WHERE staff_id = 31), NULL::text);
-- Lưu lại đúng email đang có rồi gỡ: email đó bị gỡ (chủ hộp thư nói không phải của họ).
UPDATE public.org_staff SET email = 'co.san@gmail.com' WHERE id = 31;
SELECT pg_temp.eq3('lưu lại email đang có', pg_temp.st3(31, 'save', '{"client":"web","email":"Co.San@gmail.com"}') ->> 'saved', 'true');
SET ROLE service_role;
SELECT pg_temp.eq3('gỡ email đang có', public.aka_agent_email_prompt_worker('unlink', '{"staffId":31,"email":"co.san@gmail.com"}') ->> 'ok', 'true');
RESET ROLE;
SELECT pg_temp.eq3('gỡ email đang có: về trống', (SELECT email FROM public.org_staff WHERE id = 31), NULL::text);
