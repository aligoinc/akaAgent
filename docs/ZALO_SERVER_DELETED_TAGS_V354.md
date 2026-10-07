# Zalo Server bỏ qua tag akaBiz đã xóa — v354

Chiến dịch cấu hình tag A và B vẫn có thể giữ ID của B sau khi xóa B trong phần quản lý tag. RPC Server trước đây báo `server_campaign_tag_scope_invalid` và bỏ cả A; Local dùng core chung để lọc B và vẫn gắn A.

V354 chỉ bỏ `AND NOT t.is_delete` tại truy vấn xác minh scope của tag trong RPC Server. Tag vẫn phải tồn tại, thuộc đúng staff/tổ chức/account và nằm trong cấu hình chiến dịch. Core tag chung giữ nguyên, tự loại tag đã xóa; nếu tất cả tag đã xóa thì trả thành công/count 0. Giữ toàn bộ guard claim/unit/input/UID, thứ tự khóa, soft-pause drain và group alias. Giữ timeout 60 giây và việc không giới hạn 100 tag từ v353; không sửa Local/Chat/app, không tăng connection/pool và không cần build lại bộ cài.

## Nguồn và triển khai

- Project **akachat / cgjbsmqtfhqvttudyjzq**.
- Exact signature: `public.aka_agent_apply_zalo_server_campaign_tags(bigint,bigint,bigint,bigint,uuid,uuid,bigint,text,text,bigint[])`.
- Source MD5 `0116ee4872248f3286cdc727866add13`, khớp v353 live; không có patch DB-only ngoài dự kiến.
- Target MD5 `65cd07b8ae16017794e56977c2f76aff`.
- Owner postgres, SECURITY DEFINER, VOLATILE, search_path pg_catalog/public, statement_timeout 60s và ACL giữ nguyên.
- Core `aka_agent_internal_mutate_contact_tags(bigint,bigint,bigint[],bigint[],text)` giữ checksum `abafd33b61827378f82e5f47bc93db18`; Local `aka_agent_mutate_contact_tags(bigint,bigint,bigint[],bigint[],text,text,text)` giữ `5c8e5a68ee2b52e240d01386e05b90b6`. Định nghĩa và metadata hai hàm này không đổi.
- [Migration](../migrations/migration_v354_zalo_server_deleted_tags.sql) được dựng từ snapshot live hiện tại, preflight/postflight kiểm tra checksum và metadata của cả ba hàm, fail-closed nếu có thay đổi ngoài dự kiến. Không sửa SQL v352/v353 đã apply.
- Đã apply riêng `20261007031753 / migration_v354_zalo_server_deleted_tags` ngày 07/10/2026; SQL MD5 `99a02aef6ec2e25026b937545ac39d98`. History và migration cùng transaction, không DDL chuẩn bị history hoặc bulk-push. Signature/return/config/ACL không đổi nên không yêu cầu reload thủ công; DDL trigger hiện có vẫn tự phát thông báo khi CREATE OR REPLACE FUNCTION, không tắt trigger.

## Kiểm chứng

- Trước và sau apply đều chạy cùng một transaction ROLLBACK gồm guard suite v352, 101-tag suite v353 và [regression v354](../migrations/tests/migration_v354_zalo_server_deleted_tags_rollback.sql). Chỉ tạo/sửa dòng giả bằng ID tường minh, không tăng sequence fixture, không gọi Zalo hoặc sửa chiến dịch thật.
- Role anon: person và group đều gắn tag A khi B đã xóa, không gắn lại B; replay trả count 0. Tất cả tag đã xóa trả count 0 và không thay contact.
- Tag đã xóa nhưng sai staff, tổ chức, account hoặc chưa được chọn trong cấu hình vẫn bị chặn; contact không bị ghi một phần. Không ảnh hưởng contact khác, không khôi phục tag đã xóa.
- So sánh với RPC Local hiện hành bằng role service_role thực: cả hai ghi đúng tập tag còn hoạt động.
- Giữ guard sai token, input, người nhận, release/thay unit, quyền core và auth Local; soft pause, group alias và hơn 100 tag vẫn qua. Test v352 được cập nhật đúng một kỳ vọng cho tag đã xóa: từ lỗi sang count 0.
- Sau apply kiểm tra checksum/metadata live và diff xác nhận đúng một điều kiện thay đổi; core/Local byte-for-byte giữ nguyên. HTTP request thiếu token trả 400/P0001 đúng guard; REST limit 0 trả 200.
- [Rollback có guard](../migrations/snapshots/zalo-server-deleted-tags-v354/rollback.sql) đã được kiểm thử rồi ROLLBACK; xác nhận live vẫn ở checksum v354. Revert v354 trước khi rollback v353.
- Security advisors tiếp tục ghi nhận EXECUTE SECURITY DEFINER cho anon/authenticated có sẵn; v354 không thêm quyền. [Receipt](../migrations/snapshots/zalo-server-deleted-tags-v354/security-advisors.json), [hướng dẫn advisor](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable).

Receipts: [source](../migrations/snapshots/zalo-server-deleted-tags-v354/source.json), [manifest](../migrations/snapshots/zalo-server-deleted-tags-v354/manifest.json), [apply](../migrations/snapshots/zalo-server-deleted-tags-v354/apply.json), [after](../migrations/snapshots/zalo-server-deleted-tags-v354/after.json), [preapply](../migrations/snapshots/zalo-server-deleted-tags-v354/preapply-rollback.json), [postapply](../migrations/snapshots/zalo-server-deleted-tags-v354/postapply-rollback.json), [recovery](../migrations/snapshots/zalo-server-deleted-tags-v354/recovery-smoke.json), [HTTP](../migrations/snapshots/zalo-server-deleted-tags-v354/http-check.json).

DB đã áp dụng. Bản Server 8.1.1 đã build ở v353 tiếp tục dùng được; không có bộ cài mới trong v354. Không cài/restart VPS hoặc chạy lại chiến dịch trong task này. Không cần chạy lại typecheck/build vì không đổi TypeScript hoặc package.
