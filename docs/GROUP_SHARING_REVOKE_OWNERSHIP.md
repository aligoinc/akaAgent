# Sửa thu hồi chia sẻ nhóm data sau giới hạn ownership

**Đã apply trên akachat (`cgjbsmqtfhqvttudyjzq`) lúc 13:41:38 VN ngày 28/10/2026**,
ledger `20261028064138 / group_sharing_revoke_ownership_compat`.
Hậu kiểm hoàn tất lúc 13:42:23 VN. Không apply lại; không cần build/deploy Desktop.

Khi chủ nhóm bỏ người nhận hoặc chuyển nhóm data về riêng tư, RPC chia sẻ phải
dừng các nguồn `active`/`baselining` của người vừa mất quyền. Helper khóa campaign
được bổ sung guard ownership trước đó từ chối campaign của người nhận, làm toàn
bộ thao tác thu hồi bị rollback với `desktop_campaign_scope_denied`.

Migration mới [20261028042624_group_sharing_revoke_ownership_compat.sql](../supabase/migrations/20261028042624_group_sharing_revoke_ownership_compat.sql)
chỉ đổi nhánh thu hồi trong RPC
`public.aka_agent_group_sharing(bigint,bigint,text,text,text,jsonb)`.
Sau các bước xác minh token, credentials, chủ nhóm, tổ chức, recipient và revision
hiện có, vòng lặp dùng trực tiếp đúng validation ID và transaction advisory lock
của helper đang chạy. Giữ nguyên namespace
`aka-agent-campaign-input-serialization:`, thứ tự group → campaign và thứ tự ID.
Không đổi role, claims hay thêm cờ bỏ kiểm tra quyền.

Helper public `aka_agent_lock_campaign_input_serialization(bigint)` cùng các guard
ownership giữ nguyên: client vẫn không thể khóa/đọc/sửa/ghi log campaign khác
staff. Quyền anon, bảng/cột, RLS, policy, trigger, dữ liệu và các RPC khác không đổi.
Campaign đang chạy và input đã có không bị pause/xóa/reset; chỉ source của người
vừa mất quyền chuyển sang `stopped`, `stop_reason='sharing_revoked'` như trước.
Cấp lại quyền không tự kích hoạt source đã dừng. Timeout RPC vẫn 60s; không thêm
query HTTP, connection/pool, polling hoặc thay đổi format trả về.

## Nguồn live và kiểm soát drift

Capture read-only mới lúc **11:25:52 VN ngày 28/10/2026** gồm bảy định nghĩa liên
quan, owner/security/volatility/config/ACL và constraints/triggers của source.
Không lấy body lịch sử để ghi đè live. Đã tìm tất cả migration đề cập hai hàm;
body chia sẻ khớp bản directory ngày 28/10, helper khóa khớp patch ownership.
Giữ các patch V409, V414, self-access và directory.

| Hàm | MD5 trước | MD5 sau apply |
| --- | --- | --- |
| `public.aka_agent_group_sharing(bigint,bigint,text,text,text,jsonb)` | `af95bdbae9bfc75343ddd96eda51dcc7` | `0e17dec0570937cfea8a1ae035e2af4d` |
| `public.aka_agent_lock_campaign_input_serialization(bigint)` | `ca07284b7f0f0a3ab5a6ee7c8e745ab6` | Không đổi |

Preflight kiểm tra checksum/owner/ACL của cả bảy dependency trước khi thay body;
checksum định nghĩa cũng bao gồm config/security/volatility. Bất kỳ drift hoặc
signature thiếu đều dừng. Postcondition kiểm tra target và sáu dependency không
đổi. Không reapply nếu candidate đã được triển khai, không bulk-push migration cũ.

## Kiểm chứng

`node scripts/group-sharing-revoke-ownership-smoke.cjs` đạt **9 nhóm PostgreSQL 17
local**, dùng metadata live, source constraints/triggers và dữ liệu giả:

1. Tái hiện lỗi trước sửa ở cả chuyển riêng tư và bỏ một recipient.
2. Từ chối drift body/config, ACL hoặc helper; trial migration kết thúc ROLLBACK
   giữ nguyên metadata.
3. Sau apply local chỉ body chia sẻ đổi; helper/ACL/timeout/RLS/policy/trigger giữ
   nguyên, reapply bị chặn.
4. Dừng đúng source active/baselining; giữ source của chủ nhóm, nhóm khác, source
   terminal, campaign và input.
5. Chuyển selected/organization giữ người còn quyền; regrant không tự chạy lại.
6. Người không sở hữu nhóm, giả staff bằng credentials khác, claims thiếu,
   recipient khác org và revision sai đều bị từ chối, không thay đổi dữ liệu.
7. Gọi trực tiếp helper/đọc/sửa/ghi log campaign khác staff vẫn bị từ chối;
   anon giữ khóa, backend và chia sẻ nội dung trả kết quả như trước.
8. Hai session local xác nhận cùng khóa public: lock thứ hai đang bận làm rollback
   cả source thứ nhất đã xử lý và thay đổi chia sẻ; nhả khóa thì thao tác thành công.
9. Rollback có approval/drift guard khôi phục đúng body và tái hiện lại lỗi cũ.

Các kiểm thử local trên không truy cập production. Bước apply và hậu kiểm
production được ghi riêng bên dưới. Không chạy lại typecheck/build Electron trong
lượt apply vì không sửa mã app; hai typecheck/build đã đạt trước PR #564.
Syntax scripts và `git diff --check` đạt.

Evidence nằm trong [group-sharing-revoke-ownership](../migrations/snapshots/group-sharing-revoke-ownership/):
`before.json`, `source-audit.json`, `target.json`, `local-test.json`,
`live-readonly-check.json`. Capture này ghi trạng thái trước apply: cả bảy
checksum/owner/ACL còn là nguồn ban đầu.
Generator [group-sharing-revoke-ownership-generate.cjs](../scripts/group-sharing-revoke-ownership-generate.cjs)
chỉ đọc capture; khẳng định mọi nội dung ngoài block khóa được bảo toàn.

## Apply production — 28/10/2026

Sau khi PR #564 merge và repo chính đồng bộ `dd250481`, người dùng yêu cầu apply.
Capture mới lúc 13:39:46 VN xác nhận đầy đủ bảy định nghĩa/owner/ACL/security mode/
volatility/config khớp nguồn đã review; migration chưa có trong ledger.

[Bộ sinh kiểm tra production](../scripts/group-sharing-revoke-ownership-production.cjs)
chỉ sinh SQL, không có lệnh apply hoặc tự kết nối. Đã chạy chính script diễn tập và
hậu kiểm trên PG17 local cùng chín nhóm hồi quy: tổng chín nhóm và hai kiểm tra
triển khai đạt. Trên production, Management API chạy migration + role checks +
rollback riêng trong transaction rồi ROLLBACK toàn bộ. Đối chiếu sau diễn tập
xác nhận cả 1.255 hàm và fingerprint metadata ban đầu giữ nguyên.

Chỉ migration đã merge được apply qua Supabase `apply_migration`, SHA-256
`8bd5c09449dd714df9a133003537c70bb79a45c6ec35a262aa180f8759f00570`.
Không bulk-push hoặc chạy lại các migration staff/directory/ownership đã live.

Hậu kiểm xác nhận:

- RPC chia sẻ có MD5 đích `0e17dec0570937cfea8a1ae035e2af4d`, giữ owner/ACL,
  SECURITY DEFINER, volatility, search path và timeout 60s.
- 1.254 hàm khác, quyền bảng/cột, RLS, view, policy và trigger giữ fingerprint.
- Sáu mapping Auth thật vẫn đọc đúng danh sách ID+tên cùng org; giả staff,
  đọc/khóa campaign khác staff, claims thiếu và anon đều bị chặn. Backend giữ scope.
- Không ghi dữ liệu nghiệp vụ khách; credentials chỉ dùng trong transaction DB,
  không trả về client/log. Luồng thu hồi thành công và tranh chấp khóa được kiểm
  tra với dữ liệu giả local, không thay đổi chia sẻ thật để thử.
- Security advisors trước/sau đều chín mục cũ, không thêm mục mới hoặc mục liên
  quan RPC chia sẻ.

Receipt: [apply-receipt.json](../migrations/snapshots/group-sharing-revoke-ownership/apply-receipt.json).
Capture trước/sau, kết quả diễn tập và SQL kiểm tra nằm cùng thư mục. Không cần
đóng gói hoặc deploy client; bản app hiện tại nhận bản sửa ở lần gọi RPC tiếp theo.

## Rollback

[Rollback riêng](../migrations/rollback_group_sharing_revoke_ownership_compat.sql)
chỉ phục hồi body chia sẻ source, không mở ownership hoặc anon. Nó khôi phục lại
lỗi thu hồi nên chỉ dùng khi có chỉ thị, qua
`SET LOCAL aka_agent.group_sharing_revoke_rollback='approved'` trong transaction;
guard từ chối mọi target/dependency drift. Không cập nhật checksum để vượt guard.
