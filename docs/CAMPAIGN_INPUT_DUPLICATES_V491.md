# Lọc trùng SĐT khi tải dữ liệu — V491

**V491 đã apply akachat lúc 22:08:01 VN ngày 10/11/2026** (`20261110150801 / migration_v491_campaign_input_duplicates`; md5 sổ = md5 tệp `26f5b154…`; **không apply lại**). Công tắc `web.campaign_input_duplicates`: V491 đặt `admin_akabiz`, **đổi sang `all` lúc 22:28:25 VN 10/11/2026 theo yêu cầu, trước khi deploy API/Web** (bản API đang chạy chưa đọc khóa này nên chưa ai thấy; deploy xong mọi khách thấy ngay sau khi tải lại trang, không qua bước admin akaBiz thử trước). API/Web: akaAgentWebApp #196 đã merge `dev`, **chưa deploy**. SQL và tài liệu này đã merge `dev_3` (#633). **Desktop: code đã merge `dev_3` (#634, chưa phát hành), V493 (GRANT cho `aka_agent_desktop`) đã apply 23:40:04 VN 10/11** — xem [CAMPAIGN_INPUT_DUPLICATES_DESKTOP_V493.md](CAMPAIGN_INPUT_DUPLICATES_DESKTOP_V493.md). [Biên nhận](../migrations/snapshots/campaign-input-duplicates-v491/apply-receipt.json).

## Tính năng

Cửa sổ "Upload dữ liệu" (5 nguồn: Form txt/dán, Ảnh, Link sheet, Template akaBiz, Excel/CSV) có khung **Lọc trùng dữ liệu**:

1. **Chỉ trong file này** (mặc định) — như trước V491.
2. **Với tài khoản đang chọn** — form tạo/nhân bản: mọi tài khoản đã tick; "Thêm data": tài khoản của chiến dịch.
3. **Với các tài khoản Zalo bạn chọn** — khách tự chọn danh sách; chỉ gồm tài khoản Zalo của **chính nhân viên trong tổ chức hiện tại** (API và hàm kiểm lại, một tài khoản lạ là từ chối cả lượt).

Lựa chọn 2/3 có số ngày (7/14/30/90 hoặc 1–365, mặc định 30). Kiểm tra xong: nhóm kết quả thứ tư "Đã có ở chiến dịch khác" (chiến dịch gần nhất, tài khoản, ngày tải lên, trạng thái, xuất Excel), rồi **hộp xác nhận lần cuối** trước khi chèn. Đợt 1 chỉ loại `zalo_message_phone`.

Khác "Kiểm tra trùng lặp" ở Cài đặt chạy (V424/V431): cái cũ xét lịch sử **đã gửi** lúc chiến dịch chạy; V491 xét dữ liệu **đã tải lên** lúc nhập, khách xem và xác nhận. Hai cái bổ sung nhau.

## Hàm

`public.aka_agent_read_campaign_input_duplicates(p_staff_id, p_organization_id, p_auth_username, p_auth_password, p_query jsonb) → jsonb`
— STABLE, SECURITY DEFINER, `statement_timeout 20s`, EXECUTE chỉ `service_role` (Web gọi qua backend singleton, thông tin đăng nhập NULL như V462/V487). Không ghi, không bảng/index/trigger mới.

`p_query`: `actionId` (chỉ `zalo_message_phone`), `accountIds` (1–500), `days` (1–365), `phones` (≤ 2.000; chuẩn hóa bằng `aka_agent_internal_normalize_phone`, số sai bỏ qua), `excludeCampaignId` (tùy chọn).
Kết quả: `checkedAt`, `since` (00:00 giờ VN của ngày đầu khoảng), `days`, `accountCount`, `phoneCount`, `items[]` = mỗi số đã có: `phone`, `matchCount`, `campaignCount`, `latest {campaignId, campaignName, campaignDeleted, accountId, accountName, uploadedAt, status, processed}`.

Quy tắc đối chiếu:
- Dòng dữ liệu chiến dịch (`auto_campaign_input_data`) có `created_at` trong N ngày lịch Việt Nam tính cả hôm nay, `is_delete` không true, mọi trạng thái, mọi nguồn vào (file, chọn bạn bè, nhóm data…).
- Chiến dịch cùng loại (`action_id`), cùng nhân viên/tổ chức, tài khoản chính thuộc danh sách; bỏ chiến dịch `provisioning_state='staged'`; bỏ `excludeCampaignId`.
- Chiến dịch đã xóa: chỉ tính dòng đã chạy (`status='hoàn thành'` hoặc có `date_action`).
- So sau `normalize_phone` (84/+84/0084, đầu số 11 số cũ).

Hiệu năng: chỉ đọc ứng viên qua `idx_campaign_input_cooldown_phone` (md5 SĐT chuẩn hóa, 28/10) bằng `md5(normalize_phone(phone)) = ANY(mảng)` trong CTE MATERIALIZED, rồi lọc/nối chiến dịch. Đo 10/11: viết kiểu nối bảng thường thì planner quét ~2 triệu dòng qua index khác và gọi `normalize_phone` từng dòng (hủy ở 55 s); kiểu mảng md5: 10.000 số của nhân viên nhiều dữ liệu nhất ~4,7 s khi nguội, 2.000 số sau apply 1,3 s. Web chia lượt 2.000 số, tuần tự. Sửa câu truy vấn thì chạy lại kiểm tra kế hoạch (auto_explain) trong bộ test.

## Số liệu dẫn tới tính năng (30 ngày tới 10/11/2026, `zalo_message_phone`)

3,28 triệu dòng SĐT; 633 nghìn (19,3%) trùng lần tải trước của cùng nhân viên ở chiến dịch khác (113 nghìn do một lần lưu nhiều tài khoản cùng danh sách; 511 nghìn tải riêng, 73% cách nhau < 7 ngày, 90% < 14 ngày); trong cùng một tài khoản 5,1%. 27% dòng thuộc chiến dịch đã xóa, 86% số đó chưa chạy.

## Kiểm thử

- SQL cục bộ PostgreSQL 16 (ở akaAgentWebApp): `AKA_AGENT_REPO=<akaAgent> PG_TEST_BINDIR=<pg16>/bin sh scripts/test-campaign-input-duplicates-sql.sh` — 46 khẳng định (phạm vi, ngày VN, chiến dịch/dòng đã xóa, staged, loại khác, nhân viên/tổ chức khác, tài khoản SMS/lạ, chuẩn hóa, giới hạn, quyền anon/authenticated/desktop, không ghi), kiểm tra kế hoạch bằng auto_explain (8/8 dùng index SĐT, cả kế hoạch generic), áp lại bị từ chối, rollback rồi áp lại, thiếu index bị từ chối. Chạy bằng user không phải root (initdb).
- Sau apply trên production: gọi thật bằng `service_role` (2.000 số, 76 tài khoản, 1,3 s), tài khoản nhân viên khác → 42501, loại khác → 22023; edge_logs phút apply 0 lỗi 5xx/503.

## Triển khai và gỡ

Thứ tự: DB (đã xong) → công tắc `all` (đã đổi 22:28:25 VN 10/11 theo yêu cầu, bằng `UPDATE auto_system_settings SET value = '{"audience":"all","defaultDays":30,"maxDays":365}', updated_at = now() WHERE key = 'web.campaign_input_duplicates' AND value = '<giá trị cũ>'`, không trigger nào của bảng xử lý khóa này) → merge `dev` (WebApp #196, xong) → deploy API/Web (còn lại) → theo dõi lượt gọi đầu tiên.
Gỡ nhanh không DDL: đặt `audience` = `off` (Web ẩn lựa chọn 2/3). Gỡ hẳn: [rollback](../migrations/rollback_v491_campaign_input_duplicates.sql) (xóa hàm + dòng công tắc; không đụng dữ liệu).

## Desktop

Đã làm theo đúng hướng: `src/shared/campaignInputDuplicates.ts` chép nguyên văn akaAgentWebApp `packages/control-api/src/campaignInputDuplicates.ts`; IPC `campaign:input-duplicates` gọi cùng hàm bằng token Desktop; V493 chỉ `GRANT EXECUTE … TO aka_agent_desktop` (như V489, đã apply 23:40:04 VN 10/11); khung lọc trùng, hộp chọn tài khoản, hộp xác nhận và ghi chú form port vào `CampaignDataUploadModal`/form Desktop. Hợp đồng, kiểm thử, gỡ: [CAMPAIGN_INPUT_DUPLICATES_DESKTOP_V493.md](CAMPAIGN_INPUT_DUPLICATES_DESKTOP_V493.md).
