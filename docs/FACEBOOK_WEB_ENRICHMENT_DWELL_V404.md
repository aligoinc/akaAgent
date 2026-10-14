# Thời gian đọc Web — V404

Đã apply trên **akachat / cgjbsmqtfhqvttudyjzq** lúc **01:22:24 ngày 15/10/2026, giờ Việt Nam**. History `20261014182224 / migration_v404_web_enrichment_dwell`. Không apply lại khi phát hành Desktop.

Theo yêu cầu mới, block `fb_web_enrichment_browse` (2833) đọc kết quả Google **10–30 giây**, mỗi website **1–3 phút**. Khoảng website áp dụng cho cả trang mở từ kết quả tìm kiếm và URL mở trực tiếp. Giữ thời lượng tổng mỗi phiên, cửa sổ bắt đầu 30 phút, cuộn trang, CAPTCHA/fallback, lỗi/hủy, clipping và ưu tiên chiến dịch.

[Migration](../migrations/migration_v404_web_enrichment_dwell.sql) chỉ thay hai lời gọi `read(random(...))` trong code block và `updated_at`. Đọc code live trước khi dựng thay đổi, khóa đúng row và kiểm tra checksum trước/sau trong transaction; source khác dự kiến thì dừng. Workflow 315, node/edge và selectors không đổi. Không sửa RPC/schema/ACL/account/config; không thêm connection/pool/polling. Apply dùng `execute_sql` và INSERT vào bảng migration history hiện có trong cùng transaction, không chạy DDL chuẩn bị history hoặc reload PostgREST.

| Bản | MD5 code |
|---|---|
| Trước V404 | `d106492c55706db94fbc8daa44514d8b` |
| Sau V404 | `8d1223574f8fc342317da3ce63db240b` |

Bằng chứng: [preflight](../migrations/snapshots/web-enrichment-dwell-v404/preflight.json), [diễn tập cập nhật/rollback](../migrations/snapshots/web-enrichment-dwell-v404/smoke.json), [apply](../migrations/snapshots/web-enrichment-dwell-v404/apply.json), [đọc lại sau apply](../migrations/snapshots/web-enrichment-dwell-v404/after.json).

Kiểm chứng đã đạt:

- Chạy code candidate bằng `node scripts/web-enrichment-workflow-smoke.cjs`: hai đầu mút Google 10/30 giây, trang kết quả và trang mở thẳng 60/180 giây; thời gian điều hướng, cuộn, clipping khi hết phiên, CAPTCHA và hết website.
- Chạy migration rồi rollback ngay trong transaction thử nghiệm; hai guard checksum đều qua, code live giữ nguyên trước apply.
- Sau apply, đọc lại code từ DB và chạy cùng smoke qua `WEB_ENRICHMENT_SNAPSHOT=migrations/snapshots/web-enrichment-dwell-v404/after.json node scripts/web-enrichment-workflow-smoke.cjs`. Khớp tuyệt đối candidate đã kiểm chứng; đảo đúng hai thay đổi trả về nguyên code trước đó, workflow giữ nguyên và MD5 statement trong history khớp SQL canonical.

Workflow đang được cache RAM theo phiên scheduler. **Khởi động lại app / `npm run dev` để nạp thời gian mới**; phiên đang dở tiếp tục dùng bản đã nạp. Không cần build/đóng gói Desktop chỉ cho thay đổi dữ liệu block này, không chạy Google thật trên tài khoản khách trong kiểm chứng.

Rollback: [SQL rollback V404](../migrations/tests/migration_v404_web_enrichment_dwell_rollback.sql) mặc định ROLLBACK để diễn tập, guard đúng checksum mới và xác minh checksum cũ. Chỉ đổi dòng cuối thành COMMIT khi chủ động hoàn nguyên về 30–60 giây / 3–5 phút; sau đó khởi động lại app để xóa cache block. Giữ history V404; không reapply V398/V401 hoặc drop schema.
