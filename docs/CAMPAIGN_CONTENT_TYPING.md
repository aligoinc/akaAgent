# Nhập nội dung chiến dịch — 03/11/2026

Phạm vi: ô nội dung chính (`formData.content`) trong form thường và form Agent,
gồm văn bản, HTML và bộ đếm SMS. Giữ StrictMode, React development, layout,
validation, API lưu, revision/CAS và route sửa/nhân bản hiện có.
Không đổi DB, prompt/model, dependency hoặc cấu hình dev để che độ trễ.

## Hợp đồng state

- `useCampaignContentFormData` giữ snapshot form dạng plain object, cập nhật
  bất biến và đồng bộ vào `draftValuesRef` ngay trong setter. Không debounce,
  không đợi blur hoặc timer để có dữ liệu mới nhất khi Lưu/Gửi.
- `CampaignContentObserver` đăng ký nội dung để chỉ render vùng Nội dung khi
  gõ. Form cha chỉ nhận snapshot mới khi trường khác thay đổi hoặc trạng thái
  có/rỗng của nội dung plain/HTML thay đổi; bộ đếm hoàn thành vẫn cập nhật ngay.
- View `formData` của form cha có getter chỉ cho `content`, đọc snapshot mới
  nhất. Vì callback Lưu/Preview/chèn token có thể được giữ từ render trước,
  không thay getter bằng giá trị content cũ. View này không được ghi vào payload:
  nháp, Agent snapshot và rollback sử dụng plain object canonical.
- Hàm updater nhận snapshot canonical mới nhất và chỉ chạy một lần. Các field
  khác vẫn thông báo form cha bình thường. Khi đọc nội dung để tạo UI theo ký tự,
  consumer phải nằm trong `CampaignContentObserver`; không tính trước rồi giữ
  giá trị trong closure của form cha. Bộ đếm SMS và context AI section làm theo
  quy tắc này. Biến thể nâng cao và các ô nội dung phụ giữ luồng state hiện tại.
- `useCampaignAgent` đăng ký thay đổi store để cập nhật revision ngay cả khi
  form cha không render. Lần sửa đầu làm mất hiệu lực highlight/Hoàn tác cần
  cập nhật UI; gõ tiếp không dựng lại form. Sửa rồi trả lại giá trị cũ vẫn là
  chỉnh sửa mới. Setter formData đăng ký với `restoreAgentValues` để undo và
  rollback khôi phục cùng nguồn state.
- Bảng data ở form thường cũng cache theo trang/dữ liệu và callback ổn định như
  form Agent, để lần đổi trạng thái rỗng/hoàn thành không dựng lại 100 dòng không
  đổi. Sửa/xóa dòng, chuyển trang và đổi cấu hình cột vẫn cập nhật bình thường.
- Popover AI vẫn reset/hủy theo nội dung mới. Thông báo idle không đổi không
  được kích hoạt render toàn form thường.

## Kiểm chứng và rollout

Xem [audit local](audits/campaign-content-typing/README.md). Smoke dùng Electron,
StrictMode, JSX dev và fixture IPC/stores; HTTP bị chặn. So sánh trước/sau cùng
source nền `5df2678f`, có/không 5.000 dòng data. Thời gian bao gồm automation,
không phải SLA cho máy khách. Không gọi AI/DB live hoặc tạo chiến dịch thật.

Source đang ở nhánh `codex/campaign-content-typing`; chưa merge/sync repo chính,
chưa đóng gói/phát hành. PR #578 trước đó đã merge/sync tại `9080a12d`, chỉ tối
ưu chat/data của form Agent; bản này bổ sung cô lập ô nội dung cho cả hai form.
