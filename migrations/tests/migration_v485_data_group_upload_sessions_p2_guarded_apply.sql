-- V485 p2: ÁP BẰNG SUPABASE SQL EDITOR, MỘT LẦN DÁN (bước 5/6).
-- Sinh bằng scripts/build-data-group-routing-guarded-apply-sql.py; đừng sửa tay. Production akachat (cgjbsmqtfhqvttudyjzq).
-- Thứ tự: V484 p1 -> V484 p2 -> V484 p3 -> V485 p1 -> V485 p2 -> V486 (V483 đã apply 09/11/2026 19:04:08 VN). Ngoài giờ cao điểm.
-- Một giao dịch: chốt sổ migration -> nguyên văn migrations/migration_v485_data_group_upload_sessions_p2.sql (md5 cbce2e84b411ebb6959b100c6aac0ef6, gồm kiểm tra trước/sau)
-- -> ghi sổ migration đúng nội dung file -> COMMIT. Kiểm nào không đạt thì báo lỗi và KHÔNG đổi gì trên production.
-- Thành công: bảng kết quả có status = 'applied' và md5_khop_file = true.
-- V485 phần 2/2: nhập file vào nhóm data theo nhiều phần (begin -> append x N -> finish), bỏ trần 10.000 dòng.
-- Production akachat (cgjbsmqtfhqvttudyjzq) only. Sinh bằng scripts/build-v485-sql.py, đừng sửa tay.
-- Apply SAU V483 và đủ 3 phần V484; đúng thứ tự p1 -> p2, mỗi phần một giao dịch. Phần sau kiểm phần trước và từ chối
-- chạy lại. Giữa hai phần app cũ chạy như cũ (hàm nạp chưa đổi; RPC phiên chưa dùng được vì hàm nạp chưa hiểu phiên).
-- Rollback: rollback_v485_data_group_upload_sessions.sql (chạy được cả khi mới apply p1).
-- Hợp đồng: docs/DATA_GROUP_ASYNC_ROUTING_V484.md mục V485. Kiểm thử: python3 scripts/data-group-routing/test_v485.py
--
-- p2: vá hàm nạp lõi để hiểu phiên nhập nhiều phần; kiểm tra cuối cả bộ V485.
BEGIN;
DO $aka_guarded_ledger_guard$
BEGIN
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name = 'migration_v485_data_group_upload_sessions_p2') THEN
    RAISE EXCEPTION 'migration_v485_data_group_upload_sessions_p2: đã có trong sổ migration, không chạy lại';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name = 'migration_v485_data_group_upload_sessions_p1') THEN
    RAISE EXCEPTION 'migration_v485_data_group_upload_sessions_p2: chưa thấy migration_v485_data_group_upload_sessions_p1 trong sổ migration; dán đúng thứ tự';
  END IF;
END
$aka_guarded_ledger_guard$;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '120s';

DO $v485_p2_preflight$
DECLARE
  v_md5 text;
BEGIN
  IF to_regclass('private.auto_data_group_upload_session_parts') IS NULL
     OR to_regprocedure('public.aka_agent_finish_data_group_upload(bigint,bigint,uuid)') IS NULL THEN
    RAISE EXCEPTION 'v485 p2: apply p1 first';
  END IF;
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public.aka_agent_ingest_data_group_v186_internal(bigint,bigint,text,bigint,text,jsonb,bigint,text,text,bigint,text,text)')));
  IF v_md5 IS DISTINCT FROM '0a0c9d1f870df7eac69ceaa20f6fb10a' THEN
    RAISE EXCEPTION 'v485 p2: ingest function already patched or drifted (md5 %)', v_md5;
  END IF;
END
$v485_p2_preflight$;

CREATE TEMP TABLE v485_ingest_acl ON COMMIT DROP AS
SELECT p.proacl::text AS acl, p.proconfig::text AS config, pg_get_userbyid(p.proowner) AS owner, p.prosecdef
FROM pg_proc AS p WHERE p.oid = to_regprocedure('public.aka_agent_ingest_data_group_v186_internal(bigint,bigint,text,bigint,text,jsonb,bigint,text,text,bigint,text,text)');

-- public.aka_agent_ingest_data_group_v186_internal(bigint,bigint,text,bigint,text,jsonb,bigint,text,text,bigint,text,text): md5 0a0c9d1f870df7eac69ceaa20f6fb10a -> dc8ccc8c8502ee0e463d911f71ee497e
CREATE OR REPLACE FUNCTION public.aka_agent_ingest_data_group_v186_internal(p_staff_id bigint, p_organization_id bigint, p_request_id text, p_group_id bigint, p_kind text, p_rows jsonb, p_dataset_id bigint DEFAULT NULL::bigint, p_dataset_name text DEFAULT NULL::text, p_import_source text DEFAULT NULL::text, p_source_account_id bigint DEFAULT NULL::bigint, p_source_name text DEFAULT NULL::text, p_payload_hash text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_group public.auto_account_contact_groups%ROWTYPE;
  v_batch public.auto_data_ingest_batches%ROWTYPE;
  v_dataset public.auto_account_contacts_dataset%ROWTYPE;
  v_source_account public.auto_accounts%ROWTYPE;
  v_contact public.auto_account_contacts%ROWTYPE;
  v_member public.auto_account_contact_group_members%ROWTYPE;
  v_row record;
  v_source record;
  v_raw_account_id text;
  v_raw_contact_id text;
  v_raw_automation_detail_id text;
  v_origin_automation_detail_id bigint;
  v_row_account_id bigint;
  v_contact_type text;
  v_platform text;
  v_name text;
  v_uid text;
  v_url text;
  v_phone text;
  v_email text;
  v_extra jsonb;
  v_dataset_contact_type text;
  v_dataset_platform text;
  v_dataset_source_key text;
  v_dataset_display_name text;
  v_duplicate_in_batch boolean := false;
  v_duplicate_conflict boolean := false;
  v_member_found boolean := false;
  v_batch_seen jsonb := '{}'::jsonb;
  v_first_payload jsonb;
  v_current_payload jsonb;
  v_request_hash text;
  v_revision bigint;
  v_revision_started boolean := false;
  v_inserted_members integer := 0;
  v_reactivated_members integer := 0;
  v_existing_members integer := 0;
  v_removed_members integer := 0;
  v_inserted_inputs integer := 0;
  v_existing_inputs integer := 0;
  v_incompatible integer := 0;
  v_conflict integer := 0;
  v_invalid integer := 0;
  v_conflicts jsonb := '[]'::jsonb;
  v_outcome jsonb;
  v_result jsonb;
  v_route_job_id bigint;
  -- V485: phần của một phiên nhập file nhiều phần (aka_agent_append_data_group_upload đặt 2 GUC này).
  v_upload_session_id uuid := NULLIF(current_setting('aka_agent.upload_session_id', true), '')::uuid;
  v_upload_row_offset integer := COALESCE(
    NULLIF(current_setting('aka_agent.upload_row_offset', true), '')::integer, 0
  );
  v_upload_part_batches bigint[] := '{}'::bigint[];
BEGIN
  PERFORM public.aka_agent_internal_require_staff_tenant(p_staff_id, p_organization_id);
  IF NULLIF(btrim(COALESCE(p_request_id, '')), '') IS NULL
    OR length(btrim(p_request_id)) > 500
    OR p_kind NOT IN ('manual', 'upload', 'scan', 'automation', 'api', 'external_sync')
    OR jsonb_typeof(COALESCE(p_rows, 'null'::jsonb)) <> 'array'
    OR jsonb_array_length(p_rows) > 10000
    OR (p_import_source IS NOT NULL AND p_import_source NOT IN ('textbox', 'image', 'sheet', 'excel'))
  THEN
    RAISE EXCEPTION 'invalid_data_group_ingest_payload';
  END IF;

  IF p_kind = 'external_sync' AND NOT EXISTS (
    SELECT 1 FROM public.auto_data_group_external_sync_runs r
    JOIN public.auto_data_group_external_sync_sources s ON s.id=r.source_id
    WHERE r.token::text=current_setting('aka_agent.sheet_sync_run_token',true)
      AND r.status='running' AND s.run_token=r.token AND s.revision=r.source_revision
      AND s.is_enabled AND NOT s.is_delete AND r.group_id=p_group_id
      AND r.staff_id=p_staff_id AND r.organization_id=p_organization_id
  ) THEN RAISE EXCEPTION 'sheet_sync_unclaimed'; END IF;

  SELECT * INTO v_group
  FROM public.auto_account_contact_groups AS contact_group
  WHERE contact_group.id = p_group_id
    AND contact_group.staff_id = p_staff_id
    AND contact_group.organization_id = p_organization_id
    AND contact_group.purpose = 'data_group'
    AND contact_group.is_delete = false
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'data_group_not_found'; END IF;

  IF p_source_account_id IS NOT NULL THEN
    SELECT * INTO v_source_account
    FROM public.auto_accounts AS account
    WHERE account.id = p_source_account_id
      AND account.staff_id = p_staff_id
      AND (account.organization_id IS NULL OR account.organization_id = p_organization_id);
    IF NOT FOUND THEN RAISE EXCEPTION 'data_group_source_account_not_found'; END IF;
  END IF;

  IF v_group.bound_zalo_account_id IS NOT NULL THEN
    IF NOT public.aka_agent_data_group_account_available(v_group.bound_zalo_account_id,p_staff_id,p_organization_id) THEN RAISE EXCEPTION 'data_group_bound_account_invalid'; END IF;
    IF (p_source_account_id IS NOT NULL AND p_source_account_id<>v_group.bound_zalo_account_id)
      OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_rows) r WHERE NULLIF(r->>'source_account_id','') IS NOT NULL AND r->>'source_account_id'<>v_group.bound_zalo_account_id::text)
      OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_rows) r LEFT JOIN public.auto_account_contacts c ON c.id::text=r->>'contact_id'
        WHERE NULLIF(r->>'contact_id','') IS NOT NULL AND (c.id IS NULL OR c.account_id IS DISTINCT FROM v_group.bound_zalo_account_id OR c.staff_id IS DISTINCT FROM p_staff_id OR c.organization_id IS DISTINCT FROM p_organization_id))
      OR (p_dataset_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.auto_account_contacts_dataset d WHERE d.id=p_dataset_id AND d.account_id IS DISTINCT FROM v_group.bound_zalo_account_id))
    THEN RAISE EXCEPTION 'data_group_bound_source_mismatch'; END IF;
  END IF;

  v_request_hash := md5(jsonb_build_object(
    'operation', 'ingest', 'groupId', p_group_id, 'kind', p_kind,
    'rows', p_rows, 'datasetId', p_dataset_id, 'datasetName', p_dataset_name,
    'importSource', p_import_source, 'sourceAccountId', p_source_account_id,
    'sourceName', p_source_name
  )::text);

  INSERT INTO public.auto_data_ingest_batches (
    request_id, operation, group_id, kind, dataset_id, source_account_id,
    source_name, client_payload_hash, request_hash, status,
    staff_id, organization_id
  ) VALUES (
    btrim(p_request_id), 'ingest', p_group_id, p_kind, p_dataset_id,
    p_source_account_id, NULLIF(btrim(COALESCE(p_source_name, '')), ''),
    NULLIF(btrim(COALESCE(p_payload_hash, '')), ''), v_request_hash, 'processing',
    p_staff_id, p_organization_id
  )
  ON CONFLICT (staff_id, organization_id, request_id) DO NOTHING
  RETURNING * INTO v_batch;

  IF NOT FOUND THEN
    SELECT * INTO v_batch
    FROM public.auto_data_ingest_batches AS batch
    WHERE batch.staff_id = p_staff_id
      AND batch.organization_id = p_organization_id
      AND batch.request_id = btrim(p_request_id)
    FOR UPDATE;
    IF v_batch.operation <> 'ingest' OR v_batch.group_id IS DISTINCT FROM p_group_id
      OR v_batch.request_hash <> v_request_hash THEN
      RAISE EXCEPTION 'data_group_request_id_conflict';
    END IF;
    IF v_batch.result IS NOT NULL THEN RETURN v_batch.result; END IF;
    RAISE EXCEPTION 'data_group_request_incomplete';
  END IF;

  IF v_upload_session_id IS NOT NULL THEN
    IF p_kind <> 'upload' OR p_dataset_id IS NULL THEN
      RAISE EXCEPTION 'invalid_data_group_ingest_payload';
    END IF;
    SELECT COALESCE(array_agg(part.batch_id), '{}'::bigint[]) INTO v_upload_part_batches
    FROM private.auto_data_group_upload_session_parts AS part
    WHERE part.session_id = v_upload_session_id;
  END IF;

  p_source_account_id := COALESCE(p_source_account_id,v_group.bound_zalo_account_id);
  IF p_source_account_id IS NOT NULL THEN SELECT * INTO v_source_account FROM public.auto_accounts WHERE id=p_source_account_id; END IF;
  IF p_kind = 'upload' THEN
    v_dataset_display_name := COALESCE(
      NULLIF(btrim(COALESCE(p_dataset_name, '')), ''),
      NULLIF(btrim(COALESCE(p_source_name, '')), ''),
      v_group.name
    );
    IF length(v_dataset_display_name) > 255 THEN
      RAISE EXCEPTION 'invalid_data_group_dataset_name';
    END IF;
    -- The explicit dataset name is the logical identity.  When absent, the
    -- source filename/name becomes that identity. A changed physical filename
    -- therefore still refreshes the same named dataset.
    v_dataset_source_key := 'upload:'
      || lower(regexp_replace(v_dataset_display_name, '[[:space:]]+', ' ', 'g'));

    WITH row_types AS (
      SELECT DISTINCT lower(btrim(item.value ->> 'contact_type')) AS value
      FROM jsonb_array_elements(p_rows) AS item(value)
      WHERE jsonb_typeof(item.value) = 'object'
        AND lower(btrim(COALESCE(item.value ->> 'contact_type', ''))) IN (
          'person', 'group', 'page', 'page_inbox_customer', 'zalo_tag',
          'phone', 'email', 'campaign_input'
        )
    )
    SELECT CASE WHEN count(*) = 1 THEN min(value) ELSE 'campaign_input' END
    INTO v_dataset_contact_type
    FROM row_types;

    WITH row_platforms AS (
      SELECT DISTINCT lower(btrim(COALESCE(
        NULLIF(item.value ->> 'flatform_type', ''),
        v_source_account.flatform_type,
        CASE WHEN lower(btrim(item.value ->> 'contact_type')) = 'email' THEN 'email' END,
        ''
      ))) AS value
      FROM jsonb_array_elements(p_rows) AS item(value)
      WHERE jsonb_typeof(item.value) = 'object'
    ), valid_platforms AS (
      SELECT value FROM row_platforms
      WHERE value IN ('facebook', 'zalo', 'email', 'sms')
    )
    SELECT CASE WHEN count(*) = 1 THEN min(value) ELSE 'mixed' END
    INTO v_dataset_platform
    FROM valid_platforms;
  END IF;

  IF p_dataset_id IS NOT NULL THEN
    SELECT * INTO v_dataset
    FROM public.auto_account_contacts_dataset AS dataset
    WHERE dataset.id = p_dataset_id
      AND dataset.staff_id = p_staff_id
      AND dataset.organization_id = p_organization_id
      AND dataset.is_delete = false;
    IF NOT FOUND THEN RAISE EXCEPTION 'data_group_dataset_not_found'; END IF;
    IF p_kind = 'upload' AND (
      v_dataset.source <> 'upload' OR v_dataset.group_id IS DISTINCT FROM v_group.id
    ) THEN
      RAISE EXCEPTION 'data_group_upload_dataset_mismatch';
    END IF;
    IF p_kind = 'upload' AND v_upload_session_id IS NULL THEN
      UPDATE public.auto_account_contacts_dataset_members
      SET is_current = false, updated_at = now()
      WHERE dataset_id = v_dataset.id AND is_current = true;
      UPDATE public.auto_account_contact_group_member_origins
      SET is_current = false, updated_at = now()
      WHERE dataset_id = v_dataset.id AND is_current = true;
    END IF;
  ELSIF p_kind = 'upload' THEN
    INSERT INTO public.auto_account_contacts_dataset (
      name, link, description, source, account_id, group_id, flatform_type,
      contact_type, scan_type, source_key, last_scanned_at, last_scan_status,
      extra_data, contact_count, is_delete, staff_id, organization_id
    ) VALUES (
      v_dataset_display_name,
      NULL, NULL, 'upload', p_source_account_id, v_group.id,
      COALESCE(v_dataset_platform, 'mixed'),
      COALESCE(v_dataset_contact_type, 'campaign_input'),
      'upload_data', v_dataset_source_key, now(), 'completed',
      jsonb_strip_nulls(jsonb_build_object(
        'importSource', p_import_source, 'requestId', btrim(p_request_id)
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

    -- Re-import refreshes one logical dataset snapshot. Historical batch and
    -- origin rows remain, but only incoming contacts are current afterward.
    UPDATE public.auto_account_contacts_dataset_members
    SET is_current = false, updated_at = now()
    WHERE dataset_id = v_dataset.id AND is_current = true;
    UPDATE public.auto_account_contact_group_member_origins
    SET is_current = false, updated_at = now()
    WHERE dataset_id = v_dataset.id AND is_current = true;

    UPDATE public.auto_data_ingest_batches
    SET dataset_id = v_dataset.id, updated_at = now()
    WHERE id = v_batch.id;
  END IF;

  -- V485: lượt nhập file một lần thay phiên nhập nhiều phần đang mở của cùng dataset.
  IF p_kind = 'upload' AND v_upload_session_id IS NULL AND v_dataset.id IS NOT NULL THEN
    UPDATE private.auto_data_group_upload_sessions
    SET status = 'superseded', updated_at = now()
    WHERE dataset_id = v_dataset.id AND status = 'open';
  END IF;

  FOR v_row IN
    SELECT item.value AS payload, item.ordinality::integer AS row_index
    FROM jsonb_array_elements(p_rows) WITH ORDINALITY AS item(value, ordinality)
  LOOP
    v_duplicate_in_batch := false;
    v_duplicate_conflict := false;
    v_member_found := false;
    v_origin_automation_detail_id := NULL;
    v_contact_type := NULL;
    v_platform := NULL;
    v_name := NULL;
    v_uid := NULL;
    v_url := NULL;
    v_phone := NULL;
    v_email := NULL;
    v_extra := '{}'::jsonb;
    IF jsonb_typeof(v_row.payload) <> 'object' THEN
      v_invalid := v_invalid + 1;
      CONTINUE;
    END IF;

    v_raw_account_id := NULLIF(btrim(COALESCE(v_row.payload ->> 'source_account_id', '')), '');
    IF v_raw_account_id IS NOT NULL AND v_raw_account_id !~ '^[1-9][0-9]{0,17}$' THEN
      v_invalid := v_invalid + 1;
      CONTINUE;
    END IF;
    v_row_account_id := COALESCE(
      CASE WHEN v_raw_account_id IS NULL THEN NULL ELSE v_raw_account_id::bigint END,
      p_source_account_id
    );
    v_contact := NULL;

    v_raw_contact_id := NULLIF(btrim(COALESCE(v_row.payload ->> 'contact_id', '')), '');
    IF v_raw_contact_id IS NOT NULL AND v_raw_contact_id !~ '^[1-9][0-9]{0,17}$' THEN
      v_invalid := v_invalid + 1;
      CONTINUE;
    END IF;
    IF v_raw_contact_id IS NOT NULL THEN
      SELECT * INTO v_contact
      FROM public.auto_account_contacts AS contact
      WHERE contact.id = v_raw_contact_id::bigint
        AND contact.staff_id = p_staff_id
        AND contact.organization_id = p_organization_id
      FOR UPDATE;
      IF NOT FOUND OR (
        v_row_account_id IS NOT NULL
        AND v_contact.account_id IS DISTINCT FROM v_row_account_id
      ) THEN
        v_invalid := v_invalid + 1;
        CONTINUE;
      END IF;
      v_row_account_id := COALESCE(v_row_account_id, v_contact.account_id);
      -- Selecting an existing source contact only changes group membership;
      -- it must never resurrect the source contact's own lifecycle flag.
      v_contact_type := lower(btrim(COALESCE(v_contact.contact_type, '')));
      v_platform := NULLIF(lower(btrim(COALESCE(v_contact.flatform_type, ''))), '');
      v_name := NULLIF(btrim(COALESCE(v_contact.name, '')), '');
      v_uid := NULLIF(btrim(COALESCE(v_contact.uid, '')), '');
      v_url := NULLIF(btrim(COALESCE(v_contact.url, '')), '');
      v_phone := NULLIF(public.aka_agent_internal_normalize_phone(COALESCE(
        NULLIF(v_contact.phone, ''), NULLIF(v_contact.extra_data ->> 'phone', ''),
        CASE WHEN v_contact.contact_type = 'phone' THEN v_contact.uid END, ''
      )), '');
      v_email := NULLIF(lower(btrim(COALESCE(
        NULLIF(v_contact.email, ''), NULLIF(v_contact.extra_data ->> 'email', ''),
        CASE WHEN v_contact.contact_type = 'email' THEN v_contact.uid END, ''
      ))), '');
      v_extra := COALESCE(v_contact.extra_data, '{}'::jsonb);
    ELSE
      v_contact_type := lower(btrim(COALESCE(v_row.payload ->> 'contact_type', '')));
      IF v_contact_type NOT IN (
        'person', 'group', 'page', 'page_inbox_customer', 'zalo_tag',
        'phone', 'email', 'campaign_input'
      ) THEN
        v_invalid := v_invalid + 1;
        CONTINUE;
      END IF;

      IF v_row_account_id IS NOT NULL THEN
        SELECT * INTO v_source_account
        FROM public.auto_accounts AS account
        WHERE account.id = v_row_account_id
          AND account.staff_id = p_staff_id
          AND (account.organization_id IS NULL OR account.organization_id = p_organization_id);
        IF NOT FOUND THEN
          v_invalid := v_invalid + 1;
          CONTINUE;
        END IF;
      ELSE
        v_source_account := NULL;
      END IF;

      v_platform := NULLIF(lower(btrim(COALESCE(
        NULLIF(v_row.payload ->> 'flatform_type', ''),
        v_source_account.flatform_type,
        CASE WHEN v_contact_type = 'email' THEN 'email' ELSE NULL END,
        ''
      ))), '');
      -- Accountless phone/email rows are deliberately platform-neutral.  A
      -- campaign decides portability from the validated value, not this label.
      IF (v_platform IS NULL AND v_contact_type NOT IN ('phone', 'email'))
        OR (v_platform IS NOT NULL AND v_platform NOT IN ('facebook', 'zalo', 'email', 'sms'))
      THEN
        v_invalid := v_invalid + 1;
        CONTINUE;
      END IF;

      v_phone := public.aka_agent_internal_normalize_phone(COALESCE(
        NULLIF(v_row.payload ->> 'phone', ''),
        CASE WHEN v_contact_type = 'phone' THEN v_row.payload ->> 'uid' ELSE NULL END,
        ''
      ));
      v_phone := NULLIF(v_phone, '');
      v_email := NULLIF(lower(btrim(COALESCE(
        NULLIF(v_row.payload ->> 'email', ''),
        CASE WHEN v_contact_type = 'email' THEN v_row.payload ->> 'uid' ELSE NULL END,
        ''
      ))), '');
      IF v_email IS NOT NULL AND (v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
          OR length(v_email) > 254) THEN
        v_email := NULL;
      END IF;
      v_url := NULLIF(btrim(COALESCE(v_row.payload ->> 'url', '')), '');
      v_uid := CASE v_contact_type
        WHEN 'phone' THEN v_phone
        WHEN 'email' THEN v_email
        ELSE COALESCE(
          NULLIF(btrim(COALESCE(v_row.payload ->> 'uid', '')), ''),
          v_url
        )
      END;
      IF v_uid IS NULL THEN
        v_invalid := v_invalid + 1;
        CONTINUE;
      END IF;
      v_name := COALESCE(NULLIF(btrim(COALESCE(v_row.payload ->> 'name', '')), ''), v_uid);
      v_extra := COALESCE(v_row.payload -> 'extra_data', '{}'::jsonb);
      IF jsonb_typeof(v_extra) <> 'object' THEN
        v_invalid := v_invalid + 1;
        CONTINUE;
      END IF;
      v_extra := v_extra || jsonb_strip_nulls(jsonb_build_object(
        'phone', v_phone,
        'email', v_email,
        'info1', NULLIF(v_row.payload ->> 'info1', ''),
        'info2', NULLIF(v_row.payload ->> 'info2', ''),
        'info3', NULLIF(v_row.payload ->> 'info3', ''),
        'info4', NULLIF(v_row.payload ->> 'info4', ''),
        'info5', NULLIF(v_row.payload ->> 'info5', '')
      ));

      IF v_row_account_id IS NULL THEN
        -- Accountless identity is intentionally NOT global. Reuse is allowed
        -- only inside the explicitly supplied dataset; otherwise each row gets
        -- its own canonical contact and campaign delivery dedupe happens later.
        IF v_dataset.id IS NOT NULL THEN
          SELECT contact.* INTO v_contact
          FROM public.auto_account_contacts_dataset_members AS dataset_member
          JOIN public.auto_account_contacts AS contact ON contact.id = dataset_member.contact_id
          WHERE dataset_member.dataset_id = v_dataset.id
            AND contact.account_id IS NULL
            AND contact.staff_id = p_staff_id
            AND contact.organization_id = p_organization_id
            AND contact.flatform_type IS NOT DISTINCT FROM v_platform
            AND contact.contact_type = v_contact_type
            AND contact.uid = v_uid
          ORDER BY dataset_member.created_at, contact.id
          LIMIT 1
          FOR UPDATE OF contact;
        END IF;
        IF v_contact.id IS NULL THEN
          INSERT INTO public.auto_account_contacts (
            account_id, flatform_type, contact_type, name, uid, url, phone, email,
            extra_data, is_delete, staff_id, organization_id, updated_at
          ) VALUES (
            NULL, v_platform, v_contact_type, v_name, v_uid, v_url, v_phone, v_email,
            v_extra, false, p_staff_id, p_organization_id, now()
          ) RETURNING * INTO v_contact;
        ELSE
          UPDATE public.auto_account_contacts AS contact
          SET name = CASE
                WHEN NULLIF(btrim(contact.name), '') IS NULL OR contact.name = contact.uid
                  THEN v_name ELSE contact.name END,
              url = COALESCE(contact.url, v_url),
              phone = COALESCE(contact.phone, v_phone),
              email = COALESCE(contact.email, v_email),
              -- Existing/earlier values win; this only fills absent keys.
              extra_data = v_extra || COALESCE(contact.extra_data, '{}'::jsonb),
              is_delete = false, updated_at = now()
          WHERE contact.id = v_contact.id
          RETURNING * INTO v_contact;
        END IF;
      ELSIF p_kind = 'external_sync' THEN
        -- Preserve every existing contact field, including lifecycle flags.
        INSERT INTO public.auto_account_contacts (
          account_id, flatform_type, contact_type, name, uid, url, phone, email,
          extra_data, is_delete, staff_id, organization_id, updated_at
        ) VALUES (
          v_row_account_id, v_platform, v_contact_type, v_name, v_uid, v_url, v_phone, v_email,
          v_extra, false, p_staff_id, p_organization_id, now()
        ) ON CONFLICT (account_id, contact_type, uid) DO NOTHING RETURNING * INTO v_contact;
        IF v_contact.id IS NULL THEN
          SELECT * INTO v_contact FROM public.auto_account_contacts
          WHERE account_id=v_row_account_id AND contact_type=v_contact_type AND uid=v_uid
            AND staff_id=p_staff_id AND organization_id=p_organization_id FOR UPDATE;
          IF NOT FOUND THEN RAISE EXCEPTION 'sheet_sync_contact_conflict'; END IF;
        END IF;
      ELSE
        INSERT INTO public.auto_account_contacts AS existing_contact (
          account_id, flatform_type, contact_type, name, uid, url, phone, email,
          extra_data, is_delete, staff_id, organization_id, updated_at
        ) VALUES (
          v_row_account_id, v_platform, v_contact_type, v_name, v_uid, v_url, v_phone, v_email,
          v_extra, false, p_staff_id, p_organization_id, now()
        )
        ON CONFLICT (account_id, contact_type, uid) DO UPDATE SET
          flatform_type = COALESCE(existing_contact.flatform_type, EXCLUDED.flatform_type),
          name = CASE
            WHEN NULLIF(btrim(existing_contact.name), '') IS NULL
              OR existing_contact.name = existing_contact.uid THEN EXCLUDED.name
            ELSE existing_contact.name END,
          url = COALESCE(existing_contact.url, EXCLUDED.url),
          phone = COALESCE(existing_contact.phone, EXCLUDED.phone),
          email = COALESCE(existing_contact.email, EXCLUDED.email),
          -- First persisted value wins; later duplicates only fill missing keys.
          extra_data = EXCLUDED.extra_data || COALESCE(existing_contact.extra_data, '{}'::jsonb),
          is_delete = false,
          staff_id = EXCLUDED.staff_id,
          organization_id = EXCLUDED.organization_id,
          updated_at = now()
        RETURNING * INTO v_contact;
      END IF;
    END IF;

    IF p_kind = 'external_sync' AND v_contact.is_delete THEN
      v_invalid := v_invalid + 1;
      CONTINUE;
    END IF;

    SELECT * INTO v_member
    FROM public.auto_account_contact_group_members AS member
    WHERE member.group_id = v_group.id AND member.contact_id = v_contact.id
    FOR UPDATE;
    v_member_found := FOUND;
    v_current_payload := jsonb_strip_nulls(jsonb_build_object(
      'name', NULLIF(btrim(COALESCE(v_row.payload ->> 'name', '')), ''),
      'uid', NULLIF(btrim(COALESCE(v_row.payload ->> 'uid', '')), ''),
      'url', NULLIF(btrim(COALESCE(v_row.payload ->> 'url', '')), ''),
      'phone', NULLIF(public.aka_agent_internal_normalize_phone(
        COALESCE(v_row.payload ->> 'phone', '')
      ), ''),
      'email', NULLIF(lower(btrim(COALESCE(v_row.payload ->> 'email', ''))), ''),
      'info1', NULLIF(v_row.payload ->> 'info1', ''),
      'info2', NULLIF(v_row.payload ->> 'info2', ''),
      'info3', NULLIF(v_row.payload ->> 'info3', ''),
      'info4', NULLIF(v_row.payload ->> 'info4', ''),
      'info5', NULLIF(v_row.payload ->> 'info5', ''),
      'extra_data', CASE WHEN jsonb_typeof(v_row.payload -> 'extra_data') = 'object'
        THEN v_row.payload -> 'extra_data' ELSE '{}'::jsonb END
    ));
    v_raw_automation_detail_id := NULLIF(btrim(COALESCE(
      v_row.payload -> 'extra_data' ->> 'automationDetailId',
      v_row.payload ->> 'automation_detail_id',
      ''
    )), '');
    IF p_kind = 'automation'
      AND v_raw_automation_detail_id ~ '^[1-9][0-9]{0,17}$'
    THEN
      SELECT detail.id INTO v_origin_automation_detail_id
      FROM public.auto_automation_detail AS detail
      WHERE detail.id = v_raw_automation_detail_id::bigint
        AND detail.staff_id = p_staff_id
        AND detail.organization_id = p_organization_id;
    END IF;
    v_duplicate_in_batch := v_batch_seen ? v_contact.id::text;

    IF v_duplicate_in_batch THEN
      v_first_payload := v_batch_seen -> v_contact.id::text;
      SELECT EXISTS (
        SELECT 1
        FROM jsonb_each(v_first_payload - 'extra_data') AS first_value(key, value)
        JOIN jsonb_each(v_current_payload - 'extra_data') AS current_value(key, value)
          USING (key)
        WHERE first_value.value IS DISTINCT FROM current_value.value
      ) OR EXISTS (
        SELECT 1
        FROM jsonb_each(COALESCE(v_first_payload -> 'extra_data', '{}'::jsonb))
          AS first_extra(key, value)
        JOIN jsonb_each(COALESCE(v_current_payload -> 'extra_data', '{}'::jsonb))
          AS current_extra(key, value)
          USING (key)
        WHERE first_extra.value IS DISTINCT FROM current_extra.value
      ) INTO v_duplicate_conflict;

      -- Extend the first-row snapshot only with fields it did not provide.
      v_first_payload := v_current_payload || v_first_payload;
      v_first_payload := jsonb_set(
        v_first_payload,
        '{extra_data}',
        COALESCE(v_current_payload -> 'extra_data', '{}'::jsonb)
          || COALESCE((v_batch_seen -> v_contact.id::text) -> 'extra_data', '{}'::jsonb),
        true
      );
      v_batch_seen := jsonb_set(
        v_batch_seen, ARRAY[v_contact.id::text], v_first_payload, true
      );
      IF v_duplicate_conflict THEN
        v_conflict := v_conflict + 1;
        v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
          'rowIndex', v_row.row_index - 1 + v_upload_row_offset,
          'code', 'duplicate_identity_conflict',
          'message', 'Dòng trùng định danh có giá trị khác; giữ giá trị của dòng đầu.',
          'contactId', v_contact.id
        ));
      END IF;
    ELSE
      v_batch_seen := jsonb_set(
        v_batch_seen, ARRAY[v_contact.id::text], v_current_payload, true
      );
    END IF;

    IF NOT v_revision_started THEN
      UPDATE public.auto_account_contact_groups
      SET revision = revision + 1, updated_at = now()
      WHERE id = v_group.id
      RETURNING revision INTO v_revision;
      v_revision_started := true;
    END IF;

    IF NOT v_member_found THEN
      INSERT INTO public.auto_account_contact_group_members (
        group_id, contact_id, is_delete, change_revision, created_at, updated_at
      ) VALUES (v_group.id, v_contact.id, false, v_revision, now(), now())
      RETURNING * INTO v_member;
      v_inserted_members := v_inserted_members + 1;
    ELSIF v_duplicate_in_batch THEN
      IF NOT v_duplicate_conflict THEN
        v_existing_members := v_existing_members + 1;
      END IF;
    ELSIF v_member.is_delete THEN
      UPDATE public.auto_account_contact_group_members
      SET is_delete = false, change_revision = v_revision, updated_at = now()
      WHERE id = v_member.id
      RETURNING * INTO v_member;
      v_reactivated_members := v_reactivated_members + 1;
    ELSE
      UPDATE public.auto_account_contact_group_members
      SET change_revision = v_revision, updated_at = now()
      WHERE id = v_member.id
      RETURNING * INTO v_member;
      v_existing_members := v_existing_members + 1;
    END IF;

    IF v_upload_session_id IS NULL OR NOT v_member_found OR NOT EXISTS (
      SELECT 1 FROM public.auto_account_contact_group_member_origins AS session_origin
      WHERE session_origin.membership_id = v_member.id
        AND session_origin.dataset_id = v_dataset.id
        AND session_origin.is_current = true
        AND session_origin.batch_id = ANY(v_upload_part_batches)
    ) THEN
    INSERT INTO public.auto_account_contact_group_member_origins (
      membership_id, kind, dataset_id, batch_id, source_account_id, automation_detail_id,
      source_name_snapshot, relationship_kind, is_current, created_at, updated_at
    ) VALUES (
      v_member.id, p_kind, v_dataset.id, v_batch.id,
      COALESCE(v_row_account_id, v_contact.account_id),
      v_origin_automation_detail_id,
      COALESCE(NULLIF(btrim(COALESCE(p_source_name, '')), ''), v_source_account.name),
      public.aka_agent_validate_data_group_relationship_kind(
        v_member.id,
        COALESCE(v_row_account_id, v_contact.account_id),
        v_dataset.id,
        CASE
          WHEN jsonb_typeof(v_row.payload -> 'extra_data') = 'object'
            THEN COALESCE(
              v_row.payload -> 'extra_data' ->> 'relationshipKind',
              v_row.payload -> 'extra_data' ->> 'relationship_kind'
            )
          ELSE NULL
        END,
        CASE
          WHEN jsonb_typeof(v_row.payload -> 'extra_data') = 'object'
            THEN v_row.payload -> 'extra_data'
          ELSE '{}'::jsonb
        END
      ),
      CASE
        WHEN v_dataset.id IS NOT NULL AND v_dataset.source = 'scan' THEN EXISTS (
          SELECT 1 FROM public.auto_account_contacts_dataset_members AS dataset_member
          WHERE dataset_member.dataset_id = v_dataset.id
            AND dataset_member.contact_id = v_contact.id
            AND dataset_member.is_current = true
        )
        ELSE true
      END,
      now(), now()
    )
    ON CONFLICT DO NOTHING;
    END IF;

    IF v_dataset.id IS NOT NULL AND v_dataset.source = 'upload' AND v_dataset.group_id = v_group.id THEN
      INSERT INTO public.auto_account_contacts_dataset_members (
        dataset_id, contact_id, sort_order, is_current,
        first_seen_at, last_seen_at, created_at, updated_at
      ) VALUES (
        v_dataset.id, v_contact.id, GREATEST(v_row.row_index - 1, 0) + v_upload_row_offset, true,
        now(), now(), now(), now()
      )
      ON CONFLICT (dataset_id, contact_id) DO UPDATE SET
        sort_order = LEAST(auto_account_contacts_dataset_members.sort_order, EXCLUDED.sort_order),
        is_current = true, last_seen_at = now(), updated_at = now();
    END IF;

    -- V484: chế độ 'async' của tổ chức ghi thành viên vào hàng đợi đẩy; 'sync' giữ nguyên vòng cũ.
    v_route_job_id := private.aka_agent_defer_data_group_member_route(
      v_group.id, v_member.id, v_batch.id, v_revision
    );
    IF v_route_job_id IS NULL THEN
    FOR v_source IN
      SELECT source.id
      FROM public.auto_campaign_data_group_sources AS source
      WHERE source.group_id = v_group.id AND source.status IN ('baselining', 'active')
      ORDER BY source.campaign_id
    LOOP
      v_outcome := public.aka_agent_internal_route_data_group_member(
        v_source.id, v_member.id, v_batch.id, v_revision
      );
      CASE v_outcome ->> 'status'
        WHEN 'inserted' THEN v_inserted_inputs := v_inserted_inputs + 1;
        WHEN 'existing' THEN v_existing_inputs := v_existing_inputs + 1;
        WHEN 'incompatible' THEN v_incompatible := v_incompatible + 1;
        WHEN 'conflict' THEN
          v_conflict := v_conflict + 1;
          v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
            'rowIndex', v_row.row_index - 1 + v_upload_row_offset,
            'code', 'canonical_alias_conflict',
            'message', 'Các định danh của dòng đang trỏ tới nhiều target khác nhau.',
            'aliases', COALESCE(v_outcome -> 'aliases', '[]'::jsonb)
          ));
        ELSE NULL;
      END CASE;
    END LOOP;
    END IF;
  END LOOP;

  IF v_dataset.id IS NOT NULL AND v_dataset.source = 'upload' AND v_dataset.group_id = v_group.id
     AND v_upload_session_id IS NULL THEN
    SELECT count(*)::integer INTO v_removed_members
    FROM public.auto_account_contact_group_members AS member
    WHERE member.group_id = v_group.id AND member.is_delete = false
      AND EXISTS (
        SELECT 1 FROM public.auto_account_contact_group_member_origins AS historical_origin
        WHERE historical_origin.membership_id = member.id
          AND historical_origin.dataset_id = v_dataset.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.auto_account_contact_group_member_origins AS current_origin
        WHERE current_origin.membership_id = member.id
          AND current_origin.is_current = true
      );
    IF v_removed_members > 0 THEN
      IF NOT v_revision_started THEN
        UPDATE public.auto_account_contact_groups
        SET revision = revision + 1, updated_at = now()
        WHERE id = v_group.id
        RETURNING revision INTO v_revision;
        v_revision_started := true;
      END IF;
      UPDATE public.auto_account_contact_group_members AS member
      SET is_delete = true, change_revision = v_revision, updated_at = now()
      WHERE member.group_id = v_group.id AND member.is_delete = false
        AND EXISTS (
          SELECT 1 FROM public.auto_account_contact_group_member_origins AS historical_origin
          WHERE historical_origin.membership_id = member.id
            AND historical_origin.dataset_id = v_dataset.id
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
      WHERE member.dataset_id = v_dataset.id AND member.is_current = true
    ), updated_at = now()
    WHERE dataset.id = v_dataset.id;
  END IF;
  IF NOT v_revision_started THEN v_revision := v_group.revision; END IF;

  v_result := jsonb_build_object(
    'request_id', btrim(p_request_id),
    'batch_id', v_batch.id,
    'group_id', v_group.id,
    'group_revision', v_revision,
    'inserted_membership_count', v_inserted_members,
    'reactivated_membership_count', v_reactivated_members,
    'already_member_count', v_existing_members,
    'removed_membership_count', v_removed_members,
    'inserted_input_count', v_inserted_inputs,
    'already_seen_input_count', v_existing_inputs,
    'incompatible_count', v_incompatible,
    'conflict_count', v_conflict,
    'invalid_count', v_invalid,
    'conflicts', v_conflicts
  );
  IF v_route_job_id IS NOT NULL THEN
    v_result := v_result || jsonb_build_object('routing_status', 'queued', 'routing_job_id', v_route_job_id);
  END IF;
  UPDATE public.auto_data_ingest_batches
  SET status = 'completed', result = v_result, updated_at = now()
  WHERE id = v_batch.id;
  RETURN v_result;
END;
$function$;

DO $v485_p2_postflight$
DECLARE
  v_role text;
  v_sig text;
BEGIN
  IF md5(pg_get_functiondef(to_regprocedure('public.aka_agent_ingest_data_group_v186_internal(bigint,bigint,text,bigint,text,jsonb,bigint,text,text,bigint,text,text)'))) IS DISTINCT FROM 'dc8ccc8c8502ee0e463d911f71ee497e' THEN
    RAISE EXCEPTION 'v485: ingest function not as expected after p2';
  END IF;
  IF EXISTS (
    SELECT 1 FROM v485_ingest_acl AS before
    JOIN pg_proc AS p ON p.oid = to_regprocedure('public.aka_agent_ingest_data_group_v186_internal(bigint,bigint,text,bigint,text,jsonb,bigint,text,text,bigint,text,text)')
    WHERE p.proacl::text IS DISTINCT FROM before.acl OR p.proconfig::text IS DISTINCT FROM before.config
       OR pg_get_userbyid(p.proowner) IS DISTINCT FROM before.owner OR p.prosecdef IS DISTINCT FROM before.prosecdef
  ) THEN
    RAISE EXCEPTION 'v485: privileges/config of the ingest function changed';
  END IF;
  IF (SELECT md5(p.prosrc) FROM pg_proc AS p WHERE p.oid = to_regprocedure('private.aka_agent_run_data_group_route_worker(integer)'))
     IS DISTINCT FROM 'dda4a682e5028469a1542e5c10efebd6' THEN
    RAISE EXCEPTION 'v485: route worker not as expected';
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
$v485_p2_postflight$;


-- ===== Ghi sổ migration (cùng giao dịch): statements[1] = nguyên văn migrations/migration_v485_data_group_upload_sessions_p2.sql =====
INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES (to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYYMMDDHH24MISS'), 'migration_v485_data_group_upload_sessions_p2', ARRAY[$aka_ledger_src_v485_data_group_upload_sessions_p2$-- V485 phần 2/2: nhập file vào nhóm data theo nhiều phần (begin -> append x N -> finish), bỏ trần 10.000 dòng.
-- Production akachat (cgjbsmqtfhqvttudyjzq) only. Sinh bằng scripts/build-v485-sql.py, đừng sửa tay.
-- Apply SAU V483 và đủ 3 phần V484; đúng thứ tự p1 -> p2, mỗi phần một giao dịch. Phần sau kiểm phần trước và từ chối
-- chạy lại. Giữa hai phần app cũ chạy như cũ (hàm nạp chưa đổi; RPC phiên chưa dùng được vì hàm nạp chưa hiểu phiên).
-- Rollback: rollback_v485_data_group_upload_sessions.sql (chạy được cả khi mới apply p1).
-- Hợp đồng: docs/DATA_GROUP_ASYNC_ROUTING_V484.md mục V485. Kiểm thử: python3 scripts/data-group-routing/test_v485.py
--
-- p2: vá hàm nạp lõi để hiểu phiên nhập nhiều phần; kiểm tra cuối cả bộ V485.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '120s';

DO $v485_p2_preflight$
DECLARE
  v_md5 text;
BEGIN
  IF to_regclass('private.auto_data_group_upload_session_parts') IS NULL
     OR to_regprocedure('public.aka_agent_finish_data_group_upload(bigint,bigint,uuid)') IS NULL THEN
    RAISE EXCEPTION 'v485 p2: apply p1 first';
  END IF;
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public.aka_agent_ingest_data_group_v186_internal(bigint,bigint,text,bigint,text,jsonb,bigint,text,text,bigint,text,text)')));
  IF v_md5 IS DISTINCT FROM '0a0c9d1f870df7eac69ceaa20f6fb10a' THEN
    RAISE EXCEPTION 'v485 p2: ingest function already patched or drifted (md5 %)', v_md5;
  END IF;
END
$v485_p2_preflight$;

CREATE TEMP TABLE v485_ingest_acl ON COMMIT DROP AS
SELECT p.proacl::text AS acl, p.proconfig::text AS config, pg_get_userbyid(p.proowner) AS owner, p.prosecdef
FROM pg_proc AS p WHERE p.oid = to_regprocedure('public.aka_agent_ingest_data_group_v186_internal(bigint,bigint,text,bigint,text,jsonb,bigint,text,text,bigint,text,text)');

-- public.aka_agent_ingest_data_group_v186_internal(bigint,bigint,text,bigint,text,jsonb,bigint,text,text,bigint,text,text): md5 0a0c9d1f870df7eac69ceaa20f6fb10a -> dc8ccc8c8502ee0e463d911f71ee497e
CREATE OR REPLACE FUNCTION public.aka_agent_ingest_data_group_v186_internal(p_staff_id bigint, p_organization_id bigint, p_request_id text, p_group_id bigint, p_kind text, p_rows jsonb, p_dataset_id bigint DEFAULT NULL::bigint, p_dataset_name text DEFAULT NULL::text, p_import_source text DEFAULT NULL::text, p_source_account_id bigint DEFAULT NULL::bigint, p_source_name text DEFAULT NULL::text, p_payload_hash text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_group public.auto_account_contact_groups%ROWTYPE;
  v_batch public.auto_data_ingest_batches%ROWTYPE;
  v_dataset public.auto_account_contacts_dataset%ROWTYPE;
  v_source_account public.auto_accounts%ROWTYPE;
  v_contact public.auto_account_contacts%ROWTYPE;
  v_member public.auto_account_contact_group_members%ROWTYPE;
  v_row record;
  v_source record;
  v_raw_account_id text;
  v_raw_contact_id text;
  v_raw_automation_detail_id text;
  v_origin_automation_detail_id bigint;
  v_row_account_id bigint;
  v_contact_type text;
  v_platform text;
  v_name text;
  v_uid text;
  v_url text;
  v_phone text;
  v_email text;
  v_extra jsonb;
  v_dataset_contact_type text;
  v_dataset_platform text;
  v_dataset_source_key text;
  v_dataset_display_name text;
  v_duplicate_in_batch boolean := false;
  v_duplicate_conflict boolean := false;
  v_member_found boolean := false;
  v_batch_seen jsonb := '{}'::jsonb;
  v_first_payload jsonb;
  v_current_payload jsonb;
  v_request_hash text;
  v_revision bigint;
  v_revision_started boolean := false;
  v_inserted_members integer := 0;
  v_reactivated_members integer := 0;
  v_existing_members integer := 0;
  v_removed_members integer := 0;
  v_inserted_inputs integer := 0;
  v_existing_inputs integer := 0;
  v_incompatible integer := 0;
  v_conflict integer := 0;
  v_invalid integer := 0;
  v_conflicts jsonb := '[]'::jsonb;
  v_outcome jsonb;
  v_result jsonb;
  v_route_job_id bigint;
  -- V485: phần của một phiên nhập file nhiều phần (aka_agent_append_data_group_upload đặt 2 GUC này).
  v_upload_session_id uuid := NULLIF(current_setting('aka_agent.upload_session_id', true), '')::uuid;
  v_upload_row_offset integer := COALESCE(
    NULLIF(current_setting('aka_agent.upload_row_offset', true), '')::integer, 0
  );
  v_upload_part_batches bigint[] := '{}'::bigint[];
BEGIN
  PERFORM public.aka_agent_internal_require_staff_tenant(p_staff_id, p_organization_id);
  IF NULLIF(btrim(COALESCE(p_request_id, '')), '') IS NULL
    OR length(btrim(p_request_id)) > 500
    OR p_kind NOT IN ('manual', 'upload', 'scan', 'automation', 'api', 'external_sync')
    OR jsonb_typeof(COALESCE(p_rows, 'null'::jsonb)) <> 'array'
    OR jsonb_array_length(p_rows) > 10000
    OR (p_import_source IS NOT NULL AND p_import_source NOT IN ('textbox', 'image', 'sheet', 'excel'))
  THEN
    RAISE EXCEPTION 'invalid_data_group_ingest_payload';
  END IF;

  IF p_kind = 'external_sync' AND NOT EXISTS (
    SELECT 1 FROM public.auto_data_group_external_sync_runs r
    JOIN public.auto_data_group_external_sync_sources s ON s.id=r.source_id
    WHERE r.token::text=current_setting('aka_agent.sheet_sync_run_token',true)
      AND r.status='running' AND s.run_token=r.token AND s.revision=r.source_revision
      AND s.is_enabled AND NOT s.is_delete AND r.group_id=p_group_id
      AND r.staff_id=p_staff_id AND r.organization_id=p_organization_id
  ) THEN RAISE EXCEPTION 'sheet_sync_unclaimed'; END IF;

  SELECT * INTO v_group
  FROM public.auto_account_contact_groups AS contact_group
  WHERE contact_group.id = p_group_id
    AND contact_group.staff_id = p_staff_id
    AND contact_group.organization_id = p_organization_id
    AND contact_group.purpose = 'data_group'
    AND contact_group.is_delete = false
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'data_group_not_found'; END IF;

  IF p_source_account_id IS NOT NULL THEN
    SELECT * INTO v_source_account
    FROM public.auto_accounts AS account
    WHERE account.id = p_source_account_id
      AND account.staff_id = p_staff_id
      AND (account.organization_id IS NULL OR account.organization_id = p_organization_id);
    IF NOT FOUND THEN RAISE EXCEPTION 'data_group_source_account_not_found'; END IF;
  END IF;

  IF v_group.bound_zalo_account_id IS NOT NULL THEN
    IF NOT public.aka_agent_data_group_account_available(v_group.bound_zalo_account_id,p_staff_id,p_organization_id) THEN RAISE EXCEPTION 'data_group_bound_account_invalid'; END IF;
    IF (p_source_account_id IS NOT NULL AND p_source_account_id<>v_group.bound_zalo_account_id)
      OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_rows) r WHERE NULLIF(r->>'source_account_id','') IS NOT NULL AND r->>'source_account_id'<>v_group.bound_zalo_account_id::text)
      OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_rows) r LEFT JOIN public.auto_account_contacts c ON c.id::text=r->>'contact_id'
        WHERE NULLIF(r->>'contact_id','') IS NOT NULL AND (c.id IS NULL OR c.account_id IS DISTINCT FROM v_group.bound_zalo_account_id OR c.staff_id IS DISTINCT FROM p_staff_id OR c.organization_id IS DISTINCT FROM p_organization_id))
      OR (p_dataset_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.auto_account_contacts_dataset d WHERE d.id=p_dataset_id AND d.account_id IS DISTINCT FROM v_group.bound_zalo_account_id))
    THEN RAISE EXCEPTION 'data_group_bound_source_mismatch'; END IF;
  END IF;

  v_request_hash := md5(jsonb_build_object(
    'operation', 'ingest', 'groupId', p_group_id, 'kind', p_kind,
    'rows', p_rows, 'datasetId', p_dataset_id, 'datasetName', p_dataset_name,
    'importSource', p_import_source, 'sourceAccountId', p_source_account_id,
    'sourceName', p_source_name
  )::text);

  INSERT INTO public.auto_data_ingest_batches (
    request_id, operation, group_id, kind, dataset_id, source_account_id,
    source_name, client_payload_hash, request_hash, status,
    staff_id, organization_id
  ) VALUES (
    btrim(p_request_id), 'ingest', p_group_id, p_kind, p_dataset_id,
    p_source_account_id, NULLIF(btrim(COALESCE(p_source_name, '')), ''),
    NULLIF(btrim(COALESCE(p_payload_hash, '')), ''), v_request_hash, 'processing',
    p_staff_id, p_organization_id
  )
  ON CONFLICT (staff_id, organization_id, request_id) DO NOTHING
  RETURNING * INTO v_batch;

  IF NOT FOUND THEN
    SELECT * INTO v_batch
    FROM public.auto_data_ingest_batches AS batch
    WHERE batch.staff_id = p_staff_id
      AND batch.organization_id = p_organization_id
      AND batch.request_id = btrim(p_request_id)
    FOR UPDATE;
    IF v_batch.operation <> 'ingest' OR v_batch.group_id IS DISTINCT FROM p_group_id
      OR v_batch.request_hash <> v_request_hash THEN
      RAISE EXCEPTION 'data_group_request_id_conflict';
    END IF;
    IF v_batch.result IS NOT NULL THEN RETURN v_batch.result; END IF;
    RAISE EXCEPTION 'data_group_request_incomplete';
  END IF;

  IF v_upload_session_id IS NOT NULL THEN
    IF p_kind <> 'upload' OR p_dataset_id IS NULL THEN
      RAISE EXCEPTION 'invalid_data_group_ingest_payload';
    END IF;
    SELECT COALESCE(array_agg(part.batch_id), '{}'::bigint[]) INTO v_upload_part_batches
    FROM private.auto_data_group_upload_session_parts AS part
    WHERE part.session_id = v_upload_session_id;
  END IF;

  p_source_account_id := COALESCE(p_source_account_id,v_group.bound_zalo_account_id);
  IF p_source_account_id IS NOT NULL THEN SELECT * INTO v_source_account FROM public.auto_accounts WHERE id=p_source_account_id; END IF;
  IF p_kind = 'upload' THEN
    v_dataset_display_name := COALESCE(
      NULLIF(btrim(COALESCE(p_dataset_name, '')), ''),
      NULLIF(btrim(COALESCE(p_source_name, '')), ''),
      v_group.name
    );
    IF length(v_dataset_display_name) > 255 THEN
      RAISE EXCEPTION 'invalid_data_group_dataset_name';
    END IF;
    -- The explicit dataset name is the logical identity.  When absent, the
    -- source filename/name becomes that identity. A changed physical filename
    -- therefore still refreshes the same named dataset.
    v_dataset_source_key := 'upload:'
      || lower(regexp_replace(v_dataset_display_name, '[[:space:]]+', ' ', 'g'));

    WITH row_types AS (
      SELECT DISTINCT lower(btrim(item.value ->> 'contact_type')) AS value
      FROM jsonb_array_elements(p_rows) AS item(value)
      WHERE jsonb_typeof(item.value) = 'object'
        AND lower(btrim(COALESCE(item.value ->> 'contact_type', ''))) IN (
          'person', 'group', 'page', 'page_inbox_customer', 'zalo_tag',
          'phone', 'email', 'campaign_input'
        )
    )
    SELECT CASE WHEN count(*) = 1 THEN min(value) ELSE 'campaign_input' END
    INTO v_dataset_contact_type
    FROM row_types;

    WITH row_platforms AS (
      SELECT DISTINCT lower(btrim(COALESCE(
        NULLIF(item.value ->> 'flatform_type', ''),
        v_source_account.flatform_type,
        CASE WHEN lower(btrim(item.value ->> 'contact_type')) = 'email' THEN 'email' END,
        ''
      ))) AS value
      FROM jsonb_array_elements(p_rows) AS item(value)
      WHERE jsonb_typeof(item.value) = 'object'
    ), valid_platforms AS (
      SELECT value FROM row_platforms
      WHERE value IN ('facebook', 'zalo', 'email', 'sms')
    )
    SELECT CASE WHEN count(*) = 1 THEN min(value) ELSE 'mixed' END
    INTO v_dataset_platform
    FROM valid_platforms;
  END IF;

  IF p_dataset_id IS NOT NULL THEN
    SELECT * INTO v_dataset
    FROM public.auto_account_contacts_dataset AS dataset
    WHERE dataset.id = p_dataset_id
      AND dataset.staff_id = p_staff_id
      AND dataset.organization_id = p_organization_id
      AND dataset.is_delete = false;
    IF NOT FOUND THEN RAISE EXCEPTION 'data_group_dataset_not_found'; END IF;
    IF p_kind = 'upload' AND (
      v_dataset.source <> 'upload' OR v_dataset.group_id IS DISTINCT FROM v_group.id
    ) THEN
      RAISE EXCEPTION 'data_group_upload_dataset_mismatch';
    END IF;
    IF p_kind = 'upload' AND v_upload_session_id IS NULL THEN
      UPDATE public.auto_account_contacts_dataset_members
      SET is_current = false, updated_at = now()
      WHERE dataset_id = v_dataset.id AND is_current = true;
      UPDATE public.auto_account_contact_group_member_origins
      SET is_current = false, updated_at = now()
      WHERE dataset_id = v_dataset.id AND is_current = true;
    END IF;
  ELSIF p_kind = 'upload' THEN
    INSERT INTO public.auto_account_contacts_dataset (
      name, link, description, source, account_id, group_id, flatform_type,
      contact_type, scan_type, source_key, last_scanned_at, last_scan_status,
      extra_data, contact_count, is_delete, staff_id, organization_id
    ) VALUES (
      v_dataset_display_name,
      NULL, NULL, 'upload', p_source_account_id, v_group.id,
      COALESCE(v_dataset_platform, 'mixed'),
      COALESCE(v_dataset_contact_type, 'campaign_input'),
      'upload_data', v_dataset_source_key, now(), 'completed',
      jsonb_strip_nulls(jsonb_build_object(
        'importSource', p_import_source, 'requestId', btrim(p_request_id)
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

    -- Re-import refreshes one logical dataset snapshot. Historical batch and
    -- origin rows remain, but only incoming contacts are current afterward.
    UPDATE public.auto_account_contacts_dataset_members
    SET is_current = false, updated_at = now()
    WHERE dataset_id = v_dataset.id AND is_current = true;
    UPDATE public.auto_account_contact_group_member_origins
    SET is_current = false, updated_at = now()
    WHERE dataset_id = v_dataset.id AND is_current = true;

    UPDATE public.auto_data_ingest_batches
    SET dataset_id = v_dataset.id, updated_at = now()
    WHERE id = v_batch.id;
  END IF;

  -- V485: lượt nhập file một lần thay phiên nhập nhiều phần đang mở của cùng dataset.
  IF p_kind = 'upload' AND v_upload_session_id IS NULL AND v_dataset.id IS NOT NULL THEN
    UPDATE private.auto_data_group_upload_sessions
    SET status = 'superseded', updated_at = now()
    WHERE dataset_id = v_dataset.id AND status = 'open';
  END IF;

  FOR v_row IN
    SELECT item.value AS payload, item.ordinality::integer AS row_index
    FROM jsonb_array_elements(p_rows) WITH ORDINALITY AS item(value, ordinality)
  LOOP
    v_duplicate_in_batch := false;
    v_duplicate_conflict := false;
    v_member_found := false;
    v_origin_automation_detail_id := NULL;
    v_contact_type := NULL;
    v_platform := NULL;
    v_name := NULL;
    v_uid := NULL;
    v_url := NULL;
    v_phone := NULL;
    v_email := NULL;
    v_extra := '{}'::jsonb;
    IF jsonb_typeof(v_row.payload) <> 'object' THEN
      v_invalid := v_invalid + 1;
      CONTINUE;
    END IF;

    v_raw_account_id := NULLIF(btrim(COALESCE(v_row.payload ->> 'source_account_id', '')), '');
    IF v_raw_account_id IS NOT NULL AND v_raw_account_id !~ '^[1-9][0-9]{0,17}$' THEN
      v_invalid := v_invalid + 1;
      CONTINUE;
    END IF;
    v_row_account_id := COALESCE(
      CASE WHEN v_raw_account_id IS NULL THEN NULL ELSE v_raw_account_id::bigint END,
      p_source_account_id
    );
    v_contact := NULL;

    v_raw_contact_id := NULLIF(btrim(COALESCE(v_row.payload ->> 'contact_id', '')), '');
    IF v_raw_contact_id IS NOT NULL AND v_raw_contact_id !~ '^[1-9][0-9]{0,17}$' THEN
      v_invalid := v_invalid + 1;
      CONTINUE;
    END IF;
    IF v_raw_contact_id IS NOT NULL THEN
      SELECT * INTO v_contact
      FROM public.auto_account_contacts AS contact
      WHERE contact.id = v_raw_contact_id::bigint
        AND contact.staff_id = p_staff_id
        AND contact.organization_id = p_organization_id
      FOR UPDATE;
      IF NOT FOUND OR (
        v_row_account_id IS NOT NULL
        AND v_contact.account_id IS DISTINCT FROM v_row_account_id
      ) THEN
        v_invalid := v_invalid + 1;
        CONTINUE;
      END IF;
      v_row_account_id := COALESCE(v_row_account_id, v_contact.account_id);
      -- Selecting an existing source contact only changes group membership;
      -- it must never resurrect the source contact's own lifecycle flag.
      v_contact_type := lower(btrim(COALESCE(v_contact.contact_type, '')));
      v_platform := NULLIF(lower(btrim(COALESCE(v_contact.flatform_type, ''))), '');
      v_name := NULLIF(btrim(COALESCE(v_contact.name, '')), '');
      v_uid := NULLIF(btrim(COALESCE(v_contact.uid, '')), '');
      v_url := NULLIF(btrim(COALESCE(v_contact.url, '')), '');
      v_phone := NULLIF(public.aka_agent_internal_normalize_phone(COALESCE(
        NULLIF(v_contact.phone, ''), NULLIF(v_contact.extra_data ->> 'phone', ''),
        CASE WHEN v_contact.contact_type = 'phone' THEN v_contact.uid END, ''
      )), '');
      v_email := NULLIF(lower(btrim(COALESCE(
        NULLIF(v_contact.email, ''), NULLIF(v_contact.extra_data ->> 'email', ''),
        CASE WHEN v_contact.contact_type = 'email' THEN v_contact.uid END, ''
      ))), '');
      v_extra := COALESCE(v_contact.extra_data, '{}'::jsonb);
    ELSE
      v_contact_type := lower(btrim(COALESCE(v_row.payload ->> 'contact_type', '')));
      IF v_contact_type NOT IN (
        'person', 'group', 'page', 'page_inbox_customer', 'zalo_tag',
        'phone', 'email', 'campaign_input'
      ) THEN
        v_invalid := v_invalid + 1;
        CONTINUE;
      END IF;

      IF v_row_account_id IS NOT NULL THEN
        SELECT * INTO v_source_account
        FROM public.auto_accounts AS account
        WHERE account.id = v_row_account_id
          AND account.staff_id = p_staff_id
          AND (account.organization_id IS NULL OR account.organization_id = p_organization_id);
        IF NOT FOUND THEN
          v_invalid := v_invalid + 1;
          CONTINUE;
        END IF;
      ELSE
        v_source_account := NULL;
      END IF;

      v_platform := NULLIF(lower(btrim(COALESCE(
        NULLIF(v_row.payload ->> 'flatform_type', ''),
        v_source_account.flatform_type,
        CASE WHEN v_contact_type = 'email' THEN 'email' ELSE NULL END,
        ''
      ))), '');
      -- Accountless phone/email rows are deliberately platform-neutral.  A
      -- campaign decides portability from the validated value, not this label.
      IF (v_platform IS NULL AND v_contact_type NOT IN ('phone', 'email'))
        OR (v_platform IS NOT NULL AND v_platform NOT IN ('facebook', 'zalo', 'email', 'sms'))
      THEN
        v_invalid := v_invalid + 1;
        CONTINUE;
      END IF;

      v_phone := public.aka_agent_internal_normalize_phone(COALESCE(
        NULLIF(v_row.payload ->> 'phone', ''),
        CASE WHEN v_contact_type = 'phone' THEN v_row.payload ->> 'uid' ELSE NULL END,
        ''
      ));
      v_phone := NULLIF(v_phone, '');
      v_email := NULLIF(lower(btrim(COALESCE(
        NULLIF(v_row.payload ->> 'email', ''),
        CASE WHEN v_contact_type = 'email' THEN v_row.payload ->> 'uid' ELSE NULL END,
        ''
      ))), '');
      IF v_email IS NOT NULL AND (v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
          OR length(v_email) > 254) THEN
        v_email := NULL;
      END IF;
      v_url := NULLIF(btrim(COALESCE(v_row.payload ->> 'url', '')), '');
      v_uid := CASE v_contact_type
        WHEN 'phone' THEN v_phone
        WHEN 'email' THEN v_email
        ELSE COALESCE(
          NULLIF(btrim(COALESCE(v_row.payload ->> 'uid', '')), ''),
          v_url
        )
      END;
      IF v_uid IS NULL THEN
        v_invalid := v_invalid + 1;
        CONTINUE;
      END IF;
      v_name := COALESCE(NULLIF(btrim(COALESCE(v_row.payload ->> 'name', '')), ''), v_uid);
      v_extra := COALESCE(v_row.payload -> 'extra_data', '{}'::jsonb);
      IF jsonb_typeof(v_extra) <> 'object' THEN
        v_invalid := v_invalid + 1;
        CONTINUE;
      END IF;
      v_extra := v_extra || jsonb_strip_nulls(jsonb_build_object(
        'phone', v_phone,
        'email', v_email,
        'info1', NULLIF(v_row.payload ->> 'info1', ''),
        'info2', NULLIF(v_row.payload ->> 'info2', ''),
        'info3', NULLIF(v_row.payload ->> 'info3', ''),
        'info4', NULLIF(v_row.payload ->> 'info4', ''),
        'info5', NULLIF(v_row.payload ->> 'info5', '')
      ));

      IF v_row_account_id IS NULL THEN
        -- Accountless identity is intentionally NOT global. Reuse is allowed
        -- only inside the explicitly supplied dataset; otherwise each row gets
        -- its own canonical contact and campaign delivery dedupe happens later.
        IF v_dataset.id IS NOT NULL THEN
          SELECT contact.* INTO v_contact
          FROM public.auto_account_contacts_dataset_members AS dataset_member
          JOIN public.auto_account_contacts AS contact ON contact.id = dataset_member.contact_id
          WHERE dataset_member.dataset_id = v_dataset.id
            AND contact.account_id IS NULL
            AND contact.staff_id = p_staff_id
            AND contact.organization_id = p_organization_id
            AND contact.flatform_type IS NOT DISTINCT FROM v_platform
            AND contact.contact_type = v_contact_type
            AND contact.uid = v_uid
          ORDER BY dataset_member.created_at, contact.id
          LIMIT 1
          FOR UPDATE OF contact;
        END IF;
        IF v_contact.id IS NULL THEN
          INSERT INTO public.auto_account_contacts (
            account_id, flatform_type, contact_type, name, uid, url, phone, email,
            extra_data, is_delete, staff_id, organization_id, updated_at
          ) VALUES (
            NULL, v_platform, v_contact_type, v_name, v_uid, v_url, v_phone, v_email,
            v_extra, false, p_staff_id, p_organization_id, now()
          ) RETURNING * INTO v_contact;
        ELSE
          UPDATE public.auto_account_contacts AS contact
          SET name = CASE
                WHEN NULLIF(btrim(contact.name), '') IS NULL OR contact.name = contact.uid
                  THEN v_name ELSE contact.name END,
              url = COALESCE(contact.url, v_url),
              phone = COALESCE(contact.phone, v_phone),
              email = COALESCE(contact.email, v_email),
              -- Existing/earlier values win; this only fills absent keys.
              extra_data = v_extra || COALESCE(contact.extra_data, '{}'::jsonb),
              is_delete = false, updated_at = now()
          WHERE contact.id = v_contact.id
          RETURNING * INTO v_contact;
        END IF;
      ELSIF p_kind = 'external_sync' THEN
        -- Preserve every existing contact field, including lifecycle flags.
        INSERT INTO public.auto_account_contacts (
          account_id, flatform_type, contact_type, name, uid, url, phone, email,
          extra_data, is_delete, staff_id, organization_id, updated_at
        ) VALUES (
          v_row_account_id, v_platform, v_contact_type, v_name, v_uid, v_url, v_phone, v_email,
          v_extra, false, p_staff_id, p_organization_id, now()
        ) ON CONFLICT (account_id, contact_type, uid) DO NOTHING RETURNING * INTO v_contact;
        IF v_contact.id IS NULL THEN
          SELECT * INTO v_contact FROM public.auto_account_contacts
          WHERE account_id=v_row_account_id AND contact_type=v_contact_type AND uid=v_uid
            AND staff_id=p_staff_id AND organization_id=p_organization_id FOR UPDATE;
          IF NOT FOUND THEN RAISE EXCEPTION 'sheet_sync_contact_conflict'; END IF;
        END IF;
      ELSE
        INSERT INTO public.auto_account_contacts AS existing_contact (
          account_id, flatform_type, contact_type, name, uid, url, phone, email,
          extra_data, is_delete, staff_id, organization_id, updated_at
        ) VALUES (
          v_row_account_id, v_platform, v_contact_type, v_name, v_uid, v_url, v_phone, v_email,
          v_extra, false, p_staff_id, p_organization_id, now()
        )
        ON CONFLICT (account_id, contact_type, uid) DO UPDATE SET
          flatform_type = COALESCE(existing_contact.flatform_type, EXCLUDED.flatform_type),
          name = CASE
            WHEN NULLIF(btrim(existing_contact.name), '') IS NULL
              OR existing_contact.name = existing_contact.uid THEN EXCLUDED.name
            ELSE existing_contact.name END,
          url = COALESCE(existing_contact.url, EXCLUDED.url),
          phone = COALESCE(existing_contact.phone, EXCLUDED.phone),
          email = COALESCE(existing_contact.email, EXCLUDED.email),
          -- First persisted value wins; later duplicates only fill missing keys.
          extra_data = EXCLUDED.extra_data || COALESCE(existing_contact.extra_data, '{}'::jsonb),
          is_delete = false,
          staff_id = EXCLUDED.staff_id,
          organization_id = EXCLUDED.organization_id,
          updated_at = now()
        RETURNING * INTO v_contact;
      END IF;
    END IF;

    IF p_kind = 'external_sync' AND v_contact.is_delete THEN
      v_invalid := v_invalid + 1;
      CONTINUE;
    END IF;

    SELECT * INTO v_member
    FROM public.auto_account_contact_group_members AS member
    WHERE member.group_id = v_group.id AND member.contact_id = v_contact.id
    FOR UPDATE;
    v_member_found := FOUND;
    v_current_payload := jsonb_strip_nulls(jsonb_build_object(
      'name', NULLIF(btrim(COALESCE(v_row.payload ->> 'name', '')), ''),
      'uid', NULLIF(btrim(COALESCE(v_row.payload ->> 'uid', '')), ''),
      'url', NULLIF(btrim(COALESCE(v_row.payload ->> 'url', '')), ''),
      'phone', NULLIF(public.aka_agent_internal_normalize_phone(
        COALESCE(v_row.payload ->> 'phone', '')
      ), ''),
      'email', NULLIF(lower(btrim(COALESCE(v_row.payload ->> 'email', ''))), ''),
      'info1', NULLIF(v_row.payload ->> 'info1', ''),
      'info2', NULLIF(v_row.payload ->> 'info2', ''),
      'info3', NULLIF(v_row.payload ->> 'info3', ''),
      'info4', NULLIF(v_row.payload ->> 'info4', ''),
      'info5', NULLIF(v_row.payload ->> 'info5', ''),
      'extra_data', CASE WHEN jsonb_typeof(v_row.payload -> 'extra_data') = 'object'
        THEN v_row.payload -> 'extra_data' ELSE '{}'::jsonb END
    ));
    v_raw_automation_detail_id := NULLIF(btrim(COALESCE(
      v_row.payload -> 'extra_data' ->> 'automationDetailId',
      v_row.payload ->> 'automation_detail_id',
      ''
    )), '');
    IF p_kind = 'automation'
      AND v_raw_automation_detail_id ~ '^[1-9][0-9]{0,17}$'
    THEN
      SELECT detail.id INTO v_origin_automation_detail_id
      FROM public.auto_automation_detail AS detail
      WHERE detail.id = v_raw_automation_detail_id::bigint
        AND detail.staff_id = p_staff_id
        AND detail.organization_id = p_organization_id;
    END IF;
    v_duplicate_in_batch := v_batch_seen ? v_contact.id::text;

    IF v_duplicate_in_batch THEN
      v_first_payload := v_batch_seen -> v_contact.id::text;
      SELECT EXISTS (
        SELECT 1
        FROM jsonb_each(v_first_payload - 'extra_data') AS first_value(key, value)
        JOIN jsonb_each(v_current_payload - 'extra_data') AS current_value(key, value)
          USING (key)
        WHERE first_value.value IS DISTINCT FROM current_value.value
      ) OR EXISTS (
        SELECT 1
        FROM jsonb_each(COALESCE(v_first_payload -> 'extra_data', '{}'::jsonb))
          AS first_extra(key, value)
        JOIN jsonb_each(COALESCE(v_current_payload -> 'extra_data', '{}'::jsonb))
          AS current_extra(key, value)
          USING (key)
        WHERE first_extra.value IS DISTINCT FROM current_extra.value
      ) INTO v_duplicate_conflict;

      -- Extend the first-row snapshot only with fields it did not provide.
      v_first_payload := v_current_payload || v_first_payload;
      v_first_payload := jsonb_set(
        v_first_payload,
        '{extra_data}',
        COALESCE(v_current_payload -> 'extra_data', '{}'::jsonb)
          || COALESCE((v_batch_seen -> v_contact.id::text) -> 'extra_data', '{}'::jsonb),
        true
      );
      v_batch_seen := jsonb_set(
        v_batch_seen, ARRAY[v_contact.id::text], v_first_payload, true
      );
      IF v_duplicate_conflict THEN
        v_conflict := v_conflict + 1;
        v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
          'rowIndex', v_row.row_index - 1 + v_upload_row_offset,
          'code', 'duplicate_identity_conflict',
          'message', 'Dòng trùng định danh có giá trị khác; giữ giá trị của dòng đầu.',
          'contactId', v_contact.id
        ));
      END IF;
    ELSE
      v_batch_seen := jsonb_set(
        v_batch_seen, ARRAY[v_contact.id::text], v_current_payload, true
      );
    END IF;

    IF NOT v_revision_started THEN
      UPDATE public.auto_account_contact_groups
      SET revision = revision + 1, updated_at = now()
      WHERE id = v_group.id
      RETURNING revision INTO v_revision;
      v_revision_started := true;
    END IF;

    IF NOT v_member_found THEN
      INSERT INTO public.auto_account_contact_group_members (
        group_id, contact_id, is_delete, change_revision, created_at, updated_at
      ) VALUES (v_group.id, v_contact.id, false, v_revision, now(), now())
      RETURNING * INTO v_member;
      v_inserted_members := v_inserted_members + 1;
    ELSIF v_duplicate_in_batch THEN
      IF NOT v_duplicate_conflict THEN
        v_existing_members := v_existing_members + 1;
      END IF;
    ELSIF v_member.is_delete THEN
      UPDATE public.auto_account_contact_group_members
      SET is_delete = false, change_revision = v_revision, updated_at = now()
      WHERE id = v_member.id
      RETURNING * INTO v_member;
      v_reactivated_members := v_reactivated_members + 1;
    ELSE
      UPDATE public.auto_account_contact_group_members
      SET change_revision = v_revision, updated_at = now()
      WHERE id = v_member.id
      RETURNING * INTO v_member;
      v_existing_members := v_existing_members + 1;
    END IF;

    IF v_upload_session_id IS NULL OR NOT v_member_found OR NOT EXISTS (
      SELECT 1 FROM public.auto_account_contact_group_member_origins AS session_origin
      WHERE session_origin.membership_id = v_member.id
        AND session_origin.dataset_id = v_dataset.id
        AND session_origin.is_current = true
        AND session_origin.batch_id = ANY(v_upload_part_batches)
    ) THEN
    INSERT INTO public.auto_account_contact_group_member_origins (
      membership_id, kind, dataset_id, batch_id, source_account_id, automation_detail_id,
      source_name_snapshot, relationship_kind, is_current, created_at, updated_at
    ) VALUES (
      v_member.id, p_kind, v_dataset.id, v_batch.id,
      COALESCE(v_row_account_id, v_contact.account_id),
      v_origin_automation_detail_id,
      COALESCE(NULLIF(btrim(COALESCE(p_source_name, '')), ''), v_source_account.name),
      public.aka_agent_validate_data_group_relationship_kind(
        v_member.id,
        COALESCE(v_row_account_id, v_contact.account_id),
        v_dataset.id,
        CASE
          WHEN jsonb_typeof(v_row.payload -> 'extra_data') = 'object'
            THEN COALESCE(
              v_row.payload -> 'extra_data' ->> 'relationshipKind',
              v_row.payload -> 'extra_data' ->> 'relationship_kind'
            )
          ELSE NULL
        END,
        CASE
          WHEN jsonb_typeof(v_row.payload -> 'extra_data') = 'object'
            THEN v_row.payload -> 'extra_data'
          ELSE '{}'::jsonb
        END
      ),
      CASE
        WHEN v_dataset.id IS NOT NULL AND v_dataset.source = 'scan' THEN EXISTS (
          SELECT 1 FROM public.auto_account_contacts_dataset_members AS dataset_member
          WHERE dataset_member.dataset_id = v_dataset.id
            AND dataset_member.contact_id = v_contact.id
            AND dataset_member.is_current = true
        )
        ELSE true
      END,
      now(), now()
    )
    ON CONFLICT DO NOTHING;
    END IF;

    IF v_dataset.id IS NOT NULL AND v_dataset.source = 'upload' AND v_dataset.group_id = v_group.id THEN
      INSERT INTO public.auto_account_contacts_dataset_members (
        dataset_id, contact_id, sort_order, is_current,
        first_seen_at, last_seen_at, created_at, updated_at
      ) VALUES (
        v_dataset.id, v_contact.id, GREATEST(v_row.row_index - 1, 0) + v_upload_row_offset, true,
        now(), now(), now(), now()
      )
      ON CONFLICT (dataset_id, contact_id) DO UPDATE SET
        sort_order = LEAST(auto_account_contacts_dataset_members.sort_order, EXCLUDED.sort_order),
        is_current = true, last_seen_at = now(), updated_at = now();
    END IF;

    -- V484: chế độ 'async' của tổ chức ghi thành viên vào hàng đợi đẩy; 'sync' giữ nguyên vòng cũ.
    v_route_job_id := private.aka_agent_defer_data_group_member_route(
      v_group.id, v_member.id, v_batch.id, v_revision
    );
    IF v_route_job_id IS NULL THEN
    FOR v_source IN
      SELECT source.id
      FROM public.auto_campaign_data_group_sources AS source
      WHERE source.group_id = v_group.id AND source.status IN ('baselining', 'active')
      ORDER BY source.campaign_id
    LOOP
      v_outcome := public.aka_agent_internal_route_data_group_member(
        v_source.id, v_member.id, v_batch.id, v_revision
      );
      CASE v_outcome ->> 'status'
        WHEN 'inserted' THEN v_inserted_inputs := v_inserted_inputs + 1;
        WHEN 'existing' THEN v_existing_inputs := v_existing_inputs + 1;
        WHEN 'incompatible' THEN v_incompatible := v_incompatible + 1;
        WHEN 'conflict' THEN
          v_conflict := v_conflict + 1;
          v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
            'rowIndex', v_row.row_index - 1 + v_upload_row_offset,
            'code', 'canonical_alias_conflict',
            'message', 'Các định danh của dòng đang trỏ tới nhiều target khác nhau.',
            'aliases', COALESCE(v_outcome -> 'aliases', '[]'::jsonb)
          ));
        ELSE NULL;
      END CASE;
    END LOOP;
    END IF;
  END LOOP;

  IF v_dataset.id IS NOT NULL AND v_dataset.source = 'upload' AND v_dataset.group_id = v_group.id
     AND v_upload_session_id IS NULL THEN
    SELECT count(*)::integer INTO v_removed_members
    FROM public.auto_account_contact_group_members AS member
    WHERE member.group_id = v_group.id AND member.is_delete = false
      AND EXISTS (
        SELECT 1 FROM public.auto_account_contact_group_member_origins AS historical_origin
        WHERE historical_origin.membership_id = member.id
          AND historical_origin.dataset_id = v_dataset.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.auto_account_contact_group_member_origins AS current_origin
        WHERE current_origin.membership_id = member.id
          AND current_origin.is_current = true
      );
    IF v_removed_members > 0 THEN
      IF NOT v_revision_started THEN
        UPDATE public.auto_account_contact_groups
        SET revision = revision + 1, updated_at = now()
        WHERE id = v_group.id
        RETURNING revision INTO v_revision;
        v_revision_started := true;
      END IF;
      UPDATE public.auto_account_contact_group_members AS member
      SET is_delete = true, change_revision = v_revision, updated_at = now()
      WHERE member.group_id = v_group.id AND member.is_delete = false
        AND EXISTS (
          SELECT 1 FROM public.auto_account_contact_group_member_origins AS historical_origin
          WHERE historical_origin.membership_id = member.id
            AND historical_origin.dataset_id = v_dataset.id
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
      WHERE member.dataset_id = v_dataset.id AND member.is_current = true
    ), updated_at = now()
    WHERE dataset.id = v_dataset.id;
  END IF;
  IF NOT v_revision_started THEN v_revision := v_group.revision; END IF;

  v_result := jsonb_build_object(
    'request_id', btrim(p_request_id),
    'batch_id', v_batch.id,
    'group_id', v_group.id,
    'group_revision', v_revision,
    'inserted_membership_count', v_inserted_members,
    'reactivated_membership_count', v_reactivated_members,
    'already_member_count', v_existing_members,
    'removed_membership_count', v_removed_members,
    'inserted_input_count', v_inserted_inputs,
    'already_seen_input_count', v_existing_inputs,
    'incompatible_count', v_incompatible,
    'conflict_count', v_conflict,
    'invalid_count', v_invalid,
    'conflicts', v_conflicts
  );
  IF v_route_job_id IS NOT NULL THEN
    v_result := v_result || jsonb_build_object('routing_status', 'queued', 'routing_job_id', v_route_job_id);
  END IF;
  UPDATE public.auto_data_ingest_batches
  SET status = 'completed', result = v_result, updated_at = now()
  WHERE id = v_batch.id;
  RETURN v_result;
END;
$function$;

DO $v485_p2_postflight$
DECLARE
  v_role text;
  v_sig text;
BEGIN
  IF md5(pg_get_functiondef(to_regprocedure('public.aka_agent_ingest_data_group_v186_internal(bigint,bigint,text,bigint,text,jsonb,bigint,text,text,bigint,text,text)'))) IS DISTINCT FROM 'dc8ccc8c8502ee0e463d911f71ee497e' THEN
    RAISE EXCEPTION 'v485: ingest function not as expected after p2';
  END IF;
  IF EXISTS (
    SELECT 1 FROM v485_ingest_acl AS before
    JOIN pg_proc AS p ON p.oid = to_regprocedure('public.aka_agent_ingest_data_group_v186_internal(bigint,bigint,text,bigint,text,jsonb,bigint,text,text,bigint,text,text)')
    WHERE p.proacl::text IS DISTINCT FROM before.acl OR p.proconfig::text IS DISTINCT FROM before.config
       OR pg_get_userbyid(p.proowner) IS DISTINCT FROM before.owner OR p.prosecdef IS DISTINCT FROM before.prosecdef
  ) THEN
    RAISE EXCEPTION 'v485: privileges/config of the ingest function changed';
  END IF;
  IF (SELECT md5(p.prosrc) FROM pg_proc AS p WHERE p.oid = to_regprocedure('private.aka_agent_run_data_group_route_worker(integer)'))
     IS DISTINCT FROM 'dda4a682e5028469a1542e5c10efebd6' THEN
    RAISE EXCEPTION 'v485: route worker not as expected';
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
$v485_p2_postflight$;

COMMIT;
$aka_ledger_src_v485_data_group_upload_sessions_p2$]);

DO $aka_guarded_ledger_check$
BEGIN
  IF (SELECT md5(statements[1]) FROM supabase_migrations.schema_migrations WHERE name = 'migration_v485_data_group_upload_sessions_p2')
     IS DISTINCT FROM 'cbce2e84b411ebb6959b100c6aac0ef6' THEN
    RAISE EXCEPTION 'migration_v485_data_group_upload_sessions_p2: md5 sổ migration không khớp file';
  END IF;
END
$aka_guarded_ledger_check$;

COMMIT;

SELECT 'applied' AS status, version, name, md5(statements[1]) AS ledger_md5,
       md5(statements[1]) = 'cbce2e84b411ebb6959b100c6aac0ef6' AS md5_khop_file,
       to_char((make_timestamp(substr(version, 1, 4)::int, substr(version, 5, 2)::int, substr(version, 7, 2)::int,
                               substr(version, 9, 2)::int, substr(version, 11, 2)::int, substr(version, 13, 2)::numeric)
                AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Ho_Chi_Minh', 'DD/MM/YYYY HH24:MI:SS') AS gio_vn
FROM supabase_migrations.schema_migrations
WHERE name = 'migration_v485_data_group_upload_sessions_p2';
