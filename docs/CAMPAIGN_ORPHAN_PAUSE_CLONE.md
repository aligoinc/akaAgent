# Dừng và nhân bản chiến dịch có tài khoản đã xóa — 19/10/2026

## Nguyên nhân và phạm vi

Task ngày 04/09, “Kiểm tra lỗi bằng query DB”, đã sửa maintenance Desktop/Server và sửa/xóa trên WebApp (Desktop PR #374, Web PR #37). Bản sửa đó có trong `dev_3` nhưng chưa bao phủ hai luồng Desktop này:

- IPC kiểm tra tài khoản qua `getAccount()` trước khi xét dừng; tài khoản bị soft-delete trả `null` và bị báo nhầm là không phù hợp gói. RPC Desktop cũng từ chối account đã xóa/inactive trước khi xét pause.
- Form nhân bản kế thừa ID tài khoản nguồn. Effect cố bảo toàn ID lúc catalog chưa đầy đủ nhưng không loại ID thật sự đã biến mất sau khi tải thành công; chọn tài khoản mới có thể giữ cả ID cũ vô hình.

Desktop đọc đúng ba trường định tuyến tài khoản khi dừng, vẫn lọc staff và dùng cùng HTTP client/lượt đọc hiện có. Tài khoản Server đã xóa vẫn đi qua RPC Server; Desktop giữ nguyên scheduler, latch dừng mềm, token/CAS và kiểm tra quyền. Tiếp tục vẫn dùng `getAccount()` cùng guard entitlement cũ. Không tự khôi phục tài khoản, chuyển tài khoản nguồn hay xóa claim/unit.

Form nhân bản chỉ bỏ ID chính/phụ mất khỏi catalog sau snapshot thành công (`accountCatalogVersion`, hết `loadingAccounts`); `accountsReadAt` không chứng minh thành công vì cũng tăng khi lỗi. Catalog chưa tải/thất bại giữ lựa chọn và chặn lưu. Tài khoản còn hợp lệ và chọn nhiều tài khoản được giữ; thiếu tài khoản khi lưu được báo trước khi tạo bất kỳ campaign nào. Chiến dịch nguồn, nội dung và data không bị ghi lại. Nút Lưu vẫn chọn Tạm dừng/Chờ xử lý theo hợp đồng hiện có.

## RPC và production

Đã apply vào **akachat / `cgjbsmqtfhqvttudyjzq`**, history **`20261019130317 / campaign_orphan_pause`**. File tạo bằng Supabase CLI, sau apply được đồng bộ tên timestamp với history MCP. Không apply lại.

| Signature chính xác (`public`) | MD5 nguồn | MD5 sau sửa |
| --- | --- | --- |
| `aka_agent_set_desktop_campaign_status_v2(bigint,bigint,bigint,text)` | `861b73d8875f871139cf31ac165cf959` | `ba5a4107bf5adcbe13dee5834c644171` |
| `aka_agent_set_zalo_server_campaign_status(bigint,bigint,text)` | `d13304a4900035696adc468abf3629ed` | `8811f009a969f2ce8dda19df95a8c614` |

Body nguồn live khớp logic V234 (Desktop) và V219 (Server); khác biệt chỉ là format `pg_get_functiondef`. Giữ nguyên cả ghi chú chờ data V210, queue tài khoản đang chạy V234, ownership, thứ tự lock, claim/unit guard, signature/response, owner `postgres`, SECURITY INVOKER, volatility, search_path và ACL. Chỉ bỏ điều kiện tài khoản deleted/inactive đối với pause Desktop; Server chỉ bỏ điều kiện deleted đối với pause, vẫn giữ capability/runtime ownership. Resume vẫn bị từ chối với tài khoản đã xóa.

Migration có preflight checksum fail-closed cho cả hai signature. Không thêm schema/RPC/pool/polling, không đổi quota, không yêu cầu reload schema. Không sửa dữ liệu khách hàng.

- [Migration](../supabase/migrations/20261019130317_campaign_orphan_pause.sql)
- [Snapshot trước](../migrations/snapshots/campaign-orphan-pause/before.json), [dry-run](../migrations/snapshots/campaign-orphan-pause/dry-run.json), [snapshot sau](../migrations/snapshots/campaign-orphan-pause/after.json)
- [Rollback có preflight](../migrations/snapshots/campaign-orphan-pause/rollback.sql): đã chạy thử trong transaction rồi rollback, checksum hai hàm trở về đúng nguồn trong transaction; production giữ bản vá. Chỉ dùng sau khi đối chiếu live; khôi phục body nguồn, không đổi ACL. Rollback DB khiến Desktop mới tiếp tục bị chặn tại RPC khi account đã xóa. Xem [receipt](../migrations/snapshots/campaign-orphan-pause/receipt.json).

## Kiểm chứng

- Hai typecheck `tsconfig.node.json` và `tsconfig.web.json`: sạch.
- `npm run build`: thành công; chỉ cảnh báo bundler về import tĩnh/động hiện có.
- `node scripts/campaign-orphan-pause-smoke.cjs`: tái hiện DB cũ từ chối; callback IPC thật → scheduler thật → PostgreSQL/PGlite; guard resume, Server route, lỗi DB, account read theo staff/chỉ ba cột, tài khoản inactive/khỏe, ghi chú chờ data.
- [21 ca SQL](../migrations/tests/campaign_orphan_pause_smoke.sql): QR/Web/Server; pending/running/paused/completed; không cho resume tài khoản deleted; giữ route, parent claim, unit lease, account/staff và deleted campaign guards. Đã chạy trong transaction rollback trên production trước và sau apply; chỉ thay fixture ID dành riêng. Xác nhận 0 staff/account/campaign fixture còn lại.
- `node scripts/campaign-orphan-clone-ui-smoke.cjs`: 8 ca bằng menu/form Electron thật, chặn toàn bộ HTTP mạng: tài khoản nguồn deleted; nguồn và phụ deleted; chỉ phụ deleted; chọn nhiều tài khoản; nguồn còn hợp lệ; tải chậm có tài khoản; tải chậm trả rỗng; tải thất bại. Xác nhận create đúng ID, lưu đủ data, không ghi nguồn hay resume ngoài ý định.
- `node scripts/campaign-pause-note-smoke-test.cjs`: same-claim CAS, late response, resumed run và pause note guards đạt.
- `node scripts/run-campaign-edit-ui-smoke.cjs`: sửa/lưu, xác nhận pause, hủy, retry activation và SMS/voice partial-save đạt.

DB đã cập nhật. Desktop cần build/đóng gói và phát hành bản mới để nhận cả sửa IPC và form. Lượt này chỉ production build local, chưa đóng gói installer, chưa phát hành; không deploy Web/Chat/Server.

## Sửa finding runtime mất chủ và Web clone — 19/10/2026

Review tái hiện chiến dịch Desktop `đang chạy`, account đã xóa, không còn local boundary và cả `runtime_claim_token`/`runtime_unit_token` đều NULL. Bản sửa đầu chỉ đặt latch RAM; RPC vẫn từ chối mọi trạng thái đang chạy nên không có runtime nào hoàn tất pause.

Scheduler nay gọi RPC điều khiển hiện có khi không có local owner/failed run. RPC chỉ cho chuyển running → paused nếu **account đã soft-delete và cả hai DB lease đều không còn**. Account còn tồn tại (kể cả inactive) vẫn bị chặn khi đang chạy. RPC giữ khóa staff, khóa serialization, khóa campaign/account và predicate tại UPDATE. Local owner vẫn đi qua pause mềm theo token; nếu runtime khác giành claim trước RPC thì không đổi trạng thái/token. RPC lỗi không để lại latch orphan. Không tự thu hồi claim/unit, không recovery hàng loạt hoặc thêm polling/connection.

Đã apply trên **akachat / `cgjbsmqtfhqvttudyjzq`**, history **`20261019133105 / campaign_orphan_running_pause`**; không apply lại. Chỉ sửa `public.aka_agent_set_desktop_campaign_status_v2(bigint,bigint,bigint,text)`:

- MD5 nguồn: `ba5a4107bf5adcbe13dee5834c644171`.
- MD5 sau sửa: `f8b736faac1c365999f6741054f08680`.
- Giữ các bản vá V210/V234 và `campaign_orphan_pause`, owner `postgres`, SECURITY INVOKER, volatility `v`, search_path, ACL, quyền staff/tenant và resume. RPC Server giữ MD5 `8811f009a969f2ce8dda19df95a8c614`, không sửa trong lượt này.
- [Migration](../supabase/migrations/20261019133105_campaign_orphan_running_pause.sql), [snapshot nguồn](../migrations/snapshots/campaign-orphan-running-pause/before.json), [dry-run](../migrations/snapshots/campaign-orphan-running-pause/dry-run.json), [snapshot sau](../migrations/snapshots/campaign-orphan-running-pause/after.json), [receipt](../migrations/snapshots/campaign-orphan-running-pause/receipt.json).
- [Rollback có preflight](../migrations/snapshots/campaign-orphan-running-pause/rollback.sql) đã diễn tập trong transaction rollback; khôi phục bản vá đầu, không hoàn nguyên toàn bộ sửa orphan pause.

Kiểm chứng: 26 ca SQL rollback trước/sau apply, 0 fixture staff/account/campaign còn lại; tái hiện lỗi trước sửa và IPC thật → scheduler thật → PGlite sau sửa; race có owner mới, lỗi RPC, resume/Server route/ownership guards. Smoke pause-note và Facebook random-run boundaries đạt. Hai typecheck và production build Desktop đạt. Security advisors không có finding cho RPC này; 9 finding có sẵn ngoài phạm vi không bị thay đổi trong lượt này.

WebApp **không bị finding runtime mất chủ** vì dùng RPC Server cập nhật trạng thái trực tiếp. Web có lỗi riêng ở clone: effect bỏ tài khoản nguồn chỉ chạy khi edit, và clone hydrate lại ID cũ sau khi data tải xong. Đã sửa repo `akaAgentWebApp`: chỉ bỏ ID nguồn không còn sau catalog thành công, theo dõi lựa chọn để xử lý data đến muộn, giữ các tài khoản mới hợp lệ; lỗi catalog hiển thị Thử lại và không cho Lưu. Không carry tài khoản phụ sang clone, không ghi chiến dịch nguồn. Typecheck 7 workspace, production build và 21 ca browser (15 orphan clone + 6 edit/activation trên Desktop/Android/iPhone) đạt. Một ca WebKit cũ gặp access-control error của request bị hủy trong lần chạy song song; chạy lại riêng đạt. Fixture lỗi tải account dùng đúng envelope `message` và các ca retry đạt cả ba profile.

**Trạng thái bàn giao:** DB đã cập nhật; source Desktop/Web đã sửa, build local và được đưa vào hai PR riêng. Chưa đóng gói/phát hành Desktop hoặc deploy Web. Chat API/Server không cần thay đổi cho hai sửa này. Không apply lại hai migration khi merge hoặc phát hành; chữ ký và kết quả RPC giữ nguyên để app cũ tiếp tục gọi được, còn sửa IPC/form cần cập nhật ứng dụng.
