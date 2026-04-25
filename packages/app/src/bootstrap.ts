import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import {
  BlockRegistry, WorkflowEngine,
  registerCorePrimitives, registerDataTablePrimitives, registerBrowserPrimitives,
  type Workflow
} from '@akabiz/engine'
import { ChannelManager } from './services/ChannelManager.js'
import { ConnectionVault } from './services/ConnectionVault.js'
import { RunOrchestrator } from './services/RunOrchestrator.js'
import { TriggerService } from './services/TriggerService.js'
import { SupabaseRunPersistence } from './repositories/SupabaseRunPersistence.js'
import { SupabaseDataTableProvider } from './repositories/SupabaseDataTableProvider.js'

/**
 * Bootstrap full app stack: Supabase + engine + services.
 *
 * Usage (CLI / Electron main):
 *   const ctx = await bootstrap({ supabaseUrl, supabaseKey, vaultKey })
 *   ctx.channelManager.registerChannel({ id: 'ch1', ... })
 *   await ctx.engine.enqueue({ workflowId: '...', channelId: 'ch1', input: {} })
 *   ctx.triggerService.start()
 */

export interface BootstrapOptions {
  supabaseUrl: string
  supabaseKey: string
  vaultKey: string
}

export interface AppContext {
  supabase: SupabaseClient
  registry: BlockRegistry
  engine: WorkflowEngine
  channelManager: ChannelManager
  connectionVault: ConnectionVault
  dataTableProvider: SupabaseDataTableProvider
  persistence: SupabaseRunPersistence
  orchestrator: RunOrchestrator
  triggerService: TriggerService
  shutdown: () => Promise<void>
}

export async function bootstrap(opts: BootstrapOptions): Promise<AppContext> {
  // 1. Supabase client
  const supabase = createClient(opts.supabaseUrl, opts.supabaseKey, {
    auth: { persistSession: false }
  })

  // 2. Vault
  const connectionVault = new ConnectionVault(supabase, opts.vaultKey)

  // 3. Repositories
  const persistence = new SupabaseRunPersistence(supabase)
  const dataTableProvider = new SupabaseDataTableProvider(supabase)

  // 4. ChannelManager
  const channelManager = new ChannelManager()

  // 5. BlockRegistry + register primitives
  const registry = new BlockRegistry()
  registerCorePrimitives(registry)
  registerDataTablePrimitives(registry, dataTableProvider)
  registerBrowserPrimitives(registry)

  // 6. Workflow loader (from DB)
  const workflowLoader = async (id: string, version?: number): Promise<Workflow> => {
    const { data: wf, error } = await supabase.from('workflows').select('*').eq('id', id).single()
    if (error || !wf) throw new Error(`Workflow '${id}' not found: ${error?.message}`)

    // Pick revision: explicit version OR current_version
    const targetVersion = version ?? Number(wf.current_version ?? 1)
    const { data: rev, error: revErr } = await supabase.from('workflow_revisions')
      .select('*')
      .eq('workflow_id', id)
      .eq('version', targetVersion)
      .single()
    if (revErr || !rev) throw new Error(`Workflow '${id}' v${targetVersion} not found: ${revErr?.message}`)

    const graph = rev.graph as { nodes: unknown[]; edges: unknown[]; variables?: unknown[]; inputSchema?: unknown[]; outputSchema?: unknown[] }
    return {
      id: String(wf.id),
      name: String(wf.name),
      version: targetVersion,
      ...(wf.description ? { description: String(wf.description) } : {}),
      isBlock: Boolean(wf.is_block),
      inputSchema: (graph.inputSchema ?? []) as Workflow['inputSchema'],
      outputSchema: (graph.outputSchema ?? []) as Workflow['outputSchema'],
      variables: (graph.variables ?? []) as Workflow['variables'],
      triggers: [{ kind: 'manual', config: {} }],
      graph: {
        nodes: graph.nodes as Workflow['graph']['nodes'],
        edges: graph.edges as Workflow['graph']['edges']
      }
    }
  }

  // 7. Engine
  const engine = new WorkflowEngine({
    registry,
    workflowLoader,
    channelProvider: channelManager,
    vault: connectionVault,
    persistence
  })

  // 8. Orchestrator + TriggerService
  const orchestrator = new RunOrchestrator(engine, supabase, dataTableProvider)
  const triggerService = new TriggerService(supabase, orchestrator)

  return {
    supabase,
    registry,
    engine,
    channelManager,
    connectionVault,
    dataTableProvider,
    persistence,
    orchestrator,
    triggerService,
    async shutdown() {
      triggerService.stop()
      await channelManager.closeAll()
    }
  }
}
