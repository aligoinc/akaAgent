CREATE OR REPLACE FUNCTION private.aka_agent_ai_assistant_item(m ai_message)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
  SELECT jsonb_build_object(
    'id', m.id, 'kind', CASE WHEN m.brief IS NOT NULL THEN 'work' ELSE 'turn' END, 'threadId', m.thread_id, 'requestId', m.request_id,
    'question', m.question,
    'answer', CASE WHEN m.status = 'hoàn thành' THEN m.answer END,
    'answerJson', CASE WHEN m.status = 'hoàn thành' THEN m.answer_json END,
    'status', m.status,
    'progressNote', CASE WHEN m.status IN ('đang lấy thông tin câu hỏi', 'đang tìm câu trả lời', 'đã có câu trả lời') THEN m.progress_note END,
    'askedAt', m.asked_at, 'startedAt', m.started_at, 'completedAt', m.completed_at, 'deadlineAt', m.deadline_at, 'updatedAt', m.updated_at,
    'errorCode', m.error_code, 'errorMessage', m.error_message, 'rating', m.rating,
    'sourceMessageId', m.source_message_id, 'scheduleId', m.schedule_id, 'brief', m.brief,
    'review', CASE WHEN m.status = 'hoàn thành' THEN m.review END, 'reviseCount', m.revise_count,
    'images', CASE WHEN m.brief ? 'image' THEN coalesce(private.aka_agent_ai_assistant_images(m.id), '[]'::jsonb) ELSE '[]'::jsonb END,
    'attachments', coalesce(m.attachments, '[]'::jsonb))
$function$
