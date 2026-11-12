-- Gỡ V509 (quản lý proxy theo tổ chức trên Web). Xoá hạn dùng, ghi chú và kết quả kiểm tra đã lưu; không đụng proxy,
-- tài khoản hay cờ khác. Từ chối khi còn tài khoản dùng proxy do nhân viên khác thêm: sau khi gỡ, Desktop/App Server
-- lại đọc proxy theo nhân viên và tài khoản đó sẽ chạy không proxy — chuyển hoặc gỡ proxy cho các tài khoản đó trước.
-- API/Web đã deploy vẫn chạy sau khi gỡ: thiếu cột/hàm thì trang Proxy tự ẩn (coi như cờ tắt).
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $preflight$
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'Rollback V509 phải chạy bằng postgres';
  END IF;
  IF to_regclass('public.auto_proxy_checks') IS NULL THEN
    RAISE EXCEPTION 'V509 chưa apply, không có gì để gỡ';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_accounts AS account JOIN public.auto_proxies AS proxy ON proxy.id = account.proxy_id
             WHERE NOT COALESCE(account.is_delete, false) AND proxy.staff_id IS DISTINCT FROM account.staff_id) THEN
    RAISE EXCEPTION 'Còn tài khoản dùng proxy do nhân viên khác thêm; chuyển hoặc gỡ proxy cho các tài khoản đó trước';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_proxies WHERE NOT is_delete GROUP BY staff_id, lower(name) HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Có tên proxy trùng trong một nhân viên, không dựng lại được index cũ';
  END IF;
END;
$preflight$;

DROP TRIGGER trg_account_proxy_scope_guard ON public.auto_accounts;
DROP FUNCTION public.aka_agent_control_proxies(bigint, bigint, text, jsonb);
DROP FUNCTION public.aka_agent_proxy_check_worker(text, jsonb);
DROP FUNCTION private.aka_agent_guard_account_proxy_scope();
DROP FUNCTION private.aka_agent_proxy_insert(bigint, bigint, jsonb);
DROP FUNCTION private.aka_agent_proxy_list_json(bigint, bigint, boolean, bigint[]);
DROP FUNCTION private.aka_agent_proxy_shared_runtime_ready(bigint, boolean);
DROP FUNCTION private.aka_agent_proxy_check_field(text, jsonb);
DROP FUNCTION private.aka_agent_proxy_id_list(jsonb, integer);
DROP FUNCTION private.aka_agent_proxy_positive_id(jsonb);
DROP FUNCTION private.aka_agent_proxy_parse_date(jsonb, text);
DROP FUNCTION private.aka_agent_proxy_next_daily(bigint, timestamptz);
DROP FUNCTION private.aka_agent_proxy_check_mode();
DROP FUNCTION private.aka_agent_proxy_endpoint_hash(text, text, integer, text, text);
DROP TABLE public.auto_proxy_checks;

DROP POLICY desktop_org_read ON public.auto_proxies;
DROP POLICY desktop_owned_insert ON public.auto_proxies;
DROP POLICY desktop_owned_update ON public.auto_proxies;
DROP POLICY desktop_owned_delete ON public.auto_proxies;
CREATE POLICY desktop_owned_resource ON public.auto_proxies AS RESTRICTIVE FOR ALL TO aka_agent_desktop
  USING (staff_id = (SELECT private.aka_agent_staff_scope_for_request()))
  WITH CHECK (staff_id = (SELECT private.aka_agent_staff_scope_for_request()));

DROP INDEX public.idx_auto_proxies_org;
DROP INDEX public.auto_proxies_org_name_unique;
CREATE UNIQUE INDEX auto_proxies_staff_name_unique ON public.auto_proxies USING btree (staff_id, lower(name)) WHERE (is_delete = false);

ALTER TABLE public.auto_proxies DROP CONSTRAINT auto_proxies_note_length, DROP COLUMN note, DROP COLUMN expires_on;
COMMENT ON COLUMN public.auto_proxies.staff_id IS NULL;
ALTER TABLE public.org_organization DROP COLUMN web_proxy_management_enabled;
DELETE FROM public.auto_system_settings WHERE key IN ('proxies.check_mode', 'proxies.shared_runtime');

DO $postflight$
BEGIN
  IF (SELECT pg_get_indexdef('public.auto_proxies_staff_name_unique'::regclass))
     IS DISTINCT FROM 'CREATE UNIQUE INDEX auto_proxies_staff_name_unique ON public.auto_proxies USING btree (staff_id, lower(name)) WHERE (is_delete = false)' THEN
    RAISE EXCEPTION 'Rollback V509: index cũ dựng lại sai';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'auto_proxies'
                 AND policyname = 'desktop_owned_resource'
                 AND qual = '(staff_id = ( SELECT private.aka_agent_staff_scope_for_request() AS aka_agent_staff_scope_for_request))') THEN
    RAISE EXCEPTION 'Rollback V509: policy cũ dựng lại sai';
  END IF;
END;
$postflight$;

COMMIT;
