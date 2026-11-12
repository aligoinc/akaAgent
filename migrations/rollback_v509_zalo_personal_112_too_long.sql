-- Gỡ V509: xoá chính sách và luật source 'v509', tắt mã err_engine_zalo_112_message_too_long (không xoá dòng auto_error vì lịch sử có thể đã tham chiếu).
-- SINH TỪ scripts/build-v509-sql.cjs. Chỉ dữ liệu.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.auto_outcome_signal_rules WHERE source = 'v509') THEN
    RAISE EXCEPTION 'Gỡ V509: chưa có V509';
  END IF;
END $pre$;

CREATE TEMP TABLE v509_rollback_before_policy ON COMMIT DROP AS
SELECT pair.error_code, pair.action_code, rt.t AS runtime_target,
       public.aka_agent_engine_resolve_policy(pair.error_code, NULL, pair.action_code, NULL, rt.t, 'after_send') - 'revisions' AS p
  FROM (SELECT DISTINCT r.error_code, a.code AS action_code
          FROM public.auto_outcome_signal_rules r
          JOIN public.auto_account_actions a ON (r.action_code IS NULL OR r.action_code = a.code)
         WHERE r.platform = 'zalo' AND r.is_active AND a.flatform_type = 'zalo') pair
 CROSS JOIN (VALUES ('desktop'), ('fly')) rt(t);
CREATE TEMP TABLE v509_rollback_before_class ON COMMIT DROP AS
SELECT z.code, a.code AS action_code, ph.p AS phase,
       (SELECT cs.error_code FROM public.aka_agent_engine_classify_signal('zalo', a.code, ph.p, jsonb_build_object('kind', 'zalo_code', 'code', z.code)) cs) AS error_code
  FROM (SELECT DISTINCT r.pattern AS code FROM public.auto_outcome_signal_rules r
         WHERE r.platform = 'zalo' AND r.signal_kind = 'zalo_code' AND r.pattern <> '*' UNION SELECT '112') z
 CROSS JOIN (SELECT code FROM public.auto_account_actions WHERE flatform_type = 'zalo') a
 CROSS JOIN (VALUES ('before_send'), ('in_flight'), ('after_send')) ph(p);
CREATE TEMP TABLE v509_rollback_before_lint ON COMMIT DROP AS SELECT issue, subject FROM public.aka_agent_engine_policy_lint;

DELETE FROM public.auto_outcome_signal_rules WHERE source = 'v509';
DELETE FROM public.auto_outcome_policies WHERE source = 'v509';
UPDATE public.auto_error SET is_active = false, is_delete = true WHERE error_type = 'engine v2' AND error_code = 'err_engine_zalo_112_message_too_long';

DO $post$
DECLARE n integer; a text;
BEGIN
  FOREACH a IN ARRAY ARRAY['zalo_message_stranger', 'zalo_message_friend'] LOOP
    IF (SELECT cs.error_code FROM public.aka_agent_engine_classify_signal('zalo', a, 'after_send', '{"kind": "zalo_code", "code": "112"}'::jsonb) cs)
       IS NOT DISTINCT FROM 'err_engine_zalo_112_message_too_long' THEN
      RAISE EXCEPTION 'Gỡ V509 postflight: 112 × % vẫn ra err_engine_zalo_112_message_too_long', a;
    END IF;
  END LOOP;
  -- Cặp của mã đã tắt không còn trong ảnh chụp sau (không còn luật trỏ tới), nên chỉ so các cặp còn lại.
  DELETE FROM v509_rollback_before_policy WHERE error_code = 'err_engine_zalo_112_message_too_long';
  SELECT count(*) INTO n FROM v509_rollback_before_policy b
   WHERE (public.aka_agent_engine_resolve_policy(b.error_code, NULL, b.action_code, NULL, b.runtime_target, 'after_send') - 'revisions') IS DISTINCT FROM b.p;
  IF n > 0 THEN RAISE EXCEPTION 'Gỡ V509 postflight: % cặp (mã, thao tác) có sẵn bị đổi chính sách', n; END IF;
  SELECT count(*) INTO n FROM v509_rollback_before_class b
   WHERE NOT (b.code = '112' AND b.action_code = ANY (ARRAY['zalo_message_stranger', 'zalo_message_friend']))
     AND (SELECT cs.error_code FROM public.aka_agent_engine_classify_signal('zalo', b.action_code, b.phase, jsonb_build_object('kind', 'zalo_code', 'code', b.code)) cs)
         IS DISTINCT FROM b.error_code;
  IF n > 0 THEN RAISE EXCEPTION 'Gỡ V509 postflight: % cặp (mã Zalo, thao tác, pha) khác bị đổi phân loại', n; END IF;
  SELECT count(*) INTO n FROM public.aka_agent_engine_policy_lint l
   WHERE NOT EXISTS (SELECT 1 FROM v509_rollback_before_lint b WHERE b.issue IS NOT DISTINCT FROM l.issue AND b.subject IS NOT DISTINCT FROM l.subject);
  IF n > 0 THEN RAISE EXCEPTION 'Gỡ V509 postflight: % dòng lint mới', n; END IF;
END $post$;

COMMIT;
