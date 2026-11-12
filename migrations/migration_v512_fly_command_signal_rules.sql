-- V512: luật phân loại cho tín hiệu lệnh Fly mà Desktop không có (12/11/2026, "Sửa toàn bộ" sau khi rà mọi lệnh zalo_runtime).
-- SINH TỪ scripts/build-v512-sql.cjs, không sửa tay.
--
-- Chỉ thêm 9 dòng auto_outcome_signal_rules (source 'v512', signal_kind fly_command) của engine v2:
--   * command_result_unknown (before_send) → err_engine_runtime_unavailable
--   * command_dispatch_failed (before_send) → err_engine_runtime_unavailable
--   * runtime_payload_invalid → err_engine_runtime_unavailable
--   * runtime_label_session_reset (before_send) → err_engine_runtime_unavailable
--   * runtime_label_session_reset (in_flight) → err_engine_unknown_delivery
--   * command_result_unknown × zalo_tag_contact → err_network_offline
--   * command_dispatch_failed × zalo_tag_contact → err_network_offline
--   * command_result_unknown × zalo_change_alias → err_network_offline
--   * command_dispatch_failed × zalo_change_alias → err_network_offline
-- Bộ chạy cũ không đọc bảng này; Desktop không phát tín hiệu fly_command. Không DDL (bảng tạm chỉ trong giao dịch), không đổi chính sách,
-- mã lỗi hay hàm. Postflight chứng minh chỉ đúng các ô (mã lệnh, thao tác, pha) trên đổi phân loại, chính sách và lint giữ nguyên.
-- Gỡ: rollback_v512_fly_command_signal_rules.sql.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
DECLARE n integer;
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v512_%') THEN
      RAISE EXCEPTION 'V512 đã có trong sổ migration, không chạy lại';
    END IF;
  END IF;
  SELECT count(*) INTO n FROM public.auto_error
   WHERE error_code = ANY (ARRAY['err_network_offline', 'err_engine_runtime_unavailable', 'err_engine_unknown_delivery']) AND is_active AND NOT is_delete;
  IF n <> 3 THEN RAISE EXCEPTION 'V512: cần đủ 3 mã err_network_offline / err_engine_runtime_unavailable / err_engine_unknown_delivery đang bật (thấy %)', n; END IF;
  IF EXISTS (SELECT 1 FROM public.auto_outcome_signal_rules WHERE source = 'v512') THEN
    RAISE EXCEPTION 'V512: đã có luật source v512';
  END IF;
  -- Không có sẵn luật trùng (mã lệnh, thao tác, pha) với luật sắp thêm.
  SELECT count(*) INTO n FROM public.auto_outcome_signal_rules r
    JOIN (VALUES (NULL, 'before_send', 'command_result_unknown'), (NULL, 'before_send', 'command_dispatch_failed'), (NULL, NULL, 'runtime_payload_invalid'), (NULL, 'before_send', 'runtime_label_session_reset'), (NULL, 'in_flight', 'runtime_label_session_reset'), ('zalo_tag_contact', NULL, 'command_result_unknown'), ('zalo_tag_contact', NULL, 'command_dispatch_failed'), ('zalo_change_alias', NULL, 'command_result_unknown'), ('zalo_change_alias', NULL, 'command_dispatch_failed')) v(action_code, phase, pattern)
      ON r.pattern = v.pattern AND r.action_code IS NOT DISTINCT FROM v.action_code AND r.phase IS NOT DISTINCT FROM v.phase
   WHERE r.platform = 'zalo' AND r.signal_kind = 'fly_command' AND r.is_active;
  IF n > 0 THEN RAISE EXCEPTION 'V512: đã có % luật trùng với luật sắp thêm', n; END IF;
  -- Trạng thái đã đọc (V495): lệnh không rõ kết quả ra UNK01 ở mọi pha và mọi thao tác.
  IF (SELECT cs.error_code FROM public.aka_agent_engine_classify_signal('zalo', 'zalo_find_phone_user', 'before_send',
        '{"kind": "fly_command", "code": "command_result_unknown"}'::jsonb) cs) IS DISTINCT FROM 'err_engine_unknown_delivery'
     OR (SELECT cs.error_code FROM public.aka_agent_engine_classify_signal('zalo', 'zalo_tag_contact', 'in_flight',
        '{"kind": "fly_command", "code": "command_result_unknown"}'::jsonb) cs) IS DISTINCT FROM 'err_engine_unknown_delivery' THEN
    RAISE EXCEPTION 'V512: phân loại command_result_unknown khác bản V495 đã đọc, không tự đổi';
  END IF;
END $pre$;

CREATE TEMP TABLE v512_before_class ON COMMIT DROP AS
SELECT z.code, a.code AS action_code, ph.p AS phase,
       (SELECT cs.error_code FROM public.aka_agent_engine_classify_signal('zalo', a.code, ph.p, jsonb_build_object('kind', 'fly_command', 'code', z.code)) cs) AS error_code
  FROM (SELECT DISTINCT r.pattern AS code FROM public.auto_outcome_signal_rules r
         WHERE r.platform = 'zalo' AND r.signal_kind = 'fly_command' AND r.pattern <> '*'
        UNION SELECT unnest(ARRAY['runtime_payload_invalid', 'runtime_label_session_reset'])) z
 CROSS JOIN (SELECT code FROM public.auto_account_actions WHERE flatform_type = 'zalo') a
 CROSS JOIN (VALUES ('before_send'), ('in_flight'), ('after_send')) ph(p);
CREATE TEMP TABLE v512_before_policy ON COMMIT DROP AS
SELECT pair.error_code, pair.action_code, rt.t AS runtime_target, ph.p AS phase,
       public.aka_agent_engine_resolve_policy(pair.error_code, NULL, pair.action_code, NULL, rt.t, ph.p) - 'revisions' AS p
  FROM (SELECT DISTINCT r.error_code, a.code AS action_code
          FROM public.auto_outcome_signal_rules r
          JOIN public.auto_account_actions a ON (r.action_code IS NULL OR r.action_code = a.code)
         WHERE r.platform = 'zalo' AND r.is_active AND a.flatform_type = 'zalo') pair
 CROSS JOIN (VALUES ('desktop'), ('fly')) rt(t)
 CROSS JOIN (VALUES ('before_send'), ('in_flight'), ('after_send')) ph(p);
CREATE TEMP TABLE v512_before_lint ON COMMIT DROP AS SELECT issue, subject FROM public.aka_agent_engine_policy_lint;

INSERT INTO public.auto_outcome_signal_rules (platform, action_code, phase, signal_kind, pattern, priority, error_code, source, note) VALUES
  ('zalo', NULL, 'before_send', 'fly_command', 'command_result_unknown', 50, 'err_engine_runtime_unavailable', 'v512', '[V512] Lệnh đọc không có kết quả: chưa gửi gì (lệnh đọc không đổi gì trên Zalo), về hàng đợi.'),
  ('zalo', NULL, 'before_send', 'fly_command', 'command_dispatch_failed', 50, 'err_engine_runtime_unavailable', 'v512', '[V512] Lệnh đọc giao cho runtime lỗi: chưa gửi gì, về hàng đợi.'),
  ('zalo', NULL, NULL, 'fly_command', 'runtime_payload_invalid', 50, 'err_engine_runtime_unavailable', 'v512', '[V512] Runtime từ chối tham số lệnh trước khi gọi Zalo (worker và runtime lệch phiên bản): về hàng đợi.'),
  ('zalo', NULL, 'before_send', 'fly_command', 'runtime_label_session_reset', 50, 'err_engine_runtime_unavailable', 'v512', '[V512] Phiên tag bị huỷ (runtime đăng nhập lại hoặc dừng) trước khi ghi tag: chưa gửi gì, về hàng đợi.'),
  ('zalo', NULL, 'in_flight', 'fly_command', 'runtime_label_session_reset', 50, 'err_engine_unknown_delivery', 'v512', '[V512] Phiên tag bị huỷ sau khi Zalo đã ghi tag: không rõ kết quả, như Desktop.'),
  ('zalo', 'zalo_tag_contact', NULL, 'fly_command', 'command_result_unknown', 50, 'err_network_offline', 'v512', '[V512] Thao tác phụ không rõ kết quả (runtime hết giờ): như Desktop treo tới hạn bước, NET01.'),
  ('zalo', 'zalo_tag_contact', NULL, 'fly_command', 'command_dispatch_failed', 50, 'err_network_offline', 'v512', '[V512] Thao tác phụ giao cho runtime lỗi: như Desktop treo tới hạn bước, NET01.'),
  ('zalo', 'zalo_change_alias', NULL, 'fly_command', 'command_result_unknown', 50, 'err_network_offline', 'v512', '[V512] Thao tác phụ không rõ kết quả (runtime hết giờ): như Desktop treo tới hạn bước, NET01.'),
  ('zalo', 'zalo_change_alias', NULL, 'fly_command', 'command_dispatch_failed', 50, 'err_network_offline', 'v512', '[V512] Thao tác phụ giao cho runtime lỗi: như Desktop treo tới hạn bước, NET01.');

DO $post$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM public.auto_outcome_signal_rules WHERE source = 'v512' AND is_active;
  IF n <> 9 THEN RAISE EXCEPTION 'V512 postflight: cần 9 luật mới (thấy %)', n; END IF;
  -- Phân loại: đúng các ô đổi theo V512, mọi ô khác giữ nguyên.
  SELECT count(*) INTO n FROM v512_before_class b
   WHERE (SELECT cs.error_code FROM public.aka_agent_engine_classify_signal('zalo', b.action_code, b.phase,
           jsonb_build_object('kind', 'fly_command', 'code', b.code)) cs)
         IS DISTINCT FROM COALESCE(CASE
      WHEN b.code IN ('command_result_unknown', 'command_dispatch_failed') AND b.action_code = ANY (ARRAY['zalo_tag_contact', 'zalo_change_alias']) THEN 'err_network_offline'
      WHEN b.code IN ('command_result_unknown', 'command_dispatch_failed') AND b.phase = 'before_send' THEN 'err_engine_runtime_unavailable'
      WHEN b.code = 'runtime_payload_invalid' THEN 'err_engine_runtime_unavailable'
      WHEN b.code = 'runtime_label_session_reset' AND b.phase = 'before_send' THEN 'err_engine_runtime_unavailable'
      WHEN b.code = 'runtime_label_session_reset' AND b.phase = 'in_flight' THEN 'err_engine_unknown_delivery'
      ELSE NULL END, b.error_code);
  IF n > 0 THEN RAISE EXCEPTION 'V512 postflight: % ô (mã lệnh Fly, thao tác, pha) phân loại chưa đúng', n; END IF;
  -- Chính sách không đổi (V512 chỉ thêm luật).
  SELECT count(*) INTO n FROM v512_before_policy b
   WHERE (public.aka_agent_engine_resolve_policy(b.error_code, NULL, b.action_code, NULL, b.runtime_target, b.phase) - 'revisions') IS DISTINCT FROM b.p;
  IF n > 0 THEN RAISE EXCEPTION 'V512 postflight: % chính sách bị đổi', n; END IF;
  SELECT count(*) INTO n FROM public.aka_agent_engine_policy_lint l
   WHERE NOT EXISTS (SELECT 1 FROM v512_before_lint b WHERE b.issue IS NOT DISTINCT FROM l.issue AND b.subject IS NOT DISTINCT FROM l.subject);
  IF n > 0 THEN RAISE EXCEPTION 'V512 postflight: % dòng lint mới', n; END IF;
END $post$;

COMMIT;
