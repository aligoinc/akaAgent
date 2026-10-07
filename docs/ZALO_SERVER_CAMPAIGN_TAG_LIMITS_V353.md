# Zalo Server gắn tag akaBiz — bỏ giới hạn riêng v353

**Bản sửa kế tiếp:** [v354](ZALO_SERVER_DELETED_TAGS_V354.md) đã áp dụng để bỏ qua tag đã xóa thay vì chặn cả lần gắn tag. Timeout/giới hạn và bộ cài của v353 giữ nguyên; revert v354 trước khi dùng rollback v353 dưới đây.

Theo yêu cầu người dùng, bản sửa chỉ giữ đường xác thực Server bằng parent claim + run-unit token đã có. Bỏ abort HTTP 20 giây trong `contactTagRepository`, bỏ trần 100 tag/lần gọi và function-local `lock_timeout=3s`; đặt `statement_timeout=60s` giống RPC tag Local hiện hành. Không có timeout vô hạn: sử dụng cấu hình RPC/transport chung. Giới hạn 100 **contact** trong core có sẵn từ Local vẫn giữ nguyên; đây là giới hạn khác với số tag vừa bỏ.

Retry vẫn giống Local: chỉ thêm tối đa hai lượt với `40P01`/`40001`, không retry auth/network/timeout và không gửi lại Zalo vì gắn tag lỗi. Lỗi tag ghi cảnh báo rồi tiếp tục; không thêm queue gắn bù. Giữ kiểm tra staff/organization/account, parent claim/unit/input/UID, cấu hình tag, thứ tự khóa, soft-pause drain, group alias và cách ghi tag/đồng bộ Chat của v352. Không sửa Chat/Local hay tăng connection/pool.

## Audit live

- Project: **akachat / cgjbsmqtfhqvttudyjzq**.
- Exact signature: `public.aka_agent_apply_zalo_server_campaign_tags(bigint,bigint,bigint,bigint,uuid,uuid,bigint,text,text,bigint[])`.
- Source MD5: `8f78a6f048faf4581b93674e16632ecd`; khớp bản v352 đã apply, không có patch DB-only mới.
- Target MD5: `0116ee4872248f3286cdc727866add13`.
- Owner postgres, SECURITY DEFINER, VOLATILE, ACL và search_path giữ nguyên. Chỉ đổi hai cấu hình timeout và điều kiện số lượng tag nêu trên.
- Core `aka_agent_internal_mutate_contact_tags(bigint,bigint,bigint[],bigint[],text)` giữ `abafd33b61827378f82e5f47bc93db18`; wrapper Local `aka_agent_mutate_contact_tags(bigint,bigint,bigint[],bigint[],text,text,text)` giữ `5c8e5a68ee2b52e240d01386e05b90b6`, toàn bộ metadata không đổi.
- [Migration v353](../migrations/migration_v353_zalo_server_campaign_tag_limits.sql) dựng từ [snapshot live](../migrations/snapshots/zalo-server-campaign-tags-v353/source.json), preflight checksum/owner/ACL/security/volatility fail-closed và postflight target/config. V352 giữ nguyên lịch sử.
- Đã apply riêng `20261007031133 / migration_v353_zalo_server_campaign_tag_limits`; SQL MD5 `f05ccd95580933adbe11801f4f724ea3`. Migration và history trong cùng transaction, không DDL chuẩn bị history, không bulk-push. DDL trigger hiện có cập nhật schema cache khi cấu hình RPC đổi; không thêm NOTIFY thủ công.

## Kiểm chứng

- Hai typecheck node/web sạch; smoke scheduler/repository thật và `run-contact-tag-sync-smoke.cjs` qua. Transport giả từ chối abort riêng, bảo đảm caller dùng hành vi chung như Local.
- Trước/sau apply: toàn bộ SQL guard regression v352 và [smoke v353](../migrations/tests/migration_v353_zalo_server_campaign_tag_limits_rollback.sql) chạy trong transaction ROLLBACK, chỉ dòng giả với ID tường minh, không gửi Zalo. Gắn 101 tag đúng cấu hình bằng role anon thành công, replay không ghi lại và contact khác không đổi.
- Sau apply xác minh checksum/config/owner/ACL; core và Local byte-for-byte như nguồn. HTTP RPC thiếu token trả đúng 400/P0001, REST đọc limit 0 trả 200.
- [Rollback có guard](../migrations/snapshots/zalo-server-campaign-tags-v353/rollback.sql) đã kiểm thử trong transaction ROLLBACK: khôi phục chính xác định nghĩa v352 rồi hủy thử nghiệm, giữ v353 live. Revert v353 trước khi dùng rollback v352.
- Receipts: [manifest](../migrations/snapshots/zalo-server-campaign-tags-v353/manifest.json), [after](../migrations/snapshots/zalo-server-campaign-tags-v353/after.json), [apply](../migrations/snapshots/zalo-server-campaign-tags-v353/apply.json), [preapply](../migrations/snapshots/zalo-server-campaign-tags-v353/preapply-rollback.json), [postapply](../migrations/snapshots/zalo-server-campaign-tags-v353/postapply-rollback.json), [recovery](../migrations/snapshots/zalo-server-campaign-tags-v353/recovery-smoke.json), [HTTP](../migrations/snapshots/zalo-server-campaign-tags-v353/http-check.json).

Không cài/restart app trên VPS và không sửa chiến dịch thật. DB đã nhận giới hạn mới; cần bộ cài 8.1.1 build lại để caller bỏ abort HTTP 20 giây. Chưa xác nhận lượt gắn tag thật từ bộ cài mới trên VPS.

Bộ cài Windows 8.1.1 đã build lại bằng `npm run build:server:win`; verifier executable Server/native MZ qua, native host đã restore. 107019601 bytes; SHA-256 `4d893be4bc96bdb75af3f3b39a2149e5a4bd9a9f4373088e8f541255639ef062`. [Build receipt](../migrations/snapshots/zalo-server-campaign-tags-v353/build.json). Bộ cài này thay thế bản 8.1.1 ban đầu trong cùng đường dẫn local; chưa phát hành/cài VPS.

Security advisors vẫn ghi nhận quyền EXECUTE SECURITY DEFINER của RPC này cho anon/authenticated đã có từ v352; v353 không thay ACL hay mở rộng quyền. [Receipt](../migrations/snapshots/zalo-server-campaign-tags-v353/security-advisors.json), [hướng dẫn advisor](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable). Các cảnh báo chung của hệ thống nằm ngoài phạm vi bỏ giới hạn tag.
