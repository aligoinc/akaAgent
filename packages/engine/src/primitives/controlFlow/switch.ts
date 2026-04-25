import type { CoreBlockManifest } from '../../types/BlockManifest.js'

/**
 * core.switch — multi-handle case branching.
 *
 * Config:
 *   - expression: chuỗi sẽ được interpolate (vd "{{n_a.status}}" hoặc "{{input.type}}")
 *   - cases: array of case values (string). Mỗi case sinh handle 'switch-<value>'.
 *
 * Output handle: 'switch-<value>' nếu match, fallback 'switch-default' nếu không.
 * Engine mark losing handles' downstream as skipped (giống ifElse).
 *
 * WorkflowRunner.executeSwitchNode special-case (no handler).
 */

export const switchManifest: CoreBlockManifest = {
  manifestId: 'core.switch',
  name: 'Switch',
  version: '1.0.0',
  kind: 'core',
  runtime: 'control',
  requires: 'none',
  ui: { icon: 'GitFork', category: 'control', description: 'Branch on a value (multi-case)' },
  inputSchema: [
    { name: 'expression', type: 'string', label: 'Expression', required: true,
      placeholder: '{{n_a.status}}', uiHint: 'textarea' },
    { name: 'cases', type: 'array', label: 'Case values',
      itemSchema: { name: 'value', type: 'string', label: 'Case value' },
      placeholder: '["pending", "running", "done"]' }
  ],
  outputSchema: [
    { name: 'value', type: 'any', label: 'Resolved expression value' },
    { name: 'branch', type: 'string', label: 'Active handle (vd switch-pending)' },
    { name: 'matched', type: 'boolean', label: 'true nếu khớp 1 case, false nếu default' }
  ],
  implementationKey: 'core.switch'
}
