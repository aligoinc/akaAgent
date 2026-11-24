-- migration_v646_fb_ai_filter_prompt_v3: lời dặn người dùng của ai_prompt 75 (find_data_meaning_check_v2) sang bản 3 (scripts/fb-ai-filter/prompt-v3.user.txt).
-- Quy tắc giữ nguyên bản V640; AI ghi "khach_can_tim", "nguoi_viet", "reason" rồi mới "excluded" / "matched" (block đọc matched / reason, trường thêm được bỏ qua).
-- Kiểm thử đầu-cuối 24/11/2026 (scripts/fb-ai-filter/e2e): bài thật chấm tay đúng 89,7–89,8% so với 88,8–88,9% của bản 2, dữ liệu cố tình sai lệch 47/47.
-- Haiku 5.5 trả lời chậm hơn (trung vị 1,7 → 3,2 giây, số token trả lời gấp đôi). Chỉ dữ liệu, không DDL.
-- Sinh bằng scripts/fb-ai-filter/build-v646-sql.py, không sửa tay. Gỡ: rollback_v646_fb_ai_filter_prompt_v3.sql.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

DO $pre$
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL
     AND EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v646_%') THEN
    RAISE EXCEPTION 'V646: sổ migration đã có migration_v646_%%, không chạy lại';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ai_prompt WHERE id = 75 AND code = 'find_data_meaning_check_v2' AND md5(prompt_user) = 'a9b2b67c84c04b937ed4c35e4517eb74') THEN
    RAISE EXCEPTION 'V646: ai_prompt 75 khác bản V640 đã đọc (a9b2b67c84c04b937ed4c35e4517eb74)';
  END IF;
END $pre$;

UPDATE public.ai_prompt SET prompt_user = $v646$Mô tả của khách hàng (nguyên văn):
<mo_ta>
[prompt]
</mo_ta>

Loại nội dung: [entity_type] (post là bài viết, comment là bình luận)

Nội dung cần xét (chỉ có chữ, không có hình ảnh):
<noi_dung>
[content]
</noi_dung>

Cách xét:
1. Đọc cả mô tả như lời dặn của một người. Không coi mỗi dòng là một điều kiện riêng mà chỉ cần khớp một dòng.
2. Tách mô tả thành hai phần: điều khách cần tìm, và điều khách muốn loại bỏ (các câu như "Loại bỏ", "KHÔNG", "không lấy", "trừ", "ngoại trừ", "điều kiện loại trừ"). Các câu hướng dẫn chung như "ưu tiên", "phân tích cả hình ảnh" không phải điều kiện riêng.
3. Xét ý định thật của người viết nội dung, không chỉ xem có trùng chữ. Mô tả người cần mua hoặc cần thuê thì nội dung của người bán, người cho thuê hoặc môi giới là không đúng, trừ khi mô tả nói muốn lấy cả những người đó.
4. Mô tả chỉ là danh sách từ khoá hoặc chủ đề thì chọn nội dung nói về chủ đề đó.
5. Chọn khi nội dung thuộc điều khách cần tìm và không dính điều khách muốn loại bỏ.
6. Nội dung trống, chỉ có tên nhóm, ngày giờ, hoặc không đủ chữ để biết thì không chọn. Không đoán nội dung của hình ảnh.

Trả về đúng khuôn, viết các trường theo đúng thứ tự này:
{"khach_can_tim": "khách muốn tìm ai, tối đa 12 từ", "nguoi_viet": "người viết nội dung là ai và đang muốn gì, tối đa 15 từ", "reason": "lý do ngắn bằng tiếng Việt, tối đa 25 từ", "excluded": true hoặc false, "matched": true hoặc false}$v646$ WHERE id = 75 AND md5(prompt_user) = 'a9b2b67c84c04b937ed4c35e4517eb74';

DO $post$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.ai_prompt WHERE id = 75 AND md5(replace(prompt_user, chr(13), '')) = 'a872762a567a0b8ad907e2a185ed1ad6') THEN
    RAISE EXCEPTION 'V646: lời dặn sau khi ghi không ra md5 a872762a567a0b8ad907e2a185ed1ad6';
  END IF;
END $post$;

COMMIT;
