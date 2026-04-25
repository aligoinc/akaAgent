import type { CoreBlockManifest } from '../../types/BlockManifest.js'

/**
 * core.if — control flow. WorkflowRunner xử lý đặc biệt (executeIfNode) thay vì handler.
 * Manifest chỉ cần để Block Library hiển thị + ConfigPanel sinh form.
 *
 * Output handles: 'if-true' và 'if-false' (engine activate downstream theo handle).
 */

export const ifManifest: CoreBlockManifest = {
  manifestId: 'core.if',
  name: 'If / Else',
  version: '1.0.0',
  kind: 'core',
  runtime: 'control',
  requires: 'none',
  ui: { icon: 'GitBranch', category: 'control', description: 'Branch based on a condition' },
  inputSchema: [
    {
      name: 'condition',
      type: 'string',
      label: 'Condition',
      required: true,
      placeholder: "{{n_a.status}} === 'pending'",
      uiHint: 'textarea'
    }
  ],
  outputSchema: [
    { name: 'result', type: 'boolean', label: 'Result' },
    { name: 'branch', type: 'string', label: 'Branch taken' }
  ],
  implementationKey: 'core.if'
}
