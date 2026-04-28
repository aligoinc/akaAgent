---
description: Pre-PR check — typecheck + electron-vite build + git status. Chạy trước khi push branch và mở PR vào dev_3.
---

Chạy theo thứ tự:

1. **Typecheck**:
   ```bash
   npx tsc --noEmit -p tsconfig.node.json
   npx tsc --noEmit -p tsconfig.web.json
   ```
   Phải sạch (trừ 2 pre-existing errors `controller.ts:158-159`).

2. **Build**:
   ```bash
   npx electron-vite build
   ```
   Phải pass exit 0. Build output ở `out/main` + `out/preload` + `out/renderer`.

3. **Git status check**:
   ```bash
   git status --short
   git log --oneline origin/dev_3..HEAD
   ```
   - Verify không có file uncommitted không liên quan
   - List commits sẽ vào PR

4. **CLAUDE.md check**: review các thay đổi commits:
   - Có thêm/sửa table Supabase, IPC channel, action type, system block, status enum?
   - Có thêm/sửa repository, runtime module, convention log/UI?
   - Có common pitfall mới?
   - Nếu YES bất kỳ → update CLAUDE.md (section liên quan + Common pitfalls)

5. **Báo cáo**: ngắn gọn 4 dòng:
   - tsc: PASS / FAIL (errors)
   - build: PASS / FAIL (output size + duration)
   - commits: N commits, X files changed
   - CLAUDE.md: updated / không cần / cần update
