# Tag Zalo đã xóa trong bộ lọc — 04/11/2026

## Phạm vi và trạng thái

Theo yêu cầu người dùng, tag đã xóa trên Zalo được bỏ khỏi điều kiện loại trừ
khi chạy; lỗi đọc danh sách vẫn giữ trạng thái chưa đủ dữ liệu/tạm dừng.
Chat runtime và system-worker đã deploy 22:50–22:51 VN ngày 04/11/2026 theo
yêu cầu trực tiếp của người dùng; chưa phát hành bộ cài Desktop/legacy Server.
Không sửa DB/campaign, không tự chạy lại các input đã tạm dừng, không gửi Zalo
thật, không thêm connection/polling hoặc đổi quota/ownership.

Hai checkout dùng nhánh `codex/zalo-deleted-tag-filters`:

| Repository | Nền đã đồng bộ trước khi sửa | Source |
| --- | --- | --- |
| akaAgent | Ban đầu `77d488e3`; đã fast-forward `dev_3` tới `c2b340cd` trước PR và chạy lại hai typecheck/build | `src/shared/campaignSendExclusion.ts` |
| akaAgentChatApi | `843fb65b9999d0c1189ef679f49262e5b2716a98` (`dev`) | `packages/runtime-protocol/src/campaignSendExclusion.ts` |

Hai file shared phải giống nhau từng byte. Thay đổi có sẵn ở `CLAUDE.md`,
`docs/DE_XUAT_ENGINE_CHIEN_DICH_CHUNG.md` và `akaAgentChatApi/labs/` được giữ nguyên,
không thuộc bản sửa.

## Hành vi

- Với native Zalo tag (`contains_any`/`contains_none`), giao các ID đã chọn với
  danh sách tag đọc thành công từ Zalo. Chỉ xét những ID còn tồn tại.
- Nếu tất cả ID trong điều kiện đã bị xóa, bỏ điều kiện đó khỏi cả AND/OR.
  Những điều kiện khác vẫn giữ hiệu lực; không còn điều kiện nào thì cho qua.
  Điều kiện "không chứa" rỗng không được coi là khớp mọi người.
- Danh sách rỗng hợp lệ khác với phản hồi thiếu/sai cấu trúc. Lỗi mạng/API,
  membership/catalogue không đọc được và ID tag sai kiểu vẫn trả unknown.
  Validator kiểm tra ID trước khi chuyển sang chuỗi, tránh biến dữ liệu API
  hỏng thành bằng chứng tag đã bị xóa.
- Giữ blocklist, các nguồn khác (bao gồm akaBiz), short-circuit ba trạng thái,
  cache/snapshot theo lượt chạy, kiểm tra phiên, CAS pause và cleanup hiện có.
- Chỉ bỏ ID khi đánh giá runtime; không ghi lại nhóm/revision hoặc đổi snapshot.
  Form vẫn có thể hiển thị ID cũ để người dùng dọn thủ công. Xóa tag khi một
  lượt đang chạy tuân theo thời điểm đọc/cache danh sách hiện có.

Hợp đồng hiện hành: [CAMPAIGN_SEND_EXCLUSIONS](../../CAMPAIGN_SEND_EXCLUSIONS.md#deleted-native-zalo-tags--source-change-04112026).

## Kiểm chứng

| Kiểm tra | Kết quả |
| --- | --- |
| `node scripts/send-exclusion-smoke-test.cjs` | Đạt: xóa một phần/toàn bộ, cả hai toán tử, AND/OR với điều kiện khác, unknown, blocklist, snapshot bất biến, ID số/chuỗi, ID API sai cấu trúc và parity hai repository |
| `node scripts/send-exclusion-runtime-smoke.cjs` | Đạt: 35 ca mới qua preflight/gate thật của 7 action Desktop/legacy Server; giữ CAS, phiên QR/Web, lookup phone và single-flight |
| Hai typecheck akaAgent (`tsconfig.node.json`, `tsconfig.web.json`) | Đạt bản cuối |
| `npm run build` akaAgent | Đạt bản cuối; main/preload/renderer đều build thành công |
| `npm run typecheck`, `npm run build` akaAgentChatApi | Đạt bản cuối |
| `npx vitest run apps/system-worker/src/zaloCampaignExecutor.test.ts` | 242 ca đạt, gồm 5 ca mới cho tag đã xóa/lỗi đọc |
| `npm test` akaAgentChatApi | Bản cuối: 128 file, 1.856 ca đạt, 2 bỏ qua; lượt 18:04:22 VN, 192,59 giây |
| Diff và tài liệu | `git diff --check` sạch hai repo; parity shared source và đích liên kết tài liệu mới đạt |

SHA-256 shared source bản cuối (hai repo):
`bc81eda227b9757bf7c26206269c6e11c3fcfe8362693e67ae10938e0827fa7b`.

Hai smoke hồi quy ngoài phạm vi vẫn thất bại; đã chạy lại với shared contract
từ `HEAD` trước bản sửa và nhận cùng lỗi:

- `scripts/zalo-auxiliary-skip-smoke-test.cjs`: fixture thiếu state của scheduler,
  `createBlockRuntimeHelpers` đọc `.has` trên undefined (test dòng 92).
- `scripts/campaign-failure-cleanup-smoke-test.cjs`: assertion dòng 829 so khớp
  nguyên văn `settleActiveCampaignRunUnit` với bản frozen cũ, khác source hiện
  có về Facebook random-turn progress/error handling. Các ca phone exclusion
  đứng trước assertion này vẫn đạt.

Không sửa hai script ngoài phạm vi hoặc scheduler để làm xanh kiểm tra cũ.
Trong smoke runtime liên quan trực tiếp, fixture được bổ sung
`campaignMediaExecutions` để theo state hiện hành của runtime.

## Triển khai Chat

Nguồn/build/cấu hình/health/checksum và quan sát traffic production nằm trong
[audit Chat](../../../../akaAgentChatApi/docs/audits/zalo-deleted-tag-filters-20261104/README.md)
và receipt cùng thư mục. Runtime `7817d7daee2d58` chạy image mới trước worker
`784574da214578`; cả hai chỉ đổi image. API giữ nguyên instance/config; không
migration, tăng replica, pool, tài nguyên hoặc đổi secret. Hai process cũ thoát
mã 0, runtime drain hết event trước khi dừng. 175 file JS trên mỗi máy khớp
build đã kiểm thử. Health live/ready HTTP 200, 237 tài khoản attach lại; số ready
và reconnect được ghi riêng, không suy toàn bộ đã đăng nhập thành công.
Quan sát 22:58:11 VN: 184 ready / 53 error do đăng nhập thất bại sau các lần
reconnect; capture trước deploy không có status từng tài khoản nên chưa phân
loại được lỗi mới/cũ. Hàng đợi raw/project còn 5.691/7.380 ở lượt 22:57:56 VN và
đang giảm; chưa coi toàn bộ đồng bộ đã bắt kịp.

Review tiếp theo đạt 5.832 tổ hợp truth table và 273 test Chat có phạm vi liên
quan. Synthetic local trước deploy ACK đủ 1.000/1.000 event khi mô phỏng outage.

Chưa kiểm chứng bộ cài Windows, UI khách hàng hoặc side effect gửi thật.
Desktop/legacy Server vẫn cần phát hành; không tự mở lại input đã tạm dừng.
