# Đối chiếu yêu cầu DB-only cho trạng thái phụ đăng group

**Quyết định sau cùng:** người dùng yêu cầu hủy hướng DB-only và tạm thời giữ mapping trong code. Ba thay đổi `campaignScheduler.ts` của V373 đã được khôi phục; catalog ID 55 vẫn giữ nguyên. Không chỉnh block/workflow DB. Phần bên dưới ghi lại đối chiếu và lần gỡ tạm trước khi đổi quyết định, không phải trạng thái triển khai hiện tại. Mapping và điều kiện phát hành hiện tại theo `FB_POST_APPROVED_STATUS_V373.md`.

Ngày 10/10/2026, người dùng làm rõ rằng phần bổ sung Đã duyệt bài phải đi theo hướng DB/block/workflow, không thêm mapping mã trạng thái vào app.

## Điều chỉnh đã thực hiện

- Gỡ toàn bộ ba thay đổi của V373 trong `src/main/services/campaignScheduler.ts`: helper `getGroupPostSubStatusCode`, lời gọi trong milestone xác nhận đăng bài, và `resultOutput` bổ sung ở fallback. File này khớp HEAD `0b315a33`, không còn diff của đợt bổ sung.
- Giữ nguyên dòng `auto_status.id=55`, code `campaign_detail_post_approved`, đã apply V373. Không sửa trạng thái, policy, detail hoặc block/workflow live trong lần đối chiếu này.
- Giữ nguyên các thay đổi cache/query khác của task.
- Thay kiểm chứng để xác nhận adapter legacy không tự suy trạng thái Đã duyệt bài; khi producer trả explicit `subStatusCode='campaign_detail_post_approved'` tại đúng nguồn kết quả, resolver/writer hiện có chấp nhận và sử dụng policy Thành công.

Tại thời điểm đối chiếu, tài liệu V373 và `validation.json` là ghi nhận của bản thử triển khai lúc apply catalog. Mapping app từng được gỡ tạm; chưa có installer nào được phát hành với mapping này. Sau quyết định sau cùng ở đầu tài liệu, mapping đã được khôi phục và kiểm chứng lại trong receipt `code-mapping-restored.json` cùng thư mục snapshot V373.

## Cách Chờ duyệt bài đang chạy

`auto_status.id=52` lưu danh mục `campaign_detail_post_pending`. Block DB **31 / fb_detect_pending_post** trả `isPending` và `pendingCheckConclusive`; `groupPostMilestonePayload()` trong app chuyển `isPending=true` thành mã phụ trên. Như vậy định nghĩa nằm trong DB nhưng adapter Facebook vẫn có mapping cố định trong app.

Hai workflow live có chuỗi này: **1 / facebook_group_post**, **252 / facebook_group_post__test__facebook_group_post**. Cả hai xác nhận đóng form trước khi lấy link và kiểm tra pending. Nguồn detail hiện tại là step `fb_verify_group_post_form_closed`; khi workflow kết thúc, scheduler đọc toàn bộ steps làm context để bổ sung thông tin phát hiện sau đó.

Checksum đã đọc:

- Workflow 1: `e94ea1cf3c5e6af8efa04f50b8ebee2c`.
- Workflow 252: `abb3f882de679a772a3863ccec6c3c18`.
- Block 31: `21335b279cb31cfb4f382d0a1185e59a`.
- Block 2624 / verify: `930a3a9668e680bbb6f3f15b2951d073`.

## Phần chưa chuyển

Chưa có migration chuyển nơi phát kết quả của hai workflow. Không được chỉ thêm một `actionResult` mới ở block detect: scheduler hiện vẫn ghi detail legacy của step verify, dẫn tới hai nguồn kết quả và nguy cơ tính lượt hai lần.

Phương án tiếp theo phải chọn rõ một nguồn kết quả cho cùng thao tác, giữ kết quả đăng đã xác nhận khi bước kiểm tra phụ lỗi/hủy, giữ fallback cho app/block cũ, và giữ contact approval/share-target/bump/input/log hiện có. Không sửa step output đã phát qua boundary hoặc ghi đè detail lịch sử để né yêu cầu này.

Đây là khoảng trống giữa adapter Facebook hiện tại và mục tiêu DB chọn toàn bộ mã trạng thái phụ; catalog mới không tự giải quyết khoảng trống đó. Không coi công việc chuyển workflow là đã hoàn tất.
