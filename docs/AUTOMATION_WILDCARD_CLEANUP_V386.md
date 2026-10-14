# Dọn trạng thái hành động bị seed vào wildcard — V386

Đã apply trên **akachat** (`cgjbsmqtfhqvttudyjzq`) lúc **12:17:23 ngày
14/10/2026 (Việt Nam)**, history `20261014051723 /
migration_v386_automation_wildcard_cleanup`. Không apply lại khi merge.

## Phạm vi đã được duyệt

Xóa đúng 66 ID trong `public.auto_campaign_action_detail_statuses` có
`action_code IS NULL`: sáu giá trị dưới đây, mỗi giá trị được migration khởi tạo
ngày 15/07 seed cho 11 loại chiến dịch Zalo.

| Trạng thái | Số dòng xóa |
| --- | ---: |
| đã gửi tin nhắn | 11 |
| đã gửi lời mời kết bạn | 11 |
| đã là bạn bè | 11 |
| đã tham gia | 11 |
| đã gắn tag | 11 |
| đã đổi tên | 11 |

Điều kiện ID `78` của Automation **fr** (ID `84`, chiến dịch nguồn `20618`,
loại `zalo_message_phone`) là tham chiếu duy nhất tới 66 dòng. Trước khi xóa,
chuyển `status_mapping_id` từ `149` sang `91258`, `action_code` từ NULL sang
`zalo_add_friend`, giữ `status_value='đã là bạn bè'` và `sub_status_ids=NULL`.
Đây là thu hẹp điều kiện từ mọi hành động về riêng hành động Kết bạn, đã được
người dùng đồng ý. Giữ `fr` **đang tắt**, tăng `config_version` **2 → 3** và cập
nhật `updated_at` theo quy ước lưu cấu hình hiện tại. Không sửa các trường khác.

Danh mục **261 → 195** dòng. Giữ nguyên **106** mapping có hành động cụ thể;
**89** wildcard còn lại gồm Thành công, Thất bại, Lỗi (26 dòng mỗi giá trị) và
Không tồn tại (11 dòng). Không thêm trạng thái hay ánh xạ tên cũ sang tên mới.
Các điều kiện khác, `auto_status`, policy kết quả và policy lỗi giữ nguyên.
Không sửa detail/lịch sử thực thi, code app, block/workflow, RPC hoặc schema;
không cần build/deploy/reload schema.

## Bằng chứng và thực thi

- [Migration](../migrations/migration_v386_automation_wildcard_cleanup.sql).
- [Runner](../scripts/automation-wildcard-cleanup-v386.cjs): dùng
  `supabase db query --linked` qua Management API hiện có; luôn xác minh ref,
  không tạo client/pool/connection mới. Các mode: `prepare`, `build`, `smoke`,
  `apply`, `recover`, `verify`. Apply yêu cầu backup được đọc lại, checksum file
  khớp và smoke đã qua. Nếu kết quả apply không rõ, đọc history bằng `recover`,
  không chạy apply lại.
- [Snapshot](../migrations/snapshots/automation-wildcard-cleanup-v386/):
  `before.json`, `backup-manifest.json`, `prepared-manifest.json` lưu bản sao và
  SHA-256; `apply-before.json`, `after.json`, `applied-manifest.json` lấy lại
  receipt trong transaction đã commit. Bao gồm đúng source/target definition,
  MD5, owner, ACL, security mode, volatility và config của bảy RPC phụ thuộc;
  toàn bộ thuộc tính này không đổi.
- `smoke.sql`/`smoke.json`: chạy nguyên thay đổi rồi SQL khôi phục, so khớp
  toàn bộ danh mục, điều kiện, Automation, schema, sequence, RPC và policy;
  kết thúc bằng **ROLLBACK**. Bản smoke ban đầu trước khi thêm tăng
  `config_version` lưu riêng ở `attempts/initial-smoke.json`; chỉ bản cuối cùng
  khớp SHA-256 mới được dùng làm điều kiện apply.
- `live-verification.json`: đọc lại production, xác nhận không còn 66 dòng,
  các mapping còn lại không đổi (cho phép runtime cập nhật `updated_at`).
- `serialized-rule-verification.json`: đọc qua
  `auto_automation_to_json(bigint,bigint,bigint)`; trả đúng ID `91258`,
  `action_code='zalo_add_friend'`, `is_wildcard=false`, `fr.is_active=false`.
- `post-apply-undo-smoke.sql`/`.json`: sau apply kiểm thử đường khôi phục đọc
  receipt trong history, phục hồi đủ 66 dòng và mapping `149` rồi **ROLLBACK**.
  Không commit khôi phục hoặc history undo.

Migration có `lock_timeout=3s`, `statement_timeout=20s`; khóa ba bảng cấu hình
nhỏ bằng `SHARE ROW EXCLUSIVE` trong transaction để không có tham chiếu mới xen
giữa chuyển điều kiện và DELETE. Chỉ DELETE theo 66 ID đã sao lưu, có kiểm tra
nội dung dòng, schema/RPC, phạm vi chiến dịch, trạng thái/tổng số điều kiện của
`fr`, và FK `ON DELETE RESTRICT` vẫn bật. Dừng nếu có drift hoặc thêm tham chiếu.
Ghi history vào bảng đang có, không DDL chuẩn bị history và không NOTIFY.

`node --check` runner và smoke SQL đều đạt. Trước khi mở PR, cả hai typecheck
(`tsconfig.node.json`, `tsconfig.web.json`) và `npm run build` đều pass; renderer
build 24,34 giây, entry JS 14.619,57 kB. Chỉ có các cảnh báo chia chunk đã có.

## Khôi phục nếu được yêu cầu

[undo.sql](../migrations/snapshots/automation-wildcard-cleanup-v386/undo.sql)
phục hồi chính xác 66 dòng với ID cũ, trả điều kiện `78` về mapping `149` và
metadata cấu hình `fr` về bản sao, không thay sequence. SQL đã kiểm thử cả
trước và sau apply, nhưng **chỉ chạy khi được yêu cầu khôi phục**.

Undo dừng nếu một ID/tổ hợp đã được tạo lại, RPC/schema thay đổi, hoặc `fr` và
điều kiện đã được sửa kể từ apply (kể cả revision/timestamp). Không ghi đè
chỉnh sửa mới. Undo giữ history apply và thêm history riêng.

Cơ chế runtime tự ghi nhận mapping vẫn được giữ nguyên. Đây là dọn các dòng
seed hiện tại, không phải thêm quy tắc cấm runtime tạo mapping trong tương lai.
