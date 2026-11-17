-- V556 phần 1: engine v2 cho Facebook, đợt 0 (nền). Anh duyệt danh sách schema 16/11/2026 tối
-- (docs/CAMPAIGN_OUTCOME_ENGINE_FACEBOOK_SCHEMA.md: T1–T3, T5, T6, thiết lập, hàm mới; T4 bỏ theo anh chốt 16/11 khuya: việc sau kết
-- quả làm như bộ cũ, không có dấu "đã làm").
--
-- Chỉ THÊM: 5 bảng, 4 dòng thiết lập, 1 view, 11 hàm, 1 job pg_cron. Không sửa bảng / hàm / dữ liệu cũ; chưa hàm engine nào đọc
-- bảng mới (V558 mới đọc), và `engine.facebook` = off, nên không đổi hành vi bộ cũ hay engine Zalo.
--
--   Bảng   auto_engine_block_steps (T1)          danh mục block nào là mốc gửi, ghi dấu "sắp gửi" ở mức nào; Desktop đọc
--          auto_engine_workflows (T2)            loại chiến dịch FB → workflow "[engine] …"; Desktop đọc
--          auto_engine_block_copies (T3)         sổ cặp block cũ ↔ bản engine kèm md5 (chỉ service_role)
--          auto_desktop_diagnostic_requests (T5) yêu cầu lấy ảnh lỗi từ máy khách
--          auto_desktop_diagnostic_files (T6)    ảnh đã lấy về (anh chọn S1: lưu trong DB), xoá sau 7 ngày
--   View   aka_agent_engine_block_copy_drift     cặp block / workflow có một bên sửa sau lần chép
--   Hàm    aka_agent_engine_facebook_org_enabled(org)        nội bộ: tổ chức có trong engine.facebook không (claim V558 dùng)
--          aka_agent_engine_facebook_enabled_v1()            Desktop lúc đăng nhập (như V513, không phụ thuộc quyền Zalo)
--          aka_agent_engine_trace_v1(data, lượt, giới hạn)  service_role, chỉ đọc: tra lỗi theo data / lượt (Q16)
--          aka_agent_engine_health_v1(phút)                  service_role, chỉ đọc: chiến dịch FB đứng, lỗi chưa phân loại (Q22)
--          aka_agent_device_presence_v2(…)                   Desktop: như bản v1, trả thêm số yêu cầu ảnh đang mở
--          aka_agent_desktop_diagnostic_next_v1()            Desktop: nhận yêu cầu ảnh của chính nhân viên
--          aka_agent_desktop_diagnostic_upload_v1(…)         Desktop: ghi một ảnh JPEG vào T6
--          aka_agent_desktop_diagnostic_complete_v1(…)       Desktop: báo xong / không còn ảnh / lỗi
--          aka_agent_desktop_diagnostic_request_v1(…)        service_role: tạo yêu cầu
--          aka_agent_desktop_diagnostic_files_v1(yêu cầu)    service_role, chỉ đọc: lấy ảnh về
--          aka_agent_desktop_diagnostic_cleanup_v1()         job pg_cron mỗi ngày: hết hạn / xoá sau 7 ngày
--   Thiết lập engine.facebook = {"mode":"off","organizationIds":[]}; facebook.max_comments = 20;
--             facebook.block_hang_minutes = 10; campaign.wait_note_minutes = 10 (anh chọn S3).
--
-- Không FK tới bảng nóng (auto_engine_target_runs: lệnh FK khoá bảng Zalo đang ghi tới hết giao dịch). T1–T3 có FK tới bảng danh mục
-- auto_blocks / auto_workflows / auto_account_actions (chỉ chặn ghi danh mục, không chặn đọc, trong lúc giao dịch chạy).
--
-- CREATE FUNCTION / TABLE làm PostgREST nạp lại schema: apply ngoài giờ cao điểm. Phần 2 (auto_outcome_policies) chạy sau, giao dịch
-- riêng. Gỡ: rollback_v556_engine_facebook_p1.sql.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '60s';

DO $pre$
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v556_%') THEN
      RAISE EXCEPTION 'V556 đã có trong sổ migration, không chạy lại';
    END IF;
  END IF;
  IF to_regclass('public.auto_engine_block_steps') IS NOT NULL OR to_regclass('public.auto_engine_workflows') IS NOT NULL
     OR to_regclass('public.auto_engine_block_copies') IS NOT NULL
     OR to_regclass('public.auto_desktop_diagnostic_requests') IS NOT NULL OR to_regclass('public.auto_desktop_diagnostic_files') IS NOT NULL THEN
    RAISE EXCEPTION 'V556: bảng mới đã có';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_system_settings
              WHERE key IN ('engine.facebook', 'facebook.max_comments', 'facebook.block_hang_minutes', 'campaign.wait_note_minutes')) THEN
    RAISE EXCEPTION 'V556: thiết lập engine.facebook / facebook.max_comments / facebook.block_hang_minutes / campaign.wait_note_minutes đã có';
  END IF;
  IF to_regclass('public.auto_engine_target_runs') IS NULL OR to_regclass('public.auto_engine_leases') IS NULL
     OR to_regclass('public.auto_engine_outcomes') IS NULL OR to_regclass('public.auto_outcome_unmatched') IS NULL
     OR to_regclass('public.auto_blocks') IS NULL OR to_regclass('public.auto_workflows') IS NULL
     OR to_regclass('public.auto_runs') IS NULL OR to_regclass('public.auto_run_steps') IS NULL THEN
    RAISE EXCEPTION 'V556: thiếu bảng engine V495 hoặc bảng workflow';
  END IF;
  IF to_regprocedure('public.aka_agent_engine_desktop_staff()') IS NULL OR to_regprocedure('public.aka_agent_engine_scope_ok(bigint)') IS NULL
     OR to_regprocedure('public.aka_agent_device_presence(text,text,uuid,jsonb,boolean)') IS NULL
     OR to_regprocedure('private.aka_agent_desktop_data_context()') IS NULL THEN
    RAISE EXCEPTION 'V556: thiếu hàm phiên Desktop / presence';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aka_agent_desktop') OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    RAISE EXCEPTION 'V556: thiếu role aka_agent_desktop hoặc service_role';
  END IF;
  IF to_regprocedure('public.aka_agent_engine_facebook_enabled_v1()') IS NOT NULL
     OR to_regprocedure('public.aka_agent_device_presence_v2(text,text,uuid,jsonb,boolean)') IS NOT NULL THEN
    RAISE EXCEPTION 'V556: hàm mới đã có';
  END IF;
END $pre$;

-- ============================================================================================
-- 1. Thiết lập (chưa có dòng hoặc sai định dạng = tắt / mặc định)
-- ============================================================================================
INSERT INTO public.auto_system_settings (key, value, description, is_secret, is_active) VALUES
  ('engine.facebook', '{"mode":"off","organizationIds":[]}',
   'Engine v2 cho chiến dịch Facebook (V556). JSON: mode off | orgs (chỉ organizationIds) | all. Thiếu dòng / sai định dạng = off. Desktop đọc lúc đăng nhập (aka_agent_engine_facebook_enabled_v1); claim kiểm lại mỗi lần nhận lượt nên tắt (off) có hiệu lực ngay ở lượt sau, không cần khách đăng nhập lại. Loại chiến dịch nào chạy bộ mới do bản Desktop quyết định.',
   false, true),
  ('facebook.max_comments', '20',
   'Trần "Số comment tối đa" của đăng nhóm / trang cá nhân và "Số bài cần comment trên mỗi group/page/profile" của comment seeding (V556, anh chốt Q10). Số nguyên dương; thiếu dòng / sai = 20. Desktop đọc lúc đăng nhập cho form, AI điền form và lúc chạy (chiến dịch cũ đặt hơn trần chỉ chạy tới trần).',
   false, true),
  ('facebook.block_hang_minutes', '10',
   'Block của chiến dịch Facebook bị coi là treo khi không có thao tác nào trong N phút (không tính lúc nghỉ theo cài đặt và lúc máy ngủ); treo thì huỷ cửa sổ ẩn (V556, Q20 / S3). Số nguyên 2–120; thiếu dòng / sai = 10. Desktop đọc lúc đăng nhập.',
   false, true),
  ('campaign.wait_note_minutes', '10',
   'Chiến dịch đến lịch mà chưa chạy được quá N phút thì ghi câu chờ vào ghi chú chiến dịch và tiến trình, mỗi khi lý do đổi (V556, Q21 / S3; cả Zalo trên Desktop). Số nguyên 1–1440; thiếu dòng / sai = 10. Desktop đọc lúc đăng nhập.',
   false, true);

-- ============================================================================================
-- 2. Bảng
-- ============================================================================================
CREATE TABLE public.auto_engine_block_steps (
  id bigserial PRIMARY KEY,
  block_id bigint NOT NULL REFERENCES public.auto_blocks(id) ON DELETE RESTRICT,
  workflow_id bigint REFERENCES public.auto_workflows(id) ON DELETE RESTRICT,
  node_id text CHECK (node_id IS NULL OR length(node_id) BETWEEN 1 AND 200),
  action_code text REFERENCES public.auto_account_actions(code) ON DELETE RESTRICT,
  action_code_from text CHECK (action_code_from IS NULL OR action_code_from ~ '^[A-Za-z][A-Za-z0-9_]{0,63}$'),
  step_kind text NOT NULL CHECK (step_kind IN ('delivery', 'idempotent', 'result', 'read', 'session')),
  commit_level smallint NOT NULL DEFAULT 1 CHECK (commit_level IN (1, 2, 3)),
  send_ops jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(send_ops) = 'array'),
  result_mode text NOT NULL DEFAULT 'action_result' CHECK (result_mode IN ('action_result', 'legacy_output')),
  legacy_milestone text CHECK (legacy_milestone IS NULL OR legacy_milestone ~ '^[a-z][a-z_]{0,39}$'),
  reviewed_code_md5 text CHECK (reviewed_code_md5 IS NULL OR reviewed_code_md5 ~ '^[a-f0-9]{32}$'),
  is_active boolean NOT NULL DEFAULT true,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auto_engine_block_steps_node_scope_v556 CHECK (node_id IS NULL OR workflow_id IS NOT NULL),
  CONSTRAINT auto_engine_block_steps_action_v556 CHECK (step_kind <> 'delivery' OR action_code IS NOT NULL OR action_code_from IS NOT NULL)
);
CREATE UNIQUE INDEX auto_engine_block_steps_key_v556 ON public.auto_engine_block_steps (block_id, workflow_id, node_id) NULLS NOT DISTINCT WHERE is_active;
COMMENT ON TABLE public.auto_engine_block_steps IS 'V556: danh mục bước của workflow FB chạy bằng engine v2. Mỗi dòng một block (workflow_id + node_id NULL = mọi nơi dùng block; có thì ghi đè riêng cho node). commit_level 1 = ghi dấu "sắp gửi" ở đầu block; 2 = đầu block + vết thao tác (send_ops) cho biết cú bấm gửi đã chạy chưa; 3 = block gọi helpers.commitPoint. Block delivery chưa có dòng thì engine coi là mức 1. reviewed_code_md5 = md5(auto_blocks.code) lúc duyệt; code đổi mà chưa duyệt lại thì engine lùi về mức 1.';

CREATE TABLE public.auto_engine_workflows (
  purpose text PRIMARY KEY CHECK (purpose ~ '^[a-z][a-z0-9_]{1,80}$'),
  workflow_id bigint NOT NULL REFERENCES public.auto_workflows(id) ON DELETE RESTRICT,
  source_workflow_id bigint REFERENCES public.auto_workflows(id) ON DELETE SET NULL,
  source_md5 text CHECK (source_md5 IS NULL OR source_md5 ~ '^[a-f0-9]{32}$'),
  engine_md5 text CHECK (engine_md5 IS NULL OR engine_md5 ~ '^[a-f0-9]{32}$'),
  copied_at timestamptz,
  is_active boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.auto_engine_workflows IS 'V556: workflow engine v2 chạy cho từng loại chiến dịch FB (purpose = auto_campaign_actions.id) hoặc rest_browse (nghỉ / lướt FB). Engine không đọc auto_campaign_actions.workflow_id (bản cũ đọc). md5 = md5(nodes::text || edges::text) lúc chép.';

CREATE TABLE public.auto_engine_block_copies (
  engine_block_id bigint PRIMARY KEY REFERENCES public.auto_blocks(id) ON DELETE CASCADE,
  source_block_id bigint NOT NULL REFERENCES public.auto_blocks(id) ON DELETE CASCADE,
  source_md5_at_copy text NOT NULL CHECK (source_md5_at_copy ~ '^[a-f0-9]{32}$'),
  engine_md5_at_copy text NOT NULL CHECK (engine_md5_at_copy ~ '^[a-f0-9]{32}$'),
  copied_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auto_engine_block_copies_distinct_v556 CHECK (engine_block_id <> source_block_id)
);
CREATE INDEX auto_engine_block_copies_source_v556 ON public.auto_engine_block_copies (source_block_id);
COMMENT ON TABLE public.auto_engine_block_copies IS 'V556: sổ cặp block bản cũ ↔ bản "[engine]" (Q7). md5 = md5(auto_blocks.code) lúc chép; script chép cập nhật lại khi đồng bộ hai bên. View aka_agent_engine_block_copy_drift liệt kê cặp lệch.';

CREATE TABLE public.auto_desktop_diagnostic_requests (
  id bigserial PRIMARY KEY,
  organization_id bigint NOT NULL,
  staff_id bigint NOT NULL,
  requested_by text NOT NULL CHECK (length(btrim(requested_by)) BETWEEN 1 AND 200),
  filter jsonb NOT NULL CHECK (jsonb_typeof(filter) = 'object' AND octet_length(filter::text) <= 16384),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'uploading', 'done', 'no_images', 'expired', 'failed')),
  result jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(result) = 'object' AND octet_length(result::text) <= 65536),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  completed_at timestamptz
);
CREATE INDEX auto_desktop_diagnostic_requests_open_v556 ON public.auto_desktop_diagnostic_requests (staff_id) WHERE status IN ('pending', 'uploading');
CREATE INDEX auto_desktop_diagnostic_requests_created_v556 ON public.auto_desktop_diagnostic_requests (created_at);
COMMENT ON TABLE public.auto_desktop_diagnostic_requests IS 'V556: yêu cầu lấy ảnh lỗi từ máy khách (Q12: chỉ theo yêu cầu). filter: {campaignId?, inputDataId?, targetRunId?, from?, to?, imageIds?}. Máy khách biết qua presence v2, tải ảnh vào auto_desktop_diagnostic_files. Hết hạn sau 7 ngày, job dọn xoá.';

CREATE TABLE public.auto_desktop_diagnostic_files (
  request_id bigint NOT NULL REFERENCES public.auto_desktop_diagnostic_requests(id) ON DELETE CASCADE,
  image_id uuid NOT NULL,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(meta) = 'object' AND octet_length(meta::text) <= 16384),
  content bytea NOT NULL CHECK (octet_length(content) BETWEEN 4 AND 2097152),
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (request_id, image_id)
);
COMMENT ON TABLE public.auto_desktop_diagnostic_files IS 'V556: ảnh lỗi (JPEG ≤ 2 MB) máy khách tải lên theo yêu cầu (anh chọn S1: lưu trong DB). Xoá theo yêu cầu sau 7 ngày.';

-- Quyền: chỉ RPC (SECURITY DEFINER) và service_role. Desktop chỉ đọc T1, T2 (như auto_blocks / auto_workflows).
DO $grants_tables$
DECLARE r text; t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['auto_engine_block_steps', 'auto_engine_workflows', 'auto_engine_block_copies',
                           'auto_desktop_diagnostic_requests', 'auto_desktop_diagnostic_files'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC', t);
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'aka_agent_desktop', 'aka_agent_chat_api'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I', t, r); END IF;
    END LOOP;
    EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['auto_engine_block_steps_id_seq', 'auto_desktop_diagnostic_requests_id_seq'] LOOP
    EXECUTE format('REVOKE ALL ON SEQUENCE public.%I FROM PUBLIC', t);
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'aka_agent_desktop', 'aka_agent_chat_api'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN EXECUTE format('REVOKE ALL ON SEQUENCE public.%I FROM %I', t, r); END IF;
    END LOOP;
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE public.%I TO service_role', t);
  END LOOP;
END $grants_tables$;
GRANT SELECT ON TABLE public.auto_engine_block_steps TO aka_agent_desktop;
GRANT SELECT ON TABLE public.auto_engine_workflows TO aka_agent_desktop;
CREATE POLICY auto_engine_block_steps_desktop_read_v556 ON public.auto_engine_block_steps FOR SELECT TO aka_agent_desktop USING (true);
CREATE POLICY auto_engine_workflows_desktop_read_v556 ON public.auto_engine_workflows FOR SELECT TO aka_agent_desktop USING (true);
CREATE POLICY auto_engine_block_steps_service_v556 ON public.auto_engine_block_steps FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY auto_engine_workflows_service_v556 ON public.auto_engine_workflows FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY auto_engine_block_copies_service_v556 ON public.auto_engine_block_copies FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY auto_desktop_diagnostic_requests_service_v556 ON public.auto_desktop_diagnostic_requests FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY auto_desktop_diagnostic_files_service_v556 ON public.auto_desktop_diagnostic_files FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================================================
-- 3. View cặp lệch (chỉ service_role)
-- ============================================================================================
CREATE VIEW public.aka_agent_engine_block_copy_drift WITH (security_invoker = true) AS
SELECT 'block'::text AS kind, c.engine_block_id AS engine_id, e.name AS engine_name, c.source_block_id AS source_id, s.name AS source_name,
       md5(s.code) IS DISTINCT FROM c.source_md5_at_copy AS source_changed,
       md5(e.code) IS DISTINCT FROM c.engine_md5_at_copy AS engine_changed, c.copied_at
  FROM public.auto_engine_block_copies c
  JOIN public.auto_blocks s ON s.id = c.source_block_id
  JOIN public.auto_blocks e ON e.id = c.engine_block_id
 WHERE md5(s.code) IS DISTINCT FROM c.source_md5_at_copy OR md5(e.code) IS DISTINCT FROM c.engine_md5_at_copy
UNION ALL
SELECT 'workflow'::text, w.workflow_id, e.name, w.source_workflow_id, s.name,
       md5(s.nodes::text || s.edges::text) IS DISTINCT FROM w.source_md5,
       md5(e.nodes::text || e.edges::text) IS DISTINCT FROM w.engine_md5, w.copied_at
  FROM public.auto_engine_workflows w
  JOIN public.auto_workflows e ON e.id = w.workflow_id
  JOIN public.auto_workflows s ON s.id = w.source_workflow_id
 WHERE w.is_active AND (md5(s.nodes::text || s.edges::text) IS DISTINCT FROM w.source_md5
                        OR md5(e.nodes::text || e.edges::text) IS DISTINCT FROM w.engine_md5);
COMMENT ON VIEW public.aka_agent_engine_block_copy_drift IS 'V556: cặp block / workflow bản cũ ↔ bản engine có một bên sửa sau lần chép (Q7). Chạy sau mỗi lần sửa block FB.';
REVOKE ALL ON public.aka_agent_engine_block_copy_drift FROM PUBLIC;
DO $grants_view$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'aka_agent_desktop', 'aka_agent_chat_api'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN EXECUTE format('REVOKE ALL ON public.aka_agent_engine_block_copy_drift FROM %I', r); END IF;
  END LOOP;
END $grants_view$;
GRANT SELECT ON public.aka_agent_engine_block_copy_drift TO service_role;

-- ============================================================================================
-- 4. Hàm: bật engine cho tổ chức
-- ============================================================================================
CREATE FUNCTION public.aka_agent_engine_facebook_org_enabled(p_organization_id bigint)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_raw text;
  v jsonb;
BEGIN
  IF p_organization_id IS NULL THEN RETURN false; END IF;
  SELECT s.value INTO v_raw FROM public.auto_system_settings s WHERE s.key = 'engine.facebook' AND s.is_active LIMIT 1;
  IF v_raw IS NULL OR NOT pg_input_is_valid(v_raw, 'jsonb') THEN RETURN false; END IF;
  v := v_raw::jsonb;
  IF jsonb_typeof(v) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
  IF v->>'mode' = 'all' THEN RETURN true; END IF;
  IF v->>'mode' = 'orgs' AND jsonb_typeof(v->'organizationIds') = 'array' THEN
    RETURN EXISTS (SELECT 1 FROM jsonb_array_elements(v->'organizationIds') e
                    WHERE jsonb_typeof(e.value) IN ('number', 'string') AND (e.value #>> '{}') = p_organization_id::text);
  END IF;
  RETURN false;
END $function$;
COMMENT ON FUNCTION public.aka_agent_engine_facebook_org_enabled(bigint) IS
  'V556: tổ chức có bật engine v2 cho chiến dịch Facebook theo thiết lập engine.facebook không (thiếu dòng / sai = không). Nội bộ: claim và hàm Desktop gọi.';

CREATE FUNCTION public.aka_agent_engine_facebook_enabled_v1()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT coalesce((SELECT public.aka_agent_engine_facebook_org_enabled(ctx.organization_id)
                     FROM private.aka_agent_desktop_data_context() AS ctx LIMIT 1), false)
$function$;
COMMENT ON FUNCTION public.aka_agent_engine_facebook_enabled_v1() IS
  'V556: tổ chức của phiên Desktop có bật engine v2 cho chiến dịch Facebook không (engine.facebook). Desktop đọc lúc đăng nhập; false thì mọi chiến dịch FB chạy bộ cũ. Không phụ thuộc quyền Zalo.';

-- ============================================================================================
-- 5. Hàm tra lỗi / kiểm (service_role, chỉ đọc)
-- ============================================================================================
CREATE FUNCTION public.aka_agent_engine_trace_v1(p_input_data_id bigint DEFAULT NULL, p_target_run_id bigint DEFAULT NULL, p_limit integer DEFAULT 20)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
SET statement_timeout TO '30s'
AS $function$
DECLARE
  v_limit integer := greatest(1, least(coalesce(p_limit, 20), 100));
  v_runs jsonb;
BEGIN
  IF p_input_data_id IS NULL AND p_target_run_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_request');
  END IF;
  WITH runs AS MATERIALIZED (
    SELECT r.* FROM public.auto_engine_target_runs r
     WHERE (p_target_run_id IS NOT NULL AND r.id = p_target_run_id)
        OR (p_target_run_id IS NULL AND r.input_data_id = p_input_data_id)
     ORDER BY r.id DESC LIMIT v_limit
  ), outs AS MATERIALIZED (
    SELECT o.* FROM public.auto_engine_outcomes o WHERE o.target_run_id IN (SELECT id FROM runs)
  ), wf AS MATERIALIZED (
    -- Lượt workflow: mã lượt auto_runs nằm trong tín hiệu (lỗi) hoặc data của dòng lịch sử (R1).
    SELECT DISTINCT x.target_run_id, x.run_id FROM (
      SELECT o.target_run_id, nullif(o.signal->>'runId', '') AS run_id FROM outs o
      UNION ALL
      SELECT o.target_run_id, nullif(d.data->>'runId', '') FROM outs o JOIN public.auto_campaign_details d ON d.id = o.detail_id
    ) x WHERE x.run_id ~ '^[0-9]{1,18}$'
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'run', to_jsonb(r) - 'lease_token' - 'final_response',
      'finalResponse', r.final_response,
      'outcomes', (SELECT coalesce(jsonb_agg(jsonb_build_object('resultKey', o.result_key, 'actionCode', o.action_code, 'phase', o.phase, 'ok', o.ok,
                      'errorCode', o.error_code, 'statusId', o.status_id, 'deliveryState', o.delivery_state, 'detailId', o.detail_id,
                      'decision', o.decision, 'signal', o.signal, 'createdAt', o.created_at) ORDER BY o.created_at, o.result_key), '[]'::jsonb)
                     FROM outs o WHERE o.target_run_id = r.id),
      'events', (SELECT coalesce(jsonb_agg(jsonb_build_object('kind', e.kind, 'errorCode', e.error_code, 'message', e.message, 'data', e.data,
                    'createdAt', e.created_at) ORDER BY e.id), '[]'::jsonb)
                   FROM public.auto_engine_target_events e
                  WHERE e.target_run_id = r.id AND (r.input_data_id IS NULL OR e.input_data_id = r.input_data_id)),
      'details', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'actionCode', d.action_code, 'status', d.status, 'log', d.log,
                     'data', d.data, 'createdAt', d.created_at) ORDER BY d.id), '[]'::jsonb)
                    FROM public.auto_campaign_details d WHERE d.id IN (SELECT o.detail_id FROM outs o WHERE o.target_run_id = r.id)),
      'workflowRuns', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', ar.id, 'workflowId', ar.workflow_id, 'status', ar.status, 'error', ar.error,
                          'startedAt', ar.started_at, 'completedAt', ar.completed_at,
                          'steps', (SELECT coalesce(jsonb_agg(jsonb_build_object('nodeId', s.node_id, 'blockName', s.block_name, 'status', s.status,
                                      'error', s.error, 'durationMs', s.duration_ms, 'output', left(s.output::text, 2000)) ORDER BY s.id), '[]'::jsonb)
                                     FROM (SELECT * FROM public.auto_run_steps s0 WHERE s0.run_id = ar.id ORDER BY s0.id LIMIT 300) s)
                        ) ORDER BY ar.id), '[]'::jsonb)
                         FROM public.auto_runs ar WHERE ar.id IN (SELECT w.run_id::bigint FROM wf w WHERE w.target_run_id = r.id))
    ) ORDER BY r.id DESC), '[]'::jsonb) INTO v_runs
  FROM runs r;
  RETURN jsonb_build_object('ok', true, 'inputDataId', p_input_data_id, 'targetRunId', p_target_run_id, 'runs', v_runs);
END $function$;
COMMENT ON FUNCTION public.aka_agent_engine_trace_v1(bigint, bigint, integer) IS
  'V556 (R1, Q16): chỉ đọc; đưa mã data hoặc mã lượt data của engine, trả các lượt, kết quả (quyết định + tín hiệu + vết thao tác + mã ảnh), sự kiện, dòng lịch sử và các bước của lượt workflow. Dùng bằng script tra lỗi.';

CREATE FUNCTION public.aka_agent_engine_health_v1(p_minutes integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
SET statement_timeout TO '60s'
AS $function$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_minutes integer := greatest(1, least(coalesce(p_minutes, 30), 10080));
  v_since timestamptz;
  v_day timestamptz;
  v_stuck jsonb;
  v_open jsonb;
  v_unmatched jsonb;
  v_errors jsonb;
BEGIN
  v_since := v_now - make_interval(mins => v_minutes);
  v_day := v_now - make_interval(mins => greatest(v_minutes, 1440));
  -- Chiến dịch FB của tổ chức bật engine: đến lịch quá N phút mà không có lượt data nào của engine bắt đầu trong N phút.
  WITH last_run AS MATERIALIZED (
    SELECT tr.campaign_id, max(tr.started_at) AS started_at, count(*) FILTER (WHERE tr.completed_at IS NULL) AS open_runs
      FROM public.auto_engine_target_runs tr WHERE tr.started_at >= v_day GROUP BY tr.campaign_id
  ), fb AS MATERIALIZED (
    SELECT c.id, c.name, c.organization_id, c.staff_id, c.account_id, c.action_id, c.status, c.schedule, c.note, c.updated_at
      FROM public.auto_campaigns c JOIN public.auto_campaign_actions ca ON ca.id = c.action_id
     WHERE lower(btrim(coalesce(ca.flatform_type, ''))) = 'facebook' AND coalesce(c.is_delete, false) = false
       AND c.status IN ('chờ xử lý', 'đang chạy') AND (c.schedule IS NULL OR c.schedule <= v_since)
       AND public.aka_agent_engine_facebook_org_enabled(c.organization_id)
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('campaignId', fb.id, 'name', fb.name, 'organizationId', fb.organization_id, 'staffId', fb.staff_id,
           'accountId', fb.account_id, 'actionId', fb.action_id, 'status', fb.status, 'schedule', fb.schedule, 'note', fb.note,
           'updatedAt', fb.updated_at, 'lastRunAt', lr.started_at, 'openRuns', coalesce(lr.open_runs, 0),
           'accountLoginStatus', a.login_status, 'accountStatus', a.status,
           'lease', (SELECT jsonb_build_object('runnerId', l.runner_id, 'campaignId', l.campaign_id, 'expiresAt', l.expires_at,
                       'heartbeatAt', l.heartbeat_at) FROM public.auto_engine_leases l WHERE l.account_id = fb.account_id),
           'dueTargets', (SELECT count(*) FROM (SELECT 1 FROM public.auto_campaign_input_data d WHERE d.campaign_id = fb.id AND d.status = 'chờ xử lý'
                            AND coalesce(d.is_delete, false) = false AND (d.schedule IS NULL OR d.schedule <= v_now) LIMIT 1000) x)
         ) ORDER BY fb.schedule NULLS FIRST, fb.id), '[]'::jsonb) INTO v_stuck
    FROM fb
    LEFT JOIN last_run lr ON lr.campaign_id = fb.id
    LEFT JOIN public.auto_accounts a ON a.id = fb.account_id
   WHERE lr.started_at IS NULL OR lr.started_at < v_since;
  -- Lượt data FB còn mở quá N phút (block treo, máy ngủ, mất lease mà chưa đóng).
  SELECT coalesce(jsonb_agg(jsonb_build_object('targetRunId', tr.id, 'campaignId', tr.campaign_id, 'accountId', tr.account_id,
           'inputDataId', tr.input_data_id, 'startedAt', tr.started_at, 'firstMarkedAt', tr.first_marked_at, 'marks', tr.marks,
           'outcomeCount', tr.outcome_count) ORDER BY tr.started_at), '[]'::jsonb) INTO v_open
    FROM public.auto_engine_target_runs tr
    JOIN public.auto_accounts a ON a.id = tr.account_id
   WHERE tr.completed_at IS NULL AND tr.started_at < v_since AND lower(btrim(coalesce(a.flatform_type, ''))) = 'facebook';
  SELECT coalesce(jsonb_agg(jsonb_build_object('actionCode', u.action_code, 'phase', u.phase, 'signalKind', u.signal_kind, 'patternKey', u.pattern_key,
           'fallbackErrorCode', u.fallback_error_code, 'hitCount', u.hit_count, 'firstSeenAt', u.first_seen_at, 'lastSeenAt', u.last_seen_at,
           'sample', u.sample) ORDER BY u.hit_count DESC), '[]'::jsonb) INTO v_unmatched
    FROM (SELECT * FROM public.auto_outcome_unmatched x WHERE x.platform = 'facebook' AND x.last_seen_at >= v_since
           ORDER BY x.hit_count DESC LIMIT 50) u;
  SELECT coalesce(jsonb_object_agg(x.error_code, x.n), '{}'::jsonb) INTO v_errors
    FROM (SELECT coalesce(o.error_code, CASE WHEN o.ok THEN 'ok' ELSE 'unknown' END) AS error_code, count(*) AS n
            FROM public.auto_engine_outcomes o WHERE o.created_at >= v_since AND o.action_code LIKE 'fb\_%'
           GROUP BY 1) x;
  RETURN jsonb_build_object('ok', true, 'at', v_now, 'minutes', v_minutes, 'stuckCampaigns', v_stuck, 'openRuns', v_open,
    'unmatched', v_unmatched, 'outcomesByCode', v_errors);
END $function$;
COMMENT ON FUNCTION public.aka_agent_engine_health_v1(integer) IS
  'V556 (R18, Q22): chỉ đọc, không gửi báo; anh hỏi trong phiên thì chạy. Chiến dịch FB của tổ chức bật engine đến lịch mà không có lượt data nào trong N phút (kèm ghi chú, trạng thái tài khoản, lease), lượt data FB mở quá N phút, mẫu lỗi FB chưa có luật, số kết quả FB theo mã.';

-- ============================================================================================
-- 6. Ảnh lỗi: presence v2 và yêu cầu chẩn đoán
-- ============================================================================================
CREATE FUNCTION public.aka_agent_device_presence_v2(p_username text, p_password text, p_instance_id uuid, p_device jsonb, p_ended boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
SET lock_timeout TO '3s'
AS $function$
DECLARE
  v_ok boolean;
  v_staff bigint;
  v_open integer := 0;
BEGIN
  v_ok := public.aka_agent_device_presence(p_username, p_password, p_instance_id, p_device, p_ended);
  IF v_ok AND NOT p_ended THEN
    SELECT s.id INTO v_staff FROM public.org_staff s WHERE s.username = btrim(p_username);
    SELECT count(*) INTO v_open FROM public.auto_desktop_diagnostic_requests r
     WHERE r.staff_id = v_staff AND r.status IN ('pending', 'uploading') AND r.expires_at > clock_timestamp();
  END IF;
  RETURN jsonb_build_object('ok', coalesce(v_ok, false), 'diagnostics', v_open);
END $function$;
COMMENT ON FUNCTION public.aka_agent_device_presence_v2(text, text, uuid, jsonb, boolean) IS
  'V556: như aka_agent_device_presence (nhịp 30 giây của Desktop), trả thêm số yêu cầu ảnh lỗi đang mở của nhân viên; bản Desktop cũ vẫn gọi bản v1, không thêm lượt gọi.';

CREATE FUNCTION public.aka_agent_desktop_diagnostic_next_v1()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
SET lock_timeout TO '3s'
AS $function$
DECLARE
  v_staff bigint := public.aka_agent_engine_desktop_staff();
  v_now timestamptz := clock_timestamp();
  v_items jsonb;
BEGIN
  IF v_staff IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'no_session'); END IF;
  UPDATE public.auto_desktop_diagnostic_requests SET status = 'expired', completed_at = v_now
   WHERE staff_id = v_staff AND status IN ('pending', 'uploading') AND expires_at <= v_now;
  WITH picked AS (
    UPDATE public.auto_desktop_diagnostic_requests r SET status = 'uploading', claimed_at = coalesce(r.claimed_at, v_now)
     WHERE r.staff_id = v_staff AND r.status IN ('pending', 'uploading') AND r.expires_at > v_now
     RETURNING r.id, r.filter, r.expires_at
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'filter', p.filter, 'expiresAt', p.expires_at) ORDER BY p.id), '[]'::jsonb)
    INTO v_items FROM picked p;
  RETURN jsonb_build_object('ok', true, 'requests', v_items);
END $function$;
COMMENT ON FUNCTION public.aka_agent_desktop_diagnostic_next_v1() IS
  'V556: Desktop nhận các yêu cầu ảnh lỗi đang mở của chính nhân viên trong phiên (chuyển uploading).';

CREATE FUNCTION public.aka_agent_desktop_diagnostic_upload_v1(p_request_id bigint, p_image_id uuid, p_meta jsonb, p_jpeg_base64 text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
SET lock_timeout TO '3s'
SET statement_timeout TO '20s'
AS $function$
DECLARE
  v_staff bigint := public.aka_agent_engine_desktop_staff();
  v_now timestamptz := clock_timestamp();
  q public.auto_desktop_diagnostic_requests%ROWTYPE;
  v_bytes bytea;
  v_count integer;
BEGIN
  IF v_staff IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'no_session'); END IF;
  IF p_request_id IS NULL OR p_image_id IS NULL OR p_jpeg_base64 IS NULL OR length(p_jpeg_base64) > 2800000
     OR p_jpeg_base64 !~ '^[A-Za-z0-9+/=\s]+$'
     OR (p_meta IS NOT NULL AND (jsonb_typeof(p_meta) <> 'object' OR octet_length(p_meta::text) > 16384)) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_request');
  END IF;
  SELECT * INTO q FROM public.auto_desktop_diagnostic_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND OR q.staff_id IS DISTINCT FROM v_staff THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  IF q.status NOT IN ('pending', 'uploading') OR q.expires_at <= v_now THEN RETURN jsonb_build_object('ok', false, 'reason', 'closed'); END IF;
  v_bytes := decode(regexp_replace(p_jpeg_base64, '\s', '', 'g'), 'base64');
  IF octet_length(v_bytes) < 4 OR octet_length(v_bytes) > 2097152 OR substring(v_bytes FROM 1 FOR 2) <> '\xffd8'::bytea THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_image');
  END IF;
  SELECT count(*) INTO v_count FROM public.auto_desktop_diagnostic_files f WHERE f.request_id = q.id;
  IF v_count >= 50 THEN RETURN jsonb_build_object('ok', false, 'reason', 'too_many_files'); END IF;
  INSERT INTO public.auto_desktop_diagnostic_files (request_id, image_id, meta, content, sha256, created_at)
  VALUES (q.id, p_image_id, coalesce(p_meta, '{}'::jsonb), v_bytes, encode(sha256(v_bytes), 'hex'), v_now)
  ON CONFLICT (request_id, image_id) DO NOTHING;
  RETURN jsonb_build_object('ok', true, 'bytes', octet_length(v_bytes));
END $function$;
COMMENT ON FUNCTION public.aka_agent_desktop_diagnostic_upload_v1(bigint, uuid, jsonb, text) IS
  'V556: Desktop ghi một ảnh JPEG (≤ 2 MB, tối đa 50 ảnh mỗi yêu cầu) vào yêu cầu đang mở của chính nhân viên.';

CREATE FUNCTION public.aka_agent_desktop_diagnostic_complete_v1(p_request_id bigint, p_result jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
SET lock_timeout TO '3s'
AS $function$
DECLARE
  v_staff bigint := public.aka_agent_engine_desktop_staff();
  v_status text := p_result->>'status';
  q public.auto_desktop_diagnostic_requests%ROWTYPE;
BEGIN
  IF v_staff IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'no_session'); END IF;
  IF p_request_id IS NULL OR jsonb_typeof(p_result) IS DISTINCT FROM 'object' OR octet_length(p_result::text) > 65536
     OR v_status IS NULL OR v_status NOT IN ('done', 'no_images', 'failed') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_request');
  END IF;
  SELECT * INTO q FROM public.auto_desktop_diagnostic_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND OR q.staff_id IS DISTINCT FROM v_staff THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  IF q.status NOT IN ('pending', 'uploading') THEN RETURN jsonb_build_object('ok', true, 'status', q.status, 'replay', true); END IF;
  UPDATE public.auto_desktop_diagnostic_requests SET status = v_status, result = p_result, completed_at = clock_timestamp() WHERE id = q.id;
  RETURN jsonb_build_object('ok', true, 'status', v_status);
END $function$;
COMMENT ON FUNCTION public.aka_agent_desktop_diagnostic_complete_v1(bigint, jsonb) IS
  'V556: Desktop báo xong yêu cầu ảnh lỗi (result.status: done / no_images / failed).';

CREATE FUNCTION public.aka_agent_desktop_diagnostic_request_v1(p_staff_id bigint, p_filter jsonb, p_requested_by text)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_org bigint;
  v_id bigint;
  v_key text;
BEGIN
  IF p_staff_id IS NULL OR jsonb_typeof(p_filter) IS DISTINCT FROM 'object' OR coalesce(btrim(p_requested_by), '') = '' THEN
    RAISE EXCEPTION 'Yêu cầu ảnh lỗi không hợp lệ' USING ERRCODE = '22023';
  END IF;
  FOR v_key IN SELECT jsonb_object_keys(p_filter) LOOP
    IF v_key NOT IN ('campaignId', 'inputDataId', 'targetRunId', 'from', 'to', 'imageIds') THEN
      RAISE EXCEPTION 'Bộ lọc ảnh lỗi có khoá lạ: %', v_key USING ERRCODE = '22023';
    END IF;
  END LOOP;
  IF NOT (p_filter ?| ARRAY['campaignId', 'inputDataId', 'targetRunId', 'imageIds', 'from']) THEN
    RAISE EXCEPTION 'Bộ lọc ảnh lỗi phải có ít nhất một điều kiện' USING ERRCODE = '22023';
  END IF;
  SELECT s.organization_id INTO v_org FROM public.org_staff s WHERE s.id = p_staff_id;
  IF v_org IS NULL THEN RAISE EXCEPTION 'Không tìm thấy nhân viên %', p_staff_id USING ERRCODE = '22023'; END IF;
  INSERT INTO public.auto_desktop_diagnostic_requests (organization_id, staff_id, requested_by, filter, expires_at)
  VALUES (v_org, p_staff_id, btrim(p_requested_by), p_filter, clock_timestamp() + interval '7 days')
  RETURNING id INTO v_id;
  RETURN v_id;
END $function$;
COMMENT ON FUNCTION public.aka_agent_desktop_diagnostic_request_v1(bigint, jsonb, text) IS
  'V556: tạo yêu cầu lấy ảnh lỗi từ máy của một nhân viên (service_role; em chạy khi anh bảo). Hạn 7 ngày.';

CREATE FUNCTION public.aka_agent_desktop_diagnostic_files_v1(p_request_id bigint)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT jsonb_build_object('request', to_jsonb(q),
    'files', (SELECT coalesce(jsonb_agg(jsonb_build_object('imageId', f.image_id, 'meta', f.meta, 'sha256', f.sha256,
                 'bytes', octet_length(f.content), 'base64', encode(f.content, 'base64'), 'createdAt', f.created_at) ORDER BY f.created_at), '[]'::jsonb)
                FROM public.auto_desktop_diagnostic_files f WHERE f.request_id = q.id))
    FROM public.auto_desktop_diagnostic_requests q WHERE q.id = p_request_id
$function$;
COMMENT ON FUNCTION public.aka_agent_desktop_diagnostic_files_v1(bigint) IS
  'V556: chỉ đọc; yêu cầu ảnh lỗi kèm ảnh (base64) để script tải về máy anh (service_role).';

CREATE FUNCTION public.aka_agent_desktop_diagnostic_cleanup_v1()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_expired integer;
  v_deleted integer;
BEGIN
  UPDATE public.auto_desktop_diagnostic_requests SET status = 'expired', completed_at = clock_timestamp()
   WHERE status IN ('pending', 'uploading') AND expires_at <= clock_timestamp();
  GET DIAGNOSTICS v_expired = ROW_COUNT;
  DELETE FROM public.auto_desktop_diagnostic_requests WHERE created_at < clock_timestamp() - interval '7 days';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_expired + v_deleted;
END $function$;
COMMENT ON FUNCTION public.aka_agent_desktop_diagnostic_cleanup_v1() IS
  'V556: job pg_cron mỗi ngày: yêu cầu ảnh lỗi quá hạn thành expired, yêu cầu và ảnh tạo quá 7 ngày bị xoá.';

-- ============================================================================================
-- 7. Quyền hàm
-- ============================================================================================
DO $grants_functions$
DECLARE r text; f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.aka_agent_engine_facebook_org_enabled(bigint)',
    'public.aka_agent_engine_facebook_enabled_v1()',
    'public.aka_agent_engine_trace_v1(bigint, bigint, integer)',
    'public.aka_agent_engine_health_v1(integer)',
    'public.aka_agent_device_presence_v2(text, text, uuid, jsonb, boolean)',
    'public.aka_agent_desktop_diagnostic_next_v1()',
    'public.aka_agent_desktop_diagnostic_upload_v1(bigint, uuid, jsonb, text)',
    'public.aka_agent_desktop_diagnostic_complete_v1(bigint, jsonb)',
    'public.aka_agent_desktop_diagnostic_request_v1(bigint, jsonb, text)',
    'public.aka_agent_desktop_diagnostic_files_v1(bigint)',
    'public.aka_agent_desktop_diagnostic_cleanup_v1()'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role', 'aka_agent_desktop', 'aka_agent_chat_api'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', f, r); END IF;
    END LOOP;
  END LOOP;
END $grants_functions$;
GRANT EXECUTE ON FUNCTION public.aka_agent_engine_facebook_enabled_v1() TO aka_agent_desktop;
GRANT EXECUTE ON FUNCTION public.aka_agent_engine_trace_v1(bigint, bigint, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.aka_agent_engine_health_v1(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.aka_agent_device_presence_v2(text, text, uuid, jsonb, boolean) TO aka_agent_desktop, service_role;
GRANT EXECUTE ON FUNCTION public.aka_agent_desktop_diagnostic_next_v1() TO aka_agent_desktop;
GRANT EXECUTE ON FUNCTION public.aka_agent_desktop_diagnostic_upload_v1(bigint, uuid, jsonb, text) TO aka_agent_desktop;
GRANT EXECUTE ON FUNCTION public.aka_agent_desktop_diagnostic_complete_v1(bigint, jsonb) TO aka_agent_desktop;
GRANT EXECUTE ON FUNCTION public.aka_agent_desktop_diagnostic_request_v1(bigint, jsonb, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.aka_agent_desktop_diagnostic_files_v1(bigint) TO service_role;

-- ============================================================================================
-- 8. Job dọn yêu cầu ảnh lỗi (02:23 giờ VN mỗi ngày). DB thử không có pg_cron thì bỏ qua.
-- ============================================================================================
DO $cron$
BEGIN
  IF to_regnamespace('cron') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'aka-agent-desktop-diagnostics-cleanup') THEN
      RAISE EXCEPTION 'V556: job aka-agent-desktop-diagnostics-cleanup đã có';
    END IF;
    PERFORM cron.schedule('aka-agent-desktop-diagnostics-cleanup', '23 19 * * *', 'SELECT public.aka_agent_desktop_diagnostic_cleanup_v1()');
  ELSE
    RAISE NOTICE 'V556: không có pg_cron, bỏ qua job dọn ảnh lỗi';
  END IF;
END $cron$;

-- ============================================================================================
-- 9. Hậu kiểm
-- ============================================================================================
DO $post$
DECLARE v_bad text;
BEGIN
  SELECT string_agg(t, ', ') INTO v_bad FROM unnest(ARRAY['auto_engine_block_steps', 'auto_engine_workflows', 'auto_engine_block_copies',
      'auto_desktop_diagnostic_requests', 'auto_desktop_diagnostic_files']) t
   WHERE NOT (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = ('public.' || t)::regclass);
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'V556 postflight: bảng chưa bật RLS: %', v_bad; END IF;
  SELECT string_agg(r || ':' || t, ', ') INTO v_bad
    FROM unnest(ARRAY['anon', 'authenticated', 'aka_agent_chat_api', 'aka_agent_desktop']) r
    CROSS JOIN unnest(ARRAY['auto_engine_block_copies', 'auto_desktop_diagnostic_requests', 'auto_desktop_diagnostic_files']) t
   WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r)
     AND (has_table_privilege(r, 'public.' || t, 'SELECT') OR has_table_privilege(r, 'public.' || t, 'INSERT')
          OR has_table_privilege(r, 'public.' || t, 'UPDATE') OR has_table_privilege(r, 'public.' || t, 'DELETE'));
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'V556 postflight: role ứng dụng có quyền bảng không được có: %', v_bad; END IF;
  IF has_table_privilege('aka_agent_desktop', 'public.auto_engine_block_steps', 'INSERT')
     OR NOT has_table_privilege('aka_agent_desktop', 'public.auto_engine_block_steps', 'SELECT')
     OR NOT has_table_privilege('aka_agent_desktop', 'public.auto_engine_workflows', 'SELECT') THEN
    RAISE EXCEPTION 'V556 postflight: quyền Desktop trên danh mục sai';
  END IF;
  SELECT string_agg(r, ', ') INTO v_bad FROM unnest(ARRAY['anon', 'authenticated', 'aka_agent_chat_api']) r
   WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r)
     AND (has_function_privilege(r, 'public.aka_agent_engine_facebook_enabled_v1()', 'EXECUTE')
          OR has_function_privilege(r, 'public.aka_agent_desktop_diagnostic_upload_v1(bigint, uuid, jsonb, text)', 'EXECUTE')
          OR has_function_privilege(r, 'public.aka_agent_engine_trace_v1(bigint, bigint, integer)', 'EXECUTE'));
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'V556 postflight: role không được gọi hàm mới: %', v_bad; END IF;
  IF has_function_privilege('aka_agent_desktop', 'public.aka_agent_desktop_diagnostic_request_v1(bigint, jsonb, text)', 'EXECUTE')
     OR has_function_privilege('aka_agent_desktop', 'public.aka_agent_engine_trace_v1(bigint, bigint, integer)', 'EXECUTE')
     OR has_function_privilege('aka_agent_desktop', 'public.aka_agent_engine_facebook_org_enabled(bigint)', 'EXECUTE') THEN
    RAISE EXCEPTION 'V556 postflight: Desktop không được gọi hàm của service_role / hàm nội bộ';
  END IF;
  IF public.aka_agent_engine_facebook_org_enabled(1) THEN RAISE EXCEPTION 'V556 postflight: engine.facebook phải đang tắt'; END IF;
  IF (SELECT count(*) FROM public.auto_system_settings
       WHERE key IN ('engine.facebook', 'facebook.max_comments', 'facebook.block_hang_minutes', 'campaign.wait_note_minutes') AND is_active) <> 4 THEN
    RAISE EXCEPTION 'V556 postflight: thiếu dòng thiết lập';
  END IF;
END $post$;

COMMIT;
