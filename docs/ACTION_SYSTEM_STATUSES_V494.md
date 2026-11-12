# Trạng thái hệ thống và danh sách trạng thái theo hành động — V494

**Trạng thái: ĐÃ apply akachat lúc 17:23:05 VN ngày 11/11/2026** (`20261111102305 /
migration_v494_action_system_statuses`; **không apply lại**, không sửa file migration). md5 sổ migration bằng md5 file
`0bdaa78e190ef7376ab6d0a0a54b73a0`. [Biên nhận](../migrations/snapshots/action-system-statuses-v494/apply-receipt.json).
Chưa có code ứng dụng nào đọc phần mới; 8 trạng thái mới chưa bật.

Lịch hẹn 17:00 VN đã dừng trước khi gửi lệnh: lúc 16:53 VN sổ migration có thêm V495 (engine kết quả chiến dịch v2), sửa
đúng bảng `auto_status`. V494 được chỉnh và kiểm thử lại trên schema sau V495 rồi mới apply, sau khi người dùng chọn apply
bản đã chỉnh; xem mục [Quan hệ với V495](#quan-hệ-với-v495) và [Kết quả apply](#kết-quả-apply-production).

Người dùng chốt ngày 11/11/2026 sau đợt rà soát log Zalo: mỗi trạng thái kết quả của hành động phải gắn với đúng một
trạng thái hệ thống, danh sách trạng thái của Zalo phải đủ, và mỗi hành động phải có danh sách trạng thái khai báo trước.
Cùng ngày người dùng yêu cầu thêm cho các hành động gửi tin nhắn Zalo bốn trạng thái tương tác: đã nhận, đã xem, đã tim/like,
đã phản hồi.

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
| `success` | Thành công | success | thành công, đã click, đã đổi tên, đã gắn tag, đã gửi, đã gửi lời mời kết bạn, đã gửi tin nhắn, đã nhận, đã xem, đã duyệt bài, *đã thả cảm xúc*, *đã phản hồi* |
| `failure` | Thất bại | failure | thất bại, không tồn tại, tag không tồn tại, tham số không hợp lệ, *người nhận chặn tin* |
| `skipped` | Bỏ qua | skipped | bỏ qua, đã gửi lời mời, đã là bạn bè, đã là thành viên, đã tham gia |
| `stopped` | Dừng | pending | *tài khoản bị hạn chế*, *đạt giới hạn*, *hết phiên đăng nhập* |
| `error` | Lỗi | failure | lỗi, *lỗi kết nối*, *chưa rõ kết quả* |
| `pending` | Chờ | pending | đang gọi, chờ duyệt bài |

Chữ nghiêng là 8 trạng thái mới ở mục 2. Cột `report_group` của bảng này cho biết trạng thái hệ thống quy về nhóm nào
trong 4 nhóm cũ. `report_group` của `auto_account_action_status_policies` giữ nguyên 4 giá trị: lớp `ActionStatusCatalog`
trên app đã cài từ chối cả danh mục khi gặp giá trị lạ, nên không thêm `stopped`/`error` vào đó.

### 2. Tám trạng thái cơ bản mới, chưa bật

Sáu trạng thái lỗi và dừng của Zalo:

| Giá trị | Trạng thái hệ thống | Mã Zalo | Hiện đang ghi |
|---|---|---|---|
| người nhận chặn tin | Thất bại | 122, 119, 126, 215, 251 | thất bại |
| tài khoản bị hạn chế | Dừng | 120, 802, 123, 127 | thất bại hoặc không ghi |
| đạt giới hạn | Dừng | 221, 312, 313, 304, 314, 223, 224 | thất bại hoặc không ghi |
| hết phiên đăng nhập | Dừng | 600 | không ghi |
| lỗi kết nối | Lỗi | ECONNRESET, ETIMEDOUT, ENOTFOUND, HTTP 500/502 | thất bại |
| chưa rõ kết quả | Lỗi | quá thời gian gửi media | thất bại |

Hai trạng thái tương tác sau khi gửi tin, dùng chung mọi kênh (`flatform_type='all'`) như "đã nhận", "đã xem", "đã click":

| Giá trị | Trạng thái hệ thống | Ý nghĩa | Nguồn dữ liệu của Zalo |
|---|---|---|---|
| đã thả cảm xúc | Thành công | Người nhận thả tim, like hoặc cảm xúc khác vào tin | dấu `reacted_at` của theo dõi tương tác V339 |
| đã phản hồi | Thành công | Người nhận nhắn lại sau lượt gửi | dấu `responded_at` của V339 |

Tên lấy đúng theo nhãn giao diện đang có của cột "Tương tác Zalo" (`src/shared/zaloCampaignEngagement.ts`): yêu cầu ghi
"đã tim/like", giao diện đang gọi là "Đã thả cảm xúc". "Đã nhận" (id 32) và "đã xem" (id 34) đã có trong danh mục từ SMS và
Email nên không tạo dòng mới.

Cả tám có `is_active=false`, không có policy và không `auto_error` nào trỏ tới. Bộ chạy không ghi được chúng:
`ActionStatusCatalog.status()` ném `status_unavailable` với trạng thái chưa bật (bộ kiểm thử xác nhận).

### 3. Hành động – trạng thái

Bảng `auto_account_action_result_statuses(action_code, status_id, is_active, sort_order, note)`, duy nhất theo cặp.
`is_active=true` nghĩa là bộ chạy đang ghi trạng thái đó cho hành động; `false` là đã khai báo, chưa bật. Trigger guard
chỉ nhận trạng thái `campaign_detail` và không cho bật cặp khi trạng thái chưa bật.

Tên dễ nhầm: `auto_account_action_status` là khóa hành động theo từng tài khoản; `auto_account_action_status_policies` là
cách đếm; bảng mới là danh sách khai báo.

Đã khai báo cho 10 hành động Zalo (28 cặp đang ghi, 34 cặp chưa bật). `zalo_join_group` không có dòng nào vì không có
kết quả trong log và code Desktop chỉ còn nhắc tới nó trong một danh sách báo cáo.

| Hành động | Đang ghi | Đã khai báo, chưa bật |
|---|---|---|
| Tìm SĐT | thành công, không tồn tại, thất bại | đạt giới hạn, hết phiên đăng nhập, lỗi kết nối |
| Nhắn người lạ | thành công, thất bại | **đã nhận, đã xem, đã thả cảm xúc, đã phản hồi**, người nhận chặn tin, tài khoản bị hạn chế, hết phiên đăng nhập, lỗi kết nối, chưa rõ kết quả |
| Nhắn bạn bè | thành công, thất bại | **đã nhận, đã xem, đã thả cảm xúc, đã phản hồi**, người nhận chặn tin, tài khoản bị hạn chế, đạt giới hạn, lỗi kết nối, chưa rõ kết quả |
| Nhắn group | thành công, thất bại, không tồn tại | tài khoản bị hạn chế, đạt giới hạn, lỗi kết nối |
| Kết bạn | thành công, thất bại, đã là bạn bè, không tồn tại | người nhận chặn tin, đạt giới hạn, hết phiên đăng nhập, lỗi kết nối |
| Thêm thành viên vào group | thành công, thất bại, đã là thành viên | người nhận chặn tin, tài khoản bị hạn chế, đạt giới hạn |
| Huỷ lời mời kết bạn | thành công, thất bại | lỗi kết nối |
| Tham gia group bằng link | thành công, đã tham gia, thất bại | |
| Gắn tag | thành công, thất bại, tag không tồn tại | lỗi kết nối |
| Đổi tên | thành công, thất bại, tham số không hợp lệ | lỗi kết nối |

"Đã là thành viên" của Thêm thành viên vào group có policy (mã 178) và nhánh code nhưng chưa có dòng log nào từ
09/10/2026. "Đã gửi lời mời" của Kết bạn không khai báo: chỉ có 1 dòng ngày 09/10 và không còn nơi nào phát.

Bốn trạng thái tương tác xếp giữa "thành công" và "thất bại" (thứ tự 12, 14, 16, 18) vì chúng là bước tiếp theo của một
lượt gửi thành công. Nhắn group chưa có bốn trạng thái này: theo dõi tương tác V339 loại trừ tin nhóm (và tài khoản Zalo
trình duyệt), nên chưa có nguồn dữ liệu nào cho nhóm.

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

## Quan hệ với V495

V495 (`20261111095339 / migration_v495_campaign_outcome_engine`, apply akachat 16:53 VN 11/11/2026, không thuộc nhánh
này) thêm vào đúng các bảng V494 dùng:

| V495 thêm | Liên quan tới V494 |
|---|---|
| `auto_status.report_group` (4 nhóm: success/failure/skipped/pending), đã điền cho 22 trạng thái kết quả | Cùng ý với "nhóm báo cáo" của trạng thái hệ thống. V495 không có Dừng và Lỗi; hai nhóm này chỉ có ở `system_status_code`. |
| `auto_status.counts_as_delivered`, `progress_rank` (đã gửi 10 < đã nhận 20 < đã xem 30 < đã click 40) | Thứ hạng dùng để nâng trạng thái theo sự kiện. |
| `auto_status.parent_status_id` + trigger `auto_status_parent_guard_v495` | Trạng thái "xử lý như" trạng thái gốc. V494 không dùng. |
| `auto_status_event_rules` (sự kiện → trạng thái; đang có `email.open`, `email.click`, `sms.received`) | Đây là cơ chế sẵn có cho bốn trạng thái tương tác: hàm của engine chỉ nâng trạng thái khi thứ hạng mới cao hơn thứ hạng của `coalesce(sub_status_id, status_id)`. |
| `auto_outcome_policies` (154 dòng, có `error_class` 13 nhóm: `account_restricted`, `quota`, `auth`, `transient`, `unknown_delivery`…), `auto_account_actions.operation_class` | Chính sách xử lý theo mã lỗi/nhóm lỗi của engine. Không phải danh sách trạng thái khai báo theo hành động. |

V494 sau khi chỉnh:

- Không sửa cột nào của V495 trên 22 dòng đang có, không thêm luật vào `auto_status_event_rules`, không thêm dòng
  `auto_outcome_policies`.
- 8 trạng thái mới điền đủ ba cột của V495: `report_group` bằng nhóm của trạng thái hệ thống (Dừng → `pending`, Lỗi →
  `failure`), `counts_as_delivered` = false cho 6 trạng thái lỗi/dừng và true cho 2 trạng thái tương tác, `progress_rank`
  đã thả cảm xúc 40, đã phản hồi 50 (sau đã xem 30).
- Preflight từ chối nếu `auto_status` thiếu cột của V495 hoặc có trạng thái kết quả chưa có `report_group`. Postflight
  kiểm cả 30 trạng thái kết quả có `auto_status.report_group` trùng nhóm của trạng thái hệ thống.
- Rollback từ chối thêm khi luật sự kiện, chính sách engine hoặc `parent_status_id` đã trỏ tới 8 trạng thái mới.

Hai cột `report_group` và `system_status_code` cùng nằm trên một dòng và phải khớp nhau. **Từ V514** (apply akachat 12/11/2026 23:03:46 VN, `20261112160346`) trigger
`auto_status_system_group_guard_v514` ép lúc ghi: nhóm báo cáo hiệu lực (của dòng, không có thì của trạng thái gốc) phải có và trùng
nhóm của trạng thái hệ thống, trạng thái gốc phải cùng nhóm hệ thống với dòng con; view `aka_agent_engine_policy_lint` báo
`status_group_mismatch` cho dòng lệch có sẵn.

Chưa đọc được tài liệu thiết kế của V495 (`docs/CAMPAIGN_OUTCOME_ENGINE.md` chưa có trên nhánh nào đã đẩy lên của repo
này lúc 17:10 VN 11/11); phần trên rút từ nguyên văn migration trong sổ và trạng thái production.

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

`bash scripts/test-v494-action-system-statuses.sh` (PostgreSQL 16 cục bộ, Node ≥ 22.7): **65/65**.

- Fixture dựng 41 dòng `auto_status` kèm 4 cột, 2 CHECK và trigger của V495 (giá trị đọc từ production 17:10 VN 11/11),
  `auto_status_event_rules`, `auto_outcome_policies` rút gọn, 19 policy, hành động Zalo, quyền, RLS và ACL mặc định như
  production. Preflight md5
  của chính migration xác nhận fixture trùng dữ liệu production ở các trường nó phụ thuộc.
- Apply: 41 dòng cũ không đổi cột nào, policy và `auto_error` không đổi.
- Ràng buộc, guard, quyền của từng role.
- Lớp `ActionStatusCatalog` thật nạp danh mục sau migration; preflight 10 hành động Zalo đạt; 28 cặp đang ghi phân giải
  được policy; 34 cặp chưa bật bị từ chối (`status_unavailable`, riêng "đã nhận"/"đã xem" là `policy_missing` vì trạng thái
  có sẵn nhưng chưa có policy kết quả).
- Bốn trạng thái tương tác chỉ có ở nhắn bạn bè và nhắn người lạ, đúng thứ tự; "đã nhận"/"đã xem" dùng lại dòng 32/34.
- 8 trạng thái mới điền đủ cột của V495; nhóm báo cáo trùng nhóm của trạng thái hệ thống ở cả 30 dòng; luật sự kiện và
  chính sách engine không đổi.
- Chạy lại bị từ chối; danh mục, policy mặc định hoặc danh sách hành động lệch bản chụp bị từ chối và không để lại gì;
  schema thiếu cột V495, thiếu `report_group` hoặc `report_group` lệch nhóm cũng bị từ chối.
- Rollback trả `auto_status` về đúng từng cột; rollback từ chối khi trạng thái mới đã có kết quả, đã được `auto_error`
  trỏ tới, đã bật, hoặc đã có trạng thái thêm sau V494; cả khi "đã phản hồi" đã được dùng làm trạng thái phụ, hoặc luật
  sự kiện, chính sách engine, trạng thái gốc của V495 đã trỏ tới trạng thái mới.

Không chạy thử kiểu BEGIN…ROLLBACK trên production trước khi apply.

## Kết quả apply production

- Kiểm trước (17:21 VN, chỉ đọc): sổ chưa có V494; ba vân tay preflight khớp; đủ 4 cột của V495, 22/22 trạng thái có
  `report_group` trùng nhóm định gắn; không có khóa trên `auto_status`; REST p50 47–50 ms.
- Sau apply: 6 trạng thái hệ thống; 30 trạng thái kết quả đều có trạng thái hệ thống (8 chưa bật, id 56–63); 19 trạng thái
  component khác để trống; `report_group` trùng nhóm của trạng thái hệ thống 30/30; 62 cặp hành động–trạng thái (28 đang
  ghi, 34 chưa bật, 10 hành động); 22 dòng cũ giữ vân tay và `updated_at`; policy mặc định, 3 luật sự kiện và 154 chính
  sách engine không đổi; hai bảng mới bật RLS, chỉ `service_role` đọc được.
- Bộ chạy: trong 2 phút 19 giây sau apply có 584 dòng kết quả (530 của Zalo: Server 348, QR 119, trình duyệt 63), nhịp
  ~252 dòng/phút so với ~281 dòng/phút của 10 phút trước; không dòng nào dùng trạng thái mới.
- PostgREST nạp lại schema 17:23:07.96 → 17:23:20.90 VN (câu đọc schema 9,05 giây). Trong 20 giây đó 812/11.817 request
  REST chậm hơn 1 giây. 20 giây kế tiếp có **21 lỗi 500** do chạm trần 3 giây: 13 PATCH `contacts` từ gateway chat cũ
  (`138.199.24.245`, không tự gửi lại), 7 GET `messages` từ `167.88.158.83`, 1 POST `contacts` từ luồng Pancake. Từ
  17:23:40 hết lỗi, p50 46–52 ms. 0 lỗi 503.
- Lỗi 500 của `rpc/aka_agent_claim_account_operation` (2 IP Desktop, mỗi lượt đúng 3 giây) đã có từ 17:21:50, trước khi
  apply, và dừng lúc 17:23:33; không do V494.

## Apply và rollback

1. Chọn lúc ngoài giờ cao điểm (cao điểm REST 09:45–12:00 VN; chiều 14:00–16:30 VN).
2. Apply bằng `apply_migration` tên `migration_v494_action_system_statuses`. Preflight tự dừng nếu danh mục đã đổi so với
   bản chụp 11/11.
3. Kiểm sau apply: md5 sổ migration bằng md5 file; 6 dòng `auto_system_statuses`; 30 trạng thái `campaign_detail` đều có
   `system_status_code`; 62 dòng `auto_account_action_result_statuses`; `edge_logs` không có 5xx/503 quanh phút apply;
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
   **Engine v2 không đọc `auto_error.detail_status`**: trạng thái lịch sử theo mã của engine nằm ở
   `auto_outcome_policies.detail_status_id` (chép lúc seed V495/V500). Bật trạng thái mới cho một mã thì sửa cả dòng chính sách
   engine của mã đó, nếu không bộ chạy cũ và engine ghi hai trạng thái khác nhau cho cùng một lỗi. Đặt thêm `parent_status_id` của
   trạng thái mới về trạng thái gốc cùng nhóm hệ thống (người nhận chặn tin → thất bại 21; lỗi kết nối, chưa rõ kết quả → lỗi 22)
   để engine kế thừa chính sách theo trạng thái. Xong thì `SELECT * FROM aka_agent_engine_policy_lint` phải rỗng (V514 báo
   `detail_status_differs_from_auto_error` khi hai bên lệch).
3. **Nhóm Dừng** (120, 802, 223, 224, 600…): hiện không ghi dòng và trả mục tiêu về hàng đợi. Muốn có dòng kết quả cần
   sửa code để ghi mà vẫn giữ mục tiêu trong hàng đợi; bản app cũ sẽ đánh `hoàn thành` nếu chỉ đổi dữ liệu.
4. **Lỗi mạng**: cần chốt có tính vào chuỗi lỗi liên tiếp không (proxy chết phải dừng chiến dịch) và có trả mục tiêu về
   hàng đợi không (tránh gửi trùng khi chưa rõ đã gửi hay chưa).
5. **Tương tác sau khi gửi tin** (đã nhận, đã xem, đã thả cảm xúc, đã phản hồi):
   - Nguồn dữ liệu là theo dõi tương tác V339 ([tài liệu](ZALO_CAMPAIGN_ENGAGEMENT.md)), **đang tắt từ 15:44 ngày 06/10/2026**
     (`zalo.campaign_engagement.enabled=false`). Chưa có ghi chép vì sao tắt; phải hỏi lý do và đo tải trước khi bật lại.
   - V339 lưu ba dấu độc lập `seen_at`, `responded_at`, `reacted_at` trong `auto_campaign_detail_zalo_engagement`, không đổi
     trạng thái của dòng kết quả. **Chưa có dấu "đã nhận"**: bộ chạy có nhận sự kiện `delivered_messages` của Zalo nhưng chỉ
     dùng nó khi kèm xác nhận đã xem. Cần thêm cột `delivered_at` và sửa cả ba bộ chạy.
   - Engine V495 đã có sẵn đường đi cho việc này: thêm luật `auto_status_event_rules` (sự kiện Zalo → trạng thái) và
     engine nâng trạng thái theo `progress_rank`. Tên sự kiện Zalo (`event_kind`) do engine quy định, V494 chưa thêm luật
     nào. Phần (a)/(b) dưới đây chỉ còn áp dụng cho bộ chạy cũ.
   - Cần chốt cách đưa dấu thành trạng thái: (a) đổi trạng thái chính của dòng từ "thành công" lên mức cao nhất đạt được,
     như Email đang làm với "đã xem"/"đã click"; khi đó báo cáo và Automation đang chọn "thành công" phải quy theo trạng thái
     hệ thống trước; hoặc (b) giữ trạng thái chính là "thành công" và ghi tương tác vào trạng thái phụ (`sub_status_id`),
     không ảnh hưởng nơi đang đọc.
   - Một tin có thể vừa được xem, vừa được thả cảm xúc, vừa được phản hồi. Nếu mỗi dòng chỉ mang một trạng thái thì lấy mức
     cao nhất theo thứ tự đã nhận < đã xem < đã thả cảm xúc < đã phản hồi; ba dấu thời gian vẫn giữ riêng.
   - V339 không theo dõi tin nhóm, tài khoản Zalo trình duyệt, lượt gửi lỗi hoặc gửi một phần; "đã xem" và "đã thả cảm xúc"
     cần Zalo trả mã tin, còn "đã phản hồi" thì không.
