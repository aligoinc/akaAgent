# Danh tính Zalo khi xác nhận phiên và đăng ký runtime — V452

V452 **đã apply 11:54:14 VN ngày 03/11/2026** trên `cgjbsmqtfhqvttudyjzq`,
ledger `20261103045414 / chat_runtime_identity_v452`. Không apply lại.
[Receipt/checksum/kiểm chứng](runtime-identity-receipt-20261103.json).
Chat API **đã deploy từ repo chính lúc 11:58:23 VN**, source `83d2736` và image
`chat-runtime-identity-main-83d2736-20261103`. Không cần cập nhật Desktop/App Server.

## Hành vi

- Trigger xác nhận `login_status` hoặc đổi cờ Chat dùng binding đã giữ lại khi
  owner, tenant, subtype, session, ID legacy và trạng thái xóa không đổi. QR mới
  vẫn kiểm actual UID qua receipt/claim; đổi phiên/ID/chủ/org và undelete vẫn đi
  qua reservation. `local_session(mark)` không tạo hoặc chuyển binding.
- Reservation kiểm binding canonical trước duplicate legacy. Chính chủ binding
  được đăng nhập lại; tài khoản khác vẫn bị từ chối. Chỉ dòng chưa có binding,
  Chat-enabled/logged-in mới giữ chỗ từ ID legacy, bao gồm lúc chờ tái sử dụng
  binding của dòng đã xóa. Không gộp tài khoản, đổi chủ hoặc chuyển lịch sử.
- Chat API đăng ký local dùng UID binding nếu đã liên kết, yêu cầu actual UID
  từ phiên được runtime xác minh khớp binding. Khi chưa có binding vẫn dùng
  legacy UID để kiểm candidate. Caller nội bộ thiếu UID chỉ qua được nếu legacy
  cũng khớp. Giữ mã `account_already_has_another_zalo` để Desktop không retry
  liên tục khi phiên thực sự sai. Giữ tenant/staff/package/session/ACL và generation.
- Metadata tên/avatar/phone từ legacy chỉ được cập nhật vào Chat khi UID khớp;
  nếu ID cũ lệch/NULL thì giữ profile Chat. Không đổi format/giao thức client.

## Phạm vi SQL và bảo toàn

| Exact signature | Source MD5 | Target MD5 |
| --- | --- | --- |
| `private.app_access_reserve_chat_identity(bigint,bigint,bigint)` | `e1b81ef404854cd4290496a9dfc0ff46` | `151cabcf20c6a5d2f76ff158ad1b72ea` |
| `private.app_access_reserve_enabled_identity()` | `66a710beb5d36f03d16d4684fd1a5385` | `c7a04ca3aad62ebcf30794cd440402a5` |

Capture live trước khi dựng SQL; guard cả 7 hàm/metadata liên quan. Hai hàm giữ
owner postgres, SECURITY DEFINER/VOLATILE, private ACL postgres-only, search_path,
cost/parallel/strict/leakproof. V449/V450/V451, quota, auth/IP và timeout giữ nguyên.
Không thêm schema/index, cấp quyền, pool, connection source, polling hoặc replica.
Các index theo `auto_account_id`, `zalo_id`, `zalo_account_id` và PK đã có sẵn.
Không đổi business rows/session của khách hàng, không explicit reload PostgREST.

Source: [migration](../../../migrations/migration_v452_chat_runtime_identity.sql),
[baseline và SQL thử/rollback](../../../migrations/snapshots/chat-runtime-identity/).
Rollback chỉ hai hàm từ đúng checksum V452 về V451, không đổi policy/ACL; chỉ
dùng nếu được yêu cầu và vẫn còn khớp live, ưu tiên sửa tiếp khi có patch mới.
Lỗi P2 riêng về thứ tự khóa binding/account vẫn ngoài phạm vi.

## Kiểm chứng

- **270 ca PostgreSQL 17 đạt, gồm 40 ca mới**: ba regression cũ, full repository
  Server QR completion với profile giả lập, local registration, status mark theo
  caller, quyền UPDATE theo cột của Desktop, wrong UID, missing legacy ID,
  unchanged profile, normal profile refresh, tenant/staff/owner/session revoke,
  deleted-binding reuse/reservation, hai client tranh identity, QR claim/receipt
  thật trong DB local và late QR sau revoke, drift và rollback/reapply.
- Trial production kết thúc ROLLBACK, kiểm checksum/ACL/config của hàm thật và
  hành vi qua mirror table/function tạm có tiền tố `v452_`. Mirror chỉ đổi schema
  tham chiếu; không thay logic và không ghi row/sequence của khách hàng. Giới hạn:
  mirror không thay thế kiểm thử HTTP/provider; native PG kiểm public entrypoint.
- Hậu kiểm live và mirror smoke ROLLBACK đạt, năm hàm bảo vệ còn lại giữ checksum.
- Hai typecheck và build akaAgent, build/typecheck Chat API đạt. Full API có
  1.754/1.756 đạt, hai ca phone-history timeout 5s khi chạy cùng các kiểm tra khác;
  chạy riêng hai ca cùng nhóm liên quan đạt 19/19. Sau thay đổi cuối, 17 ca quản lý
  tài khoản đạt lại. Không đổi timeout test hoặc timeout production để che lỗi.
- Chưa canary quét QR thật/UI/provider; không gửi tin hoặc chạy chiến dịch test.

Trong Chat API, chạy `PHASE1_PG_BIN=/path/to/postgresql17/bin
AKA_AGENT_REPO=/absolute/path/to/akaAgent node load-tests/app-access.mjs` sau build.
Module mới `app-access-runtime-identity.mjs` chạy mặc định; diagnostic V451 cũ chỉ
còn là bằng chứng lịch sử và cần checkout trước V452 để tái hiện lỗi cũ.

## Triển khai API và hậu kiểm

- Build từ `/Users/lequangnhut/Repos/akaAgentChatApi`, commit
  `83d2736f7d323bfaf03d9f0698c413c3662a0020`; local branch `dev` fast-forward từ
  feature commit, chưa push/merge remote. `labs/` cục bộ được loại khỏi build context.
- Chỉ cập nhật image API machine `7845747fe073e8` lúc 11:58:23 VN;
  digest `sha256:f377a780a56febd3f53c786e5c1c06d17fc51db050702f3ec79bee3488d5d41a`.
  SHA-256 source và compiled repository trong image khớp bản primary.
- Full config API chỉ đổi image. Worker/runtime giữ image, config và instance;
  không restart, tăng pool, tài nguyên hoặc replica.
- Hậu kiểm 11:58:46 VN: `/health/live` và `/health/ready` HTTP 200, mọi ready check
  đạt; 9 runtime / 228 account kết nối lại, campaign realtime listener connected.
  Có 16 realtime client tại snapshot sau deploy (trước đó 20), không giả định
  số client cố định. `/api/chat/zalo/accounts` không đăng nhập trả 401.
- Security advisor DB: 9 trước / 9 sau / 0 mới. Chưa canary provider/QR thật.
- Không deploy Chat Web/WebApp/CRM, worker hoặc Zalo runtime; không phát hành bộ cài.
