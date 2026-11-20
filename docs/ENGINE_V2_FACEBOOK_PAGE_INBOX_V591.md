# V591: tách FB46 hộp thư Page thành FB26 / FB47 (20/11/2026)

Trạng thái: **đã apply akachat 10:27:33 VN 20/11/2026** theo yêu cầu ("Apply luôn"; sổ `20261120032733`, md5 sổ = file `8f277af0…`, không apply lại; [biên nhận](../migrations/snapshots/engine-facebook-v591/apply-receipt.json)). Nhánh `claude/fb-page-inbox-v591`, chưa commit.

## Vì sao

FB46 "Không thấy ô nhập tin nhắn trong hộp thư Page" (V575) gộp mọi lần block gửi tin không thấy ô nhập tin. Mỗi data lỗi cộng chuỗi, đủ
8 data liền thì tạm dừng chiến dịch. Chuỗi không về 0 khi chạy lại, nên sau đó mỗi lần chạy lại chỉ thử thêm 1 data rồi dừng.

Sáng 20/11, 6 chiến dịch inbox Page của tổ chức 441 bị dừng tổng cộng 58 lần trong 24 giờ. Xin 6 ảnh lỗi từ máy khách (yêu cầu chẩn đoán số
1) thì thấy Facebook đã bỏ hẳn ô nhập tin và ghi lý do ngay ở chỗ đó:

- 5/6 ảnh: "Bạn không thể gửi tin nhắn cho người này nữa. Tìm hiểu thêm". Lỗi chỉ ở người này, người sau vẫn gửi được.
- 1/6 ảnh: "Hãy xác nhận danh tính để gửi tin nhắn. Một số hành động đã bị hạn chế do có hoạt động bất thường. Cách xác nhận". Cả Page bị chặn
  gửi tin.

Hộp thoại "Thẻ mới cho Business Agent trong Hộp thư" đè lên ở 2 ảnh **không phải nguyên nhân**: block tìm ô nhập tin bằng XPath trên cả trang
(không xét có bị che hay không) rồi dán bằng sự kiện giả lập.

## Anh chốt (hộp chọn 20/11/2026)

| | FB26 (dùng lại mã có sẵn từ V346, chưa chỗ nào phát) | FB47 (mã mới, lớp `account_restricted`) |
|---|---|---|
| Facebook ghi | "Bạn không thể gửi tin nhắn cho người này nữa." | "Hãy xác nhận danh tính để gửi tin nhắn. …" |
| Khách thấy | Page không gửi được tin cho người này nữa | Facebook yêu cầu xác nhận danh tính trước khi Page gửi tin |
| Bước tiếp theo | không có | Vui lòng kiểm tra hộp thư page |
| Data | đóng, ghi lịch sử "thất bại" | đóng, ghi lịch sử "thất bại" |
| Lượt / chuỗi lỗi | không tính / không cộng | không tính / không cộng |
| Chiến dịch | chạy tiếp data sau | dừng ngay |

FB47 không trả data về hàng đợi được. Block gửi tin hộp thư Page (danh mục bước 20, mức 1, `send_ops` rỗng vì cú bấm gửi nằm trong
`page.evaluate`) đánh dấu "sắp gửi" trước khi chạy, nên mọi lỗi trong block là "không rõ đã gửi". Với trạng thái đó, `report_v1` có luật
`no_requeue_after_delivery` chặn trả data về hàng đợi. Anh chọn đóng data (mỗi lần dừng mất đúng 1 data), không đổi cách đánh dấu của cả block.

Không thấy cả hai câu thì vẫn ra FB46 như V575.

## Thay đổi (chỉ dữ liệu, không DDL, không phát hành app)

1. `auto_elements` thêm hai element, sửa được ở màn Element:
   - `FbPageInboxCannotSendNotice`: `//text()[normalize-space(.)='Bạn không thể gửi tin nhắn cho người này nữa.']/..`
     So bằng nguyên câu, để tin nhắn trong hội thoại bắt đầu bằng câu đó không bị nhận nhầm. Đã thử trên trang Page thật của anh 20/11:
     ra 1 phần tử, ô nhập tin ra 0.
   - `FbPageInboxIdentityRequiredNotice`: `//text()[starts-with(normalize-space(.), 'Hãy xác nhận danh tính để gửi tin nhắn')]/..`
     Chưa có trang thật để thử, làm theo ảnh lỗi nên so đầu câu.
   - Bản tiếng Anh chưa có mẫu; khi có thì nối thêm bằng `|` ở màn Element.
2. Bản "[engine]" của block 2885 `fb_send_page_inbox_message` (bộ cũ 2679 không đổi). Khi không thấy ô nhập tin, block dò hai element trên
   theo thứ tự xác nhận danh tính trước, rồi ném câu riêng:
   - "Facebook yêu cầu xác nhận danh tính trước khi Page gửi tin"
   - "Page không gửi được tin cho người này nữa"
   - không thấy câu nào: "Không tìm thấy ô để nhập tin nhắn" như cũ.

   md5 `86217720…` → `d7657b8e…`; md5 đã duyệt của danh mục bước 20 cũng đổi theo.
3. `facebook.error_signs` thêm hai dấu hiệu nguồn `message` cho `fb_message_page_inbox_customer`, thay `err_undefined`, đặt ngay trước dấu hiệu
   FB46. md5 `797af974…` → `aa197aea…`.
4. `auto_error`:
   - FB26 chỉ đổi `customer_title` (bộ cũ đọc `noti_*`, giữ nguyên).
   - Thêm FB47 `err_fb_page_inbox_identity_required` (loại `engine v2`).
5. `auto_outcome_policies` thêm hai dòng cho `fb_message_page_inbox_customer`, nguồn `v591`. Mỗi dòng khai đủ mọi cột hành vi, để chính sách
   gộp không lấy trường nào từ dòng chung của mã hay của lớp lỗi.

Desktop ≥ 9.9.0 đọc dấu hiệu theo câu block, và gặp tên element chưa có trong bộ nhớ thì tự nạp lại danh sách
(`elementV2Repository.resolveXpathByName`), nên không cần bản app mới. Chỉ engine v2 (mọi tổ chức từ 18/11); máy bản cũ chạy bộ cũ, không đổi.

## Kiểm

`CHROMIUM_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" LC_ALL=C node scripts/engine-v2-facebook/v591-smoke.cjs` cho 12/12
nhóm đạt (20/11):

- **PostgreSQL 17 cục bộ.** DB engine dựng như production (bootstrap, V556–V559, V563, V564, V575) cộng block 2885, danh mục bước và 12 element
  đọc 20/11. Chạy nguyên văn migration, rồi so mọi quyết định chính sách gộp (mọi mã × 7 thao tác FB × 3 pha) trước và sau: chỉ FB26 ở hộp
  thư Page và FB47 đổi.
- **Bản gỡ.** Từ chối khi V591 chưa apply. Sau khi gỡ, block, bước, dấu hiệu, câu FB26 và element về đúng từng byte; FB47 và hai chính sách
  chỉ bị tắt. Apply lần hai và apply khi sổ đã có V591 đều bị từ chối.
- **Chromium.** Chạy nguyên code block 2885, bản cũ và bản mới, trên hộp thư Page giả có chỗ ô nhập tin dựng theo HTML thật. Năm trường hợp:
  - gửi được;
  - FB26 (câu thật);
  - FB47 có hộp Business Agent đè lên và dải đỏ cột trái;
  - không có câu nào (vẫn FB46);
  - tin nhắn trong hội thoại bắt đầu bằng câu FB26 (không nhận nhầm).

  Câu block ném đi qua đúng `errorSigns.ts` của Desktop với dòng dấu hiệu sau V591.

Postflight trong migration cũng kiểm chính sách gộp FB26 / FB47 / FB46 ở cả 3 pha và cách phân loại tín hiệu của ba mã.

Sinh lại: `node scripts/build-v591-sql.cjs`. Kiểm file khớp bộ sinh: `--check`. Nguồn kiểm:
`scripts/fixtures/engine-v2-facebook/v591-live-20261120.json`.

## Apply / gỡ

- Kiểm lại sổ migration ngay trước khi apply: số 591 chỉ là của mình khi đã có dòng trong sổ.
- Apply: `node scripts/make-migration-ledger-apply.cjs migrations/migration_v591_engine_facebook_page_inbox_signs.sql
  migration_v591_engine_facebook_page_inbox_signs <file ra>` rồi `supabase db query --linked -f <file ra>`.
- Chỉ dữ liệu nên không nạp lại schema; preflight dừng nếu block 2885, dòng dấu hiệu, FB26 hay danh mục bước đã khác bản đọc 20/11.
- Gỡ: `migrations/rollback_v591_engine_facebook_page_inbox_signs.sql`.
- Sau khi apply, theo dõi các outcome của `fb_message_page_inbox_customer` trong `auto_engine_outcomes`, phân theo mã FB26 / FB47 / FB46. Còn
  FB46 nhiều thì xin ảnh lỗi để tìm câu mới (ví dụ bản tiếng Anh).
