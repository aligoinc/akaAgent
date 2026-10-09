CREATE OR REPLACE FUNCTION public.crm_trial_campaign_signal_counts(p_organization_ids bigint[], p_campaign_ids bigint[])
 RETURNS TABLE(campaign_id bigint, input_total bigint, successful bigint, failed bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT c.id, inputs.input_total, result.successful, result.failed
  FROM public.auto_campaigns c
  CROSS JOIN LATERAL (
    SELECT count(*) AS input_total
    FROM public.auto_campaign_input_data i
    WHERE i.campaign_id = c.id AND i.is_delete = false
  ) inputs
  CROSS JOIN LATERAL (
    -- Số LIÊN HỆ có ít nhất một lượt thành công / lỗi (một liên hệ có thể được gửi nhiều lượt), để tỷ lệ
    -- "đã gửi / tệp nạp" cùng nghĩa với SQL autoCampaignDetail và tracking desktop (mỗi dòng = một liên hệ).
    SELECT count(DISTINCT COALESCE(d.input_data_id, d.id)) FILTER (
             WHERE (d.report_group='success' OR (d.report_group IS NULL AND d.status IN ('thành công', 'đã gửi', 'đã nhận', 'đã xem', 'đã click')))
           ) AS successful,
           count(DISTINCT COALESCE(d.input_data_id, d.id)) FILTER (
             WHERE (d.report_group='failure' OR (d.report_group IS NULL AND d.status IN ('thất bại', 'lỗi', 'không tồn tại')))
           ) AS failed
    FROM public.auto_campaign_details d
    WHERE d.campaign_id = c.id AND d.is_delete = false
  ) result
  WHERE c.organization_id = ANY(p_organization_ids) AND c.id = ANY(p_campaign_ids) AND c.is_delete = false;
$function$

