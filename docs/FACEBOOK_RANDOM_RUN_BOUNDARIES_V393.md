# Sửa pause đến muộn và output sau restart — V393

Đã sửa hai finding còn lại sau review V392. DB **akachat** (`cgjbsmqtfhqvttudyjzq`) đã apply `20261014100217 / migration_v393_facebook_random_run_boundaries` lúc **17:02 ngày 14/10/2026**. Desktop đã typecheck/build local, chưa đóng gói hoặc phát hành. Không thực hiện hành động Facebook thật.

## Hành vi

- **Pause trong lúc kết thúc budget:** sau cleanup và refresh, nếu có yêu cầu pause đến muộn, scheduler gọi lại helper hiện có `completeReleasedDesktopCampaignPause`. RPC control kiểm tra trạng thái và quyền sở hữu trước khi chuyển pending → paused. Nếu máy khác đã nhận campaign, không ghi đè owner mới; giữ cơ chế pause tại boundary hiện có. Nếu pause đã commit rồi có resume mới, xóa latch của pause cũ. Không tạo token, loại cleanup, retry hoặc timer mới.
- **Restart sau khi chạy dở:** hai RPC reset đặt `aka_agent.facebook_random_reset_staff` bằng staff ID, chỉ quanh câu UPDATE campaign. Trigger finalize bỏ qua release trong ngữ cảnh reset của đúng staff. Unit/orphan recovery hiện có sau reset chốt đợt thành stopped cùng lý do gián đoạn, kể cả random mode đã tắt.
- Dấu reset là setting transaction-local, không phải cột hoặc lease. Sau UPDATE, function khôi phục giá trị trước đó; lỗi statement/subtransaction rollback phục hồi context và dữ liệu. Không dùng setting này làm guard quyền hay điều kiện cho phép chỉnh sửa.
- Đợt hết data ở 1/3 vẫn được kết thúc bình thường. Không suy luận “bị gián đoạn” chỉ từ processed < quantity. Không sửa các policy xử lý input chưa rõ kết quả của reset/recovery.
- Không thêm bảng/cột/index/RPC public/pool/connection/job/polling. Không đổi thứ tự lock, guard tenant/ownership, chữ ký, owner, security mode, volatility, search_path hoặc ACL.

## Audit và triển khai

[Migration canonical](../migrations/migration_v393_facebook_random_run_boundaries.sql), [live source](../migrations/snapshots/facebook-random-run-boundaries-v393/source.json), [diff thay đổi](../migrations/snapshots/facebook-random-run-boundaries-v393/function-changes.patch), [target](../migrations/snapshots/facebook-random-run-boundaries-v393/target.json), [receipt](../migrations/snapshots/facebook-random-run-boundaries-v393/apply.json), [verify sau apply](../migrations/snapshots/facebook-random-run-boundaries-v393/after.json).

Đã capture live trong task này, tìm các migration liên quan, so body reset với V219 và helper với V392. Hai body reset khớp V219; helper khớp V392. Không có patch DB-only trong ba body cần sửa. Giữ nguyên bốn support function vừa capture: control status, recovery leases, finalize turn và orphan turns. Preflight fail-closed kiểm tra checksum cả bảy signature trước khi sửa.

| Signature sửa | MD5 nguồn | MD5 V393 |
| --- | --- | --- |
| `private.facebook_random_finalize_on_release()` | `fe9cfbe03cf37328f45dabfb1ddbb155` | `3c2bbb2182f0b293361b02c5efcbfd2a` |
| `reset_desktop_running_statuses_no_retry(bigint,boolean,boolean)` | `e1a49a6ef67e3e6359cf8c8163e98418` | `bfda9371f3964c1e3a0d3bccb58167b9` |
| `reset_desktop_running_statuses(bigint,boolean,boolean)` | `db9b98d9a64b555f149bfce8fc658a2c` | `dc304ed20a0b6cab0824f9bbfbcb30c8` |

SHA256 migration: `bed87e486fe227ae0f88a1d3a193d287bd0ed183d703de0f319a57095f56597a`. Trigger giữ enabled `O`, MD5 `dd0ac9f39049a53820c839a62d85cac2`. Trước/sau apply: 0 account bật, 0 row lịch sử; không có lịch sử cần backfill.

Apply qua linked CLI hiện có, một migration và history trong cùng transaction; không thêm DDL chuẩn bị bảng history. Không gọi explicit schema reload vì chỉ đổi body, metadata public API giữ nguyên; event trigger DDL chung của DB vẫn được giữ. API sau apply đã kiểm tra. Không apply lại V387/V389/V391/V392/V393 khi phát hành.

## Kiểm chứng

| Kiểm tra | Kết quả |
| --- | --- |
| `node scripts/facebook-random-run-boundaries-smoke.cjs` | PASS: 7 tình huống pause + 12 tình huống SQL trên scheduler thật/PGlite |
| `node scripts/facebook-random-run-lifecycle-smoke.cjs --boundaries-v393` | PASS: 48 kiểm tra lifecycle sau V387 → V389 → V391 → V392 → V393 |
| `node scripts/facebook-random-run-runtime-smoke.cjs` | PASS: 21 kiểm tra, executor giả lập |
| `node scripts/campaign-failure-cleanup-smoke-test.cjs` | PASS: retry, ownership, pause, lỗi đọc progress trong executor/finally và cleanup hiện có |
| `node scripts/facebook-page-content-rotation-smoke-test.cjs` | PASS: 42 biến thể |
| Hai typecheck node/web | PASS, 0 lỗi |
| `npm run build` | PASS, log local `/tmp/facebook-random-v393-build.log` |
| `git diff --check` | PASS |

SQL thử trước và sau apply đều kết thúc bằng **ROLLBACK**, dùng `SET LOCAL ROLE anon` thật. Kiểm tra cả hai reset RPC khi 1/3, mode tắt, context trước đó được khôi phục, late pause sau release, owner mới được bảo vệ; giữ các kiểm tra auth/tenant/RLS, token replay, atomic finish và competing plan từ V389. [SQL](../migrations/tests/migration_v393_facebook_random_run_boundaries_rollback.sql), [trước apply](../migrations/snapshots/facebook-random-run-boundaries-v393/preapply-smoke.json), [sau apply](../migrations/snapshots/facebook-random-run-boundaries-v393/rollback-smoke.json).

PGlite kiểm tra thêm mode bật/tắt, unit đang chạy/đã settle, reset lỗi giữa UPDATE không giữ context, khôi phục context có sẵn, normal release 1/3 do hết data và 3/3. Test giữ policy đếm input đã được no-retry reset chốt; không giả định mọi unit chưa settle đều có processed=0.

[API smoke](../migrations/snapshots/facebook-random-run-boundaries-v393/api-smoke.json): cả hai reset API từ chối staff ID 0 bằng P0001 trước mutation, account projection limit 0 trả 200, direct history read bị chặn 401/42501. [Security advisors](../migrations/snapshots/facebook-random-run-boundaries-v393/security-advisors.json): so trước/sau, không phát sinh finding mới.

Kiểm chứng ban đầu chưa bao phủ hai finding của review tiếp theo: hai RPC pause có thể ghi đè resume mới, và lỗi control sau cleanup bị tính thành target lỗi. Theo yêu cầu người dùng, giữ lại trường hợp đầu vì hiếm và tác động thấp; chỉ sửa finding 2 như dưới đây. Chưa stress hai máy/backend thực hoặc E2E Facebook; kiểm thử race dùng thứ tự response kiểm soát được, DB guard dùng function thật. Reproduction V392 là chứng cứ lịch sử của code trước V393; dùng smoke V393 để kiểm tra code hiện tại.

## Bổ sung Desktop ngày 14/10/2026 — chỉ sửa finding 2

`finishRandomBudget` bắt lỗi tại lời gọi pause sau khi cleanup đã xác nhận thành công. Lỗi control hoặc tải lại trạng thái chỉ ghi cảnh báo “Chưa xác nhận được yêu cầu tạm dừng”, không đi vào policy target và không cleanup lại parent đã nhả. Giữ nguyên latch của helper: yêu cầu chưa xác nhận vẫn còn; nếu RPC đã xác nhận pause nhưng bước refresh lỗi thì không bật lại latch cũ.

Chỉ sửa nhánh scheduler và thêm hồi quy vào `scripts/campaign-failure-cleanup-smoke-test.cjs`; không sửa helper dùng chung, finding 1, SQL hoặc production. Không thêm token, retry, timer hay migration. Cảnh báo dùng luồng log hiện có và không báo đã dừng thành công khi chưa xác nhận.

Kiểm thử gồm lỗi control trước commit, mất phản hồi sau commit, lỗi refresh sau xác nhận và đường thành công. Test mới thất bại trước bản sửa vì tăng target lỗi 1; sau sửa xác nhận không gọi policy, không tăng bộ đếm, chỉ cleanup 1 lần, không còn failed-run/boundary, không thêm timer và giữ đúng pause latch. Các kiểm tra cleanup cũ vẫn qua; hai typecheck sạch, production build và `git diff --check` đạt. Log smoke: `/tmp/facebook-random-pause-control-smoke.log`; build: `/tmp/facebook-random-pause-control-build.log`. Chưa đóng gói/phát hành.

## Bổ sung Desktop ngày 14/10/2026 — giữ lý do dừng ngẫu nhiên

Review toàn bộ tái hiện việc tắt random mode khi đang chạy đối tượng đầu tiên của đợt 3 đối tượng: sau khi unit settle, runtime dừng đúng nhưng output ghi `completed`, processed 1/3, reason NULL dù còn data. Nguyên nhân là `finishRandomBudget` gửi note rỗng khi cleanup; trigger đã chốt đợt trước khi RPC `finish` nhận lý do ở RAM, nên RPC trả nguyên trạng thái terminal.

Scheduler nay truyền lý do `Đã dừng chạy ngẫu nhiên` từ nhánh `random_mode_changed` vào cleanup trong cùng transaction release hiện có. Chỉ truyền lý do khi có đợt ngẫu nhiên; bật chế độ giữa lượt chạy thường không bị gán lý do này. Pause đã được yêu cầu tại lúc cleanup ưu tiên `Đang chờ tạm dừng`. Đợt đủ budget hoặc hết data vẫn dùng lý do rỗng, không suy diễn dừng sớm chỉ từ processed < quantity.

`node scripts/facebook-random-run-stop-reason-smoke.cjs` dùng boundary scheduler thật nối với SQL fixture V393, role anon và transaction ROLLBACK. Bốn tình huống: tắt giữa đợt, tắt kèm pause, đủ 3/3, normal release 1/3 khi hết data. Kiểm tra status/reason/processed ngay sau cleanup, token đã nhả, data chưa chạy còn nguyên và `finish` không đổi output đã chốt. Test thất bại trước sửa (`completed` thay vì `stopped`) và đạt sau sửa. Smoke runtime 21 checks, lifecycle V393 48 checks, cleanup và hai typecheck đều qua.

Production build và `git diff --check` đạt; log build `/tmp/facebook-random-stop-reason-build.log`.

Không thay body RPC, schema hoặc production; không thêm migration, token, RPC call, retry hay timer. Bản sửa áp dụng cho các đợt được bản Desktop mới xử lý, không sửa lịch sử đã ghi trước đó. Race pause/resume đã chấp nhận trước đó vẫn giữ nguyên. Log kiểm chứng local: `/tmp/facebook-random-stop-reason-smoke.log`, `/tmp/facebook-random-stop-cleanup.log`, `/tmp/facebook-random-stop-runtime.log`, `/tmp/facebook-random-stop-lifecycle.log`. Chưa đóng gói/phát hành.

## Vận hành và rollback

Lỗi pause cần bản Desktop chứa nhánh mới; DB V393 sửa việc phân loại output sau restart. Chưa phát hành installer trong task này.

Nếu cần rollback, tắt random mode và chờ lượt hiện tại kết thúc. Capture lại ba signature live, đối chiếu checksum rồi tạo migration mới để khôi phục body nguồn đã lưu; bỏ đúng nhánh kiểm tra late pause mới của Desktop. Không chạy lại migration V391 hoặc reset cả file, không xóa cấu hình/lịch sử. Rollback này sẽ đưa hai lỗi đã sửa trở lại.

Tài liệu tham chiếu về phạm vi transaction-local của `set_config(..., true)`: [PostgreSQL](https://www.postgresql.org/docs/current/functions-admin.html#FUNCTIONS-ADMIN-SET). Changelog Supabase đã được kiểm tra; các thay đổi minor release về extension/index không liên quan ba body trong bản sửa này.
