# SQL Account akaBiz

> Chuyển từ AGENTS.md ngày 28/10/2026, dòng 290–297. Nội dung và ràng buộc được giữ; chỉ sửa đường dẫn Markdown.
> Trạng thái “đã/chưa apply/deploy/phát hành” bên dưới là lịch sử. Đối chiếu [CURRENT_STATE](../CURRENT_STATE.md), audit mới nhất và live trước mọi thao tác. Không coi ghi chú quyền cũ là cho phép mở lại quyền.

<!-- BEGIN PRESERVED SOURCE -->
## Chuyển SQL Account akaBiz

API ở repo akaBizApi gọi `akabiz_migrate_sql_account_v1(jsonb)` qua service_role ([v285](../../../migrations/migration_v285_akabiz_sql_account_migration.sql)); `org_organization.sql_account_id` là dấu hoàn tất (không có ràng buộc unique), nhiều org có thể cùng phone/customer. Trigger quota chỉ cho import backend bỏ kiểm tra active/expiry/quota trong ngữ cảnh org của RPC; các guard runtime/claim khác giữ nguyên, không đặt `sql_staff_id` cho nhân viên khách. Shop SQL chưa có UID vẫn được tạo với `zalo_account_id=NULL`, trạng thái chưa đăng nhập; response có `skipped_products` cho quyền SQL ngoài phạm vi.

v285 đã apply ngày 18/09/2026; akaBizApi build local rồi deploy `--prebuilt --prod` tại `akabiz-api.vercel.app`. Checksum và rollback smoke live: [audit](../../../docs/SQL_ACCOUNT_MIGRATION_AUDIT.md), [smoke SQL](../../../migrations/tests/migration_v285_sql_account_migration_smoke.sql).

Zalo Server tiếp nhận session mới chưa xác minh qua discovery 60 giây, kể cả runtime staff đang chạy; [zaloServerSessionRestorer.ts](../../../src/server/main/zaloServerSessionRestorer.ts) dùng reservation + claim `requires_login=false`, rồi xác thực và lưu profile/liên kết Zalo cùng trạng thái đăng nhập với điều kiện session chưa đổi; startup cũng dùng luồng này. Chỉ xét account Server active có session và `zalo_session_last_verified_at IS NULL`, không chạy tenant Chat; hàng đợi tối đa 25 staff với lượt độc lập, lỗi tạm thời backoff 1–15 phút, phiên chắc chắn hỏng chờ session mới, cleanup chưa xác nhận vẫn giữ khóa. Không cần migration DB; kiểm chứng bằng `node scripts/zalo-server-session-restore-smoke-test.cjs`, xem [hướng dẫn](../../../docs/ZALO_SERVER_SESSION_RESTORE.md).


<!-- END PRESERVED SOURCE -->
