-- Move akaBiz setup UI access from organization-level to staff-level.
ALTER TABLE public.org_staff
  ADD COLUMN IF NOT EXISTS is_admin_akabiz boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.org_staff.is_admin_akabiz IS
  'Nếu true: staff được hiện UI Cài đặt Workflow và Quản lý Hành động chiến dịch akaBiz.';

COMMENT ON COLUMN public.org_organization.is_admin_akabiz IS
  'Nếu true: organization này là akaBiz admin tenant dùng cho workflow/block/element built-in; quyền hiển thị UI admin nằm ở org_staff.is_admin_akabiz.';

UPDATE public.org_staff AS staff
SET
  is_admin_akabiz = true,
  updated_at = now()
FROM public.org_organization AS org
WHERE org.staff_admin_id = staff.id
  AND org.is_admin_akabiz = true
  AND staff.is_admin_akabiz IS DISTINCT FROM true;
