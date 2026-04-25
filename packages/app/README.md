# @akabiz/app

akaBiz Auto v2 — Electron + React app services + CLI runner.

**Status**: Phase 6 done — minimum viable. Test E2E từ CLI.

## Quick start (E2E test)

### 1. Setup environment

Tạo file `.env` ở root repo:

```bash
SUPABASE_URL=https://yfkvwgapqmywaoftwuzc.supabase.co
SUPABASE_SERVICE_KEY=<your service_role key, from Supabase dashboard>
CONN_VAULT_KEY=<random 32+ char string for AES-GCM>
```

Lấy `SUPABASE_SERVICE_KEY` từ:
- Supabase Dashboard → Project `aka_agent` → Settings → API → `service_role` key

### 2. Install Playwright browsers

```bash
npx playwright install chromium
```

### 3. Test workflow KHÔNG cần browser (GitHub API)

```bash
# Build packages
npm run engine:build
npm run build -w @akabiz/app

# Seed workflow vào DB
SUPABASE_URL=... SUPABASE_SERVICE_KEY=... \
  node packages/app/dist/cli/seed-workflow.js packages/app/examples/hello-world.workflow.json
# → prints workflow id, copy nó

# Run với input
SUPABASE_URL=... SUPABASE_SERVICE_KEY=... \
  node packages/app/dist/cli/run-workflow.js <workflow-id> --input '{"username":"octocat"}'
```

Expected output:
```
[CLI] Bootstrapping app...
[CLI] Running workflow '<id>'...

  ▶ n_in (core.input)
  ✅ n_in 0ms
  ▶ n_log_start (core.log)
  ℹ️ [n_log_start] Đang fetch GitHub user octocat
  ✅ n_log_start 1ms
  ▶ n_http (core.httpRequest)
  ℹ️ [n_http] HTTP GET https://api.github.com/users/octocat → 200
  ✅ n_http 423ms
  ▶ n_transform (core.transformJson)
  ✅ n_transform 0ms
  ▶ n_log_end (core.log)
  ℹ️ [n_log_end] User octocat có 8 repos và ... followers
  ✅ n_log_end 0ms
  ▶ n_out (core.output)
  ✅ n_out 0ms

[CLI] Run finished: completed (xxx ms)
[CLI] Result: { ... }
```

Verify trong Supabase Dashboard `runs` table có row mới với status='completed'.

### 4. Test workflow CẦN browser (Google search)

Tạo channel trong DB trước:

```sql
INSERT INTO channels (name, channel_type, profile_path, status)
VALUES ('Test Browser', 'browser_persistent', '/tmp/akabiz-test-profile', 'idle')
RETURNING id;
-- Copy channel id
```

Seed + run:
```bash
node packages/app/dist/cli/seed-workflow.js packages/app/examples/fb-google-search.workflow.json

# Run với --channel
node packages/app/dist/cli/run-workflow.js <wf-id> --channel <channel-id> --input '{"query":"hello world"}'
```

→ Browser Chromium mở lên, navigate Google, type query, screenshot. Output có `screenshotBase64`.

## Architecture

```
packages/app/
├── src/
│   ├── browser/
│   │   └── PlaywrightController.ts       ← IBrowserController impl
│   ├── repositories/
│   │   ├── SupabaseRunPersistence.ts     ← IRunPersistence impl
│   │   └── SupabaseDataTableProvider.ts  ← IDataTableProvider impl
│   ├── services/
│   │   ├── ChannelManager.ts             ← IChannelProvider impl + warm pool
│   │   ├── ConnectionVault.ts            ← AES-256-GCM encrypt/decrypt
│   │   ├── TriggerService.ts             ← cron tick + EventBus
│   │   └── RunOrchestrator.ts            ← queue + fan-out + recovery
│   ├── cli/
│   │   ├── run-workflow.ts               ← CLI test runner
│   │   └── seed-workflow.ts              ← seed JSON → DB
│   └── bootstrap.ts                      ← wire all services
└── examples/
    ├── hello-world.workflow.json         ← GitHub API test (no browser)
    └── fb-google-search.workflow.json    ← Google search test (browser)
```

## Phase 6 limitations (sẽ fix Phase 7+)

- ❌ No UI yet — chỉ CLI. Phase 7 sẽ implement WorkflowEditor.
- ❌ Webhook server chưa implement (TriggerService chỉ cron). Phase 6.5+.
- ❌ Logging 3-tier (campaign_logs / step_forensics / screenshots) chưa wire — Phase 9.5.
- ❌ Element picker UI Phase 8.
- ❌ Atomic SELECT FOR UPDATE SKIP LOCKED chưa có (cần stored proc Supabase). Phase 6.5.
- ❌ NodeRuntime dùng `node:vm` không phải isolated-vm — không sandbox thật. Phase 5b sẽ swap.

## Next phases

- **Phase 7**: Electron main + React renderer + WorkflowEditor UI
- **Phase 8**: Element Picker UI + Selector Library
- **Phase 9**: DataTable / Trigger / Connection / CampaignView pages
- **Phase 9.5**: Logging 3-tier (CampaignLogger + ForensicCollector + ScreenshotWriter)
- **Phase 10**: Composite + Code block authoring (Monaco editor)
- **Phase 13**: Cutover, archive `src/` → `legacy/`
