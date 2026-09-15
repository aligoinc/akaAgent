import type { Campaign } from '../../shared/types'
import type { RunStepV2, WorkflowDef } from '../../shared/v2Types'
import type { PageController } from '../v2/runtime/pageController'
import type { RunContext, RunResult } from '../v2/runtime/workflowEngine'

export const PAGE_IDENTITY_NODE_PREFIX = 'page_identity_'
const REQUIRED_NODES: Record<string, string> = {
  restore_only: 'if_else', needs_switch: 'if_else', original: 'fb_get_current_identity_name',
  switch: 'fb_switch_identity_by_name', ready: 'fb_campaign_page_identity_state', enter: 'merge',
  capture_result: 'fb_campaign_page_identity_state', restore_join: 'merge', needs_restore: 'if_else',
  restore: 'fb_switch_identity_by_name', restored: 'fb_campaign_page_identity_state',
  result_join: 'merge', result: 'fb_campaign_page_identity_state'
}

export function assertPageIdentityWorkflow(workflow: WorkflowDef | null): asserts workflow is WorkflowDef {
  if (!workflow || Object.entries(REQUIRED_NODES).some(([id, blockName]) => !workflow.nodes.some(node =>
    node.id === PAGE_IDENTITY_NODE_PREFIX + id && node.blockName === blockName
  ))) throw new Error('Workflow chưa có đầy đủ các bước chạy bằng Page. Vui lòng cập nhật workflow trước khi chạy.')
  const restore = workflow.nodes.find(node => node.id === PAGE_IDENTITY_NODE_PREFIX + 'restore')!
  if (restore.config.useOriginalIdentity !== true) throw new Error('Workflow thiếu cấu hình chuyển về danh tính ban đầu.')
  const node = (id: string) => workflow.nodes.find(item => item.id === PAGE_IDENTITY_NODE_PREFIX + id)!
  const validConditions = {
    restore_only: 'vars.runAsPage === true && vars.pageIdentityRestoreOnly === true',
    needs_switch: 'vars.runAsPage === true && vars.pageIdentityReady !== true',
    needs_restore: 'vars.runAsPage === true && !!vars.originalIdentityName && (vars.pageIdentityRestoreOnly === true || vars.pageIdentityRestoreAfterTarget !== false)'
  }
  const invalidConfig = Object.entries(validConditions).some(([id, condition]) =>
    node(id).systemType !== 'ifElse' || node(id).config.condition !== condition
  ) || ['enter', 'restore_join', 'result_join'].some(id => node(id).systemType !== 'merge' || node(id).config.mode !== 'any') ||
    ['ready', 'capture_result', 'restored', 'result'].some(id => node(id).config.pageIdentityStateOperation !== id) ||
    node('switch').config.identityNameFromVars !== 'runAsPageName'
  const expectedEdges = [
    'restore_only:restore_join:true', 'restore_only:needs_switch:false',
    'needs_switch:original:true', 'needs_switch:enter:false', 'original:switch:', 'switch:ready:', 'ready:enter:',
    'original:restore_join:', 'capture_result:restore_join:', 'restore_join:needs_restore:',
    'needs_restore:restore:true', 'needs_restore:result_join:false', 'restore:restored:',
    'restored:result_join:', 'result_join:result:'
  ].sort()
  const internalEdges = workflow.edges.filter(edge => edge.source.startsWith(PAGE_IDENTITY_NODE_PREFIX) && edge.target.startsWith(PAGE_IDENTITY_NODE_PREFIX))
    .map(edge => `${edge.source.slice(PAGE_IDENTITY_NODE_PREFIX.length)}:${edge.target.slice(PAGE_IDENTITY_NODE_PREFIX.length)}:${edge.sourceHandle || ''}`).sort()
  const bodyEdges = workflow.edges.filter(edge => edge.source.startsWith(PAGE_IDENTITY_NODE_PREFIX) !== edge.target.startsWith(PAGE_IDENTITY_NODE_PREFIX))
  // A disconnected or partially edited wrapper must not let restore-only enter
  // the action, or let a failed switch reach the original workflow root.
  if (invalidConfig || JSON.stringify(expectedEdges) !== JSON.stringify(internalEdges) || bodyEdges.length !== 2 ||
    !bodyEdges.some(edge => edge.source === node('enter').id && !edge.sourceHandle) ||
    !bodyEdges.some(edge => edge.target === node('capture_result').id && !edge.sourceHandle) ||
    workflow.nodes.filter(item => !workflow.edges.some(edge => edge.target === item.id)).some(item => item.id !== node('restore_only').id)) {
    throw new Error('Workflow có nhánh chạy bằng Page chưa hợp lệ. Vui lòng cập nhật đầy đủ các kết nối và cấu hình phiên Page.')
  }
}

/** Per-execution state only. All Facebook interactions run in the saved workflow. */
export class FacebookCampaignPageIdentity {
  originalIdentityName = ''
  ready = false
  switchAttempted = false
  targetStarted = false
  page: PageController | null = null
  restoreError: Error | null = null
  private restorePromise: Promise<void> | null = null
  private restored = false

  constructor(readonly campaign: Campaign, readonly workflow: WorkflowDef) {
    assertPageIdentityWorkflow(workflow)
  }

  variables(): Record<string, unknown> {
    return {
      runAsPage: true,
      runAsPageUid: this.campaign.extraSettings!.runAsPageUid,
      runAsPageName: this.campaign.extraSettings!.runAsPageName,
      originalIdentityName: this.originalIdentityName,
      pageIdentityReady: this.ready,
      pageIdentityRestoreOnly: false,
      pageIdentityRestoreAfterTarget: false
    }
  }

  observe(step: RunStepV2): void {
    const id = step.nodeId
    if (!id.startsWith(PAGE_IDENTITY_NODE_PREFIX)) {
      if (step.status === 'running') this.targetStarted = true
      return
    }
    if (id === PAGE_IDENTITY_NODE_PREFIX + 'original' && step.status === 'success') {
      this.originalIdentityName = String(step.output.identityName || '').trim()
    }
    if (id === PAGE_IDENTITY_NODE_PREFIX + 'switch' && step.status === 'running') this.switchAttempted = true
    if (id === PAGE_IDENTITY_NODE_PREFIX + 'ready' && step.status === 'success' && step.output.ok === true) this.ready = true
    if (id === PAGE_IDENTITY_NODE_PREFIX + 'restored' && step.status === 'success' && step.output.ok === true) {
      this.ready = false; this.restored = true
    }
  }

  restore(
    run: (workflow: WorkflowDef, variables: Record<string, unknown>, page: PageController, context: RunContext) => Promise<RunResult>,
    context: RunContext
  ): Promise<void> {
    if (this.restorePromise) return this.restorePromise
    if (!this.switchAttempted || this.restored) return Promise.resolve()
    this.restorePromise = this.performRestore(run, context).catch(error => {
      this.restoreError = error instanceof Error ? error : new Error(String(error))
      throw this.restoreError
    })
    return this.restorePromise
  }

  private async performRestore(
    run: (workflow: WorkflowDef, variables: Record<string, unknown>, page: PageController, context: RunContext) => Promise<RunResult>,
    context: RunContext
  ): Promise<void> {
    if (!this.originalIdentityName) throw new Error('Không còn tên danh tính ban đầu để chuyển về.')
    if (!this.page?.isConnected()) throw new Error('Trình duyệt đã đóng, không chuyển về được danh tính ban đầu.')
    const cleanup = new AbortController()
    // Never race a still-running block against resource release. The fresh
    // signal bounds sleeps/navigation retries while the awaited engine drains.
    const timer = setTimeout(() => cleanup.abort(), 45_000)
    try {
      const result = await run(this.workflow, { ...this.variables(), pageIdentityRestoreOnly: true }, this.page, {
        ...context, signal: cleanup.signal,
        onStepProgress: step => { this.observe(step); context.onStepProgress?.(step) }
      })
      if (result.status !== 'completed' || !this.restored) {
        const failed = result.steps.find(step => step.status === 'error')
        throw new Error(failed?.error || result.error || 'Không chuyển về được danh tính ban đầu.')
      }
    } finally { clearTimeout(timer) }
  }
}
