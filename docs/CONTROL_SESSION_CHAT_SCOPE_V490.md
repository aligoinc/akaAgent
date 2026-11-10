# V490 — Phiên iOS chỉ dùng Chat (10/11/2026)

Trạng thái: migration/tài liệu **đã merge `dev_3`** (PR #628, 18:17 VN). **V490 ĐÃ apply akachat lúc 18:21:17 VN 10/11/2026** (`20261110112117 /
migration_v490_control_session_chat_scope`) theo yêu cầu của người dùng; **không apply lại** (preflight từ chối
khi hàm đã có); md5 sổ migration = md5 tệp `def9660b54e21b590bd12f6206009eb7`. Biên nhận:
[`migrations/snapshots/control-session-chat-scope-v490/apply-receipt.json`](../migrations/snapshots/control-session-chat-scope-v490/apply-receipt.json).
Sau khi apply không sửa tệp migration (sổ lưu nguyên văn). Caller: WebApp API (aligoinc/akaAgentWebApp#190,
**chưa deploy**; xem `akaAgentWebApp/docs/IOS_PACKAGE_ACCESS.md`), app iOS chưa phát hành, nên chưa ai gọi hàm mới.

## Vì sao

`public.aka_agent_authenticate_control_session(text)` (chạy ở mọi request của Web/iOS) thu hồi phiên khi
nhân viên không có quyền akaAgent (`aka_agent_app_access_staff_allowed(staff,'akaAgent')`) hoặc tổ chức không
có gói chiến dịch. Nhân viên/tổ chức chỉ có akaChat vì vậy không dùng được Hội thoại trên app iOS.

## Thay đổi

Thêm `public.aka_agent_authenticate_control_session_chat_v2(text)`, **không sửa hàm cũ**:

- Thân hàm là bản sao đúng hàm cũ đang live (md5 prosrc `0ed750b83cb1188f8fd4ae2fd0898870`; preflight dừng nếu
  khác) thêm một nhánh: phiên `client_type = 'native'` của nhân viên có
  `aka_agent_app_access_staff_allowed(staff,'akaChat')` **và** `aka_agent_app_access_chat_runtime(org,false)`
  được giữ với `app_scope = 'chat'` ở đúng hai chỗ hàm cũ thu hồi (thiếu quyền akaAgent; thiếu gói chiến dịch).
- Kết quả `authenticated` có thêm `app_scope` (`full`/`chat`).
- Quyền Chat **chỉ được tính ở hai nhánh hàm cũ thu hồi phiên**, và chỉ với phiên native. Bản iOS mới gọi hàm
  này ở **mọi** request, nên phiên đầy đủ tốn đúng như hàm cũ (không gọi thêm hàm nào); Web/PWA không bao
  giờ tính quyền Chat. Phiên đã ở phạm vi chat (thiếu quyền akaAgent) bỏ qua cổng gói chiến dịch.
- Không bảng/index/policy/role/timeout/pool/kết nối mới. EXECUTE chỉ `service_role` (như hàm cũ).
- Thân hàm đã đối chiếu từng dòng (md5 từng dòng) với hàm cũ đang chạy trên akachat ngày 10/11/2026: chỉ
  khác các nhánh chat nêu trên. **Sửa hàm cũ về sau thì phải sửa cả hàm v2** (hai thân giữ giống hệt nhau
  ngoài các nhánh chat).

WebApp API chỉ gọi hàm mới cho request iOS gửi `x-aka-chat-only: 1`, và chặn phiên `chat` ở mọi route trừ
`/me`, đăng xuất, proxy Hội thoại. Dữ liệu Chat vẫn do Chat API phân quyền akaChat.

## Bàn giao theo safe-supabase-rpc-migration

| Mục | Giá trị |
|---|---|
| Hàm nguồn (không đổi) | `public.aka_agent_authenticate_control_session(text)`: md5 `prosrc` `0ed750b83cb1188f8fd4ae2fd0898870`, md5 `pg_get_functiondef` `692e2a068ce51377f6bd71fec20a8b0c`; owner `postgres`, SECURITY DEFINER, VOLATILE, `search_path=public`, ACL `{postgres=X/postgres,service_role=X/postgres}` (đọc trên akachat 10/11/2026) |
| Hàm mới | `public.aka_agent_authenticate_control_session_chat_v2(text)`: md5 `prosrc` `5f88c1bf6cf4aac84bffc67ccd58c13c`, cùng owner/security/volatility/config/ACL với hàm nguồn |
| Patch live được giữ | Thân dựng từ thân live (gồm desktopOnlyLogin V461/V464, facebookOnlyLogin V476, quyền app V446, hạn staff V309); so md5 từng dòng với live: chỉ khác các nhánh chat |
| Preflight | Hàm nguồn phải có và md5 `prosrc` đúng như trên; hàm mới chưa có; helper `aka_agent_app_access_*` có |
| Postflight | ACL (anon/authenticated không có, service_role có), md5 thân hàm mới, owner/security/volatility/config |
| Nơi apply | Chỉ akachat `cgjbsmqtfhqvttudyjzq` |
| Trạng thái | **Đã apply 18:21:17 VN 10/11/2026.** Preflight chỉ đọc 18:19:10 VN; chạy thử cả tệp trong giao dịch kết thúc `ROLLBACK` (đạt, sạch); apply nguyên văn tệp; hậu kiểm và thử hành vi bên dưới |

## Hậu kiểm sau apply (10/11/2026)

- Hàm mới: `aka_agent_authenticate_control_session_chat_v2(text) returns jsonb`, md5 `prosrc` `5f88c1bf…`, md5
  `pg_get_functiondef` `61e874b9b47b827d78e16c71bc9ef687`; owner/security/volatility/config/ACL đúng như hàm cũ;
  anon/authenticated không EXECUTE, service_role có. Hàm cũ giữ nguyên hai checksum và ACL.
- Thử hành vi rồi hủy (mỗi lời gọi trong giao dịch con bị hủy, cuối khối ném lỗi; không còn phiên tạm nào):
  - 200 phiên đang hiệu lực dùng gần nhất (194 web, 5 pwa, 1 native): hàm mới trả **giống hệt** hàm cũ ngoài
    `app_scope`, cả 200 ở phạm vi `full`.
  - Nhân viên chỉ dùng Chat có thật (tổ chức không có gói chiến dịch nào): phiên native tạm → `authenticated`,
    `app_scope = 'chat'`; hàm cũ với chính phiên đó → `invalid_staff`; phiên web tạm → `invalid_staff`.
- PostgREST nạp lại schema lúc 11:21:17 UTC (4,5 s, không lỗi). Edge 11:15–11:24 UTC: 0 lỗi 503/5xx,
  ~28–30 nghìn request/phút.

## Apply / rollback

- Apply: `migrations/migration_v490_control_session_chat_scope.sql` — **đã apply** 10/11/2026 18:21:17 VN (trước khi deploy API; vô hại khi chưa ai gọi).
- Rollback: `migrations/rollback_v490_control_session_chat_scope.sql` (API tự về hàm cũ khi thiếu hàm).
- Smoke local: `migrations/tests/v490_control_session_chat_scope_smoke.sql` (Postgres trống + stub; 16 ca đạt
  10/11/2026, gồm ca đếm lượt gọi chứng minh phiên đầy đủ và Web/PWA không tính quyền Chat). Không chạy smoke
  này trên production.
- Kiểm tra chỉ đọc trên akachat 10/11/2026 (trước khi apply): hàm cũ md5 `0ed750b83cb1188f8fd4ae2fd0898870`, chưa có hàm v2,
  migration mới nhất `20261110065525 migration_v489_campaign_run_report_desktop`.
