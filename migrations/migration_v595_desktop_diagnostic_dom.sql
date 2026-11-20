-- V595: DOM cả trang gửi kèm ảnh lỗi engine Facebook (anh chốt 20/11/2026: "đơn giản như phần chụp ảnh": block lỗi chụp ảnh thì lưu thêm DOM
-- của trang đó; khi tìm nguyên nhân lỗi thì lấy cả DOM lẫn ảnh). Phương án: docs/FB_ENGINE_ERROR_EVIDENCE_PLAN.md.
-- Chỉ thêm đối tượng mới, không đổi bảng / hàm của V556 hay hàm tick V593 (số "ảnh đã về" và trần dung lượng ảnh của V593 giữ nguyên):
--   * bảng public.auto_desktop_diagnostic_doms: DOM máy khách gửi kèm ảnh theo yêu cầu chẩn đoán, nén gzip (≤ 2 MB) như ảnh JPEG của V556
--     (đo 20/11: gửi request lớn lên Supabase rất chậm, 0,5 MB mất 7–16 giây, 1,5 MB có lần quá 90 giây; DOM đã nén 50–80 KB gửi 1–2,5 giây);
--     người đọc tải về rồi giải nén; xoá cùng yêu cầu (khoá ngoại ON DELETE CASCADE, job dọn của V556 xoá yêu cầu sau 7 ngày);
--   * public.aka_agent_desktop_diagnostic_dom_upload_v1: Desktop ghi một DOM vào yêu cầu đang mở của chính nhân viên (như upload_v1 của ảnh);
--   * public.aka_agent_desktop_diagnostic_doms_v1: chỉ đọc, service_role, trả DOM (gzip, base64) của một yêu cầu.
-- Desktop gửi DOM sau khi phát hành bản có code này; DB chưa có V595 thì Desktop chỉ gửi ảnh như cũ. CREATE TABLE / FUNCTION làm PostgREST nạp
-- lại schema: apply ngoài giờ cao điểm. Gỡ: rollback_v595_desktop_diagnostic_dom.sql.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v595_%') THEN
      RAISE EXCEPTION 'V595: sổ migration đã có V595, không apply lại';
    END IF;
  END IF;
  IF to_regclass('public.auto_desktop_diagnostic_requests') IS NULL OR to_regclass('public.auto_desktop_diagnostic_files') IS NULL THEN
    RAISE EXCEPTION 'V595: thiếu bảng yêu cầu chẩn đoán của V556';
  END IF;
  IF to_regclass('public.auto_desktop_diagnostic_doms') IS NOT NULL THEN
    RAISE EXCEPTION 'V595: bảng auto_desktop_diagnostic_doms đã có';
  END IF;
  IF to_regprocedure('public.aka_agent_engine_desktop_staff()') IS NULL THEN
    RAISE EXCEPTION 'V595: thiếu hàm aka_agent_engine_desktop_staff() (V556)';
  END IF;
  IF to_regprocedure('public.aka_agent_desktop_diagnostic_dom_upload_v1(bigint, uuid, jsonb, text)') IS NOT NULL
     OR to_regprocedure('public.aka_agent_desktop_diagnostic_doms_v1(bigint)') IS NOT NULL THEN
    RAISE EXCEPTION 'V595: hàm DOM đã có';
  END IF;
END $pre$;

CREATE TABLE public.auto_desktop_diagnostic_doms (
  request_id bigint NOT NULL REFERENCES public.auto_desktop_diagnostic_requests(id) ON DELETE CASCADE,
  image_id uuid NOT NULL,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(meta) = 'object' AND octet_length(meta::text) <= 16384),
  content bytea NOT NULL CHECK (octet_length(content) BETWEEN 18 AND 2097152),
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (request_id, image_id)
);
COMMENT ON TABLE public.auto_desktop_diagnostic_doms IS
  'V595: DOM cả trang lúc block Facebook lỗi (đã bỏ script, style, giá trị ô ẩn), nén gzip, máy khách gửi kèm ảnh cùng mã (image_id) theo yêu cầu chẩn đoán. Xoá cùng yêu cầu sau 7 ngày.';

-- Quyền như các bảng chẩn đoán V556: chỉ RPC (SECURITY DEFINER) và service_role.
DO $grants_table$
DECLARE r text;
BEGIN
  ALTER TABLE public.auto_desktop_diagnostic_doms ENABLE ROW LEVEL SECURITY;
  REVOKE ALL ON TABLE public.auto_desktop_diagnostic_doms FROM PUBLIC;
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'aka_agent_desktop', 'aka_agent_chat_api'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN EXECUTE format('REVOKE ALL ON TABLE public.auto_desktop_diagnostic_doms FROM %I', r); END IF;
  END LOOP;
  GRANT ALL ON TABLE public.auto_desktop_diagnostic_doms TO service_role;
END $grants_table$;
CREATE POLICY auto_desktop_diagnostic_doms_service_v595 ON public.auto_desktop_diagnostic_doms FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE FUNCTION public.aka_agent_desktop_diagnostic_dom_upload_v1(p_request_id bigint, p_image_id uuid, p_meta jsonb, p_gzip_base64 text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
SET lock_timeout TO '3s'
SET statement_timeout TO '30s'
AS $function$
DECLARE
  v_staff bigint := public.aka_agent_engine_desktop_staff();
  v_now timestamptz := clock_timestamp();
  q public.auto_desktop_diagnostic_requests%ROWTYPE;
  v_bytes bytea;
  v_count integer;
BEGIN
  IF v_staff IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'no_session'); END IF;
  IF p_request_id IS NULL OR p_image_id IS NULL OR p_gzip_base64 IS NULL OR length(p_gzip_base64) > 2800000
     OR p_gzip_base64 !~ '^[A-Za-z0-9+/=\s]+$'
     OR (p_meta IS NOT NULL AND (jsonb_typeof(p_meta) <> 'object' OR octet_length(p_meta::text) > 16384)) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_request');
  END IF;
  SELECT * INTO q FROM public.auto_desktop_diagnostic_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND OR q.staff_id IS DISTINCT FROM v_staff THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  IF q.status NOT IN ('pending', 'uploading') OR q.expires_at <= v_now THEN RETURN jsonb_build_object('ok', false, 'reason', 'closed'); END IF;
  v_bytes := decode(regexp_replace(p_gzip_base64, '\s', '', 'g'), 'base64');
  IF octet_length(v_bytes) < 18 OR octet_length(v_bytes) > 2097152 OR substring(v_bytes FROM 1 FOR 2) <> '\x1f8b'::bytea THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_dom');
  END IF;
  SELECT count(*) INTO v_count FROM public.auto_desktop_diagnostic_doms d WHERE d.request_id = q.id;
  IF v_count >= 50 THEN RETURN jsonb_build_object('ok', false, 'reason', 'too_many_files'); END IF;
  INSERT INTO public.auto_desktop_diagnostic_doms (request_id, image_id, meta, content, sha256, created_at)
  VALUES (q.id, p_image_id, coalesce(p_meta, '{}'::jsonb), v_bytes, encode(sha256(v_bytes), 'hex'), v_now)
  ON CONFLICT (request_id, image_id) DO NOTHING;
  RETURN jsonb_build_object('ok', true, 'bytes', octet_length(v_bytes));
END $function$;
COMMENT ON FUNCTION public.aka_agent_desktop_diagnostic_dom_upload_v1(bigint, uuid, jsonb, text) IS
  'V595: Desktop ghi DOM cả trang (gzip ≤ 2 MB, tối đa 50 DOM mỗi yêu cầu) kèm ảnh cùng mã vào yêu cầu chẩn đoán đang mở của chính nhân viên.';

CREATE FUNCTION public.aka_agent_desktop_diagnostic_doms_v1(p_request_id bigint)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT jsonb_build_object('requestId', p_request_id,
    'doms', coalesce((SELECT jsonb_agg(jsonb_build_object('imageId', d.image_id, 'meta', d.meta, 'sha256', d.sha256, 'bytes', octet_length(d.content),
                        'gzipBase64', encode(d.content, 'base64'), 'createdAt', d.created_at) ORDER BY d.created_at)
                        FROM public.auto_desktop_diagnostic_doms d WHERE d.request_id = p_request_id), '[]'::jsonb))
$function$;
COMMENT ON FUNCTION public.aka_agent_desktop_diagnostic_doms_v1(bigint) IS
  'V595: chỉ đọc; DOM cả trang máy khách đã gửi cho một yêu cầu chẩn đoán (service_role), dạng gzip mã base64: lưu ra tệp rồi giải nén.';

DO $grants_functions$
DECLARE r text; f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.aka_agent_desktop_diagnostic_dom_upload_v1(bigint, uuid, jsonb, text)',
    'public.aka_agent_desktop_diagnostic_doms_v1(bigint)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role', 'aka_agent_desktop', 'aka_agent_chat_api'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', f, r); END IF;
    END LOOP;
  END LOOP;
END $grants_functions$;
GRANT EXECUTE ON FUNCTION public.aka_agent_desktop_diagnostic_dom_upload_v1(bigint, uuid, jsonb, text) TO aka_agent_desktop;
GRANT EXECUTE ON FUNCTION public.aka_agent_desktop_diagnostic_doms_v1(bigint) TO service_role;

DO $post$
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.auto_desktop_diagnostic_doms'::regclass) THEN
    RAISE EXCEPTION 'V595: bảng DOM chưa bật RLS';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aka_agent_desktop') THEN
    IF NOT has_function_privilege('aka_agent_desktop', 'public.aka_agent_desktop_diagnostic_dom_upload_v1(bigint, uuid, jsonb, text)', 'EXECUTE') THEN
      RAISE EXCEPTION 'V595: Desktop không gọi được hàm gửi DOM';
    END IF;
    IF has_function_privilege('aka_agent_desktop', 'public.aka_agent_desktop_diagnostic_doms_v1(bigint)', 'EXECUTE')
       OR has_table_privilege('aka_agent_desktop', 'public.auto_desktop_diagnostic_doms', 'SELECT') THEN
      RAISE EXCEPTION 'V595: Desktop đọc được DOM đã gửi';
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
     AND (has_function_privilege('anon', 'public.aka_agent_desktop_diagnostic_dom_upload_v1(bigint, uuid, jsonb, text)', 'EXECUTE')
          OR has_function_privilege('anon', 'public.aka_agent_desktop_diagnostic_doms_v1(bigint)', 'EXECUTE')) THEN
    RAISE EXCEPTION 'V595: anon gọi được hàm DOM';
  END IF;
END $post$;

COMMIT;
