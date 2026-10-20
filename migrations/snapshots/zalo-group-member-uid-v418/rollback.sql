-- V418 rollback: run in a transaction; revert only the two captured rows.
DO $rollback$
BEGIN
  PERFORM 1 FROM public.auto_campaign_actions WHERE id='zalo_message_group_member' FOR UPDATE;
  PERFORM 1 FROM public.ai_prompt WHERE id=12 FOR UPDATE;
  IF (SELECT md5(to_jsonb(a)::text) FROM public.auto_campaign_actions a WHERE id='zalo_message_group_member') IS DISTINCT FROM 'ae56598334d5bbd49da6cd34fbd27a9f'
    OR (SELECT md5(to_jsonb(p)::text) FROM public.ai_prompt p WHERE id=12) IS DISTINCT FROM 'ec662b547a0802e94dadc459c0294576' THEN
    RAISE EXCEPTION 'V418 rollback refused: live rows changed';
  END IF;
  UPDATE public.auto_campaign_actions SET name = $oldname$Zalo - Nhắn tin, kết bạn đến thành viên group$oldname$ WHERE id='zalo_message_group_member';
  UPDATE public.ai_prompt SET prompt_user = $oldprompt$Trích xuất danh sách dữ liệu từ ảnh.

Nền tảng: [platform]
Action ID: [actionId]

Quy tắc output:
- Nếu platform = "zalo" hoặc "sms": trả về JSON array, mỗi item có thể có "name", "phone", "info1", "info2", "info3", "info4", "info5". Field bắt buộc là "phone".
- Nếu platform = "facebook": trả về JSON array, mỗi item có thể có "name", "uid". Field bắt buộc là "uid".
- Nếu platform = "email": trả về JSON array, mỗi item có thể có "name", "email". Field bắt buộc là "email".
- Không tự bịa dữ liệu không thấy rõ trong ảnh.
- Chuẩn JSON array duy nhất, ví dụ: [{"name":"Nguyễn Văn A","phone":"0912345678","info1":""}].$oldprompt$,
    updated_at = '2026-07-02T11:48:38.259256+00:00'::timestamptz WHERE id=12;
  IF (SELECT md5(to_jsonb(a)::text) FROM public.auto_campaign_actions a WHERE id='zalo_message_group_member') <> '3efc6d1a599bb6e96cfae379a0f04bbe'
    OR (SELECT md5(to_jsonb(p)::text) FROM public.ai_prompt p WHERE id=12) <> '24031cb581b97050e86e5aa945a98fc2' THEN
    RAISE EXCEPTION 'V418 rollback did not restore snapshot';
  END IF;
END
$rollback$;
