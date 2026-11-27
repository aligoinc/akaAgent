# V674: chiến dịch qua ngày kết thúc thì dừng hẳn

**Đã apply akachat 10:09:58 VN 27/11/2026** theo yêu cầu (sổ `20261127030958`, md5 sổ = file `b4637f83…`, không apply lại). PostgREST nạp lại schema mất 10,4 giây (giờ cao điểm); có 3 lỗi 500 hết giờ 3 giây của Desktop, 0 lỗi 503. Bước dọn chạy 10:10:40–10:11:08 VN: 135 chiến dịch hoàn thành, 38.743 data được đóng, 0 lỗi. [Biên nhận](../migrations/snapshots/campaign-end-date-v674/apply-receipt.json).

Anh chốt 27/11/2026: qua ngày kết thúc mà còn data chưa gửi thì **dừng hẳn**.

## Lỗi

Khách tổ chức 2172 (chiến dịch "TEAM THẾ HIỀN - 20/11/2026", lịch tuần, ngày kết thúc 26/11) thấy chiến dịch vẫn chạy ngày 27/11. Form hiện "Ngày chạy 27/11" sau "Ngày kết thúc 26/11".

Đầu mỗi ngày, bước bảo trì lịch gặp chiến dịch có ngày chạy kế quá ngày kết thúc thì gọi hàm kết thúc. Hàm này chỉ hoàn thành khi không còn data "chờ xử lý":

- Desktop gọi `aka_agent_finalize_campaign` ([campaignRepository.ts](../src/main/data/repositories/campaignRepository.ts) `maintainCampaignSchedules`).
- App Server (VPS) và Fly (ChatApi `campaignRuntimeRepository.ts`) gọi `aka_agent_finalize_zalo_server_maintenance_campaign`.

Còn data chờ thì hàm giữ chiến dịch "chờ xử lý", nhưng bước bảo trì vẫn dời lịch sang ngày chạy kế. Chiến dịch chạy tiếp quá ngày kết thúc tới khi hết data. Lúc nhận lượt, cả bộ cũ lẫn engine v2 đều chỉ xét ngày kết thúc với chiến dịch chạy bằng Nhóm data.

Lỗi có từ V214 (30/07/2026, commit `0f8d806b`). V214 chặn một chuyện khác: data mới thêm vào đúng lúc kết thúc chiến dịch bị bỏ sót. Từ 15/05 tới 30/07, qua ngày kết thúc là chiến dịch hoàn thành ngay.

Lúc điều tra (27/11) có 136 chiến dịch "chờ xử lý", 5 "đang chạy" và 613 "tạm dừng" đã qua ngày kết thúc.

## Sửa

V674 chỉ sửa 2 hàm DB, không đổi app. Mọi bản Desktop, App Server và Fly đang chạy đều được sửa. Hai hàm đóng data còn "chờ xử lý" (trạng thái `hoàn thành`, ghi chú `Chưa gửi vì chiến dịch đã hết ngày kết thúc`) rồi hoàn thành chiến dịch, ghi chú `Chiến dịch đã hết ngày kết thúc`.

- `aka_agent_finalize_campaign` đóng data khi gặp một trong hai trường hợp:
  - Giờ DB đã qua ngày kết thúc.
  - Bước bảo trì báo ngày chạy kế quá ngày kết thúc (ghi chú `Chiến dịch đã hết ngày kết thúc`, trạng thái chờ `chờ xử lý`). Trường hợp này gặp khi ngày kết thúc rơi vào ngày không chạy.

  Hàm lấy khoá tuần tự data trước khi khoá chiến dịch, cùng thứ tự với hàm của Zalo Server.
- `aka_agent_finalize_zalo_server_maintenance_campaign` đã tự tính "ngày chạy kế quá ngày kết thúc" và đã khoá data, nên chỉ thêm bước đóng data.

Không đổi: hoàn thành thường trước ngày kết thúc (giữ chặn race của V214), chiến dịch không đặt ngày kết thúc, chiến dịch Nhóm data. Data đã chạy, "tạm dừng" hay đã xoá giữ nguyên.

Bộ sinh migration: `node scripts/build-v674-sql.cjs`, nguồn là thân production đọc 27/11 ở `scripts/fixtures/campaign-end-date/v674-live-20261127.json`. Bản gỡ không mở lại data đã đóng.

## Kiểm

Chạy `CHAT_REPO=<akaAgentChatApi> LC_ALL=C node scripts/campaign-end-date-v674-smoke.cjs`. Bài kiểm dựng PG17 cục bộ với đúng thân production của 2 hàm và các hàm phụ, gồm 20 bước:

- Bản cũ tái hiện lỗi.
- 10 ca chạy trước và sau khi apply.
- Apply, gỡ, apply lại.
- Khoá đồng thời với producer.
- Script dọn.

## Đưa lên

1. Apply V674. Đây là DDL nên PostgREST nạp lại schema: apply ngoài giờ cao điểm, trước 00:00 để lượt bảo trì đêm đó đã dùng bản mới.
2. Chạy `scripts/campaign-end-date/cleanup-overdue-v674.sql` cho các chiến dịch đang "chờ xử lý" đã qua ngày kết thúc (cần anh duyệt). Script này gọi chính hàm V674 cho từng chiến dịch và bỏ qua các chiến dịch:
   - đang giữ lượt chạy,
   - có lượt engine v2 đang mở,
   - đang tạm dừng.

   Chiến dịch "đang chạy" lúc dọn sẽ được bảo trì ngày hôm sau đóng.

Chiến dịch "tạm dừng" đã qua ngày kết thúc không bị đụng. Nếu khách bấm Tiếp tục, chiến dịch chạy tới lượt bảo trì kế tiếp rồi dừng.

## Form: ngày kết thúc bắt buộc (27/11/2026)

Anh chốt 27/11: tới ngày kết thúc là dừng hẳn (cách V674 ở trên), và lịch Theo tuần / Theo tháng luôn phải có ngày kết thúc vì chiến dịch
không thể lặp lại mãi. Phần này chỉ sửa form, không đổi database và không đổi bộ chạy.

**Tình trạng:** nhánh `claude/sweet-wozniak-w133vw` ở akaAgent và akaAgentWebApp, chưa merge, chưa deploy API / Web, chưa build Desktop.
Câu cho khách ở `src/shared/campaignScheduleEnd.ts` chờ anh duyệt.

- Ô "Ngày kết thúc" của lịch tuần / tháng giữ như trước (chiến dịch mới đặt sẵn hôm nay + 7 ngày), thêm dòng dưới ô: "Hết ngày này
  chiến dịch dừng hẳn. Data chưa gửi sẽ không gửi nữa."
- Lúc lưu, form chặn: ô trống ("Vui lòng chọn ngày kết thúc."), ngày kết thúc trước ngày chạy ("Ngày kết thúc phải từ ngày chạy trở
  đi.", đúng ca của khách tổ chức 2172), ngày kết thúc đã qua ("Ngày kết thúc đã qua. Vui lòng chọn ngày kết thúc mới."). Trước đây chỉ
  lịch Hàng ngày bật lặp mới kiểm "từ ngày chạy trở đi".
- Luật và câu chữ ở một module dùng chung: bản gốc `akaAgentWebApp/packages/control-api/src/campaignScheduleEnd.ts`, Desktop chép nguyên
  văn sang `src/shared/campaignScheduleEnd.ts` (sửa ở WebApp trước rồi chép lại). Desktop dùng ở `CampaignFormModal.tsx` và
  `CampaignAgentFormModal.tsx`.
- Lịch Hàng ngày không đổi (chỉ có ngày kết thúc của "Lặp lại sau khi chạy xong").

Kiểm (27/11): `node scripts/campaign-schedule-end-smoke.cjs` (3 nhóm, so md5 với bản WebApp),
`SCHEDULE_END_UI_CHROMIUM=/opt/pw-browsers/chromium node scripts/run-campaign-schedule-end-ui-smoke.cjs` (5 ca trên form Desktop thật với
IPC giả, chạy bằng Chromium của Playwright), hai typecheck 0 lỗi. Chưa chạy trong Electron thật, chưa thử form Agent trên giao diện.

Hệ quả cần biết:

- Chiến dịch mới để nguyên ngày đặt sẵn (+7 ngày) sẽ dừng sau 7 ngày và data chưa gửi bị đóng. 27/11: trong 8 ngày tới có 71 chiến
  dịch / 28 tổ chức / khoảng 20.250 data chờ có ngày kết thúc đúng bằng mặc định +7 ngày.
- Chiến dịch đã qua ngày kết thúc khi mở ra sửa phải chọn ngày kết thúc mới mới lưu được. Data đã bị đóng "Chưa gửi vì chiến dịch đã
  hết ngày kết thúc" không tự mở lại khi lùi ngày.
- Production 27/11 có 3 / 2.435 chiến dịch tuần / tháng (1 tổ chức) không có ngày kết thúc: vẫn chạy như cũ, form Desktop điền sẵn +7
  ngày khi mở sửa.
- Phương án "chiến dịch cũ chạy nốt data, chỉ chiến dịch lưu từ form mới mới dừng" (cột `schedule_end_strict`) đã viết thử trên nhánh
  này rồi gỡ theo quyết định của anh; không còn file nào của nó.

### Kiểm thử lặp (27/11/2026)

Theo yêu cầu kiểm thử lặp tới khi 3 vòng liền không còn lỗi. Bộ kiểm và kết quả ghi ở akaAgentWebApp `docs/CAMPAIGN_SCHEDULE_END.md`
mục "Kiểm thử lặp" (một vòng: `AKA_AGENT_REPO=<checkout này> bash scripts/campaign-schedule-end-fuzz/round.sh <hạt giống> [<json dữ liệu thật>]`
trong checkout WebApp). Phần Desktop: `WEBAPP_REPO=<checkout WebApp> node scripts/campaign-schedule-end-ui-fuzz.cjs <hạt giống> [<số ca>]`
chạy form Desktop thật trên Chromium với đồng hồ giả từng ca và hai múi giờ máy; fixture `scripts/campaign-schedule-end-ui-smoke.tsx` nay
giả cả lượt sửa chiến dịch (`updateCampaign`, hộp chọn trạng thái sau khi lưu luôn chọn tạm dừng).

Sửa ở hợp đồng dùng chung (chép lại từ WebApp, md5 trùng): ngày không có thật (`2026-13-01`, `2026-02-30`) coi như chưa chọn (trước:
`2026-13-01` lọt qua rồi form văng lỗi lúc lưu); mốc ngoài năm 0001–9999 không còn làm `scheduleEndDateKey` ném lỗi.

Desktop khác Web, có chủ ý: chiến dịch tuần / tháng chưa có ngày kết thúc thì form Desktop điền sẵn hôm nay + 7 khi mở sửa (Web để trống
bắt chọn); mốc kết thúc đang lưu không phải cuối ngày thì Desktop giữ nguyên mốc đó khi khách không đổi ngày (có dòng báo dưới ô).
