# Kích hoạt V447 — 03/11/2026

**Đã apply V447 trên `akachat / cgjbsmqtfhqvttudyjzq` lúc 06:07:41 Việt Nam
ngày 03/11/2026.** Ledger: `20261102230741 / migration_v447_app_access_activate`.
`private.app_access_policy_enabled()` đã trả `true`; không apply lại migration.
[Receipt activation](activation-receipt.json) ghi checksum, ledger và hậu kiểm.

Thực hiện theo yêu cầu trực tiếp “ok apply migration V447 đi”, sau khi backend,
Chat Web/WebApp đã deploy, người dùng xác nhận cài Server 9.2.0 và ba bộ cài
Desktop 9.2.0 đã build từ repo chính. Desktop vẫn là bộ cài local, chưa được
agent upload/phát hành. Chỉ thị activation mới này thay bước chờ phát hành
trong quyết định rollout trước PR; không cần đợi toàn bộ người dùng cập nhật.
Máy cũ thuộc tổ chức từng có product 5 cần cập nhật để dùng đầy đủ luồng mới.

## Phạm vi và đối chiếu live

- Dùng canonical `migrations/migration_v447_app_access_activate.sql` từ repo
  chính `dev_3` tại `d493dd9e3b2dde04ffb73afaed8c3ddbd64dc178`; không sửa SQL.
- Capture mới đủ 55 exact signatures: 42 target functions, hai private auth
  patches và 11 runtime dependencies. Body MD5, owner, ACL, security mode,
  volatility, config, policy account và view staff đều khớp manifest trước apply.
- Chỉ đổi body `private.app_access_policy_enabled()` từ `SELECT false` thành
  `SELECT true`: MD5 `c6fd7d3a914f343d1b1baacd135c5ddf` →
  `8f87111c086e0e81364c0bad0ccbe65a`. Owner `postgres`, ACL
  `{postgres=X/postgres}`, invoker, STABLE, `search_path=pg_catalog` giữ nguyên.
- 54 function còn lại, bao gồm auth có chặn IP và các hàm claim/receipt/cleanup,
  giữ nguyên definition và metadata. Policy/view không đổi; không cấp quyền mới.
- Apply qua Supabase MCP, bỏ BEGIN/COMMIT ngoài cùng của canonical để dùng
  transaction/ledger của công cụ, thêm hậu kiểm metadata đã thử trước commit.
  Giữ `lock_timeout=5s`, `statement_timeout=60s` và thứ tự khóa writer hiện có.

## Kiểm chứng

Trial activation kết thúc ROLLBACK đạt. Lần thử đầu lỗi tên biến/alias trong
SQL kiểm thử bổ sung; toàn bộ transaction đã rollback. Sửa riêng harness, giữ
canonical SQL và checksum guards; lần thử sau cùng hậu kiểm production đều đạt.
Sau trial xác nhận gate vẫn false, ledger chưa có V447 và chưa có receipt chốt
rollout, trước khi commit thật.

- Trial kiểm hash các trường dữ liệu cũ của 1.854 staff, 9.192 account và toàn bộ
  dòng product; giữ quyền đã cấp và `is_chat_sync`. Không cần đổi thêm cờ quyền
  trong dữ liệu tại thời điểm thử. Bốn receipt khởi tạo được chốt khi activation.
- Sau apply: **4 tổ chức dùng separate, 1.782 tổ chức giữ legacy**. Kiểm tra mode
  cho toàn bộ tổ chức, quyền legacy, cờ tắt, gói Chat hết hạn, quota staff theo org
  và quota account Zalo theo chủ/gói đều đạt.
- Smoke helper bằng `service_role` và `aka_agent_desktop`: mỗi role 100 staff,
  100 account, cả hai app; kết quả khớp evaluator. Token Desktop mô phỏng từ map
  Auth hiện có chỉ đọc state của mình, bị từ chối staff/account khác tenant và
  không được đọc trực tiếp `org_staff`. Không xuất token/password/session.
- Giữ nguyên body/metadata của guard held work, claim/token và cleanup. Không có
  held work trong 11 account của 4 tổ chức separate tại lúc hậu kiểm, nên chưa
  thử dừng producer thật. Gọi capture lại sau activation bị chặn; guard rollback
  cũ từ chối bằng `app_access_active_requires_roll_forward`. Smoke hậu kiểm nằm
  trong transaction READ ONLY kết thúc ROLLBACK.
- Metadata/ACL của Chat API và helper đạt; không chạy `SET ROLE aka_agent_chat_api`
  bằng Management API vì caller này không được cấp quyền đó. Không mở thêm quyền.
- 14/14 HTTP probes đạt: health/live/ready, hai web/domain và sáu endpoint quyền
  trả 401 cho request chưa đăng nhập. Monitor Server vẫn running, realtime
  connected, 226 account gắn runtime, heartbeat mới và lastError null.

Security advisor đã chạy; không có finding cho hàm gate được đổi. DB vẫn có
các advisory về bảng/view/hàm ngoài thay đổi V447; không coi lần kiểm này là
chứng nhận toàn bộ DB sạch hoặc tự sửa các advisory ngoài phạm vi.

## Giới hạn và vận hành

Không kiểm gửi tin/chạy chiến dịch thật, QR provider hoặc UI bằng phiên khách
hàng. Số runtime account và health không chứng minh mọi phiên Zalo đều thành công.
Hai lỗi P2 về duplicate legacy Zalo identity và lock order binding/account vẫn
được người dùng tạm hoãn; activation không sửa chúng.

Sau activation phải **roll forward**, không tắt gate hoặc dùng rollback cũ để
mở lại quyền đã thu hồi. V445/V446 và private auth patches không được apply lại.
Không sửa/deploy CRM, không deploy lại service, không phát hành bộ cài trong lượt
này. Không tăng connection/pool/worker/replica hoặc thêm polling. Không gửi lệnh
reload PostgREST riêng; event trigger DDL hiện hành không bị thay đổi/tắt.

Full capture, auth bodies, SQL trial và response nằm ngoài Git tại thư mục
private được ghi trong receipt. Source SQL migration giữ nguyên; tại mốc bàn giao
activation, audit và tài liệu trạng thái mới lưu local, chưa commit/push.
