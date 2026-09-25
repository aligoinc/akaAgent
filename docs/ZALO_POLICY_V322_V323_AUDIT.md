# Policy Zalo: thời gian khóa và 18 policy theo hành động

## Trạng thái bàn giao — 26/09/2026

- Production: `cgjbsmqtfhqvttudyjzq`.
- **Schema v322 đã apply**, history `20260925201346`. REST đọc `disable_action_days` và `disable_action_time` trả HTTP 200.
- **Dữ liệu v323 đã apply theo yêu cầu trực tiếp của người dùng** lúc 2026-09-26 03:27:21 giờ Việt Nam, history `20260925202721`. Người dùng quản lý phát hành runtime; trạng thái phát hành binary chưa được xác minh trong lần apply này.
- Live có 43 policy: thêm 18 row id 42–59, trong đó 4 row `days_at_time`; globals 12/13 đã bỏ mã Zalo và vô hiệu hóa. Toàn bộ 23 policy ngoài phạm vi không đổi; không cập nhật khóa hành động hay campaign.
- Source ở nhánh `codex/zalo-policy-days-at-time`, nền `7dbba81` / `origin/dev_3`. Worktree riêng không chứa phần Facebook đang sửa tại saved repo. Không đổi version phát hành, không upload bộ cài.

## Thay đổi

`auto_error` thêm hai cột nullable: `disable_action_days integer`, `disable_action_time time without time zone`. Mode mới bắt buộc có X không âm và `time_disable_actions > 0`; NULL X, X âm, 24:00 và X=0/Y=NULL bị constraint từ chối. Runtime kiểm tra số nguyên, giờ hợp lệ và thời điểm mở phải lớn hơn thời điểm khóa.

[`actionDisableTime.ts`](../src/shared/actionDisableTime.ts) dùng ngày Việt Nam của mốc DB: có Y thì cộng X ngày lịch và đặt giờ Y; Y=NULL thì cộng X×24 giờ. `00:00` là nửa đêm. Repository tính `date_enable` ngay từ `snapshots[0].clock.dbNow` đang dùng ghi `disabled_at`; scheduler truyền X/Y qua cả hai nơi áp dụng policy. Không thêm RPC, pool, timer hoặc UI. Ba mode cũ và mở khóa đến hạn giữ nguyên.

Thông báo của bốn policy thời gian mới dùng câu trung tính, hướng đến thời điểm mở trong thông tin tài khoản. Scheduler không thay [x]/[t] bằng phút dự phòng cho mode mới. UI hiện có vẫn đọc `date_enable`.

| Mã + scope | Khóa | Mode/thời gian | Detail | Quota / bad-target | Campaign |
|---|---|---|---|---|---|
| 120: nhắn người lạ | Chính action | X=1/Y=09:45; cũ 1440 phút | NULL | false / false | Giữ luồng chờ |
| 120: thêm thành viên | Chính action | X=1/Y=09:45; cũ 1440 phút | NULL | false / false | Giữ luồng chờ |
| 802: nhắn người lạ | Chính action | X=2/Y=09:45; cũ 2880 phút | NULL | false / false | Giữ luồng chờ |
| 802: thêm thành viên | Chính action | X=2/Y=09:45; cũ 2880 phút | thất bại | true / false | Giữ luồng chờ |
| 123: bạn bè / người lạ / nhóm | 3 policy, mỗi policy khóa chính action | 30 phút | thất bại | true / false | Giữ luồng chờ |
| 126/127: bạn bè + người lạ | Không | — | thất bại | true / false | Giữ nguyên |
| 126/127: nhắn nhóm | Nhắn nhóm | 30 phút | thất bại | true / false | Giữ luồng chờ |
| 126: thêm thành viên | Thêm thành viên | 30 phút | thất bại | true / false | Giữ luồng chờ |
| 221: nhắn nhóm | Nhắn nhóm | 60 phút | thất bại | true / false | Giữ luồng chờ |
| 223: kết bạn | **Không** | — | NULL | false / false | **tạm dừng, chạy lại thủ công** |
| 224: kết bạn | Kết bạn | Vô hạn, mở thủ công | NULL | false / false | tạm dừng |
| 215/251: kết bạn | Không | — | thất bại | true / false | Giữ nguyên |
| 219: tìm SĐT | Không | — | thất bại | false / true | Bộ đếm hiện có |
| 227: tham gia nhóm bằng link | Không | — | thất bại | false / true | Bộ đếm hiện có |
| 210: tìm SĐT + kết bạn | Không | — | không tồn tại | false / false | Giữ nguyên |
| 264/269: thêm thành viên | Không | — | NULL | false / false | tạm dừng |

Tổng 18 bản ghi / 15 mã. JSON cấu hình đầy đủ: [desired.json](../migrations/snapshots/zalo-policy-v323/desired.json). Quota trong bảng là cờ policy; `zaloAddGroupMember` vẫn override false khi thất bại. Không sửa retry, bộ đếm, workflow hoặc chống gửi trùng. Hai policy 221 tìm SĐT/kết bạn hiện có giữ nguyên. Khóa action vẫn dùng chung giữa các chiến dịch của cùng tài khoản.

## Preflight, triển khai và rollback

[before.json](../migrations/snapshots/zalo-policy-v323/before.json) chụp live lúc 2026-09-25 20:04:23 UTC, gồm toàn bộ row/checksum, schema và trigger metadata. [after-schema.json](../migrations/snapshots/zalo-policy-v323/after-schema.json) xác nhận schema và dữ liệu sau smoke.

[pre-apply.json](../migrations/snapshots/zalo-policy-v323/pre-apply.json) chụp lại live ngay trước apply; 25 checksum vẫn khớp preflight. [post-apply.json](../migrations/snapshots/zalo-policy-v323/post-apply.json) lưu các row/checksum và history sau commit. SQL verify và REST HTTP 200 cùng xác nhận đủ 18 cấu hình, hai global đã vô hiệu hóa và cờ/thời gian đúng bản chốt.

v323 khóa bảng auto_error ngắn trong transaction (lock timeout 3 giây, statement timeout 30 giây), đối chiếu cả 25 checksum và row count trước ghi. Tạo 18 policy có internal error_code riêng, bỏ các mã đã xử lý khỏi globals 12/13 và vô hiệu hóa hai global. Không xóa bản ghi. Cuối transaction đối chiếu cấu hình, uniqueness mã+action và checksum các policy ngoài phạm vi.

1. Schema v322 và dữ liệu v323 đều đã hoàn tất; không chạy lại lệnh apply hoặc smoke dùng snapshot trước migration.
2. Người dùng phát hành Desktop/Server theo quy trình hiện có. Build kiểm thử ở worktree giữ version 7.4.0 của nền; chưa phải một release đã tăng version hoặc bộ cài đã upload. App chưa cập nhật đọc policy bằng fallback 24/48 giờ đã kiểm thử; app mới dùng X/Y.
3. Lệnh kiểm tra sau apply, chạy từ worktree:

   ```bash
   ZALO_POLICY_LINKED_ROOT=/Users/lequangnhut/Repos/akaAgent node scripts/zalo-policy-migration.cjs verify
   ```

Script kiểm tra linked ref và dùng CLI hiện có. Lệnh apply ghi migration history cùng transaction, không chuẩn bị bảng history bằng DDL và không reload schema. Nếu preflight báo live thay đổi, dừng đối chiếu và cập nhật snapshot/migration sau review; không bỏ kiểm tra.

Rollback dữ liệu: [migration_v323_zalo_scoped_policies_rollback.sql](../migrations/tests/migration_v323_zalo_scoped_policies_rollback.sql). Script kiểm tra trạng thái sau apply trước khi phục hồi hai global đúng snapshot, vô hiệu hóa 18 policy mới và giữ lịch sử của chúng. Không mở khóa đã có, không tính lại date_enable, không sửa/chạy lại campaign. Rollback này chủ ý trả lại cách xử lý global cũ; cần ghi migration history riêng khi thực sự sử dụng. Schema hai cột có thể giữ lại khi rollback runtime/data.

## Kiểm chứng đã chạy

- Hai `tsc --noEmit` cho node/web: PASS.
- `npm run build`: PASS, output `out` khoảng 36 MiB.
- `npm run build:server`: PASS, output `out-server` khoảng 2 MiB.
- `node scripts/zalo-policy-days-at-time-smoke-test.cjs`: PASS. Actual mapper/repository/scheduler methods; 3 múi giờ máy, NULL/00:00, qua tháng/năm/năm nhuận, cấu hình lỗi không ghi khóa; cả 2 scheduler paths dùng cùng DB snapshot.
- Fixture [legacy-7dbba81](../scripts/fixtures/zalo-policy-legacy-7dbba81.json) chép đúng mapper và repository trước thay đổi: PASS 120/802 thành 24/48 giờ có date_enable.
- Actual lookup + 18 policy: PASS uniqueness/scope, 223 pause/no lock, 221 ba scope, không fallback global khóa chéo. Milestone chống retry sau gửi thành công/một phần, shared phone lock và add-member quota override: PASS.
- `node scripts/zalo-rich-share-smoke-test.cjs`: PASS Local/Server friend/group share và kết quả hỗn hợp.
- `node scripts/campaign-failure-cleanup-smoke-test.cjs`: PASS cleanup Desktop/Server, nested pause và bảo toàn claim/settle.
- SQL schema rollback smoke: PASS invalid/valid constraints. v323 smoke: PASS từ chối checksum bị đổi, cấu hình 18 policy, unchanged policies và rollback. Dùng ID âm trong transaction để không tăng sequence production.
- REST probe: HTTP 200 cho hai cột mới. Sau smoke toàn bộ checksum policy cũ không đổi. Sau apply v323: SQL verify PASS; REST đối chiếu 18 cấu hình PASS; 23 policy ngoài phạm vi giữ nguyên.
- Security advisor đã đọc; báo RLS chưa bật trên auto_error vốn có sẵn. Task không thay ACL/RLS hoặc tạo bảng/RPC; không xử lý cảnh báo ngoài phạm vi.
- Excel đã sửa 223, fallback 120/802, hướng dẫn triển khai; render và export/reimport qua artifact tool đã kiểm tra. Không thêm lại policy giữ nguyên.

SHA-256 SQL:

- v322: `6c6183f3eebe12ceadc6326cb6d528821057e84406283bd065993e773d0aa416`
- v323: `a1e1ae12172c733f4057c7e96c06bc08f4548c577d785b506341044312f1c19b`
