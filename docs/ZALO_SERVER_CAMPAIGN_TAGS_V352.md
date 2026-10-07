# Zalo Server gắn tag akaBiz — v352 / Server 8.1.1

**Cập nhật sau v352:** [v353](ZALO_SERVER_CAMPAIGN_TAG_LIMITS_V353.md) đã bỏ timeout riêng và giới hạn 100 tag theo yêu cầu người dùng. Nội dung/checksum/build receipt dưới đây ghi lại bản v352 ban đầu; dùng bộ cài 8.1.1 đã build lại và receipt trong audit v353.

## Nguyên nhân và bản sửa

Packaged Zalo Server dùng Supabase anon HTTP client và `runWithCurrentUser` theo staff, không có credentials đăng nhập Desktop. Trước bản sửa, `applyAkaBizTagsToZaloTarget` gọi `aka_agent_mutate_contact_tags` với username/password NULL; guard hiện hành trả `automation_auth_required`. Cấp thêm EXECUTE không giải quyết việc thiếu danh tính bên trong hàm.

Scheduler Server gọi `aka_agent_apply_zalo_server_campaign_tags` bằng parent claim + run-unit token đã có trong RAM, kèm campaign/account/input/type/UID/tag IDs. Không tìm credentials, không dùng service-role key, không thêm connection, pool, polling, claim hay timer. RPC tự tìm contact trong phạm vi đã xác thực; bỏ một lượt HTTP lookup contact so với đường cũ. HTTP timeout 20 giây; RPC cấu hình statement timeout 15 giây và lock timeout 3 giây. Chỉ retry tối đa hai lần với SQLSTATE 40P01/40001 (transaction đã rollback), không retry lỗi auth/network/timeout.

Guard kiểm tra staff active, organization, quyền QR/Server, account Server không phải Web, account active/đã đăng nhập, parent claim target/token, run-unit token đang giữ, input đang chạy thuộc unit, UID đúng input và tag đang bật trong cấu hình chiến dịch. Account/contact/tag phải cùng scope. Gắn group giữ alias bỏ tiền tố `g`. Luồng tìm SĐT lưu UID vào input trước khi gọi RPC; các luồng UID giữ UID gốc. Khóa theo thứ tự staff → entitlement barrier → campaign input serialization → input → campaign/account, như RPC claim/content allocator hiện hành. Soft pause vẫn cho chốt lượt đang giữ; release/thay token/settle input chặn lượt cũ.

Luồng Desktop (kể cả vận chuyển Zalo từ xa) vẫn gọi RPC credential cũ. Cách ghi tag live v290 được tách nguyên body sang helper nội bộ không có EXECUTE cho PUBLIC/anon/authenticated/service_role; wrapper Desktop giữ auth, owner, ACL, security mode, volatility và config. Giữ đồng bộ Chat system tags, batch GUC restore kể cả exception, queue/projection và local fallback/dedupe/add/remove. Không sửa `auto_assert_automation_identity` hoặc RPC Chat/Web.

Giữ thời điểm gọi tag hiện có (có luồng gắn khi resolve target, có luồng group sau gửi); lỗi tag chỉ cảnh báo, không làm gửi lại tin nhắn. Giữ bỏ qua birthday/share/không bật tag. Không backfill tag cũ hay chạy lại chiến dịch.

## Audit nguồn live và checksum

Project: **akachat — cgjbsmqtfhqvttudyjzq**. Nguồn lấy bằng exact `to_regprocedure` + `pg_get_functiondef`, owner/prosecdef/provolatile/proconfig/proacl trước khi viết SQL, lưu tại [source.json](../migrations/snapshots/zalo-server-campaign-tags-v352/source.json). Hàm tag live khớp nguyên bản v290; không có patch DB-only khác bị bỏ. Common core được so sánh byte-for-byte với body live sau khi bỏ duy nhất dòng kiểm tra credential. Migration có preflight checksum/metadata fail-closed và từ chối target đã tồn tại.

Tất cả signature dưới đây thuộc schema `public`:

| Signature | Source md5 | Target md5 |
| --- | --- | --- |
| `aka_agent_mutate_contact_tags(bigint,bigint,bigint[],bigint[],text,text,text)` | `2e2d262fa88fd2be5051c2e3aac35f9c` | `5c8e5a68ee2b52e240d01386e05b90b6` |
| `aka_agent_internal_mutate_contact_tags(bigint,bigint,bigint[],bigint[],text)` | Chưa tồn tại | `abafd33b61827378f82e5f47bc93db18` |
| `aka_agent_apply_zalo_server_campaign_tags(bigint,bigint,bigint,bigint,uuid,uuid,bigint,text,text,bigint[])` | Chưa tồn tại | `8f78a6f048faf4581b93674e16632ecd` |

Hai wrapper SECURITY DEFINER, helper SECURITY INVOKER; owner postgres; VOLATILE; search_path cố định pg_catalog, public. ACL helper chỉ postgres. Metadata đầy đủ: [targets.json](../migrations/snapshots/zalo-server-campaign-tags-v352/targets.json).

Dependency giữ nguyên: `auto_assert_automation_identity(bigint,bigint,text,text)` = `5a9a503db72b965eb644739f5f60905d`; `resolve_organization_zalo_account_capabilities(bigint)` = `46412e94cf00a788230835f6d56d8d3b`; `aka_agent_lock_campaign_input_serialization(bigint)` = `74c082aacb1de27a8cedff2e824f219f`.

## Kiểm chứng và triển khai

- Hai typecheck node/web sạch; production build Desktop qua.
- `node scripts/zalo-server-campaign-tags-smoke-test.cjs`: scheduler/repository thật với transport giả; không credentials/lookup trên Server, giữ Desktop, thiếu token/input, retry rollback có giới hạn, đủ sáu callsite, SĐT lưu UID trước RPC, lỗi tag group không retry send, disabled/birthday/share.
- `node scripts/run-contact-tag-sync-smoke.cjs`: RPC tag cũ/batch/delta/retry/auth/cleanup qua.
- [SQL smoke](../migrations/tests/migration_v352_zalo_server_campaign_tags_rollback.sql) chạy trước và sau apply trong transaction **ROLLBACK**, chỉ tạo dòng giả với ID tường minh, không sửa chiến dịch thật hay tăng sequence fixture: anon add/replay, sai scope/token/input/UID/tag, tag/contact đã xóa, unit/claim đã thay hoặc release, Desktop owner, soft pause, group alias, core ACL, legacy auth và add/remove. Không gọi Zalo.
- Smoke `send-exclusion-runtime-smoke.cjs` cũ lỗi `clearQrAccountRuntimeCache` đọc `.get` trên map chưa có trong fixture. Cả script và runtime tương ứng không đổi so với HEAD trong task này; không chỉnh phần đó. Đây không phải kết quả của smoke tag mới.
- Đã apply **riêng** [migration v352](../migrations/migration_v352_zalo_server_campaign_tags.sql) và lịch sử trong cùng transaction: `20261007025522 / migration_v352_zalo_server_campaign_tags`, ngày 07/10/2026. SQL md5 trong history: `cdd13d2e80ac93fa7c8ce267b57f586c`. Không bulk-push migration khác.
- Sau apply, checksum/owner/security/volatility/config/ACL khớp targets; HTTP RPC trả đúng guard `400/P0001/server_campaign_tag_claim_required` cho request thiếu token; REST read limit 0 trả 200. Không phát thêm NOTIFY reload thủ công vì API đã nhận metadata mới.
- [Rollback có guard](../migrations/snapshots/zalo-server-campaign-tags-v352/rollback.sql) phục hồi đúng body nguồn rồi xóa hai hàm mới. Phải phối hợp với binary trước rollback; không tự chạy rollback trên production. Bản rollback đã được thử trong transaction rồi ROLLBACK để giữ bản triển khai.

**Cần cài Server 8.1.1 trên VPS.** Chỉ sửa DB không đổi đường gọi của binary 8.1.0. Không restart VPS/campaign trong task này, chưa xác nhận một lượt gắn tag thật từ binary mới trên VPS. Sau cài, quan sát một lượt tag đang bật: có log “Đã gắn tag akaBiz” và contact chứa tag; không còn `automation_auth_required` ở luồng Server.

Bộ cài Windows x64 đã build bằng `npm run build:server:win`, verifier Server/native MZ qua và native host đã restore. File `dist-server/akaAgent-Zalo-Server-Setup-8.1.1.exe` (107,021,084 bytes), SHA-256 `3cca6b487f3b52c36d2c7e9be44210d63c5741ec3828b13207e00d3df0546748`; `app.asar` SHA-256 `fa013d1ec650649680edcd4008ba8d2c7b121152a8d6ecafc50f66d7adee2773`. Receipt: [build.json](../migrations/snapshots/zalo-server-campaign-tags-v352/build.json).
