# Facebook: Kiêm nghỉ và lướt Facebook

Section trong form của `facebook_group_post`, `facebook_comment_seeding` và `facebook_message_uid`.
Mặc định tắt; khi bật, tổng lướt 180 giây, nghỉ 60 giây, chọn cả đích và trang chủ.
Hai nơi chia đều thời gian. Chỉ chọn một nơi thì dùng toàn bộ thời gian; không xác định được đích thì bỏ phần đích, không chuyển ngân sách đó sang trang chủ.
Thiếu cấu hình ở campaign cũ tương đương tắt. Tạo/sửa/nhân bản và nháp sử dụng cùng JSON `extra_settings.facebookRestBrowse`.

## Vòng đời

`đang chạy → chạm giới hạn giờ → lướt → nghỉ → chờ xử lý`.

Scheduler gọi workflow nội bộ `fb_campaign_rest_browse` trước policy `error_limit_in_hour`, chỉ sau khi đã thực hiện và settle ít nhất một input trong đợt chạy.
Giữ runtime claim của campaign/account, không claim input tiếp theo và không tạo action/campaign/job mới.
Không chạy ở preclaim, hết data, giới hạn ngày, khóa hành động hoặc nhánh tiếp tục các hành động còn quota.
Lượt khởi động sau khi đã hết quota chỉ chờ như cũ. Một đợt chạm quota chỉ có một chu kỳ; không lưu bộ đếm 3–5 lượt hoặc ledger mới.

Trang tạm dùng `persist:account_<id>`, kế thừa cookie/proxy/danh tính đã chuẩn bị cho lượt chính.
Không chuyển danh tính trong phần phụ. Khôi phục Page vẫn do luồng cleanup hiện hữu trên trang chính thực hiện.
Preview dùng coordinator hiện có và dọn ngay khi kết thúc. Trang tạm bị crash được hủy, không điều hướng/reload guest đã crash.

## Thao tác và lỗi

Hai block DB: `fb_rest_browse_feed` và `fb_rest_browse_rest`. Workflow không persist run/steps, không tạo campaign detail hay tác động quota/bad-target/error policy.
Block lướt chỉ cuộn, mở rộng nội dung đúng post, mở link ảnh Facebook trong trang tạm rồi quay lại, và mở bảng thông báo trong phần trang chủ rồi về trang chủ; không bấm like/comment/kết bạn/gửi tin.
Selector thiếu/không khớp được bỏ qua. Selector ảnh và thông báo mới được kiểm thử bằng DOM fixture; chưa chạy trên tài khoản Facebook thật.

Nhịp lướt từ v338:

- Vào trang/quay lại sau ảnh: dừng 2–4 giây. Cuộn mượt, chờ 0,8–1,5 giây trước khi đọc.
- Đọc bài 4–8 giây; sau 2–4 giây đầu mới thử “Xem thêm” ở khoảng 40% bài có nút, mở được thì đọc thêm 3–6 giây.
- Khoảng 25% bài được thử xem ảnh nếu còn hơn 15 giây; xem ảnh 3–6 giây rồi quay lại. Không mở lại ảnh đã xem trong cùng chu kỳ.
- Thông báo chỉ tại trang chủ, xem 3–5 giây rồi về trang chủ, có khoảng chờ tải trước khi tiếp tục đọc.
- Giữ tham chiếu đúng post qua các khoảng đọc; post bị gỡ/thay thế thì bỏ thao tác, không lấy lại index để click sang bài khác. Hủy trong lúc đọc không được bấm muộn.
- Mỗi khoảng chờ bị cắt theo thời gian còn lại; 6 giây cuối không bắt đầu một bài mới. Tổng ngân sách lướt/nghỉ và deadline của host giữ nguyên; không tăng thời gian để thực hiện đủ số hành động.

Host bao toàn chu kỳ bằng deadline monotonic, gồm chuẩn bị và điều hướng; đọc cấu hình và mỗi thao tác trình duyệt tối đa 10 giây.
VM của workflow phụ có ngân sách đồng bộ 10 giây, các workflow khác giữ mặc định cũ.
Timeout/abort đóng trang tạm và chặn mọi thao tác đến muộn, không chỉ bỏ chờ Promise.
Guard chỉ tồn tại trong chu kỳ, đọc account/campaign và clock dùng HTTP client/cached DB clock hiện có theo nhịp 5 giây; không có pool, connection SQL, worker hay polling khi tính năng không chạy.
Pause/stop/logout/cutoff hủy phần phụ; trạng thái kết thúc dùng CAS đang-chạy + runtime token để không ghi đè lệnh pause hoặc owner mới.
Thời gian giới hạn giờ vẫn lấy từ cơ chế hiện hữu, không cộng thêm thời gian lướt vào quota window.

## Migration / phát hành

**Đã apply trên akachat ngày 02/10/2026**, history `20261002075841 / migration_v337_facebook_rest_browse`. Không apply lại khi phát hành Desktop.
SHA-256 file migration: `ff55fa852530fce11f11944d8e7b834bd9da1fc376a895566bf78bdda1916a20`.
Tại thời điểm apply v337: workflow ID `314`, checksum `928b31ea49f7802cf255fc51f9be45d4`; block feed `d64287f50a14427a23d65929271ac5b2`, block rest `a885ba0a1fa24a31e16c03cd2c4da2a9`. Block feed hiện đã được cập nhật bằng v338 dưới đây.

- `migrations/migration_v337_facebook_rest_browse.sql`: thêm 1 workflow, 2 block, 5 element; không sửa các workflow/action/RPC hiện hữu.
- Preflight kiểm tra checksum đầy đủ của ba selector live nguồn và yêu cầu tên mới chưa tồn tại; không lấy body workflow từ migration lịch sử.
- Đã chạy `node scripts/facebook-rest-browse-migration.cjs smoke` trước apply: negative fixture IDs + rollback, không tiêu thụ sequence, kiểm tra checksum stale và collision. Sau apply, smoke này cố ý từ chối tên đã có; chỉ dùng `verify` trên production.
- Apply bằng `node scripts/facebook-rest-browse-migration.cjs apply`: verify linked ref `cgjbsmqtfhqvttudyjzq`, transaction chứa seed và history DML. Không tạo/alter schema history, không `NOTIFY pgrst` hay schema reload.
- Đọc lại bằng `node scripts/facebook-rest-browse-migration.cjs verify`.
- Desktop chưa phát hành bộ cài. Tắt checkbox là rollback tính năng; không cần xóa định nghĩa dùng chung hoặc thay đổi campaign cũ.

**V338 đã apply trên akachat ngày 02/10/2026**, history `20261002085737 / migration_v338_facebook_rest_browse_pacing`; không apply lại.

- Chỉ UPDATE `auto_blocks.id=2830`, tên `fb_rest_browse_feed`, dựa trên body live và preflight checksum cả row `79c94bb5bcfd452405d5b159f6cdfa6e`.
- SHA-256 migration: `c81ea16f0271355ec1094abb4b56fc716aab0996be5813d53d9fd4d69acf2b54`.
- MD5 code sau apply: `1dd3d71d643031445cd720e36b9c6974`. Workflow phụ, block nghỉ, selector và các luồng chiến dịch chính giữ nguyên.
- Đối chiếu production sau apply: checksum của 6 workflow chính/test, 33 block được tham chiếu và 5 selector lướt đều khớp snapshot trước thay đổi.
- `node scripts/facebook-rest-browse-pacing-migration.cjs smoke` đã kiểm tra checksum stale, apply trùng và rollback trước khi apply. Sau apply chỉ dùng `verify`.
- Apply/verify qua CLI `supabase db query --linked` và transaction/history DML hiện có; không sửa RPC, không thêm nguồn connection/pool cho ứng dụng hay DDL/reload schema.
- Engine tải block ở mỗi chu kỳ mới, nên nhịp mới có hiệu lực ở lượt lướt tiếp theo; không thay block đã được tải trong lượt đang chạy.

## Kiểm chứng

- `node scripts/facebook-rest-browse-smoke-test.cjs`: fake clock; runner và vòng lặp scheduler thật, timeout/mạng treo/late callback, pause/stop/logout/cutoff, chia thời gian, scope, preclaim race, quota ngày/giờ/partial, hết data, CAS pause/token mới.
- `node scripts/run-facebook-rest-browse-ui-smoke.cjs`: form thật + IPC giả, lưu/sửa/nhân bản/nháp, validation, sáng/tối 1550/780px; chạy block v338 trong Electron DOM fixture với clock giả, kiểm tra nhịp đọc/xem, cuộn mượt, bỏ qua ảnh/mở rộng, đúng ngân sách, hủy khi đang đọc, post bị thay thế và lỗi tải/selector. Chặn toàn bộ HTTP ra ngoài; `--blocks-only` chỉ chạy phần block.
- Smoke danh tính Page và campaign failure cleanup; hai typecheck và `npm run build`.

Không đăng bài, comment, nhắn tin hoặc chạy trên phiên Facebook thật trong kiểm thử.
