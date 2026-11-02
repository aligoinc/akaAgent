# Tốc độ gõ form Agent — 03/11/2026

Source local trên `codex/campaign-agent-typing-performance`, nền PR #577 tại
`3ccf39da`. Chưa merge/sync bản sửa này, không đổi DB hoặc phát hành Desktop.

## Nguyên nhân và thay đổi

- State chữ chat nằm trong hook của form lớn: mỗi ký tự dựng lại toàn form.
  Composer nay có store theo phiên, chỉ chat subscribe; metadata nháp cập nhật
  đồng bộ để Lưu/Gửi ngay sau khi gõ không mất chữ. Không debounce dữ liệu.
- Hook clone toàn bộ draft và JSON-compare mọi trường ở mỗi render, kể cả hàng
  nghìn người nhận không thay đổi. Nay đọc state bất biến, chỉ so sánh sâu khi
  reference trường đổi. Snapshot tách rời cho transaction/undo vẫn giữ nguyên.
- Gõ nội dung dựng lại 100 dòng data trong trang. Cache JSX theo dữ liệu/trang,
  flags control và callback; sửa hàng, đổi trang/loại hoặc xóa vẫn cập nhật.
- Popover nội dung thông báo idle lặp sau mỗi revision nội dung. Form Agent bỏ
  thông báo không đổi để tránh render thêm. History không render lại theo phím
  chat; validation nháp ban đầu chỉ chạy một lần trong phiên.

Form thường, CSS/control, main/preload/shared và migration giữ nguyên. Dữ liệu
người nhận vẫn không đi vào request AI.

## Đo trước/sau

Electron thật với renderer app và fixture IPC/stores, chặn HTTP. Một lượt gõ
37 ký tự qua Playwright, form có 5.000 dòng tổng hợp (bảng phân trang 100 dòng).
Chạy React production trước/sau tuần tự trên cùng máy; đây là thời gian thao tác
của bài đo gồm overhead automation, không phải cam kết độ trễ trên máy khách.

| React production, 5.000 dòng | Trước | Sau |
| --- | ---: | ---: |
| Gõ chat | 1.147 ms | 220 ms |
| Gõ nội dung | 1.356 ms | 437 ms |
| Render form khi gõ chat | 37 | 0 |
| Clone danh sách khi gõ nội dung | 60 | 0 |
| Serialize danh sách khi gõ nội dung | 120 | 0 |

[Trước](typing-before-production.json), [sau](typing-after-production.json),
[sau trên React development](typing-after.json). Development có overhead JSX
lớn hơn: nội dung 3.489 ms, chat 290 ms cho cùng 37 ký tự/5.000 dòng; không suy
tốc độ production từ dev. Không có request AI trong các phép đo gõ.

## Chạy lại

```bash
CAMPAIGN_AGENT_ARTIFACTS_DIR=/tmp/akaagent-typing node scripts/run-campaign-agent-typing-smoke.cjs --baseline --production
CAMPAIGN_AGENT_ARTIFACTS_DIR=/tmp/akaagent-typing node scripts/run-campaign-agent-typing-smoke.cjs --production
CAMPAIGN_AGENT_ARTIFACTS_DIR=/tmp/akaagent-typing node scripts/run-campaign-agent-typing-smoke.cjs
CAMPAIGN_AGENT_ARTIFACTS_DIR=/tmp/akaagent-typing-regression node scripts/run-campaign-agent-ui-smoke.cjs
npx tsc --noEmit -p tsconfig.node.json
npx tsc --noEmit -p tsconfig.web.json
npm run build
```

Baseline mặc định đọc source từ `3ccf39da`; có thể đặt
`CAMPAIGN_AGENT_BASELINE_REF` để so với revision khác. Không dùng ngưỡng thời gian
dễ nhiễu làm điều kiện pass: assert không clone/serialize danh sách khi gõ,
không render form khi gõ chat, không gọi AI, lưu ngay đủ chữ/dòng, sửa đúng dòng
ở trang hai và giữ guard Hoàn tác khi sửa tay rồi trả lại giá trị cũ.

Hai typecheck, production build, smoke nhập liệu và toàn bộ hồi quy form Agent
đều PASS. Lưu/mở lại nháp, sửa data trang 1/2, gửi đúng chữ vừa gõ và guard
Hoàn tác sau sửa tay/khôi phục giá trị đều PASS. Xem [receipt](verification.json)
và [log hồi quy](regression.txt). Chưa đo
trên máy người dùng, Windows hay provider live; chưa phát hành/apply DB.

## Kiểm chứng trước PR

Hai typecheck và production build chạy lại đều đạt; build 26,66 giây, tổng output
40.008.726 byte. Source khớp checksum bản đã qua toàn bộ smoke và review; không
chạy lại AI live hoặc apply DB. Link tài liệu, diff, bảo toàn phạm vi và quét mẫu
credential đạt. Xem [receipt trước PR](pr-verification.json).
