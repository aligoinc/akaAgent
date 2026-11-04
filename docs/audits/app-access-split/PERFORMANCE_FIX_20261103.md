# Tối ưu quyền riêng đã triển khai — 03/11/2026

Đã sửa cả ba điểm từ [lần kiểm tra trước](PERFORMANCE_20261103.md): quét campaign
để xác định held work, kiểm tra quyền lặp theo dòng inbox/thông báo, và tìm tổ chức
cần giữ runtime. V448 đã apply **06:40:52 VN**; Chat API deploy **06:47:34 VN**.
Không cần build lại akaAgent Desktop/App Server, deploy hai web hoặc sửa CRM.

## Thay đổi và giới hạn quyền

1. Partial index `auto_campaigns(account_id)` chỉ chứa campaign đang chạy hoặc
   còn claim/unit. Kết hợp index secondary đã có, giữ dòng đã xóa đang cleanup.
   Không sửa helper/RPC, điều kiện quyền, receipt, claim hoặc transaction.
2. Chat API dùng hai CTE MATERIALIZED trong mỗi SQL read: staff một lần, mỗi
   account một lần. Point/account/mobile scope vẫn được thu hẹp; global unread
   không bị thu hẹp theo chip. Không cache qua request; statement tiếp theo xét
   quyền mới. Membership/direct assignment/team/department, tenant, phân trang,
   thứ tự và thông báo thu hồi quyền giữ nguyên. Mutation giữ guard trực tiếp.
3. Runtime discovery lọc ứng viên legacy theo gói sync hợp lệ, DISTINCT trước
   khi gọi helper. Giữ mọi org từng có product 5, kể cả hết hạn/xóa mềm, để helper
   tiếp tục quyết định quyền Agent, Chat và cleanup/held transport.

Không thêm SQL connection/pool/listener/replica, không đổi polling hoặc timeout.
Không gửi tin, đăng nhập QR hoặc chạy chiến dịch thật để kiểm thử.

## DB V448

Production duy nhất `cgjbsmqtfhqvttudyjzq`; ledger
`20261102234145 / migration_v448_app_access_campaign_held_index`.
Index tạo bằng standalone CREATE INDEX CONCURRENTLY qua Management API linked
hiện có, mất khoảng 2,32 giây; ledger chỉ chạy validation. Index 32 KiB, OID
`54823920`, valid/ready/live đều true. Không yêu cầu reload PostgREST.

[Receipt apply](performance-v448-apply-receipt.json) lưu checksum source và hậu
kiểm: **1.296 function cùng body/owner/ACL/security/config**, tám index cũ,
table/column ACL, RLS/policy và trigger không đổi. Source capture riêng có auth
vẫn nằm ngoài Git; snapshot public chỉ chứa helper held và metadata liên quan.

- [Migration canonical](../../../migrations/migration_v448_app_access_campaign_held_index.sql)
  dành cho local/fresh replay; **không chạy CREATE thường trên production**.
- [Postcheck/ledger validation](../../../migrations/tests/migration_v448_app_access_campaign_held_index_postcheck.sql).
- [Rollback riêng index](../../../migrations/rollback/migration_v448_app_access_campaign_held_index.sql):
  trước thao tác phải kiểm exact definition/helper, valid/ready/live và OID trong
  receipt; drift thì dừng. DROP CONCURRENTLY ngoài transaction. Không rollback
  V447/RPC/ACL. Concurrent DDL không trial ROLLBACK được; trial/rollback đã chạy
  trên PostgreSQL 17 local disposable trước apply.

## Source và deployment

Chat API source commit `644de45afe1ab5b787eb37b4003f25ac7c1a7cc3`, build từ repo
chính `/Users/lequangnhut/Repos/akaAgentChatApi`, nhánh
`codex/app-access-query-performance`. Không build/deploy từ worktree. Custom
Docker ignore loại `labs/` không thuộc task; không chứa credential/private capture.

Image `registry.fly.io/aka-agent-chat-api:app-access-perf-main-644de45-20261103`
digest `sha256:7cb55524f36bce4a3fa82aafcb24912c6a4a934f0d204c114c5919ae043299c2`.
Chỉ update API machine `7845747fe073e8`; so sánh config chỉ đổi `.image`.
Worker `784574da214578` và runtime `7817d7daee2d58` giữ image/config. Cả ba
machine started; API/worker 2 shared CPU/1 GiB, runtime 2 shared CPU/2 GiB giữ
nguyên. Không tăng pool hoặc tạo machine tạm cho rollout.

Lần cập nhật đầu Fly báo `MANIFEST_UNKNOWN`; hậu kiểm cả ba machine/config
chưa đổi. Thử lại cùng image thành công. Kiểm SHA-256 của năm file source và
năm file dist trên API khớp repo chính. 14 HTTP probes đạt; runtime reconnect
qua API mới, vẫn 226 account, realtime connected và lastError null.

## Kiểm chứng và phép đo

- Chat API typecheck/build và **120 file / 1.756 test** đạt (`labs/**` ngoài phạm vi).
- Native PostgreSQL 17: **69 ca parity cũ/mới + 276 ca chuyển quyền**, gồm shared
  account, thu hồi staff/account và ngoại lệ notification; point/scoped/hidden
  buffer budgets đạt. Harness index kiểm primary/secondary, claim/unit,
  deleted-held, account-operation, trial ROLLBACK và CREATE/DROP CONCURRENTLY.
- **11 đối chiếu production** trong cùng statement snapshot: row JSON/thứ tự,
  inbox legacy/separate, notifications và discovery server/all khớp hoàn toàn.
  Runtime discovery vẫn trả cùng 52/54 tổ chức trong mẫu.
- Harness synthetic 47.100 campaign: helper 615,38 → 0,08 ms; 1.000 claim writes
  3,26 → 4,29 ms và WAL 1.258.064 → 1.319.930 byte. Đây là fixture để nhận diện
  chi phí ghi của index, không phải benchmark throughput production.

SELECT production chỉ đọc, role quản trị; không coi là trung bình request thật:

| Mẫu | Trước | Sau |
| --- | ---: | ---: |
| Held helper, staff có 54 account | 1.730,921 ms | 18,490 ms |
| Inbox mẫu legacy lớn, 24 dòng | 2.540,297 ms | 100,454 ms |
| Đếm thông báo chưa đọc, cùng mẫu lớn | 6.092,097 ms | 102,663 ms |
| Tìm org runtime Server | 507,209 ms | 76,329 ms |
| Tìm org runtime tất cả | 429,313 ms | 20,176 ms |

Mẫu probe trước/sau khác thời điểm và cache; parity live và thống kê workload
tự nhiên bổ sung bên dưới để tránh suy hiệu năng chỉ từ EXPLAIN.

## Lưu lượng tự nhiên trước/sau

Hai cửa sổ SQL 06:34:13–06:39:50 (337.1s) và 06:47:55–06:53:09 (314.7s) Việt Nam.
So delta `pg_stat_statements` theo role/query; bỏ probe quản trị, không reset
thống kê và deallocation tăng thêm bằng 0. Query đổi ID được nhóm theo cấu trúc.

| Query | Trước (ms/call; số call) | Sau (ms/call; số call) |
| --- | ---: | ---: |
| Staff access / held work | 241.02; 481 | 5.96; 518 |
| Inbox | 1478.92; 11 | 76.02; 9 |
| Đếm thông báo chưa đọc | 744.80; 11 | 6.53; 9 |
| Trang thông báo | 43.24; 11 | 5.11; 9 |
| Tìm tổ chức runtime | 464.77; 23 | 68.59; 21 |

CPU DB 27.15% → 24.36% trong cửa sổ metrics tương ứng. Tốc độ SQL
782.6 → 899.7 calls/s (**+14.96%**); tổng SQL execution/giây
881.2 → 544.1 ms/s (**−38.26%**). Tổng elapsed
SQL cộng qua connection không phải CPU. Inbox hai mẫu cùng trung bình 201 dòng/call;
discovery cùng 52 org/call. Không coi hai cửa sổ là workload hoàn toàn giống nhau.

I/O wait 0.62% → 1.35%, RAM dùng 47.10% → 50.77%; sau sửa
không swap-in/out. Deadlock, conflict và temp-file/temp-byte tăng thêm đều bằng 0.

Các reader runtime account/owner không thuộc ba thay đổi này vẫn khoảng 378/449
ms/call (trước 352/448 ms); không suy rằng mọi query đã hết chi phí. Chưa có
bằng chứng cần thêm index cho ba điểm đã sửa trong mẫu hiện tại.

Hậu kiểm HTTP lần cuối 06:52:07 VN vẫn 14/14 đạt, runtime 226 account/realtime
connected. Ba báo cáo worker sau rollout: project 566/566 hoàn tất, không
claimLost/infrastructureErrors; backlog tức thời 0–2. Normalize vẫn có lỗi
`runtime_event_not_json_serializable` đã có trước: 11 dòng sau deploy và 12
trước deploy trong cửa sổ điều tra dài khác nhau; không so tỷ lệ bằng số đếm
này. `invalid_zalo_event_payload` có 23 dòng trước deploy, không có trong mẫu
sau. Không sửa/retry những event này trong task tối ưu.

Mẫu chỉ hơn năm phút buổi sáng; chưa đại diện tải đỉnh hay latency UI end-to-end.
Quyền được kiểm bằng integration/parity, không giả định authenticated UI hoặc
provider thật đã canary.

[Số liệu và receipt đầy đủ](performance-fix-receipt-20261103.json).

Hai lỗi P2 identity/lock-order được người dùng tạm hoãn vẫn giữ nguyên. Không
khẳng định đã kiểm UI authenticated, Windows thật hoặc provider canary. Source
commit/deploy và apply DB là các bước riêng; lượt này không phát hành bộ cài.
