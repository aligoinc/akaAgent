-- Gỡ V581: xoá chính sách và luật source 'v581', tắt 4 mã mới (không xoá dòng auto_error vì lịch sử có thể đã tham chiếu).
-- SINH TỪ scripts/build-v581-sql.cjs. Chỉ dữ liệu. Sau khi gỡ: 114 ở bước gắn tag lại ra Z114; ba tín hiệu của lõi mới rơi về luật
-- chung của tín hiệu engine (trước khi gửi: NET01, data về hàng đợi), nên gỡ thì cũng phải đưa lõi về bản trước.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.auto_outcome_signal_rules WHERE source = 'v581') THEN
    RAISE EXCEPTION 'Gỡ V581: chưa có V581';
  END IF;
END $pre$;

CREATE TEMP TABLE v581_rollback_before_policy ON COMMIT DROP AS
SELECT pair.error_code, pair.action_code, rt.t AS runtime_target, ph.p AS phase,
       public.aka_agent_engine_resolve_policy(pair.error_code, NULL, pair.action_code, NULL, rt.t, ph.p) - 'revisions' AS p
  FROM (SELECT DISTINCT r.error_code, a.code AS action_code
          FROM public.auto_outcome_signal_rules r
          JOIN public.auto_account_actions a ON (r.action_code IS NULL OR r.action_code = a.code)
         WHERE r.platform = 'zalo' AND r.is_active AND a.flatform_type = 'zalo') pair
 CROSS JOIN (VALUES ('desktop'), ('fly')) rt(t)
 CROSS JOIN (VALUES ('before_send'), ('after_send')) ph(p);
CREATE TEMP TABLE v581_rollback_before_class ON COMMIT DROP AS
SELECT s.kind, s.code, a.code AS action_code, ph.p AS phase,
       (SELECT cs.error_code FROM public.aka_agent_engine_classify_signal('zalo', a.code, ph.p, jsonb_build_object('kind', s.kind, 'code', s.code)) cs) AS error_code
  FROM (SELECT DISTINCT r.signal_kind AS kind, r.pattern AS code FROM public.auto_outcome_signal_rules r
         WHERE r.platform = 'zalo' AND r.signal_kind IN ('zalo_code', 'engine') AND r.pattern <> '*'
        UNION SELECT 'zalo_code', '114'
        UNION SELECT 'engine', x FROM unnest(ARRAY['uid_is_phone', 'target_is_self', 'uid_other_account']) x) s
 CROSS JOIN (SELECT code FROM public.auto_account_actions WHERE flatform_type = 'zalo') a
 CROSS JOIN (VALUES ('before_send'), ('in_flight'), ('after_send')) ph(p);
CREATE TEMP TABLE v581_rollback_before_lint ON COMMIT DROP AS SELECT issue, subject FROM public.aka_agent_engine_policy_lint;

DELETE FROM public.auto_outcome_signal_rules WHERE source = 'v581';
DELETE FROM public.auto_outcome_policies WHERE source = 'v581';
UPDATE public.auto_error SET is_active = false, is_delete = true WHERE error_type = 'engine v2' AND error_code = ANY (ARRAY['err_engine_zalo_tag_full', 'err_engine_zalo_uid_is_phone', 'err_engine_zalo_target_is_self', 'err_engine_zalo_uid_other_account']);

DO $post$
DECLARE n integer;
BEGIN
  IF (SELECT cs.error_code FROM public.aka_agent_engine_classify_signal('zalo', 'zalo_tag_contact', 'after_send', '{"kind": "zalo_code", "code": "114"}'::jsonb) cs)
     IS DISTINCT FROM 'err_zalo_invalid_param' THEN
    RAISE EXCEPTION 'Gỡ V581 postflight: 114 × gắn tag chưa về err_zalo_invalid_param';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_outcome_policies WHERE error_code = ANY (ARRAY['err_engine_zalo_tag_full', 'err_engine_zalo_uid_is_phone', 'err_engine_zalo_target_is_self', 'err_engine_zalo_uid_other_account']) AND is_active AND NOT is_delete) THEN
    RAISE EXCEPTION 'Gỡ V581 postflight: còn chính sách của mã mới';
  END IF;
  -- Cặp của mã đã tắt không còn trong ảnh chụp sau (không còn luật trỏ tới), nên chỉ so các cặp còn lại.
  DELETE FROM v581_rollback_before_policy WHERE error_code = ANY (ARRAY['err_engine_zalo_tag_full', 'err_engine_zalo_uid_is_phone', 'err_engine_zalo_target_is_self', 'err_engine_zalo_uid_other_account']);
  SELECT count(*) INTO n FROM v581_rollback_before_policy b
   WHERE (public.aka_agent_engine_resolve_policy(b.error_code, NULL, b.action_code, NULL, b.runtime_target, b.phase) - 'revisions') IS DISTINCT FROM b.p;
  IF n > 0 THEN RAISE EXCEPTION 'Gỡ V581 postflight: % cặp (mã, thao tác) có sẵn bị đổi chính sách', n; END IF;
  SELECT count(*) INTO n FROM v581_rollback_before_class b
   WHERE NOT ((b.kind = 'zalo_code' AND b.code = '114' AND b.action_code = 'zalo_tag_contact')
     OR (b.kind = 'engine' AND b.code = ANY (ARRAY['uid_is_phone', 'target_is_self', 'uid_other_account'])))
     AND (SELECT cs.error_code FROM public.aka_agent_engine_classify_signal('zalo', b.action_code, b.phase, jsonb_build_object('kind', b.kind, 'code', b.code)) cs)
         IS DISTINCT FROM b.error_code;
  IF n > 0 THEN RAISE EXCEPTION 'Gỡ V581 postflight: % cặp (tín hiệu, thao tác, pha) khác bị đổi phân loại', n; END IF;
  SELECT count(*) INTO n FROM public.aka_agent_engine_policy_lint l
   WHERE NOT EXISTS (SELECT 1 FROM v581_rollback_before_lint b WHERE b.issue IS NOT DISTINCT FROM l.issue AND b.subject IS NOT DISTINCT FROM l.subject);
  IF n > 0 THEN RAISE EXCEPTION 'Gỡ V581 postflight: % dòng lint mới', n; END IF;
END $post$;

COMMIT;
