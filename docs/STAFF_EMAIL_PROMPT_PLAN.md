# Xin email khách hàng sau khi đăng nhập: phương án (25/11/2026)

Yêu cầu (anh, 25/11/2026): khách **đang dùng gói**, sau khi đăng nhập vào giao diện chính, hệ thống kiểm tra khách đã có
email chưa. Chưa có thì mở form xin email, để: gửi bản cài / link đăng nhập, gửi thông tin tài khoản đăng nhập, lấy lại
tài khoản khi khách quên. Form chỉ tắt được bằng nút tắt, nút này thật nhỏ; mục tiêu là khách nhập email. Thiết kế tinh tế,
thu hút. **Chỉ lên phương án, chưa code.**

Bản thiết kế (5 màn, màn Desktop bấm thử được): https://claude.ai/artifact/NSgiQwdvquGqZPo89ZVVF8

Trạng thái (25/11/2026, anh: "Đồng ý thực thi phương án"): **đã code; V652 đã apply production 25/11; chưa deploy API/Web, chưa phát hành Desktop; công tắc `account.email_prompt` = off.**
- DB: `migrations/migration_v652_staff_email_prompt_p1/p2/p3.sql` + `rollback_v652_staff_email_prompt.sql`; kiểm
  `bash scripts/staff-email-prompt/test_v652.sh` (PostgreSQL 16 cục bộ, 85 khẳng định + chạy lại bị chặn + gỡ sạch).
  **Đã apply akachat 25/11/2026 theo yêu cầu ("áp luôn")**: p1 16:48:12, p2 16:59:00, p3 17:19:15 VN (sổ `20261125094812` /
  `20261125095900` / `20261125101915`, md5 sổ = file, không apply lại); 0 lỗi 5xx/503, phút apply p2 có 787 request
  quá 1 giây (PostgREST nạp lại schema); p3 điền email_list 137 / 336 / 1.288 dòng; [biên nhận](../migrations/snapshots/staff-email-prompt-v652/apply-receipt.json).
- Kiểm thử ngẫu nhiên 25/11/2026 (anh: "Kiểm thử và cải tiến… cho đến khi ít nhất 3 vòng không còn vấn đề"):
  `python3 scripts/staff-email-prompt/fuzz/fuzz.py --seed N --ops 6000 --synth 800 --real <file ngoài repo> --extra
  migrations/migration_v656_staff_email_prompt_fixes.sql --dump <file>` (PG16 cục bộ; 2.299 tài khoản thật đã che email
  + tổ chức / tài khoản mẫu + email cố tình sai; mô hình viết độc lập so từng kết quả và dữ liệu sau; so bộ kiểm email
  phía giao diện với DB trên 4.000 chuỗi; mọi kết quả RPC qua hàm đọc của app), WebApp
  `apps/api/src/modules/email-prompt/emailPrompt.fuzz.test.ts` (thư, link ký, bộ gửi). Tìm ra 4 lỗi của V652, sửa ở
  **[V656](../migrations/migration_v656_staff_email_prompt_fixes.sql) (chưa apply production, chờ anh duyệt)**, sinh bằng
  `python3 scripts/staff-email-prompt/build-v656-sql.py` (khoá md5 thân hàm production):
  1. công tắc `{"audience":"orgs"}` thiếu `organizationIds` bật form cho MỌI tài khoản (`v_enabled` NULL);
  2. bộ gửi thư lỗi khi `limit` không phải số;
  3. "Không phải tôi" trả lại `email_list[2]` dù trước lần lưu email đang trống (trả lại một email cũ đã xoá) -> nay lưu
     `prev_*_email` lúc lưu và trả đúng giá trị đó (trước đó trống hoặc chính email bị gỡ thì để trống);
  4. nhiều lượt lưu cùng lúc vượt hạn 5 lần / giờ -> khoá dòng `org_staff` khi lưu.
  Sau V656: vòng 4–8, 11–13, 21–23 sạch (mỗi vòng 4.000–6.000 thao tác); bỏ V656 thì cùng hạt giống ra lỗi lại.
  `test_v652.sh` nay chạy cả V656 + gỡ V656 + `assertions_v656.sql` (99 khẳng định). Số 653, 654 đã có nhánh khác giữ.
- Hợp đồng: WebApp `packages/control-api/src/emailPrompt.ts` = akaAgent `src/shared/emailPrompt.ts` (md5 `efb4547b…`).
- Desktop (nhánh `claude/relaxed-albattani-c1volz`, `b83a5aa5`): kênh `email-prompt:call`, hộp thoại 3 màn, nhãn
  "Thêm email", dòng Email trong Thông tin tài khoản; kiểm `node scripts/staff-email-prompt/desktop-email-prompt-smoke.cjs`
  (12) và `node scripts/staff-email-prompt/run-email-prompt-ui-smoke.cjs` (15, Chromium + IPC giả). Chưa chạy trong Electron thật.
- Web/API (WebApp cùng tên nhánh, `244cbf2b`): `/api/aka-agent/control/v1/me/email-prompt`, bộ gửi thư xác nhận
  `EmailPromptMailScheduler`, link `/api/aka-agent/email-prompt/verify` / `not-me`; chi tiết WebApp `docs/STAFF_EMAIL_PROMPT.md`.
  Gói JS chính của Web chỉ còn ~200 byte dưới trần 2 MiB của PWA.
- Thứ tự đưa lên: apply V652 p1 → p2 → p3 (tối) → deploy API/Web → bật `account.email_prompt` `admin_akabiz` để thử → `all`
  → phát hành Desktop.

Mọi số liệu dưới đây đọc chỉ đọc ngày 25/11/2026.

## 0. Anh đã chốt (25/11/2026)

1. **Có email ở 1 trong 3 chỗ** (`org_staff.email`, `org_organization.email`, `aka_customer.email`) **thì không hỏi.**
2. Nếu có hỏi lại thì **hiện nguyên email** để khách chỉ cần bấm xác nhận, không bắt nhập email mới.
3. Người lưu là **admin tổ chức** thì lưu vào cả `org_staff`, `org_organization`, `aka_customer`; người khác chỉ lưu
   `org_staff`.
4. Nhập email mới thì **ghi đè** email cũ. **Cả ba bảng có thêm danh sách email**: email cũ chuyển vào danh sách, email mới
   cũng vào danh sách.
5. Tắt form bằng × thì **mỗi ngày hỏi lại một lần**, kèm nhãn "Thêm email" trên thanh trên cùng.
6. **Lưu ngay + gửi thư xác nhận**, thư không chứa mật khẩu.
7. Admin đã có email ở tổ chức / CRM mà tài khoản trống: **tự chép, không hỏi** (mục 3.3).
8. **Áp cho mọi người, cả nhân viên không phải admin**: có email ở 1 trong 3 chỗ là không hỏi (anh nhắc lại 25/11, thay lựa
   chọn "vẫn hỏi nhân viên" trước đó). Với nhân viên, email tổ chức / CRM không được chép vào tài khoản của họ.
9. Làm **Desktop + Web trước**, iPhone ở bản phát hành sau.
10. Form **thêm một dòng** nói rõ báo cáo chiến dịch mỗi sáng sẽ gửi qua email (tắt được).

### "3 chỗ" là 3 chỗ nào

Với tài khoản đang đăng nhập (một dòng `org_staff`):

| # | Chỗ | Cột | Lấy dòng nào |
| --- | --- | --- | --- |
| 1 | Tài khoản đăng nhập | `org_staff.email` | Chính dòng `org_staff` của tài khoản đó |
| 2 | Tổ chức | `org_organization.email` | Tổ chức của tài khoản: `org_organization.id = org_staff.organization_id` |
| 3 | Khách hàng trong CRM | `aka_customer.email` | Khách của tổ chức: `aka_customer.id = org_organization.customer_id` |

- "Có email" = cột đó không trống, đúng định dạng email và không phải tên miền gõ nhầm (`gmail.con`, `gmial.com`…). Email
  sai thì coi như chưa có.
- Chỉ xét cột `email`, không xét `email_list` (danh sách email cũ).
- Có ở ít nhất 1 trong 3 chỗ là không hiện form, dù là admin hay nhân viên.
- Cùng một tổ chức thì chỗ 2 và 3 giống nhau cho mọi tài khoản; chỉ chỗ 1 là riêng từng tài khoản.

"CRM" trong tài liệu này là bảng `aka_customer` (hồ sơ khách trong trang quản lý crm.akabiz.net), nối qua
`org_organization.customer_id`.

## 1. Số liệu hiện tại

Phạm vi: nhân viên `org_staff` đang hoạt động, tổ chức có ít nhất một gói còn hạn (`org_organization_product`, theo ngày VN),
có mở Desktop (presence) hoặc Web/iOS (`auto_control_sessions`) trong 30 ngày: **1.053 người**.

| Theo luật đã chốt | Số người |
| --- | --- |
| Admin không có email ở cả 3 chỗ → **thấy form** | **127** |
| Tài khoản nhân viên (không phải admin) không có email ở cả 3 chỗ → thấy form | 0 |
| Tài khoản nhân viên chưa có email riêng nhưng tổ chức / CRM có → không hỏi | 35 |
| Admin có email ở tổ chức / CRM nhưng `org_staff.email` trống → không hỏi | 788 |
| … trong đó chỉ có email ở CRM (hiện **không tự lấy lại tài khoản được**, xem Q10) | 603 |
| Admin có email ở cả tổ chức lẫn CRM mà hai email khác nhau | 0 |

Toàn bảng: `org_staff` 137 / 2.298 dòng có email, `org_organization` 332 / 2.229, `aka_customer` 20.968 / 107.622
(1.284 dòng nối với một tổ chức).

Các nơi đang dùng email của khách:

- **Lấy lại tài khoản** (cổng CRM `/gia-han/lay-lai-tai-khoan`): khớp **cả** email lẫn SĐT trên cùng `org_organization`
  hoặc `org_staff` rồi gửi tên đăng nhập + mật khẩu (SqlServerDashboard `docs/trang-gia-han-khach-hang.md`). **Không đọc
  `aka_customer.email`.**
- **Thông báo** (Chào ngày mới, báo cáo, chiến dịch hoàn thành): lượt gieo `private.aka_agent_notification_seed_defaults`
  mỗi giờ tự điền email từ `private.aka_agent_notification_email_candidates()` (nguồn `profile` = `org_staff.email`, hoặc
  email tổ chức khi tổ chức chỉ có 1 tài khoản; nguồn `crm` = `aka_customer.email`), đánh dấu luôn là đã xác nhận, và
  bật email "Chào ngày mới" 07:00. `notifications.default_reports` đang `audience: all`, `emailMax: 100000`.
- **CSKH tự động của CRM** (nhắc gia hạn T-7 / T / T+3, timeline): gửi tới `aka_customer.email`, có cờ từ chối
  `is_email_unsubscribed` (24/11).

Lưu ý: ghi chú cũ của tính năng thông báo mặc định (21/11) chốt "chưa có email thì không gửi email, **không xin email**".
Tính năng này là việc xin email cho tài khoản, thay quyết định "không xin email" đó.

## 2. Luồng

### 2.1 Ai thấy form

Đủ cả 5 điều kiện:

1. Nhân viên đang hoạt động (`is_active`, chưa xoá), được dùng akaAgent (`aka_agent_app_access_staff_allowed`).
2. Tổ chức có gói còn hạn (gồm cả dùng thử, Q6). Đã hết gói thì app đang ở màn Gia hạn, không hiện form.
3. **Không có email dùng được ở cả 3 chỗ**: `org_staff.email` của chính tài khoản, `org_organization.email` và
   `aka_customer.email` của tổ chức (áp cho mọi người, admin hay không). Hiện chỉ 127 admin, 0 nhân viên.
   "Dùng được" = đúng định dạng và không thuộc danh sách tên miền gõ nhầm của `aka_agent_notification_email_candidates`.
4. Chưa tắt form trong hôm nay (tắt thì hôm sau hỏi lại).
5. Công tắc `account.email_prompt` cho phép (`audience` off / admin_akabiz / orgs / all).

### 2.2 Khi nào hiện

- Sau khi vào giao diện chính và trang đầu đã vẽ xong khoảng 1,5 giây (khách thấy mình đã vào được app rồi mới thấy form).
- Không chồng lên hộp thoại khác: chờ màn chấp nhận chính sách, hộp nhắc cập nhật, hộp nhắc gia hạn đóng xong rồi mới hiện.
  Đang mở form tạo/sửa chiến dịch thì chờ tới khi đóng.
- Desktop thường mở liền nhiều ngày: kiểm lại một lần khi sang ngày mới (dùng mốc đổi ngày sẵn có của bộ nhắc gia hạn),
  không hẹn giờ đọc DB riêng.

### 2.3 Cách đóng

- Chỉ đóng bằng nút **×** nhỏ ở góc trên phải (22 px, biểu tượng 11 px, màu xám nhạt). Bấm ra ngoài hay phím Esc không đóng.
- Nút vẫn đạt độ tương phản 3:1 với nền, có `aria-label="Đóng"`, bấm được bằng bàn phím: nhỏ nhưng không giấu.
- Trên iPhone: hình vẫn nhỏ (22 px) nhưng vùng bấm 40 px, vì Apple yêu cầu vùng chạm đủ lớn và có thể từ chối app có
  hộp thoại khó đóng.
- Đóng xong: thanh trên cùng còn nhãn nhỏ **"Thêm email"** (có chấm vàng) để khách tự mở lại; nhãn mất khi đã lưu email.

### 2.4 Hai màn của form (đã dựng trong bản thiết kế)

**Màn nhập** (khách chưa có email nào):

- Nhãn nhỏ "BẢO VỆ TÀI KHOẢN", tiêu đề **"Giữ tài khoản luôn trong tầm tay"**, dòng phụ "Tài khoản **<tên đăng nhập>** chưa
  có email. Thêm ngay, chỉ mất 10 giây."
- Bốn lợi ích: ba mục đích anh nêu (*Quên mật khẩu, lấy lại trong 1 phút* · *Nhận bản cài và link đăng nhập* ·
  *Lưu sẵn thông tin tài khoản*) và *Báo cáo chiến dịch mỗi sáng* ("Gửi lúc 07:00, tắt được bất cứ lúc nào trong Cài đặt
  chung") vì có email là hệ thống tự bật báo cáo này.
- Ô "Email của bạn"; gõ phần trước `@` thì hiện nút chọn nhanh `@gmail.com` `@yahoo.com` `@outlook.com` `@icloud.com`.
- Gõ nhầm tên miền (`gmial.com`, `gmail.con`, `gmail.vn`…) thì hiện "Có phải bạn muốn nhập …@gmail.com?" với **Sửa giúp** /
  **Giữ nguyên**; nút Lưu chờ khách chọn.
- Nút chính **Lưu email**, dòng cam kết: "Email chỉ dùng cho tài khoản và thông báo của phần mềm. Đổi được bất cứ lúc nào
  trong Thông tin tài khoản."

**Màn xác nhận** (chỉ dùng khi có lý do hỏi lại người đã có email, Q10 / mục 2.5):

- Tiêu đề **"Bạn vẫn dùng email này chứ?"**, hiện **nguyên email** (không che), nút chính **Đúng, tôi đang dùng email này**,
  nút phụ **Đổi sang email khác** (mở màn nhập). Không bắt nhập gì.
- Email hiện ra là email của chính tài khoản đang đăng nhập (admin thấy email tổ chức / CRM của tổ chức mình), không lộ cho
  người khác.

**Đã lưu**: dấu tích xanh, "Đã lưu email", "Thông tin tài khoản sẽ gửi về <email>. Chúng tôi vừa gửi một thư xác nhận…",
khối "Trong thư có" (tên đăng nhập + gói + hạn, link tải bản cài + link đăng nhập Web, link Lấy lại tài khoản), nút
**Vào làm việc**.

### 2.5 Khi nào hỏi lại người đã có email

Mặc định **không hỏi** (chốt 1). Màn xác nhận để sẵn cho các trường hợp sau, mỗi trường hợp chỉ bật khi anh đồng ý:

- 788 admin có email ở tổ chức / CRM mà tài khoản trống: **không dùng màn này**, anh chốt tự chép (mục 3.3).
- Sau này: thư gửi tới email bị trả về, hoặc email chưa từng được khách xác nhận quá lâu.

## 3. Lưu email ở đâu

### 3.1 Theo vai trò

| Người lưu | `org_staff` | `org_organization` | `aka_customer` (khách của `org_organization.customer_id`) |
| --- | --- | --- | --- |
| Admin tổ chức (`org_staff.is_admin = true`) | ghi đè `email`, cập nhật danh sách | ghi đè `email`, cập nhật danh sách | ghi đè `email`, cập nhật danh sách |
| Tài khoản khác | ghi đè `email`, cập nhật danh sách | không | không |

- **"Admin"** = cờ `org_staff.is_admin`. Lệch với `org_organization.staff_admin_id` ở 4 người; 1 tổ chức có 2 admin cùng
  chưa có email (ai lưu sau thì email tổ chức / CRM là của người đó; email trước vẫn còn trong danh sách).
- **Khách CRM nào**: luôn lấy `org_organization.customer_id` (luôn có). 229 admin có `org_staff.akacustomer_id` trống, số còn
  lại trùng với khách của tổ chức. Không có index unique theo email trên `aka_customer`.
- Ba lệnh ghi nằm trong **một giao dịch**: lỗi ở bước nào thì không ghi bước nào.
- Cờ "Từ chối nhận email CSKH" (`aka_customer.is_email_unsubscribed`) giữ nguyên khi đổi email.
- Hệ quả: email CSKH tự động của CRM gửi tới email mới; trang "Lấy lại tài khoản" dùng được ngay với email mới + SĐT.
- Ghi `org_organization.email` chạy trigger đồng bộ đơn hàng CRM (`trg_sync_organization_orders` → `aka_order`). Ghi
  `aka_customer.email` chạy các trigger BEFORE UPDATE có sẵn (`trigger_customer_updated_at`, `trg_auto_pipeline_stage`,
  `trg_auto_map_staff_id`…), giống khi sale sửa khách. Mỗi khách chỉ ghi một lần nên chấp nhận được.

### 3.2 Danh sách email (`email_list`) trên cả ba bảng

- Cột mới `email_list text[] NOT NULL DEFAULT '{}'` trên `org_staff`, `org_organization`, `aka_customer`.
- Nội dung: mọi email từng dùng, viết thường, không trùng, **mới nhất đứng đầu**, **gồm cả email hiện tại**; tối đa 20 email.
- Cập nhật bằng **trigger** `BEFORE INSERT OR UPDATE OF email` trên từng bảng: email đổi thì đưa email mới lên đầu và giữ
  email cũ trong danh sách. Nhờ trigger, danh sách đúng cho **mọi đường sửa email**, không chỉ form này: sale sửa trong CRM,
  quản lý nhân viên trên Web, đăng ký dùng thử, lệnh SQL tay.
- Xoá trống `email` thì danh sách giữ nguyên (không mất lịch sử).
- Điền sẵn cho dữ liệu cũ (chạy một lần, buổi tối, chia lô 200 dòng): `org_staff` 137 dòng, `org_organization` 332 dòng,
  `aka_customer` 1.284 dòng nối với tổ chức. 19.684 khách CRM còn lại (khách tiềm năng chưa dùng phần mềm) không điền sẵn để
  khỏi chạm 2 vạn dòng CRM; danh sách của họ bắt đầu từ lần đổi email đầu tiên. Lưu ý: điền sẵn `aka_customer` làm đổi
  `updated_at` của 1.284 khách đó (trigger có sẵn).

### 3.3 Admin có email ở tổ chức / CRM nhưng tài khoản trống (788 người)

Theo chốt 1, nhóm này **không bị hỏi**. Nhưng 603 người trong đó chỉ có email ở CRM, mà trang "Lấy lại tài khoản" không đọc
CRM, nên hiện họ **không tự lấy lại tài khoản được**. Ở những người có cả hai, email tổ chức và email CRM luôn trùng nhau.

**Anh chốt: tự chép, không hỏi.** Cách làm:

- Lệnh `state` (gọi lúc admin vào app) thấy admin có email ở 1 trong 3 chỗ mà chỗ khác trống thì chép email đó vào **những chỗ
  đang trống** trong ba chỗ, rồi trả `show: 'none'`. Khách không thấy gì.
- Chỉ điền chỗ trống, không ghi đè: đây không phải khách vừa nhập email mới. Trigger tự đưa email vào `email_list`.
- Ưu tiên nguồn khi có hơn một: `org_staff` → `org_organization` → `aka_customer` (đo 25/11: chưa có ca nào hai nguồn khác
  nhau). Email chép phải "dùng được" (đúng định dạng, không thuộc tên miền gõ nhầm); không dùng được thì coi như không có.
- Rải theo lượt đăng nhập nên không ghi hàng loạt; admin không mở app thì chưa được chép. Muốn chép hết ngay thì chạy một lần
  cùng luật cho 788 admin (chia lô, buổi tối), cần anh đồng ý riêng.
- Ghi vào bảng trạng thái `saved_mode = 'synced'` để phân biệt với khách tự nhập.

### 3.4 Khác

- Hệ quả có sẵn: trong vòng 1 giờ sau khi lưu, lượt gieo thông báo tự bật email "Chào ngày mới" 07:00 cho tài khoản này
  (nếu tài khoản chưa từng được tự điền và chưa từ chối). Có thể thêm một dòng "Báo cáo chiến dịch mỗi sáng, tắt được bất cứ
  lúc nào" trong form (Q7).
- Đổi email sau này: thêm dòng **Email** + nút **Đổi** trong "Thông tin tài khoản" (Desktop, Web, iOS), cùng luật ghi ở 3.1.

## 4. Xác minh email (đã chốt: lưu ngay + thư xác nhận)

- Thư chào **không chứa mật khẩu** (email chưa xác nhận). Mật khẩu chỉ gửi qua luồng "Lấy lại tài khoản" có sẵn (phải khớp
  cả SĐT).
- Thư có: tên đăng nhập, gói + hạn, link tải bản cài, link đăng nhập Web, link Lấy lại tài khoản, nút **Xác nhận email** và
  dòng "Không phải bạn? Bấm vào đây" (gỡ email khỏi tài khoản, email vẫn nằm trong danh sách để tra cứu).
- Trạng thái xác nhận lưu ở bảng trạng thái (mục 5.1), không thêm cột xác nhận vào `org_staff`.
- Gửi bằng bộ gửi email của trung tâm thông báo (worker 30 giây của API Web trên Fly, tài khoản gửi có cờ
  `is_send_noti_akabiz`); thêm loại nội dung `account.email_saved`. Link xác nhận ký HMAC như link từ chối email của CRM,
  không lưu mã.

## 5. Kỹ thuật (để duyệt, chưa làm)

### 5.1 Database: SQL nháp, **chưa chạy, cần anh duyệt** (CLAUDE.md: không tự thêm bảng / cột)

Số migration lấy lúc apply (kiểm sổ `supabase_migrations.schema_migrations` và mọi nhánh ngay trước khi apply). Ba bảng đều
nóng (`org_staff` đọc mỗi lần đăng nhập, `aka_customer` cron CRM liên tục): mỗi `ALTER TABLE` một giao dịch riêng, chỉ vài
mili giây, `lock_timeout` 3 giây, chạy buổi tối; mỗi lệnh làm PostgREST nạp lại schema một lần.

```sql
-- Phần 1: ba cột danh sách email (mỗi lệnh một giao dịch; DEFAULT hằng số nên không viết lại bảng).
SET lock_timeout = '3s';
ALTER TABLE public.org_staff        ADD COLUMN email_list text[] NOT NULL DEFAULT '{}';
-- (giao dịch mới)
SET lock_timeout = '3s';
ALTER TABLE public.org_organization ADD COLUMN email_list text[] NOT NULL DEFAULT '{}';
-- (giao dịch mới)
SET lock_timeout = '3s';
ALTER TABLE public.aka_customer     ADD COLUMN email_list text[] NOT NULL DEFAULT '{}';

-- Phần 2: trigger giữ danh sách, dùng chung cho ba bảng.
CREATE FUNCTION private.track_email_list() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  v_new text := lower(btrim(coalesce(NEW.email, '')));
  v_old text := CASE WHEN TG_OP = 'UPDATE' THEN lower(btrim(coalesce(OLD.email, ''))) ELSE '' END;
BEGIN
  IF v_new = '' OR v_new = v_old AND v_new = any (NEW.email_list) THEN RETURN NEW; END IF;
  NEW.email_list := (
    SELECT coalesce(array_agg(e ORDER BY ord), '{}')
      FROM (SELECT e, min(ord) AS ord
              FROM unnest(array[v_new, nullif(v_old, '')] || NEW.email_list) WITH ORDINALITY AS t(e, ord)
             WHERE e IS NOT NULL AND e <> ''
             GROUP BY e
             ORDER BY min(ord)
             LIMIT 20) x);
  RETURN NEW;
END $$;
CREATE TRIGGER trg_email_list_track BEFORE INSERT OR UPDATE OF email ON public.org_staff
  FOR EACH ROW EXECUTE FUNCTION private.track_email_list();
CREATE TRIGGER trg_email_list_track BEFORE INSERT OR UPDATE OF email ON public.org_organization
  FOR EACH ROW EXECUTE FUNCTION private.track_email_list();
CREATE TRIGGER trg_email_list_track BEFORE INSERT OR UPDATE OF email ON public.aka_customer
  FOR EACH ROW EXECUTE FUNCTION private.track_email_list();

-- Phần 3: trạng thái form của từng tài khoản (không thêm cột trạng thái vào org_staff).
CREATE TABLE private.aka_staff_email_prompt (
  staff_id          bigint PRIMARY KEY REFERENCES public.org_staff(id) ON DELETE CASCADE,
  organization_id   bigint NOT NULL,
  shown_count       integer NOT NULL DEFAULT 0,
  last_shown_at     timestamptz,
  dismiss_count     integer NOT NULL DEFAULT 0,
  last_dismissed_at timestamptz,
  saved_at          timestamptz,
  saved_email       text,
  saved_mode        text CHECK (saved_mode IN ('typed', 'confirmed', 'synced')),
  saved_client      text CHECK (saved_client IN ('desktop', 'web', 'ios')),
  saved_as_admin    boolean,
  crm_customer_id   bigint,
  verify_sent_at    timestamptz,
  verified_at       timestamptz,
  updated_at        timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE private.aka_staff_email_prompt ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.aka_staff_email_prompt FROM PUBLIC, anon, authenticated, aka_agent_desktop, aka_agent_chat_api;

-- Công tắc: mặc định tắt.
INSERT INTO public.auto_system_settings (key, value, is_active)
VALUES ('account.email_prompt', '{"audience":"off","repromptHours":24,"verify":"link"}', true)
ON CONFLICT (key) DO NOTHING;

-- Phần 4 (chạy riêng, buổi tối, chia lô 200 dòng): điền danh sách cho dữ liệu cũ.
-- UPDATE ... SET email_list = array[lower(btrim(email))]
--  WHERE nullif(btrim(email), '') IS NOT NULL AND email_list = '{}' AND id IN (<lô>);
-- org_staff 137, org_organization 332, aka_customer 1.284 (chỉ khách nối với tổ chức).
```

Ba hàm, chung một lõi `private.aka_agent_email_prompt_core(staff, org, action, payload)`:

- `public.aka_agent_email_prompt(p_action, p_payload)`: chỉ `aka_agent_desktop`, nhân viên lấy từ phiên Desktop.
- `public.aka_agent_control_email_prompt(p_staff_id, p_org_id, p_action, p_payload)`: chỉ `service_role` (API Web cho Web/iOS).
- Lệnh:
  - `state` → `{show: 'none' | 'enter' | 'confirm', username, email}` (`email` chỉ có ở `confirm`, là email của chính
    tài khoản / tổ chức đang đăng nhập); admin có email ở 1 trong 3 chỗ thì tự chép vào chỗ trống trước khi trả `none`
    (mục 3.3);
  - `save` `{email | confirm: true, client}` → kiểm định dạng + tên miền nhầm, ghi theo bảng 3.1 trong một giao dịch
    (trigger tự cập nhật `email_list`), ghi `saved_*`, xếp thư xác nhận; tối đa 5 lần / giờ / tài khoản;
  - `dismiss` `{client}` → tăng `dismiss_count`, đặt `last_dismissed_at`.

### 5.2 Desktop (akaAgent)

**Đã code 25/11/2026 (nhánh `claude/relaxed-albattani-c1volz`, chưa merge, chưa build Desktop, chưa chạy Electron thật):**
main `src/main/data/repositories/emailPromptRepository.ts` + `src/main/ipc/handlers/emailPromptHandlers.ts` (kênh
`email-prompt:call`), phần riêng Desktop `src/shared/emailPromptDesktop.ts`, renderer `stores/emailPromptStore.ts` +
`components/EmailPrompt/`. Công tắc không đọc riêng: lệnh `state` tự trả `enabled:false` khi tắt. Lượt gọi DB: 1 `state`
~1,5 giây sau khi vào giao diện chính, thêm 1 `state` khi sang ngày VN mới (kiểm lúc focus / hiện lại cửa sổ hoặc khi bộ
nhắc gia hạn đổi ngày) nếu chưa có email; 1 `dismiss` khi bấm ×; 1 `save` mỗi lần lưu; 1 `profile` khi mở Thông tin tài
khoản (và sau khi lưu). Không chồng hộp thoại: chờ bộ nhắc gia hạn nhận trạng thái (tối đa 8 giây), hộp nhắc / cửa sổ
Gia hạn gói, form Nâng cấp và mua gói đóng, và không còn `.modal-overlay` / `[aria-modal="true"]` nào khác (hộp cập nhật,
form chiến dịch...), kiểm DOM 0,8 giây/lần (không gọi DB), hai lần liền trống mới hiện. Kiểm:
`node scripts/staff-email-prompt/desktop-email-prompt-smoke.cjs` (12 nhóm),
`node scripts/staff-email-prompt/run-email-prompt-ui-smoke.cjs` (15 ca, Chromium của Playwright với IPC giả).


- Công tắc đọc chung câu `getDesktopPollingSettings` lúc đăng nhập (không thêm request).
- Một IPC `email-prompt:call` → RPC `aka_agent_email_prompt`; trả `{ok,data}|{ok:false,code,message}`; DB chưa có hàm thì
  im lặng không hiện form.
- Số lượt gọi DB: 1 lượt `state` lúc vào app (và 1 lượt khi sang ngày mới nếu chưa lưu), 1 lượt khi lưu hoặc đóng.
- Component `components/EmailPrompt/` (hai màn + nhãn "Thêm email" trên TopBar), store riêng, gắn trong `App.tsx` cạnh
  `RenewalReminderHost`; hàng đợi hộp thoại để không chồng lên nhắc gia hạn / cập nhật.
- Hợp đồng dùng chung `src/shared/emailPrompt.ts` chép nguyên văn từ WebApp `packages/control-api` (như các tính năng khác).

### 5.3 Web + iOS (akaAgentWebApp)

- `/me` trả thêm `emailPrompt` (đỡ một request); `POST /api/aka-agent/control/v1/me/email-prompt` cho `save` / `dismiss`.
- Web: cùng hộp thoại như Desktop. iOS: tấm trượt từ dưới lên (màn iPhone trong bản thiết kế), vùng bấm nút × 40 px.
- Anh chốt làm Desktop + Web trước (phủ gần hết người dùng; chỉ 29 người có dùng iPhone, 1 người chỉ dùng iPhone), iOS ở bản
  phát hành sau.

### 5.4 CRM (SqlServerDashboard)

- Hồ sơ khách hiện thêm danh sách email (`aka_customer.email_list`), chỉ đọc.
- Nếu chọn cách C ở Q10: trang "Lấy lại tài khoản" khớp thêm `aka_customer.email` + SĐT.

## 6. Đưa vào dùng và đo

1. Anh duyệt SQL → apply phần 1–3 (buổi tối) → phần 4 chia lô.
2. Deploy API/Web, công tắc `audience: admin_akabiz` để nội bộ thử; rồi `all`. Tắt khẩn cấp: `audience: off`, có hiệu lực ngay.
3. Phát hành Desktop (bản app cũ không có form, không ảnh hưởng).
4. Đo hằng ngày từ bảng `private.aka_staff_email_prompt`: số người thấy form, số lần đóng, số người lưu (gõ tay / xác nhận),
   số người xác nhận qua thư, số người "Lấy lại tài khoản" thành công.

## 7. Câu hỏi còn mở

| # | Câu hỏi | Mặc định nếu anh không nói gì |
| --- | --- | --- |
| Q6 | Khách đang dùng thử có thấy form không | Có |
| Q11 | Chép ngay một lần cho 788 admin (chia lô, buổi tối) hay chỉ chép dần khi họ đăng nhập | Chép dần khi đăng nhập |

Đã chốt và bỏ khỏi bảng: Q1 (có 1 trong 3 thì không hỏi), Q2 (mỗi ngày hỏi lại một lần), Q3 (lưu ngay + thư xác nhận),
Q4 / Q4b (admin ghi cả ba, ghi đè, có danh sách email), Q5 (Desktop + Web trước), Q7 (thêm dòng báo cáo mỗi sáng),
Q8 / Q9 (có email ở 1 trong 3 chỗ là không hỏi, kể cả nhân viên), Q10 (788 admin: tự chép, không hỏi).

Trigger danh sách email (phần 2 của 5.1) đã chạy thử trên PostgreSQL 16 trong máy 25/11: nhập mới, đổi, gõ lại email cũ
(khác hoa / thường), xoá trống rồi nhập lại, dòng cũ có email mà danh sách trống: đều cho danh sách đúng.
