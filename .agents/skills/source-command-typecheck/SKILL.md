---
name: "source-command-typecheck"
description: "Chạy typecheck cho cả main process/preload/shared (tsconfig.node.json) và renderer (tsconfig.web.json). Cả 2 command phải sạch."
---

# source-command-typecheck

Use this skill when the user asks to run the migrated source command `typecheck`.

## Command Template

Run cả 2 typecheck commands song song:

```bash
npx tsc --noEmit -p tsconfig.node.json
npx tsc --noEmit -p tsconfig.web.json
```

Sau đó:
- Nếu cả 2 sạch: báo OK.
- Nếu có errors: list errors, nhóm theo file, suggest fix.
- Nếu có nhiều errors do refactor lớn: ưu tiên fix theo thứ tự dependency (shared types trước, repositories, runtime, IPC, UI cuối).
