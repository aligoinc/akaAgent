# V502: hàm đọc tiến độ giới hạn cho danh sách chiến dịch (Web, iOS, Desktop) và tab "Hành động"

Ngày 12/11/2026. **CHƯA apply lên akachat.** Code Web/API và app iOS ở akaAgentWebApp nhánh `claude/fervent-gates-c8ldgw` (chưa deploy/phát hành; iOS đọc qua cùng API với Web, không gọi DB); Desktop ở akaAgent cùng nhánh (chưa build/phát hành). Web/API và Desktop chạy được khi DB chưa có hàm (cột "Giới hạn lượt" để trống, tab Hành động dùng bộ đọc cũ).

- Migration: [migration_v502_campaign_limit_progress.sql](../migrations/migration_v502_campaign_limit_progress.sql)
- Rollback: [rollback_v502_campaign_limit_progress.sql](../migrations/rollback_v502_campaign_limit_progress.sql) (chỉ `DROP FUNCTION`)
- Kiểm thử cục bộ: `bash scripts/test-v502-campaign-limit-progress.sh` (PostgreSQL 16, 66 kiểm tra, gồm hàm Desktop với chuỗi xác thực token chép từ production)
- Hợp đồng giao diện/API: akaAgentWebApp `docs/CAMPAIGN_LIST_LIMIT_PROGRESS.md`

## Nội dung

Chỉ thêm hai hàm, không đổi bảng/cột/index/policy/hàm cũ/timeout của role:

```
public.aka_agent_control_campaign_limit_progress(
  p_staff_id bigint, p_organization_id bigint, p_campaign_ids bigint[],
  p_chat_product_ids bigint[] DEFAULT '{}', p_extra_keys text[] DEFAULT '{}', p_detail boolean DEFAULT false
) RETURNS jsonb   -- STABLE, SECURITY INVOKER, statement_timeout 8s, EXECUTE chỉ service_role
```

```
public.aka_agent_read_campaign_limit_progress(
  p_staff_id bigint, p_organization_id bigint, p_auth_username text, p_auth_password text,
  p_campaign_ids bigint[], p_extra_keys text[] DEFAULT '{}', p_detail boolean DEFAULT false
) RETURNS jsonb   -- STABLE, SECURITY DEFINER, statement_timeout 8s, EXECUTE chỉ aka_agent_desktop
```

Hàm thứ hai là cửa vào của Desktop (thêm 12/11 trước khi apply, cùng file): `auto_assert_automation_identity` gắn token Desktop với `p_staff_id` (`private.aka_agent_assert_request_ownership`) rồi đòi tài khoản/mật khẩu tự động hóa của nhân viên đó, giống các hàm đọc báo cáo Desktop đang gọi (V487/V489, V491/V493); sau đó gọi hàm đọc với `p_chat_product_ids = '{}'` (Desktop tự biết tổ chức akaChat từ lúc đăng nhập, `chatSync` luôn `false`). JSON trả về trùng từng byte với hàm đọc cùng tham số (kiểm thử so md5 trong cùng giao dịch). `service_role` và `anon` không gọi được hàm Desktop; Desktop vẫn không gọi thẳng hàm đọc. Đối chiếu chuỗi xác thực trên production 12/11 (chỉ đọc): ba hàm cùng logic với bản trong kiểm thử, `auto_assert_automation_identity` md5 `7ffeb0f1…`.

Hàm đọc trả **số liệu thô**, không quyết định thay bộ chạy:

| Khóa | Nội dung |
| --- | --- |
| `now`, `vietnamDate`, `dayStartsAt`, `nextDayStartsAt` | Giờ DB và mốc ngày Việt Nam. |
| `chatSync` | Tổ chức có gói trong `p_chat_product_ids` đang bật `is_chat_sync` và còn hạn (chọn bộ chạy akaChat). |
| `campaigns[]` | Chiến dịch của đúng nhân viên/tổ chức, chưa xóa, tài khoản cùng nhân viên: trạng thái, lịch, `time_sleep_between_2`, `limitCheckActionCodes` của loại chiến dịch, tài khoản, nhóm tài khoản (chỉ `settings.byActionCode`), và `extra` gồm `actionLimits` + các khóa trong `p_extra_keys` (cờ, số, chuỗi ≤ 120 ký tự). |
| `statuses[]` | `auto_account_action_status` của các tài khoản đó; chế độ danh sách chỉ lấy hành động có kiểm tra giới hạn, chế độ chi tiết lấy hết. |
| `windows[]` | Mỗi cặp tài khoản–hành động cần kiểm tra: giờ các kết quả trong khung lớn nhất mà cài đặt có thể yêu cầu (65–1.440 phút), tối đa 500 dòng mới nhất, chia `e` (cờ `counts_toward_limit = true`), `l` (NULL, trạng thái `thành công`/`thất bại`), `o` (NULL, trạng thái khác); bỏ dòng `false`. `truncated` khi chạm trần. |
| `siblings[]` | Chiến dịch khác của nhân viên chạy hôm nay trên cùng tài khoản (để báo dùng chung bộ đếm). |
| `actionNames[]` | Tên hành động theo nền tảng. |
| `today[]` | Chỉ khi `p_detail`: kết quả hôm nay theo hành động, chiến dịch, trạng thái, cờ tính giới hạn. Tên chiến dịch chỉ trả khi thuộc đúng nhân viên/tổ chức. |

Giới hạn hiệu lực (nhóm → chiến dịch → mặc định → trần gói) và cách đếm theo bộ chạy tính ở API WebApp (`campaignPendingLimits.ts`), cùng code với "Tại sao CD không chạy?" và Chẩn đoán; trên Desktop tính ở main bằng đúng các hàm của tab "Hành động"/Chẩn đoán Desktop (xem mục Desktop).

Ràng buộc: `p_campaign_ids` 1–101 phần tử, chế độ chi tiết đúng 1 phần tử. Đọc khung giờ bằng `idx_auto_campaign_details_action_rate (account_id, action_code, created_at) WHERE is_delete = false AND action_code IS NOT NULL`; preflight dừng nếu thiếu index này. Vì index có điều kiện `is_delete = false`, hàm bỏ dòng kết quả đã xóa mềm, trong khi bộ chạy không lọc `is_delete` khi đếm khung giờ; code Desktop không có chỗ nào xóa mềm kết quả nên hai cách đếm trùng nhau trên thực tế.

## Số đo trước khi apply (12/11/2026, chỉ đọc)

Thân hàm chạy dưới dạng câu truy vấn trên production:

- 8 cặp tài khoản–hành động: 170 block, 11,6 ms kể cả 14 lượt đọc đĩa.
- Nhân viên có nhiều chiến dịch nhất (100 chiến dịch, 120 cặp, Facebook): 639 ms lần đầu. Bản nháp đầu trả 518 KB vì mỗi chiến dịch có ~169 khóa cài đặt dạng cờ/số; đã đổi sang `p_extra_keys` để chỉ trả khóa cần.
- Danh sách Web gọi RPC trang trung bình 0,145 lần/giây (45 ngày) nên hàm mới thêm cùng mức đó.

Chưa đo bằng hàm thật (chưa apply).

## Apply

- Tạo hàm là DDL: PostgREST nạp lại schema, nên apply buổi tối muộn (xem ghi chú V494 về 21 lỗi 500 của gateway chat khi nạp lại schema lúc 17:23).
- Trước khi apply, đọc lại sổ migration: số `vN` dùng chung cho mọi repo/nhánh, sáng 12/11 sổ đã tới V501. Nếu V502 đã bị dùng thì đổi số file và tên hàm lỗi `v502_*` trước khi apply.
- Sau apply: gọi thử dưới `service_role` cho một nhân viên thật, đo thời gian và kích thước; ghi biên nhận vào `migrations/snapshots/campaign-limit-progress-v502/`.

## Desktop (12/11/2026, chưa build/phát hành)

- **Danh sách chiến dịch**: cột "Giới hạn lượt" sau cột Trạng thái (mỗi hành động một dòng: đã chạy hôm nay/giới hạn ngày, số trong khung giờ khi đáng hiện, dòng "Tạm khóa · mở lại …", "Đủ lượt hôm nay · lượt mới từ …", "Nghỉ theo giờ · chạy tiếp khoảng …"); bỏ cột "Ngày update", ngày update là dòng nhỏ "Cập nhật …" trong cột Trạng thái (cả hàng nháp). Bấm ô mở tab Hành động. Chiến dịch hoàn thành để trống; tạm dừng làm xám.
- **Tab Hành động** dạng thẻ như Web: mốc chạy lại của cả chiến dịch, mỗi hành động một thẻ (trạng thái + giờ chạy lại, hôm nay, trong giờ + giờ từng lượt rời khung, kết quả hôm nay chia theo chiến dịch), rồi Nhịp chạy và lịch, Dự kiến (ước tính), Tài khoản; nút "Sửa giới hạn" mở cửa sổ Cập nhật giới hạn gửi có sẵn. DB chưa có V502 thì tab vẫn hiện thẻ từ bộ đọc cũ (chưa có mốc chạy lại/kết quả hôm nay/phần quản trị).
- **Đường đọc**: IPC `campaign:limit-progress` (≤ 101 id, gộp lượt trùng, tối đa 2 lượt, hạn 10 giây, bỏ kết quả khi đổi phiên, lỗi gì cũng chỉ hiện thông báo chung) → [campaignLimitProgressService](../src/main/services/campaignLimitProgressService.ts) → [campaignLimitProgressRepository](../src/main/data/repositories/campaignLimitProgressRepository.ts) → RPC `aka_agent_read_campaign_limit_progress`. Kênh tab `campaign:account-actions` giữ nguyên, đọc V502 chế độ chi tiết rồi quay về bộ đọc cũ khi hàm chưa có hoặc chiến dịch nằm ngoài phạm vi V502 (tổ chức trống).
- **Công thức**: danh sách hành động `getCampaignAccountOverviewActionDescriptors`, mã kiểm tra giới hạn `campaignQuotaCodes`, giới hạn `resolveCampaignActionQuotaLimit` (cùng Chẩn đoán/bộ chạy); đếm khung giờ: akaChat chỉ dòng có cờ, bộ chạy akaAgent cộng dòng cũ thành công/thất bại, SMS/gọi cộng mọi dòng cũ (như `countCampaignActionWindow`). Hành động được bỏ qua khi hết lượt theo `isSkippableLimitAction` của bộ chạy; Facebook không báo giờ chạy lại của cả chiến dịch (giống Web).
- **Nhịp đọc**: đi theo lượt danh sách tự tải lại (~30 giây khi trang Chiến dịch đang hiện) nhưng tối đa 1 lượt/60 giây cho cùng tập chiến dịch; đổi trang/bộ lọc, bấm Làm mới danh sách, vừa sửa giới hạn hoặc vừa mở khóa hành động thì đọc ngay. Không có bộ hẹn giờ gọi mạng riêng; số "trong giờ" tự giảm theo đồng hồ máy chủ.
- **Hợp đồng dùng chung**: `src/shared/campaignLimitProgress.ts` chép nguyên văn WebApp `packages/control-api/src/campaignLimitProgress.ts`, `src/shared/campaignActionsView.ts` chép WebApp `campaignActionsView.ts` (chỉ bỏ đuôi `.js` ở dòng import; tab Hành động Desktop dùng `campaignActionsEstimate` của file này) — sửa ở WebApp trước; `src/shared/campaignAccountActions.ts` là bản Desktop (thêm trường V502, `management`, `groupName`).
- **Kiểm thử**: `node scripts/campaign-limit-progress-smoke.cjs` (bộ đọc RPC, so khớp từng trường với bộ đọc cũ trên cùng dữ liệu cho cả akaChat và bộ chạy akaAgent, kết quả hôm nay, quản trị, quay về bộ đọc cũ, ranh giới IPC), `node scripts/campaign-account-actions-smoke.cjs`, `AKA_UI_SMOKE_SHOW=1 ELECTRON_DISABLE_SANDBOX=1 xvfb-run -a node scripts/run-campaign-account-actions-ui-smoke.cjs` (CampaignPanel thật trên Electron: thứ tự cột, ô danh sách ở các trạng thái, một lượt đọc mỗi trang, bấm ô mở tab, thẻ, mở khóa đọc lại cả hai, thiếu V502 cột trống; ảnh 850/1280/1600 px sáng/tối).

## Rollback

`rollback_v502_campaign_limit_progress.sql` xóa cả hai hàm. API WebApp và Desktop coi thiếu hàm là "chưa sẵn sàng": cột trống, tab Hành động dùng bộ đọc cũ. Không có dữ liệu cần dọn.
