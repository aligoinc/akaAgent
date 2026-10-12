# Kiểm tra “Tại sao CD không chạy?”

Desktop chỉ hiện nút ở chiến dịch `chờ xử lý` chưa có note thật. Bấm nút gọi
`campaign:pending-reason` một lần, kiểm tra bằng logic và hiển thị kết quả bằng
chính `.campaign-note-line` hiện có; không dùng AI, không chạy thử chiến dịch.

Giữ nguyên phần bổ sung của note đã đề xuất khi sửa một câu trong note:
“Chưa có data đến giờ chạy. Data gần nhất được hẹn lúc {giờ, ngày}.”;
“Đã quá giờ dừng gửi {giờ}. Chiến dịch không nhận lượt mới trong hôm nay.”;
“Lịch chạy chưa hợp lệ. Vui lòng kiểm tra lại cài đặt lịch.”
Giờ data gần nhất lấy từ chính probe data tương lai, sắp theo `schedule ASC`
và `limit(1)`; không thêm lượt query riêng.

Note chẩn đoán nằm riêng trong RAM của giao diện, tối đa 5 phút kể từ khi nhận
kết quả. Hết hạn hiện lại nút, không đọc/ghi DB. Note thật luôn được ưu tiên;
khi xuất hiện sẽ hủy note tạm để nó không hiện lại sau khi note thật bị xóa.
Đổi trạng thái/cấu hình, logout/đổi staff hoặc đóng giao diện cũng loại kết quả
cũ. Không lưu note tạm vào `campaign.note`, localStorage hay sessionStorage.

## Luồng đọc

- IPC chỉ nhận main frame, ID hợp lệ và phiên đăng nhập hiện tại; gộp request
  cùng ID, tối đa 4 request và deadline 20 giây. Giao diện chỉ gửi một kiểm tra
  tại một thời điểm. Kết quả đến sau logout/đổi phiên bị bỏ.
- Repository dùng singleton Supabase HTTP hiện có, scope staff/org. Projection
  không lấy log, mật khẩu hoặc session; claim token chỉ chuyển thành boolean
  nội bộ, không trả renderer. Input data dùng probe tồn tại `limit(1)`.
- Kiểm tra quyền/hạn staff, account, chuẩn bị data, lịch bằng giờ DB, campaign
  khác đang chiếm account, cleanup/đăng nhập/quét data, trạng thái và readiness,
  workflow/nội dung nâng cao, giới hạn đồng thời/quota, data chưa đến giờ hoặc
  nguồn data chưa có dữ liệu. Trả nguyên nhân đầu tiên xác minh được.
- Chiến dịch local/legacy Server tái sử dụng preclaim **read-only** của scheduler.
  Với account Zalo Server cùng org và `isChatSync=true`, chẩn đoán theo akaChat:
  action catalog phải active/chưa xóa, không yêu cầu workflow Desktop; nhóm tài
  khoản chỉ có hiệu lực khi active/chưa xóa/cùng org; cửa sổ quota chỉ đếm detail
  có `counts_toward_limit=true`. Khi bật tiếp tục hành động khác, xét toàn bộ
  hành động được bật, kể cả hành động không bật kiểm tra quota; tìm SĐT chỉ là
  bước phụ, không đủ để kết luận còn hành động có thể chạy.
  Không sửa logic thực thi scheduler local/legacy Server (lỗi continuation cũ
  được hoãn riêng). Không tạo/reset quota, claim, khôi phục phiên hoặc sửa lịch/status.
  Không thêm polling, SQL pool, connection, migration hay reload schema.
- Danh sách input rỗng chưa đủ để kết luận lỗi: nhiều loại tự tạo data lúc chạy.
  Realtime chỉ báo chờ data khi còn trong hạn nhận. Mobile/Zalo Server không
  bị suy diễn là đã dừng từ trạng thái Desktop; nếu thiếu bằng chứng thì ghi
  chưa xác minh được trạng thái xử lý trên thiết bị/server.
- Đọc lại campaign trước khi trả; UI đối chiếu phiên bản và thời hạn trước khi
  hiển thị. Nếu note/status đã thay đổi, bỏ kết quả và làm mới theo luồng đọc
  danh sách hiện có. Lỗi kết nối trả câu chung, không lộ lỗi SQL/credential.

## Kiểm chứng

```bash
node scripts/campaign-pending-reason-smoke.cjs
node scripts/campaign-pending-reason-chat-smoke.cjs
node scripts/run-campaign-pending-reason-ui-smoke.cjs
npx tsc --noEmit -p tsconfig.node.json
npx tsc --noEmit -p tsconfig.web.json
npm run build
```

Smoke logic kiểm tra lịch/cutoff giờ DB, data, mobile/server, account bận,
quyền và race note/status/config; IPC kiểm tra frame/ID/auth, dedup, giới hạn
request/deadline và phản hồi cũ. Smoke Electron dùng CampaignPanel/hook/CSS
thật với IPC giả và chặn HTTP: kiểm tra label, phạm vi nút, style giống note
thật, TTL sau response, không ghi campaign note, ưu tiên/xóa note tạm khi có
note thật, phản hồi đến muộn và không có mutation/request lúc hết hạn.

Smoke akaChat chạy service và repository thật với HTTP client giả chỉ hỗ trợ
đọc: continuation hai chiều trên năm loại kết hợp, nhóm tắt/xóa/khác org, catalog
không có workflow, đếm true/false/NULL, package cap, ngày quota, lỗi/cancel và
phân tuyến akaChat so với local/legacy Server. Metadata nhóm lấy kèm request
account hiện có; trạng thái các action gom một lần và chỉ đếm quota được bật.

Ngày 12/10/2026 đã thử các projection/filter REST trên linked production
`cgjbsmqtfhqvttudyjzq` bằng staff/campaign ID không tồn tại: campaign, account
kèm group settings, action, busy campaign, input, find-data source, concurrency
count và workflow đều thành công. Chỉ đọc, không chạy campaign hoặc gửi tin.

Thay đổi mã nguồn Desktop; chưa đóng gói/phát hành installer.
