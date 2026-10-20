-- V418: rename the existing action and teach the existing image importer its UID input.
-- Live snapshot: migrations/snapshots/zalo-group-member-uid-v418/before.json.
-- Data only: no workflow/RPC/schema changes or PostgREST reload.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15s';
DO $migration$
DECLARE
  action_before jsonb;
  prompt_before jsonb;
BEGIN
  SELECT to_jsonb(a) INTO action_before FROM public.auto_campaign_actions a
  WHERE id = 'zalo_message_group_member' FOR UPDATE;
  SELECT to_jsonb(p) INTO prompt_before FROM public.ai_prompt p WHERE id = 12 FOR UPDATE;
  IF md5(action_before::text) IS DISTINCT FROM '3efc6d1a599bb6e96cfae379a0f04bbe' THEN
    RAISE EXCEPTION 'V418 action changed since snapshot';
  END IF;
  IF md5(prompt_before::text) IS DISTINCT FROM '24031cb581b97050e86e5aa945a98fc2' THEN
    RAISE EXCEPTION 'V418 image import prompt changed since snapshot';
  END IF;

  UPDATE public.auto_campaign_actions
  SET name = 'Zalo - Nhắn tin, kết bạn đến thành viên group/người lạ'
  WHERE id = 'zalo_message_group_member';
  UPDATE public.ai_prompt
  SET prompt_user = $prompt$Trích xuất danh sách dữ liệu từ ảnh.

Nền tảng: [platform]
Action ID: [actionId]

Quy tắc output:
- Nếu actionId = "zalo_message_group_member": trả về JSON array, mỗi item có thể có "name", "uid", "info1", "info2", "info3", "info4", "info5". Field bắt buộc là "uid": chuỗi chữ số UID Zalo, giữ nguyên từng chữ số, không chuyển thành số JSON hoặc SĐT.
- Với actionId khác "zalo_message_group_member", nếu platform = "zalo" hoặc "sms": trả về JSON array, mỗi item có thể có "name", "phone", "info1", "info2", "info3", "info4", "info5". Field bắt buộc là "phone".
- Nếu platform = "facebook": trả về JSON array, mỗi item có thể có "name", "uid". Field bắt buộc là "uid".
- Nếu platform = "email": trả về JSON array, mỗi item có thể có "name", "email". Field bắt buộc là "email".
- Không tự bịa dữ liệu không thấy rõ trong ảnh.
- Chuẩn JSON array duy nhất, ví dụ: [{"name":"Nguyễn Văn A","phone":"0912345678","info1":""}].$prompt$, updated_at = now()
  WHERE id = 12;

  IF (SELECT to_jsonb(a) - 'name' FROM public.auto_campaign_actions a WHERE id = 'zalo_message_group_member')
     IS DISTINCT FROM (action_before - 'name') THEN
    RAISE EXCEPTION 'V418 changed unrelated action fields';
  END IF;
  IF (SELECT to_jsonb(p) - ARRAY['prompt_user', 'updated_at'] FROM public.ai_prompt p WHERE id = 12)
     IS DISTINCT FROM (prompt_before - ARRAY['prompt_user', 'updated_at']) THEN
    RAISE EXCEPTION 'V418 changed unrelated prompt fields';
  END IF;
END
$migration$;
COMMIT;
