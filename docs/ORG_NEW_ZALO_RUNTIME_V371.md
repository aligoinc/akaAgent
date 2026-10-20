# Cờ tạm chọn Zalo runtime mới — v371

Đã apply lên **akachat / `cgjbsmqtfhqvttudyjzq`** lúc khoảng **01:09 ngày 10/10/2026, giờ Việt Nam**. History dùng UTC: `20261009180914 / migration_v371_org_new_zalo_runtime_flag`. Không apply lại.

## Hành vi đã triển khai

Cột `public.org_organization.use_new_zalo_runtime` có kiểu `boolean NOT NULL DEFAULT true`.

| Trường hợp | Giá trị |
|---|---|
| 1.300 tổ chức đã tồn tại lúc apply | `false` |
| INSERT tổ chức mới, bỏ qua cột hoặc dùng DEFAULT | `true` |
| INSERT tổ chức mới, truyền `true`, `false` hoặc `null` | `true` |
| UPDATE tổ chức để bật/tắt cờ | Nhận giá trị `true`/`false` được ghi |
| UPDATE đặt `null` | Bị chặn bởi NOT NULL |

Đây là **cột tạm để chuẩn bị chuyển đổi**. Task này chưa nối cờ vào scheduler, claim, phân tuyến Desktop/Chat/Server hoặc triển khai Fly; không tự chuyển tổ chức sang engine mới. Không thêm UI, RPC public, connection/pool, worker, cron, polling hay deploy ứng dụng.

## Cách thay đổi dữ liệu

[Migration v371](../migrations/migration_v371_org_new_zalo_runtime_flag.sql) thực hiện trong một transaction:

1. Kiểm tra source schema, toàn bộ trigger của bảng và function/thuộc tính tương ứng bằng checksum lấy từ live; yêu cầu function mới chưa tồn tại và chưa có history v371.
2. Thêm cột với constant default `false` để PostgreSQL 17 giữ giá trị cho hàng cũ mà không UPDATE từng tổ chức; sau đó đổi default sang `true`.
3. Tạo trigger `trg_use_new_zalo_runtime_on_insert`, `BEFORE INSERT FOR EACH ROW`, gán cờ `true`.
4. Kiểm tra toàn bộ hàng đang có vẫn `false`, ghi history và commit.

Hai bước đổi default nằm trong cùng transaction, không có khoảng trống cho INSERT chen vào. `lock_timeout=2s`, `statement_timeout=30s`; transaction apply đo được khoảng **19 ms** (không gồm thời gian HTTP). Không gọi những trigger UPDATE đồng bộ đơn hàng/lifecycle để backfill cờ.

New-column DDL cần cập nhật metadata REST. Event trigger live `extensions.pgrst_ddl_watch()` tự gửi thông báo reload lúc commit; không thêm NOTIFY trùng, không tắt event trigger, không chạy DDL phụ khởi tạo migration history.

## Function, checksum và quyền

Exact signature: **`private.aka_agent_org_default_new_zalo_runtime()`**.

- Source: **absent**, không có overload cùng tên; đã đọc `to_regprocedure` và catalog live trước khi viết SQL. Không thay thế body của function có sẵn.
- Target `md5(pg_get_functiondef(...))`: **`df3a75b16492ded9c413ef4db332dd9b`**.
- Owner `postgres`; `SECURITY INVOKER`; volatility `v`; `search_path=pg_catalog`; ACL chỉ `postgres=X/postgres`.
- Trigger không tra DB, không nâng quyền, không làm công việc ngoài việc gán giá trị trên `NEW`.
- Giữ nguyên owner, ACL, RLS, các cột/ràng buộc cũ của bảng; không cấp thêm quyền bảng/cột cho client.

Các function live dưới đây giữ nguyên cả định nghĩa và owner/security/volatility/config/ACL, cùng trigger tương ứng:

| Signature | MD5 trước và sau |
|---|---|
| `private.trg_lock_organization_aka_order_sync()` | `8d2b28195f1e3156fbdd3be530437576` |
| `private.trg_loyalty_from_org_customer_link()` | `b72e973ddf383f4b651a5b0a49aaa0c5` |
| `private.protect_org_lifecycle_attribution()` | `12e71ec921b6bdf9d127bde6cd9b6c97` |
| `private.trg_reassign_org_customer_lifecycle()` | `09c8b2ee42ea260984e04f17e6183dcf` |
| `private.trg_sync_organization_orders()` | `cd1a4fc34ecbe9d45dcac9b346c056a9` |

Không có migration trong checkout chứa định nghĩa các trigger live này để đối chiếu; không dựng lại từ lịch sử. Tất cả event trigger/function được chụp trước/sau và giữ nguyên. Repo tại thời điểm bắt đầu có tới v368 nhưng production đã có v369/v370, vì vậy dùng v371.

Checksum source guard: schema `59f762689c91ca2f893646d25d62bc56`; table triggers/functions `6ed2df73f4b468104468192c372a7370`; event triggers/functions `2ca46b2b562944de645a2b544a4eec25`.

SHA-256 migration đã apply: `35c9c1feb9c481f4486912f14787f42b0862eea6f8687fb9c36e0b61e753d259`.

## Kiểm chứng

- Chạy toàn bộ migration + [SQL smoke](../migrations/tests/migration_v371_org_new_zalo_runtime_flag_smoke.sql) trên linked production trong transaction **ROLLBACK** trước apply: đạt, khoảng 64 ms. Sau rollback xác nhận cột/function mới chưa tồn tại.
- Sau apply, xác nhận exact function/checksum/owner/security/config/ACL, schema, trigger và history lưu nguyên SQL: đạt.
- Smoke sau apply cũng kết thúc bằng **ROLLBACK**: đạt, khoảng 19 ms.
- Fixture dùng bảng tạm và function thực, gồm trigger INSERT bảo vệ lifecycle cũ; đổi SQL role thật sang `service_role`, không giả lập JWT. Không tạo tổ chức/khách hàng thật, không tiêu thụ sequence nghiệp vụ, không gửi tin hoặc đồng bộ đơn hàng.
- Bao phủ INSERT thiếu cột/DEFAULT/true/false/null, multi-row và INSERT SELECT; giữ cờ cũ khi UPDATE tên, `ON CONFLICT DO NOTHING` hoặc upsert chỉ đổi tên; cho phép UPDATE true/false, chặn UPDATE null; attribution INSERT vẫn được bảo vệ.
- Sau apply: **1.300 false, 0 true, 0 null** tại thời điểm xác minh. Tổ chức tạo thực sau thời điểm này sẽ nhận true.
- REST `GET /rest/v1/org_organization?select=use_new_zalo_runtime&limit=0`: **HTTP 200**, `[]`; xác nhận schema cache nhận cột mới mà không trả dữ liệu khách hàng.
- Security advisors trước/sau: không phát sinh notice mới hoặc notice liên quan function/cột này. Các notice đã có giữ ngoài phạm vi task.
- Chỉ thay SQL, script vận hành và tài liệu; không thay TypeScript/app nên không chạy build bộ cài.

[Script vận hành](../scripts/org-new-zalo-runtime-v371.cjs) dùng `supabase db query --linked` với kiểm tra đúng project ref trước mỗi query, snapshot/checksum và receipt. Không có SQL pool mới. Nếu kết quả apply không rõ, kiểm tra history/schema trước; không tự retry apply.

## Sử dụng và gỡ bỏ sau này

Khi bổ sung code đọc cờ, phải triển khai cơ chế chọn runtime và quyền sở hữu tài khoản/chiến dịch riêng; cờ này tự nó chưa chuyển lưu lượng. UPDATE cờ vẫn chịu toàn bộ trigger nghiệp vụ hiện có của bảng tổ chức.

PostgreSQL chạy BEFORE INSERT cả với `ON CONFLICT`. Nếu câu upsert **cố ý** ghi `use_new_zalo_runtime=EXCLUDED.use_new_zalo_runtime` vào hàng đã có thì nó sẽ ghi `true`; muốn giữ cờ khi upsert dữ liệu khác thì bỏ cột này khỏi phần UPDATE. Đây là semantics của upsert, không phải trigger UPDATE.

Sau khi chuyển hết tổ chức, bỏ các nơi đọc/ghi cờ trong mọi service/client trước, rồi dùng migration mới gỡ trigger, function và cột. Trước khi gỡ phải đọc lại định nghĩa/checksum live và chụp giá trị cờ còn cần đối soát; không sửa/xóa migration history v371, không `DROP ... CASCADE`. Task này không thực hiện rollback schema hoặc gỡ cờ.

Snapshot và receipt đầy đủ: [thư mục audit](audits/new-zalo-runtime-v371/), gồm source trước khi dựng SQL, absence của exact private signature, before/after, manifest, rollback smoke, apply, API và security advisor summary. Không lưu credential hoặc dữ liệu tổ chức trong audit.
