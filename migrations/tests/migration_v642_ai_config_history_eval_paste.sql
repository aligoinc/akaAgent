-- migration_v642_ai_config_history_eval: lịch sử thay đổi cấu hình AI (ai_prompt, ai_using, ai_model; không chép khoá API) và bảng bộ mẫu kiểm
-- AI lọc bài (docs/FB_AI_FILTER_PLAN.md mục 1.3). Bảng ở schema private, chỉ postgres đọc / ghi. Có DDL nên PostgREST nạp lại schema: apply buổi tối.
-- Dữ liệu bộ mẫu (nội dung bài thật của khách) nạp riêng sau khi apply, không nằm trong repo.
-- Gỡ: rollback_v642_ai_config_history_eval.sql.
-- Bản dán SQL Editor (chịu được CRLF): dán cả file, bấm Run một lần. Sinh bằng scripts/make-migration-paste-crlf-safe.py, không sửa tay.
BEGIN;
DO $aka_wrap_c2b186d22a23$
BEGIN
  EXECUTE replace($aka_body_9d04dbe0b25b$SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v642_%') THEN
      RAISE EXCEPTION 'V642: sổ migration đã có migration_v642_%%, không chạy lại';
    END IF;
  END IF;
  IF to_regclass('private.ai_config_history') IS NOT NULL OR to_regclass('private.ai_eval_cases') IS NOT NULL OR to_regclass('private.ai_eval_results') IS NOT NULL THEN
    RAISE EXCEPTION 'V642: bảng đã có';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'ai_config_history_v642') THEN RAISE EXCEPTION 'V642: trigger đã có'; END IF;
END $pre$;

CREATE TABLE private.ai_config_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  table_name text NOT NULL CHECK (table_name IN ('ai_prompt', 'ai_using', 'ai_model')),
  row_id bigint,
  op text NOT NULL CHECK (op IN ('SNAPSHOT', 'INSERT', 'UPDATE', 'DELETE')),
  old_row jsonb,
  new_row jsonb,
  changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  changed_by text NOT NULL DEFAULT current_user
);
CREATE INDEX ai_config_history_row_idx ON private.ai_config_history (table_name, row_id, changed_at DESC);
COMMENT ON TABLE private.ai_config_history IS 'V642: mỗi lần thêm / sửa / xoá dòng ai_prompt, ai_using, ai_model (bỏ api_key). SNAPSHOT = trạng thái lúc apply V642.';

CREATE FUNCTION private.ai_config_history_capture() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $fn$
DECLARE
  v_old jsonb;
  v_new jsonb;
BEGIN
  IF TG_OP <> 'INSERT' THEN v_old := to_jsonb(OLD) - 'api_key'; END IF;
  IF TG_OP <> 'DELETE' THEN v_new := to_jsonb(NEW) - 'api_key'; END IF;
  IF TG_OP = 'UPDATE' AND (v_old - 'updated_at') = (v_new - 'updated_at') THEN RETURN NULL; END IF;
  INSERT INTO private.ai_config_history (table_name, row_id, op, old_row, new_row)
  VALUES (TG_TABLE_NAME, COALESCE((v_new->>'id')::bigint, (v_old->>'id')::bigint), TG_OP, v_old, v_new);
  RETURN NULL;
END
$fn$;
REVOKE ALL ON FUNCTION private.ai_config_history_capture() FROM PUBLIC, anon, authenticated, service_role, aka_agent_desktop, aka_agent_chat_api;

CREATE TRIGGER ai_config_history_v642 AFTER INSERT OR UPDATE OR DELETE ON public.ai_prompt FOR EACH ROW EXECUTE FUNCTION private.ai_config_history_capture();
CREATE TRIGGER ai_config_history_v642 AFTER INSERT OR UPDATE OR DELETE ON public.ai_using FOR EACH ROW EXECUTE FUNCTION private.ai_config_history_capture();
CREATE TRIGGER ai_config_history_v642 AFTER INSERT OR UPDATE OR DELETE ON public.ai_model FOR EACH ROW EXECUTE FUNCTION private.ai_config_history_capture();

INSERT INTO private.ai_config_history (table_name, row_id, op, new_row)
SELECT 'ai_prompt', p.id, 'SNAPSHOT', to_jsonb(p) FROM public.ai_prompt p
UNION ALL SELECT 'ai_using', u.id, 'SNAPSHOT', to_jsonb(u) FROM public.ai_using u
UNION ALL SELECT 'ai_model', m.id, 'SNAPSHOT', to_jsonb(m) - 'api_key' FROM public.ai_model m;

CREATE TABLE private.ai_eval_cases (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  case_key text NOT NULL UNIQUE,
  using_code text NOT NULL,
  entity_type text NOT NULL CHECK (entity_type IN ('post', 'comment')),
  description text NOT NULL,
  content text NOT NULL,
  label text NOT NULL CHECK (label IN ('match', 'no', 'unclear')),
  label_note text,
  source_campaign_id bigint,
  source_log_id bigint,
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE private.ai_eval_cases IS 'V642: bộ mẫu kiểm AI lọc bài / comment: mô tả của khách, nội dung thật, nhãn đọc tay (đúng ý khách / không / khó gán).';

CREATE TABLE private.ai_eval_results (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  case_id bigint NOT NULL REFERENCES private.ai_eval_cases (id) ON DELETE CASCADE,
  run_label text NOT NULL,
  prompt_code text NOT NULL,
  model_id bigint,
  request_options jsonb NOT NULL DEFAULT '{}'::jsonb,
  matched boolean,
  excluded boolean,
  http_status integer,
  raw_text text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_eval_results_run_idx ON private.ai_eval_results (run_label, case_id);
COMMENT ON TABLE private.ai_eval_results IS 'V642: kết quả từng lượt chạy bộ mẫu (run_label) theo lời dặn và mô hình.';

REVOKE ALL ON private.ai_config_history, private.ai_eval_cases, private.ai_eval_results FROM PUBLIC, anon, authenticated, service_role, aka_agent_desktop, aka_agent_chat_api;

DO $post$
DECLARE v_n integer;
BEGIN
  SELECT count(*) INTO v_n FROM pg_trigger WHERE tgname = 'ai_config_history_v642' AND NOT tgisinternal;
  IF v_n <> 3 THEN RAISE EXCEPTION 'V642 postflight: % trigger', v_n; END IF;
  IF EXISTS (SELECT 1 FROM private.ai_config_history WHERE new_row ? 'api_key' OR old_row ? 'api_key') THEN RAISE EXCEPTION 'V642 postflight: lịch sử chép khoá API'; END IF;
  IF has_table_privilege('aka_agent_desktop', 'private.ai_config_history', 'SELECT') OR has_table_privilege('anon', 'private.ai_eval_cases', 'SELECT')
     OR has_table_privilege('authenticated', 'private.ai_eval_results', 'SELECT') THEN
    RAISE EXCEPTION 'V642 postflight: bảng private còn quyền đọc';
  END IF;
END $post$;

$aka_body_9d04dbe0b25b$, chr(13), '');
  INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
  VALUES (to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYYMMDDHH24MISS'), 'migration_v642_ai_config_history_eval', ARRAY[replace($aka_ledger_495dc51caceb$-- migration_v642_ai_config_history_eval: lịch sử thay đổi cấu hình AI (ai_prompt, ai_using, ai_model; không chép khoá API) và bảng bộ mẫu kiểm
-- AI lọc bài (docs/FB_AI_FILTER_PLAN.md mục 1.3). Bảng ở schema private, chỉ postgres đọc / ghi. Có DDL nên PostgREST nạp lại schema: apply buổi tối.
-- Dữ liệu bộ mẫu (nội dung bài thật của khách) nạp riêng sau khi apply, không nằm trong repo.
-- Gỡ: rollback_v642_ai_config_history_eval.sql.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v642_%') THEN
      RAISE EXCEPTION 'V642: sổ migration đã có migration_v642_%%, không chạy lại';
    END IF;
  END IF;
  IF to_regclass('private.ai_config_history') IS NOT NULL OR to_regclass('private.ai_eval_cases') IS NOT NULL OR to_regclass('private.ai_eval_results') IS NOT NULL THEN
    RAISE EXCEPTION 'V642: bảng đã có';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'ai_config_history_v642') THEN RAISE EXCEPTION 'V642: trigger đã có'; END IF;
END $pre$;

CREATE TABLE private.ai_config_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  table_name text NOT NULL CHECK (table_name IN ('ai_prompt', 'ai_using', 'ai_model')),
  row_id bigint,
  op text NOT NULL CHECK (op IN ('SNAPSHOT', 'INSERT', 'UPDATE', 'DELETE')),
  old_row jsonb,
  new_row jsonb,
  changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  changed_by text NOT NULL DEFAULT current_user
);
CREATE INDEX ai_config_history_row_idx ON private.ai_config_history (table_name, row_id, changed_at DESC);
COMMENT ON TABLE private.ai_config_history IS 'V642: mỗi lần thêm / sửa / xoá dòng ai_prompt, ai_using, ai_model (bỏ api_key). SNAPSHOT = trạng thái lúc apply V642.';

CREATE FUNCTION private.ai_config_history_capture() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $fn$
DECLARE
  v_old jsonb;
  v_new jsonb;
BEGIN
  IF TG_OP <> 'INSERT' THEN v_old := to_jsonb(OLD) - 'api_key'; END IF;
  IF TG_OP <> 'DELETE' THEN v_new := to_jsonb(NEW) - 'api_key'; END IF;
  IF TG_OP = 'UPDATE' AND (v_old - 'updated_at') = (v_new - 'updated_at') THEN RETURN NULL; END IF;
  INSERT INTO private.ai_config_history (table_name, row_id, op, old_row, new_row)
  VALUES (TG_TABLE_NAME, COALESCE((v_new->>'id')::bigint, (v_old->>'id')::bigint), TG_OP, v_old, v_new);
  RETURN NULL;
END
$fn$;
REVOKE ALL ON FUNCTION private.ai_config_history_capture() FROM PUBLIC, anon, authenticated, service_role, aka_agent_desktop, aka_agent_chat_api;

CREATE TRIGGER ai_config_history_v642 AFTER INSERT OR UPDATE OR DELETE ON public.ai_prompt FOR EACH ROW EXECUTE FUNCTION private.ai_config_history_capture();
CREATE TRIGGER ai_config_history_v642 AFTER INSERT OR UPDATE OR DELETE ON public.ai_using FOR EACH ROW EXECUTE FUNCTION private.ai_config_history_capture();
CREATE TRIGGER ai_config_history_v642 AFTER INSERT OR UPDATE OR DELETE ON public.ai_model FOR EACH ROW EXECUTE FUNCTION private.ai_config_history_capture();

INSERT INTO private.ai_config_history (table_name, row_id, op, new_row)
SELECT 'ai_prompt', p.id, 'SNAPSHOT', to_jsonb(p) FROM public.ai_prompt p
UNION ALL SELECT 'ai_using', u.id, 'SNAPSHOT', to_jsonb(u) FROM public.ai_using u
UNION ALL SELECT 'ai_model', m.id, 'SNAPSHOT', to_jsonb(m) - 'api_key' FROM public.ai_model m;

CREATE TABLE private.ai_eval_cases (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  case_key text NOT NULL UNIQUE,
  using_code text NOT NULL,
  entity_type text NOT NULL CHECK (entity_type IN ('post', 'comment')),
  description text NOT NULL,
  content text NOT NULL,
  label text NOT NULL CHECK (label IN ('match', 'no', 'unclear')),
  label_note text,
  source_campaign_id bigint,
  source_log_id bigint,
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE private.ai_eval_cases IS 'V642: bộ mẫu kiểm AI lọc bài / comment: mô tả của khách, nội dung thật, nhãn đọc tay (đúng ý khách / không / khó gán).';

CREATE TABLE private.ai_eval_results (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  case_id bigint NOT NULL REFERENCES private.ai_eval_cases (id) ON DELETE CASCADE,
  run_label text NOT NULL,
  prompt_code text NOT NULL,
  model_id bigint,
  request_options jsonb NOT NULL DEFAULT '{}'::jsonb,
  matched boolean,
  excluded boolean,
  http_status integer,
  raw_text text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_eval_results_run_idx ON private.ai_eval_results (run_label, case_id);
COMMENT ON TABLE private.ai_eval_results IS 'V642: kết quả từng lượt chạy bộ mẫu (run_label) theo lời dặn và mô hình.';

REVOKE ALL ON private.ai_config_history, private.ai_eval_cases, private.ai_eval_results FROM PUBLIC, anon, authenticated, service_role, aka_agent_desktop, aka_agent_chat_api;

DO $post$
DECLARE v_n integer;
BEGIN
  SELECT count(*) INTO v_n FROM pg_trigger WHERE tgname = 'ai_config_history_v642' AND NOT tgisinternal;
  IF v_n <> 3 THEN RAISE EXCEPTION 'V642 postflight: % trigger', v_n; END IF;
  IF EXISTS (SELECT 1 FROM private.ai_config_history WHERE new_row ? 'api_key' OR old_row ? 'api_key') THEN RAISE EXCEPTION 'V642 postflight: lịch sử chép khoá API'; END IF;
  IF has_table_privilege('aka_agent_desktop', 'private.ai_config_history', 'SELECT') OR has_table_privilege('anon', 'private.ai_eval_cases', 'SELECT')
     OR has_table_privilege('authenticated', 'private.ai_eval_results', 'SELECT') THEN
    RAISE EXCEPTION 'V642 postflight: bảng private còn quyền đọc';
  END IF;
END $post$;

COMMIT;
$aka_ledger_495dc51caceb$, chr(13), '')]);
END $aka_wrap_c2b186d22a23$;
COMMIT;
