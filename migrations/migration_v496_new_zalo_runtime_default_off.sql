-- V496: thôi ép bật cờ org_organization.use_new_zalo_runtime cho tổ chức mới (11/11/2026, đổi quyết định 06/11).
-- V371 đặt mặc định cột = true và trigger trg_use_new_zalo_runtime_on_insert ép true mọi lần INSERT. Sau V496:
-- tắt trigger (giữ định nghĩa để bật lại được) và mặc định = false, nên tổ chức mới chạy bộ cũ như tổ chức cũ;
-- bật bộ mới (engine v2 trên Fly) cho từng tổ chức bằng tay.
-- Không sửa dòng tổ chức nào (đặt lại các tổ chức đang true là bước dữ liệu riêng, làm trước khi deploy code đọc cờ).
-- Không code nào đọc cờ tại thời điểm viết (11/11): apply không đổi hành vi code đang chạy.
-- Lệnh sửa schema làm PostgREST nạp lại schema và cần khoá ACCESS EXCLUSIVE ngắn trên org_organization: apply ngoài giờ
-- cao điểm. Gỡ: rollback_v496_new_zalo_runtime_default_off.sql.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

-- ALTER COLUMN ... SET DEFAULT cần khoá này: lấy trước, chờ tối đa 2 giây rồi bỏ cuộc thay vì xếp hàng chặn lệnh đọc.
LOCK TABLE public.org_organization IN ACCESS EXCLUSIVE MODE;

CREATE TEMP TABLE v496_before ON COMMIT DROP AS
SELECT count(*) FILTER (WHERE use_new_zalo_runtime) AS flag_true,
       count(*) FILTER (WHERE NOT use_new_zalo_runtime) AS flag_false
  FROM public.org_organization;

DO $pre$
DECLARE
  v_enabled "char";
  v_func text;
  v_default text;
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v496_%') THEN
      RAISE EXCEPTION 'V496 đã có trong sổ migration, không chạy lại';
    END IF;
  END IF;
  SELECT t.tgenabled, t.tgfoid::regprocedure::text INTO v_enabled, v_func
    FROM pg_trigger t
   WHERE t.tgrelid = 'public.org_organization'::regclass AND t.tgname = 'trg_use_new_zalo_runtime_on_insert' AND NOT t.tgisinternal;
  IF NOT FOUND THEN RAISE EXCEPTION 'V496: không thấy trigger trg_use_new_zalo_runtime_on_insert (V371)'; END IF;
  IF v_func IS DISTINCT FROM 'private.aka_agent_org_default_new_zalo_runtime()' THEN
    RAISE EXCEPTION 'V496: trigger gọi hàm khác V371: %', v_func;
  END IF;
  IF v_enabled IS DISTINCT FROM 'O' THEN RAISE EXCEPTION 'V496: trigger không ở trạng thái bật như V371 (tgenabled=%)', v_enabled; END IF;
  SELECT pg_get_expr(d.adbin, d.adrelid) INTO v_default
    FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
   WHERE a.attrelid = 'public.org_organization'::regclass AND a.attname = 'use_new_zalo_runtime' AND NOT a.attisdropped;
  IF NOT FOUND THEN RAISE EXCEPTION 'V496: thiếu cột use_new_zalo_runtime (V371)'; END IF;
  IF v_default IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'V496: mặc định của cột không phải true như V371 (%)', v_default; END IF;
END $pre$;

ALTER TABLE public.org_organization DISABLE TRIGGER trg_use_new_zalo_runtime_on_insert;
ALTER TABLE public.org_organization ALTER COLUMN use_new_zalo_runtime SET DEFAULT false;
COMMENT ON COLUMN public.org_organization.use_new_zalo_runtime IS
  'Cờ chọn engine chiến dịch v2 cho tài khoản Zalo Server trên Fly (V371). Từ V496 (11/11/2026) tổ chức mới mặc định false, không còn ép bật; bật cho từng tổ chức bằng tay. Gỡ cột sau khi chuyển hết.';

DO $post$
DECLARE
  v_enabled "char";
  v_default text;
  b record;
  a record;
BEGIN
  SELECT t.tgenabled INTO v_enabled FROM pg_trigger t
   WHERE t.tgrelid = 'public.org_organization'::regclass AND t.tgname = 'trg_use_new_zalo_runtime_on_insert';
  IF v_enabled IS DISTINCT FROM 'D' THEN RAISE EXCEPTION 'V496 postflight: trigger chưa tắt (%)', v_enabled; END IF;
  SELECT pg_get_expr(d.adbin, d.adrelid) INTO v_default
    FROM pg_attribute att JOIN pg_attrdef d ON d.adrelid = att.attrelid AND d.adnum = att.attnum
   WHERE att.attrelid = 'public.org_organization'::regclass AND att.attname = 'use_new_zalo_runtime';
  IF v_default IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'V496 postflight: mặc định chưa là false (%)', v_default; END IF;
  SELECT * INTO b FROM v496_before;
  SELECT count(*) FILTER (WHERE use_new_zalo_runtime) AS flag_true, count(*) FILTER (WHERE NOT use_new_zalo_runtime) AS flag_false
    INTO a FROM public.org_organization;
  IF a.flag_true <> b.flag_true OR a.flag_false <> b.flag_false THEN
    RAISE EXCEPTION 'V496 postflight: số tổ chức bật/tắt cờ bị đổi (% / % → % / %)', b.flag_true, b.flag_false, a.flag_true, a.flag_false;
  END IF;
END $post$;

COMMIT;
