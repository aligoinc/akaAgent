# Tối ưu lọc/đếm trạng thái detail — v372

Đã áp dụng trên **akachat / `cgjbsmqtfhqvttudyjzq`** lúc **01:51:56 ngày
10/10/2026 (UTC+7)**. History:
`20261009185156 / migration_v372_detail_status_query`.

Chỉ thay phần dựng query của hai RPC đọc trang detail. App đang phát hành dùng
được ngay, không cần build/deploy lại. Phần cache catalog 60 giây là thay đổi
code riêng, không được phát hành bởi migration này.

## Thay đổi

- Tìm tập ID trạng thái một lần mỗi lần gọi RPC, thay vì truy vấn tương quan
  `auto_status` theo từng detail. Áp dụng cả bộ lọc trạng thái và phần tìm kiếm
  tên/giá trị trạng thái.
- Bộ lọc trạng thái tách thành hai nhánh: text cũ khớp trực tiếp, và metadata
  chính/phụ khớp nhưng text chưa khớp. Hai nhánh không giao nhau; một detail
  khớp đồng thời text, chính và phụ vẫn chỉ được tính một lần.
- Đếm hai nhánh riêng để dùng index text hiện có. Khi lấy trang, mỗi nhánh lấy
  tối đa `offset + limit` ID theo cùng thứ tự, sau đó hợp nhất bằng `UNION ALL`,
  sắp xếp và phân trang chung. Chỉ truy xuất payload đầy đủ cho trang cuối cùng.
  Tổng offset/limit dùng bigint để không tràn integer.
- Giữ nguyên cách so khớp hoa/thường, trim/giới hạn đầu vào, trạng thái catalog
  đã tắt/xóa mềm được lịch sử tham chiếu, ngày bao gồm hai đầu, search wildcard,
  engagement, sort, giới hạn trang, payload và quyền truy cập.
- Giữ `STABLE`: catalog, count, page và payload cùng snapshot của câu gọi.

Không thay bảng/cột/index, RLS/grant, pool/connection, runtime xử lý policy,
note/log hay dữ liệu lịch sử. Không thêm lệnh `NOTIFY` reload schema. Event
trigger DDL sẵn có có thể thông báo PostgREST khi thay body; API đã được kiểm
tra sau apply. Chữ ký, kiểu trả về, owner, ACL và cấu hình hàm giữ nguyên.

## Nguồn live và checksum

Đọc live trong chính lượt sửa này, lưu toàn bộ định nghĩa và thuộc tính vào
[`before.json`](../migrations/snapshots/detail-status-query-v372/before.json),
đọc lại và kiểm chứng SHA-256/MD5 trước khi ghi. Cả hai body live khớp bản mới
nhất trong repo là v367; không có patch riêng trên DB bị ghi đè. V371 của task
khác đã có trên live, nên đợt này dùng v372.

Các chữ ký chính xác:

```text
public.aka_agent_list_campaign_details_page(bigint,bigint,bigint,text,text,timestamp with time zone,timestamp with time zone,integer,integer,text,text,text)
public.aka_agent_list_campaign_details_page_v2(bigint,bigint,bigint,text,text,timestamp with time zone,timestamp with time zone,integer,integer,text,text,text,text)
```

| Hàm | MD5 trước | MD5 sau |
|---|---|---|
| `aka_agent_list_campaign_details_page` | `fb398b4e0fb53a5ebef8269805d51a8e` | `0b63820ca957726725ed2372d46a5d02` |
| `aka_agent_list_campaign_details_page_v2` | `0cab9241430282691f320221acf2ed5d` | `10fc44b5eb273974bb44aa3aaf757630` |

Giữ các patch live v362/v367 về metadata hiển thị, tìm/lọc trạng thái chính và
phụ; giữ toàn bộ engagement v339 trong v2. Identity helper và kiểm tra campaign
thuộc staff/org không đổi. Owner, security definer, volatility, search_path,
statement_timeout và ACL được kiểm tra cùng checksum trước/sau.

## Kiểm chứng

- **391 ca PGlite** so sánh toàn bộ kết quả/lỗi cũ–mới, thêm 10 kiểm tra có đáp
  án định trước cho trùng text/chính/phụ, text NULL, catalog trùng tên, đã tắt,
  xóa mềm, text legacy và mã không có kết quả. Bao gồm hai chiều sort, các
  offset/limit đến `2147483647`, trang rỗng, ngày, search, engagement và input lỗi.
- **40 ca trên live**, cả hai RPC, trước và sau apply. Mỗi rehearsal dùng
  `REPEATABLE READ`, role SQL thật `service_role`, so sánh MD5 của toàn bộ JSON
  trong cùng snapshot; tất cả khớp. Không lưu payload cá nhân vào artifacts.
  Kiểm tra sai staff/campaign, sort và khoảng ngày vẫn trả đúng lỗi cũ.
- Đã chạy SQL rollback phục hồi body gốc và xác minh checksum trong transaction
  rehearsal, sau đó `ROLLBACK`; cuối rehearsal live vẫn giữ đúng bản cần giữ.
- API sau apply nhận đúng hai chữ ký, vẫn chặn thiếu credential bằng
  `automation_auth_required`; quan hệ main/sub status trả HTTP 200.
  Gọi thành công với dữ liệu thật được kiểm tra qua SQL service_role; chưa chạy
  phiên UI Desktop có đăng nhập hay benchmark tải đồng thời.
- Không gửi tin/kết bạn/chạy chiến dịch thật, không sửa row production để làm
  fixture. Không thêm connection/pool và không xóa cache DB để đo.

Các phép đo là thời gian thực thi **toàn RPC tại DB**, ba mẫu warm tuần tự,
không phải độ trễ UI/HTTP hay p95. Bảng dưới là trung vị rehearsal sau apply:

| Staff / campaign | Detail | Bộ lọc v2 | Trước (ms) | Sau (ms) |
|---|---:|---|---:|---:|
| 385 / 7370 | 16.488 | Thành công | 36,53 | 15,23 |
| 521 / 10022 | 19.542 | Thành công | 39,10 | 15,91 |
| 659 / 11980 | 38.570 | Thành công | 57,71 | 30,13 |
| 385 / 7370 | 16.488 | Trạng thái phụ không có kết quả | 78,08 | 6,07 |
| 521 / 10022 | 19.542 | Trạng thái phụ không có kết quả | 93,95 | 6,35 |
| 659 / 11980 | 38.570 | Trạng thái phụ không có kết quả | 172,86 | 10,72 |

Đã kiểm tra thêm campaign dùng policy mới 25449/staff 1123, deep offset 30.000,
offset vượt tổng và không lọc trạng thái. Đây là các scope cụ thể đã khảo sát,
không khẳng định là staff lớn nhất toàn hệ thống.

Giới hạn: search nhiều cột bằng `%ILIKE%` vẫn cần đọc text rộng; v372 không tạo
index full-text/trigram. Ca vừa lọc Thành công + search `zalo` + ngày của v1
tăng khoảng **45,94 → 51,45 ms** do hai nhánh đọc thêm; v2 cùng ca với engagement
giảm **134,46 → 127,30 ms**. Không khẳng định mọi tổ hợp filter đều nhanh hơn.
Search phụ toàn campaign 659 vẫn khoảng nửa giây, là phần chi phí text scan
còn lại, tách biệt với bộ lọc trạng thái đã tối ưu.

Một truy vấn khảo sát tổng hợp tất cả campaign có metadata bị giới hạn 8 giây
và tự hủy; đã chuyển sang đọc theo PK một mẫu quản lý sẵn biết. Không tăng
timeout/pool hay lặp lại quét toàn bảng đó.

## Artifacts và rollback

- [Migration](../migrations/migration_v372_detail_status_query.sql).
- [Snapshot, manifest, rehearsal và API](../migrations/snapshots/detail-status-query-v372/).
- [Rollback SQL](../migrations/snapshots/detail-status-query-v372/rollback.sql).
- [Builder/checksum](../scripts/detail-status-query-v372.cjs),
  [local smoke](../scripts/detail-status-query-v372-smoke.cjs),
  [live runner](../scripts/detail-status-query-v372-live.cjs),
  [API probe](../scripts/detail-status-query-v372-api.cjs).

Rollback chỉ khôi phục hai body RPC sau khi checksum và toàn bộ thuộc tính vẫn
đúng bản v372. Có patch khác thì dừng đối chiếu. Không chạm schema, data,
sequence, history migration hay các sửa cache đang chờ phát hành. Giữ toàn bộ
snapshot và ghi receipt riêng nếu thực hiện rollback thật. Lần này chỉ thử
rollback trong transaction, bản live cuối cùng là v372.

`count-only-prototype/` lưu thử nghiệm đầu tiên, **không apply**, để đối chiếu
với bản cuối tối ưu cả count và page. Không chạy SQL prototype đó để rollout.
