-- V528: tổ chức mới lại được bật sẵn cờ org_organization.use_new_zalo_runtime (14/11/2026).
-- Anh chốt 14/11 ~02:10 VN: "bật lại trigger khi có tổ chức mới sẽ bật luôn". Đảo V496 (11/11): bật lại trigger
-- trg_use_new_zalo_runtime_on_insert của V371 (hàm giữ nguyên, ép true mọi lần INSERT kể cả khi ghi false) và đặt lại
-- mặc định cột = true. Tổ chức mới chạy engine v2 ngay: tài khoản Zalo Server trên Fly (V497, khi có gói 16/18 có QR +
-- Server), Desktop từ bản 9.6.0 khi đăng nhập (V513).
-- Không sửa dòng tổ chức nào: tổ chức tạo trong lúc V496 có hiệu lực (11/11 16:10 VN – lúc apply V528) giữ giá trị đang
-- có; bật/tắt cờ một tổ chức vẫn bằng UPDATE (trigger chỉ chạy khi INSERT).
-- Lệnh sửa schema làm PostgREST nạp lại schema và cần khoá ACCESS EXCLUSIVE ngắn trên org_organization: apply ngoài giờ
-- cao điểm. Gỡ: rollback_v528_new_zalo_runtime_default_on.sql (trả về đúng trạng thái V496).
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

-- ALTER COLUMN ... SET DEFAULT cần khoá này: lấy trước, chờ tối đa 2 giây rồi bỏ cuộc thay vì xếp hàng chặn lệnh đọc.
LOCK TABLE public.org_organization IN ACCESS EXCLUSIVE MODE;

CREATE TEMP TABLE v528_before ON COMMIT DROP AS
SELECT count(*) FILTER (WHERE use_new_zalo_runtime) AS flag_true,
       count(*) FILTER (WHERE NOT use_new_zalo_runtime) AS flag_false
  FROM public.org_organization;

DO $pre$
DECLARE
  v_enabled "char";
  v_func regprocedure;
  v_func_md5 text;
  v_default text;
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v528_%') THEN
      RAISE EXCEPTION 'V528 đã có trong sổ migration, không chạy lại';
    END IF;
  END IF;
  SELECT t.tgenabled, t.tgfoid::regprocedure INTO v_enabled, v_func
    FROM pg_trigger t
   WHERE t.tgrelid = 'public.org_organization'::regclass AND t.tgname = 'trg_use_new_zalo_runtime_on_insert' AND NOT t.tgisinternal;
  IF NOT FOUND THEN RAISE EXCEPTION 'V528: không thấy trigger trg_use_new_zalo_runtime_on_insert (V371)'; END IF;
  IF v_func::text IS DISTINCT FROM 'private.aka_agent_org_default_new_zalo_runtime()' THEN
    RAISE EXCEPTION 'V528: trigger gọi hàm khác V371: %', v_func;
  END IF;
  IF v_enabled IS DISTINCT FROM 'D' THEN RAISE EXCEPTION 'V528: trigger không ở trạng thái tắt của V496 (tgenabled=%)', v_enabled; END IF;
  -- Thân hàm đọc trên production 14/11 02:10 VN, đúng bản V371 (ép true vô điều kiện).
  v_func_md5 := md5(pg_get_functiondef(v_func));
  IF v_func_md5 IS DISTINCT FROM 'df3a75b16492ded9c413ef4db332dd9b' THEN
    RAISE EXCEPTION 'V528: thân hàm của trigger khác bản V371 (md5 %)', v_func_md5;
  END IF;
  SELECT pg_get_expr(d.adbin, d.adrelid) INTO v_default
    FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
   WHERE a.attrelid = 'public.org_organization'::regclass AND a.attname = 'use_new_zalo_runtime' AND NOT a.attisdropped;
  IF NOT FOUND THEN RAISE EXCEPTION 'V528: thiếu cột use_new_zalo_runtime (V371)'; END IF;
  IF v_default IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'V528: mặc định của cột không phải false của V496 (%)', v_default; END IF;
END $pre$;

ALTER TABLE public.org_organization ENABLE TRIGGER trg_use_new_zalo_runtime_on_insert;
ALTER TABLE public.org_organization ALTER COLUMN use_new_zalo_runtime SET DEFAULT true;
COMMENT ON COLUMN public.org_organization.use_new_zalo_runtime IS
  'Cờ chọn engine chiến dịch v2 (V371): tài khoản Zalo Server chạy trên Fly (V497), Desktop chạy bộ mới khi đăng nhập (V513). Từ V528 (14/11/2026) tổ chức mới lại được bật sẵn: trigger trg_use_new_zalo_runtime_on_insert ép true mọi lần INSERT, kể cả khi ghi false. Bật/tắt từng tổ chức bằng UPDATE. Gỡ cột sau khi chuyển hết.';

DO $post$
DECLARE
  v_enabled "char";
  v_default text;
  b record;
  a record;
BEGIN
  SELECT t.tgenabled INTO v_enabled FROM pg_trigger t
   WHERE t.tgrelid = 'public.org_organization'::regclass AND t.tgname = 'trg_use_new_zalo_runtime_on_insert';
  IF v_enabled IS DISTINCT FROM 'O' THEN RAISE EXCEPTION 'V528 postflight: trigger chưa bật (%)', v_enabled; END IF;
  SELECT pg_get_expr(d.adbin, d.adrelid) INTO v_default
    FROM pg_attribute att JOIN pg_attrdef d ON d.adrelid = att.attrelid AND d.adnum = att.attnum
   WHERE att.attrelid = 'public.org_organization'::regclass AND att.attname = 'use_new_zalo_runtime';
  IF v_default IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'V528 postflight: mặc định chưa là true (%)', v_default; END IF;
  SELECT * INTO b FROM v528_before;
  SELECT count(*) FILTER (WHERE use_new_zalo_runtime) AS flag_true, count(*) FILTER (WHERE NOT use_new_zalo_runtime) AS flag_false
    INTO a FROM public.org_organization;
  IF a.flag_true <> b.flag_true OR a.flag_false <> b.flag_false THEN
    RAISE EXCEPTION 'V528 postflight: số tổ chức bật/tắt cờ bị đổi (% / % → % / %)', b.flag_true, b.flag_false, a.flag_true, a.flag_false;
  END IF;
END $post$;

COMMIT;
