
    WITH page_ids AS MATERIALIZED (
      SELECT d.id, d.created_at
      FROM public.auto_campaign_details AS d
      WHERE d.campaign_id = 7370 AND d.is_delete = false AND (d.status = 'thành công' OR EXISTS (SELECT 1 FROM public.auto_status filter_status WHERE filter_status.id IN (d.status_id,d.sub_status_id) AND (filter_status.status_value='thành công' OR lower(filter_status.name)=lower('thành công'))))
      ORDER BY d.created_at DESC, d.id DESC
      LIMIT 100 OFFSET 0
    )
    SELECT jsonb_build_object(
      'items', COALESCE((
        SELECT jsonb_agg(((to_jsonb(detail) || jsonb_build_object(
          'status_presentation', CASE WHEN main_status.id IS NULL THEN NULL ELSE jsonb_build_object('code',main_status.code,'name',main_status.name,'color',main_status.color,'statusValue',main_status.status_value) END,
          'sub_status_presentation', CASE WHEN sub_status.id IS NULL THEN NULL ELSE jsonb_build_object('code',sub_status.code,'name',sub_status.name,'color',sub_status.color,'statusValue',sub_status.status_value) END)) || jsonb_build_object('zalo_engagement', to_jsonb(engagement), 'zalo_engagement_applicable',
          engagement.campaign_detail_id IS NOT NULL OR (account.flatform_type='zalo' AND NOT COALESCE(account.is_zalo_show_web,false)
            AND detail.status='thành công' AND detail.action_code IN ('zalo_message_friend','zalo_message_stranger','zalo_add_friend')
            AND detail.data->'partialSend' IS NULL))) ORDER BY page.created_at DESC, page.id DESC)
        FROM page_ids AS page
        JOIN public.auto_campaign_details AS detail ON detail.id = page.id
        LEFT JOIN public.auto_status main_status ON main_status.id=detail.status_id
        LEFT JOIN public.auto_status sub_status ON sub_status.id=detail.sub_status_id
        LEFT JOIN public.auto_campaign_detail_zalo_engagement engagement ON engagement.campaign_detail_id=page.id
        LEFT JOIN public.auto_accounts account ON account.id=detail.account_id
      ), '[]'::jsonb),
      'total', (SELECT count(*) FROM public.auto_campaign_details AS d WHERE d.campaign_id = 7370 AND d.is_delete = false AND (d.status = 'thành công' OR EXISTS (SELECT 1 FROM public.auto_status filter_status WHERE filter_status.id IN (d.status_id,d.sub_status_id) AND (filter_status.status_value='thành công' OR lower(filter_status.name)=lower('thành công')))))
    )
  ;
