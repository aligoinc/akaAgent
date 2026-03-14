import { PlaywrightController } from './controller'
import { FlowData, ExecutionStep, ExecutionRun, FlowNodeSerialized, FlowEdgeSerialized } from '../../shared/types'
import { builtinActions } from '../../shared/actions'
import { SupabaseService } from '../services/supabase'
import { v4 as uuidv4 } from 'uuid'

type ProgressCallback = (step: ExecutionStep) => void

export class FlowRunner {
  private controller: PlaywrightController
  private supabase: SupabaseService
  private onProgress: ProgressCallback
  private cancelled = false
  private nodeOutputs: Map<string, Record<string, unknown>> = new Map()
  private elementMap: Map<string, string> = new Map()

  constructor(controller: PlaywrightController, supabase: SupabaseService, onProgress: ProgressCallback) {
    this.controller = controller
    this.supabase = supabase
    this.onProgress = onProgress
  }

  stop(): void {
    this.cancelled = true
  }

  async run(flowData: FlowData): Promise<ExecutionRun> {
    this.cancelled = false
    this.nodeOutputs.clear()
    this.elementMap.clear()

    // Pre-load elements to resolve XPaths
    try {
      const elements = await this.supabase.listElements()
      for (const el of elements) {
        this.elementMap.set(el.id, el.xpath)
      }
    } catch (err) {
      console.warn('Failed to load elements for flow run. XPaths may not resolve.', err)
    }

    const run: ExecutionRun = {
      id: uuidv4(),
      flowId: flowData.id,
      status: 'running',
      input: flowData.variables || {},
      output: {},
      steps: [],
      startedAt: new Date().toISOString()
    }

    try {
      await this.supabase.createRun(run)
    } catch (err) {
      console.warn('Failed to insert initial run log:', err)
    }

    const blockOutputs: Record<string, unknown> = {}

    try {
      // Topological sort of nodes based on edges
      const sortedNodes = this.topologicalSort(flowData.nodes, flowData.edges)

      for (const node of sortedNodes) {
        if (this.cancelled) {
          run.status = 'cancelled'
          break
        }

        // Skip control flow nodes for now (Phase 4+)
        if (['ifElse', 'loop', 'switch'].includes(node.data.actionType)) {
          continue
        }

        const step: ExecutionStep = {
          nodeId: node.id,
          actionType: node.data.actionType,
          status: 'running',
          input: {},
          output: {},
          executedAt: new Date().toISOString()
        }

        this.onProgress({ ...step })

        // Resolve input values
        const resolvedInput = this.resolveInputs(node)
        step.input = resolvedInput

        // Execute action
        let result: { success: boolean; output: Record<string, unknown>; error?: string; durationMs?: number; screenshotBase64?: string }

        if (node.data.actionType === 'block') {
          const blockId = String(resolvedInput.blockId)
          const blockFlow = await this.supabase.loadFlow(blockId)
          if (!blockFlow) {
            result = { success: false, output: {}, error: 'Block not found in database', durationMs: 0 }
          } else {
            // Recursively execute block flow
            blockFlow.variables = resolvedInput
            const subRunner = new FlowRunner(this.controller, this.supabase, () => {}) // Sub-progress not emitted to avoid overlapping step UI
            
            const startT = Date.now()
            const subRun = await subRunner.run(blockFlow)
            const durationMs = Date.now() - startT
            
            if (subRun.status === 'completed') {
              result = { success: true, output: subRun.output, durationMs }
            } else {
              result = { success: false, output: subRun.output, error: subRun.error || 'Block execution failed', durationMs }
            }
          }
        } else if (node.data.actionType === 'blockInput') {
          const fieldName = String(node.data.config.fieldName || 'input')
          const defaultValue = node.data.config.defaultValue
          let val = flowData.variables?.[fieldName] ?? defaultValue
          
          // Auto-parse if it's a string that looks like JSON and we expect JSON
          if (typeof val === 'string' && (val.startsWith('{') || val.startsWith('['))) {
            try { val = JSON.parse(val) } catch {}
          }
          
          result = { success: true, output: { value: val }, durationMs: 0 }
        } else if (node.data.actionType === 'blockOutput') {
          const val = resolvedInput.value
          const fieldName = String(node.data.config.fieldName || 'output')
          blockOutputs[fieldName] = val
          result = { success: true, output: { [fieldName]: val }, durationMs: 0 }
        } else {
          result = await this.controller.executeAction(
            node.data.actionType,
            resolvedInput
          )
        }

        step.output = result.output
        step.durationMs = result.durationMs
        step.screenshotUrl = result.screenshotBase64
          ? `data:image/png;base64,${result.screenshotBase64}`
          : undefined

        if (result.success) {
          step.status = 'success'
          this.nodeOutputs.set(node.id, result.output)
        } else {
          step.status = 'error'
          step.error = result.error
        }

        this.onProgress({ ...step })
        run.steps.push(step)

        try {
          await this.supabase.createRunStep(run.id, step)
        } catch (err) {
          console.warn('Failed to insert run step log:', err)
        }

        // Stop on error (configurable later)
        if (!result.success) {
          run.status = 'failed'
          run.error = result.error
          break
        }
      }

      if (run.status === 'running') {
        run.status = 'completed'
      }
    } catch (error) {
      run.status = 'failed'
      run.error = error instanceof Error ? error.message : String(error)
    }

    run.completedAt = new Date().toISOString()

    // Collect final output: prefer block outputs, otherwise fallback to last node
    if (Object.keys(blockOutputs).length > 0) {
      run.output = blockOutputs
    } else {
      const lastStep = run.steps[run.steps.length - 1]
      if (lastStep) {
        run.output = lastStep.output
      }
    }

    try {
      await this.supabase.updateRun(run.id, run.status, run.output, run.error, run.completedAt)
    } catch (err) {
      console.warn('Failed to update run log:', err)
    }

    return run
  }

  private resolveInputs(node: FlowNodeSerialized): Record<string, unknown> {
    const config = { ...node.data.config }
    const mapping = node.data.inputMapping || {}

    // Override config values with mapped values from previous node outputs
    for (const [inputField, source] of Object.entries(mapping)) {
      const sourceOutput = this.nodeOutputs.get(source.sourceNodeId)
      if (sourceOutput && source.sourceField in sourceOutput) {
        let value = sourceOutput[source.sourceField]
        
        // Handle nested paths for JSON objects
        if (source.sourcePath) {
          // If value is a string that looks like JSON, try to parse it before resolving path
          if (typeof value === 'string' && (value.startsWith('{') || value.startsWith('['))) {
            try { value = JSON.parse(value) } catch {}
          }

          if (value && typeof value === 'object') {
            value = this.getNestedValue(value, source.sourcePath)
          } else {
            // Path was specified but value is not an object or couldn't be parsed
            value = ''
          }
        }
        
        config[inputField] = value ?? ''
      }
    }

    // Resolve Element IDs to XPaths
    const actionDef = builtinActions.find(a => a.type === node.data.actionType)
    if (actionDef) {
      for (const field of actionDef.inputSchema) {
        if (field.type === 'element' && config[field.name]) {
          const elementId = String(config[field.name])
          const xpath = this.elementMap.get(elementId)
          if (xpath) {
            config[field.name] = xpath
          } else {
            // Keep the original value (it could be a raw string instead of ID)
          }
        }
      }
    }

    return config
  }

  private topologicalSort(
    nodes: FlowNodeSerialized[],
    edges: FlowEdgeSerialized[]
  ): FlowNodeSerialized[] {
    const nodeMap = new Map(nodes.map(n => [n.id, n]))
    const inDegree = new Map<string, number>()
    const adjacency = new Map<string, string[]>()

    for (const node of nodes) {
      inDegree.set(node.id, 0)
      adjacency.set(node.id, [])
    }

    for (const edge of edges) {
      adjacency.get(edge.source)?.push(edge.target)
      inDegree.set(edge.target, (inDegree.get(edge.target) || 0) + 1)
    }

    const queue: string[] = []
    for (const [id, deg] of inDegree) {
      if (deg === 0) queue.push(id)
    }

    const sorted: FlowNodeSerialized[] = []
    while (queue.length > 0) {
      const id = queue.shift()!
      const node = nodeMap.get(id)
      if (node) sorted.push(node)

      for (const neighbor of (adjacency.get(id) || [])) {
        const newDeg = (inDegree.get(neighbor) || 0) - 1
        inDegree.set(neighbor, newDeg)
        if (newDeg === 0) queue.push(neighbor)
      }
    }

    return sorted
  }

  private getNestedValue(obj: any, path: string): any {
    if (!path || !path.trim()) return obj
    return path.split('.').reduce((acc, part) => {
      const key = part.trim()
      if (acc && typeof acc === 'object' && key in acc) {
        return acc[key]
      }
      return undefined
    }, obj)
  }
}
