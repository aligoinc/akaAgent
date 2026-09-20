# Đồng bộ Google Sheet vào nhóm data

Triển khai theo phần **3a** của `Panel thông tin nhóm data.dc.html` ngày 20/09/2026. UI là component React dùng dialog, theme và IPC hiện có: panel 372px, form 520px, menu **Thêm nguồn → Từ Google Sheet**, dialog riêng khi cửa sổ ≤1050px. Màu nền thích ứng theme của ứng dụng. Chỉ hỗ trợ Google Sheet trong bản này.

## Hành vi

- Mở tab **Đồng bộ ngoài** để xem nguồn, trạng thái, số data đã thêm và 30 lượt chạy gần nhất. Tải khi mở tab/đổi nhóm/thao tác/bấm Làm mới. Khi có nguồn đang chờ/chạy, UI kiểm tra kết quả mỗi 10 giây, tối đa 5 phút, chỉ khi phần đồng bộ đang hiển thị và không mở form sửa. Không theo dõi nền khi rời tab, ẩn cửa sổ hoặc đóng dialog. Dừng khi hoàn tất, tạm dừng, lỗi/chờ retry hoặc hết thời gian theo dõi; nguồn thành công không tiếp tục polling tới lịch kế tiếp.
- Sheet cần quyền **Bất kỳ ai có đường liên kết**. Link phải thuộc `https://docs.google.com/spreadsheets/d/…`; đọc tab theo `gid`, không cần đăng nhập Google. URL tải chỉ theo redirect HTTPS của Google, không theo link tới host tùy ý.
- Nguồn mới cần kết nối để đọc cột, rồi ghép định danh bắt buộc cùng họ tên, phone, email, info1–info5. Mở sửa nguồn tự kết nối và giữ ghép cột khi cấu trúc chưa đổi; nếu cột đã đổi phải ghép lại, không tự chuyển định danh sang cột A. Lỗi kết nối cho thử lại bằng nút Kết nối. Mặc định dòng đầu là tiêu đề; đổi lựa chọn này sau khi kết nối tự đọc lại Sheet. UID dài và điện thoại được đọc dưới dạng chuỗi; nên đặt các cột này là văn bản trong Sheet vì dữ liệu đã bị Google làm tròn trước khi xuất CSV không thể khôi phục.
- Nhóm cố định kế thừa loại. Nhóm “Mọi loại dữ liệu” chọn loại cho nguồn. Hỗ trợ phone, email, Facebook user/group/page/từ khóa/link bài viết, Zalo UID/link nhóm. Loại inbox Page chưa được form nhập hỗ trợ nên không cho thêm nguồn.
- Nguồn loại SĐT dùng chung `normalizeVietnamMobilePhone` với luồng nhập hiện có, cả xem trước Desktop và Edge: bổ sung `0` đầu khi đủ điều kiện, nhận `84`/`0084`, đổi đầu số di động cũ và đọc dạng số mũ. Ví dụ `333875455` → `0333875455`, `703576704` → `0703576704`; các biến thể dùng cùng canonical key để chống trùng.
- **Chạy thử ngay chỉ xem trước**: số dòng mới/trùng/không hợp lệ và tối đa 10 mẫu; không lưu nguồn, tạo contact, membership hay lịch.
- Chu kỳ mặc định 6 giờ; preset 1/3/6/12/24, cho nhập giờ nguyên 1–8760. Không có ngày dừng là vô thời hạn; ngày dừng bao gồm toàn bộ ngày theo `Asia/Ho_Chi_Minh`. Lưu nguồn bật đưa lượt đầu vào hàng đợi ngay; panel hiển thị đang chờ/chạy và tự cập nhật danh sách data, số lượng nhóm và panel thông tin khi nhận kết quả thành công. Chỉ lịch sau lượt thành công mới cộng chu kỳ giờ. Các nguồn đến hạn chạy lần lượt.
- Giới hạn 10.000 dòng dữ liệu, 10 MiB CSV; kiểm tra trước khi nhập. Cấu trúc cột thay đổi hoặc mất quyền đọc sẽ dừng nguồn, yêu cầu kết nối/ghép cột và lưu lại.
- Chỉ thêm mới. Không ghi đè contact cũ, không xóa khi dòng biến mất, không khôi phục contact đã xóa. Ledger định danh theo nhóm + loại + ngữ cảnh tài khoản giữ cả khi xóa nguồn hoặc gỡ data, nên những dòng đã xử lý không tự thêm lại.
- Xóa nguồn là soft-delete cấu hình và hủy kết quả đang chạy; giữ data đã nhập. Nguồn trùng nhau và dòng trùng trong cùng lượt dùng chung canonical key tại DB.
- Lỗi mạng thử lại sau 5, 15, rồi 60 phút. Nhóm/tài khoản/binding/loại không còn hợp lệ thì ngừng nhập. Sửa/tắt/xóa nguồn tăng revision và vô hiệu hóa token cũ.

## Kiến trúc và tải DB

`Renderer → preload.dataGroupExternalSync → IPC main-frame → repository → RPC` dùng client HTTP hiện có. Credential staff chỉ ở main process; kiểm tra lại phiên trước/sau các await. Parser/mapper thuần TypeScript dùng chung giữa main và Edge, SQL dùng cùng classifier cho preview và commit.

Cron hiện có **job 66**, `aka-agent-data-group-dynamic-filter-worker`, vẫn chạy **30 seconds**. Command gọi `aka_agent_data_group_background_tick()`: giữ nguyên worker bộ lọc động và gọi dispatcher trong hai exception block độc lập. Chỉ khi có nguồn đến hạn mới enqueue `pg_net` đến `aka-agent-google-sheet-sync`.

Không thêm cron, SQL client/pool/listener hoặc tăng ngân sách connection. Một lease toàn hệ thống, 180 giây, chỉ cho một nguồn đang xử lý; Edge gọi claim → đọc Google → finish tuần tự qua HTTP/RPC. Các request vẫn dùng tài nguyên pool server hiện có. Không gọi RPC theo từng dòng. Import giữ khóa nhóm và dùng pipeline ingest hiện có để bảo toàn revision, semantic type, binding và campaign targets.

Bốn bảng mới có RLS, không cấp quyền table cho anon/authenticated:

- `auto_data_group_external_sync_sources`: cấu hình và lịch.
- `auto_data_group_external_sync_runs`: lịch sử, token, revision và kết quả idempotent.
- `auto_data_group_external_sync_seen`: canonical key đã xử lý, độc lập trạng thái membership.
- `auto_data_group_sheet_worker_state`: một lease/dispatch switch toàn hệ thống.

Client chỉ gọi RPC tenant có credential; `aka_agent_sheet_claim`/`aka_agent_sheet_finish` chỉ cấp cho service_role. Edge dùng secret `INTERNAL_EDGE_FUNCTION_TOKEN` có sẵn trong Vault/Edge, header `x-internal-token`; không nhận URL/group/staff từ HTTP caller. `verify_jwt=false` vì worker có xác thực nội bộ riêng. Request không xác thực trả 401. Secret không đi vào renderer/log/URL.

`external_sync` là provenance riêng, không dùng nhánh upload thay snapshot. Bộ lọc nguồn mới dùng RPC v3 lọc trước pagination, còn đường không lọc vẫn dùng v2. Source code và panel nhận diện nguồn mới.

## Migration và audit live

Project duy nhất: **cgjbsmqtfhqvttudyjzq**. Áp dụng từng file qua `supabase db query --linked`, ghi history vào bảng có sẵn trong cùng transaction, không bulk-push. V297 bổ sung schema/RPC và đổi command job, nhưng để dispatcher tắt. Sau deploy Edge và kiểm tra xác thực mới bật. Edge `aka-agent-google-sheet-sync` hiện version 3 (dùng chung chuẩn hóa SĐT, ngày 21/09/2026), trạng thái ACTIVE, custom authentication đã kiểm tra. V298 sửa thứ tự khóa khi phục hồi lease để không khóa run trước group/source, tránh deadlock với thao tác sửa/tắt/xóa.

History đã apply: v297 `20260920152357`, v298 `20260920152707`, v299 `20260920155804`, v300 `20260920161702`, v301 `20260920173109`.

Các definition được lấy từ `pg_get_functiondef()` live trong task; owner, security mode, volatility, config và ACL đều được đối chiếu trước/sau apply. Preflight checksum fail-closed. Source/target MD5:

| Exact signature (`public`) | Source | Target |
| --- | --- | --- |
| `aka_agent_ingest_data_group_v186_internal(bigint,bigint,text,bigint,text,jsonb,bigint,text,text,bigint,text,text)` | `544d36b2c232653ce3168cd18ae25266` | `70abe6e3db930718a6472ce270b29b7a` |
| `aka_agent_data_group_source_code(text)` | `4c1ea3a984cd3c3c38d04b6ee6be8e3b` | `490c06769bbf4ac29faacc2eb989119f` |
| `aka_agent_get_data_group_panel(bigint,bigint,bigint,text,text)` | `0365d8eae3b99217e5063f0e5cbaa480` | `66dedeb5be692b600b4a762a9ac6a60d` |
| `aka_agent_sheet_claim(uuid)` (v298) | `99cfd6c369ffe9a29b08ccedd55adcdf` | `00bc55ed63fadabdb76c8a3f0283a639` |
| `aka_agent_sheet_identity(text,jsonb)` (v299) | `4d94207ec608d4b2b973a53ac0c2a164` | `774d7079692fe25b5fd433c374630d37` |
| `aka_agent_sheet_identity(text,jsonb)` (v300) | `774d7079692fe25b5fd433c374630d37` | `b6e2126aadbf1b9c558dd83e20b7bacd` |

Giữ nguyên các live patch binding tài khoản Zalo, semantic ingest, idempotent ingest, dataset/provenance và enrich profile Zalo. Không sửa body dynamic filter worker (`56510e2f6e8450b684486336e773746d`), semantic ingest wrapper (`357a849364fe21ee3d34876706f18bc2`) hay list members v2 (`221ed55d3a0acbfb6a4f1c1491f0915d`). RPC cũ giữ owner `postgres`, mode/config/ACL như live. V297 có schema reload vì thêm metadata API; v298 chỉ đổi body, không thêm explicit reload.

Security advisors cho object mới có bốn cảnh báo EXECUTE SECURITY DEFINER trên anon/authenticated của hai RPC tenant, là chủ ý theo cơ chế xác thực staff hiện có; đã kiểm tra credential sai, cross-tenant và quyền worker. Không thay ACL legacy hoặc sửa cảnh báo của object ngoài task.

### Sửa chống trùng Facebook — v299

[Migration v299](../migrations/migration_v299_data_group_sheet_facebook_identity.sql) sửa ba trường hợp: giữ nguyên ID `story_fbid`/`fbid` dạng chữ và số (kể cả hoa/thường), ưu tiên URL của contact bài viết đã có cả UID số, và dùng canonicalizer hiện có cho `/people/tên/UID`, `/pages/tên/UID`. Nhờ đó các bài viết khác nhau không bị gộp thành `story.php`, bài viết cũ không bị thêm lại, và UID/link cùng người hoặc Page dùng cùng khóa.

Đọc lại exact signature từ linked production trước khi dựng patch; source checksum khớp v297, không có patch live ngoài repo trên hàm này. Giữ owner `postgres`, `SECURITY INVOKER`, `IMMUTABLE`, `search_path=pg_catalog, public`, ACL `{postgres=X/postgres}`. Dependency `aka_agent_internal_normalize_facebook_identity(text)` giữ checksum `d063c95ebfedc16eeabe4dabf73a211d`. Classifier `f064ef6f96b48aaaac9bcfdf7483bb6b`, claim v298 và finish `163200693b2fb2425d54fd9f3a7eaca3` giữ nguyên body/owner/security/config/ACL sau deploy; thứ tự khóa, token/revision, Zalo binding và ingest không đổi.

Audit lúc deploy ngày 20/09/2026 cho thấy **0 nguồn Sheet, 0 khóa seen**, nên không có dữ liệu cần chuyển đổi hoặc gộp/xóa. Preflight giữ khóa worker hiện có và dừng nếu phát hiện khóa Facebook cũ trước khi thay body, bảo vệ trường hợp có lượt nhập xảy ra sau audit. Không xóa ledger, không sửa lịch/lease, không thêm pool/job và không yêu cầu reload schema vì metadata API không đổi. History ghi vào bảng có sẵn, trong cùng transaction với patch.

Kiểm chứng trước và sau apply: smoke v297 cùng [smoke v299](../migrations/tests/migration_v299_sheet_facebook_identity_smoke.sql) trong transaction `ROLLBACK`; 22 ca canonical identity, preview/nhập thật cho bài viết/người/Page, trùng giữa hai nguồn, replay, contact cũ không đổi, membership bị gỡ và contact bị xóa. Preflight đã được thử với checksum khác và từ chối đúng; postflight xác nhận checksum/owner/ACL/config. Parser smoke, hai typecheck và production build PASS. Security advisors không báo lỗi mới trên hàm đã sửa; các cảnh báo RPC tenant/RPC-only hiện có giữ nguyên. Toàn bộ fixture được rollback; không cần deploy lại Edge vì chỉ thay body SQL và bổ sung test.

### Giữ định danh link và đọc dữ liệu cũ — v300

[Migration v300](../migrations/migration_v300_sheet_post_links_and_legacy_identity.sql) và mapper dùng chung Desktop/Edge giữ `v` của link video, đổi `groups/…?multi_permalinks=…` thành `groups/…/posts/…`. SQL nhận cả link gốc và link chuẩn; watch/video/reel cùng ID, post/permalink cùng ID được chống trùng với nhau. Link chỉ còn trang watch hoặc trang nhóm, thiếu ID hay chứa nhiều `multi_permalinks` được mapper báo không hợp lệ, tránh nhập URL đã mất nội dung đích. Các sửa chữa `pfbid`, UID/URL và people/pages ở v299 được giữ nguyên.

Phone/email dùng cùng thứ tự với ingest/campaign: cột chính → `extra_data.phone/email` → UID chỉ khi `contact_type` đúng phone/email. Đây là đọc tương thích dữ liệu hiện có, không chuyển/xóa `extra_data` hoặc ghi đè contact. Audit read-only trước sửa ghi nhận 8.107 membership SĐT có cột phone trống và giá trị trong extra_data; chưa phát hiện sai khóa với số hợp lệ trong tập này vì nhánh UID cũ vẫn nhận diện được. Regression fixture riêng bao phủ UID hồ sơ khác số điện thoại/email, là ca khiến classifier cũ bỏ sót trùng.

Đã đọc lại exact signature/metadata live trong lượt sửa; checksum nguồn khớp v299, không có patch live bổ sung. Giữ owner `postgres`, invoker/immutable/search_path/ACL và toàn bộ classifier, claim v298, finish; không thêm connection, cron hoặc polling. Preflight khóa worker và dừng nếu có khóa seen của phone/email/post cần chuyển đổi. Lúc apply có 0 nguồn Sheet và 0 khóa seen, không có dữ liệu cần backfill. History ghi trong transaction hiện có, không tạo DDL chuẩn bị và không explicit reload schema.

Triển khai: apply SQL và tạm dừng dispatcher trong cùng transaction, deploy riêng Edge version 2, tải lại source và đối chiếu cả entrypoint/shared mapper, xác minh anonymous HTTP 401 và Vault → pg_net → Edge HTTP 200 (`skipped` với token không claim), rồi khôi phục dispatcher về enabled=true như trước. Không đổi cơ chế xác thực hoặc secret.

Kiểm chứng PASS: parser và các URL chuẩn hóa/ID khác nhau/alias/URL thiếu định danh; [smoke v300](../migrations/tests/migration_v300_sheet_identity_smoke.sql) gồm 26 ca khóa và luồng preview → claim → nhập thật cho post/phone/email, trùng với contact cũ, không sửa contact, replay, không thêm lại membership đã gỡ. Smoke v297/v299/v300 chạy trước và sau deploy trong transaction ROLLBACK; metadata/checksum/ACL và dependency được đối chiếu sau apply. Hai typecheck, production build và `npx --yes deno check --no-lock --node-modules-dir=none supabase/functions/aka-agent-google-sheet-sync/index.ts` đều qua. Security advisors không có finding trên hàm đã sửa; fixture được rollback và dispatcher đã bật lại.

### Chuẩn hóa SĐT và index lịch sử — v301 / Edge v3

Mapper gọi trực tiếp hàm hiện có tại `src/shared/phone.ts`, thay regex riêng. Import có đuôi `.ts` để CLI đưa dependency vào gói Edge; hai tsconfig dùng `rewriteRelativeImportExtensions` để TypeScript hỗ trợ module dùng chung và đổi đuôi khi emit. Không sửa quy tắc chuẩn hóa chung hoặc RPC SQL. [Audit v301](DATA_GROUP_SHEET_V301_AUDIT.md) ghi lại query plan, checksum và kiểm chứng deploy.

[Migration v301](../migrations/migration_v301_data_group_sheet_running_index.sql) chỉ thêm partial index `(source_id, started_at) WHERE status='running'` trên lịch sử lượt chạy, hỗ trợ hủy/phục hồi mà không quét lịch sử đã hoàn tất. Index lịch đến hạn, nguồn theo nhóm, 30 log gần nhất và seen ledger đã có; các query contact/member được kiểm tra đang dùng index hiện có. Không thêm index lớn vào bảng contact, không thay RPC/cron/pool/connection, không reload schema. Trên bảng lịch sử đang nhỏ, planner có thể vẫn chọn seq scan; đây là bổ sung cho lúc lịch sử tăng, không phải cam kết tăng tốc đã benchmark với dữ liệu lớn.

## Kiểm chứng

- `node scripts/google-sheet-sync-smoke-test.cjs`: RFC4180 có comma/newline/quotes/BOM, UID dài, SĐT thiếu/có `0` đầu, mã nước/đầu số cũ/số mũ, Sheet rỗng, quyền/gid lỗi, redirect host, đổi cột, giới hạn dòng/byte, canonical mapping các loại.
- `migrations/tests/migration_v301_sheet_phone_running_index_smoke.sql`: rollback trước/sau apply; hai SĐT được preview/nhập/ghi đúng, chống trùng trong lượt và giữa nguồn, replay, phục hồi lượt lỗi, pause/delete làm token cũ mất hiệu lực; index dùng được cho cả truy vấn phục hồi và hủy. Fixture ưu tiên lịch của chính nó và giữ khóa worker, không đổi lịch nguồn thật.
- `migrations/tests/migration_v297_data_group_google_sheet_sync_smoke.sql`: chạy trong transaction rollback trước/sau apply; tenant/password/ACL, preview không ghi, nhiều nguồn/cùng lượt trùng, token claim một lần, finalize replay, pause/delete in flight, CAS, contact cũ không đổi, removed/deleted data, retry 5/15/60, ngày dừng VN, expired lease recovery, Zalo binding/revision, source filter, campaign nhận target mới.
- `node scripts/run-google-sheet-sync-ui-smoke.cjs`: real React manager với IPC fixture; thêm/sửa/bật-tắt/xóa, preview không save, lỗi/retry/loading, source filter, tự kết nối khi sửa, xem trước lỗi không giữ kết quả cũ, theo dõi lượt đầu có giới hạn và tự cập nhật data; dừng theo dõi khi ẩn/rời tab/lỗi/tạm dừng, bỏ phản hồi cũ; panel372/form520, dialog cửa sổ740px và focus bàn phím. Kiểm tra trực quan thêm bằng agent-browser ở theme sáng và tối; không dùng ảnh làm UI.
- `node scripts/run-data-group-zalo-ui-smoke.cjs`: regression layout/resize/fullscreen, form nhóm, binding, filter động và stale response PASS.
- Hai typecheck (`tsconfig.node.json`, `tsconfig.web.json`), `deno check` cho Edge và `npm run build`: PASS. Build còn cảnh báo cũ về DataScanModal vừa static vừa dynamic import.
- Hai transaction đồng thời: một transaction giữ khóa lease toàn hệ thống, dispatcher thứ hai bỏ qua ngay bằng `SKIP LOCKED`, không enqueue thêm request; cả hai rollback.
- HTTP production: anonymous Edge 401; Vault → pg_net → Edge 200; RPC credential sai bị chặn, anon không gọi được worker. Đọc thật Sheet công khai 15 dòng bằng parser dùng chung.

- **Cloud end-to-end qua cron thật, không dùng Desktop IPC:** nhóm fixture nội bộ chỉ chứa Sheet công khai. Lượt đầu 15 dòng → 11 mới, 4 không hợp lệ; lượt tiếp theo 0 mới, 11 trùng, 4 không hợp lệ. Khoảng lịch sau lượt thành công đúng 6 giờ. Đã dọn nhóm/nguồn/contact/log fixture sau kiểm tra; dispatcher production đang bật. Không thử bằng Sheet riêng tư của người dùng.

Chạy SQL smoke sau deploy bằng cách bọc nội dung fixture bằng `BEGIN; … ROLLBACK;`. Fixture không gọi Google, không chạy campaign và không gửi tin nhắn.

## Vận hành và rollback

Để ngừng dispatcher và vô hiệu hóa lượt chưa commit, giữ toàn bộ data đã nhập:

```sql
UPDATE public.auto_data_group_sheet_worker_state
SET enabled=false,token=NULL,lease_expires_at=NULL WHERE id;
```

Bộ lọc động vẫn chạy trong job cũ. Một transaction import đã commit trước khi lệnh dừng lấy được khóa được giữ nguyên. Không drop bảng/ledger hoặc lấy body ingest từ migration lịch sử để rollback. Muốn bật lại sau khi xác minh worker:

```sql
UPDATE public.auto_data_group_sheet_worker_state
SET enabled=true,next_dispatch_at=now() WHERE id;
```

Tài liệu cơ chế: [Google public spreadsheets](https://developers.google.com/chart/interactive/docs/spreadsheets), [Supabase schedule Edge Functions](https://supabase.com/docs/guides/functions/schedule-functions).
