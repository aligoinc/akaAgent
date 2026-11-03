# Trạng thái đã xác nhận — cập nhật 03/11/2026

Đây là chỉ mục dựa trên receipt/audit đã có, không phải lệnh triển khai.
Lần tổ chức tài liệu không query hoặc thay đổi production. Trước thay đổi DB phải
đọc live theo skill RPC; không suy ra quyền apply từ bảng này.

## Tách quyền akaChat/akaAgent — V447 đã kích hoạt

[V451 canonical Chat identity](../audits/app-access-split/CANONICAL_IDENTITY_FIX_20261103.md):
**Đã apply 11:15:06 VN ngày 03/11/2026**, ledger `20261103041506`; sửa false conflict khi bật Chat từ ID legacy đã đăng xuất.
230 ca PG17 (42 mới), hai typecheck akaAgent/build Chat API và trial production
ROLLBACK và hậu kiểm đạt; chỉ hai hàm đổi đúng checksum, flags/bindings/ACL và các hàm khác giữ nguyên.
Không deploy/build app hoặc tự bật account; giữ V449/V450. Không apply lại V451.
[Receipt apply](../audits/app-access-split/canonical-identity-apply-receipt-20261103.json).
[Audit tiếp theo](../audits/app-access-split/IDENTITY_CHECK_AUDIT_20261103.md): còn
login-status trigger/local registration/duplicate legacy đã hoãn dùng ID cũ;
bốn repro local xác nhận, chưa sửa. Live 11:20:53: không có bound UID mismatch
hay duplicate candidate đang bật; ba Server unbound logged-out còn ID cũ, Chat=false.

[Cấp lại Chat Server khi chủ khóa/hết hạn — V450](../audits/app-access-split/SHARED_OWNER_GRANT_FIX_20261103.md):
**Đã apply 10:21:32 VN ngày 03/11/2026**, ledger `20261103032132`. Chỉ sửa validator
cấp quyền; giữ gói/quota/tenant/identity, actor auth, akaAgent và host QR local.
188 ca PG17 đạt (44 ca mới), hai typecheck akaAgent và build TypeScript API đạt.
Production trial ROLLBACK và hậu kiểm 6 Server/1 QR local đúng kỳ vọng, không đổi
cờ hoặc chia sẻ thật. Không deploy/build bộ cài/đổi CRM; không apply lại.
[Receipt](../audits/app-access-split/shared-owner-grant-receipt-20261103.json).

[Chia sẻ Chat khi chủ bị khóa/hết hạn — V449](../audits/app-access-split/SHARED_OWNER_FIX_20261103.md):
**Đã apply 09:52:08 VN ngày 03/11/2026**, ledger `20261103025208`. Chỉ helper
account Chat bỏ điều kiện active/thời hạn của chủ; staff login/ACL người nhận,
owner chưa xóa/đúng tenant và akaAgent giữ nguyên. Org 1 khôi phục eligibility
Chat của 7 account, tổng 35/35; chủ vẫn bị khóa và không chạy chiến dịch. 144 ca
PG17 (46 ca mới), 1.756 API tests, API build và hai typecheck akaAgent đạt.
Không deploy/build bộ cài/đổi CRM, pool hoặc polling; không apply lại.
[Receipt và giới hạn kiểm chứng](../audits/app-access-split/shared-owner-receipt-20261103.json).

[Tối ưu ba điểm hiệu năng 03/11](../audits/app-access-split/PERFORMANCE_FIX_20261103.md):
**V448 đã apply 06:40:52 VN**, ledger `20261102234145`: partial index cho campaign
held, không đổi RPC/ACL/RLS. **Chat API deploy 06:47:34 VN** từ repo chính
`644de45`; kiểm quyền một lần mỗi staff/account trong statement và lọc ứng viên
runtime trước helper. 1.756 test, native PG17 parity và 11 đối chiếu production
đạt; health/realtime và 226 runtime account giữ nguyên. Không build lại Desktop/
App Server, không deploy hai web/worker/runtime/CRM hoặc tăng tài nguyên. Không
apply lại index; [receipt DB](../audits/app-access-split/performance-v448-apply-receipt.json).

[Tách quyền akaChat/akaAgent V445–V447](../APP_ACCESS_SPLIT.md): source bốn repo,
build local, SQL rollback rehearsal và kiểm thử đã chuẩn bị ngày 03/11/2026.
Đã sửa bốn lượt review: capability Chat độc lập, guard Data Scan, lifecycle reader, RLS Desktop cũ, capture cuối rollout và lỗi ACL của policy đọc staff, receipt QR khóa nguồn/quyền tại commit và reservation danh tính khi bật Chat. Audit hiện có 98 ca SQL, 13 RPC sửa và 42 target functions; 11 runtime dependencies giữ nguyên body/ACL. Policy dùng view staff đã scope; V445/V447 chặn drift metadata view, không mở SELECT `org_staff`.
**Đã apply V445, V446 và hai private auth patches lúc 04:59:58–05:00:28 Việt Nam ngày 03/11/2026** trên `cgjbsmqtfhqvttudyjzq`. Trial production kết thúc ROLLBACK, đối chiếu metadata trước/sau và kiểm tra schema/ACL đạt. Ledger và bằng chứng ở [receipt apply](../audits/app-access-split/apply-receipt.json); không apply lại các bước này.
**V447 đã apply lúc 06:07:41 Việt Nam ngày 03/11/2026**, ledger `20261102230741`; `private.app_access_policy_enabled()` trả true. Bốn tổ chức có product 5 dùng quyền riêng, 1.782 tổ chức còn lại giữ legacy. Trial ROLLBACK, hậu kiểm 55 signatures/ACL/config, quota/scope/cleanup và 14 HTTP probes đạt; [audit activation](../audits/app-access-split/ACTIVATION_20261103.md), [receipt](../audits/app-access-split/activation-receipt.json). Không apply lại; sau activation chỉ roll forward, không mở lại quyền bằng rollback cũ.
Chat API/worker/Server runtime, Chat Web và WebApp/API đã [deploy từ repo chính lúc 05:33–05:36](../audits/app-access-split/DEPLOYMENT_20261103.md). Người dùng đã xác nhận cài Server 9.2.0; Desktop 9.2.0 ba nền tảng đã build local, chưa được agent upload/phát hành. Yêu cầu trực tiếp apply V447 sau build thay bước chờ phát hành trong quyết định trước PR; người dùng chấp nhận app cũ không hỗ trợ org có product 5 và không cần chờ mọi máy cập nhật. CRM không đổi source/deployment. Hai lỗi P2 về duplicate legacy identity và thứ tự khóa binding/account vẫn được tạm hoãn. [Kiểm chứng trước PR](../audits/app-access-split/pr-verification.json).

## Bảo mật và tương thích hiện hành

[Facebook random AI V444](../FACEBOOK_RANDOM_AI_V442.md) **đã apply lúc 22:27:21 Việt Nam ngày 02/11/2026**, ledger `20261102152721 / migration_v444_facebook_random_ai`; đổi số candidate từ V442 vì ledger đã có migration khác dùng V442/V443. Trial `ROLLBACK`, hậu kiểm 11 hàm/metadata/quyền và smoke AI/luồng chạy thường đạt. App dev đã mở để người dùng test; **chưa đóng gói/phát hành, chưa kiểm canary AI/Facebook thật của tính năng**. [Audit](../audits/facebook-random-ai-v442/README.md), [receipt apply](../audits/facebook-random-ai-v442/apply-receipt.json). Không apply lại.

| Phần | Trạng thái đã xác nhận | Nguồn để thao tác/review |
| --- | --- | --- |
| Production | `akachat`, ref `cgjbsmqtfhqvttudyjzq`; project legacy bị cấm theo AGENTS.md | `supabase/.temp/project-ref`, [quy tắc gốc](../../AGENTS.md) |
| Anon/RLS, V435 | Đã cutover `20261027165325`: thu hồi anon/authenticated trong phạm vi akaAgent, bật RLS còn thiếu; giữ bootstrap và đúng một dòng updater cho app cũ | [V435](../DESKTOP_PERMISSION_CUTOVER_V435.md) |
| Token Desktop | Token theo Auth/staff; quyền đã thu hẹp. Không đọc trực tiếp staff, không ghi tổ chức, không đọc Vault/AI key. Giữ quyền embedded join cần thiết | [token/RLS](../DESKTOP_SESSION_RLS.md), [quyền](../DESKTOP_TOKEN_PERMISSIONS.md) |
| Staff privacy | `20261027180248` đã apply: staff chỉ đọc/khóa hồ sơ runtime của mình; chặn RPC quản trị từ Desktop | [staff self access](../DESKTOP_STAFF_SELF_ACCESS.md) |
| Danh sách chia sẻ | `20261027181132` đã apply: giữ ID+tên staff hoạt động/cùng org để chọn người nhận; không trả profile/credentials người khác | [directory](../DESKTOP_STAFF_SELF_ACCESS.md) |
| Account/campaign ownership | `20261027185059` đã apply: scope theo staff token, 19 restrictive policy, guard RPC/trigger; giữ backend và chia sẻ nhóm | [ownership](../DESKTOP_ACCOUNT_CAMPAIGN_OWNERSHIP.md) |
| Thư viện dữ liệu/settings/element/org — V436 | `20261028093922` đã apply: dữ liệu riêng theo staff, giữ chia sẻ qua nhóm/RPC; settings chỉ admin, element chỉ admin hoặc own nonbuiltin; org/gói thu hẹp. 23 restrictive policy, 11 guard, không đổi app/timeout/anon. Secret upload/proxy còn giữ do client hiện tại cần | [phạm vi và kiểm chứng](../DESKTOP_DATA_PRIVACY_V436.md), [receipt](../../migrations/snapshots/desktop-data-privacy-v436/apply-receipt.json) |
| Thu hồi chia sẻ | `20261028064138` đã apply 13:41:38 VN: sửa khóa nội bộ để chủ nhóm dừng source của người mất quyền, giữ direct cross-staff denial | [audit](../GROUP_SHARING_REVOKE_OWNERSHIP.md), [receipt](../../migrations/snapshots/group-sharing-revoke-ownership/apply-receipt.json) |
| Tên/Tên gốc Zalo trong Quét data — V441 | `20261102064947` đã apply lúc 13:49:47 VN, 02/11/2026: chỉ thêm projection JSON và filter `zaloOriginalName` ở hai reader, không đổi tên/field cũ, ACL, timeout, connection hoặc business rows. Trial ROLLBACK, guarded rollback và 10 ca hậu kiểm service_role/Desktop đạt. Source app build local, chưa đóng gói/phát hành; không apply lại | [hợp đồng và audit](../ZALO_SCAN_NAMES_V441.md), [receipt](../../migrations/snapshots/zalo-scan-names/apply-receipt.json) |
| DeepSeek setting | `20261027182912` đã apply: Desktop không đọc/ghi/đổi tên dòng `ai.deepseek.api_key`; backend và settings khác giữ nguyên | [DeepSeek block](../DESKTOP_DEEPSEEK_SETTING_BLOCK.md) |
| Block/workflow definitions | `20261027191229` đã apply: Desktop kể cả admin mất quyền ghi `auto_blocks`/`auto_workflows`, giữ SELECT/backend; không suy rộng sang element/XPath/legacy | [receipt](../../migrations/snapshots/desktop-block-workflow-readonly/apply-receipt.json) |
| XPath mở bình luận Facebook | Element 13 `fb_comment_box_at_n`: 01/11 thêm `contains(@aria-label,'Comment')`; 02/11/2026 lúc 09:27:03 VN bổ sung `contains(@aria-label,'Bình luận về')` sau khi người dùng kiểm tra trình duyệt. Chỉ đổi xpath/updated_at; trial ROLLBACK và đọc lại DB đạt, checksum các element khác/block/workflow giữ nguyên. Chưa xác minh campaign sau bản sửa 02/11. Process đang mở cần thoát hẳn app rồi mở lại để nạp cache; không reload PostgREST/build/deploy | [audit](../CUSTOMER_REPORTS_ZALO_ALBUM_FB_GROUP_20261101.md#b-comment-sau-đăng-nhóm-gãy-toàn-fleet-từ-3010), [receipt 01/11](../audits/facebook-comment-box-xpath-20261101/receipt.json), [receipt 02/11](../audits/facebook-comment-box-xpath-20261101/vietnamese-label-20261102/receipt.json) |
| Nút bình luận newsfeed và quét data | Element 1692/1489: 01/11 thêm `contains(@aria-label,'Comment')`; 02/11/2026 lúc 09:29:38 VN bổ sung `contains(@aria-label,'Bình luận về')` theo yêu cầu rà các nút cùng chức năng. Giữ parent/root/role và điều kiện cũ. 1517/1693/1694 đã bao phủ nhãn mới; 14 không thấy consumer nên giữ nguyên. Trial ROLLBACK/hậu kiểm DB đạt, checksum các element khác/block/workflow không đổi; chưa test Facebook thật. App đang mở cần khởi động lại để nạp cache; không reload PostgREST/build/deploy | [audit](../CUSTOMER_REPORTS_ZALO_ALBUM_FB_GROUP_20261101.md#b-comment-sau-đăng-nhóm-gãy-toàn-fleet-từ-3010), [receipt 01/11](../audits/facebook-comment-buttons-xpath-20261101/receipt.json), [receipt 02/11](../audits/facebook-comment-buttons-xpath-20261101/vietnamese-label-20261102/receipt.json) |
| Nút Like newsfeed và dialog bài viết | 01/11/2026 lúc 13:49:07 VN đã thêm `contains(@aria-label,'Bày tỏ cảm xúc Thích')` vào element 1691/1132 theo yêu cầu người dùng. Giữ điều kiện cũ, parent/root, block/workflow và element Chia sẻ 257. Trial ROLLBACK/hậu kiểm DB đạt; chưa chạy Like thật. App đang mở cần thoát hẳn rồi mở lại để nạp cache; không reload PostgREST/build/deploy | [audit](../CUSTOMER_REPORTS_ZALO_ALBUM_FB_GROUP_20261101.md#b-comment-sau-đăng-nhóm-gãy-toàn-fleet-từ-3010), [receipt](../audits/facebook-like-buttons-xpath-20261101/receipt.json) |
| Form thêm bằng Agent — V442 | `20261102093125` đã apply lúc 16:31:25 VN, 02/11/2026: thêm hai config Agent, 10 config cũ giữ nguyên checksum; transaction trial/guarded rollback và hậu kiểm quyền Desktop đạt, không đổi RPC/ACL/connection/reload. Source, smoke Electron, hai typecheck/build local đạt; form cũ giữ nguyên, sửa/clone vẫn route cũ. Đã sửa snapshot form trống, chat theo theme và width 90%/sidebar 260px; smoke/2 typecheck/build đạt. App đang mở để test; canary form trống qua AI live hỏi chọn tài khoản đạt, chưa canary đầy đủ/chưa phát hành. Không apply lại | [hợp đồng](../CAMPAIGN_AGENT_FORM.md), [audit](../audits/campaign-agent-v442/README.md), [receipt apply](../../migrations/snapshots/campaign-agent-v442/apply-receipt.json), [receipt metadata nhóm](../audits/campaign-agent-v442/group-metadata-verification.json), [receipt form trống/UI](../audits/campaign-agent-v442/ui-empty-form-verification.json) |
| Form Agent — import local 03/11/2026 | Source dùng parser Excel/TXT và OCR local; AI chỉ điều phối metadata, Upload xác nhận mới chèn. Đã sửa tách nhầm SĐT/email khi dán trong nội dung, nhận diện CSV giữ cột/local kể cả qua dòng trống và OCR kẹt khi khởi tạo lỗi. Đã sửa tên khách giống từ lệnh bị cắt khỏi bảng và câu yêu cầu sau CSV bị nhập nhầm vào data. Bảng Excel dán bằng tab giữ nguyên ô nhiều dòng, đủ hàng/cột qua Upload và lưu/mở nháp; không đưa phần ghi chú sang AI. Đính kèm dữ liệu dán thất bại giữ nguyên nguồn và khóa lưu/gửi đến khi thử lại thành công hoặc bỏ; câu đặt tên/tiêu đề email không bị nhầm thành header CSV. Mô tả dán quá 4.000 ký tự được giữ trong ô rút gọn riêng, khóa lưu/gửi đến khi xử lý; mở lại nháp giữ chat/file. Paste/import/nháp/hủy/thử lại có kiểm chứng. Smoke Electron/IPC/OCR ASAR, hai typecheck/build đạt; app dev đã mở để test ở lượt triển khai. Không apply DB/provider canary/phát hành trong lượt sửa; chưa xác minh bộ cài Windows | [hợp đồng](../CAMPAIGN_AGENT_FORM.md), [receipt local](../audits/campaign-agent-v442/local-import-verification.json), [receipt sửa nhận diện/OCR](../audits/campaign-agent-v442/review-data-ocr-fixes-verification.json), [receipt paste/CSV](../audits/campaign-agent-v442/paste-csv-verification.json), [receipt dòng trống/nháp](../audits/campaign-agent-v442/paste-guard-verification.json), [receipt ranh giới CSV](../audits/campaign-agent-v442/csv-boundary-verification.json), [receipt dữ liệu chờ/header](../audits/campaign-agent-v442/pending-header-verification.json), [receipt TSV nhiều dòng](../audits/campaign-agent-v442/tsv-multiline-verification.json), [kiểm chứng toàn bộ trước PR](../audits/campaign-agent-v442/pr-verification.json) |
| Form Agent — ô nhập chung 03/11/2026 | Source sau PR #576: ô chat gọn, dùng chung để dán data, chọn/kéo thả Excel/CSV/TXT/ảnh; nguồn dài chưa nhận diện có lựa chọn đính kèm nguyên clipboard local. Giữ yêu cầu ngoài vùng chọn, nháp và nguồn chờ khi lỗi/hủy; không đưa danh sách vào AI. Smoke Electron, hai typecheck và production build local đạt. PR #577 đã merge và sync repo chính tại `3ccf39da`; chưa phát hành Desktop; không đổi/apply DB | [hợp đồng](../CAMPAIGN_AGENT_FORM.md), [audit composer](../audits/campaign-agent-composer/README.md), [receipt sửa data dài](../audits/campaign-agent-composer/large-paste-fix-verification.json) |
| Form Agent — giảm lag nhập liệu 03/11/2026 | Source local trên `codex/campaign-agent-typing-performance`: chat không render toàn form theo từng phím; giữ metadata đồng bộ, không clone/serialize data không đổi và cache hàng theo trang. Đã đo 5.000 dòng; hai typecheck, build và smoke toàn form/nháp/Hoàn tác đạt. PR #578 đã merge/sync tại `9080a12d`; chưa phát hành; không đổi/apply DB | [hợp đồng](../CAMPAIGN_AGENT_FORM.md), [audit tốc độ gõ](../audits/campaign-agent-typing/README.md) |
| Ô nội dung cả hai form — 03/11/2026 | Source trên `codex/campaign-content-typing`: vùng Nội dung subscribe riêng, snapshot nháp/revision cập nhật đồng bộ, giữ StrictMode. Chưa merge/sync/phát hành; không đổi DB | [hợp đồng](../CAMPAIGN_CONTENT_TYPING.md), [audit](../audits/campaign-content-typing/README.md) |
| AI Desktop | V434/API proxy đã deploy và canary Desktop thật đã đạt; provider key không đưa về Desktop | [AI proxy](../DESKTOP_AI_PROXY.md) |
| Chat API/worker, ChatWeb, WebApp, akaMap | HTTP compatibility `20261027181400` đã apply; các backend và Edge akaMap đã deploy. Không mở lại anon hoặc tăng pool/replica | [cross-repo audit](../CROSS_REPO_RLS_DEPLOY_20261028.md) |
| Đồng bộ lịch sử Zalo Server — V437–V438 | V437 `20261029180830`, V438 `20261030043145` đã apply. API/system-worker/Web đã deploy 11:33–11:36 VN, 30/10/2026 từ repo chính sau merge PR107/API và PR68/Web: receipt Start chính xác, tránh khóa chéo và sửa UI Dừng/chuyển lượt. Runtime giữ image/config/instance, không deploy/restart; control socket reconnect sau API restart. Health đạt; worker project 540/540 trong cửa sổ kiểm tra. Giữ UI org 1/batch 20; không đổi tài nguyên/pool/replica. Pilot trước nhập 2.436 tin, 464 trùng rồi cancelled; pilot bản mới chờ user test | [phạm vi, nguồn canonical và audit liên repo](../ZALO_MESSAGE_SYNC_V437_20261030.md) |
| UI đồng bộ theo tổ chức — V440 | `20261030085919` đã apply 15:59:19 VN, 30/10/2026; chỉ org 1 bật `zalo_message_sync_enabled`. API/Web deploy 16:00–16:01 VN, mốc 7/30/90/360/720/Tuỳ chọn (UI tối đa 720). PR111/API và PR73/Web đã merge/sync, worktree đã dọn. Bản sửa giữ khoảng ngày deploy riêng Web từ repo chính `7772ed6` lúc 16:48 VN; 158 file source API live khớp `a16cfc4`. Health/hash JS đạt; API/worker/runtime giữ nguyên instance. Không apply lại DB, đổi backend date limit, quyền hoặc pool/tài nguyên | [audit liên repo và nguồn canonical](../ZALO_MESSAGE_SYNC_UI_V440_20261030.md) |
| Context từ lịch sử Zalo — V439 | `20261030081324` đã apply lúc 15:13:24 VN, 30/10/2026: trigger bỏ qua `sync_source='old'` trước khi gọi Context. Giữ realtime/API, job hiện có và function/ACL; không thêm job bù sau đồng bộ. Không deploy/restart service hoặc tăng connection | [hợp đồng, rollback và hậu kiểm](../CONTEXT_ZALO_HISTORY_TRIGGER_V439_20261030.md) |
| Nhập trích dẫn lịch sử theo lô | System-worker đã deploy từ repo chính Chat API `dev`/`09fe12a` lúc 15:26 VN, 30/10/2026 sau PR110. Chỉ đổi image sole worker; API/runtime giữ config và instance, ChatWeb không deploy. V437–V439 hậu kiểm đạt, không apply lại; 1.731 test và 13 ca PostgreSQL đạt. Pilot tốc độ đồng bộ mới chờ user test | [phạm vi liên repo](../ZALO_MESSAGE_SYNC_V437_20261030.md) |
| Device identity v3 | `20261027085744` đã apply; credential/CAS/receipt, giữ recovery proof/journal. Ghi chú “chưa bật C” là trước V435 | [device v3](../DEVICE_IDENTITY_V3.md), [V435](../DESKTOP_PERMISSION_CUTOVER_V435.md) |
| Source chặn IP | Source Edge/migration IP/hồ sơ/full capture riêng đã chuyển ngoài Git; production giữ quy tắc đang triển khai | [README source riêng](../../supabase/functions/aka-agent-desktop-session/README.md) |

Không apply lại các mốc trên. Không chạy B/C cũ hoặc rollback mở quyền nếu chưa có
chỉ thị riêng. File canonical có thể mang timestamp khác ledger; đối chiếu
receipt/signature/checksum, không dùng filename để kết luận “chưa chạy”.

## Build và phát hành

- 03/11/2026: source trên `codex/windows-hardware-timeout` tăng giới hạn đọc hardware Windows v2/v3 từ 10 lên 30 giây, thêm thông báo timeout và diagnostic console đã lọc dữ liệu. Giữ công thức, selection, cache phiên, single-flight và cơ chế reset. 70 ca smoke, hai typecheck và build production local đạt; chưa kiểm chứng Windows khách thật, chưa đóng gói/phát hành, không đổi DB. [Hợp đồng](../DEVICE_IDENTITY_V3.md#windows-đọc-phần-cứng-chậm--source-03112026), [receipt kiểm chứng](../audits/windows-hardware-timeout/verification.json).

- 03/11/2026: **akaAgent Desktop 9.2.0 Windows x64, Mac ARM64 và Mac Intel x64 đã build local từ repo chính** (`dev_3`/`d493dd9e`). Hai typecheck, ba build, version/kiến trúc/native/payload/credential checks đạt; Mac SQLite chạy qua packaged Electron (Intel qua Rosetta), host native giữ checksum. Windows chưa ký Authenticode/chưa chạy trên Windows thật; Mac ký ad-hoc, chưa notarize. Chưa upload/phát hành; V447 không đổi. [Audit và checksum](../audits/akaagent-9.2.0-20261103/README.md).
- 03/11/2026: **akaAgent Zalo Server 9.2.0 Windows x64 nội bộ đã build local từ repo chính** (`dev_3`/`5df2678f`). Hai typecheck, Server build, installer payload/native/version/credential checks đạt; host native khôi phục và SQLite smoke đạt. Chưa ký Authenticode, chưa được agent kiểm tra trên Windows thật, chưa upload/phát hành. Người dùng đã xác nhận cài Server mới; Desktop 9.2.0 đã build ở mốc trên, chưa phát hành; V447 không đổi. [Audit và checksum](../audits/akaagent-server-9.2.0-20261103/README.md).

- 02/11/2026: Excel Nhóm data/Kết quả chạy có cột metadata Facebook động, action gate và bỏ Loại nhóm AI ở Data tìm được. **V443 đã apply** lúc 17:11:04 Việt Nam (`20261102101104`), đổi số vì V442 đã được task khác dùng. Checksum/quyền/timeout, smoke SQL service_role/Desktop và guarded rollback đạt; HTTP đã nhận RPC mới, chặn anon đúng quyền. Smoke app, hai typecheck và build local đạt; **chưa đóng gói/phát hành app**. Không apply lại khi merge; [hợp đồng](../FACEBOOK_GROUP_EXPORT_METADATA.md), [receipt](../../migrations/snapshots/facebook-group-export/apply-receipt.json). Mốc 7 cột bên dưới là lịch sử trước yêu cầu bỏ AI.
- 02/11/2026: source xuất Excel nhóm Facebook tìm theo từ khóa có đủ 7 cột; sau review đã giữ số liệu khi bổ sung tên dòng trùng và để trống số bài 0 chưa xác minh. Smoke Electron/XLSX, hai typecheck và build production local đạt trên nhánh `codex/facebook-group-excel`; **chưa đóng gói/phát hành app**. Giữ luồng quét nhóm đã tham gia, không sửa DB. Xem [hợp đồng và kiểm chứng](../FACEBOOK_SEARCH_GROUP_EXCEL.md).

- 02/11/2026: source cột **Tên/Tên gốc Zalo** đã qua hai typecheck, 75 ca smoke và build production local trên worktree riêng trước PR. Nhãn **Tên** được giữ theo yêu cầu sau review để tương thích nhập lại Excel; backend V441 đã apply, **chưa đóng gói/phát hành app**. Không apply thêm DB trong lượt tạo PR. Xem [audit V441](../ZALO_SCAN_NAMES_V441.md).

- akaAgent 9.1.0 đã build local cho Windows, Mac ARM64/Intel và Server Windows; feed ba nền tảng được xác nhận 9.1.0 trong audit cutover. [Build receipt](../audits/akaagent-9.1.0-20261027/build-receipt.json), [cutover](../DESKTOP_PERMISSION_CUTOVER_V435.md).
- Bộ cài Server nội bộ có credential giữ riêng trên máy quản lý, không publish/đưa vào Git. Build local không chứng minh đã cài trên mọi máy khách.
- akaMap 3.0.7 Mac ARM64/Windows build local được ghi trong audit cross-repo; kiểm tra audit/release mới hơn trước khi kết luận trạng thái upload.
- Các bản build/candidate/deploy cũ và rủi ro người dùng chấp nhận nằm trong [lịch sử và mục lục](REFERENCE_INDEX.md). Không đổi quyết định đã chấp nhận chỉ để làm sạch lịch sử.

## Giải quyết ghi chú cũ mâu thuẫn

| Ghi chú trong lịch sử/reference | Cách hiểu hiện nay |
| --- | --- |
| “Anon chưa thu hồi”, “B/C chưa chạy”, “org_staff RLS=false” | Mốc trước V435; dùng audit cutover và kiểm tra live. Không mở lại quyền legacy. |
| “Admin desktop sửa workflow/block”, built-in “qua admin UI/IPC” | Luồng trước thu hồi ghi; không cấp lại quyền Desktop vì UI còn hiển thị. Backend có phạm vi riêng. |
| “Không có test commands” | Không có test/lint chung; `package.json` và `scripts/` có smoke chuyên biệt. Dùng đúng lệnh trong audit phần sửa. |
| “Chưa apply/deploy/phát hành” của feature khác | Chỉ đúng tại mốc ghi nhận; tìm audit mới hơn/receipt/live trước hành động. |

Mỗi cập nhật tiếp theo chỉ sửa dòng liên quan và dẫn tới audit mới.
Không biến file này thành bản sao lịch sử toàn hệ thống.
