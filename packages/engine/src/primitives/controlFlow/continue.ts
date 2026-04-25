import type { CoreBlockManifest } from '../../types/BlockManifest.js'

/**
 * core.continue — skip rest of current iteration body, move to next.
 * Chỉ valid bên trong loop body. WorkflowRunner ném LoopContinueSignal,
 * loop executor catch.
 *
 * No handler — runner special-case throw signal.
 */

export const continueManifest: CoreBlockManifest = {
  manifestId: 'core.continue',
  name: 'Continue',
  version: '1.0.0',
  kind: 'core',
  runtime: 'control',
  requires: 'none',
  ui: { icon: 'SkipForward', category: 'control', description: 'Skip to next iteration of enclosing loop' },
  inputSchema: [],
  outputSchema: [
    { name: 'signal', type: 'string', label: 'Signal kind' }
  ],
  implementationKey: 'core.continue'
}
