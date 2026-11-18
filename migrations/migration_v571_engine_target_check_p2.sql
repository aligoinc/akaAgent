-- V571 phần 2: kiểm người nhận trên toàn hệ thống trước khi gọi Zalo (engine v2). SINH TỪ scripts/build-v571-sql.cjs, không sửa tay.
-- Cần phần 1. Tạo private.auto_engine_receiver_results (+ _state), 7 hàm private, thiết lập engine.target_check (mode off: chưa bỏ
-- qua gì), job pg_cron aka-agent-engine-receiver-results (mỗi phút, nạp lịch sử tối đa 40 giây), rồi thay thân aka_agent_engine_claim_target_v1 (bản V564) và
-- aka_agent_engine_report_v1 (bản V558), giữ chữ ký / chủ sở hữu / quyền. Khi mode off, claim và report trả đúng như trước (chỉ thêm một lần
-- đọc thiết lập mỗi lần nhận data của chiến dịch nhắn người lạ).
-- Nguồn = pg_get_functiondef production 18/11/2026: claim 03d72830d664682c1f51dc3dd9944eda, report bb8bc00f9d2a8c51a00dcb525fa2e4ab. Bản mới: claim 1ea2f16387985542b48dfbda6965c790, report 09fe52a53d9f419207506f1033bdb800.
-- DDL làm PostgREST nạp lại schema: apply ngoài giờ cao điểm. Lần nạp đầu đọc cả auto_campaign_details (~15 triệu dòng), xong trong khoảng
-- một đêm (40 giây / phút, ban ngày 3 giây / phút). Gỡ: rollback_v571_engine_target_check_p2.sql rồi rollback_v571_engine_target_check_p1.sql.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
DECLARE v_oid oid; v_md5 text; v_acl text; v_label text := 'V571 p2';
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name = 'migration_v571_engine_target_check_p2') THEN
      RAISE EXCEPTION 'V571 p2 đã có trong sổ migration, không chạy lại';
    END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid = 'public.auto_outcome_policies'::regclass
                  AND attname = 'target_check_enabled' AND NOT attisdropped) THEN
    RAISE EXCEPTION 'V571 p2: cần p1 (migration_v571_engine_target_check_p1.sql) trước';
  END IF;
  IF to_regclass('private.auto_engine_receiver_results') IS NOT NULL OR to_regprocedure('private.aka_agent_engine_receiver_results_ingest(integer,integer)') IS NOT NULL THEN
    RAISE EXCEPTION 'V571 p2: bảng / hàm kiểm người nhận đã có';
  END IF;
  IF to_regprocedure('public.normalize_phone(text)') IS NULL THEN RAISE EXCEPTION 'V571 p2: thiếu public.normalize_phone(text)'; END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_attribute WHERE attrelid = to_regclass('public.zalo_users')
       AND attname IN ('account_id', 'zalo_uid', 'global_id', 'is_fr') AND NOT attisdropped) <> 4 THEN
    RAISE EXCEPTION 'V571 p2: thiếu public.zalo_users(account_id, zalo_uid, global_id, is_fr)';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_system_settings WHERE key = 'engine.target_check') THEN RAISE EXCEPTION 'V571 p2: thiết lập engine.target_check đã có'; END IF;
  IF to_regclass('cron.job') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'aka-agent-engine-receiver-results') THEN RAISE EXCEPTION 'V571 p2: job aka-agent-engine-receiver-results đã có'; END IF;
  END IF;
  v_oid := to_regprocedure('public.aka_agent_engine_claim_target_v1(jsonb)');
  IF v_oid IS NULL THEN RAISE EXCEPTION '%: không có public.aka_agent_engine_claim_target_v1(jsonb)', v_label; END IF;
  v_md5 := md5(pg_get_functiondef(v_oid));
  IF v_md5 = '1ea2f16387985542b48dfbda6965c790' THEN RAISE EXCEPTION 'V571 đã chạy (claim)'; END IF;
  IF v_md5 IS DISTINCT FROM '03d72830d664682c1f51dc3dd9944eda' THEN RAISE EXCEPTION 'V571: định nghĩa claim khác bản production 18/11 (V564), dừng để đối chiếu bản live (claim: %)', v_md5; END IF;
  SELECT coalesce(p.proacl::text, '') || '|' || pg_get_userbyid(p.proowner) INTO v_acl FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;
  PERFORM set_config('aka.v571_acl_claim', v_acl, true);
  v_oid := to_regprocedure('public.aka_agent_engine_report_v1(bigint,uuid,jsonb,boolean,boolean)');
  IF v_oid IS NULL THEN RAISE EXCEPTION '%: không có public.aka_agent_engine_report_v1(bigint,uuid,jsonb,boolean,boolean)', v_label; END IF;
  v_md5 := md5(pg_get_functiondef(v_oid));
  IF v_md5 = '09fe52a53d9f419207506f1033bdb800' THEN RAISE EXCEPTION 'V571 đã chạy (report)'; END IF;
  IF v_md5 IS DISTINCT FROM 'bb8bc00f9d2a8c51a00dcb525fa2e4ab' THEN RAISE EXCEPTION 'V571: định nghĩa report khác bản production 18/11 (V558), dừng để đối chiếu bản live (report: %)', v_md5; END IF;
  SELECT coalesce(p.proacl::text, '') || '|' || pg_get_userbyid(p.proowner) INTO v_acl FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;
  PERFORM set_config('aka.v571_acl_report', v_acl, true);
END $pre$;

-- Sổ người nhận: mỗi người nhận (khoá md5('p:'||SĐT chuẩn hoá) hoặc md5('g:'||global id Zalo)) × thao tác × mã một dòng: lần hỏng gần nhất
-- và lần thành công gần nhất của cùng thao tác (thành công của tài khoản đã là bạn bè không tính). Chỉ người nhận từng hỏng mới có dòng.
CREATE TABLE private.auto_engine_receiver_results (
  receiver_key uuid NOT NULL,
  key_kind text NOT NULL CHECK (key_kind IN ('phone', 'global')),
  action_code text NOT NULL,
  error_code text NOT NULL,
  bad_zalo_code text,
  bad_at timestamptz NOT NULL,
  bad_detail_id bigint NOT NULL,
  ok_at timestamptz,
  PRIMARY KEY (receiver_key, action_code, error_code)
) WITH (fillfactor = 90);
COMMENT ON TABLE private.auto_engine_receiver_results IS
  'V571: kết quả theo người nhận trên toàn hệ thống. receiver_key = md5(''p:''||normalize_phone(SĐT))::uuid hoặc md5(''g:''||global id)::uuid (một kết quả có cả hai thì ghi cả hai). Theo dõi mọi mã "thuộc về người nhận" của Tìm SĐT / Nhắn tin người lạ / Kết bạn (aka_agent_engine_target_check_tracked), bật bỏ qua theo cột target_check của auto_outcome_policies. bad_zalo_code = mã Zalo gốc nếu có; ok_at = lần thành công gần nhất của cùng thao tác (trừ khi tài khoản gửi đã là bạn bè). Nạp nền: aka_agent_engine_receiver_results_ingest; claim_target_v1 đọc qua aka_agent_engine_target_check_probe.';
ALTER TABLE private.auto_engine_receiver_results ENABLE ROW LEVEL SECURITY;

CREATE TABLE private.auto_engine_receiver_results_state (
  id integer PRIMARY KEY CHECK (id = 1),
  last_detail_id bigint NOT NULL DEFAULT 0,
  stats jsonb NOT NULL DEFAULT '{}'::jsonb,
  runs bigint NOT NULL DEFAULT 0,
  last_run jsonb,
  cleaned_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE private.auto_engine_receiver_results_state IS
  'V571: mốc nạp (id auto_campaign_details đã nạp tới) và số đo cộng dồn. "<thao tác>|all|<mã lỗi|ok|other>" = mọi kết quả đã nạp; "<thao tác>|pred|<mã hỏng trước>/<mã Zalo>|<phone|global>|<d007|d030|d090|d365|d999>|<same|bad|ok|other>" = kết quả mà lúc đó người nhận đã có lần hỏng còn hiệu lực (khoá, tuổi lần hỏng), tức kết quả lẽ ra bị bỏ qua nếu mã đó bật: same = hỏng lại đúng mã (bỏ đúng), ok = Zalo lại thành công (bỏ nhầm). Số đo chỉ đúng ở lần nạp đầu (nạp lại thì xoá cả bảng kết quả lẫn stats).';
ALTER TABLE private.auto_engine_receiver_results_state ENABLE ROW LEVEL SECURITY;
INSERT INTO private.auto_engine_receiver_results_state (id) VALUES (1);

CREATE FUNCTION private.aka_agent_engine_target_check_config()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO ''
AS $function$
DECLARE
  v_raw text;
  v jsonb;
BEGIN
  SELECT s.value INTO v_raw FROM public.auto_system_settings s WHERE s.key = 'engine.target_check' AND s.is_active LIMIT 1;
  IF v_raw IS NULL OR NOT pg_input_is_valid(v_raw, 'jsonb') THEN RETURN '{}'::jsonb; END IF;
  v := v_raw::jsonb;
  RETURN CASE WHEN jsonb_typeof(v) = 'object' THEN v ELSE '{}'::jsonb END;
END $function$;
COMMENT ON FUNCTION private.aka_agent_engine_target_check_config() IS 'V571: thiết lập engine.target_check (thiếu dòng / sai định dạng = {}).';

CREATE FUNCTION private.aka_agent_engine_target_check_on(p_organization_id bigint)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path TO ''
AS $function$
DECLARE
  v jsonb;
BEGIN
  IF p_organization_id IS NULL THEN RETURN false; END IF;
  v := private.aka_agent_engine_target_check_config();
  IF v->>'mode' = 'all' THEN RETURN true; END IF;
  IF v->>'mode' = 'orgs' AND jsonb_typeof(v->'organizationIds') = 'array' THEN
    RETURN EXISTS (SELECT 1 FROM jsonb_array_elements(v->'organizationIds') e
                    WHERE jsonb_typeof(e.value) IN ('number', 'string') AND (e.value #>> '{}') = p_organization_id::text);
  END IF;
  RETURN false;
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END $function$;
COMMENT ON FUNCTION private.aka_agent_engine_target_check_on(bigint) IS 'V571: tổ chức có bật kiểm người nhận trên toàn hệ thống không (engine.target_check: mode off | orgs (organizationIds) | all; thiếu / sai = không).';

CREATE FUNCTION private.aka_agent_engine_target_check_rules()
RETURNS TABLE(action_code text, error_code text, enabled boolean, days integer)
LANGUAGE sql
STABLE
SET search_path TO ''
AS $function$
  SELECT p.action_code, p.error_code, bool_or(p.target_check_enabled), max(p.target_check_days)
    FROM public.auto_outcome_policies p
   WHERE p.target_check_enabled IS NOT NULL AND p.is_active AND NOT p.is_delete
     AND p.action_code IS NOT NULL AND p.error_code IS NOT NULL
   GROUP BY p.action_code, p.error_code
$function$;
COMMENT ON FUNCTION private.aka_agent_engine_target_check_rules() IS 'V571: các cặp (thao tác, mã) có target_check ở auto_outcome_policies: enabled = true thì claim bỏ qua bước; false = chỉ theo dõi. days = số ngày xét.';

CREATE FUNCTION private.aka_agent_engine_target_check_tracked()
RETURNS TABLE(action_code text, error_code text)
LANGUAGE sql
STABLE
SET search_path TO ''
AS $function$
  SELECT a.code, e.error_code
    FROM unnest(ARRAY['zalo_find_phone_user', 'zalo_message_stranger', 'zalo_add_friend']) a(code)
    CROSS JOIN public.auto_error e
   WHERE e.error_class = 'target_permanent' AND starts_with(e.error_code, 'err_zalo_') AND e.is_active AND NOT e.is_delete
     AND e.error_code <> ALL (ARRAY['err_zalo_api_business_failed', 'err_zalo_invalid_param', 'err_zalo_add_friend_failed'])
  UNION
  SELECT rl.action_code, rl.error_code FROM private.aka_agent_engine_target_check_rules() rl
$function$;
COMMENT ON FUNCTION private.aka_agent_engine_target_check_tracked() IS 'V571: các cặp (thao tác, mã) được nạp vào sổ: mã Zalo "thuộc về người nhận" (auto_error target_permanent, trừ err_zalo_api_business_failed, err_zalo_invalid_param, err_zalo_add_friend_failed) của zalo_find_phone_user / zalo_message_stranger / zalo_add_friend, cộng mọi cặp có target_check ở bảng chính sách. Bật bỏ qua một mã đã theo dõi có hiệu lực ngay, không phải nạp lại.';

CREATE FUNCTION private.aka_agent_engine_receiver_key(p_kind text, p_value text)
RETURNS uuid
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path TO ''
AS $function$
  SELECT CASE
    WHEN p_kind = 'phone' THEN (SELECT CASE WHEN n IS NULL OR n = '' THEN NULL ELSE md5('p:' || n)::uuid END FROM (SELECT public.normalize_phone(p_value) AS n) s)
    WHEN p_kind = 'global' THEN (SELECT CASE WHEN g IS NULL OR g = '' THEN NULL ELSE md5('g:' || g)::uuid END FROM (SELECT btrim(p_value) AS g) s)
  END
$function$;
COMMENT ON FUNCTION private.aka_agent_engine_receiver_key(text,text) IS 'V571: khoá người nhận: phone = md5(''p:''||normalize_phone(SĐT))::uuid (SĐT không có chữ số = NULL); global = md5(''g:''||global id)::uuid.';

CREATE FUNCTION private.aka_agent_engine_target_check_probe(p_phone text, p_global_id text)
RETURNS TABLE(action_code text, error_code text, key_kind text, zalo_code text, bad_at timestamptz)
LANGUAGE sql
STABLE
SET search_path TO ''
AS $function$
  WITH k AS (
    SELECT private.aka_agent_engine_receiver_key('phone', p_phone) AS pk, private.aka_agent_engine_receiver_key('global', p_global_id) AS gk
  ), rws AS (
    SELECT x.* FROM private.auto_engine_receiver_results x, k WHERE x.receiver_key = k.pk OR x.receiver_key = k.gk
  ), okmax AS (
    -- Thành công gần nhất của cùng thao tác qua mọi khoá của người nhận.
    SELECT w.action_code, max(w.ok_at) AS ok_at FROM rws w GROUP BY w.action_code
  )
  SELECT DISTINCT ON (w.action_code) w.action_code, w.error_code, w.key_kind, w.bad_zalo_code, w.bad_at
    FROM rws w
    JOIN okmax o ON o.action_code = w.action_code
    JOIN private.aka_agent_engine_target_check_rules() rl ON rl.action_code = w.action_code AND rl.error_code = w.error_code AND rl.enabled
   WHERE w.bad_at > clock_timestamp() - make_interval(days => rl.days)
     AND (o.ok_at IS NULL OR o.ok_at < w.bad_at)
   ORDER BY w.action_code, w.bad_at DESC
$function$;
COMMENT ON FUNCTION private.aka_agent_engine_target_check_probe(text,text) IS 'V571: các thao tác mà người nhận (SĐT, global id) đã biết hỏng: mã đang bật target_check, trong số ngày xét, chưa thành công lại (qua mọi khoá); mỗi thao tác lần hỏng gần nhất.';

CREATE FUNCTION private.aka_agent_engine_receiver_results_ingest(p_budget_ms integer DEFAULT NULL, p_chunk integer DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
DECLARE
  v_cfg jsonb := private.aka_agent_engine_target_check_config();
  v_budget integer;
  v_chunk integer;
  v_started timestamptz := clock_timestamp();
  v_deadline timestamptz;
  v_keep integer;
  v_from bigint;
  v_start bigint;
  v_to bigint;
  v_top bigint;
  v_cap bigint;
  v_stats jsonb;
  v_add jsonb;
  v_cleaned timestamptz;
  v_hour integer;
  v_throttled boolean := false;
  v_chunks integer := 0;
  v_rows bigint := 0;
  v_bad bigint := 0;
  v_ok bigint := 0;
  v_n integer;
  v_nb integer;
  v_no integer;
  v_deleted integer := 0;
BEGIN
  -- Gọi tay có ngân sách (nạp bù) thì chạy kể cả khi ingest = false.
  IF p_budget_ms IS NULL AND v_cfg->'ingest' = 'false'::jsonb THEN RETURN jsonb_build_object('status', 'off'); END IF;
  IF NOT pg_try_advisory_xact_lock(hashtextextended('aka-agent-engine-receiver-results-ingest', 0)) THEN
    RETURN jsonb_build_object('status', 'busy');
  END IF;
  v_budget := greatest(500, least(90000, coalesce(p_budget_ms,
    CASE WHEN jsonb_typeof(v_cfg->'ingestBudgetMs') = 'number' THEN (v_cfg->>'ingestBudgetMs')::numeric::integer END, 40000)));
  v_chunk := greatest(100, least(200000, coalesce(p_chunk,
    CASE WHEN jsonb_typeof(v_cfg->'ingestChunk') = 'number' THEN (v_cfg->>'ingestChunk')::numeric::integer END, 5000)));
  -- Giữ ít nhất 365 ngày (giảm số ngày xét rồi tăng lại không mất dữ liệu).
  SELECT greatest(365, coalesce(max(rl.days), 365)) INTO v_keep FROM private.aka_agent_engine_target_check_rules() rl;
  SELECT s.last_detail_id, s.stats, s.cleaned_at INTO v_from, v_stats, v_cleaned
    FROM private.auto_engine_receiver_results_state s WHERE s.id = 1 FOR UPDATE;
  v_start := v_from;
  SELECT max(d.id) INTO v_top FROM public.auto_campaign_details d;
  v_top := coalesce(v_top, 0);
  -- Chỉ nạp tới dòng đã ghi hơn 3 phút (giao dịch ghi lịch sử chưa xong có thể còn giữ id nhỏ hơn dòng đã thấy).
  v_cap := coalesce((SELECT d.id FROM public.auto_campaign_details d
                      WHERE d.id > v_top - 5000 AND d.id <= v_top AND d.created_at <= v_started - interval '3 minutes'
                      ORDER BY d.id DESC LIMIT 1),
                    v_top - 5000);
  -- Nạp lần đầu (còn tồn nhiều, đọc nguội ~1 ms mỗi id): ban ngày (giờ VN, mặc định 8–18h) chỉ chạy backfillDayBudgetMs mỗi phút để
  -- không đọc đĩa nặng giờ cao điểm; gọi tay có ngân sách thì không giới hạn.
  v_hour := extract(hour FROM (v_started AT TIME ZONE 'Asia/Ho_Chi_Minh'))::integer;
  IF p_budget_ms IS NULL AND v_cap - v_from > coalesce(CASE WHEN jsonb_typeof(v_cfg->'backfillThresholdIds') = 'number'
                                                            THEN (v_cfg->>'backfillThresholdIds')::numeric END, 50000)
     AND v_hour >= coalesce(CASE WHEN jsonb_typeof(v_cfg->'backfillDayHours'->0) = 'number' THEN (v_cfg->'backfillDayHours'->>0)::numeric::integer END, 8)
     AND v_hour < coalesce(CASE WHEN jsonb_typeof(v_cfg->'backfillDayHours'->1) = 'number' THEN (v_cfg->'backfillDayHours'->>1)::numeric::integer END, 18) THEN
    v_budget := least(v_budget, greatest(500, least(90000, coalesce(CASE WHEN jsonb_typeof(v_cfg->'backfillDayBudgetMs') = 'number'
                                                                         THEN (v_cfg->>'backfillDayBudgetMs')::numeric::integer END, 3000))));
    v_throttled := true;
  END IF;
  v_deadline := v_started + make_interval(secs => v_budget / 1000.0);

  WHILE v_from < v_cap AND clock_timestamp() < v_deadline LOOP
    v_to := least(v_from + v_chunk, v_cap);
    WITH tr AS MATERIALIZED (
      SELECT * FROM private.aka_agent_engine_target_check_tracked()
    ), src AS MATERIALIZED (
      SELECT d.id, d.created_at, d.action_code, d.error_code,
             (d.error_code IS NULL AND (d.report_group = 'success' OR d.status = 'thành công')
              -- Thành công của tài khoản đã là bạn bè không xoá lần hỏng (bạn bè luôn nhắn được dù người nhận chặn người lạ).
              AND NOT coalesce(d.data->'target'->'isFriend' = 'true'::jsonb, false)) AS is_ok,
             left(coalesce(nullif(d.data->'signal'->>'code', ''), nullif(d.data->'zalo'->>'code', '')), 40) AS raw_code,
             -- Như aka_agent_engine_receiver_key (viết thẳng để không gọi thêm một hàm mỗi dòng).
             np.n AS phone_n,
             nullif(btrim(coalesce(d.data->'target'->>'globalId', '')), '') AS global_id
        FROM public.auto_campaign_details d
        LEFT JOIN public.auto_campaign_input_data i ON i.id = d.input_data_id
        CROSS JOIN LATERAL (SELECT nullif(public.normalize_phone(coalesce(nullif(btrim(i.phone), ''), nullif(btrim(d.data->'target'->>'phone'), ''))), '') AS n) np
       WHERE d.id > v_from AND d.id <= v_to
         AND d.action_code = ANY (ARRAY['zalo_find_phone_user', 'zalo_message_stranger', 'zalo_add_friend'])
         -- Dòng do chính việc kiểm ghi (bước bỏ qua) không phải kết quả Zalo thật.
         AND NOT coalesce(d.policy_snapshot->'v2'->'targetCheck' = 'true'::jsonb, false)
    ), srcf AS MATERIALIZED (
      SELECT s.*, (tr.error_code IS NOT NULL) AS is_bad FROM src s LEFT JOIN tr ON tr.action_code = s.action_code AND tr.error_code = s.error_code
    ), rws AS MATERIALIZED (
      -- Mỗi kết quả một dòng cho mỗi khoá có được (SĐT, global id).
      SELECT f.*, k.kind, k.key FROM srcf f
      CROSS JOIN LATERAL (VALUES ('phone', CASE WHEN f.phone_n IS NOT NULL THEN md5('p:' || f.phone_n)::uuid END),
                                 ('global', CASE WHEN f.global_id IS NOT NULL THEN md5('g:' || f.global_id)::uuid END)) k(kind, key)
       WHERE k.key IS NOT NULL
    ), agg_bad AS MATERIALIZED (
      SELECT DISTINCT ON (w.key, w.action_code, w.error_code) w.key, w.kind, w.action_code, w.error_code, w.raw_code, w.created_at, w.id
        FROM rws w WHERE w.is_bad ORDER BY w.key, w.action_code, w.error_code, w.id DESC
    ), agg_ok AS MATERIALIZED (
      SELECT w.key, w.action_code, max(w.created_at) AS ok_at FROM rws w WHERE w.is_ok GROUP BY w.key, w.action_code
    ), win AS MATERIALIZED (
      SELECT w.id, w.key, w.kind, w.action_code, w.created_at,
             max(w.id) FILTER (WHERE w.is_bad) OVER pw AS prev_bad_id,
             max(w.created_at) FILTER (WHERE w.is_ok) OVER pw AS prev_ok_at
        FROM rws w
      WINDOW pw AS (PARTITION BY w.key, w.action_code ORDER BY w.id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING)
    ), kp AS MATERIALIZED (
      -- Theo từng khoá, ngay trước kết quả này: lần hỏng gần nhất (trong phần đang nạp hoặc trong sổ) và lần thành công gần nhất.
      SELECT w.id, w.kind, b.bad_at, b.error_code AS prior_code, b.raw_code AS prior_raw,
             greatest(w.prev_ok_at, (SELECT max(x.ok_at) FROM private.auto_engine_receiver_results x
                                      WHERE x.receiver_key = w.key AND x.action_code = w.action_code)) AS ok_at
        FROM win w
        LEFT JOIN LATERAL (
          SELECT q.bad_at, q.error_code, q.raw_code FROM (
            SELECT pb.created_at AS bad_at, pb.error_code, pb.raw_code FROM rws pb WHERE pb.id = w.prev_bad_id AND pb.key = w.key
            UNION ALL
            SELECT x.bad_at, x.error_code, x.bad_zalo_code FROM private.auto_engine_receiver_results x
             WHERE x.receiver_key = w.key AND x.action_code = w.action_code
          ) q WHERE q.bad_at < w.created_at ORDER BY q.bad_at DESC LIMIT 1) b ON true
    ), ev AS MATERIALIZED (
      -- Mỗi kết quả: lần hỏng gần nhất qua mọi khoá, và lần thành công gần nhất qua mọi khoá.
      SELECT f.id, f.action_code, f.created_at, f.error_code, f.is_bad, f.is_ok,
             pr.bad_at AS prior_bad_at, pr.prior_code, pr.prior_raw, pr.kind AS prior_kind,
             (SELECT max(k3.ok_at) FROM kp k3 WHERE k3.id = f.id) AS prior_ok_at
        FROM srcf f
        LEFT JOIN LATERAL (SELECT k2.bad_at, k2.prior_code, k2.prior_raw, k2.kind FROM kp k2
                            WHERE k2.id = f.id AND k2.bad_at IS NOT NULL ORDER BY k2.bad_at DESC LIMIT 1) pr ON true
    ), st AS (
      SELECT jsonb_object_agg(z.k, z.n) AS j FROM (
        SELECT e.action_code || '|all|' || CASE WHEN e.is_bad THEN e.error_code WHEN e.is_ok THEN 'ok' ELSE 'other' END AS k, count(*) AS n
          FROM ev e GROUP BY 1
        UNION ALL
        SELECT e.action_code || '|pred|' || e.prior_code || '/' || coalesce(e.prior_raw, '-') || '|' || e.prior_kind || '|'
                 || CASE WHEN e.created_at - e.prior_bad_at < interval '7 days' THEN 'd007'
                         WHEN e.created_at - e.prior_bad_at < interval '30 days' THEN 'd030'
                         WHEN e.created_at - e.prior_bad_at < interval '90 days' THEN 'd090'
                         WHEN e.created_at - e.prior_bad_at < interval '365 days' THEN 'd365' ELSE 'd999' END
                 || '|' || CASE WHEN e.is_bad AND e.error_code = e.prior_code THEN 'same' WHEN e.is_bad THEN 'bad' WHEN e.is_ok THEN 'ok' ELSE 'other' END,
               count(*)
          FROM ev e
         WHERE e.prior_bad_at IS NOT NULL AND (e.prior_ok_at IS NULL OR e.prior_ok_at < e.prior_bad_at)
         GROUP BY 1
      ) z
    ), ins AS (
      INSERT INTO private.auto_engine_receiver_results AS x (receiver_key, key_kind, action_code, error_code, bad_zalo_code, bad_at, bad_detail_id, ok_at)
      SELECT b.key, b.kind, b.action_code, b.error_code, b.raw_code, b.created_at, b.id, o.ok_at
        FROM agg_bad b LEFT JOIN agg_ok o ON o.key = b.key AND o.action_code = b.action_code
      ON CONFLICT (receiver_key, action_code, error_code) DO UPDATE SET
        bad_zalo_code = CASE WHEN EXCLUDED.bad_detail_id >= x.bad_detail_id THEN EXCLUDED.bad_zalo_code ELSE x.bad_zalo_code END,
        bad_at = CASE WHEN EXCLUDED.bad_detail_id >= x.bad_detail_id THEN EXCLUDED.bad_at ELSE x.bad_at END,
        bad_detail_id = greatest(EXCLUDED.bad_detail_id, x.bad_detail_id),
        ok_at = greatest(x.ok_at, EXCLUDED.ok_at)
      RETURNING 1
    ), upd AS (
      UPDATE private.auto_engine_receiver_results x SET ok_at = o.ok_at
        FROM agg_ok o
       WHERE x.receiver_key = o.key AND x.action_code = o.action_code AND (x.ok_at IS NULL OR x.ok_at < o.ok_at)
         AND NOT EXISTS (SELECT 1 FROM agg_bad b WHERE b.key = x.receiver_key AND b.action_code = x.action_code AND b.error_code = x.error_code)
      RETURNING 1
    )
    SELECT (SELECT count(*) FROM srcf), (SELECT count(*) FROM ins), (SELECT count(*) FROM upd), (SELECT st.j FROM st)
      INTO v_n, v_nb, v_no, v_add;
    IF v_add IS NOT NULL THEN
      SELECT coalesce(jsonb_object_agg(u.k, u.n), '{}'::jsonb) INTO v_stats FROM (
        SELECT y.k, sum(y.n)::bigint AS n FROM (
          SELECT e.key AS k, (e.value #>> '{}')::bigint AS n FROM jsonb_each(coalesce(v_stats, '{}'::jsonb)) e
          UNION ALL
          SELECT e.key, (e.value #>> '{}')::bigint FROM jsonb_each(v_add) e
        ) y GROUP BY y.k
      ) u;
    END IF;
    v_rows := v_rows + v_n; v_bad := v_bad + v_nb; v_ok := v_ok + v_no; v_chunks := v_chunks + 1;
    v_from := v_to;
  END LOOP;

  -- Mỗi ngày một lần: bỏ lần hỏng đã quá số ngày giữ (ít nhất 365, hoặc số ngày xét lớn nhất) + 1 ngày.
  IF v_cleaned IS NULL OR v_cleaned < v_started - interval '1 day' THEN
    DELETE FROM private.auto_engine_receiver_results x WHERE x.bad_at < v_started - make_interval(days => v_keep + 1);
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    v_cleaned := v_started;
  END IF;

  UPDATE private.auto_engine_receiver_results_state s SET last_detail_id = v_from, stats = coalesce(v_stats, '{}'::jsonb), runs = s.runs + 1,
         cleaned_at = v_cleaned, updated_at = clock_timestamp(),
         last_run = jsonb_build_object('at', v_started, 'from', v_start, 'to', v_from, 'cap', v_cap, 'budgetMs', v_budget, 'throttled', v_throttled,
           'chunks', v_chunks, 'rows', v_rows, 'badUpserts', v_bad, 'okUpdates', v_ok, 'deleted', v_deleted,
           'ms', round(extract(epoch FROM clock_timestamp() - v_started) * 1000))
   WHERE s.id = 1;
  RETURN jsonb_build_object('status', 'ok', 'from', v_start, 'to', v_from, 'cap', v_cap, 'budgetMs', v_budget, 'throttled', v_throttled,
    'chunks', v_chunks, 'rows', v_rows, 'badUpserts', v_bad, 'okUpdates', v_ok, 'deleted', v_deleted, 'caughtUp', v_from >= v_cap);
END $function$;
COMMENT ON FUNCTION private.aka_agent_engine_receiver_results_ingest(integer,integer) IS
  'V571: nạp auto_campaign_details (theo id, từ mốc ở auto_engine_receiver_results_state) vào auto_engine_receiver_results và số đo. pg_cron aka-agent-engine-receiver-results gọi mỗi phút với ngân sách engine.target_check.ingestBudgetMs (mặc định 40 giây, ingestChunk id mỗi phần, mặc định 5.000); còn tồn hơn backfillThresholdIds id (nạp lần đầu) trong backfillDayHours giờ VN (mặc định 8–18h) thì chỉ backfillDayBudgetMs (mặc định 3 giây). Gọi tay với p_budget_ms để nạp bù (không giới hạn theo giờ).';

INSERT INTO public.auto_system_settings (key, value, description, is_secret, is_active) VALUES
  ('engine.target_check', '{"mode":"off","organizationIds":[],"ingest":true,"ingestBudgetMs":40000,"ingestChunk":5000,"backfillDayBudgetMs":3000,"backfillDayHours":[8,18],"backfillThresholdIds":50000}',
   'Kiểm người nhận trên toàn hệ thống trước khi gọi Zalo (V571), chỉ engine v2: "Nhắn tin theo SĐT" và nhắn người lạ theo UID (thành viên nhóm, group thời gian thực, đề xuất Zalo, khách hàng cũ), không kiêm SMS. JSON: mode off | orgs (chỉ organizationIds) | all; thiếu dòng / sai định dạng = off. Mã nào bỏ qua: cột target_check_enabled / target_check_days của auto_outcome_policies. ingest = false: job ngừng nạp lịch sử (claim vẫn đọc sổ đã nạp nếu mode bật). ingestBudgetMs / ingestChunk: ngân sách mỗi phút và số id mỗi phần nạp; backfillDayBudgetMs / backfillDayHours [giờ bắt đầu, giờ kết thúc) VN / backfillThresholdIds: ngân sách ban ngày khi còn tồn nhiều (nạp lần đầu). Claim đọc lại mỗi lần nhận data nên đổi có hiệu lực ngay.',
   false, true);

DO $grants$
DECLARE v_role text; v_obj text;
BEGIN
  FOREACH v_obj IN ARRAY ARRAY['private.auto_engine_receiver_results', 'private.auto_engine_receiver_results_state'] LOOP
    EXECUTE format('REVOKE ALL ON TABLE %s FROM PUBLIC', v_obj);
  END LOOP;
  FOREACH v_obj IN ARRAY ARRAY['private.aka_agent_engine_target_check_config()', 'private.aka_agent_engine_target_check_on(bigint)', 'private.aka_agent_engine_target_check_rules()', 'private.aka_agent_engine_target_check_tracked()', 'private.aka_agent_engine_receiver_key(text,text)', 'private.aka_agent_engine_target_check_probe(text,text)', 'private.aka_agent_engine_receiver_results_ingest(integer,integer)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', v_obj);
  END LOOP;
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role', 'aka_agent_desktop', 'aka_agent_chat_api'] LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = v_role) THEN
      FOREACH v_obj IN ARRAY ARRAY['private.auto_engine_receiver_results', 'private.auto_engine_receiver_results_state'] LOOP
        EXECUTE format('REVOKE ALL ON TABLE %s FROM %I', v_obj, v_role);
      END LOOP;
      FOREACH v_obj IN ARRAY ARRAY['private.aka_agent_engine_target_check_config()', 'private.aka_agent_engine_target_check_on(bigint)', 'private.aka_agent_engine_target_check_rules()', 'private.aka_agent_engine_target_check_tracked()', 'private.aka_agent_engine_receiver_key(text,text)', 'private.aka_agent_engine_target_check_probe(text,text)', 'private.aka_agent_engine_receiver_results_ingest(integer,integer)'] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', v_obj, v_role);
      END LOOP;
    END IF;
  END LOOP;
END $grants$;

CREATE OR REPLACE FUNCTION public.aka_agent_engine_claim_target_v1(p_ctx jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_vn date := (clock_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date;
  v_staff bigint := nullif(p_ctx->>'staffId', '')::bigint;
  v_account_id bigint := nullif(p_ctx->>'accountId', '')::bigint;
  v_campaign_id bigint := nullif(p_ctx->>'campaignId', '')::bigint;
  v_runner text := nullif(btrim(p_ctx->>'runnerId'), '');
  v_runtime text := p_ctx->>'runtimeTarget';
  v_req_token uuid := nullif(p_ctx->>'leaseToken', '')::uuid;
  v_lease_seconds integer := greatest(30, public.aka_agent_engine_setting('engine.lease_seconds', '180')::integer);
  c public.auto_campaigns%ROWTYPE;
  a public.auto_accounts%ROWTYPE;
  l public.auto_engine_leases%ROWTYPE;
  t public.auto_campaign_input_data%ROWTYPE;
  v_has_lease boolean;
  v_token uuid;
  v_run_id bigint;
  v_act jsonb;
  v_code text;
  v_required boolean;
  v_decision jsonb;
  v_decisions jsonb := '{}'::jsonb;
  v_target_wait jsonb;
  v_target_key text;
  v_lock record;
  v_limit jsonb;
  v_daily numeric;
  v_window_count numeric;
  v_window_minutes numeric;
  v_used integer;
  v_oldest timestamptz;
  v_allowed boolean;
  v_boundary text;
  v_org bigint;
  v_cap_qr boolean;
  v_cap_web boolean;
  v_cap_server boolean;
  v_max integer;
  v_running bigint;
  v_day_start timestamptz := ((clock_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh');
  v_wait_note text;
  v_found boolean := false;
  v_cooldown boolean;
  v_cd_decision text;
  v_cd_note text;
  v_cd_error text;
  v_cd_paused jsonb := '[]'::jsonb;
  v_cd_skip bigint[] := '{}';
  v_cd_scanned integer := 0;
  v_dg_result jsonb;
  v_cd_deadline timestamptz;
  v_legacy_setting text;
  v_legacy_before timestamptz;
  -- V558: lượt theo lịch (loại chiến dịch không có dòng data: trang cá nhân, newsfeed Facebook).
  v_slot_mode boolean := coalesce(p_ctx->>'mode', '') = 'campaign_slot';
  v_slot timestamptz;
  v_is_facebook boolean;
  -- V558: chỉ nhận đúng các data này (ctx.inputDataIds), trong lượt đang giữ lease.
  v_only_ids bigint[];
  -- V564: chiến dịch đăng nhóm bật "Xáo trộn danh sách group" (như bộ cũ xáo các data chờ ở đầu mỗi lượt).
  v_shuffle boolean := false;
  v_shuffle_count integer;
  -- V571: kiểm người nhận trên toàn hệ thống (engine.target_check).
  v_tc jsonb;                       -- {thao tác: mã} người nhận đã biết hỏng (mã đang bật, còn hiệu lực)
  v_tc_global text;                 -- global id của người nhận (zalo_users theo tài khoản + UID)
  v_tc_friend boolean := false;     -- tài khoản gửi đã là bạn bè (zalo_users.is_fr)
  v_tc_sends jsonb;                 -- mọi bước gửi đã biết hỏng: {thao tác gửi: mã}, bỏ luôn bước tìm SĐT
BEGIN
  IF v_staff IS NULL OR v_account_id IS NULL OR v_campaign_id IS NULL OR v_runner IS NULL OR v_runtime IS NULL OR v_runtime NOT IN ('desktop','fly') THEN
    RETURN jsonb_build_object('status', 'invalid_request');
  END IF;
  -- Desktop chỉ nhận việc của chính nhân viên đăng nhập, và chỉ với vai trò Desktop.
  IF public.aka_agent_engine_desktop_staff() IS NOT NULL AND v_runtime <> 'desktop' THEN
    RETURN jsonb_build_object('status', 'invalid_request');
  END IF;
  IF NOT public.aka_agent_engine_scope_ok(v_staff) THEN RETURN jsonb_build_object('status', 'not_found'); END IF;
  -- V558: nhận thêm đúng các data này vào lượt đang chạy (đăng nhóm Facebook kèm chia sẻ sang các nhóm đã chọn trong hộp đăng bài, như bộ
  -- cũ giữ chỗ các nhóm chia sẻ cùng data chính). Chỉ khi đang giữ lease, không cho lượt theo lịch, tối đa 50 id.
  IF p_ctx ? 'inputDataIds' THEN
    IF v_req_token IS NULL OR v_slot_mode OR jsonb_typeof(p_ctx->'inputDataIds') <> 'array'
       OR jsonb_array_length(p_ctx->'inputDataIds') NOT BETWEEN 1 AND 50
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_ctx->'inputDataIds') x
                   WHERE jsonb_typeof(x.value) <> 'number' OR x.value::text !~ '^[0-9]{1,18}$') THEN
      RETURN jsonb_build_object('status', 'invalid_request');
    END IF;
    SELECT array_agg(DISTINCT x.value::text::bigint) INTO v_only_ids FROM jsonb_array_elements(p_ctx->'inputDataIds') x;
  END IF;

  -- V501 (review 12/11): khoá tư vấn trước khoá dòng, đúng thứ tự của bản cũ. Chiến dịch Nhóm data: khoá nạp data của chiến dịch
  -- (cùng khoá với aka_agent_lock_campaign_input_serialization; luồng nạp Nhóm data, hàm kết thúc v219 và finish_campaign_v2 lấy
  -- khoá này trước khoá dòng chiến dịch), vì nhánh hết hạn bên dưới gọi hàm kết thúc v219.
  IF EXISTS (SELECT 1 FROM public.auto_campaigns x WHERE x.id = v_campaign_id AND x.data_target_source_mode = 'data_group') THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('aka-agent-campaign-input-serialization:' || v_campaign_id::text, 0));
  END IF;
  -- Tài khoản Zalo (trình duyệt) bắt đầu lượt trên Desktop: khoá giới hạn chạy đồng thời của nhân viên như claim bản cũ (v397), để
  -- hai lượt nhận cùng lúc (của bộ mới hay bộ cũ) không cùng đếm N-1 rồi cùng vượt giới hạn.
  IF v_runtime = 'desktop' AND v_req_token IS NULL AND to_regclass('public.org_staff') IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.auto_accounts xa WHERE xa.id = v_account_id AND lower(btrim(coalesce(xa.flatform_type, ''))) = 'zalo'
                   AND coalesce(xa.is_zalo_show_web, false) AND NOT coalesce(xa.is_zalo_server, false)) THEN
    EXECUTE 'SELECT s.max_running_zalo_web_accounts FROM public.org_staff s WHERE s.id = $1' INTO v_max USING v_staff;
    IF v_max IS NOT NULL THEN
      PERFORM pg_advisory_xact_lock(hashtextextended('aka-agent-browser-run-limits:' || v_staff::text, 0));
    END IF;
  END IF;
  -- V558: tài khoản Facebook bắt đầu lượt trên Desktop: cùng khoá giới hạn chạy đồng thời của nhân viên như claim bản cũ (v397 khoá chung
  -- cho Zalo trình duyệt và Facebook), để hai lượt nhận cùng lúc không cùng đếm N-1 rồi cùng vượt giới hạn.
  IF v_runtime = 'desktop' AND v_req_token IS NULL AND to_regclass('public.org_staff') IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.auto_accounts xa WHERE xa.id = v_account_id AND lower(btrim(coalesce(xa.flatform_type, ''))) = 'facebook') THEN
    EXECUTE 'SELECT s.max_running_facebook_accounts FROM public.org_staff s WHERE s.id = $1' INTO v_max USING v_staff;
    IF v_max IS NOT NULL THEN
      PERFORM pg_advisory_xact_lock(hashtextextended('aka-agent-browser-run-limits:' || v_staff::text, 0));
    END IF;
  END IF;
  SELECT * INTO c FROM public.auto_campaigns WHERE id = v_campaign_id FOR UPDATE;
  IF NOT FOUND OR coalesce(c.is_delete, false) OR c.staff_id IS DISTINCT FROM v_staff THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;
  IF c.account_id IS DISTINCT FROM v_account_id THEN RETURN jsonb_build_object('status', 'account_mismatch'); END IF;

  -- Không có công tắc theo loại chiến dịch: bộ chạy chỉ gọi claim cho loại mà lõi đã phủ.
  -- Desktop bản mới tự chạy bộ mới; Fly chỉ chạy bộ mới cho tổ chức bật cờ use_new_zalo_runtime (V371).
  IF v_runtime = 'fly'
     AND NOT coalesce((SELECT o.use_new_zalo_runtime FROM public.org_organization o WHERE o.id = c.organization_id), false) THEN
    RETURN jsonb_build_object('status', 'not_enabled');
  END IF;

  SELECT * INTO a FROM public.auto_accounts WHERE id = v_account_id FOR UPDATE;
  IF NOT FOUND OR coalesce(a.is_delete, false) OR a.staff_id IS DISTINCT FROM v_staff THEN
    RETURN jsonb_build_object('status', 'account_not_found');
  END IF;
  -- V558: tài khoản Facebook chỉ chạy engine trên Desktop, khi tổ chức bật engine.facebook (anh chốt Q1). Kiểm mỗi lần nhận lượt: tắt
  -- (mode off / bỏ tổ chức khỏi danh sách) có hiệu lực ở lần nhận kế tiếp, Desktop nhận not_enabled thì chạy bộ cũ.
  v_is_facebook := lower(btrim(coalesce(a.flatform_type, ''))) = 'facebook';
  IF v_is_facebook THEN
    IF v_runtime <> 'desktop' THEN RETURN jsonb_build_object('status', 'runtime_not_owner'); END IF;
    IF NOT public.aka_agent_engine_facebook_org_enabled(coalesce(c.organization_id, a.organization_id)) THEN
      RETURN jsonb_build_object('status', 'not_enabled');
    END IF;
  END IF;
  -- Bộ cũ còn giữ tài khoản (token thao tác) hoặc một chiến dịch của tài khoản (claim token, unit lease):
  -- chờ, không chạy chồng. Bộ mới không bao giờ dùng hay xoá các token này.
  IF a.runtime_operation_claim_token IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'legacy_busy', 'scope', 'account');
  END IF;
  -- V527: claim token bộ cũ còn sót trên chiến dịch đã xoá / tạm dừng không chặn tài khoản nữa. Trigger
  -- aka_agent_clear_campaign_runtime_claim_metadata cố ý giữ claim khi chiến dịch Server chuyển "đang chạy" → "tạm dừng" (chờ nơi chạy tự
  -- nhả) và App Server nhả tài khoản mà không xoá claim đó, nên claim treo hàng tháng. Chỉ bỏ qua khi đủ cả: tài khoản không còn token
  -- thao tác (kiểm ở trên), chiến dịch không giữ unit lease, không còn data "đang chạy", và cả lúc claim lẫn lần ghi cuối của chiến dịch
  -- (lúc tạm dừng / xoá) đã cũ hơn engine.legacy_stale_claim_minutes phút (mặc định 30, tối thiểu 10). Unit lease,
  -- claim trên chiến dịch chờ / đang chạy và chiến dịch vừa tạm dừng giữa lượt vẫn chặn. Không xoá token nào ở đây.
  IF EXISTS (SELECT 1 FROM public.auto_campaigns x
              WHERE x.account_id = v_account_id AND (x.runtime_claim_token IS NOT NULL OR x.runtime_unit_token IS NOT NULL)) THEN
    v_legacy_setting := btrim(public.aka_agent_engine_setting('engine.legacy_stale_claim_minutes', '30'));
    v_legacy_before := v_now - make_interval(mins => CASE WHEN v_legacy_setting ~ '^[0-9]{1,6}$'
                                                         THEN greatest(10, v_legacy_setting::integer) ELSE 30 END);
    IF EXISTS (SELECT 1 FROM public.auto_campaigns x
                WHERE x.account_id = v_account_id AND (x.runtime_claim_token IS NOT NULL OR x.runtime_unit_token IS NOT NULL)
                  AND NOT (x.runtime_unit_token IS NULL
                           AND (coalesce(x.is_delete, false) OR x.status = 'tạm dừng')
                           AND coalesce(x.runtime_claimed_at, '-infinity'::timestamptz) < v_legacy_before
                           AND coalesce(x.updated_at, '-infinity'::timestamptz) < v_legacy_before
                           AND NOT EXISTS (SELECT 1 FROM public.auto_campaign_input_data d
                                            WHERE d.campaign_id = x.id AND d.status = 'đang chạy'
                                              AND coalesce(d.is_delete, false) = false))) THEN
      RETURN jsonb_build_object('status', 'legacy_busy', 'scope', 'campaign');
    END IF;
  END IF;
  -- Cùng điều kiện nhận lượt của bản cũ (aka_agent_claim_campaign_run_unit_v2): đúng runtime sở hữu
  -- tài khoản, tài khoản còn bật và đã đăng nhập, quyền dùng app, khung giờ cho phép của nhân viên.
  IF (v_runtime = 'fly' AND (lower(btrim(coalesce(a.flatform_type, ''))) <> 'zalo' OR coalesce(a.is_zalo_show_web, false)
                              OR NOT coalesce(a.is_zalo_server, false)))
     OR (v_runtime = 'desktop' AND lower(btrim(coalesce(a.flatform_type, ''))) = 'zalo' AND coalesce(a.is_zalo_server, false)) THEN
    RETURN jsonb_build_object('status', 'runtime_not_owner');
  END IF;
  IF a.is_active IS NOT TRUE OR a.login_status IS DISTINCT FROM 'đã đăng nhập' THEN
    RETURN jsonb_build_object('status', 'account_logged_out', 'loginStatus', a.login_status);
  END IF;
  -- V501 (G7): tài khoản tạm dừng (hay trạng thái khác "chờ xử lý"/"đang chạy") không nhận lượt, như bản cũ. "đang chạy" mà
  -- không còn ai giữ (bộ cũ đã kiểm ở trên bằng token, bộ mới bằng lease bên dưới) là sót lại sau khi app/worker tắt đột ngột.
  IF coalesce(a.status, 'chờ xử lý') NOT IN ('chờ xử lý', 'đang chạy') THEN
    RETURN jsonb_build_object('status', 'account_paused', 'accountStatus', a.status);
  END IF;
  -- Hai hàm có sẵn trên production gọi qua EXECUTE: PL/pgSQL phân giải tên hàm khi lập kế hoạch biểu thức.
  IF to_regprocedure('public.aka_agent_app_access_account_allowed(bigint,text)') IS NOT NULL THEN
    EXECUTE 'SELECT public.aka_agent_app_access_account_allowed($1, $2)' INTO v_allowed USING v_account_id, 'akaAgent';
    IF v_allowed IS NOT TRUE THEN RETURN jsonb_build_object('status', 'app_access_denied', 'reason', 'app_access_account'); END IF;
  END IF;
  IF to_regprocedure('public.aka_agent_staff_time_allowed(bigint)') IS NOT NULL THEN
    EXECUTE 'SELECT public.aka_agent_staff_time_allowed($1)' INTO v_allowed USING v_staff;
    IF v_allowed IS NOT TRUE THEN RETURN jsonb_build_object('status', 'staff_time_blocked'); END IF;
  END IF;
  -- V501: quyền gói Zalo của tổ chức như claim của bản cũ (aka_agent_claim_campaign_runtime_checked): Server cần QR + Server,
  -- tài khoản trình duyệt cần Web, tài khoản QR cần QR.
  v_org := coalesce(c.organization_id, a.organization_id);
  IF lower(btrim(coalesce(a.flatform_type, ''))) = 'zalo' AND v_org IS NOT NULL
     AND to_regprocedure('public.resolve_organization_zalo_account_capabilities(bigint)') IS NOT NULL THEN
    EXECUTE 'SELECT x.qr_enabled, x.web_enabled, x.server_enabled FROM public.resolve_organization_zalo_account_capabilities($1) x'
      INTO v_cap_qr, v_cap_web, v_cap_server USING v_org;
    IF (coalesce(a.is_zalo_server, false) AND NOT (coalesce(v_cap_qr, false) AND coalesce(v_cap_server, false)))
       OR (NOT coalesce(a.is_zalo_server, false) AND coalesce(a.is_zalo_show_web, false) AND NOT coalesce(v_cap_web, false))
       OR (NOT coalesce(a.is_zalo_server, false) AND NOT coalesce(a.is_zalo_show_web, false) AND NOT coalesce(v_cap_qr, false)) THEN
      RETURN jsonb_build_object('status', 'entitlement_denied');
    END IF;
  END IF;
  -- V558: quyền gói Facebook như bộ cũ (entitlementRepository: Facebook dùng được khi tổ chức có gói sản phẩm 3 hoặc 10 còn hạn).
  IF v_is_facebook AND v_org IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.org_organization_product p
                      WHERE p.organization_id = v_org AND p.is_deleted = false AND p.product_id IN (3, 10)
                        AND p.expiration_date IS NOT NULL AND (p.expiration_date AT TIME ZONE 'Asia/Ho_Chi_Minh')::date >= v_vn) THEN
    RETURN jsonb_build_object('status', 'entitlement_denied');
  END IF;
  -- V501 (G10): giới hạn số tài khoản Zalo (trình duyệt) chạy đồng thời của nhân viên, đếm như bản cũ (v397). Chỉ khi bắt đầu
  -- lượt (chưa giữ lease): lượt đang chạy không bị cắt giữa chừng.
  IF v_runtime = 'desktop' AND v_req_token IS NULL AND lower(btrim(coalesce(a.flatform_type, ''))) = 'zalo'
     AND coalesce(a.is_zalo_show_web, false) AND NOT coalesce(a.is_zalo_server, false)
     AND to_regclass('public.org_staff') IS NOT NULL THEN
    EXECUTE 'SELECT s.max_running_zalo_web_accounts FROM public.org_staff s WHERE s.id = $1' INTO v_max USING v_staff;
    IF v_max IS NOT NULL THEN
      SELECT count(DISTINCT x.account_id) INTO v_running
        FROM public.auto_campaigns x
        JOIN public.auto_accounts xa ON xa.id = x.account_id AND xa.staff_id = x.staff_id
       WHERE x.staff_id = v_staff AND xa.id <> v_account_id
         AND (x.organization_id IS NULL OR x.organization_id = v_org)
         AND (xa.organization_id IS NULL OR xa.organization_id = v_org)
         AND (x.status = 'đang chạy' OR x.runtime_claim_token IS NOT NULL OR x.runtime_unit_token IS NOT NULL)
         AND lower(btrim(coalesce(xa.flatform_type, ''))) = 'zalo' AND xa.is_zalo_show_web = true AND xa.is_zalo_server = false;
      IF v_running >= v_max THEN RETURN jsonb_build_object('status', 'concurrency_limit', 'max', v_max); END IF;
    END IF;
  END IF;
  -- V558: giới hạn số tài khoản Facebook chạy đồng thời của nhân viên, đếm như claim bản cũ (v397): chiến dịch "đang chạy" hoặc còn token
  -- của bộ cũ, trên tài khoản Facebook khác của nhân viên. Chỉ khi bắt đầu lượt (chưa giữ lease): lượt đang chạy không bị cắt.
  IF v_runtime = 'desktop' AND v_req_token IS NULL AND v_is_facebook AND to_regclass('public.org_staff') IS NOT NULL THEN
    EXECUTE 'SELECT s.max_running_facebook_accounts FROM public.org_staff s WHERE s.id = $1' INTO v_max USING v_staff;
    IF v_max IS NOT NULL THEN
      SELECT count(DISTINCT x.account_id) INTO v_running
        FROM public.auto_campaigns x
        JOIN public.auto_accounts xa ON xa.id = x.account_id AND xa.staff_id = x.staff_id
       WHERE x.staff_id = v_staff AND xa.id <> v_account_id
         AND (x.organization_id IS NULL OR x.organization_id = v_org)
         AND (xa.organization_id IS NULL OR xa.organization_id = v_org)
         AND (x.status = 'đang chạy' OR x.runtime_claim_token IS NOT NULL OR x.runtime_unit_token IS NOT NULL)
         AND lower(btrim(coalesce(xa.flatform_type, ''))) = 'facebook';
      IF v_running >= v_max THEN RETURN jsonb_build_object('status', 'concurrency_limit', 'max', v_max); END IF;
    END IF;
  END IF;

  -- V501 (G5): chiến dịch Nhóm data đang chờ data mới (không có data đến hạn, không có data đang chạy) khi bắt đầu lượt: như claim của
  -- bản cũ (v397) không nhận lượt và không ghi gì; hàm kết thúc Nhóm data chỉ chạy ở cuối một lượt đã chạy data (finish_campaign_v2).
  IF v_req_token IS NULL AND c.data_target_source_mode = 'data_group' AND c.status = 'chờ xử lý'
     AND NOT (c.schedule_end_date IS NOT NULL AND c.schedule_end_date <= v_now)
     AND NOT EXISTS (SELECT 1 FROM public.auto_campaign_input_data d
                      WHERE d.campaign_id = c.id AND coalesce(d.is_delete, false) = false
                        AND (d.status = 'đang chạy' OR (d.status = 'chờ xử lý' AND (d.schedule IS NULL OR d.schedule <= v_now)))) THEN
    RETURN jsonb_build_object('status', 'data_group_waiting', 'note', c.note);
  END IF;

  -- Giữ chỗ tài khoản có hạn. Lease cũ đã hết hạn thì runner mới lấy được; data dở của lease cũ
  -- vẫn "đang chạy" và chỉ được aka_agent_engine_close_stale_v1 đóng (không bao giờ gửi lại).
  SELECT * INTO l FROM public.auto_engine_leases WHERE account_id = v_account_id FOR UPDATE;
  v_has_lease := FOUND;
  IF v_has_lease AND l.expires_at > v_now AND l.lease_token IS DISTINCT FROM v_req_token THEN
    RETURN jsonb_build_object('status', 'busy', 'runnerId', l.runner_id, 'expiresAt', l.expires_at);
  END IF;
  v_token := CASE WHEN v_has_lease AND l.lease_token = v_req_token AND l.expires_at > v_now THEN l.lease_token ELSE gen_random_uuid() END;
  -- V501: campaign_schedule = lịch của chiến dịch lúc bắt đầu lượt (khung giờ hiện tại của chiến dịch nhiều khung giờ).
  INSERT INTO public.auto_engine_leases AS el (account_id, lease_token, runner_id, runtime_target, campaign_id, acquired_at, heartbeat_at, expires_at, campaign_schedule)
  VALUES (v_account_id, v_token, v_runner, v_runtime, v_campaign_id, v_now, v_now, v_now + make_interval(secs => v_lease_seconds), c.schedule)
  ON CONFLICT (account_id) DO UPDATE SET
    lease_token = EXCLUDED.lease_token, runner_id = EXCLUDED.runner_id, runtime_target = EXCLUDED.runtime_target,
    campaign_id = EXCLUDED.campaign_id,
    acquired_at = CASE WHEN el.lease_token = EXCLUDED.lease_token THEN el.acquired_at ELSE EXCLUDED.acquired_at END,
    campaign_schedule = CASE WHEN el.lease_token = EXCLUDED.lease_token THEN el.campaign_schedule ELSE EXCLUDED.campaign_schedule END,
    heartbeat_at = EXCLUDED.heartbeat_at, expires_at = EXCLUDED.expires_at;

  IF c.status = 'tạm dừng' THEN RETURN jsonb_build_object('status', 'campaign_paused', 'leaseToken', v_token); END IF;
  IF c.status NOT IN ('chờ xử lý', 'đang chạy') THEN
    RETURN jsonb_build_object('status', 'campaign_not_runnable', 'campaignStatus', c.status, 'leaseToken', v_token);
  END IF;
  -- V501 (G10): chiến dịch đang nạp data ban đầu chưa được chạy, như bản cũ.
  IF coalesce(c.provisioning_state, 'ready') <> 'ready' THEN
    RETURN jsonb_build_object('status', 'campaign_not_ready', 'leaseToken', v_token, 'provisioningState', c.provisioning_state);
  END IF;
  IF c.status = 'chờ xử lý' AND c.schedule IS NOT NULL AND c.schedule > v_now THEN
    RETURN jsonb_build_object('status', 'not_due', 'schedule', c.schedule, 'leaseToken', v_token);
  END IF;
  -- V501 (G1): lịch còn là ngày cũ mà chiến dịch chưa qua bảo trì lịch ngày mới: không chạy, nơi chạy cập nhật lịch rồi hỏi
  -- lại (như daily_maintenance_required của bản cũ, v340). Riêng hằng ngày không bật "chạy tiếp hôm sau" thì chạy tiếp ngay.
  IF c.status = 'chờ xử lý' AND c.schedule IS NOT NULL AND c.schedule < v_day_start
     AND NOT (coalesce(nullif(c.schedule_type, ''), 'daily') = 'daily' AND c.continue_next_day IS NOT TRUE) THEN
    RETURN jsonb_build_object('status', 'maintenance_required', 'leaseToken', v_token, 'schedule', c.schedule);
  END IF;
  -- V501 (G5): chiến dịch theo Nhóm data đã hết hạn nhận và chạy data mới: không nhận lượt; kết thúc bằng đúng hàm kết thúc Nhóm data
  -- của bản cũ (finalizeDataGroupCampaignAtHardEnd: dừng nguồn, đóng data chờ "Chiến dịch đã hết hạn", hoàn thành khi không còn data
  -- đang chạy). Hàm chưa có (DB thử) thì chỉ không nhận lượt.
  IF c.data_target_source_mode = 'data_group' AND c.schedule_end_date IS NOT NULL AND c.schedule_end_date <= v_now THEN
    IF to_regprocedure('public.aka_agent_internal_finalize_data_group_campaign_v219(bigint,bigint,bigint,text)') IS NOT NULL THEN
      EXECUTE 'SELECT public.aka_agent_internal_finalize_data_group_campaign_v219($1, $2, $3, $4)' INTO v_dg_result
        USING c.staff_id, c.organization_id, c.id, 'Chiến dịch đã hết thời hạn nhận và chạy data mới';
    END IF;
    RETURN jsonb_build_object('status', 'data_group_hard_end', 'leaseToken', v_token, 'finalize', v_dg_result);
  END IF;
  -- Mốc ngày như bản cũ (daily_stop_due / daily_drain_due / vietnam_day_changed): sau giờ dừng trong ngày
  -- (mặc định 23:59) hoặc khi lease mở từ ngày trước thì không nhận data mới, để bảo trì ngày mới chạy.
  v_boundary := CASE
    WHEN c.daily_stop_time IS NOT NULL
     AND v_now >= ((v_vn + least(c.daily_stop_time, time '23:59:00')) AT TIME ZONE 'Asia/Ho_Chi_Minh') THEN 'daily_stop_due'
    WHEN v_now >= ((v_vn + time '23:59:00') AT TIME ZONE 'Asia/Ho_Chi_Minh') THEN 'daily_drain_due'
    WHEN v_has_lease AND l.lease_token = v_token AND (l.acquired_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date < v_vn THEN 'vietnam_day_changed'
  END;
  IF v_boundary IS NOT NULL THEN
    -- Qua giờ dừng / giờ chốt trong ngày: không nhận data tới 0:00 hôm sau. Qua ngày khi lượt còn mở từ hôm trước:
    -- chỉ kết thúc lượt (nextAt = bây giờ) để bảo trì ngày mới chạy, xong là chạy tiếp ngay trong ngày.
    -- V501: kèm giờ dừng đã cấu hình để lõi in đúng câu ⏹ của Desktop (giờ dừng riêng hay mốc 23:59).
    RETURN jsonb_build_object('status', 'daily_boundary', 'leaseToken', v_token, 'reason', v_boundary, 'stopTime', c.daily_stop_time,
      'nextAt', CASE WHEN v_boundary = 'vietnam_day_changed' THEN v_now
                     ELSE ((v_vn + 1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh') END);
  END IF;

  -- V558: lượt theo lịch (Q4). Mốc lịch = lịch của chiến dịch lúc nhận (chưa có lịch thì lúc tạo). Mỗi mốc chạy một lượt: mốc đã có lượt
  -- đang mở, đã thử với lease này, hoặc đã đóng mà không phải "về hàng đợi" (chờ xử lý) thì xong; claim trả no_target để nơi chạy kết thúc
  -- lượt (finish_campaign tính lịch kế tiếp như bộ cũ). Mỗi chiến dịch tối đa một lượt theo lịch đang mở (chỉ mục V557).
  IF v_slot_mode THEN
    v_slot := coalesce(c.schedule, c.created_at, v_now);
    IF EXISTS (SELECT 1 FROM public.auto_engine_target_runs tr
                WHERE tr.campaign_id = v_campaign_id AND tr.slot_at IS NOT NULL
                  AND (tr.completed_at IS NULL
                       OR (tr.slot_at = v_slot AND (tr.lease_token = v_token OR tr.final_target_status IS DISTINCT FROM 'chờ xử lý')))) THEN
      RETURN jsonb_build_object('status', 'no_target', 'leaseToken', v_token, 'nextSchedule', NULL,
        'runningTargets', (SELECT count(*) FROM public.auto_engine_target_runs tr
                            WHERE tr.campaign_id = v_campaign_id AND tr.slot_at IS NOT NULL AND tr.completed_at IS NULL),
        'hasTargets', true, 'dueTried', 0, 'dataGroup', false, 'slot', true, 'slotAt', v_slot, 'cooldownPaused', '[]'::jsonb);
    END IF;
  END IF;
  -- V501 (G3): mỗi data chỉ thử một lần trong một lượt (như Desktop đi qua danh sách một lần): data vừa về hàng đợi
  -- được thử lại ở lượt sau, các data phía sau vẫn chạy trong lượt này.
  -- V501: chống gửi lặp N ngày (applyRecentDeliveryCooldown của Desktop, trước khi nhận data và trước bước tra số): gọi đúng
  -- RPC của bộ cũ cho data sắp nhận (còn "chờ xử lý", đã khoá). RPC tự tạm dừng data đã gửi gần đây; lõi in "⏸️ Bỏ qua …".
  -- Không ghi lịch sử, không tính lượt, không đổi chuỗi lỗi, không nghỉ. Mỗi lần gọi xét tối đa 50 data, và dừng khi hết ngân sách
  -- thời gian (engine.cooldown_scan_ms, mặc định 1.500 ms tính từ đầu lần gọi; review 12/11): lần gọi từ Desktop có trần 3 giây của
  -- vai trò aka_agent_desktop, quá trần thì cả lần gọi bị huỷ (kể cả các data đã tạm dừng) và lần gọi lại làm lại từ đầu. Trả
  -- cooldown_scan thì các data đã tạm dừng được giữ, lõi gọi lại ngay và đi tiếp từ data kế tiếp.
  v_cooldown := NOT v_slot_mode AND coalesce(c.extra_settings->'recentDeliveryCooldownEnabled' = 'true'::jsonb, false)
    AND to_regprocedure('public.aka_agent_apply_campaign_delivery_cooldown(bigint,bigint,bigint,bigint[])') IS NOT NULL;
  v_cd_deadline := v_now + make_interval(secs => (CASE WHEN public.aka_agent_engine_setting('engine.cooldown_scan_ms', '1500') ~ '^[0-9]{1,6}$'
                                                       THEN greatest(1, public.aka_agent_engine_setting('engine.cooldown_scan_ms', '1500')::integer)
                                                       ELSE 1500 END) / 1000.0);
  -- V503: nhận cả lô (claim_batch_v1) đặt một mốc chung cho mọi lần nhận trong lô, để cả lời gọi không chạm trần 3 giây của Desktop.
  IF nullif(current_setting('aka.engine.claim_deadline', true), '') IS NOT NULL THEN
    v_cd_deadline := least(v_cd_deadline, current_setting('aka.engine.claim_deadline', true)::timestamptz);
  END IF;
  -- V564: đăng nhóm bật "Xáo trộn danh sách group" (lưu kiểu boolean, đo 18/11): xáo khi nhận data kế tiếp của lượt; nhận theo danh sách
  -- inputDataIds (nhóm chia sẻ kèm) và lượt theo lịch không xáo. Mọi chiến dịch khác giữ câu chọn theo d.id + 0 (V532).
  v_shuffle := NOT v_slot_mode AND v_only_ids IS NULL AND c.action_id = 'facebook_group_post'
    AND coalesce(c.extra_settings->'shuffleGroupList' = 'true'::jsonb, false);
  LOOP
    EXIT WHEN v_slot_mode;
    -- V532: sắp theo d.id + 0 (cùng thứ tự) để planner không đi khoá chính auto_campaign_input_data_pkey. Kế hoạch theo tham số có lúc
    -- quét khoá chính từ id nhỏ nhất rồi lọc theo chiến dịch (chiến dịch 34061 ngày 14/11/2026: lọc 12,26 triệu dòng, 6,8 giây, quá
    -- trần 3 giây của Desktop). Sắp theo biểu thức buộc lấy data của chiến dịch qua chỉ mục theo chiến dịch rồi mới sắp (vài chục ms).
    IF v_shuffle THEN
      -- V564: thứ tự ngẫu nhiên theo lượt (md5 theo lease): trong lượt giữ nguyên, lượt sau (lease mới) khác, như bộ cũ xáo ở đầu lượt.
      SELECT d.* INTO t FROM public.auto_campaign_input_data d
       WHERE d.campaign_id = v_campaign_id AND d.status = 'chờ xử lý' AND coalesce(d.is_delete, false) = false
         AND (d.schedule IS NULL OR d.schedule <= v_now)
         AND NOT EXISTS (SELECT 1 FROM public.auto_engine_target_runs tr WHERE tr.input_data_id = d.id AND tr.lease_token = v_token)
         AND d.id <> ALL (v_cd_skip)
       ORDER BY md5(d.id::text || v_token::text), d.id LIMIT 1 FOR UPDATE SKIP LOCKED;
    ELSE
      SELECT d.* INTO t FROM public.auto_campaign_input_data d
       WHERE d.campaign_id = v_campaign_id AND d.status = 'chờ xử lý' AND coalesce(d.is_delete, false) = false
         AND (d.schedule IS NULL OR d.schedule <= v_now)
         AND NOT EXISTS (SELECT 1 FROM public.auto_engine_target_runs tr WHERE tr.input_data_id = d.id AND tr.lease_token = v_token)
         AND d.id <> ALL (v_cd_skip)
         AND (v_only_ids IS NULL OR d.id = ANY (v_only_ids))
       ORDER BY d.id + 0 LIMIT 1 FOR UPDATE SKIP LOCKED;
    END IF;
    v_found := FOUND;
    EXIT WHEN NOT v_found OR NOT v_cooldown;
    v_cd_decision := NULL; v_cd_note := NULL; v_cd_error := NULL;
    BEGIN
      EXECUTE 'SELECT x.decision, x.note FROM public.aka_agent_apply_campaign_delivery_cooldown($1, $2, $3, ARRAY[$4]::bigint[]) x'
        INTO v_cd_decision, v_cd_note USING v_campaign_id, v_account_id, v_staff, t.id;
    EXCEPTION WHEN OTHERS THEN
      v_cd_error := SQLERRM;
    END;
    IF v_cd_error IS NOT NULL THEN
      IF coalesce((SELECT g.on_error FROM public.auto_engine_gates g WHERE g.code = 'delivery_cooldown'), 'closed') = 'open' THEN EXIT; END IF;
      -- Như Desktop: chiến dịch chờ, ghi chú lý do, tự thử lại ở nhịp sau; data giữ nguyên.
      v_wait_note := 'Không thể kiểm tra giới hạn gửi/đăng lặp; chiến dịch sẽ tự thử lại: Không thể kiểm tra lịch sử gửi/đăng gần nhất: ' || v_cd_error;
      UPDATE public.auto_campaigns SET status = 'chờ xử lý', note = v_wait_note, updated_at = v_now
       WHERE id = v_campaign_id AND (status IS DISTINCT FROM 'chờ xử lý' OR note IS DISTINCT FROM v_wait_note);
      RETURN jsonb_build_object('status', 'gate_unavailable', 'leaseToken', v_token, 'gate', 'delivery_cooldown', 'note', v_wait_note,
        'cooldownPaused', v_cd_paused);
    END IF;
    EXIT WHEN v_cd_decision = 'allowed';
    IF v_cd_decision IN ('paused_recent_delivery', 'paused_unidentifiable') THEN
      v_cd_paused := v_cd_paused || jsonb_build_object('inputDataId', t.id, 'name', t.name, 'phone', t.phone, 'uid', t.uid, 'email', t.email,
        'note', coalesce(nullif(btrim(v_cd_note), ''), 'Tạm dừng vì giới hạn gửi/đăng lặp.'));
    END IF;
    v_cd_skip := v_cd_skip || t.id;
    v_cd_scanned := v_cd_scanned + 1;
    IF v_cd_scanned >= 50 OR clock_timestamp() >= v_cd_deadline THEN
      RETURN jsonb_build_object('status', 'cooldown_scan', 'leaseToken', v_token, 'cooldownPaused', v_cd_paused);
    END IF;
  END LOOP;
  IF NOT v_found AND NOT v_slot_mode THEN
    RETURN jsonb_build_object('status', 'no_target', 'leaseToken', v_token,
      'nextSchedule', (SELECT min(d.schedule) FROM public.auto_campaign_input_data d
                        WHERE d.campaign_id = v_campaign_id AND d.status = 'chờ xử lý' AND coalesce(d.is_delete, false) = false AND d.schedule > v_now),
      'runningTargets', (SELECT count(*) FROM public.auto_campaign_input_data d
                          WHERE d.campaign_id = v_campaign_id AND d.status = 'đang chạy' AND coalesce(d.is_delete, false) = false),
      -- Chiến dịch chưa có data nào (khác "đã chạy hết"): host có thể chờ nguồn bơm data thay vì hoàn thành.
      'hasTargets', EXISTS (SELECT 1 FROM public.auto_campaign_input_data d
                             WHERE d.campaign_id = v_campaign_id AND coalesce(d.is_delete, false) = false),
      -- V501: data đến hạn đã thử trong lượt này (về hàng đợi): lượt kết thúc, lượt sau thử lại.
      'dueTried', (SELECT count(*) FROM public.auto_campaign_input_data d
                    WHERE d.campaign_id = v_campaign_id AND d.status = 'chờ xử lý' AND coalesce(d.is_delete, false) = false
                      AND (d.schedule IS NULL OR d.schedule <= v_now)
                      AND EXISTS (SELECT 1 FROM public.auto_engine_target_runs tr WHERE tr.input_data_id = d.id AND tr.lease_token = v_token)),
      'dataGroup', c.data_target_source_mode = 'data_group',
      'cooldownPaused', v_cd_paused);
  END IF;

  v_target_key := public.aka_agent_engine_target_key(t.phone, t.uid, t.email);
  -- V571: chiến dịch nhắn người lạ (theo SĐT / theo UID), không kiêm SMS, tổ chức bật engine.target_check: tra sổ theo SĐT và global id
  -- (UID gắn theo tài khoản nên lấy global id ở zalo_users). Bước tương ứng nhận quyết định skip ở vòng dưới. Kiểm lỗi thì coi như chưa
  -- biết (chạy như thường).
  IF NOT v_slot_mode AND c.action_id IN ('zalo_message_phone', 'zalo_message_group_member', 'zalo_message_group_realtime', 'zalo_message_friend_recommendation', 'zalo_message_remarketing_customer')
     AND NOT coalesce(c.extra_settings->'internalSmsEnabled' = 'true'::jsonb, false)
     AND NOT coalesce(c.extra_settings->'externalSmsEnabled' = 'true'::jsonb, false)
     AND private.aka_agent_engine_target_check_on(c.organization_id) THEN
    BEGIN
      IF nullif(btrim(coalesce(t.uid, '')), '') IS NOT NULL THEN
        SELECT nullif(btrim(coalesce(zu.global_id, '')), ''), coalesce(zu.is_fr = 1, false) INTO v_tc_global, v_tc_friend
          FROM public.zalo_users zu WHERE zu.account_id = v_account_id AND zu.zalo_uid = btrim(t.uid) LIMIT 1;
        v_tc_friend := coalesce(v_tc_friend, false);
      END IF;
      SELECT jsonb_object_agg(x.action_code, x.error_code) INTO v_tc FROM private.aka_agent_engine_target_check_probe(t.phone, v_tc_global) x;
    EXCEPTION WHEN OTHERS THEN
      v_tc := NULL;
    END;
    -- Chặn tin người lạ không áp với tài khoản đã là bạn bè.
    IF v_tc IS NOT NULL AND v_tc_friend THEN v_tc := v_tc - 'zalo_message_stranger'; END IF;
    IF v_tc = '{}'::jsonb THEN v_tc := NULL; END IF;
    -- "Nhắn tin theo SĐT": mọi bước gửi của chiến dịch đã biết hỏng và không tag Zalo / đổi tên / tag akaBiz (các bước cần kết quả tìm SĐT)
    -- thì bỏ luôn bước tìm SĐT; report tách thành một dòng cho mỗi bước gửi.
    IF v_tc IS NOT NULL AND c.action_id = 'zalo_message_phone' AND NOT (v_tc ? 'zalo_find_phone_user')
       AND NOT coalesce(c.extra_settings->'enableZaloTag' = 'true'::jsonb, false)
       AND NOT coalesce(c.extra_settings->'enableZaloAlias' = 'true'::jsonb, false)
       AND NOT coalesce(c.extra_settings->'enableAkaBizTag' = 'true'::jsonb, false) THEN
      -- (Bí danh "ja": "a" là biến bản ghi tài khoản của hàm.)
      SELECT CASE WHEN count(*) > 0 AND bool_and(v_tc ? (ja.value->>'code')) THEN jsonb_object_agg(ja.value->>'code', v_tc->(ja.value->>'code')) END
        INTO v_tc_sends
        FROM jsonb_array_elements(coalesce(p_ctx->'actions', '[]'::jsonb)) ja WHERE ja.value->>'code' <> 'zalo_find_phone_user';
    END IF;
  END IF;
  FOR v_act IN SELECT x.value FROM jsonb_array_elements(coalesce(p_ctx->'actions', '[]'::jsonb)) x LOOP
    v_code := v_act->>'code';
    v_required := coalesce((v_act->>'required')::boolean, true);
    v_decision := jsonb_build_object('decision', 'allow');

    SELECT s.is_disable, s.date_enable, s.disabled_error_code INTO v_lock
      FROM public.auto_account_action_status s WHERE s.account_id = v_account_id AND s.action_code = v_code;
    IF FOUND AND v_lock.is_disable AND (v_lock.date_enable IS NULL OR v_lock.date_enable > v_now) THEN
      v_decision := jsonb_build_object('decision', 'wait', 'gate', 'action_lock', 'errorCode', v_lock.disabled_error_code, 'until', v_lock.date_enable);
    END IF;

    -- Hạn mức tính trong DB theo đúng công thức của bộ chạy Desktop/VPS (aka_agent_engine_action_limit).
    -- V505: thao tác khai "quota": false chỉ kiểm khoá, không kiểm hạn mức (huỷ lời mời kết bạn: limit_check_action_codes rỗng ở bản cũ).
    v_limit := CASE WHEN v_act->'quota' = 'false'::jsonb THEN NULL
                    ELSE public.aka_agent_engine_action_limit(v_campaign_id, v_account_id, v_code) END;
    IF v_decision->>'decision' = 'allow' AND v_limit IS NOT NULL THEN
      v_daily := (v_limit->>'daily')::numeric;
      v_window_count := (v_limit->>'windowCount')::numeric;
      v_window_minutes := (v_limit->>'windowMinutes')::numeric;
      IF coalesce(v_daily, 0) > 0 THEN
        SELECT CASE WHEN s.count_date = v_vn THEN s.count_action_in_day ELSE 0 END INTO v_used
          FROM public.auto_account_action_status s WHERE s.account_id = v_account_id AND s.action_code = v_code;
        IF coalesce(v_used, 0) >= v_daily THEN
          v_decision := jsonb_build_object('decision', 'wait', 'gate', 'quota', 'errorCode', 'error_limit_in_day',
            'until', date_trunc('day', v_now AT TIME ZONE 'Asia/Ho_Chi_Minh') AT TIME ZONE 'Asia/Ho_Chi_Minh' + interval '1 day');
        END IF;
      END IF;
      IF v_decision->>'decision' = 'allow' AND coalesce(v_window_count, 0) > 0 AND coalesce(v_window_minutes, 0) > 0 THEN
        SELECT count(*), min(x.at) INTO v_used, v_oldest FROM (
          -- Như countLimitDetailsInWindow của bộ chạy: không lọc is_delete.
          SELECT d.created_at AS at FROM public.auto_campaign_details d
           WHERE d.account_id = v_account_id AND d.action_code = v_code
             AND d.created_at >= v_now - make_interval(secs => (v_window_minutes * 60)::double precision)
             AND (d.counts_toward_limit IS TRUE OR (d.counts_toward_limit IS NULL AND d.status IN ('thành công', 'thất bại')))
          UNION ALL
          SELECT (m.value->>'markedAt')::timestamptz FROM public.auto_engine_target_runs rr, jsonb_array_elements(rr.marks) m
           WHERE rr.account_id = v_account_id AND rr.completed_at IS NULL
             AND m.value->>'actionCode' = v_code AND m.value->>'state' = 'pending'
        ) x;
        IF v_used >= v_window_count THEN
          -- Như bộ chạy: chờ tới khi lượt cũ nhất ra khỏi khung, ít nhất 60 giây.
          v_decision := jsonb_build_object('decision', 'wait', 'gate', 'quota', 'errorCode', 'error_limit_in_hour',
            'until', greatest(v_now + interval '60 seconds', v_oldest + make_interval(secs => (v_window_minutes * 60)::double precision)));
        END IF;
      END IF;
    END IF;

    -- V571: người nhận đã biết hỏng: bước tìm SĐT bỏ qua kể cả khi đang khoá / hết lượt (không gọi Zalo, không tính lượt); bước gửi chỉ bỏ
    -- qua khi đang được phép (đang chờ thì vẫn chờ như thường) và khi bước tìm SĐT không bị bỏ.
    IF v_tc IS NOT NULL THEN
      IF v_code = 'zalo_find_phone_user' THEN
        IF v_tc ? v_code THEN
          v_decision := jsonb_build_object('decision', 'skip', 'gate', 'target_check', 'errorCode', v_tc->>v_code);
        ELSIF v_tc_sends IS NOT NULL THEN
          v_decision := jsonb_build_object('decision', 'skip', 'gate', 'target_check', 'errorCode', v_tc_sends::text);
        END IF;
      ELSIF v_tc ? v_code AND v_tc_sends IS NULL AND NOT (c.action_id = 'zalo_message_phone' AND v_tc ? 'zalo_find_phone_user')
            AND v_decision->>'decision' = 'allow' THEN
        v_decision := jsonb_build_object('decision', 'skip', 'gate', 'target_check', 'errorCode', v_tc->>v_code);
      END IF;
    END IF;

    -- Thao tác không bắt buộc chỉ được bỏ qua với các cổng khai trong skippableGates (không khai = mọi cổng),
    -- như preflightActions: hết lượt thì bỏ qua được, đang bị khoá thì không.
    IF NOT v_required AND v_decision->>'decision' = 'wait' AND jsonb_typeof(v_act->'skippableGates') = 'array'
       AND NOT (v_act->'skippableGates' ? coalesce(v_decision->>'gate', '')) THEN
      v_required := true;
    END IF;
    IF v_decision->>'decision' = 'wait' THEN
      v_decision := v_decision || jsonb_build_object('note', regexp_replace(
        public.aka_agent_engine_wait_note(v_decision->>'errorCode', nullif(v_decision->>'until', '')::timestamptz), '^⏳ ', ''));
    END IF;
    v_decisions := v_decisions || jsonb_build_object(v_code, v_decision || jsonb_build_object('required', v_required));
    IF v_required AND v_decision->>'decision' = 'wait' AND v_target_wait IS NULL THEN v_target_wait := v_decision; END IF;
  END LOOP;
  -- requireAny: cả nhóm thao tác đều phải chờ thì không nhận data (không tra số khi không gửi được gì),
  -- hẹn lại theo thao tác mở sớm nhất.
  IF v_target_wait IS NULL AND jsonb_typeof(p_ctx->'requireAny') = 'array' AND jsonb_array_length(p_ctx->'requireAny') > 0
     AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(p_ctx->'requireAny') q(code)
                      WHERE coalesce(v_decisions->q.code->>'decision', 'allow') <> 'wait') THEN
    SELECT v_decisions->q.code INTO v_target_wait FROM jsonb_array_elements_text(p_ctx->'requireAny') q(code)
     ORDER BY nullif(v_decisions->q.code->>'until', '')::timestamptz NULLS LAST LIMIT 1;
  END IF;

  -- Bước bắt buộc phải chờ (khoá / hạn mức): không nhận data. V501 (G2): như Desktop, KHÔNG dời lịch chiến dịch (dời lịch
  -- sang ngày sau làm chiến dịch thoát bảo trì lịch ngày mới, chạy lúc 00:00 hay vào ngày không hẹn, và đổi giờ gốc của lịch
  -- lặp khi original_schedule rỗng); chỉ ghi câu chờ khi đổi. Nơi chạy nhớ wait.until để không hỏi lại liên tục.
  IF v_target_wait IS NOT NULL THEN
    v_wait_note := public.aka_agent_engine_wait_note(v_target_wait->>'errorCode', nullif(v_target_wait->>'until', '')::timestamptz);
    UPDATE public.auto_campaigns SET status = 'chờ xử lý', note = v_wait_note, updated_at = v_now
     WHERE id = v_campaign_id AND (status IS DISTINCT FROM 'chờ xử lý' OR note IS DISTINCT FROM v_wait_note);
    RETURN jsonb_build_object('status', 'wait', 'leaseToken', v_token, 'wait', v_target_wait, 'actions', v_decisions, 'cooldownPaused', v_cd_paused);
  END IF;

  -- V564: lần nhận đầu của lượt ở chiến dịch xáo trộn (lease mới, hoặc lõi báo lượt chưa nhận data nào: lần gọi trước trả cooldown_scan đã
  -- cấp lease): số data chờ đến hạn lúc bắt đầu lượt (kể cả data vừa nhận, chưa chuyển "đang chạy"), để lõi in "🔀 Đã xáo trộn danh sách N
  -- group" như bộ cũ (N > 1).
  IF v_shuffle AND (v_req_token IS DISTINCT FROM v_token OR p_ctx->>'unitStarted' = 'false') THEN
    SELECT count(*)::integer INTO v_shuffle_count FROM public.auto_campaign_input_data d
     WHERE d.campaign_id = v_campaign_id AND d.status = 'chờ xử lý' AND coalesce(d.is_delete, false) = false
       AND (d.schedule IS NULL OR d.schedule <= v_now);
  END IF;

  -- Trigger phân quyền ứng dụng (V445) có thể từ chối chuyển "đang chạy": hoàn tác cả bước nhận data
  -- và giữ chỗ, trả trạng thái rõ ràng thay vì lỗi.
  BEGIN
    UPDATE public.auto_campaign_input_data SET status = 'đang chạy' WHERE id = t.id;
    -- Ghi lịch = lúc nhận khi lịch còn là ngày cũ: cổng bảo trì của bộ cũ đếm chiến dịch "đang chạy" có lịch
    -- trước đầu ngày, nên chiến dịch của bộ mới không được giữ cổng đó đóng.
    -- V501 (G6): bắt đầu chạy thì xoá ghi chú (câu chờ cũ), như claim của bản cũ (v397). Lịch ngày cũ chỉ còn tới đây với
    -- hằng ngày không chạy tiếp hôm sau (G1 ở trên).
    UPDATE public.auto_campaigns SET status = 'đang chạy',
           schedule = CASE WHEN schedule IS NULL OR schedule < (v_vn::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh') THEN v_now ELSE schedule END,
           note = CASE WHEN status = 'chờ xử lý' THEN NULL ELSE note END,
           updated_at = v_now
     WHERE id = v_campaign_id
       AND (status = 'chờ xử lý' OR schedule IS NULL OR schedule < (v_vn::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh'));
    IF a.status = 'chờ xử lý' THEN UPDATE public.auto_accounts SET status = 'đang chạy', updated_at = v_now WHERE id = v_account_id; END IF;
    INSERT INTO public.auto_engine_target_runs (input_data_id, campaign_id, account_id, staff_id, organization_id, lease_token, runner_id, runtime_target, started_at,
      slot_at)
    VALUES (CASE WHEN v_slot_mode THEN NULL ELSE t.id END, v_campaign_id, v_account_id, v_staff, c.organization_id, v_token, v_runner, v_runtime, v_now,
      CASE WHEN v_slot_mode THEN v_slot END)
    RETURNING id INTO v_run_id;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE 'app_access%' THEN RAISE; END IF;
    DELETE FROM public.auto_engine_leases WHERE account_id = v_account_id AND lease_token = v_token;
    RETURN jsonb_build_object('status', 'app_access_denied', 'reason', SQLERRM);
  END;

  RETURN jsonb_build_object('status', 'claimed', 'targetRunId', v_run_id, 'leaseToken', v_token,
    'leaseExpiresAt', v_now + make_interval(secs => v_lease_seconds),
    'target', CASE WHEN v_slot_mode
                THEN jsonb_build_object('id', NULL, 'campaign_id', c.id, 'name', c.name, 'phone', NULL, 'uid', NULL, 'email', NULL,
                       'status', 'đang chạy', 'slotAt', v_slot)
                ELSE (to_jsonb(t) - 'status') || jsonb_build_object('status', 'đang chạy') END,
    'targetKey', v_target_key, 'actions', v_decisions,
    -- Cấu hình cổng kiểm cho adapter (on_error: open = lỗi kiểm vẫn gửi; closed = chờ rồi thử lại).
    'gates', (SELECT coalesce(jsonb_object_agg(g.code, jsonb_build_object('onError', g.on_error)), '{}'::jsonb) FROM public.auto_engine_gates g),
    'campaign', jsonb_build_object('id', c.id, 'actionId', c.action_id, 'status', 'đang chạy'),
    'cooldownPaused', v_cd_paused)
    -- V564: chỉ chiến dịch xáo trộn, lần nhận đầu của lượt; câu trả lời của mọi chiến dịch khác không đổi.
    || CASE WHEN v_shuffle_count IS NOT NULL THEN jsonb_build_object('shuffle', jsonb_build_object('count', v_shuffle_count)) ELSE '{}'::jsonb END;
END $function$
;

CREATE OR REPLACE FUNCTION public.aka_agent_engine_report_v1(p_target_run_id bigint, p_lease_token uuid, p_outcomes jsonb, p_final boolean DEFAULT false, p_dry_run boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_vn date := (clock_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date;
  r public.auto_engine_target_runs%ROWTYPE;
  c public.auto_campaigns%ROWTYPE;
  t public.auto_campaign_input_data%ROWTYPE;
  v_lease_ok boolean;
  v_run_open boolean;
  o jsonb;
  v_results jsonb := '[]'::jsonb;
  v_rk text;
  v_prev public.auto_engine_outcomes%ROWTYPE;
  v_is_replay boolean;
  v_action text;
  v_phase text;
  v_ok boolean;
  v_status_id bigint;
  v_signal jsonb;
  v_evidence jsonb;
  v_platform text;
  v_op_class text;
  v_action_name text;
  v_rule_id bigint;
  v_matched_by text;
  v_catch_all boolean;
  v_error_code text;
  v_policy jsonb;
  v_err public.auto_error%ROWTYPE;
  v_delivery text;
  v_count boolean;
  v_mark_idx integer;
  v_mark jsonb;
  v_reserved boolean;
  v_sem record;
  v_log text;
  v_detail_id bigint;
  -- V571: bước bỏ qua vì người nhận đã biết hỏng (gate target_check): mã lỗi đã biết.
  v_tc_code text;
  v_until timestamptz;
  v_lock_until_max timestamptz;
  v_lc text;
  v_side boolean;
  v_decision jsonb;
  v_contrib jsonb;
  v_call jsonb := '[]'::jsonb;
  v_call_new jsonb := '[]'::jsonb;
  v_all jsonb;
  -- Chỉ thị của lượt gọi này.
  v_target_done boolean := false;
  v_run_rank integer := 0;
  v_rank integer;
  v_pace jsonb;
  v_pace_rank integer := 0;
  v_camp_effect text := 'none';
  v_camp_note text;
  v_camp_hold integer;
  v_acc_effect text := 'none';
  v_login_effect text := 'none';
  -- Tổng hợp theo data: mọi kết quả của lượt chạy data này, kể cả các lần gọi trước.
  v_target_effect text;
  v_target_rank integer := 0;
  v_requeue_minutes integer;
  v_note text;
  v_last_error_code text;
  v_last_action text;
  v_streak text := 'ignore';
  v_covered boolean := false;
  v_thr_effect text := 'none';
  v_thr_threshold integer;
  v_thr_hold integer;
  v_thr_source text;
  v_guard_code text;
  v_gp jsonb;
  v_streak_count integer;
  v_any_committed boolean := false;
  v_final_status text;
  v_schedule timestamptz;
  v_safety jsonb := '[]'::jsonb;
  v_camp_applied text := 'none';
  v_camp_rows integer;
  v_next text;
  v_outcome_count integer := 0;
  v_more boolean;
  v_response jsonb;
  -- V503: chế độ báo theo lô, chỉ report_batch_v1 đặt (trong cùng giao dịch, đặt lại rỗng sau mỗi data).
  v_scope text := nullif(current_setting('aka.engine.batch_scope', true), '');
BEGIN
  -- Lô rỗng chỉ hợp lệ khi chốt data (các bước còn lại bị bỏ vì bước trước không đạt).
  IF p_outcomes IS NULL OR jsonb_typeof(p_outcomes) <> 'array' OR (jsonb_array_length(p_outcomes) = 0 AND NOT p_final) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'outcomes_required');
  END IF;
  -- V571: bước tìm SĐT bỏ qua vì mọi bước gửi đã biết hỏng (rememberedErrorCode là JSON {thao tác gửi: mã}): tách thành một kết quả cho mỗi
  -- bước gửi (resultKey đầu giữ nguyên, kết quả sau thêm ':<thao tác>'), như khi các bước đó chạy và Zalo trả lỗi. Gọi lại thì tách y hệt.
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_outcomes) x WHERE x.value->>'statusCode' = 'campaign_detail_skipped'
              AND x.value->'data'->>'gate' = 'target_check' AND left(coalesce(x.value->'data'->>'rememberedErrorCode', ''), 1) = '{') THEN
    SELECT jsonb_agg(z.e ORDER BY z.ord, z.sub) INTO p_outcomes FROM (
      SELECT x.ordinality AS ord, 0::bigint AS sub, x.value AS e FROM jsonb_array_elements(p_outcomes) WITH ORDINALITY x
       WHERE NOT (x.value->>'statusCode' = 'campaign_detail_skipped' AND x.value->'data'->>'gate' = 'target_check'
                  AND left(coalesce(x.value->'data'->>'rememberedErrorCode', ''), 1) = '{')
      UNION ALL
      SELECT x.ordinality, k.n, x.value || jsonb_build_object(
               'actionCode', k.key,
               'actionName', CASE k.key WHEN 'zalo_message_stranger' THEN 'Nhắn tin người lạ' WHEN 'zalo_add_friend' THEN 'Kết bạn' ELSE k.key END,
               'stepKey', k.key,
               'resultKey', btrim(x.value->>'resultKey') || CASE WHEN k.n = 1 THEN '' ELSE ':' || k.key END,
               'data', jsonb_build_object('gate', 'target_check', 'rememberedErrorCode', k.code))
        FROM jsonb_array_elements(p_outcomes) WITH ORDINALITY x
        CROSS JOIN LATERAL (
          SELECT e.key, e.value #>> '{}' AS code,
                 row_number() OVER (ORDER BY CASE e.key WHEN 'zalo_message_stranger' THEN 1 WHEN 'zalo_add_friend' THEN 2 ELSE 3 END, e.key) AS n
            FROM jsonb_each(CASE WHEN pg_input_is_valid(x.value->'data'->>'rememberedErrorCode', 'jsonb')
                                  AND jsonb_typeof((x.value->'data'->>'rememberedErrorCode')::jsonb) = 'object'
                                 THEN (x.value->'data'->>'rememberedErrorCode')::jsonb ELSE '{}'::jsonb END) e) k
       WHERE x.value->>'statusCode' = 'campaign_detail_skipped' AND x.value->'data'->>'gate' = 'target_check'
         AND left(coalesce(x.value->'data'->>'rememberedErrorCode', ''), 1) = '{'
    ) z;
    IF p_outcomes IS NULL OR (jsonb_array_length(p_outcomes) = 0 AND NOT p_final) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'outcomes_required');
    END IF;
  END IF;
  IF (SELECT count(DISTINCT btrim(x.value->>'resultKey')) FROM jsonb_array_elements(p_outcomes) x) <> jsonb_array_length(p_outcomes) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'result_key_duplicate');
  END IF;
  SELECT * INTO r FROM public.auto_engine_target_runs WHERE id = p_target_run_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'run_not_found'); END IF;
  IF r.lease_token IS DISTINCT FROM p_lease_token THEN RETURN jsonb_build_object('ok', false, 'reason', 'lease_token_mismatch'); END IF;

  -- Kiểm cả lô trước khi ghi: lô sai thì không ghi phần nào.
  FOR o IN SELECT x.value FROM jsonb_array_elements(p_outcomes) x LOOP
    v_rk := nullif(btrim(o->>'resultKey'), '');
    IF v_rk IS NULL OR length(v_rk) NOT BETWEEN 8 AND 200 THEN RETURN jsonb_build_object('ok', false, 'reason', 'result_key_required'); END IF;
    SELECT * INTO v_prev FROM public.auto_engine_outcomes WHERE result_key = v_rk;
    IF FOUND THEN
      IF v_prev.target_run_id <> r.id THEN RETURN jsonb_build_object('ok', false, 'reason', 'result_key_conflict', 'resultKey', v_rk); END IF;
      CONTINUE;
    END IF;
    -- V558: kết quả không gắn thao tác (dòng "Tìm data" của tìm data Facebook: bộ cũ ghi không mã thao tác, không tính lượt) phải có tên
    -- ghi lịch sử và chỉ cho chiến dịch Facebook. Engine Zalo không gửi loại này.
    IF nullif(btrim(coalesce(o->>'actionCode', '')), '') IS NULL THEN
      IF nullif(btrim(coalesce(o->>'actionName', '')), '') IS NULL OR NOT EXISTS (
           SELECT 1 FROM public.auto_campaigns xc JOIN public.auto_campaign_actions xa ON xa.id = xc.action_id
            WHERE xc.id = r.campaign_id AND lower(btrim(coalesce(xa.flatform_type, ''))) = 'facebook') THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'action_unknown', 'actionCode', o->>'actionCode');
      END IF;
    ELSIF NOT EXISTS (SELECT 1 FROM public.auto_account_actions aa WHERE aa.code = o->>'actionCode') THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'action_unknown', 'actionCode', o->>'actionCode');
    END IF;
    IF coalesce(nullif(o->>'phase', ''), 'after_send') NOT IN ('before_send', 'in_flight', 'after_send') THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'phase_invalid', 'phase', o->>'phase');
    END IF;
    IF jsonb_typeof(coalesce(o->'ok', 'false'::jsonb)) <> 'boolean' THEN RETURN jsonb_build_object('ok', false, 'reason', 'ok_invalid'); END IF;
    IF coalesce((o->>'ok')::boolean, false) AND NOT EXISTS (SELECT 1 FROM public.auto_status s
         WHERE s.code = coalesce(nullif(o->>'statusCode', ''), 'campaign_detail_success') AND s.component_type = 'campaign_detail'
           AND s.is_active AND NOT s.is_delete) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'status_unknown', 'statusCode', o->>'statusCode');
    END IF;
    -- V558: kết quả lỗi kèm trạng thái (chính sách inherit ghi theo trạng thái block trả) phải là trạng thái lịch sử có thật.
    IF NOT coalesce((o->>'ok')::boolean, false) AND nullif(o->>'statusCode', '') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.auto_status s
         WHERE s.code = o->>'statusCode' AND s.component_type = 'campaign_detail' AND s.is_active AND NOT s.is_delete) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'status_unknown', 'statusCode', o->>'statusCode');
    END IF;
  END LOOP;

  -- V515 (B): gọi lại đúng lần báo đã chốt data (câu trả lời lần đầu bị mất: mạng, hết giờ) khi lease của lượt chạy còn hạn: trả lại câu
  -- trả lời của lần đầu, không áp lại hiệu ứng. Trước V515 lượt data đã đóng nên DB trả 'ownership_lost', lượt chạy dừng mà không nhả
  -- lease (tài khoản đứng tới khi lease hết hạn). Lease hết hạn, hay lời gọi có kết quả mới, thì đi đường cũ.
  IF NOT p_dry_run AND r.completed_at IS NOT NULL AND r.final_response IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_outcomes) x
                      WHERE NOT EXISTS (SELECT 1 FROM public.auto_engine_outcomes eo
                                         WHERE eo.result_key = btrim(x.value->>'resultKey') AND eo.target_run_id = r.id))
     AND EXISTS (SELECT 1 FROM public.auto_engine_leases l
                  WHERE l.account_id = r.account_id AND l.lease_token = p_lease_token AND l.expires_at > v_now) THEN
    SELECT coalesce(jsonb_agg((eo.decision->'result') || jsonb_build_object('replay', true) ORDER BY x.ordinality), '[]'::jsonb)
      INTO v_results
      FROM jsonb_array_elements(p_outcomes) WITH ORDINALITY x
      JOIN public.auto_engine_outcomes eo ON eo.result_key = btrim(x.value->>'resultKey');
    RETURN r.final_response || jsonb_build_object('outcomes', v_results, 'replay', true);
  END IF;

  SELECT * INTO c FROM public.auto_campaigns WHERE id = r.campaign_id;
  SELECT * INTO t FROM public.auto_campaign_input_data WHERE id = r.input_data_id FOR UPDATE;
  v_run_open := r.completed_at IS NULL;
  v_lease_ok := v_run_open AND EXISTS (SELECT 1 FROM public.auto_engine_leases l
    WHERE l.account_id = r.account_id AND l.lease_token = p_lease_token AND l.expires_at > v_now);

  FOR o IN SELECT x.value FROM jsonb_array_elements(p_outcomes) x LOOP
    v_rk := btrim(o->>'resultKey');
    -- Gọi lại cùng result_key: trả lại đúng quyết định cũ, không gộp chính sách lần nữa.
    SELECT * INTO v_prev FROM public.auto_engine_outcomes WHERE result_key = v_rk;
    v_is_replay := FOUND;
    IF v_is_replay THEN
      v_decision := v_prev.decision;
      v_results := v_results || jsonb_build_array((v_decision->'result') || jsonb_build_object('replay', true));
      v_contrib := v_decision->'contrib';
    ELSE
      v_action := nullif(btrim(coalesce(o->>'actionCode', '')), '');
      SELECT aa.flatform_type, coalesce(aa.operation_class, 'delivery'), aa.name INTO v_platform, v_op_class, v_action_name
        FROM public.auto_account_actions aa WHERE aa.code = v_action;
      -- Tên thao tác ghi vào lịch sử: như helper Desktop ("Tìm SĐT"…) khi bộ chạy gửi kèm, không thì tên trong danh mục.
      v_action_name := coalesce(nullif(left(btrim(coalesce(o->>'actionName', '')), 120), ''), v_action_name);
      -- V558: kết quả không gắn thao tác: luật phân loại theo nền tảng của loại chiến dịch; không phải thao tác gửi.
      IF v_action IS NULL THEN
        SELECT lower(btrim(xa.flatform_type)) INTO v_platform FROM public.auto_campaign_actions xa WHERE xa.id = c.action_id;
        v_op_class := 'result';
      END IF;
      v_phase := coalesce(nullif(o->>'phase', ''), 'after_send');
      v_ok := coalesce((o->>'ok')::boolean, false);
      v_signal := coalesce(o->'signal', '{}'::jsonb);
      v_evidence := coalesce(o->'evidence', '{}'::jsonb);
      v_error_code := NULL; v_status_id := NULL; v_rule_id := NULL; v_matched_by := NULL; v_catch_all := NULL; v_err := NULL; v_detail_id := NULL;
      -- V571: bước bỏ qua vì người nhận đã biết hỏng: ghi như kết quả lỗi thật của mã đã biết (cùng chính sách, trạng thái, câu lịch sử,
      -- data đi đâu); hiệu ứng phụ bỏ ở dưới.
      v_tc_code := NULL;
      IF v_ok AND o->>'statusCode' = 'campaign_detail_skipped' AND o->'data'->>'gate' = 'target_check'
         AND EXISTS (SELECT 1 FROM public.auto_error e WHERE e.error_code = o->'data'->>'rememberedErrorCode') THEN
        v_tc_code := o->'data'->>'rememberedErrorCode';
        v_ok := false;
        v_phase := 'after_send';
        v_signal := jsonb_build_object('kind', 'engine', 'code', 'target_check', 'errorCode', v_tc_code);
        v_evidence := '{}'::jsonb;
      END IF;

      IF v_ok THEN
        SELECT s.id INTO v_status_id FROM public.auto_status s
         WHERE s.code = coalesce(nullif(o->>'statusCode', ''), 'campaign_detail_success') AND s.component_type = 'campaign_detail';
      ELSE
        SELECT cs.error_code, cs.rule_id, cs.matched_by, cs.is_catch_all INTO v_error_code, v_rule_id, v_matched_by, v_catch_all
          FROM public.aka_agent_engine_classify_signal(v_platform, v_action, v_phase, v_signal) cs;
        v_error_code := coalesce(v_error_code, 'err_undefined');
        IF coalesce(v_catch_all, true) AND NOT p_dry_run THEN
          INSERT INTO public.auto_outcome_unmatched AS u (platform, action_code, phase, signal_kind, pattern_key, fallback_error_code, sample, hit_count, first_seen_at, last_seen_at)
          VALUES (v_platform, v_action, v_phase, coalesce(nullif(v_signal->>'kind', ''), 'unknown'), coalesce(public.aka_agent_engine_pattern_key(v_signal), ''),
                  v_error_code, v_signal, 1, v_now, v_now)
          ON CONFLICT (platform, action_code, phase, signal_kind, pattern_key) DO UPDATE SET
            hit_count = u.hit_count + 1, last_seen_at = EXCLUDED.last_seen_at, sample = EXCLUDED.sample, fallback_error_code = EXCLUDED.fallback_error_code;
        END IF;
        SELECT * INTO v_err FROM public.auto_error e WHERE e.error_code = v_error_code;
      END IF;

      v_policy := public.aka_agent_engine_resolve_policy(v_error_code, v_status_id, v_action, c.action_id, r.runtime_target, v_phase);
      -- V558: chính sách "trạng thái theo kết quả" (detail_mode = inherit; chính sách Facebook giữ cách ghi của bộ cũ, ghi theo
      -- actionResult.statusCode): dòng lịch sử lấy trạng thái kết quả gửi lên (statusCode), các trường còn NULL theo chính sách của trạng thái
      -- đó. Không gửi statusCode thì dùng trạng thái của chính sách, không có thì "thất bại".
      IF NOT v_ok AND v_policy->>'detail_mode' = 'inherit' THEN
        v_policy := public.aka_agent_engine_resolve_policy(v_error_code, coalesce((SELECT s.id FROM public.auto_status s WHERE s.code = nullif(o->>'statusCode', '')
            AND s.component_type = 'campaign_detail' ORDER BY s.id LIMIT 1), (v_policy->>'detail_status_id')::bigint,
            (SELECT s.id FROM public.auto_status s WHERE s.code = 'campaign_detail_failed' AND s.component_type = 'campaign_detail' ORDER BY s.id LIMIT 1)), v_action, c.action_id, r.runtime_target, v_phase);
        IF v_policy->>'detail_mode' = 'inherit' THEN v_policy := v_policy || jsonb_build_object('detail_mode', 'write'); END IF;
      END IF;
      -- V571: kết quả thay cho bước bỏ qua vì người nhận đã biết hỏng: không tính lượt, không đổi chuỗi data lỗi, không nghỉ giữa data, không
      -- khoá thao tác, không đổi chiến dịch / tài khoản / đăng nhập, lượt chạy tiếp; trạng thái, câu lịch sử, data đi đâu theo chính sách của mã.
      IF v_tc_code IS NOT NULL THEN
        v_policy := v_policy || jsonb_build_object('quota_effect', 'no_count', 'target_streak_effect', 'ignore', 'pace_mode', 'none',
          'pace_seconds', NULL, 'lock_action_codes', '[]'::jsonb, 'campaign_effect', 'none', 'account_effect', 'none', 'login_effect', 'none',
          'run_effect', 'continue');
      END IF;
      SELECT * INTO v_sem FROM public.aka_agent_status_semantics((v_policy->>'detail_status_id')::bigint);

      -- Trạng thái giao: chỉ thao tác loại delivery mới có thể "đã giao".
      v_delivery := CASE
        WHEN v_op_class <> 'delivery' THEN 'none'
        WHEN v_ok THEN CASE WHEN coalesce(v_sem.counts_as_delivered, false) THEN 'delivered' ELSE 'none' END
        WHEN coalesce((v_evidence->>'partialDelivery')::boolean, false) THEN 'partial'
        WHEN v_phase = 'in_flight' OR v_policy->>'error_class' = 'unknown_delivery' OR v_evidence->>'deliveryState' = 'unknown' THEN 'unknown'
        ELSE 'not_delivered' END;
      -- V501: giao một phần như finalizeZaloPartialSendDetail của Desktop: luôn ghi dòng "thất bại", không đổi chuỗi data lỗi
      -- (trừ khi do media quá giờ), data hoàn thành; chính sách không ghi lịch sử (như khoá 802 với người lạ) vẫn ghi.
      IF v_delivery = 'partial' AND NOT v_ok THEN
        v_policy := v_policy || jsonb_build_object('detail_mode', 'write',
          'detail_status_id', coalesce((SELECT s.id FROM public.auto_status s WHERE s.code = 'campaign_detail_failed' AND s.component_type = 'campaign_detail'
                                         ORDER BY s.id LIMIT 1), (v_policy->>'detail_status_id')::bigint),
          'target_streak_effect', CASE WHEN v_signal->>'code' = 'campaign_media_timeout' THEN v_policy->>'target_streak_effect' ELSE 'ignore' END,
          -- Hiệu ứng chiến dịch phụ thuộc ngưỡng (N lần liền, ví dụ 127 [Q4]) chỉ có nghĩa khi kết quả cộng chuỗi; không cộng chuỗi
          -- thì không được áp ngay (khoá thao tác của mã vẫn giữ).
          'campaign_effect', CASE WHEN v_signal->>'code' IS DISTINCT FROM 'campaign_media_timeout' AND (v_policy->>'streak_threshold') IS NOT NULL
                                  THEN 'none' ELSE v_policy->>'campaign_effect' END,
          'target_effect', 'complete');
        SELECT * INTO v_sem FROM public.aka_agent_status_semantics((v_policy->>'detail_status_id')::bigint);
      END IF;

      -- V503: báo cả lô gửi dạng chia sẻ (policyHandling của Desktop). Lô có người đã nhận được (chia sẻ xong hoặc đã nhận media) thì lỗi
      -- của người khác chỉ ghi cho người đó (target_only): không khoá thao tác, không đổi chiến dịch / tài khoản / đăng nhập, không dừng
      -- lượt, không cộng chuỗi data lỗi. Lô không ai nhận được thì chỉ người có hiệu ứng mạnh nhất áp đủ chính sách; người khác
      -- (batch_followup) bỏ hiệu ứng phụ nhưng vẫn theo chuỗi data lỗi. Data đi đâu, ghi lịch sử, hạn mức, nhớ mục tiêu: theo chính sách.
      IF NOT v_ok AND v_scope IN ('target_only', 'batch_followup') THEN
        v_policy := v_policy || jsonb_build_object('lock_action_codes', '[]'::jsonb, 'campaign_effect', 'none', 'account_effect', 'none',
          'login_effect', 'none', 'run_effect', 'continue')
          || CASE WHEN v_scope = 'target_only' THEN jsonb_build_object('target_streak_effect', 'ignore') ELSE '{}'::jsonb END;
      END IF;

      -- V558: lỗi khi data đã có kết quả gửi thành công trong lượt này (đăng bài xong rồi comment lỗi): chính sách khai
      -- streak_after_delivery = ignore thì không cộng chuỗi data lỗi, hiệu ứng chiến dịch có ngưỡng không áp (targetOnlyFailure của bộ cũ
      -- cho comment Facebook, actionResultRuntime.ts:160-161). Hiệu ứng không ngưỡng, khoá thao tác, data đi đâu vẫn theo chính sách.
      IF NOT v_ok AND v_policy->>'streak_after_delivery' = 'ignore'
         AND (EXISTS (SELECT 1 FROM public.auto_engine_outcomes eo WHERE eo.target_run_id = r.id AND eo.delivery_state IN ('delivered', 'partial'))
              OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_call_new) x WHERE x.value->>'delivery' IN ('delivered', 'partial'))) THEN
        v_policy := v_policy || jsonb_build_object('target_streak_effect', 'ignore',
          'campaign_effect', CASE WHEN (v_policy->>'streak_threshold') IS NOT NULL THEN 'none' ELSE v_policy->>'campaign_effect' END);
      END IF;

      -- Giải quyết dấu "sắp gửi" của bước này.
      v_reserved := false; v_mark_idx := NULL; v_mark := NULL;
      SELECT (x.ordinality - 1)::integer, x.value INTO v_mark_idx, v_mark
        FROM jsonb_array_elements(r.marks) WITH ORDINALITY x
       WHERE x.value->>'stepKey' = coalesce(nullif(o->>'stepKey', ''), v_action) AND x.value->>'state' = 'pending'
       LIMIT 1;
      IF v_mark_idx IS NOT NULL THEN
        v_reserved := (v_mark->>'reservedQuotaDate')::date = v_vn;
        r.marks := jsonb_set(r.marks, ARRAY[v_mark_idx::text, 'state'],
          to_jsonb(CASE WHEN v_delivery = 'none' THEN 'not_delivered' ELSE v_delivery END));
      ELSIF v_op_class = 'delivery' AND v_delivery IN ('delivered', 'partial', 'unknown') THEN
        v_safety := v_safety || jsonb_build_array(jsonb_build_object('rule', 'unmarked_delivery', 'actionCode', v_action, 'resultKey', v_rk));
      END IF;

      -- Giao một phần luôn tính lượt (giống partialDelivery hiện nay).
      v_count := CASE v_policy->>'quota_effect' WHEN 'count' THEN true WHEN 'no_count' THEN false
                 ELSE v_delivery IN ('delivered', 'partial', 'unknown') END
                 OR v_delivery = 'partial';
      -- V558: kết quả không gắn thao tác không tính lượt (như bộ cũ ghi dòng "Tìm data").
      IF v_action IS NULL THEN v_count := false; END IF;
      IF NOT p_dry_run THEN
        IF v_reserved AND NOT v_count THEN
          UPDATE public.auto_account_action_status SET count_action_in_day = greatest(count_action_in_day - 1, 0), updated_at = v_now
           WHERE account_id = r.account_id AND action_code = v_action AND count_date = v_vn;
        ELSIF NOT v_reserved AND v_count THEN
          INSERT INTO public.auto_account_action_status AS s (account_id, action_code, count_action_in_day, count_date)
          VALUES (r.account_id, v_action, 1, v_vn)
          ON CONFLICT (account_id, action_code) DO UPDATE SET
            count_action_in_day = CASE WHEN s.count_date = v_vn THEN s.count_action_in_day + 1 ELSE 1 END, count_date = v_vn, updated_at = v_now;
        END IF;
      END IF;

      -- Khoá thao tác (sự thật về tài khoản: áp cả khi lease đã mất).
      v_until := NULL;
      IF jsonb_array_length(coalesce(v_policy->'lock_action_codes', '[]'::jsonb)) > 0 THEN
        v_until := public.aka_agent_engine_lock_until(v_policy->>'lock_mode', (v_policy->>'lock_minutes')::integer,
          (v_policy->>'lock_days')::integer, (v_policy->>'lock_time')::time, v_now);
      END IF;

      v_log := CASE
        WHEN v_ok THEN coalesce(public.aka_agent_engine_render(v_policy->>'log_template',
                  jsonb_build_object('name', coalesce(t.name, ''), 'action', v_action_name)), nullif(o->>'customerLog', ''),
                  coalesce(v_action_name, v_action) || ': ' || coalesce(v_sem.status_value, 'thành công'))
        ELSE coalesce(
                  public.aka_agent_engine_render(v_policy->>'log_template',
                    jsonb_build_object('name', coalesce(t.name, ''), 'action', v_action_name, 'message', coalesce(v_signal->>'message', ''),
                      'until', public.aka_agent_engine_format_vn(v_until), 'code', v_err.public_code)),
                  public.aka_agent_engine_render(coalesce(v_err.customer_title, v_err.noti_running_process, v_err.error_name),
                    jsonb_build_object('name', coalesce(t.name, ''), 'action', v_action_name, 'message', coalesce(v_signal->>'message', ''),
                      'until', public.aka_agent_engine_format_vn(v_until), 'code', v_err.public_code)),
                  coalesce(v_action_name, v_action) || ' không thành công')
             || CASE WHEN v_err.public_code IS NOT NULL THEN ' (' || v_err.public_code || ')' ELSE '' END
        END;
      -- V501: tiền tố của Desktop cho giao một phần.
      IF v_delivery = 'partial' AND NOT v_ok THEN
        v_log := CASE WHEN v_evidence->>'partialStage' = 'media_after_content' THEN 'Đã gửi nội dung nhưng gửi file thất bại. '
                      ELSE 'Đã gửi file nhưng gửi nội dung thất bại. ' END || v_log;
      END IF;

      IF NOT p_dry_run THEN
        FOR v_lc IN SELECT jsonb_array_elements_text(coalesce(v_policy->'lock_action_codes', '[]'::jsonb)) LOOP
          IF EXISTS (SELECT 1 FROM public.auto_account_actions aa WHERE aa.code = v_lc) THEN
            INSERT INTO public.auto_account_action_status AS s (account_id, action_code, is_disable, date_enable, disabled_error_code, disabled_reason, disabled_at)
            VALUES (r.account_id, v_lc, true, v_until, v_error_code, v_log, v_now)
            ON CONFLICT (account_id, action_code) DO UPDATE SET is_disable = true, date_enable = EXCLUDED.date_enable,
              disabled_error_code = EXCLUDED.disabled_error_code, disabled_reason = EXCLUDED.disabled_reason, disabled_at = EXCLUDED.disabled_at, updated_at = v_now;
          END IF;
        END LOOP;

        IF v_policy->>'detail_mode' = 'write' THEN
          INSERT INTO public.auto_campaign_details (input_data_id, campaign_id, account_id, action_name, action_code, status, status_id, sub_status_id,
            error_code, counts_toward_limit, report_group, log, data, policy_snapshot, result_key, created_at, post_url)
          VALUES (r.input_data_id, r.campaign_id, r.account_id, v_action_name, v_action, coalesce(v_sem.status_value, 'thất bại'),
            (v_policy->>'detail_status_id')::bigint, (v_policy->>'sub_status_id')::bigint, v_error_code, v_count, v_sem.report_group, v_log,
            -- V571: dòng thay cho bước bỏ qua không ghi tín hiệu / dữ liệu của cổng (không có gì nhắc tới việc kiểm).
            CASE WHEN v_tc_code IS NOT NULL THEN jsonb_build_object('engine', 'v2', 'phase', v_phase, 'deliveryState', v_delivery)
                 ELSE jsonb_build_object('engine', 'v2', 'phase', v_phase, 'deliveryState', v_delivery, 'signal', v_signal - 'trace', 'evidence', v_evidence)
                        || coalesce(o->'data', '{}'::jsonb) END,
            jsonb_build_object('engine', 'v2',
              'operationState', CASE WHEN v_delivery IN ('delivered', 'partial') THEN 'committed'
                                     WHEN v_delivery = 'unknown' THEN 'unknown' ELSE 'not_committed' END,
              'actionCode', v_action, 'statusCode', v_sem.status_code, 'errorCode', v_error_code, 'countsTowardLimit', v_count,
              'badTargetEffect', v_policy->>'target_streak_effect',
              'v2', jsonb_build_object('errorClass', v_policy->>'error_class', 'ruleId', v_rule_id, 'matchedBy', v_matched_by,
                'policyIds', v_policy->'policy_ids', 'revisions', v_policy->'revisions', 'targetRunId', r.id)
                -- V571: dấu nội bộ để việc nạp lịch sử bỏ qua dòng này (không phải kết quả Zalo thật).
                || CASE WHEN v_tc_code IS NOT NULL THEN jsonb_build_object('targetCheck', true) ELSE '{}'::jsonb END),
            v_rk, v_now, nullif(o->'data'->>'postUrl', ''))
          RETURNING id INTO v_detail_id;
        END IF;
      END IF;

      v_side := jsonb_array_length(coalesce(v_policy->'lock_action_codes', '[]'::jsonb)) > 0
        OR coalesce(v_policy->>'campaign_effect', 'none') <> 'none'
        OR coalesce(v_policy->>'account_effect', 'none') <> 'none'
        OR coalesce(v_policy->>'login_effect', 'none') <> 'none';
      v_contrib := jsonb_build_object(
        'seq', r.outcome_count + v_outcome_count + 1,
        'ok', v_ok, 'actionCode', v_action, 'errorCode', v_error_code, 'delivery', v_delivery,
        'targetEffect', CASE WHEN v_ok AND v_policy->>'remaining_steps' <> 'skip' THEN NULL ELSE v_policy->>'target_effect' END,
        'requeueAfterMinutes', v_policy->'requeue_after_minutes',
        'remaining', v_policy->>'remaining_steps',
        'streak', v_policy->>'target_streak_effect', 'streakThreshold', v_policy->'streak_threshold', 'sideEffect', v_side,
        'runEffect', v_policy->>'run_effect',
        'pace', jsonb_build_object('mode', v_policy->>'pace_mode', 'seconds', v_policy->'pace_seconds'),
        'campaignEffect', v_policy->>'campaign_effect', 'campaignHoldMinutes', v_policy->'campaign_hold_minutes',
        'campaignNote', CASE WHEN v_policy->>'campaign_effect' IN ('pause', 'hold') THEN
             -- Như renderZaloPolicyCampaignNote: [x]/[t] là số phút khoá (khoá theo phút), không thì câu lỗi.
             coalesce(public.aka_agent_engine_render(coalesce(v_policy->>'campaign_note_template', v_err.noti_campaign),
               jsonb_build_object('name', coalesce(t.name, ''), 'action', v_action_name, 'message', coalesce(v_signal->>'message', ''),
                 'until', public.aka_agent_engine_format_vn(v_until),
                 'x', CASE WHEN v_policy->>'lock_mode' IS DISTINCT FROM 'days_at_time' AND coalesce((v_policy->>'lock_minutes')::integer, 0) > 0
                           THEN v_policy->>'lock_minutes' ELSE coalesce(v_signal->>'message', '') END,
                 't', CASE WHEN v_policy->>'lock_mode' IS DISTINCT FROM 'days_at_time' AND coalesce((v_policy->>'lock_minutes')::integer, 0) > 0
                           THEN v_policy->>'lock_minutes' ELSE '' END)), v_log)
             || CASE WHEN v_err.public_code IS NOT NULL
                     AND position('(' || v_err.public_code || ')' IN coalesce(public.aka_agent_engine_render(coalesce(v_policy->>'campaign_note_template', v_err.noti_campaign), '{}'::jsonb), v_log)) = 0
                  THEN ' (' || v_err.public_code || ')' ELSE '' END
           ELSE NULL END,
        'accountEffect', v_policy->>'account_effect', 'loginEffect', v_policy->>'login_effect',
        'lockUntil', v_until, 'log', v_log);
      -- V517: decision chỉ giữ result (gọi lại lần báo) và contrib (gộp lượt); chính sách đã gộp không lưu nữa (không hàm nào đọc
      -- lại; lịch sử có policyIds/revisions). Mỗi dòng auto_engine_outcomes nhẹ đi ~500 byte.
      v_decision := jsonb_build_object(
        'result', jsonb_build_object('resultKey', v_rk, 'actionCode', v_action, 'actionName', v_action_name, 'ok', v_ok, 'errorCode', v_error_code,
          'publicCode', v_err.public_code, 'errorClass', v_policy->>'error_class', 'statusId', (v_policy->>'detail_status_id')::bigint,
          'statusCode', v_sem.status_code, 'reportGroup', v_sem.report_group, 'deliveryState', v_delivery, 'countsTowardLimit', v_count,
          'detailId', v_detail_id, 'log', v_log, 'lockUntil', v_until),
        'contrib', v_contrib);
      IF NOT p_dry_run THEN
        INSERT INTO public.auto_engine_outcomes (result_key, target_run_id, input_data_id, campaign_id, account_id, action_code, phase, ok,
          error_code, status_id, delivery_state, detail_id, decision, signal, created_at)
        -- V558: kết quả không gắn thao tác ghi chuỗi rỗng ở bảng nội bộ này (cột bắt buộc); dòng lịch sử để trống mã thao tác như bộ cũ.
        VALUES (v_rk, r.id, r.input_data_id, r.campaign_id, r.account_id, coalesce(v_action, ''), v_phase, v_ok, v_error_code,
          (v_policy->>'detail_status_id')::bigint, v_delivery, v_detail_id, v_decision, v_signal, v_now);
      END IF;
      v_results := v_results || jsonb_build_array(v_decision->'result');
      v_outcome_count := v_outcome_count + 1;
      v_call_new := v_call_new || jsonb_build_array(v_contrib);
    END IF;
    v_call := v_call || jsonb_build_array(v_contrib);
  END LOOP;

  -- Lượt gọi này: data xong chưa (bước còn lại có chạy tiếp không), hiệu ứng áp ngay.
  -- run_effect (dừng lượt/tài khoản/chiến dịch) chỉ có hiệu lực SAU khi data hiện tại xong,
  -- giống stopAfterTarget hiện nay; các bước còn lại của data vẫn chạy trừ khi remaining_steps=skip.
  FOR v_contrib IN SELECT x.value FROM jsonb_array_elements(v_call) x LOOP
    IF v_contrib->>'remaining' = 'skip' THEN v_target_done := true; END IF;
    -- Hiệu ứng chiến dịch áp ngay khi mã không có ngưỡng (applyRuntimeErrorPolicy hiện nay). Có ngưỡng (N data lỗi liền) thì chỉ
    -- xét ở cuối data, khi kết quả tăng chuỗi. V532: kết quả có ngưỡng mà không tăng chuỗi (bước phụ gắn tag / đổi tên Zalo không
    -- bao giờ đổi chuỗi lỗi) không còn tạm dừng chiến dịch ngay, như nguyên tắc V501 cho giao một phần; khoá thao tác, dừng lượt và
    -- data đi đâu của mã vẫn giữ.
    IF coalesce(v_contrib->>'campaignEffect', 'none') <> 'none'
       AND (v_contrib->>'streakThreshold') IS NULL
       AND (v_camp_effect = 'none' OR (v_contrib->>'campaignEffect' = 'pause' AND v_camp_effect = 'hold')) THEN
      v_camp_effect := v_contrib->>'campaignEffect';
      v_camp_note := v_contrib->>'campaignNote';
      v_camp_hold := (v_contrib->>'campaignHoldMinutes')::integer;
    END IF;
    IF coalesce(v_contrib->>'accountEffect', 'none') = 'pause' THEN v_acc_effect := 'pause'; END IF;
    IF coalesce(v_contrib->>'loginEffect', 'none') <> 'none' THEN v_login_effect := v_contrib->>'loginEffect'; END IF;
    IF (v_contrib->>'lockUntil') IS NOT NULL THEN
      v_lock_until_max := greatest(coalesce(v_lock_until_max, (v_contrib->>'lockUntil')::timestamptz), (v_contrib->>'lockUntil')::timestamptz);
    END IF;
  END LOOP;
  v_target_done := v_target_done OR p_final;

  IF v_target_done THEN
    SELECT coalesce(jsonb_agg(eo.decision->'contrib' ORDER BY (eo.decision->'contrib'->>'seq')::integer, eo.result_key), '[]'::jsonb) INTO v_all
      FROM public.auto_engine_outcomes eo WHERE eo.target_run_id = r.id;
    IF p_dry_run THEN v_all := v_all || v_call_new; END IF;
    -- Không bao giờ đóng data mà không có kết quả nào (chống "thành công giả"): runtime phải báo no_outcome.
    IF jsonb_array_length(v_all) = 0 THEN RETURN jsonb_build_object('ok', false, 'reason', 'no_outcomes'); END IF;
    FOR v_contrib IN SELECT x.value FROM jsonb_array_elements(v_all) x LOOP
      IF v_contrib->>'delivery' IN ('delivered', 'partial', 'unknown') THEN v_any_committed := true; END IF;
      -- Sau khi data xong: dừng lượt/tài khoản/chiến dịch theo kết quả nặng nhất của data này.
      v_rank := greatest(
        CASE v_contrib->>'runEffect' WHEN 'stop_campaign' THEN 4 WHEN 'stop_account' THEN 3 WHEN 'end_unit' THEN 2 ELSE 0 END,
        -- V532: cùng điều kiện với hiệu ứng áp ngay ở trên (hiệu ứng có ngưỡng chỉ dừng lượt qua nhánh ngưỡng).
        CASE WHEN coalesce(v_contrib->>'campaignEffect', 'none') <> 'none'
              AND (v_contrib->>'streakThreshold') IS NULL THEN 4 ELSE 0 END,
        CASE WHEN coalesce(v_contrib->>'accountEffect', 'none') <> 'none' OR coalesce(v_contrib->>'loginEffect', 'none') <> 'none' THEN 3 ELSE 0 END);
      IF v_rank > v_run_rank THEN v_run_rank := v_rank; END IF;
      -- Nghỉ sau data theo kết quả "nặng" nhất: full > short > none (bản cũ nghỉ sau mọi data).
      v_rank := CASE v_contrib->'pace'->>'mode' WHEN 'full' THEN 3 WHEN 'short' THEN 2 WHEN 'none' THEN 1 ELSE 0 END;
      IF v_rank > v_pace_rank OR (v_rank = v_pace_rank AND v_rank > 0
           AND coalesce((v_contrib->'pace'->>'seconds')::integer, -1) > coalesce((v_pace->>'seconds')::integer, -1)) THEN
        v_pace_rank := v_rank; v_pace := v_contrib->'pace';
      END IF;
      IF v_contrib->>'targetEffect' IS NOT NULL THEN
        v_rank := CASE v_contrib->>'targetEffect' WHEN 'hold' THEN 3 WHEN 'requeue' THEN 2 WHEN 'requeue_after' THEN 2 ELSE 1 END;
        IF v_rank > v_target_rank THEN
          v_target_rank := v_rank; v_target_effect := v_contrib->>'targetEffect';
          v_requeue_minutes := (v_contrib->>'requeueAfterMinutes')::integer;
        END IF;
      END IF;
      IF NOT coalesce((v_contrib->>'ok')::boolean, false) THEN
        v_note := v_contrib->>'log'; v_last_error_code := v_contrib->>'errorCode'; v_last_action := v_contrib->>'actionCode';
      END IF;
      -- Chuỗi mục tiêu lỗi: increment > reset > ignore (giống aggregateResultEffects).
      IF v_contrib->>'streak' = 'increment' THEN
        v_streak := 'increment';
        IF (v_contrib->>'streakThreshold') IS NOT NULL OR coalesce((v_contrib->>'sideEffect')::boolean, false) THEN v_covered := true; END IF;
      ELSIF v_contrib->>'streak' = 'reset' AND v_streak <> 'increment' THEN
        v_streak := 'reset';
      END IF;
      IF coalesce(v_contrib->>'campaignEffect', 'none') <> 'none' AND (v_contrib->>'streakThreshold') IS NOT NULL
         AND v_contrib->>'streak' = 'increment'
         AND (v_thr_effect = 'none' OR (v_contrib->>'campaignEffect' = 'pause' AND v_thr_effect = 'hold')) THEN
        v_thr_effect := v_contrib->>'campaignEffect';
        v_thr_threshold := (v_contrib->>'streakThreshold')::integer;
        v_thr_hold := (v_contrib->>'campaignHoldMinutes')::integer;
        v_thr_source := v_contrib->>'errorCode';
      END IF;
    END LOOP;
    -- Bước đã giao trước đó trong lượt này cũng chặn việc trả về hàng đợi.
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(r.marks) m WHERE m.value->>'state' IN ('pending', 'delivered', 'partial', 'unknown')) THEN
      v_any_committed := true;
    END IF;

    v_target_effect := coalesce(v_target_effect, 'complete');
    IF v_target_effect IN ('requeue', 'requeue_after') AND v_any_committed THEN
      v_safety := v_safety || jsonb_build_array(jsonb_build_object('rule', 'no_requeue_after_delivery', 'from', v_target_effect));
      v_target_effect := 'complete';
    END IF;
    v_final_status := CASE v_target_effect WHEN 'hold' THEN 'tạm dừng' WHEN 'complete' THEN 'hoàn thành' ELSE 'chờ xử lý' END;
    v_schedule := CASE WHEN v_target_effect = 'requeue_after'
      THEN coalesce(v_lock_until_max, v_now + make_interval(mins => coalesce(v_requeue_minutes, 0))) ELSE NULL END;
    -- V501 (G3): data vừa về hàng đợi không được nhận lại trong cùng lượt (claim bỏ qua data đã thử với lease này), nên
    -- lượt chạy tiếp các data phía sau thay vì kết thúc.

    -- Chuỗi lỗi chỉ đổi khi lượt chạy còn mở (báo muộn sau khi data đã bị đóng không đếm lại).
    IF v_run_open AND NOT p_dry_run AND v_streak = 'increment' THEN
      INSERT INTO public.auto_campaign_error_state AS es (campaign_id, count_consecutive_bad_targets, last_input_data_id, last_reason, last_bad_target_at)
      VALUES (r.campaign_id, 1, r.input_data_id, coalesce(v_last_error_code, v_note), v_now)
      ON CONFLICT (campaign_id) DO UPDATE SET count_consecutive_bad_targets = es.count_consecutive_bad_targets + 1,
        last_input_data_id = EXCLUDED.last_input_data_id, last_reason = EXCLUDED.last_reason, last_bad_target_at = EXCLUDED.last_bad_target_at, updated_at = v_now
      RETURNING count_consecutive_bad_targets INTO v_streak_count;
    ELSIF v_run_open AND NOT p_dry_run AND v_streak = 'reset' THEN
      UPDATE public.auto_campaign_error_state SET count_consecutive_bad_targets = 0, updated_at = v_now WHERE campaign_id = r.campaign_id;
      v_streak_count := 0;
    ELSE
      SELECT es.count_consecutive_bad_targets INTO v_streak_count FROM public.auto_campaign_error_state es WHERE es.campaign_id = r.campaign_id;
      v_streak_count := CASE WHEN NOT v_run_open THEN coalesce(v_streak_count, 0)
                             WHEN v_streak = 'increment' THEN coalesce(v_streak_count, 0) + 1
                             WHEN v_streak = 'reset' THEN 0 ELSE coalesce(v_streak_count, 0) END;
    END IF;

    -- Ngưỡng chung: mã tăng chuỗi mà không có ngưỡng/hiệu ứng riêng thì theo mã canh chuỗi
    -- (mặc định err_undefined), giống guard đang chạy ở campaignScheduler.
    IF v_streak = 'increment' AND NOT v_covered AND v_thr_effect = 'none' THEN
      v_guard_code := nullif(btrim(public.aka_agent_engine_setting('engine.bad_target_guard_error_code', 'err_undefined')), '');
      IF v_guard_code IS NOT NULL AND EXISTS (SELECT 1 FROM public.auto_error e WHERE e.error_code = v_guard_code AND e.is_active AND NOT e.is_delete) THEN
        v_gp := public.aka_agent_engine_resolve_policy(v_guard_code, NULL, coalesce(v_last_action, ''), c.action_id, r.runtime_target, 'after_send');
        IF (v_gp->>'streak_threshold') IS NOT NULL AND coalesce(v_gp->>'campaign_effect', 'none') <> 'none' THEN
          v_thr_effect := v_gp->>'campaign_effect';
          v_thr_threshold := (v_gp->>'streak_threshold')::integer;
          v_thr_hold := (v_gp->>'campaign_hold_minutes')::integer;
          v_thr_source := v_guard_code;
        END IF;
      END IF;
    END IF;
    IF v_run_open AND v_thr_effect <> 'none' AND v_streak = 'increment' AND v_streak_count >= v_thr_threshold
       AND (v_camp_effect = 'none' OR (v_thr_effect = 'pause' AND v_camp_effect = 'hold')) THEN
      v_camp_effect := v_thr_effect;
      v_camp_hold := v_thr_hold;
      v_camp_note := 'Dừng sau ' || v_streak_count || ' data lỗi/thất bại liên tiếp (ngưỡng ' || v_thr_threshold || '): '
        || coalesce(v_note, 'Lỗi không xác định')
        -- V558: câu bước tiếp theo của mã Facebook (anh duyệt 17/11, Q23) nối sau câu dừng; mã khác (Zalo, SYS) giữ nguyên câu cũ.
        || coalesce('. ' || nullif(btrim((SELECT e.customer_help FROM public.auto_error e
                                          WHERE e.error_code = v_last_error_code AND e.public_code LIKE 'FB%')), ''), '');
    END IF;

    IF NOT p_dry_run THEN
      IF v_run_open THEN
        -- V515 (D): ghi chú của data là kết quả của lượt chốt này, như bộ chạy Desktop (thành công thì note = null). Trước V515 data từng
        -- về hàng đợi kèm ghi chú (NET01…) rồi gửi thành công vẫn giữ ghi chú cũ.
        UPDATE public.auto_campaign_input_data SET status = v_final_status,
          note = v_note,
          schedule = CASE WHEN v_schedule IS NOT NULL THEN v_schedule ELSE schedule END,
          date_action = v_now
        WHERE id = r.input_data_id AND status = 'đang chạy';
      END IF;
      UPDATE public.auto_engine_target_runs SET marks = r.marks, completed_at = coalesce(completed_at, v_now),
        final_target_status = coalesce(final_target_status, v_final_status), final_error_code = coalesce(final_error_code, v_last_error_code),
        close_reason = coalesce(close_reason, 'reported'), outcome_count = outcome_count + v_outcome_count
      WHERE id = r.id;
    END IF;
  ELSIF NOT p_dry_run THEN
    UPDATE public.auto_engine_target_runs SET marks = r.marks, outcome_count = outcome_count + v_outcome_count WHERE id = r.id;
  END IF;
  -- Còn data đến hạn phía sau không: runtime chỉ nghỉ giữa 2 lần gửi khi còn việc.
  IF v_target_done THEN
    -- V501: không tính data đã thử trong lượt này (lượt sau mới thử lại).
    v_more := EXISTS (SELECT 1 FROM public.auto_campaign_input_data d
      WHERE d.campaign_id = r.campaign_id AND d.status = 'chờ xử lý' AND coalesce(d.is_delete, false) = false
        AND (d.schedule IS NULL OR d.schedule <= v_now)
        AND NOT EXISTS (SELECT 1 FROM public.auto_engine_target_runs tr WHERE tr.input_data_id = d.id AND tr.lease_token = r.lease_token));
  END IF;

  -- Hiệu ứng chiến dịch/tài khoản chỉ áp khi còn giữ chỗ; mô phỏng thì chỉ báo sẽ áp gì.
  IF v_lease_ok AND NOT p_dry_run THEN
    IF v_camp_effect <> 'none' THEN
      -- V501: không ghi đè trạng thái người dùng vừa đổi trong lúc data chạy (tạm dừng từ Web/Desktop), như VPS. Hoãn theo
      -- phút chỉ dời lịch khi còn trong ngày, trước giờ dừng (G2).
      UPDATE public.auto_campaigns SET
        status = CASE v_camp_effect WHEN 'pause' THEN 'tạm dừng' ELSE 'chờ xử lý' END,
        schedule = CASE WHEN v_camp_effect = 'hold' AND coalesce(v_camp_hold, 0) > 0
                         AND v_now + make_interval(mins => v_camp_hold)
                             < ((v_vn + least(coalesce(daily_stop_time, time '23:59:00'), time '23:59:00')) AT TIME ZONE 'Asia/Ho_Chi_Minh')
                        THEN v_now + make_interval(mins => v_camp_hold) ELSE schedule END,
        note = coalesce(v_camp_note, note), updated_at = v_now
      WHERE id = r.campaign_id AND status IN ('đang chạy', 'chờ xử lý');
      GET DIAGNOSTICS v_camp_rows = ROW_COUNT;
      v_camp_applied := CASE WHEN v_camp_rows > 0 THEN v_camp_effect ELSE 'none' END;
    END IF;
    IF v_acc_effect = 'pause' THEN UPDATE public.auto_accounts SET status = 'tạm dừng', updated_at = v_now WHERE id = r.account_id; END IF;
    IF v_login_effect <> 'none' THEN
      UPDATE public.auto_accounts SET login_status = CASE v_login_effect WHEN 'checkpoint' THEN 'checkpoint' ELSE 'chưa đăng nhập' END, updated_at = v_now
       WHERE id = r.account_id;
    END IF;
  ELSIF p_dry_run AND v_lease_ok THEN
    v_camp_applied := v_camp_effect;
  END IF;

  v_next := CASE
    WHEN NOT v_lease_ok THEN 'ownership_lost'
    WHEN NOT v_target_done THEN 'next_step'
    WHEN v_camp_applied <> 'none' OR v_run_rank = 4 THEN 'stop_campaign'
    WHEN v_run_rank = 3 THEN 'stop_account'
    WHEN v_run_rank = 2 THEN 'end_unit'
    ELSE 'next_target' END;

  v_response := jsonb_build_object('ok', true, 'dryRun', p_dry_run, 'next', v_next,
    'pace', CASE WHEN v_target_done THEN v_pace ELSE NULL END,
    'outcomes', v_results,
    'target', jsonb_build_object('done', v_target_done, 'status', v_final_status, 'note', v_note, 'schedule', v_schedule, 'morePending', v_more),
    'streak', CASE WHEN v_target_done THEN jsonb_build_object('effect', v_streak, 'count', v_streak_count, 'threshold', v_thr_threshold, 'source', v_thr_source,
      'lastErrorCode', v_last_error_code) END,
    'campaign', jsonb_build_object('effect', v_camp_applied, 'note', CASE WHEN v_camp_applied <> 'none' THEN v_camp_note END),
    'account', jsonb_build_object('effect', v_acc_effect, 'loginEffect', v_login_effect),
    'safety', v_safety);
  -- V515 (B): lưu câu trả lời của lần chốt (không kèm danh sách kết quả, dựng lại từ auto_engine_outcomes khi gọi lại).
  IF v_target_done AND v_run_open AND NOT p_dry_run THEN
    UPDATE public.auto_engine_target_runs SET final_response = v_response - 'outcomes' WHERE id = r.id;
  END IF;
  RETURN v_response;
END $function$
;

DO $cron$
BEGIN
  IF to_regprocedure('cron.schedule(text,text,text)') IS NOT NULL THEN
    PERFORM cron.schedule('aka-agent-engine-receiver-results', '* * * * *', 'SELECT private.aka_agent_engine_receiver_results_ingest()');
  END IF;
END $cron$;

DO $post$
DECLARE v_oid oid; v_acl text; v_role text; v_obj text;
BEGIN
  v_oid := 'public.aka_agent_engine_claim_target_v1(jsonb)'::regprocedure;
  IF md5(pg_get_functiondef(v_oid)) IS DISTINCT FROM '1ea2f16387985542b48dfbda6965c790' THEN
    RAISE EXCEPTION 'V571 postflight: định nghĩa claim %', md5(pg_get_functiondef(v_oid));
  END IF;
  SELECT coalesce(p.proacl::text, '') || '|' || pg_get_userbyid(p.proowner) INTO v_acl FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;
  IF v_acl IS DISTINCT FROM current_setting('aka.v571_acl_claim', true) THEN RAISE EXCEPTION 'V571 postflight: quyền / chủ sở hữu claim bị đổi'; END IF;
  v_oid := 'public.aka_agent_engine_report_v1(bigint,uuid,jsonb,boolean,boolean)'::regprocedure;
  IF md5(pg_get_functiondef(v_oid)) IS DISTINCT FROM '09fe52a53d9f419207506f1033bdb800' THEN
    RAISE EXCEPTION 'V571 postflight: định nghĩa report %', md5(pg_get_functiondef(v_oid));
  END IF;
  SELECT coalesce(p.proacl::text, '') || '|' || pg_get_userbyid(p.proowner) INTO v_acl FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;
  IF v_acl IS DISTINCT FROM current_setting('aka.v571_acl_report', true) THEN RAISE EXCEPTION 'V571 postflight: quyền / chủ sở hữu report bị đổi'; END IF;
  FOREACH v_obj IN ARRAY ARRAY['private.auto_engine_receiver_results', 'private.auto_engine_receiver_results_state'] LOOP
    IF NOT (SELECT c.relrowsecurity FROM pg_catalog.pg_class c WHERE c.oid = v_obj::regclass) THEN RAISE EXCEPTION 'V571 postflight: % chưa bật RLS', v_obj; END IF;
  END LOOP;
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role', 'aka_agent_desktop', 'aka_agent_chat_api'] LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = v_role) THEN
      FOREACH v_obj IN ARRAY ARRAY['private.auto_engine_receiver_results', 'private.auto_engine_receiver_results_state'] LOOP
        IF has_table_privilege(v_role, v_obj, 'SELECT') OR has_table_privilege(v_role, v_obj, 'INSERT') OR has_table_privilege(v_role, v_obj, 'UPDATE')
           OR has_table_privilege(v_role, v_obj, 'DELETE') THEN RAISE EXCEPTION 'V571 postflight: % có quyền trên %', v_role, v_obj; END IF;
      END LOOP;
      FOREACH v_obj IN ARRAY ARRAY['private.aka_agent_engine_target_check_config()', 'private.aka_agent_engine_target_check_on(bigint)', 'private.aka_agent_engine_target_check_rules()', 'private.aka_agent_engine_target_check_tracked()', 'private.aka_agent_engine_receiver_key(text,text)', 'private.aka_agent_engine_target_check_probe(text,text)', 'private.aka_agent_engine_receiver_results_ingest(integer,integer)'] LOOP
        IF has_function_privilege(v_role, v_obj, 'EXECUTE') THEN RAISE EXCEPTION 'V571 postflight: % chạy được %', v_role, v_obj; END IF;
      END LOOP;
    END IF;
  END LOOP;
  IF private.aka_agent_engine_target_check_on(1) THEN RAISE EXCEPTION 'V571 postflight: thiết lập phải ở mode off'; END IF;
  IF (SELECT count(*) FROM private.aka_agent_engine_target_check_rules() WHERE enabled) <> 3 THEN
    RAISE EXCEPTION 'V571 postflight: cần 3 cặp mã đang bật';
  END IF;
  IF to_regclass('cron.job') IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'aka-agent-engine-receiver-results') THEN RAISE EXCEPTION 'V571 postflight: chưa có job aka-agent-engine-receiver-results'; END IF;
  END IF;
END $post$;

COMMIT;
