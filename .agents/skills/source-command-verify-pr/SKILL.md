---
name: "source-command-verify-pr"
description: "Pre-PR check — typecheck + production build + git status. Chạy trước khi push branch và mở PR vào dev_3."
---

# source-command-verify-pr

Use this skill when the user asks to run the migrated source command `verify-pr`.

## Command Template

Chạy theo thứ tự:

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
   - Verify không có file uncommitted không liên quan
   - List commits sẽ vào PR

4. **AGENTS.md check**: review các thay đổi commits:
   - Có thêm/sửa table Supabase, IPC account, action type, system block, status enum?
   - Có thêm/sửa repository, runtime module, convention log/UI?
   - Có common pitfall mới?
   - Nếu YES bất kỳ → update AGENTS.md (section liên quan + Common pitfalls)

5. **Báo cáo**: ngắn gọn 4 dòng:
   - tsc: PASS / FAIL (errors)
   - build: PASS / FAIL (output size + duration)
   - commits: N commits, X files changed
   - AGENTS.md: updated / không cần / cần update
