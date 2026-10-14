import { randomUUID } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import type { AutoAccount } from '../../shared/types'
import { WEB_ENRICHMENT_WORKFLOW, validateWebEnrichment, type WebEnrichmentSettings } from '../../shared/facebookWebEnrichment'
import type { BlockDef, WorkflowDef } from '../../shared/v2Types'
import { peekDatabaseRuntimeClock } from '../data/repositories/runtimeClockRepository'
import { webEnrichmentRpc } from '../data/repositories/webEnrichmentRepository'
import { getWorkflowByName } from '../data/repositories/workflowV2Repository'
import { getBlock } from '../data/repositories/blockRepository'
import { getSupabaseClient } from '../data/supabaseClient'
import { WorkflowEngineV2 } from '../v2/runtime/workflowEngine'
import { WebEnrichmentPlanner } from './webEnrichmentPlanner'
import { runWebEnrichmentBrowser, type WebEnrichmentPage } from './webEnrichmentBrowser'
import { onWebEnrichmentPreempt, setWebEnrichmentState, webEnrichmentSnapshot } from './webEnrichmentControl'
import { recordAccountLog } from './accountLogService'

interface Package { workflow: WorkflowDef; blocks: Map<number, BlockDef>; selectors: Record<string, string> }
interface CachedAccount {
  account: AutoAccount; revision: number; planner: WebEnrichmentPlanner; settings?: WebEnrichmentSettings
  loading?: Promise<void>; retryAfter: number; preferCampaign: boolean; interrupted: boolean
  configGeneration: number
}
export class WebEnrichmentService {
  private accounts = new Map<number, CachedAccount>()
  private package?: Package
  private warming?: Promise<void>
  private warmRetryAfter = 0
  private generation = 0
  private unsubscribe?: () => void
  private active?: { accountId: number; runId: string; controller: AbortController }
  private engine = new WorkflowEngineV2()
  constructor(private deps: {
    ready: (account: AutoAccount) => boolean
    createPage: (account: AutoAccount, runId: string) => WebEnrichmentPage
    wake: () => void
  }) {}

  start(): void { this.unsubscribe ??= onWebEnrichmentPreempt(id => this.preempt(id)) }
  stop(): void {
    this.generation++
    this.unsubscribe?.(); this.unsubscribe = undefined
    this.active?.controller.abort()
    this.accounts.clear(); this.package = undefined; this.warming = undefined
  }
  isActive(id: number): boolean { return this.active?.accountId === id }
  campaignFinished(id: number): void { const c = this.accounts.get(id); if (c) c.preferCampaign = false }
  preempt(id: number): void {
    const c = this.accounts.get(id), clock = peekDatabaseRuntimeClock()
    if (c) {
      c.interrupted = true; c.preferCampaign = true
      if (clock) c.planner.discardThrough(Date.parse(clock.dbNow))
    }
    if (this.active?.accountId === id) this.active.controller.abort()
  }
  invalidate(id: number): void {
    const c = this.accounts.get(id)
    if (c) {
      // Saving is not pause/resume: unused slots remain eligible inside their window.
      // Keep any existing interruption fence and all consumed slots intact.
      c.planner.configurationChanged()
      c.configGeneration++; c.settings = undefined; c.revision = -1; c.retryAfter = 0
      c.preferCampaign = true
    }
    if (this.active?.accountId === id) this.active.controller.abort()
  }

  /** Called by the existing scheduler tick, including accounts busy in campaigns. Never awaited. */
  observe(accounts: AutoAccount[]): void {
    try { this.observeReady(accounts) } catch { this.active?.controller.abort() }
  }
  private observeReady(accounts: AutoAccount[]): void {
    const ids = new Set(accounts.map(a => a.id))
    // An inactive/ineligible account can return in the same app session. Keep
    // its consumed slots and interruption marker; only stop() clears this RAM.
    for (const [id] of this.accounts) if (!ids.has(id)) this.preempt(id)
    const clock = peekDatabaseRuntimeClock()
    for (const account of accounts) {
      if (account.flatformType !== 'facebook') continue
      let c = this.accounts.get(account.id)
      if (!c) {
        c = { account, revision: -1, planner: new WebEnrichmentPlanner(), retryAfter: 0, preferCampaign: false, interrupted: false, configGeneration: 0 }
        this.accounts.set(account.id, c)
      }
      c.account = account
      if (!account.isActive || account.loginStatus !== 'đã đăng nhập' || account.status === 'tạm dừng') {
        this.preempt(account.id); continue
      }
      if (!account.facebookWebEnrichmentEnabled) { this.invalidate(account.id); continue }
      if (c.interrupted && clock) {
        c.planner.discardThrough(Date.parse(clock.dbNow)); c.interrupted = false
      }
      const revision = account.facebookWebEnrichmentRevision ?? 0
      if (c.settings && c.revision !== revision) this.invalidate(account.id)
      if (!c.settings && !c.loading && performance.now() >= c.retryAfter) this.load(c, revision)
      if (c.settings && clock) {
        c.planner.observe(c.settings.config, Date.parse(clock.dbNow), clock.vietnamDateKey, Date.parse(clock.nextVietnamMidnight))
        if (c.settings.config.stopDate && clock.vietnamDateKey > c.settings.config.stopDate
          && this.active?.accountId === account.id) this.active.controller.abort()
      }
      this.warm()
    }
  }

  /** Synchronous reservation. Undefined means campaigns continue without waiting for any cache/slot. */
  tryRun(account: AutoAccount, hasEligibleCampaign: boolean): Promise<void> | undefined {
    try { return this.tryRunReady(account, hasEligibleCampaign) } catch { return undefined }
  }
  /** RAM-only preflight; observes the slot without reserving or clearing campaign priority. */
  canRun(account: AutoAccount, hasEligibleCampaign: boolean): boolean {
    try { return !!this.readyRun(account, hasEligibleCampaign) } catch { return false }
  }
  private readyRun(account: AutoAccount, hasEligibleCampaign: boolean) {
    const c = this.accounts.get(account.id), clock = peekDatabaseRuntimeClock(), pkg = this.package
    if (!c?.settings?.enabled || c.interrupted || !clock || !pkg || this.active || webEnrichmentSnapshot().length
      || c.preferCampaign && hasEligibleCampaign || !account.isActive || account.status !== 'chờ xử lý'
      || !account.facebookWebEnrichmentEnabled || account.facebookWebEnrichmentRevision !== c.revision
      || (account.proxyId ?? null) !== (c.account.proxyId ?? null)
      || account.loginStatus !== 'đã đăng nhập' || !this.deps.ready(account)) return
    const now = Date.parse(clock.dbNow), midnight = Date.parse(clock.nextVietnamMidnight)
    if (!c.planner.observe(c.settings.config, now, clock.vietnamDateKey, midnight)) return
    return { c, config: c.settings.config, pkg, now, midnight }
  }
  private tryRunReady(account: AutoAccount, hasEligibleCampaign: boolean): Promise<void> | undefined {
    const ready = this.readyRun(account, hasEligibleCampaign)
    if (!ready) return
    const { c, config, pkg, now, midnight } = ready
    const run = { accountId: account.id, runId: randomUUID(), controller: new AbortController() }
    this.active = run
    c.planner.started(now)
    const started = performance.now()
    const budgetMs = Math.min(config.minutesPerSession * 60_000, midnight - now)
    setWebEnrichmentState(run, true)
    this.log(account.id, 'start', 'Bắt đầu làm giàu lịch sử Web.')
    return runWebEnrichmentBrowser({ signal: run.controller.signal, budgetMs,
      createPage: () => this.deps.createPage(account, run.runId),
      run: async (page, signal) => {
        // An interest already in the primary bag is not an additional query.
        // Keep saved text intact, and avoid exhausting two bags containing the same last term.
        const keywordSet = new Set(config.keywords.map(value => value.toLocaleLowerCase('vi')))
        const webConfig = { ...config, hobbies: config.hobbies.filter(value => !keywordSet.has(value.toLocaleLowerCase('vi'))) }
        const result = await this.engine.run(pkg.workflow, { webConfig,
          webSelectors: pkg.selectors, webUntil: Date.now() + budgetMs }, page,
        { accountId: account.id, persist: false, signal, blockTimeoutMs: 1000, preparedBlocks: pkg.blocks })
        if (result.status === 'failed') throw new Error('Workflow lướt web không thực hiện được.')
      }
    }).catch(() => {
      if (!run.controller.signal.aborted && performance.now() - started < budgetMs)
        this.log(account.id, 'error', 'Bỏ lượt làm giàu lịch sử Web do lỗi hoặc quá thời gian.')
    }).finally(() => {
      c.planner.finished(now + performance.now() - started)
      c.preferCampaign = true
      if (this.active === run) this.active = undefined
      setWebEnrichmentState(run, false)
      this.log(account.id, 'end', 'Kết thúc làm giàu lịch sử Web; đã nhường lại tài khoản.')
      try { this.deps.wake() } catch {}
    })
  }

  private log(accountId: number, event: string, message: string): void {
    try { recordAccountLog({ accountId, eventType: `web_enrichment_${event}`, message }) } catch {}
  }
  private load(c: CachedAccount, revision: number): void {
    const generation = this.generation, configGeneration = c.configGeneration
    c.loading = webEnrichmentRpc(c.account.id, 'get').then(value => {
      if (generation !== this.generation || this.accounts.get(c.account.id) !== c || configGeneration !== c.configGeneration) return
      const settings = validateWebEnrichment(value, { allowLegacyFiveWebsites: true })
      if (settings.config.revision !== revision || c.account.facebookWebEnrichmentRevision !== revision) return
      c.settings = settings; c.revision = revision
    }).catch(() => {}).finally(() => {
      c.loading = undefined
      if (configGeneration === c.configGeneration) c.retryAfter = performance.now() + 60_000
    })
  }
  private warm(): void {
    if (this.package || this.warming || performance.now() < this.warmRetryAfter) return
    const generation = this.generation
    this.warming = (async () => {
      const workflow = await getWorkflowByName(WEB_ENRICHMENT_WORKFLOW)
      if (!workflow || workflow.nodes.length !== 1 || workflow.nodes[0].blockName !== 'fb_web_enrichment_browse') return
      const [block, elements] = await Promise.all([getBlock(workflow.nodes[0].blockId), getSupabaseClient()
        .from('auto_elements').select('name,xpath').in('name', ['fb_web_enrichment_result', 'fb_web_enrichment_captcha'])
        .abortSignal(AbortSignal.timeout(15_000))])
      if (!block || elements.error || elements.data?.length !== 2) return
      if (generation === this.generation) this.package = { workflow, blocks: new Map([[block.id, block]]),
        selectors: Object.fromEntries(elements.data.map(e => [e.name, e.xpath])) }
    })().catch(() => {}).finally(() => {
      if (generation === this.generation) { this.warming = undefined; this.warmRetryAfter = performance.now() + 60_000 }
    })
  }
}
