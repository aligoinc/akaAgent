# @akabiz/app

Electron + React app v2 cho akaBiz Auto. **Placeholder** — Phase 6+ sẽ implement.

## Phase plan (mỗi phase ship riêng)

- **Phase 6** — App services & ChannelManager
  - `electron/main/services/`: ChannelManager, RunOrchestrator, TriggerService (cron+webhook+EventBus), DataTableService (atomic row picker), ConnectionVault (AES-GCM), ElementPickerService, SelectorVerifier
  - `electron/main/browser/`: PlaywrightController, WebviewController (atomic primitives only), BrowserProfileManager
  - `electron/main/repositories/`: Supabase queries cho mọi entity
  - `electron/preload/`: bridge IPC + pickerInjector
- **Phase 7** — UI core: WorkflowEditor (ReactFlow) + ConfigPanel + BlockLibrary + ChannelPage + RunHistory
- **Phase 8** — Element Picker UI + SelectorLibraryPage
- **Phase 9** — DataTablePage + TriggerPage + ConnectionPage + CampaignViewPage
- **Phase 9.5** — ProgressDispatcher + 3-tier logging (CampaignLogger + ForensicCollector + ScreenshotWriter + RealtimeBroadcaster + CleanupJob)
- **Phase 10** — Composite block + Code block authoring (Monaco)
- **Phase 11** (optional) — Visual recorder
- **Phase 13** — Cutover: move legacy/ → archive, swap entry

## Cấu trúc target (Phase 6)

```
packages/app/
├── electron/
│   ├── main/
│   │   ├── index.ts
│   │   ├── ipc/
│   │   ├── services/
│   │   ├── browser/
│   │   └── repositories/
│   └── preload/
├── renderer/
│   └── src/
│       ├── pages/
│       ├── components/
│       ├── stores/
│       └── App.tsx
└── shared/   (IPC types only)
```
