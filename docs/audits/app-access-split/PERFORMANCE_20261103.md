# Kiểm tra hiệu năng sau V447 — 03/11/2026

Lịch sử kiểm tra **06:21–06:28 VN**, trước bản sửa: dịch vụ hoạt động nhưng có
chi phí query cần tối ưu. **V448 và API đã được triển khai sau đó**;
xem [bản sửa và phép đo lại](PERFORMANCE_FIX_20261103.md). Lượt điều tra này chưa
sửa source runtime/RPC, tạo index production, apply migration, deploy hoặc phát
hành. CRM không đổi. Các benchmark SELECT thử nghiệm bên dưới
không phải bản sửa đã triển khai. [Số liệu](performance-receipt-20261103.json).

## Phạm vi và sức khỏe

- Production duy nhất: `cgjbsmqtfhqvttudyjzq`. V447 vẫn true; 55 signature cùng
  checksum/body, owner, ACL, security mode, volatility/config, policy và view
  không đổi so với capture sau activation. Không reset thống kê DB.
- 14 HTTP probes lúc 06:21:43 VN đều đạt: health/home trả 200, các endpoint
  app-access chưa xác thực trả 401. API/worker/runtime machine đang chạy;
  Server runtime giữ 226 tài khoản, realtime connected, lastError null.
- Bốn báo cáo worker 06:18–06:21 cho thấy backlog cuối bằng 0, không có lỗi
  infrastructure/claimLost; vẫn có lỗi normalize đã tồn tại trước deploy.
- Mẫu metrics 06:22:40–06:24:21: CPU thực thi 25,97%, I/O wait 0,64%, RAM dùng
  49,57%, không swap-out. Đây là một cửa sổ ngắn buổi sáng, không phải tải đỉnh.
  Snapshot đầu có 59 backend DB, phần lớn idle; không tăng pool/connection.
- Cửa sổ SQL tự nhiên 06:21:34–06:28:15: 308.432 top-level calls của các role
  ứng dụng, 340,94 giây tổng execution time cộng dồn qua các connection;
  deadlock/conflict/temp-file tăng thêm đều bằng 0. Không diễn giải tổng SQL
  elapsed time thành CPU. Các query diagnostic chạy bằng role quản trị được
  loại khỏi bảng chi phí ứng dụng.
- Edge log tổng hợp 05:10–06:25 không ghi nhận HTTP 5xx. Bucket 06:10–06:20
  có 128.080 request, upstream p95 26 ms/p99 khoảng 43 ms. Đây là HTTP tới
  Supabase, không phải latency end-to-end của Chat Web. Bucket cuối có thể
  thiếu log vì ingestion; không dùng nó làm số đầy đủ của cả 10 phút.

## 1. Ưu tiên cao: kiểm tra held work quét lịch sử chiến dịch nhiều lần

`private.app_access_held('staff', id)` đọc account theo staff rồi kiểm
`account_id = a.id OR secondary_account_id = a.id` trên `auto_campaigns` với
điều kiện đang chạy hoặc còn claim/unit token. Live có index secondary, nhưng
không có index `account_id` phù hợp với điều kiện này; index account hiện có
chỉ dành riêng SMS nên không dùng được.

Plan production sử dụng `auto_accounts_staff_id_idx`, sau đó **Seq Scan toàn
bộ 47.100 campaign cho mỗi account**:

| Mẫu SELECT chỉ đọc | Execution | Shared buffer hits | Campaign scan loops |
| --- | ---: | ---: | ---: |
| Staff có 5 account | 187,5 ms | 38.801 | 5 |
| Staff có 54 account, gồm dòng đã xóa vẫn phải xét cleanup | 1.687,2 ms | 419.038 | 54 |
| Gọi chính helper ở mẫu 54 account | 1.730,9 ms | 421.346 | bên trong function |

`aka_agent_staff_access` gọi helper này cả ở legacy để trả `appAccessStopping`.
Trong mẫu tự nhiên: **538 calls, trung bình 247,97 ms, 39,13% tổng SQL execution
time** của các role ứng dụng được đo. Đây là chi phí toàn RPC, không phải phép
đo tách riêng helper; plan phía trên xác nhận một nguồn tốn chi phí cụ thể.

Đề xuất một index hẹp, giữ index secondary hiện có:

```sql
-- ĐỀ XUẤT, CHƯA APPLY; cần guard catalog và quy trình rollout riêng.
CREATE INDEX CONCURRENTLY idx_auto_campaigns_app_access_held_account
ON public.auto_campaigns (account_id)
WHERE status = 'đang chạy'
   OR runtime_claim_token IS NOT NULL
   OR runtime_unit_token IS NOT NULL;
```

Không thêm điều kiện `is_delete=false`: campaign đã xóa nhưng còn token vẫn
phải được bảo vệ tới khi cleanup xong. Snapshot có 771/47.100 campaign thuộc
predicate, trong đó một dòng có secondary account. Index phát sinh chi phí
ghi khi status/token chuyển trạng thái; cần đo workload ghi trong bước triển
khai, không hứa toàn bộ CPU sẽ giảm theo tỉ lệ benchmark đọc.

Thử riêng bằng PGlite in-memory, dữ liệu giả 47.100 campaign/771 held/54 account:
thêm đúng một index này chuyển 54 Seq Scan sang BitmapOr dùng index mới và
index secondary cũ; buffer hits 363.371 → 109. Các ca giữ bởi primary,
secondary, claim token và unit token đều đúng. Thời gian local 612 → 0,232 ms
**không phải dự báo latency production**. Không tạo index thử trên production.

## 2. Ưu tiên cao: quyền bị tính lại theo từng hội thoại/thông báo

`packages/database/src/chatAccessSql.ts` đưa cùng các helper staff/account
vào nhiều nhánh ACL. Inbox và unread count có thể đánh giá lại chúng cho
hàng nghìn dòng, dù staff và một vài account vẫn như nhau.

Mẫu tự nhiên: inbox 6 calls, trung bình **2.035,86 ms**; unread count 6 calls,
**1.353,42 ms**. Mẫu tenant lớn được chọn riêng có 9.100 notifications và inbox
đi qua 3.738 hội thoại. Đây không phải latency trung bình của tất cả khách hàng.

| SELECT trên cùng tenant lớn | Bản hiện tại | Prototype tính quyền một lần |
| --- | ---: | ---: |
| Trang inbox 24 dòng | 2.540,3 ms | 102,1 ms |
| Tổng thông báo chưa đọc | 6.092,1 ms | 102,2 ms |

Prototype dùng CTE MATERIALIZED giới hạn theo đúng org/binding và staff của
request; giữ các kiểm tra quyền, nhánh thông báo thu hồi quyền, membership,
support/team/department và tenant equality hiện có. So sánh toàn bộ dòng
bằng EXCEPT ALL trong cùng statement đạt ở một org legacy lớn và một org
separate. Org separate này trả inbox rỗng, nên chưa kiểm chứng nội dung hiển
thị cho toàn bộ tổ hợp quyền. Cần đủ bộ authorization/parity tests trước khi
đưa prototype vào source. Số đo là probe đơn, có ảnh hưởng cache; không phải
cam kết mức giảm chính xác cho mọi khách hàng.

**Cần sửa cách tổ chức query; thêm index cho boolean quyền không giải quyết
việc gọi function lặp theo từng dòng.** Không dùng cache TTL cho quyền để giảm
chi phí vì sẽ làm chậm hiệu lực thu hồi quyền.

## 3. Ưu tiên tiếp theo: discovery tổ chức runtime quá rộng

`ChatEntitlementRepository.organizations()` bắt đầu từ tất cả dòng sản phẩm
5/16/18, kể cả gói Agent cũ/hết hạn, rồi gọi helper. Plan có thể đẩy helper
xuống trước DISTINCT. Bảng chỉ 2.033 dòng nhưng mỗi vòng lookup/helper cộng
dồn đáng kể: mẫu tự nhiên 26 calls, **468,10 ms/call**, khoảng 70.232 logical
blocks/call. Assignment snapshot 226 account vẫn khoảng 356,06 ms/call.

Prototype lọc candidate sớm: giữ **mọi** product 5, đồng thời chỉ lấy product
16/18 còn hạn, chưa xóa, is_chat_sync=true ở nhánh legacy. Sau đó vẫn gọi
helper runtime hiện tại, giữ cleanup/Agent khi Chat hết hạn. Probe server
507 → 229 ms; all-runtime 429 → 168 ms; tập kết quả 52/54 org khớp đầy đủ.
Một phần chi phí còn lại có thể liên quan held-work ở mục 1. Đây là prototype
chẩn đoán, chưa sửa source hay deploy.

## Index đang đủ và lỗi đã tồn tại

- Quota account/staff có index owner và organization: `auto_accounts_staff_id_idx`,
  `idx_org_staff_organization_not_deleted`, `idx_org_product_org`. Mỗi org chỉ
  tối đa 10 product rows hiện tại. Probe hai quota Chat cùng statement khoảng
  9 ms. **Chưa cần index riêng cho bốn boolean hoặc thêm index product 5**.
- Bốn index receipt hiện có hợp lệ; chỉ có bốn receipt initialize, không có
  stopping request tại snapshot. Không xóa index QR chỉ vì chưa có lượt dùng.
- Plan danh sách Desktop thật dưới role `aka_agent_desktop` với claims/scoping
  hiện có: 49 account trong 2,12 ms. Advisor có cảnh báo current_setting theo
  dòng của `app_access_desktop_accounts`, nhưng chưa phải điểm nghẽn được đo.
  [Giải thích advisor](https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan).
- Các lỗi `permission denied` vào RPC/bảng cũ tồn tại cả trước deploy, tần suất
  khoảng 48–50 lỗi/phút; phần lớn là caller anon. Không mở lại quyền để che lỗi.
  Một số 401 Desktop chưa được điều tra riêng tới từng phiên.
- `runtime_event_not_json_serializable`: 27 trước deploy, 57 sau deploy trước
  activation và 23 sau activation, trong cửa sổ 05:10–06:28; độ dài ba khoảng
  khác nhau. Có thêm một `invalid_zalo_event_payload` trước activation. Đây
  không phải hệ thống “không có lỗi”; chưa thấy chứng cứ các lỗi normalize
  này do cơ chế quyền riêng gây ra. Không retry gửi để xử lý lỗi normalize.

## Giới hạn và bước tiếp theo

Chưa canary thao tác gửi, chạy chiến dịch, đăng nhập QR hay UI có xác thực;
không kiểm lại app Windows thực tế. Bốn org separate/11 account là mẫu nhỏ;
chưa đủ đảm bảo tải cao hoặc mọi tổ hợp gói/quyền. Hai lỗi P2 đã được người
dùng tạm hoãn không được sửa trong lượt kiểm tra này.

Plan quản trị dùng role production được Management API cho phép, không
SET ROLE được `aka_agent_chat_api`; timing role thật lấy từ pg_stat_statements.
`pg_stat_statements.track=top`, `track_functions=none`, không thay cấu hình.
Các câu có chữ app_access chiếm 26,81% SQL execution time, **không phải phần
overhead riêng của helper**, và chưa bao gồm lời gọi gián tiếp trong staff_access,
RLS/trigger. Không so cumulative counters từ tháng 9 thành trước/sau deploy.

Ưu tiên triển khai tiếp: index held-work → gom kiểm quyền trong inbox/count →
lọc discovery sớm. Giữ quyền/receipt/cleanup, dùng regression và rollback an
toàn phù hợp; không cần tăng pool hay replica để che các query này.

Full live definitions/metadata, query text/plan có ID tenant, claims kiểm thử và
log chi tiết nằm ngoài Git tại
`~/.codex/incident-recovery/akaAgent-ip-block/app-access-20261103/performance-20261102T2321Z/`.
Public receipt chỉ lưu metrics, query IDs, nhãn probe và kết quả đã giảm dữ liệu.
