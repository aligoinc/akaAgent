# V603: nhắn tin bạn bè / theo UID không thấy ô nhập tin Messenger — nhận chữ Facebook ra FB19

Câu 570 của hộp thư lỗi (bộ kiểm lỗi chiến dịch Facebook, engine v2). Anh chốt 20/11/2026 qua hộp chọn. Migration
[V603](../migrations/migration_v603_engine_facebook_messenger_signs.sql), sinh bằng `node scripts/build-v603-sql.cjs`
(nguồn kiểm [`v603-live-20261120.json`](../scripts/fixtures/engine-v2-facebook/v603-live-20261120.json), đọc 16:20 VN 20/11), gỡ bằng
[rollback](../migrations/rollback_v603_engine_facebook_messenger_signs.sql).

**Đã apply akachat 16:39:11 VN 20/11/2026** theo yêu cầu ("Apply V603"): sổ `20261120093910`, md5 sổ = file `f6193eb4…`, 2 giây, chỉ dữ liệu; block 2855 `fb11e928…` → `9585b3ce…` (bộ cũ 38 giữ nguyên), dấu hiệu `dc7fd786…` → `a8eb2065…`, element 1811–1812, mã FB19 `auto_error` 78 (đổi câu) + 177 (mới), chính sách 435–438; phút apply 0 lỗi 5xx. [Biên nhận](../migrations/snapshots/engine-facebook-v603/apply-receipt.json). Code đã merge `dev_3` qua PR [#757](https://github.com/aligoinc/akaAgent/pull/757) ngày 20/11 theo yêu cầu ("Merge PR #757"; nhánh `claude/fb-error-570-messenger-signs`). Chỉ dữ liệu, không DDL, không phát hành app.

## Ca lỗi

Nhắn tin bạn bè (`fb_message_friend`, workflow 323) và nhắn tin theo UID (`fb_message_stranger`, workflow 324) dùng chung block engine **2855**
`[engine] fb_send_message` (cùng code với bộ cũ 38). Block mở trang Messenger của người nhận, chờ nút "Đóng" 3 giây, chờ nút "Tiếp tục" 2 giây, rồi
chờ ô nhập tin (`fb_messenger_textbox`) 15 giây. Hết giờ chỉ dò câu "giới hạn tin nhắn đang chờ" (FB01); không thấy thì trả `ok: false` với câu
`waitForSelector timeout: [role="textbox"][contenteditable="true"]` → dòng "thất bại" không mã → luật 103 → FB42 (chính sách 340: tính lượt,
cộng chuỗi, data đóng). Khách thấy nguyên câu kỹ thuật.

Số liệu 20/11 (chỉ đọc production): 18 lượt từ 18/11, cùng chiến dịch 45597 / tài khoản 6968 / nhân viên 1351 / tổ chức 1247 (213 lượt nhắn, 8,5%
lỗi), 3 lượt trong 24 giờ, 0 lần dừng chiến dịch; cả ba bản app 9.9.0 / 10.0.0 / 10.1.0. Nhắn theo UID có 5 lượt FB42 cùng câu (3 chiến dịch),
chưa xem ảnh. Sau mỗi lượt lỗi, data kế tiếp đều gửi được (khoảng 75 giây sau); chuỗi lỗi chưa lần nào quá 1.

## Ảnh lỗi (yêu cầu ảnh 9, chiến dịch 45597, 18/18 ảnh, chưa có DOM)

Mọi ảnh: trang `/messages/t/…` không có ô nhập tin; cột trái có khung "Thiếu lịch sử chat · Hãy nhập mã PIN… · Nhập mã PIN".

| Nhóm | Ảnh | Facebook ghi ở chỗ ô nhập tin | Làm |
|---|---|---|---|
| A | 13 | "Những tin nhắn này được gửi trước khi đoạn chat được bảo mật bằng tính năng mã hóa đầu cuối. Do đó, bạn không thể trả lời…" + nút "Tiếp tục" (2 ảnh nút đang quay: block đã bấm) | **chưa làm**: anh chốt chờ DOM (chưa biết 11 lượt còn lại block không thấy nút hay bấm thất bại); vẫn FB42 |
| B | 4 | "<tên> chưa thể truy cập vào đoạn chat này. Bạn sẽ có thể gửi tin nhắn trong lần tiếp theo <tên> đăng nhập vào Messenger" | FB19, mã nội bộ mới |
| C | 1 | "Bạn không thể nhắn tin cho tài khoản này. Bạn nên thêm họ làm bạn bè trên Facebook" + nút "Thêm bạn bè" | FB19, mã có sẵn |

## Anh chốt (20/11/2026)

- Cách xử lý: **như FB26 hộp thư Page** — đóng data, ghi lịch sử "thất bại", không tính lượt, không cộng chuỗi, chạy tiếp data sau. Bước còn lại của
  data giữ "continue" như FB42 hôm nay (nhắn theo UID có thể còn bước kết bạn sau).
- Áp cho **cả nhắn tin bạn bè và nhắn theo UID**.
- Câu cho khách: **2 câu theo chữ Facebook**, cùng FB19, không có bước tiếp theo. Dòng lịch sử:
  - nhóm B: "Người này chưa đăng nhập Messenger nên chưa nhận được tin (FB19)"
  - nhóm C: "Facebook chỉ cho nhắn tin khi đã kết bạn với người này (FB19)"

Hai câu cùng FB19 mà không kèm tên người nhận nên cần hai mã nội bộ (chính sách gắn theo mã, câu dòng lịch sử lấy từ `log_template` của chính sách),
như Z221 có bốn mã nội bộ:

| Mã nội bộ | Nhóm | Câu |
|---|---|---|
| `err_fb_messenger_unavailable_target_not_messageable` (có sẵn từ V346, chưa chỗ nào phát) | C | Facebook chỉ cho nhắn tin khi đã kết bạn với người này |
| `err_fb_messenger_recipient_cannot_access_chat` (mới, `target_permanent`) | B | Người này chưa đăng nhập Messenger nên chưa nhận được tin |

View `aka_agent_public_error_catalog` gộp theo mã công khai và lấy `min(customer_title)`, nên dòng FB19 ở đó hiện "Facebook chỉ cho nhắn tin…".
Desktop không đọc view này.

## Thay đổi (chỉ dữ liệu)

1. `auto_elements` thêm hai element, sửa được ở màn Element:
   - `FbMessengerCannotAccessChatNotice`: `//text()[contains(normalize-space(.), 'chưa thể truy cập vào đoạn chat này')]/..` (câu mở đầu bằng tên).
   - `FbMessengerFriendsOnlyNotice`: `//text()[starts-with(normalize-space(.), 'Bạn không thể nhắn tin cho tài khoản này')]/..` (câu sau có thể khác
     ở nhắn theo UID).
   - Dựng theo chữ trên ảnh, chưa có DOM thật (máy khách bản 10.1.0, trước #739). Một tin nhắn cũ trong đoạn chat có đúng câu đó, ở trang đã không
     có ô nhập tin, sẽ bị nhận nhầm; chưa thấy trường hợp này. Bản tiếng Anh nối thêm bằng `|` khi có mẫu.
2. Bản "[engine]" của block 2855 (bộ cũ 38 không đổi): hết giờ chờ ô nhập tin, sau bước dò FB01 như cũ, dò hai element trên rồi ném câu riêng
   (khối `catch` ngoài trả `ok: false` với câu đó). Không thấy câu nào thì vẫn câu hết giờ. md5 `fb11e928…` → `9585b3ce…`; md5 đã duyệt của danh
   mục bước 15 và 16 đổi theo.
3. `facebook.error_signs` nối thêm hai dấu hiệu nguồn `message` cho `fb_message_friend` + `fb_message_stranger`, `replaces: []` (dòng nhắn tin lỗi
   không mang mã). md5 `dc7fd786…` → `a8eb2065…`.
4. `auto_error`: FB19 có sẵn đổi `customer_title` (bộ cũ đọc `noti_*`, giữ nguyên); thêm mã nội bộ mới cùng FB19.
5. `auto_outcome_policies` thêm 4 dòng (2 mã × 2 thao tác), nguồn `v603`, khai đủ mọi cột hành vi.

Desktop ≥ 9.9.0 đọc dấu hiệu theo câu block và tự nạp element mới (`elementV2Repository.resolveXpathByName`), nên không cần bản app mới.

## Kiểm (20/11)

- `CHAT_REPO=<akaAgentChatApi> CHROMIUM_PATH=… LC_ALL=C node scripts/engine-v2-facebook/v603-smoke.cjs`: **16/16**.
  - PostgreSQL 17: DB như production (tới V597; dòng dấu hiệu, chính sách gộp FB19 / FB42 ở hai thao tác khớp production đọc 20/11). Chỉ FB19 ở hai
    thao tác nhắn tin và mã nội bộ mới đổi, mọi quyết định khác (gồm FB42) giữ nguyên; dòng lịch sử ra "<câu> (FB19)"; apply lại / sổ đã có V603
    bị từ chối; bản gỡ trả về đúng từng byte.
  - Chromium: chạy nguyên code block cũ và mới trên trang Messenger giả dựng theo ảnh, với bộ tìm phần tử chép từ `pageController.ts`. Nhóm B
    (hai cách chia thẻ), nhóm C (hai cách chia thẻ): bản cũ ra câu hết giờ (FB42), bản mới ra câu riêng → FB19 ở cả hai thao tác. Nhóm A (bấm
    "Tiếp tục" không ra ô nhập tin), trang không câu nào: vẫn FB42. FB01 vẫn ném `err_limit_waiting_message`. Gửi được vẫn gõ và bấm Enter.
- `FB_DESKTOP_ONLY=V603 node scripts/engine-v2-facebook/desktop-fb-smoke.cjs` (bộ lập lịch Desktop thật): 8 ca, ở cả chiến dịch nhắn theo UID
  và chiến dịch nhắn tin bạn bè (workflow "[engine]" riêng, danh mục bước `fb_message_friend` mức 2 gửi bằng Enter như bước 15 production) —
  không thấy chữ → FB42 (tính lượt, cộng chuỗi); hai câu → FB19 (dòng "<câu> (FB19)", data đóng, không tính lượt, không cộng chuỗi; trước V603
  cùng câu ra FB42); 4 / 5 data liền FB19 → chạy hết, không tạm dừng. Cả bài 51/51; `v597-smoke` 18/18 (dùng chung `fixture.cjs`, thêm `applyV597`).
- Hai typecheck không lỗi.

## Apply / gỡ

- Kiểm lại sổ migration ngay trước khi apply (V603 giữ trong ghi chú chung của các session hộp thư lỗi).
- Apply: `node scripts/make-migration-ledger-apply.cjs migrations/migration_v603_engine_facebook_messenger_signs.sql
  migration_v603_engine_facebook_messenger_signs <file ra>` rồi `supabase db query --linked -f <file ra>`.
- Preflight dừng nếu block 2855, danh mục bước 15 / 16, dòng dấu hiệu, câu FB19 đã khác bản đọc 20/11.
- Gỡ: `migrations/rollback_v603_engine_facebook_messenger_signs.sql`.
- Sau khi apply: theo dõi outcome `fb_message_friend` / `fb_message_stranger` trong `auto_engine_outcomes` theo mã. Nhóm A còn FB42: khi bản
  Desktop có #739 phát hành và nhân viên 1351 lên bản đó, xin lại ảnh kèm DOM cho chiến dịch 45597.
