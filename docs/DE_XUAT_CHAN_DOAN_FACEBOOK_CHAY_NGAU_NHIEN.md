# Ba note chạy ngẫu nhiên Facebook đã duyệt

Ngày 14/10/2026, người dùng chốt triển khai đúng ba trường hợp dưới đây cho **Tại sao CD không chạy?** và **Chẩn đoán**. Nội dung này thay thế bản đề xuất phạm vi rộng trước đó.

| Trường hợp | Note |
|---|---|
| Bật chạy ngẫu nhiên nhưng cấu hình NULL | Tài khoản đang bật chạy ngẫu nhiên nhưng chưa có cấu hình. Vui lòng kiểm tra cài đặt chạy ngẫu nhiên. |
| Cấu hình không đúng định dạng hoặc quy tắc số lượng/đơn vị | Cấu hình chạy ngẫu nhiên chưa hợp lệ: **{lý do}**. |
| Cấu hình hợp lệ nhưng không chứa loại của chiến dịch | Loại chiến dịch **“{tên loại}”** chưa có trong cấu hình chạy ngẫu nhiên của tài khoản. |

## Hành vi

- Chỉ áp dụng với tài khoản Facebook bật chạy ngẫu nhiên. Tắt chế độ thì bỏ kiểm tra cấu hình cũ. Thiếu bằng chứng không được hiểu là đã tắt; dùng đường chưa xác minh/lỗi đọc hiện có.
- Giữ nguyên thứ tự và nội dung các note cũ về quyền, lịch, tài khoản bận, bộ chạy, quota, data. Nút pending reason chỉ xét ba note mới sau các điều kiện cũ; không thêm note đã chọn chiến dịch khác/chờ kế hoạch.
- Chẩn đoán kiểm tra được nhiều mục: chỉ thêm mục **Cấu hình chạy ngẫu nhiên** khi có vấn đề hoặc chưa xác minh. Mục này có nút mở form cấu hình hiện có, đúng tài khoản, không tự bật chế độ. Chiến dịch đang chạy/tạm dừng/hoàn thành chỉ nhận cảnh báo cấu hình cho lượt mới, không khẳng định cấu hình mới đã chặn đợt đang thực thi.
- Không xác nhận quyền/khả dụng của mọi loại khác trong tài khoản thành một điều kiện chặn toàn bộ cấu hình. Quyền và loại của chiến dịch vẫn do các kiểm tra cũ đảm nhiệm.
- Snapshot AI có kết quả kiểm tra và cấu hình đã chuẩn hóa; dùng prompt DB hiện tại, không thêm chỉ dẫn AI trong code. AI vẫn chỉ chạy khi bấm.
- Đọc `facebook_random_run_enabled` và `facebook_random_run_config` cùng request account hiện có, đúng staff/tenant và AbortSignal. Không gọi RPC plan/claim/finish, không tải lịch sử hay chọn thử chiến dịch.
- Kiểm tra lại account/config trước khi trả note hoặc snapshot, trước/sau phân tích AI; thay đổi config làm mới snapshot hoặc loại kết quả đến muộn. Hash snapshot bao gồm enabled và config, kể cả revision. Note UI tạm bị xóa khi account store hiện có nhận enabled/revision mới; không phát sinh polling/timer đọc mới.
- Sau lưu form, Chẩn đoán cập nhật và đánh dấu AI cũ; không tự gọi lại AI. Không ghi campaign.note, thay trạng thái/quota hay sửa luồng chạy.

## Kiểm chứng

- `node scripts/campaign-pending-reason-smoke.cjs`: ba note, cấu hình tắt/thiếu/sai, unit/quantity, dòng lặp/giới hạn 100, ưu tiên note cũ và cấu hình thay đổi giữa lượt đọc.
- `node scripts/campaign-pending-reason-chat-smoke.cjs`: hồi quy Zalo QR/legacy/akaChat, quyền nhóm, quota và cancel.
- `node scripts/campaign-diagnostics-smoke.cjs`: cùng nội dung note, mapper/projection/scope account, snapshot/AI và cấu hình thay đổi trước/trong AI; giữ hồi quy lịch, 65 phút, che thông tin nhạy cảm.
- `node scripts/run-campaign-pending-reason-ui-smoke.cjs`: xóa note tạm/phản hồi đang chờ khi cấu hình đổi, không tự request.
- `node scripts/run-campaign-diagnostics-ui-smoke.cjs`: nút mở đúng form, lưu cập nhật và đánh dấu AI cũ; giao diện sáng/tối 850/1024/1600 px.
- Hai typecheck và production build. API PostgREST live trên `cgjbsmqtfhqvttudyjzq` kiểm tra projection account mới với `id=-1,limit=0`, không lấy dữ liệu khách hàng.

Không migration, đổi prompt/model, thêm connection/pool hoặc polling. Desktop chưa đóng gói/phát hành.

## Sửa form cấu hình hỏng sau review

Form kiểm tra dữ liệu trước khi render: thiếu/sai `rules` tạo bản nháp trống có thông báo; dòng null hoặc sai kiểu giữ nguyên vị trí để chọn lại loại/chỉ tiêu, giữ các dòng hợp lệ và thứ tự. Đơn vị được xác định theo loại đã chọn; mọi sửa đổi vẫn cần bấm Lưu. Giữ revision đọc được để kiểm tra xung đột như trước; thiếu/sai revision hoặc phiên bản cấu trúc chưa hỗ trợ thì báo lỗi, khóa Lưu và cho Tải lại/Đóng. Không tự đặt revision về 0 cho cấu hình hỏng, không tự ghi hay bật chạy.

Smoke `AKA_RANDOM_UI_OUTPUT_DIR=/tmp/akaagent-random-config-repair node scripts/run-facebook-random-run-ui-smoke.cjs` tái hiện thiếu rules, dòng null/sai kiểu, sửa và lưu với revision gốc, giữ thứ tự/dòng lặp, xung đột, tải lại sai và phản hồi save sai định dạng. Giao diện vẫn mở được, không phát sinh lỗi render; form cài đặt bình thường và nút xử lý từ Chẩn đoán được kiểm tra hồi quy.
