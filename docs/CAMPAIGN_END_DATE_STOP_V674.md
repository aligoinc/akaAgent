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
