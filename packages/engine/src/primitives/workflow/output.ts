import type { CoreBlockManifest } from '../../types/BlockManifest.js'
import type { CoreBlockHandler, ExecuteContext } from '../../core/BlockRegistry.js'

/**
 * core.output — workflow exit. Output mapping → workflow.output.
 * WorkflowRunner.run() đọc output của node manifestId='core.output' làm final output.
 */

export const outputManifest: CoreBlockManifest = {
  manifestId: 'core.output',
  name: 'Workflow Output',
  version: '1.0.0',
  kind: 'core',
  runtime: 'control',
  requires: 'none',
  ui: { icon: 'LogOut', category: 'workflow', description: 'Exit point — collects output fields' },
  inputSchema: [{ name: '*', type: 'any', label: 'Output fields (mapped)' }],
  outputSchema: [],
  implementationKey: 'core.output'
}

export const outputHandler: CoreBlockHandler = {
  async execute(input: Record<string, unknown>, _ctx: ExecuteContext) {
    void _ctx
    return { success: true, output: input }
  }
}
