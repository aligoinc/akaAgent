# Lọc trùng khi thêm data vào Nhóm data trên Desktop + V522

Trạng thái (13/11/2026): code Desktop **đã merge `dev_3` qua [#670](https://github.com/aligoinc/akaAgent/pull/670),
chưa build/phát hành**. **V522 đã apply akachat 13/11/2026 22:23:07 VN** (`20261113152307 /
migration_v522_data_group_member_matches_desktop`; không apply lại; người dùng tự chạy bản dán SQL Editor; md5 sổ = file
`a9d5a64b…`; ACL `{aka_agent_desktop, postgres, service_role}`, thân hàm giữ md5, không nạp lại schema, 0 lỗi 5xx;
[biên nhận](../migrations/snapshots/data-group-member-matches-desktop-v522/apply-receipt.json)). Bản Desktop chưa có
tính năng không gọi hàm; gỡ V522 thì Desktop coi hàm là "chưa sẵn sàng" và cửa sổ nhập thêm data như trước, không báo lỗi.

**Trùng số 522:** PR #669 cũng lấy số 522 cho `migration_v522_zalo_engagement_catalog_ordered_walk` (chưa apply): sổ đã có V522 này nên preflight của bản đó từ chối (`v522 already recorded…`), bản đó phải đổi số trước khi apply (PR này không sửa file của #669).

Bản Web (hàm đọc V519, quy tắc đối chiếu, số đo, công tắc): [DATA_GROUP_MEMBER_MATCHES_V519.md](DATA_GROUP_MEMBER_MATCHES_V519.md)
và akaAgentWebApp `docs/DATA_GROUP_IMPORT_DUPLICATES.md`. Desktop dùng **chung hàm V519 và chung công tắc**
`web.campaign_input_duplicates` (trường `groupMatches`): đổi công tắc có hiệu lực cho cả hai, không cần phát hành lại.

## Vì sao cần

Hàm nạp `aka_agent_ingest_data_group` chỉ nhận ra data đã có trong nhóm khi dòng gắn với một tài khoản (định danh = tài
khoản + loại + uid). Nhóm không gắn tài khoản Zalo (5.031/5.094 nhóm data ngày 13/11/2026) để lọt data đã có từ file
khác hoặc lần dán khác thành dòng mới. Trước thay đổi này cửa sổ "Thêm data từ file" của Desktop cũng không có khung
"Lọc trùng dữ liệu" nào (khung lọc với chiến dịch của V491/V493 chỉ có ở form chiến dịch và "Thêm data").

## Khách thấy gì

Cửa sổ **Nhóm data → Thêm data vào nhóm → Thêm từ file data** có khung "Lọc trùng dữ liệu":

- **Với nhóm data** (loại SĐT, UID Zalo, link group Zalo; chỉ chủ nhóm):
  - "Bỏ data đã có trong nhóm này", bật sẵn. Bỏ chọn khi nhập lại cùng một file để cập nhật thông tin của data đã có.
  - "Bỏ data đã có ở nhóm data khác", tắt sẵn. Mặc định đối chiếu mọi nhóm data khác của chính nhân viên; "Chọn nhóm"
    mở hộp chọn (tối đa 200 nhóm, tải danh sách khi mở hộp).
- **Với chiến dịch nhắn tin** (chỉ loại SĐT, công tắc V491 mở cho phiên): ba lựa chọn như form chiến dịch. "Với tài
  khoản gắn với nhóm" chỉ hiện khi nhóm gắn tài khoản Zalo.
- Thứ tự đối chiếu: nhóm trước, chiến dịch sau; bước chiến dịch chỉ nhận các số còn lại.
- Nhóm kết quả mới "Đã có trong nhóm này", "Đã có ở nhóm khác" (kèm nhóm gần nhất và ngày vào nhóm, tải Excel được).
  Dòng vừa có trong nhóm này vừa có ở nhóm khác tính là "đã có trong nhóm này".
- Có dòng bị bỏ thì bấm "Thêm vào nhóm" sẽ mở hộp "Xác nhận thêm vào nhóm" liệt kê từng loại đã bỏ.
- Máy chủ chỉ được hỏi khi bấm "Kiểm tra dữ liệu" hoặc "Thêm vào nhóm". Tab template akaBiz tự kiểm tra trong máy;
  bước đối chiếu nhóm chạy lúc bấm "Thêm vào nhóm" (không có dòng nào bị bỏ thì thêm luôn).
- Câu báo sau khi thêm: `Đã thêm 2 data vào nhóm · đã bỏ qua 1 data đã có trong nhóm.`

Loại data khác (email, Facebook, dữ liệu đầu vào chiến dịch) chưa đối chiếu được: cửa sổ chỉ có một dòng ghi chú
"hệ thống bỏ dòng lặp trong file. Loại data này chưa đối chiếu được với data đã có trong nhóm."

### Tên danh sách khi có dòng bị lọc

DB coi mỗi lần nhập kiểu `upload` (Excel/CSV, template, ảnh, link sheet) là **làm mới danh sách cùng tên**: data thuộc
danh sách đó mà vắng ở lần nhập này bị gỡ khỏi nhóm. Khi cửa sổ đã bỏ bớt dòng, phần còn lại không còn là cả file, nên
được lưu thành danh sách mới `<tên> · đã lọc trùng dd/mm HH:MM` (giờ Việt Nam của lượt đối chiếu); hộp xác nhận báo
trước tên này. Không bỏ dòng nào thì giữ tên cũ như trước. Nhập từ ô dán/file txt là `manual` (cộng dồn) nên không
đổi tên. Cửa sổ nhập tự đặt tên (`planDataGroupImport` trong `src/shared/dataGroupImport.ts`); cửa sổ Nhóm data gửi
nguyên `submission.datasetName`.

## V522

`migrations/migration_v522_data_group_member_matches_desktop.sql` (md5 `a9d5a64b…`) chỉ có một lệnh:

```sql
GRANT EXECUTE ON FUNCTION public.aka_agent_read_data_group_member_matches(bigint,bigint,text,text,jsonb) TO aka_agent_desktop;
```

- ACL sau V522 giống các hàm đọc Desktop đang gọi bằng token (V493, V489, V462): `{postgres, service_role, aka_agent_desktop}`.
- Preflight dừng khi: thiếu hàm V519 (`v522_v519_reader_missing`) hoặc role Desktop; thân hàm khác bản đã apply (md5
  `prosrc` `0fffb42b865b8be45bf5a7f2f4e2db17`; bản cục bộ dựng từ file V519 có md5 `pg_get_functiondef`
  `8770c4dd…` trùng số đọc trên production sau khi apply V519); thuộc tính khác (SECURITY DEFINER, STABLE, chủ
  `postgres`, `search_path=pg_catalog, public` + `statement_timeout=15s`); ACL khác `{postgres, service_role}`; đã
  cấp Desktop (`v522_already_applied_do_not_reapply`).
- Postflight: ACL đúng ba role; `anon`/`authenticated` vẫn không EXECUTE; Desktop EXECUTE được; thân hàm không đổi.
- Không `COMMENT`, không `NOTIFY`: GRANT không kích hoạt `pgrst_ddl_watch` nên PostgREST không nạp lại schema.
- Xác thực không đổi: `auto_assert_automation_identity` → `private.aka_agent_assert_request_ownership` (token Desktop
  phải thuộc đúng `p_staff_id`) rồi đòi username/password tự động hóa của staff; thân V519 đòi nhóm đích là nhóm data
  của chính staff trong tổ chức đó và chỉ đọc liên hệ, thành viên, nhóm của staff đó.
- Gỡ: `migrations/rollback_v522_data_group_member_matches_desktop.sql` (md5 `6a0f6eaa…`) chỉ `REVOKE` quyền Desktop;
  API WebApp (`service_role`) vẫn đọc được; Desktop ẩn hai ô và thêm data như trước.
- Số 522: V520/V521 là nhắc gia hạn (`notification_package_expiring`, `renewal_link_tickets`; đã apply 13/11, vào
  `dev_3` qua #668; kiểm 13/11 trên 644 nhánh của repo). Đọc sổ production 13/11 22:20 VN (chỉ đọc): chưa có
  `migration_v522_%` (dòng mới nhất là V521 `20261113141849`); hàm V519 đúng `md5(prosrc)` `0fffb42b…`, thuộc tính
  và ACL `{postgres, service_role}` mà preflight đòi. Apply muộn hơn thì đọc lại.

### Apply (đã làm 13/11/2026 22:23:07 VN bằng bản dán SQL Editor; các bước để đối chiếu)

1. Đọc sổ và hàm (chỉ đọc): không có `migration_v522_%`; `md5(prosrc)` = `0fffb42b…`; ACL `{postgres, service_role}`.
2. Apply (GRANT, không nạp lại schema, giờ nào cũng được) bằng một trong hai cách:
   - Supabase MCP `apply_migration` với nguyên văn file, tên `migration_v522_data_group_member_matches_desktop`.
   - Dán SQL Editor bản gọn `migrations/tests/migration_v522_data_group_member_matches_desktop_paste.sql` (sinh bằng
     `scripts/build-v522-paste-sql.py`, cùng cách với V511/V521): một giao dịch, so md5 nội dung dán với file trước khi
     chạy, chạy nguyên preflight/postflight của file, tự ghi sổ `statements[1]` = nguyên văn file, bảng kết quả
     `status = applied`. Dán lại lần hai bị từ chối (`V522 đã có trong sổ migration, không chạy lại`), dán thiếu ký tự
     thì dừng trước khi chạy gì. **Đừng chạy thẳng file migration trong SQL Editor**: file không tự ghi sổ.
3. Hậu kiểm: `md5(statements[1])` của sổ = `a9d5a64b92affaf58ce264528c24c215`; ACL ba role; gọi thử bằng role
   `aka_agent_desktop` không còn `permission denied for function` (claim không có `sub` thì bị chặn bằng
   `desktop_staff_scope_denied`, không ghi gì).
4. Ghi biên nhận `migrations/snapshots/data-group-member-matches-desktop-v522/apply-receipt.json` và sửa trạng thái ở
   đầu tài liệu này, `docs/agents/CURRENT_STATE.md`, `CLAUDE.md`.

## Desktop

**Hợp đồng dùng chung.** `src/shared/dataGroupMemberMatches.ts` chép **nguyên văn** akaAgentWebApp
`packages/control-api/src/dataGroupMemberMatches.ts` (md5 `48bd245b…` hai bên; tệp không import gì); sửa ở WebApp
trước rồi chép lại. `src/shared/dataGroupImport.ts` là bản Desktop của `apps/web/src/lib/dataGroupImport.ts` (cùng
luật, khác cách đặt tên danh sách và chữ "data"). `src/shared/dataGroupMemberMatchesIpc.ts` là hợp đồng IPC.

**Main** ([dataGroupMemberMatchesService.ts](../src/main/services/dataGroupMemberMatchesService.ts) →
[dataGroupMemberMatchesRepository.ts](../src/main/data/repositories/dataGroupMemberMatchesRepository.ts)), kênh IPC
`data-group:member-matches`, qua client HTTP sẵn có của tiến trình:

- `setting`: một dòng `auto_system_settings` (`key=web.campaign_input_duplicates`, `is_active`, không bí mật), đọc mỗi
  lần mở cửa sổ. Thiếu dòng hoặc thiếu trường `groupMatches` = bật; chỉ `false` mới tắt. Đọc lỗi = tắt (cửa sổ nhập
  như trước, không chặn việc thêm data).
- `check`: đọc lại công tắc (không cache), kiểm yêu cầu bằng `validateDataGroupMemberMatchesRequest` (≤ 2.000 định
  danh = giới hạn RPC, renderer gửi lượt 1.000; `otherGroups` là `none`/`all`/≤ 200 id), thay định danh dài quá 512 ký
  tự bằng chuỗi rỗng để giữ vị trí, rồi một lượt RPC với `platform: 'zalo'`. Kết quả có `valueCount` khác số đã hỏi
  thì coi là lượt hỏng. Trong `check`, công tắc đọc lỗi là **lỗi để thử lại**, không âm thầm bỏ bước đối chiếu.
- Tối đa 2 lượt cùng lúc mỗi tiến trình (renderer gửi tuần tự), quá thì báo bận, không xếp hàng; hạn mỗi lượt 20 s
  (DB 15 s). Không cache kết quả, không hẹn giờ, không client/pool/kết nối mới.

| Lỗi | Mã IPC | Cửa sổ nhập |
|---|---|---|
| Công tắc `groupMatches: false` | `data_group_matches_disabled` | Ẩn hai ô, thêm như trước, không báo lỗi |
| `PGRST202`, `42883`, `42501` "permission denied for function" (V519/V522 chưa có hoặc đã gỡ) | `data_group_matches_not_ready` | Ẩn hai ô, thêm như trước, không báo lỗi |
| `data_group_matches_group_denied` | `data_group_matches_group_denied` | Khung lỗi: Nhóm data không còn hoặc không thuộc quyền của bạn… |
| `automation_auth_*`, `desktop_staff_scope_denied`, chưa đăng nhập | `session_invalid` | Khung lỗi: Phiên đăng nhập không còn hợp lệ… |
| `42501` khác | `data_group_matches_access_denied` | Khung lỗi |
| `57014` hoặc hết 20 s | `data_group_matches_timeout` | Khung lỗi: …quá thời gian. Chưa có data nào được thêm… |
| `22023`, yêu cầu sai ở Main | `invalid_data_group_matches_request` | Khung lỗi |
| Quá 2 lượt | `data_group_matches_busy` | Khung lỗi |
| Còn lại, JSON hỏng, công tắc đọc lỗi | `data_group_matches_unavailable` | Khung lỗi |

Khung lỗi có hai nút: "Thử lại" và "Thêm không đối chiếu" (thêm như trước V522; data đã có trong nhóm có thể thành
dòng mới). Khi khung lỗi còn hiện thì chưa thêm gì và nút "Thêm vào nhóm" bị khóa.

**Renderer** ([CampaignDataUploadModal.tsx](../src/renderer/src/components/CampaignPanels/CampaignDataUploadModal.tsx),
[DataGroupMatchPicker.tsx](../src/renderer/src/components/CampaignPanels/DataGroupMatchPicker.tsx),
[DataGroupManagerModal.tsx](../src/renderer/src/components/DataScan/DataGroupManagerModal.tsx)):

- Prop mới `destination: { kind: 'dataGroup', name, skipsExistingMembers, duplicateNote?, memberCheck? }`. Không truyền
  thì cửa sổ và chữ giữ như cũ (form chiến dịch, Thêm data, Kiểm tra SĐT không đổi).
- `memberCheck: { groupId, contactType, loadOtherGroups }`. Cửa sổ Nhóm data chỉ truyền khi người dùng là chủ nhóm và
  loại data là `phone`, `zalo_person_phone` (→ `phone`), `zalo_person_uid` (→ `person`) hoặc `zalo_group` (→ `group`).
  `loadOtherGroups` gọi `listDataGroups({ ownedOnly: true })` theo trang 100, tối đa 500 nhóm, chỉ khi mở hộp chọn;
  chưa tải hết thì hộp không coi "chọn hết" là "tất cả nhóm khác".
- `duplicateCheck` (V491/V493) nay được truyền cho nhóm loại SĐT; `currentAccounts` là tài khoản Zalo gắn với nhóm,
  rỗng thì ẩn lựa chọn 2.
- IPC không hủy được: "Hủy kiểm tra" dừng trước lượt kế tiếp và bỏ kết quả lượt đang chạy.
- Trong lúc đọc công tắc (một dòng, lúc mở cửa sổ) nút "Kiểm tra dữ liệu" và "Thêm vào nhóm" tạm khóa để không thêm
  trước khi biết có đối chiếu hay không.
- Định danh gửi đi: SĐT lấy `row.phone`; UID và link group lấy `row.uid` (link đã chuẩn hóa bằng
  `normalizeImportGroupLink`, đúng chuỗi cửa sổ Nhóm data gửi cho hàm nạp ở `row.url`).

## Kiểm thử

| Bài | Lệnh | Kết quả 13/11/2026 |
|---|---|---|
| SQL V522 (PostgreSQL 16 dựng tạm, fixture `scripts/data-group-routing`, hàm nạp thật, chuỗi xác thực token Desktop của production) | `PGBIN=/usr/lib/postgresql/16/bin python3 scripts/data-group-routing/test_v522.py` | 33/33 (27 ca migration + 6 ca bản dán SQL Editor) |
| Service (không DB) | `node scripts/data-group-member-matches-service-smoke.cjs` | 12/12 |
| Giao diện trên Electron thật (IPC giả), gồm cửa sổ "Quản lý nhóm data" thật | `ELECTRON_DISABLE_SANDBOX=1 xvfb-run -a node scripts/data-group-member-matches-ui-smoke.cjs` | 13/13 |
| Hồi quy cửa sổ nhập của chiến dịch | `…campaign-input-duplicates-ui-smoke.cjs`, `…campaign-add-data-duplicates-ui-smoke.cjs`, `node scripts/run-data-group-zalo-ui-smoke.cjs` | đạt |
| Kiểu | `npx tsc --noEmit -p tsconfig.node.json`, `-p tsconfig.web.json` | 0 lỗi |

Ảnh chụp bài giao diện: thêm `AKA_UI_SMOKE_SHOW=1 UI_SMOKE_SCREENSHOT_DIR=<thư mục>` (cửa sổ ẩn không vẽ nên ảnh treo).

Chưa kiểm:

- Gọi thật qua PostgREST bằng token Desktop của nhân viên (Desktop chưa phát hành; sau apply mới gọi thử bằng role
  `aka_agent_desktop` không có `sub`: vào được hàm và bị chặn bằng `desktop_staff_scope_denied`).
- Cửa sổ thật với DB thật trên Windows/macOS; nhân viên có rất nhiều nhóm (hơn 500) hoặc nhiều tài khoản.
- Nhóm đang đồng bộ Google Sheet/"quét tự động" (`datasetSyncMode`): đường nạp đó không đi qua cửa sổ này nên không đổi.

## Giới hạn đã biết

- Kết quả đối chiếu là ảnh chụp tại lúc hỏi; máy chủ không chặn lúc ghi. Hai người cùng nhập một danh sách vào cùng
  nhóm trong vài giây vẫn có thể sinh dòng trùng.
- Email, Facebook, Page và dữ liệu đầu vào chiến dịch chưa đối chiếu (hàm V519 chỉ nhận `phone`/`person`/`group`;
  nhánh `platform: 'facebook'` của hàm chưa được kiểm với hàm nạp thật cho dòng dạng link).
- Thêm từ dữ liệu quét và thêm tay từng dòng không đi qua cửa sổ này, không đổi.

## Tắt và gỡ

- Tắt nhanh cho cả Web lẫn Desktop, không DDL: thêm `"groupMatches": false` vào giá trị của `auto_system_settings`
  `web.campaign_input_duplicates`. Desktop đọc lại ở mỗi lần mở cửa sổ và mỗi lượt đối chiếu.
- Chỉ gỡ Desktop: chạy file rollback V522 (thu quyền). Desktop ẩn hai ô, thêm data như trước.
- Gỡ code: revert commit của nhánh; không có dữ liệu nào phải dọn (tính năng chỉ đọc; danh sách "… · đã lọc trùng …"
  là danh sách thường của nhóm).
