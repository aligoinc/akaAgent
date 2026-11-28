# Engine v2: tài khoản không kẹt "đang chạy" (V681 + bộ lập lịch + worker Fly)

Anh chốt 27/11/2026: "Cả DB và app", rồi "Bỏ, dọn một lần": không có bước tự gỡ định kỳ.

**Tình trạng:**
- V681 đã apply akachat lúc 16:51:23 VN 27/11 theo yêu cầu ("Chạy thử rồi apply").
  - Sổ `20261127095123`, md5 sổ = file `8d7ef48e…`. Không apply lại.
  - [Biên nhận](../migrations/snapshots/engine-account-hold-rule-v681/apply-receipt.json); kết quả ở mục "Apply 27/11/2026".
- Code: [#835](https://github.com/aligoinc/akaAgent/pull/835) vào `dev_3`, [aligoinc/akaAgentChatApi#207](https://github.com/aligoinc/akaAgentChatApi/pull/207) vào `dev` (mở 27/11 theo yêu cầu "Mở PR", chưa merge).
- Chưa deploy ChatApi `worker`.
- Chưa build Desktop / App Server.

## Sự cố 27/11/2026

- `aka_agent_engine_release_v1` / `aka_agent_engine_close_stale_v1` chỉ trả tài khoản về "chờ xử lý" khi không chiến dịch nào của tài khoản
  còn `runtime_claim_token` / `runtime_unit_token`. Luật này tính cả dấu trên chiến dịch đã xoá / "tạm dừng", trong khi bước nhận lượt
  (`aka_agent_engine_claim_target_v1`) đã bỏ qua dấu như vậy từ V527.
- Dấu cũ do bộ cũ trên VPS để lại mỗi khi chiến dịch Server bị tạm dừng / xoá giữa lượt. Trigger cố ý giữ dấu chờ nơi chạy tự nhả, nhưng
  nơi chạy không nhả. Dấu tích từ 18/08: 672 dấu, theo tháng 19 / 89 / 209 / 355. Từ khi VPS chạy engine (21:45 VN 26/11) không còn dấu mới.
- Bộ lập lịch Desktop / App Server ([campaignScheduler.ts](../src/main/services/campaignScheduler.ts)) và worker Fly (ChatApi
  `campaignRuntimeRepository.ts`) chỉ nhận tài khoản "chờ xử lý". Mỗi tài khoản như vậy chạy được một lượt rồi đứng im, không ghi lý do.
- Lộ ra khi VPS chạy engine v2 từ tối 26/11. Lúc gỡ có 145 tài khoản VPS + 3 tài khoản Fly bị kẹt, cộng 303 tài khoản "chờ xử lý" sẽ kẹt
  sau lượt kế. Dữ liệu đã gỡ tay 15:21:28 VN 27/11 ([biên nhận](../migrations/snapshots/engine-stale-claim-release-20261127/)).
- Không liên quan ổ đĩa VPS chậm: tái hiện được trên DB thử ở máy, và 3 tài khoản Fly cũng kẹt.

## Bản sửa

### DB: [V681](../migrations/migration_v681_engine_account_hold_rule.sql)

Sinh bằng `node scripts/build-v681-sql.cjs` từ thân sau V670. md5 migration `8d7ef48e…`, bản gỡ `27c3c472…`.

- **Luật dùng chung (chỗ sửa lỗi):** release_v1 / close_stale_v1 coi dấu giữ lượt của bộ cũ như bước nhận lượt. Dấu trên chiến dịch đã xoá
  hoặc tạm dừng, quá 30 phút (`engine.legacy_stale_claim_minutes`), không unit lease, không data "đang chạy" thì không giữ tài khoản.
  Luật nằm ở một hàm, `private.aka_agent_engine_legacy_hold_v1(account, now)`, trùng quyết định của claim trên 128 tổ hợp. Mỗi hàm chỉ đổi
  đúng một điều kiện; job `aka-agent-engine-close-stale` không thêm bước nào.
- **Hàm cho worker Fly và câu dò:** `private.aka_agent_engine_account_holder_v1(account, now)` trả lý do tài khoản còn bị giữ:
  - `operation`: token thao tác tài khoản;
  - `lease`: lease engine ở bất kỳ làn nào;
  - `open_run`: lượt engine còn mở;
  - `legacy_claim`: dấu giữ lượt của bộ cũ chưa quá hạn;
  - `campaign_running`: chiến dịch chưa xoá "đang chạy" còn sống (có data "đang chạy", hoặc ghi / chạy trong
    `engine.account_hold_campaign_idle_hours` giờ, mặc định 6, không thêm dòng thiết lập).

  Không gì giữ thì trả NULL. Mọi bước đi chỉ mục: production 27/11 đo 11 khối, 0,2 ms. Chỉ `service_role` và `aka_agent_chat_api` gọi được.
- **Dọn một lần lúc apply** (như lần gỡ tay 15:21). Chỉ tài khoản Zalo Server, là phạm vi của sự cố:
  1. Xoá dấu giữ lượt quá hạn trên chiến dịch đích `server` của tài khoản Zalo Server chưa xoá.
  2. Trả tài khoản Zalo Server "đang chạy" mà không gì giữ, lần ghi cuối quá 3 phút, về "chờ xử lý".

  Bỏ qua dòng đang bị khoá và không gỡ lại sau đó. Kết quả báo bằng `RAISE NOTICE`. Không đụng tài khoản loại khác: 27/11 có 1 tài khoản
  Facebook của bản app cũ kẹt từ 07/10, gỡ thì chiến dịch của khách tự chạy lại sau nhiều tuần.
- Không thêm bảng, không thêm thiết lập.
- Apply buổi tối ngoài cao điểm: `CREATE OR REPLACE FUNCTION` làm PostgREST nạp lại schema.

### Desktop / App Server: bộ lập lịch

Logic chọn ở [staleRunningAccount.ts](../src/main/services/staleRunningAccount.ts).

- Tài khoản "đang chạy" mà máy này không chạy gì cho nó vẫn được đưa vào lượt quét. "Không chạy gì" nghĩa là: không hàng đợi, không làn
  riêng, không thao tác tài khoản, không lướt.
- Chỉ đưa chiến dịch đã tới lịch và chạy bằng engine v2. Hàm nhận lượt của DB quyết định (claim nhận tài khoản "đang chạy" từ V501).
- Tối đa một lần mỗi 2 phút mỗi tài khoản (`ENGINE_STALE_STATUS_PROBE_MS`, đồng hồ đơn điệu). Làn riêng của "Chạy cùng lúc" theo cùng luật.
- Bộ cũ vẫn đòi "chờ xử lý": hàng đợi mở cho tài khoản "đang chạy" không chạy bộ cũ.
- DB trả `legacy_busy` / `busy` thì Desktop ghi câu chờ cho chiến dịch quá lịch. Câu là câu của nút "Lý do đang chờ", Q21 đã duyệt. App
  Server không ghi câu chờ.
- Không cần V681 để chạy.

### Worker Fly: ChatApi

Nhánh `feat/engine-account-self-heal`, worktree `../akaAgentChatApi-account-self-heal`.

- `packages/database/src/engineAccountSelfHeal.ts` dò hàm `holder_v1` lúc khởi động và mỗi phút.
- Câu tìm chiến dịch (`listDueZaloServerCampaigns`) thêm nhánh (C) khi có cả V670 lẫn V681: tài khoản "đang chạy", không token thao tác,
  `holder_v1(...) IS NULL`.
- Bộ chọn của worker đã sẵn: lượt engine nhận, bộ cũ bỏ qua tài khoản "đang chạy".
- Hàm bị gỡ giữa chừng (lỗi 42883 / 3F000 / 42501) thì bỏ nhánh (C) ngay trong lượt đó và tắt tới lần dò sau.
- Chưa có V681 hoặc chưa có V670 thì câu SQL giữ nguyên như trước.

## Câu dò cho lần kiểm sức khoẻ

`node scripts/engine-v2-stuck-accounts.cjs [--all] [--json]` chỉ đọc, chạy được trước lẫn sau V681. Mã thoát 2 khi nhóm (A) hoặc
nhóm "cần xem" của (B) có dòng.

- **(A)** Tài khoản "đang chạy" mà không gì giữ, quá 3 phút. Luật giống `holder_v1`; bài kiểm V681 so hai bên. Có dòng là còn một đường
  làm lệch trạng thái cần tìm.
- **(B)** Tài khoản giữ token thao tác (`auto_accounts.runtime_operation_claim_token`) quá 30 phút, xếp theo chủ token (sửa 28/11, anh
  chốt "Chỉ sửa câu dò"; điều tra ở ghi chú `token-thao-tac-tai-khoan-20261127.md` của các phiên).
  - Token có hai chủ: lượt chiến dịch bộ cũ (`aka_agent_claim_campaign_runtime_v2` gắn đúng `auto_campaigns.runtime_claim_token` của
    lượt) và thao tác tài khoản (quét QR, quét data, Kiểm tra SĐT…). Không chủ nào ghi lại dòng tài khoản trong lúc chạy, nên số phút
    là tuổi của lượt giữ, không phải độ im lặng.
  - **Đang chạy:** lượt bộ cũ có log chiến dịch trong 60 phút (`--run-idle-minutes`; lướt newsfeed cộng thời gian lướt), tài khoản
    Desktop thì app còn online (presence trong 5 phút); Kiểm tra SĐT chưa đủ hạn mức ngày. Lượt Kiểm tra SĐT chết theo API Web cũng
    hiện ở đây: phân biệt bằng số đã tra hôm nay có tăng giữa hai lần quét.
  - **App không online:** tài khoản Desktop, app không gửi presence trong 5 phút và chưa mở lại sau lúc giữ. Tự gỡ ở lần đăng nhập kế.
  - **Cần xem**, mỗi dòng có lý do và cách gỡ:
    - app đang mở mà lượt bộ cũ không ghi log;
    - app mở lại mà token còn;
    - thao tác Desktop giữ lâu khi app đang mở;
    - lượt bộ cũ / thao tác trên tài khoản Server không ai chạy;
    - Kiểm tra SĐT đã đủ hạn mức mà chưa nhả.
- **(C)** Tài khoản đã xoá còn token: chỉ đếm. Không bước dọn nào gỡ, chỉ làm `private.app_access_held` luôn đúng cho nhân viên đó.

Production 16:49 VN 27/11, trước khi apply V681: 403 tài khoản "đang chạy", trong đó lease 325, token thao tác 77.
- (A): 1 tài khoản Facebook bản app cũ, kẹt từ 07/10.
- (B): 74 tài khoản. Câu dò lúc đó đọc `updated_at` là "lần ghi cuối" nên báo như tài khoản đứng. Điều tra 16:54 VN 27/11, 78 token
  trên tài khoản chưa xoá:
  - 71 lượt bộ cũ Desktop: 20 đang chạy, 51 app chưa mở lại;
  - 4 Kiểm tra SĐT trên Web đang chạy;
  - 2 thao tác Desktop chết theo app;
  - 1 thao tác App Server 10 giây.

  0 lượt bị chặn oan.

Production 09:40 VN 28/11 (bản câu dò mới), 421 tài khoản "đang chạy":
- (A): vẫn tài khoản Facebook 1197.
- (B): 63 tài khoản, đều là tài khoản Desktop.
  - Đang chạy 13: lượt bộ cũ Zalo trình duyệt / QR nhận từ 07:15 hôm nay, app online.
  - App không online 50: 48 lượt bộ cũ (giữ từ 25/09 tới 08:49 hôm nay) và 2 thao tác Desktop (5097, 10213).
  - Cần xem 0.
- (C): 30 tài khoản đã xoá, 9 nhân viên, giữ từ 18/09 tới 23/10.
- Đối chiếu với một ảnh chụp lấy bằng câu truy vấn riêng: khớp 63/63 dòng.

## Kiểm thử (27/11/2026)

| Bài | Kết quả |
|---|---|
| `LC_ALL=C CHAT_REPO=… node scripts/engine-account-hold-rule-v681-smoke.cjs` (PG17, thân production sau V670) | 13 nhóm: tái hiện sự cố, dọn một lần (kể cả dòng đang bị khoá lúc apply), luật V527 128 tổ hợp, lý do của `holder_v1`, job close_stale không tự gỡ, câu dò trùng `holder_v1` và xếp đúng nhóm (B) trên 15 ca (thêm 28/11), gỡ / apply lại |
| Bộ kịch bản engine v2 `SCENARIO_PARALLEL_RUN=1 SCENARIO_ORPHAN_RUNS=1 SCENARIO_FACEBOOK_MIGRATIONS=1 SCENARIO_TARGET_CHECK=1`, có / không `SCENARIO_ACCOUNT_HOLD=1` (`--rounds 4 --targets 30 --chaos 3 --inject 0.01 --dbchaos 0.01`) | Giống nhau (chỉ khác giờ dừng tính theo đồng hồ của S14): 708 lượt, 5.250 lần gửi, 19/19 kịch bản sự cố, 0 vi phạm mới |
| `node scripts/stale-running-account-smoke.cjs` | 9 đạt |
| `CHAT_REPO=… LC_ALL=C node scripts/engine-v2-server-runtime-scheduler-smoke.cjs` (bộ lập lịch App Server thật) | 12/12; trên code cũ 4 ca mới hỏng |
| `node scripts/campaign-parallel-run-desktop-smoke.cjs` | 7 nhóm (ca "đang chạy sót lại" đổi theo hành vi mới) |
| ChatApi `npm run verify` | typecheck + 3.423 bài |
| Hai typecheck akaAgent | sạch |

## Apply 27/11/2026

- **Chạy thử 16:51:07 VN.** Chạy một bản sao migration có khối cuối luôn báo lỗi, nên giao dịch tự huỷ.
  - Hết 118 ms. Bước dọn một lần: 0 dấu, 0 tài khoản (lần gỡ tay 15:21 đã dọn hết).
  - Job close_stale chạy bằng thân mới ra toàn số 0, không lỗi.
  - md5 và quyền đúng như bản sinh.
- **Apply 16:51:23–16:51:25 VN.** Dòng sổ được chèn trong cùng giao dịch (`scripts/make-migration-ledger-apply.cjs`). Dọn một lần: 0 / 0.
- **Hậu kiểm:**
  - md5 bốn hàm khớp; quyền và thuộc tính của release / close_stale không đổi.
  - Chỉ `service_role` và `aka_agent_chat_api` gọi được hai hàm mới.
  - Lượt job đầu chạy bằng thân mới (16:52:00) thành công sau 31 ms.
- **PostgREST** nạp lại schema mất 5,0 s. Trong khoảng 10 giây đó có 431 request quá 1 giây và 1 lỗi 5xx; không có lỗi 503.
- **RPC 10 phút trước so với ~3 phút sau apply:**
  - release_v1: 0 lỗi cả trước lẫn sau.
  - report_v1: 0 lỗi cả trước lẫn sau.
  - claim: 10 / 4.011 lỗi trước, 3 / 621 lỗi sau. Đều là Desktop hết 3 giây; claim không đổi ở bản này.
- **Câu dò:**
  - Trước apply: 403 tài khoản "đang chạy".
  - Sau apply: 385 tài khoản "đang chạy": lease 305, token thao tác 79.
  - Nhóm (A) vẫn chỉ tài khoản Facebook 1197; nhóm (B) vẫn 74.
- **Còn 142 dấu quá hạn đích `server`.**
  - Đều trên tài khoản Zalo Server đã xoá (90 tài khoản), giữ lượt từ 18/08 tới 21/11, không có data "đang chạy".
  - Luật mới bỏ qua chúng; bước dọn một lần cố ý không đụng tài khoản đã xoá.

## Thứ tự đưa lên

Ba phần độc lập, đưa theo thứ tự nào cũng được:

1. ~~Apply V681~~: đã làm lúc 16:51 VN 27/11 (mục "Apply 27/11/2026").
2. Deploy ChatApi `worker`: chưa có V681 thì nhánh (C) tự tắt.
3. Build Desktop + App Server.

## Gỡ

- `migrations/rollback_v681_engine_account_hold_rule.sql` trả thân V670 và xoá hai hàm, có kiểm md5.
- Bước dọn một lần không được khôi phục.
- Worker Fly tự tắt nhánh (C) ở lượt tìm kế tiếp.
- Bộ lập lịch không phụ thuộc V681.

## Còn hở (không thuộc bản này)

- Token thao tác tài khoản không có heartbeat. Điều tra 27/11: chưa chặn oan lượt nào, vì token Desktop chết theo app tự gỡ ở lần đăng
  nhập kế. Anh chốt 28/11: chỉ sửa câu dò (nhóm B), không thêm hạn / nhịp gia hạn cho Kiểm tra SĐT. Đường rò còn lại: API Web chết cứng
  giữa lượt Kiểm tra SĐT; token chỉ được gỡ khi App Server / worker Fly khởi động lại runtime của nhân viên.
- Chiến dịch "đang chạy" sót không token (claim bộ cũ Desktop) giữ tài khoản tới 6 giờ, theo luật `campaign_running`.
- Cổng bảo trì đầu ngày: giữ như Q19 / Q24.
