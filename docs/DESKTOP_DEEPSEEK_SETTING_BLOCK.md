# Chặn Desktop đọc setting DeepSeek — 28/10/2026

Đã apply trên **akachat** (`cgjbsmqtfhqvttudyjzq`) lúc **01:29:12 VN ngày 28/10/2026**:

- Migration production: `20261027182912 / desktop_block_deepseek_setting`.
- Source: `supabase/migrations/20261027182736_desktop_block_deepseek_setting.sql`.
- Thêm đúng một policy `desktop_block_deepseek_setting` trên `public.auto_system_settings`, `AS RESTRICTIVE FOR ALL TO aka_agent_desktop`.
- `USING` và `WITH CHECK`: `key IS DISTINCT FROM 'ai.deepseek.api_key'`.

Token Desktop không thấy dòng DeepSeek khi đọc trực tiếp theo key hoặc liệt kê bảng. Chặn cả sửa/đổi tên dòng và ghi vào key được bảo vệ để không vòng qua giới hạn đọc. Các dòng setting khác và quyền backend giữ nguyên; không xóa, sửa giá trị hoặc xoay key. Không cần update app.

## Phạm vi và tương thích

Mã Desktop 9.0.0 (`e1c16165`), Desktop hiện tại, WebApp, Chat API và ChatWeb đã rà không có callsite DeepSeek setting này. AI Desktop hiện tại qua backend proxy dùng `ai_model`; RPC DeepSeek riêng của Web đọc Vault, chỉ service role có EXECUTE và không thay đổi. Hai RPC Desktop được phép có nhắc bảng settings chỉ đọc key cố định của Facebook import và quota kiểm tra SĐT. RPC quản trị settings đã bị thu hồi từ lần khóa staff; không có view public tham chiếu bảng này trong inventory.

Giữ ngoại lệ anon đọc `desktop.updates.startup_prompt_max_version`, startup/login bootstrap và feed cập nhật ba nền tảng. Tài khoản/chiến dịch được giới hạn riêng trong [migration ownership lúc 01:50:59](DESKTOP_ACCOUNT_CAMPAIGN_OWNERSHIP.md). Quy tắc chỉ chặn lần truy cập mới; không thu hồi bản sao key đã lấy trước đó.

## Kiểm chứng

- Sáu nhóm local PostgreSQL 17, dữ liệu giả: guard khi policy đổi, SELECT theo key/liệt kê, các setting khác/backend/updater, đổi tên có và không có WHERE, INSERT/UPDATE vào key được bảo vệ, rollback có guard.
- Production trial trong giao dịch hoàn tác rồi hậu kiểm sau apply: role Desktop không thấy DeepSeek; giá trị các setting khác có digest giống backend; service role vẫn đọc được key; anon dùng startup/login và chỉ đọc dòng updater; authenticated vẫn không có quyền bảng. Không ghi dữ liệu nghiệp vụ, không trả key thật.
- 12 HTTP read-only: legacy anon và publishable không thấy DeepSeek, query updater cũ/startup RPC/login content đạt; feed Windows/macOS ARM64/macOS Intel đều 9.1.0; backend health HTTP 200.
- **1.253 hàm** (checksum/owner/config/ACL) không thay đổi. ACL bảng/cột, RLS và tất cả policy có sẵn giữ nguyên; chỉ có policy mới.
- Security advisors trước/sau: cùng chín cảnh báo có sẵn, không phát sinh cảnh báo mới.

Không dùng token Desktop thật, không gọi AI provider thật hoặc mở installer cũ trong lượt này. Kiểm chứng quyền Desktop bằng role DB thật và kiểm chứng updater qua HTTP thật.

Evidence: `migrations/snapshots/desktop-deepseek-block/` gồm before/after, target policy, production trial/post-check, local/HTTP report và verification. Scripts: `scripts/desktop-deepseek-block-smoke.cjs`, `scripts/desktop-deepseek-block-http-smoke.cjs`.

## Rollback

`migrations/rollback_desktop_block_deepseek_setting.sql` chỉ drop policy mới sau khi kiểm tra đủ định nghĩa/roles/command. Đã diễn tập local và production rollback trial. **Chỉ chạy khi có chỉ thị mở lại quyền đọc DeepSeek**; không tự apply lại migration hoặc chạy rollback.
