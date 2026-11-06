# Mã Zalo 112 và 161 khi nhắn nhóm — V471

Đã apply trên **akachat** `cgjbsmqtfhqvttudyjzq` lúc **11:26:20 Việt Nam, 06/11/2026**.
Ledger: `20261106042620 / migration_v471_zalo_group_112_161_policy`, SHA-256 file
`9716099197796ceeb34bff30988b19035a2ee36c6999dbb6a2b20d8140b3a3de`. ID live: 125 (112),
126 (161). **Không apply lại.** Chỉ thêm 2 dòng `auto_error` (DML); không sửa hoặc phát
hành Desktop, App Server hay chat-sync, không nạp lại schema PostgREST.

Số V468–V470 đã thuộc nhánh báo cáo: V468 `effectiveness_unique_customers` đã apply
05/11; V469 `data_reports` và V470 `zalo_users_friend_index` đang chờ trên nhánh
`claude/campaign-effectiveness-reports`. Vì vậy bản này mang số V471.

## Vì sao

- 7 ngày tới 06/11, hành động `zalo_message_group` (nhắn nhóm và chia sẻ tin vào nhóm):
  112 = 17.769 lần trên 7 tài khoản/6 tổ chức; 161 = 575 lần trên 6 tài khoản.
- Cả hai rơi vào policy dự phòng `err_zalo_api_business_failed` (ID 18): ghi thất bại,
  trừ hạn mức, tính chuỗi mục tiêu lỗi. Khách thấy "Nhắn tin group thất bại: Chia sẻ
  tin nhắn Zalo thất bại (mã Zalo: 112)".
- Lỗi lặp trên cùng nhóm vì chiến dịch chạy nhiều khung giờ mỗi ngày và khung giờ nào
  cũng gửi lại nhóm hỏng. Tài khoản 9709 gửi đúng 5.000 lượt/ngày từ 31/10 đến 02/11,
  tức chạm hạn mức ngày, khoảng 60% là thất bại.
- 112 thường xảy ra sau khi file đã vào nhóm: trong 8 ngày có 2.855 lượt "Đã gửi file
  nhưng gửi nội dung thất bại" ở 4011, 6247, 6933, 10105, tức chỉ phần chữ (gửi bằng
  chia sẻ `mforward`) bị từ chối. Lượt 112 của 9709/9701 (org 1835) đều không kèm file.
  Vì vậy 112 không được tạm dừng mục tiêu: làm vậy sẽ cắt luôn nhóm vẫn nhận được file.

## Hai policy

| | 112 | 161 |
| --- | --- | --- |
| `error_code` | `err_zalo_112_message_group` | `err_zalo_161_group_not_found` |
| Phạm vi | `zalo_message_group` | `zalo_message_group` |
| Trạng thái chi tiết | `thất bại` | `không tồn tại` |
| Trừ hạn mức | Không | Không |
| Tính chuỗi mục tiêu lỗi | Có (như trước) | Không |
| Mục tiêu | Hoàn thành, lần chạy sau thử lại | `tạm dừng`, không gửi lại |
| Câu khách thấy | Zalo từ chối gửi nội dung vào nhóm này (mã 112) | Nhóm Zalo này không còn tồn tại (mã 161) |

Kết quả khi chạy chính code của app (`beginActionResultRun`, `getZaloErrorPolicyByCode`,
`ActionStatusCatalog.resolve`) trên dữ liệu trước và sau V471:

| Trường hợp | Trước V471 | Sau V471 |
| --- | --- | --- |
| Gửi chữ vào nhóm bị 112 | dự phòng ID 18 | thất bại, không trừ hạn mức, tăng chuỗi lỗi, mục tiêu hoàn thành |
| File đã vào nhóm, chữ bị 112 | dự phòng ID 18 | thất bại, **vẫn trừ hạn mức** (đã giao file), không tăng chuỗi lỗi |
| 112 trong lô có nhóm khác thành công | dự phòng ID 18 | thất bại, không trừ hạn mức, không tăng chuỗi lỗi |
| Nhóm không tồn tại (161) | dự phòng ID 18 | không tồn tại, không trừ hạn mức, mục tiêu tạm dừng |
| Đổi tên gợi nhớ / nhắn người lạ bị 112 | dự phòng ID 18 | dự phòng ID 18 (không đổi) |

Câu thông báo không chèn được tên nhóm: policy chỉ có `[a]` (tên hành động) và `[x]`
(câu Zalo trả về), và với 112 thì `[x]` chỉ là "Chia sẻ tin nhắn Zalo thất bại".

## Hiệu lực

- Danh mục policy được chụp khi bắt đầu lượt chạy, cache dùng chung 60 giây
  ([actionStatusPolicyRepository.ts](../src/main/data/repositories/actionStatusPolicyRepository.ts)).
  Lượt bắt đầu sau khoảng 1 phút nhận policy mới; không cần cập nhật hay khởi động lại app.
  Chat-sync (`akaAgentChatApi`) đọc `auto_error` theo cùng hai cột khi bắt đầu lượt.
- 161: RPC `aka_agent_settle_action_results_v1` đặt mục tiêu `tạm dừng`, ghi chú là câu
  policy. Mọi chỗ đặt lại mục tiêu đều bỏ qua `tạm dừng`: chuyển khung giờ Desktop
  ([campaignRepository.ts:5982](../src/main/data/repositories/campaignRepository.ts:5982)),
  dời lịch qua ngày ([campaignRepository.ts:3833](../src/main/data/repositories/campaignRepository.ts:3833)),
  RPC `aka_agent_advance_zalo_server_multi_daily_slot` của App Server và chat-sync.
  Muốn gửi lại nhóm đó phải chuyển mục tiêu về `chờ xử lý`.
- Đây là lần đầu `auto_error.input_effect` được dùng trên production.
- Chỉ áp cho lỗi xảy ra sau khi apply. Mục tiêu đã `hoàn thành` vì 161 trước đó sẽ bị
  thử thêm một lần ở khung giờ kế rồi mới tạm dừng.
- 112 vẫn bị thử lại ở mọi khung giờ. Không trừ hạn mức nghĩa là số lần thất bại mỗi
  ngày không còn bị hạn mức chặn lại; cách dứt điểm là khách bỏ nhóm hỏng khỏi danh sách
  hoặc sửa cách gửi phần chữ (cần code).

## Migration và rollback

- [Migration V471](../migrations/migration_v471_zalo_group_112_161_policy.sql)
- [Rollback thủ công](../migrations/rollback_v471_zalo_group_112_161_policy.sql)

Migration giải theo mã/tên, không hardcode ID. Trước khi ghi nó kiểm: hành động còn
bật; mỗi trạng thái khớp đúng một `auto_status` (đếm cả dòng tắt, như
`statusForLegacyValue`) và có status-policy đang bật (như `selectPolicy`); ghim
status-policy mà hai dòng dựa vào; không dòng nào khác đang xử lý 112/161 cho nhắn nhóm;
sequence không tụt sau `max(id)`. Sau khi ghi: hai dòng khớp nguyên nội dung; các dòng
`auto_error` khác giữ checksum; resolver trả đúng dòng cho nhắn nhóm và không bao giờ trả
cho hành động khác; lặp lại phép kiểm lúc bắt đầu lượt chạy trên mọi dòng lỗi Zalo của
nhắn nhóm. Chạy lại khi đã đúng không ghi gì; dòng đã rollback thì bật lại.
`lock_timeout` 3 giây, `statement_timeout` 15 giây.

Rollback tắt hai dòng nhưng giữ lại để bảo toàn lịch sử, không trả hàng đợi mục tiêu
đã bị 161 tạm dừng. Tìm các mục tiêu đó qua log lỗi (index `normalized_error_code`) rồi
theo tài khoản (index `account_id, action_code, created_at`); thay `<thời điểm apply>`,
và chỉ trả lại hàng đợi khi được duyệt:

```sql
with acc as (
  select distinct account_id from public.auto_zalo_api_error_logs
  where normalized_error_code = 'err_zalo_161_group_not_found'
)
select distinct d.input_data_id
from acc cross join lateral (
  select d.input_data_id from public.auto_campaign_details d
  where d.account_id = acc.account_id and d.action_code = 'zalo_message_group'
    and d.created_at >= '<thời điểm apply>' and d.error_code = 'err_zalo_161_group_not_found'
) d;
```

## Kiểm chứng

- Bản PostgreSQL 17 local dựng từ cấu trúc, ràng buộc, chỉ mục, trigger và dữ liệu
  production của `auto_error`, `auto_status`, `auto_account_action_status_policies`,
  `auto_account_actions`; checksum cả 4 bảng khớp production
  (`auto_error` = `0184791ccfe107f2740b608ebbe2684f`).
- 44 kiểm tra đạt: apply, chạy lại không đổi timestamp/không thêm nhật ký, rollback,
  rollback hai lần, apply lại sau rollback, rollback khi chưa apply, kết thúc ROLLBACK
  không để lại gì, ID khác production; phải từ chối khi: có dòng 112 không giới hạn hành
  động, dòng 161 cho nhắn nhóm, dòng `error_code='112'`, trùng mã khác nội dung, trạng
  thái `thất bại` mơ hồ, trạng thái không tồn tại bị tắt, status-policy đổi, status-policy
  riêng đang tắt che mặc định, hành động bị tắt, sequence tụt, một dòng lỗi khác làm hỏng
  phép kiểm lúc bắt đầu lượt chạy; chờ tối đa 3 giây khi dòng trạng thái đang bị khoá.
  Migration và rollback mang cùng JSON policy, file chuẩn Unicode NFC.
- Code app thật: bảng kết quả ở trên; `beginActionResultRun` đạt cho nhắn nhóm và cả
  11 hành động Zalo.
- Production chỉ đọc 06/11/2026: mọi điều kiện tiên quyết đạt, chưa có xung đột,
  sequence 122 = `max(id)`, checksum `auto_error` giống bản đã thử.
- Thử production lúc 11:25:59, kết thúc ROLLBACK: chạy hết kiểm tra trước và sau, ghi
  được ledger và 2 dòng nhật ký rồi hủy. Sau đó checksum `auto_error`, nhật ký và ledger
  như cũ. Lần thử tiêu 2 số sequence (123, 124) nên ID thật là 125/126.
- Apply lúc 11:26:19–21: hai dòng khớp nội dung; các dòng khác giữ checksum
  `0184791ccfe107f2740b608ebbe2684f`; ledger khớp SHA-256 file; nhật ký cấu hình ghi
  2 INSERT; tra policy trên production đúng cho 5 trường hợp (nhóm nhận dòng mới, đổi
  tên gợi nhớ, nhắn người lạ và nhắn bạn bè vẫn về ID 18).
- Lượt chạy thật đầu tiên dùng policy mới: 11:27:16, tài khoản 10105 (desktop), 112 khi
  gửi vào nhóm → `thất bại`, `err_zalo_112_message_group`, không trừ hạn mức, câu mới.
  Lượt bắt đầu trước khi apply vẫn ghi theo policy cũ tới khi kết thúc (5 lượt 112 từ
  11:26:26 đến 11:26:50).
- Chưa quan sát: lượt 161 đầu tiên (mục tiêu chuyển `tạm dừng`) và lượt trên App
  Server/chat-sync. Chat-sync mới đối chiếu code (cùng điều kiện khớp và cùng phép kiểm
  lúc bắt đầu lượt), chưa chạy code chat-sync.
