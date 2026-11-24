# Ba lỗi hẹn giờ khách báo (24/11/2026)

Anh duyệt phương án ngày 24/11/2026 ("Vậy hãy thực thi phương án"). Nguyên tắc: khách đặt lịch thế nào thì app chạy đúng như vậy, và chữ hiện ra phải nói đúng việc app đang làm.

**Đổi số 25/11/2026:** migration của engine v2 lúc viết mang số V648; sổ production đã có `migration_v648_notification_email_opt_out` (akaAgentWebApp, apply 21:57 VN 24/11) và V649, nên đổi thành **V650** theo yêu cầu ("Đổi số V650"). Chỉ đổi số: thân hàm mới giữ md5 `9b29fe98…`, cách gỡ không đổi. Các mục dưới đã ghi số mới.

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
| Engine v2: `aka_agent_engine_finish_campaign_v2` → [V650](../migrations/migration_v650_engine_recurring_refresh_pass.sql), sinh bằng `node scripts/build-v650-sql.cjs` | – | ✓ | – |
| ChatApi (Fly): `maintainCampaign` + `parseNumberList` trong `packages/database/src/campaignRuntimeRepository.ts`, nhánh `claude/epic-ritchie-cd8thr` | ✓ | – | ✓ |
| Form Desktop (thường + Agent), form Web (bản 1, bản 2) + `campaignSendPlan` ở akaAgentWebApp nhánh `claude/campaign-schedule-fixes` | chữ giải thích | – | – |

Ghi chú:

- Ca 1 không đổi hàm DB nhận lượt (`aka_agent_claim_campaign_runtime_v2`, engine claim). Nếu hàm nhận lượt từ chối lịch cũ của chiến dịch không tích, bản app cũ gặp `daily_maintenance_required` sẽ chạy lại bảo trì rồi nhận lượt lại ngay trong vòng lặp không dừng ([campaignScheduler.ts](../src/main/services/campaignScheduler.ts) nhánh `claimed.reason === 'daily_maintenance_required'`), mà bảo trì của bản cũ không đổi gì cho loại chiến dịch này. Vì vậy máy chưa cập nhật vẫn chạy kiểu cũ tới khi cập nhật.
- Ca 2 ở engine trả lý do `rerun_scheduled` (đã có câu tiến trình ở mọi bản lõi), nên Desktop / Fly không cần cập nhật lõi.
- Ca 2 ở bộ cũ trên Zalo Server: chỉ nhắn bạn bè / nhắn nhóm (RPC `aka_agent_advance_zalo_server_multi_daily_slot` chỉ nhận hai loại); loại khác vẫn hoàn thành rồi bảo trì làm mới (có ca 3 thì không còn đứng).
- Bộ chạy cũ trên Fly (ChatApi `zaloCampaignExecutor`) chưa đổi ca 2.

## Kiểm thử

- `node scripts/campaign-schedule-fixes-smoke.cjs` (12 nhóm: hàm thật `maintainCampaignSchedules`, `resolveNextRecurringRun`, `handleRecurringRefreshAfterCompletion` với kho giả).
- `CHAT_REPO=<thư mục có module pg> PG17_BIN=<bin Postgres> LC_ALL=C node scripts/engine-v2-recurring-refresh-v650-smoke.cjs` (7 nhóm, Postgres cục bộ; chạy bằng user không phải root vì `initdb` từ chối root: `runuser -u postgres -- env HOME=/tmp ...`). Phải chạy trước 23:00 giờ Việt Nam.
- ChatApi: `npx vitest run packages/database/src/campaignScheduleMaintenance.integration.test.ts` (14), `npm run verify`.
- akaAgentWebApp: `packages/campaign-core` `campaignSendPlan.test.ts`, `apps/web` typecheck + bài kiểm form.

## Giả lập nhiều vòng (24/11/2026, anh yêu cầu "Kiểm thử và cải tiến … cho đến khi ít nhất 3 vòng không còn vấn đề")

`scripts/schedule-fixes-sim/` (lib.cjs: sinh ca + luật kiểm độc lập + hàm thật của Desktop; engine.cjs: engine v2 trên Postgres cục bộ;
run.cjs: một vòng). Mỗi vòng: mẫu ngẫu nhiên production (chỉ GET qua REST, không ghi; ghi ra thư mục `--out`, không commit), ca tổng
hợp, ca cố tình sai (ngày "0x1f", "1-31", "16.17.18", tên tỉnh, loại lịch " weekly", trạng thái lạ, data đã xoá, ngày kết thúc sát giờ…),
ngày "hôm nay" đổi theo vòng (cuối tháng, 29/02, đầu năm). So: bảo trì đầu ngày (luật ↔ Desktop, Desktop ↔ ChatApi trên PGlite qua
bài kiểm opt-in `campaignScheduleMaintenanceSim.integration.test.ts`), kết thúc lượt (luật ↔ Desktop, luật ↔ engine v2), bất biến (data
"tạm dừng" không bao giờ bị đổi).

Chạy một vòng (user không phải root vì `initdb`; cần chép CA của proxy cho user đó):

```
runuser -u postgres -- env HOME=/tmp NODE_EXTRA_CA_CERTS=<ca> CURL_CA_BUNDLE=<ca> SIM_SEED=<số> CHAT_REPO=<module pg> \
  PG17_BIN=/usr/lib/postgresql/16/bin CHATAPI_DIR=<checkout ChatApi> LC_ALL=C node scripts/schedule-fixes-sim/run.cjs --out <thư mục>
```

| Vòng | Ca | Kết quả | Sửa |
|---|---|---|---|
| 1 | 1.954 (154 production) | 54 lệch | Desktop + ChatApi đọc ngày dạng hệ 16 ("0x1f" = 31) trong khi engine bỏ qua → cả ba chỉ nhận số thập phân (`SCHEDULE_DAY_TOKEN`; V650 lọc cùng mẫu). Desktop hẹn lượt kế cho chiến dịch Zalo không có data, engine hoàn thành → Desktop hoàn thành (trừ Facebook không cần data). |
| 2 | 1.904 + 477 engine | 13 lệch | **V650 đặt bước mới trước "chạy lại sau N giờ"**: lịch tuần / tháng bật chạy lại sau N giờ bị hẹn sang ngày chạy kế → dời bước 5c ra sau, đúng thứ tự Desktop. |
| 3 | 1.929 + 481 | 4 lệch (bộ giả lập) | Bỏ qua. |
| 4 | 1.904 + 482 | sạch | |
| 5 | 3.195 + 765 | sạch | |
| 6 | 3.220 + 766 | 1 lệch | Loại lịch " weekly": engine (lower/btrim) coi là lịch tuần, Desktop coi là không hợp lệ → V650 so khớp đúng ký tự. |
| 7, 8, 9 | 3.195 / 3.270 / 3.220 + ~765 | sạch ×3 | |

Các lệch của bộ giả lập (đã sửa ở bộ giả lập, không phải code): DB chỉ cho 4 trạng thái data (`auto_campaign_input_data_status_check`)
nên ca trạng thái lạ không chạy ở engine; lúc kết thúc lượt không có data "đang chạy"; lịch lúc nhận lượt của engine khác lịch của ca khi
chiến dịch không có lịch gốc; mẫu production trùng chiến dịch.

## Thứ tự đưa lên

1. Apply V650 buổi tối (DDL, PostgREST nạp lại schema). Gỡ: `rollback_v650_engine_recurring_refresh_pass.sql`.
2. Deploy ChatApi `worker` (bảo trì lịch Fly chạy trong worker).
3. Build Desktop + App Server, cài App Server lên VPS (ca của Lê Minh Đức hết ngay ở lần bảo trì đầu ngày sau khi cài).
4. Deploy Web.
