-- Gỡ V653: trả bốn hàm đọc về đúng thân trước V653 (thay ngược từng đoạn, kiểm md5 thân V653 trước khi thay và md5 thân
-- cũ sau khi thay), rồi xoá hàm phụ. Phải gỡ TRƯỚC khi gỡ V525 (bốn hàm đọc bảng public.auto_zalo_message_status).

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE FUNCTION pg_temp.v653_unpatch(p_fn regprocedure, p_expected_md5 text, p_pairs text[]) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  v_src text;
  v_def text;
  v_i integer;
  v_hits integer;
BEGIN
  SELECT p.prosrc INTO v_src FROM pg_proc p WHERE p.oid = p_fn;
  IF md5(v_src) IS DISTINCT FROM p_expected_md5 THEN
    RAISE EXCEPTION 'v653_rollback_body_drift: % md5 % (expected %)', p_fn, md5(v_src), p_expected_md5;
  END IF;
  v_def := pg_get_functiondef(p_fn);
  FOR v_i IN 1 .. array_length(p_pairs, 1) BY 2 LOOP
    v_hits := (length(v_src) - length(replace(v_src, p_pairs[v_i], ''))) / length(p_pairs[v_i]);
    IF v_hits <> 1 THEN
      RAISE EXCEPTION 'v653_rollback_fragment_count: % fragment % found % times', p_fn, (v_i + 1) / 2, v_hits;
    END IF;
    v_src := replace(v_src, p_pairs[v_i], p_pairs[v_i + 1]);
    v_def := replace(v_def, p_pairs[v_i], p_pairs[v_i + 1]);
  END LOOP;
  EXECUTE v_def;
  SELECT p.prosrc INTO v_def FROM pg_proc p WHERE p.oid = p_fn;
  IF v_def IS DISTINCT FROM v_src THEN
    RAISE EXCEPTION 'v653_rollback_body_mismatch: %', p_fn;
  END IF;
  RETURN md5(v_src);
END
$$;

DO $unpatch$
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
          AND message_status.campaign_id=detail.campaign_id AND detail.action_code IN ('zalo_message_friend','zalo_message_stranger','zalo_add_friend')
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
      AND zs.campaign_id = p_campaign_id AND x.action_code IN ('zalo_message_friend','zalo_message_stranger','zalo_add_friend')
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
      LEFT JOIN public.auto_zalo_message_status zs ON zs.campaign_detail_id = d.id AND zs.campaign_id = p_campaign_id
      CROSS JOIN LATERAL (SELECT e.campaign_detail_id IS NOT NULL OR zs.campaign_detail_id IS NOT NULL AS tracked,
        zs.campaign_detail_id IS NOT NULL AS delivery_tracked, zs.delivered_at,
        LEAST(e.seen_at, zs.seen_at) AS seen_at, LEAST(e.reacted_at, zs.reacted_at) AS reacted_at,
        LEAST(e.responded_at, zs.responded_at) AS responded_at, LEAST(e.friended_at, zs.friended_at) AS friended_at) AS m
$f$;
  v_md5 jsonb := '{}'::jsonb;
BEGIN
  v_md5 := v_md5 || jsonb_build_object('v2', pg_temp.v653_unpatch(
    'public.aka_agent_list_campaign_details_page_v2(bigint,bigint,bigint,text,text,timestamptz,timestamptz,integer,integer,text,text,text,text)',
    '89a01e896acd5672c73ce317ef82ac29', ARRAY[f4_new, f4_old, f3_new, f3_old, f2_new, f2_old, f1_new, f1_old]));
  v_md5 := v_md5 || jsonb_build_object('v3', pg_temp.v653_unpatch(
    'public.aka_agent_list_campaign_details_page_v3(bigint,bigint,bigint,text,text,timestamptz,timestamptz,integer,integer,text,text,text,text,text)',
    '061c9a2cb8fe5f0fb2c259df8cf14d5e', ARRAY[f4_new, f4_old, f3_new, f3_old, f2_new, f2_old, f1_new, f1_old]));
  v_md5 := v_md5 || jsonb_build_object('recipients', pg_temp.v653_unpatch(
    'public.aka_agent_read_campaign_result_recipients(bigint,bigint,text,text,bigint,jsonb)',
    '5d79a8809416889ecd689b4b3fcff6c9', ARRAY[r4_new, r4_old, r3_new, r3_old, r2_new, r2_old, r1_new, r1_old]));
  v_md5 := v_md5 || jsonb_build_object('run_report', pg_temp.v653_unpatch(
    'public.aka_agent_read_campaign_run_report(bigint,bigint,text,text,bigint,jsonb)',
    '5b4073a20534ea05a9c06c0c2c10cfe3', ARRAY[e1_new, e1_old]));
  IF v_md5 IS DISTINCT FROM '{"v2": "28c26d1e0bd580eb77fef7f4b8352a67", "v3": "4e5c300305409908295c49d5d1941224", "recipients": "3fe7e5982398b42cc73fcc0433109b05", "run_report": "4bd734ca25612bfdade631c779373d42"}'::jsonb THEN
    RAISE EXCEPTION 'v653_rollback_postflight_md5 %', v_md5;
  END IF;
END
$unpatch$;

DROP FUNCTION pg_temp.v653_unpatch(regprocedure, text, text[]);
DROP FUNCTION private.aka_agent_zalo_marks_filter_sql(text);

COMMIT;
