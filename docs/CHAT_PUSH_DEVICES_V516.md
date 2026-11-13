# V516 — Chat đọc iPhone đang nhận thông báo đẩy (13/11/2026, CANDIDATE, CHƯA APPLY)

Chủ sản phẩm yêu cầu 13/11/2026: nhân viên phải được báo khi có tin của khách, kể cả khi đã đóng akaChat và đang dùng
điện thoại. Bộ phát thông báo của Chat (akaAgentChatApi `docs/CHAT_ALERT_DELIVERY_20261113.md`) đẩy tin tới trình duyệt
bằng Web Push và tới iPhone bằng APNs. iPhone đăng ký ở danh bạ của [Trung tâm thông báo](NOTIFICATION_CENTER.md)
(`auto_notification_devices`, V457); V516 mở cho Chat đúng hai hàm để dùng danh bạ đó.

## Vì sao là hàm, không cấp quyền bảng

Đo trên akachat 13/11/2026 (chỉ đọc danh mục, không đọc token): bảng `auto_notification_devices` do `postgres` sở hữu,
bật RLS, ACL chỉ có chủ bảng; role SQL `aka_agent_chat_api` (BYPASSRLS, không phải superuser) không có quyền nào trên bảng
thiết bị và bảng phiên `auto_control_sessions`. Bảng chứa token đẩy của mọi nhân viên, nên Chat không được đọc thẳng:
hai hàm `SECURITY DEFINER` chỉ trả đúng thiết bị đang nhận của những nhân viên được hỏi và chỉ ghi ba kết quả cố định.
Lúc đo bảng có 0 dòng (bản iOS có đăng ký thông báo chưa phát hành), nên apply V516 chưa đổi gì cho ai.

## Hợp đồng

`public.aka_agent_chat_push_devices(p_staff_ids bigint[])` → bảng
`(device_id bigint, staff_id bigint, push_token text, apns_environment text, bundle_id text)`. STABLE, chỉ đọc.

- Luật chọn giống hệt lúc Trung tâm thông báo tự đẩy (V465): thiết bị `is_active` và `is_enabled`, có `push_token`, và
  phiên của thiết bị (`control_session_id` → `auto_control_sessions`) thuộc đúng nhân viên, chưa `revoked_at`, chưa hết
  `expires_at`. Thu hồi phiên, đăng xuất, tắt thiết bị hay Apple báo token hỏng đều có hiệu lực ở lượt đọc kế tiếp.
- Tối đa 10 máy mỗi nhân viên (máy đăng ký gần nhất trước) và 500 nhân viên đầu của mảng; mảng rỗng hoặc NULL trả rỗng.
- Không xét cài đặt của Trung tâm thông báo (bật đẩy, giờ yên lặng, trần mỗi giờ): đó là cài đặt cho sự kiện chiến
  dịch/tài khoản. Tin nhắn của khách có công tắc riêng ở Chat (`chat_staff_alert_preference`: tắt đẩy, tắt theo loại,
  ẩn nội dung) và Chat tự gộp thông báo theo hội thoại.

`public.aka_agent_chat_push_device_result(p_device_id bigint, p_outcome text)` → void. Ghi kết quả một lần đẩy của Chat,
như `complete_delivery` của worker thông báo:

| `p_outcome` | Thay đổi trên thiết bị đang `is_active` |
| --- | --- |
| `sent` | `last_success_at = now`, `failure_count = 0` |
| `failed` | `last_failure_at = now`, `failure_count + 1` |
| `invalid_token` | `is_active = false`, `deactivated_reason = 'token_invalid'`, `last_failure_at = now` |

Giá trị khác, NULL, hoặc mã máy NULL: lỗi `22023 chat_push_invalid_outcome`. Mã máy không có hoặc máy đã ngừng: không
đổi gì, không lỗi (máy người dùng đã gỡ giữ nguyên lý do của nó). Chat chỉ gọi `sent` mười phút một lần cho mỗi máy; lỗi
và token hỏng thì ghi ngay.

## Quyền

Cả hai hàm: chủ `postgres`, `SECURITY DEFINER`, `search_path = pg_catalog, public`, EXECUTE **chỉ** `aka_agent_chat_api`.
Thu hồi rõ khỏi PUBLIC, `anon`, `authenticated`, `service_role`, `aka_agent_desktop` (default ACL của schema `public` cấp
EXECUTE hàm mới cho anon/authenticated/service_role; chỉ REVOKE PUBLIC là không đủ). Không gọi được qua PostgREST. Postflight
của migration kiểm lại ACL từng hàm và kiểm Chat vẫn không đọc thẳng được hai bảng.

Chat API gọi bằng kết nối SQL sẵn có của nó (pool hiện tại, không kết nối mới): đọc thiết bị một câu cho mỗi lượt đẩy có
người nhận, ghi kết quả một câu cho mỗi máy theo nhịp nói trên. Thời hạn câu lệnh là của phiên Chat API; hàm đọc đi theo
`idx_auto_notification_devices_staff` (`staff_id` WHERE `is_active`) và khoá chính của bảng phiên.

## Không đổi gì khác

Không đổi bảng, index, trigger, hàm hay dữ liệu cũ; không thêm job, pool hay kết nối. Trung tâm thông báo, Desktop, Web
và iOS chạy như trước. Chat API dò hai hàm tối đa một phút một lần: chưa có thì chỉ không đẩy ra iPhone. Gỡ hàm hoặc
thu quyền lúc Chat API đang chạy cũng an toàn: lần gọi kế tiếp gặp lỗi "hàm không tồn tại"/"không đủ quyền" được coi như
chưa có (không làm hỏng lượt đẩy tới trình duyệt), rồi Chat quay về dò mỗi phút.

## Phía app iPhone và phiên đăng nhập

Luật "phiên của thiết bị còn hạn" có nghĩa: iPhone ngừng nhận ngay khi phiên của app trên máy đó hết hạn. Phiên native
dài 30 ngày; API của akaAgentWebApp (nhánh `claude/quirky-goodall-ndzp3q`, chưa deploy) gia hạn phiên native mỗi ngày một
lần khi app còn được dùng, nên chỉ máy không mở app 30 ngày mới ngừng nhận. Cùng nhánh đó cho phiên chỉ dùng Hội thoại
(V490) đăng ký được iPhone, và app mở đúng hội thoại khi bấm thông báo. Chi tiết: akaAgentWebApp
`docs/MOBILE_CHAT_PUSH.md`.

## Kiểm thử

`bash scripts/test-v516-chat-push-devices.sh` (PostgreSQL 16 cục bộ, bảng thiết bị lấy nguyên văn từ V457, quyền mặc định
của `public` dựng như production): 50 khẳng định — apply; quyền của năm role và ACL của hàm; luật chọn thiết bị (tắt, gỡ,
không token, phiên thu hồi/hết hạn/của người khác/không có, 10 máy mỗi người, 500 nhân viên, mảng rỗng/NULL); ba kết quả và
các giá trị bị từ chối; preflight (apply lại, thiếu role, bảng lệch tên cột hoặc kiểu cột); rollback hai lần rồi apply lại.

Chưa chạy trên production (kể cả phép thử tự huỷ). Chưa đo thời gian trên bảng thật vì bảng đang trống.

## Apply và gỡ

- Chỉ apply khi chủ sản phẩm yêu cầu rõ. Trước khi apply kiểm lại sổ migration và `git log --all -- 'migrations/migration_v516*'`
  (số `vN` dùng chung mọi nhánh): nếu V516 đã thuộc bản khác thì đổi số file này trước.
- `CREATE FUNCTION` làm PostgREST nạp lại schema: apply ngoài giờ cao điểm, một giao dịch, `lock_timeout` 2 giây.
- Thứ tự với các phần khác không bắt buộc: Chat API có hay chưa có mã bộ phát, Chat đang ở chế độ `off` hay `live`, hàm có
  trước hay sau đều chạy được. iPhone chỉ nhận tin chat khi đủ cả: V516, migration `20261113120000` của Chat, secret `APNS_*`
  ở Chat API, chế độ `live` cho tổ chức, và bản iOS có đăng ký thiết bị.
- Gỡ: [rollback](../migrations/rollback_v516_chat_push_devices.sql) xoá hai hàm; không có dữ liệu nào để khôi phục.
