# Khôi phục V389 sau V391 và review — V392

Theo yêu cầu “áp dụng lại 389 rồi review code”, đã khôi phục logic V389 trong Desktop và DB **akachat** (`cgjbsmqtfhqvttudyjzq`) bằng migration mới **V392**, lúc **16:44 ngày 14/10/2026**. History: `20261014094452 / migration_v392_restore_facebook_random_run_lifecycle`. Giữ nguyên history V387/V389/V391, cấu hình/lịch sử tài khoản và RPC V390. Không chạy lại các migration cũ, không thực hiện hành động Facebook thật. Desktop đã typecheck/build local, chưa đóng gói hoặc phát hành.

Tại thời điểm V392, đây chỉ là khôi phục V389, chưa sửa thêm hai finding còn lại. **Hai finding đã được sửa tiếp bằng [V393](FACEBOOK_RANDOM_RUN_BOUNDARIES_V393.md)**; nội dung review bên dưới được giữ làm chứng cứ lịch sử.

## Phạm vi

- Khôi phục kết thúc budget qua cleanup có kiểm tra token và ý định pause, thay cho cập nhật trạng thái trực tiếp.
- Xóa unit lease RAM ngay sau khi DB xác nhận settle; đọc progress lỗi đi qua `FacebookRandomProgressReadError`, không retry unit đã settle hay áp policy lỗi target; cleanup parent được xử lý cả từ executor lẫn `finally`.
- Khôi phục bốn body RPC/helper, bốn helper private và một trigger giống V389. Output được chốt khi giải phóng ownership; recovery xét cả lịch sử khi mode đã tắt; đọc/finish ngày đóng vẫn dùng được.
- Không thêm bảng/cột/job/polling/connection. Không đổi signature public, owner, security mode, volatility, search_path/timeout hoặc ACL của function cũ.
- Hai vòng lặp `matchAll` trong `src/shared/campaignDiagnostics.ts` được bọc `Array.from` để qua target TypeScript renderer hiện tại. Đây là sửa tương thích biên dịch, giữ nguyên logic lọc credential đang có; smoke 942 biến thể và transport giả lập đạt. Không đổi RPC/model/cấu hình V390.

## Audit DB

[SQL canonical](../migrations/migration_v392_restore_facebook_random_run_lifecycle.sql) · [live source](../migrations/snapshots/facebook-random-run-restore-v392/source.json) · [diff function](../migrations/snapshots/facebook-random-run-restore-v392/function-changes.patch) · [audit](../migrations/snapshots/facebook-random-run-restore-v392/audit.json) · [receipt](../migrations/snapshots/facebook-random-run-restore-v392/apply.json) · [sau apply](../migrations/snapshots/facebook-random-run-restore-v392/after.json).

Đã verify linked ref, capture lại đúng `pg_get_functiondef` và metadata trong task này, tìm các migration liên quan V231/V268/V387/V389/V391. Mười function nguồn khớp V391; không có patch live mới trên tập function này. Áp lại đúng các diff V389 trên body vừa capture, kiểm tra kết quả bằng checksum V389. Bốn helper không tồn tại live được dựng lại từ audit V389 và quyền tương ứng. Preflight fail-closed kiểm tra mười function, helper/trigger phải chưa có và không có account bật hoặc random turn đang chạy.

| Signature sửa | MD5 trước V392 | MD5 sau V392 |
| --- | --- | --- |
| `aka_agent_cleanup_failed_campaign_runtime(bigint,bigint,bigint,text,uuid,uuid,bigint[],text,boolean,text,text)` | `c6c1947084ba01a0a8d3325651c79424` | `f506f8695e3e874642e3c845e103e42d` |
| `aka_agent_facebook_random_run(bigint,bigint,text,text,bigint,text,jsonb)` | `a16c93a8853fcd34420b5e0f00478542` | `d82e1fa2561ca34c2e365a41a58b8ca4` |
| `aka_agent_recover_campaign_runtime_unit_leases(bigint,text,text)` | `3bfcf3483700f6994858589334f2dc46` | `048ea7194cd77589ffeb1820353f500c` |
| `private.facebook_random_unit_recover(bigint,bigint,uuid)` | `a8f8ca1343cb7c6936b5e5e93d1f660d` | `0aea61ae267927a82b4f3e921ba468cf` |

Helper khôi phục:

- `private.facebook_random_finalize_turn(bigint,bigint,uuid,uuid,boolean)` — `687fc3efe8378dd175f88f852bc47a51`.
- `private.facebook_random_finalize_on_release()` — `fe9cfbe03cf37328f45dabfb1ddbb155`.
- `private.facebook_random_pause_requested(bigint,bigint,uuid)` — `172635824af6f7a3a0cae242c0d1d978`.
- `private.facebook_random_orphan_turns(bigint,bigint)` — `ea0c365929e5731b4e6436bfc1c58883`.

Trigger `facebook_random_finalize_on_release`: enabled `O`, MD5 `dd0ac9f39049a53820c839a62d85cac2`. Cả 14 function sau apply khớp definition/attributes V389; sáu function trong tập audit không sửa. Hai RPC reset Desktop và RPC diagnostics V390 được đọc riêng để review, checksum giữ nguyên sau apply.

SHA256 canonical: `235b82b990efa477618b01be4d2a5c5c8e9bb975ffd0c128ad263d67edc99b4f`. Apply qua cơ chế linked CLI hiện có với history cùng transaction, không thêm DDL chuẩn bị schema migration. Không yêu cầu explicit PostgREST reload vì metadata public API không thay đổi; helper mới nằm trong private. API sau apply đạt. Trước/sau apply: 0 account bật, 0 row lịch sử. Một query metadata phục vụ review bị chậm đã bị hủy trước khi thử lại với timeout; không phải mutation hoặc apply thất bại. Lần verify CLI sau apply bị từ chối đăng nhập bằng temporary role và gặp circuit breaker; đã ngừng retry, dùng connector Supabase có sẵn để xác minh đủ metadata/history/trigger và chạy smoke ROLLBACK. Không apply lại migration. CLI linked trong môi trường này dùng temporary SQL role; không gọi nó là đường Management API thuần HTTP.

## Kiểm chứng khôi phục

| Kiểm tra | Kết quả |
| --- | --- |
| `node scripts/facebook-random-run-restore-migration.cjs audit` | PASS: metadata 14 function và smoke live kết thúc bằng ROLLBACK, `SET LOCAL ROLE anon` thật |
| Verify sau apply qua connector Supabase (CLI gặp lỗi temporary-role auth) | PASS: đủ 14 checksum/attributes, trigger, history V389/V391/V392, reset/V390 giữ nguyên và SQL rollback; receipt trong `after.json` và `rollback-smoke.json` |
| `node scripts/facebook-random-run-lifecycle-smoke.cjs --restored-v392` | 48 checks PASS trên fixture áp V387 → V389 → V391 → V392 |
| `node scripts/facebook-random-run-runtime-smoke.cjs` | 21 checks PASS, executor giả lập |
| `node scripts/campaign-failure-cleanup-smoke-test.cjs` | PASS: pause/retry/ownership cũ và progress lỗi từ executor/finally chỉ settle/cleanup một lần |
| `node scripts/facebook-page-content-rotation-smoke-test.cjs` | PASS |
| `node scripts/campaign-diagnostics-smoke.cjs` | PASS, bao gồm 942 biến thể credential |
| Hai typecheck node/web | PASS, 0 lỗi sau chỉnh tương thích iterator |
| `npm run build` | PASS; chỉ cảnh báo bundler hiện có |
| `git diff --check` | PASS |

[API smoke](../migrations/snapshots/facebook-random-run-restore-v392/api-smoke.json): projection HTTP 200/limit 0, credential sai bị chặn `400/P0001/automation_auth_invalid`, đọc trực tiếp lịch sử bị chặn `401/42501`. [Security advisors](../migrations/snapshots/facebook-random-run-restore-v392/security-advisors.json) so sánh trước/sau; không mở thêm public API hoặc quyền trực tiếp bảng.

## Review: hai finding còn lại

Tái hiện bằng `node scripts/facebook-random-run-v392-review.cjs`; [kết quả](../migrations/snapshots/facebook-random-run-restore-v392/review.json). Script cố ý xác nhận lỗi còn tồn tại, không phải acceptance test đánh dấu đã sửa. Không có Facebook I/O.

1. **P1 — Pause đến muộn vẫn có thể bị bỏ qua ở cuối budget.** `finishRandomBudget` chụp `pauseRequested` trước RPC cleanup và không kiểm tra lại sau RPC. Khi request pause đã đọc campaign đang chạy nhưng write note phải chờ cleanup, cleanup có thể giải phóng token trước; write note theo token cũ không còn khớp. Tái hiện bằng hai method thật với thứ tự response được kiểm soát: `requestPauseCampaign` và campaign đều trả “chờ xử lý”, trong RAM vẫn còn pause latch. Máy khác có thể nhận campaign còn pending. Cần xử lý pause đến muộn sau cleanup qua guard hiện có, không ghi đè owner mới.
2. **P2 — Reset lúc restart có thể chốt nhầm “Hoàn tất đợt”.** Handler gọi reset trước unit recovery. Khi đã settle 1/3 nhưng parent claim còn, reset chuyển campaign sang pending/note NULL, BEFORE trigger bỏ claim rồi AFTER trigger V389 gọi finalizer với `p_recovered=false`. Finalizer thấy processed > 0 và không có reason nên ghi `completed`; recovery sau đó bỏ qua vì đợt không còn `running`. Tái hiện bằng body reset live mới capture và DB fixture: `completed`, processed=1, quantity=3, reason=NULL, vẫn còn ba input pending. Cần phân biệt kết thúc bình thường với reset/recovery; chỉ so processed với quantity sẽ sai với đợt hoàn tất vì hết data.

Không phát hiện bằng chứng mới cho kết luận “cứ dùng token là bị treo vĩnh viễn”. Retry tạm thời không giới hạn và `recovery_required` có từ trước V389 vẫn là giới hạn vận hành; kiểm thử phục hồi không bao phủ mọi lỗi production. Chưa stress nhiều backend/hai máy thật hoặc E2E Facebook. Không tự sửa hai finding trên trong task khôi phục + review.

## Vận hành

Không chạy lại V389/V391/V392 khi phát hành. Chỉ dùng script verify V392 khi live còn ở checksum này. Muốn rollback hoặc sửa findings phải capture live lại và tạo migration mới; tắt chế độ và chờ lượt hiện tại kết thúc trước khi đổi lifecycle. Giữ cấu hình/lịch sử và không tự phát lại thao tác chưa rõ kết quả.
