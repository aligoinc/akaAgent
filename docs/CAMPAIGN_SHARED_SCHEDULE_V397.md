# Dùng chung kiểm tra lịch — V397

## Phạm vi

Gom logic lịch đã có, giữ nghiệp vụ và giao diện RPC. Đây là cải thiện bảo trì tiếp theo V396, không hoàn nguyên bản sửa ngày kết thúc của data trực tiếp.

- Desktop: `isWithinCampaignDispatchSchedule` dùng chung cho hàng đợi thường và ngẫu nhiên, kiểm tra lịch bắt đầu và giờ dừng. `isDataGroupCampaignHardEnded` tiếp tục dùng chung với lifecycle của Nhóm data; không đưa thao tác finalize vào hàm điều kiện.
- DB: planner ngẫu nhiên và `aka_agent_claim_campaign_runtime_checked` gọi `private.campaign_dispatch_schedule_allowed`. Helper chỉ tính từ tham số, không đọc/ghi bảng, không claim hay giữ khóa; `IMMUTABLE SECURITY INVOKER`, `search_path=pg_catalog`, không cấp EXECUTE cho PUBLIC.
- Giữ nguyên lọc quyền, staff/tenant/account/action, provisioning, quota, dữ liệu đến lịch, thứ tự khóa, claim/unit token, pause, recovery và lịch sử. 17 function hỗ trợ giữ nguyên checksum.
- Không thêm bảng/cột, nguồn connection/pool, request hay polling. Không sửa trạng thái/lịch/data khách hàng, không thực hiện hành động Facebook để thử.

App và DB vẫn là hai tầng kiểm tra. Việc gom loại bỏ bản điều kiện riêng cho ngẫu nhiên trong từng tầng; không chuyển toàn bộ việc chọn ứng viên về DB. Query lấy ứng viên vẫn lọc sơ bộ theo lịch như trước; claim v2 vẫn kiểm tra ranh giới ngày/giờ dừng trước và sau khi lấy khóa, bao gồm token retry.

## Tương thích app cũ

Tên, tham số, kiểu trả về, owner, SECURITY DEFINER/INVOKER, volatility, search_path/timeout và ACL của hai RPC hiện có giữ nguyên. Không yêu cầu app gọi helper mới.

Helper nhận `p_legacy_cutoff` để giữ hợp đồng đã tồn tại:

- `true` tại checked/legacy claim: giờ dừng NULL không chặn; đúng bằng giờ dừng vẫn qua phép so sánh này. Bọc ngoài bằng claim v2 vẫn áp dụng cutoff bao gồm thời điểm bằng và mốc 23:59 như trước.
- `false` tại planner: đến giờ dừng đã chặn, tối đa 23:59. Data trực tiếp không bị chặn bởi ngày kết thúc; Nhóm data bị chặn khi đến ngày kết thúc.

Không đổi quy tắc giờ dừng khi refactor. Tham số này chỉ nội bộ DB, không thêm lựa chọn trên app. Helper nhận `now()` của checked claim hoặc `clock_timestamp()` của planner để giữ nguồn thời gian hiện có.

App chưa update tiếp tục dùng RPC hiện có. Sau cập nhật mới dùng helper TypeScript. App còn lỗi lọc ngày kết thúc ở code local vẫn cần bản sửa Desktop; app chưa hỗ trợ ngẫu nhiên vẫn bị chặn nhận lượt thường khi tài khoản bật ngẫu nhiên (guard V387 đã có).

## Source live, checksum và migration

Project: **akachat / `cgjbsmqtfhqvttudyjzq`**. [Migration](../migrations/migration_v397_campaign_shared_schedule.sql) dựng từ `pg_get_functiondef()` live của đúng signature, kiểm tra checksum fail-closed trước khi thay body. Source khớp V387 checked claim và V396 planner, giữ toàn bộ patch V389/V392/V393 liên quan. Không dựng lại body từ migration lịch sử.

| Signature | Source MD5 | Target MD5 |
| --- | --- | --- |
| `public.aka_agent_claim_campaign_runtime_checked(bigint,bigint,bigint,text)` | `015ca302742b88e140913a978c0156b5` | `dc5d650ca0f8e63c00ce97c4606ef245` |
| `public.aka_agent_facebook_random_run(bigint,bigint,text,text,bigint,text,jsonb)` | `ece8bf67bdf300722e17b7d1cf6b99f4` | `2c7b2243ebe72dbd544a270dd56310fc` |
| `private.campaign_dispatch_schedule_allowed(timestamptz,text,timestamptz,time,timestamptz,boolean)` | Chưa tồn tại | `e5789c4bc40cd46f6dc0417097bd2723` |

Snapshot và biên nhận ở [campaign-shared-schedule-v397](../migrations/snapshots/campaign-shared-schedule-v397): source/target đầy đủ metadata, source comparison, diff hai body, support checksums, audit và smoke local. Rollback chỉ nhận đúng target checksums, khôi phục hai body rồi drop đúng helper, giữ history/config/data.

Không đổi metadata API public, không thêm NOTIFY reload chủ động hoặc DDL chuẩn bị migration schema. Event trigger `pgrst_ddl_watch` có sẵn vẫn có thể phát reload khi CREATE FUNCTION commit; không tắt trigger. Apply qua linked Management API, ghi migration history cùng transaction, kiểm tra API sau apply.

## Kiểm chứng

- `node scripts/campaign-shared-schedule-smoke.cjs`: SQL thực trong PGlite, 30 ca trước–sau với payload checked legacy, v2 thường và ngẫu nhiên; giữ kết quả và các field response. Hai ca đổi lịch/hết hạn sau plan bị chặn khi claim. Sáu ca hai hàng đợi, 18 ca đối chiếu TypeScript/SQL; scheduler → planner → claim → unit → settle → finish thật, chỉ executor Facebook giả, xác nhận log/tiến độ 1/1.
- `node scripts/campaign-shared-schedule-v397.cjs audit`: kiểm tra source và 17 support functions; dựng target trong transaction rollback, giữ đủ metadata/ACL. 1.440 tổ hợp lịch/nguồn/end/cutoff/legacy; 10 ca planner V396; bộ V393 kiểm tra auth/tenant, token retry, pause/recovery, tranh lượt, app cũ/mode tắt. Diễn tập rollback trước apply.
- Thử helper bằng SQL role `anon`, `authenticated`, `service_role` thật. Management API không được `SET ROLE aka_agent_chat_api`; với helper thuần không truy cập bảng, kiểm tra quyền USAGE schema + EXECUTE của Chat qua catalog thay vì tự cấp quyền đổi role. ACL Chat hiện có của RPC được giữ nguyên.
- Hồi quy `facebook-random-run-runtime-smoke.cjs` (30 checks), `facebook-random-run-boundaries-smoke.cjs`, `facebook-random-run-stop-reason-smoke.cjs` đều đạt.
- Hai typecheck và production build đạt. Không đóng gói hoặc phát hành Desktop.

## Triển khai

Đã apply trên **akachat** lúc **21:01:59 ngày 14/10/2026 Việt Nam**, history **`20261014140159 / migration_v397_campaign_shared_schedule`**. Không apply lại. Biên nhận tại `apply.json`; kiểm chứng sau apply tại `after.json` và `api-smoke.json`.

Sau apply, cả ba function khớp đầy đủ target metadata/checksum; 17 support functions không đổi. Ba bộ SQL rollback và diễn tập hoàn nguyên đều đạt, production vẫn giữ V397. Data API trả HTTP 200; hai RPC public giữ signature và trả đúng lỗi kiểm tra quyền/tham số với request không có quyền, không có lỗi schema cache.

Security advisors trả hai cảnh báo quyền EXECUTE của `anon`/`authenticated` trên RPC ngẫu nhiên SECURITY DEFINER. Các thuộc tính này đã có trong source live và được giữ nguyên để app tiếp tục gọi; RPC xác thực credential/staff/tenant bằng `auto_assert_automation_identity` trước mọi thao tác. Test không có credential bị từ chối và smoke tenant/role đạt. Helper mới là private/invoker, không có finding riêng. Không thay cơ chế xác thực hoặc thu hồi quyền API đang dùng chỉ để làm sạch cảnh báo tổng quát.

## Rollback

[rollback.sql](../migrations/snapshots/campaign-shared-schedule-v397/rollback.sql) trả về đúng hành vi V396, giữ bản sửa direct end date. Chỉ chạy khi rollback được yêu cầu; không apply lại V387 hoặc V396. Lệnh `verify` chỉ diễn tập trong transaction rollback, không commit hoàn nguyên production.
