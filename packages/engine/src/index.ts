/**
 * @akabiz/engine — Workflow + Block execution engine.
 *
 * Pure TypeScript, browser-agnostic. App layer cung cấp:
 *   - IChannelProvider (launch browser context per channel)
 *   - IConnectionVault (decrypt secrets)
 *   - IRunPersistence (save runs/steps to DB)
 *
 * Engine emit ProgressEvent qua callback, app layer route đến UI/DB/logs.
 *
 * Phase 0 (current): types skeleton + public API surface.
 * Phase 2: WorkflowRunner implementation + activation queue + middleware hook.
 * Phase 3: core primitives (control flow + data + io + datatable).
 * Phase 4: browser primitives (click/type/scroll/...).
 * Phase 5: PageRuntime + NodeRuntime sandbox.
 */

export * from './types/index.js'
export type { IBrowserController, ActionResult } from './controllers/IBrowserController.js'
export type { IChannelProvider, ChannelHandle, ChannelHealth } from './controllers/IChannelProvider.js'
export type { ExecutionMiddleware, NodeContext, NodeResult } from './core/ExecutionMiddleware.js'
export type { IRunPersistence } from './core/IRunPersistence.js'
export type { IConnectionVault } from './core/IConnectionVault.js'
export type { IDataTableProvider, PickRowOptions, UpdateRowPatch } from './core/IDataTableProvider.js'

export { BlockRegistry, type CoreBlockHandler, type ExecuteContext } from './core/BlockRegistry.js'
export { ExecutionContext, type RunMetadata } from './core/ExecutionContext.js'
export { WorkflowEngine, type WorkflowEngineOptions } from './core/WorkflowEngine.js'
export { WorkflowRunner, type WorkflowRunnerOptions } from './core/WorkflowRunner.js'

export { interpolate, resolveValue, getByPath, formatValue } from './core/interpolate.js'
export { evaluateCondition } from './core/conditionEvaluator.js'
export { topologicalSort, findEntryNodes, buildNodeMap } from './core/topologicalSort.js'

export { registerCorePrimitives, registerDataTablePrimitives, registerBrowserPrimitives } from './primitives/index.js'
export { NodeRuntime, ALLOWED_MODULES } from './runtime/NodeRuntime.js'
export { PageRuntime } from './runtime/PageRuntime.js'

export const ENGINE_VERSION = '0.0.0'
export const MANIFEST_SCHEMA_VERSION = 1
