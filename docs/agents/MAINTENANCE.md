# Bảo trì hướng dẫn và cách task khác sử dụng

## Quy trình cập nhật

1. Giữ AGENTS.md ngắn, mục tiêu dưới 20 KiB: quy tắc bắt buộc, kiến trúc nền,
   lệnh kiểm tra và routing. Không thêm receipt/checksum dài hoặc từng lần build.
2. Khi thay đổi table/RPC, IPC, runtime, status/log/UI convention hoặc pitfall:
   cập nhật hợp đồng feature và đường dẫn trong [mục lục](README.md).
   Chỉ thêm vào AGENTS.md nếu là quy tắc chung mọi task cần biết.
3. Khi apply/deploy/build: ghi audit/receipt feature, cập nhật trạng thái được xác
   nhận trong [CURRENT_STATE](CURRENT_STATE.md). Tách local build, upload, deploy,
   canary và DB; ghi thời gian và giới hạn kiểm chứng.
4. Khi thay thế quyết định: ghi mốc mới và liên kết nguồn bị thay thế; giữ lịch sử
   để điều tra, nhưng không để trạng thái cũ hướng dẫn mở lại quyền/cấu hình.
5. Vùng `PRESERVED SOURCE` trong `reference/` giữ nguyên nội dung đã chuyển.
   Khi có hướng dẫn cũ mâu thuẫn, cập nhật guide hiện hành và đặt ghi chú
   **Hướng dẫn hiện hành** trước vùng bảo toàn, nêu chính xác câu/phạm vi bị thay
   thế và dẫn tới guide/source xác nhận. Cập nhật mục lục; giữ archive và body
   bảo toàn nguyên vẹn. Manifest giữ hash body, cập nhật số byte toàn file khi
   thêm ghi chú; kiểm chứng lại link, checksum và phạm vi thay đổi.
6. Chỉ docs: kiểm tra link, diff, tính đầy đủ/phạm vi; không build app hoặc apply
   DB vì sửa tài liệu. Trước PR, [skill kiểm chứng](../../.agents/skills/source-command-verify-pr/SKILL.md)
   xét toàn bộ diff/commit của PR: nếu có code/build thì vẫn chạy đủ kiểm chứng;
   chỉ PR toàn tài liệu mới ghi typecheck/build `SKIP — chỉ tài liệu`.

Quy trình trên **thay thế** yêu cầu cũ “mọi task non-trivial cập nhật AGENTS.md /
Common pitfalls” trong [maintenance-02](reference/maintenance-02.md). Guide
feature nhận chi tiết nghiệp vụ; AGENTS.md chỉ nhận quy tắc chung hoặc routing.
Không thêm lịch sử trở lại AGENTS.md chỉ để thoả checklist cũ.

## Các task/agent khác có đọc được không?

Codex nạp AGENTS.md theo project và thư mục làm việc khi bắt đầu run; tài liệu
OpenAI nêu giới hạn mặc định 32 KiB cho hướng dẫn project. File trong `docs/`
không tự được nạp hết chỉ vì có link. Vì vậy AGENTS.md yêu cầu agent đọc mục lục
và phần theo phạm vi trước khi sửa/review.
[Nguồn OpenAI](https://learn.chatgpt.com/docs/agent-configuration/agents-md).

- **Task mới, cùng checkout đã có bản mới:** AGENTS.md là điểm vào, rồi đọc guide
  theo bảng. Không cần sao chép toàn bộ lịch sử vào prompt.
- **Task đang chạy:** không giả định tự nạp lại instruction; ở lượt tiếp theo cần
  yêu cầu đọc lại AGENTS.md từ disk và guide liên quan. Không tự gửi tin sang task
  khác khi người dùng chưa yêu cầu.
- **Checkout/worktree/máy khác:** cần nhận thay đổi bằng commit/merge và sync
  trước. Sửa repo chính không đồng nghĩa file của mọi worktree đã đổi.
- **Agent không hỗ trợ AGENTS.md:** cần cấu hình điểm vào tương đương hoặc chỉ
  rõ đọc file; không hứa mọi công cụ AI tự tuân thủ cùng cơ chế.

Không chỉnh cấu hình toàn cục hoặc các worktree/task khác để tự phát tán hướng
dẫn. Muốn kiểm tra việc áp dụng, yêu cầu agent nêu file đã đọc và quy tắc liên quan
đến task; không chỉ hỏi nó có “biết” quy tắc hay không.

## Bản lưu trước khi tổ chức

[Archive](archive/AGENTS-2026-10-28.txt) giữ nguyên 361.701 byte/1.050 dòng,
SHA-256 `3750842deac2ea6233f2c62dfd0edce988c600ba05b45a4bdf0bdb7c619740f5`.
[Manifest](reorganization-2026-10-28.json) ánh xạ từng đoạn vào tài liệu chuyển;
link tương đối là phép biến đổi duy nhất bên trong vùng `PRESERVED SOURCE`.
Đính chính hiện hành nằm ngoài vùng này; [hợp đồng client](CLIENT_CONTRACTS.md)
ghi rõ phần thay thế và nguồn code, không tự sửa chức năng ứng dụng.
Không sửa archive, không đưa source/capture riêng ngoài repo vào archive này.
