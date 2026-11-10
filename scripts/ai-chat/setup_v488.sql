-- Bổ sung cho scripts/notification-center/setup.sql: các cột live mà V488 dùng (đọc trên akachat 10/11/2026).
\set ON_ERROR_STOP 1
ALTER TABLE public.org_organization ADD COLUMN customer_id bigint;
ALTER TABLE public.org_staff ADD COLUMN is_admin_akabiz boolean DEFAULT false;
UPDATE public.org_organization SET customer_id = 9001 WHERE id = 1;
UPDATE public.org_staff SET is_admin_akabiz = true WHERE id = 1;
INSERT INTO public.org_staff (id, organization_id, name, username, password, is_active) VALUES (4, 2, 'Org2 Lan', 'lan', 'pw4', true);
INSERT INTO public.auto_accounts (id, name, flatform_type, login_status, staff_id, organization_id) VALUES (300, 'FB Lan', 'facebook', 'đã đăng nhập', 4, 2);
INSERT INTO public.auto_campaigns (id, name, action_id, account_id, status, staff_id, organization_id) VALUES
  (40, 'Đăng nhóm Lan', 'facebook_group_post', 300, 'chờ xử lý', 4, 2);
INSERT INTO private.aka_agent_desktop_users VALUES ('44444444-4444-4444-8444-444444444444', 4);
