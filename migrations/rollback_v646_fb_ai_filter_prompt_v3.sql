-- Gỡ V646: trả lời dặn người dùng của ai_prompt 75 về bản 2 (V640).
BEGIN;
SET LOCAL lock_timeout = '3s';
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

Trả về đúng khuôn:
{"matched": true hoặc false, "excluded": true hoặc false, "reason": "lý do ngắn bằng tiếng Việt, tối đa 25 từ"}$v646$ WHERE id = 75 AND md5(replace(prompt_user, chr(13), '')) = 'a872762a567a0b8ad907e2a185ed1ad6';
DO $post$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.ai_prompt WHERE id = 75 AND md5(prompt_user) = 'a9b2b67c84c04b937ed4c35e4517eb74') THEN RAISE EXCEPTION 'Gỡ V646: không về được bản 2'; END IF;
END $post$;
COMMIT;
