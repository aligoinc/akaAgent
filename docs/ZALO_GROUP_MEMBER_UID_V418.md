# Zalo — thành viên group/người lạ, V418

Ngày 20/10/2026, giữ action ID `zalo_message_group_member`, đổi tên thành
**Zalo - Nhắn tin, kết bạn đến thành viên group/người lạ**.

## Nhập data

- Form tạo/nháp có nút **Thêm data**. Hộp thêm data vào chiến dịch đã lưu có
  **Nhập/import data**, cùng luồng đang dùng cho SĐT.
- Với action này, TXT, ảnh, link sheet, template akaBiz và Excel/CSV nhận **UID
  Zalo**. Sheet/template đọc cột `Uid`; file khách hàng cho chọn cột UID.
  Nhập theo dòng hoặc dấu phẩy, lọc trùng, giữ tên và Info1–Info5.
- UID là chuỗi 5–30 chữ số, cùng khoảng hiện có của importer nhóm Zalo. Không
  đổi thành SĐT. Số JSON/Excel ngoài miền integer chính xác bị bỏ qua; nên để
  cột UID ở dạng Text để giữ đủ chữ số. CSV giữ UID dạng text và tên tiếng Việt.
- Giữ **Chọn thành viên group Zalo**, **Thêm bằng nhóm**, nguồn Nhóm data liên
  kết với tài khoản, giới hạn 10.000 dòng và kiểm tra quyền/trạng thái/lịch
  hiện có. Có thể lưu chung UID nhập thêm với thành viên group đã chọn.

## DB và runtime

[Migration V418](../migrations/migration_v418_zalo_group_member_uid_import.sql)
đã apply trên `akachat` / `cgjbsmqtfhqvttudyjzq`, history
`20261020114812 / migration_v418_zalo_group_member_uid_import`.
**Không apply lại.**

Chỉ sửa hai hàng:

| Hàng | Trước MD5 | Sau MD5 |
| --- | --- | --- |
| `auto_campaign_actions.zalo_message_group_member` | `3efc6d1a599bb6e96cfae379a0f04bbe` | `ae56598334d5bbd49da6cd34fbd27a9f` |
| `ai_prompt.id=12` | `24031cb581b97050e86e5aa945a98fc2` | `ec662b547a0802e94dadc459c0294576` |

Prompt ảnh nhận UID dạng chuỗi riêng cho action này; nhánh Zalo/SMS khác vẫn
đọc SĐT. Binding/model giữ nguyên. Migration khóa hai hàng và kiểm tra checksum
toàn hàng trước khi ghi, kiểm tra các field ngoài phạm vi sau ghi.

Workflow live 272 / test 273 giữ nguyên. Block 2782 truyền UID vào
`zaloResolveGroupMemberTarget`; helper resolve theo UID, không yêu cầu group ID.
Giữ nhắn tin/kết bạn, quota, policy, lịch, quyền, connection và polling.
Không thay RPC/schema hoặc reload PostgREST; history được ghi cùng transaction,
không chạy DDL chuẩn bị migration.

## Kiểm chứng

- `node scripts/zalo-group-member-uid-smoke.cjs`: IPC thật với fetch/AI giả lập;
  renderer thật trong Electron. Kiểm tra UID 19 chữ số, trùng/sai/unsafe number,
  tên tiếng Việt, hồi quy SĐT và auth; TXT, CSV, template Excel, sheet, ảnh; tạo
  campaign lưu chung thành viên group và UID; thêm UID vào campaign cũ, giữ
  lựa chọn tạm dừng/lọc trùng và nút chọn group.
- Hai typecheck `tsconfig.node.json`, `tsconfig.web.json` và `npm run build` đạt.
- Apply/restore trong transaction rollback trước apply; rollback có checksum
  trên bản live sau apply đạt. HTTP catalog trả tên mới và workflow 272.
- Không gửi Zalo thật; bước nhận diện ảnh dùng AI giả lập, chưa đo độ chính xác
  OCR của model thật.

## Sửa finding review — định dạng Excel

Hai tab template akaBiz và Excel/CSV khách hàng chỉ dùng giá trị gốc để kiểm
tra UID. Tên và Info1–Info5 lấy chuỗi đã định dạng của Excel, giữ nguyên cả
trong bản xem trước và data được thêm. Tránh biến ngày thành số serial, cắt
phần thập phân, mất định dạng phần trăm hoặc số 0 đầu.

Smoke Electron đã tái hiện lỗi trước sửa và đạt sau sửa ở cả hai tab với ngày
`20/10/2026`, số `12.75`, phần trăm `12.5%`, mã `000123`, ký hiệu `1.23E+05`,
dòng trống và UID số không an toàn. UID chuỗi 19 chữ số vẫn được giữ nguyên.
Chỉ sửa renderer và hồi quy; không đổi DB/runtime hoặc apply lại V418.

## Rollout và rollback

Tên catalog đã có hiệu lực khi tải lại catalog. Desktop cần nạp bản code mới
(restart app dev vì có thay đổi Main). Chưa đóng gói/phát hành Desktop.

Snapshot [trước](../migrations/snapshots/zalo-group-member-uid-v418/before.json),
[sau](../migrations/snapshots/zalo-group-member-uid-v418/after.json) và
[rollback có checksum](../migrations/snapshots/zalo-group-member-uid-v418/rollback.sql).
File `preflight-rollback.sql` là bằng chứng thử trước apply, không chạy lại khi
V418 đã live. Muốn rollback thật, revert phần app nhập UID và chạy rollback
trong transaction; dừng nếu checksum không khớp để tránh đè thay đổi mới.
