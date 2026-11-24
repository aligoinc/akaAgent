# V647: tin nhắn người lạ mất phần chữ sau ảnh (Z127)

24/11/2026, anh yêu cầu ("Hãy thực thi phương án"). Khoảng 7 khách báo tin chỉ có ảnh, mất chữ; nhân viên giải thích là do bước kiểm tra trùng hoặc AI viết lại. Cả hai đều không phải nguyên nhân.

## Nguyên nhân

- Tin có từ 2 tệp: app gửi album trước, rồi gửi chữ thành tin riêng (`planZaloSend`, [media.ts](../packages/campaign-engine/src/zalo/media.ts)). 1 tệp thì chữ đi chung làm chú thích.
- Nhắn người lạ: Zalo nhận album nhưng có lúc trả mã 127 "Không thể nhận tin nhắn từ bạn." cho tin chữ (gửi quá nhanh).
- Data bị đóng "thất bại", không gửi lại để khách không nhận ảnh hai lần.
- Câu cũ cho khách: "Đã gửi file nhưng gửi nội dung thất bại. Tin nhắn bị trùng lặp hoặc gửi quá nhanh (Z127)". Chữ "trùng lặp" là nhãn của mã 127, không phải app kiểm tra trùng.
- AI viết lại lỗi thì app đã dùng nội dung gốc sẵn ([messagePhone.ts](../packages/campaign-engine/src/zalo/messagePhone.ts) dòng "AI viết lại nội dung lỗi"); 149/152 lượt mất chữ thuộc chiến dịch không bật AI.

## Số đo 24/11/2026 (12:04–18:16 VN, nhắn người lạ, lượt ảnh đã tới)

| Số tệp mỗi tin | Nghỉ dưới 60 giây | 60–299 giây | Từ 300 giây |
|---|---|---|---|
| 2 | 1,4% (2/145) | 0,4% (1/261) | 0% (0/812) |
| 3–5 | 15,7% (61/389) | 3,9% (24/615) | 0% (0/85) |
| từ 6 | 25,1% (54/215) | 4,7% (17/364) | chưa có chiến dịch |

Nhắn bạn bè: 45 lượt, 0 mất chữ. Số nghỉ lấy theo cài đặt chiến dịch, chưa xét nhóm tài khoản đặt số riêng. Anh chốt mốc: từ 3 ảnh thì nghỉ từ 300 giây.

## Đổi gì

1. **DB** ([migration_v647_zalo_partial_text_note.sql](../migrations/migration_v647_zalo_partial_text_note.sql), sinh bằng `node scripts/build-v647-sql.cjs`, gỡ bằng `rollback_v647_…`). Có hiệu lực ngay cho engine v2 (Fly và Desktop bật cờ) và phần câu của bộ chạy cũ:
   - `aka_agent_engine_report_v1`: tiền tố dòng giao một phần đổi thành "Người nhận đã nhận ảnh nhưng chưa nhận được chữ." (md5 thân `ca458543…` → `488761c9…`, chỉ thay đúng một chuỗi).
   - `auto_error` 61 (`err_zalo_127_message_stranger`) và chính sách engine 92: bỏ cụm "trùng lặp", thêm lời khuyên dạng "nếu" (mã 127 dùng chung cho cả tin chỉ có chữ):
     - dòng lịch sử: "Zalo chặn tin chữ vì gửi quá nhanh. Nếu gửi từ 3 ảnh trở lên, đặt "Nghỉ giữa 2 lần" từ 300 giây"
     - ghi chú chiến dịch bộ chạy cũ: "Zalo chặn tin nhắn người lạ vì gửi quá nhanh, tạm nghỉ gửi tin [x] phút. Nếu gửi từ 3 ảnh trở lên, …"
     - câu chờ của engine (`aka_agent_engine_wait_note` đọc `customer_title`): "⏳ Zalo chặn tin nhắn người lạ vì gửi quá nhanh, chạy tiếp lúc … (Z127)". Hàm này không ghép `customer_help` (dùng chung mọi mã) nên lời khuyên nằm ở `customer_help` và ở dòng lịch sử.
   - Không đổi tính lượt, khoá 30 phút, chuỗi data lỗi, data đi đâu.
2. **Desktop / App Server** (cần phát hành): tiền tố của bộ chạy cũ (`ZALO_PARTIAL_CONTENT_AFTER_MEDIA_LOG`, [campaignScheduler.ts](../src/main/services/campaignScheduler.ts)); cảnh báo dưới ô nghỉ ở form thường và form Agent.
3. **Web** (akaAgentWebApp, cần deploy): cùng cảnh báo dưới ô nghỉ.

Quy tắc cảnh báo: [src/shared/zaloStrangerMediaPacing.ts](../src/shared/zaloStrangerMediaPacing.ts), chép nguyên văn ở akaAgentWebApp `packages/control-api/src/zaloStrangerMediaPacing.ts`. Áp cho loại có thể nhắn người lạ (theo SĐT, thành viên nhóm, group thời gian thực, khách hàng cũ, đề xuất Zalo), đếm số tệp lớn nhất một tin theo đúng cách bộ chạy chọn tệp (tất cả / ngẫu nhiên N / nội dung nâng cao lấy mục nhiều nhất). Chỉ cảnh báo, không chặn lưu.

## Kiểm thử

- Migration trên PG16 cục bộ: apply, chạy lại bị từ chối, gỡ, apply lại, chặn khi đã có trong sổ.
- Production 24/11 trong khối tự huỷ: hàm biên dịch với bảng thật, md5 sau khi đổi = `488761c9…`, mỗi bảng đổi 1 dòng.
- `node scripts/zalo-partial-send-log-smoke-test.cjs`, `node scripts/zalo-stranger-media-pacing-smoke.cjs` (18 ca), hai typecheck; Web: `vitest run src/test/CampaignRuntimeOptions.test.tsx`, typecheck.

## Trạng thái

V647 đã apply akachat 19:26:20 VN 24/11/2026 theo yêu cầu ("run sql"), bằng bản gọn `migrations/tests/migration_v647_zalo_partial_text_note_paste.sql` (cùng kết quả với file đầy đủ; sổ `20261124122620`, md5 sổ = bản gọn); PostgREST nạp lại schema 1,2 s, 0 lỗi 5xx. Không apply lại. [Biên nhận](../migrations/snapshots/zalo-partial-text-v647/apply-receipt.json).

## Thứ tự đưa lên

~~Apply V647~~ (ngoài giờ cao điểm vì `CREATE OR REPLACE FUNCTION` làm PostgREST nạp lại schema) → deploy Web → phát hành Desktop / cài App Server.
