-- Gỡ V528: trả về đúng trạng thái V496 (trigger trg_use_new_zalo_runtime_on_insert tắt, mặc định false, ghi chú của V496),
-- nên tổ chức mới lại mặc định false. Không sửa dòng tổ chức nào; tổ chức tạo trong lúc V528 có hiệu lực giữ cờ đang có.
-- Lệnh sửa schema: apply ngoài giờ cao điểm. Không xoá dòng sổ migration.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';
LOCK TABLE public.org_organization IN ACCESS EXCLUSIVE MODE;

DO $pre$
DECLARE
  v_enabled "char";
  v_default text;
BEGIN
  SELECT t.tgenabled INTO v_enabled FROM pg_trigger t
   WHERE t.tgrelid = 'public.org_organization'::regclass AND t.tgname = 'trg_use_new_zalo_runtime_on_insert' AND NOT t.tgisinternal;
  IF NOT FOUND THEN RAISE EXCEPTION 'Rollback V528: không thấy trigger trg_use_new_zalo_runtime_on_insert'; END IF;
  IF v_enabled IS DISTINCT FROM 'O' THEN RAISE EXCEPTION 'Rollback V528: trigger không ở trạng thái bật của V528 (tgenabled=%)', v_enabled; END IF;
  SELECT pg_get_expr(d.adbin, d.adrelid) INTO v_default
    FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
   WHERE a.attrelid = 'public.org_organization'::regclass AND a.attname = 'use_new_zalo_runtime';
  IF v_default IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Rollback V528: mặc định của cột không phải true của V528 (%)', v_default; END IF;
END $pre$;

ALTER TABLE public.org_organization DISABLE TRIGGER trg_use_new_zalo_runtime_on_insert;
ALTER TABLE public.org_organization ALTER COLUMN use_new_zalo_runtime SET DEFAULT false;
COMMENT ON COLUMN public.org_organization.use_new_zalo_runtime IS
  'Cờ chọn engine chiến dịch v2 cho tài khoản Zalo Server trên Fly (V371). Từ V496 (11/11/2026) tổ chức mới mặc định false, không còn ép bật; bật cho từng tổ chức bằng tay. Gỡ cột sau khi chuyển hết.';

DO $post$
DECLARE
  v_enabled "char";
  v_default text;
BEGIN
  SELECT t.tgenabled INTO v_enabled FROM pg_trigger t
   WHERE t.tgrelid = 'public.org_organization'::regclass AND t.tgname = 'trg_use_new_zalo_runtime_on_insert';
  SELECT pg_get_expr(d.adbin, d.adrelid) INTO v_default
    FROM pg_attribute a JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
   WHERE a.attrelid = 'public.org_organization'::regclass AND a.attname = 'use_new_zalo_runtime';
  IF v_enabled IS DISTINCT FROM 'D' OR v_default IS DISTINCT FROM 'false' THEN
    RAISE EXCEPTION 'Rollback V528 postflight: trigger %, mặc định %', v_enabled, v_default;
  END IF;
END $post$;

COMMIT;
