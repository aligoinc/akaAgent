# V476 — Web/PWA và app iOS quản lý chiến dịch Facebook

Ngày 07/11/2026 · **Trạng thái: candidate, CHƯA apply production, Desktop chưa phát hành.** Phương án đầy đủ (API, Web, iOS) ở akaAgentWebApp `docs/FACEBOOK_CAMPAIGNS_PLAN.md`; tài liệu này chỉ phần akaAgent: migration V476 và ảnh chụp runtime của app Desktop.

App Desktop vẫn là nơi chạy duy nhất của chiến dịch Facebook. Web/iOS chỉ đọc DB và đổi trạng thái qua RPC có guard, đúng mô hình V461 của Zalo mã QR/trình duyệt ([WEB_DESKTOP_ACCOUNTS_V461.md](WEB_DESKTOP_ACCOUNTS_V461.md)). Không tạo/sửa chiến dịch Facebook từ Web: các RPC tạo/sửa/thêm data/đổi trạng thái dòng không đổi và vẫn từ chối Facebook.

## Số migration

V476. Ledger lúc đọc (07/11/2026 ~20:30 VN): mới nhất `20261107131803 / migration_v475_journey_campaign_notifications`; `git log --all` trên 591 nhánh không có `migration_v476*`. Kiểm lại cả hai ngay trước khi apply.

## Hợp đồng SQL

Token phạm vi mới `facebook` trong `p_platforms` = tài khoản `auto_accounts.flatform_type = 'facebook'`. Caller không gửi token này nhận kết quả **giống hệt** trước V476 (kiểm 123 lời gọi, xem Kiểm chứng).

| Hàm | Thay đổi |
| --- | --- |
| `aka_agent_control_campaign_page` | Nhận chiến dịch Facebook khi có token. `runtime_target = 'desktop'` cho Facebook nên lọc `runtimeTargets` và lọc `platforms: ["facebook"]` dùng được ngay. Dòng trả `platform: 'facebook'`, `isZaloServer`/`isZaloShowWeb` = false, `runtimeBusy` theo claim/unit lease như Zalo Desktop. Vế lọc thứ nhất `a.flatform_type = ANY(p_platforms)` vốn đã nhận `facebook`, chỉ vế thứ hai cần thêm nhánh. |
| `aka_agent_control_account_snapshot` | Thêm Facebook vào 3 chỗ lọc (catalog, account_rows, runningCampaigns). Trả `desktopPresence` khi có token `facebook`. `has_zalo_session` giữ nguyên: production có 0/1.589 tài khoản Facebook có `zalo_session`, nên nhánh cũ luôn ra `false`; Web dùng `state.login_status`. `username` vẫn chỉ trả cho SMS. |
| `aka_agent_control_desktop_activity` | Nhận token `facebook`, trả `accountType: 'facebook'`. Giữ trần 50 chiến dịch đang/vừa chạy trong 30 phút, 200 dòng/lượt, lookback 10 giây. |
| `aka_agent_control_set_desktop_campaign_status` | Mở cho `flatform_type = 'facebook'`, luật không đổi (dưới đây). |
| `delete_control_campaign_atomic` | Nhận chiến dịch Facebook; chặn khi đang chạy hoặc còn claim/unit lease. |
| `aka_agent_authenticate_control_session` | Thêm `capabilities.facebook` và khoá `web_facebook_campaigns`; cổng tổ chức chỉ có Facebook. |
| Mới: `private.aka_agent_web_facebook_campaigns_policy(bigint)`, `public.aka_agent_control_web_facebook_campaigns_policy(bigint)` | Đọc chính sách như hàm của V461. Wrapper EXECUTE chỉ `service_role`; helper private chỉ owner. |

Không đổi: `aka_agent_control_campaign_logs` (đã nhận `facebook`), `aka_agent_list_campaign_details_page_v2`, `aka_agent_list_campaign_input_data_page_v2`/`_by_ids`, `aka_agent_control_campaign_progress`, `aka_agent_device_presence`, các RPC tạo/sửa, `update_control_campaign_input_statuses_atomic` (vẫn `invalid_owner` với Facebook).

### Dừng/tiếp tục (`aka_agent_control_set_desktop_campaign_status`)

Trả `TABLE(ok, reason, campaign_id, campaign_status, account_status, pause_pending)`. `reason`:

| reason | ok | Khi nào |
| --- | --- | --- |
| `updated` | true | Đã đổi. Dừng khi app còn giữ lượt hoặc chiến dịch `đang chạy` thì `pause_pending = true` (app dừng sau mục tiêu đang xử lý; không đụng lease). |
| `already_target` | true | Đã ở trạng thái đích. |
| `runtime_busy` | false | Tiếp tục khi `đang chạy` hoặc còn claim/unit lease. |
| `invalid_transition` | false | Dừng từ `hoàn thành`/`lỗi`, hoặc tiếp tục từ trạng thái khác `tạm dừng`. |
| `account_deleted` / `account_inactive` | false | Tiếp tục khi tài khoản đã xoá mềm / tắt. |
| `not_found` | false | Không thuộc nhân viên/tổ chức, chiến dịch đã xoá, hoặc nền tảng không phải Facebook/Zalo Desktop. |
| `inactive_control_staff` | false | Nhân viên không hoạt động hoặc khác tổ chức. |

`p_target_status` ngoài `tạm dừng`/`chờ xử lý` → `RAISE 'invalid_desktop_campaign_status'`. Mỗi lần đổi ghi một dòng `auto_campaign_logs` dạng `HH:MI:SS DD/MM/YYYY - <tài khoản> - <chiến dịch> - ⏸ Đã tạm dừng chiến dịch từ Web.` (hoặc `⏸ Đã yêu cầu tạm dừng từ Web. App Desktop sẽ dừng sau mục tiêu đang xử lý.` / `▶️ Đã tiếp tục chiến dịch từ Web. App Desktop sẽ chạy khi đến lịch.`). Desktop đọc lại chiến dịch trước mỗi mục tiêu ở cả nhánh Facebook (`executeCampaignV2`, lô mời group, hàng đợi tài khoản), nên không cần sửa luồng chạy.

### Xoá (`delete_control_campaign_atomic`)

Trả jsonb: `{"deleted": true, "campaign_id": N}`, hoặc `{"deleted": false, "reason": "campaign_running"}` khi chiến dịch `đang chạy` hoặc còn `runtime_claim_token`/`runtime_unit_token` (lease mồ côi sau 00:00 khoá cổng bảo trì của cả nhân viên), hoặc `{"deleted": false, "reason": "not_found"}`. Desktop không kiểm "đã xoá" giữa chừng, đây là lý do phải chặn khi còn lease.

### Xác thực phiên (`aka_agent_authenticate_control_session`)

- `capabilities.facebook`: tổ chức có `org_organization_product` sản phẩm **3 hoặc 10**, `is_deleted = false`, `expiration_date >= 00:00 hôm nay giờ Việt Nam` (cùng luật gói SMS trong hàm và `private.app_access_packages(…,'facebook')` của V445).
- `web_facebook_campaigns`: `{"enabled": boolean, "facebookOnlyLogin": boolean}` từ chính sách.
- Cổng: tổ chức không có Zalo Server, SMS, và không được mở bởi `desktopOnlyLogin` (V461/V464) chỉ vào được khi `capabilities.facebook` **và** `client_type` thuộc `web`/`pwa`/`native` **và** chính sách bật `facebookOnlyLogin`. Không có thì vẫn thu hồi phiên và trả `capability_unavailable` như cũ. `native` có ngay từ đầu (không cần DDL thứ hai như V464); API phải chặn iOS cũ thiếu header trước khi bật `facebookOnlyLogin`.
- Kiểm quyền tách app (V447) và hạn nhân viên chạy trước như cũ.

## Chính sách `web.facebook_campaigns`

`auto_system_settings`, mặc định `{"enabled":false,"organizationIds":null,"facebookOnlyLogin":false}`, `is_secret=false`, `is_active=true`; seed `ON CONFLICT DO NOTHING` nên apply lại giữ giá trị đã chỉnh.
- `enabled`: phải là boolean; `organizationIds`: `null` = mọi tổ chức, mảng **số** = chỉ các tổ chức này (chuỗi/đối tượng/mảng chuỗi = tắt); `facebookOnlyLogin` chỉ có hiệu lực khi `enabled` và phải là boolean.
- Lỗi cấu hình (JSON hỏng, sai kiểu, `is_active=false`, `is_secret=true`, thiếu dòng) luôn đóng tính năng, không làm hỏng xác thực.
- Sửa giá trị không phải DDL, không nạp lại schema PostgREST: tắt khẩn cấp = `enabled:false` hoặc `facebookOnlyLogin:false`.

## md5 nguồn → đích

Nguồn đọc trên production 07/11/2026 (chỉ đọc), đúng bản V461/V464. Migration kiểm toàn bộ trước khi sửa hàm đầu tiên; lệch thì `v476_unexpected_definition` và cả giao dịch rollback.

| Hàm | Nguồn | Đích |
| --- | --- | --- |
| `aka_agent_control_campaign_page(...)` | `a2bc3f7cae264e647ac576c9895e840f` | `367cf7ba9d72aff72c4907586cf1c3ba` |
| `aka_agent_control_account_snapshot(...)` | `6b148777006903e4830925c55616820b` | `db8942b09904e535987b94745b159ca3` |
| `aka_agent_control_desktop_activity(...)` | `214999ca7a2830b2a0b85389a0325fbf` | `6030f0d9c8429e36955a405920f751f9` |
| `aka_agent_control_set_desktop_campaign_status(...)` | `ea05f7ca98ceb9c8794c447abe79dc7c` | `87f7002ac924f647896a7635663562b5` |
| `delete_control_campaign_atomic(...)` | `4cfcad941c3acf22e674a77b203d086d` | `2af929cc5e02683e5e9dc16a48cc9bac` |
| `aka_agent_authenticate_control_session(text)` | `2c10aa78ac5e4ab8069c741b356e88c8` | `692e2a068ce51377f6bd71fec20a8b0c` |
| mới `private.aka_agent_web_facebook_campaigns_policy(bigint)` | — | `592f487518ef14f3bef6f0c7177f2ab5` |
| mới `public.aka_agent_control_web_facebook_campaigns_policy(bigint)` | — | `7f487421358f987502dc2bc6405dae0b` |

Owner `postgres`, security/volatility/config/ACL `{postgres=X/postgres,service_role=X/postgres}` của 6 hàm giữ nguyên (migration RAISE `v476_attributes_changed` nếu đổi). Default ACL production cho hàm `public` tạo bởi `postgres` cấp anon/authenticated/service_role, nên wrapper mới REVOKE trực tiếp anon/authenticated/aka_agent_desktop/aka_agent_chat_api; schema `private` không có default ACL. Chi tiết: `migrations/snapshots/web-facebook-campaigns-v476/baseline.json`.

## File

| File | Vai trò |
| --- | --- |
| `migrations/migration_v476_web_facebook_campaigns.sql` | Migration canonical (một giao dịch, `lock_timeout` 5 s, `statement_timeout` 60 s, preflight/postflight md5 + ACL). |
| `migrations/snapshots/web-facebook-campaigns-v476/baseline.sql`, `baseline.json` | 6 định nghĩa live trước V476 và metadata. |
| `migrations/snapshots/web-facebook-campaigns-v476/rollback.sql` | Rollback có guard md5 (nguồn hoặc đích). |
| `migrations/tests/migration_v476_web_facebook_campaigns_compare.sql` | So sánh chỉ đọc trên production trước apply (bản sao `pg_temp`). |
| `migrations/tests/migration_v476_web_facebook_campaigns_guarded_apply.sql` | Một lần dán vào SQL Editor: so sánh → chốt chặn → migration → ghi ledger. |
| `migrations/tests/migration_v476_web_facebook_campaigns_smoke.sql` | Smoke chỉ đọc sau apply, chạy trong `BEGIN … ROLLBACK`. |
| `scripts/build-v476-sql.py` | Sinh rollback/compare/guarded từ migration + baseline; chạy lại sau mỗi lần sửa. |
| `scripts/test-web-facebook-campaigns-sql.sh`, `scripts/fixtures/web-facebook-campaigns-v476/` | Test PostgreSQL cục bộ. |

## App Desktop: ảnh chụp runtime có tài khoản Facebook

[desktopRuntimeSnapshot.ts](../src/main/services/desktopRuntimeSnapshot.ts) gửi kèm heartbeat 30 giây có sẵn (V461), chỉ đọc RAM của scheduler, không thêm truy vấn/timer/kết nối:
- `accounts` gồm tài khoản Zalo không phải Server (như cũ, **đứng trước, cùng thứ tự**) rồi tài khoản Facebook; chung trần 200 tài khoản (≤ 32 KB). Phần Zalo của payload giống hệt bản V461.
- `reason` của Facebook: `inactive`, `paused`, `checkpoint` (mới, chỉ Facebook; Zalo `checkpoint` vẫn là `not_logged_in`), `not_logged_in`, `browser_tab_closed` (mọi tài khoản Facebook khi tab chưa mở, cùng điều kiện tick của scheduler).
- `runningCampaignId` có cả trong lượt "Chạy ngẫu nhiên" Facebook ([campaignScheduler.ts](../src/main/services/campaignScheduler.ts) `runFacebookRandomQueue`), đặt/xoá quanh `executeCampaign` như hàng đợi thường. Map này chỉ dùng cho ảnh chụp.
- Web đang chạy (`normalizeDesktopRuntimeState`) nhận mọi chuỗi `reason` ≤ 60 ký tự và bỏ qua id lạ, nên bản Desktop này không làm hỏng Web cũ. Thiếu bản Desktop này thì Web chỉ hiện app bật/tắt.

## Kiểm chứng (07/11/2026)

- `PG_TEST_BINDIR=/usr/lib/postgresql/16/bin scripts/test-web-facebook-campaigns-sql.sh` (PG16, ~2 giây): nền dựng từ fixtures V461 + V461 + V464 và kiểm đúng 6 md5 + ACL production; **123 lời gọi caller cũ** (trang/snapshot ba view/tiến trình với 6 bộ token × lọc, chọn tất cả, `p_selected_id`, `p_ids`; dừng/tiếp tục và xoá Zalo Desktop/Server/SMS; xác thực 11 phiên) giống hệt trước apply, sau apply, sau rollback và sau apply lại; assertions Facebook (đọc, dừng/tiếp tục, xoá, đường ghi vẫn chặn, xác thực theo gói/ngày Việt Nam/loại client/chính sách, chính sách lỗi đóng, quyền); apply lại không đổi gì và giữ giá trị chính sách; rollback chạy lại được; nguồn lệch dừng không đổi gì; script so sánh 6/6 `patch_dry_run` và 40 dòng `*_same` đạt mà không đổi DB; script áp một lần dán cho trạng thái giống hệt migration thường, chạy lại bị chặn, nguồn lệch dừng; smoke production đạt.
- Desktop: `node scripts/desktop-runtime-snapshot-smoke.cjs` và hai typecheck (kết quả ở báo cáo commit).
- **Chưa chạy trên production**: script so sánh chỉ đọc cần phiên được tạo bảng/hàm `pg_temp` (Supabase MCP sẽ hỏi xác nhận), nên để tới lúc apply; script áp một lần dán tự chạy phần so sánh này và dừng nếu lệch.

## Triển khai

1. Apply V476 **ngoài giờ cao điểm** (10:00–11:30 và 14:00–16:00 VN là khung nặng nhất): `CREATE OR REPLACE` làm PostgREST nạp lại schema. Cách ưu tiên: chạy `..._compare.sql` (đọc kết quả) rồi `apply_migration` với nguyên file migration; không bấm được thẻ xác nhận MCP thì dán `..._guarded_apply.sql` vào SQL Editor (dòng cuối `applied`). Sau đó chạy `..._smoke.sql` trong `BEGIN … ROLLBACK`. Chính sách vẫn tắt nên khách chưa thấy gì.
2. Deploy API (akaAgentWebApp, nhánh `claude/vibrant-goodall-gn084w`; tài liệu `docs/FACEBOOK_CAMPAIGNS.md`), rồi Web. API mới chạy được với Web cũ. Thứ tự với bước 1 không bắt buộc: thiếu V476 thì RPC chính sách không có và phiên không có `web_facebook_campaigns`, API coi như tắt.
3. Canary: `organizationIds` = 1–2 tổ chức có cả Facebook và Zalo/SMS, có chiến dịch Facebook trên app 9.4.0.
4. `organizationIds: null` cho mọi tổ chức.
5. Bật `facebookOnlyLogin` (198 tổ chức chỉ có Facebook) sau khi menu rút gọn đã chạy.
6. Bản iOS, rồi bản Desktop có ảnh chụp tài khoản Facebook (không bắt buộc).

## Rollback

- Nhanh: `enabled=false` hoặc `facebookOnlyLogin=false`, không cần deploy.
- Đầy đủ: tắt chính sách rồi chạy `migrations/snapshots/web-facebook-campaigns-v476/rollback.sql` (guard md5, khôi phục 6 thân trước V476, bỏ 2 hàm mới, xoá khoá cấu hình; chạy lại được). Cũng là DDL nên chọn lúc DB dịu. API WebApp không cần deploy lại: lỗi gọi RPC chính sách (kể cả `PGRST202` khi hàm đã bỏ) được coi là tắt.
