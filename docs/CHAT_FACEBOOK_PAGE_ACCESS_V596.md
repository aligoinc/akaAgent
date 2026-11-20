# V596: fanpage Facebook dùng akaChat (hộp thư Chat Web)

Trạng thái 20/11/2026: **chưa apply**, chưa merge. Đi cùng akaAgentChatApi nhánh `feat/facebook-page-inbox`
(`docs/FACEBOOK_PAGE_INBOX.md` ở repo đó) và akaAgentChatWeb cùng tên nhánh.

## Vì sao

Chủ sản phẩm chốt 17–20/11/2026:
- tin fanpage hiện chung hộp thư Chat với Zalo, dùng lại bảng `chat_zalo_*`;
- mỗi Page là một tài khoản `auto_accounts` loại `facebook_page`;
- mỗi Page chiếm **một suất akaChat** như một tài khoản Zalo.

Hai hàm quyền đang chặn mọi loại tài khoản không phải Zalo cho akaChat:

| Hàm | Đang làm gì |
|---|---|
| `aka_agent_app_access_account_allowed(account, 'akaChat')` | Chỉ trả true cho `zalo`, trừ Zalo trình duyệt. |
| `private.app_access_validate_account` (trigger `app_access_guard_flags` trên `auto_accounts`) | Bật `is_akachat_enabled` cho loại khác thì ném `app_access_zalo_only`. Tài khoản không phải Server thì đòi chủ tài khoản đọc được akaAgent. |

## Sửa gì

Hai hàm sửa theo đúng thân production đọc ngày 20/11/2026. Chữ ký, chủ sở hữu, quyền và thuộc tính giữ nguyên.

- `aka_agent_app_access_account_allowed`: nhánh `akaChat` nhận thêm `facebook_page`.
- `private.app_access_validate_account`: với `facebook_page` bỏ các bước chỉ Zalo có (phiên Desktop, giữ chỗ UID Zalo).
  Kiểm gói akaChat và suất tài khoản vẫn chạy như mọi tài khoản.
  - `private.app_access_quota` đếm mọi tài khoản `is_akachat_enabled` của chủ tài khoản, nên Page tự chiếm một suất.
  - Hết suất thì Chat API nhận `app_access_account_limit` và báo người dùng.

Không có dòng `facebook_page` nào trước khi Chat API bản fanpage chạy, nên hành vi với dữ liệu hiện có không đổi. Các
trigger khác trên `auto_accounts` đều xét đúng `'zalo'` / `'facebook'`, nên bỏ qua dòng `facebook_page` (đọc thân hàm
ngày 20/11):
- `enforce_zalo_account_capability_and_quota`
- `normalize_legacy_zalo_account_server_owner`
- `aka_agent_facebook_account_cleanup`
- `guard_facebook_login_claim_generation`
- `aka_agent_guard_account_proxy_scope`
- `app_access_reserve_enabled_identity` (chỉ chạy khi có `zalo_account_id`)

Chat API phải ghi `is_aka_agent_enabled=false` và `is_zalo_server=false` rõ ràng: cột thứ nhất mặc định `true`, cột
thứ hai `NOT NULL` không có mặc định.

## File

- Bộ sinh: `scripts/build-v596-sql.cjs`. Nguồn là `scripts/fixtures/chat-facebook-page/v596-live-20261120.json`, thân
  production chỉ đọc.
- Migration `migrations/migration_v596_chat_facebook_page_access.sql` và bản gỡ
  `migrations/rollback_v596_chat_facebook_page_access.sql`: sinh từ bộ sinh, không sửa tay.
- md5 `pg_get_functiondef`:
  - `allowed`: `410005b7…` → `15578db6…`
  - `validate`: `f9f8f66c…` → `343293b52…`

  Preflight / postflight kiểm md5, quyền, chủ sở hữu, `SECURITY DEFINER`, volatility, `proconfig`. Migration cũng từ
  chối chạy lại khi sổ đã có `migration_v596_*`.

## Kiểm

`CHAT_REPO=<akaAgentChatApi> LC_ALL=C node scripts/chat-facebook-page-access-v596-smoke.cjs`: PG17 cục bộ, 11 nhóm.
- Hai hàm dựng lại đúng md5 production.
- Trước V596, Page bị từ chối.
- Sau V596:
  - Page dùng được akaChat; Zalo Server, Zalo trình duyệt, Facebook cá nhân giữ nguyên.
  - Page chiếm một suất; hết suất hoặc hết gói thì bị từ chối như Zalo.
  - Zalo QR vẫn đòi chủ tài khoản đọc được akaAgent.
- Apply lại bị từ chối; quyền và thuộc tính không đổi; gỡ trả đúng bản production.

## Apply (chỉ khi chủ sản phẩm bảo)

- DDL (`CREATE OR REPLACE FUNCTION`) làm PostgREST nạp lại schema: apply ngoài giờ cao điểm.
- Kiểm lại sổ migration và `git log --all` ngay trước khi apply, vì số chỉ thật sự giữ được khi đã có dòng trong sổ.
- Apply trước khi Chat API kết nối Page đầu tiên.
- Gỡ trước khi xoá các Page đã kết nối thì akaChat của các Page đó thành không được phép.
