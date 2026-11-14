# Bộ lọc Hành động và "Gộp hành động vào một dòng" ở tab Kết quả chạy trên Desktop + V539/V540

Trạng thái (15/11/2026): mã Desktop trên nhánh `claude_bo-loc-hanh-dong-ket-qua-chay_from_dev_3_14_11` (tách từ `dev_3`), PR #684 vào
`dev_3`, **chưa merge, chưa build phát hành**.

- **V539 = SQL đã chạy trên akachat**: tối 14/11/2026 người dùng tự chạy tệp WebApp
  `scripts/sql/campaign-result-actions/migration_campaign_result_actions.sql` bằng SQL Editor. Thân hai hàm khớp tệp, nhưng **sổ migration
  không có dòng**. `migrations/migration_v539_campaign_result_actions.sql` là bản chép giống từng byte tệp đó
  (md5 `e845efc8b9b2f37f0793addd316a599f`). **Đừng chạy lại**: preflight từ chối (`campaign_result_actions_already_exists_do_not_overwrite`).
  Cần dòng sổ thì ghi riêng V539 với md5 tệp này.
- **V540 ĐÃ apply akachat lúc 00:10:26 VN 15/11/2026** (`20261114171026 / migration_v540_campaign_result_actions_desktop`)
  theo yêu cầu của người dùng; md5 sổ = md5 tệp `55a9e025328616e613a89402015706df`; **không apply lại** (preflight từ chối).
  Biên nhận: [`migrations/snapshots/campaign-result-actions-desktop-v540/apply-receipt.json`](../migrations/snapshots/campaign-result-actions-desktop-v540/apply-receipt.json).
  Sau khi apply không sửa tệp migration (sổ lưu nguyên văn). Nếu V540 bị gỡ, bộ lọc trên Desktop chỉ còn "Tất cả" kèm dòng
  "Bộ lọc theo hành động đang được cập nhật"; danh sách kết quả "Tất cả" vẫn đọc hàm v2 như cũ.

Số migration: lúc apply (00:09 VN 15/11) sổ có V532–V538, không có V530/V531/V539/V540, không nhánh `claude*` nào khác dùng V539/V540.
V530 đã có người giữ trên nhánh `claude_tao-sua-chien-dich-facebook-email_from_dev_3_14_11`. Việc "Agent nhóm khách hàng" của WebApp ghi
"số kế tiếp là V539 trở đi": số V539 (tệp, chưa có dòng sổ) và V540 (đã có dòng sổ) nay thuộc tính năng này, việc đó phải lấy V541 trở đi.

Bản Web, hợp đồng, phương án, số đo DB thật, kiểm với dữ liệu thật: akaAgentWebApp `docs/CAMPAIGN_RESULT_ACTION_FILTER.md` và
`docs/CAMPAIGN_RESULT_ACTION_FILTER_PLAN.md` (nhánh `claude/stoic-knuth-8jjyyf`, PR #237 vào `dev_1`).

## Hành vi

Tab **Kết quả chạy** có bộ lọc **Hành động**, đứng đầu thanh lọc, mặc định **Tất cả**:

- **Tất cả**: đúng request cũ (`listCampaignDetailsPage` không có khóa `actionCode`, hàm v2).
- **Từng hành động**: các hành động đã cấu hình theo thứ tự chạy, kể cả chưa có lượt; rồi hành động chỉ còn trong lịch sử (nhãn
  "Không còn bật"); cuối cùng "Chưa rõ hành động" (lượt cũ không có `action_code`). Mỗi mục kèm số lượt trên cả chiến dịch. Danh sách
  kết quả đọc bằng hàm v3 với `p_action_code`.
- **Gộp hành động vào một dòng**: mỗi data một dòng, mỗi hành động một cột. Ô hiện trạng thái, trạng thái phụ, nhãn tương tác,
  thời gian và ghi chú của lượt mới nhất; nút "+N lượt trước" mở các lượt cũ tại chỗ. Data có hơn 50 lượt ghi
  "N lượt · hiện 50 lượt mới nhất". Khung hẹp hơn 640 px thì thành thẻ. Desktop đặt khung chi tiết hết bề rộng cửa sổ nên thẻ chỉ
  hiện khi cửa sổ rất hẹp. Sắp xếp theo data: bốn cách như Data ban đầu, mặc định "Cập nhật gần nhất". Khoảng thời gian, Trạng thái,
  Tương tác Zalo và Tìm kiếm chọn những data có ít nhất một lượt khớp; dòng vẫn hiện đủ mọi hành động. Lượt của data đã xóa khỏi
  danh sách chỉ có ở "Tất cả". Loại Facebook không có data đầu vào (đăng bài trang cá nhân, tương tác newsfeed) không có mục Gộp.
- **Excel**:
  - Một hành động: file `ket-qua-chay-<id>-<tên hành động không dấu>.xlsx`, cùng các cột như "Tất cả".
  - Gộp: file `ket-qua-chay-<id>-gop.xlsx` hai sheet: "Theo người nhận" (mỗi data một hàng, mỗi hành động một nhóm cột) và
    "Tất cả lượt".
  - Xuất gộp: một lượt lấy mã data khớp bộ lọc, đúng thứ tự đang xem (tối đa 100.000). Rồi đọc lần lượt từng lô 200 data.
    Bấm "Hủy xuất" thì dừng giữa các lô và không ghi file dở.
  - Tên file "Tất cả" giữ như cũ.
- **Chip trạng thái ở tab Báo cáo**: mỗi chip của một hành động mở Kết quả chạy lọc đúng hành động đó và trạng thái đó. Mục khác của
  báo cáo mở với "Tất cả".
- **Đổi chiến dịch** thì bộ lọc về "Tất cả".
- **Khi nào đọc danh sách hành động**: không đọc khi mở tab. Chỉ đọc lần đầu mở bảng chọn, hoặc khi đang ở một hành động hay chế độ gộp.
  "Tải lại" chỉ đọc lại khi đã từng đọc. Không polling, không tự thử lại.

## Hợp đồng dùng chung

`src/shared/campaignResultActions.ts` chép nguyên văn akaAgentWebApp `packages/control-api/src/campaignResultActions.ts`. Chỉ khác ba chỗ:

- phần import;
- `CampaignPlatform = string` (Desktop có thêm Facebook và Email);
- kiểu `ZaloEngagementWithStatus` khai tại chỗ. Desktop chưa đọc bảng đồng bộ trạng thái tin nhắn, nên không có mốc "Đã nhận" như
  tab Kết quả chạy hiện có.

Sửa ở WebApp trước rồi chép lại. Phần thân phải giống WebApp từng dòng:
`diff <(sed 1,12d src/shared/campaignResultActions.ts) <(sed 1,4d <WebApp>/packages/control-api/src/campaignResultActions.ts)` không ra gì.

`src/shared/campaignResultActionsIpc.ts`:

- Kênh `campaign:result-actions` với bốn loại yêu cầu: `actions`, `page`, `keys`, `byKeys`.
- Trả `{ok:true,data} | {ok:false,code,message}`, không ném lỗi qua IPC.
- Khác WebApp: ngày lọc là mốc ISO đầy đủ, renderer tính đầu/cuối ngày như danh sách "Tất cả".

## Main

[campaignResultActionsService.ts](../src/main/services/campaignResultActionsService.ts) →
[campaignResultActionsRepository.ts](../src/main/data/repositories/campaignResultActionsRepository.ts), qua client HTTP sẵn có của
tiến trình:

- **Gọi DB**:
  - Mỗi yêu cầu gọi một lượt `aka_agent_read_campaign_result_recipients` bằng token Desktop và mật khẩu tự động hóa, như V487/V489.
  - Riêng `actions` đọc thêm dòng chiến dịch (`readCampaignRunReportCampaign`, dùng chung với tab Báo cáo) để biết hành động đã cấu
    hình (`getCampaignAccountOverviewActionDescriptors`). Tên lấy từ `getAccountActionName`; mã Desktop không biết thì dùng tên đã ghi
    trên lượt.
  - `page`/`keys`/`byKeys` không đọc dòng chiến dịch: hàm DB tự kiểm chủ chiến dịch theo staff/tổ chức.
- **Kiểm đầu vào trước khi gọi DB**, cùng giới hạn với WebApp: thứ tự, tương tác, ngày, trang ≤ 1.000.000, ≤ 100 dòng/trang, `byKeys`
  1–200 mã khác nhau.
- **Điều tiết**: gộp lượt trùng; tối đa 3 lượt khác nhau cùng lúc (cổng riêng `ReportReadFlights(3)`, không chặn báo cáo khác); hạn
  cả lượt 65 s. Không cache kết quả, không hẹn giờ.
- **Mã lỗi**:

  | Lỗi | Mã trả renderer |
  | --- | --- |
  | `PGRST202`/`42883` (thiếu hàm), `42501 permission denied for function` (V540 chưa apply/đã gỡ) | `campaign_result_actions_not_ready` |
  | `campaign_not_found` | `campaign_not_found` |
  | `automation_auth*` | `session_invalid` |
  | `42501` khác | `report_access_denied` |
  | `22023` | `invalid_campaign_result_query` |
  | `57014`/hết hạn | `campaign_result_recipients_timeout` |
  | còn lại | `campaign_result_recipients_unavailable` |

  Câu báo tiếng Việt, không lộ SQL.

**Lọc một hành động** đi qua bộ đọc sẵn có `listCampaignDetailsPage` ([campaignRepository.ts](../src/main/data/repositories/campaignRepository.ts)):

- `CampaignDetailPageQuery.actionCode` có giá trị (mã hợp lệ, hoặc `''` cho lượt chưa ghi hành động) thì gọi
  `aka_agent_list_campaign_details_page_v3`: cùng tham số với v2, thêm `p_action_code`, cùng payload.
- Không có khóa này thì gọi đúng v2 như trước.
- v3 lỗi thì ném câu tiếng Việt của bảng mã trên; tab hiện "Bộ lọc theo hành động đang được cập nhật" kèm nút "Xem tất cả".

## Renderer

- `CampaignPanel.tsx`: bộ lọc nằm trong hệ dropdown sẵn có của tab (`actionsAction`, đóng khi bấm ra ngoài/Esc/cuộn).
- Chế độ gộp không gọi `listCampaignDetailsPage`.
- `campaignStore.campaignDetailPageError` giữ lỗi của lượt đọc trang gần nhất, chỉ hiện khi đang lọc theo hành động.
- Thành phần mới ở `components/CampaignPanels/CampaignResults/`: `useCampaignResultActions`, `CampaignResultActionList`,
  `CampaignResultMergedView`, `campaignResultMergedExport`, `CampaignResults.css`.
- Chip ở `CampaignRunReport/CampaignRunReportTab.tsx` truyền `{ code, name }` của hành động.

## V540

`migrations/migration_v540_campaign_result_actions_desktop.sql` chỉ có hai lệnh `GRANT EXECUTE … TO aka_agent_desktop` cho
`aka_agent_list_campaign_details_page_v3(…14 tham số)` và `aka_agent_read_campaign_result_recipients(bigint,bigint,text,text,bigint,jsonb)`.

- **Preflight dừng khi**:
  - thiếu một trong hai hàm (`v540_v539_readers_missing`);
  - thiếu role Desktop;
  - md5 `prosrc` khác bản đã chạy 14/11: v3 `4e5c300305409908295c49d5d1941224`, người nhận `3fe7e5982398b42cc73fcc0433109b05`;
  - thuộc tính khác: SECURITY DEFINER, STABLE, chủ `postgres`, `search_path=pg_catalog, public` + `statement_timeout=60s` + `jit=off`;
  - ACL khác `{postgres, service_role}`;
  - đã cấp cả hai (`v540_already_applied_do_not_reapply`) hoặc mới cấp một (`v540_partially_applied_check_acl_by_hand`).
- **Postflight**: ACL đúng ba role, `anon`/`authenticated` vẫn không EXECUTE, thân hàm không đổi.
- **Không có `COMMENT`/`NOTIFY`**: PostgREST không nạp lại schema.
- **Xác thực không đổi**: hai hàm bắt đầu bằng `private.aka_agent_assert_request_ownership` (token Desktop phải đúng `p_staff_id`),
  rồi `auto_assert_automation_identity` (đúng username/password tự động hóa của staff).
- **Trước khi apply** (chỉ đọc, 00:09 VN 15/11): md5 `prosrc`/`pg_get_functiondef` và thuộc tính của hai hàm khớp; ACL
  `{postgres, service_role}`; role `aka_agent_desktop` có sẵn và đã EXECUTE được v2. Chạy thử nguyên tệp với `ROLLBACK` thay `COMMIT`
  trên production: preflight, hai GRANT, postflight đều qua; đọc lại ACL vẫn như cũ.
- **Sau khi apply**: ACL hai hàm `{postgres, service_role, aka_agent_desktop}`, `anon`/`authenticated` vẫn không EXECUTE; md5
  `prosrc`/`pg_get_functiondef`, cấu hình, chú thích (không có) giữ nguyên. Gọi thử bằng đúng role `aka_agent_desktop` (claim không có
  `sub`, giao dịch tự hủy): cả hai hàm đi vào và bị chuỗi xác thực chặn bằng `42501 desktop_staff_scope_denied`, không còn
  `permission denied for function`. PostgREST không nạp lại schema; 17:05–17:10 UTC 0 lỗi 5xx/503 (8–10 nghìn request/phút). Các dòng
  "Thread killed by timeout manager" của PostgREST tăng từ 17:00 UTC, trước lúc apply, không liên quan.
- **Gỡ**: `migrations/rollback_v540_campaign_result_actions_desktop.sql` chỉ `REVOKE` hai quyền Desktop. WebApp API (`service_role`)
  vẫn đọc được, Desktop chỉ còn "Tất cả".

## Kiểm chứng (14/11/2026, container cloud)

- **SQL cục bộ** (PostgreSQL 16, fixture WebApp có chuỗi xác thực token Desktop chép từ production):
  `AKA_AGENT_WEBAPP_REPO=<WebApp> bash scripts/test-v540-campaign-result-actions-desktop.sh`, **33/33**. Kiểm:
  - V539 giống từng byte tệp WebApp;
  - md5/thuộc tính cục bộ = production;
  - ba ca preflight từ chối;
  - token Desktop ra đúng JSON như `service_role` cho 8 lượt gọi (bốn chế độ, có và không lọc; v3 theo hành động, chưa ghi hành
    động, NULL = v2);
  - chặn token/mật khẩu/tổ chức/chiến dịch sai và token chưa gắn staff; anon/authenticated vẫn bị chặn;
  - apply lại V539/V540 bị từ chối;
  - rollback đưa Desktop về `permission denied for function`, Desktop vẫn đọc v2, `service_role` vẫn đọc được;
  - apply lại sau rollback đạt; thiếu hàm thì V540 dừng; dữ liệu không đổi.
- **Service** (không DB): `node scripts/campaign-result-actions-service-smoke.cjs`, **8/8**. Dùng câu trả lời thật của hàm V539 trên
  fixture (`scripts/fixtures/campaign-result-actions-rpc-samples.json`). Kiểm: tham số RPC, thứ tự hành động, `usesInputData`,
  chuyển bộ lọc, kiểm đầu vào trước khi gọi DB, bảng mã lỗi, gộp lượt trùng, lượt thứ 4 báo bận, hết hạn.
- **Giao diện**: `xvfb-run -a -s "-screen 0 1700x2400x24" node scripts/run-campaign-result-actions-ui-smoke.cjs`, **11/11**.
  `CampaignPanel` thật trong Electron, IPC giả, chặn HTTP. Ảnh chụp trong `$RESULT_ACTIONS_SMOKE_SCREENSHOT_DIR`. Kiểm:
  - "Tất cả" không gửi `actionCode`;
  - danh sách hành động đọc một lần khi mở bảng chọn;
  - chọn hành động gửi `actionCode`;
  - chưa sẵn sàng thì báo kèm "Xem tất cả";
  - gộp: một lượt đọc trang, không đọc trang kết quả, cột theo hành động, 55 lượt hiện 50, mở lượt trước, sắp xếp theo data, Excel
    hai sheet đúng thứ tự;
  - thẻ khi hẹp; chip Báo cáo; đổi chiến dịch về "Tất cả"; 0 lỗi renderer.
- **Hồi quy**: bộ kiểm giao diện tab Báo cáo `run-campaign-run-report-ui-smoke.cjs` vẫn **10/10** sau khi chip truyền hành động.
- **Typecheck và build**: `tsc -p tsconfig.node.json`, `tsc -p tsconfig.web.json` sạch; `npm run build` đạt.
- **Chưa làm**:
  - chưa chạy app Desktop thật với token Desktop trên DB thật (V540 đã apply, nhưng bản Desktop có tính năng chưa build);
  - chưa chạy trên Windows/macOS thật;
  - chưa build bộ cài.
