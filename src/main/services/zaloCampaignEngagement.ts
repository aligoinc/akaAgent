import { app } from 'electron'
import { mkdir, readFile, rename, writeFile, stat, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { getCurrentUser, getCurrentUserCredentials, type ProcessAuthCredentials } from '../data/currentUser'
import { getSupabaseClient } from '../data/supabaseClient'
import { ENGAGEMENT_KEYS, EngagementConfigCache, EngagementWatchCache, normalizeEngagementEvent,
  type EngagementConfig, type EngagementEvent, type EngagementWatch, type ZaloEngagementSource } from '../../shared/zaloCampaignEngagement'

// One process-wide coordinator, including legacy Server's multiple staff runtimes.
const config = new EngagementConfigCache(async () => {
  const { data, error } = await getSupabaseClient().from('auto_system_settings')
    .select('key,value,updated_at,is_active,is_secret').in('key', ENGAGEMENT_KEYS)
    .abortSignal(AbortSignal.timeout(5_000))
  if (error) throw error
  return data || []
})
type Registration = { detailId: string; source: ZaloEngagementSource }
type Hold = { accountId: string; accountZaloUid: string; targetZaloUid: string }
type Recovery = Hold & { campaignId: string; source: ZaloEngagementSource; detailInsertStarted?: boolean }
type OperationResult = { operationId: string; status: 'found' | 'missing' | 'invalid'; detailId?: string; source?: ZaloEngagementSource }
interface Item { id: string; revision: string; at: number; retry: number; next: number; mode: 'register' | 'record' | 'recover' | 'hold' | 'waiting_config'; payload: Registration | EngagementEvent | Hold | Recovery; waitingFor?: string[]; delivered?: boolean; recoveryExpiresAt?: number }
type CatalogCursor = { from: string; until: string; id: string }
interface Scope {
  catalogRevision: string; catalogPending: boolean; catalogCursor?: CatalogCursor
  identity?: object; generation: number
  key: string; staffId: number; organizationId: number; credentials?: ProcessAuthCredentials
  items: Item[]; ready: Promise<void>; saving?: Promise<void>; version: number; bytes: number; waiters: Array<{ version: number; resolve: () => void }>
  active: () => boolean;
  lastAccount: string; lastMode: 'register' | 'record' | 'recover';
  recovery: boolean; recoveryCursor?: { afterId: string; throughId: string }; recoveringAfterRestart: Set<string>; keys: Set<string>
}
export interface EngagementSendContext { revision: string; sentAt: string; accountZaloUid?: string; operationId?: string }
const scopes = new Map<string, Scope>()
interface ServerOwner { staffId: number; organizationId: number; credentials?: ProcessAuthCredentials; active: boolean; pending?: Promise<void>; retryAt: number }
const serverOwners = new Map<string, ServerOwner>()
const watches = new EngagementWatchCache()
let timer: ReturnType<typeof setTimeout> | undefined
let timerAt = 0
let writing = false, cursor = 0, staging = 0, stagingBytes = 0, configFailures = 0, lastWarningAt = 0
export const engagementMetrics = { received: 0, filtered: 0, coalesced: 0, updated: 0, retry: 0, overflow: 0, rpcMs: 0, journalErrors: 0, backlog: 0, oldestAgeMs: 0, recoveryExpired: 0 }
const MAX_ITEMS = 10_000, MAX_BYTES = 16 * 1024 * 1024, JOURNAL_MAX_BYTES = 128 * 1024 * 1024
// Optional commit recovery, independent of the DB's registered tracking window.
const RECOVERY_MAX_AGE_MS = 5 * 60_000
const journalSizes = new Map<string, number>()
let journalInventory: Promise<void> | undefined
const file = (scope: Scope): string => join(app.getPath('userData'), 'campaign-engagement', scope.key + '.json')
const bytes = (value: unknown): number => Buffer.byteLength(JSON.stringify(value))
const itemKey = (i: Item): string => JSON.stringify([i.mode,i.revision,i.payload,(i.mode==='hold' || i.mode==='recover') ? i.id : i.waitingFor])
function warn(kind: string): void { if (Date.now()-lastWarningAt<60_000) return; lastWarningAt=Date.now(); console.warn('[ZaloEngagement] degraded', { kind, ...engagementMetrics }) }
function refresh(scope: Scope): void {
  scope.version++; scope.bytes=bytes(scope.items); scope.keys=new Set(scope.items.map(itemKey))
  const all=[...scopes.values()].flatMap(s=>s.items)
  engagementMetrics.backlog=all.length
  engagementMetrics.oldestAgeMs=all.length ? Date.now()-Math.min(...all.map(i=>i.at)) : 0
}
async function persist(scope: Scope, waitForSnapshot = false): Promise<void> {
  // A request admitted before detach may finish after a replacement loaded the
  // same journal. Its stale scope must not overwrite the replacement snapshot.
  if (scopes.get(scope.key)!==scope) return
  scope.version++
  // Fire-and-forget producers must not accumulate waiters when a disk stalls.
  const acknowledged=waitForSnapshot ? new Promise<void>(resolve=>scope.waiters.push({version:scope.version,resolve})) : Promise.resolve()
  if (scope.saving) return acknowledged
  scope.saving=(async () => {
    await scope.ready // Restore and writes remain ordered, only in the background.
    const directory=join(app.getPath('userData'),'campaign-engagement')
    await mkdir(directory,{ recursive:true })
    journalInventory ??= (async () => {
      for (const name of await readdir(directory)) if (/^\d+-\d+\.json$/.test(name)) {
        const path=join(directory,name); journalSizes.set(path,(await stat(path)).size)
      }
    })()
    await journalInventory
    let written=-1
    // One outstanding atomic snapshot; concurrent arrivals coalesce into the next snapshot.
    while (written!==scope.version) {
      written=scope.version
      const contents=JSON.stringify(scope.items)
      const size=Buffer.byteLength(contents),previous=journalSizes.get(file(scope)) || 0
      const total=[...journalSizes.values()].reduce((sum,n)=>sum+n,0)-previous+size
      if (total>JOURNAL_MAX_BYTES) { engagementMetrics.overflow++; throw new Error('journal_capacity') }
      // Reserve before yielding: snapshots for separate owners share one disk budget.
      journalSizes.set(file(scope),size)
      await writeFile(file(scope)+'.tmp',contents,{ mode:0o600 })
      await rename(file(scope)+'.tmp',file(scope))
      const completed=scope.waiters.filter(waiter=>waiter.version<=written)
      scope.waiters=scope.waiters.filter(waiter=>waiter.version>written)
      for (const waiter of completed) waiter.resolve()
    }
  })().catch(() => {
    engagementMetrics.journalErrors++; warn('journal_io')
    for (const waiter of scope.waiters.splice(0)) waiter.resolve()
  }).finally(() => { scope.saving=undefined })
  return acknowledged
}
function hasCapacity(extraBytes: number, replacing?: Item): boolean {
  let count=staging,total=stagingBytes
  for (const scope of scopes.values()) { count+=scope.items.length; total+=scope.bytes }
  return count-(replacing ? 1 : 0)<MAX_ITEMS && total+extraBytes-(replacing ? bytes(replacing) : 0)<=MAX_BYTES
}
function captureOwner(): () => boolean {
  const user=getCurrentUser()
  if (!user) return () => false
  const server=serverOwners.get(`${user.organizationId}-${user.staffId}`)
  const credentials=getCurrentUserCredentials()
  return () => {
    const current=getCurrentUser()
    return current?.staffId===user.staffId && current?.organizationId===user.organizationId &&
      (server ? server.active && serverOwners.get(`${user.organizationId}-${user.staffId}`)===server : !!credentials && getCurrentUserCredentials()===credentials)
  }
}
function getScope(explicitOwner?: ServerOwner): Scope | undefined {
  const user=explicitOwner || getCurrentUser()
  if (!user) return undefined
  const key=`${user.organizationId}-${user.staffId}`
  const server=explicitOwner || serverOwners.get(key), credentials=server?.active ? server.credentials : getCurrentUserCredentials() || undefined
  const active=(): boolean => server ? server.active && serverOwners.get(key)===server : !!credentials && getCurrentUserCredentials()===credentials
  // An admitted Server owner can restore metadata before its credential read
  // succeeds. The existing writer owns bounded auth/config retry from here.
  if (!active()) return undefined
  const previous=scopes.get(key)
  const identity=server || credentials
  if (previous) {
    if (previous.identity!==identity) { previous.generation++; previous.identity=identity }
    previous.credentials=credentials; previous.active=active; return previous
  }
  const scope: Scope={ catalogRevision:'',catalogPending:true,identity,generation:0,active, key,staffId:user.staffId,organizationId:user.organizationId,credentials,items:[],bytes:0,ready:Promise.resolve(),version:0,waiters:[],lastAccount:"",lastMode:"record",recovery:true,recoveringAfterRestart:new Set(),keys:new Set() }
  scopes.set(key,scope)
  scope.ready=(async () => {
    try {
      const info=await stat(file(scope))
      if (info.size>JOURNAL_MAX_BYTES || !hasCapacity(info.size)) { engagementMetrics.overflow++; warn('journal_capacity'); return }
      const restored: unknown=JSON.parse(await readFile(file(scope),'utf8'))
      if (Array.isArray(restored)) for (const item of restored as Item[]) {
        if (!item?.id || (!item.revision && item.mode!=='waiting_config') || !['register','record','recover','hold','waiting_config'].includes(item.mode) || !item.payload || !Number.isFinite(item.at)) continue
        if (!hasCapacity(bytes(item))) { engagementMetrics.overflow++; continue }
        scope.items.push(item); scope.bytes+=bytes(item)
        if (item.mode==='hold') scope.recoveringAfterRestart.add(item.id)
      }
      for (const item of scope.items) if ((item.mode==='record' || item.mode==='waiting_config') && !item.waitingFor) item.waitingFor=dependencies(scope,item.payload as EngagementEvent)
      refresh(scope)
      expireRecoveries(scope)
    } catch (error) { if ((error as NodeJS.ErrnoException).code!=='ENOENT') { engagementMetrics.journalErrors++; warn('journal_read') } }
  })()
  return scope
}
function resumeScope(scope: Scope | undefined): void {
  if (!scope) return
  // File IO and DB recovery do not delay login/runtime admission. A logout or
  // replacement owner while loading must not start the old owner's writer.
  void scope.ready.then(() => { if (scope.active()) schedule(1) })
}
export function resumeDesktopCampaignEngagement(): void {
  config.currentOrRefresh()
  resumeScope(getScope())
}
function schedule(delay: number, _full=false): void {
  const at=Date.now()+Math.max(1,delay)
  if (timer && timerAt<=at) return // Later arrivals never reset the first deadline.
  if (timer) clearTimeout(timer)
  timerAt=at
  timer=setTimeout(() => { timer=undefined; timerAt=0; void flush() },Math.max(1,delay)); timer.unref()
}
function enqueue(scope: Scope, revision: string, mode: Item['mode'], payload: Item['payload'], itemId=randomUUID(), at=Date.now()): boolean {
  const item: Item={ id:itemId,revision,at,retry:0,next:0,mode,payload }
  if (mode==='record' || mode==='waiting_config') item.waitingFor=dependencies(scope,payload as EngagementEvent)
  if (scope.keys.has(itemKey(item))) { engagementMetrics.coalesced++; return true }
  const operationId=mode==='register' ? (payload as Registration).source.operationId : undefined
  const replacing=operationId ? scope.items.find(existing=>existing.id===operationId && (existing.mode==='hold' || existing.mode==='recover')) : undefined
  if (!hasCapacity(bytes(item),replacing)) { engagementMetrics.overflow++; warn('queue_capacity'); return false }
  if (replacing) { scope.items=scope.items.filter(existing=>existing!==replacing); scope.recoveringAfterRestart.delete(replacing.id); refresh(scope) }
  scope.items.push(item); scope.bytes+=bytes(item); scope.keys.add(itemKey(item)); engagementMetrics.backlog++
  void persist(scope)
  if (mode!=='hold') {
    try {
      const settings=config.currentOrRefresh()
      const full=scope.items.filter(i=>i.mode!=='hold').length>=(settings?.batchSize || 100)
      schedule(full ? 1 : (settings?.flushIntervalSeconds || 5)*1000,full)
    } catch { schedule(1000) } // The journal owns retry even while config is unavailable.
  }
  return true
}
function operationKey(item: Item): string {
  return item.mode==='register' ? (item.payload as Registration).source.operationId || `detail:${(item.payload as Registration).detailId}` : item.id
}
function dependencies(scope: Scope, event: EngagementEvent): string[] {
  return [...new Set(scope.items.filter(item=>{
    if (!['hold','recover','register'].includes(item.mode)) return false
    const source=item.mode==='register' ? (item.payload as Registration).source : item.payload as Hold
    return source.accountZaloUid===event.accountZaloUid && source.targetZaloUid===event.targetZaloUid &&
      (item.mode==='register' || (source as Hold).accountId===event.accountId)
  }).map(operationKey))]
}
// An event always gets its first pass for existing watches. Only its replay for
// an in-flight send waits for that specific operation, never the whole recipient.
function held(_scope: Scope, item: Item): boolean {
  return item.mode==='record' && item.delivered===true && !!item.waitingFor?.length
}
function releaseOperation(scope: Scope, operationId: string, replay: boolean): void {
  for (const item of scope.items) if (item.waitingFor?.includes(operationId)) {
    item.waitingFor=item.waitingFor.filter(id=>id!==operationId)
    if (replay) { item.delivered=false; item.next=0 }
  }
  scope.items=scope.items.filter(item=>!(item.mode==='record' && item.delivered && !item.waitingFor?.length))
}
function recoveryDeadline(item: Item): number {
  // Legacy journals inherit their original age; restoring never renews the budget.
  return Number.isFinite(item.recoveryExpiresAt) ? item.recoveryExpiresAt! : item.at + RECOVERY_MAX_AGE_MS
}
function recoveryExpired(item: Item): boolean {
  return item.mode==='recover' && Date.now()>=recoveryDeadline(item)
}
function discardOperations(scope: Scope, ids: Set<string>): void {
  for (const id of ids) scope.recoveringAfterRestart.delete(id)
  scope.items=scope.items.filter(item=>{
    if ((item.mode==='hold' || item.mode==='recover') && ids.has(item.id)) return false
    if (!item.waitingFor?.some(id=>ids.has(id))) return true
    item.waitingFor=item.waitingFor.filter(id=>!ids.has(id))
    // Retain a first pass for an existing watch or another in-flight operation.
    // An event admitted solely by the discarded source must not cause a DB read.
    return !!item.waitingFor.length || (!item.delivered && !!watches.mayMatch(item.payload as EngagementEvent))
  })
}
function expireRecoveries(scope: Scope): void {
  const ids=new Set(scope.items.filter(recoveryExpired).map(item=>item.id))
  if (!ids.size) return
  discardOperations(scope,ids); engagementMetrics.recoveryExpired+=ids.size
  refresh(scope); void persist(scope)
}
function retry(item: Item): void {
  item.next=Date.now()+[1000,5000,15000,60000][Math.min(item.retry++,3)]; engagementMetrics.retry++
}
async function request(scope: Scope, settings: EngagementConfig, mode: 'register'|'read'|'record', items: unknown[]): Promise<{ enabled: boolean; updated: number; items: EngagementWatch[]; pending?: Registration[]; operations?: OperationResult[]; recoveryCursor?: { afterId: string; throughId: string }; recoveryDone?: boolean; catalogDone?: boolean; catalogCursor?: CatalogCursor }> {
  if (!scope.active()) throw new Error('engagement_owner_changed')
  const generation=scope.generation
  const serverOwner=serverOwners.get(scope.key)
  if (serverOwner?.active) {
    await prepareServerOwner(serverOwner)
    if (!serverOwner.credentials || !scope.active() || scope.generation!==generation) throw new Error('engagement_owner_auth_unavailable')
    scope.credentials=serverOwner.credentials
  }
  if (!scope.credentials) throw new Error('engagement_owner_auth_unavailable')
  const started=Date.now()
  const { data,error }=await getSupabaseClient().rpc(`aka_agent_${mode}_campaign_engagement`,{
    p_staff_id:scope.staffId,p_organization_id:scope.organizationId,p_revision:settings.revision,p_items:items,
    p_auth_username:scope.credentials.username,p_auth_password:scope.credentials.password
  }).abortSignal(AbortSignal.timeout(20_000))
  engagementMetrics.rpcMs+=Date.now()-started
  if (!scope.active() || scope.generation!==generation) throw new Error('engagement_owner_changed')
  if (error) {
    if (serverOwner?.active && error.message?.includes('automation_auth_invalid')) {
      serverOwner.credentials=undefined
      serverOwner.retryAt=Date.now()+1000
    }
    throw error
  }
  if (data?.enabled!==true) config.invalidate()
  for (const watch of data?.items || []) watches.put(watch)
  engagementMetrics.updated+=Number(data?.updated || 0)
  return data
}
async function flush(): Promise<void> {
  if (writing) return
  writing=true
  let failed=false, canContinue=false, nextSettings: EngagementConfig | undefined
  try {
    // Logout suspends writes and leaves the metadata journal for its owning login.
    let available=[...scopes.values()].filter(s=>s.active())
    for (const scope of available) { await scope.ready; expireRecoveries(scope) }
    if (!available.some(s=>s.recovery || s.catalogPending || s.items.some(i=>i.mode!=='hold' && !held(s,i)))) return
    const settings=await config.get()
    available=available.filter(s=>s.active())
    for (const scope of available) {
      await scope.ready
      // These revisions come from the same PostgREST serializer. Do not parse
      // through Date: it truncates DB microseconds and could replay an old toggle.
      let changed=false
      const valid=scope.items.filter(i=>{
        if (i.mode!=='waiting_config') return settings.enabled && i.revision===settings.revision
        changed=true
        // Reception time is millisecond precision. Do not round a later DB
        // microsecond revision down into the same millisecond and revive old work.
        const revisionAt=Date.parse(settings.revision)
        const beforeReception=revisionAt<i.at || (revisionAt===i.at && !/[1-9]/.test(settings.revision.match(/\.\d{3}(\d*)/)?.[1] || ''))
        if (!settings.enabled || (i.revision && i.revision!==settings.revision) || !beforeReception) return false
        i.mode='record'; i.revision=settings.revision
        return true
      })
      if (changed || valid.length!==scope.items.length) { scope.items=valid; refresh(scope); await persist(scope,true) }
    }
    if (!settings.enabled || !available.length) return
    canContinue=true; nextSettings=settings; configFailures=0
    for (const scope of available) if (scope.catalogRevision!==settings.revision) { scope.catalogRevision=settings.revision; scope.catalogPending=true; scope.catalogCursor=undefined }
    const scope=available.slice(cursor).concat(available.slice(0,cursor)).find(s=>s.recovery || s.catalogPending || s.items.some(i=>i.mode!=='hold' && i.next<=Date.now() && !held(s,i)))
    if (!scope) return
    cursor=(available.indexOf(scope)+1)%available.length
    if (scope.catalogPending) {
      const result=await request(scope,settings,'read',[{catalog:scope.catalogCursor || {}}])
      if (!result.enabled) return
      scope.catalogCursor=result.catalogCursor
      scope.catalogPending=result.catalogDone===false && watches.size<watches.maxEntries && !watches.saturated
      // One catalog page per turn; keep draining existing source/event work too.
    }
    if (scope.recovery) {
      const result=await request(scope,settings,'read',scope.recoveryCursor ? [{ recovery:scope.recoveryCursor }] : [])
      if (!result.enabled) return
      let overflow=false
      for (const pending of result.pending || []) {
        if (!await enqueue(scope,settings.revision,'register',pending)) { overflow=true; break }
      }
      // Advance only after the whole page is retained; retry/overflow cannot
      // release events for committed sources still beyond this page.
      scope.recovery=overflow || result.recoveryDone===false || (result.recoveryDone===undefined && (result.pending?.length || 0)>=500)
      if (!overflow) scope.recoveryCursor=scope.recovery ? result.recoveryCursor : undefined
      else if (!scope.recoveryCursor && result.recoveryCursor) scope.recoveryCursor={ afterId:'0',throughId:result.recoveryCursor.throughId }
      if (!scope.recovery) {
        for (const id of scope.recoveringAfterRestart) releaseOperation(scope,id,false)
        scope.items=scope.items.filter(i=>!scope.recoveringAfterRestart.has(i.id)); scope.recoveringAfterRestart.clear()
      }
      refresh(scope); await persist(scope,true)
    }
    expireRecoveries(scope)
    const accountKey=(item: Item): string => item.mode==='register'
      ? (item.payload as Registration).source.accountZaloUid : (item.payload as EngagementEvent).accountZaloUid
    const eligible=scope.items.filter(i=>(i.mode==='register' || i.mode==='record' || i.mode==='recover') && i.revision===settings.revision && i.next<=Date.now() && !held(scope,i))
    const first=eligible.find(item=>item.mode!==scope.lastMode) || eligible[0]
    if (!first) return
    const byAccount=new Map<string,Item[]>()
    for (const item of eligible) if (item.mode===first.mode) {
      const key=accountKey(item), items=byAccount.get(key) || []
      items.push(item); byAccount.set(key,items)
    }
    const keys=[...byAccount.keys()].sort()
    const pivot=keys.findIndex(key=>key>scope.lastAccount)
    const accounts=pivot<0 ? keys : keys.slice(pivot).concat(keys.slice(0,pivot))
    const batch: Item[]=[]
    while (batch.length<settings.batchSize && byAccount.size) {
      for (const key of accounts) {
        const items=byAccount.get(key), item=items?.shift()
        if (!item) continue
        batch.push(item); scope.lastAccount=key
        if (!items!.length) byAccount.delete(key)
        if (batch.length===settings.batchSize) break
      }
    }
    scope.lastMode=first.mode as Scope['lastMode']
    try {
      if (first.mode==='register') {
        const result=await request(scope,settings,'register',batch.map(i=>({ detailId:(i.payload as Registration).detailId })))
        if (!result.enabled) return
        for (const item of batch) releaseOperation(scope,operationKey(item),true)
        scope.items=scope.items.filter(item=>!batch.includes(item))
      } else if (first.mode==='recover') {
        const result=await request(scope,settings,'read',batch.map(item=>{
          const operation=item.payload as Recovery
          return { operation:{ operationId:item.id,campaignId:operation.campaignId,accountId:operation.accountId,
            accountZaloUid:operation.accountZaloUid,targetZaloUid:operation.targetZaloUid } }
        }))
        if (!result.enabled) return
        for (const item of batch) {
          if (!scope.items.includes(item)) continue // Detail commit callback already replaced this operation.
          if (recoveryExpired(item)) { expireRecoveries(scope); continue }
          const found=result.operations?.find(operation=>operation.operationId===item.id)
          if (found?.status==='found' && found.detailId && found.source) {
            if (!await enqueue(scope,settings.revision,'register',{detailId:found.detailId,source:found.source})) retry(item)
          } else if (found?.status==='invalid') {
            releaseOperation(scope,item.id,false); scope.items=scope.items.filter(value=>value!==item)
          } else retry(item) // Unknown outcome may retry only within its fixed recovery budget.
        }
      } else {
        let incomplete=false
        const unknown=batch.map(i=>i.payload as EngagementEvent).filter(e=>!watches.mayMatch(e))
        if (unknown.length) { const result=await request(scope,settings,'read',unknown); if (!result.enabled) return; incomplete=result.items.length>=1001 }
        // Read cap means incompleteness, never a negative: still submit all such events.
        const events=batch.map(i=>i.payload as EngagementEvent).filter(e=>incomplete || watches.mayMatch(e))
        if (events.length && !(await request(scope,settings,'record',events)).enabled) return
        engagementMetrics.filtered+=batch.length-events.length
        for (const item of batch) item.delivered=true
        scope.items=scope.items.filter(item=>!batch.includes(item) || !!item.waitingFor?.length)
      }
    } catch {
      failed=true
      for (const item of batch) if (scope.items.includes(item)) retry(item)
    }
    refresh(scope); await persist(scope,true)
  } catch { failed=true; canContinue=true; configFailures++; engagementMetrics.retry++ }
  finally {
    writing=false
    for (const scope of scopes.values()) if (scope.active()) expireRecoveries(scope)
    const scopesWithWork=[...scopes.values()].filter(s=>s.active() && (s.recovery || s.catalogPending || s.items.some(i=>i.mode!=='hold' && !held(s,i))))
    if (canContinue && scopesWithWork.length) {
      const pending=scopesWithWork.flatMap(s=>s.items.filter(i=>i.mode!=='hold' && !held(s,i)))
      const due=pending.filter(item=>item.next<=Date.now())
      const full=nextSettings && due.length>=nextSettings.batchSize
      const deadline=pending.length ? Math.min(...pending.map(item=>item.next || item.at+(nextSettings?.flushIntervalSeconds || 5)*1000)) : Date.now()+(nextSettings?.flushIntervalSeconds || 5)*1000
      const recoveryDue=Math.min(...pending.filter(i=>i.mode==='recover').map(recoveryDeadline))
      const delay=failed ? [1000,5000,15000,60000][Math.min(configFailures,3)] : full ? 1 : Math.max(1,deadline-Date.now())
      schedule(Math.min(delay,recoveryDue-Date.now()))
    }
  }
}
export function beginCampaignEngagementSend(account: { id:number; zaloUid?:string|null; isZaloShowWeb?:boolean|null }, targetUid: string): EngagementSendContext {
  const empty={ revision:'',sentAt:new Date().toISOString() }, ownerCurrent=captureOwner()
  if (account.isZaloShowWeb || !account.zaloUid) return empty
  try {
    const cfg=config.currentOrRefresh(); if (!cfg?.enabled) return empty
    if (!ownerCurrent()) return empty
    const scope=getScope(); if (!scope) return empty
    const operationId=randomUUID()
    if (!enqueue(scope,cfg.revision,'hold',{ accountId:String(account.id),accountZaloUid:account.zaloUid,targetZaloUid:targetUid },operationId)) return empty
    return { revision:cfg.revision,sentAt:new Date().toISOString(),accountZaloUid:account.zaloUid,operationId }
  } catch { return empty }
}
export function abandonCampaignEngagementSend(operationId?: string): void {
  if (!operationId) return
  for (const scope of scopes.values()) if (scope.items.some(i=>i.id===operationId &&
    (i.mode==='hold' || (i.mode==='recover' && (i.payload as Recovery).detailInsertStarted===false)))) {
    discardOperations(scope,new Set([operationId])); refresh(scope); void persist(scope); schedule(1)
  }
}
/** Best-effort metadata only. The campaign never waits for disk/config IO. */
export function stageCampaignEngagementSource(source: unknown, campaignId: number | undefined, detailInsertStarted=false): void {
  try {
  const metadata=source as ZaloEngagementSource | undefined
  if (!metadata?.revision || !metadata.operationId || !campaignId) return
  const scope=[...scopes.values()].find(s=>s.items.some(item=>item.id===metadata.operationId))
  if (!scope?.active()) return
  const item=scope.items.find(item=>item.id===metadata.operationId && (item.mode==='hold' || item.mode==='recover'))
  if (!item) return
  if (item.mode==='recover') {
    if (recoveryExpired(item)) { expireRecoveries(scope); return }
    if (detailInsertStarted && !(item.payload as Recovery).detailInsertStarted) {
      (item.payload as Recovery).detailInsertStarted=true
      refresh(scope); void persist(scope)
    }
    return // Neither INSERT admission nor retries extend the original deadline.
  }
  const payload: Recovery={ ...item.payload as Hold,campaignId:String(campaignId),source:metadata,detailInsertStarted }
  if (!hasCapacity(bytes({...item,payload}),item)) { engagementMetrics.overflow++; warn('queue_capacity'); return }
  item.mode='recover'; item.payload=payload; item.recoveryExpiresAt=Date.now()+RECOVERY_MAX_AGE_MS; scope.recoveringAfterRestart.delete(item.id)
  refresh(scope); void persist(scope)
  const delay=(config.currentOrRefresh()?.flushIntervalSeconds || 5)*1000
  item.next=Date.now()+delay; schedule(delay)
  } catch { engagementMetrics.filtered++; warn('source_metadata_unavailable') }
}
export function failCampaignEngagementDetail(source: unknown, error: unknown): void {
  const operationId=(source as ZaloEngagementSource | undefined)?.operationId
  if (!operationId) return
  // A server SQL rejection is conclusive. Transport errors, timeouts and missing
  // lookup results leave commit outcome unknown within the fixed recovery budget.
  const code=String((error as {code?:unknown} | null)?.code || '')
  const rejected=/^(22|23|25|28|42|P0)[0-9A-Z]{3}$/.test(code) || ['40000','40001','40002','40P01'].includes(code)
  // SQLSTATE 40003 explicitly means statement completion is unknown.
  for (const scope of scopes.values()) {
    const item=scope.items.find(item=>item.id===operationId && (item.mode==='hold' || item.mode==='recover'))
    if (!item) continue
    if (rejected) {
      discardOperations(scope,new Set([operationId]))
    } else if (item.mode==='recover') {
      (item.payload as Recovery).detailInsertStarted=true
      retry(item)
    }
    refresh(scope); void persist(scope); schedule(1000)
  }
}
export function recordCampaignEngagementDetail(detailId: number, source: unknown): void {
  const metadata=source as ZaloEngagementSource | undefined
  if (!metadata?.revision) return
  const scope=metadata.operationId ? [...scopes.values()].find(s=>s.items.some(item=>item.id===metadata.operationId)) : getScope()
  if (!scope?.active()) return // Source remains pending in DB for the original owner.
  const recover=(): void => { engagementMetrics.retry++; scope.recovery=true; scope.recoveryCursor=undefined; abandonCampaignEngagementSend(metadata.operationId); schedule(1000) }
  try { if (!enqueue(scope,metadata.revision,'register',{ detailId:String(detailId),source:metadata })) recover() }
  catch { recover() }
}
function pendingSendMatches(scope: Scope, accountId: number, ownUid: string, targetUid?: string): boolean {
  return scope.items.some(item => {
    if (item.mode!=='hold' && item.mode!=='recover') return false
    if (recoveryExpired(item)) return false
    const source=item.payload as Hold
    return source.accountId===String(accountId) && source.accountZaloUid===ownUid &&
      (targetUid===undefined || source.targetZaloUid===targetUid)
  })
}
export function receiveCampaignEngagement(type: string, payload: unknown, accountId: number, ownUid: string): void {
  const receivedAt=new Date().toISOString(), ownerCurrent=captureOwner(); engagementMetrics.received++
  const user=getCurrentUser(), scope=user ? scopes.get(`${user.organizationId}-${user.staffId}`) : undefined
  if (!scope?.active() || !ownerCurrent()) { engagementMetrics.filtered++; return }
  if (!watches.hasAccount(accountId,ownUid) && !pendingSendMatches(scope,accountId,ownUid)) { engagementMetrics.filtered++; return }
  // Unknown/evicted metadata is deliberately dropped: no journal, wake or DB lookup.
  // A local send hold covers the short interval before its successful registration.
  const events=normalizeEngagementEvent(type,payload,String(accountId),ownUid,receivedAt).filter(event=>
    watches.mayMatch(event) || pendingSendMatches(scope,accountId,ownUid,event.targetZaloUid))
  if (!events.length) { engagementMetrics.filtered++; return }
  const value=config.currentOrRefresh()
  if (!value?.enabled || Date.parse(value.revision)>Date.parse(receivedAt)) return
  for (const event of events) enqueue(scope,value.revision,'record',event,randomUUID(),Date.parse(receivedAt))
}

/** Legacy Server has autonomous staff runtimes, not a Desktop login. Its existing
 * owner credentials are loaded lazily once into main-process RAM after admission.
 * Never send them to AuthUser, sockets, renderer, logs or the metadata journal. */
async function prepareServerOwner(explicitOwner?: ServerOwner): Promise<void> {
  const user=getCurrentUser()
  const owner=explicitOwner || (user ? serverOwners.get(`${user.organizationId}-${user.staffId}`) : undefined)
  if (!owner?.active || owner.credentials || Date.now()<owner.retryAt) return
  if (owner.pending) return owner.pending
  owner.pending=(async () => {
    try {
      const { data,error }=await getSupabaseClient().from('org_staff').select('username,password')
        .eq('id',owner.staffId).eq('organization_id',owner.organizationId).eq('is_active',true)
        .abortSignal(AbortSignal.timeout(5_000)).maybeSingle()
      if (error || !data?.username || !data?.password) throw new Error('owner_auth_unavailable')
      if (owner.active) owner.credentials={ username:String(data.username),password:String(data.password) }
    } catch { owner.retryAt=Date.now()+60_000; warn('server_owner_auth_unavailable') }
  })().finally(()=>{ owner.pending=undefined })
  return owner.pending
}
export function attachServerCampaignEngagementOwner(staffId: number, organizationId: number): () => void {
  const key=`${organizationId}-${staffId}`
  const previousOwner=serverOwners.get(key)
  if (previousOwner) { previousOwner.active=false; previousOwner.credentials=undefined }
  const owner: ServerOwner={ staffId,organizationId,active:true,retryAt:0 }
  serverOwners.set(key,owner)
  // Rebind the same owner's RAM scope; never wait for journal IO during admission
  // and never create overlapping writers for the same file on replacement.
  config.currentOrRefresh()
  if (serverOwners.get(key)===owner) resumeScope(getScope(owner))
  return () => {
    owner.active=false; owner.credentials=undefined
    if (serverOwners.get(key)!==owner) return
    serverOwners.delete(key)
    const scope=scopes.get(key)
    if (scope) {
      scope.credentials=undefined
      void scope.ready.then(()=>persist(scope,true)).then(()=>{ if (!scope.active() && scopes.get(key)===scope) scopes.delete(key) })
    }
  }
}
export function campaignEngagementEnabled(): boolean {
  try { return config.currentOrRefresh()?.enabled === true } catch { return false }
}
