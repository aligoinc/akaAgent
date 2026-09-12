# Hoàn tất dữ liệu quét thành viên group trên App Server

Bản sửa ngày 12/09/2026 cho Server không Chat: `ContactLoader` đã lấy thành viên từ Zalo và lưu contact/quan hệ group, nhưng bước `finalizeScanDataset()` gọi RPC credential Desktop khi App Server không giữ mật khẩu. Vì vậy thành viên vẫn hiện trong danh sách dù thao tác báo “Phiên xác thực tự động hóa không còn hợp lệ”.

App Server khởi tạo loader với `contactDatasetAuth: 'server_claim'`. Loader dùng overload tokenized hiện có của `claim_zalo_account_runtime_operation` với `requires_login=true`, giữ token trong bộ nhớ, hoàn tất dataset trước khi release đúng token. Không lưu token vào dataset, renderer hoặc log. Token hết hiệu lực khi claim được trả, bị thay thế hoặc runtime bỏ quyền sở hữu. Không suy luận cơ chế xác thực từ riêng `zaloRuntimeTarget`: loader Chat trong Desktop cũng có target Server nhưng phải tiếp tục dùng credential Desktop.

RPC mới chỉ nhận `zalo_group_members`/`person`, xác minh staff đang hoạt động, đúng organization/account, capability Server, subtype Server và token đang giữ account ở trạng thái chạy. Nó gọi nguyên core hiện hành để giữ semantic `zalo_person`, kiểm tra các contact thuộc tài khoản, dedupe và snapshot: completed thay danh sách, partial hợp nhất, failed giữ thành viên cũ. RPC credential Desktop và quyền truy cập core không đổi.

## Migration và đối chiếu live

- Project đã đối chiếu: `akachat`, ref `cgjbsmqtfhqvttudyjzq`.
- Migration: [v277](../migrations/migration_v277_zalo_server_contact_dataset.sql).
- Hàm mới: `public.aka_agent_finalize_zalo_server_contact_dataset(bigint,bigint,bigint,text,text,text,text,text,text,text,text[],jsonb,bigint,uuid)`.
- Source checksum hàm mới: không có — signature chưa tồn tại khi audit.
- Target checksum `md5(pg_get_functiondef(...))`: `c97300fa762faa37e7b931761a9b2abb`.
- Owner `postgres`; `SECURITY DEFINER`; volatility `VOLATILE`; `search_path=pg_catalog, public`; timeout riêng `60s`.
- ACL: `{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}`; `PUBLIC` không được execute.

Các định nghĩa được lấy trực tiếp bằng `pg_get_functiondef()` trước khi viết SQL. Migration dừng nếu checksum dependency thay đổi. Các bản vá live được giữ bằng cách gọi lại core, không chép/ghi đè body: timeout v239; semantic và GUC restore v244; snapshot core v205; rào cản runtime/campaign trong claim hiện hành; resolver capability đang dùng các entitlement pool trong schema `private`; các grant release đã có cho `aka_agent_chat_api`.

Các dependency chính có checksum source và target giống nhau:

| Signature trong `public` | Checksum giữ nguyên |
| --- | --- |
| `aka_agent_finalize_contact_dataset(bigint,bigint,bigint,text,text,text,text,text,text,text,text[],jsonb,bigint)` | `fbf9566fb1e5e7d346980abf33362fba` |
| `aka_agent_finalize_contact_dataset(bigint,bigint,bigint,text,text,text,text,text,text,text,text[],jsonb,bigint,text,text)` | `8cda2541c0b811a8184c9b1adc29934c` |
| `aka_agent_finalize_contact_dataset_v205_internal(bigint,bigint,bigint,text,text,text,text,text,text,text,text[],jsonb)` | `f5722a4b4554b0d496eb6cb3379f043f` |
| `auto_assert_automation_identity(bigint,bigint,text,text)` | `5a9a503db72b965eb644739f5f60905d` |
| `claim_zalo_account_runtime_operation(bigint,bigint,text,text,uuid,boolean)` | `78d5cdd05a02bdf3b78349e598e9d512` |
| `release_zalo_account_runtime_operation(bigint,bigint,text,text,uuid)` | `b32f324928cef0699697f259b3899c75` |
| `resolve_organization_zalo_account_capabilities(bigint)` | `46412e94cf00a788230835f6d56d8d3b` |

## Kiểm chứng

- `node scripts/run-zalo-server-contact-dataset-smoke-test.cjs`: quét nhóm/link, không có credential Desktop, hủy sau lưu, danh sách rỗng, lỗi claim/finalize, giữ nhánh Desktop local và Desktop Chat, scope đồng thời, dedupe và subtype-change claim. Dùng mã loader/repository thật với DB/Zalo giả.
- [SQL smoke v277](../migrations/tests/migration_v277_zalo_server_contact_dataset_smoke.sql): thực thi trên linked project trong cùng giao dịch tạo RPC rồi `ROLLBACK`; chỉ tạo account/contact giả, không đọc session Zalo hay chạy chiến dịch. Kiểm tra quyền `anon`, snapshot completed/partial/failed, sai staff/org/account/contact/type/token, token đã release/bị thay thế, account đã chuyển local, credential Desktop và core ACL. Migration được chạy hai lần trong cùng giao dịch để kiểm tra reapply.
- Hai typecheck main/renderer, smoke Chat Data Scan, 19 ca lọc contact, build Desktop và build Server.

## Triển khai

**Đã apply riêng v277 lên production `akachat` (`cgjbsmqtfhqvttudyjzq`) ngày 12/09/2026, version `20260912041234`; chưa triển khai binary App Server lên VPS.** Migration và lịch sử được commit trong cùng một giao dịch. Checksum SQL lưu trong lịch sử là `f23107de91b1be49c0bb8ae2cf8562e2`; không apply các migration khác trong workspace.

Trước apply, chạy migration hai lần và SQL smoke trong một giao dịch rollback. Sau apply, đối chiếu đúng signature/checksum/owner/security/volatility/config/ACL của RPC mới và xác nhận cả 12 dependency không thay đổi. PostgREST đã resolve RPC mới: request với staff/org/account không hợp lệ bị từ chối tại guard (`400/P0001`, `server_contact_dataset_claim_required`); REST đọc không lấy dữ liệu vẫn trả `200`. SQL smoke sau apply đã qua và rollback toàn bộ fixture.

Sau đó đóng gói bằng `npm run build:server:win` và cập nhật App Server không Chat trên VPS. Không cần deploy WebApp hoặc thay luồng Chat API. Kiểm tra thủ công một lượt quét nhóm: danh sách thành viên hiện đủ, bộ dữ liệu được chốt, kết quả báo thành công và tài khoản về trạng thái trước quét. Build trong task này kiểm tra bundle; chưa tạo installer hoặc restart VPS.
