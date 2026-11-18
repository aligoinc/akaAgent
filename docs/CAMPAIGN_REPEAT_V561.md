# Lặp lại chiến dịch sau khi chạy xong — V561 (DB) và Desktop

Trạng thái 18/11/2026: **mở cho mọi khách từ 14:01:55 VN** (xem mục Công tắc); Desktop 9.9.0 và API/Web Fly v125 đã có phần này. Trạng thái 17/11/2026 tối: **V561 đã apply akachat lúc 18:18:39 (p1) và 18:18:55 VN (p2)** (`20261117111839` / `20261117111855`; không apply lại; md5 sổ = file `47b696ce…` / `3933719d…`; PostgREST nạp lại schema 4,1 s và 0,9 s, 0 lỗi 500/503; [biên nhận](../migrations/snapshots/campaign-repeat-v561/apply-receipt.json)). Giả lập đủ luồng trên DB thật trong một giao dịch rồi huỷ (`scripts/campaign-repeat-v561-prod-sim.sql`): 19/19 bước đạt, kể cả phiên Desktop thật. Dòng công tắc id 129 = `admin_akabiz`. **Bộ chạy cũ Desktop đã merge `dev_3` qua [#691](https://github.com/aligoinc/akaAgent/pull/691), API Web (bộ quét) `dev_1` qua #250, ngày 17/11 theo yêu cầu; chưa build Desktop, chưa deploy API**; engine v2 lặp ngay với chiến dịch đã bật lặp. Bản đầu viết với số 556 rồi gỡ (akaAgent `3534c4a`, `7f6d5c5`); số 556–560 nay là engine Facebook, V558 viết lại hàm kết thúc lượt, nên bản này là V561 và vá trên thân V558 (md5 `pg_get_functiondef` `ffccdf1f…` → `d8c9a144…`). Phần cài đặt (form, lưu) đã merge `dev_3` qua #689. Phương án và các quyết định: akaAgentWebApp `docs/CAMPAIGN_REPEAT_PLAN.md`. Phần Web/API: akaAgentWebApp `docs/CAMPAIGN_REPEAT.md`.

Chiến dịch lịch **Hàng ngày** chạy hết danh sách thì tự chạy lại sau x phút / giờ / ngày, tính từ lúc chạy xong, tới khi đủ **số lượt tối đa** (tính cả lượt đầu) hoặc tới **ngày kết thúc**.

## Cài đặt (do form và API ghi)

`auto_campaigns.extra_settings`:

| Khoá | Giá trị |
|---|---|
| `repeatAfterCompletionEnabled` | `true` để bật |
| `repeatAfterCompletionEvery` | số nguyên: phút 5–1439, giờ 1–168, ngày 1–90 |
| `repeatAfterCompletionUnit` | `minute` \| `hour` \| `day` |
| `repeatAfterCompletionMaxRuns` | số nguyên 2–100 |

Ngày kết thúc dùng ô "Ngày kết thúc" và cột `schedule_end_date` sẵn có của lịch (cuối ngày, giờ Việt Nam); với lịch Hàng ngày ô này chỉ hiện khi đang bật lặp. Chưa chiến dịch nào có các khoá trên, nên apply xong chưa chiến dịch nào đổi hành vi.

Bộ đếm nằm ở **hai cột mới của `auto_campaigns`** (không có bảng riêng; người dùng chốt 17/11/2026):

| Cột | Kiểu | Ý nghĩa |
|---|---|---|
| `repeat_runs_done` | `integer NOT NULL DEFAULT 0` | Số lượt đã chạy xong trong vòng lặp hiện tại, tính cả lượt đầu. |
| `repeat_log` | `jsonb`, NULL = chưa từng bật lặp | Nhật ký, mỗi lần đếm một dòng; tối đa 120 dòng gần nhất, luôn giữ dòng `arm` gần nhất. |

Dòng nhật ký `{type, at, …}`:

| `type` | Khi nào | Trường kèm |
|---|---|---|
| `arm` | Bắt đầu đếm: bật lặp, đổi cài đặt, hoặc chạy lại sau khi đã hết lượt | `cfg` = `{every, unit, maxRuns, endEpoch}`, `by` (`save` hoặc nơi đếm), `since` (mốc bắt đầu cũ khi chỉ mở vòng mới), `completedAt` (lần hoàn thành có trước lúc bật, không tính) |
| `run` | Chạy xong một lượt | `run`, `max`, `by` (`engine` \| `desktop` \| `sweeper`), `doneAt`, `next` (giờ lượt kế) hoặc `final` (lý do đây là lượt cuối) |
| `end` | Thôi lặp | `reason` (`max_runs` \| `end_date` \| `no_rerun_data` \| `error`), `completedAt` |
| `error` | Bộ quét không mở lại được | `message` |
| `skip` | Bộ quét bỏ qua một lần hoàn thành (chưa đăng ký, hoàn thành trước lúc đăng ký, cài đặt không hợp lệ) | `reason`, `completedAt` |
| `off` | Tắt lặp | |

Chỉ các hàm `private.aka_agent_campaign_repeat_*` ghi hai cột này. Role `aka_agent_desktop` chỉ có quyền UPDATE theo danh sách cột trên `auto_campaigns` (kiểm production 17/11/2026) nên app Desktop không tự sửa được bộ đếm; `select=*` của app bản cũ nhận thêm hai cột, không ảnh hưởng. Trạng thái vòng lặp (đã đăng ký chưa, đang chờ chốt lượt cuối, lý do dừng, số lỗi liên tiếp, lần hoàn thành đã xử lý) đọc từ dòng `arm` cuối trở đi bằng `private.aka_agent_campaign_repeat_state`.

DB chỉ lặp khi (`private.aka_agent_campaign_repeat_config`): lịch Hàng ngày; data nhập trực tiếp (không phải Nhóm data); không bật nhiều khung giờ; không thuộc chúc mừng sinh nhật, group thời gian thực, đề xuất kết bạn, huỷ lời mời, SMS, gọi tự động; không phải chiến dịch của Quy trình tự động; đơn vị phút chỉ với nhắn bạn bè / nhắn group đang gửi dạng chia sẻ và bốn loại Facebook trước đây dùng "Chạy lại sau mỗi x giờ" (tìm data theo group, tìm data theo search, comment seeding, lướt newsfeed; người dùng chốt 17/11/2026: bốn loại này chuyển sang cài đặt mới, chọn được phút, giờ, ngày). Khoảng lặp tối thiểu theo loại (1 ngày cho nhắn tin tới cá nhân) và xung đột với "không gửi lặp trong N ngày" do form và API kiểm.

## Luật

- Một lượt = chạy hết danh sách một lần (không còn data "chờ xử lý"), kể cả khi kéo qua nhiều ngày.
- Đơn vị ngày: lượt kế = Giờ chạy (giờ của `original_schedule`) của ngày (ngày chạy xong + x).
- Đơn vị giờ, phút: lúc chạy xong + x; rơi trước Giờ chạy thì dời tới Giờ chạy cùng ngày, rơi từ giờ dừng trong ngày (hoặc 23:59) trở đi thì dời tới Giờ chạy hôm sau.
- Đủ số lượt tối đa, hoặc lượt kế rơi từ `schedule_end_date` trở đi: chiến dịch hoàn thành.
- Lượt lặp đặt lại data đúng như bộ chạy đang làm ở "nhiều khung giờ": mọi data trừ data "tạm dừng" về "chờ xử lý". Không còn data nào để chạy lại thì kết thúc. Không có cài đặt riêng cho việc này.
- Bộ đếm lượt bắt đầu lại khi cài đặt lặp (số, đơn vị, số lượt, ngày kết thúc) đổi, hoặc khi vòng trước đã kết thúc mà chiến dịch được cho chạy lại.

## Ba nơi gọi, một nơi quyết định

`private.aka_agent_campaign_repeat_core(chiến dịch, lúc chạy xong, ghi?, không sớm hơn, nơi đếm)` trả `{enabled, repeat, reason, run, maxRuns, every, unit, next}`; `reason`: `scheduled` | `max_runs` | `end_date`.

1. **Engine v2**: `aka_agent_engine_finish_campaign_v2` (thân V558) thêm nhánh 5b (sau nhiều khung giờ và "gửi lặp lại sau mỗi x phút" cũ, trước "chạy lại sau N giờ" của Facebook). Đang bật lặp thì nhánh "chạy lại sau N giờ" không áp dụng, như bộ chạy cũ. Đăng trang cá nhân / lướt newsfeed không có dòng data nào vẫn lặp (bước 6 của V558 hẹn lượt kế mà không đặt lại gì). Lặp tiếp thì trả `reason: 'repeat_scheduled'` (lõi engine đã cài sẵn câu cho lý do này) kèm `repeat: {run, maxRuns, …}`; kết thúc thì `reason: 'completed'` kèm `repeat`. Có hiệu lực với Fly và Desktop đang chạy engine v2 ngay khi apply, không cần phát hành.
2. **Bộ chạy cũ của Desktop**: `public.aka_agent_campaign_repeat_decide_v1(p_staff_id, p_campaign_id)` gọi khi lượt vừa chạy hết và chiến dịch còn "đang chạy". `repeat = true` thì bộ chạy đặt lại data và hẹn lịch tới `next`; `false` thì hoàn thành như thường. Desktop gọi từ bản có `handleCampaignRepeatAfterCompletion` (xem mục Desktop; chưa phát hành). **App Server không gọi**: hàm chuyển lượt của Zalo Server (`aka_agent_advance_zalo_server_multi_daily_slot`) chỉ nhận nhắn bạn bè / group, nên trên App Server chiến dịch hoàn thành như thường rồi bộ quét mở lại.
3. **Bộ quét dự phòng**: `public.aka_agent_campaign_repeat_tick_v1(p_limit)` (chỉ `service_role`, API Web gọi theo đồng hồ). Chiến dịch đã đăng ký lặp mà bộ chạy chưa biết tính năng đánh "hoàn thành" thì bộ quét đếm lượt, đặt lại data, đưa chiến dịch về "chờ xử lý" với lịch là giờ lượt kế và ghi một dòng lịch sử chạy `⏳ Đã chạy xong lượt i/n, hẹn chạy lại chiến dịch "…" lúc …`; lượt cuối thì chốt kết thúc. Mỗi chiến dịch một giao dịch con; lỗi 5 lượt quét liền thì thôi lặp (dòng `end` với `reason = 'error'`). Ứng viên của bộ quét: chiến dịch có `repeat_log`, đang bật lặp, "hoàn thành", và dòng nhật ký cuối chưa ghi `completedAt` của lần hoàn thành này; không có index riêng, mỗi lượt đọc bảng `auto_campaigns` một lần (72 MB heap, không đọc TOAST của chiến dịch không có nhật ký). Chiến dịch còn token của bộ chạy cũ thì chờ lượt quét sau.

Hai RPC còn lại (`service_role` + `aka_agent_desktop`; phiên Desktop chỉ chạm được chiến dịch của nhân viên đang đăng nhập):

- `aka_agent_campaign_repeat_sync_v1(p_staff_id, p_campaign_id)`: gọi **sau khi tạo / sửa chiến dịch** để đăng ký lặp. Bộ quét chỉ xét chiến dịch đã đăng ký và chỉ tính lần hoàn thành sau lúc đăng ký, nên bật lặp trên chiến dịch đã hoàn thành từ trước không làm nó tự chạy lại. Cài đặt lặp không đổi thì giữ bộ đếm.
- `aka_agent_campaign_repeat_state_v1(p_staff_id, p_campaign_ids ≤ 200)`: `[{campaignId, runsDone, maxRuns, every, unit, nextRunAt, lastCompletedAt, finishing, endedReason, endedAt}]` để hiện "lượt i/n, lượt kế lúc …", đọc từ hai cột trên. API Web đọc bộ đếm qua RPC này (không thêm cột vào câu select) nên deploy API trước khi apply migration không lỗi.

## Desktop (chưa build/phát hành)

- **Hợp đồng**: `src/shared/campaignRepeat.ts` chép nguyên văn WebApp `packages/control-api/src/campaignRepeat.ts` (sửa ở WebApp trước; bài kiểm bộ chạy so md5 khi có checkout WebApp bên cạnh).
- **Công tắc**: `campaign.repeat_after_completion` đọc chung câu `getDesktopPollingSettings` lúc đăng nhập (không thêm request) → `useDesktopPollingStore().settings.campaignRepeatAudience`; đổi công tắc có hiệu lực sau khi đăng nhập lại. `admin_akabiz` chỉ hiện cho tài khoản `isAdminAkabiz`.
- **Form** (`CampaignFormModal`, `CampaignAgentFormModal`, cùng một bộ sửa): khung "Lặp lại sau khi chạy xong" ngay dưới khung nhiều khung giờ, cùng câu chữ với Form 1 của Web; đơn vị theo `campaignRepeatUnits` (Facebook đăng nhóm / trang cá nhân / page: giờ, ngày; nhắn tin tới cá nhân: ngày; tìm data theo group / search, comment seeding, lướt newsfeed: phút, giờ, ngày). Khung không có ô ngày kết thúc riêng: ô "Ngày kết thúc" của phần Lịch (cạnh "Ngày chạy") hiện cả với lịch Hàng ngày khi đang bật lặp, giá trị giữ ở `formData.repeatEndDate` để ngày kết thúc mặc định của lịch tuần / tháng không tự áp vào. Tick lặp thì bỏ tick nhiều khung giờ và ngược lại. Lưu ghi bốn khoá `repeatAfterCompletion*` cho mọi chiến dịch (tắt thì `false`); lịch Hàng ngày chỉ ghi `schedule_end_date` khi đang bật lặp và có nhập ngày kết thúc. Nhóm đang ẩn vì công tắc vẫn giữ cài đặt đã lưu (Desktop ghi thẳng DB, không qua bước tự tắt của API Web); loại chiến dịch không hỗ trợ, lịch tuần / tháng, Nhóm data thì lưu là tắt.
- **Bốn loại Facebook có "Chạy lại sau mỗi x giờ" kiểu cũ** (`findDataRerunEnabled` / `findDataRerunAfterHours`): khi khung mới đang hiện cho loại đó (lịch Hàng ngày, công tắc mở cho tài khoản) thì ô kiểu cũ ẩn và lưu là tắt. Mở sửa một chiến dịch đang lưu cài đặt cũ thì form đổi sang cài đặt mới bằng `campaignRepeatFromLegacyRerun` ([campaignRepeatDesktop.ts](../src/shared/campaignRepeatDesktop.ts)): x giờ, số lượt tối đa đề xuất = số lượt vừa một ngày (`ceil(24 / x)`, trong 2–100), người dùng sửa được. Chiến dịch chưa mở sửa vẫn chạy bằng bộ chạy cũ (`handleRerunAfterCompletion`); lịch tuần / tháng và tài khoản chưa được mở công tắc giữ ô kiểu cũ.
- **Đăng ký lặp**: handler `DB_CREATE_CAMPAIGN` / `DB_UPDATE_CAMPAIGN` ([campaignHandlers.ts](../src/main/ipc/handlers/campaignHandlers.ts)) gọi `aka_agent_campaign_repeat_sync_v1` sau khi lưu chiến dịch có (hoặc vừa bỏ) cài đặt lặp; lỗi chỉ ghi cảnh báo. Lượt sửa có `extraSettings` đọc thêm một lần cấu hình chiến dịch trước khi lưu.
- **Bộ chạy**: `handleCampaignRepeatAfterCompletion` trong [campaignScheduler.ts](../src/main/services/campaignScheduler.ts), sau nhánh nhiều khung giờ và "gửi lặp lại sau mỗi x phút", trước "chạy lại sau mỗi x giờ". Chỉ gọi DB khi chiến dịch bật lặp, thuộc loại hỗ trợ, lượt thật sự chạy hết (không còn data chờ) và còn data để chạy lại (đăng trang cá nhân và lướt newsfeed chạy không cần data); rồi dùng lại `rescheduleCompletedCampaignPass`. DB chưa có V561, DB từ chối hoặc lỗi gọi hàm: hoàn thành như thường. Câu tiến trình: `⏳ Đã chạy xong lượt i/n, hẹn chạy lại chiến dịch "…" lúc …`; lượt cuối `✅ Hoàn thành chiến dịch "…" (đã chạy đủ n lượt)` hoặc `(lượt lặp kế tiếp đã qua ngày kết thúc)`.
- **Chi tiết chiến dịch**: hai dòng "Lặp lại sau khi chạy xong", "Số lượt tối đa". Số lượt đã chạy và lý do "đang chờ lượt lặp kế tiếp" chưa có trên Desktop (Web có).
- Repository: [campaignRepeatRepository.ts](../src/main/data/repositories/campaignRepeatRepository.ts) (`decideCampaignRepeat`, `syncCampaignRepeat`, `getCampaignRepeatStates`).

Kiểm thử Desktop:

```bash
node scripts/campaign-repeat-scheduler-smoke.cjs      # 29 ca: method thật của CampaignScheduler với DB giả
ELECTRON_DISABLE_SANDBOX=1 xvfb-run -a node scripts/run-campaign-repeat-ui-smoke.cjs   # 8 ca: form thật trên Electron, IPC giả lập
npx tsc --noEmit -p tsconfig.node.json && npx tsc --noEmit -p tsconfig.web.json
```

Chưa kiểm trên Desktop: lượt ghi `extra_settings` / `schedule_end_date` khi bấm Lưu chiến dịch (bài giao diện mới kiểm tới lưu nháp, đọc lại khi sửa và chặn số lượt sai); form Agent mới qua kiểm kiểu, chưa có ca giao diện riêng (chiến dịch Facebook tìm data theo group đã có ca: khung mới, đổi cài đặt cũ, lịch tuần và công tắc tắt giữ ô cũ); bản đóng gói; chạy chiến dịch thật.

## Thông báo

`private.aka_agent_notification_capture_campaign` (thân V475, md5 khoá cứng) thêm một nhánh: chiến dịch đã đăng ký lặp chuyển "hoàn thành" ở lượt giữa (bộ quét sẽ mở lại) thì không ghi thông báo "hoàn thành". Lượt cuối, bộ quét đang tắt, hoặc không còn data để chạy lại: báo như thường. Với engine v2 và bộ chạy cũ bản mới, chiến dịch không chuyển "hoàn thành" ở lượt giữa nên không có gì để báo.

## Công tắc

`auto_system_settings` key `campaign.repeat_after_completion` (id 129), V561 đặt `{"audience":"admin_akabiz","sweeper":true}`. **Từ 14:01:55 VN 18/11/2026 là `{"audience":"all","sweeper":true}`** theo yêu cầu ("hiển thị tính năng này cho tất cả khách hàng"). Lúc bật: Desktop 9.9.0 (có form, bộ chạy cũ, đăng ký lặp) đã lên máy khách, API/Web Fly v125 (deploy 20:04 VN 17/11, có form và bộ quét) đang chạy, bộ quét đã gọi `aka_agent_campaign_repeat_tick_v1` 1.032 lượt, 100% HTTP 200; chưa chiến dịch nào bật lặp; 143 chiến dịch Facebook chưa xong đang dùng "Chạy lại sau mỗi x giờ" kiểu cũ (Desktop 9.9.0 đổi sang cài đặt mới khi khách mở sửa, số lượt tối đa đề xuất = số lượt vừa một ngày). Web thấy sau khi tải lại trang, Desktop 9.9.0 sau khi đăng nhập lại; iOS chưa có ô (lưu từ iOS giữ nguyên cài đặt lặp đang có). Ẩn lại: `audience: off`; việc này chỉ ẩn ô, chiến dịch đã bật lặp vẫn lặp.

Hai khoá:

- `audience`: `off` | `admin_akabiz` | `all`. Form và API đọc để ẩn / hiện ô cài đặt. DB không đọc.
- `sweeper`: `false` tắt khẩn bộ quét (thiếu khoá = bật). Engine v2 không đọc công tắc: muốn dừng hẳn một chiến dịch thì tắt lặp trong chiến dịch hoặc tạm dừng nó.

## Kiểm thử

```bash
# container cloud (root, PG16); thư mục CHAT_REPO chỉ cần có module `pg`
runuser -u postgres -- env PG17_BIN=/usr/lib/postgresql/16/bin CHAT_REPO=/var/tmp/aka-pgmod HOME=/tmp \
  node scripts/campaign-repeat-v561-smoke.cjs
```

8 nhóm: apply hai phần / quyền / gỡ (bỏ hai cột) / apply lại; nội dung nhật ký và giới hạn 120 dòng; phạm vi và giới hạn số; giờ lượt kế (ngày, giờ, phút, khung giờ chạy, bộ quét trễ); đếm lượt, số lượt tối đa, ngày kết thúc, đổi cài đặt, múi giờ phiên; engine v2 chạy đủ ba lượt bằng claim → report → finish thật; bộ quét (mở lại, chốt, token, khoá tắt khẩn, lỗi cô lập, chiến dịch đã xoá); RPC và quyền phiên Desktop; thông báo. Fixture là DB engine v2 dựng tới V532 như production, cộng thân hàm ghi thông báo V475 thật với các bảng thông báo tối thiểu.

Chưa kiểm: chạy thật trên production; bộ kịch bản `scripts/engine-v2-scenarios/run.cjs` chưa nạp V561 (fixture của nó chưa có hàm ghi thông báo và hàm phiên Desktop mà preflight V561 đòi); hai trigger chạy ở mọi UPDATE của `auto_campaigns` trên production (`aaa_desktop_parent_ownership`, `trg_auto_table_log`) không có trong fixture, nên lượt ghi hai cột từ phiên Desktop chưa được thử với chúng.

## Giả lập code app thật nhiều lượt (17/11/2026 tối)

Ngoài bài kiểm hàm DB, hai bài chạy code app thật trên DB cục bộ dựng như production (tới V558) cộng V561, tua thời gian giữa các lượt:

```bash
# Lõi engine thật (Desktop và Fly, Zalo giả): S30, S31 — chiến dịch lặp 1 giờ, 3 lượt
CHAT_REPO=../akaAgentChatApi SCENARIO_FACEBOOK_MIGRATIONS=1 SCENARIO_CAMPAIGN_REPEAT=1 node scripts/engine-v2-scenarios/run.cjs --skip-general
# Bộ chạy cũ Desktop (method + repository thật) và bộ quét API Web (lớp + RPC wrapper thật)
CHAT_REPO=../akaAgentChatApi WEBAPP_REPO=../akaAgentWebApp node scripts/campaign-repeat-runtime-e2e.cjs
```

Kết quả 17/11: S30 / S31 đạt (mỗi lượt gửi mỗi data đúng một lần, câu "⏳ Đã chạy xong lượt i/3, hẹn chạy lại…", lượt 3 "✅ Hoàn thành chiến dịch … (đã chạy đủ 3 lượt)"); bài thứ hai 4/4 nhóm (bộ chạy cũ 3 lượt + chạy lại mở vòng mới + chiến dịch không lặp không gọi hàm lặp; bộ quét mở lại, chốt, thông báo chỉ ở lượt cuối, khoá tắt khẩn, đồng hồ tự chạy). Chưa chạy: app Electron đóng gói thật, Zalo / Facebook thật, API Web đã deploy.

## Apply và gỡ

- Sinh lại file: `node scripts/build-v561-sql.cjs` (không sửa tay ba file trong `migrations/`).
- Hai phần, đúng thứ tự, mỗi phần một giao dịch và một dòng sổ migration:
  1. `migration_v561_campaign_repeat_after_completion_p1.sql`: `ALTER TABLE public.auto_campaigns ADD COLUMN` hai cột. Không viết lại bảng (mặc định là hằng số) nhưng cần khoá độc quyền bảng trong chốc lát; `lock_timeout` 3 giây, không lấy được khoá thì dừng, chạy lại sau.
  2. `migration_v561_campaign_repeat_after_completion_p2.sql`: hàm, RPC, vá hai hàm đang có, dòng công tắc. Đòi p1.
- Trước khi apply: kiểm lại sổ migration chưa có `migration_v561_%` và chưa nhánh nào khác giữ số 561 (17/11 tối sổ tới `migration_v560_engine_facebook_copies`). Preflight p2 tự dừng nếu định nghĩa `aka_agent_engine_finish_campaign_v2` khác V558 (md5 `pg_get_functiondef` `ffccdf1f…`) hoặc thân hàm ghi thông báo khác V475 (`6e7b852c…`).
- `auto_campaigns` là bảng mọi máy đọc liên tục, và cả hai phần đều làm PostgREST nạp lại schema: apply buổi tối, ngoài giờ cao điểm, xem `postgrest_logs` "Schema cache queried in" giữa hai phần.
- Gỡ: `migrations/rollback_v561_campaign_repeat_after_completion.sql` (giao dịch 1 trả hai thân hàm cũ, xoá hàm và dòng công tắc; giao dịch 2 bỏ hai cột, mất số lượt đã đếm và nhật ký). Trước khi gỡ, đặt công tắc `{"audience":"off","sweeper":false}` và để API Web ngừng gọi bốn RPC. Chiến dịch đang chờ lượt lặp kế tiếp vẫn chạy lượt đó rồi hoàn thành như chiến dịch thường.

## Giới hạn đã biết

- Bộ chạy không gọi `decide_v1` (Desktop tới 9.8.0, App Server mọi bản, bộ cũ của ChatApi): chiến dịch chuyển "hoàn thành" trong tối đa một chu kỳ quét rồi mới được mở lại; khách có thể thấy trạng thái "hoàn thành" thoáng qua và dòng `✅ Hoàn thành chiến dịch` trong lịch sử chạy trước dòng hẹn lượt kế.
- Thêm data vào chiến dịch đúng lúc nó vừa "hoàn thành" ở lượt giữa (trước khi bộ quét chạy) làm chiến dịch mở lại theo đường thêm data; lượt đó không được đếm.
- Form Desktop bản chưa có ô này (tới 9.8.0) ghi đè `extra_settings` theo danh sách khoá cố định: sửa chiến dịch trên bản đó làm mất cài đặt lặp.
- Chiến dịch Facebook chỉ tạo, sửa được trên Desktop, nên lặp cho Facebook chỉ dùng được sau khi phát hành Desktop có ô này.
- Desktop tới 9.8.0 in câu của lý do `repeat_scheduled` cũ ("Đã gửi xong lượt này, hẹn gửi lặp lại chiến dịch … lúc …"); câu có số lượt (`packages/campaign-engine/src/progress.ts`) có trên Fly từ 20:59 VN 17/11 (lõi đồng bộ qua ChatApi #163, worker `dev-dd9a5b1-20261117`) và trên Desktop từ bản 9.9.0.
- Bốn loại Facebook chuyển sang cài đặt mới: lướt newsfeed lịch Hàng ngày có vài đường hoàn thành thẳng (chạm giới hạn trong ngày) không qua `handleCampaignCompletion`; chiến dịch đang bật lặp hoàn thành theo đường đó được bộ quét đếm là một lượt và mở lại.
- Bộ quét đọc cả bảng `auto_campaigns` mỗi lượt (không có index riêng, theo yêu cầu chỉ thêm cột). 17/11/2026 bảng có 56,9 nghìn dòng, heap 72 MB; nếu bảng lớn lên nhiều thì thêm index một phần theo `repeat_log IS NOT NULL`.
