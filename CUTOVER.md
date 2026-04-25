# akaBizAuto v2 — Cutover Guide (Phase 13)

Hướng dẫn chuyển từ app legacy (root `src/`) sang v2 (`packages/app/`).

## Tổng quan

| Aspect | Legacy (`src/`) | v2 (`packages/app/`) |
|---|---|---|
| Architecture | Monolithic Electron | Monorepo (engine + app + adapters) |
| Schema | `auto_*` tables | New schema (blocks, workflows, channels, ...) |
| Logic | Hard-coded FB scheduler | Workflow + Block (data trong DB) |
| Build | `npm run dev` | `npm run dev -w @akabiz/app` |

Cả 2 chạy được song song trong khi migrate (tables không xung đột tên).

## Pre-cutover checklist

- [ ] Schema mới đã apply (`db/migrations/0001_init_schema.sql` — đã có trên `aka_agent`)
- [ ] App v2 build pass: `npm run engine:build && npm run build:electron -w @akabiz/app`
- [ ] Engine tests pass: `npm run engine:test` (47/47)
- [ ] Backup DB: pg_dump full Supabase trước khi migrate
- [ ] Test trên 1 channel + 1 campaign trước khi migrate full

## Migration steps

### Bước 1 — Backup

```bash
# Backup toàn bộ Supabase
pg_dump $DATABASE_URL > backup-$(date +%Y%m%d).sql
```

### Bước 2 — Run migration script (dry run)

```bash
SUPABASE_URL=$SUPABASE_URL \
SUPABASE_SERVICE_KEY=$SUPABASE_SERVICE_KEY \
npx tsx scripts/migrate-legacy.ts --dry-run
```

Output mẫu:
```
[migrate] mode: DRY RUN
[1/5] Migrating channels...
  ✓ 24 channels
[2/5] Migrating named selectors...
  ✓ 4 selectors
[3/5] Migrating workflows from auto_flows...
  ✓ 13 workflows + 13 revisions
[4/5] Migrating campaigns...
  ✓ 189 campaigns → 189 datatables (248 rows) + 92 triggers
Summary:
  Channels:           24
  Workflows:          13 (+13 revisions)
  DataTables:         189
  DataTable rows:     248
  Triggers:           92
  Campaign Views:     189
  Named Selectors:    4
  Errors:             0
  Mode: DRY RUN — no DB writes
```

Review summary. Nếu errors > 0 → fix issue trước khi run thật.

### Bước 3 — Run migration thật

```bash
npx tsx scripts/migrate-legacy.ts
```

### Bước 4 — Verify trên app v2

```bash
# Setup .env (nếu chưa)
echo "SUPABASE_URL=$SUPABASE_URL" >> .env
echo "SUPABASE_SERVICE_KEY=$SUPABASE_SERVICE_KEY" >> .env
echo "CONN_VAULT_KEY=$(openssl rand -hex 32)" >> .env

# Run app v2
npm run dev -w @akabiz/app
```

Kiểm tra:
- [ ] Tab "Chiến dịch" hiển thị đầy đủ campaigns đã migrate
- [ ] Click vào 1 campaign → workflow + trigger + datatable đúng
- [ ] Tab "DataTables" → rows status đúng (pending/done/failed)
- [ ] Tab "Channels" → channels cũ hiển thị, type=browser_persistent
- [ ] Tab "Triggers" → cron schedule next_run_at chuẩn xác
- [ ] Tab "Selectors" → named selectors từ auto_elements
- [ ] Tab "Workflows" → workflows migrated. Mở 1 workflow → canvas hiển thị nodes (manifestId mapped từ legacy actionType — có thể cần edit thủ công cho FB-specific actions)

### Bước 5 — Manual fixes (workflows FB-specific)

Workflows cũ có FB-specific actions (`fbSharePost`, `fbScrapePost`, ...) đã map về `core.log` trong migration. User cần:

1. Mở workflow trên editor
2. Thay từng node `core.log` bằng workflow tương đương dùng primitives (`core.click` + `core.type` + selector picker)
3. Hoặc tạo composite block từ workflow mẫu (manual rebuild 1 lần, dùng lại nhiều campaign)

### Bước 6 — Switch primary entry point

Khi user đã verify v2 hoạt động đúng:

**Option A — Soft cutover** (khuyến nghị):
- Giữ cả `src/` và `packages/app/` trong build
- User chạy v2 song song legacy 1-2 tuần
- Khi confident → uninstall legacy

**Option B — Hard cutover**:
```bash
# Move legacy code vào archive
git mv src archive/legacy-v1
git mv electron.vite.config.ts archive/legacy-v1/
git mv tsconfig.node.json tsconfig.web.json archive/legacy-v1/

# Update root package.json để v2 thành entry point
# Edit scripts: dev → "npm run dev -w @akabiz/app", build → "npm run build:electron -w @akabiz/app"
# Update electron-builder config để bundle out/ từ packages/app/

git commit -m "chore: cutover to v2, archive legacy app"
```

### Bước 7 — Build installer v2.0.0

```bash
# Bump version trong root package.json + packages/app/package.json
npm version 2.0.0 --workspaces

# Build installers
npm run build:electron -w @akabiz/app
npx electron-builder --win --config  # Windows
npx electron-builder --mac --config  # macOS
```

Distribute installer mới đến khách.

### Bước 8 — Post-cutover cleanup (optional, chờ ~1 tháng sau khi confident)

```bash
# Drop legacy tables (CHỈ KHI 100% confident không cần data cũ)
# UNDOABLE — backup trước khi chạy
psql $DATABASE_URL <<EOF
DROP TABLE IF EXISTS auto_runs CASCADE;
DROP TABLE IF EXISTS auto_run_steps CASCADE;
DROP TABLE IF EXISTS auto_campaign_detail_actions CASCADE;
DROP TABLE IF EXISTS auto_campaign_details CASCADE;
DROP TABLE IF EXISTS auto_campaign_actions CASCADE;
DROP TABLE IF EXISTS auto_campaigns CASCADE;
DROP TABLE IF EXISTS auto_flows CASCADE;
DROP TABLE IF EXISTS auto_workflows CASCADE;
DROP TABLE IF EXISTS auto_actions CASCADE;
DROP TABLE IF EXISTS auto_elements CASCADE;
EOF
```

## Rollback plan

Nếu phát hiện lỗi nghiêm trọng sau cutover:

```bash
# Restore Supabase từ backup
psql $DATABASE_URL < backup-YYYYMMDD.sql

# Revert git
git revert <cutover-commit-sha>

# Distribute installer v1 cho user
```

## Migration mapping reference

| Legacy table | New table(s) | Notes |
|---|---|---|
| `org_channels` | `channels` | type='browser_persistent', metadata trong health_meta |
| `auto_elements` | `named_selectors` | name normalized lowercase + underscore |
| `auto_flows` | `workflows` + `workflow_revisions` (v1) | actionType→manifestId mapping (FB actions → core.log placeholder) |
| `auto_campaigns` | `campaign_views` + `triggers` (schedule) + `datatables` | 1 datatable per campaign |
| `auto_campaign_details` | `datatable_rows` | data JSONB chứa name/phone/uid/email |
| `auto_runs` | (KHÔNG migrate) | transient log |
| `auto_run_steps` | (KHÔNG migrate) | transient log |
| `auto_campaign_detail_actions` | (KHÔNG migrate) | mới chạy sẽ ghi vào campaign_logs (vĩnh viễn) |
| `auto_workflows` | (KHÔNG migrate) | hệ cũ chưa fully use |

## Status mapping

Legacy detail status → new datatable_row status:
- `'hoàn thành'` → `'done'`
- `'lỗi'` → `'failed'`
- `'đang chạy'` → `'in_progress'`
- `'tạm dừng'` → `'skipped'`
- (other / `'chờ xử lý'`) → `'pending'`

## Troubleshooting

**Q: Migration báo "permission denied for table auto_campaigns"**  
A: Service key không có quyền. Dùng `SUPABASE_SERVICE_KEY` (service_role) thay vì anon.

**Q: Workflow chạy được trong UI nhưng action FB không đúng**  
A: actionType FB cũ map về `core.log`. Cần manual rebuild bằng primitives mới + Element Picker.

**Q: Trigger không fire**  
A: Check `triggers.is_active=true` và `next_run_at` đúng giờ. TriggerService tick 60s, có thể delay tới 1 phút.

**Q: Channel không login được**  
A: Profile path cũ không tồn tại. Tạo channel mới trong UI hoặc set `channels.profile_path` thủ công.
