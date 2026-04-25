import type { CoreBlockManifest } from '../../types/BlockManifest.js'
import type { CoreBlockHandler, ExecuteContext } from '../../core/BlockRegistry.js'

/**
 * core.setVariable — output `{ value }` từ config.value (đã interpolate).
 * Dùng cho hard-coded constants hoặc compute từ scope.
 */

export const setVariableManifest: CoreBlockManifest = {
  manifestId: 'core.setVariable',
  name: 'Set Variable',
  version: '1.0.0',
  kind: 'core',
  runtime: 'control',
  requires: 'none',
  ui: { icon: 'Variable', category: 'data', description: 'Set a variable value' },
  inputSchema: [
    { name: 'value', type: 'any', label: 'Value', required: true }
  ],
  outputSchema: [
    { name: 'value', type: 'any', label: 'Value' }
  ],
  implementationKey: 'core.setVariable'
}

export const setVariableHandler: CoreBlockHandler = {
  async execute(input: Record<string, unknown>, _ctx: ExecuteContext) {
    void _ctx
    return { success: true, output: { value: input.value } }
  }
}
