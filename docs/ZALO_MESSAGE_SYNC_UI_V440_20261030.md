# Cờ tổ chức và mốc ngày đồng bộ — V440

**Đã deploy bản sửa UI sau review lúc 16:48 VN, 30/10/2026**, từ repo chính
ChatWeb `dev`/`7772ed6`: tắt/bật cờ tổ chức chỉ ẩn/hiện form, giữ khoảng ngày
của request đang chờ. Chỉ cập nhật image Web; API/worker/runtime giữ nguyên
image/config/instance. 158 file source API live khớp repo chính `a16cfc4`.
Không apply DB hoặc đổi tài nguyên/pool. Health API/Web và hash JS công khai đạt.
Có 21 lỗi proxy PC01/PU05 trong vài giây restart, không có lỗi sau hậu kiểm health.
Receipt mới: `akaAgentChatWeb/docs/audits/message-sync-main-deploy-20261030/deployment-receipt.json`.
Receipt phía dưới là bản rollout ban đầu, được giữ làm lịch sử.

Đã apply và deploy theo yêu cầu ngày 30/10/2026:

- Akachat `cgjbsmqtfhqvttudyjzq`, ledger **20261030085919** lúc 15:59:19 VN.
  Không apply lại V440 hoặc V437–V439.
- Cột `public.org_organization.zalo_message_sync_enabled boolean NOT NULL DEFAULT false`.
  Chỉ org 1 true. Đây là cờ hiển thị, không đổi quyền API hoặc giới hạn ngày backend.
- UI chỉ có 7/30/90/360/720 ngày/Tuỳ chọn; tuỳ chọn nhận số nguyên 1–720.
  360/720 gửi custom-days theo protocol cũ. Giữ mốc 0 giờ VN/phone-only filter.
- API máy `7845747fe073e8` deploy 16:00:18 VN; Web `7847d95cd4ddd8`
  16:01:27 VN. Chỉ đổi image; giữ CPU/RAM/pool/replica. Worker và runtime giữ
  nguyên image/config/instance, không deploy hoặc restart.
- Rehearsal ROLLBACK và hậu kiểm production đạt: trường org khác và projection
  order không đổi, RLS/ACL/sáu trigger/năm function liên quan giữ nguyên.
- Health API/Web, HTTP account flag true org 1/false org đối chứng và hash chunk
  công khai đạt. Web lint/build/194 tests đạt. Runtime running/220 accounts,
  lastError=null sau reconnect control socket. Không tự test sync hoặc gửi tin Zalo.
- Web có bảy lỗi proxy PU05 lúc restart, không còn sau kiểm tra health.
  Không coi deploy một machine là không gián đoạn request.

Canonical SQL/audit/receipt ở repo **akaAgentChatApi**:

- `migrations/migration_v440_zalo_message_sync_org_ui.sql`
- `migrations/snapshots/message-sync-org-ui-v440/apply-receipt.json`
- `docs/ZALO_MESSAGE_SYNC_UI_V440_20261030.md`
- `docs/audits/message-sync-ui-v440-20261030/deployment-receipt.json`

Source đã merge qua PR111/API và PR73/Web; repo chính lần lượt ở `a16cfc4` và
`7772ed6`. Hai worktree và nhánh local `codex/sync-ui-org-gate` đã dọn. Lần rollout
ban đầu dùng API base `09fe12a` và Web base `3056804`, giữ bản sửa cửa sổ lịch sử
đã deploy từ task khác. Không rollback Web về `180d9bb`, sao chép migration sang
akaAgent hoặc apply lại V440.

Nếu rollback app, giữ cột additive; API mới cần cột này để đọc account.
Không tăng pool/tài nguyên hoặc deploy runtime cho thay đổi giao diện này.
