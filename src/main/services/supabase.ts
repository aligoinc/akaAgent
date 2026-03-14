import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { FlowData, ExecutionRun, ExecutionStep } from '../../shared/types'
import * as dotenv from 'dotenv'
import { join } from 'path'

// Try to load .env from root if available in dev
dotenv.config({ path: join(process.cwd(), '.env') })

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://swggxlwfgwzzoszvolbm.supabase.co'
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'dummy_key_to_prevent_crash'

export class SupabaseService {
  private client: SupabaseClient

  constructor() {
    try {
      this.client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    } catch (e) {
      console.error('Failed to initialize Supabase client:', e)
      // Fallback dummy client so app doesn't crash
      this.client = createClient('https://dummy.supabase.co', 'dummy')
    }
  }

  // =========== FLOWS ===========

  async saveFlow(flowData: FlowData): Promise<FlowData> {
    const payload = {
      id: flowData.id,
      name: flowData.name,
      description: flowData.description || '',
      nodes: flowData.nodes,
      edges: flowData.edges,
      variables: flowData.variables || {},
      input_schema: flowData.inputSchema || {},
      output_schema: flowData.outputSchema || {},
      is_block: flowData.isBlock || false,
      updated_at: new Date().toISOString()
    }

    const { data, error } = await this.client
      .from('auto_flows')
      .upsert(payload)
      .select()
      .single()

    if (error) throw new Error(`Failed to save flow: ${error.message}`)
    return this.mapFlowFromDB(data)
  }

  async loadFlow(flowId: string): Promise<FlowData | null> {
    const { data, error } = await this.client
      .from('auto_flows')
      .select('*')
      .eq('id', flowId)
      .single()

    if (error) return null
    return this.mapFlowFromDB(data)
  }

  async listFlows(): Promise<FlowData[]> {
    const { data, error } = await this.client
      .from('auto_flows')
      .select('*')
      .order('updated_at', { ascending: false })

    if (error) throw new Error(`Failed to list flows: ${error.message}`)
    return (data || []).map(this.mapFlowFromDB)
  }

  async deleteFlow(flowId: string): Promise<void> {
    const { error } = await this.client
      .from('auto_flows')
      .delete()
      .eq('id', flowId)

    if (error) throw new Error(`Failed to delete flow: ${error.message}`)
  }

  // =========== ELEMENTS ===========

  async saveElement(element: Omit<import('../../shared/types').ElementDefinition, 'createdAt' | 'updatedAt'>): Promise<import('../../shared/types').ElementDefinition> {
    const payload = {
      id: element.id,
      name: element.name,
      xpath: element.xpath,
      description: element.description || '',
      updated_at: new Date().toISOString()
    }

    const { data, error } = await this.client
      .from('auto_elements')
      .upsert(payload)
      .select()
      .single()

    if (error) throw new Error(`Failed to save element: ${error.message}`)
    return this.mapElementFromDB(data)
  }

  async listElements(): Promise<import('../../shared/types').ElementDefinition[]> {
    const { data, error } = await this.client
      .from('auto_elements')
      .select('*')
      .order('updated_at', { ascending: false })

    if (error) throw new Error(`Failed to list elements: ${error.message}`)
    return (data || []).map(row => this.mapElementFromDB(row))
  }

  async deleteElement(elementId: string): Promise<void> {
    const { error } = await this.client
      .from('auto_elements')
      .delete()
      .eq('id', elementId)

    if (error) throw new Error(`Failed to delete element: ${error.message}`)
  }

  // =========== RUN HISTORY ===========

  async createRun(run: ExecutionRun): Promise<void> {
    const runPayload = {
      id: run.id,
      flow_id: run.flowId,
      workflow_id: run.workflowId || null,
      status: run.status,
      input: run.input,
      started_at: run.startedAt
    }

    const { error: runError } = await this.client
      .from('auto_runs')
      .insert(runPayload)

    if (runError) throw new Error(`Failed to create run: ${runError.message}`)
  }

  async updateRun(runId: string, status: string, output: Record<string, unknown>, errorStr?: string, completedAt?: string): Promise<void> {
    const payload: any = { status, output }
    if (errorStr) payload.error = errorStr
    if (completedAt) payload.completed_at = completedAt

    const { error } = await this.client
      .from('auto_runs')
      .update(payload)
      .eq('id', runId)

    if (error) throw new Error(`Failed to update run: ${error.message}`)
  }

  async createRunStep(runId: string, step: ExecutionStep): Promise<void> {
    const stepsPayload = {
      run_id: runId,
      node_id: step.nodeId,
      action_type: step.actionType,
      status: step.status,
      input: step.input,
      output: step.output,
      screenshot_url: step.screenshotUrl || null,
      error: step.error || null,
      duration_ms: step.durationMs || null,
      executed_at: step.executedAt
    }

    const { error: stepsError } = await this.client
      .from('auto_run_steps')
      .insert(stepsPayload)

    if (stepsError) throw new Error(`Failed to save run step: ${stepsError.message}`)
  }

  async listRuns(flowId?: string): Promise<ExecutionRun[]> {
    let query = this.client
      .from('auto_runs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50)

    if (flowId) {
      query = query.eq('flow_id', flowId)
    }

    const { data, error } = await query
    if (error) throw new Error(`Failed to list runs: ${error.message}`)
    return (data || []).map(row => this.mapRunFromDB(row))
  }

  async listRunSteps(runId: string): Promise<ExecutionStep[]> {
    const { data, error } = await this.client
      .from('auto_run_steps')
      .select('*')
      .eq('run_id', runId)
      .order('executed_at', { ascending: true })

    if (error) throw new Error(`Failed to list run steps: ${error.message}`)
    return (data || []).map(row => this.mapRunStepFromDB(row))
  }

  // =========== MAPPERS ===========

  private mapFlowFromDB(row: Record<string, unknown>): FlowData {
    return {
      id: row.id as string,
      name: row.name as string,
      description: row.description as string,
      nodes: row.nodes as FlowData['nodes'],
      edges: row.edges as FlowData['edges'],
      variables: row.variables as Record<string, unknown>,
      inputSchema: row.input_schema as FlowData['inputSchema'],
      outputSchema: row.output_schema as FlowData['outputSchema'],
      isBlock: row.is_block as boolean,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string
    }
  }

  private mapRunFromDB(row: Record<string, unknown>): ExecutionRun {
    return {
      id: row.id as string,
      flowId: row.flow_id as string,
      workflowId: row.workflow_id as string | undefined,
      status: row.status as ExecutionRun['status'],
      input: row.input as Record<string, unknown>,
      output: row.output as Record<string, unknown>,
      steps: [],
      startedAt: row.started_at as string,
      completedAt: row.completed_at as string,
      error: row.error as string | undefined
    }
  }

  private mapRunStepFromDB(row: Record<string, unknown>): ExecutionStep {
    return {
      nodeId: row.node_id as string,
      actionType: row.action_type as import('../../shared/types').ActionType,
      status: row.status as ExecutionStep['status'],
      input: row.input as Record<string, unknown>,
      output: row.output as Record<string, unknown>,
      screenshotUrl: row.screenshot_url as string | undefined,
      error: row.error as string | undefined,
      durationMs: row.duration_ms as number | undefined,
      executedAt: row.executed_at as string
    }
  }

  private mapElementFromDB(row: Record<string, unknown>): import('../../shared/types').ElementDefinition {
    return {
      id: row.id as string,
      name: row.name as string,
      xpath: row.xpath as string,
      description: row.description as string,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string
    }
  }
}

