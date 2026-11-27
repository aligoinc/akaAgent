-- Dọn chiến dịch đang "chờ xử lý" mà đã qua ngày kết thúc (lỗi V214, sửa ở V674). CHỈ CHẠY SAU KHI V674 ĐÃ APPLY và anh duyệt.
-- Mỗi chiến dịch gọi đúng hàm kết thúc của Desktop bản V674 (aka_agent_finalize_campaign, trạng thái chờ 'chờ xử lý', ghi chú
-- 'Chiến dịch đã hết ngày kết thúc'): đóng data còn "chờ xử lý" kèm ghi chú 'Chưa gửi vì chiến dịch đã hết ngày kết thúc' rồi hoàn thành.
-- Bỏ qua: chiến dịch đang chạy / tạm dừng / Nhóm data, còn giữ lượt bộ cũ (runtime_claim_token / runtime_unit_token), có lượt engine v2
-- đang mở, khoá bận quá 2 giây. Một chiến dịch lỗi không làm hỏng các chiến dịch khác (khối con riêng).
-- In ra danh sách id đã xử lý để làm biên nhận. Chạy: supabase db query --linked -f scripts/campaign-end-date/cleanup-overdue-v674.sql -o json
BEGIN;
SET LOCAL statement_timeout = '120s';
SET LOCAL lock_timeout = '2s';
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

DO $guard$
BEGIN
  IF md5(pg_get_functiondef('public.aka_agent_finalize_campaign(bigint,bigint,bigint,text,boolean,text,text,text)'::regprocedure))
     IS DISTINCT FROM 'd725436433a8760cf07d5978209c9f64' THEN
    RAISE EXCEPTION 'aka_agent_finalize_campaign chưa phải bản V674, không dọn';
  END IF;
END $guard$;

CREATE TEMP TABLE v674_cleanup(campaign_id bigint PRIMARY KEY, staff_id bigint, organization_id bigint, pending_before bigint,
  reason text, completed boolean, error text) ON COMMIT DROP;

INSERT INTO v674_cleanup(campaign_id, staff_id, organization_id, pending_before)
SELECT c.id, c.staff_id, c.organization_id,
       (SELECT count(*) FROM public.auto_campaign_input_data d
         WHERE d.campaign_id = c.id AND coalesce(d.is_delete, false) = false AND d.status = 'chờ xử lý')
FROM public.auto_campaigns c
WHERE coalesce(c.is_delete, false) = false
  AND c.status = 'chờ xử lý'
  AND coalesce(c.data_target_source_mode, 'direct') = 'direct'
  AND c.schedule_end_date IS NOT NULL AND c.schedule_end_date < now()
  AND c.runtime_claim_token IS NULL AND c.runtime_unit_token IS NULL
  AND c.organization_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.auto_engine_target_runs r
                   WHERE r.campaign_id = c.id AND r.completed_at IS NULL AND r.started_at > now() - interval '1 day');

DO $cleanup$
DECLARE r record; res record;
BEGIN
  FOR r IN SELECT * FROM v674_cleanup ORDER BY campaign_id LOOP
    BEGIN
      SELECT * INTO res FROM public.aka_agent_finalize_campaign(r.staff_id, r.organization_id, r.campaign_id,
        'Chiến dịch đã hết ngày kết thúc', true, 'chờ xử lý', NULL, NULL);
      UPDATE v674_cleanup SET reason = res.reason, completed = res.completed WHERE campaign_id = r.campaign_id;
    EXCEPTION WHEN OTHERS THEN
      UPDATE v674_cleanup SET error = SQLSTATE || ' ' || SQLERRM WHERE campaign_id = r.campaign_id;
    END;
  END LOOP;
END $cleanup$;

SELECT json_build_object(
  'campaigns', (SELECT count(*) FROM v674_cleanup),
  'completed', (SELECT count(*) FROM v674_cleanup WHERE completed),
  'pending_closed', (SELECT coalesce(sum(pending_before), 0) FROM v674_cleanup WHERE completed),
  'by_reason', (SELECT json_agg(t) FROM (SELECT coalesce(reason, 'error') reason, count(*) n FROM v674_cleanup GROUP BY 1) t),
  'errors', (SELECT json_agg(t) FROM (SELECT campaign_id, error FROM v674_cleanup WHERE error IS NOT NULL) t),
  'ids', (SELECT json_agg(campaign_id ORDER BY campaign_id) FROM v674_cleanup WHERE completed)
) AS receipt;

COMMIT;
