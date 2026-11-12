-- V514 (12/11/2026, anh: "Làm PR nhỏ"): giữ khớp hai cơ chế trạng thái trên auto_status.
--   * V494 (phiên khác): trạng thái hệ thống system_status_code (thành công / thất bại / bỏ qua / dừng / lỗi / chờ), bắt buộc với
--     trạng thái kết quả (component campaign_detail).
--   * V495 (engine v2): report_group, counts_as_delivered, progress_rank, parent_status_id (trạng thái gốc để engine kế thừa nghĩa và
--     chính sách, aka_agent_status_semantics).
-- Lúc apply V494 hai bên khớp nhau (kiểm một lần), nhưng chưa gì giữ khớp cho các dòng thêm / sửa về sau. Rà 12/11 trên akachat:
-- 30/30 trạng thái kết quả khớp, chưa dòng nào có trạng thái gốc.
--
-- CHỈ THÊM, KHÔNG ĐỔI HÀNH VI BỘ CHẠY:
--   1. Trigger auto_status_system_group_guard_v514 (BEFORE INSERT / UPDATE OF report_group, system_status_code, parent_status_id,
--      component_type ON auto_status), chỉ với trạng thái kết quả:
--        - nhóm báo cáo hiệu lực (của dòng, không có thì của trạng thái gốc gần nhất, như aka_agent_status_semantics) phải có và
--          trùng nhóm của trạng thái hệ thống;
--        - trạng thái gốc (nếu có) cùng nhóm hệ thống với dòng; sửa một dòng thì các dòng con của nó vẫn phải khớp.
--      Bộ chạy không ghi auto_status (chỉ migration / admin), sửa tên, mô tả, thứ tự hay bật / tắt không kích hoạt trigger.
--   2. View aka_agent_engine_policy_lint thêm hai loại kiểm (giữ nguyên 4 loại cũ của V495):
--        - status_group_mismatch: như trigger, cho dòng đã có (và khi trigger bị bỏ qua);
--        - detail_status_differs_from_auto_error: trạng thái lịch sử theo mã lỗi đang nằm ở HAI chỗ — auto_error.detail_status
--          (hoặc detail_mode 'override' + detail_status_id) cho bộ chạy cũ, auto_outcome_policies.detail_status_id cho engine v2
--          (engine không đọc auto_error). Báo khi cùng một mã × hành động mà hai bên ghi khác trạng thái. Chỉ so chính sách chung
--          (không khoanh theo trạng thái, loại chiến dịch hay nơi chạy) và chỉ khi engine có trạng thái riêng cho mã đó.
--      Trên akachat 12/11 cả hai loại ra 0 dòng (so 21 cặp mã × hành động).
--
-- Bật trạng thái mới của V494 (người nhận chặn tin, lỗi kết nối, chưa rõ kết quả…) về sau: sửa cả auto_error lẫn
-- auto_outcome_policies, đặt trạng thái gốc cùng nhóm hệ thống, rồi SELECT * FROM aka_agent_engine_policy_lint phải rỗng.
--
-- Cần V494 (auto_system_statuses, auto_status.system_status_code) và V495. Thay view là DDL và tạo hàm: PostgREST nạp lại schema,
-- apply ngoài giờ cao điểm. Gỡ: rollback_v514_status_system_group_guard.sql.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
DECLARE n integer;
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v514_%') THEN
      RAISE EXCEPTION 'V514 đã có trong sổ migration, không chạy lại';
    END IF;
  END IF;
  IF to_regclass('public.auto_system_statuses') IS NULL OR NOT EXISTS (
       SELECT 1 FROM pg_attribute WHERE attrelid = 'public.auto_status'::regclass AND attname = 'system_status_code' AND NOT attisdropped) THEN
    RAISE EXCEPTION 'V514 cần V494 (auto_system_statuses, auto_status.system_status_code)';
  END IF;
  IF to_regprocedure('public.aka_agent_status_semantics(bigint)') IS NULL OR to_regclass('public.aka_agent_engine_policy_lint') IS NULL
     OR to_regclass('public.auto_outcome_policies') IS NULL THEN
    RAISE EXCEPTION 'V514 cần V495 (aka_agent_status_semantics, auto_outcome_policies, aka_agent_engine_policy_lint)';
  END IF;
  IF to_regprocedure('public.aka_agent_guard_status_system_group_v514()') IS NOT NULL THEN
    RAISE EXCEPTION 'V514: public.aka_agent_guard_status_system_group_v514() đã có';
  END IF;
  -- View rà soát phải đúng bản V495 (đọc trên akachat 12/11); khác thì đọc lại trước khi thay.
  IF md5(pg_get_viewdef('public.aka_agent_engine_policy_lint'::regclass, true)) IS DISTINCT FROM 'a5731bb6a4059bd38983d6240682e1be' THEN
    RAISE EXCEPTION 'V514: aka_agent_engine_policy_lint đã khác bản V495 (md5 %); đọc lại trước khi thay', md5(pg_get_viewdef('public.aka_agent_engine_policy_lint'::regclass, true));
  END IF;
  -- Dữ liệu đang có phải đạt luật mới, nếu không trigger sẽ chặn cả lần sửa hợp lệ về sau.
  SELECT count(*) INTO n
    FROM public.auto_status s
    LEFT JOIN public.auto_system_statuses ss ON ss.code = s.system_status_code
    LEFT JOIN LATERAL public.aka_agent_status_semantics(s.id) sem ON true
    LEFT JOIN public.auto_status p ON p.id = s.parent_status_id
    LEFT JOIN public.auto_system_statuses ps ON ps.code = p.system_status_code
   WHERE s.component_type = 'campaign_detail' AND NOT s.is_delete
     AND (sem.report_group IS NULL OR sem.report_group IS DISTINCT FROM ss.report_group
          OR (s.parent_status_id IS NOT NULL AND ps.report_group IS DISTINCT FROM ss.report_group));
  IF n > 0 THEN RAISE EXCEPTION 'V514: % trạng thái kết quả đang lệch nhóm báo cáo / trạng thái hệ thống; sửa trước', n; END IF;
END $pre$;

CREATE TEMP TABLE v514_lint_before ON COMMIT DROP AS SELECT issue, subject FROM public.aka_agent_engine_policy_lint;

-- 1. Trigger giữ khớp ---------------------------------------------------------------------------------------------------------
CREATE FUNCTION public.aka_agent_guard_status_system_group_v514() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $f$
DECLARE
  v_sys_group text;
  v_eff_group text;
  v_parent_group text;
  v_bad text;
BEGIN
  IF NEW.component_type IS DISTINCT FROM 'campaign_detail' THEN RETURN NEW; END IF;
  -- system_status_code NULL hay sai: để CHECK / khoá ngoại của V494 báo.
  SELECT ss.report_group INTO v_sys_group FROM public.auto_system_statuses ss WHERE ss.code = NEW.system_status_code;
  IF v_sys_group IS NULL THEN RETURN NEW; END IF;
  -- Nhóm báo cáo hiệu lực như aka_agent_status_semantics: của chính dòng, không có thì của trạng thái gốc gần nhất.
  v_eff_group := NEW.report_group;
  IF v_eff_group IS NULL AND NEW.parent_status_id IS NOT NULL THEN
    SELECT sem.report_group INTO v_eff_group FROM public.aka_agent_status_semantics(NEW.parent_status_id) sem;
  END IF;
  IF v_eff_group IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'status_report_group_missing',
      DETAIL = format('Trạng thái kết quả %s cần report_group (hoặc trạng thái gốc có report_group) cùng nhóm với trạng thái hệ thống %s (%s).',
                      NEW.code, NEW.system_status_code, v_sys_group);
  END IF;
  IF v_eff_group <> v_sys_group THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'status_report_group_system_mismatch',
      DETAIL = format('Trạng thái kết quả %s: nhóm báo cáo %s khác nhóm của trạng thái hệ thống %s (%s).',
                      NEW.code, v_eff_group, NEW.system_status_code, v_sys_group);
  END IF;
  IF NEW.parent_status_id IS NOT NULL THEN
    SELECT ss.report_group INTO v_parent_group
      FROM public.auto_status p JOIN public.auto_system_statuses ss ON ss.code = p.system_status_code
     WHERE p.id = NEW.parent_status_id;
    IF v_parent_group IS DISTINCT FROM v_sys_group THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'status_parent_system_group_mismatch',
        DETAIL = format('Trạng thái kết quả %s (%s) và trạng thái gốc %s (%s) phải cùng nhóm hệ thống.',
                        NEW.code, v_sys_group, NEW.parent_status_id, coalesce(v_parent_group, 'không có'));
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    -- Các dòng con vẫn phải cùng nhóm hệ thống; con không tự có report_group thì nhận nhóm hiệu lực mới của dòng này.
    SELECT string_agg(c.id::text, ', ' ORDER BY c.id) INTO v_bad
      FROM public.auto_status c LEFT JOIN public.auto_system_statuses cs ON cs.code = c.system_status_code
     WHERE c.parent_status_id = NEW.id AND c.component_type = 'campaign_detail' AND NOT c.is_delete
       AND (cs.report_group IS DISTINCT FROM v_sys_group OR (c.report_group IS NULL AND cs.report_group IS DISTINCT FROM v_eff_group));
    IF v_bad IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'status_children_system_group_mismatch',
        DETAIL = format('Trạng thái con %s của %s sẽ lệch nhóm hệ thống %s.', v_bad, NEW.code, v_sys_group);
    END IF;
  END IF;
  RETURN NEW;
END $f$;
COMMENT ON FUNCTION public.aka_agent_guard_status_system_group_v514() IS
  'V514: giữ khớp nhóm báo cáo (V495) với trạng thái hệ thống (V494) và trạng thái gốc của trạng thái kết quả.';
REVOKE ALL ON FUNCTION public.aka_agent_guard_status_system_group_v514() FROM PUBLIC;
DO $grants$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role', 'aka_agent_chat_api', 'aka_agent_desktop'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION public.aka_agent_guard_status_system_group_v514() FROM %I', r);
    END IF;
  END LOOP;
END $grants$;
CREATE TRIGGER auto_status_system_group_guard_v514
  BEFORE INSERT OR UPDATE OF report_group, system_status_code, parent_status_id, component_type ON public.auto_status
  FOR EACH ROW EXECUTE FUNCTION public.aka_agent_guard_status_system_group_v514();

-- 2. View rà soát: 4 loại của V495 giữ nguyên, thêm 2 loại ----------------------------------------------------------------
CREATE OR REPLACE VIEW public.aka_agent_engine_policy_lint AS
SELECT 'missing_catch_all'::text AS issue, p.platform || ' / ' || ph.phase AS subject
  FROM (VALUES ('zalo'), ('facebook'), ('email')) p(platform)
  CROSS JOIN (VALUES ('before_send'), ('in_flight'), ('after_send')) ph(phase)
 WHERE NOT EXISTS (SELECT 1 FROM public.auto_outcome_signal_rules r
                    WHERE r.is_active AND r.signal_kind = 'engine' AND r.pattern = '*'
                      AND r.platform IN (p.platform, 'system') AND (r.phase IS NULL OR r.phase = ph.phase) AND r.action_code IS NULL)
UNION ALL
SELECT 'error_without_class', e.error_code FROM public.auto_error e WHERE e.is_active AND NOT e.is_delete AND e.error_class IS NULL
UNION ALL
SELECT 'policy_on_inactive_error', p.id::text FROM public.auto_outcome_policies p JOIN public.auto_error e ON e.error_code = p.error_code
 WHERE p.is_active AND NOT p.is_delete AND (NOT e.is_active OR e.is_delete)
UNION ALL
SELECT 'rule_on_inactive_error', r.id::text FROM public.auto_outcome_signal_rules r JOIN public.auto_error e ON e.error_code = r.error_code
 WHERE r.is_active AND (NOT e.is_active OR e.is_delete)
UNION ALL
-- V514: nhóm báo cáo hiệu lực khác nhóm của trạng thái hệ thống, hoặc trạng thái gốc khác nhóm hệ thống.
SELECT 'status_group_mismatch', s.id::text || ':' || s.code
  FROM public.auto_status s
  LEFT JOIN public.auto_system_statuses ss ON ss.code = s.system_status_code
  LEFT JOIN LATERAL public.aka_agent_status_semantics(s.id) sem ON true
  LEFT JOIN public.auto_status p ON p.id = s.parent_status_id
  LEFT JOIN public.auto_system_statuses ps ON ps.code = p.system_status_code
 WHERE s.component_type = 'campaign_detail' AND NOT s.is_delete
   AND (sem.report_group IS NULL OR sem.report_group IS DISTINCT FROM ss.report_group
        OR (s.parent_status_id IS NOT NULL AND ps.report_group IS DISTINCT FROM ss.report_group))
UNION ALL
-- V514: cùng mã × hành động mà bộ chạy cũ (auto_error) và engine v2 (auto_outcome_policies) ghi khác trạng thái lịch sử.
SELECT 'detail_status_differs_from_auto_error',
       x.error_code || ' × ' || coalesce(x.action_code, '*') || ': auto_error=' || x.legacy_value || ' / engine=' || x.engine_value
  FROM (
    SELECT e.error_code, a.action_code, ls.id AS legacy_id, ls.status_value AS legacy_value, es.id AS engine_id, es.status_value AS engine_value
      FROM public.auto_error e
      CROSS JOIN LATERAL unnest(coalesce(e.zalo_action_codes, ARRAY[NULL::text])) a(action_code)
      CROSS JOIN LATERAL (
        SELECT st.id, st.status_value FROM public.auto_status st
         WHERE st.component_type = 'campaign_detail' AND NOT st.is_delete
           AND CASE WHEN e.detail_mode = 'override' AND e.detail_status_id IS NOT NULL THEN st.id = e.detail_status_id
                    ELSE lower(btrim(st.status_value)) = lower(btrim(e.detail_status)) END
         ORDER BY st.id LIMIT 1) ls
      CROSS JOIN LATERAL (
        SELECT st.id, st.status_value FROM public.auto_outcome_policies op JOIN public.auto_status st ON st.id = op.detail_status_id
         WHERE op.is_active AND NOT op.is_delete AND op.error_code = e.error_code AND op.detail_status_id IS NOT NULL
           AND op.status_id IS NULL AND op.campaign_action_id IS NULL AND op.runtime_target IS NULL
           AND (op.action_code = a.action_code OR op.action_code IS NULL)
         ORDER BY (op.action_code IS NULL), op.id LIMIT 1) es
     WHERE e.is_active AND NOT e.is_delete
       AND (e.detail_status IS NOT NULL OR (e.detail_mode = 'override' AND e.detail_status_id IS NOT NULL))
  ) x
 WHERE x.legacy_id IS DISTINCT FROM x.engine_id;

DO $post$
DECLARE n integer; v_bad text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.auto_status'::regclass AND tgname = 'auto_status_system_group_guard_v514'
                    AND tgenabled = 'O') THEN
    RAISE EXCEPTION 'V514 postflight: thiếu trigger auto_status_system_group_guard_v514';
  END IF;
  -- Cột của view giữ nguyên (issue, subject kiểu text).
  SELECT string_agg(attname || ':' || format_type(atttypid, atttypmod), ',' ORDER BY attnum) INTO v_bad
    FROM pg_attribute WHERE attrelid = 'public.aka_agent_engine_policy_lint'::regclass AND attnum > 0 AND NOT attisdropped;
  IF v_bad IS DISTINCT FROM 'issue:text,subject:text' THEN RAISE EXCEPTION 'V514 postflight: cột view đổi (%)', v_bad; END IF;
  -- 4 loại cũ ra đúng các dòng như trước; 2 loại mới không có dòng nào.
  SELECT count(*) INTO n FROM (
    (SELECT issue, subject FROM public.aka_agent_engine_policy_lint
      WHERE issue IN ('missing_catch_all', 'error_without_class', 'policy_on_inactive_error', 'rule_on_inactive_error')
     EXCEPT ALL SELECT issue, subject FROM v514_lint_before)
    UNION ALL
    (SELECT issue, subject FROM v514_lint_before
     EXCEPT ALL SELECT issue, subject FROM public.aka_agent_engine_policy_lint)) d;
  IF n > 0 THEN RAISE EXCEPTION 'V514 postflight: % dòng rà soát cũ bị đổi', n; END IF;
  SELECT string_agg(issue || ' ' || subject, '; ') INTO v_bad FROM public.aka_agent_engine_policy_lint
   WHERE issue IN ('status_group_mismatch', 'detail_status_differs_from_auto_error');
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'V514 postflight: dữ liệu hiện tại lệch: %', v_bad; END IF;
  -- Quyền đọc view giữ như trước (CREATE OR REPLACE VIEW không đổi quyền).
  IF has_table_privilege('anon', 'public.aka_agent_engine_policy_lint', 'SELECT')
     OR has_table_privilege('authenticated', 'public.aka_agent_engine_policy_lint', 'SELECT') THEN
    RAISE EXCEPTION 'V514 postflight: anon / authenticated đọc được view rà soát';
  END IF;
END $post$;

COMMIT;
