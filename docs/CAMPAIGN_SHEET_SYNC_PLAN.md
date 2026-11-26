# Đồng bộ định kỳ từ Google Sheet vào data của chiến dịch — phương án

Trạng thái (26/11/2026): **đã code đợt 1 trên nhánh `claude/pensive-sagan-4kz4zp` (anh: "Bắt đầu code phương án này"); V662 CHƯA apply, Edge CHƯA deploy, chưa đổi gì trên production.** Tình trạng từng phần ở mục 11; mục 9 lấy theo đề xuất vì anh chưa chốt khác.

## 1. Yêu cầu

- Trong form chiến dịch, khi data lấy từ một link Google Sheet (tab "Link sheet" của cửa sổ "Upload dữ liệu"), có thêm ô chọn
  **"Đồng bộ liên tục từ link Google Sheet này"**.
- Chu kỳ đồng bộ mặc định 6 giờ. Ngày dừng đồng bộ tối đa 365 ngày kể từ hôm nay.
- Khi bật, hệ thống tự đọc Sheet theo lịch và thêm dòng mới vào data của chiến dịch, kể cả khi khách tắt app / đóng trình duyệt
  (giống "Đồng bộ ngoài" của Nhóm data).
- Trong chiến dịch có nút **"Tắt đồng bộ"**.

## 2. Hiện trạng (đọc code + đọc production 26/11, chỉ đọc)

| Phần | Hiện có | Ghi chú |
|---|---|---|
| Đồng bộ Sheet của Nhóm data | V297–V301, V311; Edge Function `aka-agent-google-sheet-sync`; job pg_cron 66 gọi `aka_agent_data_group_background_tick()` mỗi 30 giây | Một làn duy nhất toàn hệ thống (lease 180 giây), mỗi lượt gọi xử lý 1 nguồn ⇒ tối đa ~120 nguồn / giờ. Production: 4 nguồn đang bật / 3 tổ chức, 7 ngày 112 lượt, 0 lỗi, trung bình 1,3 giây / lượt |
| Bộ đọc Sheet dùng chung | [googleSheetSync.ts](../src/shared/googleSheetSync.ts) (Desktop, Edge, WebApp `packages/control-api`) | CSV theo `gid`, chỉ host Google, 30 giây, 10.000 dòng / 10 MiB, kiểm tiêu đề cột không đổi, lỗi tạm thời thử lại 5 / 15 / 60 phút |
| Tab "Link sheet" của form chiến dịch | Desktop [campaignImportHandlers.ts](../src/main/ipc/handlers/campaignImportHandlers.ts), Web `POST …/utilities/import-sheet` | Cũng tải CSV theo `gid`. Đọc một lần, khách ghép cột, chọn cách xử lý ô nhiều SĐT, lọc trùng, rồi dòng vào danh sách của form. Link không được lưu lại sau khi lưu chiến dịch |
| Thêm data vào chiến dịch đã tạo | Desktop `addCampaignInputDataRows`, Web RPC `add_control_campaign_input_rows` | Cả hai từ chối khi chiến dịch `đang chạy` và đổi lịch / trạng thái chiến dịch ⇒ không dùng cho đồng bộ nền được |
| Thêm dòng từ DB khi chiến dịch đang chạy | `aka_agent_find_data_push_v1` (V608 / V610 / V614) | Mẫu đã chạy thật: khoá theo đích, lọc trùng bằng khoá chuẩn hoá + sổ, thêm dòng "chờ xử lý", mở lại đích "hoàn thành" |
| Lưu nhiều tài khoản | Một lần lưu tạo N chiến dịch; "Chia đều data cho các tài khoản" chia dòng, không chia thì mỗi chiến dịch nhận đủ | Đồng bộ phải giữ đúng cách chia này |
| SMS / gọi tự động | Nội dung từng dòng (`content`, `phone_carrier`, `schedule`) dựng ở app lúc thêm dòng (`renderMobileManagedInputContent`, API `materializeSmsInputsOrThrow`) | DB không tự dựng được ⇒ xem mục 9, câu 2 |

## 3. Hướng làm và lý do

**Chọn: nguồn đồng bộ gắn thẳng vào chiến dịch, dùng lại bộ đọc Sheet và kiểu worker của Nhóm data, chạy ở một làn riêng.**

- Bảng và hàm mới cho chiến dịch; không sửa bảng / hàm đồng bộ của Nhóm data (4 nguồn đang chạy không bị ảnh hưởng).
- Worker: Edge Function mới `aka-agent-campaign-sheet-sync`, được gọi từ chính job 30 giây đang có (thêm một khối vào
  `aka_agent_data_group_background_tick`). Không thêm job pg_cron, không thêm vòng poll ở Desktop / Web.
- Mỗi lượt gọi Edge xử lý lần lượt nhiều nguồn đến hạn trong tối đa 90 giây (không dừng ở 1 nguồn như làn Nhóm data), để số
  chiến dịch bật đồng bộ lớn vẫn kịp chu kỳ: với ~1,3–4,5 giây / nguồn là khoảng 1.000 nguồn / giờ trở lên.
- Thêm dòng bằng một hàm DB (một lệnh INSERT cho cả lượt), theo mẫu V608: chạy được khi chiến dịch đang chạy, không đổi lịch,
  mở lại chiến dịch đã "hoàn thành".

Hướng đã cân nhắc và không chọn:

| Hướng | Vì sao không chọn |
|---|---|
| Tự tạo một Nhóm data ẩn có nguồn Sheet rồi gắn chiến dịch vào nhóm | Chiến dịch thành loại "chạy bằng Nhóm data": mất "Thêm data", mất chia đều theo tài khoản, sinh nhóm lạ trong danh sách của khách, UID Zalo cần nhóm gắn tài khoản. Hành vi khác hẳn chiến dịch nhập trực tiếp mà khách đang chọn |
| Chạy trong API Web trên Fly (như bộ quét "lặp lại chiến dịch") | API Web chỉ chuẩn hoá data Zalo / SMS; chiến dịch Facebook, email tạo từ Desktop không đi được. Mỗi lần deploy API là ngắt lượt đang chạy. Bộ đọc + lease + thử lại ở Edge đã chạy ổn 2 tháng |
| Desktop tự đồng bộ khi app mở | Tắt máy là dừng; tài khoản Server (chạy trên Fly) không có máy nào mở |

## 4. Hành vi

### 4.1 Quy tắc đồng bộ

- **Chỉ thêm.** Dòng bị xoá khỏi Sheet thì data trong chiến dịch giữ nguyên. Sửa tên / info của dòng đã có thì không cập nhật.
  Đổi SĐT / UID của một dòng thì hệ thống coi là data mới.
- **Mốc ban đầu = đúng những dòng form đã đọc.** Dòng đã thêm vào chiến dịch thì nằm sẵn trong data của chiến dịch. Dòng cửa sổ
  Upload đã đọc mà không thêm (loại vì trùng / không hợp lệ / khách tự bỏ / lọc trùng với chiến dịch khác) thì app gửi khoá kèm lúc
  lưu, ghi vào cột `skipped_keys` của bảng thông tin. Các dòng đó không bao giờ được thêm lại. Lượt đồng bộ đầu chạy ngay sau khi
  lưu và chỉ thêm dòng xuất hiện trong Sheet sau lúc khách bấm "Đọc dữ liệu".
- **Lọc trùng mỗi lượt (không có bảng sổ riêng):** trùng trong Sheet, nằm trong `skipped_keys`, đã có trong data của mọi chiến
  dịch từng nhận từ nguồn (kể cả chiến dịch đã rời nguồn, dòng khách thêm tay hoặc đã xoá mềm `is_delete`). So bằng khoá chuẩn hoá
  của đúng loại dữ liệu (SĐT chuẩn hoá Việt Nam, UID / link Facebook, UID Zalo, link nhóm Zalo, email), dùng
  `aka_agent_sheet_identity` đang có. Mọi đường xoá data chiến dịch của app đều là xoá mềm, nên data của chiến dịch đủ làm sổ;
  chỉ dòng bị xoá cứng bằng SQL tay mới có thể được thêm lại.
- **Chuẩn hoá dòng giống hệt lúc nhập tay:** cùng ghép cột, cùng lựa chọn "ô chứa nhiều SĐT" (lấy số đầu / bỏ dòng / lấy tất cả)
  mà khách đã chọn trong cửa sổ Upload.
- **Chiến dịch đang chạy:** vẫn thêm; dòng mới ở trạng thái "chờ xử lý" và được chạy theo thứ tự, theo đúng hạn mức, chống gửi
  lặp, loại trừ gửi hiện có.
- **Chiến dịch đã "hoàn thành":** có ít nhất một dòng mới thì tự về "chờ xử lý" và chạy theo lịch của chiến dịch (như đẩy data
  của chiến dịch tìm data). Tiến trình chiến dịch có dòng `📥 Đồng bộ Google Sheet: đã thêm N data mới`.
- **Chiến dịch "tạm dừng":** vẫn thêm dòng, không đổi trạng thái.
- **Nhiều tài khoản trong một lần lưu:** một nguồn đồng bộ cho cả nhóm chiến dịch. Có "Chia đều data" thì mỗi dòng mới vào đúng
  một chiến dịch, chia lần lượt; không chia thì mỗi chiến dịch nhận đủ dòng mới.
- **Giới hạn:** Sheet tối đa 10.000 dòng / 10 MiB (như hiện nay); tổng data của chiến dịch không vượt
  `campaign.input_data.max_rows`; mỗi nhân viên tối đa 20 nguồn đang bật (đề xuất); chu kỳ 1–24 giờ, mặc định 6.

### 4.2 Khi nào tự dừng

| Tình huống | Kết quả | Khách thấy |
|---|---|---|
| Qua ngày dừng đồng bộ (tính hết ngày, giờ Việt Nam) | Nguồn "Đã hết hạn" | "Đã dừng đồng bộ vì hết thời hạn. Bấm Bật lại để chọn ngày mới." |
| Cột của Sheet đổi tên / đổi thứ tự | Nguồn "Lỗi", dừng | "Cột của Sheet đã thay đổi. Mở Sửa đồng bộ để ghép cột lại." |
| Sheet tắt chia sẻ, xoá tab, quá 10.000 dòng | Nguồn "Lỗi", dừng | Câu lỗi tương ứng của bộ đọc Sheet hiện có |
| Lỗi mạng / Google 5xx / quá 30 giây | Thử lại sau 5, 15, 60 phút | "Đang thử lại" kèm giờ thử lại |
| Chiến dịch bị xoá, chuyển sang chạy bằng Nhóm data, đổi loại | Chiến dịch đó rời khỏi nguồn; hết chiến dịch thì nguồn tắt | Không báo (chiến dịch không còn) |
| Lịch chiến dịch đã qua ngày kết thúc (`schedule_end_date`) | Chiến dịch đó rời khỏi nguồn | "Đã dừng đồng bộ vì chiến dịch hết thời gian chạy." |
| Nhân viên bị khoá / gói hết hạn | Bỏ qua lượt, không báo lỗi; tới hạn kế tiếp kiểm lại | Không đổi |
| Khách bấm "Tắt đồng bộ" | Chiến dịch đó rời khỏi nguồn, data đã thêm giữ nguyên | "Đã tắt đồng bộ. Data đã thêm vẫn được giữ." |

### 4.3 Loại chiến dịch được bật (đợt 1)

Mọi loại chiến dịch nhập data trực tiếp có tab "Link sheet" và có "Thêm data": Zalo (nhắn theo SĐT, theo UID, bạn bè, nhắn
nhóm, tham gia nhóm, thêm thành viên nhóm), Facebook (đăng nhóm, tham gia nhóm, nhắn UID, comment bài, comment seeding, tìm
data…), email. Không bật cho: chiến dịch chạy bằng Nhóm data, lướt newsfeed, nhóm Zalo thời gian thực, huỷ lời mời kết bạn,
chiến dịch `[Quy trình]`, và **SMS / gọi tự động** (mục 9, câu 2).

## 5. Giao diện

### 5.1 Cửa sổ "Upload dữ liệu", tab "Link sheet"

Thêm một khung ngay dưới "Lọc trùng dữ liệu", chỉ hiện khi cửa sổ mở từ form chiến dịch (không hiện ở Nhóm data, Kiểm tra SĐT)
và link là `docs.google.com/spreadsheets/…`:

```
┌ Đồng bộ định kỳ ───────────────────────────────────────────────────┐
│ ☐ Đồng bộ liên tục từ link Google Sheet này                        │
│    Đồng bộ mỗi  [ 6 ▾ ] giờ        (1 · 3 · 6 · 12 · 24)           │
│    Đồng bộ đến hết ngày  [ 26/12/2026 ]   (tối đa 365 ngày)        │
│    Hệ thống tự thêm dòng mới của Sheet vào chiến dịch. Không xoá   │
│    hay sửa data đã có. Giữ quyền "Bất kỳ ai có đường liên kết" và  │
│    không đổi thứ tự cột của Sheet.                                 │
└────────────────────────────────────────────────────────────────────┘
```

Sau khi bấm thêm dữ liệu, mục data của form có một dòng tóm tắt: `Đồng bộ Google Sheet · mỗi 6 giờ · đến 26/12/2026  [Sửa] [Bỏ]`.
Nhập lại từ link khác thì thay nguồn cũ (mỗi chiến dịch một nguồn). Nháp form giữ lựa chọn này.

Form thường và form Agent của Desktop, form Web sửa giống nhau.

### 5.2 Lúc lưu

Tạo chiến dịch như hiện nay, rồi đăng ký nguồn đồng bộ trước bước bật chiến dịch (cùng chỗ với "Sau khi chạy: đưa khách vào
nhóm"). Đăng ký lỗi thì chiến dịch vẫn được lưu, form báo "Chưa bật được đồng bộ Google Sheet" kèm nút Thử lại.

### 5.3 Trong chiến dịch

- Chi tiết chiến dịch, đầu tab data: thẻ "Đồng bộ Google Sheet" gồm link rút gọn, chu kỳ, ngày dừng, lần đồng bộ gần nhất và
  số data đã thêm, lần kế tiếp, trạng thái / lỗi; nút **Tắt đồng bộ** (có hỏi lại), **Sửa** (chu kỳ, ngày dừng, kết nối và ghép
  cột lại), **Bật lại** khi đang tắt / hết hạn, **Lịch sử** (30 lượt gần nhất: giờ, số dòng, thêm mới, trùng, không hợp lệ, lỗi).
- Menu "Hành động" của chiến dịch: mục "Tắt đồng bộ Google Sheet" khi đang bật.
- Danh sách chiến dịch: biểu tượng nhỏ cạnh tên khi chiến dịch đang đồng bộ; màu cảnh báo khi nguồn lỗi.
- Nhân bản chiến dịch: không chép nguồn đồng bộ. Xoá chiến dịch: tự rời nguồn.

Trạng thái thẻ được đọc khi mở chi tiết chiến dịch và sau mỗi thao tác; biểu tượng ở danh sách đọc bằng một lượt gọi cho cả trang
và chỉ khi nhân viên có ít nhất một nguồn. Không thêm đồng hồ poll.

## 6. Thiết kế kỹ thuật

### 6.1 DB (một migration, chỉ thêm đối tượng mới + thêm một khối vào hàm tick)

Anh chốt 26/11/2026: chỉ **hai bảng**, một bảng thông tin, một bảng log.

**`auto_campaign_sheet_syncs`** (bảng thông tin, mỗi nguồn đồng bộ một dòng; nhỏ, tối đa 20 dòng / nhân viên):

| Nhóm cột | Cột |
|---|---|
| Chủ | `id`, `organization_id`, `staff_id`, `action_id` (loại chiến dịch), `data_type` |
| Sheet | `config` jsonb: link chuẩn hoá có `gid`, có dòng tiêu đề, ghép cột, tiêu đề cột lúc kết nối, cách xử lý ô nhiều SĐT |
| Lịch | `every_hours` 1–24, `end_date`, `split_mode` (`split` / `all`) |
| Chiến dịch | `campaign_ids bigint[]` (đang nhận, chỉ mục GIN để tra "chiến dịch này có đồng bộ không"), `campaigns` jsonb: mọi chiến dịch từng nhận `[{campaignId, position, state: active/left, leftReason, joinedAt, leftAt, added}]`. Mỗi chiến dịch thuộc tối đa một nguồn đang bật: hàm `save` kiểm dưới khoá advisory theo nhân viên (mảng không đặt ràng buộc duy nhất được) |
| Mốc | `skipped_keys text[]`: khoá các dòng cửa sổ Upload đã đọc mà không thêm (mục 4.1) |
| Trạng thái | `is_enabled`, `status` (pending / running / success / retry / error / expired / paused), `next_run_at`, `last_run_at`, `last_success_at`, `last_added`, `retry_count`, `last_error_code`, `last_error_message`, `stopped_reason`, `stopped_at` |
| Worker | `lease_token`, `lease_until` (worker nhận nguồn bằng `FOR UPDATE SKIP LOCKED`, không cần bảng trạng thái worker; công tắc worker ở `campaign.sheet_sync`) |
| Kỹ thuật | `revision` (chống sửa đè), `create_request_id` (bấm lưu lại khi mạng lỗi không tạo nguồn thứ hai), `created_at`, `updated_at` |

**`auto_campaign_sheet_sync_logs`** (bảng log, mỗi sự kiện một dòng; giữ 30 ngày, dọn trong bước dọn hằng giờ của tick):

| Cột | Nội dung |
|---|---|
| `id`, `sync_id`, `organization_id`, `staff_id`, `created_at` | |
| `kind` | `run` (một lượt đồng bộ), `enable`, `edit`, `disable`, `resume`, `stop` (hệ thống tự dừng), `campaign_left` |
| `run_token` | Chỉ với `run`: mã lượt; `finish` gọi lại cùng mã thì trả lại kết quả cũ, không thêm data hai lần |
| `started_at`, `finished_at`, `status` | Chỉ với `run` |
| `rows_read`, `added`, `duplicates`, `invalid` | Chỉ với `run` |
| `per_campaign` jsonb | Số data đã thêm vào từng chiến dịch của lượt |
| `error_code`, `error_message` | Lỗi của lượt / lý do tự dừng |
| `actor` | `staff` (khách làm từ Desktop / Web / iOS) hoặc `system` |

Không có bảng sổ khoá riêng: lọc trùng dựa vào data của các chiến dịch (mục 4.1). Mỗi lượt đọc khoá của data các chiến dịch
trong `campaigns` theo `campaign_id` một lần (đọc cả dòng `is_delete`); chiến dịch lớn (vài chục nghìn dòng) tốn hơn một bảng sổ,
nhưng lượt chạy cách nhau ít nhất 1 giờ. Phần "Lịch sử đồng bộ" của thẻ chiến dịch đọc 30 dòng `kind = 'run'` gần nhất.

| Đối tượng khác | Nội dung |
|---|---|
| `aka_agent_campaign_sheet_sync(jsonb)` | Desktop, quyền `aka_agent_desktop`, nhân viên lấy từ phiên. Thao tác `state` / `save` / `stop` / `resume` / `runs` |
| `aka_agent_control_campaign_sheet_sync(staff, org, jsonb)` | API Web, quyền `service_role`, cùng lõi `private.…` |
| `aka_agent_campaign_sheet_dispatch()` / `_claim(token)` / `_finish(token, rows, …)` | Worker; `claim` / `finish` chỉ `service_role` |
| `auto_system_settings` `campaign.sheet_sync` | `{"audience":"off","worker":true,"maxSourcesPerStaff":20,"minEveryHours":1}`; `audience` off / admin_akabiz / all |

`finish` trong một giao dịch: khoá nguồn → kiểm từng chiến dịch đích (còn, đúng nhân viên / tổ chức, đúng loại, không chạy bằng
Nhóm data, chưa qua ngày kết thúc) → tính khoá, loại trùng (trong lượt, `skipped_keys`, data của mọi chiến dịch trong `campaigns`,
đọc theo `campaign_id` một lần) → chia dòng theo cách chia → khoá `aka_agent_lock_campaign_input_serialization` theo thứ tự id
chiến dịch → một lệnh INSERT `auto_campaign_input_data` ("chờ xử lý") → mở lại chiến dịch "hoàn thành" bằng CAS → ghi dòng tiến
trình → cập nhật dòng thông tin (`campaigns[].added`, trạng thái, `next_run_at = now + every_hours`) → ghi một dòng log `run`.
Trần 60 giây như hàm của Nhóm data.

Không ALTER bảng nóng (`auto_campaigns`, `auto_campaign_input_data`), không trigger mới trên bảng nóng. DDL nên apply buổi tối.

### 6.2 Edge Function `aka-agent-campaign-sheet-sync`

Chép khung của `aka-agent-google-sheet-sync` (xác thực `x-internal-token`, không nhận link / id từ bên gọi). Vòng lặp tới 90 giây:
`claim` → `readGoogleSheet` → chuẩn hoá dòng → `finish`. Chuẩn hoá dùng một module thuần mới trong `src/shared`
(`campaignSheetSync.ts`) gọi lại đúng các hàm của cửa sổ Upload ([campaignImportVerification.ts](../src/shared/campaignImportVerification.ts)),
để kết quả đồng bộ trùng với kết quả nhập tay. Việc cần kiểm khi code: module này phải nạp được trên Deno (đuôi `.ts`, không kéo
cả `types.ts`).

### 6.3 Hợp đồng dùng chung

`packages/control-api/src/campaignSheetSync.ts` ở WebApp (sửa ở WebApp trước), chép nguyên văn sang `src/shared` của Desktop,
bài kiểm so md5: kiểu dữ liệu, giới hạn (mặc định 6 giờ, tối đa 365 ngày, tính theo giờ Việt Nam), đổi cấu hình ghép cột của cửa
sổ Upload thành cấu hình nguồn, tính khoá mốc ban đầu, câu chữ trạng thái.

### 6.4 Desktop

- `CampaignDataUploadModal`: prop mới `sheetSync` (như `duplicateCheck`), khung 5.1, trả lựa chọn + cấu hình + khoá mốc cho form.
- `CampaignFormModal`, `CampaignAgentFormModal`: giữ lựa chọn trong `formData`, dòng tóm tắt, đăng ký ở `saveCompletion.finish`.
- Một kênh IPC `campaign-sheet-sync:call` → repository → RPC; trả `{ok,data}|{ok:false,code,message}`; DB chưa có hàm thì ẩn tính năng.
- `CampaignPanel`: thẻ 5.3, mục menu, biểu tượng danh sách.

### 6.5 Web / API / iOS

- API: `POST /api/aka-agent/control/v1/campaigns/sheet-sync/:action` qua `withAuth`; `save` đọc lại Sheet ở server để kiểm cấu hình.
- Web: cửa sổ Upload, form, chi tiết chiến dịch như Desktop.
- iOS: đợt 1 chỉ xem trạng thái và "Tắt đồng bộ".

## 7. Tải hệ thống

- Mỗi lượt đồng bộ = 1 `claim` + 1 lượt tải CSV (ở Edge) + 1 `finish`. Không gọi theo từng dòng.
- Một làn tuần tự nên DB không bao giờ chạy song song hai lượt `finish` của chiến dịch.
- `finish` đọc data đang có của chiến dịch một lần theo `campaign_id`; chiến dịch 60.000 dòng ước ~0,4 giây (số đo cục bộ của V610
  cho cùng kiểu đọc). Sẽ đo lại trên bản sao dữ liệu thật trước khi apply.
- Desktop / Web không thêm vòng poll; máy đang cài bản cũ không gọi gì mới.

## 8. Kiểm thử và thứ tự đưa lên

Kiểm thử: bài SQL trên Postgres cục bộ (tạo / sửa / tắt / bật lại, mốc ban đầu, trùng, chia nhiều chiến dịch, chiến dịch đang
chạy / hoàn thành / tạm dừng / đã xoá, hết hạn, lease hết hạn, gọi lại cùng token, hai giao dịch giành khoá với lượt nhận data
của engine v2); bài bộ đọc (ô nhiều SĐT, cột đổi, giới hạn); bài giao diện Desktop + Web; chạy thật bằng một Sheet công khai trên
tổ chức 1 qua job thật.

Thứ tự: apply migration (worker tắt) → deploy Edge, kiểm 401 / 200 → bật worker → deploy API / Web → phát hành Desktop →
`audience: admin_akabiz` → thử thật → `audience: all`. Tắt khẩn: `worker: false` (dừng mọi lượt, giữ data) hoặc `audience: off`
(ẩn ô chọn, nguồn đang bật vẫn chạy).

## 9. Cần anh chốt

| # | Câu hỏi | Đề xuất |
|---|---|---|
| 1 | Ngày dừng mặc định (anh mới cho mức tối đa 365 ngày) | Hôm nay + 30 ngày; nếu lịch chiến dịch có ngày kết thúc thì lấy ngày đó |
| 2 | SMS / gọi tự động có vào đợt 1 không | Đợt 2. Cần tách hàm dựng nội dung SMS sang `src/shared` để Edge dựng `content` từng dòng |
| 3 | Lượt đầu chỉ thêm dòng xuất hiện sau lúc khách đọc Sheet trong form (mục 4.1) | Đồng ý như mô tả |
| 4 | Nhiều tài khoản + chia đều: dòng mới chia lần lượt cho các chiến dịch còn bật | Đồng ý như mô tả |
| 5 | Mỗi lượt đồng bộ có đối chiếu "Lọc trùng dữ liệu" với chiến dịch khác không | Đợt 1 không (hàm đối chiếu hiện chỉ có cho nhắn theo SĐT và từng đo tới 15 giây cho 2.000 số khi dữ liệu chưa vào bộ nhớ đệm). Trùng người nhận giữa chiến dịch vẫn do "Không gửi cho" và chống gửi lặp xử lý lúc gửi |
| 6 | Chiến dịch đã hoàn thành có data mới thì tự chạy lại | Có |
| 7 | Chu kỳ ngắn nhất và số nguồn tối đa mỗi nhân viên | 1 giờ; 20 nguồn đang bật |
| 8 | Bật đồng bộ cho chiến dịch đã tạo (qua "Thêm data" bằng link sheet) | Đợt 2 |

## 10. Chia đợt

- **Đợt 1:** DB + Edge + hợp đồng dùng chung; Desktop (cửa sổ Upload, hai form, thẻ trong chiến dịch, Tắt / Sửa / Bật lại / Lịch sử);
  API + Web tương ứng; iOS xem + tắt.
- **Đợt 2:** SMS / gọi tự động; bật từ "Thêm data" cho chiến dịch đã tạo; thông báo (chuông) khi nguồn lỗi hoặc sắp hết hạn;
  iOS bật / sửa; đối chiếu trùng với chiến dịch khác theo lựa chọn của khách.

## 11. Tình trạng code (26/11/2026)

Câu ở mục 9 dùng đúng cột "Đề xuất" (anh chưa chốt khác). Mọi thứ dưới đây ở nhánh `claude/pensive-sagan-4kz4zp`, chưa merge.

| Phần | Chỗ | Kiểm |
|---|---|---|
| DB | [migration_v662_campaign_sheet_sync.sql](../migrations/migration_v662_campaign_sheet_sync.sql) + [gỡ](../migrations/rollback_v662_campaign_sheet_sync.sql): 2 bảng, cài đặt `campaign.sheet_sync` (`audience: off`, `worker: false`), RPC Desktop `aka_agent_campaign_sheet_sync`, RPC Web `aka_agent_control_campaign_sheet_sync`, `_claim` / `_finish` cho Edge, khối thứ tư trong tick nhóm data (khoá md5 thân production `10a2465b…`) | `python3 scripts/campaign-sheet-sync/test_v662.py` (PG16, 75 PASS, có apply lại bị từ chối + gỡ trả đúng thân tick) |
| Edge | `supabase/functions/aka-agent-campaign-sheet-sync/` (`index.ts` + `core.generated.js` dựng bằng `node scripts/campaign-sheet-sync/build-edge-core.cjs`, `--check` để so) | `node scripts/campaign-sheet-sync/rows-smoke.cjs` (14 PASS: dòng ra khớp cửa sổ Upload, cột đổi, giới hạn, danh sách loại chiến dịch khớp SQL, bản dựng mới nhất) |
| Hợp đồng | `src/shared/campaignSheetSync.ts` (chép nguyên văn sang WebApp `packages/control-api`), `src/shared/campaignSheetSyncRows.ts` | như trên |
| Desktop | IPC `campaign-sheet-sync:call` ([repository](../src/main/data/repositories/campaignSheetSyncRepository.ts)); ô trong tab Link sheet; dòng tóm tắt trong form thường + form Agent (chỉ giữ trong phiên mở form, không vào nháp); thẻ đầu tab Data của chiến dịch (Sửa, Tắt, Bật lại, Gia hạn, Kết nối lại khi cột đổi, Lịch sử); biểu tượng cạnh tên + mục "Tắt đồng bộ Google Sheet" trong menu Hành động | `node scripts/run-campaign-sheet-sync-ui-smoke.cjs` (10 PASS, Chromium + IPC giả); hai typecheck sạch |
| Web / API / iOS | akaAgentWebApp cùng tên nhánh | đang làm |

Chưa có: chạy trong Electron thật, chạy thật với Sheet công khai qua job thật (cần apply + deploy). Thứ tự đưa lên như mục 8.
