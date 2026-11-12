-- V509: Zalo 112 khi nhắn người lạ / bạn bè xử lý như 118 "Nội dung quá dài" (12/11/2026, anh chốt; nhắn group giữ nguyên).
-- SINH TỪ scripts/build-v509-sql.cjs, không sửa tay.
--
-- Chỉ dữ liệu của engine v2:
--   * mã err_engine_zalo_112_message_too_long (error_type 'engine v2', Z112, content_config, không có mã Zalo nên bộ chạy cũ không khớp);
--   * 3 dòng auto_outcome_policies chép từ err_zalo_message_too_long (theo mã, nhắn người lạ, nhắn bạn bè), đổi câu cho khách, source 'v509':
--     tạm dừng chiến dịch ngay, dừng lượt, data chưa gửi được gì về hàng đợi, không tính lượt, không đếm chuỗi;
--   * 2 luật auto_outcome_signal_rules: zalo_code 112 × zalo_message_stranger / zalo_message_friend → err_engine_zalo_112_message_too_long.
-- Không DDL (bảng tạm chỉ trong giao dịch), không đổi hàm. Nhắn group (112 = group từ chối) và mọi cặp khác giữ nguyên.
-- Gỡ: rollback_v509_zalo_personal_112_too_long.sql.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
DECLARE n integer; r record;
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v509_%') THEN
      RAISE EXCEPTION 'V509 đã có trong sổ migration, không chạy lại';
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_error WHERE error_code = 'err_engine_zalo_112_message_too_long' AND error_type IS DISTINCT FROM 'engine v2') THEN
    RAISE EXCEPTION 'V509: mã err_engine_zalo_112_message_too_long đã có và không phải engine v2';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_outcome_policies WHERE error_code = 'err_engine_zalo_112_message_too_long' AND is_active AND NOT is_delete)
     OR EXISTS (SELECT 1 FROM public.auto_outcome_signal_rules WHERE source = 'v509' OR (platform = 'zalo' AND signal_kind = 'zalo_code'
       AND pattern = '112' AND action_code = ANY (ARRAY['zalo_message_stranger', 'zalo_message_friend']) AND is_active)) THEN
    RAISE EXCEPTION 'V509: đã có chính sách hoặc luật 112 cho nhắn người lạ / bạn bè';
  END IF;
  -- Bản chép phải đúng như đã duyệt (seed V495 + V500 Q2/Q3).
  SELECT count(*) INTO n FROM public.auto_outcome_policies p WHERE p.error_code = 'err_zalo_message_too_long' AND p.status_id IS NULL AND p.error_class IS NULL AND p.campaign_action_id IS NULL
     AND p.runtime_target IS NULL AND p.is_active AND NOT p.is_delete AND (p.action_code IS NULL OR p.action_code = ANY (ARRAY['zalo_message_stranger', 'zalo_message_friend']));
  IF n <> 3 THEN RAISE EXCEPTION 'V509: cần đúng 3 dòng chính sách của err_zalo_message_too_long (thấy %)', n; END IF;
  FOR r IN SELECT p.* FROM public.auto_outcome_policies p WHERE p.error_code = 'err_zalo_message_too_long' AND p.status_id IS NULL AND p.error_class IS NULL AND p.campaign_action_id IS NULL
     AND p.runtime_target IS NULL AND p.is_active AND NOT p.is_delete AND (p.action_code IS NULL OR p.action_code = ANY (ARRAY['zalo_message_stranger', 'zalo_message_friend'])) LOOP
    IF r.action_code IS NULL AND (r.detail_mode IS DISTINCT FROM 'write' OR r.campaign_effect IS DISTINCT FROM 'pause'
       OR r.log_template IS DISTINCT FROM 'Nội dung quá dài') THEN
      RAISE EXCEPTION 'V509: dòng theo mã của err_zalo_message_too_long khác bản đã đọc (id %)', r.id;
    END IF;
    IF r.action_code IS NOT NULL AND (r.detail_mode IS DISTINCT FROM 'suppress' OR r.quota_effect IS DISTINCT FROM 'no_count'
       OR r.target_streak_effect IS DISTINCT FROM 'ignore' OR r.target_effect IS DISTINCT FROM 'requeue'
       OR r.remaining_steps IS DISTINCT FROM 'skip' OR r.run_effect IS DISTINCT FROM 'stop_campaign') THEN
      RAISE EXCEPTION 'V509: dòng % × err_zalo_message_too_long khác bản V500 (id %)', r.action_code, r.id;
    END IF;
  END LOOP;
END $pre$;

CREATE TEMP TABLE v509_before_policy ON COMMIT DROP AS
SELECT pair.error_code, pair.action_code, rt.t AS runtime_target,
       public.aka_agent_engine_resolve_policy(pair.error_code, NULL, pair.action_code, NULL, rt.t, 'after_send') - 'revisions' AS p
  FROM (SELECT DISTINCT r.error_code, a.code AS action_code
          FROM public.auto_outcome_signal_rules r
          JOIN public.auto_account_actions a ON (r.action_code IS NULL OR r.action_code = a.code)
         WHERE r.platform = 'zalo' AND r.is_active AND a.flatform_type = 'zalo') pair
 CROSS JOIN (VALUES ('desktop'), ('fly')) rt(t);
CREATE TEMP TABLE v509_before_class ON COMMIT DROP AS
SELECT z.code, a.code AS action_code, ph.p AS phase,
       (SELECT cs.error_code FROM public.aka_agent_engine_classify_signal('zalo', a.code, ph.p, jsonb_build_object('kind', 'zalo_code', 'code', z.code)) cs) AS error_code
  FROM (SELECT DISTINCT r.pattern AS code FROM public.auto_outcome_signal_rules r
         WHERE r.platform = 'zalo' AND r.signal_kind = 'zalo_code' AND r.pattern <> '*' UNION SELECT '112') z
 CROSS JOIN (SELECT code FROM public.auto_account_actions WHERE flatform_type = 'zalo') a
 CROSS JOIN (VALUES ('before_send'), ('in_flight'), ('after_send')) ph(p);
CREATE TEMP TABLE v509_before_lint ON COMMIT DROP AS SELECT issue, subject FROM public.aka_agent_engine_policy_lint;

INSERT INTO public.auto_error (error_type, error_code, error_name, error_desc, noti_running_process, noti_campaign,
  disable_action_codes, counts_toward_limit, counts_toward_bad_target, disable_action_mode, zalo_error_codes, zalo_action_codes,
  is_active, is_delete, public_code, error_class, customer_title, customer_help)
VALUES ('engine v2', 'err_engine_zalo_112_message_too_long', 'Nội dung quá dài (Zalo trả 112)',
  'V509 (engine v2): nhắn người lạ / bạn bè gặp 112 vì chữ quá dài, xử lý như 118', NULL, NULL, '{}', false, false, 'fixed_minutes', '{}', '{}',
  true, false, 'Z112', 'content_config', 'Nội dung quá dài', 'Rút ngắn nội dung tin nhắn rồi chạy tiếp chiến dịch. Gửi kèm đúng 1 ảnh thì chữ thành chú thích ảnh, Zalo chỉ nhận khoảng 2.000 ký tự.')
ON CONFLICT (error_code) DO UPDATE SET is_active = true, is_delete = false, public_code = EXCLUDED.public_code, error_class = EXCLUDED.error_class,
  customer_title = EXCLUDED.customer_title, customer_help = EXCLUDED.customer_help
  WHERE public.auto_error.error_type = 'engine v2';

INSERT INTO public.auto_outcome_policies (error_code, error_class, status_id, action_code, campaign_action_id, runtime_target, detail_mode, detail_status_id, sub_status_id,
  log_template, campaign_note_template, quota_effect, target_streak_effect, streak_threshold, target_effect, requeue_after_minutes, remaining_steps,
  lock_action_codes, lock_mode, lock_minutes, lock_days, lock_time, run_effect, pace_mode, pace_seconds, campaign_effect, campaign_hold_minutes,
  account_effect, login_effect, description, source)
SELECT 'err_engine_zalo_112_message_too_long', p.error_class, p.status_id, p.action_code, p.campaign_action_id, p.runtime_target, p.detail_mode, p.detail_status_id, p.sub_status_id,
       CASE WHEN p.action_code IS NULL THEN 'Nội dung quá dài' ELSE p.log_template END,
       CASE WHEN p.action_code IS NULL THEN 'Nội dung quá dài, vui lòng rút ngắn nội dung chiến dịch (gửi kèm 1 ảnh thì chữ dưới 2.000 ký tự)' ELSE p.campaign_note_template END,
       p.quota_effect, p.target_streak_effect, p.streak_threshold, p.target_effect, p.requeue_after_minutes, p.remaining_steps,
       p.lock_action_codes, p.lock_mode, p.lock_minutes, p.lock_days, p.lock_time, p.run_effect, p.pace_mode, p.pace_seconds, p.campaign_effect,
       p.campaign_hold_minutes, p.account_effect, p.login_effect,
       '[V509] Chép từ err_zalo_message_too_long (id ' || p.id || '): 112 khi nhắn người lạ / bạn bè là chữ quá dài (đo 12/11/2026), xử lý như 118.', 'v509'
  FROM public.auto_outcome_policies p WHERE p.error_code = 'err_zalo_message_too_long' AND p.status_id IS NULL AND p.error_class IS NULL AND p.campaign_action_id IS NULL
     AND p.runtime_target IS NULL AND p.is_active AND NOT p.is_delete AND (p.action_code IS NULL OR p.action_code = ANY (ARRAY['zalo_message_stranger', 'zalo_message_friend']));

INSERT INTO public.auto_outcome_signal_rules (platform, action_code, phase, signal_kind, pattern, priority, error_code, source, note) VALUES
  ('zalo', 'zalo_message_stranger', NULL, 'zalo_code', '112', 10, 'err_engine_zalo_112_message_too_long', 'v509', '[V509] Nhắn người lạ gặp 112: chữ quá dài (741/743 lượt 112/118 có chữ trên 2.000 ký tự), xử lý như 118.'),
  ('zalo', 'zalo_message_friend', NULL, 'zalo_code', '112', 10, 'err_engine_zalo_112_message_too_long', 'v509', '[V509] Nhắn bạn bè gặp 112: chữ quá dài (741/743 lượt 112/118 có chữ trên 2.000 ký tự), xử lý như 118.');

DO $post$
DECLARE n integer; t text; a text; v_new jsonb; v_base jsonb;
BEGIN
  SELECT count(*) INTO n FROM public.auto_outcome_policies WHERE error_code = 'err_engine_zalo_112_message_too_long' AND source = 'v509' AND is_active AND NOT is_delete;
  IF n <> 3 THEN RAISE EXCEPTION 'V509 postflight: cần 3 dòng chính sách mới (thấy %)', n; END IF;
  FOREACH a IN ARRAY ARRAY['zalo_message_stranger', 'zalo_message_friend'] LOOP
    FOREACH t IN ARRAY ARRAY['before_send', 'in_flight', 'after_send'] LOOP
      IF (SELECT cs.error_code FROM public.aka_agent_engine_classify_signal('zalo', a, t, '{"kind": "zalo_code", "code": "112"}'::jsonb) cs)
         IS DISTINCT FROM 'err_engine_zalo_112_message_too_long' THEN
        RAISE EXCEPTION 'V509 postflight: 112 × % (%) chưa ra err_engine_zalo_112_message_too_long', a, t;
      END IF;
    END LOOP;
    FOREACH t IN ARRAY ARRAY['desktop', 'fly'] LOOP
      v_new := public.aka_agent_engine_resolve_policy('err_engine_zalo_112_message_too_long', NULL, a, NULL, t, 'after_send');
      v_base := public.aka_agent_engine_resolve_policy('err_zalo_message_too_long', NULL, a, NULL, t, 'after_send');
      IF (v_new - 'revisions' - 'policy_ids' - 'log_template' - 'campaign_note_template') IS DISTINCT FROM
         (v_base - 'revisions' - 'policy_ids' - 'log_template' - 'campaign_note_template') THEN
        RAISE EXCEPTION 'V509 postflight: chính sách % (%) khác 118: % / %', a, t, v_new, v_base;
      END IF;
      IF v_new->>'log_template' IS DISTINCT FROM 'Nội dung quá dài' OR v_new->>'campaign_note_template' IS DISTINCT FROM 'Nội dung quá dài, vui lòng rút ngắn nội dung chiến dịch (gửi kèm 1 ảnh thì chữ dưới 2.000 ký tự)' THEN
        RAISE EXCEPTION 'V509 postflight: câu cho khách % (%) chưa đúng: %', a, t, v_new;
      END IF;
    END LOOP;
  END LOOP;
  SELECT count(*) INTO n FROM v509_before_policy b
   WHERE (public.aka_agent_engine_resolve_policy(b.error_code, NULL, b.action_code, NULL, b.runtime_target, 'after_send') - 'revisions') IS DISTINCT FROM b.p;
  IF n > 0 THEN RAISE EXCEPTION 'V509 postflight: % cặp (mã, thao tác) có sẵn bị đổi chính sách', n; END IF;
  SELECT count(*) INTO n FROM v509_before_class b
   WHERE NOT (b.code = '112' AND b.action_code = ANY (ARRAY['zalo_message_stranger', 'zalo_message_friend']))
     AND (SELECT cs.error_code FROM public.aka_agent_engine_classify_signal('zalo', b.action_code, b.phase, jsonb_build_object('kind', 'zalo_code', 'code', b.code)) cs)
         IS DISTINCT FROM b.error_code;
  IF n > 0 THEN RAISE EXCEPTION 'V509 postflight: % cặp (mã Zalo, thao tác, pha) khác bị đổi phân loại', n; END IF;
  SELECT count(*) INTO n FROM public.aka_agent_engine_policy_lint l
   WHERE NOT EXISTS (SELECT 1 FROM v509_before_lint b WHERE b.issue IS NOT DISTINCT FROM l.issue AND b.subject IS NOT DISTINCT FROM l.subject);
  IF n > 0 THEN RAISE EXCEPTION 'V509 postflight: % dòng lint mới', n; END IF;
END $post$;

COMMIT;
