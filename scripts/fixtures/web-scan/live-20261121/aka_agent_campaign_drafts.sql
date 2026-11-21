CREATE OR REPLACE FUNCTION public.aka_agent_campaign_drafts(p_staff_id bigint, p_organization_id bigint, p_auth_username text, p_auth_password text, p_operation text, p_draft_id uuid, p_data jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET statement_timeout TO '60s'
AS $function$
DECLARE
  d public.auto_campaign_drafts%ROWTYPE;
  v_form jsonb;
  v_item jsonb;
  v_count integer;
  v_page integer;
  v_items jsonb;
  v_campaign_ids bigint[];
BEGIN
  PERFORM public.auto_assert_automation_identity(p_staff_id, p_organization_id, p_auth_username, p_auth_password);
  IF NOT EXISTS (SELECT 1 FROM public.org_staff WHERE id = p_staff_id AND organization_id = p_organization_id AND is_active = true) THEN
    RAISE EXCEPTION 'Không có quyền truy cập bản nháp.';
  END IF;

  IF p_operation = 'list' THEN
    v_page := greatest(1, least(coalesce((p_data->>'page')::integer, 1), 100000));
    SELECT count(*) INTO v_count FROM public.auto_campaign_drafts
      WHERE staff_id = p_staff_id AND organization_id = p_organization_id AND NOT is_delete;
    SELECT coalesce(jsonb_agg(x.item ORDER BY x.updated_at DESC, x.id), '[]'::jsonb) INTO v_items FROM (
      SELECT id, updated_at, jsonb_build_object(
        'id', id, 'name', payload #>> '{values,formData,name}',
        'actionId', payload #>> '{values,formData,actionId}',
        'accountIds', payload #> '{values,formData,accountIds}',
        'schedule', payload #>> '{values,formData,schedule}',
        'updatedAt', updated_at, 'revision', revision
      ) AS item FROM public.auto_campaign_drafts
      WHERE staff_id = p_staff_id AND organization_id = p_organization_id AND NOT is_delete
      ORDER BY updated_at DESC, id LIMIT 50 OFFSET (v_page - 1) * 50
    ) x;
    RETURN jsonb_build_object('items', v_items, 'total', v_count);
  END IF;
  IF p_draft_id IS NULL THEN RAISE EXCEPTION 'Bản nháp không hợp lệ.'; END IF;

  -- Serializes retries (including a save whose response was lost).
  PERFORM pg_advisory_xact_lock(hashtextextended('campaign-draft:' || p_draft_id::text, 0));
  SELECT * INTO d FROM public.auto_campaign_drafts WHERE id = p_draft_id FOR UPDATE;
  IF FOUND AND (d.staff_id <> p_staff_id OR d.organization_id <> p_organization_id) THEN
    RAISE EXCEPTION 'Không tìm thấy bản nháp.';
  END IF;

  IF p_operation = 'save' THEN
    IF d.is_delete THEN RAISE EXCEPTION 'Bản nháp đã được xoá hoặc chuyển thành chiến dịch.'; END IF;
    IF p_data #>> '{payload,version}' IS DISTINCT FROM '1' THEN RAISE EXCEPTION 'Phiên bản bản nháp chưa được hỗ trợ.'; END IF;
    v_form := p_data #> '{payload,values,formData}';
    IF jsonb_typeof(v_form) IS DISTINCT FROM 'object'
      OR nullif(btrim(v_form->>'name'), '') IS NULL
      OR nullif(btrim(v_form->>'actionId'), '') IS NULL
      OR jsonb_typeof(v_form->'accountIds') IS DISTINCT FROM 'array'
      OR jsonb_array_length(v_form->'accountIds') = 0
      OR nullif(v_form->>'schedule', '') IS NULL THEN
      RAISE EXCEPTION 'Vui lòng nhập Tên, Hành động, Tài khoản và lịch gửi hợp lệ.';
    END IF;
    PERFORM (v_form->>'schedule')::timestamptz;
    IF NOT EXISTS (SELECT 1 FROM public.auto_campaign_actions WHERE id = v_form->>'actionId' AND is_active = true AND NOT coalesce(is_delete, false)) THEN
      RAISE EXCEPTION 'Hành động không còn khả dụng.';
    END IF;
    FOR v_item IN SELECT value FROM jsonb_array_elements(v_form->'accountIds') LOOP
      IF NOT EXISTS (SELECT 1 FROM public.auto_accounts a JOIN public.auto_campaign_actions act ON act.id = v_form->>'actionId'
        WHERE a.id = (v_item #>> '{}')::bigint AND a.staff_id = p_staff_id AND a.organization_id = p_organization_id
          AND NOT coalesce(a.is_delete, false) AND a.flatform_type = act.flatform_type) THEN
        RAISE EXCEPTION 'Tài khoản không thuộc người dùng hoặc không phù hợp với hành động.';
      END IF;
    END LOOP;
    IF d.id IS NULL THEN
      IF coalesce((p_data->>'revision')::integer, 0) <> 0 THEN RAISE EXCEPTION 'Không tìm thấy bản nháp.'; END IF;
      INSERT INTO public.auto_campaign_drafts(id, staff_id, organization_id, payload)
      VALUES (p_draft_id, p_staff_id, p_organization_id, p_data->'payload') RETURNING * INTO d;
    ELSIF d.payload IS DISTINCT FROM p_data->'payload' THEN
      IF d.revision IS DISTINCT FROM (p_data->>'revision')::integer THEN
        RAISE EXCEPTION 'Bản nháp đã thay đổi ở nơi khác. Vui lòng mở lại trước khi lưu.';
      END IF;
      UPDATE public.auto_campaign_drafts SET payload = p_data->'payload', revision = revision + 1, updated_at = now()
        WHERE id = d.id RETURNING * INTO d;
    END IF;
  ELSIF d.id IS NULL THEN
    RAISE EXCEPTION 'Không tìm thấy bản nháp.';
  ELSIF p_operation = 'get' THEN
    NULL;
  ELSIF p_operation = 'delete' THEN
    IF d.deletion_reason = 'converted' THEN RAISE EXCEPTION 'Bản nháp đã chuyển thành chiến dịch.'; END IF;
    UPDATE public.auto_campaign_drafts SET is_delete = true, deleted_at = coalesce(deleted_at, now()),
      deletion_reason = 'user_deleted', updated_at = now() WHERE id = d.id RETURNING * INTO d;
  ELSIF p_operation = 'complete' THEN
    -- Campaign creation has already succeeded through the normal campaign APIs.
    -- This operation only records the result and soft-deletes the form snapshot.
    IF jsonb_typeof(p_data->'campaignIds') IS DISTINCT FROM 'array'
      OR jsonb_array_length(p_data->'campaignIds') = 0 THEN
      RAISE EXCEPTION 'Danh sách chiến dịch đã tạo không hợp lệ.';
    END IF;
    SELECT array_agg(DISTINCT value::bigint ORDER BY value::bigint) INTO v_campaign_ids
      FROM jsonb_array_elements_text(p_data->'campaignIds');
    IF EXISTS (SELECT 1 FROM unnest(v_campaign_ids) AS ids(id)
      LEFT JOIN public.auto_campaigns c ON c.id = ids.id
      WHERE c.id IS NULL OR c.staff_id <> p_staff_id OR c.organization_id <> p_organization_id) THEN
      RAISE EXCEPTION 'Chiến dịch không thuộc người dùng.';
    END IF;
    IF d.deletion_reason = 'converted' AND d.campaign_ids = v_campaign_ids THEN
      NULL;
    ELSE
      IF d.is_delete THEN RAISE EXCEPTION 'Bản nháp đã được xoá hoặc chuyển thành chiến dịch.'; END IF;
      IF d.revision IS DISTINCT FROM (p_data->>'revision')::integer THEN
        RAISE EXCEPTION 'Bản nháp đã thay đổi ở nơi khác. Bản nháp được giữ lại.';
      END IF;
      UPDATE public.auto_campaign_drafts SET is_delete = true, deleted_at = now(),
        deletion_reason = 'converted', campaign_ids = v_campaign_ids, updated_at = now()
        WHERE id = d.id RETURNING * INTO d;
    END IF;
  ELSE
    RAISE EXCEPTION 'Thao tác bản nháp không hợp lệ.';
  END IF;
  RETURN jsonb_build_object('id', d.id, 'payload', d.payload, 'revision', d.revision, 'updatedAt', d.updated_at,
    'name', d.payload #>> '{values,formData,name}', 'actionId', d.payload #>> '{values,formData,actionId}',
    'accountIds', d.payload #> '{values,formData,accountIds}', 'schedule', d.payload #>> '{values,formData,schedule}',
    'isDelete', d.is_delete,
    'deletionReason', d.deletion_reason, 'campaignIds', to_jsonb(d.campaign_ids));
END;
$function$
