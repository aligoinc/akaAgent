# Đo hiệu năng sắp xếp data — 23/09/2026

Đã chạy **118 phép đo EXPLAIN ANALYZE** trên **12 chiến dịch / 12 tổ chức** ở linked production `akachat` (`cgjbsmqtfhqvttudyjzq`). Kết luận: Data ban đầu đáp ứng tốt ở các mẫu hiện có; điểm cần ưu tiên tối ưu nằm ở query Kết quả chạy khi dữ liệu chưa có trong cache và khi đi trang sâu.

## Phạm vi và cách đo

- 8 chiến dịch input thuộc 8 tổ chức: 6 mẫu 8.177–11.732 input trực tiếp, 2 mẫu Nhóm data 2.478–2.684 input. Có Facebook, Zalo Desktop và Zalo Server.
- 4 chiến dịch lịch sử thuộc 4 tổ chức khác: 10.956–25.721 kết quả tại thời điểm chọn mẫu. Số dòng tăng nhẹ trong lúc chạy do nghiệp vụ đang hoạt động.
- Chọn các campaign lớn từ `pg_stats.most_common_vals` rồi đếm chính xác theo campaign; chỉ lấy campaign/account chưa xóa và staff active. Đây là mẫu chiến dịch lớn đủ điều kiện, không phải chứng minh thứ hạng lớn nhất tuyệt đối toàn DB.
- Thống kê toàn bảng lúc bắt đầu: khoảng 4.228.166 input, 2.483.185 kết quả, 487.970 nguồn input; PostgreSQL 17.6, `work_mem=16MB`.
- Chạy tuần tự qua `supabase db query --linked` (Management API hiện có), `BEGIN READ ONLY`, statement timeout 10 giây, lock timeout 1 giây, kết thúc ROLLBACK. Không mở SQL pool/nguồn connection mới; không đổi schema, data, function, index hoặc cấu hình toàn hệ thống.
- Input: gọi đúng credential wrapper đang chạy, lấy username/password ở bên trong SQL từ staff sở hữu campaign; không xuất/lưu credential. JWT role đặt anon để kiểm tra credential thực sự. SQL caller là role quản trị để đọc credential nội bộ; wrapper/core vẫn chạy SECURITY DEFINER như đường ứng dụng.
- Kết quả chạy: đo SQL tương đương phần chọn trang `SELECT *`, exact count và JSON aggregation của PostgREST, với cùng predicate/order/offset/limit. Đây không phải capture nguyên văn SQL do PostgREST sinh ra. Chưa bao gồm bước kiểm tra campaign, enrichment input/automation trong main, HTTP và render UI.
- Số ms dưới đây là `Execution Time` của DB. Thời gian Management API/CLI khoảng 1,4–3 giây cho nhiều phép đo không đại diện latency Electron nên không dùng để đánh giá query.
- Không xóa cache hoặc ép restart. “Lượt đầu” là trạng thái cache tự nhiên, được xác nhận bằng `shared read blocks`; “đo lại” chạy đúng cùng query sau đó. Không dùng chênh lệch lượt DESC đầu với ASC sau để kết luận chiều nào nhanh hơn. Đây không phải load test đồng thời hoặc p95 sản xuất.

## Data ban đầu

Các giá trị trong bảng là trung vị của bốn sort ở trang đầu và từng phép đo còn lại. Cột 500 ID ghi lượt đầu; có bảng đo lại bên dưới. Đơn vị ms.

| Tổ chức | Chiến dịch | Nguồn | Input | Trang đầu, median 4 sort | Trang cuối | 1 ID | 500 ID |
|---:|---:|---|---:|---:|---:|---:|---:|
| 1 | 8001 | direct | 10,000 | 58.5 | 81.7 | 26.8 | 192.1 |
| 834 | 15511 | direct | 9,848 | 67.8 | 112.1 | 29.0 | 108.1 |
| 105 | 1906 | direct | 11,732 | 178.7 | 56.3 | 56.0 | 130.9 |
| 582 | 12050 | direct | 9,999 | 62.1 | 67.5 | 564.2 | 351.5 |
| 662 | 11987 | direct | 9,999 | 60.9 | 191.6 | 24.7 | 120.3 |
| 240 | 4497 | direct | 8,177 | 89.1 | 602.3 | 24.5 | 148.3 |
| 565 | 10017 | data_group | 2,684 | 139.6 | 63.7 | 26.3 | 992.8 |
| 451 | 12567 | data_group | 2,478 | 62.0 | 52.0 | 28.6 | 805.7 |

- Trung vị trang đầu theo từng chế độ trên 8 mẫu: tạo mới 69,7 ms, tạo cũ 73,4 ms, xử lý mới 61,8 ms, xử lý cũ 60,3 ms. Không có temp spill trong các phép đo RPC input.
- Query trang dùng index `idx_campaign_input_data_campaign_id`, đọc số input thuộc campaign (ví dụ 11.732 dòng), rồi `WindowAgg count(*)` và top-N sort. Không thấy scan toàn bộ 4,23 triệu input. Tuy nhiên chi phí vẫn tăng theo toàn bộ input của campaign, không chỉ 100 dòng trả về.
- Với 1 ID, inner plan dùng `auto_campaign_input_data_pkey`, lấy đúng 1 dòng với 4 buffer accesses. Với 500 ID ở campaign 10017, chỉ 500 input vào CTE/window; phần truy vấn input dùng 55 buffer accesses. Như vậy bản sửa không còn quét các trang không được chọn.
- Trong 500 ID của campaign 10017, phần provenance chạy khoảng 500 lượt join/aggregate, khoảng 25.964 buffer accesses so với 55 ở phần input. Phần này cần chú ý khi xuất nhiều data từ nhóm.
- Có vài spike ngay cả khi toàn bộ buffer đã cache; chỉ có 1–3 lần đo mỗi trường hợp nên chưa xác định nguyên nhân tải hệ thống. Không coi một spike là chi phí cố định của sort.

### Đo lại các lượt input chậm

| Campaign / trường hợp | Lượt đầu (ms) | Đo lại 1 (ms) | Đo lại 2 (ms) |
|---|---:|---:|---:|
| 1906 / created_asc | 788.4 | 60.0 | 57.6 |
| 12050 / selected_1 | 564.2 | 24.2 | 25.6 |
| 4497 / processed_last_page | 602.3 | 77.8 | 59.9 |
| 10017 / selected_500 | 992.8 | 218.5 | 217.6 |
| 12567 / selected_500 | 805.7 | 273.9 | 177.9 |

Tìm kiếm không có kết quả trên 8 mẫu mất 33,9–318,0 ms. Lọc nguồn Nhóm data tại campaign 10017 mất 110,3 ms. Lọc nguồn automation (không có kết quả) tại cùng campaign mất 965,8 ms lúc phải đọc thêm 1.508 blocks, sau cache còn 372,5 ms với 31.907 buffer accesses: đây là một nhánh tương đối đắt do các EXISTS/joins nguồn, dù không trả dòng nào.

### So với RPC cũ, cùng chiều tạo cũ và cache đã ấm

| Campaign | RPC cũ, hai lượt (ms) | RPC v2, hai lượt (ms) |
|---:|---|---|
| 1906 | 71.7; 55.8 | 63.1; 58.5 |
| 10017 | 82.0; 76.1 | 106.4; 141.5 |

Ở mẫu trực tiếp, hai RPC gần nhau. Mẫu Nhóm data có v2 chậm hơn khoảng 24–65 ms trong hai lượt ghép này, buffer gần như tương đương; cần nhiều mẫu ổn định hơn để tách CPU/planning/biến động production. Không khẳng định v2 hoàn toàn không thêm chi phí.

## Kết quả chạy: điểm cần ưu tiên

Cùng query lấy 100 dòng đầu, exact count và JSON; cache ấm đo lại đúng chiều DESC.

| Tổ chức | Campaign | Kết quả lúc chọn mẫu | Lượt đầu (ms) | Đo lại (ms) | Block phải đọc lần đầu | MiB chưa có trong shared buffers |
|---:|---:|---:|---:|---:|---:|---:|
| 636 | 11980 | 25,721 | 8120.3 | 107.2 | 14,301 | 111.7 |
| 500 | 10022 | 12,358 | 5295.8 | 64.4 | 7,970 | 62.3 |
| 473 | 8346 | 10,956 | 4126.1 | 66.2 | 6,825 | 53.3 |
| 365 | 7370 | 11,784 | 4747.3 | 84.2 | 7,775 | 60.7 |

- Plan dùng `idx_campaign_details_campaign_id` để đọc toàn bộ row của campaign, sau đó top-N sort để lấy 100 row. Campaign 11980 thực tế đọc 25.728 row ở lượt đo, phải nạp 14.301 blocks (~111,7 MiB) vào shared buffers. Exact count có Index Only Scan riêng; phần đọc payload trước sort là nguồn block reads lớn nhất trong plan.
- Index đang có `(campaign_id,status,action_code,created_at DESC)` không cung cấp trực tiếp thứ tự `(created_at,id)` khi không lọc status/action_code. Chưa có index khớp toàn bộ predicate/order của UI.
- Trang sâu dùng external merge sort: campaign 11980 sort 38.552 KiB (~37,6 MiB), ghi 4.822 temp blocks; campaign 10022 và 7370 cũng spill. Thời gian các trang sâu khi cache ấm: 102,7–398,6 ms.
- Tìm kiếm không có kết quả trên lịch sử: 226,8–549,9 ms; các phép ILIKE trên log/nội dung phải xét nhiều row.

## Đề xuất theo mức ưu tiên

1. Ưu tiên Kết quả chạy: thử và đo index khớp campaign + thời gian tạo + ID trên row chưa xóa; kiểm tra cả hai chiều và NULLS LAST. Đồng thời cân nhắc lấy ID/phần hẹp trước, rồi mới đọc payload của trang. Chưa tạo index hoặc sửa query trong lượt đánh giá này.
2. Với input hiện có khoảng 10.000 dòng/campaign, giữ cách lấy selected IDs theo batch; chưa có bằng chứng cần tăng connection hoặc work_mem. Với xuất data nhóm, có thể đánh giá giảm các trường/joins provenance không cần cho file xuất.
3. Lọc nguồn automation trên Nhóm data là nhánh cần đo/tối ưu tiếp nếu được dùng thường xuyên; mẫu hiện tại mất khoảng 0,37 giây ngay cả sau cache.
4. Khi chiến dịch input lớn hơn nhiều, count/window + OFFSET vẫn đọc toàn campaign mỗi trang. Các phép đo này chưa xác nhận khả năng phục vụ campaign 100.000+ input hay nhiều client đồng thời.

## Kiểm soát thay đổi và bằng chứng

Không thay production data/schema/RPC/config. Định nghĩa live được chụp bằng `pg_get_functiondef`; owner, ACL, SECURITY DEFINER, volatility, search_path/timeout và routing Desktop/Server giữ nguyên. Các chữ ký/checksum nằm trong [audit v313](CAMPAIGN_DATA_SORT_V313_AUDIT.md) và [audit v314](CAMPAIGN_INPUT_SELECTION_V314_AUDIT.md), đồng thời được lưu trong JSON đo đạc.

118 phép EXPLAIN thành công, không chạm timeout 10 giây. Tổng `Execution Time` cộng dồn khoảng 39.5 giây, chạy tuần tự. Các query khám phá metadata/count nằm ngoài tổng 118 lượt.

[Dữ liệu đo và các node execution plan](CAMPAIGN_DATA_SORT_PERFORMANCE_20260923.json) chỉ chứa số liệu/ID và metadata; không chứa nội dung data, credential hay tên khách hàng. Query SQL và raw plans được giữ ở `/tmp/campaign-sort-perf-run/` trong phiên làm việc này.
