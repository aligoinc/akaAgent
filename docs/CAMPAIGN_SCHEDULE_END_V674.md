# Ngày kết thúc bắt buộc, dừng chiến dịch đúng ngày (V674)

> **DỪNG, KHÔNG APPLY các file V674 của nhánh này (ghi 10:30 VN 27/11/2026).** Lúc 10:09:58 VN 27/11 một phiên khác đã apply lên
> production `migration_v674_campaign_end_date_close_pending` (sổ `20261127030958`): cùng số 674, cùng sửa `aka_agent_finalize_campaign`
> (md5 `8a189852…` → `d7254364…`) và `aka_agent_finalize_zalo_server_maintenance_campaign`. Bản đó dừng hẳn MỌI chiến dịch data trực
> tiếp đã qua ngày kết thúc và đóng data còn chờ ("Chưa gửi vì chiến dịch đã hết ngày kết thúc"), không phân biệt chiến dịch cũ / mới;
> 10:10–10:11 VN đã đóng 132 chiến dịch / 61 tổ chức / 38.743 data. Cách đó khác phương án A của tài liệu này. p2 của nhánh này sẽ tự
> dừng ở bước kiểm md5; p1 thì không bị chặn (thêm cột không ai dùng), nên đừng chạy. Chờ anh chốt hướng rồi viết lại migration với số mới.

27/11/2026. Anh chốt phương án A sau khi xem ca của nhân viên 2398 (chiến dịch 59210: ngày kết thúc 26/11 mà 27/11 vẫn chạy).

**Bổ sung cùng ngày (anh: "Luôn phải có ngày kết thúc vì chiến dịch không thể cứ lặp lại mãi, như cách hiện tại đang cài đặt"):** lịch
Theo tuần / Theo tháng luôn bắt buộc có ngày kết thúc. Bỏ ô tích "Đặt ngày kết thúc" và trạng thái "không có ngày kết thúc" của bản đầu;
chiến dịch mới vẫn đặt sẵn hôm nay + 7 ngày như form trước đây. Phần form và module dùng chung đã sửa theo; phần database (mục 3) chưa
sửa lại vì còn chờ anh chốt hướng (xem khung trên).

**Tình trạng:** đã code ở nhánh `claude/sweet-wozniak-w133vw` (akaAgent và akaAgentWebApp). Chưa merge, chưa apply V674, chưa deploy API / Web,
chưa build Desktop. Câu cho khách ở `src/shared/campaignScheduleEnd.ts` chờ anh duyệt.

## 1. Vì sao phải sửa

Với chiến dịch nhập data trực tiếp, lịch Theo tuần / Theo tháng, ngày kết thúc trước đây chỉ có tác dụng khi chiến dịch đã chạy hết data
(ngừng làm mới data). Còn data chờ thì chiến dịch chạy nốt, ngày này qua ngày khác:

- Bước nhận lượt không xét ngày kết thúc (`private.campaign_dispatch_schedule_allowed`, claim của engine v2 chỉ chặn nguồn Nhóm data).
- Bước cập nhật lịch ngày mới gọi hàm kết thúc, nhưng hàm kết thúc có chốt "còn data chờ thì về chờ xử lý" (V214, 30/07/2026).
- Form Desktop và Web đặt sẵn ngày kết thúc = ngày tạo + 7 ngày, và không kiểm ngày kết thúc phải từ ngày chạy trở đi.

Số đo production (chỉ đọc, 27/11): từ 01/08 có 321 / 1.240 chiến dịch tuần / tháng chạy sau ngày kết thúc; 30 ngày gần nhất 157 chiến
dịch, khoảng 34.500 dòng Lịch sử hành động sau hạn. Từ 01/09, 545 / 2.052 chiến dịch tuần / tháng có ngày kết thúc đúng bằng mặc định +7
ngày, nên không thể dừng cứng cho mọi chiến dịch đang có.

## 2. Luật mới

| Chiến dịch | Ngày kết thúc | Cách chạy |
|---|---|---|
| Tạo từ form mới (luôn có ngày kết thúc, đặt sẵn hôm nay + 7 ngày) | `schedule_end_date` + `schedule_end_strict = true` | Hết ngày đó chiến dịch "hoàn thành" kèm ghi chú "Chiến dịch đã hết ngày kết thúc", kể cả còn data chờ. Data chờ giữ nguyên. |
| Chiến dịch cũ (có ngày kết thúc, `schedule_end_strict = false`), khách chưa đổi ngày | giữ nguyên | Như trước: sau ngày đó không làm mới data, data còn chờ chạy nốt. Danh sách hiện nhãn "Đã qua ngày kết thúc, đang chạy nốt data còn chờ". |
| Chiến dịch cũ chưa có ngày kết thúc (production 27/11: 3 / 2.435 chiến dịch tuần / tháng, 1 tổ chức) | không có | Chạy như trước tới khi khách mở sửa; lúc lưu form bắt chọn ngày kết thúc. |
| Chiến dịch cũ, khách mở form mới và đổi ngày kết thúc | ngày mới + `schedule_end_strict = true` | Dừng đúng ngày. |
| Chiến dịch Nhóm data | như trước | Vốn đã dừng đúng ngày (hàm kết thúc riêng). |
| Lịch Hàng ngày | như trước | Chỉ có ngày kết thúc của "Lặp lại sau khi chạy xong". |

Form (Desktop hai form, Web hai form): lịch tuần / tháng luôn có ô "Ngày kết thúc" (không có ô tích), chiến dịch mới đặt sẵn hôm nay +
7 ngày, dưới ô ghi "Hết ngày này chiến dịch dừng, kể cả khi còn data chưa chạy." Lúc lưu: chưa chọn ngày, ngày trước ngày chạy, hoặc
ngày đã qua thì báo lỗi và không lưu. Vì vậy chiến dịch cũ đã qua ngày kết thúc (như 59210) khi mở ra sửa phải chọn ngày mới.

Luật và câu chữ nằm ở một module dùng chung: bản gốc `akaAgentWebApp/packages/control-api/src/campaignScheduleEnd.ts`, Desktop chép
nguyên văn sang `src/shared/campaignScheduleEnd.ts` (sửa ở WebApp trước rồi chép lại).

## 3. Database (V674, sinh bằng `node scripts/build-v674-sql.cjs`)

- **p1** `migration_v674_campaign_schedule_end_strict_p1.sql`: cột `auto_campaigns.schedule_end_strict boolean NOT NULL DEFAULT false`
  và quyền ghi theo cột cho `aka_agent_desktop`. Giao dịch riêng, ngắn.
- **p2** `..._p2.sql`: thay thân 4 hàm (giữ chữ ký, chủ sở hữu, quyền; nguồn là `pg_get_functiondef` production 27/11, kiểm md5 trước / sau):
  - `aka_agent_finalize_campaign` (Desktop: cập nhật lịch ngày mới, chạy hết data) và
    `aka_agent_internal_finalize_zalo_server_maintenance_guard` (App Server, Fly): chiến dịch có `schedule_end_strict` mà
    `schedule_end_date` đã qua thì hoàn thành kể cả còn data chờ, và chiến dịch đã hoàn thành không bị mở lại vì còn data chờ.
  - `create_control_campaign_v2` (đọc `scheduleEndStrict`), `update_control_campaign_atomic` (đọc khoá `schedule_end_strict`).
  - Thêm `private.aka_agent_campaign_schedule_end_sweep(integer)` và job pg_cron `aka-agent-campaign-schedule-end` (mỗi phút): đóng chiến
    dịch `schedule_end_strict` đã qua ngày kết thúc mà còn "chờ xử lý" (lịch kế chưa tới, khách bấm chạy lại, data mới đẩy vào). Không
    đụng chiến dịch đang chạy, còn token của bộ cũ, còn giữ chỗ của bộ mới, đã xoá, Nhóm data.
- **p3** `..._p3.sql`: `CREATE INDEX CONCURRENTLY idx_auto_campaigns_schedule_end_strict` (một lệnh, chạy riêng ngoài giao dịch). Không
  có thì job vẫn đúng, chỉ quét cả bảng mỗi phút.
- Gỡ: `rollback_v674_campaign_schedule_end_strict.sql`.

Chưa chiến dịch nào bật cột nên apply xong chưa đổi gì; chỉ form mới bật cột. Mọi bản app (kể cả Desktop cũ, App Server, Fly) đều dừng
đúng ngày vì việc dừng nằm ở DB.

## 4. Desktop

- `src/shared/campaignScheduleEnd.ts` (bản chép).
- `CampaignFormModal.tsx`, `CampaignAgentFormModal.tsx`: ô ngày bắt buộc, dòng giải thích, kiểm lúc lưu, gửi `scheduleEndStrict`.
- `campaignRepository.ts`: đọc / ghi cột; DB chưa có cột thì đọc lại không cột và ghi lại không cột (chiến dịch chạy theo cách cũ).
- `CampaignInfoView.tsx` (dòng Ngày kết thúc ghi "dừng đúng ngày" / "sau ngày này chạy nốt data còn chờ"), `CampaignPanel.tsx` (nhãn ở
  danh sách cho chiến dịch cũ đã qua hạn mà còn chạy).

## 5. Kiểm thử

| Lệnh | Kết quả 27/11 |
|---|---|
| `bash scripts/test-v674-campaign-schedule-end.sh` (PG16 cục bộ, nguyên văn 4 hàm production) | 53 kiểm đạt |
| `node scripts/campaign-schedule-end-smoke.cjs` (luật dùng chung, so md5 với bản WebApp) | 5 nhóm đạt |
| `SCHEDULE_END_UI_CHROMIUM=/opt/pw-browsers/chromium node scripts/run-campaign-schedule-end-ui-smoke.cjs` (form Desktop thật, IPC giả) | 7 ca đạt |
| `npx tsc --noEmit -p tsconfig.node.json`, `-p tsconfig.web.json` | 0 lỗi |

Chưa kiểm: chạy trong Electron thật, đường lưu sửa chiến dịch qua IPC thật, form Agent trên giao diện, DB thật (chưa apply).
`campaign-repeat-scheduler-smoke.cjs` và `campaign-shared-schedule-smoke.cjs` hỏng sẵn trong container này (bài kiểm chưa theo #784;
thiếu `node_modules` của ChatApi), không do thay đổi này.

## 6. Thứ tự đưa lên

1. Kiểm lại sổ migration (số 674 còn trống; V672 chưa có trong sổ, có thể nhánh khác đang giữ).
2. Apply p1 → p2 (buổi tối: p2 thay 4 hàm nên PostgREST nạp lại schema) → p3 (chạy riêng).
3. Deploy API / Web của akaAgentWebApp.
4. Build và phát hành Desktop.

Làm ngược (app trước DB) không lỗi: app đọc / ghi lại không cột, nhưng khi đó ngày kết thúc khách đặt chưa dừng được chiến dịch.

## 7. Giới hạn đã biết

- Chiến dịch tạo bằng app cũ (Desktop ≤ 10.8.0, iOS đã phát hành, tab Web chưa tải lại) vẫn là kiểu cũ: mặc định +7 ngày, không dừng
  đúng ngày.
- Chiến dịch mới để nguyên ngày đặt sẵn (+7 ngày) sẽ dừng sau 7 ngày kể cả còn data chờ. Data chờ giữ nguyên; khách sửa ngày kết thúc
  thì chiến dịch chạy tiếp.
- Khách bấm Tiếp tục một chiến dịch đã dừng theo ngày kết thúc: job đóng lại trong vòng 1 phút. Muốn chạy tiếp phải sửa ngày kết thúc.
- Data mới đẩy vào chiến dịch đã dừng theo ngày (tìm data đẩy sang, Thêm data) mở lại chiến dịch rồi job đóng lại, mỗi lần một thông
  báo "hoàn thành".
- `aka_agent_engine_finalize_v501` (kết thúc lượt của engine v2) chưa vá: trường hợp hiếm nó trả chiến dịch về "chờ xử lý" thì job
  đóng trong vòng 1 phút.
- Hai hàm tính phiên bản cấu hình (`aka_agent_campaign_config_version`, `aka_agent_desktop_campaign_config_version`) chưa tính cột mới.
