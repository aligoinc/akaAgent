# V510: tối ưu hàm tương tác Zalo trước khi bật lại

Trạng thái 12/11/2026: **V510 đã apply akachat lúc 17:46:02 VN** (`20261112104557 / migration_v510_zalo_engagement_id_driven_lookups`; không apply lại; md5 sổ migration = file `c8188111…`; [biên nhận](../migrations/snapshots/zalo-engagement-v510/apply-receipt.json)). **Công tắc `zalo.campaign_engagement.enabled` bật lại lúc 18:02:06 VN 12/11/2026** (revision `2026-11-12 11:02:06.56172+00`); App Server trên VPS khởi động lại ~18:06 và đã tham gia (bước 3); còn theo dõi qua cao điểm (bước 4). Nền: [Kiểm tra 12/11/2026](ZALO_CAMPAIGN_ENGAGEMENT.md#kiểm-tra-12112026).

## Vấn đề

Ba hàm `aka_agent_register/record/read_campaign_engagement` cùng gọi `aka_agent_campaign_engagement_batch`. Cột `organization_id`, `staff_id`, `account_id` tương quan với nhau (tài khoản thuộc một nhân viên, nhân viên thuộc một tổ chức), nên planner ước tính "các dòng của một nhân viên" chỉ ~1 dòng và chọn đi từ phía nhân viên:

- **Đăng ký** (CTE `sources`): đi từ mọi chiến dịch của nhân viên rồi đọc mọi kết quả gửi Zalo thành công của từng chiến dịch, cuối cùng mới so với vài `detailId` cần đăng ký. Đo trên production (chỉ đọc): staff 1988, 36 chiến dịch, ~68 nghìn kết quả: **19,5 s, 346.587 buffer** (20.801 đọc đĩa) cho một lượt, vượt trần 15 s của hàm. Bước đối chiếu sự kiện Chat (`matches`) và câu trả kết quả cuối quét mọi dòng tương tác của (tổ chức, nhân viên).
- **Ghi sự kiện / tra theo dõi**: quét mọi lượt theo dõi còn hạn của nhân viên (index catalog) hoặc của tài khoản (index deadline) thay vì tra đúng người nhận.
- **Quét nguồn còn treo lúc đăng nhập**: lặp qua mọi chiến dịch của nhân viên (staff 1190 có 8.859 chiến dịch).

Chi phí tăng theo lịch sử gửi, nên tháng 10 đã thấy hàm đăng ký chậm dần (p95 VPS 0,4 s → 1,2 s trong 3 ngày) và bây giờ còn nặng hơn.

## Thay đổi

[Migration](../migrations/migration_v510_zalo_engagement_id_driven_lookups.sql) chỉ thay thân `aka_agent_campaign_engagement_batch` (giữ chữ ký, owner, SECURITY DEFINER, VOLATILE, `search_path`, `statement_timeout=15s`, ACL; preflight đòi đúng thân V341 `2bacb504…`, postflight kiểm `md5(prosrc)=dd6cf2bd…`):

- Nhánh đăng ký: lấy mảng `detailId` một lần, mọi tra cứu dùng `CROSS JOIN LATERAL (… WHERE id = … LIMIT 1)` theo khóa chính (kết quả, chiến dịch, tài khoản, `zalo_accounts`, dòng tương tác); `LIMIT 1` ngăn planner gộp lại thành join đi từ phía nhân viên. Đối chiếu sự kiện Chat dùng `chat_runtime_engagement_reconcile` với đủ cột.
- Nhánh ghi sự kiện/tra theo dõi: mỗi sự kiện một lần tra `LATERAL … OFFSET 0`.
- Quét nguồn còn treo: đi theo partial index `auto_campaign_engagement_source` (chỉ chứa dấu pending) và kiểm chủ sở hữu từng dòng.
- Thêm `CREATE STATISTICS auto_campaign_engagement_owner_stats (dependencies) ON organization_id, staff_id, account_id, account_zalo_uid` cho bảng tương tác và `ANALYZE` (bảng nhỏ, dưới 1 giây). Thiếu thống kê này, câu tra sự kiện vẫn chọn index catalog/deadline dù đã viết lại.
- Nhánh nạp danh mục lúc khởi động và tra theo operation giữ nguyên (đã tra theo khoảng `tracking_until` và theo index operation).

Không đổi bảng/index/quyền/công tắc, không cần phát hành Desktop/App Server/Chat. [Rollback](../migrations/rollback_v510_zalo_engagement_id_driven_lookups.sql) trả đúng thân V341 và bỏ thống kê.

## Kiểm chứng

`node scripts/run-zalo-engagement-v510-smoke.cjs` (PostgreSQL 17 riêng, `LC_ALL=C`): V339 → V341 → đo → V510 → đo → chạy lại bị từ chối → rollback về đúng md5 V341 → áp lại V510 → 203 dòng kiểm thử cũ (`scripts/fixtures/zalo-engagement/assertions.sql`) → bài tranh chấp khóa Chat. Dữ liệu đo ([scale_v510.sql](../scripts/fixtures/zalo-engagement/scale_v510.sql)): 2.000 nhân viên, một nhân viên có 40 chiến dịch, 70 nghìn kết quả và 50 nghìn lượt theo dõi còn hạn; mỗi hàm gọi 7 lần (PL/pgSQL đổi sang generic plan sau 5 lần), lấy lượt tệ nhất.

| Số dòng đọc trong một lượt gọi | V341 | V510 |
|---|---:|---:|
| Đăng ký: kết quả gửi | 140.013 | 17 |
| Đăng ký: dòng tương tác | 50.008 | 7 |
| Đăng ký: chiến dịch | 60.061 | 9 |
| Ghi sự kiện: dòng tương tác | 50.006 | 2 |
| Quét nguồn còn treo: kết quả gửi / chiến dịch | 4 / 6 | 4 / 2 |

Production (chỉ đọc, ép generic plan): câu lấy nguồn mới cho staff 1988 chạy **4,2 ms, 59 buffer** (trước 19,5 s); câu xóa dấu pending, đối chiếu Chat và trả kết quả đều tra khóa chính; quét nguồn còn treo cho staff 1190 292 ms lúc trang nguội vì còn 368 dấu pending sót từ 06/10 (client tự dọn ở lần khôi phục đầu sau khi bật). Câu tra sự kiện cần thống kê mới nên chỉ kiểm được sau khi apply.

## Triển khai

1. **Đã làm 17:46:02–17:46:05 VN 12/11** (REST p50 45 ms, 0 lỗi 5xx trước đó): PostgREST nạp lại schema 17:46:04→17:46:12 (truy vấn schema 5,7 s), phút 17:46 p99 REST 995 ms, 0 lỗi 5xx/503. Hậu kiểm đạt: thân `md5(prosrc)=dd6cf2bd…` (`md5(pg_get_functiondef)=6b40a8b7b51490287f7b39cb6b3c62ba`), owner/ACL/cấu hình và quyền 3 hàm bọc giữ nguyên, thống kê có phụ thuộc `staff_id→organization_id` 1,0 và `account_id→staff_id` 1,0, câu tra sự kiện (generic plan, staff 936) dùng `auto_campaign_engagement_target` với 6 điều kiện, 3 buffer (trước: index catalog, 688 buffer). Lúc công tắc tắt, hàm trả về ngay nên apply không đổi hành vi. Kiểm: sổ migration `md5(statements[1])` = md5 file, `md5(prosrc)=dd6cf2bd1f75998521d98ee46d8fff0e`, `pg_statistic_ext_data.stxddependencies` có dữ liệu, EXPLAIN generic câu tra sự kiện dùng `auto_campaign_engagement_target` với 6 điều kiện.
2. Bật công tắc ngoài giờ cao điểm: `UPDATE auto_system_settings SET value='true' WHERE key='zalo.campaign_engagement.enabled'`. Desktop 9.x và Chat nhận trong khoảng 1 phút.
3. **Khởi động lại App Server trên VPS** (VPS gửi ~70% lượt Zalo tới người). Từ 11:41 VN 12/11 tiến trình App Server không còn đọc công tắc dù vẫn gửi bình thường; chưa rõ vì sao (bộ nhớ đệm `EngagementConfigCache` không có gì tự thoát nếu một lượt đọc treo hoặc đồng hồ máy lùi). Sau khởi động phải thấy VPS gọi `aka_agent_register_campaign_engagement` trong `edge_logs`.
4. Ba phút đầu (18:02:06–18:04:50): 21 dòng mới của 9 nhân viên (18 tin nhắn, 3 lời mời); đăng ký từ Desktop 13 lượt TB 13,5 ms, 890 buffer/lượt (tháng 10: 169,6 ms, 44.095 buffer), từ Chat 4 lượt TB 13,5 ms, 314 buffer; đọc (danh mục lúc khởi động) Desktop TB 24,6 ms, Chat 6,6 ms; 0 lỗi; VPS chưa tham gia. Sau khi khởi động lại App Server (~18:06): VPS đọc công tắc mỗi phút, tới 18:09 có 58 lượt từ VPS, 14 từ Chat, 27 từ Desktop (54 nhân viên, 2 dấu đã xem); từ lúc bật tới 18:09:21 ba hàm tốn tổng 3,9 s chạy DB (đăng ký VPS 93 lượt TB 18,5 ms, 572 buffer); REST toàn hệ p50 44–48 ms, 0 lỗi 5xx; 8 lỗi 406 `auto_campaigns` lúc khởi động là hành vi sẵn có. Tiếp tục theo dõi qua một buổi sáng cao điểm: `pg_stat_statements` của ba hàm (trung bình nên dưới ~20 ms, vài trăm buffer/lượt), độ trễ `edge_logs`, số dòng mới trong `auto_campaign_detail_zalo_engagement`. Có vấn đề thì đặt lại `false` (không cần rollback V510).

## Chi phí còn lại khi bật

- Mỗi lượt gửi thành công tới người thêm một lần UPDATE `auto_campaign_details` để xóa dấu pending (không HOT vì partial index trên `data`), khoảng 8 nghìn lượt/giờ lúc cao điểm.
- Bảng tương tác ~612 byte/dòng kể cả index ⇒ khoảng 1,5–2 GB/tháng, chưa có cơ chế dọn.
- Dữ liệu từ 06/10 tới lúc bật không bù lại được.
