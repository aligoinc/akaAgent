# Thông báo vào Trợ lý aka + báo đẩy khi có tin mới (phương án)

Yêu cầu (22/11/2026): "Tôi muốn tất cả các thông báo này nó sẽ gửi vào mục trợ lý AK để cho khách hàng đọc. Khi ứng dụng
nhận được một tin nhắn trợ lý AK thì hệ thống cũng sẽ tự động báo cho khách hàng thông qua Notify app."

**Tình trạng:** phương án, chưa code, chưa đổi DB. Đọc mã `dev_3` (akaAgent) và `dev_1` (WebApp) cùng DB thật (chỉ đọc) ngày 22/11/2026.

## 1. Hiện trạng (đã kiểm)

- **Trợ lý aka** là một hộp hội thoại mỗi nhân viên. Mỗi mục của hộp là một dòng `ai_message` có `assistant_staff_id`, đọc theo
  chỉ mục `idx_ai_message_assistant_stream (assistant_staff_id, id DESC)`. Hàm DB `private.aka_agent_ai_assistant_item` dựng mục
  thành hai loại: `turn` (khách hỏi, trợ lý đáp ngay) và `work` (việc Claude Code làm, lượt hẹn lịch). Có trên Web (`/assistant`)
  và iOS (tab giữa, từ bản 0.5.0; bản 0.6.0 (20) đang chờ Apple duyệt). **Desktop chưa có Trợ lý aka.**
- Đã dùng thật: 11 nhân viên từng có mục trong hộp, 47 mục trong 7 ngày. Phần lớn khách chưa mở Trợ lý aka lần nào.
- **Báo khi có kết quả đã có sẵn** (loại `assistant.result`): việc xong / hỏng thì ghi một thông báo vào trung tâm thông báo,
  đẩy iPhone sau 20 giây, hủy lượt đẩy nếu khách đã thấy kết quả trong app. Bấm thông báo mở thẳng `/aka?item=<mã>`.
- **Trung tâm thông báo** (V457, V621): thông báo được ghi ở `auto_notifications`; worker trên Fly dựng nội dung (`sections`,
  ô số) rồi gọi `public.aka_agent_notification_worker`, hàm này đánh dấu `content_status = 'ready'` và gọi
  `private.aka_agent_notification_fanout` để tạo lượt email / đẩy. **Mọi loại thông báo đều đi qua đúng một chỗ này.**
  7 ngày qua: 1.224 thông báo chiến dịch (90 nhân viên), 650 gói sắp hết hạn, 194 tài khoản, 91 báo cáo, 17 kết quả Trợ lý aka.
  Chào ngày mới / báo cáo 12:00, 18:00 cho mọi tài khoản chưa chạy vì `notifications.default_reports` đang `off`.
- **Báo đẩy hôm nay không tới ai:** APNs đã cấu hình trên Fly (14/11), bản iOS từ 0.4.0 có quyền đẩy, nhưng
  `auto_notification_devices` có **0 máy**: app chỉ đăng ký khi khách tự bật công tắc trong Cài đặt. 30 nhân viên đang có
  phiên iOS, 672 nhân viên dùng Web.

## 2. Cách làm

### 2.1. Mỗi thông báo thành một mục "thông báo" trong hộp Trợ lý aka

- Thêm loại mục thứ ba `notice`. Lưu ở chính bảng `ai_message` (cột mới `notification_id`, duy nhất), trong một hội thoại
  "thông báo" riêng của mỗi nhân viên, trạng thái `hoàn thành` ngay. Nhờ vậy hộp hội thoại, đọc thêm, đồng bộ, đánh dấu đã xem
  và lượt đẩy dùng lại toàn bộ đường đang chạy, thứ tự theo `id` vẫn đúng.
- Chỗ ghi: ngay sau `fanout` trong `aka_agent_notification_worker` (lúc nội dung vừa dựng xong), cùng một giao dịch, bọc
  trong khối bắt lỗi: ghi mục hỏng không bao giờ làm hỏng thông báo. Thông báo bị gộp (`merged`) không thành mục.
  `assistant.result` không chép (đã là mục `work`). `system.test` / `system.verify_email` không chép.
- Mục giữ bản sao tiêu đề, thân và `sections` (ô số của báo cáo), vì nội dung báo cáo ở `auto_notifications` bị xóa sau 30 ngày.
  Mục bị xóa cùng lúc với thông báo (90 ngày, `notifications.retention_days`).
- **Không gọi AI**: mục thông báo là bản chép, không tốn lượt model, không tính vào hạn mức lượt / câu hỏi của Trợ lý aka.
- Thông báo vẫn nằm trong chuông / trang Thông báo như cũ (xem quyết định Q2). Đọc ở Trợ lý aka thì thông báo tương ứng được tính
  đã đọc và lượt đẩy còn chờ bị hủy (mở rộng hàm `notify_seen` đang làm việc này cho `assistant.result`).

Hiển thị trên Web và iOS: thẻ của trợ lý (bên trái), tiêu đề, ô số như email / thông báo nổi, nút mở đúng chỗ (chiến dịch, tài khoản,
báo cáo, Gia hạn). Dùng lại bộ vẽ `sections` sẵn có của trang chi tiết thông báo.

### 2.2. Báo đẩy cho mọi tin Trợ lý aka

| Tin mới trong Trợ lý aka | Đẩy tới điện thoại |
| --- | --- |
| Thông báo (Chào ngày mới, báo cáo 12:00 / 18:00, chiến dịch hoàn thành, …) | Ngay, theo công tắc đẩy của loại đó (gieo mặc định là bật) |
| Kết quả việc, lượt hẹn lịch, việc của agent `/` | Như hiện tại: đợi 20 giây, hủy nếu khách đã thấy |
| Lời đáp ngay khi khách đang gõ chuyện với trợ lý | Không (khách đang nhìn màn hình) |

- Bấm thông báo đẩy mở Trợ lý aka đúng mục đó (`/aka?item=<mã mục>` trên iOS, `/assistant?item=<mã mục>` trên Web).
  Máy cài bản iOS chưa vẽ được mục `notice` thì vẫn mở trang chi tiết thông báo như cũ (API chọn theo `app_version` của máy).
- Giữ các giới hạn đang có: trần 60 lượt đẩy / giờ mỗi người, chế độ `dry_run`, gom thông báo chiến dịch 10 phút.
- **Để có máy nhận đẩy**, iOS phải mời bật thông báo (hiện 0 máy). Phương án trước đã có bước này (mục 5 của
  [NOTIFICATION_DEFAULT_REPORTS_PLAN.md](NOTIFICATION_DEFAULT_REPORTS_PLAN.md), chưa làm); đề xuất mời ngay lần đầu mở Trợ lý aka (Q4).
- Web: thông báo nổi trong trang đã có (WebApp #285), bấm vào sẽ mở Trợ lý aka. Thông báo của trình duyệt khi đã đóng tab
  (Web Push) cần khóa VAPID, bảng đăng ký mới và kênh gửi mới: để sau.
- Huy hiệu: số tin Trợ lý aka chưa xem hiện trên nút Trợ lý aka (tab giữa iOS, mục menu Web), lấy từ số chưa đọc sẵn có.

### 2.3. Bản app cũ

- Bản cũ đọc loại lạ thành `turn`, tức sẽ vẽ tiêu đề thông báo như tin khách gõ. Vì vậy DB chỉ trả mục `notice` khi app báo là
  vẽ được (`includeNotices`), và chỉ đánh dấu đã đọc thông báo theo `read` của app đó. Web cập nhật cùng lúc deploy; iOS cũ, Web
  còn giữ bản cũ trong bộ nhớ đệm và Desktop thấy như hôm nay (chuông).

### 2.4. Bật dần

Công tắc `notifications.assistant_inbox` `{"audience":"off"|"admin_akabiz"|"all"}`: `off` không ghi mục nào (tắt khẩn cấp,
không cần deploy). Không chép thông báo cũ: chỉ thông báo dựng sau lúc bật.

## 3. Số đo dự kiến

- Bật `default_reports` cho mọi tài khoản (2.243 nhân viên đang hoạt động): khoảng 3 mục / người / ngày cộng thông báo chiến dịch,
  tức 7–9 nghìn dòng `ai_message` mỗi ngày, tối đa khoảng 800 nghìn dòng sau 90 ngày. Mỗi mục là một lệnh chèn trong giao dịch
  worker đang chạy sẵn, không thêm nhịp, job hay lượt đọc theo chu kỳ.
- Đẩy: 3 lượt / người / ngày cho báo cáo, cộng sự kiện chiến dịch, trong trần 60 / giờ. Khách tắt từng loại ở Cài đặt → Thông báo.

## 4. Các bước

| # | Việc | Repo | Đưa lên |
| --- | --- | --- | --- |
| 1 | Migration: cột `notification_id`, hội thoại thông báo, hàm ghi mục, `item` / `stream` / `sync` / `read` nhận `notice`, `payload.assistantItemId`, dọn 90 ngày, công tắc `off`. Kiểm md5 thân production của mọi hàm sửa | akaAgent (sổ) + WebApp `scripts/sql/aka-assistant` | Apply buổi tối (sửa hàm = nạp lại schema) |
| 2 | Hợp đồng `AiAssistantItem.kind = 'notice'`, bộ đọc, `includeNotices`, `notificationRoute` chọn theo bản app | WebApp `control-api`, API | Deploy API |
| 3 | Web: thẻ thông báo trong hộp, thông báo nổi mở Trợ lý aka, huy hiệu | WebApp `apps/web` | Deploy Web cùng bước 2 |
| 4 | iOS: thẻ thông báo, mời bật đẩy, huy hiệu tab giữa, mở đúng mục khi bấm | WebApp `apps/mobile` | Bản iOS kế tiếp |
| 5 | Desktop theo Q3 | akaAgent | Bản Desktop kế tiếp |
| 6 | Bật `admin_akabiz`, thử máy thật (một lượt đẩy APNs thật, một báo cáo thật), rồi `all` cùng lúc bật `default_reports` | DB | Khi anh yêu cầu |

Kiểm thử: PostgreSQL cục bộ với thân hàm production (ghi mục, bản cũ không thấy mục, đọc ở Trợ lý aka thì hủy lượt đẩy, thông báo
gộp, lỗi ghi mục không làm hỏng thông báo, gỡ migration), phát lại thông báo 7 ngày thật vào hộp, bài kiểm API / Web / iOS.

Làm sau (không trong phạm vi): trợ lý đọc được các thông báo gần đây để khách hỏi tiếp ("vì sao báo cáo trưa có 30 thất bại?"),
nút "Hỏi trợ lý về thông báo này" trên thẻ, Web Push.

## 5. Anh đã chốt (22/11/2026, qua hộp chọn)

- Q1: **mọi loại** thông báo khách đang nhận (trừ `system.test`, `system.verify_email`; `assistant.result` đã là mục `work`).
- Q2: **giữ chuông và trang Thông báo song song**; đọc một nơi thì nơi kia cũng tính đã đọc.
- Q3: **Desktop giữ chuông** + thông báo nổi; Trợ lý aka trên Desktop làm ở đợt sau.
- Q4: iOS **mời bật thông báo lần đầu mở Trợ lý aka** sau khi cập nhật; từ chối thì nhắc lại sau 7 ngày.

Các câu hỏi gốc:

- **Q1. Loại nào vào Trợ lý aka:** chỉ ba loại mặc định (Chào ngày mới, báo cáo 12:00 / 18:00, chiến dịch hoàn thành), hay mọi
  thông báo khách đang nhận (thêm chiến dịch tạm dừng / lỗi, tài khoản đăng xuất, nhóm data, gói sắp hết hạn). Đề xuất: mọi loại.
- **Q2. Chuông và trang Thông báo:** giữ song song (đọc một nơi tính đã đọc ở cả hai), hay bỏ chuông trên Web / iOS. Đề xuất: giữ
  song song ở đợt này.
- **Q3. Desktop:** giữ chuông + thông báo nổi (bước 6 của phương án trước), Trợ lý aka trên Desktop để sau; hay làm luôn một bản
  Trợ lý aka chỉ đọc trên Desktop. Đề xuất: giữ chuông, làm sau.
- **Q4. Mời bật đẩy trên iPhone:** mời ngay lần đầu mở Trợ lý aka sau khi cập nhật app; hay chỉ để công tắc trong Cài đặt như hiện
  nay (gần như không ai bật). Đề xuất: mời ngay.
