# @akabiz/engine

Workflow + Block execution engine cho akaBiz Auto.

**Status**: Phase 0 — types skeleton only. No runtime implementation yet.

## Mục tiêu

Engine pure TypeScript, browser-agnostic. App layer (Electron) cung cấp:
- `IChannelProvider` — launch browser context per channel (Playwright/Electron webview)
- `IConnectionVault` — decrypt secrets (AES-GCM)
- `IRunPersistence` — save runs/steps to DB

Engine emit `ProgressEvent` qua callback, app layer route đến UI/DB/forensic storage.

## Khái niệm

- **Block** (4 kinds: core/adapter/code/composite) — đơn vị thực thi nhỏ nhất
- **Workflow** — DAG nodes + edges, versioned
- **Channel** — browser session với cookie/profile (do app cung cấp qua IChannelProvider)
- **Run + RunStep** — bản ghi 1 lần chạy, immutable

## Roadmap

- ✅ **Phase 0**: types skeleton + public API surface (current)
- ⏳ **Phase 2**: `WorkflowRunner` + `ActivationQueue` + middleware hook
- ⏳ **Phase 3**: core primitives (control flow + data + io + datatable + workflow)
- ⏳ **Phase 4**: browser primitives (click/type/scroll/wait/...)
- ⏳ **Phase 5**: `PageRuntime` (webview executeJavaScript) + `NodeRuntime` (isolated-vm)

## Build

```bash
npm run build -w @akabiz/engine
npm run typecheck -w @akabiz/engine
```

## Public API (preview)

```ts
import { WorkflowEngine, type RunRequest, type ProgressEvent } from '@akabiz/engine'

const engine = new WorkflowEngine({
  blockRegistry,
  workflowLoader,
  channelProvider,
  connectionVault,
  selectorResolver,
  persistence,
  middlewares: []
})

engine.on('progress', (event: ProgressEvent) => { /* route to sinks */ })
const { runId } = await engine.enqueue({ workflowId, channelId, input })
```
