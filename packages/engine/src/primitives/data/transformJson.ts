import type { CoreBlockManifest } from '../../types/BlockManifest.js'
import type { CoreBlockHandler, ExecuteContext } from '../../core/BlockRegistry.js'

/**
 * core.transformJson — transform via template object.
 *
 * Template support {{nodeId.field}} interpolation. WorkflowRunner.resolveNodeInput
 * đã recursive resolve template trước khi pass vào handler, nên template ở đây là
 * object đã có giá trị thực.
 *
 * Phase 3a: simple template (=passthrough sau khi interpolate).
 * Phase later: full jsonata expression cho map/filter/reduce.
 */

export const transformJsonManifest: CoreBlockManifest = {
  manifestId: 'core.transformJson',
  name: 'Transform JSON',
  version: '1.0.0',
  kind: 'core',
  runtime: 'control',
  requires: 'none',
  ui: { icon: 'Shuffle', category: 'data', description: 'Build a new object from template with {{nodeId.field}} refs' },
  inputSchema: [
    { name: 'template', type: 'json', label: 'Template object', required: true,
      uiHint: 'monaco-json',
      placeholder: '{ "name": "{{n_x.data.name}}", "count": "{{n_x.data.count}}" }' }
  ],
  outputSchema: [
    { name: 'result', type: 'json', label: 'Transformed result' }
  ],
  implementationKey: 'core.transformJson'
}

export const transformJsonHandler: CoreBlockHandler = {
  async execute(input: Record<string, unknown>, _ctx: ExecuteContext) {
    void _ctx
    if (input.template === undefined || input.template === null) {
      return { success: false, error: 'transformJson: template is required' }
    }
    return { success: true, output: { result: input.template } }
  }
}
