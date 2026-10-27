# Desktop AI qua akaAgentWebApp — 27/10/2026

## Trạng thái

**V434 đã apply akachat lúc 22:53:15 VN ngày 27/10/2026 (`20261027155315 / migration_v434_desktop_ai_proxy_identity`); API đã deploy lúc 22:55:46 VN.** Health 1/1, 27 HTTP và kiểm chứng runtime/RPC đạt. Canary phiên Desktop thật đã đạt lúc 23:01–23:04 VN, xem [kết quả](#canary-phiên-desktop-thật--27102026); chưa đóng gói/phát hành Desktop. Không thu hồi quyền anon/token, không bật hoặc đổi RLS, không xoay key AI. Những migration token/quyền đã apply trước đó giữ nguyên. Xem [audit production](#apply-v434-và-deploy-api--27102026).

Theo yêu cầu tiếp theo, **Fly đã nâng từ 1 shared CPU/512 MB lên 2 shared CPU/2 GB** trên machine hiện có `48ee749f357398`; image và toàn bộ cấu hình khác giữ nguyên, health 1/1. Code đã sửa hai finding nhận body trước Auth và chia đôi emoji; thay từ chối ngay ở lượt 33 bằng hàng chờ có hủy. Audit tài nguyên ở repo WebApp: `docs/DESKTOP_AI_CAPACITY_20261027.md`.

Review tiếp đã sửa giữ lại body sau khi request hoàn tất: cleanup bỏ tham chiếu payload trước khi trả admission. Probe Node 22 đạt 353 request, trong đó 160 request 8 MiB qua mười đợt liên tiếp; heap sau GC dưới 18.3 MiB, RSS đỉnh khoảng 951 MiB. Đối chứng bỏ bản sửa trong bundle tạm bị test phát hiện ở mức khoảng 442 MiB heap. Toàn API 1.317 test, 16 HTTP parity, bảy typecheck và production build WebApp đạt. Receipt mới `migrations/snapshots/desktop-session-rls/ai-proxy-body-cleanup-verification.json`; các receipt trước là lịch sử. Không đổi timeout/query/giới hạn hoặc triển khai production trong bản sửa này.

Desktop mới cần API mới trước khi sử dụng AI, kể cả chạy dev từ source. Không fallback về gọi provider trực tiếp nếu API chưa sẵn sàng. Quyền đọc `ai_model.api_key` trên production vẫn còn theo yêu cầu trì hoãn cutover: việc đổi source chưa ngăn người dùng tự lấy key qua Data API bằng quyền cũ.

## Luồng và hợp đồng

`aiRepository` đọc cùng cấu hình nhưng dùng projection model không có `api_key` cho Desktop. Các trường ID, provider/model, endpoint, default body, tổ chức, cờ và timestamp giữ nguyên. Trusted App Server dùng khóa backend riêng vẫn đi đường gọi provider cũ.

`aiRuntimeService` giữ bộ dựng request, prompt/schema/options, chọn Responses/chat/native Claude, ảnh, parser, response path, usage và ghi `ai_log`. Chỉ thay bước gửi HTTP bằng `desktopAiTransport`:

1. Lấy JWT từ `desktopSession.token(signal)` hiện có.
2. POST `https://agent.akabiz.net/api/aka-agent/desktop/v1/ai`, gửi `usingCode`, `usingId` hoặc `formConfigId`, `modelId` và body đã dựng. Không gửi staff, tổ chức, URL hay key provider. `AKA_AGENT_AI_API_URL` chỉ là override môi trường cho kiểm thử/triển khai riêng.
3. API xác minh JWT qua Supabase Auth, kiểm subject/role và đối chiếu session còn tồn tại bằng RPC chỉ dành cho backend. Không tin JWT decode trước khi Auth xác nhận.
4. API đọc cấu hình/model/key qua Supabase singleton hiện có. Cấu hình active, ID/code/model phải khớp; cấu hình legacy ưu tiên đúng tổ chức rồi global, form dùng cấu hình Desktop và model global. Endpoint chỉ từ DB, HTTPS, không credentials trong URL, không redirect.
5. API chuyển tiếp nguyên JSON body tới provider, trả status/body để Desktop dùng parser cũ. Chỉ thêm marker `x-aka-ai-provider-response: 1`, không trả header provider. Key bị che nếu provider echo trong body, kể cả bị chia giữa các chunk; chuỗi UTF-8 được ghép đúng.

API không áp schema/prompt nghiệp vụ mới lên nội dung yêu cầu. Người có token hợp lệ vẫn có thể tự gọi AI với model/cấu hình được phép và body tùy chỉnh; đây chưa phải cơ chế chống lạm dụng chi phí hoặc chứng thực ứng dụng. Không thêm quota/thông báo UI. Lỗi ở proxy dùng nhánh lỗi mạng `fetch failed` hiện có, lỗi từ provider giữ status/nội dung đã che key. Không retry/fallback để tránh gọi AI tính phí hai lần.

Model/config thay đổi trong lúc Desktop đang giữ snapshot sẽ bị từ chối thay vì gửi body cũ bằng key/model khác. Đây là kiểm tra tại ranh giới giữ secret; không sửa dữ liệu hoặc query nghiệp vụ chiến dịch.

## Timeout, hủy và tài nguyên

- Desktop giữ timeout từ DB (mặc định 120 giây), cùng signal hủy; ngân sách này bao gồm lấy token và đi qua API. Độ trễ Auth/API là phần bổ sung thực tế, không thể cam kết tổng thời gian bằng gọi trực tiếp.
- API có ngân sách 12 giây cho mỗi bước xác thực/đọc cấu hình, ngoài thời gian chờ được cấp lượt. Provider dùng phần còn lại của timeout cấu hình tính từ khi nhận request, gồm cả chờ/upload; không ép xuống trần 120 giây của Web form. Giai đoạn trước khi có cấu hình có deadline 300 giây để socket dở dang không giữ chỗ mãi. RPC identity có `statement_timeout=10s`.
- Chỉ đọc aggregate production: 38 legacy config active, 10 Desktop form active; timeout tối đa lần lượt 300/120 giây, legacy tenant override active = 0. Không đọc key hoặc nội dung khách để audit.
- Fly đã áp dụng HTTP idle timeout 600 giây để không cắt sớm cấu hình 300 giây. Giữ 2 shared CPU/2 GB, một machine/process; timeout AI từ DB không đổi.
- Hủy/đóng request ngắt upstream cả trước lẫn sau khi nhận response headers. Stream kết quả có bộ đệm nhỏ để che key; không gom toàn bộ response trên backend. Việc provider đã bắt đầu xử lý có được hoàn tiền hay dừng hẳn phụ thuộc provider.
- Giới hạn transport hiện tại: **64 MiB JSON mỗi request, tổng body đang xử lý tối đa 128 MiB, 128 request đang xử lý và 256 request chờ mỗi process**. Thiếu Content-Length dự trữ 64 MiB chỉ sau Auth. Khi hết chỗ, request chờ trước khi đọc/parse body; không còn trả 429 ngay ở lượt 33. Hủy/ngắt mạng xóa hàng chờ, không gọi provider lại. Body vượt 64 MiB vẫn trả 413; hàng chờ cực tải đầy trả 503, hết deadline trả lỗi timeout. Các lớp bảo vệ tài nguyên vẫn cần thiết; không cam kết tải vô hạn hoặc không bao giờ lỗi.
- Probe mới trên process cô lập: 180×64 KiB, 8×8 MiB, 4×40 MiB và 1×63 MiB đều HTTP 200; RSS đỉnh khoảng 1.02 GiB, dưới gate 1.5 GiB cho máy 2 GiB. Probe cũ 63 MiB trên cấu hình 512 MiB đã vượt RAM và được thay thế. Đây là payload chuỗi/provider giả lập, **không phải bảo đảm RAM toàn WebApp hoặc benchmark production**.
- Không thêm pg pool/SQL connection, worker, replica, polling, cache refresh hay retry. Auth/đọc cấu hình dùng chung cổng tối đa **8 lượt DB setup**, tách khỏi thời gian provider chạy lâu, có hàng chờ tối đa 384. Mỗi AI vẫn một Auth HTTP và ba DB HTTP tuần tự qua singleton hiện có; không tăng connection budget. Số connection backend Supabase thực tế chưa đo.

## Migration V434 — đã apply

Canonical duy nhất: `migrations/migration_v434_desktop_ai_proxy_identity.sql`. File được khởi tạo bằng Supabase CLI rồi đặt theo quy ước V-number của repo; WebApp không giữ SQL trùng.

| Thuộc tính | Giá trị |
| --- | --- |
| Project đã đối chiếu | akachat `cgjbsmqtfhqvttudyjzq` |
| Hàm mới | `public.aka_agent_desktop_ai_identity(uuid,uuid)` |
| Source checksum | Chưa tồn tại; migration dừng nếu signature đã có |
| Target checksum PG17 local/production | `5600c48f72d1343670b3e7cfd31ce491` |
| Owner / mode | postgres / STABLE SECURITY DEFINER |
| Config | `search_path=pg_catalog`, `statement_timeout=10s` |
| EXECUTE | Chỉ postgres và service_role; revoke cả PUBLIC và các default ACL riêng |
| Helper giữ nguyên | `public.aka_agent_staff_time_allowed(bigint)` |
| Helper source/target checksum | `a294e60011edd8d42e90ac2f74ce744c` |

RPC chỉ đọc mapping private → Auth user/session → staff, dùng helper active/deleted/thời hạn hiện có; trả hai ID hoặc NULL. Không thay helper, chữ ký, ACL, body của RPC cũ hoặc dữ liệu người dùng. Preflight helper fail closed nếu checksum/owner/security thay đổi. Live definition/metadata nằm ở `migrations/snapshots/desktop-session-rls/ai-proxy-identity-preflight.json`.

Smoke PostgreSQL 17 disposable đạt 14 ca: identity đúng/sai, session đã mất, Auth role/flag, staff inactive/deleted, quyền caller, drift và chạy lại migration. Chạy role service_role thật; helper giữ checksum. Production rollback trước apply và smoke sau apply đã đạt; chi tiết ở audit bên dưới. Không apply lại V434.

## Kiểm chứng

- `scripts/desktop-ai-proxy-smoke.cjs`: actual Desktop repository/runtime/transport → HTTP Fastify → provider giả; so với runtime trước sửa từ Git HEAD. 16 trường hợp Responses/chat/custom response_path/native Claude × thành công/lỗi 429/output không hợp lệ/lỗi mạng. Body, header provider, content, usage, lỗi, raw response và log khớp; bỏ qua thời điểm/duration thay đổi tự nhiên. Có kiểm pre-abort và không retry/fallback.
- API: 33 test AI/admission, gồm Auth→session mapping (dịch vụ ngoài mock), tenant/model/config guards, che key và giữ emoji ở mọi ranh giới byte/tail, deadline 300 giây, burst 180 request, DB setup tối đa 8, hàng chờ FIFO theo byte/số lượt, hủy trước/sau headers và khi chờ, body dở dang thiếu Auth/đã Auth, không gọi provider khi hết ngân sách sau chờ. Hai finding review đã tái hiện trước sửa và có hồi quy.
- Bốn smoke AI cũ đạt: form config, nội dung, loại trừ, Facebook service. Nhánh trusted Server vẫn giữ provider contract; smoke mới kiểm riêng nhánh Desktop không nhận key.
- Inventory source: 313 select/60 embedded, không unresolved/unknown payload. Resolver nhận helper projection không tham số mà không thực thi source; smoke parser/resolver đạt.
- Hai typecheck Desktop/build Desktop của lượt trước còn nguyên source; 16 HTTP parity đã chạy lại sau sửa backend. Bảy workspace typecheck và build WebApp đạt. Toàn bộ API đạt 68 file/1.315 test trước hai ca bổ sung về hủy/chờ quá deadline; bộ AI cuối đạt 33/33. Receipt đầu `ai-proxy-verification.json` là lịch sử trước sửa review; trạng thái mới ở `ai-proxy-capacity-verification.json`.
- `npm test` toàn WebApp: control-api 33, campaign-core 263, control-client 55, API 1.304 và mobile 247 đạt. Web có 848/850 đạt, hai ca `CampaignsPage` không tìm thấy dòng kịp thời khi chạy toàn suite; chạy lại nguyên file riêng đạt 66/66. Không sửa/che hai test này và không coi lượt chạy tổng là sạch. Giao diện/module CampaignsPage không thay đổi trong task.
- Không gọi provider AI thật, không dùng credential/customer prompt thật, không browser UI vì không đổi giao diện, không canary bộ cài.

## Thứ tự triển khai và quay lại

1. Review source, capture lại helper/ACL trên đúng akachat, chạy V434 trong transaction kết thúc ROLLBACK rồi mới apply riêng migration khi triển khai DB được cho phép. Kiểm signature/checksum/owner/config/EXECUTE sau apply.
2. Deploy API mới và idle timeout Fly trên tài nguyên hiện có. Không ghi đè config live khác. Kiểm health, request thiếu JWT, canary đăng nhập/AI/hủy được phép trước khi cập nhật Desktop.
3. Đóng gói/cập nhật Desktop; kiểm các tính năng AI thực tế gồm ảnh, nội dung và form. App cũ tiếp tục gọi provider như trước trong giai đoạn chuyển tiếp.
4. **Chỉ khi người dùng yêu cầu**, chuẩn bị cutover riêng để chặn đọc key qua token và anon, audit view/RPC/JSON có thể lộ secret; không dùng B/rollback ACL cũ đã chặn. Chỉ xoay key nếu có yêu cầu riêng.

Nếu cần rollback trước cutover quyền: quay Desktop về bản cũ trước, rồi mới rollback API; RPC mới có thể để lại vì chỉ backend được gọi và không thay dữ liệu. Không rollback API trước khi xử lý Desktop mới vì bản mới không có fallback. Sau cutover, không tự mở lại quyền đọc key chỉ để rollback app.

## Apply V434 và deploy API — 27/10/2026

Theo yêu cầu người dùng, đã apply riêng `20261027155315 / migration_v434_desktop_ai_proxy_identity` trên akachat `cgjbsmqtfhqvttudyjzq` lúc **22:53:15 VN**. Source signature chưa tồn tại; target `public.aka_agent_desktop_ai_identity(uuid,uuid)` có MD5 **`5600c48f72d1343670b3e7cfd31ce491`**, owner postgres, STABLE SECURITY DEFINER, `search_path=pg_catalog`, `statement_timeout=10s`, ACL chỉ postgres/service_role. Không apply lại.

V434 được chạy trước trong transaction ROLLBACK, xác nhận signature biến mất và toàn bộ guard không đổi rồi mới apply. Cả trước và sau apply, hai mapping/session đang hợp lệ trả đúng danh tính theo join độc lập; thiếu danh tính/sai session trả NULL; anon/authenticated/aka_agent_desktop bị từ chối EXECUTE bằng role thật. Helper staff giữ MD5 `a294e60011edd8d42e90ac2f74ce744c`. Sau apply, 1.242 hàm public/private ngoài target, ACL bảng/cột, RLS, policies và default ACL khớp snapshot trước; advisor không nhắc target mới. Không sửa dữ liệu người dùng hoặc thu hồi quyền cũ.

API được build từ archive WebApp HEAD `9f3d4ee363e0e7e9e6420f33c7a7fda019485e0e` cùng đúng bảy file overlay đã kiểm chứng (route registration, năm file module AI và fly.toml). Source module khớp receipt review cuối; không đưa env hoặc secrets vào build context. Image production:

`registry.fly.io/aka-agent-web-app:desktop-ai-v434-20261027@sha256:a3727317370d334073ecf38c21955336bf6f4cbee675c0a17cd541ec2afe3c49`

Deploy lúc **22:55:46 VN** trên machine **48ee749f357398**, region sin. Deep equality toàn config xác nhận chỉ đổi image và `http_options.idle_timeout=600` ở hai port HTTP/HTTPS; giữ 2 shared CPU/2048 MB, một machine/process, env/secrets/services/restart và cấu hình khác. Không thêm pool, worker hoặc replica.

- Health **1/1 passing**, runtime Node **22.23.4**.
- **27/27 HTTP**: health trước/sau, 14 Web asset khớp SHA-256 trước deploy, năm auth guard cũ, năm AI guard (thiếu JWT, body JSON sai khi chưa xác thực, sai auth scheme, JWT lỗi, JWT Desktop giả). AI trả 401, thông báo chung, no-store, không có marker provider.
- **207 runtime checksum**: chỉ API bundle thay đổi; API SHA-256 `bef4d7884a763fd89fae68e2aa9cba53df11ec4cfeaf1631c368055e84276251` khớp build local đã kiểm chứng. 206 file Web/control-api khác giữ nguyên.
- Backend Fly gọi RPC qua PostgREST bằng khóa server hiện có: danh tính hợp lệ, NULL và session sai đều HTTP 200/kết quả đúng, trước và sau deploy. Không ghi/đọc ra key hoặc thay đổi tài khoản.
- Chưa thử toàn luồng bằng JWT Desktop thật tới provider, chưa canary bộ cài, chưa gọi AI thật hoặc dùng nội dung khách. Smoke này xác nhận triển khai/ACL/transport backend và các guard; không thay thế canary AI đăng nhập thật trước phát hành Desktop.

Receipt đã lọc: [ai-proxy-production-verification.json](../migrations/snapshots/desktop-session-rls/ai-proxy-production-verification.json). Full config/log/manifest riêng tư ở `/Users/lequangnhut/.codex/deployments/desktop-ai-20261027-7uw1pcjk`; không commit credentials/config live. Các receipt local cũ giữ nguyên làm lịch sử.

Rollback image trước đợt này là `registry.fly.io/aka-agent-web-app:web-uid-9f3d4ee-20261026@sha256:ab946df2cf1923faf04b86f91374187e64bbd70a40927f7e7d3546dfaab52a41`. Nếu cần rollback, đọc lại config/version live và xử lý Desktop mới trước, chỉ đổi image, giữ tài nguyên 2 CPU/2 GB và những thay đổi live khác. RPC V434 có thể giữ lại; không drop hoặc mở lại quyền tự động. **Anon, quyền đọc key, RLS và key AI vẫn giữ nguyên theo yêu cầu trì hoãn cutover.**

## Canary phiên Desktop thật — 27/10/2026

Theo yêu cầu tiếp theo, đã dùng trực tiếp cửa sổ Desktop dev từ repo chính (`localhost:5173`) đang đăng nhập tài khoản Lê Quang Nhựt, lúc **23:01–23:04 VN**. Không lấy token khỏi main process, không sao chép credential hoặc tạo tài khoản mới. Mở form chiến dịch mới chưa lưu, dùng lời chào thử không có nội dung khách; thao tác UI đi qua IPC/runtime thật tới API Fly vừa deploy và provider thật.

| Luồng | Provider/model | ai_log | API request | Kết quả |
| --- | --- | --- | --- | --- |
| Viết lại nội dung | OpenAI / gpt-5-nano | 1172618 | req-31 | HTTP 200, 2.995 ms; tiếng Việt/emoji đúng |
| Điền lịch | OpenAI / gpt-6.1-sol, config 2 | 1172625 | req-3c | HTTP 200, 3.569 ms; thứ 2–4–6, ngày 28/10/2026, 08:30, dừng 17:45 |
| AI Nội dung | Claude / claude-haiku-5-5, config 5 | 1172631 | req-3g | HTTP 200, 3.505 ms; parser native structured output điền đúng nội dung, giữ emoji |
| Yêu cầu đổi lịch sau hủy | OpenAI / gpt-6.1-sol, config 2 | 1172648 | req-3v | HTTP 200, 3.810 ms; giờ đổi 09:15, các trường lịch khác giữ nguyên |

Giữa hai lượt lịch, đã gửi yêu cầu đổi 09:15 rồi bấm **Hủy yêu cầu**. UI mở lại thao tác, giữ 08:30 và không áp phản hồi muộn; API ghi nhận req-3u, không có response hoàn tất hoặc ai_log thành công của lượt hủy trong evidence. Gửi yêu cầu mới bằng nút Điền lịch sau đó thành công. Kiểm chứng này xác nhận hành vi hủy phía Desktop và tiếp tục sử dụng; không xác nhận việc provider hoàn tiền/dừng nội bộ sau hủy.

Đã đóng form bằng **Huỷ**, không Lưu nháp/Lưu chiến dịch/chạy chiến dịch. Chỉ bốn ai_log bình thường được tạo từ các lượt thành công. Không sửa code runtime, migration, model/prompt/key, deploy hoặc đóng gói trong canary. Checksum toàn bộ hàm/ACL bảng/cột/default ACL/RLS/policies trước–sau khớp; anon và quyền đọc key giữ nguyên. Fly vẫn một machine 2 shared CPU/2048 MB, health 1/1, `/healthz` 200.

Receipt: [ai-proxy-real-desktop-canary.json](../migrations/snapshots/desktop-session-rls/ai-proxy-real-desktop-canary.json). Log đã lọc/ảnh UI ở `/Users/lequangnhut/.codex/deployments/desktop-ai-real-canary-20261027-3vn5rt2x`. Ảnh `schedule-success.png` được chụp trước khi đóng form. Các ghi chú chưa canary ở phần triển khai phía trên là trạng thái trước bài thử này. Chưa kiểm lại ảnh đầu vào, tải lớn, timeout dài, token hết hạn, mất mạng hoặc sleep trên phiên production trong lượt này; không coi canary này là toàn bộ kiểm thử bộ cài.
