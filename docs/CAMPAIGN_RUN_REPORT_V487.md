# V487 — RPC chỉ đọc cho tab "Báo cáo" của chi tiết chiến dịch (Web)

Trạng thái: **ĐÃ apply akachat lúc 08:38:24 VN 10/11/2026** (`20261110013824 / migration_v487_campaign_run_report`), theo đồng ý của người dùng. **Không apply lại**: preflight từ chối khi hàm đã có. md5 sổ migration (`statements[1]`) = md5 file `55e0554a037ccc03496f042f402da018`; md5 `pg_get_functiondef` `69c9d1edc07766dbacffbad56beae73a`, md5 `prosrc` `4bd734ca25612bfdade631c779373d42`. Biên nhận: [`migrations/snapshots/campaign-run-report-v487/apply-receipt.json`](../migrations/snapshots/campaign-run-report-v487/apply-receipt.json). Sau khi apply không sửa file migration (sổ lưu nguyên văn).

**API/Web chưa deploy**, nên chưa caller nào gọi hàm. Desktop không dùng. Phía WebApp (API/Web, hợp đồng, kiểm thử): `aligoinc/akaAgentWebApp` #183 (nhánh `claude/loving-mccarthy-irdevx`, đã merge `dev`), tài liệu `docs/CAMPAIGN_DETAIL_REPORT_TAB.md`.

## Thay đổi

Chỉ thêm **một hàm**:

`public.aka_agent_read_campaign_run_report(p_staff_id bigint, p_organization_id bigint, p_auth_username text, p_auth_password text, p_campaign_id bigint, p_query jsonb) → jsonb`

- Không thêm/sửa bảng, cột, index, policy, hàm cũ, timeout của role, pool hay kết nối.
- `LANGUAGE plpgsql STABLE SECURITY DEFINER`, `search_path = pg_catalog, public`, `statement_timeout = 60s`, chủ sở hữu `postgres`. 60 s như các RPC báo cáo khác (V462, trang Kết quả chạy v2); PostgREST áp thiết lập của hàm cho lượt gọi. Bản viết đầu dùng 20 s, đã nâng **trước khi apply** sau số đo nguội (mục Tải DB).
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
- **Production (10/11/2026, chỉ đọc):** chi phí chính là đọc heap của `auto_campaign_details` (heap 17,8 GB, all-visible ~52%; kết quả của một chiến dịch nằm rải rác, gần một trang mỗi dòng). Lần đầu (nguội) ~0,75–0,79 ms mỗi kết quả:

  | Chiến dịch | Kết quả | Data | Nguội | Nóng |
  |---|---|---|---|---|
  | 17773 | 19.008 | 8.828 | 14,6 s (18.047 trang đọc từ đĩa) | 0,17–0,42 s |
  | 25238 | 11.784 | — | 8,6 s (10.770 trang) | 0,10–0,25 s |
  | 11980 (lớn nhất) | 63.636 | — | ước ~48 s | — |

  Vì vậy trần hàm 60 s, API WebApp hạn 65 s, tối đa 3 lượt khác nhau mỗi tiến trình, không cache kết quả.
- Mẫu sau apply (09:08 VN 10/11/2026): 10 chiến dịch ≤ 1.500 kết quả trên năm loại tài khoản, mỗi lần 4–166 ms, JSON 1,2–5,5 KB; cả lượt 7,6 s gồm cả bước chọn mẫu. Chiến dịch > 1.500 kết quả được bỏ qua để không đọc nặng giữa giờ làm việc.
- Đo giả lập trên Postgres 16 cục bộ (bảng kết quả 2,09 triệu dòng, chiến dịch đích 100.000 kết quả + 30.000 data, dữ liệu nóng, `shared_buffers=128MB`, `work_mem=8MB`): 370–430 ms mỗi lần gọi, JSON trả về ~17 KB.

## Kiểm chứng

**Postgres 16 cục bộ** — script ở WebApp: `AKA_AGENT_REPO=<checkout này> PG_TEST_BINDIR=<bin Postgres 16> sh scripts/test-campaign-run-report-sql.sh` (chạy bằng root thì bọc `runuser -u postgres --`) — 36 kiểm tra đạt (09/11, chạy lại 10/11 với trần 60 s):

- quyền (chỉ `postgres`, `service_role`; anon/authenticated/aka_agent_desktop không EXECUTE; anon bị từ chối thật), thuộc tính hàm;
- số theo trạng thái data, tổng kết quả, nhóm theo hành động/trạng thái/trạng thái phụ, dòng cũ NULL theo chữ, chữ lạ thành `other`, dòng `action_code` NULL, dòng đã xoá không tính, kết quả của data đã xoá vẫn tính;
- dòng thời gian theo giờ/ngày/tuần (23:30 giờ Việt Nam giữ đúng ngày), chiến dịch rỗng giữ nguyên hình dạng;
- kết quả theo data (chính/phụ, thất bại trước bỏ qua, không tồn tại, chờ xác nhận, chưa có kết quả, khác), tương tác loại trừ nhau, danh sách trạng thái được tham chiếu;
- chặn staff khác, chiến dịch đã xoá/không có, staff ngừng hoạt động, sai tổ chức, `p_query` sai kiểu;
- kế hoạch dùng index theo chiến dịch; rollback chỉ xoá hàm, dữ liệu giữ nguyên; apply lại bị chặn; thiếu `idx_campaign_details_page` thì preflight dừng.

**Production (10/11/2026, theo đồng ý của người dùng):**

1. Xác nhận project `cgjbsmqtfhqvttudyjzq` (akachat), sổ migration chưa có V487, hàm chưa tồn tại.
2. Đo chỉ đọc bằng `EXPLAIN (ANALYZE, BUFFERS)` câu chính trên chiến dịch lớn (số ở bảng trên).
3. Chạy thử nguyên thân migration trong một transaction rồi huỷ bằng `RAISE EXCEPTION` (NOTIFY nạp lại schema chỉ gửi khi commit). Lần đầu dừng ở `57014` (55 s) khi đọc nguội liên tiếp các chiến dịch lớn nhất, nên nâng trần 20 s → 60 s. Lần hai đạt: với 17773 và 25238, tổng kết quả = tổng của `aka_agent_list_campaign_details_page_v2` = Σ nhóm = Σ dòng thời gian; số data = `input_total` của `aka_agent_control_campaign_progress` = Σ kết quả theo data; hoàn thành/lỗi = `input_completed`/`input_failed`.
4. Apply bằng `apply_migration` (nội dung file nguyên văn). Hậu kiểm: chủ `postgres`, SECURITY DEFINER, STABLE, config `search_path=pg_catalog, public` + `statement_timeout=60s`; EXECUTE chỉ `postgres` và `service_role` (anon/authenticated/aka_agent_desktop không). Smoke dưới `service_role` (25238) đạt.
5. PostgREST nạp lại schema 01:38:24 → 01:38:37 UTC (câu introspection 11,8 s). Phút đó latency trung bình 132,6 ms so với nền 46–57 ms, 0 lỗi 503. Một lỗi 500 cùng phút là `aka_agent_list_contact_datasets` của Desktop hết 3 s — lỗi có sẵn (22/~91 lượt trong 24 giờ), không liên quan V487.
6. Sau apply: mẫu 10 chiến dịch (Facebook 3, SMS 3, Zalo QR 1, Zalo Web 3, Zalo Server 1) đạt mọi bất biến ở bước 3, 0 giá trị lạ, mọi `statusId`/`subStatusId` có trong `statuses`. JSON thật của 51342 (Facebook đăng nhóm) và 52066 (Zalo nhắn theo SĐT có Tìm SĐT/Gắn tag/Đổi tên) qua `parseCampaignRunReportRpc` + `buildCampaignRunReport` của API WebApp: không lỗi, tổng khớp ở mọi khối.

## Còn lại

- Deploy API/Web (cần người dùng đồng ý). API trả 503 "đang được cập nhật" khi DB thiếu hàm, nên thứ tự lệch không làm hỏng trang.
- Theo dõi tương tác Zalo đang tắt từ 06/10/2026 (`zalo.campaign_engagement.enabled=false`), nên `engagement.messageTracked`/`friendTracked` của lượt gửi sau ngày đó bằng 0 và Web ẩn khối Tương tác Zalo.

**Gỡ bỏ:** `migrations/rollback_v487_campaign_run_report.sql` chỉ `DROP FUNCTION` hàm mới (md5 file `6e08c744fa393d4c723df3c2e8f9ea74`); không có dữ liệu cần dọn. DROP là DDL nên PostgREST nạp lại schema: chạy ngoài giờ cao điểm.
