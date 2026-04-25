import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { config as loadEnv } from 'dotenv'
import { bootstrap, type AppContext } from '../../src/bootstrap.js'
import { IPC_CHANNELS } from '../../shared/ipcChannels.js'

// Load .env file from repo root
loadEnv({ path: join(process.cwd(), '..', '..', '.env') })
loadEnv({ path: join(process.cwd(), '.env') })

let mainWindow: BrowserWindow | null = null
let appContext: AppContext | null = null

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    title: 'akaBiz Auto v2',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    await mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
    mainWindow.webContents.openDevTools()
  } else {
    await mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

async function setupIpc(): Promise<void> {
  if (!appContext) return
  const ctx = appContext

  // ===== WORKFLOW =====
  ipcMain.handle(IPC_CHANNELS.WORKFLOW_LIST, async () => {
    const { data, error } = await ctx.supabase.from('workflows')
      .select('id, name, description, is_active, is_block, current_version, updated_at')
      .order('updated_at', { ascending: false })
      .limit(100)
    if (error) throw new Error(error.message)
    return data ?? []
  })

  ipcMain.handle(IPC_CHANNELS.WORKFLOW_GET, async (_e, id: string, version?: number) => {
    const { data: wf, error: wfErr } = await ctx.supabase.from('workflows')
      .select('*').eq('id', id).single()
    if (wfErr) throw new Error(wfErr.message)
    const targetVersion = version ?? Number(wf.current_version ?? 1)
    const { data: rev, error: revErr } = await ctx.supabase.from('workflow_revisions')
      .select('*').eq('workflow_id', id).eq('version', targetVersion).single()
    if (revErr) throw new Error(revErr.message)
    return { workflow: wf, revision: rev }
  })

  ipcMain.handle(IPC_CHANNELS.WORKFLOW_SAVE, async (_e, args: {
    id: string
    name: string
    description?: string | null
    isBlock?: boolean
    graph: { nodes: unknown[]; edges: unknown[]; variables?: unknown[]; inputSchema?: unknown[]; outputSchema?: unknown[] }
    bumpVersion?: boolean
  }) => {
    // Get current_version
    const { data: existing } = await ctx.supabase.from('workflows').select('current_version').eq('id', args.id).single()
    const currentVer = existing?.current_version ? Number(existing.current_version) : 0
    const newVer = args.bumpVersion || !existing ? currentVer + 1 : currentVer

    // Upsert workflow
    const wfPayload: Record<string, unknown> = {
      id: args.id,
      name: args.name,
      description: args.description ?? null,
      is_active: true,
      is_block: args.isBlock ?? false,
      current_version: newVer,
      updated_at: new Date().toISOString()
    }
    const { error: wfErr } = await ctx.supabase.from('workflows').upsert(wfPayload)
    if (wfErr) throw new Error(`save workflow failed: ${wfErr.message}`)

    // Upsert revision
    const { error: revErr } = await ctx.supabase.from('workflow_revisions').upsert({
      workflow_id: args.id,
      version: newVer,
      graph: args.graph,
      is_published: true
    })
    if (revErr) throw new Error(`save revision failed: ${revErr.message}`)

    return { id: args.id, version: newVer }
  })

  ipcMain.handle(IPC_CHANNELS.WORKFLOW_CREATE, async (_e, args: { name: string; description?: string }) => {
    const id = randomUUID()
    const { error } = await ctx.supabase.from('workflows').insert({
      id,
      name: args.name,
      description: args.description ?? null,
      is_active: true,
      is_block: false,
      current_version: 1
    })
    if (error) throw new Error(error.message)
    // Create empty revision v1
    const { error: revErr } = await ctx.supabase.from('workflow_revisions').insert({
      workflow_id: id,
      version: 1,
      graph: { nodes: [], edges: [], variables: [], inputSchema: [], outputSchema: [] },
      is_published: true
    })
    if (revErr) throw new Error(revErr.message)
    return { id }
  })

  ipcMain.handle(IPC_CHANNELS.WORKFLOW_DELETE, async (_e, id: string) => {
    const { error } = await ctx.supabase.from('workflows').delete().eq('id', id)
    if (error) throw new Error(error.message)
    return { ok: true }
  })

  // ===== RUN =====
  ipcMain.handle(IPC_CHANNELS.RUN_ENQUEUE, async (_e, args: {
    workflowId: string
    channelId?: string
    input: Record<string, unknown>
    workflowVersion?: number
  }) => {
    const enqueueArgs: Parameters<typeof ctx.engine.enqueue>[0] = {
      workflowId: args.workflowId,
      input: args.input
    }
    if (args.channelId) enqueueArgs.channelId = args.channelId
    if (args.workflowVersion) enqueueArgs.workflowVersion = args.workflowVersion

    // Hook run.start to register channel for dispatcher (cho screenshot/forensic)
    let captured = false
    const captureHandler = (event: import('@akabiz/engine').ProgressEvent): void => {
      if (!captured && event.kind === 'run.start') {
        captured = true
        ctx.progressDispatcher.registerRunChannel(event.runId, args.channelId ?? null)
      }
    }
    ctx.engine.on('progress', captureHandler)

    try {
      const result = await ctx.engine.enqueue(enqueueArgs)
      return result
    } finally {
      ctx.engine.off('progress', captureHandler)
    }
  })

  ipcMain.handle(IPC_CHANNELS.RUN_LIST, async (_e, opts: { workflowId?: string; limit?: number } = {}) => {
    let query = ctx.supabase.from('runs')
      .select('id, workflow_id, workflow_version, channel_id, status, started_at, finished_at, duration_ms, error')
      .order('started_at', { ascending: false })
      .limit(opts.limit ?? 50)
    if (opts.workflowId) query = query.eq('workflow_id', opts.workflowId)
    const { data, error } = await query
    if (error) throw new Error(error.message)
    return data ?? []
  })

  ipcMain.handle(IPC_CHANNELS.RUN_GET_STEPS, async (_e, runId: string) => {
    const { data, error } = await ctx.supabase.from('run_steps')
      .select('*').eq('run_id', runId).order('started_at', { ascending: true })
    if (error) throw new Error(error.message)
    return data ?? []
  })

  // ===== CHANNEL =====
  ipcMain.handle(IPC_CHANNELS.CHANNEL_LIST, async () => {
    const { data, error } = await ctx.supabase.from('channels')
      .select('id, name, channel_type, status')
      .order('name')
    if (error) throw new Error(error.message)
    return data ?? []
  })

  ipcMain.handle(IPC_CHANNELS.CHANNEL_REGISTER, async (_e, channelId: string) => {
    const { data: channel, error } = await ctx.supabase.from('channels').select('*').eq('id', channelId).single()
    if (error || !channel) throw new Error(`Channel '${channelId}' not found`)
    ctx.channelManager.registerChannel({
      id: String(channel.id),
      name: String(channel.name),
      channelType: channel.channel_type as 'browser_persistent' | 'browser_ephemeral' | 'headless_node',
      ...(channel.profile_path ? { profileBaseDir: String(channel.profile_path) } : {}),
      ...(channel.user_agent ? { userAgent: String(channel.user_agent) } : {}),
      ...(channel.locale ? { locale: String(channel.locale) } : {}),
      ...(channel.timezone ? { timezoneId: String(channel.timezone) } : {}),
      ...(channel.proxy_url ? { proxyUrl: String(channel.proxy_url) } : {}),
      headless: false
    })
    return { ok: true }
  })

  // ===== BLOCK REGISTRY =====
  ipcMain.handle(IPC_CHANNELS.BLOCK_LIST, async () => {
    return ctx.registry.list()
  })

  // ===== NAMED SELECTORS =====
  ipcMain.handle(IPC_CHANNELS.SELECTOR_LIST, async () => {
    const { data, error } = await ctx.supabase.from('named_selectors').select('*').order('name')
    if (error) throw new Error(error.message)
    return data ?? []
  })

  ipcMain.handle(IPC_CHANNELS.SELECTOR_GET_BY_NAME, async (_e, name: string) => {
    const { data, error } = await ctx.supabase.from('named_selectors').select('*').eq('name', name).maybeSingle()
    if (error) throw new Error(error.message)
    return data
  })

  ipcMain.handle(IPC_CHANNELS.SELECTOR_SAVE, async (_e, args: {
    id?: string
    name: string
    domain?: string | null
    description?: string | null
    selectorType: 'css' | 'xpath' | 'text-match'
    expression: string
    fallbacks?: Array<{ type: string; expression: string }>
  }) => {
    const payload: Record<string, unknown> = {
      name: args.name,
      domain: args.domain ?? null,
      description: args.description ?? null,
      selector_type: args.selectorType,
      expression: args.expression,
      fallbacks: args.fallbacks ?? null,
      updated_at: new Date().toISOString()
    }
    if (args.id) {
      payload.id = args.id
      const { data, error } = await ctx.supabase.from('named_selectors').upsert(payload).select().single()
      if (error) throw new Error(error.message)
      return data
    } else {
      const { data, error } = await ctx.supabase.from('named_selectors').insert(payload).select().single()
      if (error) throw new Error(error.message)
      return data
    }
  })

  ipcMain.handle(IPC_CHANNELS.SELECTOR_DELETE, async (_e, id: string) => {
    const { error } = await ctx.supabase.from('named_selectors').delete().eq('id', id)
    if (error) throw new Error(error.message)
    return { ok: true }
  })

  // ===== ELEMENT PICKER =====
  ipcMain.handle(IPC_CHANNELS.PICKER_START, async (_e, args: { channelId: string; url?: string }) => {
    // Caller phải register channel trước (channel:register)
    const result = await ctx.elementPicker.pick(args)
    return result
  })

  ipcMain.handle(IPC_CHANNELS.PICKER_CANCEL, async () => {
    ctx.elementPicker.cancel()
    return { ok: true }
  })

  // ===== DATATABLES =====
  ipcMain.handle(IPC_CHANNELS.DATATABLE_LIST, async () => {
    const { data, error } = await ctx.supabase.from('datatables').select('*').order('name')
    if (error) throw new Error(error.message)
    return data ?? []
  })

  ipcMain.handle(IPC_CHANNELS.DATATABLE_GET, async (_e, id: string) => {
    const { data, error } = await ctx.supabase.from('datatables').select('*').eq('id', id).single()
    if (error) throw new Error(error.message)
    return data
  })

  ipcMain.handle(IPC_CHANNELS.DATATABLE_SAVE, async (_e, args: { id?: string; name: string; description?: string | null; schema: unknown[] }) => {
    const payload: Record<string, unknown> = {
      name: args.name,
      description: args.description ?? null,
      schema: args.schema
    }
    if (args.id) {
      payload.id = args.id
      const { data, error } = await ctx.supabase.from('datatables').upsert(payload).select().single()
      if (error) throw new Error(error.message)
      return data
    } else {
      const { data, error } = await ctx.supabase.from('datatables').insert(payload).select().single()
      if (error) throw new Error(error.message)
      return data
    }
  })

  ipcMain.handle(IPC_CHANNELS.DATATABLE_DELETE, async (_e, id: string) => {
    const { error } = await ctx.supabase.from('datatables').delete().eq('id', id)
    if (error) throw new Error(error.message)
    return { ok: true }
  })

  ipcMain.handle(IPC_CHANNELS.DATATABLE_ROWS_LIST, async (_e, args: { datatableId: string; status?: string; limit?: number }) => {
    let q = ctx.supabase.from('datatable_rows').select('*').eq('datatable_id', args.datatableId)
      .order('created_at', { ascending: true })
      .limit(args.limit ?? 200)
    if (args.status) q = q.eq('status', args.status)
    const { data, error } = await q
    if (error) throw new Error(error.message)
    return data ?? []
  })

  ipcMain.handle(IPC_CHANNELS.DATATABLE_ROW_SAVE, async (_e, args: { id?: string; datatableId: string; data: Record<string, unknown>; status?: string; tags?: string[] }) => {
    const payload: Record<string, unknown> = {
      datatable_id: args.datatableId,
      data: args.data,
      status: args.status ?? 'pending',
      tags: args.tags ?? null,
      updated_at: new Date().toISOString()
    }
    if (args.id) {
      payload.id = args.id
      const { data, error } = await ctx.supabase.from('datatable_rows').upsert(payload).select().single()
      if (error) throw new Error(error.message)
      return data
    } else {
      const { data, error } = await ctx.supabase.from('datatable_rows').insert(payload).select().single()
      if (error) throw new Error(error.message)
      return data
    }
  })

  ipcMain.handle(IPC_CHANNELS.DATATABLE_ROW_DELETE, async (_e, id: string) => {
    const { error } = await ctx.supabase.from('datatable_rows').delete().eq('id', id)
    if (error) throw new Error(error.message)
    return { ok: true }
  })

  ipcMain.handle(IPC_CHANNELS.DATATABLE_ROW_RESET, async (_e, id: string) => {
    const { error } = await ctx.supabase.from('datatable_rows')
      .update({ status: 'pending', retry_count: 0 }).eq('id', id)
    if (error) throw new Error(error.message)
    return { ok: true }
  })

  // ===== TRIGGERS =====
  ipcMain.handle(IPC_CHANNELS.TRIGGER_LIST, async () => {
    const { data, error } = await ctx.supabase.from('triggers').select('*').order('created_at', { ascending: false })
    if (error) throw new Error(error.message)
    return data ?? []
  })

  ipcMain.handle(IPC_CHANNELS.TRIGGER_SAVE, async (_e, args: {
    id?: string
    workflow_id: string
    workflow_version?: number | null
    channel_id?: string | null
    datatable_id?: string | null
    datatable_filter?: Record<string, unknown> | null
    kind: 'manual' | 'schedule' | 'webhook' | 'event'
    config: Record<string, unknown>
    settings?: Record<string, unknown> | null
    is_active?: boolean
  }) => {
    // Compute next_run_at if schedule
    let nextRunAt: string | null = null
    if (args.kind === 'schedule' && args.config?.cron) {
      try {
        const { Cron } = await import('croner')
        const cron = new Cron(String(args.config.cron), { timezone: String(args.config.timezone ?? 'UTC') })
        const next = cron.nextRun()
        nextRunAt = next ? next.toISOString() : null
      } catch (err) {
        console.warn('[trigger:save] invalid cron:', err)
      }
    }
    const payload: Record<string, unknown> = {
      workflow_id: args.workflow_id,
      workflow_version: args.workflow_version ?? null,
      channel_id: args.channel_id ?? null,
      datatable_id: args.datatable_id ?? null,
      datatable_filter: args.datatable_filter ?? null,
      kind: args.kind,
      config: args.config,
      settings: args.settings ?? null,
      is_active: args.is_active ?? true,
      next_run_at: nextRunAt
    }
    if (args.id) {
      payload.id = args.id
      const { data, error } = await ctx.supabase.from('triggers').upsert(payload).select().single()
      if (error) throw new Error(error.message)
      return data
    } else {
      const { data, error } = await ctx.supabase.from('triggers').insert(payload).select().single()
      if (error) throw new Error(error.message)
      return data
    }
  })

  ipcMain.handle(IPC_CHANNELS.TRIGGER_DELETE, async (_e, id: string) => {
    const { error } = await ctx.supabase.from('triggers').delete().eq('id', id)
    if (error) throw new Error(error.message)
    return { ok: true }
  })

  ipcMain.handle(IPC_CHANNELS.TRIGGER_RUN_NOW, async (_e, id: string) => {
    const { data: trigger, error } = await ctx.supabase.from('triggers').select('*').eq('id', id).single()
    if (error || !trigger) throw new Error(error?.message ?? 'Trigger not found')
    // Make sure channel registered
    if (trigger.channel_id) {
      try {
        const { data: ch } = await ctx.supabase.from('channels').select('*').eq('id', trigger.channel_id).single()
        if (ch) {
          ctx.channelManager.registerChannel({
            id: String(ch.id),
            name: String(ch.name),
            channelType: ch.channel_type as 'browser_persistent' | 'browser_ephemeral' | 'headless_node',
            ...(ch.profile_path ? { profileBaseDir: String(ch.profile_path) } : {}),
            ...(ch.user_agent ? { userAgent: String(ch.user_agent) } : {}),
            headless: false
          })
        }
      } catch {}
    }
    // Fire trigger now
    await ctx.orchestrator.enqueueFromTrigger(trigger as Parameters<typeof ctx.orchestrator.enqueueFromTrigger>[0])
    return { ok: true }
  })

  // ===== CONNECTIONS =====
  ipcMain.handle(IPC_CHANNELS.CONNECTION_LIST, async () => {
    const { data, error } = await ctx.supabase.from('connections')
      .select('id, name, conn_type, scope, organization_id, created_at')
      .order('name')
    if (error) throw new Error(error.message)
    return data ?? []
  })

  ipcMain.handle(IPC_CHANNELS.CONNECTION_SAVE, async (_e, args: {
    id?: string
    name: string
    conn_type: 'oauth2' | 'apikey' | 'basicauth' | 'cookie' | 'custom'
    secrets: Record<string, string>
    scope?: Record<string, unknown> | null
  }) => {
    const encrypted = ctx.connectionVault.encryptToBuffer(args.secrets)
    const payload: Record<string, unknown> = {
      name: args.name,
      conn_type: args.conn_type,
      data_encrypted: encrypted,
      scope: args.scope ?? null
    }
    if (args.id) {
      payload.id = args.id
      const { data, error } = await ctx.supabase.from('connections').upsert(payload).select('id, name, conn_type, scope, organization_id, created_at').single()
      if (error) throw new Error(error.message)
      return data
    } else {
      const { data, error } = await ctx.supabase.from('connections').insert(payload).select('id, name, conn_type, scope, organization_id, created_at').single()
      if (error) throw new Error(error.message)
      return data
    }
  })

  ipcMain.handle(IPC_CHANNELS.CONNECTION_DELETE, async (_e, id: string) => {
    const { error } = await ctx.supabase.from('connections').delete().eq('id', id)
    if (error) throw new Error(error.message)
    return { ok: true }
  })

  // ===== CAMPAIGN VIEWS =====
  ipcMain.handle(IPC_CHANNELS.CAMPAIGNVIEW_LIST, async () => {
    const { data, error } = await ctx.supabase.from('campaign_views').select('*').order('created_at', { ascending: false })
    if (error) throw new Error(error.message)
    return data ?? []
  })

  ipcMain.handle(IPC_CHANNELS.CAMPAIGNVIEW_SAVE, async (_e, args: {
    id?: string
    name: string
    description?: string | null
    workflow_id?: string | null
    trigger_id?: string | null
    datatable_id?: string | null
  }) => {
    const payload: Record<string, unknown> = {
      name: args.name,
      description: args.description ?? null,
      workflow_id: args.workflow_id ?? null,
      trigger_id: args.trigger_id ?? null,
      datatable_id: args.datatable_id ?? null
    }
    if (args.id) {
      payload.id = args.id
      const { data, error } = await ctx.supabase.from('campaign_views').upsert(payload).select().single()
      if (error) throw new Error(error.message)
      return data
    } else {
      const { data, error } = await ctx.supabase.from('campaign_views').insert(payload).select().single()
      if (error) throw new Error(error.message)
      return data
    }
  })

  ipcMain.handle(IPC_CHANNELS.CAMPAIGNVIEW_DELETE, async (_e, id: string) => {
    const { error } = await ctx.supabase.from('campaign_views').delete().eq('id', id)
    if (error) throw new Error(error.message)
    return { ok: true }
  })

  // ===== CHANNELS CRUD =====
  ipcMain.handle(IPC_CHANNELS.CHANNEL_SAVE, async (_e, args: {
    id?: string
    name: string
    channel_type: 'browser_persistent' | 'browser_ephemeral' | 'headless_node'
    profile_path?: string | null
    user_agent?: string | null
    locale?: string | null
    timezone?: string | null
    proxy_url?: string | null
  }) => {
    const payload: Record<string, unknown> = {
      name: args.name,
      channel_type: args.channel_type,
      profile_path: args.profile_path ?? null,
      user_agent: args.user_agent ?? null,
      locale: args.locale ?? null,
      timezone: args.timezone ?? null,
      proxy_url: args.proxy_url ?? null,
      updated_at: new Date().toISOString()
    }
    if (args.id) {
      payload.id = args.id
      const { data, error } = await ctx.supabase.from('channels').upsert(payload).select().single()
      if (error) throw new Error(error.message)
      return data
    } else {
      const { data, error } = await ctx.supabase.from('channels').insert(payload).select().single()
      if (error) throw new Error(error.message)
      return data
    }
  })

  ipcMain.handle(IPC_CHANNELS.CHANNEL_DELETE, async (_e, id: string) => {
    const { error } = await ctx.supabase.from('channels').delete().eq('id', id)
    if (error) throw new Error(error.message)
    return { ok: true }
  })

  // ===== CAMPAIGN LOGS =====
  ipcMain.handle(IPC_CHANNELS.CAMPAIGNLOG_LIST, async (_e, opts: {
    campaignViewId?: string
    workflowId?: string
    runId?: string
    datatableRowId?: string
    limit?: number
  } = {}) => {
    let q = ctx.supabase.from('campaign_logs')
      .select('*')
      .order('ts', { ascending: false })
      .limit(opts.limit ?? 200)
    if (opts.campaignViewId) q = q.eq('campaign_view_id', opts.campaignViewId)
    if (opts.workflowId) q = q.eq('workflow_id', opts.workflowId)
    if (opts.runId) q = q.eq('run_id', opts.runId)
    if (opts.datatableRowId) q = q.eq('datatable_row_id', opts.datatableRowId)
    const { data, error } = await q
    if (error) throw new Error(error.message)
    return data ?? []
  })

  // ===== CUSTOM BLOCKS (Phase 10) =====
  ipcMain.handle(IPC_CHANNELS.CUSTOMBLOCK_LIST, async () => {
    const { data, error } = await ctx.supabase.from('blocks').select('*').order('manifest_id')
    if (error) throw new Error(error.message)
    return data ?? []
  })

  ipcMain.handle(IPC_CHANNELS.CUSTOMBLOCK_SAVE, async (_e, args: {
    manifest_id: string
    name: string
    version: string
    kind: 'core' | 'adapter' | 'code' | 'composite'
    runtime: 'control' | 'page' | 'node' | 'composite'
    requires: 'browser' | 'none'
    manifest: Record<string, unknown>
    code?: string | null
    workflow_ref?: string | null
    source?: string
  }) => {
    const payload: Record<string, unknown> = {
      manifest_id: args.manifest_id,
      name: args.name,
      version: args.version,
      kind: args.kind,
      runtime: args.runtime,
      requires: args.requires,
      manifest: args.manifest,
      code: args.code ?? null,
      workflow_ref: args.workflow_ref ?? null,
      source: args.source ?? 'user',
      updated_at: new Date().toISOString()
    }
    const { data, error } = await ctx.supabase.from('blocks').upsert(payload).select().single()
    if (error) throw new Error(error.message)

    // Re-register into engine registry so usable immediately
    try {
      const enriched = {
        ...args.manifest,
        manifestId: args.manifest_id,
        name: args.name,
        version: args.version,
        kind: args.kind,
        runtime: args.runtime,
        requires: args.requires,
        ...(args.code ? { code: args.code } : {}),
        ...(args.workflow_ref ? { workflowRef: args.workflow_ref } : {})
      }
      ctx.registry.upsert(enriched as Parameters<typeof ctx.registry.upsert>[0])
    } catch (err) {
      console.warn('[main] re-register block error:', err)
    }
    return data
  })

  ipcMain.handle(IPC_CHANNELS.CUSTOMBLOCK_DELETE, async (_e, manifestId: string) => {
    const { error } = await ctx.supabase.from('blocks').delete().eq('manifest_id', manifestId)
    if (error) throw new Error(error.message)
    return { ok: true }
  })

  // ===== ProgressDispatcher: fan-out tới sinks + realtime broadcast =====
  ctx.progressDispatcher.setRealtimeBroadcast((event) => {
    mainWindow?.webContents.send(IPC_CHANNELS.RUN_PROGRESS, event)
  })
  ctx.engine.on('progress', (event) => {
    ctx.progressDispatcher.handle(event)
  })
}

app.whenReady().then(async () => {
  try {
    const supabaseUrl = process.env.SUPABASE_URL
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY
    const vaultKey = process.env.CONN_VAULT_KEY ?? 'dev-vault-key-change-me-1234'

    if (!supabaseUrl || !supabaseKey) {
      console.error('SUPABASE_URL and SUPABASE_SERVICE_KEY env required')
      app.quit()
      return
    }

    console.log('[main] Bootstrapping app...')
    appContext = await bootstrap({ supabaseUrl, supabaseKey, vaultKey })
    console.log('[main] Recovering inflight runs...')
    await appContext.orchestrator.recoverInflight()
    console.log('[main] Starting trigger service...')
    appContext.triggerService.start()
    console.log('[main] Ready')

    await setupIpc()
    await createWindow()
  } catch (err) {
    console.error('[main] Bootstrap error:', err)
    app.quit()
  }
})

app.on('window-all-closed', async () => {
  if (appContext) await appContext.shutdown()
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) void createWindow()
})
