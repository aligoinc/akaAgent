# Thêm data và nguồn Nhóm data khi tài khoản đang bận

## Phạm vi và nguyên nhân

V282 sửa RPC tạo campaign; v287 sửa RPC update và append nằm trong update. Các thao tác thêm data độc lập, preflight/bind Nhóm data và reactivate nguồn dùng RPC riêng nên vẫn còn điều kiện tài khoản phải `chờ xử lý` hoặc `tạm dừng`. Luồng form tạo mới/nhân bản/tạo từ nháp có dữ liệu trực tiếp gọi thêm data theo lô sau khi tạo campaign, vì vậy chỉ kiểm thử RPC tạo là chưa đủ. Xem [audit ban đầu](CONTROL_CAMPAIGN_BUSY_ACCOUNT_AUDIT.md).

[Migration v288](../migrations/migration_v288_campaign_data_while_account_running.sql) xoá đúng 8 điều kiện trạng thái tài khoản trong 5 core RPC, gồm cả RPC append cũ và kiểm tra tất cả tài khoản con trong bundle. Tài khoản hợp lệ đang chạy campaign/scan khác vẫn được dùng để chuẩn bị data và cấu hình nguồn. Không thay bằng whitelist trạng thái khác.

Giữ nguyên tenant/staff, subtype, active/deleted, kiểm tra chính campaign đang chạy/terminal theo từng thao tác, thứ tự khoá, idempotency, canonical target, bundle baseline và runtime ownership. Reactivate giữ semantics riêng đã có: nhận tiếp data vào nguồn sống, không thêm guard campaign-running mới; hard-end/deleted/mismatch vẫn bị từ chối. Bản sửa không sửa tài khoản, không giải phóng token và không khởi chạy campaign.

Không thay TypeScript/UI/binary. Các caller hiện tại nhận bản sửa từ DB, gồm form create/clone/draft, thêm/import data, bind/rebind và tiếp tục nhận data. RPC legacy append cũng được sửa để giữ tương thích.

## Exact RPC audit

Đã capture lại `pg_get_functiondef`, owner, security, volatility, config, ACL và checksum live trong task này trước khi dựng SQL. Đối chiếu repository cho thấy body 5 core khớp v219; các wrapper credential giữ body định tuyến v224, trong đó bind/reactivate đã có function-local timeout 60s từ patch sau. Dựng migration từ live capture, không copy body lịch sử.

| Exact signature | Source MD5 | Target MD5 |
| --- | --- | --- |
| `public.add_control_campaign_input_rows(bigint,bigint,bigint,text,integer,jsonb,timestamptz,text)` | `49005ecea81255f4a3bebd747513e6ef` | `0f22d3c6fe532176af0e3f38fd485f88` |
| `public.aka_agent_bind_campaign_data_group_source(bigint,bigint,text,bigint,bigint,bigint)` | `d3b0ec9f53d3b41102dd7b69ec3b2a3b` | `0b6ca7aaa203ea4991f9b31b5f10bd9b` |
| `public.aka_agent_preflight_campaign_data_group_change(bigint,bigint,bigint,bigint)` | `abc77805588d2b86c8f7dc41e9d6fafc` | `38713235dc164457501da0997f7edf2f` |
| `public.aka_agent_preflight_campaign_data_group_change(bigint,bigint,bigint,bigint,text,text)` | `fb36874ee305eddfc56b775a798ffe48` | `967d28f6e9df5472bfefeffa6746ffb7` |
| `public.aka_agent_reactivate_campaign_data_group_source(bigint,bigint,bigint,text,text)` | `ae62b6c0b3064ad37da3d9b5411bae25` | `3ff057a65e4e976720ac23070489bb82` |
| `public.append_control_campaign_inputs(bigint,bigint,bigint,text,integer,jsonb)` | `39d62e473f8d85452901cf2fe9f2c483` | `b4d9f9e05f917bd3793fd5fdc1ca27a2` |

Cả 6 signature giữ owner `postgres`, `SECURITY DEFINER`, search path và ACL. Preflight core giữ `STABLE` (`s`), các signature còn lại giữ `VOLATILE` (`v`). ACL 5 core là `{postgres=X/postgres,service_role=X/postgres}`; preflight wrapper giữ `{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}`.

Config của hai RPC thêm data là `search_path=public`, bốn signature Nhóm data là `search_path=pg_catalog, public`; cả 6 thêm function-local `statement_timeout=60s` theo quy tắc bulk/aggregate. Preflight credential wrapper chỉ đổi timeout. Bind/reactivate credential wrappers đã có 60s nên giữ nguyên toàn bộ. Không đổi timeout role/global.

Preflight kiểm tra toàn bộ 6 signature và thuộc tính trước DDL; chỉ nhận đúng source hoặc target checksum, thiếu/khác đều abort. Postflight kiểm tra toàn bộ trước commit; reapply target là no-op. Các patch được giữ gồm input serialization barrier, bundle lock/registration/baseline/idempotent retry, source ownership trước early return, chọn runtime theo subtype và restore GUC ở credential wrapper, runtime claim và v287 config-version/orphan-account repair.

## Triển khai

Áp dụng ngày 20/09/2026 lên linked production **akachat / cgjbsmqtfhqvttudyjzq**, chỉ v288, bằng `supabase db query --linked --file`. Migration + INSERT vào bảng history hiện hữu nằm cùng transaction; không bulk-push migration khác, không chạy DDL chuẩn bị schema. Giữ DDL event trigger hiện hữu, không thêm `NOTIFY`.

History version `20260920021026`, name `v288_campaign_data_while_account_running`. `statements[1]` khớp nguyên văn file migration, MD5 `7b6ff7b0eb571593d19d949dc04d6463`. Post-apply kiểm tra 18 signature đã capture: 6 target checksum/attributes đúng; 12 signature còn lại không đổi (create/core/v2, v287 update/core/wrapper, claim runtime, snapshot/router, stop và bind/reactivate credential wrappers).

## Kiểm chứng

[Smoke v288](../migrations/tests/migration_v288_campaign_data_while_account_running_smoke.sql) chỉ ghi fixture synthetic trong transaction kết thúc `ROLLBACK`; workers không thấy fixture và không gửi tin Zalo/SMS.

- **Baseline:** bản cũ thất bại đúng ca đầu tiên `busy_chunk_upload:{"reason":"not_found","created":false,"inserted":0}`.
- **Pre-apply:** migration + history INSERT + idempotent reapply + toàn bộ smoke PASS trong rollback. Source checksum giả bị từ chối trước DDL.
- **Post-apply:** smoke v288 và v287 PASS. Kiểm tra metadata 18 signature, history và không còn account/campaign/group fixture PASS. Data API `auto_accounts`/`auto_campaigns` HTTP 200 trước/sau apply.
- **Direct data:** tạo paused → thêm nhiều lô → kích hoạt hàng chờ; retry không trùng; input count conflict; RPC append cũ; giữ khác biệt completed-campaign giữa append cũ và endpoint add; đường SMS vẫn nạp đủ data.
- **Nguồn nhóm:** preflight core/wrapper, bind core/wrapper, nhóm thực sự có contact/phone, retry không trùng, không đổi nguồn sau canonical intake, stop → thêm thành viên → reactivate chỉ nạp phần thiếu, paused campaign vẫn paused; wrapper chọn Server và khôi phục context Desktop của caller.
- **Bundle:** hai account đang giữ runtime campaign/scan, child đầu chưa activate/materialize một phần; child cuối revalidate account của child khác; sau đủ hai child, mỗi campaign nhận đúng hai dòng, bundle ready, retry cùng/khác request không trùng.
- **Guards:** account inactive/deleted/Local/Web/khác chủ sở hữu bị chặn cả trước nhánh retry/unchanged; chính campaign đang chạy không được add/append/bind, preflight từ chối; nguồn hết hạn không được reactivate. Snapshot toàn bộ account runtime, scan token và campaign đang chạy không đổi; scheduler không chiếm account bận.

Trong lúc dựng fixture, trigger đổi subtype và constraint subtype đã chặn hai cách dựng account không hợp lệ; đã sửa fixture bằng account riêng có subtype hợp lệ, không bỏ/bypass guard của production.

Đây là kiểm thử SQL integration trên các đường RPC và materialization thật, không phải thử browser qua HTTP form hoặc chứng nhận toàn bộ hệ thống hết lỗi. Chưa thử concurrency hai kết nối; cấu trúc khoá live giữ nguyên và ownership được kiểm tra bằng snapshot/claim. Chỉ thay SQL/tài liệu nên không build lại ứng dụng.
