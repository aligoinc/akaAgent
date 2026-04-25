import type { CoreBlockManifest } from '../../types/BlockManifest.js'

/**
 * core.try — wrap subgraph với try/catch handles.
 *
 * Body subgraph: nodes downstream qua handle 'try-body'.
 * After body run:
 *   - Body success → activate downstream qua handle 'try'
 *   - Body error → activate downstream qua handle 'catch' với error info
 *
 * Output:
 *   { success: bool, branch: 'try' | 'catch', error?: { message, name, nodeId? } }
 *
 * Catch handler nodes có thể đọc lỗi qua inputMapping:
 *   { sourceNodeId: 'n_try', sourceField: 'error', sourcePath: 'message' }
 *
 * LoopBreakSignal / LoopContinueSignal trong body BYPASS try — re-throw cho
 * enclosing loop. Try chỉ catch error thường.
 *
 * WorkflowRunner.executeTryNode special-case (no handler).
 */

export const tryManifest: CoreBlockManifest = {
  manifestId: 'core.try',
  name: 'Try / Catch',
  version: '1.0.0',
  kind: 'core',
  runtime: 'control',
  requires: 'none',
  ui: { icon: 'ShieldCheck', category: 'control', description: 'Wrap subgraph with error handler' },
  inputSchema: [],
  outputSchema: [
    { name: 'success', type: 'boolean', label: 'Body succeeded' },
    { name: 'branch', type: 'string', label: 'Active handle (try | catch)' },
    { name: 'error', type: 'json', label: 'Error info (when branch=catch)' }
  ],
  implementationKey: 'core.try'
}
