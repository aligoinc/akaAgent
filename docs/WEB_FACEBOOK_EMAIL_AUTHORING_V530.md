# V530 — Web/iOS soạn chiến dịch Facebook/Email và quản lý tài khoản Email SMTP

Ngày 14/11/2026 · **Trạng thái: CHƯA apply.** Migration, rollback, so sánh chỉ đọc, áp một lần dán, smoke và bản thử
trong giao dịch tự huỷ đã viết và đạt trên PostgreSQL 16 cục bộ. Trên production mới chạy các phép đọc catalog (md5/ACL
nguồn, default ACL, RLS, trigger, chính sách, sổ migration); **script so sánh và bản thử tự huỷ CHƯA chạy được trên
production**: lần gửi script so sánh qua MCP lúc ~11:25 VN 14/11 bị server MCP hỏi xác nhận (vì có `CREATE`/`DO`) và
không ai trả lời trong 60 giây, nên không có lệnh nào chạy. Hợp đồng gốc: akaAgentWebApp
`docs/FACEBOOK_EMAIL_AUTHORING_IMPLEMENTATION.md` mục 2–3, phương án `docs/FACEBOOK_EMAIL_CAMPAIGN_AUTHORING_PLAN.md`
mục 4.3/4.4. Tiền lệ: [V476](WEB_FACEBOOK_CAMPAIGNS_V476.md), [V461](WEB_DESKTOP_ACCOUNTS_V461.md).

App Desktop vẫn là nơi chạy duy nhất của chiến dịch Facebook và Email. V530 chỉ cho Control API (Web/PWA/iOS, `service_role`)
tạo/sửa/thêm data chiến dịch Facebook/Email qua đúng các RPC đang dùng cho Zalo/SMS, quản lý tài khoản Email SMTP, nối
chiến dịch tìm data với chiến dịch đích, và cho bộ chạy Desktop ghi riêng từng khoá `extra_settings` nó sở hữu. Không đổi
bảng, không thêm index; mọi tính năng mới tắt sẵn bằng chính sách.

## Số migration

V530. Sổ production lúc đọc (11:16 VN 14/11/2026): mới nhất `20261114015453 / migration_v529_desktop_server_on_fly_flag_route`,
không có `migration_v53x_*`; `git log --all` không có file `migration_v53*`. Kiểm lại ngay trước khi apply.

## Hợp đồng SQL

### Chính sách

`auto_system_settings` `web.email_campaigns` (mới, seed `ON CONFLICT DO NOTHING`):
`{"enabled":false,"organizationIds":null,"emailOnlyLogin":false,"authoring":{"enabled":false,"organizationIds":null}}`.

| RPC | Trả |
| --- | --- |
| `aka_agent_control_web_email_campaigns_policy(p_organization_id bigint)` (mới, `service_role`) | `{"enabled", "emailOnlyLogin", "authoring": {"enabled"}}`. Đóng: `{"enabled":false,"emailOnlyLogin":false,"authoring":{"enabled":false}}`. |
| `aka_agent_control_web_facebook_campaigns_policy(p_organization_id bigint)` (thân không đổi; helper private đổi) | `{"enabled", "facebookOnlyLogin", "authoring": {"enabled", "actionIds"}}`. Đóng: `authoring = {"enabled":false,"actionIds":[]}`. |

Luật đọc như V461/V476: `enabled` phải là boolean; `organizationIds` `null` = mọi tổ chức, mảng số = chỉ các tổ chức đó;
JSON hỏng/sai kiểu/`is_active=false`/`is_secret=true`/thiếu dòng = đóng. Nhánh `authoring` chỉ xét khi `enabled` của tổ chức
đúng: `authoring.enabled` boolean, `authoring.organizationIds` lọc tiếp; Facebook thêm `authoring.actionIds`: thiếu/`null` =
mọi loại (trả `null`), mảng chuỗi khác rỗng = chỉ các loại đó, sai kiểu/rỗng/phần tử rỗng = tắt (trả `[]`).
`emailOnlyLogin` chỉ đúng khi `enabled` đúng và giá trị là boolean `true`. Giá trị Facebook hiện tại
(`{"enabled":true,"organizationIds":[1],"facebookOnlyLogin":false}`) không có nhánh `authoring` ⇒ soạn Facebook tắt.
Bật/tắt là UPDATE dòng cấu hình, không phải DDL.

### Xác thực phiên

`aka_agent_authenticate_control_session(text)` và bản `_chat_v2(text)` của V490 (hai thân sửa giống nhau):
- `capabilities.email`: tổ chức có sản phẩm **13** chưa xoá, `expiration_date >= 00:00 hôm nay giờ Việt Nam`.
- khoá mới `web_email_campaigns` (đối tượng chính sách Email ở trên); `web_facebook_campaigns` có thêm `authoring`.
- cổng tổ chức chỉ có gói Email: như `facebookOnlyLogin` — vào được khi `capabilities.email`, `client_type` thuộc
  `web`/`pwa`/`native` và chính sách bật `emailOnlyLogin`; không thì `capability_unavailable` như cũ.

### Token phạm vi `email`

`p_platforms` nhận thêm `email` = tài khoản `flatform_type = 'email'`, nơi chạy `desktop`. Caller không gửi token này nhận
kết quả **giống hệt** trước V530 (218 lời gọi cục bộ, xem Kiểm chứng).

| Hàm | Thay đổi |
| --- | --- |
| `aka_agent_control_campaign_page` | Nhận chiến dịch Email khi có token; `platform: 'email'`, `runtimeTarget: 'desktop'`, `isZaloServer`/`isZaloShowWeb` false, `runtimeBusy` theo lease. |
| `aka_agent_control_account_snapshot` | 3 chỗ lọc thêm Email; `desktopPresence` khi có token `email`. **Không trả `email_session`**: API tự đọc `email_session->>'fromEmail'` (không bao giờ đọc `pass`). |
| `aka_agent_control_desktop_activity` | Nhận token `email`, `accountType: 'email'`. |
| `aka_agent_control_set_desktop_campaign_status` | Nhận Email, cùng luật dừng/tiếp tục Desktop của V476. |
| `delete_control_campaign_atomic` | Nhận Email; chặn khi `đang chạy` hoặc còn claim/unit lease (`campaign_running`). |
| `aka_agent_control_campaign_logs` | Không đổi (đã lọc theo `flatform_type` của token). |

### Tạo chiến dịch (`create_control_campaign_v2` → `create_control_campaign`)

- Loại `facebook`/`email` được nhận khi `action.flatform_type = account.flatform_type`; tài khoản Facebook/Email phải chưa xoá
  và `is_active` khác `false`. Gọi lặp cùng `p_idempotency_key` trả lại chiến dịch đã tạo (nhánh lặp đã nhận Facebook/Email).
- `p_campaign.secondaryAccountId` (camelCase, tuỳ chọn) ghi vào `secondary_account_id` sau khi kiểm:
  `control_secondary_account_not_allowed` (không phải Facebook hoặc `auto_campaign_actions.allow_secondary_account` không
  đúng), `control_secondary_account_same_as_primary`, `control_secondary_account_not_found` (không phải tài khoản Facebook
  chưa xoá của đúng nhân viên/tổ chức).
- Dòng data (`p_inputs`): Facebook mỗi dòng phải là đối tượng có `uid` khác rỗng → `control_input_uid_required`; Email mỗi
  dòng phải có `email` khớp `^[^@\s]+@[^@\s]+\.[^@\s]+$`, ≤ 254 ký tự → `control_input_email_invalid`. Cả hai có
  `DETAIL = 'row=<chỉ số từ 0>'`. Kiểm cả trong `add_control_campaign_input_rows` và `p_append_inputs` của bản sửa.
- Lỗi là `RAISE EXCEPTION '<mã>'` (PostgREST trả mã trong `message`), như các mã cũ `control_action_not_allowed`.

### Sửa (`update_control_campaign_atomic`, và qua nó `update_control_campaign_by_config_version_atomic`)

- Chiến dịch/tài khoản Facebook/Email (chưa xoá, `is_active` khác `false`) sửa được; đổi tài khoản trong cùng nền tảng.
- Tài khoản phụ: khoá patch **`secondary_account_id`** (snake_case như mọi khoá patch): có = ghi (kiểm như lúc tạo),
  `null` = xoá. Gửi `secondaryAccountId` → `invalid_control_campaign_update_payload`. Khi chiến dịch Facebook/Email đổi
  `account_id`/`action_id` mà vẫn còn tài khoản phụ, tài khoản phụ được kiểm lại.
- **Khoá do bộ chạy sở hữu** (hợp đồng 3.2), mọi nền tảng: nếu patch có `extra_settings` là đối tượng thì 13 khoá
  `sourceLinkIndex`, `contentRotationIndex`, `postBumpRotationIndex`, `postBumpCreatedCampaignIdsByAccount`,
  `internalSmsCreatedCampaignIdsByAccount`, `zaloFriendDataMaterializedAt`, `zaloFriendMaterializedCount`,
  `zaloBirthdayDataMaterializedDate`, `zaloBirthdayMaterializedCount`, `zaloFriendRecommendationDataMaterializedAt`,
  `zaloFriendRecommendationMaterializedCount`, `zaloCancelFriendRequestDataMaterializedAt`,
  `zaloCancelFriendRequestMaterializedCount` lấy từ DB (giá trị trong patch bị bỏ; DB không có thì khoá không có).
- **Chặn khi app Desktop còn giữ lượt** (hợp đồng 3.1): chiến dịch có `runtime_claim_token` hoặc `runtime_unit_token`,
  tài khoản chính là Facebook/Email/Zalo không Server, **và** nhân viên có dòng `auto_staff_device_presence` với
  `ended_at IS NULL` và `last_seen_at` trong 2 phút ⇒ `{"updated": false, "reason": "campaign_running",
  "desktop_runtime_busy": true}`. App đã tắt (lease mồ côi) thì cho sửa. Áp cho cả Zalo QR/trình duyệt (đổi hành vi cũ:
  trước V530 sửa được khi còn lease).
- `status` trong patch bị bỏ qua với Zalo/Facebook/Email (đổi trạng thái qua `aka_agent_control_set_desktop_campaign_status`).
- **Phiên bản cấu hình:** `aka_agent_campaign_config_version` gồm cả `extra_settings` ⇒ mỗi lần bộ chạy ghi một khoá nó sở
  hữu (RPC ghi từng khoá bên dưới) thì phiên bản đổi, lần sửa từ Web mở trước đó nhận `{"updated":false,"reason":"version_conflict"}`
  từ bản theo `config_version`; API đọc lại rồi cho người dùng sửa lại. Ghi chỉ đổi `updated_at`/trạng thái vẫn được bản
  `config_version` thử lại tự động như cũ.

### Thêm data (`add_control_campaign_input_rows`)

Nhận Facebook/Email (kiểm dòng như trên). Hàm cũ vẫn từ chối khi `đang chạy` (`campaign_running`) nhưng **không** có chặn
"app Desktop còn giữ lượt" và vẫn ghi `schedule`/`original_schedule`/`status` của chiến dịch như cũ: API nên kiểm
`runtimeBusy` của chiến dịch Desktop trước khi gọi (đã làm cho Zalo Desktop).

### Tài khoản Email SMTP (mới, EXECUTE chỉ `service_role`)

Cấu hình (`email_session`) chuẩn hoá đúng 9 khoá Desktop: `brandName`, `host`, `port`, `secure`, `user`, `pass`,
`fromEmail`, `replyTo`, `cc` (cắt khoảng trắng; `port` số/chuỗi số 1–65535, sai thì `secure ? 465 : 587`; bắt buộc `host`,
`user`, `pass`, `fromEmail`; trần độ dài 500/1000 (`pass`)/2000 (`replyTo`, `cc`)) → `invalid_control_email_account_payload`.
Đối tượng tài khoản trả về (`account`): `id, name, flatform_type, status, login_status, is_active, account_group_id, proxy_id,
created_at, updated_at, email_session` (không có `pass`, thêm `hasPassword`), `email_session_updated_at,
email_session_last_verified_at, email_session_last_error`.

| RPC | Tham số | Trả |
| --- | --- | --- |
| `create_control_email_account_atomic` | `p_staff_id, p_organization_id, p_name text, p_session jsonb, p_verified boolean, p_verify_error text = NULL, p_max_accounts integer = NULL, p_account_group_id bigint = NULL` | `{"created":true,"account_id","account"}` · `{"created":false,"reason":"account_group_not_found"}` · `{"created":false,"reason":"capability_unavailable"}` (không có gói 13 còn hạn) · `{"created":false,"reason":"account_limit_reached","max_accounts"}` |
| `update_control_email_account_atomic` | `p_staff_id, p_organization_id, p_account_id, p_expected_updated_at timestamptz, p_name text, p_session jsonb, p_verified boolean, p_verify_error text, p_account_group_id bigint` (không mặc định: gửi đủ 9 khoá) | `{"updated":true,"account"}` · `{"updated":false,"reason":"not_found"|"version_conflict"|"account_group_not_found"}` |
| `delete_control_email_account_atomic` | `p_staff_id, p_organization_id, p_account_id` | `{"deleted":true,"account_id"}` · `{"deleted":false,"reason":"not_found"|"account_running"|"campaign_running"}` |
| `aka_agent_control_email_account_session` | `p_staff_id, p_organization_id, p_account_id` (STABLE) | `{"found":false}` · `{"found":true,"account_id","name","account_group_id","login_status","updated_at","session"}` — **nơi duy nhất trả `pass`** |

- Tạo: tên 1–255 ký tự, `p_verified` bắt buộc; dòng mới như Desktop (`flatform_type 'email'`, `status 'chờ xử lý'`,
  `is_active true`, `rate_limit_minutes 65`, không proxy); `p_verified` true → `đã đăng nhập` + `email_session_last_verified_at`,
  false → `chưa đăng nhập` + `email_session_last_error = left(btrim(p_verify_error), 2000)`. Hạn mức: tổ chức không tách quyền
  so số tài khoản Email chưa xoá của nhân viên với `p_max_accounts` (API tính theo gói như Desktop; `NULL`/≤ 0 = không giới hạn);
  tổ chức tách quyền (`aka_agent_app_access_separate`) để trigger `app_access_guard_flags` kiểm và có thể ném `app_access_*`.
  Khoá: `control-zalo-account-group:<nhóm>` (nếu có nhóm) rồi `control-zalo-account:<nhân viên>`, cùng thứ tự với
  `create_control_zalo_account_atomic`.
- Sửa: `p_name`/`p_session` `NULL` = giữ; `p_session` không có `pass` (hoặc rỗng) = giữ mật khẩu đang lưu; có `p_session` thì
  bắt buộc `p_verified`. `p_account_group_id` là giá trị đích (`NULL` = bỏ nhóm). Cấu hình mới + `p_verified` false xoá
  `email_session_last_verified_at`; chỉ kiểm lại (không `p_session`) mà false thì giữ mốc. `email_session_updated_at` chỉ đổi khi
  thay cấu hình.
- Xoá: xoá mềm (`is_delete=true, is_active=false`); từ chối khi tài khoản `đang chạy` hoặc còn chiến dịch chưa xoá `đang chạy`/
  còn claim/unit lease.
- Lỗi chung: `invalid_control_identity`, `inactive_control_staff` (tạo/sửa), `invalid_control_email_account_payload`.

### Liên kết chiến dịch tìm data (`aka_agent_control_link_find_data_target`, mới, `service_role`)

Tham số `p_staff_id, p_organization_id, p_source_campaign_ids bigint[] (1–200), p_target_campaign_id, p_target_key text,
p_add boolean`. Khoá → loại chiến dịch đích (đúng `FIND_DATA_TARGET_FIELDS` của form Desktop):
`findUidTargetCampaignIds → facebook_message_uid`, `findPostLinkTargetCampaignIds → facebook_comment_seeding_post`,
`findPhoneZaloMessagePhoneTargetCampaignIds → zalo_message_phone`, `findZaloGroupLinkJoinTargetCampaignIds → zalo_join_group_link`,
`findFacebookGroupPostTargetCampaignIds → facebook_group_post`, `findFacebookGroupCommentTargetCampaignIds → facebook_comment_seeding`,
`findFacebookGroupJoinTargetCampaignIds → facebook_join_group`.

- Lỗi: `invalid_find_data_link_payload` (id ≤ 0/NULL, rỗng hoặc > 200 nguồn, `p_add` NULL, đích nằm trong nguồn),
  `invalid_find_data_target_key`.
- Trả `{"ok":false,"reason":"inactive_control_staff"}`; khi thêm: `target_not_found`, `target_action_mismatch`;
  `{"ok":false,"reason":"source_not_found","sourceIds":[…]}` (nguồn không phải `facebook_find_data_group`/`_search` chưa xoá
  của nhân viên); thành công `{"ok":true,"changedSourceIds":[…],"unchangedSourceIds":[…]}`.
- Một câu UPDATE trên các nguồn đã khoá theo thứ tự id; chỉ ghi dòng thực sự đổi (thêm khi chưa có, bớt khi có; so theo số,
  nhận cả id dạng chuỗi); `updated_at` chỉ đổi ở dòng đổi. Không chặn khi app Desktop giữ lượt của nguồn (xem Rủi ro).

### Bộ chạy Desktop ghi từng khoá (`aka_agent_desktop_merge_campaign_runtime_settings`, mới)

`(p_campaign_id bigint, p_set jsonb = '{}', p_remove text[] = '{}') → {"updated": boolean, "updatedAt": timestamptz|null}`.
`extra_settings = (extra_settings − p_remove) || p_set`, `updated_at = now()`, một dòng theo id. **SECURITY INVOKER**,
EXECUTE chỉ `aka_agent_desktop`: chạy bằng quyền cột (`UPDATE extra_settings, updated_at` có sẵn trên production) và RLS
`desktop_owned_resource` của phiên (dòng của nhân viên khác ⇒ `updated: false`). `p_set` không phải đối tượng, > 100 khoá,
`p_remove` > 100 phần tử hoặc có `NULL` ⇒ `invalid_campaign_runtime_settings`. App Server (`service_role`) không được gọi
(42501) và ghi cả khối như cũ — đúng cách `mergeCampaignRuntimeSettings` của Desktop xử lý.

## md5 nguồn → đích

Nguồn đọc trên production 14/11/2026 11:16–11:25 VN (chỉ đọc). Migration kiểm toàn bộ trước khi sửa hàm đầu tiên (lệch ⇒
`v530_unexpected_definition`, cả giao dịch rollback), giữ owner/security/volatility/config/ACL (`v530_attributes_changed`).

| Hàm | Nguồn | Đích |
| --- | --- | --- |
| `private.aka_agent_web_facebook_campaigns_policy(bigint)` | `592f487518ef14f3bef6f0c7177f2ab5` | `a49d994aa8f5847a0ccd35e4017504f1` |
| `aka_agent_authenticate_control_session(text)` | `692e2a068ce51377f6bd71fec20a8b0c` | `8012506f60ad1f00aab2b60f7bbec48c` |
| `aka_agent_authenticate_control_session_chat_v2(text)` | `61e874b9b47b827d78e16c71bc9ef687` | `e481b2473aa9dda34f91092b98ffdfbe` |
| `aka_agent_control_campaign_page(...)` | `367cf7ba9d72aff72c4907586cf1c3ba` | `719fcf458eabe2b16fe536de07079c77` |
| `aka_agent_control_account_snapshot(...)` | `db8942b09904e535987b94745b159ca3` | `fac3ecfdf45dff239c319656a7365a7c` |
| `aka_agent_control_desktop_activity(...)` | `6030f0d9c8429e36955a405920f751f9` | `ed7f9d447f72019feca71d717fd4e1bd` |
| `aka_agent_control_set_desktop_campaign_status(...)` | `87f7002ac924f647896a7635663562b5` | `2d3fbc42cc31e57138cdc99554af9254` |
| `delete_control_campaign_atomic(...)` | `2af929cc5e02683e5e9dc16a48cc9bac` | `2ede03119ec482102e1647c0b1bae220` |
| `create_control_campaign(...)` | `61a6b5c855fbcf86cafaf3c3c7ce6f0a` | `252ae351970aa1c0b19d356faad94540` |
| `update_control_campaign_atomic(...)` | `a86278195e18d1ef8d0091b41d1d0c5b` | `0d5eb4e8e8d8d0545daf3b4b82307c30` |
| `add_control_campaign_input_rows(...)` | `d283261c5e77558d10f5df86cd4d1127` | `5fa5bcfd31f69db8114b82f3ade9b4a5` |

Phụ thuộc không sửa, migration kiểm md5 (`v530_dependency_changed`): `create_control_campaign_v2` `661579fa…`,
`update_control_campaign_by_config_version_atomic` `3e1e2f8b…`, `aka_agent_control_campaign_logs` `26875e2b…`,
`aka_agent_control_web_facebook_campaigns_policy` `7f487421…`. Không sửa `append_control_campaign_inputs` (API không gọi)
và danh mục loại chiến dịch Web (`type_visibility` chỉ Zalo/SMS).

12 hàm mới (md5 đích, ACL kiểm chính xác ở postflight):

| Hàm | md5 | ACL |
| --- | --- | --- |
| `private.aka_agent_web_email_campaigns_policy(bigint)` | `2d131332e8d0fa54b4669f51a8fe92d8` | owner |
| `public.aka_agent_control_web_email_campaigns_policy(bigint)` | `70616ad6489372725cca33b09da41852` | `service_role` |
| `private.aka_agent_control_assert_campaign_inputs(text,jsonb)` | `80972291d75cec5383aab3a28838b7b6` | owner |
| `private.aka_agent_control_assert_secondary_account(bigint,bigint,text,text,bigint,bigint)` | `fa594cff527fcf2f553c9f376d67dc41` | owner |
| `private.aka_agent_control_normalize_email_session(jsonb,text)` | `7068bce7f45562f1f4ebcb2fb902a89b` | owner |
| `private.aka_agent_control_email_account_view(auto_accounts)` | `c6c2b3218cf5946c7d4fa3cc23d0f429` | owner |
| `public.create_control_email_account_atomic(...)` | `496a0182daaa9c944119a9744fcf41eb` | `service_role` |
| `public.update_control_email_account_atomic(...)` | `6f0f9fefac37de258d34c55deebd2cfd` | `service_role` |
| `public.delete_control_email_account_atomic(...)` | `b912bdab82a4669569b184e46f166da0` | `service_role` |
| `public.aka_agent_control_email_account_session(...)` | `2ee2b490a2f9224a9d8ac63a1683040f` | `service_role` |
| `public.aka_agent_control_link_find_data_target(...)` | `84182eb3960fd1952037e80e183036fa` | `service_role` |
| `public.aka_agent_desktop_merge_campaign_runtime_settings(bigint,jsonb,text[])` | `2e3bf66477ad78cf90eba64e1626e8d2` | `aka_agent_desktop` |

Hàm mới đều `SET search_path`, `REVOKE ALL … FROM PUBLIC, anon, authenticated` (và `aka_agent_desktop`/`aka_agent_chat_api`
khi không dành cho họ), GRANT tường minh. md5 file migration: `655a95257dd8047d22fc3b32ed17b737`. Chi tiết:
`migrations/snapshots/web-facebook-email-authoring-v530/baseline.json`.

## File

| File | Vai trò |
| --- | --- |
| `migrations/migration_v530_web_facebook_email_authoring.sql` | Migration (một giao dịch, `lock_timeout` 5 s, `statement_timeout` 60 s, preflight/postflight md5 + ACL; apply lại = NOTICE `v530 đã được apply trước đó; không đổi gì.`). |
| `migrations/snapshots/web-facebook-email-authoring-v530/baseline.sql`, `baseline.json` | 11 định nghĩa trước V530 (md5 = production) và thuộc tính/ACL đọc trên production. |
| `migrations/snapshots/web-facebook-email-authoring-v530/rollback.sql` | Rollback có guard md5 (nguồn hoặc đích), khôi phục 11 định nghĩa, bỏ 12 hàm mới và dòng `web.email_campaigns`. |
| `migrations/tests/migration_v530_web_facebook_email_authoring_compare.sql` | So sánh chỉ đọc trước apply (bản sao `pg_temp`): 11 `patch_dry_run`, caller cũ `*_same` (3 bộ token × trang/snapshot/catalog/tiến trình trên nhân viên nhiều chiến dịch Email/Facebook/Zalo-SMS nhất), đường Email mới, `facebook_policy_same`. |
| `migrations/tests/migration_v530_web_facebook_email_authoring_guarded_apply.sql` | Một lần dán SQL Editor: so sánh → chốt chặn → migration → ghi sổ (dòng cuối `applied`). |
| `migrations/tests/migration_v530_web_facebook_email_authoring_smoke.sql` | Smoke chỉ đọc sau apply (md5/ACL, phạm vi Email/Facebook trên nhân viên thật, quyền), chạy trong `BEGIN … ROLLBACK`. |
| `migrations/tests/migration_v530_web_facebook_email_authoring_rollback_trial.sql` | Thử trên production trong giao dịch tự huỷ: migration + smoke rồi `RAISE 'v530_trial_ok'` (không COMMIT, không ghi sổ). |
| `scripts/build-v530-sql.py` | Sinh rollback/compare/guarded/smoke/trial từ migration + baseline; chạy lại sau mỗi lần sửa. |
| `scripts/test-v530-web-facebook-email-authoring.sh`, `scripts/fixtures/web-facebook-email-authoring-v530/` | Test PG16 cục bộ. |

## Kiểm chứng

`PG_TEST_BINDIR=/usr/lib/postgresql/16/bin scripts/test-v530-web-facebook-email-authoring.sh` (PG16, ~13 giây; mặc định tự
tìm `/usr/lib/postgresql/16/bin` rồi Homebrew):
- nền dựng từ fixtures V461 + V461 + V464 + V476 + V490 + phần production chưa có trong chuỗi repo (`create_control_campaign_v2`
  bản V482 và `aka_agent_campaign_config_version` chép nguyên văn production, quyền cột + RLS phiên Desktop, default ACL), kiểm
  đúng md5 + ACL production của 11 hàm và 5 hàm phụ thuộc;
- **218 lời gọi caller cũ** (trang/snapshot/tiến trình với các bộ token × lọc, dừng/tiếp tục, xoá, xác thực + bản `chat_v2`,
  chính sách Facebook, tạo/sửa/sửa theo `config_version`/thêm data Zalo/SMS) giống hệt trước apply, sau apply, sau rollback và
  sau apply lại;
- assertions: chính sách (đóng khi lỗi cấu hình), xác thực theo gói 13/ngày Việt Nam/loại client/`emailOnlyLogin`, đọc/dừng/xoá
  Email, tạo/sửa/thêm data Facebook/Email (tài khoản phụ, dòng data, khoá bộ chạy sở hữu, `status` bị bỏ qua), chặn khi app
  Desktop giữ lượt (119 s / 121 s / phiên đã kết thúc, cả bản `config_version`), tài khoản Email (tạo/sửa/xoá/phiên, giữ mật
  khẩu, hạn mức, tổ chức tách quyền, nhóm), liên kết tìm data (thêm/bớt/idempotent/id chuỗi), RPC bộ chạy dưới vai trò
  `aka_agent_desktop` (quyền cột + RLS), ACL hàm mới;
- apply lại không đổi gì (giữ giá trị chính sách đã chỉnh); rollback khi dòng Facebook còn nhánh `authoring` vẫn giữ caller cũ
  giống hệt; rollback chạy lại báo `v530 đã ở baseline`;
- nguồn lệch / hàm phụ thuộc lệch / hàm mới trùng tên có sẵn / thiếu quyền cột Desktop ⇒ dừng, không đổi gì;
- script so sánh (gửi cả file trong MỘT thông điệp như `execute_sql`): 11/11 `patch_dry_run`, 73 dòng `*_same` đạt, không đổi DB;
- áp một lần dán: giống hệt migration thường, đúng một dòng sổ (md5 `statements[1]` = md5 file), chạy lại bị chặn
  (`v530_guard_failed`), nguồn lệch thì dừng; smoke đạt; bản thử tự huỷ kết thúc bằng `v530_trial_ok`, không đổi gì.

**Production (14/11/2026, chỉ đọc qua MCP):** md5 + owner/security/volatility/config/ACL của 11 hàm nguồn và 5 hàm phụ thuộc
khớp baseline; default ACL hàm `public` của `postgres` = `{postgres,anon,authenticated,service_role}` (như fixture), `private`
không có; 12 tên hàm mới chưa tồn tại (đã kiểm 4 tên chính); `web.email_campaigns` chưa có, `web.facebook_campaigns` =
`{"enabled":true,"organizationIds":[1],"facebookOnlyLogin":false}`; `auto_campaigns` RLS bật với `desktop_owned_resource`
(RESTRICTIVE) và `aka_agent_desktop` có `UPDATE extra_settings/updated_at`. Thời gian đọc hiện tại (một lượt): trang 45 ms,
snapshot 46 ms, tiến trình 1,55 s ở nhân viên 385 (lớn nhất). **Chưa chạy trên production:** script so sánh và bản thử tự huỷ
(MCP cần người dùng bấm xác nhận).

## Triển khai

1. Ngoài giờ cao điểm (không trong 10:00–11:30, 14:00–16:00 VN), có người dùng ngồi trước màn hình để bấm xác nhận MCP: chạy
   `..._compare.sql` (đọc kết quả: 11 `patch_dry_run`, mọi dòng `ok = true`); rồi `..._rollback_trial.sql` (kết quả đạt là
   lỗi `v530_trial_ok: …`; lỗi khác là bước đó không đạt, đều đã huỷ).
2. Kiểm lại sổ (`migration_v53*`) và `git log --all`; apply bằng `apply_migration` với nguyên file (tên
   `migration_v530_web_facebook_email_authoring`), hoặc dán `..._guarded_apply.sql` vào SQL Editor (dòng cuối `applied`).
   `CREATE OR REPLACE` làm PostgREST nạp lại schema.
3. `BEGIN;` + `..._smoke.sql` + `ROLLBACK;` (NOTICE `v530 production smoke passed`). Đối chiếu md5 sổ với md5 file.
4. Deploy Control API (WebApp) rồi mới bật chính sách: `web.facebook_campaigns` thêm `authoring`, `web.email_campaigns`
   `enabled`/`authoring` theo tổ chức. Desktop có RPC ghi từng khoá từ bản build sau V530; bản cũ vẫn ghi cả khối (chặn ở mục 3.1
   bảo vệ phần lớn trường hợp).

## Rollback

Tắt nhánh soạn (`authoring.enabled=false` ở cả hai dòng, `web.email_campaigns` `enabled:false`); API phải chịu được thiếu
hàm (chính sách Email thiếu hàm = tắt; liên kết tìm data thiếu hàm = 503 `find_data_link_not_ready`), rồi chạy `migrations/snapshots/web-facebook-email-authoring-v530/rollback.sql` ngoài giờ cao điểm.
Dòng chiến dịch/tài khoản Facebook/Email đã tạo từ Web giữ nguyên. Desktop đã có RPC ghi từng khoá tự quay về ghi cả khối khi
hàm biến mất (PGRST202).

## Rủi ro còn lại

- Bản Desktop chưa có RPC ghi từng khoá (mọi bản tới 9.7.0) vẫn ghi cả khối `extra_settings` từ RAM khi chạy: chặn ở mục 3.1 chỉ
  dựa vào lease + presence 2 phút; sửa đúng lúc app vừa nhả lease rồi ghi lại (hoặc presence trễ) vẫn có thể bị bản trong RAM
  đè. Liên kết tìm data và thêm data không bị chặn.
- Chặn mục 3.1 cũng áp cho Zalo QR/trình duyệt: Web cũ sửa chiến dịch Zalo Desktop còn lease khi app mở giờ nhận
  `campaign_running` (kèm `desktop_runtime_busy`).
- Ghi khoá bộ chạy đổi phiên bản cấu hình ⇒ `version_conflict` cho lần sửa mở trước đó (đúng thiết kế, cần thông báo ở UI).
- Hạn mức tài khoản Email cho tổ chức không tách quyền chỉ kiểm qua `p_max_accounts` của API (không có trigger DB).
- Snapshot không trả địa chỉ email; API đọc `email_session->>'fromEmail'` riêng và không bao giờ đọc `pass` ngoài
  `aka_agent_control_email_account_session`.
