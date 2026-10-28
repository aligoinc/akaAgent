---
name: "source-command-verify-pr"
description: "Kiểm tra trước push/PR vào dev_3: phạm vi Git, tài liệu, typecheck và build khi có thay đổi code/build; có nhánh riêng cho thay đổi chỉ tài liệu."
---

# source-command-verify-pr

Dùng khi user yêu cầu `verify-pr` hoặc trước push/PR vào `dev_3` theo AGENTS.md.
Đọc [AGENTS.md](../../../AGENTS.md) và [quy trình tài liệu](../../../docs/agents/MAINTENANCE.md) hiện hành.

## Command Template

Xác định toàn bộ phạm vi sẽ vào PR trước khi chọn kiểm chứng; không chỉ xét file
vừa sửa ở lượt cuối. Commit có code/build vẫn phải chạy bước 1–2 dù lượt cuối chỉ
sửa docs. Chỉ bỏ bước 1–2 khi toàn bộ thay đổi là tài liệu/hướng dẫn không đổi hành
vi executable, cấu hình build, SQL hoặc script. Skill Markdown thuần hướng dẫn
thuộc nhánh tài liệu; script đi kèm skill không thuộc ngoại lệ này.

Chạy theo thứ tự, ghi `SKIP — chỉ tài liệu` cho bước 1–2 khi đủ điều kiện:

1. **Typecheck**:
   ```bash
   npx tsc --noEmit -p tsconfig.node.json
   npx tsc --noEmit -p tsconfig.web.json
   ```
   Phải sạch.

2. **Build**:
   ```bash
   npm run build
   ```
   Phải pass exit 0. Build output ở `out/main` + `out/preload` + `out/renderer`.
   Nếu fail `ENOSPC`, báo rõ là thiếu dung lượng ổ đĩa, không tính là lỗi code nếu typecheck đã pass.

3. **Git status check**:
   ```bash
   git status --short
   git log --oneline origin/dev_3..HEAD
   ```
   - Kiểm tra cả diff sẽ đưa vào PR; không đưa file/commit không liên quan vào PR.
   - Giữ nguyên công việc chưa commit có sẵn; không dọn/reset để làm sạch status.
   - List commits sẽ vào PR

4. **Tài liệu**: review thay đổi theo [MAINTENANCE](../../../docs/agents/MAINTENANCE.md):
   - Table/RPC, IPC, action, runtime, status/log/UI hoặc pitfall đổi: cập nhật guide feature và [mục lục](../../../docs/agents/README.md) khi cần.
   - Chỉ cập nhật AGENTS.md khi quy tắc chung hoặc đường dẫn định hướng thay đổi; không chèn lịch sử, audit hoặc thêm lại mục Common pitfalls dài.
   - Đã apply/deploy/build: cập nhật audit/receipt và [CURRENT_STATE](../../../docs/agents/CURRENT_STATE.md) với đúng trạng thái đã xác nhận. Không tự apply/deploy vì đang làm PR.
   - Kiểm tra nội dung, link và `git diff --check`. Nếu sửa bản tách, giữ archive và vùng `PRESERVED SOURCE`; ghi đính chính bên ngoài, kiểm tra checksum/bảo toàn theo manifest. AGENTS.md giữ dưới 20 KiB.
   - Với thay đổi chỉ tài liệu, các kiểm tra ở bước 3–4 thay cho typecheck/build; không báo chúng là PASS nếu chưa chạy.

5. **Báo cáo**: ngắn gọn 4 dòng:
   - tsc: PASS / FAIL (errors) / SKIP — chỉ tài liệu
   - build: PASS / FAIL (output size + duration) / SKIP — chỉ tài liệu
   - commits: N commits, X files changed
   - docs: guide/AGENTS.md đã cập nhật hoặc không cần; link/diff/bảo toàn PASS / FAIL
