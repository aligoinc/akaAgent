# Không tìm thấy ô đăng bài trong nhóm — V459

Đã apply trên **akachat** `cgjbsmqtfhqvttudyjzq` lúc **15:55:32 Việt Nam, 04/11/2026**.
Ledger: `20261104085532 / migration_v459_fb_group_composer_policy`.
Đây là thay đổi DB; không sửa/phát hành Desktop, không tự chạy lại chiến dịch.

## Phạm vi và kết quả

Theo yêu cầu người dùng, trường hợp đăng nhóm không tìm thấy nút mở hoặc form
đăng bài sau thời gian chờ hiện có được **Bỏ qua**. Mục tiêu là không dừng chiến
dịch vì liên tiếp gặp các nhóm không mở được composer, thường được khách báo
ở nhóm Mua bán. Không suy ra loại nhóm từ timeout; mọi nhóm gặp đúng lỗi này
được xử lý như nhau.

| Hành động | Mã policy | Kết quả |
| --- | --- | --- |
| `fb_post_group` | `err_fb_group_composer_editor_not_found`, ID 122 | Bỏ qua; hoàn thành input; không tính hạn mức; không tăng/reset chuỗi lỗi |
| `fb_post_my_profile` | `err_fb_composer_editor_not_found`, ID 94 | Giữ nguyên policy trước V459 |

Block **27** `fb_open_composer` chỉ chọn mã theo `input.composerActionCode`.
Vẫn trả `opened:false`, `statusCode:campaign_detail_error`,
`operationState:not_committed` và lý do `Không tìm thấy ô đăng bài`.
Policy mới dùng `detail_mode=override`, giải trạng thái `campaign_detail_skipped`
(ID live 51), `input_effect=complete`, `counts_toward_limit=false`,
`counts_toward_bad_target=false`; không đặt dừng chiến dịch, khóa tài khoản
hoặc khóa hành động. Policy Bỏ qua hiện hành giữ `bad_target_effect=ignore`
và `reset_error_streak=false`.

Các workflow đã có gate `input.opened === true`; khi không mở được form,
không đi vào nhập nội dung/đăng/comment. Không đổi workflow, XPath, thao tác
click, thứ tự sleep hoặc timeout 15 giây. Hủy, thiếu cấu hình element,
lỗi click và các exception khác vẫn giữ hành vi cũ.

Bốn nhóm bị lỗi composer này không tăng chuỗi lỗi. Nếu đã có ba lỗi thật trước
đó thì chuỗi vẫn là ba; một lỗi thật tiếp theo vẫn có thể chạm ngưỡng hiện có.
Không reset bộ đếm cũ, sửa kết quả lịch sử hoặc tự tiếp tục campaign đang dừng.

## Thông báo và nạp cấu hình

Người dùng đã chấp nhận giữ cách hiển thị của app hiện tại:
tiến trình vẫn có thể ghi `Lỗi "Tên nhóm": Không tìm thấy ô đăng bài` vì output
có `errorCode`. Lịch sử chi tiết được policy chuyển thành **Bỏ qua**, có cùng
nguyên nhân; không tính lỗi liên tiếp. Không sửa logger hoặc che mất lý do.

Catalog policy được chụp khi bắt đầu phiên chạy campaign; cache dùng chung
có TTL 60 giây. Một phiên đang chạy có thể vẫn giữ catalog cũ dù block đã mới.
**Thoát hẳn app rồi mở lại**, sau đó bật lại campaign cần chạy để nhận đồng bộ
block/policy; không cần cài bản mới. Không tự bật lại campaign cho khách.

## Source và migration

- Source block: [open-composer.js](../scripts/workflows/facebook-post/open-composer.js).
- [Migration V459](../migrations/migration_v459_fb_group_composer_policy.sql).
- [Rollback thủ công](../migrations/rollback_v459_fb_group_composer_policy.sql).

Migration giải theo tên/mã, kiểm tra checksum toàn cấu hình block và policy cá
nhân trước khi ghi; kiểm tra semantic của policy Bỏ qua đang có, chặn collision
mã mới hoặc drift metadata. Chỉ thêm policy mới và sửa mã trả về của block 27.
Chạy lại khi đã đúng không UPDATE, giữ timestamps. ID không hardcode trong SQL.
Rollback khôi phục block và giữ policy mới ở trạng thái inactive để bảo toàn
tham chiếu lịch sử; phải dừng campaign liên quan và khởi động lại app sau đó.
Không tự rollback hoặc apply lại bản đã live.

| Thành phần | MD5 nội dung không gồm ID/created_at/updated_at |
| --- | --- |
| Block 27 trước | `5a4405dd469ee5ac30f5bbbc9e8fddda` |
| Block 27 sau | `a8205c106feee987a598e2a00a8a57de` |
| Policy 94, giữ nguyên | `15beb040bc7d8d98235231d6292ac360` |
| Policy 122, với status ID live 51 | `a2543f058e19e53442138c4b32e680f9` |

SHA-256 migration đã ghi trong ledger:
`87f769085fd523138411c0dc69de8bd70a0c73faab3216b0268d60513944470e`.

Apply dùng Management SQL hiện có, DML và INSERT ledger trong cùng transaction.
Không tạo/đổi RPC, schema, ACL, connection/polling hoặc reload PostgREST.
Trigger audit cấu hình hiện có tự ghi sự kiện thêm policy.

## Kiểm chứng và giới hạn

- 20 kiểm tra PostgreSQL cục bộ: apply, idempotence, rollback/reapply, transaction
  rollback, ID khác production, collision/drift block/metadata/policy và thay đổi
  cấu hình Bỏ qua phải dừng trước khi ghi.
- 18 ca trên bốn graph workflow live 1/2/251/252 qua engine thật: timeout nút/form,
  group/personal, giữ đường thành công, hủy/exception và khôi phục Page identity.
- 17 ca scheduler/writer/settlement thật trên PostgreSQL cục bộ: Bỏ qua với bộ đếm
  ban đầu 0 hoặc 3, profile vẫn tính lỗi/chạm ngưỡng, giữ quota/input, replay không
  ghi trùng và tiến trình vẫn có nguyên nhân. Bốn nhóm liên tiếp Bỏ qua giữ bộ
  đếm ở 3, không dừng campaign. Không có thao tác Facebook thật.
- Trial production kết thúc ROLLBACK: block/policy cá nhân nguyên cả row và
  timestamps, chưa tồn tại policy mới sau rollback.
- Hậu kiểm apply: source khớp code live; policy mới khớp candidate; policy 94,
  mọi block khác, element, workflow built-in, status và status-policy giữ checksum;
  SQL trong ledger khớp chính file migration.
- Cả hai typecheck và build production local đạt. Build chỉ phục vụ kiểm chứng;
  không đóng gói, upload/phát hành app hoặc xác nhận campaign thật đã nạp policy.

Capture, script kiểm tra tạm và receipt đầy đủ giữ ngoài Git tại
`$HOME/.codex/local-audits/facebook-group-composer-policy-20261104/`.
