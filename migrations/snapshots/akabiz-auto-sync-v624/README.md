# V624 — Đồng bộ akaBiz Auto khi akaBiz Auto vẫn đổi data giữa lượt

**Trạng thái (22/11/2026): CHƯA apply.** Tìm ra bằng giả lập đồng bộ trên SQLite như khách thật (người dùng yêu cầu 22/11/2026,
akaAgentWebApp `scripts/akabiz-auto-sync-sim/`).

Lỗi của V623 (đang chạy trên akachat): akaBiz Auto vẫn chạy trong lúc đồng bộ (quyết định giữ nguyên chiến dịch nguồn). Khi số data của
một chiến dịch đổi giữa lượt (khách thêm data, chiến dịch tự nạp bạn bè / thành viên, xoá data), `inputs` báo `SOURCE_CHANGED`, và
mọi lần đồng bộ lại đều báo lại (bản chép ẩn giữ số dòng cũ) → chiến dịch không bao giờ chép được. Giả lập: 1–2 chiến dịch mỗi lượt.

V624 chỉ thay thân `public.akabiz_import_auto_desktop_v1(jsonb)` (md5 `pg_get_functiondef` `f4ae76455879213d60526bc6cc20a805` →
`3eae19a9366ba749a66ae7be6593479a`), không đổi bảng, quyền, dữ liệu:

1. `inputs` không còn báo `SOURCE_CHANGED` khi đã đọc nhiều dòng hơn lúc dựng bản chép.
2. `publish` nhận `payload.after_id` (bên đọc đã đọc hết tới con trỏ này) và so với con trỏ máy chủ; thiếu `after_id` thì so số dòng như V623.
3. `campaign` gọi lại cho bản chép còn ẩn: ghi số dòng mới; loại chiến dịch / tài khoản nguồn đổi thì bỏ dòng của bản ẩn cũ, dựng bản chép mới.

Sinh bằng `python3 scripts/build-v624-sql.py 3eae19a9366ba749a66ae7be6593479a`. Gỡ: `rollback_v624_akabiz_auto_sync_live_source.sql`
(đặt lại thân V623). Kiểm: akaAgentWebApp `AKA_AGENT_REPO=… sh scripts/test-akabiz-auto-sync-sql.sh` (chạy bằng user không phải root:
V623 47 kiểm + V624 apply một lần, smoke 17 kiểm, gỡ rồi apply lại).

Tương thích: API / Desktop / akaBiz Auto bản mới chạy đúng trên cả V623 (chưa apply V624) lẫn V624 (`SKIP_V624=1` chạy bài kiểm trên V623).
Thứ tự đề xuất: apply V624 trước khi deploy API (lúc đó chưa có ai gọi hàm, PostgREST nạp lại schema một lần).
