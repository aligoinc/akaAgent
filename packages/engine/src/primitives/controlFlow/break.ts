import type { CoreBlockManifest } from '../../types/BlockManifest.js'

/**
 * core.break — exit nearest enclosing loop (jump to loop-done handle).
 * Chỉ valid bên trong loop body. WorkflowRunner ném LoopBreakSignal,
 * loop executor catch.
 *
 * No handler — runner special-case throw signal.
 */

export const breakManifest: CoreBlockManifest = {
  manifestId: 'core.break',
  name: 'Break',
  version: '1.0.0',
  kind: 'core',
  runtime: 'control',
  requires: 'none',
  ui: { icon: 'CircleStop', category: 'control', description: 'Exit the nearest enclosing loop' },
  inputSchema: [],
  outputSchema: [
    { name: 'signal', type: 'string', label: 'Signal kind' }
  ],
  implementationKey: 'core.break'
}
