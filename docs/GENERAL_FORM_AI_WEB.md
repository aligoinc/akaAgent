# AI Cài đặt chung trên Web — 24/10/2026

Đã port AI Cài đặt chung sang Zalo Server/SMS/Gọi tự động đang có trên Web. Dùng lại config 14, Sol 6.1 ID 21, prompt/schema/options V429 nguyên vẹn. Chỉ đổi tên/chọn tài khoản chính, giữ phụ, khóa tài khoản theo nhóm data và từ chối Page. Code API/UI nằm ở akaAgentWebApp; Desktop runtime không đổi. Web/API đã deploy lúc **01:01:55 VN ngày 24/10/2026**.

## Apply và bảo toàn

Canonical [20261023173046_campaign_general_ai_web.sql](../migrations/20261023173046_campaign_general_ai_web.sql) tạo bằng Supabase CLI rồi chuyển về thư mục migrations theo quy ước repo. Đã apply akachat `cgjbsmqtfhqvttudyjzq` lúc **00:44 VN ngày 24/10/2026**:
`20261023174411 / campaign_general_ai_web`. **Không apply lại.**

Transaction khóa/so checksum config theo code `app_facebook_form_general`, chỉ đặt `web_section_id='campaign.facebook.general'` và để trigger updated_at hiện có chạy. Không DDL/function/RPC/RLS, sửa prompt/schema/model/scope hay thêm connection.

| MD5 PostgreSQL | Giá trị |
|---|---|
| Hàng trước, bỏ updated_at | `1e7c3783de9f65165548bf1bdc7e2ebe` |
| Hàng sau, bỏ updated_at | `8fca42886abc4b29b5d76271d13fb0b6` |
| Phần giữ nguyên, bỏ web_section_id/updated_at | `957185f8ca4a46a6226c6e98e8ae21ef` |
| prompt_system | `09c2d19b3c2013fe67171c86460924e7` |
| prompt_user | `e74dcd6c0a4a6dc635b1f82acf32ee4c` |
| output_schema | `843499cdd0558a329aa315d9dd14085b` |

Chín config khác giữ toàn bộ checksum; Nội dung tiếp tục Haiku 24. Chứng cứ ở [general-form-ai-web](../migrations/snapshots/general-form-ai-web): before-config/checksums, after-checksums, verification và HTTP receipt.

## Kiểm chứng

- `verify-before.sql`: forward/checksum/rollback, cố ý sửa nguồn để migration từ chối, cố ý sửa cấu hình sau migration để rollback từ chối; tất cả rollback transaction, nguồn không đổi.
- Sau apply kiểm tra history/checksum cả 10 config và rollback thử trong transaction, ROLLBACK giữ binding Web.
- `node scripts/campaign-general-ai-http-smoke.cjs`: HTTP anon config nguyên văn, metadata Desktop/Web, model/schema/template/options và Desktop/Mobile binding; đọc account ID -1, không đọc dữ liệu thật. Receipt V429 lịch sử được giữ, lần mới ghi riêng general-form-ai-web.
- Web: 54 API + 8 UI unit mới, 18 browser Desktop/Android/iPhone (gồm hồi quy bốn section cũ), 5/5 Sol thật với account nhân tạo và log RAM, typecheck 7 workspace/build đạt.
- Unit tổng 2.721 ca: 2.720 đạt, một test danh sách nháp timeout trong lượt tổng; rerun nguyên file đạt 66/66, không đổi code/test danh sách. Form 122/122 đạt.
- Không đổi source Desktop. Khi chuẩn bị PR, hai typecheck và production build Electron đều đạt trên nền dev_3 mới nhất (9.0.0). Không gửi Zalo/SMS, tạo chiến dịch hay log production trong test provider.

Chi tiết hợp đồng Web, lệnh và receipt provider: [GENERAL_FORM_AI_WEB.md của WebApp](https://github.com/aligoinc/akaAgentWebApp/blob/dev/docs/GENERAL_FORM_AI_WEB.md).

## Deploy Web/API

Đã deploy source `168ba3b014e7c9a65d4e3ebcc4dc0e6d22da6a0c` lên https://agent.akabiz.net lúc 01:01:55 VN ngày 24/10/2026. Image `web-general-ai-168ba3b-20261024`, digest `sha256:bfa517995b0fcac26fae7f480a1fdc2a5958b8d7ba457980f06efca3580c660a`. Chỉ đổi image trên machine `48ee749f357398`, giữ một shared CPU/512 MB; health 1/1, 20 HTTP và bảy checksum runtime đạt. 18 browser production đạt trên Desktop/Android/iPhone với API/WS nghiệp vụ giả lập; không ghi chiến dịch thật.

Không apply lại migration hoặc phát hành Desktop trong lượt deploy. [Biên bản deploy, image rollback và phạm vi kiểm chứng](https://github.com/aligoinc/akaAgentWebApp/blob/dev/docs/GENERAL_FORM_AI_WEB_DEPLOY_20261024.md). Evidence riêng tư: `/Users/lequangnhut/.codex/deployments/general-ai-web-20261024-8ney3xjm`.

## Rollback

Ứng dụng cũ bỏ qua slot Web chưa biết; có thể rollback app mà giữ DB. Nếu muốn tháo binding Web dùng [rollback.sql](../migrations/snapshots/general-form-ai-web/rollback.sql), guard checksum rồi chỉ trả web_section_id về NULL. Không xóa config/log/history.

Rollback V429 về V428 phải tháo binding Web trước; rollback V429 có guard phần giữ nguyên bao gồm binding. Không chạy lại `verify-before.sql` trên trạng thái đã apply. [verify-after.sql](../migrations/snapshots/general-form-ai-web/verify-after.sql) chỉ diễn tập rollback rồi ROLLBACK, không đổi trạng thái production.

## Finding review được chấp nhận — 24/10/2026

Người dùng yêu cầu giữ nguyên, không sửa hai race với gợi ý tên tự động: Web có thể đóng popover và xóa mô tả AI chưa gửi khi tên tự động trả về; Desktop giữ mô tả nhưng có thể hủy yêu cầu General đang chờ và bỏ kết quả. Đã tái hiện bằng Playwright/Electron. Các finding này không được sửa trong PR/deploy hiện tại.
