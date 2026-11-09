# V487 — RPC chỉ đọc cho tab "Báo cáo" của chi tiết chiến dịch (Web)

Trạng thái: **viết xong, CHƯA apply** trên akachat. Chỉ apply khi người dùng đồng ý rõ ràng cho bước này. Số V487 là số kế tiếp sau V486 trên `dev_3` lúc viết (09/11/2026); V481/V482 đã apply từ nhánh khác. Trước khi apply, kiểm lại sổ migration production để chắc số chưa bị dùng.

Phía WebApp (API/Web, hợp đồng, kiểm thử): nhánh `claude/loving-mccarthy-irdevx` của `aligoinc/akaAgentWebApp`, tài liệu `docs/CAMPAIGN_DETAIL_REPORT_TAB.md`.

## Thay đổi

Chỉ thêm **một hàm**:

`public.aka_agent_read_campaign_run_report(p_staff_id bigint, p_organization_id bigint, p_auth_username text, p_auth_password text, p_campaign_id bigint, p_query jsonb) → jsonb`

- Không thêm/sửa bảng, cột, index, policy, hàm cũ, timeout của role, pool hay kết nối.
- `LANGUAGE plpgsql STABLE SECURITY DEFINER`, `search_path = pg_catalog, public`, `statement_timeout = 20s`, chủ sở hữu `postgres`.
- Quyền: thu hồi trực tiếp `PUBLIC, anon, authenticated` (default ACL của `public` cấp riêng cho hai role này), chỉ `GRANT EXECUTE` cho `service_role`. Desktop chưa dùng nên chưa cấp `aka_agent_desktop`.
- Gọi `public.auto_assert_automation_identity` như V462, kiểm tra staff còn hoạt động, rồi chiến dịch `id = p_campaign_id AND staff_id AND organization_id AND is_delete = false`; không có thì lỗi `campaign_report_not_found` (SQLSTATE `P0002`).
- `p_query` (đều tùy chọn; API WebApp gửi đủ): `legacy` (`success`/`skipped`/`failure`: danh sách chữ trạng thái cũ khi `report_group` NULL, giống V462), `auxiliaryActionCodes` (≤ 50: Tìm SĐT, Gắn tag, Đổi tên), `notFoundStatuses`/`notFoundStatusCodes` (≤ 20). Sai kiểu → `invalid_report_query` (`22023`).

## Kết quả trả về

| Khóa | Nội dung |
|---|---|
| `dbNow` | Giờ DB lúc đọc |
| `campaign` | `id`, `status`, `createdAt` |
| `inputs` | `[{status, count}]` theo `auto_campaign_input_data.status`, điều kiện `campaign_id AND is_delete = false` — **đúng** điều kiện của `aka_agent_control_campaign_progress` và tab Data ban đầu |
| `results` | `total`, `firstAt`, `lastAt` và `groups: [{actionCode, actionName, statusId, legacyStatus, subStatusId, group, count, sampleStatus}]`, điều kiện `campaign_id AND is_delete = false` — **đúng** tổng của `aka_agent_list_campaign_details_page_v2` (tab Kết quả chạy), kể cả dòng `action_code` NULL và dòng của data đã xoá |
| `timeline` | `unit` (`hour` khi lượt đầu–cuối ≤ 48 giờ, `day` ≤ 180 ngày, còn lại `week` bắt đầu thứ Hai) và `points: [{at, group, count}]`, giờ Việt Nam |
| `inputOutcomes` | `[{status, outcome, notFound, count}]`: mỗi data một kết quả. Hành động chính quyết định, hành động phụ chỉ xét khi data chưa có lượt chính; thứ tự `success` → `failure` → `skipped` → `pending` → `none` (không có lượt) → `other` |
| `engagement` | Lượt thành công của nhắn tin bạn bè/người lạ và kết bạn Zalo: số theo dõi, đã xem/cảm xúc/phản hồi (loại trừ nhau như V462), đồng ý kết bạn |
| `statuses` | `[{id, code, name, statusValue}]` của các `status_id`/`sub_status_id` có trong kết quả |

Nhóm của một lượt: `report_group` đã lưu; NULL thì ánh xạ chữ theo `legacy`; còn lại `other`.

## Tải DB

- Mọi câu lọc theo `campaign_id`: `idx_campaign_input_data_progress_live (campaign_id, status) WHERE is_delete = false` (index-only) và `idx_campaign_details_page (campaign_id, created_at, id) WHERE is_delete = false`. Preflight dừng nếu thiếu hai index này.
- Kết quả của chiến dịch được đọc **một lần** (CTE `MATERIALIZED`) rồi gom bốn kiểu trong cùng một câu.
- Đo giả lập trên Postgres 16 cục bộ (bảng kết quả 2,09 triệu dòng, chiến dịch đích 100.000 kết quả + 30.000 data, dữ liệu nóng, `shared_buffers=128MB`, `work_mem=8MB`): **370–430 ms mỗi lần gọi**, JSON trả về ~17 KB. Chưa đo trên production; khi dữ liệu nguội, lượt đọc heap rải rác sẽ chậm hơn. Đây không phải số đo production.

## Kiểm chứng (09/11/2026, Postgres 16 cục bộ)

Script ở WebApp: `AKA_AGENT_REPO=<checkout này> PG_TEST_BINDIR=<bin Postgres 16> sh scripts/test-campaign-run-report-sql.sh` — 36 kiểm tra đạt:

- quyền (chỉ `postgres`, `service_role`; anon/authenticated/aka_agent_desktop không EXECUTE; anon bị từ chối thật), thuộc tính hàm;
- số theo trạng thái data, tổng kết quả, nhóm theo hành động/trạng thái/trạng thái phụ, dòng cũ NULL theo chữ, chữ lạ thành `other`, dòng `action_code` NULL, dòng đã xoá không tính, kết quả của data đã xoá vẫn tính;
- dòng thời gian theo giờ/ngày/tuần (23:30 giờ Việt Nam giữ đúng ngày), chiến dịch rỗng giữ nguyên hình dạng;
- kết quả theo data (chính/phụ, thất bại trước bỏ qua, không tồn tại, chờ xác nhận, chưa có kết quả, khác), tương tác loại trừ nhau, danh sách trạng thái được tham chiếu;
- chặn staff khác, chiến dịch đã xoá/không có, staff ngừng hoạt động, sai tổ chức, `p_query` sai kiểu;
- kế hoạch dùng index theo chiến dịch; rollback chỉ xoá hàm, dữ liệu giữ nguyên; apply lại bị chặn; thiếu `idx_campaign_details_page` thì preflight dừng.

## Apply (chưa làm — cần người dùng đồng ý)

1. Kiểm số V487 chưa có trong sổ migration production; đối chiếu md5 file (`0fdd57f9259fcf3d79effec0dbeb31eb`).
2. Chạy thử trong transaction rồi `ROLLBACK`, đo vài chiến dịch lớn nhất (đọc, `statement_timeout` 20 s).
3. Apply nguyên file, ghi sổ migration, kiểm ACL hậu kiểm (`postgres`, `service_role`).
4. Deploy API/Web. API trả 503 "đang được cập nhật" khi chưa có hàm, nên thứ tự lệch không làm hỏng trang.

**Gỡ bỏ:** `migrations/rollback_v487_campaign_run_report.sql` chỉ `DROP FUNCTION` hàm mới; không có dữ liệu cần dọn.
