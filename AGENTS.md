# akaAgent — hướng dẫn cho agent

Đây là quy tắc làm việc hiện hành, không phải nhật ký triển khai.
Lịch sử và hợp đồng chi tiết ở `docs/agents/`; phải đọc phần liên quan trước khi sửa/review.

## Bắt đầu mỗi task

1. Đọc lại file này từ checkout đang làm việc; kiểm tra `git status` và nhánh hiện tại.
2. Đọc [mục lục theo phạm vi](docs/agents/README.md), rồi đọc các mục phù hợp với task.
3. Task DB, quyền, auth, deploy hoặc build phát hành phải đọc [trạng thái hiện tại](docs/agents/CURRENT_STATE.md).
4. Tìm tên file/RPC/action/feature trong [chỉ mục chi tiết](docs/agents/REFERENCE_INDEX.md), `docs/agents/reference/` và audit được dẫn tới; đọc [lịch sử](docs/agents/history/) khi cần quyết định hoặc rollout cũ.
5. Quy tắc nghiệp vụ trong tài liệu liên quan vẫn phải giữ. Đọc ghi chú “Hướng dẫn hiện hành” trước vùng `PRESERVED SOURCE`: ghi chú thay thế chỉ áp dụng đúng phần được nêu. Lịch sử “chưa apply/deploy”, quyền legacy hoặc test cũ không thay thế audit mới hơn và trạng thái live.
6. Nếu thiếu tài liệu/source riêng cần thiết, nêu phần chưa xác minh; không dựng lại source production từ migration cũ.

## Git và phạm vi công việc

- Repo: `https://github.com/aligoinc/akaAgent`; PR target **`dev_3`**.
- Trước task mới, fetch remote và đồng bộ nền `dev_3` bằng fast-forward/rebase phù hợp; giữ thay đổi chưa commit, không reset/ghi đè công việc khác.
- Giữ nguyên chức năng, định dạng dữ liệu, query/timeout và quyết định người dùng ngoài phạm vi được yêu cầu.
- Phân biệt sửa source, build local, phát hành bộ cài, deploy service và apply DB. Hoàn tất một bước không có nghĩa các bước khác đã chạy.
- Không tự apply lại migration đã live hoặc rollback mở quyền. Merge PR không phải chỉ thị deploy/apply.

## Supabase, RPC và quyền — bắt buộc

- Production duy nhất: **akachat — `cgjbsmqtfhqvttudyjzq`**. Kiểm tra ref trước thao tác DB; ưu tiên linked/Management API hiện có.
- **Không query/mutate `yfkvwgapqmywaoftwuzc`** (`aka_agent`, project legacy/khác). Không chọn project chỉ theo tên.
- Mọi tạo/sửa/review/apply RPC hoặc `CREATE OR REPLACE`, `DROP`, `ALTER FUNCTION` phải dùng [safe-supabase-rpc-migration](.agents/skills/safe-supabase-rpc-migration/SKILL.md).
- Đọc exact signature live bằng `pg_get_functiondef`; lưu checksum, owner, ACL, security mode, volatility và config trước khi dựng SQL. Tìm mọi migration liên quan để giữ patch mới hơn.
- Candidate phải có preflight checksum fail-closed, kiểm thử transaction kết thúc ROLLBACK, hậu kiểm body/quyền/timeout và rollback phù hợp. Drift thì dừng đối chiếu, không sửa checksum để vượt guard.
- `auto_blocks`/`auto_workflows`/`auto_elements` lấy row live làm nguồn chuẩn; capture/checksum trước sửa, không lấy body/config lịch sử làm mặc định. Không có `seedV2` runtime fallback.
- Migration versioned theo `migrations/migration_v<N>_<mo_ta>.sql`: kiểm tra N trước; không nhân đôi SQL sang `supabase/migrations` hoặc đổi history chỉ vì chuyển file. Giữ nguyên migration timestamp đã tồn tại và đối chiếu ledger theo audit.
- Chỉ reload PostgREST khi API metadata thay đổi hoặc cache đã xác nhận bị cũ. Seed dữ liệu/code block đơn thuần không cần reload; kiểm tra cả DDL phụ của công cụ apply. Không tự tắt trigger reload chung.
- Giữ giới hạn hiện hành: anon đã bị thu hồi trong phạm vi akaAgent; token Desktop bị giới hạn theo staff, không đọc AI key, không ghi định nghĩa block/workflow. Bootstrap/updater có ngoại lệ hẹp; xem CURRENT_STATE.
- Kiểm tra quyền của **tất cả caller/role**, kể cả HTTP phụ và `aka_agent_chat_api`; BYPASSRLS không thay SELECT/EXECUTE. Giữ ACL entrypoint chưa đủ nếu helper/view thiếu quyền.
- Không mở rộng SELECT/EXECUTE hoặc SECURITY DEFINER để che lỗi thiếu quyền; sửa đúng luồng, giữ guard hiện có.

## Connection và timeout

- **Phải trình bày và được người dùng đồng ý trước khi thêm nguồn SQL connection hoặc tăng tổng ngân sách connection.** Yêu cầu tính năng không mặc nhiên cho phép tăng connection.
- Bao gồm `pg.Client`/`pg.Pool`, pool riêng, listener/job giữ kết nối, `pool.max`, pooler/Postgres limit và thêm process/worker/replica. Không tạo pool/connection theo request, event, account hoặc staff.
- Trước đề xuất: kiểm tra cơ chế hiện có; nêu số hiện tại/tối đa trên mọi replica, thời gian giữ/release/timeout và cách tái sử dụng. Phân biệt client pooler với backend Postgres; chưa biết phải nói rõ.
- HTTP/Data API/RPC vẫn dùng tài nguyên DB. Không tự tăng pool để chữa timeout. Query/reconnect trong cơ chế và giới hạn đã chấp thuận không cần xin lại từng lần.
- RPC bulk/paging/materialize/export phải giữ function-local `statement_timeout=60s`; caller/Edge phải cho đủ ngân sách server. Ngoại lệ đã có: `aka_agent_save_upload_contact_datasets=120s`.
- Giữ overload ingest 60s, tối đa 10.000 rows/request; không tăng timeout global anon/authenticated. Workload quá 60s phải chia batch/background, không kéo request đồng bộ vô hạn.
- Poll/claim/control nhẹ giữ timeout ngắn hiện có; bulk định kỳ phải single-flight/lock. Không thêm polling/connection khi tái sử dụng được cơ chế hiện có.

## Source và dữ liệu bảo mật

- Source Edge cấp token có chặn IP, migration IP, hồ sơ điều tra và full capture riêng nằm ngoài Git: `$HOME/.codex/incident-recovery/akaAgent-ip-block/`, hoặc `AKA_AGENT_PRIVATE_SECURITY_DIR`.
- Không đưa chúng trở lại repo; script dùng `privateSecurityAsset`. Không deploy endpoint từ Git cũ vì mất quy tắc chặn. Đọc [README source riêng](supabase/functions/aka-agent-desktop-session/README.md) và đối chiếu live trước sửa.
- Backend credential chỉ dành cho máy chủ quản lý. Bộ cài Server nội bộ có credential không được commit/upload công khai hoặc đưa vào Desktop.
- Credential xác thực staff/RPC, raw session Zalo, cookie runtime và provider key không trả qua preload/renderer hoặc log; giữ ở main/backend, không đưa vào `AuthUser`. Ngoại lệ hiện có: username/password **tài khoản SMS** được trả để hiển thị thông tin đăng nhập app mobile; không bỏ chức năng này khi sửa bảo mật. Xem [phạm vi credential](docs/agents/CLIENT_CONTRACTS.md#sms-credentials).
- Desktop AI đi qua proxy backend; giữ che key, đường dẫn riêng và base64 trong AI log/context.
- Token mất mạng/sleep giữ luồng lỗi cũ và phục hồi phiên; không tự thêm popup đăng nhập/kết nối hoặc fallback yếu hơn. Recovery máy giữ proof/CAS/receipt/journal, không bootstrap bằng fingerprint đơn thuần.

## Kiến trúc và hợp đồng runtime

- Electron main (`src/main`) xử lý DB, IPC, scheduler/browser; preload (`src/preload`) là bridge; React renderer (`src/renderer/src`) gọi `electronAPI`; type/event chung ở `src/shared`.
- Repository dùng `getSupabaseClient()` và `requireCurrentUser()`, mapper snake_case → camelCase. Không đưa DB client, credential staff/RPC hoặc xử lý runtime vào renderer; giữ ngoại lệ hiển thị credential SMS nêu trên.
- Workflow engine **v2** là engine campaign; built-in sống trong DB. Campaign chạy hidden/offscreen qua BackgroundPageManager, không chuyển sang webview hiển thị để sửa lỗi.
- Block phải atomic, compose primitive có sẵn; không tạo block làm nhiều việc. Giữ thứ tự side effect, receipt, idempotence và bằng chứng đã gửi/không rõ kết quả.
- Không retry thao tác đã commit hoặc có kết quả gửi không chắc chắn. Giữ claim/unit/ownership đến khi cleanup xác nhận; lỗi log/policy không làm mất khóa trước producer dừng.
- Dùng DB clock cho scheduling/quota theo hợp đồng; giữ scope staff/org, input identity, lock order, cooldown và semantics legacy/explicit.
- Zalo QR/Web/Server route theo **từng account**, không theo flag staff legacy. Desktop tenant Chat dừng App Server client và dùng Chat API; WebApp có luồng socket riêng, không suy cấu trúc kết nối giữa hai app. Xem [phạm vi Chat](docs/agents/CLIENT_CONTRACTS.md#chat-routing).
- Data Group giữ membership ID, semantic type, provenance, bundle và API idempotent; không thay bằng cập nhật bảng trực tiếp. Chia sẻ không cho người nhận sửa nguồn.
- Không dùng `updated_at` runtime làm phiên bản cấu hình form. Giữ revision/CAS, chống phản hồi phiên cũ, draft và lựa chọn khi lỗi mạng.

## Facebook, UI và log

- Khi user đưa C# Selenium đã chạy đúng, dùng [csharp-fb-dom](.agents/skills/csharp-fb-dom/SKILL.md): giữ XPath/root/thứ tự/click/scroll/sleep; trình bày bảng đối chiếu trước implement. Khác DOM phải có chỉ thị/đồng ý của user, không tự thêm heuristic/fallback.
- Không thêm DOM/selector để tự động login Facebook; managed login/restore hiện có dùng HTTP. Thay đổi phiên/login phải đọc hợp đồng riêng trong mục lục.
- Không dùng tọa độ viewport cho hidden webview; giữ editor/dialog scope và media settle delay hiện có. Ưu tiên selector/element DB đã xác nhận.
- DB status là tiếng Việt có dấu; campaign và input-data không có status `lỗi`. Lỗi action nằm ở detail; không tự đổi enum/cách đếm.
- Log khách hàng phải ngắn, tiếng Việt, không lộ stacktrace/debug/secret. Giữ policy-rendered log, milestone, emoji và thứ tự action → metadata → link → tổng kết.
- Emoji ngoài log chỉ thêm khi user yêu cầu. Không cắt hỏng surrogate pair; không sửa dữ liệu lịch sử để hợp log mới.
- Renderer mutation cần busy/disable và mutex khi có async pre-work; lọc phản hồi theo phiên/request. Không unmount hoặc chuyển state tiến trình lên form làm mất UI/nháp.
- Phân trang/lọc/chọn/xuất phải dùng cùng scope backend; không chỉ lọc RAM trên trang hiện tại hoặc bỏ ID đã chọn ngoài trang.

## Lệnh và kiểm chứng

```bash
npm install
npm run dev
npx tsc --noEmit -p tsconfig.node.json
npx tsc --noEmit -p tsconfig.web.json
npm run build
npm run build:win
npm run build:mac
npm run build:mac:intel
npm run build:server:win
```

- Hai typecheck phải sạch; dùng smoke phù hợp trong `scripts/`/audit, không giả định có lệnh `npm test` hoặc lint chung.
- Trước push/PR dùng [source-command-verify-pr](.agents/skills/source-command-verify-pr/SKILL.md): kiểm tra phạm vi Git và tài liệu; thay đổi code/build chạy hai typecheck và build production, chỉ tài liệu dùng nhánh kiểm tra docs của skill.
- Windows phải dùng wrapper `build:win`/`build:server:win` để chuẩn bị native `better-sqlite3` đúng kiến trúc và khôi phục host; không chạy thẳng `electron-builder --win` sau build Mac.
- Verifier Server dùng executable/profile Server; hook installer Desktop phải gate theo `PRODUCT_NAME == akaAgent`. Không áp dependency contract Desktop cho Server.
- Build local không đồng nghĩa đã upload/phát hành. Giữ bộ cài, checksum, kiến trúc/chữ ký và giới hạn kiểm chứng trong audit riêng.
- Chỉ thay docs thì kiểm tra nội dung, link, diff và tính bảo toàn; không cần build app vì sửa tài liệu.

## Code Review Rules

- Flag hồi quy quyền theo caller, lộ credential, đổi timeout/format query, mất ownership/receipt/cleanup hoặc thay quyết định người dùng ngoài phạm vi.
- RPC/DB review phải đối chiếu live và patch mới hơn; kiểm tra đúng role, cross-staff, rollback và cancellation khi liên quan.
- Không coi typecheck/mock pass là bằng chứng UI, Windows thật, HTTP production hoặc side effect đã hoạt động; báo đúng phạm vi đã kiểm thử.

## Duy trì tài liệu

- AGENTS.md chỉ giữ quy tắc chung và đường dẫn; mục tiêu dưới **20 KiB**, không chèn nhật ký build/apply vào đầu file.
- Thay đổi kiến trúc/hợp đồng/pitfall: cập nhật guide liên quan và mục lục. Trạng thái đã triển khai: cập nhật CURRENT_STATE kèm audit/receipt. Timestamp/checksum/log/test dài nằm trong audit feature.
- Giữ thông tin có giá trị, ghi rõ lịch sử và trạng thái bị thay thế. Không sửa archive nguyên văn hoặc coi archive là trạng thái live.
- Xem [bảo trì và cách task khác nhận hướng dẫn](docs/agents/MAINTENANCE.md). Checkout/worktree khác cần sync; task đang chạy phải đọc lại file mới trước khi dựa vào nó.
