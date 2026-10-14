# Hoàn nguyên riêng bản sửa V389 — V391

**Trạng thái này đã được thay bằng [V392](FACEBOOK_RANDOM_RUN_RESTORE_V392.md) lúc 16:44 ngày 14/10/2026:** người dùng yêu cầu khôi phục lại V389 và review. Tài liệu bên dưới giữ audit lịch sử của lần hoàn nguyên, không phải trạng thái hiện hành. Không chạy lại script V391.

Đã apply trên **akachat** (`cgjbsmqtfhqvttudyjzq`) lúc **16:10 ngày 14/10/2026**, history `20261014091058 / migration_v391_revert_facebook_random_run_lifecycle`, theo yêu cầu **chỉ hoàn nguyên V389**. Giữ tính năng Chạy ngẫu nhiên V387, cấu hình và lịch sử; không sửa V390. Desktop đã typecheck/build local, chưa đóng gói hoặc phát hành. **Không apply lại V387/V389/V391.**

## Phạm vi hoàn nguyên

- Scheduler trở về luồng V387: hết budget cập nhật campaign về chờ xử lý rồi giải phóng account; bỏ nhánh cleanup token-CAS do V389 thêm tại điểm này.
- Bỏ xử lý riêng `FacebookRandomProgressReadError` của V389. Việc đọc tiến độ sau settle và xóa lease RAM trở về thứ tự V387; giữ các guard claim/unit/cleanup đã có trước V389.
- Hoàn nguyên đúng bốn function đã bị V389 sửa: RPC random-run, RPC cleanup, RPC recovery unit và helper recovery random.
- Gỡ bốn helper private `facebook_random_finalize_on_release`, `facebook_random_finalize_turn`, `facebook_random_orphan_turns`, `facebook_random_pause_requested` và trigger `facebook_random_finalize_on_release` trên `auto_campaigns`.
- Không xóa bảng/cột, cấu hình, lịch sử ngày hay migration history. Không thêm pool, connection, timer hoặc job. Không đổi UI, rule, cách chọn campaign, chỉ tiêu hay policy action/quota của V387.

Đây là hoàn nguyên hành vi, không phải bản sửa mới cho các vấn đề đã review. Các rủi ro V387 trở lại: pause có thể bị ghi đè khi trùng thời điểm kết thúc budget; lỗi đọc progress sau settle có thể giữ lease RAM; việc chốt lịch sử sau release/restart vẫn phụ thuộc luồng V387. Chưa có số liệu thực tế để kết luận các tình huống này hiếm.

**Token claim/unit và recovery có từ trước V389 vẫn còn.** Hoàn nguyên V389 không bảo đảm loại bỏ mọi trường hợp bị kẹt không sửa được. Review xác định cleanup hiện có retry không giới hạn số lần với lỗi tạm thời; kết quả lỗi vĩnh viễn có thể được giữ là `recovery_required` đến quy trình recovery lúc khởi động. Mô tả cũ “cleanup có giới hạn” trong audit V389 đã được đính chính.

## Audit và an toàn apply

[Canonical SQL](../migrations/migration_v391_revert_facebook_random_run_lifecycle.sql) · [source live](../migrations/snapshots/facebook-random-run-revert-v391/source.json) · [preflight](../migrations/snapshots/facebook-random-run-revert-v391/preflight.json) · [audit](../migrations/snapshots/facebook-random-run-revert-v391/audit.json) · [receipt](../migrations/snapshots/facebook-random-run-revert-v391/apply.json) · [sau apply](../migrations/snapshots/facebook-random-run-revert-v391/after.json).

Đã đọc lại đúng signature bằng `pg_get_functiondef()` từ linked production trước khi dựng SQL; đối chiếu thay đổi V389 và đảo đúng các đoạn thay đổi trên body live. Kết quả bốn body khớp bản trước V389. Preflight fail-closed kiểm tra 14 function và trigger, yêu cầu mọi account tắt random và không có random turn đang chạy. Không dùng `DROP ... CASCADE`. Các helper được bỏ chỉ sau khi gỡ các tham chiếu do V389 thêm.

| Function thay đổi | MD5 live V389 | MD5 sau V391 |
| --- | --- | --- |
| `aka_agent_cleanup_failed_campaign_runtime` | `f506f8695e3e874642e3c845e103e42d` | `c6c1947084ba01a0a8d3325651c79424` |
| `aka_agent_facebook_random_run` | `d82e1fa2561ca34c2e365a41a58b8ca4` | `a16c93a8853fcd34420b5e0f00478542` |
| `aka_agent_recover_campaign_runtime_unit_leases` | `048ea7194cd77589ffeb1820353f500c` | `3bfcf3483700f6994858589334f2dc46` |
| `private.facebook_random_unit_recover` | `0aea61ae267927a82b4f3e921ba468cf` | `a8f8ca1343cb7c6936b5e5e93d1f660d` |

Snapshot lưu đầy đủ signature, body, owner, security mode, volatility, config/search_path/timeout và ACL. Cả 10 function còn lại trong phạm vi audit khớp metadata mong đợi; sáu function không bị V389 sửa giữ nguyên. V390 không nằm trong tập function được thay đổi. SHA256 canonical: `9c73969b16a9804dc9d00bb56287b6d6ab8198e1be0353423bc7a8b4f11de194`.

Apply qua linked Management API, mutation và ghi history cùng transaction, `lock_timeout=5s`; không tạo DDL phụ cho migration schema. Không đổi signature/return type/thuộc tính API public; helper private không thuộc API nên không yêu cầu reload PostgREST. API được kiểm tra sau apply. Trước/sau apply đều **0 account bật và 0 bản ghi ngày**. Việc giữ dữ liệu lịch sử/config có sẵn được kiểm tra bằng fixture cô lập có dữ liệu thật, không suy ra từ DB production đang rỗng.

## Kiểm chứng

Không thực hiện hành động Facebook thật. Executor giả lập, PGlite cô lập và smoke production kết thúc bằng `ROLLBACK`.

| Kiểm tra | Kết quả |
| --- | --- |
| `node scripts/facebook-random-run-revert-migration.cjs audit` trước apply | PASS: metadata 10 function, rollback migration và smoke quyền với `SET LOCAL ROLE anon` thật |
| `node scripts/facebook-random-run-revert-migration.cjs verify` sau apply | PASS: 10 function khớp, bốn helper/trigger không còn, history V389 được giữ, history V391 có một bản ghi; rollback SQL PASS |
| `node scripts/facebook-random-run-revert-smoke.cjs` | 10 checks PASS: áp V387 → V389, tạo config/lịch sử, áp V391, dữ liệu giữ nguyên, V387 tiếp tục plan/claim được |
| `node scripts/facebook-random-run-sql-smoke.cjs` | 61 checks PASS, hợp đồng SQL V387 |
| `node scripts/facebook-random-run-runtime-smoke.cjs` | 21 checks PASS, scheduler thật và executor giả lập |
| `node scripts/campaign-failure-cleanup-smoke-test.cjs` | PASS, giữ các case cleanup/retry/pause Desktop/Server có trước V389 |
| Hai typecheck `tsconfig.node.json`, `tsconfig.web.json` | PASS, 0 lỗi |
| `npm run build` | PASS, main/preload/renderer; cảnh báo bundler hiện có |
| `git diff --check` | PASS |

[API smoke](../migrations/snapshots/facebook-random-run-revert-v391/api-smoke.json): account projection HTTP 200 với limit 0; RPC sai credential bị chặn `400 / P0001 / automation_auth_invalid`; đọc trực tiếp lịch sử bị chặn `401 / 42501`. [Rollback SQL](../migrations/tests/migration_v391_revert_facebook_random_run_lifecycle_rollback.sql) xác nhận auth/tenant/CAS, snapshot, chặn client cũ, claim replay, ownership, tiến độ một lần và RLS; [receipt](../migrations/snapshots/facebook-random-run-revert-v391/rollback-smoke.json).

Smoke lifecycle V389 và snapshot V389 được giữ để tái hiện lịch sử, không thể dùng kết quả đó để khẳng định hành vi hiện tại đã được sửa. Chưa stress hai máy thật hoặc E2E Facebook; chưa phát hành bộ cài.

## Vận hành sau hoàn nguyên

V387 vẫn dùng menu bật/tắt và bảng lịch sử như trước. Muốn dừng tính năng thì tắt chế độ, chờ lượt hiện tại kết thúc; giữ cấu hình và lịch sử. Không giải phóng token mù hoặc tự phát lại thao tác chưa rõ kết quả.

Nếu muốn áp lại bất kỳ sửa đổi nào của V389, tạo task/migration mới từ live đã capture lại, kiểm tra patch phát sinh và checksum; không chạy lại file V389. Các script `audit/apply` V391 là công cụ triển khai một lần; chỉ dùng `verify` khi live vẫn ở checksum V391.
