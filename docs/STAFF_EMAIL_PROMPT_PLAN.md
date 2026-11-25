# Xin email khách hàng sau khi đăng nhập: phương án (25/11/2026)

Yêu cầu (anh, 25/11/2026): khách **đang dùng gói**, sau khi đăng nhập vào giao diện chính, hệ thống kiểm tra khách đã có
email chưa. Chưa có thì mở form xin email, để: gửi bản cài / link đăng nhập, gửi thông tin tài khoản đăng nhập, lấy lại
tài khoản khi khách quên. Form chỉ tắt được bằng nút tắt, nút này thật nhỏ; mục tiêu là khách nhập email. Thiết kế tinh tế,
thu hút. **Chỉ lên phương án, chưa code.**

Bản thiết kế (5 màn, màn Desktop bấm thử được): https://claude.ai/artifact/NSgiQwdvquGqZPo89ZVVF8

Trạng thái: chưa code, chưa có migration, chưa đổi gì trên production. Mọi số liệu dưới đây đọc chỉ đọc ngày 25/11/2026.

## 1. Số liệu hiện tại

Phạm vi: nhân viên `org_staff` đang hoạt động, tổ chức có ít nhất một gói còn hạn (`org_organization_product`, theo ngày VN),
có mở Desktop (presence) hoặc Web/iOS (`auto_control_sessions`) trong 30 ngày.

| Chỉ số | Số người |
| --- | --- |
| Đang dùng gói, có dùng app trong 30 ngày | 1.054 |
| Chưa có email ở **tài khoản đăng nhập** (`org_staff.email` trống/sai) | **952** |
| Trong đó hiện **không tự lấy lại tài khoản được** (không email tài khoản, không email tổ chức) | ~769 |
| Không có email ở **bất cứ đâu** (tài khoản, tổ chức, CRM) | 278 |
| Có sẵn email ở hồ sơ tổ chức / CRM, gợi ý một chạm được | ~670 |
| Là chủ tài khoản của tổ chức (`is_admin`) | 916 / 952 |
| Tổ chức có nhiều tài khoản | 38 / 952 |
| Chỉ có gói dùng thử | 45 / 952 |
| Có dùng Desktop hoặc Web / có dùng iPhone / chỉ dùng iPhone | 951 / 29 / 1 |

Các nơi đang dùng email của khách:

- **Lấy lại tài khoản** (cổng CRM `/gia-han/lay-lai-tai-khoan`): khớp **cả** email lẫn SĐT trên cùng `org_organization`
  hoặc `org_staff` rồi gửi tên đăng nhập + mật khẩu (SqlServerDashboard `docs/trang-gia-han-khach-hang.md`). Không đọc
  `aka_customer.email`.
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
2. Tổ chức có gói còn hạn (gồm cả dùng thử, xem câu hỏi Q6). Đã hết gói thì app đang ở màn Gia hạn, không hiện form.
3. **Chưa có email dùng được** (định nghĩa ở Q1; khuyên: `org_staff.email` trống hoặc sai định dạng / tên miền gõ nhầm).
4. Chưa tắt form trong khoảng thời gian chờ (Q2; khuyên: tắt rồi thì hôm sau mới hiện lại).
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

### 2.4 Nội dung form (đã dựng trong bản thiết kế)

- Nhãn nhỏ "BẢO VỆ TÀI KHOẢN", tiêu đề **"Giữ tài khoản luôn trong tầm tay"**, dòng phụ "Tài khoản **<tên đăng nhập>** chưa
  có email. Thêm ngay, chỉ mất 10 giây."
- Ba lợi ích, đúng ba mục đích anh nêu: *Quên mật khẩu, lấy lại trong 1 phút* · *Nhận bản cài và link đăng nhập* ·
  *Lưu sẵn thông tin tài khoản*.
- Ô "Email của bạn" có biểu tượng thư; gõ phần trước `@` thì hiện nút chọn nhanh `@gmail.com` `@yahoo.com` `@outlook.com`
  `@icloud.com`.
- Gõ nhầm tên miền (`gmial.com`, `gmail.con`, `gmail.vn`…) thì hiện "Có phải bạn muốn nhập …@gmail.com?" với **Sửa giúp** /
  **Giữ nguyên**; nút Lưu chờ khách chọn. Danh sách tên miền nhầm dùng chung với `aka_agent_notification_email_candidates`.
- Nút chính **Lưu email**, dòng cam kết dưới nút: "Email chỉ dùng cho tài khoản và thông báo của phần mềm. Đổi được bất cứ
  lúc nào trong Thông tin tài khoản."
- **Biến thể một chạm** (Q1): nếu hồ sơ tổ chức / CRM đã có email (khoảng 670 người), form hỏi "Đây có phải email của bạn?"
  và hiện email đã che (`ho••••••@gmail.com`), nút **Đúng, dùng email này** và **Dùng email khác**. Email thật không gửi
  xuống app; app chỉ gửi "dùng email gợi ý", DB tự lấy.
- **Đã lưu**: dấu tích xanh, "Đã lưu email", "Thông tin tài khoản sẽ gửi về <email>. Chúng tôi vừa gửi một thư xác nhận…",
  khối "Trong thư có" (tên đăng nhập + gói + hạn, link tải bản cài + link đăng nhập Web, link Lấy lại tài khoản),
  nút **Vào làm việc**.

## 3. Lưu email ở đâu

**Anh chốt Q4 (25/11/2026):** người lưu là **admin tổ chức** thì lưu vào cả `org_staff`, `org_organization` và
`aka_customer`; không phải admin thì chỉ lưu `org_staff`.

| Người lưu | `org_staff.email` | `org_organization.email` | `aka_customer.email` |
| --- | --- | --- | --- |
| Admin tổ chức (`org_staff.is_admin = true`) | ghi | ghi | ghi |
| Tài khoản khác | ghi | không | không |

Chi tiết đã kiểm trên dữ liệu thật 25/11 (916 admin đang dùng gói chưa có email tài khoản):

- **"Admin"** = cờ `org_staff.is_admin`. Lệch với `org_organization.staff_admin_id` ở 4 người, 1 tổ chức có 2 admin cùng
  chưa có email (ai lưu sau thì email tổ chức / CRM là của người đó).
- **Khách CRM nào**: lấy `org_organization.customer_id` (luôn có). 229 admin có `org_staff.akacustomer_id` trống, số còn lại
  trùng với khách của tổ chức. Không có index unique theo email trên `aka_customer`.
- **Đã có email sẵn**: CRM đã có email ở **785 / 916** admin, tổ chức đã có email ở **183 / 916**. Ghi đè hay chỉ điền khi
  trống: chờ anh chốt (Q4b). Dù chọn cách nào, email cũ được lưu lại trong bảng trạng thái (mục 5.1) để tra cứu và trả lại.
- Ghi `org_organization.email` chạy trigger đồng bộ đơn hàng CRM (`trg_sync_organization_orders` → `aka_order`). Ghi
  `aka_customer.email` chạy các trigger BEFORE UPDATE có sẵn (`trigger_customer_updated_at`, `trg_auto_pipeline_stage`,
  `trg_auto_map_staff_id`…), giống khi sale sửa khách. Mỗi khách chỉ ghi một lần nên chấp nhận được.
- Cờ "Từ chối nhận email CSKH" (`aka_customer.is_email_unsubscribed`) giữ nguyên khi đổi email.
- Hệ quả của việc ghi CRM: email CSKH tự động của CRM (nhắc gia hạn, timeline) gửi tới email mới.
- `org_staff.email` là chỗ cổng "Lấy lại tài khoản" đọc (khớp cùng SĐT của tài khoản) và là nguồn `profile` của thông báo;
  không có index unique, trigger UPDATE của `org_staff` không xét cột email.
- Ba lệnh ghi nằm trong cùng một giao dịch: lỗi ở bước nào thì không ghi bước nào.

Hệ quả có sẵn, cần biết: trong vòng 1 giờ sau khi lưu, lượt gieo thông báo tự bật email "Chào ngày mới" 07:00 cho tài khoản
này (nếu tài khoản chưa từng được tự điền và chưa từ chối). Form nói "thông báo của phần mềm" nên khớp; muốn rõ hơn có thể
thêm một dòng "Báo cáo chiến dịch mỗi sáng, tắt được bất cứ lúc nào" (Q7).

Đổi email sau này: thêm dòng **Email** + nút **Đổi** trong "Thông tin tài khoản" (Desktop, Web, iOS), vì form hứa điều này.

## 4. Xác minh email (Q3)

| Cách | Ưu | Nhược |
| --- | --- | --- |
| **A. Lưu ngay, gửi thư xác nhận** (khuyên) | Một bước, ít người bỏ dở; gõ nhầm vẫn bắt được nhờ gợi ý tên miền | Email gõ nhầm phần tên (`hoangmia@`) vẫn được lưu tới khi khách tự sửa |
| B. Mã 6 số ngay trong form | Chắc chắn đúng email | Thêm một bước, phải chờ thư; khách đang muốn vào làm việc dễ bấm × |
| C. Không xác minh | Đơn giản nhất | Không biết email nào thật |

Với A: thư chào **không chứa mật khẩu** (email chưa xác nhận). Mật khẩu chỉ gửi qua luồng "Lấy lại tài khoản" có sẵn (phải
khớp cả SĐT). Thư có nút **Xác nhận email** và dòng "Không phải bạn? Bấm vào đây" (gỡ email khỏi tài khoản).
Trạng thái xác nhận lưu ở bảng mới (mục 5), không thêm cột vào `org_staff`.

## 5. Kỹ thuật (để duyệt, chưa làm)

### 5.1 Database: SQL nháp, **chưa chạy, cần anh duyệt** (CLAUDE.md: không tự thêm bảng / cột)

Số migration lấy lúc apply (kiểm sổ `supabase_migrations.schema_migrations` và mọi nhánh ngay trước khi apply).

```sql
-- Trạng thái form của từng tài khoản: không thêm cột vào org_staff (bảng nóng).
CREATE TABLE private.aka_staff_email_prompt (
  staff_id          bigint PRIMARY KEY REFERENCES public.org_staff(id) ON DELETE CASCADE,
  organization_id   bigint NOT NULL,
  shown_count       integer NOT NULL DEFAULT 0,
  last_shown_at     timestamptz,
  dismiss_count     integer NOT NULL DEFAULT 0,
  last_dismissed_at timestamptz,
  saved_at          timestamptz,
  saved_email       text,
  saved_source      text CHECK (saved_source IN ('typed', 'suggestion')),
  saved_client      text CHECK (saved_client IN ('desktop', 'web', 'ios')),
  saved_as_admin    boolean,
  org_email_before  text,   -- email tổ chức trước khi ghi (chỉ khi người lưu là admin)
  crm_email_before  text,   -- email CRM trước khi ghi (chỉ khi người lưu là admin)
  crm_customer_id   bigint, -- khách CRM đã ghi (org_organization.customer_id)
  verify_sent_at    timestamptz,
  verified_at       timestamptz,
  updated_at        timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE private.aka_staff_email_prompt ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.aka_staff_email_prompt FROM PUBLIC, anon, authenticated, aka_agent_desktop, aka_agent_chat_api;

-- Công tắc: mặc định tắt.
INSERT INTO public.auto_system_settings (key, value, is_active)
VALUES ('account.email_prompt',
        '{"audience":"off","repromptHours":24,"verify":"link","adminWrite":"overwrite"}', true)
ON CONFLICT (key) DO NOTHING;
```

Ba hàm, chung một lõi `private.aka_agent_email_prompt_core(staff, org, action, payload)`:

- `public.aka_agent_email_prompt(p_action, p_payload)`: chỉ `aka_agent_desktop`, nhân viên lấy từ phiên Desktop.
- `public.aka_agent_control_email_prompt(p_staff_id, p_org_id, p_action, p_payload)`: chỉ `service_role` (API Web cho Web/iOS).
- Lệnh `state` → `{show, username, suggestion: {masked, source} | null}`; `save` `{email | useSuggestion, client}` → kiểm
  định dạng + tên miền nhầm, ghi `org_staff.email`; người lưu là admin (`is_admin`) thì ghi thêm `org_organization.email` và
  `aka_customer.email` của `org_organization.customer_id` (theo `adminWrite`: `overwrite` hoặc `fill_empty`, Q4b), lưu email
  cũ vào `*_before`; cả ba trong một giao dịch, ghi `saved_*`; `dismiss` `{client}` →
  tăng `dismiss_count`. `save` tối đa 5 lần / giờ / tài khoản. Email thật của gợi ý không bao giờ trả ra.

Gửi thư chào + xác nhận: dùng bộ gửi email của trung tâm thông báo (worker 30 giây của API Web trên Fly, tài khoản gửi có cờ
`is_send_noti_akabiz`); thêm một loại nội dung `account.email_saved`. Link xác nhận ký HMAC như link từ chối email của CRM,
không lưu mã.

### 5.2 Desktop (akaAgent)

- Công tắc đọc chung câu `getDesktopPollingSettings` lúc đăng nhập (không thêm request).
- Một IPC `email-prompt:call` → RPC `aka_agent_email_prompt`; trả `{ok,data}|{ok:false,code,message}`; DB chưa có hàm thì
  im lặng không hiện form.
- Số lượt gọi DB: 1 lượt `state` lúc vào app (và 1 lượt khi sang ngày mới nếu chưa lưu), 1 lượt khi lưu hoặc đóng.
- Component `components/EmailPrompt/` (hộp thoại + nhãn "Thêm email" trên TopBar), store riêng, gắn trong `App.tsx` cạnh
  `RenewalReminderHost`; hàng đợi hộp thoại để không chồng lên nhắc gia hạn / cập nhật.
- Hợp đồng dùng chung `src/shared/emailPrompt.ts` chép nguyên văn từ WebApp `packages/control-api` (như các tính năng khác).

### 5.3 Web + iOS (akaAgentWebApp)

- `/me` trả thêm `emailPrompt` (đỡ một request); `POST /api/aka-agent/control/v1/me/email-prompt` cho `save` / `dismiss`.
- Web: cùng hộp thoại như Desktop. iOS: tấm trượt từ dưới lên (màn iPhone trong bản thiết kế), vùng bấm nút × 40 px.
- Khuyên làm Desktop + Web trước (phủ 951 / 952 người; chỉ 29 người có dùng iPhone, 1 người chỉ dùng iPhone), iOS ở bản phát hành sau.

## 6. Đưa vào dùng và đo

1. Anh duyệt SQL → apply (buổi tối, có DDL nên PostgREST nạp lại schema).
2. Deploy API/Web, công tắc `audience: admin_akabiz` để nội bộ thử; rồi `all`. Tắt khẩn cấp: `audience: off`, có hiệu lực ngay.
3. Phát hành Desktop (bản app cũ không có form, không ảnh hưởng).
4. Đo hằng ngày từ bảng `private.aka_staff_email_prompt`: số người thấy form, số lần đóng, số người lưu (gõ tay / một chạm),
   số người xác nhận, số người "Lấy lại tài khoản" thành công.

## 7. Câu hỏi cần anh chốt

| # | Câu hỏi | Lựa chọn | Khuyên |
| --- | --- | --- | --- |
| Q1 | **Đã chốt 25/11: chỉ email tài khoản đăng nhập** (kèm biến thể một chạm). Thế nào là "đã có email" | A. Chỉ email của tài khoản đăng nhập: **952** người thấy form · B. Có email ở bất cứ đâu (tài khoản, tổ chức, CRM): **278** người | A, kèm biến thể một chạm cho ~670 người đã có email trong hồ sơ |
| Q2 | **Đã chốt 25/11: mỗi ngày một lần**, kèm nhãn "Thêm email". Bấm × rồi khi nào hiện lại | Mỗi lần đăng nhập · Mỗi ngày một lần · Giãn dần (1, 3, 7 ngày) | Mỗi ngày một lần, không giới hạn số ngày, kèm nhãn "Thêm email" |
| Q3 | **Đã chốt 25/11: lưu ngay + thư xác nhận, thư không chứa mật khẩu**. Xác minh email | A. Lưu ngay + thư xác nhận · B. Mã 6 số trong form · C. Không xác minh | A, thư không chứa mật khẩu |
| Q4 | Ghi thêm vào hồ sơ tổ chức / CRM | **Đã chốt 25/11**: admin tổ chức ghi cả `org_staff`, `org_organization`, `aka_customer`; người khác chỉ `org_staff` | |
| Q4b | Tổ chức / CRM (`aka_customer`, nối qua `org_organization.customer_id`) đã có email khác (CRM 785, tổ chức 183 trong 916 admin) | Ghi đè bằng email khách vừa nhập · Chỉ điền khi đang trống | Ghi đè (khách tự nhập là mới nhất), lưu email cũ để trả lại |
| Q5 | Nền tảng | Desktop + Web trước · Cả iOS cùng lúc | Desktop + Web trước |
| Q6 | Khách đang dùng thử có thấy không | Có · Không | Có (45 người) |
| Q7 | Nói rõ email báo cáo mỗi sáng sẽ tự bật | Thêm một dòng trong form · Không nói thêm | Thêm một dòng |
| Q8 | Tổ chức nhiều tài khoản (38 người) | Mỗi tài khoản tự nhập email riêng · Chỉ hỏi chủ tổ chức | Mỗi tài khoản tự nhập |
