# Thông báo vào Trợ lý aka + báo đẩy khi có tin mới (phương án)

Yêu cầu (22/11/2026): "Tôi muốn tất cả các thông báo này nó sẽ gửi vào mục trợ lý AK để cho khách hàng đọc. Khi ứng dụng
nhận được một tin nhắn trợ lý AK thì hệ thống cũng sẽ tự động báo cho khách hàng thông qua Notify app."

**Tình trạng:** anh chốt Q1–Q4 và cho code ("Bạn hãy thực thi cho đến khi nào xong thì thôi", 22/11/2026). Đã code xong cả
bốn phần (DB, API + Web, iOS, Desktop). **V624 đã apply akachat 11:57:58 VN 22/11/2026** theo yêu cầu ("Apply luôn"; công tắc vẫn
`off`, chưa ai thấy gì); chưa deploy, chưa phát hành, chưa mở PR. Xem mục 6.

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

## 6. Tình trạng code (22/11/2026)

| Phần | Ở đâu | Đã kiểm | Chưa |
| --- | --- | --- | --- |
| DB V624 | akaAgent nhánh `claude/practical-albattani-jm21p0`: [migration](../migrations/migration_v624_notification_assistant_inbox.sql), [gỡ](../migrations/rollback_v624_notification_assistant_inbox.sql), bản dán SQL Editor `migrations/tests/migration_v624_notification_assistant_inbox_paste.sql`; sinh bằng `python3 scripts/build-v624-sql.py` từ thân production đọc 22/11 (`migrations/snapshots/notification-assistant-inbox-v624/live/`) | `scripts/notification-assistant-inbox/smoke_v624.sh` (PG16, nền Trợ lý aka chép từ production, 6 hàm sẽ thay = md5 production): PASS, có hai phiên song song, apply lại bị từ chối, gỡ trả đúng hàm / cột, bản dán | **Đã apply** 11:57:58 VN 22/11 (sổ `20261122061101`, không apply lại; [biên nhận](../migrations/snapshots/notification-assistant-inbox-v624/apply-receipt.json)) |
| API + Web + hợp đồng | akaAgentWebApp nhánh `claude/notification-assistant-inbox` (nền `dev_1` `097ffa57`, commit `748441ce`) | `npm run typecheck` 8 workspace, `npm test` mọi workspace, build Web | Deploy, PR |
| iOS | cùng nhánh WebApp (commit `9de489c4`) | test mobile | Bản 0.7.0 (0.6.0 đang chờ Apple duyệt) |
| Desktop | akaAgent cùng nhánh V624 | hai typecheck, `node scripts/notification-toast-desktop/smoke.cjs` (10 ca), `node scripts/notification-toast-desktop/run-toast-ui-smoke.cjs` (13 nhóm giao diện), `electron-vite build` | Chạy trong Electron thật, phát hành |

**DB (V624).** Cột `ai_message.notification_id` (khoá ngoại `ON DELETE CASCADE`: dọn thông báo 90 ngày là dọn luôn mục), một hội thoại
"thông báo" cho mỗi nhân viên (`intake_data.kind = 'notices'`, chỉ mục duy nhất), trigger `trg_aka_agent_ai_assistant_notice` chép
thông báo khi `content_status` thành `ready` (cùng giao dịch, lỗi chép bị nuốt, không làm hỏng thông báo), hàm
`private.aka_agent_ai_assistant_notice*` (chỉ chủ sở hữu gọi được). `item` / `stream` / `sync` / `read` chỉ trả và đánh dấu mục
`notice` khi app gửi `includeNotices`; đọc mục ở Trợ lý aka thì đánh dấu thông báo đã đọc và hủy lượt đẩy chưa gửi (khoá theo thứ
tự thông báo → hội thoại, không khoá chéo). Công tắc `notifications.assistant_inbox` (V624 đặt `{"audience":"off"}`;
`admin_akabiz` / `orgs` + `organizationIds` / `all`). Thông báo cũ không được chép.

**API / Web.** `AiAssistantItem.kind = 'notice'` + `notice` (hợp đồng `packages/control-api/src/aiAssistant.ts`), client gửi
`notices=1` / `includeNotices`. Lượt đẩy mở `/aka?item=<mục>` khi iPhone chạy bản ≥ `AI_ASSISTANT_NOTICE_MIN_IOS_VERSION` (0.7.0),
bản cũ giữ đường mở cũ. Web: thẻ thông báo trong Trợ lý aka, thông báo nổi mở `/assistant?notification=<id>&next=<đường cũ>` (chưa
có mục sau 4 giây thì về chỗ mở cũ, nên deploy Web trước khi bật công tắc vẫn đúng).

**iOS.** Thẻ thông báo trong Trợ lý aka, mời bật thông báo đẩy lần đầu mở Trợ lý aka (từ chối thì mời lại sau 7 ngày), mở đúng mục
khi bấm đẩy.

**Desktop (Q3).** Chuông và trang Thông báo giữ nguyên; thêm thông báo nổi góc phải
([NotificationToast.tsx](../src/renderer/src/components/Notifications/NotificationToast.tsx), luật ở
[notificationToastModel.ts](../src/renderer/src/components/Notifications/notificationToastModel.ts), giống Web): Chào ngày mới, báo
cáo 12:00 / 18:00, chiến dịch hoàn thành chưa đọc, mới trong 3 giờ, máy chưa hiện (id lưu `localStorage` theo phiên); 12 giây, rê
chuột thì giữ; nút "Xem báo cáo" / "Xem chiến dịch" mở thông báo ở trang Thông báo; đang ở trang Thông báo thì không hiện; cửa sổ thu
nhỏ / khoá màn hình thì để dành tới khi khách quay lại. Không thêm nhịp đọc DB: đọc danh sách (3 dòng) chỉ khi số chưa đọc của chuông
tăng; hỏi số chưa đọc ở mốc `nextRunAt` của cài đặt + 1 và + 5 phút (đọc cài đặt lúc đăng nhập và sau mỗi đợt mốc), và 1 phút sau khi
một chiến dịch đang hiện chuyển sang "hoàn thành". Thêm: nhãn "Chào ngày mới" / "Trợ lý aka", phần nội dung `display: 'tiles'` vẽ
thành ô số, nội dung loại `assistant`.

**Thứ tự đưa lên** (mỗi bước chờ anh yêu cầu):
1. ~~Apply V624~~: đã apply 11:57:58 VN 22/11/2026 theo yêu cầu ("Apply luôn"), qua bản dán (MCP), sổ `20261122061101`, md5 sổ = file
   `7a47a5b8…`, không apply lại. PostgREST nạp lại schema 5,3 giây, 0 lỗi 5xx; thử trên thông báo thật trong giao dịch rồi huỷ: đạt
   ([biên nhận](../migrations/snapshots/notification-assistant-inbox-v624/apply-receipt.json)).
2. Merge + deploy API / Web từ nhánh WebApp (bản đang chạy không gửi `includeNotices` nên không thấy mục thông báo; deploy trước
   hay sau V624 đều được, API mới gặp DB chưa có V624 thì DB bỏ qua khoá lạ).
3. iOS 0.7.0 (đổi `version` / `buildNumber` trong `app.config.ts` lúc phát hành).
4. Bật `notifications.assistant_inbox` = `admin_akabiz`, thử một báo cáo thật + một lượt đẩy thật, rồi `all` cùng lúc bật
   `notifications.default_reports`.
5. Desktop theo bản phát hành kế tiếp (độc lập với các bước trên: chỉ đọc trung tâm thông báo có sẵn).

Gỡ: `notifications.assistant_inbox` = `off` (không DDL, có hiệu lực ngay với thông báo sau đó); gỡ hẳn: [rollback](../migrations/rollback_v624_notification_assistant_inbox.sql)
(xoá hội thoại / mục thông báo, trả 6 hàm về bản cũ).

### 6.1. Kiểm thử 22/11/2026 (anh: "Hãy kiểm thử tính năng này")

**DB thật, trong giao dịch rồi huỷ** (khối `DO` kết thúc bằng `RAISE`, công tắc bật tạm trong giao dịch; hậu kiểm: công tắc `off`,
0 mục, 0 hội thoại thông báo, số chưa đọc không đổi):
- Phát lại toàn bộ thông báo `ready` 7 ngày theo thứ tự: 1.959 mục chép đúng (campaign 1.033, gói 650, tài khoản 191, báo cáo 85),
  0 bỏ sót (466 nhân viên đều có quyền Trợ lý aka), 17 `assistant.result` không chép. Mỗi lần chép trung bình 1,5 ms, p95 1,9 ms,
  lâu nhất 14 ms. Gọi lại lần hai: trả đúng mục cũ, không thêm mục. 462 hội thoại "Thông báo" (một mỗi nhân viên), đếm / thứ tự / chủ
  sở hữu đúng, luôn "đã xem" ở mức hội thoại.
- Công tắc: `off` không chép; `orgs` chỉ chép tổ chức trong danh sách; `admin_akabiz` chép của admin, không chép của khách; tắt lại thì
  thông báo mới không chép.
- App cũ (không `includeNotices`): `stream` / `sync` của 6 nhân viên mẫu giống hệt trước khi chép, 0 mục thông báo; app mới thấy đủ.
- Đọc: app cũ gọi `read` không đánh dấu thông báo; app mới đọc tới mục giữa thì chỉ các thông báo tới mục đó thành đã đọc, lượt đẩy
  chờ gửi bị hủy (`read_in_app`), trả `notificationUnreadCount` đúng số của chuông.
- Trigger: thông báo vừa dựng xong qua `complete_render` thành mục mới cuối hộp; `claim_deliveries` của lượt đẩy mang
  `assistantItemId` đúng mục, lượt email không mang.
- Phiên agent "/" đang mở: thông báo xen vào không làm đứt phiên (luật cũ sẽ làm đứt).

**Desktop** `node scripts/notification-toast-desktop/run-toast-ui-smoke.cjs` (13 nhóm; component thật + store thật trên Chromium của
Playwright, IPC giả, đồng hồ giả; `TOAST_UI_SHOTS=<thư mục>` để chụp): hiện / tự ẩn 12 giây / rê chuột giữ / bấm mở / "Để sau" / nút X,
loại không nổi và thông báo quá 3 giờ không hiện, trang Thông báo không đọc danh sách, cửa sổ ẩn thì để dành, đăng nhập lại không hiện
lại, hỏi số chưa đọc đúng mốc báo cáo + 1 / + 5 phút và 1 phút sau khi chiến dịch hoàn thành, một giờ để yên 0 lượt đọc DB. Cố ý làm
hỏng 3 luật trong `notificationToastModel.ts` thì bài kiểm bắt cả 3.

**Web** (WebApp cùng nhánh): 1.961 mục thông báo thật (dựng bằng chính `private.aka_agent_ai_assistant_item`, chỉ đọc) đi qua
`parseAiAssistantItem` / `aiAssistantNoticeContent` / `assistantNoticeAction`: 0 lỗi, nút mở đúng chiến dịch / tài khoản. Tìm ra lỗi:
API gửi mục **đã đọc** (không còn `answerJson`) và app đọc lại bằng cùng `parseAiAssistantItem`, nên thẻ thông báo mất loại, nội dung,
nút mở và việc mở đúng mục từ lượt đẩy; cùng lỗi làm mất lựa chọn bấm nhanh, kết quả lịch, agent, bản nháp của lượt trao đổi (có từ
18/11, lúc API bắt đầu đọc kết quả DB; 7 ngày tới 22/11 có 7 lượt có lựa chọn và 4 lượt có lịch). Đã sửa: hàm nhận cả hai dạng; bài
kiểm đơn vị "đọc lại ra cùng mục" (hỏng trên code cũ) và e2e `apps/web/e2e/assistant-notices.spec.ts` (API giả trả đúng dạng API thật;
code cũ hỏng 2/3 ca; `AKA_NOTICE_ITEMS=<tệp>` chạy thêm với thông báo thật). Toàn bộ 1.961 mục thật: đọc lại ra y hệt.

