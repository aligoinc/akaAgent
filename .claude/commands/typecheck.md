---
description: Chạy typecheck cho cả main process (tsconfig.node.json) và renderer (tsconfig.web.json). Bỏ qua 2 errors pre-existing trong controller.ts:158-159 — anything else là regression.
---

Run cả 2 typecheck commands song song:

```bash
npx tsc --noEmit -p tsconfig.node.json
npx tsc --noEmit -p tsconfig.web.json
```

Sau đó:
- Nếu cả 2 sạch (hoặc chỉ có 2 errors quen `Cannot find name 'window'` trong `src/main/playwright/controller.ts:158-159`): báo OK
- Nếu có errors khác: list errors, nhóm theo file, suggest fix
- Nếu có nhiều errors do refactor lớn: ưu tiên fix theo thứ tự dependency (shared types trước, repositories, runtime, IPC, UI cuối)
