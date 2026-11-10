-- Kiểm thử V492 (public.aka_agent_ai_chat_insert) trên fixture cục bộ, dữ liệu agent như production (hai agent, audience all).
-- Mỗi dòng "ok - ..." là một khẳng định; có "not ok" thì smoke thất bại.
\set ON_ERROR_STOP 1
\pset format unaligned
\pset tuples_only on

CREATE FUNCTION pg_temp.ok(c boolean, label text) RETURNS text LANGUAGE sql AS
$$ SELECT CASE WHEN c IS TRUE THEN 'ok - ' ELSE 'not ok - ' END || label $$;
CREATE FUNCTION pg_temp.err(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN 'no error';
EXCEPTION WHEN others THEN
  RETURN SQLERRM;
END $$;
CREATE FUNCTION pg_temp.ins(p jsonb) RETURNS jsonb LANGUAGE sql AS $$ SELECT public.aka_agent_ai_chat_insert(p) $$;
CREATE FUNCTION pg_temp.ins(p text) RETURNS jsonb LANGUAGE sql AS $$ SELECT public.aka_agent_ai_chat_insert(p::jsonb) $$;
CREATE FUNCTION pg_temp.ins_err(p text) RETURNS text LANGUAGE sql AS
$$ SELECT pg_temp.err(format('SELECT public.aka_agent_ai_chat_insert(%L::jsonb)', p)) $$;
-- Bộ trả lời nhận và trả lời xong một câu (để hội thoại hết trạng thái chờ).
CREATE FUNCTION pg_temp.answer(p_message bigint) RETURNS text LANGUAGE sql AS $$
  WITH c AS (SELECT public.aka_agent_ai_chat_worker('claim', jsonb_build_object('workerId', 't', 'messageId', p_message, 'stage', 'working')) AS r)
  SELECT public.aka_agent_ai_chat_worker('answer', jsonb_build_object('messageId', p_message, 'answer', 'Đã trả lời.',
           'answerJson', '{"tom_tat":"Đã trả lời."}'::jsonb, 'complete', true)) ->> 'status' FROM c
$$;
CREATE FUNCTION pg_temp.counts() RETURNS text LANGUAGE sql AS
$$ SELECT (SELECT count(*) FROM public.ai_message_thread) || '/' || (SELECT count(*) FROM public.ai_message) $$;

SELECT id AS pid FROM public.ai_project WHERE code = 'hoi-dap-chien-dich' \gset
SELECT id AS pid_desktop FROM public.ai_project WHERE code = 'hoi-dap-chien-dich-desktop' \gset

-- 1. Kiểm tra đầu vào (chưa ghi gì).
SELECT pg_temp.ok(pg_temp.ins_err('{"projectCode":"hoi-dap-chien-dich","campaignId":10}') = 'ai_chat_question_required', 'thiếu question');
SELECT pg_temp.ok(pg_temp.ins_err('{"projectCode":"hoi-dap-chien-dich","campaignId":10,"question":123}') = 'ai_chat_question_required', 'question không phải chuỗi');
SELECT pg_temp.ok(pg_temp.ins_err('{"projectCode":"hoi-dap-chien-dich","campaignId":10,"question":"   "}') = 'ai_chat_question_required', 'question chỉ có khoảng trắng');
SELECT pg_temp.ok(pg_temp.err($$SELECT public.aka_agent_ai_chat_insert(jsonb_build_object('projectCode','hoi-dap-chien-dich','campaignId',10,'question',repeat('a',4001)))$$)
  = 'ai_chat_question_too_long', 'question dài quá 4.000 ký tự');
SELECT pg_temp.ok(pg_temp.ins_err('[1]') = 'ai_chat_invalid_request', 'payload không phải object');
SELECT pg_temp.ok(pg_temp.ins_err('{"campaignId":10,"question":"Hỏi"}') = 'ai_chat_project_required', 'thiếu projectCode/projectId');
SELECT pg_temp.ok(pg_temp.ins_err('{"projectCode":"khong-co","campaignId":10,"question":"Hỏi"}') = 'ai_chat_agent_not_found', 'projectCode không tồn tại');
SELECT pg_temp.ok(pg_temp.ins_err(format('{"projectId":%s,"projectCode":"hoi-dap-chien-dich-desktop","campaignId":10,"question":"Hỏi"}', :pid)) = 'ai_chat_agent_not_found',
  'projectId và projectCode không cùng một agent');
SELECT pg_temp.ok(pg_temp.ins_err('{"projectCode":"hoi-dap-chien-dich","question":"Hỏi"}') = 'ai_chat_staff_required', 'không có campaignId lẫn staffId');
SELECT pg_temp.ok(pg_temp.ins_err('{"projectCode":"hoi-dap-chien-dich","staffId":1,"question":"Hỏi"}') = 'ai_chat_campaign_required', 'agent cần chiến dịch mà không gửi campaignId');
SELECT pg_temp.ok(pg_temp.ins_err('{"projectCode":"hoi-dap-chien-dich","campaignId":10,"question":"Hỏi","source":"zalo"}') = 'ai_chat_invalid_source', 'source ngoài web/ios/desktop/api');
SELECT pg_temp.ok(pg_temp.ins_err('{"projectCode":"hoi-dap-chien-dich","campaignId":10,"question":"Hỏi","requestId":"abc"}') = 'ai_chat_invalid_request', 'requestId không phải UUID');
SELECT pg_temp.ok(pg_temp.ins_err('{"projectCode":"hoi-dap-chien-dich","campaignId":"abc","question":"Hỏi"}') = 'ai_chat_invalid_request', 'campaignId không phải số');
SELECT pg_temp.ok(pg_temp.ins_err('{"projectCode":"hoi-dap-chien-dich","campaignId":10,"staffId":0,"question":"Hỏi"}') = 'ai_chat_invalid_request', 'staffId = 0');
SELECT pg_temp.ok(pg_temp.ins_err('{"projectCode":"hoi-dap-chien-dich","campaignId":10,"question":"Hỏi","intake":[1]}') = 'ai_chat_invalid_request', 'intake không phải object');
SELECT pg_temp.ok(pg_temp.ins_err('{"projectCode":"hoi-dap-chien-dich","campaignId":999,"question":"Hỏi"}') = 'ai_chat_campaign_not_found', 'chiến dịch không tồn tại');
SELECT pg_temp.ok(pg_temp.ins_err('{"projectCode":"hoi-dap-chien-dich","campaignId":20,"staffId":1,"question":"Hỏi"}') = 'ai_chat_campaign_not_found', 'chiến dịch không thuộc staffId đã gửi');
SELECT pg_temp.ok(pg_temp.ins_err('{"projectCode":"hoi-dap-chien-dich","campaignId":10,"organizationId":2,"question":"Hỏi"}') = 'ai_chat_campaign_not_found', 'chiến dịch không thuộc organizationId đã gửi');
SELECT pg_temp.ok(pg_temp.ins_err('{"projectCode":"hoi-dap-chien-dich","campaignId":10,"staffId":999,"question":"Hỏi"}') = 'ai_chat_access_denied', 'staffId không tồn tại');
SELECT pg_temp.ok(pg_temp.ins_err('{"projectCode":"hoi-dap-chien-dich","campaignId":10,"staffId":3,"question":"Hỏi"}') = 'ai_chat_access_denied', 'nhân viên đã nghỉ');
SELECT pg_temp.ok(pg_temp.ins_err('{"threadId":999,"question":"Hỏi"}') = 'ai_chat_thread_not_found', 'threadId không tồn tại');
SELECT pg_temp.ok(pg_temp.counts() = '0/0', 'các lỗi đầu vào không ghi dòng nào');

-- 2. Chèn câu hỏi mới: chỉ cần mã agent + chiến dịch + câu hỏi.
SELECT pg_temp.ins('{"projectCode":"hoi-dap-chien-dich","campaignId":10,"question":"  Tại sao chiến dịch không chạy?  "}') AS a \gset
SELECT pg_temp.ok((:'a'::jsonb ->> 'ok')::boolean AND (:'a'::jsonb ->> 'inserted')::boolean AND :'a'::jsonb ->> 'source' = 'api'
  AND :'a'::jsonb ->> 'status' = 'chờ câu trả lời' AND :'a'::jsonb ->> 'seq' = '1' AND :'a'::jsonb ->> 'staffId' = '1' AND :'a'::jsonb ->> 'organizationId' = '1'
  AND :'a'::jsonb ->> 'campaignId' = '10' AND :'a'::jsonb ->> 'campaignName' = 'Chăm sóc khách tháng 11' AND :'a'::jsonb ->> 'accountName' = 'Zalo Shop Hà'
  AND :'a'::jsonb #>> '{project,code}' = 'hoi-dap-chien-dich' AND :'a'::jsonb ->> 'question' = 'Tại sao chiến dịch không chạy?'
  AND (:'a'::jsonb ->> 'requestId') ~ '^[0-9a-f-]{36}$'
  AND (:'a'::jsonb ->> 'deadlineAt')::timestamptz = (:'a'::jsonb ->> 'askedAt')::timestamptz + interval '1200 seconds',
  'chèn mới: nhân viên/tổ chức lấy từ chủ chiến dịch, source api, tự sinh requestId, hạn trả lời theo agent');
SELECT (:'a'::jsonb ->> 'threadId')::bigint AS t1, (:'a'::jsonb ->> 'messageId')::bigint AS m1 \gset
SELECT pg_temp.ok(t.source = 'api' AND t.org_staff_id = 1 AND t.organization_id = 1 AND t.campaign_id = 10 AND t.project_id = :pid AND t.customer_id = 9001
  AND t.revision = 1 AND t.message_count = 1 AND t.last_message_status = 'chờ câu trả lời' AND t.request_id = m.request_id
  AND m.question = 'Tại sao chiến dịch không chạy?' AND m.status = 'chờ câu trả lời' AND m.seq = 1 AND m.thread_rev = 1,
  'chèn mới: database có đúng một hội thoại + một câu hỏi')
  FROM public.ai_message_thread t JOIN public.ai_message m ON m.thread_id = t.id WHERE t.id = :t1 AND m.id = :m1;
SELECT pg_temp.ok(r #>> '{items,0,messageId}' = :'m1' AND r #>> '{items,0,question}' = 'Tại sao chiến dịch không chạy?'
  AND r #>> '{items,0,project,code}' = 'hoi-dap-chien-dich', 'bộ trả lời thấy câu vừa chèn qua list')
  FROM public.aka_agent_ai_chat_worker('list', '{}') r;
SELECT pg_temp.ok(r #>> '{items,0,id}' = :'t1' AND r #>> '{items,0,source}' = 'api' AND (r #>> '{items,0,pending}')::boolean,
  'app của nhân viên thấy hội thoại vừa chèn (đang chờ)') FROM public.aka_agent_control_ai_chat(1, 1, 'web', 'sync_pending', '{}') r;

-- 3. Cùng agent + chiến dịch đang có câu chờ: không chèn câu thứ hai.
SELECT pg_temp.ins('{"projectCode":"hoi-dap-chien-dich","campaignId":10,"question":"Câu thứ hai"}') AS b \gset
SELECT pg_temp.ok(NOT (:'b'::jsonb ->> 'ok')::boolean AND NOT (:'b'::jsonb ->> 'inserted')::boolean AND :'b'::jsonb ->> 'code' = 'ai_chat_message_pending'
  AND :'b'::jsonb ->> 'threadId' = :'t1' AND :'b'::jsonb ->> 'messageId' = :'m1' AND :'b'::jsonb ->> 'status' = 'chờ câu trả lời' AND pg_temp.counts() = '1/1',
  'đang có câu chờ: trả ok=false kèm hội thoại + câu đang chờ, không ghi gì');
SELECT pg_temp.ok(pg_temp.ins_err(format('{"threadId":%s,"question":"Hỏi tiếp"}', :t1)) = 'ai_chat_message_pending' AND pg_temp.counts() = '1/1',
  'hỏi tiếp khi câu trước chưa xong bị từ chối');

-- 4. Gửi lại cùng requestId không tạo thêm.
SELECT pg_temp.ins('{"projectId":' || :pid || ',"campaignId":11,"staffId":1,"organizationId":1,"question":"Hôm nay gửi được bao nhiêu?","requestId":"00000000-0000-4000-8000-000000000a01","source":"web","intake":{"ghi_chu":"thử"}}') AS c \gset
SELECT pg_temp.ins('{"projectId":' || :pid || ',"campaignId":11,"staffId":1,"organizationId":1,"question":"Hôm nay gửi được bao nhiêu?","requestId":"00000000-0000-4000-8000-000000000A01","source":"web"}') AS c2 \gset
SELECT (:'c'::jsonb ->> 'threadId')::bigint AS t2, (:'c'::jsonb ->> 'messageId')::bigint AS m2 \gset
SELECT pg_temp.ok((:'c'::jsonb ->> 'inserted')::boolean AND :'c'::jsonb ->> 'source' = 'web' AND :'c'::jsonb ->> 'requestId' = '00000000-0000-4000-8000-000000000a01'
  AND (:'c2'::jsonb ->> 'ok')::boolean AND NOT (:'c2'::jsonb ->> 'inserted')::boolean AND :'c2'::jsonb ->> 'messageId' = :'m2' AND :'c2'::jsonb ->> 'threadId' = :'t2'
  AND pg_temp.counts() = '2/2' AND (SELECT intake_data ->> 'ghi_chu' = 'thử' AND source = 'web' FROM public.ai_message_thread WHERE id = :t2),
  'requestId: lần đầu chèn (source web, lưu intake), gửi lại trả đúng câu cũ với inserted=false');

-- 5. Hỏi tiếp trong hội thoại sau khi câu trước có trả lời.
SELECT pg_temp.ok(pg_temp.answer(:m1) = 'hoàn thành', 'bộ trả lời trả lời xong câu đầu');
SELECT pg_temp.ins(format('{"threadId":%s,"question":"Vậy khi nào chạy tiếp?","requestId":"00000000-0000-4000-8000-000000000a02"}', :t1)) AS d \gset
SELECT pg_temp.ok((:'d'::jsonb ->> 'inserted')::boolean AND :'d'::jsonb ->> 'threadId' = :'t1' AND :'d'::jsonb ->> 'seq' = '2' AND :'d'::jsonb ->> 'source' = 'api'
  AND :'d'::jsonb ->> 'staffId' = '1' AND :'d'::jsonb ->> 'campaignId' = '10' AND :'d'::jsonb ->> 'status' = 'chờ câu trả lời'
  AND (SELECT revision = 4 AND message_count = 2 AND last_message_seq = 2 AND last_message_status = 'chờ câu trả lời' FROM public.ai_message_thread WHERE id = :t1),
  'hỏi tiếp: chỉ cần threadId + question, nhân viên lấy từ hội thoại');
SELECT pg_temp.ok(NOT (r ->> 'inserted')::boolean AND r ->> 'messageId' = :'d'::jsonb ->> 'messageId' AND pg_temp.counts() = '2/3', 'hỏi tiếp: gửi lại cùng requestId không tạo thêm')
  FROM pg_temp.ins(format('{"threadId":%s,"question":"Vậy khi nào chạy tiếp?","requestId":"00000000-0000-4000-8000-000000000a02"}', :t1)) r;
SELECT pg_temp.ok(pg_temp.ins_err(format('{"threadId":%s,"staffId":2,"question":"Hỏi"}', :t1)) = 'ai_chat_thread_not_found', 'hỏi tiếp: staffId không khớp chủ hội thoại');
SELECT pg_temp.ok(pg_temp.ins_err('{"projectCode":"hoi-dap-chien-dich","campaignId":31,"question":"Hỏi","requestId":"00000000-0000-4000-8000-000000000a02"}') = 'ai_chat_invalid_request'
  AND pg_temp.counts() = '2/3', 'requestId của câu hỏi tiếp không dùng lại để mở hội thoại mới');
SELECT pg_temp.ok(pg_temp.ins_err(format('{"threadId":%s,"question":"Hỏi","requestId":"00000000-0000-4000-8000-000000000a02"}', :t2)) = 'ai_chat_invalid_request',
  'requestId của hội thoại khác bị từ chối');

-- 6. Nguồn và agent khác: Desktop có agent riêng; nhân viên khác tổ chức.
SELECT pg_temp.ins('{"projectCode":"hoi-dap-chien-dich-desktop","campaignId":20,"question":"Chiến dịch Nam chạy chưa?","source":" Desktop "}') AS e \gset
SELECT pg_temp.ok((:'e'::jsonb ->> 'inserted')::boolean AND :'e'::jsonb ->> 'source' = 'desktop' AND :'e'::jsonb ->> 'staffId' = '2'
  AND :'e'::jsonb #>> '{project,id}' = :'pid_desktop' AND :'e'::jsonb #>> '{project,code}' = 'hoi-dap-chien-dich-desktop',
  'agent Desktop theo mã, source desktop (không phân biệt hoa thường, khoảng trắng)');
SELECT pg_temp.ok(jsonb_array_length(r -> 'items') = 1 AND r #>> '{items,0,messageId}' = :'e'::jsonb ->> 'messageId', 'bộ trả lời lọc projectCodes thấy đúng câu của agent Desktop')
  FROM public.aka_agent_ai_chat_worker('list', '{"projectCodes":["hoi-dap-chien-dich-desktop"]}') r;
SELECT pg_temp.ok((r ->> 'inserted')::boolean AND r ->> 'organizationId' = '2' AND r ->> 'staffId' = '4' AND r ->> 'source' = 'ios' AND r ->> 'accountName' = 'FB Lan',
  'chỉ gửi staffId: tổ chức lấy từ nhân viên') FROM pg_temp.ins('{"projectCode":"hoi-dap-chien-dich","campaignId":40,"staffId":4,"question":"Hỏi","source":"ios"}') r;

-- 7. Agent không cần chiến dịch.
INSERT INTO public.ai_project (group_id, code, name, requires_campaign, audience)
SELECT group_id, 'hoi-dap-chung', 'Hỏi đáp chung', false, 'all' FROM public.ai_project WHERE id = :pid;
SELECT pg_temp.ok(pg_temp.ins_err('{"projectCode":"hoi-dap-chung","question":"Hỏi"}') = 'ai_chat_staff_required', 'agent không cần chiến dịch: vẫn phải biết nhân viên');
SELECT pg_temp.ok((r ->> 'inserted')::boolean AND r -> 'campaignId' = 'null'::jsonb AND r -> 'campaignName' = 'null'::jsonb AND r ->> 'staffId' = '2' AND r ->> 'organizationId' = '1',
  'agent không cần chiến dịch: staffId + question là đủ') FROM pg_temp.ins('{"projectCode":"hoi-dap-chung","staffId":2,"question":"Gói của tôi còn hạn tới khi nào?"}') r;

-- 8. Vẫn theo luật của lõi: agent tắt, tính năng tắt, hạn mức chờ và hạn mức ngày.
UPDATE public.ai_project SET audience = 'off' WHERE code = 'hoi-dap-chung';
SELECT pg_temp.ok(pg_temp.ins_err('{"projectCode":"hoi-dap-chung","staffId":4,"question":"Hỏi"}') = 'ai_chat_agent_unavailable', 'agent audience off bị từ chối');
UPDATE public.ai_project SET audience = 'admin_akabiz' WHERE code = 'hoi-dap-chung';
SELECT pg_temp.ok(pg_temp.ins_err('{"projectCode":"hoi-dap-chung","staffId":4,"question":"Hỏi"}') = 'ai_chat_agent_unavailable'
  AND (pg_temp.ins('{"projectCode":"hoi-dap-chung","staffId":1,"question":"Hỏi của admin"}') ->> 'inserted')::boolean,
  'agent admin_akabiz: chỉ nhân viên admin akaBiz hỏi được');
SELECT pg_temp.ok(pg_temp.ins_err('{"projectCode":"hoi-dap-chien-dich","campaignId":31,"question":"Hỏi"}') = 'ai_chat_too_many_pending',
  'nhân viên đã có 3 câu đang chờ thì không chèn thêm');
UPDATE public.auto_system_settings SET value = '20' WHERE key = 'ai_chat.max_pending_per_staff';
UPDATE public.auto_system_settings SET value = '4' WHERE key = 'ai_chat.max_questions_per_staff_per_day';
SELECT pg_temp.ok(pg_temp.ins_err('{"projectCode":"hoi-dap-chien-dich","campaignId":31,"question":"Hỏi"}') = 'ai_chat_daily_limit', 'hết hạn mức câu hỏi trong ngày của nhân viên');
UPDATE public.auto_system_settings SET value = '50' WHERE key = 'ai_chat.max_questions_per_staff_per_day';
UPDATE public.auto_system_settings SET value = 'false' WHERE key = 'ai_chat.enabled';
SELECT pg_temp.ok(pg_temp.ins_err('{"projectCode":"hoi-dap-chien-dich","campaignId":31,"question":"Hỏi"}') = 'ai_chat_disabled', 'ai_chat.enabled = false thì không chèn');
UPDATE public.auto_system_settings SET value = 'true' WHERE key = 'ai_chat.enabled';
UPDATE public.auto_campaigns SET is_delete = true WHERE id = 32;
SELECT pg_temp.ok(pg_temp.ins_err('{"projectCode":"hoi-dap-chien-dich","campaignId":32,"question":"Hỏi"}') = 'ai_chat_campaign_not_found', 'chiến dịch đã xóa bị từ chối');
UPDATE public.auto_campaigns SET is_delete = false WHERE id = 32;

-- 9. Quyền: chỉ service_role gọi được; bảng vẫn khóa.
SET ROLE service_role;
SELECT pg_temp.ok((public.aka_agent_ai_chat_insert('{"projectCode":"hoi-dap-chien-dich","campaignId":33,"question":"Hỏi bằng service_role"}'::jsonb) ->> 'inserted')::boolean,
  'service_role gọi được hàm');
SELECT pg_temp.ok(pg_temp.err($$INSERT INTO public.ai_message (thread_id, seq, request_id, question) VALUES (1, 99, gen_random_uuid(), 'x')$$) LIKE 'permission denied%',
  'service_role vẫn không ghi thẳng được bảng ai_message');
SELECT pg_temp.ok(pg_temp.err($$SELECT private.aka_agent_ai_chat(1, 1, 'web', 'agents', '{}'::jsonb)$$) LIKE 'permission denied%', 'service_role vẫn không gọi thẳng được lõi');
RESET ROLE;
SET ROLE anon;
SELECT pg_temp.ok(pg_temp.err($$SELECT public.aka_agent_ai_chat_insert('{}'::jsonb)$$) LIKE 'permission denied%', 'anon không gọi được');
RESET ROLE;
SET ROLE authenticated;
SELECT pg_temp.ok(pg_temp.err($$SELECT public.aka_agent_ai_chat_insert('{}'::jsonb)$$) LIKE 'permission denied%', 'authenticated không gọi được');
RESET ROLE;
SET ROLE aka_agent_desktop;
SELECT pg_temp.ok(pg_temp.err($$SELECT public.aka_agent_ai_chat_insert('{}'::jsonb)$$) LIKE 'permission denied%', 'aka_agent_desktop không gọi được');
RESET ROLE;

-- 10. Bất biến dữ liệu sau toàn bộ kịch bản (giống V488).
SELECT pg_temp.ok(NOT EXISTS (
  SELECT 1 FROM public.ai_message_thread t
   WHERE t.message_count <> (SELECT count(*) FROM public.ai_message m WHERE m.thread_id = t.id)
      OR t.last_message_seq <> (SELECT max(m.seq) FROM public.ai_message m WHERE m.thread_id = t.id)
      OR t.last_message_status IS DISTINCT FROM (SELECT m.status FROM public.ai_message m WHERE m.thread_id = t.id AND m.seq = t.last_message_seq)
      OR t.revision <> (SELECT max(m.thread_rev) FROM public.ai_message m WHERE m.thread_id = t.id)),
  'bất biến: hội thoại khớp tin nhắn (số tin, tin cuối, trạng thái, phiên bản)');
SELECT pg_temp.ok((SELECT count(*) FROM public.ai_message_thread WHERE source = 'api') = 4
  AND NOT EXISTS (SELECT 1 FROM public.ai_message_thread WHERE source NOT IN ('web', 'ios', 'desktop', 'api')),
  'nguồn: chỉ hội thoại tạo qua API không gửi source mới mang nguồn api');
SELECT 'PASS';
