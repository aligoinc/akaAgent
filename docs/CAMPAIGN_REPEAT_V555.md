# Lặp lại chiến dịch sau khi chạy xong — V555 (DB) và Desktop

Trạng thái 17/11/2026: **migration đã viết và qua kiểm thử PostgreSQL cục bộ, CHƯA apply production. Desktop (form, bộ chạy) đã có code trên nhánh `claude/busy-lamport-1fjozr`, chưa merge, chưa build/phát hành; App Server không đổi hành vi.** Phương án và các quyết định: akaAgentWebApp `docs/CAMPAIGN_REPEAT_PLAN.md`. Phần Web/API: akaAgentWebApp `docs/CAMPAIGN_REPEAT.md`.

Chiến dịch lịch **Hàng ngày** chạy hết danh sách thì tự chạy lại sau x phút / giờ / ngày, tính từ lúc chạy xong, tới khi đủ **số lượt tối đa** (tính cả lượt đầu) hoặc tới **ngày kết thúc**.

## Cài đặt (do form và API ghi)

`auto_campaigns.extra_settings`:

| Khoá | Giá trị |
|---|---|
| `repeatAfterCompletionEnabled` | `true` để bật |
| `repeatAfterCompletionEvery` | số nguyên: phút 5–1439, giờ 1–168, ngày 1–90 |
| `repeatAfterCompletionUnit` | `minute` \| `hour` \| `day` |
| `repeatAfterCompletionMaxRuns` | số nguyên 2–100 |

Ngày kết thúc dùng cột `schedule_end_date` sẵn có (cuối ngày, giờ Việt Nam). Chưa chiến dịch nào có các khoá trên, nên apply xong chưa chiến dịch nào đổi hành vi.

DB chỉ lặp khi (`private.aka_agent_campaign_repeat_config`): lịch Hàng ngày; data nhập trực tiếp (không phải Nhóm data); không bật nhiều khung giờ; không thuộc chúc mừng sinh nhật, group thời gian thực, đề xuất kết bạn, huỷ lời mời, lướt newsfeed, tìm data theo group / search, comment seeding, SMS, gọi tự động; không phải chiến dịch của Quy trình tự động; đơn vị phút chỉ với nhắn bạn bè / nhắn group đang gửi dạng chia sẻ. Khoảng lặp tối thiểu theo loại (1 ngày cho nhắn tin tới cá nhân) và xung đột với "không gửi lặp trong N ngày" do form và API kiểm.

## Luật

- Một lượt = chạy hết danh sách một lần (không còn data "chờ xử lý"), kể cả khi kéo qua nhiều ngày.
- Đơn vị ngày: lượt kế = Giờ chạy (giờ của `original_schedule`) của ngày (ngày chạy xong + x).
- Đơn vị giờ, phút: lúc chạy xong + x; rơi trước Giờ chạy thì dời tới Giờ chạy cùng ngày, rơi từ giờ dừng trong ngày (hoặc 23:59) trở đi thì dời tới Giờ chạy hôm sau.
- Đủ số lượt tối đa, hoặc lượt kế rơi từ `schedule_end_date` trở đi: chiến dịch hoàn thành.
- Lượt lặp đặt lại data đúng như bộ chạy đang làm ở "nhiều khung giờ": mọi data trừ data "tạm dừng" về "chờ xử lý". Không còn data nào để chạy lại thì kết thúc. Không có cài đặt riêng cho việc này.
- Bộ đếm lượt bắt đầu lại khi cài đặt lặp (số, đơn vị, số lượt, ngày kết thúc) đổi, hoặc khi vòng trước đã kết thúc mà chiến dịch được cho chạy lại.

## Ba nơi gọi, một nơi quyết định

`private.aka_agent_campaign_repeat_core(chiến dịch, lúc chạy xong, ghi?, không sớm hơn)` trả `{enabled, repeat, reason, run, maxRuns, every, unit, next}`; `reason`: `scheduled` | `max_runs` | `end_date`.

1. **Engine v2**: `aka_agent_engine_finish_campaign_v2` thêm nhánh 5b (sau nhiều khung giờ và "gửi lặp lại sau mỗi x phút" cũ). Lặp tiếp thì trả `reason: 'repeat_scheduled'` (lõi engine đã cài sẵn câu cho lý do này) kèm `repeat: {run, maxRuns, …}`; kết thúc thì `reason: 'completed'` kèm `repeat`. Có hiệu lực với Fly và Desktop đang chạy engine v2 ngay khi apply, không cần phát hành.
2. **Bộ chạy cũ của Desktop**: `public.aka_agent_campaign_repeat_decide_v1(p_staff_id, p_campaign_id)` gọi khi lượt vừa chạy hết và chiến dịch còn "đang chạy". `repeat = true` thì bộ chạy đặt lại data và hẹn lịch tới `next`; `false` thì hoàn thành như thường. Desktop gọi từ bản có `handleCampaignRepeatAfterCompletion` (xem mục Desktop; chưa phát hành). **App Server không gọi**: hàm chuyển lượt của Zalo Server (`aka_agent_advance_zalo_server_multi_daily_slot`) chỉ nhận nhắn bạn bè / group, nên trên App Server chiến dịch hoàn thành như thường rồi bộ quét mở lại.
3. **Bộ quét dự phòng**: `public.aka_agent_campaign_repeat_tick_v1(p_limit)` (chỉ `service_role`, API Web gọi theo đồng hồ). Chiến dịch đã đăng ký lặp mà bộ chạy chưa biết tính năng đánh "hoàn thành" thì bộ quét đếm lượt, đặt lại data, đưa chiến dịch về "chờ xử lý" với lịch là giờ lượt kế và ghi một dòng lịch sử chạy `⏳ Đã chạy xong lượt i/n, hẹn chạy lại chiến dịch "…" lúc …`; lượt cuối thì chốt kết thúc. Mỗi chiến dịch một giao dịch con; lỗi 5 lượt quét liền thì thôi lặp (`ended_reason = 'error'`). Chiến dịch còn token của bộ chạy cũ thì chờ lượt quét sau.

Hai RPC còn lại (`service_role` + `aka_agent_desktop`; phiên Desktop chỉ chạm được chiến dịch của nhân viên đang đăng nhập):

- `aka_agent_campaign_repeat_sync_v1(p_staff_id, p_campaign_id)`: gọi **sau khi tạo / sửa chiến dịch** để đăng ký lặp. Bộ quét chỉ xét chiến dịch đã đăng ký và chỉ tính lần hoàn thành sau lúc đăng ký, nên bật lặp trên chiến dịch đã hoàn thành từ trước không làm nó tự chạy lại. Cài đặt lặp không đổi thì giữ bộ đếm.
- `aka_agent_campaign_repeat_state_v1(p_staff_id, p_campaign_ids ≤ 200)`: `[{campaignId, runsDone, maxRuns, every, unit, nextRunAt, lastCompletedAt, finishing, endedReason, endedAt}]` để hiện "lượt i/n, lượt kế lúc …".

Bảng `private.auto_campaign_repeat_state` (một dòng mỗi chiến dịch đã đăng ký; RLS bật, không cấp quyền cho role nào, chỉ các hàm trên ghi).

## Desktop (chưa build/phát hành)

- **Hợp đồng**: `src/shared/campaignRepeat.ts` chép nguyên văn WebApp `packages/control-api/src/campaignRepeat.ts` (sửa ở WebApp trước; bài kiểm bộ chạy so md5 khi có checkout WebApp bên cạnh).
- **Công tắc**: `campaign.repeat_after_completion` đọc chung câu `getDesktopPollingSettings` lúc đăng nhập (không thêm request) → `useDesktopPollingStore().settings.campaignRepeatAudience`; đổi công tắc có hiệu lực sau khi đăng nhập lại. `admin_akabiz` chỉ hiện cho tài khoản `isAdminAkabiz`.
- **Form** (`CampaignFormModal`, `CampaignAgentFormModal`, cùng một bộ sửa): khung "Lặp lại sau khi chạy xong" ngay dưới khung nhiều khung giờ, cùng câu chữ với Form 1 của Web; đơn vị theo `campaignRepeatUnits` (Facebook đăng nhóm / trang cá nhân / page: giờ, ngày; nhắn tin tới cá nhân: ngày). Tick lặp thì bỏ tick nhiều khung giờ và ngược lại. Lưu ghi bốn khoá `repeatAfterCompletion*` cho mọi chiến dịch (tắt thì `false`); lịch Hàng ngày chỉ ghi `schedule_end_date` khi đang bật lặp và có nhập ngày kết thúc. Nhóm đang ẩn vì công tắc vẫn giữ cài đặt đã lưu (Desktop ghi thẳng DB, không qua bước tự tắt của API Web); loại chiến dịch không hỗ trợ, lịch tuần / tháng, Nhóm data thì lưu là tắt.
- **Đăng ký lặp**: handler `DB_CREATE_CAMPAIGN` / `DB_UPDATE_CAMPAIGN` ([campaignHandlers.ts](../src/main/ipc/handlers/campaignHandlers.ts)) gọi `aka_agent_campaign_repeat_sync_v1` sau khi lưu chiến dịch có (hoặc vừa bỏ) cài đặt lặp; lỗi chỉ ghi cảnh báo. Lượt sửa có `extraSettings` đọc thêm một lần cấu hình chiến dịch trước khi lưu.
- **Bộ chạy**: `handleCampaignRepeatAfterCompletion` trong [campaignScheduler.ts](../src/main/services/campaignScheduler.ts), sau nhánh nhiều khung giờ và "gửi lặp lại sau mỗi x phút", trước "chạy lại sau mỗi x giờ". Chỉ gọi DB khi chiến dịch bật lặp, thuộc loại hỗ trợ, lượt thật sự chạy hết (không còn data chờ) và còn data để chạy lại; rồi dùng lại `rescheduleCompletedCampaignPass`. DB chưa có V555, DB từ chối hoặc lỗi gọi hàm: hoàn thành như thường. Câu tiến trình: `⏳ Đã chạy xong lượt i/n, hẹn chạy lại chiến dịch "…" lúc …`; lượt cuối `✅ Hoàn thành chiến dịch "…" (đã chạy đủ n lượt)` hoặc `(lượt lặp kế tiếp đã qua ngày kết thúc)`.
- **Chi tiết chiến dịch**: hai dòng "Lặp lại sau khi chạy xong", "Số lượt tối đa". Số lượt đã chạy và lý do "đang chờ lượt lặp kế tiếp" chưa có trên Desktop (Web có).
- Repository: [campaignRepeatRepository.ts](../src/main/data/repositories/campaignRepeatRepository.ts) (`decideCampaignRepeat`, `syncCampaignRepeat`, `getCampaignRepeatStates`).

Kiểm thử Desktop:

```bash
node scripts/campaign-repeat-scheduler-smoke.cjs      # 25 ca: method thật của CampaignScheduler với DB giả
ELECTRON_DISABLE_SANDBOX=1 xvfb-run -a node scripts/run-campaign-repeat-ui-smoke.cjs   # 6 ca: form thật trên Electron, IPC giả lập
npx tsc --noEmit -p tsconfig.node.json && npx tsc --noEmit -p tsconfig.web.json
```

Chưa kiểm trên Desktop: lượt ghi `extra_settings` / `schedule_end_date` khi bấm Lưu chiến dịch (bài giao diện mới kiểm tới lưu nháp, đọc lại khi sửa và chặn số lượt sai); form Agent và chiến dịch Facebook mới qua kiểm kiểu, chưa có ca giao diện riêng; bản đóng gói; chạy chiến dịch thật.

## Thông báo

`private.aka_agent_notification_capture_campaign` (thân V475, md5 khoá cứng) thêm một nhánh: chiến dịch đã đăng ký lặp chuyển "hoàn thành" ở lượt giữa (bộ quét sẽ mở lại) thì không ghi thông báo "hoàn thành". Lượt cuối, bộ quét đang tắt, hoặc không còn data để chạy lại: báo như thường. Với engine v2 và bộ chạy cũ bản mới, chiến dịch không chuyển "hoàn thành" ở lượt giữa nên không có gì để báo.

## Công tắc

`auto_system_settings` key `campaign.repeat_after_completion`, V555 đặt `{"audience":"admin_akabiz","sweeper":true}`:

- `audience`: `off` | `admin_akabiz` | `all`. Form và API đọc để ẩn / hiện ô cài đặt. DB không đọc.
- `sweeper`: `false` tắt khẩn bộ quét (thiếu khoá = bật). Engine v2 không đọc công tắc: muốn dừng hẳn một chiến dịch thì tắt lặp trong chiến dịch hoặc tạm dừng nó.

## Kiểm thử

```bash
# container cloud (root, PG16); thư mục CHAT_REPO chỉ cần có module `pg`
runuser -u postgres -- env PG17_BIN=/usr/lib/postgresql/16/bin CHAT_REPO=/var/tmp/aka-pgmod HOME=/tmp \
  node scripts/campaign-repeat-v555-smoke.cjs
```

8 nhóm: apply / quyền / gỡ / apply lại; phạm vi và giới hạn số; giờ lượt kế (ngày, giờ, phút, khung giờ chạy, bộ quét trễ); đếm lượt, số lượt tối đa, ngày kết thúc, đổi cài đặt, múi giờ phiên; engine v2 chạy đủ ba lượt bằng claim → report → finish thật; bộ quét (mở lại, chốt, token, khoá tắt khẩn, lỗi cô lập, chiến dịch đã xoá); RPC và quyền phiên Desktop; thông báo. Fixture là DB engine v2 dựng tới V532 như production, cộng thân hàm ghi thông báo V475 thật với các bảng thông báo tối thiểu.

Chưa kiểm: chạy thật trên production; bộ kịch bản `scripts/engine-v2-scenarios/run.cjs` chưa nạp V555 (fixture của nó chưa có hàm ghi thông báo và hàm phiên Desktop mà preflight V555 đòi).

## Apply và gỡ

- Sinh lại file: `node scripts/build-v555-sql.cjs` (không sửa tay `migrations/migration_v555_campaign_repeat_after_completion.sql`).
- Trước khi apply: kiểm lại sổ migration chưa có `migration_v555_%` và chưa nhánh nào khác giữ số 555 (17/11 sổ tới V554). Preflight tự dừng nếu thân `aka_agent_engine_finish_campaign_v2` khác V506 (`48625d95…`) hoặc thân hàm ghi thông báo khác V475 (`6e7b852c…`).
- Migration có `CREATE FUNCTION` nên PostgREST nạp lại schema: apply buổi tối, ngoài giờ cao điểm. Không `ALTER` bảng nào.
- Gỡ: `migrations/rollback_v555_campaign_repeat_after_completion.sql` (trả hai thân hàm cũ, xoá hàm, bảng, dòng công tắc). Trước khi gỡ, đặt công tắc `{"audience":"off","sweeper":false}` và để API Web ngừng gọi bốn RPC. Chiến dịch đang chờ lượt lặp kế tiếp vẫn chạy lượt đó rồi hoàn thành như chiến dịch thường.

## Giới hạn đã biết

- Bộ chạy không gọi `decide_v1` (Desktop tới 9.8.0, App Server mọi bản, bộ cũ của ChatApi): chiến dịch chuyển "hoàn thành" trong tối đa một chu kỳ quét rồi mới được mở lại; khách có thể thấy trạng thái "hoàn thành" thoáng qua và dòng `✅ Hoàn thành chiến dịch` trong lịch sử chạy trước dòng hẹn lượt kế.
- Thêm data vào chiến dịch đúng lúc nó vừa "hoàn thành" ở lượt giữa (trước khi bộ quét chạy) làm chiến dịch mở lại theo đường thêm data; lượt đó không được đếm.
- Form Desktop bản chưa có ô này (tới 9.8.0) ghi đè `extra_settings` theo danh sách khoá cố định: sửa chiến dịch trên bản đó làm mất cài đặt lặp.
- Chiến dịch Facebook chỉ tạo, sửa được trên Desktop, nên lặp cho Facebook chỉ dùng được sau khi phát hành Desktop có ô này.
- Lõi engine trên Fly và Desktop đã phát hành in câu của lý do `repeat_scheduled` cũ ("Đã gửi xong lượt này, hẹn gửi lặp lại chiến dịch … lúc …"); câu có số lượt (`packages/campaign-engine/src/progress.ts`) chỉ có sau lần phát hành / đồng bộ lõi kế tiếp.
