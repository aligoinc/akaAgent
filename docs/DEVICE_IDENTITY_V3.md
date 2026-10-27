# Nhận diện máy v3 — đã apply DB 27/10/2026

**Đã apply migration v3 lên akachat lúc 15:57:44 ngày 27/10/2026 (giờ Việt Nam): `20261027085744 / device_identity_v3`. Chưa bật RLS C, đóng gói hoặc phát hành app.** Năm target khớp checksum/thuộc tính; 363 hàm ngoài phạm vi giữ nguyên. `org_staff` vẫn RLS=false, ACL/policy staff và tổ chức giữ nguyên. Không apply lại v3 hoặc auth A/B. Các ghi chú candidate/review bên dưới là lịch sử; bằng chứng production ở phần cuối.

## Hành vi

| Trường hợp | Kết quả |
|---|---|
| Có credential local hợp lệ, binding v2 không trùng | Xác thực chính credential đó, CAS chuyển v3, không trừ lượt đổi máy |
| Binding v2 đã từng trùng | Form trống, không thông báo trùng; nhập username/password rồi chuyển v3 |
| v3 sạch | Ghi nhớ/tự đăng nhập theo checkbox |
| v3 dùng chung giữa nhiều staff | Cho login thủ công đúng credential; không ghi nhớ credential, không auto-login/khôi phục |
| Máy mới, file chỉ có preferences hoặc không có credential | Không tra tài khoản bằng fingerprint, không import credential legacy |
| Lỗi đọc phần cứng, file, mạng, mật khẩu | Lỗi thông thường; không suy diễn là thiếu thành phần để đổi mã |

Một máy dùng nhiều tài khoản cũng thuộc nhóm mã dùng chung. Đây là chủ ý: fingerprint không đủ để quyết định tài khoản. Nhóm v2 giảm còn một vẫn giữ dấu va chạm; tài khoản đã chuyển v3 sạch không bị dấu v2 cũ giữ lại. Mã ghép không phân biệt được clone toàn bộ OS + dữ liệu app + credential; không thêm salt/mã máy ngẫu nhiên hay TPM.

## Công thức và lưu trữ

- SHA-256 của JSON cố định `['akaAgent-device-v3', platform, [tên trường, giá trị], ...]`, theo thứ tự uuid, serials, machineGuid, mac; chỉ dùng các thành phần đã chọn.
- Windows: SMBIOS UUID + serial mainboard đã chuẩn hóa/sắp xếp + registry MachineGuid + `MSFT_NetAdapter.PermanentAddress` của card PCI/ACPI vật lý. Loại virtual/VPN/loopback/USB, ưu tiên Ethernet rồi Wi-Fi, không xét connected/up. MAC multicast/local/random/0/F bị loại.
- Mac: IOPlatformUUID + IOPlatformSerialNumber + IOMACAddress của controller dẫn tới interface IOBuiltin khi xác định được; loại USB/Thunderbolt bridge/virtual, không lấy MAC IP/interface đang kết nối.
- UUID `03000200-0400-0500-0006-000700080009`, UUID 0/F và serial mặc định bị loại ở v3. Reader v2 giữ nguyên công thức để đối chiếu, đọc installation fallback đã tồn tại nhưng **không tạo fallback ngẫu nhiên mới**.
- `device-identity-v3.json` lưu tên thành phần/card đã chọn, không đóng băng giá trị phần cứng. Không tự thêm thành phần/card mới sau đăng ký. Manifest phải ghi thành công trước khi dùng; lỗi đọc không chọn lại nguồn.
- Auth đọc lại phần cứng trước prepare và bind. Presence dùng cache trong phiên, không chạy WMI/IORegistry ở mỗi heartbeat, không thêm polling/pool.
- Đổi Wi-Fi/IP/VPN/USB không chọn lại card. Thay mainboard/card được chọn hoặc cài lại Windows có thể đổi mã; dùng luồng đổi máy hiện có. Reset luôn giữ selection còn hợp lệ, kể cả khi đổi tài khoản khác hoặc `already_unbound`. Khi một lượt đọc hardware thành công xác nhận thành phần đã chọn bị mất, hash dành riêng cho **audit reset** được tạo từ các thành phần hợp lệ hiện có, dùng domain `akaAgent-device-reset-audit-v1`; không phụ thuộc mã v2, không tạo từ bộ rỗng và không dùng hash audit cho login/presence/binding. Sau server xác nhận thành công phải đọc lại và chỉ xóa selection nếu thành phần vẫn mất. Lỗi đọc/timeout/file không được xóa selection hoặc tạo hash thay thế. Protocol reset vẫn version 2, quota/online guard giữ nguyên.
- Giữ file v2 và `login-v2.json` schema 3. Thêm `manualLoginReason: 'device'` cùng `requiresManualLogin` để form trống bền vững mà không hiển thị cảnh báo về trùng. Checkbox giữ nguyên; lỗi file bình thường vẫn được báo. Không dùng Keychain.

## Hợp đồng auth và database

`aka_agent_staff_client(text,text,text,jsonb)` thêm hai action, giữ các action A/B:

- `prepare_device_v3`: `{ staffId?, fingerprintHash, legacyHash, source }`.
- `bind_device_v3`: cùng input, bắt buộc staffId và thêm `{ requestId, expected: {hash, version, revision} }`.
- `source`: manual/automatic/remembered/recovery, do Main xác định từ IPC; loginRemembered hay đồng ý policy không được nâng thành manual.
- Profile vẫn không có password. `deviceV3` trả `{decision, automaticAllowed, needsBinding, binding}`; decision là allowed/manual_login_required/device_locked. Không trả danh sách staff cùng mã.
- Cả prepare/bind xác thực username/password, đúng staff, active/deleted/expiry. Client giữ entitlement; bind kiểm tra policy. Main chỉ đặt currentUser và khởi động dịch vụ sau xác nhận binding.
- `org_staff` thêm `aka_agent_device_identity_version` mặc định 2 và `aka_agent_device_binding_revision` mặc định 0. Trigger tăng revision khi binding đổi, kể cả reset/rebind cùng hash; không cho hạ version 3 xuống 2. Index `(version, fingerprint_hash)` hỗ trợ kiểm tra tồn tại/tối đa hai dòng.
- `private.aka_agent_device_collisions`: khóa `(version, fingerprint_hash)`, dấu bền vững, seed đủ nhóm v2 kể cả inactive/deleted trước khi chuyển khách. Không unique fingerprint trên staff.
- `private.aka_agent_device_migrations`: receipt theo UUID request, staff/org/source/hash cũ-mới/revision. Không mật khẩu, khóa khôi phục hoặc thông số hardware thô. Chỉ ghi receipt khi đổi binding, không tăng hàng mỗi login thông thường.
- Khóa advisory theo hash được sắp xếp trước khóa staff; đăng ký v3, legacy bind_device và proof recovery cùng thứ tự. Kiểm tra trùng + CAS + receipt trong một transaction. RLS private tables, không quyền anon/authenticated; helper private không cấp EXECUTE cho client.
- Journal local `device-binding-v3/<staffId>.json` không password, ghi atomic trước mutation, replay cùng request sau mất phản hồi/crash. Receipt không được replay qua reset/rebind epoch.
- Journal reset trong `device-change-requests-v2/` dùng schema 2, lưu ID/CAS cùng allowlist `device: {fingerprintHash, platform, label, appVersion}` trước mutation. Retry đọc journal trước hardware và gửi nguyên payload, kể cả qua restart hoặc khi adapter trở lại; không trừ quota lần hai. Journal schema 1 của client v2 đã phát hành được bổ sung metadata từ reader v2 một lần, giữ ID/CAS và ghi atomic trước gửi. Nếu không đọc được mã v2 của journal cũ thì giữ journal và báo lỗi, không đoán hash hoặc đổi ID. Journal schema 2 thiếu/hỏng metadata bị từ chối, không tự dựng lại.
- Bỏ hẳn lookup credential theo legacy/v2 hash đơn thuần trong authRepository. Khôi phục chỉ qua proof local đã xác thực; RPC recovery chặn cả dấu trùng đã lưu. Thử proof với hash v3 trước; chỉ khi RPC trả đúng `P0001 / staff_recovery_invalid` mới đọc hash v2 và thử thêm một lần bằng **cùng proof local**, trong cùng deadline HTTP. Không retry sang v2 khi lỗi mạng/SQL, thiếu proof, phản hồi không hợp lệ hoặc đã nhận `manual_login_required`. Credential khôi phục vẫn qua prepare/bind với `source=recovery`, entitlement và kiểm tra trùng trước khi trả remembered username. Đăng ký lại cùng proof sau chuyển v3 sạch. Proof không tham gia fingerprint.
- `AuthLoginResult` thêm `manual_login_required`, `AuthLocalState` thêm `manualLoginRequired`. Main giấu remembered username trước kiểm tra; renderer xóa cả hai ô và không hiện banner/popup khi nhận trạng thái này. Generation/revision chặn kết quả cũ sau đổi username/logout/options.

## Audit RPC và migration

Canonical SQL đã apply: `supabase/migrations/20261027071650_device_identity_v3.sql`, tạo tên bằng Supabase CLI; version trong history production là `20261027085744`. Generator dùng live capture `migrations/snapshots/device-identity-v3/source.json` và phần schema mới; không lấy body từ migration lịch sử.

| Exact signature | Source MD5 | Target MD5 |
|---|---|---|
| `aka_agent_recover_staff_credentials(text,text)` | `6f831ff1691807ebb32e5052f6df3f05` | `2da69a5f5e7a79d3f93ee9adb0299e77` |
| `aka_agent_staff_client(text,text,text,jsonb)` | `16a1f5c7f327d3de9b7bd809ba94d31c` | `73830b14c79b98802050cc9419cfd6c1` |

Bảo toàn owner postgres, SECURITY DEFINER/volatility/search_path, timeout, ACL, guard auth/tenant/expiry, policy, password/integration/test-workflow và proof của A/B. Presence, prepare/reset v2, time guard và recovery invalidation trigger giữ nguyên checksum. `local-target.json` giữ target của hai RPC sửa và ba helper mới; `live-verification.json` là snapshot trước apply, `production-after.json` ghi trạng thái live đã có v3.

Preflight fail closed đối với cả 7 signature/metadata và schema đã có. Không reapply candidate; nếu checksum live khác, phải capture/diff lại trước khi dựng migration mới. Bản C chưa apply đã cập nhật guard lên 44 hàm và thêm kiểm tra trigger/bảng/index v3; rollback C cũng giữ guard đó. Không chạy C trước candidate v3.

## Kiểm chứng

- `node scripts/device-identity-v3/run-client-smoke.cjs`: 65 nhóm kiểm tra hardware, nguồn cố định/lỗi đọc, plaintext compatibility, manual marker/checkbox, journal/replay, Main IPC và auth repository; fixture credential, không login khách thật. Gồm 27 nhóm hồi quy review trong `review-regressions.ts`: proof v2→v3, trùng/khóa sai/thiếu khóa/lỗi mạng, reset tài khoản khác, máy không có v2, payload cố định qua restart/adapter trở lại, journal cũ/hỏng/lỗi ghi và chỉ sửa selection sau reset thành công khi phần cứng thật sự mất.
- `node scripts/device-identity-v3/sql-smoke.cjs`: 35 kiểm tra PostgreSQL 16.15 local, apply trong transaction rollback trước, duplicate inactive/cross-org/sticky, concurrent connections, receipt/CAS/password race, policy/expiry, proof recovery v2→v3 và trùng v2, ACL, reset quota/online/menu và checksum thuộc tính giữ nguyên. Dùng `DeviceChangeRequestClient` thật với PostgreSQL, làm mất phản hồi sau DB commit rồi restart: giữ nguyên ID/CAS/device, một history và một lượt quota; hash audit không vượt guard máy đã liên kết ở account menu.
- `node scripts/staff-rls/run-sql-smoke.cjs`: 124 kiểm tra sau v3, diễn tập C và rollback chỉ trên PostgreSQL local, giữ 34 RPC runtime/lock và bảo vệ view.
- `node scripts/run-auth-v2-smoke-test.cjs`: 40 kiểm tra tương thích file, hash v2 và journal reset; các kiểm tra legacy credential lookup được thay bằng bộ v3 ở trên.
- `node scripts/staff-rls/client-smoke.cjs`: 59 kiểm tra proof/client và Server; `node scripts/run-device-change-smoke-test.cjs`: reset/presence/quit guard đạt. Bổ sung mock các service shutdown đã có, không sửa runtime shutdown.
- `node scripts/run-auth-v2-renderer-smoke.cjs`: Electron/React form trống, không banner, checkbox/recovery không điền lại, bỏ phản hồi recovery muộn, giữ thao tác đổi máy.
- `node scripts/run-auth-v2-electron-smoke.cjs`: hardware thật trên Mac ARM64, lưu/mở lại credential và hash qua hai process đạt; cùng harness chạy Electron x64 33.4.11 qua Rosetta cũng đạt. Đây là Mac ARM64 với Rosetta, **chưa phải máy Intel vật lý**.
- Hai typecheck (`tsconfig.node.json`, `tsconfig.web.json`) và production build Desktop/Server đã đạt ở lượt xác nhận cuối. Build Desktop/Server chạy tuần tự: electron-vite dùng file config tạm chung; chạy song song có thể đọc nhầm config dù command thành công.

**Chưa kiểm tra Windows thật, card bị disable/thay phần cứng thật, Wi-Fi private address trên đủ driver, bộ cài mới hoặc máy Intel vật lý.** Các trường hợp này vẫn là gate trước phát hành, không thay bằng fixture.

## Triển khai / rollback

### Review 27/10/2026

Đã sửa hai finding: khôi phục khóa v2 trước khi chuyển binding và reset tài khoản khác làm mất selection hợp lệ. Kiểm chứng lại 57 client, 33 SQL local, 59 staff client, 40 tương thích v2, reset/presence/quit, Electron renderer, hardware ARM64 qua hai process, hai typecheck và build Desktop/Server tuần tự đều đạt. `migrations/snapshots/device-identity-v3/review-verification.json` ghi checksum source/bundle và kết quả mới; `verification.json` giữ bằng chứng của lượt triển khai ban đầu. Candidate v3 và C giữ nguyên checksum đã kiểm chứng, không đổi RPC/ACL hoặc apply production. Chưa thử Windows/Intel vật lý hay đóng gói bộ cài; x64 Rosetta là bằng chứng của lượt trước, không chạy lại trong lượt sửa review này.

### Thứ tự triển khai

Lượt review reset tiếp theo ngày 27/10/2026 đã sửa trường hợp không có mã v2 và payload reset thay đổi khi retry. 65 client, 35 SQL local, 59 staff client, 40 tương thích v2, reset/presence/quit, Electron renderer/hardware ARM64, hai typecheck và build Desktop/Server đều đạt. `migrations/snapshots/device-identity-v3/reset-review-verification.json` ghi checksum và kết quả mới nhất. Hash audit chỉ là metadata của yêu cầu đổi máy, không phải mã máy phụ hay bằng chứng đăng nhập. Bản sửa reset không chỉnh SQL/RPC/ACL/quota hoặc production; candidate v3 giữ checksum. File guard C có thay đổi khác trong workspace so với receipt trước; giữ nguyên thay đổi đó, ghi checksum quan sát riêng và không coi C hiện tại đã được kiểm chứng lại bởi lượt sửa reset này. Giới hạn Windows/Intel thật, bộ cài và rollout như lượt trước.

1. Đã đối chiếu project `cgjbsmqtfhqvttudyjzq`, capture đủ live definitions, diễn tập rollback/concurrency/ACL và apply riêng migration v3; không bulk push.
2. DB v3 đã sẵn sàng. Tiếp theo cần build và thử bộ cài Windows x64/Mac ARM64/Mac Intel, gồm upgrade có/không trùng, restart, network/driver/hardware changes, offline/disk failure; chưa thực hiện/phát hành trong lượt apply DB này.
3. Phát hành cập nhật, sau đó mới làm bước C theo xác nhận triển khai riêng trong `STAFF_RLS_ROLLOUT.md`. A/B đã live, không apply lại. Đây chưa phải xác nhận để bật C.
4. Đánh giá migration bằng số receipt theo source/version và nhóm collision; không log password/proof/hardware raw, không thêm polling.

Nếu có lỗi sau rollout: dừng phát hành và sửa tiếp từ trạng thái hiện tại. Giữ bảng dấu trùng, receipt và binding version 3. Không restore hash v2 hàng loạt, bật fingerprint-only recovery hoặc cấp lại quyền đọc password để cứu auto-login. Bản cũ dùng bind_device bị chặn với staff đã v3; rollback client có thể yêu cầu một bản sửa tương thích v3. Đường đọc/ghi trực tiếp của client cũ chỉ đóng hoàn toàn khi RLS C được triển khai.

## Apply production — 27/10/2026

Theo yêu cầu apply riêng v3, Supabase ghi nhận `20261027085744 / device_identity_v3` trên **akachat** (`cgjbsmqtfhqvttudyjzq`) lúc **15:57:44 VN**. SQL trong migration history khớp nguyên văn canonical: MD5 `e601a549dc0563b17783b94ff1e5aced`, SHA-256 `e2a576c4cd56f2daed6f601f62aefcbb8d1e69cace18f5c9036bc26e24cf7eef`.

- Preflight mới chụp đủ định nghĩa/owner/security/volatility/config/ACL của bảy signature nguồn và khớp capture đã kiểm chứng. Hai bản vá production khác đã có trước lượt apply (akaMap và helper timeout staff) được giữ nguyên.
- 35 kiểm tra trên PostgreSQL **17.11 local** đạt, gồm concurrency/CAS/receipt, reset commit mất phản hồi, quota, ACL và rollback. Dry run toàn candidate trên akachat chạy kiểm tra rồi `ROLLBACK`; xác nhận bảng/cột v3 chưa tồn tại và RLS C chưa bật trước apply thật.
- Sau apply, hai RPC và ba helper khớp toàn bộ target trong `local-target.json`; **363 hàm aka_agent ngoài phạm vi** giữ checksum/thuộc tính. ACL/policy/RLS hiện có của staff và tổ chức không đổi. Hai bảng private có RLS và chỉ owner/service_role có quyền; hai index valid, không unique trên binding staff.
- Snapshot đã đánh dấu **13 nhóm v2 trùng / 49 staff**, tính cả inactive/deleted. Sau apply vẫn toàn bộ **1.737 staff ở version 2**, bảng receipt chuyển v3 có **0 hàng**: migration không tự chuyển binding hoặc trừ lượt đổi máy. Việc chuyển diễn ra khi client v3 xác thực thành công.
- Smoke production sau apply chạy trong transaction rollback: quyết định clean/trùng/manual/sai binding, auth của action cũ/mới, proof recovery và ACL đều đạt; không đổi binding/quota/receipt của khách. Sáu HTTP PostgREST chỉ đọc đạt, không lấy hàng khách hoặc dùng credential khách: API nhận action v3, từ chối thiếu credential/proof, trạng thái `legacyRecoveryAllowed=true` và staff `limit=0` vẫn tương thích.
- Advisors chỉ thêm hai thông tin [RLS enabled, no policy](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) cho hai bảng **private chỉ truy cập qua RPC**, đúng thiết kế. Không thêm lỗi/cảnh báo trong phạm vi v3; các vấn đề ngoài phạm vi giữ nguyên. Không bật RLS C để xử lý chúng trong lượt này.

Receipt: [apply/checksum](../migrations/snapshots/device-identity-v3/production-apply.json), [capture trước](../migrations/snapshots/device-identity-v3/production-before.json), [capture sau](../migrations/snapshots/device-identity-v3/production-after.json), [dry run rollback](../migrations/snapshots/device-identity-v3/production-dry-run.json), [smoke sau apply](../migrations/snapshots/device-identity-v3/production-post-smoke.json), [HTTP](../migrations/snapshots/device-identity-v3/production-http.json), [advisors](../migrations/snapshots/device-identity-v3/production-advisors.json).

**RLS C vẫn chưa apply; app chưa đóng gói/phát hành trong lượt này.** Không apply lại v3. Sửa RPC live về sau phải capture/checksum và dùng migration mới. Giới hạn kiểm tra Windows/Mac Intel thật và bộ cài ở trên vẫn còn.

## Kiểm chứng trước PR — 27/10/2026

Nhánh PR dựng trên `dev_3` tại `3ba161c1`, đã gồm bản sửa timeout staff của PR #556. Hai typecheck, 65 ca client v3, 35 ca SQL v3 PostgreSQL 17.11, 132 ca SQL RLS tích hợp, 40 ca auth v2, 59 ca staff client và smoke đổi máy đều đạt. Diễn tập C/rollback và guard 44 hàm đã kiểm chứng lại trên PostgreSQL local với đúng nội dung PR; thay thế giới hạn chưa kiểm chứng lại C ở lượt sửa reset trước đó. Electron renderer và hardware Mac ARM64 qua hai process đều đạt.

Build Desktop đạt trong 25,69 giây (39.259.943 byte), Server trong 1,64 giây (2.432.576 byte), chạy tuần tự. `git diff --check` sạch; canonical SQL v3 giữ nguyên checksum đã apply. [Receipt trước PR](../migrations/snapshots/device-identity-v3/pr-verification.json) và [132 kiểm tra RLS](../migrations/snapshots/device-identity-v3/rls-verification-pg17.json) ghi kết quả. Lượt chuẩn bị PR không thay đổi production, bật RLS C, đóng gói hay phát hành app; các gate phần cứng/bộ cài vẫn giữ nguyên.
