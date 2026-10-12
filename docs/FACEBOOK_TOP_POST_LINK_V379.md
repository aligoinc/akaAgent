# Link bài trên cùng sau khi đăng trang cá nhân/fanpage

Trạng thái: **V379 đã apply trên akachat ngày 13/10/2026 lúc 04:07 Việt Nam**, history `20261012210755 / migration_v379_facebook_top_post_link`; block lấy link mới `2832`. Đã đọc lại và xác minh các row sau apply. **Không apply lại khi merge/phát hành. Desktop mới đã đóng gói trong 8.3.0 local, chưa phát hành.** [Receipt](../migrations/snapshots/facebook-top-post-link-v379/receipt.json), [preflight](../migrations/snapshots/facebook-top-post-link-v379/preflight.json), [snapshot sau apply](../migrations/snapshots/facebook-top-post-link-v379/after.json).

Theo yêu cầu người dùng: sau khi xác nhận đăng thành công, lấy permalink đầu tiên theo thứ tự DOM như logic group. Không đối chiếu nội dung, thời gian, snapshot trước đăng hoặc loại bài ghim. Chấp nhận link bài trên cùng có thể là bài cũ/bài ghim. Thiếu link vẫn giữ kết quả đăng thành công, không retry đăng.

## Thay đổi

- Workflow trang cá nhân thật/test (`2`, `251`): nhánh đăng thường và copy nguồn cùng đi qua `merge_compose` → `nav_profile` → `open_composer`. Node `nav_profile` dùng lại block `nav_to_url` (`5`) để mở `https://www.facebook.com/profile.php` trước khi đăng; composer giữ cơ chế chờ nút/ô nhập hiện có. Điều hướng thất bại thì không chạy composer/publish. Nhánh Reels và chia sẻ giữ nguyên.
- Sau khi đăng trên trang cá nhân: nối `click_post` → `fb_get_first_profile_post_link` → `merge_all`. Block riêng chờ render 3 giây, dùng `FbComposerRawPostLink`, dispatch `focusin`, chờ 700 ms rồi đọc `FbComposerPostLink`. Lấy link tại trang cá nhân vừa đăng, không điều hướng sau publish hoặc đọc phản hồi mạng.
- Scheduler ghi link của bước sau đúng lượt đăng vào `post_url` và log tiến trình. Dùng lại hiển thị/xuất Excel hiện có. Lượt thiếu link hoặc bước lấy link lỗi vẫn ghi thành công từ bước publish đã hoàn tất.
- Fanpage giao diện (`fb_post_current_identity_ui`, block `2672`): thêm 700 ms chờ sau focus trước đọc href; lỗi đọc link trả chuỗi rỗng, không làm kết quả đăng thành thất bại. Fanpage API và group giữ nguyên.
- Không đổi XPath, schema, RPC, quota, timeout xác nhận đăng, policy lỗi hoặc lịch sử detail; không thêm pool/connection/timer nền.

## Nguồn và triển khai

Nguồn là các row live của `akachat` (`cgjbsmqtfhqvttudyjzq`) tại thời điểm ghi trong [snapshot](../migrations/snapshots/facebook-top-post-link-v379/before.json). Khi bổ sung điều hướng trước đăng, đã đối chiếu lại toàn bộ nguồn với live và chụp thêm block `5`; thời điểm bổ sung ghi tại `navigation_dependency_captured_at`. [Manifest](../migrations/snapshots/facebook-top-post-link-v379/manifest.json) có SHA-256; migration kiểm tra MD5 toàn row (kể cả block điều hướng) và mapping action trước khi cập nhật, dừng nếu có thay đổi ngoài dự kiến.

Migration chuẩn: [migration_v379_facebook_top_post_link.sql](../migrations/migration_v379_facebook_top_post_link.sql). Đã chạy 38 ca smoke, đối chiếu checksum 11 row live và mapping action rồi thực thi bằng `node scripts/facebook-top-post-link-v379.cjs apply`. Muốn kiểm tra lại (chỉ đọc DB):

```sh
node scripts/facebook-top-post-link-v379.cjs verify
```

Lệnh apply dùng Supabase Management API đã linked và ghi history cùng transaction. Không tạo/alter bảng history, không reload schema. Nếu kết quả apply không rõ, đọc history và chạy `verify` trước khi quyết định bước tiếp theo; không tự chạy lại. Không apply lại migration đã có history.

Trang cá nhân cần app có scheduler mới để lưu `post_url`; app cũ vẫn đăng và có bước lấy link nhưng chưa lưu link trang cá nhân. Fanpage dùng logic lưu link sẵn có. Workflow đang chạy giữ snapshot hiện tại; lượt mới mới nhận cấu hình mới.

[Rollback](../migrations/snapshots/facebook-top-post-link-v379/rollback.sql) có guard, khôi phục đúng code fanpage và hai workflow trước V379. Giữ block mới để không phá tham chiếu của lịch sử run-step, giữ history migration và các link đã ghi. Không xóa detail cũ. Không có thay đổi metadata API cần reload.

## Kiểm chứng

- `node scripts/facebook-top-post-link-smoke.cjs`: 38 ca chạy JS được tạo từ snapshot live, workflow engine thật, adapter scheduler và PostgreSQL WASM. Chạy code điều hướng thật trên page giả lập để kiểm tra nhánh thường/copy nguồn đều vào profile trước composer, lỗi điều hướng chặn publish, Reels/share giữ đường cũ. Kiểm tra thêm link đầu tiên, lazy href sau 700 ms, thiếu link/lỗi trang/lỗi catalog, hủy, không lấy link khi chưa đăng, không mượn link lượt khác, migration/rollback và từ chối drift/apply lại.
- `node scripts/facebook-post-publish-smoke-test.cjs`: xác nhận publish, timeout 60/120/180 giây và lỗi group giữ nguyên.
- `node scripts/action-status-mixed-output-smoke.cjs`: 25 ca output cũ/mới, giữ context link và không ghi/đếm trùng.
- Hai typecheck `tsconfig.node.json` và `tsconfig.web.json` sạch.
- Người dùng đã chạy thật hai campaign trang cá nhân `29499` và `29500` ngày 13/10/2026. Đọc DB xác nhận run `2764845`/`2764851` hoàn tất, bước đăng mất 5,307/4,812 giây, bước lấy link trả `linkFound=true`; detail `5402391`/`5402396` lưu hai permalink khác nhau. Đây là kết quả quan sát từ lượt test của người dùng, agent không tự đăng bài.
- Campaign `29497` trước đó timeout tại `fb_click_post_button` sau 60 giây, chưa chạy bước lấy link. Nguyên nhân ảnh không xuất hiện trong composer chưa được xác định; phần điều tra này không thay đổi upload, click hoặc timeout.
