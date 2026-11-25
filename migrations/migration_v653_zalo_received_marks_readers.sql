-- V653: các hàm đọc kết quả chiến dịch đọc thêm mốc của "Đồng bộ trạng thái tin nhắn Zalo" (V525), có bộ lọc "Đã nhận".
--
-- Phải apply SAU V525 (bảng public.auto_zalo_message_status). Chỉ thay đúng các đoạn đọc bảng theo dõi tương tác cũ
-- (auto_campaign_detail_zalo_engagement) trong bốn hàm; phần còn lại của thân hàm giữ nguyên từng ký tự:
--   * aka_agent_list_campaign_details_page_v2 / _v3 (tab Kết quả chạy): bộ lọc "Tương tác Zalo" nhận thêm 'received' và xét
--     mốc của cả hai hệ thống; mỗi dòng trả thêm khoá zalo_message_status (dòng của bảng mới, NULL khi không có).
--   * aka_agent_read_campaign_result_recipients (chế độ gộp theo người nhận): cùng bộ lọc; mỗi kết quả thêm zaloMessageStatus.
--   * aka_agent_read_campaign_run_report (tab Báo cáo): phễu tương tác lấy mốc sớm nhất của hai hệ thống, thêm 'received'
--     (đã nhận mà chưa xem / thả cảm xúc / phản hồi) và 'deliveryTracked' (lượt gửi có theo dõi "đã nhận").
-- Định nghĩa bộ lọc (hàm private.aka_agent_zalo_marks_filter_sql):
--   received  = có biên nhận "đã nhận", hoặc đã xem / thả cảm xúc / phản hồi (đã xem thì chắc chắn đã nhận) ở một trong hai hệ thống;
--   seen / responded / reacted / friended = mốc đó có ở một trong hai hệ thống;
--   none      = lượt gửi được một trong hai hệ thống theo dõi mà chưa có mốc nào ở cả hai.
-- Trước khi thay, md5 thân của từng hàm phải đúng bản production đọc ngày 25/11/2026; mỗi đoạn cần thay phải xuất hiện đúng
-- một lần. Sai một điều kiện thì cả migration dừng, không để lại gì. Gỡ: rollback_v653_zalo_received_marks_readers.sql.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $preflight$
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL
     AND EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration\_v653\_%') THEN
    RAISE EXCEPTION 'v653_already_in_ledger';
  END IF;
  IF to_regclass('public.auto_zalo_message_status') IS NULL THEN
    RAISE EXCEPTION 'v653_requires_v525: public.auto_zalo_message_status missing';
  END IF;
  IF to_regprocedure('private.aka_agent_zalo_marks_filter_sql(text)') IS NOT NULL THEN
    RAISE EXCEPTION 'v653_target_already_exists_do_not_overwrite';
  END IF;
END
$preflight$;

-- Điều kiện lọc dùng chung (chỉ là chữ SQL cố định, tham chiếu d.id của câu gọi; không nhận giá trị người dùng nào khác).
CREATE FUNCTION private.aka_agent_zalo_marks_filter_sql(p_filter text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT '(' || CASE p_filter
    WHEN 'received' THEN
      'EXISTS (SELECT 1 FROM public.auto_zalo_message_status zs WHERE zs.campaign_detail_id=d.id AND (zs.delivered_at IS NOT NULL'
      || ' OR zs.seen_at IS NOT NULL OR zs.reacted_at IS NOT NULL OR zs.responded_at IS NOT NULL))'
      || ' OR EXISTS (SELECT 1 FROM public.auto_campaign_detail_zalo_engagement e WHERE e.campaign_detail_id=d.id AND (e.seen_at IS NOT NULL'
      || ' OR e.reacted_at IS NOT NULL OR e.responded_at IS NOT NULL))'
    WHEN 'seen' THEN
      'EXISTS (SELECT 1 FROM public.auto_campaign_detail_zalo_engagement e WHERE e.campaign_detail_id=d.id AND e.seen_at IS NOT NULL)'
      || ' OR EXISTS (SELECT 1 FROM public.auto_zalo_message_status zs WHERE zs.campaign_detail_id=d.id AND zs.seen_at IS NOT NULL)'
    WHEN 'responded' THEN
      'EXISTS (SELECT 1 FROM public.auto_campaign_detail_zalo_engagement e WHERE e.campaign_detail_id=d.id AND e.responded_at IS NOT NULL)'
      || ' OR EXISTS (SELECT 1 FROM public.auto_zalo_message_status zs WHERE zs.campaign_detail_id=d.id AND zs.responded_at IS NOT NULL)'
    WHEN 'reacted' THEN
      'EXISTS (SELECT 1 FROM public.auto_campaign_detail_zalo_engagement e WHERE e.campaign_detail_id=d.id AND e.reacted_at IS NOT NULL)'
      || ' OR EXISTS (SELECT 1 FROM public.auto_zalo_message_status zs WHERE zs.campaign_detail_id=d.id AND zs.reacted_at IS NOT NULL)'
    WHEN 'friended' THEN
      'EXISTS (SELECT 1 FROM public.auto_campaign_detail_zalo_engagement e WHERE e.campaign_detail_id=d.id AND e.friended_at IS NOT NULL)'
      || ' OR EXISTS (SELECT 1 FROM public.auto_zalo_message_status zs WHERE zs.campaign_detail_id=d.id AND zs.friended_at IS NOT NULL)'
    WHEN 'none' THEN
      '(EXISTS (SELECT 1 FROM public.auto_campaign_detail_zalo_engagement e WHERE e.campaign_detail_id=d.id)'
      || ' OR EXISTS (SELECT 1 FROM public.auto_zalo_message_status zs WHERE zs.campaign_detail_id=d.id))'
      || ' AND NOT EXISTS (SELECT 1 FROM public.auto_campaign_detail_zalo_engagement e WHERE e.campaign_detail_id=d.id AND (e.seen_at IS NOT NULL'
      || ' OR e.responded_at IS NOT NULL OR e.reacted_at IS NOT NULL OR e.friended_at IS NOT NULL))'
      || ' AND NOT EXISTS (SELECT 1 FROM public.auto_zalo_message_status zs WHERE zs.campaign_detail_id=d.id AND (zs.delivered_at IS NOT NULL'
      || ' OR zs.seen_at IS NOT NULL OR zs.responded_at IS NOT NULL OR zs.reacted_at IS NOT NULL OR zs.friended_at IS NOT NULL))'
    ELSE 'false'
  END || ')'
$$;
REVOKE ALL ON FUNCTION private.aka_agent_zalo_marks_filter_sql(text) FROM PUBLIC;
DO $revoke$
DECLARE v_role text;
BEGIN
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role', 'aka_agent_desktop', 'aka_agent_chat_api'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_role) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION private.aka_agent_zalo_marks_filter_sql(text) FROM %I', v_role);
    END IF;
  END LOOP;
END
$revoke$;

-- Thay từng đoạn: kiểm md5 thân hiện tại, mỗi đoạn cũ xuất hiện đúng một lần, rồi CREATE OR REPLACE từ pg_get_functiondef
-- (giữ nguyên chủ sở hữu, quyền, SECURITY DEFINER, search_path, statement_timeout của hàm).
CREATE FUNCTION pg_temp.v653_patch(p_fn regprocedure, p_expected_md5 text, p_pairs text[]) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  v_src text;
  v_def text;
  v_i integer;
  v_hits integer;
BEGIN
  SELECT p.prosrc INTO v_src FROM pg_proc p WHERE p.oid = p_fn;
  IF md5(v_src) IS DISTINCT FROM p_expected_md5 THEN
    RAISE EXCEPTION 'v653_body_drift: % md5 % (expected %)', p_fn, md5(v_src), p_expected_md5;
  END IF;
  v_def := pg_get_functiondef(p_fn);
  FOR v_i IN 1 .. array_length(p_pairs, 1) BY 2 LOOP
    v_hits := (length(v_src) - length(replace(v_src, p_pairs[v_i], ''))) / length(p_pairs[v_i]);
    IF v_hits <> 1 THEN
      RAISE EXCEPTION 'v653_fragment_count: % fragment % found % times', p_fn, (v_i + 1) / 2, v_hits;
    END IF;
    v_src := replace(v_src, p_pairs[v_i], p_pairs[v_i + 1]);
    v_def := replace(v_def, p_pairs[v_i], p_pairs[v_i + 1]);
  END LOOP;
  EXECUTE v_def;
  SELECT p.prosrc INTO v_def FROM pg_proc p WHERE p.oid = p_fn;
  IF v_def IS DISTINCT FROM v_src THEN
    RAISE EXCEPTION 'v653_body_mismatch_after_replace: %', p_fn;
  END IF;
  RETURN md5(v_src);
END
$$;

DO $patch$
DECLARE
  f1_old constant text := $f$  IF COALESCE(p_engagement_filter, 'all') NOT IN ('all','seen','responded','reacted','friended','none') THEN$f$;
  f1_new constant text := $f$  IF COALESCE(p_engagement_filter, 'all') NOT IN ('all','received','seen','responded','reacted','friended','none') THEN$f$;
  f2_old constant text := $f$  IF p_engagement_filter IN ('seen','responded','reacted','friended','none') THEN
    v_where := v_where || ' AND EXISTS (SELECT 1 FROM public.auto_campaign_detail_zalo_engagement e WHERE e.campaign_detail_id=d.id AND ' ||
      CASE p_engagement_filter WHEN 'seen' THEN 'e.seen_at IS NOT NULL' WHEN 'responded' THEN 'e.responded_at IS NOT NULL'
        WHEN 'reacted' THEN 'e.reacted_at IS NOT NULL' WHEN 'friended' THEN 'e.friended_at IS NOT NULL'
        ELSE 'e.seen_at IS NULL AND e.responded_at IS NULL AND e.reacted_at IS NULL AND e.friended_at IS NULL' END || ')';
  END IF;$f$;
  f2_new constant text := $f$  IF p_engagement_filter IN ('received','seen','responded','reacted','friended','none') THEN
    v_where := v_where || ' AND ' || private.aka_agent_zalo_marks_filter_sql(p_engagement_filter);
  END IF;$f$;
  f3_old constant text := $f$'zalo_engagement', to_jsonb(engagement), 'zalo_engagement_applicable',
          engagement.campaign_detail_id IS NOT NULL OR ($f$;
  f3_new constant text := $f$'zalo_engagement', to_jsonb(engagement), 'zalo_message_status', to_jsonb(message_status), 'zalo_engagement_applicable',
          engagement.campaign_detail_id IS NOT NULL OR message_status.campaign_detail_id IS NOT NULL OR ($f$;
  f4_old constant text := $f$        LEFT JOIN public.auto_campaign_detail_zalo_engagement engagement ON engagement.campaign_detail_id=page.id
$f$;
  f4_new constant text := $f$        LEFT JOIN public.auto_campaign_detail_zalo_engagement engagement ON engagement.campaign_detail_id=page.id
        LEFT JOIN public.auto_zalo_message_status message_status ON message_status.campaign_detail_id=page.id
$f$;
  r1_old constant text := $f$      OR v_engagement NOT IN ('all', 'seen', 'responded', 'reacted', 'friended', 'none') THEN$f$;
  r1_new constant text := $f$      OR v_engagement NOT IN ('all', 'received', 'seen', 'responded', 'reacted', 'friended', 'none') THEN$f$;
  r2_old constant text := $f$      v_detail_where := v_detail_where || ' AND EXISTS (SELECT 1 FROM public.auto_campaign_detail_zalo_engagement e WHERE e.campaign_detail_id=d.id AND ' ||
        CASE v_engagement WHEN 'seen' THEN 'e.seen_at IS NOT NULL' WHEN 'responded' THEN 'e.responded_at IS NOT NULL'
          WHEN 'reacted' THEN 'e.reacted_at IS NOT NULL' WHEN 'friended' THEN 'e.friended_at IS NOT NULL'
          ELSE 'e.seen_at IS NULL AND e.responded_at IS NULL AND e.reacted_at IS NULL AND e.friended_at IS NULL' END || ')';$f$;
  r2_new constant text := $f$      v_detail_where := v_detail_where || ' AND ' || private.aka_agent_zalo_marks_filter_sql(v_engagement);$f$;
  r3_old constant text := $f$        'zaloEngagement', to_jsonb(e)) ORDER BY x.created_at DESC, x.id DESC) AS items$f$;
  r3_new constant text := $f$        'zaloEngagement', to_jsonb(e), 'zaloMessageStatus', to_jsonb(zs)) ORDER BY x.created_at DESC, x.id DESC) AS items$f$;
  r4_old constant text := $f$    LEFT JOIN public.auto_campaign_detail_zalo_engagement AS e ON e.campaign_detail_id = x.id
$f$;
  r4_new constant text := $f$    LEFT JOIN public.auto_campaign_detail_zalo_engagement AS e ON e.campaign_detail_id = x.id
    LEFT JOIN public.auto_zalo_message_status AS zs ON zs.campaign_detail_id = x.id
$f$;
  e1_old constant text := $f$        'messageTracked', count(e.campaign_detail_id) FILTER (WHERE d.action_code = ANY(v_message)),
        'responded', count(*) FILTER (WHERE d.action_code = ANY(v_message) AND e.responded_at IS NOT NULL),
        'reacted', count(*) FILTER (WHERE d.action_code = ANY(v_message) AND e.responded_at IS NULL AND e.reacted_at IS NOT NULL),
        'seen', count(*) FILTER (WHERE d.action_code = ANY(v_message) AND e.responded_at IS NULL AND e.reacted_at IS NULL
          AND e.seen_at IS NOT NULL),
        'friendRequested', count(*) FILTER (WHERE d.action_code = v_friend),
        'friendTracked', count(e.campaign_detail_id) FILTER (WHERE d.action_code = v_friend),
        'friended', count(*) FILTER (WHERE d.action_code = v_friend AND e.friended_at IS NOT NULL))
      FROM d
      LEFT JOIN public.auto_campaign_detail_zalo_engagement e ON e.campaign_detail_id = d.id
$f$;
  e1_new constant text := $f$        'messageTracked', count(*) FILTER (WHERE d.action_code = ANY(v_message) AND m.tracked),
        'responded', count(*) FILTER (WHERE d.action_code = ANY(v_message) AND m.responded_at IS NOT NULL),
        'reacted', count(*) FILTER (WHERE d.action_code = ANY(v_message) AND m.responded_at IS NULL AND m.reacted_at IS NOT NULL),
        'seen', count(*) FILTER (WHERE d.action_code = ANY(v_message) AND m.responded_at IS NULL AND m.reacted_at IS NULL
          AND m.seen_at IS NOT NULL),
        'received', count(*) FILTER (WHERE d.action_code = ANY(v_message) AND m.responded_at IS NULL AND m.reacted_at IS NULL
          AND m.seen_at IS NULL AND m.delivered_at IS NOT NULL),
        'deliveryTracked', count(*) FILTER (WHERE d.action_code = ANY(v_message) AND m.delivery_tracked),
        'friendRequested', count(*) FILTER (WHERE d.action_code = v_friend),
        'friendTracked', count(*) FILTER (WHERE d.action_code = v_friend AND m.tracked),
        'friended', count(*) FILTER (WHERE d.action_code = v_friend AND m.friended_at IS NOT NULL))
      FROM d
      LEFT JOIN public.auto_campaign_detail_zalo_engagement e ON e.campaign_detail_id = d.id
      LEFT JOIN public.auto_zalo_message_status zs ON zs.campaign_detail_id = d.id
      CROSS JOIN LATERAL (SELECT e.campaign_detail_id IS NOT NULL OR zs.campaign_detail_id IS NOT NULL AS tracked,
        zs.campaign_detail_id IS NOT NULL AS delivery_tracked, zs.delivered_at,
        LEAST(e.seen_at, zs.seen_at) AS seen_at, LEAST(e.reacted_at, zs.reacted_at) AS reacted_at,
        LEAST(e.responded_at, zs.responded_at) AS responded_at, LEAST(e.friended_at, zs.friended_at) AS friended_at) AS m
$f$;
  v_md5 jsonb := '{}'::jsonb;
BEGIN
  v_md5 := v_md5 || jsonb_build_object('v2', pg_temp.v653_patch(
    'public.aka_agent_list_campaign_details_page_v2(bigint,bigint,bigint,text,text,timestamptz,timestamptz,integer,integer,text,text,text,text)',
    '28c26d1e0bd580eb77fef7f4b8352a67', ARRAY[f1_old, f1_new, f2_old, f2_new, f3_old, f3_new, f4_old, f4_new]));
  v_md5 := v_md5 || jsonb_build_object('v3', pg_temp.v653_patch(
    'public.aka_agent_list_campaign_details_page_v3(bigint,bigint,bigint,text,text,timestamptz,timestamptz,integer,integer,text,text,text,text,text)',
    '4e5c300305409908295c49d5d1941224', ARRAY[f1_old, f1_new, f2_old, f2_new, f3_old, f3_new, f4_old, f4_new]));
  v_md5 := v_md5 || jsonb_build_object('recipients', pg_temp.v653_patch(
    'public.aka_agent_read_campaign_result_recipients(bigint,bigint,text,text,bigint,jsonb)',
    '3fe7e5982398b42cc73fcc0433109b05', ARRAY[r1_old, r1_new, r2_old, r2_new, r3_old, r3_new, r4_old, r4_new]));
  v_md5 := v_md5 || jsonb_build_object('run_report', pg_temp.v653_patch(
    'public.aka_agent_read_campaign_run_report(bigint,bigint,text,text,bigint,jsonb)',
    '4bd734ca25612bfdade631c779373d42', ARRAY[e1_old, e1_new]));
  -- Postflight: md5 thân mới đúng bản đã chạy thử trên production ngày 25/11/2026 (trong giao dịch huỷ).
  IF v_md5 IS DISTINCT FROM '{"v2": "71ba4bd7631da7100831a8dfe6a3648f", "v3": "e9009c99441e5f268c04b30e1fef4de8", "recipients": "85076e4f0f4a021fc1e32269ec8b207f", "run_report": "354247b27de86de38f6970c66db768c4"}'::jsonb THEN
    RAISE EXCEPTION 'v653_postflight_md5 %', v_md5;
  END IF;
END
$patch$;

DROP FUNCTION pg_temp.v653_patch(regprocedure, text, text[]);

COMMIT;
