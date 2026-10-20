# Like sau comment — V410, 20/10/2026

Đã apply trên **akachat**: `20261020074556 / migration_v410_comment_like_after`, xác minh lúc 14:45:58 giờ Việt Nam. Không apply lại.

**Trạng thái hiện tại đã được V412 thay phần selector:** dùng parent `fb_dialog` 1492 và nút Like tương đối `fb_like_button` 1132 riêng; xóa element gộp 1787, khôi phục 1456 sau V411. Thứ tự và nhãn V410 giữ nguyên. Xem [V412, cache, kiểm chứng và các finding còn mở](COMMENT_LIKE_SEPARATE_ELEMENTS_V412.md). Phần dưới là audit lịch sử V410.

## Phạm vi và luồng

| Chiến dịch | Workflow | Bản test | Block Like |
| --- | --- | --- | --- |
| `facebook_comment_seeding` | 157 | 245 | 2074 |
| `facebook_comment_seeding_post` | 207 | 244 | 2615 |

Luồng mới: mở/focus ô comment theo luồng hiện có → nhập nội dung/media → gửi → hoàn tất bước kiểm tra/lấy link hiện có → nếu `enablePostLike` bật và kết quả `commented=true`, `commentFailed` khác `true` thì Like.

Giữ nguyên **mọi nhãn**, gồm nhãn tùy chọn “Like bài trước khi comment”, tên/nhãn node, mô tả block và cấu hình form theo yêu cầu người dùng. Chỉ đổi code hai block Like, điều kiện/edges của bốn workflow, thêm một element.

Block comment **34/2616 giữ nguyên từng byte**. Delay paste/media/submit, kiểm tra lỗi và link comment giữ nguyên. Workflow đăng group **1**, timeline **2**, fanpage **226**, tương tác newsfeed **238** giữ nguyên; đăng group kèm comment không được thêm Like.

## XPath đã được người dùng thử và xác nhận

Parent:

```xpath
(//*[@role='dialog' and not(@aria-label='Thông báo') and not(@aria-label='Messenger')])[1]
```

Nút Thích:

```xpath
(//*[@role='dialog' and not(@aria-label='Thông báo') and not(@aria-label='Messenger')])[1]//*[@role='button' and (@aria-label='Thích' or @aria-label='Like')]
```

Element mới: **1787 / `fb_comment_post_like_button`**. Dùng `XPathResult.FIRST_ORDERED_NODE_TYPE`, chỉ lấy nút đầu tiên trong parent trên. Không fallback ra feed hoặc dialog khác. Giữ nguyên element Like cũ.

Không thấy nút, lỗi đọc element/click hoặc hủy thì bỏ qua Like; không làm thất bại hoặc gửi lại comment đã gửi. Nếu nút có `aria-pressed=true` thì không click để tránh bỏ thích. `liked=true` sau click là kết quả thao tác hiện có, không phải xác minh phản hồi máy chủ Facebook.

## Hợp đồng graph/runtime

Trong mỗi vòng lặp, `loop_comment(body)` nối thẳng vào comment. Comment nối vào `if_like`; nhánh true chạy Like rồi merge, nhánh false đi thẳng merge.

`if_else` trả `{branch, conditionResult}` và không giữ input. Vì vậy có thêm cạnh comment → Like để truyền kết quả comment cùng vòng, và comment → merge để giữ kết quả comment cuối nhánh. Engine hiện có chờ các parent hoàn tất trước merge; kiểm thử dùng engine thật. Guard ở block Like cũng yêu cầu `input.commented=true`, nên graph cũ đang giữ trong RAM không thể chạy code Like mới trước comment.

Workflow/block được đọc từ DB khi runtime nạp workflow; một lượt đã nạp code cũ có thể hoàn tất bằng code cũ. Element cache hiện có tự tải lại một lần khi thiếu tên mới. Không cần binary mới hoặc sửa runtime. Không thay RPC/schema/quota/policy/connection/polling, không reload schema.

## Kiểm chứng

`node scripts/comment-like-after-v410-smoke.cjs` đạt **96 kiểm tra**:

- 48 lượt chạy bốn graph bằng engine/block executor thật và code comment lấy từ DB: thành công, tắt Like, thiếu nút, lỗi Like/element, comment rỗng/lỗi, giới hạn tần suất, chỉ media, vòng sau rỗng, hủy, graph cũ.
- 4 kiểm tra giữ nguyên node/config/nhãn ngoài điều kiện Like.
- 8 lượt qua reader milestone thật của scheduler: giữ đúng một kết quả comment thành công và link khi Like thành công/thiếu nút/lỗi hoặc comment chỉ media.
- 10 kiểm tra PostgreSQL cục bộ bằng PGlite: DML, postflight, rollback và từ chối snapshot/migration bị lệch.
- 26 kiểm tra DOM bằng Electron thật: Like đầu tiên, tiếng Anh, dialog loại trừ, thiếu dialog/nút, đã Like, click lỗi, node bị gỡ và các thời điểm hủy.

Cả hai lệnh đạt:

```sh
npx tsc --noEmit -p tsconfig.node.json
npx tsc --noEmit -p tsconfig.web.json
```

Preflight và postflight **DB live** đã đạt: đúng bốn consumer của hai block Like, mọi trường ngoài phạm vi giữ nguyên, comment blocks và các workflow liên quan không đổi. Không gửi comment/Like thật trong các kiểm thử; XPath trên Facebook do người dùng trực tiếp xác nhận.

## Snapshot, checksum và rollback

- [Migration](../migrations/migration_v410_comment_like_after.sql)
- [Script build/preflight/apply/verify](../scripts/comment-like-after-v410.cjs)
- [Smoke](../scripts/comment-like-after-v410-smoke.cjs)
- [Snapshot trước](../migrations/snapshots/comment-like-after-v410/before.json), [manifest](../migrations/snapshots/comment-like-after-v410/manifest.json)
- [Receipt/checksum](../migrations/snapshots/comment-like-after-v410/receipt.json), [snapshot sau](../migrations/snapshots/comment-like-after-v410/after.json)
- [Rollback có guard](../migrations/snapshots/comment-like-after-v410/rollback.sql)

Migration và history ghi cùng transaction, khóa hàng/kiểm tra checksum trước đổi, đối chiếu toàn bộ row sau đổi. Không ghi lịch sử campaign hay thay quyền. Script apply dùng cơ chế Management HTTP/CLI hiện có; không mở pool mới.

Rollback chỉ khôi phục code hai block Like và nodes/edges của bốn workflow cùng timestamp cũ; guard từ chối nếu có bản sửa mới hơn. Giữ element mới và history làm dấu vết. Rollback đã kiểm thử cục bộ, **chưa chạy trên live**.
