# Tạo chiến dịch không phụ thuộc trạng thái chạy của tài khoản

Luồng **sửa** chiến dịch dùng RPC riêng; phần còn sót của v282 đã được xử lý và kiểm thử trong [v287 — Sửa chiến dịch khi tài khoản đang bận](CONTROL_CAMPAIGN_QUEUE_EDITING.md).

Luồng nạp data theo lô sau khi tạo (form tạo mới/nhân bản/từ nháp), gắn nhóm và tiếp tục nhận data được sửa bổ sung trong [v288](CONTROL_CAMPAIGN_QUEUE_DATA.md).

## Hành vi

RPC Control Web trước v282 chỉ nhận tài khoản Zalo Server ở trạng thái `chờ xử lý` hoặc `tạm dừng`. Tài khoản đang thực hiện chiến dịch hay tác vụ khác bị trả về `control_account_not_found`, dù tài khoản tồn tại và vẫn hợp lệ.

[Migration v282](../migrations/migration_v282_queue_control_campaign_while_account_running.sql) bỏ hẳn điều kiện `account.status` khi tạo campaign, cùng nguyên tắc với luồng tạo Desktop. Không duy trì danh sách trạng thái tài khoản được phép tạo. Campaign mới vào hàng chờ; wrapper v2 vẫn giữ `p_initial_status='tạm dừng'` cho luồng cần tạo ở trạng thái tạm dừng. Không thay đổi account, claim token, input hoặc campaign đang chạy.

Scheduler vẫn dùng `claim_campaign_runtime(bigint,bigint,bigint,text)` để chỉ bắt đầu campaign khi account đã về `chờ xử lý`. Tạo từ nháp dùng cùng API tạo cho bước tạo record; bước thêm data theo lô cần thêm v288. Nháp có tài khoản đã xóa, vô hiệu hóa, sai chủ sở hữu hoặc sai subtype vẫn bị từ chối.

## Audit RPC

Production: `akachat`, linked project `cgjbsmqtfhqvttudyjzq`.

Đã lấy lại `pg_get_functiondef`, owner, security mode, volatility, config, ACL và checksum trực tiếp từ production trước khi sửa. Body live khớp bản v282 đã apply trước đó; không có patch khác chen vào. Bản cuối được dựng từ body live bằng cách xóa điều kiện trạng thái và comment đi kèm; wrapper v2 giữ nguyên toàn bộ. Scheduler có định nghĩa live mới hơn migration v219 và được giữ nguyên hoàn toàn.

| Exact signature | Source checksum | Target checksum |
| --- | --- | --- |
| `public.create_control_campaign(bigint,bigint,text,jsonb,jsonb)` | `1cfc260809f66efc567da34459001c5d` | `c1673974d0982ce6a731741072ca5338` |
| `public.create_control_campaign_v2(bigint,bigint,text,jsonb,jsonb,text)` | `1b04e01063f2d59e23e063794a4574d2` | Không đổi |
| `public.claim_campaign_runtime(bigint,bigint,bigint,text)` | `e6b1889cda717cb0bea6f7d801633c75` | Không đổi |

Giữ nguyên owner `postgres`, `SECURITY DEFINER`, `VOLATILE`, `search_path=public`, function-local `statement_timeout=60s` và ACL chỉ `postgres`/`service_role` cho hai RPC tạo. Giữ tenant, account subtype/active/deleted guards, row locks, idempotency, input materialization và initial-status behavior.

Preflight fail-closed kiểm tra checksum/attributes của cả hai RPC cùng checksum scheduler; postflight kiểm tra lại target checksum và attributes trước commit. Để giữ duy nhất một file v282, preflight nhận đúng các định nghĩa đã capture: trước v282, v282 đã apply và bản cuối để reapply. Checksum trước v282 là `8b3a0fbce1c143161854a273facb2b21` (core), `659999b57409fa0b75aa59efce8d735a` (v2), với config chỉ `search_path=public`; lần triển khai đầu vẫn thêm timeout 60s theo quy tắc RPC bulk. Mọi checksum khác đều bị từ chối. Migration không sửa hoặc giải phóng trạng thái tài khoản thật, không tự tạo campaign từ nháp.

## Apply và kiểm chứng

Đã cập nhật production ngày 15/09/2026. Theo yêu cầu gộp lại v282, giữ history version `20260915042106`, name `v282_queue_control_campaign_while_account_running`; cập nhật `statements` của chính row này để khớp file cuối, không thêm version hoặc file migration mới. Apply bằng `supabase db query --linked --file`: khóa/kiểm tra chính xác history cũ, chạy migration và UPDATE history trong cùng transaction. Source live và history trước cập nhật đã được capture riêng để đối chiếu. Dùng bảng history hiện hữu, không tạo DDL phụ hoặc bản timestamp trùng nội dung. DDL event trigger sẵn có đảm nhiệm schema reload, không thêm `NOTIFY` và không tắt trigger.

[Smoke SQL](../migrations/tests/migration_v282_queue_control_campaign_while_account_running_smoke.sql) tạo fixture trong transaction rồi rollback:

- Bản trước sửa bị từ chối khi fixture account mang trạng thái ngoài danh sách; bản cuối tạo được qua cả core và v2, giữ nguyên toàn bộ account và retry idempotency.
- Core/v2 tạo được campaign khi account bận; dữ liệu nhập và retry idempotency đúng.
- Giữ nguyên toàn bộ row account, campaign đang chạy và token tác vụ khác.
- Scheduler không claim campaign mới khi account bận; khi account rảnh chỉ một campaign được claim.
- Account tạm dừng vẫn tạo được; trạng thái tạm dừng ban đầu của v2 và nhánh SMS giữ nguyên.
- Scheduler vẫn từ chối chạy account có trạng thái khác `chờ xử lý`, kể cả khi tạo campaign thành công.
- Từ chối account thiếu, bị xóa, vô hiệu hóa, local/Web/Facebook, sai chủ sở hữu hoặc action khác platform.
- Không mở quyền gọi RPC Control cho `anon`/`authenticated`.

Baseline trước sửa tái hiện `control_account_not_found` với trạng thái ngoài danh sách. Thử checksum sai bị chặn trước DDL. Pre-apply migration + history UPDATE + smoke, replay từ định nghĩa trước v282, và post-apply reapply + smoke đều PASS trong transaction rollback; không để lại account/campaign fixture. API `auto_accounts` và `auto_campaigns` trả HTTP 200 sau apply. Post-apply checksum/owner/security/config/ACL khớp dự kiến; scheduler không đổi. DB chỉ có một history v282, `statements` khớp nguyên văn file migration cuối. Lần sửa này chỉ đổi SQL, smoke SQL và tài liệu; không đổi TypeScript hoặc binary.
