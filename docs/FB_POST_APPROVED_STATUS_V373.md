# Trạng thái phụ Đã duyệt bài — V373

## Phạm vi và trạng thái triển khai

Theo yêu cầu bổ sung của người dùng ngày 10/10/2026, nhánh kết luận không chờ duyệt của cơ chế đăng bài group hiện có được ánh xạ sang trạng thái phụ **Đã duyệt bài**. Không thêm phép kiểm tra DOM, không sửa block/workflow hay note/log, không viết lại detail cũ.

- DB đã apply trên **akachat**, ref `cgjbsmqtfhqvttudyjzq`: `20261009191030 / migration_v373_fb_post_approved_status`, lúc 02:10 ngày 10/10/2026 Việt Nam. Không apply lại.
- Chỉ INSERT một dòng `auto_status`: ID **55**, code `campaign_detail_post_approved`, `status_value='đã duyệt bài'`, `is_active=true`, `is_delete=false`, component `campaign_detail`, platform `facebook`.
- Không thêm schema, policy chính, cột, index, RPC, connection/pool, polling hay yêu cầu reload schema.
- Code nằm trong worktree `fb-email-policy-catalogs/akaAgent`; đã typecheck/build production, **chưa đóng gói/phát hành bộ cài Desktop có mapping này**. DB riêng lẻ không khiến Desktop đang cài tự phát secondary code mới.
- Desktop và WebApp đã có renderer/mapper đọc trạng thái phụ từ DB; không cần thay UI cho tên trạng thái này. Chat không thực thi nhánh đăng Facebook này.

## Cách nhận diện

Nguồn đang chạy là `auto_blocks.id=31`, `fb_detect_pending_post`, MD5 canonical row `21335b279cb31cfb4f382d0a1185e59a`. Row và code được lưu trong snapshot trước áp dụng; checksum sau áp dụng giữ nguyên.

| Kết quả kiểm tra sau khi đăng thành công | Trạng thái chính | Trạng thái phụ |
|---|---|---|
| `isPending=true` | Thành công | Chờ duyệt bài |
| `isPending=false`, kiểm tra có kết luận | Thành công | Đã duyệt bài |
| Thiếu/sai kiểu kết quả hoặc `pendingCheckConclusive=false` | Thành công | Để trống |

Giữ normalization cũ: detector trả `isPending` kiểu boolean và không đặt `pendingCheckConclusive=false` được xem là có kết luận. Vì vậy output cũ thiếu trường conclusive vẫn tương thích. URL công khai đơn thuần không chứng minh đã duyệt; fallback `/pending_posts/` của nhánh cũ vẫn chỉ nhận diện chờ duyệt.

Tên **Đã duyệt bài** là nhãn nghiệp vụ cho kết luận không chờ duyệt của detector hiện có, bao gồm `pending_content_empty`. Nó không bổ sung phép xác minh rằng quản trị viên đã bấm duyệt một bài cụ thể. Không khôi phục mã `campaign_detail_post_visible` đã loại bỏ ở V365.

`campaignScheduler.ts` dùng cùng helper cho milestone xác nhận đóng form và fallback đăng group legacy. Output mới có `subStatusCode` rõ ràng được giữ nguyên. Không sao chép kết luận của group nguồn sang group nhận bài chia sẻ. Timeline/Reels và thao tác đăng thất bại không được gán trạng thái mới.

Secondary status tiếp tục dùng toàn bộ policy của trạng thái chính Thành công, bao gồm đếm lượt, bộ đếm lỗi và xử lý input. Không có dòng policy riêng cho ID 55. Không thêm trạng thái chính vào `auto_campaign_action_detail_statuses`.

## Snapshot và an toàn dữ liệu

Thư mục: `migrations/snapshots/fb-post-approved-status-v373/`.

- `before.json`: toàn bộ 40 dòng `auto_status`, 104 dòng `auto_error`, 19 dòng `auto_account_action_status_policies`, mọi cột/ID/timestamp/trạng thái, canonical JSON, checksum từng dòng và cả bảng; schema/constraint/index/quyền/RLS, định nghĩa sequence và block kiểm tra.
- SHA256 before: `852e4244fae4fa688d55611693717250913514483f1d53c721e8ec1e2c07ac48`. Script đọc lại và kiểm tra trước mọi INSERT, kể cả diễn tập.
- `rollback.sql.template` và manifest được tạo trước INSERT; `rollback.sql` được chốt bằng ID/checksum từ receipt của transaction thật.
- Migration khóa catalog nhỏ trong transaction, giới hạn chờ khóa 2 giây, statement 8 giây; kiểm tra schema/checksum toàn catalog, mã trùng, history và block live. Chỉ INSERT dữ liệu và ghi history vào bảng đã tồn tại; không dựng DDL phụ.
- `after.json`, `verified.json`: 41 dòng status; toàn bộ dòng cũ của ba bảng nguyên từng giá trị; block và schema giữ nguyên. Sáu detail của campaign **27394** khớp checksum trước áp dụng, không backfill dù chúng đã có `isPending=false`, `pendingCheckConclusive=true`.
- Owned row MD5: `f882b0284e00f33e215baa4bf19f4e64`.

## Kiểm chứng

- `node scripts/fb-post-approved-status-smoke.cjs`: **18** ca chạy scheduler, resolver và SQL writer local, gồm conclusive/inconclusive, thiếu/sai kiểu, legacy boolean, legacy fallback, lỗi kiểm tra, đăng thất bại, ưu tiên output explicit và không ảnh hưởng timeline. Xác nhận secondary không cần policy riêng, giữ main policy/lượt đếm/log.
- `node scripts/action-status-result-boundary-smoke.cjs`: **24** ca, gồm bốn dạng output đăng group, shared target, replay không ghi/đếm lại và các guard kết quả cũ.
- `node scripts/action-status-mixed-output-smoke.cjs`: **25** ca output cũ/mới, thứ tự xử lý và nội dung log giữ nguyên.
- Hai typecheck `tsconfig.node.json`, `tsconfig.web.json`: đạt.
- `npm run build`: đạt; chỉ còn cảnh báo phân chunk do import static/dynamic hiện có.
- INSERT live rồi ROLLBACK trước apply: đạt, checksum bảng trở về trước. Sequence có thể có khoảng trống; không reset.
- DELETE chính xác dòng mới rồi ROLLBACK sau apply: đạt; bảng trong transaction khớp before, sau rollback vẫn giữ ID 55.
- GET catalog qua Data API với anon client hiện có: HTTP 200, trả đúng ID/code/tên/trạng thái bật. Không reload schema.
- Không đăng bài hoặc thực hiện thao tác Facebook thật để thử.

## Rollback

Ngừng phát output mới trước khi cân nhắc gỡ catalog. Dùng `rollback.sql` đã lưu; script kiểm tra schema, đúng ID/code/checksum và tham chiếu từ detail chính/phụ, policy, lỗi, Automation, block/workflow. Dòng bị sửa hoặc đã được tham chiếu thì dừng đối chiếu và giữ catalog để đọc lịch sử.

Rollback chỉ xóa dòng ID 55 của đợt này; không TRUNCATE, không reset sequence, không phục hồi đè bảng, không xóa history apply. Không hoàn nguyên các migration V369–372 hoặc sửa dữ liệu đã được xử lý.

Các lệnh `capture`, `build`, `smoke`, `apply`, `rollback-smoke`, `api` trong `scripts/fb-post-approved-status-v373.cjs` là quy trình đã thực hiện. File receipt dùng chế độ ghi độc quyền để không ghi đè lịch sử; không chạy lại apply khi release Desktop.
