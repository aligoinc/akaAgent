# Kết quả đo sau tối ưu Kết quả chạy — 23/09/2026

Đã apply v315 (index) và v316 (RPC) lên `cgjbsmqtfhqvttudyjzq`. Kết quả chính: page IDs dùng index-only scan; chỉ lookup nội dung của trang qua PK; các trang sâu được đo không còn sort payload/tràn temp. Không thêm cột hoặc connection/pool.

## Phạm vi và giới hạn

- 4 campaign thuộc 4 tổ chức, khoảng 10.956–25.700+ kết quả/campaign; lịch sử vẫn tăng trong lúc đo. Đây là các mẫu lớn đã dùng trong benchmark trước, không phải chứng minh chiến dịch lớn nhất DB.
- Lưu 66 EXPLAIN plans: 19 query cũ trước index; 19 inner SQL mới sau index; 16 gọi RPC live có identity/ownership guard; 12 lượt ghép query cũ/mới sau index. Chạy tuần tự bằng linked Management API trong transaction read-only, statement timeout 10 giây.
- Thời gian là DB Execution Time, không gồm network, rendering hoặc enrichment input/automation trong main. SQL tương đương PostgREST dùng làm đối chứng, không phải capture SQL từ PostgREST.
- Không xóa cache hoặc restart DB. Xây index đọc bảng và thay đổi cache; không lấy tỉ số lượt đầu cũ / lượt mới cache ấm để tuyên bố tốc độ tăng bao nhiêu lần. Nhiều spike xảy ra ngay cả khi không đọc disk; không đủ mẫu để kết luận p95 hoặc nguyên nhân tải production.
- Gọi RPC live lấy credential từ org_staff bên trong SQL, không xuất/lưu credential. SQL caller quản trị để đọc credential, request JWT role anon để guard kiểm tra thật; smoke riêng dùng SET LOCAL ROLE anon/authenticated/service_role.

## RPC thật sau apply

16 lượt trên bốn campaign, mỗi campaign gồm trang đầu/cuối ở hai chiều. **Trung vị 22,42 ms**, khoảng **15,43–245,36 ms**; 14/16 lượt ≤49,11 ms. Không temp spill. Các lượt này đã cache ấm.

| Tổ chức | Campaign | Đầu DESC | Đầu ASC | Sâu DESC | Sâu ASC |
|---:|---:|---:|---:|---:|---:|
| 636 | 11980 | 24.07 | 47.03 | 32.97 | 49.10 |
| 500 | 10022 | 245.36 | 45.09 | 169.36 | 20.09 |
| 473 | 8346 | 45.18 | 16.34 | 19.07 | 20.63 |
| 365 | 7370 | 15.43 | 20.77 | 15.58 | 15.76 |

Đơn vị ms. OFFSET trang sâu được cố định theo số lượng lúc benchmark trước; dữ liệu live thêm mới nên số dòng cuối trang có thể tăng.

## Bằng chứng giảm lượng đọc

- Campaign 11980: query cũ trước index đọc full row của khoảng 25.700 kết quả, tổng 21.003 shared buffer accesses cho trang đầu. Query mới khi đo lại dùng 2.094 accesses; page IDs chỉ lấy 100 keys, payload PK lookup 100 lần.
- Trang sâu DESC: trước index sort payload ghi 4.828 temp blocks (~37,7 MiB). Query mới không còn Sort payload/không temp blocks; index đi qua khóa trước trang rồi lookup payload của trang cuối.
- So sánh sau khi đã có index, ASC trang sâu query cũ vẫn chạm 27.005 buffers vì đọc payload trên đường OFFSET; ID-first còn 3.447 buffers. Thời gian hai lượt ghép: 208,67 →28,65 ms. Đây là minh chứng cho bước 2 ngoài lợi ích của riêng index.
- Index-only scan không đồng nghĩa zero heap access: count campaign 11980 vẫn đọc khoảng 25.700 keys và cần khoảng 1.400 heap fetches cho các page chưa all-visible. Giữ tổng chính xác nên chi phí count vẫn tăng theo số kết quả.
- Index mới ~99,6 MiB, thêm chi phí bảo trì khi ghi; không INCLUDE payload/log.

## Thời gian trước/sau và các spike

| Campaign | Query cũ DESC lượt đầu trước index | Inner SQL mới DESC lượt đầu sau index | RPC mới DESC khi cache ấm |
|---:|---:|---:|---:|
| 11980 | 9026.18 | 613.54 | 24.07 |
| 10022 | 6411.40 | 28.40 | 245.36 |
| 8346 | 4908.37 | 23.80 | 45.18 |
| 7370 | 5283.72 | 33.17 | 15.43 |

Các cột **không có trạng thái cache giống nhau**. Trước index lượt đầu phải đọc 7.800–16.054 blocks chưa có trong shared buffers; sau index trang đầu đọc 16–21 blocks. Campaign 11980 có spike sau index 613,54/314,90/291,64 ms dù ít hoặc không shared reads; đo RPC sau đó còn 24–49 ms. Campaign 10022 có hai spike RPC 169/245 ms. Không loại các spike khỏi JSON hoặc hứa độ trễ cố định.

## Tìm kiếm và bộ lọc

- Status và date giữ đúng predicate trước phân trang; có thể giảm đáng kể lượng đọc khi plan dùng index phù hợp. Mẫu status thành công campaign 11980 còn khoảng 2.328 buffers thay cho ~20.997 của query cũ trong lượt ghép.
- Tìm kiếm log/nội dung không có kết quả vẫn đọc và kiểm tra gần toàn campaign cho cả count lẫn page: query cũ/mới cùng khoảng 38.343 buffer accesses. Lượt đo mới có 1,42–2,56 giây, so với 0,54–1,44 giây của các lượt cũ; plan hai bên cùng hai scan/predicate ILIKE. Một phép đo lại riêng sau đó cho query mới 439,84 ms. Chưa chứng minh cải thiện đường search hoặc loại trừ hoàn toàn khác biệt latency dưới tải; không thêm index tìm kiếm hay đổi nghĩa lọc trong v315–316.
- OFFSET sâu vẫn tuyến tính theo số khóa bỏ qua. Task này giữ giao diện số trang và tổng chính xác; không chuyển sang cursor pagination.

## Kiểm chứng đúng dữ liệu

24 đối chiếu full JSON payload + total với query cũ trên cả 4 campaign, hai chiều và OFFSET 0/5.000/30.000: tất cả PASS trong cùng snapshot. SQL fixture rollback kiểm tra thêm tie/microseconds, search/status/date, soft-delete, empty pages, input không hợp lệ, credential/tenant và real SQL roles.

[Audit migration, checksum, ACL, rollback và kiểm thử](CAMPAIGN_DETAILS_PAGE_V315_V316_AUDIT.md). [Số liệu và execution plans](CAMPAIGN_DETAILS_PAGE_PERFORMANCE_20260923.json). [Benchmark ban đầu](CAMPAIGN_DATA_SORT_PERFORMANCE_20260923.md).
