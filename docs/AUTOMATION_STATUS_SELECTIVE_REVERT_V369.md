# Revert chọn lọc danh mục Automation — V369

Đã apply trên **akachat**, ref `cgjbsmqtfhqvttudyjzq`, history
`20261009173841 / migration_v369_selective_revert_automation_status_catalog`,
lúc **00:38:41 ngày 10/10/2026 (Việt Nam)**. Không apply lại.

Người dùng yêu cầu hoàn nguyên phần task đã bổ sung vào
`auto_campaign_action_detail_statuses`, giữ dữ liệu đã được runtime sử dụng hoặc
Automation tham chiếu và giữ hệ thống policy kết quả mới. Đây là revert chọn lọc
V347/V349; không chạy rollback toàn bộ của hai migration đó.

## Kết quả

| Thay đổi | Kết quả |
| --- | --- |
| Dòng V347 chưa đổi, không được điều kiện Automation tham chiếu | Xóa đúng 54 ID đã kiểm chứng |
| Dòng seed V347 đã được runtime cập nhật | Giữ ID `3930173` |
| Mapping cũ được V349 điền `status_id`, chưa đổi và không có tham chiếu | Trả 82 giá trị về `NULL`, không sửa timestamp hay cột khác |
| Mapping cũ được V349 điền `status_id`, có thay đổi độc lập hoặc tham chiếu | Giữ 19 dòng: 17 có thay đổi, 2 được Automation tham chiếu (`149`, `91258`) |
| Dòng runtime tự tạo sau V349 | Giữ `4688058`, `4688097` |
| Cột mô tả dành riêng cho agent từ V347 | Bỏ `description`; không có mô tả được chỉnh độc lập |
| Số dòng tại thời điểm apply | 315 → 261 |

Giữ nguyên toàn bộ giá trị của các dòng còn lại, ngoại trừ cột `description` bị
bỏ và 82 giá trị `status_id` nêu trên. Không xóa 16 trạng thái `auto_status` do
V349 tạo; runtime policy hiện tại vẫn cần chúng. Không sửa `auto_error`,
`auto_account_action_status_policies`, `auto_status`, điều kiện Automation,
detail, input, note/log, block/workflow hay code ứng dụng.

**Runtime vẫn có quyền tự tạo mapping và điền `status_id` khi xuất hiện kết quả
thực tế.** Vì vậy một mapping hoặc giá trị đã gỡ có thể xuất hiện lại sau lượt
chạy mới. V369 chỉ hoàn nguyên seed thủ công, không tắt cơ chế tự sinh này.

## Backup, kiểm chứng và tương thích

Snapshot ở [automation-status-selective-revert-v369](../migrations/snapshots/automation-status-selective-revert-v369/):

- `before.json` và `backup-manifest.json`: toàn bộ cột/dòng, canonical JSON,
  checksum từng dòng/toàn bảng, schema, constraint, index, ACL/RLS, sequence,
  định nghĩa và thuộc tính RPC. Kèm toàn bộ 40 trạng thái, 19 policy, 104 policy
  lỗi và 11 điều kiện Automation. Đọc lại và xác minh trước khi ghi DB.
- `plan.json`: chính xác dòng xóa, dòng trả status ID và lý do giữ lại từng dòng.
- `apply-before.json`, `after.json`, `applied-manifest.json`: snapshot chụp trong
  cùng transaction với thay đổi và lịch sử migration; checksum file đầy đủ.
- `smoke.sql`, `smoke.json`: thử delete/update/drop, payload ghi catalog kiểu cũ,
  guard checksum/tham chiếu, rồi undo. Mọi giá trị của bảng khớp trước đó, sequence,
  cấu hình và function không đổi; kết thúc bằng `ROLLBACK`.
- `api-before.json`, `api-after.json`, `live-verification.json`: API `SELECT *`,
  quan hệ `auto_status` và bảng policy mới đều trả HTTP 200. `description` đã
  biến mất khỏi phản hồi API, xác nhận schema cache đã cập nhật.

Hai lần smoke đầu bị chặn trước commit bởi lỗi trong biểu thức kiểm chứng
(thứ tự toán tử JSON và độ chính xác số nguyên int64 trong metadata sequence).
Đã sửa và chạy smoke thành công trước apply. Metadata SQL dùng canonical JSON
PostgreSQL để không làm tròn `sequence.max_value` qua JavaScript. Không sửa hay
reset sequence. Hồ sơ các lần kiểm thử ở `attempts/*/result.json`.

Migration có `lock_timeout=3s`, `statement_timeout=30s`, khóa bảng nhỏ trong
transaction; guard fail-closed khi candidate/schema/RPC/config thay đổi. Bỏ cột
không dùng `CASCADE`. Dùng `supabase db query --linked` qua Management API hiện
có, không tạo pool/connection riêng. History ghi vào bảng đang có, không DDL
chuẩn bị history. Event trigger DDL hiện có thông báo PostgREST; không gửi thêm
`NOTIFY` thủ công.

Không cần build hay deploy lại app/API. Không thực hiện hành động thật để thử.
Không chạy lại typecheck/build vì không đổi TypeScript hoặc bundle; runner đã
qua `node --check`, SQL roundtrip và kiểm tra API trực tiếp.

## Các đối tượng giữ nguyên

Checksum trước/sau của toàn bộ cấu hình giống nhau:

| Bảng | MD5 toàn bảng |
| --- | --- |
| `auto_error` | `3f53554bba52af2e48b1f395b11103c4` |
| `auto_status` | `cdd6a6d442804e2bc645e0bd1d74e597` |
| `auto_account_action_status_policies` | `5753ff2a7141dc995e6231b2c7afe21e` |
| `auto_automation_trigger_statuses` | `ad1cc3d8cb21d77299f3cf0f48a499d3` |

Cả 7 RPC phụ thuộc giữ nguyên định nghĩa, owner, security mode, volatility,
configuration và ACL. Signature đầy đủ cùng source/target checksum (bằng nhau)
được lưu trong `before.json` và `after.json`:

| RPC | Source = target MD5 |
| --- | --- |
| `aka_agent_enqueue_campaign_detail_automations()` | `8f00d3496adbc0f1a82c5261f7824018` |
| `aka_agent_get_automation_options` | `971cae0a816058b9213b6e85b4fd252d` |
| `aka_agent_guard_automation_trigger_status_scope()` | `19f41536f4c47443ad8152eea64b9f90` |
| `aka_agent_save_automation_v205_internal` | `566456a7a9a2244f707bcbe668c5bb3d` |
| `aka_agent_save_automation` | `eabd2a7730a2ff803918e4cdbc70e5c5` |
| `auto_automation_to_json` | `c13373cfefa4f19eed801d20bdae216a` |
| `auto_save_automation_v171_internal` | `b84327bdc57c58a9df6404f3ce50ea09` |

RPC hiện tại dùng danh sách cột catalog rõ ràng và không đọc mô tả của bảng này.
Các bản vá live V361–368 được giữ nguyên; không dựng lại body RPC từ SQL cũ.

## Nếu cần khôi phục lại chính đợt revert này

[undo-selective-revert.sql](../migrations/snapshots/automation-status-selective-revert-v369/undo-selective-revert.sql)
đã được kiểm thử trong transaction. Chỉ chạy khi người dùng yêu cầu khôi phục.
SQL thêm lại cột mô tả, đúng 54 dòng và 82 giá trị trước V369, đồng thời ghi thêm
history, không sửa/xóa history cũ.

Undo dừng nếu mapping đã được runtime tạo lại, dòng cần phục hồi đã thay đổi
hoặc được Automation tham chiếu, hoặc schema đã đổi. Đối chiếu thủ công trong
những trường hợp đó; không bỏ guard, không xóa cưỡng ép, không restore đè cả
bảng, không reset sequence. Mô tả của mapping mới sau V369 dùng mô tả mặc định.

Runner: [automation-status-selective-revert-v369.cjs](../scripts/automation-status-selective-revert-v369.cjs).
Migration: [V369](../migrations/migration_v369_selective_revert_automation_status_catalog.sql).
Nếu kết quả apply không rõ, dùng chế độ `recover` để đọc receipt từ history;
không thử apply lại một cách mù quáng.
