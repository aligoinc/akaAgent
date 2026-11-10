# Tab "Báo cáo" của chi tiết chiến dịch trên Desktop + V489

Trạng thái (10/11/2026): code Desktop trên nhánh `claude/campaign-run-report-desktop`, **chưa phát hành**. **V489 CHƯA apply** (chờ người dùng đồng ý). DB chưa có V489 thì tab báo "Báo cáo đang được cập nhật. Vui lòng thử lại sau." (lỗi `permission denied for function` được ánh xạ như hàm chưa có), các tab khác chạy như cũ.

Bản Web (V487, API/Web, hợp đồng, số đo tải): [CAMPAIGN_RUN_REPORT_V487.md](CAMPAIGN_RUN_REPORT_V487.md) và akaAgentWebApp `docs/CAMPAIGN_DETAIL_REPORT_TAB.md`.

## V489

`migrations/migration_v489_campaign_run_report_desktop.sql` (md5 file `2d86e15d9c654c92e78b347d66756097`) chỉ có một lệnh:

```sql
GRANT EXECUTE ON FUNCTION public.aka_agent_read_campaign_run_report(bigint,bigint,text,text,bigint,jsonb) TO aka_agent_desktop;
```

- ACL sau V489 giống các RPC báo cáo Desktop đang gọi: `aka_agent_read_report_page`, `aka_agent_read_campaign_effectiveness` (V462), `aka_agent_read_data_report` (V469) — `{postgres, service_role, aka_agent_desktop}`.
- Preflight dừng khi: thiếu hàm V487 (`v489_v487_reader_missing`); thân hàm khác bản đã apply (md5 `prosrc` `4bd734ca25612bfdade631c779373d42`); thuộc tính khác (SECURITY DEFINER, STABLE, chủ `postgres`, `search_path=pg_catalog, public` + `statement_timeout=60s`); ACL khác `{postgres, service_role}`; đã cấp Desktop (`v489_already_applied_do_not_reapply`).
- Postflight: ACL đúng ba role; `anon`/`authenticated` vẫn không EXECUTE; thân hàm không đổi.
- Không `COMMENT`, không `NOTIFY`: GRANT không kích hoạt `pgrst_ddl_watch` nên PostgREST không nạp lại schema; chạy giờ nào cũng được. Chú thích hàm của V487 vẫn ghi "service_role only" (đổi chú thích sẽ nạp lại schema).
- Xác thực không đổi: `auto_assert_automation_identity` gọi `private.aka_agent_assert_request_ownership` (token Desktop phải thuộc đúng `p_staff_id`) rồi đòi đúng username/password tự động hóa của staff.
- Gỡ: `migrations/rollback_v489_campaign_run_report_desktop.sql` (md5 `56731a6363f2762236721254645d8d19`) chỉ `REVOKE` quyền Desktop; WebApp API (`service_role`) vẫn đọc được.
- Đọc chỉ đọc trên production 10/11/2026: hàm V487 có md5 `prosrc` `4bd734ca…`, ACL `{postgres, service_role}`, `aka_agent_desktop` chưa EXECUTE; sổ migration mới nhất là V488; không nhánh nào trong repo dùng số V489.

## Desktop

**Hợp đồng dùng chung.** `src/shared/campaignRunReport.ts` chép nguyên văn akaAgentWebApp `packages/control-api/src/campaignRunReport.ts` (chỉ khác import và `ControlPlatform = EffectivenessPlatform` như `campaignEffectiveness.ts`); sửa ở WebApp trước rồi chép lại. `src/shared/campaignRunReportIpc.ts`: kênh `report:campaign-run`, trả `{ok:true,data} | {ok:false,code,message}`, không ném lỗi qua IPC.

**Main** ([campaignRunReportService.ts](../src/main/services/campaignRunReportService.ts) → [campaignRunReportRepository.ts](../src/main/data/repositories/campaignRunReportRepository.ts)), mỗi lượt mở/làm mới, tuần tự qua client HTTP sẵn có của tiến trình:

1. Một dòng `auto_campaigns` (`id, action_id, extra_settings` + `flatform_type` của tài khoản) theo staff/tổ chức, chưa xoá; tài khoản đã xoá vẫn xem được như tab Kết quả chạy.
2. Một lượt RPC V487 bằng token Desktop + mật khẩu tự động hóa, `p_query = campaignRunReportQuery()`.
3. Danh mục trạng thái (`loadActionReportStatusCatalog`) giữ 5 phút; không tải được thì dựng bằng tên trạng thái đã ghi.

Gộp lượt trùng của cùng chiến dịch; tối đa 2 lượt khác nhau mỗi tiến trình (cổng `ReportReadFlights` riêng, không chặn báo cáo khác; quá thì báo bận, không xếp hàng); hạn cả lượt 65 s (`REPORT_READ_TIMEOUT_MS`). Không cache kết quả, không hẹn giờ, không client/pool/kết nối mới.

Dựng báo cáo bằng `buildCampaignRunReport`: hành động cấu hình theo `getCampaignAccountOverviewActionDescriptors` (Tìm SĐT/Gắn tag/Đổi tên theo `extraSettings`), tên theo `getAccountActionName`; `usesInputData` như Web (Facebook "Đăng bài trang cá nhân"/"Tương tác newsfeed" tính theo lượt), thêm cho Desktop: chiến dịch không có data nào mà đã có kết quả thì tính theo lượt.

| Lỗi | Mã IPC | Câu hiện |
|---|---|---|
| `PGRST202`, `42883`, `42501` "permission denied for function" | `campaign_report_not_ready` | Báo cáo đang được cập nhật… |
| `P0002` / chiến dịch không thuộc staff | `campaign_not_found` | Không tìm thấy chiến dịch. |
| `42501` khác (token khác staff…) | `report_access_denied` | Không có quyền xem báo cáo này. |
| `57014` hoặc hết 65 s | `report_timeout` | Chiến dịch quá lớn để tổng hợp nhanh… |
| `automation_auth_*`, chưa đăng nhập | `session_invalid` | Phiên đăng nhập không còn hợp lệ… |
| Quá 2 lượt | `report_busy` | Hệ thống đang tổng hợp báo cáo khác… |
| Còn lại, JSON hỏng | `campaign_report_unavailable` | Chưa tải được báo cáo… |

**Renderer** ([CampaignRunReport/](../src/renderer/src/components/CampaignPanels/CampaignRunReport/)): chép từ akaAgentWebApp `apps/web/src/features/campaignReport/` — `CampaignReportCharts.tsx` và `CampaignReportView.css` nguyên văn; model/Excel khác kiểu dòng chiến dịch (`CampaignListItem`: gợi ý "Có số liệu mới" so `inputDataTotalCount`/`inputDataCompletedCount`/trạng thái với lượt đọc); view khác phần tải (IPC không hủy được: bỏ kết quả muộn, main gộp lượt trùng) và điều kiện "Thêm data" (như menu Desktop: không có khi chiến dịch nhận data từ nhóm).

- Tab "Báo cáo" đặt sau "Kết quả chạy"; chỉ đọc khi tab hiện và khung chi tiết mở.
- Chuyển qua tab khác của cùng chiến dịch rồi quay lại không đọc lại (giữ số và giờ cập nhật; "Làm mới" để đọc lại). Đổi chiến dịch hoặc đóng khung thì lần mở sau đọc lại. Bấm dòng chiến dịch khác vẫn về tab "Thông tin" như cũ.
- Menu ⋯ của dòng "Xem báo cáo chi tiết" mở tab Báo cáo và đọc số mới (trước đây mở Kết quả chạy; như Web, quyết định Q3).
- Bấm số mở Data ban đầu/Kết quả chạy lọc đúng trạng thái trên toàn thời gian (bỏ tìm kiếm, khoảng ngày, lọc tương tác).

Tải DB như Web: một lượt RPC mỗi lần mở/làm mới, đọc nguội ~0,75 ms mỗi kết quả (chiến dịch lớn nhất ~64 nghìn kết quả ≈ 48 s lần đầu, dưới 1 s khi đọc lại).

## Kiểm chứng

- `AKA_AGENT_WEBAPP_REPO=<checkout akaAgentWebApp> bash scripts/test-v489-campaign-run-report-desktop.sh` (Postgres 16 cục bộ, fixture V487 của WebApp): **24/24** — preflight từ chối khi timeout/ACL khác; ACL sau apply; token Desktop ra JSON giống hệt `service_role`; chặn token staff khác, sai mật khẩu, thiếu mật khẩu, sai tổ chức, chiến dịch staff khác/đã xoá, query sai, token không gắn staff; `anon`/`authenticated` vẫn bị chặn; apply lại bị từ chối; rollback chỉ thu quyền Desktop (Desktop nhận `permission denied for function`, `service_role` vẫn đọc); apply lại sau rollback; thiếu V487 thì dừng; dữ liệu không đổi.
- `node scripts/campaign-run-report-service-smoke.cjs`: **9/9** — tham số RPC; hai JSON V487 thật của production (Zalo nhắn theo SĐT có Tìm SĐT/Gắn tag/Đổi tên/Kết bạn, Facebook đăng nhóm; `scripts/fixtures/campaign-run-report-rpc-samples.json`, chỉ số đếm) tổng khớp ở mọi khối; `usesInputData`; cache/lỗi danh mục; bảng mã lỗi; gộp lượt, báo bận; hết hạn.
- `xvfb-run -a node scripts/run-campaign-run-report-ui-smoke.cjs` (CampaignPanel thật trong Electron + Playwright, IPC giả, chặn HTTP): **10/10** — KPI khớp số V487, đủ khối, không đọc lại khi chuyển tab, Làm mới, dạng bảng, Excel 4 sheet, bấm số mở tab đã lọc, sáng/tối/khung 980 px không tràn ngang, đổi chiến dịch, DB chưa sẵn sàng, kết quả muộn bị bỏ, menu "Xem báo cáo chi tiết", không lỗi renderer. Ảnh chụp ở `$REPORT_SMOKE_SCREENSHOT_DIR`.
- Hồi quy giao diện CampaignPanel: `run-campaign-data-sort-ui-smoke.cjs` và `run-campaign-engagement-ui-smoke.cjs` đạt. Trong container cloud chụp ảnh phần tử của cửa sổ Electron ẩn dưới `xvfb-run` treo ("waiting for element to be stable", mã gốc `dev_3` cũng vậy) nên hai bài cũ chạy với preload chặn `screenshot`; bài mới phóng viewport rồi `page.screenshot({ clip })`.
- `npx tsc --noEmit -p tsconfig.node.json`, `-p tsconfig.web.json`, `NODE_OPTIONS=--max-old-space-size=8192 npm run build`: đạt.
- Chưa chạy: gọi RPC thật bằng phiên Desktop (cần V489 trên production), Windows/macOS thật.

## Còn lại

1. Apply V489 (cần đồng ý; không cần đợi phát hành Desktop, không nạp lại schema). Sau apply không sửa file migration (sổ lưu nguyên văn).
2. Phát hành Desktop trong bản sau. Desktop cũ không có tab nên không gọi hàm.
