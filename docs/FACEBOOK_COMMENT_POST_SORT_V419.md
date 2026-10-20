# Sắp xếp bài viết trước khi comment — V419

Ngày 20/10/2026. Phạm vi: `facebook_comment_seeding`, tức comment đến danh sách profile/group/page. Không áp dụng cho comment theo link bài viết.

## Hợp đồng

- `extraSettings.commentPostSort`: `recent_activity` (Hoạt động mới đây), `most_relevant` (Phù hợp nhất), `new_posts` (Bài viết mới).
- `null` hoặc thiếu trường: **Hoạt động mới đây**. Form, tab thông tin và scheduler cùng fallback. Không backfill chiến dịch cũ.
- Scheduler truyền biến riêng `commentPostSort`. Không lấy `sortTypePost` của tìm data làm mặc định cho comment.
- Workflow sắp xếp sau khi mở/chờ target và trước `fb_prepare_seeding_iterations`, nên vị trí bài dùng để comment được xác định sau khi đổi thứ tự.
- `commentOnlyLatestPost` vẫn chỉ là cấu hình UI. Không truyền vào runtime, không thêm lịch sử chống trùng, không đổi số bài mỗi target/lịch chạy.

## Tái sử dụng phần đã có

Block `fb_sort_group_posts` (2600) đang được chiến dịch **Facebook – Tìm kiếm data trong group** dùng qua workflow 206/246. V419 thêm nhánh opt-in `input.commentFeedSort === true`; phần code tìm data cũ được giữ nguyên từng byte.

Luồng comment:

1. Nhận diện nút sắp xếp ở cả ba trạng thái hiện tại, tiếng Việt/Anh; bỏ nút trong bài viết/dialog.
2. Mở menu và chọn rõ lựa chọn yêu cầu, kể cả **Phù hợp nhất**.
3. Dùng thời gian chờ hiện có: 1 giây sau mở menu, 2,5 giây sau chọn.
4. Nếu trang không cung cấp menu/lựa chọn, ghi thông báo và giữ thứ tự hiện tại. Không báo đã sắp xếp thành công.
5. Nếu thao tác lỗi, đóng menu nếu đã mở rồi tiếp tục theo thứ tự hiện tại; hủy phiên phải chặn bước tìm bài/comment tiếp theo.

Đây là điều khiển menu Facebook cung cấp trên trang. Không tự sắp xếp các bài đã tải hoặc giả lập thứ tự khi profile/page không có menu tương ứng.

## Thay đổi

- Desktop: `src/main/services/campaignScheduler.ts`, thêm biến cho đúng action.
- DB: block 2600; workflow thật 157 và test 245, mỗi workflow thêm đúng một bước trước `prepare_iters`.
- Hai element mới: `fb_feed_post_sort_button`, `fb_feed_most_relevant_post_option`.
- Dùng lại hai element 1483/1484 cho Hoạt động mới đây/Bài viết mới. Không sửa element 1482/1483/1484.
- Không đổi RPC/schema/quyền, workflow tìm data, action bindings, bộ lọc keyword/AI, nội dung/media, thứ tự comment rồi Like, quota, lịch hoặc Page identity.
- Không thêm nguồn connection/polling. Dùng cơ chế tải workflow/block/element và HTTP hiện có.

## Kiểm chứng

- `node scripts/comment-post-sort-v419-smoke.cjs`: **89 ca** qua method scheduler thật, workflow engine và sandbox block; bao gồm thiếu/null, cả ba lựa chọn, Desktop cũ chưa truyền biến mới, hai workflow, lỗi/thiếu menu, hủy trước/sau click, nhánh chỉ khôi phục Page và parity nhánh tìm data cũ.
- Cùng script: **18 ca Electron PageController/DOM** — ba trạng thái hiện tại × ba lựa chọn × hai ngôn ngữ; không click nhầm nút trong article/dialog.
- `node scripts/comment-post-sort-v419.cjs test`: apply rồi restore trong transaction rollback trên linked project; xác nhận toàn bộ row chụp trước/sau không đổi.
- `npx tsc --noEmit -p tsconfig.node.json`, `npx tsc --noEmit -p tsconfig.web.json`, `npm run build`, `git diff --check`: đạt.
- Không đăng/comment Facebook thật trong kiểm thử. DOM fixture xác minh thao tác selector và luồng thực thi, không thay thế xác nhận layout Facebook của từng tài khoản.

## Apply và rollout

Đã apply **akachat** (`cgjbsmqtfhqvttudyjzq`) với history:

- Version: `20261020152744`
- Name: `migration_v419_comment_post_sort`
- Canonical SQL: `migrations/migration_v419_comment_post_sort.sql`
- Snapshot/checksum/SQL rollback/receipt: `migrations/snapshots/comment-post-sort-v419/`

Apply kiểm tra toàn bộ row live liên quan trước khi cập nhật, bao gồm consumer của block; nếu drift thì dừng. Sau commit đã đọc lại và đối chiếu chính xác block, hai workflow, element, các dependency không đổi và history.

**Không apply lại.** `node scripts/comment-post-sort-v419.cjs verify` chỉ đọc để kiểm chứng trạng thái đã apply.

Desktop đã build local, chưa đóng gói/phát hành. Cần cập nhật/restart Desktop để nạp code và cache workflow/block/element mới. Desktop cũ chưa truyền `commentPostSort` vẫn dùng Hoạt động mới đây khi nhận workflow/block mới; muốn dùng lựa chọn riêng đã lưu cần Desktop mới.

## Rollback

`migrations/snapshots/comment-post-sort-v419/rollback.sql` khôi phục chính xác block/workflow trước V419, xóa đúng hai element thêm mới và giữ migration history. Có kiểm tra drift trước khi ghi, không ghi đè bản sửa mới hơn.

Sau rollback, UI vẫn giữ lựa chọn đã lưu nhưng runtime không áp dụng lựa chọn đó. Không cần sửa dữ liệu chiến dịch.
