# DB Migrations

Schema mới cho akaBiz Auto v2. **Apply trên Supabase test workspace TRƯỚC**, không động prod cho đến Phase 13 (cutover).

## Files

- `migrations/0001_init_schema.sql` — 11 bảng init: blocks, workflows + workflow_revisions, channels, connections, triggers, runs + run_steps, datatables + datatable_rows, named_selectors, campaign_views, campaign_logs, step_forensics

## Apply

Cách 1 — Supabase MCP:
```
mcp__supabase__apply_migration name="init_v2_schema" query="<paste 0001_init_schema.sql>"
```

Cách 2 — Supabase CLI:
```bash
supabase db push --db-url $TEST_DB_URL
```

## Verify

```sql
SELECT table_name FROM information_schema.tables 
WHERE table_schema='public' ORDER BY table_name;
```

Phải thấy đủ 12 bảng (11 bảng + workflow_revisions composite key).

## Migration data từ schema cũ → mới

Phase 13 (cutover) sẽ có script migrate. Hiện tại schema mới chạy song song schema cũ (`auto_*` tables) trên cùng database test, không xung đột tên.
