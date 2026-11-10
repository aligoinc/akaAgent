-- Kiểm thử V488 trên fixture cục bộ. Mỗi dòng "ok - ..." là một khẳng định; có "not ok" thì smoke thất bại.
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
CREATE FUNCTION pg_temp.web(p_staff bigint, p_org bigint, p_action text, p_payload jsonb) RETURNS jsonb LANGUAGE sql AS
$$ SELECT public.aka_agent_control_ai_chat(p_staff, p_org, 'web', p_action, p_payload) $$;
CREATE FUNCTION pg_temp.worker(p_action text, p_payload jsonb) RETURNS jsonb LANGUAGE sql AS
$$ SELECT public.aka_agent_ai_chat_worker(p_action, p_payload) $$;
CREATE FUNCTION pg_temp.web(p_staff bigint, p_org bigint, p_action text, p_payload text) RETURNS jsonb LANGUAGE sql AS
$$ SELECT public.aka_agent_control_ai_chat(p_staff, p_org, 'web', p_action, p_payload::jsonb) $$;
CREATE FUNCTION pg_temp.worker(p_action text, p_payload text) RETURNS jsonb LANGUAGE sql AS
$$ SELECT public.aka_agent_ai_chat_worker(p_action, p_payload::jsonb) $$;

-- 1. Danh sách agent theo đối tượng.
SELECT id AS pid FROM public.ai_project WHERE code = 'hoi-dap-chien-dich' \gset
SELECT pg_temp.ok((r ->> 'enabled')::boolean AND r #>> '{groups,0,code}' = 'hoi-dap-chien-dich'
  AND r #>> '{groups,0,projects,0,code}' = 'hoi-dap-chien-dich' AND jsonb_array_length(r #> '{groups,0,projects,0,suggestedQuestions}') = 4
  AND (r #>> '{limits,maxPendingPerStaff}')::int = 3, 'agents: admin akaBiz thấy agent, kèm giới hạn')
  FROM pg_temp.web(1, 1, 'agents', '{}') r;
SELECT pg_temp.ok(r -> 'groups' = '[]'::jsonb, 'agents: nhân viên thường chưa thấy agent admin_akabiz') FROM pg_temp.web(2, 1, 'agents', '{}') r;
SELECT pg_temp.ok(pg_temp.err($$SELECT pg_temp.web(2, 1, 'open', '{"requestId":"00000000-0000-4000-8000-0000000000a1","projectId":$$ || :pid || $$,"campaignId":20,"question":"Hỏi"}')$$)
  = 'ai_chat_agent_unavailable', 'open: agent admin_akabiz từ chối nhân viên thường');
UPDATE public.ai_project SET audience = 'all' WHERE id = :pid;
SELECT pg_temp.ok(jsonb_array_length(r #> '{groups,0,projects}') = 1, 'agents: audience all thì nhân viên thường thấy') FROM pg_temp.web(2, 1, 'agents', '{}') r;
SELECT pg_temp.ok(r -> 'groups' = '[]'::jsonb, 'agents: lọc theo groupCode không khớp') FROM pg_temp.web(1, 1, 'agents', '{"groupCode":"khac"}') r;

-- 2. Kiểm tra đầu vào của open.
SELECT pg_temp.ok(pg_temp.err($$SELECT pg_temp.web(3, 2, 'agents', '{}')$$) = 'ai_chat_access_denied', 'nhân viên đã nghỉ bị từ chối');
SELECT pg_temp.ok(pg_temp.err($$SELECT pg_temp.web(1, 2, 'agents', '{}')$$) = 'ai_chat_access_denied', 'sai tổ chức bị từ chối');
SELECT pg_temp.ok(pg_temp.err($$SELECT pg_temp.web(1, 1, 'open', '{"projectId":$$ || :pid || $$,"campaignId":10,"question":"Hỏi"}')$$) = 'ai_chat_invalid_request', 'open: thiếu requestId');
SELECT pg_temp.ok(pg_temp.err($$SELECT pg_temp.web(1, 1, 'open', '{"requestId":"00000000-0000-4000-8000-000000000001","projectId":$$ || :pid || $$,"campaignId":10,"question":"   "}')$$) = 'ai_chat_question_required', 'open: câu hỏi trống');
SELECT pg_temp.ok(pg_temp.err($$SELECT pg_temp.web(1, 1, 'open', jsonb_build_object('requestId','00000000-0000-4000-8000-000000000001','projectId',$$ || :pid || $$,'campaignId',10,'question',repeat('a',4001)))$$) = 'ai_chat_question_too_long', 'open: câu hỏi quá 4.000 ký tự');
SELECT pg_temp.ok(pg_temp.err($$SELECT pg_temp.web(1, 1, 'open', '{"requestId":"00000000-0000-4000-8000-000000000001","projectId":999999,"campaignId":10,"question":"Hỏi"}')$$) = 'ai_chat_agent_not_found', 'open: agent không tồn tại');
SELECT pg_temp.ok(pg_temp.err($$SELECT pg_temp.web(1, 1, 'open', '{"requestId":"00000000-0000-4000-8000-000000000001","projectId":$$ || :pid || $$,"campaignId":20,"question":"Hỏi"}')$$) = 'ai_chat_campaign_not_found', 'open: chiến dịch của nhân viên khác');
SELECT pg_temp.ok(pg_temp.err($$SELECT pg_temp.web(1, 1, 'open', '{"requestId":"00000000-0000-4000-8000-000000000001","projectId":$$ || :pid || $$,"campaignId":40,"question":"Hỏi"}')$$) = 'ai_chat_campaign_not_found', 'open: chiến dịch của tổ chức khác');
SELECT pg_temp.ok(pg_temp.err($$SELECT pg_temp.web(1, 1, 'open', '{"requestId":"00000000-0000-4000-8000-000000000001","projectId":$$ || :pid || $$,"question":"Hỏi"}')$$) = 'ai_chat_campaign_required', 'open: agent bắt buộc có chiến dịch');
SELECT pg_temp.ok(pg_temp.err($$SELECT pg_temp.web(1, 1, 'open', '{"requestId":"00000000-0000-4000-8000-000000000001","projectId":$$ || :pid || $$,"campaignId":"abc","question":"Hỏi"}')$$) = 'ai_chat_invalid_request', 'open: campaignId sai định dạng');
UPDATE public.ai_project SET intake_schema = '[{"key":"muc_tieu","label":"Mục tiêu","type":"text","required":true}]' WHERE id = :pid;
SELECT pg_temp.ok(pg_temp.err($$SELECT pg_temp.web(1, 1, 'open', '{"requestId":"00000000-0000-4000-8000-000000000001","projectId":$$ || :pid || $$,"campaignId":10,"question":"Hỏi"}')$$) = 'ai_chat_intake_required', 'open: thiếu ô bắt buộc của modal');
UPDATE public.ai_project SET applies_to = '{"platforms":["facebook"]}' WHERE id = :pid;
SELECT pg_temp.ok(pg_temp.err($$SELECT pg_temp.web(1, 1, 'open', '{"requestId":"00000000-0000-4000-8000-000000000001","projectId":$$ || :pid || $$,"campaignId":10,"question":"Hỏi","intake":{"muc_tieu":"x"}}')$$) = 'ai_chat_agent_not_applicable', 'open: agent không áp dụng cho nền tảng của chiến dịch');
UPDATE public.ai_project SET applies_to = '{"platforms":["zalo"],"actionIds":["zalo_message_phone"]}', intake_schema = '[]' WHERE id = :pid;

-- 3. Mở hội thoại: tạo hội thoại + câu đầu trong một giao dịch; gửi lại cùng requestId không tạo thêm.
SELECT pg_temp.web(1, 1, 'open', '{"requestId":"00000000-0000-4000-8000-000000000001","projectId":' || :pid || ',"campaignId":10,"question":"  Tại sao chiến dịch\n không chạy?  ","intake":{"ghi_chu":"gấp"}}') AS r1 \gset
SELECT (:'r1'::jsonb #>> '{thread,id}')::bigint AS tid, (:'r1'::jsonb #>> '{messages,0,id}')::bigint AS mid \gset
SELECT pg_temp.ok(r ->> 'changed' = 'true' AND r ->> 'reused' = 'false' AND r ->> 'revision' = '1' AND r #>> '{thread,campaignName}' = 'Chăm sóc khách tháng 11'
  AND r #>> '{thread,accountName}' = 'Zalo Shop Hà' AND r #>> '{thread,accountId}' = '100' AND r #>> '{thread,pending}' = 'true'
  AND r #>> '{thread,unread}' = 'false' AND r #>> '{thread,name}' = 'Tại sao chiến dịch không chạy?' AND r #>> '{thread,source}' = 'web'
  AND r #>> '{messages,0,status}' = 'chờ câu trả lời' AND r #>> '{messages,0,seq}' = '1' AND r #>> '{messages,0,answer}' IS NULL
  AND r ? 'serverTime', 'open: ảnh chụp hội thoại + câu đầu') FROM (SELECT :'r1'::jsonb r) x;
SELECT pg_temp.ok(t.customer_id = 9001 AND t.organization_id = 1 AND t.org_staff_id = 1 AND t.intake_data = '{"ghi_chu":"gấp"}'
  AND t.project_version = 1 AND m.deadline_at = m.asked_at + interval '1200 seconds' AND m.question = E'Tại sao chiến dịch\n không chạy?',
  'open: server tự điền khách hàng/tổ chức/nhân viên, hạn chót theo agent')
  FROM public.ai_message_thread t JOIN public.ai_message m ON m.thread_id = t.id WHERE t.id = :tid;
SELECT pg_temp.ok((r #>> '{thread,id}')::bigint = :tid AND (SELECT count(*) FROM public.ai_message_thread) = 1 AND (SELECT count(*) FROM public.ai_message) = 1,
  'open: gửi lại cùng requestId trả đúng hội thoại cũ')
  FROM pg_temp.web(1, 1, 'open', '{"requestId":"00000000-0000-4000-8000-000000000001","projectId":' || :pid || ',"campaignId":10,"question":"khác"}') r;
SELECT pg_temp.ok(r ->> 'reused' = 'true' AND (r #>> '{thread,id}')::bigint = :tid AND (SELECT count(*) FROM public.ai_message_thread) = 1,
  'open: cùng agent + chiến dịch đang có câu chờ thì mở lại hội thoại đó')
  FROM pg_temp.web(1, 1, 'open', '{"requestId":"00000000-0000-4000-8000-000000000002","projectId":' || :pid || ',"campaignId":10,"question":"Câu khác"}') r;
SELECT pg_temp.ok(pg_temp.err($$SELECT pg_temp.web(2, 1, 'open', '{"requestId":"00000000-0000-4000-8000-000000000001","projectId":$$ || :pid || $$,"campaignId":20,"question":"x"}')$$)
  = 'ai_chat_invalid_request', 'open: requestId của người khác bị từ chối');

-- 4. Một hội thoại chỉ một câu đang chờ (API + DB).
SELECT pg_temp.ok(pg_temp.err($$SELECT pg_temp.web(1, 1, 'ask', '{"threadId":$$ || :tid || $$,"requestId":"00000000-0000-4000-8000-000000000003","question":"Hỏi chen"}')$$)
  = 'ai_chat_message_pending', 'ask: không cho hỏi thêm khi đang chờ');
SELECT pg_temp.ok(pg_temp.err($$INSERT INTO public.ai_message (thread_id, seq, request_id, question, thread_rev, deadline_at) VALUES ($$ || :tid || $$, 2, gen_random_uuid(), 'x', 1, now() + interval '1 minute')$$)
  LIKE '%uq_ai_message_one_active_per_thread%', 'DB: chỉ mục duy nhất chặn câu chờ thứ hai');

-- 5. Đồng bộ theo phiên bản + cách ly giữa nhân viên/tổ chức.
SELECT pg_temp.ok(r ->> 'changed' = 'false' AND r ->> 'revision' = '1' AND NOT r ? 'messages', 'sync: không đổi thì trả gọn')
  FROM pg_temp.web(1, 1, 'sync', '{"threadId":' || :tid || ',"afterRevision":1}') r;
SELECT pg_temp.ok(pg_temp.err($$SELECT pg_temp.web(2, 1, 'sync', '{"threadId":$$ || :tid || $$}')$$) = 'ai_chat_thread_not_found', 'sync: nhân viên khác cùng tổ chức không đọc được');
SELECT pg_temp.ok(pg_temp.err($$SELECT pg_temp.web(4, 2, 'sync', '{"threadId":$$ || :tid || $$}')$$) = 'ai_chat_thread_not_found', 'sync: tổ chức khác không đọc được');
SELECT pg_temp.ok(pg_temp.err($$SELECT pg_temp.web(2, 1, 'cancel', '{"threadId":$$ || :tid || $$,"messageId":$$ || :mid || $$}')$$) = 'ai_chat_thread_not_found', 'cancel: nhân viên khác không hủy được');
SELECT pg_temp.ok(jsonb_array_length(r -> 'items') = 1 AND r #>> '{items,0,pending}' = 'true', 'sync_pending: thấy hội thoại đang chờ') FROM pg_temp.web(1, 1, 'sync_pending', '{}') r;
SELECT pg_temp.ok(r -> 'items' = '[]'::jsonb, 'sync_pending: nhân viên khác không thấy') FROM pg_temp.web(2, 1, 'sync_pending', '{}') r;

-- 6. Bộ trả lời: claim → progress → answer → complete.
SELECT pg_temp.ok(pg_temp.err($$SELECT pg_temp.worker('claim', '{}')$$) = 'ai_chat_worker_id_required', 'worker: claim cần workerId');
SELECT pg_temp.worker('claim', '{"workerId":"w1","limit":5}') AS c1 \gset
SELECT (:'c1'::jsonb #>> '{items,0,claimToken}') AS tok \gset
SELECT pg_temp.ok(jsonb_array_length(c -> 'items') = 1 AND (c #>> '{items,0,messageId}')::bigint = :mid AND c #>> '{items,0,thread,organizationId}' = '1'
  AND c #>> '{items,0,thread,staffId}' = '1' AND c #>> '{items,0,thread,campaignId}' = '10' AND c #>> '{items,0,thread,customerId}' = '9001'
  AND c #>> '{items,0,project,code}' = 'hoi-dap-chien-dich' AND c #> '{items,0,project,outputSchema,required}' = '["tom_tat"]'
  AND length(c #>> '{items,0,project,groupRules}') > 20 AND c #> '{items,0,history}' = '[]'::jsonb AND c #>> '{items,0,attempt}' = '1',
  'worker: claim trả câu hỏi + phạm vi + quy tắc + schema') FROM (SELECT :'c1'::jsonb c) x;
SELECT pg_temp.ok(c -> 'items' = '[]'::jsonb, 'worker: câu đã nhận không bị nhận lần hai') FROM pg_temp.worker('claim', '{"workerId":"w2"}') c;
SELECT pg_temp.ok(r ->> 'changed' = 'true' AND r ->> 'full' = 'false' AND r ->> 'revision' = '2' AND jsonb_array_length(r -> 'messages') = 1
  AND r #>> '{messages,0,status}' = 'đang lấy thông tin câu hỏi', 'sync: chỉ trả tin đổi sau phiên bản app đang có')
  FROM pg_temp.web(1, 1, 'sync', '{"threadId":' || :tid || ',"afterRevision":1}') r;
SELECT pg_temp.ok(r ->> 'ok' = 'true' AND r ->> 'status' = 'đang tìm câu trả lời', 'worker: progress chuyển sang đang tìm câu trả lời')
  FROM pg_temp.worker('progress', jsonb_build_object('messageId', :mid, 'claimToken', :'tok', 'note', 'Đang xem lịch sử hành động hôm nay')) r;
SELECT pg_temp.ok(r ->> 'revision' = '3' AND r #>> '{messages,0,progressNote}' = 'Đang xem lịch sử hành động hôm nay', 'sync: thấy dòng tiến độ')
  FROM pg_temp.web(1, 1, 'sync', '{"threadId":' || :tid || ',"afterRevision":2}') r;
SELECT pg_temp.worker('progress', jsonb_build_object('messageId', :mid, 'claimToken', :'tok')) \gset p_
SELECT pg_temp.ok(revision = 3, 'worker: chỉ gia hạn thuê thì không tăng phiên bản') FROM public.ai_message_thread WHERE id = :tid;
SELECT pg_temp.ok(r ->> 'ok' = 'false' AND r ->> 'reason' = 'not_claimed', 'worker: sai claimToken không ghi được')
  FROM pg_temp.worker('answer', jsonb_build_object('messageId', :mid, 'claimToken', '00000000-0000-4000-8000-00000000dead', 'answer', 'x', 'answerJson', '{"tom_tat":"x"}'::jsonb)) r;
SELECT pg_temp.ok(pg_temp.err($$SELECT pg_temp.worker('answer', jsonb_build_object('messageId', $$ || :mid || $$, 'claimToken', '$$ || :'tok' || $$', 'answer', 'Trả lời', 'answerJson', '{"khac":1}'::jsonb))$$)
  = 'ai_chat_answer_schema_mismatch', 'worker: answerJson thiếu khóa bắt buộc của output_schema');
SELECT pg_temp.ok(pg_temp.err($$SELECT pg_temp.worker('answer', jsonb_build_object('messageId', $$ || :mid || $$, 'claimToken', '$$ || :'tok' || $$', 'answer', 'Trả lời'))$$)
  = 'ai_chat_answer_schema_mismatch', 'worker: agent có output_schema thì bắt buộc answerJson');
SELECT pg_temp.ok(r ->> 'ok' = 'true' AND r ->> 'status' = 'đã có câu trả lời', 'worker: answer hợp lệ')
  FROM pg_temp.worker('answer', jsonb_build_object('messageId', :mid, 'claimToken', :'tok', 'answer', 'Chiến dịch đã chạm hạn mức ngày.',
    'answerJson', '{"tom_tat":"Chiến dịch đã chạm hạn mức ngày.","cach_xu_ly":["Chờ sang ngày mai"]}'::jsonb)) r;
SELECT pg_temp.ok(r #>> '{messages,0,status}' = 'đã có câu trả lời' AND r #>> '{messages,0,answer}' IS NULL AND r #> '{messages,0,answerJson}' = 'null'::jsonb
  AND r #>> '{thread,pending}' = 'true', 'sync: chưa hoàn thành thì app chưa nhận nội dung trả lời')
  FROM pg_temp.web(1, 1, 'sync', '{"threadId":' || :tid || ',"afterRevision":3}') r;
SELECT pg_temp.ok(pg_temp.err($$SELECT pg_temp.web(1, 1, 'ask', '{"threadId":$$ || :tid || $$,"requestId":"00000000-0000-4000-8000-000000000003","question":"Hỏi chen"}')$$)
  = 'ai_chat_message_pending', 'ask: "đã có câu trả lời" vẫn là đang chờ');
SELECT pg_temp.ok(r ->> 'ok' = 'true' AND r ->> 'status' = 'hoàn thành', 'worker: complete') FROM pg_temp.worker('complete', jsonb_build_object('messageId', :mid, 'claimToken', :'tok')) r;
SELECT pg_temp.ok(r ->> 'revision' = '5' AND r #>> '{messages,0,status}' = 'hoàn thành' AND r #>> '{messages,0,answer}' = 'Chiến dịch đã chạm hạn mức ngày.'
  AND r #>> '{messages,0,answerJson,cach_xu_ly,0}' = 'Chờ sang ngày mai' AND r #>> '{thread,pending}' = 'false' AND r #>> '{thread,unread}' = 'true',
  'sync: hoàn thành thì có câu trả lời, hội thoại chưa đọc')
  FROM pg_temp.web(1, 1, 'sync', '{"threadId":' || :tid || ',"afterRevision":4}') r;
SELECT pg_temp.ok(r ->> 'ok' = 'false', 'worker: sau khi hoàn thành token hết hiệu lực') FROM pg_temp.worker('progress', jsonb_build_object('messageId', :mid, 'claimToken', :'tok')) r;

-- 7. Đã đọc, đánh giá.
SELECT pg_temp.ok(jsonb_array_length(r -> 'items') = 1 AND r #>> '{items,0,unread}' = 'true', 'sync_pending: có câu trả lời chưa đọc') FROM pg_temp.web(1, 1, 'sync_pending', '{}') r;
SELECT pg_temp.ok(r ->> 'lastReadSeq' = '1', 'mark_read') FROM pg_temp.web(1, 1, 'mark_read', '{"threadId":' || :tid || ',"seq":99}') r;
SELECT pg_temp.ok(r -> 'items' = '[]'::jsonb, 'sync_pending: đọc xong thì hết việc cần chú ý') FROM pg_temp.web(1, 1, 'sync_pending', '{}') r;
SELECT pg_temp.ok(r #>> '{messages,0,rating}' = '1' AND r ->> 'revision' = '6', 'rate: hữu ích')
  FROM pg_temp.web(1, 1, 'rate', '{"threadId":' || :tid || ',"messageId":' || :mid || ',"rating":1,"afterRevision":5}') r;
SELECT pg_temp.ok(pg_temp.err($$SELECT pg_temp.web(1, 1, 'rate', '{"threadId":$$ || :tid || $$,"messageId":$$ || :mid || $$,"rating":5}')$$) = 'ai_chat_invalid_request', 'rate: giá trị sai');

-- 8. Hỏi tiếp: liền mạch, có lịch sử cho bộ trả lời; gửi lại cùng requestId không tạo thêm.
SELECT pg_temp.web(1, 1, 'ask', '{"threadId":' || :tid || ',"requestId":"00000000-0000-4000-8000-000000000004","question":"Vậy khi nào chạy tiếp?","afterRevision":6}') AS r2 \gset
SELECT (:'r2'::jsonb #>> '{messages,0,id}')::bigint AS mid2 \gset
SELECT pg_temp.ok(r ->> 'revision' = '7' AND jsonb_array_length(r -> 'messages') = 1 AND r #>> '{messages,0,seq}' = '2' AND r #>> '{thread,messageCount}' = '2'
  AND r #>> '{thread,pending}' = 'true', 'ask: câu hỏi tiếp theo') FROM (SELECT :'r2'::jsonb r) x;
SELECT pg_temp.ok((SELECT count(*) FROM public.ai_message WHERE thread_id = :tid) = 2 AND r ->> 'changed' = 'false', 'ask: gửi lại cùng requestId không tạo thêm')
  FROM pg_temp.web(1, 1, 'ask', '{"threadId":' || :tid || ',"requestId":"00000000-0000-4000-8000-000000000004","question":"Vậy khi nào chạy tiếp?","afterRevision":7}') r;
SELECT pg_temp.ok(r ->> 'lastReadSeq' = '1', 'mark_read: câu đang chờ chưa thể đánh dấu đã đọc') FROM pg_temp.web(1, 1, 'mark_read', '{"threadId":' || :tid || ',"seq":2}') r;
SELECT pg_temp.worker('claim', '{"workerId":"w1","projectCodes":["hoi-dap-chien-dich"]}') AS c2 \gset
SELECT (:'c2'::jsonb #>> '{items,0,claimToken}') AS tok2 \gset
SELECT pg_temp.ok(jsonb_array_length(c #> '{items,0,history}') = 1 AND c #>> '{items,0,history,0,answer}' = 'Chiến dịch đã chạm hạn mức ngày.'
  AND c #>> '{items,0,question}' = 'Vậy khi nào chạy tiếp?', 'worker: claim kèm lịch sử hỏi đáp đã hoàn thành') FROM (SELECT :'c2'::jsonb c) x;
SELECT pg_temp.ok(c -> 'items' = '[]'::jsonb, 'worker: lọc projectCodes không khớp') FROM pg_temp.worker('claim', '{"workerId":"w9","projectCodes":["khac"]}') c;

-- 9. Hủy: token của bộ trả lời mất hiệu lực; Thử lại đưa câu về hàng đợi.
SELECT pg_temp.ok(r #>> '{messages,0,status}' = 'đã hủy' AND r #>> '{thread,pending}' = 'false' AND r #>> '{thread,unread}' = 'false', 'cancel')
  FROM pg_temp.web(1, 1, 'cancel', '{"threadId":' || :tid || ',"messageId":' || :mid2 || ',"afterRevision":8}') r;
SELECT pg_temp.ok(r ->> 'ok' = 'false' AND r ->> 'reason' = 'cancelled', 'worker: câu đã hủy không ghi được câu trả lời')
  FROM pg_temp.worker('answer', jsonb_build_object('messageId', :mid2, 'claimToken', :'tok2', 'answer', 'x', 'answerJson', '{"tom_tat":"x"}'::jsonb, 'complete', true)) r;
SELECT pg_temp.ok(pg_temp.err($$SELECT pg_temp.web(1, 1, 'retry', '{"threadId":$$ || :tid || $$,"messageId":$$ || :mid || $$}')$$) = 'ai_chat_not_retryable', 'retry: chỉ câu cuối đang lỗi/đã hủy');
SELECT pg_temp.ok(r #>> '{messages,0,status}' = 'chờ câu trả lời' AND r #>> '{messages,0,seq}' = '2' AND r #>> '{thread,pending}' = 'true', 'retry: câu đã hủy về hàng đợi')
  FROM pg_temp.web(1, 1, 'retry', '{"threadId":' || :tid || ',"messageId":' || :mid2 || ',"afterRevision":9}') r;

-- 10. Trả lời một bước (answer + complete), rồi báo lỗi có thử lại.
SELECT pg_temp.worker('claim', '{"workerId":"w1"}') AS c3 \gset
SELECT (:'c3'::jsonb #>> '{items,0,claimToken}') AS tok3 \gset
SELECT pg_temp.ok(r ->> 'requeued' = 'true' AND r ->> 'status' = 'chờ câu trả lời', 'worker: fail retryable trả câu về hàng đợi')
  FROM pg_temp.worker('fail', jsonb_build_object('messageId', :mid2, 'claimToken', :'tok3', 'retryable', true)) r;
SELECT pg_temp.worker('claim', '{"workerId":"w1"}') AS c4 \gset
SELECT (:'c4'::jsonb #>> '{items,0,claimToken}') AS tok4 \gset
SELECT pg_temp.ok(c #>> '{items,0,attempt}' = '2', 'worker: đếm số lần nhận') FROM (SELECT :'c4'::jsonb c) x;
SELECT pg_temp.ok(r ->> 'status' = 'hoàn thành', 'worker: answer + complete một bước')
  FROM pg_temp.worker('answer', jsonb_build_object('messageId', :mid2, 'claimToken', :'tok4', 'answer', 'Sau 00:00.', 'answerJson', '{"tom_tat":"Sau 00:00."}'::jsonb, 'complete', true)) r;

-- 11. Quá hạn: app không chờ vô hạn; Thử lại đặt hạn mới.
SELECT pg_temp.web(1, 1, 'ask', '{"threadId":' || :tid || ',"requestId":"00000000-0000-4000-8000-000000000005","question":"Câu thứ ba"}') AS r3 \gset
SELECT id AS mid3 FROM public.ai_message WHERE thread_id = :tid AND seq = 3 \gset
SELECT pg_temp.worker('claim', '{"workerId":"w1"}') AS c5 \gset
SELECT (:'c5'::jsonb #>> '{items,0,claimToken}') AS tok5 \gset
UPDATE public.ai_message SET deadline_at = now() - interval '1 second' WHERE id = :mid3;
SELECT pg_temp.ok(r ->> 'ok' = 'false' AND r ->> 'reason' = 'expired', 'worker: quá hạn thì không ghi được')
  FROM pg_temp.worker('answer', jsonb_build_object('messageId', :mid3, 'claimToken', :'tok5', 'answer', 'muộn', 'answerJson', '{"tom_tat":"muộn"}'::jsonb)) r;
SELECT pg_temp.ok(m.status = 'lỗi' AND m.error_code = 'ai_chat_timeout' AND m.answer IS NULL, 'quá hạn: chuyển lỗi, không lưu câu trả lời muộn') FROM public.ai_message m WHERE m.id = :mid3;
SELECT pg_temp.ok(r #>> '{thread,lastMessageStatus}' = 'lỗi' AND r #>> '{thread,unread}' = 'true', 'sync: thấy lỗi quá hạn')
  FROM pg_temp.web(1, 1, 'sync', '{"threadId":' || :tid || '}') r;
SELECT pg_temp.ok(r ->> 'full' = 'true' AND r #>> '{messages,2,status}' = 'chờ câu trả lời' AND r #>> '{messages,2,errorCode}' IS NULL
  AND (r #>> '{messages,2,deadlineAt}')::timestamptz > now() + interval '4 minutes', 'retry: câu quá hạn được đặt hạn mới (phiên bản app lạ thì tải đầy đủ)')
  FROM pg_temp.web(1, 1, 'retry', '{"threadId":' || :tid || ',"messageId":' || :mid3 || ',"afterRevision":999}') r;
-- sync tự xử lý quá hạn (không cần bộ trả lời hay cron).
UPDATE public.ai_message SET deadline_at = now() - interval '1 second' WHERE id = :mid3;
SELECT pg_temp.ok(r #>> '{thread,lastMessageStatus}' = 'lỗi', 'sync: tự chuyển câu quá hạn sang lỗi')
  FROM pg_temp.web(1, 1, 'sync', '{"threadId":' || :tid || ',"afterRevision":1}') r;
SELECT pg_temp.web(1, 1, 'retry', '{"threadId":' || :tid || ',"messageId":' || :mid3 || '}') \gset rt_

-- 12. Bộ trả lời treo: hết hạn thuê thì trả về hàng đợi, quá 3 lần thì báo lỗi.
SELECT pg_temp.worker('claim', '{"workerId":"w1","leaseSeconds":30}') \gset l1_
UPDATE public.ai_message SET lease_until = now() - interval '1 second' WHERE id = :mid3;
SELECT pg_temp.ok(jsonb_array_length(c -> 'items') = 1 AND c #>> '{items,0,attempt}' = '2' AND c #>> '{items,0,messageId}' = :mid3::text,
  'worker: câu hết hạn thuê được nhận lại') FROM pg_temp.worker('claim', '{"workerId":"w2"}') c;
UPDATE public.ai_message SET lease_until = now() - interval '1 second' WHERE id = :mid3;
SELECT pg_temp.worker('claim', '{"workerId":"w2"}') \gset l3_
UPDATE public.ai_message SET lease_until = now() - interval '1 second' WHERE id = :mid3;
SELECT pg_temp.ok(c -> 'items' = '[]'::jsonb, 'worker: treo 3 lần thì không nhận lại nữa') FROM pg_temp.worker('claim', '{"workerId":"w2"}') c;
SELECT pg_temp.ok(status = 'lỗi' AND error_code = 'ai_chat_answer_failed' AND claim_token IS NULL, 'worker: treo 3 lần thì báo lỗi cho khách') FROM public.ai_message WHERE id = :mid3;

-- 13. Hạn mức: số câu chờ cùng lúc và số câu mỗi ngày.
UPDATE public.auto_system_settings SET value = '2' WHERE key = 'ai_chat.max_pending_per_staff';
SELECT pg_temp.web(1, 1, 'retry', '{"threadId":' || :tid || ',"messageId":' || :mid3 || '}') \gset q1_
SELECT pg_temp.web(1, 1, 'open', '{"requestId":"00000000-0000-4000-8000-000000000011","projectId":' || :pid || ',"campaignId":11,"question":"Chiến dịch 11"}') AS r11 \gset
SELECT (:'r11'::jsonb #>> '{thread,id}')::bigint AS tid11 \gset
SELECT pg_temp.ok(pg_temp.err($$SELECT pg_temp.web(1, 1, 'open', '{"requestId":"00000000-0000-4000-8000-000000000012","projectId":$$ || :pid || $$,"campaignId":31,"question":"Chiến dịch 31"}')$$)
  = 'ai_chat_too_many_pending', 'hạn mức: quá số câu chờ cùng lúc');
UPDATE public.auto_system_settings SET value = '3' WHERE key = 'ai_chat.max_pending_per_staff';
UPDATE public.auto_system_settings SET value = '4' WHERE key = 'ai_chat.max_questions_per_staff_per_day';
SELECT pg_temp.ok(pg_temp.err($$SELECT pg_temp.web(1, 1, 'open', '{"requestId":"00000000-0000-4000-8000-000000000012","projectId":$$ || :pid || $$,"campaignId":31,"question":"Chiến dịch 31"}')$$)
  = 'ai_chat_daily_limit', 'hạn mức: quá số câu mỗi ngày');
UPDATE public.auto_system_settings SET value = '50' WHERE key = 'ai_chat.max_questions_per_staff_per_day';

-- 14. Danh sách hội thoại + phân trang tin cũ.
SELECT pg_temp.ok(jsonb_array_length(r -> 'items') = 2 AND (r #>> '{items,0,id}')::bigint = :tid11 AND r -> 'nextCursor' = 'null'::jsonb, 'threads: mới nhất trước')
  FROM pg_temp.web(1, 1, 'threads', '{}') r;
SELECT pg_temp.ok(jsonb_array_length(r -> 'items') = 1 AND (r #>> '{items,0,id}')::bigint = :tid, 'threads: lọc theo chiến dịch') FROM pg_temp.web(1, 1, 'threads', '{"campaignId":10}') r;
SELECT pg_temp.web(1, 1, 'threads', '{"limit":1}') AS pg1 \gset
SELECT pg_temp.ok(jsonb_array_length(r -> 'items') = 1 AND (r #>> '{items,0,id}')::bigint = :tid, 'threads: trang kế theo con trỏ')
  FROM pg_temp.web(1, 1, 'threads', jsonb_build_object('limit', 1, 'cursor', :'pg1'::jsonb -> 'nextCursor')) r;
SELECT pg_temp.ok(jsonb_array_length(r -> 'messages') = 2 AND r #>> '{messages,0,seq}' = '1' AND r ->> 'hasMore' = 'false', 'messages: tin cũ hơn theo seq')
  FROM pg_temp.web(1, 1, 'messages', '{"threadId":' || :tid || ',"beforeSeq":3}') r;
SELECT pg_temp.ok(jsonb_array_length(r -> 'messages') = 3 AND r ->> 'full' = 'true' AND r #>> '{messages,2,seq}' = '3', 'sync: tải đầy đủ khi chưa có phiên bản')
  FROM pg_temp.web(1, 1, 'sync', '{"threadId":' || :tid || '}') r;

-- 15. Công tắc khẩn: ẩn menu, không nhận câu mới, vẫn đọc được hội thoại cũ; bộ trả lời không nhận việc.
UPDATE public.auto_system_settings SET value = 'false' WHERE key = 'ai_chat.enabled';
SELECT pg_temp.ok(r ->> 'enabled' = 'false' AND r -> 'groups' = '[]'::jsonb, 'tắt: agents trả enabled=false') FROM pg_temp.web(1, 1, 'agents', '{}') r;
SELECT pg_temp.ok(pg_temp.err($$SELECT pg_temp.web(1, 1, 'open', '{"requestId":"00000000-0000-4000-8000-000000000013","projectId":$$ || :pid || $$,"campaignId":32,"question":"x"}')$$) = 'ai_chat_disabled', 'tắt: không nhận câu mới');
SELECT pg_temp.ok(r ->> 'changed' = 'true', 'tắt: vẫn đọc được hội thoại cũ') FROM pg_temp.web(1, 1, 'sync', '{"threadId":' || :tid || '}') r;
SELECT pg_temp.ok(c ->> 'enabled' = 'false' AND c -> 'items' = '[]'::jsonb, 'tắt: bộ trả lời không nhận việc') FROM pg_temp.worker('claim', '{"workerId":"w1"}') c;
UPDATE public.auto_system_settings SET value = 'true' WHERE key = 'ai_chat.enabled';
UPDATE public.ai_project SET is_active = false WHERE id = :pid;
SELECT pg_temp.ok(pg_temp.err($$SELECT pg_temp.web(1, 1, 'ask', '{"threadId":$$ || :tid11 || $$,"requestId":"00000000-0000-4000-8000-000000000014","question":"x"}')$$) = 'ai_chat_agent_unavailable', 'agent tắt: không hỏi tiếp được');
UPDATE public.ai_project SET is_active = true WHERE id = :pid;

-- 16. Quyền: bảng đóng với mọi role ứng dụng; mỗi RPC chỉ đúng role của nó.
SET ROLE service_role;
SELECT pg_temp.ok(pg_temp.err('SELECT count(*) FROM public.ai_message') LIKE 'permission denied%', 'service_role không đọc thẳng bảng');
SELECT pg_temp.ok((public.aka_agent_control_ai_chat(1, 1, 'web', 'agents') ->> 'enabled') = 'true', 'service_role gọi được RPC control');
SELECT pg_temp.ok(pg_temp.err($$SELECT public.aka_agent_control_ai_chat(1, 1, 'desktop', 'agents')$$) = 'ai_chat_invalid_client', 'RPC control chỉ nhận web/ios');
SELECT pg_temp.ok(pg_temp.err($$SELECT private.aka_agent_ai_chat(1, 1, 'web', 'agents', '{}')$$) LIKE 'permission denied%', 'service_role không gọi thẳng lõi private');
RESET ROLE;
SET ROLE anon;
SELECT pg_temp.ok(pg_temp.err($$SELECT public.aka_agent_control_ai_chat(1, 1, 'web', 'agents')$$) LIKE 'permission denied%', 'anon không gọi được RPC control');
SELECT pg_temp.ok(pg_temp.err($$SELECT public.aka_agent_ai_chat_worker('claim', '{"workerId":"x"}')$$) LIKE 'permission denied%', 'anon không gọi được RPC worker');
SELECT pg_temp.ok(pg_temp.err($$SELECT public.aka_agent_ai_chat(1, 1, 'ha', 'pw1', 'agents')$$) LIKE 'permission denied%', 'anon không gọi được RPC Desktop');
SELECT pg_temp.ok(pg_temp.err('SELECT count(*) FROM public.ai_project') LIKE 'permission denied%', 'anon không đọc được bảng');
RESET ROLE;

-- 17. Desktop: cùng lõi, xác thực bằng token Desktop + tài khoản; không vượt sang nhân viên khác.
SET ROLE aka_agent_desktop;
SELECT set_config('request.jwt.claims', '{"role":"aka_agent_desktop","sub":"11111111-1111-4111-8111-111111111111"}', false) \gset jw_
SELECT pg_temp.ok((public.aka_agent_ai_chat(1, 1, 'ha', 'pw1', 'sync', jsonb_build_object('threadId', :tid)) ->> 'changed') = 'true', 'Desktop: đọc được hội thoại đã tạo từ Web');
SELECT pg_temp.ok(pg_temp.err($$SELECT public.aka_agent_ai_chat(2, 1, 'nam', 'pw2', 'agents')$$) = 'desktop_staff_scope_denied', 'Desktop: token của nhân viên 1 không dùng cho nhân viên 2');
SELECT pg_temp.ok(pg_temp.err($$SELECT public.aka_agent_ai_chat(1, 1, 'ha', 'sai', 'agents')$$) = 'automation_auth_invalid', 'Desktop: sai mật khẩu');
SELECT pg_temp.ok(pg_temp.err($$SELECT public.aka_agent_control_ai_chat(1, 1, 'web', 'agents')$$) LIKE 'permission denied%', 'Desktop không gọi được RPC control');
SELECT pg_temp.ok(pg_temp.err('SELECT count(*) FROM public.ai_message_thread') LIKE 'permission denied%', 'Desktop không đọc thẳng bảng');
SELECT (public.aka_agent_ai_chat(1, 1, 'ha', 'pw1', 'open', jsonb_build_object('requestId', '00000000-0000-4000-8000-000000000021', 'projectId', :pid, 'campaignId', 33, 'question', 'Từ Desktop')) #>> '{thread,source}') AS dsrc \gset
SELECT pg_temp.ok(:'dsrc' = 'desktop', 'Desktop: mở hội thoại ghi nguồn desktop');
RESET ROLE;
SELECT set_config('request.jwt.claims', '', false) \gset jw2_

-- 17b. Đường của agent nội bộ (Edge Function ai-chat-agent): list chỉ xem → claim đúng một câu, vào thẳng 'đang tìm câu trả lời' → answer + complete.
SELECT m.id AS dmid, m.thread_id AS dtid FROM public.ai_message m WHERE m.question = 'Từ Desktop' \gset
SELECT revision AS drev FROM public.ai_message_thread WHERE id = :dtid \gset
SELECT pg_temp.worker('list', '{"limit":50}') AS ls \gset
SELECT pg_temp.ok(i ->> 'question' = 'Từ Desktop' AND i ->> 'status' = 'chờ câu trả lời' AND i #>> '{thread,campaignId}' = '33'
  AND i #>> '{thread,staffId}' = '1' AND i #>> '{project,code}' = 'hoi-dap-chien-dich' AND NOT i ? 'claimToken' AND i ? 'deadlineAt',
  'list: thấy câu đang chờ kèm chiến dịch, không kèm token')
  FROM jsonb_array_elements(:'ls'::jsonb -> 'items') i WHERE i ->> 'messageId' = :dmid::text;
SELECT pg_temp.ok((SELECT bool_and(i ->> 'status' = 'chờ câu trả lời') FROM jsonb_array_elements(:'ls'::jsonb -> 'items') i)
  AND (SELECT status = 'chờ câu trả lời' AND claim_token IS NULL FROM public.ai_message WHERE id = :dmid)
  AND (SELECT revision = :drev FROM public.ai_message_thread WHERE id = :dtid), 'list: chỉ trả câu đang chờ, không đổi trạng thái hay phiên bản');
SELECT pg_temp.ok(c -> 'items' = '[]'::jsonb, 'list: lọc projectCodes') FROM pg_temp.worker('list', '{"projectCodes":["khac"]}') c;
SELECT pg_temp.ok(pg_temp.err($$SELECT pg_temp.worker('claim', '{"workerId":"agent","messageId":"abc"}')$$) = 'ai_chat_invalid_request', 'claim: messageId sai dạng bị từ chối');
SELECT pg_temp.ok(c -> 'items' = '[]'::jsonb, 'claim: messageId không tồn tại thì không nhận câu khác') FROM pg_temp.worker('claim', '{"workerId":"agent","messageId":999999999}') c;
SELECT pg_temp.worker('claim', jsonb_build_object('workerId', 'agent', 'messageId', :dmid, 'stage', 'working', 'leaseSeconds', 900)) AS dc \gset
SELECT (:'dc'::jsonb #>> '{items,0,claimToken}') AS dtok \gset
SELECT pg_temp.ok(jsonb_array_length(c -> 'items') = 1 AND c #>> '{items,0,messageId}' = :dmid::text AND c #>> '{items,0,status}' = 'đang tìm câu trả lời'
  AND c #>> '{items,0,project,rules}' <> '' AND c #> '{items,0,project,outputSchema,required}' = '["tom_tat"]'::jsonb,
  'claim theo messageId: nhận đúng câu đó, vào thẳng đang tìm câu trả lời, kèm quy tắc + schema') FROM (SELECT :'dc'::jsonb c) x;
SELECT pg_temp.ok(m.status = 'đang tìm câu trả lời' AND m.started_at IS NOT NULL AND m.worker_id = 'agent' AND t.revision = :drev + 1
  AND t.last_message_status = 'đang tìm câu trả lời', 'claim theo messageId: app thấy trạng thái mới qua phiên bản')
  FROM public.ai_message m JOIN public.ai_message_thread t ON t.id = m.thread_id WHERE m.id = :dmid;
SELECT pg_temp.ok(c -> 'items' = '[]'::jsonb, 'claim theo messageId: câu đã có người nhận thì không nhận lần hai')
  FROM pg_temp.worker('claim', jsonb_build_object('workerId', 'agent-2', 'messageId', :dmid, 'stage', 'working')) c;
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(c -> 'items') i WHERE i ->> 'messageId' = :dmid::text), 'list: câu đang xử lý không còn trong danh sách')
  FROM pg_temp.worker('list', '{}') c;
SELECT pg_temp.worker('answer', jsonb_build_object('messageId', :dmid, 'claimToken', :'dtok', 'answer', 'Chiến dịch chạy lại lúc 14:00.',
  'answerJson', '{"tom_tat":"Chạy lại lúc 14:00."}'::jsonb, 'complete', true)) AS da \gset
SELECT pg_temp.ok(:'da'::jsonb ->> 'status' = 'hoàn thành' AND (:'da'::jsonb ->> 'answeredAt')::timestamptz = m.answered_at AND m.completed_at = m.answered_at
  AND m.answer = 'Chiến dịch chạy lại lúc 14:00.', 'answer + complete: trả về thời gian trả lời đã lưu') FROM public.ai_message m WHERE m.id = :dmid;

-- 18. Bất biến dữ liệu sau toàn bộ kịch bản.
SELECT pg_temp.ok(NOT EXISTS (
  SELECT 1 FROM public.ai_message_thread t
   WHERE t.message_count <> (SELECT count(*) FROM public.ai_message m WHERE m.thread_id = t.id)
      OR t.last_message_seq <> (SELECT max(m.seq) FROM public.ai_message m WHERE m.thread_id = t.id)
      OR t.last_message_status IS DISTINCT FROM (SELECT m.status FROM public.ai_message m WHERE m.thread_id = t.id AND m.seq = t.last_message_seq)
      OR t.revision <> (SELECT max(m.thread_rev) FROM public.ai_message m WHERE m.thread_id = t.id)),
  'bất biến: hội thoại khớp tin nhắn (số tin, tin cuối, trạng thái, phiên bản)');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.ai_message m WHERE m.status = 'hoàn thành' AND (m.answer IS NULL OR m.completed_at IS NULL OR m.claim_token IS NOT NULL)),
  'bất biến: câu hoàn thành luôn có câu trả lời và không còn token');
SELECT 'PASS';
