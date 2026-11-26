-- Thêm cho bộ kiểm ngẫu nhiên V660 (fuzz-loop.cjs), chạy sau v660-fixture.sql và trước migration.
-- Chép đúng điều kiện của các trigger production có thể chặn lệnh ghi của V660 (đọc 26/11/2026, md5 thân hàm ghi kèm):
--   * private.app_access_guard_campaign_claim (c459ce78…): đổi trạng thái sang "chờ xử lý" từ trạng thái khác "đang chạy" mà
--     nhân viên / tài khoản hết quyền thì RAISE app_access_denied. Ở đây "hết quyền" = có trong bảng fuzz_denied.
--   * private.aka_agent_guard_parent_ownership (079b0791…): lời gọi theo phiên Desktop sửa chiến dịch của nhân viên khác thì
--     RAISE desktop_parent_owner_denied. Ở đây phiên Desktop = GUC test.staff khác rỗng.
--   * aka_agent_set_campaign_completed_at (2f54957a…).
CREATE TABLE public.fuzz_denied (kind text, id bigint, PRIMARY KEY (kind, id));

CREATE FUNCTION public.fuzz_app_access_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND ((NEW.status = 'đang chạy' OR (NEW.status = 'chờ xử lý' AND OLD.status <> 'đang chạy'))
       AND NEW.status IS DISTINCT FROM OLD.status) THEN
    IF EXISTS (SELECT 1 FROM public.fuzz_denied WHERE (kind = 'staff' AND id = NEW.staff_id) OR (kind = 'account' AND id = NEW.account_id)) THEN
      RAISE EXCEPTION 'app_access_denied' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER app_access_guard_campaign_claim BEFORE UPDATE OF status, account_id ON public.auto_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.fuzz_app_access_guard();

CREATE FUNCTION public.fuzz_parent_ownership() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_staff bigint := NULLIF(current_setting('test.staff', true), '')::bigint;
BEGIN
  IF v_staff IS NULL THEN RETURN NEW; END IF;
  IF OLD.staff_id IS DISTINCT FROM v_staff OR NEW.staff_id IS DISTINCT FROM v_staff THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'desktop_parent_owner_denied';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER aaa_desktop_parent_ownership BEFORE UPDATE ON public.auto_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.fuzz_parent_ownership();

CREATE FUNCTION public.fuzz_completed_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'hoàn thành' AND OLD.status IS DISTINCT FROM NEW.status THEN NEW.completed_at = now(); END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_aka_agent_set_campaign_completed_at BEFORE UPDATE OF status ON public.auto_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.fuzz_completed_at();
