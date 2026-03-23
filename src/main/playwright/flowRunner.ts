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
  private edges: FlowEdgeSerialized[] = []
  private nodeMap: Map<string, FlowNodeSerialized> = new Map()
  private loopBodyNodeIds: Set<string> = new Set()

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
    this.loopBodyNodeIds.clear()
    this.edges = flowData.edges
    this.nodeMap = new Map(flowData.nodes.map(n => [n.id, n]))

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

    // Pre-scan: identify all loop body nodes so we can skip them in the main execution
    for (const node of flowData.nodes) {
      if (node.data.actionType === 'loop') {
        const bodyNodes = this.collectLoopBody(node.id)
        for (const id of bodyNodes) {
          this.loopBodyNodeIds.add(id)
        }
      }
    }

    try {
      // Topological sort of nodes based on edges
      const sortedNodes = this.topologicalSort(flowData.nodes, flowData.edges)

      for (const node of sortedNodes) {
        if (this.cancelled) {
          run.status = 'cancelled'
          break
        }

        // Skip nodes that belong to a loop body (they are executed by the loop itself)
        if (this.loopBodyNodeIds.has(node.id)) {
          continue
        }

        // Skip ifElse and switch for now (Phase 4+)
        if (['ifElse', 'switch'].includes(node.data.actionType)) {
          continue
        }

        // Handle loop execution
        if (node.data.actionType === 'loop') {
          const loopResult = await this.executeLoop(node, flowData, run, blockOutputs)
          if (!loopResult) {
            console.warn(`Loop node ${node.id} failed. Skipping...`)
          }
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
        } else if (node.data.actionType === 'updateCampaignStatus') {
          const detailId = flowData.variables?.detailId as number
          const status = String(resolvedInput.status || 'hoàn thành')
          if (detailId) {
            await this.supabase.updateCampaignDetail(detailId, { status })
          }
          result = { success: true, output: { status }, durationMs: 0 }
        } else if (node.data.actionType === 'writeCampaignLog') {
          const campaignId = flowData.variables?.campaignId as number
          const message = String(resolvedInput.message || '')
          if (campaignId && message) {
            await this.supabase.appendCampaignLog(campaignId, message)
          }
          result = { success: true, output: { message }, durationMs: 0 }
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

        // Stop on error: log and fail workflow execution
        if (!result.success) {
          const errMsg = `Lỗi ở bước "${node.data.label || node.data.actionType}": ${result.error}`
          console.warn(`Action failed on node ${node.id}.`, result.error)
          throw new Error(errMsg)
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

  /**
   * Collect all nodes in the loop body (connected from the loop node's `loop-body` handle).
   * Stops when it encounters a node that is connected to the loop's `loop-done` handle.
   */
  private collectLoopBody(loopNodeId: string): string[] {
    // Find nodes connected from the `loop-done` handle (these are NOT part of loop body)
    const doneTargetIds = new Set<string>()
    for (const edge of this.edges) {
      if (edge.source === loopNodeId && edge.sourceHandle === 'loop-done') {
        doneTargetIds.add(edge.target)
      }
    }

    // BFS from `loop-body` handle edges
    const bodyNodeIds: string[] = []
    const visited = new Set<string>()
    const queue: string[] = []

    for (const edge of this.edges) {
      if (edge.source === loopNodeId && edge.sourceHandle === 'loop-body') {
        if (!doneTargetIds.has(edge.target)) {
          queue.push(edge.target)
        }
      }
    }

    while (queue.length > 0) {
      const nodeId = queue.shift()!
      if (visited.has(nodeId) || doneTargetIds.has(nodeId)) continue
      visited.add(nodeId)
      bodyNodeIds.push(nodeId)

      // Follow downstream edges from this node
      for (const edge of this.edges) {
        if (edge.source === nodeId && !visited.has(edge.target) && !doneTargetIds.has(edge.target)) {
          queue.push(edge.target)
        }
      }
    }

    return bodyNodeIds
  }

  /**
   * Execute a loop node: iterate over items, count, or while condition,
   * and execute the loop body nodes for each iteration.
   */
  private async executeLoop(
    loopNode: FlowNodeSerialized,
    flowData: FlowData,
    run: ExecutionRun,
    blockOutputs: Record<string, unknown>
  ): Promise<boolean> {
    const resolvedInput = this.resolveInputs(loopNode)
    const loopType = String(resolvedInput.loopType || 'count')

    // Build loop items based on type
    let items: unknown[] = []

    if (loopType === 'forEach') {
      let rawItems = resolvedInput.items
      // Parse JSON string if needed
      if (typeof rawItems === 'string') {
        try { rawItems = JSON.parse(rawItems) } catch {}
      }
      if (Array.isArray(rawItems)) {
        items = rawItems
      } else {
        // Not a valid array
        const step: ExecutionStep = {
          nodeId: loopNode.id,
          actionType: 'loop',
          status: 'error',
          input: resolvedInput,
          output: {},
          error: `Loop items is not an array. Got: ${typeof rawItems}`,
          executedAt: new Date().toISOString()
        }
        this.onProgress({ ...step })
        run.steps.push(step)
        run.status = 'failed'
        run.error = step.error
        return false
      }
    } else if (loopType === 'count') {
      const count = Number(resolvedInput.count) || 0
      items = Array.from({ length: count }, (_, i) => i)
    }
    // 'while' is handled differently below

    // Emit loop start step
    const loopStep: ExecutionStep = {
      nodeId: loopNode.id,
      actionType: 'loop',
      status: 'running',
      input: resolvedInput,
      output: { totalItems: items.length },
      executedAt: new Date().toISOString()
    }
    this.onProgress({ ...loopStep })

    // Collect loop body node IDs in topological order
    const bodyNodeIds = this.collectLoopBody(loopNode.id)
    const allNodes = Array.from(this.nodeMap.values())
    const bodyNodes = this.topologicalSort(
      allNodes.filter(n => bodyNodeIds.includes(n.id)),
      this.edges.filter(e => bodyNodeIds.includes(e.source) && bodyNodeIds.includes(e.target))
    )

    // Execute iterations
    if (loopType === 'while') {
      // While loop
      let index = 0
      const maxIterations = 10000 // Safety limit
      while (index < maxIterations) {
        if (this.cancelled) {
          run.status = 'cancelled'
          return false
        }

        // Evaluate condition
        const condition = String(resolvedInput.condition || 'false')
        const condResult = this.evaluateCondition(condition)
        if (!condResult) break

        // Set loop output for this iteration
        this.nodeOutputs.set(loopNode.id, { index, item: index, completed: false })

        const success = await this.executeLoopBodyNodes(bodyNodes, loopNode, flowData, run, blockOutputs)
        if (!success) return false

        index++
      }

      this.nodeOutputs.set(loopNode.id, { index: index - 1, item: index - 1, completed: true })
    } else {
      // forEach and count loops
      for (let i = 0; i < items.length; i++) {
        if (this.cancelled) {
          run.status = 'cancelled'
          return false
        }

        const item = items[i]

        // Set loop output for this iteration (child nodes can map from loop node's output)
        this.nodeOutputs.set(loopNode.id, { index: i, item, completed: false })

        const success = await this.executeLoopBodyNodes(bodyNodes, loopNode, flowData, run, blockOutputs)
        if (!success) return false
      }

      const lastIndex = items.length > 0 ? items.length - 1 : 0
      this.nodeOutputs.set(loopNode.id, {
        index: lastIndex,
        item: items.length > 0 ? items[lastIndex] : null,
        completed: true
      })
    }

    // Mark loop step as success
    loopStep.status = 'success'
    loopStep.output = this.nodeOutputs.get(loopNode.id) || {}
    this.onProgress({ ...loopStep })
    run.steps.push(loopStep)

    try {
      await this.supabase.createRunStep(run.id, loopStep)
    } catch (err) {
      console.warn('Failed to insert loop step log:', err)
    }

    return true
  }

  /**
   * Execute all nodes in the loop body for a single iteration.
   */
  private async executeLoopBodyNodes(
    bodyNodes: FlowNodeSerialized[],
    loopNode: FlowNodeSerialized,
    flowData: FlowData,
    run: ExecutionRun,
    blockOutputs: Record<string, unknown>
  ): Promise<boolean> {
    for (const bodyNode of bodyNodes) {
      if (this.cancelled) {
        run.status = 'cancelled'
        return false
      }

      // Nested loops
      if (bodyNode.data.actionType === 'loop') {
        const success = await this.executeLoop(bodyNode, flowData, run, blockOutputs)
        if (!success) return false
        continue
      }

      // Skip ifElse, switch in loop body too
      if (['ifElse', 'switch'].includes(bodyNode.data.actionType)) {
        continue
      }

      const step: ExecutionStep = {
        nodeId: bodyNode.id,
        actionType: bodyNode.data.actionType,
        status: 'running',
        input: {},
        output: {},
        executedAt: new Date().toISOString()
      }
      this.onProgress({ ...step })

      const resolvedInput = this.resolveInputs(bodyNode)
      step.input = resolvedInput

      let result: { success: boolean; output: Record<string, unknown>; error?: string; durationMs?: number; screenshotBase64?: string }

      if (bodyNode.data.actionType === 'block') {
        const blockId = String(resolvedInput.blockId)
        const blockFlow = await this.supabase.loadFlow(blockId)
        if (!blockFlow) {
          result = { success: false, output: {}, error: 'Block not found in database', durationMs: 0 }
        } else {
          blockFlow.variables = resolvedInput
          const subRunner = new FlowRunner(this.controller, this.supabase, () => {})
          const startT = Date.now()
          const subRun = await subRunner.run(blockFlow)
          const durationMs = Date.now() - startT
          if (subRun.status === 'completed') {
            result = { success: true, output: subRun.output, durationMs }
          } else {
            result = { success: false, output: subRun.output, error: subRun.error || 'Block execution failed', durationMs }
          }
        }
      } else if (bodyNode.data.actionType === 'blockInput') {
        const fieldName = String(bodyNode.data.config.fieldName || 'input')
        const defaultValue = bodyNode.data.config.defaultValue
        let val = flowData.variables?.[fieldName] ?? defaultValue
        if (typeof val === 'string' && (val.startsWith('{') || val.startsWith('['))) {
          try { val = JSON.parse(val) } catch {}
        }
        result = { success: true, output: { value: val }, durationMs: 0 }
      } else if (bodyNode.data.actionType === 'blockOutput') {
        const val = resolvedInput.value
        const fieldName = String(bodyNode.data.config.fieldName || 'output')
        blockOutputs[fieldName] = val
        result = { success: true, output: { [fieldName]: val }, durationMs: 0 }
      } else {
        result = await this.controller.executeAction(
          bodyNode.data.actionType,
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
        this.nodeOutputs.set(bodyNode.id, result.output)
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

      if (!result.success) {
        run.status = 'failed'
        run.error = result.error
        return false
      }
    }

    return true
  }

  /**
   * Simple condition evaluator for while loops.
   * Replaces {{nodeId.field}} with actual values from nodeOutputs.
   */
  private evaluateCondition(condition: string): boolean {
    try {
      // Replace {{nodeId.field}} patterns
      const resolved = condition.replace(/\{\{(\w+)\.(\w+)\}\}/g, (_, nodeId, field) => {
        const output = this.nodeOutputs.get(nodeId)
        if (output && field in output) {
          const val = output[field]
          return JSON.stringify(val)
        }
        return 'undefined'
      })

      // eslint-disable-next-line no-eval
      return !!eval(resolved)
    } catch {
      return false
    }
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

