# V623 — đồng bộ akaBiz Auto sang akaAgent

- Migration: `../../migration_v623_akabiz_auto_sync.sql`; gỡ: `../../rollback_v623_akabiz_auto_sync.sql`.
- Trạng thái: **đã apply akachat 11:04:49 VN 22/11/2026** (sổ `20261122040449`, không apply lại); [biên nhận](apply-receipt.json).
- Kiểm trước khi tạo: CHECK `akabiz_zalo_import_history_source_system_check` đúng bản V420 (`source_system = 'akabiz_main_sql'`), hàm mới chưa tồn tại.
- Kiểm sau: md5 `pg_get_functiondef` của `public.akabiz_import_auto_desktop_v1(jsonb)` = `f4ae76455879213d60526bc6cc20a805`.
- Trigger hạn mức `public.enforce_zalo_account_capability_and_quota` đọc ngày 22/11/2026 (md5 `7668b1e0957c6b389c435f0134c0eb94`) là trigger mà hàm mới dựa vào khi tạo tài khoản Zalo; bản chép nằm ở akaAgentWebApp `apps/api/src/modules/akabiz-auto-sync/__fixtures__/akabiz-auto-sync-live-triggers.sql`.
- Kiểm thử (PG16 tạm, kết thúc ROLLBACK / xoá cụm): akaAgentWebApp `AKA_AGENT_REPO=<repo này> sh scripts/test-akabiz-auto-sync-sql.sh` (47 bước, gồm áp lần hai bị từ chối, gỡ rồi áp lại), `npx tsx scripts/test-akabiz-auto-sync-e2e.mts`, `npx tsx scripts/test-akabiz-auto-sync-desktop-integration.mts`.
- Hợp đồng và thứ tự đưa vào dùng: akaAgentWebApp `docs/AKABIZ_AUTO_SYNC.md`.
