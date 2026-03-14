-- Actions catalog: stores reusable action definitions
CREATE TABLE auto_actions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL,           -- 'click', 'type', 'scroll', 'getValue', 'setValue', 'sleep', 'navigate', 'waitForSelector', 'screenshot', 'custom'
    description TEXT,
    icon TEXT,                    -- lucide icon name
    category TEXT NOT NULL,      -- 'interaction', 'data', 'navigation', 'control', 'utility'
    input_schema JSONB NOT NULL, -- JSON schema defining inputs
    output_schema JSONB NOT NULL,-- JSON schema defining outputs
    default_config JSONB,        -- default values
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Flows: a single flow (canvas of connected nodes)
CREATE TABLE auto_flows (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    nodes JSONB NOT NULL DEFAULT '[]',     -- React Flow nodes array
    edges JSONB NOT NULL DEFAULT '[]',     -- React Flow edges array
    variables JSONB DEFAULT '{}',          -- flow-level variables
    input_schema JSONB DEFAULT '{}',
    output_schema JSONB DEFAULT '{}',
    is_block BOOLEAN DEFAULT FALSE,        -- true = reusable block
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Workflows: combines multiple flows/blocks
CREATE TABLE auto_workflows (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    flow_steps JSONB NOT NULL DEFAULT '[]', -- ordered list of flow references + config
    input_schema JSONB DEFAULT '{}',
    output_schema JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Execution runs: log of each execution
CREATE TABLE auto_runs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    flow_id UUID REFERENCES auto_flows(id),
    workflow_id UUID REFERENCES auto_workflows(id),
    status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'running', 'completed', 'failed', 'cancelled'
    input JSONB DEFAULT '{}',
    output JSONB DEFAULT '{}',
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    error TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Step logs: detailed execution log per node
CREATE TABLE auto_run_steps (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    run_id UUID REFERENCES auto_runs(id) ON DELETE CASCADE,
    node_id TEXT NOT NULL,
    action_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    input JSONB DEFAULT '{}',
    output JSONB DEFAULT '{}',
    screenshot_url TEXT,
    error TEXT,
    duration_ms INTEGER,
    executed_at TIMESTAMPTZ DEFAULT NOW()
);
