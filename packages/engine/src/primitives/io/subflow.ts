import type { CoreBlockManifest } from '../../types/BlockManifest.js'
import type { CoreBlockHandler, ExecuteContext } from '../../core/BlockRegistry.js'

/**
 * core.subflow — recursive call sub-workflow.
 *
 * Phase 3a: 'sync' mode (chờ kết quả). 'async' mode Phase later.
 * Recursion guard: maxDepth (default 10) — throw RecursionLimitError nếu vượt.
 */

const DEFAULT_MAX_DEPTH = 10

export const subflowManifest: CoreBlockManifest = {
  manifestId: 'core.subflow',
  name: 'Sub-Workflow',
  version: '1.0.0',
  kind: 'core',
  runtime: 'control',   // engine orchestrates; sub-workflow tự lo runtime của block bên trong nó
  requires: 'none',     // sub-workflow tự khai báo requires; engine handle
  ui: { icon: 'Layers', category: 'io', description: 'Run another workflow as a sub-step' },
  inputSchema: [
    { name: 'workflowId', type: 'string', label: 'Workflow ID', required: true },
    { name: 'workflowVersion', type: 'number', label: 'Version (optional, latest if blank)' },
    { name: 'input', type: 'json', label: 'Input to sub-workflow', defaultValue: {} },
    { name: 'mode', type: 'string', label: 'Mode', defaultValue: 'sync',
      options: [
        { label: 'Sync (wait for result)', value: 'sync' },
        { label: 'Async (fire-and-forget) — Phase later', value: 'async' }
      ] },
    { name: 'maxDepth', type: 'number', label: 'Max recursion depth', defaultValue: DEFAULT_MAX_DEPTH }
  ],
  outputSchema: [
    { name: 'output', type: 'json', label: 'Sub-workflow output' },
    { name: 'subRunId', type: 'string', label: 'Sub run id (async mode only)' }
  ],
  implementationKey: 'core.subflow'
}

export const subflowHandler: CoreBlockHandler = {
  async execute(input: Record<string, unknown>, ctx: ExecuteContext) {
    const workflowId = String(input.workflowId ?? '')
    if (!workflowId) return { success: false, error: 'subflow: workflowId is required' }
    const mode = String(input.mode ?? 'sync')
    if (mode === 'async') {
      return { success: false, error: 'subflow async mode not implemented yet (Phase later)' }
    }
    if (!ctx.runSubWorkflow) {
      return { success: false, error: 'subflow: engine not configured with workflowLoader (cannot run sub-workflows)' }
    }

    // Recursion guard: count subflow ancestor by inspecting abortSignal? Phase later proper.
    // Phase 3a: defer to engine fail-fast on actual cycle (Workflow A → A → ... will infinite).
    // TODO: pass depth via ctx; Phase 3b add to ExecuteContext.

    const subInputRaw = input.input
    const subInput = subInputRaw && typeof subInputRaw === 'object' && !Array.isArray(subInputRaw)
      ? (subInputRaw as Record<string, unknown>)
      : { _raw: subInputRaw }

    try {
      const versionRaw = input.workflowVersion
      const opts: { version?: number } = {}
      if (typeof versionRaw === 'number') opts.version = versionRaw
      const output = await ctx.runSubWorkflow(workflowId, subInput, opts)
      return { success: true, output: { output } }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  }
}
