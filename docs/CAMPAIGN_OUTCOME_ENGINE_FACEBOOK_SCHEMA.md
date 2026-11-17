# Engine v2 cho Facebook: thay đổi schema để anh duyệt (16/11/2026)

> **Anh duyệt hết ngày 16/11 tối** ("ok tôi duyệt hết"): S1 lưu ảnh lấy về trong DB (T6), S2 đổi ba bảng engine như A1, S3 đưa hai số
> 10 phút vào thiết lập DB. Migration viết theo danh sách này; thêm gì ngoài danh sách thì hỏi anh trước. Đọc từ migration trong repo (V495–V546) và code
> `dev_3` `0ae0d6f2`; trước khi viết migration em đọc lại thân hàm đang chạy trên production (chỉ đọc) để preflight kiểm md5.
> Phương án: [CAMPAIGN_OUTCOME_ENGINE_FACEBOOK_PLAN.md](CAMPAIGN_OUTCOME_ENGINE_FACEBOOK_PLAN.md).

> **Cập nhật khi code (16/11 khuya), chưa apply:** viết thành V556 p1/p2 (T1–T3, T5, T6, S, F), V557 (A1), V558 (M, A2 đọc), V559
> (dữ liệu mục 8: mã FB42–FB44, luật, chính sách FB bản nháp; sinh bằng `scripts/build-v559-sql.cjs`, preflight kiểm vân tay danh mục
> production), V560 (dữ liệu mục 8: bản "[engine]" của 14 workflow / 84 block, T2 / T3, T1; sinh bằng `scripts/build-v560-sql.cjs`).
> **Khác danh sách (anh chốt 16/11 khuya):** việc sau kết quả làm như bộ cũ, nên **bỏ T4** `auto_engine_followups` và ba hàm
> `aka_agent_engine_push_targets_v1` / `post_bump_v1` / `followup_v1` (không viết). Trong M (V558, sửa thân hàm, không đổi chữ ký / bảng):
> claim nhận `ctx.inputDataIds` (chỉ nhận đúng các data này trong lượt đang giữ lease; đăng nhóm kèm chia sẻ, gọi qua `claim_batch_v1` có
> sẵn) và `report_v1` nhận kết quả không gắn thao tác của chiến dịch Facebook (dòng "Tìm data" như bộ cũ: `action_code` trống, không tính
> lượt; cột bắt buộc `auto_engine_outcomes.action_code` ghi chuỗi rỗng). Không thêm bảng / cột nào ngoài danh sách.

## 0. Tóm tắt

| # | Loại | Tên | Vì sao |
|---|---|---|---|
| T1 | bảng mới | `auto_engine_block_steps` | danh mục block nào là mốc gửi, ghi dấu "sắp gửi" ở mức nào (mục 3.3, 3.5 phương án) |
| T2 | bảng mới | `auto_engine_workflows` | loại chiến dịch FB → workflow "[engine] …" mà engine chạy (Q7) |
| T3 | bảng mới | `auto_engine_block_copies` | sổ cặp block cũ ↔ bản engine kèm md5, để biết bên nào sửa mà bên kia chưa theo (Q7) |
| T4 | ~~bảng mới~~ **bỏ** | ~~`auto_engine_followups`~~ | anh chốt 16/11 khuya: việc sau kết quả (đẩy data tìm được, sinh lượt Up tin) làm như bộ cũ, không có dấu "đã làm" |
| T5 | bảng mới | `auto_desktop_diagnostic_requests` | yêu cầu lấy ảnh lỗi từ máy khách (Q12) |
| T6 | bảng mới | `auto_desktop_diagnostic_files` | ảnh lấy về (nếu anh chọn lưu trong DB, câu S1) |
| A1 | sửa bảng | `auto_engine_target_runs`, `auto_engine_outcomes`, `auto_engine_target_events` | lượt theo lịch cho trang cá nhân / newsfeed (không có dòng data, Q4) |
| A2 | sửa bảng | `auto_outcome_policies` | hai cột / giá trị mới để chính sách FB giữ đúng cách tính của bộ cũ (mục 5.3) |
| S | thiết lập | `engine.facebook`, `facebook.max_comments` | bật theo tổ chức (Q1), trần số comment 20 sửa được ở DB (Q10) |
| F | hàm mới | 1 hàm Desktop đọc thiết lập, 2 hàm tra lỗi / kiểm, 6 hàm ảnh lỗi (3 hàm việc sau kết quả bỏ theo anh chốt) | mục 4 |
| M | sửa thân hàm | claim, action_limit, report, finish và các hàm engine đọc `input_data_id` | mục 5; giữ nguyên chữ ký, Zalo không đổi |

Không thêm cột nào trên bảng nóng của bộ cũ (`auto_campaigns`, `auto_accounts`, `auto_campaign_input_data`, `auto_campaign_details`,
`auto_runs`, `auto_run_steps`, `org_organization`, `org_staff`). Mục 7 liệt kê những gì đã cân nhắc và không thêm.

## 1. Bảng mới

Mọi bảng mới: bật RLS, thu hồi quyền của `anon` / `authenticated`; không FK tới bảng nóng (như bảng engine V495). Quyền ghi chỉ qua RPC
hoặc `service_role`.

### T1. `auto_engine_block_steps`: danh mục bước FB

Mỗi dòng một block chạy trong engine; có thể ghi đè riêng cho một node của một workflow. Desktop đọc (SELECT) lúc bắt đầu lượt.

| Cột | Kiểu | Ý nghĩa |
|---|---|---|
| `id` | bigserial PK | |
| `block_id` | bigint NOT NULL → `auto_blocks(id)` | block bản engine |
| `workflow_id` | bigint NULL → `auto_workflows(id)` | NULL = mọi workflow dùng block này |
| `node_id` | text NULL | NULL = mọi node dùng block này |
| `action_code` | text NULL → `auto_account_actions(code)` | thao tác của mốc (`fb_post_group`, `fb_comment`…) |
| `action_code_from` | text NULL | khoá trong cấu hình node chứa mã thao tác (ví dụ `composerActionCode` của `fb_click_post_button`) |
| `step_kind` | text NOT NULL | `delivery` (gửi, không làm lại) / `idempotent` (làm lại vô hại: tham gia nhóm) / `result` (ra kết quả mà không gửi: không mở được hộp đăng bài, Tìm data) / `read` / `session` (đổi danh tính Page) |
| `commit_level` | smallint NOT NULL DEFAULT 1 | 1 = ghi dấu ở đầu block; 2 = đầu block + vết thao tác biết cú bấm gửi đã chạy chưa; 3 = block tự gọi `helpers.commitPoint` |
| `send_ops` | jsonb NOT NULL DEFAULT `'[]'` | cú bấm gửi của block, ví dụ `[{"op":"click","element":"fb_post_button"}]` |
| `result_mode` | text NOT NULL DEFAULT `'action_result'` | `action_result` (block trả `actionResult`) / `legacy_output` (đọc đầu ra kiểu cũ như `logMilestonesV2`) |
| `legacy_milestone` | text NULL | cách đọc đầu ra kiểu cũ: `post`, `comment`, `message`, `add_friend`… |
| `reviewed_code_md5` | text NULL | md5 code block lúc duyệt; code đổi mà chưa duyệt lại thì engine lùi về mức 1 (an toàn nhất) |
| `is_active`, `note`, `created_at`, `updated_at` | | |

Chỉ mục duy nhất `(block_id, workflow_id, node_id) NULLS NOT DISTINCT WHERE is_active`.

### T2. `auto_engine_workflows`: workflow engine chạy cho từng loại

| Cột | Kiểu | Ý nghĩa |
|---|---|---|
| `purpose` | text PK | `action_id` của 13 loại FB, hoặc `rest_browse` (nghỉ / lướt FB) |
| `workflow_id` | bigint NOT NULL → `auto_workflows(id)` | bản "[engine] …" |
| `source_workflow_id` | bigint NULL → `auto_workflows(id)` | bản cũ đã chép |
| `source_md5`, `engine_md5` | text | md5 hai bản lúc chép |
| `copied_at`, `is_active`, `updated_at` | | |

Engine chọn workflow qua bảng này, không đụng `auto_campaign_actions.workflow_id` (bản cũ đọc cột đó). Desktop đọc (SELECT).

### T3. `auto_engine_block_copies`: sổ cặp block

| Cột | Kiểu | Ý nghĩa |
|---|---|---|
| `engine_block_id` | bigint PK → `auto_blocks(id)` | |
| `source_block_id` | bigint NOT NULL → `auto_blocks(id)` | |
| `source_md5_at_copy`, `engine_md5_at_copy` | text NOT NULL | |
| `copied_at` | timestamptz | |

Kèm view chỉ đọc `aka_agent_engine_block_copy_drift`: cặp nào có một bên sửa sau lần chép mà bên kia chưa theo. Chỉ `service_role`
(script chép và script kiểm).

### T4. ~~`auto_engine_followups`~~: bỏ

Anh chốt 16/11 khuya ("Như bộ cũ"): đẩy data tìm được, sinh lượt Up tin chạy trong cùng lượt như bộ cũ; bị ngắt thì mất phần chưa làm,
không trùng. Không có bảng / hàm dấu "đã làm" (V556 không tạo, V558 không dọn).

### T5. `auto_desktop_diagnostic_requests`: yêu cầu lấy ảnh lỗi

| Cột | Kiểu | Ý nghĩa |
|---|---|---|
| `id` | bigserial PK | |
| `organization_id`, `staff_id` | bigint NOT NULL | máy của nhân viên nào |
| `requested_by` | text NOT NULL | ai yêu cầu |
| `filter` | jsonb NOT NULL | `{campaignId?, inputDataId?, targetRunId?, from?, to?, imageIds?}` |
| `status` | text NOT NULL DEFAULT `'pending'` | `pending` / `uploading` / `done` / `no_images` / `expired` / `failed` |
| `result` | jsonb NOT NULL DEFAULT `'{}'` | số ảnh, lỗi |
| `expires_at` | timestamptz NOT NULL | tạo + 7 ngày |
| `created_at`, `claimed_at`, `completed_at` | timestamptz | |

Chỉ mục `(staff_id) WHERE status IN ('pending','uploading')`.

### T6. `auto_desktop_diagnostic_files`: ảnh đã lấy về (nếu anh chọn S1 = lưu trong DB)

| Cột | Kiểu | Ý nghĩa |
|---|---|---|
| `request_id` | bigint → T5 ON DELETE CASCADE | |
| `image_id` | uuid | mã ảnh trên máy khách (đi trong `signal` / `data.screenshotId`) |
| `meta` | jsonb | URL, tiêu đề trang, thao tác lỗi, mã lỗi, thời điểm, phiên bản app… |
| `content` | bytea, CHECK ≤ 2 MB | JPEG ~100 KB |
| `sha256`, `created_at` | | |

PK `(request_id, image_id)`. Job pg_cron mỗi ngày xoá yêu cầu và ảnh quá 7 ngày.

## 2. Sửa bảng đang có

### A1. Lượt theo lịch (trang cá nhân, newsfeed: không có dòng data)

| Bảng | Thay đổi |
|---|---|
| `auto_engine_target_runs` | thêm `slot_at timestamptz NULL` (mốc lịch của chiến dịch lúc nhận lượt); `input_data_id` bỏ NOT NULL; CHECK mỗi lượt có đúng một trong `input_data_id` / `slot_at` (thêm `NOT VALID` rồi `VALIDATE` riêng); chỉ mục duy nhất `(campaign_id) WHERE slot_at IS NOT NULL AND completed_at IS NULL` (mỗi chiến dịch tối đa một lượt theo lịch đang mở) và chỉ mục `(campaign_id, slot_at) WHERE slot_at IS NOT NULL` (claim không nhận lại mốc lịch đã chạy), cả hai dựng `CONCURRENTLY` |
| `auto_engine_outcomes` | `input_data_id` bỏ NOT NULL |
| `auto_engine_target_events` | `input_data_id` bỏ NOT NULL |

Chỉ mục duy nhất đang có `(input_data_id) WHERE completed_at IS NULL` không đổi (NULL không đụng nhau). Ba bảng này Zalo đang dùng: mỗi
lệnh ALTER một giao dịch riêng, `lock_timeout` 2 giây, ngoài giờ cao điểm; chạy lại bộ kiểm và bộ kịch bản Zalo trước khi apply.

### A2. `auto_outcome_policies`

| Thay đổi | Vì sao |
|---|---|
| `detail_mode` thêm giá trị `inherit` (CHECK hiện chỉ `write` / `suppress`) | bộ cũ ghi trạng thái lịch sử FB theo `statusCode` block trả (mục 5.3 điểm 1); `inherit` = dùng trạng thái của kết quả gửi lên, rồi các trường đếm còn NULL lấy theo chính sách của chính trạng thái đó, đúng như bộ cũ |
| cột mới `streak_after_delivery text NULL` (`count` / `ignore`; NULL = kế thừa, mặc định `count`) | bộ cũ: comment lỗi sau khi data đã có kết quả gửi thành công không cộng chuỗi data lỗi (`actionResultRuntime.ts:160-161`, `targetOnlyFailure`); seed FB đặt `ignore` cho `fb_comment` |

Bảng nhỏ (vài trăm dòng), Desktop không đọc trực tiếp. `aka_agent_engine_policy_lint` (V514), `aka_agent_engine_simulate_v1` và trigger
lịch sử chính sách đọc thêm hai thứ này.

## 3. Thiết lập (`auto_system_settings`, thêm dòng, không đổi bảng)

| Khoá | Giá trị lúc apply | Ai đọc |
|---|---|---|
| `engine.facebook` | `{"mode":"off","organizationIds":[]}` (`off` / `orgs` / `all`; chưa có dòng hoặc sai = `off`) | hàm Desktop lúc đăng nhập; claim kiểm lại mỗi lần nhận lượt (tắt khẩn cấp không cần khách đăng nhập lại) |
| `facebook.max_comments` | `20` (thiếu dòng hoặc sai = 20) | Desktop đọc chung câu đọc thiết lập lúc đăng nhập (`getDesktopPollingSettings`), cho ô số comment ở form, AI điền form và lúc chạy |

## 4. Hàm mới

| Hàm | Ai gọi | Quyền | Việc |
|---|---|---|---|
| `aka_agent_engine_facebook_enabled_v1() → boolean` | Desktop lúc đăng nhập | `aka_agent_desktop` | tổ chức của phiên có trong `engine.facebook` không (như V513, không phụ thuộc quyền Zalo) |
| `aka_agent_engine_trace_v1(p_input_data_id, p_target_run_id) → jsonb` | script tra lỗi (Q16) | `service_role` | chỉ đọc: lượt data, kết quả, tín hiệu + vết thao tác, mã ảnh, lượt `auto_runs` của lượt engine, câu đã hiện cho khách |
| `aka_agent_engine_health_v1(p_minutes integer) → jsonb` | script kiểm, anh hỏi thì chạy (Q22) | `service_role` | chỉ đọc: chiến dịch FB chạy engine đến lịch mà không tiến triển quá N phút (kèm lý do), lỗi chưa phân loại tăng, claim lỗi liên tục |
| ~~`aka_agent_engine_push_targets_v1`, `aka_agent_engine_post_bump_v1`, `aka_agent_engine_followup_v1`~~ | | | **bỏ** (anh chốt 16/11 khuya: việc sau kết quả như bộ cũ, dùng code bộ cũ trong cùng lượt) |
| `aka_agent_device_presence_v2(…) → jsonb` | Desktop, nhịp 30 giây có sẵn | `aka_agent_desktop` | như bản hiện có (trả `boolean`), trả thêm "có yêu cầu ảnh lỗi"; bản cũ vẫn gọi bản cũ, không thêm lượt gọi |
| `aka_agent_desktop_diagnostic_next_v1() → jsonb` | Desktop | `aka_agent_desktop` | lấy yêu cầu đang mở của chính nhân viên, chuyển `uploading` |
| `aka_agent_desktop_diagnostic_upload_v1(p_request_id, p_image_id, p_meta, p_jpeg_base64) → jsonb` | Desktop | `aka_agent_desktop` | ghi một ảnh vào T6 (chỉ khi yêu cầu còn mở và đúng nhân viên) |
| `aka_agent_desktop_diagnostic_complete_v1(p_request_id, p_result jsonb) → jsonb` | Desktop | `aka_agent_desktop` | báo xong / không còn ảnh |
| `aka_agent_desktop_diagnostic_request_v1(p_staff_id, p_filter jsonb, p_requested_by text) → bigint` | em chạy khi anh bảo | `service_role` | tạo yêu cầu |
| `aka_agent_desktop_diagnostic_files_v1(p_request_id) → jsonb` | script tải ảnh về máy anh | `service_role` | chỉ đọc |

Job pg_cron `aka-agent-desktop-diagnostics-cleanup` (mỗi ngày): đánh `expired` và xoá ảnh quá 7 ngày.

## 5. Hàm engine sửa thân (giữ nguyên chữ ký; Zalo không đổi)

| Hàm (bản đang chạy theo repo) | Thay đổi |
|---|---|
| `aka_agent_engine_claim_target_v1` (V532) | tài khoản FB: kiểm `engine.facebook` → `not_enabled`; quyền gói FB (sản phẩm 3; sản phẩm 10 cho `fb_post_page` / `fb_message_page_inbox_customer`) → `entitlement_denied`; số tài khoản FB đang chạy theo `org_staff.max_running_facebook_accounts` (cột đã có từ V387) → `concurrency_limit`; loại không có data nhận lượt theo lịch (`slot_at`) |
| `aka_agent_engine_action_limit` (V495) | trần gói FB như bộ cũ: demo không đặt số = 30, trả phí không đặt số = không giới hạn, nhiều gói lấy số lớn nhất |
| `aka_agent_engine_report_v1` (V532) | đọc `detail_mode = inherit` và `streak_after_delivery`; lượt theo lịch |
| `aka_agent_engine_finish_campaign_v2` | "chạy lại sau N giờ khi xong" (`findDataRerunEnabled`: tìm data, comment seeding, newsfeed); lịch kế tiếp cho lượt theo lịch (nhiều khung giờ) |
| `mark_sending_v1`, `heartbeat_v1`, `release_v1`, `close_stale_v1`, `record_wait_v1`, `take_content_index_v1`, `retention_v1`, `simulate_v1`, view `aka_agent_engine_policy_lint` | chỉ thêm xử lý lượt không có data và hai thứ mới của A2 |

`mark_sending_v1` **không** thêm kiểm hạn mức giữa vòng comment (anh chốt Q10 giữ như bộ cũ; dòng "`mark_sending` có kiểm hạn mức" trong
bảng đợt 0 của phương án là chữ cũ, em sửa theo Q10).

## 6. Câu cần anh chốt

| # | Câu hỏi | Đề xuất |
|---|---|---|
| S1 | Ảnh lỗi lấy về lưu ở đâu? | **Trong DB (T6)**: chỉ RPC + một job pg_cron xoá sau 7 ngày; ảnh chỉ lên khi anh yêu cầu (vài ảnh ~100 KB mỗi yêu cầu). Phương án cũ là bucket Storage riêng tư: cần chính sách Storage cho vai trò `aka_agent_desktop` (chưa có tiền lệ, phải thử Storage có nhận vai trò riêng không) hoặc thêm Edge Function nhận ảnh, và job xoá phải gọi API Storage |
| S2 | Lượt theo lịch: đổi ba bảng engine như A1, hay không đổi bảng mà ghi số âm (`-campaign_id`) vào `input_data_id`? | **Đổi bảng như A1**: rõ ràng, chỉ đổi metadata (không viết lại bảng). Số âm không cần DDL nhưng mọi hàm và mọi câu tra cứu phải nhớ quy ước, dễ sai |
| S3 | Hai số 10 phút (block treo Q20, câu chờ Q21): cố định trong app, hay đưa vào thiết lập DB như số 20 comment? | **Đưa vào DB** như số 20: thêm hai dòng thiết lập `facebook.block_hang_minutes` = 10, `campaign.wait_note_minutes` = 10 (thiếu dòng hoặc sai = 10), Desktop đọc chung câu đọc thiết lập lúc đăng nhập, không thêm request |

## 7. Không thêm (đã cân nhắc)

- Cột cờ trên `org_organization` (Q1 chọn thiết lập; cột mới kéo trigger đồng bộ đơn CRM).
- Bảng log từng thao tác nhỏ: vết thao tác chỉ gửi khi block lỗi, nằm trong `auto_engine_outcomes.signal` (giữ 30 ngày, Q15).
- Cột mới trên `auto_runs` / `auto_run_steps` / `auto_campaign_details` / `auto_campaigns` / `auto_accounts`: mã lượt engine nằm trong biến
  của lượt workflow (R1), mã ảnh trong `auto_campaign_details.data`.
- Cột giới hạn số tài khoản FB chạy cùng lúc: đã có `org_staff.max_running_facebook_accounts`.
- Sửa `auto_error` của mã FB cũ: bộ cũ không đổi, trừ dòng anh chọn "áp cả bộ cũ" khi duyệt bảng cuối (migration riêng).
- Bucket Storage, nếu anh chọn S1 = lưu trong DB.

## 8. Dữ liệu (không phải schema), để anh biết trước

- `auto_error` thêm 3 mã `error_type = 'engine v2'` (bộ cũ bỏ qua): FB42 "Thao tác Facebook thất bại" (bắt-tất-cả sau khi gửi), FB43 "Phiên
  Facebook đã đăng xuất", FB44 "Giao diện Facebook chưa sẵn sàng" (trước khi gửi). Dùng lại mã có sẵn: SYS03 (thiếu block / workflow, R15),
  SYS04 (cửa sổ ẩn chết, block treo), UNK01, NET01 / NET02, DB01, RUN01, SYS01 / SYS02 / SYS07.
- `auto_outcome_signal_rules`: luật FB theo mã block trả, theo (thao tác, phần tử) của vết thao tác, theo câu lỗi, trang checkpoint / đăng
  nhập / câu chặn, cửa sổ ẩn chết, block treo.
- `auto_outcome_policies`: chính sách FB bản nháp giữ đúng hành vi bộ cũ, sinh bằng script từ code bộ cũ; anh duyệt bảng ở cuối rồi em
  sửa theo bảng trước khi apply.
- Dòng T1 (bảng 3.5 của phương án), T2 / T3 và bản "[engine]" của 14 workflow / 84 block: thêm khi chép ở đợt 3, không sửa dòng đang dùng.

## 9. Cách apply (khi anh bảo)

- Số migration chọn ngay trước khi viết (sổ 16/11 tới V551; kiểm sổ và `git log --all`). Mỗi hàm sửa thân có preflight md5 thân đang chạy.
- Tách: (1) bảng mới, thiết lập, hàm mới; (2) mỗi ALTER của A1 / A2 một giao dịch ngắn, `lock_timeout` 2 giây; (3) chỉ mục `CONCURRENTLY`
  chạy riêng; (4) thay thân hàm engine; (5) dữ liệu FB (mã, luật, chính sách) sau khi anh duyệt bảng. DDL làm PostgREST nạp lại schema nên
  apply ngoài giờ cao điểm.
- Trước khi apply: bộ kiểm SQL PostgreSQL 17 cục bộ, bộ kiểm và bộ kịch bản Zalo (đổi bảng Zalo đang dùng), bộ kiểm danh mục của bản cũ.
