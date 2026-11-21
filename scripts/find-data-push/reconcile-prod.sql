-- Cần V614 (khoá so sánh mới).
-- Đối chiếu chỉ đọc: data chiến dịch tìm data (A) đẩy sang chiến dịch đích (B) và Nhóm data, sau khi Desktop gọi hàm đẩy V608/V610.
-- Mỗi dòng trả về là một chỗ lệch; không dòng nào = khớp. Sửa mốc thời gian ở CTE params (giờ UTC) trước khi chạy.
--   supabase db query --linked -f scripts/find-data-push/reconcile-prod.sql -o json     (hoặc dán vào SQL Editor)
-- Kiểm:
--   C1 dòng sổ đẩy "inserted" phải trỏ tới đúng một dòng của B: cùng chiến dịch, còn sống, đúng giá trị, khoá khớp.
--   C2 B không có hai dòng còn sống cùng khoá mà một trong hai do hàm đẩy thêm (thêm trùng).
--   C3 bộ đếm inserted_count của liên kết = số dòng sổ "inserted" của liên kết.
--   C4 dòng sổ trỏ tới dòng "Tìm data" của đúng chiến dịch nguồn.
--   C5 lượt đẩy sang Nhóm data của chiến dịch tìm data không ở trạng thái lỗi / treo quá 5 phút.
--   C6 liên kết đang "active" mà đích đã xoá / không còn nhận được (khác lý do lúc ghi sổ).
BEGIN READ ONLY;
SET LOCAL statement_timeout = '55s';
WITH params AS (SELECT timestamptz '2026-11-21 00:00:00+00' AS since),
ledger AS MATERIALIZED (
  SELECT d.*, r.output_kind, r.value_column, r.source_action_id
    FROM public.auto_campaign_data_link_deliveries AS d
    JOIN public.auto_campaign_data_links AS l ON l.id = d.link_id
    JOIN public.auto_campaign_data_link_rules AS r ON r.id = l.rule_id
   WHERE d.created_at >= (SELECT since FROM params)
),
c1 AS (
  SELECT 'C1' AS check_id, g.target_campaign_id AS campaign_id, g.id AS ref_id,
         CASE WHEN x.id IS NULL THEN 'sổ đẩy trỏ tới dòng không có'
              WHEN x.campaign_id <> g.target_campaign_id THEN 'dòng thuộc chiến dịch khác'
              WHEN COALESCE(x.is_delete, false) THEN 'dòng đã xoá'
              WHEN CASE WHEN g.value_column = 'phone' THEN x.phone ELSE x.uid END IS DISTINCT FROM g.value THEN 'giá trị khác sổ'
              ELSE 'khoá khác sổ' END AS problem,
         left(g.value, 200) AS detail
    FROM ledger AS g
    LEFT JOIN public.auto_campaign_input_data AS x ON x.id = g.target_input_data_id
   WHERE g.result = 'inserted'
     AND (x.id IS NULL OR x.campaign_id <> g.target_campaign_id OR COALESCE(x.is_delete, false)
          OR CASE WHEN g.value_column = 'phone' THEN x.phone ELSE x.uid END IS DISTINCT FROM g.value
          OR private.aka_agent_find_data_match_key(g.output_kind, CASE WHEN g.value_column = 'phone' THEN x.phone ELSE x.uid END)
             IS DISTINCT FROM g.value_key)
),
pushed AS MATERIALIZED (
  SELECT DISTINCT g.target_campaign_id, g.output_kind, g.value_column, g.target_input_data_id
    FROM ledger AS g WHERE g.result = 'inserted' AND g.target_input_data_id IS NOT NULL
),
-- Mỗi dòng còn sống của B (chỉ B có dòng do hàm đẩy thêm) tính khoá một lần, rồi gom theo khoá.
bkeys AS MATERIALIZED (
  SELECT x.id, x.campaign_id, t.output_kind,
         private.aka_agent_find_data_match_key(t.output_kind, CASE WHEN t.value_column = 'phone' THEN x.phone ELSE x.uid END) AS k
    FROM (SELECT DISTINCT target_campaign_id, output_kind, value_column FROM pushed) AS t
    JOIN public.auto_campaign_input_data AS x ON x.campaign_id = t.target_campaign_id AND NOT COALESCE(x.is_delete, false)
),
c2 AS (
  SELECT 'C2' AS check_id, b.campaign_id, min(b.id) FILTER (WHERE b.id IN (SELECT target_input_data_id FROM pushed)) AS ref_id,
         'B có dòng trùng khoá với dòng hàm đẩy thêm' AS problem,
         left(b.k, 200) || ' / dòng ' || string_agg(b.id::text, ',' ORDER BY b.id) AS detail
    FROM bkeys AS b
   WHERE b.k IS NOT NULL
   GROUP BY b.campaign_id, b.output_kind, b.k
  HAVING count(*) > 1 AND bool_or(b.id IN (SELECT target_input_data_id FROM pushed))
),
c3 AS (
  SELECT 'C3' AS check_id, l.target_campaign_id AS campaign_id, l.id AS ref_id,
         'bộ đếm liên kết khác sổ đẩy' AS problem,
         'inserted_count ' || l.inserted_count || ' / sổ ' || COALESCE(s.n, 0) AS detail
    FROM public.auto_campaign_data_links AS l
    LEFT JOIN (SELECT link_id, count(*) AS n FROM public.auto_campaign_data_link_deliveries WHERE result = 'inserted' GROUP BY link_id) AS s
      ON s.link_id = l.id
   WHERE l.inserted_count <> COALESCE(s.n, 0)
),
c4 AS (
  SELECT 'C4' AS check_id, g.source_campaign_id AS campaign_id, g.id AS ref_id,
         CASE WHEN dt.id IS NULL THEN 'dòng "Tìm data" của sổ không có' ELSE 'dòng "Tìm data" thuộc chiến dịch khác' END AS problem,
         'detail ' || g.source_detail_id AS detail
    FROM ledger AS g
    LEFT JOIN public.auto_campaign_details AS dt ON dt.id = g.source_detail_id
   WHERE g.source_detail_id IS NOT NULL AND (dt.id IS NULL OR dt.campaign_id <> g.source_campaign_id)
),
c5 AS (
  SELECT 'C5' AS check_id, NULLIF(split_part(b.request_id, ':', 2), '')::bigint AS campaign_id, b.id AS ref_id,
         'đẩy sang Nhóm data ' || b.status AS problem, left(b.request_id, 200) AS detail
    FROM public.auto_data_ingest_batches AS b
   WHERE b.request_id LIKE 'find-data:%' AND b.created_at >= (SELECT since FROM params)
     AND b.status <> 'completed' AND b.created_at < clock_timestamp() - interval '5 minutes'
),
c6 AS (
  SELECT 'C6' AS check_id, l.target_campaign_id AS campaign_id, l.id AS ref_id,
         'liên kết active nhưng đích ' || CASE WHEN c.id IS NULL OR c.is_delete THEN 'đã xoá' ELSE 'chạy bằng Nhóm data' END AS problem,
         'nguồn ' || l.source_campaign_id AS detail
    FROM public.auto_campaign_data_links AS l
    LEFT JOIN public.auto_campaigns AS c ON c.id = l.target_campaign_id
   WHERE l.status = 'active' AND l.last_push_at >= (SELECT since FROM params)
     AND (c.id IS NULL OR COALESCE(c.is_delete, false) OR c.data_target_source_mode = 'data_group')
     AND EXISTS (SELECT 1 FROM public.auto_campaign_data_link_deliveries AS d
                  WHERE d.link_id = l.id AND d.created_at > COALESCE(c.updated_at, '-infinity'))
)
SELECT * FROM c1 UNION ALL SELECT * FROM c2 UNION ALL SELECT * FROM c3 UNION ALL SELECT * FROM c4
UNION ALL SELECT * FROM c5 UNION ALL SELECT * FROM c6
ORDER BY 1, 2, 3
LIMIT 500;
ROLLBACK;
