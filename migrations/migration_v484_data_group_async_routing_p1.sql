-- V484 phần 1/3: đẩy data nhóm vào chiến dịch chạy nền (hàng đợi + worker pg_cron), bật theo tổ chức.
-- Production akachat (cgjbsmqtfhqvttudyjzq) only. Sinh bằng scripts/build-v484-sql.py, đừng sửa tay.
-- Apply đúng thứ tự p1 -> p2 -> p3, mỗi phần một giao dịch (cả bộ ~135 KB vượt sức một lần gửi của công cụ apply).
-- Phần sau kiểm phần trước đã xong và từ chối chạy lại. Giữa các phần hệ thống vẫn chạy như cũ (công tắc 'sync').
-- Rollback: rollback_v484_data_group_async_routing_p1.sql rồi _p2.sql (chạy được cả khi mới apply một phần).
-- Hợp đồng, cách bật/tắt: docs/DATA_GROUP_ASYNC_ROUTING_V484.md. Kiểm thử: python3 scripts/data-group-routing/test_v484.py
--
-- Vì sao: lượt nạp nhóm data đẩy từng dòng vào từng chiến dịch đang bật "nhận data mới từ nhóm" trong giao dịch của
-- người dùng (trần 60 giây) và giữ khoá advisory + FOR UPDATE của mọi chiến dịch đó tới hết giao dịch.
--
-- Cả bộ V484:
--   p1 bảng private.auto_data_group_route_jobs (+ _job_members, RLS bật, không cấp role API), dòng
--      auto_system_settings 'data_groups.routing_mode' = {"mode":"sync","organizationIds":[],"workerBudgetMs":4000},
--      7 hàm private (đọc công tắc, ghi việc, worker). Chưa hàm cũ nào gọi tới.
--   p2 vá nạp nhóm (aka_agent_ingest_data_group_v186_internal) và gắn chiến dịch (bind, cả bundle).
--   p3 vá bật lại công tắc, chuyển data, 2 hàm đồng bộ nhóm tự động, sao chép nhóm chia sẻ, guard V483; lên lịch
--      pg_cron 'aka-agent-data-group-route-worker' 10 giây/lần; kiểm tra cuối toàn bộ.
-- Mỗi chỗ vá chỉ thêm nhánh: tổ chức ở 'async' thì ghi thành viên (hoặc cả nhóm cho bind/reactivate) vào hàng đợi thay
-- vì gọi aka_agent_internal_route_data_group_member ngay; vòng cũ giữ nguyên từng byte trong nhánh còn lại.
-- Worker: một runner, mỗi lượt <= workerBudgetMs (mặc định 4 s) và <= 32 đoạn; mỗi đoạn = 1 chiến dịch x <= 100
-- thành viên, gọi đúng hàm đẩy hiện có; chiến dịch đang chạy/chờ xử lý trước, tạm dừng sau; xoay vòng giữa các việc;
-- lock_timeout 2 s; khoá bận/deadlock thử lại sau 5 s, lỗi khác thu nhỏ đoạn rồi bỏ đúng một cặp sau 3 lần.
--
-- Preflight kiểm md5 pg_get_functiondef của 7 hàm (chụp live 27/10/2026, không migration nào sửa sau đó) và md5 thân
-- guard V483; lệch là dừng. Apply SAU V483, ngoài giờ cao điểm (DDL làm PostgREST nạp lại schema).
-- Bật thử: UPDATE public.auto_system_settings SET value = '{"mode":"async","organizationIds":[<org>],"workerBudgetMs":4000}',
--   updated_at = now() WHERE key = 'data_groups.routing_mode';  Tắt nhanh (không DDL): đặt lại "mode":"sync".

BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '120s';

DO $v484_p1_preflight$
DECLARE
  v_item record;
  v_md5 text;
BEGIN
  IF to_regclass('private.auto_data_group_route_jobs') IS NOT NULL
     OR to_regprocedure('private.aka_agent_run_data_group_route_worker(integer)') IS NOT NULL THEN
    RAISE EXCEPTION 'v484: already applied (p1 objects exist)';
  END IF;
  IF to_regprocedure('private.aka_agent_assert_data_group_ingest_budget(bigint,bigint,text,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'v484: apply V483 first (private.aka_agent_assert_data_group_ingest_budget missing)';
  END IF;
  SELECT md5(p.prosrc) INTO v_md5 FROM pg_proc AS p WHERE p.oid = to_regprocedure('private.aka_agent_assert_data_group_ingest_budget(bigint,bigint,text,jsonb)');
  IF v_md5 IS DISTINCT FROM 'ff99a8564bb1ce517675419f03967eeb' THEN
    RAISE EXCEPTION 'v484: V483 guard drifted (prosrc md5 %); re-read live definition', v_md5;
  END IF;
  FOR v_item IN SELECT key AS sig, value AS expected FROM jsonb_each_text('{"public.aka_agent_ingest_data_group_v186_internal(bigint,bigint,text,bigint,text,jsonb,bigint,text,text,bigint,text,text)": "70abe6e3db930718a6472ce270b29b7a", "public.aka_agent_bind_campaign_data_group_source(bigint,bigint,text,bigint,bigint,bigint)": "bf41a97876e47339e87545914e01bc1e", "public.aka_agent_reactivate_campaign_data_group_source(bigint,bigint,bigint,text,text)": "9f4db1d1c78dfe0e1b00e37678e5852e", "public.aka_agent_move_data_group_members(bigint,bigint,text,bigint,bigint[],bigint)": "2a9b66655b905f56e44fe492096520bc", "public.aka_agent_internal_sync_dataset_auto_group_member(bigint,bigint,boolean)": "9215d6543aa1bb2627676f280465b8fa", "public.aka_agent_sync_scan_dataset_group_origins()": "5164ca868e763bfabd830e2114deeff9", "private.copy_shared_group(bigint,bigint,text,bigint,jsonb)": "9b310ca079d192f4e809b9cf09d28740"}'::jsonb) LOOP
    IF to_regprocedure(v_item.sig) IS NULL THEN
      RAISE EXCEPTION 'v484: % missing', v_item.sig;
    END IF;
    v_md5 := md5(pg_get_functiondef(to_regprocedure(v_item.sig)));
    IF v_md5 IS DISTINCT FROM v_item.expected THEN
      RAISE EXCEPTION 'v484 preflight: % drifted; re-read live definition (md5 %, expected %)', v_item.sig, v_md5, v_item.expected;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM public.auto_system_settings WHERE key = 'data_groups.routing_mode') THEN
    RAISE EXCEPTION 'v484: auto_system_settings data_groups.routing_mode already exists';
  END IF;
  IF to_regnamespace('cron') IS NULL THEN
    RAISE EXCEPTION 'v484: pg_cron missing';
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'aka-agent-data-group-route-worker') THEN
    RAISE EXCEPTION 'v484: cron job aka-agent-data-group-route-worker already exists';
  END IF;
END
$v484_p1_preflight$;

-- ===================================================================================================================
-- Đối tượng mới của V484 (ghép vào migration bởi scripts/build-v484-sql.py)
-- ===================================================================================================================

-- Việc đẩy data nhóm vào chiến dịch đang chờ worker.
--   kind 'members': thành viên trong private.auto_data_group_route_job_members, đẩy vào mọi nguồn đang nhận data của
--                   nhóm (chụp danh sách nguồn lúc bắt đầu, chiến dịch đang chạy/chờ xử lý trước, tạm dừng sau).
--   kind 'baseline': toàn bộ thành viên đang có của nhóm, đẩy vào đúng một nguồn (gắn chiến dịch, bật lại công tắc).
CREATE TABLE private.auto_data_group_route_jobs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind text NOT NULL,
  group_id bigint NOT NULL,
  source_id bigint,
  batch_id bigint,
  group_revision bigint,
  staff_id bigint NOT NULL,
  organization_id bigint NOT NULL,
  apply_baseline_note boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'pending',
  source_ids bigint[],
  source_pos integer NOT NULL DEFAULT 1,
  member_cursor bigint NOT NULL DEFAULT 0,
  slice_size integer NOT NULL DEFAULT 100,
  attempts integer NOT NULL DEFAULT 0,
  inserted_count integer NOT NULL DEFAULT 0,
  existing_count integer NOT NULL DEFAULT 0,
  incompatible_count integer NOT NULL DEFAULT 0,
  conflict_count integer NOT NULL DEFAULT 0,
  no_intake_count integer NOT NULL DEFAULT 0,
  skipped_source_count integer NOT NULL DEFAULT 0,
  error_count integer NOT NULL DEFAULT 0,
  conflicts jsonb NOT NULL DEFAULT '[]'::jsonb,
  errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  last_error text,
  next_attempt_at timestamptz,
  last_worked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auto_data_group_route_jobs_kind_check CHECK (kind IN ('members', 'baseline')),
  CONSTRAINT auto_data_group_route_jobs_status_check CHECK (status IN ('pending', 'running', 'done', 'failed')),
  CONSTRAINT auto_data_group_route_jobs_baseline_source_check CHECK (kind <> 'baseline' OR source_id IS NOT NULL),
  CONSTRAINT auto_data_group_route_jobs_slice_check CHECK (slice_size BETWEEN 1 AND 500)
);
CREATE INDEX idx_auto_data_group_route_jobs_due
  ON private.auto_data_group_route_jobs (last_worked_at NULLS FIRST, id)
  WHERE status IN ('pending', 'running');
CREATE INDEX idx_auto_data_group_route_jobs_finished
  ON private.auto_data_group_route_jobs (finished_at)
  WHERE status IN ('done', 'failed');
CREATE INDEX idx_auto_data_group_route_jobs_batch
  ON private.auto_data_group_route_jobs (batch_id)
  WHERE batch_id IS NOT NULL;

CREATE TABLE private.auto_data_group_route_job_members (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_id bigint NOT NULL REFERENCES private.auto_data_group_route_jobs(id) ON DELETE CASCADE,
  membership_id bigint NOT NULL,
  CONSTRAINT uq_auto_data_group_route_job_members UNIQUE (job_id, membership_id)
);
CREATE INDEX idx_auto_data_group_route_job_members_cursor
  ON private.auto_data_group_route_job_members (job_id, id);

ALTER TABLE private.auto_data_group_route_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.auto_data_group_route_job_members ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.auto_data_group_route_jobs, private.auto_data_group_route_job_members
  FROM PUBLIC, anon, authenticated, service_role, aka_agent_desktop, aka_agent_chat_api;

INSERT INTO public.auto_system_settings (key, value, description, is_secret, is_active)
VALUES (
  'data_groups.routing_mode',
  '{"mode":"sync","organizationIds":[],"workerBudgetMs":4000}',
  'V484: đẩy data nhóm vào chiến dịch. "sync" = đẩy ngay trong lượt nạp như cũ; "async" = ghi hàng đợi, worker '
    || 'pg_cron đẩy nền cho các tổ chức trong organizationIds (null = mọi tổ chức). workerBudgetMs: ngân sách mỗi '
    || 'lượt worker 200-20000 ms.',
  false,
  true
);

CREATE FUNCTION private.aka_agent_data_group_routing_settings()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  -- Không dùng EXCEPTION (mỗi khối là một subtransaction): JSON hỏng thì coi như 'sync'.
  SELECT COALESCE((
    SELECT CASE WHEN pg_input_is_valid(setting.value, 'jsonb') THEN
             CASE WHEN jsonb_typeof(setting.value::jsonb) = 'object' THEN setting.value::jsonb END
           END
    FROM public.auto_system_settings AS setting
    WHERE setting.key = 'data_groups.routing_mode'
      AND setting.is_active = true
    LIMIT 1
  ), '{"mode":"sync"}'::jsonb);
$function$;

CREATE FUNCTION private.aka_agent_data_group_route_async(p_organization_id bigint)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT CASE
    WHEN p_organization_id IS NULL THEN false
    WHEN settings.value ->> 'mode' IS DISTINCT FROM 'async' THEN false
    WHEN settings.value -> 'organizationIds' IS NULL
      OR jsonb_typeof(settings.value -> 'organizationIds') = 'null' THEN true
    WHEN jsonb_typeof(settings.value -> 'organizationIds') = 'array'
      THEN settings.value -> 'organizationIds' @> to_jsonb(p_organization_id)
    ELSE false
  END
  FROM (SELECT private.aka_agent_data_group_routing_settings() AS value) AS settings;
$function$;

-- Gọi ở mọi chỗ trước đây lặp "từng nguồn đang nhận data -> aka_agent_internal_route_data_group_member".
-- NULL: tổ chức ở 'sync' (hoặc nhóm không có nguồn nào), nơi gọi chạy vòng cũ. Khác NULL: đã ghi vào việc của giao dịch
-- này (mỗi giao dịch, nhóm, batch, revision một việc; nhớ bằng GUC cục bộ giao dịch).
CREATE FUNCTION private.aka_agent_defer_data_group_member_route(
  p_group_id bigint, p_membership_id bigint, p_batch_id bigint, p_group_revision bigint
)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_key text;
  v_cached text;
  v_tag text := COALESCE(p_batch_id::text, '') || ':' || COALESCE(p_group_revision::text, '');
  v_job_id bigint;
  v_group record;
BEGIN
  IF p_group_id IS NULL OR p_membership_id IS NULL THEN
    RETURN NULL;
  END IF;
  v_key := 'aka_agent.dg_route_' || p_group_id::text;
  v_cached := NULLIF(current_setting(v_key, true), '');
  IF v_cached = 'sync' THEN
    RETURN NULL;
  ELSIF v_cached IS NOT NULL AND split_part(v_cached, '@', 2) = v_tag THEN
    v_job_id := split_part(v_cached, '@', 1)::bigint;
  ELSE
    SELECT contact_group.staff_id, contact_group.organization_id
    INTO v_group
    FROM public.auto_account_contact_groups AS contact_group
    WHERE contact_group.id = p_group_id;
    IF NOT FOUND
      OR NOT private.aka_agent_data_group_route_async(v_group.organization_id)
      OR NOT EXISTS (
        SELECT 1
        FROM public.auto_campaign_data_group_sources AS source
        WHERE source.group_id = p_group_id
          AND source.status IN ('baselining', 'active')
      )
    THEN
      PERFORM set_config(v_key, 'sync', true);
      RETURN NULL;
    END IF;
    INSERT INTO private.auto_data_group_route_jobs (
      kind, group_id, batch_id, group_revision, staff_id, organization_id
    ) VALUES (
      'members', p_group_id, p_batch_id, p_group_revision, v_group.staff_id, v_group.organization_id
    )
    RETURNING id INTO v_job_id;
    PERFORM set_config(v_key, v_job_id::text || '@' || v_tag, true);
  END IF;
  INSERT INTO private.auto_data_group_route_job_members (job_id, membership_id)
  VALUES (v_job_id, p_membership_id)
  ON CONFLICT (job_id, membership_id) DO NOTHING;
  RETURN v_job_id;
END;
$function$;

-- Gắn chiến dịch / bật lại công tắc: thay aka_agent_internal_route_group_snapshot khi tổ chức ở 'async'.
CREATE FUNCTION private.aka_agent_defer_data_group_baseline_route(
  p_source_id bigint, p_batch_id bigint, p_group_revision bigint, p_apply_baseline_note boolean
)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_source record;
  v_job_id bigint;
BEGIN
  SELECT source.id, source.group_id, source.staff_id, source.organization_id
  INTO v_source
  FROM public.auto_campaign_data_group_sources AS source
  WHERE source.id = p_source_id;
  IF NOT FOUND OR NOT private.aka_agent_data_group_route_async(v_source.organization_id) THEN
    RETURN NULL;
  END IF;
  INSERT INTO private.auto_data_group_route_jobs (
    kind, group_id, source_id, batch_id, group_revision, staff_id, organization_id, apply_baseline_note, source_ids
  ) VALUES (
    'baseline', v_source.group_id, v_source.id, p_batch_id, p_group_revision, v_source.staff_id,
    v_source.organization_id, COALESCE(p_apply_baseline_note, false), ARRAY[v_source.id]
  )
  RETURNING id INTO v_job_id;
  RETURN v_job_id;
END;
$function$;

CREATE FUNCTION private.aka_agent_finish_data_group_route_job(p_job_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_job private.auto_data_group_route_jobs%ROWTYPE;
BEGIN
  UPDATE private.auto_data_group_route_jobs
  SET status = 'done', finished_at = clock_timestamp(), last_worked_at = clock_timestamp(),
      updated_at = clock_timestamp()
  WHERE id = p_job_id
  RETURNING * INTO v_job;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  DELETE FROM private.auto_data_group_route_job_members WHERE job_id = p_job_id;

  IF v_job.kind = 'members' AND v_job.batch_id IS NOT NULL THEN
    -- Lượt nạp trả về input = 0 lúc ghi hàng đợi; giờ cộng kết quả đẩy thật để màn hình "lần ingest gần nhất" đúng.
    UPDATE public.auto_data_ingest_batches AS batch
    SET result = batch.result || jsonb_build_object(
          'inserted_input_count', COALESCE((batch.result ->> 'inserted_input_count')::integer, 0) + v_job.inserted_count,
          'already_seen_input_count', COALESCE((batch.result ->> 'already_seen_input_count')::integer, 0) + v_job.existing_count,
          'incompatible_count', COALESCE((batch.result ->> 'incompatible_count')::integer, 0) + v_job.incompatible_count,
          'conflict_count', COALESCE((batch.result ->> 'conflict_count')::integer, 0) + v_job.conflict_count,
          'conflicts', COALESCE(batch.result -> 'conflicts', '[]'::jsonb) || v_job.conflicts,
          'routing_status', 'done',
          'routing_job_id', v_job.id,
          'routing_error_count', v_job.error_count
        ),
        updated_at = now()
    WHERE batch.id = v_job.batch_id
      AND batch.operation = 'ingest'
      AND jsonb_typeof(batch.result) = 'object';
  ELSIF v_job.kind = 'baseline' AND v_job.apply_baseline_note THEN
    -- Như bind đồng bộ: không có data phù hợp thì ghi chú chờ, có data thì gỡ ghi chú chờ. Không đè ghi chú khác.
    IF v_job.inserted_count + v_job.existing_count = 0 THEN
      UPDATE public.auto_campaigns AS campaign
      SET note = 'Chờ data phù hợp', updated_at = now()
      FROM public.auto_campaign_data_group_sources AS source
      WHERE source.id = v_job.source_id
        AND campaign.id = source.campaign_id
        AND (campaign.note IS NULL OR campaign.note = 'Chờ data mới');
    ELSE
      UPDATE public.auto_campaigns AS campaign
      SET note = NULL, updated_at = now()
      FROM public.auto_campaign_data_group_sources AS source
      WHERE source.id = v_job.source_id
        AND campaign.id = source.campaign_id
        AND campaign.note IN ('Chờ data phù hợp', 'Chờ data mới');
    END IF;
  END IF;
END;
$function$;

-- Một đoạn: một nguồn x tối đa slice_size thành viên, gọi đúng aka_agent_internal_route_data_group_member như cũ.
-- Đoạn nằm trong một subtransaction: lỗi thì cả đoạn quay lại, không nửa vời.
CREATE FUNCTION private.aka_agent_route_data_group_job_slice(p_job_id bigint, p_deadline timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_job private.auto_data_group_route_jobs%ROWTYPE;
  v_source_id bigint;
  v_source_status text;
  v_members bigint[] := '{}';
  v_cursors bigint[] := '{}';
  v_count integer := 0;
  v_processed integer := 0;
  v_outcome jsonb;
  v_inserted integer := 0;
  v_existing integer := 0;
  v_incompatible integer := 0;
  v_conflict integer := 0;
  v_no_intake integer := 0;
  v_new_conflicts jsonb := '[]'::jsonb;
  v_room integer;
  v_state text;
  v_message text;
  v_now timestamptz;
BEGIN
  SELECT * INTO v_job FROM private.auto_data_group_route_jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND OR v_job.status NOT IN ('pending', 'running') THEN
    RETURN jsonb_build_object('pairs', 0, 'state', 'gone');
  END IF;

  IF v_job.status = 'pending' THEN
    IF v_job.kind = 'members' THEN
      SELECT COALESCE(array_agg(source.id ORDER BY
               CASE campaign.status WHEN 'đang chạy' THEN 0 WHEN 'chờ xử lý' THEN 1 ELSE 2 END,
               source.campaign_id, source.id), '{}'::bigint[])
      INTO v_job.source_ids
      FROM public.auto_campaign_data_group_sources AS source
      LEFT JOIN public.auto_campaigns AS campaign ON campaign.id = source.campaign_id
      WHERE source.group_id = v_job.group_id
        AND source.status IN ('baselining', 'active');
    END IF;
    v_job.source_ids := COALESCE(v_job.source_ids, '{}'::bigint[]);
    UPDATE private.auto_data_group_route_jobs
    SET status = 'running', started_at = clock_timestamp(), source_ids = v_job.source_ids,
        updated_at = clock_timestamp()
    WHERE id = v_job.id;
  END IF;

  IF v_job.source_pos > COALESCE(array_length(v_job.source_ids, 1), 0) THEN
    PERFORM private.aka_agent_finish_data_group_route_job(v_job.id);
    RETURN jsonb_build_object('pairs', 0, 'state', 'done');
  END IF;

  v_source_id := v_job.source_ids[v_job.source_pos];
  SELECT source.status INTO v_source_status
  FROM public.auto_campaign_data_group_sources AS source
  WHERE source.id = v_source_id;
  IF v_source_status IS NULL OR v_source_status NOT IN ('baselining', 'active') THEN
    -- Công tắc đã tắt (hoặc nguồn đã gỡ) trước khi tới lượt: như tắt trước lúc thêm data.
    UPDATE private.auto_data_group_route_jobs
    SET source_pos = source_pos + 1, member_cursor = 0, skipped_source_count = skipped_source_count + 1,
        last_worked_at = clock_timestamp(), updated_at = clock_timestamp()
    WHERE id = v_job.id;
    RETURN jsonb_build_object('pairs', 0, 'state', 'source_skipped');
  END IF;

  IF v_job.kind = 'members' THEN
    SELECT COALESCE(array_agg(item.membership_id ORDER BY item.id), '{}'::bigint[]),
           COALESCE(array_agg(item.id ORDER BY item.id), '{}'::bigint[])
    INTO v_members, v_cursors
    FROM (
      SELECT job_member.id, job_member.membership_id
      FROM private.auto_data_group_route_job_members AS job_member
      WHERE job_member.job_id = v_job.id
        AND job_member.id > v_job.member_cursor
      ORDER BY job_member.id
      LIMIT v_job.slice_size
    ) AS item;
  ELSE
    -- Cùng tập và thứ tự như aka_agent_internal_route_group_snapshot.
    SELECT COALESCE(array_agg(item.id ORDER BY item.id), '{}'::bigint[])
    INTO v_members
    FROM (
      SELECT member.id
      FROM public.auto_campaign_data_group_sources AS source
      JOIN public.auto_account_contact_group_members AS member ON member.group_id = source.group_id
      WHERE source.id = v_source_id
        AND member.is_delete = false
        AND member.id > v_job.member_cursor
      ORDER BY member.id
      LIMIT v_job.slice_size
    ) AS item;
    v_cursors := v_members;
  END IF;
  v_count := COALESCE(array_length(v_members, 1), 0);
  v_room := GREATEST(0, 50 - jsonb_array_length(v_job.conflicts));

  BEGIN
    FOR i IN 1 .. v_count LOOP
      v_outcome := public.aka_agent_internal_route_data_group_member(
        v_source_id, v_members[i], v_job.batch_id, v_job.group_revision
      );
      CASE v_outcome ->> 'status'
        WHEN 'inserted' THEN v_inserted := v_inserted + 1;
        WHEN 'existing' THEN v_existing := v_existing + 1;
        WHEN 'incompatible' THEN v_incompatible := v_incompatible + 1;
        WHEN 'conflict' THEN
          v_conflict := v_conflict + 1;
          IF jsonb_array_length(v_new_conflicts) < v_room THEN
            v_new_conflicts := v_new_conflicts || jsonb_build_array(jsonb_build_object(
              'membershipId', v_members[i],
              'sourceId', v_source_id,
              'code', 'canonical_alias_conflict',
              'message', 'Các định danh của dòng đang trỏ tới nhiều target khác nhau.',
              'aliases', COALESCE(v_outcome -> 'aliases', '[]'::jsonb)
            ));
          END IF;
        ELSE v_no_intake := v_no_intake + 1;
      END CASE;
      v_processed := i;
      EXIT WHEN clock_timestamp() >= p_deadline;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_message = MESSAGE_TEXT;
    v_now := clock_timestamp();
    IF v_state IN ('55P03', '40P01', '40001', '57014') THEN
      -- Khoá chiến dịch đang bận (lượt chạy, lượt nạp đồng bộ...) hoặc deadlock: không tính lỗi, thử lại sau.
      UPDATE private.auto_data_group_route_jobs
      SET last_error = v_state || ': ' || left(v_message, 300), last_worked_at = v_now,
          next_attempt_at = v_now + interval '5 seconds', updated_at = v_now
      WHERE id = v_job.id;
    ELSIF v_job.slice_size > 1 THEN
      UPDATE private.auto_data_group_route_jobs
      SET slice_size = GREATEST(1, slice_size / 4), attempts = attempts + 1,
          last_error = v_state || ': ' || left(v_message, 300), last_worked_at = v_now, updated_at = v_now
      WHERE id = v_job.id;
    ELSIF v_job.attempts >= 2 THEN
      -- Đúng một cặp (chiến dịch, thành viên) hỏng lặp lại: bỏ qua cặp đó, ghi lỗi, đi tiếp.
      UPDATE private.auto_data_group_route_jobs
      SET member_cursor = v_cursors[1], error_count = error_count + 1, attempts = 0,
          errors = CASE WHEN jsonb_array_length(errors) < 50 THEN errors || jsonb_build_array(jsonb_build_object(
                     'membershipId', v_members[1], 'sourceId', v_source_id, 'sqlstate', v_state,
                     'message', left(v_message, 300))) ELSE errors END,
          last_error = v_state || ': ' || left(v_message, 300), last_worked_at = v_now, updated_at = v_now
      WHERE id = v_job.id;
    ELSE
      UPDATE private.auto_data_group_route_jobs
      SET attempts = attempts + 1, last_error = v_state || ': ' || left(v_message, 300),
          last_worked_at = v_now, updated_at = v_now
      WHERE id = v_job.id;
    END IF;
    RETURN jsonb_build_object('pairs', 0, 'state', 'error', 'sqlstate', v_state);
  END;

  v_now := clock_timestamp();
  UPDATE private.auto_data_group_route_jobs
  SET inserted_count = inserted_count + v_inserted,
      existing_count = existing_count + v_existing,
      incompatible_count = incompatible_count + v_incompatible,
      conflict_count = conflict_count + v_conflict,
      no_intake_count = no_intake_count + v_no_intake,
      conflicts = conflicts || v_new_conflicts,
      member_cursor = CASE
        WHEN v_processed < v_count OR v_count = v_job.slice_size THEN v_cursors[v_processed]
        ELSE 0
      END,
      source_pos = CASE
        WHEN v_processed = v_count AND v_count < v_job.slice_size THEN source_pos + 1
        ELSE source_pos
      END,
      slice_size = LEAST(100, slice_size * 2),
      attempts = 0,
      next_attempt_at = NULL,
      last_worked_at = v_now,
      updated_at = v_now
  WHERE id = v_job.id;
  RETURN jsonb_build_object('pairs', v_processed, 'state', 'ok');
END;
$function$;

-- Worker: pg_cron gọi 10 giây/lần. Một runner, mỗi lượt <= workerBudgetMs và <= 32 đoạn (<= 32 subtransaction).
CREATE FUNCTION private.aka_agent_run_data_group_route_worker(p_budget_ms integer DEFAULT NULL)
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
    SELECT job.id INTO v_job_id
    FROM private.auto_data_group_route_jobs AS job
    WHERE job.status IN ('pending', 'running')
      AND (job.next_attempt_at IS NULL OR job.next_attempt_at <= clock_timestamp())
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
    'ms', round(extract(epoch FROM clock_timestamp() - v_started) * 1000)
  );
END;
$function$;

REVOKE ALL ON FUNCTION
  private.aka_agent_data_group_routing_settings(),
  private.aka_agent_data_group_route_async(bigint),
  private.aka_agent_defer_data_group_member_route(bigint, bigint, bigint, bigint),
  private.aka_agent_defer_data_group_baseline_route(bigint, bigint, bigint, boolean),
  private.aka_agent_finish_data_group_route_job(bigint),
  private.aka_agent_route_data_group_job_slice(bigint, timestamp with time zone),
  private.aka_agent_run_data_group_route_worker(integer)
FROM PUBLIC, anon, authenticated, service_role, aka_agent_desktop, aka_agent_chat_api;

COMMENT ON TABLE private.auto_data_group_route_jobs IS
  'V484: việc đẩy data nhóm vào chiến dịch chạy nền (data_groups.routing_mode = async). Worker: private.aka_agent_run_data_group_route_worker (pg_cron aka-agent-data-group-route-worker).';

DO $v484_p1_postflight$
DECLARE
  v_role text;
  v_sig text;
BEGIN
  FOREACH v_sig IN ARRAY ARRAY['private.aka_agent_data_group_routing_settings()', 'private.aka_agent_data_group_route_async(bigint)', 'private.aka_agent_defer_data_group_member_route(bigint,bigint,bigint,bigint)', 'private.aka_agent_defer_data_group_baseline_route(bigint,bigint,bigint,boolean)', 'private.aka_agent_finish_data_group_route_job(bigint)', 'private.aka_agent_route_data_group_job_slice(bigint,timestamp with time zone)', 'private.aka_agent_run_data_group_route_worker(integer)'] LOOP
    IF to_regprocedure(v_sig) IS NULL THEN
      RAISE EXCEPTION 'v484: % missing after p1', v_sig;
    END IF;
  END LOOP;
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role', 'aka_agent_desktop', 'aka_agent_chat_api'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_role) THEN
      FOREACH v_sig IN ARRAY ARRAY['private.aka_agent_data_group_routing_settings()', 'private.aka_agent_data_group_route_async(bigint)', 'private.aka_agent_defer_data_group_member_route(bigint,bigint,bigint,bigint)', 'private.aka_agent_defer_data_group_baseline_route(bigint,bigint,bigint,boolean)', 'private.aka_agent_finish_data_group_route_job(bigint)', 'private.aka_agent_route_data_group_job_slice(bigint,timestamp with time zone)', 'private.aka_agent_run_data_group_route_worker(integer)'] LOOP
        IF has_function_privilege(v_role, v_sig, 'EXECUTE') THEN
          RAISE EXCEPTION 'v484: % executable by %', v_sig, v_role;
        END IF;
      END LOOP;
      IF has_table_privilege(v_role, 'private.auto_data_group_route_jobs', 'SELECT')
         OR has_table_privilege(v_role, 'private.auto_data_group_route_job_members', 'SELECT') THEN
        RAISE EXCEPTION 'v484: route tables readable by %', v_role;
      END IF;
    END IF;
  END LOOP;
  IF private.aka_agent_data_group_route_async(-1) THEN
    RAISE EXCEPTION 'v484: async must be off after apply';
  END IF;
END
$v484_p1_postflight$;

COMMIT;
