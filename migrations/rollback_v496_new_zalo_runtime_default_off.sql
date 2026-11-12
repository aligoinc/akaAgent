-- Gỡ V496: bật lại ép bật cờ use_new_zalo_runtime cho tổ chức mới, đúng như V371 (trigger bật, mặc định true, ghi chú cũ).
-- Không sửa dòng tổ chức nào; tổ chức tạo trong thời gian V496 có hiệu lực giữ nguyên giá trị đang có.
-- Lệnh sửa schema: apply ngoài giờ cao điểm. Không xoá dòng trong sổ migration.
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
  IF NOT FOUND THEN RAISE EXCEPTION 'Rollback V496: không thấy trigger trg_use_new_zalo_runtime_on_insert'; END IF;
  IF v_enabled IS DISTINCT FROM 'D' THEN RAISE EXCEPTION 'Rollback V496: trigger không ở trạng thái tắt của V496 (tgenabled=%)', v_enabled; END IF;
  SELECT pg_get_expr(d.adbin, d.adrelid) INTO v_default
    FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
   WHERE a.attrelid = 'public.org_organization'::regclass AND a.attname = 'use_new_zalo_runtime';
  IF v_default IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'Rollback V496: mặc định của cột không phải false của V496 (%)', v_default; END IF;
END $pre$;

ALTER TABLE public.org_organization ENABLE TRIGGER trg_use_new_zalo_runtime_on_insert;
ALTER TABLE public.org_organization ALTER COLUMN use_new_zalo_runtime SET DEFAULT true;
COMMENT ON COLUMN public.org_organization.use_new_zalo_runtime IS
  'Temporary Zalo runtime rollout flag. Existing organizations start false; new INSERTs are forced true even for explicit false/null. UPDATE may change it. Metadata only until runtime routing consumes it; remove after full migration.';

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
  IF v_enabled IS DISTINCT FROM 'O' OR v_default IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'Rollback V496 postflight: trigger %, mặc định %', v_enabled, v_default;
  END IF;
END $post$;

COMMIT;
