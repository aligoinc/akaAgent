# V597: đăng nhóm "Form đăng bài chưa đóng" — nhận ba chữ đỏ của Facebook (FB48 / FB49 / FB50)

Câu 585 của hộp thư lỗi (bộ kiểm lỗi chiến dịch Facebook, engine v2). Anh chốt 20/11/2026 qua hộp chọn. Migration
[V597](../migrations/migration_v597_engine_facebook_group_post_signs.sql), sinh bằng `node scripts/build-v597-sql.cjs`
(nguồn kiểm [`v597-live-20261120.json`](../scripts/fixtures/engine-v2-facebook/v597-live-20261120.json)), gỡ bằng
[rollback](../migrations/rollback_v597_engine_facebook_group_post_signs.sql).

## Ca lỗi

Đăng nhóm (`fb_post_group`), bước `verify_submit` (block engine **2871** `[engine] fb_verify_group_post_form_closed`, cùng code với bộ cũ 2624):
sau cú bấm Đăng, chờ nút Đăng biến mất 60 giây (180 giây khi bài có video). Hết giờ chỉ dò chữ "giới hạn tần suất" (FB02); không thấy thì trả
`ok: false` với câu chung "Form đăng bài chưa đóng sau 60 giây". Dòng lịch sử "thất bại" không mã → luật 103 `status:campaign_detail_failed` →
FB42 (chính sách 340: ghi thất bại, tính lượt, cộng chuỗi, data đóng).

Số liệu 20/11 (chỉ đọc production): 65 lượt / 24 giờ, 16 tổ chức, 7 lần dừng chiến dịch; cả ba bản app 9.9.0 / 10.0.0 / 10.1.0.

## Ảnh lỗi (yêu cầu ảnh 3–8, 20/11) — bốn trường hợp khác nhau lúc hết giờ

| Facebook hiện trong hộp "Tạo bài viết" | Ảnh | Data chạy tiếp trên cùng tài khoản | Làm |
|---|---|---|---|
| Lớp mờ + vòng quay "Đang đăng" (chưa biết bài có lên không) | 3 / 6 | đều thành công sau đó | **chưa làm**: anh chốt chờ DOM (bản Desktop có #739) |
| Chữ đỏ "Chúng tôi gặp sự cố khi hoàn tất yêu cầu của bạn. Vui lòng thử lại." | 1 / 6 | data sau thành công 54 giây sau (5/6) | FB48 |
| Chữ đỏ "Không thể tải file của bạn lên: <tệp>", nút Đăng xám (bài chắc chưa gửi) | 1 / 6 | 6/6 data sau thành công trong 8 phút | FB49 |
| Chữ đỏ "Vì lý do bảo mật, tài khoản của bạn đã giới hạn quyền truy cập vào trang web trong vài ngày…" | 1 / 6 | tài khoản hỏng liền ≥ 2 ngày 9 giờ (11 data đã đóng qua 3 lần khách cho chạy lại) | FB50 |

Sau 101 lần lỗi có data chạy tiếp: data kế tiếp thành công 65 lần, trong 5 data kế tiếp có ít nhất một data thành công ở 92 lần.

## Anh chốt (20/11/2026)

| Mã | Mã nội bộ | Câu cho khách (tên lỗi, câu dòng lịch sử) | Cách xử lý |
|---|---|---|---|
| FB48 | `err_fb_group_post_request_failed` | Facebook báo gặp sự cố khi đăng bài | như FB42 hôm nay: ghi thất bại, tính lượt, cộng chuỗi, data đóng |
| FB49 | `err_fb_group_post_upload_failed` | Facebook không tải được ảnh hoặc video lên | ghi thất bại, không tính lượt, cộng chuỗi, data về hàng đợi |
| FB50 | `err_fb_account_access_limited` | Facebook đang giới hạn quyền truy cập của tài khoản | ghi thất bại, tạm dừng chiến dịch ngay, data về hàng đợi, không tính lượt, không cộng chuỗi |

Không có câu "bước tiếp theo" cho cả ba (FB50: anh bỏ đoạn "khi Facebook gỡ giới hạn, bấm Tiếp tục chiến dịch"). Dòng lịch sử:
"Đăng bài thất bại vào <nhóm>: <câu> (FB4x)". Ghi chú chiến dịch khi FB50 dừng: "Facebook đang giới hạn quyền truy cập của tài khoản (FB50)."

## Làm gì (chỉ dữ liệu, không cần phát hành app)

- Ba element ở `auto_elements` (sửa XPath ở màn Element khi Facebook đổi chữ; thêm bản tiếng Anh bằng `|` khi có mẫu):
  `GroupPostRequestFailedNotice`, `GroupPostUploadFailedNotice`, `GroupPostAccountAccessLimitedNotice`. Chưa có DOM nên so một đoạn chữ, không
  theo cấu trúc: chữ nằm trong hộp thoại hoặc form, bỏ phần nội dung bài khách gõ (`contenteditable`).
- Block 2871 (bản engine; bộ cũ 2624 không đổi): hết giờ, sau bước dò giới hạn tần suất như cũ, dò lần lượt FB50 → FB49 → FB48; thấy thì trả
  câu riêng (vẫn `ok: false`, không ném), không thấy thì câu cũ. Thời gian chờ không đổi.
- `facebook.error_signs`: ba dấu hiệu `message` cho `fb_post_group`, `replaces: []` (dòng lịch sử đăng nhóm không mã), chữ = câu block trả.
- `auto_error`: ba mã mới (`engine v2`, lớp `target_permanent` / `transient` / `account_restricted`). `auto_outcome_policies`: ba dòng
  `fb_post_group`, nguồn `v597`, khai đủ mọi cột hành vi; FB48 chép đúng chính sách gộp của FB42 ở đăng nhóm.
- Data về hàng đợi sau cú bấm Đăng không bị luật `no_requeue_after_delivery` chặn: dòng "thất bại" của bước xác nhận báo `not_delivered`, dấu
  "sắp gửi" của bước được giải thành `not_delivered`; V501 giữ data vừa về hàng đợi không bị nhận lại trong cùng lượt.

Desktop ≥ 9.9.0 đã đọc dấu hiệu theo câu block và tự nạp lại element khi gặp tên mới; block / dấu hiệu được nạp lại ở lần nạp danh mục kế tiếp.

## Kiểm

- `CHROMIUM_PATH=… LC_ALL=C node scripts/engine-v2-facebook/v597-smoke.cjs`: PostgreSQL 17 cục bộ dựng như production (tới V591) + block / bước /
  element đọc 20/11; migration nguyên văn, so mọi quyết định chính sách trước / sau (chỉ ba mã mới; FB48 = FB42 ở đăng nhóm), apply lại bị từ
  chối, bản gỡ trả về như cũ. Chromium chạy nguyên code block 2871 bản cũ và bản V597 trên hộp Tạo bài viết giả dựng theo ảnh (chữ trong form
  / ngoài form, tên tệp dòng sau, link giữa câu; chữ trong bài khách gõ, trong bài trên trang nhóm, chữ bị ẩn, vòng quay "Đang đăng", giới hạn
  tần suất đều không đổi), câu block qua đúng bộ nhận dấu hiệu Desktop.
- `FB_DESKTOP_ONLY=V597 LC_ALL=C node scripts/engine-v2-facebook/desktop-fb-smoke.cjs` (5 ca): bộ lập lịch Desktop thật + `report_v1` thật:
  FB42 / FB48 / FB49 / FB50 ra đúng mã, dòng lịch sử, data đi đâu, lượt, chuỗi, trạng thái chiến dịch; FB49 lỗi 4 data liền thì chuỗi chạm
  ngưỡng chung (4, mã canh chuỗi `err_undefined`, như FB42) và chiến dịch tạm dừng với câu "Dừng sau 4 data lỗi/thất bại liên tiếp (ngưỡng 4): …",
  cả 5 data vẫn chờ xử lý (V501: data vừa về hàng đợi không được nhận lại trong cùng lượt, nên không lặp mãi).

Số migration: V596 đã có ở nhánh chat (`migration_v596_chat_facebook_page_access`); V598 (câu 584, comment chờ duyệt, block 2869) đã apply
trước V597, không đụng chỗ nào V597 đọc / ghi.

## Chưa làm

- Vòng quay "Đang đăng" (FB30 "Chưa xác nhận được bài đã đăng"): chờ DOM từ máy khách (bản Desktop có #739), rồi hỏi anh cách xử lý.
- Chữ tiếng Anh của ba trường hợp: chưa có mẫu, tài khoản giao diện tiếng Anh vẫn ra FB42.
- Câu 568 (SYS01 ở bước chia sẻ kèm) đi theo cách xử lý của ca này.
