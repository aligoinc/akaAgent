# Cleanup khi lượt campaign gặp lỗi

Desktop và Zalo Server dùng chung nhánh cleanup trong `CampaignScheduler`. Chạy bình thường không gọi RPC cleanup. Retry claim/settle và RPC release bình thường giữ nguyên.

## Luồng xử lý

- Lỗi thoát khỏi workflow/hàm con giữ lại parent token, unit token và tập data chưa bắt đầu. Các node song song đã bắt đầu phải kết thúc trước khi workflow trả lỗi. `finally` của nhánh lỗi chỉ dọn tài nguyên, không settle unit đã bàn giao.
- Preflight không đủ điều kiện và pause boundary chỉ release account sau khi bước cập nhật/đọc trạng thái campaign và log pause thành công. Lỗi tại các bước này được ghi nhớ trước khi trả về caller; không có `finally` thả account sớm. Desktop ghi pause trước release và bàn giao yêu cầu pause chưa ghi được cho cleanup sau policy. Pause vẫn settle unit đã hoàn tất theo cơ chế cũ trước bước đổi trạng thái.
- Chính sách lỗi được đánh dấu trước khi bắt đầu. Lỗi trong policy được giữ theo lượt; catch lồng nhau không đọc/áp lại policy đó. Ở outer error handler, yêu cầu đổi trạng thái từ policy được chuyển vào cleanup atomic, tránh giải phóng account trước unit.
- Một promise cleanup cho mỗi lượt, payload đóng băng trước request đầu. Lỗi DB tạm thời chờ 2.000 ms sau khi request thất bại rồi thử tiếp, không giới hạn và không có request chồng. Lỗi quyền/contract/tham số không retry.
- RAM chỉ giữ scope, tên campaign để báo lỗi, token/unit và các ID chưa bắt đầu. Khi chưa xác nhận cleanup, account không nhận campaign hoặc tác vụ ngoài campaign mới.
- Shutdown hủy cả khoảng chờ và HTTP request cleanup qua `AbortSignal`; không mở request mới. Hủy HTTP không chứng minh DB chưa commit, vì vậy vẫn giữ claim để recovery hiện có xử lý sau khi producer đã dừng. Recovery thành công mới xóa hold đúng staff/platform.
- Cleanup thành công kết thúc promise trước refresh UI. Refresh/log lỗi không mở lại cleanup. Scheduler tiếp tục kiểm tra maintenance, lịch, quota và cutoff như cũ. Pause Desktop khi cleanup đang chờ dùng CAS theo parent token; không sửa payload retry.

## Hợp đồng SQL v268

Production: `cgjbsmqtfhqvttudyjzq`. Source lấy trực tiếp bằng `pg_get_functiondef()` ngày 09/09/2026; không dùng body migration lịch sử. Migration `migration_v268_campaign_failure_cleanup.sql` có preflight fail-closed cho claim v2 và các dependency ownership/serialization.

| Signature | MD5 source | MD5 target |
| --- | --- | --- |
| `aka_agent_claim_campaign_runtime_v2(bigint,bigint,bigint,text,uuid)` | `782a8b7adf396f21f7d69bc4a613bce1` | `c822891785abb3fadf2576ec02b6b6f8` |
| `aka_agent_cleanup_failed_campaign_runtime(bigint,bigint,bigint,text,uuid,uuid,bigint[],text,boolean,text,text)` | Chưa tồn tại | `b2f96f32a1c288246d99b63bb2ee05ef` |

Cả hai hàm: owner `postgres`, `SECURITY INVOKER`, volatile, `search_path=pg_catalog, public`; EXECUTE cho `postgres`, `anon`, `authenticated`, `service_role`, `aka_agent_chat_api`, không cấp PUBLIC. Claim chỉ thêm gắn account operation token vào transaction claim mới; giữ nguyên eligibility, entitlement/subtype, Data Group guard, cutoff, stale schedule, unit-busy và retry cùng token sau mất phản hồi. Legacy release và settle v2 không bị thay đổi; rollback test xác nhận vẫn hoạt động với account token mới.

RPC mới nhận campaign/account/staff/runtime, parent/unit token, các data chắc chắn chưa bắt đầu, note, cờ aggregate không rõ kết quả và ý định pending/paused của policy. Kết quả:

- `cleaned` / `already_cleaned`: kết thúc thành công; lần gọi lại sau commit không ghi thêm.
- `not_owner`: token khác hoặc scope không còn thuộc caller; không sửa dữ liệu.
- `not_found`, `insufficient_ownership`, `invalid_unstarted_ids`: dừng và giữ hold để recovery, không reset cưỡng ép.

Khóa theo thứ tự staff → input serialization → input IDs của lease → campaign/account. Chỉ sửa lease có đúng token; terminal input `tạm dừng`/`hoàn thành` được giữ nguyên. Data chưa bắt đầu được trả về chờ; data đã bắt đầu nhưng chưa xác nhận được kết thúc với note không tự gửi lại, kể cả đã bị một error handler đưa về chờ trước khi handler lỗi tiếp. Aggregate không xác định thì pause campaign còn thuộc token đó. Account/campaign đã pause, completed hoặc thuộc lượt mới được giữ nguyên. Trạng thái cleanup và xóa token cùng transaction; xóa parent metadata riêng sau status update để tương thích trigger giữ token khi Server pause.

Không thêm bảng/cột, SQLite, job, bộ điều phối hay timeout. Một lần reload schema trong migration vì thêm signature RPC; không reload cho data-only changes.

## Kiểm tra

```bash
node scripts/campaign-failure-cleanup-smoke-test.cjs
node scripts/page-inbox-campaign-run-smoke-test.cjs
npx tsc --noEmit -p tsconfig.node.json
npx tsc --noEmit -p tsconfig.web.json
npm run build
npm run build:server
```

Smoke harness chạy toàn bộ class scheduler/engine thực với adapter DB/browser và đồng hồ giả: 9 lần cleanup, khoảng chờ tính sau lỗi request, policy lỗi lần hai, nested finally, no overlap, pause, mất owner, shutdown trong khoảng chờ/request, hold đúng scope và refresh/log lỗi. Có đối chiếu code retry claim/settle với HEAD để xác nhận giữ nguyên.

Ma trận preflight/pause cho Desktop Facebook, Zalo local và Server giả lập lỗi cập nhật/đọc campaign, mất phản hồi commit, log pause và release account; xác nhận ownership được giữ tới cleanup, policy lỗi tiếp vẫn cleanup, yêu cầu pause không bị policy đưa về chờ và luồng thành công không gọi thêm cleanup RPC. Bổ sung này chỉ đổi TypeScript và smoke test, không cần migration/reload schema mới.

Tám đường pause trong executor (đầu lượt, sau bốn nguồn data Zalo, sau đề xuất Facebook, trước/sau batch mời group Facebook) đều qua `completePauseAtBoundary`. Test chạy executor thật qua đủ tám đường, mỗi đường có ba trường hợp: thành công, ghi pause thất bại và mất phản hồi commit. Giữ riêng đường pause muộn sau khi account đã release bằng RPC control có guard.

Hai catch lồng nhau ở batch mời group Facebook và guard mốc ngày chuyển tiếp lỗi đã ghi nhận trong `failedCampaignRuns` tới cleanup ngoài cùng; không áp policy batch hoặc gọi lại yield để che mất lỗi pause. Test tái hiện unit claim mất phản hồi rồi account pause, và pause lỗi ở mốc 23:59; xác nhận cleanup retry đúng 2 giây, không release sớm, đồng thời giữ fallback cho lỗi đọc guard và policy batch thông thường.

`scripts/campaign-failure-cleanup-rollback.sql` dùng fixture ID tường minh, không tăng sequence và luôn `ROLLBACK`; kiểm tra quyền anon, idempotence, account token, input gửi dở, token mới, status pause/completed, trigger Server và cutoff. Trước apply, chèn migration sau `BEGIN`; sau apply chạy lại fixture không kèm DDL. Không gửi tin thật hoặc restart VPS production trong smoke test.

## Triển khai và giới hạn

Đã áp riêng migration `v268_campaign_failure_cleanup` lên production `cgjbsmqtfhqvttudyjzq` ngày 09/09/2026. Kiểm tra sau apply khớp hai target checksum, owner, security mode, volatility, search path và ACL ở trên; SQL rollback smoke chạy lại thành công, không còn fixture account/campaign/input. Preflight đã được thử với checksum cố ý sai và từ chối trước DDL. Cả hai typecheck, build Desktop/Server và các smoke test Node đều thành công.

RPC được triển khai trước binary Desktop/Server. Không bulk-push migration khác trong workspace. Chưa phát hành/cài binary mới; source build không tự thay ứng dụng đang chạy trên máy người dùng/VPS.

DB lỗi kéo dài làm cleanup retry theo số campaign bị ảnh hưởng. Khi mất quyền hoặc lỗi contract, account vẫn bị giữ để recovery; reconnect/polling không tự tạo cleanup khác. Trong thời gian chờ, campaign khác cùng staff có thể bị maintenance gate chặn.
