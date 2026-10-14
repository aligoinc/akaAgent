# Facebook chạy ngẫu nhiên — sửa vòng đời đợt V389

**V389 từng được hoàn nguyên bởi [V391](FACEBOOK_RANDOM_RUN_REVERT_V391.md), sau đó đã khôi phục qua [V392](FACEBOOK_RANDOM_RUN_RESTORE_V392.md) lúc 16:44 ngày 14/10/2026 theo yêu cầu người dùng.** Logic V389 hiện hoạt động lại; audit bên dưới là lịch sử lần triển khai đầu. Review V392 vẫn tái hiện hai lỗi nêu ngay dưới đây. Không chạy lại script V389 để tránh ghi đè receipt lịch sử; dùng verify V392.

Đính chính sau review: cleanup có trước V389 retry không giới hạn số lần với lỗi tạm thời, nên mô tả “cleanup có giới hạn” trước đây không chính xác. Token/recovery cũ vẫn còn sau hoàn nguyên. Chưa có số liệu để kết luận lỗi ghi đè trạng thái hiếm; xem giới hạn hiện hành trong audit V391.

Review tiếp theo còn tái hiện được hai thiếu sót của chính V389: pause đến sau khi RPC cleanup đã bắt đầu vẫn có thể kết thúc ở trạng thái chờ xử lý; startup reset trước unit recovery có thể chốt đợt `completed` dù mới xử lý 1/3 đối tượng. Các smoke ghi dưới đây không bao phủ hai thứ tự thực thi này. Người dùng chọn hoàn nguyên V389 thay vì triển khai bản sửa tiếp.

Đã apply riêng V389 trên **akachat** (`cgjbsmqtfhqvttudyjzq`) lúc **15:51 ngày 14/10/2026**, history `20261014085101 / migration_v389_facebook_random_run_lifecycle`. **Không apply lại V387/V389.** Desktop đã typecheck và build local; chưa đóng gói hoặc phát hành. Không thực hiện hành động Facebook thật.

## Bốn lỗi đã sửa

| Tình huống | Hành vi sau sửa |
| --- | --- |
| Người dùng pause đúng lúc đợt vừa đủ chỉ tiêu | `finishRandomBudget` gọi cleanup token-CAS hiện có. Campaign đã pause hoặc thuộc owner mới không bị ghi đè. Yêu cầu pause local và note “Đang chờ tạm dừng” đến muộn đều thắng việc trả campaign về chờ xử lý. |
| DB đã settle nhưng đọc progress bị lỗi, ví dụ account bị xóa hoặc quyền bị thu hồi | Xóa lease RAM ngay khi DB xác nhận settle. Lỗi đọc progress dừng queue, chuyển parent token qua cleanup hiện có; không retry unit đã settle, không chạy policy lỗi target. Áp dụng cả khi settle nằm trong executor lẫn bước `finally`. |
| Máy thứ hai lập kế hoạch giữa lúc máy thứ nhất giải phóng claim và gửi `finish` | Chốt trạng thái đợt trong cùng transaction giải phóng ownership. `plan` không tự suy đoán đợt đang chạy là gián đoạn. `finish` đến muộn/retry trả lại kết quả đã chốt. |
| Tắt ngẫu nhiên rồi app crash/restart | Recovery hiện có chốt lịch sử kể cả cờ đã tắt, không chờ lần `plan` tiếp theo. Có quét đợt mồ côi từ trước V389 sau khi chứng minh runtime idle; không phát lại thao tác chưa rõ kết quả. |

Không thay đổi cấu hình, cách chọn campaign, số lượng/phút, policy action/quota hay UI. Progress/finish vẫn đọc được đợt đã đóng của ngày cũ; ưu tiên tìm trong ngày đang mở, chỉ tìm lịch sử đóng khi cần retry sau ranh giới ngày.

## Thay đổi DB và thứ tự khóa

- **Không thêm bảng/cột/index**, không thêm job, polling, process, SQL pool hoặc nguồn connection.
- Sửa **4 function hiện có** từ body live: RPC random-run, RPC cleanup, RPC recovery unit và helper recovery random.
- Thêm **4 function trong `private`**: finalizer, trigger function, reader kiểm tra pause bằng parent token, reader lấy đợt mồ côi theo staff/tổ chức.
- Thêm **1 trigger** `facebook_random_finalize_on_release` trên `auto_campaigns`: AFTER UPDATE OF status/runtime_claim_token/runtime_unit_token, chỉ chạy khi ownership đã hết và trước đó có parent/unit token.
- Giữ nguyên BEFORE trigger xóa claim và các guard claim/settle, retry, tenant, target, cutoff, account ownership. AFTER trigger thấy tuple sau BEFORE; nếu unit vẫn đang chạy thì chưa chốt. Khi pause đã xóa parent nhưng unit chưa settle, lần settle dùng unit/lastUnitToken để chốt đúng đợt.
- Cleanup/recovery giữ thứ tự staff → khóa serialization/input → campaign/account; khóa row lịch sử sau cùng. Orphan recovery chỉ thêm vào Desktop/all sau quy trình recovery hiện có, recheck scope và ownership dưới khóa trước khi chốt. Đợt đã chốt không bị sửa lần hai.
- Reader nội bộ có fixed search_path, scope theo token hoặc staff/org, revoke PUBLIC; không mở quyền SELECT/UPDATE trực tiếp lịch sử cho anon/authenticated. API public vẫn dùng credential và kiểm tra staff/tenant/account của V387.

Không đổi signature/return type/thuộc tính RPC public, không thêm `NOTIFY` reload schema. API đã được kiểm tra sau apply. Apply dùng linked Management API, ghi history trong cùng transaction và không dựng thêm DDL cho schema migration.

## Audit live và checksum

[Migration canonical](../migrations/migration_v389_facebook_random_run_lifecycle.sql) · [source live](../migrations/snapshots/facebook-random-run-v389/source.json) · [target audit](../migrations/snapshots/facebook-random-run-v389/target.json) · [receipt](../migrations/snapshots/facebook-random-run-v389/apply.json) · [sau apply](../migrations/snapshots/facebook-random-run-v389/after.json).

Đã capture đúng signature bằng `pg_get_functiondef()` trong task; đối chiếu V231/V268/V340/V361/V387 và giữ patch live, đặc biệt cleanup không phụ thuộc entitlement đang còn hiệu lực, identity/CAS, unit retry/ownership, timeout và guard lịch/ngày. Preflight fail-closed trên **10 function nguồn**, không lấy body migration cũ. Bốn body thay đổi, sáu body giữ nguyên. Audit 14 function sau sửa xác nhận owner, security mode, volatility, config/search_path/timeout và ACL của mọi function cũ không đổi.

| Signature thay đổi/thêm | MD5 nguồn | MD5 đích |
| --- | --- | --- |
| `aka_agent_cleanup_failed_campaign_runtime(bigint,bigint,bigint,text,uuid,uuid,bigint[],text,boolean,text,text)` | `c6c1947084ba01a0a8d3325651c79424` | `f506f8695e3e874642e3c845e103e42d` |
| `aka_agent_facebook_random_run(bigint,bigint,text,text,bigint,text,jsonb)` | `a16c93a8853fcd34420b5e0f00478542` | `d82e1fa2561ca34c2e365a41a58b8ca4` |
| `aka_agent_recover_campaign_runtime_unit_leases(bigint,text,text)` | `3bfcf3483700f6994858589334f2dc46` | `048ea7194cd77589ffeb1820353f500c` |
| `private.facebook_random_finalize_on_release()` | `Mới` | `fe9cfbe03cf37328f45dabfb1ddbb155` |
| `private.facebook_random_finalize_turn(bigint,bigint,uuid,uuid,boolean)` | `Mới` | `687fc3efe8378dd175f88f852bc47a51` |
| `private.facebook_random_orphan_turns(bigint,bigint)` | `Mới` | `ea0c365929e5731b4e6436bfc1c58883` |
| `private.facebook_random_pause_requested(bigint,bigint,uuid)` | `Mới` | `172635824af6f7a3a0cae242c0d1d978` |
| `private.facebook_random_unit_recover(bigint,bigint,uuid)` | `a8f8ca1343cb7c6936b5e5e93d1f660d` | `0aea61ae267927a82b4f3e921ba468cf` |

SHA256 canonical: `2fc3a5cf9d6e3154c71d107193cace596f0b0187171aed43cb318b2f855c4f36`.

## Kiểm chứng

| Kiểm tra | Kết quả |
| --- | --- |
| `node scripts/facebook-random-run-lifecycle-smoke.cjs` | **48 checks PASS**, PGlite chạy function/trigger thật; cleanup/recovery bằng role anon: pause cuối đợt/note đến muộn, release trước plan, replay/stale owner, stop+restart, orphan khi flag tắt, pause giữa unit, chuyển ngày/đọc lại đợt đóng, xóa account |
| `node scripts/facebook-random-run-runtime-smoke.cjs` | **21 checks PASS** với executor giả lập |
| `node scripts/campaign-failure-cleanup-smoke-test.cjs` | PASS, gồm progress lỗi ở executor và finalizer: settle đúng một lần, cleanup parent một lần, không policy target hoặc replay; giữ các kiểm thử cleanup/retry/pause Desktop/Server cũ |
| `node scripts/facebook-page-content-rotation-smoke-test.cjs` | PASS, gồm nhánh kết thúc random budget bằng cleanup |
| `node scripts/facebook-random-run-lifecycle-migration.cjs audit` trước apply | PASS, metadata/attributes và rollback live bằng **SET LOCAL ROLE anon** |
| `node scripts/facebook-random-run-lifecycle-migration.cjs verify` sau apply | PASS, 14 function khớp target, trigger enabled, quyền lịch sử giữ nguyên, một history, rollback smoke live PASS |
| Hai typecheck `tsconfig.node.json`, `tsconfig.web.json` | PASS, 0 lỗi |
| `npm run build` | PASS, main/preload/renderer; chỉ cảnh báo bundler đã có |
| `git diff --check` | PASS |

[Rollback SQL](../migrations/tests/migration_v389_facebook_random_run_lifecycle_rollback.sql) kiểm tra auth/tenant/CAS, chặn client cũ, token sai/replay, settle một lần, chốt đợt trước plan từ máy khác, pause và recovery khi flag tắt. Toàn bộ dữ liệu smoke được ROLLBACK. Sau apply: **0 account bật, 0 row lịch sử**, không kích hoạt tài khoản thật.

[API smoke](../migrations/snapshots/facebook-random-run-v389/api-smoke.json): projection account HTTP 200 với limit 0; RPC credential sai bị chặn bằng `automation_auth_invalid`; đọc trực tiếp lịch sử bị từ chối `42501`. [Advisors trước/sau](../migrations/snapshots/facebook-random-run-v389/security-advisors.json): không thêm/bớt cảnh báo; các cảnh báo có sẵn ngoài phạm vi được giữ nguyên.

Giới hạn: kiểm thử cạnh tranh dùng thứ tự lời gọi và token thực tế trong DB, chưa stress nhiều backend/two-device đồng thời. Không E2E với Facebook thật; không kiểm thử DOM hoặc phát hành bộ cài trong task này. UI không đổi ở bản sửa V389.

## Rollback vận hành

Tắt chế độ, chờ unit đang chạy kết thúc và ownership được giải phóng; giữ cấu hình/lịch sử. Không xóa row lịch sử, không phát lại thao tác chưa rõ kết quả. Không chạy lại `audit/apply` sau khi đã apply; dùng `verify` để kiểm tra.

Nếu cần hoàn nguyên function/trigger, phải capture live lại, kiểm tra checksum và mọi patch sau V389 trước khi dựng migration rollback. Source snapshot là tài liệu đối chiếu, không phải script để ghi đè mù. Chỉ hoàn nguyên khi mọi tài khoản đã tắt và không còn lease; việc bỏ finalizer có thể tái tạo lỗi đã sửa nên ưu tiên rollback ứng dụng nhưng giữ DB/historical state.
