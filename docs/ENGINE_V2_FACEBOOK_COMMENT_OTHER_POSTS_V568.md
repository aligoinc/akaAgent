# V568: engine v2 Facebook không comment 2 lần vào một bài khi đăng nhóm (18/11/2026)

**Tình trạng:**
- **V568 đã apply akachat lúc 12:17:31 VN 18/11/2026** theo yêu cầu ("apply rồi create pr"): sổ `20261118051731`, không apply lại, md5 sổ = md5 file = `b2a3b61c…`.
  - Chỉ dữ liệu, 0 lỗi 5xx.
  - [Biên nhận](../migrations/snapshots/engine-facebook-v568/apply-receipt.json).
- Code ở nhánh `claude/fb-engine-comment-dedupe`, PR vào `dev_3`.
- Anh chốt 18/11: "sửa luôn đi", sau khi xác nhận đây là lỗi logic.
- Chỉ sửa bản engine của block comment (block 2851); bộ cũ (block 34) không đổi.

## Lỗi

- Đăng nhóm kèm comment chọn chỗ comment theo **ô bình luận thứ N trên trang nhóm** (đếm từ trên xuống), không theo bài.
  - Vị trí do bộ dựng biến của bộ cũ tạo: "Comment vào post của mình" = 1; "Không comment vào post của mình" = 2..N+1; "Comment tất cả" = 1..N.
  - Khối chỉnh comment lùi 1 khi app coi bài là chờ duyệt (bài mình không hiện nên bài khác bắt đầu từ ô 1).
- V563 (17/11) thêm cho bản engine: comment bài khác mà ô ở vị trí N thuộc bài vừa đăng thì nhảy sang ô kế tiếp.
- Lượt comment sau không biết ô đó đã dùng, lấy ô thứ N+1 theo vị trí, đúng ô vừa comment, nên một bài bị comment 2 lần.
- Ví dụ: "Không comment vào post của mình", tối đa 3. App coi là chờ duyệt (vị trí 1, 2, 3) nhưng bài vừa đăng vẫn hiện trên cùng.
  - Ô 1 là bài mình, nên engine nhảy sang và comment A.
  - Ô 2 lại là bài A, nên comment A lần nữa.
  - Ô 3 là bài B.
- Khi nào xảy ra:
  - **App ghi "chờ duyệt" theo trang `my_pending_content` mà bài vừa đăng vẫn hiện trên trang.**
    - Trang đó còn liệt kê bài chờ duyệt cũ. Anh chốt 18/11 giữ cách nhận chờ duyệt này.
    - 7 ngày tới 18/11 (bộ cũ, cùng tình huống): 709 bài "Không comment vào post của mình" và 472 bài "Comment tất cả".
  - **Bài vừa đăng có 2 ô (nút "Bình luận" và ô "Viết bình luận..."):** ở bộ cũ, 18/405 lần comment thứ 2 của "Comment tất cả" rơi vào bài mình.
  - **Bài khác có 2 ô, hoặc bài vừa comment hiện thêm ô "Viết bình luận...":** ô thứ N+1 vẫn thuộc bài vừa comment. Bộ cũ cũng bị.
- Tới lúc sửa, engine mới có khoảng 9 lượt đăng nhóm có comment (từ 17/11), chưa lượt nào rơi vào các ca trên. `engine.facebook` bật cho mọi
  tổ chức từ 10:44 VN 18/11, nên khi khách lên 9.9.0 thì lỗi sẽ gặp thường xuyên.

- Giả lập (mục Kiểm) tìm thêm hai ca của V563 và bộ cũ, khi chưa lấy được link bài vừa đăng:
  - "Không comment vào post của mình": vị trí vượt số bài trên trang thì bấm trúng ô bình luận trong hộp thoại vừa mở, nên comment lại bài vừa comment (B, C, C).
  - "Comment tất cả" mà bài mình có 2 ô: vị trí 2 rơi vào ô thứ hai của bài mình.

## Sửa (chỉ nhánh "comment bài khác" trong workflow đăng nhóm)

- **Chọn theo bài trên trang, không theo ô.** Bỏ ô trong hộp thoại đang mở; các ô cùng mã bài tính là một bài.
- **Thấy bài vừa đăng:**
  - Lấy các bài nằm dưới bài đó, bỏ mọi ô của bài vừa đăng.
  - Lấy bài thứ k: k = vị trí khi bài chờ duyệt, vị trí trừ 1 khi không chờ duyệt.
- **Không thấy bài vừa đăng** (chưa có link, bài chưa hiện, bài chờ duyệt thật với link `/pending_posts/`): lấy bài thứ N trên trang như bộ cũ, nhưng đếm theo bài.
- **Hết bài để chọn:**
  - Ô thứ N không có trên trang: bấm ô thứ N như bộ cũ, nên ra lỗi "Không comment được bài thứ N" như hôm nay, cùng câu lỗi.
  - Ô thứ N vẫn có trên trang (là bài đã comment hoặc ô trong hộp thoại): bỏ qua lượt đó. Không ghi dòng lịch sử, không tính lượt, không có câu cho khách, như khi bỏ qua comment bài của mình. Bước trả `otherPostSkipped: true`; câu `helpers.log` chỉ hiện ở bảng thử workflow của admin.
- **Không đổi:**
  - Comment bài của mình (V563).
  - Comment seeding (cùng block, ngoài workflow đăng nhóm).
  - Câu cho khách, chính sách lỗi.
- Một khác biệt có chủ ý: có bài ghim đứng trên bài vừa đăng thì V568 bắt đầu từ bài nằm dưới bài vừa đăng. Bộ cũ comment vào bài mình, V563 comment 2 lần bài kế.

## Kiểm

- **Giả lập tuỳ chọn comment:** `CHROMIUM_PATH=<Chrome> node scripts/engine-v2-facebook/comment-options-sim.cjs [--out <thư mục>]`.
  - Chạy code thật của các bản engine production theo thứ tự workflow 321 sau bước bấm Đăng: lấy link 2873, nhận chờ duyệt 2848 (kèm hàm mở trang chờ duyệt thật của bộ lập lịch), bỏ qua nhóm đã biết cần duyệt 2875, chỉnh comment 2874, comment 2851 bản V563 hoặc V568.
  - Chạy trên trang Facebook giả trong Chromium, rồi đưa các bước cho bộ dựng lịch sử thật (`logMilestonesV2`) để ra đúng dòng lịch sử và câu tiến trình khách thấy.
  - Ma trận: 3 "Comment vào group nào" × 3 "Comment vào post nào" (tối đa 3) × 9 trường hợp: đăng ngay có / không lấy được link, bài mình 2 ô, chờ duyệt thật, ghi chờ duyệt vì còn bài chờ cũ, không kết luận được, bỏ qua vì nhóm đã biết cần duyệt, trang chỉ có 2 bài khác, đăng thất bại.
  - Báo cáo Markdown + JSON ở thư mục `--out`. Kết quả 18/11: V563 có 12/81 tổ hợp comment 2 lần vào một bài, V568 có 0.
  - Ngoài ma trận có ca giả định hộp thoại bài trước còn mở khi bấm ô kế. Ở ca này cả V563 lẫn V568 gõ vào ô nhập của hộp thoại đầu tiên, comment 3 lần vào một bài (xem mục "Chưa rõ").
- `CHROMIUM_PATH=<Chrome> node scripts/engine-v2-facebook/v568-smoke.cjs`: 14/14 nhóm đạt.
  - Chạy đúng code block trong Chromium với trang mô phỏng tường nhóm, mỗi ca nhiều lượt trên cùng một trang. Bấm ô thì trang mở hộp thoại bài đó; tuỳ ca hộp thoại cũ còn lại, bài vừa comment hiện thêm ô.
  - So code V563 (đang chạy) với V568:

    | Ca | V563 | V568 |
    | --- | --- | --- |
    | Chờ duyệt mà bài mình vẫn hiện (cả "Không comment vào post của mình" lẫn "Comment tất cả") | A, A, B | A, B, C |
    | Bài mình có 2 ô | mình, A, A | mình, A, B |
    | Bài A có 2 ô, hoặc bài vừa comment thêm ô | A, A, B | A, B, C |
    | Bài ghim đứng trên | A, A, B | A, B, C |
    | Hết bài | comment lại ô trong hộp thoại | bỏ qua |
    | Ô thứ N không có | lỗi | lỗi, cùng câu |

  - Các ca không đổi ra y V563.
  - SQL trên PG17:
    - Preflight từ chối khi block, danh mục bước hay block bộ cũ lệch.
    - Apply đổi đúng block 2851 và md5 đã duyệt của danh mục bước (bước 6, mức 2, gửi bằng Enter); block bộ cũ và block khác giữ nguyên.
    - Apply lại bị từ chối; gỡ về đúng V563 rồi apply lại được.
- Bài kiểm khác chạy lại đạt: `v563-smoke` 16/16, `v564-smoke` 12/12, `desktop-fb-smoke` 28/28, `core-smoke` 11/11.
- Chưa thử trên Facebook thật vì phải comment, là thao tác gửi đi.

## Apply và gỡ

- `node scripts/build-v568-sql.cjs` sinh `migrations/migration_v568_engine_facebook_comment_other_posts.sql` và bản gỡ. Không sửa tay hai file này.
- **Nguồn guard:** `scripts/fixtures/engine-v2-facebook/v568-live-20261118.json`, đọc chỉ đọc production 18/11.
  - Block 2851 md5 `06889369…` (bản V563), danh mục bước 6 md5 `06889369…`, block bộ cũ 34 md5 `30126bae…`.
  - Code mới md5 `d418b515…`.
- Chỉ dữ liệu, không DDL, không nạp lại schema PostgREST.
  - Desktop đọc code block mỗi lượt và danh mục bước ở lần nạp danh mục kế tiếp.
  - Trong lúc chưa nạp lại, bước comment chạy ở mức cam kết 1, như mọi block đổi code chưa duyệt (`stepCatalog.ts`).
- **Số migration:**
  - Bản này đổi số hai lần trước khi apply (V566 → V567 → V568). Sổ production đã có `migration_v565_aka_assistant` (11:48 VN 18/11), `migration_v566_aka_assistant_edge_guard` (11:49 VN) và `migration_v567_aka_assistant_data` (11:53 VN), đều của phiên khác.
  - Nhánh `claude/engine-target-check` còn giữ một V565 cũ.
  - Kiểm sổ ngay trước khi apply (12:15 VN): tới V567, không nhánh nào giữ V568.
- **Gỡ:** `migrations/rollback_v568_engine_facebook_comment_other_posts.sql` trả code + md5 đã duyệt về V563, chỉ chạy khi block đang đúng bản V568.

## Chưa rõ (không sửa ở đây)

- Bộ cũ, 7 ngày tới 18/11: 67 lượt có link comment thứ 2 / thứ 3 trỏ cùng bài với comment 1 (57 lượt trùng cả `comment_id`).
- Có thể chỉ là lấy nhầm link: block đọc link comment ở hộp thoại đầu tiên trong trang, mà hộp thoại của lượt trước có thể còn mở.
- Cũng có thể chữ của lượt sau bị gõ vào ô nhập của hộp thoại cũ (`fb_comment_dialog_textbox` lấy ô nhập đầu tiên trong mọi hộp thoại), tức comment trùng thật ở cả bộ cũ lẫn engine.
  - Giả lập ca hộp thoại cũ còn mở cho đúng kiểu này (A, A, A).
  - Bộ cũ có lượt 3 comment cùng một bài, cùng `comment_id`.
- Muốn biết chắc phải xem trên Facebook thật: bấm "Bình luận" ở bài thứ hai khi hộp thoại bài thứ nhất còn mở, xem hộp thoại cũ có còn không. Chỉ mở hộp thoại, không gửi comment.
