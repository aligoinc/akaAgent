# Parent và nút Like riêng — V412, 20/10/2026

Đã apply trên akachat: `20261020080439 / migration_v412_comment_like_separate_elements`. Không apply lại. V412 thay phần selector gộp của V410 và khôi phục hai element bị xóa bởi V411; giữ thứ tự comment → Like và mọi nhãn.

## Trạng thái hiện tại

| ID | Element | Vai trò |
| --- | --- | --- |
| 1492 | `fb_dialog` | Parent dùng chung, giữ nguyên XPath |
| 1132 | `fb_like_button` | Khôi phục ID/tên; đổi XPath cũ có `article` thành selector tương đối |
| 1456 | `fb_like_button_at_n` | Khôi phục nguyên bản trước V411; hai block comment không dùng |
| 1691 / 1696 | `fb_newsfeed_like_button` / `fb_newsfeed_dialog` | Giữ nguyên cho newsfeed |
| 1787 | `fb_comment_post_like_button` | Đã xóa sau khi không còn tham chiếu |

Parent:

```xpath
//*[@role='dialog' and not(@aria-label='Thông báo') and not(@aria-label='Messenger')]
```

Nút Like:

```xpath
.//*[@role='button' and (@aria-label='Thích' or @aria-label='Like')]
```

Hai block 2074/2615 đọc riêng hai tên element. Lấy parent đầu tiên bằng `FIRST_ORDERED_NODE_TYPE`, rồi đánh giá XPath nút với **context là parent**, lấy nút đầu tiên. Không ghép hai chuỗi XPath. Guard `parent.contains(button)` chặn kết quả ngoài parent, kể cả cấu hình union có nhánh tuyệt đối.

Workflow 157/207, bản test 244/245 và các workflow 1/2/226/238 giữ nguyên checksum từ trước V412. Code comment 34/2616 giữ nguyên. Không thay runtime ứng dụng, schema/RPC/quyền/quota/lịch hoặc nhãn UI.

## Cache và triển khai

Ứng dụng đang mở có thể giữ XPath tuyệt đối cũ của `fb_like_button` trong element cache. Code mới chỉ nhận selector bắt đầu `.//`; gặp bản cũ thì bỏ qua Like và log cần khởi động lại ứng dụng. **Mở lại ứng dụng sau apply** để lấy XPath mới, không cần build/phát hành binary.

Một lượt đã nạp block V410 vẫn có thể hoàn tất bằng code cũ; nếu element gộp không còn trong cache/DB, nhánh best-effort cũ sẽ bỏ qua Like. Không tự chạy lại comment vì lỗi lookup này.

## Kiểm chứng

- `node scripts/comment-like-separate-elements-v412-smoke.cjs`: **4 graph / 8 vòng lặp** qua engine thật với code comment hiện có; giữ thứ tự comment → Like và kết quả comment ở merge.
- **24 ca Electron DOM**: tiếng Việt/Anh, parent khác dùng cùng nút Like, parent đầu tiên, thiếu parent/nút, nút ngoài parent, XPath tuyệt đối cũ, union thoát parent, tắt Like, comment thất bại, `aria-pressed` và hủy sau đọc parent.
- `node scripts/comment-like-separate-elements-v412.cjs test`: apply + khôi phục thực tế trong transaction rồi rollback; toàn bộ snapshot element/block/workflow trở về nguyên vẹn.
- Apply và postflight live đạt: khôi phục 1132/1456, parent 1492 nguyên vẹn, xóa 1787, chỉ hai block Like đổi code. Không gửi comment/Like thật trong kiểm thử.

Hai finding review V410 **được giữ nguyên theo yêu cầu người dùng ngày 20/10/2026, không tiếp tục sửa**: (1) bài đã Like có nhãn “Bỏ thích/Unlike” bị selector loại trước khi kiểm tra `aria-pressed`, có thể chọn Like của bình luận; (2) account guard hủy trong Like sau comment thành công vẫn có thể requeue input vì reader chưa đặt dấu ngăn chạy lại. Tách selector không giải quyết hai finding này; không báo lại chúng thành finding mới trong các lượt review tiếp theo.

Review tiếp theo ngày 20/10/2026 không tìm thấy finding mới ngoài hai điểm đã được chấp nhận giữ nguyên. Chạy lại 4 graph/8 vòng, 24 ca Electron DOM và verifier DB live đều đạt. Kiểm tra này dùng DOM fixture, không gửi comment/Like thật trên Facebook.

## Nhãn tùy chọn — V413, 20/10/2026

Theo yêu cầu mới, nhãn `enablePostLike` đổi thành **Like bài post khi comment** tại checkbox, danh sách trường của form và phần thông tin chiến dịch Desktop. Cả hai chiến dịch comment dùng chung nhãn này; giá trị cấu hình và thứ tự gửi comment → Like không đổi.

V413 đã apply trên akachat: `20261020084709 / migration_v413_comment_like_label`. Chỉ sửa nhãn biến trong workflow 157/207 và bản test 244/245. Đối chiếu toàn bộ trường còn lại của bốn workflow, block comment/Like và các element đều giữ nguyên. Apply + khôi phục trong transaction rollback và postflight live đạt; không apply lại. Phần nhãn Desktop nằm trong source, chưa phát hành bộ cài.

V410–V412 giữ nguyên SQL/snapshot lịch sử. Verifier V412 so checksum workflow trước đổi nhãn nên không dùng riêng để xác minh trạng thái sau V413; đối chiếu [snapshot sau V413](../migrations/snapshots/comment-like-label-v413/after.json) và [receipt](../migrations/snapshots/comment-like-label-v413/receipt.json). [Migration V413](../migrations/migration_v413_comment_like_label.sql) có guard checksum; [rollback V413](../migrations/snapshots/comment-like-label-v413/rollback.sql) chỉ khôi phục nhãn cũ khi workflow chưa đổi, giữ history.

## Lịch sử và khôi phục

V411 `20261020075650 / migration_v411_comment_like_element_cleanup` đã xóa 1132/1456 khi không còn consumer; [receipt](../migrations/snapshots/comment-like-element-cleanup-v411/receipt.json) và snapshot được giữ. V412 phục hồi hai dòng này theo yêu cầu mới, không xóa/sửa history V410/V411.

- [Migration V412](../migrations/migration_v412_comment_like_separate_elements.sql)
- [Script apply/test/verify](../scripts/comment-like-separate-elements-v412.cjs)
- [Smoke](../scripts/comment-like-separate-elements-v412-smoke.cjs)
- [Snapshot trước](../migrations/snapshots/comment-like-separate-elements-v412/before.json)
- [Receipt/checksum](../migrations/snapshots/comment-like-separate-elements-v412/receipt.json)
- [Snapshot sau](../migrations/snapshots/comment-like-separate-elements-v412/after.json)
- [Rollback có guard](../migrations/snapshots/comment-like-separate-elements-v412/rollback.sql)

Rollback V412 khôi phục chính xác trạng thái sau V411: trả lại element gộp 1787 và code Like V410, xóa lại 1132/1456, giữ history. Chỉ dùng khi có yêu cầu khôi phục trạng thái đó; không tự áp rollback V410/V411 lên V412. Các verifier V410/V411 dành cho snapshot lịch sử; trạng thái hiện tại dùng verifier V412.
