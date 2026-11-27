# V673: đăng nhóm bị giới hạn tần suất → FB02 ngay khi thấy chữ, không chờ hết 60 giây

Câu 9004 của hộp thư lỗi (bộ kiểm lỗi chiến dịch Facebook, engine v2). Anh duyệt 27/11/2026 qua hộp chọn ("Dò sớm FB02"). Migration
[V673](../migrations/migration_v673_engine_facebook_group_post_frequency_early.sql), sinh bằng `node scripts/build-v673-sql.cjs`
(nguồn kiểm [`v673-live-20261127.json`](../scripts/fixtures/engine-v2-facebook/v673-live-20261127.json)), gỡ bằng
[rollback](../migrations/rollback_v673_engine_facebook_group_post_frequency_early.sql). Chỉ dữ liệu, **không cần build / phát hành Desktop**
(Desktop đọc code block và element từ DB lúc chạy, tự nạp lại element khi gặp tên mới, như V597).

**Đã apply akachat 06:15:52 VN 27/11/2026** theo yêu cầu ("apply đi"): sổ `20261126231551`, md5 sổ = file `e821a3d6…`, 1 giây, chỉ dữ liệu; block 2871 `f981cac7…` → `2ce23f2d…`, bước 4 cùng md5, element 1823; 0 lỗi 5xx / 0 lỗi Postgres quanh phút apply. [Biên nhận](../migrations/snapshots/engine-facebook-v673/apply-receipt.json). PR [#818](https://github.com/aligoinc/akaAgent/pull/818) vào `dev_3` (mở 27/11 theo yêu cầu "Mở PR"), chưa merge.

## Ca lỗi

- Khoá `err_undefined|fb_post_group|click_post|Lỗi đăng bài vào *: Block bị huỷ trong khi sleep` (SYS99): 4 lượt 19–20/11, bản 9.9.0 / 10.0.0 /
  10.1.0, mỗi lượt có phiên app mới mở ngay sau (thoát / cập nhật app). Từ Desktop 10.2.0 (#734) cùng kiểu ra SYS02, không cộng chuỗi, không dừng;
  7 lượt 21–26/11. Phần SYS99 đã hết nhờ #734.
- Còn lại: bước `verify_submit` (node của workflow 321 = block **2871** `[engine] fb_verify_group_post_form_closed`) chỉ dò chữ giới hạn tần
  suất SAU khi hết giờ chờ (60 giây, 180 giây khi có video). 12 lượt FB02 mẫu 26–27/11 đều ngồi 56–57 giây ở bước này; 24 giờ có 277 lượt FB02
  (38 tài khoản, 22 tổ chức), tức khoảng 4 giờ tài khoản ngồi chờ mỗi ngày. App thoát trong lúc chờ thì mất dấu hiệu: lượt 294055 (ảnh yêu cầu
  41) ra SYS99, lượt 761292 (10.6.0, 53 giây) ra SYS02 và bị tính một lượt hạn mức oan (`count_if_committed`) dù bài không lên.

## Ảnh + DOM (yêu cầu 41, 44, 45; 27/11)

- Hộp "Tạo bài viết" còn mở, chữ đỏ "Để bảo vệ cộng đồng khỏi spam, chúng tôi giới hạn tần suất bạn đăng bài, bình luận…" ngay dưới nút Đăng.
- DOM 44 / 45 (10.8.0 / 10.7.0): cụm "giới hạn tần suất bạn đăng bài" có đúng một lần trên cả trang, trong một text node (cha
  `<div style="display: inline;">`), nằm trong `role=dialog` + `form`, ngoài ô soạn. Nút Đăng không `aria-disabled`, không có lớp "Đang đăng":
  Facebook đã từ chối bài.
- Khác FB49: DOM 27 / 31 (FB49 "Không thể tải file") còn lớp "Đang đăng" cùng lúc, nút Đăng `aria-disabled`, nên ba chữ đỏ V597 vẫn chỉ dò khi
  hết giờ.

## Bản sửa

- Element mới `GroupPostFrequencyLimitNotice`:
  `//*[@role='dialog' or self::form]//text()[contains(., 'giới hạn tần suất bạn đăng bài')][not(ancestor::*[@contenteditable='true'])]/..`
  (cùng dạng ba element V597). Element 1710 `GroupPostFrequencyLimitError` (dò cả trang) giữ nguyên cho nhánh hết giờ và các block comment.
- Block 2871 (bộ cũ 2624 không đổi): trong vòng chờ 500 ms, form còn mở mà thấy element mới 2 vòng liền thì ném đúng câu cũ "Facebook báo giới
  hạn tần suất bạn đăng bài" và đặt `vars.groupPostSubmitted = false`, `vars.groupPostFrequencyLimitError = true` như nhánh hết giờ. Luật 116
  → FB02, chính sách FB02 không đổi. Nhánh hết giờ giữ nguyên. Mỗi vòng thêm một lần đọc XPath.
- Kết quả: FB02 ra khoảng 0,5 giây sau khi chữ hiện (thay vì ~57 giây); lượt bị ngắt chỉ mất dấu hiệu nếu app thoát trong 0,5 giây đó.
- Rủi ro anh đã biết khi duyệt: tài khoản đang bị giới hạn sẽ thử lượt kế sớm hơn ~50 giây (nghỉ sau FB02 = "Nghỉ giữa 2 lần" của chiến dịch).

## Kiểm

- `CHROMIUM_PATH=… LC_ALL=C CHAT_REPO=<akaAgentChatApi> node scripts/engine-v2-facebook/v673-smoke.cjs` (21 ca; `V673_ONLY=sql|chromium`):
  PostgreSQL 17 cục bộ dựng tới V597 (block 2871 = bản production 27/11), migration chỉ đổi element / block / bước 4, câu FB02 vẫn ra FB02,
  không apply lại được, bản gỡ trả đúng; Chromium chạy code block cũ và mới với đồng hồ ảo trên hộp giả dựng theo DOM 44 / 45: app thoát ở giây
  30 (lượt 294055) bản cũ ném "Block bị huỷ", bản mới FB02 ở giây 3,5; chữ ở ô soạn / trang nhóm / bị ẩn / chỉ một vòng không báo sớm; FB48 /
  FB49 + "Đang đăng" / FB42 vẫn chờ hết giờ.
- XPath mới chạy trên DOM thật (scratchpad, không đưa vào repo): DOM 44 / 45 khớp 1 phần tử đang hiện; DOM FB49 27 / 28 / 31 và FB50 22 khớp 0.
