# Quy tắc bảo trì cũ

> Chuyển từ AGENTS.md ngày 28/10/2026, dòng 1006–1023. Nội dung và ràng buộc được giữ; chỉ sửa đường dẫn Markdown.
> Trạng thái “đã/chưa apply/deploy/phát hành” bên dưới là lịch sử. Đối chiếu [CURRENT_STATE](../CURRENT_STATE.md), audit mới nhất và live trước mọi thao tác. Không coi ghi chú quyền cũ là cho phép mở lại quyền.

## Hướng dẫn hiện hành — 28/10/2026

**Toàn bộ checklist bảo trì bên dưới chỉ lưu làm lịch sử, đã được thay thế bởi
[MAINTENANCE](../MAINTENANCE.md) và [skill trước PR](../../../.agents/skills/source-command-verify-pr/SKILL.md).**
Chi tiết table/IPC/runtime/pitfall đi vào guide feature và mục lục; AGENTS.md
chỉ cập nhật khi quy tắc chung hoặc routing thay đổi. Không tái tạo mục Common
pitfalls dài. Quy trình trước PR có nhánh toàn tài liệu và vẫn kiểm chứng đầy đủ
khi phạm vi PR có code/build.

<!-- BEGIN PRESERVED SOURCE -->
## Maintenance — keep this file fresh

Khi xong 1 task **non-trivial** mà có 1 trong các thay đổi sau, update AGENTS.md trước khi end turn:

- Thêm/sửa table Supabase, IPC account, system block, status enum value
- Thêm/sửa repository, service, runtime module
- Đổi convention log/UI tiếng Việt, emoji vocab, status string
- Đổi command build/dev (npm scripts, tsconfig)
- Phát hiện common pitfall mới (xếp vào "Common pitfalls")
- Đổi default branch hoặc repo URL

KHÔNG update khi:
- Bug fix nhỏ không introduce pattern mới
- UI tweak, CSS, copy text changes
- Refactor đơn thuần không đổi public interface

Pattern: chỉnh tại đúng section, giữ entry **terse** (1-2 dòng), link `file:line` thay vì paraphrase code. Nếu plan-mode tạo file lớn → reference plan file thay vì duplicate.


<!-- END PRESERVED SOURCE -->
