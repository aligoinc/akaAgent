# Kiểm thử trung tâm thông báo bằng dữ liệu lịch sử thật — 05/11/2026

Phát lại 3 ngày lịch sử thật (thứ Hai 02/11 00:00 → thứ Năm 05/11 00:00 giờ Việt Nam) qua đúng mã trung tâm thông báo đang chạy
production, tìm lỗi/ngoại lệ, sửa rồi phát lại tới khi sạch. Không ghi gì lên production; mọi truy vấn production đều chỉ đọc.

## Cách làm

- **Mã đang chạy**: 38 hàm V457/V458 trên akachat trùng md5 từng hàm với bản build từ repo (kiểm lại sau khi V462–V464 được apply chiều
  05/11: md5 tổng `5ebbe5bc60a934b8678f287375258897` không đổi). Trigger thông báo bật, trigger email cũ tắt.
- **Cluster local**: PostgreSQL 17 dùng một lần, `scripts/notification-center/setup.sql` (nay có thêm cột `details`/`login_status` của
  `auto_account_logs` và index `idx_auto_campaign_details_automation_status` như production) + V457 + V458. Đồng hồ điều khiển bằng
  libfaketime chế độ độ lệch (`FAKETIME_TIMESTAMP_FILE`, `FAKETIME_NO_CACHE=1`, `FAKETIME_DONT_FAKE_MONOTONIC=1`): nhảy tới thời điểm
  từng sự kiện mà `pg_sleep`/timeout vẫn đúng. Chế độ "đóng băng" làm `pg_sleep` treo vô hạn, không dùng.
- **Dữ liệu**: chuỗi chuyển trạng thái lấy từ `auto_account_logs` (`campaign` có trạng thái trước/sau, `login`/`logout`/`login_status_changed`
  có `details.reason`), cửa sổ id `[4359935, 4826082)`. 36 nhân viên (17 người đang đăng ký thật, nhóm nặng tạm dừng/hoàn thành, nhóm đăng
  xuất nhiều, vài người bình thường): 923 thực thể, 2.354 sự kiện, kéo dạng nén và đối chiếu md5 3 lần khớp tuyệt đối. Tên chiến dịch/tài
  khoản thay bằng nhãn tổng hợp; dữ liệu khách chỉ nằm trong scratchpad phiên, không commit.
- **Worker thật**: driver gọi `NotificationWorker` của WebApp (render, email/push giả ghi lại nội dung), RPC map sang PG local với role
  `service_role`; UPDATE của từng sự kiện chạy dưới role đúng nguồn (Desktop có JWT, Zalo Server = `service_role`, chat = `aka_agent_chat_api`).
  Tick 30 giây gọi `aka_agent_data_group_background_tick()` như cron 66.
- Kịch bản **live** (đăng ký đúng như production) và **all** (36 nhân viên bật mặc định: chiến dịch Hoàn thành + Tạm dừng, tài khoản
  đăng nhập/đăng xuất/checkpoint, báo cáo 18:00, email + push).

## Lỗi tìm được

| # | Loại | Mô tả | Bằng chứng |
|---|---|---|---|
| F1 | Hiệu năng (chặn gửi) | `snapshot('campaign')` đếm kết quả bằng heap: chiến dịch ~60 nghìn dòng mất 36,8s (47 nghìn block đọc đĩa). Qua PostgREST bị `57014` ở 8s → render thử lại 5 lần rồi `failed`: thông báo **không bao giờ gửi** | EXPLAIN ANALYZE production campaign 11980 |
| F2 | Thiết kế (ngập thông báo) | Gộp chỉ khi ≥5 trong 2 phút; cooldown theo từng chiến dịch không chặn được nhiều chiến dịch rải rác | all: 1.690 email/3 ngày, staff 385 156 email/ngày, 58 email/giờ, 14 ngày-nhân-viên ≥50 email |
| F3 | Nội dung | "Lý do" của thông báo tài khoản lấy dòng log bất kỳ ±2 phút và giá trị phiên chat hiện tại (cũ tới ~25 ngày) | 3 ngày: đăng nhập → "Đã giải phóng tài khoản sau thao tác runtime…" 326 lần, lỗi gửi tin cho khách; đăng xuất → "Đã giải phóng runtime…" 115, tự lặp "Trạng thái đăng nhập: …", "request to … ETIMEDOUT 14.x.x.x" (lộ IP); 38/221 tài khoản đang đăng nhập còn lý do ngắt cũ |
| F4 | Nội dung | Ghi chú tạm dừng đưa nguyên chuỗi kỹ thuật vào email/push và mục "Vấn đề" của báo cáo | "waitForSelector timeout: //*[@role='dialog']…" (XPath), "output_invalid:zalo_find_phone_user:write:TypeError: fetch failed" |
| F5 | Nội dung | Thông báo **đăng nhập** ghi "N chiến dịch bị ảnh hưởng" | phát lại |
| F6 | Sai số liệu | Báo cáo đếm tài khoản SMS là "đăng xuất": 1.924/1.924 tài khoản SMS luôn `login_status='chưa đăng nhập'` (trạng thái thật là `mobile_device_id`); SMS có chiến dịch sinh cảnh báo "Nghiêm trọng" giả | email thật 18:00 05/11: tài khoản SMS mặc định (tên là số điện thoại) bị liệt kê "Đang đăng xuất" ở nhiều báo cáo |
| F7 | Nội dung | "Chi tiết chiến dịch hôm nay" của người nặng toàn chiến dịch tạm dừng 0/0/0 | phát lại |
| F8 | Lãng phí | Báo cáo vẫn được tạo/render hằng ngày cho nhân viên đã ngừng (chỉ bỏ email) | staff 5 |
| F9 | Thiếu trần | Email không có trần/giờ (push có 60/giờ) | đi kèm F2 |

Không có ngoại lệ nào trong 2.354 lượt UPDATE có trigger (p95 4,6 ms), không mất dữ liệu, không có bản ghi thiếu tổ chức có thể làm
hỏng UPDATE của khách (đếm production = 0).

## Sửa

- **akaAgent V465** (`migrations/migration_v465_notification_quality.sql`, CANDIDATE, chưa apply): sinh từ đúng thân hàm V457, chỉ thay 5 hàm
  (md5 trước/sau khóa cứng), thêm 2 index nhỏ trên bảng thông báo và 2 cấu hình:
  - F1: đếm kết quả theo `(action_code, status)` chỉ đọc index `idx_auto_campaign_details_automation_status`, tên hành động/nhóm kết quả lấy
    từ 1 dòng gần nhất mỗi nhóm (200 nghìn dòng production: `report_group` luôn suy được từ `(action_code, status)`, `action_code` NULL 0,06%).
    Production (chỉ đọc, cache lạnh): chiến dịch 7370 25,7 nghìn dòng 2,6s. Kết quả trùng V457 trên dòng có mã, không mã và legacy.
  - F2/F9: capture dồn thay đổi cùng trạng thái của một nhân viên vào mốc kế tiếp (`notifications.digest_minutes.campaign`, mặc định 10);
    thông báo đầu trong lúc yên vẫn gửi sau 30 giây. Worker gộp từ 2 thông báo đến hạn cùng lượt. Trần email/giờ cho thông báo sự kiện
    (`notifications.email.hourly_cap`, mặc định 20; báo cáo/thư thử không tính; 0 = tắt email sự kiện như trần push).
  - F3: `snapshot('account')` thêm `loginLog` (details.reason của dòng log đăng nhập/đăng xuất gần sự kiện nhất), `warnLog` (cảnh báo gần
    nhất) và `chatSession.updatedAt`; giữ `lastLog` cho bản WebApp cũ.
  - F6/F7: báo cáo tính SMS theo máy đã gắn, bỏ tài khoản SMS chưa dùng (không máy, không chiến dịch chạy/chờ), cảnh báo "Chưa gắn máy SMS…";
    danh sách ưu tiên chiến dịch có hoạt động hôm nay (`last_run_at` do trigger chi tiết cập nhật).
  - F8: không tạo báo cáo cho nhân viên đã ngừng/không còn quyền, vẫn dời lịch.
- **WebApp renderer** (nhánh `claude/notification-replay-render`): lý do chỉ cho đăng xuất/checkpoint, ưu tiên `loginLog.reason` → lỗi phiên chat
  ghi trong ±10 phút → cảnh báo gần nhất; snapshot V457 chỉ nhận dòng cảnh báo/đăng xuất; dịch lỗi tiếng Anh thật (proxy, mất mạng, máy chủ
  Zalo), bỏ câu không phải lý do; ghi chú chiến dịch thay XPath/mã output/lỗi mạng bằng câu dễ hiểu (thông báo đơn, danh sách gộp, mục
  Vấn đề); đăng nhập không ghi "bị ảnh hưởng"; báo cáo ghi "từ DD/MM HH:MM" khi khác ngày và chỉ liệt kê chiến dịch có kết quả hôm nay
  hoặc đang chạy; lỗi snapshot từ lần thử thứ 3 vẫn gửi bằng dữ liệu sự kiện. Tương thích cả snapshot V457 lẫn V465.

## Kết quả sau sửa (phát lại cùng dữ liệu)

| Kịch bản all | Trước | Sau |
|---|---|---|
| Thông báo chiến dịch gửi / gộp | 1.454 / 513 | 756 / 1.211 |
| Email / push 3 ngày | 1.690 / 1.679 | 992 / 992 |
| Nhiều nhất 1 nhân viên/ngày | 156 email | 58 email |
| Nhiều nhất 1 nhân viên/giờ | 58 email | 13 email |
| Ngày-nhân-viên ≥50 / ≥100 email | 14 / 3 | 3 / 0 |
| Push chạm trần 60/giờ | 11 | 0 |
| Báo cáo / báo cáo liệt kê SMS sai | 108 / có | 105 / 0 |
| Email còn chuỗi kỹ thuật | có | 0/992 |
| Ngoại lệ / cảnh báo PG | 0 / 0 | 0 / 0 |
| Trễ sự kiện → email p50 / p95 | 45s / 59s | 52s / 570s (thông báo được gom chờ tới mốc 10 phút) |

Kịch bản live: 0 ngoại lệ, 4 thông báo chiến dịch + 39 báo cáo (3 báo cáo của nhân viên đã ngừng không còn tạo), 43 email như trước.

Kiểm chứng: `scripts/notification-center/smoke_v465.sh` (103 kiểm thử V457 trên nền V465 + 20 kiểm thử V465, từ chối apply lại, rollback
trả đúng md5 V457, apply lại); WebApp 50/50 test thông báo, toàn API 1.409/1.410 (1 lỗi `desktop-ai.routes.test.ts` có sẵn trên `dev`
sạch), typecheck 7 workspace. Production chỉ đọc: logic SMS mới trên 4 nhân viên nhận báo cáo 18:00 cho đúng số (883: 2→1, 1130: 2→1,
333: 1→0, 679: 2→1).

## Quan sát production 05/11

9 báo cáo 18:00 tạo lúc 18:00:26, render xong 18:00:33, 8 email gửi 18:00:36–43, staff 5 (đã ngừng) bỏ qua đúng — khớp dự đoán phát lại.
17 người đăng ký "Hoàn thành" chưa có chiến dịch nào hoàn thành kể từ khi live (chỉ có cập nhật bảo trì 00:00 không đổi trạng thái).

## Triển khai (cần đồng ý riêng) và rollback

1. Deploy WebApp renderer trước (đọc được cả snapshot V457).
2. Apply V465 ngoài giờ cao điểm: `CREATE OR REPLACE FUNCTION` làm PostgREST nạp lại schema; tạo index giữ khóa SHARE ngắn trên
   `auto_notifications` (bảng nhỏ) tới hết giao dịch. **Số V464 đã dùng** (`migration_v464_native_desktop_only_login`): kiểm lại số trước khi apply.
3. Rollback: `migrations/rollback_v465_notification_quality.sql` (khôi phục đúng 5 hàm V457, bỏ 2 index/2 cấu hình, không đụng dữ liệu
   thông báo); WebApp quay về image trước.

## Chưa làm

- Đăng xuất hàng loạt nhiều tài khoản cùng lúc vẫn là từng thông báo riêng (cooldown theo tài khoản; 3 ngày mẫu: tối đa 7 tài khoản cùng
  giây ở staff 603).
- Người dùng rất nặng bật cả Hoàn thành + Tạm dừng vẫn tới ~50 email/ngày (mỗi trạng thái một mốc 10 phút).
- V458 (vào/rời nhóm) đang tắt trên production; push APNs chưa cấu hình, chưa có thiết bị nào.
