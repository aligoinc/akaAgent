# Engine kết quả chiến dịch (v2): bắt hết lỗi, điều khiển bằng DB, tự phục hồi

> Trạng thái: **giai đoạn 1, chỉ ở local** (nhánh `feat/campaign-outcome-engine`). Chưa apply production, chưa deploy Fly, chưa phát hành Desktop.
> Phạm vi: chiến dịch Zalo, Facebook, Email; không gồm `sms_send`, `voice_call`.
> Kế hoạch đã duyệt: `/Users/lequangnhut/.claude/plans/t-i-mu-n-t-ch-c-composed-wolf.md`.
> Phụ lục: [bản rà 453 nguồn lỗi](CAMPAIGN_OUTCOME_ENGINE_ERROR_INVENTORY.md) · [bảng mã và kịch bản Zalo để duyệt (1b)](CAMPAIGN_OUTCOME_ENGINE_REVIEW_ZALO.md).
> Hiện thực: `migrations/migration_v495_campaign_outcome_engine.sql` (+ rollback), lõi `packages/campaign-engine/`, kiểm chứng ở mục 13.

## 1. Ý tưởng chính

```text
Adapter (Zalo / Facebook / Email) ── tín hiệu thô ──▶ DB: phân loại → chọn chính sách → áp hiệu ứng ──▶ chỉ thị ──▶ Runtime làm theo
```

- **Runtime không tự quyết.** Adapter chỉ thực hiện thao tác và trả tín hiệu thô. DB đổi tín hiệu thành mã lỗi, gộp chính sách, ghi lịch sử, áp hiệu ứng trong **một giao dịch**, rồi trả chỉ thị.
- **Một lõi cho hai nơi chạy.** Lõi nằm ở `packages/campaign-engine/`, dùng chung cho Desktop (Electron) và Fly (`akaAgentChatApi/apps/system-worker`). Khác biệt giữa hai nơi chỉ nằm ở adapter (port).
- **Chọn nơi chạy, không có công tắc nào khác** (11/11/2026). Desktop theo bản cài: bản mới chạy bộ mới cho các loại lõi đã phủ, bản cũ chạy bộ cũ. Tài khoản Server theo cờ `org_organization.use_new_zalo_runtime` (V371; trigger ép bật cho tổ chức tạo từ 10/10/2026; V496 đã apply 11/11 16:10:27 VN, tắt ép bật nên tổ chức mới mặc định `false`) và chỉ chạy bộ mới trên Fly; VPS giữ bộ cũ tới khi tắt. Apply migration không đổi hành vi code cũ.

## 2. Mô hình lỗi

### 2.1 Tín hiệu

Mọi kết quả, ở mọi lớp, được đưa về một khuôn (`Signal` trong `packages/campaign-engine/src/contracts.ts`):

| Trường | Giá trị |
|---|---|
| `layer` | `operation` · `gate` · `preparation` · `recording` · `run_control` · `transport` · `lifecycle` |
| `actionCode` | bước, tức mã thao tác trong `auto_account_actions` (`zalo_find_phone_user`, `zalo_message_stranger`, `fb_post_group`…) |
| `phase` | `before_send` (chưa tác động lên nền tảng) · `in_flight` (đã gửi đi, không rõ tới chưa) · `after_send` (nền tảng đã trả lời) |
| `kind` + `code` / `message` | `zalo_code`, `errno`, `http_status`, `timeout`, `message_like`, `block`, `exception`, `fly_command`, `engine` |
| `evidence` | `msgId`, `partialDelivery`, `postUrl`… |

### 2.2 Mã và nhóm

- **`auto_error` là danh mục mã.** Mỗi mã có `public_code` hiện cho khách (Z122, NET01…), `error_class`, `customer_title`, `customer_help`. Nhiều dòng có thể dùng chung một `public_code` khi cùng một lý do nhưng khác thao tác (ví dụ 127 khi nhắn bạn bè và khi nhắn người lạ).
- **13 nhóm**, mỗi nhóm có mặc định riêng, nên mã mới chỉ cần khai nhóm:

| Nhóm | Mặc định xử lý ở | Mặc định |
|---|---|---|
| `target_permanent` | data | hoàn thành, nhớ trong tổ chức |
| `target_temporary` | data | hẹn chạy lại |
| `unknown_delivery` | data | hoàn thành, không gửi lại |
| `already_done` | data | hoàn thành, không tính hạn mức (đã là bạn bè, đã là thành viên…) |
| `account_restricted` | tài khoản × thao tác | khoá đúng thao tác, hẹn mở |
| `quota` | tài khoản × thao tác | chờ tới lúc mở |
| `auth` | tài khoản | dừng tài khoản, đổi trạng thái đăng nhập |
| `content_config` | chiến dịch | tạm dừng một lần, không đốt data |
| `ui_changed` | loại thao tác | không đốt data |
| `transient` | lượt chạy | chờ, thử lại, tự chạy tiếp |
| `internal` | lượt chạy | ghi vết; lặp lại thì tạm dừng |
| `cancelled` | — | không tính là lỗi |
| `run_control` | chiến dịch | ghi lý do, hẹn lại |

`already_done` là nhóm thứ 13, thêm vào so với kế hoạch để chứa các mã "không phải lỗi" như 222, 225, 178.

### 2.3 Luật phân loại `auto_outcome_signal_rules`

- **Khoá luật:** `platform` + `action_code` (NULL = mọi thao tác) + `phase` (NULL = mọi pha) + `signal_kind` + `pattern`.
- **Thứ tự so khớp** (`aka_agent_engine_classify_signal`):
  0. `signal.errorCode` là mã đang bật thì dùng luôn (luật kiểm cấu hình, mã engine).
  1. Luật khớp chính xác (`zalo_code`, `errno`, `http_status`, `fly_command`, `engine`, `block`, `exception`, `timeout`).
  2. `message_like` (ILIKE).
  3. `*` của đúng loại tín hiệu, ví dụ `exception` + `*` → `err_undefined` (lỗi code của mình, như `handleCampaignBadTarget`).
  4. Luật bắt-tất-cả `engine` + `*` của đúng nền tảng × pha.

  Cùng mức thì luật của nền tảng trước luật `system`, rồi luật có `action_code`, có `phase`, rồi `priority` nhỏ hơn.
- **Tín hiệu do app tự đặt** (bản rà ZL-T1/T3/S5): `engine` + `target_missing_identity` / `forward_to_self` → 114, `find_user_without_uid` → 216, đúng mã hôm nay. Đề xuất #6 của bảng duyệt chuyển hai luật đầu sang DAT01.
- **Không khớp luật cụ thể nào** (chỉ khớp luật bắt-tất-cả) thì ghi sổ `auto_outcome_unmatched`. Câu được chuẩn hoá: số dài thành `#`, cắt còn 200 ký tự.
- **Seed:** dựng từ `auto_error.zalo_error_codes` × `zalo_action_codes` đang có, 1:1 với hành vi hiện tại. Luật bắt-tất-cả Zalo trỏ về `err_zalo_api_business_failed`, đúng như hôm nay. Các đề xuất phân loại lại (lỗi mạng trước khi gửi thành NET01…) nằm trong bảng duyệt 1b, **chưa** vào seed.

## 3. Chính sách `auto_outcome_policies`

### 3.1 Khớp

- **Theo lỗi:** `error_code` hoặc `error_class`.
- **Hoặc theo trạng thái kết quả:** `status_id`, cho thành công / bỏ qua.
- **Hoặc chặn theo thao tác:** dòng chỉ có `action_code`, áp sau cùng. Seed dùng cho thao tác phụ gắn tag / đổi tên: không bao giờ tính lượt hay đổi chuỗi lỗi, dù mã lỗi nói gì (giống guard `auxiliaryAction` hôm nay).

  Các loại không cạnh tranh nhau.
- **Phạm vi tuỳ chọn:** `action_code` (bước), `campaign_action_id` (loại chiến dịch), `runtime_target` (`desktop` / `fly`).
- **Ràng buộc:** `UNIQUE NULLS NOT DISTINCT` trên bộ khớp, chỉ tính dòng đang bật. View `aka_agent_engine_policy_lint` liệt kê dòng chồng nhau, hoặc nền tảng × pha thiếu luật bắt-tất-cả.

### 3.2 Gộp từng trường

`aka_agent_engine_resolve_policy(...)` gộp các dòng khớp. Trường NULL nghĩa là kế thừa. Dòng xếp sau ghi đè dòng xếp trước:

```text
mặc định an toàn trong hàm
  < chính sách theo trạng thái kết quả (trạng thái gốc → trạng thái con)
  < chính sách theo nhóm lỗi
  < chính sách theo mã lỗi
  < chặn theo thao tác
Trong cùng mức: toàn cục < runtime < bước < loại chiến dịch
```

Hệ quả:
- **Lỗi mới chỉ cần khai nhóm** là có đủ cách xử lý.
- **Lỗi có trạng thái kết quả** (ví dụ `detail_status_id` = "thất bại") nhận thêm các trường chính sách của trạng thái đó cho những gì chính sách lỗi để trống. Thứ tự này dựng lại đúng cách hai lớp hiện tại phối hợp nhau.

Mặc định an toàn trong hàm, dùng khi dữ liệu chính sách thiếu hoặc lỗi; RPC không ném lỗi:

| Pha | Mặc định |
|---|---|
| `before_send` | data về hàng đợi, không tính hạn mức, không đếm lỗi, kết thúc lượt |
| `in_flight` | data hoàn thành, không gửi lại, tính hạn mức nếu là thao tác giao hàng |
| `after_send` | data hoàn thành ("thất bại"), tính hạn mức, đếm lỗi |

### 3.3 Trường hiệu ứng

| Câu hỏi | Trường | Giá trị |
|---|---|---|
| Ghi lịch sử | `detail_mode`, `detail_status_id`, `sub_status_id`, `log_template`, `campaign_note_template` | `write` / `suppress`; mẫu câu dùng `{name}`, `{code}`, `{until}`, `{action}` |
| Hạn mức (hạn mức hiện có) | `quota_effect` | `count` / `no_count` / `count_if_committed` |
| Đếm lỗi | `target_streak_effect`, `streak_threshold` | `increment` / `reset` / `ignore` (gộp theo data: increment > reset > ignore). Ngưỡng chỉ dùng khi kết quả thật sự tăng chuỗi: tăng chuỗi thì hiệu ứng chiến dịch chờ tới ngưỡng, không tăng thì áp ngay (`receipt.countsTowardBadTarget ? handleCampaignBadTarget : applyRuntimeErrorPolicy`). Mã tăng chuỗi mà không tự có ngưỡng hay hiệu ứng thì theo mã canh chuỗi chung `engine.bad_target_guard_error_code` (mặc định `err_undefined`, ngưỡng 4), ghi chú "Dừng sau N data lỗi/thất bại liên tiếp (ngưỡng N): …" |
| Data đi đâu | `target_effect`, `requeue_after_minutes`, `remaining_steps` | `complete` / `requeue` / `requeue_after` / `hold`; các bước còn lại của data này `continue` / `skip`. Data xong khi có kết quả `skip` hoặc runtime chốt (`final`) |
| Khoá | `lock_action_codes[]`, `lock_mode`, `lock_minutes`, `lock_days`, `lock_time` | 4 chế độ hiện có, ghi vào `auto_account_action_status` (pg_cron sẵn có tự mở khoá) |
| Tính năng khác | `run_effect` | `continue` / `end_unit` / `stop_account` / `stop_campaign`; có hiệu lực **sau khi data hiện tại xong**, như `stopAfterTarget` hôm nay |
| Nghỉ | `pace_mode`, `pace_seconds` | `full` / `short` / `none`; gộp theo data lấy mức nặng nhất (full > short > none); chỉ nghỉ khi còn data đến hạn phía sau |
| Nhớ mục tiêu hỏng | `remember_target_days` | phạm vi tổ chức |
| Trạng thái chiến dịch / tài khoản | `campaign_effect`, `campaign_hold_minutes`, `account_effect`, `login_effect` | `none` / `hold` / `pause`; `none` / `pause`; `none` / `logged_out` / `checkpoint` |

### 3.4 Seed giữ nguyên hành vi hiện tại

Mỗi dòng `auto_error` đang bật sinh ra đúng một chính sách theo mã:

| Cột cũ | Trường mới |
|---|---|
| `detail_status` / `detail_status_id` / `detail_mode` | `detail_mode`, `detail_status_id`. `detail_status` NULL trên Zalo nghĩa là không ghi lịch sử và trả data về hàng đợi (`campaignScheduler.ts:14598-14629`) |
| `counts_toward_limit` | `quota_effect` |
| `counts_toward_bad_target` | `target_streak_effect` |
| `count_consecutive_errors` | `streak_threshold` |
| `update_status_campaign` | `campaign_effect`: `tạm dừng` → `pause`, `chờ xử lý` → `hold` |
| `update_status_account` | `account_effect` |
| `update_login_status` | `login_effect` |
| `disable_action_*` | `lock_*` |
| `input_effect` | `target_effect` |
| `noti_running_process` / `noti_campaign` | `log_template` / `campaign_note_template` |

Ngoài ra (đã đối chiếu từng dòng với `ActionStatusCatalog.resolve`, `createZaloErrorDetail`, `applyZaloPolicySideEffects`, `handleCampaignBadTarget`):
- **Không ghi lịch sử thì không tính lượt, không đổi chuỗi lỗi** (nhánh suppressed của `resolve`; hạn mức ngày chỉ cộng khi có dòng lịch sử, `campaignRepository.ts:6386-6395`).
- **`run_effect = end_unit`** khi dòng cũ có bất kỳ hiệu ứng tài khoản / đăng nhập / khoá / chiến dịch nào (`stopAfterTarget`). **`remaining_steps = continue`**: bản cũ chỉ cắt bước còn lại khi media quá giờ hoặc không rõ kết quả (`stopRemainingActions`), đều là mã engine riêng.
- **`err_undefined`** (lỗi code) dựng riêng như `handleCampaignBadTarget`: ghi "lỗi", không tính lượt, tăng chuỗi, ngưỡng 4 rồi tạm dừng chiến dịch, bỏ bước còn lại.
- **Câu chữ:** `log_template` = `noti_running_process`, không có thì `noti_campaign` (như `renderZaloPolicyLog`). Trong ghi chú chiến dịch `[x]`/`[t]` là số phút khoá khi khoá theo phút (như `renderZaloPolicyCampaignNote`). `customer_title` = `error_name` (tên ngắn cho trang tra cứu và câu chờ).
- **Giao một phần luôn tính lượt** (như `partialDelivery`).
- `pace_mode = full`, vì hiện nay nghỉ sau mọi data.
- Mỗi dòng `auto_account_action_status_policies` sinh một chính sách theo trạng thái.
- **Facebook chưa khớp 1:1:** bản cũ bỏ cột đếm của `auto_error` với Facebook trừ `fb_add_friend` và mã có `detail_mode` (`actionResultRuntime.ts:151`), lúc đó đếm theo trạng thái. Seed hiện luôn đếm theo mã; sửa ở giai đoạn 5 trước khi bật Facebook.

## 4. Phục hồi: không gửi trùng, không khoá phải gỡ tay

### 4.1 Vòng một data

```text
claim_target_v1  ─▶  (tra số…)  ─▶  mark_sending_v1  ─▶  gọi nền tảng  ─▶  report_v1  ─▶  chỉ thị
     │ lấy data "chờ xử lý"         │ ghi dấu "sắp gửi"                       │ một giao dịch
     │ bằng SKIP LOCKED             │ (không ghi được thì không gửi)          │ idempotent theo result_key
```

| RPC | Việc làm |
|---|---|
| `aka_agent_engine_claim_target_v1(p_ctx)` | Kiểm nơi gọi đúng là nơi sở hữu tài khoản, cờ `use_new_zalo_runtime` với tài khoản Server, phạm vi nhân viên khi Desktop gọi; chờ (`legacy_busy`) khi bộ cũ còn giữ tài khoản hoặc một chiến dịch của tài khoản. Giữ chỗ tài khoản (lease có hạn, `auto_engine_leases`). Lấy một data "chờ xử lý" bằng `FOR UPDATE SKIP LOCKED` rồi chuyển "đang chạy". Kiểm cổng: khoá thao tác, hạn mức hiện có (tính trong DB bằng `aka_agent_engine_action_limit`, đúng công thức Desktop/VPS), mục tiêu đã nhớ. Ghi `schedule` = lúc nhận khi lịch còn là ngày cũ. Thao tác bắt buộc phải chờ thì không nhận data, hẹn `schedule` chiến dịch tới lúc mở kèm ghi chú có mã. Mở `auto_engine_target_runs`. Trả quyền cho từng thao tác (`allow` / `skip` / `wait`). Trigger phân quyền ứng dụng (V445) từ chối thì hoàn tác và trả `app_access_denied` |
| `aka_agent_engine_mark_sending_v1(run, lease, action, step_key)` | Ghi dấu "sắp gửi" và giữ chỗ hạn mức ngày. Lease mất hiệu lực thì trả `ownership_lost`, runtime **không được gửi** |
| `aka_agent_engine_report_v1(run, lease, outcomes, final, dry_run)` | Kiểm cả lô trước khi ghi (lô sai không ghi phần nào). Phân loại, gộp chính sách, áp bất biến an toàn, ghi lịch sử, hạn mức (giữ chỗ hoặc hoàn), chuỗi lỗi, khoá, nhớ mục tiêu, trạng thái data / chiến dịch / tài khoản. Lô rỗng + `final` = chốt data khi các bước còn lại bị bỏ; không bao giờ chốt data chưa có kết quả nào (`no_outcomes`). Trả chỉ thị, `pace`, `target.morePending`, `streak` |
| `aka_agent_engine_heartbeat_v1(account, lease)` | Gia hạn lease; trả trạng thái điều khiển (chiến dịch bị tạm dừng / xoá) |
| `aka_agent_engine_release_v1(account, lease)` | Nhả lease, trả chiến dịch về "chờ xử lý" nếu không còn data đang chạy |
| `aka_agent_engine_close_stale_v1()` | pg_cron mỗi phút: lease hết hạn quá `engine.stale_target_minutes` thì đóng data dở |

### 4.2 Bất biến an toàn (code, không cấu hình)

- **Không về hàng đợi khi đã gửi được gì.** Data đã có bước giao hàng thành công, giao một phần, hoặc không rõ kết quả thì `requeue` / `requeue_after` bị hạ thành `complete`. `policy_snapshot.safety` ghi lý do.
- **Dấu "sắp gửi" được giải quyết theo kết quả:**
  - `before_send`, hoặc `after_send` bị từ chối mà không giao một phần: chưa giao gì, data vẫn được về hàng đợi.
  - `in_flight`: không rõ kết quả, coi như có thể đã giao.
- **Kết quả của thao tác đã xảy ra luôn được ghi**, kể cả khi lease đã mất. Khi đó chỉ thị là `ownership_lost` và bỏ qua hiệu ứng chiến dịch / tài khoản. Nếu lượt chạy data chưa bị pg_cron đóng, kết quả gửi bù chốt data đúng kết quả thật; đã đóng thì chỉ ghi lịch sử, không đếm lại chuỗi lỗi.
- **Gọi lại cùng `result_key` trả lại đúng chỉ thị cũ**, không gộp chính sách lần nữa.
- **Data vừa trả về hàng đợi không được nhận lại ngay trong cùng lượt:** chỉ thị bị nâng thành `end_unit` (tránh vòng lặp nóng).
- **Không có kết quả nào thì không chốt:** runtime phải báo `err_engine_no_outcome` (SYS07).

### 4.3 Data dở

pg_cron gọi `aka_agent_engine_close_stale_v1`. Data "đang chạy" có lease hết hạn quá `engine.stale_target_minutes` phút được đóng:

| Dấu "sắp gửi" | Kết quả |
|---|---|
| Có, chưa giải quyết | "hoàn thành" + SYS02 "Bị ngắt khi đang gửi, không rõ kết quả; không gửi lại để tránh trùng" |
| Không có | Theo `engine.stale_unsent_target_action`, mặc định `complete`: "hoàn thành" + SYS01 "Bị ngắt trước khi gửi". Đặt `requeue` thì trả về hàng đợi |

Cùng lúc, chiến dịch "đang chạy" không còn lease được trả về "chờ xử lý". Không ai phải gỡ token.

### 4.4 Lỗi hạ tầng giữa chừng

Lỗi DB, mạng, Supabase sập:
- Runtime giữ kết quả trong nhật ký trên máy (`LocalJournal`), chờ có backoff, rồi gửi bù idempotent.
- Không đổi chiến dịch sang "tạm dừng".
- Tiến trình hiện "Mất kết nối máy chủ, đang chờ để chạy tiếp (DB01)".

## 5. Trạng thái: thêm mới chỉ bằng dữ liệu

| Loại | Quản lý | Thêm mới |
|---|---|---|
| Vòng đời: chờ xử lý / đang chạy / tạm dừng / hoàn thành | cố định, engine cần hiểu | không thêm |
| Trạng thái kết quả | `auto_status` | thêm dòng + chọn `parent_status_id` |
| Lý do / mã lỗi | `auto_error` | thêm dòng + khai `error_class` |

- **`auto_status` thêm cột** `parent_status_id`, `report_group`, `counts_as_delivered`, `progress_rank`. `aka_agent_status_semantics(status_id)` đi lên chuỗi cha để lấy giá trị thật. Trạng thái mới kế thừa chính sách của trạng thái gốc vì `resolve_policy` duyệt cả chuỗi cha.
- **Gán theo sự kiện sau khi gửi:**
  - Bảng `auto_status_event_rules` (sự kiện → trạng thái).
  - Hàm `aka_agent_engine_apply_status_event_v1(detail, event)` đặt `sub_status_id` khi `progress_rank` mới cao hơn trạng thái đang có.
  - Không áp lại hạn mức.
- **Bảo vệ bản cũ:** trạng thái mới không được trùng `status_value`, vì bản 8.2+ báo `status_value_ambiguous` (`src/shared/actionStatusPolicy.ts:132-137`).
- **Đi cùng V494 (trạng thái hệ thống, phiên khác, apply 11/11 sau V495):** mỗi trạng thái kết quả còn có `system_status_code`
  (thành công / thất bại / bỏ qua / dừng / lỗi / chờ; CHECK bắt buộc). Thêm trạng thái mới phải chọn cả trạng thái hệ thống lẫn
  trạng thái gốc, cùng nhóm báo cáo. V514 có trigger `auto_status_system_group_guard_v514` ép điều đó lúc ghi.
- **Trạng thái theo mã lỗi nằm ở hai chỗ:** bộ chạy cũ đọc `auto_error.detail_status` (hoặc `detail_mode='override'` +
  `detail_status_id`), engine đọc `auto_outcome_policies.detail_status_id` và không đọc `auto_error`. Đổi trạng thái của một
  mã thì sửa cả hai; `aka_agent_engine_policy_lint` báo `detail_status_differs_from_auto_error` khi hai bên lệch (V514; 12/11 trên
  akachat 21/21 cặp mã × hành động khớp).

## 6. Mã công khai và tiến trình cho khách

- **Dòng tiến trình:** `<emoji> <câu tiếng Việt> (<public_code>)`, ví dụ "❌ Người nhận chặn tin nhắn từ người lạ (Z122)". Câu lấy từ `log_template` của chính sách, hoặc `customer_title` của mã.
- **Quy ước mã:**

| Tiền tố | Nguồn | Ví dụ |
|---|---|---|
| `Z` + số Zalo | Zalo trả mã | Z122, Z216, Z221, Z802, Z600 |
| `NET` | mạng tới nền tảng | NET01 mất mạng, NET02 proxy, NET03 máy gửi (runtime Fly) chưa sẵn sàng |
| `DB` | máy chủ / DB của mình | DB01 |
| `SYS` | hệ thống, bị ngắt | SYS01, SYS02, SYS99 (`err_undefined`) |
| `CFG` | cấu hình chiến dịch | CFG01 media không dùng được, CFG10 Zalo Web chỉ gửi ảnh |
| `DAT` | dữ liệu một data | DAT01 |
| `FB` | Facebook | FB04 checkpoint, FB35 không thấy ô đăng bài |
| `EM` | Email | EM01 người nhận không tồn tại |
| `LIM` | hạn mức hiện có | LIM01 hạn mức ngày, LIM02 hạn mức giờ |
| `AUTH` | đăng nhập | AUTH01 |
| `UNK` | không rõ kết quả | UNK01 |
| `RUN` | điều phối | RUN01 bị dừng |

- **Trang tra cứu trên web** đọc view chỉ đọc `aka_agent_public_error_catalog` (mã, tiêu đề, cách xử lý). Thêm mã trong DB là trang có ngay.

## 7. Luật kiểm cấu hình dùng chung

`packages/campaign-engine/src/validation.ts` (`validateZaloContent`, `validateFacebookMedia`, `missingTemplateFields`, `validateRenderedTargetContent`):
- Mỗi luật là một hàm thuần, trả danh sách `ConfigIssue { errorCode, publicCode, scope, message, field, value }`. `message` chỉ đúng chỗ cần sửa (tên tệp, cột thiếu); chính sách của các mã `err_cfg_*` dùng `log_template = '{message}'` nên câu này đi thẳng vào tiến trình và ghi chú chiến dịch, kèm mã.
- Form Desktop, Web, form AI và engine cùng dùng. Engine kiểm một lần ở đầu lượt chạy (`UnitConfig.validateCampaign`); sai thì báo kết quả `before_send` với mã đó cho data vừa nhận: chiến dịch tạm dừng **một lần**, data về hàng đợi, không đốt data.
- Giới hạn tệp của Zalo (`max_file`, `restricted_ext_file`) do server trả theo phiên, nên host truyền vào; danh sách đuôi ảnh/video giữ đúng `src/shared/mediaTypes.ts`.

Luật đầu tiên:

| Mã | Luật | Nguồn hiện tại (chỉ có lúc chạy) |
|---|---|---|
| CFG10 | Tài khoản Zalo Web chỉ gửi ảnh JPG/JPEG/PNG/WEBP/GIF | `src/main/services/zaloRuntimeService.ts:1887` |
| CFG11 | Zalo: quá số tệp cho một tin | zca-js `uploadAttachment` |
| CFG12 | Zalo: đuôi tệp bị chặn | zca-js `uploadAttachment` |
| CFG13 | Mẫu dùng biến mà dữ liệu thiếu cột, nên nội dung rỗng (báo theo data) | `campaignScheduler.ts:14765-14817` |
| CFG14 | Đăng fanpage bằng API chỉ hỗ trợ ảnh | `campaignScheduler.ts:10296` |
| CFG15 | Media Facebook / comment chỉ hỗ trợ ảnh hoặc video | `campaignScheduler.ts:10299`, `:10345` |

## 8. Dòng thời gian từng data

Nguồn, theo thứ tự thời gian:
1. `auto_engine_target_runs`: bắt đầu, dấu "sắp gửi", kết thúc.
2. `auto_campaign_details`: mỗi mốc, đã có.
3. `auto_engine_target_events`: chỉ các sự kiện không phải mốc, như chờ ≥ `engine.timeline_min_wait_seconds`, bị ngắt.
4. Sự kiện tương tác (v339).

Đọc qua `aka_agent_engine_target_timeline_v1(input_data_id)`, chỉ khi khách mở data. Không ghi từng bước giao diện.

## 9. Tương thích bản cũ

- **Cột mới trên bảng cũ đều nullable, không default** (chỉ đổi metadata).
- **Không thêm trigger** trên lịch sử, data hay chiến dịch.
- **Dòng `auto_error` mới của engine có `error_type = 'engine v2'`.** Bộ kiểm khi bắt đầu chạy của bản 8.2+ (`src/main/services/actionResultRuntime.ts:42-53`) và chat-sync chỉ xét dòng có `error_type` chứa tên nền tảng hoặc bằng `system`, nên bỏ qua các dòng này. Cột cũ ghi tường minh (NULL bị hiểu là "có tính hạn mức", `src/main/data/mappers.ts:196-197`).
- **Lịch sử do v2 ghi:**
  - để `action_status_policy_id` NULL, nên qua được `aka_agent_guard_detail_result_v361`;
  - có `status_id` hợp lệ;
  - `policy_snapshot.operationState` đúng như v1, nên chống gửi lặp (V367) vẫn đọc đúng.
- **Chiến dịch v2 không dùng `runtime_claim_token`.** Trong lúc chạy, chiến dịch ở "đang chạy", nên runner cũ (chỉ lấy "chờ xử lý") không lấy trùng. Lease hết hạn thì `close_stale` trả chiến dịch về "chờ xử lý".
- **Quyền:** RPC `SECURITY DEFINER`, chỉ cấp cho `service_role` và `aka_agent_chat_api` (Fly). Desktop được cấp ở giai đoạn 3, kèm kiểm phạm vi staff.

## 10. Thiết lập trong `auto_system_settings`

| Key | Mặc định | Ý nghĩa |
|---|---|---|
| `engine.lease_seconds` | 180 | hạn lease, heartbeat mỗi 60 giây |
| `engine.stale_target_minutes` | 10 | lease hết hạn bao lâu thì đóng data dở |
| `engine.stale_unsent_target_action` | `complete` | `complete` / `requeue` cho data dở chưa có dấu |
| `engine.timeline_min_wait_seconds` | 30 | chỉ ghi sự kiện chờ dài hơn mức này |
| `engine.bad_target_guard_error_code` | `err_undefined` | mã canh chuỗi data lỗi chung (ngưỡng + hiệu ứng lấy từ chính sách của mã này) |

## 11. Việc chưa làm ở giai đoạn 1 (ghi để không quên)

- **Tính năng của "Nhắn tin theo SĐT" chưa tách sang lõi** (chiến dịch dùng tính năng nào thì cả chiến dịch chạy bộ cũ, cùng bản cài): media, nội dung nâng cao, nội dung định dạng, AI viết lại, link từ chối nhận tin, loại trừ gửi, gắn tag/đổi tên Zalo, tag akaBiz, chống gửi lặp gần đây, kiêm gửi SMS, nhóm data, chế độ chia sẻ; và mọi chiến dịch khi đang bật theo dõi tương tác Zalo (`zalo.campaign_engagement.enabled`). Danh sách nằm trong `zaloMessagePhoneV2Support`.
- **Cấu hình hạn mức** (chiến dịch → nhóm tài khoản → trần gói Zalo; Tìm SĐT cố định 1.000; mặc định 30/ngày, 9 lượt/65 phút) tính trong DB bằng `aka_agent_engine_action_limit`, đúng công thức `getActionLimitConfig` + `resolveAccountActionLimitConfig` + `resolveAccountRateLimitStatus` (11/11/2026); bộ chạy không truyền hạn mức.
- **Chính sách Facebook / Email** mới seed 1:1. Riêng hành vi "bỏ qua cột đếm của `auto_error` với Facebook trừ `fb_add_friend`" (`src/main/services/actionResultRuntime.ts:151`) sẽ khớp ở giai đoạn mở rộng.
- **Hoàn tất chiến dịch:** chiến dịch "Nhắn tin theo SĐT" không có khung giờ, lặp lại hay realtime nên `aka_agent_engine_finish_campaign_v1` (hẹn lại theo data đến lịch sau, không thì "hoàn thành") khớp `handleCampaignCompletion` của Desktop; ngày kết thúc chỉ đổi câu tiến trình ("(hết ngày kết thúc)"). Loại có khung giờ / lặp lại / realtime phải tách logic hoàn tất trước khi chạy bộ mới.
- **Trigger thật trên bảng nóng:** đã đọc (06/11, mục 14.7). Đọc lại trước khi apply nếu production đổi schema.
- **Chưa có job dọn bảng vận hành** (`auto_engine_target_runs`, `auto_engine_outcomes`, `auto_engine_target_events`, dòng hết hạn của `auto_target_memory`, `auto_outcome_unmatched`): mỗi data sinh 1 dòng lượt + 1–4 dòng kết quả (JSON quyết định vài KB). Đề xuất giữ 30 ngày (dòng thời gian đọc từ đây); thêm trước khi chạy thật (11/11/2026, chờ anh quyết).

## 12. Lõi `packages/campaign-engine`

TypeScript thuần (ESM, NodeNext), không import Electron / Supabase / pg (`scripts/campaign-engine-boundary-check.cjs` chặn). **Lõi chứa toàn bộ logic chạy** (các bước của từng loại chiến dịch, dựng nội dung, câu tiến trình), tách từ bộ chạy Desktop/VPS; Desktop và Fly chỉ cài cổng (`EngineDataPort`, `LocalJournal`, `EngineClock`, `EngineEvents`, `ZaloMessagePhonePort`).

| File | Việc |
|---|---|
| `contracts.ts` | `Signal`, `RawOutcome`, `ReportOutcome`, phản hồi của các RPC, các cổng |
| `boundary.ts` | `withDeadline` (hạn giờ + huỷ, dọn timer), `isTransientDbError`, `stepFailure` (ngoại lệ → kết quả; bước gửi → `in_flight`) |
| `validation.ts` | luật kiểm cấu hình dùng chung (mục 7) |
| `journal.ts`, `reporter.ts` | ghi nhật ký trước rồi gửi; DB lỗi tạm thời thì chờ có backoff; gửi bù khi chạy lại; `reportOnce` khi đang dừng |
| `pacing.ts`, `clock.ts` | nghỉ theo `pace` của DB; đồng hồ thật huỷ được |
| `progress.ts` | câu tiến trình **đúng như Desktop** (`🚀 Bắt đầu chiến dịch…`, `▶️ Xử lý "<data>"…`, `<thao tác>: <câu>` như `formatZaloProgressLog`, `⚠️` khi không ghi lịch sử, `🚫 Bỏ qua "<data>": …`, `✅ Hoàn thành "<data>"`, `⏳ Nghỉ Ns…`, `⚠️ Bỏ qua <thao tác> vì đã đạt giới hạn: …`, `✅ Hoàn thành chiến dịch…`), cộng mã ngắn ở cuối dòng lỗi |
| `runUnit.ts` | một lượt: gửi bù → nhận data → kiểm cấu hình (lần đầu) → các bước → báo kết quả → chỉ thị → nghỉ; heartbeat có huỷ; dừng mềm sau data đang xử lý (`shouldStopAfterTarget`) |
| `content/*` | **Chép nguyên văn từ Desktop** (`src/shared/campaignContentTemplate.ts`, `contentSpin.ts`, `zaloMessageOptOut.ts`, `campaignContentPreparation.ts`, `phone.ts`, `src/main/services/zaloPhoneSearch.ts`); script ranh giới báo lỗi khi lệch từng byte. Sửa ở Desktop rồi chép lại |
| `zalo/common.ts` | chuẩn hoá hồ sơ như `normalizeFoundUser`/`normalizeZaloTarget`, nhãn `getZaloTargetLabel`, dựng mẫu `renderZaloTemplateText`, `ZaloPortError` + `zaloPortErrorFrom` (mã số = mã Zalo, mã chữ = errno, không mã = câu lỗi, như `getZaloErrorCode`) |
| `zalo/messagePhone.ts` | "Nhắn tin theo SĐT": chọn bộ mới (`zaloMessagePhoneV2Support`), thao tác claim (`zaloMessagePhoneClaimPlan`), nhãn data, giây nghỉ (`sleepBetweenActionsSeconds`), các bước tra số (32 rồi 40 bằng `searchZaloPhone`) → cổng từ chối nhận tin → nhắn tin → kết bạn (chạy cả khi nhắn tin lỗi, cắt 150 ký tự) |

Bất biến của `runUnit`:
- **Bước gửi (`delivery: true`) chỉ gọi nền tảng sau khi DB xác nhận dấu "sắp gửi".** DB báo mất quyền thì không gửi và không nhả lease của người khác. Script ranh giới chặn lệnh gửi ngoài bước `delivery: true` (cả trong lõi lẫn adapter).
- **Bước có `requires`** chỉ chạy khi bước phụ thuộc thành công; bước bị cổng bỏ qua không tính là thành công. Hết bước mà DB chưa chốt thì chốt bằng lô rỗng, chưa có kết quả nào thì báo SYS07.
- **Dừng từ ngoài** (thoát app, đăng xuất): báo "đã dừng" (RUN01) cho bước sắp chạy để DB chốt đúng (chưa giao → về hàng đợi; đã giao hoặc không rõ → hoàn thành). Heartbeat thấy chiến dịch tạm dừng / tài khoản đăng xuất, hoặc nơi chạy yêu cầu dừng mềm (nút Tạm dừng của Desktop còn trong RAM), thì dừng sau data đang xử lý.
- `result_key = v2:<target_run_id>:<step_key>` nên gửi bù luôn idempotent.
- **Bước `gate`** (cổng kiểm: từ chối nhận tin, sau này loại trừ gửi) không ghi dấu "sắp gửi" và không chịu khoá/hạn mức của thao tác nó canh: qua thì không báo kết quả nào; chặn thì báo đúng một kết quả, DB quyết định data đi đâu.
- **Hết data** (`no_target`) khi còn giữ lease thì gọi `onNoTarget` của nơi chạy (kết thúc / hẹn lại chiến dịch, hoặc chờ nguồn tìm data như Desktop); lỗi chỉ ghi vết, lease vẫn được nhả.

## 13. Kiểm chứng ở local

Chạy tất cả (PostgreSQL 17 Homebrew + module `pg`; smoke Desktop tự chạy lại dưới Electron để nạp better-sqlite3 của app):

```bash
node scripts/campaign-outcome-engine-check-all.cjs
```

| Script | Nội dung |
|---|---|
| `scripts/campaign-outcome-engine-sql-smoke.cjs` | Fixture dựng từ ảnh chụp schema + danh mục thật (`scripts/fixtures/campaign-outcome-engine/akachat-catalog-20261106.json`, không dữ liệu khách). Apply trong transaction rồi ROLLBACK, apply thật, chặn apply lần hai; lint; quyền/RLS; 385 cặp mã Zalo × thao tác phân loại khớp `getZaloErrorPolicyByCode`; mọi cặp mã × thao tác khớp `ActionStatusCatalog.resolve` **và Fly giống hệt Desktop**; nhận data, gửi bù, khoá, lease hết hạn, SYS01/SYS02, hai runner, ngưỡng chung, dry run, trạng thái mới chỉ bằng SQL, sự kiện sau khi gửi, nhớ mục tiêu; điều kiện nhận lượt, nội dung xoay vòng, OPT01, kết thúc chiến dịch, cổng `on_error`, tín hiệu engine ra đúng mã Desktop; hạn mức đúng công thức Desktop; phạm vi nhân viên Desktop; chạy cùng bộ cũ; rollback rồi apply lại (35 nhóm) |
| `scripts/campaign-outcome-engine-core-smoke.cjs` | Lõi build bằng `tsc`; kiểm đơn vị; `runUnit` trên RPC V495 thật; **các bước thật của "Nhắn tin theo SĐT" với cổng Zalo giả**: câu tiến trình, tên thao tác, lịch sử, xoay nội dung + biến mẫu, từ chối nhận tin (không nghỉ), không kiểm được thì cảnh báo rồi vẫn gửi, 122 vẫn kết bạn, reqSrc 40, mạng lỗi khi gửi, thiếu SĐT, hết lượt nhắn tin + "tiếp tục khi chạm giới hạn", lưu hồ sơ lỗi, tài khoản QR trên Desktop (23 nhóm) |
| `scripts/campaign-engine-desktop-smoke.cjs` | **Bộ chạy Desktop thật** (`src/main/engineAdapters`, dựng bằng esbuild) trên RPC V495: chọn bộ mới, chạy hết danh sách như bộ cũ, lỗi zca-js (122, 221 → reqSrc 40, mạng), nút Tạm dừng khi đang chạy, thoát app giữa lúc gửi, chờ nguồn tìm data, nhật ký SQLite thật trống sau khi xác nhận (6 nhóm) |
| `scripts/legacy-catalog-validator-smoke.cjs` | `ActionStatusCatalog` đúng mã của Desktop 8.2.0, 9.3.0, HEAD và chat-sync; 20 loại chiến dịch qua bộ kiểm lúc bắt đầu chạy trên danh mục sau V495; có đối chứng âm |
| `scripts/campaign-engine-boundary-check.cjs` | catch rỗng, lời gọi DB không hạn giờ, promise trôi nổi, `setInterval`, lõi import Electron/Supabase/pg, lệnh gửi ngoài bước `delivery`, **bản chép nguyên văn lệch Desktop** |
| `scripts/campaign-outcome-engine-review-table.cjs --write` | Sinh lại bảng mã trong tài liệu duyệt 1b từ chính sách thật |

## 14. Nơi chạy: Desktop (bản cài mới) và Fly (cờ tổ chức), chỉ ở local, chưa phát hành / deploy

Không có công tắc theo loại chiến dịch hay công tắc tổng. **Desktop** chạy bộ mới theo bản cài (tài khoản Zalo QR/Web của máy). **Fly** chạy bộ mới cho tổ chức bật `org_organization.use_new_zalo_runtime` (V371). VPS giữ bộ cũ. Trong cả hai nơi, chiến dịch dùng tính năng chưa tách (mục 11) chạy bộ cũ.

### 14.1 Thêm vào V495 cho nơi chạy

| Phần | Nội dung |
|---|---|
| Điều kiện nhận lượt trong `claim_target_v1` | `runtime_not_owner` (Fly chỉ nhận tài khoản Zalo Server không phải Zalo Web; Desktop không nhận tài khoản Zalo Server), `not_enabled` (Fly: tổ chức chưa bật cờ), `account_logged_out`, `app_access_denied`, `staff_time_blocked`, `legacy_busy` (bộ cũ còn giữ tài khoản/chiến dịch), phạm vi nhân viên Desktop (`private.aka_agent_staff_scope_for_request()`) |
| Mốc ngày | `daily_boundary`: qua giờ dừng trong ngày thì không nhận data tới 0:00 hôm sau; lease mở từ ngày trước thì chỉ kết thúc lượt |
| `requireAny`, `skippableGates` | "Tiếp tục khi chạm giới hạn" như `preflightActions` |
| Câu chờ trong quyết định cổng | Quyết định "chờ" của từng thao tác kèm `note` (lý do, giờ chạy tiếp, mã) cho dòng `⚠️ Bỏ qua <thao tác> vì đã đạt giới hạn: …` và `⚠️ Chưa thể chạy chiến dịch: …` |
| Tên thao tác | Kết quả gửi kèm `actionName` của bước ("Tìm SĐT", "Nhắn tin người lạ", "Kết bạn" như helper Desktop); DB ghi vào `auto_campaign_details.action_name` và trả lại trong quyết định |
| `aka_agent_engine_take_content_index_v1` / `finish_campaign_v1` / `enabled_orgs_v1` | Nội dung xoay vòng theo lease; kết thúc / hẹn lại chiến dịch; danh sách tổ chức bật cờ cho Fly |
| Tín hiệu engine cho mã app tự đặt | `target_missing_identity` (thiếu SĐT → 114 như Desktop), `find_user_without_uid` (Zalo không trả hồ sơ có UID → 216), `empty_content` (tin rỗng → luật bắt-tất-cả Z999, như Desktop gửi rồi zca-js báo "Missing message content"), `db_unavailable` (NET03), `gate_unavailable` (SYS08) |
| Nghỉ sau data bị chặn | Tra SĐT thành công không tự gây nghỉ (`pace_mode='none'` cho trạng thái thành công × `zalo_find_phone_user`): nghỉ theo bước gửi; data bị cổng từ chối nhận tin chặn thì không nghỉ, như Desktop |
| Tra số không rõ kết quả | `err_engine_unknown_delivery` × `zalo_find_phone_user`: chưa gửi gì nên data về hàng đợi (chỉ Fly có tín hiệu này) |
| Không còn chính sách riêng Fly | Bỏ `seed_v495_fly` (Fly bản cũ bỏ các bước còn lại khi lỗi): Fly bộ mới chạy giống hệt Desktop; smoke kiểm hai nơi cho cùng chính sách |

### 14.2 Desktop (`src/main/engineAdapters/`)

| File | Việc |
|---|---|
| `desktopEngineRunner.ts` | `DesktopEngineRunner`: chọn bộ mới (tài khoản Zalo QR/Web + `zaloMessagePhoneV2Support`), chạy một lượt của lõi, ghi tiến trình tuần tự bằng `logCampaignProgress`, báo giao diện khi nhận lượt và khi xong, chờ nguồn tìm data như `getFindDataSourceWaitNote`, hoàn tất nút Tạm dừng sau data đang xử lý bằng `completeReleasedDesktopCampaignPause` |
| `desktopZaloPort.ts` | cổng Zalo qua `zaloRuntimeService` (thêm `findUserByPhoneOnce`: một lần tra với reqSrc, lõi tự quyết thử 40) và repository hiện có; lỗi zca-js có mã hoặc `ZaloApiError` = Zalo đã trả lời (`after_send`), lỗi mạng / quá giờ = không rõ (`in_flight`) |
| `desktopEngineData.ts` | RPC V495 qua Supabase client của phiên, có huỷ; lỗi giữ mã PostgREST và HTTP status |
| `desktopEngineJournal.ts` | nhật ký SQLite riêng (`userData/local-data/campaign_engine_journal.db`, `synchronous=FULL`), theo nhân viên + tài khoản; nạp better-sqlite3 lười để App Server (dùng chung bộ lập lịch) không cần |
| `campaignScheduler.ts` | Chỉ Desktop tạo bộ chạy mới; hàng đợi tài khoản (`runAccountCampaignQueue`) chạy chiến dịch được chọn bằng bộ mới, bộ cũ bỏ qua chiến dịch đó; `stop()` dừng ngay các lượt bộ mới (đăng xuất/thoát dọn dẹp sau khi bộ mới đã dừng) |

### 14.3 Fly (`akaAgentChatApi`)

| File | Việc |
|---|---|
| `packages/campaign-engine` | bản chép nguyên văn lõi + V495 + fixture (`node scripts/sync-campaign-engine.cjs --to <ChatApi>`; `vendor.test.ts` chặn sửa tay) |
| `packages/database/src/campaignEngineRepository.ts` | `EngineDataPort` qua pool hiện có + `enabledOrganizations` (DB chưa có V495 → null, mọi chiến dịch chạy bộ cũ), `businessNow`, `takeContentIndex`, `finishCampaign`, `updateResolvedTarget` |
| `apps/system-worker/src/campaignEngine/flyZaloPort.ts` | cổng Zalo qua lệnh runtime (`campaign_find_user`, `send_text`, `send_friend_request`), khoá chống trùng `v2-<target_run_id>` + bước; `CampaignCommandError` → tín hiệu (mã số = mã Zalo, `zalo_command_failed` = lỗi Zalo không mã, còn lại = mã lệnh Fly; `deliveryUncertain` → `in_flight`) |
| `apps/system-worker/src/campaignEngine/flyEngineRunner.ts` | đọc tổ chức bật cờ tối đa mỗi phút, chọn chiến dịch, chạy lõi dưới cùng khoá leader với bộ cũ, ghi tiến trình, hoãn tìm lại khi lượt không làm được gì |
| `zaloCampaignScheduler.ts`, `main.ts` | chiến dịch được bộ mới nhận thì bỏ qua preclaim/claim cũ; không còn biến môi trường bật/tắt |

**Nhật ký trên Fly ở RAM** (`MemoryJournal`): DB lỗi thì kết quả chờ trong RAM và được gửi bù; tiến trình chết thì `close_stale` đóng data dở (SYS02 nếu đã có dấu "sắp gửi"), không gửi lại.

### 14.4 Chỗ bộ chạy cũ của ChatApi khác chuẩn Desktop (Fly bộ mới đổi theo Desktop)

Khách của tổ chức bật cờ sẽ thấy các thay đổi này khi chuyển sang bộ mới (đọc code 11/11, `zaloCampaignExecutor.ts`, `zaloCampaignScheduler.ts`):

| # | Tình huống | Fly bản cũ | Desktop = Fly bộ mới |
|---|---|---|---|
| D1 | SĐT không đúng dạng `^\+?[0-9]{9,15}$` nhưng không rỗng | Tự đặt 114, không gọi Zalo | Chỉ chặn SĐT rỗng (114); SĐT khác vẫn gửi Zalo tra, Zalo trả mã gì ghi mã đó |
| D2 | Bước lỗi không ghi lịch sử hoặc có khoá / đổi trạng thái (802/120, 221…) | Bỏ các bước còn lại của data (vd không kết bạn) | Chạy tiếp các bước còn lại, dừng lượt sau data đó |
| D3 | Tin nhắn rỗng sau khi dựng mẫu | 114 | Lỗi Zalo không mã (Z999, "Nhắn tin người lạ thất bại: …"), như zca-js báo "Missing message content" |
| D4 | Câu lịch sử / tiến trình | "Đã tìm thấy SĐT …: Tên." (có dấu chấm, nhãn tên → UID) | Không dấu chấm, nhãn tên hiển thị → tên Zalo → SĐT → UID; dòng thao tác "Tìm SĐT: …", "Nhắn tin người lạ: …", "Kết bạn: …"; mã ngắn ở cuối dòng lỗi |
| D5 | Không kiểm được danh sách từ chối nhận tin | Cảnh báo vào log và nối vào ghi chú data | Cảnh báo vào log (ghi chú data không nối thêm) |
| D6 | Người nhận từ chối nhận tin | Ghi chú không có mã | Ghi chú và dòng "🚫 Bỏ qua …" thêm "(OPT01)" |

Tiền đề không đổi: nghỉ giữa 2 data (nhóm tài khoản → chiến dịch → 0) và cách đọc hồ sơ tra số (cùng endpoint `friend/profile/get`) giống nhau ở hai nơi.

### 14.5 Kiểm chứng phía ChatApi

`npm run verify` (typecheck + toàn bộ test), gồm: bản chép khớp nguồn; cổng Fly (đổi lỗi lệnh thành tín hiệu, khoá chống trùng, chuẩn hoá hồ sơ, lưu hồ sơ, gửi chữ/kết bạn); bộ chạy trên PGlite với RPC V495 thật (đúng câu tiến trình Desktop, tên thao tác trong lịch sử, từ chối nhận tin; dừng giữa lúc gửi không gửi lại; DB lỗi khi báo kết quả gửi bù đúng một lần kèm DB01; chỉ cờ tổ chức chọn bộ mới, theo dõi tương tác bật thì chạy bộ cũ, DB chưa có V495 thì không bật gì; chờ nguồn tìm data; thiếu SĐT ra 114; cổng `on_error=closed` không gửi); repository (cờ tổ chức, RPC); scheduler rẽ nhánh.

### 14.6 Trước lần chạy thật đầu trên Fly

1. Anh duyệt bảng 1b (`docs/CAMPAIGN_OUTCOME_ENGINE_REVIEW_ZALO.md`) và danh sách khác biệt 14.4.
2. Kiểm lại số migration ngay trước khi apply (11/11: ledger tới V493, V494 đã dùng ở một nhánh git, V495 trống).
3. Kiểm tra chỉ đọc (mục 14.7) nếu production đổi schema hoặc trigger của các bảng V495 đụng tới.
4. Apply ngoài giờ cao điểm (khi anh bảo "làm"): [V496](../migrations/migration_v496_new_zalo_runtime_default_off.sql) tắt trigger ép bật cờ của V371 và đổi mặc định của cột về `false` (không sửa dòng tổ chức nào; `node scripts/test-v496-new-zalo-runtime-default.cjs` 6 nhóm), rồi V495. Hai migration độc lập, code cũ chạy y như trước.
   - **V496 đã apply akachat 11/11 16:10:27 VN** (`20261111091027 / migration_v496_new_zalo_runtime_default_off`; không apply lại). Anh bảo làm ngay nên apply trong giờ cao điểm chiều. Trigger thành `D`, mặc định `false`, md5 sổ = file `d5677641…`. Cách apply: `supabase db query --linked -f` chạy nguyên văn file, dòng sổ chèn trước `COMMIT` của file trong cùng giao dịch. PostgREST nạp lại schema mất 9 giây (truy vấn schema 5,7 giây); phút đó p50 50 → 117 ms, p99 230 → 1.541 ms, 0 lỗi 5xx. [Biên nhận](../migrations/snapshots/new-zalo-runtime-default-off-v496/apply-receipt.json).
   - **V495 đã apply akachat 11/11 16:53:39 VN** (`20261111095339 / migration_v495_campaign_outcome_engine`; không apply lại; md5 sổ = file `e313b993…`). Kiểm trước: 12 bảng khớp fixture, chỉ có thêm cột `auto_campaigns.web_campaign_form`. Kiểm sau: 11 bảng, 31 hàm, 154 chính sách, lint 0, job `aka-agent-engine-close-stale`, `aka_agent_engine_enabled_orgs_v1()` = [526].
   - **Sự cố khi apply V495:** `ALTER TABLE` trên `auto_error`/`auto_account_actions`/`auto_status` giữ khoá ACCESS EXCLUSIVE suốt giao dịch, khoảng 7 giây. Hậu quả:
     - 13 lượt Desktop đọc `auto_error` bị quá giờ;
     - 5 lượt `aka_agent_write_action_result_v1` bị deadlock, và bộ chạy cũ chuyển 5 chiến dịch sang "tạm dừng": 48793, 53644, 53293, 27655, 49494. Data dở được đóng, không gửi trùng.

     Chi tiết và đề xuất khắc phục ở [biên nhận](../migrations/snapshots/campaign-outcome-engine-v495/apply-receipt.json). Bài học: lệnh ALTER bảng danh mục phải nằm trong giao dịch riêng, thật ngắn.
5. Đặt lại cờ `use_new_zalo_runtime` về `false` cho các tổ chức đang bật. **Đã làm 11/11 14:45:06–14:45:22 VN theo yêu cầu** (trước V495 và V496): 692 tổ chức, 7 lô 100 dòng; bật riêng tổ chức 526 lúc 14:45:38, nên chỉ còn `[526]` bật cờ. Mỗi UPDATE chạy `trg_sync_organization_orders`, gọi upsert `aka_order` cho từng gói; upsert chỉ ghi khi bản chiếu khác, và cờ không nằm trong bản chiếu. Chạy thử trong giao dịch tự huỷ: 0 đơn đổi, 2,6 giây. Sau khi làm thật: 0 đơn đổi. [Biên nhận + SQL khôi phục](../migrations/snapshots/engine-v2-flag-reset-20261111/receipt.json). Trước khi V496 có hiệu lực, trigger còn bật cờ cho 6 tổ chức tạo 15:03–16:08 (2089–2094); **16:11:07 VN đã tắt lại** sau V496 (chạy thử: chỉ ghi 6 dòng `org_organization`, 0 đơn đổi), chỉ còn `[526]`; [biên nhận](../migrations/snapshots/engine-v2-flag-reset-20261111/receipt-after-v496.json). Từ V496 tổ chức mới không bị bật cờ nữa.
6. Apply [V497](../migrations/migration_v497_zalo_server_flag_route.sql) ngoài giờ cao điểm (mục 14.8). Hàm App Server dùng trả y như cũ kể cả khi đang có tổ chức bật cờ (migration tự so trước/sau): App Server chỉ thả tổ chức khi ChatApi đã nhận. **Đã apply akachat 11/11 17:02:25 VN** (`20261111100225`; không apply lại; md5 sổ = file `cded4e05…`; 0 lỗi 5xx; App Server vẫn giữ 526 tới khi ChatApi mới nhận; [biên nhận](../migrations/snapshots/zalo-server-flag-route-v497/apply-receipt.json)).
7. Deploy ChatApi nhóm `api` và `worker` (`flyctl deploy --app aka-agent-chat-api --process-groups api,worker`; tổ chức có Chat chỉ cần `worker`, nhưng tổ chức không Chat cần cả phần phát lệnh và chọn tài khoản cho runtime ở chat-api). Không tổ chức nào bật cờ nên không đổi gì; deploy trước V497 cũng không đổi gì (ChatApi tự dò V497).
   - Fly cập nhật image trên máy `api` và máy `worker` đang có, giữ ID máy (kiểu mặc định rolling; `fly.toml` không có `[deploy]` hay `release_command` nên không dựng máy phụ), dừng tiến trình cũ tối đa 220 giây. `zalo_runtime` giữ nguyên, vì khởi động lại nó làm rớt mọi phiên Zalo.
   - Kiểm nền dựng: commit trong tag image của `flyctl status` (`worker-api-<sha>-<ngày>`) so với nhánh dựng. 11/11: máy chạy `e16725c` (08/11), `dev` đi trước 10 commit chưa deploy, ít nhất 4 đổi code worker (chatbot, mở lại hội thoại, giờ làm việc). Dựng từ `dev` là đưa chúng lên cùng v2 trong khi `api` vẫn bản cũ. **Chốt 11/11: dựng từ commit đang chạy cộng đúng phần v2.** Đã thử trên `e16725c`: áp sạch, typecheck và 162/162 file test đạt. Hai file integration đọc fixture ở `../akaAgent`, nên checkout dùng để dựng phải nằm cạnh checkout akaAgent.
   - **Bản deploy đã dựng 11/11 16:20–16:40** (có cả phần mục 16), chưa commit:
     - Nơi dựng: worktree `/Users/lequangnhut/Repos/akaAgentChatApi-deploy-v2`, nhánh `deploy/campaign-engine-v2-e16725c` tách từ `e16725c`.
     - Nội dung: áp nguyên thay đổi của worktree `akaAgentChatApi-campaign-engine-v2` bằng `git apply --3way` (24 file sửa, không xung đột; 41 file mới), cộng một dòng Dockerfile chép `packages/campaign-engine/package.json`. Dòng này không bắt buộc (`npm ci` vẫn tạo liên kết tới gói theo lockfile), chỉ để giống các gói khác.
     - Đã kiểm:
       - typecheck đạt; 164/164 file test đạt (2.296 test, bỏ qua 2);
       - bản chép lõi khớp nguồn (23 file);
       - chạy lại stage build của Dockerfile ở thư mục sạch bằng npm 10.9.2 (bản trong image) và npm 11: `npm ci`, `npm run build` đều đạt, và nạp được gói lõi cùng các hàm mới.
     - Lệnh deploy, chạy trong thư mục dựng: `flyctl deploy --app aka-agent-chat-api --process-groups api,worker --image-label worker-api-<sha>-<ngày>`. Máy này không có Docker nên flyctl dựng image bằng remote builder.
     - Deploy trước V495/V497 không đổi gì, vì ChatApi tự dò hai migration mỗi phút. Khi V497 và bản này đều đã lên mà 526 đang bật cờ, tài khoản 2445 tự chuyển sang Fly.
   - **Đã deploy 11/11 17:03:26–17:05:15 VN**: image `worker-api-e16725c-v2-20261111`; `api` và `worker` lên v172; `zalo_runtime` giữ v155. Rollback: deploy lại image `worker-api-e16725c-20261108` cho hai nhóm này.
     - Khoá leader tự chuyển sang worker mới, không phải gỡ tay. Không có lệnh `waiting_socket` mới; chiến dịch chat-sync chạy tiếp.
     - Tài khoản 2445 của tổ chức 526 tự chuyển sang Fly: dòng chờ lúc 17:05:04, VPS thả 17:05:44, chép phiên 17:05:49, runtime sẵn sàng 17:05:50. Không phải quét QR lại, nghĩa là Zalo chấp nhận phiên dùng trên máy Fly.
     - Tổ chức 526 không bị ghi dữ liệu Chat nào: 0 hội thoại, 0 danh bạ, 0 sự kiện; 65 sự kiện runtime đều được bỏ qua, không lỗi.
     - [Biên nhận](../migrations/snapshots/engine-v2-chatapi-deploy-20261111/receipt.json).
   - **Lần chạy thật đầu tiên: 11/11 17:16:26–17:16:59 VN**, chiến dịch 9150 của tổ chức 526, "Nhắn tin theo SĐT" chỉ có chữ, 2 số nội bộ. Worker Fly giữ lease tài khoản 2445 rồi chạy từng data: tra SĐT, ghi dấu "sắp gửi", gửi tin, báo kết quả.
     - 4 kết quả `v2:<lượt>:lookup|message` đều thành công, nghỉ 30 giây giữa 2 data.
     - Câu nhật ký và lịch sử đúng như Desktop/VPS. Chiến dịch "hoàn thành", nhả lease.
     - Không gửi trùng: mỗi data đúng một lệnh `send_text`.
     - Chưa thử: kết bạn, ca lỗi, mất kết nối giữa chừng.
     - [Biên nhận](../migrations/snapshots/engine-v2-org526-first-run-20261111/receipt.json).
   - **Lần chạy thứ hai: 11/11 20:17:13–20:17:48 VN**, chiến dịch 32956 của 526, nhắn tin kèm kết bạn tới 2 số.
     - Số thứ nhất: tra SĐT, nhắn tin, gửi lời mời kết bạn đều thành công.
     - Số thứ hai: tra SĐT và nhắn tin thành công; bước kết bạn trả `err_zalo_already_friend` (lịch sử "đã là bạn bè", ghi chú data "Đã là bạn bè (Z225)").
     - Câu tiến trình "Kết bạn: …" giống Desktop. Chiến dịch hoàn thành, nhả lease.
     - [Biên nhận](../migrations/snapshots/engine-v2-org526-second-run-20261111/receipt.json).
   - Chỉ merge v2 vào `dev` của ChatApi sau bước 5. Fly chọn tổ chức qua `aka_agent_engine_enabled_orgs_v1()` của V495 (đọc lại mỗi 60 giây; chưa có hàm thì chạy bộ cũ), nên khi V495 đã apply mà cờ chưa đặt lại, bất kỳ lần deploy `dev` nào cũng cho các tổ chức chat-sync đang bật cờ chạy v2 ngay.
   - Sau deploy kiểm khoá leader trong `pg_locks`: phiên Supavisor cũ có thể còn giữ khoá, khi đó worker mới không lên leader.
8. Bật cờ cho tổ chức thử 526 (không Chat). Theo dõi: App Server dừng runtime (≤ 60 giây + ≤ 30 giây chờ việc dở), mốc `vps_released_at`, ChatApi chép phiên (log `zalo_server_handoff_to_fly`), runtime Fly nối tài khoản 2445; rồi `auto_outcome_unmatched`, data kẹt, lỗi 5xx, không có dòng Chat mới của 526. Tắt một tổ chức = đặt cờ về `false` (ChatApi trả phiên, App Server nhận lại).
   - Tổ chức 526 (tổ chức thử, bật cờ 11/11 14:45:38) **không có Chat**: cả 8 gói `is_chat_sync=false`, `aka_agent_app_access_chat_runtime(526, true)` trả false. Vì vậy tài khoản Server của 526 chạy trên VPS và worker Fly không nhận chiến dịch của 526. Anh muốn thử đúng tổ chức không Chat này, nên phải làm trước phần định tuyến theo cờ (kế hoạch mục 11: hàm định tuyến trả thêm tổ chức bật cờ có quyền Server, worker và runtime Fly nhận theo cùng luật, chuyển phiên VPS→Fly). Không bật Chat để thử. 11/11 14:58 tôi từng bật nhầm `is_chat_sync` của gói 635, và ChatApi lập tức đánh tài khoản Server 2445 "chưa đăng nhập". 15:07:38 đã tắt lại và xoá `zalo_session_last_verified_at` của 2445; VPS nối lại phiên cũ lúc 15:09:03, không phải quét QR ([biên nhận](../migrations/snapshots/engine-v2-org526-chat-20261111/receipt.json)). Desktop chạy bộ mới theo bản cài, không theo cờ.

### 14.7 Kiểm tra chỉ đọc trên akachat (06/11/2026 14:45 VN)

Ba truy vấn SELECT trên catalog/ledger qua `supabase db query --linked --workdir <checkout chính>` (worktree không link project), mỗi lần một truy vấn trả JSON; không ghi gì.

| Mục | Kết quả |
|---|---|
| Số migration | Ledger tới V472 (V461–V468, V471, V472); V495 chưa có trong ledger và git |
| Đối tượng V495 | Chưa có bảng/hàm/view/cột nào; preflight qua |
| Schema 12 bảng V495 đụng tới | Khớp hoàn toàn ảnh chụp fixture (cột, NOT NULL, default, ràng buộc); `auto_error`/`auto_status` trùng md5 (`e4c0cc49…`, `cb92fc43…`) nên mọi phép so khớp bản cũ đã chạy trên đúng danh mục production |
| Role, extension | `aka_agent_chat_api`, `service_role`, `anon`, `authenticated`, `aka_agent_desktop` có; `pg_cron` 1.6.4 (lịch `close_stale` sẽ được tạo) |
| Hàm claim gọi qua EXECUTE | `aka_agent_staff_time_allowed(bigint)`, `aka_agent_app_access_account_allowed(bigint,text)` đúng chữ ký |
| Guard trạng thái tài khoản | `guard_auto_account_runtime_operation_claim_token` chỉ xoá token thao tác khi đổi trạng thái, không chặn |
| Guard quyền dùng app | Báo `app_access_denied`, khớp nhánh bắt `app_access%` của claim; `private.app_access_held` tính cả tài khoản/chiến dịch "đang chạy" nên khi tắt quyền, lượt v2 được chờ xong data đang chạy như bản cũ |
| Guard sở hữu Desktop | `private.aka_agent_guard_parent_ownership` chỉ áp khi request có JWT Desktop; Fly không bị |
| Nhật ký cấu hình `trg_auto_table_log` | Chiến dịch: bỏ qua trạng thái, lịch, ghi chú, vị trí xoay vòng nên V495 không ghi thêm. `auto_error`: apply V495 ghi khoảng 230 dòng (cập nhật mã công khai/tên cho ~106 mã + ~15 mã engine mới), đúng chức năng |
| Guard danh mục v361 | Mã engine không có `detail_status_id`; V495 không đổi `component_type` |
| Thông báo trạng thái | v2 đổi "chờ xử lý" ↔ "đang chạy" cùng nhịp bản cũ (đầu/cuối lượt) |
| Cổng bảo trì ngày | Đếm chiến dịch "đang chạy" có lịch hôm trước: lượt v2 vắt qua 0:00 giữ cổng tới khi nhả (tối đa một data + thời gian nghỉ), như bản cũ |
| Khởi động worker `recover_server_zalo_running_state` | Đóng mọi data "đang chạy" của tài khoản Zalo Server thành "hoàn thành" + "Dừng đột ngột, không xác định kết quả; không tự thực hiện lại", không xét token. Chỉ chạy một lần cho mỗi chủ lúc khởi động, trước khi chủ đó được tìm chiến dịch, nên không đụng lượt v2 của process đang chạy; với process đã chết: không gửi lại (an toàn), chỉ khác ghi chú so với SYS01/SYS02; lượt chạy data trong engine mở tới khi pg_cron đóng. Lease của process đã chết còn tới 180 giây: process mới "busy", hoãn 1 phút |
| RPC tạm dừng `aka_agent_set_zalo_server_campaign_status` | Tạm dừng được chiến dịch "đang chạy" của v2; khoá chiến dịch rồi tài khoản, cùng thứ tự với claim của V495 |

**Đã sửa sau khi kiểm (06/11):** `daily_boundary` lý do `vietnam_day_changed` từng trả `nextAt` = 0:00 hôm sau (worker hoãn chiến dịch trọn một ngày); nay chỉ kết thúc lượt (`nextAt` = bây giờ). Smoke SQL kiểm cả hai: qua giờ dừng → 0:00 hôm sau giờ Việt Nam; qua ngày → bây giờ.

### 14.8 Định tuyến tổ chức không Chat sang Fly theo cờ (V497, kế hoạch mục 16; đã apply và deploy 11/11, đang thử với tổ chức 526)

- **Luật:** tài khoản Server của tổ chức chạy trên Fly khi tổ chức có Chat như cũ, hoặc khi `public.aka_agent_zalo_server_flag_route(org)` đúng: tổ chức bật cờ `use_new_zalo_runtime`, có gói 16/18 còn hạn, có quyền QR + Server (đúng điều kiện `discover_zalo_server_account_runtime_users` của App Server). Không sửa `aka_agent_app_access_chat_runtime` (màn Chat của Desktop/Web).
- **[V497](../migrations/migration_v497_zalo_server_flag_route.sql)** (sinh bằng `scripts/build-v497-sql.py` từ nguyên văn bản live đọc 11/11 ở `scripts/fixtures/zalo-server-flag-route/`; preflight md5 `b48a2ab3…`/`02c1541f…`, postflight `020a5b0a…`/`e51b1240…`):
  - hàm luật cờ (EXECUTE chỉ `service_role`, `aka_agent_chat_api`);
  - `aka_agent_app_access_chat_organizations` (chỉ App Server gọi) thêm "ChatApi đã nhận tổ chức" (có dòng `to_fly`, mà ChatApi chỉ tạo cho tổ chức theo luật cờ): App Server thả tổ chức SAU khi dòng chờ đã có (mốc thả luôn có dòng để ghi), bật cờ khi ChatApi chưa sẵn sàng thì không đổi gì, và khi tắt cờ App Server chỉ nhận lại sau khi ChatApi đã trả phiên: không lúc nào hai bên cùng nối một tài khoản;
  - bảng `private.auto_zalo_server_session_handoff` (RLS bật, chỉ `aka_agent_chat_api`);
  - `recover_server_zalo_running_state` ghi mốc `vps_released_at` qua `private.aka_agent_zalo_server_mark_vps_released` (SECURITY DEFINER, EXECUTE chỉ `service_role`) khi `current_user = 'service_role'` và `p_require_server_mode` false: đúng lời gọi lúc App Server dừng runtime của nhân viên, sau `clearAll` ([zaloServerRuntimeManager.ts:1154](../src/server/main/zaloServerRuntimeManager.ts:1154)). Fly (lúc lên leader), Desktop và lúc App Server khởi động không ghi; lỗi ghi mốc chỉ cảnh báo, việc dọn của VPS vẫn xong.
  - Gỡ: [rollback](../migrations/rollback_v497_zalo_server_flag_route.sql) chặn khi còn dòng `to_fly` (tắt cờ, chờ phiên về VPS trước).
  - Kiểm: `node scripts/test-v497-zalo-server-flag-route.cjs` (PG17, 10 nhóm; cũng nằm trong `campaign-outcome-engine-check-all.cjs`).
- **ChatApi** (worktree `akaAgentChatApi-campaign-engine-v2`, chưa commit):
  - `packages/database/src/zaloServerFlyRoute.ts`: mệnh đề dùng chung thay 9 bản sao `(is_chat_sync OR separate)` (tìm chiến dịch, khôi phục, điều khiển lượt, bảo trì lịch, `claimPending`, chiến dịch theo sự kiện). Dò V497 bằng `to_regprocedure` lúc khởi động và mỗi phút ở cả chat-api lẫn worker; chưa có V497 thì giữ đúng từng ký tự mệnh đề cũ.
  - `ChatEntitlementRepository`: danh sách tổ chức cho runtime Server và `isOrganizationServerEnabled` nhận thêm tổ chức theo luật cờ; các kiểm cho Chat Web/hộp thư giữ nguyên.
  - Không đánh "chưa đăng nhập" tài khoản đang có dòng `to_fly` chưa xong.
  - Chép phiên (`apps/chat-api/src/zaloServerSessionHandoff.ts` + `ZaloServerSessionHandoffRepository`), chạy trong vòng đọc danh sách tài khoản cho runtime (~15 giây): VPS→Fly sau mốc thả (tài khoản mới của nhân viên đã được thả thì coi như đã thả ngay, vì App Server không còn chạy nhân viên đó), dùng lại `completeQrLogin` (câu nhật ký riêng), phiên App Server lấy đúng `{cookie, imei, userAgent, language}`, mã Zalo từ `zalo_accounts.zalo_uid`; nhận dòng có tăng `attempt_count`, bỏ qua dòng vừa thử trong 30 giây, tối đa 5 lần; chờ mốc quá 10 phút thì ghi lỗi một lần. Fly→VPS: tắt binding, chỉ ghi lại phiên khi phiên Fly mới hơn lượt chép (ví dụ đã quét QR trên Fly), chuyển dòng sang `to_vps`.
  - Không ghi dữ liệu Chat: câu nhận sự kiện tính `chat_data_allowed` (false chỉ với tài khoản Server của tổ chức không Chat, không `separate`); processor bỏ danh bạ, nhóm, thẻ, sticker, xoá/thu hồi, cảm xúc, đã xem, sự kiện bạn bè/nhóm, tin đến; giữ tin gửi đi đang chạy (đối chiếu lệnh gửi của chiến dịch, như tổ chức `separate` chưa bật akaChat) và tệp tải lên. Đồng bộ lịch sử chỉ chạy khi người dùng bấm trong màn Chat nên tổ chức không Chat không có.
  - Test: `zaloServerFlyRoute.test.ts` (mệnh đề), `zaloServerSessionHandoff.integration.test.ts` (PGlite, V497 thật từ file đồng bộ, `completeQrLogin` thật: 8 ca), 3 ca processor.
- **Giới hạn khi thử:** Desktop/WebApp chưa đổi, nên thao tác tài khoản Server của tổ chức không Chat (quét QR, kiểm phiên, danh bạ, kiểm SĐT) vẫn gửi về App Server và lỗi; tạo/tạm dừng/chạy tiếp chiến dịch vẫn được. Zalo có thể không nhận phiên trên IP của Fly (cách lui: tắt cờ). Runtime Fly không gửi về cookie đã làm mới. Nhân viên ngoài khung giờ được phép thì App Server không có runtime để dừng, nên không có mốc: ghi lỗi sau 10 phút, người xử lý ghi tay `vps_released_at`.


### 14.9 Tiến trình chiến dịch của tổ chức không Chat chạy trên Fly (V498 đã apply 11/11 20:46 VN; Web và ChatApi `api` đã deploy; Desktop chưa phát hành)

Lần thử với tổ chức 526 (11/11): "Lịch sử chạy" đủ dòng, nhưng tab "Tiến trình" của Desktop và Web trống.
- Desktop chỉ nghe kênh realtime của ChatApi khi tổ chức có Chat. Web API cũng chỉ cấp vé kênh tiến trình của ChatApi cho tổ chức có Chat.
- Với tổ chức không Chat, cả hai chỉ nghe App Server, mà App Server đã thả tổ chức chạy trên Fly.
- Bộ chạy trên Fly vẫn phát tiến trình: `appendLog` vừa ghi lịch sử vừa đẩy lên kênh `aka_agent_chat_campaign_log`.

Thay đổi:
- **DB, [V498](../migrations/migration_v498_zalo_server_on_fly_desktop.sql):** chỉ thêm hàm `public.aka_agent_zalo_server_on_fly_v1()`, chỉ cấp cho `aka_agent_desktop`.
  - Hàm không nhận tham số; lấy tổ chức từ phiên Desktop qua `private.aka_agent_desktop_data_context()`.
  - Trả đúng khi tổ chức có Chat chạy Server trên Fly (`aka_agent_app_access_chat_runtime(org, true)`), hoặc khi ChatApi đã nhận tổ chức theo cờ (có dòng `to_fly` trong `private.auto_zalo_server_session_handoff`).
  - Desktop không có quyền đọc cờ `use_new_zalo_runtime` hay bảng chép phiên, nên cần hàm này.
  - Rollback: xoá hàm.
- **ChatApi:** đường cấp phiên `/api/chat/desktop/session` (scope `zalo_qr_login`) nhận thêm tổ chức có `isOrganizationServerEnabled`, tức có Chat hoặc chạy theo cờ (`desktopAuthRoutes.ts`, nối ở `main.ts`).
  - Runtime cục bộ và quét data vẫn chỉ cho tổ chức có Chat.
  - Kiểm lại quyền của kênh realtime vốn đã nhận tổ chức theo cờ từ V497.
  - Đã áp sang bản dựng deploy `akaAgentChatApi-deploy-v2`; chỉ cần deploy nhóm `api`.
- **Desktop:**
  - Lúc đăng nhập, tổ chức không Chat có quyền Server thì gọi thêm hàm V498 (`zaloServerOnFlyRepository.ts`, lưu vào `AuthUser.zaloServerOnFly`).
  - Nếu tổ chức đang chạy trên Fly, `startZaloRemoteClients` mở thêm `ZaloChatApiClient` ở chế độ chỉ realtime (`isRealtimeOnly()`, `ensureRealtimeToken()`), song song với App Server.
  - Thao tác tài khoản vẫn đi App Server; `requireEnabled` vẫn từ chối.
  - DB chưa có V498 (`PGRST202`) hoặc lỗi mạng thì coi như không chạy trên Fly, giữ đúng hành vi cũ.
  - Giá trị chốt lúc đăng nhập: đổi cờ thì Desktop phải đăng nhập lại mới đổi kênh nghe.
- **Web API (worktree `akaAgentWebApp-campaign-engine-v2`, nhánh `feat/campaign-engine-v2-realtime` từ `dev`):**
  - `realtimeTicket` cấp thêm vé kênh tiến trình của ChatApi khi tổ chức không Chat có `aka_agent_zalo_server_flag_route(org)`. Hàm này có từ V497 và service_role đã có quyền gọi, nên Web không cần V498.
  - Không kiểm được thì chỉ nối App Server như cũ.
- **Giao diện Web** (`apps/web/src/realtime/RealtimeContext.tsx`, cùng nhánh): ghi chú cũ ở đây nói giao diện không cần đổi. Sai:
  - `connect()` chỉ mở socket tiến trình khi `user.chatSyncEnabled`, bỏ qua `campaignUrl` mà API cấp. Vì vậy bản v103 (chỉ có phần API) vẫn không hiện tiến trình khi anh chạy 32956 lúc 20:17.
  - Sửa: mở socket tiến trình khi vé có `campaignUrl` hoặc tổ chức có Chat.
  - Tổ chức không Chat mà lượt nối lại không còn được cấp URL (đã về App Server) thì để `disabled` và dừng; tổ chức Chat vẫn thử lại như cũ.
  - Test: 2 ca mới trong `RealtimeContext.test.tsx`; ca đổi Chat giữa phiên nay cho lần đầu vé không có URL, như API trả cho tổ chức không Chat.

Kiểm:
- `node scripts/test-v498-zalo-server-on-fly-desktop.cjs`: 9 nhóm, trên PG17 với V497 và hai hàm phiên Desktop nguyên văn bản live (`scripts/fixtures/zalo-server-flag-route/desktop-scope-functions-20261111.json`).
- `node scripts/run-zalo-chat-realtime-only-smoke-test.cjs`: 5 nhóm, ChatApi giả có `/ws`.
- `campaign-outcome-engine-check-all.cjs` đã gồm cả hai.
- ChatApi: `desktopAuthRoutes.test.ts`, 4 ca.
- Web API: thêm 2 ca `realtimeTicket` trong `aka-agent-control.service.test.ts`.
- Web: 2 ca mới trong `RealtimeContext.test.tsx`; toàn bộ test Web 117 file đạt (1.105 ca ở nhánh `dev`, 1.100 ca ở bản dựng `de8fa4f`), typecheck Web sạch.

Thứ tự lên production (mỗi bước khi anh bảo "làm"):
1. Apply V498 ngoài giờ cao điểm. Chỉ thêm hàm, nên PostgREST nạp lại schema một lần. **Đã apply akachat 11/11 20:46:40 VN** (anh bảo "Apply V498"; `20261111134640`, md5 sổ = file `ec584e65…`; không apply lại; hàm md5 `0e8f19b1…`, chỉ `aka_agent_desktop` gọi được; PostgREST nạp lại schema 4,6 s, 0 lỗi 5xx; [biên nhận](../migrations/snapshots/zalo-server-on-fly-desktop-v498/apply-receipt.json)).
2. Deploy ChatApi nhóm `api` từ bản dựng. **Đã deploy 11/11 20:57:34–20:59:10 VN** (anh bảo "Deploy ChatApi api"; api v173, image `api-e16725c-v2-desktop-20261111`; worker v172 và zalo_runtime v155 giữ nguyên; verify 165/165 file, 2.300 test; sau deploy 0 lệnh `waiting_socket` mới, runtime đẩy bù 505 sự kiện, LISTEN kênh tiến trình phát lại 20:59:00; rollback: gắn lại `worker-api-e16725c-v2-20261111` cho nhóm api; [biên nhận](../migrations/snapshots/engine-v2-chatapi-api-desktop-deploy-20261111/receipt.json)). Chưa gọi thử cấp phiên Desktop bằng tài khoản thật của 526.
3. Deploy Web API. **Đã deploy** (v103 phần API 20:12 VN, v104 phần giao diện 20:37 VN; xem bên dưới).
4. Phát hành Desktop. **Bản thử nội bộ (không phát hành) đã dựng 11/11 21:09 VN** (anh bảo "Dựng bản thử"): Mac ARM64, 9.5.1, `dist/build-9.5.1-test-engine-v2/akaAgent-9.5.1-test-engine-v2.dmg` (sha256 `b97b6c8b…`); nguồn worktree này (nền `54cfde31` + thay đổi chưa commit); typecheck, bộ kiểm engine 10/10, manifest đầu vào trước/sau giống nhau, quét secret 12.453 file sạch; [biên nhận](audits/akaagent-9.5.1-test-engine-v2-20261111/README.md). Bản này chạy luôn bộ mới cho tài khoản QR/Web của người đăng nhập. Chạy thẳng từ `dist` với thư mục dữ liệu riêng, nhân viên 547 đăng nhập 21:14:55, chạy lại 32956 lúc 21:15:57: **anh xác nhận thấy tiến trình trên Desktop** ([biên nhận](../migrations/snapshots/engine-v2-org526-fourth-run-20261111/receipt.json)).

**Web đã deploy 11/11 20:12:52 VN** (Fly v103):
- Image `web-de8fa4f-realtime-20261111@sha256:01f0c2ed…`, chỉ đổi image trên máy `48ee749f357398`.
- Sau deploy: health 200; các đường cần đăng nhập trả 401 như trước; log không lỗi; trong container có lệnh gọi `aka_agent_zalo_server_flag_route`.
- Bản này chỉ có phần API. Anh chạy 32956 lúc 20:17 thì Web vẫn không hiện tiến trình, do chốt ở giao diện (xem mục Giao diện Web ở trên).
  - `edge_logs` 20:13–20:24 VN: API gọi `aka_agent_zalo_server_flag_route` 2–10 lượt mỗi phút, đều 200.
  - Đọc DB: 526 và nhân viên 547 qua đủ các phép kiểm của kênh realtime ChatApi (cờ, nhân viên còn hoạt động, khung giờ, quyền akaAgent).
- Bản sửa giao diện áp vào thư mục dựng (cùng 2 file, md5 giống nhánh `dev`), dựng image `web-de8fa4f-realtime2-20261111@sha256:2299aa06…` (xong trước 20:35 VN). **Đã deploy 20:37:09 VN** (anh bảo "Deploy ngay"; Fly v104, chỉ đổi image trên máy `48ee749f357398`). Sau deploy: HTTP như trước; `index.html` ở cả `aka-agent-web-app.fly.dev` lẫn `agent.akabiz.net` trỏ `assets/index-BidBtNiM.js`, đúng bản build local có sửa (v103 là `index-Bc219zJD.js`), `sw.js` cũng precache file này; log không lỗi. Web là PWA nên người dùng phải tải lại trang mới nhận bản mới. Rollback về v103: gắn lại `web-de8fa4f-realtime-20261111@sha256:01f0c2ed…`.
- 20:42:24 VN chạy lại 32956 để thử (anh bảo "Chạy lại 32956"): data về `chờ xử lý` như nút chạy lại data của Desktop, chiến dịch mở lại như `reopenCompletedCampaignAfterInputInsert` (RPC trạng thái Server chỉ nhận tạm dừng → chờ xử lý). Bộ chạy Fly nhận ngay trong giây; số 455 xong 20:42:25, số 704 xong 20:42:57 ("Đã là bạn bè (Z225)"); [biên nhận](../migrations/snapshots/engine-v2-org526-third-run-20261111/receipt.json). Kênh Web chỉ phát trực tiếp, nên trang nối sau 20:42:25 không thấy dòng của số 455. **Anh xác nhận đã thấy dòng tiến trình trên Web** (tổ chức 526, Web v104).
- [Biên nhận](../migrations/snapshots/engine-v2-web-realtime-deploy-20261111/receipt.json); rollback: gắn lại image `web-de8fa4f-20261111`.

**Bản deploy Web đã dựng 11/11 17:48–17:58 VN** (chưa commit):
- Nơi dựng: worktree `/Users/lequangnhut/Repos/akaAgentWebApp-deploy-realtime`, nhánh `deploy/web-realtime-de8fa4f`, tách từ `de8fa4f`, đúng commit Web đang chạy (`web-de8fa4f-20261111`, Fly v102). Áp 3 file API của phần sửa; ba file này giống nhau giữa `de8fa4f` và `dev`, nên áp sạch.
- Đã kiểm:
  - `npm ci`, typecheck 8 workspace đạt. Checkout mới phải `npm run build -w @aka-agent/control-api` trước khi typecheck: các workspace khác đọc kiểu từ `dist` của gói này.
  - Toàn bộ test 4.061 ca đạt, bỏ qua 2: control-api 211, campaign-core 390, journey-core 86, control-client 68, API 1.728, Web 1.097, mobile 481. Riêng ca Web `CampaignsPage` (chọn 1.001 dòng) hết giờ 15 giây khi chạy chung; chạy riêng file thì 87/87 đạt, giống biên nhận deploy trước.
  - `npm run build` đạt.
  - Giả lập Dockerfile bằng `docs/audits/webapp-20261110/runtime-check-dockerfile.py` (1.381 file nguồn): không thiếu import, server dừng ở bước kiểm biến môi trường.
- Lệnh deploy, chạy trong thư mục dựng, cùng cách lần trước:
  1. `flyctl deploy --app aka-agent-web-app --build-only --push --remote-only --image-label web-de8fa4f-realtime-20261111`
  2. `flyctl deploy --app aka-agent-web-app --image registry.fly.io/aka-agent-web-app:web-de8fa4f-realtime-20261111 --ha=false --update-only --only-machines 48ee749f357398 --strategy rolling --wait-timeout 2m`
- Rollback: đổi lại image `web-de8fa4f-20261111` trên cùng máy, với cùng các cờ.

Web chỉ cần bước 3: ChatApi đang chạy, bản deploy 17:05 VN 11/11, đã nhận vé Web của tổ chức theo cờ (`revalidateCapability` dùng `isOrganizationServerEnabled`). Desktop cần bước 1, 2 và 4. Web đang chạy `web-de8fa4f-20261111`; `dev` đi trước một tính năng chưa deploy (#204, chia đều data), nên phải chọn nền dựng như đã làm với ChatApi.

Thao tác tài khoản Server của tổ chức không Chat (quét QR, kiểm phiên, nhãn, danh bạ, kiểm SĐT): đã làm ở local 11/11, chưa deploy/phát hành ([hợp đồng](ZALO_SERVER_FLY_ACCOUNT_OPERATIONS.md)).

### 14.10 Bảng mã lỗi Zalo đầy đủ: phân pha lỗi, V499 (nhớ theo tài khoản), V500 (chính sách anh đã duyệt)

Bảng duyệt và quyết định: [CAMPAIGN_OUTCOME_ENGINE_ZALO_FULL_REVIEW.md](CAMPAIGN_OUTCOME_ENGINE_ZALO_FULL_REVIEW.md) (anh duyệt từng câu tối 11/11).
**V499 đã apply akachat 12/11 00:02:44 VN (`20261111170237`), V500 lúc 00:03:06 VN (`20261111170305`)**; md5 sổ = file, PostgREST nạp lại schema 2,1 giây, 0 lỗi 5xx; không apply lại ([biên nhận V499](../migrations/snapshots/target-memory-per-account-v499/apply-receipt.json), [V500](../migrations/snapshots/zalo-error-policies-v500/apply-receipt.json)). Lõi/cổng chưa commit. **ChatApi `worker` có lõi mới đã deploy 12/11 00:31:05 VN** (anh bảo "Deploy ngay"; image `worker-dbb38b7-v2-errors-20261112@sha256:fd3cef5c…`; api và `zalo_runtime` không đổi; [biên nhận](../migrations/snapshots/engine-v2-chatapi-worker-errors-deploy-20261112/receipt.json)). Trước khi dựng thì phát hiện api và worker đã được một nơi khác (không phải máy này) cập nhật lúc 21:49–21:52 VN 11/11 sang `dbb38b7` (đầu `dev`: backend ChatWeb) cộng v2, nên bản này dựng từ đúng mã nguồn đang chạy (465/465 file trùng md5 trong máy) và chỉ khác đúng 5 file: `flyZaloPort.ts`/`.test.ts`, `pacing.ts`, `zalo/common.ts`, `SOURCE.json`; verify 184/184 file, 2.605 test. Desktop chưa phát hành.

- **Lõi `classifyZaloError(error, 'read' | 'send', answered)`** (`zalo/common.ts`), cổng Desktop và Fly gọi theo loại thao tác:
  - mã số là câu trả lời của Zalo: after_send (như cũ);
  - thao tác đọc (tra số): lỗi mạng, HTTP lỗi, hết giờ, phản hồi không đọc được, lỗi trên máy là before_send (trước đây after_send, nên bị tính như lỗi nghiệp vụ);
  - thao tác gửi: lỗi mở kết nối (`syscall` connect/getaddrinfo, `ECONNREFUSED`, DNS…) và HTTP 429 là before_send; HTTP 5xx, đứt giữa chừng, hết giờ, phản hồi không đọc được là in_flight (không rõ, không gửi lại); HTTP 4xx khác là after_send;
  - `ZaloPortError.code` giữ mã của lỗi gốc (bước tra số dùng để quyết định thử reqSrc 40 như Desktop);
  - Fly: `zalo_command_failed` của runtime chỉ mang câu lỗi ("fetch failed", "terminated", "Request failed with status code …"), cổng Fly đọc câu theo loại lệnh, không cần deploy `zalo_runtime`;
  - Desktop: lỗi `ensureApi` ("Chưa có session Zalo"…) ở bước gửi là before_send.
- **Nghỉ ngắn** (`pace_mode = short`) không bao giờ dài hơn "Nghỉ giữa 2 lần" của chiến dịch (chính sách hiện chưa dùng nghỉ ngắn).
- **V499** (`scripts/build-v499-sql.cjs`, sinh từ thân hàm V495 đã kiểm khớp production): `auto_target_memory.account_id`, khoá duy nhất (tài khoản, mục tiêu, thao tác); claim chỉ bỏ qua mục tiêu đã nhớ của đúng tài khoản đang chạy, report ghi theo tài khoản. Bảng nhớ phải trống lúc apply (production 11/11: 0 dòng). Không đổi hành vi khi chưa có chính sách bật nhớ.
- **V500** (`scripts/build-v500-sql.cjs`, đặc tả theo Q1–Q8): 109 dòng chính sách `v500_review` theo (mã, thao tác[, nơi chạy]), 14 luật, 7 mã mới `engine v2` không có mã Zalo. Dùng toàn cơ chế có sẵn của V495:
  - mã do tài khoản: `target_effect = requeue`, `remaining_steps = skip`, không trừ lượt, `streak_threshold = 3` + `campaign_effect = pause` (tạm dừng khi đủ ngưỡng, data vẫn chờ xử lý);
  - lỗi mạng (NET01, NET03, tra số không rõ kết quả): không ghi lịch sử, requeue, khoá 11 thao tác Zalo của tài khoản 5 phút, `streak_threshold = 4` + pause;
  - thao tác phụ (gắn tag, đổi tên) vẫn bị chặn theo thao tác của V495: không trừ lượt, không cộng chuỗi lỗi.
  Gỡ = xoá dòng `v500_review`, bật lại luật seed `target_missing_identity`, tắt mã mới.
- **Kiểm:** `test-v499-target-memory-per-account.cjs` 4/4, `test-v500-zalo-error-policies.cjs` 13/13 (216 cặp chính sách hiệu lực, 29 ca phân loại, chạy thật đủ Q1–Q6, gỡ xong 2.013 mô phỏng về đúng trước V500), bộ kiểm danh mục của Desktop 8.2.0/9.3.0/chat-sync đạt trên danh mục sau V499/V500; `campaign-outcome-engine-check-all.cjs` chạy cả hai.
- **12/11 01:00–01:18 VN đã gỡ v2 khỏi production** (anh: "tính năng này bây giờ chưa cần test", "deploy nhánh dev đi"): tắt cờ 526 → ChatApi trả tài khoản 2445 (01:00:52) → VPS nhận lại, kiểm phiên đạt 01:02:09, không quét QR; ChatApi `api`+`worker` về `dev` `dbb38b7` (01:04, 423/423 file trùng archive); Web về `dev` `6cb64b4` (v107, 01:18; 154/154 file API và bundle trùng bản dựng lại). DB giữ V495–V500, không tổ chức nào bật cờ. [Biên nhận](../migrations/snapshots/engine-v2-revert-to-dev-20261112/receipt.json). Bước tiếp theo anh giao: code phủ đủ 11 loại chiến dịch Zalo tới mức cho khách dùng, thử bằng dữ liệu thật trên máy local, rồi mới deploy và thử thật.
- **Còn lại** (mỗi bước khi anh bảo): phát hành Desktop. Lần deploy ChatApi sau dựng từ worktree `akaAgentChatApi-deploy-dbb38b7` (nhánh `deploy/campaign-engine-v2-dbb38b7`), **không** từ `akaAgentChatApi-deploy-v2` (e16725c, sẽ gỡ phần backend ChatWeb); trước khi dựng kiểm `flyctl image show` và md5 file trong máy.
