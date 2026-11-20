# V598: comment vào link bài, khách nhập link bài chờ duyệt (/pending_posts/) (20/11/2026)

Trạng thái: **[PR #744](https://github.com/aligoinc/akaAgent/pull/744) vào `dev_3`, chưa merge; V598 chưa apply** (nhánh `claude/fb-584-pending-posts`). Đổi số V596 → V598 lúc ~14:00 VN 20/11: V596 đã có ở nhánh chat (`migration_v596_chat_facebook_page_access.sql`, worktree `akaAgent-fb-page-access`), V597 do session câu 585 giữ (FB48–FB50). Lúc đổi, sổ production tới V595 và `git log --all` / các worktree / akaAgentChatApi / SqlServerDashboard chưa có V598; kiểm lại ngay trước khi apply. Chú thích trong code block không ghi số migration, nên đổi số không đổi md5 code.

## Vì sao (câu 584 của bộ kiểm lỗi)

Khoá ca `err_fb_comment_box_not_found|fb_comment|comment_current_post|Không tìm thấy ô bình luận trên bài` (FB41). Đếm chỉ đọc 20/11:

- 24 giờ tới 12:53 VN: 28 lượt, 3 lần dừng chiến dịch. 25 lượt là link `/pending_posts/`, cùng tổ chức 335 / nhân viên 354, Desktop 9.9.0
  (engine, block 2869). Từ 18/11: 78/81 lượt là link `/pending_posts/`.
- Lúc kiểm, chiến dịch 56362, 59096, 59544 đang tạm dừng vì chuỗi này.
- Trang mở ra (vết bước `comment_current_post`, `output.actionResult.data` của block 2869; không cần ảnh):
  - 59 lượt: danh sách "Bài viết đang chờ · N" (bộ lọc Tác giả / Loại nội dung), không có hộp thoại bài;
  - 17 lượt: "Chưa có bài viết nào để xem xét" + "Không có bài viết nào đang chờ xem xét.": hàng chờ trống, bài không còn chờ (đã duyệt
    hoặc đã gỡ);
  - 2 lượt: hộp thoại bài không có ô bình luận, không có chữ chờ duyệt.
- Block 2869 (bản V472, cùng code với block bộ cũ 2616) chỉ nhận bài chờ duyệt bằng câu "bài viết của bạn đang chờ"… trong hộp thoại bài,
  nên mọi trang trên rơi vào nhánh không nhận ra: FB41, chính sách 339 cộng chuỗi, đủ 4 lượt liền thì dừng chiến dịch.
- 3 lượt FB15 đang có là link `/posts/` của bài mình đang chờ duyệt (luật câu chữ có sẵn), không phải `/pending_posts/`.

## Anh chốt (hộp chọn 20/11/2026: "Theo trang Facebook hiện"; không dùng element vì chưa có element sẵn)

| Link có `/pending_posts/`, không thấy ô bình luận, trang hiện | Mã | Khách thấy | Chuỗi lỗi / dừng | Data |
|---|---|---|---|---|
| "Bài viết đang chờ" (± "· N") | FB15 (chính sách 299) | Bài viết đang chờ duyệt nên chưa bình luận được | không cộng / không dừng | đóng, "thất bại" |
| "Chưa có bài viết nào để xem xét" / "Không có bài viết nào đang chờ xem xét" | FB17 (chính sách 301) | Không tìm thấy bài viết để bình luận. Kiểm tra link bài viết còn tồn tại. | không cộng / không dừng | đóng, "không tồn tại" |
| kiểu khác | FB41 như hôm nay | | cộng | đóng |

## Thay đổi (chỉ dữ liệu, không DDL, không phát hành app)

- Block 2869 "[engine] fb_comment_current_post" (workflow 317): thêm một đoạn trong `classifyCommentPage`
  ([fragment](../scripts/engine-v2-facebook/v598-pending-link.fragment.js)), sau các luật câu chữ V472, trước nhánh không nhận ra, chỉ khi link
  đang mở có `/pending_posts/`. Đoạn này so chữ trên trang mà block đã đọc sẵn (tiêu đề + chữ ngắn đang hiện). md5 `83bcdb40…` → `1c885e94…`.
- `auto_engine_block_steps` id 8: `reviewed_code_md5` đổi theo (giữ mức cam kết 2, gửi bằng Enter).
- Câu 533 (checkpoint xét URL trước) và câu 564 (FB17 theo câu "Bạn hiện không xem được nội dung này") không đổi.
- Bộ cũ 2616 (workflow 207 / 244, máy Desktop < 9.9.0) không đổi, như V563 / V572.
- Không đổi chính sách, câu cho khách, element, code app.
- Giao diện tiếng Anh chưa có mẫu thật nên chưa thêm chữ; trang tiếng Anh vẫn ra FB41.

Sinh bằng `node scripts/build-v598-sql.cjs` (guard [v598-live-20261120.json](../scripts/fixtures/engine-v2-facebook/v598-live-20261120.json)):
[migration](../migrations/migration_v598_engine_facebook_comment_pending_link.sql) `c510072b…`,
[bản gỡ](../migrations/rollback_v598_engine_facebook_comment_pending_link.sql) `04121048…`.

## Kiểm (20/11/2026)

`CHAT_REPO=<akaAgentChatApi> LC_ALL=C CHROMIUM_PATH=<Chrome> node scripts/engine-v2-facebook/v598-smoke.cjs`: **27/27 đạt**.

- Chạy đúng code block 2869 (bản production và bản V598) trong Chromium trên 10 trang giả, dựng theo chữ đọc được ở 78 lượt thật.
- Bản production ra FB41 ở 4 trang chờ duyệt. `V598_EXPECT_NEW_ON_OLD=1` chạy kỳ vọng mới trên code production: 4 lỗi (tái hiện lỗi).
- Bản V598 ra FB15 / FB17 ở 4 trang đó. 6 trang còn lại (checkpoint, "không xem được nội dung", bài mình chờ duyệt, link `/posts/` có chữ
  "Bài viết đang chờ", hộp thoại không có ô, có ô bình luận) ra kết quả y hệt bản production.
- SQL trên PG17: preflight từ chối khi block / danh mục bước / bộ cũ / sổ lệch; apply chỉ đổi 2869 + md5 đã duyệt; apply lại bị từ chối; gỡ về
  đúng bản production; apply lại được.
- Hai typecheck: 0 lỗi (không đổi TS).
- Cách engine xử lý FB15 / FB17 do block trả về đã thấy trên production: không cộng chuỗi (lượt 222840, 315192, 316054 FB15; FB17 của câu 564).
- Phát lại chữ trang thật (20/11 ~14:20 VN, chỉ đọc). Lấy `output.actionResult.data` của block 2869 ở mọi lượt bước `comment_current_post`
  trong `private.auto_engine_error_items`: 187 lượt có dữ liệu. Dựng lại tín hiệu trang (link, tiêu đề, `sample`, câu đã khớp) rồi cho qua
  `classifyCommentPage` của hai bản code (script một lần, ở scratchpad).
  - Bản production ra đúng mã đã ghi ở 187/187 lượt, nên dữ liệu dựng lại là đúng.
  - Bản V598, ca 584 (87 lượt):
    - 63 lượt → FB15 ("bài viết đang chờ · N");
    - 17 lượt → FB17 ("chưa có bài viết nào để xem xét");
    - 7 lượt giữ FB41. Đều là trang mở ra không còn link `/pending_posts/`: tổ chức 335 có 5, tổ chức 1097 có 2.
    - Cả 80 lượt đổi mã đều là link `/pending_posts/` của tổ chức 335.
  - Không đổi: câu 533 (checkpoint, 24 lượt), câu 564 (FB17, 70 lượt, trong đó 7 lượt là link chờ duyệt), FB15 có sẵn (6 lượt).

## Sau khi apply

- Hiệu lực từ lượt comment kế tiếp: Desktop đọc code block mỗi lượt. Trong ≤ 5 phút chưa nạp lại danh mục bước, bước comment chạy ở mức cam
  kết 1, như mọi lần đổi code block engine.
- Không tự chạy lại các chiến dịch đang dừng; khách tự bấm (như V472).
- Theo dõi: lượt FB41 của ca 584 còn link `/pending_posts/` phải về 0; FB15 / FB17 tăng ở tổ chức 335.
- 7 lượt FB41 của ca 584 mà trang mở ra không còn link `/pending_posts/` không thuộc bản sửa này. Trong đó tổ chức 1097 có một trang "Bạn
  không thể mua hoặc bán các mặt hàng trên Facebook" và một trang trống; tổ chức 335 có hộp thoại bài không có ô bình luận.
