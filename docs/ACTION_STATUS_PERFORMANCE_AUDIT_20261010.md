# Hiệu năng task policy/trạng thái — 10/10/2026

## Kết luận

**Task không thêm pool/nguồn SQL connection, tăng pool limit hoặc thêm polling.**
Đã đối chiếu diff đã merge của akaAgent PR476 (`9c0c5462`), Chat API PR91
(`07ceb4b`) và WebApp PR90 (`c67b674`). Các thay đổi DB V369/V370 sau đó chỉ
hoàn nguyên catalog chọn lọc và sửa hai thông báo; không thêm luồng kết nối.

**Kiểm thử hiệu năng trước đây chưa đủ cho staff nhiều dữ liệu.** Hồ sơ V367 chỉ
ghi một EXPLAIN ANALYZE khoảng 0,8 ms trên campaign mẫu; các smoke còn lại chủ
yếu kiểm chứng nghiệp vụ, quyền và rollback. Không thể dùng chúng để kết luận
toàn bộ query mới nhanh trên dữ liệu lớn.

Lần này đo **65 trường hợp, 167 lượt EXPLAIN ANALYZE**, có **8 trường hợp bị
ngắt ở giới hạn 5 giây**. Có regression xác nhận được ở filter trạng thái của
trang detail. Một số truy vấn tổng hợp/Automation nặng đã có từ trước. Không
sửa runtime, RPC, index, cấu hình, dữ liệu nghiệp vụ hoặc ngân sách connection
trong đợt đo này.

## Pool, polling và tải DB thực tế

- Desktop/packaged Server dùng `getSupabaseClient()` đang có. Mỗi lần bắt đầu
  hoặc phục hồi campaign đọc bốn catalog theo trang 500 dòng; hiện mỗi bảng vừa
  một trang: 40 status, 19 policy, 104 error, 25 action. Bốn request được thực
  hiện bằng `Promise.all`; catalog giữ trong RAM của lượt chạy.
- Chat `CampaignActionResults` nhận instance Kysely hiện có từ repository;
  `begin()` dùng một SQL tổng hợp bốn catalog. Không có `new Pool`, listener,
  timer hoặc polling mới. Module tạo pool và giới hạn pool của worker không
  thay đổi trong diff task.
- Writer và settlement RPC dùng cùng client/pool nghiệp vụ hiện có. Không đọc
  catalog ở client theo từng target, nhưng RPC vẫn xác minh policy, quyền,
  result key và scope trong transaction. Các bước này vẫn có chi phí DB.
- Web/API và báo cáo tái sử dụng client hiện có. Không đổi timer refresh,
  worker/replica hoặc budget connection trong phần triển khai đã ghi nhận.

Không thêm pool **không đồng nghĩa không tăng tải query**. Task bổ sung đọc
catalog đầu lượt, metadata kết quả, guard ghi và điều kiện đọc/report mới.

Nguồn code: `src/main/data/repositories/actionStatusPolicyRepository.ts`,
`src/main/services/actionResultRuntime.ts`; Chat
`packages/database/src/campaignActionResults.ts` và `campaignRuntimeRepository.ts`.

## Mẫu dữ liệu

Chỉ query **akachat / cgjbsmqtfhqvttudyjzq**. Khảo sát 9 staff theo phân bố
campaign/detail; benchmark query trọng điểm trên 6 staff sau. Đây là các mẫu
lớn đã xác minh, không tuyên bố là top tuyệt đối toàn hệ thống.

| Staff | Campaign tổng | Detail tổng | Input tổng | Campaign chưa xóa | Detail thuộc campaign chưa xóa |
| --- | ---: | ---: | ---: | ---: | ---: |
| 385 | 691 | 380.552 | 420.392 | 636 | 380.386 |
| 521 | 8 | 64.616 | 21.941 | 6 | 64.245 |
| 603 | 7 | 53.190 | 69.995 | 7 | 53.190 |
| 659 | 6 | 41.791 | 3.569 | 1 | 38.570 |
| 1190 | 1.424 | 16.738 | 37.440 | 155 | 8.562 |
| 305 | 11 | 42.154 | 2.387 | 6 | 37.599 |

Số tổng gồm campaign xóa mềm; các query ứng dụng vẫn giữ filter của chính chúng.
Không trả về tên khách hàng, nội dung tin hay thông tin đăng nhập trong báo cáo.
Campaign lớn nhất trong mẫu đo trang detail là `11980` của staff 659, có 38.570
detail. Campaign `7370` của staff 385 có 16.488 detail; `10022` của staff 521 có
19.542 detail.

## Phương pháp và giới hạn

- Tái sử dụng linked Management API, một vòng benchmark chạy tuần tự. Transaction
  `READ ONLY`, `statement_timeout=5s`, `lock_timeout=1s`; không dùng lock ghi,
  không chạy writer/callback/settlement thật để tạo dữ liệu thử.
- `EXPLAIN (ANALYZE, BUFFERS, TIMING OFF, FORMAT JSON)`. Thông thường ba mẫu,
  một số đối chiếu body cũ/mới chỉ một mẫu. Dừng lặp ngay khi case timeout.
- RPC đọc trang detail/Automation thực chạy bằng `SET LOCAL ROLE service_role`
  và claim tương ứng, giữ guard tenant trong RPC. Các đối chiếu inner SQL ghi
  rõ trong case; không thay định nghĩa function để thử.
- Không flush cache hay restart DB. “Lần đầu” là lần quan sát đầu trong phiên,
  không phải cold-cache được kiểm soát. Các số warm bên dưới dùng mẫu đọc shared
  buffers, không đọc block mới. Không đủ mẫu để công bố p95/p99.
- Thời gian SQL không gồm HTTP, pool checkout của app, render UI hay toàn bộ
  vòng phân trang báo cáo. Chưa load-test ghi đồng thời nhiều worker, chạy hết
  report nhiều trang hoặc benchmark đầy đủ callback Email/SMS.
- Các query report ban đầu dùng semi-join danh mục action để khảo sát. Bốn case
  `report_literal_*` sau đó dùng danh sách action literal như client, là số
  chính thức bên dưới. Scope là tất cả action bật và account chưa xóa của staff,
  không chọn riêng nền tảng. Khoảng thời gian: 10/09–11/10/2026 theo giờ Việt Nam.

## Kết quả chính

| Nhóm query | Quan sát |
| --- | --- |
| Catalog Desktop | 0,11–0,30 ms mỗi bảng |
| Catalog Chat (JSON gộp) | 4,43–4,52 ms |
| Trang detail không filter, 100 dòng | Khoảng 21–35 ms warm; lần đầu tối đa 115 ms |
| Trang detail sâu offset 30.000, staff 659 | Khoảng 51–54 ms |
| Tìm theo tên trạng thái phụ, staff 659 | Khoảng 727–738 ms |
| Lịch sử gửi 30 ngày theo account | Khoảng 352–415 ms; trả 2.240/2.417 dòng, dùng index legacy và V367 |
| Tra cứu `result_key` | 0,075–0,132 ms; dùng unique partial index |
| Guard target với input ID | Khoảng 0,17–1,57 ms |
| Guard target không có input ID | Khoảng 7–20 ms; còn phải xét detail trong campaign |
| Settlement: kiểm scope các detail ID | Khoảng 0,15–0,18 ms; đây chỉ là SELECT guard, không phải toàn transaction ghi |

Thống kê DB có sẵn (`pg_stat_statements`, reset 28/09/2026, `track=top`):

- Writer: 540 + 344 lần gọi ở hai query shape; trung bình **31,36 / 28,29 ms**,
  tối đa quan sát **165,33 ms**.
- Settlement: 313 + 169 lần gọi; trung bình **3,85 / 3,54 ms**, tối đa **10,27 ms**.

Đây là thống kê statement đã chạy, có thể bao gồm các smoke trước đó; không
phải phép đo tải ghi riêng theo từng staff, không có p95 và không đo thời gian
đợi pool của client.

## Phát hiện cần xử lý

### 1. Regression thuộc task: filter trạng thái detail

Điều kiện mới `status = ... OR EXISTS (...)` tra `auto_status` theo
`status_id/sub_status_id` khiến nhánh count mất đường index-only cũ và lặp
subquery theo detail.

| Phép đo cùng dữ liệu, cache warm | Filter cũ | Filter hiện tại |
| --- | ---: | ---: |
| Đếm “thành công”, staff 385 / campaign 7370 | 6,4 ms | 64 ms |
| Cả inner query trang detail, cùng campaign và payload | 15 ms | 72 ms |
| Đếm “thành công”, staff 659 / campaign 11980 | 18,6 ms | 120 ms |
| Đếm “chờ duyệt bài” không có kết quả, staff 659 | 0,17 ms | 164 ms |

Với campaign 7370, cả count cũ và mới trả 12.996. Plan cũ dùng
`idx_auto_campaign_details_automation_status` bằng index-only (653 block hit);
plan mới đọc heap qua `idx_campaign_details_campaign_id` (15.161 block hit),
3.492 lần tra catalog. Case không có trạng thái phụ ở campaign 11980 vẫn đọc
38.570 detail và gọi subplan 38.570 lần.

Hai RPC filter “thành công” ở staff 385/521 bị ngắt sau 5 giây ở lần quan sát
đầu. Sau khi các block đã được đọc, current inner query staff 385 chạy khoảng
72 ms. Không dùng timeout lần đầu để kết luận mọi lần gọi đều mất trên 5 giây.

**Hướng sửa đã thử bằng SELECT, chưa apply:** resolve tập status ID một lần,
tách count legacy khỏi phần metadata bổ sung, loại trùng bằng điều kiện
`status IS DISTINCT FROM ...`. Giữ index-only cho legacy và tận dụng index
status/substatus hiện có.

| Count prototype | Hiện tại | Prototype |
| --- | ---: | ---: |
| Staff 385, thành công | 64 ms | 9,9 ms |
| Staff 385, trạng thái phụ không có kết quả | 78 ms | 3,9 ms |
| Staff 659, thành công | 120 ms | 25,5 ms |
| Staff 659, trạng thái phụ không có kết quả | 164 ms | 7,7 ms |

Cả bốn phép đối chiếu trong cùng snapshot trả kết quả bằng nhau. Đây mới là
prototype count; trước khi sửa RPC phải giữ phân trang/search/tenant, kiểm tra
trùng chính–phụ và kiểm chứng thêm các campaign có metadata mới. Không cần tăng
pool để thử hướng này. Không có index/RPC nào được sửa trong audit.

### 2. Automation options của staff nhiều dữ liệu: tồn tại trước task

`aka_agent_get_automation_options` với staff 385 vượt 5 giây. Inner query từ
snapshot **trước V362** và inner query live đều vượt cùng giới hạn. Diff cho
thấy task chỉ thêm `result_statuses` từ catalog nhỏ; phần tổng hợp các trạng
thái quan sát từ detail đã có sẵn. Vì vậy không quy toàn bộ điểm chậm này cho
task policy.

Staff 1190 có nhiều campaign nhưng ít detail hơn: lần đầu 2.133 ms, warm khoảng
73–76 ms. Số campaign đơn thuần không đại diện đủ cho tải query này.

Hướng điều tra tiếp theo là phần tổng hợp detail theo staff và khả năng dùng
index/thu hẹp dữ liệu đọc. Chưa tối ưu hoặc đổi hành vi form Automation.

### 3. Báo cáo/CRM: vẫn có query nặng, chưa chứng minh regression đồng loạt

Trang report đầu 1.000 dòng, đúng dạng action-code literal:

| Staff | Filter cũ (warm) | Filter mới (warm) |
| --- | ---: | ---: |
| 385 | 1.256 ms | 525 ms |
| 521 | 547 ms | 176 ms |

Không thấy chậm hơn ở các mẫu warm này. Tuy vậy plan staff 385 vẫn duyệt khoảng
1,37 triệu dòng không khớp trước khi có trang đầu; bản mới có parallel plan.
Không suy ra tổng thời gian tải cả report từ một trang. Case khảo sát dùng
semi-join ở staff 385 từng timeout lần đầu; mẫu literal được ghi riêng để tránh
đánh đồng các query shape.

CRM 5 campaign lớn staff 521 có timeout lần đầu. Đối chiếu inner SQL sau đó:
summary cũ 602 ms / mới 307 ms; trial counts cũ 241 ms / mới 249 ms. Staff 385:
summary cũ 95 ms / mới 117 ms. Các số này chưa đủ để khẳng định CRM có regression
nghiêm trọng do task; cần giữ phân biệt I/O lần đầu và mẫu warm.

## Hồ sơ và trạng thái sau đo

[Thư mục bằng chứng](audits/action-status-performance-20261010/) chứa:

- `live-definitions-and-stats.json`: exact live definitions/checksums/attributes
  trước đo; `after-verification.json` xác minh cả 16 function không đổi.
- `scopes.json`, `large-staff-scopes.json`, `query-parameters.json`: scope và số
  dòng đã xác minh, không dựa vào ước lượng planner để báo số dữ liệu staff.
- `cases.json`, `measurements/*.json`, `summary.json`: SQL, plan, buffers, thời
  gian và timeout từng lần; `prototype-equivalence.json` lưu đối chiếu count.
- `automation-options-diff.patch`: khác biệt với source trước task.
- `writer-production-statistics.json`: thống kê writer/settlement có sẵn.

Không ghi dữ liệu nghiệp vụ, không reset stats/cache/sequence, không tăng
connection, không có migration mới. Lần kiểm tra cuối không có backend đợi
lock; history mới nhất vẫn V370. Runner:
`scripts/action-status-performance-audit.cjs` (read-only, không ghi đè kết quả đo).
