/**
 * BlockManifest — contract cho mọi block (core, adapter, code, composite).
 *
 * 4 kinds:
 * - 'core'      : built-in primitive (engine implementation, không sandbox)
 * - 'adapter'   : pre-built code wrap REST API service (Slack, Gmail, ...). KHÔNG dùng cho web automation site cụ thể.
 * - 'code'      : user/AI viết JS, sandbox theo runtime
 * - 'composite' : wrap 1 sub-workflow thành block tái dùng
 */

export type BlockKind = 'core' | 'adapter' | 'code' | 'composite'

/**
 * Runtime quyết định nơi block thực thi:
 * - 'control'  : engine code chạy trong main process, không sandbox (core primitives, adapter, composite)
 * - 'page'     : chạy trong webview của Channel qua executeJavaScript (truy cập DOM + cookie user)
 * - 'node'     : chạy trong main process Node.js qua isolated-vm sandbox
 * - 'composite': trỏ đến 1 workflow khác, engine recursive execute
 */
export type BlockRuntime = 'control' | 'page' | 'node' | 'composite'

/**
 * Block có cần Channel (browser session) không?
 * - 'browser': cần channel (page-runtime, hoặc browser primitive như click/type)
 * - 'none'   : không cần (control flow, http, node code, transform)
 */
export type BlockRequires = 'browser' | 'none'

export type FieldType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'json'
  | 'any'
  | 'array'
  | 'element'
  | 'connection'
  | 'datatable'
  | 'selector'

export interface BlockIOField {
  name: string
  type: FieldType
  label: string
  description?: string
  required?: boolean
  defaultValue?: unknown
  placeholder?: string
  options?: Array<{ label: string; value: string }>
  itemSchema?: BlockIOField
  connectionType?: string
  uiHint?: 'textarea' | 'monaco-js' | 'monaco-json' | 'cron' | 'selector-picker'
}

export interface BlockPermissions {
  domains?: string[]
  modules?: string[]
  fsRead?: string[]
  fsWrite?: string[]
  timeoutMs?: number
  memoryMb?: number
}

export interface RetryPolicy {
  maxAttempts?: number
  backoffMs?: number
  backoffStrategy?: 'fixed' | 'exponential'
  retryOn?: Array<'always' | 'timeout' | 'network' | 'http5xx'>
}

export interface BlockUI {
  icon: string
  color?: string
  category: string
  description: string
  docsUrl?: string
}

export interface BlockManifestBase {
  manifestId: string
  name: string
  version: string
  kind: BlockKind
  runtime: BlockRuntime
  requires: BlockRequires
  ui: BlockUI
  inputSchema: BlockIOField[]
  outputSchema: BlockIOField[]
  defaultConfig?: Record<string, unknown>
  permissions?: BlockPermissions
  retry?: RetryPolicy
  deprecated?: boolean
  replacedBy?: string
}

export interface CoreBlockManifest extends BlockManifestBase {
  kind: 'core'
  runtime: 'control' | 'page'
  implementationKey: string
}

export interface AdapterBlockManifest extends BlockManifestBase {
  kind: 'adapter'
  runtime: 'control'
  implementationKey: string
}

export interface CodeBlockManifest extends BlockManifestBase {
  kind: 'code'
  runtime: 'page' | 'node'
  code: string
  codeHash?: string
}

export interface CompositeBlockManifest extends BlockManifestBase {
  kind: 'composite'
  runtime: 'composite'
  workflowRef: string
}

export type BlockManifest =
  | CoreBlockManifest
  | AdapterBlockManifest
  | CodeBlockManifest
  | CompositeBlockManifest
