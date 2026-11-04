# Tối ưu kiểm quyền thường xuyên — V454

**Đã apply production `akachat / cgjbsmqtfhqvttudyjzq` lúc 16:28:58 VN, ngày 03/11/2026.**
Ledger: `20261103092858 / migration_v454_app_access_guard_performance`.
Không apply lại khi merge. Ledger, thời điểm, số đo và hậu kiểm nằm trong
[receipt](guard-performance-v454-receipt.json).

## Phạm vi và điều kiện giữ nguyên

Hai điểm cần tối ưu là `aka_agent_staff_access` và kiểm tra trạng thái chạy Zalo
Server. Migration thay ba hàm phụ thuộc/entrypoint; không đổi `staff_access`:

1. `private.app_access_held(text,bigint)` chuyển CASE từ điều kiện từng dòng
   thành hai nhánh EXISTS, dùng index PK/account hoặc staff đã có. Giữ nguyên
   account operation token, trạng thái đang chạy, campaign chính/phụ, claim và
   unit token. Tài khoản/chiến dịch đã xóa vẫn có thể giữ khóa cleanup như cũ.
2. `aka_agent_app_access_account_allowed(bigint,text)` dùng cờ Agent từ staff
   đã JOIN thay vì gọi lại toàn bộ staff helper. Điều kiện active/thời hạn,
   deleted/tenant và gói theo nền tảng vẫn giữ. Có gói Agent hợp lệ theo nền
   tảng đã bao hàm điều kiện có một gói Agent; không bỏ kiểm tra subtype Zalo.
   Nhánh Chat không đổi, giữ V449: chủ khóa/hết hạn không làm người nhận đủ
   quyền mất Chat. Legacy và trường hợp NULL/unknown app giữ kết quả cũ.
3. `aka_agent_get_zalo_server_run_control_state(bigint,bigint,bigint)` không
   tính lại quyền account khi đã có lý do dừng. Khi chưa có lỗi, các JOIN và
   staff scope trước đó đã xác nhận owner/tenant; legacy account helper luôn
   trả true trong trường hợp này. Chỉ separate mode gọi kiểm quyền account
   đầy đủ. Giữ nguyên thứ tự lý do dừng, pause, held-unit/time exception và
   SECURITY INVOKER/RLS. Kiểm `has_function_privilege` vẫn giữ ranh giới EXECUTE
   của helper ngay cả khi bỏ lượt gọi, tránh mở quyền cho role phụ.

Không thay cờ quyền, gói/quota, `is_chat_sync`, dữ liệu, receipt, claim/token,
identity, RLS, trigger, grants, timeout hàm, pool, polling hoặc số replica.
Không thêm index, TTL cache hoặc global timeout. SQL dùng transaction-local
`lock_timeout=5s`, `statement_timeout=20s`; không manual reload PostgREST,
không tắt event trigger hiện có.

## Nguồn chuẩn và migration

Capture live trong task này, sau khi fetch `origin/dev_3` (`b8f43bc3`). Tất cả
chín definition/dependency được đối chiếu lại trước apply. V445 là nguồn cũ
của held helper; account helper lấy body V449 live, control RPC lấy V446 live.
V450–V453 và các patch ngoài phạm vi được giữ nguyên.

| Signature | Source MD5 | Target MD5 |
| --- | --- | --- |
| `private.app_access_held(text,bigint)` | `091b58186a65975e5faf5e620569feac` | `b181b7ce926f8bf4b07cc6233ac4380a` |
| `aka_agent_app_access_account_allowed(bigint,text)` | `daf197a1cc419fd29030338e2ef2c936` | `410005b7e2720a1db565acfcd8c7e197` |
| `aka_agent_get_zalo_server_run_control_state(bigint,bigint,bigint)` | `532019b253e648044dd46821a3c4cec6` | `16505c0962e7a9a9d304d280400bfda1` |

- [Migration](../../../migrations/migration_v454_app_access_guard_performance.sql)
  có preflight/postflight fail-closed cho body, owner, ACL, security mode,
  volatility, parallel/strict/leakproof, cost/rows và config của chín hàm.
- [Capture](../../../migrations/snapshots/app-access-guard-performance/baseline.json),
  [target](../../../migrations/snapshots/app-access-guard-performance/target-definitions.sql),
  [manifest](../../../migrations/snapshots/app-access-guard-performance/manifest.json).
- [Production rehearsal](../../../migrations/snapshots/app-access-guard-performance/production-trial.sql)
  lấy kết quả trong cùng snapshot, áp candidate, so parity, thử rollback hẹp,
  so lại rồi kết thúc `ROLLBACK`. Không cập nhật dữ liệu người dùng.
- [Rollback hẹp](../../../migrations/snapshots/app-access-guard-performance/rollback.sql)
  chỉ khôi phục ba body đã capture nếu được chỉ thị, có guard target và
  dependency. Không tắt V447 hoặc mở lại quyền đã thu hồi. Không áp rollback
  sau lần apply thật; rehearsal sau apply cũng kết thúc bằng ROLLBACK.

## Kiểm chứng

Harness PostgreSQL 17 disposable đạt **574 ca: 270 ca hiện có + 304 ca mới**.
[Lệnh kiểm thử](../../../scripts/app-access-guard-performance-test.mjs):

```sh
AKA_CHAT_API_REPO=/path/to/akaAgentChatApi \
PHASE1_PG_BIN=/path/to/postgresql17/bin \
node scripts/app-access-guard-performance-test.mjs
```

Harness tái sử dụng fixture local Chat API; tạo wrapper tạm và xóa sau khi chạy,
không sửa source API, không dùng URL/connection production. Bao gồm:

- Parity helper và đầy đủ output control RPC: legacy/separate, hai app,
  khóa/hết hạn/xóa staff, thu hồi cờ, account xóa/khóa/logout, nullable org,
  sai tenant/owner, nền tảng/subtype, gói hết hạn/xóa, NULL/unknown input.
- Giữ claim/unit/secondary-account, account operation token, trường hợp
  campaign đã xóa còn giữ khóa và staff hết hạn nhưng còn runtime unit.
- Caller service_role, Chat API, Desktop với staff scope/RLS; anon và
  authenticated bị chặn. Role phụ có quyền đọc/control nhưng thiếu EXECUTE
  helper vẫn bị từ chối, kể cả nhánh legacy không gọi helper.
- Guard metadata/ACL/dependency drift, rollback/reapply, generic plan dùng
  index staff/account sẵn có trên fixture 6.000 tài khoản bổ sung.

Rehearsal production trước **và** sau apply đạt mỗi lượt: 2.380 phép kiểm quyền
account, 180 control, 469 held và 35 staff. So toàn bộ output trong cùng
transaction; không chỉ so cờ `allowed`. Các hàm không thuộc ba target giữ
fingerprint; metadata/quyền cả chín hàm giữ nguyên. Management API không
giả danh role app; kiểm thực thi các role nằm trong PG17 local và kiểm ACL
production, không coi đây là canary UI/HTTP/provider.

Hai typecheck akaAgent và production build local đạt; không đóng gói bộ cài.
Không gửi tin hoặc chạy chiến dịch thật để kiểm thử.

## Hiệu năng và giới hạn

Số đo dùng delta `pg_stat_statements` theo role/query trong lưu lượng tự nhiên,
không reset counters; probe quản trị không nằm trong nhóm query ứng dụng.
CPU lấy delta host metrics từ endpoint metrics hiện có, không thêm connection
SQL hay polling nền. Thời gian SQL cộng qua connection không phải CPU time.
Hai cửa sổ có tải và tập tài khoản thực tế khác nhau; không suy mức giảm CPU
toàn hệ thống chỉ từ chênh lệch SQL trung bình.

Cửa sổ SQL: **16:19:38–16:28:03** (505,8 giây) và **16:29:55–16:35:10**
(315,0 giây), giờ Việt Nam. Stats reset không đổi; deallocation tăng thêm 0.

| Query / caller | ms/lượt trước → sau | Block RAM/lượt trước → sau | Calls/s trước → sau |
| --- | ---: | ---: | ---: |
| Staff access / anon | 8,671 → 3,345 (**−61,4%**) | 1.262,05 → 76,72 (**−93,9%**) | 6,156 → 6,082 |
| Server run-control / service_role | 2,158 → 1,580 (**−26,8%**) | 59,32 → 36,28 (**−38,8%**) | 27,069 → 28,982 |
| Chat API SQL wrapper quanh control | 4,213 → 3,798 (**−9,8%**) | 90,90 → 69,12 (**−24,0%**) | 2,758 → 1,800 |

Staff access: 3.114 lượt trước / 1.916 lượt sau; control: 13.692 / 9.130;
wrapper: 1.395 / 567. Ba nhóm đều 1 row/call, không phát sinh đọc đĩa trong
counter query. Tần suất staff gần như giữ nguyên, control tăng khoảng 7,1%.
Tổng SQL elapsed của hai nhóm chính/giây: 111,80 → 66,14 ms/s, giảm 40,8%;
đây không phải CPU time.

**CPU toàn DB chưa giảm trong mẫu này:** 72,91% → 77,96%. Cửa sổ host metrics
là 16:21:28–16:28:06 và 16:29:58–16:35:12. Tải đọc đĩa nvme1n1 tăng
khoảng 2,52 → 8,99 MB/s; bộ đếm DB cũng cho thấy số block đọc/giây tăng.
Do hai cửa sổ có các workload khác nhau, không quy biến động CPU này cho bản
sửa và không khẳng định hai tối ưu đã giải quyết toàn bộ CPU cao. Kết quả chắc
chắn là hai nhóm query mục tiêu giảm chi phí mỗi lượt và số block RAM.

Deadlock/conflict tăng thêm đều 0; không swap. Toàn DB có một temp file
19.849.216 bytes ở cửa sổ sau (trước 0); chưa quy nguồn query trong task này.
Các số liệu thô và công thức delta giữ trong evidence riêng được dẫn ở receipt.

Trial production đầu gặp lỗi alias trong assertion so metadata, transaction
rollback hoàn toàn. Đã sửa assertion, không đổi checksum để vượt guard;
trial thành công trước apply và rehearsal sau apply đều kiểm tra đầy đủ parity.

## Trạng thái bàn giao

DB đã apply V454. Không deploy Chat API/worker/runtime, Chat Web, WebApp hoặc
CRM; không đóng gói/phát hành Desktop/App Server. Thay đổi hợp đồng SQL nội bộ
giữ nguyên signature/output/ACL nên ứng dụng hiện có sử dụng ngay. Source
migration, rollback, test và audit cần đưa vào nhánh chính bằng PR riêng;
merge không phải chỉ thị apply lại.

Kiểm tra trước PR ngày 04/11/2026, 09:31 VN: đọc live cả chín definition và
metadata; ba target khớp manifest, sáu dependency khớp baseline, owner/ACL/config
và các thuộc tính hàm không drift. Ledger vẫn `20261103092858`. SHA-256 migration
khớp receipt đã apply. Hai typecheck và build production local chạy lại đạt;
không apply/deploy hoặc đóng gói bộ cài trong bước tạo PR.
