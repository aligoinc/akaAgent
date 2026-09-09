-- Campaign drafts are private form snapshots, not scheduler campaigns.
-- Live audit: docs/CAMPAIGN_DRAFTS.md. No existing function is replaced.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';
DO $preflight$
BEGIN
  IF to_regclass('public.auto_campaign_drafts') IS NOT NULL
    OR to_regclass('public.auto_campaign_draft_outputs') IS NOT NULL
    OR to_regprocedure('public.aka_agent_campaign_drafts(bigint,bigint,text,text,text,uuid,jsonb)') IS NOT NULL
    OR to_regprocedure('public.aka_agent_guard_unpublished_draft_campaign()') IS NOT NULL THEN
    RAISE EXCEPTION 'campaign_draft_preflight: objects already exist; audit before reapply';
  END IF;
  IF md5(pg_get_functiondef(to_regprocedure('public.auto_assert_automation_identity(bigint,bigint,text,text)')))
       IS DISTINCT FROM '5a9a503db72b965eb644739f5f60905d' THEN
    RAISE EXCEPTION 'campaign_draft_preflight: authentication helper changed';
  END IF;
  IF to_regclass('public.uq_auto_campaigns_control_idempotency') IS NULL THEN
    RAISE EXCEPTION 'campaign_draft_preflight: campaign idempotency index missing';
  END IF;
END;
$preflight$;

CREATE TABLE public.auto_campaign_drafts (
  id uuid PRIMARY KEY,
  staff_id bigint NOT NULL REFERENCES public.org_staff(id),
  organization_id bigint NOT NULL REFERENCES public.org_organization(id),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  revision integer NOT NULL DEFAULT 1,
  is_delete boolean NOT NULL DEFAULT false,
  deleted_at timestamptz,
  deletion_reason text CHECK (deletion_reason IN ('user_deleted', 'converted')),
  conversion_plan jsonb,
  conversion_token uuid,
  lease_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auto_campaign_drafts_active_owner ON public.auto_campaign_drafts
  (staff_id, organization_id, updated_at DESC, id) WHERE is_delete = false;
CREATE TABLE public.auto_campaign_draft_outputs (
  draft_id uuid NOT NULL REFERENCES public.auto_campaign_drafts(id),
  item_key text NOT NULL,
  campaign_id bigint REFERENCES public.auto_campaigns(id),
  prepared boolean NOT NULL DEFAULT false,
  final_status text NOT NULL DEFAULT 'chờ xử lý' CHECK (final_status IN ('chờ xử lý', 'tạm dừng')),
  input_batches jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (draft_id, item_key)
);
ALTER TABLE public.auto_campaign_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auto_campaign_draft_outputs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.auto_campaign_drafts, public.auto_campaign_draft_outputs FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.auto_campaign_drafts, public.auto_campaign_draft_outputs TO service_role;

CREATE FUNCTION public.aka_agent_campaign_drafts(
  p_staff_id bigint, p_organization_id bigint, p_auth_username text, p_auth_password text,
  p_operation text, p_draft_id uuid, p_data jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
SET statement_timeout = '60s'
AS $function$
DECLARE
  d public.auto_campaign_drafts%ROWTYPE;
  o public.auto_campaign_draft_outputs%ROWTYPE;
  c public.auto_campaigns%ROWTYPE;
  v_form jsonb;
  v_item jsonb;
  v_key text;
  v_batch text;
  v_hash text;
  v_count integer;
  v_page integer;
  v_items jsonb;
  v_ids jsonb;
  v_paused jsonb;
  v_token uuid;
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
        'updatedAt', updated_at, 'revision', revision, 'conversionStarted', conversion_plan IS NOT NULL
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
    IF d.conversion_plan IS NOT NULL THEN RAISE EXCEPTION 'Bản nháp đang tạo chiến dịch. Vui lòng tiếp tục lần tạo trước.'; END IF;
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
    IF d.lease_until > now() THEN RAISE EXCEPTION 'Bản nháp đang được tạo thành chiến dịch. Vui lòng chờ hoàn tất.'; END IF;
    UPDATE public.auto_campaign_drafts SET is_delete = true, deleted_at = coalesce(deleted_at, now()),
      deletion_reason = 'user_deleted', updated_at = now() WHERE id = d.id RETURNING * INTO d;
  ELSIF p_operation = 'begin' THEN
    IF d.deletion_reason = 'converted' THEN
      SELECT coalesce(jsonb_agg(campaign_id ORDER BY item_key), '[]'::jsonb),
        coalesce(jsonb_agg(campaign_id ORDER BY item_key) FILTER (WHERE final_status = 'tạm dừng'), '[]'::jsonb) INTO v_ids, v_paused
        FROM public.auto_campaign_draft_outputs WHERE draft_id = d.id;
      RETURN jsonb_build_object('completed', true, 'campaignIds', v_ids, 'pausedCampaignIds', v_paused);
    END IF;
    IF d.is_delete THEN RAISE EXCEPTION 'Bản nháp đã được xoá.'; END IF;
    v_token := (p_data->>'token')::uuid;
    IF v_token IS NULL THEN RAISE EXCEPTION 'Thiếu định danh lần tạo chiến dịch.'; END IF;
    IF d.lease_until > now() AND d.conversion_token IS DISTINCT FROM v_token THEN
      RAISE EXCEPTION 'Bản nháp đang được tạo ở phiên khác. Vui lòng thử lại sau ít phút.';
    END IF;
    IF d.conversion_plan IS NULL THEN
      IF d.revision IS DISTINCT FROM (p_data->>'revision')::integer THEN RAISE EXCEPTION 'Bản nháp đã thay đổi. Vui lòng mở lại.'; END IF;
      IF jsonb_typeof(p_data #> '{plan,items}') IS DISTINCT FROM 'array'
        OR jsonb_array_length(p_data #> '{plan,items}') NOT BETWEEN 1 AND 100 THEN
        RAISE EXCEPTION 'Danh sách chiến dịch cần tạo không hợp lệ (tối đa 100).';
      END IF;
      FOR v_item IN SELECT value FROM jsonb_array_elements(p_data #> '{plan,items}') LOOP
        v_key := v_item->>'key';
        IF v_key IS NULL OR v_key !~ '^[a-zA-Z0-9:_-]{1,100}$' THEN RAISE EXCEPTION 'Định danh chiến dịch con không hợp lệ.'; END IF;
        INSERT INTO public.auto_campaign_draft_outputs(draft_id, item_key) VALUES(d.id, v_key);
      END LOOP;
      UPDATE public.auto_campaign_drafts SET conversion_plan = p_data->'plan' WHERE id = d.id;
    END IF;
    UPDATE public.auto_campaign_drafts SET conversion_token = v_token, lease_until = now() + interval '3 minutes', updated_at = now()
      WHERE id = d.id RETURNING * INTO d;
    RETURN jsonb_build_object('plan', d.conversion_plan, 'completed', false);
  ELSE
    v_token := (p_data->>'token')::uuid;
    IF d.is_delete OR d.conversion_token IS DISTINCT FROM v_token OR v_token IS NULL OR d.lease_until <= now() THEN
      RAISE EXCEPTION 'Phiên tạo chiến dịch đã kết thúc. Vui lòng mở lại bản nháp.';
    END IF;
    IF p_operation = 'heartbeat' THEN
      UPDATE public.auto_campaign_drafts SET lease_until = now() + interval '3 minutes' WHERE id = d.id;
      RETURN '{}'::jsonb;
    ELSIF p_operation = 'release' THEN
      UPDATE public.auto_campaign_drafts SET conversion_token = NULL, lease_until = NULL WHERE id = d.id;
      RETURN '{}'::jsonb;
    ELSIF p_operation IN ('output', 'input_batch', 'prepared') THEN
      v_key := p_data->>'key';
      SELECT * INTO o FROM public.auto_campaign_draft_outputs WHERE draft_id = d.id AND item_key = v_key FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Chiến dịch không thuộc lần chuyển nháp.'; END IF;
      SELECT * INTO c FROM public.auto_campaigns
        WHERE staff_id = p_staff_id AND organization_id = p_organization_id
          AND control_idempotency_key = 'draft:' || d.id::text || ':' || v_key FOR UPDATE;
      IF NOT FOUND OR coalesce(c.is_delete, false) OR c.status <> 'tạm dừng' OR c.runtime_claim_token IS NOT NULL THEN
        RAISE EXCEPTION 'Chiến dịch đang chuẩn bị đã thay đổi. Không thể tiếp tục tự động.';
      END IF;
      UPDATE public.auto_campaign_draft_outputs SET campaign_id = c.id WHERE draft_id = d.id AND item_key = v_key;
      IF p_operation = 'input_batch' THEN
        IF c.data_target_source_mode <> 'direct' THEN RAISE EXCEPTION 'Nhóm data không nhận input trực tiếp.'; END IF;
        v_batch := p_data->>'batch';
        IF v_batch IS NULL OR length(v_batch) > 100 OR jsonb_typeof(p_data->'rows') IS DISTINCT FROM 'array'
          OR jsonb_array_length(p_data->'rows') > 1000 THEN RAISE EXCEPTION 'Batch data không hợp lệ.'; END IF;
        -- Spintax SMS/voice content may render differently on retry. The first
        -- committed content wins; verify the stable input fields and ordering.
        SELECT md5(coalesce(jsonb_agg(value - 'content' ORDER BY ordinal), '[]'::jsonb)::text)
          INTO v_hash FROM jsonb_array_elements(p_data->'rows') WITH ORDINALITY AS rows(value, ordinal);
        IF o.input_batches ? v_batch THEN
          IF o.input_batches->>v_batch <> v_hash THEN RAISE EXCEPTION 'Nội dung batch đã thay đổi khi thử lại.'; END IF;
        ELSE
          IF o.prepared THEN RAISE EXCEPTION 'Chiến dịch đã chuẩn bị xong data.'; END IF;
          INSERT INTO public.auto_campaign_input_data(campaign_id, input_id, name, phone, phone_carrier, uid, email,
            info1, info2, info3, info4, info5, content, status, note, schedule)
          SELECT c.id, NULL, r.name, r.phone, r.phone_carrier, r.uid, r.email, r.info1, r.info2, r.info3, r.info4, r.info5,
            r.content, 'chờ xử lý', r.note, r.schedule
          FROM jsonb_populate_recordset(NULL::public.auto_campaign_input_data, p_data->'rows') r;
          UPDATE public.auto_campaign_draft_outputs SET input_batches = input_batches || jsonb_build_object(v_batch, v_hash)
            WHERE draft_id = d.id AND item_key = v_key;
        END IF;
      ELSIF p_operation = 'prepared' THEN
        IF c.data_target_source_mode = 'data_group' AND c.provisioning_state <> 'ready' THEN
          RAISE EXCEPTION 'Nhóm data chưa chuẩn bị xong.';
        END IF;
        UPDATE public.auto_campaign_draft_outputs SET prepared = true,
          final_status = coalesce(p_data->>'finalStatus', 'chờ xử lý') WHERE draft_id = d.id AND item_key = v_key;
      END IF;
      RETURN jsonb_build_object('campaignId', c.id, 'prepared', o.prepared);
    ELSIF p_operation = 'finish' THEN
      IF EXISTS (SELECT 1 FROM public.auto_campaign_draft_outputs WHERE draft_id = d.id AND (NOT prepared OR campaign_id IS NULL)) THEN
        RAISE EXCEPTION 'Chưa chuẩn bị xong toàn bộ chiến dịch.';
      END IF;
      PERFORM c1.id FROM public.auto_campaigns c1 JOIN public.auto_campaign_draft_outputs o1 ON o1.campaign_id = c1.id
        WHERE o1.draft_id = d.id ORDER BY c1.id FOR UPDATE OF c1;
      IF EXISTS (SELECT 1 FROM public.auto_campaign_draft_outputs o1 LEFT JOIN public.auto_campaigns c1 ON c1.id = o1.campaign_id
        WHERE o1.draft_id = d.id AND (c1.id IS NULL OR c1.status <> 'tạm dừng' OR coalesce(c1.is_delete, false)
          OR c1.staff_id <> p_staff_id OR c1.organization_id <> p_organization_id OR c1.runtime_claim_token IS NOT NULL)) THEN
        RAISE EXCEPTION 'Một chiến dịch đang chuẩn bị đã thay đổi. Bản nháp được giữ lại.';
      END IF;
      -- Same transaction: no runtime sees an incomplete conversion.
      UPDATE public.auto_campaign_drafts SET is_delete = true, deletion_reason = 'converted', deleted_at = now(),
        updated_at = now(), lease_until = NULL, conversion_token = NULL WHERE id = d.id;
      UPDATE public.auto_campaigns c1 SET status = o1.final_status, provisioning_state = 'ready', updated_at = now()
        FROM public.auto_campaign_draft_outputs o1 WHERE o1.draft_id = d.id AND c1.id = o1.campaign_id;
      SELECT coalesce(jsonb_agg(campaign_id ORDER BY item_key), '[]'::jsonb),
        coalesce(jsonb_agg(campaign_id ORDER BY item_key) FILTER (WHERE final_status = 'tạm dừng'), '[]'::jsonb)
        INTO v_ids, v_paused FROM public.auto_campaign_draft_outputs WHERE draft_id = d.id;
      RETURN jsonb_build_object('campaignIds', v_ids, 'pausedCampaignIds', v_paused);
    ELSE RAISE EXCEPTION 'Thao tác bản nháp không hợp lệ.';
    END IF;
  END IF;
  SELECT coalesce(jsonb_agg(campaign_id ORDER BY item_key) FILTER (WHERE campaign_id IS NOT NULL), '[]'::jsonb)
    INTO v_ids FROM public.auto_campaign_draft_outputs WHERE draft_id = d.id;
  RETURN jsonb_build_object('id', d.id, 'payload', d.payload, 'revision', d.revision, 'updatedAt', d.updated_at,
    'name', d.payload #>> '{values,formData,name}', 'actionId', d.payload #>> '{values,formData,actionId}',
    'accountIds', d.payload #> '{values,formData,accountIds}', 'schedule', d.payload #>> '{values,formData,schedule}',
    'conversionStarted', d.conversion_plan IS NOT NULL, 'isDelete', d.is_delete,
    'deletionReason', d.deletion_reason, 'campaignIds', v_ids);
END;
$function$;
REVOKE ALL ON FUNCTION public.aka_agent_campaign_drafts(bigint,bigint,text,text,text,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aka_agent_campaign_drafts(bigint,bigint,text,text,text,uuid,jsonb) TO anon, authenticated, service_role;

-- Narrow guard for draft-origin outputs only; ordinary campaigns never invoke it.
CREATE FUNCTION public.aka_agent_guard_unpublished_draft_campaign() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF OLD.control_idempotency_key !~ '^draft:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:' THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_campaign_drafts d
    WHERE d.id = substring(OLD.control_idempotency_key FROM 7 FOR 36)::uuid
      AND d.deletion_reason IS DISTINCT FROM 'converted') THEN
    RAISE EXCEPTION 'Chiến dịch đang được chuẩn bị từ bản nháp. Vui lòng hoàn tất trong mục Nháp.';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.aka_agent_guard_unpublished_draft_campaign() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER aka_agent_guard_unpublished_draft_campaign BEFORE UPDATE OF status ON public.auto_campaigns
FOR EACH ROW WHEN (OLD.control_idempotency_key LIKE 'draft:%' AND NEW.status IN ('chờ xử lý', 'đang chạy') AND OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION public.aka_agent_guard_unpublished_draft_campaign();
-- New table/RPC metadata requires a schema reload (existing DDL event trigger handles it).
COMMIT;
