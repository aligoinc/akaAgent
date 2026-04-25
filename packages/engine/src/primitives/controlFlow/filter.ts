import type { CoreBlockManifest } from '../../types/BlockManifest.js'

/**
 * core.filter — skip downstream nếu condition false (KHÔNG là error).
 *
 * Khác với core.if (có 2 branch true/false). Filter chỉ có 1 path:
 *   - condition true → continue downstream main
 *   - condition false → skip downstream main (mark as 'skipped')
 *
 * Use case: trong loop, skip iteration không match (vd `{{item.status}} === 'pending'`).
 *
 * WorkflowRunner.executeFilterNode special-case (no handler).
 */

export const filterManifest: CoreBlockManifest = {
  manifestId: 'core.filter',
  name: 'Filter',
  version: '1.0.0',
  kind: 'core',
  runtime: 'control',
  requires: 'none',
  ui: { icon: 'Filter', category: 'control', description: 'Skip downstream if condition is false' },
  inputSchema: [
    { name: 'condition', type: 'string', label: 'Condition', required: true,
      placeholder: "{{item.status}} === 'pending'", uiHint: 'textarea' }
  ],
  outputSchema: [
    { name: 'passed', type: 'boolean', label: 'Filter passed' }
  ],
  implementationKey: 'core.filter'
}
