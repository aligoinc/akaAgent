# Cá nhân hoá từ chối nhận tin

`#{STOP_MESSAGES_LINK}` được chèn bằng nút **Từ chối nhận tin** trong mục Khách hàng. Nút chèn cả `Từ chối nhận tin: #{STOP_MESSAGES_LINK}` tại con trỏ; riêng form chiến dịch bật checkbox hiện có. Nhập/dán biến, lấy mẫu, mở chiến dịch và nháp không tự bật checkbox.

Kiểm tra lưu dùng toàn bộ nguồn nội dung đang hoạt động: cơ bản gồm mọi biến thể/nhánh spin, nâng cao gồm mọi mục, nhóm dùng chính snapshot cuối sẽ lưu. Nháp thuần và mẫu độc lập vẫn lưu được khi chưa hoàn chỉnh. API Web kiểm tra lại trước khi tạo/cập nhật campaign.

Runtime giữ nguyên kiểm tra từ chối, account/campaign, quota và bước tìm SĐT. Chọn nội dung và spin một lần, cá nhân hoá, rồi mới nối footer và gọi AI như trước. Có biến thì thay tại chỗ; thiếu global ID hoặc lỗi prepare thì dùng `https://b.akabiz.biz/s/error`. Không có biến thì chỉ tự nối footer khi checkbox bật và tạo được link riêng. `trimEnd()` chỉ dùng khi tự nối; footer cách thân tin đúng `\n\n`. Rich text thay biến trước khi tính style, cắt style theo phần thân sau trim, footer thường và không chạy AI.

Link mới biểu diễn đầy đủ UUID hiện hữu bằng Base64url không padding, dài 22 ký tự. Không tạo bảng, cột, index, RPC hoặc migration. `/s/:token` giải mã canonical rồi dùng cùng API inspect/confirm như `/zalo-message-opt-out/:id`. GET chỉ xem trạng thái; người nhận bấm xác nhận mới ghi qua RPC hiện tại. `/s/error` chỉ hiển thị thông báo, không gọi API. Cả hai đường dẫn cũ/mới đều công khai, noindex và ngoài cache điều hướng PWA. Handler đặt no-store nhưng `sendFile()` hiện ghi đè header HTML; lỗi cache kế thừa này được giữ ngoài phạm vi theo quyết định review, xem biên bản deploy.

## Thứ tự phát hành

1. Đưa các route công khai WebApp lên trước, xác minh `b.akabiz.biz` trỏ cùng ứng dụng và có HTTPS. Giữ nguyên DNS/HTTPS `agent.akabiz.net` và route UUID cũ. Khi tách đợt phát hành, đợt đầu chỉ đưa phần route, codec và bootstrap/cache, chưa đưa nút chèn biến.
2. Cập nhật runtime Chat system-worker và App Server để hiểu biến mới và link ngắn. Xác minh bằng mock, không gửi Zalo thật.
3. Phát hành giao diện Web chèn biến và kiểm tra lưu. Desktop phải phát hành UI/runtime cùng phiên bản. Máy thực thi campaign chứa biến mới phải được cập nhật.

Ngày 13/09/2026 đã phát hành route công khai WebApp (release 54), Chat system-worker (release 149), rồi giao diện/API WebApp (release 55). DNS/HTTPS hiện hữu của hai domain được giữ nguyên. Desktop và App Server chưa phát hành binary trong đợt này. Chi tiết: [biên bản deploy](ZALO_MESSAGE_OPT_OUT_DEPLOY_20260913.md).

WebApp tiếp tục phát hành release 56 để bỏ cuộn thừa trong bảng cá nhân hoá và release 57 để tách state tiến trình khỏi form. Desktop có cùng bản sửa UI trong mã nguồn: giữ form/editor khi lưu hoặc báo lỗi, khóa thao tác bằng `inert`, cập nhật phần trăm/số dòng chỉ render lại `CampaignSaveControls`.

## Kiểm chứng

- Desktop: `node scripts/zalo-message-opt-out-smoke-test.cjs`, `node scripts/zalo-phone-input-identity-smoke-test.cjs`, hai typecheck và `npm run build`.
- WebApp: `npm run typecheck`, `npm test`, `npm run build`; Playwright `zalo-message-opt-out.spec.ts` và case `stop-message` trong `control.spec.ts` trên desktop, Android và iPhone.
- Chat API: `npm run typecheck`, `npm test`, `npm run build`. Test executor bao phủ link dự phòng, AI, rich text, khách đã từ chối và ghi nhận bước tìm SĐT.

Module thuần `zaloMessageOptOut.ts` ở ba repo phải giữ cùng contract; unit test có vector UUID cố định, round-trip ngẫu nhiên và token không canonical.
