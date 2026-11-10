# Lọc trùng SĐT khi tải dữ liệu trên Desktop + V493

Trạng thái (10/11/2026): code Desktop ở nhánh `claude/bold-hawking-4m2grp` (tách lại từ `dev_3` sau #633), **chưa merge, chưa build/phát hành**. **V493 ĐÃ apply akachat lúc 23:40:04 VN 10/11/2026** (`20261110164004 / migration_v493_campaign_input_duplicates_desktop`) theo yêu cầu "áp dụng cho desktop app akaAgent"; **không apply lại** (preflight từ chối khi Desktop đã có quyền); md5 sổ migration = md5 file `cbff0334481a6bec8758de67b86a0e96`. Biên nhận: [`migrations/snapshots/campaign-input-duplicates-desktop-v493/apply-receipt.json`](../migrations/snapshots/campaign-input-duplicates-desktop-v493/apply-receipt.json). Sau khi apply không sửa file migration (sổ lưu nguyên văn).

Bản Web (V491, hàm, quy tắc đối chiếu, số đo, công tắc): [CAMPAIGN_INPUT_DUPLICATES_V491.md](CAMPAIGN_INPUT_DUPLICATES_V491.md) và akaAgentWebApp `docs/CAMPAIGN_INPUT_DUPLICATES.md`. Desktop dùng **chung hàm V491 và chung công tắc** `web.campaign_input_duplicates` (đang `all`): đổi công tắc có hiệu lực cho cả hai, không cần phát hành lại.

## V493

`migrations/migration_v493_campaign_input_duplicates_desktop.sql` chỉ có một lệnh:

```sql
GRANT EXECUTE ON FUNCTION public.aka_agent_read_campaign_input_duplicates(bigint,bigint,text,text,jsonb) TO aka_agent_desktop;
```

- ACL sau V493 giống các hàm đọc Desktop đang gọi bằng token (V489 báo cáo chiến dịch, V462, V469): `{postgres, service_role, aka_agent_desktop}`.
- Preflight dừng khi: thiếu hàm V491 (`v493_v491_reader_missing`) hoặc role Desktop; thân hàm khác bản đã apply (md5 `prosrc` `fec350637de79d8d65e6cc1a9cbfc34f`); thuộc tính khác (SECURITY DEFINER, STABLE, chủ `postgres`, `search_path=pg_catalog, public` + `statement_timeout=20s`); ACL khác `{postgres, service_role}`; đã cấp Desktop (`v493_already_applied_do_not_reapply`).
- Postflight: ACL đúng ba role; `anon`/`authenticated` vẫn không EXECUTE; Desktop EXECUTE được; thân hàm không đổi.
- Không `COMMENT`, không `NOTIFY`: GRANT không kích hoạt `pgrst_ddl_watch` nên PostgREST không nạp lại schema. Chú thích hàm của V491 vẫn ghi "service_role only".
- Xác thực không đổi: `auto_assert_automation_identity` → `private.aka_agent_assert_request_ownership` (token Desktop phải thuộc đúng `p_staff_id`) rồi đòi username/password tự động hóa của staff; thân V491 đòi mọi tài khoản là tài khoản Zalo của chính staff trong tổ chức đó.
- Gỡ: `migrations/rollback_v493_campaign_input_duplicates_desktop.sql` (md5 `aa8676fc96b437b5525bf635887ffff6`) chỉ `REVOKE` quyền Desktop; API WebApp (`service_role`) vẫn đọc được; Desktop báo lựa chọn 2/3 "đang được cập nhật", lọc trong file như cũ.
- Preflight chỉ đọc lúc 23:39:36 VN: hàm V491 đúng md5 `prosrc`/`pg_get_functiondef` (`42754064…`), ACL `{postgres, service_role}`, Desktop chưa EXECUTE; sổ migration mới nhất V492; không nhánh nào trong repo dùng số V493.
- Hậu kiểm: ACL `{postgres, service_role, aka_agent_desktop}`, md5 thân/định nghĩa, cấu hình, chú thích giữ nguyên. Gọi thử bằng đúng role `aka_agent_desktop` (claim không có `sub`): lời gọi vào hàm và bị chuỗi xác thực chặn bằng `42501 desktop_staff_scope_denied` (không còn `permission denied for function`), không ghi gì. Cùng role đọc được dòng công tắc. `postgrest_logs` không có dòng nạp lại schema; phút apply 14.200 request, 0 lỗi 5xx/503, p50 46 ms.
- Từ 07:00 tới 23:45 VN 10/11 (gồm cả từ lúc V491 apply 22:08 VN) chưa có lượt gọi `rpc/aka_agent_read_campaign_input_duplicates` nào: API/Web có tính năng chưa deploy, Desktop chưa phát hành.

## Desktop

**Hợp đồng dùng chung.** `src/shared/campaignInputDuplicates.ts` chép **nguyên văn** akaAgentWebApp `packages/control-api/src/campaignInputDuplicates.ts` (md5 `56ad1622…` hai bên); sửa ở WebApp trước rồi chép lại. `src/shared/campaignImportVerification.ts` thêm `splitExistingImportEntries`/`importExistingExportMatrix`, `campaignImportWorkbook.ts` thêm `createImportMatrixWorkbook` (như WebApp campaign-core). `src/shared/campaignInputDuplicatesIpc.ts`: một kênh `campaign:input-duplicates` với hai loại `{kind:'setting'}` và `{kind:'check', request}`, trả `{ok:true,data} | {ok:false,code,message}`, không ném lỗi qua IPC.

**Main** ([campaignInputDuplicatesService.ts](../src/main/services/campaignInputDuplicatesService.ts) → [campaignInputDuplicatesRepository.ts](../src/main/data/repositories/campaignInputDuplicatesRepository.ts)), qua client HTTP sẵn có của tiến trình:

- `setting`: một dòng `auto_system_settings` (`key=web.campaign_input_duplicates`, `is_active`, không bí mật); thiếu dòng, sai định dạng hoặc đọc lỗi = `off` (ẩn khung, chỉ lọc trong file).
- `check`: đọc lại công tắc (không cache, đổi `off`/`admin_akabiz` có hiệu lực ngay như API Web), kiểm quyền xem theo `isAdminAkabiz` của phiên, kiểm yêu cầu bằng `validateInputDuplicatesRequest` với `maxDays` của công tắc (≤ 2.000 số, 1–500 tài khoản, chỉ `zalo_message_phone`), rồi một lượt RPC V491 bằng token Desktop + mật khẩu tự động hóa; staff/tổ chức lấy từ phiên, không nhận từ renderer.
- Tối đa 2 lượt cùng lúc mỗi tiến trình (renderer gửi tuần tự), quá thì báo bận, không xếp hàng; hạn mỗi lượt 25 s (DB 20 s). Không cache kết quả, không hẹn giờ, không client/pool/kết nối mới.

| Lỗi | Mã IPC | Câu hiện |
|---|---|---|
| Công tắc `off`, hoặc `admin_akabiz` mà không phải admin akaBiz | `input_duplicates_disabled` | Lọc trùng với chiến dịch khác chưa mở cho tài khoản này. Vui lòng chọn "Chỉ trong file này". |
| `PGRST202`, `42883`, `42501` "permission denied for function" (V491/V493 chưa có hoặc đã gỡ) | `input_duplicates_not_ready` | Lọc trùng với chiến dịch khác đang được cập nhật… |
| `input_duplicates_account_scope_denied` | `input_duplicates_account_denied` | Có tài khoản không thuộc quyền của bạn trong tổ chức này… |
| `automation_auth_*`, chưa đăng nhập | `session_invalid` | Phiên đăng nhập không còn hợp lệ… |
| `42501` khác (token khác staff…) | `input_duplicates_access_denied` | Không có quyền đối chiếu dữ liệu này. |
| `57014` hoặc hết 25 s | `input_duplicates_timeout` | Đối chiếu… quá thời gian. Chưa có dữ liệu nào được nhập… |
| `22023`, yêu cầu sai ở Main | `invalid_input_duplicates_request` | Yêu cầu lọc trùng không hợp lệ… |
| Quá 2 lượt | `input_duplicates_busy` | Hệ thống đang đối chiếu nhiều dữ liệu… |
| Còn lại, JSON hỏng | `input_duplicates_unavailable` | Chưa đối chiếu được với dữ liệu đã tải lên… |

**Renderer** ([CampaignDataUploadModal.tsx](../src/renderer/src/components/CampaignPanels/CampaignDataUploadModal.tsx), [InputDuplicateAccountPicker.tsx](../src/renderer/src/components/CampaignPanels/InputDuplicateAccountPicker.tsx), [InputDuplicateFormNote.tsx](../src/renderer/src/components/CampaignPanels/InputDuplicateFormNote.tsx), [CampaignImportDuplicates.css](../src/renderer/src/components/CampaignPanels/CampaignImportDuplicates.css)) chép từ WebApp `apps/web/src/features/`, giống Web về chữ và luồng:

- Khung "Lọc trùng dữ liệu" chỉ hiện khi nơi gọi truyền `duplicateCheck`, loại chiến dịch hỗ trợ (`zalo_message_phone`) và công tắc mở cho phiên; cửa sổ tự đọc công tắc mỗi lần mở (một dòng).
- Ba lựa chọn: **Chỉ trong file này** (mặc định), **Với tài khoản đang chọn**, **Với các tài khoản Zalo bạn chọn** (hộp chọn tài khoản theo nhóm, tìm không dấu, chọn cả nhóm; danh sách lấy từ tài khoản Zalo chưa xóa của app — đã theo nhân viên/tổ chức — và DB kiểm lại từng tài khoản). Khoảng 7/14/30/90 ngày hoặc 1–`maxDays`. Số ngày và tài khoản đã chọn nhớ trên máy theo tổ chức + nhân viên (`localStorage` `aka.campaignImportDuplicates.v1:<org>:<staff>`); lựa chọn mặc định luôn là "Chỉ trong file này".
- "Kiểm tra dữ liệu" kiểm trong file như cũ rồi đối chiếu số hợp lệ theo lượt 2.000 số, tuần tự, có thanh tiến độ. IPC không hủy được: "Hủy kiểm tra" dừng trước lượt kế tiếp và bỏ kết quả lượt đang chạy. Lỗi: "Thử lại" hoặc "Chỉ lọc trong file", chưa chèn gì. Tab template akaBiz chờ bấm "Kiểm tra dữ liệu" khi đang đối chiếu chiến dịch khác.
- Nhóm kết quả "Đã có ở chiến dịch khác" (chiến dịch gần nhất, tài khoản, ngày tải lên, trạng thái; Excel 9 cột template + nơi đã có) và hộp "Xác nhận nhập dữ liệu" trước khi chèn; chỉ chèn số mới, kèm tóm tắt (`duplicates`: phạm vi, số ngày, tài khoản, lúc đối chiếu, số đã bỏ qua) cho nơi gọi.

Nơi gọi truyền `duplicateCheck` (như Web: chưa chọn tài khoản thì không hiện khung):

| Nơi | "Tài khoản đang chọn" | Bỏ qua chiến dịch |
|---|---|---|
| Form tạo/nhân bản chiến dịch ([CampaignFormModal](../src/renderer/src/components/CampaignPanels/CampaignFormModal.tsx)) | mọi tài khoản đã tick | — |
| Form Agent ([CampaignAgentFormModal](../src/renderer/src/components/CampaignPanels/CampaignAgentFormModal.tsx) → [CampaignAgentDataImportModal](../src/renderer/src/components/CampaignPanels/CampaignAgentDataImportModal.tsx)), cả "thay" và "thêm" | mọi tài khoản đã tick | — |
| "Thêm data" của chiến dịch ([CampaignPanel](../src/renderer/src/components/CampaignPanels/CampaignPanel.tsx)) | tài khoản của chiến dịch | chính chiến dịch đó |

Không truyền (chỉ lọc trong file như trước): Nhóm data (`DataGroupManagerModal`), Kiểm tra SĐT Zalo (`ZaloPhoneCheckModal`).

Hai form có ghi chú trong mục Dữ liệu (chỉ trong phiên form, không lưu vào nháp): "Đã lọc trùng với dữ liệu N ngày của … lúc HH:MM · bỏ qua N số". Lọc theo "tài khoản đang chọn" rồi đổi tài khoản thì cảnh báo, "Kiểm tra lại" đối chiếu cả danh sách với tài khoản mới và hỏi trước khi bỏ số; "Để sau" ẩn cảnh báo cho bộ tài khoản đó.

Tải DB như Web: chỉ khi khách chọn lựa chọn 2/3 và bấm kiểm tra; mỗi 2.000 số một lượt RPC chỉ đọc (V491 đo 2.000 số/76 tài khoản 1,3 s, 10.000 số nhân viên nhiều dữ liệu nhất ~4,7 s khi nguội).

## Kiểm chứng

- `AKA_AGENT_WEBAPP_REPO=<checkout akaAgentWebApp> bash scripts/test-v493-campaign-input-duplicates-desktop.sh` (Postgres 16 cục bộ, fixture V491 của WebApp): **25/25** — preflight từ chối thân/ACL khác; ACL sau apply; token Desktop ra JSON giống hệt `service_role` (cả số `+84 912 000 004`); chặn token staff khác, sai/thiếu mật khẩu, sai tổ chức, tài khoản staff khác, loại khác, ngày/số quá giới hạn, query sai, token không gắn staff; `anon`/`authenticated` vẫn bị chặn; apply lại bị từ chối; rollback chỉ thu quyền Desktop; apply lại sau rollback; thiếu V491 thì dừng; dữ liệu không đổi.
- `node scripts/campaign-input-duplicates-service-smoke.cjs`: **11/11** — đọc công tắc (một dòng, lỗi/thiếu/sai = tắt), tham số RPC (token + mật khẩu, staff/tổ chức từ phiên, `excludeCampaignId` chỉ khi có), cổng công tắc đọc lại mỗi lượt, kiểm yêu cầu tại chỗ, bảng mã lỗi không lộ SQL, JSON hỏng, tối đa 2 lượt, hết hạn hủy lượt và nhả chỗ, chưa đăng nhập.
- `node scripts/campaign-input-duplicates-ui-smoke.cjs` (modal thật trong Electron + Playwright, IPC giả, chặn HTTP; trong container cloud chạy bằng root: `ELECTRON_DISABLE_SANDBOX=1 xvfb-run -a node …`): **11/11** — mặc định, ba lựa chọn, hộp chọn tài khoản (nhóm, nhãn loại, tìm không dấu, tri-state, Hủy/Xong, nhớ), lượt đối chiếu đúng tham số, nhóm "Đã có ở chiến dịch khác" + Excel, hộp xác nhận (Quay lại, Excel, Nhập), tóm tắt gửi nơi gọi, nhớ số ngày/tài khoản, `maxDays`, lỗi → Thử lại / Chỉ lọc trong file, 2.500 số = 2.000 + 500 có tiến độ và Hủy kiểm tra, tab template, công tắc off/admin/đọc lỗi, loại khác và nơi gọi không truyền thì không đọc công tắc, ghi chú form (Kiểm tra lại, Để sau, không thấy số, lỗi), không lỗi renderer. `UI_SMOKE_SCREENSHOT_DIR=<thư mục>` để chụp kết quả và hộp xác nhận.
- Hồi quy `scripts/campaign-import-ui-smoke.cjs`: 21/21 khi bỏ dòng `modal.screenshot` (chụp phần tử của cửa sổ Electron ẩn dưới `xvfb-run` treo ở "waiting for element to be stable", mã gốc cũng vậy).
- `npx tsc --noEmit -p tsconfig.node.json`, `-p tsconfig.web.json`, `NODE_OPTIONS=--max-old-space-size=8192 npm run build`: đạt.
- Chưa chạy: gọi RPC thật bằng phiên Desktop đăng nhập thật (mới thử quyền bằng role `aka_agent_desktop` ở hậu kiểm), Windows/macOS thật.

### Kiểm thử bằng dữ liệu thật (00:05–00:17 VN 11/11/2026, chỉ đọc qua MCP)

Mỗi lượt là một giao dịch `rollback`, chỉ SELECT (không bảng tạm, không ghi). Gọi đúng hàm V491 dưới `service_role` (cùng thân hàm Desktop gọi; Desktop chỉ khác bước xác thực). Mỗi lượt so với một truy vấn đối chứng đi theo chiến dịch (`idx_campaign_input_data_campaign_id`), không qua index md5 SĐT. Truy vấn đối chứng tính lại quy tắc: cùng loại, tài khoản trong danh sách, bỏ `staged`, bỏ chiến dịch loại trừ, dòng chưa xóa, trong N ngày VN, chiến dịch đã xóa chỉ tính dòng đã chạy. Số mẫu chọn ngẫu nhiên cố định theo md5. Tài liệu không ghi SĐT.

| Lượt | Kết quả trả / đối chứng | Thiếu / thừa / lệch trường | Thời gian |
|---|---|---|---|
| Staff 1368, 30 ngày, 14 tài khoản Zalo, 238 mục (201 số hợp lệ khác nhau) theo nhóm | 86 / 86 | 0 / 0 / 0 | 469 ms |
| Staff 1368, 7 ngày | 34 / 34 | 0 / 0 / 0 | 562 ms |
| Staff 1368, chỉ tài khoản nhiều dữ liệu nhất | 31 / 31 | 0 / 0 / 0 | 9 ms |
| Staff 1368, loại chiến dịch nhiều dữ liệu nhất (như "Thêm data") | 85 / 85 | 0 / 0 / 0 | 10 ms |
| Staff 1368, 5.000 số (4.000 của staff + 1.000 của staff khác) chia 2.000/2.000/1.000 tuần tự như app | 3.643 / 3.643 | 0 / 0 / 0, không trùng giữa các lượt | 4,2 / 3,5 / 2,2 s |
| Staff 917, theo nhóm | 68 / 68 | 0 / 0 / 0 | 307 ms |
| Staff 756 (có chiến dịch "thêm thành viên nhóm" bằng SĐT), theo nhóm | 40 / 40 | 0 / 0 / 0 | 83 ms |
| Staff 603 (155 nghìn dòng, phần lớn ở chiến dịch đã xóa chưa chạy), 2.000 số | 1.945 / 1.945 | 0 / 0 / 0 | **15,0 s nguội**, 1,5 s lặp lại |
| Staff 385 (tổ chức lớn nhất, 76 tài khoản), 2.000 số | 1.706 mục | — | 1,2 s, 0,17 s lặp lại |

Kết quả theo nhóm số (staff 1368/917/756):

- Có ở ≥2 chiến dịch hoặc 1 chiến dịch: tìm thấy hết.
- Chỉ có ở chiến dịch đã xóa: dòng đã chạy thì tìm thấy, "latest" ghi chiến dịch đã xóa (25/25, 6/6); dòng chưa chạy thì không tìm thấy (0/25, 0/25).
- Chỉ cũ hơn 30 ngày: 0/25. Chỉ trong 7–30 ngày: thấy khi chọn 30 ngày, 0/30 khi chọn 7 ngày.
- Số của nhân viên khác: 0/25. Số không có: 0/40.
- Chỉ có ở loại chiến dịch khác (thêm thành viên nhóm): 0/20. Số có ở cả hai loại chỉ được đếm phần "Nhắn tin theo SĐT".
- Khi loại một chiến dịch: số chỉ có ở chiến dịch đó không tìm thấy (0/30), và chiến dịch đó không bao giờ là "latest".
- Khi chọn một tài khoản: số chỉ có ở tài khoản khác không tìm thấy (0/30).
- `+84…` và `84 xxx xxx xxx` ra đúng số `0…`. `bad`, `123`, chuỗi rỗng bị bỏ (`phoneCount` = số hợp lệ khác nhau).

Xác thực với dữ liệu thật:

- Token Desktop của staff 1368 (ánh xạ qua `private.aka_agent_desktop_users`) qua được bước gắn nhân viên và dừng ở bước mật khẩu (`automation_auth_invalid`, app báo phiên không còn hợp lệ). Không dùng mật khẩu thật của khách.
- Cùng token hỏi staff khác: `desktop_staff_scope_denied`. Tài khoản Zalo của nhân viên khác trong danh sách: `input_duplicates_account_scope_denied`.

Dạng kết quả thật (3.849 mục của staff 603 + 1368):

- Không mục nào thiếu SĐT, tên chiến dịch, tên tài khoản hay trạng thái. `processed` luôn boolean. Mốc thời gian có micro giây `+00:00`, `parseInputDuplicatesResult` và định dạng ngày/giờ đọc đúng.
- `since` của DB (13/10/2026) trùng ngày `inputDuplicateWindowStart(30)` app hiện trước khi kiểm.
- Trạng thái "tạm dừng" nhưng đã chạy hiện "Đã chạy".

Chưa thử được:

- `staged`: 6 nhân viên có chiến dịch `staged` nhưng 0 dòng data, chỉ kiểm ở bộ SQL cục bộ.
- Bước mật khẩu thật của Desktop.

**Rủi ro thời gian.** Một lượt 2.000 số phải đọc mọi dòng có cùng SĐT ở mọi tổ chức. Danh sách của staff 603 khớp 49.372 dòng ở 2.361 chiến dịch (27.756 dòng của chính staff). Khi bộ nhớ đệm nguội, lượt đó mất 15 s, gần trần 20 s của hàm; lặp lại chỉ 1,5 s. Quá 20 s thì app báo "quá thời gian" và "Thử lại" thường qua (lượt sau đã nóng). Muốn chắc hơn: renderer gửi 1.000 số mỗi lượt (giữ trần 2.000 ở API/DB), sửa hằng số chia lượt ở hợp đồng dùng chung WebApp rồi chép lại.

## Còn lại

1. Merge nhánh vào `dev_3`, phát hành Desktop trong bản sau (V493 đã apply). Desktop cũ không có khung nên không gọi hàm.
2. Sau khi phát hành (và sau khi deploy API/Web): theo dõi `edge_logs` `rpc/aka_agent_read_campaign_input_duplicates` theo IP — lượt Desktop (IP khách) và Web (`167.88.158.106`): số lượt, thời gian, lỗi 57014/42501.
