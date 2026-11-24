#!/usr/bin/env python3
"""Sinh V646: thay lời dặn người dùng của ai_prompt 75 (find_data_meaning_check_v2, dùng chung cho 5 mã lọc _v2 và mã dự phòng)
bằng scripts/fb-ai-filter/prompt-v3.user.txt. Quy tắc giữ nguyên bản V640; chỉ đổi khuôn trả lời: AI ghi "khách cần tìm ai", "người viết là ai",
lý do, rồi mới tới excluded / matched. Kiểm thử đầu-cuối 24/11/2026 (scripts/fb-ai-filter/e2e, hai vòng 5 và 6): bài thật chấm tay đúng 89,7–89,8%
so với 88,8–88,9% (chọn đúng 89,7–89,9% so với 83,6–83,9%, bắt đủ 77,7–78,1% so với 82,1–82,5%), dữ liệu cố tình sai lệch 47/47.
Chạy: python3 scripts/fb-ai-filter/build-v646-sql.py"""
import hashlib, os
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
v2 = open(os.path.join(ROOT, 'scripts/fb-ai-filter/prompt-v2.user.txt'), encoding='utf-8').read().strip()
v3 = open(os.path.join(ROOT, 'scripts/fb-ai-filter/prompt-v3.user.txt'), encoding='utf-8').read().strip()
m2, m3 = hashlib.md5(v2.encode()).hexdigest(), hashlib.md5(v3.encode()).hexdigest()
assert '$v646$' not in v2 + v3
head = """-- migration_v646_fb_ai_filter_prompt_v3: lời dặn người dùng của ai_prompt 75 (find_data_meaning_check_v2) sang bản 3 (scripts/fb-ai-filter/prompt-v3.user.txt).
-- Quy tắc giữ nguyên bản V640; AI ghi "khach_can_tim", "nguoi_viet", "reason" rồi mới "excluded" / "matched" (block đọc matched / reason, trường thêm được bỏ qua).
-- Kiểm thử đầu-cuối 24/11/2026 (scripts/fb-ai-filter/e2e): bài thật chấm tay đúng 89,7–89,8% so với 88,8–88,9% của bản 2, dữ liệu cố tình sai lệch 47/47.
-- Haiku 5.5 trả lời chậm hơn (trung vị 1,7 → 3,2 giây, số token trả lời gấp đôi). Chỉ dữ liệu, không DDL.
-- Sinh bằng scripts/fb-ai-filter/build-v646-sql.py, không sửa tay. Gỡ: rollback_v646_fb_ai_filter_prompt_v3.sql.
"""
sql = head + f"""BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

DO $pre$
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL
     AND EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v646_%') THEN
    RAISE EXCEPTION 'V646: sổ migration đã có migration_v646_%%, không chạy lại';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ai_prompt WHERE id = 75 AND code = 'find_data_meaning_check_v2' AND md5(prompt_user) = '{m2}') THEN
    RAISE EXCEPTION 'V646: ai_prompt 75 khác bản V640 đã đọc ({m2})';
  END IF;
END $pre$;

UPDATE public.ai_prompt SET prompt_user = $v646${v3}$v646$ WHERE id = 75 AND md5(prompt_user) = '{m2}';

DO $post$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.ai_prompt WHERE id = 75 AND md5(replace(prompt_user, chr(13), '')) = '{m3}') THEN
    RAISE EXCEPTION 'V646: lời dặn sau khi ghi không ra md5 {m3}';
  END IF;
END $post$;

COMMIT;
"""
rb = f"""-- Gỡ V646: trả lời dặn người dùng của ai_prompt 75 về bản 2 (V640).
BEGIN;
SET LOCAL lock_timeout = '3s';
UPDATE public.ai_prompt SET prompt_user = $v646${v2}$v646$ WHERE id = 75 AND md5(replace(prompt_user, chr(13), '')) = '{m3}';
DO $post$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.ai_prompt WHERE id = 75 AND md5(prompt_user) = '{m2}') THEN RAISE EXCEPTION 'Gỡ V646: không về được bản 2'; END IF;
END $post$;
COMMIT;
"""
open(os.path.join(ROOT, 'migrations/migration_v646_fb_ai_filter_prompt_v3.sql'), 'w', encoding='utf-8', newline='\n').write(sql)
open(os.path.join(ROOT, 'migrations/rollback_v646_fb_ai_filter_prompt_v3.sql'), 'w', encoding='utf-8', newline='\n').write(rb)
print('v2', m2, 'v3', m3)
