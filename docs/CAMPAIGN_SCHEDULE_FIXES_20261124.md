# Ba lỗi hẹn giờ khách báo (24/11/2026)

Anh duyệt phương án ngày 24/11/2026 ("Vậy hãy thực thi phương án"). Nguyên tắc: khách đặt lịch thế nào thì app chạy đúng như vậy, và chữ hiện ra phải nói đúng việc app đang làm.

## Lỗi và cách sửa

| Ca | Khách | Lỗi | Sửa |
|---|---|---|---|
| 1 | Ngoc Vo (chưa tìm ra tài khoản; ca cùng kiểu: chiến dịch 59389) | Hằng ngày, có giờ dừng, không tích "hôm sau tiếp tục" → bảo trì giữ lịch cũ, chiến dịch chạy tiếp từ 00:00. 7 ngày tới 24/11: 21/51 chiến dịch như vậy gửi 0–6h (25% số lượt). | Có giờ dừng + không tích = chỉ chạy ngày đầu. Bảo trì đầu ngày: đã chạy được data nào thì đóng data còn lại (ghi chú `SINGLE_DAY_STOP_INPUT_NOTE`) và hoàn thành; chưa chạy data nào (app tắt cả ngày đầu) thì hẹn giờ chạy hôm nay như có tích. Không đặt giờ dừng thì giữ như cũ (chạy liên tục qua đêm). |
| 2 | Ly Ocean Park (tổ chức 1353) | Lịch tuần / tháng có làm mới data, chạy xong danh sách trong ngày → "✅ Hoàn thành chiến dịch" tới lượt bảo trì ngày chạy kế. | Không hoàn thành: đặt lại data (trừ "tạm dừng"), về "chờ xử lý", hẹn ngày chạy kế, dòng "⏳ Đã hoàn thành lượt chạy và hẹn chạy lại chiến dịch … lúc …". |
| 3 | Lê Minh Đức (tổ chức 1392) | Lịch tuần / tháng có làm mới data: một data "tạm dừng" (nhóm Zalo đã mất, mã 161, `input_effect = pause`) làm bảo trì không bao giờ làm mới data. 33 chiến dịch / 13 nhân viên đứng "hoàn thành". | "Tạm dừng" coi như xong (`isRefreshablePassDone`), cần ít nhất một dòng "hoàn thành". 33 chiến dịch tự chạy lại ở lần bảo trì đầu ngày đầu tiên sau khi nơi chạy có bản mới. |

Luật chung: [src/shared/campaignRecurringPass.ts](../src/shared/campaignRecurringPass.ts).

## Chỗ sửa

| Nơi | Ca 1 | Ca 2 | Ca 3 |
|---|---|---|---|
| Desktop + App Server: `maintainCampaignSchedules` ([campaignRepository.ts](../src/main/data/repositories/campaignRepository.ts)), `handleRecurringRefreshAfterCompletion` ([campaignScheduler.ts](../src/main/services/campaignScheduler.ts)) | ✓ | ✓ (bộ cũ) | ✓ |
| Engine v2: `aka_agent_engine_finish_campaign_v2` → [V648](../migrations/migration_v648_engine_recurring_refresh_pass.sql), sinh bằng `node scripts/build-v648-sql.cjs` | – | ✓ | – |
| ChatApi (Fly): `maintainCampaign` trong `packages/database/src/campaignRuntimeRepository.ts`, nhánh `claude/epic-ritchie-cd8thr` | ✓ | – | ✓ |
| Form Desktop (thường + Agent), form Web (bản 1, bản 2) + `campaignSendPlan` ở akaAgentWebApp nhánh `claude/campaign-schedule-fixes` | chữ giải thích | – | – |

Ghi chú:

- Ca 1 không đổi hàm DB nhận lượt (`aka_agent_claim_campaign_runtime_v2`, engine claim). Nếu hàm nhận lượt từ chối lịch cũ của chiến dịch không tích, bản app cũ gặp `daily_maintenance_required` sẽ chạy lại bảo trì rồi nhận lượt lại ngay trong vòng lặp không dừng ([campaignScheduler.ts](../src/main/services/campaignScheduler.ts) nhánh `claimed.reason === 'daily_maintenance_required'`), mà bảo trì của bản cũ không đổi gì cho loại chiến dịch này. Vì vậy máy chưa cập nhật vẫn chạy kiểu cũ tới khi cập nhật.
- Ca 2 ở engine trả lý do `rerun_scheduled` (đã có câu tiến trình ở mọi bản lõi), nên Desktop / Fly không cần cập nhật lõi.
- Ca 2 ở bộ cũ trên Zalo Server: chỉ nhắn bạn bè / nhắn nhóm (RPC `aka_agent_advance_zalo_server_multi_daily_slot` chỉ nhận hai loại); loại khác vẫn hoàn thành rồi bảo trì làm mới (có ca 3 thì không còn đứng).
- Bộ chạy cũ trên Fly (ChatApi `zaloCampaignExecutor`) chưa đổi ca 2.

## Kiểm thử

- `node scripts/campaign-schedule-fixes-smoke.cjs` (12 nhóm: hàm thật `maintainCampaignSchedules`, `resolveNextRecurringRun`, `handleRecurringRefreshAfterCompletion` với kho giả).
- `CHAT_REPO=<thư mục có module pg> PG17_BIN=<bin Postgres> LC_ALL=C node scripts/engine-v2-recurring-refresh-v648-smoke.cjs` (7 nhóm, Postgres cục bộ; chạy bằng user không phải root vì `initdb` từ chối root: `runuser -u postgres -- env HOME=/tmp ...`). Phải chạy trước 23:00 giờ Việt Nam.
- ChatApi: `npx vitest run packages/database/src/campaignScheduleMaintenance.integration.test.ts` (14), `npm run verify`.
- akaAgentWebApp: `packages/campaign-core` `campaignSendPlan.test.ts`, `apps/web` typecheck + bài kiểm form.

## Thứ tự đưa lên

1. Apply V648 buổi tối (DDL, PostgREST nạp lại schema). Gỡ: `rollback_v648_engine_recurring_refresh_pass.sql`.
2. Deploy ChatApi `worker` (bảo trì lịch Fly chạy trong worker).
3. Build Desktop + App Server, cài App Server lên VPS (ca của Lê Minh Đức hết ngay ở lần bảo trì đầu ngày sau khi cài).
4. Deploy Web.
