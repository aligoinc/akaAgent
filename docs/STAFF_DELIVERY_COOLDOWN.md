# Kiểm tra trùng lặp trên tất cả tài khoản — V424

Ngày 23/10/2026 lúc **17:27 VN**, V424 đã apply production trên akachat: `20261023102718 / migration_v424_staff_delivery_cooldown`. **Không apply lại.** Source Desktop và Web/API đã triển khai local; chưa deploy Web/API hoặc đóng gói/phát hành Desktop.

## Phạm vi đã thống nhất

Chỉ áp dụng cho loại `zalo_message_phone` — **Zalo - Nhắn tin, kết bạn đến SĐT**. Đây là một loại chiến dịch với các tùy chọn hành động hiện có.

| Trường | Ý nghĩa |
| --- | --- |
| `auto_campaign_actions.show_staff_delivery_cooldown` | Boolean, mặc định `false`; candidate bật `true` cho `zalo_message_phone`. Chỉ quyết định hiển thị checkbox trên form. Có thể chỉnh trong màn quản lý loại chiến dịch Desktop. |
| `extra_settings.recentDeliveryCooldownAllAccounts` | Boolean, mặc định `false`. Checkbox **Áp dụng cho tất cả tài khoản**, nằm dưới số ngày của Kiểm tra trùng lặp. |

- Không tích hoặc thiếu trường mới: xét tài khoản của chiến dịch như trước.
- Tích: xét lịch sử của các tài khoản cùng `staff_id` và `organization_id` đã được RPC xác thực.
- Giữ điều kiện cũ `recentDeliveryCooldownEnabled` và `enableMessage`. Chỉ kết bạn thì không áp dụng; khi bật cả nhắn tin/kết bạn, input bị chặn vẫn đi theo luồng hiện có.
- Giữ cách khớp **UID hoặc SĐT**, chuẩn hóa SĐT, ngày Việt Nam, số ngày, các mã hành động/lịch sử hợp lệ, trạng thái, note/log, batch và quota hiện có. Không thêm quy tắc khác cho lịch sử liên tài khoản.
- Cờ hiển thị không vô hiệu hóa lựa chọn đã lưu. Form mới giữ giá trị khi sửa/nhân bản/lưu nháp; nếu checkbox bị ẩn mà cấu hình đang bật, hiển thị dòng phạm vi đã lưu. Thông tin chiến dịch cũng hiện phạm vi.
- Theo phương án người dùng chọn, **không có trigger giữ trường mới cho client cũ**. Desktop cũ ghi đè `extra_settings` có thể làm mất trường này và quay về phạm vi một tài khoản; chấp nhận hành vi đó.

## Thay đổi SQL

Canonical: [migration_v424_staff_delivery_cooldown.sql](../migrations/migration_v424_staff_delivery_cooldown.sql).

RPC giữ nguyên chữ ký và kết quả:

```sql
public.aka_agent_apply_campaign_delivery_cooldown(bigint,bigint,bigint,bigint[])
```

Chỉ thêm biến đọc lựa chọn mới và thay bộ chọn tài khoản trong CTE `history`. Khi bật, gọi helper lịch sử hiện có cho từng tài khoản cùng staff/tổ chức; khi tắt, chỉ truyền tài khoản chiến dịch. Không đổi hai helper, không tạo bảng lịch sử, RPC, pool, connection, polling hay giao thức runtime mới. Desktop, App Server và Chat worker tiếp tục gọi cùng RPC theo batch hiện có.

Đã đọc definition và metadata trực tiếp từ **akachat `cgjbsmqtfhqvttudyjzq`** trong task. Đối chiếu migration lịch sử V246/V330/V367; giữ bản helper V367 đang live, bao gồm bằng chứng `operationState='committed'` và nhánh trạng thái legacy khi không có `operationState`.

| Hàm | MD5 source | MD5 candidate |
| --- | --- | --- |
| `aka_agent_apply_campaign_delivery_cooldown(bigint,bigint,bigint,bigint[])` | `7e9107c0957684230afa2b86e40f2e2c` | `7801667ffff0dcdd5b999641e4dbed96` |
| `aka_agent_internal_delivery_cooldown_target_keys(text,text,text,text)` | `f356ae8c97cab7890f4a1740b99adce3` | Không đổi |
| `aka_agent_internal_send_delivery_history(bigint,text[],timestamp with time zone,timestamp with time zone)` | `a8e94d7a35d42064236d369c6e0e088d` | Không đổi |

[Source definition/metadata](../migrations/snapshots/staff-delivery-cooldown-v424/source.json) và [candidate metadata](../migrations/snapshots/staff-delivery-cooldown-v424/target.json) lưu đầy đủ owner, security mode, volatility, search path và ACL. Preflight từ chối thiếu hàm, checksum hoặc metadata khác bản đã đọc; candidate giữ nguyên các thuộc tính này. Không bulk-apply migration khác.

## Kiểm chứng local

- `node scripts/run-staff-delivery-cooldown-sql-smoke.cjs`: **15 nhóm đạt** trên PostgreSQL PGlite cô lập. Bao phủ mặc định/false, cùng staff, khác staff/tổ chức, cờ hiển thị, các gate cũ, ranh giới ngày Việt Nam, bằng chứng V367, UID hoặc SĐT, đối chiếu kết quả với RPC live đã chụp, batch/pending/scope, không ghi detail hoặc đổi trạng thái campaign, metadata và rollback. Chạy cả role `anon` và `aka_agent_chat_api` theo ACL hiện tại.
- `node scripts/run-staff-delivery-cooldown-ui-smoke.cjs`: form Desktop thật trong Electron đạt mặc định, ẩn/hiện, phụ thuộc checkbox cha, lưu/mở lại nháp, lưu `false`, lưu cấu hình đang bị ẩn, sửa/nhân bản, chỉ kết bạn và loại khác. Đã xem ảnh giao diện sau chỉnh vị trí checkbox.
- Web: **227/227 test đạt** trong checkout PR cô lập, gồm `CampaignRuntimeOptions`, `campaignFormLogic`, `CampaignFormPage`, `CampaignDetailDock`, `controlApi`. Bao phủ metadata, hiển thị, chuyển đổi settings, lưu/mở nháp Desktop sang Web với cờ hiển thị bật/tắt và hồi quy form 10.000 dòng. Checkout chỉ chứa thay đổi của tính năng này trên `origin/dev`, không kèm task bộ chọn tài khoản đang phát triển riêng.
- API repository: **109 test đạt**, có kiểm tra boolean metadata và giữ một query catalog hiện có.
- Hai typecheck Desktop, typecheck bảy workspace Web/API và production build hai repo đều đạt, đã chạy lại trong hai checkout PR cô lập. Đây là build source, không phải đóng gói/phát hành.

Không gửi tin thật trong các bài kiểm tra. Các ca local không chạm production; ca kiểm tra live bên dưới dùng fixture trong transaction rồi rollback. Kiểm thử chức năng không phải benchmark tải production.

## Triển khai và hoàn nguyên

Thứ tự cần dùng khi triển khai: **DB V424 → Web/API → Desktop**. API mới chọn cột catalog mới nên DB phải có cột trước. App Server/Chat worker đã dùng RPC này, không cần giao thức hoặc logic runtime mới cho tính năng.

DB đã apply; bước tiếp theo khi phát hành là cập nhật Web/API và Desktop. Không chạy lại V424. Những mô tả candidate/checksum bên trên lưu lại nguồn đã review trước apply.

[Rollback có guard](../migrations/snapshots/staff-delivery-cooldown-v424/rollback.sql) chỉ chấp nhận target checksum trên, khôi phục đúng wrapper source và bỏ cột catalog. Đã kiểm tra definition/metadata/cột bên trong transaction rồi `ROLLBACK`, candidate còn nguyên. Khi rollback thật phải hoàn nguyên client/API phụ thuộc cột trước và xử lý các chiến dịch đang chọn phạm vi toàn staff, vì RPC cũ chỉ xét một tài khoản. Không xóa trường lựa chọn đã lưu trong `extra_settings`.

## Apply production — 23/10/2026

- Project được xác minh: **akachat `cgjbsmqtfhqvttudyjzq`**, PostgreSQL 17.6. [Snapshot đọc ngay trước apply](../migrations/snapshots/staff-delivery-cooldown-v424/preapply-live.json) khớp toàn bộ source definition và metadata đã review.
- Apply riêng `20261023102718 / migration_v424_staff_delivery_cooldown` lúc 17:27 VN. Transaction giới hạn chờ lock 5 giây, mỗi statement 30 giây; không bulk-push.
- [Smoke live](../migrations/tests/migration_v424_staff_delivery_cooldown_smoke.sql) đạt **11 kiểm tra trước apply và 11 kiểm tra sau apply**: mặc định một tài khoản, lịch sử cùng staff, pending, quyền staff, phạm vi input, thứ tự trùng batch, cách ly staff, ranh giới ngày, bằng chứng committed V367, chỉ kết bạn và không tạo kết quả/trạng thái ngoài dự kiến. Dùng RPC thật, có gọi bằng role `anon`; dữ liệu thử rollback hoàn toàn, không chạy chiến dịch/gửi tin.
- Target RPC đúng checksum `7801667ffff0dcdd5b999641e4dbed96`; hai helper giữ checksum nguồn. Owner, security mode, volatility, search path và ACL của cả ba hàm không đổi.
- Cột mới đúng `boolean NOT NULL DEFAULT false`; chỉ `zalo_message_phone` có cờ hiển thị `true`. Không thay đổi lựa chọn của chiến dịch đã lưu.
- Đã diễn tập rollback thật bên trong transaction: wrapper trở lại checksum nguồn và cột bị bỏ; `ROLLBACK` cuối khôi phục đầy đủ V424. Kiểm tra cuối khớp target/metadata/cờ và **0 campaign, 0 input, 0 detail fixture** còn lại.
- Security Advisor vẫn ghi nhận cấu hình sẵn có của catalog/RPC: catalog chưa bật RLS và RPC `SECURITY DEFINER` cho các role client. V424 giữ nguyên RLS/ACL/security mode, không mở thêm quyền; không thay chính sách bảo mật ngoài phạm vi task. Hướng dẫn của Supabase: [RLS](https://supabase.com/docs/guides/database/database-linter?lint=0013_rls_disabled_in_public), [quyền anon](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable), [quyền authenticated](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable). Chi tiết nằm trong [biên bản apply](../migrations/snapshots/staff-delivery-cooldown-v424/apply-audit.json).

[Biên bản máy đọc được](../migrations/snapshots/staff-delivery-cooldown-v424/apply-audit.json) lưu migration version, thời điểm, checksum/metadata và kết quả kiểm chứng. **Chưa deploy Web/API, chưa đóng gói/phát hành Desktop.**
