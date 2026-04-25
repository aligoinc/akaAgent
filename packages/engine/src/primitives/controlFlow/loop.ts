import type { CoreBlockManifest } from '../../types/BlockManifest.js'

/**
 * core.loop — iterate body N lần.
 *
 * 3 modes:
 *   - `count`: items = [0..count-1]
 *   - `forEach`: items từ array (hoặc JSON string parse được thành array)
 *   - `while`: condition string evaluated mỗi iteration, max maxIterations
 *
 * onIterationError:
 *   - 'continue' (default): skip iteration lỗi, log, continue
 *   - 'break': dừng loop, exit qua handle 'loop-done'
 *   - 'fail': throw error fail toàn workflow
 *
 * Body subgraph: nodes downstream qua handle 'loop-body'.
 * Loop-done handle: nodes downstream qua 'loop-done' (chạy sau loop kết thúc).
 *
 * Variables exposed cho body iteration: {{item}}, {{index}}, {{iteration}},
 * {{loop.item}}, {{loop.index}}, {{loop.iteration}}.
 *
 * WorkflowRunner.executeLoopNode special-case (no handler).
 */

export const loopManifest: CoreBlockManifest = {
  manifestId: 'core.loop',
  name: 'Loop',
  version: '1.0.0',
  kind: 'core',
  runtime: 'control',
  requires: 'none',
  ui: { icon: 'Repeat', category: 'control', description: 'Loop body N times (count / forEach / while)' },
  inputSchema: [
    { name: 'loopType', type: 'string', label: 'Loop type', required: true, defaultValue: 'forEach',
      options: [
        { label: 'forEach (iterate array)', value: 'forEach' },
        { label: 'count (1..N)', value: 'count' },
        { label: 'while (condition)', value: 'while' }
      ] },
    { name: 'items', type: 'array', label: 'Items (forEach)' },
    { name: 'count', type: 'number', label: 'Count (count mode)' },
    { name: 'condition', type: 'string', label: 'Condition (while mode)',
      placeholder: '{{n_x.value}} < 10', uiHint: 'textarea' },
    { name: 'maxIterations', type: 'number', label: 'Max iterations (while)', defaultValue: 10000 },
    { name: 'onIterationError', type: 'string', label: 'On iteration error', defaultValue: 'continue',
      options: [
        { label: 'Continue (skip lỗi, tiếp iteration)', value: 'continue' },
        { label: 'Break (dừng loop)', value: 'break' },
        { label: 'Fail (fail workflow)', value: 'fail' }
      ] }
  ],
  outputSchema: [
    { name: 'iterations', type: 'number', label: 'Total iterations attempted' },
    { name: 'successCount', type: 'number', label: 'Successful iterations' },
    { name: 'errorCount', type: 'number', label: 'Failed iterations' },
    { name: 'completed', type: 'boolean', label: 'Loop ran to completion (no break)' },
    { name: 'results', type: 'array', label: 'Per-iteration outputs (debug)' }
  ],
  implementationKey: 'core.loop'
}
