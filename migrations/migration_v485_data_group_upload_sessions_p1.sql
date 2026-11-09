-- V485 phần 1/2: nhập file vào nhóm data theo nhiều phần (begin -> append x N -> finish), bỏ trần 10.000 dòng.
-- Production akachat (cgjbsmqtfhqvttudyjzq) only. Sinh bằng scripts/build-v485-sql.py, đừng sửa tay.
-- Apply SAU V483 và đủ 3 phần V484; đúng thứ tự p1 -> p2, mỗi phần một giao dịch. Phần sau kiểm phần trước và từ chối
-- chạy lại. Giữa hai phần app cũ chạy như cũ (hàm nạp chưa đổi; RPC phiên chưa dùng được vì hàm nạp chưa hiểu phiên).
-- Rollback: rollback_v485_data_group_upload_sessions.sql (chạy được cả khi mới apply p1).
-- Hợp đồng: docs/DATA_GROUP_ASYNC_ROUTING_V484.md mục V485. Kiểm thử: python3 scripts/data-group-routing/test_v485.py
--
-- Vì sao: kiểu 'upload' là ảnh chụp cả file (đầu lượt đặt lại dataset, cuối lượt gỡ thành viên không còn trong file),
-- nên không chia lô được, và mỗi lần gọi tối đa 10.000 dòng trong trần 60 giây (~8 ms/dòng => ~7.000 dòng là hết giờ).
--
-- Cả bộ V485:
--   p1 bảng private.auto_data_group_upload_sessions (+ _parts), RLS bật, không cấp role API; 2 hàm private; RPC lõi
--      begin/append/finish (service_role) và 3 lối vào Desktop có xác thực (service_role, aka_agent_desktop; append
--      gọi guard V483 với kiểu 'manual'); vá worker V484: cuối mỗi lượt cộng lại lượt tổng của phiên đã chốt còn phần
--      chờ đẩy (SKIP LOCKED, không chờ khoá phiên).
--   p2 vá hàm nạp lõi: khi GUC aka_agent.upload_session_id có giá trị (chỉ append đặt) thì không đặt lại dataset, không
--      gỡ thành viên, cộng vị trí phần vào thứ tự dòng/rowIndex, dòng trùng với phần trước không thêm origin thứ hai;
--      lượt nhập file một lần đánh dấu phiên đang mở cùng dataset là bị thay.
-- finish: kiểm đủ phần liên tục [0, total), đặt lại dòng/origin của dataset không thuộc phiên, gỡ thành viên như cuối
-- lượt một lần, đếm lại dataset, ghi một lượt nạp tổng '<request>:finish' (lượt "gần nhất" của nhóm).
-- Preflight kiểm md5 hàm nạp bản V484 và thân worker V484. Apply ngoài giờ cao điểm (DDL làm PostgREST nạp lại schema).

BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '120s';

DO $v485_p1_preflight$
DECLARE
  v_md5 text;
BEGIN
  IF to_regclass('private.auto_data_group_upload_sessions') IS NOT NULL
     OR to_regprocedure('public.aka_agent_finish_data_group_upload(bigint,bigint,uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'v485: already applied (p1 objects exist)';
  END IF;
  IF to_regprocedure('private.aka_agent_assert_data_group_ingest_budget(bigint,bigint,text,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'v485: apply V483 first (guard missing)';
  END IF;
  IF to_regclass('private.auto_data_group_route_jobs') IS NULL
     OR NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'aka-agent-data-group-route-worker') THEN
    RAISE EXCEPTION 'v485: apply V484 p1-p3 first';
  END IF;
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public.aka_agent_ingest_data_group_v186_internal(bigint,bigint,text,bigint,text,jsonb,bigint,text,text,bigint,text,text)')));
  IF v_md5 IS DISTINCT FROM '0a0c9d1f870df7eac69ceaa20f6fb10a' THEN
    RAISE EXCEPTION 'v485: ingest function is not the V484 version (md5 %); re-read live definition', v_md5;
  END IF;
  SELECT md5(p.prosrc) INTO v_md5 FROM pg_proc AS p WHERE p.oid = to_regprocedure('private.aka_agent_run_data_group_route_worker(integer)');
  IF v_md5 IS DISTINCT FROM '38cff7e0b74ac9abba1283a6850f9185' THEN
    RAISE EXCEPTION 'v485: V484 route worker drifted (prosrc md5 %)', v_md5;
  END IF;
END
$v485_p1_preflight$;

CREATE TEMP TABLE v485_worker_acl ON COMMIT DROP AS
SELECT p.proacl::text AS acl, p.proconfig::text AS config, pg_get_userbyid(p.proowner) AS owner, p.prosecdef
FROM pg_proc AS p WHERE p.oid = to_regprocedure('private.aka_agent_run_data_group_route_worker(integer)');

-- ===================================================================================================================
-- Đối tượng mới của V485 (ghép vào migration bởi scripts/build-v485-sql.py): nhập file nhiều phần
-- ===================================================================================================================

-- Một phiên nhập file vào nhóm data. Mỗi phần (append) là một lượt nạp 'upload' bình thường vào dataset của phiên,
-- nhưng KHÔNG đặt lại dataset ở đầu và KHÔNG gỡ thành viên ở cuối; finish làm phần "ảnh chụp" một lần cho cả file.
-- Phiên hết hạn hoặc bị phiên/lượt nhập khác cùng dataset thay thế thì bỏ dở: dòng đã nhận vẫn còn, không gỡ gì.
CREATE TABLE private.auto_data_group_upload_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id bigint NOT NULL,
  organization_id bigint NOT NULL,
  request_id text NOT NULL,
  group_id bigint NOT NULL,
  dataset_id bigint NOT NULL,
  data_type_category_item_id bigint,
  import_source text,
  source_account_id bigint,
  source_name text,
  total_rows integer NOT NULL,
  received_rows integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'open',
  summary_batch_id bigint,
  result jsonb,
  routing_pending boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '6 hours',
  finished_at timestamptz,
  CONSTRAINT auto_data_group_upload_sessions_status_check
    CHECK (status IN ('open', 'finished', 'superseded', 'expired')),
  CONSTRAINT auto_data_group_upload_sessions_total_check CHECK (total_rows BETWEEN 1 AND 100000),
  CONSTRAINT auto_data_group_upload_sessions_received_check CHECK (received_rows BETWEEN 0 AND total_rows),
  CONSTRAINT uq_auto_data_group_upload_sessions_request UNIQUE (staff_id, organization_id, request_id)
);
CREATE INDEX idx_auto_data_group_upload_sessions_open_dataset
  ON private.auto_data_group_upload_sessions (dataset_id)
  WHERE status = 'open';
-- Phiên đã chốt mà còn phần chờ worker V484 đẩy: worker cộng lại lượt tổng khi các phần xong.
CREATE INDEX idx_auto_data_group_upload_sessions_routing_pending
  ON private.auto_data_group_upload_sessions (finished_at, id)
  WHERE routing_pending;

-- Các phần đã nhận: [part_offset, part_offset + row_count) của file, mỗi phần một lượt nạp (batch).
CREATE TABLE private.auto_data_group_upload_session_parts (
  session_id uuid NOT NULL REFERENCES private.auto_data_group_upload_sessions(id) ON DELETE CASCADE,
  part_offset integer NOT NULL,
  row_count integer NOT NULL,
  batch_id bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, part_offset),
  CONSTRAINT uq_auto_data_group_upload_session_parts_batch UNIQUE (batch_id),
  CONSTRAINT auto_data_group_upload_session_parts_range_check CHECK (part_offset >= 0 AND row_count BETWEEN 1 AND 10000)
);

ALTER TABLE private.auto_data_group_upload_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.auto_data_group_upload_session_parts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.auto_data_group_upload_sessions, private.auto_data_group_upload_session_parts
  FROM PUBLIC, anon, authenticated, service_role, aka_agent_desktop, aka_agent_chat_api;

CREATE FUNCTION private.aka_agent_data_group_upload_session_json(p_session_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT jsonb_build_object(
    'session_id', session.id, 'request_id', session.request_id, 'group_id', session.group_id,
    'dataset_id', session.dataset_id, 'status', session.status, 'total_rows', session.total_rows,
    'received_rows', session.received_rows, 'expires_at', session.expires_at,
    'parts', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('offset', part.part_offset, 'rows', part.row_count) ORDER BY part.part_offset)
      FROM private.auto_data_group_upload_session_parts AS part
      WHERE part.session_id = session.id
    ), '[]'::jsonb)
  )
  FROM private.auto_data_group_upload_sessions AS session
  WHERE session.id = p_session_id;
$function$;

-- Cộng kết quả các phần (theo thứ tự trong file) thành phần đếm của lượt tổng. Gọi lúc chốt phiên, và từ worker V484
-- cho phiên đã chốt còn phần chờ đẩy (worker cộng số input thật vào lượt nạp của phần, routing_status 'queued' -> 'done').
CREATE FUNCTION private.aka_agent_data_group_upload_part_totals(p_session_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  WITH parts AS (
    SELECT part.part_offset, batch.result
    FROM private.auto_data_group_upload_session_parts AS part
    JOIN public.auto_data_ingest_batches AS batch ON batch.id = part.batch_id
    WHERE part.session_id = p_session_id
  ), conflicts AS (
    SELECT item.value, parts.part_offset, item.ordinality
    FROM parts
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(parts.result -> 'conflicts') = 'array' THEN parts.result -> 'conflicts' ELSE '[]'::jsonb END
    ) WITH ORDINALITY AS item(value, ordinality)
  )
  SELECT jsonb_build_object(
    'inserted_membership_count', COALESCE(sum((result ->> 'inserted_membership_count')::integer), 0),
    'reactivated_membership_count', COALESCE(sum((result ->> 'reactivated_membership_count')::integer), 0),
    'already_member_count', COALESCE(sum((result ->> 'already_member_count')::integer), 0),
    'inserted_input_count', COALESCE(sum((result ->> 'inserted_input_count')::integer), 0),
    'already_seen_input_count', COALESCE(sum((result ->> 'already_seen_input_count')::integer), 0),
    'incompatible_count', COALESCE(sum((result ->> 'incompatible_count')::integer), 0),
    'conflict_count', COALESCE(sum((result ->> 'conflict_count')::integer), 0),
    'invalid_count', COALESCE(sum((result ->> 'invalid_count')::integer), 0),
    'conflicts', COALESCE((
      SELECT jsonb_agg(limited.value ORDER BY limited.part_offset, limited.ordinality)
      FROM (
        SELECT conflicts.value, conflicts.part_offset, conflicts.ordinality
        FROM conflicts
        ORDER BY conflicts.part_offset, conflicts.ordinality
        LIMIT 1000
      ) AS limited
    ), '[]'::jsonb)
  ) || CASE
    WHEN bool_or(result ->> 'routing_status' = 'queued') THEN jsonb_build_object('routing_status', 'queued')
    WHEN bool_or(result ->> 'routing_status' = 'done') THEN jsonb_build_object(
      'routing_status', 'done',
      'routing_error_count', COALESCE(sum((result ->> 'routing_error_count')::integer), 0)
    )
    ELSE '{}'::jsonb
  END
  FROM parts;
$function$;

CREATE FUNCTION public.aka_agent_begin_data_group_upload(
  p_staff_id bigint, p_organization_id bigint, p_request_id text, p_group_id bigint, p_dataset_name text,
  p_import_source text, p_source_account_id bigint, p_source_name text, p_data_type_category_item_id bigint,
  p_type_rows jsonb, p_total_rows integer
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET statement_timeout TO '60s'
AS $function$
DECLARE
  v_request_id text := btrim(COALESCE(p_request_id, ''));
  v_group public.auto_account_contact_groups%ROWTYPE;
  v_source_account public.auto_accounts%ROWTYPE;
  v_dataset public.auto_account_contacts_dataset%ROWTYPE;
  v_session private.auto_data_group_upload_sessions%ROWTYPE;
  v_source_account_id bigint;
  v_display_name text;
  v_source_key text;
  v_contact_type text;
  v_platform text;
  v_previous_context text := current_setting('aka_agent.data_type_category_item_id', true);
BEGIN
  PERFORM public.aka_agent_internal_require_staff_tenant(p_staff_id, p_organization_id);
  IF v_request_id = '' OR length(v_request_id) > 400
    OR p_total_rows IS NULL OR p_total_rows < 1 OR p_total_rows > 100000
    OR p_type_rows IS NULL OR jsonb_typeof(p_type_rows) IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_type_rows) > 1000
    OR (p_import_source IS NOT NULL AND p_import_source NOT IN ('textbox', 'image', 'sheet', 'excel'))
  THEN
    RAISE EXCEPTION 'invalid_data_group_ingest_payload';
  END IF;

  SELECT * INTO v_session
  FROM private.auto_data_group_upload_sessions AS session
  WHERE session.staff_id = p_staff_id AND session.organization_id = p_organization_id
    AND session.request_id = v_request_id;
  IF FOUND THEN
    -- Gửi lại begin cùng mã: trả phiên cũ kèm các phần đã nhận để app gửi tiếp phần còn thiếu.
    IF v_session.group_id IS DISTINCT FROM p_group_id OR v_session.total_rows IS DISTINCT FROM p_total_rows THEN
      RAISE EXCEPTION 'data_group_request_id_conflict';
    END IF;
    RETURN private.aka_agent_data_group_upload_session_json(v_session.id);
  END IF;

  -- Như hàm nạp lõi 13 tham số: kiểu dữ liệu khai báo phải hợp lệ và khớp kiểu của nhóm.
  IF p_data_type_category_item_id IS NOT NULL
    AND NOT public.aka_agent_is_data_type_category_item(p_data_type_category_item_id, true)
  THEN
    RAISE EXCEPTION 'invalid_data_type_category_item';
  END IF;

  SELECT * INTO v_group
  FROM public.auto_account_contact_groups AS contact_group
  WHERE contact_group.id = p_group_id
    AND contact_group.staff_id = p_staff_id
    AND contact_group.organization_id = p_organization_id
    AND contact_group.purpose = 'data_group'
    AND contact_group.is_delete = false
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'data_group_not_found'; END IF;
  IF v_group.data_type_category_item_id IS NOT NULL
    AND p_data_type_category_item_id IS DISTINCT FROM v_group.data_type_category_item_id
  THEN
    RAISE EXCEPTION 'data_group_ingest_semantic_type_mismatch';
  END IF;

  IF p_source_account_id IS NOT NULL THEN
    SELECT * INTO v_source_account
    FROM public.auto_accounts AS account
    WHERE account.id = p_source_account_id
      AND account.staff_id = p_staff_id
      AND (account.organization_id IS NULL OR account.organization_id = p_organization_id);
    IF NOT FOUND THEN RAISE EXCEPTION 'data_group_source_account_not_found'; END IF;
  END IF;
  IF v_group.bound_zalo_account_id IS NOT NULL THEN
    IF NOT public.aka_agent_data_group_account_available(v_group.bound_zalo_account_id, p_staff_id, p_organization_id) THEN
      RAISE EXCEPTION 'data_group_bound_account_invalid';
    END IF;
    IF p_source_account_id IS NOT NULL AND p_source_account_id <> v_group.bound_zalo_account_id THEN
      RAISE EXCEPTION 'data_group_bound_source_mismatch';
    END IF;
  END IF;
  -- Như lượt nạp 'upload' một lần: dataset gắn với tài khoản nguồn, hoặc tài khoản Zalo nhóm đang gắn.
  v_source_account_id := COALESCE(p_source_account_id, v_group.bound_zalo_account_id);
  IF v_source_account_id IS NOT NULL THEN
    SELECT * INTO v_source_account FROM public.auto_accounts WHERE id = v_source_account_id;
  END IF;

  v_display_name := COALESCE(
    NULLIF(btrim(COALESCE(p_dataset_name, '')), ''),
    NULLIF(btrim(COALESCE(p_source_name, '')), ''),
    v_group.name
  );
  IF length(v_display_name) > 255 THEN
    RAISE EXCEPTION 'invalid_data_group_dataset_name';
  END IF;
  v_source_key := 'upload:' || lower(regexp_replace(v_display_name, '[[:space:]]+', ' ', 'g'));

  -- Cùng cách tính loại/nền tảng dataset như lượt nạp một lần. p_type_rows là các cặp (contact_type, flatform_type)
  -- có trong file; DISTINCT nên chỉ cần mỗi cặp một lần.
  WITH row_types AS (
    SELECT DISTINCT lower(btrim(item.value ->> 'contact_type')) AS value
    FROM jsonb_array_elements(p_type_rows) AS item(value)
    WHERE jsonb_typeof(item.value) = 'object'
      AND lower(btrim(COALESCE(item.value ->> 'contact_type', ''))) IN (
        'person', 'group', 'page', 'page_inbox_customer', 'zalo_tag',
        'phone', 'email', 'campaign_input'
      )
  )
  SELECT CASE WHEN count(*) = 1 THEN min(value) ELSE 'campaign_input' END
  INTO v_contact_type
  FROM row_types;

  WITH row_platforms AS (
    SELECT DISTINCT lower(btrim(COALESCE(
      NULLIF(item.value ->> 'flatform_type', ''),
      v_source_account.flatform_type,
      CASE WHEN lower(btrim(item.value ->> 'contact_type')) = 'email' THEN 'email' END,
      ''
    ))) AS value
    FROM jsonb_array_elements(p_type_rows) AS item(value)
    WHERE jsonb_typeof(item.value) = 'object'
  ), valid_platforms AS (
    SELECT value FROM row_platforms
    WHERE value IN ('facebook', 'zalo', 'email', 'sms')
  )
  SELECT CASE WHEN count(*) = 1 THEN min(value) ELSE 'mixed' END
  INTO v_platform
  FROM valid_platforms;

  -- Ngữ cảnh kiểu dữ liệu như hàm lõi 13 tham số đặt khi tạo dataset (trigger gán kiểu cho dataset theo ngữ cảnh).
  PERFORM set_config(
    'aka_agent.data_type_category_item_id', COALESCE(p_data_type_category_item_id::text, 'null'), true
  );
  INSERT INTO public.auto_account_contacts_dataset (
    name, link, description, source, account_id, group_id, flatform_type,
    contact_type, scan_type, source_key, last_scanned_at, last_scan_status,
    extra_data, contact_count, is_delete, staff_id, organization_id
  ) VALUES (
    v_display_name,
    NULL, NULL, 'upload', v_source_account_id, v_group.id,
    COALESCE(v_platform, 'mixed'),
    COALESCE(v_contact_type, 'campaign_input'),
    'upload_data', v_source_key, now(), 'completed',
    jsonb_strip_nulls(jsonb_build_object(
      'importSource', p_import_source, 'requestId', v_request_id
    )),
    0, false, p_staff_id, p_organization_id
  )
  ON CONFLICT (
    staff_id, organization_id, group_id, COALESCE(account_id, 0::bigint),
    flatform_type, contact_type, scan_type, lower(btrim(source_key))
  )
    WHERE is_delete = false AND source = 'upload' AND group_id IS NOT NULL
  DO UPDATE SET
    name = EXCLUDED.name,
    extra_data = COALESCE(auto_account_contacts_dataset.extra_data, '{}'::jsonb)
      || EXCLUDED.extra_data,
    updated_at = now(), last_scanned_at = now(), last_scan_status = 'completed'
  RETURNING * INTO v_dataset;
  PERFORM set_config('aka_agent.data_type_category_item_id', COALESCE(v_previous_context, ''), true);

  -- Một dataset chỉ có một phiên đang mở: phiên mới thay phiên cũ chưa xong. Dọn phiên quá hạn/cũ của người gọi.
  UPDATE private.auto_data_group_upload_sessions
  SET status = 'superseded', updated_at = now()
  WHERE dataset_id = v_dataset.id AND status = 'open';
  UPDATE private.auto_data_group_upload_sessions
  SET status = 'expired', updated_at = now()
  WHERE staff_id = p_staff_id AND organization_id = p_organization_id
    AND status = 'open' AND expires_at <= now();
  DELETE FROM private.auto_data_group_upload_sessions
  WHERE staff_id = p_staff_id AND organization_id = p_organization_id
    AND created_at < now() - interval '30 days';

  INSERT INTO private.auto_data_group_upload_sessions (
    staff_id, organization_id, request_id, group_id, dataset_id, data_type_category_item_id, import_source,
    source_account_id, source_name, total_rows
  ) VALUES (
    p_staff_id, p_organization_id, v_request_id, v_group.id, v_dataset.id, p_data_type_category_item_id,
    p_import_source, p_source_account_id, NULLIF(btrim(COALESCE(p_source_name, '')), ''), p_total_rows
  )
  RETURNING * INTO v_session;
  RETURN private.aka_agent_data_group_upload_session_json(v_session.id);
END;
$function$;

CREATE FUNCTION public.aka_agent_append_data_group_upload(
  p_staff_id bigint, p_organization_id bigint, p_session_id uuid, p_part_offset integer, p_rows jsonb,
  p_payload_hash text
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET statement_timeout TO '60s'
AS $function$
DECLARE
  v_session private.auto_data_group_upload_sessions%ROWTYPE;
  v_group_id bigint;
  v_len integer;
  v_known integer;
  v_part_request text;
  v_result jsonb;
BEGIN
  PERFORM public.aka_agent_internal_require_staff_tenant(p_staff_id, p_organization_id);
  IF p_session_id IS NULL OR p_part_offset IS NULL OR p_part_offset < 0
    OR p_rows IS NULL OR jsonb_typeof(p_rows) IS DISTINCT FROM 'array'
  THEN
    RAISE EXCEPTION 'invalid_data_group_ingest_payload';
  END IF;
  v_len := jsonb_array_length(p_rows);
  IF v_len < 1 OR v_len > 10000 THEN
    RAISE EXCEPTION 'invalid_data_group_ingest_payload';
  END IF;

  -- Khoá nhóm trước phiên, cùng thứ tự với begin/finish và lượt nạp một lần (không khoá chéo).
  SELECT session.group_id INTO v_group_id
  FROM private.auto_data_group_upload_sessions AS session
  WHERE session.id = p_session_id AND session.staff_id = p_staff_id
    AND session.organization_id = p_organization_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'data_group_upload_session_not_found'; END IF;
  PERFORM 1 FROM public.auto_account_contact_groups AS contact_group WHERE contact_group.id = v_group_id FOR UPDATE;
  SELECT * INTO v_session
  FROM private.auto_data_group_upload_sessions AS session
  WHERE session.id = p_session_id
  FOR UPDATE;
  IF v_session.status <> 'open' OR v_session.expires_at <= now() THEN
    RAISE EXCEPTION 'data_group_upload_session_closed';
  END IF;
  IF p_part_offset + v_len > v_session.total_rows THEN
    RAISE EXCEPTION 'invalid_data_group_ingest_payload';
  END IF;
  SELECT part.row_count INTO v_known
  FROM private.auto_data_group_upload_session_parts AS part
  WHERE part.session_id = v_session.id AND part.part_offset = p_part_offset;
  IF v_known IS NOT NULL AND v_known <> v_len THEN
    RAISE EXCEPTION 'data_group_upload_part_conflict';
  END IF;
  IF v_known IS NULL AND EXISTS (
    SELECT 1 FROM private.auto_data_group_upload_session_parts AS part
    WHERE part.session_id = v_session.id
      AND part.part_offset < p_part_offset + v_len
      AND part.part_offset + part.row_count > p_part_offset
  ) THEN
    RAISE EXCEPTION 'data_group_upload_part_conflict';
  END IF;

  -- Lượt nạp 'upload' bình thường vào dataset của phiên. Hai GUC báo hàm nạp: không đặt lại dataset, không gỡ thành
  -- viên, cộng vị trí của phần vào thứ tự dòng. Mã yêu cầu theo (phiên, vị trí, độ dài): gửi lại đúng phần trả kết
  -- quả cũ, không nạp trùng.
  v_part_request := v_session.request_id || ':part:' || p_part_offset::text || '+' || v_len::text;
  PERFORM set_config('aka_agent.upload_session_id', v_session.id::text, true);
  PERFORM set_config('aka_agent.upload_row_offset', p_part_offset::text, true);
  v_result := public.aka_agent_ingest_data_group(
    p_staff_id, p_organization_id, v_part_request, v_session.group_id, 'upload', p_rows, v_session.dataset_id,
    NULL, v_session.import_source, v_session.source_account_id, v_session.source_name, p_payload_hash,
    v_session.data_type_category_item_id
  );
  PERFORM set_config('aka_agent.upload_session_id', '', true);
  PERFORM set_config('aka_agent.upload_row_offset', '', true);

  IF v_known IS NULL THEN
    INSERT INTO private.auto_data_group_upload_session_parts (session_id, part_offset, row_count, batch_id)
    VALUES (v_session.id, p_part_offset, v_len, (v_result ->> 'batch_id')::bigint);
    UPDATE private.auto_data_group_upload_sessions
    SET received_rows = received_rows + v_len, updated_at = now()
    WHERE id = v_session.id
    RETURNING * INTO v_session;
  END IF;
  RETURN v_result || jsonb_build_object(
    'session_id', v_session.id, 'part_offset', p_part_offset,
    'received_rows', v_session.received_rows, 'total_rows', v_session.total_rows
  );
END;
$function$;

CREATE FUNCTION public.aka_agent_finish_data_group_upload(p_staff_id bigint, p_organization_id bigint, p_session_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET statement_timeout TO '60s'
AS $function$
DECLARE
  v_session private.auto_data_group_upload_sessions%ROWTYPE;
  v_group public.auto_account_contact_groups%ROWTYPE;
  v_group_id bigint;
  v_complete boolean;
  v_revision bigint;
  v_removed_members integer := 0;
  v_summary_id bigint;
  v_result jsonb;
BEGIN
  PERFORM public.aka_agent_internal_require_staff_tenant(p_staff_id, p_organization_id);
  SELECT session.group_id INTO v_group_id
  FROM private.auto_data_group_upload_sessions AS session
  WHERE session.id = p_session_id AND session.staff_id = p_staff_id
    AND session.organization_id = p_organization_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'data_group_upload_session_not_found'; END IF;
  -- Khoá nhóm trước phiên như append (không khoá chéo với một phần đang gửi dở).
  SELECT * INTO v_group
  FROM public.auto_account_contact_groups AS contact_group
  WHERE contact_group.id = v_group_id
  FOR UPDATE;
  SELECT * INTO v_session
  FROM private.auto_data_group_upload_sessions AS session
  WHERE session.id = p_session_id
  FOR UPDATE;
  IF v_session.status = 'finished' THEN
    RETURN v_session.result;
  END IF;
  IF v_session.status <> 'open' OR v_session.expires_at <= now() THEN
    RAISE EXCEPTION 'data_group_upload_session_closed';
  END IF;
  -- Thiếu phần thì không chốt: gỡ thành viên theo một file thiếu dòng sẽ xoá nhầm.
  SELECT COALESCE(bool_and(part.part_offset = part.expected_offset), false)
         AND COALESCE(sum(part.row_count), 0) = v_session.total_rows
  INTO v_complete
  FROM (
    SELECT p.part_offset, p.row_count,
           COALESCE(sum(p.row_count) OVER (
             ORDER BY p.part_offset ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
           ), 0) AS expected_offset
    FROM private.auto_data_group_upload_session_parts AS p
    WHERE p.session_id = v_session.id
  ) AS part;
  IF NOT v_complete OR v_session.received_rows <> v_session.total_rows THEN
    RAISE EXCEPTION 'data_group_upload_incomplete';
  END IF;

  IF v_group.id IS NULL OR v_group.staff_id IS DISTINCT FROM p_staff_id
    OR v_group.organization_id IS DISTINCT FROM p_organization_id
    OR v_group.purpose IS DISTINCT FROM 'data_group' OR v_group.is_delete
  THEN
    RAISE EXCEPTION 'data_group_not_found';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.auto_account_contacts_dataset AS dataset
    WHERE dataset.id = v_session.dataset_id AND dataset.staff_id = p_staff_id
      AND dataset.organization_id = p_organization_id AND dataset.is_delete = false
      AND dataset.source = 'upload' AND dataset.group_id = v_group.id
  ) THEN
    RAISE EXCEPTION 'data_group_dataset_not_found';
  END IF;

  -- Như đầu lượt nạp một lần: chỉ dòng của file này còn "hiện tại" trong dataset. Dòng của file là contact có origin
  -- hiện tại thuộc một lượt nạp (phần) của phiên; các phần không đặt lại gì nên dòng của lần nhập trước còn tới đây.
  UPDATE public.auto_account_contacts_dataset_members AS dataset_member
  SET is_current = false, updated_at = now()
  WHERE dataset_member.dataset_id = v_session.dataset_id
    AND dataset_member.is_current = true
    AND dataset_member.contact_id NOT IN (
      SELECT member.contact_id
      FROM public.auto_account_contact_group_member_origins AS origin
      JOIN public.auto_account_contact_group_members AS member ON member.id = origin.membership_id
      WHERE origin.dataset_id = v_session.dataset_id
        AND origin.is_current = true
        AND origin.batch_id IN (
          SELECT part.batch_id FROM private.auto_data_group_upload_session_parts AS part
          WHERE part.session_id = v_session.id
        )
    );
  UPDATE public.auto_account_contact_group_member_origins AS origin
  SET is_current = false, updated_at = now()
  WHERE origin.dataset_id = v_session.dataset_id
    AND origin.is_current = true
    AND (origin.batch_id IS NULL OR origin.batch_id NOT IN (
      SELECT part.batch_id FROM private.auto_data_group_upload_session_parts AS part
      WHERE part.session_id = v_session.id
    ));

  -- Như cuối lượt nạp một lần (nguyên văn khối gỡ thành viên của aka_agent_ingest_data_group_v186_internal).
  SELECT count(*)::integer INTO v_removed_members
  FROM public.auto_account_contact_group_members AS member
  WHERE member.group_id = v_group.id AND member.is_delete = false
    AND EXISTS (
      SELECT 1 FROM public.auto_account_contact_group_member_origins AS historical_origin
      WHERE historical_origin.membership_id = member.id
        AND historical_origin.dataset_id = v_session.dataset_id
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.auto_account_contact_group_member_origins AS current_origin
      WHERE current_origin.membership_id = member.id
        AND current_origin.is_current = true
    );
  v_revision := v_group.revision;
  IF v_removed_members > 0 THEN
    UPDATE public.auto_account_contact_groups
    SET revision = revision + 1, updated_at = now()
    WHERE id = v_group.id
    RETURNING revision INTO v_revision;
    UPDATE public.auto_account_contact_group_members AS member
    SET is_delete = true, change_revision = v_revision, updated_at = now()
    WHERE member.group_id = v_group.id AND member.is_delete = false
      AND EXISTS (
        SELECT 1 FROM public.auto_account_contact_group_member_origins AS historical_origin
        WHERE historical_origin.membership_id = member.id
          AND historical_origin.dataset_id = v_session.dataset_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.auto_account_contact_group_member_origins AS current_origin
        WHERE current_origin.membership_id = member.id
          AND current_origin.is_current = true
      );
  END IF;

  UPDATE public.auto_account_contacts_dataset AS dataset
  SET contact_count = (
    SELECT count(*)::integer
    FROM public.auto_account_contacts_dataset_members AS member
    WHERE member.dataset_id = v_session.dataset_id AND member.is_current = true
  ), updated_at = now()
  WHERE dataset.id = v_session.dataset_id;

  -- Một lượt "lần nạp gần nhất" cho cả file: màn hình nhóm/chiến dịch đọc lượt nạp mới nhất của nhóm.
  INSERT INTO public.auto_data_ingest_batches (
    request_id, operation, group_id, kind, dataset_id, source_account_id, source_name,
    request_hash, status, staff_id, organization_id
  ) VALUES (
    v_session.request_id || ':finish', 'ingest', v_group.id, 'upload', v_session.dataset_id,
    v_session.source_account_id, v_session.source_name, md5(v_session.id::text), 'processing',
    p_staff_id, p_organization_id
  )
  RETURNING id INTO v_summary_id;

  v_result := jsonb_build_object(
    'request_id', v_session.request_id,
    'batch_id', v_summary_id,
    'group_id', v_group.id,
    'group_revision', v_revision,
    'removed_membership_count', v_removed_members,
    'session_id', v_session.id,
    'dataset_id', v_session.dataset_id,
    'total_rows', v_session.total_rows,
    'part_count', (SELECT count(*) FROM private.auto_data_group_upload_session_parts WHERE session_id = v_session.id)
  ) || private.aka_agent_data_group_upload_part_totals(v_session.id);

  UPDATE public.auto_data_ingest_batches
  SET status = 'completed', result = v_result, updated_at = now()
  WHERE id = v_summary_id;
  UPDATE private.auto_data_group_upload_sessions
  SET status = 'finished', summary_batch_id = v_summary_id, result = v_result,
      routing_pending = (v_result ->> 'routing_status') IS NOT DISTINCT FROM 'queued',
      finished_at = now(), updated_at = now()
  WHERE id = v_session.id;
  RETURN v_result;
END;
$function$;

-- Lối vào cho app Desktop (token Desktop + tài khoản đăng nhập), cùng cách 2 wrapper nạp nhóm của V483.
CREATE FUNCTION public.aka_agent_begin_data_group_upload(
  p_staff_id bigint, p_organization_id bigint, p_request_id text, p_group_id bigint, p_dataset_name text,
  p_import_source text, p_source_account_id bigint, p_source_name text, p_data_type_category_item_id bigint,
  p_type_rows jsonb, p_total_rows integer, p_auth_username text, p_auth_password text
)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET statement_timeout TO '60s'
AS $function$
  SELECT public.auto_assert_automation_identity(p_staff_id, p_organization_id, p_auth_username, p_auth_password);
  SELECT public.aka_agent_begin_data_group_upload(
    p_staff_id, p_organization_id, p_request_id, p_group_id, p_dataset_name, p_import_source, p_source_account_id,
    p_source_name, p_data_type_category_item_id, p_type_rows, p_total_rows
  );
$function$;

CREATE FUNCTION public.aka_agent_append_data_group_upload(
  p_staff_id bigint, p_organization_id bigint, p_session_id uuid, p_part_offset integer, p_rows jsonb,
  p_payload_hash text, p_auth_username text, p_auth_password text
)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET statement_timeout TO '60s'
AS $function$
  SELECT public.auto_assert_automation_identity(p_staff_id, p_organization_id, p_auth_username, p_auth_password);
  -- Chặn sớm phần chắc chắn quá 60 giây (PT413 kèm rowMs/maxRows): app thu nhỏ phần rồi gửi lại.
  SELECT private.aka_agent_assert_data_group_ingest_budget(
    p_organization_id,
    (SELECT session.group_id FROM private.auto_data_group_upload_sessions AS session
     WHERE session.id = p_session_id AND session.staff_id = p_staff_id AND session.organization_id = p_organization_id),
    'manual',
    p_rows
  );
  SELECT public.aka_agent_append_data_group_upload(
    p_staff_id, p_organization_id, p_session_id, p_part_offset, p_rows, p_payload_hash
  );
$function$;

CREATE FUNCTION public.aka_agent_finish_data_group_upload(
  p_staff_id bigint, p_organization_id bigint, p_session_id uuid, p_auth_username text, p_auth_password text
)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET statement_timeout TO '60s'
AS $function$
  SELECT public.auto_assert_automation_identity(p_staff_id, p_organization_id, p_auth_username, p_auth_password);
  SELECT public.aka_agent_finish_data_group_upload(p_staff_id, p_organization_id, p_session_id);
$function$;

REVOKE ALL ON FUNCTION
  private.aka_agent_data_group_upload_session_json(uuid),
  private.aka_agent_data_group_upload_part_totals(uuid),
  public.aka_agent_begin_data_group_upload(bigint, bigint, text, bigint, text, text, bigint, text, bigint, jsonb, integer),
  public.aka_agent_append_data_group_upload(bigint, bigint, uuid, integer, jsonb, text),
  public.aka_agent_finish_data_group_upload(bigint, bigint, uuid),
  public.aka_agent_begin_data_group_upload(bigint, bigint, text, bigint, text, text, bigint, text, bigint, jsonb, integer, text, text),
  public.aka_agent_append_data_group_upload(bigint, bigint, uuid, integer, jsonb, text, text, text),
  public.aka_agent_finish_data_group_upload(bigint, bigint, uuid, text, text)
FROM PUBLIC, anon, authenticated, service_role, aka_agent_desktop, aka_agent_chat_api;
-- Web/API (service_role) gọi lối vào lõi; app Desktop gọi lối vào có xác thực (như 2 wrapper nạp nhóm).
GRANT EXECUTE ON FUNCTION
  public.aka_agent_begin_data_group_upload(bigint, bigint, text, bigint, text, text, bigint, text, bigint, jsonb, integer),
  public.aka_agent_append_data_group_upload(bigint, bigint, uuid, integer, jsonb, text),
  public.aka_agent_finish_data_group_upload(bigint, bigint, uuid)
TO service_role;
GRANT EXECUTE ON FUNCTION
  public.aka_agent_begin_data_group_upload(bigint, bigint, text, bigint, text, text, bigint, text, bigint, jsonb, integer, text, text),
  public.aka_agent_append_data_group_upload(bigint, bigint, uuid, integer, jsonb, text, text, text),
  public.aka_agent_finish_data_group_upload(bigint, bigint, uuid, text, text)
TO service_role, aka_agent_desktop;

-- private.aka_agent_run_data_group_route_worker(integer): prosrc md5 38cff7e0b74ac9abba1283a6850f9185 -> dda4a682e5028469a1542e5c10efebd6
CREATE OR REPLACE FUNCTION private.aka_agent_run_data_group_route_worker(p_budget_ms integer DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_settings jsonb := private.aka_agent_data_group_routing_settings();
  v_budget_ms integer;
  v_started timestamptz := clock_timestamp();
  v_deadline timestamptz;
  v_job_id bigint;
  v_slice jsonb;
  v_slices integer := 0;
  v_pairs integer := 0;
  v_errors integer := 0;
  v_cleaned integer := 0;
  v_session record;
  v_totals jsonb;
  v_summary jsonb;
  v_summaries integer := 0;
BEGIN
  IF NOT pg_catalog.pg_try_advisory_xact_lock(hashtextextended('aka_agent_data_group_route_worker', 0)) THEN
    RETURN jsonb_build_object('status', 'busy');
  END IF;
  v_budget_ms := LEAST(GREATEST(COALESCE(
    p_budget_ms,
    CASE WHEN jsonb_typeof(v_settings -> 'workerBudgetMs') = 'number'
      THEN (v_settings ->> 'workerBudgetMs')::numeric::integer END,
    4000
  ), 200), 20000);
  v_deadline := v_started + make_interval(secs => v_budget_ms / 1000.0);
  PERFORM set_config('lock_timeout', '2000ms', true);

  LOOP
    EXIT WHEN v_slices >= 32 OR clock_timestamp() >= v_deadline;
    -- Xoay vòng giữa các nhóm; trong một nhóm làm đúng thứ tự tạo việc (data vào chiến dịch theo thứ tự như đẩy ngay).
    SELECT job.id INTO v_job_id
    FROM private.auto_data_group_route_jobs AS job
    WHERE job.status IN ('pending', 'running')
      AND (job.next_attempt_at IS NULL OR job.next_attempt_at <= clock_timestamp())
      AND NOT EXISTS (
        SELECT 1 FROM private.auto_data_group_route_jobs AS earlier
        WHERE earlier.group_id = job.group_id
          AND earlier.status IN ('pending', 'running')
          AND earlier.id < job.id
      )
    ORDER BY job.last_worked_at NULLS FIRST, job.id
    LIMIT 1
    FOR UPDATE SKIP LOCKED;
    EXIT WHEN NOT FOUND;
    v_slice := private.aka_agent_route_data_group_job_slice(v_job_id, v_deadline);
    v_slices := v_slices + 1;
    v_pairs := v_pairs + COALESCE((v_slice ->> 'pairs')::integer, 0);
    IF v_slice ->> 'state' = 'error' THEN
      v_errors := v_errors + 1;
    END IF;
  END LOOP;

  -- V485: phiên nhập file đã chốt mà còn phần chờ đẩy: cộng lại lượt tổng của phiên (lượt nạp '<mã>:finish').
  -- SKIP LOCKED: phiên đang được ghi thì để lượt sau, không chờ khoá.
  FOR v_session IN
    SELECT session.id, session.summary_batch_id
    FROM private.auto_data_group_upload_sessions AS session
    WHERE session.routing_pending
    ORDER BY session.finished_at, session.id
    LIMIT 20
    FOR UPDATE SKIP LOCKED
  LOOP
    v_totals := private.aka_agent_data_group_upload_part_totals(v_session.id);
    UPDATE private.auto_data_group_upload_sessions AS session
    SET result = session.result || v_totals,
        routing_pending = (v_totals ->> 'routing_status') IS NOT DISTINCT FROM 'queued',
        updated_at = clock_timestamp()
    WHERE session.id = v_session.id
    RETURNING session.result INTO v_summary;
    UPDATE public.auto_data_ingest_batches
    SET result = v_summary, updated_at = now()
    WHERE id = v_session.summary_batch_id;
    v_summaries := v_summaries + 1;
  END LOOP;

  WITH old AS (
    SELECT job.id
    FROM private.auto_data_group_route_jobs AS job
    WHERE job.status IN ('done', 'failed')
      AND job.finished_at < now() - interval '30 days'
    ORDER BY job.finished_at
    LIMIT 200
  )
  DELETE FROM private.auto_data_group_route_jobs AS job
  USING old
  WHERE job.id = old.id;
  GET DIAGNOSTICS v_cleaned = ROW_COUNT;

  RETURN jsonb_build_object(
    'status', 'ok', 'slices', v_slices, 'pairs', v_pairs, 'errors', v_errors, 'cleaned', v_cleaned,
    'upload_summaries', v_summaries,
    'ms', round(extract(epoch FROM clock_timestamp() - v_started) * 1000)
  );
END;
$function$;

DO $v485_p1_postflight$
DECLARE
  v_role text;
  v_sig text;
BEGIN
  FOREACH v_sig IN ARRAY ARRAY['private.aka_agent_data_group_upload_session_json(uuid)', 'private.aka_agent_data_group_upload_part_totals(uuid)', 'public.aka_agent_begin_data_group_upload(bigint,bigint,text,bigint,text,text,bigint,text,bigint,jsonb,integer)', 'public.aka_agent_append_data_group_upload(bigint,bigint,uuid,integer,jsonb,text)', 'public.aka_agent_finish_data_group_upload(bigint,bigint,uuid)', 'public.aka_agent_begin_data_group_upload(bigint,bigint,text,bigint,text,text,bigint,text,bigint,jsonb,integer,text,text)', 'public.aka_agent_append_data_group_upload(bigint,bigint,uuid,integer,jsonb,text,text,text)', 'public.aka_agent_finish_data_group_upload(bigint,bigint,uuid,text,text)'] LOOP
    IF to_regprocedure(v_sig) IS NULL THEN
      RAISE EXCEPTION 'v485: % missing after p1', v_sig;
    END IF;
  END LOOP;
  IF (SELECT md5(p.prosrc) FROM pg_proc AS p WHERE p.oid = to_regprocedure('private.aka_agent_run_data_group_route_worker(integer)'))
     IS DISTINCT FROM 'dda4a682e5028469a1542e5c10efebd6' THEN
    RAISE EXCEPTION 'v485: route worker not as expected after p1';
  END IF;
  IF EXISTS (
    SELECT 1 FROM v485_worker_acl AS before
    JOIN pg_proc AS p ON p.oid = to_regprocedure('private.aka_agent_run_data_group_route_worker(integer)')
    WHERE p.proacl::text IS DISTINCT FROM before.acl OR p.proconfig::text IS DISTINCT FROM before.config
       OR pg_get_userbyid(p.proowner) IS DISTINCT FROM before.owner OR p.prosecdef IS DISTINCT FROM before.prosecdef
  ) THEN
    RAISE EXCEPTION 'v485: privileges/config of the route worker changed';
  END IF;
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role', 'aka_agent_desktop', 'aka_agent_chat_api'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_role) THEN
      FOREACH v_sig IN ARRAY ARRAY['private.aka_agent_data_group_upload_session_json(uuid)', 'private.aka_agent_data_group_upload_part_totals(uuid)'] LOOP
        IF has_function_privilege(v_role, v_sig, 'EXECUTE') THEN
          RAISE EXCEPTION 'v485: % executable by %', v_sig, v_role;
        END IF;
      END LOOP;
      FOREACH v_sig IN ARRAY ARRAY['public.aka_agent_begin_data_group_upload(bigint,bigint,text,bigint,text,text,bigint,text,bigint,jsonb,integer)', 'public.aka_agent_append_data_group_upload(bigint,bigint,uuid,integer,jsonb,text)', 'public.aka_agent_finish_data_group_upload(bigint,bigint,uuid)'] LOOP
        IF has_function_privilege(v_role, v_sig, 'EXECUTE') IS DISTINCT FROM (v_role = 'service_role') THEN
          RAISE EXCEPTION 'v485: % EXECUTE for % not as expected', v_sig, v_role;
        END IF;
      END LOOP;
      FOREACH v_sig IN ARRAY ARRAY['public.aka_agent_begin_data_group_upload(bigint,bigint,text,bigint,text,text,bigint,text,bigint,jsonb,integer,text,text)', 'public.aka_agent_append_data_group_upload(bigint,bigint,uuid,integer,jsonb,text,text,text)', 'public.aka_agent_finish_data_group_upload(bigint,bigint,uuid,text,text)'] LOOP
        IF has_function_privilege(v_role, v_sig, 'EXECUTE')
           IS DISTINCT FROM (v_role IN ('service_role', 'aka_agent_desktop')) THEN
          RAISE EXCEPTION 'v485: % EXECUTE for % not as expected', v_sig, v_role;
        END IF;
      END LOOP;
      IF has_table_privilege(v_role, 'private.auto_data_group_upload_sessions', 'SELECT')
         OR has_table_privilege(v_role, 'private.auto_data_group_upload_session_parts', 'SELECT') THEN
        RAISE EXCEPTION 'v485: upload session tables readable by %', v_role;
      END IF;
    END IF;
  END LOOP;
  IF has_function_privilege('public', 'private.aka_agent_run_data_group_route_worker(integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'v485: route worker executable by PUBLIC';
  END IF;
END
$v485_p1_postflight$;

COMMIT;
