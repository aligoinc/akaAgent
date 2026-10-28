# Timeout media chiến dịch

> Chuyển từ AGENTS.md ngày 28/10/2026, dòng 982–1005. Nội dung và ràng buộc được giữ; chỉ sửa đường dẫn Markdown.
> Trạng thái “đã/chưa apply/deploy/phát hành” bên dưới là lịch sử. Đối chiếu [CURRENT_STATE](../CURRENT_STATE.md), audit mới nhất và live trước mọi thao tác. Không coi ghi chú quyền cũ là cho phép mở lại quyền.

<!-- BEGIN PRESERVED SOURCE -->
## Campaign media timeout — Desktop và App Zalo Server

Campaign gửi media qua `ZaloRuntimeService` dùng `CampaignMediaExecution` để hủy HTTP,
gỡ `uploadCallbacks` và chặn request muộn trong cùng chuỗi SDK trước khi trả
`campaign_media_timeout`. Giữ deadline hiện có (ảnh 90 giây, tệp cần callback
180 giây), proxy fetch và listener khỏe; chỉ bật scope ở scheduler campaign.
Gửi thủ công, text-only và Zalo Web giữ đường cũ. Không khẳng định tin chưa tới
Zalo; input timeout luôn terminal, không retry dù policy không tạo detail.
`stopRemainingActions` chỉ bỏ các helper Zalo còn lại của input; không thay ngưỡng
hay tạo counter mới. Timeout sau rich text vẫn tính theo policy hiện có.
Share ghi/đếm timeout ngay sau từng lệnh, reset thành công theo thứ tự gửi và dừng
trước người tiếp theo khi policy/`err_undefined` đủ ngưỡng. Không forward chữ sau
stop, không đếm lại/reset lại ở tổng kết, người chưa bắt đầu giữ pending. Các lỗi
share khác giữ policy batch cũ. Chốt riêng quyết định dừng ở vòng media: tổng kết
chỉ ghi các lỗi trước đó, không áp policy/đếm thêm làm ghi đè trạng thái và lý do
dừng. Policy dừng được chọn ở tổng kết batch thường vẫn giữ cách đếm cũ.
Reset trước đếm phải được xác nhận; lỗi DB bàn giao
cleanup với token cũ. Session bị thay/hủy khi đang gửi trả unknown, không retry.
Ngữ cảnh media dùng chung một ALS; mỗi owner/lượt gửi vẫn có scope và abort riêng.
Callback chỉ phục hồi scope của owner đó, giữ các owner khác tại lúc gọi callback.
Smoke offline: `node scripts/campaign-media-timeout-smoke-test.cjs`; xem
[phạm vi và kiểm chứng](../../../docs/CAMPAIGN_MEDIA_TIMEOUT.md). Không migration, pool,
worker hay connection mới; không gửi Zalo thật trong test. Chưa phát hành installer.


<!-- END PRESERVED SOURCE -->
