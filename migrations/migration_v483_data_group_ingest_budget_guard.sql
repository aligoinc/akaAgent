-- V483 (09/11/2026): Chặn sớm lần "thêm data vào nhóm" từ Desktop chắc chắn vượt trần 60 giây.
-- Sự cố 08–09/11: khách (staff 724) thêm ~45 group Facebook vào nhóm data đang cấp data cho 630 chiến dịch bật
-- "nhận data mới từ nhóm": hàm nạp đẩy từng dòng vào từng chiến dịch trong một giao dịch (statement_timeout 60s
-- của hàm), ~3 giây mỗi dòng ⇒ 8 lần bị huỷ "canceling statement due to statement timeout", rollback toàn bộ,
-- mỗi lần giữ khoá nhóm/630 chiến dịch/dòng nhân viên suốt 60 giây. Web 08/11: file ~8.700 dòng cũng quá 60 giây.
-- Thời gian ≈ số dòng × (~8 ms + số chiến dịch đang bật × ~5 ms) (đo 02/11 và 08/11 trên production).
--
-- Thay đổi:
--   1. Hàm mới private.aka_agent_assert_data_group_ingest_budget(org, group, kind, rows): đếm chiến dịch đang bật
--      nhận data của nhóm (index idx_auto_campaign_data_group_sources_group_intake, không khoá gì), ước tính như trên;
--      chỉ khi ước tính > 75 giây (chắc chắn quá trần) mới RAISE SQLSTATE PT413 (PostgREST trả HTTP 413) với câu
--      tiếng Việt cho khách và DETAIL JSON {code, maxRows (cho ~45 giây), rowMs, receivingCampaigns, rows}.
--   2. Gắn vào đúng 2 cửa vào của Desktop (wrapper SQL 14 và 15 tham số, EXECUTE aka_agent_desktop) ngay sau xác
--      thực, trước khi gọi hàm nạp. Thân cũ giữ nguyên văn, chỉ chèn một câu. KHÔNG đổi hàm lõi 12/13 tham số mà
--      hàm nội bộ (quy trình tự động, aka Map, Google Sheet, kết quả tự động hoá) và API Web gọi; API Web tự chia lô.
-- Desktop bản cũ (gửi một lần): lần gửi chắc chắn quá giờ bị báo ngay bằng tiếng Việt thay vì chờ 60 giây rồi huỷ.
-- Desktop bản mới (src/shared/dataGroupIngestChunks.ts): đọc PT413/rowMs rồi tự chia lô ~20 giây mỗi lần.
-- Không đổi quyền: ACL hai wrapper giữ nguyên; hàm private khoá EXECUTE (chỉ owner, wrapper SECURITY DEFINER gọi).
-- CREATE OR REPLACE FUNCTION làm PostgREST nạp lại schema ⇒ apply ngoài giờ cao điểm.
BEGIN;
SET LOCAL lock_timeout = '3s';

DO $v483_preflight$
DECLARE
  v_fn record;
BEGIN
  IF to_regprocedure('private.aka_agent_assert_data_group_ingest_budget(bigint,bigint,text,jsonb)') IS NOT NULL THEN
    RAISE EXCEPTION 'v483: already applied (private.aka_agent_assert_data_group_ingest_budget exists)';
  END IF;
  IF to_regprocedure('public.auto_assert_automation_identity(bigint,bigint,text,text)') IS NULL
     OR to_regprocedure('public.aka_agent_ingest_data_group(bigint,bigint,text,bigint,text,jsonb,bigint,text,text,bigint,text,text)') IS NULL
     OR to_regprocedure('public.aka_agent_ingest_data_group(bigint,bigint,text,bigint,text,jsonb,bigint,text,text,bigint,text,text,bigint)') IS NULL THEN
    RAISE EXCEPTION 'v483: identity or core ingest function missing';
  END IF;
  IF (SELECT count(*) FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'auto_campaign_data_group_sources'
        AND column_name IN ('group_id', 'status', 'organization_id')) <> 3 THEN
    RAISE EXCEPTION 'v483: auto_campaign_data_group_sources shape changed';
  END IF;
  -- Thân và thuộc tính hai wrapper Desktop đọc trên akachat lúc viết migration (09/11/2026).
  FOR v_fn IN
    SELECT p.oid::regprocedure::text AS sig, md5(p.prosrc) AS src_md5, l.lanname, p.prosecdef,
           pg_get_userbyid(p.proowner) AS owner, p.proconfig::text AS config, p.proacl::text AS acl,
           CASE p.pronargs WHEN 14 THEN 'd3ba6d794b51ef41a6af705920cab7af' ELSE '9a75506b8a5a2ddc197052bfc725cb7f' END AS expected_md5
    FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
    WHERE p.oid IN (
      to_regprocedure('public.aka_agent_ingest_data_group(bigint,bigint,text,bigint,text,jsonb,bigint,text,text,bigint,text,text,text,text)'),
      to_regprocedure('public.aka_agent_ingest_data_group(bigint,bigint,text,bigint,text,jsonb,bigint,text,text,bigint,text,text,bigint,text,text)'))
  LOOP
    IF v_fn.src_md5 <> v_fn.expected_md5 OR v_fn.lanname <> 'sql' OR NOT v_fn.prosecdef OR v_fn.owner <> 'postgres'
       OR v_fn.config IS DISTINCT FROM '{"search_path=pg_catalog, public",statement_timeout=60s}'
       OR v_fn.acl IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,aka_agent_desktop=X/postgres}' THEN
      RAISE EXCEPTION 'v483: % drifted (md5 %, lang %, definer %, owner %, config %, acl %); re-read live definition',
        v_fn.sig, v_fn.src_md5, v_fn.lanname, v_fn.prosecdef, v_fn.owner, v_fn.config, v_fn.acl;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_proc WHERE oid IN (
        to_regprocedure('public.aka_agent_ingest_data_group(bigint,bigint,text,bigint,text,jsonb,bigint,text,text,bigint,text,text,text,text)'),
        to_regprocedure('public.aka_agent_ingest_data_group(bigint,bigint,text,bigint,text,jsonb,bigint,text,text,bigint,text,text,bigint,text,text)'))) <> 2 THEN
    RAISE EXCEPTION 'v483: Desktop ingest wrappers missing';
  END IF;
END
$v483_preflight$;

CREATE FUNCTION private.aka_agent_assert_data_group_ingest_budget(
  p_organization_id bigint,
  p_group_id bigint,
  p_kind text,
  p_rows jsonb
)
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  -- Đo trên production: ~7–11 ms mỗi dòng khi nhóm cấp data cho 0–1 chiến dịch (08/11, file 3.757–4.911 dòng),
  -- ~4,3 ms cho mỗi (dòng × chiến dịch đang bật nhận data) (02/11, nhóm ~575 chiến dịch).
  c_row_ms constant numeric := 8;
  c_campaign_ms constant numeric := 5;
  c_reject_ms constant numeric := 75000;  -- chỉ chặn lần gửi chắc chắn vượt trần 60 giây của hàm nạp
  c_suggest_ms constant numeric := 45000; -- số dòng gợi ý cho một lần gửi
  v_rows integer;
  v_campaigns integer;
  v_row_ms numeric;
  v_max_rows integer;
  v_reason text;
BEGIN
  IF p_rows IS NULL OR jsonb_typeof(p_rows) IS DISTINCT FROM 'array' THEN
    RETURN; -- hàm nạp tự báo invalid_data_group_ingest_payload
  END IF;
  v_rows := jsonb_array_length(p_rows);
  IF v_rows = 0 THEN
    RETURN;
  END IF;

  -- Chỉ đếm nguồn cùng tổ chức người gọi: không lộ số liệu nhóm của tổ chức khác.
  SELECT count(*)::integer
    INTO v_campaigns
    FROM public.auto_campaign_data_group_sources AS source
   WHERE source.group_id = p_group_id
     AND source.status IN ('baselining', 'active')
     AND source.organization_id = p_organization_id;

  v_row_ms := c_row_ms + v_campaigns * c_campaign_ms;
  IF v_rows * v_row_ms <= c_reject_ms THEN
    RETURN;
  END IF;
  v_max_rows := greatest(1, floor(c_suggest_ms / v_row_ms)::integer);
  v_reason := CASE
    WHEN v_campaigns > 0 THEN format('nhóm data này đang cấp data cho %s chiến dịch bật "nhận data mới từ nhóm"', v_campaigns)
    ELSE 'danh sách quá lớn'
  END;

  RAISE EXCEPTION USING
    ERRCODE = 'PT413',
    MESSAGE = CASE
      WHEN p_kind = 'upload' THEN format(
        'File có %s dòng, quá nhiều để nhập một lần vì %s (mỗi lần khoảng %s dòng). Vui lòng tách thành nhiều file, mỗi file đặt tên khác nhau, rồi nhập lần lượt.',
        v_rows, v_reason, v_max_rows)
      ELSE format(
        'Không thể thêm %s dòng trong một lần vì %s (mỗi lần khoảng %s dòng). Vui lòng chọn ít data hơn rồi thêm nhiều lần, hoặc cập nhật phần mềm bản mới để tự chia nhỏ.',
        v_rows, v_reason, v_max_rows)
    END,
    DETAIL = jsonb_build_object(
      'code', 'data_group_ingest_too_large',
      'maxRows', v_max_rows,
      'rowMs', v_row_ms,
      'receivingCampaigns', v_campaigns,
      'rows', v_rows
    )::text;
END;
$function$;

COMMENT ON FUNCTION private.aka_agent_assert_data_group_ingest_budget(bigint, bigint, text, jsonb) IS
  'V483: chặn sớm lần nạp nhóm data chắc chắn vượt 60 giây (số dòng × (8 ms + số chiến dịch bật nhận data × 5 ms) > 75 giây): RAISE PT413 + DETAIL JSON maxRows/rowMs. Chỉ gọi từ 2 wrapper Desktop của aka_agent_ingest_data_group.';

REVOKE ALL ON FUNCTION private.aka_agent_assert_data_group_ingest_budget(bigint, bigint, text, jsonb)
  FROM PUBLIC, anon, authenticated, service_role, aka_agent_desktop, aka_agent_chat_api;

CREATE OR REPLACE FUNCTION public.aka_agent_ingest_data_group(p_staff_id bigint, p_organization_id bigint, p_request_id text, p_group_id bigint, p_kind text, p_rows jsonb, p_dataset_id bigint, p_dataset_name text, p_import_source text, p_source_account_id bigint, p_source_name text, p_payload_hash text, p_auth_username text, p_auth_password text)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET statement_timeout TO '60s'
AS $function$
  SELECT public.auto_assert_automation_identity(
    p_staff_id, p_organization_id, p_auth_username, p_auth_password
  );
  SELECT private.aka_agent_assert_data_group_ingest_budget(
    p_organization_id, p_group_id, p_kind, p_rows
  );
  SELECT * FROM public.aka_agent_ingest_data_group(p_staff_id, p_organization_id, p_request_id, p_group_id, p_kind, p_rows, p_dataset_id, p_dataset_name, p_import_source, p_source_account_id, p_source_name, p_payload_hash);
$function$;

CREATE OR REPLACE FUNCTION public.aka_agent_ingest_data_group(p_staff_id bigint, p_organization_id bigint, p_request_id text, p_group_id bigint, p_kind text, p_rows jsonb, p_dataset_id bigint, p_dataset_name text, p_import_source text, p_source_account_id bigint, p_source_name text, p_payload_hash text, p_data_type_category_item_id bigint, p_auth_username text, p_auth_password text)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET statement_timeout TO '60s'
AS $function$
  SELECT public.auto_assert_automation_identity(
    p_staff_id, p_organization_id, p_auth_username, p_auth_password
  );
  SELECT private.aka_agent_assert_data_group_ingest_budget(
    p_organization_id, p_group_id, p_kind, p_rows
  );
  SELECT public.aka_agent_ingest_data_group(
    p_staff_id,
    p_organization_id,
    p_request_id,
    p_group_id,
    p_kind,
    p_rows,
    p_dataset_id,
    p_dataset_name,
    p_import_source,
    p_source_account_id,
    p_source_name,
    p_payload_hash,
    p_data_type_category_item_id
  );
$function$;

DO $v483_postflight$
DECLARE
  v_fn record;
  v_state text;
  v_detail text;
  v_rows jsonb;
BEGIN
  FOR v_fn IN
    SELECT p.oid::regprocedure::text AS sig, md5(p.prosrc) AS src_md5, l.lanname, p.prosecdef,
           pg_get_userbyid(p.proowner) AS owner, p.proconfig::text AS config, p.proacl::text AS acl,
           CASE p.pronargs WHEN 14 THEN 'f324434527d755f005a9f2f3744643d0' ELSE '901b27e30590aa0f522bcf8b6a805bb7' END AS expected_md5
    FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
    WHERE p.oid IN (
      to_regprocedure('public.aka_agent_ingest_data_group(bigint,bigint,text,bigint,text,jsonb,bigint,text,text,bigint,text,text,text,text)'),
      to_regprocedure('public.aka_agent_ingest_data_group(bigint,bigint,text,bigint,text,jsonb,bigint,text,text,bigint,text,text,bigint,text,text)'))
  LOOP
    IF v_fn.src_md5 <> v_fn.expected_md5 OR v_fn.lanname <> 'sql' OR NOT v_fn.prosecdef OR v_fn.owner <> 'postgres'
       OR v_fn.config IS DISTINCT FROM '{"search_path=pg_catalog, public",statement_timeout=60s}'
       OR v_fn.acl IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,aka_agent_desktop=X/postgres}' THEN
      RAISE EXCEPTION 'v483: % not as expected after apply (md5 %, config %, acl %)', v_fn.sig, v_fn.src_md5, v_fn.config, v_fn.acl;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM unnest(ARRAY['anon', 'authenticated', 'service_role', 'aka_agent_desktop', 'aka_agent_chat_api']) AS r(role_name)
    WHERE has_function_privilege(r.role_name, 'private.aka_agent_assert_data_group_ingest_budget(bigint,bigint,text,jsonb)', 'EXECUTE')
  ) THEN
    RAISE EXCEPTION 'v483: guard function executable by an API role';
  END IF;

  -- Tự thử: nhóm không tồn tại (0 chiến dịch) ⇒ 8 ms/dòng; 9.000 dòng (72 giây) qua, 10.000 dòng (80 giây) bị chặn.
  SELECT jsonb_agg(jsonb_build_object('phone', i)) INTO v_rows FROM generate_series(1, 9000) AS i;
  PERFORM private.aka_agent_assert_data_group_ingest_budget(-1, -1, 'scan', v_rows);
  SELECT jsonb_agg(jsonb_build_object('phone', i)) INTO v_rows FROM generate_series(1, 10000) AS i;
  BEGIN
    PERFORM private.aka_agent_assert_data_group_ingest_budget(-1, -1, 'scan', v_rows);
    RAISE EXCEPTION 'v483: guard did not reject 10000 rows';
  EXCEPTION WHEN SQLSTATE 'PT413' THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_detail = PG_EXCEPTION_DETAIL;
    IF v_detail::jsonb ->> 'code' IS DISTINCT FROM 'data_group_ingest_too_large'
       OR (v_detail::jsonb ->> 'maxRows')::integer <> 5625 OR (v_detail::jsonb ->> 'rowMs')::numeric <> 8 THEN
      RAISE EXCEPTION 'v483: unexpected guard detail %', v_detail;
    END IF;
  END;
END
$v483_postflight$;

COMMIT;
