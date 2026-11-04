# Tối ưu đọc lịch sử chống gửi trùng

## Tra người nhận trước lịch sử ngày 28 tháng 10

Đã apply trên **akachat `cgjbsmqtfhqvttudyjzq` lúc 12:10:45 VN ngày 28/10/2026**:
`20261028045419 / cooldown_recipient_indexes` và
`20261028051045 / cooldown_recipient_query`. Không apply lại.
Desktop, App Server và Chat dùng nguyên giao diện RPC, nhận tối ưu ở lần gọi tiếp theo;
không cần build, deploy hoặc restart client.

RPC `aka_agent_apply_campaign_delivery_cooldown(bigint,bigint,bigint,bigint[])`
tìm input lịch sử theo UID/SĐT chuẩn hóa trước, rồi dùng index `input_data_id`
hiện có để đọc detail thuộc tài khoản, hành động và khoảng thời gian cho phép.
Đường mới áp dụng Zalo person/group và SMS; Facebook/Email giữ đường V431.
Hai index mới dùng MD5 của UID/SĐT chuẩn hóa để không giới hạn chiều dài dữ liệu nhập;
query luôn kiểm tra lại giá trị chuẩn hóa đầy đủ để tránh khớp sai do hash collision.
Không thêm filter xóa mềm vào lịch sử.

Nguồn live khớp body của migration ownership ngày 28/10, gồm guard token Desktop;
ACL V435 vẫn thu hồi anon/authenticated. Source checksum
`c125235098f1d766e97ecc06c64db17b` → target
`018db8850de2f967b13240e6cd36158c`.
Owner/security/volatility/config/ACL không đổi; **1.254 hàm khác** và ACL/RLS
của bốn bảng liên quan giữ nguyên. Không tăng timeout RPC, role hoặc pool.

### Kiểm chứng và giới hạn số đo

- PostgreSQL 17 local: 66 ca tính đúng/metadata/quyền/rollback, gồm mọi loại chiến dịch
  đang hỗ trợ, UID hoặc SĐT, chuẩn hóa đầu số cũ/quốc tế, lịch sử đã xóa, ngày VN,
  lô 500, input không pending, dữ liệu dài 12.000 ký tự, INSERT dưới ba role và
  hai connection tranh cùng input. Lượt khóa sau trả `not_pending`, giữ status/note.
- Benchmark riêng 300.000 lịch sử/80 tài khoản, custom và generic plan: bản cũ
  khoảng 2,4 giây / 1,65 triệu block, bản mới khoảng 0,5–2,3 ms / 63–84 block.
  Đây là dữ liệu giả lập, không phải cam kết p95 production.
- Production, cùng một người nhận/90 ngày/toàn staff: SELECT phần đọc cũ timeout
  ở 5 giây; SELECT mới 15,739 ms / 85 block, planning riêng 36,919 ms.
  Đây là phần đọc lịch sử, không phải toàn bộ HTTP request.
- Diễn tập candidate trong transaction rollback và smoke sau apply đạt 12 điều kiện,
  gồm chặn token Desktop chéo staff; fixture đều rollback, không gửi tin.
- 7,5 phút đầu sau apply: 1.060 HTTP 200, không HTTP lỗi của RPC này.
  Mẫu thống kê tiếp theo 117 giây: 283 lượt, trung bình 12,62 ms SQL/lượt.
  Tám chiến dịch của staff gặp timeout đã tự tiếp tục; không thao tác resume thủ công.
- CPU mẫu 71,6 giây sau apply khoảng 64,9% thực thi, iowait 2,8%.
  Không quy toàn bộ chênh lệch CPU cho bản sửa vì tải request chưa được giữ cố định.

### Index và vận hành

`idx_campaign_input_cooldown_uid` (~213 MiB) và
`idx_campaign_input_cooldown_phone` (~161 MiB) tạo concurrent từng index.
Index SĐT lần đầu hết timeout khi chờ snapshot của pg_net; đã xác nhận trạng thái
invalid và rebuild riêng bằng `REINDEX INDEX CONCURRENTLY`. Cả hai valid/ready,
không còn index trung gian. Đã ANALYZE bảng input.

Không dùng bulk migration push cho file index concurrent. Script
`scripts/apply-cooldown-recipient-indexes.cjs` chạy từng phase qua Management API,
xác nhận project và definition/ACL trước khi chạy. API credential hiện có chỉ ở RAM.
Không tự retry/drop khi kết quả chưa rõ; `repair-phone` chỉ dành cho index đã xác nhận
invalid, đúng definition và không có lượt build đang chạy.
Phải rebuild index SĐT và kiểm tra lại tính đúng nếu thay đổi `normalize_phone(text)`;
CREATE OR REPLACE helper không tự cập nhật các khóa đã lưu trong index.

Snapshot/checksum, số đo, receipt và rollback guard nằm ngoài Git tại
`$HOME/.codex/audits/akaAgent/cooldown-recipient-20261028/`.
Rollback RPC chỉ chấp nhận target checksum và khôi phục đúng source live, giữ hai index.
Không dùng rollback V431 cũ vì có thể mất guard ownership/ACL mới.
SQL smoke: `migrations/tests/cooldown_recipient_lookup_smoke.sql`.
Local: `CHAT_REPO=/path/to/akaAgentChatApi node scripts/run-cooldown-recipient-sql-smoke.cjs`;
thêm `COOLDOWN_BENCHMARK=1` để đo 300k. `COOLDOWN_AUDIT_DIR` trỏ kho snapshot
ngoài repo; `PG17_BIN` chọn PostgreSQL 17 local.

## Lịch sử V431

V431 đã apply **akachat `cgjbsmqtfhqvttudyjzq` ngày 26/10/2026**, migration
`20261026075350 / migration_v431_cooldown_history_lookup`. Không apply lại.
Chỉ thay body RPC; Desktop, App Server và Chat tiếp tục gọi giao diện hiện có,
không cần build bộ cài, deploy hoặc restart để nhận thay đổi.

## Phạm vi và cách sửa

RPC giữ nguyên chữ ký:
`public.aka_agent_apply_campaign_delivery_cooldown(bigint,bigint,bigint,bigint[])`.

Trước V431, mỗi lần kiểm tra tạo toàn bộ lịch sử hợp lệ của tài khoản hoặc các
tài khoản cùng staff, gọi helper tạo/khử trùng/sắp xếp mảng khóa cho từng dòng,
đọc tên campaign, rồi mới đối chiếu lô người nhận.

V431 tính tập khóa của lô một lần, dùng đúng biểu thức chuẩn hóa đã chụp từ helper
để tạo mảng hai phần tử trên mỗi dòng lịch sử và lọc overlap trước khi materialize.
Các phần tử NULL/trùng không ảnh hưởng toán tử overlap. Chỉ lấy tên campaign
sau khi đã khớp người nhận. Mảng khóa lô rỗng bỏ qua lịch sử.
Giữ hai nhánh committed/legacy tách rời và các partial index V367 hiện có.

Vẫn đọc detail trong phạm vi account/action/thời gian; đây chưa phải index tra
người nhận trực tiếp trên lịch sử. Không thêm index, bảng, cache, RPC công khai,
query ứng dụng hoặc connection.

## Bất biến phải giữ

- V424: một tài khoản mặc định; chỉ `zalo_message_phone` có thể bật toàn bộ tài khoản
  cùng staff **và** tổ chức, kể cả các tài khoản lịch sử đã inactive/xóa như hành vi cũ.
- V367: bằng chứng `operationState=committed` được tính kể cả tên trạng thái tùy chỉnh;
  nhánh trạng thái legacy chỉ áp dụng khi không có operationState.
- UID **hoặc** SĐT cho Zalo person; Facebook giữ namespace nhóm/Page/person/inbox,
  chuẩn hóa URL/UID; SMS giữ chuẩn hóa SĐT và Email giữ kiểm tra định dạng/case.
- Khoảng ngày Việt Nam, giới hạn 1–500 input, khóa input theo ID, quyền/phạm vi,
  thứ tự lô, pending CAS, note và kết quả trả về giữ nguyên.
- Không thêm lọc soft-delete vào lịch sử. Không đổi quota, claim/token, retry hoặc gửi tin.
- Giữ owner, security mode, volatility, search path, ACL và timeout của gate runtime.
  Không dùng tăng timeout để che truy vấn chậm.

**Khi sửa helper lịch sử/chuẩn hóa sau này phải đối chiếu cả phần inline của V431.**
Migration này chặn drift của wrapper, các helper và `normalize_phone(text)`;
không ghi đè body mới hơn. Source capture đã đối chiếu với V424 và helper V367 live,
không có patch DB-only bị bỏ lại.

## Checksum và hoàn nguyên

| Hàm | Trước | Sau |
| --- | --- | --- |
| RPC cooldown | `7801667ffff0dcdd5b999641e4dbed96` | `07630b82e68cba560a8c7538b24702d5` |
| Helper target keys | `f356ae8c97cab7890f4a1740b99adce3` | Không đổi |
| Helper history | `a8e94d7a35d42064236d369c6e0e088d` | Không đổi |
| Normalize Facebook | `d063c95ebfedc16eeabe4dabf73a211d` | Không đổi |
| Normalize phone wrapper | `b3ad52bceed9a68a6648956fbc622629` | Không đổi |
| Normalize phone base | `f6ccb574895043480e6523193f7be007` | Không đổi |

[Source/metadata](../migrations/snapshots/cooldown-history-v431/source.json),
[dependency](../migrations/snapshots/cooldown-history-v431/phone-dependency.json),
[target](../migrations/snapshots/cooldown-history-v431/target.json) và
[rollback có guard](../migrations/snapshots/cooldown-history-v431/rollback.sql).
Rollback chỉ thay wrapper, không xóa dữ liệu. Đã diễn tập rollback trên production
trong transaction: checksum về source, ROLLBACK cuối giữ target đã apply.
Không thêm NOTIFY reload vì chữ ký/kiểu trả về/quyền API không đổi.

## Kiểm chứng

- **60 ca SQL local** trên PGlite, đối chiếu toàn bộ kết quả và trạng thái input với
  bản live cũ: 15 action, UID/phone/email/URL, dữ liệu thiếu/sai, phạm vi staff/org,
  committed/legacy, ngày biên, lịch sử tương lai, soft-delete, batch/row guards,
  tie-break, 500 input với 3.000 lịch sử, cả generic/custom prepared plans,
  role anon/Chat, preflight và rollback.
- **11 kiểm tra live trước và 11 sau apply**, fixture riêng trong transaction rollback;
  không gửi tin hoặc chạy campaign. Xác nhận không còn campaign/input/detail fixture.
- Ba đối chiếu SELECT trên dữ liệu production trong cùng snapshot đều giống nhau.
  Mẫu 250 input cho 42 kết quả khớp ở cả hai bản.
- Hai typecheck và production build đều đạt. Không thay TypeScript ứng dụng.
- Các chỗ gọi đã đối chiếu:
  `src/main/data/repositories/campaignRepository.ts:6520` và
  `akaAgentChatApi/packages/database/src/campaignRuntimeRepository.ts:1353`.

Chạy test cô lập:
`CHAT_REPO=/path/to/akaAgentChatApi node scripts/run-cooldown-history-sql-smoke.cjs`.
[Smoke live rollback](../migrations/tests/migration_v431_cooldown_history_smoke.sql)
và [biên bản apply/số đo](../migrations/snapshots/cooldown-history-v431/apply-audit.json).

## Số đo đọc lịch sử

| Mẫu | Trước | Candidate |
| --- | ---: | ---: |
| 1 input, một tài khoản, 2.355 lịch sử, cache nóng | 397 ms | 97 ms |
| 1 input, toàn staff, 2.037 lịch sử | 377 ms | 99 ms |
| 250 input, cache nóng | 684 ms | 175–225 ms |
| Facebook inbox, 1 input | 19 ms | 5 ms |

Lô 250 input materialize 42 dòng phù hợp thay vì khoảng 2.356 dòng; số shared buffer
hits trong mẫu nóng từ 21.318 xuống 13.656. Có mẫu candidate lạnh 1.515 ms với 1.582
buffer reads; không dùng nó so phần trăm với mẫu cũ nóng.
Đây là SELECT/EXPLAIN phần đọc lịch sử, không bao gồm toàn bộ thời gian khóa/cập nhật
RPC và không phải cam kết p95 hay giảm CPU tương ứng.


## Lưu lượng thực tế sau apply

Trước: 14:47:50–14:52:54 VN (304.309s); sau: 14:54:29–14:59:48 VN
(319.008s), ngày 26/10/2026. Query PostgREST cooldown của role anon:

| Số đo | Trước | Sau |
| --- | ---: | ---: |
| Calls | 478 | 574 |
| Calls/phút | 94.2 | 108.0 |
| Tổng execution | 127.46s | 44.01s |
| Execution trung bình | 266.64ms | 76.67ms |

Trung bình giảm 71.2%; lưu lượng gọi/phút tăng nhẹ.
Log HTTP cho cửa sổ gần tương ứng: 480 → 567 request,
origin trung bình 374.01 → 148.78ms,
p95 2355.25 → 471.4999999999983ms, HTTP 5xx 5 → 0.
Không có HTTP 4xx/5xx cho RPC trong mẫu sau. Các cửa sổ có thể khác cơ cấu tài khoản/lịch sử;
execution bao gồm thời gian chờ, không phải CPU. Không reset thống kê hay thêm monitor.
Security/performance advisors trước–sau không có mục mới.
[Chi tiết cửa sổ và counters](../migrations/snapshots/cooldown-history-v431/production-comparison.json).
