-- V492: API nội bộ chèn câu hỏi "Hỏi đáp AI" từ bất kỳ nơi nào (Edge Function ai-chat-agent, đường /ask).
-- Hợp đồng: docs/AI_CHAT_ASK_API.md. Rollback: migrations/rollback_v492_ai_chat_insert.sql.
-- Chỉ THÊM một hàm public.aka_agent_ai_chat_insert(jsonb), EXECUTE chỉ service_role. Không sửa bảng, hàm, quyền
-- hay dữ liệu nào của V488: mọi kiểm tra (nhân viên còn hoạt động, agent đang mở, chiến dịch thuộc đúng nhân viên,
-- hạn mức chờ/ngày, mỗi hội thoại một câu đang xử lý) vẫn do lõi private.aka_agent_ai_chat làm, hàm này chỉ
-- điền các trường nơi gọi không biết (nhân viên/tổ chức từ chiến dịch hoặc hội thoại, requestId, agent theo mã).
-- DDL ⇒ PostgREST nạp lại schema: apply ngoài giờ cao điểm.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $v492_preflight$
DECLARE sig text; r text;
BEGIN
  IF to_regprocedure('public.aka_agent_ai_chat_insert(jsonb)') IS NOT NULL THEN
    RAISE EXCEPTION 'v492: aka_agent_ai_chat_insert already exists';
  END IF;
  FOREACH sig IN ARRAY ARRAY['private.aka_agent_ai_chat(bigint,bigint,text,text,jsonb)',
    'private.aka_agent_ai_chat_snapshot(bigint,bigint,integer)', 'private.aka_agent_ai_chat_uuid(text)',
    'private.aka_agent_ai_chat_id(jsonb)'] LOOP
    IF to_regprocedure(sig) IS NULL THEN RAISE EXCEPTION 'v492: missing dependency % (V488 chưa apply?)', sig; END IF;
  END LOOP;
  -- Hàm mới dựa vào đúng hành vi của lõi V488 (cờ reused, định dạng ảnh chụp): lõi đã đổi thì kiểm thử lại trước.
  IF (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = 'private.aka_agent_ai_chat(bigint,bigint,text,text,jsonb)'::regprocedure)
       <> '9354da9858283e1c98b021e91968b873'
     OR (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = 'private.aka_agent_ai_chat_snapshot(bigint,bigint,integer)'::regprocedure)
       <> 'c5d40b3c3a49f3e830b85bd28924298a' THEN
    RAISE EXCEPTION 'v492: lõi Hỏi đáp AI khác bản V488 đã kiểm thử';
  END IF;
  IF to_regclass('public.ai_project') IS NULL OR to_regclass('public.ai_message_thread') IS NULL OR to_regclass('public.ai_message') IS NULL THEN
    RAISE EXCEPTION 'v492: ai chat tables missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid = 'public.ai_message_thread'::regclass AND c.contype = 'c'
                    AND pg_get_constraintdef(c.oid) LIKE '%source%' AND pg_get_constraintdef(c.oid) LIKE '%''api''%') THEN
    RAISE EXCEPTION 'v492: ai_message_thread.source không nhận giá trị api';
  END IF;
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role', 'aka_agent_desktop', 'aka_agent_chat_api'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN RAISE EXCEPTION 'v492: missing role %', r; END IF;
  END LOOP;
END
$v492_preflight$;

-- Chèn một câu hỏi. Có threadId = hỏi tiếp trong hội thoại đó; không có = mở hội thoại mới cho agent
-- (projectCode hoặc projectId). Nhân viên/tổ chức: lấy từ hội thoại, từ chủ chiến dịch, hoặc từ staffId.
-- Trả {ok:true, inserted, threadId, messageId, ...}; cùng agent + chiến dịch đang có câu chờ thì không chèn
-- và trả {ok:false, code:'ai_chat_message_pending', threadId, messageId} của câu đang chờ.
CREATE FUNCTION public.aka_agent_ai_chat_insert(p_payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_started timestamptz := clock_timestamp();
  v_p jsonb := coalesce(p_payload, '{}'::jsonb);
  v_key text; v_source text; v_client text; v_action text; v_request uuid; v_project_code text;
  v_thread_id bigint; v_project_id bigint; v_campaign_id bigint; v_staff_id bigint; v_org_id bigint;
  v_staff_in bigint; v_org_in bigint; v_campaign_org bigint;
  v_existing boolean; v_call jsonb; v_core jsonb;
  t public.ai_message_thread%ROWTYPE;
  m public.ai_message%ROWTYPE;
  pr public.ai_project%ROWTYPE;
BEGIN
  IF jsonb_typeof(v_p) <> 'object' THEN RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ai_chat_invalid_request'; END IF;
  IF jsonb_typeof(v_p -> 'question') IS DISTINCT FROM 'string' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ai_chat_question_required';
  END IF;
  FOREACH v_key IN ARRAY ARRAY['threadId', 'projectId', 'campaignId', 'staffId', 'organizationId'] LOOP
    IF v_p ? v_key AND jsonb_typeof(v_p -> v_key) <> 'null' AND private.aka_agent_ai_chat_id(v_p -> v_key) IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ai_chat_invalid_request';
    END IF;
  END LOOP;
  FOREACH v_key IN ARRAY ARRAY['source', 'projectCode', 'requestId'] LOOP
    IF v_p ? v_key AND jsonb_typeof(v_p -> v_key) NOT IN ('null', 'string') THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ai_chat_invalid_request';
    END IF;
  END LOOP;

  -- Nơi gửi, ghi vào ai_message_thread.source khi tạo hội thoại mới. Lõi chỉ nhận web/ios/desktop nên 'api'
  -- đi qua lõi bằng 'web' rồi được ghi lại đúng nguồn ngay trong cùng giao dịch (bảng đã cho phép 'api').
  v_source := coalesce(nullif(lower(btrim(v_p ->> 'source')), ''), 'api');
  IF v_source NOT IN ('web', 'ios', 'desktop', 'api') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ai_chat_invalid_source';
  END IF;
  v_client := CASE WHEN v_source = 'api' THEN 'web' ELSE v_source END;

  -- requestId: nơi gọi gửi thì thử lại không tạo câu thứ hai; không gửi thì tự sinh.
  IF nullif(btrim(v_p ->> 'requestId'), '') IS NULL THEN
    v_request := gen_random_uuid();
  ELSE
    v_request := private.aka_agent_ai_chat_uuid(btrim(v_p ->> 'requestId'));
    IF v_request IS NULL THEN RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ai_chat_invalid_request'; END IF;
  END IF;

  v_thread_id := private.aka_agent_ai_chat_id(v_p -> 'threadId');
  v_campaign_id := private.aka_agent_ai_chat_id(v_p -> 'campaignId');
  v_staff_in := private.aka_agent_ai_chat_id(v_p -> 'staffId');
  v_org_in := private.aka_agent_ai_chat_id(v_p -> 'organizationId');

  IF v_thread_id IS NOT NULL THEN
    v_action := 'ask';
    SELECT s.org_staff_id, s.organization_id INTO v_staff_id, v_org_id
      FROM public.ai_message_thread s WHERE s.id = v_thread_id AND NOT s.is_delete;
    IF NOT FOUND OR (v_staff_in IS NOT NULL AND v_staff_in <> v_staff_id) OR (v_org_in IS NOT NULL AND v_org_in <> v_org_id) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'ai_chat_thread_not_found';
    END IF;
  ELSE
    v_action := 'open';
    v_project_id := private.aka_agent_ai_chat_id(v_p -> 'projectId');
    v_project_code := nullif(btrim(v_p ->> 'projectCode'), '');
    IF v_project_id IS NULL AND v_project_code IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ai_chat_project_required';
    END IF;
    SELECT * INTO pr FROM public.ai_project p
     WHERE (v_project_id IS NULL OR p.id = v_project_id) AND (v_project_code IS NULL OR p.code = v_project_code);
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'ai_chat_agent_not_found'; END IF;

    v_staff_id := v_staff_in;
    v_org_id := v_org_in;
    IF v_staff_id IS NULL AND v_campaign_id IS NOT NULL THEN
      -- Câu hỏi về một chiến dịch thuộc về chủ chiến dịch đó: hội thoại hiện trong app của đúng người này.
      SELECT c.staff_id, c.organization_id INTO v_staff_id, v_campaign_org
        FROM public.auto_campaigns c WHERE c.id = v_campaign_id AND c.is_delete IS NOT TRUE;
      IF NOT FOUND OR v_staff_id IS NULL OR v_campaign_org IS NULL OR (v_org_id IS NOT NULL AND v_org_id <> v_campaign_org) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'ai_chat_campaign_not_found';
      END IF;
      v_org_id := v_campaign_org;
    END IF;
    IF v_staff_id IS NULL THEN RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ai_chat_staff_required'; END IF;
    IF v_org_id IS NULL THEN
      SELECT st.organization_id INTO v_org_id FROM public.org_staff st WHERE st.id = v_staff_id;
      IF v_org_id IS NULL THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ai_chat_access_denied'; END IF;
    END IF;
  END IF;

  SELECT * INTO m FROM public.ai_message WHERE request_id = v_request;
  v_existing := FOUND;
  -- requestId của một câu hỏi tiếp không dùng lại được để mở hội thoại mới.
  IF v_existing AND v_action = 'open'
     AND NOT EXISTS (SELECT 1 FROM public.ai_message_thread s WHERE s.id = m.thread_id AND s.request_id = v_request) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ai_chat_invalid_request';
  END IF;

  v_call := jsonb_build_object('requestId', v_request::text, 'question', v_p -> 'question');
  IF v_action = 'open' THEN
    v_call := v_call || jsonb_build_object('projectId', pr.id);
    IF v_campaign_id IS NOT NULL THEN v_call := v_call || jsonb_build_object('campaignId', v_campaign_id); END IF;
    IF v_p ? 'intake' AND jsonb_typeof(v_p -> 'intake') <> 'null' THEN v_call := v_call || jsonb_build_object('intake', v_p -> 'intake'); END IF;
  ELSE
    v_call := v_call || jsonb_build_object('threadId', v_thread_id);
  END IF;
  v_core := private.aka_agent_ai_chat(v_staff_id, v_org_id, v_client, v_action, v_call);

  SELECT * INTO m FROM public.ai_message WHERE request_id = v_request;
  IF NOT FOUND THEN
    -- Lõi không chèn: nhân viên này đang có câu chờ trả lời với cùng agent + chiến dịch, lõi trả hội thoại đó.
    RETURN jsonb_build_object('ok', false, 'inserted', false, 'code', 'ai_chat_message_pending',
      'threadId', v_core #> '{thread,id}', 'messageId', v_core -> 'messages' -> -1 -> 'id',
      'status', v_core #> '{thread,lastMessageStatus}', 'serverTime', clock_timestamp());
  END IF;

  SELECT * INTO t FROM public.ai_message_thread WHERE id = m.thread_id;
  IF v_source = 'api' AND v_action = 'open' AND NOT v_existing AND t.request_id = v_request AND t.source <> 'api' THEN
    UPDATE public.ai_message_thread SET source = 'api' WHERE id = t.id RETURNING * INTO t;
  END IF;
  SELECT * INTO pr FROM public.ai_project WHERE id = t.project_id;
  RETURN jsonb_build_object('ok', true, 'inserted', NOT v_existing AND m.created_at >= v_started,
    'threadId', t.id, 'messageId', m.id, 'seq', m.seq, 'status', m.status, 'requestId', m.request_id, 'source', t.source,
    'project', jsonb_build_object('id', pr.id, 'code', pr.code, 'name', pr.name),
    'staffId', t.org_staff_id, 'organizationId', t.organization_id,
    'campaignId', t.campaign_id, 'campaignName', t.campaign_name, 'accountId', t.auto_account_id, 'accountName', t.account_name,
    'question', m.question, 'askedAt', m.asked_at, 'deadlineAt', m.deadline_at, 'serverTime', clock_timestamp());
END
$$;

REVOKE ALL ON FUNCTION public.aka_agent_ai_chat_insert(jsonb) FROM PUBLIC, anon, authenticated, service_role, aka_agent_desktop, aka_agent_chat_api;
GRANT EXECUTE ON FUNCTION public.aka_agent_ai_chat_insert(jsonb) TO service_role;

DO $v492_postcheck$
DECLARE r text; f regprocedure := 'public.aka_agent_ai_chat_insert(jsonb)'::regprocedure;
BEGIN
  IF NOT (SELECT p.prosecdef AND p.provolatile = 'v' AND p.proconfig = ARRAY['search_path=pg_catalog, public']
            FROM pg_proc p WHERE p.oid = f) THEN
    RAISE EXCEPTION 'v492: function attributes mismatch';
  END IF;
  IF NOT has_function_privilege('service_role', f, 'EXECUTE') THEN RAISE EXCEPTION 'v492: service_role cannot execute'; END IF;
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'aka_agent_desktop', 'aka_agent_chat_api'] LOOP
    IF has_function_privilege(r, f, 'EXECUTE') THEN RAISE EXCEPTION 'v492: % can execute', r; END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a WHERE p.oid = f AND a.grantee = 0) THEN
    RAISE EXCEPTION 'v492: PUBLIC can execute';
  END IF;
  -- V488 giữ nguyên: lõi vẫn không gọi trực tiếp được, bảng vẫn khóa với service_role.
  IF has_function_privilege('service_role', 'private.aka_agent_ai_chat(bigint,bigint,text,text,jsonb)', 'EXECUTE')
     OR has_table_privilege('service_role', 'public.ai_message', 'INSERT')
     OR has_table_privilege('service_role', 'public.ai_message_thread', 'INSERT') THEN
    RAISE EXCEPTION 'v492: V488 privileges changed';
  END IF;
END
$v492_postcheck$;
COMMIT;
