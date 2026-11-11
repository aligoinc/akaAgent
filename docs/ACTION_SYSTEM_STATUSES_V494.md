# Trạng thái hệ thống và danh sách trạng thái theo hành động — V494

**Trạng thái: CHƯA apply production.** Migration, rollback và bộ kiểm thử đã có trong repo; chưa có code ứng dụng nào đọc
phần mới. DDL làm PostgREST nạp lại schema nên phải apply ngoài giờ cao điểm.

Người dùng chốt ngày 11/11/2026 sau đợt rà soát log Zalo: mỗi trạng thái kết quả của hành động phải gắn với đúng một
trạng thái hệ thống, danh sách trạng thái của Zalo phải đủ, và mỗi hành động phải có danh sách trạng thái khai báo trước.

## Vì sao cần

Rà log khoảng 43 giờ (09–11/11/2026, 458 nghìn dòng kết quả Zalo) và 120 nghìn dòng `auto_zalo_api_error_logs`:

- Zalo chưa từng ghi `lỗi`. Lỗi mạng, HTTP 500/502, quá thời gian gửi media (khoảng 900 dòng) đều ghi `thất bại`.
- Khi Zalo khóa hành động (mã 120, 802, 223, 224, 600, 312/221, 269) thì không ghi dòng kết quả nào: 751 lần trong 2,5
  ngày, 289 cặp tài khoản–hành động đang bị khóa chỉ thấy ở `auto_account_action_status`.
- `thất bại` gộp ba loại khác nhau: người nhận chặn hoặc không nhận (khoảng 33.000 dòng, mã 122/119/126/215/251), tài
  khoản bị Zalo hạn chế (khoảng 2.500 dòng, mã 127/314/221) và nội dung, tham số sai (khoảng 1.900 dòng, mã 114/112).
- Nhóm hệ thống trước V494 là cột `report_group` của bảng policy, chỉ có 4 giá trị và gắn theo cặp (hành động, trạng
  thái); 11/22 trạng thái không có nhóm nào.
- Không bảng nào trả lời "hành động này có những trạng thái nào": bảng policy chỉ có mặc định và ngoại lệ, còn
  `auto_campaign_action_detail_statuses` tự thêm dòng khi một trạng thái xuất hiện lần đầu.

## V494 thêm gì

[Migration](../migrations/migration_v494_action_system_statuses.sql) chỉ thêm đối tượng mới, không đổi hành vi bộ chạy.

### 1. Trạng thái hệ thống

Bảng `auto_system_statuses` và cột `auto_status.system_status_code` (khóa ngoại). Ràng buộc
`auto_status_detail_system_status_check` buộc mọi trạng thái `campaign_detail` phải có trạng thái hệ thống; trạng thái của
tài khoản, chiến dịch, input để trống.

| Mã | Tên | Quy về `report_group` | Trạng thái cơ bản đang gắn |
|---|---|---|---|
| `success` | Thành công | success | thành công, đã click, đã đổi tên, đã gắn tag, đã gửi, đã gửi lời mời kết bạn, đã gửi tin nhắn, đã nhận, đã xem, đã duyệt bài |
| `failure` | Thất bại | failure | thất bại, không tồn tại, tag không tồn tại, tham số không hợp lệ, *người nhận chặn tin* |
| `skipped` | Bỏ qua | skipped | bỏ qua, đã gửi lời mời, đã là bạn bè, đã là thành viên, đã tham gia |
| `stopped` | Dừng | pending | *tài khoản bị hạn chế*, *đạt giới hạn*, *hết phiên đăng nhập* |
| `error` | Lỗi | failure | lỗi, *lỗi kết nối*, *chưa rõ kết quả* |
| `pending` | Chờ | pending | đang gọi, chờ duyệt bài |

Chữ nghiêng là 6 trạng thái mới ở mục 2. Cột `report_group` của bảng này cho biết trạng thái hệ thống quy về nhóm nào
trong 4 nhóm cũ. `report_group` của `auto_account_action_status_policies` giữ nguyên 4 giá trị: lớp `ActionStatusCatalog`
trên app đã cài từ chối cả danh mục khi gặp giá trị lạ, nên không thêm `stopped`/`error` vào đó.

### 2. Sáu trạng thái cơ bản mới của Zalo, chưa bật

| Giá trị | Trạng thái hệ thống | Mã Zalo | Hiện đang ghi |
|---|---|---|---|
| người nhận chặn tin | Thất bại | 122, 119, 126, 215, 251 | thất bại |
| tài khoản bị hạn chế | Dừng | 120, 802, 123, 127 | thất bại hoặc không ghi |
| đạt giới hạn | Dừng | 221, 312, 313, 304, 314, 223, 224 | thất bại hoặc không ghi |
| hết phiên đăng nhập | Dừng | 600 | không ghi |
| lỗi kết nối | Lỗi | ECONNRESET, ETIMEDOUT, ENOTFOUND, HTTP 500/502 | thất bại |
| chưa rõ kết quả | Lỗi | quá thời gian gửi media | thất bại |

Cả sáu có `is_active=false`, `flatform_type='zalo'`, không có policy và không `auto_error` nào trỏ tới. Bộ chạy không ghi
được chúng: `ActionStatusCatalog.status()` ném `status_unavailable` với trạng thái chưa bật (bộ kiểm thử xác nhận).

### 3. Hành động – trạng thái

Bảng `auto_account_action_result_statuses(action_code, status_id, is_active, sort_order, note)`, duy nhất theo cặp.
`is_active=true` nghĩa là bộ chạy đang ghi trạng thái đó cho hành động; `false` là đã khai báo, chưa bật. Trigger guard
chỉ nhận trạng thái `campaign_detail` và không cho bật cặp khi trạng thái chưa bật.

Tên dễ nhầm: `auto_account_action_status` là khóa hành động theo từng tài khoản; `auto_account_action_status_policies` là
cách đếm; bảng mới là danh sách khai báo.

Đã khai báo cho 10 hành động Zalo (28 cặp đang ghi, 26 cặp chưa bật). `zalo_join_group` không có dòng nào vì không có
kết quả trong log và code Desktop chỉ còn nhắc tới nó trong một danh sách báo cáo.

| Hành động | Đang ghi | Đã khai báo, chưa bật |
|---|---|---|
| Tìm SĐT | thành công, không tồn tại, thất bại | đạt giới hạn, hết phiên đăng nhập, lỗi kết nối |
| Nhắn người lạ | thành công, thất bại | người nhận chặn tin, tài khoản bị hạn chế, hết phiên đăng nhập, lỗi kết nối, chưa rõ kết quả |
| Nhắn bạn bè | thành công, thất bại | người nhận chặn tin, tài khoản bị hạn chế, đạt giới hạn, lỗi kết nối, chưa rõ kết quả |
| Nhắn group | thành công, thất bại, không tồn tại | tài khoản bị hạn chế, đạt giới hạn, lỗi kết nối |
| Kết bạn | thành công, thất bại, đã là bạn bè, không tồn tại | người nhận chặn tin, đạt giới hạn, hết phiên đăng nhập, lỗi kết nối |
| Thêm thành viên vào group | thành công, thất bại, đã là thành viên | người nhận chặn tin, tài khoản bị hạn chế, đạt giới hạn |
| Huỷ lời mời kết bạn | thành công, thất bại | lỗi kết nối |
| Tham gia group bằng link | thành công, đã tham gia, thất bại | |
| Gắn tag | thành công, thất bại, tag không tồn tại | lỗi kết nối |
| Đổi tên | thành công, thất bại, tham số không hợp lệ | lỗi kết nối |

"Đã là thành viên" của Thêm thành viên vào group có policy (mã 178) và nhánh code nhưng chưa có dòng log nào từ
09/10/2026. "Đã gửi lời mời" của Kết bạn không khai báo: chỉ có 1 dòng ngày 09/10 và không còn nơi nào phát.

Mới khai báo Zalo. Facebook, Email, SMS chưa rà log nên chưa có dòng.

## Những gì đã cân nhắc và không làm

- **Không điền `status_id` cho `auto_campaign_action_detail_statuses`.** 14 dòng trống là kết quả của V369 (10/10/2026):
  người dùng yêu cầu hoàn nguyên phần điền tay vào bảng này, runtime tự điền khi có kết quả thật.
- **Không điền `auto_error.detail_status_id`.** Cột này theo thiết kế chỉ dùng cùng `detail_mode='override'`; app đã cài
  nối bằng `detail_status` dạng chữ.
- **Không tắt trạng thái cũ chưa có dòng log** (đã đổi tên, đã gắn tag, đã gửi lời mời kết bạn, đã gửi tin nhắn). V369
  giữ chúng vì danh mục Automation còn nhắc tới. Chúng đã có trạng thái hệ thống và không nằm trong danh sách của hành
  động nào.
- **Không tắt `zalo_join_group`**: chưa rà đủ nơi dùng.
- **Không đổi cách ghi kết quả.** Xem bước tiếp theo.

## Tương thích

- Desktop, App Server đọc `auto_status` bằng `select *`, chat worker bằng `to_jsonb(s)`; cả ba chỉ lấy trường đã biết và
  dùng cùng lớp `ActionStatusCatalog` (bản của chat worker trùng từng dòng với `src/shared/actionStatusPolicy.ts` tại
  `d87593e`). Lớp này chỉ kiểm trùng id/code, nên cột mới và 6 dòng chưa bật không ảnh hưởng.
- Desktop và chat worker có SELECT cấp bảng trên `auto_status`, nên thấy cột mới mà không cần cấp quyền.
- Hai bảng mới bật RLS, thu hồi `anon`/`authenticated` (ACL mặc định của schema `public` tự cấp cho hai role này), chỉ
  `service_role` đọc/ghi. Desktop chưa có quyền đọc; cấp bằng migration riêng khi có màn hình cần.
- Không view, hàm hay publication nào phụ thuộc kiểu dòng của `auto_status` (kiểm trên production 11/11).
- Từ V494, migration nào kiểm `md5(to_jsonb(dòng auto_status))` phải bỏ `system_status_code`, và mọi trạng thái
  `campaign_detail` thêm mới phải kèm `system_status_code`.

## Kiểm thử

`bash scripts/test-v494-action-system-statuses.sh` (PostgreSQL 16 cục bộ, Node ≥ 22.7): **48/48**.

- Fixture dựng 41 dòng `auto_status`, 19 policy, hành động Zalo, quyền, RLS và ACL mặc định như production. Preflight md5
  của chính migration xác nhận fixture trùng dữ liệu production ở các trường nó phụ thuộc.
- Apply: 41 dòng cũ không đổi cột nào, policy và `auto_error` không đổi.
- Ràng buộc, guard, quyền của từng role.
- Lớp `ActionStatusCatalog` thật nạp danh mục sau migration; preflight 10 hành động Zalo đạt; 28 cặp đang ghi phân giải
  được policy; 26 cặp chưa bật bị từ chối với `status_unavailable`.
- Chạy lại bị từ chối; danh mục, policy mặc định hoặc danh sách hành động lệch bản chụp bị từ chối và không để lại gì.
- Rollback trả `auto_status` về đúng từng cột; rollback từ chối khi trạng thái mới đã có kết quả, đã được `auto_error`
  trỏ tới, đã bật, hoặc đã có trạng thái thêm sau V494.

Chưa chạy trên production, kể cả chạy thử rồi ROLLBACK.

## Apply và rollback

1. Chọn lúc ngoài giờ cao điểm (cao điểm REST 09:45–12:00 VN; chiều 14:00–16:30 VN).
2. Apply bằng `apply_migration` tên `migration_v494_action_system_statuses`. Preflight tự dừng nếu danh mục đã đổi so với
   bản chụp 11/11.
3. Kiểm sau apply: md5 sổ migration bằng md5 file; 6 dòng `auto_system_statuses`; 28 trạng thái `campaign_detail` đều có
   `system_status_code`; 54 dòng `auto_account_action_result_statuses`; `edge_logs` không có 5xx/503 quanh phút apply;
   một lượt chạy Zalo thật vẫn ghi kết quả.

[Rollback](../migrations/rollback_v494_action_system_statuses.sql) chỉ gỡ đúng phần V494 thêm và từ chối khi phần đó đã
được dùng. Cũng là DDL, chạy ngoài giờ cao điểm.

## Bước tiếp theo: bật trạng thái mới

Bật một trạng thái mới làm đổi chữ trạng thái của các dòng hiện đang là `thất bại`, nên phải làm cùng những nơi đang đếm
theo chữ đó, không làm bằng dữ liệu đơn thuần:

1. **Nơi đọc**: báo cáo (`campaignEffectivenessAssembly.ts`, RPC V462/V487, báo cáo theo trạng thái), điều kiện
   Automation của khách đang chọn "thất bại", các nhánh `status === 'thất bại'` trong `campaignScheduler.ts` và bộ chạy
   chat. Chuyển sang quy theo trạng thái hệ thống trước.
2. **Nơi ghi**: thêm policy mặc định cho trạng thái, đặt `is_active=true`, rồi trỏ `auto_error` bằng
   `detail_mode='override'` + `detail_status_id` (giữ `detail_status` dạng chữ cho app cũ). Thiếu policy thì mọi chiến
   dịch của hành động đó báo lỗi ngay khi bắt đầu.
3. **Nhóm Dừng** (120, 802, 223, 224, 600…): hiện không ghi dòng và trả mục tiêu về hàng đợi. Muốn có dòng kết quả cần
   sửa code để ghi mà vẫn giữ mục tiêu trong hàng đợi; bản app cũ sẽ đánh `hoàn thành` nếu chỉ đổi dữ liệu.
4. **Lỗi mạng**: cần chốt có tính vào chuỗi lỗi liên tiếp không (proxy chết phải dừng chiến dịch) và có trả mục tiêu về
   hàng đợi không (tránh gửi trùng khi chưa rõ đã gửi hay chưa).
