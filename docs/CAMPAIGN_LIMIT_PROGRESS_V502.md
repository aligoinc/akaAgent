# V502: hàm đọc tiến độ giới hạn cho danh sách chiến dịch Web và tab "Hành động"

Ngày 12/11/2026. **CHƯA apply lên akachat.** Code Web/API ở akaAgentWebApp nhánh `claude/fervent-gates-c8ldgw` (chưa deploy); Web/API chạy được khi DB chưa có hàm (cột "Giới hạn lượt" để trống, tab Hành động dùng bộ đọc cũ).

- Migration: [migration_v502_campaign_limit_progress.sql](../migrations/migration_v502_campaign_limit_progress.sql)
- Rollback: [rollback_v502_campaign_limit_progress.sql](../migrations/rollback_v502_campaign_limit_progress.sql) (chỉ `DROP FUNCTION`)
- Kiểm thử cục bộ: `bash scripts/test-v502-campaign-limit-progress.sh` (PostgreSQL 16, 50 kiểm tra)
- Hợp đồng giao diện/API: akaAgentWebApp `docs/CAMPAIGN_LIST_LIMIT_PROGRESS.md`

## Nội dung

Chỉ thêm một hàm, không đổi bảng/cột/index/policy/hàm cũ/timeout của role:

```
public.aka_agent_control_campaign_limit_progress(
  p_staff_id bigint, p_organization_id bigint, p_campaign_ids bigint[],
  p_chat_product_ids bigint[] DEFAULT '{}', p_extra_keys text[] DEFAULT '{}', p_detail boolean DEFAULT false
) RETURNS jsonb   -- STABLE, SECURITY INVOKER, statement_timeout 8s, EXECUTE chỉ service_role
```

Hàm trả **số liệu thô**, không quyết định thay bộ chạy:

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

Giới hạn hiệu lực (nhóm → chiến dịch → mặc định → trần gói) và cách đếm theo bộ chạy tính ở API WebApp (`campaignPendingLimits.ts`), cùng code với "Tại sao CD không chạy?" và Chẩn đoán.

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

## Rollback

`rollback_v502_campaign_limit_progress.sql` xóa hàm. API WebApp coi thiếu hàm là "chưa sẵn sàng": cột trống, tab Hành động dùng bộ đọc cũ. Không có dữ liệu cần dọn.
