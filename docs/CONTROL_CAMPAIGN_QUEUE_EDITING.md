# Sửa chiến dịch khi tài khoản đang bận

Các endpoint thêm data độc lập và nguồn Nhóm data được rà soát/sửa tiếp trong [v288](CONTROL_CAMPAIGN_QUEUE_DATA.md); v287 bên dưới chỉ sửa core update và append nằm trong update.

## Nguyên nhân và hành vi

Bản v282 ngày 15/09/2026 chỉ bỏ điều kiện trạng thái tài khoản trong các RPC **tạo** chiến dịch. Smoke v282 kiểm tra tạo mới, idempotency và scheduler; không gọi RPC **sửa**. Luồng sửa đầy đủ của WebApp gọi `update_control_campaign_by_config_version_atomic`, rồi gọi `update_control_campaign_atomic`, nên vẫn bị điều kiện cũ từ chối khi tài khoản chạy chiến dịch/tác vụ khác. API ánh xạ `not_found` thành thông báo tài khoản không còn khả dụng.

[Migration v287](../migrations/migration_v287_edit_control_campaign_while_account_running.sql) bỏ đúng năm điều kiện `account.status`/`target_account.status` trong core update: hai lần kiểm tra tài khoản hiện tại, hai lần kiểm tra tài khoản thay thế cho tài khoản cũ đã xoá và một lần kiểm tra tài khoản đích. Không thay bằng một danh sách trạng thái được phép khác. Sửa chiến dịch đang chờ/tạm dừng không phụ thuộc trạng thái chạy của tài khoản.

Chính chiến dịch đang chạy vẫn bị từ chối. Không ghi trạng thái tài khoản, không giải phóng hoặc chiếm runtime token, không tự chạy chiến dịch. Giữ nguyên staff/organization, platform/subtype, active/deleted, khoá, kiểm tra version, SMS materialization và append idempotency. Hai entrypoint update được thêm function-local `statement_timeout=60s` theo quy định RPC bulk vì chúng có thể materialize/append nhiều dòng. Scheduler và các RPC tạo không đổi.

Không cần cập nhật frontend hoặc binary. Form đang mở có thể lưu lại ngay; xung đột cấu hình thật vẫn yêu cầu tải lại như trước.

## Audit và triển khai

Áp dụng ngày 20/09/2026 lên linked production **akachat**, project ref `cgjbsmqtfhqvttudyjzq`, qua `supabase db query --linked --file`. Chỉ áp dụng v287. Migration và ghi lịch sử nằm cùng transaction; dùng bảng history hiện hữu, không chạy DDL chuẩn bị schema hoặc bulk-push các migration khác.

| Exact signature | Source checksum | Target checksum |
| --- | --- | --- |
| `public.update_control_campaign_atomic(bigint,bigint,bigint,timestamptz,jsonb,jsonb,boolean,text,integer,jsonb)` | `218ccf3eb631a84af633818939177db7` | `f285e48f4deaf2e1bf7896d7aeddbcf8` |
| `public.update_control_campaign_by_config_version_atomic(bigint,bigint,bigint,timestamptz,jsonb,jsonb,boolean,text,integer,jsonb)` | `4d824c50515201bc8410d7114bd3a8a7` | `3e1e2f8b67697d36b3c8c3830586a6c2` |

Đã capture `pg_get_functiondef()` và thuộc tính của đúng signature live trước khi dựng migration. Core live bao gồm bản vá tài khoản cũ đã xoá ngày 04/09 (`20260904071108_allow_orphan_campaign_repair.sql`), mới hơn body v219/v241; bản vá này được bảo toàn. Wrapper giữ nguyên logic config version và retry do runtime cập nhật timestamp, chỉ thêm timeout.

Cả hai giữ owner `postgres`, `SECURITY DEFINER`, volatility `v`, ACL `{postgres=X/postgres,service_role=X/postgres}`. Config đổi từ `['search_path=public']` thành `['search_path=public','statement_timeout=60s']`. Preflight xác minh cả hai RPC trước DDL, chỉ nhận đúng source/target checksum và thuộc tính tương ứng; postflight kiểm tra lại trước commit. Reapply target là no-op. Không thêm `NOTIFY`; giữ cơ chế DDL event trigger hiện hữu.

Production history: version `20260920013704`, name `v287_edit_control_campaign_while_account_running`. `statements[1]` khớp nguyên văn migration trong repo. Postflight xác nhận target checksum, owner/security/config/ACL và history sau commit.

Các signature đã đối chiếu và giữ nguyên:

- `public.create_control_campaign(bigint,bigint,text,jsonb,jsonb)`: `c1673974d0982ce6a731741072ca5338`.
- `public.create_control_campaign_v2(bigint,bigint,text,jsonb,jsonb,text)`: `1b04e01063f2d59e23e063794a4574d2`.
- `public.claim_campaign_runtime(bigint,bigint,bigint,text)`: `e6b1889cda717cb0bea6f7d801633c75`.

## Kiểm chứng

[Smoke SQL v287](../migrations/tests/migration_v287_edit_control_campaign_while_account_running_smoke.sql) dùng account/campaign/input giả lập chưa commit; transaction kết thúc bằng `ROLLBACK`, worker không thấy fixtures và không gửi tin nhắn.

- **Baseline trước sửa:** tái hiện `busy_account_edit_failed:{"reason":"not_found","updated":false}` ở ca đầu tiên: form sửa chọn đúng tài khoản đang chạy chiến dịch khác.
- **Pre-apply:** migration + history INSERT + reapply + toàn bộ smoke PASS trong một transaction rollback. Checksum sai bị preflight chặn trước DDL.
- **Post-apply:** smoke PASS trực tiếp trên hàm production mới; không còn account fixture. Data API `auto_accounts`/`auto_campaigns` trả HTTP 200 trước và sau apply.
- **Ca thành công:** sửa đầy đủ có config version và account ID; sửa nhanh/core; đổi sang tài khoản đang có token scan; sửa chiến dịch có tài khoản cũ đã xoá sang tài khoản bận; trạng thái runtime ngoài danh sách cũ; retry timestamp khi chỉ note/log thay đổi.
- **Guard giữ nguyên:** chặn sửa chính chiến dịch đang chạy; xung đột config/timestamp; tài khoản inactive/deleted/Local/Web/khác platform; tài khoản khác tenant hoặc không tồn tại; chiến dịch khác tenant/đã xoá/không tồn tại; quyền gọi RPC vẫn chỉ service role.
- **Dữ liệu và runtime:** append count conflict, retry append không trùng, SMS rematerialization; snapshot tài khoản/campaign đang chạy và token scan không đổi; scheduler vẫn không claim được tài khoản bận. Không kiểm thử concurrency bằng hai connection đồng thời; cấu trúc khoá của hàm live được giữ nguyên.

Chỉ thay SQL, smoke SQL và tài liệu. Không thay TypeScript/UI, nên không build lại ứng dụng; kiểm chứng chức năng thực hiện trên PostgreSQL và Data API.
