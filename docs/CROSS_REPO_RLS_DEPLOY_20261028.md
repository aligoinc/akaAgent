# Deploy các luồng HTTP sau RLS — 28/10/2026

Theo yêu cầu người dùng, đã apply migration chung, deploy Chat API/worker, ChatWeb, WebApp và Edge akaMap; đóng gói akaMap **3.0.7**. Không mở lại quyền anon. Bộ cài chỉ được tạo local, chưa upload hoặc đổi feed công khai.

## Database

- Project duy nhất: akachat `cgjbsmqtfhqvttudyjzq`.
- Production history: **20261027181400 / cross_repo_http_permissions**, tức **01:14 ngày 28/10/2026 VN**. Canonical: `supabase/migrations/20261027173856_cross_repo_http_permissions.sql`; không apply lại.
- SHA-256 candidate đã review: `d6ff712dd644fbda5ad881e5f2a30006d7adf101d16624928acc0dfcd9f99a76`.
- Chỉ thêm bảy hàm, owner postgres, SECURITY INVOKER, EXECUTE chỉ postgres/service_role. Nguồn cả bảy là absent; chữ ký, MD5 target, cấu hình và ACL tại [receipt production](../migrations/snapshots/cross-repo-http-permissions/production-verification.json).
- 1.246 hàm cũ và metadata của 769 relation giữ nguyên; quyền cột, RLS/policies giữ nguyên. Sáu dependency giữ checksum đã capture, bao gồm hook IP `ecfc014981c5058f9cd84e0e8e504bed` với cả hai IP bị chặn. Toàn bộ snapshot vẫn khớp sau hậu kiểm.
- SQL production chạy trong transaction READ ONLY rồi ROLLBACK: 120 tổ hợp IP/header/route bị từ chối, năm route chặn danh tính sai, catalog/list/datasets và engagement settings khớp đường cũ. Không tạo nhóm, nhập dữ liệu khách hoặc chạy chiến dịch.

Chữ ký/MD5 nguồn dependency và target đầy đủ nằm trong [audit candidate](DESKTOP_PERMISSION_CUTOVER_V435.md#sửa-năm-luồng-http--candidate-28102026). Giữ toàn bộ patch live; không thay body hoặc ACL của hàm cũ.

## Fly và Edge

| Thành phần | Source | Machine | Image digest |
|---|---|---|---|
| Chat API + worker | `58a1252` + thay đổi đã review trong `codex/rls-http-compat` | `7845747fe073e8`, `784574da214578` | `5e930ebda193f586e3efa895dfcb2d8e08b1d76be8e64a73bb29717058455a49` |
| ChatWeb | `8d9ecfd` + reader login đã review | `7847d95cd4ddd8` | `1c5287cc1df3ff6d7ede4f0bbd55f448810025c1decc768006c9aa0329f6dd34` |
| WebApp/API | `dev` tại `5f45253`, sạch trước deploy | `48ee749f357398` | `819c29a9cf0561a414172f66543f4d9e4884da360bc65d0d692337f5dc38eba2` |

Cả ba image dùng tag `cross-repo-rls-20261028` trong registry của từng app. Chỉ cập nhật image trên các machine hiện có; full config diff chỉ có `image`. API/worker giữ 2 shared CPU/1 GB mỗi machine, ChatWeb 2 shared CPU/512 MB, WebApp 2 shared CPU/2 GB. Không thêm replica/pool; machine Zalo runtime `0803139f1d1058` giữ nguyên image và cấu hình.

Khóa `AKA_AGENT_SUPABASE_SERVICE_ROLE_KEY` lấy từ backend WebApp hiện có, kiểm tra bằng HTTP, import qua stdin vào Fly secrets rồi cập nhật API/worker. Không in key hoặc đưa vào Git/client. Bản tạm local đã xóa sau hậu kiểm.

Edge `akamap-data-groups` version **1**, ACTIVE, `verify_jwt=true`; deployed bundle SHA-256 `a7728b5a2396e311b16cbaab2337804f63c0e9bced503f76956aced2c5bb6c23`. Giữ secret Supabase ở Edge và kiểm tra staff trong SQL từng lượt.

Hậu kiểm HTTP đạt 27 ca DB/Edge: catalog/list/datasets với danh tính nội bộ thật, từ chối mật khẩu sai và metadata giả, anon không gọi được wrapper/settings, metadata IP bị chặn trên cả năm wrapper. Không in thông tin đăng nhập hoặc nội dung nhóm. Gateway bỏ X-Forwarded-For do caller tự gửi, nhưng giữ đúng IP nguồn thật trong `cf-connecting-ip`/`x-forwarded-for`; đã đối chiếu bằng diagnostic ngắn hạn rồi xóa endpoint diagnostic. Không coi phép giả header bị gateway thay thế là phép kiểm thử IP bị chặn đầu cuối.

## Kiểm chứng triển khai

- API, ChatWeb, WebApp health passing; worker started (không có service health check). API và worker chạy trực tiếp module đã deploy: đọc đủ bốn engagement key, parse notice và gọi recorder với event rỗng trả 204, không ghi diagnostic thật.
- 20 HTTP probe health/login-content/static assets/auth guard đạt; AI thiếu token vẫn 401. Log buffer sau deploy không có `42501`, `permission denied`, lỗi key startup hoặc engagement HTTP.
- Tám module runtime Chat trên mỗi machine khớp checksum local; sáu file API/WebApp khớp build local. Không gửi tin Zalo hoặc chạy chiến dịch thử.
- WebApp: bảy workspace typecheck, **2.765 test** và production build đạt. Chat giữ kết quả 50 test tập trung/typecheck sau review và hai remote production build đạt.

## akaMap 3.0.7

Source `google-map` tại `3f17c29` + bản sửa đã review; tăng đồng bộ package/lockfile lên 3.0.7 và output `release-3.0.7`. Giữ Mac ARM64, NSIS Windows chứa payload x64/ia32 theo cấu hình hiện có.

| Bộ cài local | Bytes | SHA-256 |
|---|---:|---|
| `akaBiz-Map-Setup-3.0.7.exe` | 364899211 | `9cae62f019b03be44c5a823c5d65dec9a7532d7a578b36e2956b75a530bd7137` |
| `akaBiz-Map-3.0.7-mac-arm64.dmg` | 269233910 | `aebbcb121e17b22549303db34e619c75c95e00b961a7e4a1945a1154d6e61627` |

177 test, main/renderer build, verifier tất cả artifact và hợp đồng ba file đạt. Alias `akadata.exe`/`akadata.dmg` giống byte với bộ cài, `version.txt` local là `3.0.7`. Version/asar/native đúng kiến trúc, DMG verify và chữ ký ad-hoc Mac đạt; SQLite trong app Mac đóng gói chạy thành công. Hai payload app.asar trích từ NSIS khớp chính xác output x64/ia32. Native host đã khôi phục. Chưa chạy trên Windows thật, chưa ký Developer ID/notarize hoặc upload/phát hành.

Evidence riêng tư, source manifests, logs, cấu hình trước/sau, HTTP/runtime và receipt bộ cài: `~/.codex/deployments/cross-repo-rls-20261028/`. Không đưa full machine config hoặc credential vào repository.

## Hoàn nguyên

Giữ migration additive và quyền anon đã khóa khi sửa image/configuration. Không quay lại reader anon để khôi phục chức năng. Image/config baseline được lưu trong evidence; trước rollback phải đọc lại config live rồi chỉ đổi phần cần thiết, không hạ tài nguyên hoặc tăng replica. Nếu bỏ hẳn các caller mới, dùng guarded rollback đã review trong `migrations/rollback_cross_repo_http_permissions.sql`, sau khi dừng caller và đối chiếu checksum target; không CASCADE hoặc mở anon.
