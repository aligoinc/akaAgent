-- Gỡ V512: xoá luật source 'v512' (phân loại về như V495–V511).
-- SINH TỪ scripts/build-v512-sql.cjs. Chỉ dữ liệu.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.auto_outcome_signal_rules WHERE source = 'v512') THEN
    RAISE EXCEPTION 'Gỡ V512: chưa có V512';
  END IF;
END $pre$;

-- Ảnh chụp trước khi gỡ; sau khi gỡ, ô V512 đổi phải về như trước V512 (UNK01 / bắt-tất-cả), ô khác giữ nguyên.
CREATE TEMP TABLE v512_rollback_before_class ON COMMIT DROP AS
SELECT z.code, a.code AS action_code, ph.p AS phase,
       (SELECT cs.error_code FROM public.aka_agent_engine_classify_signal('zalo', a.code, ph.p, jsonb_build_object('kind', 'fly_command', 'code', z.code)) cs) AS error_code
  FROM (SELECT DISTINCT r.pattern AS code FROM public.auto_outcome_signal_rules r
         WHERE r.platform = 'zalo' AND r.signal_kind = 'fly_command' AND r.pattern <> '*'
        UNION SELECT unnest(ARRAY['runtime_payload_invalid', 'runtime_label_session_reset'])) z
 CROSS JOIN (SELECT code FROM public.auto_account_actions WHERE flatform_type = 'zalo') a
 CROSS JOIN (VALUES ('before_send'), ('in_flight'), ('after_send')) ph(p);
CREATE TEMP TABLE v512_rollback_before_policy ON COMMIT DROP AS
SELECT pair.error_code, pair.action_code, rt.t AS runtime_target, ph.p AS phase,
       public.aka_agent_engine_resolve_policy(pair.error_code, NULL, pair.action_code, NULL, rt.t, ph.p) - 'revisions' AS p
  FROM (SELECT DISTINCT r.error_code, a.code AS action_code
          FROM public.auto_outcome_signal_rules r
          JOIN public.auto_account_actions a ON (r.action_code IS NULL OR r.action_code = a.code)
         WHERE r.platform = 'zalo' AND r.is_active AND a.flatform_type = 'zalo') pair
 CROSS JOIN (VALUES ('desktop'), ('fly')) rt(t)
 CROSS JOIN (VALUES ('before_send'), ('in_flight'), ('after_send')) ph(p);
CREATE TEMP TABLE v512_rollback_before_lint ON COMMIT DROP AS SELECT issue, subject FROM public.aka_agent_engine_policy_lint;

DELETE FROM public.auto_outcome_signal_rules WHERE source = 'v512';

DO $post$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM v512_rollback_before_class b
   WHERE CASE
      WHEN b.code IN ('command_result_unknown', 'command_dispatch_failed') AND b.action_code = ANY (ARRAY['zalo_tag_contact', 'zalo_change_alias']) THEN 'err_network_offline'
      WHEN b.code IN ('command_result_unknown', 'command_dispatch_failed') AND b.phase = 'before_send' THEN 'err_engine_runtime_unavailable'
      WHEN b.code = 'runtime_payload_invalid' THEN 'err_engine_runtime_unavailable'
      WHEN b.code = 'runtime_label_session_reset' AND b.phase = 'before_send' THEN 'err_engine_runtime_unavailable'
      WHEN b.code = 'runtime_label_session_reset' AND b.phase = 'in_flight' THEN 'err_engine_unknown_delivery'
      ELSE NULL END IS NULL AND (SELECT cs.error_code FROM public.aka_agent_engine_classify_signal('zalo', b.action_code, b.phase,
           jsonb_build_object('kind', 'fly_command', 'code', b.code)) cs) IS DISTINCT FROM b.error_code;
  IF n > 0 THEN RAISE EXCEPTION 'Gỡ V512 postflight: % ô ngoài V512 bị đổi phân loại', n; END IF;
  IF (SELECT cs.error_code FROM public.aka_agent_engine_classify_signal('zalo', 'zalo_find_phone_user', 'before_send',
        '{"kind": "fly_command", "code": "command_result_unknown"}'::jsonb) cs) IS DISTINCT FROM 'err_engine_unknown_delivery' THEN
    RAISE EXCEPTION 'Gỡ V512 postflight: command_result_unknown chưa về UNK01';
  END IF;
  SELECT count(*) INTO n FROM v512_rollback_before_policy b
   WHERE (public.aka_agent_engine_resolve_policy(b.error_code, NULL, b.action_code, NULL, b.runtime_target, b.phase) - 'revisions') IS DISTINCT FROM b.p;
  IF n > 0 THEN RAISE EXCEPTION 'Gỡ V512 postflight: % chính sách bị đổi', n; END IF;
END $post$;

COMMIT;
