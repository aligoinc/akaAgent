# Sửa thu hồi chia sẻ nhóm data sau giới hạn ownership

Trạng thái ngày 28/10/2026: **candidate đã kiểm thử local, chưa apply production**.
Target là akachat (`cgjbsmqtfhqvttudyjzq`); không cần build/deploy Desktop.

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

| Hàm | MD5 trước | MD5 candidate |
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

Không thực hiện migration, trial DDL hoặc cập nhật hàng khách trên production.
Không chạy lại typecheck/build Electron vì không sửa mã app. Syntax scripts và
`git diff --check` đạt.

Evidence nằm trong [group-sharing-revoke-ownership](../migrations/snapshots/group-sharing-revoke-ownership/):
`before.json`, `source-audit.json`, `target.json`, `local-test.json`,
`live-readonly-check.json`. Đối chiếu production read-only sau kiểm thử xác nhận
cả bảy checksum/owner/ACL vẫn là nguồn ban đầu; candidate chưa được apply.
Generator [group-sharing-revoke-ownership-generate.cjs](../scripts/group-sharing-revoke-ownership-generate.cjs)
chỉ đọc capture; khẳng định mọi nội dung ngoài block khóa được bảo toàn.

## Rollout và rollback

Khi được yêu cầu apply, xác nhận lại bảy dependency rồi chạy riêng candidate trong
một transaction, hậu kiểm body/metadata và role access. Không chạy lại ownership
hoặc migration staff/directory cũ. Chưa cần deploy hoặc đóng gói client.

[Rollback riêng](../migrations/rollback_group_sharing_revoke_ownership_compat.sql)
chỉ phục hồi body chia sẻ source, không mở ownership hoặc anon. Nó khôi phục lại
lỗi thu hồi nên chỉ dùng khi có chỉ thị, qua
`SET LOCAL aka_agent.group_sharing_revoke_rollback='approved'` trong transaction;
guard từ chối mọi target/dependency drift. Không cập nhật checksum để vượt guard.
