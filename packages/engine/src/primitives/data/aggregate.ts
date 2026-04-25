import type { CoreBlockManifest } from '../../types/BlockManifest.js'

/**
 * core.aggregate — collect outputs từ tất cả incoming edges thành array.
 *
 * Output:
 *   - items: array của output mỗi incoming source (raw outputs nguyên trạng)
 *   - count: số incoming edges
 *
 * Use case: gom kết quả từ nhiều branch song song hoặc nhiều iteration của loop
 * trước khi tiếp tục downstream.
 *
 * WorkflowRunner.executeAggregateNode special-case (no handler) — đọc tất cả
 * incoming edges của node này và collect outputs từ context.
 */

export const aggregateManifest: CoreBlockManifest = {
  manifestId: 'core.aggregate',
  name: 'Aggregate',
  version: '1.0.0',
  kind: 'core',
  runtime: 'control',
  requires: 'none',
  ui: { icon: 'Layers', category: 'data', description: 'Collect outputs from multiple incoming branches' },
  inputSchema: [],
  outputSchema: [
    { name: 'items', type: 'array', label: 'Outputs from each incoming branch' },
    { name: 'count', type: 'number', label: 'Number of incoming branches' }
  ],
  implementationKey: 'core.aggregate'
}
