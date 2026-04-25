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
    const result = await ctx.engine.enqueue(enqueueArgs)
    return result
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

  // ===== Forward ProgressEvent → renderer =====
  ctx.engine.on('progress', (event) => {
    mainWindow?.webContents.send(IPC_CHANNELS.RUN_PROGRESS, event)
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
