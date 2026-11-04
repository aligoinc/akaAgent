# Tên và tên gốc Zalo trong Quét data — V441

Ngày 02/11/2026. **Đã sửa source, build local và apply riêng V441 trên akachat lúc 13:49:47 Việt Nam ngày 02/11/2026: `20261102064947 / migration_v441_zalo_scan_names`. Chưa đóng gói/phát hành app.** Backend đã trả và lọc trường mới; không apply lại migration. [Receipt](../migrations/snapshots/zalo-scan-names/apply-receipt.json).

## Hợp đồng

- Chỉ hai hành động `zalo_friends` và `zalo_remarketing_customers`: giữ tiêu đề **Tên**, thêm **Tên gốc Zalo** ngay bên phải, gồm cả header/menu/chip lọc và xuất Excel.
- Sau review ngày 02/11/2026, theo yêu cầu người dùng, nhãn **Tên hiển thị** được đổi lại thành **Tên** trên bảng/lọc/Excel để bộ nhập tự nhận cột tên khi nhập lại file. Cột **Tên gốc Zalo** vẫn độc lập; chỉ đổi source UI, không cần thay/apply lại RPC.
- `name` giữ nguyên dữ liệu và thứ tự fallback hiện có; việc đổi nhãn không đổi tên được đưa vào chiến dịch/nhóm data hoặc thứ tự danh sách.
- Trường mới `zalo_original_name` → `AutoAccountContact.zaloOriginalName` chỉ lấy `zalo_users.zalo_name` đã lưu, trim và chuyển rỗng thành NULL. Không lấy display name, UID hoặc `extra_data.originalName` làm tên gốc vì các trường này có thể đã fallback. Thiếu tên gốc: UI hiện `—`, Excel để trống. Không gọi Zalo để cập nhật hồ sơ trong lúc mở bảng.
- Lọc `zaloOriginalName` dùng catalog chung và SQL trước count/phân trang; chọn toàn bộ/chọn khoảng/xuất dùng cùng query/cursor. Không lọc RAM trên trang hiện tại. Các bảng Facebook, group Zalo, upload và Data Group giữ tiêu đề hiện có.
- RPC tận dụng JOIN hồ sơ đang có, không thêm request, pool, SQL connection, polling hoặc thay timeout. Luồng đọc legacy lấy thêm `zalo_name` trong JOIN/lookup sẵn có; giữ metadata `extraData.originalName` cũ cho caller khác.

## RPC và bảo toàn live

Target chỉ `akachat / cgjbsmqtfhqvttudyjzq`. Live đã đọc bằng `pg_get_functiondef`, lưu definition/owner/ACL/security/volatility/config trong [source capture](../migrations/snapshots/zalo-scan-names/source.json).

| Exact signature | MD5 source | MD5 target |
| --- | --- | --- |
| `private.column_filter_predicate_v1(text,jsonb)` | `069845e69f67531eddb64e543cf57b4f` | `3865e1b571db3b1cc91a28ab1e43a0c9` |
| `public.aka_agent_read_filtered_contacts_v1(bigint,bigint,text,text,text,jsonb)` | `788154e11ff9c302ed14cabd866fa1da` | `85f3e6f7025787d2938c06e71f1589c3` |
| `public.aka_agent_read_filtered_remarketing_v1(bigint,bigint,text,text,jsonb)` | `6f5c7a310643cf7d63782974ffcdc933` | `969a66f21752b62804c71acb4521cd33` |

Đã tìm mọi migration liên quan: V421 tạo reader; V435 thu hồi quyền legacy; V436 có guard/đối chiếu các function. Body checksum hiện tại khớp V421 nhưng ACL đã đổi sau cutover: public readers chỉ postgres/service_role/aka_agent_desktop, helper chỉ postgres. Candidate dựng từ capture live, không chạy lại generator V421 hoặc cấp lại anon/authenticated. Giữ owner postgres, reader STABLE SECURITY DEFINER/search_path/statement_timeout 60s, helper IMMUTABLE SECURITY INVOKER, guards account/staff/org, cursor, giá trị bind và cách đếm hiện có.

- [Migration V441](../migrations/migration_v441_zalo_scan_names.sql): guard cả checksum, owner, ACL, security, volatility và config; chỉ chấp nhận source hoặc đúng target. Drift phải đối chiếu lại, không thay checksum để vượt guard.
- [Generator V441](../scripts/generate-zalo-scan-names.cjs) chỉ thay các fragment đã kiểm tra xuất hiện đúng một lần trong capture live. Các generator nguồn trong `scripts/column-filters/` cũng cập nhật projection; không sửa migration V421 đã apply.
- [Rollback có guard](../migrations/snapshots/zalo-scan-names/rollback.sql) phục hồi chính source live, bao gồm ACL sau V435. Đã diễn tập candidate → rollback trong cùng transaction rồi ROLLBACK.
- Không đổi signature/return type/metadata PostgREST; không cần reload schema. Migration mới phải apply riêng sau khi xác nhận rollout, không bulk-push.

## Kiểm chứng

- Hai typecheck `tsconfig.node.json`, `tsconfig.web.json`: đạt.
- `npm run build`: đạt; còn cảnh báo Vite về import vừa static vừa dynamic. Đây là build source local, không phải bộ cài.
- `node scripts/run-account-contact-status-filter-smoke-test.cjs`: 19 ca đạt; tên gốc đúng hoặc NULL, giữ gender/phone/status/paging và số request.
- `node scripts/column-filters/test-contract.cjs`: 15 ca đạt.
- `node scripts/column-filters/test-service.cjs`: 14 ca đạt. Cập nhật mock cho `isTrustedServerSupabaseConfigured` để tương thích guard phiên hiện tại; không sửa auth production.
- `node scripts/column-filters/test-ui.cjs`: 25 ca đạt. Chromium chạy React thật, IPC giả lập. Kiểm tra hai tiêu đề, bộ lọc/chip riêng, số cột, xuất 150 dòng qua nhiều trang với đúng hai trường tên, và ô tên gốc thiếu. Đã xem ảnh hai bảng; không có page error. Không xem đây là kiểm chứng Electron/Windows hoặc Zalo live.
- [SQL trial](../migrations/snapshots/zalo-scan-names/trial-result.json): 10 ca trên akachat trong transaction kết thúc ROLLBACK, gồm 5 liên hệ và 5 khách remarketing thực tế cho từng role service_role/aka_agent_desktop; bỏ field mới thì kết quả cũ giữ nguyên; tên khớp hồ sơ; lọc tên gốc và account guard đạt. Fixture VALUES phân biệt alias/tên gốc/NULL mà không ghi dữ liệu nghiệp vụ. Credential chỉ dùng trong bộ nhớ server, không lưu/đưa ra output.
- [Hậu kiểm rollback](../migrations/snapshots/zalo-scan-names/post-rollback.json): checksum, owner, ACL, security, volatility, timeout giữ nguyên source. Đây là trạng thái sau lượt diễn tập, trước apply thật.

### Kiểm chứng sau khi đổi lại nhãn Tên

Ngày 02/11/2026: hai typecheck đạt; `node scripts/column-filters/test-ui.cjs` đạt 27 ca, không có page error. Hai bảng và Excel đều giữ **Tên** / **Tên gốc Zalo**. File tải xuống được đọc bằng bộ nhập thật: danh sách bạn bè nhập theo UID, khách hàng cũ nhập theo số điện thoại; ánh xạ mặc định giữ đúng tên hiển thị ở cột **Tên**, không nhầm sang tên gốc. Header UID cũ `Zalo Id` của remarketing chưa nằm trong alias nhập UID, không nằm trong thay đổi nhãn này. Tại lượt đổi nhãn chưa build lại/phát hành bộ cài và không sửa/apply thêm DB; lần kiểm chứng trước PR bên dưới đã build lại source.

### Kiểm chứng trước PR

Ngày 02/11/2026, worktree riêng từ `origin/dev_3` chỉ gồm phạm vi Zalo: hai typecheck đạt, build production exit 0 trong 26,07 giây (main 3.156.743 byte, preload 66.630 byte, renderer 35.580.742 byte; còn cảnh báo Vite về mixed static/dynamic import). Tổng 75 ca smoke đạt: repository 19, filter contract 15, service 14, UI/Excel 27. Không cần thay cơ chế override nhãn trong `ColumnFilters.tsx` vì nhãn chung đã là **Tên**; file đó không thuộc PR. Đối chiếu live read-only bằng `pg_get_functiondef`: cả ba body/MD5, owner, ACL, security mode, volatility và config khớp `target.json`. Regenerate offline cho migration/rollback/target giữ nguyên byte; SHA-256 migration vẫn khớp receipt đã apply. 102 link tài liệu đạt. `git diff --cached --check` chỉ báo hai dòng trống có ba dấu cách trong migration V441 dòng 199 và rollback dòng 198; cả hai thuộc body reader remarketing được giữ nguyên từ capture live để bảo toàn MD5/SHA-256. Các file còn lại qua diff check; không trim/reformat migration đã apply. Không apply lại DB, deploy, đóng gói hoặc phát hành trong lượt tạo PR.

## Apply và hậu kiểm

Chỉ apply V441, không bulk-push, không thay business rows, không reload PostgREST. Ledger xác nhận `20261102064947`. Sau apply, ba definition checksum khớp target trong bảng; owner/ACL/security/volatility/config giữ nguyên source. Chạy lại 10 ca SQL bằng service_role/aka_agent_desktop trong transaction ROLLBACK đều đạt. Đã diễn tập rollback có guard và kiểm tra guard từ chối source checksum khác trước apply. Receipt không chứa credential hoặc dữ liệu liên hệ.

Rollout còn lại: đóng gói/phát hành app theo yêu cầu riêng. Backend mới tương thích app cũ nhờ giữ mọi field cũ và chỉ thêm field JSON. Chưa kiểm thử trên bộ cài Windows/Mac đang dùng thật.
