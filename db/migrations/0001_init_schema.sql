-- =====================================================================
-- akaBiz Auto v2 — initial schema
-- 11 tables: blocks, workflows, workflow_revisions, channels, connections,
--            triggers, runs, run_steps, datatables, datatable_rows,
--            named_selectors, campaign_views, campaign_logs, step_forensics
-- =====================================================================
-- Phase 1 of migration roadmap.
-- Apply trên Supabase test workspace TRƯỚC, KHÔNG đụng prod.
-- =====================================================================

-- Required extensions: pgcrypto (gen_random_uuid) — already installed on Supabase ----

-- =====================================================================
-- 1. BLOCK CATALOG
-- =====================================================================
CREATE TABLE IF NOT EXISTS blocks (
  manifest_id     TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  version         TEXT NOT NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('core', 'adapter', 'code', 'composite')),
  runtime         TEXT NOT NULL CHECK (runtime IN ('control', 'page', 'node', 'composite')),
  requires        TEXT NOT NULL CHECK (requires IN ('browser', 'none')),
  manifest        JSONB NOT NULL,
  code            TEXT,
  workflow_ref    UUID,
  source          TEXT CHECK (source IN ('system', 'user', 'ai', 'imported')),
  organization_id INT,
  created_by      INT,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS blocks_kind_idx ON blocks (kind);
CREATE INDEX IF NOT EXISTS blocks_org_idx ON blocks (organization_id);

-- =====================================================================
-- 2. WORKFLOWS + REVISIONS
-- =====================================================================
CREATE TABLE IF NOT EXISTS workflows (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  description     TEXT,
  is_active       BOOLEAN DEFAULT true,
  is_block        BOOLEAN DEFAULT false,
  current_version INT DEFAULT 1,
  organization_id INT,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS workflows_org_idx ON workflows (organization_id);
CREATE INDEX IF NOT EXISTS workflows_is_block_idx ON workflows (is_block) WHERE is_block = true;

CREATE TABLE IF NOT EXISTS workflow_revisions (
  workflow_id   UUID REFERENCES workflows(id) ON DELETE CASCADE,
  version       INT NOT NULL,
  graph         JSONB NOT NULL,
  notes         TEXT,
  is_published  BOOLEAN DEFAULT false,
  created_by    INT,
  created_at    TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (workflow_id, version)
);
CREATE INDEX IF NOT EXISTS wr_published_idx ON workflow_revisions (workflow_id, is_published) WHERE is_published = true;

-- =====================================================================
-- 3. CHANNELS (browser sessions) — KEY DIFFERENTIATOR
-- =====================================================================
CREATE TABLE IF NOT EXISTS channels (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  channel_type    TEXT NOT NULL CHECK (channel_type IN ('browser_persistent', 'browser_ephemeral', 'headless_node')),
  profile_path    TEXT,
  user_agent      TEXT,
  locale          TEXT,
  timezone        TEXT,
  proxy_url       TEXT,
  status          TEXT DEFAULT 'idle' CHECK (status IN ('idle', 'busy', 'logged_out', 'banned', 'maintenance')),
  health_meta     JSONB,
  organization_id INT,
  last_used_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS channels_org_idx ON channels (organization_id);
CREATE INDEX IF NOT EXISTS channels_status_idx ON channels (status);

-- Default headless_node row (for workflows không cần browser) ---------
INSERT INTO channels (id, name, channel_type, status)
VALUES ('00000000-0000-0000-0000-000000000001', 'Headless Node (system)', 'headless_node', 'idle')
ON CONFLICT (id) DO NOTHING;

-- =====================================================================
-- 4. CONNECTIONS (encrypted credentials)
-- =====================================================================
CREATE TABLE IF NOT EXISTS connections (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  conn_type       TEXT NOT NULL CHECK (conn_type IN ('oauth2', 'apikey', 'basicauth', 'cookie', 'custom')),
  data_encrypted  BYTEA NOT NULL,
  scope           JSONB,
  organization_id INT,
  created_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS conn_org_idx ON connections (organization_id);

-- =====================================================================
-- 5. TRIGGERS
-- =====================================================================
CREATE TABLE IF NOT EXISTS triggers (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id           UUID REFERENCES workflows(id) ON DELETE CASCADE,
  workflow_version      INT,
  channel_id            UUID REFERENCES channels(id),
  channel_pool          UUID[],
  channel_assignment    TEXT DEFAULT 'round_robin' CHECK (channel_assignment IN ('round_robin', 'least_busy', 'sticky_by_row_hash')),
  datatable_id          UUID,
  datatable_filter      JSONB,
  kind                  TEXT NOT NULL CHECK (kind IN ('manual', 'schedule', 'webhook', 'event')),
  config                JSONB NOT NULL,
  settings              JSONB,
  is_active             BOOLEAN DEFAULT true,
  next_run_at           TIMESTAMPTZ,
  last_run_at           TIMESTAMPTZ,
  last_run_status       TEXT,
  consecutive_failures  INT DEFAULT 0,
  organization_id       INT,
  created_at            TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS trg_next_run_idx ON triggers (next_run_at) WHERE is_active = true AND kind = 'schedule';
CREATE INDEX IF NOT EXISTS trg_workflow_idx ON triggers (workflow_id);
CREATE INDEX IF NOT EXISTS trg_org_idx ON triggers (organization_id);

-- =====================================================================
-- 6. RUNS + RUN_STEPS
-- =====================================================================
CREATE TABLE IF NOT EXISTS runs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id       UUID NOT NULL,
  workflow_version  INT NOT NULL,
  trigger_id        UUID,
  channel_id        UUID,
  datatable_row_id  UUID,
  status            TEXT NOT NULL CHECK (status IN ('queued', 'running', 'paused', 'completed', 'failed', 'cancelled', 'skipped')),
  input             JSONB,
  output            JSONB,
  error             TEXT,
  started_at        TIMESTAMPTZ,
  finished_at       TIMESTAMPTZ,
  duration_ms       INT,
  retry_of_run      UUID,
  organization_id   INT,
  created_at        TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS runs_workflow_idx ON runs (workflow_id, started_at DESC);
CREATE INDEX IF NOT EXISTS runs_trigger_idx ON runs (trigger_id, started_at DESC);
CREATE INDEX IF NOT EXISTS runs_channel_idx ON runs (channel_id, started_at DESC);
CREATE INDEX IF NOT EXISTS runs_row_idx ON runs (datatable_row_id, started_at DESC);
CREATE INDEX IF NOT EXISTS runs_status_idx ON runs (status) WHERE status IN ('queued', 'running', 'paused');

CREATE TABLE IF NOT EXISTS run_steps (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id                  UUID REFERENCES runs(id) ON DELETE CASCADE,
  node_id                 TEXT NOT NULL,
  manifest_id             TEXT NOT NULL,
  status                  TEXT NOT NULL CHECK (status IN ('pending', 'running', 'success', 'error', 'skipped', 'cancelled')),
  input                   JSONB,
  output                  JSONB,
  error                   TEXT,
  attempt                 INT DEFAULT 1,
  started_at              TIMESTAMPTZ,
  finished_at             TIMESTAMPTZ,
  duration_ms             INT,
  reporting_label         TEXT,
  reporting_tags          TEXT[],
  log_messages            JSONB,
  screenshot_before_path  TEXT,
  screenshot_after_path   TEXT
);
CREATE INDEX IF NOT EXISTS rs_run_idx ON run_steps (run_id, started_at);
CREATE INDEX IF NOT EXISTS rs_reporting_idx ON run_steps (run_id) WHERE reporting_label IS NOT NULL;

-- =====================================================================
-- 7. DATATABLES + ROWS (replace campaign_details cũ)
-- =====================================================================
CREATE TABLE IF NOT EXISTS datatables (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  schema          JSONB NOT NULL,
  description     TEXT,
  organization_id INT,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS datatable_rows (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  datatable_id    UUID REFERENCES datatables(id) ON DELETE CASCADE,
  data            JSONB NOT NULL,
  status          TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'done', 'failed', 'skipped')),
  last_run_id     UUID,
  last_run_at     TIMESTAMPTZ,
  retry_count     INT DEFAULT 0,
  tags            TEXT[],
  organization_id INT,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS dtr_status_idx ON datatable_rows (datatable_id, status, created_at);
CREATE INDEX IF NOT EXISTS dtr_org_idx ON datatable_rows (organization_id);

-- =====================================================================
-- 8. NAMED SELECTORS (UI-managed selector library)
-- =====================================================================
CREATE TABLE IF NOT EXISTS named_selectors (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name              TEXT NOT NULL,
  domain            TEXT,
  description       TEXT,
  selector_type     TEXT NOT NULL CHECK (selector_type IN ('css', 'xpath', 'text-match')),
  expression        TEXT NOT NULL,
  fallbacks         JSONB,
  last_verified_at  TIMESTAMPTZ,
  organization_id   INT,
  created_by        INT,
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ,
  UNIQUE (organization_id, name)
);
CREATE INDEX IF NOT EXISTS ns_domain_idx ON named_selectors (domain);

-- =====================================================================
-- 9. CAMPAIGN_VIEWS (UI grouping wrapper, optional)
-- =====================================================================
CREATE TABLE IF NOT EXISTS campaign_views (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  description     TEXT,
  workflow_id     UUID,
  trigger_id      UUID,
  datatable_id    UUID,
  organization_id INT,
  created_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cv_org_idx ON campaign_views (organization_id);

-- =====================================================================
-- 10. CAMPAIGN_LOGS — user-facing milestone log, NEVER DELETE
-- =====================================================================
CREATE TABLE IF NOT EXISTS campaign_logs (
  id                BIGSERIAL PRIMARY KEY,
  campaign_view_id  UUID,
  workflow_id       UUID NOT NULL,
  run_id            UUID NOT NULL,
  datatable_row_id  UUID,
  ts                TIMESTAMPTZ DEFAULT now(),
  level             TEXT NOT NULL CHECK (level IN ('info', 'success', 'warn', 'error')),
  icon              TEXT,
  message           TEXT NOT NULL,
  meta              JSONB,
  organization_id   INT
);
CREATE INDEX IF NOT EXISTS cl_campaign_idx ON campaign_logs (campaign_view_id, ts DESC);
CREATE INDEX IF NOT EXISTS cl_row_idx ON campaign_logs (datatable_row_id, ts DESC);
CREATE INDEX IF NOT EXISTS cl_workflow_idx ON campaign_logs (workflow_id, ts DESC);
CREATE INDEX IF NOT EXISTS cl_run_idx ON campaign_logs (run_id, ts);
-- KHÔNG có cleanup. Backup hàng tháng dump → S3.

-- =====================================================================
-- 11. STEP_FORENSICS — debug data per step, TTL 30 ngày
-- =====================================================================
CREATE TABLE IF NOT EXISTS step_forensics (
  step_id       UUID PRIMARY KEY REFERENCES run_steps(id) ON DELETE CASCADE,
  dom_html_gz   BYTEA,
  network_har   JSONB,
  console_logs  JSONB,
  page_url      TEXT,
  viewport      JSONB,
  created_at    TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sf_created_idx ON step_forensics (created_at);
-- Cleanup nightly: DELETE WHERE created_at < NOW() - INTERVAL '30 days'

-- =====================================================================
-- DONE — verify với:
--   SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name;
-- =====================================================================
