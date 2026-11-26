-- Bật cờ engine v2 (org_organization.use_new_zalo_runtime) cho 35 tổ chức chỉ dùng Zalo Desktop bị sót ở đợt 14/11/2026 02:04 VN
-- (đợt đó chỉ chọn tổ chức đang có chiến dịch Zalo chờ / chạy hoặc chạy trong 7 ngày: 304 / 448). Danh sách đọc chỉ đọc 26/11/2026 16:46 VN:
-- cờ tắt, còn gói 16 / 18, có tài khoản Zalo QR / trình duyệt chưa xoá, KHÔNG có tài khoản Zalo Server chưa xoá nào (không chuyển phiên,
-- không đụng VPS / Fly), không tổ chức nào có Chat. Desktop đọc cờ lúc đăng nhập (V513) ⇒ có hiệu lực khi nhân viên Desktop từ 9.6.0 đăng
-- nhập lại. Quét token bộ cũ 16:46: 5 tài khoản (524, 840, 1287, 1704) đang chạy chiến dịch bằng bộ cũ ngay lúc đó, Desktop tự dọn khi
-- đăng nhập lại trước khi engine v2 nhận việc. Không phải DDL (không nạp lại schema PostgREST).
-- Gỡ: UPDATE public.org_organization SET use_new_zalo_runtime = false WHERE id = ANY(ARRAY[240,306,310,346,461,502,524,533,534,579,776,840,848,864,1172,1210,1268,1270,1279,1287,1389,1402,1436,1516,1531,1539,1604,1623,1685,1704,1715,1791,2042,2064,2091]); (có hiệu lực khi đăng nhập lại)
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';
DO $flag$
DECLARE
  v_ids bigint[] := ARRAY[240,306,310,346,461,502,524,533,534,579,776,840,848,864,1172,1210,1268,1270,1279,1287,1389,1402,1436,1516,1531,1539,1604,1623,1685,1704,1715,1791,2042,2064,2091]::bigint[];
  v_n integer;
BEGIN
  IF array_length(v_ids, 1) <> 35 THEN RAISE EXCEPTION 'guard: danh sách phải có 35 tổ chức, có %', array_length(v_ids, 1); END IF;
  SELECT count(*) INTO v_n FROM public.org_organization WHERE id = ANY(v_ids) AND use_new_zalo_runtime IS NOT TRUE;
  IF v_n <> 35 THEN RAISE EXCEPTION 'guard: cần 35 tổ chức đang tắt cờ, thấy %', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.auto_accounts a WHERE a.organization_id = ANY(v_ids) AND coalesce(a.is_delete, false) = false
     AND lower(btrim(coalesce(a.flatform_type, ''))) = 'zalo' AND coalesce(a.is_zalo_server, false);
  IF v_n <> 0 THEN RAISE EXCEPTION 'guard: % tài khoản Zalo Server trong danh sách', v_n; END IF;
  SELECT count(*) INTO v_n FROM unnest(v_ids) AS x(id) WHERE public.aka_agent_app_access_chat_runtime(x.id, true);
  IF v_n <> 0 THEN RAISE EXCEPTION 'guard: % tổ chức là tổ chức Chat', v_n; END IF;
  UPDATE public.org_organization SET use_new_zalo_runtime = true WHERE id = ANY(v_ids) AND use_new_zalo_runtime IS NOT TRUE;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 35 THEN RAISE EXCEPTION 'guard: đã đổi % dòng', v_n; END IF;
END $flag$;
COMMIT;
