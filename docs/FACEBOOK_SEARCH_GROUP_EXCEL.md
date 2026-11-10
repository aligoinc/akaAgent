# Xuất Excel nhóm Facebook tìm theo từ khóa

> **Hướng dẫn hiện hành (10/11/2026):** mẫu 6 cột dưới đây đã được mở rộng thành 14 cột (6 cột đầu giữ nguyên), app đọc
> thêm chữ gốc thẻ nhóm trong log chạy lúc xuất. Xem [tải đủ dữ liệu nhóm](FACEBOOK_SEARCH_GROUP_EXPORT_PLAN.md).
> Nội dung bên dưới là lịch sử 02/11.

Ngày 02/11/2026. Thay đổi source Desktop ở tab **Data tìm được**, dành cho
`facebook_find_data_search`. Chưa đóng gói hoặc phát hành bộ cài.

Cập nhật tiếp ngày 02/11/2026: bỏ cột **Loại nhóm AI** theo yêu cầu người dùng;
mẫu hiện tại còn **6 cột**. Xuất Nhóm data/Kết quả chạy được mở rộng riêng theo
[hợp đồng metadata và migration V443](FACEBOOK_GROUP_EXPORT_METADATA.md).

## Hành vi

- Chỉ chọn **Link group Facebook**: xuất một sheet `Sheet1` với đúng thứ tự
  `Tên`, `UID`, `Số thành viên`, `Số bài`, `Đơn vị bài`, `Privacy`.
- Chọn lẫn SĐT/UID/link Zalo/link bài post: nhóm Facebook vào sheet `Group Facebook`
  với 6 cột; các loại đã chọn còn lại vào `Sheet1` theo mẫu 9 cột hiện có.
- Giữ lựa chọn loại data và quy tắc lọc trùng theo loại + giá trị. Với nhóm trùng
  qua nhiều lần/từ khóa, giữ ưu tiên tên như cũ và bổ sung metadata còn thiếu từ
  dòng trùng; không thay số liệu đã có bằng số liệu của dòng sau, kể cả khi dòng
  sau bổ sung tên còn thiếu. Số bài 0 chưa xác minh không chặn số liệu dương từ
  dòng trùng.
- Giữ UID/link dưới dạng chuỗi, số thành viên và số bài dưới dạng số. Thêm bộ lọc
  tiêu đề và độ rộng cột cho sheet nhóm.
- Không thay `DataScanModal`, `ContactLoader` hoặc luồng quét nhóm đã tham gia.
  Mẫu cũ của các loại data khác trong tab Data tìm được giữ nguyên.

## Dữ liệu và giới hạn

Đã đọc workflow live trên **akachat / `cgjbsmqtfhqvttudyjzq`**: workflow 239,
`fb_collect_search_groups` (2723) và `fb_find_search_data_summary` (2724).
Các block hiện trả `url`, `name`, `memberCount`, `postsPerDay`, `privacy`, `keyword`.
Lượt này chỉ đọc DB; không sửa/apply block, workflow, element hoặc RPC.

| Cột | Nguồn |
| --- | --- |
| Tên | `name` |
| UID | URL nhóm trong `url`, giống mẫu akaBizAuto |
| Số thành viên | `memberCount` |
| Số bài | `postsPerDay` hợp lệ và lớn hơn 0; còn lại trống |
| Đơn vị bài | `ngày` khi xuất được số bài; còn lại trống |
| Privacy | `privacy`; đổi `Public`/`Private` thành `Công khai`/`Riêng tư` |

Không suy ra số bài theo tuần/tháng/năm hoặc gọi AI trong lúc xuất. Trường số
vắng/null/rỗng/không hợp lệ để trống, không ép thành 0. Block live trả số bài 0
khi không đọc được hoặc không nhận ra đơn vị (ví dụ bài/tuần), và summary không
giữ bằng chứng để phân biệt với số 0 thật. Vì vậy, `postsPerDay` bằng 0 (kể cả
chuỗi `"0"`) để trống cả số bài lẫn đơn vị; số thành viên 0 vẫn giữ nguyên. Bản
xuất không thay cách thu thập hoặc phục hồi thông tin đã mất từ dữ liệu cũ.

## Source và kiểm chứng

- [CampaignPanel](../src/renderer/src/components/CampaignPanels/CampaignPanel.tsx)
  giữ metadata khi đưa nhóm vào danh sách data tìm được, truyền đúng action và
  những loại data được chọn cho hàm tạo workbook.
- [foundDataExport](../src/renderer/src/components/CampaignPanels/foundDataExport.ts)
  xử lý payload nhóm, lọc trùng và tạo workbook.
- Chạy `node scripts/run-campaign-found-data-export-ui-smoke.cjs`: mở component
  thật trong Electron với IPC fixture và chặn HTTP; click xuất rồi đọc lại bytes
  `.xlsx` bằng thư viện thật. Bao phủ xuất riêng nhóm/xuất hỗn hợp, lựa chọn loại,
  giữ metadata khi bổ sung tên, bổ sung số liệu còn thiếu từ dòng trùng,
  Unicode, chuỗi UID dài, null/rỗng/0/`"0"`, tên bắt đầu `=`, mẫu xuất cũ của
  `facebook_find_data_group` và nút xuất khi không chọn data.
- Chạy hai typecheck và `npm run build` theo AGENTS.md. Smoke dùng fixture,
  không xác nhận khả năng đọc DOM Facebook thật hay bộ cài đã phát hành.

Lịch sử kiểm chứng mẫu 7 cột trước khi bỏ AI: kết quả local sau sửa review ngày 02/11/2026, nhánh
`codex/facebook-group-excel`: smoke Electron/XLSX **PASS**, typecheck node
**PASS**, typecheck web **PASS**, build production **PASS** (exit 0). Build có
cảnh báo static/dynamic import cùng module; không có lỗi build. Chưa phát hành.
