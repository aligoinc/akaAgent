# V524: nạp danh mục tương tác Zalo theo chỉ mục có thứ tự

Trạng thái 13/11/2026: **V524 đã apply akachat lúc 22:24:09 VN** (`20261113152357 / migration_v524_zalo_engagement_catalog_ordered_walk`; không apply lại; md5 sổ = file `1fbbdab8…`; [biên nhận](../migrations/snapshots/zalo-engagement-v524/apply-receipt.json)), không cần phát hành Desktop/App Server/Chat. Nhánh `perf/engagement-catalog-ordered-scan`. Nền: [V510](ZALO_CAMPAIGN_ENGAGEMENT_V510.md). Bản này đầu tiên mang số V522; trước khi apply đổi thành V524 vì nhánh `claude_dong-bo-trang-thai-tin-nhan-zalo_from_dev_3_13_11` đã đẩy `migration_v522_*` lúc 21:50:56 VN (sớm hơn 6 phút) và giữ cả V523. Số đo bên dưới đo khi còn tên V522; câu SELECT không đổi.

## Vấn đề

Nhánh `catalog` của `aka_agent_campaign_engagement_batch` (gọi qua `aka_agent_read_campaign_engagement` với `[{"catalog":{from,until,id}}]`) trả danh mục lượt theo dõi còn hạn của một (tổ chức, nhân viên), mỗi trang 500 dòng theo `(tracking_until, campaign_detail_id)`. Ai gọi:

- Worker Fly của akaAgentChatApi (`CampaignEngagementRepository.warmCatalog`) mỗi lần khởi động/đổi revision. PR ChatApi `perf/engagement-watch-capacity` cho worker nạp hết danh mục, nên khi mọi tài khoản Server lên Fly (từ 14/11) **mỗi lần deploy worker = quét đủ danh mục của mọi chủ**.
- Desktop 9.x (`zaloCampaignEngagement.ts`, một trang mỗi lượt rảnh) và App Server VPS lúc đăng nhập.

Thân V510 JOIN `auto_campaign_details`/`auto_campaigns`/`auto_accounts`/`zalo_accounts` cho **mọi** lượt còn lại của chủ rồi mới `ORDER BY … LIMIT 500`; kế hoạch (custom lẫn generic) đi `auto_campaign_engagement_deadline` theo từng tài khoản rồi Sort. Chi phí một trang tỉ lệ với số lượt còn lại ⇒ quét đủ một chủ N lượt tốn O(N²/500). Staff 1988 (8.353 lượt): trang đầu 6,0 s khi nguội (10.669 trang `auto_campaign_details`), 210 ms khi nóng.

## Thay đổi

[Migration](../migrations/migration_v524_zalo_engagement_catalog_ordered_walk.sql) chỉ thay câu SELECT của nhánh catalog (mọi byte khác của thân hàm giữ nguyên như V510; giữ chữ ký, owner, SECURITY DEFINER, VOLATILE, `search_path`, `statement_timeout=15s`, ACL):

- Đi `auto_campaign_engagement_catalog (organization_id, staff_id, tracking_until, campaign_detail_id)` theo đúng thứ tự con trỏ với điều kiện hàng `(tracking_until, campaign_detail_id) > (until, id)`; `LIMIT 500` dừng khi đủ 500 dòng hợp lệ.
- Mỗi dòng kiểm sở hữu bằng `CROSS JOIN LATERAL (… WHERE id = … LIMIT 1)` theo khóa chính như nhánh đăng ký của V510: kết quả gửi chưa xóa → chiến dịch đúng nhân viên/tổ chức chưa xóa → tài khoản đúng nhân viên/tổ chức, chưa xóa, không phải Zalo web, UID hiện tại (`chat_zalo_account` của binding đang bật, không có thì `zalo_accounts`) bằng `account_zalo_uid`. Điều kiện UID nằm **trong** LATERAL: planner coi mỗi LATERAL `LIMIT 1` là một dòng nên ước tính số dòng ra = số lượt của chủ và giữ đường đi chỉ mục có thứ tự; để ở WHERE ngoài như V510 thì planner ước tính ~1/1.500 dòng qua được và chọn đọc hết rồi Sort.
- Cùng tập dòng, thứ tự, `catalogCursor`, `catalogDone` như V510: mọi khóa được tra đều là khóa chính (`auto_campaign_details`, `auto_campaigns`, `auto_accounts`, `zalo_accounts`; preflight kiểm), dòng bị loại vẫn bị loại, con trỏ vẫn là dòng trả về cuối cùng.
- Preflight: sổ chưa có `migration_v524_%`, `md5(prosrc)` = thân V510 `dd6cf2bd…`, thuộc tính hàm như V510, chỉ mục catalog đúng 4 cột, 4 khóa `id` duy nhất. Postflight: `md5(prosrc)=167571de84782301ddd8bcd1ad3b2f89` + thuộc tính.
- Đánh đổi: dòng của tài khoản đã xóa/đổi UID nay được đọc (một lần mỗi lượt quét) trước khi bị loại; V510 bỏ qua chúng nhờ đi theo tài khoản hợp lệ. Production 13/11: 0 lượt còn hạn trên tài khoản không hợp lệ, 946/88.286 lượt có UID đã đổi (811 của staff 1576).

## Kiểm thử (PostgreSQL 17 riêng, `LC_ALL=C`)

`node scripts/run-zalo-engagement-v524-smoke.cjs` (~30 s), đạt 13/11/2026:

- V339 → V341 → V510 (md5 = production) → V524 → chạy lại bị từ chối → [rollback](../migrations/rollback_v524_zalo_engagement_catalog_ordered_walk.sql) về đúng V510 (`dd6cf2bd…` / `pg_get_functiondef` `6b40a8b7…`) → rollback lần hai bị từ chối → V524; mọi byte ngoài câu SELECT catalog giống V510.
- Kiểm thử cũ vẫn đạt: `assertions.sql` (gồm 2 trang catalog, chặn sai chủ/UID cũ) và `scale_v510.sql` (đăng ký/sự kiện/quét nguồn ≤ 50 dòng mỗi lượt gọi).
- Tương đương ([catalog_v524_equivalence.sql](../scripts/fixtures/zalo-engagement/catalog_v524_equivalence.sql)): thân V510 (đổi tên) và V524 chạy trong cùng giao dịch, mỗi bên tự đi theo con trỏ của mình, so JSON từng trang. Dữ liệu 3 seed: 3.200 lượt với 40 mốc `tracking_until` trùng nhau (có micro giây), xen đủ 14 kiểu bị loại (kết quả xóa/`is_delete` NULL/không chiến dịch; chiến dịch xóa/khác nhân viên/khác tổ chức/NULL; tài khoản xóa/Zalo web/không UID/khác nhân viên/NULL/khác tổ chức; UID cũ), binding bật/tắt/thiếu hồ sơ; 6 con trỏ đầu (`{}`, `from` sớm/muộn, `null`, chỉ `until`); chủ khác cùng tổ chức; chủ có đúng 1.000, 0 và 500 dòng hợp lệ (trang cuối rỗng); 920 con trỏ đơn lẻ (giữa nhóm trùng, trên dòng bị loại, id/mốc không có, cả hai kiểu chuỗi thời gian). Kết quả: 21 lượt quét, 46 trang, 15.006 dòng, 23 nhóm trùng vắt qua ranh giới trang — **giống từng byte**; số dòng khớp oracle viết độc lập.
- Đo ([catalog_v524_scale.sql](../scripts/fixtures/zalo-engagement/catalog_v524_scale.sql) + [catalog_v524_measure.sql](../scripts/fixtures/zalo-engagement/catalog_v524_measure.sql)): 600 chủ, 174 nghìn lượt (production 166–171 nghìn), 348 nghìn kết quả gửi; một chủ 38.554 lượt, 33.734 còn hạn, 30.290 hợp lệ (61 trang); `VACUUM ANALYZE`, chi phí planner như production. Dữ liệu nóng:

| Quét đủ một chủ (61 trang) | V510 | V524 |
|---|---:|---:|
| Qua hàm thật: thời gian | 3.135 ms | 294 ms |
| Qua hàm thật: dòng tương tác / kết quả gửi / chiến dịch đọc | 1.003.649 / 992.585 / 983.843 | 33.734 / 33.734 / 1.220 |
| Trang đầu: dòng tương tác / kết quả gửi đọc | 32.254 / 32.254 | 564 / 564 |
| EXPLAIN custom: buffer cả lượt / trang đầu | 7.362.629 / 231.903 | 146.342 / 2.403 |
| EXPLAIN generic (`PREPARE` + `force_generic_plan`): buffer cả lượt / trang đầu | 8.509.116 / 275.810 | 370.732 / 6.170 |
| Trang có Sort / chỉ mục bảng tương tác | 61/61, deadline | 0/61, catalog |

Buffer từng trang (generic): V510 275.810 → 234.998 (trang 10) → 144.040 (30) → 7.814 (60); V524 ~6.100 mọi trang; trang cuối (290 dòng) 3.168 so với 3.545.

## Production (chỉ đọc, 13/11/2026 21:50–22:15 VN)

Mọi lệnh trong `BEGIN READ ONLY … ROLLBACK` qua `supabase db query --linked`; câu đo sinh bằng `node scripts/zalo-engagement-v524-catalog-explain.cjs <staff> <org> [v510]`. Biên nhận: [production-explain-20261113.json](../migrations/snapshots/zalo-engagement-v524/production-explain-20261113.json). Hàm đang là V510 (`dd6cf2bd…`/`6b40a8b7…`), sổ tới V521, khối preflight V524 chạy riêng: đạt.

Staff 1988 / tổ chức 1765 (8.353 lượt còn hạn, 7.814 hợp lệ, 16 trang), trang đã nóng:

| | V510 (generic, cùng con trỏ) | V524 custom | V524 generic |
|---|---:|---:|---:|
| Quét đủ: thời gian | 777 ms | 220 ms | 215 ms |
| Quét đủ: buffer | 730.339 | 100.014 | 106.560 |
| Quét đủ: dòng tương tác đọc | 71.480 | 8.353 | 8.353 |
| Trang đầu | 116 ms, 85.803 buffer | 17,5 ms, 2.872 | 13,9 ms, 6.864 |
| Trang có Sort / chỉ mục | 16/16, deadline | 0, catalog | 0, catalog |

Lần đầu còn nguội (22:11): V524 trang đầu 97,8 ms (206 trang đọc đĩa), cả lượt 1,68 s (3.945 trang) — V510 tốn 6,0 s chỉ cho trang đầu. Ba chủ khác (2061: 1.953 lượt; 385: 62 tài khoản; 1576: 811 lượt UID cũ, trang đầu đọc 1.311 lượt để có 500 hợp lệ): 0 trang Sort, chỉ chỉ mục catalog, mỗi lượt đọc đúng một lần, generic 30–56 ms cả lượt.

## Apply (đã làm 22:24:09–22:24:11 VN 13/11/2026, anh bảo "apply đi")

Cách làm (đã dùng): `node scripts/make-migration-ledger-apply.cjs migrations/migration_v524_zalo_engagement_catalog_ordered_walk.sql migration_v524_zalo_engagement_catalog_ordered_walk <file ra>` rồi `supabase db query --linked -f <file ra>` (migration + dòng sổ cùng một giao dịch, `lock_timeout` 3 s). [Biên nhận](../migrations/snapshots/zalo-engagement-v524/apply-receipt.json).

- Trước: thân V510 (`dd6cf2bd…`), sổ tới `20261113152307 / migration_v522_data_group_member_matches_desktop`, 3 backend đang chạy, 0 khoá chờ; REST 10 phút trước p50 44–45 ms, p99 111–123 ms, 0 lỗi 5xx.
- Hậu kiểm đạt: sổ `20261113152357 / migration_v524_zalo_engagement_catalog_ordered_walk`, `md5(statements[1])` = md5 file `1fbbdab87987b2137cec5d2d67ff11b1`; `md5(prosrc)=167571de84782301ddd8bcd1ad3b2f89` (`pg_get_functiondef` `e5b4431626d8d205b1883b2b92545253`); owner/SECURITY DEFINER/cấu hình/ACL và thân + quyền 3 hàm bọc như cũ; công tắc vẫn bật.
- REST: khung 10 s lúc 22:24:10 p99 536 ms, chậm nhất 960 ms (PostgREST nạp lại schema), 0 request quá 1 s, 0 lỗi 5xx/503.
- Hàm thật (giao dịch chỉ đọc, claim service_role) đi hết 16 trang của staff 1988 từ `{}`: `items`, `catalogCursor`, `catalogDone` giống câu V510 ở mọi trang; 7.814 lượt, 233 ms cả lượt, trang chậm nhất 19 ms. `scripts/zalo-engagement-v524-catalog-explain.cjs 1988 1765` sau apply: 0 trang Sort, chỉ mục catalog, custom 100.016 / generic 106.562 buffer cả lượt.
- Còn theo dõi: chưa có lượt gọi tự nhiên của nhánh catalog ngay sau apply (chỉ chạy khi worker ChatApi khởi động/đổi revision hoặc Desktop đăng nhập) ⇒ xem `pg_stat_statements` của `aka_agent_read_campaign_engagement` và câu `WITH owner AS …` của worker sau lần deploy worker kế tiếp.

## Rollback

`supabase db query --linked -f migrations/rollback_v524_zalo_engagement_catalog_ordered_walk.sql`: chỉ chạy khi hàm đang là thân V524, trả đúng thân V510 (postflight kiểm `dd6cf2bd…` và `6b40a8b7…`), cũng là DDL (nạp lại schema). Dòng sổ V524 vẫn ở lại nên preflight sẽ chặn apply lại cùng số.
