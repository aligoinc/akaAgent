# Thêm nhóm data bằng Agent + Agent chọn bạn bè trên Desktop (V533–V539)

Trạng thái (14/11/2026): mã trên nhánh `claude_agent-chon-ban-be-desktop_from_dev_3_14_11` (tách `dev_3` tại `b372aed`),
**chưa merge, chưa build/phát hành**. Hàm DB V533–V538 **đã apply akachat 14/11/2026** từ akaAgentWebApp (không apply lại);
tệp chép nguyên byte vào `migrations/` ở nhánh này. **V539 (quyền token Desktop + cấu hình AI cho Desktop) chưa apply.**
Công tắc chung `auto_system_settings` `web.data_group_agent` = `{"audience":"all"}` từ 23:50:28 VN 14/11/2026 (mở cho mọi
người ở Web; Desktop đọc cùng dòng).

Bản Web, phương án, prompt, cổng đánh giá model thật và kiểm thử dữ liệu thật ở akaAgentWebApp:
`docs/DATA_GROUP_FRIEND_AGENT.md` (trang Nhóm khách hàng) và `docs/CAMPAIGN_FRIEND_AGENT.md` (form chiến dịch). Desktop dùng
**chung** hàm DB, prompt (một dòng `ai_form_configs`), model và công tắc với Web; không có luật lọc nào riêng của Desktop.

## Khách thấy gì

- **Quản lý nhóm data → "Thêm nhóm bằng Agent"** (dưới nút "Thêm nhóm"; không có ở chế độ chọn nhóm). Cửa sổ "Thêm nhóm data
  bằng Agent": chọn tài khoản Zalo, mô tả bạn bè bằng tiếng Việt, Agent hỏi lại tới khi rõ, cột phải hiện bộ lọc (code dựng từ
  JSON), Agent xác nhận thì đếm thử một lượt (20 người đầu), bấm **Tạo nhóm N bạn bè** mới ghi DB. Tạo xong: cửa sổ đóng, danh
  sách nhóm tải lại và chọn nhóm mới, thông báo `Đã tạo nhóm "…" với N bạn bè.` Ghi chú nhóm chứa bản tóm tắt bộ lọc.
- **Form chiến dịch (form thường và form Agent) → "Agent chọn bạn bè"** cạnh "Chọn bạn bè Zalo", chỉ loại
  `zalo_message_friend` ở chế độ "Chọn bạn bè để gửi", không có khi sửa chiến dịch đã lưu. Cùng cửa sổ với mục đích
  `campaign_recipients`: chỉ liệt kê tài khoản của form (một tài khoản thì khóa), không có ô tên nhóm; nút
  **Thêm N bạn bè vào danh sách** lấy UID + tên (chỉ đọc, tối đa 5.000) rồi form thêm vào danh sách data như nút chọn tay
  (bỏ người đã có). Dưới thanh công cụ có ghi chú nguồn "Agent đã thêm N bạn bè lúc HH:MM từ tài khoản …: <điều kiện>" (chỉ
  trong bộ nhớ, tối đa 3 dòng, mất khi danh sách trống) hoặc dòng gợi ý khi danh sách trống.
- Đóng cửa sổ, đổi tài khoản, bắt đầu lại khi đã có hội thoại: hỏi lại **ngay trong cửa sổ** ("Bỏ cuộc trò chuyện?"). Nút
  **Dừng** hủy lượt chat đang chạy (báo main hủy lượt AI).
- Tài khoản chưa có danh bạ bạn bè: ô nhập khóa, có dòng nhắc; trong form chiến dịch có nút "Quét bạn bè Zalo" mở bảng chọn bạn
  bè Zalo sẵn có (có quét). Câu chữ dùng chung với Web ghi "nhóm khách hàng"; Desktop đổi thành "nhóm data" khi hiển thị
  (`dataGroupAgentDesktopWording`), không đổi tệp hợp đồng.

## Hợp đồng dùng chung

`src/shared/zaloFriendFilter.ts` và `src/shared/dataGroupAgent.ts` chép **nguyên văn** akaAgentWebApp
`packages/control-api/src/` (md5 lúc chép: `729e6f1a…` và `6cab4373…`; sửa ở WebApp trước rồi chép lại). Renderer Desktop
không bật `downlevelIteration`: hai tệp này không được trải Set/Map bằng `...` (bản WebApp đã đổi sang `Array.from`).
`src/shared/dataGroupAgentIpc.ts` là hợp đồng IPC riêng của Desktop.

## DB

| Sổ `supabase_migrations.schema_migrations` | Tệp ở `migrations/` | md5 (= md5 sổ) | Trạng thái |
|---|---|---|---|
| `migration_v533_data_group_friend_filter` | `migration_v533_data_group_friend_filter.sql` | `ae395105…` | đã apply 14/11 17:54 VN |
| `migration_v534_data_group_friend_filter_bind_after_ingest` | `migration_v534_…` | `ec648908…` | đã apply 14/11 18:06 VN |
| `migration_v535_data_group_friend_agent_config` | `migration_v535_…` | `c44383e8…` | đã apply 14/11 18:11 VN |
| `migration_v536_data_group_friend_filter_real_data_fixes` | `migration_v536_…` | `a35df7f1…` | đã apply 14/11 20:36 VN |
| `migration_v537_data_group_friend_filter_hash_joins` | `migration_v537_…` | `3c926af0…` | đã chạy 14/11 ~21:00 VN (SQL Editor), sổ ghi 21:10 |
| `migration_v538_data_group_friend_agent_prompt_campaign_recipients` | `migration_v538_…` | `32cadbac…` | đã apply 14/11 23:26 VN |
| `migration_v539_data_group_friend_agent_desktop` | `migration_v539_data_group_friend_agent_desktop.sql` | `4dbe42a7…` | **chưa apply** |

Nguồn SQL là akaAgentWebApp `scripts/sql/data-group-friend-agent/` (V539 = `migration_data_group_friend_agent_desktop.sql`).
Không apply lại V533–V538. Mỗi tệp có tệp `rollback_v5xx_…` cùng số.

### V539 (một giao dịch)

1. `GRANT EXECUTE … TO aka_agent_desktop` trên bốn hàm Desktop gọi: `aka_agent_list_zalo_friend_accounts_v1`,
   `aka_agent_read_zalo_friend_catalog_v1`, `aka_agent_read_zalo_friend_filter_v1`, `aka_agent_create_data_group_from_friend_filter_v1`.
   Không cấp `aka_agent_get_data_group_friend_filter_v1` (Desktop không dùng). Xác thực giữ nguyên:
   `auto_assert_automation_identity` → `private.aka_agent_assert_request_ownership` (token phải thuộc đúng `p_staff_id`) rồi đòi
   tên đăng nhập/mật khẩu tự động hóa của nhân viên (như V493/V522).
2. **Thân hàm tạo nhóm**: V534 gọi `aka_agent_create_data_group_v2(…, NULL::text, NULL::text)`; hàm đó kiểm lại danh tính nên với
   claim Desktop (không phải `service_role`) báo `automation_auth_required`. V539 chuyển nguyên `p_auth_username`/`p_auth_password`.
   API Web gọi bằng `service_role` với NULL nên kết quả với Web không đổi. md5 `prosrc`: V534 `0baacbe5…` → V539 `67422adb…`.
   Hàm nạp vẫn là overload 13 tham số (không đòi mật khẩu, không qua `aka_agent_assert_data_group_ingest_budget`), như Web.
3. Dòng `ai_form_configs` `app_data_group_friend_agent_web` (id 25): đặt `desktop_section_id = 'data_group.friend_agent'`. Proxy AI
   của API Web (`/api/aka-agent/desktop/v1/ai`) chỉ nhận dòng có `desktop_section_id`; nhiều dòng cấu hình khác (1, 2, 5, 7, 14)
   cũng có cả hai cột. Không ghi cột `id`; prompt/schema/model giữ nguyên.

Preflight dừng khi: thiếu role Desktop; đã apply (`v539_already_applied_do_not_reapply`); một trong bốn hàm khác md5 `prosrc` +
`proconfig` của bản đã apply, không SECURITY DEFINER, không do `postgres` sở hữu, hoặc ACL khác `{postgres, service_role}`; thiếu
`aka_agent_create_data_group_v2` có tham số mật khẩu; dòng cấu hình khác dự kiến hoặc `desktop_section_id` đã bị dòng khác dùng.
Postflight: md5/config đúng, ACL đúng ba role, `anon`/`authenticated` không EXECUTE, hàm đọc bộ lọc của nhóm vẫn không cấp Desktop,
dòng cấu hình có cả hai section. Đọc sổ production 14/11 trước khi viết: chưa có V539 (dòng mới nhất V538); bốn hàm đúng md5/ACL mà
preflight đòi. **Apply muộn hơn thì đọc lại.** CREATE OR REPLACE FUNCTION là DDL nên PostgREST tự nạp lại schema (như V534–V537).

Gỡ: `rollback_v539_data_group_friend_agent_desktop.sql` trả thân hàm V534, thu quyền Desktop, bỏ `desktop_section_id`; áp lại được.

Kiểm: bộ kiểm SQL của akaAgentWebApp (`AKA_AGENT_REPO=<akaAgent> PGBIN=/usr/lib/postgresql/16/bin sh
scripts/test-data-group-friend-filter-sql.sh`, fixture `scripts/data-group-routing` của repo này + chuỗi xác thực token Desktop
của production như `test_v522.py`): **258/258** (241 khi `FRIEND_FILTER_PERF=0`), trong đó 39 bước V539: trước V539 token Desktop
bị từ chối; hàm tạo nhóm cũ từ chối claim Desktop thiếu mật khẩu (lý do sửa thân hàm); preflight dừng khi cấu hình/thuộc tính/quyền
lệch; sau V539 token Desktop ra **cùng kết quả** với `service_role` cho danh sách tài khoản, danh mục, lọc count/page/ids; tạo nhóm
bằng token Desktop đúng thành viên, gắn tài khoản, ghi chú, bấm lại cùng `requestId` không tạo nhóm thứ hai; chặn token nhân viên
khác, token không gắn nhân viên, sai/thiếu mật khẩu, sai tổ chức, `anon`, `authenticated`, hàm đọc bộ lọc của nhóm; API Web vẫn tạo
nhóm sau V539; gỡ trả nguyên V534 rồi áp lại được.

### Apply V539 (chưa làm)

1. Đọc sổ và hàm (chỉ đọc): chưa có `migration_v539_%`; bốn hàm đúng md5 ở bảng preflight; dòng id 25 `desktop_section_id` NULL.
2. Apply bằng Supabase `apply_migration` với nguyên văn tệp, tên `migration_v539_data_group_friend_agent_desktop` (một giao dịch,
   giờ nào cũng được; Web không đổi hành vi). Không chạy thẳng tệp trong SQL Editor vì tệp không tự ghi sổ.
3. Hậu kiểm: `md5(statements[1])` = `4dbe42a7e66773f8067955fd8cd0db2c`; ACL bốn hàm `{aka_agent_desktop, postgres, service_role}`;
   md5 thân hàm tạo nhóm `67422adb36468e88428a332c49b45b0c`; gọi thử bằng role `aka_agent_desktop` không có `sub` thì bị chặn
   `desktop_staff_scope_denied` (không ghi gì).
4. Ghi biên nhận vào tài liệu này, `docs/agents/CURRENT_STATE.md`, `CLAUDE.md`.

## Main

[dataGroupAgentService.ts](../src/main/services/dataGroupAgentService.ts) →
[zaloFriendFilterRepository.ts](../src/main/data/repositories/zaloFriendFilterRepository.ts), kênh IPC
`data-group-agent:request` / `data-group-agent:cancel` ([dataGroupAgentHandlers.ts](../src/main/ipc/handlers/dataGroupAgentHandlers.ts)),
qua client HTTP sẵn có của tiến trình. Đây là bản Desktop của module API Web `dataGroupFriendFilter.ts` + lượt chat
`dataGroupAgent` (cùng luật, cùng đổi lỗi).

- `setting`: một dòng `auto_system_settings` (`web.data_group_agent`, `is_active`, không bí mật), đọc mỗi lần mở cửa sổ Quản lý
  nhóm data hoặc form chiến dịch loại nhắn bạn bè; đọc lỗi = tắt. Hiện nút theo `dataGroupAgentVisible` /
  `dataGroupAgentCampaignFormVisible` với `isAdminAkabiz` của phiên.
- Mỗi lượt `accounts`/`turn`/`filter`/`recipients`/`create` **đọc lại công tắc** (`off`, chỉ admin akaBiz, `campaignForm: false`
  có hiệu lực ngay như API Web) rồi gọi RPC với nhân viên/tổ chức của phiên và mật khẩu tự động hóa; renderer không gửi danh tính.
- `turn`: kiểm request (`validateDataGroupAgentRequest`), đọc danh mục của đúng tài khoản, không có bạn bè thì `no_friends` (không gọi
  AI), đọc dòng cấu hình theo `desktop_section_id` (thiếu = `not_configured`), kiểm schema DB khớp `DATA_GROUP_AGENT_SCHEMA`
  (Structured Outputs strict, tên `data_group_friend_agent`), che SĐT/UID/email lần nữa, **một** lần `callAiUsing` qua proxy AI
  sẵn có (key không về Desktop; `ai_log` theo `form_config_id` 25 và tài khoản), rồi `parseDataGroupAgentResponse`.
- `filter` (count/page/ids) và `recipients`: tối đa **2 lượt cùng lúc mỗi tiến trình**, chờ chỗ tối đa 20 giây rồi báo bận;
  lượt bị hủy hoặc lỗi đường truyền **giữ chỗ tới hết ngân sách 65 giây** của DB (không chứng minh được DB đã dừng; như bộ điều
  phối của API Web). `recipients`: một lượt `ids`, hơn 5.000 → `friend_recipients_too_many`, rồi đọc `id,uid,name` của
  `auto_account_contacts` theo khóa chính, lô 500 tuần tự, kèm tài khoản/nhân viên/tổ chức/`contact_type='person'`/`is_friend`.
- `create`: một lượt mỗi tiến trình; lỗi đường truyền báo "bấm Tạo nhóm lại để kiểm tra (không tạo trùng)" (renderer giữ cùng
  `requestId` cho cùng bộ lọc + tên).
- Lượt mới cùng loại hủy lượt cũ; `cancel(requestId)` hủy lượt `turn`/`filter`/`recipients`; đăng xuất/đổi phiên/thoát app gọi
  `stop()` cùng chỗ với AI của form. Kết quả về sau khi phiên đổi bị bỏ. Không cache, không hẹn giờ, không client/pool mới.

| Lỗi DB / tình huống | Mã IPC | Câu hiện |
|---|---|---|
| `PGRST202`, `42883`, `42501 permission denied for function` (V539 chưa apply/đã gỡ) | `friend_filter_unavailable` | Chức năng lọc bạn bè đang được cập nhật… |
| `automation_auth_*`, `desktop_staff_scope_denied`, chưa đăng nhập | `session_invalid` | Phiên đăng nhập không còn hợp lệ… |
| `friend_filter_too_many_messages` (`details` = số ngày) | cùng mã | …chỉ xét được tối đa N ngày gần nhất… |
| `friend_filter_account_unavailable`, `…catalog_changed`, `…empty`, `…request_conflict` | cùng mã | câu của hợp đồng |
| `57014`, hết hạn đường truyền | `friend_filter_timeout` | Lọc bạn bè quá thời gian chờ… |
| Không còn chỗ sau 20 giây | `friend_filter_busy` | Đang có nhiều yêu cầu lọc dữ liệu… |
| Còn lại | `friend_filter_failed` | Không thể lọc bạn bè lúc này… (không lộ SQL) |

## Renderer

- Cửa sổ: [DataGroupAgentDialog.tsx](../src/renderer/src/components/DataGroups/dataGroupAgent/DataGroupAgentDialog.tsx) +
  [useDataGroupAgent.ts](../src/renderer/src/components/DataGroups/dataGroupAgent/useDataGroupAgent.ts) (bản Desktop của
  cửa sổ Web; epoch bỏ kết quả cũ, AbortController → IPC cancel), dựng bằng `DataGroupFormDialog` sẵn có, CSS
  `DataGroupAgent.css` (dùng lại lớp chat của `CampaignPanels/campaignAgent.css`).
- Quản lý nhóm data: [DataGroupManagerModal.tsx](../src/renderer/src/components/DataScan/DataGroupManagerModal.tsx) đọc công tắc một
  lượt khi mở (không ở chế độ chọn nhóm), đặt cửa sổ quản lý `inert` khi cửa sổ Agent mở.
- Form chiến dịch: hook dùng chung [useCampaignFriendAgent.tsx](../src/renderer/src/components/DataGroups/dataGroupAgent/useCampaignFriendAgent.tsx)
  gắn vào `CampaignFormModal` và `CampaignAgentFormModal` (nút, ghi chú, cửa sổ; thêm dòng bằng `appendUniqueDetails` của form).
  Loại khác không đọc công tắc.

## Kiểm thử

| Bài | Lệnh | Kết quả 14/11/2026 |
|---|---|---|
| SQL V533–V539 (PostgreSQL 16 dựng tạm, fixture `scripts/data-group-routing`, hàm nạp thật, chuỗi xác thực token Desktop) | ở akaAgentWebApp: `AKA_AGENT_REPO=… PGBIN=/usr/lib/postgresql/16/bin sh scripts/test-data-group-friend-filter-sql.sh` | 258/258 (241 khi `FRIEND_FILTER_PERF=0`) |
| Service (không DB, không AI thật) | `node scripts/data-group-agent-service-smoke.cjs` | 61/61 |
| Giao diện Electron thật, IPC giả: Quản lý nhóm data + hook form | `ELECTRON_DISABLE_SANDBOX=1 xvfb-run -a node scripts/data-group-agent-ui-smoke.cjs` | 9/9 |
| Hai form chiến dịch thật (form thường, form Agent), fixture `campaign-agent-ui-smoke.tsx` | `ELECTRON_DISABLE_SANDBOX=1 xvfb-run -a node scripts/data-group-agent-form-smoke.cjs` | 2/2 form |
| Hồi quy form chiến dịch | `node scripts/run-campaign-content-typing-smoke.cjs`, `node scripts/campaign-agent-smoke.cjs` | đạt |
| Kiểu, build | `npx tsc --noEmit -p tsconfig.node.json`, `-p tsconfig.web.json`, `npm run build` | 0 lỗi; build đạt (renderer cần `NODE_OPTIONS=--max-old-space-size=8192` trong container 15 GB) |

`scripts/zalo-group-member-uid-smoke.cjs` hỏng sẵn trên `dev_3` `b372aed` (`process is not defined` khi nạp dotenv), không liên quan.
Ảnh chụp bài giao diện: thêm `AKA_UI_SMOKE_SHOW=1 UI_SMOKE_SCREENSHOT_DIR=<thư mục>`.

Chưa kiểm:

- Gọi thật qua PostgREST bằng token Desktop của nhân viên và proxy AI với model thật (V539 chưa apply, Desktop chưa phát hành).
  Prompt và model đã qua cổng đánh giá model thật ở WebApp (58/58) với cùng ngữ cảnh.
- Cửa sổ thật với DB thật trên Windows/macOS; tài khoản rất nhiều bạn bè từ Desktop (đã đo trên DB thật qua đường Web: lượt nguội
  đầu tiên của tài khoản gửi nhiều nhất 21,7 giây, ấm dưới 1,5 giây).

## Thứ tự đưa vào dùng

1. Apply V539 (bước ở trên). Web không đổi hành vi.
2. Merge nhánh vào `dev_3`, build và phát hành Desktop. Công tắc đang `all` nên bản mới hiện nút cho mọi người ngay.
   **Đừng phát hành trước khi apply V539**: nút vẫn hiện nhưng mở cửa sổ sẽ báo "Chức năng lọc bạn bè đang được cập nhật".
3. Canary: một tài khoản thật, tạo nhóm thử rồi xóa, xem `ai_log` theo `form_config_id = 25` (có cả lượt Web và Desktop).

## Tắt và gỡ

- Tắt nhanh cho cả Web và Desktop: `web.data_group_agent` = `{"audience":"off"}`; chỉ tắt nút trong form chiến dịch:
  thêm `"campaignForm": false`. Desktop đọc lại mỗi lượt và mỗi lần mở cửa sổ/form.
- Chỉ gỡ Desktop: chạy `rollback_v539_…` (Desktop báo "đang được cập nhật"; Web chạy như trước).
- Gỡ mã: revert commit của nhánh; không có dữ liệu riêng của Desktop (nhóm tạo bằng Agent là nhóm data thường + dòng
  `auto_data_group_friend_filters`, cùng bảng với Web).
