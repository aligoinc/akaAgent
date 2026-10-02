# Audit v339 — Zalo campaign engagement

Ngày kiểm chứng: 02/10/2026. Phạm vi gồm **Đã xem, Đã phản hồi, Đã thả cảm xúc, Đã kết bạn**. **V339, Chat worker/runtime và WebApp/API đã triển khai production theo yêu cầu; đã bật enabled=true lúc 23:40 ngày 02/10/2026 theo yêu cầu tiếp theo, Desktop chưa phát hành.** [Audit triển khai hiện tại](ZALO_CAMPAIGN_ENGAGEMENT_DEPLOY_20261002.md) ghi checksum/ACL cuối, history và hậu kiểm. Các mục review/benchmark dưới đây là lịch sử trước triển khai, không phải hướng dẫn apply lại. Không gửi thử Zalo thật. Xem [hướng dẫn hành vi và vận hành](ZALO_CAMPAIGN_ENGAGEMENT.md).

## Nguồn live và migration

Áp dụng quy trình [safe-supabase-rpc-migration](../.agents/skills/safe-supabase-rpc-migration/SKILL.md). Project đã xác minh trong task: **akachat / cgjbsmqtfhqvttudyjzq**. Không query/mutate project legacy. Snapshot live gồm definition/owner/ACL/security/volatility/config/checksum và metadata cột tại [live-source.json](audits/zalo-engagement/live-source.json).

Canonical: [migration_v339_zalo_campaign_engagement.sql](../migrations/migration_v339_zalo_campaign_engagement.sql). V339 được chọn trước công việc v340 song song; không có bản timestamp trùng nội dung. Không bulk-push v328/v340 hoặc các migration khác.

SHA-256 của file migration đã kiểm chứng: `9dcd175d7f4c794c3f21430d9395b665d5cc06ffbde1e34b2f4974da40bae390`.

| Signature live dùng làm nguồn/guard | MD5 `pg_get_functiondef` |
| --- | --- |
| `public.auto_assert_automation_identity(bigint,bigint,text,text)` | `5a9a503db72b965eb644739f5f60905d` |
| `public.aka_agent_list_campaign_details_page(bigint,bigint,bigint,text,text,timestamptz,timestamptz,integer,integer,text,text,text)` | `9652783556c25109e6250375da031fa3` |

Preflight fail-closed kiểm tra đúng hai checksum, signature không tồn tại cũng fail. Sáu function mới hoặc bảng đích đã tồn tại sẽ fail để buộc audit, không tự reapply. Live v1 khác cách ORDER BY của nguồn lịch sử v316: bản live dùng khóa `created_at,id` NOT NULL và không thêm NULLS LAST; v2 giữ đúng body live/guard/sort/search limits, count cùng MVCC snapshot, materialized page IDs và chỉ tải full payload cho trang. Chỉ bổ sung filter/engagement/applicability. **Không sửa body/owner/ACL của v1 hoặc identity helper**.

Guard danh tính giữ active staff/tenant và credential; bypass service_role theo JWT như live. RPC engagement vẫn kiểm tra active owner/account, UID hiện tại, không phải browser, ownership campaign và deadline. Worker SQL không dựa vào JWT giả: lấy credential ngay trong SQL dưới kết nối nghiệp vụ hiện có. Inbox acknowledgement kiểm tra thêm binding generation/owner/UID.

Function mới, signature chính xác và target checksum/attributes từ private PostgreSQL nằm trong [local-target.json](audits/zalo-engagement/local-target.json). Đây là checksum **local target**, không phải xác nhận production đã apply:

| Function | Signature | Target MD5 |
| --- | --- | --- |
| Revision trigger | `public.aka_agent_campaign_engagement_revision()` | `cf7e83d7ec5562bbe4f6ec4d09abe4f6` |
| Internal batch | `public.aka_agent_campaign_engagement_batch(bigint,bigint,text,jsonb,text,text,text)` | `039a2d5928505e24e88a04b63c939f48` |
| Register | `public.aka_agent_register_campaign_engagement(bigint,bigint,text,jsonb,text,text)` | `0be97926b6629fd1f821726f2eca71c5` |
| Record | `public.aka_agent_record_campaign_engagement(bigint,bigint,text,jsonb,text,text)` | `c64228d384c787cce3da3417ccaeca53` |
| Read | `public.aka_agent_read_campaign_engagement(bigint,bigint,text,jsonb,text,text)` | `2546cd89f6ffe8118cd818dd12b467e5` |
| Detail page v2 | `public.aka_agent_list_campaign_details_page_v2(bigint,bigint,bigint,text,text,timestamptz,timestamptz,integer,integer,text,text,text,text)` | `7b7407f8102f56591435b9bc092c7b34` |

Target owner `postgres`; trigger security-invoker/volatile, không PUBLIC execute. Internal batch và ba wrapper security-definer/volatile, `search_path=pg_catalog, public`, timeout 15s. Internal batch không cấp execute PUBLIC/anon/authenticated/service_role. Ba wrapper cấp execute anon/authenticated/service_role nhưng guard credential/live ownership bắt buộc. V2 security-definer/stable, timeout 60s, cùng search_path và ACL đọc như v1. Bảng engagement RLS, revoke truy cập trực tiếp cho PUBLIC/anon/authenticated/service_role. Snapshot target lưu cả ACL, config, security và volatility để đối chiếu sau apply.

Có schema metadata mới (bảng/cột/signature), vì vậy migration có `NOTIFY pgrst, 'reload schema'`. Chỉ chạy khi được yêu cầu triển khai; cần kiểm tra API sau apply, không coi việc SQL commit là đủ.

## Kiểm chứng chức năng local

| Kiểm chứng | Kết quả |
| --- | --- |
| Main `tsconfig.node.json` và `tsconfig.web.json` | PASS |
| Main production build và legacy Server build | PASS |
| Chat typecheck/build | PASS |
| Chat toàn bộ suite, một worker | **93 file / 1.410 test PASS** |
| Chat integration mới trên PGlite với canonical SQL, không JWT | **5 test PASS**, chạy lại sau guard ownership cuối |
| Web typecheck/build | PASS |
| Web toàn bộ suite | Lượt cuối **1.544 PASS / 1 fail** do test render-count cũ dao động; chạy riêng lại toàn bộ file **104/104 PASS**. Lượt full trước đó 1.545 PASS. Không sửa/nới test để che lỗi. |
| Desktop Electron UI, mạng HTTP bị chặn | PASS, 1.600/850 px, cả bốn dấu, phân loại/filter, xuất đủ 200 dòng lọc |
| Web Playwright Desktop Chromium/Android Chromium/iPhone WebKit | **3 PASS**, 1.440/850/390 px, bốn dấu/filter, xuất đủ 996 dòng lọc |
| Private PostgreSQL 16 SQL assertions | PASS, transaction ROLLBACK, đổi role SQL thật anon/service_role |
| Hai transaction đồng thời riêng trong private PostgreSQL | PASS, cả hai thứ tự source/inbox commit, soft-delete replay |

Smoke scripts main:

- `node scripts/zalo-campaign-engagement-smoke-test.cjs`: config single-flight/fail-closed, ID text/media/Share, seen khác delivered, self/group/reaction removal, positive LRU/unknown, deadline theo dòng, early hold, timestamp retry, không idle write.
- `node scripts/zalo-campaign-engagement-lifecycle-smoke.cjs`: restart replay, timestamp ổn định, tắt/bật/revision kể cả cùng millisecond, auth đổi khi config đang chờ, Server password rotation, không credential trong journal, restore quá 10.000 mục có overflow/cap.
- `node scripts/campaign-details-page-smoke.cjs`: actual repository v2 args/filter/paging/enrichment/empty count/error.
- `node scripts/zalo-rich-share-smoke-test.cjs`: Local/Server friend/group Share, 50 target, text/media/partial, không đổi đường gửi.
- `node scripts/zalo-message-opt-out-smoke-test.cjs`: opt-out/content/status hiện có được giữ.
- `node scripts/run-campaign-engagement-ui-smoke.cjs`: component Desktop thực với IPC fixture và capture Excel.
- `node scripts/run-zalo-engagement-sql-smoke.cjs`: khởi tạo cluster riêng Unix socket rồi dừng/xóa bằng finally, không tải production.

SQL assertions kiểm tra 48→72→24 giờ, retry không gia hạn, multi-campaign response fanout, exact ID reaction/seen, first timestamp, biên deadline, sự kiện lịch sử xử lý muộn, source Chat không có FK legacy, registration đối chiếu inbox sớm, tenant/account/campaign ownership, soft delete, revision cũ, filter/count trước page, status/counts_toward_limit không đổi.

Chat executor tests khẳng định chuỗi command gửi Zalo hiện có không tăng: capture kết quả sẵn có, Share response đảo thứ tự vẫn khớp người nhận, partial gửi không có source. Integration dùng pipeline stage/ack/worker thực, gồm early message/seen, stale generation, off/on và RPC lỗi rồi retry. Không gọi mạng Zalo thật. Shared contract ở ba repo có nội dung byte-identical.

Test Web dao động: `CampaignFormPage.test.tsx > cập nhật tiến độ theo chunk mà không render lại form`, nhận 39 auth reads thay vì 38 ở lượt toàn suite. Chạy `npx vitest run src/test/CampaignFormPage.test.tsx --maxWorkers=1 --minWorkers=1` tại apps/web: 104/104 PASS. File form/test này không thay đổi trong task; chưa kết luận nguyên nhân chỉ từ lần rerun. [Verification manifest](audits/zalo-engagement/verification.json) lưu kết quả cuối và phạm vi kiểm chứng.

## Đo tải

Lệnh: `ENGAGEMENT_BENCH_SECONDS=10 node scripts/run-zalo-engagement-sql-smoke.cjs --benchmark`.

Kết quả gốc: [grid benchmark](audits/zalo-engagement/benchmark.json), [pipeline/baseline benchmark](audits/zalo-engagement/pipeline-benchmark.json). Mỗi case grid chạy producer 10 giây rồi đo drain; không phải soak test nhiều giờ. Matrix: 100.000/1.000.000 lượt, 1.000/5.000 account, 100/500/2.000 sự kiện/giây, 1%/10%/100% liên quan; thêm người nhận nóng 10.000 lượt phù hợp, cache chỉ 100 dòng, duplicate và reconnect burst 5.000 sự kiện.

Grid thực thi RPC+LRU trên private PostgreSQL. Các số pipeline trong bảng bên dưới là lượt trước sửa review; số đo mới nằm ở mục sửa review cuối tài liệu. Pipeline chạy coordinator Desktop với atomic file journal; adapter giả transport HTTP dùng cùng PG connection. Chat so baseline inbox acknowledgement và inbox+engagement (stage, durable claim, read/record/ack) qua Kysely; giữ **một connection** cho mỗi phép đo. Đo RSS process, DB backend CPU, backlog/age/drain, RPC latency, update latency và pool wait của adapter.

Không tăng connection/pool/process/replica của ứng dụng. Private test cluster `max_connections=10` chỉ là giới hạn môi trường thử; race smoke tạm dùng hai connection, đóng trước benchmark. Benchmark không dùng production và không gửi Zalo. Pool wait local không đại diện pooler production. Baseline Chat đo acknowledgement, không gồm toàn bộ projection/conversation/notification/UI hoặc lưu lượng mạng thật.

Kết quả cuối lúc 12:57:40 UTC, 02/10/2026, với SQL có seen và guard campaign ownership:

| Case — 1 triệu lượt / 5.000 account | p95 xử lý/ghi dấu | Backlog lớn nhất | CPU DB | Thời gian producer + drain |
| --- | ---: | ---: | ---: | ---: |
| Grid 500 sự kiện/s, 10% liên quan | 237,62 ms | 100 | 2.250 ms | 10,05 s |
| Desktop coordinator + journal, cùng mức tải | 235,33 ms | 130 | 1.870 ms | 15,06 s |
| Chat inbox + engagement, cùng mức tải | 249,53 ms | 101 | 4.190 ms | 14,88 s |
| Grid 2.000 sự kiện/s, 100% liên quan | 1.470,14 ms | 2.644 | 11.030 ms | 11,52 s |
| Grid 500/s, 10% liên quan, người nhận nóng 10.000 lượt | 8.510,26 ms | 2.400 | 18.340 ms | 18,72 s |
| Grid 500/s, 10% liên quan, cache chỉ 100 dòng | 240,79 ms | 100 | 2.500 ms | 10,05 s |
| Reconnect burst 5.000 sự kiện, 10% liên quan | 1.694,73 ms | 4.900 | 1.720 ms | 1,77 s |

Các case đều drain về 0; Desktop không overflow/retry/journal error. Lô cuối dưới ngưỡng chờ timer 5 giây giải thích thời gian tổng khoảng 15 giây dù producer 10 giây; không đồng nghĩa p95 chậm 5 giây. `metrics.backlog` Chat là mẫu 60 giây nên có thể còn giá trị cũ; cột `remaining=0` được query sau drain mới là kết quả cuối.

Chat baseline acknowledgement: p95 2,08 ms, CPU DB 1.900 ms. Với engagement: p95 acknowledgement 0,98 ms, pool wait p95 0,46 ms, CPU DB 4.190 ms. Phép đo ngắn có warm-cache/noise và thứ tự baseline→feature; **không suy ra engagement làm Chat nhanh hơn**. Nó tăng công việc DB; cần đo staging lặp lại và toàn bộ projection Chat. RSS harness 134–209 MiB ở pipeline, không phải footprint của toàn runtime hàng nghìn SDK session.

Mục tiêu local 500/s, 10% liên quan, phân bố đều đạt p95 ≤10 giây và backlog không tăng liên tục. Hai stress case người nhận nóng và 2.000/s–100% liên quan **không đạt throughput bền vững**: mất nhiều hơn thời gian producer để xử lý, backlog tăng. Không bật rộng cho các phân bố này chỉ dựa vào một giá trị p95 dưới 10 giây. Cần giữ `enabled=false`, đo staging đại diện lâu hơn và quyết định xử lý giới hạn nóng trước rollout.

EXPLAIN ANALYZE/BUFFERS của phép thu hẹp theo tenant/account/UID/người nhận ở [100k](audits/zalo-engagement/plan-100000.json) và [1m](audits/zalo-engagement/plan-1000000.json) dùng `auto_campaign_engagement_target`; không quét lịch sử hội thoại. Đây là plan lookup đại diện, không phải chứng minh mọi nhánh RPC không bao giờ cần sort. Race smoke xác nhận advisory lock và hai thứ tự commit; benchmark một connection không đo được cạnh tranh lock/pool production, là gate staging còn lại.

## Gate triển khai

1. Có yêu cầu triển khai rõ ràng. Đọc lại linked ref, live source checksums, target chưa tồn tại; drift thì audit lại.
2. Apply riêng v339 bằng role quản trị được phép, giữ bốn seed với enabled=false. Ghi migration history đúng quy ước; không apply migration khác đang chờ.
3. Đối chiếu target với `local-target.json`: signature/MD5/owner/secdef/volatility/config/ACL. Kiểm chứng RLS, real roles, deadline/revision/ownership bằng rollback smoke và PostgREST schema API sau reload.
4. Deploy Chat runtime/worker, Server rồi Desktop/Web. Client v2 cần schema trước; v1 tiếp tục hoạt động.
5. Kiểm tra metric và tải staging, đặc biệt account/người nhận nóng và ảnh hưởng Chat. Chỉ bật sau khi chấp nhận giới hạn thực đo. Công tắc tắt không xóa dữ liệu lịch sử và không tăng connection để bù backlog.

## Sửa lỗi phát hiện khi review — 02/10/2026

Đọc lại đúng linked production, lưu definition/checksum/owner/ACL/security/config ở [fix-live-source.json](audits/zalo-engagement/fix-live-source.json). Hai source signatures/checksums vẫn đúng bảng đầu tài liệu; các function engagement mới chưa tồn tại live. Chỉ sửa canonical v339 chưa apply; giữ nguyên live v1, helper và các guard. Target internal batch của lượt sửa đầu `ebfb381a7caa533555e5fdbf99f1a921` (lượt sửa tiếp theo bên dưới thay checksum này); wrapper signatures/ACL không đổi. Không thay đổi production.

- Desktop/Server: recovery RPC trả cursor và ID cuối cố định, mỗi trang tối đa 500. Chỉ tiến cursor sau khi giữ cả trang, giữ hold ngoài trang hoặc khi lỗi/overflow; chuyển hold sang register dùng lại slot. Journal giữ `waiting_config` qua lỗi setting/restart, timestamp nhận đầu tiên và revision cũ. Unknown revision đối chiếu thời điểm nhận, giữ độ chính xác microsecond khi loại backlog qua toggle.
- Chat: stage không wake trước commit; acknowledgement thành công mới wake. Phiên bản wake giữ thông báo trong lúc worker đang chạy; deadline tính từ mục commit đầu tiên, không cộng lại cả interval sau tick dài.
- Chat: `waiting_config` ghi cùng acknowledgement, vẫn hoàn tất projection. Query cleanup cũ được mở rộng để giải quyết cấu hình theo lô và xác minh lại generation/UID/owner; dùng cùng recipient advisory lock với registration. RPC registration không đối chiếu metadata còn chờ config. Index pending bao gồm hai trạng thái chờ, không thêm query vào đường lô bình thường, connection/pool/process/replica.

Regression lưu trong lifecycle smoke, Chat integration và SQL/race smoke. Các tình huống gồm 701 nguồn, trang phục hồi lỗi, full queue, setting lỗi lần đầu/đã có cache, restart, seen timestamp, toggle cùng millisecond, thay owner/generation, post-commit wake, wake lúc đang chạy và tick vượt deadline. PostgreSQL riêng kiểm tra cả hai thứ tự commit của registration với acknowledgement và với config promotion; SQL kết thúc ROLLBACK.

Toàn bộ Chat suite trước phần gia cố khóa/deadline cuối: **93 file / 1.418 test PASS**. Sau phần gia cố chạy lại integration + worker + executor: **3 file / 234 test PASS**, trong đó integration engagement **14 test PASS**. Hai typecheck Desktop, Desktop/Server production build, Chat typecheck/build, toàn bộ Web typecheck và control-api build/test PASS. Web control-api: **4 file / 15 test PASS**; lượt đầu dùng sai tổ hợp max/min worker không chạy được test, đã chạy lại với min=max=1. Không sửa UI ở lượt fix này.

Kiểm chứng có thể chạy lại bằng `node scripts/run-zalo-engagement-sql-smoke.cjs --pipeline-only` sau khi build Chat. Mode này seed private PostgreSQL rồi chạy pipeline 500/s, 10% liên quan, 5.000 account/1 triệu lượt; không chạy lại grid stress và không ghi đè kết quả grid cũ. Không gửi Zalo hoặc dùng DB production.

Kết quả pipeline lịch sử của lượt fix đầu, 2026-10-02T13:44:32.560Z (file pipeline hiện lưu lần đo mới nhất ở mục dưới):

| Pipeline | p95 ghi dấu | Backlog lớn nhất | Còn sau drain | CPU DB |
| --- | ---: | ---: | ---: | ---: |
| desktop-coordinator-and-atomic-journal | 223.78 ms | 141 | 0 | 2050 ms |
| chat-inbox-acknowledgement-baseline | Không engagement | 0 | 0 | 2060 ms |
| chat-inbox-with-engagement | 198.48 ms | 89 | 0 | 4210 ms |

Cả Desktop và Chat drain về 0; p95 ghi dấu dưới 10 giây ở phân bố này. Chỉ là phép đo local ngắn trên một connection, không suy ra capacity production hoặc trường hợp người nhận nóng. Lô cuối dưới ngưỡng chờ tối đa interval hiện có; metrics Chat lấy mẫu 60 giây có thể chưa về 0, cột `remaining` mới là số dư cuối. Giữ rollout off và các gate staging đã nêu. Các kiểm chứng cuối được lưu ở [fix-verification.json](audits/zalo-engagement/fix-verification.json).


## Sửa lỗi review lần hai — 02/10/2026

Đã đọc lại live definition/attributes/checksum đúng linked project trước khi sửa SQL, lưu [fix2-live-source.json](audits/zalo-engagement/fix2-live-source.json). Hai checksum nguồn vẫn khớp bảng đầu; target engagement chưa tồn tại live. Chỉ sửa canonical v339 chưa apply. Target cuối `public.aka_agent_campaign_engagement_batch(bigint,bigint,text,jsonb,text,text,text)` có MD5 `039a2d5928505e24e88a04b63c939f48`. Signature/ACL/timeout của read wrapper giữ nguyên; không thay live v1 hoặc identity helper. Không thay production.

Ba sửa đổi chính:

- Hold dùng operationId trong khóa, vì hai thao tác nhắn tin/kết bạn cùng người nhận không được gộp. Stage thành công giữ source tối thiểu trước INSERT detail; xác nhận SQL rollback thì giải phóng operation, mất response/timeout/SQLSTATE 40003 vẫn giữ journal. Không retry gửi Zalo hoặc INSERT detail/quota từ đường engagement.
- RPC read có nhánh lookup operation theo lô, scoped campaign/account/tenant và kiểm tra UID/revision/recipient. Expression index mới `auto_campaign_engagement_operation` phục vụ tìm đúng operation, kể cả pending marker đã được tiêu thụ. `missing` vẫn là chưa rõ commit, không xóa recovery; `invalid` dừng theo dõi operation không còn hợp lệ. Không thêm bảng hoặc connection.
- Event được xử lý ngay cho watch cũ, rồi chỉ giữ metadata đối chiếu với từng operation đang chờ. Đăng ký xong một operation cho phép replay cùng timestamp; một operation mơ hồ không chặn cả người nhận. Chat claim rỗng phân biệt hết việc với việc đang chờ lease/retry, tự hẹn lại sau restart qua một timer. Event mới có thể kéo lịch sớm hơn. Query hạn tiếp theo nằm trong request claim hiện có, chỉ chạy nhánh rỗng và dùng tập pending; sàn 1 giây tránh lặp quá dày khi row bị khóa, tối đa 60 giây.

Kiểm chứng cuối: hai typecheck Desktop, build Desktop/legacy Server, Chat build/typecheck, core/repository/lifecycle smoke, opt-out/Share smoke đều PASS. Full Chat: **93 file / 1.422 test PASS**; sau gia cố sàn wake chạy lại integration **17/17 PASS**. SQL rollback trên role thật kiểm tra found/missing/invalid/tenant/UID/soft-delete, retry, status/quota và các regression cũ. Race trên hai transaction thật PASS cả hai thứ tự commit. Không thay Web/UI/shared contract ở lượt này; ba bản shared vẫn byte-identical, kết quả Web trước đó được giữ riêng.

[Plan lookup operation](audits/zalo-engagement/operation-lookup-plan.json): bảng **1.010.000 detail**, trong đó 1.000 source có operation metadata; query dùng `auto_campaign_engagement_operation`, không ép tắt sequential scan. Batch RPC 500 operation khớp đủ 500 kết quả trong **15.85 ms** trên DB local cô lập. Đây là phép đo phạm vi lookup, không phải tải production.

Pipeline lịch sử lượt fix hai **2026-10-02T14:11:03.800Z**, 5.000 account/1 triệu watch, producer 500 sự kiện/s với 10% liên quan, [dữ liệu](audits/zalo-engagement/pipeline-benchmark.json):

| Pipeline | p95 ghi dấu | Backlog lớn nhất | Còn sau drain | CPU DB |
| --- | ---: | ---: | ---: | ---: |
| desktop-coordinator-and-atomic-journal | 242.37 ms | 137 | 0 | 2030 ms |
| chat-inbox-acknowledgement-baseline | Không engagement | 0 | 0 | 1810 ms |
| chat-inbox-with-engagement | 200.84 ms | 100 | 0 | 4360 ms |

Phép đo dùng một connection trong cluster thử nghiệm, không thêm connection/pool/process/replica cho ứng dụng. Không gửi Zalo thật. Giữ enabled=false và các gate staging/giới hạn stress đã nêu; không diễn giải phép đo ngắn này thành bảo đảm capacity production. [Manifest kiểm chứng lần hai](audits/zalo-engagement/fix2-verification.json) gắn đúng checksum migration và lần đo cuối.


## Sửa hai lỗi review lần ba — 02/10/2026

Phạm vi chốt: ngăn backlog Chat qua lần tắt/bật và khôi phục journal Desktop/legacy Server khi không có traffic mới. Không thay migration/RPC/schema/UI/shared contract; SHA-256 v339 vẫn `9dcd175d7f4c794c3f21430d9395b665d5cc06ffbde1e34b2f4974da40bae390`, target signatures/checksum/ACL không đổi. Không query/mutate production trong lượt fix này, không deploy, không gửi Zalo thật và không tăng connection/pool/process/replica.

- **Chat:** acknowledgement và promotion `waiting_config` dùng `occurred_at` của runtime envelope. `accountSupervisor` chuyển event hiện có sang `runtimeBridge.publishEvent`, nơi chốt thời điểm tiếp nhận; raw inbox lưu nguyên thời điểm này, normalizer chép sang mọi child. `created_at` vẫn giữ nghĩa tạo row cho pipeline/retention cũ. Thời gian nguồn nằm riêng ở `engagement_occurred_at`, không được dùng làm revision fence. So sánh DB trực tiếp giữ microsecond và không thêm roundtrip.
- **Desktop/Server:** login/auto-login thành công và đổi mật khẩu gọi resume; Server attach tạo scope bằng owner tường minh. Nạp journal và phục hồi chạy nền qua timer/writer chung. Scope tồn tại trước lần đọc credential Server nên lỗi auth/config ban đầu có lịch retry dù không có event mới. Hết việc/tắt thì dừng, không thêm poller. Owner identity chặn logout/detach/replacement; detach cũ và request hoàn tất muộn không được xóa credential hay ghi đè journal thay thế.

Regression Chat chạy normalizer thật: receipt child, history child, promoted raw và waiting_config qua restart. Child được tạo sau toggle vẫn không đổi epoch của raw cũ. Case dương giữ tin lịch sử mới nhận sau toggle với timestamp nguồn cũ hợp lệ. Thêm hai case reception trước revision một microsecond (trực tiếp/deferred), tổng integration **24 test**.

Regression Desktop/Server chạy coordinator/file journal thật với đồng hồ và transport fixture: restart không traffic, phục hồi nguồn 701 detail không cần event đánh thức, config/auth lỗi ban đầu rồi tự hồi phục, idle/disabled không polling, logout trong config read, detach trong credential read, thay owner khi request cũ đang chạy, nhiều owner với context Desktop khác và credential rotation. Auth smoke xác nhận chỉ phiên đăng nhập đã được chấp nhận mới resume, cùng thay password; không thay trạng thái gửi/quota/automation.

Kết quả kiểm chứng cuối và số đo pipeline của lượt này được ghi trong [fix3-verification.json](audits/zalo-engagement/fix3-verification.json). Benchmark tiếp tục dùng PostgreSQL riêng, một connection cho phép đo pipeline, không đại diện tải production. Các gate staging và giới hạn người nhận nóng ở trên vẫn giữ nguyên.

Pipeline local sau sửa, **2026-10-02T14:34:15.902Z**, 5.000 account / 1.000.000 watch, 500 sự kiện/s và 10% liên quan:

| Pipeline | p95 ghi dấu | Backlog lớn nhất | Còn sau drain | CPU DB |
| --- | ---: | ---: | ---: | ---: |
| desktop-coordinator-and-atomic-journal | 272.37 ms | 181 | 0 | 1850 ms |
| chat-inbox-acknowledgement-baseline | Không engagement | 0 | 0 | 780 ms |
| chat-inbox-with-engagement | 195.58 ms | 95 | 0 | 4520 ms |

Cả hai pipeline drain về 0, không retry/overflow. Chat acknowledgement p95 tăng từ 0,46 ms (baseline) lên 1,43 ms, pool wait p95 0,77 ms trong adapter một connection. Đây là phép đo local ngắn, không thay thế benchmark staging với cạnh tranh pool/projection và phân bố người nhận nóng.

Kiểm chứng cuối lượt fix ba: full Chat **93 file / 1.429 test PASS**, integration riêng **24/24 PASS**, auth Desktop **133 checks PASS**, account cleanup **41 checks PASS**; hai typecheck, build Desktop/Server/Chat, core/lifecycle/opt-out/Share smoke, SQL rollback và race đều PASS. Không thay Web/UI trong lượt này; shared contract ba repo byte-identical.

## Sửa lỗi review lần bốn — 02/10/2026

Chỉ sửa cách tính lịch retry của coordinator Desktop/legacy Server: lọc scope còn `active()` trước khi tính pending, số mục đến hạn, ngưỡng đủ lô và deadline. Backlog của tài khoản đã đăng xuất vẫn được giữ để phục hồi khi đăng nhập lại nhưng không tác động timer của tài khoản hiện tại.

Regression trước sửa tái hiện với một mục của owner cũ: retry owner mới còn 4.000 ms nhưng timer được hẹn sau 1 ms. Sau sửa, lifecycle smoke kiểm tra cả 1 và 100 mục tồn: giữ đúng deadline, không chạy tick rỗng mỗi 1 ms, chỉ gọi RPC theo owner đang đăng nhập, journal owner cũ không đổi, timer dừng khi owner hiện tại hết việc và journal cũ xử lý lại khi owner đó đăng nhập.

Core/lifecycle smoke, hai typecheck và build Desktop/legacy Server PASS. Chi tiết ở [fix4-verification.json](audits/zalo-engagement/fix4-verification.json). Không sửa Chat/Web, migration/RPC hoặc cấu hình connection; không chạy lại benchmark/SQL smoke vì các đường đó không đổi. Số đo trước thuộc các lượt kiểm chứng lịch sử ở trên. Không query/mutate production, deploy hoặc gửi Zalo thật trong lượt fix này; các gate rollout giữ nguyên.


## Ưu tiên best effort, bỏ điểm chờ của campaign — 02/10/2026

Người dùng chốt: dấu tương tác không quan trọng bằng chiến dịch; mất dấu được chấp nhận. Lượt sửa này bỏ các điểm chờ engagement khỏi luồng gửi/detail/admission, thay cho bảo đảm journal phải lưu xong trước INSERT ở các mục lịch sử phía trên. Không thay migration/RPC/schema, không query hay thay production, không tăng connection/pool/process/replica.

- Config có API đọc cache đồng bộ và làm mới nền, dùng chung pending request. Khi chưa có cache còn hạn, thao tác gửi bỏ metadata theo dõi mới. Đọc config bị kẹt không làm gửi chờ 5–40 giây.
- Desktop/Server giữ hold/source/registration trong RAM và ghi file nền. Restore và writer vẫn có thứ tự, nhưng không được giữ send, INSERT detail, counter hoặc attach owner. Producer không tích lũy waiter khi đĩa kẹt. Server replacement tái sử dụng scope/writer, fence RPC bằng generation; callback cũ không được tiêu thụ mục mới.
- Listener bổ sung cho lời mời/Share cá nhân chạy nền, một attempt/SDK instance, lỗi có cooldown 60 giây; bỏ chờ 20 giây trước mỗi lượt. Không đổi những lần chờ phục vụ upload/media sẵn có.
- Chat executor đọc revision từ cache đồng bộ. Stage ACK không chờ cấu hình; ACK dùng try-lock, khóa tương tác bận thì bỏ metadata và vẫn đánh dấu projection hoàn tất trong request hiện có. Background registration/promotion giữ cơ chế đối chiếu khi metadata đã được lưu.

Kiểm chứng: fixture mới giữ journal restore/write/config ở trạng thái chưa resolve và xác nhận gửi, INSERT detail, quota và Server attach vẫn kết thúc. File bị từ chối, tắt tính năng, listener timeout/cooldown, kết quả file/config đến muộn đều không gửi lại. Postgres cô lập giữ advisory lock trên connection A; ACK thật qua repository trên B hoàn tất trước khi A nhả khóa, bỏ metadata; event tiếp theo ghi lại bình thường. Rollback SQL, tenant/role/idempotency/pagination và hai thứ tự commit metadata/config promotion tiếp tục PASS.

Hai typecheck Desktop và build Desktop/legacy Server PASS; Chat build PASS, full suite **93 file / 1.430 test PASS**, trong đó focused engagement/executor **193 test**. Core/repository/lifecycle, Share, opt-out và auth lifecycle (**133 checks**) PASS. Bản shared của ba repo byte-identical; Web control-api build PASS. Diff check ba repo PASS. Không sửa UI ở lượt này nên không lặp test giao diện; benchmark trước đó là số đo lịch sử, không chạy lại và không khẳng định capacity production từ kết quả này. Background vẫn dùng CPU/DB, cần giữ giới hạn và enabled=false trong rollout.

[Manifest kiểm chứng best effort](audits/zalo-engagement/best-effort-verification.json). Nguyên tắc được lưu trong AGENTS của akaAgent và akaAgentChatApi, cùng tài liệu hành vi chính.


## Lọc account/người nhận bằng RAM trước Supabase — 02/10/2026

Người dùng xác nhận cần giảm **tải Supabase** của tài khoản không có lượt campaign liên quan, chấp nhận mất dấu. Sự kiện mới bị loại trước config refresh/journal/inbox engagement khi account, UID hoặc target không có metadata dương trong RAM. Cache lạnh/eviction không được gọi RPC để hỏi theo sự kiện. Desktop giữ hold/recover đúng account cho thao tác gửi đã bắt đầu; Chat chỉ stage sau khi biết watch. Các mục queue/inbox cũ đã được lưu vẫn phục hồi bằng consumer hiện có. ACK Chat khi bỏ engagement giữ câu UPDATE cơ bản, không thêm metadata hoặc advisory lock và không wake consumer.

Cache được nạp theo trang 500 dòng lúc vào phiên/khởi động và khi writer thấy revision mới, cập nhật từ kết quả registration. Nạp dùng writer/pool hiện có, theo nhịp gom, dừng tại giới hạn 100.000 dòng hoặc 64 MiB metadata ước lượng; không quét lại do từng cache miss. Không đợi warm-up trong luồng gửi. Cold cache/process khác vừa đăng ký chưa có metadata có thể miss; không bổ sung periodic scan hay connection để bù.

**Audit RPC trước sửa:** project linked `cgjbsmqtfhqvttudyjzq`; [source live](audits/zalo-engagement/admission-live-source.json) chụp `pg_get_functiondef`, owner, ACL, security, volatility và config. Live identity `public.auto_assert_automation_identity(bigint,bigint,text,text)` có MD5 `5a9a503db72b965eb644739f5f60905d`; live detail v1 `public.aka_agent_list_campaign_details_page(bigint,bigint,bigint,text,text,timestamptz,timestamptz,integer,integer,text,text,text)` có MD5 `9652783556c25109e6250375da031fa3`, vẫn khớp preflight. Hai helper engagement đang sửa chưa tồn tại live. Chỉ chỉnh canonical v339 chưa apply, không tạo migration trùng hay ghi đè function đang chạy. Giữ nguyên guard, owner, ACL, timeout và mọi nhánh registration/event/operation/deferred trước đó.

`public.aka_agent_campaign_engagement_batch(bigint,bigint,text,jsonb,text,text,text)` thêm read `catalog`, target MD5 **`0bdce96014857158991a7c0ce78e81ca`**. Wrapper `public.aka_agent_read_campaign_engagement(bigint,bigint,text,jsonb,text,text)` giữ body/signature/ACL, MD5 `2546cd89f6ffe8118cd818dd12b467e5`. Thêm index `auto_campaign_engagement_catalog(organization_id,staff_id,tracking_until,campaign_detail_id)`. SHA-256 canonical hiện tại **`049db73bee27c31b8cff26c1d26676d2704d0316d52a11f6b188b6594c186dd6`**; source preflight vẫn fail-closed nếu target đã có hoặc source drift. Chưa apply/deploy production; enabled mặc định false. Rollout DB trước consumer như hướng dẫn, không bulk-push migration khác.

Kiểm chứng local:

- Desktop: 30.000 sự kiện cold/unrelated tạo **0 config read, 0 RPC, 0 journal write**. Sau đó tin liên quan vẫn ghi dấu; core, lifecycle, ambiguous commit/retry/ownership và fixture chặn config/file/listener tiếp tục PASS.
- Chat: 10.000 sự kiện account không watch và 10.000 sender không liên quan được loại trong RAM; không query engagement/config, không wake. ACK vẫn chạy đúng một UPDATE cơ bản. Test warm sau restart, 551 dòng qua hai trang, UID/nhóm/tự gửi/ID sai và tin liên quan PASS. Full suite **93 file / 1.434 test PASS**; kiểm tra cuối focused **197 test PASS**. Fixture lịch sử nạp metadata dương rõ ràng; deferred cũ được seed như dữ liệu từ phiên bản trước. Case source-time sau toggle đợi config có sẵn để không nhầm với cold-drop đã được chấp nhận.
- SQL rollback role `anon` thật: phân trang 500/51, tenant/credential/UID guard PASS; các regression status/quota, deadline, idempotency và phân trang detail PASS. Hai transaction thật xác nhận try-lock không giữ projection, metadata/config promotion vẫn đúng hai thứ tự commit.
- [EXPLAIN catalog](audits/zalo-engagement/catalog-plan.json) với 20.000 watch hết hạn dùng index mới, không ép tắt seq scan; query lấy trang 500 dòng trong 1,762 ms trên cluster cô lập. Đây là kiểm chứng access path, không phải công bố capacity production.
- Hai typecheck Desktop, build Desktop/Server, Chat build, Web control-api build và diff check ba repo PASS; shared contract byte-identical. UI không thay đổi. Benchmark pipeline cũ là số đo lịch sử; script đã có startup hook và báo số dòng thực ghi để cache miss không tạo kết quả p95 gây hiểu nhầm, nhưng chưa chạy lại bộ benchmark tải trong lượt này.

[Manifest kiểm chứng](audits/zalo-engagement/admission-verification.json). Không tăng connection/pool/process/replica, không gửi Zalo thật, không sửa production. Nạp metadata nền/đăng ký mới/queue cũ vẫn có tải DB; kết quả 0 áp dụng cho công việc engagement phát sinh từ các sự kiện không liên quan sau bộ lọc.

## Giới hạn phục hồi detail chưa rõ kết quả — 02/10/2026

Review tái hiện Desktop/legacy Server còn `recover` sau 31 ngày khi dừng sau gửi nhưng trước INSERT; `missing` retry vô hạn và nguồn cũ vẫn nhận tin mới vào queue/RPC. Đã sửa riêng runtime: repository đánh dấu biên bắt đầu INSERT; hủy trước biên đó dọn nguồn ngay. Khi commit chưa rõ, `recoveryExpiresAt` được chốt một lần ở lần chuyển sang recover và hết sau 5 phút. Retry/staging lại/restart không gia hạn; journal cũ dùng `at + 5 phút`. Hết hạn bỏ nguồn và replay chỉ phụ thuộc nguồn đó, giữ operation khác/first pass cho watch đã biết. Admission kiểm tra hạn trước config/queue; cleanup chạy trước config/RPC và không hồi sinh từ lookup trả về muộn. Thêm metric `recoveryExpired`.

Hạn phục hồi này độc lập với `tracking_until` DB và bốn setting hiện có. Không sửa migration/RPC/schema, không tăng connection hoặc thêm API Zalo, không thay luồng gửi/detail/quota và không yêu cầu chúng chờ. Không sửa akaAgentChatApi/WebApp trong lượt fix này; production chưa thay đổi.

Kiểm chứng local PASS: core 30.000 sự kiện không liên quan; lifecycle gồm hủy trước INSERT, giữ commit chưa rõ trong hạn, mốc 5 phút không gia hạn, 1.000 tin bị loại ngay tại biên hết hạn, cleanup khi config lỗi, restart/journal legacy, 31 ngày không RPC tiếp, lookup về muộn và hai operation cùng người nhận độc lập. Fixture scheduler thực xác nhận dừng sau SDK gửi xong không còn recover; các case disk/config/listener chậm không chặn gửi/detail/quota vẫn PASS. Hai typecheck, build Desktop rồi Server và diff check PASS. Không lặp benchmark tải/SQL/UI vì các phần này không đổi.
