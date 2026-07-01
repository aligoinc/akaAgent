-- Aggregate email campaign link tracking summaries in the database.

BEGIN;

CREATE OR REPLACE FUNCTION public.aka_agent_list_email_campaign_link_tracking_summaries(
  p_campaign_id bigint
)
RETURNS TABLE (
  url text,
  email_count bigint,
  link_count bigint,
  click_count bigint,
  first_clicked_at timestamptz,
  last_clicked_at timestamptz,
  first_tracked_at timestamptz,
  last_tracked_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    link_tracking.original_url AS url,
    COUNT(DISTINCT message_tracking.id) AS email_count,
    COUNT(*) AS link_count,
    COALESCE(SUM(link_tracking.click_count), 0)::bigint AS click_count,
    MIN(link_tracking.first_clicked_at) AS first_clicked_at,
    MAX(link_tracking.last_clicked_at) AS last_clicked_at,
    MIN(link_tracking.created_at) AS first_tracked_at,
    MAX(link_tracking.created_at) AS last_tracked_at
  FROM public.auto_email_link_trackings AS link_tracking
  INNER JOIN public.auto_email_message_trackings AS message_tracking
    ON message_tracking.id = link_tracking.message_tracking_id
  WHERE message_tracking.campaign_id = p_campaign_id
    AND message_tracking.is_delete = false
    AND link_tracking.is_delete = false
  GROUP BY link_tracking.original_url
  ORDER BY
    COALESCE(SUM(link_tracking.click_count), 0) DESC,
    COUNT(*) DESC,
    link_tracking.original_url ASC;
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
