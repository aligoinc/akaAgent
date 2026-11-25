-- V652 p3: điền sẵn email_list cho dữ liệu cũ (chỉ dữ liệu). Chạy sau p1, p2; buổi tối.
--
-- Đo 25/11/2026: org_staff 137 dòng có email, org_organization 332, aka_customer 1.284 dòng nối với tổ chức
-- (org_organization.customer_id). 19.684 khách CRM khác (chưa dùng phần mềm) không điền sẵn: danh sách của họ bắt
-- đầu từ lần đổi email đầu tiên (trigger p1).
-- Chỉ ghi cột email_list, không ghi cột email, nên trigger trg_email_list_track không chạy. Các trigger BEFORE UPDATE
-- khác vẫn chạy: aka_customer đổi updated_at / tính lại pipeline_stage như khi sale sửa khách; org_organization chạy
-- trg_sync_organization_orders (không ghi đơn nào vì email_list không thuộc bản chiếu đơn hàng).
-- Chạy lại được (chỉ điền dòng có email mà danh sách còn trống).

BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '110s';

DO $pre$
BEGIN
  IF to_regclass('private.aka_staff_email_prompt') IS NULL THEN
    RAISE EXCEPTION 'V652 p3: chạy p1, p2 trước';
  END IF;
END $pre$;

DO $fill$
DECLARE n_staff int; n_org int; n_cust int;
BEGIN
  UPDATE public.org_staff s SET email_list = ARRAY[lower(btrim(s.email))]
   WHERE nullif(btrim(coalesce(s.email, '')), '') IS NOT NULL AND s.email_list = '{}'::text[];
  GET DIAGNOSTICS n_staff = ROW_COUNT;

  UPDATE public.org_organization o SET email_list = ARRAY[lower(btrim(o.email))]
   WHERE nullif(btrim(coalesce(o.email, '')), '') IS NOT NULL AND o.email_list = '{}'::text[];
  GET DIAGNOSTICS n_org = ROW_COUNT;

  UPDATE public.aka_customer c SET email_list = ARRAY[lower(btrim(c.email))]
   WHERE nullif(btrim(coalesce(c.email, '')), '') IS NOT NULL AND c.email_list = '{}'::text[]
     AND c.id IN (SELECT o.customer_id FROM public.org_organization o WHERE o.customer_id IS NOT NULL);
  GET DIAGNOSTICS n_cust = ROW_COUNT;

  RAISE NOTICE 'V652 p3: org_staff %, org_organization %, aka_customer %', n_staff, n_org, n_cust;
END $fill$;

COMMIT;
