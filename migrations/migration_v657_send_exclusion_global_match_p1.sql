-- V657 phần 1: bảng đối chiếu SĐT ↔ Global ID cho loại trừ gửi (docs/CAMPAIGN_SEND_EXCLUSION_MULTI_ZALO_PLAN.md mục 12).
-- SINH TỪ scripts/build-v657-sql.cjs, không sửa tay. Chỉ thêm đối tượng mới: private.auto_zalo_phone_identity (+ _state), hàm nạp từ
-- kết quả Tìm SĐT thành công trong auto_campaign_details (theo id, mỗi phút có ngân sách), job pg_cron aka-agent-zalo-phone-identity,
-- thiết lập send_exclusion.identity. Gỡ: rollback_v657_send_exclusion_global_match_p1.sql (sau khi gỡ p2).
BEGIN;
SET LOCAL lock_timeout = '3s';
DO $pre$
BEGIN
 IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name='migration_v657_send_exclusion_global_match_p1') THEN
  RAISE EXCEPTION 'V657 p1 đã có trong sổ migration, không chạy lại';
 END IF;
 IF to_regclass('private.auto_zalo_phone_identity') IS NOT NULL THEN RAISE EXCEPTION 'V657 p1: bảng đối chiếu đã có'; END IF;
 IF to_regprocedure('public.aka_agent_internal_normalize_phone(text)') IS NULL THEN RAISE EXCEPTION 'V657 p1: thiếu aka_agent_internal_normalize_phone'; END IF;
 IF EXISTS (SELECT 1 FROM public.auto_system_settings WHERE key='send_exclusion.identity') THEN RAISE EXCEPTION 'V657 p1: thiết lập send_exclusion.identity đã có'; END IF;
END $pre$;

CREATE TABLE private.auto_zalo_phone_identity (
  phone text PRIMARY KEY CHECK (phone ~ '^0[35789][0-9]{8}$'),
  global_id text NOT NULL CHECK (btrim(global_id) <> ''),
  seen_at timestamptz NOT NULL,
  detail_id bigint NOT NULL,
  changes integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auto_zalo_phone_identity_global ON private.auto_zalo_phone_identity (global_id);
COMMENT ON TABLE private.auto_zalo_phone_identity IS 'V657: SĐT (chuẩn hoá, di động VN) → Global ID Zalo mới nhất, lấy từ kết quả Tìm SĐT thành công (auto_campaign_details zalo_find_phone_user, data.target.phone / globalId). changes = số lần Global ID của SĐT đổi (theo dõi; đo 25/11: 0 / 2.700 SĐT). Dùng cho loại trừ gửi: biết Global ID của SĐT trước khi tra số, và SĐT của người nhận theo UID.';
CREATE TABLE private.auto_zalo_phone_identity_state (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  last_detail_id bigint NOT NULL DEFAULT 0,
  rows_upserted bigint NOT NULL DEFAULT 0,
  changes bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO private.auto_zalo_phone_identity_state(id) VALUES (true);
ALTER TABLE private.auto_zalo_phone_identity ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.auto_zalo_phone_identity_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.auto_zalo_phone_identity, private.auto_zalo_phone_identity_state FROM PUBLIC;
DO $rv$
DECLARE v_role text;
BEGIN
 FOREACH v_role IN ARRAY ARRAY['anon','authenticated','aka_agent_desktop','aka_agent_chat_api','service_role'] LOOP
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=v_role) THEN
   EXECUTE format('REVOKE ALL ON private.auto_zalo_phone_identity, private.auto_zalo_phone_identity_state FROM %I', v_role);
  END IF;
 END LOOP;
END $rv$;

CREATE FUNCTION private.aka_agent_zalo_own_global_ids(p_account bigint)
 RETURNS text[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
 -- V657: Global ID của chính nick Zalo mà tài khoản đang đăng nhập (zalo_accounts.metadata của Desktop, chat_zalo_account của Fly).
 -- Đo 25/11: ~19% dòng zalo_users (62% dòng quét thành viên nhóm, 701 tài khoản) mang Global ID này thay cho Global ID của người kia
 -- (Zalo trả Global ID của người xem khi đọc hồ sơ thành viên nhóm) ⇒ không bao giờ dùng làm Global ID của người nhận.
 SELECT COALESCE(array_agg(DISTINCT g) FILTER (WHERE g IS NOT NULL),'{}') FROM (
  SELECT NULLIF(btrim(za.metadata->>'globalId'),'') g FROM public.auto_accounts a JOIN public.zalo_accounts za ON za.id=a.zalo_account_id WHERE a.id=p_account
  UNION ALL
  SELECT NULLIF(btrim(ca.global_id),'') FROM public.chat_zalo_account_organization ao JOIN public.chat_zalo_account ca ON ca.id=ao.chat_zalo_account_id
   WHERE ao.auto_account_id=p_account) x;
$function$;
REVOKE ALL ON FUNCTION private.aka_agent_zalo_own_global_ids(bigint) FROM PUBLIC;

CREATE FUNCTION private.aka_agent_zalo_phone_identity_ingest(p_budget_ms integer DEFAULT NULL, p_chunk integer DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
-- V657: nạp kết quả Tìm SĐT thành công (theo id auto_campaign_details, từ mốc ở _state) vào bảng đối chiếu. Một SĐT lấy lần tra mới nhất;
-- Global ID đổi thì cập nhật và đếm changes. Ngân sách: send_exclusion.identity.budgetMs (dòng cài đặt V657 đặt 8 giây; thiếu thì 20 giây), chunk id mỗi phần (10.000).
DECLARE v_cfg jsonb; v_budget integer; v_chunk integer; v_deadline timestamptz; v_from bigint; v_to bigint; v_max bigint; v_rows bigint:=0; v_ch bigint:=0; v_overlap integer;
 v_n bigint; v_c bigint;
BEGIN
 BEGIN
  SELECT s.value::jsonb INTO v_cfg FROM public.auto_system_settings s WHERE s.key='send_exclusion.identity' AND s.is_active LIMIT 1;
 EXCEPTION WHEN OTHERS THEN v_cfg:=NULL;
 END;
 v_cfg:=COALESCE(v_cfg,'{}');
 IF p_budget_ms IS NULL AND v_cfg->'ingest'='false'::jsonb THEN RETURN jsonb_build_object('skipped','disabled'); END IF;
 v_budget:=COALESCE(p_budget_ms, CASE WHEN v_cfg->>'budgetMs' ~ '^[0-9]{1,6}$' THEN (v_cfg->>'budgetMs')::integer END, 20000);
 v_chunk:=least(greatest(COALESCE(p_chunk, CASE WHEN v_cfg->>'chunk' ~ '^[0-9]{1,7}$' THEN (v_cfg->>'chunk')::integer END, 10000),100),200000);
 v_overlap:=COALESCE(CASE WHEN v_cfg->>'overlap' ~ '^[0-9]{1,7}$' THEN (v_cfg->>'overlap')::integer END, 5000);
 v_deadline:=clock_timestamp()+make_interval(secs=>v_budget/1000.0);
 IF NOT pg_try_advisory_xact_lock(hashtext('aka_agent_zalo_phone_identity_ingest')) THEN RETURN jsonb_build_object('skipped','busy'); END IF;
 SELECT max(id) INTO v_max FROM public.auto_campaign_details;
 SELECT last_detail_id INTO v_from FROM private.auto_zalo_phone_identity_state WHERE id FOR UPDATE;
 -- Đọc lại một đoạn id đã qua: dòng có id nhỏ hơn mốc nhưng commit muộn (giao dịch đang mở lúc lượt trước chạy) không bị bỏ sót.
 -- Ghi lại an toàn: chỉ cập nhật khi detail_id mới lớn hơn.
 v_from:=greatest(v_from-v_overlap,0);
 LOOP
  EXIT WHEN v_from>=COALESCE(v_max,0) OR clock_timestamp()>=v_deadline;
  v_to:=least(v_from+v_chunk,v_max);
  WITH src AS (
   SELECT DISTINCT ON (x.ph) x.ph, x.gid, x.created_at, x.id FROM (
    SELECT public.aka_agent_internal_normalize_phone(COALESCE(d.data->'target'->>'phone','')) ph, NULLIF(btrim(COALESCE(d.data->'target'->>'globalId','')),'') gid, d.created_at, d.id,
      d.account_id
     FROM public.auto_campaign_details d
     WHERE d.id>v_from AND d.id<=v_to AND d.action_code='zalo_find_phone_user' AND d.status='thành công') x
   -- Bỏ Global ID của chính nick tra số (đo 25/11: 0 / 91.109 lượt; chặn phòng khi Zalo trả nhầm như khi đọc hồ sơ thành viên nhóm).
   WHERE x.ph<>'' AND x.gid IS NOT NULL AND NOT (x.gid=ANY(private.aka_agent_zalo_own_global_ids(x.account_id))) ORDER BY x.ph, x.id DESC),
  up AS (
   INSERT INTO private.auto_zalo_phone_identity AS t (phone, global_id, seen_at, detail_id)
   SELECT ph, gid, created_at, id FROM src
   ON CONFLICT (phone) DO UPDATE SET global_id=EXCLUDED.global_id, seen_at=EXCLUDED.seen_at, detail_id=EXCLUDED.detail_id,
     changes=t.changes+CASE WHEN t.global_id<>EXCLUDED.global_id THEN 1 ELSE 0 END, updated_at=now()
    WHERE EXCLUDED.detail_id>t.detail_id
   RETURNING (xmax<>0) AS updated, changes)
  SELECT count(*), count(*) FILTER (WHERE updated AND changes>0) INTO v_n, v_c FROM up;
  v_rows:=v_rows+v_n; v_ch:=v_ch+v_c; v_from:=v_to;
 END LOOP;
 UPDATE private.auto_zalo_phone_identity_state SET last_detail_id=greatest(last_detail_id,v_from), rows_upserted=rows_upserted+v_rows, updated_at=now() WHERE id;
 RETURN jsonb_build_object('lastDetailId',v_from,'maxDetailId',v_max,'rows',v_rows);
END;
$function$;
REVOKE ALL ON FUNCTION private.aka_agent_zalo_phone_identity_ingest(integer,integer) FROM PUBLIC;
DO $rv2$
DECLARE v_role text;
BEGIN
 FOREACH v_role IN ARRAY ARRAY['anon','authenticated','aka_agent_desktop','aka_agent_chat_api','service_role'] LOOP
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=v_role) THEN
   EXECUTE format('REVOKE ALL ON FUNCTION private.aka_agent_zalo_phone_identity_ingest(integer,integer) FROM %I', v_role);
   EXECUTE format('REVOKE ALL ON FUNCTION private.aka_agent_zalo_own_global_ids(bigint) FROM %I', v_role);
  END IF;
 END LOOP;
END $rv2$;

INSERT INTO public.auto_system_settings(key, value, description, is_active)
VALUES ('send_exclusion.identity', '{"ingest":true,"budgetMs":8000,"chunk":10000}',
 'V657: nạp bảng đối chiếu SĐT ↔ Global ID (private.auto_zalo_phone_identity) từ kết quả Tìm SĐT thành công. ingest=false: ngừng nạp; budgetMs: thời gian mỗi lượt job (mỗi phút); chunk: số id auto_campaign_details mỗi phần; overlap: số id đã qua đọc lại mỗi lượt để không sót dòng commit muộn (mặc định 5000).', true);

DO $cron$
BEGIN
 IF to_regclass('cron.job') IS NOT NULL THEN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='aka-agent-zalo-phone-identity') THEN RAISE EXCEPTION 'V657 p1: job đã có'; END IF;
  PERFORM cron.schedule('aka-agent-zalo-phone-identity', '* * * * *', 'SELECT private.aka_agent_zalo_phone_identity_ingest()');
 END IF;
END $cron$;
COMMIT;
