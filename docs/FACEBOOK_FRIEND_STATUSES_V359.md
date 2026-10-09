# Facebook kết bạn — v359

Ngày kiểm chứng: 09/10/2026. Production: `akachat / cgjbsmqtfhqvttudyjzq`.

Bản sửa tiếp theo: [v360 — giữ kết quả khi hủy sau click và giữ quyết định tạm dừng qua nhiều policy](FACEBOOK_FRIEND_CANCEL_POLICY_V360.md). Smoke kết bạn hiện kiểm tra code v360; v359 bên dưới là lịch sử triển khai ban đầu.

## Phạm vi

Sửa `auto_blocks.id=39 / fb_add_friend` và Desktop scheduler. Các workflow thật/test dùng chung block: 208, 248, 3, 249; giữ nguyên graph, thứ tự nhắn tin/kết bạn và cấu hình workflow. Không sửa RPC, schema, policy, bộ đếm hoặc lịch sử kết quả cũ; không thêm connection/timer.

Nguồn live trước sửa: [snapshot](../scripts/fixtures/facebook-friend-status-live.json). MD5 toàn row block: `7a07491212e603b21b1585f8d6f0f78a`. Nguồn C# tại repo anh em: `akaBizAuto.AutomationModule/Services/mbasicFbChromeSeleniumService.cs:4078` (`AddFriendUid_Fb`) và `:2598` (`AddFriend_Fb`). Các literal XPath tham chiếu là bản lưu trong `Constants/FbXPathConstant.cs:338`; C# còn hỗ trợ nạp cấu hình XPath động, không truy cập server cấu hình C# cũ trong task này.

## Đối chiếu DOM

| C# step | Workflow v359 | Khác DOM không | Lý do |
|---|---|---|---|
| Điều hướng rồi chờ trang | Workflow giữ `nav_to_url`, block giữ chờ nút thêm tối đa 5 giây trước các probe | Có về cơ chế chờ | Giữ readiness của Electron hiện tại; không đưa cấu hình thời gian riêng của C# sang |
| `CancelRequestBtn` | `fb_friend_request_sent_button`: `//*[@role='button' and .='Hủy lời mời']` | Không về XPath/thứ tự probe | Trả `already_requested`, không bấm hủy |
| `ConfirmAddFrdBtn` | `fb_accept_friend_request_button`: `//*[@role='button' and .='Chấp nhận lời mời']`; bấm phần tử đầu tiên | Không về XPath/thứ tự/click target | Thành công trả `accepted`; lỗi click trả `failed` |
| `IsFriendBtn` | `fb_already_friend_button`: `//*[@role='button' and .='Bạn bè']` | Không về XPath/thứ tự probe | Trả `already_friend` |
| `AddFriendBtn` | Giữ XPath live `fb_add_friend_button`; bấm phần tử đầu tiên | Không về selector/click target | Thiếu nút sau ba probe trả `unavailable` |
| Chờ sau bấm | Giữ sleep 2 giây của Electron | Có về thời gian | C# lấy thời gian theo tài khoản cộng random; bản sửa này giữ pacing hiện tại |

Probe dùng `document.evaluate` trên document, không lọc visible và không thêm selector tiếng Anh/fallback/scroll. Click vẫn dùng PageController hiện có, giới hạn đúng phần tử đầu tiên. Không thêm xác minh sau gửi hoặc retry gửi; C# facebook.com được đối chiếu cũng chỉ click rồi chờ. Không port DOM mobile.

## Kết quả và policy

- `already_requested` → `đã gửi lời mời`; `already_friend` → `đã là bạn bè`. Không tăng lượt hoặc ghi thành công mới; không tăng/reset bộ đếm bad-target chỉ vì bỏ qua.
- `accepted` / `request_sent` → `thành công`, log phân biệt đã xác nhận và đã gửi lời mời. Có tính lượt như hành động thành công bình thường.
- `unavailable` → lookup `err_fb_add_friend_unavailable`; lỗi probe/click → policy lỗi runtime, thường `err_undefined`.
- `detail_status`, `counts_toward_limit`, `counts_toward_bad_target`, ngưỡng lỗi và side effects lấy từ `auto_error`. Giữ cùng snapshot policy từ lúc ghi detail tới finalize target. Không hard-code miễn quota hay miễn lỗi cho mã unavailable.
- Policy không còn active/tồn tại thì dùng fallback `err_undefined` hiện hữu. Lỗi đọc policy phải thất bại rõ ràng, không coi target thành công.
- Side effects cấu hình vẫn chạy khi `counts_toward_bad_target=false`. Không tự dừng vì policy không có side effects; khi có khóa account/action, giữ cơ chế chuyển campaign về chờ xử lý nếu không cấu hình trạng thái cụ thể để nhả lượt chạy.
- Nhắn tin và kết bạn cùng lỗi trên một input chỉ tăng bộ đếm campaign một lần, nhưng mỗi lỗi vẫn giữ policy của nó. Nhắn tin thành công không reset bộ đếm khi lỗi kết bạn được policy tính là bad-target. Việc bỏ qua kết bạn không che lỗi nhắn tin.
- Hủy trước thao tác không tạo kết quả hay lượt gửi mới. Không chạy lại lời mời vì lỗi ghi log/policy.

Policy live tại thời điểm kiểm chứng: unavailable có `detail_status=thất bại`, cả hai cờ count=false, không khóa/tạm dừng; `err_undefined` có cả hai cờ count=true, ngưỡng 4 và `update_status_campaign=tạm dừng`. Migration không sửa các giá trị này.

## Triển khai và tương thích

[Migration v359](../migrations/migration_v359_facebook_friend_statuses.sql) chỉ DML: thêm ba selector, sửa code/description/output_schema của block 39. Guard checksum toàn row block, selector cũ và bốn workflow; từ chối selector mới đã tồn tại hoặc apply lặp. Transaction/history không tạo schema/table phụ và không gửi reload PostgREST. Kiểm tra policy trước/sau giữ nguyên.

Scheduler mới truyền `facebookFriendOutcomeVersion=1`. App cũ không truyền capability này nên chạy nguyên body legacy đã chụp live; phát hành DB trước không ép app cũ đọc output mới. Scheduler mới gặp block cache cũ ghi `bỏ qua` không tính lượt cho `alreadyFriend` mơ hồ. Thoát hẳn rồi mở bản Desktop mới để nạp block/selector.

MD5 code đích: `5c0fc74531bd5c12643cf632d06193a8`.

Đã apply lúc **09:22:02 ngày 09/10/2026 (Việt Nam)**, history `20261009022202 / migration_v359_facebook_friend_statuses`. Verify transaction xác nhận code checksum đích, ba XPath và bốn workflow giữ nguyên; các policy giữ nguyên toàn row. Không apply lại khi phát hành Desktop.

Desktop đã build production local; chưa đóng gói hoặc phát hành installer trong task này. App đang phát hành vẫn dùng nhánh legacy cho đến khi chạy bản Desktop mới.

## Kiểm chứng

- `node scripts/facebook-friend-status-smoke.cjs`: Electron DOM thật + PageController + BlockExecutor, thứ tự các nhánh, phần tử ẩn, lỗi click/probe, cancellation, app cũ; chạy các method scheduler thật và đoạn finalize target thật. Kiểm tra policy toggle, policy snapshot, side effects, quota, threshold/null threshold, lỗi hỗn hợp, không đếm hai lần và không reset sai.
- `node scripts/facebook-friend-status-migration.cjs smoke`: rollback transaction trên linked production; drift code/metadata/selector/workflow, apply lặp, XPath/code đích và workflow không đổi; block/selector được phục hồi sau rollback.
- `node scripts/facebook-message-waiting-limit-smoke.cjs`: hồi quy nhắn tin, dừng downstream khi giới hạn và policy nghỉ 24 giờ.
- Hai `tsc --noEmit` (node/web) và `npm run build`.

Không gửi lời mời tới người dùng Facebook thật trong kiểm thử. DOM live của Facebook chưa được kiểm chứng trong task này.

Rollback DB: lấy baseline trong snapshot, nhưng phải chụp lại row live và guard checksum code/metadata trước khi khôi phục; không ghi đè thay đổi mới. Không cần xóa ba selector để rollback block. Runtime cũ vẫn dùng nhánh tương thích, không sửa hồi tố quota/report.
