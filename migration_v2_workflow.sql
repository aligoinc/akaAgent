-- ============================================================
-- Migration: Workflow System v2
-- Generated: 2026-04-26
--
-- Mục tiêu: tạo các bảng auto_v2_* SONG SONG bảng cũ
--   (auto_flows / auto_runs / auto_run_steps / auto_actions / auto_elements).
--
-- Mô hình mới:
--   - auto_v2_blocks    : block library (mỗi block = JS code chạy trong sandbox)
--   - auto_v2_workflows : DAG of block instances (nodes + edges)
--   - auto_v2_elements  : XPath snippets reusable (helpers.element('name'))
--   - auto_v2_runs      : workflow execution history
--   - auto_v2_run_steps : per-block-step status & I/O
--
-- ID strategy: BIGSERIAL cho mọi bảng. Built-in record dùng UNIQUE(name)
-- cho seed idempotent (ON CONFLICT name DO UPDATE).
--
-- Liên kết với hệ thống cũ:
--   ALTER TABLE auto_campaign_actions ADD COLUMN workflow_v2_id BIGINT
--   → scheduler branch: nếu workflow_v2_id NOT NULL thì chạy engine v2,
--   ngược lại chạy engine cũ.
--
-- Sau khi engine v2 stable: drop bảng cũ + cột workflow_id (UUID).
-- ============================================================

BEGIN;

-- ============================================================
-- 1. auto_v2_blocks — block library
-- ============================================================
CREATE TABLE IF NOT EXISTS public.auto_v2_blocks (
  id BIGSERIAL PRIMARY KEY,
  name text NOT NULL UNIQUE,                       -- UNIQUE → seed idempotent ON CONFLICT(name)
  description text,
  icon text,                                       -- lucide icon name
  category text NOT NULL,                          -- navigation|interaction|data|utility|control|facebook|custom
  kind text NOT NULL DEFAULT 'js',                 -- js | system
  system_type text,                                -- ifElse|loop|parallel|merge (chỉ khi kind=system)
  code text NOT NULL DEFAULT '',                   -- JS source. System block để rỗng.
  config_schema jsonb NOT NULL DEFAULT '[]'::jsonb,
  output_schema jsonb NOT NULL DEFAULT '[]'::jsonb,
  default_config jsonb DEFAULT '{}'::jsonb,
  is_builtin boolean NOT NULL DEFAULT false,
  staff_id bigint,
  organization_id bigint,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_v2_blocks_category ON public.auto_v2_blocks(category);
CREATE INDEX IF NOT EXISTS idx_v2_blocks_staff ON public.auto_v2_blocks(staff_id);
CREATE INDEX IF NOT EXISTS idx_v2_blocks_builtin ON public.auto_v2_blocks(is_builtin);

COMMENT ON TABLE public.auto_v2_blocks IS 'Block library v2 — mỗi block là JS code chạy trong sandbox vm.createContext';
COMMENT ON COLUMN public.auto_v2_blocks.kind IS 'js = code thường; system = ifElse/loop/parallel/merge (runtime xử lý đặc biệt, code rỗng)';
COMMENT ON COLUMN public.auto_v2_blocks.config_schema IS 'Array of {name, type, label, required, default, placeholder, options} — define UI form';
COMMENT ON COLUMN public.auto_v2_blocks.output_schema IS 'Doc-only: hint cho Monaco autocomplete cho block downstream';

-- ============================================================
-- 2. auto_v2_workflows — DAG of block instances
-- ============================================================
CREATE TABLE IF NOT EXISTS public.auto_v2_workflows (
  id BIGSERIAL PRIMARY KEY,
  name text NOT NULL UNIQUE,                       -- UNIQUE cho built-in idempotent
  description text,
  nodes jsonb NOT NULL DEFAULT '[]'::jsonb,        -- WorkflowNode[]
  edges jsonb NOT NULL DEFAULT '[]'::jsonb,        -- WorkflowEdge[]
  variables_schema jsonb DEFAULT '[]'::jsonb,      -- doc cho variables scheduler inject
  default_variables jsonb DEFAULT '{}'::jsonb,     -- mock cho test trong editor
  is_builtin boolean NOT NULL DEFAULT false,
  staff_id bigint,
  organization_id bigint,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_v2_workflows_staff ON public.auto_v2_workflows(staff_id);
CREATE INDEX IF NOT EXISTS idx_v2_workflows_builtin ON public.auto_v2_workflows(is_builtin);

COMMENT ON TABLE public.auto_v2_workflows IS 'Workflow v2 — DAG of block instances với parallel + AND/OR join';
COMMENT ON COLUMN public.auto_v2_workflows.nodes IS 'WorkflowNode[]: {id, blockId, blockName, position, config, codeOverride?, label?, systemType?}';
COMMENT ON COLUMN public.auto_v2_workflows.edges IS 'WorkflowEdge[]: {id, source, target, sourceHandle?, targetHandle?, label?}';
COMMENT ON COLUMN public.auto_v2_workflows.variables_schema IS 'Doc cho variables scheduler inject (campaignContent, detailUid, images, ...)';

-- ============================================================
-- 3. auto_v2_elements — XPath snippets reusable
-- ============================================================
CREATE TABLE IF NOT EXISTS public.auto_v2_elements (
  id BIGSERIAL PRIMARY KEY,
  name text NOT NULL UNIQUE,                       -- ví dụ: 'fb_composer_dialog', 'fb_post_button'
  xpath text NOT NULL,
  description text,
  category text,                                   -- 'facebook' | 'common' | 'custom'
  is_builtin boolean NOT NULL DEFAULT false,
  staff_id bigint,
  organization_id bigint,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_v2_elements_category ON public.auto_v2_elements(category);
CREATE INDEX IF NOT EXISTS idx_v2_elements_staff ON public.auto_v2_elements(staff_id);

COMMENT ON TABLE public.auto_v2_elements IS 'XPath snippets reusable. Block JS dùng helpers.element(name) → query cached → trả xpath. Edit 1 lần áp dụng cho mọi block.';

-- ============================================================
-- 4. auto_v2_runs — workflow execution history
-- ============================================================
CREATE TABLE IF NOT EXISTS public.auto_v2_runs (
  id BIGSERIAL PRIMARY KEY,
  workflow_id bigint,
  campaign_id bigint,
  campaign_detail_id bigint,
  channel_id bigint,
  status text NOT NULL DEFAULT 'pending',          -- pending|running|completed|failed|cancelled
  variables jsonb DEFAULT '{}'::jsonb,             -- snapshot variables tại thời điểm chạy
  output jsonb DEFAULT '{}'::jsonb,
  error text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_v2_runs_campaign ON public.auto_v2_runs(campaign_id);
CREATE INDEX IF NOT EXISTS idx_v2_runs_workflow ON public.auto_v2_runs(workflow_id);
CREATE INDEX IF NOT EXISTS idx_v2_runs_status ON public.auto_v2_runs(status);

COMMENT ON TABLE public.auto_v2_runs IS 'Workflow execution history v2 — 1 row per workflow invocation (per detail trong campaign loop)';

-- ============================================================
-- 5. auto_v2_run_steps — per-block-step status & I/O
-- ============================================================
CREATE TABLE IF NOT EXISTS public.auto_v2_run_steps (
  id BIGSERIAL PRIMARY KEY,
  run_id bigint NOT NULL REFERENCES public.auto_v2_runs(id) ON DELETE CASCADE,
  node_id text NOT NULL,                           -- WorkflowNode.id (user-set string)
  block_id bigint,
  block_name text,                                 -- denormalized cho lúc xem history (block có thể bị xóa)
  status text NOT NULL,                            -- running|success|error|skipped
  input jsonb DEFAULT '{}'::jsonb,
  output jsonb DEFAULT '{}'::jsonb,
  error text,
  duration_ms integer,
  started_at timestamptz,
  completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_v2_run_steps_run ON public.auto_v2_run_steps(run_id);
CREATE INDEX IF NOT EXISTS idx_v2_run_steps_node ON public.auto_v2_run_steps(run_id, node_id);
CREATE INDEX IF NOT EXISTS idx_v2_run_steps_block_name ON public.auto_v2_run_steps(run_id, block_name);

COMMENT ON TABLE public.auto_v2_run_steps IS 'Per-block step trace v2. Scheduler scan theo block_name để biết milestone nào succeeded.';

-- ============================================================
-- 6. ALTER auto_campaign_actions: thêm cột workflow_v2_id
-- ============================================================
ALTER TABLE public.auto_campaign_actions
  ADD COLUMN IF NOT EXISTS workflow_v2_id bigint;

COMMENT ON COLUMN public.auto_campaign_actions.workflow_v2_id IS 'FK auto_v2_workflows.id. Nếu NOT NULL thì scheduler chạy engine v2; nếu NULL thì fallback workflow_id (UUID, engine cũ).';

COMMIT;
