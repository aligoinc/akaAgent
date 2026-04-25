import type { CoreBlockManifest } from '../../types/BlockManifest.js'
import type { CoreBlockHandler, ExecuteContext } from '../../core/BlockRegistry.js'

/**
 * core.input — workflow entry. Output toàn bộ workflow input như object.
 * Downstream node lấy field cụ thể qua inputMapping { sourceNodeId: 'n_input', sourceField: 'X' }
 * hoặc qua interpolate {{n_input.X}}.
 */

export const inputManifest: CoreBlockManifest = {
  manifestId: 'core.input',
  name: 'Workflow Input',
  version: '1.0.0',
  kind: 'core',
  runtime: 'control',
  requires: 'none',
  ui: { icon: 'LogIn', category: 'workflow', description: 'Entry point — exposes workflow input' },
  inputSchema: [],
  outputSchema: [{ name: '*', type: 'any', label: 'All input fields' }],
  implementationKey: 'core.input'
}

export const inputHandler: CoreBlockHandler = {
  async execute(_input: Record<string, unknown>, ctx: ExecuteContext) {
    void ctx
    // Output là toàn bộ workflow input — runner truyền vào input arg là chính workflow.input
    return { success: true, output: _input }
  }
}
