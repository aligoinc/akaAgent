CREATE OR REPLACE FUNCTION public.crm_agent_campaign_results(p_organization_ids bigint[], p_campaign_ids bigint[])
 RETURNS TABLE(campaign_id bigint, successful bigint, failed bigint, pending bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT c.id, result.successful, result.failed, result.managed_pending + queue.pending
  FROM public.auto_campaigns c
  CROSS JOIN LATERAL (
    SELECT count(*) FILTER (WHERE (d.report_group='success' OR (d.report_group IS NULL AND d.status IN ('thành công', 'đã gửi', 'đã nhận', 'đã xem', 'đã click')))) AS successful,
      count(*) FILTER (WHERE (d.report_group='failure' OR (d.report_group IS NULL AND d.status IN ('thất bại', 'lỗi', 'không tồn tại')))) AS failed, count(*) FILTER (WHERE d.report_group='pending') AS managed_pending
    FROM public.auto_campaign_details d
    WHERE d.campaign_id = c.id AND d.is_delete = false
  ) result
  CROSS JOIN LATERAL (
    SELECT count(*) AS pending
    FROM public.auto_campaign_input_data i
    WHERE i.campaign_id = c.id AND i.is_delete = false AND i.status = 'chờ xử lý'
      AND NOT EXISTS (SELECT 1 FROM public.auto_campaign_details existing
        WHERE existing.input_data_id=i.id AND existing.campaign_id=c.id
          AND existing.is_delete=false AND existing.report_group='pending')
  ) queue
  WHERE c.organization_id = ANY(p_organization_ids) AND c.id = ANY(p_campaign_ids) AND c.is_delete = false;
$function$

