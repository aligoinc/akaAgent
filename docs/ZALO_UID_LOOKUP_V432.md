# Tra UID Zalo — V432

## Vấn đề và phạm vi

Query Data API cũ đọc `zalo_users.*` theo account, staff và `zalo_uid = ANY(...)`.
Kế hoạch generic đã chọn `idx_zalo_users_staff_account`, lấy hàng nghìn hồ sơ
rồi mới lọc UID. Trong lần điều tra ngày 26/10/2026, một UID mất 1.176 ms,
đọc 2.018 block và loại 3.746 hàng; custom plan cho cùng đầu vào mất 13,989 ms,
đọc một block. Bảng đã có index UID và unique (account_id,zalo_uid).

Caller thuộc repo akaAgent, dùng chung Desktop và packaged App Zalo Server:

- `accountContactRepository.getExistingZaloUsers`: trước cập nhật hồ sơ từ
  chiến dịch và lưu thành viên nhóm.
- `campaignRepository.loadZaloRemarketingLookup`: tra tên, SĐT, giới tính,
  trạng thái bạn bè cho danh sách khách Remarketing.

App Server khởi tạo cùng CampaignScheduler/ContactLoader trong
`src/server/main/zaloServerRuntimeManager.ts`. Chat Worker có đường ghi SQL
khác; thay đổi này không yêu cầu deploy repo akaAgentChatApi.

## Hợp đồng

`public.aka_agent_lookup_zalo_users(bigint,bigint,text[])` trả SETOF zalo_users,
STABLE, SECURITY INVOKER. Giữ nguyên cả hai điều kiện account/staff và exact
text UID; UID trùng không nhân bản kết quả, UID NULL không khớp, mảng rỗng/NULL
trả rỗng. Scope phải dương và mỗi lượt tối đa 100 phần tử; các caller giữ chunk
100 hiện có, không thêm cache, retry, polling, pool hoặc connection.

SQL tách UID duy nhất rồi lateral point lookup qua unique account/UID, LIMIT 1
ngăn planner gộp lại thành quét theo staff/account. Lọc staff sau lookup duy nhất.
Custom plan chỉ nằm trong function; không thay cấu hình global. Timeout bulk 60s
theo quy tắc repo, không thay timeout role. Không đổi cách gộp payload, ghi hồ sơ,
friend status, quota, claim, token, lịch chạy hoặc xử lý lỗi.

Caller dùng HTTP client hiện có; lỗi RPC tiếp tục được ném theo đường cũ, không
fallback sang truy vấn cũ. Remarketing giữ projection nhỏ ở Data API.

Quyền EXECUTE chỉ postgres/anon/authenticated/service_role, không PUBLIC.
Invoker giữ quyền SELECT/RLS của caller. Bảng legacy đang RLS=false và anon,
authenticated có SELECT từ trước; task này giữ nguyên ACL/RLS, không tuyên bố
tham số staff là cơ chế xác thực mới. Kiểm tra local xác nhận RLS khi bật và
thu hồi SELECT đều được RPC tôn trọng.

## Audit migration và production

- Project: `cgjbsmqtfhqvttudyjzq` (akachat).
- Nguồn: tên function/signature chưa tồn tại, được kiểm tra lại ngay trước apply.
  Không có source checksum của function cũ; không thay RPC/helper đang có.
- Target definition MD5: `bbed74070ff8bf987c3311b5fb14bcfc`.
- History: `20261026090510 / migration_v432_zalo_uid_lookup`,
  apply lúc **16:05:10 Việt Nam, 26/10/2026**.
- Preflight từ chối mọi function cùng tên đã tồn tại hoặc unique index sai/thiếu;
  không dùng CREATE OR REPLACE để ghi đè bản live khác.
- Chỉ tạo một RPC. Không tạo index, cập nhật dữ liệu, thay table/RLS/ACL.
  Schema reload cần thiết vì đây là endpoint mới.
- Metadata sau apply khớp từng thuộc tính local: owner postgres, invoker, stable,
  search_path, custom plan, timeout và ACL.
- Security/performance advisors không có nhóm cảnh báo mới hay cảnh báo nhắc
  đến RPC mới; cảnh báo legacy không được sửa trong task này.

Snapshot source/target/after, HTTP và benchmark ở
[`migrations/snapshots/zalo-uid-v432/`](../migrations/snapshots/zalo-uid-v432/).

## Kiểm chứng

- 36 kiểm tra SQL cô lập bằng PGlite: ba role, toàn bộ cột/JSON, scope,
  null/trùng/UID dài/ký tự đặc biệt, lô 100/101, prepared calls đổi tham số,
  khôi phục setting outer, read-only, RLS/SELECT, preflight và guarded rollback.
- 11 kiểm tra repository thực tế, đối chiếu bản trước fix tại commit
  `f06b1416897565c005a356e56e570f9c84386660`: payload chiến dịch/thành viên,
  account khác nhau, 205 UID, Remarketing, lỗi giữa lô không retry/ghi tiếp.
- 11 kiểm tra hồi quy finalizer/quyền/claim của Zalo Server và 19 ca lọc contacts.
  Sửa mock auth cũ của bộ lọc để khai báo export getCurrentUserCredentials mà
  groupSharingRepository đang import; mọi credential thật vẫn bị chặn.
- Trước/sau apply: transaction rollback đối chiếu đủ cột của tối đa 100 UID
  trên ba account 1578/1581/1175, mảng NULL và guard 101 UID.
- Diễn tập guarded DROP trong transaction rollback; function live được giữ lại,
  checksum/metadata vẫn đúng.
- API thật bằng role anon: empty/missing UID trả HTTP 200 và mảng rỗng;
  oversized/invalid scope trả HTTP 400/22023. Supabase SDK thật đọc một UID đang
  tồn tại qua RPC, trả đúng một row và bảy field của projection Remarketing.
  Không gửi tin hoặc chạy campaign.
- Hai typecheck và production build Desktop + Server đạt.

Chạy lại:

```sh
CHAT_REPO=/path/to/akaAgentChatApi node scripts/run-zalo-uid-sql-smoke.cjs
node scripts/run-zalo-uid-repository-smoke.cjs
node scripts/run-zalo-server-contact-dataset-smoke-test.cjs
node scripts/run-account-contact-status-filter-smoke-test.cjs
```

## Số đo

EXPLAIN ANALYZE, BUFFERS trên account 1578/staff 385, role anon, outer
force_generic_plan; xen kẽ thứ tự cũ/mới. Đơn vị block PostgreSQL, không phải
số lần I/O vật lý. Mẫu nóng vòng hai:

| Đầu vào | Cũ | Mới | Block cũ → mới |
|---|---:|---:|---:|
| 1 UID không tồn tại | 4,477 ms | 0,331 ms | 3.679 → 3 |
| 1 UID tồn tại | 4,480 ms | 0,298 ms | 3.679 → 4 |
| 100 UID tồn tại | 16,676 ms | 1,505 ms | 3.679 → 400 |

Lần đầu candidate 100 UID đọc 88 block chưa cache, mất 51,256 ms; bản cũ lúc đó
đã nóng. Không so hai số này như phép đo lạnh tương đương. Bản chỉ bật custom
plan ban đầu vẫn chạm 3.679 block với 100 UID nên candidate cuối thêm lateral
point lookup. Không reset statistics/cache hoặc chạy workload gửi thật.

Đây là số đo query có kiểm soát, chưa phải p95 lưu lượng khách hoặc mức giảm CPU
toàn Supabase. Ứng dụng cũ vẫn dùng query cũ cho đến khi cập nhật.

## Rollout và rollback

1. DB đã apply; **không apply lại** sau merge.
2. Merge code, đóng gói/cập nhật App Zalo Server và Desktop. Chưa đóng gói,
   upload/phát hành hoặc thay tiến trình đang chạy trong task này.
3. Sau khi cập nhật, đo natural traffic của RPC mới và query cũ, timeout,
   CPU/IOPS ở cửa sổ tải tương đương.

Rollback ứng dụng về bản cũ trước. RPC mới có thể giữ lại vì chỉ đọc và không đổi
dữ liệu. Nếu cần xóa, dùng
[`migration_v432_zalo_uid_lookup_rollback.sql`](../migrations/tests/migration_v432_zalo_uid_lookup_rollback.sql)
sau khi không còn caller mới; guard từ chối checksum khác, DROP không CASCADE.
