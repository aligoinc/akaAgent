import type { CoreBlockManifest } from '../../types/BlockManifest.js'
import type { CoreBlockHandler, ExecuteContext } from '../../core/BlockRegistry.js'

/**
 * core.log — emit log message qua ExecuteContext.log (broadcasted ra ProgressEvent kind='log').
 * Output: { message } đã emit.
 */

export const logManifest: CoreBlockManifest = {
  manifestId: 'core.log',
  name: 'Log',
  version: '1.0.0',
  kind: 'core',
  runtime: 'control',
  requires: 'none',
  ui: { icon: 'FileText', category: 'data', description: 'Emit a log message' },
  inputSchema: [
    { name: 'message', type: 'string', label: 'Message', required: true },
    { name: 'level', type: 'string', label: 'Level', defaultValue: 'info',
      options: [{ label: 'Info', value: 'info' }, { label: 'Warn', value: 'warn' }, { label: 'Error', value: 'error' }] }
  ],
  outputSchema: [
    { name: 'message', type: 'string', label: 'Message' }
  ],
  implementationKey: 'core.log'
}

export const logHandler: CoreBlockHandler = {
  async execute(input: Record<string, unknown>, ctx: ExecuteContext) {
    const message = String(input.message ?? '')
    const level = (input.level === 'warn' || input.level === 'error' ? input.level : 'info') as 'info' | 'warn' | 'error'
    ctx.log(level, message)
    return { success: true, output: { message } }
  }
}
